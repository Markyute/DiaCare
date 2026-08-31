'use strict';
/* ================================================================
   POST /api/create-staff

   Admin-only account creation, called by the personnel page. There is
   no public signup by design — an RHU dashboard has a known roster.

   Two kinds of row live in users/:

     admin, nurse — real Firebase Auth accounts that sign into this
       dashboard. The document id is the Auth uid, which is what ties a
       signed-in token to its profile everywhere else in the system.

     bhw — a roster record only. Barangay health workers sign into the
       mobile app with a username, and Firebase Auth has no username
       login, so no Auth account is created and these cannot reach the
       dashboard. The document gets an auto-id instead of a uid.

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
    /* Usernames are how the mobile app will identify these people, so a
       duplicate would be ambiguous the moment that login is built. */
    const clash = await db.collection('users').where('username', '==', username).limit(1).get();
    if (!clash.empty) {
      throw new ApiError(409, 'That username is already taken.');
    }

    const ref = db.collection('users').doc();
    await ref.set({ ...profile, username, email: email || '' });
    return { id: ref.id, role, hasLogin: false };
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

  /* No OTP claims are granted here — the new account still has to pass
     the emailed code on its first sign-in like everyone else. */
  return { id: user.uid, role, hasLogin: true, dashboardRole: DASHBOARD_ROLES.includes(role) };
});
