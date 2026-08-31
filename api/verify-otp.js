'use strict';
/* ================================================================
   POST /api/verify-otp   { code: "123456" }

   The only place the dashboard claims are ever granted. Firestore rules
   require otpVerified and a fresh otpAt, and nothing else in the system
   writes them — which is why a tampered login page still reaches an
   empty dashboard.
   ================================================================ */

const {
  auth,
  admin,
  db,
  ApiError,
  handle,
  requireUser,
  loadActiveProfile,
  hashCode,
  timingSafeEqual,
  MAX_ATTEMPTS,
  SESSION_TTL_MS,
  REMEMBER_TTL_MS,
} = require('./_lib/core');

module.exports = handle(async (req) => {
  const user = await requireUser(req);
  const uid = user.uid;
  const profile = await loadActiveProfile(uid);

  const code = String((req.body && req.body.code) || '').trim();
  if (!/^\d{6}$/.test(code)) {
    throw new ApiError(400, 'Enter the 6-digit code.');
  }

  const ref = db.collection('otp_codes').doc(uid);
  const now = Date.now();

  /* Read, count the attempt, and consume the code in one transaction, so
     parallel guesses each cost an attempt instead of sharing one. */
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new ApiError(400, 'No code is pending. Request a new one.');
    }
    const record = snap.data();

    if (now > record.expiresAt) {
      tx.delete(ref);
      throw new ApiError(400, 'That code has expired. Request a new one.');
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      tx.delete(ref);
      throw new ApiError(429, 'Too many incorrect attempts. Request a new code.');
    }
    if (!timingSafeEqual(record.hash, hashCode(uid, code))) {
      tx.update(ref, { attempts: record.attempts + 1 });
      const left = MAX_ATTEMPTS - (record.attempts + 1);
      throw new ApiError(
        403,
        left > 0
          ? 'Incorrect code. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.'
          : 'Incorrect code. Request a new one.'
      );
    }

    /* Correct — burn it so the same digits can't be replayed. */
    tx.delete(ref);
  });

  /* The session's end is stamped into the claim rather than left for
     each reader to work out from otpAt plus a constant it has to know.
     That constant lived in three places - the rules, the client, and
     here - and "keep me signed in" could not change it without all
     three agreeing. */
  const remember = (req.body && req.body.remember) === true;
  const expiresAt = now + (remember ? REMEMBER_TTL_MS : SESSION_TTL_MS);

  await auth.setCustomUserClaims(uid, {
    otpVerified: true,
    otpAt: now,
    otpExp: expiresAt,
    role: profile.role || 'staff',
  });

  await db.collection('otp_throttle').doc(uid).delete().catch(() => {});
  await db.collection('users').doc(uid).update({
    lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    verified: true,
    role: profile.role || 'staff',
    fullName: profile.fullName || '',
    sessionExpiresAt: expiresAt,
    remembered: remember,
  };
});
