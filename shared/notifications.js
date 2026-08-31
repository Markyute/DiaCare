'use strict';
/* ================================================================
   DiaCare RHU Libon — Shared Notification Feed
   Single source of truth for the top-nav bell dropdown so every
   page shows the same alerts, in the same order, with the same
   count. Load this before a page's own script, then call
   renderTopNavNotifications() and initNotifDropdown() from it.

   Built live from window.DiaCarePatients.PATIENTS using the exact
   same critical/at-risk/missed classification, trigger text, and
   acknowledged-state store (diacare_alert_acks_v1) as the dedicated
   Alerts page (alerts/high-risk.js) — this used to be a hand-typed
   snapshot of that page's output, which silently went stale (missed
   patients, wrong counts) the moment the underlying patient data
   changed. Deriving it here instead means the two can never
   disagree.
   ================================================================ */
const ACK_KEY = 'diacare_alert_acks_v1'; // { [patientId]: true }

function loadAcks() {
  try {
    const raw = localStorage.getItem(ACK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

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

const NOTIF_META = {
  critical: { icon: 'fa-triangle-exclamation', cls: 'critical' },
  atrisk: { icon: 'fa-heart-pulse', cls: 'warning' },
  missed: { icon: 'fa-clock-rotate-left', cls: 'missed' },
};

function getDiacareNotifications() {
  const patients = window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : [];
  const acks = loadAcks();
  return patients
    .map(p => {
      const type = p.missedToday ? 'missed' : p.risk === 'critical' ? 'critical' : p.risk === 'warning' ? 'atrisk' : null;
      if (!type || acks[p.id]) return null;
      return { id: p.id, type, name: p.name, trigger: buildTrigger(p), time: p.time };
    })
    .filter(Boolean);
}

function renderTopNavNotifications() {
  const notifications = getDiacareNotifications();

  const bellBadge = document.getElementById('navBellBadge');
  if (bellBadge) bellBadge.textContent = notifications.length;

  const notifBtn = document.getElementById('notifTrigger');
  if (notifBtn) notifBtn.setAttribute('aria-label', `Notifications, ${notifications.length} unread`);

  const countEl = document.getElementById('notifCount');
  if (countEl) countEl.textContent = `${notifications.length} new`;

  const listEl = document.getElementById('notifList');
  if (!listEl) return;

  if (notifications.length === 0) {
    listEl.innerHTML = '<div class="tn-notif-empty">No new notifications right now.</div>';
    return;
  }

  listEl.innerHTML = notifications.map(n => {
    const meta = NOTIF_META[n.type] || NOTIF_META.critical;
    /* Straight to the patient the alert is about, on the Health Records
       tab — the reading that triggered it. Landing on a list of every
       alert and making the nurse find the same person again was busywork
       the link already had enough information to skip. */
    const href = `../patient-monitoring/patient-monitoring.html?patient=${encodeURIComponent(n.id)}&tab=records`;
    return `
    <a href="${href}" class="tn-notif-item">
      <div class="tn-notif-icon tn-notif-icon--${meta.cls}"><i class="fa-solid ${meta.icon}"></i></div>
      <div class="tn-notif-text">
        <div class="tn-notif-title">${n.name} — ${n.trigger}</div>
        <div class="tn-notif-time">${n.time}</div>
      </div>
    </a>`;
  }).join('');
}

function initNotifDropdown() {
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
}

/* ================================================================
   STAY CURRENT

   The roster arrives after this page has already rendered, and keeps
   arriving — patients-data.js holds live Firestore subscriptions, so a
   visit synced from a BHW's phone raises this event on every open
   dashboard. Re-rendering here means the bell count is live everywhere
   without each page having to remember to ask.
   ================================================================ */
window.addEventListener('diacare:patients-loaded', () => {
  renderTopNavNotifications();
});
