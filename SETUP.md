# DiaCare Dashboard — Firebase Auth + Email OTP Setup

Login is: **Firebase Auth password → six-digit code emailed via Gmail SMTP → dashboard.**

The code is generated, stored (hashed), and verified on the server. Nothing in the browser
can skip step two — Firestore rules reject reads from a session that never cleared the
code.

**No Blaze plan, no billing card.** Firebase stays on the free Spark plan and provides only
Auth and Firestore. The part that needs a server — sending mail and granting the session —
runs as serverless functions on Vercel's free Hobby tier, which keeps a Node runtime so
`nodemailer` can open an SMTP connection to Gmail. Vercel serves the static pages too, so
the site and `/api` share one origin: no CORS, no API URL to configure.

> Vercel's Hobby tier is for non-commercial use. A thesis / RHU deployment fits; if this
> ever becomes a paid product, move the same `api/` folder to any Node host.

---

## What you need

| Thing | Why |
|---|---|
| Firebase project **DiaCare** (`diacare-fe2d1`) | Auth + Firestore. Free Spark plan is enough. |
| A Vercel account | Free. Sign up with GitHub or email at <https://vercel.com/signup>. |
| A Gmail account with 2-Step Verification on | App passwords can't be created without it. |
| Node.js 20+, Firebase CLI | Both already installed (Node v24, CLI 15.24.0). |

---

## Already done

- Firebase CLI signed in as `idananjohnmark519@gmail.com`.
- Project **DiaCare** — id `diacare-fe2d1` — set as the default in `.firebaserc`.
- Web app **DiaCare Dashboard** created; its config is filled into
  `diacare/shared/firebase-config.js`.
- Firestore `(default)` exists and `firestore.rules` is deployed to it.
- `npm install` complete at the repo root (`firebase-admin`, `nodemailer`).

> Three projects have similar names. The dashboard is wired to **`diacare-fe2d1`**.
> Not `diacare-libon-5c1ab` (the other project on this account), and not `diacare-libon`
> (a same-named project visible only from `pcdelacruz04@gmail.com`).

---

## 1. Firebase console — one toggle

**Authentication → Get started → Sign-in method → Email/Password → Enable.**
Leave "Email link (passwordless)" off.
<https://console.firebase.google.com/project/diacare-fe2d1/authentication/providers>

That is the only console step left. Blaze is not needed.

## 2. Service account key

The API sets custom claims and reads Firestore with the Admin SDK, which needs a service
account.

1. <https://console.firebase.google.com/project/diacare-fe2d1/settings/serviceaccounts/adminsdk>
   → **Generate new private key**. Save the JSON **outside this project folder**.
2. Open it and keep three values to hand: `project_id`, `client_email`, `private_key`.

> **Security:** that file is a full-project master credential — it can read every record
> and mint tokens for any user. Never commit it, never put it under `diacare/`, and delete
> it once section 5 is done. `.gitignore` already excludes the usual filenames as a
> backstop, not as permission to keep it around.

## 3. Gmail app password

1. Turn on 2-Step Verification: <https://myaccount.google.com/signinoptions/two-step-verification>
2. <https://myaccount.google.com/apppasswords> → create one named `DiaCare` → copy the
   16 characters.
3. Prefer a dedicated sender (e.g. `diacare.rhulibon@gmail.com`) over a personal inbox, so
   revoking it later disturbs nothing else.

> **Security:** an app password bypasses 2FA for whoever holds it. It belongs only in
> Vercel's environment variables. Never in `firebase-config.js`, never anywhere under
> `diacare/`, never in a commit.

Gmail SMTP allows roughly 500 messages/day — ample for staff logins. To outgrow it, swap
the transport in `api/_lib/core.js` for SendGrid or SES; nothing else changes.

## 4. Deploy to Vercel

```bash
cd "c:/Users/Admin/OneDrive/Desktop/Diacare_Final/DIACARE_WEBDASHBOARD/DIACARE_WEBDASHBOARD"
npx vercel login
npx vercel            # first run: answer the prompts, creates the project
```

Then add the environment variables — **Production, Preview, and Development** for each:

```bash
npx vercel env add FIREBASE_PROJECT_ID
npx vercel env add FIREBASE_CLIENT_EMAIL
npx vercel env add FIREBASE_PRIVATE_KEY     # paste the whole PEM, BEGIN/END lines included
npx vercel env add GMAIL_USER
npx vercel env add GMAIL_APP_PASSWORD
```

Or paste them in the dashboard under **Project → Settings → Environment Variables**.
`.env.example` names all five. Then ship it:

```bash
npx vercel --prod
```

Vercel prints the live URL. The site is at `/`, the API at `/api/*`.

### Authorize that domain in Firebase

**Authentication → Settings → Authorized domains → Add domain** → your `*.vercel.app`
hostname. Sign-in is rejected from an unlisted origin.

## 5. Create the first administrator

`/api/create-staff` requires an already-verified admin, so the first one is made locally.

```bash
cd "c:/Users/Admin/OneDrive/Desktop/Diacare_Final/DIACARE_WEBDASHBOARD/DIACARE_WEBDASHBOARD"
cd scripts && npm install && cd ..
$env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\to\the-key.json'
node scripts/create-admin.js you@gmail.com "Your Full Name"
```

It asks for confirmation, then prints a temporary password **once**. Delete the key file
afterwards.

## 6. Sign in

Open the Vercel URL. Email + temporary password, then the six-digit code that arrives in
seconds. Change the password from Settings once you are in.

---

## How the pieces fit

```
diacare/login/login.js
   │
   ├─ signInWithEmailAndPassword ──►  Firebase Auth
   │                                  (password only — grants no data access)
   │
   ├─ POST /api/request-otp  ──────►  Vercel function
   │                                    ├─ hash into otp_codes/{uid}
   │                                    └─ Gmail SMTP sends the plaintext once
   │
   └─ POST /api/verify-otp   ──────►  Vercel function
                                        └─ sets claims otpVerified / otpAt / role
                                                    │
                        firestore.rules requires those claims, fresh within 12 hours
```

| File | Role |
|---|---|
| `api/_lib/core.js` | Admin SDK, token verification, OTP primitives, mailer |
| `api/request-otp.js` · `verify-otp.js` · `end-session.js` | The login flow |
| `api/create-staff.js` · `set-staff-status.js` | Admin-only account management |
| `firestore.rules` | The actual security boundary |
| `diacare/shared/firebase.js` | One Firebase app per page, session freshness check |
| `diacare/shared/api.js` | Calls `/api/*` with the Firebase ID token attached |
| `diacare/shared/auth-guard.js` | Redirects unverified visitors (convenience, not security) |
| `scripts/create-admin.js` | One-time bootstrap of the first admin |

**Enforced server-side:** code expires in 10 min · 5 wrong guesses kills it · 30 s between
resends · 5 codes per hour · verification expires after 12 h · sign-out revokes refresh
tokens.

## Local development

```bash
npx vercel dev
```

Serves the static pages and `/api` together on <http://localhost:3000>, pulling the same
environment variables. A plain `python -m http.server` will **not** work any more — it
serves no `/api`, so the code request fails.

## Still to wire

- `personnel/user-management.html` still renders its demo roster. The routes it needs
  (`/api/create-staff`, `/api/set-staff-status`) are written and ready.
- Patient, alert, and trend pages still read `shared/patients-data.js`. Rules for
  `patients` and `alerts` are already written for when that moves to Firestore.
