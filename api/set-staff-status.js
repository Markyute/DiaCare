'use strict';
/* ================================================================
   POST /api/set-staff-status   { uid, status: "active" | "disabled" }

   Deactivating also drops the claims and revokes live tokens, so it
   takes effect immediately rather than at the deactivated user's next
   sign-in — which is the point of deactivating someone.
   ================================================================ */

const { auth, db, ApiError, handle, requireVerifiedAdmin } = require('./_lib/core');

module.exports = handle(async (req) => {
  const caller = await requireVerifiedAdmin(req);

  const body = req.body || {};
  const uid = body.uid;
  const status = body.status;

  if (!uid || (status !== 'active' && status !== 'disabled')) {
    throw new ApiError(400, 'A uid and a status of "active" or "disabled" are required.');
  }
  /* Locking the last admin out of their own dashboard is not recoverable
     from inside the app. */
  if (uid === caller.uid && status === 'disabled') {
    throw new ApiError(400, 'You cannot deactivate your own account.');
  }

  await db.collection('users').doc(uid).update({ status });
  await auth.updateUser(uid, { disabled: status === 'disabled' });

  if (status === 'disabled') {
    await auth.setCustomUserClaims(uid, { otpVerified: false, otpAt: 0 });
    await auth.revokeRefreshTokens(uid);
  }

  return { ok: true };
});
