'use strict';
/* ================================================================
   POST /api/bhw-change-password
   { currentPassword?, newPassword }

   A BHW changing their own password from the app. The hash lives in
   bhw_credentials, which no device can read or write, so the change has
   to happen here.

   currentPassword may be omitted only for the forced first-login
   change, where the temporary password was already proven moments
   earlier at sign-in. Requiring it again there would mean asking
   someone to retype a password they were told to replace.
   ================================================================ */

const { auth, db, ApiError, handle } = require('./_lib/core');
const { setCredentials, verifyCredentials } = require('./_lib/bhw-credentials');

/* The app signs in with a custom token, so the identity here is a
   Firebase one — but it carries bhwVerified rather than the dashboard's
   otpVerified, and requireUser() in core.js is written for the latter. */
async function requireBhw(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    throw new ApiError(401, 'Sign in again.');
  }

  let decoded;
  try {
    decoded = await auth.verifyIdToken(header.slice(7).trim(), true);
  } catch (err) {
    throw new ApiError(401, 'Your session has ended. Sign in again.');
  }

  if (decoded.bhwVerified !== true) {
    throw new ApiError(403, 'This is not a mobile app account.');
  }
  return decoded;
}

module.exports = handle(async (req) => {
  const decoded = await requireBhw(req);
  const uid = decoded.uid;

  const body = req.body || {};
  const newPassword = String(body.newPassword || '');
  const currentPassword = body.currentPassword;

  if (newPassword.length < 6) {
    throw new ApiError(400, 'Your new password must be at least 6 characters.');
  }

  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) {
    throw new ApiError(403, 'This account is not set up. Contact your Barangay Health Nurse.');
  }
  const profile = snap.data();
  if (profile.status !== 'active') {
    throw new ApiError(403, 'This account has been deactivated.');
  }

  const username = profile.username;
  if (!username) {
    throw new ApiError(400, 'This account has no username to sign in with.');
  }

  /* Skipping the current password is only allowed while the account is
     still flagged for a forced change. Trusting the client's word for
     that would let any signed-in session change the password without
     knowing the old one — which is what an unattended unlocked phone
     is. */
  const forcedChange = profile.mustChangePassword === true;
  if (!forcedChange || currentPassword) {
    if (!currentPassword) {
      throw new ApiError(400, 'Enter your current password.');
    }
    const ok = await verifyCredentials(username, String(currentPassword));
    if (!ok || ok !== uid) {
      throw new ApiError(403, 'Your current password is incorrect.');
    }
  }

  await setCredentials(uid, username, newPassword);

  /* The forced-change flag is what sends the app to that screen, so it
     has to clear or the worker is sent back to it on every sign-in. */
  await db.collection('users').doc(uid).update({
    mustChangePassword: false,
    updatedAt: new Date(),
  });

  return { ok: true };
});
