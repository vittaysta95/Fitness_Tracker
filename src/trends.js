/**
 * Trend analysis and weekly summary — ported from trends.py and
 * weekly_summary.py. Same rule preserved: max_weight/max_reps are
 * computed from working sets only (is_dropset=false); total_volume
 * includes dropsets, since all weight actually lifted should count.
 */
import { getSession, listSessions, setVolume } from './db.js';
import { todayLocalIso, parseLocalDate } from './dateUtils.js';

export function computeExerciseTrend(exerciseId, allSessions, allSets, allExercises) {
  const exercise = allExercises.find((e) => e.id === exerciseId);
  if (!exercise) return null;

  const isCardio = exercise.body_part === 'Cardio';
  const sessionDateById = new Map(allSessions.map((s) => [s.id, s.date]));
  const relevantSets = allSets.filter((s) => s.exercise_id === exerciseId);

  const byDate = new Map();
  for (const set of relevantSets) {
    const date = sessionDateById.get(set.session_id);
    if (!date) continue;

    if (isCardio) {
      if (!byDate.has(date)) {
        byDate.set(date, { distance_km: 0, duration_min: 0 });
      }
      const bucket = byDate.get(date);
      bucket.distance_km += set.distance_km || 0;
      bucket.duration_min += set.duration_min || 0;
    } else {
      if (!byDate.has(date)) {
        byDate.set(date, { max_weight: 0, max_reps: 0, total_volume: 0 });
      }
      const bucket = byDate.get(date);
      bucket.total_volume += setVolume(set);
      if (!set.is_dropset) {
        bucket.max_weight = Math.max(bucket.max_weight, set.weight || 0);
        bucket.max_reps = Math.max(bucket.max_reps, set.reps || 0);
      }
    }
  }

  const points = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ date, ...v }));

  return {
    exercise_id: exercise.id,
    exercise_name: exercise.canonical_name,
    is_cardio: isCardio,
    points,
  };
}

/** Returns [mondayIso, sundayIso] for the week containing the given local date string. */
function weekBounds(dateIso) {
  const date = parseLocalDate(dateIso);
  const dayOfWeek = date.getDay(); // 0 = Sunday
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(date);
  monday.setDate(date.getDate() - daysSinceMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const toIso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return [toIso(monday), toIso(sunday)];
}

const ESTIMATED_MINUTES_PER_SET = 3.5;

export async function getWeeklySummary(weekOf = null) {
  const reference = weekOf || todayLocalIso();
  const [weekStart, weekEnd] = weekBounds(reference);

  const sessions = await listSessions({ startDate: weekStart, endDate: weekEnd });

  let totalVolume = 0;
  let totalSets = 0;
  let totalDistanceKm = 0;
  let totalCardioMinutes = 0;
  const volumeByBodyPart = new Map();
  const bestSetByExercise = new Map();

  for (const sessionSummary of sessions) {
    const full = await getSession(sessionSummary.id);
    for (const set of full.sets) {
      totalSets += 1;
      const bp = set.exercise?.body_part || 'Other';

      if (set.is_cardio) {
        totalDistanceKm += set.distance_km || 0;
        totalCardioMinutes += set.duration_min || 0;
        // Cardio still counts toward "sets per body part" so the
        // weekly breakdown shows cardio sessions happened, just with
        // 0 strength volume rather than a meaningless weight*reps figure.
        if (!volumeByBodyPart.has(bp)) {
          volumeByBodyPart.set(bp, { total_volume: 0, total_sets: 0 });
        }
        volumeByBodyPart.get(bp).total_sets += 1;
        continue;
      }

      const vol = setVolume(set);
      totalVolume += vol;

      if (!volumeByBodyPart.has(bp)) {
        volumeByBodyPart.set(bp, { total_volume: 0, total_sets: 0 });
      }
      const bucket = volumeByBodyPart.get(bp);
      bucket.total_volume += vol;
      bucket.total_sets += 1;

      if (!set.is_dropset) {
        const name = set.exercise?.canonical_name || 'Unknown';
        const current = bestSetByExercise.get(name);
        if (!current || set.weight > current.weight) {
          bestSetByExercise.set(name, set);
        }
      }
    }
  }

  const topLifts = [...bestSetByExercise.entries()]
    .sort(([, a], [, b]) => b.weight - a.weight)
    .slice(0, 5)
    .map(([name, s]) => ({
      exercise_name: name,
      weight: s.weight,
      reps: s.reps,
      is_dumbbell: Boolean(s.is_dumbbell),
    }));

  return {
    week_start: weekStart,
    week_end: weekEnd,
    total_sessions: sessions.length,
    total_hours_trained: Math.round(((totalSets * ESTIMATED_MINUTES_PER_SET) / 60) * 10) / 10,
    total_volume: totalVolume,
    total_distance_km: Math.round(totalDistanceKm * 10) / 10,
    total_cardio_minutes: totalCardioMinutes,
    volume_by_body_part: [...volumeByBodyPart.entries()].map(([body_part, v]) => ({
      body_part,
      ...v,
    })),
    top_lifts: topLifts,
  };
}

export async function getBodyPartVolume({ startDate, endDate } = {}) {
  const sessions = await listSessions({ startDate, endDate });
  const volumeByBodyPart = new Map();

  for (const sessionSummary of sessions) {
    const full = await getSession(sessionSummary.id);
    for (const set of full.sets) {
      const bp = set.exercise?.body_part || 'Other';
      if (!volumeByBodyPart.has(bp)) {
        volumeByBodyPart.set(bp, { total_volume: 0, total_sets: 0 });
      }
      const bucket = volumeByBodyPart.get(bp);
      bucket.total_volume += setVolume(set);
      bucket.total_sets += 1;
    }
  }

  return [...volumeByBodyPart.entries()].map(([body_part, v]) => ({ body_part, ...v }));
}
