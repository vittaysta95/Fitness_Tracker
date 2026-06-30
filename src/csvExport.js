/**
 * CSV export — ported from export.py. Same flat shape: one row per
 * set, joined with exercise and session info. Generated entirely
 * client-side and downloaded via a Blob, since there's no server to
 * stream it from.
 */
import { getSession, listSessions, setVolume } from './db.js';

function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportCsv({ startDate, endDate } = {}) {
  const sessions = await listSessions({ startDate, endDate });
  const rows = [
    [
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
    ],
  ];

  // Sort sessions chronologically (oldest first) to match the
  // backend's ordering, since listSessions returns newest-first.
  const sorted = [...sessions].sort((a, b) => (a.date < b.date ? -1 : 1));

  for (const sessionSummary of sorted) {
    const full = await getSession(sessionSummary.id);
    const sortedSets = [...full.sets].sort((a, b) => a.order_in_session - b.order_in_session);
    for (const set of sortedSets) {
      rows.push([
        full.date,
        set.exercise?.canonical_name ?? 'Unknown',
        set.exercise?.body_part ?? '',
        set.is_cardio ? '' : set.weight,
        set.is_cardio ? '' : set.reps,
        set.rpe ?? '',
        set.is_dropset,
        set.is_cardio ? set.distance_km ?? '' : '',
        set.is_cardio ? set.duration_min ?? '' : '',
        setVolume(set),
        full.notes ?? '',
      ]);
    }
  }

  const csvContent = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  return csvContent;
}

export function downloadCsv(csvContent, filename = 'fitness_export.csv') {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Body weight has a fundamentally different shape from training sets
 * (one row per day, no exercise/reps/volume), so it gets its own CSV
 * rather than being awkwardly squeezed into the per-set export above.
 */
export async function exportBodyWeightCsv() {
  const { listBodyWeightLogs } = await import('./db.js');
  const logs = await listBodyWeightLogs();
  const rows = [['date', 'weight_kg', 'notes']];
  for (const log of logs) {
    rows.push([log.date, log.weight_kg, log.notes ?? '']);
  }
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}
