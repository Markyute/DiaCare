/* ================================================================
   DiaCare — Firebase client singleton

   Every page that touches auth or data imports from here rather than
   calling initializeApp() itself, so there is exactly one app, one auth
   instance, and one functions client per page load.
   ================================================================ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getAuth,
  connectAuthEmulator,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  getIdTokenResult,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
  getFirestore,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

import { firebaseConfig, USE_EMULATORS } from './firebase-config.js';

if (firebaseConfig.apiKey === 'REPLACE_ME') {
  console.error(
    'DiaCare: shared/firebase-config.js still holds placeholder values. ' +
    'Copy the web app config from the Firebase console into it.'
  );
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/* The OTP backend is not part of Firebase — it runs as serverless
   functions under /api. See shared/api.js. */

export {
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  getIdTokenResult,
};

/* Firebase surfaces its own error codes; these are the ones a user can
   actually act on. Anything else stays generic on purpose — telling an
   attacker which half of the pair was wrong is how accounts get
   enumerated. */
const AUTH_MESSAGES = {
  'auth/invalid-email': 'Enter a valid email address',
  'auth/user-disabled': 'This account is deactivated. Contact an administrator.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Network problem. Check your connection and try again.',
};

export function authErrorMessage(err) {
  if (!err) return 'Something went wrong. Please try again.';
  if (AUTH_MESSAGES[err.code]) return AUTH_MESSAGES[err.code];
  /* Wrong password, unknown user, and malformed credential all land here
     as one indistinguishable message. */
  if (
    err.code === 'auth/wrong-password' ||
    err.code === 'auth/user-not-found' ||
    err.code === 'auth/invalid-credential'
  ) {
    return 'Incorrect email or password';
  }
  /* ApiError from shared/api.js already carries the message the server
     wrote for this exact situation; pass it through. */
  if (err.name === 'ApiError' && err.message) return err.message;
  if (err.message && !String(err.message).startsWith('Firebase:')) return err.message;
  return 'Something went wrong. Please try again.';
}

/* Fallback only, for a session verified before otpExp was stamped into
   the claim. New sessions carry their own expiry. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/* A signed-in user is not an authorized one — the emailed code has to
   have been verified, and recently. Both the rules and this check test
   the same claim so the UI and the data layer can't disagree. */
export async function hasVerifiedSession(user) {
  if (!user) return false;
  const token = await getIdTokenResult(user);
  const claims = token.claims || {};
  if (claims.otpVerified !== true) return false;
  /* Prefer the stamped expiry: it already accounts for whether the user
     asked to stay signed in. Deriving it from otpAt here would mean
     re-deciding that, and getting it wrong for anyone who ticked the
     box. */
  const exp = Number(claims.otpExp || 0);
  if (exp > 0) return Date.now() < exp;

  const at = Number(claims.otpAt || 0);
  return at > 0 && Date.now() - at < SESSION_TTL_MS;
}
