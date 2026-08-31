'use strict';
/* ================================================================
   DiaCare — delete Auth accounts that have no dashboard profile

   Firebase console's "Add user" button creates only the login half of
   an account. Without a users/ document the sign-in gets past the
   password and is then refused a code, which reads as a broken login
   rather than a missing profile. Accounts should be created from the
   Personnel page, which writes both halves.

   Usage:
     $env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\to\key.json'
     node scripts/prune-orphan-logins.js            # list only
     node scripts/prune-orphan-logins.js --delete   # actually delete

   Deleting a login is permanent. Without --delete this only reports,
   and even with it, an account that HAS a profile is never touched —
   removing a real staff member is the Personnel page's job, where
   deactivating keeps the record.
   ================================================================ */

const admin = require('firebase-admin');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set. See the comment at the top of this file.');
  process.exit(1);
}

const doDelete = process.argv.includes('--delete');

function maskEmail(email) {
  const parts = String(email || '').split('@');
  if (parts.length !== 2) return '(no email)';
  return parts[0].slice(0, 2) + '***@' + parts[1];
}

async function main() {
  admin.initializeApp();
  const db = admin.firestore();
  const auth = admin.auth();

  const profiles = await db.collection('users').get();
  const known = new Set(profiles.docs.map((d) => d.id));

  const list = await auth.listUsers(1000);
  const orphans = list.users.filter((u) => !known.has(u.uid));

  if (!orphans.length) {
    console.log('\nNo orphaned logins. Every Auth account has a dashboard profile.\n');
    return;
  }

  console.log('\nAuth accounts with no users/ profile — these cannot sign in:\n');
  orphans.forEach((u) => console.log('  ' + maskEmail(u.email) + '   ' + u.uid));

  if (!doDelete) {
    console.log('\nRe-run with --delete to remove them.\n');
    return;
  }

  console.log('\nDeleting...\n');
  for (const u of orphans) {
    /* Re-check immediately before deleting: the listing above could be
       stale if someone created the profile in the meantime. */
    const stillOrphan = !(await db.collection('users').doc(u.uid).get()).exists;
    if (!stillOrphan) {
      console.log('  skipped ' + maskEmail(u.email) + ' — it has a profile now');
      continue;
    }
    await auth.deleteUser(u.uid);
    console.log('  deleted ' + maskEmail(u.email));
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
