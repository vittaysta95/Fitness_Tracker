/**
 * CSV back-fill import — reads a CSV in the exact shape produced by
 * exportCsv() (see csvExport.js) and replays it into the database.
 * Column order isn't assumed; each row is mapped by header name so a
 * hand-edited or reordered export still imports correctly.
 *
 * volume_kg is intentionally ignored on import — always recomputed
 * via setVolume() from weight/reps, never trusted from the file.
 */
import { listExercises, listSessions, createSession, addSet, getSession } from './db.js';
import { findBestExerciseMatch } from './exerciseMatching.js';

const EXPECTED_HEADERS = [
  'date',
  'exercise',
  'body_part',
  'weight_kg',
  'reps',
  'rpe',
  'is_dropset',
  'distance_km',
  'duration_min',
  'volume_kg',
  'session_notes',
];

/** Minimal RFC4180-ish CSV line parser — handles quoted fields with
 * embedded commas/quotes, matching what csvEscape() in csvExport.js
 * produces. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function parseBool(value) {
  return String(value).trim().toLowerCase() === 'true';
}

/** Builds a dedup key for a set — same exercise/weight/reps/rpe/
 * dropset/cardio-fields means "this row already exists in this
 * session", so re-importing the same export doesn't double up
 * history. Deliberately ignores id/order/created_at. */
function setDedupKey(set) {
  return [
    set.exercise_id,
    set.is_cardio,
    set.weight ?? '',
    set.reps ?? '',
    set.rpe ?? '',
    set.is_dropset,
    set.distance_km ?? '',
    set.duration_min ?? '',
  ].join('|');
}

/**
 * Imports a CSV in exportCsv()'s exact format. Returns
 * { imported, skippedRows: [{ row, reason }] } for status display —
 * same pattern as garminStatus/importStatus in settings.js.
 */
export async function importExerciseCsv(filename, csvText) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return { imported: 0, skippedRows: [{ row: 0, reason: 'File is empty.' }] };
  }

  const header = rows[0].map((h) => h.trim());
  const colIndex = {};
  for (const expected of EXPECTED_HEADERS) {
    const idx = header.indexOf(expected);
    if (idx !== -1) colIndex[expected] = idx;
  }
  if (colIndex.date === undefined || colIndex.exercise === undefined) {
    return {
      imported: 0,
      skippedRows: [{ row: 0, reason: 'Missing required "date" or "exercise" column — expecting the format from Settings > Export your data.' }],
    };
  }

  const exercises = await listExercises();
  const existingSessions = await listSessions();
  const sessionByDate = new Map(existingSessions.map((s) => [s.date, s.id]));

  // Existing set dedup keys per session id — populated lazily the
  // first time a date's session is touched, so re-importing the same
  // (or overlapping) export doesn't create duplicate sets.
  const existingSetKeysBySession = new Map();
  async function getExistingSetKeys(sessionId) {
    if (!existingSetKeysBySession.has(sessionId)) {
      const full = await getSession(sessionId);
      existingSetKeysBySession.set(sessionId, new Set((full?.sets || []).map(setDedupKey)));
    }
    return existingSetKeysBySession.get(sessionId);
  }

  // Tracks the most recent non-dropset saved set's id per date, so
  // dropset rows within the same date chain to their working set —
  // mirrors the parent_set_id logic in log.js's draft-save handler.
  const lastParentSetIdByDate = new Map();

  let imported = 0;
  const skippedRows = [];

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (cols.length === 1 && cols[0] === '') continue; // trailing blank line

    const get = (field) => (colIndex[field] !== undefined ? (cols[colIndex[field]] ?? '').trim() : '');

    const date = get('date');
    const exerciseName = get('exercise');
    if (!date || !exerciseName) {
      skippedRows.push({ row: r + 1, reason: 'Missing date or exercise name.' });
      continue;
    }

    const { exercise, confidence } = findBestExerciseMatch(exercises, exerciseName);
    if (!exercise || confidence === 'none') {
      skippedRows.push({ row: r + 1, reason: `No matching exercise for "${exerciseName}" — add it in Settings first.` });
      continue;
    }

    const distanceRaw = get('distance_km');
    const durationRaw = get('duration_min');
    const weightRaw = get('weight_kg');
    const repsRaw = get('reps');
    // is_cardio isn't an exported column — inferred the same way the
    // exercise itself distinguishes cardio: no weight/reps present,
    // but distance or duration is.
    const isCardio = (distanceRaw !== '' || durationRaw !== '') && weightRaw === '' && repsRaw === '';

    if (!isCardio && (weightRaw === '' || repsRaw === '')) {
      skippedRows.push({ row: r + 1, reason: 'Missing weight/reps for a non-cardio row.' });
      continue;
    }

    let sessionId = sessionByDate.get(date);
    if (!sessionId) {
      const notes = get('session_notes');
      const newSession = await createSession({ date, notes: notes || null });
      sessionId = newSession.id;
      sessionByDate.set(date, sessionId);
    }

    const isDropset = parseBool(get('is_dropset'));
    const payload = {
      exercise_id: exercise.id,
      is_cardio: isCardio,
    };

    if (isCardio) {
      payload.distance_km = distanceRaw === '' ? null : parseFloat(distanceRaw);
      payload.duration_min = durationRaw === '' ? null : parseFloat(durationRaw);
      payload.weight = null;
      payload.reps = null;
      payload.rpe = null;
      payload.is_dropset = false;
      payload.parent_set_id = null;
    } else {
      const rpeRaw = get('rpe');
      payload.weight = parseFloat(weightRaw);
      payload.reps = parseInt(repsRaw, 10);
      payload.rpe = rpeRaw === '' ? null : parseFloat(rpeRaw);
      payload.is_dropset = isDropset;
      payload.parent_set_id = isDropset ? lastParentSetIdByDate.get(date) || null : null;
    }

    const savedSetKeys = await getExistingSetKeys(sessionId);
    const dedupKey = setDedupKey(payload);
    if (savedSetKeys.has(dedupKey)) {
      skippedRows.push({ row: r + 1, reason: 'Duplicate of an existing set for this date — skipped.' });
      continue;
    }

    const savedSet = await addSet(sessionId, payload);
    savedSetKeys.add(dedupKey);
    if (!isCardio && !isDropset) {
      lastParentSetIdByDate.set(date, savedSet.id);
    }
    imported++;
  }

  return { imported, skippedRows };
}
