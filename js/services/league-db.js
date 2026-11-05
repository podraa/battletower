/*
 * SBL LEAGUE DATABASE SERVICE
 *
 * Canonical multi-league data boundary for Supabase. The UI may keep using the
 * existing state-shaped objects, but persistence is league-scoped when the
 * normalized tables are present. Legacy __dashboard_state__ storage remains a
 * compatibility fallback until the migration is run.
 */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  const SBL=window.SBL;
  const SELECTED='sbl_selected_league_id';
  const SELECTED_SEASON='sbl_selected_season_id';
  let availability=null;
  let availabilityPromise=null;

  function db(client){ return client || SBL.getSupabase(); }
  function isUuid(value){
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||'').trim());
  }
  function selectedLeagueId(){
    try{
      const q=new URLSearchParams(location.search).get('league')||'';
      if(q && isUuid(q)) return q;
      const stored=localStorage.getItem(SELECTED)||'';
      return isUuid(stored) ? stored : '';
    }catch(_){ return ''; }
  }
  function setSelectedLeagueId(id){
    const value=String(id||'');
    try{ localStorage.setItem(SELECTED,value); }catch(_){}
    try{
      document.dispatchEvent(new CustomEvent('sbl:league-selection-changed',{detail:{leagueId:value}}));
    }catch(_){}
  }
  function seasonStorageKey(kind,leagueId){ return `sbl_selected_season_${kind}:${String(leagueId||selectedLeagueId()||'legacy')}`; }
  function selectedSeasonId(leagueId){
    try{
      const q=new URLSearchParams(location.search).get('season_id')||'';
      if(q && isUuid(q)) return q;
      const scoped=localStorage.getItem(seasonStorageKey('id',leagueId))||'';
      if(isUuid(scoped)) return scoped;
      // Read the old global value only as a migration bridge. The caller still
      // verifies that the season belongs to the requested league.
      const stored=localStorage.getItem(SELECTED_SEASON)||'';
      return isUuid(stored) ? stored : '';
    }catch(_){ return ''; }
  }
  // The page URL is the person's explicit request; localStorage is only a
  // remembered preference. getSeasonContext() consults these first so a stale
  // stored season can never override a link such as season.html?season=season-14.
  function routeSeasonId(){
    try{ const q=new URLSearchParams(location.search).get('season_id')||''; return isUuid(q)?q:''; }catch(_){ return ''; }
  }
  function routeSeasonKey(){
    try{ return String(new URLSearchParams(location.search).get('season')||'').trim(); }catch(_){ return ''; }
  }
  function syncSeasonRoute(leagueId,seasonId,seasonKey){
    try{
      const url=new URL(location.href);
      const routeLeague=url.searchParams.get('league')||selectedLeagueId();
      if(!leagueId||String(routeLeague)!==String(leagueId)||['index.html','admin-hub.html'].includes((url.pathname.split('/').pop()||'').toLowerCase())) return;
      if(seasonId) url.searchParams.set('season_id',String(seasonId)); else url.searchParams.delete('season_id');
      if(seasonKey!==undefined){ if(seasonKey) url.searchParams.set('season',String(seasonKey)); else url.searchParams.delete('season'); }
      history.replaceState(history.state,'',url.href);
    }catch(_){}
  }
  function setSelectedSeasonId(id,leagueId){ try{ localStorage.setItem(seasonStorageKey('id',leagueId),String(id||'')); localStorage.setItem(SELECTED_SEASON,String(id||'')); }catch(_){} syncSeasonRoute(leagueId,id,undefined); }
  function selectedSeasonKey(leagueId){
    try{ return new URLSearchParams(location.search).get('season') || localStorage.getItem(seasonStorageKey('key',leagueId)) || ''; }catch(_){ return ''; }
  }
  function setSelectedSeasonKey(key,leagueId){ try{ localStorage.setItem(seasonStorageKey('key',leagueId),String(key||'')); localStorage.setItem('sbl_selected_season_key',String(key||'')); }catch(_){} syncSeasonRoute(leagueId,selectedSeasonId(leagueId),key); }
  function clone(v){ try{return JSON.parse(JSON.stringify(v));}catch(_){return v;} }
  function isMissingTable(error){ return !!error && (error.code==='42P01' || /relation .* does not exist/i.test(error.message||'')); }

  async function isAvailable(client, options={}){
    if(options.force){ availability=null; availabilityPromise=null; }
    if(availability!==null) return availability;
    if(availabilityPromise) return availabilityPromise;
    availabilityPromise=(async()=>{
      try{
        const {error}=await db(client).from('leagues').select('id').limit(1);
        if(error && isMissingTable(error)) return false;
        if(error) throw error;
        return true;
      }catch(e){
        console.error('SBL normalized league-table availability check failed.',e);
        throw e;
      }
    })();
    try{ availability=await availabilityPromise; return availability; }
    finally{ availabilityPromise=null; }
  }

  async function listAll(client){
    const {data,error}=await db(client).from('leagues').select('id,name,description,join_code,created_by,status,created_at,updated_at,state').order('created_at',{ascending:true});
    if(error) throw error;
    return data||[];
  }

  async function listForUser(userId, client){
    if(!userId) return [];
    const D=db(client);
    const {data:members,error:memberError}=await D.from('league_members').select('id,league_id,user_id,role,status,member_type,requested_franchise_id,requested_at,approved_at,created_at,updated_at').eq('user_id',userId);
    if(memberError) throw memberError;
    if(!members?.length) return [];
    const ids=[...new Set(members.map(m=>m.league_id).filter(Boolean))];
    const {data:leagues,error:leagueError}=await D.from('leagues').select('id,name,description,join_code,created_by,status,created_at,updated_at,state').in('id',ids);
    if(leagueError) throw leagueError;
    return (leagues||[]).map(l=>{
      const ms=members.filter(m=>m.league_id===l.id).map(m=>Object.assign({},m,{userId:m.user_id}));
      return toLegacyLeague(l,ms);
    });
  }

  function toLegacyLeague(row,members){
    const state=clone(row?.state||{});
    state.settings=state.settings||{};
    state.settings.leagueId=row?.id||'';
    return {id:row.id,name:row.name,description:row.description||'',joinCode:row.join_code||'',createdAt:row.created_at||'',updatedAt:row.updated_at||'',members:members||[],state};
  }

  async function getLeague(id, client){
    if(!id) return null;
    const D=db(client);
    const {data:row,error}=await D.from('leagues').select('id,name,description,join_code,created_by,status,created_at,updated_at,state').eq('id',id).maybeSingle();
    if(error) throw error;
    if(!row) return null;
    const {data:members,error:me}=await D.from('league_members').select('id,league_id,user_id,role,status,member_type,requested_franchise_id,requested_at,approved_at,created_at,updated_at').eq('league_id',id).order('created_at',{ascending:true});
    if(me) throw me;
    const ms=(members||[]).map(m=>Object.assign({},m,{userId:m.user_id}));
    return toLegacyLeague(row,ms);
  }

  async function getMembership(leagueId,userId,client){
    if(!leagueId||!userId) return null;
    const {data,error}=await db(client).from('league_members').select('id,league_id,user_id,role,status,member_type,requested_franchise_id,requested_at,approved_at,created_at,updated_at').eq('league_id',leagueId).eq('user_id',userId).maybeSingle();
    if(error) throw error;
    if(!data) return null;
    return Object.assign({},data,{userId:data.user_id});
  }

  async function getSnapshot(leagueId,client){
    const league=await getLeague(leagueId,client);
    if(!league) return null;
    const state=clone(league.state||{});
    state.teamMap=state.teamMap||{};
    state.settings=state.settings||{};
    state.settings.leagues={};
    state.settings.activeLeagueId=league.id;
    return {league,state};
  }

  async function getSeasonContext(leagueId,client,options={}){
    const id=leagueId || selectedLeagueId();
    if(!id) return null;
    const D=db(client);
    const explicitSeasonId=String(options.seasonId||'').trim();
    const explicitSeasonKey=String(options.seasonKey||'').trim();
    const fields='id,league_id,season_key,name,status,data,created_at,updated_at';

    // Explicit operation targets always win over browser selection. This is
    // critical for season creation/restoration: the caller names the target
    // season while localStorage still points at the previous season.
    if(explicitSeasonId){
      const r=await D.from('league_seasons').select(fields).eq('league_id',id).eq('id',explicitSeasonId).maybeSingle();
      if(r.error) throw r.error;
      return r.data||null;
    }
    if(explicitSeasonKey){
      const key=explicitSeasonKey.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      let r=await D.from('league_seasons').select(fields).eq('league_id',id).eq('season_key',key).maybeSingle();
      if(r.error) throw r.error;
      if(!r.data){
        r=await D.from('league_seasons').select(fields).eq('league_id',id).ilike('name',explicitSeasonKey).maybeSingle();
        if(r.error) throw r.error;
      }
      return r.data||null;
    }

    // 1) The URL is an explicit request for this page view and wins over any
    //    remembered browser preference.
    const routeId=routeSeasonId();
    if(routeId){
      const r=await D.from('league_seasons').select(fields).eq('league_id',id).eq('id',routeId).maybeSingle();
      if(r.error) throw r.error;
      if(r.data) return r.data;
    }
    const routeKey=routeSeasonKey();
    if(routeKey){
      const key=routeKey.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      let r=await D.from('league_seasons').select(fields).eq('league_id',id).eq('season_key',key).maybeSingle();
      if(r.error) throw r.error;
      if(!r.data){
        r=await D.from('league_seasons').select(fields).eq('league_id',id).ilike('name',routeKey).maybeSingle();
        if(r.error) throw r.error;
      }
      if(r.data) return r.data;
    }

    // Browser selection is a preference, not authority. A stale ID from a
    // different league must not make all season data disappear; try the saved
    // key and then the league's current (newest active) season if that ID is
    // invalid.
    const storedId=selectedSeasonId(id);
    if(storedId){
      const r=await D.from('league_seasons').select(fields).eq('league_id',id).eq('id',storedId).maybeSingle();
      if(r.error) throw r.error;
      if(r.data) return r.data;
    }
    const storedKey=selectedSeasonKey(id);
    if(storedKey){
      const key=storedKey.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      let r=await D.from('league_seasons').select(fields).eq('league_id',id).eq('season_key',key).maybeSingle();
      if(r.error) throw r.error;
      if(!r.data){
        r=await D.from('league_seasons').select(fields).eq('league_id',id).ilike('name',storedKey).maybeSingle();
        if(r.error) throw r.error;
      }
      if(r.data) return r.data;
    }
    // Default to the league's CURRENT season. When several rows are marked
    // active (a known legacy-data defect) the newest one is current; the oldest
    // is, by definition, the historical one. If nothing is active (for example
    // the current season is still 'planned'), the newest season is the best
    // available default. Never default to the oldest season: that silently
    // presents a historical season as the current one.
    let active=await D.from('league_seasons').select(fields).eq('league_id',id).eq('status','active').order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(active.error) throw active.error;
    if(active.data) return active.data;
    const newest=await D.from('league_seasons').select(fields).eq('league_id',id).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(newest.error) throw newest.error;
    return newest.data||null;
  }

  async function listSeasons(leagueId,client){
    const id=leagueId || selectedLeagueId();
    if(!id) return [];
    const {data,error}=await db(client).from('league_seasons').select('id,league_id,season_key,name,status,data,created_at,updated_at').eq('league_id',id).order('created_at',{ascending:true});
    if(error) throw error;
    return data||[];
  }

  async function saveSeasonState(leagueId,seasonId,payload,client){
    if(!leagueId) throw new Error('League id is required.');
    if(!seasonId) throw new Error('Season id is required.');
    const clean=clone(payload||{});
    const {data,error}=await db(client).from('league_seasons').update({data:clean,updated_at:new Date().toISOString()}).eq('id',seasonId).eq('league_id',leagueId).select('id,league_id,season_key,name,status,data,updated_at').maybeSingle();
    if(error) throw error;
    if(!data) throw new Error('Season could not be saved.');
    setSelectedSeasonId(data.id,leagueId); setSelectedSeasonKey(data.season_key,leagueId);
    return data;
  }

  async function saveState(leagueId,state,client,options={}){
    if(!leagueId) throw new Error('League id is required.');
    const clean={teamMap:clone(state?.teamMap||{}),settings:clone(state?.settings||{})};
    delete clean.settings.leagues;
    clean.settings.activeLeagueId=leagueId;
    const {data,error}=await db(client).from('leagues').update({state:clean,updated_at:new Date().toISOString()}).eq('id',leagueId).select('id,name,description,join_code,state').maybeSingle();
    if(error) throw error;
    if(!data) throw new Error('League could not be saved.');
    const framework=clean.settings.framework && typeof clean.settings.framework==='object' ? clean.settings.framework : {};
    const r=await db(client).from('league_settings').upsert({league_id:leagueId,framework,updated_at:new Date().toISOString()},{onConflict:'league_id'});
    if(r.error) throw r.error;
    // Keep the selected season as the canonical season-scoped copy. The league
    // row remains a compatibility mirror until every page has migrated. When
    // the active season name changes, materialize/activate the corresponding
    // league_seasons row instead of silently continuing to write the old one.
    const targetName=String(clean.settings.activeSeason||'Season 1').trim()||'Season 1';
    const targetKey=targetName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'season-1';
    let season=options.seasonId
      ? await getSeasonContext(leagueId,client,{seasonId:options.seasonId})
      : await getSeasonContext(leagueId,client,{seasonKey:targetKey});
    if(!season){
      // Archive every currently-active row rather than trusting browser
      // selection to identify the active season. This also repairs legacy
      // databases that accidentally contain more than one active season.
      const archived=await db(client).from('league_seasons')
        .update({status:'archived',updated_at:new Date().toISOString()})
        .eq('league_id',leagueId).eq('status','active');
      if(archived.error) throw archived.error;
      const created=await db(client).from('league_seasons').upsert({league_id:leagueId,season_key:targetKey,name:targetName,status:'active',data:{teamMap:clean.teamMap,settings:clean.settings}}, {onConflict:'league_id,season_key'}).select('id,league_id,season_key,name,status,data,created_at,updated_at').single();
      if(created.error) throw created.error;
      season=created.data;
    } else {
      // The target may be archived already. Archive all other active seasons
      // by database state, not by stale localStorage ID, then activate target.
      const archived=await db(client).from('league_seasons')
        .update({status:'archived',updated_at:new Date().toISOString()})
        .eq('league_id',leagueId).eq('status','active').neq('id',season.id);
      if(archived.error) throw archived.error;
      const activated=await db(client).from('league_seasons').update({status:'active',updated_at:new Date().toISOString()}).eq('id',season.id).eq('league_id',leagueId);
      if(activated.error) throw activated.error;
      season=await saveSeasonState(leagueId,season.id,{teamMap:clean.teamMap,settings:clean.settings},client);
    }
    setSelectedSeasonId(season.id,leagueId); setSelectedSeasonKey(season.season_key,leagueId);
    return data;
  }


  async function renameSeason(leagueId,seasonId,name,client){
    const cleanName=String(name||'').trim();
    if(!leagueId||!seasonId) throw new Error('League and season are required.');
    if(!cleanName) throw new Error('Enter a season name.');
    const current=await getSeasonContext(leagueId,client,{seasonId});
    if(!current) throw new Error('The selected season could not be found.');
    const payload=clone(current.data||{});
    payload.settings=payload.settings||{};
    payload.settings.activeSeason=cleanName;
    const {data,error}=await db(client).from('league_seasons')
      .update({name:cleanName,data:payload,updated_at:new Date().toISOString()})
      .eq('id',seasonId).eq('league_id',leagueId)
      .select('id,league_id,season_key,name,status,data,created_at,updated_at').maybeSingle();
    if(error) throw error;
    if(!data) throw new Error('Season name could not be updated.');
    setSelectedSeasonId(data.id,leagueId); setSelectedSeasonKey(data.season_key,leagueId);
    return data;
  }

  async function updateLeague(leagueId,patch,client){
    if(!leagueId) throw new Error('League id is required.');
    const allowed={};
    ['name','description','join_code','status'].forEach(k=>{ if(Object.prototype.hasOwnProperty.call(patch||{},k)) allowed[k]=patch[k]; });
    allowed.updated_at=new Date().toISOString();
    const {data,error}=await db(client).from('leagues').update(allowed).eq('id',leagueId).select('id,name,description,join_code,created_by,status,created_at,updated_at,state').maybeSingle();
    if(error) throw error;
    if(!data) throw new Error('League could not be updated.');
    return data;
  }

  async function deleteLeague(leagueId,client){
    if(!leagueId) throw new Error('League id is required.');
    const {error}=await db(client).from('leagues').delete().eq('id',leagueId);
    if(error) throw error;
    if(selectedLeagueId()===leagueId) setSelectedLeagueId('');
    setSelectedSeasonId('',leagueId); setSelectedSeasonKey('',leagueId);
    return true;
  }

  async function createLeague(payload,client){
    const D=db(client);
    const initial=clone(payload?.state||{teamMap:{},settings:{}});
    initial.settings=initial.settings||{};
    initial.settings.activeLeagueId='';
    const franchises=(Array.isArray(payload?.franchises)?payload.franchises:[]).map(x=>({
      name:String(x?.name||x||'').trim(),
      conference:String(x?.conference||'').trim()||null,
      metadata:x?.metadata||{}
    })).filter(x=>x.name);

    // League creation, commissioner membership, normalized settings/season and
    // franchise materialisation are one DB transaction in the authoritative
    // RPC. Do not recreate this as a browser-side sequence of inserts.
    const {data:league,error}=await D.rpc('sbl_create_league_atomic',{
      p_name:String(payload?.name||'').trim(),
      p_description:String(payload?.description||''),
      p_join_code:payload?.joinCode||null,
      p_state:initial,
      p_franchises:franchises
    });
    if(error) throw error;
    const created=Array.isArray(league)?league[0]:league;
    if(!created?.id) throw new Error('League creation RPC returned no league.');
    const activeSeason=String(initial.settings?.activeSeason||'Season 1').trim()||'Season 1';
    const seasonKey=activeSeason.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'season-1';
    setSelectedSeasonKey(seasonKey,created.id);
    setSelectedSeasonId('',created.id);
    setSelectedLeagueId(created.id);
    return getLeague(created.id,D);
  }

  async function listFranchises(leagueId,client){
    if(!leagueId) return [];
    const {data,error}=await db(client).from('franchises')
      .select('id,league_id,name,conference,metadata,status,archived_at,claim_state,locked_reason,locked_by,locked_at,created_at,updated_at')
      .eq('league_id',leagueId)
      .order('name',{ascending:true});
    if(error) throw error;
    return data||[];
  }

  async function createFranchise(leagueId,name,conference,metadata,client){
    if(!leagueId) throw new Error('League id is required.');
    const {data,error}=await db(client).rpc('sbl_create_franchise',{
      p_league_id:leagueId,
      p_name:String(name||'').trim(),
      p_conference:String(conference||'').trim()||null,
      p_metadata:metadata && typeof metadata==='object' ? metadata : {}
    });
    if(error) throw error;
    return Array.isArray(data)?data[0]:data;
  }

  async function updateFranchiseDefinition(leagueId,franchiseId,name,conference,client){
    if(!leagueId||!franchiseId) throw new Error('League and franchise ids are required.');
    const value=String(name||'').trim();
    if(!value) throw new Error('Franchise name cannot be blank.');
    const {data,error}=await db(client).rpc('sbl_update_franchise_definition',{
      p_league_id:leagueId,p_franchise_id:franchiseId,p_name:value,
      p_conference:String(conference||'').trim()||null
    });
    if(error) throw error;
    return data;
  }

  async function findByJoinCode(code,client){
    const value=String(code||'').trim();
    if(!value) return null;
    const {data,error}=await db(client).rpc('sbl_find_league_by_join_code',{p_join_code:value});
    if(error) throw error;
    const row=Array.isArray(data) ? data[0] : data;
    if(!row?.id) return null;
    return {
      id:row.id,
      name:row.name||'',
      description:row.description||'',
      joinCode:row.join_code||'',
      status:row.status||'active',
      members:[]
    };
  }

  async function requestJoin(leagueId,user,client){
    if(!leagueId || !user?.id) throw new Error('League and user are required.');
    const {data,error}=await db(client).rpc('sbl_request_league_membership',{p_league_id:leagueId});
    if(error) throw error;
    return data;
  }

  async function setMembership(leagueId,userId,patch,client){
    const ownershipFields=['franchise','team','franchise_id','franchiseId'];
    const attemptedOwnership=ownershipFields.filter(field =>
      Object.prototype.hasOwnProperty.call(patch || {}, field)
    );
    if(attemptedOwnership.length){
      throw new Error(
        'setMembership() no longer accepts franchise ownership fields: ' +
        attemptedOwnership.join(', ') +
        '. Use the normalized franchise ownership service.'
      );
    }

    const D=db(client);
    const next=Object.assign({},patch,{updated_at:new Date().toISOString()});
    const {data,error}=await D.from('league_members').update(next).eq('league_id',leagueId).eq('user_id',userId).select('*').maybeSingle();
    if(error) throw error;
    return data;
  }

  async function upsertFranchises(leagueId,items,client){
    const payload=(Array.isArray(items)?items:[]).map(x=>({name:String(x?.name||x||'').trim(),conference:String(x?.conference||'').trim()||null,metadata:x?.metadata||{}})).filter(x=>x.name);
    if(!payload.length) return [];
    const {data,error}=await db(client).rpc('sbl_upsert_franchises',{p_league_id:leagueId,p_franchises:payload});
    if(error) throw error;
    return data||[];
  }

  async function loadReplays(leagueId,client,options={}){
    if(!leagueId) return [];
    // Replay rows always belong to exactly one season. An explicit seasonId is
    // trusted (the caller resolved it). Otherwise resolve through
    // getSeasonContext(), which validates that the season belongs to this
    // league. If no season can be resolved, return nothing: an unscoped query
    // would return every season's replays and leak historical usage into the
    // current season.
    let seasonId=String(options.seasonId||'').trim();
    if(!seasonId){
      const season=await getSeasonContext(leagueId,client);
      seasonId=season?.id||'';
    }
    if(!seasonId) return [];
    const {data,error}=await db(client).from('league_replays').select('replay_id,replay_data,updated_at,season_id').eq('league_id',leagueId).eq('season_id',seasonId);
    if(error) throw error; return data||[];
  }
  async function upsertReplays(leagueId,rows,client){
    const seasonId=selectedSeasonId(leagueId);
    const payload=(Array.isArray(rows)?rows:[]).map(r=>Object.assign({},r,{league_id:leagueId,season_id:r.season_id||seasonId||null,updated_at:r.updated_at||new Date().toISOString()}));
    if(!payload.length) return [];
    const {data,error}=await db(client).from('league_replays').upsert(payload,{onConflict:'league_id,replay_id'}).select('replay_id,replay_data,updated_at');
    if(error) throw error; return data||[];
  }
  async function deleteReplays(leagueId,ids,client,options={}){
    const vals=(Array.isArray(ids)?ids:[]).filter(Boolean); if(!vals.length)return [];
    const seasonId=options.seasonId || selectedSeasonId(leagueId);
    let q=db(client).from('league_replays').delete().eq('league_id',leagueId).in('replay_id',vals);
    // Always scope destructive replay operations to the selected season.
    if(seasonId) q=q.eq('season_id',seasonId);
    const {data,error}=await q.select('replay_id');
    if(error) throw error; return data||[];
  }

  SBL.leagueDb={selectedLeagueId,setSelectedLeagueId,selectedSeasonId,setSelectedSeasonId,selectedSeasonKey,setSelectedSeasonKey,getSeasonContext,listSeasons,saveSeasonState,renameSeason,updateLeague,deleteLeague,isUuid,isAvailable,listAll,listForUser,getLeague,getMembership,getSnapshot,saveState,createLeague,listFranchises,createFranchise,updateFranchiseDefinition,findByJoinCode,requestJoin,setMembership,upsertFranchises,loadReplays,upsertReplays,deleteReplays,clearAvailability:()=>{availability=null;availabilityPromise=null;}};
})();
