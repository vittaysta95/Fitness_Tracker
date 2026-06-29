import { icon } from '../icons.js';
import { navigate, getSearchParams } from '../router.js';
import { listSessions, createSession, deleteSession, getSession, formatSetDisplay } from '../db.js';
import { todayLocalIso, formatLocalDate } from '../dateUtils.js';

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

export async function renderHistoryPage() {
  const params = getSearchParams();
  let showBackfill = params.get('backfill') === 'true';
  let backfillDate = todayLocalIso();
  let backfillNotes = '';
  let expandedId = null;
  let expandedDetail = null;

  let sessions = await listSessions();

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

  function renderApp() {
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
      <div class="page">
        <div class="flex-between" style="margin-bottom: 1.5rem;">
          <h1 class="page-title" style="margin: 0;">History</h1>
          <button id="show-backfill-btn" class="chip active" style="display: flex; align-items: center; gap: 4px;">
            ${icon('plus', 16)} Backfill
          </button>
        </div>
        ${backfillFormHtml}
        ${sessionsHtml}
      </div>
    `;
  }

  async function refresh() {
    sessions = await listSessions();
  }

  function rerender() {
    document.getElementById('app').innerHTML = renderApp();
    wireUpEvents();
  }

  function wireUpEvents() {
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
        await refresh();
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
  }

  return {
    html: renderApp(),
    afterRender: wireUpEvents,
  };
}
