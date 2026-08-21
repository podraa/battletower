(function(){
'use strict';
const supabase=SBL.getSupabase(), STATE_ID='__dashboard_state__';
const $=id=>document.getElementById(id), content=$('content');
let state={teamMap:{},settings:{draft:null,rosters:{}}}, session=null, profile=null, filter='', bootError='';
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function defaultDraft(){return{status:'setup',mode:'manual',defaultBudget:120,budgets:{},pool:[],order:[],currentPick:0,picks:[],minPicks:10,maxPicks:10,updatedAt:null}}
function normalise(d){const x=Object.assign(defaultDraft(),d||{});x.budgets=x.budgets&&typeof x.budgets==='object'?x.budgets:{};x.pool=Array.isArray(x.pool)?x.pool.map((m,i)=>({id:String(m?.id||m?.name||i),name:String(m?.name||'').trim(),points:Number(m?.points)||0,types:Array.isArray(m?.types)?m.types:[],drafted:!!m?.drafted,draftedBy:m?.draftedBy||null,pickNumber:m?.pickNumber??null})).filter(m=>m.name):[];x.order=Array.isArray(x.order)?x.order.map(String):[];x.picks=Array.isArray(x.picks)?x.picks:[];x.currentPick=Math.max(0,Number(x.currentPick)||0);x.minPicks=Math.max(10,Number(x.minPicks)||10);x.maxPicks=Math.max(x.minPicks,Number(x.maxPicks)||x.minPicks);if(!['setup','lobby','live','complete'].includes(x.status))x.status='setup';if(!['manual','ordered'].includes(x.mode))x.mode='manual';return x}
async function readState(){const shared=await SBL.draft.read();state={teamMap:shared.teamMap||{},settings:Object.assign({},shared.settings||{}),updatedAt:shared.updatedAt||null};state.settings.rosters=state.settings.rosters||{};state.settings.draft=normalise(state.settings.draft);}
function newMutationId(){return (crypto?.randomUUID?.()||('draft-'+Date.now()+'-'+Math.random().toString(36).slice(2))).toString();}
async function readIdentity(){const s=await supabase.auth.getSession();if(s.error)throw s.error;session=s.data?.session||null;if(!session?.user)return;try{profile=await SBL.profiles.get(session.user.id,'team_name,is_commissioner',supabase);}catch(_){profile=null;}}
function teams(){const d=state.settings.draft;const out=[];[...(d.order||[]),...Object.keys(state.settings.rosters||{}),...Object.keys(state.settings.franchises||{}),...Object.keys(state.teamMap||{})].forEach(t=>{const s=String(t||'').trim();if(s&&!out.includes(s))out.push(s)});return out}
function myTeam(){return String(profile?.team_name||'').trim()}
function budget(t){const d=state.settings.draft;return Number(d.budgets?.[t]??d.defaultBudget)||0}
function spent(t){return state.settings.draft.picks.filter(p=>p.team===t).reduce((n,p)=>n+(Number(p.points)||0),0)}
function onClock(){const d=state.settings.draft;return d.mode==='ordered'?(d.order[d.currentPick]||null):null}
function pickCount(d,t){return d.picks.filter(p=>p.team===t).length}
function isAdmin(){return !!profile?.is_commissioner}
function canPickFor(t){const d=state.settings.draft;if(d.status!=='live'||!t)return false;if(!isAdmin()&&(!myTeam()||t!==myTeam()))return false;if(pickCount(d,t)>=d.maxPicks)return false;if(!isAdmin()&&d.mode==='ordered'&&onClock()!==t)return false;return true}
function sprite(name){try{return SBL.pokemon.spriteMarkup(name,'sprite')}catch{return ''}}
function showError(title,msg){content.innerHTML='<div class="errorbox"><strong>'+esc(title)+'</strong><div class="note" style="margin-top:6px">'+esc(msg)+'</div><div class="actions"><button class="ghost" id="retry">Retry</button></div></div>';$('retry').onclick=boot}
function render(){const d=state.settings.draft;const ts=teams();const seasonEl=$('seasonLabel'),teamEl=$('myTeamLabel'),roleEl=$('roleLabel');if(seasonEl)seasonEl.textContent=state.settings.activeSeason||'Current season';if(teamEl)teamEl.textContent=myTeam()||'your franchise';if(roleEl)roleEl.innerHTML=isAdmin()?'You have <strong>commissioner controls</strong> as well as your normal team-owner view.':'You can make picks for your franchise.';if(!d||d.status==='setup'){content.innerHTML='<div class="panel"><h2>Draft not ready</h2><div class="empty">The commissioner has not opened the Draft Room yet.</div></div>';return}if(d.status==='lobby'){content.innerHTML='<div class="panel"><h2>Draft Room is open</h2><div class="empty">The commissioner has opened the room. Join now and wait here. The draft will not begin until the commissioner starts it.</div></div>'+(isAdmin()?adminPanel(d,ts):'');wireSearch();return}const admin=isAdmin()?adminPanel(d,ts):'';if(d.status==='complete'){content.innerHTML=clockPanel(d)+budgetPanel(d)+rosterPanel(d)+admin+'<div class="panel">'+board(d,ts,false)+'</div>';wireSearch();return}content.innerHTML=clockPanel(d)+budgetPanel(d)+rosterPanel(d)+admin+'<div class="panel">'+board(d,ts,true)+'</div>';wireSearch()}
function adminPanel(d,ts){const available=d.pool.filter(m=>!m.drafted).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name));const latest=d.picks.length?d.picks[d.picks.length-1]:null;return '<div class="panel"><h2>Commissioner controls</h2><div class="note">You can use the normal team-owner controls above, plus make a pick for any franchise. In ordered mode, a manual pick for another franchise does not advance the clock unless that franchise is currently on the clock.</div><div class="toolbar"><select id="adminTargetTeam" style="flex:1;min-width:200px;background:var(--panel-alt);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px 12px">'+ts.map(t=>'<option value="'+esc(t)+'" '+(t===(d.mode==='ordered'?onClock():myTeam())?'selected':'')+'>'+esc(t)+' — '+pickCount(d,t)+'/'+d.maxPicks+' picks · '+(budget(t)-spent(t))+' pts left</option>').join('')+'</select><select id="adminTargetPokemon" style="flex:1;min-width:220px;background:var(--panel-alt);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px 12px"><option value="">Select Pokémon</option>'+available.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+' — '+m.points+' pts</option>').join('')+'</select><button class="primary" id="adminPickBtn" '+(d.status==='live'?'':'disabled')+'>Make pick</button></div><div class="actions">'+(latest?'<button class="ghost" id="revertLastPickBtn">Revert last pick: '+esc(latest.name)+' → '+esc(latest.team)+'</button>':'')+'</div><div class="note danger" id="adminActionErr"></div></div>'}
function clockPanel(d){const oc=onClock();let text=d.mode==='ordered'?(oc?'On the clock: <span class="amber">'+esc(oc)+'</span>':'Draft order complete'):'Manual mode';let msg=!session?'Log in to make your picks.':!myTeam()?'Your account has no assigned franchise.':d.mode==='ordered'&&oc!==myTeam()?'Waiting for '+esc(oc||'the next franchise')+'.':canPickFor(myTeam())?'You are on the clock. Select an available Pokémon below.':'You can view the board, but you cannot pick right now.';return '<div class="panel"><div class="clock"><div><div class="who">'+text+'</div><div class="note">'+esc(msg)+'</div></div><div class="pickno">Pick #'+(d.currentPick+1)+' of '+d.order.length+'</div></div></div>'}

function budgetPanel(d){
  const team=myTeam();
  if(!team){
    return '<div class="panel"><h2>Your franchise</h2><div class="empty">Your account does not have an assigned franchise yet.</div></div>';
  }
  const total=budget(team);
  const used=spent(team);
  const remaining=total-used;
  return '<div class="panel"><h2>Your budget</h2>'+
    '<div class="budget-strip"><div class="budget-chip mine">'+
      '<div class="team">'+esc(team)+' <span class="badge">You</span></div>'+
      '<div class="amt '+(remaining<0?'neg':'pos')+'">'+remaining+' / '+total+' pts remaining</div>'+
    '</div></div></div>';
}
function rosterPanel(d){
  const team=myTeam();
  if(!team) return '';
  const roster=Array.isArray(state.settings.rosters?.[team]) ? state.settings.rosters[team] : [];
  const picks=d.picks.filter(p=>p.team===team);
  const entries=roster.length ? roster : picks;
  return '<div class="panel"><h2>Your roster <span class="badge">'+entries.length+'</span></h2>'+
    (entries.length
      ? '<div class="roster-draft-list">'+entries.map(m=>
          '<div class="roster-draft-row"><span>'+esc(m.name||'')+'</span><span>'+Number(m.points||0)+' pts</span></div>'
        ).join('')+'</div>'
      : '<div class="empty">You have no Pokémon on your roster yet.</div>')+
    '</div>';
}
function board(d,ts,clickable){const q=filter.toLowerCase();const mons=d.pool.filter(m=>!q||m.name.toLowerCase().includes(q));const groups={};mons.forEach(m=>(groups[m.points]??=[]).push(m));const tiers=Object.keys(groups).sort((a,b)=>Number(b)-Number(a));return '<h2>Draft board</h2><div class="toolbar"><input id="poolSearch" placeholder="Search Pokémon…" value="'+esc(filter)+'"><span class="badge">'+d.pool.filter(m=>!m.drafted).length+' available</span><span class="badge">'+d.pool.filter(m=>m.drafted).length+' drafted</span></div>'+(tiers.length?tiers.map(p=>'<div class="tier"><div class="tier-title">'+esc(p)+' points</div><div class="grid">'+groups[p].sort((a,b)=>a.name.localeCompare(b.name)).map(m=>{const ok=clickable&&canPickFor(myTeam())&&!m.drafted&&spent(myTeam())+m.points<=budget(myTeam());return '<div class="mon '+(!ok?'disabled':'')+'" '+(ok?'data-pick="'+esc(m.id)+'"':'')+'>'+sprite(m.name)+'<div class="name">'+esc(m.name)+'</div><div class="pts">'+m.points+' pts</div>'+(m.drafted?'<div class="taken">→ '+esc(m.draftedBy||'')+'</div>':(!ok&&clickable?'<div class="taken">Not selectable</div>':''))+'</div>'}).join('')+'</div></div>').join(''):'<div class="empty">No Pokémon match your search.</div>')}
function wireSearch(){$('poolSearch')?.addEventListener('input',e=>{filter=e.target.value;render();const x=$('poolSearch');if(x){x.focus();x.setSelectionRange(x.value.length,x.value.length)}});document.querySelectorAll('[data-pick]').forEach(el=>el.addEventListener('click',()=>openPick(el.dataset.pick)));$('adminPickBtn')?.addEventListener('click',async()=>{const err=$('adminActionErr');if(err)err.textContent='';const team=$('adminTargetTeam')?.value;const id=$('adminTargetPokemon')?.value;const m=state.settings.draft.pool.find(x=>x.id===id);if(!team||!m){err.textContent='Select a franchise and Pokémon first.';return}try{await saveAdminPick(team,m);await refreshDraftRoom()}catch(e){if(err)err.textContent=e.message}});$('revertLastPickBtn')?.addEventListener('click',async()=>{const err=$('adminActionErr');if(err)err.textContent='';if(!confirm('Revert the most recent draft pick? This returns the Pokémon to the board and removes it from that franchise roster.'))return;try{await revertLastPick();await refreshDraftRoom()}catch(e){if(err)err.textContent=e.message}})}
async function saveAdminPick(team,mon){
  if(!session?.user||!isAdmin()) throw new Error('Commissioner access required.');
  const result=await SBL.draft.applyPick(mon.id,team,'commissioner');
  if(result?.state){
    state={teamMap:result.state.teamMap||{},settings:Object.assign({},result.state.settings||{}),updatedAt:result.state.updatedAt||null};
    state.settings.rosters=state.settings.rosters||{};
    state.settings.draft=normalise(state.settings.draft);
  }
  return result;
}
async function revertLastPick(){
  if(!session?.user||!isAdmin()) throw new Error('Commissioner access required.');
  const result=await SBL.draft.revertLastPick();
  if(result?.state){
    state={teamMap:result.state.teamMap||{},settings:Object.assign({},result.state.settings||{}),updatedAt:result.state.updatedAt||null};
    state.settings.rosters=state.settings.rosters||{};
    state.settings.draft=normalise(state.settings.draft);
  }
  return result;
}

function openPick(id){
  const d=state.settings.draft,m=d.pool.find(x=>x.id===id);
  if(!m||!canPickFor(myTeam())||m.drafted)return;
  if(spent(myTeam())+m.points>budget(myTeam())){alert('This pick exceeds your remaining budget.');return;}
  const o=document.createElement('div');o.className='overlay';
  o.innerHTML='<div class="modal"><h3>Confirm pick</h3><div class="note" style="margin:8px 0 14px"><strong>'+esc(m.name)+'</strong> · '+m.points+' points<br>Franchise: '+esc(myTeam())+'<br>Remaining after pick: '+(budget(myTeam())-spent(myTeam())-m.points)+' pts</div><div class="actions"><button class="primary" id="confirm">Confirm pick</button><button class="ghost" id="cancel">Cancel</button></div><div class="note danger" id="err"></div></div>';
  document.body.appendChild(o);
  o.querySelector('#cancel').onclick=()=>o.remove();
  o.querySelector('#confirm').onclick=async()=>{
    const b=o.querySelector('#confirm'),err=o.querySelector('#err');
    b.disabled=true;b.textContent='Saving…';
    try{
      await savePick(m);
      o.remove();
      await refreshDraftRoom();
    }catch(e){
      if(document.body.contains(o)){err.textContent=e.message||String(e);b.disabled=false;b.textContent='Confirm pick';}
      try{await refreshDraftRoom();}catch(_){}
    }
  };
}

async function savePick(mon){
  if(!session?.user) throw new Error('Please log in before making a pick.');
  const team=myTeam();
  if(!team) throw new Error('Your account has no assigned franchise.');
  const result=await SBL.draft.applyPick(mon.id,team,'team_owner');
  if(result?.state){
    state={teamMap:result.state.teamMap||{},settings:Object.assign({},result.state.settings||{}),updatedAt:result.state.updatedAt||null};
    state.settings.rosters=state.settings.rosters||{};
    state.settings.draft=normalise(state.settings.draft);
  }
  return result;
}

function teamsFrom(d,st){const out=[];[...(d.order||[]),...Object.keys(st.settings.rosters||{}),...Object.keys(st.settings.franchises||{}),...Object.keys(st.teamMap||{})].forEach(t=>{const x=String(t||'').trim();if(x&&!out.includes(x))out.push(x)});return out}
function spentFrom(d,t){return d.picks.filter(p=>p.team===t).reduce((n,p)=>n+(Number(p.points)||0),0)}function budgetFrom(d,t){return Number(d.budgets?.[t]??d.defaultBudget)||0}
async function refreshDraftRoom(){
  try{
    
    await readState();
    render();
  }catch(e){
    console.warn('Draft refresh failed',e);
  }
}
async function boot(){bootError='';try{await readState();await readIdentity();render();lastDraftVersion=JSON.stringify([state.updatedAt||'',state.settings.draft.status,state.settings.draft.mode,state.settings.draft.currentPick,state.settings.draft.picks.length,state.settings.draft.lastMutationId||'']);}catch(e){console.error(e);showError('Draft Room could not load',e.message||String(e))}}
let lastDraftVersion='',refreshInFlight=false,refreshQueued=false;
async function pollDraft(){
  if(refreshInFlight){refreshQueued=true;return;}
  refreshInFlight=true;
  try{
    const remote=await SBL.draft.read();
    const d=normalise(remote.settings?.draft);
    const sig=JSON.stringify([remote.updatedAt||'',d.status,d.mode,d.currentPick,d.picks.length]);
    if(sig!==lastDraftVersion){
      await refreshDraftRoom();
      lastDraftVersion=sig;
    }
  }catch(e){console.warn('Draft refresh failed',e)}
  finally{
    refreshInFlight=false;
    if(refreshQueued){refreshQueued=false;pollDraft();}
  }
}
function subscribeDraft(){
  try{
    return SBL.draft.subscribe(()=>pollDraft(),'draft-room-live');
  }catch(e){console.warn('Draft realtime subscription unavailable',e)}
}
boot();
subscribeDraft();
setInterval(pollDraft,10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollDraft()});
window.addEventListener('focus',()=>pollDraft());
})();
