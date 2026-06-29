import { listExercises } from '../db.js';
import { listSessions, getSession } from '../db.js';
import { computeExerciseTrend } from '../trends.js';
import { formatLocalDate } from '../dateUtils.js';

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

  // Show at most ~5 x-axis labels to avoid overlap on small screens
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

export async function renderTrendsPage() {
  const exercises = await listExercises();
  const allSessions = await listSessions();
  // Need full set detail across all sessions for trend computation
  const allSets = [];
  for (const s of allSessions) {
    const full = await getSession(s.id);
    allSets.push(...full.sets);
  }

  let selectedExerciseId = exercises[0]?.id ?? null;
  let metric = 'max_weight';

  function renderApp() {
    const trend = selectedExerciseId
      ? computeExerciseTrend(selectedExerciseId, allSessions, allSets, exercises)
      : null;

    const metricLabels = trend?.is_cardio ? CARDIO_METRIC_LABELS : STRENGTH_METRIC_LABELS;
    // If the current metric doesn't apply to this exercise's category
    // (e.g. switching from a strength exercise showing "max_weight" to
    // a cardio one), fall back to that category's first metric so the
    // chart never renders against an undefined key.
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
      <div class="page">
        <h1 class="page-title" style="margin-bottom: 1.5rem;">Trends</h1>

        <div class="field" style="margin-bottom: 1rem;">
          <select id="exercise-select">${exerciseOptions}</select>
        </div>

        <div class="chip-row">${metricChips}</div>

        ${chartHtml}
      </div>
    `;
  }

  function rerender() {
    document.getElementById('app').innerHTML = renderApp();
    wireUpEvents();
  }

  function wireUpEvents() {
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
