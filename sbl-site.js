
/*
 * SBL SHARED SITE SHELL
 *
 * This file owns:
 *   - the site-wide navigation
 *   - current-page highlighting
 *   - commissioner/admin visibility
 *   - live-draft visibility
 *   - shared auto-hide navigation behavior
 *
 * Page-specific application code remains in each HTML file.
 */
(function () {
  'use strict';

  // The shared site shell loads before page-specific controllers, so it must
  // establish the global namespace itself rather than relying on app.js.
  window.SBL = window.SBL || {};

  /*
   * This is the only place navigation labels/order should be edited.
   * `file` is the real HTML filename.
   */
  const NAV_ITEMS = [
    { file: 'index.html',         label: 'My Team' },
    { file: 'stats.html',         label: 'Stats' },
    { file: 'season.html',        label: 'Season' },
    { file: 'rosters.html',       label: 'Rosters' },
    { file: 'match-prep.html', label: 'Match Prep' },
    { file: 'free-agency.html',   label: 'Free Agency' },
    { file: 'draft.html',         label: 'Draft Room', draftLiveOnly: true },
    { file: 'admin.html',         label: 'Admin Dashboard', adminOnly: true }
  ];

  const currentFile =
    (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  const NAV_CACHE_PREFIX = 'navPerms:';
  const NAV_LAST_UID_KEY = 'navLastUid';

  function getClient() {
    try {
      return window.SBL?.getSupabase?.() || null;
    } catch (e) {
      console.warn('SBL navigation: Supabase client unavailable.', e);
      return null;
    }
  }

  function getNav() {
    return document.getElementById('pageNav');
  }

  function renderNav() {
    let nav = getNav();

    if (!nav) {
      nav = document.createElement('nav');
      nav.id = 'pageNav';
      nav.className = 'page-nav';
      nav.setAttribute('aria-label', 'Site navigation');

      const app = document.getElementById('app');
      if (app) document.body.insertBefore(nav, app);
      else document.body.insertBefore(nav, document.body.firstChild);
    }

    nav.innerHTML = '';

    NAV_ITEMS.forEach(item => {
      const link = document.createElement('a');
      link.href = item.file;
      link.dataset.page = item.file;
      link.textContent = item.label;

      if (item.adminOnly) {
        link.dataset.adminOnly = 'true';
        link.hidden = true;
      }

      if (item.draftLiveOnly) {
        link.dataset.draftLiveOnly = 'true';
        link.hidden = true;
      }

      if (item.file.toLowerCase() === currentFile) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }

      nav.appendChild(link);
    });

    let hover = document.getElementById('navHoverZone');
    if (!hover) {
      hover = document.createElement('div');
      hover.id = 'navHoverZone';
      hover.className = 'nav-hover-zone';
      hover.setAttribute('aria-hidden', 'true');
      document.body.appendChild(hover);
    }

    installNavigationBehavior(nav, hover);
    return nav;
  }

  function installNavigationBehavior(nav, hover) {
    if (nav.dataset.sblBehaviorInstalled === 'true') return;
    nav.dataset.sblBehaviorInstalled = 'true';

    let ticking = false;

    function updateForScroll() {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      nav.classList.toggle('nav-hidden', y > 140);
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateForScroll);
      }
    }, { passive: true });

    nav.addEventListener('mouseenter', () => nav.classList.remove('nav-hidden'));

    hover.addEventListener('mouseenter', () => nav.classList.remove('nav-hidden'));

    document.addEventListener('mousemove', e => {
      if (e.clientY <= 12) nav.classList.remove('nav-hidden');
    }, { passive: true });

    nav.classList.remove('nav-hidden');
  }

  function lockNav(locked) {
    const nav = getNav();
    if (!nav) return;

    nav.classList.toggle('locked', !!locked);

    nav.querySelectorAll('a[data-page]').forEach(link => {
      link.setAttribute('aria-disabled', locked ? 'true' : 'false');
      if (locked) link.title = 'Log in to switch pages';
      else link.removeAttribute('title');
    });
  }

  function hidePrivilegedLinks() {
    hideAdminLink();
    hideDraftLink();
  }

  function hideAdminLink() {
    const nav = getNav();
    if (!nav) return;
    nav.querySelectorAll('[data-admin-only]').forEach(link => {
      link.hidden = true;
    });
  }

  function hideDraftLink() {
    const nav = getNav();
    if (!nav) return;
    nav.querySelectorAll('[data-draft-live-only]').forEach(link => {
      link.hidden = true;
    });
  }

  function showAdminLink() {
    const nav = getNav();
    if (!nav) return;
    nav.querySelectorAll('[data-admin-only]').forEach(link => {
      link.hidden = false;
    });
  }

  function showDraftLink() {
    const nav = getNav();
    if (!nav) return;
    nav.querySelectorAll('[data-draft-live-only]').forEach(link => {
      link.hidden = false;
    });
  }

  function readNavCache(uid) {
    try {
      const raw = sessionStorage.getItem(NAV_CACHE_PREFIX + uid);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeNavCache(uid, permissions) {
    try {
      sessionStorage.setItem(
        NAV_CACHE_PREFIX + uid,
        JSON.stringify(permissions)
      );
    } catch (e) {}
  }

  function readLastUid() {
    try {
      return sessionStorage.getItem(NAV_LAST_UID_KEY);
    } catch (e) {
      return null;
    }
  }

  function writeLastUid(uid) {
    try {
      sessionStorage.setItem(NAV_LAST_UID_KEY, uid);
    } catch (e) {}
  }

  function clearNavCache() {
    try {
      Object.keys(sessionStorage).forEach(key => {
        if (key.indexOf(NAV_CACHE_PREFIX) === 0) {
          sessionStorage.removeItem(key);
        }
      });
      sessionStorage.removeItem(NAV_LAST_UID_KEY);
    } catch (e) {}
  }

  async function setupPermissions(client) {
    if (!client) {
      hidePrivilegedLinks();
      return;
    }

    try {
      const { data: { session } } = await client.auth.getSession();

      // Page navigation is always available. Authentication only controls
      // privileged links/actions; it must never make the site navigation
      // appear logged-out to an already usable page.
      if (!session?.user) {
        hidePrivilegedLinks();
        return;
      }

      lockNav(false);
      writeLastUid(session.user.id);

      let permissions = readNavCache(session.user.id);

      if (!permissions) {
        const { data: profile, error } = await client
          .from('profiles')
          .select('is_commissioner')
          .eq('id', session.user.id)
          .maybeSingle();

        if (error) throw error;

        permissions = {
          isCommissioner: !!profile?.is_commissioner,
          draftLive: false
        };
      }

      if (permissions.isCommissioner) showAdminLink();

      /*
       * Draft Room is intentionally independent of commissioner status:
       * any logged-in team owner sees it while the Draft Room lobby is open or the draft is live.
       */
      try {
        const { data: stateRow } = await client
          .from('replays')
          .select('replay_data')
          .eq('replay_id', '__dashboard_state__')
          .maybeSingle();

        const draftStatus = stateRow?.replay_data?.settings?.draft?.status;
        // The Draft Room must become visible as soon as the commissioner
        // opens the lobby, not only after the first pick/start action.
        permissions.draftLive = draftStatus === 'lobby' || draftStatus === 'live';
      } catch (draftError) {
        console.warn('SBL navigation: draft status check failed.', draftError);
      }

      if (permissions.draftLive) showDraftLink();

      writeNavCache(session.user.id, permissions);
    } catch (error) {
      console.warn('SBL navigation permission check failed:', error);
      hidePrivilegedLinks();
    }
  }

  function setActive(file) {
    const target = String(file || '').toLowerCase();
    const nav = getNav();
    if (!nav) return;
    nav.querySelectorAll('a[data-page]').forEach(link => {
      const active = String(link.dataset.page || '').toLowerCase() === target;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function go(file) {
    if (!file) return;
    location.href = String(file);
  }

  // Shared UI primitives used by page controllers. Define these before the
  // site-ready event can fire so every page listener sees a complete SBL.ui API.
  SBL.ui = SBL.ui || {};
  SBL.ui.qs = (selector, root = document) => root?.querySelector?.(selector) || null;
  SBL.ui.qsa = (selector, root = document) => Array.from(root?.querySelectorAll?.(selector) || []);
  SBL.ui.on = (target, event, handler, options) => {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(event, handler, options);
    return () => target.removeEventListener(event, handler, options);
  };
  SBL.ui.replace = (target, html) => {
    const node = typeof target === 'string' ? SBL.ui.qs(target) : target;
    if (!node) return false;
    node.innerHTML = html;
    return true;
  };

  function boot() {
    const nav = renderNav();

    /*
     * Restore the last-known permission state immediately. This prevents the
     * admin/draft buttons from flashing in and out during auth resolution.
     */
    const lastUid = readLastUid();

    if (lastUid) {
      const cached = readNavCache(lastUid);
      if (cached) {
        lockNav(false);
        if (cached.isCommissioner) showAdminLink();
        if (cached.draftLive) showDraftLink();
      } else {
        hidePrivilegedLinks();
      }
    } else {
      hidePrivilegedLinks();
    }

    const client = getClient();

    if (client) {
      setupPermissions(client);

      client.auth.onAuthStateChange((event, session) => {
        if (session?.user) lockNav(false);

        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
          clearNavCache();
        }

        if (session?.user) setupPermissions(client);
        else hidePrivilegedLinks();
      });
    } else {
      hidePrivilegedLinks();
    }

    window.SBL_SITE = window.SBL_SITE || {};
    window.SBL_SITE.navigation = {
      items: NAV_ITEMS.map(item => ({ ...item })),
      currentFile,
      refresh: renderNav,
      setAdminVisible: visible => {
        if (visible) showAdminLink();
        else hideAdminLink();
      },
      setDraftVisible: visible => {
        if (visible) showDraftLink();
        else hideDraftLink();
      },
      setActive,
      go
    };

    document.dispatchEvent(new CustomEvent('sbl:site-ready'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

})();
