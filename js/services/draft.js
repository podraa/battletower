/* Shared Draft persistence/orchestration.
 * Draft state lives in selected league_seasons.data.settings.draft.
 * Commissioner lifecycle and setup writes go through a season-row-locked RPC;
 * browser snapshot overwrites are intentionally disabled.
 */
(function(){
  'use strict';
  const SBL = window.SBL = window.SBL || {};
  const STATE_ID='__dashboard_state__';

  function db(){ return SBL.getSupabase(); }
  function clone(v){ return JSON.parse(JSON.stringify(v ?? {})); }
  function normaliseDraft(d){
    const x=Object.assign({status:'setup',mode:'manual',defaultBudget:120,budgets:{},pool:[],order:[],currentPick:0,picks:[],minPicks:10,maxPicks:10}, d||{});
    delete x.lottery; // CP4.66: discard legacy lottery state; draft order is admin-entered only.
    x.budgets=x.budgets&&typeof x.budgets==='object'?x.budgets:{};
    x.authorizedPickerIds=Array.isArray(x.authorizedPickerIds)?[...new Set(x.authorizedPickerIds.map(String))]:[];
    x.pool=Array.isArray(x.pool)?x.pool:[];
    x.order=Array.isArray(x.order)?x.order.map(String):[];
    x.picks=Array.isArray(x.picks)?x.picks:[];
    x.skippedPicks=Array.isArray(x.skippedPicks)?x.skippedPicks:[];
    x.endedTeams=x.endedTeams&&typeof x.endedTeams==='object'?x.endedTeams:{};
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
    const selected=SBL.leagueDb?.selectedSeasonId?.(lid)||'';
    if(ctx && ctx.leagueId===lid && (!selected || ctx.seasonId===selected)) return ctx;
    if(!lid) return null;
    await read();
    return (ctx && ctx.leagueId===lid && (!selected || ctx.seasonId===selected))?ctx:null;
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
      advancePastEndedTeams(d);
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
  const QKEY=(leagueId,seasonId,uid)=>'sbl_draft_queue:'+leagueId+':'+seasonId+':'+uid;
  // CP4.141: draft reset invalidates browser-only copies, too. This token is
  // written by the commissioner reset RPC in the selected season's draft state.
  // The user's browser clears its OWN named handoffs when they next visit;
  // those browser-local plans cannot be remotely enumerated by a commissioner.
  function applyQueueResetToken(c,uid,token,mode){
    if(!token||!c?.leagueId||!c?.seasonId||!uid)return false;
    const marker='sbl_draft_queue_reset_seen:'+c.leagueId+':'+c.seasonId+':'+uid;
    try{
      if(localStorage.getItem(marker)===token)return false;
      localStorage.removeItem(QKEY(c.leagueId,c.seasonId,uid));
      localStorage.removeItem('sbl_draft_queue:'+c.seasonId); // old unscoped fallback
      if(mode==='clear') localStorage.removeItem('sbl_planner_handoffs_v1:'+uid+':'+c.leagueId+':'+c.seasonId);
      localStorage.setItem(marker,token);
      return true;
    }catch(_){return false;}
  }
  function queueResetTokenFromDraft(d){return String(d?.queueResetToken||'');}
  async function syncQueueReset(){
    const state=await read();
    const c=await ensureCtx();
    const uid=await userId();
    const token=queueResetTokenFromDraft(state.settings?.draft);
    const mode=String(state.settings?.draft?.queueResetMode||'clear');
    const changed=applyQueueResetToken(c,uid,token,mode);
    return {token,changed};
  }
  async function userId(){ try{ const {data}=await db().auth.getSession(); return data?.session?.user?.id||''; }catch(_){ return ''; } }
  async function loadQueue(){
    const c=await ensureCtx(); if(!c) return [];
    let ids=null;
    let resetToken='';
    try{ const reset=await syncQueueReset();resetToken=reset.token; }catch(e){console.warn('Draft queue reset check unavailable:',e);}
    try{
      const uid=await userId();
      if(uid){
        const {data,error}=await db().from('draft_queues').select('pool_ids').eq('season_id',c.seasonId).eq('user_id',uid).maybeSingle();
        if(!error && data) ids=Array.isArray(data.pool_ids)?data.pool_ids:[];
      }
    }catch(_){ }
    // After a commissioner reset, a deleted server row means EMPTY, not a
    // reason to resurrect an obsolete browser cache.
    if(ids===null && resetToken) ids=[];
    if(ids===null){ try{ ids=JSON.parse(localStorage.getItem(QKEY(c.leagueId,c.seasonId,await userId()))||'null'); }catch(_){ ids=null; } }
    return Array.isArray(ids)?ids.map(String):[];
  }
  async function saveQueue(ids){
    const c=await ensureCtx(); if(!c) return {ok:false,local:false};
    const list=(ids||[]).map(String);
    try{await syncQueueReset();}catch(_){ }
    try{ localStorage.setItem(QKEY(c.leagueId,c.seasonId,await userId()),JSON.stringify(list)); }catch(_){ }
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
      const requested=SBL.leagueDb.selectedSeasonId?.(id)||'';
      const season=await SBL.leagueDb.getSeasonContext(id,db(),requested?{seasonId:requested}:{});
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

  // CP4.171: the browser no longer writes a whole draft/roster snapshot.
  // Every commissioner command locks the selected league_seasons row in SQL.
  async function command(action,payload={}){
    const c=await ensureCtx();
    if(!c) throw new Error('Choose an active league and season before changing the draft.');
    const {data,error}=await db().rpc('sbl_draft_admin_command',{
      p_league_id:c.leagueId,p_season_id:c.seasonId,p_action:action,p_payload:payload
    });
    if(error){
      if(isMissingFn(error)) throw new Error('Install migration 061_cp4171_atomic_draft_admin_commands.sql before using the draft controls. No changes were saved.');
      throw error;
    }
    // No optimistic browser overlays: the returned season state is canonical.
    const state=await read();
    return {changed:data?.changed!==false,state,result:data||{action}};
  }
  async function mutate(){
    throw new Error('Generic browser draft mutations are disabled. Use the atomic commissioner commands.');
  }
  async function replaceDraft(draft,extraSettings={}){
    if(Object.keys(extraSettings||{}).length) throw new Error('Draft setup cannot overwrite other season settings.');
    return command('save_setup',{draft:normaliseDraft(draft)});
  }

  const teamKey = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' ');
  function canonicalDraftTeam(draft, team){
    const candidates=[...(draft?.order||[]),...Object.keys(draft?.budgets||{}),...Object.keys(draft?.rosters||{}),...Object.keys(draft?.franchises||{}),...(draft?.picks||[]).map(p=>p.team)];
    return candidates.find(name=>teamKey(name)===teamKey(team)) || String(team||'').trim();
  }
  function hasSkippedSlot(draft,index,team){
    return (draft.skippedPicks||[]).some(x=>Number(x.slot)===index+1 && teamKey(x.team)===teamKey(team));
  }
  function endedTeamRecord(draft,team){
    const key=Object.keys(draft.endedTeams||{}).find(k=>teamKey(k)===teamKey(team));
    return key ? draft.endedTeams[key] : null;
  }
  function addSkippedSlot(draft,index,team,reason){
    draft.skippedPicks=Array.isArray(draft.skippedPicks)?draft.skippedPicks:[];
    if(draft.skippedPicks.some(x=>Number(x.slot)===index+1&&teamKey(x.team)===teamKey(team))) return false;
    draft.skippedPicks.push({kind:'skip',team:String(team),slot:index+1,reason:String(reason||'Commissioner skipped this pick'),ts:new Date().toISOString()});
    return true;
  }
  function advancePastEndedTeams(draft){
    if(draft.mode!=='ordered') return 0;
    let advanced=0;
    while(draft.currentPick<draft.order.length){
      const team=String(draft.order[draft.currentPick]||'').trim();
      const ended=endedTeamRecord(draft,team);
      if(!ended) break;
      addSkippedSlot(draft,draft.currentPick,team,'Franchise ended drafting: '+(ended.reason||'Commissioner decision'));
      draft.currentPick++; advanced++;
    }
    if(draft.currentPick>=draft.order.length) draft.status='complete';
    return advanced;
  }
  async function advanceEndedTeams(){
    return command('advance');
  }
  async function applyPick(poolId, team, madeBy='team_owner', base=null, opts={}){
    const c=await ensureCtx();
    const current=base || await read();
    const canonicalTeam=canonicalDraftTeam(current?.settings?.draft,team);
    if(endedTeamRecord(current?.settings?.draft||{},canonicalTeam)) throw new Error('This franchise has finished drafting and cannot make further picks.');
    // Mega rule (max 2 per team; the minimum of 1 is enforced on a team's last turn).
    // A commissioner override bypasses it, like the other pick rules.
    if(SBL.draftDash){
      const dd=current?.settings?.draft;
      const target=(dd?.pool||[]).find(m=>String(m.id)===String(poolId));
      const block=target?SBL.draftDash.megaBlock?.(dd,canonicalTeam,target):null;
      if(block) throw new Error(block.message);
      if(!opts.override && target && SBL.draftDash.canAfford && !SBL.draftDash.canAfford(dd,canonicalTeam,target)){
        throw new Error('This pick would leave insufficient points to complete the required roster and reserve an available Mega. Choose a lower-cost Pokémon or resolve the pool/budget with the commissioner.');
      }
    }
    if(c){
      const {data,error}=await db().rpc('sbl_draft_pick',{p_league_id:c.leagueId,p_season_id:c.seasonId,
        p_pool_id:String(poolId),p_team:canonicalTeam,p_override:!!opts.override});
      if(!error){
        const pick=rowToPick(data);
        let state=base?applyPickToState(base,pick):await read();
        try{await advanceEndedTeams();state=await read();}catch(e){console.warn('Could not advance franchises that have finished drafting:',e);}
        return {changed:true,state,pick,result:{kind:'pick',poolId:pick.poolId,team:pick.team,pickNumber:pick.pickNumber}};
      }
      if(String(error?.code||'')==='23505' && /draft_picks_active_number|draft_picks_active_pool/i.test(String(error?.message||error?.details||''))){
        throw new Error('The draft pick ledger is out of sync with the current draft. Apply Supabase migration 037_cp429_draft_active_pick_reconciliation.sql, then retry this pick. Your current pick has not been recorded.');
      }
      if(!isMissingFn(error)) throw error;
      throw new Error('Install the required draft pick migration before drafting. Legacy writes are disabled.');
    }
    throw new Error('Select an active league season and install the draft migrations. Legacy writes are disabled.');
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
      throw new Error('Install the required draft revert migration. Legacy writes are disabled.');
    }
    throw new Error('Select an active league season before reverting picks.');
  }

  async function openLobby(){ return command('open_lobby'); }
  async function startDraft(){ return command('start'); }
  async function skipCurrentPick(reason='Commissioner skipped this pick'){
    return command('skip',{reason:String(reason)});
  }
  async function endFranchiseDraft(team,reason='No points remaining'){
    const target=String(team||'').trim();
    if(!target)throw new Error('Choose a franchise first.');
    return command('end_team',{team:target,reason:String(reason)});
  }
  async function endDraft(){ return command('end'); }

  async function resetDraft(queueAction){
    if(!['restore','clear','keep'].includes(queueAction)) throw new Error('Choose what to do with draft plans first.');
    const c=await ensureCtx();
    if(!c) throw new Error('Select an active league season before resetting the draft.');
    const {data,error}=await db().rpc('sbl_draft_reset',{
      p_league_id:c.leagueId,p_season_id:c.seasonId,p_queue_action:queueAction
    });
    if(error){
      if(isMissingFn(error))throw new Error('Install the CP4.142 draft reset migration. Legacy resets are disabled.');
      throw error;
    }
    return {changed:true,state:await read(),result:data||{kind:'reset'}};
  }
  async function saveDraftState(draft,extraSettings={}){
    if(Object.keys(extraSettings||{}).length) throw new Error('Draft setup cannot overwrite other season settings.');
    return command('save_setup',{draft:normaliseDraft(draft)});
  }

  async function trackerStatus(){
    const c=await ensureCtx();if(!c)throw new Error('No league season selected.');
    const {data,error}=await db().rpc('sbl_draft_tracker_status',{p_league_id:c.leagueId,p_season_id:c.seasonId});
    if(error)throw error;
    return data;
  }
  async function trackerExport(){
    const c=await ensureCtx();if(!c)throw new Error('No league season selected.');
    // The database policy forbids the download until the season's draft is
    // complete. Do not bypass this with privileged credentials in the browser.
    const all=[];let offset=0;
    for(;;){
      const {data,error}=await db().from('draft_tracker_events')
        .select('*').eq('league_id',c.leagueId).eq('season_id',c.seasonId)
        .order('pick_id',{ascending:true}).range(offset,offset+499);
      if(error)throw error;
      all.push(...(data||[]));
      if(!data||data.length<500)break;
      offset+=500;
    }
    return {format:'draft-tracker-v1',league_id:c.leagueId,season_id:c.seasonId,exported_at:new Date().toISOString(),events:all};
  }

  SBL.draft={STATE_ID,read,version,queue:{load:loadQueue,save:saveQueue,syncReset:syncQueueReset},tracker:{status:trackerStatus,export:trackerExport},subscribe,subscribeLive,applyPickToState,applyRevertToState,rowToPick,subscribe,mutate,replaceDraft,applyPick,revertLastPick,saveDraftState,openLobby,startDraft,endDraft,skipCurrentPick,endFranchiseDraft,resetDraft,normaliseDraft};
})();
