'use strict';
/* ================================================================
   POST /api/update-staff

   Admin-only edit of an existing roster row. Profile fields always
   apply; email, password, and role only mean anything for a row that
   has a Firebase Auth account behind it.

   Body: { id, fullName?, role?, email?, username?, password?,
           contact?, barangay?, purok?, status?, mustChangePassword? }
   ================================================================ */

const {
  auth,
  db,
  ApiError,
  handle,
  requireVerifiedAdmin,
} = require('./_lib/core');
const audit = require('./_lib/audit');

const ALL_ROLES = ['admin', 'nurse', 'bhw'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initialsOf(fullName) {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/* A row created as admin/nurse has its Auth uid as the document id; a
   BHW row has an auto-id and no Auth user. Asking Firebase is more
   reliable than inferring it from the stored role, which an earlier
   edit may have changed. */
async function hasAuthAccount(id) {
  try {
    await auth.getUser(id);
    return true;
  } catch (err) {
    if (err.code === 'auth/user-not-found') return false;
    throw err;
  }
}

module.exports = handle(async (req) => {
  const caller = await requireVerifiedAdmin(req);

  const body = req.body || {};
  const id = String(body.id || '').trim();
  if (!id) throw new ApiError(400, 'A record id is required.');

  const ref = db.collection('users').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new ApiError(404, 'That personnel record no longer exists.');
  const current = snap.data();

  const updates = {};
  const authUpdates = {};

  /* ---- name ---- */
  if (body.fullName !== undefined) {
    const fullName = String(body.fullName).trim();
    if (fullName.length < 2) throw new ApiError(400, 'Full name is required.');
    updates.fullName = fullName;
    updates.initials = initialsOf(fullName);
    authUpdates.displayName = fullName;
  }

  /* ---- role ---- */
  if (body.role !== undefined) {
    const role = String(body.role).trim();
    if (!ALL_ROLES.includes(role)) throw new ApiError(400, 'Role must be admin, nurse, or bhw.');
    /* An admin who demotes themselves loses the ability to promote
       anyone back, including themselves — and if they are the only
       admin, the dashboard has no one who can manage accounts at all. */
    if (id === caller.uid && role !== 'admin') {
      throw new ApiError(400, 'You cannot change your own role.');
    }
    updates.role = role;
  }

  /* ---- plain profile fields ---- */
  for (const field of ['contact', 'barangay', 'purok']) {
    if (body[field] !== undefined) updates[field] = String(body[field]).trim();
  }
  if (body.mustChangePassword !== undefined) {
    updates.mustChangePassword = !!body.mustChangePassword;
  }

  /* ---- status ---- */
  if (body.status !== undefined) {
    const status = String(body.status).trim();
    if (status !== 'active' && status !== 'inactive') {
      throw new ApiError(400, 'Status must be active or inactive.');
    }
    if (id === caller.uid && status !== 'active') {
      throw new ApiError(400, 'You cannot deactivate your own account.');
    }
    updates.status = status;
  }

  const isAuthAccount = await hasAuthAccount(id);

  /* ---- username (BHW only) ---- */
  if (body.username !== undefined) {
    const username = String(body.username).trim().toLowerCase();
    if (username && username !== current.username) {
      const clash = await db.collection('users').where('username', '==', username).limit(1).get();
      if (!clash.empty && clash.docs[0].id !== id) {
        throw new ApiError(409, 'That username is already taken.');
      }
    }
    updates.username = username;
  }

  /* ---- email and password (dashboard accounts only) ---- */
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (isAuthAccount) {
      if (!EMAIL_RE.test(email)) throw new ApiError(400, 'That email address is not valid.');
      if (email !== current.email) authUpdates.email = email;
    }
    updates.email = email;
  }

  if (body.password) {
    if (!isAuthAccount) {
      throw new ApiError(400, 'This record has no dashboard login, so it has no password.');
    }
    if (String(body.password).length < 6) {
      throw new ApiError(400, 'Password must be at least 6 characters.');
    }
    authUpdates.password = String(body.password);
  }

  /* ---- apply ---- */
  if (isAuthAccount && Object.keys(authUpdates).length) {
    if (updates.status !== undefined) {
      authUpdates.disabled = updates.status !== 'active';
    }
    try {
      await auth.updateUser(id, authUpdates);
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        throw new ApiError(409, 'Another account already uses that email.');
      }
      throw err;
    }
  } else if (isAuthAccount && updates.status !== undefined) {
    await auth.updateUser(id, { disabled: updates.status !== 'active' });
  }

  /* Deactivating has to bite immediately rather than at the next
     sign-in, so drop the claims and kill live tokens. */
  if (isAuthAccount && updates.status === 'inactive') {
    await auth.setCustomUserClaims(id, { otpVerified: false, otpAt: 0, otpExp: 0 });
    await auth.revokeRefreshTokens(id);
  }
  /* A role change is carried in the token, so the old one has to go too
     or the change only takes effect whenever they happen to sign in. */
  if (isAuthAccount && updates.role && updates.role !== current.role) {
    await auth.setCustomUserClaims(id, { otpVerified: false, otpAt: 0, otpExp: 0 });
    await auth.revokeRefreshTokens(id);
  }

  await ref.update(updates);

  /* A role change, a deactivation, and a password reset are each worth
     their own line in the feed - "updated the account" would bury the
     three changes anyone actually goes looking for. */
  const targetName = updates.fullName || current.fullName || '';
  const events = [];
  if (updates.role && updates.role !== current.role) {
    events.push(['STAFF_ROLE_CHANGED', current.role + ' to ' + updates.role]);
  }
  if (updates.status && updates.status !== current.status) {
    events.push([updates.status === 'active' ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED', '']);
  }
  if (authUpdates.password) {
    events.push(['STAFF_PASSWORD_RESET', '']);
  }
  if (!events.length) {
    events.push(['STAFF_UPDATED', Object.keys(updates).join(', ')]);
  }

  for (const [action, detail] of events) {
    await audit.record({ actorUid: caller.uid, action, targetId: id, targetName, detail });
  }

  return { id, updated: Object.keys(updates), hasLogin: isAuthAccount };
});
