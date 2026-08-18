/*
 * SBL SHARED SEASONS SERVICE
 *
 * Phase 4A: centralises the interpretation of the existing season data
 * stored inside __dashboard_state__. No database/schema changes are made.
 */
(function () {
  'use strict';

  window.SBL = window.SBL || {};
  const SBL = window.SBL;
  const DEFAULT_SEASON = 'Season 15';

  function seasonKey(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'season';
  }

  function archivesFrom(shared) {
    const settings = shared?.settings || {};
    return settings.seasonArchives && typeof settings.seasonArchives === 'object'
      ? settings.seasonArchives
      : {};
  }

  function requestedKey(options) {
    if (options && Object.prototype.hasOwnProperty.call(options, 'season')) {
      return options.season ? String(options.season).trim() : '';
    }
    try {
      return new URLSearchParams(window.location.search).get('season') || '';
    } catch (_) {
      return '';
    }
  }

  function getActive(shared) {
    const settings = shared?.settings || {};
    return settings.activeSeason || DEFAULT_SEASON;
  }

  function getArchive(shared, key) {
    const archives = archivesFrom(shared);
    if (key == null || key === '') return archives;
    return archives[String(key)] || null;
  }

  function getSnapshot(shared, options) {
    const source = shared || {};
    const settings = source.settings || {};
    const archives = archivesFrom(source);
    const requested = requestedKey(options);

    if (requested && archives[requested]) {
      const archive = archives[requested] || {};
      return {
        name: archive.name || requested,
        key: requested,
        teamMap: archive.teamMap || {},
        settings: archive.settings || {},
        replays: archive.replays || {},
        archived: true,
        archives
      };
    }

    return {
      name: getActive(source),
      key: '',
      teamMap: source.teamMap || {},
      settings,
      replays: null,
      archived: false,
      archives
    };
  }

  function getCurrentData(shared) {
    return getSnapshot(shared, { season: '' });
  }

  function getAvailableSeasons(shared) {
    const active = getActive(shared);
    const archives = archivesFrom(shared);
    const result = [{ name: active, key: '', archived: false }];

    Object.entries(archives)
      .map(([key, archive]) => ({
        name: archive?.name || key,
        key,
        archived: true,
        archivedAt: archive?.archivedAt || ''
      }))
      .sort((a, b) => {
        const byDate = String(b.archivedAt).localeCompare(String(a.archivedAt));
        return byDate || a.name.localeCompare(b.name);
      })
      .forEach(item => result.push(item));

    return result;
  }

  // Optional async helper for future pages that need to retrieve the shared
  // state themselves. Existing pages continue passing their already-loaded
  // state object, so Phase 4A introduces no duplicate database reads.
  async function loadState() {
    const client = SBL.getSupabase ? SBL.getSupabase() : SBL.supabase;
    const { data, error } = await client
      .from('replays')
      .select('replay_id,replay_data')
      .eq('replay_id', '__dashboard_state__')
      .maybeSingle();
    if (error) throw error;
    return data?.replay_data || {};
  }

  SBL.seasons = {
    DEFAULT_SEASON,
    getSeasonKey: seasonKey,
    seasonKey,
    getActive,
    getArchive,
    getCurrentData,
    getSnapshot,
    getAvailableSeasons,
    loadState
  };
})();
