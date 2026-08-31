'use strict';
/* ================================================================
   DiaCare — BHW credentials

   Barangay health workers sign into the mobile app with a username.
   Firebase Auth has no username login, so the password is verified here
   and the app is handed a custom token for the matching Auth account.

   Hashes live in bhw_credentials, not in the user's profile document.
   A BHW can read their own users/ document — the app needs their name
   and barangay — and a password hash has no business being in something
   readable, even by its owner.

   scrypt rather than SHA-256: it is deliberately slow and memory-hard,
   so a stolen hash is expensive to attack offline. The mobile app's own
   local table uses salted SHA-256, which is fine for a device-local
   cache and not fine for the server's copy.
   ================================================================ */

const crypto = require('crypto');
const { db, ApiError } = require('./core');

const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

/* The document id is the username, so uniqueness is enforced by
   Firestore itself rather than by a query that can race. */
function credentialId(username) {
  return String(username || '').trim().toLowerCase();
}

function hash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, derived) => {
      if (err) reject(err);
      else resolve(derived.toString('hex'));
    });
  });
}

async function setCredentials(uid, username, password) {
  const id = credentialId(username);
  if (id.length < 3) {
    throw new ApiError(400, 'Username must be at least 3 characters.');
  }
  if (!password || String(password).length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters.');
  }

  /* Claim the username transactionally: two admins adding the same one
     at once would otherwise both pass a read-then-write check. */
  const ref = db.collection('bhw_credentials').doc(id);
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = await hash(password, salt);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data().uid !== uid) {
      throw new ApiError(409, 'That username is already taken.');
    }
    tx.set(ref, { uid, username: id, salt, hash: digest, updatedAt: Date.now() });
  });

  return id;
}

/* Returns the uid on success, null on any failure. Deliberately says
   nothing about which half was wrong — a login that distinguishes "no
   such user" from "wrong password" is a way to enumerate staff. */
async function verifyCredentials(username, password) {
  const id = credentialId(username);
  if (!id || !password) return null;

  const snap = await db.collection('bhw_credentials').doc(id).get();
  if (!snap.exists) {
    /* Spend roughly the same time as a real verification would, so a
       missing username cannot be told from a wrong password by how long
       the answer takes. */
    await hash(String(password), 'absent-user-timing-equaliser');
    return null;
  }

  const record = snap.data();
  const attempt = await hash(String(password), record.salt);

  /* Constant-time: a byte-by-byte comparison leaks how much of the hash
     matched, which is enough to reconstruct it one byte at a time. */
  const a = Buffer.from(attempt, 'hex');
  const b = Buffer.from(record.hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return record.uid;
}

async function removeCredentials(username) {
  const id = credentialId(username);
  if (!id) return;
  await db.collection('bhw_credentials').doc(id).delete().catch(() => {});
}

module.exports = { setCredentials, verifyCredentials, removeCredentials, credentialId };
