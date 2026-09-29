'use strict';
/* ================================================================
   DiaCare RHU Libon — Patient Monitoring JavaScript
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
const topnav = document.getElementById('topnav');
const menuToggle = document.getElementById('menuToggle');
menuToggle?.addEventListener('click', () => {
  topnav.classList.toggle('nav-open');
});
document.addEventListener('click', (e) => {
  if (topnav?.classList.contains('nav-open'))
    if (!topnav.contains(e.target))
      topnav.classList.remove('nav-open');
});

/* ================================================================
   PATIENT DATA — from the shared roster (../shared/patients-data.js)
   so Total Patients / risk counts here agree with Dashboard, Reports,
   Alerts, and Risk Analysis instead of using an independent list.
   ================================================================ */
let PATIENTS = window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : [];

/* ================================================================
   STAT RIBBON — counts against the full roster, unaffected by the
   table's own filters, so these read as an at-a-glance overview
   rather than "stats for whatever I searched."
   ================================================================ */
function renderStats() {
  const critical = PATIENTS.filter(p => p.risk === 'critical').length;
  const warning = PATIENTS.filter(p => p.risk === 'warning').length;
  const normal = PATIENTS.filter(p => p.risk === 'normal').length;
  const viaApp = PATIENTS.filter(p => p.source === 'app').length;
  const manual = PATIENTS.filter(p => p.source === 'manual').length;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val.toLocaleString('en-US');
  };
  set('statCritical', critical);
  set('statWarning', warning);
  set('statTotal', PATIENTS.length);
  set('statNormal', normal);
  set('statViaApp', viaApp);
  set('statManualEncoded', manual);
}

/* ================================================================
   STATE
   ================================================================ */
let activeRiskFilter = 'all';
let activeBarangay = 'all';
let searchQuery = '';
let currentPatient = null;

/* ================================================================
   POPULATE BARANGAY FILTER — the full official 40-barangay list
   (window.DiaCarePatients.BARANGAYS), not just the ones that happen
   to have a monitored patient right now. Deriving it from PATIENTS
   alone silently dropped every barangay with zero current patients,
   which is exactly the coverage gap this filter exists to surface.
   ================================================================ */
function populateBarangays() {
  const sel = document.getElementById('barangayFilter');
  if (!sel) return;
  const barangays = window.DiaCarePatients ? window.DiaCarePatients.BARANGAYS : [];
  barangays.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b; opt.textContent = b;
    sel.appendChild(opt);
  });
}

/* ================================================================
   URL FILTERS — honors ?risk= and ?barangay= so links from the
   Dashboard (Risk Distribution legend, Recent Missions) land here
   pre-filtered instead of on the unfiltered full list. ?patient=
   additionally opens that patient's tabbed profile directly, for
   "View" links from Risk Analysis and anywhere else that already
   knows exactly which patient the user wants, instead of dropping
   them on the unfiltered table to search again.
   ================================================================ */
/* The roster loads after this page does, so applyUrlFilters runs once at
   load (when ?patient= cannot be resolved yet) and again when the data
   arrives. The guard is what stops the detail modal reopening on every
   subsequent snapshot while the nurse is reading something else. */
let deepLinkOpened = false;

function applyUrlFilters() {
  const params = new URLSearchParams(window.location.search);
  const risk = params.get('risk');
  const barangay = params.get('barangay');
  const patientId = params.get('patient');

  if (risk && ['critical', 'warning', 'normal'].includes(risk)) {
    activeRiskFilter = risk;
    document.querySelectorAll('.pill').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === risk);
    });
  }

  if (barangay) {
    const sel = document.getElementById('barangayFilter');
    if (sel && [...sel.options].some(o => o.value === barangay)) {
      activeBarangay = barangay;
      sel.value = barangay;
    }
  }

  if (patientId && !deepLinkOpened) {
    const patient = PATIENTS.find(p => p.id === patientId);
    if (patient) {
      deepLinkOpened = true;
      openDetail(patient);
      // &tab= opens straight to the tab that's actually relevant to
      // wherever the link came from — Risk Analysis wants Trends (the
      // chart that explains "why"), High-Risk Alerts wants Health
      // Records (the actual reading that triggered the alert) —
      // instead of always landing on the default Profile tab.
      const tab = params.get('tab');
      if (tab) {
        document.querySelector(`.ptab-btn[data-tab="${tab}"]`)?.click();
      }
    }
  }
}

/* ================================================================
   FILTER PATIENTS
   ================================================================ */
function getFiltered() {
  return PATIENTS.filter(p => {
    /* 'unassigned' is not a risk level — it selects the patients no
       field worker can see, which is otherwise invisible from here. */
    const matchRisk = activeRiskFilter === 'all'
      || (activeRiskFilter === 'unassigned' ? !p.assignedBhwId : p.risk === activeRiskFilter);
    const matchBarangay = activeBarangay === 'all' || p.barangay === activeBarangay;
    const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchRisk && matchBarangay && matchSearch;
  });
}

/* ================================================================
   RISK PILL — shared markup between the table, the modal header, and
   every health-record card, so "Highly At Risk" reads and looks
   identical everywhere it appears instead of each call site
   reimplementing the same three-way branch slightly differently.
   ================================================================ */
function riskPillHtml(risk, size) {
  const { cls, icon, lbl } = window.DiaCarePatients.riskMeta(risk);
  const style = size === 'sm' ? ' style="font-size:11px;padding:2px 8px"' : '';
  return `<span class="risk-pill ${cls}"${style}><i class="fa-solid ${icon}"></i>${lbl}</span>`;
}
/* Deterministic 6-digit number from a patient's long Firestore ID, so
   the same patient always shows the same short ID on every load. */
function sixDigitId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return String(100000 + (hash % 900000));
}

/* ================================================================
   RENDER TABLE — deliberately minimal columns; everything else lives
   in the tabbed profile one click away via "View".
   ================================================================ */
function renderTable() {
  const tbody = document.getElementById('patientTbody');
  const emptyEl = document.getElementById('tableEmpty');
  const countEl = document.getElementById('filterCount');
  if (!tbody) return;

  const filtered = getFiltered().slice().sort((a, b) => b.score - a.score);
  if (countEl) countEl.textContent = `Showing ${filtered.length} of ${PATIENTS.length} patients`;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyEl?.classList.remove('hidden');
    return;
  }
  emptyEl?.classList.add('hidden');

  tbody.innerHTML = filtered.map((p) => {
    const rowCls = p.risk === 'critical' ? 'row-critical' : p.risk === 'warning' ? 'row-warning' : '';
    const barColor = p.risk === 'critical' ? '#d0362f' : p.risk === 'warning' ? '#c2760a' : '#22a866';
    const scoreNumCls = p.risk === 'critical' ? 'glc-critical' : p.risk === 'warning' ? 'glc-warning' : 'glc-normal';
    const glcCls = p.glucose >= 250 || p.glucose < 70 ? 'glc-critical' : p.glucose >= 180 ? 'glc-warning' : 'glc-normal';
    const trendCls = p.trend === 'worsening' ? 'trend-badge--worsening' : p.trend === 'improving' ? 'trend-badge--improving' : 'trend-badge--stable';
    const trendIcon = p.trend === 'worsening' ? 'fa-arrow-trend-up' : p.trend === 'improving' ? 'fa-arrow-trend-down' : 'fa-minus';
    const trendLbl = p.trend === 'worsening' ? 'Worsening' : p.trend === 'improving' ? 'Improving' : 'Stable';

    return `<tr class="${rowCls}" data-id="${p.id}">
      <td><span style="font-family:var(--font-mono);font-size:12.5px;color:#000000">${sixDigitId(p.id)}</span></td>
           <td>
        <div class="pt-name">${p.name}</div>
      </td>
      <td style="font-size:13px;color:#000000">${p.barangay}</td>
      <td>
        <div class="score-wrap">
          <div class="score-bar-bg">
            <div class="score-bar" style="width:${p.riskScore}%;background:${barColor}"></div>
          </div>
          <span class="score-num ${scoreNumCls}">${p.riskScore}%</span>
        </div>
      </td>
      <td>${riskPillHtml(p.risk)}</td>
                  <td><span class="glc-val ${glcCls}">${p.glucose} <span style="font-size:10px;font-weight:400;color:inherit">mg/dL</span></span></td>
           <td><span class="bp-val" style="color:#000000">${p.bp} <span style="font-size:10px;color:#000000">mmHg</span></span></td>
      <td><span class="trend-badge ${trendCls}"><i class="fa-solid ${trendIcon}"></i> ${trendLbl}</span></td>
      <td>
        <button class="btn-view" data-id="${p.id}">
          <i class="fa-solid fa-eye"></i> View
        </button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      const id = el.dataset.id;
      const patient = PATIENTS.find(p => p.id === id);
      if (patient) openDetail(patient);
    });
  });
}

/* ================================================================
   FILTERS
   ================================================================ */
/* Risk pills */
document.querySelectorAll('.pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeRiskFilter = btn.dataset.filter;
    renderTable();
  });
});

/* Barangay select */
document.getElementById('barangayFilter')?.addEventListener('change', (e) => {
  activeBarangay = e.target.value;
  renderTable();
});

/* Search */
document.getElementById('searchInput')?.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderTable();
});

/* ================================================================
   HEALTH RECORD CARD — one visit/measurement. Shared by the Health
   Records tab (every source) and the RHU Visit Records tab (manual
   source only), matching the layout: header (date, recorded by,
   visit type) → measurements → risk classification → notes.
   ================================================================ */
function healthRecordCardHtml(h) {
  const visitLabel = window.DiaCarePatients ? window.DiaCarePatients.sourceToVisitLabel(h.source) : (h.source === 'app' ? 'Household Visit' : 'RHU Visit');
  const srcCls = h.source === 'app' ? 'source-badge--app' : 'source-badge--manual';
  const srcIcon = h.source === 'app' ? 'fa-mobile-screen' : 'fa-keyboard';

  const adherenceLbl = h.medicationAdherence === 'taken' ? 'Yes — Taken as Scheduled'
    : h.medicationAdherence === 'partial' ? 'Partial — Partially Taken'
    : h.medicationAdherence === 'missed' ? 'No — Missed / Not Taken' : null;

  const rows = [
    ['Blood Glucose', `${h.glucose} mg/dL`],
    ['Blood Pressure', `${h.bp} mmHg`],
    h.weight ? ['Weight', `${h.weight} kg`] : null,
    h.height ? ['Height', `${(h.height / 100).toFixed(2)} m`] : null,
    h.bmi ? ['BMI', h.bmi] : null,
    adherenceLbl ? ['Medication Taken', adherenceLbl] : null,
    h.insulinUse !== undefined ? ['Insulin Used', h.insulinUse ? 'Yes' : 'No'] : null,
    h.medicationName ? ['Medication', `${h.medicationName}${h.dosage ? ` — ${h.dosage}` : ''}`] : null,
  ].filter(Boolean);

  return `<div class="hr-card">
    <div class="hr-card-hdr">
      <div class="hr-card-title">Health Record — ${h.datetime}</div>
      <span class="source-badge ${srcCls}"><i class="fa-solid ${srcIcon}"></i> ${visitLabel}</span>
    </div>
    <div class="hr-card-meta">Recorded by: ${h.recordedBy || (h.source === 'app' ? 'BHW' : 'RHU Nurse')}</div>
    <table class="hr-measure-table">
      ${rows.map(([label, val]) => `<tr><td>${label}</td><td>${val}</td></tr>`).join('')}
    </table>
    <div class="hr-risk-row">Risk Classification: ${riskPillHtml(h.status, 'sm')}</div>
    ${h.notes ? `<div class="hr-notes"><strong>Notes:</strong> ${h.notes}</div>` : ''}
    <div class="hr-card-actions">
      <button class="btn-correct-visit" data-correct-visit="${h.id}">
        <i class="fa-solid fa-pen"></i> Edit
      </button>
    </div>
  </div>`;
}

/* ================================================================
   CORRECT A VISIT

   A mistyped reading drives the patient's risk, their alerts and every
   average taken from it until someone fixes it. The handset can correct
   its own visits; this is the same at the RHU, where the clinical
   judgement is.
   ================================================================ */
let correctingRecord = null;

function openCorrectVisit(record) {
  correctingRecord = record;
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
  };
  const [sys, dia] = String(record.bp || '').split('/');

  document.getElementById('correctVisitWhen').textContent =
    `${currentPatient ? currentPatient.name + ' · ' : ''}${record.datetime}`;
  set('cvGlucose', record.glucose);
  set('cvSystolic', sys);
  set('cvDiastolic', dia);
  set('cvWeight', record.weight);
  set('cvHeight', record.height);
  set('cvTemp', record.temp);
  set('cvAdherence', record.medicationAdherence || 'taken');
  set('cvReferral', record.referral || 'none');
  set('cvMedication', record.medicationName);
  set('cvDosage', record.dosage);
  set('cvNotes', record.notes);
  const insulin = document.getElementById('cvInsulin');
  if (insulin) insulin.checked = !!record.insulinUse;

  document.getElementById('correctVisitModal')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeCorrectVisit() {
  document.getElementById('correctVisitModal')?.classList.add('hidden');
  document.body.style.overflow = '';
  correctingRecord = null;
}

document.getElementById('correctVisitClose')?.addEventListener('click', closeCorrectVisit);
document.getElementById('correctVisitCancel')?.addEventListener('click', closeCorrectVisit);
document.getElementById('correctVisitModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'correctVisitModal') closeCorrectVisit();
});

document.getElementById('correctVisitSave')?.addEventListener('click', async () => {
  if (!correctingRecord || !currentPatient) return;
  const val = (id) => document.getElementById(id)?.value.trim() || '';
  const num = (id) => {
    const raw = val(id);
    return raw === '' ? null : Number(raw);
  };

  const glucose = num('cvGlucose');
  const sys = num('cvSystolic');
  const dia = num('cvDiastolic');
  if (!glucose || !sys || !dia) {
    showToast('Glucose and both blood pressure values are required.', '#ef4444');
    return;
  }

  const weight = num('cvWeight');
  const height = num('cvHeight');
  const bmi = weight && height ? +(weight / ((height / 100) ** 2)).toFixed(1) : null;

  const btn = document.getElementById('correctVisitSave');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving';
  try {
    await window.DiaCarePatients.updateVisit(currentPatient.id, correctingRecord.id, {
      glucose,
      bp: `${sys}/${dia}`,
      weight,
      height,
      temp: num('cvTemp'),
      bmi,
      medicationAdherence: val('cvAdherence'),
      referral: val('cvReferral'),
      medicationName: val('cvMedication'),
      dosage: val('cvDosage'),
      notes: val('cvNotes'),
      insulinUse: document.getElementById('cvInsulin')?.checked,
    });
    showToast('Visit corrected.');
    closeCorrectVisit();
  } catch (err) {
    console.error(err);
    showToast('Could not save the correction. Please try again.', '#ef4444');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Save Correction';
  }
});

/* One listener for every record card, in both tabs, rather than binding
   per card on each re-render. */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-correct-visit]');
  if (!btn || !currentPatient) return;
  const id = btn.getAttribute('data-correct-visit');
  const record = (currentPatient.history || []).find((h) => h.id === id);
  if (record) openCorrectVisit(record);
});

function renderHealthRecordsTab(patient) {
  const el = document.getElementById('healthRecordsList');
  if (!el) return;
  const records = patient.history || [];
  el.innerHTML = records.length
    ? records.map(healthRecordCardHtml).join('')
    : '<div class="hr-empty">No health records yet.</div>';
}

function renderRhuVisitTab(patient) {
  const el = document.getElementById('rhuVisitList');
  if (!el) return;
  const rhuRecords = (patient.history || []).filter(h => h.source === 'manual');
  el.innerHTML = rhuRecords.length
    ? rhuRecords.map(healthRecordCardHtml).join('')
    : '<div class="hr-empty">No RHU visits recorded yet — use "Add RHU Visit" above to log one.</div>';
}

/* ================================================================
   PATIENT PROFILE TAB — static demographic/medical/emergency info
   only. reviewField() below used to live with the pending-approval
   review modal; that modal is gone with the approval step, and the
   helper moved here, its only remaining caller.
   ================================================================ */
function reviewField(label, value) {
  const hasValue = value && value !== 'Not specified';
  return `
    <div class="review-field">
      <div class="review-field-label">${label}</div>
      <div class="review-field-value${hasValue ? '' : ' review-field-value--empty'}">${hasValue ? value : 'Not specified'}</div>
    </div>`;
}

function renderProfileTab(patient) {
  const personalEl = document.getElementById('profilePersonalGrid');
  if (personalEl) {
    personalEl.innerHTML = [
      reviewField('First Name', patient.firstName),
      reviewField('Middle Initial', patient.middleName),
      reviewField('Last Name', patient.lastName),
      reviewField('Date of Birth', patient.dob),
      reviewField('Sex', patient.sex),
      reviewField('Barangay', patient.barangay),
      reviewField('Purok', patient.purok),
      reviewField('Contact Number', patient.contactNumber),
    ].join('');
  }

  const medicalEl = document.getElementById('profileMedicalGrid');
  if (medicalEl) {
    medicalEl.innerHTML = [
      reviewField('Diabetes Type', patient.diabetesType),
      reviewField('Date of Diagnosis', patient.diagnosisDate),
      reviewField('Current Medications', patient.medications),
      reviewField('Attending Physician', patient.attendingPhysician),
    ].join('');
  }

  const emergencyEl = document.getElementById('profileEmergencyGrid');
  if (emergencyEl) {
    emergencyEl.innerHTML = [
      reviewField('Emergency Contact Name', patient.emergencyContactName),
      reviewField('Emergency Contact Number', patient.emergencyContactNumber),
    ].join('');
  }

  renderAssignControl(patient);
}

/* ================================================================
   ASSIGN TO A FIELD WORKER

   The app pulls `patients where assignedBhwId == my uid`, so this
   field is the whole link between a patient and a phone. A patient
   encoded at the RHU is written with an empty one and reaches nobody
   until a nurse sets it here.
   ================================================================ */
async function renderAssignControl(patient) {
  const select = document.getElementById('assignBhwSelect');
  const btn = document.getElementById('assignBhwBtn');
  const note = document.getElementById('assignBhwNote');
  if (!select || !btn || !window.DiaCarePatients) return;

  const roster = await window.DiaCarePatients.loadBhwRoster();

  select.innerHTML = ['<option value="">Not assigned — visible only at the RHU</option>']
    .concat(roster.map(b => {
      const where = [b.barangay, b.purok].filter(Boolean).join(' · ');
      return `<option value="${b.id}">${b.name}${where ? ' — ' + where : ''}</option>`;
    }))
    .join('');

  select.value = patient.assignedBhwId || '';
  btn.disabled = true;

  const describe = () => {
    if (!note) return;
    if (patient.assignedBhwId) {
      note.className = 'assign-note';
      note.textContent =
        `Syncs to ${window.DiaCarePatients.bhwName(patient.assignedBhwId)}'s app on their next sync.`;
    } else {
      note.className = 'assign-note assign-note--warn';
      note.textContent =
        "No field worker assigned — this patient does not appear on any BHW's phone.";
    }
  };
  describe();

  select.onchange = () => {
    btn.disabled = select.value === (patient.assignedBhwId || '');
  };

  btn.onclick = async () => {
    const chosen = select.value;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving';
    try {
      await window.DiaCarePatients.assignPatient(patient.id, chosen);
      patient.assignedBhwId = chosen;
      showToast(chosen
        ? `Assigned to ${window.DiaCarePatients.bhwName(chosen)}.`
        : 'Assignment cleared.');
      describe();
    } catch (err) {
      showToast('Could not save the assignment. Please try again.', '#ef4444');
      select.value = patient.assignedBhwId || '';
    } finally {
      btn.innerHTML = '<i class="fa-solid fa-check"></i> Save';
      btn.disabled = select.value === (patient.assignedBhwId || '');
    }
  };
}

/* ================================================================
   TAB SWITCHING — Trends' canvases are sized off their container's
   rendered width, so they're (re)drawn on activation, not just once
   at openDetail() time when the Trends panel is still display:none
   and would measure 0 width.
   ================================================================ */
document.querySelectorAll('.ptab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ptab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.ptab-panel').forEach(p => {
      p.classList.toggle('hidden', p.dataset.panel !== tab);
    });
    // Deferred a frame — drawing 3 canvas charts synchronously right
    // after the class toggle was competing with the browser's paint of
    // the tab underline for this tab specifically (the only tab that
    // does heavy synchronous work on click), so it could visibly lag
    // behind switching to Trends compared to the other three tabs.
    if (tab === 'trends' && currentPatient) requestAnimationFrame(() => drawTrendCharts(currentPatient));
  });
});

/* ================================================================
   PATIENT DETAIL MODAL
   ================================================================ */
function openDetail(patient) {
  currentPatient = patient;

  /* Header */
  const infoEl = document.getElementById('modalPatientInfo');
  if (infoEl) {
    infoEl.innerHTML = `
      <div class="modal-av" style="background:${patient.color}">${patient.initials}</div>
      <div>
        <div class="modal-name">${patient.name}</div>
        <div class="modal-meta">
          ${patient.id} · ${patient.age} yrs · ${patient.sex} ·
          ${patient.barangay} ·
          ${riskPillHtml(patient.risk, 'sm')}
        </div>
      </div>`;
  }

  renderProfileTab(patient);
  renderHealthRecordsTab(patient);
  renderRhuVisitTab(patient);

  /* Always reopen on the Profile tab — a stale "Trends" or "RHU Visit
     Records" selection from the previously-viewed patient would
     otherwise carry over. */
  document.querySelectorAll('.ptab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'profile'));
  document.querySelectorAll('.ptab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== 'profile'));

  /* Flag button state */
  const flagBtn = document.getElementById('btnFlag');
  if (flagBtn) {
    flagBtn.classList.toggle('flagged', patient.flagged);
    flagBtn.innerHTML = patient.flagged
      ? '<i class="fa-solid fa-flag"></i> Flagged for Follow-up'
      : '<i class="fa-solid fa-flag"></i> Flag for Follow-up';
  }

  /* Show modal */
  document.getElementById('detailModal')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detailModal')?.classList.add('hidden');
  document.body.style.overflow = '';
  currentPatient = null;
}

document.getElementById('modalClose')?.addEventListener('click', closeDetail);
document.getElementById('btnModalClose')?.addEventListener('click', closeDetail);
document.getElementById('detailModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('detailModal')) closeDetail();
});

/* Flag button — shared with High-Risk Alerts' flag modal via
   setPatientFlag(), so flagging a patient here or there reflects
   everywhere else and survives a refresh, instead of two disconnected,
   unpersisted flag states. */
document.getElementById('btnFlag')?.addEventListener('click', () => {
  if (!currentPatient) return;

  /* The new state is decided here rather than read back off
     currentPatient afterwards. setPatientFlag updates the object in the
     roster, and currentPatient is only sometimes that same object — when
     it is a copy, every line below would have described the old state.
     Deciding once and using that value throughout removes the question. */
  const newFlagged = !currentPatient.flagged;
  window.DiaCarePatients?.setPatientFlag(currentPatient.id, newFlagged);
  currentPatient.flagged = newFlagged;

  const flagBtn = document.getElementById('btnFlag');
  if (flagBtn) {
    flagBtn.classList.toggle('flagged', newFlagged);
    flagBtn.innerHTML = newFlagged
      ? '<i class="fa-solid fa-flag"></i> Flagged for Follow-up'
      : '<i class="fa-solid fa-flag"></i> Flag for Follow-up';
  }

  /* The row's own flag indicator lives in the table, not the modal. */
  renderTable();

  showToast(newFlagged
    ? `${currentPatient.name} flagged for follow-up.`
    : `Flag removed for ${currentPatient.name}.`);
});

/* Add RHU Visit — jumps to Patient Encoding with this patient
   pre-selected in Existing Patient mode, instead of duplicating a
   second vitals-entry form inside this modal. See patient-encoding.js's
   URL-param pickup for the other half of this. */
document.getElementById('btnAddVisit')?.addEventListener('click', () => {
  if (!currentPatient) return;
  window.location.href = `../patient-encoding/patient-encoding.html?patient=${encodeURIComponent(currentPatient.id)}`;
});

/* ================================================================
   TRENDS TAB CHARTS — one shared line-chart drawer parameterized by
   scale/series instead of three near-identical hand-rolled functions.
   Accepts 1-2 series so Blood Pressure can plot systolic + diastolic
   on the same axes.
   ================================================================ */
function drawLineChart(canvasId, series, { min, max, gridLines, emptyMsg }) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const W = canvas.parentElement.offsetWidth || 500;
  const H = 160;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const n = series[0]?.data.length || 0;
  if (n < 2) {
    ctx.font = '13px Sora, sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'center';
    ctx.fillText(emptyMsg || 'Not enough data for chart', W / 2, H / 2);
    return;
  }

  const PAD = { t: 14, b: 8, l: 36, r: 12 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;
  const RANGE = max - min;

  const xOf = i => PAD.l + (i / (n - 1)) * iW;
  const yOf = v => PAD.t + (1 - (v - min) / RANGE) * iH;

  /* Grid */
  ctx.font = `500 10px 'JetBrains Mono', monospace`;
  ctx.textAlign = 'right';
  gridLines.forEach(v => {
    const y = yOf(v);
    ctx.strokeStyle = '#f3f4f6'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
    ctx.fillStyle = '#9ca3af'; ctx.fillText(v, PAD.l - 5, y + 3);
  });

  series.forEach(({ data, color }, si) => {
    /* Fill only under the primary (first) series, so a second series
       (e.g. diastolic) doesn't stack a second translucent wash on top. */
    if (si === 0) {
      const grad = ctx.createLinearGradient(0, PAD.t, 0, H);
      grad.addColorStop(0, `${color}33`);
      grad.addColorStop(1, `${color}00`);
      ctx.beginPath();
      data.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)));
      ctx.lineTo(xOf(n - 1), H - PAD.b); ctx.lineTo(xOf(0), H - PAD.b);
      ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    }

    ctx.beginPath();
    data.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)));
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round'; ctx.setLineDash([]); ctx.stroke();

    data.forEach((v, i) => {
      ctx.beginPath(); ctx.arc(xOf(i), yOf(v), 4, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();
    });
  });
}

/* ================================================================
   TREND EXPLANATION — Risk Analysis classifies each patient as
   Worsening/Improving/Stable from their last 3 glucose readings
   (see computeTrend() in patients-data.js) but never showed *why*.
   Spells out the actual numbers behind the label instead of leaving
   the viewer to read the chart and infer it themselves.
   ================================================================ */
function trendExplanationText(patient) {
  const asc = [...(patient.history || [])].map(h => h.glucose).reverse(); // oldest -> newest
  if (asc.length < 3) return null;
  const last3 = asc.slice(-3).join(' → ');
  if (patient.trend === 'worsening') return `Worsening — glucose rose ${last3} mg/dL over the last 3 readings.`;
  if (patient.trend === 'improving') return `Improving — glucose fell ${last3} mg/dL over the last 3 readings.`;
  return `Stable — no significant change in glucose over the last 3 readings (${last3} mg/dL).`;
}

function drawTrendCharts(patient) {
  const chrono = [...(patient.history || [])].reverse(); // oldest -> newest

  const explainEl = document.getElementById('trendGlucoseExplain');
  if (explainEl) {
    const text = trendExplanationText(patient);
    explainEl.textContent = text || '';
    explainEl.classList.toggle('hidden', !text);
    explainEl.classList.remove('trend-explain--worsening', 'trend-explain--improving', 'trend-explain--stable');
    if (text) explainEl.classList.add(`trend-explain--${patient.trend || 'stable'}`);
  }

  drawLineChart('trendGlucoseChart',
    [{ data: chrono.map(h => h.glucose), color: '#178a53' }],
    { min: 40, max: 340, gridLines: [70, 180, 250], emptyMsg: 'Not enough glucose readings for a trend' });

  drawLineChart('trendBpChart',
    [
      { data: chrono.map(h => parseInt(h.bp.split('/')[0], 10)), color: '#d0362f' },
      { data: chrono.map(h => parseInt(h.bp.split('/')[1], 10)), color: '#3b82f6' },
    ],
    { min: 40, max: 200, gridLines: [80, 120, 140], emptyMsg: 'Not enough blood pressure readings for a trend' });

  const bmiEntries = chrono.filter(h => h.bmi);
  drawLineChart('trendBmiChart',
    [{ data: bmiEntries.map(h => h.bmi), color: '#7c5ce0' }],
    { min: 15, max: 40, gridLines: [18.5, 25, 30], emptyMsg: 'Not enough BMI readings for a trend' });
}

/* ================================================================
   EXPORT CSV
   ================================================================ */
document.getElementById('btnExport')?.addEventListener('click', () => {
  const filtered = getFiltered();
  const rows = [
    ['Patient ID', 'Name', 'Age', 'Sex', 'Barangay', 'Glucose (mg/dL)', 'Blood Pressure', 'Risk Level', 'Source', 'Time'],
    ...filtered.map(p => [
      p.id, p.name, p.age, p.sex, p.barangay,
      p.glucose ?? 'No data yet', p.bp ?? 'No data yet',
      window.DiaCarePatients.riskMeta(p.risk).lbl,
      p.source === 'app' ? 'Mobile App' : 'Manual Entry',
      p.time,
    ]),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `patient-monitoring-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  showToast('Patient data exported as CSV!');
});

/* Notification bell wiring now lives in ../shared/notifications.js
   so every page shows the same alerts and behaves the same way. */

/* ================================================================
   TOAST
   ================================================================ */
function showToast(msg, color) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.background = color || '';
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ================================================================
   INIT
   ================================================================ */
window.addEventListener('load', () => {
  renderStats();
  renderTopNavNotifications();
  initNotifDropdown();
  populateBarangays();
  applyUrlFilters();
  renderTable();
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // Only redraw if Trends is the visible tab — its canvases measure
    // 0 width while display:none, same reason tab-switching draws them.
    const trendsVisible = !document.querySelector('.ptab-panel[data-panel="trends"]')?.classList.contains('hidden');
    if (currentPatient && trendsVisible) drawTrendCharts(currentPatient);
  }, 200);
});

/* ================================================================
   ROSTER ARRIVAL

   patients-data.js loads from Firestore asynchronously, so this page
   parses and renders before any patient exists. Values derived from the
   roster are recomputed here and the page re-rendered once the data
   lands.

   Only render functions are called — the init/bind helpers already ran
   at load, and running them again would attach a second set of
   listeners to the same controls.
   ================================================================ */

function recomputeFromRoster() {
  PATIENTS = window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : [];
}

window.addEventListener('diacare:patients-loaded', () => {
  recomputeFromRoster();
  renderStats();
  populateBarangays();
  applyUrlFilters();
  renderTable();

  /* The open profile holds a snapshot of the patient from before the
     update landed. After correcting a visit — or after a BHW's sync
     arrives while a nurse has the profile open — that snapshot is stale,
     and the corrected reading would still show the old number until the
     modal was closed and reopened. */
  if (currentPatient) {
    const fresh = PATIENTS.find((p) => p.id === currentPatient.id);
    if (fresh) {
      currentPatient = fresh;
      renderProfileTab(fresh);
      renderHealthRecordsTab(fresh);
      renderRhuVisitTab(fresh);
    }
  }
});
