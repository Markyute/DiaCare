'use strict';
/* ================================================================
   DiaCare RHU Libon — Risk Analysis JavaScript
   Risk scores: current level + trend direction
   ================================================================ */

/* ── Session Guard ──
   Lives in shared/auth-guard.js now, loaded from this page's HTML. It
   checks the Firebase session and the verified-code claim rather than a
   localStorage flag any visitor could set from the console. */

function updateClock() {
  const now = new Date();
  const c = document.getElementById('topbarClock');
  const d = document.getElementById('topbarDate');
  if (c) c.textContent = now.toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  if (d) d.textContent = now.toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
}
updateClock();
setInterval(updateClock, 1000);

const menuToggle = document.getElementById('menuToggle');
const topnav     = document.getElementById('topnav');
menuToggle?.addEventListener('click', () => topnav.classList.toggle('nav-open'));
document.addEventListener('click', (e) => {
  if (topnav?.classList.contains('nav-open') && !topnav.contains(e.target))
    topnav.classList.remove('nav-open');
});

/* ================================================================
   PATIENT DATA — from the shared roster (../shared/patients-data.js),
   which already computes risk score/level/trend with the same
   formula this page used to keep locally, so counts here agree with
   Dashboard, Patient Monitoring, Reports, and Alerts.
   ================================================================ */
let SCORED = [];

/* Both lists come off the same roster, so they are rebuilt together —
   recomputing one without the other would leave the table and the
   barangay chart describing different populations. */
function rebuildDerived() {
  const roster = window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : [];

  SCORED = roster
    .map(p => ({ ...p, avgGlucose: p.glucose, level: p.risk }))
    .sort((a, b) => b.riskScore - a.riskScore);

  BARANGAY_RISK = (window.DiaCarePatients ? window.DiaCarePatients.getBarangaySummary() : [])
    .filter(b => b.patients > 0)
    .sort((a, b) => (b.highRisk + b.atRisk) - (a.highRisk + a.atRisk));
}

/* ================================================================
   BARANGAY DATA — derived from the same roster instead of an
   independent hardcoded list.
   ================================================================ */
let BARANGAY_RISK = [];
rebuildDerived();

/* ================================================================
   STATE
   ================================================================ */
let activeFilter = 'all';

/* ================================================================
   STAT CARDS
   ================================================================ */
function renderStats() {
  const highRisk  = SCORED.filter(p => p.level === 'critical').length;
  const atRisk    = SCORED.filter(p => p.level === 'warning').length;
  const normal    = SCORED.filter(p => p.level === 'normal').length;
  const worsening = SCORED.filter(p => p.trend === 'worsening').length;
  const improving = SCORED.filter(p => p.trend === 'improving').length;

  document.getElementById('statHighRisk').textContent  = highRisk;
  document.getElementById('statAtRisk').textContent    = atRisk;
  document.getElementById('statNormal').textContent    = normal;
  document.getElementById('statWorsening').textContent = worsening;
  document.getElementById('statImproving').textContent = improving;

  /* Early warning — At Risk + Worsening trend */
  const ewPatients = SCORED.filter(p => p.level === 'warning' && p.trend === 'worsening');
  const ewEl       = document.getElementById('ewCount');
  if (ewEl) ewEl.textContent = ewPatients.length;
  const strip = document.getElementById('earlyWarningStrip');
  if (strip) strip.style.display = ewPatients.length === 0 ? 'none' : '';
}

/* ================================================================
   DONUT CHART
   ================================================================ */
function drawDonut() {
  const canvas = document.getElementById('riskDonut');
  if (!canvas) return;
  const size = 170;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size/2, cy = size/2, R = size/2-8, r = R*.58;

  const high   = SCORED.filter(p => p.level === 'critical').length;
  const at     = SCORED.filter(p => p.level === 'warning').length;
  const normal = SCORED.filter(p => p.level === 'normal').length;
  const total  = SCORED.length;

  const segs = [
    { label:'Highly At Risk', count:high,   color:'#d0362f' },
    { label:'At Risk',        count:at,     color:'#c2760a' },
    { label:'Normal',         count:normal, color:'#22a866' },
  ];

  let startAngle = -Math.PI/2;
  segs.forEach(s => {
    const angle = (s.count/total)*2*Math.PI;
    ctx.beginPath(); ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,R,startAngle,startAngle+angle);
    ctx.closePath(); ctx.fillStyle=s.color; ctx.fill();
    startAngle += angle;
  });
  ctx.beginPath(); ctx.arc(cx,cy,r,0,2*Math.PI);
  ctx.fillStyle='#fff'; ctx.fill();

  document.getElementById('donutTotal').textContent = total;
  document.getElementById('donutLegend').innerHTML  = segs.map(s =>
    `<div class="dleg-item">
      <span class="dleg-dot" style="background:${s.color}"></span>
      <span class="dleg-text">${s.label}</span>
      <span class="dleg-val">${s.count}</span>
    </div>`
  ).join('');
}

/* ================================================================
   BARANGAY STACKED BAR CHART
   ================================================================ */
function drawBarangayChart() {
  const canvas = document.getElementById('barangayRiskChart');
  if (!canvas) return;
  const W = canvas.parentElement.offsetWidth || 600;
  const H = 260;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);

  const PAD = { t:20, b:10, l:36, r:12 };
  const iW  = W - PAD.l - PAD.r;
  const iH  = H - PAD.t - PAD.b;
  const n   = BARANGAY_RISK.length;
  const barW = Math.max((iW/n)*0.55, 14);
  const gap  = iW/n;
  const MAXVAL = Math.max(...BARANGAY_RISK.map(b => b.highRisk+b.atRisk+b.normal));

  /* Grid */
  ctx.font = `500 10px 'JetBrains Mono',monospace`;
  ctx.textAlign = 'right';
  [5,10,15].forEach(v => {
    if (v > MAXVAL) return;
    const y = PAD.t + (1-v/MAXVAL)*iH;
    ctx.strokeStyle='#f0f7f3'; ctx.lineWidth=1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(PAD.l,y); ctx.lineTo(W-PAD.r,y); ctx.stroke();
    ctx.fillStyle='#6b8177'; ctx.fillText(v, PAD.l-4, y+3.5);
  });

  /* Stacked bars */
  BARANGAY_RISK.forEach((b, i) => {
    const x      = PAD.l + i*gap + (gap-barW)/2;
    const total  = b.highRisk + b.atRisk + b.normal;
    const layers = [
      { val:b.normal,   color:'#22a866' },
      { val:b.atRisk,   color:'#c2760a' },
      { val:b.highRisk, color:'#d0362f' },
    ];
    let yBase = PAD.t + iH;
    layers.forEach(l => {
      if (l.val === 0) return;
      const bH = (l.val/MAXVAL)*iH;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, yBase-bH, barW, bH, [3,3,0,0]);
      else ctx.rect(x, yBase-bH, barW, bH);
      ctx.fillStyle = l.color; ctx.fill();
      yBase -= bH;
    });
    /* Total label */
    ctx.font = `700 10px 'JetBrains Mono',monospace`;
    ctx.fillStyle = '#374151'; ctx.textAlign = 'center';
    ctx.fillText(total, x+barW/2, PAD.t+(1-total/MAXVAL)*iH - 4);
  });

  /* X Labels */
  const labEl = document.getElementById('barangayLabels');
  if (labEl) labEl.innerHTML = BARANGAY_RISK.map(b => `<span>${b.name}</span>`).join('');
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
   PATIENT RISK TABLE
   ================================================================ */
function renderTable() {
  const tbody = document.getElementById('riskTbody');
  if (!tbody) return;

  const filtered = SCORED.filter(p => {
    if (activeFilter === 'all')      return true;
    if (activeFilter === 'high')     return p.level === 'critical';
    if (activeFilter === 'atrisk')   return p.level === 'warning';
    if (activeFilter === 'normal')   return p.level === 'normal';
    if (activeFilter === 'worsening')return p.trend === 'worsening';
    return true;
  });

  tbody.innerHTML = filtered.map((p, i) => {
    const rowCls    = p.level==='critical'?'row-critical':p.level==='warning'?'row-warning':'';
    const pillCls   = window.DiaCarePatients.riskMeta(p.level).cls;
    const pillIcon  = p.level==='critical'?'fa-triangle-exclamation':p.level==='warning'?'fa-circle-exclamation':'fa-circle-check';
    const pillLbl   = window.DiaCarePatients.riskMeta(p.level).lbl;
    const glcCls    = p.avgGlucose>=250||p.avgGlucose<70?'glc-critical':p.avgGlucose>=180?'glc-warning':'glc-normal';
    const barColor  = p.level==='critical'?'#d0362f':p.level==='warning'?'#c2760a':'#22a866';
    const scoreNumCls= p.level==='critical'?'glc-critical':p.level==='warning'?'glc-warning':'glc-normal';
    const trendCls  = p.trend==='worsening'?'trend-badge--worsening':p.trend==='improving'?'trend-badge--improving':'trend-badge--stable';
    const trendIcon = p.trend==='worsening'?'fa-arrow-trend-up':p.trend==='improving'?'fa-arrow-trend-down':'fa-minus';
    const trendLbl  = p.trend==='worsening'?'Worsening':p.trend==='improving'?'Improving':'Stable';

       return `<tr class="${rowCls}">
      <td><span style="font-family:var(--font-mono);font-size:12.5px;color:#000000">${sixDigitId(p.id)}</span></td>
      <td>
        <div class="pt-name">${p.name}</div>
      </td>
      <td style="font-size:13px;color:var(--ink)">${p.barangay}</td>
      <td>
        <div class="score-wrap">
          <div class="score-bar-bg">
            <div class="score-bar" style="width:${p.riskScore}%;background:${barColor}"></div>
          </div>
          <span class="score-num ${scoreNumCls}">${p.riskScore}%</span>
        </div>
      </td>
      <td><span class="risk-pill ${pillCls}"><i class="fa-solid ${pillIcon}"></i>${pillLbl}</span></td>
      <td><span class="glc-val ${glcCls}">${p.avgGlucose} <span style="font-size:10px;font-weight:400;color:var(--ink-faint)">mg/dL</span></span></td>
      <td><span class="bp-val">${p.bp} <span style="font-size:10px;color:var(--ink-faint)">mmHg</span></span></td>
      <td><span class="trend-badge ${trendCls}"><i class="fa-solid ${trendIcon}"></i> ${trendLbl}</span></td>
      <td>
        <button type="button" class="btn-view" data-action="view" data-id="${p.id}">
          <i class="fa-solid fa-eye"></i> View
        </button>
      </td>
    </tr>`;
  }).join('');

  /* Opens the shared tabbed profile in place, straight to Trends —
     the chart that explains "why" the trend badge says what it does —
     instead of navigating to Patient Monitoring and losing the
     current filter/scroll position here. */
  tbody.querySelectorAll('[data-action="view"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const patient = filtered.find(x => x.id === btn.dataset.id);
      if (patient) window.DiaCarePatientModal?.open(patient, { tab: 'trends' });
    });
  });
}

/* ── Filter pills ── */
document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderTable();
  });
});

/* ── Export CSV ── */
document.getElementById('btnExport')?.addEventListener('click', () => {
  const rows = [
    ['Rank','Patient ID','Name','Barangay','Risk Score','Risk Level','Avg Glucose (mg/dL)','Latest BP','Trend'],
    ...SCORED.map((p, i) => [
      i+1, p.id, p.name, p.barangay, p.riskScore,
      window.DiaCarePatients.riskMeta(p.level).lbl,
      p.avgGlucose, p.bp, p.trend.charAt(0).toUpperCase()+p.trend.slice(1)
    ]),
  ];
  const csv  = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `risk-analysis-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('Risk analysis exported as CSV!');
});

/* ── Toast ── */
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ── Init ── */
window.addEventListener('load', () => {
  renderTopNavNotifications();
  initNotifDropdown();
  renderStats();
  renderTable();
  setTimeout(() => { drawDonut(); drawBarangayChart(); }, 60);
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawBarangayChart, 200);
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
  rebuildDerived();
}

window.addEventListener('diacare:patients-loaded', () => {
  recomputeFromRoster();
  renderStats();
  renderTable();
  drawDonut();
  drawBarangayChart();
});
