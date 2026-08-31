/* ================================================================
   DiaCare — Firebase web config

   Fill these in from the Firebase console:
     Project settings -> General -> Your apps -> Web app -> SDK setup

   These values are public by design; a web API key identifies the
   project, it does not authorize anything. What protects the data is
   firestore.rules plus the OTP claims the Cloud Functions grant. The
   Gmail app password is NOT here and must never be — it lives only in
   Cloud Functions secrets.
   ================================================================ */

export const firebaseConfig = {
  apiKey: 'AIzaSyCrTy4ZepaRiVj4nYwlTqUQWXhqCy4g9JQ',
  authDomain: 'diacare-fe2d1.firebaseapp.com',
  projectId: 'diacare-fe2d1',
  storageBucket: 'diacare-fe2d1.firebasestorage.app',
  messagingSenderId: '2509170380',
  appId: '1:2509170380:web:f8accd3656bcca1f14c469',
};

/* The OTP backend is not Firebase. It runs as serverless functions under
   /api on the same origin (see api/ and diacare/shared/api.js), which is
   what keeps this project off the Blaze plan. */

/* Set true to point Auth and Firestore at the local emulators
   (firebase emulators:start). Leave false for real use. */
export const USE_EMULATORS = false;
