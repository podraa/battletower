/* CP4.176: A personal, saved, accessible Match Prep widget workspace.
 * Widget bodies are the existing Match Prep DOM nodes. Moving a node preserves
 * its calculator, scouting and planner event listeners and analysis contracts.
 */
(function(){
  'use strict';
  const SBL=window.SBL=window.SBL||{};
  const META={
    overview:{title:'Team Overview',desc:'Your roster and opposing roster'},
    threats:{title:'Threat Board',desc:'Prioritise matchup threats'},
    planner:{title:'Team Planner',desc:'Choose and compare your six'},
    typechart:{title:'Type Chart',desc:'Defensive and offensive typing'},
    coverage:{title:'Team Coverage',desc:'Offensive coverage and counters'},
    switch:{title:'Switch-In Analyser',desc:'Defensive damage calculations'},
    speed:{title:'Speed Workbench',desc:'Speed scenarios and benchmarks'},
    matches:{title:'Replays',desc:'Opponent match history'},
    notebook:{title:'Prep Notebook',desc:'Private notes saved by opponent and week'},
    checklist:{title:'Prep Checklist',desc:'Things to investigate before battle'},
    findings:{title:'Saved Findings',desc:'Keep useful results from other tools'},
    gameplan:{title:'Game Plan',desc:'Your overall strategy and win conditions'}
  };
  let active=null,cache=null,cacheUser=null,loadPromise=null;
  const PAGES=SBL.prepLayouts.PAGES||[{id:'overview',title:'Overview'},{id:'scouting',title:'Scouting'},{id:'analysis',title:'Analysis'},{id:'prep',title:'My Prep'}];
  let layoutQueue=Promise.resolve();
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label=id=>META[id]?.title||id;
  const byId=(s,id)=>s.root?.querySelector('#'+id)||null;
  function status(s,text,kind=''){
    const node=s.root?.querySelector('#prepWorkspaceStatus');
    if(node){node.textContent=text;node.dataset.kind=kind;}
  }
  function panel(id,inner){
    const el=document.createElement('section');
    el.className='panel prep-selectable-section prep-personal-panel';
    el.dataset.prepSection=id;
    el.innerHTML=inner;
    return el;
  }
  function createPersonalPanels(){
    return [
      panel('notebook',`<h2>Prep Notebook</h2><p class="panel-desc">Private notes for this opponent, organised by week. Changes are saved automatically.</p>
        <div class="prep-personal-row"><label for="prepPersonalWeek">Week</label><select id="prepPersonalWeek" aria-label="Notes week"></select><span id="prepPersonalNoteStatus" class="prep-personal-status" role="status" aria-live="polite">Loading notes</span></div>
        <textarea id="prepPersonalNoteText" rows="9" maxlength="8000" placeholder="Threats, reminders, lead ideas, important interactions..." aria-label="Private matchup notes"></textarea>`),
      panel('checklist',`<h2>Preparation Checklist</h2><p class="panel-desc">Track tasks that still need attention.</p>
        <form id="prepPersonalTaskForm" class="prep-personal-row"><input id="prepPersonalTaskInput" maxlength="500" required placeholder="e.g. Check Speed against their fastest Pokémon" aria-label="New preparation task"><button type="submit">Add task</button></form>
        <div id="prepPersonalTaskList" class="prep-personal-list" aria-live="polite">Loading tasks...</div>`),
      panel('findings',`<h2>Saved Findings</h2><p class="panel-desc">Keep calculations and scouting observations alongside your prep.</p>
        <form id="prepPersonalFindingForm" class="prep-personal-row"><input id="prepPersonalFindingInput" maxlength="2000" required placeholder="Add an observation or reminder" aria-label="New finding"><button type="submit">Save finding</button></form>
        <div id="prepPersonalFindingList" class="prep-personal-list" aria-live="polite">Loading findings...</div>`),
      panel('gameplan',`<h2>Game Plan</h2><p class="panel-desc">Plan possible leads, win conditions, key threats and answers. Private to your account.</p>
        <textarea id="prepPersonalPlanText" maxlength="8000" rows="9" placeholder="Possible leads:\n\nWin conditions:\n\nImportant answers:\n\nThings to avoid:" aria-label="Your game plan"></textarea>
        <div id="prepPersonalPlanStatus" class="prep-personal-status" role="status" aria-live="polite">Loading plan</div>`)
    ];
  }
  function cloneLayout(v){return SBL.prepLayouts.clean(v);}
  function layoutOf(s){return cloneLayout(s.layout);}
  function layoutIndex(s,id){return s.layout.widgets.findIndex(w=>w.id===id);}
  function setLayout(s,layout){
    if(active!==s)return;
    s.layout=cloneLayout(layout);
    s.revision++;
    cache=layoutOf(s);
    applyLayout(s);
    scheduleLayoutSave(s);
  }
  function persistLayout(s){
    if(!s.needsSave)return;
    s.needsSave=false;
    const revision=s.revision,requested=layoutOf(s);
    // Serialize updates to prevent slow old requests overwriting new layouts.
    layoutQueue=layoutQueue.catch(()=>{}).then(()=>SBL.prepLayouts.save(requested));
    layoutQueue.then(()=>{if(active===s&&s.revision===revision)status(s,'Layout saved');})
      .catch(err=>{if(active===s)status(s,'Layout saved on this device only. Check your connection or database migration.','error');console.warn('Match Prep layout save:',err);});
  }
  function scheduleLayoutSave(s){
    clearTimeout(s.saveTimer);
    s.needsSave=true;
    status(s,'Saving layout...');
    s.saveTimer=setTimeout(()=>persistLayout(s),450);
  }

  function toolsMarkup(s){
    return Object.entries(META).map(([id,info])=>{
      const selected=layoutIndex(s,id)>=0;
      const current=s.layout.widgets.find(w=>w.id===id);
      return `<button type="button" class="prep-tool-choice ${selected?'selected':''}" data-prep-toggle="${esc(id)}" aria-pressed="${selected}" title="${esc(info.desc)}"><span>${selected?'✓':'+'}</span><span><strong>${esc(info.title)}</strong><small>${selected?'On '+PAGES.find(p=>p.id===current.page)?.title:info.desc}</small></span></button>`;
    }).join('');
  }
  function pagesMarkup(s){
    return PAGES.map(p=>{
      const count=s.layout.widgets.filter(w=>w.page===p.id).length;
      return `<button type="button" role="tab" class="prep-workspace-page ${s.page===p.id?'active':''}" data-prep-nav="${p.id}" aria-selected="${s.page===p.id}">${esc(p.title)} <span>${count}</span></button>`;
    }).join('');
  }
  function controls(s){
    s.root.innerHTML=`<div class="prep-workspace-top"><div class="prep-workspace-heading"><h2>My Match Prep Workspace</h2><p>Choose the tools you need. Your layout is personal and follows your account.</p></div>
      <div class="prep-workspace-top-actions"><span id="prepWorkspaceStatus" class="prep-personal-status" role="status" aria-live="polite"></span><button type="button" id="prepWorkspaceEdit" aria-pressed="${s.editing}">${s.editing?'Done editing':'Edit layout'}</button></div></div>
      <nav id="prepWorkspacePages" class="prep-workspace-pages" role="tablist" aria-label="Your Match Prep workspace pages">${pagesMarkup(s)}</nav>
      <div id="prepWorkspaceEditor" class="prep-workspace-editor" ${s.editing?'':'hidden'}>
        <div class="prep-workspace-instructions">Drag a tool by its handle to reorder, or use the arrow buttons. Choose half or full width. Your settings save automatically.</div>
        <div class="prep-workspace-presets"><label for="prepWorkspacePreset">Start from a layout</label><select id="prepWorkspacePreset"><option value="">Choose a preset</option><option value="standard">All tools</option><option value="quick">Quick Prep</option><option value="scouting">Scouting</option><option value="planning">Team Planning</option><option value="empty">Minimal</option></select><button type="button" id="prepWorkspaceApplyPreset">Apply preset</button></div>
        <details class="prep-workspace-library" open><summary>Add or remove tools <span>${s.layout.widgets.length} selected</span></summary><div class="prep-workspace-tool-grid">${toolsMarkup(s)}</div></details>
      </div>`;
    byId(s,'prepWorkspacePages').addEventListener('click',e=>{
      const tab=e.target.closest('[data-prep-nav]');if(!tab)return;
      s.page=tab.dataset.prepNav;applyLayout(s);
      s.root.scrollIntoView({behavior:'smooth',block:'start'});
    });
    const edit=byId(s,'prepWorkspaceEdit');
    edit.addEventListener('click',()=>{s.editing=!s.editing;controls(s);applyLayout(s);});
    byId(s,'prepWorkspaceApplyPreset').addEventListener('click',()=>{
      const key=byId(s,'prepWorkspacePreset').value;
      if(!key)return;
      // Presets replace the chosen widgets. Ask first so existing work is not hidden unexpectedly.
      if(!window.confirm('Replace the current widget arrangement with this preset? Your notes and saved findings will not be deleted.'))return;
      setLayout(s,SBL.prepLayouts.preset(key));
    });
    byId(s,'prepWorkspaceEditor').addEventListener('click',e=>{
      const t=e.target.closest('[data-prep-toggle]');if(!t)return;
      const id=t.dataset.prepToggle,arr=[...s.layout.widgets],index=layoutIndex(s,id);
      if(index>=0){arr.splice(index,1);s.temporary.delete(id);}
      else arr.push({id,width:SBL.prepLayouts.defaultWidth(id),page:s.page});
      setLayout(s,{version:2,widgets:arr});
    });
  }
  function card(s,id,section){
    const article=document.createElement('div');
    article.className='prep-widget-card';article.dataset.widget=id;
    article.innerHTML=`<div class="prep-widget-bar"><div class="prep-widget-name"><span class="prep-widget-grip" aria-hidden="true" title="Drag to reorder">⠿</span><strong>${esc(label(id))}</strong></div><div class="prep-widget-actions">
      ${['overview','threats','planner','typechart','coverage','switch','speed','matches'].includes(id)?'<button type="button" class="prep-widget-bookmark" data-prep-bookmark="'+esc(id)+'" title="Save an observation from this tool">Save to Prep</button>':''}
      <label class="prep-widget-edit-action prep-widget-page-select">Page <select aria-label="Move ${esc(label(id))} to page" data-prep-page="${esc(id)}">${PAGES.map(p=>`<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></label>
      <button type="button" class="prep-widget-edit-action" data-prep-width="${esc(id)}" title="Toggle half or full width">Width</button>
      <button type="button" class="prep-widget-edit-action" data-prep-up="${esc(id)}" aria-label="Move ${esc(label(id))} up">↑</button>
      <button type="button" class="prep-widget-edit-action" data-prep-down="${esc(id)}" aria-label="Move ${esc(label(id))} down">↓</button>
      <button type="button" class="prep-widget-edit-action" data-prep-remove="${esc(id)}" aria-label="Remove ${esc(label(id))} from layout">×</button></div></div>`;
    article.appendChild(section);
    section.hidden=false;
    return article;
  }
  function applyLayout(s){
    if(active!==s)return;
    const ids=s.layout.widgets.map(w=>w.id);
    for(const id of s.temporary)if(!ids.includes(id))ids.push(id);
    const visibleIds=ids.filter(id=>{
      const config=s.layout.widgets.find(w=>w.id===id);
      return (config?.page||s.page)===s.page;
    });
    if(!s.emptyHint){s.emptyHint=document.createElement('div');s.emptyHint.className='prep-workspace-empty';s.emptyHint.textContent='No tools on this page. Choose Edit layout to add or move tools here.';}
    s.emptyHint.hidden=visibleIds.length>0;
    for(const id of ids){
      const c=s.cards.get(id);if(!c)continue;
      const config=s.layout.widgets.find(w=>w.id===id);
      const onPage=visibleIds.includes(id);
      c.hidden=!onPage;
      c.classList.toggle('prep-widget-full',(config?.width||'full')==='full');
      c.classList.toggle('prep-widget-half',config?.width==='half');
      c.draggable=false;
      c.querySelector('.prep-widget-grip').draggable=s.editing;
      c.querySelectorAll('.prep-widget-edit-action').forEach(el=>{el.hidden=!s.editing;});
      const select=c.querySelector('[data-prep-page]');if(select)select.value=config?.page||s.page;
      s.grid.appendChild(c);
    }
    s.cards.forEach((c,id)=>{if(!ids.includes(id))c.hidden=true;});
    s.grid.appendChild(s.emptyHint);
    s.grid.classList.toggle('is-editing',s.editing);
    s.grid.setAttribute('aria-label',(PAGES.find(p=>p.id===s.page)?.title||'Workspace')+' tools');
    if(s.root){
      const drawer=byId(s,'prepWorkspaceEditor');
      if(drawer){drawer.hidden=!s.editing;drawer.querySelector('.prep-workspace-tool-grid').innerHTML=toolsMarkup(s);drawer.querySelector('summary span').textContent=s.layout.widgets.length+' selected';}
      const nav=byId(s,'prepWorkspacePages');if(nav)nav.innerHTML=pagesMarkup(s);
    }
  }
  function reorder(s,from,to){
    const arr=[...s.layout.widgets],i=arr.findIndex(w=>w.id===from),j=arr.findIndex(w=>w.id===to);
    if(i<0||j<0||i===j)return;
    const [moved]=arr.splice(i,1);arr.splice(j,0,moved);
    setLayout(s,{version:1,widgets:arr});
  }
  function wireCardActions(s){
    s.grid.addEventListener('change',e=>{
      const select=e.target.closest('[data-prep-page]');
      if(!select||!s.editing||active!==s)return;
      const id=select.dataset.prepPage,widgets=s.layout.widgets.map(w=>w.id===id?{...w,page:select.value}:w);
      setLayout(s,{version:2,widgets});
    });
    s.grid.addEventListener('click',e=>{
      const action=e.target.closest('[data-prep-up],[data-prep-down],[data-prep-width],[data-prep-remove],[data-prep-bookmark]');
      if(!action||active!==s)return;
      if(action.dataset.prepBookmark){openSaveFinding(s,action.dataset.prepBookmark);return;}
      if(!s.editing)return;
      const key=['prepUp','prepDown','prepWidth','prepRemove'].find(k=>action.dataset[k]);
      const id=action.dataset[key],arr=[...s.layout.widgets],i=layoutIndex(s,id);
      if(i<0)return;
      if(key==='prepUp'&&i>0){[arr[i-1],arr[i]]=[arr[i],arr[i-1]];}
      if(key==='prepDown'&&i<arr.length-1){[arr[i+1],arr[i]]=[arr[i],arr[i+1]];}
      if(key==='prepWidth')arr[i]={...arr[i],width:arr[i].width==='half'?'full':'half'};
      if(key==='prepRemove'){arr.splice(i,1);s.temporary.delete(id);}
      setLayout(s,{version:2,widgets:arr});
    });
    s.grid.addEventListener('dragstart',e=>{
      if(!s.editing)return;
      const card=e.target.closest('[data-widget]');if(!card)return;
      if(!e.target.closest('.prep-widget-grip')){e.preventDefault();return;}
      s.dragId=card.dataset.widget;
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain',s.dragId);
    });
    s.grid.addEventListener('dragover',e=>{
      if(!s.editing||!s.dragId||!e.target.closest('[data-widget]'))return;
      e.preventDefault();e.dataTransfer.dropEffect='move';
    });
    s.grid.addEventListener('drop',e=>{
      if(!s.editing||!s.dragId)return;
      const target=e.target.closest('[data-widget]');
      if(target){e.preventDefault();reorder(s,s.dragId,target.dataset.widget);}
      s.dragId='';
    });
    s.grid.addEventListener('dragend',()=>{s.dragId='';});
  }
  function setText(el,text){if(el)el.textContent=text;}
  function noteWeekLabel(week){return String(week||'Unassigned')==='Unassigned'?'Unassigned':String(week);}
  async function loadNotebook(s){
    const select=byId(s,'prepPersonalWeek'),field=byId(s,'prepPersonalNoteText');
    if(!select||!field)return;
    field.disabled=true;
    s.noteWeek=String(s.context.week||'Unassigned');
    try{
      const notes=await SBL.notes.getMatchupNotes(s.context.opponent,{leagueId:s.context.leagueId,seasonId:s.context.seasonId});
      if(active!==s)return;
      s.noteRows=notes;
      const weeks=[...new Set([s.noteWeek,...notes.map(x=>String(x.week_key||'Unassigned'))])];
      select.innerHTML=weeks.map(w=>`<option value="${esc(w)}">${esc(noteWeekLabel(w))}</option>`).join('');
      select.value=s.noteWeek;
      if(!s.noteDirty)field.value=notes.find(x=>String(x.week_key)===s.noteWeek)?.content||'';
      field.disabled=false;
      setText(byId(s,'prepPersonalNoteStatus'),'Ready. Autosave is on.');
    }catch(err){if(active===s){field.disabled=false;setText(byId(s,'prepPersonalNoteStatus'),'Unable to load notes: '+String(err.message||err));}}
  }
  async function saveNote(s){
    const field=byId(s,'prepPersonalNoteText');
    if(!field||!s.noteDirty||active!==s)return;
    const content=field.value,week=s.noteWeek;
    s.noteDirty=false;
    setText(byId(s,'prepPersonalNoteStatus'),'Saving...');
    s.noteQueue=(s.noteQueue||Promise.resolve()).catch(()=>{}).then(()=>SBL.notes.setMatchupNote(s.context.opponent,content,{leagueId:s.context.leagueId,seasonId:s.context.seasonId,weekKey:week}));
    try{
      const row=await s.noteQueue;
      if(active!==s)return;
      const ix=s.noteRows.findIndex(n=>String(n.week_key)===week);
      if(ix>=0)s.noteRows[ix]=row;else s.noteRows.push(row);
      if(!s.noteDirty)setText(byId(s,'prepPersonalNoteStatus'),'Saved');
    }catch(err){
      if(active===s)setText(byId(s,'prepPersonalNoteStatus'),'Saved locally. Cloud sync failed: '+String(err.message||err));
    }
  }
  function wireNotebook(s){
    const field=byId(s,'prepPersonalNoteText'),week=byId(s,'prepPersonalWeek');
    field?.addEventListener('input',()=>{
      s.noteDirty=true;
      SBL.notes.stageMatchupDraft(s.context.opponent,field.value,{leagueId:s.context.leagueId,seasonId:s.context.seasonId,weekKey:s.noteWeek});
      setText(byId(s,'prepPersonalNoteStatus'),'Unsaved changes');
      clearTimeout(s.noteTimer);s.noteTimer=setTimeout(()=>saveNote(s),600);
    });
    field?.addEventListener('blur',()=>{clearTimeout(s.noteTimer);void saveNote(s);});
    week?.addEventListener('change',async()=>{
      clearTimeout(s.noteTimer);await saveNote(s);
      s.noteWeek=week.value;
      field.value=s.noteRows.find(n=>String(n.week_key)===s.noteWeek)?.content||'';
      setText(byId(s,'prepPersonalNoteStatus'),'Ready. Autosave is on.');
    });
  }
  function planDraftKey(s){
    if(!s.userId)return '';
    return 'battle_tower_prep_plan_draft_v1|'+[s.userId,s.context.leagueId,s.context.seasonId,
      SBL.prepTracker.scopeKey(s.context.opponent)].join('|');
  }
  function stagePlan(s,content){
    const key=planDraftKey(s);
    if(!key){s.pendingPlanDraft=content;return;}
    try{localStorage.setItem(key,JSON.stringify({content,updatedAt:new Date().toISOString()}));}catch(_){}
  }
  function cachedPlan(s,serverPlan){
    const key=planDraftKey(s);
    if(!key)return serverPlan?.content||'';
    try{
      const d=JSON.parse(localStorage.getItem(key)||'null');
      if(d && (!serverPlan || Date.parse(d.updatedAt)>Date.parse(serverPlan.updated_at||'')))return String(d.content||'');
    }catch(_){}
    return serverPlan?.content||'';
  }
  function clearPlanDraft(s,content){
    const key=planDraftKey(s);if(!key)return;
    try{const d=JSON.parse(localStorage.getItem(key)||'null');if(d?.content===content)localStorage.removeItem(key);}catch(_){}
  }
  function listRows(s){
    const tasks=byId(s,'prepPersonalTaskList'),findings=byId(s,'prepPersonalFindingList');
    if(tasks){
      const rows=s.items.filter(x=>x.item_type==='task');
      tasks.innerHTML=rows.length?rows.map(x=>`<div class="prep-personal-entry ${x.is_done?'is-done':''}" data-item="${esc(x.id)}"><label><input type="checkbox" data-prep-done="${esc(x.id)}" ${x.is_done?'checked':''}><span>${esc(x.content)}</span></label><button type="button" data-prep-delete="${esc(x.id)}" aria-label="Delete task">×</button></div>`).join(''):'<p class="prep-personal-empty">No tasks yet. Add a reminder to investigate.</p>';
    }
    if(findings){
      const rows=s.items.filter(x=>x.item_type==='finding');
      findings.innerHTML=rows.length?rows.map(x=>`<div class="prep-personal-entry prep-finding-entry" data-item="${esc(x.id)}"><div><p>${esc(x.content)}</p>${x.source_widget?`<button type="button" class="prep-personal-jump" data-prep-open-tool="${esc(x.source_widget)}">Open ${esc(label(x.source_widget))}</button>`:''}</div><button type="button" data-prep-delete="${esc(x.id)}" aria-label="Delete saved finding">×</button></div>`).join(''):'<p class="prep-personal-empty">No saved findings yet. Use Save to Prep on an analysis widget.</p>';
    }
    const plan=byId(s,'prepPersonalPlanText');
    if(plan&&!s.planDirty)plan.value=cachedPlan(s,s.items.find(x=>x.item_type==='plan'));
    if(!s.planDirty)setText(byId(s,'prepPersonalPlanStatus'),'Ready. Autosave is on.');
  }
  async function loadItems(s){
    try{
      const rows=await SBL.prepTracker.list(s.context);
      if(active!==s)return;
      s.items=rows;
      listRows(s);
    }catch(err){
      if(active!==s)return;
      s.items=[];
      const msg='Unable to load saved prep: '+String(err.message||err);
      setText(byId(s,'prepPersonalTaskList'),msg);setText(byId(s,'prepPersonalFindingList'),msg);
      setText(byId(s,'prepPersonalPlanStatus'),msg);
    }
  }
  async function addItem(s,entry,input){
    if(active!==s)return;
    if(input)input.disabled=true;
    try{
      const row=await SBL.prepTracker.add(s.context,entry);
      if(active!==s)return;
      s.items.unshift(row);
      if(input)input.value='';
      listRows(s);
      status(s,'Preparation saved');
    }catch(err){if(active===s)status(s,'Could not save preparation: '+String(err.message||err),'error');}
    finally{if(input)input.disabled=false;}
  }
  async function savePlan(s){
    if(!s.planDirty||active!==s)return;
    s.planDirty=false;
    const content=byId(s,'prepPersonalPlanText')?.value||'';
    stagePlan(s,content);
    const existing=s.items.find(x=>x.item_type==='plan');
    if(!content.trim()&&!existing){setText(byId(s,'prepPersonalPlanStatus'),'Nothing to save');return;}
    setText(byId(s,'prepPersonalPlanStatus'),'Saving...');
    s.planQueue=(s.planQueue||Promise.resolve()).catch(()=>{}).then(async()=>{
      const prev=s.items.find(x=>x.item_type==='plan');
      if(prev)return SBL.prepTracker.update(prev.id,{content});
      return SBL.prepTracker.add(s.context,{type:'plan',content});
    });
    try{
      const item=await s.planQueue;
      const i=s.items.findIndex(x=>x.item_type==='plan');
      if(i>=0)s.items[i]=item;else s.items.unshift(item);
      clearPlanDraft(s,content);
      if(active!==s)return;
      if(!s.planDirty)setText(byId(s,'prepPersonalPlanStatus'),'Saved');
    }catch(err){if(active===s)setText(byId(s,'prepPersonalPlanStatus'),'Saved locally. Cloud sync failed: '+String(err.message||err));}
  }
  function wirePrep(s){
    wireNotebook(s);
    for(const [formId,inputId,type] of [['prepPersonalTaskForm','prepPersonalTaskInput','task'],['prepPersonalFindingForm','prepPersonalFindingInput','finding']]){
      byId(s,formId)?.addEventListener('submit',e=>{
        e.preventDefault();const input=byId(s,inputId),value=input.value.trim();
        if(value)void addItem(s,{type,content:value},input);
      });
    }
    s.grid.addEventListener('change',async e=>{
      const input=e.target.closest('[data-prep-done]');
      if(!input||active!==s)return;
      const id=input.dataset.prepDone;
      input.disabled=true;
      try{
        const row=await SBL.prepTracker.update(id,{is_done:input.checked});
        if(active!==s)return;
        const i=s.items.findIndex(x=>x.id===id);if(i>=0)s.items[i]=row;
        listRows(s);
      }catch(err){if(active===s){input.checked=!input.checked;status(s,'Could not update task: '+String(err.message||err),'error');}}
      finally{input.disabled=false;}
    });
    s.grid.addEventListener('click',async e=>{
      const del=e.target.closest('[data-prep-delete]');
      const open=e.target.closest('[data-prep-open-tool]');
      if(open){
        const item=s.items.find(x=>x.id===open.closest('[data-item]')?.dataset.item);
        if(item?.context?.state && typeof window.__sblRestorePrepState==='function'){
          void window.__sblRestorePrepState(item.context);
        }else reveal(open.dataset.prepOpenTool);
        return;
      }
      if(!del||active!==s)return;
      const id=del.dataset.prepDelete;
      if(!window.confirm('Delete this saved preparation item?'))return;
      del.disabled=true;
      try{await SBL.prepTracker.remove(id);if(active===s){s.items=s.items.filter(x=>x.id!==id);listRows(s);}}
      catch(err){if(active===s)status(s,'Could not delete: '+String(err.message||err),'error');}
      finally{del.disabled=false;}
    });
    byId(s,'prepPersonalPlanText')?.addEventListener('input',()=>{
      s.planDirty=true;
      stagePlan(s,byId(s,'prepPersonalPlanText')?.value||'');
      setText(byId(s,'prepPersonalPlanStatus'),'Unsaved changes');
      clearTimeout(s.planTimer);s.planTimer=setTimeout(()=>savePlan(s),700);
    });
    byId(s,'prepPersonalPlanText')?.addEventListener('blur',()=>{clearTimeout(s.planTimer);void savePlan(s);});
  }
  function captureContext(s,id){
    const section=s.cards.get(id)?.querySelector('[data-prep-section]');
    const values={};
    for(const el of [...(section?.querySelectorAll('select,input')||[])].slice(0,45)){
      if(!el.id||el.type==='password'||el.type==='search')continue;
      values[el.id]=el.type==='checkbox'?el.checked:String(el.value||'').slice(0,200);
    }
    const result=id==='switch'?document.querySelector('#switchResults')?.innerText?.trim().slice(0,2200):'';
    return {widget:id,inputs:values,state:window.__sblPrepStateSnapshot?.(id)||{},result:result||'',savedAt:new Date().toISOString()};
  }
  function openSaveFinding(s,id){
    const dialog=s.dialog;
    if(!dialog)return;
    s.saveSource=id;
    s.saveContext=captureContext(s,id);
    dialog.querySelector('#prepFindingDialogTitle').textContent='Save from '+label(id);
    const input=dialog.querySelector('#prepFindingDialogText');
    const selected=s.saveContext.inputs;
    input.value=(id==='switch' && selected.prepSwitchMon)
      ? `${selected.prepSwitchMon}${selected.prepSwitchMove?' using '+selected.prepSwitchMove:''}: `
      : '';
    setText(dialog.querySelector('#prepFindingDialogStatus'),'');
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
    input.focus();
  }
  function makeDialog(s){
    const dialog=document.createElement('dialog');dialog.id='prepSaveFindingDialog';dialog.className='prep-save-finding-dialog';
    dialog.innerHTML=`<form id="prepSaveFindingForm" method="dialog"><h2 id="prepFindingDialogTitle">Save to Prep</h2><p>Add an observation to your private saved findings. We also keep the current input values as reference.</p>
      <label for="prepFindingDialogText">What do you want to remember?</label><textarea id="prepFindingDialogText" maxlength="2000" rows="5" required></textarea>
      <div id="prepFindingDialogStatus" role="status" aria-live="polite"></div><div class="prep-finding-dialog-actions"><button type="button" id="prepFindingDialogCancel">Cancel</button><button type="submit">Save finding</button></div></form>`;
    document.body.appendChild(dialog);s.dialog=dialog;
    dialog.querySelector('#prepFindingDialogCancel').addEventListener('click',()=>dialog.close());
    dialog.querySelector('#prepSaveFindingForm').addEventListener('submit',async e=>{
      e.preventDefault();
      const input=dialog.querySelector('#prepFindingDialogText');
      const content=input.value.trim();if(!content)return;
      const button=dialog.querySelector('button[type=submit]');button.disabled=true;
      try{
        const row=await SBL.prepTracker.add(s.context,{type:'finding',content,sourceWidget:s.saveSource,context:s.saveContext});
        if(active!==s)return;
        s.items.unshift(row);listRows(s);
        dialog.close();status(s,'Finding saved to your preparation');
      }catch(err){setText(dialog.querySelector('#prepFindingDialogStatus'),'Could not save: '+String(err.message||err));}
      finally{button.disabled=false;}
    });
  }
  function reveal(id){
    const s=active;if(!s||!s.cards.has(id))return false;
    const config=s.layout.widgets.find(w=>w.id===id);
    s.page=config?.page||s.page;
    if(layoutIndex(s,id)<0)s.temporary.add(id);
    applyLayout(s);
    s.cards.get(id).scrollIntoView({behavior:'smooth',block:'start'});
    const focusTarget=s.cards.get(id).querySelector('h2');
    if(focusTarget){focusTarget.setAttribute('tabindex','-1');focusTarget.focus({preventScroll:true});}
    return true;
  }
  function mount(context={}){
    const root=document.querySelector('.prep-section-picker');
    const source=[...document.querySelectorAll('.prep-selectable-section[data-prep-section]')];
    if(!root||source.length<8)return;
    const previousUI=active?{editing:active.editing,page:active.page}:null;
    if(active){
      clearTimeout(active.noteTimer);clearTimeout(active.planTimer);clearTimeout(active.saveTimer);
      persistLayout(active);
      // Stage drafts before replacing the old editor.
      const oldNote=byId(active,'prepPersonalNoteText');
      if(active.noteDirty&&oldNote)SBL.notes.stageMatchupDraft(active.context.opponent,oldNote.value,{leagueId:active.context.leagueId,seasonId:active.context.seasonId,weekKey:active.noteWeek});
      const oldPlan=byId(active,'prepPersonalPlanText');if(active.planDirty&&oldPlan)stagePlan(active,oldPlan.value);
      // Flush outgoing text to Supabase using its original opponent scope.
      if(active.noteDirty)void saveNote(active);
      if(active.planDirty)void savePlan(active);
      active.dialog?.remove();
    }
    const s={root,context:{leagueId:String(context.leagueId||''),seasonId:String(context.seasonId||''),opponent:String(context.opponent||''),week:String(context.week||'Unassigned')},
      grid:document.createElement('div'),cards:new Map(),layout:cache?cloneLayout(cache):SBL.prepLayouts.preset('standard'),
      editing:previousUI?.editing||false,page:previousUI?.page||'overview',revision:0,temporary:new Set(),dragId:'',items:[],noteRows:[],noteDirty:false,planDirty:false};
    active=s;
    s.grid.id='prepWorkspaceGrid';s.grid.className='prep-workspace-grid';
    const all=[...source,...createPersonalPanels()];
    for(const section of all){
      const id=section.dataset.prepSection;
      if(!META[id])continue;
      const cardEl=card(s,id,section);
      s.cards.set(id,cardEl);
      s.grid.appendChild(cardEl);
    }
    root.parentNode.insertBefore(s.grid,root.nextSibling);
    controls(s);wireCardActions(s);wirePrep(s);makeDialog(s);
    applyLayout(s);
    void loadNotebook(s);void loadItems(s);
    // Fetch once, preserve any edits made before the remote layout arrives.
    if(!loadPromise)loadPromise=SBL.prepLayouts.load().then(result=>({layout:cloneLayout(result),userId:result.userId})).finally(()=>{loadPromise=null;});
    const initialRevision=s.revision;
    const hadCache=!!cache;
    const pending=loadPromise;
    pending.then(remote=>{
      if(active!==s)return;
      s.userId=remote.userId;cacheUser=remote.userId;
      if(s.pendingPlanDraft!==undefined){stagePlan(s,s.pendingPlanDraft);delete s.pendingPlanDraft;}
      // Use remote data only when no newer local preference is on screen.
      if(s.revision===initialRevision&&!hadCache){
        s.layout=cloneLayout(remote.layout);cache=layoutOf(s);applyLayout(s);
      }
      if(!s.planDirty)listRows(s);
      status(s,'Layout ready');
    }).catch(err=>{if(active===s)status(s,'Using default layout. Save requires the CP4.176 migration.','error');console.warn('Match Prep layout load:',err);});
    return s;
  }
  SBL.prepWorkspace={mount,reveal,refreshItems(){return active?loadItems(active):Promise.resolve();},get mounted(){return !!active;},get layout(){return active?layoutOf(active):null;}};
})();
