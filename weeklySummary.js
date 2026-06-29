import { icon } from '../icons.js';
import { navigate, getSearchParams } from '../router.js';
import { getWeeklySummary } from '../trends.js';
import { parseLocalDate, formatLocalDate, todayLocalIso } from '../dateUtils.js';

function formatWeekRange(start, end) {
  const opts = { day: 'numeric', month: 'short' };
  return `${formatLocalDate(start, opts)} – ${formatLocalDate(end, opts)}`;
}

function isDateInWeek(isoDate, weekStart, weekEnd) {
  return isoDate >= weekStart && isoDate <= weekEnd;
}

function buildShareText(summary) {
  const lines = [
    `Weekly training summary (${formatWeekRange(summary.week_start, summary.week_end)})`,
    '',
    `Sessions: ${summary.total_sessions}`,
    `Hours trained: ${summary.total_hours_trained}`,
    `Total volume: ${Math.round(summary.total_volume).toLocaleString()} kg`,
  ];

  if (summary.total_distance_km || summary.total_cardio_minutes) {
    lines.push(`Cardio: ${summary.total_distance_km}km / ${summary.total_cardio_minutes}min`);
  }

  if (summary.volume_by_body_part.length > 0) {
    lines.push('', 'Volume by body part:');
    [...summary.volume_by_body_part]
      .sort((a, b) => b.total_volume - a.total_volume)
      .forEach((bp) => {
        lines.push(`  ${bp.body_part}: ${Math.round(bp.total_volume).toLocaleString()} kg`);
      });
  }

  if (summary.top_lifts.length > 0) {
    lines.push('', 'Top lifts:');
    summary.top_lifts.forEach((lift) => {
      const weightLabel = lift.is_dumbbell ? `${lift.weight}kg/hand` : `${lift.weight}kg`;
      lines.push(`  ${lift.exercise_name}: ${weightLabel} × ${lift.reps}`);
    });
  }

  return lines.join('\n');
}

export async function renderWeeklySummaryPage() {
  const params = getSearchParams();
  let weekParam = params.get('week');
  let summary = await getWeeklySummary(weekParam || undefined);
  let copied = false;

  function renderApp() {
    const isCurrentWeek = isDateInWeek(todayLocalIso(), summary.week_start, summary.week_end);

    const bodyPartHtml =
      summary.volume_by_body_part.length > 0
        ? `
        <div class="card">
          <h2 class="section-title">Volume by body part</h2>
          ${[...summary.volume_by_body_part]
            .sort((a, b) => b.total_volume - a.total_volume)
            .map(
              (bp) => `
            <div class="flex-between" style="margin-bottom: 8px;">
              <span class="list-row-title">${bp.body_part}</span>
              <span class="text-muted" style="font-size: 0.875rem;">${Math.round(bp.total_volume).toLocaleString()} kg · ${bp.total_sets} sets</span>
            </div>`
            )
            .join('')}
        </div>`
        : '';

    const topLiftsHtml =
      summary.top_lifts.length > 0
        ? `
        <div class="card">
          <h2 class="section-title">Top lifts this week</h2>
          ${summary.top_lifts
            .map(
              (lift) => `
            <div class="flex-between" style="margin-bottom: 8px;">
              <span class="list-row-title">${lift.exercise_name}</span>
              <span class="text-accent font-display" style="font-size: 0.875rem;">${lift.weight}kg${lift.is_dumbbell ? '/hand' : ''} × ${lift.reps}</span>
            </div>`
            )
            .join('')}
        </div>`
        : '';

    const emptyHtml =
      summary.total_sessions === 0
        ? `<div class="empty-state" style="margin-bottom: 1.5rem;">No sessions logged this week.</div>`
        : '';

    return `
      <div class="page">
        <button id="back-to-today" class="back-link">${icon('chevronLeft', 16)} Back to today</button>

        <div class="week-nav">
          <button id="prev-week-btn">${icon('chevronLeft', 20)}</button>
          <div style="text-align: center;">
            <h1 class="font-display" style="font-size: 1.25rem; margin: 0;">${formatWeekRange(summary.week_start, summary.week_end)}</h1>
            ${isCurrentWeek ? '<p class="text-accent" style="font-size: 0.75rem; font-weight: 600; margin: 4px 0 0;">This week</p>' : ''}
          </div>
          <button id="next-week-btn" ${isCurrentWeek ? 'disabled' : ''}>${icon('chevronRight', 20)}</button>
        </div>

        <div class="card" style="margin-bottom: 1rem;">
          <div class="stat-grid" style="margin-bottom: 0;">
            <div style="text-align: center;">
              <p class="font-display" style="font-size: 1.5rem; margin: 0;">${summary.total_sessions}</p>
              <p class="stat-label" style="margin-top: 4px;">Sessions</p>
            </div>
            <div style="text-align: center;">
              <p class="font-display" style="font-size: 1.5rem; margin: 0;">${summary.total_hours_trained}</p>
              <p class="stat-label" style="margin-top: 4px;">Hours</p>
            </div>
            <div style="text-align: center;">
              <p class="font-display" style="font-size: 1.5rem; margin: 0;">${Math.round(summary.total_volume).toLocaleString()}<span class="stat-unit" style="font-size: 0.85rem;"> kg</span></p>
              <p class="stat-label" style="margin-top: 4px;">Volume</p>
            </div>
          </div>
        </div>

        ${
          (summary.total_distance_km || summary.total_cardio_minutes)
            ? `
        <div class="card" style="margin-bottom: 1rem;">
          <h2 class="section-title">Cardio this week</h2>
          <div class="stat-grid" style="margin-bottom: 0; grid-template-columns: 1fr 1fr;">
            <div style="text-align: center;">
              <p class="font-display" style="font-size: 1.5rem; margin: 0;">${summary.total_distance_km}<span class="stat-unit" style="font-size: 0.85rem;"> km</span></p>
              <p class="stat-label" style="margin-top: 4px;">Distance</p>
            </div>
            <div style="text-align: center;">
              <p class="font-display" style="font-size: 1.5rem; margin: 0;">${summary.total_cardio_minutes}<span class="stat-unit" style="font-size: 0.85rem;"> min</span></p>
              <p class="stat-label" style="margin-top: 4px;">Time</p>
            </div>
          </div>
        </div>`
            : ''
        }

        ${bodyPartHtml}
        ${topLiftsHtml}
        ${emptyHtml}

        <div class="btn-row">
          <button id="share-btn" class="btn btn-accent">${icon('share', 18)} Share</button>
          <button id="copy-btn" class="btn btn-surface" style="flex: 0 0 56px;">${copied ? icon('check', 18) : icon('copy', 18)}</button>
        </div>
      </div>
    `;
  }

  async function goToWeek(direction) {
    const reference = parseLocalDate(summary.week_start);
    reference.setDate(reference.getDate() + direction * 7);
    const year = reference.getFullYear();
    const month = String(reference.getMonth() + 1).padStart(2, '0');
    const day = String(reference.getDate()).padStart(2, '0');
    const newWeekParam = `${year}-${month}-${day}`;
    navigate(`/weekly-summary?week=${newWeekParam}`);
  }

  function rerender() {
    document.getElementById('app').innerHTML = renderApp();
    wireUpEvents();
  }

  function wireUpEvents() {
    document.getElementById('back-to-today')?.addEventListener('click', () => navigate('/'));
    document.getElementById('prev-week-btn')?.addEventListener('click', () => goToWeek(-1));
    document.getElementById('next-week-btn')?.addEventListener('click', () => goToWeek(1));

    document.getElementById('share-btn')?.addEventListener('click', async () => {
      const shareText = buildShareText(summary);
      if (navigator.share) {
        try {
          await navigator.share({ title: 'My weekly training summary', text: shareText });
        } catch (e) {
          // user cancelled — not an error worth surfacing
        }
      } else {
        await navigator.clipboard.writeText(shareText);
        copied = true;
        rerender();
        setTimeout(() => {
          copied = false;
          rerender();
        }, 2000);
      }
    });

    document.getElementById('copy-btn')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(buildShareText(summary));
      copied = true;
      rerender();
      setTimeout(() => {
        copied = false;
        rerender();
      }, 2000);
    });
  }

  return {
    html: renderApp(),
    afterRender: wireUpEvents,
  };
}
