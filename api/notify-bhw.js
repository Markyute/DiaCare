'use strict';
/* ================================================================
   POST /api/notify-bhw
   { bhwId, title, body, type?, patientId?, patientName? }

   Sends a push to one field worker's handset.

   The app has always asked for notification permission and fetched a
   device token, and the rules have always whitelisted fcmToken — but
   nothing wrote the token and nothing sent a message, so a BHW only
   ever saw alerts their own phone had calculated. This is the missing
   half: the app now stores its token on the worker's user document,
   and this reads it back to target the send.

   Only verified dashboard staff may call it. A BHW cannot push to a
   colleague's phone, and an unauthenticated caller cannot push at all —
   an open endpoint here would be a way to send arbitrary clinical
   notifications to a health worker's lock screen.
   ================================================================ */

const { admin, db, ApiError, handle, requireUser } = require('./_lib/core');

module.exports = handle(async (req) => {
  const decoded = await requireUser(req);
  if (decoded.otpVerified !== true) {
    throw new ApiError(403, 'Only verified health unit staff can send alerts.');
  }

  const { bhwId, title, body, type, patientId, patientName } = req.body || {};

  if (!bhwId || typeof bhwId !== 'string') {
    throw new ApiError(400, 'Which health worker should be notified?');
  }
  if (!title || !body) {
    throw new ApiError(400, 'A notification needs a title and a message.');
  }

  const snap = await db.collection('users').doc(bhwId).get();
  if (!snap.exists) {
    throw new ApiError(404, 'That health worker no longer exists.');
  }

  const profile = snap.data() || {};
  if ((profile.status || 'active') !== 'active') {
    throw new ApiError(409, 'That account has been deactivated.');
  }

  const token = profile.fcmToken;
  if (!token) {
    /* Not an error worth failing the caller's own action over: the
       worker simply has not opened the app since push was added, or
       declined the permission. Said plainly so the dashboard can show
       "alert not delivered" rather than implying it arrived. */
    return { ok: false, delivered: false, reason: 'no-token' };
  }

  try {
    await admin.messaging().send({
      token,
      notification: { title: String(title), body: String(body) },
      // The app's foreground handler branches on data.type and reads
      // patientName, so both travel as data rather than only as display
      // text. Every value must be a string — FCM rejects the message
      // otherwise, and a rejected send is a silent non-delivery.
      data: {
        type: String(type || 'info'),
        patientId: String(patientId || ''),
        patientName: String(patientName || ''),
      },
      android: {
        priority: 'high',
        // Must match the channel the app creates in
        // LocalNotificationService, or Android drops the alert into a
        // default low-importance channel with no sound.
        notification: { channelId: 'diacare_high_risk' },
      },
    });
  } catch (err) {
    /* A token goes stale when the app is reinstalled or its data is
       cleared. Clearing it here stops every later alert retrying against
       a token FCM has already rejected; the app writes a fresh one on
       its next sign-in. */
    const code = err && err.errorInfo && err.errorInfo.code;
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token'
    ) {
      await db.collection('users').doc(bhwId).update({ fcmToken: '' });
      return { ok: false, delivered: false, reason: 'stale-token' };
    }
    throw new ApiError(502, 'The notification service refused the message.');
  }

  return { ok: true, delivered: true };
});
