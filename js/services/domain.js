/* Battle Tower domain identity and scope — CP4.167, centralisation phase 1.
 * Pure normalisation and projections live here. Pages must not invent their
 * own username/franchise/species/season identities. This module does not
 * decide ownership from names; only the DB assignment can do that.
 */
(function () {
  'use strict';
  window.SBL = window.SBL || {};
  const SBL = window.SBL;

  function showdownKey(name) {
    return String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function pokemonKey(name) {
    let id=String(name??'').trim().toLowerCase()
      .replace(/[’']/g,'').replace(/[♀]/g,'-f').replace(/[♂]/g,'-m')
      .replace(/[.:]/g,'').replace(/_/g,'-').replace(/\s+/g,'-')
      .replace(/-+/g,'-').replace(/^-|-$/g,'');
    id=id.replace(/-(forme|form|style)$/,'');
    const typo={scovilalian:'scovillain',scovillian:'scovillain',scovilion:'scovillain'};
    id=typo[id]||id;
    let m=id.match(/^mega-(.+?)-([xyz])$/);
    if(m)return `${m[1]}-mega-${m[2]}`;
    m=id.match(/^mega-(.+)$/);
    if(m)return `${m[1]}-mega`;
    m=id.match(/^(.+)-mega([xyz])$/);
    if(m)return `${m[1]}-mega-${m[2]}`;
    m=id.match(/^primal-(kyogre|groudon)$/);
    if(m)return `${m[1]}-primal`;
    return id;
  }
  // Showdown/Pokédex ids omit punctuation but preserve permanent form.
  function pokemonCatalogId(name) {return pokemonKey(name).replace(/[^a-z0-9]/g,'');}
  function archivedSeason(status){return ['archived','complete','completed','finalized','closed'].includes(String(status||'').toLowerCase());}

  async function resolveScope(options={}){
    const leagueId=String(options.leagueId||SBL.leagueDb?.selectedLeagueId?.()||'').trim();
    if(!leagueId)throw new Error('Select a league before working with its data.');
    const client=options.client||SBL.getSupabase?.();
    if(!client)throw new Error('Supabase client unavailable.');
    const season=await SBL.leagueDb.getSeasonContext(leagueId,client,{
      ...(options.seasonId?{seasonId:String(options.seasonId)}:{}),
      ...(options.seasonKey?{seasonKey:String(options.seasonKey)}:{})
    });
    if(!season || String(season.league_id||leagueId)!==leagueId)
      throw new Error('The selected season is missing or belongs to another league.');
    if(options.writable && archivedSeason(season.status))throw new Error('Archived season data cannot be modified.');
    return Object.freeze({leagueId,seasonId:String(season.id),seasonKey:String(season.season_key||''),
      seasonName:String(season.name||''),status:String(season.status||''),archived:archivedSeason(season.status),season});
  }
  function ownerIndex(assignments,franchises){
    const names=new Map((franchises||[]).map(f=>[String(f.id),f]));
    const owners=new Map();
    for(const a of assignments||[]){
      if(String(a.status||'active')!=='active')continue;
      const franchise=names.get(String(a.franchise_id));
      if(!franchise || String(franchise.status||'active')!=='active')continue;
      owners.set(String(a.user_id),{userId:String(a.user_id),franchiseId:String(franchise.id),franchiseName:String(franchise.name)});
    }
    return owners;
  }
  function aliasProjection(rows,replays){
    const byKey=new Map((rows||[]).map(r=>[showdownKey(r.showdown_id||r.showdown_username),{
      franchiseId:String(r.franchise_id||''),franchiseName:String(r.franchise_name||''),
      userId:r.user_id?String(r.user_id):null
    }]));
    const output=new Map();
    for(const replay of replays||[])for(const side of ['p1','p2']){
      const raw=String(replay?.replay_data?.players?.[side]||replay?.players?.[side]||'').trim();
      if(!raw)continue;
      const owner=byKey.get(showdownKey(raw));
      if(owner?.franchiseId&&owner?.franchiseName)output.set(raw.toLowerCase(),owner);
    }
    return output;
  }
  function applyAliasProjection(state,projection){
    if(!state)return;
    state.teamMap={...(state.teamMap||{})};
    state.settings={...(state.settings||{})};
    state.settings.replayUsernameAccountIds={...(state.settings.replayUsernameAccountIds||{})};
    state.settings.replayUsernameFranchiseIds={...(state.settings.replayUsernameFranchiseIds||{})};
    state.settings.replayUsernameCanonicalFranchises={...(state.settings.replayUsernameCanonicalFranchises||{})};
    for(const [username,owner] of projection){
      state.teamMap[username]=owner.franchiseName; // Compatibility display only.
      state.settings.replayUsernameFranchiseIds[username]=owner.franchiseId;
      state.settings.replayUsernameCanonicalFranchises[showdownKey(username)]=owner.franchiseName;
      if(owner.userId)state.settings.replayUsernameAccountIds[username]=owner.userId;
    }
  }
  function replayTeamLabel(state,username){
    const raw=String(username||'').trim();
    if(!raw)return 'Unknown';
    const mapping=state?.teamMap||{};
    const approved=state?.settings?.replayUsernameCanonicalFranchises?.[showdownKey(raw)];
    if(approved)return String(approved);
    const exact=mapping[raw.toLowerCase()];
    if(exact)return String(exact);
    // Backwards compatibility for pre-alias replay records, but do not guess
    // when two different teams claim the same punctuation-insensitive name.
    const target=showdownKey(raw);
    let match='';
    for(const [alias,franchise] of Object.entries(mapping)){
      if(showdownKey(alias)!==target||!franchise)continue;
      if(match&&match!==String(franchise))return raw;
      match=String(franchise);
    }
    return match||raw;
  }
  async function fetchReplayAliasProjection(client,leagueId,replayRows){
    const names=[...new Set((replayRows||[]).flatMap(r=>['p1','p2'].map(s=>
      String(r?.replay_data?.players?.[s]||r?.players?.[s]||'').trim())).filter(Boolean))];
    if(!names.length)return new Map();
    const {data,error}=await client.rpc('sbl_resolve_replay_aliases',{
      p_league_id:leagueId,p_names:names
    });
    if(error){
      // Compatibility until CP4.167 SQL is installed. Never infer an owner
      // from a similar nickname or a franchise's old display name.
      if(['42883','PGRST202'].includes(error.code))return new Map();
      throw error;
    }
    return aliasProjection(data||[],replayRows);
  }
  SBL.domain={showdownKey,pokemonKey,pokemonCatalogId,archivedSeason,resolveScope,ownerIndex,
    aliasProjection,applyAliasProjection,replayTeamLabel,fetchReplayAliasProjection};
})();
