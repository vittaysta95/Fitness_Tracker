/**
 * Exercise name matching — ported from the Python backend's
 * exercise_matching.py. Same strategy: exact match first, then a
 * similarity score (Dice coefficient on bigrams, a JS-friendly
 * equivalent of Python's difflib.SequenceMatcher ratio), with the
 * same confidence thresholds.
 *
 * Known limitation carried over unchanged: pure string similarity
 * doesn't understand equipment semantics, so "incline dumbbell press"
 * can occasionally match "incline barbell press" instead. Expected to
 * be corrected via the Settings page as you encounter mismatches.
 */

const HIGH_CONFIDENCE_THRESHOLD = 0.85;
const LOW_CONFIDENCE_THRESHOLD = 0.6;

function normalize(text) {
  return text.trim().toLowerCase();
}

/** Dice coefficient similarity (0-1) between two strings, via bigrams. */
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = (s) => {
    const map = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.substring(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };

  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  let intersection = 0;

  for (const [bg, countA] of bigramsA) {
    if (bigramsB.has(bg)) {
      intersection += Math.min(countA, bigramsB.get(bg));
    }
  }

  const totalA = [...bigramsA.values()].reduce((s, c) => s + c, 0);
  const totalB = [...bigramsB.values()].reduce((s, c) => s + c, 0);

  return (2 * intersection) / (totalA + totalB);
}

/**
 * Returns { exercise, confidence } where confidence is "high" | "low" | "none".
 */
export function findBestExerciseMatch(exercises, query) {
  const queryNorm = normalize(query || '');
  if (!queryNorm) return { exercise: null, confidence: 'none' };

  // Pass 1: exact match on canonical name or any alias
  for (const ex of exercises) {
    if (normalize(ex.canonical_name) === queryNorm) {
      return { exercise: ex, confidence: 'high' };
    }
    for (const alias of ex.aliases || []) {
      if (normalize(alias) === queryNorm) {
        return { exercise: ex, confidence: 'high' };
      }
    }
  }

  // Pass 2: fuzzy match — best score across canonical name + aliases
  let bestExercise = null;
  let bestScore = 0;

  for (const ex of exercises) {
    const candidates = [ex.canonical_name, ...(ex.aliases || [])];
    for (const candidate of candidates) {
      const score = similarity(queryNorm, normalize(candidate));
      if (score > bestScore) {
        bestScore = score;
        bestExercise = ex;
      }
    }
  }

  if (bestScore >= HIGH_CONFIDENCE_THRESHOLD) {
    return { exercise: bestExercise, confidence: 'high' };
  } else if (bestScore >= LOW_CONFIDENCE_THRESHOLD) {
    return { exercise: bestExercise, confidence: 'low' };
  } else {
    return { exercise: null, confidence: 'none' };
  }
}
