/* ================================================================
   DiaCare — backend API client

   The auth backend runs as serverless functions under /api on Vercel
   rather than as Firebase Cloud Functions, which would have required
   the Blaze plan. Same site, same origin, so no CORS and no API base
   URL to configure.

   Every call carries the Firebase ID token; the server verifies it, so
   a caller cannot claim a uid it holds no token for.
   ================================================================ */

import { auth } from './firebase.js';

/* Thrown for any non-2xx reply. The message is the one the server wrote
   — those are already phrased for the operator (how many attempts are
   left, how long to wait), so they go straight to the UI. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function call(path, body) {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError(401, 'Sign in with your password first.');
  }

  const token = await user.getIdToken();

  let res;
  try {
    res = await fetch('/api/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(body || {}),
    });
  } catch (err) {
    /* fetch only rejects on a transport failure, so this is genuinely a
       network problem rather than an error reply. */
    throw new ApiError(0, 'Network problem. Check your connection and try again.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    /* A non-JSON body means something upstream failed before the handler
       ran — a crashed function, a platform error page. */
    if (!res.ok) throw new ApiError(res.status, 'Something went wrong. Please try again.');
  }

  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || 'Something went wrong. Please try again.');
  }
  return data || {};
}

async function callAnonymous(path, body) {
  let res;
  try {
    res = await fetch('/api/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch (err) {
    throw new ApiError(0, 'Network problem. Check your connection and try again.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    if (!res.ok) throw new ApiError(res.status, 'Something went wrong. Please try again.');
  }
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || 'Something went wrong. Please try again.');
  }
  return data || {};
}

/* The only route that works without being signed in — someone who
   cannot sign in is exactly who needs it. */
export const requestPasswordReset = (email) => callAnonymous('request-password-reset', { email });

export const requestOtp = () => call('request-otp');
export const verifyOtp = (code, remember) => call('verify-otp', { code, remember: !!remember });
export const endSession = () => call('end-session');
export const createStaffAccount = (payload) => call('create-staff', payload);
export const updateStaffAccount = (payload) => call('update-staff', payload);
export const setStaffStatus = (id, status) => call('set-staff-status', { id, status });
