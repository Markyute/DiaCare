'use strict';
/* ================================================================
   DiaCare RHU Libon — Dashboard JavaScript
   Supports both App submissions and Manual encoding (Plan B)
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

/* ── Greeting — replaces the static "Dashboard" title with a
   time-of-day greeting to the logged-in user ── */
function renderGreeting() {
  const titleEl = document.getElementById('greetingTitle');
  if (!titleEl) return;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = document.getElementById('navUserName')?.textContent.trim() || 'RHU Nurse';
  titleEl.textContent = `${greeting}, ${name}`;
}
renderGreeting();

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
   so this page's stats agree with Patient Monitoring, Reports,
   Alerts, and Risk Analysis instead of using an independent list.
   ================================================================ */
let TODAY_PATIENTS = window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : [];

/* ================================================================
   CRITICAL ALERT STRIP — only shown when someone actually needs
   attention today
   ================================================================ */
function renderRibbonStats() {
  const totalEl = document.getElementById('statTotalPatients');
  const appEl = document.getElementById('statAppSubmissions');
  const manEl = document.getElementById('statManualEncoded');
  const refEl = document.getElementById('statReferrals');
  const brgyEl = document.getElementById('statBarangaysReached');

  const appCount = TODAY_PATIENTS.filter(p => p.source === 'app').length;
  const manualCount = TODAY_PATIENTS.filter(p => p.source === 'manual').length;
  const referrals = TODAY_PATIENTS.filter(p => p.referral && p.referral !== 'none').length;
  const barangaysReached = new Set(TODAY_PATIENTS.map(p => p.barangay)).size;

  if (totalEl) totalEl.textContent = TODAY_PATIENTS.length.toLocaleString('en-US');
  if (appEl) appEl.textContent = appCount.toLocaleString('en-US');
  if (manEl) manEl.textContent = manualCount.toLocaleString('en-US');
  if (refEl) refEl.textContent = referrals.toLocaleString('en-US');
  if (brgyEl) brgyEl.textContent = barangaysReached.toLocaleString('en-US');

  const reachedInfoEl = document.getElementById('barangaysReachedInfo');
  if (reachedInfoEl) reachedInfoEl.textContent = barangaysReached;
}

function renderStats() {
  const critical = TODAY_PATIENTS.filter(p => p.risk === 'critical').length;

  const strip = document.getElementById('criticalStrip');
  const stripCount = document.getElementById('criticalStripCount');
  if (strip) {
    if (critical > 0) {
      if (stripCount) stripCount.textContent = `${critical} patient${critical === 1 ? '' : 's'}`;
      strip.classList.remove('hidden');
    } else {
      strip.classList.add('hidden');
    }
  }
}

/* ================================================================
   PENDING APPROVALS STRIP — entirely separate from renderStats()
   above on purpose: this reads from PENDING_PATIENTS (patients not
   yet approved, so not part of TODAY_PATIENTS at all), and toggles
   its own independent banner. Doesn't touch the critical strip, the
   stat ribbon, or anything else on the page.
   ================================================================ */
function renderPendingStrip() {
  const pending = window.DiaCarePatients ? window.DiaCarePatients.PENDING_PATIENTS : [];
  const strip = document.getElementById('pendingStrip');
  const stripCount = document.getElementById('pendingStripCount');
  if (!strip) return;

  if (pending.length > 0) {
    if (stripCount) stripCount.textContent = `${pending.length} patient${pending.length === 1 ? '' : 's'}`;
    strip.classList.remove('hidden');
  } else {
    strip.classList.add('hidden');
  }
}

/* Notification bell wiring now lives in ../shared/notifications.js
   so every page shows the same alerts and behaves the same way. */

/* ================================================================
   RECENT READINGS TABLE
   ================================================================ */
const RISK_SEVERITY = { critical: 0, warning: 1, normal: 2 };
const RECENT_TABLE_LIMIT = 6;

/* "8:14 AM" -> minutes since midnight, for sorting readings within the
   same day newest-first. Falls back to 0 (oldest) if unparseable. */
function timeToMinutes(timeStr) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((timeStr || '').trim());
  if (!m) return 0;
  let [, h, min, ap] = m;
  h = parseInt(h, 10) % 12;
  if (/pm/i.test(ap)) h += 12;
  return h * 60 + parseInt(min, 10);
}

function renderRecentTable() {
  const tbody = document.getElementById('recentTbody');
  if (!tbody) return;

  /* Critical patients first — this table sits right under the
     "N patients need attention" banner, so a nurse scanning it
     should find those N rows without hunting through the full list.
     Within the same risk level, most recent reading first — this is
     a "recent readings" widget, not the full roster, so it's capped
     to RECENT_TABLE_LIMIT rows with "View all" for the rest. */
  const sorted = [...TODAY_PATIENTS]
    .sort((a, b) => RISK_SEVERITY[a.risk] - RISK_SEVERITY[b.risk] || timeToMinutes(b.time) - timeToMinutes(a.time))
    .slice(0, RECENT_TABLE_LIMIT);

  tbody.innerHTML = sorted.map(p => {
    const glcCls = p.risk === 'critical' ? 'glc-critical' : p.risk === 'warning' ? 'glc-warning' : 'glc-normal';
    const pillCls = p.risk === 'critical' ? 'risk-pill--critical' : p.risk === 'warning' ? 'risk-pill--warning' : 'risk-pill--normal';
    const pillIcon = p.risk === 'critical' ? 'fa-triangle-exclamation' : p.risk === 'warning' ? 'fa-circle-exclamation' : 'fa-circle-check';
    const pillLbl = p.risk === 'critical' ? 'Highly At Risk' : p.risk === 'warning' ? 'At Risk' : 'Normal';
    const rowCls = p.risk === 'critical' ? 'row-critical' : p.risk === 'warning' ? 'row-warning' : '';
    const srcCls = p.source === 'app' ? 'source-badge--app' : 'source-badge--manual';
    const srcIcon = p.source === 'app' ? 'fa-mobile-screen' : 'fa-keyboard';
    const srcLbl = p.source === 'app' ? 'App' : 'Manual';

    return `<tr class="${rowCls}">
      <td>
        <div class="pt-cell">
          <div class="pt-av" style="background:${p.color}">${p.initials}</div>
          <span class="pt-name">${p.name}</span>
        </div>
      </td>
      <td><span class="glc-val ${glcCls}">${p.glucose} mg/dL</span></td>
      <td><span class="bp-val">${p.bp} mmHg</span></td>
      <td><span class="risk-pill ${pillCls}"><i class="fa-solid ${pillIcon}"></i>${pillLbl}</span></td>
      <td>
        <span class="source-badge ${srcCls}">
          <i class="fa-solid ${srcIcon}"></i> ${srcLbl}
        </span>
      </td>
      <td style="font-size:12px;color:#93a89d;font-family:'JetBrains Mono',monospace;white-space:nowrap">${p.time}</td>
    </tr>`;
  }).join('');
}

/* ================================================================
   DONUT CHART
   ================================================================ */
function drawDonut() {
  const canvas = document.getElementById('donutChart');
  if (!canvas) return;
  const size = 260;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2;
  const R = size / 2 - 12, r = R * 0.58;

  const critical = TODAY_PATIENTS.filter(p => p.risk === 'critical').length;
  const warning = TODAY_PATIENTS.filter(p => p.risk === 'warning').length;
  const normal = TODAY_PATIENTS.filter(p => p.risk === 'normal').length;
  const total = TODAY_PATIENTS.length;

  const segs = [
    { label: 'High Risk', count: critical, color: '#d0362f', risk: 'critical' },
    { label: 'At Risk', count: warning, color: '#c2760a', risk: 'warning' },
    { label: 'Normal', count: normal, color: '#16a34a', risk: 'normal' },
  ];

  let startAngle = -Math.PI / 2;
  segs.forEach(seg => {
    const angle = (seg.count / total) * 2 * Math.PI;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, startAngle, startAngle + angle);
    ctx.closePath(); ctx.fillStyle = seg.color; ctx.fill();
    startAngle += angle;
  });

  /* Hole */
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff'; ctx.fill();

  /* Center number */
  const numEl = document.getElementById('donutTotal');
  if (numEl) numEl.textContent = total;

  /* Legend */
  /* Legend rows link into Patient Monitoring pre-filtered to that
     risk level — clicking "High Risk" takes you straight to the
     patients who need attention instead of just showing a count. */
  const legEl = document.getElementById('donutLegend');
  if (legEl) legEl.innerHTML = segs.map(s =>
    `<a class="dleg-item" href="../patient-monitoring/patient-monitoring.html?risk=${s.risk}" title="View ${s.label.toLowerCase()} patients">
      <span class="dleg-dot" style="background:${s.color}"></span>
      <span class="dleg-text">${s.label}</span>
      <span class="dleg-val">${s.count}</span>
    </a>`
  ).join('');
}

/* ================================================================
   RECENT BARANGAY ACTIVITY — derived from the real patient roster
   (grouped by barangay, most-recently-active first) instead of a
   separate hardcoded "missions" list that could name barangays or
   patient counts unconnected to any actual record.
   ================================================================ */
function renderMissions() {
  const el = document.getElementById('missionList');
  if (!el) return;

  // Group patients by barangay, tracking each group's most recent
  // submission time so the busiest, most-recently-active barangays
  // surface first. Compares actual time-of-day (timeToMinutes, shared
  // with Recent Patient Readings below) rather than array position —
  // the roster array is ordered oldest-first, not newest-first, so
  // sorting by index used to surface the barangays that went quiet
  // earliest instead of the ones actually active most recently.
  const byBarangay = new Map();
  TODAY_PATIENTS.forEach(p => {
    if (!byBarangay.has(p.barangay)) {
      byBarangay.set(p.barangay, { barangay: p.barangay, count: 0, latestTime: p.time });
    }
    const entry = byBarangay.get(p.barangay);
    entry.count++;
    if (timeToMinutes(p.time) > timeToMinutes(entry.latestTime)) entry.latestTime = p.time;
  });

  const activity = [...byBarangay.values()]
    .sort((a, b) => timeToMinutes(b.latestTime) - timeToMinutes(a.latestTime))
    .slice(0, 5);

  if (activity.length === 0) {
    el.innerHTML = '<div class="mission-empty">No patient activity recorded yet.</div>';
  } else {
    el.innerHTML = activity.map(a => {
      const barangayParam = encodeURIComponent(a.barangay);
      return `
      <a class="mission-item" href="../patient-monitoring/patient-monitoring.html?barangay=${barangayParam}" title="View patients from Brgy. ${a.barangay}">
        <div class="mission-icon"><i class="fa-solid fa-map-pin"></i></div>
        <div style="flex:1;min-width:0">
          <div class="mission-barangay">Brgy. ${a.barangay}</div>
          <div class="mission-meta">Latest submission: ${a.latestTime}</div>
        </div>
        <div class="mission-count">${a.count} pt${a.count === 1 ? '' : 's'}</div>
      </a>`;
    }).join('');
  }

  const lastEl = document.getElementById('lastMissionInfo');
  if (lastEl) {
    // Same fix as above — the actual most recent submission by time,
    // not just whichever patient happens to sit first in the array.
    const mostRecent = TODAY_PATIENTS.length
      ? [...TODAY_PATIENTS].sort((a, b) => timeToMinutes(b.time) - timeToMinutes(a.time))[0]
      : null;
    lastEl.textContent = mostRecent ? `${mostRecent.name}, ${mostRecent.time}` : '—';
  }
}

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
  renderRibbonStats();
  renderStats();
  renderPendingStrip();
  renderTopNavNotifications();
  initNotifDropdown();
  renderRecentTable();
  renderMissions();
  setTimeout(drawDonut, 80);
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
  TODAY_PATIENTS = window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : [];
}

window.addEventListener('diacare:patients-loaded', () => {
  recomputeFromRoster();
  renderRibbonStats();
  renderStats();
  renderPendingStrip();
  renderRecentTable();
  renderMissions();
  drawDonut();
});
