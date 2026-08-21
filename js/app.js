/*
 * SBL SHARED APPLICATION BOOTSTRAP — Phase 6A
 *
 * Owns only site-wide session/UI concerns for now:
 *   - restores the authenticated session
 *   - exposes a consistent logout action
 *   - keeps the shared navigation's auth controls in sync
 *
 * Page-specific data loading remains untouched until later Phase 6 steps.
 */
(function () {
  'use strict';

  window.SBL = window.SBL || {};

  const LOGOUT_ID = 'sblLogoutButton';
  let authSubscription = null;
  let booted = false;

  function nav() {
    return document.getElementById('pageNav');
  }

  function ensureLogoutButton(session) {
    const siteNav = nav();
    if (!siteNav) return;

    let button = document.getElementById(LOGOUT_ID);

    if (!session?.user) {
      if (button) button.remove();
      return;
    }

    if (!button) {
      button = document.createElement('button');
      button.id = LOGOUT_ID;
      button.type = 'button';
      button.className = 'sbl-global-logout';
      button.textContent = 'Log out';
      button.setAttribute('aria-label', 'Log out');
      siteNav.appendChild(button);
    }

    if (button.dataset.bound !== 'true') {
      button.dataset.bound = 'true';
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        button.textContent = 'Logging out…';

        try {
          await window.SBL.auth.signOut();
          // Auth state listeners normally handle the redirect. This fallback
          // guarantees protected pages do not remain visible after sign-out.
          if ((location.pathname.split('/').pop() || 'index.html').toLowerCase() !== 'index.html') {
            location.replace('index.html');
          }
        } catch (error) {
          console.error('SBL logout failed:', error);
          button.disabled = false;
          button.textContent = 'Log out';
          window.SBL.auth?.announceError?.(error);
        }
      });
    }
  }

  async function refreshAuthUI() {
    try {
      const session = await window.SBL.auth.getSession();
      ensureLogoutButton(session);
      window.SBL.currentSession = session;
      window.SBL.currentUser = session?.user || null;
      document.documentElement.dataset.authenticated = session?.user ? 'true' : 'false';
      document.dispatchEvent(new CustomEvent('sbl:auth-ready', { detail: { session } }));
      return session;
    } catch (error) {
      console.warn('SBL auth bootstrap could not restore session:', error);
      ensureLogoutButton(null);
      return null;
    }
  }

  async function boot() {
    if (booted) return;
    booted = true;
    const start = async () => {
      // sbl-site creates the shared navigation. If it is already ready, bind
      // immediately; otherwise the event below handles it.
      await refreshAuthUI();
    };

    document.addEventListener('sbl:site-ready', () => {
      refreshAuthUI();
    }, { once: false });

    try {
      const client = window.SBL.getSupabase();
      if (client && window.SBL.auth) {
        if (!authSubscription) {
          const result = window.SBL.auth.onAuthStateChange((_event, session) => {
            window.SBL.currentSession = session || null;
            window.SBL.currentUser = session?.user || null;
            ensureLogoutButton(session);
            document.documentElement.dataset.authenticated = session?.user ? 'true' : 'false';
            document.dispatchEvent(new CustomEvent('sbl:auth-changed', {
              detail: { session: session || null }
            }));
          });
          authSubscription = result?.data?.subscription || result?.subscription || null;
        }
      }
    } catch (error) {
      console.warn('SBL auth listener unavailable:', error);
    }

    await start();
  }

  window.SBL.app = {
    boot,
    refreshAuthUI,
    getSession: () => window.SBL.auth?.getSession?.() || null,
    getUser: () => window.SBL.auth?.getUser?.() || null,
    signOut: () => window.SBL.auth?.signOut?.()
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
