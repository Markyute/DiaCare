'use strict';
/* ================================================================
   DiaCare — first administrator

   The /api/create-staff route requires an already-verified admin
   to call it, so the very first admin can't be made through the app.
   This script does it once, locally, with a service account key.

   Usage:
     node scripts/create-admin.js you@gmail.com "Juan Dela Cruz"

   Needs a service account key. Firebase console -> Project settings ->
   Service accounts -> Generate new private key, then:
     set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\key.json   (cmd)
     $env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\to\key.json' (PowerShell)

   That key file is a full-project master credential. Keep it out of the
   project folder, never commit it, and delete it once setup is done.

   The password is generated here and printed once rather than taken as
   an argument, so it doesn't end up in shell history.
   ================================================================ */

const admin = require('firebase-admin');
const crypto = require('crypto');
const readline = require('readline');

const email = process.argv[2];
const fullName = process.argv[3];

if (!email || !fullName) {
  console.error('Usage: node scripts/create-admin.js <email> "<Full Name>"');
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set. See the comment at the top of this file.');
  process.exit(1);
}

/* Ambiguous characters left out so the printed password can be typed
   from a screen without confusing 0/O or 1/l. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function generatePassword(length = 16) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  return out;
}

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function main() {
  admin.initializeApp();
  const auth = admin.auth();
  const db = admin.firestore();
  const projectId = admin.app().options.projectId || process.env.GOOGLE_CLOUD_PROJECT || '(unknown)';

  console.log('\nProject:   ' + projectId);
  console.log('Email:     ' + email);
  console.log('Full name: ' + fullName);
  console.log('Role:      admin\n');

  if (!(await confirm('Create this administrator? Type yes to continue: '))) {
    console.log('Cancelled. Nothing was created.');
    process.exit(0);
  }

  const password = generatePassword();
  let user;

  try {
    user = await auth.createUser({ email, password, displayName: fullName });
    console.log('\nCreated Firebase Auth user ' + user.uid);
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      /* Re-running this to repair a half-finished setup is a normal case:
         the Auth user exists but the Firestore profile is missing. */
      user = await auth.getUserByEmail(email);
      await auth.updateUser(user.uid, { password, displayName: fullName });
      console.log('\nUser already existed (' + user.uid + '); password reset instead.');
    } else {
      throw err;
    }
  }

  await db.collection('users').doc(user.uid).set(
    {
      email,
      fullName,
      role: 'admin',
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'bootstrap-script',
    },
    { merge: true }
  );
  console.log('Wrote users/' + user.uid);

  /* No OTP claims are granted here on purpose — the first sign-in still
     has to pass the emailed code like everyone else. */
  console.log('\n  Temporary password: ' + password);
  console.log('\nShown once. Sign in at login/login.html and change it from Settings.');
  console.log('Signing in also requires the six-digit code sent to ' + email + '.\n');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
