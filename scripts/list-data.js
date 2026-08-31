'use strict';
/* ================================================================
   DiaCare — read-only data dump

   What is actually in the clinical collections, and what claims each
   account carries. Useful when a dashboard shows nothing: it separates
   "no records were written" from "the records exist but this account
   cannot read them".

   Usage:
     $env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\to\key.json'
     node scripts/list-data.js

   Reads only. Patient names are shown because that is the point of the
   dump, so treat its output as clinical data.
   ================================================================ */

const admin = require('firebase-admin');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set.');
  process.exit(1);
}

function stamp(value) {
  if (!value) return '(none)';
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return String(value);
}

async function main() {
  admin.initializeApp();
  const db = admin.firestore();
  const auth = admin.auth();

  for (const name of ['patients', 'health_records', 'audit_log']) {
    const snap = await db.collection(name).get();
    console.log('\n' + name + ' — ' + snap.size + ' document(s)');
    snap.docs.slice(0, 10).forEach((d) => {
      const x = d.data();
      if (name === 'patients') {
        console.log('  ' + d.id + '  ' + (x.firstName || '') + ' ' + (x.lastName || '')
          + '  status=' + x.status + '  barangay=' + (x.barangay || '-')
          + '  created=' + stamp(x.createdAt));
      } else if (name === 'health_records') {
        console.log('  ' + d.id + '  patient=' + x.patientId
          + '  glucose=' + x.bloodGlucose + '  visit=' + stamp(x.visitDate));
      } else {
        console.log('  ' + (x.actorName || '?') + ' ' + (x.actionLabel || x.action)
          + ' ' + (x.targetName || '') + '  ' + stamp(x.at));
      }
    });
  }

  /* The claims are what firestore.rules actually tests. A dashboard that
     reads nothing usually means these are missing, not that the data is. */
  console.log('\nAccount claims (what the rules see):\n');
  const list = await auth.listUsers(1000);
  for (const u of list.users) {
    const c = u.customClaims || {};
    const exp = c.otpExp ? new Date(c.otpExp).toISOString() : '(none)';
    const live = c.otpExp ? (Date.now() < c.otpExp ? 'valid' : 'EXPIRED') : '';
    console.log('  ' + (u.email || u.uid));
    console.log('    otpVerified=' + (c.otpVerified === true) + '  role=' + (c.role || '(none)')
      + '  otpExp=' + exp + ' ' + live);
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
