/**
 * Minimal hash-based router. No React Router available without a
 * bundler, so this is a small hand-rolled equivalent: routes are
 * registered with a render function, and navigation is done via
 * location.hash (e.g. #/log?session_id=5&date=2026-06-20).
 */

const routes = new Map();
let notFoundHandler = () => '<div class="page"><p class="text-muted">Page not found.</p></div>';
let currentCleanup = null;

export function registerRoute(path, renderFn) {
  routes.set(path, renderFn);
}

export function setNotFoundHandler(fn) {
  notFoundHandler = fn;
}

export function navigate(path) {
  window.location.hash = path;
}

export function getSearchParams() {
  const hash = window.location.hash.slice(1) || '/';
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(queryIndex + 1));
}

export function getPathOnly() {
  const hash = window.location.hash.slice(1) || '/';
  const queryIndex = hash.indexOf('?');
  return queryIndex === -1 ? hash : hash.slice(0, queryIndex);
}

async function render() {
  if (currentCleanup) {
    try {
      currentCleanup();
    } catch (e) {
      // ignore cleanup errors
    }
    currentCleanup = null;
  }

  const path = getPathOnly();
  const renderFn = routes.get(path) || notFoundHandler;
  const appEl = document.getElementById('app');

  const result = await renderFn();
  if (typeof result === 'string') {
    appEl.innerHTML = result;
  } else if (result && typeof result === 'object') {
    appEl.innerHTML = result.html;
    if (typeof result.afterRender === 'function') {
      await result.afterRender();
    }
    if (typeof result.cleanup === 'function') {
      currentCleanup = result.cleanup;
    }
  }

  updateActiveNavItem(path);
}

function updateActiveNavItem(path) {
  document.querySelectorAll('.nav-item').forEach((el) => {
    if (el.dataset.path === path) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}

export function rerenderCurrentRoute() {
  render();
}
