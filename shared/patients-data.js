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
  getDocs,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

import {
  BARANGAYS,
  calcScore,
  scoreToLevel,
  sourceToVisitLabel,
  patientToView,
  recordToHistory,
  toDate,
} from './patients-schema.js';

/* Stable references — filled, never reassigned. See the note above. */
const PATIENTS = [];
const PENDING_PATIENTS = [];

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

  replaceContents(PATIENTS, views.filter((p) => p.status !== 'pending'));
  replaceContents(PENDING_PATIENTS, views.filter((p) => p.status === 'pending'));
}

async function load() {
  const [patientSnap, recordSnap] = await Promise.all([
    getDocs(collection(db, 'patients')),
    getDocs(collection(db, 'health_records')),
  ]);

  rawPatients = new Map();
  patientSnap.forEach((d) => rawPatients.set(d.id, d.data()));

  rawRecords = new Map();
  recordSnap.forEach((d) => {
    const data = d.data();
    const pid = data.patientId;
    if (!pid) return;
    if (!rawRecords.has(pid)) rawRecords.set(pid, []);
    rawRecords.get(pid).push(recordToHistory(d.id, data));
  });

  rebuild();
}

function announce() {
  window.dispatchEvent(new CustomEvent('diacare:patients-loaded', {
    detail: { patients: PATIENTS.length, pending: PENDING_PATIENTS.length },
  }));
}

/* Resolves once, whether or not the load succeeded — a page that awaits
   this should still render, empty, rather than hang. The failure is
   surfaced on the object so a page can say so. */
let loadError = null;

const ready = load()
  .then(() => { announce(); })
  .catch((err) => {
    loadError = err;
    console.error('Could not load patients from Firestore:', err);
    announce();
  });

/* Pull fresh data after a write, so a second page showing the same
   roster is not left stale. */
async function refresh() {
  try {
    await load();
  } catch (err) {
    loadError = err;
    console.error('Could not refresh patients:', err);
  }
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

  return patient;
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
    address: patient.address || '',
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
    riskLevel: patient.risk || 'normal',
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

  const payload = {
    patientId,
    bhwId: visit.bhwId || '',
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
  calcScore,
  scoreToLevel,
  sourceToVisitLabel,
};
