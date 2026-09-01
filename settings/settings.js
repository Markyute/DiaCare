import {
  auth,
  db,
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  authErrorMessage,
} from '../shared/firebase.js';
import { doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

/* ================================================================
   DiaCare RHU Libon — Settings JavaScript
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
  if (c) c.textContent = now.toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  if (d) d.textContent = now.toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
}
updateClock();
setInterval(updateClock, 1000);

/* ── Mobile Nav ── */
const menuToggle = document.getElementById('menuToggle');
const topnav     = document.getElementById('topnav');
menuToggle?.addEventListener('click', () => topnav.classList.toggle('nav-open'));
document.addEventListener('click', (e) => {
  if (topnav?.classList.contains('nav-open') && !topnav.contains(e.target))
    topnav.classList.remove('nav-open');
});

/* ================================================================
   SIDEBAR TAB SWITCHING
   ================================================================ */
document.querySelectorAll('.stab[data-tab]').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.stab[data-tab]').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.stab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab)?.classList.add('active');
  });
});

/* ================================================================
   PROFILE TAB
   ================================================================ */
/* Profile photo upload */
const photoOverlay = document.getElementById('photoOverlay');
const photoInput   = document.getElementById('photoInput');
const profileAv    = document.getElementById('profileAvatar');

document.getElementById('btnChangePhoto')?.addEventListener('click', () => photoInput?.click());
photoOverlay?.addEventListener('click', () => photoInput?.click());

photoInput?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      /* Downscale to a small square before it ever touches
         localStorage — a raw phone photo can be several MB, which
         blows past the per-origin quota and silently fails to save. */
      const maxDim = 240;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

      profileAv.innerHTML = `<img src="${dataUrl}" alt="Profile" />`;
      showToast('Photo selected — click Save Changes to keep it.');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

/* Prefill from the signed-in user's profile document rather than from
   this browser's storage. The form used to show whatever had last been
   saved on this machine, which meant the same person saw different
   details depending on where they signed in. */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  let profile = {};
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    profile = snap.data() || {};
  } catch (err) {
    console.error('Could not load your profile:', err);
  }

  const name = profile.fullName || user.displayName || '';
  const initials = profile.initials
    || name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    || '?';

  const nameEl    = document.getElementById('pfFullName');
  const emailEl   = document.getElementById('pfEmail');
  const contactEl = document.getElementById('pfContact');
  const bigAv     = document.getElementById('profileAvatar');
  const dispName  = document.getElementById('profileDisplayName');

  if (nameEl)    nameEl.value = name;
  if (emailEl)   emailEl.value = profile.email || user.email || '';
  if (contactEl) contactEl.value = profile.contact || '';
  if (bigAv) {
    if (profile.photo) bigAv.innerHTML = `<img src="${profile.photo}" alt="Profile" />`;
    else bigAv.textContent = initials;
  }
  if (dispName) dispName.textContent = name || 'Your profile';
});

/* Save profile */
document.getElementById('btnSaveProfile')?.addEventListener('click', async () => {
  const name    = document.getElementById('pfFullName').value.trim();
  const contact = document.getElementById('pfContact').value.trim();
  if (!name)  { showToast('Full name is required.', true); return; }

  const user = auth.currentUser;
  if (!user) { showToast('Your session expired. Sign in again.', true); return; }

  const initials = name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
  /* Whatever photo is currently showing (freshly picked this
     session, or already loaded from a previous save) is what gets
     persisted — so Save Changes is what actually commits a new photo. */
  const photoImg = profileAv?.querySelector('img');
  const photo = photoImg ? photoImg.src : null;

  /* Written to the profile document, not to this browser. It was going
     to localStorage, so a nurse who renamed themselves was renamed on
     that machine only - the Super Admin's roster, and the same nurse on
     any other computer, still showed the old name.

     Only these three fields are writable by their owner; firestore.rules
     rejects an update that touches role, status, or email, so this
     cannot be used to self-promote. */
  try {
    await updateDoc(doc(db, 'users', user.uid), {
      fullName: name,
      contact,
      initials,
      photo: photo || '',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('Could not save the profile:', err);
    showToast('Could not save your profile. Check your connection and try again.', true);
    return;
  }

  /* Update this page immediately too */
  const navAv    = document.getElementById('navAvatar');
  const navName  = document.getElementById('navName');
  const dispName = document.getElementById('profileDisplayName');
  if (navAv) {
    if (photo) navAv.innerHTML = `<img src="${photo}" alt="Profile" />`;
    else navAv.textContent = initials;
  }
  if (navName)  navName.textContent = name;
  if (dispName) dispName.textContent = name;

  showToast('Profile updated successfully!');
});

/* ================================================================
   PASSWORD TAB
   ================================================================ */
/* Password eye toggles */
document.querySelectorAll('.pwd-eye').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.querySelector('i').className = input.type === 'password' ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
  });
});

/* Password strength checker */
document.getElementById('pwNew')?.addEventListener('input', (e) => {
  const val   = e.target.value;
  const reqs  = {
    length:  val.length >= 8,
    upper:   /[A-Z]/.test(val),
    number:  /[0-9]/.test(val),
    special: /[^A-Za-z0-9]/.test(val),
  };

  /* Requirement indicators */
  const map = { length:'req-length', upper:'req-upper', number:'req-number', special:'req-special' };
  Object.entries(reqs).forEach(([key, met]) => {
    const el = document.getElementById(map[key]);
    if (!el) return;
    el.className = `req-item ${met ? 'met' : ''}`;
    el.querySelector('i').className = met ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle';
  });

  /* Strength bar */
  const score   = Object.values(reqs).filter(Boolean).length;
  const colors  = ['#e5e7eb','#d0362f','#c2760a','#22a866','#22a866'];
  const strength = document.getElementById('pwdStrength');
  if (strength) {
    strength.innerHTML = [0,1,2,3].map(i =>
      `<span style="background:${i < score ? colors[score] : 'var(--border-soft)'}"></span>`
    ).join('');
  }
});

/* Save password */
document.getElementById('btnSavePassword')?.addEventListener('click', async () => {
  const current = document.getElementById('pwCurrent').value;
  const newPw   = document.getElementById('pwNew').value;
  const confirm = document.getElementById('pwConfirm').value;

  let valid = true;
  if (!current) {
    document.getElementById('errCurrent')?.classList.remove('hidden');
    document.getElementById('pwCurrent')?.classList.add('error');
    valid = false;
  } else {
    document.getElementById('errCurrent')?.classList.add('hidden');
  }
  if (newPw.length < 8) {
    document.getElementById('errNew')?.classList.remove('hidden');
    document.getElementById('pwNew')?.classList.add('error');
    valid = false;
  } else {
    document.getElementById('errNew')?.classList.add('hidden');
    document.getElementById('pwNew')?.classList.remove('error');
  }
  if (newPw !== confirm) {
    document.getElementById('errConfirm')?.classList.remove('hidden');
    document.getElementById('pwConfirm')?.classList.add('error');
    valid = false;
  } else {
    document.getElementById('errConfirm')?.classList.add('hidden');
    document.getElementById('pwConfirm')?.classList.remove('error');
  }
  if (!valid) return;

  /* This used to validate, clear the fields, and report success without
     changing anything — the password was never touched. Nothing about
     the screen said so, which is the worst way for it to be wrong. */
  const user = auth.currentUser;
  if (!user || !user.email) {
    showToast('Your session has ended. Sign in again.', true);
    return;
  }

  const btn = document.getElementById('btnSavePassword');
  const originalLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';
  }

  try {
    /* Firebase requires a recent sign-in before a password change, and
       re-authenticating here is also what proves the current password —
       otherwise an unattended unlocked laptop is enough to change it. */
    await reauthenticateWithCredential(
      user,
      EmailAuthProvider.credential(user.email, current),
    );
  } catch (err) {
    if (btn) { btn.disabled = false; btn.innerHTML = originalLabel; }
    const wrong = err?.code === 'auth/wrong-password'
      || err?.code === 'auth/invalid-credential';
    document.getElementById('errCurrent')?.classList.remove('hidden');
    document.getElementById('pwCurrent')?.classList.add('error');
    showToast(wrong ? 'Your current password is incorrect.' : authErrorMessage(err), true);
    return;
  }

  try {
    await updatePassword(user, newPw);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.innerHTML = originalLabel; }
    showToast(authErrorMessage(err), true);
    return;
  }

  if (btn) { btn.disabled = false; btn.innerHTML = originalLabel; }

  /* Reset fields */
  ['pwCurrent','pwNew','pwConfirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('pwdStrength').innerHTML = '';
  document.querySelectorAll('.req-item').forEach(el => {
    el.className = 'req-item';
    el.querySelector('i').className = 'fa-solid fa-circle';
  });

  showToast('Password updated. Use it the next time you sign in.');
});

/* ================================================================
   THRESHOLDS TAB — display-only. These match the mobile app's fixed
   classification thresholds exactly, by design: making them editable
   here (without a backend to also update the app's own hardcoded
   values) would let the two drift out of agreement again, which is
   the exact problem the rest of this alignment work was fixing.
   ================================================================ */

/* ================================================================
   ALERT PREFERENCES TAB — unlike Risk Thresholds, these are personal
   notification settings (which alerts to show, sound, browser popups),
   not shared classification rules, so there's no app-sync risk in
   letting them actually persist. Saved to localStorage and restored
   on load, same pattern used for pending-patient approvals elsewhere
   on this site.
   ================================================================ */
const ALERT_PREF_KEY = 'diacare_alert_preferences_v1';
const ALERT_PREF_IDS = [
  'alertCriticalGlucose', 'alertCriticalBP', 'alertAtRisk', 'alertMissed',
  'alertWorsening', 'alertBrowser', 'alertSound',
];

function loadAlertPreferences() {
  try {
    const raw = localStorage.getItem(ALERT_PREF_KEY);
    if (!raw) return; // nothing saved yet — leave the HTML's own defaults as-is
    const saved = JSON.parse(raw);
    ALERT_PREF_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && typeof saved[id] === 'boolean') el.checked = saved[id];
    });
  } catch {
    /* corrupted/blocked storage — fall back to the HTML defaults */
  }
}

document.getElementById('btnSaveAlerts')?.addEventListener('click', () => {
  const prefs = {};
  ALERT_PREF_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) prefs[id] = el.checked;
  });
  try {
    localStorage.setItem(ALERT_PREF_KEY, JSON.stringify(prefs));
    showToast('Alert preferences saved successfully!');
  } catch {
    showToast('Could not save preferences — storage unavailable.', true);
  }
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
  renderTopNavNotifications();
  initNotifDropdown();
  loadAlertPreferences();
});