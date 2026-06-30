/**
 * Voice transcript parsing — ported from voice_parser.py. Extracts
 * weight/reps/RPE via regex and resolves the exercise name against
 * the library, same approach and same safety property: every field
 * is shown back to the user as an editable draft before saving, never
 * auto-committed.
 */
import { findBestExerciseMatch } from './exerciseMatching.js';

const WEIGHT_PATTERN = /(\d+(?:\.\d+)?)\s*(kg|kgs|kilos?|lbs?|pounds?)\b/i;
const REPS_PATTERN = /(\d+)\s*(?:reps?|repetitions?|times)\b/i;
const REPS_FALLBACK_PATTERN = /\bfor\s+(\d+)\b/i;

// RPE is fragile for speech recognition: it's an uncommon three-letter
// acronym with no strong pronunciation pattern, and cloud speech
// models (which is what powers the browser's SpeechRecognition) tend
// to substitute plausible-sounding alternatives ("are pee," "RPI,"
// or drop it entirely) rather than transcribe it correctly. The
// RPE_PATTERN below still catches it on the (real but less common)
// occasions it transcribes correctly, or whenever it's typed manually.
// The alternate patterns are the actual reliable fix: natural phrases
// the speech model has strong priors for, since they're ordinary
// English rather than a fitness-specific acronym.
const RPE_PATTERN = /rpe\s*(?:of\s*)?(\d+(?:\.\d+)?)/i;
const RPE_ALT_EFFORT_PATTERN = /\beffort\s*(?:of\s*|level\s*)?(\d+(?:\.\d+)?)\s*(?:out of (?:ten|10))?\b/i;
const RPE_ALT_DIFFICULTY_PATTERN = /\bdifficulty\s*(?:of\s*|level\s*)?(\d+(?:\.\d+)?)\s*(?:out of (?:ten|10))?\b/i;
const RPE_ALT_FELT_LIKE_PATTERN = /\bfelt\s+like\s+(?:an?\s+)?(\d+(?:\.\d+)?)\b/i;
const RPE_ALT_OUT_OF_TEN_PATTERN = /\b(\d+(?:\.\d+)?)\s*out of (?:ten|10)\b/i;

// Global versions (g flag) for multi-set dropset parsing, where the
// same unit ("kg", "reps") can legitimately appear more than once in
// a single transcript and every occurrence matters, not just the first.
const WEIGHT_PATTERN_G = /(\d+(?:\.\d+)?)\s*(kg|kgs|kilos?|lbs?|pounds?)\b/gi;
const REPS_PATTERN_G = /(\d+)\s*(?:reps?|repetitions?|times)\b/gi;
const REPS_FALLBACK_PATTERN_G = /\bfor\s+(\d+)\b/gi;

const DROPSET_TRIGGER_PATTERN = /\bdrop\s*sets?\b/i;

// Spoken numbers often come through as words, not digits ("thirty"
// not "30") — especially for round numbers under 100, which is
// exactly the range most weights and rep counts fall into. Normalize
// these to digits BEFORE any of the numeric regex patterns run, so
// "thirty kilos" is matched the same as "30 kilos" would be.
const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

export function normalizeSpokenNumbers(transcript) {
  const tensWords = Object.keys(TENS).join('|');
  const onesWords = Object.keys(ONES).join('|');

  // Pass 1: hundreds. Must run FIRST and capture the whole phrase in
  // one match — "one hundred and twenty seven", "one hundred", "two
  // hundred and five" — otherwise the later tens/ones passes would
  // fragment it (e.g. "one" -> "1" and "twenty seven" -> "27" leaves
  // "1 hundred and 27" instead of "127"). Weight plates commonly
  // exceed 99kg combined, so hundreds support matters for real use.
  const hundredsPattern = new RegExp(
    `\\b(${onesWords})\\s+hundred\\b(?:\\s+(?:and\\s+)?(?:(${tensWords})(?:[\\s-](${onesWords}))?|(${onesWords})))?`,
    'gi'
  );
  let result = transcript.replace(
    hundredsPattern,
    (match, hundredsWord, tensWord, onesAfterTens, onesAlone) => {
      const hundredsVal = ONES[hundredsWord.toLowerCase()];
      if (hundredsVal === undefined) return match;
      let remainder = 0;
      if (tensWord) {
        remainder = TENS[tensWord.toLowerCase()] || 0;
        if (onesAfterTens) remainder += ONES[onesAfterTens.toLowerCase()] || 0;
      } else if (onesAlone) {
        remainder = ONES[onesAlone.toLowerCase()] || 0;
      }
      return String(hundredsVal * 100 + remainder);
    }
  );

  // Pass 2: tens + optional ones ("ninety five", "ninety-five"), or a
  // tens word alone. Captures separator whitespace/hyphen so it can
  // be preserved in the replacement rather than collapsed away.
  const compoundPattern = new RegExp(
    `\\b(${tensWords})(?:([\\s-])(${onesWords}))?\\b`,
    'gi'
  );
  result = result.replace(compoundPattern, (match, tensWord, sep, onesWord) => {
    const tensVal = TENS[tensWord.toLowerCase()];
    if (tensVal === undefined) return match;
    const onesVal = onesWord ? ONES[onesWord.toLowerCase()] : 0;
    return String(tensVal + (onesVal || 0));
  });

  // Pass 3: any remaining standalone ones-words.
  result = result.replace(new RegExp(`\\b(${onesWords})\\b`, 'gi'), (match) => {
    const val = ONES[match.toLowerCase()];
    return val !== undefined ? String(val) : match;
  });

  // Pass 4: collapse spoken decimals into actual decimal numbers, now
  // that whole-number words are already digits. Two common gym
  // phrasings:
  //   "127 point 5"     -> "127.5"  (digit "point" digit)
  //   "27 and a half"   -> "27.5"   ("half" specifically means .5 —
  //                                  common for plate math, e.g. a
  //                                  1.25kg plate per side)
  result = result.replace(/\b(\d+(?:\.\d+)?)\s+point\s+(\d+)\b/gi, (_, whole, frac) => `${whole}.${frac}`);
  result = result.replace(/\b(\d+(?:\.\d+)?)\s+and\s+a\s+half\b/gi, (_, whole) => `${parseFloat(whole) + 0.5}`);
  // "half" alone (no leading number) means 0.5 — e.g. "half a kilo".
  result = result.replace(/\bhalf\s+a\b/gi, '0.5');

  return result;
}

// Cardio-specific: distance ("5km", "5 kilometers", "3 miles") and
// duration ("30 minutes", "1 hour", "45 mins").
const DISTANCE_PATTERN = /(\d+(?:\.\d+)?)\s*(km|kilometers?|kilometres?|miles?|mi)\b/i;
const DURATION_MIN_PATTERN = /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/i;
const DURATION_HOUR_PATTERN = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i;

const LB_TO_KG = 0.453592;
const MILES_TO_KM = 1.60934;

export function extractWeight(transcript) {
  const match = transcript.match(WEIGHT_PATTERN);
  if (!match) return null;
  let value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('lb') || unit.startsWith('pound')) {
    value *= LB_TO_KG;
  }
  return Math.round(value * 10) / 10;
}

function extractReps(transcript) {
  const match = transcript.match(REPS_PATTERN);
  if (match) return parseInt(match[1], 10);
  const fallback = transcript.match(REPS_FALLBACK_PATTERN);
  if (fallback) return parseInt(fallback[1], 10);
  return null;
}

function extractRpe(transcript) {
  // Try the literal "RPE N" pattern first (works for manual typing and
  // the occasions speech recognition does get the acronym right), then
  // fall through the more speech-reliable natural-language alternates
  // in order. First match wins — these phrasings are distinct enough
  // that overlap between them in one transcript is unlikely.
  const patterns = [
    RPE_PATTERN,
    RPE_ALT_EFFORT_PATTERN,
    RPE_ALT_DIFFICULTY_PATTERN,
    RPE_ALT_FELT_LIKE_PATTERN,
    RPE_ALT_OUT_OF_TEN_PATTERN,
  ];
  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

/**
 * Finds every weight mention in the transcript with its character
 * position, so multi-set parsing can pair each weight with whichever
 * reps number appears closest after it (rather than naively zipping
 * two separate lists, which breaks if extra numbers like RPE appear
 * out of the expected order).
 */
function findAllWeights(transcript) {
  const matches = [];
  for (const m of transcript.matchAll(WEIGHT_PATTERN_G)) {
    let value = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.startsWith('lb') || unit.startsWith('pound')) value *= LB_TO_KG;
    matches.push({ value: Math.round(value * 10) / 10, index: m.index });
  }
  return matches;
}

/**
 * Finds every reps mention (explicit unit words OR the "for N"
 * fallback) with its position. The fallback pattern is unsafe on its
 * own — "bench press for thirty kilos" contains "for 30" which looks
 * exactly like a reps fallback match, but the 30 actually belongs to
 * the weight that follows. A fallback match is only accepted if the
 * captured number is NOT immediately followed by a weight/distance/
 * duration unit word — that's the signal it's actually a standalone
 * "for N" reps phrase ("for 5 reps" minus the word reps, or just
 * "for 5") rather than "for N kg/km/minutes".
 */
function findAllReps(transcript) {
  const matches = [];
  for (const m of transcript.matchAll(REPS_PATTERN_G)) {
    matches.push({ value: parseInt(m[1], 10), index: m.index });
  }

  const UNIT_AFTER_NUMBER_PATTERN =
    /^\s*(?:kg|kgs|kilos?|lbs?|pounds?|km|kilometers?|kilometres?|miles?|mi|minutes?|mins?|hours?|hrs?)\b/i;

  for (const m of transcript.matchAll(REPS_FALLBACK_PATTERN_G)) {
    const textAfterNumber = transcript.slice(m.index + m[0].length);
    if (UNIT_AFTER_NUMBER_PATTERN.test(textAfterNumber)) {
      // This "for N" is actually "for N kg"/"for N km"/etc — the
      // number belongs to a weight/distance/duration mention, not a
      // reps count. Skip it entirely rather than recording a false reps match.
      continue;
    }

    // Avoid double-counting a number already captured by the explicit
    // unit pattern overlapping the same digits (e.g. "for 8 reps" can
    // match both the fallback "for 8" and the explicit "8 reps" — keep
    // only the explicit-unit version since it's the more reliable
    // signal). Overlap is checked by comparing where the captured
    // digit itself starts, not the full match span, since the two
    // patterns' match lengths differ ("for " is a 4-char prefix).
    const digitStart = m.index + m[0].indexOf(m[1]);
    const alreadyCaptured = matches.some((existing) => existing.index === digitStart);
    if (!alreadyCaptured) {
      matches.push({ value: parseInt(m[1], 10), index: digitStart });
    }
  }

  matches.sort((a, b) => a.index - b.index);
  return matches;
}

/**
 * Pairs weight mentions with reps mentions by sequence order — the
 * Nth weight pairs with the Nth reps, regardless of exact character
 * distance, since dropset phrasing varies a lot ("30kg for 5, then
 * 20kg for 4" vs "30 kilos 5 reps, 20 kilos 4 reps"). If there are
 * more weights than reps (or vice versa), only complete pairs are
 * returned — a dangling unpaired number isn't a usable set.
 */
function pairWeightsAndReps(weights, reps) {
  const pairCount = Math.min(weights.length, reps.length);
  const pairs = [];
  for (let i = 0; i < pairCount; i++) {
    pairs.push({ weight: weights[i].value, reps: reps[i].value });
  }
  return pairs;
}

function extractDistance(transcript) {
  const match = transcript.match(DISTANCE_PATTERN);
  if (!match) return null;
  let value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('mi')) value *= MILES_TO_KM;
  return Math.round(value * 100) / 100;
}

function extractDuration(transcript) {
  // Hours and minutes can both appear ("1 hour 20 minutes") — sum them.
  const hourMatch = transcript.match(DURATION_HOUR_PATTERN);
  const minMatch = transcript.match(DURATION_MIN_PATTERN);
  if (!hourMatch && !minMatch) return null;
  let total = 0;
  if (hourMatch) total += parseFloat(hourMatch[1]) * 60;
  if (minMatch) total += parseFloat(minMatch[1]);
  return Math.round(total * 10) / 10;
}

export function extractExercisePhrase(transcript) {
  // Order matters throughout: any pattern that could "donate" a number
  // to the generic REPS_FALLBACK_PATTERN must be stripped first —
  // weight/distance/duration/RPE-alternate phrases all contain numbers
  // that could otherwise be misread as a rep count.
  let cleaned = transcript.replace(DROPSET_TRIGGER_PATTERN, '');
  cleaned = cleaned.replace(WEIGHT_PATTERN_G, '');
  cleaned = cleaned.replace(DISTANCE_PATTERN, '');
  cleaned = cleaned.replace(DURATION_HOUR_PATTERN, '');
  cleaned = cleaned.replace(DURATION_MIN_PATTERN, '');
  cleaned = cleaned.replace(RPE_PATTERN, '');
  cleaned = cleaned.replace(RPE_ALT_EFFORT_PATTERN, '');
  cleaned = cleaned.replace(RPE_ALT_DIFFICULTY_PATTERN, '');
  cleaned = cleaned.replace(RPE_ALT_FELT_LIKE_PATTERN, '');
  cleaned = cleaned.replace(RPE_ALT_OUT_OF_TEN_PATTERN, '');
  cleaned = cleaned.replace(REPS_PATTERN_G, '');
  cleaned = cleaned.replace(REPS_FALLBACK_PATTERN_G, '');
  cleaned = cleaned.replace(
    /\bfor\b|\bat\b|\ban\b|\ba\b|\bin\b|\bfirst\s+sets?\b|\bsecond\s+sets?\b|\bthen\b/gi,
    ''
  );
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
  return cleaned;
}

/**
 * Returns a draft object matching the shape the UI expects. Always
 * includes a `sets` array now (even for the common single-set case),
 * so callers have one consistent shape to render and save from:
 *
 *   { matched_exercise_id, matched_exercise_name, is_cardio,
 *     raw_transcript, confidence, sets: [...] }
 *
 * For strength: each entry in `sets` is { weight, reps, rpe,
 * is_dropset }. For cardio: a single-entry sets array with
 * { distance_km, duration_min } (cardio dropsets aren't a concept,
 * so cardio transcripts never produce more than one set).
 *
 * Dropset detection: if the transcript contains "drop set"/"dropset"
 * AND at least two complete (weight, reps) pairs are found, every
 * pair after the first is marked is_dropset: true. This is what lets
 * a single utterance like "dropset bench press 30kg 5 reps first
 * set, 20kg 4 reps second set" produce two correctly-linked rows
 * instead of requiring two separate voice entries.
 */
export function parseVoiceTranscript(exercises, transcript) {
  // Normalize spelled-out numbers ("thirty" -> "30") for parsing, but
  // keep the ORIGINAL transcript for display in the draft card's
  // quote-back — "30 kilos" is fine to show, but there's no reason to
  // mangle "thirty kilos" into something that reads oddly when the
  // original phrasing is perfectly clear to a human reading it back.
  const normalizedTranscript = normalizeSpokenNumbers(transcript);

  const exercisePhrase = extractExercisePhrase(normalizedTranscript);
  const { exercise: matched, confidence: matchConfidence } = findBestExerciseMatch(
    exercises,
    exercisePhrase
  );

  const isCardio = matched?.body_part === 'Cardio';

  if (isCardio) {
    const distance_km = extractDistance(normalizedTranscript);
    const duration_min = extractDuration(normalizedTranscript);
    let confidence = matchConfidence;
    if (distance_km === null && duration_min === null) {
      confidence = confidence !== 'high' ? 'none' : 'low';
    }
    return {
      matched_exercise_id: matched.id,
      matched_exercise_name: matched.canonical_name,
      is_cardio: true,
      raw_transcript: transcript,
      confidence,
      sets: [{ distance_km, duration_min }],
    };
  }

  const rpe = extractRpe(normalizedTranscript);
  const mentionsDropset = DROPSET_TRIGGER_PATTERN.test(normalizedTranscript);

  if (mentionsDropset) {
    const weights = findAllWeights(normalizedTranscript);
    const reps = findAllReps(normalizedTranscript);
    const pairs = pairWeightsAndReps(weights, reps);

    if (pairs.length >= 2) {
      const sets = pairs.map((pair, i) => ({
        weight: pair.weight,
        reps: pair.reps,
        rpe: i === 0 ? rpe : null, // RPE, if spoken, is assumed to describe the working set
        is_dropset: i > 0,
      }));
      return {
        matched_exercise_id: matched ? matched.id : null,
        matched_exercise_name: matched ? matched.canonical_name : null,
        is_cardio: false,
        raw_transcript: transcript,
        confidence: matched ? matchConfidence : 'none',
        sets,
      };
    }
    // "dropset" was mentioned but fewer than 2 complete pairs were
    // found (e.g. only one weight/reps pair, or a dangling unpaired
    // number) — fall through to single-set parsing below rather than
    // silently dropping data the person did provide.
  }

  const weight = extractWeight(normalizedTranscript);
  const reps = extractReps(normalizedTranscript);

  let confidence = matchConfidence;
  // If we found no numeric fields at all, an exercise-name-only match
  // isn't a usable set entry on its own — downgrade confidence.
  if (weight === null && reps === null) {
    confidence = confidence !== 'high' ? 'none' : 'low';
  }

  return {
    matched_exercise_id: matched ? matched.id : null,
    matched_exercise_name: matched ? matched.canonical_name : null,
    is_cardio: false,
    raw_transcript: transcript,
    confidence,
    sets: [{ weight, reps, rpe, is_dropset: false }],
  };
}
