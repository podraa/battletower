
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
  // Platform branding. League names remain data-driven and are not changed by this value.
  window.SBL_CONFIG = window.SBL_CONFIG || {};
  window.SBL_CONFIG.softwareName = window.SBL_CONFIG.softwareName || 'Battle Tower';

  /*
   * This is the only place navigation labels/order should be edited.
   * `file` is the real HTML filename.
   */
  const NAV_ITEMS = [
    { file: 'index.html',         label: 'Leagues', selectorOnly: true },
    { file: 'league.html',        label: 'My Team', leagueScoped: true },
    { file: 'stats.html',         label: 'Stats', leagueScoped: true },
    { file: 'season.html',        label: 'Season', leagueScoped: true },
    { file: 'rosters.html',       label: 'Rosters', leagueScoped: true },
    { file: 'match-prep.html',    label: 'Match Prep', leagueScoped: true },
    { file: 'free-agency.html',   label: 'Free Agency', leagueScoped: true },
    { file: 'draft.html',         label: 'Draft Room', leagueScoped: true, draftLiveOnly: true },
    { file: 'admin.html',         label: 'League Admin', leagueScoped: true, adminOnly: true },
    { file: 'admin-hub.html',     label: 'Admin Hub', siteAdminOnly: true }
  ];

  const currentFile =
    (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  const NAV_CACHE_PREFIX = 'navPerms:';
  const NAV_LAST_UID_KEY = 'navLastUid';
  const FINALS_NAV_CACHE_KEY = 'sbl_finals_nav_released';

  const isSelectorPage = currentFile === 'index.html';
  const isGlobalAdminPage = currentFile === 'admin-hub.html';
  const isLeagueContextPage = !isSelectorPage && !isGlobalAdminPage;
  const routeLeagueId = currentFile === 'league.html'
    ? String(new URLSearchParams(location.search).get('league') || '').trim()
    : '';

  function activeNavigationLeagueId() {
    // Navigation must not depend on the deferred league-db service having
    // published its API yet. The selected league is persisted in the same
    // localStorage key used by league-db, so the shared shell can resolve the
    // context deterministically during its first render as well.
    if (routeLeagueId) return routeLeagueId;

    const fromDb = SBL.leagueDb?.selectedLeagueId?.();
    if (fromDb) return fromDb;

    try {
      const stored = localStorage.getItem('sbl_selected_league_id') || '';
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored.trim())
        ? stored.trim()
        : '';
    } catch (_) {
      return '';
    }
  }

  function refreshLeagueScopedNavigation() {
    // Rebuild the shared nav after deferred services have had a chance to
    // publish the selected-league API. This is intentionally a full render:
    // every league-scoped href is derived from the same active league source.
    if (typeof renderNav === 'function') renderNav();
  }

  async function enforceSiteAdminAccess() {
    if (currentFile !== 'admin-hub.html') return true;
    const db = getClient();
    if (!db) return false;
    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session?.user || !SBL.siteAdmin?.isSiteAdmin) {
        location.replace('index.html');
        return false;
      }
      const allowed = await SBL.siteAdmin.isSiteAdmin(session.user.id);
      if (!allowed) location.replace('index.html');
      return allowed;
    } catch (e) {
      console.warn('SBL site-admin access check failed.', e);
      location.replace('index.html');
      return false;
    }
  }

  async function enforceLeagueMembership() {
    if (isSelectorPage || isGlobalAdminPage) return;
    const db = getClient();
    if (!db) return;
    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session?.user) return;
      if(SBL.leagueDb?.isAvailable && await SBL.leagueDb.isAvailable(db)){
        const selectedId=activeNavigationLeagueId();
        const league=selectedId ? await SBL.leagueDb.getLeague(selectedId,db) : null;
        if(!league){ location.replace('index.html'); return; }
        const profileResult=await db.from('profiles').select('id,is_commissioner').eq('id',session.user.id).maybeSingle();
        const platformCommissioner=!!profileResult?.data?.is_commissioner;
        const member=await SBL.leagueDb.getMembership(selectedId,session.user.id,db);
        const active=String(member?.status||'').toLowerCase()==='active';
        const leagueAdmin=['commissioner','manager'].includes(String(member?.role||'').toLowerCase()) && active;
        // League Admin is a privileged page: an active player is allowed into
        // the normal league workspace, but only a league manager/commissioner
        // (or platform commissioner) may enter admin.html.
        const allowed=currentFile==='admin.html'
          ? (platformCommissioner || leagueAdmin)
          : (active || platformCommissioner);
        if(!allowed) location.replace('index.html');
        return;
      }
      // Normalized league membership is authoritative. Do not fall back to the
      // legacy __dashboard_state__ record: failure to resolve normalized state
      // must not silently authorize from potentially stale/wrong-scope data.
      location.replace('index.html');
      return;
    } catch (e) {
      console.warn('SBL league membership check failed.', e);
      location.replace('index.html');
      return false;
    }
  }

  function getClient() {
    try {
      return window.SBL?.getSupabase?.() || null;
    } catch (e) {
      console.warn('SBL navigation: Supabase client unavailable.', e);
      return null;
    }
  }

  /*
   * Site-admin visibility belongs to the shared shell, not to a particular
   * page. Some pages intentionally do not load the Admin Hub controller, so
   * the shell keeps a small authorization fallback here. The dedicated
   * site-admin service, when loaded, provides the same RPC-backed check.
   */
  function ensureSiteAdminService() {
    SBL.siteAdmin = SBL.siteAdmin || {};
    if (typeof SBL.siteAdmin.isSiteAdmin === 'function') return;
    SBL.siteAdmin.isSiteAdmin = async function (userId) {
      const db = getClient();
      if (!db || !userId) return false;
      const { data, error } = await db.rpc('sbl_is_site_admin', { target_user: userId });
      if (error) throw error;
      return data === true;
    };
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
      let href = item.file;
      if (item.file === 'league.html' && item.leagueScoped) {
        const leagueId = activeNavigationLeagueId();
        if (leagueId) href = `league.html?league=${encodeURIComponent(leagueId)}`;
      }
      link.href = href;
      link.dataset.page = item.file;
      link.textContent = item.label;

      if (item.adminOnly) {
        link.dataset.adminOnly = 'true';
        link.hidden = true;
      }

      if (item.siteAdminOnly) {
        link.dataset.siteAdminOnly = 'true';
        link.hidden = true;
      }

      if (item.draftLiveOnly) {
        link.dataset.draftLiveOnly = 'true';
        link.hidden = true;
      }

      if (item.leagueScoped) {
        link.dataset.leagueScoped = 'true';
        if (!isLeagueContextPage) {
          link.hidden = true;
        }
      }

      if (item.selectorOnly && !isSelectorPage) {
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

    // Theme-aware page transitions. Glitch gets a short RGB-split/static
    // transition; other themes keep normal instant navigation.
    if (!nav.dataset.sblTransitionInstalled) {
      nav.dataset.sblTransitionInstalled = 'true';
      nav.addEventListener('click', function (event) {
        const link = event.target.closest('a[href]');
        if (!link) return;
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const href = link.getAttribute('href') || '';
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
        if (link.target && link.target !== '_self') return;
        let target;
        try { target = new URL(href, location.href); } catch (_) { return; }
        if (target.origin !== location.origin) return;
        const theme = document.documentElement.dataset.sblTheme || '';
        if (theme !== 'glitch') return;
        event.preventDefault();
        document.body.classList.add('sbl-glitch-transition-out');
        window.setTimeout(() => { location.href = target.href; }, 185);
      });
    }

    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    function hasOpenPopup() {
      const selectors = [
        '[role=\"dialog\"]',
        '.modal',
        '.pokemon-overlay',
        '.audit-overlay',
        '.damage-calc-modal',
        '.showdown-import-overlay',
        '.prep-detail-modal',
        '.luck-modal',
        '[data-popup=\"true\"]'
      ];
      return selectors.some(selector => Array.from(document.querySelectorAll(selector)).some(isVisible));
    }

    function syncNavVisibility() {
      const popupOpen = hasOpenPopup();
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      nav.classList.toggle('nav-hidden', popupOpen || y > 140);
    }

    function updateForScroll() {
      syncNavVisibility();
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateForScroll);
      }
    }, { passive: true });

    nav.addEventListener('mouseenter', () => {
      if (!hasOpenPopup()) nav.classList.remove('nav-hidden');
    });

    hover.addEventListener('mouseenter', () => {
      if (!hasOpenPopup()) nav.classList.remove('nav-hidden');
    });

    document.addEventListener('mousemove', e => {
      if (e.clientY <= 12 && !hasOpenPopup()) nav.classList.remove('nav-hidden');
    }, { passive: true });

    // Any popup can be created by page-specific code. Watch the DOM so the
    // shared navigation hides immediately when a dialog/overlay appears,
    // without requiring each page to know about the nav implementation.
    const popupObserver = new MutationObserver(() => syncNavVisibility());
    popupObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });

    // Clicking inside an open popup should keep the navigation hidden even
    // if the popup is positioned below the nav or the nav was previously open.
    document.addEventListener('click', e => {
      if (e.target?.closest?.('[role=\"dialog\"], .modal, .pokemon-overlay, .audit-overlay, .damage-calc-modal, .showdown-import-overlay, .prep-detail-modal, [data-popup=\"true\"]')) {
        nav.classList.add('nav-hidden');
      }
    }, true);

    syncNavVisibility();
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
    hideLeagueScopedLinks();
    hideAdminLink();
    hideSiteAdminLink();
    hideDraftLink();
  }

  function hideLeagueScopedLinks() {
    const nav = getNav();
    if (!nav) return;
    nav.querySelectorAll('[data-league-scoped]').forEach(link => {
      link.hidden = true;
    });
  }

  function showLeagueScopedLinks() {
    const nav = getNav();
    if (!nav) return;
    nav.querySelectorAll('[data-league-scoped]:not([data-draft-live-only]):not([data-admin-only]):not([data-site-admin-only])').forEach(link => {
      link.hidden = false;
    });
  }

  function hideAdminLink() {
    const nav = getNav();
    if (!nav) return;
    nav.querySelectorAll('[data-admin-only]').forEach(link => {
      link.hidden = true;
    });
  }

  function hideSiteAdminLink() {
    const nav = getNav();
    if (!nav) return;
    nav.querySelectorAll('[data-site-admin-only]').forEach(link => {
      link.hidden = true;
    });
  }

  function showSiteAdminLink() {
    const nav = getNav();
    if (!nav) return;
    nav.querySelectorAll('[data-site-admin-only]').forEach(link => {
      link.hidden = false;
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
    // League-specific navigation permissions do not apply on the league
    // selector or global Admin Hub. A previously selected league in
    // localStorage must never make its privileged links appear here.
    if (isSelectorPage || isGlobalAdminPage) {
      hidePrivilegedLinks();
      return;
    }
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

      // League-specific navigation is available only when the current page
      // has a real, resolved league context. The global selector/Admin Hub
      // were handled above and never reach this branch.
      let hasLeagueContext = false;
      try {
        if (SBL.leagueDb?.isAvailable && await SBL.leagueDb.isAvailable(client)) {
          const selectedId = activeNavigationLeagueId();
          const league = selectedId ? await SBL.leagueDb.getLeague(selectedId, client) : null;
          hasLeagueContext = !!league && isLeagueContextPage;
        }
      } catch (leagueContextError) {
        console.warn('SBL navigation: league context check failed.', leagueContextError);
      }
      if (hasLeagueContext) showLeagueScopedLinks();
      else hideLeagueScopedLinks();

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
          isSiteAdmin: false,
          draftLive: false
        };
      }

      let leagueAdmin = false;
      let leagueAdminLeagueId = '';
      let leagueAdminMember = null;
      try {
        if(SBL.leagueDb?.isAvailable && await SBL.leagueDb.isAvailable(client)){
          const id=activeNavigationLeagueId();
          leagueAdminLeagueId = id || '';
          leagueAdminMember = id ? await SBL.leagueDb.getMembership(id,session.user.id,client) : null;
          leagueAdmin=['commissioner','manager'].includes(String(leagueAdminMember?.role||'').toLowerCase()) && String(leagueAdminMember?.status||'').toLowerCase()==='active';
        }
      } catch (leagueAdminError) {
        console.warn('SBL navigation: league-admin permission check failed.', leagueAdminError);
      }
      console.debug('SBL navigation permission context:', {
        currentFile,
        selectedLeagueId: leagueAdminLeagueId,
        isCommissioner: !!permissions.isCommissioner,
        leagueAdmin,
        memberRole: leagueAdminMember?.role ?? null,
        memberStatus: leagueAdminMember?.status ?? null
      });
      let siteAdmin = !!permissions.isSiteAdmin;
      try {
        if (SBL.siteAdmin?.isSiteAdmin) siteAdmin = await SBL.siteAdmin.isSiteAdmin(session.user.id);
      } catch (siteAdminError) {
        console.warn('SBL navigation: site-admin permission check failed.', siteAdminError);
      }
      permissions.isSiteAdmin = siteAdmin;
      if (permissions.isCommissioner || leagueAdmin) showAdminLink();
      if (permissions.isSiteAdmin) showSiteAdminLink();

      /*
       * Draft Room is intentionally independent of commissioner status:
       * any logged-in team owner sees it while the Draft Room lobby is open or the draft is live.
       */
      try {
        let draftStatus='';
        if(SBL.leagueDb?.isAvailable && await SBL.leagueDb.isAvailable(client)){
          const snap=await SBL.leagueDb.getSnapshot(activeNavigationLeagueId(),client);
          draftStatus=snap?.state?.settings?.draft?.status||'';
        }
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

  async function refreshSeasonNavLabel() {
    const nav = getNav();
    if (!nav) return;
    if (isSelectorPage || isGlobalAdminPage) {
      const seasonLink = nav.querySelector('a[data-page="season.html"]');
      if (seasonLink) {
        seasonLink.textContent = 'Season';
        seasonLink.dataset.sblFinalsReleased = 'false';
      }
      return;
    }
    const seasonLink = nav.querySelector('a[data-page="season.html"]');
    if (!seasonLink) return;

    // On the Season page, also prime the page heading from the cached state.
    // The page controller will replace this with the full season-specific title
    // once the shared state has loaded.
    if (currentFile === 'season.html' && localStorage.getItem(FINALS_NAV_CACHE_KEY) === '1') {
      const titleEl = document.getElementById('seasonTitle');
      if (titleEl) titleEl.textContent = 'SBL Finals';
      const subEl = document.querySelector('#app > header .sub');
      if (subEl) subEl.textContent = 'Season Finals · single elimination';
    }

    // Use the last known Finals state immediately so the navigation does not
    // briefly flash back to "Season" while the shared state request is loading.
    let finalsReleased = localStorage.getItem(FINALS_NAV_CACHE_KEY) === '1';
    try {
      const client = getClient();
      if (client) {
        let finals=null, error=null;
        if(SBL.leagueDb?.isAvailable && await SBL.leagueDb.isAvailable(client)){
          const snap=await SBL.leagueDb.getSnapshot(activeNavigationLeagueId(),client);
          finals=snap?.state?.settings?.finals||null;
        }
        if (!error) {
          finalsReleased = !!(finals && finals.status !== 'inactive' && Array.isArray(finals.rounds) && finals.rounds.length);
          localStorage.setItem(FINALS_NAV_CACHE_KEY, finalsReleased ? '1' : '0');
        }
      }
    } catch (error) {
      console.warn('SBL navigation: finals label check failed.', error);
    }

    seasonLink.textContent = finalsReleased ? 'Finals' : 'Season';
    seasonLink.dataset.sblFinalsReleased = finalsReleased ? 'true' : 'false';
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

  SBL.ui.refreshSeasonNavLabel = refreshSeasonNavLabel;

  function boot() {
    ensureSiteAdminService();
    const nav = renderNav();
    refreshSeasonNavLabel();

    // Page boundaries now define navigation context explicitly: index.html is the
    // league selector, league.html and the other workspace pages are league-scoped,
    // and admin-hub.html is global. No context MutationObserver is required.

    /*
     * Restore the last-known permission state immediately. This prevents the
     * admin/draft buttons from flashing in and out during auth resolution.
     */
    const lastUid = readLastUid();

    const leagueContextPage = isLeagueContextPage;
    if (lastUid) {
      const cached = readNavCache(lastUid);
      if (cached) {
        lockNav(false);
        // Cached league permissions are never restored on the league selector
        // or global Admin Hub. Those pages have no active league context.
        if (leagueContextPage && cached.isCommissioner) showAdminLink();
        if (cached.isSiteAdmin) showSiteAdminLink();
        if (leagueContextPage && cached.draftLive) showDraftLink();
      } else {
        hidePrivilegedLinks();
      }
    } else {
      hidePrivilegedLinks();
    }

    const client = getClient();

    document.addEventListener('sbl:league-selection-changed', () => {
      refreshLeagueScopedNavigation();
    });

    // The shared shell can execute before the deferred Supabase/auth scripts on
    // some pages. In that case the old implementation permanently hid the
    // privileged links. Re-run permission setup once the auth bootstrap is ready.
    document.addEventListener('sbl:auth-ready', () => {
      const readyClient = getClient();
      if (readyClient) setupPermissions(readyClient);
      refreshSeasonNavLabel();
    }, { once: false });

    document.addEventListener('sbl:auth-changed', () => {
      const readyClient = getClient();
      if (readyClient) setupPermissions(readyClient);
      refreshSeasonNavLabel();
    }, { once: false });

    if (client) {
      setupPermissions(client);
      enforceSiteAdminAccess();
      enforceLeagueMembership();

      client.auth.onAuthStateChange((event, session) => {
        if (session?.user) lockNav(false);

        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
          clearNavCache();
        }

        if (session?.user) setupPermissions(client);
        else hidePrivilegedLinks();
        refreshSeasonNavLabel();
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
      setSiteAdminVisible: visible => {
        if (visible) showSiteAdminLink();
        else hideSiteAdminLink();
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

  document.addEventListener('DOMContentLoaded', boot, { once: true });

})();
