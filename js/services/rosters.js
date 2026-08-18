
/*
 * SBL ROSTER SERVICE
 *
 * Reads the existing __rosters__ dashboard-state record. No database schema
 * changes are made here. The service normalizes the response so pages can
 * consume the same shape without duplicating Supabase queries.
 */
(function () {
  'use strict';

  window.SBL = window.SBL || {};
  window.SBL.services = window.SBL.services || {};

  const CACHE_TTL = 15000;
  let memory = null;
  let memoryAt = 0;
  let request = null;

  function client() {
    return window.SBL.getSupabase();
  }

  function unwrap(raw) {
    if (!raw) return null;

    // Existing dashboard state may be stored directly in replay_data or under
    // a state/data wrapper depending on which writer produced it.
    const value = raw.replay_data ?? raw.data ?? raw;

    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (e) {}
    }

    return value || null;
  }

  async function load(options = {}) {
    const force = !!options.force;
    const now = Date.now();

    if (!force && memory && (now - memoryAt) < CACHE_TTL) {
      return memory;
    }

    if (!force && request) return request;

    request = (async () => {
      const { data, error } = await client()
        .from('replays')
        .select('replay_id,replay_data')
        .eq('replay_id', '__rosters__')
        .maybeSingle();

      if (error) throw error;

      const state = unwrap(data?.replay_data ?? data);

      // Preserve the existing roster-state object exactly when possible.
      memory = state || {};
      memoryAt = Date.now();

      return memory;
    })();

    try {
      return await request;
    } finally {
      request = null;
    }
  }

  async function getAll(options = {}) {
    const state = await load(options);

    // Current files use a team-keyed roster object. If the state is wrapped,
    // unwrap the common wrappers without changing the underlying records.
    if (state?.rosters && typeof state.rosters === 'object') return state.rosters;
    if (state?.teams && typeof state.teams === 'object') return state.teams;

    return state || {};
  }

  async function getTeam(teamName, options = {}) {
    if (!teamName) return null;

    const all = await getAll(options);

    if (all[teamName]) return all[teamName];

    const target = String(teamName).trim().toLowerCase();
    const key = Object.keys(all).find(
      k => String(k).trim().toLowerCase() === target
    );

    return key ? all[key] : null;
  }

  async function getPokemon(teamName, options = {}) {
    const roster = await getTeam(teamName, options);
    if (!roster) return [];

    if (Array.isArray(roster)) return roster;
    if (Array.isArray(roster.pokemon)) return roster.pokemon;
    if (Array.isArray(roster.roster)) return roster.roster;
    if (Array.isArray(roster.members)) return roster.members;

    return [];
  }

  function clearCache() {
    memory = null;
    memoryAt = 0;
    request = null;
  }

  window.SBL.services.rosters = {
    load,
    getAll,
    getTeam,
    getPokemon,
    clearCache
  };
})();
