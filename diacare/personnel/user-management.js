'use strict';
/* ================================================================
   DiaCare RHU Libon — Personnel / User Management JavaScript
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
   PERSONNEL DATA
   ================================================================ */
let PERSONNEL = [
  { id: 1, name: 'Maria Santos', initials: 'MS', color: '#22a866', role: 'RHU Nurse', username: 'msantos', email: 'msantos@rhulibon.gov.ph', contact: '09171234567', barangay: 'All Barangays', status: 'active', dateAdded: 'Jan 10, 2026' },
  { id: 2, name: 'Jose Reyes', initials: 'JR', color: '#2f8fb8', role: 'RHU Nurse', username: 'jreyes', email: 'jreyes@rhulibon.gov.ph', contact: '09181234567', barangay: 'All Barangays', status: 'active', dateAdded: 'Jan 10, 2026' },
  { id: 3, name: 'Ana Cruz', initials: 'AC', color: '#7c63d6', role: 'RHU Nurse', username: 'acruz', email: 'acruz@rhulibon.gov.ph', contact: '09191234567', barangay: 'All Barangays', status: 'active', dateAdded: 'Feb 3, 2026' },
  { id: 4, name: 'Pedro Bautista', initials: 'PB', color: '#d9822b', role: 'BHW', username: 'pbautista', email: 'pbautista@rhulibon.gov.ph', contact: '09201234567', barangay: 'San Jose', status: 'active', dateAdded: 'Feb 15, 2026' },
  { id: 5, name: 'Lorna Dela Rosa', initials: 'LD', color: '#059669', role: 'BHW', username: 'ldelarosa', email: 'ldelarosa@rhulibon.gov.ph', contact: '09211234567', barangay: 'Burabod', status: 'active', dateAdded: 'Mar 1, 2026' },
  { id: 6, name: 'Carlos Tan', initials: 'CT', color: '#e5534b', role: 'BHW', username: 'ctan', email: 'ctan@rhulibon.gov.ph', contact: '09221234567', barangay: 'Malabiga', status: 'active', dateAdded: 'Mar 12, 2026' },
  { id: 7, name: 'Elena Ramos', initials: 'ER', color: '#0f766e', role: 'BHW', username: 'eramos', email: 'eramos@rhulibon.gov.ph', contact: '09231234567', barangay: 'Harigue', status: 'active', dateAdded: 'Apr 5, 2026' },
  { id: 8, name: 'Roberto Garcia', initials: 'RG', color: '#92400e', role: 'BHW', username: 'rgarcia', email: 'rgarcia@rhulibon.gov.ph', contact: '09241234567', barangay: 'Matara', status: 'inactive', dateAdded: 'Apr 20, 2026' },
  { id: 9, name: 'Teresita Molina', initials: 'TM', color: '#1e40af', role: 'RHU Nurse', username: 'tmolina', email: 'tmolina@rhulibon.gov.ph', contact: '09251234567', barangay: 'All Barangays', status: 'active', dateAdded: 'May 8, 2026' },
  { id: 10, name: 'Dante Pascual', initials: 'DP', color: '#6b7280', role: 'BHW', username: 'dpascual', email: 'dpascual@rhulibon.gov.ph', contact: '09261234567', barangay: 'Bonbon', status: 'inactive', dateAdded: 'May 22, 2026' },
];

let nextId = 11;
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
  document.getElementById('statNurses').textContent = PERSONNEL.filter(p => p.role === 'RHU Nurse' && p.status === 'active').length;
  document.getElementById('statBHW').textContent = PERSONNEL.filter(p => p.role === 'BHW' && p.status === 'active').length;
  document.getElementById('statInactive').textContent = PERSONNEL.filter(p => p.status === 'inactive').length;

  /* Login screen's "community health workers on the platform" tile —
     every BHW account that exists, active or not, since it's a
     headcount of who's registered rather than who's active today. */
  window.DiaCareStats?.publish({
    communityHealthWorkers: PERSONNEL.filter(p => p.role === 'BHW').length,
  });
}

/* ================================================================
   FILTER
   ================================================================ */
function getFiltered() {
  return PERSONNEL.filter(p => {
    const matchRole = activeRole === 'all' || p.role === activeRole;
    const matchStatus = activeStatus === 'all' || p.status === activeStatus;
    const matchSearch = !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
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
  if (countEl) countEl.textContent = `Showing ${filtered.length} personnel`;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyEl?.classList.remove('hidden');
    return;
  }
  emptyEl?.classList.add('hidden');

  tbody.innerHTML = filtered.map(p => {
    const roleCls = p.role === 'RHU Nurse' ? 'role-badge--nurse' : 'role-badge--bhw';
    const roleIcon = p.role === 'RHU Nurse' ? 'fa-user-nurse' : 'fa-house-medical';
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
            <div class="prs-email">${p.email}</div>
          </div>
        </div>
      </td>
      <td><span class="role-badge ${roleCls}"><i class="fa-solid ${roleIcon}"></i> ${p.role}</span></td>
      <td style="font-family:var(--font-mono);font-size:12.5px;color:var(--ink-soft)">${p.username}</td>
      <td style="font-size:12.5px;color:var(--ink-soft)">${p.contact}</td>
      <td style="font-size:13px;color:var(--ink)">${p.barangay}</td>
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
      const id = parseInt(btn.dataset.id);
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

document.getElementById('searchInput')?.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderTable();
});

/* ================================================================
   ADD MODAL
   ================================================================ */
/* ================================================================
   USERNAME vs EMAIL — mutually exclusive based on role, because they
   authenticate against two different logins entirely:
   - BHW accounts sign into the mobile app, which checks username +
     password (see the app's own AuthService — no email field exists
     there at all).
   - RHU Nurse accounts sign into this website, which authenticates
     against Firebase Auth on email + password and then an emailed
     code (see login.js) — never a username.
   Asking for both regardless of role meant collecting a credential
   that particular account would never actually use to sign in.
   ================================================================ */
function updateCredentialFieldsForRole(role) {
  const isWebRole = role === 'RHU Nurse';

  const emailGroup = document.getElementById('fEmailGroup');
  const emailRequiredMark = document.getElementById('fEmailRequiredMark');
  const emailHint = document.getElementById('fEmailHint');
  const emailInput = document.getElementById('fEmail');
  if (emailGroup) {
    emailGroup.style.display = isWebRole ? '' : 'none';
    if (emailRequiredMark) emailRequiredMark.textContent = isWebRole ? '*' : '';
    if (emailHint) {
      emailHint.textContent = isWebRole
        ? 'Signs into the web dashboard — also used for password resets.'
        : '';
    }
    if (!isWebRole && emailInput) {
      emailInput.classList.remove('error');
      document.getElementById('errEmail')?.classList.add('hidden');
    }
  }

  const usernameGroup = document.getElementById('fUsernameGroup');
  const usernameRequiredMark = document.getElementById('fUsernameRequiredMark');
  const usernameHint = document.getElementById('fUsernameHint');
  const usernameInput = document.getElementById('fUsername');
  if (usernameGroup) {
    usernameGroup.style.display = isWebRole ? 'none' : '';
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
document.getElementById('modalSave')?.addEventListener('click', () => {
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
  const checks = [
    { id: 'fName', errId: 'errName', val: name, fn: v => v.length >= 2 },
    { id: 'fRole', errId: 'errRole', val: role, fn: v => v !== '' },
  ];
  if (!editingId) {
    checks.push({ id: 'fPassword', errId: 'errPassword', val: password, fn: v => v.length >= 6 });
  }
  // Username and email are mutually exclusive based on role — see
  // updateCredentialFieldsForRole(). Only the field this account will
  // actually use to sign in gets validated as required.
  if (role === 'RHU Nurse') {
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

  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const colors = ['#22a866', '#2f8fb8', '#7c63d6', '#d9822b', '#e5534b', '#059669', '#0f766e', '#1e40af', '#92400e'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  if (editingId) {
    const idx = PERSONNEL.findIndex(p => p.id === editingId);
    if (idx !== -1) {
      PERSONNEL[idx] = { ...PERSONNEL[idx], name, role, status, username, contact, email, barangay, purok, initials, mustChangePassword };
    }
    showToast(`${name}'s account updated successfully.`);
  } else {
    PERSONNEL.push({
      id: nextId++, name, role, status, username, email, contact,
      barangay, purok, initials, color, mustChangePassword,
      dateAdded: new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
    });
    showToast(`${name} added as ${role} successfully.${mustChangePassword ? ' They\'ll set a permanent password on first login.' : ''}`);
  }

  closeModal();
  renderStats();
  renderTable();
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

document.getElementById('deactivateConfirm')?.addEventListener('click', () => {
  const p = PERSONNEL.find(x => x.id === deactivateId);
  if (!p) return;
  const wasActive = p.status === 'active';
  p.status = wasActive ? 'inactive' : 'active';
  closeDeactivateModal();
  renderStats();
  renderTable();
  showToast(`${p.name}'s account ${wasActive ? 'deactivated' : 'reactivated'} successfully.`);
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
  renderStats();
  renderTable();
});