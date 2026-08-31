'use strict';
/* ================================================================
   DiaCare — first administrator

   The /api/create-staff route requires an already-verified admin to call
   it, so the very first admin can't be made through the app. This script
   does it once, locally, with a service-account key.

   Usage:
     $env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\to\key.json'
     node scripts/create-admin.js you@gmail.com "Juan Dela Cruz"

   Get the key from the Firebase console: Project settings -> Service
   accounts -> Generate new private key. It is a full-project master
   credential — keep it outside the project folder, never commit it, and
   delete it once setup is done.

   The password is typed in, masked, and never printed. Earlier this
   script generated one and echoed it, which put a live credential into
   the terminal scrollback of whoever ran it.
   ================================================================ */

const admin = require('firebase-admin');
const readline = require('readline');

const email = process.argv[2];
const fullName = process.argv[3];

if (!email || !fullName) {
  console.error('Usage: node scripts/create-admin.js <email> "<Full Name>"');
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('That is not a valid email address.');
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set. See the comment at the top of this file.');
  process.exit(1);
}

/* ================================================================
   PROMPTS
   ================================================================ */
function ask(question, { mask = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    if (mask) {
      /* Overriding _writeToOutput stops readline echoing at all.
         Intercepting stdin afterwards would be a race — the character is
         already on screen, and a pasted value arrives as one chunk. */
      rl._writeToOutput = function (chunk) {
        if (chunk.includes(question)) {
          rl.output.write(question + '*'.repeat(rl.line.length));
        } else {
          rl.output.write('*');
        }
      };
    }

    rl.question(question, (answer) => {
      if (mask) process.stdout.write('\n');
      rl.close();
      resolve(mask ? answer : answer.trim());
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

  const confirmed = await ask('Create this administrator? Type yes to continue: ');
  if (confirmed.toLowerCase() !== 'yes') {
    console.log('Cancelled. Nothing was created.');
    process.exit(0);
  }

  const password = await ask('Choose a password (min 10 chars, input hidden): ', { mask: true });
  if (password.length < 10) {
    console.error('Too short — Firebase will reject anything under 6, and 10 is the floor here.');
    process.exit(1);
  }
  const again = await ask('Type it again: ', { mask: true });
  if (password !== again) {
    console.error('Those do not match. Nothing was created.');
    process.exit(1);
  }

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
  console.log('\nDone. Sign in with that email and password.');
  console.log('A six-digit code will be sent to ' + email + '.');
  console.log('\nDelete the service-account key file now that setup is finished.\n');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
