(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params=new URLSearchParams(location.search);
const league=params.get('league')||'',season=params.get('season_id')||'';
let replay=null,index=0;
const db=()=>SBL.getSupabase();
function error(message){$('trackerError').hidden=!message;$('trackerError').textContent=message||'';}
function pokemon(id){return replay?.names?.get(String(id||''))||String(id||'N/A');}
function art(id){
 if(!id)return '';
 const name=pokemon(id);
 try {return window.SBL?.pokemon?.spriteMarkup?.(name,'tracker-mon-art')||'';}catch(_){return '';}
}
function coachName(c){return c.franchise||'Unassigned coach';}
function victims(e){return (e.coaches||[]).filter(c=>c.sniped===true||c.sniped==='true');}
function filteredIndices(events){return events.map((e,i)=>({e,i})).filter(({e})=>!$('trackerOnlySnipes').checked||victims(e).length>0).map(x=>x.i);}
function currentFilterIndex(events,indices){
 if(!indices.length)return -1;
 return indices.includes(index)?index:indices.find(i=>i>=index)??indices[indices.length-1];
}
function totals(events){
 const counts=new Map();let snipes=0, impacted=0;
 events.forEach(e=>{const hit=victims(e);if(hit.length)impacted++;snipes+=hit.length;hit.forEach(c=>counts.set(coachName(c),(counts.get(coachName(c))||0)+1));});
 const ranked=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
 return {snipes,impacted,ranked};
}
function paint(){
 const events=replay?.events||[];
 const indices=filteredIndices(events);
 const picked=currentFilterIndex(events,indices);
 if(picked>=0)index=picked;
 const event=picked>=0?events[index]:null;
 $('trackerContent').hidden=!(replay&&events.length);
 $('trackerContext').textContent=replay?`${events.length} recorded picks · ${replay.published?'Published':'Unpublished preview (admins only)'}`:'Loading…';
 $('trackerPublish').hidden=!replay?.can_publish;
 $('trackerPublish').textContent=replay?.published?'Unpublish replay':'Publish replay';
 if(!events.length)return;
 const t=totals(events);
 $('trackerTotals').innerHTML=`<div><strong>${events.length}</strong><span>Recorded picks</span></div><div><strong>${t.snipes}</strong><span>Top-choice snipes</span></div><div><strong>${t.impacted}</strong><span>Picks causing snipes</span></div>${t.ranked.length?`<div class="tracker-top-victim"><strong>${esc(t.ranked[0][0])}</strong><span>Most affected · ${t.ranked[0][1]} snipes</span></div>`:''}`;
 $('trackerPrev').disabled=indices.findIndex(i=>i===index)<=0;
 $('trackerNext').disabled=indices.findIndex(i=>i===index)===indices.length-1;
 const sel=$('trackerPick');
 sel.innerHTML=indices.map(i=>`<option value="${i}">#${esc(events[i].pick_number)} · ${esc(events[i].picked_mon_name)} (${victims(events[i]).length} snipes)</option>`).join('');
 if(!event){
  $('trackerSummary').innerHTML='<strong>No picks caused a recorded top-choice snipe.</strong><p>Turn off the filter to review every pick.</p>';
  $('trackerVictims').innerHTML='<p class="tracker-empty">No matching picks.</p>';
  $('trackerCoaches').innerHTML='';$('trackerCoachCount').textContent='';return;
 }
 sel.value=String(index);
 const hit=victims(event),pickedMon=String(event.picked_mon_name||pokemon(event.picked_pool_id));
 $('trackerSummary').innerHTML=`<div class="tracker-selected-art">${art(event.picked_pool_id)||''}</div><div class="tracker-selected-copy"><span class="tracker-eyebrow">Pick #${esc(event.pick_number)}</span><h2>${esc(event.picking_team||'Unknown coach')} drafted ${esc(pickedMon)}</h2><p>${hit.length?`That Pokémon was the highest available priority for ${hit.length} other ${hit.length===1?'coach':'coaches'}.`:'No other coach had this Pokémon as their highest available queued choice at that moment.'}</p></div><div class="tracker-snipe-count ${hit.length?'has-snipes':''}"><strong>${hit.length}</strong><span>${hit.length===1?'snipe':'snipes'}</span></div>`;
 $('trackerImpactTitle').textContent=hit.length?`Affected coaches (${hit.length})`:'Affected coaches';
 $('trackerVictims').classList.toggle('tracker-victims-grid',hit.length>0);
 $('trackerVictims').innerHTML=hit.length?hit.map(c=>`<article class="tracker-victim"><div class="tracker-victim-head"><span class="tracker-target" aria-hidden="true"></span><div><strong>${esc(coachName(c))}</strong><span>Lost their top available queued choice</span></div></div><div class="tracker-change"><div class="tracker-change-mon"><small>Wanted before this pick</small><div>${art(c.expected_current)}<strong>${esc(pokemon(c.expected_current))}</strong></div></div><span class="tracker-change-arrow" aria-label="became">→</span><div class="tracker-change-mon"><small>New top available choice</small><div>${art(c.expected_after)}<strong>${esc(pokemon(c.expected_after))}</strong></div></div></div>${!c.expected_after?'<p class="tracker-muted">No remaining available Pokémon in their saved queue.</p>':''}</article>`).join(''):'<div class="tracker-empty"><strong>No recorded snipes on this pick.</strong><p>A snipe is counted only when another coach loses their highest-priority <em>available</em> Pokémon. Someone having the Pokémon further down their list does not count.</p></div>';
 const coaches=event.coaches||[];
 $('trackerCoachCount').textContent=`(${coaches.length} saved ${coaches.length===1?'queue':'queues'})`;
 $('trackerCoaches').innerHTML=coaches.map(c=>`<article class="tracker-coach ${c.sniped?'is-sniped':''}"><h3>${esc(coachName(c))}</h3>${c.sniped?'<span class="tracker-sniped">SNIPED ON THIS PICK</span>':''}<div class="tracker-pick"><small>Highest available before</small><strong>${esc(pokemon(c.expected_current))}</strong></div><div class="tracker-pick-meta"><small>Literal next queued</small><span>${esc(pokemon(c.expected_next))}</span></div><div class="tracker-pick-meta"><small>Next available before</small><span>${esc(pokemon(c.expected_next_free))}</span></div><div class="tracker-pick-meta"><small>Highest available after</small><span>${esc(pokemon(c.expected_after))}</span></div></article>`).join('');
}
async function load(){
 error('');$('trackerContent').hidden=true;$('trackerContext').textContent='Loading post-draft replay…';
 if(!SBL.leagueDb?.isUuid?.(league)||!SBL.leagueDb?.isUuid?.(season)){error('Open the replay with a valid league and season.');return;}
 const session=await db().auth.getSession();
 if(!session.data?.session){error('Sign in to view the replay.');return;}
 const {data,error:rpcError}=await db().rpc('sbl_draft_tracker_replay',{p_league_id:league,p_season_id:season});
 if(rpcError){error(rpcError.message||'Replay unavailable.');$('trackerContext').textContent='Replay unavailable';return;}
 replay=data||{};replay.names=new Map((replay.pool||[]).map(m=>[String(m.id),String(m.name||m.id)]));
 index=Math.min(index,Math.max(0,(replay.events||[]).length-1));
 paint();if(!replay.events?.length)$('trackerContext').textContent='No active recorded picks exist for this completed draft.';
}
function navigate(delta){const arr=filteredIndices(replay?.events||[]);const at=arr.indexOf(index);if(at<0)return;const next=arr[at+delta];if(next!==undefined){index=next;paint();}}
$('trackerReload').addEventListener('click',load);
$('trackerPrev').addEventListener('click',()=>navigate(-1));
$('trackerNext').addEventListener('click',()=>navigate(1));
$('trackerPick').addEventListener('change',e=>{index=Number(e.target.value)||0;paint();});
$('trackerOnlySnipes').addEventListener('change',()=>{index=0;paint();});
$('trackerPublish').addEventListener('click',async()=>{
 if(!replay?.can_publish)return;
 const publish=!replay.published;
 if(!confirm(publish?'Publish this historical replay to this league’s members? Raw personal queues remain private.':'Unpublish this replay?'))return;
 $('trackerPublish').disabled=true;
 try{const {error:rpcError}=await db().rpc('sbl_draft_tracker_set_publication',{p_league_id:league,p_season_id:season,p_publish:publish});if(rpcError)throw rpcError;await load();}
 catch(e){error(e?.message||'Could not change publication.');}
 finally{$('trackerPublish').disabled=false;}
});
load().catch(e=>error(e?.message||String(e)));
})();
