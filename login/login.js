'use strict';
/* ================================================================
   DiaCare — Admin Login

   Two steps, and the first one on its own grants nothing:

     1. Firebase Auth checks the password. Succeeding here only proves
        the password; the account still has no data access, because
        firestore.rules requires claims this step doesn't set.
     2. requestOtp() mails a six-digit code; verifyOtp() checks it and
        is the only thing that grants those claims.

   The code is generated, stored (hashed), and compared entirely in
   Cloud Functions. Nothing on this page can be edited to skip step 2 —
   defeating the redirect below just lands on a dashboard whose reads
   the rules reject.

   "Keep me signed in" selects Firebase persistence, so it survives a
   browser restart the same way the old flag was meant to.
   ================================================================ */

import { requestOtp, verifyOtp, requestPasswordReset } from '../shared/api.js';
import {
  auth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  signOut,
  authErrorMessage,
} from '../shared/firebase.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const form = document.getElementById('loginForm');
const emailInput = document.getElementById('inputEmail');
const passwordInput = document.getElementById('inputPassword');

/* ================================================================
   ALERT HELPERS (top-of-form banner — used for placeholder links
   and errors not tied to one specific field)
   ================================================================ */
function showAlert(msg) {
  const box = document.getElementById('loginAlert');
  const text = document.getElementById('alertText');
  if (box && text) {
    text.textContent = msg;
    box.classList.remove('hidden');
  }
}
function hideAlert() {
  document.getElementById('loginAlert')?.classList.add('hidden');
}

/* ================================================================
   FIELD ERROR HELPERS
   ================================================================ */
function showFieldError(inputId, errId, textId, msg) {
  document.getElementById(inputId)?.classList.add('error-state');
  const errEl = document.getElementById(errId);
  const txtEl = document.getElementById(textId);
  if (txtEl) txtEl.textContent = msg;
  if (errEl) errEl.classList.remove('hidden');
}
function clearFieldError(inputId, errId) {
  document.getElementById(inputId)?.classList.remove('error-state');
  document.getElementById(errId)?.classList.add('hidden');
}

/* Live email validation — clears as soon as the shape is valid,
   flags again on blur if left invalid */
emailInput?.addEventListener('input', () => {
  clearFieldError('inputEmail', 'errEmail');
  hideAlert();
});
emailInput?.addEventListener('blur', () => {
  const val = emailInput.value.trim();
  if (val && !EMAIL_RE.test(val)) {
    showFieldError('inputEmail', 'errEmail', 'errEmailText', 'Enter a valid email address');
  }
});
passwordInput?.addEventListener('input', () => {
  clearFieldError('inputPassword', 'errPassword');
  hideAlert();
});

/* ================================================================
   FORM VALIDATION
   ================================================================ */
function validateForm(email, password) {
  let valid = true;

  if (!email) {
    showFieldError('inputEmail', 'errEmail', 'errEmailText', 'Email address is required.');
    valid = false;
  } else if (!EMAIL_RE.test(email)) {
    showFieldError('inputEmail', 'errEmail', 'errEmailText', 'Enter a valid email address');
    valid = false;
  } else {
    clearFieldError('inputEmail', 'errEmail');
  }

  if (!password) {
    showFieldError('inputPassword', 'errPassword', 'errPasswordText', 'Password is required.');
    valid = false;
  } else {
    clearFieldError('inputPassword', 'errPassword');
  }

  return valid;
}

/* ================================================================
   LOADING STATE
   ================================================================ */
function setLoading(loading) {
  const btn = document.getElementById('btnSubmit');
  const spinner = document.getElementById('btnSpinner');
  const label = document.getElementById('btnLabel');
  if (!btn) return;
  btn.disabled = loading;
  spinner?.classList.toggle('hidden', !loading);
  label?.classList.toggle('hidden', loading);
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
   PASSWORD VISIBILITY TOGGLE
   ================================================================ */
const pwdToggle = document.getElementById('pwdToggle');
const pwdEye = document.getElementById('pwdEye');

pwdToggle?.addEventListener('click', () => {
  const isHidden = passwordInput.type === 'password';
  passwordInput.type = isHidden ? 'text' : 'password';
  pwdEye.className = isHidden ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
  pwdToggle.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
});

/* ================================================================
   SCREEN SWITCHING — Sign In / Two-Factor / Forgot Password live in
   the same auth-left-inner column; only one is visible at a time.
   Switching also resets whichever screen you're leaving, so going
   back and re-opening a flow never shows a leftover field error.
   ================================================================ */
const screens = {
  signIn: document.getElementById('screenSignIn'),
  twoFactor: document.getElementById('screenTwoFactor'),
  forgotPassword: document.getElementById('screenForgotPassword'),
};

function showScreen(name) {
  Object.values(screens).forEach(el => el?.classList.add('hidden'));
  screens[name]?.classList.remove('hidden');
  document.querySelector('.auth-left-scroll')?.scrollTo({ top: 0 });
}

document.getElementById('forgotLink')?.addEventListener('click', (e) => {
  e.preventDefault();
  showScreen('forgotPassword');
});
document.getElementById('backFromForgot')?.addEventListener('click', (e) => {
  e.preventDefault();
  showScreen('signIn');
});
document.getElementById('backFromForgotSent')?.addEventListener('click', () => showScreen('signIn'));

/* ================================================================
   LOGIN SUBMIT — a correct password doesn't sign you in on its own;
   it hands off to the two-factor screen below, which is what actually
   earns the claims the dashboard's data reads require.
   ================================================================ */

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const keepSignedIn = document.getElementById('keepSignedIn')?.checked;

  if (!validateForm(email, password)) {
    shakeShell();
    return;
  }

  setLoading(true);
  hideAlert();

  try {
    /* Persistence has to be chosen before the sign-in it applies to. */
    await setPersistence(auth, keepSignedIn ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    setLoading(false);
    showFieldError('inputPassword', 'errPassword', 'errPasswordText', authErrorMessage(err));
    shakeShell();
    return;
  }

  /* Password accepted. Ask the backend to mail a code — this also
     rejects accounts with no staff profile or a deactivated one, which
     is why a failure here signs the half-authenticated user back out. */
  try {
    const res = await requestOtp();
    setLoading(false);
    document.getElementById('tfaEmailTarget').textContent = res.maskedEmail || email;
    showScreen('twoFactor');
    document.getElementById('tfaCode')?.focus();
  } catch (err) {
    await signOut(auth).catch(() => {});
    setLoading(false);
    showAlert(authErrorMessage(err));
    shakeShell();
  }
});

/* ================================================================
   SHARED BUTTON LOADING HELPER — same spinner/label swap as
   setLoading() above, parameterized for the two-factor and
   forgot-password submit buttons.
   ================================================================ */
function setBtnLoading(btnId, spinnerId, labelId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  document.getElementById(spinnerId)?.classList.toggle('hidden', !loading);
  document.getElementById(labelId)?.classList.toggle('hidden', loading);
}

/* ================================================================
   TWO-FACTOR VERIFICATION
   ================================================================ */
const tfaForm = document.getElementById('tfaForm');
const tfaCodeInput = document.getElementById('tfaCode');

function showTfaAlert(msg) {
  const box = document.getElementById('tfaAlert');
  const text = document.getElementById('tfaAlertText');
  if (box && text) { text.textContent = msg; box.classList.remove('hidden'); }
}
function hideTfaAlert() {
  document.getElementById('tfaAlert')?.classList.add('hidden');
}

/* Digits only, capped at 6 — keeps the field honest to what it's
   asking for instead of validating free-form text after the fact */
tfaCodeInput?.addEventListener('input', () => {
  tfaCodeInput.value = tfaCodeInput.value.replace(/\D/g, '').slice(0, 6);
  clearFieldError('tfaCode', 'errTfaCode');
  hideTfaAlert();
});

tfaForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = tfaCodeInput.value.trim();

  if (code.length !== 6) {
    showFieldError('tfaCode', 'errTfaCode', 'errTfaCodeText', 'Enter the 6-digit code');
    shakeShell();
    return;
  }
  clearFieldError('tfaCode', 'errTfaCode');
  hideTfaAlert();

  setBtnLoading('btnTfaSubmit', 'tfaBtnSpinner', 'tfaBtnLabel', true);

  try {
    await verifyOtp(code);
  } catch (err) {
    setBtnLoading('btnTfaSubmit', 'tfaBtnSpinner', 'tfaBtnLabel', false);
    /* The function counts the attempt and says how many are left, so its
       message is more useful than anything written here. */
    showFieldError('tfaCode', 'errTfaCode', 'errTfaCodeText', authErrorMessage(err));
    shakeShell();
    return;
  }

  /* The claims were just set on the account, but this tab still holds
     the token minted before them. Force a refresh, or the dashboard's
     first read arrives with a token the rules reject. */
  await auth.currentUser?.getIdToken(true);

  setBtnLoading('btnTfaSubmit', 'tfaBtnSpinner', 'tfaBtnLabel', false);
  window.location.href = '../dashboard/dashboard.html';
});

document.getElementById('resendCodeLink')?.addEventListener('click', async (e) => {
  e.preventDefault();
  hideTfaAlert();
  try {
    await requestOtp();
    showTfaAlert('A new code has been sent to your email.');
  } catch (err) {
    /* Covers the resend cooldown and the hourly cap, both of which come
       back with a message naming the wait. */
    showTfaAlert(authErrorMessage(err));
  }
});

document.getElementById('backFromTwoFactor')?.addEventListener('click', async (e) => {
  e.preventDefault();
  tfaForm?.reset();
  clearFieldError('tfaCode', 'errTfaCode');
  hideTfaAlert();
  /* Backing out abandons a password-verified session; end it rather than
     leaving it signed in behind the login screen. */
  await signOut(auth).catch(() => {});
  showScreen('signIn');
});

/* ================================================================
   FORGOT / RESET PASSWORD
   Deliberately doesn't reveal whether the email matches an account
   — same "check your email" message either way, so this can't be
   used to enumerate valid accounts.
   ================================================================ */
const forgotForm = document.getElementById('forgotForm');
const forgotEmailInput = document.getElementById('forgotEmail');

forgotEmailInput?.addEventListener('input', () => clearFieldError('forgotEmail', 'errForgotEmail'));

forgotForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = forgotEmailInput.value.trim();

  if (!email || !EMAIL_RE.test(email)) {
    showFieldError('forgotEmail', 'errForgotEmail', 'errForgotEmailText', 'Enter a valid email address');
    return;
  }
  clearFieldError('forgotEmail', 'errForgotEmail');

  setBtnLoading('btnForgotSubmit', 'forgotBtnSpinner', 'forgotBtnLabel', true);

  /* Sent through the clinic's own Gmail rather than Firebase's default
     sender. Firebase mails these from noreply@<project>.firebaseapp.com,
     which spam filters distrust — those were landing in spam while the
     OTP mail from the same Gmail arrived in the inbox.

     The server answers identically whether or not the address has an
     account, so nothing here can be used to discover who works at the
     RHU. Only a rate limit or a malformed address produces an error,
     and neither reveals anything about the roster. */
  try {
    await requestPasswordReset(email);
  } catch (err) {
    setBtnLoading('btnForgotSubmit', 'forgotBtnSpinner', 'forgotBtnLabel', false);
    showFieldError('forgotEmail', 'errForgotEmail', 'errForgotEmailText', err.message);
    return;
  }
  setBtnLoading('btnForgotSubmit', 'forgotBtnSpinner', 'forgotBtnLabel', false);

  document.getElementById('forgotSentEmail').textContent = email;
  document.getElementById('forgotFormWrap')?.classList.add('hidden');
  document.getElementById('forgotSentWrap')?.classList.remove('hidden');
  forgotForm.reset();
});

/* Reset the forgot-password screen back to its form state whenever
   it's (re)opened, so it doesn't reopen on the "check your email"
   confirmation from a previous visit. */
document.getElementById('forgotLink')?.addEventListener('click', () => {
  document.getElementById('forgotFormWrap')?.classList.remove('hidden');
  document.getElementById('forgotSentWrap')?.classList.add('hidden');
});
