'use strict';
/* ================================================================
   DiaCare RHU Libon — Shared Profile (retired)

   This used to hold the signed-in user's name, email, contact and photo
   in localStorage and paint the top-nav from it. That made a profile a
   property of a browser rather than of a person: a nurse who renamed
   themselves was renamed on that one machine, and nobody else — not the
   Super Admin's roster, not the same nurse on another computer — ever
   saw it.

   The profile now lives in the user's Firestore document. shared/
   session.js reads it and paints the nav; settings.js reads and writes
   it. Neither uses this file.

   The file remains because nine pages load it, and its only job now is
   to clear the stale key so an old cached name cannot reappear.
   ================================================================ */
const DIACARE_PROFILE_KEY = 'diacare_profile';

try {
  localStorage.removeItem(DIACARE_PROFILE_KEY);
} catch (err) {
  /* Private browsing, or storage disabled. Nothing to clean up. */
}
