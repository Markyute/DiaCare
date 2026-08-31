/* ================================================================
   DiaCare — signed-in user in the top nav

   The avatar chip was hardcoded to "RHU Nurse / Field Personnel" on
   every page, which was wrong for everyone: an administrator saw
   themselves labelled a nurse, and two nurses signed in on the same
   machine were indistinguishable.

   It now shows whoever is actually signed in, read from their users/
   profile — the same document the API checks for authorisation, so the
   name in the corner and the permissions the server enforces cannot
   disagree.

   The chip is also a link now. It was a <button> that did nothing,
   which is worse than not being clickable at all.
   ================================================================ */

import { auth, db, onAuthStateChanged } from './firebase.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const ROLE_LABELS = {
  admin: 'Administrator',
  nurse: 'RHU Nurse',
  bhw: 'BHW',
};

/* Settings is where the account profile lives, so that is where the
   chip goes. Resolved against this module's own URL so it works from
   any page's directory. */
const PROFILE_URL = new URL('../settings/settings.html', import.meta.url).href;

function initialsOf(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
}

function paint({ name, role, email }) {
  const label = ROLE_LABELS[role] || 'Staff';

  /* Settings uses navName; every other page uses navUserName. Cover
     both rather than renaming one and breaking the other. */
  [document.getElementById('navUserName'), document.getElementById('navName')]
    .forEach((el) => { if (el) el.textContent = name; });

  const roleEl = document.getElementById('navUserRole');
  if (roleEl) roleEl.textContent = label;

  const avatarEl = document.getElementById('navAvatar');
  /* Only write initials if the avatar is not already showing a photo the
     profile page put there. */
  if (avatarEl && !avatarEl.querySelector('img')) {
    avatarEl.textContent = initialsOf(name);
  }

  const chip = document.getElementById('navAvatarBtn');
  if (chip) {
    chip.setAttribute('title', name + ' — ' + label + (email ? ' · ' + email : ''));
  }
}

/* A <button> cannot be middle-clicked, opened in a new tab, or read as a
   link by a screen reader, so the chip is turned into a real anchor
   rather than given a click handler. */
function makeChipALink() {
  const chip = document.getElementById('navAvatarBtn');
  if (!chip || chip.tagName === 'A') return;

  const link = document.createElement('a');
  link.id = chip.id;
  link.className = chip.className;
  link.href = PROFILE_URL;
  link.setAttribute('title', chip.getAttribute('title') || 'Your profile');
  link.innerHTML = chip.innerHTML;
  chip.replaceWith(link);
}

makeChipALink();

onAuthStateChanged(auth, (user) => {
  if (!user) return;

  /* Live, so a name or role changed on the Personnel page updates the
     corner of every open tab rather than waiting for a reload. */
  onSnapshot(
    doc(db, 'users', user.uid),
    (snap) => {
      const profile = snap.data() || {};
      paint({
        name: profile.fullName || user.displayName || user.email || 'Signed in',
        role: profile.role,
        email: profile.email || user.email || '',
      });
    },
    (err) => {
      /* The rules reject this read until the emailed code has been
         verified. Falling back to the Auth record keeps the corner
         honest instead of leaving the placeholder in place. */
      console.error('Could not read the signed-in profile:', err);
      paint({ name: user.displayName || user.email || 'Signed in', role: null, email: user.email || '' });
    }
  );
});
