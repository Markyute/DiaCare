'use strict';
/* ================================================================
   DiaCare RHU Libon — Shared Profile
   The Account Profile form (Settings page) writes name/email/contact
   here so edits survive a refresh instead of resetting to the
   hardcoded default. Every page loads this before its own script so
   the top-nav avatar/name always reflects the last saved profile.
   ================================================================ */
const DIACARE_PROFILE_KEY = 'diacare_profile';

function loadStoredProfile() {
  try {
    const raw = localStorage.getItem(DIACARE_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStoredProfile(profile) {
  try {
    localStorage.setItem(DIACARE_PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    /* Private-browsing / quota — edit won't survive a refresh.
       Caller decides how to tell the user. */
    return false;
  }
}

function applyStoredProfile() {
  const profile = loadStoredProfile();
  if (!profile) return;

  /* Settings page uses navName/navAvatar; every other page uses
     navUserName/navAvatar — cover both without renaming either. */
  const nameEls = [
    document.getElementById('navUserName'),
    document.getElementById('navName'),
  ];
  const avatarEl = document.getElementById('navAvatar');

  nameEls.forEach(el => { if (el) el.textContent = profile.name; });
  if (avatarEl) {
    if (profile.photo) avatarEl.innerHTML = `<img src="${profile.photo}" alt="Profile" />`;
    else avatarEl.textContent = profile.initials;
  }
}

applyStoredProfile();
