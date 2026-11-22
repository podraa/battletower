(function(){'use strict';
 const S=window.SBL=window.SBL||{},db=()=>S.getSupabase(),ok=r=>{if(r.error)throw r.error;return r.data;};
 function normalize(text){let s=String(text||'');if(s.trim().startsWith('{')){let j=JSON.parse(s);s=j.log||j.replayLog||'';}if(!s.includes('|turn|')||!s.includes('|move|'))throw Error('This is not a Showdown replay log.');return s;}
 function extract(log){
  let turn=0,last=null,active={},hp={},events=[],missCount=0,critCount=0;
  const slot=x=>String(x||'').match(/^(p[12][a-f]):/)?.[1]||'';
  const pct=x=>{const m=String(x||'').match(/^(\d+)\/(\d+)/);return m&&+m[2]?Math.round(1000*(+m[1])/(+m[2]))/10:String(x||'').startsWith('0 fnt')?0:null;};
  const species=s=>active[s]?.species||s;
  for(const line of log.split(/\r?\n/)){
   const p=line.split('|'),op=p[1],s=slot(p[2]);
   if(op==='turn'){turn=+p[2]||turn;last=null;}
   if(['switch','drag','replace'].includes(op)&&s){active[s]={species:String(p[3]||'').split(',')[0],nickname:String(p[2]).split(': ').slice(1).join(': ')};const h=pct(p[4]);if(h!==null)hp[s]=h;}
   if(['-damage','-heal','-sethp'].includes(op)&&s){const h=pct(p[3]);if(h!==null)hp[s]=h;}
   if(op==='move'){
    last={turn,slot:s,target:slot(p[4]),name:String(p[3]||'Unknown')};
    for(const e of events)if(e.type==='miss'&&e.targetSlot===s&&e.nickname===active[s]?.nickname&&turn>=e.turn&&turn<=e.turn+1)e.acted=true;
   }
   if(op==='-miss'){
    const target=slot(p[3]);if(!target||!s||target.slice(0,2)===s.slice(0,2))continue;
    events.push({type:'miss',key:'miss-'+String(++missCount).padStart(4,'0'),turn,source:species(s),target:species(target),targetSlot:target,nickname:active[target]?.nickname||'',move:last?.slot===s&&last.target===target?last.name:'Unknown',hp:hp[target]??null,acted:false,ko:false});
   }
   if(op==='-crit'&&s){
    const attacker=last?.slot||'',sameTurn=last?.turn===turn;
    const source=sameTurn&&attacker?species(attacker):'Unknown';
    events.push({type:'crit',key:'crit-'+String(++critCount).padStart(4,'0'),turn,source,target:species(s),targetSlot:s,move:sameTurn?last.name:'Unknown',hp:hp[s]??null,after:null,ko:false});
   }
   if(op==='-damage'&&s){
    const crit=[...events].reverse().find(e=>e.type==='crit'&&e.turn===turn&&e.targetSlot===s&&e.after===null);
    if(crit){crit.after=hp[s]??null;crit.ko=crit.after===0;}
   }
   if(op==='faint'&&s&&last){
    for(const e of events){
     if(e.type==='miss'&&e.targetSlot===last.slot&&e.nickname===active[last.slot]?.nickname&&s!==e.targetSlot&&last.turn===turn&&turn>=e.turn&&turn<=e.turn+1)e.ko=true;
     if(e.type==='crit'&&e.targetSlot===s&&e.turn===turn)e.ko=true;
    }
   }
  }
  return events.map(e=>{
   const hpBand=e.hp===null?'unknown':e.hp<=25?'0-25':e.hp<=50?'26-50':e.hp<=75?'51-75':'76-100';
   if(e.type==='crit')return {event_key:e.key,event_type:'crit',turn_number:e.turn,
    fingerprint:`crit|${String(e.move).toLowerCase().replace(/[^a-z0-9]/g,'')}|${hpBand}|${e.ko?'ko':'survived'}`,
    parser_assessment:e.ko?'ko-necessity-unknown':'extra-damage-unknown',
    evidence:{attacker:e.source,target:e.target,move:e.move,targetHpBeforeEvent:e.hp,targetHpAfterCrit:e.after,criticalHitKo:e.ko,
     explanation:e.ko?'The critical hit knocked out the target. Whether a normal hit would also have knocked it out needs a damage calculation.':'The move scored a critical hit. The replay alone cannot establish how much the critical hit mattered.'}};
   const kind=e.hp!==null&&e.hp<=30&&e.ko?'possible-turning-point':e.acted?'continued-to-act':'unknown';
   return {event_key:e.key,event_type:'miss',turn_number:e.turn,
    fingerprint:`miss|${String(e.move).toLowerCase().replace(/[^a-z0-9]/g,'')}|${hpBand}|${e.acted?'acted':'no-action'}|${e.ko?'ko':'no-ko'}`,
    parser_assessment:kind,evidence:{attacker:e.source,target:e.target,move:e.move,targetHpBeforeMiss:e.hp,targetActedAfterMiss:e.acted,targetScoredKoAfterMiss:e.ko,
     explanation:'The attack missed. The observed follow-up is recorded, but whether the hit would have caused a KO requires a damage calculation. Multi-hit moves need separate hit-probability checks.'}};
  });
 }
 function turnExcerpt(log,turn){
  const lines=normalize(log).split(/\r?\n/),target=Number(turn);
  let current=0,matched=[];
  for(const line of lines){if(line.startsWith('|turn|'))current=Number(line.split('|')[2])||current;
   if(current===target&&line&&/^\|(turn|switch|drag|replace|move|\-crit|\-miss|\-damage|\-heal|\-status|\-curestatus|faint|cant|\-boost|\-unboost|\-weather|\-fieldstart|\-fieldend)\|/.test(line))matched.push(line);
  }
  return matched.slice(0,120).join('\n')||'No turn events were found in this replay log.';
 }
 async function replayLogForImport(league,importId){
  return ok(await db().from('replay_review_imports').select('replay_id,raw_log').eq('league_id',league).eq('id',importId).single());
 }
 function replayPage(id){const v=String(id||'').trim().replace(/\.(log|json)$/i,'');
  return /^[a-z0-9][a-z0-9-]{2,179}$/i.test(v)?'https://replay.pokemonshowdown.com/'+v:null;
 }
 // Import adapters: accept Showdown URLs only, never arbitrary external URLs.
 function replayLink(raw){let u;try{u=new URL(String(raw||'').trim());}catch{return null;}
  if(u.protocol!=='https:'||!['replay.pokemonshowdown.com','pokemonshowdown.com','www.pokemonshowdown.com'].includes(u.hostname)||u.port||u.username||u.password)return null;
  let id=u.pathname.replace(/^\/+|\/+$/g,'').replace(/\.(log|json)$/i,'');
  if(!/^[a-z0-9][a-z0-9-]{2,179}$/i.test(id))return null;
  return {id,url:'https://replay.pokemonshowdown.com/'+id+'.log'};
 }
 async function fetchReplay(raw){const link=replayLink(raw);if(!link)throw Error('Only https://replay.pokemonshowdown.com/<replay-id> links are allowed.');
  let controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch(link.url,{signal:controller.signal,redirect:'error',credentials:'omit'});
   if(!response.ok)throw Error('Showdown returned HTTP '+response.status);
   const txt=await response.text();if(txt.length>5000000)throw Error('Replay exceeds 5 MB');
   return {id:link.id,log:normalize(txt)};
  }catch(e){if(e.name==='AbortError')throw Error('Showdown request timed out');throw Error('Could not retrieve '+link.id+' ('+e.message+'). If the browser blocks cross-site requests, download its .log file and upload that instead.');}
  finally{clearTimeout(timeout);}
 }
 // RFC 4180-style CSV reader: supports quoted commas, multiline quoted logs and escaped quotes.
 function csvRows(text){const rows=[];let row=[],cell='',quoted=false;
  text=String(text||'').replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){let c=text[i];if(c==='"'){
    if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;
   }else if(c===','&&!quoted){row.push(cell);cell='';}
   else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}
   else cell+=c;
  }if(quoted)throw Error('CSV contains an unclosed quoted field');
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
 }
 function csvEntries(text){const rows=csvRows(text);if(!rows.length)return [];
  const headers=rows[0].map(x=>x.trim().toLowerCase().replace(/[\s_-]/g,''));
  const find=(...names)=>headers.findIndex(h=>names.includes(h));
  const urlIdx=find('url','link','replayurl','replaylink','showdownurl','replay');
  const logIdx=find('log','replaylog','rawlog','battlelog');
  const idIdx=find('id','replayid','battleid');
  if(urlIdx<0&&logIdx<0)throw Error('CSV needs a link/url or log/replayLog column.');
  if(rows.length>1001)throw Error('CSV import is limited to 1,000 replay rows at a time.');
  return rows.slice(1).map((cells,i)=>{let url=urlIdx<0?'':String(cells[urlIdx]||'').trim(),log=logIdx<0?'':String(cells[logIdx]||'').trim();
    let id=(idIdx<0?'':String(cells[idIdx]||'').trim())||('csv-row-'+(i+2));
    if(url)return {url,id};if(log)return {log,id};return null;
   }).filter(Boolean);
 }
 function pastedLinks(text){const lines=String(text||'').split(/[\n\r\s,;]+/).map(x=>x.trim()).filter(Boolean);
  if(lines.length>250)throw Error('Paste at most 250 links at a time.');return lines.map(url=>({url}));
 }
 async function imports(league){return ok(await db().from('replay_review_imports').select('id,replay_id,created_at').eq('league_id',league).order('created_at',{ascending:false}).limit(200));}
 async function events(league){return ok(await db().from('replay_review_events').select('*').eq('league_id',league).order('created_at',{ascending:false}).limit(1000));}
 async function decisions(league){return ok(await db().from('replay_review_decisions').select('event_id,decision,reason,authority,created_at,id').eq('league_id',league).order('id',{ascending:false}).limit(3000));}
 async function rules(league){return ok(await db().from('replay_review_rules').select('id,league_id,fingerprint,decision,rationale,enabled').or(`league_id.is.null,league_id.eq.${league}`).eq('enabled',true).limit(1000));}
 async function importLog(league,id,text){let log=normalize(text);if(log.length>5000000)throw Error('Replay too large (5MB limit).');let ev=extract(log);return ok(await db().rpc('sbl_review_import_historical',{p_league_id:league,p_replay_id:id,p_raw_log:log,p_events:ev}));}
 // Safe enrichment of older review imports: inserts only new crit events; reviewed rows are never overwritten.
 async function backfillCrits(league,notify){
  let scanned=0,created=0,errors=[];
  for(let offset=0;;offset+=50){
   const result=await db().from('replay_review_imports').select('id,replay_id,raw_log').eq('league_id',league).order('created_at',{ascending:true}).range(offset,offset+49);
   const batch=ok(result)||[];
   if(!batch.length)break;
   for(const replay of batch){
    try{const crits=extract(normalize(replay.raw_log)).filter(e=>e.event_type==='crit');
     if(crits.length){const out=ok(await db().rpc('sbl_review_backfill_crit_events',{p_league_id:league,p_import_id:replay.id,p_events:crits}));created+=Number(out||0);}
    }catch(err){errors.push(replay.replay_id+': '+err.message);}
    scanned++;if(typeof notify==='function')notify({scanned,created,errors:errors.length});
   }
   if(batch.length<50)break;
  }
  return {scanned,created,errors};
 }
 async function decide(id,choice,reason){return ok(await db().rpc('sbl_review_decide_event',{p_event_id:id,p_decision:choice,p_reason:reason}));}
 async function saveRule(league,pattern,choice,reason){return ok(await db().rpc('sbl_review_save_rule',{p_league_id:league,p_fingerprint:pattern,p_decision:choice,p_rationale:reason}));}
 function effective(list){let admin=list.filter(x=>x.authority==='site_admin');return (admin.length?admin:list).sort((a,b)=>b.id-a.id)[0]||null;}
 function suggest(ev,all,history,ruleList){let rule=ruleList.find(x=>x.league_id===null&&x.fingerprint===ev.fingerprint)||ruleList.find(x=>x.league_id===ev.league_id&&x.fingerprint===ev.fingerprint);if(rule)return {choice:rule.decision,reason:rule.league_id===null?'Approved global rule':'League rule'};
 let similar=all.filter(x=>x.fingerprint===ev.fingerprint&&x.id!==ev.id).map(x=>effective(history.filter(d=>d.event_id===x.id))).filter(Boolean);let counts={};for(let x of similar)counts[x.decision]=(counts[x.decision]||0)+1;let [choice,count]=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]||[];return count>=2&&count/similar.length>=.75?{choice,reason:`Suggested from ${count}/${similar.length} matching manual reviews`}:null;}
 S.replayReview={normalize,extract,backfillCrits,turnExcerpt,replayLogForImport,replayPage,imports,events,decisions,rules,importLog,decide,saveRule,effective,suggest,replayLink,fetchReplay,csvEntries,pastedLinks};
})();
