/* ================================================================
   DiaCare — audit entries for work done in the browser

   Staff account changes go through the API, which writes their own
   audit entries with the Admin SDK. Patient work does not: the
   dashboard writes patients and health_records to Firestore directly,
   so those changes were invisible in System Activity — a nurse could
   register a patient and nothing appeared.

   The rules let a signed-in user append here, but only with actorUid
   equal to their own uid, and never update or delete. So someone can
   record that they did something, and cannot record that somebody else
   did, or erase what they did. That is the honest limit of a log
   written by the client that also writes the data being logged.
   ================================================================ */

import { auth, db } from './firebase.js';
import {
  collection,
  addDoc,
  doc,
  getDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

/* Phrased to read as a sentence after the actor's name, matching the
   labels the API writes for staff changes. */
const ACTIONS = {
  PATIENT_CREATED: 'registered patient',
  VISIT_RECORDED: 'recorded a visit for',
  PATIENT_FLAGGED: 'flagged for follow-up',
  PATIENT_UNFLAGGED: 'cleared the follow-up flag on',
  PATIENT_APPROVED: 'approved the registration of',
  PATIENT_REJECTED: 'rejected the registration of',
  PATIENT_ASSIGNED: 'assigned a field worker to',
  VISIT_CORRECTED: 'corrected a visit for',
};

/* Looked up once. The name is copied into each entry rather than joined
   on read, so an entry still says who did it after that person is
   renamed — the same reason the server-side log copies it. */
let cachedName = null;

async function actorName(uid) {
  if (cachedName) return cachedName;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    cachedName = (snap.exists() && snap.data().fullName) || auth.currentUser?.email || 'Unknown user';
  } catch (err) {
    cachedName = auth.currentUser?.email || 'Unknown user';
  }
  return cachedName;
}

export async function recordActivity(action, { targetId, targetName, detail } = {}) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    await addDoc(collection(db, 'audit_log'), {
      /* Must equal the caller's uid or the rules reject the write. */
      actorUid: user.uid,
      actorName: await actorName(user.uid),
      action,
      actionLabel: ACTIONS[action] || action,
      targetId: targetId || '',
      targetName: targetName || '',
      detail: detail || '',
      at: serverTimestamp(),
    });
  } catch (err) {
    /* Never fail the operation being logged. The patient was already
       saved by the time this runs; losing the log line is worse than
       nothing but far better than losing the record. */
    console.error('Could not record activity for', action, err);
  }
}
