/*
 * SBL LEAGUE STATE SERVICE
 *
 * Phase 4B: read-only abstraction over the existing __dashboard_state__
 * record. No database/schema changes are made here.
 *
 * The service deliberately accepts an existing Supabase client so pages can
 * migrate without changing their working startup/authentication order.
 */
(function () {
  'use strict';

  window.SBL = window.SBL || {};
  const SBL = window.SBL;
  const STATE_ID = '__dashboard_state__';

  async function loadRows(client) {
    if(!SBL.replays?.load)throw new Error('Replay service unavailable; cannot load legacy table.');
    return SBL.replays.load(client);
  }

  async function loadState(client) {
    // CP4.167: a league's current-season state is loaded ONLY through the
    // canonical league+season replay service. Reading the old "replays"
    // __dashboard_state__ record here silently returned the wrong tenant or
    // season when called by newer consumers.
    if(!SBL.replays?.load || !SBL.replays?.partition)
      throw new Error('Replay state service unavailable; cannot read legacy state directly.');
    const result=await SBL.replays.load(client);
    if(result?.error)throw result.error;
    return SBL.replays.partition(result?.data||[]).sharedState||{};
  }

  function getTeamMap(state) {
    return state?.teamMap && typeof state.teamMap === 'object'
      ? state.teamMap
      : {};
  }

  function getSettings(state) {
    return state?.settings && typeof state.settings === 'object'
      ? state.settings
      : {};
  }

  function getTeams(state) {
    // Synchronous legacy helper: return only explicitly configured franchise
    // definitions. Never infer current franchises from replay username maps;
    // current ownership is resolved asynchronously by franchiseOwnership.
    const settings = getSettings(state);
    const franchises = settings.franchises;
    if (franchises && typeof franchises === 'object') return Object.keys(franchises).filter(Boolean);
    const definitions = settings.franchiseDefinitions;
    if (definitions && typeof definitions === 'object') return Object.keys(definitions).filter(Boolean);
    return [];
  }

  function getActiveSeason(state) {
    return SBL.seasons?.getActive
      ? SBL.seasons.getActive(state)
      : getSettings(state).activeSeason || 'Season 15';
  }

  function getSeasonArchives(state) {
    return SBL.seasons?.getArchive
      ? SBL.seasons.getArchive(state)
      : (getSettings(state).seasonArchives || {});
  }

  function getLeagueUpdates(state) {
    const updates = getSettings(state).leagueUpdates;
    return Array.isArray(updates) ? updates : [];
  }

  function getFixture(state) {
    return getSettings(state).fixture || null;
  }

  function getRosters(state) {
    const rosters = getSettings(state).rosters;
    return rosters && typeof rosters === 'object' ? rosters : {};
  }

  SBL.league = {
    STATE_ID,
    loadRows,
    loadState,
    getState: loadState,
    getTeamMap,
    getSettings,
    getTeams,
    getActiveSeason,
    getSeasonArchives,
    getLeagueUpdates,
    getFixture,
    getRosters
  };
})();
