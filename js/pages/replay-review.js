(function(){'use strict';const S=window.SBL=window.SBL||{};let nonce=0;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function render(host){const call=++nonce,league=S.leagueDb?.selectedLeagueId?.();if(!league){host.textContent='Select a league to review replay events.';return;}
 host.innerHTML=`<div class="review-workspace">
 <header class="review-topline"><div><div class="review-kicker">DIAGNOSTICS / REPLAY REVIEW</div><h2>Historical replay library</h2><p>Bring in older battles, inspect uncertain events, and record league-admin decisions.</p></div><span class="review-isolation">Review-only · Current season protected</span></header>
 <section class="review-upload panel"><div class="review-section-title"><div><h3>Add historical battles</h3><p>Upload a replay, import a CSV, or paste Showdown links. None of these add season statistics.</p></div></div>
 <div class="review-import-grid"><div class="review-input-group"><label for="reviewFiles">Upload files</label><input type="file" id="reviewFiles" multiple accept=".log,.txt,.json,.csv"><small>Showdown .log/.txt, parser report .json, or CSV containing URLs or replay logs.</small></div>
 <div class="review-input-group"><label for="reviewLinks">Or paste replay links</label><textarea id="reviewLinks" rows="3" placeholder="https://replay.pokemonshowdown.com/gen9natdexdraft-1234567890&#10;One link per line"></textarea><small>Replay links only. Other websites cannot be fetched.</small></div></div>
 <div class="review-actions"><button type="button" id="reviewImport" class="primary">Import for review only</button><span id="reviewStatus" role="status" aria-live="polite"></span></div></section>
 <section class="review-queue-panel panel"><div class="review-section-title"><div><h3>Event review queue</h3><p>League-admin verdicts stay local to this league. Site-admin overrides take precedence.</p></div><button type="button" id="reviewReload" class="ghost">Refresh queue</button><button type="button" id="reviewBackfillCrits" class="ghost">Find missing critical hits</button></div><div id="reviewQueue">Loading…</div></section></div>`;
 const status=host.querySelector('#reviewStatus'),queue=host.querySelector('#reviewQueue');
 const load=async()=>{try{queue.textContent='Loading review events…';const r=S.replayReview;const [imports,events,decisions,rules]=await Promise.all([r.imports(league),r.events(league),r.decisions(league),r.rules(league)]);if(call!==nonce)return;
 const byImport=new Map(imports.map(x=>[x.id,x.replay_id]));const byEvent=events.map(e=>({...e,league_id:league}));
 if(!events.length){queue.textContent='No review events yet. Import older replays above to start building evidence.';return;}
 queue.innerHTML=`<div class="review-queue-summary"><span>${imports.length} historical replays</span><span>${events.length} review events (${events.filter(e=>e.event_type==='crit').length} crits, ${events.filter(e=>e.event_type==='miss').length} misses)</span><span>Showing newest 1,000</span></div>`+byEvent.map(e=>{
 const own=r.effective(decisions.filter(d=>d.event_id===e.id));const hint=r.suggest(e,byEvent,decisions,rules);
 return `<article class="review-event-card" data-review-event="${esc(e.id)}"><strong>${esc(e.evidence?.target||'Target')} ${e.event_type==='crit'?'took a critical hit from':'avoided'} ${esc(e.evidence?.move||'attack')}</strong> · Turn ${e.turn_number} · ${esc(byImport.get(e.import_id)||'replay')}<p>${esc(e.evidence?.explanation||'')}</p><p>Target HP: ${(e.evidence?.targetHpBeforeMiss??e.evidence?.targetHpBeforeEvent)==null?'Unknown':esc(e.evidence.targetHpBeforeMiss??e.evidence.targetHpBeforeEvent)+'%'} · Parser: ${esc(e.parser_assessment)}</p><p><strong>Manual verdict:</strong> ${own?esc(own.decision)+' ('+esc(own.authority)+') - '+esc(own.reason):'Pending review'}${hint?'<br><strong>Non-binding suggestion:</strong> '+esc(hint.choice)+' - '+esc(hint.reason):''}</p><div class="review-view-actions"><button type="button" data-view-turn>View turn</button><button type="button" data-open-calc>Damage calculator</button></div><div class="review-event-actions"><select data-choice><option value="uncertain">Cannot determine</option><option value="minor">Minor impact</option><option value="significant">Significant impact</option></select><input data-reason placeholder="Reason (minimum 5 characters)" aria-label="Review rationale"><button data-decide>Save this decision</button><button data-rule>Create similar-event rule</button></div><p data-notice role="status"></p></article>`;
 }).join('');
 queue.querySelectorAll('[data-review-event]').forEach(card=>{
 const event=byEvent.find(x=>x.id===card.dataset.reviewEvent);
 card.querySelector('[data-open-calc]').onclick=()=>window.open('https://calc.pokemonshowdown.com/','_blank','noopener,noreferrer');
 card.querySelector('[data-view-turn]').onclick=async()=>{
  const notice=card.querySelector('[data-notice]');notice.textContent='Loading turn evidence…';
  try{const replay=await r.replayLogForImport(league,event.import_id);const url=r.replayPage(replay.replay_id);
   const overlay=document.createElement('div');overlay.className='review-turn-backdrop';
   const dialog=document.createElement('section');dialog.className='review-turn-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Replay turn evidence');
   const heading=document.createElement('h3');heading.textContent='Turn '+event.turn_number+' · '+(event.evidence?.move||event.event_type);
   const hint=document.createElement('p');hint.textContent='These are the events recorded by Showdown during this turn. The replay player may need to be advanced manually to the indicated turn.';
   const pre=document.createElement('pre');pre.textContent=r.turnExcerpt(replay.raw_log,event.turn_number);
   const actions=document.createElement('div');actions.className='review-turn-actions';
   if(url){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Watch Showdown replay';actions.append(link);}
   const calc=document.createElement('a');calc.href='https://calc.pokemonshowdown.com/';calc.target='_blank';calc.rel='noopener noreferrer';calc.textContent='Open damage calculator';actions.append(calc);
   const close=document.createElement('button');close.type='button';close.textContent='Close';actions.append(close);
   dialog.append(heading,hint,pre,actions);overlay.append(dialog);document.body.append(overlay);
   const dismiss=()=>{document.removeEventListener('keydown',escapeHandler);overlay.remove();};
   const escapeHandler=ev=>{if(ev.key==='Escape')dismiss();};
   close.onclick=dismiss;overlay.onclick=ev=>{if(ev.target===overlay)dismiss();};document.addEventListener('keydown',escapeHandler);close.focus();notice.textContent='';
  }catch(err){notice.textContent='Could not load turn: '+err.message;}
 };
 const get=()=>({id:card.dataset.reviewEvent,choice:card.querySelector('[data-choice]').value,reason:card.querySelector('[data-reason]').value.trim()});
 card.querySelector('[data-decide]').onclick=async()=>{let v=get();try{await r.decide(v.id,v.choice,v.reason);await load();}catch(err){card.querySelector('[data-notice]').textContent=err.message;}};
 card.querySelector('[data-rule]').onclick=async()=>{let v=get();let e=byEvent.find(x=>x.id===v.id);if(!confirm('Save this exact evidence pattern as a league-only suggestion? It does not alter live parser logic.'))return;try{await r.saveRule(league,e.fingerprint,v.choice,v.reason);await load();}catch(err){card.querySelector('[data-notice]').textContent=err.message;}};
 });
 }catch(e){queue.textContent='Review queue unavailable: '+e.message+' (run SQL migration 053 if not installed).';}};
 host.querySelector('#reviewBackfillCrits').onclick=async()=>{
  const btn=host.querySelector('#reviewBackfillCrits');btn.disabled=true;status.textContent='Checking existing historical replays for missing critical-hit reviews…';
  try{const result=await S.replayReview.backfillCrits(league,progress=>{status.textContent=`Checked ${progress.scanned} replays · added ${progress.created} critical-hit reviews…`;});
   status.textContent=`Checked ${result.scanned} historical replays; added ${result.created} missing critical-hit reviews. ${result.errors.length?result.errors.slice(0,3).join(' · '):'Existing decisions and active season unchanged.'}`;
   await load();
  }catch(err){status.textContent='Could not backfill critical-hit reviews: '+err.message+' (run migration 056)';}
  finally{btn.disabled=false;}
 };
 host.querySelector('#reviewReload').onclick=load;
 host.querySelector('#reviewImport').onclick=async()=>{
 const files=[...host.querySelector('#reviewFiles').files],links=host.querySelector('#reviewLinks').value;
 if(!files.length&&!links.trim()){status.textContent='Choose files or paste one or more Showdown replay links.';return;}
 const btn=host.querySelector('#reviewImport');btn.disabled=true;let done=0,errors=[],skipped=0;const r=S.replayReview;
 const importOne=async(entry)=>{try{let resolved=entry.url?await r.fetchReplay(entry.url):entry;
   if(!resolved.log){skipped++;return;}
   let id=resolved.id;if(!id||/^csv-row-/.test(id))id='historical-'+String(Date.now())+'-'+String(done+skipped+errors.length);
   let result=await r.importLog(league,id,resolved.log);done++;
   status.textContent=`Imported ${done} replays · ${result.count} events in latest replay…`;
  }catch(e){errors.push((entry.id||entry.url||'Replay')+': '+e.message);}};
 try{
  for(const file of files){let entries=[];
   try{let body=await file.text(),lower=file.name.toLowerCase();
    if(lower.endsWith('.csv'))entries=r.csvEntries(body);
    else if(lower.endsWith('.json')){let obj=JSON.parse(body);
     if(Array.isArray(obj.results))entries=obj.results.filter(x=>typeof x.replayLog==='string').map(x=>({id:String(x.id||x.name||'').slice(0,180),log:x.replayLog}));
     else if(typeof (obj.replayLog||obj.log)==='string')entries=[{id:String(obj.id||file.name).slice(0,180),log:obj.replayLog||obj.log}];
     else throw Error('JSON contains no replay logs');
    }else entries=[{id:file.name.replace(/\.(log|txt)$/i,'').slice(0,180),log:body}];
    for(const entry of entries)await importOne(entry);
   }catch(e){errors.push(file.name+': '+e.message);}
  }
  for(const entry of r.pastedLinks(links))await importOne(entry);
 }catch(e){errors.push(e.message);}
 finally{btn.disabled=false;status.textContent=`${done} imported for review only${skipped?', '+skipped+' skipped':''}. ${errors.length?errors.slice(0,5).join(' · ')+(errors.length>5?' (and '+(errors.length-5)+' more)':''):'Current season unchanged.'}`;await load();}
 };
 await load();}
 S.replayReviewUI={render};
})();
