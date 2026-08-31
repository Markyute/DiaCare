'use strict';
/* ================================================================
   DiaCare — Shared Stats
   There's no backend yet, so this is the stand-in for what would
   normally be an API: a single client-side source of truth for the
   headline numbers shown on the login screen. Pages that hold the
   real mock data (reports, personnel) publish their computed
   figures here; anything reading them (currently just the login
   screen) gets the last-published values and can subscribe to live
   updates — via the native `storage` event for other tabs, and a
   custom event for same-tab updates (storage doesn't fire in the
   tab that made the write).

   Defaults below match what reports.js/user-management.js compute
   from their current mock arrays, so a fresh browser with nothing
   published yet still shows accurate numbers instead of zeros.
   ================================================================ */

(function () {
  const KEY = 'diacare_stats_v1';
  const EVENT = 'diacare:stats-updated';

  const DEFAULTS = {
    totalPatients: 14,
    totalBarangays: 40,
    elevatedRiskPct: 57,
    communityHealthWorkers: 6,
  };

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function publish(partial) {
    const next = { ...read(), ...partial };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private browsing / quota exceeded — stats just won't persist or cross tabs */
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
    return next;
  }

  /* Fires the callback immediately with the current values, then
     again whenever they change (this tab or another). Returns an
     unsubscribe function. */
  function subscribe(callback) {
    callback(read());
    const onCustom = (e) => callback(e.detail || read());
    const onStorage = (e) => {
      if (e.key === KEY) callback(read());
    };
    window.addEventListener(EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }

  window.DiaCareStats = { read, publish, subscribe };
})();
