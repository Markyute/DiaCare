'use strict';
/* ================================================================
   DiaCare RHU Libon — High-Risk Alerts JavaScript
   Triggers: glucose ≥250 or <70 mg/dL | BP ≥140/90 mmHg
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
const topnav = document.getElementById('topnav');
const menuToggle = document.getElementById('menuToggle');
menuToggle?.addEventListener('click', () => topnav.classList.toggle('nav-open'));
document.addEventListener('click', (e) => {
  if (topnav?.classList.contains('nav-open') && !topnav.contains(e.target))
    topnav.classList.remove('nav-open');
});

/* ================================================================
   ALERT DATA — derived from the shared roster
   (../shared/patients-data.js) so the patients flagged here agree
   with the Critical/At Risk counts shown on Patient Monitoring,
   Dashboard, and Risk Analysis instead of an independent list.
   type: 'critical' | 'atrisk' | 'missed'
   trigger: what caused the alert, built from the patient's vitals
   ================================================================ */
function buildTrigger(p) {
  if (p.missedToday) return 'No glucose or BP reading submitted today';
  if (!p.bp || !p.glucose) return 'No vitals recorded yet — awaiting first health record';
  const [sys, dia] = p.bp.split('/').map(Number);
  const glucoseFlag = p.glucose >= 250 ? `Glucose ${p.glucose} mg/dL — critically high (≥250)`
    : p.glucose < 70 ? `Glucose ${p.glucose} mg/dL — hypoglycemia (<70)`
      : p.glucose >= 180 ? `Glucose ${p.glucose} mg/dL — elevated (180–249)` : null;
  const bpFlag = (sys >= 140 || dia >= 90) ? `BP ${p.bp} mmHg — hypertension (≥140/90)` : null;
  if (glucoseFlag && bpFlag) return `Glucose ${p.glucose} mg/dL and BP ${p.bp} mmHg — both critical`;
  return glucoseFlag || bpFlag || 'Vitals within monitored range';
}

/* Acknowledged state persists per patient across reloads, same reason
   flags do — otherwise a nurse's work is silently undone by a page
   refresh, which is worse than not tracking it at all. */
const ACK_KEY = 'diacare_alert_acks_v1'; // { [patientId]: true }

function loadAcks() {
  try {
    const raw = localStorage.getItem(ACK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAcks(map) {
  try { localStorage.setItem(ACK_KEY, JSON.stringify(map)); } catch { /* private browsing */ }
}

const ACKS = loadAcks();

const ALERTS = (window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : [])
  .map((p, i) => {
    const type = p.missedToday ? 'missed' : p.risk === 'critical' ? 'critical' : p.risk === 'warning' ? 'atrisk' : null;
    if (!type) return null;
    return {
      id: `A-${String(i + 1).padStart(3, '0')}`, patientId: p.id, name: p.name,
      initials: p.initials, color: p.color, age: p.age, barangay: p.barangay,
      source: p.source, glucose: p.missedToday ? null : p.glucose, bp: p.missedToday ? null : p.bp,
      type, trigger: buildTrigger(p), time: p.time,
      // Flags come straight from the shared patient record (already
      // loaded from localStorage by patients-data.js) so flagging here
      // or from Patient Monitoring agrees. Acknowledged state has its
      // own store since it's specific to today's alert, not the patient.
      acknowledged: !!ACKS[p.id], flagged: !!p.flagged,
    };
  })
  .filter(Boolean);

/* ================================================================
   STATE
   ================================================================ */
let activeTab = 'critical';
let searchQuery = '';
let currentFlagId = null;

/* ================================================================
   STAT CARDS
   ================================================================ */
function renderStats() {
  const critical = ALERTS.filter(a => a.type === 'critical').length;
  const atRisk = ALERTS.filter(a => a.type === 'atrisk').length;
  const missed = ALERTS.filter(a => a.type === 'missed').length;
  const acknowledged = ALERTS.filter(a => a.acknowledged).length;

  document.getElementById('statCritical').textContent = critical;
  document.getElementById('statAtRisk').textContent = atRisk;
  document.getElementById('statMissed').textContent = missed;
  document.getElementById('statAcknowledged').textContent = acknowledged;

  /* Tab counts */
  document.getElementById('tabCountCritical').textContent = critical;
  document.getElementById('tabCountAtRisk').textContent = atRisk;
  document.getElementById('tabCountMissed').textContent = missed;

  renderNotifications();
}

/* ================================================================
   NOTIFICATION DROPDOWN — unresolved critical alerts
   ================================================================ */
const NOTIF_META = {
  critical: { icon: 'fa-triangle-exclamation', cls: 'critical' },
  atrisk: { icon: 'fa-heart-pulse', cls: 'warning' },
  missed: { icon: 'fa-clock-rotate-left', cls: 'missed' },
};

function renderNotifications() {
  const unresolved = ALERTS.filter(a => !a.acknowledged);

  const bellBadge = document.getElementById('navBellBadge');
  if (bellBadge) bellBadge.textContent = unresolved.length;

  const countEl = document.getElementById('notifCount');
  if (countEl) countEl.textContent = `${unresolved.length} new`;

  const listEl = document.getElementById('notifList');
  if (!listEl) return;

  if (unresolved.length === 0) {
    listEl.innerHTML = '<div class="tn-notif-empty">No new notifications right now.</div>';
    return;
  }

  listEl.innerHTML = unresolved.map(a => {
    const meta = NOTIF_META[a.type] || NOTIF_META.critical;
    return `
    <div class="tn-notif-item" data-tab="${a.type === 'atrisk' ? 'atrisk' : a.type}" data-alert-id="${a.id}">
      <div class="tn-notif-icon tn-notif-icon--${meta.cls}"><i class="fa-solid ${meta.icon}"></i></div>
      <div class="tn-notif-text">
        <div class="tn-notif-title">${a.name} — ${a.trigger}</div>
        <div class="tn-notif-time">${a.time}</div>
      </div>
    </div>`;
  }).join('');

  /* Clicking a notification jumps straight to that alert in the list below */
  listEl.querySelectorAll('.tn-notif-item').forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      const alertId = item.dataset.alertId;
      document.querySelectorAll('.alert-tab').forEach(t => t.classList.remove('active'));
      const tabBtn = document.querySelector(`.alert-tab[data-tab="${tab}"]`);
      tabBtn?.classList.add('active');
      activeTab = tab;
      renderList();
      notifPanel?.classList.add('hidden');
      requestAnimationFrame(() => {
        document.querySelector(`.alert-row[data-id="${alertId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  });
}

const notifTrigger = document.getElementById('notifTrigger');
const notifPanel = document.getElementById('notifPanel');
notifTrigger?.addEventListener('click', (e) => {
  e.stopPropagation();
  notifPanel?.classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (notifPanel && !notifPanel.classList.contains('hidden')) {
    if (!notifPanel.contains(e.target) && !notifTrigger?.contains(e.target)) {
      notifPanel.classList.add('hidden');
    }
  }
});

/* ================================================================
   FILTER
   ================================================================ */
function getFiltered() {
  return ALERTS.filter(a => {
    const matchTab = a.type === activeTab;
    const matchSearch = !searchQuery ||
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.patientId.toLowerCase().includes(searchQuery.toLowerCase());
    return matchTab && matchSearch;
  });
}

/* ================================================================
   RENDER ALERT LIST
   ================================================================ */
function renderList() {
  const list = document.getElementById('alertList');
  const emptyEl = document.getElementById('alertEmpty');
  const countEl = document.getElementById('alertResultCount');
  const emptyMsg = document.getElementById('alertEmptyMsg');
  if (!list) return;

  const filtered = getFiltered();
  if (countEl) countEl.textContent = `Showing ${filtered.length} alert${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    list.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (emptyMsg) {
      emptyMsg.textContent = searchQuery
        ? 'No alerts match your search.'
        : activeTab === 'critical' ? 'No critical alerts right now.'
          : activeTab === 'atrisk' ? 'No at-risk patients right now.'
            : 'No missed logs right now.';
    }
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');

  list.innerHTML = filtered.map(a => {
    const rowCls = a.acknowledged ? `alert-row alert-row--${a.type === 'atrisk' ? 'warning' : a.type} alert-row--acknowledged`
      : `alert-row alert-row--${a.type === 'atrisk' ? 'warning' : a.type}`;
    const glcClass = !a.glucose ? 'neutral' : (a.glucose >= 250 || a.glucose < 70) ? 'critical' : a.glucose >= 180 ? 'warning' : 'normal';
    const bpParts = a.bp ? a.bp.split('/').map(Number) : [0, 0];
    const bpClass = !a.bp ? 'neutral' : (bpParts[0] >= 140 || bpParts[1] >= 90) ? 'critical' : (bpParts[0] >= 120 || bpParts[1] >= 80) ? 'warning' : 'normal';
    const srcIcon = a.source === 'app' ? 'fa-mobile-screen' : 'fa-keyboard';
    const srcLbl = a.source === 'app' ? 'App' : 'Manual';
    const pulseDot = (!a.acknowledged && a.type === 'critical') ? '<div class="alert-unresolved-dot"></div>' : '';
    const reasonCls = a.type === 'critical' ? 'alert-reason--critical' : a.type === 'atrisk' ? 'alert-reason--warning' : 'alert-reason--missed';

    return `<div class="${rowCls}" data-id="${a.id}">
      ${pulseDot}
      <div class="alert-av" style="background:${a.color}">${a.initials}</div>
      <div class="alert-info">
        <div class="alert-name">${a.name}</div>
        <div class="alert-reason ${reasonCls}">${a.trigger}</div>
        <div class="alert-meta">
          <span><i class="fa-solid fa-id-card"></i> ${a.patientId}</span>
          <span><i class="fa-solid fa-user"></i> ${a.age} yrs</span>
          <span><i class="fa-solid fa-map-pin"></i> ${a.barangay}</span>
          <span><i class="fa-solid fa-${srcIcon}"></i> ${srcLbl}</span>
          ${a.time !== '—' ? `<span><i class="fa-solid fa-clock"></i> ${a.time}</span>` : ''}
          ${a.flagged ? '<span style="color:var(--status-warning)"><i class="fa-solid fa-flag"></i> Flagged</span>' : ''}
        </div>
      </div>
      <div class="alert-readings">
        ${a.glucose !== null
        ? `<span class="reading-badge reading-badge--${glcClass}"><i class="fa-solid fa-droplet"></i>${a.glucose} mg/dL</span>`
        : `<span class="reading-badge reading-badge--neutral"><i class="fa-solid fa-droplet"></i>No reading</span>`}
        ${a.bp !== null
        ? `<span class="reading-badge reading-badge--${bpClass}"><i class="fa-solid fa-heart-pulse"></i>${a.bp} mmHg</span>`
        : `<span class="reading-badge reading-badge--neutral"><i class="fa-solid fa-heart-pulse"></i>No reading</span>`}
      </div>
      <div class="alert-actions">
        <button type="button" class="btn-alert-view" data-action="view" data-id="${a.id}">
          <i class="fa-solid fa-eye"></i> View
        </button>
        <button class="btn-alert-ack ${a.acknowledged ? 'acked' : ''}"
                data-action="ack" data-id="${a.id}"
                ${a.acknowledged ? 'disabled' : ''}>
          <i class="fa-solid fa-check"></i> ${a.acknowledged ? 'Acknowledged' : 'Acknowledge'}
        </button>
        <button class="btn-alert-flag ${a.flagged ? 'flagged' : ''}"
                data-action="flag" data-id="${a.id}"
                title="${a.flagged ? 'Flagged for follow-up' : 'Flag for follow-up'}">
          <i class="fa-solid fa-flag"></i>
        </button>
      </div>
    </div>`;
  }).join('');

  /* Attach event listeners */
  list.querySelectorAll('[data-action="view"]').forEach(btn => {
    btn.addEventListener('click', () => openPatientFromAlert(btn.dataset.id));
  });
  list.querySelectorAll('[data-action="ack"]').forEach(btn => {
    btn.addEventListener('click', () => acknowledgeAlert(btn.dataset.id));
  });
  list.querySelectorAll('[data-action="flag"]').forEach(btn => {
    btn.addEventListener('click', () => openFlagModal(btn.dataset.id));
  });
}

/* ================================================================
   VIEW — opens the shared tabbed patient profile in place (Health
   Records tab, since that's the actual reading that triggered the
   alert) instead of navigating to Patient Monitoring and losing the
   current tab/search/scroll position here.
   ================================================================ */
function openPatientFromAlert(alertId) {
  const alert = ALERTS.find(a => a.id === alertId);
  if (!alert) return;
  const patient = (window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : []).find(p => p.id === alert.patientId);
  if (!patient) return;
  window.DiaCarePatientModal?.open(patient, { tab: 'records' });
}

/* ================================================================
   ACKNOWLEDGE
   ================================================================ */
function acknowledgeAlert(id) {
  const alert = ALERTS.find(a => a.id === id);
  if (!alert || alert.acknowledged) return;
  alert.acknowledged = true;
  ACKS[alert.patientId] = true;
  saveAcks(ACKS);
  renderStats();
  renderList();
  showToast(`${alert.name} marked as acknowledged.`);
}

document.getElementById('btnAcknowledgeAll')?.addEventListener('click', () => {
  const filtered = getFiltered();
  let count = 0;
  filtered.forEach(a => {
    if (!a.acknowledged) { a.acknowledged = true; ACKS[a.patientId] = true; count++; }
  });
  if (count > 0) saveAcks(ACKS);
  renderStats();
  renderList();
  showToast(count > 0 ? `${count} alert${count > 1 ? 's' : ''} acknowledged.` : 'All alerts already acknowledged.');
});

/* ================================================================
   FLAG MODAL
   ================================================================ */
function openFlagModal(id) {
  const alert = ALERTS.find(a => a.id === id);
  if (!alert) return;
  currentFlagId = id;
  const nameEl = document.getElementById('flagPatientName');
  if (nameEl) nameEl.textContent = `${alert.name} · ${alert.patientId}`;
  document.getElementById('flagReason').value = '';
  document.getElementById('flagNotes').value = '';
  document.getElementById('flagModal')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeFlagModal() {
  document.getElementById('flagModal')?.classList.add('hidden');
  document.body.style.overflow = '';
  currentFlagId = null;
}

document.getElementById('flagModalClose')?.addEventListener('click', closeFlagModal);
document.getElementById('flagModalCancel')?.addEventListener('click', closeFlagModal);

document.getElementById('flagModalConfirm')?.addEventListener('click', () => {
  const reason = document.getElementById('flagReason')?.value;
  if (!reason) { showToast('Please select a follow-up reason.', true); return; }
  const notes = document.getElementById('flagNotes')?.value;
  const alert = ALERTS.find(a => a.id === currentFlagId);
  if (alert) {
    window.DiaCarePatients?.setPatientFlag(alert.patientId, true, { reason, notes });
    alert.flagged = true;
    closeFlagModal();
    renderList();
    showToast(`${alert.name} flagged for follow-up.`);
  }
});

document.getElementById('flagModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('flagModal')) closeFlagModal();
});

/* ================================================================
   TABS
   ================================================================ */
document.querySelectorAll('.alert-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.alert-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    renderList();
  });
});

/* ================================================================
   SEARCH
   ================================================================ */
document.getElementById('alertSearch')?.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderList();
});

/* ================================================================
   REFRESH
   ================================================================ */
document.getElementById('btnRefresh')?.addEventListener('click', () => {
  const btn = document.getElementById('btnRefresh');
  btn?.classList.add('spinning');
  setTimeout(() => {
    btn?.classList.remove('spinning');
    renderStats();
    renderList();
    showToast('Alerts refreshed.');
  }, 800);
});

/* ================================================================
   TOAST
   ================================================================ */
function showToast(msg, isError = false) {
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
  renderStats();
  renderList();
});