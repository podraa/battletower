(function(){
'use strict';
const supabase=SBL.getSupabase(), STATE_ID='__dashboard_state__';
const $=id=>document.getElementById(id), content=$('content');
const ROUTE_PARAMS=new URLSearchParams(location.search);
const ROUTE_LEAGUE_ID=(ROUTE_PARAMS.get('league')||'').trim();
const MOCK_DRAFT_ID=String(ROUTE_PARAMS.get('mock_draft')||'').trim();
const MOCK_DRAFT_MODE=!!MOCK_DRAFT_ID;
const MOCK_DRAFT_STORAGE_KEY=MOCK_DRAFT_MODE?'sbl_admin_mock_draft_v1:'+MOCK_DRAFT_ID:'';
let MOCK_DRAFT_UPDATED_AT='';
function draftViewUrl(view){
  const url=new URL('draft.html',location.href);
  const leagueId=ROUTE_LEAGUE_ID || SBL.leagueDb?.selectedLeagueId?.() || '';
  if(leagueId) url.searchParams.set('league',leagueId);
  const seasonId=ROUTE_PARAMS.get('season_id') || SBL.leagueDb?.selectedSeasonId?.() || '';
  if(seasonId) url.searchParams.set('season_id',seasonId);
  if(view) url.searchParams.set('view',view); else url.searchParams.delete('view');
  if(MOCK_DRAFT_MODE) url.searchParams.set('mock_draft',MOCK_DRAFT_ID);
  return url.href;
}
let state={teamMap:{},settings:{draft:null,rosters:{}}}, session=null, profile=null, currentFranchise=null, filter='', bootError='';
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function defaultDraft(){return{status:'setup',mode:'manual',defaultBudget:120,budgets:{},pool:[],authorizedPickerIds:[],order:[],currentPick:0,picks:[],minPicks:10,maxPicks:10,updatedAt:null}}
function draftStatSource(m){const out={};for(const k of ['hp','atk','def','spa','spd','spe']){const v=SBL.draftDash?.statValue?.(m,k);if(v!=null)out[k]=v;}return Object.keys(out).length?out:null}
function normalise(d){const x=Object.assign(defaultDraft(),d||{});x.budgets=x.budgets&&typeof x.budgets==='object'?x.budgets:{};x.authorizedPickerIds=Array.isArray(x.authorizedPickerIds)?[...new Set(x.authorizedPickerIds.map(String))]:[];x.pool=Array.isArray(x.pool)?x.pool.map((m,i)=>({id:String(m?.id||m?.name||i),name:String(m?.name||'').trim(),points:Number(m?.points)||0,isMega:!!m?.isMega,costTbd:!!m?.costTbd,types:Array.isArray(m?.types)?m.types:[],abilities:Array.isArray(m?.abilities)?m.abilities:[],baseStats:draftStatSource(m),drafted:!!m?.drafted,draftedBy:m?.draftedBy||null,pickNumber:m?.pickNumber??null})).filter(m=>m.name):[];x.order=Array.isArray(x.order)?x.order.map(String):[];x.picks=Array.isArray(x.picks)?x.picks:[];x.currentPick=Math.max(0,Number(x.currentPick)||0);x.minPicks=Math.max(10,Number(x.minPicks)||10);x.maxPicks=Math.max(x.minPicks,Number(x.maxPicks)||x.minPicks);if(!['setup','lobby','live','complete'].includes(x.status))x.status='setup';if(!['manual','ordered'].includes(x.mode))x.mode='manual';return x}
function adopt(shared){state={teamMap:shared.teamMap||{},settings:Object.assign({},shared.settings||{}),updatedAt:shared.updatedAt||null};state.settings.rosters=state.settings.rosters||{};state.settings.draft=normalise(state.settings.draft);}
async function readState(){
  if(MOCK_DRAFT_MODE){
    let payload=null;
    try{payload=JSON.parse(localStorage.getItem(MOCK_DRAFT_STORAGE_KEY)||'null');}catch(_){payload=null;}
    if(!payload||!payload.state)throw new Error('This mock draft session is missing or has been discarded. Return to Admin → Draft Setup and launch a new simulation.');
    adopt(payload.state);MOCK_DRAFT_UPDATED_AT=String(payload.updatedAt||'');return payload;
  }
  adopt(await SBL.draft.read());
}
function draftPokemonSlugs(name){
  const raw=String(name||'').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,'').replace(/♀/g,'-f').replace(/♂/g,'-m').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  // PokeAPI names Mega forms as <species>-mega[-x|-y], not mega-<species>.
  const prefixMega=raw.match(/^mega-(.+?)(?:-([xy]))?$/);
  const mega=prefixMega?`${prefixMega[1]}-mega${prefixMega[2]?'-'+prefixMega[2]:''}`:(()=>{const m=raw.match(/^(.+?)-mega(?:-([xy]))?$/);return m?`${m[1]}-mega${m[2]?'-'+m[2]:''}`:null})();
  const shared=SBL.pokemon?.draftStatsApiCandidates?.(name)||[];
  return [...new Set([mega, ...shared, raw].filter(Boolean))];
}
function draftPokemonSlug(name){return draftPokemonSlugs(name)[0]||'';}
function draftHasUsableStats(mon){return ['hp','atk','def','spa','spd','spe'].every(k=>DD()?.statValue?.(mon,k)!=null)}
async function enrichDraftPoolMetadata(){
  const pool=state.settings.draft?.pool||[];
  const missing=pool.filter(m=>!draftHasUsableStats(m)||!Array.isArray(m.abilities)||!m.abilities.length||!Array.isArray(m.types)||!m.types.length);
  if(!missing.length){if($('dashRoot')&&dash.tab==='pool')drawDashList(state.settings.draft);return;}
  let cursor=0;const failures=[];
  const worker=async()=>{while(cursor<missing.length){const mon=missing[cursor++];try{
    const localTypes=SBL.pokemonTypes?.lookupTypes?.(mon.name)||[];
    if((!Array.isArray(mon.types)||!mon.types.length)&&localTypes.length)mon.types=localTypes;
    const cacheKey='sbl_draft_meta_v3:'+draftPokemonSlug(mon.name);let data=null;
    try{data=JSON.parse(sessionStorage.getItem(cacheKey)||'null')}catch(_){}
    if(!data&&(!draftHasUsableStats(mon)||!mon.abilities?.length)){
      let raw=null,lastError=null;
      for(const slug of draftPokemonSlugs(mon.name)){
        for(let attempt=0;attempt<3;attempt++){
          try{
            const response=await fetch('https://pokeapi.co/api/v2/pokemon/'+encodeURIComponent(slug));
            if(!response.ok){lastError=new Error(`PokéAPI ${response.status} for ${slug}`);if((response.status===429||response.status>=500)&&attempt<2){await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));continue;}break;}
            raw=await response.json();break;
          }catch(error){lastError=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));}
        }
        if(raw)break;
      }
      if(!raw)throw (lastError||new Error('No valid PokéAPI form found'));
      const stats={};
      for(const x of raw.stats||[]){const k=({'hp':'hp','attack':'atk','defense':'def','special-attack':'spa','special-defense':'spd','speed':'spe'})[x.stat?.name];if(k)stats[k]=Number(x.base_stat);}
      data={baseStats:draftStatSource({baseStats:mon.baseStats,stats}),abilities:(raw.abilities||[]).map(x=>String(x.ability?.name||'').replace(/-/g,' ')).filter(Boolean),types:(raw.types||[]).sort((a,b)=>a.slot-b.slot).map(x=>String(x.type?.name||'').replace(/^./,c=>c.toUpperCase()))};
      try{sessionStorage.setItem(cacheKey,JSON.stringify(data))}catch(_){}
    }
    if(data){if(!draftHasUsableStats(mon)&&data.baseStats)mon.baseStats=data.baseStats;if((!mon.abilities||!mon.abilities.length)&&data.abilities)mon.abilities=data.abilities;if((!mon.types||!mon.types.length)&&data.types)mon.types=data.types;}
  }catch(error){failures.push({name:mon.name,error:String(error?.message||error)});}}};
  await Promise.all(Array.from({length:Math.min(4,missing.length)},worker));
  const ready=pool.filter(draftHasUsableStats).length,unresolved=pool.filter(m=>!draftHasUsableStats(m));
  if($('dashRoot')&&dash.tab==='pool'){
    drawDashList(state.settings.draft);
    const count=$('dashCount');if(count&&unresolved.length)count.textContent+=` · ${unresolved.length} Pokémon still missing complete stats`;
  }
  if(unresolved.length)console.warn(`Draft Room base stats: ${ready}/${pool.length} complete; missing: ${unresolved.map(m=>m.name).join(', ')}`,failures);
}
function newMutationId(){return (crypto?.randomUUID?.()||('draft-'+Date.now()+'-'+Math.random().toString(36).slice(2))).toString();}
async function readIdentity(){
  const s=await supabase.auth.getSession();
  if(s.error)throw s.error;
  session=s.data?.session||null;
  if(!session?.user)return;
  try{profile=await SBL.profiles.get(session.user.id,'is_commissioner',supabase);}catch(_){profile=null;}
  const leagueId=SBL.leagueDb?.selectedLeagueId?.()||'';
  currentFranchise=leagueId&&SBL.franchiseOwnership?.getUserFranchise
    ? await SBL.franchiseOwnership.getUserFranchise(leagueId,session.user.id,supabase)
    : null;
}
function teamKey(t){return String(t??'').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' ')}
function sameTeam(a,b){return teamKey(a)===teamKey(b)}
function keyedValue(obj,team,fallback){const k=Object.keys(obj||{}).find(x=>sameTeam(x,team));return k==null?fallback:obj[k]}
function teams(){const d=state.settings.draft;const out=[];[...(d.order||[]),...((d.lottery&&d.lottery.proposed)||[]),...Object.keys(state.settings.rosters||{}),...Object.keys(state.settings.franchises||{})].forEach(t=>{const s=String(t||'').trim();if(s&&!out.some(x=>teamKey(x)===teamKey(s)))out.push(s)});return out}
function myTeam(){return String(currentFranchise?.franchise?.name||'').trim()}
function budget(t){const d=state.settings.draft;return Number(keyedValue(d.budgets,t,d.defaultBudget))||0}
function spent(t){return state.settings.draft.picks.filter(p=>sameTeam(p.team,t)).reduce((n,p)=>n+(Number(p.points)||0),0)}
function onClock(){const d=state.settings.draft;return d.mode==='ordered'?(d.order[d.currentPick]||null):null}
function pickCount(d,t){return d.picks.filter(p=>sameTeam(p.team,t)).length}
function isAdmin(){return !!profile?.is_commissioner && !window.SBL_SITE?.isUserPreview?.()}
function canPickFor(t){const d=state.settings.draft;if(!isAdmin()||d.status!=='live'||!t)return false;if(MOCK_DRAFT_MODE&&d.mode==='ordered'&&!sameTeam(t,onClock()))return false;if(pickCount(d,t)>=d.maxPicks)return false;return true}
function sprite(name){try{return SBL.pokemon.spriteMarkup(name,'sprite','hd')}catch{return ''}}
function showError(title,msg){content.innerHTML='<div class="errorbox"><strong>'+esc(title)+'</strong><div class="note" style="margin-top:6px">'+esc(msg)+'</div><div class="actions"><button class="ghost" id="retry">Retry</button></div></div>';$('retry').onclick=boot}
function render(){if(PRESENT){renderPresent();return}const d=state.settings.draft;const ts=teams();const seasonEl=$('seasonLabel'),teamEl=$('myTeamLabel'),roleEl=$('roleLabel');if(seasonEl)seasonEl.textContent=state.settings.activeSeason||'Current season';if(teamEl)teamEl.textContent=myTeam()||'your franchise';if(roleEl)roleEl.innerHTML=isAdmin()?'You have <strong>commissioner controls</strong> as well as the team-owner view.':'The commissioner makes all draft picks. You can browse the board, manage your queue and track your roster here.';if(!d||(d.status==='setup'&&!d.lottery&&!d.order.length)){content.innerHTML='<div class="panel"><h2>Draft not ready</h2><div class="empty">The commissioner has not opened the Draft Room yet.</div></div>';return}if(!isAdmin()||DASHVIEW){renderDashboard(d);return}renderCommissioner(d,ts)}
function adminPanel(d,ts){const available=d.pool.filter(m=>!m.drafted).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name));const latest=d.picks.length?d.picks[d.picks.length-1]:null;return '<div class="panel"><h2>Commissioner controls</h2><div class="note">You can use the normal team-owner controls above, plus make a pick for any franchise. In ordered mode, a manual pick for another franchise does not advance the clock unless that franchise is currently on the clock.</div><div class="toolbar"><select id="adminTargetTeam" style="flex:1;min-width:200px;background:var(--panel-alt);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px 12px">'+ts.map(t=>'<option value="'+esc(t)+'" '+(t===(d.mode==='ordered'?onClock():myTeam())?'selected':'')+'>'+esc(t)+' — '+pickCount(d,t)+'/'+d.maxPicks+' picks · '+(budget(t)-spent(t))+' pts left</option>').join('')+'</select><select id="adminTargetPokemon" style="flex:1;min-width:220px;background:var(--panel-alt);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px 12px"><option value="">Select Pokémon</option>'+available.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+' — '+m.points+' pts</option>').join('')+'</select><button class="primary" id="adminPickBtn" '+(d.status==='live'?'':'disabled')+'>Make pick</button></div><div class="actions">'+(latest?'<button class="ghost" id="revertLastPickBtn">Revert last pick: '+esc(latest.name)+' → '+esc(latest.team)+'</button>':'')+'</div><div class="note danger" id="adminActionErr"></div></div>'}
function clockPanel(d){const oc=onClock();let text=d.mode==='ordered'?(oc?'On the clock: <span class="amber">'+esc(oc)+'</span>':'Draft order complete'):'Manual mode';let msg=!myTeam()?'Your account has no assigned franchise.':d.mode==='ordered'&&!sameTeam(oc,myTeam())?'Waiting for '+esc(oc||'the next franchise')+'.':'The commissioner makes all picks. You can follow the live board and manage your queue.';return '<div class="panel"><div class="clock"><div><div class="who">'+text+'</div><div class="note">'+esc(msg)+'</div></div><div class="pickno">Pick #'+(d.currentPick+1)+' of '+d.order.length+'</div></div></div>'}

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
  const rosterValue=keyedValue(state.settings.rosters,team,[]);const roster=Array.isArray(rosterValue)?rosterValue:[];
  const picks=d.picks.filter(p=>sameTeam(p.team,team));
  const entries=roster.length ? roster : picks;
  return '<div class="panel"><h2>Your roster <span class="badge">'+entries.length+'</span></h2>'+
    (entries.length
      ? '<div class="roster-draft-list">'+entries.map(m=>
          '<div class="roster-draft-row"><span>'+esc(m.name||'')+'</span><span>'+Number(m.points||0)+' pts</span></div>'
        ).join('')+'</div>'
      : '<div class="empty">You have no Pokémon on your roster yet.</div>')+
    '</div>';
}
function board(d,ts,clickable){const q=String(filter||'').trim().toLowerCase();const mons=q?d.pool.filter(m=>m.name.toLowerCase().includes(q)).slice(0,60):[];const groups={};mons.forEach(m=>(groups[m.points]??=[]).push(m));const tiers=Object.keys(groups).sort((a,b)=>Number(b)-Number(a));let body='';if(!q){body='<div class="empty">Search for a Pokémon to view matching entries. The full draft pool remains stored but is not rendered until you search.</div>';}else if(!mons.length){body='<div class="empty">No Pokémon match your search.</div>';}else{body=tiers.map(p=>'<div class="tier"><div class="tier-title">'+esc(p)+' points</div><div class="grid">'+groups[p].sort((a,b)=>a.name.localeCompare(b.name)).map(m=>{const ok=clickable&&canPickFor(myTeam())&&!m.drafted&&spent(myTeam())+m.points<=budget(myTeam());return '<div class="mon '+(!ok?'disabled':'')+'" '+(ok?'data-pick="'+esc(m.id)+'"':'')+'>'+sprite(m.name)+'<div class="name">'+esc(m.name)+'</div><div class="pts">'+m.points+' pts</div>'+(m.drafted?'<div class="taken">→ '+esc(m.draftedBy||'')+'</div>':(!ok&&clickable?'<div class="taken">Not selectable</div>':''))+'</div>'}).join('')+'</div></div>').join('');if(d.pool.length>mons.length&&q)body+='<div class="note" style="margin-top:10px">Showing up to 60 matching Pokémon.</div>';}return '<h2>Draft board</h2><div class="toolbar"><input id="poolSearch" placeholder="Search Pokémon…" value="'+esc(filter)+'"><span class="badge">'+d.pool.filter(m=>!m.drafted).length+' available</span><span class="badge">'+d.pool.filter(m=>m.drafted).length+' drafted</span></div>'+body}
function wireSearch(){$('poolSearch')?.addEventListener('input',e=>{filter=e.target.value;clearTimeout(window.__poolSearchT);window.__poolSearchT=setTimeout(()=>{render();const x=$('poolSearch');if(x){x.focus();x.setSelectionRange(x.value.length,x.value.length)}},180)});document.querySelectorAll('[data-pick]').forEach(el=>el.addEventListener('click',()=>openPick(el.dataset.pick)));$('adminPickBtn')?.addEventListener('click',async()=>{const err=$('adminActionErr');if(err)err.textContent='';const team=$('adminTargetTeam')?.value;const id=$('adminTargetPokemon')?.value;const m=state.settings.draft.pool.find(x=>x.id===id);if(!team||!m){err.textContent='Select a franchise and Pokémon first.';return}try{await saveAdminPick(team,m);render()}catch(e){if(err)err.textContent=e.message}});$('revertLastPickBtn')?.addEventListener('click',async()=>{const err=$('adminActionErr');if(err)err.textContent='';const latest=state.settings.draft.picks.slice(-1)[0];const confirmed=await showDraftConfirm({kicker:'Commissioner console · Undo',title:'Revert the most recent pick?',message:latest?`${latest.name} will return to the available Pokémon pool and be removed from ${latest.team}'s roster.`:'The latest pick will be reverted.',spriteName:latest?.name||'',details:latest?[['Pick',`#${latest.pickNumber||'—'}`],['Franchise',latest.team]]:[],confirmLabel:'Revert pick',cancelLabel:'Keep pick',danger:true});if(!confirmed)return;try{await revertLastPick();render()}catch(e){if(err)err.textContent=e.message}})}
function mockSessionRead(){
  if(!MOCK_DRAFT_MODE)return null;
  try{return JSON.parse(localStorage.getItem(MOCK_DRAFT_STORAGE_KEY)||'null');}catch(_){return null;}
}
function mockSessionWrite(){
  if(!MOCK_DRAFT_MODE)return;
  const payload=mockSessionRead();
  if(!payload)throw new Error('The mock draft session no longer exists.');
  payload.state={teamMap:state.teamMap||{},settings:state.settings||{}};
  payload.updatedAt=new Date().toISOString();
  localStorage.setItem(MOCK_DRAFT_STORAGE_KEY,JSON.stringify(payload));
  MOCK_DRAFT_UPDATED_AT=payload.updatedAt;
}
function applyMockPick(team,mon){
  if(!MOCK_DRAFT_MODE||!isAdmin())throw new Error('Administrative mock draft access required.');
  const d=state.settings.draft;
  if(!d||d.status!=='live')throw new Error('The mock draft is not live.');
  const target=d.pool.find(x=>String(x.id)===String(mon?.id));
  if(!target||target.drafted)throw new Error('That Pokémon is no longer available in this simulation.');
  const franchise=teams().find(x=>sameTeam(x,team));
  if(!franchise)throw new Error('Choose a franchise included in this mock draft.');
  if(d.mode==='ordered'&&!sameTeam(franchise,onClock()))throw new Error(`It is ${onClock()||'no franchise'}'s turn in the configured draft order.`);
  if(pickCount(d,franchise)>=d.maxPicks)throw new Error(`${franchise} has reached the configured maximum roster size.`);
  const total=budget(franchise),used=spent(franchise),cost=Number(target.points)||0;
  if(used+cost>total)throw new Error(`${franchise} cannot afford ${target.name}. ${total-used} points remain.`);
  const pickNumber=d.picks.length+1;
  target.drafted=true;target.draftedBy=franchise;target.pickNumber=pickNumber;
  const pick={poolId:String(target.id),name:target.name,points:cost,team:franchise,pickNumber,ts:new Date().toISOString(),madeBy:'mock-commissioner',types:Array.isArray(target.types)?target.types.slice():[],baseStats:target.baseStats||target.stats||null};
  d.picks.push(pick);
  d.currentPick=d.mode==='ordered'?Number(d.currentPick||0)+1:d.picks.length;
  if(d.mode==='ordered'&&d.currentPick>=d.order.length)d.status='complete';
  const rosterKey=Object.keys(state.settings.rosters||{}).find(k=>sameTeam(k,franchise))||franchise;
  state.settings.rosters[rosterKey]=Array.isArray(state.settings.rosters?.[rosterKey])?state.settings.rosters[rosterKey]:[];
  state.settings.rosters[rosterKey].push({name:target.name,points:cost,poolId:String(target.id),pickNumber,types:pick.types,baseStats:pick.baseStats});
  mockSessionWrite();
  return {changed:true,state,pick,result:{kind:'mock_pick',poolId:String(target.id),team:franchise,pickNumber}};
}
function revertMockPick(){
  if(!MOCK_DRAFT_MODE||!isAdmin())throw new Error('Administrative mock draft access required.');
  const d=state.settings.draft;if(!d?.picks?.length)throw new Error('There are no simulated picks to undo.');
  const last=d.picks.pop();
  const target=d.pool.find(x=>String(x.id)===String(last.poolId));
  if(target){target.drafted=false;target.draftedBy=null;target.pickNumber=null;}
  if(d.mode==='ordered')d.currentPick=Math.max(0,Number(d.currentPick||0)-1);else d.currentPick=d.picks.length;
  if(d.status==='complete')d.status='live';
  const rosterKey=Object.keys(state.settings.rosters||{}).find(k=>sameTeam(k,last.team))||last.team;
  const roster=Array.isArray(state.settings.rosters?.[rosterKey])?state.settings.rosters[rosterKey]:[];
  const idx=roster.findIndex(m=>String(m.poolId||'')===String(last.poolId)&&Number(m.pickNumber)===Number(last.pickNumber));
  if(idx>=0)roster.splice(idx,1);state.settings.rosters[rosterKey]=roster;
  mockSessionWrite();return {changed:true,state,pick:last,result:{kind:'mock_revert'}};
}
function resetMockDraft(){
  if(!MOCK_DRAFT_MODE||!isAdmin())throw new Error('Administrative mock draft access required.');
  const payload=mockSessionRead();if(!payload?.initialState)throw new Error('The original mock draft snapshot is unavailable.');
  adopt(JSON.parse(JSON.stringify(payload.initialState)));
  state.settings.draft=normalise(state.settings.draft);
  mockSessionWrite();render();
}
function endMockDraft(){
  if(!MOCK_DRAFT_MODE||!isAdmin())throw new Error('Administrative mock draft access required.');
  state.settings.draft.status='complete';mockSessionWrite();render();
}
function mockBannerHtml(){
  return `<div class="panel mock-draft-banner"><div class="row" style="align-items:center;justify-content:space-between;gap:12px"><div><div class="admin-dashboard-kicker">ADMINISTRATIVE SIMULATION · NO LIVE DATA WRITES</div><strong>Mock Draft Room</strong><div class="note">Picks, rosters, budgets and presentation are isolated in this browser. Nothing is published to the real league.</div></div><div class="actions"><a class="ghost" href="${esc(draftViewUrl('present'))}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center">Open presentation ↗</a><button class="ghost" id="resetMockDraftRoomBtn">Reset simulation</button><button class="ghost danger-btn" id="endMockDraftRoomBtn">End simulation</button></div></div></div>`;
}
function wireMockBanner(){
  $('resetMockDraftRoomBtn')?.addEventListener('click',()=>{if(!confirm('Reset every simulated pick and restore the original Draft Setup snapshot?'))return;try{resetMockDraft();}catch(e){alert(e.message||String(e));}});
  $('endMockDraftRoomBtn')?.addEventListener('click',()=>{if(!confirm('End this mock draft simulation? This changes only the local simulation.'))return;try{endMockDraft();}catch(e){alert(e.message||String(e));}});
}

async function saveAdminPick(team,mon){
  if(!session?.user||!isAdmin()) throw new Error('Commissioner access required.');
  if(MOCK_DRAFT_MODE)return applyMockPick(team,mon);
  const result=await SBL.draft.applyPick(mon.id,team,'commissioner',state);
  if(result?.state){
    state={teamMap:result.state.teamMap||{},settings:Object.assign({},result.state.settings||{}),updatedAt:result.state.updatedAt||null};
    state.settings.rosters=state.settings.rosters||{};
    state.settings.draft=normalise(state.settings.draft);
  }
  return result;
}
async function revertLastPick(){
  if(!session?.user||!isAdmin()) throw new Error('Commissioner access required.');
  if(MOCK_DRAFT_MODE)return revertMockPick();
  const result=await SBL.draft.revertLastPick(state);
  if(result?.state){
    state={teamMap:result.state.teamMap||{},settings:Object.assign({},result.state.settings||{}),updatedAt:result.state.updatedAt||null};
    state.settings.rosters=state.settings.rosters||{};
    state.settings.draft=normalise(state.settings.draft);
  }
  return result;
}

function showDraftConfirm(options={}){
  const {
    kicker='Draft Room · Confirmation',
    title='Confirm action',
    message='Are you sure you want to continue?',
    spriteName='',
    details=[],
    confirmLabel='Confirm',
    cancelLabel='Cancel',
    danger=false
  }=options;
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='overlay draft-confirm-overlay';
    const art=spriteName
      ? `<div class="draft-confirm-art">${SBL.pokemon.spriteMarkup(spriteName,'draft-confirm-sprite','hd')}</div>`
      : '<div class="draft-confirm-mark" aria-hidden="true">◆</div>';
    const detailHtml=details.length
      ? `<div class="draft-confirm-details">${details.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>`
      : '';
    overlay.innerHTML=`<section class="modal draft-confirm-modal draft-pick-modal" role="dialog" aria-modal="true" aria-labelledby="draftConfirmTitle" aria-describedby="draftConfirmMessage">
      <div class="draft-confirm-kicker">${esc(kicker)}</div>
      <div class="draft-confirm-hero">${art}<div class="draft-confirm-copy"><h3 id="draftConfirmTitle">${esc(title)}</h3><p id="draftConfirmMessage">${esc(message)}</p></div></div>
      ${detailHtml}
      <div class="draft-confirm-actions"><button type="button" class="${danger?'draft-confirm-danger':'primary'}" data-draft-confirm="yes">${esc(confirmLabel)}</button><button type="button" class="ghost" data-draft-confirm="no">${esc(cancelLabel)}</button></div>
    </section>`;
    document.body.appendChild(overlay);
    let settled=false;
    const finish=value=>{
      if(settled)return;
      settled=true;
      document.removeEventListener('keydown',onKey);
      overlay.remove();
      resolve(value);
    };
    const onKey=e=>{if(e.key==='Escape'){e.preventDefault();finish(false)}};
    document.addEventListener('keydown',onKey);
    overlay.addEventListener('click',e=>{
      if(e.target===overlay)finish(false);
      const button=e.target.closest('[data-draft-confirm]');
      if(button)finish(button.dataset.draftConfirm==='yes');
    });
    overlay.querySelector('[data-draft-confirm="yes"]')?.focus();
  });
}

async function openPick(id){
  const d=state.settings.draft,m=d.pool.find(x=>x.id===id),team=myTeam();
  if(!m||!canPickFor(team)||m.drafted)return;
  if(spent(team)+m.points>budget(team)){alert('This pick exceeds your remaining budget.');return;}
  const remaining=budget(team)-spent(team)-m.points;
  const confirmed=await showDraftConfirm({
    kicker:MOCK_DRAFT_MODE?'Administrative simulation · Pick confirmation':'Draft Room · Pick confirmation',
    title:m.name,
    message:MOCK_DRAFT_MODE?'Add this Pokémon to the simulated roster? This will not affect the live draft.':'Confirm this Pokémon for your franchise.',
    spriteName:m.name,
    details:[['Franchise',team],['Pick cost',`${m.points} points`],['Points remaining',`${remaining} pts`]],
    confirmLabel:MOCK_DRAFT_MODE?'Add simulated pick':'Confirm pick',
    cancelLabel:'Keep browsing'
  });
  if(!confirmed)return;
  try{
    await savePick(m);
    await refreshDraftRoom();
  }catch(e){
    alert(e.message||String(e));
    try{await refreshDraftRoom()}catch(_){}
  }
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

function teamsFrom(d,st){const out=[];[...(d.order||[]),...Object.keys(st.settings.rosters||{}),...Object.keys(st.settings.franchises||{})].forEach(t=>{const x=String(t||'').trim();if(x&&!out.some(v=>teamKey(v)===teamKey(x)))out.push(x)});return out}
function spentFrom(d,t){return d.picks.filter(p=>sameTeam(p.team,t)).reduce((n,p)=>n+(Number(p.points)||0),0)}function budgetFrom(d,t){return Number(keyedValue(d.budgets,t,d.defaultBudget))||0}
function draftVersion(source){
  const d=normalise(source?.settings?.draft);
  return JSON.stringify([source?.updatedAt||'',d.status,d.mode,d.currentPick,d.picks.length,d.lastMutationId||'']);
}
const pickEventKey=p=>String(p?.poolId||p?.pool_id||`${p?.pickNumber??p?.pick_number??''}|${p?.team||''}|${p?.name||p?.mon_name||''}`);
let seenPickKeys=new Set(), presentationBaselineReady=false;
function seedSeenPicks(){
  seenPickKeys=new Set((state.settings.draft?.picks||[]).map(pickEventKey));
  presentationBaselineReady=true;
}
function revealNewPicks(previousKeys){
  if(!PRESENT||!presentationBaselineReady)return;
  const picks=state.settings.draft?.picks||[];
  for(const p of picks){
    const key=pickEventKey(p);
    if(!previousKeys.has(key)&&!seenPickKeys.has(key))enqueueReveal(p);
    seenPickKeys.add(key);
  }
}
async function refreshDraftRoom(){
  try{
    const previousKeys=new Set((state.settings.draft?.picks||[]).map(pickEventKey));
    await readState();
    revealNewPicks(previousKeys);
    render();
    return true;
  }catch(e){
    console.warn('Draft refresh failed',e);
    return false;
  }
}
async function refreshIdentity(){
  const before=currentFranchise?.franchiseId||null;
  try{
    await readIdentity();
    const after=currentFranchise?.franchiseId||null;
    if(before!==after) render();
  }catch(e){
    console.warn('Draft identity refresh failed',e);
  }
}
async function boot(){bootError='';try{
  if(!SBL.leagueDb?.isUuid?.(ROUTE_LEAGUE_ID)){
    showError('Choose a league first','The Draft Room needs a valid league in its URL. Return to the league selector, choose a league, then open Draft from that league.');
    const box=content.querySelector('.errorbox');if(box){const actions=box.querySelector('.actions');if(actions){const link=document.createElement('a');link.className='ghost';link.href='index.html';link.textContent='Return to league selector';link.style.cssText='display:inline-flex;align-items:center;text-decoration:none';actions.appendChild(link);}}
    return;
  }
  SBL.leagueDb.setSelectedLeagueId(ROUTE_LEAGUE_ID);
  if(MOCK_DRAFT_MODE){
    await readIdentity();
    if(!session?.user||!isAdmin())throw new Error('This administrative mock draft is restricted to a signed-in commissioner.');
    await readState();
    if(!state.settings.draft)throw new Error('The mock draft snapshot does not contain a draft configuration.');
    render();seedSeenPicks();lastDraftVersion=draftVersion(state);return;
  }
  const requestedSeasonId=String(ROUTE_PARAMS.get('season_id')||'').trim();
  const selectedSeason=await SBL.leagueDb.getSeasonContext(ROUTE_LEAGUE_ID,supabase,requestedSeasonId?{seasonId:requestedSeasonId}:{});
  if(!selectedSeason) throw new Error('The selected season could not be found in this league.');
  SBL.leagueDb.setSelectedSeasonId(selectedSeason.id,ROUTE_LEAGUE_ID);
  SBL.leagueDb.setSelectedSeasonKey(selectedSeason.season_key,ROUTE_LEAGUE_ID);
  const draftStatus=String(selectedSeason.data?.settings?.draft?.status||'setup');
  if(!['lobby','live'].includes(draftStatus)){
    if(draftStatus!=='complete'){
      showError('Draft Room is not open',`The selected season, ${selectedSeason.name}, does not currently have an open draft. The Draft Room is available while its lobby is open, the draft is live, or completed results are available.`);
      return;
    }
  }
  await readState();await readIdentity();render();void enrichDraftPoolMetadata();lastDraftVersion=draftVersion(state);try{lastCfg=(await SBL.draft.version())?.cfg||''}catch(_){lastCfg=''}
}catch(e){console.error(e);showError('Draft Room could not load',e.message||String(e))}}


/* ---- LOTTERY + DRAFT BOARD + COMMISSIONER CONSOLE (CP4.1) ------------------------
   Everything below is read-only for regular users and rerenders from the shared
   draft state, so the lottery reveal and the board follow the commissioner live. */
const LT=()=>SBL.draftLottery;
let lotSeen=-1,oddsCache={k:'',v:null};
const cmd={tab:'console',team:'',q:''};
function perRound(d){const u=new Set(d.order||[]).size;return u||(d.lottery?.proposed?.length||0)}
function lotOdds(l){const k=JSON.stringify([l.proposed,l.weights,l.picks]);if(oddsCache.k!==k)oddsCache={k,v:LT().odds(l)};return oddsCache.v}
function lotOddsTable(l,me){
  const o=lotOdds(l),n=l.proposed.length;
  return '<div class="bd-scroll"><table class="lot-odds"><thead><tr><th>#</th><th>Franchise</th><th>Odds for #1</th><th>Top 3</th></tr></thead><tbody>'+
    l.proposed.map((t,i)=>{const top3=o[i].slice(0,Math.min(3,n)).reduce((a,b)=>a+b,0);const pc=x=>(x*100).toFixed(1)+'%';
      return '<tr class="'+(teamKey(t)===me?'mine':'')+'"><td>'+(i+1)+'</td><td>'+esc(t)+'</td><td>'+pc(o[i][0])+'</td><td>'+pc(top3)+'</td></tr>'}).join('')+'</tbody></table></div>';
}
function lotteryView(d){
  if(!d.lottery)return '';
  const l=LT().normalize(d.lottery),me=teamKey(myTeam());
  if(l.proposed.length<2)return '';
  const K=Math.min(l.picks,l.result.length);
  let body,badge;
  if(l.status==='setup'||!l.result.length){
    badge='Odds published';
    body='<div class="note">The proposed order and odds are set. The lottery has not been run yet — leave this page open and it will update live.</div>'+lotOddsTable(l,me);
  }else{
    const vis=LT().visiblePicks(l),done=l.revealed>=K;
    badge=l.status==='applied'?'Final order':done?'Complete':'Live';
    const fresh=(lotSeen>=0&&l.revealed>lotSeen&&!done)?K-l.revealed:-1;
    body='<div class="note">'+(done?'Every drawn pick is revealed.':'The commissioner is revealing the lottery from the last drawn pick up to #1…')+'</div><ol class="lot-picks">'+
      l.result.map((t,i)=>{
        if(!vis[i])return '<li class="lot-pick pending"><span class="no">'+(i+1)+'</span><span class="tm">? ? ?</span><span></span></li>';
        const slot=l.proposed.indexOf(t)+1,mv=i<K&&slot?slot-(i+1):0;
        const mvTxt=i>=K?'keeps slot '+slot:mv>0?'<b>▲ up '+mv+'</b> from slot '+slot:mv<0?'<b>▼ down '+(-mv)+'</b> from slot '+slot:'stays at slot '+slot;
        return '<li class="lot-pick '+(mv>0?'up':mv<0?'down':'')+(teamKey(t)===me?' mine':'')+(i===fresh?' fresh':'')+'"><span class="no">'+(i+1)+'</span><span class="tm">'+esc(t)+'</span><span class="mv">'+mvTxt+'</span></li>'}).join('')+'</ol>'+
      (done?'<div class="note">Seed <code>'+esc(l.seed)+'</code> · '+(LT().verify(l)?'✓ re-running this seed reproduces this result':'⚠ result does not match its seed')+'</div>':'')+
      '<details><summary class="note" style="cursor:pointer">Pre-lottery odds</summary>'+lotOddsTable(l,me)+'</details>';
    lotSeen=l.revealed;
  }
  return '<div class="panel lot-wrap"><div class="lot-head"><h2>Draft lottery</h2><span class="badge">'+badge+'</span></div>'+body+'</div>';
}
function boardView(d){
  if(MOCK_DRAFT_MODE&&d.mode==='manual'){
    const picks=(d.picks||[]).slice().sort((a,b)=>Number(a.pickNumber||0)-Number(b.pickNumber||0));
    return '<div class="panel"><h2>Simulation draft board <span class="badge">'+picks.length+' picks</span></h2><div class="note">Manual mode records the actual franchise chosen for each pick in chronological order.</div>'+(picks.length?'<div class="bd-scroll"><div class="bd-row">'+picks.map(p=>'<div class="bd-cell"><span class="pn">#'+esc(p.pickNumber||'—')+'</span>'+sprite(p.name)+'<span class="mn">'+esc(p.name)+'</span><span class="pts">'+(Number(p.points)||0)+' pts</span><span class="tm">'+esc(p.team)+'</span></div>').join('')+'</div></div>':'<div class="empty">No simulated picks yet.</div>')+'</div>';
  }
  const pr=perRound(d);
  if(!d.order.length||!pr)return '<div class="panel"><h2>Draft board</h2><div class="empty">The draft order has not been set yet.</div></div>';
  const rows=LT().boardRows(d.order,d.picks,pr),me=teamKey(myTeam()),clock=(d.status==='live'&&d.mode==='ordered')?d.currentPick+1:0;
  return '<div class="panel"><h2>Draft board <span class="badge">'+d.picks.length+'/'+d.order.length+' picks</span></h2><div class="bd-scroll">'+
    rows.map((r,ri)=>'<div class="bd-round"><h3>Round '+(ri+1)+'</h3><div class="bd-row">'+r.map(c=>{
      const k=teamKey(c.team)===me?' mine':'',cl=c.pickNumber===clock?' clock':'';
      return c.pick?'<div class="bd-cell'+k+cl+'"><span class="pn">#'+c.pickNumber+'</span>'+sprite(c.pick.name)+'<span class="mn">'+esc(c.pick.name)+'</span><span class="pts">'+(Number(c.pick.points)||0)+' pts</span><span class="tm">'+esc(c.team)+'</span></div>'
        :'<div class="bd-cell empty'+k+cl+'"><span class="pn">#'+c.pickNumber+(cl?' · on the clock':'')+'</span><span class="tm" style="margin-top:auto;margin-bottom:auto">'+esc(c.team)+'</span></div>'}).join('')+'</div></div>').join('')+'</div></div>';
}
function dashboardBoardView(d){
  const pr=perRound(d);
  if(!d.order.length||!pr)return '<section class="user-board-panel"><h2>Draft board</h2><div class="dash-empty">The commissioner has not published the draft order yet.</div></section>';
  const rows=LT().boardRows(d.order,d.picks,pr),me=teamKey(myTeam()),clock=(d.status==='live'&&d.mode==='ordered')?d.currentPick+1:0;
  const next=clock?d.order[d.currentPick]:null;
  const progress=d.order.length?Math.min(100,d.picks.length/d.order.length*100):0;
  return `<section class="user-board-wrap"><div class="user-board-overview"><div><span class="dash-kicker">LIVE DRAFT</span><h2>Draft board</h2><p>${d.picks.length} of ${d.order.length} picks completed · ${rows.length} rounds</p></div><div class="user-board-progress"><strong>${Math.round(progress)}%</strong><span>complete</span></div><div class="user-board-progressbar"><i style="width:${progress}%"></i></div>${next?`<div class="user-board-clock"><span>ON THE CLOCK</span><strong>${esc(next)}</strong><small>Pick #${clock}</small></div>`:''}</div>`+
    rows.map((r,ri)=>`<section class="user-board-round"><header><h3>Round ${ri+1}</h3><span>${r.filter(c=>c.pick).length} / ${r.length} picks</span></header><div class="user-board-grid">${r.map(c=>{
      const mine=teamKey(c.team)===me,active=c.pickNumber===clock,done=!!c.pick;
      return `<article class="user-board-pick${mine?' mine':''}${active?' clock':''}${done?' complete':' pending'}"><div class="user-board-pick-top"><b>#${c.pickNumber}</b><span>${active?'ON THE CLOCK':done?'PICKED':'UPCOMING'}</span></div><div class="user-board-franchise">${esc(c.team)}</div>${done?`<div class="user-board-mon">${sprite(c.pick.name)}<strong>${esc(c.pick.name)}</strong><span>${Number(c.pick.points)||0} pts</span></div>`:'<div class="user-board-wait">Waiting for pick</div>'}</article>`;
    }).join('')}</div></section>`).join('')+'</section>';
}

function cmdTeam(d,ts){
  if(cmd.team&&ts.includes(cmd.team))return cmd.team;
  const oc=onClock();return d.mode==='ordered'&&oc?oc:(ts.some(t=>sameTeam(t,myTeam()))?myTeam():ts[0]||'');
}
function cmdResultsHtml(d,team){
  const norm=x=>String(x).toLowerCase().replace(/[^a-z0-9]/g,''),q=norm(cmd.q);
  if(!q)return '<div class="note">Search for a Pokémon to draft it.</div>';
  const list=d.pool.filter(m=>!m.drafted&&norm(m.name).includes(q)).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name)).slice(0,24);
  if(!list.length)return '<div class="note">No undrafted Pokémon match.</div>';
  const live=d.status==='live';
  return '<div class="cmd-results">'+list.map(m=>{const ok=live&&team&&DD().canAfford(d,team,m);
    const why=!live?'Draft is not live':!ok?'Over budget or roster full for '+team:'Draft for '+team;
    return '<button class="cmd-mon" data-cmd-pick="'+esc(m.id)+'" '+(ok?'':'disabled')+' title="'+esc(why)+'">'+dashSprite(m.name)+'<span><span class="nm">'+esc(m.name)+'</span><br><span class="sb">'+m.points+' pts</span></span></button>'}).join('')+'</div>';
}
function consoleHtml(d,ts){
  const team=cmdTeam(d,ts),oc=onClock(),live=d.status==='live',pr=perRound(d);
  const b=team?DD().budgetInfo(d,team):null,lim=team?Math.max(0,DD().spendLimit(d,team)):0;
  const round=pr?Math.floor(d.currentPick/pr)+1:1,latest=d.picks.length?d.picks[d.picks.length-1]:null;
  const offClock=live&&d.mode==='ordered'&&oc&&!sameTeam(team,oc);
  const status=d.status==='live'?'':d.status==='complete'?'The draft is complete.':'The draft is not live yet — open and start it from Admin → Draft. Picks unlock when it starts.';
  return '<div class="cmd-clock"><div><div class="meta">'+(d.mode==='ordered'?(live?'ON THE CLOCK · Pick #'+(d.currentPick+1)+' · Round '+round:'Ordered draft'):'Manual draft')+'</div><div class="who">'+esc(team||'No franchise')+'</div>'+
    (b?'<div class="meta">'+b.left+' / '+b.total+' pts left · max '+lim+' on one pick · '+b.picks+'/'+b.maxPicks+' picks</div>':'')+'</div>'+
    '<div class="actions"><a class="ghost" href="'+esc(draftViewUrl('present'))+'" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;text-decoration:none">Open presentation ↗</a>'+(latest?'<button class="ghost" id="cmdRevert">Revert last pick: '+esc(latest.name)+'</button>':'')+'</div></div>'+
    (status?'<div class="note" style="margin-top:8px">'+status+'</div>':'')+
    (offClock?'<div class="note danger" style="margin-top:8px">'+esc(team)+' is not on the clock ('+esc(oc)+' is). This pick will not advance the clock.</div>':'')+
    '<div class="cmd-bar"><select id="cmdTeam" title="Franchise to draft for" '+(d.mode==='ordered'?'disabled':'')+'>'+ts.map(t=>'<option value="'+esc(t)+'" '+(t===team?'selected':'')+'>'+esc(t)+' — '+(budget(t)-spent(t))+' pts left</option>').join('')+'</select>'+
    '<input type="search" id="cmdSearch" placeholder="Search Pokémon to draft…" autocomplete="off" value="'+esc(cmd.q)+'"></div>'+
    '<div id="cmdResults">'+cmdResultsHtml(d,team)+'</div><div class="note danger" id="cmdErr"></div>';
}
function wireConsole(ts){
  const d0=()=>state.settings.draft,err=m=>{const e=$('cmdErr');if(e)e.textContent=m||''};
  $('cmdTeam')?.addEventListener('change',e=>{cmd.team=e.target.value;render()});
  $('cmdSearch')?.addEventListener('input',e=>{cmd.q=e.target.value;clearTimeout(window.__cmdT);window.__cmdT=setTimeout(()=>{const r=$('cmdResults');if(r)r.innerHTML=cmdResultsHtml(d0(),cmdTeam(d0(),ts))},150)});
  $('cmdResults')?.addEventListener('click',async e=>{
    const b=e.target.closest('[data-cmd-pick]');if(!b||b.disabled)return;
    const d=d0(),m=d.pool.find(x=>String(x.id)===b.dataset.cmdPick),team=cmdTeam(d,ts);if(!m||!team)return;
    const info=DD().budgetInfo(d,team);
    const confirmed=await showDraftConfirm({
      kicker:MOCK_DRAFT_MODE?'Administrative simulation · Pick confirmation':'Commissioner console · Pick confirmation',
      title:m.name,
      message:MOCK_DRAFT_MODE?'Add this Pokémon to the simulated draft? The live draft and rosters remain untouched.':'Confirm this pick for the selected franchise.',
      spriteName:m.name,
      details:[['Franchise',team],['Pick cost',`${m.points} points`],['Points remaining',`${Math.max(0,(Number(info?.left)||0)-m.points)} pts`]],
      confirmLabel:MOCK_DRAFT_MODE?'Add simulated pick':'Confirm pick',
      cancelLabel:'Cancel'
    });
    if(!confirmed)return;
    b.disabled=true;err('');
    try{await saveAdminPick(team,m);cmd.team='';cmd.q='';render()}catch(x){err(x?.message||String(x));/* Keep the failed-pick message visible. A refresh here immediately re-rendered the console and erased it. */}
  });
  $('cmdRevert')?.addEventListener('click',async()=>{
    const latest=d0().picks.slice(-1)[0];
    const confirmed=await showDraftConfirm({
      kicker:MOCK_DRAFT_MODE?'Administrative simulation · Undo':'Commissioner console · Undo',
      title:'Revert the most recent pick?',
      message:latest?`${latest.name} will return to the available Pokémon pool and be removed from ${latest.team}'s roster.`:'The latest pick will be reverted.',
      spriteName:latest?.name||'',
      details:latest?[['Pick',`#${latest.pickNumber||'—'}`],['Franchise',latest.team]]:[],
      confirmLabel:'Revert pick',
      cancelLabel:'Keep pick',
      danger:true
    });
    if(!confirmed)return;
    err('');try{await revertLastPick();cmd.team='';render()}catch(x){err(x.message||String(x))}
  });
}
function renderCommissioner(d,ts){
  const tabs=MOCK_DRAFT_MODE?[['console','Simulation Draft Room']]:[['console','Commissioner console'],['plan','My plan'],['user','User view']];
  if(!$('cmdShell')){
    content.innerHTML=(MOCK_DRAFT_MODE?mockBannerHtml():'')+'<div id="cmdShell"><div class="cmd-tabs" id="cmdTabs"></div><div id="cmdBody"></div></div>';
    if(MOCK_DRAFT_MODE)wireMockBanner();
    $('cmdTabs').addEventListener('click',e=>{const b=e.target.closest('[data-cmd-tab]');if(!b||b.dataset.cmdTab===cmd.tab)return;
      cmd.tab=b.dataset.cmdTab;if(cmd.tab==='plan')dash.tab='queue';else if(cmd.tab==='user')dash.tab='pool';dash.tabChosen=true;
      $('cmdBody').innerHTML='';render()});
  }
  $('cmdTabs').innerHTML=tabs.map(([k,l])=>'<button data-cmd-tab="'+k+'" class="'+(cmd.tab===k?'on':'')+'">'+l+'</button>').join('');
  if(cmd.tab!=='console'){renderDashboard(d);return}
  const body=$('cmdBody'),focused=document.activeElement?.id==='cmdSearch',pos=focused?document.activeElement.selectionStart:0;
  body.innerHTML=consoleHtml(d,ts)+boardView(d);
  wireConsole(ts);
  if(focused){const x=$('cmdSearch');if(x){x.focus();x.setSelectionRange(pos,pos)}}
}
/* ---- END LOTTERY + BOARD + CONSOLE ---- */

/* ---- DASHBOARD START: per-user draft dashboard (everyone except admins; admins: ?view=dashboard) ---- */
const DASHVIEW=new URLSearchParams(location.search).get('view')==='dashboard';
const dash={tab:'pool',f:{q:'',types:[],ability:'',stat:'',statMin:'',statMax:'',minPts:'',maxPts:'',mega:'all',affordable:true,showDrafted:false,queuedOnly:false},sort:'pts-desc',groupBy:'points',limit:60,queue:[],queueLoaded:false,saveMsg:''};
let dashSaveT=null,dashSearchT=null;
const DD=()=>SBL.draftDash;
function dashStyles(){if(document.getElementById('dashStyle'))return;const st=document.createElement('style');st.id='dashStyle';st.textContent=`
.dash{max-width:none;width:100%;margin:0;padding:10px;display:grid;gap:10px}
.dash-head{border:1px solid rgba(127,127,127,.35);border-radius:14px;padding:12px 14px;background:rgba(127,127,127,.1)}
.dash-team{font-weight:800;font-size:1.15rem}
.dash-pts{margin-top:2px}.dash-pts .big{font-size:2rem;font-weight:900}
.dash-bar{height:8px;border-radius:99px;background:rgba(127,127,127,.25);overflow:hidden;margin:6px 0}
.dash-bar i{display:block;height:100%;background:linear-gradient(90deg,#22c7a9,#3b82f6)}
.dash-meta{font-size:.85rem;opacity:.8}
.dash-clock{margin-top:8px;padding:8px 10px;border-radius:10px;background:rgba(127,127,127,.16);font-weight:600}
.dash-clock.me{background:#22c7a9;color:#04140f}
.dash-tabs{display:flex;gap:6px;overflow-x:auto}
.dash-tabs button{flex:1;white-space:nowrap;padding:9px 12px;border-radius:10px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-weight:700;cursor:pointer}
.dash-tabs button.on{background:rgba(59,130,246,.25);border-color:#3b82f6}
.dash-ctl{display:grid;gap:8px}
.dash-ctl input[type=search],.dash-ctl input[type=number],.dash-ctl select{padding:9px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;min-width:0;font:inherit}
.dash-row{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:8px}
.dash-chips{display:flex;flex-wrap:wrap;gap:6px}
.dash-chips button{padding:5px 10px;border-radius:99px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;font-size:.8rem;cursor:pointer}
.dash-chips button.on{background:#3b82f6;border-color:#3b82f6;color:#fff}
.dash-tog{display:flex;gap:14px;flex-wrap:wrap;font-size:.9rem}.dash-tog label{display:flex;gap:6px;align-items:center}
.dash-list{display:grid;gap:8px}
.dash-card{display:grid;grid-template-columns:56px 1fr auto;gap:10px;align-items:center;padding:8px 10px;border:1px solid rgba(127,127,127,.3);border-radius:12px}
.dash-card.na{opacity:.5}.dash-card.dr{opacity:.4;text-decoration:line-through}
.dash-card.next{border-color:#22c7a9;box-shadow:0 0 0 1px #22c7a9 inset}
.dash-sprite{width:56px!important;height:56px!important;object-fit:contain}
.dash-name{font-weight:700}.dash-sub{font-size:.82rem;opacity:.8;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.dash-ty{padding:1px 8px;border-radius:99px;background:rgba(127,127,127,.25);font-size:.72rem}
.dash-star,.dash-mini{border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;border-radius:10px;padding:8px 11px;cursor:pointer;font-size:1rem}
.dash-star.on{background:#f5b301;border-color:#f5b301;color:#222}
.dash-acts{display:flex;gap:6px}
.dash-more{padding:11px;border-radius:12px;border:1px dashed rgba(127,127,127,.5);background:transparent;color:inherit;cursor:pointer}
.dash-save{font-size:.8rem;opacity:.7}
/* Free Agency-style tiered Pokémon board */
.dash{max-width:1320px;padding:10px 0}
.dash-list{display:block}
.dash-tier{margin:0 0 24px}
.dash-tier-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 10px;padding:0 2px}
.dash-tier-head h3{margin:0;color:var(--amber,#ffb454);font-size:13px;font-weight:900;letter-spacing:.07em;text-transform:uppercase}
.dash-tier-head span{font-size:11px;color:var(--text-dim,#8996a8)}
.dash-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px}
.dash-mon-card{position:relative;min-height:205px;padding:12px 10px 13px;border:1px solid var(--border,#2a3444);border-radius:12px;background:var(--panel-alt,#1c2432);display:flex;flex-direction:column;align-items:center;text-align:center;transition:border-color .14s,transform .14s,box-shadow .14s}
.dash-mon-card:hover{border-color:var(--teal,#5eead4);transform:translateY(-2px);box-shadow:0 7px 18px #0003}
.dash-mon-card.dr{opacity:.5}
.dash-mon-card.na:not(.dr){border-style:dashed}
.dash-mon-art{height:94px;width:100%;display:flex;align-items:center;justify-content:center}
.dash-mon-art .dash-sprite{width:88px!important;height:88px!important;object-fit:contain}
.dash-mon-name{font-size:13px;font-weight:850;line-height:1.25;min-height:32px;display:flex;align-items:center;justify-content:center;overflow-wrap:anywhere}
.dash-mon-points{margin-top:4px;color:var(--amber,#ffb454);font-size:13px;font-weight:900}
.dash-mon-types{display:flex;flex-wrap:wrap;justify-content:center;gap:4px;min-height:19px;margin-top:6px}
.dash-mon-type{font-size:9px;font-weight:800;padding:2px 7px;border-radius:99px;text-transform:capitalize;color:#fff;background:#64748b}
.dash-mon-type.type-normal{background:#A8A77A}.dash-mon-type.type-fire{background:#EE8130}.dash-mon-type.type-water{background:#6390F0}.dash-mon-type.type-electric{background:#F7D02C}.dash-mon-type.type-grass{background:#7AC74C}.dash-mon-type.type-ice{background:#96D9D6}.dash-mon-type.type-fighting{background:#C22E28}.dash-mon-type.type-poison{background:#A33EA1}.dash-mon-type.type-ground{background:#E2BF65}.dash-mon-type.type-flying{background:#A98FF3}.dash-mon-type.type-psychic{background:#F95587}.dash-mon-type.type-bug{background:#A6B91A}.dash-mon-type.type-rock{background:#B6A136}.dash-mon-type.type-ghost{background:#735797}.dash-mon-type.type-dragon{background:#6F35FC}.dash-mon-type.type-dark{background:#705746}.dash-mon-type.type-steel{background:#B7B7CE}.dash-mon-type.type-fairy{background:#D685AD}
.dash-mon-type.type-electric,.dash-mon-type.type-ground,.dash-mon-type.type-ice,.dash-mon-type.type-steel{color:#18202a}
.dash-mon-card .dash-status{font-size:10px;font-weight:750;margin-top:7px;line-height:1.25;min-height:13px}
.dash-status.available{color:#5eead4}.dash-status.taken{color:#a1aab8}.dash-status.over{color:#ffb454}
.dash-mon-card .dash-star{position:absolute;right:7px;top:7px;width:30px;height:30px;padding:0;border-radius:9px;font-size:19px;background:rgba(5,8,13,.6);border-color:var(--border,#2a3444)}
.dash-mon-card .dash-star.on{background:#f5b301;border-color:#f5b301;color:#222}
.dash-empty{padding:30px;text-align:center;border:1px dashed var(--border,#2a3444);border-radius:12px}
@media(max-width:560px){.dash-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dash-mon-card{min-height:194px;padding:10px 7px}.dash-mon-art{height:82px}.dash-mon-art .dash-sprite{width:76px!important;height:76px!important}}
/* CP4.26: user-facing draft board redesign */
.dash{max-width:1480px;padding:4px 0 24px;gap:14px}
.dash-head{display:grid;grid-template-columns:minmax(170px,1fr) auto;align-items:center;gap:8px 22px;padding:18px 20px;border:1px solid var(--border);border-radius:16px;background:linear-gradient(120deg,color-mix(in srgb,var(--teal) 11%,var(--panel)),var(--panel));box-shadow:0 8px 24px #00000012}
.dash-team{font-size:clamp(18px,2vw,25px);letter-spacing:-.02em}
.dash-pts{grid-column:2;grid-row:1;text-align:right;font-size:13px;color:var(--text-dim)}.dash-pts .big{font-size:clamp(25px,3vw,36px);line-height:1;color:var(--text);letter-spacing:-.04em}
.dash-bar{grid-column:1/-1;height:7px;margin:0;background:var(--panel-alt)}
.dash-meta{grid-column:1/-1;font-size:12px;color:var(--text-dim)}
.dash-clock{grid-column:1/-1;margin:0;padding:10px 12px;border:1px solid var(--border);background:var(--panel-alt);font-size:13px}
.dash-tabs{display:flex;gap:7px;padding:4px;overflow-x:auto;border:1px solid var(--border);border-radius:13px;background:var(--panel);scrollbar-width:thin}
.dash-tabs button{flex:0 0 auto;min-width:112px;padding:10px 15px;border:1px solid transparent;border-radius:9px;color:var(--text-dim);font-size:12px;transition:background .15s,border-color .15s}
.dash-tabs button.on{background:var(--teal);border-color:var(--teal);color:#062521;box-shadow:0 3px 10px #0002}
.dash-filter-panel{display:grid;gap:14px;padding:17px;border:1px solid var(--border);border-radius:16px;background:var(--panel);box-shadow:0 5px 18px #0000000c}
.dash-filter-title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dash-filter-title h2{margin:2px 0 3px;font-size:18px;letter-spacing:-.02em}.dash-filter-title p{margin:0;color:var(--text-dim);font-size:12px}.dash-kicker{font-size:9px;font-weight:900;letter-spacing:.16em;color:var(--teal);text-transform:uppercase}
.dash-search-row input{width:100%;min-height:43px;padding:10px 13px;border:1px solid var(--border);border-radius:10px;background:var(--panel-alt);color:var(--text);font:inherit}
.dash-filter-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.dash-field{display:grid;gap:5px;min-width:0}.dash-field>span{font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--text-dim);text-transform:uppercase}
.dash-field input,.dash-field select{width:100%;min-width:0;min-height:39px;padding:8px 10px;border:1px solid var(--border);border-radius:9px;background:var(--panel-alt);color:var(--text);font:inherit;font-size:12px}
.dash-filter-footer{display:grid;gap:11px;padding-top:11px;border-top:1px solid var(--border)}.dash-chips{gap:6px}.dash-chips button{padding:6px 11px;border-color:var(--border);font-size:11px}.dash-chips button.on{background:var(--teal);border-color:var(--teal);color:#062521}
.dash-tog{gap:9px 18px;font-size:11px;color:var(--text-dim)}.dash-tog label{cursor:pointer}.dash-tog input{accent-color:var(--teal)}
.dash-result-line{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:9px;border-top:1px solid var(--border)}.dash-result-line .note{font-size:11px}.dash-reset{border:0;background:transparent;color:var(--teal);font:inherit;font-size:11px;font-weight:800;cursor:pointer}.dash-reset:hover{text-decoration:underline}
.dash-list{display:block}.dash-tier{margin:0 0 22px}.dash-tier-head{margin:0 0 9px;padding:0 2px 7px;border-bottom:1px solid var(--border)}.dash-tier-head h3{font-size:11px;letter-spacing:.12em}.dash-tier-head span{font-size:10px}
.dash-grid{grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:11px}
.dash-mon-card{min-height:244px;padding:11px 10px 12px;border-radius:14px;background:linear-gradient(160deg,var(--panel-alt),color-mix(in srgb,var(--panel-alt) 84%,var(--panel)));box-shadow:0 3px 10px #0000000b}
.dash-mon-art{height:98px}.dash-mon-art .dash-sprite{width:92px!important;height:92px!important;filter:drop-shadow(0 5px 5px #0002)}
.dash-mon-name{min-height:34px;font-size:13px}.dash-mon-points{margin-top:3px;font-size:14px}.dash-mon-types{margin-top:7px}.dash-mon-type{font-size:9px;padding:3px 8px}
.dash-mon-abilities{min-height:25px;margin-top:7px;color:var(--text-dim);font-size:9px;line-height:1.3;text-align:center}
.dash-stat-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:3px 6px;width:100%;margin-top:7px;padding:7px 5px;border-radius:8px;background:color-mix(in srgb,var(--panel) 75%,transparent);color:var(--text-dim);font-size:9px}
.dash-stat-strip span{display:flex;justify-content:center;gap:3px}.dash-stat-strip b{color:var(--text);font-variant-numeric:tabular-nums}
.dash-mon-card .dash-status{margin-top:8px;font-size:9px}.dash-card-actions{width:100%;margin-top:auto;padding-top:8px}.dash-card-actions .dash-star{width:31px;height:31px}
.dash-mon-card.dr{filter:grayscale(.7);opacity:.58}.dash-mon-card.na:not(.dr){opacity:.72}
@media(max-width:760px){.dash-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dash-head{padding:14px}.dash-grid{grid-template-columns:repeat(auto-fill,minmax(145px,1fr))}}
@media(max-width:480px){.dash{padding-top:0}.dash-filter-panel{padding:12px}.dash-filter-grid{gap:8px}.dash-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.dash-mon-card{min-height:226px;padding:9px 6px}.dash-mon-art{height:80px}.dash-mon-art .dash-sprite{width:76px!important;height:76px!important}.dash-mon-name{font-size:11px}.dash-stat-strip{font-size:8px}.dash-tabs button{min-width:94px;padding:9px 11px}}

/* CP4.27: actual page-level user dashboard layout, not just card cosmetics. */
body.draft-user-dashboard #app{width:calc(100% - 40px);max-width:1680px;margin:0 auto;padding:34px 0 56px}
body.draft-user-dashboard #app>header{margin:0 0 18px;padding:0 2px}
body.draft-user-dashboard #app>header h1{font-size:clamp(25px,3vw,34px);font-weight:900;letter-spacing:-.04em}
body.draft-user-dashboard #app>header .sub{margin:5px 0 0;line-height:1.55}
body.draft-user-dashboard .dash{width:100%;max-width:none;padding:0;gap:16px}
body.draft-user-dashboard .dash-head{grid-template-columns:minmax(0,1fr) auto;gap:10px 24px;padding:20px 24px;border-radius:18px}
body.draft-user-dashboard .dash-team{font-size:clamp(21px,2.4vw,30px)}
body.draft-user-dashboard .dash-pts .big{font-size:clamp(30px,3.4vw,42px)}
body.draft-user-dashboard .dash-tabs{position:sticky;top:8px;z-index:5;box-shadow:0 5px 18px #00000012}
body.draft-user-dashboard .dash-filter-panel{grid-template-columns:minmax(0,1fr);align-items:start;padding:20px;gap:16px}
body.draft-user-dashboard .dash-filter-title{grid-column:1/-1;align-items:center}
body.draft-user-dashboard .dash-search-row{grid-column:1/-1}
body.draft-user-dashboard .dash-filter-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
body.draft-user-dashboard .dash-filter-footer{align-content:start;padding-top:12px;border-top:1px solid var(--border)}
body.draft-user-dashboard .dash-result-line{grid-column:1/-1}
body.draft-user-dashboard .dash-grid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:13px}
body.draft-user-dashboard .dash-mon-card{min-height:270px;padding:14px 12px;border-radius:16px}
body.draft-user-dashboard .dash-mon-art{height:112px}
body.draft-user-dashboard .dash-mon-art .dash-sprite{width:104px!important;height:104px!important}
body.draft-user-dashboard .dash-mon-name{font-size:14px;min-height:38px}
body.draft-user-dashboard .dash-mon-points{font-size:15px}
body.draft-user-dashboard .dash-stat-strip{font-size:10px;padding:8px 6px}
body.draft-user-dashboard .dash-stat-strip.missing{display:block;text-align:center;color:var(--text-dim)}
body.draft-user-dashboard .dash-card-actions{display:flex;justify-content:center;gap:8px}
body.draft-user-dashboard .dash-card-actions .dash-star{position:static;width:36px;height:36px;border-radius:9px}
@media(max-width:1050px){body.draft-user-dashboard .dash-filter-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:600px){body.draft-user-dashboard #app{width:calc(100% - 22px);padding:18px 0 36px}body.draft-user-dashboard .dash-head{padding:15px;gap:9px}body.draft-user-dashboard .dash-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}body.draft-user-dashboard .dash-mon-card{min-height:250px;padding:10px 7px}body.draft-user-dashboard .dash-mon-art{height:88px}body.draft-user-dashboard .dash-mon-art .dash-sprite{width:82px!important;height:82px!important}body.draft-user-dashboard .dash-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}

.user-board-wrap{display:grid;gap:18px}.user-board-overview{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 18px;padding:20px;border:1px solid var(--border);border-radius:16px;background:var(--panel)}.user-board-overview h2{margin:3px 0;font-size:20px}.user-board-overview p{margin:0;color:var(--text-dim);font-size:12px}.user-board-progress{text-align:right;display:grid;align-content:center}.user-board-progress strong{font-size:25px;line-height:1.1}.user-board-progress span{font-size:10px;color:var(--text-dim)}.user-board-progressbar{grid-column:1/-1;height:7px;border-radius:99px;background:var(--panel-alt);overflow:hidden}.user-board-progressbar i{display:block;height:100%;border-radius:99px;background:var(--teal)}.user-board-clock{grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--teal);border-radius:10px;background:color-mix(in srgb,var(--teal) 8%,var(--panel))}.user-board-clock span{font-size:9px;font-weight:900;letter-spacing:.12em;color:var(--teal)}.user-board-clock strong{font-size:14px}.user-board-clock small{margin-left:auto;color:var(--text-dim)}.user-board-round{display:grid;gap:9px}.user-board-round>header{display:flex;align-items:center;justify-content:space-between;padding:0 2px}.user-board-round h3{margin:0;font-size:13px;letter-spacing:.08em;text-transform:uppercase}.user-board-round>header span{font-size:10px;color:var(--text-dim)}.user-board-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:9px}.user-board-pick{min-width:0;min-height:155px;padding:11px;border:1px solid var(--border);border-radius:13px;background:var(--panel);display:flex;flex-direction:column;gap:7px}.user-board-pick.mine{border-color:color-mix(in srgb,var(--teal) 75%,var(--border));background:color-mix(in srgb,var(--teal) 5%,var(--panel))}.user-board-pick.clock{border-color:var(--amber);box-shadow:0 0 0 1px var(--amber) inset}.user-board-pick-top{display:flex;align-items:center;justify-content:space-between;gap:6px}.user-board-pick-top b{font-size:11px}.user-board-pick-top span{font-size:8px;font-weight:900;letter-spacing:.08em;color:var(--text-dim)}.user-board-pick.clock .user-board-pick-top span{color:var(--amber)}.user-board-franchise{font-size:12px;font-weight:800;overflow-wrap:anywhere}.user-board-mon{display:grid;grid-template-columns:42px minmax(0,1fr);align-items:center;gap:2px 8px;margin-top:auto}.user-board-mon img{grid-row:span 2;width:42px;height:42px;object-fit:contain}.user-board-mon strong{font-size:11px;overflow-wrap:anywhere}.user-board-mon span{font-size:10px;color:var(--amber)}.user-board-wait{margin-top:auto;padding:10px 0;color:var(--text-dim);font-size:11px}.user-board-pick.pending{background:color-mix(in srgb,var(--panel-alt) 65%,var(--panel))}.user-board-pick.complete .user-board-pick-top span{color:var(--teal)}
@media(max-width:600px){.user-board-overview{padding:14px}.user-board-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.user-board-pick{min-height:142px;padding:9px}.user-board-franchise{font-size:10px}.user-board-mon{grid-template-columns:34px minmax(0,1fr)}.user-board-mon img{width:34px;height:34px}}
`;document.head.appendChild(st)}
function dashMon(id){return state.settings.draft.pool.find(m=>String(m.id)===String(id))}
function dashSprite(name){try{return SBL.pokemon.spriteMarkup(name,'dash-sprite','hd').replace('<img ','<img loading="lazy" ')}catch{return ''}}
function dashTypes(m){return (m.types||[]).map(t=>`<span class="dash-ty">${esc(t)}</span>`).join('')}
function drawDashHead(d){
  const t=myTeam(),el=$('dashHead');if(!el)return;
  if(!t){el.innerHTML='<div class="dash-head"><div class="dash-team">No franchise linked</div><div class="dash-meta">You can browse the pool, but your budget needs a franchise. Ask the commissioner to link your account.</div></div>';return}
  const b=DD().budgetInfo(d,t),lim=Math.max(0,DD().spendLimit(d,t)),pct=b.total?Math.max(0,Math.min(100,b.left/b.total*100)):0;
  const until=DD().picksUntil(d,t),oc=d.mode==='ordered'?d.order[d.currentPick]:null;
  let clock,me=false;
  if(d.status==='lobby'||d.status==='setup')clock='The draft has not started. Plan your queue.';
  else if(d.status==='complete')clock='Draft complete.';
  else if(d.mode!=='ordered')clock='Picks are made live by the commissioner.';
  else if(oc===t){clock="You're on the clock!";me=true}
  else clock=`On the clock: ${esc(oc||'—')}`+(until!=null?` · you pick in ${until} pick${until===1?'':'s'}`:'');
  el.innerHTML=`<div class="dash-head"><div class="dash-team">${esc(t)}</div><div class="dash-pts"><span class="big">${b.left}</span> / ${b.total} pts left</div><div class="dash-bar"><i style="width:${pct}%"></i></div><div class="dash-meta">Picks ${b.picks}/${b.maxPicks} · Most you can spend on one pick: <b>${lim}</b> pts${b.need>1?' (keeps enough for your remaining roster)':''}</div><div class="dash-clock${me?' me':''}">${clock}</div></div>`;
}
function drawDashTabs(){
  const el=$('dashTabs');if(!el)return;const dd=state.settings.draft,t=[['pool','Free Agency'],['queue','Queue ('+dash.queue.length+')'],['roster','My roster'],['board','Board']].concat(dd.lottery&&dd.lottery.proposed&&dd.lottery.proposed.length>1?[['lottery','Lottery']]:[]);
  el.innerHTML=t.map(([k,l])=>`<button data-act="tab" data-tab="${k}" class="${dash.tab===k?'on':''}">${l}</button>`).join('');
}
function dashQueueChanged(){
  dash.saveMsg='Saving…';const s=$('dashSave');if(s)s.textContent=dash.saveMsg;drawDashTabs();
  clearTimeout(dashSaveT);dashSaveT=setTimeout(async()=>{
    const r=await SBL.draft.queue.save(dash.queue).catch(()=>({ok:false,local:true}));
    dash.saveMsg=r.ok?'Saved':'Saved on this device only';const e=$('dashSave');if(e)e.textContent=dash.saveMsg;
  },500);
}
function dashCard(d,t,m,opts={}){
  const aff=DD().canAfford(d,t,m),q=dash.queue.includes(String(m.id));
  const status=m.drafted?`<span>Taken${m.draftedBy?' by '+esc(m.draftedBy):''}</span>`:(!aff&&t?'<span>Over your limit</span>':'');
  const right=opts.queueTab
    ?`<div class="dash-acts"><button class="dash-mini" data-act="up" data-id="${esc(m.id)}">↑</button><button class="dash-mini" data-act="down" data-id="${esc(m.id)}">↓</button><button class="dash-mini" data-act="rm" data-id="${esc(m.id)}">✕</button></div>`
    :`<button class="dash-star${q?' on':''}" data-act="q" data-id="${esc(m.id)}" aria-label="${q?'Remove from queue':'Add to queue'}">★</button>`;
  return `<div class="dash-card${m.drafted?' dr':(!aff&&t?' na':'')}${opts.next?' next':''}">${dashSprite(m.name)}<div><div class="dash-name">${esc(m.name)}${opts.next?' · next target':''}</div><div class="dash-sub">${dashTypes(m)}<span>${Number(m.points)||0} pts</span>${status}</div></div>${right}</div>`;
}
function drawDashList(d){
  const t=myTeam(),list=$('dashList');if(!list)return;
  const filtered=DD().applyFilters(d,t,dash.f,dash.queue);
  const statKey=dash.f.stat||'atk';
  const statValue=m=>DD().statValue(m,statKey)??-1;
  let res;
  if((dash.groupBy==='stat'||dash.sort==='stat-desc')&&dash.f.stat){res=filtered.slice().sort((a,b)=>statValue(b)-statValue(a)||Number(b.points||0)-Number(a.points||0)||a.name.localeCompare(b.name));}
  else{res=DD().sortPool(filtered,dash.sort==='stat-desc'?'pts-desc':dash.sort);}
  const shown=res.slice(0,dash.limit);
  const c=$('dashCount');if(c){const ready=(d.pool||[]).filter(draftHasUsableStats).length;c.textContent=`Showing ${shown.length} of ${res.length} Pokémon${dash.f.affordable&&t?' you can afford':''} · base stats available for ${ready}/${d.pool.length}`;}
  document.querySelectorAll('#dashTypes button').forEach(b=>b.classList.toggle('on',dash.f.types.includes(b.dataset.type)));
  if(!shown.length){list.innerHTML='<div class="note dash-empty">Nothing matches these filters.</div>';return;}
  const ordered=shown.slice().sort((a,b)=>statValue(b)-statValue(a)||Number(b.points||0)-Number(a.points||0)||a.name.localeCompare(b.name));
  if((dash.groupBy==='stat'||dash.sort==='stat-desc') && dash.f.stat){
    list.innerHTML=`<section class="dash-tier"><div class="dash-tier-head"><h3>RANKED BY ${esc(statKey.toUpperCase())}</h3><span>Highest first</span></div><div class="dash-grid">${ordered.map(m=>dashBoardCard(d,t,m)).join('')}</div></section>`+
      (res.length>shown.length?`<button class="dash-more" data-act="more">Show more (${res.length-shown.length} remaining)</button>`:'');
  }else{
    const groups={};shown.forEach(m=>{const pts=Number(m.points)||0;(groups[pts]??=[]).push(m)});
    const tiers=Object.keys(groups).sort((a,b)=>Number(b)-Number(a));
    list.innerHTML=tiers.map(pts=>{const group=dash.f.stat?groups[pts].slice().sort((a,b)=>statValue(b)-statValue(a)||a.name.localeCompare(b.name)):groups[pts];return `<section class="dash-tier"><div class="dash-tier-head"><h3>${Number(pts)===1?'1 POINT':`${esc(pts)} POINTS`}</h3><span>${groups[pts].length} shown</span></div><div class="dash-grid">${group.map(m=>dashBoardCard(d,t,m)).join('')}</div></section>`}).join('')+
      (res.length>shown.length?`<button class="dash-more" data-act="more">Show more (${res.length-shown.length} remaining)</button>`:'');
  }
}
function dashBoardCard(d,t,m){
  const aff=DD().canAfford(d,t,m),q=dash.queue.includes(String(m.id));
  const types=(Array.isArray(m.types)?m.types:[]).map(x=>String(x).toLowerCase()).filter(Boolean);
  const stats=Object.fromEntries(['hp','atk','def','spa','spd','spe'].map(k=>[k,DD().statValue(m,k)]).filter(([,v])=>v!=null));
  const status=m.drafted?`<div class="dash-status taken">Drafted${m.draftedBy?' by '+esc(m.draftedBy):''}</div>`:(!aff&&t?'<div class="dash-status over">Over your limit</div>':'<div class="dash-status available">Available</div>');
  return `<article class="dash-mon-card${m.drafted?' dr':''}${!aff&&t&&!m.drafted?' na':''}">
    <div class="dash-mon-art">${dashSprite(m.name)}</div>
    <div class="dash-mon-name">${esc(SBL.pokemon.displayNameWithForm?.(m.name)||m.name)}</div>
    <div class="dash-mon-points">${Number(m.points)||0} pts</div>
    <div class="dash-mon-types">${types.map(x=>`<span class="dash-mon-type type-${esc(x)}">${esc(x)}</span>`).join('')}</div>
    <div class="dash-mon-abilities">${(m.abilities||[]).slice(0,2).map(a=>esc(a)).join(' · ')}</div>${Object.keys(stats).length===6?`<div class="dash-stat-strip"><span>HP <b>${stats.hp}</b></span><span>ATK <b>${stats.atk}</b></span><span>DEF <b>${stats.def}</b></span><span>SPA <b>${stats.spa}</b></span><span>SPD <b>${stats.spd}</b></span><span>SPE <b>${stats.spe}</b></span></div>`:'<div class="dash-stat-strip missing">Stats loading…</div>'}
    ${status}
    <div class="dash-card-actions"><button class="dash-star${q?' on':''}" data-act="q" data-id="${esc(m.id)}" aria-label="${q?'Remove from queue':'Add to queue'}" title="${q?'Remove from queue':'Add to queue'}">${q?'★':'☆'}</button></div>
  </article>`;
}
function buildDashPool(d){
  const body=$('dashBody');if(!body)return;const f=dash.f;
  body.innerHTML=`<section class="dash-filter-panel"><div class="dash-filter-title"><div><span class="dash-kicker">PLAYER TOOLKIT</span><h2>Find your next pick</h2><p>Search, compare stats and narrow the pool before adding Pokémon to your queue.</p></div><span class="dash-save" id="dashSave">${esc(dash.saveMsg)}</span></div><div class="dash-search-row"><input type="search" id="dashQ" placeholder="Search Pokémon by name…" value="${esc(f.q)}" autocomplete="off"></div><div class="dash-filter-grid"><label class="dash-field"><span>Sort results</span><select id="dashSort"><option value="pts-desc">Points · high to low</option><option value="pts-asc">Points · low to high</option><option value="name">Name · A–Z</option><option value="type">Type</option><option value="stat-desc">Selected stat · highest</option></select></label><label class="dash-field"><span>Stat to filter / rank</span><select id="dashStat"><option value="">Select stat to filter…</option><option value="atk">Attack</option><option value="spa">Special Attack</option><option value="def">Defense</option><option value="spd">Special Defense</option><option value="spe">Speed</option><option value="hp">HP</option></select></label><label class="dash-field"><span>Minimum stat</span><input type="number" id="dashStatMin" min="0" max="255" inputmode="numeric" placeholder="No minimum" value="${esc(f.statMin)}"></label><label class="dash-field"><span>Maximum stat</span><input type="number" id="dashStatMax" min="0" max="255" inputmode="numeric" placeholder="No maximum" value="${esc(f.statMax)}"></label><label class="dash-field"><span>Minimum points</span><input type="number" id="dashMin" min="0" inputmode="numeric" placeholder="Any" value="${esc(f.minPts)}"></label><label class="dash-field"><span>Maximum points</span><input type="number" id="dashMax" min="0" inputmode="numeric" placeholder="Any" value="${esc(f.maxPts)}"></label><label class="dash-field"><span>Group results</span><select id="dashGroup"><option value="points">By point tier</option><option value="stat">Overall stat ranking</option></select></label><label class="dash-field"><span>Ability contains</span><input type="search" id="dashAbility" placeholder="Filter by ability…" value="${esc(f.ability)}"></label><label class="dash-field"><span>Pokémon form</span><select id="dashMega"><option value="all" ${f.mega==='all'?'selected':''}>All Pokémon</option><option value="mega" ${f.mega==='mega'?'selected':''}>Mega only</option><option value="standard" ${f.mega==='standard'?'selected':''}>Non-Mega only</option></select></label></div><div class="dash-filter-footer"><div class="dash-chips" id="dashTypes">${DD().allTypes(d.pool).map(x=>`<button data-act="type" data-type="${esc(x)}">${esc(x)}</button>`).join('')}</div><div class="dash-tog"><label><input type="checkbox" id="dashAff" ${f.affordable?'checked':''}> Affordable only</label><label><input type="checkbox" id="dashDr" ${f.showDrafted?'checked':''}> Include drafted</label><label><input type="checkbox" id="dashQo" ${f.queuedOnly?'checked':''}> Queue only</label></div></div><div class="dash-result-line"><span class="note" id="dashCount"></span><button type="button" class="dash-reset" data-act="resetFilters">Reset filters</button></div></section><div class="dash-list" id="dashList"></div>`;
  $('dashSort').value=dash.sort;$('dashStat').value=dash.f.stat||'';$('dashGroup').value=dash.groupBy||'points';drawDashList(d);
}
function drawDashBody(d,rebuild){
  const body=$('dashBody');if(!body)return;const t=myTeam();
  if(dash.tab==='pool'){if(rebuild||!$('dashList'))buildDashPool(d);else drawDashList(d);return}
  if(dash.tab==='queue'){
    const items=dash.queue.map(dashMon).filter(Boolean);
    const nextId=(items.find(m=>!m.drafted&&DD().canAfford(d,t,m))||{}).id;
    body.innerHTML=`<div class="dash-save" id="dashSave">${esc(dash.saveMsg)}</div>`+(items.length?`<div class="dash-list">${items.map(m=>dashCard(d,t,m,{queueTab:true,next:String(m.id)===String(nextId)})).join('')}</div><button class="dash-more" data-act="clearTaken" style="margin-top:8px">Remove taken Pokémon</button>`:'<div class="note">Your queue is empty. Tap ★ on a Pokémon in Free Agency to plan. Taken Pokémon are skipped automatically.</div>');return}
  if(dash.tab==='roster'){
    const r=Array.isArray(state.settings.rosters?.[t])?state.settings.rosters[t]:[];const tot=r.reduce((n,e)=>n+(Number(e?.points)||0),0);
    body.innerHTML=r.length?`<div class="dash-list">${r.map(e=>{const nm=typeof e==='string'?e:e.name,pt=typeof e==='string'?0:Number(e.points)||0;return `<div class="dash-card">${dashSprite(nm)}<div><div class="dash-name">${esc(nm)}</div></div><div>${pt} pts</div></div>`}).join('')}</div><div class="note" style="margin-top:8px">${r.length} Pokémon · ${tot} pts</div>`:'<div class="note">Your roster is empty.</div>';return}
  if(dash.tab==='board'){body.innerHTML=dashboardBoardView(d);return}
  if(dash.tab==='lottery'){body.innerHTML=lotteryView(d);return}
  body.innerHTML='<div class="note">Draft picks are managed by the commissioner. The Board tab shows completed and upcoming picks.</div>';
}
function bindDash(){
  const root=$('dashRoot');
  root.addEventListener('click',e=>{
    const b=e.target.closest('[data-act]');if(!b)return;const d=state.settings.draft,a=b.dataset.act,id=b.dataset.id;
    if(a==='tab'){dash.tab=b.dataset.tab;dash.tabChosen=true;drawDashTabs();drawDashBody(d,true)}
    else if(a==='type'){const i=dash.f.types.indexOf(b.dataset.type);if(i<0)dash.f.types.push(b.dataset.type);else dash.f.types.splice(i,1);dash.limit=60;drawDashList(d)}
    else if(a==='more'){dash.limit+=60;drawDashList(d)}
    else if(a==='resetFilters'){dash.f={...dash.f,q:'',types:[],ability:'',stat:'',statMin:'',statMax:'',minPts:'',maxPts:'',mega:'all',affordable:true,showDrafted:false,queuedOnly:false};dash.sort='pts-desc';dash.groupBy='points';dash.limit=60;buildDashPool(d)}
    else if(a==='q'){const i=dash.queue.indexOf(String(id));if(i<0)dash.queue.push(String(id));else dash.queue.splice(i,1);b.classList.toggle('on',i<0);dashQueueChanged();if(dash.f.queuedOnly)drawDashList(d)}
    else if(a==='up'||a==='down'){const i=dash.queue.indexOf(String(id)),j=a==='up'?i-1:i+1;if(i>=0&&j>=0&&j<dash.queue.length){[dash.queue[i],dash.queue[j]]=[dash.queue[j],dash.queue[i]];dashQueueChanged();drawDashBody(d,true)}}
    else if(a==='rm'){dash.queue=dash.queue.filter(x=>x!==String(id));dashQueueChanged();drawDashBody(d,true)}
    else if(a==='clearTaken'){dash.queue=dash.queue.filter(x=>{const m=dashMon(x);return m&&!m.drafted});dashQueueChanged();drawDashBody(d,true)}
  });
  root.addEventListener('input',e=>{
    const id=e.target.id,d=state.settings.draft;
    if(id==='dashQ'){clearTimeout(dashSearchT);dashSearchT=setTimeout(()=>{dash.f.q=e.target.value;dash.limit=60;drawDashList(d)},150)}
    else if(id==='dashMin'||id==='dashMax'){dash.f[id==='dashMin'?'minPts':'maxPts']=e.target.value;dash.limit=60;drawDashList(d)}
    else if(id==='dashStatMin'||id==='dashStatMax'){dash.f[id==='dashStatMin'?'statMin':'statMax']=e.target.value;if(e.target.value&&!dash.f.stat){dash.f.stat='atk';const stat=$('dashStat');if(stat)stat.value='atk'}dash.limit=60;drawDashList(d)}
    else if(id==='dashAbility'){dash.f.ability=e.target.value;dash.limit=60;drawDashList(d)}
  });
  root.addEventListener('change',e=>{
    const id=e.target.id,d=state.settings.draft;
    if(id==='dashSort'){dash.sort=e.target.value;if(dash.sort==='stat-desc'&&!dash.f.stat){dash.f.stat='atk';const stat=$('dashStat');if(stat)stat.value='atk'}drawDashList(d)}
    else if(id==='dashStat'){dash.f.stat=e.target.value;dash.sort=e.target.value?'stat-desc':'pts-desc';drawDashList(d)}
    else if(id==='dashMega'){dash.f.mega=e.target.value;dash.limit=60;drawDashList(d)}
    else if(id==='dashGroup'){dash.groupBy=e.target.value;if(dash.groupBy==='stat'&&!dash.f.stat){dash.f.stat='atk';const stat=$('dashStat');if(stat)stat.value='atk'}dash.sort=e.target.value==='stat'?'stat-desc':'pts-desc';const s=$('dashSort');if(s)s.value=dash.sort;drawDashList(d)}
    else if(id==='dashAff'){dash.f.affordable=e.target.checked;dash.limit=60;drawDashList(d)}
    else if(id==='dashDr'){dash.f.showDrafted=e.target.checked;dash.limit=60;drawDashList(d)}
    else if(id==='dashQo'){dash.f.queuedOnly=e.target.checked;dash.limit=60;drawDashList(d)}
  });
}
function renderDashboard(d){
  document.body.classList.add('draft-user-dashboard');
  dashStyles();
  if(!dash.tabChosen&&d.lottery&&d.lottery.status==='drawn'&&d.lottery.result&&d.lottery.result.length)dash.tab='lottery';
  const host=$('cmdBody')||content;
  if(!dash.queueLoaded){dash.queueLoaded=true;SBL.draft.queue.load().then(q=>{dash.queue=q;if($('dashRoot')){drawDashTabs();if(dash.tab!=='pool')drawDashBody(state.settings.draft,true);else drawDashList(state.settings.draft)}}).catch(()=>{})}
  if(!$('dashRoot')){host.innerHTML='<div id="dashRoot" class="dash"><div id="dashHead"></div><div class="dash-tabs" id="dashTabs"></div><div id="dashBody"></div></div>';bindDash();drawDashHead(d);drawDashTabs();drawDashBody(d,true);return}
  /* Live update: refresh numbers and lists in place so typing/scrolling is never lost. */
  drawDashHead(d);drawDashTabs();
  if(dash.tab==='pool')drawDashList(d);else drawDashBody(d,true);
}
/* ---- DASHBOARD END ---- */

/* ---- Presentation view: draft.html?league=<id>&view=present ----------------
   On the clock until a pick lands, then a full-screen reveal. Reveals fire only
   from live pick events (never on page load) and never replay. Press T to
   preview a reveal, Space/Esc/click to skip one. */
const PRESENT=new URLSearchParams(location.search).get('view')==='present';
let revealing=false;const revealQueue=[];
const hueOf=t=>{let h=0;for(const c of String(t||''))h=(h*31+c.charCodeAt(0))%360;return h};
const prEsc=x=>SBL.pokemon.escapeHtml(x);
/* Draft-only showcase artwork: HD official artwork for default National Dex
   species, with exact HOME/Gen 5 sprite fallbacks for alternate forms. */
function presentationHeroSprite(name){
  const pokemon=SBL.pokemon;
  const candidates=pokemon.spriteUrlCandidates(name,'hd').slice();
  if(!candidates.length)return pokemon.spriteMarkup(name,'pr-hero','hd');
  const isAlternate=!!pokemon.hasAlternateForm?.(name);
  return `<img class="pr-hero${isAlternate?' pr-hero-form':''} sbl-remote-sprite" data-sbl-sprite-style="hd" src="${prEsc(candidates[0])}" alt="${prEsc(name)}" title="${prEsc(name)}" width="475" height="475" decoding="async" fetchpriority="high" data-sbl-sprite-candidates='${prEsc(JSON.stringify(candidates))}' data-sbl-sprite-index="0" onerror="SBL.pokemon.handleSpriteError(this)">`;
}

function presentStyles(){if(document.getElementById('presentStyle'))return;const st=document.createElement('style');st.id='presentStyle';st.textContent=`
body.present{background:#05070d!important;overflow:hidden}
body.present #app>header,body.present nav,body.present .site-nav,body.present #siteNav{display:none!important}
body.present #app{width:100%!important;max-width:none!important;min-height:100svh!important;padding:0!important;margin:0!important}
body.present #content{width:100%;min-height:100svh;margin:0;padding:0}
.pr-mock-label{position:absolute;z-index:8;top:clamp(10px,2vh,24px);left:50%;transform:translateX(-50%);padding:7px 13px;border:1px solid #f5c76c66;border-radius:999px;background:#101827dd;color:#f5c76c;font:800 10px/1.2 system-ui,sans-serif;letter-spacing:.14em;text-align:center;white-space:nowrap}
.pr-stage{min-height:100svh;min-height:100dvh;display:grid;grid-template-rows:minmax(0,1fr) auto;color:#fff;background:radial-gradient(120vmax 80vmax at 50% 40%,hsl(var(--h,220) 45% 14%),#05070d 70%);overflow:hidden}
.pr-main{min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.5vmin;text-align:center;padding:clamp(24px,5vmin,76px);}
.pr-kicker{letter-spacing:.28em;text-transform:uppercase;font-size:clamp(13px,1.8vmin,24px);opacity:.72}
.pr-title{font-size:clamp(30px,6vmin,84px);font-weight:800}
.pr-team{font-size:clamp(42px,10vmin,176px);font-weight:900;line-height:1.04;text-shadow:0 0 6vmin hsl(var(--h,220) 90% 55%/.55);max-width:94vw;overflow-wrap:anywhere}
.pr-clock{animation:prPulse 3.4s ease-in-out infinite}
@keyframes prPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.25)}}
.pr-sub{font-size:clamp(17px,2.6vmin,38px);opacity:.85}
.pr-strip{display:flex;flex-wrap:wrap;gap:1vmin;justify-content:center;align-content:center;padding:1.4vmin 2.5vmin;max-height:19svh;overflow:auto;border-top:1px solid #ffffff1f;background:#00000055}
.pr-chip{display:flex;align-items:center;gap:.7vmin;padding:.45vmin 1.2vmin .45vmin .5vmin;border:1px solid #ffffff12;border-radius:999px;background:#ffffff12;font-size:clamp(10px,1.35vmin,18px);white-space:nowrap}
.pr-chip img{width:clamp(30px,4.4vmin,58px);height:clamp(30px,4.4vmin,58px);object-fit:contain}
.pr-reveal{position:fixed;inset:0;z-index:99999;overflow:auto;display:grid;place-items:center;padding:clamp(14px,3vw,52px);background:#03050c00;animation:prDim .35s forwards;cursor:pointer}
@keyframes prDim{to{background:#03050c}}
.pr-wipe{position:fixed;inset:0;background:linear-gradient(100deg,hsl(var(--h) 85% 46%),hsl(calc(var(--h) + 40) 90% 34%));transform:translateX(-101%);animation:prWipe .95s cubic-bezier(.7,0,.2,1) .05s forwards}
@keyframes prWipe{0%{transform:translateX(-101%)}45%{transform:translateX(0)}100%{transform:translateX(101%)}}
.pr-flare{position:fixed;width:min(86vmin,900px);height:min(86vmin,900px);border-radius:50%;background:radial-gradient(circle,hsl(var(--h) 90% 60%/.5),transparent 66%);opacity:0;transform:scale(.4);animation:prFlare 1.5s ease-out .55s forwards;pointer-events:none}
@keyframes prFlare{40%{opacity:1}100%{opacity:.55;transform:scale(1.15)}}
.pr-card{position:relative;z-index:1;width:min(94vw,1540px);min-height:min(78vh,940px);display:grid;grid-template-columns:minmax(0,1.18fr) minmax(320px,.82fr);align-items:center;gap:clamp(22px,4vw,72px);padding:clamp(22px,4vw,64px);border:1px solid #ffffff20;border-radius:clamp(20px,2.4vw,38px);background:linear-gradient(135deg,#111827ed,#080d18f2);box-shadow:0 35px 120px #0009;color:#fff}
.pr-art{grid-column:1;grid-row:1;min-width:0;min-height:0;display:grid;place-items:center;position:relative;isolation:isolate}
.pr-art:before{content:"";position:absolute;width:min(48vw,68vh,760px);aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,hsl(var(--h) 75% 48%/.22),hsl(var(--h) 70% 38%/.07) 58%,transparent 72%);z-index:-1}
.pr-card .pr-hero{display:block;justify-self:center;align-self:center;margin-inline:auto;width:min(100%,min(54vw,70vh,760px))!important;height:auto!important;max-width:760px!important;max-height:70vh!important;aspect-ratio:1;object-fit:contain;object-position:50% 50%;filter:drop-shadow(0 18px 38px hsl(var(--h) 95% 60%/.32));opacity:0;transform:scale(.72) translateY(3vmin);animation:prHero .95s cubic-bezier(.2,.9,.2,1.1) .6s forwards}
/* Form sprites often contain more transparent canvas than default species. Enlarge the visible artwork while preserving the same centred image box. */
.pr-card .pr-hero-form{animation-name:prHeroForm}
@keyframes prHero{to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes prHeroForm{to{opacity:1;transform:scale(1.5) translateY(0)}}
.pr-info{grid-column:2;grid-row:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:clamp(10px,1.8vmin,24px);text-align:left}
.pr-info>*{opacity:0;transform:translateY(2vmin);animation:prUp .6s ease-out forwards}
@keyframes prUp{to{opacity:1;transform:none}}
.pr-pickno{letter-spacing:.22em;text-transform:uppercase;font-size:clamp(12px,1.7vmin,22px);color:#c4d0e2;animation-delay:1.45s!important}
.pr-picked-label{font-size:clamp(13px,1.8vmin,24px);font-weight:900;letter-spacing:.22em;text-transform:uppercase;color:#fff;animation-delay:1.6s!important}
.pr-mon{font-size:clamp(34px,5.4vmin,82px);font-weight:950;line-height:1.02;overflow-wrap:anywhere;animation-delay:.95s!important}
.pr-badge{padding:.5vmin 1.8vmin;border-radius:999px;background:hsl(var(--h) 90% 55%);color:#07101b;font-weight:900;letter-spacing:.2em;font-size:clamp(11px,1.6vmin,20px);animation-delay:1.65s!important}
.pr-info .pr-team{font-size:clamp(22px,3.8vmin,56px);line-height:1.08;text-shadow:none;animation-delay:2.15s!important}
.pr-pts{font-size:clamp(19px,2.7vmin,38px);font-weight:900;color:#f9c66b;animation-delay:1.95s!important}
.pr-extra{font-size:clamp(14px,1.8vmin,23px);opacity:.88;letter-spacing:.04em;line-height:1.5;animation-delay:2.35s!important}
.pr-stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;animation-delay:2.55s!important}
.pr-stat{padding:7px 10px;border:1px solid #ffffff20;border-radius:10px;background:#ffffff0b;font:700 clamp(11px,1.35vmin,16px)/1.2 ui-monospace,monospace;color:#dce7f7}
.pr-reveal.out{animation:prOut .45s forwards}
@keyframes prOut{to{opacity:0}}
.pr-lottery{width:100%;height:100%;min-height:100dvh;padding:clamp(18px,3vw,48px);display:grid;grid-template-rows:auto minmax(0,1fr);gap:clamp(16px,2.5vh,34px);color:#fff;background:radial-gradient(100vmax 75vmax at 50% 35%,#182848,#05070d 72%);overflow:auto}
.pr-lot-head{text-align:center}.pr-lot-title{font-size:clamp(30px,5vmin,76px);font-weight:950;letter-spacing:.04em}.pr-lot-sub{font-size:clamp(14px,2vmin,26px);color:#bdc9dc;margin-top:8px}
.pr-lot-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:clamp(10px,1.5vw,20px);align-content:start;max-width:1800px;width:100%;margin:0 auto}
.pr-lot-slot{display:flex;align-items:center;gap:14px;min-width:0;padding:clamp(12px,1.5vw,22px);border:1px solid #ffffff20;border-radius:16px;background:#ffffff0b;min-height:88px}
.pr-lot-slot .num{flex:0 0 2.1em;font-size:clamp(24px,3vmin,42px);font-weight:950;color:#f5c76c}.pr-lot-slot .name{font-size:clamp(16px,2.2vmin,30px);font-weight:800;overflow-wrap:anywhere}.pr-lot-slot.pending .name{color:#7f8ba0;letter-spacing:.15em}.pr-lot-slot.recent{border-color:#f5c76c;background:linear-gradient(110deg,#f5c76c30,#ffffff0b);box-shadow:0 0 35px #f5c76c20;animation:prLotIn .7s ease-out both}.pr-lot-slot.recent .num{color:#fff}
@keyframes prLotIn{from{opacity:.25;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
@media(max-width:760px),(max-height:620px) and (orientation:landscape){
 .pr-reveal{align-items:start;padding:12px;}
 .pr-card{width:min(100%,680px);min-height:0;grid-template-columns:minmax(0,1fr);gap:12px;padding:clamp(16px,4vw,28px);margin:auto;}
 .pr-art{grid-column:1;grid-row:1;min-height:0;}
 .pr-art:before{width:min(68vw,42vh,390px);}
 .pr-card .pr-hero{width:min(66vw,42vh,390px)!important;max-height:42vh!important;}
 .pr-info{grid-column:1;grid-row:2;align-items:center;text-align:center;gap:9px;}
 .pr-info .pr-team{font-size:clamp(20px,5vw,36px);}
 .pr-mon{font-size:clamp(30px,7vw,52px);}
 .pr-stats{justify-content:center;}
 .pr-strip{max-height:16svh;}
}
@media(max-width:420px){.pr-card{gap:8px;padding:14px}.pr-card .pr-hero{width:min(58vw,32vh,260px)!important;max-height:32vh!important}.pr-info{gap:7px}.pr-pickno{font-size:10px}.pr-extra{font-size:12px}.pr-stat{padding:6px 7px;font-size:10px}}
@media(prefers-reduced-motion:reduce){.pr-wipe,.pr-flare{display:none}.pr-reveal *{animation-duration:.01s!important;animation-delay:0s!important}}
`;document.head.appendChild(st);document.body.classList.add('present')}
function teamLeft(d,t){const total=Number(keyedValue(d.budgets,t,d.defaultBudget))||0;return total-d.picks.filter(p=>sameTeam(p.team,t)).reduce((a,p)=>a+(Number(p.points)||0),0)}
function renderPresent(){
  presentStyles();if(revealing)return;
  const d=state.settings.draft;
  const lot=d?.lottery&&LT().normalize(d.lottery);
  if(lot&&lot.proposed.length>1&&['setup','drawn'].includes(lot.status)){
    const isDrawn=lot.result.length>0&&lot.status!=='setup';
    const k=Math.min(lot.picks,lot.result.length);
    const vis=isDrawn?LT().visiblePicks(lot):[];
    const newest=isDrawn&&lot.revealed>0?(lot.revealed<=k?k-lot.revealed:lot.revealed-1):-1;
    const slots=isDrawn?lot.result:lot.proposed;
    const cards=slots.map((team,i)=>{const shown=isDrawn?!!vis[i]:false;const name=shown?team:'Waiting to be revealed';const recent=shown&&i===newest;return `<div class="pr-lot-slot ${shown?'shown':'pending'} ${recent?'recent':''}"><span class="num">${i+1}</span><span class="name">${prEsc(name)}</span></div>`}).join('');
    const status=!isDrawn?'Lottery ready':lot.revealed>=lot.result.length?'Lottery results revealed':`Reveal ${lot.revealed} of ${lot.result.length} · ${lot.result.length-lot.revealed} positions left`;
    content.innerHTML=`<div class="pr-lottery"><header class="pr-lot-head"><div class="pr-kicker">SBL · Draft Lottery</div><div class="pr-lot-title">${isDrawn?'The Draft Order':'The Road to Pick #1'}</div><div class="pr-lot-sub">${prEsc(status)} · ${lot.proposed.length} franchises</div></header><div class="pr-lot-grid">${cards}</div></div>`;return;
  }
  let main,hue=220;
  if(!d||d.status==='setup'||d.status==='lobby'){main=`<div class="pr-kicker">Season draft</div><div class="pr-title">${d&&d.status==='lobby'?'Waiting for the draft to begin':'Draft not ready'}</div>`}
  else if(d.status==='complete'||(d.mode==='ordered'&&d.currentPick>=d.order.length)){main='<div class="pr-kicker">Draft complete</div><div class="pr-title">That\'s a wrap</div>'}
  else{
    const n=new Set(d.order).size||1,pickNo=d.picks.length+1,round=Math.floor((pickNo-1)/n)+1;
    if(d.mode==='ordered'){const t=d.order[d.currentPick];hue=hueOf(t);main=`<div class="pr-kicker">Up next · Round ${round} · Pick ${pickNo}</div><div class="pr-team pr-clock">${prEsc(t)}</div><div class="pr-sub">${teamLeft(d,t)} points available</div>`}
    else main=`<div class="pr-kicker">Round ${round}</div><div class="pr-title">Pick ${pickNo}</div>`;
  }
  const strip=d?d.picks.slice(-6).reverse().map(p=>`<div class="pr-chip">${SBL.pokemon.spriteMarkup(p.name,'pr-chip-sprite','hd')}<span>#${p.pickNumber} ${prEsc(p.name)} · ${prEsc(p.team)}</span></div>`).join(''):'';
  content.innerHTML=`<div class="pr-stage" style="--h:${hue}">${MOCK_DRAFT_MODE?'<div class="pr-mock-label">ADMINISTRATIVE MOCK DRAFT · SIMULATION ONLY</div>':''}<div class="pr-main">${main}</div><div class="pr-strip">${strip}</div></div>`;
}
function enqueueReveal(p){if(!PRESENT)return;const key=pickEventKey(p);if(seenPickKeys.has(key))return;seenPickKeys.add(key);revealQueue.push(p);if(!revealing)nextReveal()}
function nextReveal(){
  const p=revealQueue.shift();
  if(!p){revealing=false;renderPresent();return}
  revealing=true;presentStyles();
  const d=state.settings.draft,n=new Set(d.order||[]).size||1,round=Math.floor(((Number(p.pickNumber)||d.picks.length)-1)/n)+1;
  const mon=(d.pool||[]).find(m=>String(m.id)===String(p.poolId)||m.name.toLowerCase()===String(p.name||'').toLowerCase())||{};
  const types=Array.isArray(p.types)&&p.types.length?p.types:(mon.types||[]);
  const rawStats=p.baseStats||p.stats||mon.baseStats||mon.stats||null;
  const statText=rawStats&&typeof rawStats==='object'?['hp','atk','def','spa','spd','spe'].filter(k=>Number.isFinite(Number(rawStats[k]))).map(k=>`${k.toUpperCase()} ${Number(rawStats[k])}`).join('  ·  '):'';
  const extra=[types.length?types.join(' / '):'',statText].filter(Boolean).join('  ·  ');
  const o=document.createElement('div');o.className='pr-reveal';o.style.setProperty('--h',hueOf(p.team));
  const statPills=rawStats&&typeof rawStats==='object'?['hp','atk','def','spa','spd','spe'].filter(k=>Number.isFinite(Number(rawStats[k]))).map(k=>`<span class="pr-stat">${k.toUpperCase()} ${Number(rawStats[k])}</span>`).join(''):'';
  const typeLine=types.length?types.join(' / '):'';
  o.innerHTML=`<div class="pr-wipe"></div><div class="pr-flare"></div><div class="pr-card"><div class="pr-art">${presentationHeroSprite(p.name)}</div><div class="pr-info"><div class="pr-pickno">Round ${round} · Pick ${p.pickNumber||d.picks.length}</div><div class="pr-picked-label">Team picked</div><div class="pr-mon">${prEsc(p.name)}</div>${SBL.pokemon.isMega?.(p.name)?'<div class="pr-badge">MEGA</div>':''}<div class="pr-pts">${Number(p.points??mon.points)||0} points</div><div class="pr-team">${prEsc(p.team)}</div>${typeLine?`<div class="pr-extra">${prEsc(typeLine)}</div>`:''}${statPills?`<div class="pr-stats">${statPills}</div>`:''}</div></div>`;
  document.body.appendChild(o);
  let done=false;
  const finish=()=>{if(done)return;done=true;document.removeEventListener('keydown',onKey);o.classList.add('out');setTimeout(()=>{o.remove();nextReveal()},revealQueue.length?120:450)};
  const onKey=e=>{if(e.key===' '||e.key==='Escape'||e.key==='Enter'){e.preventDefault();finish()}};
  document.addEventListener('keydown',onKey);o.addEventListener('click',finish);
  setTimeout(finish,revealQueue.length?2200:5200);
  /* Redraw the clock underneath while the colour wipe covers the screen. */
  setTimeout(()=>{if(done)return;revealing=false;try{renderPresent()}catch(_){}revealing=true},900);
}
if(PRESENT)document.addEventListener('keydown',e=>{
  if((e.key==='t'||e.key==='T')&&!revealing){const d=state.settings.draft;const m=d.pool.find(x=>!x.drafted)||{id:'demo',name:'Charizard',points:20};
    enqueueReveal({poolId:m.id,name:m.name,points:m.points,team:(d.order&&d.order[d.currentPick])||'Demo Franchise',pickNumber:d.picks.length+1})}
});

let lastDraftVersion='',lastCfg='',refreshInFlight=false,refreshQueued=false,renderQueued=false;
function scheduleRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;try{render()}catch(e){console.warn(e)}})}
/* Egress-safe sync: a few-byte version check decides whether the full season blob
   is downloaded at all. Picks arrive as realtime rows and are applied locally. */
async function pollDraft(){
  if(MOCK_DRAFT_MODE){
    if(refreshInFlight){refreshQueued=true;return;}
    refreshInFlight=true;
    try{const payload=mockSessionRead();if(!payload?.state)throw new Error('Mock session discarded');const updated=String(payload.updatedAt||'');if(updated!==MOCK_DRAFT_UPDATED_AT){const previousKeys=new Set((state.settings.draft?.picks||[]).map(pickEventKey));adopt(payload.state);MOCK_DRAFT_UPDATED_AT=updated;revealNewPicks(previousKeys);render();}}catch(e){console.warn('Mock draft refresh failed',e);}
    finally{refreshInFlight=false;if(refreshQueued){refreshQueued=false;pollDraft();}}
    return;
  }
  if(refreshInFlight){refreshQueued=true;return;}
  refreshInFlight=true;
  try{
    let v=null;
    try{v=await SBL.draft.version()}catch(e){console.warn('Draft version check failed',e)}
    if(v){
      const d=state.settings.draft;
      const stale=v.cfg!==lastCfg||v.status!==d.status||Number(v.pick_count)!==d.picks.length||Number(v.pool_count)!==d.pool.length;
      if(stale&&await refreshDraftRoom())lastCfg=v.cfg;
      return;
    }
    /* Legacy path (migration 021 not installed): one download, reused. */
    const remote=await SBL.draft.read();
    const previousKeys=new Set((state.settings.draft?.picks||[]).map(pickEventKey));
    const sig=draftVersion(remote);
    if(sig!==lastDraftVersion){adopt(remote);revealNewPicks(previousKeys);render();lastDraftVersion=sig}
  }catch(e){console.warn('Draft refresh failed',e)}
  finally{
    refreshInFlight=false;
    if(refreshQueued){refreshQueued=false;pollDraft();}
  }
}
function subscribeDraft(){
  if(MOCK_DRAFT_MODE)return ()=>{};
  try{
    return SBL.draft.subscribeLive({
      onPick:p=>{const key=pickEventKey(p),had=seenPickKeys.has(key)||state.settings.draft.picks.some(x=>pickEventKey(x)===key);state=SBL.draft.applyPickToState(state,p);state.settings.draft=normalise(state.settings.draft);if(PRESENT){if(!had&&presentationBaselineReady)enqueueReveal(p);else seenPickKeys.add(key)}else scheduleRender()},
      onRevert:p=>{state=SBL.draft.applyRevertToState(state,p);state.settings.draft=normalise(state.settings.draft);scheduleRender()},
      onCheck:()=>pollDraft(),
      onStatus:ok=>{if(ok)pollDraft()}
    },'draft-room-live');
  }catch(e){console.warn('Draft realtime subscription unavailable',e)}
}
boot().then(()=>{seedSeenPicks();subscribeDraft();pollDraft()});
setInterval(pollDraft,MOCK_DRAFT_MODE?700:15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(!MOCK_DRAFT_MODE)refreshIdentity();pollDraft()}});
window.addEventListener('focus',()=>{if(!MOCK_DRAFT_MODE)refreshIdentity();pollDraft()});
})();
