/*
 * SBL SEASONS SERVICE
 *
 * Canonical season data boundary. Normalized league_seasons is authoritative
 * when available; the legacy __dashboard_state__ shape remains a compatibility
 * fallback until migration is confirmed.
 */
(function () {
  'use strict';

  window.SBL = window.SBL || {};
  const SBL = window.SBL;
  const DEFAULT_SEASON = 'Season 15';

  function seasonKey(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'season';
  }
  function archivesFrom(shared) {
    const settings = shared?.settings || {};
    return settings.seasonArchives && typeof settings.seasonArchives === 'object' ? settings.seasonArchives : {};
  }
  function requestedKey(options) {
    if (options && Object.prototype.hasOwnProperty.call(options, 'season')) return options.season ? String(options.season).trim() : '';
    try { return new URLSearchParams(window.location.search).get('season') || ''; } catch (_) { return ''; }
  }
  function getActive(shared) { return shared?.settings?.activeSeason || DEFAULT_SEASON; }
  function getArchive(shared,key) { const archives=archivesFrom(shared); if(key==null||key==='') return archives; return archives[String(key)]||null; }

  function getSnapshot(shared, options) {
    const source=shared||{};
    const registry=source?.settings?.leagues && typeof source.settings.leagues==='object' ? source.settings.leagues : {};
    const archives=archivesFrom(source);
    const requestedSeason=requestedKey(options);
    const requestedLeague=options?.league || SBL.leagueDb?.selectedLeagueId?.() || '';
    const league=registry[requestedLeague] || null;
    const leagueState=league?.state || source;
    const settings=leagueState?.settings || {};
    const leagueArchives=archivesFrom(leagueState);
    if(requestedSeason && leagueArchives[requestedSeason]){
      const archive=leagueArchives[requestedSeason]||{};
      return {name:archive.name||requestedSeason,key:requestedSeason,leagueId:league?.id||requestedLeague||'',leagueName:league?.name||'',leagues:registry,teamMap:archive.teamMap||{},settings:archive.settings||{},replays:archive.replays||{},archived:true,archives:leagueArchives};
    }
    return {name:getActive(leagueState),key:'',leagueId:league?.id||requestedLeague||'',leagueName:league?.name||'',leagues:registry,teamMap:leagueState.teamMap||{},settings, replays:null,archived:false,archives:leagueArchives};
  }

  function getCurrentData(shared){ return getSnapshot(shared,{season:''}); }

  function getAvailableSeasons(shared){
    const active=getActive(shared), archives=archivesFrom(shared);
    const result=[{name:active,key:'',archived:false}];
    Object.entries(archives).map(([key,archive])=>({name:archive?.name||key,key,archived:true,archivedAt:archive?.archivedAt||''})).sort((a,b)=>String(b.archivedAt).localeCompare(String(a.archivedAt))||a.name.localeCompare(b.name)).forEach(x=>result.push(x));
    return result;
  }

  async function loadSnapshot(options={}){
    const db=SBL.getSupabase ? SBL.getSupabase() : null;
    const leagueId=options.leagueId || SBL.leagueDb?.selectedLeagueId?.();
    if(!db) throw new Error('Supabase client is not available.');
    if(!leagueId || !SBL.leagueDb?.isAvailable || !(await SBL.leagueDb.isAvailable(db))){
      const shared=await loadState(db);
      return getSnapshot(shared,options);
    }
    const season=await SBL.leagueDb.getSeasonContext(leagueId,db,{seasonId:options.seasonId,seasonKey:seasonKey(requestedKey(options))});
    if(season){
      SBL.leagueDb.setSelectedSeasonId?.(season.id);
      SBL.leagueDb.setSelectedSeasonKey?.(season.season_key);
      const payload=season.data&&typeof season.data==='object'?season.data:{};
      const settings=payload.settings&&typeof payload.settings==='object'?payload.settings:{};
      return {name:season.name,key:season.season_key,seasonId:season.id,leagueId,leagueName:'',teamMap:payload.teamMap||{},settings,replays:payload.replays||null,archived:['archived','complete'].includes(season.status),status:season.status,archives:{}};
    }
    const snap=await SBL.leagueDb.getSnapshot(leagueId,db);
    return getSnapshot(snap?.state||{},options);
  }

  async function saveSnapshot(snapshot,options={}){
    const db=SBL.getSupabase ? SBL.getSupabase() : null;
    const leagueId=options.leagueId || SBL.leagueDb?.selectedLeagueId?.();
    if(!db||!leagueId) throw new Error('League and Supabase client are required.');
    const seasonId=options.seasonId || SBL.leagueDb?.selectedSeasonId?.();
    const season=seasonId ? await SBL.leagueDb.getSeasonContext(leagueId,db,{seasonId}) : await SBL.leagueDb.getSeasonContext(leagueId,db,{seasonKey:seasonKey(snapshot?.key||snapshot?.name||'')});
    if(!season) throw new Error('The selected season could not be found.');
    return SBL.leagueDb.saveSeasonState(leagueId,season.id,{teamMap:snapshot?.teamMap||{},settings:snapshot?.settings||{},replays:snapshot?.replays||null},db);
  }

  async function loadState(){
    if(SBL.replays?.load){
      const {data}=await SBL.replays.load(SBL.getSupabase ? SBL.getSupabase() : SBL.supabase,{force:true});
      return data?.find(r=>r.replay_id==='__dashboard_state__')?.replay_data||{};
    }
    const client=SBL.getSupabase ? SBL.getSupabase() : SBL.supabase;
    const leagueId=SBL.leagueDb?.selectedLeagueId?.();
    let q=client.from('replays').select('replay_id,replay_data').eq('replay_id','__dashboard_state__');
    if(leagueId) q=q.eq('league_id',leagueId);
    const {data,error}=await q.maybeSingle();
    if(error) throw error;
    return data?.replay_data||{};
  }

  SBL.seasons={DEFAULT_SEASON,getSeasonKey:seasonKey,seasonKey,getActive,getArchive,getCurrentData,getSnapshot,getAvailableSeasons,loadSnapshot,saveSnapshot,loadState};
})();
