'use strict';
/* ================================================================
   DiaCare RHU Libon — Patient Encoding JavaScript
   Plan B: Manual data entry when mobile app is unavailable
   ================================================================ */

/* ── Session Guard ──
   Lives in shared/auth-guard.js now, loaded from this page's HTML. It
   checks the Firebase session and the verified-code claim rather than a
   localStorage flag any visitor could set from the console. */

/* ── Clock ── */
function updateClock() {
  const now = new Date();
  const c = document.getElementById('topbarClock');
  const d = document.getElementById('topbarDate');
  if (c) c.textContent = now.toLocaleTimeString('en-PH',
    { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (d) d.textContent = now.toLocaleDateString('en-PH',
    { month: 'short', day: 'numeric', year: 'numeric' });
}
updateClock();
setInterval(updateClock, 1000);

/* ── Mobile Nav Toggle ── */
const topnavEl = document.getElementById('topnav');
const menuToggle = document.getElementById('menuToggle');
menuToggle?.addEventListener('click', () => topnavEl?.classList.toggle('nav-open'));
document.addEventListener('click', (e) => {
  if (topnavEl?.classList.contains('nav-open') && !topnavEl.contains(e.target))
    topnavEl.classList.remove('nav-open');
});

/* Notification bell wiring now lives in ../shared/notifications.js
   so every page shows the same alerts and behaves the same way. */
renderTopNavNotifications();
initNotifDropdown();

/* ================================================================
   STATE
   ================================================================ */
let encodedPatients = [];
let encodedCount = 0;

/* ================================================================
   AUTO-GENERATE PATIENT ID
   ================================================================ */
/* The record's id is the Firestore document id, assigned on save — the
   same id the app carries for that patient and Patient Monitoring shows.
   This used to mint 'P-' plus four random digits before anything was
   saved: two encodings could collide, and the number never matched the
   id anywhere else on the site. */
const ID_PENDING = 'Assigned on save';
function generateId() {
  return ID_PENDING;
}

window.addEventListener('load', () => {
  // Arriving via Patient Monitoring's "+ Add RHU Visit" button
  // (?patient=P-0001) pre-selects that patient in Existing Patient
  // mode instead of the usual blank New Patient form — skips the
  // nurse having to re-search for someone whose profile they were
  // just looking at.
  const patientId = new URLSearchParams(window.location.search).get('patient');
  const preselected = patientId && window.DiaCarePatients
    ? window.DiaCarePatients.PATIENTS.find(p => p.id === patientId)
    : null;

  if (preselected) {
    encodingMode = 'existing';
    document.getElementById('modeExisting').checked = true;
    document.getElementById('existingPatientFieldWrap')?.classList.remove('hidden');
    selectedExistingPatient = preselected;
    document.getElementById('existingPatientSelected').textContent = `${preselected.name} — ${preselected.id}`;
    document.getElementById('existingPatientTrigger')?.classList.add('has-value');
    populateFromExistingPatient(preselected);
  } else {
    document.getElementById('patientId').value = generateId();
  }
});

/* ================================================================
   GLUCOSE INDICATOR — live feedback as nurse types
   ================================================================ */
document.getElementById('glucose')?.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  const ind = document.getElementById('glucoseIndicator');
  if (!ind) return;

  if (!val || isNaN(val)) {
    ind.className = 'enc-indicator hidden'; return;
  }

  let cls = '', icon = '', msg = '';
  if (val >= 250) {
    cls = 'enc-indicator--critical'; icon = 'fa-circle-exclamation';
    msg = `Critical High — ${val} mg/dL. Immediate attention required.`;
  } else if (val < 70) {
    cls = 'enc-indicator--critical'; icon = 'fa-circle-exclamation';
    msg = `Critical Low (Hypoglycemia) — ${val} mg/dL. Immediate attention required.`;
  } else if (val >= 180) {
    cls = 'enc-indicator--warning'; icon = 'fa-triangle-exclamation';
    msg = `Elevated — ${val} mg/dL. Patient is At Risk.`;
  } else {
    cls = 'enc-indicator--normal'; icon = 'fa-circle-check';
    msg = `Normal range — ${val} mg/dL.`;
  }

  ind.className = `enc-indicator ${cls}`;
  ind.innerHTML = `<i class="fa-solid ${icon}"></i> ${msg}`;
  updateRiskPreview();
});

/* ================================================================
   BLOOD PRESSURE INDICATOR — live feedback
   ================================================================ */
function checkBP() {
  const sys = parseFloat(document.getElementById('bpSystolic')?.value);
  const dia = parseFloat(document.getElementById('bpDiastolic')?.value);
  const ind = document.getElementById('bpIndicator');
  if (!ind) return;

  if (!sys || !dia || isNaN(sys) || isNaN(dia)) {
    ind.className = 'enc-indicator hidden'; return;
  }

  let cls = '', icon = '', msg = '';
  if (sys >= 140 || dia >= 90) {
    cls = 'enc-indicator--critical'; icon = 'fa-circle-exclamation';
    msg = `Hypertension — ${sys}/${dia} mmHg. High blood pressure.`;
  } else if (sys >= 120 || dia >= 80) {
    cls = 'enc-indicator--warning'; icon = 'fa-triangle-exclamation';
    msg = `Elevated BP — ${sys}/${dia} mmHg. Monitor closely.`;
  } else {
    cls = 'enc-indicator--normal'; icon = 'fa-circle-check';
    msg = `Normal BP — ${sys}/${dia} mmHg.`;
  }

  ind.className = `enc-indicator ${cls}`;
  ind.innerHTML = `<i class="fa-solid ${icon}"></i> ${msg}`;
  updateRiskPreview();
}

document.getElementById('bpSystolic')?.addEventListener('input', checkBP);
document.getElementById('bpDiastolic')?.addEventListener('input', checkBP);

/* ================================================================
   BMI DISPLAY — live-computed from Weight/Height as the nurse types.
   Same formula savePatient() already used internally; this just
   surfaces it instead of only computing it silently at save time.
   ================================================================ */
function updateBmiDisplay() {
  const weightKg = parseFloat(document.getElementById('weight')?.value);
  const heightM = parseFloat(document.getElementById('height')?.value) / 100;
  const bmiField = document.getElementById('bmiDisplay');
  if (!bmiField) return;
  if (!(weightKg > 0) || !(heightM > 0)) {
    bmiField.value = '';
    return;
  }
  bmiField.value = (Math.round((weightKg / (heightM * heightM)) * 10) / 10).toString();
}
document.getElementById('weight')?.addEventListener('input', updateBmiDisplay);
document.getElementById('height')?.addEventListener('input', updateBmiDisplay);

/* ================================================================
   PATIENT MODE — New Patient (default) vs Existing Patient. Existing
   mode logs a follow-up visit against someone already in the shared
   roster instead of registering a duplicate; see savePatient() below.
   ================================================================ */
let encodingMode = 'new';
let selectedExistingPatient = null;

const identityFieldIds = ['firstName', 'middleName', 'lastName', 'patientDob',
  'patientSex', 'patientPurok', 'patientContact',
  'emergencyName', 'emergencyNumber'];

function setIdentityFieldsLocked(locked) {
  identityFieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el[locked ? 'setAttribute' : 'removeAttribute']('readonly', 'readonly');
    if (el && el.tagName === 'SELECT') el.disabled = locked;
  });
  // Barangay uses the custom dropdown trigger, not a native input/select.
  const barangayTrigger = document.getElementById('barangayTrigger');
  if (barangayTrigger) {
    barangayTrigger.classList.toggle('disabled', locked);
    barangayTrigger.tabIndex = locked ? -1 : 0;
  }
}

/* Age is displayed, never typed — a typed age is wrong a year later,
   and the record stores a birth date regardless. */
function ageFromDob(value) {
  if (!value) return null;
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const months = now.getMonth() - dob.getMonth();
  if (months < 0 || (months === 0 && now.getDate() < dob.getDate())) years--;
  return years;
}

function refreshAgeDisplay() {
  const dob = document.getElementById('patientDob')?.value;
  const age = ageFromDob(dob);
  const ageEl = document.getElementById('patientAge');
  if (ageEl) ageEl.value = (age === null || age < 0) ? '' : String(age);
}

document.getElementById('patientDob')?.addEventListener('change', refreshAgeDisplay);
document.getElementById('patientDob')?.addEventListener('input', refreshAgeDisplay);

/* A date of birth cannot be in the future; the browser enforces it as
   well as the validator so the picker itself refuses. */
(function capDobToToday() {
  const el = document.getElementById('patientDob');
  if (el) el.max = new Date().toISOString().slice(0, 10);
})();

function toDateInputValue(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  /* Built from local parts rather than toISOString, which shifts to UTC
     and can land on the previous day in a +08:00 timezone. */
  const pad = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function populateFromExistingPatient(patient) {
  document.getElementById('firstName').value = patient.firstName ?? '';
  document.getElementById('middleName').value = patient.middleName ?? '';
  document.getElementById('lastName').value = patient.lastName ?? '';
  document.getElementById('patientId').value = patient.id;
  document.getElementById('patientDob').value = toDateInputValue(patient.birthDate);
  refreshAgeDisplay();
  document.getElementById('patientSex').value = patient.sex ?? '';
  document.getElementById('patientPurok').value = patient.purok ?? '';
  document.getElementById('patientContact').value = patient.contactNumber ?? '';
  document.getElementById('emergencyName').value = patient.emergencyContactName ?? '';
  document.getElementById('emergencyNumber').value = patient.emergencyContactNumber ?? '';
  document.getElementById('diagnosisDate').value = toDateInputValue(patient.diagnosisDateRaw);
  document.getElementById('attendingPhysician').value = patient.attendingPhysician ?? '';
  const hiddenBarangay = document.getElementById('patientBarangay');
  const selSpan = document.getElementById('barangaySelected');
  if (hiddenBarangay) hiddenBarangay.value = patient.barangay ?? '';
  if (selSpan) selSpan.textContent = patient.barangay ?? 'Select barangay...';
  document.getElementById('barangayTrigger')?.classList.toggle('has-value', !!patient.barangay);
  setIdentityFieldsLocked(true);
}

function clearExistingPatientSelection() {
  selectedExistingPatient = null;
  document.getElementById('existingPatientSelected').textContent = 'Search by name or Patient ID...';
  document.getElementById('existingPatientTrigger')?.classList.remove('has-value');
}

document.querySelectorAll('input[name="encodingMode"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    encodingMode = e.target.value;
    const searchWrap = document.getElementById('existingPatientFieldWrap');
    searchWrap?.classList.toggle('hidden', encodingMode !== 'existing');

    if (encodingMode === 'new') {
      clearExistingPatientSelection();
      setIdentityFieldsLocked(false);
      ['firstName', 'middleName', 'lastName', 'patientDob', 'patientPurok',
        'patientContact', 'emergencyName', 'emergencyNumber',
        'diagnosisDate', 'attendingPhysician', 'patientAge'].forEach((fid) => {
        const el = document.getElementById(fid);
        if (el) el.value = '';
      });
      document.getElementById('patientId').value = generateId();
      document.getElementById('patientSex').value = '';
      const hiddenBarangay = document.getElementById('patientBarangay');
      if (hiddenBarangay) hiddenBarangay.value = '';
      document.getElementById('barangaySelected').textContent = 'Select barangay...';
      document.getElementById('barangayTrigger')?.classList.remove('has-value');
    } else {
      setIdentityFieldsLocked(true);
    }
    document.getElementById('errExistingPatient')?.classList.add('hidden');
  });
});

/* ── Existing-patient search dropdown — same open/close/search
   pattern as the Barangay dropdown below, searching the shared
   roster (window.DiaCarePatients.PATIENTS) instead of a fixed list. */
const epTrigger = document.getElementById('existingPatientTrigger');
const epDropdown = document.getElementById('existingPatientDropdown');
const epArrow = document.getElementById('existingPatientArrow');
const epSearch = document.getElementById('existingPatientSearch');
const epList = document.getElementById('existingPatientList');
const epSelected = document.getElementById('existingPatientSelected');

function renderExistingPatientList(filter = '') {
  const roster = window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : [];
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? roster.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
    : roster;

  if (filtered.length === 0) {
    epList.innerHTML = '<li class="no-results">No patient found</li>';
    return;
  }
  epList.innerHTML = filtered.slice(0, 50).map(p =>
    `<li data-id="${p.id}">${p.name} — ${p.id} · Brgy. ${p.barangay}</li>`
  ).join('');
  epList.querySelectorAll('li[data-id]').forEach(li => {
    li.addEventListener('click', () => {
      const patient = roster.find(p => p.id === li.dataset.id);
      if (!patient) return;
      selectedExistingPatient = patient;
      epSelected.textContent = `${patient.name} — ${patient.id}`;
      epTrigger.classList.add('has-value');
      epTrigger.classList.remove('error');
      document.getElementById('errExistingPatient')?.classList.add('hidden');
      populateFromExistingPatient(patient);
      closeExistingPatientDropdown();
    });
  });
}

function openExistingPatientDropdown() {
  epDropdown.classList.remove('hidden');
  epTrigger.classList.add('open');
  epArrow.classList.add('open');
  epSearch.value = '';
  renderExistingPatientList();
  setTimeout(() => epSearch.focus(), 50);
}

function closeExistingPatientDropdown() {
  epDropdown.classList.add('hidden');
  epTrigger.classList.remove('open');
  epArrow.classList.remove('open');
}

epTrigger?.addEventListener('click', () => {
  epDropdown.classList.contains('hidden') ? openExistingPatientDropdown() : closeExistingPatientDropdown();
});
epTrigger?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openExistingPatientDropdown(); }
  if (e.key === 'Escape') closeExistingPatientDropdown();
});
epSearch?.addEventListener('input', () => renderExistingPatientList(epSearch.value));
document.addEventListener('click', (e) => {
  if (!document.getElementById('existingPatientWrap')?.contains(e.target)) {
    closeExistingPatientDropdown();
  }
});

/* ================================================================
   RISK PREVIEW — side panel live update
   ================================================================ */
function updateRiskPreview() {
  const glucose = parseFloat(document.getElementById('glucose')?.value);
  const sys = parseFloat(document.getElementById('bpSystolic')?.value);
  const dia = parseFloat(document.getElementById('bpDiastolic')?.value);
  const body = document.getElementById('riskPreviewBody');
  if (!body) return;

  if (!glucose && !sys) {
    body.innerHTML = `<div class="enc-risk-empty">
      <i class="fa-solid fa-droplet"></i>
      <p>Enter glucose and blood pressure to see the risk assessment</p>
    </div>`;
    return;
  }

  let risk = 'normal', riskLabel = 'Normal', riskIcon = 'fa-circle-check';
  const details = [];

  // Badge/label comes from the same shared formula as everywhere else on
  // the site (and matches getRisk(), used at actual save time) — the
  // per-line "details" below stay as plain-language explanations of why,
  // using the same cutoffs, so the reasoning and the verdict never drift
  // apart from each other again.
  // Whichever of glucose/BP hasn't been typed in yet is filled with a
  // safely-normal placeholder rather than 0, so a lone glucose reading
  // (before BP is entered) can still show its real risk immediately,
  // without a blank BP field being misread as "BP of 0".
  const safeGlucose = glucose > 0 ? glucose : 100;
  const safeSys = sys > 0 ? sys : 110;
  const safeDia = dia > 0 ? dia : 70;
  risk = getRisk(safeGlucose, safeSys, safeDia);
  riskLabel = risk === 'critical' ? 'Highly At Risk' : risk === 'warning' ? 'At Risk' : 'Normal';
  riskIcon = risk === 'critical' ? 'fa-circle-exclamation' :
    risk === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-check';

  if (glucose >= 250) {
    details.push(`Glucose ${glucose} mg/dL — critically high (≥250)`);
  } else if (glucose < 70 && glucose > 0) {
    details.push(`Glucose ${glucose} mg/dL — hypoglycemia (<70)`);
  } else if (glucose >= 180) {
    details.push(`Glucose ${glucose} mg/dL — elevated`);
  } else if (glucose > 0) {
    details.push(`Glucose ${glucose} mg/dL — normal`);
  }

  if (sys >= 140 || dia >= 90) {
    details.push(`BP ${sys}/${dia} mmHg — hypertension`);
  } else if (sys >= 120 || dia >= 80) {
    details.push(`BP ${sys}/${dia} mmHg — elevated`);
  } else if (sys > 0) {
    details.push(`BP ${sys}/${dia} mmHg — normal`);
  }

  body.innerHTML = `
    <div class="enc-risk-result">
      <div class="enc-risk-badge enc-risk-badge--${risk}">
        <i class="fa-solid ${riskIcon}"></i> ${riskLabel}
      </div>
      <div class="enc-risk-detail">${details.join('<br>')}</div>
    </div>`;
}

/* ================================================================
   VALIDATION
   ================================================================ */
function validate() {
  let valid = true;

  if (encodingMode === 'existing' && !selectedExistingPatient) {
    document.getElementById('existingPatientTrigger')?.classList.add('error');
    document.getElementById('errExistingPatient')?.classList.remove('hidden');
    valid = false;
  } else {
    document.getElementById('existingPatientTrigger')?.classList.remove('error');
    document.getElementById('errExistingPatient')?.classList.add('hidden');
  }

  const fields = [
    {
      id: 'firstName', errId: 'errFirstName',
      msg: 'First name is required.',
      fn: v => v.trim().length >= 2
    },
    {
      id: 'lastName', errId: 'errLastName',
      msg: 'Last name is required.',
      fn: v => v.trim().length >= 2
    },
    {
      /* Bounded rather than merely present: a mistyped year is the
         common error here, and 120+ or a future date is always one. */
      id: 'patientDob', errId: 'errDob',
      msg: 'A valid date of birth is required.',
      fn: v => {
        const age = ageFromDob(v);
        return age !== null && age >= 0 && age <= 120;
      }
    },
    {
      id: 'patientSex', errId: 'errSex',
      msg: 'Sex is required.',
      fn: v => v !== ''
    },
    {
      id: 'patientBarangay', errId: 'errBarangay',
      msg: 'Barangay is required.',
      fn: v => v !== ''
    },
    {
      id: 'glucose', errId: 'errGlucose',
      msg: 'Valid glucose (20–600) required.',
      fn: v => v && !isNaN(v) && v >= 20 && v <= 600
    },
  ];

  fields.forEach(({ id, errId, msg, fn }) => {
    const input = document.getElementById(id);
    const err = document.getElementById(errId);
    if (!fn(input?.value)) {
      input?.classList.add('error');
      if (err) { err.textContent = msg; err.classList.remove('hidden'); }
      valid = false;
    } else {
      input?.classList.remove('error');
      err?.classList.add('hidden');
    }
  });

  /* Blood pressure */
  const sys = document.getElementById('bpSystolic')?.value;
  const dia = document.getElementById('bpDiastolic')?.value;
  const errBp = document.getElementById('errBp');
  if (!sys || !dia || isNaN(sys) || isNaN(dia)) {
    document.getElementById('bpSystolic')?.classList.add('error');
    document.getElementById('bpDiastolic')?.classList.add('error');
    if (errBp) {
      errBp.textContent = 'Valid blood pressure required.';
      errBp.classList.remove('hidden');
    }
    valid = false;
  } else {
    document.getElementById('bpSystolic')?.classList.remove('error');
    document.getElementById('bpDiastolic')?.classList.remove('error');
    errBp?.classList.add('hidden');
  }

  return valid;
}

/* ================================================================
   GET RISK — delegates to the same scoring formula every other page
   uses (shared/patients-data.js), instead of a separate local rule.
   Previously this page's own if/else chain could disagree with the
   shared formula on the same numbers (e.g. glucose 200 + BP 145/95
   came out "At Risk" here but "Critical" everywhere else).
   ================================================================ */
function getRisk(glucose, sys, dia) {
  if (!window.DiaCarePatients) return 'normal'; // shared script failed to load — fail safe, not silently wrong
  const score = window.DiaCarePatients.calcScore(glucose, `${sys}/${dia}`);
  return window.DiaCarePatients.scoreToLevel(score);
}

/* ================================================================
   RECORDED BY — same top-nav name every page already shows (set via
   Settings > Account Profile, see shared/profile.js), same fallback
   dashboard.js's greeting uses when no profile has been saved yet.
   Everything encoded on this page is by definition RHU Nurse work —
   BHWs never touch this page, only the mobile app.
   ================================================================ */
function getRecordedByName() {
  const navName = document.getElementById('navUserName')?.textContent.trim();
  if (!navName || navName === 'RHU Nurse') return 'RHU Nurse';
  return `RHU Nurse ${navName}`;
}

/* ================================================================
   SAVE PATIENT
   ================================================================ */
async function savePatient(action) {
  if (!validate()) {
    showToast('Please fill in all required fields.', '#ef4444');
    return;
  }

  const firstName = document.getElementById('firstName').value.trim();
  const middleName = document.getElementById('middleName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  const name = [firstName, middleName, lastName].filter(Boolean).join(' ');
  const id = document.getElementById('patientId').value;
  const dob = document.getElementById('patientDob').value;
  const age = ageFromDob(dob);
  const purok = document.getElementById('patientPurok').value.trim();
  const contactNumber = document.getElementById('patientContact').value.trim();
  const emergencyContactName = document.getElementById('emergencyName').value.trim();
  const emergencyContactNumber = document.getElementById('emergencyNumber').value.trim();
  const diagnosisDate = document.getElementById('diagnosisDate').value;
  const attendingPhysician = document.getElementById('attendingPhysician').value.trim();
  const sex = document.getElementById('patientSex').value;
  const barangay = document.getElementById('patientBarangay').value;
  const assignedBhwId = document.getElementById('assignedBhw')?.value || '';
  const glucose = parseFloat(document.getElementById('glucose').value);
  const sys = parseFloat(document.getElementById('bpSystolic').value);
  const dia = parseFloat(document.getElementById('bpDiastolic').value);
  const weight = document.getElementById('weight').value;
  const height = document.getElementById('height').value;
  const dmType = document.getElementById('diabetesType').value;
  const medicationName = document.getElementById('medicationName').value;
  const dosage = document.getElementById('dosage').value;
  const insulinUse = document.getElementById('insulinUse').value;
  const medicationAdherence = document.getElementById('medicationAdherence').value;
  const referral = document.querySelector('input[name="referral"]:checked')?.value || 'no';
  const notes = document.getElementById('notes').value;
  const risk = getRisk(glucose, sys, dia);
  const time = new Date().toLocaleTimeString('en-PH',
    { hour: '2-digit', minute: '2-digit' });

  // Same BMI formula the app uses (kg / (height in meters)^2), computed
  // here instead of collecting height/weight and never actually using
  // them — height/weight alone don't tell a BHN anything on their own.
  const heightM = parseFloat(height) / 100;
  const weightKg = parseFloat(weight);
  const bmi = (heightM > 0 && weightKg > 0) ? Math.round((weightKg / (heightM * heightM)) * 10) / 10 : null;

  // Every visit encoded on this page — whether it's a brand-new patient's
  // first reading or a follow-up for someone already in the roster — was
  // entered by whoever's signed in here, i.e. the RHU Nurse, never a BHW
  // (BHW submissions only ever come through the mobile app). Field names
  // match every other history entry exactly (see shared/patients-data.js
  // RAW_PATIENTS) so Patient Monitoring's detail view renders it
  // identically to an app-submitted visit.
  const datetime = `${new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })} ${time}`;
  const historyEntry = {
    datetime, glucose, bp: `${sys}/${dia}`, status: risk, source: 'manual',
    medicationName: medicationName || undefined,
    dosage: dosage || undefined,
    insulinUse: insulinUse ? insulinUse === 'yes' : undefined,
    medicationAdherence: medicationAdherence || undefined,
    bmi: bmi || undefined,
    notes: notes || undefined,
    recordedBy: getRecordedByName(),
  };

  const patient = {
    id, name, age, sex, barangay, glucose,
    firstName, middleName, lastName,
    birthDate: dob,
    purok, contactNumber, assignedBhwId,
    emergencyContactName, emergencyContactNumber,
    diagnosisDate, attendingPhysician,
    bp: `${sys}/${dia}`, weight, height, bmi,
    dmType, medicationName, dosage, insulinUse, medicationAdherence,
    referral, notes,
    risk, source: 'manual', time,
    initials: name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(),
    color: risk === 'critical' ? '#ef4444' : risk === 'warning' ? '#f59e0b' : '#10b981',
    // Without this, a freshly-registered patient's own first reading —
    // the one just entered above — never showed up in their own Reading
    // History on Patient Monitoring; the row existed only as "current
    // vitals" with nothing underneath it.
    history: [historyEntry],
  };

  if (window.DiaCarePatients) {
    if (encodingMode === 'existing' && selectedExistingPatient) {
      // Logging a follow-up for someone already in the roster (added by a
      // BHW, or a prior encoding) — append a history entry to *their*
      // record instead of registering a duplicate patient under a new ID.
      window.DiaCarePatients.addVisitToPatient(id, { ...historyEntry, weight, height, referral, time });
    } else {
      // Previously this only grew a private array used for this page's
      // own "Encoded today" counter — the patient never reached
      // Dashboard, Patient Monitoring, Reports, Alerts, or Risk
      // Analysis. Now it's persisted through the same shared store
      // every other page reads from, so a manually-encoded patient
      // actually shows up site-wide.
      try {
        const saved = await window.DiaCarePatients.addEncodedPatient(patient);
        if (saved && saved.id) patient.id = saved.id;
      } catch (err) {
        console.error('Could not save the patient:', err);
        showToast('Could not save the patient. Check your connection and try again.', '#ef4444');
        return;
      }
    }
  }

  encodedPatients.push(patient);
  encodedCount++;

  /* Update counters */
  const countEl = document.getElementById('encodedCount');
  const badgeEl = document.getElementById('encodedBadge');
  if (countEl) countEl.textContent = encodedCount;
  if (badgeEl) badgeEl.textContent = encodedCount;

  renderEncodedList();

  /* Show success modal */
  const riskLabel = window.DiaCarePatients.riskMeta(risk).lbl;
  const riskCls = risk === 'critical' ? 'status-pill--critical' :
    risk === 'warning' ? 'status-pill--warning' :
    risk === 'normal' ? 'status-pill--good' : 'status-pill--noreferral';

  document.getElementById('successName').textContent = `${name} — ${patient.id}`;
  document.getElementById('successRisk').innerHTML =
    `<span class="status-pill ${riskCls}">
      ${riskLabel} &nbsp;|&nbsp; ${glucose} mg/dL &nbsp;|&nbsp; ${sys}/${dia} mmHg
    </span>`;

  document.getElementById('successModal')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

/* ================================================================
   ENCODED LIST — side panel
   ================================================================ */
function renderEncodedList() {
  const el = document.getElementById('encodedList');
  if (!el) return;

  if (encodedPatients.length === 0) {
    el.innerHTML = '<div class="enc-session-empty">No patients encoded yet.</div>';
    return;
  }

  el.innerHTML = [...encodedPatients].reverse().map(p => {
    const glcCls = p.risk === 'critical' ? 'glc-critical' :
      p.risk === 'warning' ? 'glc-warning' : 'glc-normal';
    return `<div class="enc-session-item">
      <div class="enc-session-av" style="background:${p.color}">${p.initials}</div>
      <span class="enc-session-name">${p.name}</span>
      <span class="enc-session-glc ${glcCls}">${p.glucose}</span>
    </div>`;
  }).join('');
}
/* ================================================================
   CUSTOM BARANGAY DROPDOWN
   ================================================================ */
const BARANGAYS = [
  'Alongong', 'Apud', 'Bacolod', 'Bariw', 'Bonbon', 'Buga', 'Bulusan',
  'Burabod', 'Caguscos', 'East Carisac', 'West Carisac', 'Harigue',
  'Libtong', 'Linao', 'Mabayawas', 'Macabugos', 'Magallang', 'Malabiga',
  'Marayag', 'Matara', 'Molosbolos', 'Natasan', 'Niño Jesus', 'Nogpo',
  'Pantao', 'Rawis', 'Sagrada Familia', 'Salvacion', 'Sampongan',
  'San Agustin', 'San Antonio', 'San Isidro', 'San Jose', 'San Pascual',
  'San Ramon', 'San Vicente', 'Santa Cruz', 'Talin-talin', 'Tambo',
  'Villa Petrona'
];

const trigger = document.getElementById('barangayTrigger');
const dropdown = document.getElementById('barangayDropdown');
const arrow = document.getElementById('barangayArrow');
const search = document.getElementById('barangaySearch');
const list = document.getElementById('barangayList');
const hiddenVal = document.getElementById('patientBarangay');
const selSpan = document.getElementById('barangaySelected');

function renderBarangayList(filter = '') {
  const filtered = BARANGAYS.filter(b =>
    b.toLowerCase().includes(filter.toLowerCase())
  );
  if (filtered.length === 0) {
    list.innerHTML = '<li class="no-results">No barangay found</li>';
    return;
  }
  list.innerHTML = filtered.map(b =>
    `<li class="${hiddenVal.value === b ? 'selected' : ''}"
         data-value="${b}">${b}</li>`
  ).join('');
  list.querySelectorAll('li[data-value]').forEach(li => {
    li.addEventListener('click', () => {
      hiddenVal.value = li.dataset.value;
      selSpan.textContent = li.dataset.value;
      trigger.classList.add('has-value');
      trigger.classList.remove('error');
      document.getElementById('errBarangay')?.classList.add('hidden');
      closeDropdown();
    });
  });
}

function openDropdown() {
  dropdown.classList.remove('hidden');
  trigger.classList.add('open');
  arrow.classList.add('open');
  search.value = '';
  renderBarangayList();
  setTimeout(() => search.focus(), 50);
}

function closeDropdown() {
  dropdown.classList.add('hidden');
  trigger.classList.remove('open');
  arrow.classList.remove('open');
}

trigger.addEventListener('click', () => {
  // Locked while an existing patient is selected — barangay comes
  // from their record, not re-entered here. See setIdentityFieldsLocked().
  if (trigger.classList.contains('disabled')) return;
  dropdown.classList.contains('hidden') ? openDropdown() : closeDropdown();
});

trigger.addEventListener('keydown', (e) => {
  if (trigger.classList.contains('disabled')) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDropdown(); }
  if (e.key === 'Escape') closeDropdown();
});

search.addEventListener('input', () => renderBarangayList(search.value));

document.addEventListener('click', (e) => {
  if (!document.getElementById('barangayWrap')?.contains(e.target)) {
    closeDropdown();
  }
});

renderBarangayList();
/* ================================================================
   FORM SUBMIT
   ================================================================ */
document.getElementById('encodingForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const action = e.submitter?.dataset.action || 'done';

  /* A patient a BHW already registered would otherwise be written again
     under a new id, splitting their readings across two records — the
     same split the app now warns about from the other direction. Only
     for new registrations: "Log a visit for an existing patient" is
     already choosing a specific record. */
  if (encodingMode !== 'existing' && !(await confirmNotDuplicate())) return;

  savePatient(action);
});

/* Returns true when it is safe to register. A match is a warning, not a
   block: two people really can share a name and a birth date, and the
   nurse in the room knows which case this is. */
async function confirmNotDuplicate() {
  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  const dob = document.getElementById('patientDob').value;
  if (!firstName || !lastName || !dob || !window.DiaCarePatients) return true;

  const birth = new Date(dob);
  const match = window.DiaCarePatients.PATIENTS.find((p) => {
    if (!p.birthDate) return false;
    return p.firstName?.trim().toLowerCase() === firstName.toLowerCase()
      && p.lastName?.trim().toLowerCase() === lastName.toLowerCase()
      && p.birthDate.getFullYear() === birth.getFullYear()
      && p.birthDate.getMonth() === birth.getMonth()
      && p.birthDate.getDate() === birth.getDate();
  });
  if (!match) return true;

  const heldBy = match.assignedBhwId
    ? window.DiaCarePatients.bhwName(match.assignedBhwId)
    : '';
  const who = heldBy
    ? `is already registered by ${heldBy}`
    : 'is already on the register';

  return window.confirm(
    `${match.name} ${who}.\n\n`
    + 'Registering them again creates a second record, and their readings '
    + 'will be split across both. Use "Log a visit for an existing '
    + 'patient" instead, unless this is a different person.\n\n'
    + 'Register anyway?'
  );
}

/* ================================================================
   SUCCESS MODAL — Add Another
   ================================================================ */
document.getElementById('btnAddAnother')?.addEventListener('click', () => {
  document.getElementById('successModal')?.classList.add('hidden');
  document.body.style.overflow = '';
  resetForm();
});

/* ================================================================
   RESET FORM
   ================================================================ */
function resetForm() {
  document.getElementById('encodingForm')?.reset();
  document.getElementById('patientId').value = generateId();

  /* Native form reset() doesn't fire 'change' on radios, so the New
     Patient/Existing Patient mode state and locked fields need
     resetting by hand here rather than relying on that listener. */
  encodingMode = 'new';
  clearExistingPatientSelection();
  setIdentityFieldsLocked(false);
  document.getElementById('existingPatientFieldWrap')?.classList.add('hidden');
  document.getElementById('bmiDisplay').value = '';

  /* Clear indicators */
  const gi = document.getElementById('glucoseIndicator');
  const bi = document.getElementById('bpIndicator');
  if (gi) gi.className = 'enc-indicator hidden';
  if (bi) bi.className = 'enc-indicator hidden';

  /* Clear errors */
  document.querySelectorAll('.enc-error').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.enc-input').forEach(el => el.classList.remove('error'));
  document.getElementById('existingPatientTrigger')?.classList.remove('error');

  /* Reset risk preview */
  const body = document.getElementById('riskPreviewBody');
  if (body) body.innerHTML = `<div class="enc-risk-empty">
    <i class="fa-solid fa-droplet"></i>
    <p>Enter glucose and blood pressure to see the risk assessment</p>
  </div>`;

  document.getElementById('firstName')?.focus();
}

function openResetModal() {
  document.getElementById('resetModal')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeResetModal() {
  document.getElementById('resetModal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

document.getElementById('btnReset')?.addEventListener('click', openResetModal);
document.getElementById('resetModalClose')?.addEventListener('click', closeResetModal);
document.getElementById('resetModalCancel')?.addEventListener('click', closeResetModal);
document.getElementById('resetModalConfirm')?.addEventListener('click', () => {
  closeResetModal();
  resetForm();
});

/* ── Clear errors on input ── */
['firstName', 'lastName', 'patientDob', 'patientSex', 'patientBarangay',
  'glucose', 'bpSystolic', 'bpDiastolic'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      document.getElementById(id)?.classList.remove('error');
    });
  });

/* ================================================================
   TOAST
   ================================================================ */
function showToast(msg, color = '#059669') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.background = color;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ================================================================
   FIELD-WORKER PICKER

   A patient encoded here reaches a handset only through
   assignedBhwId — the app pulls on exactly that field. Offering the
   choice at registration is what stops a backlog of patients who are
   on this dashboard and on nobody's round.
   ================================================================ */
async function fillAssignedBhwOptions() {
  const select = document.getElementById('assignedBhw');
  if (!select || !window.DiaCarePatients) return;
  const roster = await window.DiaCarePatients.loadBhwRoster();
  select.innerHTML = ['<option value="">Not assigned</option>']
    .concat(roster.map(b => {
      const where = [b.barangay, b.purok].filter(Boolean).join(' · ');
      return `<option value="${b.id}">${b.name}${where ? ' — ' + where : ''}</option>`;
    }))
    .join('');
}

window.addEventListener('diacare:patients-loaded', fillAssignedBhwOptions);
fillAssignedBhwOptions();
