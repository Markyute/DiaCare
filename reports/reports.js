'use strict';
/* ================================================================
   DiaCare RHU Libon — Reports JavaScript
   Barangay + Patient summaries | Print + Export CSV
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
  if (c) c.textContent = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (d) d.textContent = now.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}
updateClock();
setInterval(updateClock, 1000);

/* ── Mobile Nav ── */
const menuToggle = document.getElementById('menuToggle');
const topnav = document.getElementById('topnav');
menuToggle?.addEventListener('click', () => topnav.classList.toggle('nav-open'));
document.addEventListener('click', (e) => {
  if (topnav?.classList.contains('nav-open') && !topnav.contains(e.target))
    topnav.classList.remove('nav-open');
});

/* ================================================================
   DATA — derived from the shared roster (../shared/patients-data.js)
   so barangay/patient totals here agree with Dashboard, Patient
   Monitoring, Alerts, and Risk Analysis instead of independent
   hardcoded numbers.
   ================================================================ */
let BARANGAY_DATA = window.DiaCarePatients ? window.DiaCarePatients.getBarangaySummary() : [];

let PATIENT_DATA = (window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : []).map(p => ({
  ...p,
  avgGlucose: p.glucose,
  readings: p.visitCount,
}));

/* ================================================================
   STATE
   ================================================================ */
let activeType = 'barangay';
let activePeriod = '30';
let searchQuery = '';
let barangayFilter = 'all';

/* ================================================================
   PUBLISH PLATFORM-WIDE STATS — for the login screen's headline
   tiles. Deliberately computed from the raw, unfiltered shared
   roster (not getFilteredBarangay()/renderStats() below, which
   reflect whatever filter is currently active on this page).
   ================================================================ */
function publishPlatformStats() {
  if (!window.DiaCareStats || !window.DiaCarePatients) return;
  const patients = window.DiaCarePatients.PATIENTS;
  const totalPatients = patients.length;
  const elevatedRisk = patients.filter(p => p.risk === 'critical' || p.risk === 'warning').length;
  window.DiaCareStats.publish({
    totalPatients,
    totalBarangays: BARANGAY_DATA.length,
    elevatedRiskPct: Math.round((elevatedRisk / Math.max(totalPatients, 1)) * 100),
  });
}
publishPlatformStats();

/* ================================================================
   FILTER DATA
   ================================================================ */
function getFilteredBarangay() {
  return BARANGAY_DATA.filter(b => {
    const matchSearch = !searchQuery || b.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchBarangay = barangayFilter === 'all' || b.name === barangayFilter;
    return matchSearch && matchBarangay;
  });
}

function getFilteredPatients() {
  return PATIENT_DATA.filter(p => {
    const matchSearch = !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchBarangay = barangayFilter === 'all' || p.barangay === barangayFilter;
    return matchSearch && matchBarangay;
  });
}

/* ================================================================
   STAT CARDS
   ================================================================ */
function renderStats() {
  const data = activeType === 'barangay' ? getFilteredBarangay() : getFilteredPatients();

  if (activeType === 'barangay') {
    const totalPts = data.reduce((s, b) => s + b.patients, 0);
    const avgGlc = Math.round(data.reduce((s, b) => s + b.avgGlucose * b.patients, 0) / Math.max(totalPts, 1));
    const avgSys = Math.round(data.reduce((s, b) => s + b.avgSys * b.patients, 0) / Math.max(totalPts, 1));
    const avgDia = Math.round(data.reduce((s, b) => s + b.avgDia * b.patients, 0) / Math.max(totalPts, 1));
    const critical = data.reduce((s, b) => s + b.highRisk, 0);
    const referrals = data.reduce((s, b) => s + b.referrals, 0);
    document.getElementById('rStatPatients').textContent = totalPts;
    document.getElementById('rStatGlucose').textContent = avgGlc;
    document.getElementById('rStatBP').textContent = totalPts ? `${avgSys}/${avgDia}` : '—';
    document.getElementById('rStatCritical').textContent = critical;
    document.getElementById('rStatReferrals').textContent = referrals;
  } else {
    const avgGlc = Math.round(data.reduce((s, p) => s + p.avgGlucose, 0) / Math.max(data.length, 1));
    // Same fix as getBarangaySummary() — a patient with no logged
    // reading yet (approved but no health record) has no BP string to
    // split, which used to crash this whole calculation the moment one
    // existed in the filtered set.
    const withVitals = data.filter(p => p.bp);
    const bpVals = withVitals.map(p => p.bp.split('/').map(Number));
    const vn = Math.max(withVitals.length, 1);
    const avgSys = Math.round(bpVals.reduce((s, b) => s + b[0], 0) / vn);
    const avgDia = Math.round(bpVals.reduce((s, b) => s + b[1], 0) / vn);
    const critical = data.filter(p => p.risk === 'critical').length;
    const referrals = data.filter(p => p.referral !== 'none').length;
    document.getElementById('rStatPatients').textContent = data.length;
    document.getElementById('rStatGlucose').textContent = avgGlc;
    document.getElementById('rStatBP').textContent = data.length ? `${avgSys}/${avgDia}` : '—';
    document.getElementById('rStatCritical').textContent = critical;
    document.getElementById('rStatReferrals').textContent = referrals;
  }

  const countEl = document.getElementById('reportCount');
  if (countEl) countEl.textContent = `Showing ${data.length} records`;
}

/* ================================================================
   RENDER BARANGAY TABLE
   ================================================================ */
function renderBarangayTable() {
  const tbody = document.getElementById('barangayTbody');
  if (!tbody) return;
  const data = getFilteredBarangay();

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--ink-faint)">No barangay data found.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(b => {
    const risk = b.highRisk > 2 ? 'critical' : b.highRisk > 0 || b.atRisk > b.normal ? 'warning' : 'normal';
    const rowCls = risk === 'critical' ? 'row-critical' : risk === 'warning' ? 'row-warning' : '';
    const pillCls = risk === 'critical' ? 'risk-pill--critical' : risk === 'warning' ? 'risk-pill--warning' : 'risk-pill--normal';
    const pillIcon = risk === 'critical' ? 'fa-triangle-exclamation' : risk === 'warning' ? 'fa-circle-exclamation' : 'fa-circle-check';
    // "Priority Level" is a distinct, barangay-level rollup concept — not
    // the same thing as an individual patient's risk classification (the
    // "Highly At Risk" count column right next to it) — deliberately
    // worded differently so the two don't get confused for describing
    // the same fact.
    const pillLbl = risk === 'critical' ? 'High Priority' : risk === 'warning' ? 'Medium Priority' : 'Low Priority';
    const glcCls = b.avgGlucose >= 250 ? 'glc-critical' : b.avgGlucose >= 180 ? 'glc-warning' : 'glc-normal';
    return `<tr class="${rowCls}">
      <td style="font-weight:700;color:var(--ink)">${b.name}</td>
      <td style="font-family:var(--font-mono);font-weight:600">${b.patients}</td>
      <td><span class="glc-val ${glcCls}">${b.avgGlucose} <span style="font-size:10px;font-weight:400;color:var(--ink-faint)">mg/dL</span></span></td>
      <td><span class="bp-val">${b.avgBP} <span style="font-size:10px;color:var(--ink-faint)">mmHg</span></span></td>
      <td style="font-family:var(--font-mono);font-weight:700;color:var(--status-critical)">${b.highRisk}</td>
      <td style="font-family:var(--font-mono);font-weight:700;color:var(--status-warning)">${b.atRisk}</td>
      <td style="font-family:var(--font-mono);font-weight:700;color:var(--status-good)">${b.normal}</td>
      <td style="font-family:var(--font-mono);font-weight:600">${b.referrals}</td>
      <td><span class="risk-pill ${pillCls}"><i class="fa-solid ${pillIcon}"></i>${pillLbl}</span></td>
    </tr>`;
  }).join('');
}

/* ================================================================
   RENDER PATIENT TABLE
   ================================================================ */
function renderPatientTable() {
  const tbody = document.getElementById('patientTbody');
  if (!tbody) return;
  const data = getFilteredPatients();

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--ink-faint)">No patient data found.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(p => {
    const pillCls = p.risk === 'critical' ? 'risk-pill--critical' : p.risk === 'warning' ? 'risk-pill--warning' : 'risk-pill--normal';
    const pillIcon = p.risk === 'critical' ? 'fa-triangle-exclamation' : p.risk === 'warning' ? 'fa-circle-exclamation' : 'fa-circle-check';
    const pillLbl = p.risk === 'critical' ? 'Highly At Risk' : p.risk === 'warning' ? 'At Risk' : 'Normal';
    const glcCls = p.avgGlucose >= 250 ? 'glc-critical' : p.avgGlucose >= 180 ? 'glc-warning' : 'glc-normal';
    const rowCls = p.risk === 'critical' ? 'row-critical' : p.risk === 'warning' ? 'row-warning' : '';
    const refCls = p.referral === 'hospital' ? 'status-badge--referred' : p.referral === 'rhu' ? 'status-badge--referred' : 'status-badge--noreferral';
    const refLbl = p.referral === 'hospital' ? 'Hospital' : p.referral === 'rhu' ? 'RHU' : 'None';
    // Approved patients with no health record logged yet have no
    // glucose/BP — show "No data" instead of a broken "undefined".
    const hasVitals = p.avgGlucose && p.bp;
    return `<tr class="${rowCls}">
      <td>
        <div class="pt-cell">
          <div class="pt-av" style="background:${p.color}">${p.initials}</div>
          <div>
            <div class="pt-name">${p.name}</div>
            <div class="pt-id">${p.id}</div>
          </div>
        </div>
      </td>
      <td style="font-size:13px;color:var(--ink)">${p.age} / ${p.sex}</td>
      <td style="font-size:13px;color:var(--ink)">${p.barangay}</td>
      <td>${hasVitals ? `<span class="glc-val ${glcCls}">${p.avgGlucose} <span style="font-size:10px;font-weight:400;color:var(--ink-faint)">mg/dL</span></span>` : '<span style="color:var(--ink-faint);font-size:12px">No data yet</span>'}</td>
      <td>${hasVitals ? `<span class="bp-val">${p.bp} <span style="font-size:10px;color:var(--ink-faint)">mmHg</span></span>` : '<span style="color:var(--ink-faint);font-size:12px">—</span>'}</td>
      <td><span class="risk-pill ${pillCls}"><i class="fa-solid ${pillIcon}"></i>${pillLbl}</span></td>
      <td style="font-family:var(--font-mono);font-weight:600;text-align:center">${p.readings}</td>
      <td><span class="status-badge ${refCls}"><i class="fa-solid fa-hospital"></i> ${refLbl}</span></td>
    </tr>`;
  }).join('');
}

/* ================================================================
   SWITCH VIEWS
   ================================================================ */
function switchView() {
  const barangayRpt = document.getElementById('barangayReport');
  const patientRpt = document.getElementById('patientReport');
  if (activeType === 'barangay') {
    barangayRpt?.classList.remove('hidden');
    patientRpt?.classList.add('hidden');
    renderBarangayTable();
  } else {
    patientRpt?.classList.remove('hidden');
    barangayRpt?.classList.add('hidden');
    renderPatientTable();
  }
  renderStats();
  updatePrintMeta();
}

function updatePrintMeta() {
  const typeLabel = activeType === 'barangay' ? 'Barangay Summary' : 'Patient Summary';
  const printSub = document.getElementById('printSub');
  const printDate = document.getElementById('printDate');
  const printPeriod = document.getElementById('printPeriod');
  const printBarangay = document.getElementById('printBarangay');
  const printPreparedBy = document.getElementById('printPreparedBy');

  if (printSub) printSub.textContent = `${typeLabel} — ${activePeriod} Days`;
  if (printDate) printDate.textContent = new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  if (printPeriod) printPeriod.textContent = `Last ${activePeriod} Days`;
  if (printBarangay) printBarangay.textContent = barangayFilter === 'all' ? 'All Barangays' : `Brgy. ${barangayFilter}`;
  // Same name shown in the top nav for the logged-in nurse, so the
  // printed sign-off matches whoever's actually signed in instead of
  // always reading the generic placeholder.
  if (printPreparedBy) printPreparedBy.textContent = document.getElementById('navUserName')?.textContent.trim() || 'RHU Nurse';
}

/* ================================================================
   TAB EVENT LISTENERS
   ================================================================ */
document.querySelectorAll('.rtype-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.rtype-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeType = tab.dataset.type;
    switchView();
  });
});

document.querySelectorAll('.period-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activePeriod = tab.dataset.period;
    renderStats();
    updatePrintMeta();
  });
});

document.getElementById('barangayFilter')?.addEventListener('change', (e) => {
  barangayFilter = e.target.value;
  switchView();
});

document.getElementById('reportSearch')?.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  switchView();
});

/* ================================================================
   EXPORT PDF — the "Print Report" button (window.print()) was removed
   entirely rather than kept alongside this: the browser's own print
   header/footer (date, page title, URL, page number) can't be
   suppressed from the page itself, only by the person printing
   manually turning it off per-browser. Export PDF does the same job
   without ever opening that dialog — renders through html2canvas +
   jsPDF instead, so nothing from the browser can leak into the output.
   .pdf-export-mode (reports.css) mirrors the @media print styling
   since html2canvas only sees the live DOM as currently rendered on
   screen, not print-media rules.

   Paginated row-by-row rather than one tall canvas sliced across
   pages — slicing cut rows in half wherever a page boundary happened
   to land mid-row. Instead: measure the real table rows in an
   offscreen host at the report's actual width, group them into pages
   that fit the target page height without splitting a row, then
   render each page as its own html2canvas capture. The masthead only
   repeats on page 1; the table's own column headers repeat on every
   page (so a continuation page is still readable on its own); the
   signature block only appears after the last row, on its own page
   if it wouldn't otherwise fit.
   ================================================================ */
function buildPdfPages() {
  const activeTableWrap = activeType === 'barangay'
    ? document.getElementById('barangayReport')
    : document.getElementById('patientReport');
  const sourceTable = activeTableWrap.querySelector('.report-table');
  const theadHTML = sourceTable.querySelector('thead').outerHTML;
  const bodyRows = [...sourceTable.querySelectorAll('tbody tr')];

  const headerHTML = document.querySelector('.print-header').outerHTML;
  const sectionHdrHTML = activeTableWrap.querySelector('.report-section-hdr').outerHTML;
  const sigHTML = document.querySelector('.print-signature-block').outerHTML;
  const footerHTML = document.querySelector('.print-footer').outerHTML;

  const reportArea = document.getElementById('reportArea');
  const hostWidth = reportArea.getBoundingClientRect().width;

  const { jsPDF } = window.jspdf;
  const pdfTmp = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const pageWidthPt = pdfTmp.internal.pageSize.getWidth();
  const pageHeightPt = pdfTmp.internal.pageSize.getHeight();
  const marginPt = 24;
  const targetHeightPx = ((pageHeightPt - marginPt * 2) / (pageWidthPt - marginPt * 2)) * hostWidth;

  // pdf-export-mode is applied to this host directly, not document.body —
  // scoping it here keeps the whole measure/capture process invisible to
  // the visible page instead of flashing the real UI into print layout
  // for the seconds this takes to run. animation:none overrides
  // .report-area's cardIn fade-in, which a freshly-created element would
  // otherwise restart from 0 opacity — capturing before it finishes was
  // why the exported PDF looked almost blank.
  const measureHost = document.createElement('div');
  measureHost.className = 'report-area pdf-export-mode';
  measureHost.style.cssText = `position:fixed; left:-99999px; top:0; width:${hostWidth}px; background:#fff; padding:0; border:none; box-shadow:none; animation:none;`;
  document.body.appendChild(measureHost);

  // Reuses the source table's own class list (not a hardcoded
  // "report-table") so modifiers like report-table--barangay — which
  // column-alignment CSS depends on — carry over into this rebuilt
  // table instead of silently losing that styling.
  const tableClass = sourceTable.className;
  const buildPageHTML = (includeHeader, rowsHTML, includeFooter) => `
    ${includeHeader ? headerHTML : ''}
    ${sectionHdrHTML}
    <div class="report-table-wrap">
      <table class="${tableClass}">${theadHTML}<tbody>${rowsHTML}</tbody></table>
    </div>
    ${includeFooter ? sigHTML + footerHTML : ''}`;

  const pages = [];
  let pageIndex = 0;
  let rowsHTML = '';

  bodyRows.forEach((row) => {
    const rowHTML = row.outerHTML;
    measureHost.innerHTML = buildPageHTML(pageIndex === 0, rowsHTML + rowHTML, false);
    const h = measureHost.getBoundingClientRect().height;
    if (h > targetHeightPx && rowsHTML !== '') {
      pages.push(buildPageHTML(pageIndex === 0, rowsHTML, false));
      pageIndex++;
      rowsHTML = rowHTML;
    } else {
      rowsHTML += rowHTML;
    }
  });

  const withSig = buildPageHTML(pageIndex === 0, rowsHTML, true);
  measureHost.innerHTML = withSig;
  if (measureHost.getBoundingClientRect().height <= targetHeightPx) {
    pages.push(withSig);
  } else {
    pages.push(buildPageHTML(pageIndex === 0, rowsHTML, false));
    pages.push(sigHTML + footerHTML);
  }

  document.body.removeChild(measureHost);
  return { pages, hostWidth, pageWidthPt, pageHeightPt, marginPt };
}

document.getElementById('btnPDF')?.addEventListener('click', async () => {
  const btn = document.getElementById('btnPDF');
  if (!document.getElementById('reportArea') || !window.html2canvas || !window.jspdf) {
    showToast('PDF export failed to load — check your connection and try again.', true);
    return;
  }

  btn.disabled = true;
  const originalLabel = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';

  // Everything below builds/captures inside offscreen hosts, never
  // touching the visible page — no more flashing the real UI into
  // print layout while this runs.
  const renderHost = document.createElement('div');
  renderHost.className = 'report-area pdf-export-mode';
  document.body.appendChild(renderHost);

  try {
    const { pages, hostWidth, pageWidthPt, pageHeightPt, marginPt } = buildPdfPages();
    renderHost.style.cssText = `position:fixed; left:-99999px; top:0; width:${hostWidth}px; background:#fff; padding:0; border:none; box-shadow:none; animation:none;`;

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    const imgWidthPt = pageWidthPt - marginPt * 2;

    for (let i = 0; i < pages.length; i++) {
      renderHost.innerHTML = pages[i];
      await new Promise(r => requestAnimationFrame(r));
      // scale:1.5 (not 2) plus JPEG (not PNG) — a 40-row table at full
      // retina PNG produced a 35MB file, way too big to email or keep
      // around. JPEG's lossy compression barely shows on a flat white
      // report background and cuts that by roughly 10x.
      const canvas = await window.html2canvas(renderHost, { scale: 1.5, backgroundColor: '#ffffff', useCORS: true });
      const imgData = canvas.toDataURL('image/jpeg', 0.9);
      const imgHeightPt = (canvas.height * imgWidthPt) / canvas.width;
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', marginPt, marginPt, imgWidthPt, Math.min(imgHeightPt, pageHeightPt - marginPt * 2));
    }

    const typeLabel = activeType === 'barangay' ? 'barangay' : 'patient';
    pdf.save(`${typeLabel}-report-${activePeriod}days-${new Date().toISOString().slice(0, 10)}.pdf`);
    showToast('PDF report downloaded!');
  } catch (err) {
    showToast('PDF export failed. Please try again.', true);
  } finally {
    document.body.removeChild(renderHost);
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
});

/* ================================================================
   EXPORT CSV
   ================================================================ */
document.getElementById('btnCSV')?.addEventListener('click', () => {
  let rows = [], filename = '';

  if (activeType === 'barangay') {
    filename = `barangay-report-${activePeriod}days-${new Date().toISOString().slice(0, 10)}.csv`;
    rows = [
      ['Barangay', 'Patients', 'Avg Glucose (mg/dL)', 'Avg BP', 'Highly At Risk', 'At Risk', 'Normal', 'Referrals', 'Priority Level'],
      ...getFilteredBarangay().map(b => {
        const risk = b.highRisk > 2 ? 'High Priority' : b.highRisk > 0 || b.atRisk > b.normal ? 'Medium Priority' : 'Low Priority';
        return [b.name, b.patients, b.avgGlucose, b.avgBP, b.highRisk, b.atRisk, b.normal, b.referrals, risk];
      }),
    ];
  } else {
    filename = `patient-report-${activePeriod}days-${new Date().toISOString().slice(0, 10)}.csv`;
    rows = [
      ['Patient ID', 'Name', 'Age', 'Sex', 'Barangay', 'Avg Glucose (mg/dL)', 'Latest BP', 'Risk Level', 'Readings', 'Referral'],
      ...getFilteredPatients().map(p => [
        p.id, p.name, p.age, p.sex, p.barangay, p.avgGlucose, p.bp,
        p.risk === 'critical' ? 'Highly At Risk' : p.risk === 'warning' ? 'At Risk' : 'Normal',
        p.readings,
        p.referral === 'hospital' ? 'Hospital Referral' : p.referral === 'rhu' ? 'RHU Referral' : 'No Referral',
      ]),
    ];
  }

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  showToast('Report exported as CSV!');
});

/* ================================================================
   TOAST
   ================================================================ */
function showToast(msg, isError) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.background = isError ? 'var(--status-critical)' : '';
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ================================================================
   INIT
   ================================================================ */
window.addEventListener('load', () => {
  renderTopNavNotifications();
  initNotifDropdown();
  updatePrintMeta();
  switchView();
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
  BARANGAY_DATA = window.DiaCarePatients ? window.DiaCarePatients.getBarangaySummary() : [];
  PATIENT_DATA = (window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : []).map(p => ({
    ...p,
    avgGlucose: p.glucose,
    readings: p.visitCount,
  }));
}

window.addEventListener('diacare:patients-loaded', () => {
  recomputeFromRoster();
  publishPlatformStats();
  updatePrintMeta();
  switchView();
});
