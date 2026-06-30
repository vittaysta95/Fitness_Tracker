import { icon } from '../icons.js';
import { navigate, getSearchParams } from '../router.js';
import {
  listSessions,
  createSession,
  deleteSession,
  getSession,
  formatSetDisplay,
  listExercises,
} from '../db.js';
import { computeExerciseTrend } from '../trends.js';
import { todayLocalIso, formatLocalDate } from '../dateUtils.js';

const STRENGTH_METRIC_LABELS = {
  max_weight: 'Max weight (kg)',
  max_reps: 'Max reps',
  total_volume: 'Total volume (kg)',
};

const CARDIO_METRIC_LABELS = {
  distance_km: 'Distance (km)',
  duration_min: 'Duration (min)',
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function formatSessionDate(isoDate) {
  const today = todayLocalIso();
  if (isoDate === today) return 'Today';
  return formatLocalDate(isoDate, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Renders a simple line chart as an SVG string — no chart library available without a bundler. */
function renderLineChartSvg(points, metricKey) {
  const width = 320;
  const height = 200;
  const paddingLeft = 36;
  const paddingBottom = 24;
  const paddingTop = 12;
  const paddingRight = 8;

  const values = points.map((p) => p[metricKey]);
  const maxValue = Math.max(...values, 1);
  const minValue = 0; // always start y-axis at 0 for honest scale

  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const xStep = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = paddingLeft + i * xStep;
    const y =
      paddingTop + plotHeight - ((p[metricKey] - minValue) / (maxValue - minValue || 1)) * plotHeight;
    return { x, y, label: p.date, value: p[metricKey] };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((frac) => {
      const y = paddingTop + plotHeight * (1 - frac);
      return `<line x1="${paddingLeft}" y1="${y.toFixed(1)}" x2="${width - paddingRight}" y2="${y.toFixed(1)}" stroke="#272B33" stroke-width="1" />`;
    })
    .join('');

  const yLabels = [0, 0.5, 1]
    .map((frac) => {
      const y = paddingTop + plotHeight * (1 - frac);
      const val = Math.round(maxValue * frac);
      return `<text x="${paddingLeft - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#9BA1AC">${val}</text>`;
    })
    .join('');

  const labelStep = Math.max(1, Math.ceil(coords.length / 5));
  const xLabels = coords
    .filter((_, i) => i % labelStep === 0 || i === coords.length - 1)
    .map(
      (c) =>
        `<text x="${c.x.toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="10" fill="#9BA1AC">${formatLocalDate(c.label, { day: 'numeric', month: 'short' })}</text>`
    )
    .join('');

  const dots = coords
    .map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" fill="#C8FF4D" />`)
    .join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" style="display: block;">
      ${gridLines}
      ${yLabels}
      <path d="${linePath}" fill="none" stroke="#C8FF4D" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
      ${xLabels}
    </svg>
  `;
}

export async function renderHistoryTrendsPage() {
  const params = getSearchParams();
  // The combined page remembers which sub-view is active via a query
  // param, so deep links (e.g. /history?view=trends) and the old
  // standalone /trends path both land on the right toggle state.
  let activeView = params.get('view') === 'trends' ? 'trends' : 'history';

  // ---------- History view state ----------
  let showBackfill = params.get('backfill') === 'true';
  let backfillDate = todayLocalIso();
  let backfillNotes = '';
  let expandedId = null;
  let expandedDetail = null;
  let sessions = await listSessions();

  // ---------- Trends view state ----------
  const exercises = await listExercises();
  const allSessions = await listSessions();
  const allSets = [];
  for (const s of allSessions) {
    const full = await getSession(s.id);
    allSets.push(...full.sets);
  }
  let selectedExerciseId = exercises[0]?.id ?? null;
  let metric = 'max_weight';

  function renderExpandedSets(detail) {
    if (detail.sets.length === 0) {
      return `
        <p class="text-muted" style="font-size: 0.875rem; margin: 0.75rem 0 0.5rem;">No sets logged for this session yet.</p>
        <button class="add-sets-link text-accent" data-session-id="${detail.id}" data-date="${detail.date}" style="font-size: 0.875rem; font-weight: 600;">
          Add sets for this date →
        </button>`;
    }

    const rows = detail.sets
      .map(
        (set) => `
        <div class="flex-between" style="padding: 6px 0;">
          <span style="font-size: 0.875rem;">
            ${escapeHtml(set.exercise?.canonical_name ?? 'Unknown')}
            ${set.is_dropset ? '<span class="badge-dropset">DROP</span>' : ''}
          </span>
          <span class="text-muted" style="font-size: 0.75rem;">
            ${formatSetDisplay(set)}
          </span>
        </div>`
      )
      .join('');

    return `
      ${rows}
      <button class="add-sets-link text-accent" data-session-id="${detail.id}" data-date="${detail.date}" style="font-size: 0.875rem; font-weight: 600; padding-top: 4px;">
        Add more sets →
      </button>`;
  }

  function renderHistoryView() {
    const backfillFormHtml = showBackfill
      ? `
      <div class="card" style="margin-bottom: 1.5rem;">
        <h2 class="section-title">Add a past session</h2>
        <div class="field">
          <label class="field-label">Date</label>
          <input type="date" id="backfill-date-input" value="${backfillDate}" max="${todayLocalIso()}" />
        </div>
        <div class="field">
          <label class="field-label">Notes (optional)</label>
          <input type="text" id="backfill-notes-input" placeholder="e.g. push day" value="${escapeHtml(backfillNotes)}" />
        </div>
        <div class="btn-row">
          <button id="backfill-cancel-btn" class="btn btn-muted">Cancel</button>
          <button id="backfill-create-btn" class="btn btn-accent">Create &amp; add sets</button>
        </div>
      </div>`
      : '';

    const sessionsHtml =
      sessions.length === 0
        ? `<div class="empty-state">No sessions logged yet.</div>`
        : sessions
            .map((s) => {
              const isExpanded = expandedId === s.id;
              return `
            <div class="card" style="padding: 0; overflow: hidden; margin-bottom: 0.5rem;">
              <div class="flex-between" style="padding: 0.875rem 1rem;">
                <button class="session-row-toggle" data-session-id="${s.id}" style="flex: 1; text-align: left; display: flex; flex-direction: column; align-items: flex-start;">
                  <p class="list-row-title">${formatSessionDate(s.date)}</p>
                  <p class="list-row-subtitle">
                    ${s.total_sets} sets · ${Math.round(s.total_volume).toLocaleString()} kg
                    ${s.notes ? ` · ${escapeHtml(s.notes)}` : ''}
                  </p>
                </button>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <button class="session-delete-btn text-muted" data-session-id="${s.id}" style="padding: 4px;">${icon('trash', 16)}</button>
                  <button class="session-row-toggle text-muted" data-session-id="${s.id}" style="padding: 4px; transform: rotate(${isExpanded ? 90 : 0}deg); transition: transform 0.15s;">${icon('chevronRight', 18)}</button>
                </div>
              </div>
              ${
                isExpanded && expandedDetail
                  ? `<div style="padding: 0 1rem 1rem; border-top: 1px solid var(--surface-high);">
                      ${renderExpandedSets(expandedDetail)}
                    </div>`
                  : ''
              }
            </div>`;
            })
            .join('');

    return `
      <div class="flex-between" style="margin-bottom: 1rem;">
        <span class="text-muted" style="font-size: 0.8rem;">${sessions.length} session${sessions.length === 1 ? '' : 's'} logged</span>
        <button id="show-backfill-btn" class="chip active" style="display: flex; align-items: center; gap: 4px;">
          ${icon('plus', 16)} Backfill
        </button>
      </div>
      ${backfillFormHtml}
      ${sessionsHtml}
    `;
  }

  function renderTrendsView() {
    const trend = selectedExerciseId
      ? computeExerciseTrend(selectedExerciseId, allSessions, allSets, exercises)
      : null;

    const metricLabels = trend?.is_cardio ? CARDIO_METRIC_LABELS : STRENGTH_METRIC_LABELS;
    if (!(metric in metricLabels)) {
      metric = Object.keys(metricLabels)[0];
    }

    const exerciseOptions = exercises
      .map(
        (ex) =>
          `<option value="${ex.id}" ${ex.id === selectedExerciseId ? 'selected' : ''}>${escapeHtml(ex.canonical_name)}</option>`
      )
      .join('');

    const metricChips = Object.entries(metricLabels)
      .map(
        ([key, label]) =>
          `<button class="chip metric-chip ${metric === key ? 'active' : ''}" data-metric="${key}">${label}</button>`
      )
      .join('');

    const chartHtml =
      !trend || trend.points.length === 0
        ? `<div class="empty-state">No history yet for ${escapeHtml(trend?.exercise_name || 'this exercise')}. Log a few sets to see trends here.</div>`
        : `
          <div class="card">
            <h2 class="font-display" style="font-size: 1.1rem; margin: 0 0 2px;">${escapeHtml(trend.exercise_name)}</h2>
            <p class="text-muted" style="font-size: 0.75rem; margin: 0 0 1rem;">${metricLabels[metric]} over time</p>
            ${renderLineChartSvg(trend.points, metric)}
          </div>`;

    return `
      <div class="field" style="margin-bottom: 1rem;">
        <select id="exercise-select">${exerciseOptions}</select>
      </div>
      <div class="chip-row">${metricChips}</div>
      ${chartHtml}
    `;
  }

  function renderApp() {
    return `
      <div class="page">
        <h1 class="page-title" style="margin-bottom: 1rem;">History</h1>

        <div class="chip-row" style="margin-bottom: 1.5rem;">
          <button class="chip view-toggle ${activeView === 'history' ? 'active' : ''}" data-view="history">List</button>
          <button class="chip view-toggle ${activeView === 'trends' ? 'active' : ''}" data-view="trends">Trends</button>
        </div>

        ${activeView === 'history' ? renderHistoryView() : renderTrendsView()}
      </div>
    `;
  }

  async function refreshSessions() {
    sessions = await listSessions();
  }

  function rerender() {
    document.getElementById('app').innerHTML = renderApp();
    wireUpEvents();
  }

  function wireUpEvents() {
    document.querySelectorAll('.view-toggle').forEach((el) => {
      el.addEventListener('click', () => {
        activeView = el.dataset.view;
        rerender();
      });
    });

    // ---------- History view events ----------
    document.getElementById('show-backfill-btn')?.addEventListener('click', () => {
      showBackfill = true;
      rerender();
    });

    document.getElementById('backfill-cancel-btn')?.addEventListener('click', () => {
      showBackfill = false;
      rerender();
    });

    document.getElementById('backfill-date-input')?.addEventListener('change', (e) => {
      backfillDate = e.target.value;
    });

    document.getElementById('backfill-notes-input')?.addEventListener('input', (e) => {
      backfillNotes = e.target.value;
    });

    document.getElementById('backfill-create-btn')?.addEventListener('click', async () => {
      const created = await createSession({
        date: backfillDate,
        notes: backfillNotes || null,
      });
      navigate(`/log?session_id=${created.id}&date=${backfillDate}`);
    });

    document.querySelectorAll('.session-row-toggle').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = Number(el.dataset.sessionId);
        if (expandedId === id) {
          expandedId = null;
          expandedDetail = null;
        } else {
          expandedId = id;
          expandedDetail = await getSession(id);
        }
        rerender();
      });
    });

    document.querySelectorAll('.session-delete-btn').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = Number(el.dataset.sessionId);
        if (!window.confirm('Delete this session and all its sets?')) return;
        await deleteSession(id);
        if (expandedId === id) {
          expandedId = null;
          expandedDetail = null;
        }
        await refreshSessions();
        rerender();
      });
    });

    document.querySelectorAll('.add-sets-link').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.sessionId;
        const date = el.dataset.date;
        navigate(`/log?session_id=${id}&date=${date}`);
      });
    });

    // ---------- Trends view events ----------
    document.getElementById('exercise-select')?.addEventListener('change', (e) => {
      selectedExerciseId = Number(e.target.value);
      rerender();
    });

    document.querySelectorAll('.metric-chip').forEach((el) => {
      el.addEventListener('click', () => {
        metric = el.dataset.metric;
        rerender();
      });
    });
  }

  return {
    html: renderApp(),
    afterRender: wireUpEvents,
  };
}
