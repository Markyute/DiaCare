'use strict';
/* ================================================================
   DiaCare RHU Libon — Glucose Trends JavaScript
   30-day glucose trend + barangay breakdown
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
   MOCK DATA — 30 days
   ================================================================ */

/* Daily average glucose — 30 days */
const DAILY_AVG = [
  158, 162, 171, 165, 180, 188, 175, 169, 172, 185,
  191, 178, 165, 170, 183, 190, 196, 188, 175, 168,
  172, 180, 188, 195, 201, 193, 185, 178, 172, 168
];

/* Generate last 30 day labels */
function getLast30Days() {
  const labels = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }));
  }
  return labels;
}
const DAY_LABELS = getLast30Days();

/* Barangay data — derived from the real shared roster instead of a
   separate hardcoded list. Previously this page's own BARANGAY_DATA
   didn't even agree with shared/patients-data.js's barangay list (it
   had "Bariw" where the shared list had "Villa Petrona"), and had no
   connection at all to real patient records.
   Filtered to barangays that actually have a patient — showing all 40
   official barangays here (many with zero patients) would make this
   specific "average glucose by barangay" comparison chart mostly empty
   bars; the full-coverage picture (including zero-patient barangays)
   already lives in Reports and Risk Analysis. */
let BARANGAY_DATA = [];

/* Frequency by time of day */
const FREQ_DATA = [
  { label: '6–8 AM', count: 48, pct: 85 },
  { label: '8–10 AM', count: 56, pct: 100 },
  { label: '10–12', count: 42, pct: 75 },
  { label: '12–2 PM', count: 38, pct: 68 },
  { label: '2–4 PM', count: 31, pct: 55 },
  { label: '4–6 PM', count: 29, pct: 52 },
];

/* Top patients by current glucose — derived from the real shared
   roster (highest glucose first) instead of a separate hardcoded list.
   Previously this list assigned patients to barangays that contradicted
   the shared roster (e.g. Ana Reyes shown here as "Binitayan" but
   "San Jose" everywhere else) and even referenced barangays that don't
   exist anywhere in Libon's actual barangay list. */
let TOP_PATIENTS = [];

/* Both lists come off the same roster, so they are rebuilt together. */
function rebuildDerived() {
  BARANGAY_DATA = (window.DiaCarePatients ? window.DiaCarePatients.getBarangaySummary() : [])
    .filter(b => b.patients > 0)
    .map(b => ({ name: b.name, avg: b.avgGlucose, patients: b.patients }))
    .sort((a, b) => b.avg - a.avg);

  TOP_PATIENTS = (window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : [])
    .filter(p => p.glucose) // exclude approved patients with no reading logged yet
    .map(p => ({
      name: p.name, initials: p.initials, color: p.color,
      barangay: p.barangay, avg: p.glucose, risk: p.risk,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);
}
rebuildDerived();

/* ================================================================
   POPULATION TREND LINE CHART
   ================================================================ */
function drawTrendChart() {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;
  const W = canvas.parentElement.offsetWidth || 600;
  const H = 220;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const PAD = { t: 20, b: 10, l: 44, r: 16 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;
  const MIN = 80, MAX = 300, RANGE = MAX - MIN;
  const n = DAILY_AVG.length;
  const xOf = i => PAD.l + (i / (n - 1)) * iW;
  const yOf = v => PAD.t + (1 - (v - MIN) / RANGE) * iH;

  /* Grid lines */
  ctx.font = `500 10px 'JetBrains Mono', monospace`;
  ctx.textAlign = 'right';
  [100, 140, 180, 220, 250, 280].forEach(v => {
    const y = yOf(v);
    ctx.strokeStyle = '#f0f7f3'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
    ctx.fillStyle = '#6b8177'; ctx.fillText(v, PAD.l - 6, y + 3.5);
  });

  /* Critical line 250 */
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#d0362f'; ctx.lineWidth = 1.5; ctx.globalAlpha = .6;
  ctx.beginPath(); ctx.moveTo(PAD.l, yOf(250)); ctx.lineTo(W - PAD.r, yOf(250)); ctx.stroke();

  /* Elevated line 180 */
  ctx.strokeStyle = '#c2760a'; ctx.lineWidth = 1.2; ctx.globalAlpha = .5;
  ctx.beginPath(); ctx.moveTo(PAD.l, yOf(180)); ctx.lineTo(W - PAD.r, yOf(180)); ctx.stroke();
  ctx.globalAlpha = 1; ctx.setLineDash([]);

  /* Area fill */
  const grad = ctx.createLinearGradient(0, PAD.t, 0, H);
  grad.addColorStop(0, 'rgba(34,168,102,.22)');
  grad.addColorStop(1, 'rgba(34,168,102,0)');
  ctx.beginPath();
  DAILY_AVG.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)));
  ctx.lineTo(xOf(n - 1), H - PAD.b); ctx.lineTo(xOf(0), H - PAD.b);
  ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

  /* Line */
  ctx.beginPath();
  DAILY_AVG.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)));
  ctx.strokeStyle = '#22a866'; ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();

  /* Dots — only show every 5th to avoid clutter */
  DAILY_AVG.forEach((v, i) => {
    if (i % 5 !== 0 && i !== n - 1) return;
    const color = v >= 250 ? '#d0362f' : v >= 180 ? '#c2760a' : '#22a866';
    ctx.beginPath(); ctx.arc(xOf(i), yOf(v), 4, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.fill(); ctx.stroke();
  });

  /* X Labels — show every 5th */
  const labEl = document.getElementById('trendLabels');
  if (labEl) {
    labEl.innerHTML = DAY_LABELS.map((l, i) =>
      `<span style="opacity:${i % 5 === 0 || i === n - 1 ? 1 : 0}">${l}</span>`
    ).join('');
  }
}

/* ================================================================
   DONUT CHART
   ================================================================ */
function drawDonut() {
  const canvas = document.getElementById('donutChart');
  if (!canvas) return;
  const size = 180;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2;
  const R = size / 2 - 8, r = R * 0.58;

  // Derived from the real patient roster instead of a separate
  // hardcoded 30-day array — that older version could also produce a
  // visibly incomplete circle: rounding each segment's count
  // independently doesn't reliably sum back to the whole (confirmed:
  // roughly 1 in 4 realistic distributions leave a small gap). Fixed
  // here by computing each slice's angle directly from its share of
  // the total, which always sums to exactly 360° by construction.
  const patients = window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : [];
  const total = patients.length || 1;
  const critical = patients.filter(p => p.risk === 'critical').length;
  const warning = patients.filter(p => p.risk === 'warning').length;
  const normal = total - critical - warning;

  const segs = [
    { label: 'Normal', count: normal, color: '#22a866' },
    { label: 'At Risk', count: warning, color: '#c2760a' },
    { label: 'Highly At Risk', count: critical, color: '#d0362f' },
  ];

  let startAngle = -Math.PI / 2;
  segs.forEach(seg => {
    const angle = (seg.count / total) * 2 * Math.PI;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, startAngle, startAngle + angle);
    ctx.closePath(); ctx.fillStyle = seg.color; ctx.fill();
    startAngle += angle;
  });

  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff'; ctx.fill();

  const totalEl = document.getElementById('donutTotal');
  if (totalEl) totalEl.textContent = total;

  const legEl = document.getElementById('donutLegend');
  if (legEl) legEl.innerHTML = segs.map(s =>
    `<div class="dleg-item">
      <span class="dleg-dot" style="background:${s.color}"></span>
      <span class="dleg-text">${s.label}</span>
      <span class="dleg-val">${s.count}</span>
    </div>`
  ).join('');
}

/* ================================================================
   BARANGAY BAR CHART
   ================================================================ */
function drawBarangayChart() {
  const canvas = document.getElementById('barangayChart');
  if (!canvas) return;
  const W = canvas.parentElement.offsetWidth || 900;
  const H = 240;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const PAD = { t: 20, b: 10, l: 44, r: 16 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;
  const n = BARANGAY_DATA.length;
  const MAX = 250;
  const barW = Math.max((iW / n) * 0.55, 16);
  const gap = iW / n;

  /* Grid */
  ctx.font = `500 10px 'JetBrains Mono', monospace`;
  ctx.textAlign = 'right';
  [70, 140, 180, 250].forEach(v => {
    const y = PAD.t + (1 - v / MAX) * iH;
    ctx.strokeStyle = '#f0f7f3'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
    ctx.fillStyle = '#6b8177'; ctx.fillText(v, PAD.l - 5, y + 3.5);
  });

  /* Dashed critical and elevated lines */
  ctx.setLineDash([4, 3]);
  [{ v: 250, c: '#d0362f' }, { v: 180, c: '#c2760a' }].forEach(({ v, c }) => {
    const y = PAD.t + (1 - v / MAX) * iH;
    ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.globalAlpha = .5;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
  });
  ctx.globalAlpha = 1; ctx.setLineDash([]);

  /* Bars */
  BARANGAY_DATA.forEach((b, i) => {
    const bH = ((b.avg) / MAX) * iH;
    const x = PAD.l + i * gap + (gap - barW) / 2;
    const y = PAD.t + iH - bH;
    const color = b.avg >= 250 ? '#d0362f' : b.avg >= 180 ? '#c2760a' : '#22a866';

    /* Bar with rounded top */
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, barW, bH, [5, 5, 0, 0]);
    else ctx.rect(x, y, barW, bH);
    ctx.fillStyle = color; ctx.fill();

    /* Value on top */
    ctx.font = `700 10px 'JetBrains Mono', monospace`;
    ctx.fillStyle = color; ctx.textAlign = 'center';
    ctx.fillText(b.avg, x + barW / 2, y - 5);
  });

  /* X Labels */
  const labEl = document.getElementById('barangayLabels');
  if (labEl) labEl.innerHTML = BARANGAY_DATA.map(b =>
    `<span>${b.name}</span>`
  ).join('');
}

/* ================================================================
   FREQUENCY GRID
   ================================================================ */
function renderFreqGrid() {
  const el = document.getElementById('freqGrid');
  if (!el) return;
  const maxPct = Math.max(...FREQ_DATA.map(f => f.pct));
  el.innerHTML = FREQ_DATA.map(f => {
    const color = f.pct >= 80 ? '#22a866' : f.pct >= 60 ? '#c2760a' : '#94a3b8';
    return `<div class="freq-item">
      <div class="freq-bar-wrap">
        <div class="freq-bar" style="height:${(f.pct / maxPct) * 70}px;background:${color}"></div>
      </div>
      <div class="freq-count">${f.count}</div>
      <div class="freq-lbl">${f.label}</div>
    </div>`;
  }).join('');
}

/* ================================================================
   TOP PATIENTS LIST
   ================================================================ */
function renderTopPatients() {
  const el = document.getElementById('topPatientsList');
  if (!el) return;
  el.innerHTML = TOP_PATIENTS.map((p, i) => {
    const rankCls = i === 0 ? 'top-rank--1' : i === 1 ? 'top-rank--2' : i === 2 ? 'top-rank--3' : '';
    const valCls = p.risk === 'critical' ? 'critical' : p.risk === 'warning' ? 'warning' : 'normal';
    return `<div class="top-patient-item">
      <div class="top-rank ${rankCls}">${i + 1}</div>
      <div class="top-av" style="background:${p.color}">${p.initials}</div>
      <div style="flex:1;min-width:0">
        <div class="top-name">${p.name}</div>
        <div class="top-barangay">${p.barangay}</div>
      </div>
      <div class="top-avg-val ${valCls}">${p.avg} <span style="font-size:10px;font-weight:400;color:var(--ink-faint)">mg/dL</span></div>
    </div>`;
  }).join('');
}

/* ================================================================
   EXPORT CSV
   ================================================================ */
document.getElementById('btnExport')?.addEventListener('click', () => {
  const rows = [
    ['Day', 'Date', 'Average Glucose (mg/dL)'],
    ...DAILY_AVG.map((v, i) => [i + 1, DAY_LABELS[i], v]),
  ];
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `glucose-trends-30days-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  showToast('Glucose trend data exported!');
});

/* ================================================================
   TOAST
   ================================================================ */
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
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
  renderFreqGrid();
  renderTopPatients();
  setTimeout(() => {
    drawTrendChart();
    drawDonut();
    drawBarangayChart();
  }, 60);
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    drawTrendChart();
    drawDonut();
    drawBarangayChart();
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
  rebuildDerived();
}

window.addEventListener('diacare:patients-loaded', () => {
  recomputeFromRoster();
  renderFreqGrid();
  renderTopPatients();
  drawTrendChart();
  drawDonut();
  drawBarangayChart();
});
