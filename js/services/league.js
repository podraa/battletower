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
    const db = client || (SBL.getSupabase ? SBL.getSupabase() : null);
    if (!db) throw new Error('Supabase client is not available.');
    const { data, error } = await db.from('replays').select('replay_id,replay_data');
    if (error) throw error;
    return { data: data || [], error: null };
  }

  async function loadState(client) {
    const db = client || (SBL.getSupabase ? SBL.getSupabase() : null);
    if (!db) throw new Error('Supabase client is not available.');

    const { data, error } = await db
      .from('replays')
      .select('replay_id,replay_data')
      .eq('replay_id', STATE_ID)
      .maybeSingle();

    if (error) throw error;
    return data?.replay_data || {};
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
    const settings = getSettings(state);
    const franchises = settings.franchises;
    if (franchises && typeof franchises === 'object') {
      return Object.keys(franchises);
    }

    const teamMap = getTeamMap(state);
    return [...new Set(Object.values(teamMap).filter(Boolean))];
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
