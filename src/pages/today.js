import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { listSessions, getMeta, setMeta, hasLoggedAnything } from '../db.js';
import { getWeeklySummary } from '../trends.js';
import { todayLocalIso } from '../dateUtils.js';
import { exportCsv, downloadCsv } from '../csvExport.js';

const USER_NAME = 'Vitthuran';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function isSunday() {
  return new Date().getDay() === 0;
}

export async function renderTodayPage() {
  const today = todayLocalIso();
  let todaySession = null;
  let weekSummary = null;
  let error = null;
  let lastExportDate = null;

  try {
    const [sessions, summary, lastExport] = await Promise.all([
      listSessions({ startDate: today, endDate: today }),
      getWeeklySummary(),
      getMeta('last_export_date'),
    ]);
    todaySession = sessions[0] || null;
    weekSummary = summary;
    lastExportDate = lastExport;
  } catch (e) {
    error = 'Something went wrong loading your data.';
    console.error(e);
  }

  // "Daily auto-backup" within what browsers actually allow: a true
  // silent share/download on page load is blocked by browser security
  // (the Web Share API requires a real tap — it throws if called
  // without one). This is the closest honest equivalent: a single
  // prominent one-tap prompt that only appears once per day, rather
  // than making the person dig through Settings to find the export
  // button every time. Triggers based on whether ANY data exists yet
  // (not just today's session) since the export backs up everything,
  // and a rest day still deserves a reminder to back up prior days.
  const hasAnyData = await hasLoggedAnything();
  const needsBackupToday = !error && lastExportDate !== today && hasAnyData;

  const sessionSets = todaySession?.total_sets ?? 0;
  const sessionVolume = todaySession?.total_volume ?? 0;
  const weekTarget = weekSummary ? weekSummary.total_volume / 7 : 0;
  const pct = weekTarget > 0 ? Math.min(100, (sessionVolume / weekTarget) * 100) : 0;
  const isOverTarget = weekTarget > 0 && sessionVolume >= weekTarget;

  const bodyPartRows = weekSummary
    ? [...weekSummary.volume_by_body_part]
        .sort((a, b) => b.total_volume - a.total_volume)
        .map(
          (bp) => `
        <div class="flex-between" style="margin-bottom: 8px;">
          <span class="list-row-title">${bp.body_part}</span>
          <span class="text-muted" style="font-size: 0.875rem;">
            ${Math.round(bp.total_volume).toLocaleString()} kg · ${bp.total_sets} sets
          </span>
        </div>`
        )
        .join('')
    : '';

  const html = `
    <div class="page">
      <p class="text-muted" style="font-size: 0.875rem; font-weight: 500;">${getGreeting()}</p>
      <h1 class="font-display" style="font-size: 1.75rem; margin: 4px 0 1.5rem;">${USER_NAME}</h1>

      ${error ? `<div class="error-banner">${error}</div>` : ''}

      ${
        needsBackupToday
          ? `<button id="backup-banner" class="btn btn-surface" style="margin-bottom: 1rem; justify-content: space-between; border: 1px solid var(--surface-high);">
              <span style="display: flex; align-items: center; gap: 8px;">
                ${icon('upload', 18)}
                <span id="backup-banner-text">Back up today's data</span>
              </span>
              ${icon('arrowRight', 18)}
            </button>`
          : ''
      }

      ${
        !error && isSunday()
          ? `<button id="sunday-banner" class="btn btn-accent" style="margin-bottom: 1rem; justify-content: space-between;">
              <span>Your weekly summary is ready</span>
              ${icon('arrowRight', 18)}
            </button>`
          : ''
      }

      ${
        !error
          ? `
        <div class="card">
          <div class="volume-gauge-header">
            <span class="text-muted" style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600;">Today's volume</span>
            <span class="font-display" style="font-size: 0.9rem;">
              ${Math.round(sessionVolume).toLocaleString()} kg
              ${weekTarget > 0 ? `<span class="text-muted" style="font-size: 0.75rem; margin-left: 4px;">/ ${Math.round(weekTarget).toLocaleString()} kg</span>` : ''}
            </span>
          </div>
          <div class="volume-gauge-track">
            <div class="volume-gauge-fill ${isOverTarget ? 'over-target' : ''}" style="width: ${pct}%;"></div>
          </div>
          ${
            (todaySession?.total_distance_km > 0 || todaySession?.total_cardio_minutes > 0)
              ? `<p class="text-muted" style="font-size: 0.75rem; margin: 10px 0 0;">
                  Plus ${todaySession.total_distance_km}km cardio in ${todaySession.total_cardio_minutes}min today
                </p>`
              : ''
          }
        </div>

        <div class="stat-grid" style="margin-top: 1rem;">
          <div class="stat-card">
            <span class="stat-label">Sets today</span>
            <span class="stat-value ${sessionSets > 0 ? 'accent' : ''}">${sessionSets}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">This week</span>
            <span class="stat-value">${weekSummary?.total_sessions ?? 0}<span class="stat-unit"> sessions</span></span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Week volume</span>
            <span class="stat-value">${Math.round((weekSummary?.total_volume ?? 0) / 100) / 10}<span class="stat-unit"> t</span></span>
          </div>
        </div>

        ${
          weekSummary && (weekSummary.total_distance_km > 0 || weekSummary.total_cardio_minutes > 0)
            ? `
          <div class="card" style="margin-top: 1rem;">
            <div class="flex-between" style="margin-bottom: 0.75rem;">
              <h2 class="section-title" style="margin: 0;">Cardio this week</h2>
              <span class="text-muted" style="font-size: 0.75rem;">${icon('trending', 14)}</span>
            </div>
            <div class="stat-grid" style="margin-bottom: 0; grid-template-columns: 1fr 1fr;">
              <div style="text-align: center;">
                <p class="font-display" style="font-size: 1.5rem; margin: 0;">${weekSummary.total_distance_km}<span class="stat-unit" style="font-size: 0.85rem;"> km</span></p>
                <p class="stat-label" style="margin-top: 4px;">Distance</p>
              </div>
              <div style="text-align: center;">
                <p class="font-display" style="font-size: 1.5rem; margin: 0;">${weekSummary.total_cardio_minutes}<span class="stat-unit" style="font-size: 0.85rem;"> min</span></p>
                <p class="stat-label" style="margin-top: 4px;">Time</p>
              </div>
            </div>
          </div>`
            : ''
        }

        <div class="btn-icon-grid" style="margin-top: 1rem;">
          <button id="log-set-btn" class="btn btn-accent">
            ${icon('mic', 24)}
            Log a set
          </button>
          <button id="backfill-btn" class="btn btn-surface">
            ${icon('calendar', 24)}
            Backfill entry
          </button>
        </div>

        ${
          weekSummary && weekSummary.volume_by_body_part.length > 0
            ? `
          <div class="card">
            <button id="weekly-summary-link" class="flex-between" style="width: 100%; margin-bottom: 0.75rem;">
              <h2 class="section-title" style="margin: 0;">This week by body part</h2>
              <span class="text-accent" style="font-size: 0.75rem; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                Full summary ${icon('arrowRight', 14)}
              </span>
            </button>
            ${bodyPartRows}
          </div>`
            : ''
        }
      `
          : ''
      }
    </div>
  `;

  function afterRender() {
    document.getElementById('log-set-btn')?.addEventListener('click', () => navigate('/log'));
    document
      .getElementById('backfill-btn')
      ?.addEventListener('click', () => navigate('/history?backfill=true'));
    document
      .getElementById('weekly-summary-link')
      ?.addEventListener('click', () => navigate('/weekly-summary'));
    document
      .getElementById('sunday-banner')
      ?.addEventListener('click', () => navigate('/weekly-summary'));

    document.getElementById('backup-banner')?.addEventListener('click', async () => {
      const textEl = document.getElementById('backup-banner-text');
      const banner = document.getElementById('backup-banner');
      if (textEl) textEl.textContent = 'Preparing backup…';

      try {
        const csvContent = await exportCsv();
        const filename = `fitness_export_${today}.csv`;
        const file = new File([csvContent], filename, { type: 'text/csv' });

        let shared = false;
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: 'Fitness data backup',
              text: `Backup as of ${today}`,
            });
            shared = true;
          } catch (shareErr) {
            // User cancelled the share sheet, or share failed for some
            // other reason — fall through to plain download below
            // rather than leaving the person with nothing.
            shared = false;
          }
        }

        if (!shared) {
          downloadCsv(csvContent, filename);
        }

        await setMeta('last_export_date', today);

        if (textEl) textEl.textContent = 'Backed up ✓';
        if (banner) {
          banner.disabled = true;
          setTimeout(() => {
            banner.style.display = 'none';
          }, 1500);
        }
      } catch (err) {
        if (textEl) textEl.textContent = 'Backup failed — try again';
        console.error('Daily backup failed:', err);
      }
    });
  }

  return { html, afterRender };
}
