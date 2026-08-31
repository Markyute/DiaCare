'use strict';
/* ================================================================
   DiaCare — audit trail

   Who changed what, and when. The Super Admin dashboard reads this to
   answer "who deactivated that nurse" without anyone having to
   remember.

   Entries are append-only: firestore.rules allows no update and no
   delete on this collection, and nothing in the app offers to edit one.
   A log that can be quietly rewritten is not evidence of anything.

   Writing an entry must never be the reason an operation fails. The
   change the operator asked for has already happened by the time this
   runs, so a failure here is logged to the platform and swallowed
   rather than surfaced as an error for work that actually succeeded.
   ================================================================ */

const { admin, db } = require('./core');

/* Action names are read by people, in a feed, so they say what happened
   in plain words rather than encoding a table and a verb. */
const ACTIONS = {
  STAFF_CREATED: 'created an account for',
  STAFF_UPDATED: 'updated the account for',
  STAFF_ACTIVATED: 'reactivated the account for',
  STAFF_DEACTIVATED: 'deactivated the account for',
  STAFF_ROLE_CHANGED: 'changed the role of',
  STAFF_PASSWORD_RESET: 'reset the password for',
};

/* The actor's name is copied in rather than looked up when the feed is
   read. A log entry describes a moment: if that person is later renamed
   or removed, the entry should still say who did it at the time. */
async function actorName(uid) {
  try {
    const snap = await db.collection('users').doc(uid).get();
    return (snap.exists && snap.data().fullName) || 'Unknown user';
  } catch (err) {
    return 'Unknown user';
  }
}

async function record({ actorUid, action, targetId, targetName, detail }) {
  try {
    await db.collection('audit_log').add({
      actorUid,
      actorName: await actorName(actorUid),
      action,
      actionLabel: ACTIONS[action] || action,
      targetId: targetId || '',
      targetName: targetName || '',
      detail: detail || '',
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Could not write an audit entry for', action, err.message);
  }
}

module.exports = { record, ACTIONS };
