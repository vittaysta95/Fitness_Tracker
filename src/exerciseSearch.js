/**
 * Reusable exercise search/autocomplete UI fragment. Renders a text
 * input plus a live-filtered dropdown of matching exercises, used in
 * both the Log page's manual entry and the Settings page's alias-
 * training flow (see pronunciationTraining.js) — anywhere that needs
 * "type a few letters, tap the right exercise" instead of typing
 * blind and hoping the fuzzy matcher resolves it correctly.
 *
 * This is intentionally just markup + a filter function, not a full
 * component with its own state — the calling page owns the actual
 * selected-exercise state and re-renders itself, consistent with how
 * every other page in this app works (no component framework).
 */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

/**
 * Returns exercises whose canonical name OR any alias contains the
 * query as a substring (case-insensitive), sorted so matches on the
 * canonical name rank above alias-only matches, and shorter names
 * rank above longer ones (closer to an exact match).
 *
 * `maxResults` defaults to 8 for autocomplete-dropdown contexts, where
 * an unbounded list would overwhelm a small screen — pass a higher
 * value (or Infinity) when filtering a full list for browsing, like
 * Settings' exercise library search, where showing everything that
 * matches is the actual goal rather than a short suggestion list.
 */
export function filterExercisesForSearch(exercises, query, maxResults = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored = [];
  for (const ex of exercises) {
    const nameMatch = ex.canonical_name.toLowerCase().includes(q);
    const aliasMatch = (ex.aliases || []).some((a) => a.toLowerCase().includes(q));
    if (!nameMatch && !aliasMatch) continue;

    scored.push({
      exercise: ex,
      rank: nameMatch ? 0 : 1,
      length: ex.canonical_name.length,
    });
  }

  scored.sort((a, b) => a.rank - b.rank || a.length - b.length);
  return scored.slice(0, maxResults).map((s) => s.exercise);
}

/**
 * Renders the search input + dropdown markup. `inputId` and
 * `dropdownId` let multiple instances of this component coexist on
 * one page without colliding (e.g. if ever needed twice at once).
 */
export function renderExerciseSearchInput({
  inputId,
  dropdownId,
  value = '',
  placeholder = 'Type an exercise name…',
  matches = [],
  showDropdown = false,
}) {
  const dropdownHtml =
    showDropdown && matches.length > 0
      ? `
      <div id="${dropdownId}" class="card" style="position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 20; padding: 4px; max-height: 240px; overflow-y: auto;">
        ${matches
          .map(
            (ex) => `
          <button class="exercise-search-result" data-exercise-id="${ex.id}" data-exercise-name="${escapeHtml(ex.canonical_name)}" style="width: 100%; text-align: left; padding: 10px 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.9rem;">${escapeHtml(ex.canonical_name)}</span>
            <span class="text-muted" style="font-size: 0.7rem;">${escapeHtml(ex.body_part)}</span>
          </button>`
          )
          .join('')}
      </div>`
      : showDropdown
      ? `<div id="${dropdownId}" class="card" style="position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 20; padding: 12px;">
          <p class="text-muted" style="font-size: 0.8rem; margin: 0;">No matches — check spelling or add it in Settings.</p>
        </div>`
      : '';

  return `
    <div style="position: relative;">
      <input
        type="text"
        id="${inputId}"
        value="${escapeHtml(value)}"
        placeholder="${escapeHtml(placeholder)}"
        autocomplete="off"
        style="width: 100%; background: var(--surface-high); color: var(--white); border-radius: 12px; padding: 0.75rem; font-size: 1rem; border: none;"
      />
      ${dropdownHtml}
    </div>
  `;
}
