/* Shared Draft persistence/orchestration.
 * Draft state lives in replays.__dashboard_state__. The important rule here is
 * that a client never treats updated_at as a lock. A write may race another
 * legitimate write; after writing we verify the actual draft mutation and, if
 * it was overwritten, retry from the newest state.
 */
(function(){
  'use strict';
  const SBL = window.SBL = window.SBL || {};
  const STATE_ID='__dashboard_state__';
  let writeQueue=Promise.resolve();

  function db(){ return SBL.getSupabase(); }
  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function clone(v){ return JSON.parse(JSON.stringify(v ?? {})); }
  function normaliseDraft(d){
    const x=Object.assign({status:'setup',mode:'manual',defaultBudget:120,budgets:{},pool:[],order:[],currentPick:0,picks:[],minPicks:10,maxPicks:10}, d||{});
    x.budgets=x.budgets&&typeof x.budgets==='object'?x.budgets:{};
    x.authorizedPickerIds=Array.isArray(x.authorizedPickerIds)?[...new Set(x.authorizedPickerIds.map(String))]:[];
    x.pool=Array.isArray(x.pool)?x.pool:[];
    x.order=Array.isArray(x.order)?x.order.map(String):[];
    x.picks=Array.isArray(x.picks)?x.picks:[];
    x.currentPick=Math.max(0,Number(x.currentPick)||0);
    return x;
  }


  /* ---- CP4.0 live-draft helpers -------------------------------------------
   * Picks arrive as small draft_picks rows over realtime and are applied to the
   * local state by pure reducers, so a pick no longer re-downloads the whole
   * season blob on every device. version() is a few-byte change check.
   */
  let ctx=null;
  function rememberCtx(leagueId,seasonId){ ctx=(leagueId&&seasonId)?{leagueId,seasonId}:null; }
  async function ensureCtx(){
    const lid=SBL.leagueDb?.selectedLeagueId?.()||'';
    if(ctx && ctx.leagueId===lid) return ctx;
    try{ await read(); }catch(_){ }
    return (ctx && ctx.leagueId===lid) ? ctx : null;
  }
  function isMissingFn(error){ return !!error && ['PGRST202','42883','42P01'].includes(String(error.code||'')); }
  function nameKey(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
  function rowToPick(r){
    r=r||{};
    return {poolId:String(r.pool_id??r.poolId??''),name:String(r.mon_name??r.name??''),points:Number(r.points)||0,
      team:String(r.team||''),pickNumber:Number(r.pick_number??r.pickNumber)||0,ts:r.created_at||r.ts||null,
      madeBy:'commissioner',faRemoved:!!(r.fa_removed??r.faRemoved)};
  }
  function monName(e){ return typeof e==='string'?e:(e&&e.name)||''; }

  function applyPickToState(state,pick){
    const next={teamMap:state?.teamMap||{},settings:Object.assign({},state?.settings||{})};
    const d=clone(normaliseDraft(next.settings.draft));
    next.settings.draft=d;
    if(d.picks.some(p=>String(p.poolId)===String(pick.poolId))) return next; // idempotent
    const mon=d.pool.find(m=>String(m.id)===String(pick.poolId));
    if(mon){ mon.drafted=true; mon.draftedBy=pick.team; mon.pickNumber=pick.pickNumber; }
    d.picks.push({poolId:pick.poolId,name:pick.name,points:pick.points,team:pick.team,pickNumber:pick.pickNumber,ts:pick.ts,madeBy:pick.madeBy});
    if(d.mode==='ordered'){
      d.currentPick=Math.max(d.currentPick,pick.pickNumber);
      if(d.currentPick>=d.order.length) d.status='complete';
    }
    const rosters=Object.assign({},next.settings.rosters||{});
    rosters[pick.team]=(Array.isArray(rosters[pick.team])?rosters[pick.team].slice():[]).concat([{name:pick.name,points:pick.points}]);
    next.settings.rosters=rosters;
    const fa=next.settings.freeAgency;
    if(pick.faRemoved && fa && Array.isArray(fa.mons)){
      const k=nameKey(pick.name);
      next.settings.freeAgency=Object.assign({},fa,{mons:fa.mons.filter(e=>nameKey(monName(e))!==k)});
    }
    return next;
  }

  function applyRevertToState(state,pick){
    const next={teamMap:state?.teamMap||{},settings:Object.assign({},state?.settings||{})};
    const d=clone(normaliseDraft(next.settings.draft));
    next.settings.draft=d;
    const idx=d.picks.findIndex(p=>String(p.poolId)===String(pick.poolId));
    if(idx<0) return next; // idempotent
    d.picks.splice(idx,1);
    const mon=d.pool.find(m=>String(m.id)===String(pick.poolId));
    if(mon){ mon.drafted=false; mon.draftedBy=null; mon.pickNumber=null; }
    if(d.mode==='ordered') d.currentPick=Math.max(0,d.currentPick-1);
    if(d.status==='complete') d.status='live';
    const rosters=Object.assign({},next.settings.rosters||{});
    const list=(Array.isArray(rosters[pick.team])?rosters[pick.team]:[]).slice();
    const k=nameKey(pick.name);
    for(let i=list.length-1;i>=0;i--){ if(nameKey(monName(list[i]))===k){ list.splice(i,1); break; } }
    rosters[pick.team]=list;
    next.settings.rosters=rosters;
    const fa=next.settings.freeAgency;
    if(pick.faRemoved && fa && Array.isArray(fa.mons) && !fa.mons.some(e=>nameKey(monName(e))===k)){
      next.settings.freeAgency=Object.assign({},fa,{mons:fa.mons.concat([{name:pick.name,points:pick.points}])});
    }
    return next;
  }

  async function version(){
    const c=await ensureCtx();
    if(!c) return null;
    const {data,error}=await db().rpc('sbl_draft_version',{p_league_id:c.leagueId,p_season_id:c.seasonId});
    if(error){ if(isMissingFn(error)) return null; throw error; }
    return data||null;
  }

  /* Per-user planning queue: stored per user per season (draft_queues), with a
     localStorage copy so a missing table never loses the plan. */
  const QKEY=id=>'sbl_draft_queue:'+id;
  async function userId(){ try{ const {data}=await db().auth.getSession(); return data?.session?.user?.id||''; }catch(_){ return ''; } }
  async function loadQueue(){
    const c=await ensureCtx(); if(!c) return [];
    let ids=null;
    try{
      const uid=await userId();
      if(uid){
        const {data,error}=await db().from('draft_queues').select('pool_ids').eq('season_id',c.seasonId).eq('user_id',uid).maybeSingle();
        if(!error && data) ids=Array.isArray(data.pool_ids)?data.pool_ids:[];
      }
    }catch(_){ }
    if(ids===null){ try{ ids=JSON.parse(localStorage.getItem(QKEY(c.seasonId))||'null'); }catch(_){ ids=null; } }
    return Array.isArray(ids)?ids.map(String):[];
  }
  async function saveQueue(ids){
    const c=await ensureCtx(); if(!c) return {ok:false,local:false};
    const list=(ids||[]).map(String);
    try{ localStorage.setItem(QKEY(c.seasonId),JSON.stringify(list)); }catch(_){ }
    try{
      const uid=await userId(); if(!uid) return {ok:false,local:true};
      const {error}=await db().from('draft_queues').upsert(
        {season_id:c.seasonId,user_id:uid,league_id:c.leagueId,pool_ids:list,updated_at:new Date().toISOString()},
        {onConflict:'season_id,user_id'});
      return {ok:!error,local:true,error};
    }catch(e){ return {ok:false,local:true,error:e}; }
  }

  function subscribeLive(h={},channelName='sbl-draft-live'){
    let channel=null,closed=false,timer=null;
    (async()=>{
      try{
        const c=await ensureCtx();
        if(closed||!c) return;
        const picksFilter='season_id=eq.'+c.seasonId;
        channel=db().channel(channelName+':'+c.seasonId);
        channel.on('postgres_changes',{event:'INSERT',schema:'public',table:'draft_picks',filter:picksFilter},
          p=>{ try{ h.onPick?.(rowToPick(p.new)); }catch(e){ console.warn('Draft pick event failed:',e); } });
        channel.on('postgres_changes',{event:'UPDATE',schema:'public',table:'draft_picks',filter:picksFilter},
          p=>{ if(p.new?.reverted_at){ try{ h.onRevert?.(rowToPick(p.new)); }catch(e){ console.warn('Draft revert event failed:',e); } } });
        // Season-row updates (status, budgets, order, pool edits) only trigger a
        // cheap version() check; the blob is downloaded only if config changed.
        channel.on('postgres_changes',{event:'UPDATE',schema:'public',table:'league_seasons',filter:'id=eq.'+c.seasonId},
          ()=>{ clearTimeout(timer); timer=setTimeout(()=>{ try{ h.onCheck?.(); }catch(e){ console.warn(e); } },1200); });
        channel.subscribe(status=>{
          if(status==='SUBSCRIBED') h.onStatus?.(true);
          else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) h.onStatus?.(false);
        });
      }catch(e){ console.warn('Draft live subscription unavailable:',e); }
    })();
    return ()=>{ closed=true; clearTimeout(timer); try{ if(channel) db().removeChannel(channel); }catch(_){ } };
  }

  function subscribe(callback, channelName='sbl-draft-live'){
    const channel=db().channel(channelName);
    if(SBL.leagueDb?.selectedLeagueId?.()){
      channel.on('postgres_changes',{event:'UPDATE',schema:'public',table:'league_seasons'},()=>{ try{ callback?.(); }catch(e){ console.warn('Draft subscription callback failed:',e); } });
    } else {
      channel.on('postgres_changes',{event:'UPDATE',schema:'public',table:'replays'},()=>{ try{ callback?.(); }catch(e){ console.warn('Draft subscription callback failed:',e); } });
    }
    channel.subscribe((status)=>{ if(status==='CHANNEL_ERROR') console.warn('Draft realtime subscription unavailable.'); });
    return ()=>{ try{ db().removeChannel(channel); }catch(_){ } };
  }

  async function read(){
    let data=null,error=null;
    if(SBL.leagueDb?.isAvailable && await SBL.leagueDb.isAvailable(db())){
      const id=SBL.leagueDb.selectedLeagueId();
      const season=await SBL.leagueDb.getSeasonContext(id,db());
      if(season?.id){
        rememberCtx(id,season.id);
        SBL.leagueDb.setSelectedSeasonId?.(season.id,id);
        SBL.leagueDb.setSelectedSeasonKey?.(season.season_key,id);
      }
      if(season?.data){
        const scoped=season.data||{};
        const settings=Object.assign({},scoped.settings||{});
        settings.activeSeason=season.name;
        data={replay_id:STATE_ID,replay_data:{teamMap:scoped.teamMap||{},settings},updated_at:season.updated_at||null};
      } else {
        const snapshot=await SBL.leagueDb.getSnapshot(id,db());
        if(!snapshot) throw new Error('The selected league could not be found.');
        data={replay_id:STATE_ID,replay_data:snapshot.state,updated_at:snapshot.league?.updatedAt||snapshot.league?.updated_at||null};
      }
    }else{
      let q=db().from('replays').select('replay_id,replay_data,updated_at').eq('replay_id',STATE_ID);
      const legacyLeagueId=SBL.leagueDb?.selectedLeagueId?.()||'';
      if(legacyLeagueId) q=q.eq('league_id',legacyLeagueId);
      const result=await q.maybeSingle();
      data=result.data; error=result.error;
    }
    if(error) throw error;
    if(!data) throw new Error('The shared draft state could not be found.');
    const shared=data.replay_data||{};
    return {
      replayId:data.replay_id,
      updatedAt:data.updated_at||null,
      teamMap:shared.teamMap||{},
      settings:Object.assign({},shared.settings||{}, {draft:normaliseDraft(shared.settings?.draft)})
    };
  }

  async function write(snapshot){
    const payload={league_id:SBL.leagueDb?.selectedLeagueId?.()||null,season_id:SBL.leagueDb?.selectedSeasonId?.()||null,replay_data:{teamMap:snapshot.teamMap||{},settings:snapshot.settings||{}},updated_at:new Date().toISOString()};
    if(SBL.leagueDb?.isAvailable && await SBL.leagueDb.isAvailable(db())){
      const leagueId=SBL.leagueDb.selectedLeagueId();
      const season=await SBL.leagueDb.getSeasonContext(leagueId,db());
      if(season) await SBL.leagueDb.saveSeasonState(leagueId,season.id,{teamMap:snapshot.teamMap||{},settings:snapshot.settings||{}},db());
      else await SBL.leagueDb.saveState(leagueId,{teamMap:snapshot.teamMap||{},settings:snapshot.settings||{}},db());
      return payload;
    }
    let q=db().from('replays').update(payload).eq('replay_id',STATE_ID);
    const legacyLeagueId=SBL.leagueDb?.selectedLeagueId?.()||'';
    if(legacyLeagueId) q=q.eq('league_id',legacyLeagueId);
    const {error}=await q;
    if(error) throw error;
    return payload;
  }

  async function mutate(mutator, options={}){
    const attempts=Math.max(1,Number(options.attempts||6));
    const verify=options.verify;
    // Serialize mutations from this browser. Cross-browser races are handled
    // by post-write verification/retry below.
    const run=writeQueue.then(async()=>{
      for(let attempt=0;attempt<attempts;attempt++){
        const fresh=await read();
        const next=clone(fresh);
        next.settings=next.settings||{};
        next.settings.rosters=next.settings.rosters||{};
        next.settings.draft=normaliseDraft(next.settings.draft);
        const result=await mutator(next.settings.draft,next);
        if(result===false) return {changed:false,state:fresh,result:null};
        await write(next);
        const committed=await read();
        const ok=typeof verify==='function' ? await verify(committed,result) : true;
        if(ok){
          return {changed:true,state:committed,result};
        }
        await sleep(40*(attempt+1));
      }
      throw new Error('The draft could not be confirmed after several sync attempts. Refresh the room and try again.');
    });
    writeQueue=run.catch(()=>{});
    return run;
  }

  async function replaceDraft(draft, extraSettings={}, userRequired=true){
    return mutate((d,next)=>{
      next.settings.draft=normaliseDraft(draft);
      Object.assign(next.settings, extraSettings||{});
    },{attempts:4});
  }


  const teamKey = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' ');
  function canonicalDraftTeam(draft, team){
    const candidates=[...(draft?.order||[]),...Object.keys(draft?.budgets||{}),...Object.keys(draft?.rosters||{}),...Object.keys(draft?.franchises||{}),...(draft?.picks||[]).map(p=>p.team)];
    return candidates.find(name=>teamKey(name)===teamKey(team)) || String(team||'').trim();
  }
  async function applyPick(poolId, team, madeBy='team_owner', base=null, opts={}){
    const c=await ensureCtx();
    const current=base || await read();
    const canonicalTeam=canonicalDraftTeam(current?.settings?.draft,team);
    if(c){
      const {data,error}=await db().rpc('sbl_draft_pick',{p_league_id:c.leagueId,p_season_id:c.seasonId,
        p_pool_id:String(poolId),p_team:canonicalTeam,p_override:!!opts.override});
      if(!error){
        const pick=rowToPick(data);
        const state=base?applyPickToState(base,pick):await read();
        return {changed:true,state,pick,result:{kind:'pick',poolId:pick.poolId,team:pick.team,pickNumber:pick.pickNumber}};
      }
      if(String(error?.code||'')==='23505' && /draft_picks_active_number|draft_picks_active_pool/i.test(String(error?.message||error?.details||''))){
        throw new Error('The draft pick ledger is out of sync with the current draft. Apply Supabase migration 037_cp429_draft_active_pick_reconciliation.sql, then retry this pick. Your current pick has not been recorded.');
      }
      if(!isMissingFn(error)) throw error;
      console.warn('sbl_draft_pick is not installed (run migration 021); using the legacy draft path.');
    }
    return applyPickLegacy(poolId,canonicalTeam,madeBy);
  }

  async function applyPickLegacy(poolId, team, madeBy='team_owner'){
    const rpc={
      p_pool_id:String(poolId),
      p_team:String(team),
      p_made_by:String(madeBy)
    };
    const {data,error}=await db().rpc('sbl_apply_draft_pick',rpc);
    if(!error){
      // The RPC is the authoritative mutation. Read the row once after the
      // transaction so every caller receives the same canonical shape.
      const state=await read();
      const d=state.settings?.draft || {};
      const pick=d.picks?.find(p => String(p.poolId)===String(poolId)
        && teamKey(p.team)===teamKey(team));
      if(!pick){
        throw new Error('The pick was accepted by the database but the updated draft state could not be read back.');
      }
      return {changed:true,state,result:{kind:'pick',poolId:String(poolId),team:String(team),pickNumber:Number(pick.pickNumber)}};
    }

    // The fallback is deliberately retained for deployments where the RPC has
    // not been installed yet. Once the SQL migration is present, normal picks
    // never use this path.
    if(error.code && !['PGRST202','42883'].includes(String(error.code))) throw error;
    return mutate((draft,snapshot)=>{
      if(draft.status!=='live') throw new Error('The draft is not live.');
      const target=draft.pool.find(m=>String(m.id)===String(poolId));
      if(!target || target.drafted) throw new Error('That Pokémon is no longer available.');
      const currentTeam=draft.mode==='ordered' ? draft.order[draft.currentPick] : team;
      if(!currentTeam || teamKey(currentTeam)!==teamKey(team)) throw new Error('It is not your turn.');
      const spent=draft.picks.filter(p=>teamKey(p.team)===teamKey(team)).reduce((n,p)=>n+(Number(p.points)||0),0);
      const budgetKey=Object.keys(draft.budgets||{}).find(k=>teamKey(k)===teamKey(team));
      const budget=Number((budgetKey==null?draft.defaultBudget:draft.budgets[budgetKey]))||0;
      if(spent+Number(target.points||0)>budget) throw new Error('That pick exceeds your remaining budget.');
      if(draft.picks.filter(p=>teamKey(p.team)===teamKey(team)).length>=draft.maxPicks) throw new Error('Your roster has reached the maximum number of Pokémon.');
      const pickNumber=draft.mode==='ordered' ? Number(draft.currentPick)+1 : draft.picks.length+1;
      target.drafted=true; target.draftedBy=team; target.pickNumber=pickNumber;
      draft.picks.push({poolId:String(target.id),name:target.name,points:Number(target.points)||0,team:String(team),pickNumber,ts:new Date().toISOString(),madeBy});
      draft.currentPick=draft.mode==='ordered' ? Number(draft.currentPick)+1 : Number(draft.currentPick)||0;
      if(draft.mode==='ordered' && draft.currentPick>=draft.order.length) draft.status='complete';
      if(!snapshot.settings.rosters) snapshot.settings.rosters={};
      snapshot.settings.rosters[team]=Array.isArray(snapshot.settings.rosters[team])?snapshot.settings.rosters[team]:[];
      snapshot.settings.rosters[team].push({name:target.name,points:Number(target.points)||0});
      return {kind:'pick',poolId:String(target.id),team:String(team),pickNumber};
    },{
      attempts:4,
      verify:(committed,result)=>{
        const d=normaliseDraft(committed.settings?.draft);
        return d.picks.some(p=>String(p.poolId)===String(result?.poolId)
          && String(p.team)===String(result?.team)
          && Number(p.pickNumber)===Number(result?.pickNumber));
      }
    });
  }

  async function revertLastPick(base=null){
    const c=await ensureCtx();
    if(c){
      const {data,error}=await db().rpc('sbl_draft_revert_last',{p_league_id:c.leagueId,p_season_id:c.seasonId});
      if(!error){
        const pick=rowToPick(data);
        const state=base?applyRevertToState(base,pick):await read();
        return {changed:true,state,pick,result:{kind:'revert'}};
      }
      if(!isMissingFn(error)) throw error;
      console.warn('sbl_draft_revert_last is not installed (run migration 021); using the legacy path.');
    }
    return revertLastPickLegacy();
  }

  async function revertLastPickLegacy(){
    const {data,error}=await db().rpc('sbl_revert_last_draft_pick');
    if(!error){
      const state=await read();
      return {changed:true,state,result:{kind:'revert'}};
    }
    if(error.code && !['PGRST202','42883'].includes(String(error.code))) throw error;
    return mutate((draft,snapshot)=>{
      if(!draft.picks.length) throw new Error('There are no picks to revert.');
      const last=draft.picks[draft.picks.length-1];
      const target=draft.pool.find(x=>String(x.id)===String(last.poolId));
      if(target){target.drafted=false;target.draftedBy=null;target.pickNumber=null;}
      draft.picks.pop();
      if(draft.mode==='ordered') draft.currentPick=Math.max(0,Number(draft.currentPick)-1);
      if(draft.status==='complete') draft.status='live';
      const roster=Array.isArray(snapshot.settings.rosters?.[last.team])?snapshot.settings.rosters[last.team]:[];
      const idx=roster.findIndex(m=>String(m.name)===String(last.name)&&Number(m.points)===Number(last.points));
      if(idx>=0) roster.splice(idx,1);
      snapshot.settings.rosters[last.team]=roster;
      return {kind:'revert'};
    },{attempts:4});
  }

  async function openLobby(currentDraft, rosters={}){
    return mutate((draft,snapshot)=>{
      if(!Array.isArray(draft.pool) || !draft.pool.length) throw new Error('Add at least one Pokémon to the draft board first.');
      draft.status='lobby';
      draft.currentPick=0;
      draft.picks=[];
      draft.pool.forEach(m=>{m.drafted=false;m.draftedBy=null;m.pickNumber=null;});
      draft.preDraftRosters=clone(rosters||{});
      snapshot.settings.rosters=clone(rosters||{});
      return {kind:'open_lobby'};
    },{attempts:4});
  }

  async function startDraft(){
    return mutate((draft)=>{
      if(draft.status!=='lobby') throw new Error('Open the Draft Room lobby before starting the draft.');
      if(!draft.pool.length) throw new Error('Add at least one Pokémon to the draft board first.');
      if(draft.mode==='ordered' && !draft.order.length) throw new Error('Generate a draft order first, or switch to manual mode.');
      draft.status='live';
      draft.currentPick=0;
      return {kind:'start'};
    },{attempts:4});
  }

  async function endDraft(){
    return mutate((draft)=>{
      if(draft.status!=='live') throw new Error('Only a live draft can be ended.');
      draft.status='complete';
      if(draft.mode==='ordered' && draft.order.length) draft.currentPick=Math.min(Number(draft.currentPick)||0,draft.order.length);
      return {kind:'end'};
    },{attempts:4});
  }

  async function resetDraft(){
    return mutate((draft,snapshot)=>{
      draft.pool.forEach(m=>{m.drafted=false;m.draftedBy=null;m.pickNumber=null;});
      draft.picks=[];
      draft.currentPick=0;
      draft.status='setup';
      if(draft.preDraftRosters){
        snapshot.settings.rosters=clone(draft.preDraftRosters);
      }
      draft.preDraftRosters=null;
      return {kind:'reset'};
    },{attempts:4});
  }

  async function saveDraftState(draft, extraSettings={}){
    return mutate((fresh,snapshot)=>{
      const incoming=normaliseDraft(draft);
      // Draft setup edits happen before live play. If a live draft is being
      // edited, only preserve the live pick state from the fresh snapshot and
      // merge non-pick configuration fields. This prevents an admin tab from
      // accidentally overwriting a participant's latest pick.
      if(fresh.status==='live' || fresh.status==='complete'){
        const preserved={...fresh};
        const editable=['defaultBudget','budgets','minPicks','maxPicks','mode','order','pool'];
        for(const key of editable){
          if(key==='pool'){
            // Never overwrite drafted flags/pick metadata from a live snapshot.
            const incomingById=new Map(incoming.pool.map(m=>[String(m.id),m]));
            preserved.pool=preserved.pool.map(m=>{
              const candidate=incomingById.get(String(m.id));
              if(!candidate) return m;
              return m.drafted ? {...m,baseStats:candidate.baseStats||m.baseStats} : candidate;
            });
          } else if(key!=='mode' || fresh.picks.length===0){
            preserved[key]=clone(incoming[key]);
          }
        }
        snapshot.settings.draft=preserved;
      }else{
        snapshot.settings.draft=incoming;
      }
      Object.assign(snapshot.settings,extraSettings||{});
    },{attempts:4});
  }

  SBL.draft={STATE_ID,read,version,queue:{load:loadQueue,save:saveQueue},subscribe,subscribeLive,applyPickToState,applyRevertToState,rowToPick,subscribe,mutate,replaceDraft,applyPick,revertLastPick,saveDraftState,openLobby,startDraft,endDraft,resetDraft,normaliseDraft};
})();
