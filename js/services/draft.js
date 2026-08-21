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
    x.pool=Array.isArray(x.pool)?x.pool:[];
    x.order=Array.isArray(x.order)?x.order.map(String):[];
    x.picks=Array.isArray(x.picks)?x.picks:[];
    x.currentPick=Math.max(0,Number(x.currentPick)||0);
    return x;
  }

  function subscribe(callback, channelName='sbl-draft-live'){
    const channel=db().channel(channelName)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'replays',filter:'replay_id=eq.__dashboard_state__'},()=>{ try{ callback?.(); }catch(e){ console.warn('Draft subscription callback failed:',e); } });
    channel.subscribe((status)=>{ if(status==='CHANNEL_ERROR') console.warn('Draft realtime subscription unavailable.'); });
    return ()=>{ try{ db().removeChannel(channel); }catch(_){ } };
  }

  async function read(){
    const {data,error}=await db().from('replays')
      .select('replay_id,replay_data,updated_at')
      .eq('replay_id',STATE_ID).maybeSingle();
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
    const payload={
      replay_data:{teamMap:snapshot.teamMap||{},settings:snapshot.settings||{}},
      updated_at:new Date().toISOString()
    };
    const {error}=await db().from('replays')
      .update(payload)
      .eq('replay_id',STATE_ID);
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


  async function applyPick(poolId, team, madeBy='team_owner'){
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
        && String(p.team)===String(team));
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
      if(!currentTeam || String(currentTeam)!==String(team)) throw new Error('It is not your turn.');
      const spent=draft.picks.filter(p=>String(p.team)===String(team)).reduce((n,p)=>n+(Number(p.points)||0),0);
      const budget=Number(draft.budgets?.[team] ?? draft.defaultBudget)||0;
      if(spent+Number(target.points||0)>budget) throw new Error('That pick exceeds your remaining budget.');
      if(draft.picks.filter(p=>String(p.team)===String(team)).length>=draft.maxPicks) throw new Error('Your roster has reached the maximum number of Pokémon.');
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

  async function revertLastPick(){
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
              return m.drafted ? m : candidate;
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

  SBL.draft={STATE_ID,read,subscribe,mutate,replaceDraft,applyPick,revertLastPick,saveDraftState,openLobby,startDraft,endDraft,resetDraft,normaliseDraft};
})();
