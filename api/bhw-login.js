'use strict';
/* ================================================================
   POST /api/bhw-login   { username, password }

   The mobile app's sign-in. A BHW types a username, not an email, and
   Firebase Auth has no username login — so the password is checked here
   against bhw_credentials and the app is handed a custom token for the
   matching Auth account. The app exchanges it with
   signInWithCustomToken and is then a real Firebase identity, which is
   what lets firestore.rules scope it to that worker's own patients.

   Unauthenticated by necessity, so two things carry the weight:

     - The reply never distinguishes an unknown username from a wrong
       password. Either would let someone enumerate the clinic's staff.
     - Attempts are rate limited per username, because an endpoint that
       checks passwords is otherwise a place to guess them.

   No emailed code here. A BHW has no clinic email, often no signal, and
   the app is offline-first — a second factor that needs a live inbox
   would make the app unusable in the field, which is the opposite of
   safe. The dashboard, which reaches every patient in every barangay,
   keeps its code.
   ================================================================ */

const { auth, db, ApiError, handle } = require('./_lib/core');
const { verifyCredentials } = require('./_lib/bhw-credentials');

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

/* Keyed by username rather than by IP: a whole barangay can share one
   connection, and locking that connection out would lock out everyone
   working from it. */
async function checkRate(username) {
  const ref = db.collection('bhw_login_attempts').doc(username);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const windowStart = data && now - data.windowStart < WINDOW_MS ? data.windowStart : now;
    const attempts = data && windowStart === data.windowStart ? data.attempts : 0;

    if (attempts >= MAX_ATTEMPTS) {
      const minutes = Math.max(1, Math.ceil((WINDOW_MS - (now - windowStart)) / 60000));
      throw new ApiError(429,
        'Too many sign-in attempts. Try again in ' + minutes +
        (minutes === 1 ? ' minute.' : ' minutes.'));
    }

    tx.set(ref, { windowStart, attempts: attempts + 1, lastAt: now }, { merge: true });
  });

  return ref;
}

module.exports = handle(async (req) => {
  const body = req.body || {};
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!username || !password) {
    throw new ApiError(400, 'Enter your username and password.');
  }

  const attemptRef = await checkRate(username);
  const uid = await verifyCredentials(username, password);

  if (!uid) {
    throw new ApiError(401, 'Incorrect username or password.');
  }

  /* The profile is the authorisation record, same as on the dashboard:
     an account that was deactivated stops working here immediately
     rather than at some later sync. */
  const profileSnap = await db.collection('users').doc(uid).get();
  if (!profileSnap.exists) {
    throw new ApiError(403, 'This account is not set up. Contact your Barangay Health Nurse.');
  }
  const profile = profileSnap.data();
  if (profile.status !== 'active') {
    throw new ApiError(403, 'This account has been deactivated. Contact your Barangay Health Nurse.');
  }
  if (profile.role !== 'bhw') {
    /* A nurse or admin account has an email login and the dashboard's
       emailed code; letting it in through the app would be a way around
       that second factor. */
    throw new ApiError(403, 'This account signs in on the web dashboard, not the app.');
  }

  /* Claims travel in the token, so the rules can scope this worker to
     their own patients without a lookup on every read. */
  const token = await auth.createCustomToken(uid, {
    bhwVerified: true,
    role: 'bhw',
  });

  /* A successful sign-in clears the counter, so a worker who mistyped a
     few times is not still carrying those attempts afterwards. */
  await attemptRef.delete().catch(() => {});

  await db.collection('users').doc(uid).update({ lastLoginAt: new Date() }).catch(() => {});

  return {
    token,
    uid,
    profile: {
      fullName: profile.fullName || '',
      username: profile.username || username,
      barangay: profile.barangay || '',
      purok: profile.purok || '',
      contact: profile.contact || '',
      /* The app has a force-change-password screen; this is what sends
         a freshly provisioned worker into it. */
      mustChangePassword: profile.mustChangePassword !== false,
    },
  };
});
