'use strict';
/* ================================================================
   POST /api/set-staff-status   { id, status: "active" | "inactive" }

   Deactivate or reinstate a roster row. For a row with a dashboard
   login this also drops the claims and revokes live tokens, so it takes
   effect immediately rather than at the deactivated user's next
   sign-in — which is the entire point of deactivating someone.

   BHW rows have no Auth account, so only the Firestore status changes.
   ================================================================ */

const { auth, db, ApiError, handle, requireVerifiedAdmin } = require('./_lib/core');

module.exports = handle(async (req) => {
  const caller = await requireVerifiedAdmin(req);

  const body = req.body || {};
  const id = String(body.id || body.uid || '').trim();
  const status = String(body.status || '').trim();

  if (!id || (status !== 'active' && status !== 'inactive')) {
    throw new ApiError(400, 'An id and a status of "active" or "inactive" are required.');
  }
  /* Locking the last admin out of their own dashboard is not
     recoverable from inside the app. */
  if (id === caller.uid && status === 'inactive') {
    throw new ApiError(400, 'You cannot deactivate your own account.');
  }

  const ref = db.collection('users').doc(id);
  if (!(await ref.get()).exists) {
    throw new ApiError(404, 'That personnel record no longer exists.');
  }

  await ref.update({ status });

  /* BHW rows have no Auth user; getUser throws for them rather than
     returning null, so the absence is what tells us to stop here. */
  let hasLogin = true;
  try {
    await auth.getUser(id);
  } catch (err) {
    if (err.code === 'auth/user-not-found') hasLogin = false;
    else throw err;
  }

  if (hasLogin) {
    await auth.updateUser(id, { disabled: status === 'inactive' });
    if (status === 'inactive') {
      await auth.setCustomUserClaims(id, { otpVerified: false, otpAt: 0 });
      await auth.revokeRefreshTokens(id);
    }
  }

  return { ok: true, id, status, hasLogin };
});
