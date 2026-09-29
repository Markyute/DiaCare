'use strict';
/* ================================================================
   DiaCare RHU Libon — Sync Monitoring JavaScript
   ================================================================ */

import { db } from '../shared/firebase.js';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

/* ── Topbar Clock ── */
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
  if (topnav?.classList.contains('nav-open') && !topnav.contains(e.target)) {
    topnav.classList.remove('nav-open');
  }
});

/* ── Toast Helper ── */
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

/* ================================================================
   STATE & DATA
   ================================================================ */
let BHW_LIST = [];
let ROSTER_ERROR = null;
let ALL_SYNC_LOGS = [];
let ACTIVE_FILTER = 'all';
let SEARCH_QUERY = '';
let SELECTED_BHW_ID = null;

/* ── Helpers ── */
function parseDate(val) {
  if (!val) return null;
  if (typeof val.toDate === 'function') return val.toDate();
  if (val instanceof Date) return val;
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function timeAgo(date) {
  if (!date) return 'Never';
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function formatFullDate(date) {
  if (!date) return 'Never';
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function initialsOf(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'BW';
}

function colorFor(str) {
  const colors = ['#0b5636', '#106d42', '#22a866', '#0284c7', '#7c3aed', '#b45309', '#0d9488'];
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/* ================================================================
   FIRESTORE SUBSCRIPTIONS
   ================================================================ */
function startLiveListeners() {
  // 1. Listen to users collection (to find all BHWs)
  onSnapshot(
    query(collection(db, 'users'), orderBy('createdAt', 'desc')),
    (snap) => {
      const allUsers = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          name: d.fullName || `${d.firstName || ''} ${d.lastName || ''}`.trim() || d.username || 'BHW',
          role: (d.role || '').toLowerCase(),
          barangay: d.barangay || 'Libon',
          purok: d.purok || '',
          username: d.username || '',
          status: d.status || 'active',
          color: d.color || colorFor(d.fullName || doc.id),
        };
      });

      // Filter to BHWs only
      BHW_LIST = allUsers.filter((u) => u.role === 'bhw');

      ROSTER_ERROR = null;
      renderAll();
    },
    (err) => {
      /* This used to substitute two invented BHWs — names, barangays and
         puroks that belong to nobody — so the page "worked" when the
         roster could not be read. A nurse had no way to tell the
         difference between two real workers who had not synced and two
         people who do not exist. An empty page that says what went wrong
         is the honest answer. */
      console.error('Could not subscribe to users roster:', err);
      ROSTER_ERROR = err;
      BHW_LIST = [];
      renderAll();
    }
  );

  // 2. Listen to sync_logs collection (real-time stream of all attempts)
  /* Capped rather than the whole collection. Every handset writes a log
     on every sync attempt, successful or not, so this grows without
     bound while the page only ever shows recent activity — an uncapped
     listener re-downloads the entire history on every dashboard load. */
  onSnapshot(
    query(collection(db, 'sync_logs'), orderBy('timestamp', 'desc'), limit(500)),
    (snap) => {
      ALL_SYNC_LOGS = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          bhwId: d.bhwId || '',
          /* serverTimestamp is written by Firestore when the sync
             arrives; 'timestamp' is the handset's own clock, which in
             the field is whatever the phone says it is. Prefer the
             server's, fall back for logs written by older builds. */
          timestamp: parseDate(d.serverTimestamp) || parseDate(d.timestamp),
          recordCount: Number(d.recordCount) || 0,
          syncedPatients: Number(d.syncedPatients) || 0,
          syncedRecords: Number(d.syncedRecords) || 0,
          status: d.status || 'failed',
          errorMessage: d.errorMessage || null,
        };
      });

      renderAll();

      // If modal is open, refresh its contents in real time
      if (SELECTED_BHW_ID) {
        renderModalTimeline(SELECTED_BHW_ID);
      }
    },
    (err) => {
      console.warn('Could not subscribe to sync_logs:', err);
    }
  );
}

/* ================================================================
   DATA AGGREGATION & METRICS
   ================================================================ */
function getBhwSyncData(bhw) {
  // Find all sync logs for this BHW (matches id, username, or assignedBhwId)
  const logs = ALL_SYNC_LOGS.filter(
    (l) => l.bhwId === bhw.id || (bhw.username && l.bhwId === bhw.username)
  ).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const totalAttempts = logs.length;
  const successfulAttempts = logs.filter((l) => l.status === 'success').length;
  const partialAttempts = logs.filter((l) => l.status === 'partial').length;
  const failedAttempts = logs.filter((l) => l.status === 'failed').length;

  const latestAttempt = logs.length > 0 ? logs[0] : null;
  const lastSuccessLog = logs.find((l) => l.status === 'success' || l.status === 'partial');
  const lastSuccessfulSync = lastSuccessLog ? lastSuccessLog.timestamp : null;

  // Compute status category
  let statusCategory = 'overdue';
  if (!lastSuccessfulSync) {
    statusCategory = 'overdue';
  } else {
    const diffHours = (new Date() - lastSuccessfulSync) / (1000 * 60 * 60);
    if (diffHours <= 24) {
      statusCategory = 'synced-today';
    } else if (diffHours <= 72) {
      statusCategory = 'stale';
    } else {
      statusCategory = 'overdue';
    }
  }

  const hasRecentFailure = latestAttempt && latestAttempt.status === 'failed';

  return {
    bhw,
    logs,
    totalAttempts,
    successfulAttempts,
    partialAttempts,
    failedAttempts,
    latestAttempt,
    lastSuccessfulSync,
    statusCategory,
    hasRecentFailure,
  };
}

/* ================================================================
   RENDERING
   ================================================================ */
function renderAll() {
  const bhwDataList = BHW_LIST.map((bhw) => getBhwSyncData(bhw));

  renderKPIs(bhwDataList);
  renderActiveView(bhwDataList);
}

function renderKPIs(bhwDataList) {
  const totalBhw = bhwDataList.length;
  const syncedToday = bhwDataList.filter((d) => d.statusCategory === 'synced-today').length;
  const stale = bhwDataList.filter((d) => d.statusCategory === 'overdue' || d.statusCategory === 'stale').length;

  const totalAttempts = ALL_SYNC_LOGS.length;
  const successfulOrPartial = ALL_SYNC_LOGS.filter((l) => l.status === 'success' || l.status === 'partial').length;
  const successRate = totalAttempts > 0 ? Math.round((successfulOrPartial / totalAttempts) * 100) : 100;

  document.getElementById('statTotalBhw').textContent = totalBhw;
  document.getElementById('statSyncedToday').textContent = syncedToday;
  document.getElementById('statStale').textContent = stale;
  document.getElementById('statSuccessRate').textContent = `${successRate}%`;
  document.getElementById('statAttemptCount').textContent = `${totalAttempts} attempts recorded`;
}

function filterBhwData(bhwDataList) {
  return bhwDataList.filter((item) => {
    // 1. Status Pill Filter
    if (ACTIVE_FILTER === 'synced-today' && item.statusCategory !== 'synced-today') return false;
    if (ACTIVE_FILTER === 'stale' && item.statusCategory !== 'stale') return false;
    if (ACTIVE_FILTER === 'overdue' && item.statusCategory !== 'overdue') return false;
    if (ACTIVE_FILTER === 'has-failed' && !item.hasRecentFailure && item.failedAttempts === 0) return false;

    // 2. Search Filter
    if (SEARCH_QUERY) {
      const q = SEARCH_QUERY.toLowerCase();
      const name = (item.bhw.name || '').toLowerCase();
      const brgy = (item.bhw.barangay || '').toLowerCase();
      const user = (item.bhw.username || '').toLowerCase();
      if (!name.includes(q) && !brgy.includes(q) && !user.includes(q)) {
        return false;
      }
    }

    return true;
  });
}

/* The empty state says which kind of empty this is: a roster that could
   not be read is a fault to report, not "no results". */
function renderEmptyState() {
  const icon = document.querySelector('#emptyState .empty-icon i');
  const title = document.querySelector('#emptyState .empty-title');
  const desc = document.querySelector('#emptyState .empty-desc');
  if (!title || !desc) return;

  if (ROSTER_ERROR) {
    if (icon) icon.className = 'fa-solid fa-triangle-exclamation';
    title.textContent = 'Could not load the BHW roster';
    desc.textContent =
      'The health worker list could not be read from the server, so sync '
      + 'activity cannot be shown. Check your connection and refresh — if '
      + 'this continues, your account may not have permission to view staff.';
    return;
  }

  if (icon) icon.className = 'fa-solid fa-cloud-arrow-down';
  if (BHW_LIST.length === 0) {
    title.textContent = 'No health workers registered yet';
    desc.textContent =
      'Sync activity appears here once a BHW account exists and their '
      + 'handset uploads for the first time.';
    return;
  }

  title.textContent = 'No Matching Sync Records';
  desc.textContent =
    'No BHWs match the current search or status filter criteria.';
}

function renderActiveView(bhwDataList) {
  const filtered = filterBhwData(bhwDataList);
  const emptyState = document.getElementById('emptyState');

  if (filtered.length === 0) {
    renderEmptyState();
    emptyState.classList.remove('hidden');
    document.getElementById('syncTableBody').innerHTML = '';
    return;
  }

  emptyState.classList.add('hidden');
  renderTableView(filtered);
}

/* ── Render Cards View ── */
function renderCardsView(items) {
  const container = document.getElementById('cardsView');
  container.innerHTML = items
    .map((item) => {
      const bhw = item.bhw;
      const initials = initialsOf(bhw.name);
      const relativeSync = timeAgo(item.lastSuccessfulSync);
      const fullSync = formatFullDate(item.lastSuccessfulSync);

      let badgeClass = 'badge-nosync';
      let badgeLabel = 'NO SYNC YET';
      if (item.statusCategory === 'synced-today') {
        badgeClass = 'badge-synced';
        badgeLabel = 'ACTIVE SYNC';
      } else if (item.statusCategory === 'stale') {
        badgeClass = 'badge-stale';
        badgeLabel = 'STALE CONTACT';
      } else if (item.statusCategory === 'overdue') {
        badgeClass = item.lastSuccessfulSync ? 'badge-overdue' : 'badge-nosync';
        badgeLabel = item.lastSuccessfulSync ? 'OVERDUE' : 'NO SYNC YET';
      }

      // Recent attempts mini chips
      const recentChips = item.logs.slice(0, 4).map((l) => {
        const timeStr = l.timestamp ? timeAgo(l.timestamp) : 'recent';
        let chipClass = 'chip-failed';
        let chipIcon = 'fa-circle-xmark';
        if (l.status === 'success') {
          chipClass = 'chip-success';
          chipIcon = 'fa-circle-check';
        } else if (l.status === 'partial') {
          chipClass = 'chip-partial';
          chipIcon = 'fa-triangle-exclamation';
        }
        return `
          <span class="attempt-micro-chip ${chipClass}" title="${l.status.toUpperCase()} (${l.recordCount} items)">
            <i class="fa-solid ${chipIcon}"></i> ${timeStr}
          </span>
        `;
      }).join('');

      return `
        <article class="bhw-card" data-bhw-id="${bhw.id}">
          <div class="bhw-card-header">
            <div class="bhw-card-avatar" style="background-color: ${bhw.color};">
              ${initials}
            </div>
            <div class="bhw-card-meta">
              <h3 class="bhw-card-name" title="${bhw.name}">${bhw.name}</h3>
              <div class="bhw-card-barangay">
                <i class="fa-solid fa-location-dot"></i> ${bhw.barangay.replace('Barangay ', '')}${bhw.purok ? ` • ${bhw.purok}` : ''}
              </div>
            </div>
            <span class="bhw-status-badge ${badgeClass}">${badgeLabel}</span>
          </div>

          <div class="bhw-card-metrics">
            <div class="metric-cell">
              <div class="m-label">Last Successful Sync</div>
              <div class="m-value" title="${fullSync}">${relativeSync}</div>
              <div class="m-sub">${item.lastSuccessfulSync ? item.lastSuccessfulSync.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : 'No records'}</div>
            </div>
            <div class="metric-cell">
              <div class="m-label">Sync Attempts</div>
              <div class="m-value">${item.totalAttempts} total</div>
              <div class="m-sub">${item.successfulAttempts} successful</div>
            </div>
          </div>

          <div class="recent-attempts-title">
            <span>Recent Attempts</span>
            <span>${item.logs.length} logged</span>
          </div>
          <div class="recent-chips-list">
            ${recentChips || '<span style="font-size: 11px; color: var(--ink-faint);">No sync attempts yet</span>'}
          </div>

          <div class="bhw-card-footer">
            <button class="btn-view-history" data-bhw-id="${bhw.id}">
              <i class="fa-solid fa-clock-rotate-left"></i> View Sync History
            </button>
          </div>
        </article>
      `;
    })
    .join('');

  // Attach click listeners for detail modal
  container.querySelectorAll('.btn-view-history').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const bhwId = e.currentTarget.getAttribute('data-bhw-id');
      openHistoryModal(bhwId);
    });
  });
}

/* ── Render Table View ── */
function renderTableView(items) {
  const tbody = document.getElementById('syncTableBody');
  tbody.innerHTML = items
    .map((item) => {
      const bhw = item.bhw;
      const initials = initialsOf(bhw.name);
      const relativeSync = timeAgo(item.lastSuccessfulSync);
      const fullSync = formatFullDate(item.lastSuccessfulSync);

      let statusBadge = '<span class="bhw-status-badge badge-nosync">NO SYNC</span>';
      if (item.latestAttempt) {
        if (item.latestAttempt.status === 'success') {
          statusBadge = '<span class="bhw-status-badge badge-synced"><i class="fa-solid fa-check"></i> SUCCESS</span>';
        } else if (item.latestAttempt.status === 'partial') {
          statusBadge = '<span class="bhw-status-badge badge-stale"><i class="fa-solid fa-triangle-exclamation"></i> PARTIAL</span>';
        } else {
          statusBadge = '<span class="bhw-status-badge badge-overdue"><i class="fa-solid fa-xmark"></i> FAILED</span>';
        }
      }

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 32px; height: 32px; border-radius: 8px; background: ${bhw.color}; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px;">
                ${initials}
              </div>
              <div>
                <strong style="font-size: 14px; color: var(--ink);">${bhw.name}</strong>
                <div style="font-size: 11.5px; color: var(--ink-faint);">${bhw.username || 'bhw'}</div>
              </div>
            </div>
          </td>
          <td>${bhw.barangay} ${bhw.purok ? `(${bhw.purok})` : ''}</td>
          <td>
            <div style="font-weight: 600;" title="${fullSync}">${relativeSync}</div>
            <div style="font-size: 11px; color: var(--ink-faint);">${item.lastSuccessfulSync ? fullSync : '—'}</div>
          </td>
          <td>${statusBadge}</td>
                   <td style="text-align:center"><strong>${item.totalAttempts}</strong></td>
          <td style="text-align:center">
            <button class="btn btn-secondary btn-sm btn-table-history" data-bhw-id="${bhw.id}">
              <i class="fa-solid fa-clock-rotate-left"></i> History
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.btn-table-history').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const bhwId = e.currentTarget.getAttribute('data-bhw-id');
      openHistoryModal(bhwId);
    });
  });
}

/* ── Render Stream View ── */
function renderStreamView() {
  const tbody = document.getElementById('streamTableBody');
  const countEl = document.getElementById('streamCount');
  countEl.textContent = `${ALL_SYNC_LOGS.length} events`;

  // Lookup map for BHW details
  const bhwMap = new Map();
  BHW_LIST.forEach((b) => {
    bhwMap.set(b.id, b);
    if (b.username) bhwMap.set(b.username, b);
  });

  tbody.innerHTML = ALL_SYNC_LOGS.map((log) => {
    const bhw = bhwMap.get(log.bhwId) || { name: log.bhwId || 'Unknown BHW', barangay: 'Field' };
    const dateFormatted = formatFullDate(log.timestamp);
    const timeFormatted = timeAgo(log.timestamp);

    let statusChip = '<span class="bhw-status-badge badge-overdue"><i class="fa-solid fa-xmark"></i> FAILED</span>';
    if (log.status === 'success') {
      statusChip = '<span class="bhw-status-badge badge-synced"><i class="fa-solid fa-check"></i> SUCCESS</span>';
    } else if (log.status === 'partial') {
      statusChip = '<span class="bhw-status-badge badge-stale"><i class="fa-solid fa-triangle-exclamation"></i> PARTIAL</span>';
    }

    return `
      <tr>
        <td>
          <div style="font-weight: 600; color: var(--ink);">${timeFormatted}</div>
          <div style="font-size: 11px; color: var(--ink-faint);">${dateFormatted}</div>
        </td>
        <td>
          <strong style="color: var(--ink);">${bhw.name}</strong>
          <div style="font-size: 11.5px; color: var(--ink-faint);">${bhw.barangay}</div>
        </td>
        <td>${statusChip}</td>
        <td>
          <div style="font-weight: 700;">${log.recordCount} items</div>
          <div style="font-size: 11.5px; color: var(--ink-soft);">
            ${log.syncedPatients} patients, ${log.syncedRecords} records
          </div>
        </td>
        <td>
          ${
            log.errorMessage
              ? `<span class="error-callout" title="${log.errorMessage}"><i class="fa-solid fa-circle-exclamation"></i> ${log.errorMessage}</span>`
              : '<span style="color: var(--status-good); font-size: 12px; font-weight: 600;"><i class="fa-solid fa-check-double"></i> Clean push to Firestore</span>'
          }
        </td>
      </tr>
    `;
  }).join('');
}

/* ================================================================
   MODAL DETAIL VIEW
   ================================================================ */
function openHistoryModal(bhwId) {
  SELECTED_BHW_ID = bhwId;
  const modal = document.getElementById('historyModal');
  modal.classList.remove('hidden');
  renderModalTimeline(bhwId);
}

function closeHistoryModal() {
  SELECTED_BHW_ID = null;
  const modal = document.getElementById('historyModal');
  modal.classList.add('hidden');
}

function renderModalTimeline(bhwId) {
  const bhw = BHW_LIST.find((b) => b.id === bhwId) || { name: 'Barangay Health Worker', barangay: 'Libon', color: '#0b5636' };
  const data = getBhwSyncData(bhw);

  document.getElementById('modalBhwAvatar').textContent = initialsOf(bhw.name);
  document.getElementById('modalBhwAvatar').style.backgroundColor = bhw.color || '#0b5636';
  document.getElementById('modalBhwName').textContent = bhw.name;
  document.getElementById('modalBhwMeta').textContent = `${bhw.barangay}${bhw.purok ? ` • ${bhw.purok}` : ''} • ID: ${bhw.username || bhw.id}`;

    document.getElementById('modalLastSync').textContent = data.lastSuccessfulSync ? formatFullDate(data.lastSuccessfulSync) : 'Never synced';
  document.getElementById('modalTotalAttempts').textContent = data.totalAttempts;
  const rate = data.totalAttempts > 0 ? Math.round(((data.successfulAttempts + data.partialAttempts) / data.totalAttempts) * 100) : 0;
  const rateEl = document.getElementById('modalSuccessRate');
  rateEl.textContent = data.totalAttempts > 0 ? `${rate}%` : '—';
  rateEl.style.color = data.totalAttempts === 0
    ? ''
    : rate >= 90 ? 'var(--status-good)'
    : rate >= 70 ? 'var(--status-warning)'
    : 'var(--status-critical)';
  const timeline = document.getElementById('historyTimeline');
  if (data.logs.length === 0) {
    timeline.innerHTML = `
      <div style="text-align: center; padding: 32px 16px; color: var(--ink-faint);">
        <i class="fa-solid fa-clock-rotate-left" style="font-size: 28px; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
        No sync attempts have been recorded for this BHW yet.
      </div>
    `;
    return;
  }

  timeline.innerHTML = data.logs.map((log) => {
    const formattedDate = formatFullDate(log.timestamp);
    const relativeTime = timeAgo(log.timestamp);

    let statusChip = '<span class="bhw-status-badge badge-overdue"><i class="fa-solid fa-xmark"></i> FAILED</span>';
    if (log.status === 'success') {
      statusChip = '<span class="bhw-status-badge badge-synced"><i class="fa-solid fa-check"></i> SUCCESS</span>';
    } else if (log.status === 'partial') {
      statusChip = '<span class="bhw-status-badge badge-stale"><i class="fa-solid fa-triangle-exclamation"></i> PARTIAL</span>';
    }

    return `
      <div class="timeline-item">
        <div class="timeline-top">
          <div>
            <span class="timeline-date">${formattedDate}</span>
            <span style="font-size: 11px; color: var(--ink-faint); margin-left: 6px;">(${relativeTime})</span>
          </div>
          ${statusChip}
        </div>

        <div class="timeline-details">
          <span><i class="fa-solid fa-list-ol"></i> <strong>${log.recordCount}</strong> total items in attempt</span>
          <span><i class="fa-solid fa-user-check"></i> ${log.syncedPatients} patients synced</span>
          <span><i class="fa-solid fa-notes-medical"></i> ${log.syncedRecords} records synced</span>
        </div>

        ${
          log.errorMessage
            ? `<div class="timeline-error"><i class="fa-solid fa-triangle-exclamation"></i> Error reported: ${log.errorMessage}</div>`
            : ''
        }
      </div>
    `;
  }).join('');
}

/* ================================================================
   EVENT HANDLERS
   ================================================================ */
function initEventHandlers() {
  // Search input
  const searchInput = document.getElementById('searchInput');
  searchInput?.addEventListener('input', (e) => {
    SEARCH_QUERY = e.target.value.trim();
    renderAll();
  });

  // Filter pills
  document.querySelectorAll('.filter-pills .pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pills .pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      ACTIVE_FILTER = pill.getAttribute('data-filter');
      renderAll();
    });
  });

  // Refresh button
  document.getElementById('refreshBtn')?.addEventListener('click', () => {
    renderAll();
    showToast('Sync monitoring data refreshed');
  });

  // Modal close handlers
  document.getElementById('modalCloseBtn')?.addEventListener('click', closeHistoryModal);
  document.getElementById('modalDismissBtn')?.addEventListener('click', closeHistoryModal);
  document.getElementById('historyModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'historyModal') closeHistoryModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && SELECTED_BHW_ID) closeHistoryModal();
  });
}

/* ================================================================
   INITIALIZATION
   ================================================================ */
startLiveListeners();
initEventHandlers();
