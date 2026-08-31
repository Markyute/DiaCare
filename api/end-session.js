'use strict';
/* ================================================================
   POST /api/end-session

   Called on sign-out. Signing out in the browser only clears that
   browser; the claims live on the account and outlast the tab. Dropping
   them and revoking the refresh token is what stops a token copied out
   of the session from still satisfying the Firestore rules.
   ================================================================ */

const { auth, db, handle, requireUser } = require('./_lib/core');

module.exports = handle(async (req) => {
  const user = await requireUser(req);
  const uid = user.uid;

  await auth.setCustomUserClaims(uid, { otpVerified: false, otpAt: 0 });
  await auth.revokeRefreshTokens(uid);
  await db.collection('otp_codes').doc(uid).delete().catch(() => {});

  return { ok: true };
});
