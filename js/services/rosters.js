/*
 * SBL ROSTER SERVICE
 *
 * Canonical roster reads are season-scoped through league_seasons.data.settings.rosters.
 * The legacy __rosters__ replay remains a compatibility fallback while migration
 * is being verified.
 */
(function () {
  'use strict';
  window.SBL=window.SBL||{};
  window.SBL.services=window.SBL.services||{};
  const SBL=window.SBL;
  const CACHE_TTL=15000;
  let memory=null,memoryAt=0,memoryKey='',request=null,requestKey='';

  function client(){ return SBL.getSupabase(); }
  function unwrap(raw){
    if(!raw) return null;
    const value=raw.replay_data??raw.data??raw;
    if(typeof value==='string'){ try{return JSON.parse(value);}catch(_){} }
    return value||null;
  }
  async function load(options={}){
    const force=!!options.force, now=Date.now();
    const cacheKey=`${SBL.leagueDb?.selectedLeagueId?.()||'legacy'}|${SBL.leagueDb?.selectedSeasonId?.()||''}|${options.season||''}`;
    if(!force&&memory&&memoryKey===cacheKey&&(now-memoryAt)<CACHE_TTL)return memory;
    if(!force&&request&&requestKey===cacheKey)return request;
    requestKey=cacheKey;
    request=(async()=>{
      const db=client();
      let state=null, snapshot=null;
      if(SBL.seasons?.loadSnapshot && SBL.leagueDb?.selectedLeagueId?.()){
        snapshot=await SBL.seasons.loadSnapshot({leagueId:SBL.leagueDb.selectedLeagueId(),seasonId:options.seasonId,season:options.season});
        state=snapshot?.settings||{};
      }
      let rosters=state?.rosters&&typeof state.rosters==='object'?state.rosters:{};
      if(!Object.keys(rosters).length){
        const leagueId=SBL.leagueDb?.selectedLeagueId?.()||'';
        let q=db.from('league_replays').select('replay_id,replay_data').eq('replay_id','__rosters__');
        if(leagueId) q=q.eq('league_id',leagueId);
        const normalized=await q.maybeSingle();
        if(!normalized.error&&normalized.data) rosters=unwrap(normalized.data)?.rosters||{};
      }
      if(!Object.keys(rosters).length){
        const leagueId=SBL.leagueDb?.selectedLeagueId?.()||'';
        let q=db.from('replays').select('replay_id,replay_data').eq('replay_id','__rosters__');
        if(leagueId) q=q.eq('league_id',leagueId);
        const legacy=await q.maybeSingle();
        if(!legacy.error&&legacy.data) rosters=unwrap(legacy.data)?.rosters||{};
      }
      memory={rosters:rosters||{},settings:state||{},snapshot:snapshot||null};
      memoryKey=`${SBL.leagueDb?.selectedLeagueId?.()||'legacy'}|${SBL.leagueDb?.selectedSeasonId?.()||''}|${options.season||''}`;
      memoryAt=Date.now();
      return memory;
    })();
    try{return await request;}finally{request=null;requestKey='';}
  }
  async function getAll(options={}){ return (await load(options))?.rosters||{}; }
  async function getTeam(teamName,options={}){ if(!teamName)return null; const all=await getAll(options); if(all[teamName])return all[teamName]; const target=String(teamName).trim().toLowerCase(); const key=Object.keys(all).find(k=>String(k).trim().toLowerCase()===target); return key?all[key]:null; }
  async function getPokemon(teamName,options={}){ const roster=await getTeam(teamName,options); if(!roster)return []; if(Array.isArray(roster))return roster; if(Array.isArray(roster.pokemon))return roster.pokemon; if(Array.isArray(roster.roster))return roster.roster; if(Array.isArray(roster.members))return roster.members; return []; }
  async function save(rosters,options={}){
    const db=client(), leagueId=SBL.leagueDb?.selectedLeagueId?.();
    if(!leagueId||!SBL.seasons?.loadSnapshot) throw new Error('A selected league is required to save rosters.');
    const snapshot=await SBL.seasons.loadSnapshot({leagueId,seasonId:options.seasonId,season:options.season});
    const settings=JSON.parse(JSON.stringify(snapshot?.settings||{}));
    settings.rosters=rosters||{};
    await SBL.seasons.saveSnapshot({teamMap:snapshot?.teamMap||{},settings,replays:snapshot?.replays||null},{leagueId,seasonId:snapshot?.seasonId});
    memory={rosters:rosters||{},settings,snapshot:Object.assign({},snapshot,{settings})}; memoryAt=Date.now();
    return memory;
  }
  function clearCache(){memory=null;memoryAt=0;request=null;}
  SBL.services.rosters={load,getAll,getTeam,getPokemon,save,clearCache};
  SBL.rosters=SBL.services.rosters;
})();
