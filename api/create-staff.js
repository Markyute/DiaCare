'use strict';
/* ================================================================
   POST /api/create-staff

   Admin-only account creation, called by the personnel page. There is
   no public signup by design — an RHU dashboard has a known roster.

   Two kinds of row live in users/:

     admin, nurse — real Firebase Auth accounts that sign into this
       dashboard. The document id is the Auth uid, which is what ties a
       signed-in token to its profile everywhere else in the system.

     bhw — signs into the mobile app with a username. Firebase Auth has
       no username login, so the account is created with a uid and no
       email, the password is kept in bhw_credentials, and /api/bhw-login
       trades the two for a custom token. The document id is still the
       Auth uid, so assignedBhwId on a patient is a uid everywhere and
       the rules can compare it directly.

   Body: { fullName, role, email?, username?, password?, contact?,
           barangay?, purok?, mustChangePassword? }
   ================================================================ */

const {
  auth,
  admin,
  db,
  ApiError,
  handle,
  requireVerifiedAdmin,
} = require('./_lib/core');
const audit = require('./_lib/audit');
const { setCredentials } = require('./_lib/bhw-credentials');

const DASHBOARD_ROLES = ['admin', 'nurse'];
const ALL_ROLES = ['admin', 'nurse', 'bhw'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Shown on the avatar chip in the roster table. */
function initialsOf(fullName) {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const AVATAR_COLORS = [
  '#22a866', '#2f8fb8', '#7c63d6', '#d9822b', '#e5534b',
  '#059669', '#0f766e', '#1e40af', '#92400e',
];

module.exports = handle(async (req) => {
  const caller = await requireVerifiedAdmin(req);

  const body = req.body || {};
  const fullName = String(body.fullName || '').trim();
  const role = String(body.role || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const username = String(body.username || '').trim().toLowerCase();
  const password = body.password;

  if (fullName.length < 2) {
    throw new ApiError(400, 'Full name is required.');
  }
  if (!ALL_ROLES.includes(role)) {
    throw new ApiError(400, 'Role must be admin, nurse, or bhw.');
  }

  const profile = {
    fullName,
    role,
    status: 'active',
    contact: String(body.contact || '').trim(),
    barangay: String(body.barangay || '').trim(),
    purok: String(body.purok || '').trim(),
    /* Stored so the mobile app's force-change-password screen can read
       it. The dashboard does not act on it yet. */
    mustChangePassword: body.mustChangePassword !== false,
    initials: initialsOf(fullName),
    color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: caller.uid,
  };

  /* ================================================================
     BHW — roster record, no login
     ================================================================ */
  if (role === 'bhw') {
    if (username.length < 3) {
      throw new ApiError(400, 'Username is required for a BHW (at least 3 characters).');
    }
    if (!password || String(password).length < 6) {
      throw new ApiError(400, 'A temporary password is required (at least 6 characters).');
    }

    /* The uid is minted first so the credential record, the Auth
       account, and the profile all agree on one identifier. */
    const uid = db.collection('users').doc().id;

    /* Firebase Auth allows an account with no email or password when
       sign-in happens through a custom token, which is exactly this
       case - the password is checked by /api/bhw-login, not by Firebase. */
    await auth.createUser({ uid, displayName: fullName });

    try {
      /* Claims the username transactionally, so this throws rather than
         silently overwriting if it is taken. */
      await setCredentials(uid, username, password);
    } catch (err) {
      /* Do not leave an Auth account behind that nothing can sign into. */
      await auth.deleteUser(uid).catch(() => {});
      throw err;
    }

    await db.collection('users').doc(uid).set({ ...profile, username, email: email || '' });

    await audit.record({
      actorUid: caller.uid,
      action: 'STAFF_CREATED',
      targetId: uid,
      targetName: fullName,
      detail: 'BHW mobile app account, username ' + username,
    });

    return { id: uid, role, hasLogin: true, signsInOn: 'app' };
  }

  /* ================================================================
     admin / nurse — real dashboard accounts
     ================================================================ */
  if (!EMAIL_RE.test(email)) {
    throw new ApiError(400, 'A valid email address is required for a dashboard account.');
  }
  if (!password || String(password).length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters.');
  }

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
    if (err.code === 'auth/invalid-password') {
      throw new ApiError(400, 'Firebase rejected that password. Use at least 6 characters.');
    }
    throw err;
  }

  /* The document id is the Auth uid: loadActiveProfile() looks the
     profile up by uid on every signed-in request. */
  await db.collection('users').doc(user.uid).set({ ...profile, email, username: '' });

  await audit.record({
    actorUid: caller.uid,
    action: 'STAFF_CREATED',
    targetId: user.uid,
    targetName: fullName,
    detail: role === 'admin' ? 'Super Admin account' : 'RHU Nurse account',
  });

  /* No OTP claims are granted here — the new account still has to pass
     the emailed code on its first sign-in like everyone else. */
  return { id: user.uid, role, hasLogin: true, dashboardRole: DASHBOARD_ROLES.includes(role) };
});
