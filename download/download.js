'use strict';
/* ================================================================
   DiaCare — install page

   Draws the QR for the APK next to this page, and shows the same link
   as text so it can be typed or copied when a camera will not
   cooperate — which in a barangay is a real possibility.
   ================================================================ */

/* Root-absolute, not relative to this page.
   A relative 'diacare.apk' resolves against the current address, and
   this page answers on both /download and /download/ — without the
   trailing slash the browser treats "download" as a filename, drops it,
   and builds https://host/diacare.apk. That is a 404, and it is what the
   QR encoded.

   The origin is still read from the page rather than hard-coded, so this
   survives a move to a custom domain. */
const apkUrl = new URL('/download/diacare.apk', window.location.origin).href;

const urlEl = document.getElementById('qrUrl');
if (urlEl) urlEl.textContent = apkUrl;

const holder = document.getElementById('qr');

if (holder && typeof QRCode !== 'undefined') {
  new QRCode(holder, {
    text: apkUrl,
    width: 232,
    height: 232,
    colorDark: '#0F2E28',
    colorLight: '#ffffff',
    /* An APK download is a long-ish URL and phone cameras are often
       reading this in poor light at arm's length. High correction keeps
       it scannable when part of the code is obscured or blurred. */
    correctLevel: QRCode.CorrectLevel.H,
  });
} else if (holder) {
  /* The library is the only thing here that comes from a CDN, so it is
     also the only thing that can fail on a bad connection. Say what to
     do rather than leaving an empty box. */
  holder.innerHTML =
    '<p class="qr-fallback">The code could not be drawn. ' +
    'Use the download button below, or open this address on the phone:<br>' +
    '<span>' + apkUrl + '</span></p>';
}
