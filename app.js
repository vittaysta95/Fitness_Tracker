import { registerRoute, startRouter } from './src/router.js';
import { seedExercisesIfEmpty } from './src/db.js';
import { EXERCISE_SEED } from './src/exerciseSeed.js';
import { icon } from './src/icons.js';

import { renderTodayPage } from './src/pages/today.js';
import { renderLogPage } from './src/pages/log.js';
import { renderHistoryTrendsPage } from './src/pages/historyTrends.js';
import { renderBiomarkersPage } from './src/pages/biomarkers.js';
import { renderWeeklySummaryPage } from './src/pages/weeklySummary.js';
import { renderSettingsPage } from './src/pages/settings.js';

// History and Trends are now one combined tab (toggle at the top
// switches between list view and chart view) — see historyTrends.js.
// Both old paths still route to the same page so any existing links
// or bookmarks (e.g. from History's "add sets" deep link) keep working.
const NAV_ITEMS = [
  { path: '/', label: 'Today', icon: 'home' },
  { path: '/log', label: 'Log', icon: 'mic' },
  { path: '/history', label: 'History', icon: 'calendar' },
  { path: '/biomarkers', label: 'Biomarkers', icon: 'trending' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];

function renderBottomNav() {
  const nav = document.getElementById('bottom-nav');
  nav.innerHTML = NAV_ITEMS.map(
    (item) => `
      <a href="#${item.path}" class="nav-item" data-path="${item.path}">
        ${icon(item.icon, 22)}
        <span>${item.label}</span>
      </a>`
  ).join('');
}

async function init() {
  try {
    await seedExercisesIfEmpty(EXERCISE_SEED);
  } catch (e) {
    console.error('Failed to seed exercise library:', e);
  }

  renderBottomNav();

  registerRoute('/', renderTodayPage);
  registerRoute('/log', renderLogPage);
  registerRoute('/history', renderHistoryTrendsPage);
  registerRoute('/trends', renderHistoryTrendsPage);
  registerRoute('/biomarkers', renderBiomarkersPage);
  registerRoute('/weekly-summary', renderWeeklySummaryPage);
  registerRoute('/settings', renderSettingsPage);

  startRouter();

  // Register the service worker for installability, only available
  // over HTTPS or localhost (the only contexts where it's allowed to
  // run) — gracefully no-ops when opened as a plain local file.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => {
        console.warn('Service worker registration failed (expected if opened as a local file):', e);
      });
    });
  }
}

init();
