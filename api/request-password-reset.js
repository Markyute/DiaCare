'use strict';
/* ================================================================
   POST /api/request-password-reset   { email }

   Firebase can send its own reset mail, but it comes from
   noreply@<project>.firebaseapp.com — a generic Google domain with no
   relationship to the clinic — and it reliably lands in spam. The OTP
   mail already goes out from the clinic's own Gmail and arrives in the
   inbox, so this generates the reset link with the Admin SDK and sends
   it down that same known-good path.

   Unauthenticated by necessity: someone who cannot sign in is exactly
   who needs this. That makes two things load-bearing —

     - The reply is identical whether or not the address has an account.
       Saying "no such user" would turn this into a way to discover who
       works at the RHU.
     - It is rate limited per address, because an open endpoint that
       sends mail is otherwise a way to use the clinic's Gmail quota to
       flood someone's inbox.
   ================================================================ */

const crypto = require('crypto');
const {
  auth,
  db,
  ApiError,
  handle,
  mailer,
} = require('./_lib/core');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_PER_WINDOW = 3;
const WINDOW_MS = 60 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;

const SITE_URL = 'https://diacare-dashboard.vercel.app';
const LOGIN_URL = SITE_URL + '/login/login.html';
const RESET_PAGE = SITE_URL + '/reset/reset.html';

/* generatePasswordResetLink returns a link to Firebase's own hosted
   handler, which carries Google's styling on a firebaseapp.com URL —
   exactly the sort of page people are told not to type a password into.
   The oobCode is the whole credential, so moving it onto the dashboard's
   own reset page changes nothing about how it is redeemed; reset.js
   calls verifyPasswordResetCode and confirmPasswordReset itself.

   If the link ever comes back in a shape this cannot read, the original
   is used rather than sending a broken one. */
function toDashboardResetPage(firebaseLink) {
  try {
    const code = new URL(firebaseLink).searchParams.get('oobCode');
    if (!code) return firebaseLink;
    return RESET_PAGE + '?mode=resetPassword&oobCode=' + encodeURIComponent(code);
  } catch (err) {
    console.warn('Could not rewrite the reset link; sending the default handler.');
    return firebaseLink;
  }
}

/* The throttle document is keyed by a hash rather than the address, so
   the collection isn't a readable list of who has asked to reset. */
function throttleKey(email) {
  return crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
}

function resetEmail(toName, link) {
  const text =
    'Hello ' + toName + ',\n\n' +
    'Someone asked to reset the password for your DiaCare account.\n\n' +
    'Set a new password here:\n' + link + '\n\n' +
    'The link can be used once and expires in about an hour.\n\n' +
    'If this was not you, ignore this email — your password has not changed.\n\n' +
    'RHU Libon — DiaCare';

  const html =
    '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#12263a">' +
      '<p style="margin:0 0 4px;font-size:14px">Hello ' + toName + ',</p>' +
      '<p style="margin:0 0 20px;font-size:14px">Someone asked to reset the password for your DiaCare account.</p>' +
      '<p style="margin:0 0 24px">' +
        '<a href="' + link + '" style="display:inline-block;background:#0b7285;color:#fff;' +
        'text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">' +
        'Set a new password</a>' +
      '</p>' +
      '<p style="margin:0 0 16px;font-size:13px;color:#5a6b7b">' +
        'The link can be used once and expires in about an hour.</p>' +
      '<p style="margin:0 0 24px;font-size:13px;color:#5a6b7b">' +
        'If this was not you, ignore this email — your password has not changed.</p>' +
      '<p style="margin:0;font-size:12px;color:#8a97a3">RHU Libon — DiaCare</p>' +
    '</div>';

  return { subject: 'Reset your DiaCare password', text, html };
}

module.exports = handle(async (req) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();

  /* A malformed address is the one thing worth saying plainly — it
     reveals nothing about the roster. */
  if (!EMAIL_RE.test(email)) {
    throw new ApiError(400, 'Enter a valid email address.');
  }

  const now = Date.now();
  const ref = db.collection('reset_throttle').doc(throttleKey(email));

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const windowStart = data && now - data.windowStart < WINDOW_MS ? data.windowStart : now;
    const sends = data && windowStart === data.windowStart ? data.sends : 0;

    if (data && data.lastSentAt && now - data.lastSentAt < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - (now - data.lastSentAt)) / 1000);
      throw new ApiError(429, 'Please wait ' + wait + 's before requesting another link.');
    }
    if (sends >= MAX_PER_WINDOW) {
      throw new ApiError(429, 'Too many reset requests. Try again in an hour.');
    }

    tx.set(ref, { windowStart, sends: sends + 1, lastSentAt: now }, { merge: true });
  });

  /* From here on every path returns the same thing. An unknown address,
     a send failure, and a success are indistinguishable to the caller. */
  let link;
  let displayName = 'there';
  try {
    const user = await auth.getUserByEmail(email);
    displayName = user.displayName || 'there';

    /* Sending the user back to the login page after they set a password
       saves them hunting for the tab again. */
    link = await auth.generatePasswordResetLink(email, {
      url: LOGIN_URL,
      handleCodeInApp: false,
    });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return { sent: true };
    }
    /* An unauthorized continue URL should not cost the user their reset
       — fall back to the plain link Firebase hosts. */
    if (err.code === 'auth/invalid-continue-uri' || err.code === 'auth/unauthorized-continue-uri') {
      console.warn('Continue URL rejected; falling back to the default handler.');
      link = await auth.generatePasswordResetLink(email);
    } else {
      console.error('Could not generate a reset link:', err.message);
      return { sent: true };
    }
  }

  const message = resetEmail(displayName, toDashboardResetPage(link));
  try {
    const { transport, from } = mailer();
    await transport.sendMail({
      from,
      to: email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } catch (err) {
    /* The link is never logged — it is a live credential until used. */
    console.error('Reset mail delivery failed:', err.message);
  }

  return { sent: true };
});
