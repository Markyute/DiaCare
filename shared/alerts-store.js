/* ================================================================
   DiaCare — shared alert store

   One collection both halves read and write. Before this, the app kept
   its own notifications on the device and the dashboard recomputed a
   list from the readings each time it loaded, so an alert raised on a
   BHW's phone never reached the RHU, and one acknowledged at the RHU
   kept nagging the worker standing in front of the patient.

   Ids are deterministic — patientId__type — so the same condition
   raised from two places is one document, not two alerts about the same
   person. Raising an alert that already exists updates it rather than
   duplicating it, and a condition that has cleared is resolved rather
   than deleted: an alert is a record that something was flagged, and
   erasing it loses that it ever happened.
   ================================================================ */

import { db } from './firebase.js';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

export const ALERT_TYPES = {
  CRITICAL: 'critical',
  AT_RISK: 'atrisk',
  NO_VISIT: 'no_visit',
};

/* One open alert per patient per kind. Two devices noticing the same
   high reading write the same id. */
export function alertId(patientId, type) {
  return `${patientId}__${type}`;
}

/* Raise or refresh an alert. `trigger` is the sentence a person reads,
   so it is written by whichever half noticed rather than reconstructed
   later from fields. */
export async function raiseAlert({ patientId, patientName, barangay, type, trigger, source }) {
  if (!patientId || !type) return;

  await setDoc(
    doc(db, 'alerts', alertId(patientId, type)),
    {
      patientId,
      patientName: patientName || '',
      barangay: barangay || '',
      type,
      trigger: trigger || '',
      source: source || 'web',
      resolved: false,
      updatedAt: serverTimestamp(),
      /* Only set when the document is first created, so re-raising does
         not keep resetting how long this has been outstanding. */
      ...(await firstSeen(patientId, type)),
    },
    { merge: true },
  );
}

const seen = new Set();

async function firstSeen(patientId, type) {
  const id = alertId(patientId, type);
  if (seen.has(id)) return {};
  seen.add(id);
  return { raisedAt: serverTimestamp() };
}

/* The condition has cleared — a normal reading, or a visit that answers
   a no-visit alert. Kept, not removed. */
export async function resolveAlert(patientId, type) {
  try {
    await updateDoc(doc(db, 'alerts', alertId(patientId, type)), {
      resolved: true,
      resolvedAt: serverTimestamp(),
    });
  } catch (err) {
    /* Nothing to resolve is the normal case, not a failure. */
  }
}

/* Acknowledging is deliberately not resolving: the nurse has seen it,
   the patient is still at risk. Both halves show acknowledged alerts
   differently from open ones rather than hiding them. */
export async function acknowledgeAlert(patientId, type, actorName) {
  await setDoc(
    doc(db, 'alerts', alertId(patientId, type)),
    {
      acknowledged: true,
      acknowledgedBy: actorName || '',
      acknowledgedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/* Live, because an alert is time-sensitive by definition. */
export function watchAlerts(onChange) {
  return onSnapshot(
    collection(db, 'alerts'),
    (snap) => {
      const rows = snap.docs.map((d) => {
        const a = d.data();
        return {
          id: d.id,
          patientId: a.patientId || '',
          patientName: a.patientName || '',
          barangay: a.barangay || '',
          type: a.type || 'critical',
          trigger: a.trigger || '',
          source: a.source || 'web',
          resolved: a.resolved === true,
          acknowledged: a.acknowledged === true,
          acknowledgedBy: a.acknowledgedBy || '',
          raisedAt: a.raisedAt?.toDate ? a.raisedAt.toDate() : null,
        };
      });
      onChange(rows);
    },
    (err) => {
      console.error('Lost the alerts subscription:', err);
      onChange([]);
    },
  );
}
