/**
 * Garmin CSV import — ported from garmin_import.py. Parses a
 * manually-exported Garmin Connect CSV (web -> Activities -> Export
 * CSV) entirely in-browser using the File API, and upserts recognised
 * daily metrics into IndexedDB.
 *
 * Same rule as before: this NEVER touches sessions/sets. Garmin data
 * is supplementary context only — manual training entries always win.
 */
import { upsertGarminMetric } from './db.js';

const COLUMN_ALIASES = {
  date: ['date', 'activity date', 'calendar date'],
  resting_hr: ['resting heart rate', 'resting hr'],
  avg_hr: ['avg hr', 'average heart rate', 'avg heart rate'],
  sleep_hours: ['sleep time', 'total sleep', 'sleep duration'],
  body_battery: ['body battery', 'body battery (charged)'],
  stress_avg: ['avg stress', 'stress score', 'average stress level'],
  calories: ['calories', 'total calories', 'calories burned'],
};

function normalizeHeader(header) {
  return header.trim().toLowerCase();
}

function buildColumnMap(headers) {
  const map = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const found = headers.find((h) => aliases.includes(normalizeHeader(h)));
    if (found) map[field] = found;
  }
  return map;
}

function parseDateValue(value) {
  if (!value) return null;
  const trimmed = value.trim();
  // Try YYYY-MM-DD / YYYY/MM/DD first (unambiguous)
  let m = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Then MM/DD/YYYY or DD/MM/YYYY — assume US-style MM/DD/YYYY, the
  // more common Garmin export default; this is a best-effort guess.
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function parseFloatValue(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim().replace(/,/g, '');
  if (cleaned === '' || cleaned === '--' || cleaned === 'N/A') return null;
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? null : num;
}

/** Minimal CSV line parser handling quoted fields with commas. */
function parseCsvText(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line) => {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current);
    return fields;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });
    return row;
  });

  return { headers, rows };
}

export async function importGarminCsv(filename, fileText) {
  const { headers, rows } = parseCsvText(fileText);

  if (headers.length === 0) {
    return {
      filename,
      rows_imported: 0,
      rows_skipped: 0,
      date_range_start: null,
      date_range_end: null,
      warnings: ['Could not read any columns from this file.'],
    };
  }

  const columnMap = buildColumnMap(headers);

  if (!columnMap.date) {
    return {
      filename,
      rows_imported: 0,
      rows_skipped: 0,
      date_range_start: null,
      date_range_end: null,
      warnings: [`No recognisable date column found. Headers seen: ${headers.join(', ')}`],
    };
  }

  let rowsImported = 0;
  let rowsSkipped = 0;
  let minDate = null;
  let maxDate = null;

  for (const row of rows) {
    const parsedDate = parseDateValue(row[columnMap.date]);
    if (!parsedDate) {
      rowsSkipped++;
      continue;
    }

    const metric = { date: parsedDate, raw_source_row: row };
    for (const field of ['resting_hr', 'avg_hr', 'sleep_hours', 'body_battery', 'stress_avg', 'calories']) {
      if (columnMap[field]) {
        const value = parseFloatValue(row[columnMap[field]]);
        if (value !== null) metric[field] = value;
      }
    }

    await upsertGarminMetric(metric);

    rowsImported++;
    if (!minDate || parsedDate < minDate) minDate = parsedDate;
    if (!maxDate || parsedDate > maxDate) maxDate = parsedDate;
  }

  const missingFields = Object.keys(COLUMN_ALIASES).filter(
    (f) => f !== 'date' && !columnMap[f]
  );
  const warnings = [];
  if (missingFields.length > 0) {
    warnings.push(`Columns not found in this file (skipped): ${missingFields.join(', ')}`);
  }

  return {
    filename,
    rows_imported: rowsImported,
    rows_skipped: rowsSkipped,
    date_range_start: minDate,
    date_range_end: maxDate,
    warnings,
  };
}
