import { icon } from '../icons.js';
import { navigate, getSearchParams } from '../router.js';
import { listExercises, listSessions, createSession, addSet, getSession, setVolume, formatSetDisplay, getMeta, setMeta, addAliasToExercise, findAliasConflict } from '../db.js';
import { findBestExerciseMatch } from '../exerciseMatching.js';
import { parseVoiceTranscript, extractExercisePhrase } from '../voiceParser.js';
import { todayLocalIso, formatLocalDate } from '../dateUtils.js';
import {
  checkOnDeviceAvailability,
  installOnDeviceSpeech,
  applyOnDeviceOptionsIfReady,
} from '../onDeviceSpeech.js';
import { filterExercisesForSearch, renderExerciseSearchInput } from '../exerciseSearch.js';

let recognition = null;
let isListening = false;
let lastParentSetId = null;
let lastUsedExerciseId = null; // carries forward across sets within a page visit — see "aligns to previous set" behavior below
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
  // previous session the user was viewing earlier. Same reasoning for
  // lastUsedExerciseId — the "next set defaults to previous exercise"
  // behavior should only look at sets logged in THIS visit, not
  // whatever was last used in a different session entirely.
  lastParentSetId = null;
  lastUsedExerciseId = null;

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
  let manualSearchQuery = '';
  let manualDropdownOpen = false;
  let showManualEntryForm = false;
  // Draft-card exercise correction search (separate from the manual
  // entry search above, since they're different UI contexts on the
  // same page) — initialized fresh each time a new draft appears, see
  // renderDraftCard below.
  let draftExerciseSearchQuery = '';
  let draftExerciseDropdownOpen = false;
  // Tracks whether the person has actually typed in the draft's
  // exercise field yet. Needed because an empty string is falsy, so
  // checking `!draftExerciseSearchQuery` alone can't tell "field was
  // never touched, default-fill it from the match" apart from "field
  // was deliberately cleared to empty by the person" — without this
  // flag, clearing the field to retype a correction would get
  // silently overwritten back to the original match on every
  // keystroke's rerender, which is exactly the bug this fixes.
  let userHasEditedDraftExerciseSearch = false;
  // "Learn this pronunciation" prompt — appears right after correcting
  // a voice-originated draft's exercise, offering to save the original
  // mis-matched phrase as an alias of the now-correct exercise. Holds
  // the exercise id + phrase to save, or null when there's nothing to
  // offer (manual entries, or a correction that didn't actually
  // change anything meaningful to learn from).
  let pronunciationLearnOffer = null;
  let pronunciationLearnSavedMessage = null;

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

  // Initialize the "carries forward to next set" exercise from
  // whatever was logged most recently in this session, so reopening a
  // session with existing sets still defaults sensibly rather than
  // blank. Skips cardio sets for this purpose, since cardio doesn't
  // have multiple sets of the same exercise in the way strength work
  // does — defaulting the NEXT entry to "Running" after a cardio
  // session wouldn't be the helpful kind of carry-forward.
  const lastStrengthSet = [...todaySets].reverse().find((s) => !s.is_cardio);
  if (lastStrengthSet) {
    lastUsedExerciseId = lastStrengthSet.exercise_id;
  }

  const SpeechRecognitionCtor = getSpeechRecognitionCtor();
  const isSupported = Boolean(SpeechRecognitionCtor);

  // On-device status is ONLY ever set by an explicit button tap (see
  // the "check-on-device-btn" handler below), never automatically on
  // page load. The live availability check
  // (SpeechRecognition.available()) has been observed to crash the
  // page's renderer outright on at least one real browser build —
  // not a JS-catchable error, an actual tab crash — so it must never
  // run without the person choosing to trigger it. This only reads
  // whatever was last cached from a previous explicit check.
  if (isSupported) {
    onDeviceStatus = await getMeta('on_device_speech_status');
  }

  function renderDraftCard(d) {
    const confidenceLabel =
      d.confidence === 'high'
        ? '<span class="text-accent" style="font-size: 0.75rem; font-weight: 600;">Matched</span>'
        : d.confidence === 'low'
        ? '<span style="font-size: 0.75rem; font-weight: 600; color: #facc15;">Low confidence — check this</span>'
        : '<span class="text-intensity" style="font-size: 0.75rem; font-weight: 600;">No match — pick an exercise</span>';

    // Default-fill from whatever exercise is currently matched, but
    // ONLY if the person hasn't actually edited this field yet — once
    // they've typed anything (including clearing it to empty), their
    // input is authoritative and must never be silently overwritten,
    // per this app's "trust manual input over AI" rule throughout.
    if (!userHasEditedDraftExerciseSearch && d.matched_exercise_name) {
      draftExerciseSearchQuery = d.matched_exercise_name;
    }

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

        <div class="field" style="position: relative;">
          <label class="field-label">Exercise</label>
          ${renderExerciseSearchInput({
            inputId: 'draft-exercise-input',
            dropdownId: 'draft-exercise-dropdown',
            value: draftExerciseSearchQuery,
            matches: filterExercisesForSearch(exercises, draftExerciseSearchQuery),
            showDropdown: draftExerciseSearchQuery.length > 0 && draftExerciseDropdownOpen,
          })}
        </div>

        ${
          pronunciationLearnOffer
            ? `
          <div class="card" style="border: 1px solid var(--surface-high); padding: 0.75rem 0.875rem; margin-bottom: 0.75rem;">
            <p style="font-size: 0.8rem; margin: 0 0 0.5rem;">
              Heard "<strong>${escapeHtml(pronunciationLearnOffer.phrase)}</strong>" but you picked
              <strong>${escapeHtml(pronunciationLearnOffer.exerciseName)}</strong> instead — remember this
              pronunciation for next time?
            </p>
            <div class="btn-row">
              <button id="learn-pronunciation-dismiss-btn" class="btn btn-muted" style="font-size: 0.8rem; padding: 0.5rem;">Not now</button>
              <button id="learn-pronunciation-save-btn" class="btn btn-accent" style="font-size: 0.8rem; padding: 0.5rem;">${icon('check', 16)} Remember it</button>
            </div>
          </div>`
            : pronunciationLearnSavedMessage
            ? `<p class="text-accent" style="font-size: 0.8rem; margin: 0 0 0.75rem;">${icon('check', 14)} ${escapeHtml(pronunciationLearnSavedMessage)}</p>`
            : ''
        }

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
      !draft && isSupported && onDeviceStatus == null
        ? `<button id="check-on-device-btn" class="btn btn-surface" style="margin-bottom: 1rem; justify-content: space-between;">
            <span style="font-size: 0.8rem;">Check for free on-device voice recognition</span>
            ${icon('chevronRight', 16)}
          </button>`
        : !draft && onDeviceStatus === 'downloadable'
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

        <button id="manual-entry-btn" class="btn btn-surface" style="margin-top: 1rem; margin-bottom: 1.5rem; ${showManualEntryForm ? 'display: none;' : ''}">
          ${icon('plus', 18)} Enter manually instead
        </button>

        <div id="manual-entry-form" class="card" style="margin-bottom: 1.5rem; overflow: visible; ${showManualEntryForm ? '' : 'display: none;'}">
          <label class="field-label">Exercise</label>
          ${renderExerciseSearchInput({
            inputId: 'manual-exercise-input',
            dropdownId: 'manual-exercise-dropdown',
            value: manualSearchQuery,
            matches: filterExercisesForSearch(exercises, manualSearchQuery),
            showDropdown: manualSearchQuery.length > 0 && manualDropdownOpen,
          })}
          <div class="btn-row" style="margin-top: 0.75rem;">
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

        // "If there is no match on voice, then revert to previous
        // exercise" — voice always wins when it actually identifies an
        // exercise, but an unmatched transcript shouldn't leave the
        // person stuck picking from scratch when they likely just said
        // the same exercise as last time (e.g. background noise ate
        // the exercise name but the numbers came through fine).
        if (!draft.matched_exercise_id && lastUsedExerciseId && !draft.is_cardio) {
          const prevExercise = exercises.find((e) => e.id === lastUsedExerciseId);
          if (prevExercise) {
            draft.matched_exercise_id = prevExercise.id;
            draft.matched_exercise_name = prevExercise.canonical_name;
            // Confidence reflects that THIS transcript didn't actually
            // name the exercise — it's a fallback guess, not a real
            // match, so it should still read as "check this" rather
            // than "matched", consistent with how every other
            // low-certainty result is labelled in this app.
            draft.confidence = 'low';
          }
        }

        // Fresh draft from a new voice result — the exercise-correction
        // search box should default-fill from whatever WAS matched
        // (handled in renderDraftCard), not carry over leftover text
        // from a previous draft's correction attempt. Same for any
        // pending "learn this pronunciation" offer from a PREVIOUS
        // draft's correction — it shouldn't linger into this new one.
        draftExerciseSearchQuery = '';
        draftExerciseDropdownOpen = false;
        userHasEditedDraftExerciseSearch = false;
        pronunciationLearnOffer = null;
        pronunciationLearnSavedMessage = null;
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

    document.getElementById('check-on-device-btn')?.addEventListener('click', async (e) => {
      // This call (SpeechRecognition.available()) has been observed
      // to crash the browser tab outright on at least one real
      // browser build — not a JS error we can catch, an actual
      // renderer crash. Since there's no way to guarantee that won't
      // happen, the person gets a clear heads-up before it runs rather
      // than tapping what looks like an ordinary button and possibly
      // losing the tab without warning.
      const proceed = window.confirm(
        'This checks for a free, local voice recognition option. On rare browser versions this check has caused the page to crash — if that happens, just reopen the app, nothing will be lost. Continue?'
      );
      if (!proceed) return;

      const btn = e.currentTarget;
      const label = btn.querySelector('span');
      if (label) label.textContent = 'Checking…';
      btn.disabled = true;

      onDeviceStatus = await checkOnDeviceAvailability();
      await setMeta('on_device_speech_status', onDeviceStatus);
      rerender();
    });

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
      // (Same risky call as above — already past the warning prompt
      // for this flow since installing implies the person already
      // confirmed they're fine with the check-the-status step.)
      onDeviceStatus = await checkOnDeviceAvailability();
      await setMeta('on_device_speech_status', onDeviceStatus);

      // Force the next voice button press to rebuild the recognition
      // instance with on-device options applied, since the existing
      // instance (if any) was created before installation completed.
      recognition = null;
      rerender();
    });

    document.getElementById('manual-entry-btn')?.addEventListener('click', () => {
      showManualEntryForm = true;

      // Pre-fill with the carry-forward exercise from the previous
      // set, if any — "exercise selection for next set aligns to
      // previous set" — so doing multiple sets of the same movement
      // doesn't require retyping/researching it every time.
      if (lastUsedExerciseId) {
        const prevExercise = exercises.find((e) => e.id === lastUsedExerciseId);
        if (prevExercise) {
          manualSearchQuery = prevExercise.canonical_name;
        }
      }
      manualDropdownOpen = false;
      rerender();
      document.getElementById('manual-exercise-input')?.focus();
    });

    document.getElementById('manual-cancel-btn')?.addEventListener('click', () => {
      showManualEntryForm = false;
      manualSearchQuery = '';
      manualDropdownOpen = false;
      rerender();
    });

    document.getElementById('manual-exercise-input')?.addEventListener('input', (e) => {
      manualSearchQuery = e.target.value;
      manualDropdownOpen = true;
      rerender();
      // Re-render replaces the input element, so focus and cursor
      // position would otherwise jump to the start — restore both
      // after the rerender so typing feels continuous, not jumpy.
      const freshInput = document.getElementById('manual-exercise-input');
      if (freshInput) {
        freshInput.focus();
        freshInput.setSelectionRange(manualSearchQuery.length, manualSearchQuery.length);
      }
    });

    document.querySelectorAll('#manual-exercise-dropdown .exercise-search-result').forEach((el) => {
      el.addEventListener('click', () => {
        const exerciseId = Number(el.dataset.exerciseId);
        const exerciseName = el.dataset.exerciseName;
        startManualDraftFromExercise(exerciseId, exerciseName);
      });
    });

    document.getElementById('manual-continue-btn')?.addEventListener('click', () => {
      const query = manualSearchQuery.trim();
      if (!query) return;
      const result = findBestExerciseMatch(exercises, query);
      startManualDraftFromExercise(result.exercise?.id ?? null, query, result.confidence);
    });

    function startManualDraftFromExercise(matchedId, query, confidence = 'high') {
      const matchedExercise = matchedId ? exercises.find((e) => e.id === matchedId) : null;
      const isCardio = matchedExercise?.body_part === 'Cardio';
      draft = isCardio
        ? {
            raw_transcript: '',
            confidence,
            matched_exercise_id: matchedId,
            matched_exercise_name: matchedExercise?.canonical_name ?? null,
            is_cardio: true,
            sets: [{ distance_km: null, duration_min: null }],
          }
        : {
            raw_transcript: '',
            confidence,
            matched_exercise_id: matchedId,
            matched_exercise_name: matchedExercise?.canonical_name ?? null,
            is_cardio: false,
            sets: [{ weight: null, reps: null, rpe: null, is_dropset: false }],
          };
      // The draft card replaces the manual entry form entirely (see
      // renderApp's draftHtml branch), so the search state doesn't
      // need to persist — clear it so reopening "Enter manually" next
      // time starts from the carry-forward default, not whatever was
      // typed for this entry. Same for the draft card's OWN exercise
      // search field — a fresh draft should default-fill from
      // matched_exercise_name (handled in renderDraftCard), not
      // whatever was left over from a previous draft.
      manualSearchQuery = '';
      manualDropdownOpen = false;
      showManualEntryForm = false;
      draftExerciseSearchQuery = '';
      draftExerciseDropdownOpen = false;
      userHasEditedDraftExerciseSearch = false;
      pronunciationLearnOffer = null;
      pronunciationLearnSavedMessage = null;
      rerender();
    }

    document.getElementById('draft-discard-btn')?.addEventListener('click', () => {
      draft = null;
      draftExerciseSearchQuery = '';
      draftExerciseDropdownOpen = false;
      userHasEditedDraftExerciseSearch = false;
      pronunciationLearnOffer = null;
      pronunciationLearnSavedMessage = null;
      rerender();
    });

    document.getElementById('learn-pronunciation-dismiss-btn')?.addEventListener('click', () => {
      pronunciationLearnOffer = null;
      rerender();
    });

    document.getElementById('learn-pronunciation-save-btn')?.addEventListener('click', async () => {
      if (!pronunciationLearnOffer) return;
      const { exerciseId, exerciseName, phrase } = pronunciationLearnOffer;

      const conflict = await findAliasConflict(phrase, exerciseId);
      if (conflict) {
        const proceed = window.confirm(
          `"${phrase}" is already used for "${conflict.canonical_name}". Saving it here too means voice entries for either exercise could become ambiguous. Save anyway?`
        );
        if (!proceed) {
          pronunciationLearnOffer = null;
          rerender();
          return;
        }
      }

      await addAliasToExercise(exerciseId, phrase);
      // Refresh the in-memory exercise list so this new alias is
      // immediately usable for matching on the very next voice entry
      // in this same page visit, not just after a reload.
      const refreshed = await listExercises();
      exercises.length = 0;
      exercises.push(...refreshed);
      pronunciationLearnSavedMessage = `Saved "${phrase}" for next time.`;
      pronunciationLearnOffer = null;
      rerender();
    });

    /**
     * Switching exercises can flip strength <-> cardio — rebuild the
     * draft with the field set matching the NEWLY selected exercise,
     * not the one that was originally voice/text-matched. Cardio
     * can't have multiple sets (no such thing as a cardio dropset),
     * so switching TO cardio always collapses back to one set,
     * discarding any extra detected dropset rows rather than trying
     * to map weight/reps onto distance/duration. Shared by both the
     * search-result tap and a manually-typed exact match, so the two
     * paths can't drift out of sync with each other.
     */
    function applyDraftExerciseChange(newExerciseId) {
      const newExercise = exercises.find((ex) => ex.id === newExerciseId);
      const newIsCardio = newExercise?.body_part === 'Cardio';

      draft = {
        ...draft,
        matched_exercise_id: newExerciseId,
        matched_exercise_name: newExercise?.canonical_name ?? draft.matched_exercise_name,
        is_cardio: newIsCardio,
        sets: newIsCardio
          ? [{ distance_km: draft.is_cardio ? draft.sets[0].distance_km ?? null : null, duration_min: draft.is_cardio ? draft.sets[0].duration_min ?? null : null }]
          : draft.is_cardio
          ? [{ weight: null, reps: null, rpe: null, is_dropset: false }]
          : draft.sets,
      };
    }

    document.getElementById('draft-exercise-input')?.addEventListener('input', (e) => {
      draftExerciseSearchQuery = e.target.value;
      userHasEditedDraftExerciseSearch = true;
      draftExerciseDropdownOpen = true;
      rerender();
      const freshInput = document.getElementById('draft-exercise-input');
      if (freshInput) {
        freshInput.focus();
        freshInput.setSelectionRange(draftExerciseSearchQuery.length, draftExerciseSearchQuery.length);
      }
    });

    document.querySelectorAll('#draft-exercise-dropdown .exercise-search-result').forEach((el) => {
      el.addEventListener('click', () => {
        const exerciseId = Number(el.dataset.exerciseId);
        const exerciseName = el.dataset.exerciseName;

        // Capture what voice originally heard BEFORE applying the
        // correction, since applyDraftExerciseChange overwrites
        // matched_exercise_id/name on the draft.
        const wasVoiceEntry = Boolean(draft?.raw_transcript);
        const originallyMatchedId = draft?.matched_exercise_id;
        const rawTranscript = draft?.raw_transcript;

        applyDraftExerciseChange(exerciseId);
        draftExerciseSearchQuery = exerciseName;
        userHasEditedDraftExerciseSearch = true;
        draftExerciseDropdownOpen = false;

        // Only worth offering to "learn" this when: it came from voice
        // (typed manual corrections have nothing to learn — there's no
        // mis-hearing to fix), the correction actually changed which
        // exercise is selected (re-selecting the same one isn't a
        // correction), and the phrase voice actually heard isn't
        // already a known alias of the newly-selected exercise (no
        // point offering to save something already saved).
        pronunciationLearnOffer = null;
        if (wasVoiceEntry && originallyMatchedId !== exerciseId && rawTranscript) {
          const spokenPhrase = extractExercisePhrase(rawTranscript);
          const newExercise = exercises.find((ex) => ex.id === exerciseId);
          const alreadyKnown =
            spokenPhrase &&
            newExercise &&
            [newExercise.canonical_name, ...(newExercise.aliases || [])].some(
              (known) => known.toLowerCase() === spokenPhrase.toLowerCase()
            );
          if (spokenPhrase && !alreadyKnown) {
            pronunciationLearnOffer = { exerciseId, exerciseName, phrase: spokenPhrase };
          }
        }

        rerender();
      });
    });

    document.getElementById('draft-save-btn')?.addEventListener('click', async () => {
      const exerciseId = draft?.matched_exercise_id;
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
        if (!payload.is_cardio) {
          lastUsedExerciseId = payload.exercise_id;
        }
      }

      draft = null;
      draftExerciseSearchQuery = '';
      draftExerciseDropdownOpen = false;
      userHasEditedDraftExerciseSearch = false;
      pronunciationLearnOffer = null;
      pronunciationLearnSavedMessage = null;
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
