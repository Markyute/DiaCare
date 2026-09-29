'use strict';
/* ================================================================
   SHARED PATIENT DETAIL MODAL — the tabbed patient profile (Patient
   Profile / Health Records / Health History-Trends / RHU Visit
   Records), originally built for Patient Monitoring, now shared so
   High-Risk Alerts and Risk Analysis can open it in place with
   DiaCarePatientModal.open(patient, { tab }) instead of navigating
   to a different page and losing whatever filters/scroll position
   the viewer was on. If #detailModal already exists on the page
   (Patient Monitoring's own static copy), that one is reused as-is
   instead of injecting a second one.
   ================================================================ */
(function () {
  const MODAL_HTML = `
  <div class="modal-overlay hidden" id="detailModal">
    <div class="modal-card modal-card--wide">
      <div class="modal-hdr">
        <div class="modal-patient-info" id="modalPatientInfo"></div>
        <button class="modal-close" id="modalClose" aria-label="Close modal" title="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="ptab-nav" role="tablist">
        <button class="ptab-btn active" data-tab="profile" role="tab">
          <i class="fa-solid fa-id-card"></i> Patient Profile
        </button>
        <button class="ptab-btn" data-tab="records" role="tab">
          <i class="fa-solid fa-notes-medical"></i> Health Records
        </button>
        <button class="ptab-btn" data-tab="trends" role="tab">
          <i class="fa-solid fa-chart-line"></i> Health History / Trends
        </button>
        <button class="ptab-btn" data-tab="rhu" role="tab">
          <i class="fa-solid fa-hospital"></i> RHU Visit Records
        </button>
      </div>

      <div class="modal-body">

        <div class="ptab-panel" data-panel="profile">
          <div class="detail-section">
            <div class="detail-section-title"><i class="fa-solid fa-user"></i> Personal Information</div>
            <div class="review-field-grid" id="profilePersonalGrid"></div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title"><i class="fa-solid fa-notes-medical"></i> Medical Information</div>
            <div class="review-field-grid" id="profileMedicalGrid"></div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title"><i class="fa-solid fa-phone"></i> Emergency Contact</div>
            <div class="review-field-grid" id="profileEmergencyGrid"></div>
          </div>
        </div>

        <div class="ptab-panel hidden" data-panel="records">
          <div class="hr-card-list" id="healthRecordsList"></div>
        </div>

        <div class="ptab-panel hidden" data-panel="trends">
          <div class="detail-section">
            <div class="detail-section-title"><i class="fa-solid fa-droplet"></i> Blood Glucose History</div>
            <div class="trend-explain-note hidden" id="trendGlucoseExplain"></div>
            <div class="mini-chart-wrap"><canvas id="trendGlucoseChart"></canvas></div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title"><i class="fa-solid fa-heart-pulse"></i> Blood Pressure History</div>
            <div class="mini-chart-wrap"><canvas id="trendBpChart"></canvas></div>
          </div>
          <div class="detail-section">
            <div class="detail-section-title"><i class="fa-solid fa-weight-scale"></i> BMI History</div>
            <div class="mini-chart-wrap"><canvas id="trendBmiChart"></canvas></div>
          </div>
        </div>

        <div class="ptab-panel hidden" data-panel="rhu">
          <button class="btn btn-primary mb-14" id="btnAddVisit">
            <i class="fa-solid fa-plus"></i> Add RHU Visit
          </button>
          <div class="hr-card-list" id="rhuVisitList"></div>
        </div>

      </div>
      <div class="modal-footer">
        <div class="modal-flag-wrap">
          <button class="btn-flag" id="btnFlag">
            <i class="fa-solid fa-flag"></i> Flag for Follow-up
          </button>
        </div>
        <button class="btn btn-outline" id="btnModalClose">Close</button>
      </div>
    </div>
  </div>`;

  let currentPatient = null;
  let wired = false;
  let onCloseCallback = null;

  /* ── Small shared building blocks ── */
  function reviewField(label, value) {
    const hasValue = value && value !== 'Not specified';
    return `
    <div class="review-field">
      <div class="review-field-label">${label}</div>
      <div class="review-field-value${hasValue ? '' : ' review-field-value--empty'}">${hasValue ? value : 'Not specified'}</div>
    </div>`;
  }

  function riskPillHtml(risk, size) {
    const { cls, icon, lbl } = window.DiaCarePatients.riskMeta(risk);
    const style = size === 'sm' ? ' style="font-size:11px;padding:2px 8px"' : '';
    return `<span class="risk-pill ${cls}"${style}><i class="fa-solid ${icon}"></i>${lbl}</span>`;
  }

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
    </div>`;
  }

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
  }

  /* ── Trend charts ── */
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

    ctx.font = `500 10px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'right';
    gridLines.forEach(v => {
      const y = yOf(v);
      ctx.strokeStyle = '#f3f4f6'; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
      ctx.fillStyle = '#9ca3af'; ctx.fillText(v, PAD.l - 5, y + 3);
    });

    series.forEach(({ data, color }, si) => {
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

  function trendExplanationText(patient) {
    const asc = [...(patient.history || [])].map(h => h.glucose).reverse();
    if (asc.length < 3) return null;
    const last3 = asc.slice(-3).join(' → ');
    if (patient.trend === 'worsening') return `Worsening — glucose rose ${last3} mg/dL over the last 3 readings.`;
    if (patient.trend === 'improving') return `Improving — glucose fell ${last3} mg/dL over the last 3 readings.`;
    return `Stable — no significant change in glucose over the last 3 readings (${last3} mg/dL).`;
  }

  function drawTrendCharts(patient) {
    const chrono = [...(patient.history || [])].reverse();

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

  /* ── Toast — self-contained so this module doesn't depend on each
     host page's own showToast() signature (they differ slightly). ── */
  function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.background = '';
    t.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.add('hidden'), 3500);
  }

  /* ── Modal open/close/tabs ── */
  function setFlagButtonState(patient) {
    const flagBtn = document.getElementById('btnFlag');
    if (!flagBtn) return;
    flagBtn.classList.toggle('flagged', patient.flagged);
    flagBtn.innerHTML = patient.flagged
      ? '<i class="fa-solid fa-flag"></i> Flagged for Follow-up'
      : '<i class="fa-solid fa-flag"></i> Flag for Follow-up';
  }

  function close() {
    document.getElementById('detailModal')?.classList.add('hidden');
    document.body.style.overflow = '';
    currentPatient = null;
    const cb = onCloseCallback;
    onCloseCallback = null;
    if (cb) cb();
  }

  function wireEvents() {
    if (wired) return;
    wired = true;

    document.querySelectorAll('.ptab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ptab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.querySelectorAll('.ptab-panel').forEach(p => {
          p.classList.toggle('hidden', p.dataset.panel !== tab);
        });
        // Deferred a frame — drawing 3 canvas charts synchronously right
        // after the class toggle was competing with the browser's paint
        // of the tab underline for this tab specifically (the only tab
        // that does heavy synchronous work on click), so it could
        // visibly lag behind switching to Trends vs. the other tabs.
        if (tab === 'trends' && currentPatient) requestAnimationFrame(() => drawTrendCharts(currentPatient));
      });
    });

    document.getElementById('modalClose')?.addEventListener('click', close);
    document.getElementById('btnModalClose')?.addEventListener('click', close);
    document.getElementById('detailModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'detailModal') close();
    });

    document.getElementById('btnFlag')?.addEventListener('click', () => {
      if (!currentPatient) return;
      // Toggle on our own local reference rather than relying on the
      // shared-store mutation being visible here — the object passed
      // to open() isn't always the live PATIENTS entry (Risk Analysis
      // passes a shallow-copied row), so currentPatient.flagged
      // wouldn't otherwise reflect the change.
      const newFlagged = !currentPatient.flagged;
      window.DiaCarePatients?.setPatientFlag(currentPatient.id, newFlagged);
      currentPatient.flagged = newFlagged;
      setFlagButtonState(currentPatient);
      showToast(newFlagged
        ? `${currentPatient.name} flagged for follow-up.`
        : `Flag removed for ${currentPatient.name}.`);
    });

    document.getElementById('btnAddVisit')?.addEventListener('click', () => {
      if (!currentPatient) return;
      window.location.href = `../patient-encoding/patient-encoding.html?patient=${encodeURIComponent(currentPatient.id)}`;
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const trendsVisible = !document.querySelector('.ptab-panel[data-panel="trends"]')?.classList.contains('hidden');
        if (currentPatient && trendsVisible) drawTrendCharts(currentPatient);
      }, 200);
    });
  }

  function ensureReady() {
    if (!document.getElementById('detailModal')) {
      const wrap = document.createElement('div');
      wrap.innerHTML = MODAL_HTML.trim();
      document.body.appendChild(wrap.firstElementChild);
    }
    wireEvents();
  }

  function open(patient, opts) {
    if (!patient) return;
    ensureReady();
    currentPatient = patient;
    onCloseCallback = (opts && opts.onClose) || null;

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

    const requestedTab = (opts && opts.tab) || 'profile';
    document.querySelectorAll('.ptab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === requestedTab));
    document.querySelectorAll('.ptab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== requestedTab));
    if (requestedTab === 'trends') drawTrendCharts(patient);

    setFlagButtonState(patient);

    document.getElementById('detailModal')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  window.DiaCarePatientModal = { open, close, reviewField, riskPillHtml };
})();
