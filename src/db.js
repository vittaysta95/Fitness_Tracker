/**
 * IndexedDB data layer — client-only replacement for the FastAPI +
 * SQLite backend. Same schema shape as the original (exercises,
 * sessions, sets, garmin_daily_metrics), so the matching/parsing/trend
 * logic ported from Python carries over conceptually unchanged.
 *
 * Everything here lives in this one browser's IndexedDB. There is no
 * server, no sync, no multi-device access — that trade-off was
 * confirmed deliberately to avoid needing Python/Node tooling.
 */

const DB_NAME = 'vitthuran_fitness';
const DB_VERSION = 1;

let dbInstance = null;

function openDb() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('exercises')) {
        const store = db.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true });
        store.createIndex('canonical_name', 'canonical_name', { unique: true });
        store.createIndex('body_part', 'body_part', { unique: false });
      }

      if (!db.objectStoreNames.contains('sessions')) {
        const store = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date', { unique: false });
      }

      if (!db.objectStoreNames.contains('sets')) {
        const store = db.createObjectStore('sets', { keyPath: 'id', autoIncrement: true });
        store.createIndex('session_id', 'session_id', { unique: false });
        store.createIndex('exercise_id', 'exercise_id', { unique: false });
      }

      if (!db.objectStoreNames.contains('garmin_daily_metrics')) {
        const store = db.createObjectStore('garmin_daily_metrics', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('date', 'date', { unique: true });
      }

      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Returns the "kg lifted" volume contribution of a set. Cardio sets
 * (running, cycling, rowing — measured in distance/time, not
 * weight/reps) contribute 0 to strength volume totals; their distance
 * and duration are tracked separately and surfaced on their own.
 */
/**
 * Returns a short human-readable description of a set for list views —
 * "100kg × 8" for strength, "5.2km in 28min" for cardio. Centralised so
 * History and Log don't each re-implement the cardio/strength branch.
 */
export function formatSetDisplay(set) {
  if (set.is_cardio) {
    const parts = [];
    if (set.distance_km) parts.push(`${set.distance_km}km`);
    if (set.duration_min) parts.push(`${set.duration_min}min`);
    return parts.length > 0 ? parts.join(' in ') : 'No distance/time logged';
  }
  const rpeText = set.rpe ? ` @${set.rpe}` : '';
  const weightText = set.is_dumbbell ? `${set.weight}kg/hand` : `${set.weight}kg`;
  return `${weightText} × ${set.reps}${rpeText}`;
}

export function setVolume(set) {
  if (set.is_cardio) return 0;
  // Dumbbell exercises store weight PER HAND (what you actually say/
  // hold), so total volume needs both hands counted — double it here,
  // at the single calculation point everything else reads from,
  // rather than at every individual call site.
  const multiplier = set.is_dumbbell ? 2 : 1;
  return (set.weight || 0) * (set.reps || 0) * multiplier;
}

function tx(storeName, mode = 'readonly') {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------- Generic helpers ----------

async function getAll(storeName) {
  const store = await tx(storeName);
  return promisifyRequest(store.getAll());
}

async function getById(storeName, id) {
  const store = await tx(storeName);
  return promisifyRequest(store.get(id));
}

async function put(storeName, value) {
  const store = await tx(storeName, 'readwrite');
  const id = await promisifyRequest(store.put(value));
  return { ...value, id };
}

async function deleteById(storeName, id) {
  const store = await tx(storeName, 'readwrite');
  await promisifyRequest(store.delete(id));
}

async function getByIndex(storeName, indexName, value) {
  const store = await tx(storeName);
  const index = store.index(indexName);
  return promisifyRequest(index.getAll(value));
}

// ---------- Exercises ----------

export async function listExercises(bodyPart = null) {
  const all = await getAll('exercises');
  const filtered = bodyPart ? all.filter((e) => e.body_part === bodyPart) : all;
  return filtered.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
}

export async function listBodyParts() {
  const all = await getAll('exercises');
  return [...new Set(all.map((e) => e.body_part))].sort();
}

export async function createExercise(exercise) {
  return put('exercises', { ...exercise, created_at: new Date().toISOString() });
}

export async function updateExercise(id, exercise) {
  return put('exercises', { ...exercise, id });
}

export async function deleteExercise(id) {
  return deleteById('exercises', id);
}

export async function seedExercisesIfEmpty(seedList) {
  const existing = await getAll('exercises');
  if (existing.length > 0) return { seeded: false, count: existing.length };
  for (const item of seedList) {
    await put('exercises', { ...item, created_at: new Date().toISOString() });
  }
  return { seeded: true, count: seedList.length };
}

/**
 * Adds any seed exercises not already present (matched by
 * canonical_name, case-insensitive) without touching existing ones or
 * their user-edited aliases. Used when the seed list grows after a
 * database has already been seeded — e.g. new cardio exercises added
 * in an update — so users don't need to re-enter them by hand.
 */
export async function syncNewSeedExercises(seedList) {
  const existing = await listExercises();
  const existingNames = new Set(existing.map((e) => e.canonical_name.toLowerCase()));
  let added = 0;
  for (const item of seedList) {
    if (!existingNames.has(item.canonical_name.toLowerCase())) {
      await put('exercises', { ...item, created_at: new Date().toISOString() });
      added++;
    }
  }
  return { added };
}

// ---------- Sessions ----------

export async function listSessions({ startDate, endDate } = {}) {
  let sessions = await getAll('sessions');
  if (startDate) sessions = sessions.filter((s) => s.date >= startDate);
  if (endDate) sessions = sessions.filter((s) => s.date <= endDate);

  const allSets = await getAll('sets');

  return sessions
    .map((s) => {
      const sets = allSets.filter((set) => set.session_id === s.id);
      const total_volume = sets.reduce((sum, set) => sum + setVolume(set), 0);
      const cardio_sets = sets.filter((set) => set.is_cardio);
      const total_distance_km = cardio_sets.reduce((sum, set) => sum + (set.distance_km || 0), 0);
      const total_cardio_minutes = cardio_sets.reduce((sum, set) => sum + (set.duration_min || 0), 0);
      return {
        ...s,
        total_sets: sets.length,
        total_volume,
        total_distance_km,
        total_cardio_minutes,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Lightweight existence check — used to decide whether a backup
 * reminder is worth showing, without pulling every session's full
 * set detail just to check if the database is non-empty. */
export async function hasLoggedAnything() {
  const sessions = await getAll('sessions');
  return sessions.length > 0;
}

export async function getSession(id) {
  const session = await getById('sessions', id);
  if (!session) return null;
  const sets = await getByIndex('sets', 'session_id', id);
  const exercises = await getAll('exercises');
  const exerciseMap = new Map(exercises.map((e) => [e.id, e]));
  const setsWithExercise = sets
    .sort((a, b) => a.order_in_session - b.order_in_session)
    .map((set) => ({ ...set, exercise: exerciseMap.get(set.exercise_id) }));
  return { ...session, sets: setsWithExercise };
}

export async function createSession({ date, notes = null }) {
  return put('sessions', { date, notes, created_at: new Date().toISOString() });
}

export async function deleteSession(id) {
  const sets = await getByIndex('sets', 'session_id', id);
  for (const set of sets) {
    await deleteById('sets', set.id);
  }
  return deleteById('sessions', id);
}

// ---------- Sets ----------

export async function addSet(sessionId, setData) {
  const existing = await getByIndex('sets', 'session_id', sessionId);
  const maxOrder = existing.reduce((max, s) => Math.max(max, s.order_in_session || 0), 0);
  return put('sets', {
    ...setData,
    session_id: sessionId,
    order_in_session: setData.order_in_session ?? maxOrder + 1,
    created_at: new Date().toISOString(),
  });
}

export async function deleteSet(id) {
  return deleteById('sets', id);
}

// ---------- Garmin daily metrics ----------

export async function upsertGarminMetric(metric) {
  const existing = await getByIndex('garmin_daily_metrics', 'date', metric.date);
  if (existing.length > 0) {
    return put('garmin_daily_metrics', { ...existing[0], ...metric });
  }
  return put('garmin_daily_metrics', metric);
}

export async function listGarminMetrics() {
  return getAll('garmin_daily_metrics');
}

// ---------- Meta (small app-level key/value settings) ----------

export async function getMeta(key) {
  const result = await getById('meta', key);
  return result ? result.value : null;
}

export async function setMeta(key, value) {
  return put('meta', { key, value });
}

// ---------- Export / reset ----------

export async function exportAllData() {
  return {
    exercises: await getAll('exercises'),
    sessions: await getAll('sessions'),
    sets: await getAll('sets'),
    garmin_daily_metrics: await getAll('garmin_daily_metrics'),
  };
}

export async function clearAllData() {
  const db = await openDb();
  const storeNames = ['exercises', 'sessions', 'sets', 'garmin_daily_metrics', 'meta'];
  await Promise.all(
    storeNames.map(
      (name) =>
        new Promise((resolve, reject) => {
          const req = db.transaction(name, 'readwrite').objectStore(name).clear();
          req.onsuccess = resolve;
          req.onerror = () => reject(req.error);
        })
    )
  );
}
