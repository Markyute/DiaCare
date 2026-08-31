'use strict';
/* ================================================================
   DiaCare — create a dashboard account from the command line

   The Personnel page is the normal way to do this. This exists for
   bulk or scripted setup, and for the case where nobody is signed in
   as an admin yet.

   Usage:
     $env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\to\key.json'
     node scripts/add-staff.js <email> "<Full Name>" <admin|nurse>

   The password is asked for at a masked prompt. It can also be passed
   in the DIACARE_NEW_PASSWORD environment variable for scripted runs —
   never as an argument, because command-line arguments are readable by
   other processes on the machine and land in shell history.

   Pass --reset-link instead and no password is chosen at all: the
   account is created with random bytes that are discarded unread, and
   the person sets their own with "Forgot password?" on the login page.
   A password nobody ever typed cannot be leaked by the person who
   created the account.

   Writes both halves of an account: the Firebase Auth login and the
   users/ profile. Creating only the login (which the Firebase console's
   "Add user" button does) produces an account that clears the password
   step and is then refused a code.
   ================================================================ */

const admin = require('firebase-admin');
const readline = require('readline');

const email = String(process.argv[2] || '').trim().toLowerCase();
const fullName = String(process.argv[3] || '').trim();
const role = String(process.argv[4] || '').trim().toLowerCase();
const useResetFlow = process.argv.includes('--reset-link');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['admin', 'nurse'];

if (!email || !fullName || !role) {
  console.error('Usage: node scripts/add-staff.js <email> "<Full Name>" <admin|nurse>');
  process.exit(1);
}
if (!EMAIL_RE.test(email)) {
  console.error('"' + email + '" is not a valid email address.');
  console.error('This is where the sign-in code gets sent, so a typo makes the account unusable.');
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error('Role must be admin or nurse. BHW records have no dashboard login — add those from the Personnel page.');
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set. See the comment at the top of this file.');
  process.exit(1);
}

function askMasked(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    /* Suppressing readline's own echo is the only reliable way — trying
       to overwrite characters after the fact is a race. */
    rl._writeToOutput = function (chunk) {
      if (chunk.includes(question)) rl.output.write(question + '*'.repeat(rl.line.length));
      else rl.output.write('*');
    };
    rl.question(question, (answer) => {
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

function initialsOf(name) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

const AVATAR_COLORS = [
  '#22a866', '#2f8fb8', '#7c63d6', '#d9822b', '#e5534b',
  '#059669', '#0f766e', '#1e40af', '#92400e',
];

async function main() {
  admin.initializeApp();
  const auth = admin.auth();
  const db = admin.firestore();

  /* Firebase requires a password at creation time even when the plan is
     for the account holder to replace it, so generate one from the
     CSPRNG and never look at it. */
  const password = useResetFlow
    ? require('crypto').randomBytes(24).toString('base64url')
    : (process.env.DIACARE_NEW_PASSWORD || await askMasked('Password (min 6 chars, input hidden): '));

  if (String(password).length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }

  let user;
  try {
    user = await auth.createUser({ email, password, displayName: fullName });
    console.log('  created Auth account ' + user.uid);
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      /* Re-running to repair a half-made account is a normal case: the
         login exists but the profile does not. */
      user = await auth.getUserByEmail(email);
      await auth.updateUser(user.uid, { password, displayName: fullName });
      console.log('  account existed (' + user.uid + '); password and name reset');
    } else {
      throw err;
    }
  }

  await db.collection('users').doc(user.uid).set(
    {
      email,
      fullName,
      role,
      status: 'active',
      username: '',
      contact: '',
      barangay: '',
      purok: '',
      mustChangePassword: true,
      initials: initialsOf(fullName),
      color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'add-staff-script',
    },
    { merge: true }
  );
  console.log('  wrote users/' + user.uid + '  role=' + role);

  /* No OTP claims are granted here — the first sign-in still has to
     clear the emailed code like everyone else. */
  if (useResetFlow) {
    console.log('  no usable password was set — ' + fullName + ' must open the login page,');
    console.log('  click "Forgot password?", and set one from the email Firebase sends.\n');
  } else {
    console.log('  ' + fullName + ' can now sign in; the code goes to ' + email + '\n');
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
