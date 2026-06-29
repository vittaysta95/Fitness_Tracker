/**
 * Date helpers that avoid a subtle bug: `new Date("2026-06-22")` parses
 * the string as UTC midnight, not local midnight, which silently
 * shifts dates for users in negative UTC-offset timezones. Always use
 * parseLocalDate() instead of `new Date(isoString)` for date-only
 * values (session dates, week boundaries).
 */

export function parseLocalDate(isoDateString) {
  const [year, month, day] = isoDateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatLocalDate(isoDateString, options) {
  return parseLocalDate(isoDateString).toLocaleDateString('en-AU', options);
}

export function todayLocalIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysIso(isoDateString, days) {
  const date = parseLocalDate(isoDateString);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
