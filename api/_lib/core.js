'use strict';
/* ================================================================
   DiaCare — shared backend core

   Everything the API routes need in common: the Admin SDK singleton,
   ID-token verification, the OTP primitives, and the mailer.

   This is the half of the login that must not run in a browser. The
   Gmail app password, the service-account key, the code itself, and the
   attempt counters all live here and are never sent to the client.

   Runs as Vercel serverless functions on the free Hobby tier, which
   keeps a Node runtime (so nodemailer can open an SMTP connection) and
   needs no billing account.
   ================================================================ */

const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

/* ================================================================
   ADMIN SDK

   Serverless containers are reused between invocations, so guard the
   init — a second initializeApp() on a warm container throws.
   ================================================================ */
if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  /* Vercel stores env vars as single-line strings, so the PEM's newlines
     arrive escaped and have to be put back before the SDK will parse it. */
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing Firebase service-account env vars. Set FIREBASE_PROJECT_ID, ' +
      'FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

const auth = admin.auth();
const db = admin.firestore();

/* ================================================================
   LIMITS — mirrored in firestore.rules (SESSION_TTL_MS) and in
   shared/firebase.js (SESSION_TTL_MS).
   ================================================================ */
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/* ================================================================
   ERRORS — thrown anywhere, turned into a status + message by
   handle() below, so routes can read as straight-line code.
   ================================================================ */
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ================================================================
   OTP PRIMITIVES
   ================================================================ */

/* Codes are stored as hashes, never in the clear, so a leak of the
   otp_codes collection doesn't hand over usable codes. The uid is folded
   in so the same digits hash differently per user. */
function hashCode(uid, code) {
  return crypto.createHash('sha256').update(uid + ':' + code).digest('hex');
}

/* randomInt draws from the CSPRNG — Math.random() is predictable enough
   to guess a six-digit code from a handful of samples. */
function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ================================================================
   REQUEST AUTH

   The client sends the Firebase ID token it already holds. Verifying it
   here is what replaces Cloud Functions' automatic request.auth — a
   caller cannot claim to be a uid it has no token for.
   ================================================================ */
async function requireUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    throw new ApiError(401, 'Sign in with your password first.');
  }
  const idToken = header.slice(7).trim();

  let decoded;
  try {
    /* checkRevoked catches tokens issued before a sign-out or a forced
       revocation, which is what makes endSession actually end things. */
    decoded = await auth.verifyIdToken(idToken, true);
  } catch (err) {
    throw new ApiError(401, 'Your session expired. Sign in again.');
  }
  return decoded;
}

async function requireVerifiedAdmin(req) {
  const decoded = await requireUser(req);
  if (decoded.otpVerified !== true || decoded.role !== 'admin') {
    throw new ApiError(403, 'Only a verified administrator can do that.');
  }
  return decoded;
}

/* The staff profile is the authorization record: a Firebase Auth account
   with no profile, or a deactivated one, gets no code and no claims. */
async function loadActiveProfile(uid) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) {
    throw new ApiError(403, 'This account is not registered for the dashboard.');
  }
  const profile = snap.data();
  if (profile.status !== 'active') {
    throw new ApiError(403, 'This account is deactivated. Contact an administrator.');
  }
  return profile;
}

/* ================================================================
   MAIL
   ================================================================ */
function mailer() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new ApiError(500, 'Email is not configured on the server.');
  }
  return {
    transport: nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }),
    from: 'DiaCare <' + user + '>',
  };
}

function codeEmail(toName, code) {
  const minutes = Math.round(CODE_TTL_MS / 60000);

  const text =
    'Hello ' + toName + ',\n\n' +
    'Your DiaCare sign-in code is ' + code + '.\n' +
    'It expires in ' + minutes + ' minutes and can be used once.\n\n' +
    'If you did not try to sign in, change your password — someone else knows it.\n\n' +
    'RHU Libon — DiaCare';

  const html =
    '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#12263a">' +
      '<p style="margin:0 0 4px;font-size:14px">Hello ' + toName + ',</p>' +
      '<p style="margin:0 0 20px;font-size:14px">Your DiaCare sign-in code is:</p>' +
      '<p style="font-size:34px;font-weight:600;letter-spacing:10px;margin:0 0 20px;color:#0b7285">' + code + '</p>' +
      '<p style="margin:0 0 16px;font-size:13px;color:#5a6b7b">Expires in ' + minutes + ' minutes. Can be used once.</p>' +
      '<p style="margin:0 0 24px;font-size:13px;color:#5a6b7b">If you did not try to sign in, change your password — someone else knows it.</p>' +
      '<p style="margin:0;font-size:12px;color:#8a97a3">RHU Libon — DiaCare</p>' +
    '</div>';

  return { subject: code + ' is your DiaCare verification code', text, html };
}

/* Show only enough of the address to confirm which inbox to open. */
function maskEmail(email) {
  const parts = String(email).split('@');
  if (parts.length !== 2) return '';
  const name = parts[0];
  return name.slice(0, 2) + '•'.repeat(Math.max(name.length - 2, 1)) + '@' + parts[1];
}

/* ================================================================
   ROUTE WRAPPER

   POST-only, JSON in and out, and one place that decides what an
   unexpected failure is allowed to tell the caller.
   ================================================================ */
function handle(fn) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
      const result = await fn(req, res);
      return res.status(200).json(result || { ok: true });
    } catch (err) {
      if (err instanceof ApiError) {
        return res.status(err.status).json({ error: err.message });
      }
      /* Real detail goes to the Vercel log; the caller gets nothing that
         describes the internals. */
      console.error('Unhandled API error:', err);
      return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
}

module.exports = {
  admin,
  auth,
  db,
  ApiError,
  handle,
  requireUser,
  requireVerifiedAdmin,
  loadActiveProfile,
  hashCode,
  generateCode,
  timingSafeEqual,
  mailer,
  codeEmail,
  maskEmail,
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  MAX_SENDS_PER_WINDOW,
  SEND_WINDOW_MS,
  RESEND_COOLDOWN_MS,
  SESSION_TTL_MS,
};
