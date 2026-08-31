'use strict';
/* ================================================================
   POST /api/create-staff   { email, fullName, role, password }

   Admin-only account creation, for the personnel page. There is no
   public signup by design — an RHU dashboard has a known roster.
   ================================================================ */

const {
  auth,
  admin,
  db,
  ApiError,
  handle,
  requireVerifiedAdmin,
} = require('./_lib/core');

module.exports = handle(async (req) => {
  const caller = await requireVerifiedAdmin(req);

  const body = req.body || {};
  const email = body.email;
  const fullName = body.fullName;
  const password = body.password;

  if (!email || !fullName || !password) {
    throw new ApiError(400, 'Email, full name, and a temporary password are required.');
  }
  if (String(password).length < 10) {
    throw new ApiError(400, 'Temporary password must be at least 10 characters.');
  }
  const assignedRole = body.role === 'admin' ? 'admin' : 'staff';

  let user;
  try {
    user = await auth.createUser({ email, password, displayName: fullName });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw new ApiError(409, 'An account with that email already exists.');
    }
    if (err.code === 'auth/invalid-email') {
      throw new ApiError(400, 'That email address is not valid.');
    }
    throw err;
  }

  await db.collection('users').doc(user.uid).set({
    email,
    fullName,
    role: assignedRole,
    status: 'active',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: caller.uid,
  });

  /* No OTP claims are granted here — the new account still has to pass
     the emailed code on its first sign-in like everyone else. */
  return { uid: user.uid };
});
