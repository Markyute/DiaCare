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

/* ── Alert preferences (Settings → Alert Preferences) ───────────────
   Per browser, in localStorage. Defaults mirror the checkboxes' own
   defaults so a nurse who never opened Settings gets the same bell as
   before. Missing keys fall back rather than switching an alert off. */
const ALERT_PREF_KEY = 'diacare_alert_preferences_v1';
const ALERT_PREF_DEFAULTS = {
  alertCriticalGlucose: true,
  alertCriticalBP: true,
  alertAtRisk: true,
  alertMissed: false,
  alertBrowser: false,
  alertSound: false,
};

function loadAlertPrefs() {
  try {
    const raw = localStorage.getItem(ALERT_PREF_KEY);
    return raw ? { ...ALERT_PREF_DEFAULTS, ...JSON.parse(raw) } : { ...ALERT_PREF_DEFAULTS };
  } catch {
    return { ...ALERT_PREF_DEFAULTS };
  }
}

/* Which of a critical patient's vitals crossed the line. A critical
   alert can be switched off for glucose and left on for BP, so the two
   are told apart here rather than treated as one "critical". */
function criticalCauses(p) {
  const [sys, dia] = String(p.bp || '').split('/').map(Number);
  return {
    glucose: !!p.glucose && (p.glucose >= 250 || p.glucose < 70),
    bp: (sys >= 140) || (dia >= 90),
  };
}

function getDiacareNotifications() {
  const patients = window.DiaCarePatients ? window.DiaCarePatients.PATIENTS : [];
  const acks = loadAcks();
  const prefs = loadAlertPrefs();
  return patients
    .map(p => {
      let type = null;
      if (p.missedToday) {
        if (prefs.alertMissed) type = 'missed';
      } else if (p.risk === 'critical') {
        const cause = criticalCauses(p);
        if ((cause.glucose && prefs.alertCriticalGlucose) || (cause.bp && prefs.alertCriticalBP)) type = 'critical';
      } else if (p.risk === 'warning') {
        if (prefs.alertAtRisk) type = 'atrisk';
      }
      if (!type || acks[p.id]) return null;
      return { id: p.id, type, name: p.name, trigger: buildTrigger(p), time: p.time };
    })
    .filter(Boolean);
}

/* ── Popup and sound ────────────────────────────────────────────────
   Only for a critical alert that was not in the previous render — the
   roster re-announces on every Firestore snapshot, and a nurse does not
   want the same patient chiming at her every few seconds. The first
   render after load seeds the set silently, so opening a page does not
   replay every existing alert. */
let seenCritical = null;

function announceNewCriticals(notifications) {
  const prefs = loadAlertPrefs();
  const current = new Set(notifications.filter(n => n.type === 'critical').map(n => n.id));

  if (seenCritical === null) {
    seenCritical = current;
    return;
  }

  const fresh = notifications.filter(n => n.type === 'critical' && !seenCritical.has(n.id));
  seenCritical = current;
  if (!fresh.length) return;

  if (prefs.alertBrowser && 'Notification' in window && Notification.permission === 'granted') {
    fresh.forEach(n => {
      try {
        new Notification(`High risk: ${n.name}`, { body: n.trigger, tag: `diacare-${n.id}` });
      } catch { /* the browser refused; the bell still shows it */ }
    });
  }

  if (prefs.alertSound) playAlertTone();
}

/* Two short tones from the Web Audio API — no audio file to ship, and
   nothing to fetch on a slow connection. Silently does nothing if the
   browser has not yet let the page make sound. */
function playAlertTone() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.18].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.16);
    });
  } catch { /* autoplay policy — nothing to do */ }
}

function renderTopNavNotifications() {
  const notifications = getDiacareNotifications();
  announceNewCriticals(notifications);

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
