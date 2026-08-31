/* ================================================================
   DiaCare — System Activity feed

   The Super Admin's record of who changed what. Reads audit_log, which
   is appended to from two places: the API writes staff changes with the
   Admin SDK, and the dashboard writes its own patient work, because
   those documents never pass through the server.

   Either way an entry is fixed once written — the rules allow no update
   and no delete from anywhere, and a browser may only append in its own
   name — so nothing here can be revised by the person it describes.

   Live, because the useful question is usually "what just happened".
   ================================================================ */

import { auth, db, onAuthStateChanged } from './firebase.js';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const MAX_ENTRIES = 25;

/* Actions that take access away read differently from ones that grant
   it, and are the ones worth spotting in a scan. */
const DANGER_ACTIONS = new Set(['STAFF_DEACTIVATED', 'PATIENT_REJECTED']);

const ACTION_ICONS = {
  PATIENT_CREATED: 'fa-user-injured',
  VISIT_RECORDED: 'fa-notes-medical',
  PATIENT_FLAGGED: 'fa-flag',
  PATIENT_UNFLAGGED: 'fa-flag',
  PATIENT_APPROVED: 'fa-circle-check',
  PATIENT_REJECTED: 'fa-circle-xmark',
  STAFF_CREATED: 'fa-user-plus',
  STAFF_UPDATED: 'fa-user-pen',
  STAFF_ACTIVATED: 'fa-user-check',
  STAFF_DEACTIVATED: 'fa-user-slash',
  STAFF_ROLE_CHANGED: 'fa-user-shield',
  STAFF_PASSWORD_RESET: 'fa-key',
};

/* Entries are written by people and read as HTML, so everything from
   the document is escaped on the way in. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* "3 minutes ago" answers the question the feed is for better than a
   timestamp does; the exact time stays in the title attribute. */
function relativeTime(date) {
  if (!date) return '';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.floor(hours / 24);
  if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function render(entries) {
  const listEl = document.getElementById('activityList');
  if (!listEl) return;

  if (!entries.length) {
    listEl.innerHTML = '<div class="activity-empty">No changes recorded yet. '
      + 'Account changes, patient registrations, and recorded visits will appear here.</div>';
    return;
  }

  listEl.innerHTML = entries.map((e) => {
    const icon = ACTION_ICONS[e.action] || 'fa-circle-info';
    const danger = DANGER_ACTIONS.has(e.action) ? ' activity-icon--danger' : '';
    const when = relativeTime(e.at);
    const exact = e.at ? e.at.toLocaleString('en-PH') : '';

    const target = e.targetName ? ' <strong>' + escapeHtml(e.targetName) + '</strong>' : '';
    const detail = e.detail ? ' &middot; ' + escapeHtml(e.detail) : '';

    return `
      <div class="activity-row">
        <div class="activity-icon${danger}"><i class="fa-solid ${icon}"></i></div>
        <div class="activity-body">
          <div class="activity-text">
            <strong>${escapeHtml(e.actorName)}</strong> ${escapeHtml(e.actionLabel)}${target}
          </div>
          <div class="activity-meta" title="${escapeHtml(exact)}">${escapeHtml(when)}${detail}</div>
        </div>
      </div>`;
  }).join('');
}

onAuthStateChanged(auth, (user) => {
  if (!user) return;

  const card = document.getElementById('activityCard');
  if (!card) return;

  const q = query(collection(db, 'audit_log'), orderBy('at', 'desc'), limit(MAX_ENTRIES));

  onSnapshot(
    q,
    (snap) => {
      /* The card stays hidden until the read succeeds. A nurse who
         forced the markup back in is refused by the rules, so nothing
         appears rather than an empty card implying there is nothing to
         see. session.js removes it for them anyway. */
      card.hidden = false;

      render(snap.docs.map((d) => {
        const data = d.data();
        return {
          action: data.action || '',
          actionLabel: data.actionLabel || data.action || 'made a change',
          actorName: data.actorName || 'Unknown user',
          targetName: data.targetName || '',
          detail: data.detail || '',
          at: data.at && typeof data.at.toDate === 'function' ? data.at.toDate() : null,
        };
      }));
    },
    (err) => {
      /* Expected for anyone who is not a Super Admin — the rules reject
         the read. Leave the card hidden rather than showing an error
         about a feature that is not theirs. */
      card.hidden = true;
      console.debug('Activity feed unavailable:', err.code || err.message);
    }
  );
});
