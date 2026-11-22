/* CP4.148: sandboxed active parser bridge. No uploaded source runs in the main page.
 * Cross-origin sandboxed iframe + restrictive CSP. No silent fallback when active parser fails.
 */
(function(){'use strict';
const S=window.SBL=window.SBL||{};S.replays=S.replays||{};
const verifiedHash=async source=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))).map(b=>b.toString(16).padStart(2,'0')).join('');
let current=null,initializing=null;
const BARE='Built-in website parser';
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
async function active(){if(current)return current;if(initializing)return initializing;
 initializing=(async()=>{const db=S.getSupabase?.();if(!db)throw Error('Supabase unavailable for active parser check');
  const {data,error}=await db.rpc('sbl_active_parser_source');
  if(error)throw Error('Active parser lookup failed: '+error.message+' (run migration 055)');
  const version=Array.isArray(data)?data[0]:null;
  if(!version){current={version:BARE,parse:(json,id)=>S.replays.parseLog(json,id),close:()=>{}};return current;}
  if(await verifiedHash(version.source_text)!==version.sha256)throw Error('Active parser checksum mismatch; parsing blocked');
  const runner=await newSandbox(version.source_text);current={...runner,version:version.version_label};return current;
 })();try{return await initializing;}finally{initializing=null;}}
async function parseLogActive(json,id){const runner=await active();const result=await runner.parse(json,id);
 if(!result||!result.mons||!result.players||!result.luck)throw Error('Active parser returned an invalid replay record');return result;}
S.replays.parseLogActive=parseLogActive;
S.replays.activeParserVersion=async()=> (await active()).version;
S.replays.validateStagedParser=async(source)=>{const runner=await newSandbox(source);try{
 const samples=[{formatid:'gen9natdexdraft',log:['|player|p1|Alpha','|player|p2|Beta','|poke|p1|Pikachu','|poke|p2|Eevee','|switch|p1a: Pika|Pikachu|100/100','|switch|p2a: Eev|Eevee|100/100','|turn|1','|move|p1a: Pika|Tackle|p2a: Eev','|-damage|p2a: Eev|50/100','|turn|2','|win|Alpha'].join('\n')},
 {formatid:'gen9natdexdraft',log:['|player|p1|Alpha','|player|p2|Beta','|poke|p1|Ditto','|poke|p2|Gengar','|switch|p1a: Copy|Ditto|100/100','|switch|p2a: Ghost|Gengar|100/100','|turn|1','|-transform|p1a: Copy|p2a: Ghost','|move|p1a: Copy|Tackle|p2a: Ghost','|-damage|p2a: Ghost|80/100','|win|Alpha'].join('\n')}];
 for(let i=0;i<samples.length;i++){const result=await runner.parse(samples[i],'activation-test-'+i);
  if(!result?.mons||!result?.players||!result?.luck||!result?.winner)throw Error('Fixture '+(i+1)+' returned incomplete data');
  if(i===1&&!result.mons['p1|ditto'])throw Error('Transform ownership regression');}
 return {count:samples.length};
 }finally{runner.close();}};
})();
