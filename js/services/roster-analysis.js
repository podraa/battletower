/* Shared Team Analysis renderer. Supports actual + planned roster projections. */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  const TYPES=['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
  const esc=s=>String(s??'').replace(/[&<>\'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  function roleLabel(value){
    const raw=String(value??'').trim();
    if(!raw)return '';
    const spaced=raw.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[._-]+/g,' ').replace(/\s+/g,' ').trim();
    // Keep the API/storage identifiers intact, but correct both known spellings
    // of the old Cleric label for every user-facing role surface.
    if(/^(?:cleric|celric)$/i.test(spaced))return 'Recovery';
    if(/^speed control$/i.test(spaced))return 'Sticky Webs';
    if(/^hazard setter$/i.test(spaced))return '';
    // This one-off joke role remains assignable in Admin/storage, but is not
    // part of the competitive role display or coverage calculations.
    if(/^annoying cunt$/i.test(spaced))return '';
    if(/^stealth rock setter$/i.test(spaced))return 'Stealth Rock';
    if(/^spikes setter$/i.test(spaced))return 'Spikes';
    if(/^toxic spikes setter$/i.test(spaced))return 'Toxic Spikes';
    if(/^sticky web(?: setter|s)?$/i.test(spaced))return 'Sticky Webs';
    return spaced.replace(/\b\w/g,c=>c.toUpperCase());
  }
  function uniqueRoles(values){
    const seen=new Set(),out=[];
    (Array.isArray(values)?values:[]).forEach(value=>{
      const raw=String(value??'').trim();
      if(!raw)return;
      const label=roleLabel(raw);if(!label)return;
      const key=label.toLocaleLowerCase().replace(/\s+/g,' ');
      if(!seen.has(key)){seen.add(key);out.push(raw);}
    });
    return out;
  }
  // Defending-type multipliers against each attacking type (Gen 9 standard chart).
  const ATTACK={Normal:{Rock:.5,Ghost:0,Steel:.5},Fire:{Fire:.5,Water:.5,Grass:2,Ice:2,Bug:2,Rock:.5,Dragon:.5,Steel:2},Water:{Fire:2,Water:.5,Grass:.5,Ground:2,Rock:2,Dragon:.5},Electric:{Water:2,Electric:.5,Grass:.5,Ground:0,Flying:2,Dragon:.5},Grass:{Fire:.5,Water:2,Grass:.5,Poison:.5,Ground:2,Flying:.5,Bug:.5,Rock:2,Dragon:.5,Steel:.5},Ice:{Fire:.5,Water:.5,Grass:2,Ice:.5,Ground:2,Flying:2,Dragon:2,Steel:.5},Fighting:{Normal:2,Ice:2,Poison:.5,Flying:.5,Psychic:.5,Bug:.5,Rock:2,Ghost:0,Dark:2,Steel:2,Fairy:.5},Poison:{Grass:2,Poison:.5,Ground:.5,Rock:.5,Ghost:.5,Steel:0,Fairy:2},Ground:{Fire:2,Electric:2,Grass:.5,Poison:2,Flying:0,Bug:.5,Rock:2,Steel:2},Flying:{Electric:.5,Grass:2,Fighting:2,Bug:2,Rock:.5,Steel:.5},Psychic:{Fighting:2,Poison:2,Psychic:.5,Dark:0,Steel:.5},Bug:{Fire:.5,Grass:2,Fighting:.5,Poison:.5,Flying:.5,Psychic:2,Ghost:.5,Dark:2,Steel:.5,Fairy:.5},Rock:{Fire:2,Ice:2,Fighting:.5,Ground:.5,Flying:2,Bug:2,Steel:.5},Ghost:{Normal:0,Psychic:2,Ghost:2,Dark:.5},Dragon:{Dragon:2,Steel:.5,Fairy:0},Dark:{Fighting:.5,Psychic:2,Ghost:2,Dark:.5,Fairy:.5},Steel:{Fire:.5,Water:.5,Electric:.5,Ice:2,Rock:2,Steel:.5,Fairy:2},Fairy:{Fire:.5,Fighting:2,Poison:.5,Dragon:2,Dark:2,Steel:.5}};
  function defensiveMultiplier(attack,defenders){return (defenders||[]).reduce((n,d)=>n*(ATTACK[attack]?.[TYPES.find(t=>t.toLowerCase()===String(d).toLowerCase())]??1),1);}
  function render(opts){
    opts=opts||{};
    const entries=(opts.entries||[]).map(m=>({name:String(m.name||''),types:Array.isArray(m.types)&&m.types.length?m.types:(window.SBL.pokemonTypes?.lookupTypes(m.name)||[]),roles:uniqueRoles(m.roles||[]),status:m.status==='planned'?'planned':'actual'})).filter(m=>m.name);
    const roles=uniqueRoles([...(opts.roles||[]),...entries.flatMap(m=>m.roles)]).sort((a,b)=>roleLabel(a).localeCompare(roleLabel(b)));
    const source=entries.length+' Pokémon';
    const roleCells=entries.map(mon=>`<tr><th scope="row"><span class="ra-matrix-name">${opts.sprite?opts.sprite(mon.name):''}<span>${esc(mon.name)}</span></span></th>${roles.map(r=>`<td class="${mon.roles.some(x=>roleLabel(x)===roleLabel(r))?'ra-cell-yes':''}" title="${esc(mon.name)} · ${esc(roleLabel(r))}">${mon.roles.some(x=>roleLabel(x)===roleLabel(r))?'✓':'·'}</td>`).join('')}</tr>`).join('');
    // Type coverage here means types represented on the actual + planned roster,
    // not offensive move coverage or defensive effectiveness.
    const typeMarkup=TYPES.map(type=>{
      const members=entries.filter(m=>m.types.some(t=>String(t).toLowerCase()===type.toLowerCase()));
      return `<div class="ra-type-tile ${members.length?'is-covered':'is-missing'}" title="${esc(type)}: ${members.length?esc(members.map(m=>m.name).join(', ')):'not represented'}"><span class="type-badge type-${type.toLowerCase()}">${type}</span><div class="ra-type-members">${members.length?members.map(mon=>`<span class="ra-type-member" title="${esc(mon.name)}" aria-label="${esc(mon.name)}">${typeof opts.sprite==='function'?opts.sprite(mon.name):`<span class="ra-type-member-name">${esc(mon.name)}</span>`}</span>`).join(''):'<span class="ra-type-coverage-count">Not covered</span>'}</div></div>`;
    }).join('');
    const represented=TYPES.filter(type=>entries.some(m=>m.types.some(t=>String(t).toLowerCase()===type.toLowerCase()))).length;
    const roleGaps=roles.filter(r=>!entries.some(m=>m.roles.some(x=>roleLabel(x)===roleLabel(r))));
    return `<section class="roster-analysis ra-redesign ra-compact" aria-label="Team Analysis"><div class="ra-compact-heading"><h2>${esc(opts.heading||'Team Analysis')}</h2><span>${source} · ${roles.length-roleGaps.length}/${roles.length} roles covered</span></div><nav class="ra-matrix-tabs" aria-label="Analysis views"><button type="button" class="is-active" data-ra-view="roles" aria-pressed="true">Role Coverage</button><button type="button" data-ra-view="types" aria-pressed="false">Type Coverage</button></nav><div data-ra-panel="roles"><div class="ra-matrix-scroll"><table class="ra-matrix"><thead><tr><th scope="col">Pokémon</th>${roles.map(r=>`<th scope="col" title="${esc(roleLabel(r))}"><span class="ra-role-column">${esc(roleLabel(r))}</span></th>`).join('')}</tr></thead><tbody>${roleCells||'<tr><td>No Pokémon in this projection yet.</td></tr>'}</tbody><tfoot><tr><th scope="row">Total</th>${roles.map(r=>`<td>${entries.filter(m=>m.roles.some(x=>roleLabel(x)===roleLabel(r))).length}</td>`).join('')}</tr></tfoot></table></div></div><div data-ra-panel="types" hidden><p class="ra-type-summary">${represented} of 18 types represented on your roster · ${18-represented} missing</p><div class="ra-type-grid">${typeMarkup}</div></div></section>`;

  }
  const COLOUR_KEY='sbl_team_analysis_status_colours';
  const PALETTE=[['teal','Teal'],['rose','Rose'],['blue','Blue'],['green','Green'],['purple','Purple'],['orange','Orange']];
  const DEFAULT_COLOURS={actual:'teal',planned:'orange'};
  let colourPrefs={...DEFAULT_COLOURS},colourPrefsLoaded=false,colourSaveQueue=Promise.resolve();
  function applyColours(root){
    if(!root)return;
    const targets=[];if(root.matches?.('.roster-analysis'))targets.push(root);
    root.querySelectorAll?.('.roster-analysis').forEach(node=>targets.push(node));
    if(!targets.length)targets.push(root);
    targets.forEach(node=>{node.dataset.draftedColour=colourPrefs.actual||DEFAULT_COLOURS.actual;node.dataset.plannedColour=colourPrefs.planned||DEFAULT_COLOURS.planned;});
  }
  async function loadColourPrefs(root){
    try{
      const db=window.SBL?.getSupabase?.();
      const result=await db?.auth?.getSession?.();
      const user=result?.data?.session?.user;
      const saved=user?.user_metadata?.[COLOUR_KEY];
      if(saved&&typeof saved==='object'){colourPrefs={...DEFAULT_COLOURS,...saved};for(const key of ['actual','planned'])if(!PALETTE.some(([value])=>value===colourPrefs[key]))colourPrefs[key]=DEFAULT_COLOURS[key];}
      colourPrefsLoaded=true;
    }catch(error){console.warn('Could not load Team Analysis colour preferences:',error);}
    applyColours(root);
  }
  function saveColourPrefs(){
    colourSaveQueue=colourSaveQueue.then(async()=>{
      const db=window.SBL?.getSupabase?.();
      const result=await db?.auth?.getSession?.();
      const user=result?.data?.session?.user;
      if(!user)throw new Error('Sign in to save your Team Analysis colours to your account.');
      const metadata={...(user.user_metadata||{}),[COLOUR_KEY]:{...colourPrefs}};
      const updated=await db.auth.updateUser({data:metadata});
      if(updated?.error)throw updated.error;
    }).catch(error=>{console.warn('Could not save Team Analysis colour preferences:',error);});
    return colourSaveQueue;
  }
  function bind(root){
    if(!root)return;
    if(root.dataset.raBound!=='1'){
      root.dataset.raBound='1';
      root.addEventListener('input',e=>{if(e.target.matches('.ra-search'))filter(e.target.closest('.roster-analysis'));});
      root.addEventListener('click',e=>{const tab=e.target.closest('[data-ra-view]');if(!tab)return;const section=tab.closest('.roster-analysis');if(!section)return;section.querySelectorAll('[data-ra-view]').forEach(b=>{const active=b===tab;b.classList.toggle('is-active',active);b.setAttribute('aria-pressed',String(active));});section.querySelectorAll('[data-ra-panel]').forEach(panel=>{panel.hidden=panel.dataset.raPanel!==tab.dataset.raView;});});
      root.addEventListener('click',e=>{
        const button=e.target.closest('[data-matchup-type]');if(!button)return;
        const section=button.closest('.ra-matchup-section');if(!section)return;
        const type=button.dataset.matchupType;
        section.querySelectorAll('[data-matchup-type]').forEach(b=>{const selected=b===button;b.classList.toggle('is-selected',selected);b.setAttribute('aria-pressed',String(selected));});
        let entries=[];try{entries=JSON.parse(section.querySelector('.ra-matchup-data')?.textContent||'[]');}catch(_){return;}
        const groups={weak:[],resist:[],immune:[],neutral:[]};
        entries.forEach(mon=>{const mult=defensiveMultiplier(type,mon.types);const label=`${esc(mon.name)} <small>×${mult}</small>`;groups[mult===0?'immune':mult>1?'weak':mult<1?'resist':'neutral'].push(label);});
        section.querySelector('.ra-matchup-results').innerHTML=`<div class="ra-matchup-grid">${[['weak','Weak'],['resist','Resist'],['immune','Immune'],['neutral','Neutral']].map(([key,title])=>`<div class="ra-matchup-group"><strong>${title} <span>${groups[key].length}</span></strong><div>${groups[key].map(x=>`<span>${x}</span>`).join('')||'<em>None</em>'}</div></div>`).join('')}</div>`;
      });
      root.addEventListener('change',e=>{if(e.target.matches('.ra-type-filter,.ra-role-filter,.ra-status-filter'))filter(e.target.closest('.roster-analysis'));});
      root.addEventListener('click',async e=>{
        const control=e.target.closest('[data-status-colour]');if(!control)return;
        const status=control.dataset.statusColour;if(!['actual','planned'].includes(status))return;
        if(!colourPrefsLoaded)await loadColourPrefs(root);
        const current=colourPrefs[status]||DEFAULT_COLOURS[status];
        const panel=root.querySelector(`[data-colour-picker="${status}"]`);
        if(panel){const opening=panel.hidden;root.querySelectorAll('[data-colour-picker]').forEach(x=>x.hidden=true);panel.hidden=!opening;control.setAttribute('aria-expanded',String(opening));}
      });
      root.addEventListener('click',async e=>{
        const choice=e.target.closest('[data-status-colour-choice]');if(!choice)return;
        const status=choice.dataset.statusColourChoice,colour=choice.dataset.colour;if(!['actual','planned'].includes(status)||!PALETTE.some(x=>x[0]===colour))return;
        if(!colourPrefsLoaded)await loadColourPrefs(root);
        colourPrefs[status]=colour;applyColours(root);
        root.querySelectorAll(`[data-colour-picker="${status}"]`).forEach(x=>x.hidden=true);
        root.querySelectorAll(`[data-status-colour="${status}"]`).forEach(x=>x.setAttribute('aria-expanded','false'));
        await saveColourPrefs();
      });
    }
    applyColours(root);
    if(!colourPrefsLoaded)void loadColourPrefs(root);
  }
  function filter(panel){
    if(!panel)return;const q=(panel.querySelector('.ra-search')?.value||'').trim().toLowerCase(),type=panel.querySelector('.ra-type-filter')?.value||'',role=panel.querySelector('.ra-role-filter')?.value||'',status=panel.querySelector('.ra-status-filter')?.value||'';
    let n=0;panel.querySelectorAll('.ra-mon').forEach(card=>{const show=(!q||card.dataset.name.includes(q))&&(!type||card.dataset.types.split('|').includes(type))&&(!role||card.dataset.roles.split('|').includes(role))&&(!status||card.classList.contains(status==='planned'?'is-planned':'is-actual'));card.hidden=!show;if(show)n++;});
    const count=panel.querySelector('.ra-filter-count');if(count)count.textContent=`${n} shown`;
  }
  window.SBL.rosterAnalysis={render,bind,roleLabel,uniqueRoles,defensiveMultiplier,types:TYPES};
})();
