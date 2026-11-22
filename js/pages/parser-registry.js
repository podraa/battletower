/* CP4.148: site-admin parser registry with explicit sandbox validation and activation. */
(function(){'use strict';
const S=window.SBL=window.SBL||{},db=()=>S.getSupabase();
const status=document.getElementById('parserRegistryStatus');
const table=document.getElementById('parserRegistryTable');
const file=document.getElementById('parserSourceFile');
const label=document.getElementById('parserVersionLabel');
const stage=document.getElementById('stageParserVersion');
if(!status||!table||!stage)return;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash=async source=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const tell=x=>{status.textContent=x;};
async function getSource(id){const {data,error}=await db().from('replay_parser_versions').select('id,version_label,source_text,sha256').eq('id',id).single();if(error)throw error;
if(await hash(data.source_text)!==data.sha256)throw Error('Stored parser checksum mismatch');return data;}
async function testSource(source){if(typeof S.replays?.validateStagedParser!=='function')throw Error('Sandbox validation unavailable; reload the site');
return S.replays.validateStagedParser(source);}
function reason(action,version){const note=window.prompt(`${action} ${version}: enter a deployment reason (at least 5 characters).`);
if(note===null)return null;if(note.trim().length<5)throw Error('Deployment reason must be at least 5 characters');return note.trim();}
async function refresh(){const {data,error}=await db().from('replay_parser_versions').select('id,version_label,sha256,status,staged_at').order('staged_at',{ascending:false}).limit(100);
if(error){tell('Parser registry unavailable: '+error.message);return;}
const active=data.find(x=>x.status==='deployed');
table.innerHTML='<p><strong>Current parser:</strong> '+esc(active?.version_label||'Built-in website parser')+'</p>'+
'<div style="margin:0.5rem 0 1rem"><button type="button" class="site-admin-button" id="parserBuiltin" '+(!active?'disabled':'')+'>Restore built-in parser</button></div>'+
'<table><thead><tr><th>Version</th><th>Status</th><th>Checksum</th><th>Actions</th></tr></thead><tbody>'+
data.map(x=>`<tr><td>${esc(x.version_label)}</td><td>${esc(x.status)}</td><td><code>${esc(x.sha256.slice(0,16))}…</code></td><td><button type="button" class="site-admin-button" data-parser-test="${esc(x.id)}">Validate</button> ${x.status!=='deployed'?`<button type="button" class="site-admin-button primary" data-parser-activate="${esc(x.id)}">${x.status==='retired'?'Roll back to version':'Activate'}</button>`:'Active'}</td></tr>`).join('')+'</tbody></table>';
const builtin=table.querySelector('#parserBuiltin');builtin.onclick=async()=>{try{const note=reason('Restore','built-in parser');if(note===null)return;
if(!confirm('Restore the built-in parser for FUTURE replay imports? Existing season data will not be rewritten.'))return;
builtin.disabled=true;const {error:e}=await db().rpc('sbl_activate_parser_version',{p_parser_id:null,p_note:note,p_rollback:true});if(e)throw e;
tell('Built-in parser restored. Reload other open tabs to use it.');await refresh();}catch(e){tell('Restore failed: '+e.message);}finally{builtin.disabled=false;}};
for(const button of table.querySelectorAll('[data-parser-test]'))button.onclick=async()=>{button.disabled=true;try{tell('Validating staged parser in isolated sandbox…');let source=await getSource(button.dataset.parserTest);const result=await testSource(source.source_text);tell(source.version_label+' passed '+result.count+' sandbox fixtures. This is not a full regression test.');}catch(e){tell('Validation failed: '+e.message);}finally{button.disabled=false;}};
for(const button of table.querySelectorAll('[data-parser-activate]'))button.onclick=async()=>{button.disabled=true;try{
 const src=await getSource(button.dataset.parserActivate);tell('Validating '+src.version_label+' in isolated sandbox before activation…');
 const test=await testSource(src.source_text);const note=reason('Activate',src.version_label);if(note===null){tell('Activation cancelled.');return;}
 if(!confirm(`Activate ${src.version_label}? ${test.count} fixtures passed, but this does NOT prove compatibility with every replay. Only future imports are affected. Continue?`))return;
 const {error:e}=await db().rpc('sbl_activate_parser_version',{p_parser_id:src.id,p_note:note,p_rollback:true});if(e)throw e;
 tell(src.version_label+' activated. Reload open browser tabs; old replays remain unchanged.');await refresh();
 }catch(e){tell('Activation failed: '+e.message);}finally{button.disabled=false;}};
}
stage.onclick=async()=>{const f=file.files?.[0],version=label.value.trim();if(!f||!version){tell('Provide a version and parser file.');return;}
if(!/\.(txt|js)$/i.test(f.name)||f.size>500000){tell('Choose .txt/.js source up to 500 KB.');return;}
stage.disabled=true;try{const source=await f.text();tell('Validating parser in isolated sandbox before staging…');const result=await testSource(source);
const sha256=await hash(source);const {error}=await db().rpc('sbl_stage_parser_version',{p_version:version,p_source:source,p_sha256:sha256});if(error)throw error;
tell(version+' staged and passed '+result.count+' fixtures. Select Activate to deploy it; the site is unchanged until then.');await refresh();}
catch(e){tell('Staging failed: '+e.message);}finally{stage.disabled=false;}};
refresh();
})();
