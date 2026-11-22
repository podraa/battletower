/* CP4.148: sandboxed active parser bridge. No uploaded source runs in the main page.
 * Cross-origin sandboxed iframe + restrictive CSP. No silent fallback when active parser fails.
 */
(function(){'use strict';
const S=window.SBL=window.SBL||{};S.replays=S.replays||{};
const verifiedHash=async source=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))).map(b=>b.toString(16).padStart(2,'0')).join('');
let current=null,initializing=null,loadEpoch=0;
const PARSER_CHANGE_KEY='sbl:active-parser-changed';
// Cached sandbox code is only a performance optimization, never a second authority.
// The administrator's activation invalidates this tab and broadcasts to other open tabs.
function invalidateActiveParser(){
 loadEpoch++;
 const stale=current;current=null;initializing=null;
 try{stale?.close?.();}catch(e){console.warn('Could not close stale parser sandbox:',e);}
}
window.addEventListener('storage',e=>{if(e.key===PARSER_CHANGE_KEY)invalidateActiveParser();});
const NO_PARSER='No uploaded replay parser is active';
function newSandbox(source){
 return new Promise((resolve,reject)=>{
  const token=crypto.randomUUID(),frame=document.createElement('iframe');
  frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('aria-hidden','true');frame.style.display='none';
  // The sandboxed document is an opaque origin; CSP forbids network, navigation, forms and nested frames.
  const boot=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'">`+
  `<script>window.SBL={replays:{}};let ready=false;addEventListener('message',e=>{if(e.source!==parent||!e.data||e.data.token!==${JSON.stringify(token)})return;let m=e.data;try{if(m.op==='init'){(0,eval)(m.source);if(typeof window.SBL?.replays?.parseLog!=='function')throw Error('Parser must register SBL.replays.parseLog');ready=true;parent.postMessage({token:m.token,id:m.id,ok:true},'*');return;}if(!ready)throw Error('Parser not initialized');if(m.op==='parse'){const result=window.SBL.replays.parseLog(m.json,m.replayId);parent.postMessage({token:m.token,id:m.id,ok:true,result},'*');}}catch(err){parent.postMessage({token:m.token,id:m.id,ok:false,error:String(err?.message||err)},'*');}});<\/script>`;
  // eval inside opaque-origin sandbox only. CSP 'unsafe-eval' must be explicit to permit loading the staged text.
  frame.srcdoc=boot.replace("script-src 'unsafe-inline'", "script-src 'unsafe-inline' 'unsafe-eval'");
  const inflight=new Map();let id=0,closed=false;
  const handler=e=>{if(e.source!==frame.contentWindow||e.origin!=='null'||e.data?.token!==token)return;
   let job=inflight.get(e.data.id);if(!job)return;inflight.delete(e.data.id);clearTimeout(job.timer);e.data.ok?job.resolve(e.data.result):job.reject(Error('Sandbox parser: '+e.data.error));};
  const close=()=>{if(closed)return;closed=true;window.removeEventListener('message',handler);for(const job of inflight.values()){clearTimeout(job.timer);job.reject(Error('Parser sandbox closed'));}inflight.clear();frame.remove();};
  const request=(op,payload={},timeout=15000)=>new Promise((res,rej)=>{if(closed)return rej(Error('Parser sandbox closed'));const n=++id;
   const timer=setTimeout(()=>{inflight.delete(n);close();rej(Error('Parser sandbox timed out'))},timeout);
   inflight.set(n,{resolve:res,reject:rej,timer});try{frame.contentWindow.postMessage({token,id:n,op,...payload},'*');}catch(err){clearTimeout(timer);inflight.delete(n);rej(err);}});
  window.addEventListener('message',handler);
  frame.addEventListener('load',()=>request('init',{source},15000).then(()=>resolve({parse:(json,replayId)=>request('parse',{json,replayId}),close})).catch(e=>{close();reject(e)}),{once:true});
  document.body.appendChild(frame);
 });
}
async function active(){
 if(current)return current;
 if(initializing)return initializing;
 const expectedEpoch=loadEpoch;
 const pending=(async()=>{
  const db=S.getSupabase?.();if(!db)throw Error('Supabase unavailable for active parser check');
  const {data,error}=await db.rpc('sbl_active_parser_source');
  if(error)throw Error('Active parser lookup failed: '+error.message+' (run migration 055)');
  const version=Array.isArray(data)?data[0]:null;
  if(!version)throw Error(NO_PARSER+'; ask a site administrator to upload and activate one in Admin Hub. Replay processing is blocked.');
  if(await verifiedHash(version.source_text)!==version.sha256)throw Error('Active parser checksum mismatch; parsing blocked');
  const runner=await newSandbox(version.source_text);
  // A new version can be activated while a previous RPC/iframe is loading.
  // Never let that delayed response overwrite the newly selected version.
  if(expectedEpoch!==loadEpoch){runner.close();throw Error('Active parser changed during initialization; retry the import.');}
  current={...runner,version:version.version_label,sha256:version.sha256};return current;
 })();
 initializing=pending;
 try{return await pending;}finally{if(initializing===pending)initializing=null;}
}
async function activeParserInfo(){const runner=await active();return {version:runner.version,sha256:runner.sha256};}
// Refresh once at the start of each import/reprocess batch: this catches parser
// changes made from other devices, not only this tab or a browser storage event.
async function refreshActiveParser(){invalidateActiveParser();return activeParserInfo();}
function isReplayCurrent(replay,info){
 const saved=String(replay?.parserSourceSha256||'').toLowerCase();
 return !!saved && saved===String(info?.sha256||'').toLowerCase();
}
async function parseLogActive(json,id){const runner=await active();const result=await runner.parse(json,id);
 if(!result||!result.mons||!result.players||!result.luck)throw Error('Active parser returned an invalid replay record');
 result.parserVersionLabel=runner.version;result.parserSourceSha256=runner.sha256;return result;}
S.replays.parseLogActive=parseLogActive;
S.replays.activeParserVersion=async()=> (await active()).version;
S.replays.activeParserInfo=activeParserInfo;
S.replays.refreshActiveParser=refreshActiveParser;
S.replays.invalidateActiveParser=invalidateActiveParser;
S.replays.isReplayCurrent=isReplayCurrent;
S.replays.parserChangeStorageKey=PARSER_CHANGE_KEY;
S.replays.validateStagedParser=async(source)=>{const runner=await newSandbox(source);try{
 const makeSample=lines=>({formatid:'gen9nationaldex',log:lines.join('\n')});
 const samples=[
  makeSample(['|player|p1|Alpha','|player|p2|Beta','|poke|p1|Pikachu','|poke|p2|Eevee','|switch|p1a: Pika|Pikachu|100/100','|switch|p2a: Eev|Eevee|100/100','|turn|1','|move|p1a: Pika|Tackle|p2a: Eev','|-damage|p2a: Eev|50/100','|turn|2','|win|Alpha']),
  makeSample(['|player|p1|Alpha','|player|p2|Beta','|poke|p1|Ditto','|poke|p2|Gengar','|switch|p1a: Copy|Ditto|100/100','|switch|p2a: Ghost|Gengar|100/100','|turn|1','|-transform|p1a: Copy|p2a: Ghost','|detailschange|p1a: Copy|Gengar, L50','|move|p1a: Copy|Tackle|p2a: Ghost','|-damage|p2a: Ghost|80/100','|win|Alpha']),
  makeSample(['|player|p1|Alpha','|player|p2|Beta','|poke|p1|Zoroark','|poke|p1|Gengar','|poke|p2|Pikachu','|switch|p1a: Trickster|Gengar, L50|100/100','|switch|p2a: Pika|Pikachu, L50|100/100','|turn|1','|move|p1a: Trickster|Tackle|p2a: Pika','|-damage|p2a: Pika|80/100','|replace|p1a: Trickster|Zoroark, L50|100/100','|move|p1a: Trickster|Tackle|p2a: Pika','|win|Alpha']),
  makeSample(['|player|p1|Alpha','|player|p2|Beta','|poke|p1|Charizard','|poke|p2|Pikachu','|switch|p1a: Blaze|Charizard, L50|100/100','|switch|p2a: Pika|Pikachu, L50|100/100','|turn|1','|move|p1a: Blaze|Tackle|p2a: Pika','|-formechange|p1a: Blaze|Charizard-Mega-X','|move|p1a: Blaze|Tackle|p2a: Pika','|win|Alpha']),
  makeSample(['|player|p1|Alpha','|player|p2|Beta','|poke|p1|Kyogre','|poke|p2|Pikachu','|switch|p1a: Sea|Kyogre|100/100','|switch|p2a: Pika|Pikachu|100/100','|turn|1','|-primal|p1a: Sea','|win|Alpha']),
  makeSample(['|player|p1|Alpha','|player|p2|Beta','|poke|p1|Lucario','|poke|p2|Pikachu','|switch|p1a: Aura|Lucario|100/100','|switch|p2a: Pika|Pikachu|100/100','|turn|1','|-mega|p1a: Aura|Lucarionite Z','|win|Alpha']),
  makeSample(['|player|p1|Alpha','|player|p2|Beta','|poke|p1|Zoroark','|poke|p1|Landorus-Therian','|poke|p2|Pikachu','|switch|p1a: Landorus-Therian|Landorus-Therian|100/100','|switch|p2a: Pika|Pikachu|100/100','|turn|1','|move|p1a: Landorus-Therian|Tackle|p2a: Pika','|replace|p1a: Zoroark|Zoroark|60/100','|faint|p1a: Zoroark','|turn|2','|switch|p1a: Landorus-Therian|Landorus-Therian|100/100','|move|p1a: Landorus-Therian|Earthquake|p2a: Pika','|faint|p1a: Landorus-Therian','|win|Beta']),
  makeSample(['|player|p1|Alpha','|player|p2|Beta','|poke|p1|Ditto','|poke|p2|Kyogre','|switch|p1a: Ditto|Ditto|100/100','|switch|p2a: K|Kyogre|100/100','|turn|1','|-transform|p1a: Ditto|p2a: K','|-primal|p1a: Ditto','|move|p1a: Ditto|Water Spout|p2a: K','|win|Alpha'])
 ];
 for(let i=0;i<samples.length;i++){
  const result=await runner.parse(samples[i],'activation-test-'+i);
  if(!result?.mons||!result?.players||!result?.luck||!result?.winner)throw Error('Fixture '+(i+1)+' returned incomplete data');
  const mons=result.mons;
  if(i===1 && (!mons['p1|ditto'] || mons['p1|gengar'] || Number(mons['p1|ditto'].moves?.Tackle||0)!==1))
   throw Error('Transform ownership regression: copied species credited instead of Ditto');
  if(i===2 && (Number(mons['p1|zoroark']?.moves?.Tackle||0)!==2 || Number(mons['p1|gengar']?.moves?.Tackle||0)!==0 || Number(mons['p1|zoroark']?.appearances||0)!==1))
   throw Error('Illusion attribution regression: disguised actions or appearances credited incorrectly');
  if(i===3 && (!mons['p1|charizard mega x'] || mons['p1|charizard'] || Number(mons['p1|charizard mega x'].moves?.Tackle||0)!==2))
   throw Error('Mega evolution regression: base and Mega counted separately');
  if(i===4 && (!mons['p1|kyogre primal'] || mons['p1|kyogre']))
   throw Error('Primal regression: both Kyogre and Primal Kyogre were credited');
  if(i===5 && (!mons['p1|lucario mega z'] || mons['p1|lucario mega'] || mons['p1|lucario']))
   throw Error('Z Mega regression: Z Mega was merged into normal Mega or base');
  if(i===6 && (Number(mons['p1|zoroark']?.deaths||0)!==1 || Number(mons['p1|landorus therian']?.deaths||0)!==1 || Number(mons['p1|zoroark']?.moves?.Tackle||0)!==1 || Number(mons['p1|landorus therian']?.moves?.Earthquake||0)!==1))
   throw Error('Illusion physical identity regression: Landorus deaths or moves merged with Zoroark');
  if(i===7 && (Number(mons['p1|ditto']?.moves?.['Water Spout']||0)!==1 || mons['p1|kyogre primal']))
   throw Error('Transform/Imposter regression: copied Primal form stole Ditto statistics');
 }
 return {count:samples.length};
 }finally{runner.close();}};
})();
