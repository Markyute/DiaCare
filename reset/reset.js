'use strict';
/* ================================================================
   DiaCare — Set a New Password

   Firebase hosts its own reset page, but it carries Google's styling
   and a firebaseapp.com URL, which looks nothing like the rest of the
   dashboard — exactly the kind of page people are taught not to type a
   password into. The reset mail therefore links here instead, and this
   page redeems the code itself.

   The oobCode in the URL is a one-time credential. It is verified
   before the form is shown, so an expired or already-used link says so
   up front rather than after someone has typed a new password twice.
   ================================================================ */

import { auth } from '../shared/firebase.js';
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';

/* ================================================================
   SCREENS
   ================================================================ */
const screens = {
  checking: document.getElementById('screenChecking'),
  setPassword: document.getElementById('screenSetPassword'),
  done: document.getElementById('screenDone'),
  invalid: document.getElementById('screenInvalid'),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el?.classList.add('hidden'));
  screens[name]?.classList.remove('hidden');
  document.querySelector('.auth-left-scroll')?.scrollTo({ top: 0 });
}

function showInvalid(reason) {
  const el = document.getElementById('invalidReason');
  if (el && reason) el.textContent = reason;
  showScreen('invalid');
}

function showAlert(msg) {
  const box = document.getElementById('resetAlert');
  const text = document.getElementById('resetAlertText');
  if (box && text) {
    text.textContent = msg;
    box.classList.remove('hidden');
  }
}
function hideAlert() {
  document.getElementById('resetAlert')?.classList.add('hidden');
}

function setLoading(loading) {
  const btn = document.getElementById('btnResetSubmit');
  if (!btn) return;
  btn.disabled = loading;
  document.getElementById('resetBtnSpinner')?.classList.toggle('hidden', !loading);
  document.getElementById('resetBtnLabel')?.classList.toggle('hidden', loading);
}

function shakeShell() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const shell = document.querySelector('.auth-shell');
  if (!shell) return;
  shell.style.animation = 'none';
  void shell.offsetHeight;
  shell.style.animation = 'shake 0.4s ease';
}

/* ================================================================
   PASSWORD VISIBILITY
   ================================================================ */
function wireToggle(toggleId, inputId, eyeId) {
  const toggle = document.getElementById(toggleId);
  const input = document.getElementById(inputId);
  const eye = document.getElementById(eyeId);
  toggle?.addEventListener('click', () => {
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    eye.className = hidden ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
    toggle.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
  });
}
wireToggle('pwdToggle', 'newPassword', 'pwdEye');
wireToggle('confirmToggle', 'confirmPassword', 'confirmEye');

/* ================================================================
   REQUIREMENTS

   Firebase itself only enforces six characters. Eight plus a letter and
   a digit is this dashboard's floor — these accounts reach patient
   records, and a six-character password is worth very little.
   ================================================================ */
const RULES = [
  { id: 'ruleLength', test: (v) => v.length >= 8 },
  { id: 'ruleLetter', test: (v) => /[A-Za-z]/.test(v) },
  { id: 'ruleNumber', test: (v) => /\d/.test(v) },
];

function meetsRules(value) {
  return RULES.every((r) => r.test(value));
}

function renderRules(value) {
  RULES.forEach((rule) => {
    const li = document.getElementById(rule.id);
    if (!li) return;
    const met = rule.test(value);
    li.classList.toggle('met', met);
    const icon = li.querySelector('i');
    /* The icon carries the state as well as the colour, so this reads
       the same to someone who cannot distinguish the two greens. */
    if (icon) icon.className = met ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle';
  });
}

const newPassword = document.getElementById('newPassword');
const confirmPassword = document.getElementById('confirmPassword');

newPassword?.addEventListener('input', () => {
  renderRules(newPassword.value);
  hideAlert();
});

confirmPassword?.addEventListener('input', () => {
  document.getElementById('errConfirm')?.classList.add('hidden');
  confirmPassword.classList.remove('error-state');
});

/* ================================================================
   VERIFY THE LINK

   Done before anything is shown. verifyPasswordResetCode also returns
   the address the code belongs to, which is what the heading names —
   useful when someone has two accounts, or forwarded the mail.
   ================================================================ */
const params = new URLSearchParams(window.location.search);
const oobCode = params.get('oobCode');
const mode = params.get('mode');

async function verifyLink() {
  if (!oobCode) {
    showInvalid('This page needs a reset link to work. Open the link from your email, or request a new one from the sign-in page.');
    return;
  }
  /* Firebase uses one handler URL for several kinds of action. Anything
     other than a password reset does not belong here. */
  if (mode && mode !== 'resetPassword') {
    showInvalid('That link is for a different kind of request. Request a new password reset from the sign-in page.');
    return;
  }

  try {
    const email = await verifyPasswordResetCode(auth, oobCode);
    const target = document.getElementById('resetEmailTarget');
    if (target) target.textContent = email;
    showScreen('setPassword');
    newPassword?.focus();
  } catch (err) {
    if (err.code === 'auth/expired-action-code') {
      showInvalid('This link has expired. Reset links last about an hour — request a new one from the sign-in page.');
    } else if (err.code === 'auth/invalid-action-code') {
      showInvalid('This link has already been used, or a newer one was requested. Request a new one from the sign-in page.');
    } else if (err.code === 'auth/user-disabled') {
      showInvalid('This account has been deactivated. Contact an administrator.');
    } else if (err.code === 'auth/network-request-failed') {
      showInvalid('Could not reach the server. Check your connection and open the link again.');
    } else {
      showInvalid('This link could not be verified. Request a new one from the sign-in page.');
    }
  }
}

/* ================================================================
   SUBMIT
   ================================================================ */
document.getElementById('resetForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();

  const password = newPassword.value;
  const confirmation = confirmPassword.value;

  if (!meetsRules(password)) {
    renderRules(password);
    showAlert('Your password does not meet the requirements below yet.');
    shakeShell();
    newPassword.focus();
    return;
  }
  if (password !== confirmation) {
    confirmPassword.classList.add('error-state');
    document.getElementById('errConfirm')?.classList.remove('hidden');
    shakeShell();
    confirmPassword.focus();
    return;
  }

  setLoading(true);

  try {
    await confirmPasswordReset(auth, oobCode, password);
    setLoading(false);
    /* Firebase revokes the account's existing sessions when the password
       changes, so anyone signed in elsewhere is already signed out. */
    showScreen('done');
  } catch (err) {
    setLoading(false);
    if (err.code === 'auth/expired-action-code' || err.code === 'auth/invalid-action-code') {
      /* The code can expire between opening the page and submitting it. */
      showInvalid('This link expired while the page was open. Request a new one from the sign-in page.');
      return;
    }
    if (err.code === 'auth/weak-password') {
      showAlert('Firebase rejected that password as too weak. Try a longer one.');
    } else if (err.code === 'auth/network-request-failed') {
      showAlert('Network problem. Check your connection and try again.');
    } else {
      showAlert('Could not save that password. Please try again.');
    }
    shakeShell();
  }
});

renderRules('');
verifyLink();
