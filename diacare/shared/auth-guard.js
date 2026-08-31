/* ================================================================
   DiaCare — page guard

   Included by every page except login. Replaces the old
   diacare_logged_in flag, which was a localStorage string any visitor
   could set from the console.

   This is a convenience redirect, not the security boundary — the real
   boundary is firestore.rules, which rejects reads from a session that
   never cleared the emailed code. A user who defeats this guard reaches
   an empty page.
   ================================================================ */

import { auth, onAuthStateChanged, hasVerifiedSession, signOut } from './firebase.js';

const LOGIN_URL = new URL('../login/login.html', import.meta.url).href;

/* Blank the page while the token is being checked, so a protected page
   never flashes its layout before the redirect lands. */
const veil = document.createElement('style');
veil.textContent = 'body{visibility:hidden !important}';
veil.id = 'authGuardVeil';
document.head.appendChild(veil);

function reveal() {
  document.getElementById('authGuardVeil')?.remove();
}

function bounce() {
  window.location.replace(LOGIN_URL);
}

/* Resolves once the user object for this page load is known. Pages that
   need the signed-in user can await it instead of racing the guard. */
export const currentUser = new Promise((resolve) => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      bounce();
      return;
    }
    /* Signed in but never verified the code, or verified too long ago:
       drop the half-finished session rather than leaving it around. */
    if (!(await hasVerifiedSession(user))) {
      await signOut(auth).catch(() => {});
      bounce();
      return;
    }
    reveal();
    resolve(user);
  });
});

/* Failsafe: if Firebase never answers (offline, blocked CDN), don't
   leave the operator staring at a blank page forever. */
setTimeout(() => {
  if (document.getElementById('authGuardVeil')) bounce();
}, 8000);
