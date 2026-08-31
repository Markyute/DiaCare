'use strict';
/* ================================================================
   POST /api/request-otp

   Called once the password check has succeeded. Generates a code,
   stores only its hash, and mails the plaintext exactly once.

   Succeeding at the password step is not enough to reach the dashboard:
   this route is also where a missing or deactivated staff profile stops
   the sign-in.
   ================================================================ */

const {
  db,
  ApiError,
  handle,
  requireUser,
  loadActiveProfile,
  hashCode,
  generateCode,
  mailer,
  codeEmail,
  maskEmail,
  CODE_TTL_MS,
  MAX_SENDS_PER_WINDOW,
  SEND_WINDOW_MS,
  RESEND_COOLDOWN_MS,
} = require('./_lib/core');

module.exports = handle(async (req) => {
  const user = await requireUser(req);
  const uid = user.uid;
  const profile = await loadActiveProfile(uid);

  const email = user.email;
  if (!email) {
    throw new ApiError(400, 'This account has no email address.');
  }

  const now = Date.now();
  const throttleRef = db.collection('otp_throttle').doc(uid);

  /* Resend limits run in a transaction so two tabs racing each other
     can't both slip past the cap. */
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(throttleRef);
    const data = snap.exists ? snap.data() : null;
    const windowStart = data && now - data.windowStart < SEND_WINDOW_MS ? data.windowStart : now;
    const sends = data && windowStart === data.windowStart ? data.sends : 0;

    if (data && data.lastSentAt && now - data.lastSentAt < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - data.lastSentAt)) / 1000);
      throw new ApiError(429, 'Please wait ' + wait + 's before requesting another code.');
    }
    if (sends >= MAX_SENDS_PER_WINDOW) {
      /* "In an hour" was wrong nearly always - the window started when
         the first code went out, not now - and left no way to tell how
         long was actually left. */
      const minutes = Math.max(1, Math.ceil((SEND_WINDOW_MS - (now - windowStart)) / 60000));
      throw new ApiError(429,
        'Too many codes requested. Try again in ' + minutes +
        (minutes === 1 ? ' minute.' : ' minutes.'));
    }

    tx.set(throttleRef, { windowStart, sends: sends + 1, lastSentAt: now }, { merge: true });
  });

  const code = generateCode();
  await db.collection('otp_codes').doc(uid).set({
    hash: hashCode(uid, code),
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    createdAt: now,
  });

  const message = codeEmail(profile.fullName || 'there', code);
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
    /* The code itself never reaches the log — only the failure does.
       The stored hash is dropped too, so a code nobody received can't
       sit there counting against the next attempt. */
    console.error('OTP delivery failed for', uid, err.message);
    await db.collection('otp_codes').doc(uid).delete().catch(() => {});
    throw new ApiError(502, 'Could not send the verification email. Try again shortly.');
  }

  return {
    sent: true,
    maskedEmail: maskEmail(email),
    expiresInSeconds: CODE_TTL_MS / 1000,
  };
});
