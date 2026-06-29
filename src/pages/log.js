import { icon } from '../icons.js';
import { navigate, getSearchParams } from '../router.js';
import { listExercises, listSessions, createSession, addSet, getSession, setVolume, formatSetDisplay, getMeta, setMeta } from '../db.js';
import { findBestExerciseMatch } from '../exerciseMatching.js';
import { parseVoiceTranscript } from '../voiceParser.js';
import { todayLocalIso, formatLocalDate } from '../dateUtils.js';
import {
  checkOnDeviceAvailability,
  installOnDeviceSpeech,
  applyOnDeviceOptionsIfReady,
} from '../onDeviceSpeech.js';

let recognition = null;
let isListening = false;
let lastParentSetId = null;
let onDeviceStatus = null; // cached per page-visit: 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported' | null (not checked yet)
let onDeviceActuallyApplied = false; // whether THIS recognition instance is actually running on-device

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

const CONFIDENCE_RANK = { high: 2, low: 1, none: 0 };

/**
 * Free, built-in accuracy improvement: instead of trusting only the
 * speech recognizer's single top-ranked guess, this tries every
 * combination of alternative transcriptions (via maxAlternatives) and
 * keeps whichever one produces the best exercise-name match. A lower-
 * ranked alternative ("dropset" correctly heard as alternative #3,
 * say) is often more useful than the recognizer's overall top pick if
 * the top pick garbled the exercise name.
 *
 * To keep this tractable (avoiding a combinatorial explosion across
 * many result segments), each result segment's alternatives are tried
 * with every OTHER segment kept at its own top choice — not a full
 * cross-product. This covers the common case (one segment containing
 * the exercise name) without the cost of trying every combination.
 */
function pickBestTranscript(alternativesPerResult, fallbackTranscript, exercises) {
  if (!alternativesPerResult.length) return fallbackTranscript;

  let best = { transcript: fallbackTranscript, confidence: 'none', rank: -1 };

  const tryCandidate = (transcript) => {
    const parsed = parseVoiceTranscript(exercises, transcript);
    const rank = CONFIDENCE_RANK[parsed.confidence] ?? 0;
    if (rank > best.rank) {
      best = { transcript, confidence: parsed.confidence, rank };
    }
  };

  // Always consider the simple top-choice concatenation as a baseline.
  tryCandidate(fallbackTranscript);

  // Then try swapping in each alternative for each segment in turn.
  for (let segmentIndex = 0; segmentIndex < alternativesPerResult.length; segmentIndex++) {
    const alternatives = alternativesPerResult[segmentIndex];
    for (const altText of alternatives) {
      const combined = alternativesPerResult
        .map((alts, i) => (i === segmentIndex ? altText : alts[0] || ''))
        .join('');
      tryCandidate(combined);
      if (best.rank === CONFIDENCE_RANK.high) break; // good enough, stop searching
    }
    if (best.rank === CONFIDENCE_RANK.high) break;
  }

  return best.transcript;
}

export async function renderLogPage() {
  // Reset per-visit state: lastParentSetId must not leak across page
  // visits, since a dropset should only ever chain to a working set
  // logged within THIS session visit, not a stale set_id from a
  // previous session the user was viewing earlier.
  lastParentSetId = null;

  const params = getSearchParams();
  const targetSessionParam = params.get('session_id');
  const targetDateParam = params.get('date');
  const today = todayLocalIso();
  const targetDate = targetDateParam || today;
  const isBackfillTarget = Boolean(targetSessionParam);

  const exercises = await listExercises();
  let sessionId = targetSessionParam ? Number(targetSessionParam) : null;
  let todaySets = [];
  let draft = null;

  if (sessionId) {
    const full = await getSession(sessionId);
    todaySets = full?.sets || [];
  } else {
    const sessions = await listSessions({ startDate: today, endDate: today });
    if (sessions[0]) {
      sessionId = sessions[0].id;
      const full = await getSession(sessionId);
      todaySets = full?.sets || [];
    }
  }

  const SpeechRecognitionCtor = getSpeechRecognitionCtor();
  const isSupported = Boolean(SpeechRecognitionCtor);

  // Check on-device availability once per visit. Cache stable results
  // ('available', 'unavailable', 'unsupported') in meta storage so we
  // don't re-run this check on every single page visit — but always
  // re-check 'downloadable'/'downloading' since those states are
  // expected to change (the person might install it, or a download
  // might finish) and a stale cached value there would be actively
  // wrong, not just slightly inefficient.
  if (isSupported) {
    const cachedStatus = await getMeta('on_device_speech_status');
    if (cachedStatus && cachedStatus !== 'downloadable' && cachedStatus !== 'downloading') {
      onDeviceStatus = cachedStatus;
    } else {
      onDeviceStatus = await checkOnDeviceAvailability();
      await setMeta('on_device_speech_status', onDeviceStatus);
    }
  }

  function renderDraftCard(d) {
    const confidenceLabel =
      d.confidence === 'high'
        ? '<span class="text-accent" style="font-size: 0.75rem; font-weight: 600;">Matched</span>'
        : d.confidence === 'low'
        ? '<span style="font-size: 0.75rem; font-weight: 600; color: #facc15;">Low confidence — check this</span>'
        : '<span class="text-intensity" style="font-size: 0.75rem; font-weight: 600;">No match — pick an exercise</span>';

    const exerciseOptionsHtml = exercises
      .map(
        (ex) =>
          `<option value="${ex.id}" data-body-part="${escapeHtml(ex.body_part)}" ${ex.id === d.matched_exercise_id ? 'selected' : ''}>${escapeHtml(ex.canonical_name)}</option>`
      )
      .join('');

    // Cardio never has multiple sets per draft (no such thing as a
    // "cardio dropset"), so it always renders the single distance/
    // duration row, same as before this feature existed.
    const fieldsHtml = d.is_cardio
      ? `
        <div class="field-row" style="grid-template-columns: 1fr 1fr;">
          <div>
            <label class="field-label">Distance (km)</label>
            <input type="number" inputmode="decimal" id="draft-distance-input" value="${d.sets[0].distance_km ?? ''}" class="font-display" style="font-size: 1.1rem;" />
          </div>
          <div>
            <label class="field-label">Duration (min)</label>
            <input type="number" inputmode="decimal" id="draft-duration-input" value="${d.sets[0].duration_min ?? ''}" class="font-display" style="font-size: 1.1rem;" />
          </div>
        </div>`
      : renderStrengthSetRows(d.sets);

    const multiSetNote =
      !d.is_cardio && d.sets.length > 1
        ? `<p class="text-accent" style="font-size: 0.8rem; margin: 0 0 0.75rem;">Detected ${d.sets.length} sets — the first is the working set, the rest are linked as dropsets.</p>`
        : '';

    return `
      <div class="card" style="border: 1px solid var(--surface-high);">
        <div class="flex-between" style="margin-bottom: 1rem;">
          <span class="section-title" style="margin: 0;">Review before saving</span>
          ${confidenceLabel}
        </div>

        ${d.raw_transcript ? `<p class="text-muted" style="font-style: italic; font-size: 0.875rem; margin: 0 0 1rem;">"${escapeHtml(d.raw_transcript)}"</p>` : ''}

        <div class="field">
          <label class="field-label">Exercise</label>
          <select id="draft-exercise-select">
            <option value="">Select exercise…</option>
            ${exerciseOptionsHtml}
          </select>
        </div>

        ${multiSetNote}

        <div id="draft-fields-container">
          ${fieldsHtml}
        </div>

        <div class="btn-row">
          <button id="draft-discard-btn" class="btn btn-muted">${icon('x', 18)} Discard</button>
          <button id="draft-save-btn" class="btn btn-accent">${icon('check', 18)} Save ${d.sets.length > 1 ? `${d.sets.length} sets` : 'set'}</button>
        </div>
      </div>
    `;
  }

  /**
   * Renders one editable row per strength set in the draft. For the
   * common single-set case this looks exactly like before (weight,
   * reps, RPE, dropset checkbox). For a detected multi-set dropset
   * transcript, renders one row per detected set, each individually
   * editable, with the dropset checkbox pre-checked (and disabled —
   * see note below) for every row after the first.
   */
  function renderStrengthSetRows(sets) {
    return sets
      .map((s, i) => {
        const isFirst = i === 0;
        return `
        <div class="draft-set-row" data-set-index="${i}" style="${i > 0 ? 'margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--surface-high);' : ''}">
          ${sets.length > 1 ? `<p class="text-muted" style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600; margin: 0 0 0.5rem;">${isFirst ? 'Working set' : `Dropset ${i}`}</p>` : ''}
          <div class="field-row">
            <div>
              <label class="field-label">Weight (kg)</label>
              <input type="number" inputmode="decimal" class="draft-weight-input font-display" data-set-index="${i}" value="${s.weight ?? ''}" style="font-size: 1.1rem;" />
            </div>
            <div>
              <label class="field-label">Reps</label>
              <input type="number" inputmode="numeric" class="draft-reps-input font-display" data-set-index="${i}" value="${s.reps ?? ''}" style="font-size: 1.1rem;" />
            </div>
            <div>
              <label class="field-label">RPE</label>
              <input type="number" inputmode="decimal" step="0.5" min="1" max="10" class="draft-rpe-input font-display" data-set-index="${i}" value="${s.rpe ?? ''}" style="font-size: 1.1rem;" />
            </div>
          </div>
          <label class="checkbox-row">
            <input type="checkbox" class="draft-dropset-checkbox" data-set-index="${i}" ${s.is_dropset ? 'checked' : ''} />
            <span style="font-size: 0.875rem;">This is a dropset</span>
          </label>
        </div>`;
      })
      .join('');
  }

  function renderApp() {
    const totalVolume = todaySets.reduce((sum, s) => sum + setVolume(s), 0);

    const onDeviceInstallBanner =
      !draft && onDeviceStatus === 'downloadable'
        ? `<button id="install-on-device-btn" class="btn btn-surface" style="margin-bottom: 1rem; justify-content: space-between;">
            <span style="font-size: 0.8rem;">Enable free on-device voice recognition (no internet needed)</span>
            ${icon('download', 16)}
          </button>`
        : !draft && onDeviceStatus === 'downloading'
        ? `<p class="text-muted" style="font-size: 0.8rem; margin-bottom: 1rem; text-align: center;">Downloading on-device voice model…</p>`
        : '';

    const draftHtml = draft
      ? renderDraftCard(draft)
      : `
        ${onDeviceInstallBanner}
        <div class="card" style="padding: 0;">
          <div class="voice-button-wrap" id="voice-btn-wrap">
            ${
              !isSupported
                ? `<div class="empty-state">Voice input isn't supported in this browser. Try Chrome on Android, or use manual entry below.</div>`
                : `
              ${isListening ? '<span class="voice-ping"></span>' : ''}
              <button id="voice-circle-btn" class="voice-circle ${isListening ? 'listening' : ''}" aria-pressed="${isListening}">
                ${isListening ? icon('square', 28) : icon('mic', 32)}
              </button>
              <span style="font-size: 0.875rem; font-weight: 600;">
                ${isListening ? 'Listening… tap to stop' : 'Tap to log a set'}
              </span>
              ${
                onDeviceActuallyApplied
                  ? `<span class="text-accent" style="font-size: 0.7rem; margin-top: 2px;">On-device (free, offline)</span>`
                  : ''
              }`
            }
          </div>
        </div>

        <button id="manual-entry-btn" class="btn btn-surface" style="margin-top: 1rem; margin-bottom: 1.5rem;">
          ${icon('plus', 18)} Enter manually instead
        </button>

        <div id="manual-entry-form" style="display: none;" class="card" style="margin-bottom: 1.5rem;">
          <label class="field-label">Type an exercise name</label>
          <input type="text" id="manual-exercise-input" placeholder="e.g. bench press" class="field" />
          <div class="btn-row">
            <button id="manual-cancel-btn" class="btn btn-muted">Cancel</button>
            <button id="manual-continue-btn" class="btn btn-accent">Continue</button>
          </div>
        </div>
      `;

    const setsListHtml =
      todaySets.length > 0
        ? `
        <div>
          <div class="flex-between" style="margin-bottom: 0.75rem;">
            <h2 class="section-title" style="margin: 0;">${isBackfillTarget ? 'Sets for this session' : "Today's sets"}</h2>
            ${totalVolume > 0 ? `<span class="text-accent" style="font-size: 0.875rem; font-weight: 600;">${Math.round(totalVolume).toLocaleString()} kg total</span>` : ''}
          </div>
          ${todaySets
            .map(
              (s) => `
            <div class="list-row">
              <div>
                <p class="list-row-title">
                  ${escapeHtml(s.exercise?.canonical_name ?? 'Unknown')}
                  ${s.is_dropset ? '<span class="badge-dropset">DROPSET</span>' : ''}
                </p>
                <p class="list-row-subtitle">
                  ${formatSetDisplay(s)}
                </p>
              </div>
              ${
                !s.is_cardio
                  ? `<span class="text-muted font-display" style="font-size: 0.75rem;">${Math.round(setVolume(s))} kg</span>`
                  : ''
              }
            </div>`
            )
            .join('')}
        </div>`
        : '';

    return `
      <div class="page">
        ${
          isBackfillTarget
            ? `<button id="back-to-history" class="back-link">${icon('chevronLeft', 16)} Back to history</button>`
            : ''
        }
        <h1 class="page-title">
          ${isBackfillTarget ? `Log for ${formatLocalDate(targetDate, { weekday: 'long', day: 'numeric', month: 'short' })}` : 'Log a set'}
        </h1>
        <p class="subtitle">Speak it, or enter manually. You'll always confirm before it saves.</p>

        ${draftHtml}
        ${setsListHtml}
      </div>
    `;
  }

  function wireUpVoice(rerender) {
    if (!isSupported) return;

    if (!recognition) {
      recognition = new SpeechRecognitionCtor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      // maxAlternatives is a free, built-in way to improve accuracy on
      // fitness vocabulary without any paid API: ask the recognizer
      // for several candidate transcriptions per phrase instead of
      // just one, then (in onend below) try each candidate against
      // the exercise library and keep whichever one actually resolves
      // to a real match. The default of 1 means you're stuck with
      // whatever the model's single top guess was, even when a lower-
      // ranked alternative would have matched a known exercise name.
      recognition.maxAlternatives = 5;

      // Free, local, offline-capable on-device recognition (Chrome
      // 139+) — applied only when actually ready ('available'). If
      // not ready for any reason, this is a no-op and the recognition
      // instance behaves exactly as it always has (cloud-based, via
      // whatever the browser does by default). No regression risk.
      onDeviceActuallyApplied = applyOnDeviceOptionsIfReady(recognition, onDeviceStatus);
    }

    recognition.onresult = (event) => {
      // Collect every alternative for every result, not just [0] —
      // _lastAlternatives is consumed in onend to find the best match.
      const alternativesPerResult = [];
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const alts = [];
        for (let j = 0; j < result.length; j++) {
          alts.push(result[j].transcript);
        }
        alternativesPerResult.push(alts);
      }
      recognition._lastAlternativesPerResult = alternativesPerResult;
      // Keep the simple top-alternative concatenation too, as the
      // fallback if no alternative combination produces a match.
      recognition._lastTranscript = alternativesPerResult.map((alts) => alts[0] || '').join('');
    };

    recognition.onerror = () => {
      isListening = false;
      rerender();
    };

    recognition.onend = () => {
      isListening = false;
      const transcript = pickBestTranscript(
        recognition._lastAlternativesPerResult || [],
        recognition._lastTranscript || '',
        exercises
      );
      if (transcript) {
        draft = parseVoiceTranscript(exercises, transcript);
      }
      rerender();
    };

    document.getElementById('voice-circle-btn')?.addEventListener('click', () => {
      if (isListening) {
        recognition.stop();
      } else {
        recognition._lastTranscript = '';
        try {
          recognition.start();
          isListening = true;
          rerender();
        } catch (e) {
          // already started — ignore
        }
      }
    });
  }

  function wireUpEvents(rerender) {
    document.getElementById('back-to-history')?.addEventListener('click', () => navigate('/history'));

    document.getElementById('install-on-device-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const label = btn.querySelector('span');
      if (label) label.textContent = 'Downloading…';
      btn.disabled = true;

      onDeviceStatus = 'downloading';
      await setMeta('on_device_speech_status', onDeviceStatus);
      rerender();

      const success = await installOnDeviceSpeech();
      // Re-check rather than trust the boolean blindly — the install
      // call can report success while the model is still finishing
      // setup, so the authoritative answer is asking availability
      // again rather than assuming success means 'available' now.
      onDeviceStatus = await checkOnDeviceAvailability();
      await setMeta('on_device_speech_status', onDeviceStatus);

      // Force the next voice button press to rebuild the recognition
      // instance with on-device options applied, since the existing
      // instance (if any) was created before installation completed.
      recognition = null;
      rerender();
    });

    document.getElementById('manual-entry-btn')?.addEventListener('click', () => {
      const form = document.getElementById('manual-entry-form');
      const btn = document.getElementById('manual-entry-btn');
      if (form) form.style.display = 'block';
      if (btn) btn.style.display = 'none';
      document.getElementById('manual-exercise-input')?.focus();
    });

    document.getElementById('manual-cancel-btn')?.addEventListener('click', () => {
      const form = document.getElementById('manual-entry-form');
      const btn = document.getElementById('manual-entry-btn');
      if (form) form.style.display = 'none';
      if (btn) btn.style.display = 'block';
    });

    document.getElementById('manual-continue-btn')?.addEventListener('click', () => {
      const input = document.getElementById('manual-exercise-input');
      const query = (input?.value || '').trim();
      let matchedId = null;
      let confidence = 'none';
      let isCardio = false;
      if (query) {
        const result = findBestExerciseMatch(exercises, query);
        matchedId = result.exercise?.id ?? null;
        confidence = result.confidence;
        isCardio = result.exercise?.body_part === 'Cardio';
      }
      draft = isCardio
        ? {
            raw_transcript: '',
            confidence,
            matched_exercise_id: matchedId,
            is_cardio: true,
            sets: [{ distance_km: null, duration_min: null }],
          }
        : {
            raw_transcript: '',
            confidence,
            matched_exercise_id: matchedId,
            is_cardio: false,
            sets: [{ weight: null, reps: null, rpe: null, is_dropset: false }],
          };
      rerender();
    });

    document.getElementById('draft-discard-btn')?.addEventListener('click', () => {
      draft = null;
      rerender();
    });

    document.getElementById('draft-exercise-select')?.addEventListener('change', (e) => {
      const selectedOption = e.target.selectedOptions[0];
      const newBodyPart = selectedOption?.dataset.bodyPart;
      const newIsCardio = newBodyPart === 'Cardio';

      // Switching exercises can flip strength <-> cardio — rebuild the
      // draft with the field set matching the NEWLY selected exercise,
      // not the one that was originally voice/text-matched. Cardio
      // can't have multiple sets (no such thing as a cardio dropset),
      // so switching TO cardio always collapses back to one set,
      // discarding any extra detected dropset rows rather than trying
      // to map weight/reps onto distance/duration.
      draft = {
        ...draft,
        matched_exercise_id: Number(e.target.value) || null,
        is_cardio: newIsCardio,
        sets: newIsCardio
          ? [{ distance_km: draft.is_cardio ? draft.sets[0].distance_km ?? null : null, duration_min: draft.is_cardio ? draft.sets[0].duration_min ?? null : null }]
          : draft.is_cardio
          ? [{ weight: null, reps: null, rpe: null, is_dropset: false }]
          : draft.sets,
      };
      rerender();
    });

    document.getElementById('draft-save-btn')?.addEventListener('click', async () => {
      const exerciseId = document.getElementById('draft-exercise-select')?.value;
      if (!exerciseId) return;

      let activeSessionId = sessionId;
      const isCardioSave = Boolean(document.getElementById('draft-distance-input'));
      const selectedExercise = exercises.find((ex) => ex.id === Number(exerciseId));
      const usesDumbbellEquipment = Boolean(
        selectedExercise?.equipment && /dumbbell/i.test(selectedExercise.equipment)
      );
      // dumbbell_count defaults to 2 (one per hand) whenever equipment
      // mentions "Dumbbell" — explicit override to 1 for exercises
      // done holding a single weight with both hands (e.g. Russian
      // Twist), where doubling the logged weight would be wrong.
      const dumbbellCount = selectedExercise?.dumbbell_count ?? 2;
      const isDumbbellExercise = usesDumbbellEquipment && dumbbellCount === 2;

      const payloads = [];

      if (isCardioSave) {
        const distance = document.getElementById('draft-distance-input')?.value;
        const duration = document.getElementById('draft-duration-input')?.value;
        if (distance === '' && duration === '') return; // nothing to save

        payloads.push({
          exercise_id: Number(exerciseId),
          is_cardio: true,
          distance_km: distance === '' ? null : parseFloat(distance),
          duration_min: duration === '' ? null : parseFloat(duration),
          weight: null,
          reps: null,
          rpe: null,
          is_dropset: false,
          parent_set_id: null,
        });
      } else {
        // Read every set row present in the draft card (one row for a
        // normal entry, multiple rows for a detected dropset
        // sequence), in DOM order, by their data-set-index attribute.
        const rowCount = document.querySelectorAll('.draft-weight-input').length;

        for (let i = 0; i < rowCount; i++) {
          const weightEl = document.querySelector(`.draft-weight-input[data-set-index="${i}"]`);
          const repsEl = document.querySelector(`.draft-reps-input[data-set-index="${i}"]`);
          const rpeEl = document.querySelector(`.draft-rpe-input[data-set-index="${i}"]`);
          const dropsetEl = document.querySelector(`.draft-dropset-checkbox[data-set-index="${i}"]`);

          const weight = weightEl?.value;
          const reps = repsEl?.value;
          if (weight === '' || reps === '' || weight === undefined || reps === undefined) {
            // Skip incomplete rows rather than failing the whole save —
            // lets a person clear out a row they decide they don't want
            // without it blocking the rows they do want saved.
            continue;
          }

          payloads.push({
            exercise_id: Number(exerciseId),
            is_cardio: false,
            is_dumbbell: isDumbbellExercise,
            weight: parseFloat(weight),
            reps: parseInt(reps, 10),
            rpe: rpeEl?.value === '' ? null : parseFloat(rpeEl?.value),
            is_dropset: Boolean(dropsetEl?.checked),
            // parent_set_id is resolved below, after we know each
            // saved set's real database id — can't be computed here.
            _isDropsetPending: Boolean(dropsetEl?.checked),
          });
        }

        if (payloads.length === 0) return; // every row was incomplete
      }

      if (!activeSessionId) {
        const newSession = await createSession({ date: targetDate });
        activeSessionId = newSession.id;
        sessionId = activeSessionId;
      }

      // Save in order. For strength saves, every non-dropset row
      // becomes the new "parent" for subsequent dropset rows — this
      // correctly handles a single multi-set draft (working set then
      // N dropsets, all chained to that one working set) the same way
      // it handles N separate single-set saves done back to back.
      for (const payload of payloads) {
        const isDropsetRow = payload._isDropsetPending ?? payload.is_dropset;
        delete payload._isDropsetPending;
        payload.is_dropset = isDropsetRow;
        payload.parent_set_id = isDropsetRow && lastParentSetId ? lastParentSetId : null;

        const savedSet = await addSet(activeSessionId, payload);
        if (!payload.is_cardio && !payload.is_dropset) {
          lastParentSetId = savedSet.id;
        }
      }

      draft = null;
      const full = await getSession(activeSessionId);
      todaySets = full.sets || [];
      rerender();
    });

    wireUpVoice(rerender);
  }

  function rerender() {
    const appEl = document.getElementById('app');
    appEl.innerHTML = renderApp();
    wireUpEvents(rerender);
  }

  function cleanup() {
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      if (isListening) recognition.stop();
      isListening = false;
    }
  }

  return {
    html: renderApp(),
    afterRender: () => wireUpEvents(rerender),
    cleanup,
  };
}
