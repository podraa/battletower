/*
 * SBL FREE AGENCY SERVICE
 *
 * Phase 4C: read-only abstraction over the existing Free Agency data stored
 * inside the __dashboard_state__ record. No database/schema changes.
 *
 * The service deliberately returns plain data and leaves rendering, filters,
 * Pokémon lookups and access control to the page.
 */
(function () {
  'use strict';

  window.SBL = window.SBL || {};
  const SBL = window.SBL;

  function normalizePool(pool) {
    if (!Array.isArray(pool)) return [];
    return pool.map(item => {
      if (typeof item === 'string') return { name: SBL.pokemon?.displayNameWithForm ? SBL.pokemon.displayNameWithForm(item) : (SBL.pokemon?.displayNameWithForm ? SBL.pokemon.displayNameWithForm(item) : (SBL.pokemon?.displayName ? SBL.pokemon.displayName(item) : item)), points: null };
      return {
        ...item,
        name: SBL.pokemon?.displayNameWithForm ? SBL.pokemon.displayNameWithForm(item?.name ?? item?.species ?? '') : (SBL.pokemon?.displayName ? SBL.pokemon.displayName(item?.name ?? item?.species ?? '') : String(item?.name ?? item?.species ?? '').trim()),
        points: item?.points == null || item?.points === '' ? null : Number(item.points)
      };
    }).filter(item => item.name);
  }

  function normalizeRosters(rosters) {
    const out = {};
    for (const [team, list] of Object.entries(rosters || {})) {
      if (!Array.isArray(list)) continue;
      out[team] = list.map(item => typeof item === 'string'
        ? { name: SBL.pokemon?.displayNameWithForm ? SBL.pokemon.displayNameWithForm(item) : (SBL.pokemon?.displayNameWithForm ? SBL.pokemon.displayNameWithForm(item) : (SBL.pokemon?.displayName ? SBL.pokemon.displayName(item) : item)), points: null }
        : { name: SBL.pokemon?.displayNameWithForm ? SBL.pokemon.displayNameWithForm(item?.name ?? item?.species ?? '') : (SBL.pokemon?.displayName ? SBL.pokemon.displayName(item?.name ?? item?.species ?? '') : String(item?.name ?? item?.species ?? '').trim()), points: item?.points ?? null }
      ).filter(item => item.name);
    }
    return out;
  }

  function selectedSnapshot(state, requestedSeason) {
    if (SBL.seasons?.getSnapshot) {
      const snapshot = SBL.seasons.getSnapshot(state, requestedSeason);
      return snapshot || { settings: {}, archived: false, key: '', name: '' };
    }

    const settings = state?.settings || {};
    const archives = settings.seasonArchives || {};
    const requested = requestedSeason || new URLSearchParams(location.search).get('season');
    if (requested && archives[requested]) {
      const archive = archives[requested];
      return {
        name: archive.name || requested,
        key: requested,
        settings: archive.settings || {},
        archived: true,
        archives
      };
    }
    return {
      name: settings.activeSeason || 'Season 15',
      key: '',
      settings,
      archived: false,
      archives
    };
  }

  async function load(client, requestedSeason) {
    const db = client || SBL.getSupabase();
    const leagueId = SBL.leagueDb?.selectedLeagueId?.() || '';
    let snapshot = null;
    let dashboard = {};
    if (leagueId && SBL.seasons?.loadSnapshot) {
      snapshot = await SBL.seasons.loadSnapshot({ leagueId, season: requestedSeason || undefined });
      dashboard = { teamMap: snapshot?.teamMap || {}, settings: snapshot?.settings || {} };
    } else if (SBL.league?.loadRows) {
      const { data: rows } = await SBL.league.loadRows(db);
      dashboard = (rows || []).find(r => r.replay_id === '__dashboard_state__')?.replay_data || {};
    }

    const state = snapshot ? dashboard : dashboard;
    const selected = snapshot || selectedSnapshot(state, requestedSeason);
    const settings = selected?.settings || {};
    let rosters = normalizeRosters(settings.rosters || {});

    if (!Object.keys(rosters).length && leagueId) {
      const { data: row } = await db.from('league_replays').select('replay_id,replay_data').eq('league_id',leagueId).eq('replay_id','__rosters__').maybeSingle();
      rosters = normalizeRosters(row?.replay_data?.rosters || {});
    }

    let pool = normalizePool(settings.freeAgency?.mons);
    if (!selected?.archived && SBL.trades?.load) {
      const {data: tradeRows} = await SBL.trades.load(db);
      const rawRosters = rosters;
      rosters = SBL.trades.getEffectiveRosters(rawRosters, tradeRows || []);
      pool = SBL.trades.restoreFutureFreeAgencyPool(pool, rawRosters, tradeRows || []);
    }

    return { state: dashboard, snapshot: selected, settings, pool, rosters };
  }

  function getPool(settingsOrState) {
    const settings = settingsOrState?.settings || settingsOrState || {};
    return normalizePool(settings.freeAgency?.mons);
  }

  function getPointValues(pool) {
    return [...new Set(normalizePool(pool).map(item => Number(item.points)).filter(Number.isFinite))]
      .sort((a, b) => a - b);
  }

  SBL.freeAgency = {
    normalizePool,
    normalizeRosters,
    load,
    getPool,
    getPointValues
  };
})();
