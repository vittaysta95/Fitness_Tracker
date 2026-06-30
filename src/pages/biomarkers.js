import { icon } from '../icons.js';
import {
  upsertBodyWeight,
  listBodyWeightLogs,
  deleteBodyWeightLog,
  getLatestBodyWeight,
} from '../db.js';
import { exportBodyWeightCsv, downloadCsv } from '../csvExport.js';
import { todayLocalIso, formatLocalDate } from '../dateUtils.js';
import { isVoiceCaptureSupported, captureOneUtterance } from '../voiceCapture.js';
import { normalizeSpokenNumbers, extractWeight } from '../voiceParser.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

/**
 * Same small line-chart renderer pattern used in historyTrends.js,
 * specialised for a single weight series rather than imported, since
 * the data shape (date + weight_kg) is different enough from exercise
 * trend points that sharing the function directly isn't a clean fit.
 */
function renderWeightChartSvg(logs) {
  const width = 320;
  const height = 180;
  const paddingLeft = 40;
  const paddingBottom = 22;
  const paddingTop = 12;
  const paddingRight = 8;

  const values = logs.map((l) => l.weight_kg);
  const maxValue = Math.max(...values) * 1.02;
  const minValue = Math.min(...values) * 0.98;
  const range = maxValue - minValue || 1;

  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const xStep = logs.length > 1 ? plotWidth / (logs.length - 1) : 0;

  const coords = logs.map((l, i) => {
    const x = paddingLeft + i * xStep;
    const y = paddingTop + plotHeight - ((l.weight_kg - minValue) / range) * plotHeight;
    return { x, y, date: l.date, value: l.weight_kg };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

  const yLabels = [0, 0.5, 1]
    .map((frac) => {
      const y = paddingTop + plotHeight * (1 - frac);
      const val = (minValue + range * frac).toFixed(1);
      return `<text x="${paddingLeft - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#9BA1AC">${val}</text>`;
    })
    .join('');

  const labelStep = Math.max(1, Math.ceil(coords.length / 5));
  const xLabels = coords
    .filter((_, i) => i % labelStep === 0 || i === coords.length - 1)
    .map(
      (c) =>
        `<text x="${c.x.toFixed(1)}" y="${height - 4}" text-anchor="middle" font-size="10" fill="#9BA1AC">${formatLocalDate(c.date, { day: 'numeric', month: 'short' })}</text>`
    )
    .join('');

  const dots = coords
    .map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" fill="#C8FF4D" />`)
    .join('');

  const gridLines = [0, 0.5, 1]
    .map((frac) => {
      const y = paddingTop + plotHeight * (1 - frac);
      return `<line x1="${paddingLeft}" y1="${y.toFixed(1)}" x2="${width - paddingRight}" y2="${y.toFixed(1)}" stroke="#272B33" stroke-width="1" />`;
    })
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

export async function renderBiomarkersPage() {
  let logs = await listBodyWeightLogs();
  let latest = await getLatestBodyWeight();
  const today = todayLocalIso();
  let inputDate = today;
  let inputWeight = latest ? String(latest.weight_kg) : '';
  let weightIsListening = false;
  let weightVoiceError = null;
  let activeWeightCapture = null;

  function renderApp() {
    const todayLog = logs.find((l) => l.date === today);

    const chartHtml =
      logs.length === 0
        ? `<div class="empty-state">No weight logged yet. Enter today's weight below to start tracking.</div>`
        : logs.length === 1
        ? `<div class="empty-state">One entry logged — log a few more days to see a trend.</div>`
        : `
          <div class="card">
            <h2 class="section-title" style="margin-bottom: 0.75rem;">Trend</h2>
            ${renderWeightChartSvg(logs)}
          </div>`;

    const historyRows = [...logs]
      .reverse()
      .slice(0, 30)
      .map(
        (l) => `
        <div class="list-row">
          <div>
            <p class="list-row-title">${l.date === today ? 'Today' : formatLocalDate(l.date, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
            ${l.notes ? `<p class="list-row-subtitle">${escapeHtml(l.notes)}</p>` : ''}
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="font-display text-accent" style="font-size: 1rem;">${l.weight_kg} kg</span>
            <button class="weight-delete-btn text-muted" data-id="${l.id}" style="padding: 4px;">${icon('trash', 15)}</button>
          </div>
        </div>`
      )
      .join('');

    return `
      <div class="page">
        <h1 class="page-title">Biomarkers</h1>
        <p class="subtitle">Track your body weight over time.</p>

        <div class="card" style="margin-bottom: 1.5rem;">
          <h2 class="section-title">${todayLog ? "Update today's weight" : "Log today's weight"}</h2>
          <div class="field-row" style="grid-template-columns: 1fr 1fr;">
            <div>
              <label class="field-label">Date</label>
              <input type="date" id="weight-date-input" value="${inputDate}" max="${today}" />
            </div>
            <div>
              <label class="field-label">Weight (kg)</label>
              <div style="display: flex; gap: 6px;">
                <input type="number" inputmode="decimal" step="0.1" id="weight-input" value="${escapeHtml(inputWeight)}" class="font-display" style="font-size: 1.1rem; flex: 1; min-width: 0;" />
                ${
                  isVoiceCaptureSupported()
                    ? `<button id="weight-voice-btn" class="btn ${weightIsListening ? 'btn-surface' : 'btn-accent'}" style="flex: 0 0 44px; width: 44px; padding: 0; border-radius: 12px;" aria-label="${weightIsListening ? 'Stop listening' : 'Say your weight'}">
                        ${weightIsListening ? icon('square', 18) : icon('mic', 18)}
                      </button>`
                    : ''
                }
              </div>
            </div>
          </div>
          ${weightVoiceError ? `<p class="text-intensity" style="font-size: 0.75rem; margin-top: 0.5rem;">${escapeHtml(weightVoiceError)}</p>` : ''}
          <button id="save-weight-btn" class="btn btn-accent" style="margin-top: 0.5rem;">
            ${icon('check', 18)} Save
          </button>
        </div>

        ${chartHtml}

        ${
          logs.length > 0
            ? `
          <div class="flex-between" style="margin: 1.5rem 0 0.75rem;">
            <h2 class="section-title" style="margin: 0;">History</h2>
            <button id="export-weight-csv-btn" class="text-accent" style="font-size: 0.8rem; font-weight: 600; display: flex; align-items: center; gap: 4px;">
              ${icon('download', 14)} Export CSV
            </button>
          </div>
          ${historyRows}`
            : ''
        }
      </div>
    `;
  }

  async function refresh() {
    logs = await listBodyWeightLogs();
    latest = await getLatestBodyWeight();
  }

  function rerender() {
    document.getElementById('app').innerHTML = renderApp();
    wireUpEvents();
  }

  function wireUpEvents() {
    document.getElementById('weight-date-input')?.addEventListener('change', (e) => {
      inputDate = e.target.value;
    });

    document.getElementById('weight-input')?.addEventListener('input', (e) => {
      inputWeight = e.target.value;
    });

    document.getElementById('weight-voice-btn')?.addEventListener('click', () => {
      if (weightIsListening && activeWeightCapture) {
        activeWeightCapture.stop();
        return;
      }

      weightVoiceError = null;
      activeWeightCapture = captureOneUtterance({
        onListeningChange: (listening) => {
          weightIsListening = listening;
          rerender();
        },
      });

      activeWeightCapture.promise
        .then((transcript) => {
          const normalized = normalizeSpokenNumbers(transcript);
          // extractWeight expects a unit word ("kg"/"kilos"/etc) to
          // anchor the match — but someone saying just their weight
          // ("seventy eight point five") naturally won't include one.
          // Fall back to a bare-decimal match on the normalized text
          // when the unit-anchored extraction comes up empty, so
          // "seventy eight point five" still works without forcing
          // the person to say "kilos" every time.
          let weight = extractWeight(normalized);
          if (weight === null) {
            const bareMatch = normalized.match(/(\d+(?:\.\d+)?)/);
            weight = bareMatch ? parseFloat(bareMatch[1]) : null;
          }

          if (weight === null) {
            weightVoiceError = `Didn't catch a number in "${transcript}" — try again.`;
          } else {
            inputWeight = String(weight);
            weightVoiceError = null;
          }
          rerender();
        })
        .catch((err) => {
          weightVoiceError =
            err.message === 'No speech detected' ? "Didn't catch that — try again." : 'Voice capture failed — try again.';
          rerender();
        });
    });

    document.getElementById('save-weight-btn')?.addEventListener('click', async () => {
      const dateEl = document.getElementById('weight-date-input');
      const weightEl = document.getElementById('weight-input');
      const date = dateEl?.value || today;
      const weight = weightEl?.value;
      if (!weight || isNaN(parseFloat(weight))) return;

      await upsertBodyWeight({ date, weight_kg: parseFloat(weight) });
      await refresh();
      rerender();
    });

    document.querySelectorAll('.weight-delete-btn').forEach((el) => {
      el.addEventListener('click', async () => {
        if (!window.confirm('Delete this weight entry?')) return;
        await deleteBodyWeightLog(Number(el.dataset.id));
        await refresh();
        rerender();
      });
    });

    document.getElementById('export-weight-csv-btn')?.addEventListener('click', async () => {
      const csv = await exportBodyWeightCsv();
      downloadCsv(csv, 'body_weight_export.csv');
    });
  }

  return {
    html: renderApp(),
    afterRender: wireUpEvents,
  };
}
