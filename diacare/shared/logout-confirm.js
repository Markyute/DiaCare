/* ================================================================
   DiaCare RHU Libon — Logout Confirmation
   Every page links "Logout" straight to login.html — a misclick (or
   an accidental tap on the mobile nav) used to sign the user out
   immediately. This intercepts every such link, injects a shared
   confirm modal (same are-you-sure pattern used for Approve/Reject/
   Deactivate), and only signs out and navigates to login.html once the
   user actually confirms.
   ================================================================ */

import { auth, signOut } from './firebase.js';
import { endSession } from './api.js';

(function () {
  const logoutLinks = document.querySelectorAll('a[href$="login/login.html"]');
  if (!logoutLinks.length) return;

  const targetHref = logoutLinks[0].getAttribute('href');

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay hidden" id="logoutConfirmModal">
      <div class="modal-card modal-card--sm">
        <div class="modal-hdr">
          <div class="modal-title">Logout?</div>
          <button class="modal-close" id="logoutConfirmClose" aria-label="Close modal" title="Close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="modal-body text-center">
          <div class="confirm-icon"><i class="fa-solid fa-right-from-bracket"></i></div>
          <p class="confirm-text">Are you sure you want to log out?</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="logoutConfirmCancel">Cancel</button>
          <button class="btn btn-danger" id="logoutConfirmOk">
            <i class="fa-solid fa-right-from-bracket"></i> Logout
          </button>
        </div>
      </div>
    </div>`);

  const modal = document.getElementById('logoutConfirmModal');

  function openLogoutConfirm(e) {
    e.preventDefault();
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeLogoutConfirm() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  logoutLinks.forEach(link => link.addEventListener('click', openLogoutConfirm));

  document.getElementById('logoutConfirmClose')?.addEventListener('click', closeLogoutConfirm);
  document.getElementById('logoutConfirmCancel')?.addEventListener('click', closeLogoutConfirm);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeLogoutConfirm();
  });
  document.getElementById('logoutConfirmOk')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;

    /* Signing out locally only clears this browser. endSession() drops
       the verified-code claims and revokes the refresh token server-side,
       so a token copied out of this session stops working too. If the
       call fails (offline), still sign out locally rather than leaving
       the user on a page they think they left. */
    await endSession().catch(() => {});
    await signOut(auth).catch(() => {});

    window.location.href = targetHref;
  });
})();
