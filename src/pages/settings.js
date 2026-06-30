import { icon } from '../icons.js';
import { listExercises, createExercise, updateExercise, clearAllData, syncNewSeedExercises, addAliasToExercise } from '../db.js';
import { EXERCISE_SEED } from '../exerciseSeed.js';
import { importGarminCsv } from '../garminImport.js';
import { exportCsv, downloadCsv } from '../csvExport.js';
import { filterExercisesForSearch, renderExerciseSearchInput } from '../exerciseSearch.js';
import { isVoiceCaptureSupported, captureOneUtterance } from '../voiceCapture.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// Coarse mapping from the public free-exercise-db's primaryMuscles
// field to this app's broader body-part buckets. Same approach as
// the (no-longer-runnable-without-Python) import script — ported here
// so the "pull from a public list, refine over time" workflow still
// works without any backend.
const MUSCLE_TO_BODY_PART = {
  chest: 'Chest',
  lats: 'Back',
  'middle back': 'Back',
  'lower back': 'Back',
  traps: 'Back',
  quadriceps: 'Legs',
  hamstrings: 'Legs',
  glutes: 'Legs',
  calves: 'Legs',
  abductors: 'Legs',
  adductors: 'Legs',
  shoulders: 'Shoulders',
  biceps: 'Arms',
  triceps: 'Arms',
  forearms: 'Arms',
  abdominals: 'Core',
  neck: 'Core',
  'cardiovascular system': 'Cardio',
};

export async function renderSettingsPage() {
  let exercises = await listExercises();
  let editingExerciseId = null;
  let showAddExercise = false;
  let garminStatus = null;
  let importStatus = null;
  let syncStatus = null;
  let libraryFilterQuery = '';

  // ---------- Pronunciation training state ----------
  let trainingSelectedExerciseId = null;
  let trainingSearchQuery = '';
  let trainingDropdownOpen = false;
  let trainingIsListening = false;
  let trainingTranscript = null;
  let trainingError = null;
  let trainingSavedMessage = null;
  let activeVoiceCapture = null; // holds { stop } while listening, for cleanup

  function renderExerciseForm(initial) {
    const id = initial?.formId || 'new';
    const equipmentValue = initial?.equipment || '';
    const isDumbbellEquipment = /dumbbell/i.test(equipmentValue);
    const dumbbellCount = initial?.dumbbell_count ?? 2;

    return `
      <div class="card" style="border: 1px solid var(--surface-high); margin-bottom: 0.75rem;">
        <div class="field">
          <label class="field-label">Canonical name</label>
          <input type="text" id="ex-form-name-${id}" value="${escapeHtml(initial?.canonical_name || '')}" placeholder="e.g. Barbell Bench Press" />
        </div>
        <div class="field">
          <label class="field-label">Body part</label>
          <input type="text" id="ex-form-bodypart-${id}" value="${escapeHtml(initial?.body_part || '')}" placeholder="e.g. Chest" />
        </div>
        <div class="field">
          <label class="field-label">Aliases (comma-separated)</label>
          <input type="text" id="ex-form-aliases-${id}" value="${escapeHtml((initial?.aliases || []).join(', '))}" placeholder="bench, bb bench, flat bench" />
        </div>
        <div class="field">
          <label class="field-label">Equipment (optional)</label>
          <input type="text" id="ex-form-equipment-${id}" value="${escapeHtml(equipmentValue)}" placeholder="e.g. Barbell" />
        </div>
        <div id="ex-form-dumbbell-row-${id}" style="${isDumbbellEquipment ? '' : 'display: none;'}">
          <label class="checkbox-row">
            <input type="checkbox" id="ex-form-dumbbell-double-${id}" ${dumbbellCount === 2 ? 'checked' : ''} />
            <span style="font-size: 0.875rem;">Logged weight is per hand (double for volume) — uncheck if this is done holding one weight with both hands</span>
          </label>
        </div>
        <div class="btn-row">
          <button class="btn btn-muted ex-form-cancel" data-form-id="${id}">Cancel</button>
          <button class="btn btn-accent ex-form-save" data-form-id="${id}" data-editing-id="${initial?.id ?? ''}">Save</button>
        </div>
      </div>
    `;
  }

  /**
   * "Commit pronunciation to memory" — pick an exercise, say its name
   * out loud, see exactly what the recognizer heard, and optionally
   * save that exact phrase as a new alias. This is how the matcher
   * learns YOUR specific pronunciation over time rather than relying
   * only on the hand-picked alias list shipped with the app — every
   * saved phrase makes future voice entries for that exercise more
   * likely to match correctly on the first try.
   */
  function renderPronunciationTraining() {
    const selectedExercise = trainingSelectedExerciseId
      ? exercises.find((e) => e.id === trainingSelectedExerciseId)
      : null;

    const alreadyKnown =
      selectedExercise && trainingTranscript
        ? [selectedExercise.canonical_name, ...(selectedExercise.aliases || [])].some(
            (known) => known.toLowerCase() === trainingTranscript.toLowerCase()
          )
        : false;

    const transcriptHtml = trainingTranscript
      ? `
        <div class="card" style="border: 1px solid var(--surface-high); margin-top: 0.75rem;">
          <p class="text-muted" style="font-size: 0.75rem; margin: 0 0 4px;">Heard:</p>
          <p style="font-size: 1.05rem; margin: 0 0 0.75rem;">"${escapeHtml(trainingTranscript)}"</p>
          ${
            alreadyKnown
              ? `<p class="text-accent" style="font-size: 0.8rem; margin: 0;">${icon('check', 14)} Already saved for this exercise</p>`
              : `<button id="training-save-alias-btn" class="btn btn-accent">${icon('check', 18)} Commit to memory as alias</button>`
          }
        </div>`
      : trainingError
      ? `<p class="text-intensity" style="font-size: 0.85rem; margin-top: 0.75rem;">${escapeHtml(trainingError)}</p>`
      : '';

    const savedMessageHtml = trainingSavedMessage
      ? `<p class="text-accent" style="font-size: 0.85rem; margin-top: 0.5rem;">${escapeHtml(trainingSavedMessage)}</p>`
      : '';

    return `
      <h2 class="section-title" style="margin-top: 2rem;">Teach it your pronunciation</h2>
      <div class="card" style="margin-bottom: 1rem;">
        <p style="font-size: 0.875rem; margin: 0 0 0.75rem;">
          Pick an exercise, say its name the way you naturally would, and see exactly
          what voice recognition heard. If it's not already saved, you can commit
          that exact phrase to memory as an alias — so future voice entries for
          this exercise are more likely to match correctly the first time.
        </p>

        <label class="field-label">Exercise</label>
        ${renderExerciseSearchInput({
          inputId: 'training-exercise-input',
          dropdownId: 'training-exercise-dropdown',
          value: trainingSearchQuery,
          matches: filterExercisesForSearch(exercises, trainingSearchQuery),
          showDropdown: trainingSearchQuery.length > 0 && trainingDropdownOpen,
        })}

        ${
          selectedExercise
            ? `
          <div style="margin-top: 1rem;">
            ${
              !isVoiceCaptureSupported()
                ? `<p class="text-muted" style="font-size: 0.8rem;">Voice capture isn't supported in this browser.</p>`
                : `<button id="training-record-btn" class="btn ${trainingIsListening ? 'btn-surface' : 'btn-accent'}" data-listening="${trainingIsListening}">
                    ${trainingIsListening ? icon('square', 18) : icon('mic', 18)}
                    ${trainingIsListening ? 'Listening… tap to stop' : `Say "${escapeHtml(selectedExercise.canonical_name)}"`}
                  </button>`
            }
            ${transcriptHtml}
            ${savedMessageHtml}
          </div>`
            : ''
        }
      </div>
    `;
  }

  function renderApp() {
    const filteredExercises = libraryFilterQuery
      ? filterExercisesForSearch(exercises, libraryFilterQuery, Infinity)
      : exercises;

    const exerciseRows =
      filteredExercises.length === 0
        ? `<div class="empty-state">No exercises match "${escapeHtml(libraryFilterQuery)}".</div>`
        : filteredExercises
            .map(
              (ex) => `
        <div class="list-row">
          <div>
            <p class="list-row-title">${escapeHtml(ex.canonical_name)}</p>
            <p class="list-row-subtitle">${escapeHtml(ex.body_part)}${ex.aliases?.length ? ` · ${ex.aliases.length} aliases` : ''}</p>
          </div>
          <button class="ex-edit-btn text-muted" data-id="${ex.id}" style="padding: 4px;">${icon('edit', 16)}</button>
        </div>`
            )
            .join('');

    return `
      <div class="page">
        <h1 class="page-title">Settings</h1>
        <p class="subtitle">Vitthuran's fitness data</p>

        <h2 class="section-title">Exercise dataset</h2>
        <div class="card" style="margin-bottom: 2rem;">
          <p style="font-size: 0.875rem; margin: 0 0 0.75rem;">
            If the app's starter exercise list has been updated (e.g. new cardio exercises added), sync to pull in anything new without affecting your existing exercises or aliases.
          </p>
          <button id="sync-seed-btn" class="btn btn-surface" style="margin-bottom: 0.75rem;">
            ${icon('download', 18)} Sync new starter exercises
          </button>
          ${syncStatus ? `<p style="font-size: 0.8rem; margin: 0 0 0.75rem;" class="text-accent">${escapeHtml(syncStatus)}</p>` : ''}

          <p style="font-size: 0.875rem; margin: 0 0 0.75rem;">
            Or pull in the full public-domain exercise dataset (~800 exercises) to extend your library beyond the starter set. Body-part categorisation is a best-effort mapping — correct mismatches below as you find them.
          </p>
          <button id="import-dataset-btn" class="btn btn-surface">
            ${icon('download', 18)} Import full exercise dataset
          </button>
          ${importStatus ? `<p style="font-size: 0.8rem; margin-top: 0.75rem;" class="${importStatus.error ? 'text-intensity' : 'text-accent'}">${escapeHtml(importStatus.message)}</p>` : ''}
        </div>

        <h2 class="section-title">Garmin data</h2>
        <div class="card" style="margin-bottom: 2rem;">
          <p style="font-size: 0.875rem; margin: 0 0 0.75rem;">
            Export your activity data from Garmin Connect (web → Activities → Export CSV) and upload it here. This only adds supplementary context like resting heart rate and sleep — it never changes your logged sets.
          </p>
          <input type="file" id="garmin-file-input" accept=".csv" style="display: none;" />
          <button id="garmin-upload-btn" class="btn btn-accent">${icon('upload', 18)} Upload Garmin CSV</button>
          ${
            garminStatus
              ? `<div style="margin-top: 0.75rem; font-size: 0.875rem;">
                  ${garminStatus.loading ? '<p class="text-muted">Uploading…</p>' : ''}
                  ${
                    garminStatus.result
                      ? `<p>Imported ${garminStatus.result.rows_imported} rows${garminStatus.result.date_range_start ? ` (${garminStatus.result.date_range_start} to ${garminStatus.result.date_range_end})` : ''}.</p>
                         ${garminStatus.result.warnings.map((w) => `<p style="color: #facc15; font-size: 0.75rem;">${escapeHtml(w)}</p>`).join('')}`
                      : ''
                  }
                  ${garminStatus.error ? `<p class="text-intensity">${escapeHtml(garminStatus.error)}</p>` : ''}
                </div>`
              : ''
          }
        </div>

        <h2 class="section-title">Export your data</h2>
        <button id="export-csv-btn" class="btn btn-surface" style="margin-bottom: 2rem;">${icon('download', 18)} Download all data as CSV</button>

        <div class="flex-between" style="margin-bottom: 0.75rem;">
          <h2 class="section-title" style="margin: 0;">Exercise library</h2>
          <button id="add-exercise-btn" class="text-accent" style="font-size: 0.875rem; font-weight: 600; display: flex; align-items: center; gap: 4px;">
            ${icon('plus', 16)} Add
          </button>
        </div>

        <input
          type="text"
          id="library-search-input"
          value="${escapeHtml(libraryFilterQuery)}"
          placeholder="Search ${exercises.length} exercises…"
          style="margin-bottom: 0.75rem;"
        />
        ${
          libraryFilterQuery
            ? `<p class="text-muted" style="font-size: 0.75rem; margin: 0 0 0.75rem;">${filteredExercises.length} match${filteredExercises.length === 1 ? '' : 'es'}</p>`
            : ''
        }

        ${showAddExercise ? renderExerciseForm(null) : ''}
        ${editingExerciseId ? renderExerciseForm({ ...exercises.find((e) => e.id === editingExerciseId), formId: 'edit' }) : ''}

        ${exerciseRows}

        ${renderPronunciationTraining()}

        <h2 class="section-title" style="margin-top: 2rem;">Data</h2>
        <button id="reset-data-btn" class="btn btn-muted" style="color: var(--intensity);">Clear all local data</button>
        <p class="text-muted" style="font-size: 0.75rem; margin-top: 0.5rem;">
          This deletes everything stored in this browser. Export a CSV backup first if you want to keep your history.
        </p>
      </div>
    `;
  }

  function rerender() {
    document.getElementById('app').innerHTML = renderApp();
    wireUpEvents();
  }

  async function handleSaveExercise(formId, editingId) {
    const name = document.getElementById(`ex-form-name-${formId}`)?.value.trim();
    const bodyPart = document.getElementById(`ex-form-bodypart-${formId}`)?.value.trim();
    const aliasesRaw = document.getElementById(`ex-form-aliases-${formId}`)?.value || '';
    const equipment = document.getElementById(`ex-form-equipment-${formId}`)?.value.trim();
    const isDumbbellEquipment = equipment && /dumbbell/i.test(equipment);
    const dumbbellDoubleChecked = document.getElementById(`ex-form-dumbbell-double-${formId}`)?.checked;

    if (!name || !bodyPart) return;

    const data = {
      canonical_name: name,
      body_part: bodyPart,
      aliases: aliasesRaw.split(',').map((a) => a.trim()).filter(Boolean),
      equipment: equipment || null,
      // Only meaningful for dumbbell equipment; defaults to 2 (per
      // hand) whenever the checkbox isn't shown/unchecked state isn't
      // applicable, so non-dumbbell exercises are unaffected.
      dumbbell_count: isDumbbellEquipment ? (dumbbellDoubleChecked ? 2 : 1) : undefined,
    };

    if (editingId) {
      await updateExercise(Number(editingId), data);
    } else {
      await createExercise(data);
    }

    exercises = await listExercises();
    showAddExercise = false;
    editingExerciseId = null;
    rerender();
  }

  function wireUpEvents() {
    document.getElementById('library-search-input')?.addEventListener('input', (e) => {
      libraryFilterQuery = e.target.value;
      rerender();
      const freshInput = document.getElementById('library-search-input');
      if (freshInput) {
        freshInput.focus();
        freshInput.setSelectionRange(libraryFilterQuery.length, libraryFilterQuery.length);
      }
    });

    document.getElementById('add-exercise-btn')?.addEventListener('click', () => {
      showAddExercise = true;
      editingExerciseId = null;
      rerender();
    });

    document.querySelectorAll('.ex-edit-btn').forEach((el) => {
      el.addEventListener('click', () => {
        editingExerciseId = Number(el.dataset.id);
        showAddExercise = false;
        rerender();
      });
    });

    document.querySelectorAll('.ex-form-cancel').forEach((el) => {
      el.addEventListener('click', () => {
        showAddExercise = false;
        editingExerciseId = null;
        rerender();
      });
    });

    document.querySelectorAll('.ex-form-save').forEach((el) => {
      el.addEventListener('click', () => {
        handleSaveExercise(el.dataset.formId, el.dataset.editingId);
      });
    });

    // Show/hide the per-hand-weight checkbox live as the equipment
    // field changes, so it only appears when actually relevant rather
    // than always being visible regardless of equipment type.
    document.querySelectorAll('[id^="ex-form-equipment-"]').forEach((el) => {
      el.addEventListener('input', () => {
        const formId = el.id.replace('ex-form-equipment-', '');
        const row = document.getElementById(`ex-form-dumbbell-row-${formId}`);
        if (row) {
          row.style.display = /dumbbell/i.test(el.value) ? 'block' : 'none';
        }
      });
    });

    document.getElementById('export-csv-btn')?.addEventListener('click', async () => {
      const csv = await exportCsv();
      downloadCsv(csv, 'fitness_export.csv');
    });

    document.getElementById('garmin-upload-btn')?.addEventListener('click', () => {
      document.getElementById('garmin-file-input')?.click();
    });

    document.getElementById('garmin-file-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      garminStatus = { loading: true };
      rerender();
      try {
        const text = await file.text();
        const result = await importGarminCsv(file.name, text);
        garminStatus = { loading: false, result };
      } catch (err) {
        garminStatus = { loading: false, error: 'Upload failed. Check the file format.' };
      }
      rerender();
    });

    document.getElementById('sync-seed-btn')?.addEventListener('click', async () => {
      const result = await syncNewSeedExercises(EXERCISE_SEED);
      syncStatus =
        result.added > 0
          ? `Added ${result.added} new exercise${result.added === 1 ? '' : 's'}.`
          : 'Already up to date — nothing new to add.';
      exercises = await listExercises();
      rerender();
    });

    document.getElementById('import-dataset-btn')?.addEventListener('click', async () => {
      importStatus = { message: 'Fetching dataset…' };
      rerender();
      try {
        const result = await importFullExerciseDataset();
        importStatus = {
          message: `Added ${result.added} new exercises (${result.skipped} already in your library).`,
        };
      } catch (err) {
        importStatus = {
          error: true,
          message: 'Could not fetch the dataset — check your internet connection and try again.',
        };
      }
      exercises = await listExercises();
      rerender();
    });

    document.getElementById('reset-data-btn')?.addEventListener('click', async () => {
      if (!window.confirm('This will permanently delete all your logged sessions, sets, and Garmin data from this browser. Continue?')) {
        return;
      }
      await clearAllData();
      window.location.reload();
    });

    // ---------- Pronunciation training events ----------
    document.getElementById('training-exercise-input')?.addEventListener('input', (e) => {
      trainingSearchQuery = e.target.value;
      trainingDropdownOpen = true;
      // Switching the search query invalidates whatever was last
      // heard/selected, since it no longer corresponds to what's
      // being typed now — avoids a stale transcript sticking around
      // attached to the wrong exercise.
      trainingTranscript = null;
      trainingError = null;
      trainingSavedMessage = null;
      rerender();
      const freshInput = document.getElementById('training-exercise-input');
      if (freshInput) {
        freshInput.focus();
        freshInput.setSelectionRange(trainingSearchQuery.length, trainingSearchQuery.length);
      }
    });

    document.querySelectorAll('#training-exercise-dropdown .exercise-search-result').forEach((el) => {
      el.addEventListener('click', () => {
        trainingSelectedExerciseId = Number(el.dataset.exerciseId);
        trainingSearchQuery = el.dataset.exerciseName;
        trainingDropdownOpen = false;
        trainingTranscript = null;
        trainingError = null;
        trainingSavedMessage = null;
        rerender();
      });
    });

    document.getElementById('training-record-btn')?.addEventListener('click', () => {
      const alreadyListening = trainingIsListening;

      if (alreadyListening) {
        activeVoiceCapture?.stop();
        return;
      }

      trainingTranscript = null;
      trainingError = null;
      trainingSavedMessage = null;

      const capture = captureOneUtterance({
        onListeningChange: (listening) => {
          trainingIsListening = listening;
          rerender();
        },
      });
      activeVoiceCapture = capture;

      capture.promise
        .then((transcript) => {
          trainingTranscript = transcript;
          rerender();
        })
        .catch((err) => {
          trainingError = err.message === 'No speech detected' ? "Didn't catch that — try again." : 'Voice capture failed — try again.';
          rerender();
        });
    });

    document.getElementById('training-save-alias-btn')?.addEventListener('click', async () => {
      if (!trainingSelectedExerciseId || !trainingTranscript) return;
      await addAliasToExercise(trainingSelectedExerciseId, trainingTranscript);
      exercises = await listExercises();
      trainingSavedMessage = `Saved "${trainingTranscript}" as a new alias.`;
      trainingTranscript = null;
      rerender();
    });
  }

  return {
    html: renderApp(),
    afterRender: wireUpEvents,
  };
}

/**
 * Fetches the full public-domain exercise dataset client-side and
 * merges it into IndexedDB, skipping anything already present by
 * canonical name. Replaces the Python import script from the
 * server-backed version — same source, same approach.
 */
async function importFullExerciseDataset() {
  const SOURCE_URL =
    'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  const rawExercises = await response.json();

  const existing = await listExercises();
  const existingNames = new Set(existing.map((e) => e.canonical_name.toLowerCase()));

  let added = 0;
  let skipped = 0;

  for (const raw of rawExercises) {
    const name = (raw.name || '').trim();
    if (!name || existingNames.has(name.toLowerCase())) {
      skipped++;
      continue;
    }

    const primaryMuscle = ((raw.primaryMuscles && raw.primaryMuscles[0]) || '').toLowerCase();
    const bodyPart = MUSCLE_TO_BODY_PART[primaryMuscle] || 'Other';

    await createExercise({
      canonical_name: name,
      body_part: bodyPart,
      equipment: raw.equipment || null,
      aliases: [name.toLowerCase()],
    });

    existingNames.add(name.toLowerCase());
    added++;
  }

  return { added, skipped };
}
