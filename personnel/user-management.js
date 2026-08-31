'use strict';
/* ================================================================
   DiaCare RHU Libon — Personnel / User Management JavaScript
   ================================================================ */

import { db } from '../shared/firebase.js';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import {
  createStaffAccount,
  updateStaffAccount,
  setStaffStatus,
} from '../shared/api.js';

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
   PERSONNEL DATA

   The roster is whatever is in Firestore's users collection — the demo
   array this page used to hold was invisible to the rest of the system
   and vanished on reload.

   Two kinds of row live here. admin and nurse rows have a Firebase Auth
   account and can sign into this dashboard; their document id IS the
   Auth uid, which is what ties a signed-in token to its profile. BHW
   rows are roster records with an auto-id and no login, because the
   mobile app identifies people by username and Firebase Auth has no
   username sign-in.
   ================================================================ */
let PERSONNEL = [];

/* Stored role values vs what the table and modal show. Firestore holds
   the short form because that is also what lands in the ID token and
   what firestore.rules compares against. */
/* 'admin' stays the stored value and the token claim - it is what
   firestore.rules compares against - while the label reads Super Admin,
   which is what the role actually is here: the single account that can
   manage personnel. Renaming the stored value would mean migrating every
   existing claim and rule for a wording change. */
const ROLE_LABELS = { admin: 'Super Admin', nurse: 'RHU Nurse', bhw: 'BHW' };
const DASHBOARD_ROLES = ['admin', 'nurse'];

function roleLabel(role) {
  return ROLE_LABELS[role] || role || '—';
}

function formatDate(value) {
  /* createdAt is a Firestore Timestamp on a saved row, but a locally
     added row may not have been round-tripped yet. */
  const date = value && typeof value.toDate === 'function' ? value.toDate()
    : value instanceof Date ? value
    : null;
  if (!date) return '—';
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* A live subscription rather than one read at page load. The roster was
   a snapshot of whenever this tab opened, so an account created or
   deactivated by another Super Admin - or a nurse renaming themselves in
   Settings - was invisible here until someone happened to refresh. */
function mapPersonnel(snap) {
  PERSONNEL = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      name: d.fullName || '',
      initials: d.initials || (d.fullName || '?').slice(0, 2).toUpperCase(),
      color: d.color || '#6b7280',
      role: d.role || 'nurse',
      username: d.username || '',
      email: d.email || '',
      contact: d.contact || '',
      barangay: d.barangay || '',
      purok: d.purok || '',
      status: d.status === 'inactive' ? 'inactive' : 'active',
      mustChangePassword: !!d.mustChangePassword,
      dateAdded: formatDate(d.createdAt),
    };
  });
}

function watchPersonnel() {
  return new Promise((resolve) => {
    let settled = false;
    onSnapshot(
      query(collection(db, 'users'), orderBy('createdAt', 'desc')),
      (snap) => {
        mapPersonnel(snap);
        renderStats();
        renderTable();
        if (!settled) { settled = true; resolve(); }
      },
      (err) => {
        console.error('Lost the personnel subscription:', err);
        showToast('Could not load the personnel list. Check your connection and reload.');
        if (!settled) { settled = true; resolve(); }
      }
    );
  });
}

/* The subscription re-renders on its own; a write only needs to wait
   for the echo, which arrives on its own. Kept so callers reading as
   "save then refresh" still make sense. */
async function refresh() {
  renderStats();
  renderTable();
}

let editingId = null;
let deactivateId = null;
let activeRole = 'all';
let activeStatus = 'all';
let searchQuery = '';

/* ================================================================
   STAT CARDS
   ================================================================ */
function renderStats() {
  document.getElementById('statTotal').textContent = PERSONNEL.length;
  document.getElementById('statNurses').textContent = PERSONNEL.filter(p => DASHBOARD_ROLES.includes(p.role) && p.status === 'active').length;
  document.getElementById('statBHW').textContent = PERSONNEL.filter(p => p.role === 'bhw' && p.status === 'active').length;
  document.getElementById('statInactive').textContent = PERSONNEL.filter(p => p.status === 'inactive').length;

  /* Login screen's "community health workers on the platform" tile —
     every BHW account that exists, active or not, since it's a
     headcount of who's registered rather than who's active today. */
  window.DiaCareStats?.publish({
    communityHealthWorkers: PERSONNEL.filter(p => p.role === 'bhw').length,
  });
}

/* ================================================================
   FILTER
   ================================================================ */
function getFiltered() {
  /* Read the box rather than trusting the cached value. The two drifted
     apart whenever the field changed without an input event - browser
     autofill being the case that actually bit - leaving the table
     filtered by text the code did not know was there. */
  const searchEl = document.getElementById('searchInput');
  if (searchEl) searchQuery = searchEl.value;

  return PERSONNEL.filter(p => {
    const matchRole = activeRole === 'all' || p.role === activeRole;
    const matchStatus = activeStatus === 'all' || p.status === activeStatus;
    const matchSearch = !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.barangay.toLowerCase().includes(searchQuery.toLowerCase());
    return matchRole && matchStatus && matchSearch;
  });
}

/* ================================================================
   RENDER TABLE
   ================================================================ */
function renderTable() {
  const tbody = document.getElementById('personnelTbody');
  const emptyEl = document.getElementById('tableEmpty');
  const countEl = document.getElementById('filterCount');
  if (!tbody) return;

  const filtered = getFiltered();
  const filtering = !!searchQuery || activeRole !== 'all' || activeStatus !== 'all';

  if (countEl) {
    countEl.textContent = filtering
      ? `Showing ${filtered.length} of ${PERSONNEL.length} personnel`
      : `Showing ${filtered.length} personnel`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '';

    /* Say which filter is hiding everything, and offer to drop it. */
    const msgEl = document.getElementById('tableEmptyMsg');
    const clearBtn = document.getElementById('btnClearFilters');
    if (msgEl) {
      if (PERSONNEL.length === 0) {
        msgEl.textContent = 'No personnel yet. Use Add Personnel to create the first account.';
      } else {
        const bits = [];
        if (searchQuery) bits.push(`matching "${searchQuery}"`);
        if (activeRole !== 'all') bits.push(`with the ${roleLabel(activeRole)} role`);
        if (activeStatus !== 'all') bits.push(`that are ${activeStatus}`);
        msgEl.textContent = `No personnel ${bits.join(' ')}. ${PERSONNEL.length} are hidden by these filters.`;
      }
    }
    clearBtn?.classList.toggle('hidden', !filtering);

    emptyEl?.classList.remove('hidden');
    return;
  }
  emptyEl?.classList.add('hidden');

  tbody.innerHTML = filtered.map(p => {
    const roleCls = p.role === 'admin' ? 'role-badge--admin'
      : p.role === 'nurse' ? 'role-badge--nurse' : 'role-badge--bhw';
    const roleIcon = p.role === 'admin' ? 'fa-user-shield'
      : p.role === 'nurse' ? 'fa-user-nurse' : 'fa-house-medical';
    const statusCls = p.status === 'active' ? 'status-badge--active' : 'status-badge--inactive';
    const statusLbl = p.status === 'active' ? 'Active' : 'Inactive';
    const rowCls = p.status === 'inactive' ? 'row-inactive' : '';
    const actionBtn = p.status === 'active'
      ? `<button class="btn-deactivate" data-action="deactivate" data-id="${p.id}"><i class="fa-solid fa-user-slash"></i> Deactivate</button>`
      : `<button class="btn-reactivate" data-action="reactivate" data-id="${p.id}"><i class="fa-solid fa-user-check"></i> Reactivate</button>`;

    return `<tr class="${rowCls}">
      <td>
        <div class="prs-cell">
          <div class="prs-av" style="background:${p.color}">${p.initials}</div>
          <div>
            <div class="prs-name">${p.name}</div>
            <div class="prs-email">${p.email || 'no dashboard login'}</div>
          </div>
        </div>
      </td>
      <td><span class="role-badge ${roleCls}"><i class="fa-solid ${roleIcon}"></i> ${roleLabel(p.role)}</span></td>
      <td style="font-family:var(--font-mono);font-size:12.5px;color:var(--ink-soft)">${p.username || '—'}</td>
      <td style="font-size:12.5px;color:var(--ink-soft)">${p.contact || '—'}</td>
      <td style="font-size:13px;color:var(--ink)">${p.barangay || '—'}</td>
      <td><span class="status-badge ${statusCls}"><span class="status-dot"></span>${statusLbl}</span></td>
      <td style="font-size:12px;color:var(--ink-faint);font-family:var(--font-mono)">${p.dateAdded}</td>
      <td>
        <div class="action-btns">
          <button class="btn-edit" data-action="edit" data-id="${p.id}">
            <i class="fa-solid fa-pen-to-square"></i> Edit
          </button>
          ${actionBtn}
        </div>
      </td>
    </tr>`;
  }).join('');

  /* Attach listeners */
  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'edit') openEditModal(id);
      if (action === 'deactivate') openDeactivateModal(id, false);
      if (action === 'reactivate') openDeactivateModal(id, true);
    });
  });
}

/* ================================================================
   FILTERS
   ================================================================ */
document.querySelectorAll('[data-role]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-role]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeRole = btn.dataset.role;
    renderTable();
  });
});

document.querySelectorAll('[data-status]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeStatus = btn.dataset.status;
    renderTable();
  });
});

/* ================================================================
   AUTOFILL

   Chrome treats the first text input on a page as a login field and
   fills a saved email into it. autocomplete=off, type=search, and an
   unrelated name all fail to stop it, and the filter is applied
   silently - the roster just looks like it lost rows.

   Two defences, because neither is reliable alone:

     - readonly until the field is actually touched. Chrome skips
       readonly fields, and a filter box nobody has focused has no
       reason to be editable.
     - the autofill animation hook, for when it fills anyway. A value
       that arrives without a keystroke is not a search the user asked
       for, so it is discarded rather than applied.
   ================================================================ */
(function guardSearchAgainstAutofill() {
  const input = document.getElementById('searchInput');
  if (!input) return;

  /* A filter is a per-visit thing; it should never arrive pre-filled,
     by autofill or by a browser restoring the last value. */
  input.value = '';

  input.setAttribute('readonly', 'readonly');
  const release = () => input.removeAttribute('readonly');
  ['focus', 'pointerdown', 'keydown'].forEach((evt) => {
    input.addEventListener(evt, release, { once: true });
  });

  input.addEventListener('animationstart', (e) => {
    if (e.animationName !== 'diacareAutofillDetected') return;
    /* Deferred: clearing inside the event that announced the fill can be
       overwritten by the fill still completing. */
    setTimeout(() => {
      if (!input.value) return;
      input.value = '';
      searchQuery = '';
      renderTable();
    }, 0);
  });
})();

/* 'search' fires on the native clear button too, which 'input' alone
   misses in some browsers. */
['input', 'search', 'change'].forEach((evt) => {
  document.getElementById('searchInput')?.addEventListener(evt, (e) => {
    searchQuery = e.target.value;
    renderTable();
  });
});

function clearFilters() {
  const searchEl = document.getElementById('searchInput');
  if (searchEl) searchEl.value = '';
  searchQuery = '';

  activeRole = 'all';
  activeStatus = 'all';
  document.querySelectorAll('[data-role]').forEach((b) => {
    b.classList.toggle('active', b.dataset.role === 'all');
  });
  document.querySelectorAll('[data-status]').forEach((b) => {
    b.classList.toggle('active', b.dataset.status === 'all');
  });

  renderTable();
}

document.getElementById('btnClearFilters')?.addEventListener('click', clearFilters);

/* ================================================================
   ADD MODAL
   ================================================================ */
/* ================================================================
   USERNAME vs EMAIL — mutually exclusive based on role, because they
   authenticate against two different logins entirely:
   - Super Admin and RHU Nurse accounts sign into this website, which
     authenticates against Firebase Auth on email + password and then an
     emailed code (see login.js) — never a username. These get a real
     Firebase Auth account.
   - BHW accounts sign into the mobile app, which checks username +
     password (see the app's own AuthService — no email field exists
     there at all). Firebase Auth has no username login, so these are
     roster records with no dashboard access until the mobile app's
     authentication is decided.
   Asking for both regardless of role meant collecting a credential
   that particular account would never actually use to sign in.
   ================================================================ */
function updateCredentialFieldsForRole(role) {
  /* Three states, not two. Before a role is picked the form cannot know
     which credentials the account needs, and defaulting to "not a
     dashboard role" made an unanswered question look like a decided one:
     the modal opened showing the BHW username field, next to a checkbox
     about a temporary password that was not on screen. */
  const chosen = !!role;
  const isWebRole = DASHBOARD_ROLES.includes(role);

  const prompt = document.getElementById('fRolePrompt');
  if (prompt) prompt.style.display = chosen ? 'none' : '';

  /* mustChangePassword is about a password. A BHW row stores none, so
     the checkbox is shown only where it means something. */
  const mustChangeGroup = document.getElementById('fMustChangeGroup');
  if (mustChangeGroup) mustChangeGroup.style.display = chosen ? '' : 'none';

  const emailGroup = document.getElementById('fEmailGroup');
  const emailRequiredMark = document.getElementById('fEmailRequiredMark');
  const emailHint = document.getElementById('fEmailHint');
  const emailInput = document.getElementById('fEmail');
  if (emailGroup) {
    emailGroup.style.display = (chosen && isWebRole) ? '' : 'none';
    if (emailRequiredMark) emailRequiredMark.textContent = isWebRole ? '*' : '';
    if (emailHint) {
      emailHint.textContent = isWebRole
        ? 'Signs into the web dashboard — also where the sign-in code is sent.'
        : '';
    }
    if (!isWebRole && emailInput) {
      emailInput.classList.remove('error');
      document.getElementById('errEmail')?.classList.add('hidden');
    }
  }

  /* Every role that can sign in needs a password now — a BHW's is
     checked by /api/bhw-login rather than by Firebase Auth, but it is
     still a password they type. */
  const passwordGroup = document.getElementById('fPasswordGroup');
  if (passwordGroup) passwordGroup.style.display = chosen ? '' : 'none';

  const usernameGroup = document.getElementById('fUsernameGroup');
  const usernameRequiredMark = document.getElementById('fUsernameRequiredMark');
  const usernameHint = document.getElementById('fUsernameHint');
  const usernameInput = document.getElementById('fUsername');
  if (usernameGroup) {
    usernameGroup.style.display = (chosen && !isWebRole) ? '' : 'none';
    if (usernameRequiredMark) usernameRequiredMark.textContent = isWebRole ? '' : '*';
    if (usernameHint) {
      usernameHint.textContent = isWebRole
        ? ''
        : "Signs into the mobile app — BHWs don't use email.";
    }
    if (isWebRole && usernameInput) {
      usernameInput.classList.remove('error');
      document.getElementById('errUsername')?.classList.add('hidden');
    }
  }
}

document.getElementById('fRole')?.addEventListener('change', (e) => {
  updateCredentialFieldsForRole(e.target.value);
});

function openAddModal() {
  editingId = null;
  document.getElementById('modalTitle').textContent = 'Add New Personnel';
  document.getElementById('modalSub').textContent = 'Fill in the details to create a new account';
  document.getElementById('modalSaveLbl').textContent = 'Save Personnel';
  document.getElementById('fPasswordLabel').innerHTML = 'Password <span class="required">*</span>';
  clearModalForm();
  // New accounts default to requiring a password change on first login —
  // matches the app's mustChangePassword flag and its dedicated
  // force-change-password screen, which depends on this being set.
  document.getElementById('fMustChangePassword').checked = true;
  updateCredentialFieldsForRole('');
  // A brand-new account is always Active — Status is an edit-time
  // concept (deactivating someone who left), already covered by the
  // table's own Deactivate action, not a creation-time choice.
  document.getElementById('fStatusGroup')?.classList.add('hidden');
  document.getElementById('personnelModal')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('fName')?.focus(), 100);
}

function openEditModal(id) {
  const p = PERSONNEL.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById('modalTitle').textContent = 'Edit Personnel';
  document.getElementById('modalSub').textContent = `Editing account for ${p.name}`;
  document.getElementById('modalSaveLbl').textContent = 'Save Changes';
  document.getElementById('fPasswordLabel').innerHTML = 'Password <span style="color:var(--ink-faint);font-weight:400">(leave blank to keep)</span>';

  document.getElementById('fStatusGroup')?.classList.remove('hidden');
  document.getElementById('fName').value = p.name;
  document.getElementById('fRole').value = p.role;
  document.getElementById('fStatus').value = p.status;
  document.getElementById('fUsername').value = p.username;
  document.getElementById('fPassword').value = '';
  document.getElementById('fContact').value = p.contact;
  document.getElementById('fEmail').value = p.email;
  document.getElementById('fBarangay').value = p.barangay;
  document.getElementById('fPurok').value = p.purok || '';
  // Existing accounts already went through their first-login flow (or
  // didn't need to) — don't force it again just from an unrelated edit.
  document.getElementById('fMustChangePassword').checked = false;
  updateCredentialFieldsForRole(p.role);

  document.getElementById('personnelModal')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('personnelModal')?.classList.add('hidden');
  document.body.style.overflow = '';
  editingId = null;
}

function clearModalForm() {
  ['fName', 'fRole', 'fUsername', 'fPassword', 'fContact', 'fEmail', 'fPurok'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('fStatus').value = 'active';
  document.getElementById('fBarangay').value = 'All Barangays';
  document.querySelectorAll('.mfield-error').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.mfield-input').forEach(el => el.classList.remove('error'));
}

document.getElementById('btnAddPersonnel')?.addEventListener('click', openAddModal);
document.getElementById('modalClose')?.addEventListener('click', closeModal);
document.getElementById('modalCancel')?.addEventListener('click', closeModal);
document.getElementById('personnelModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('personnelModal')) closeModal();
});

/* Password toggle */
document.getElementById('pwdToggle')?.addEventListener('click', () => {
  const input = document.getElementById('fPassword');
  const eye = document.getElementById('pwdEye');
  input.type = input.type === 'password' ? 'text' : 'password';
  eye.className = input.type === 'password' ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
});

/* ================================================================
   SAVE PERSONNEL
   ================================================================ */
/* Buttons that call the API get disabled while it is in flight —
   double-clicking Save used to be harmless against an array, but now it
   would try to create the same account twice. */
function setBusy(btnId, labelId, busy, busyText) {
  const btn = document.getElementById(btnId);
  const lbl = document.getElementById(labelId);
  if (btn) btn.disabled = busy;
  if (lbl && busy) {
    lbl.dataset.idle = lbl.dataset.idle || lbl.textContent;
    lbl.textContent = busyText;
  } else if (lbl && lbl.dataset.idle) {
    lbl.textContent = lbl.dataset.idle;
  }
}

document.getElementById('modalSave')?.addEventListener('click', async () => {
  const name = document.getElementById('fName').value.trim();
  const role = document.getElementById('fRole').value;
  const status = document.getElementById('fStatus').value;
  const username = document.getElementById('fUsername').value.trim();
  const password = document.getElementById('fPassword').value;
  const contact = document.getElementById('fContact').value.trim();
  const email = document.getElementById('fEmail').value.trim();
  const barangay = document.getElementById('fBarangay').value;
  const purok = document.getElementById('fPurok').value.trim();
  const mustChangePassword = document.getElementById('fMustChangePassword').checked;

  /* Validate */
  let valid = true;
  const isWebRole = DASHBOARD_ROLES.includes(role);
  const checks = [
    { id: 'fName', errId: 'errName', val: name, fn: v => v.length >= 2 },
    { id: 'fRole', errId: 'errRole', val: role, fn: v => v !== '' },
  ];
  /* On an edit the password field means "change it to this", so blank
     is the normal case and only a non-empty value is checked. */
  if (!editingId) {
    checks.push({ id: 'fPassword', errId: 'errPassword', val: password, fn: v => v.length >= 6 });
  } else if (editingId && password) {
    checks.push({ id: 'fPassword', errId: 'errPassword', val: password, fn: v => v.length >= 6 });
  }
  // Username and email are mutually exclusive based on role — see
  // updateCredentialFieldsForRole(). Only the field this account will
  // actually use to sign in gets validated as required.
  if (isWebRole) {
    checks.push({ id: 'fEmail', errId: 'errEmail', val: email, fn: v => /\S+@\S+\.\S+/.test(v) });
  } else {
    checks.push({ id: 'fUsername', errId: 'errUsername', val: username, fn: v => v.length >= 3 });
  }
  checks.forEach(({ id, errId, val, fn }) => {
    const input = document.getElementById(id);
    const err = document.getElementById(errId);
    if (!fn(val)) {
      input?.classList.add('error');
      err?.classList.remove('hidden');
      valid = false;
    } else {
      input?.classList.remove('error');
      err?.classList.add('hidden');
    }
  });
  if (!valid) return;

  setBusy('modalSave', 'modalSaveLbl', true, editingId ? 'Saving...' : 'Creating...');

  try {
    if (editingId) {
      await updateStaffAccount({
        id: editingId,
        fullName: name, role, status, username, email, contact, barangay, purok,
        mustChangePassword,
        /* Blank means "leave the password alone" rather than "set it to
           empty", so it is only sent when the admin typed something. */
        ...(password ? { password } : {}),
      });
      showToast(`${name}'s account updated successfully.`);
    } else {
      const res = await createStaffAccount({
        fullName: name, role, username, email, password, contact, barangay, purok,
        mustChangePassword,
      });
      showToast(res.hasLogin
        ? `${name} added as ${roleLabel(role)}. They can sign in with that email and password.`
        : `${name} added as ${roleLabel(role)}. This is a roster record — BHWs have no dashboard login.`);
    }

    closeModal();
    await refresh();
  } catch (err) {
    /* The server already phrased these for an operator: which field is
       wrong, whether the email is taken, whether the caller is allowed. */
    showToast(err.message || 'Could not save that account.');
  } finally {
    setBusy('modalSave', 'modalSaveLbl', false);
  }
});

/* ================================================================
   DEACTIVATE / REACTIVATE MODAL
   ================================================================ */
function openDeactivateModal(id, isReactivate) {
  const p = PERSONNEL.find(x => x.id === id);
  if (!p) return;
  deactivateId = id;

  const title = document.getElementById('deactivateTitle');
  const text = document.getElementById('confirmText');
  const icon = document.getElementById('confirmIcon');
  const lbl = document.getElementById('deactivateLbl');
  const btn = document.getElementById('deactivateConfirm');

  if (isReactivate) {
    if (title) title.textContent = 'Reactivate Account?';
    if (text) text.textContent = `Reactivate ${p.name}'s account? They will be able to log in again.`;
    if (icon) icon.innerHTML = '<i class="fa-solid fa-user-check" style="color:var(--status-good)"></i>';
    if (lbl) lbl.textContent = 'Reactivate';
    if (btn) { btn.style.background = 'linear-gradient(135deg,var(--status-good),#047857)'; }
  } else {
    if (title) title.textContent = 'Deactivate Account?';
    if (text) text.textContent = `Deactivate ${p.name}'s account? They will no longer be able to log in.`;
    if (icon) icon.innerHTML = '<i class="fa-solid fa-user-slash" style="color:var(--status-critical)"></i>';
    if (lbl) lbl.textContent = 'Deactivate';
    if (btn) { btn.style.background = 'linear-gradient(135deg,#e05252,var(--status-critical))'; }
  }

  document.getElementById('deactivateModal')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDeactivateModal() {
  document.getElementById('deactivateModal')?.classList.add('hidden');
  document.body.style.overflow = '';
  deactivateId = null;
}

document.getElementById('deactivateClose')?.addEventListener('click', closeDeactivateModal);
document.getElementById('deactivateCancel')?.addEventListener('click', closeDeactivateModal);

document.getElementById('deactivateConfirm')?.addEventListener('click', async () => {
  const p = PERSONNEL.find(x => x.id === deactivateId);
  if (!p) return;
  const wasActive = p.status === 'active';
  const id = deactivateId;

  setBusy('deactivateConfirm', 'deactivateLbl', true, 'Working...');
  try {
    /* Deactivating revokes their tokens server-side, so anyone already
       signed in is cut off immediately rather than at their next login. */
    await setStaffStatus(id, wasActive ? 'inactive' : 'active');
    closeDeactivateModal();
    await refresh();
    showToast(`${p.name}'s account ${wasActive ? 'deactivated' : 'reactivated'} successfully.`);
  } catch (err) {
    showToast(err.message || 'Could not change that account.');
  } finally {
    setBusy('deactivateConfirm', 'deactivateLbl', false);
  }
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
window.addEventListener('load', async () => {
  renderTopNavNotifications();
  initNotifDropdown();
  renderStats();
  renderTable();

  /* The roster comes over the network now, so the table renders empty
     first and fills in. auth-guard.js has already established that
     there is a verified session by the time this runs; without one the
     rules reject the read and the page has bounced anyway. */
  await watchPersonnel();
});