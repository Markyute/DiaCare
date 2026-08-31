'use strict';
/* ================================================================
   DiaCare — read-only roster dump

   Prints what is actually in Firestore's users collection next to what
   Firebase Auth holds, so a mismatch between the two is visible. Useful
   when the dashboard shows a role you did not expect, or an account
   appears in one place and not the other.

   Usage:
     $env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\to\key.json'
     node scripts/list-staff.js

   Reads only — it never writes. Email addresses are masked so the
   output can be pasted somewhere without handing over the roster.
   ================================================================ */

const admin = require('firebase-admin');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set. See the comment at the top of this file.');
  process.exit(1);
}

function maskEmail(email) {
  const parts = String(email || '').split('@');
  if (parts.length !== 2) return '(none)';
  return parts[0].slice(0, 2) + '***@' + parts[1];
}

async function main() {
  admin.initializeApp();
  const db = admin.firestore();
  const auth = admin.auth();

  const snap = await db.collection('users').get();

  console.log('\nFirestore users/ — ' + snap.size + ' record(s)\n');
  if (snap.empty) {
    console.log('  (empty — no roster records exist)\n');
  }

  for (const doc of snap.docs) {
    const d = doc.data();

    /* A row whose id is an Auth uid can sign in; a BHW row has an
       auto-id and no Auth user behind it. */
    let authState = 'no Auth account';
    try {
      const user = await auth.getUser(doc.id);
      authState = 'Auth: ' + maskEmail(user.email) + (user.disabled ? ' [DISABLED]' : '');
      const claims = user.customClaims || {};
      if (claims.role) authState += ' claim.role=' + claims.role;
      if (claims.otpVerified) authState += ' verified';
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }

    console.log('  ' + (d.fullName || '(no name)'));
    console.log('    id      ' + doc.id);
    console.log('    role    ' + (d.role || '(none)') + '   status ' + (d.status || '(none)'));
    console.log('    email   ' + maskEmail(d.email) + '   username ' + (d.username || '(none)'));
    console.log('    ' + authState);
    console.log('');
  }

  /* An Auth account with no users/ document can pass the password step
     and then be refused a code, which looks like a broken login rather
     than a missing profile. */
  const list = await auth.listUsers(1000);
  const orphans = list.users.filter((u) => !snap.docs.some((d) => d.id === u.uid));
  if (orphans.length) {
    console.log('Auth accounts with NO Firestore profile — these cannot sign in:\n');
    orphans.forEach((u) => console.log('  ' + maskEmail(u.email) + '  ' + u.uid));
    console.log('');
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
