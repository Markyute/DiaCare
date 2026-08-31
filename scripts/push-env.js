'use strict';
/* ================================================================
   DiaCare — push backend secrets to Vercel

   Reads the Firebase service-account JSON off disk and asks for the
   Gmail credentials, then sets all five environment variables on the
   linked Vercel project for production, preview, and development.

   Usage:
     node scripts/push-env.js "C:\path\to\serviceAccountKey.json"

   Nothing is printed back and nothing is written to a file. Values go
   to the Vercel CLI over stdin, so they never appear in shell history
   or in this terminal's scrollback.

   Run it yourself. The service-account key can mint a token for any
   user in the project, and the Gmail app password bypasses 2FA for
   whoever holds it — neither should be pasted into a chat, a commit,
   or anything under diacare/.
   ================================================================ */

const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const keyPath = process.argv[2];

if (!keyPath) {
  console.error('Usage: node scripts/push-env.js "<path to serviceAccountKey.json>"');
  process.exit(1);
}
if (!fs.existsSync(keyPath)) {
  console.error('No such file: ' + keyPath);
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(projectRoot, '.vercel', 'project.json'))) {
  console.error('This folder is not linked to a Vercel project. Run: npx vercel link');
  process.exit(1);
}

/* ================================================================
   READ THE SERVICE ACCOUNT
   ================================================================ */
let key;
try {
  key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
} catch (err) {
  console.error('That file is not valid JSON. Use the key downloaded from\n' +
                'Firebase console -> Project settings -> Service accounts.');
  process.exit(1);
}
if (!key.project_id || !key.client_email || !key.private_key) {
  console.error('That JSON has no project_id / client_email / private_key.\n' +
                'It does not look like a Firebase service-account key.');
  process.exit(1);
}
if (key.project_id !== 'diacare-fe2d1') {
  console.error('That key belongs to project "' + key.project_id + '", not diacare-fe2d1.');
  process.exit(1);
}

/* Warn if the key is sitting inside the repo, where it can be committed
   or served by the dev server. */
if (path.resolve(keyPath).startsWith(projectRoot + path.sep)) {
  console.warn('\n  WARNING: the key file is inside the project folder.');
  console.warn('  Move it elsewhere and delete this copy once setup is done.\n');
}

/* ================================================================
   PROMPTS

   The Gmail values are typed rather than read from a file, so a copy
   doesn't end up sitting on disk.
   ================================================================ */
function ask(question, { mask = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (mask) {
      /* readline has no built-in masking; suppress its echo and print a
         dot per keypress instead. */
      const onData = (char) => {
        if (['\n', '\r', '\u0004'].includes(char.toString())) return;
        readline.moveCursor(process.stdout, -1, 0);
        process.stdout.write('*');
      };
      process.stdin.on('data', onData);
      rl.question(question, (answer) => {
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(answer.trim());
      });
    } else {
      rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
    }
  });
}

/* ================================================================
   VERCEL CLI

   `vercel env add` takes the value on stdin, which keeps it out of the
   process arguments other users on the machine could read.
   ================================================================ */
function vercel(args, stdinValue) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['--yes', 'vercel', ...args], {
      cwd: projectRoot,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
    if (stdinValue !== undefined) child.stdin.write(stdinValue);
    child.stdin.end();
  });
}

const TARGETS = ['production', 'preview', 'development'];

async function setVar(name, value) {
  process.stdout.write('  ' + name.padEnd(24));
  for (const target of TARGETS) {
    /* Remove first so re-running this after a typo replaces the value
       instead of failing on "already exists". */
    await vercel(['env', 'rm', name, target, '--yes']);
    const res = await vercel(['env', 'add', name, target], value);
    if (res.code !== 0) {
      console.log('FAILED (' + target + ')');
      /* The output can echo the value back, so only the tail is shown. */
      console.error(res.out.split('\n').slice(-4).join('\n'));
      process.exit(1);
    }
  }
  console.log('set for ' + TARGETS.join(', '));
}

async function main() {
  console.log('\nProject:  diacare-dashboard  (Vercel)');
  console.log('Firebase: ' + key.project_id);
  console.log('Service account: ' + key.client_email + '\n');

  const gmailUser = await ask('Gmail address that sends the codes: ');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmailUser)) {
    console.error('That is not a valid email address.');
    process.exit(1);
  }

  const gmailPass = await ask('Gmail app password (16 chars, input hidden): ', { mask: true });
  /* Google shows it as "abcd efgh ijkl mnop"; the spaces are display
     only and SMTP rejects them. */
  const cleanedPass = gmailPass.replace(/\s+/g, '');
  if (cleanedPass.length !== 16) {
    console.error('Expected 16 characters, got ' + cleanedPass.length + '. ' +
                  'Use an app password from https://myaccount.google.com/apppasswords, ' +
                  'not your normal Gmail password.');
    process.exit(1);
  }

  console.log('\nPushing to Vercel...\n');
  await setVar('FIREBASE_PROJECT_ID', key.project_id);
  await setVar('FIREBASE_CLIENT_EMAIL', key.client_email);
  await setVar('FIREBASE_PRIVATE_KEY', key.private_key);
  await setVar('GMAIL_USER', gmailUser);
  await setVar('GMAIL_APP_PASSWORD', cleanedPass);

  console.log('\nDone. Deploy with:  npx vercel --prod');
  console.log('Then delete the service-account key file.\n');
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
