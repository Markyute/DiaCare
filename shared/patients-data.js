/* ================================================================
   DiaCare — Shared Patient Roster

   Every patient-related figure on the site comes from here: Dashboard,
   Patient Monitoring, Reports, High-Risk Alerts, Risk Analysis, Trends,
   and the stat tiles. One source, so the same person is counted the
   same way everywhere.

   This used to be a hand-written array with localStorage patches on
   top. It now reads the Firestore collections the mobile app writes to,
   which is what makes a household visit recorded on a BHW's phone show
   up on this dashboard at all.

   Two things about how it loads are load-bearing:

     - PATIENTS and PENDING_PATIENTS are the SAME array objects for the
       life of the page. They start empty and are filled in place. Pages
       capture these references at parse time, before any data has
       arrived, so replacing the arrays would leave every page holding
       an empty one forever.

     - Pages render immediately with nothing, then re-render on the
       'diacare:patients-loaded' event. Awaiting DiaCarePatients.ready
       does the same thing where a page would rather wait.
   ================================================================ */

import { db } from './firebase.js';
import {
  collection,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

import { recordActivity } from './audit-client.js';
import { raiseAlert, resolveAlert, ALERT_TYPES } from './alerts-store.js';
import { notifyBhw } from './api.js';
import {
  BARANGAYS,
  calcScore,
  scoreToLevel,
  riskMeta,
  sourceToVisitLabel,
  patientToView,
  recordToHistory,
  toDate,
} from './patients-schema.js';

/* Stable references — filled, never reassigned. See the note above. */
const PATIENTS = [];
const PENDING_PATIENTS = [];
/* Rejected registrations. Kept rather than dropped on the floor: the
   record of a refusal is worth having, and a page that wants to show
   one now has somewhere to read it from. */
const REJECTED_PATIENTS = [];

let loadError = null;

/* Kept so a mutation can rebuild one patient's view without refetching
   the whole roster. */
let rawPatients = new Map();   // id -> Firestore document data
let rawRecords = new Map();    // patientId -> array of mapped history rows

/* ================================================================
   LOAD
   ================================================================ */
function replaceContents(target, items) {
  target.length = 0;
  items.forEach((item) => target.push(item));
}

function rebuild() {
  const views = [];
  rawPatients.forEach((data, id) => {
    views.push(patientToView(id, data, rawRecords.get(id) || []));
  });

  /* Newest first is what a monitoring list wants — the person recorded
     today matters more than the person recorded in March. */
  views.sort((a, b) => (b.lastVisit?.getTime() || 0) - (a.lastVisit?.getTime() || 0));

  /* There is no approval step any more. A patient a BHW registers on a
     household visit lands in the roster the moment their handset syncs,
     the same as one a nurse encodes here — the RHU was reviewing
     registrations it had no way to verify anyway, and the queue only
     meant a patient stayed invisible to the dashboard until someone
     clicked Approve.

     'pending' is still accepted here because patients already sitting
     in the old queue carry it, and older handsets in the field still
     write it on sync. Both read as part of the roster now.

     'inactive' stays out. It is written by rejectPatient, which no
     longer has a caller, but the existing rejected rows should not
     reappear in the monitoring list, the stat tiles and the reports. */
  replaceContents(PATIENTS, views.filter((p) => p.status !== 'inactive'));
  replaceContents(PENDING_PATIENTS, []);
  replaceContents(REJECTED_PATIENTS, views.filter((p) => p.status === 'inactive'));
}

/* Live subscriptions rather than a one-off read. A BHW's phone syncing a
   household visit, or another nurse approving a patient on their own
   laptop, reaches every open dashboard within a second instead of on
   the next refresh — which is the whole point of the bell being a live
   count rather than a snapshot of whenever the page happened to load. */
const RECORD_WINDOW = 5000;

let seenPatients = false;
let seenRecords = false;
let firstLoad;
const firstLoadDone = new Promise((resolve) => { firstLoad = resolve; });

function maybeReady() {
  if (seenPatients && seenRecords) firstLoad();
}

function subscribe() {
  onSnapshot(
    collection(db, 'patients'),
    (snap) => {
      rawPatients = new Map();
      snap.forEach((d) => rawPatients.set(d.id, d.data()));
      seenPatients = true;
      rebuild();
      maybeReady();
      if (seenRecords) announce();
    },
    (err) => {
      loadError = err;
      console.error('Lost the patients subscription:', err);
      seenPatients = true;
      maybeReady();
      announce();
    }
  );

  /* Capped and newest-first rather than the whole collection. Patients
     are bounded by the municipality's population, but visits are not —
     every household round adds more, forever, and an uncapped listener
     re-downloads all of them on every page of the dashboard.

     RECORD_WINDOW is generous enough that no patient's visible history
     is cut short at today's volumes; when it stops being generous the
     fix is a per-patient query on open, not a bigger number. */
  onSnapshot(
    query(
      collection(db, 'health_records'),
      orderBy('visitDate', 'desc'),
      limit(RECORD_WINDOW)
    ),
    (snap) => {
      rawRecords = new Map();
      snap.forEach((d) => {
        const data = d.data();
        const pid = data.patientId;
        if (!pid) return;
        if (!rawRecords.has(pid)) rawRecords.set(pid, []);
        rawRecords.get(pid).push(recordToHistory(d.id, data));
      });
      seenRecords = true;
      rebuild();
      maybeReady();
      if (seenPatients) announce();
    },
    (err) => {
      loadError = err;
      console.error('Lost the health records subscription:', err);
      seenRecords = true;
      maybeReady();
      announce();
    }
  );
}

/* ================================================================
   ALERTS FROM READINGS

   The dashboard used to derive its alert list on every page load and
   keep it in memory, so nothing it noticed ever reached the BHW who
   visits that patient. The same conditions are now written to the
   shared alert store.

   Driven off the roster rather than raised at the moment a reading is
   saved, so a patient who became critical through a visit recorded on a
   phone is flagged here too — the dashboard did not witness that
   reading, but it can see the result.
   ================================================================ */
function syncAlertsFromRoster() {
  PATIENTS.forEach((p) => {
    /* Nothing to say about a patient with no readings yet. Silence is
       correct here: they are not low risk, they are unmeasured. */
    if (!p.glucose || !p.bp) return;

    const [sys, dia] = String(p.bp).split('/').map(Number);
    const detail = `Glucose ${p.glucose} mg/dL · BP ${p.bp} mmHg`;

    if (p.risk === 'critical') {
      const trigger = p.glucose >= 250 ? `Glucose ${p.glucose} mg/dL — critically high`
        : p.glucose < 70 ? `Glucose ${p.glucose} mg/dL — hypoglycemia`
        : `BP ${p.bp} mmHg — hypertension`;
      raiseAlert({
        patientId: p.id, patientName: p.name, barangay: p.barangay,
        type: ALERT_TYPES.CRITICAL,
        trigger,
        source: 'web',
      });
      pushCriticalToBhw(p, trigger);
      resolveAlert(p.id, ALERT_TYPES.AT_RISK);
    } else if (p.risk === 'warning') {
      raiseAlert({
        patientId: p.id, patientName: p.name, barangay: p.barangay,
        type: ALERT_TYPES.AT_RISK, trigger: detail, source: 'web',
      });
      resolveAlert(p.id, ALERT_TYPES.CRITICAL);
    } else {
      /* Back within range — both close rather than disappear, so the
         record that they were once flagged survives. */
      resolveAlert(p.id, ALERT_TYPES.CRITICAL);
      resolveAlert(p.id, ALERT_TYPES.AT_RISK);
    }
  });
}

/* Sends a critical reading to the phone of the worker who visits that
   patient. syncAlertsFromRoster() runs on every snapshot, so this keeps
   its own set of patients already pushed for — without it a worker's
   handset would buzz again every time any record in the collection
   changed. The set lives for the life of the page: the alert is also on
   the dashboard and in the app's own list, so the cost of a missed
   repeat is far lower than the cost of a phone that will not stop. */
const pushedCritical = new Set();

function pushCriticalToBhw(patient, trigger) {
  if (!patient.assignedBhwId) return;
  const key = `${patient.id}:${trigger}`;
  if (pushedCritical.has(key)) return;
  pushedCritical.add(key);

  notifyBhw({
    bhwId: patient.assignedBhwId,
    title: 'High risk: ' + patient.name,
    body: `${trigger}. Follow-up visit recommended.`,
    type: 'high_risk',
    patientId: patient.id,
    patientName: patient.name,
  }).catch((err) => {
    /* Never surfaced to the nurse: the alert is already on screen and in
       the store, and a failed push is not a failed alert. Dropped from
       the set so a later snapshot can try again. */
    pushedCritical.delete(key);
    console.warn('Could not push the alert to the field worker:', err);
  });
}

function announce() {
  window.dispatchEvent(new CustomEvent('diacare:patients-loaded', {
    detail: { patients: PATIENTS.length, pending: PENDING_PATIENTS.length },
  }));
}

/* Resolves once both collections have reported, whether or not they
   succeeded — a page awaiting this should render empty rather than
   hang. The failure is surfaced on the object so a page can say so. */
subscribe();

const ready = firstLoadDone.then(() => {
  announce();
  /* After the first load, not on every snapshot: the writes below cause
     no patient change, but running this on each one would still be a
     write per patient per update. */
  syncAlertsFromRoster();
});

/* Kept for callers that ask for a refresh explicitly. The snapshots
   already keep this current, so there is nothing to re-fetch — just
   re-render from what has arrived. */
async function refresh() {
  rebuild();
  announce();
}

/* ================================================================
   DERIVED VIEWS
   ================================================================ */
function getBarangaySummary() {
  return BARANGAYS.map((name) => {
    const pts = PATIENTS.filter((p) => p.barangay === name);
    const n = pts.length;
    /* Only average over patients who actually have a reading. An
       approved patient with no record yet is a real state — the app
       won't let a BHW log one until approval — and averaging them in as
       zero would drag every barangay's figures down. */
    const withVitals = pts.filter((p) => p.glucose && p.bp);
    const vn = withVitals.length;
    const avgGlucose = vn ? Math.round(withVitals.reduce((s, p) => s + p.glucose, 0) / vn) : 0;
    const bpParts = withVitals.map((p) => p.bp.split('/').map(Number));
    const avgSys = vn ? Math.round(bpParts.reduce((s, b) => s + b[0], 0) / vn) : 0;
    const avgDia = vn ? Math.round(bpParts.reduce((s, b) => s + b[1], 0) / vn) : 0;
    return {
      name,
      patients: n,
      avgGlucose,
      avgSys,
      avgDia,
      avgBP: vn ? avgSys + '/' + avgDia : '—',
      highRisk: pts.filter((p) => p.risk === 'critical').length,
      atRisk: pts.filter((p) => p.risk === 'warning').length,
      normal: pts.filter((p) => p.risk === 'normal').length,
      referrals: pts.filter((p) => p.referral && p.referral !== 'none').length,
    };
  });
}

/* ================================================================
   MUTATIONS

   Each one updates the in-memory view first and writes to Firestore
   after. Callers were written against a synchronous array and do not
   await these; showing the change immediately keeps that contract,
   and a rejected promise surfaces in the console rather than silently
   leaving the screen wrong.
   ================================================================ */

function localPatient(id) {
  return PATIENTS.find((p) => p.id === id) || PENDING_PATIENTS.find((p) => p.id === id);
}

/* Flags were in localStorage, which meant a patient flagged on one
   nurse's laptop was flagged nowhere else. */
function setPatientFlag(patientId, flagged, meta) {
  const patient = localPatient(patientId);
  if (patient) {
    patient.flagged = flagged;
    patient.flagReason = flagged ? meta?.reason : undefined;
    patient.flagNotes = flagged ? meta?.notes : undefined;
  }

  updateDoc(doc(db, 'patients', patientId), {
    flagged: !!flagged,
    flagReason: flagged ? (meta?.reason || '') : '',
    flagNotes: flagged ? (meta?.notes || '') : '',
    updatedAt: serverTimestamp(),
  }).catch((err) => console.error('Could not save the flag:', err));

  recordActivity(flagged ? 'PATIENT_FLAGGED' : 'PATIENT_UNFLAGGED', {
    targetId: patientId,
    targetName: patient?.name || '',
    detail: flagged ? (meta?.reason || '') : '',
  });

  return patient;
}

/* ================================================================
   CORRECTING A VISIT

   A mistyped glucose drives the patient's risk classification, their
   alerts, and every chart they appear in until it is fixed. The app can
   now correct its own visits; this is the same for the RHU, which is
   where the clinical judgement actually sits.

   The record keeps its id, its visit date, and who recorded it — this
   is the same visit with the numbers corrected, not a new one. Writing
   a second record instead would leave the wrong reading in the history
   and in every average taken from it.
   ================================================================ */
async function updateVisit(patientId, recordId, visit) {
  const [sys, dia] = String(visit.bp || '').split('/').map(Number);
  const riskLevel = scoreToLevel(calcScore(Number(visit.glucose), visit.bp));

  const changes = {
    bloodGlucose: Number(visit.glucose) || null,
    systolicBP: Number.isFinite(sys) ? sys : null,
    diastolicBP: Number.isFinite(dia) ? dia : null,
    weight: Number(visit.weight) || null,
    height: Number(visit.height) || null,
    temp: Number(visit.temp) || null,
    bmi: Number(visit.bmi) || null,
    medAdherence: visit.medicationAdherence || '',
    insulinUse: !!visit.insulinUse,
    medicationName: visit.medicationName || '',
    dosage: visit.dosage || '',
    observations: visit.notes || '',
    referral: visit.referral || 'none',
    riskLevel,
    updatedAt: serverTimestamp(),
  };

  await updateDoc(doc(db, 'health_records', recordId), changes);

  /* Risk on the patient reflects their most recent visit. Correcting an
     older one must not stamp a stale classification over the current
     one, so it is only written when this is the newest record. */
  const records = rawRecords.get(patientId) || [];
  const newest = records
    .slice()
    .sort((a, b) => (b.visitDate?.getTime() || 0) - (a.visitDate?.getTime() || 0))[0];
  if (newest && newest.id === recordId) {
    updateDoc(doc(db, 'patients', patientId), {
      riskLevel,
      updatedAt: serverTimestamp(),
    }).catch((err) => console.error('Could not update the patient risk level:', err));
  }

  const subject = rawPatients.get(patientId);
  recordActivity('VISIT_CORRECTED', {
    targetId: patientId,
    targetName: subject
      ? [subject.firstName, subject.lastName].filter(Boolean).join(' ')
      : '',
    detail: changes.bloodGlucose ? 'Glucose ' + changes.bloodGlucose + ' mg/dL' : '',
  });
}

/* ================================================================
   BHW ROSTER + ASSIGNMENT

   A patient's assignedBhwId is the only link between them and a
   handset: the app pulls `patients where assignedBhwId == my uid`.
   A patient encoded here at the RHU is written with an empty one, so
   until a nurse assigns them they exist on this dashboard and on no
   phone at all — the worker covering that purok never learns to visit
   them, and registers them a second time if they meet in the field.
   ================================================================ */
const BHW_ROSTER = [];
let bhwRosterLoaded = false;

async function loadBhwRoster() {
  if (bhwRosterLoaded) return BHW_ROSTER;
  try {
    const snap = await getDocs(
      query(collection(db, 'users'), where('role', '==', 'bhw'))
    );
    replaceContents(BHW_ROSTER, snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: (data.fullName || data.username || 'BHW').trim(),
        barangay: data.barangay || '',
        purok: data.purok || '',
        status: (data.status || 'active').toLowerCase(),
      };
    }).filter((b) => b.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name)));
    bhwRosterLoaded = true;
  } catch (err) {
    console.error('Could not read the BHW roster:', err);
  }
  return BHW_ROSTER;
}

function bhwName(id) {
  if (!id) return '';
  const found = BHW_ROSTER.find((b) => b.id === id);
  return found ? found.name : id;
}

/* The patient's visits carry their own copy of assignedBhwId — it is
   what the app's rules and its pull query read, without paying for a
   lookup per record. Reassigning the patient without moving the visits
   would hand the new worker a patient whose history stops at the
   handover, so both move together in one batch. */
async function assignPatient(patientId, bhwId) {
  const patient = localPatient(patientId);
  if (patient) patient.assignedBhwId = bhwId;

  const stored = rawPatients.get(patientId);
  if (stored) stored.assignedBhwId = bhwId;

  const batch = writeBatch(db);
  batch.update(doc(db, 'patients', patientId), {
    assignedBhwId: bhwId,
    updatedAt: serverTimestamp(),
  });

  try {
    const snap = await getDocs(
      query(collection(db, 'health_records'), where('patientId', '==', patientId))
    );
    snap.docs.forEach((d) => {
      batch.update(d.ref, {
        assignedBhwId: bhwId,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  } catch (err) {
    console.error('Could not assign the patient:', err);
    throw err;
  }

  recordActivity('PATIENT_ASSIGNED', {
    targetId: patientId,
    targetName: patient?.name || '',
    detail: bhwName(bhwId) ? 'Assigned to ' + bhwName(bhwId) : 'Unassigned',
  });
}

function approvePatient(id) {
  const idx = PENDING_PATIENTS.findIndex((p) => p.id === id);
  if (idx !== -1) {
    const [p] = PENDING_PATIENTS.splice(idx, 1);
    p.status = 'active';
    PATIENTS.push(p);
  }
  const stored = rawPatients.get(id);
  if (stored) stored.status = 'approved';

  updateDoc(doc(db, 'patients', id), {
    status: 'approved',
    updatedAt: serverTimestamp(),
  }).catch((err) => console.error('Could not approve the patient:', err));

  recordActivity('PATIENT_APPROVED', { targetId: id, targetName: stored ? [stored.firstName, stored.lastName].filter(Boolean).join(' ') : '' });
}

function rejectPatient(id) {
  const idx = PENDING_PATIENTS.findIndex((p) => p.id === id);
  if (idx !== -1) PENDING_PATIENTS.splice(idx, 1);
  const stored = rawPatients.get(id);
  if (stored) stored.status = 'inactive';

  /* Rejected is stored as inactive rather than deleted. The BHW who
     registered them should be able to see what happened, and a deleted
     row on the phone would just re-sync. */
  updateDoc(doc(db, 'patients', id), {
    status: 'inactive',
    updatedAt: serverTimestamp(),
  }).catch((err) => console.error('Could not reject the patient:', err));

  recordActivity('PATIENT_REJECTED', { targetId: id, targetName: stored ? [stored.firstName, stored.lastName].filter(Boolean).join(' ') : '' });
}

/* Called by the encoding page. That form collects a single "name" and
   an age rather than separate name parts and a date of birth, so both
   are normalised here — the alternative was every reader of the roster
   having to cope with two shapes. */
function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', middleName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], middleName: '', lastName: '' };
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

/* The Flutter model requires a birthDate, so an age-only encoding still
   has to produce one or the app cannot read the record back. January 1
   of the implied year is a placeholder, flagged as approximate so
   nothing downstream mistakes it for a real date of birth. The encoding
   form should collect a real one — see SETUP.md. */
function approximateBirthDate(age) {
  const years = Number(age);
  if (!Number.isFinite(years) || years <= 0) return null;
  return new Date(new Date().getFullYear() - years, 0, 1);
}

async function addEncodedPatient(patient) {
  const parts = patient.firstName || patient.lastName
    ? { firstName: patient.firstName || '', middleName: patient.middleName || '', lastName: patient.lastName || '' }
    : splitName(patient.name);

  const birthDate = toDate(patient.birthDate || patient.dob) || approximateBirthDate(patient.age);

  const payload = {
    ...parts,
    birthDate,
    birthDateApproximate: !(patient.birthDate || patient.dob),
    sex: patient.sex || '',
    barangay: patient.barangay || '',
    purok: patient.purok || '',
    contactNumber: patient.contactNumber || '',
    diabetesType: patient.diabetesType || patient.dmType || '',
    diagnosisDate: toDate(patient.diagnosisDate),
    medications: patient.medications
      || [patient.medicationName, patient.dosage].filter(Boolean).join(' ')
      || '',
    attendingPhysician: patient.attendingPhysician || '',
    emergencyContact: patient.emergencyContactName || '',
    emergencyContactNumber: patient.emergencyContactNumber || '',
    /* Encoded at the RHU, so there is no BHW assigned until one is. */
    assignedBhwId: patient.assignedBhwId || '',
    /* A nurse encoding at the RHU is itself the approval; the pending
       state exists for patients a BHW registered on a household visit. */
    status: 'approved',
    riskLevel: patient.risk || '',
    flagged: false,
    flagReason: '',
    flagNotes: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    source: 'manual',
  };

  const ref = await addDoc(collection(db, 'patients'), payload);
  rawPatients.set(ref.id, payload);
  rawRecords.set(ref.id, []);

  recordActivity('PATIENT_CREATED', {
    targetId: ref.id,
    targetName: [payload.firstName, payload.lastName].filter(Boolean).join(' '),
    detail: payload.barangay ? 'Barangay ' + payload.barangay : '',
  });

  /* The reading entered alongside a new patient is a visit like any
     other. Writing it as a health record is what puts it in their
     Reading History instead of leaving it as current vitals with
     nothing underneath. */
  const firstVisit = Array.isArray(patient.history) ? patient.history[0] : null;
  if (firstVisit) {
    await addVisitToPatient(ref.id, {
      ...firstVisit,
      weight: patient.weight,
      height: patient.height,
      referral: patient.referral,
    });
  } else {
    rebuild();
    announce();
  }

  return localPatient(ref.id);
}

/* Called by the encoding page after a visit is recorded. Writes a
   health_records document — the same collection the app's sync pushes
   into — rather than appending to an array on the patient. */
async function addVisitToPatient(patientId, visit) {
  const [sys, dia] = String(visit.bp || '').split('/').map(Number);

  const owner = rawPatients.get(patientId);

  const payload = {
    patientId,
    /* Who took the reading. Empty for a visit encoded at the RHU, which
       is not a BHW visit at all. */
    bhwId: visit.bhwId || '',
    /* Who follows this patient. Copied from the patient so the BHW's app
       can see RHU visits in the same history — without it the rules hide
       them, and the worker knocks on the door not knowing the patient was
       seen at the health unit last week. */
    assignedBhwId: (owner && owner.assignedBhwId) || '',
    recordedBy: visit.recordedBy || '',
    bloodGlucose: Number(visit.glucose) || null,
    systolicBP: Number.isFinite(sys) ? sys : null,
    diastolicBP: Number.isFinite(dia) ? dia : null,
    weight: Number(visit.weight) || null,
    height: Number(visit.height) || null,
    temp: Number(visit.temp) || null,
    bmi: Number(visit.bmi) || null,
    medAdherence: visit.medicationAdherence || '',
    insulinUse: !!visit.insulinUse,
    medicationName: visit.medicationName || '',
    dosage: visit.dosage || '',
    observations: visit.notes || '',
    referral: visit.referral || 'none',
    riskLevel: scoreToLevel(calcScore(Number(visit.glucose), visit.bp)),
    /* Encoded on this dashboard, so an RHU visit. The app writes 'app'
       for a household visit. */
    source: visit.source || 'manual',
    visitDate: toDate(visit.visitDate) || new Date(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'health_records'), payload);

  const subject = rawPatients.get(patientId);
  recordActivity('VISIT_RECORDED', {
    targetId: patientId,
    targetName: subject ? [subject.firstName, subject.lastName].filter(Boolean).join(' ') : '',
    detail: payload.bloodGlucose ? 'Glucose ' + payload.bloodGlucose + ' mg/dL' : '',
  });

  if (!rawRecords.has(patientId)) rawRecords.set(patientId, []);
  rawRecords.get(patientId).push(recordToHistory(ref.id, payload));

  /* A new reading changes the patient's risk, so the stored summary the
     app reads has to move with it. */
  updateDoc(doc(db, 'patients', patientId), {
    riskLevel: payload.riskLevel,
    updatedAt: serverTimestamp(),
  }).catch((err) => console.error('Could not update the patient risk level:', err));

  rebuild();
  announce();
  return localPatient(patientId);
}

/* ================================================================
   EXPORT

   Kept on window with the same shape the pages already use, so this
   swap did not require rewriting six page scripts.
   ================================================================ */
window.DiaCarePatients = {
  PATIENTS,
  PENDING_PATIENTS,
  REJECTED_PATIENTS,
  BARANGAYS,
  ready,
  refresh,
  get loadError() { return loadError; },
  getBarangaySummary,
  addEncodedPatient,
  addVisitToPatient,
  setPatientFlag,
  approvePatient,
  rejectPatient,
  updateVisit,
  loadBhwRoster,
  bhwName,
  assignPatient,
  BHW_ROSTER,
  calcScore,
  scoreToLevel,
  riskMeta,
  sourceToVisitLabel,
};
