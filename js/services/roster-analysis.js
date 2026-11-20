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
  function render(opts){
    opts=opts||{};
    const team=opts.team||'Roster';
    const entries=(opts.entries||[]).map(m=>({name:String(m.name||''),types:Array.isArray(m.types)&&m.types.length?m.types:(window.SBL.pokemonTypes?.lookupTypes(m.name)||[]),roles:uniqueRoles(Array.isArray(m.roles)?m.roles:[]),abilities:Array.isArray(m.abilities)?m.abilities:[],status:m.status==='planned'?'planned':'actual'})).filter(m=>m.name);
    const roles=uniqueRoles([...(opts.roles||[]),...entries.flatMap(m=>m.roles)]).sort((a,b)=>roleLabel(a).localeCompare(roleLabel(b)));
    const typeCounts=Object.fromEntries(TYPES.map(t=>[t.toLowerCase(),0]));
    entries.forEach(m=>m.types.forEach(t=>{const k=String(t).toLowerCase();if(k in typeCounts)typeCounts[k]++;}));
    const roleCounts=Object.fromEntries(roles.map(r=>[r,0]));
    entries.forEach(m=>m.roles.forEach(r=>{
      const match=roles.find(candidate=>roleLabel(candidate).toLowerCase()===roleLabel(r).toLowerCase());
      if(match)roleCounts[match]++;
    }));
    const covered=TYPES.filter(t=>typeCounts[t.toLowerCase()]>0).length;
    const missing=TYPES.filter(t=>!typeCounts[t.toLowerCase()]);
    const roleCovered=roles.filter(r=>roleCounts[r]>0).length;
    const missingRoles=roles.filter(r=>roleCounts[r]===0);
    const repeatedRoles=roles.filter(r=>roleCounts[r]>1).sort((a,b)=>roleCounts[b]-roleCounts[a]);
    const concentratedTypes=TYPES.filter(t=>typeCounts[t.toLowerCase()]>=3).sort((a,b)=>typeCounts[b.toLowerCase()]-typeCounts[a.toLowerCase()]);
    const multiRoleCount=entries.filter(m=>m.roles.length>1).length;
    const unassigned=entries.filter(m=>!m.roles.length).length;
    const actualCount=entries.filter(m=>m.status==='actual').length;
    const plannedCount=entries.filter(m=>m.status==='planned').length;
    const mons=entries.map(m=>{
      const name=esc(m.name), types=m.types.map(t=>String(t).toLowerCase()), rs=m.roles, abilities=opts.showAbilities&&m.abilities.length?`<div class=\"ra-ability-tags\">Abilities: ${m.abilities.map(a=>esc(String(a).replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))).join(' · ')}</div>`:'';
      const status=m.status==='planned'?'Planned pick':'Drafted';
      return `<article class="ra-mon ${m.status==='planned'?'is-planned':'is-actual'}" data-name="${name.toLowerCase()}" data-types="${esc(types.join('|'))}" data-roles="${esc(rs.map(r=>roleLabel(r).toLowerCase()).join('|'))}">
        <div class="ra-mon-sprite">${opts.sprite?opts.sprite(m.name):''}</div>
        <div class="ra-mon-main"><div class="ra-mon-title"><strong>${name}</strong><span class="ra-status ${m.status==='planned'?'planned':'actual'}">${status}</span></div><div class="ra-mon-tags">${m.types.map(t=>`<span class="type-badge type-${esc(String(t).toLowerCase())}">${esc(t)}</span>`).join('')||'<span class="ra-muted">Types unavailable</span>'}</div>
        <div class="ra-role-tags">${rs.map(r=>`<span class="ra-role-tag">${esc(roleLabel(r))}</span>`).join('')||'<span class="ra-muted">No role assigned</span>'}</div>${abilities}</div></article>`;
    }).join('');
    const rolesMarkup=roles.length?roles.map(r=>`<div class="ra-role-row ${roleCounts[r]?'':'is-missing'}"><span title="${esc(roleLabel(r))}">${esc(roleLabel(r))}</span><div class="ra-role-bar"><i style="width:${entries.length?Math.min(100,roleCounts[r]/entries.length*100):0}%"></i></div><strong>${roleCounts[r]}</strong></div>`).join(''):'<p class="ra-muted">No competitive roles have been assigned by the commissioner yet.</p>';
    const sourceLabel=plannedCount?`${actualCount} drafted + ${plannedCount} planned`:`${actualCount} drafted`;
    return `<section class="roster-analysis" aria-label="Team Analysis">
      <div class="ra-head"><div><span class="ra-kicker">TEAM ANALYSIS</span><h2>${esc(opts.heading||'Team Analysis')}</h2><p>${esc(team)} · ${entries.length} Pokémon · ${sourceLabel}</p></div><div class="ra-score"><strong>${covered}<span>/18</span></strong><small>Types covered</small></div></div>
      <div class="ra-projection-key"><div class="ra-colour-setting"><button type="button" class="ra-colour-control" data-status-colour="actual" aria-expanded="false" aria-label="Choose Drafted colour"><i class="ra-key-dot actual"></i>Drafted <span class="ra-colour-chevron">▾</span></button><div class="ra-colour-picker" data-colour-picker="actual" hidden>${PALETTE.map(([value,label])=>`<button type="button" class="ra-swatch ${value}" data-status-colour-choice="actual" data-colour="${value}" aria-label="${label} drafted colour" title="${label}"><span></span>${label}</button>`).join('')}</div></div>${plannedCount?`<div class="ra-colour-setting"><button type="button" class="ra-colour-control" data-status-colour="planned" aria-expanded="false" aria-label="Choose Planned pick colour"><i class="ra-key-dot planned"></i>Planned pick <span class="ra-colour-chevron">▾</span></button><div class="ra-colour-picker" data-colour-picker="planned" hidden>${PALETTE.map(([value,label])=>`<button type="button" class="ra-swatch ${value}" data-status-colour-choice="planned" data-colour="${value}" aria-label="${label} planned colour" title="${label}"><span></span>${label}</button>`).join('')}</div></div>`:''}<span class="ra-projection-note">${plannedCount?'Projection includes your remaining draft plan.':'Based on your current roster.'}</span></div>
      <div class="ra-metrics">
        <div class="ra-metric"><span>Type coverage</span><strong>${covered} / 18</strong><div class="ra-track"><i style="width:${covered/18*100}%"></i></div><small>${missing.length?`${missing.length} types not represented`:'Every type represented'}</small></div>
        <div class="ra-metric"><span>Role coverage</span><strong>${roleCovered} / ${roles.length||0}</strong><div class="ra-track"><i style="width:${roles.length?roleCovered/roles.length*100:0}%"></i></div><small>${missingRoles.length?`${missingRoles.length} roles missing`:'All catalogue roles represented'}</small></div>
        <div class="ra-metric"><span>${plannedCount?'Projected Roster':'Roster Size'}</span><strong>${entries.length}</strong><div class="ra-depth-dots">${Array.from({length:Math.min(entries.length,12)},()=>'<i></i>').join('')}</div><small>${plannedCount?`${actualCount} drafted · ${plannedCount} planned`:`${actualCount} Pokémon drafted`}</small></div>
      </div>
      <div class="ra-columns">
        <section class="ra-block"><div class="ra-block-head"><div><span class="ra-kicker">DEFENSIVE & OFFENSIVE SPREAD</span><h3>Type coverage</h3></div><span class="ra-count">${covered}/18</span></div><div class="ra-type-grid">${TYPES.map(t=>`<div class="ra-type ${typeCounts[t.toLowerCase()]?'is-covered':'is-missing'}"><span class="type-badge type-${t.toLowerCase()}">${t}</span><strong>${typeCounts[t.toLowerCase()]}</strong><small>${typeCounts[t.toLowerCase()]?'represented':'not represented'}</small></div>`).join('')}</div>
        <div class="ra-insight ${missing.length?'ra-warning':'ra-good'}"><strong>${missing.length?'Type coverage gaps':'Full type spread'}</strong><span>${missing.length?`No Pokémon in this ${plannedCount?'projection':'roster'} represent ${missing.join(', ')}.`:`Your ${plannedCount?'projected roster':'roster'} represents every type.`}</span></div></section>
        <section class="ra-block"><div class="ra-block-head"><div><span class="ra-kicker">BATTLEFIELD JOBS</span><h3>Competitive role coverage</h3></div><span class="ra-count">${roleCovered}/${roles.length}</span></div>
          <div class="ra-role-list">${rolesMarkup}</div>
          <div class="ra-insight ${missingRoles.length||unassigned?'ra-warning':'ra-good'}"><strong>${missingRoles.length?`${missingRoles.length} roles not covered`:unassigned?`${unassigned} Pokémon unassigned`:'Role coverage represented'}</strong><span>${missingRoles.length?`Your ${plannedCount?'projected team':'team'} has no assigned ${missingRoles.slice(0,5).map(roleLabel).join(', ')}${missingRoles.length>5?' and other':''}.`:unassigned?'Some Pokémon have no commissioner-assigned roles yet.':`Every catalogue role appears at least once in this ${plannedCount?'projection':'roster'}.`}</span></div></section>
      </div>
      <section class="ra-insight-grid"><div class="ra-insight ${repeatedRoles.length||multiRoleCount?'ra-good':'ra-warning'}"><strong>Role strengths</strong><span>${repeatedRoles.length?`Repeated coverage: ${repeatedRoles.slice(0,4).map(r=>`${roleLabel(r)} ×${roleCounts[r]}`).join(', ')}.`:multiRoleCount?`${multiRoleCount} Pokémon provide more than one assigned role.`:'No repeated role coverage yet; consider adding complementary role options.'}</span></div><div class="ra-insight ${concentratedTypes.length?'ra-warning':'ra-good'}"><strong>Type concentration</strong><span>${concentratedTypes.length?`Three or more roster members share: ${concentratedTypes.map(t=>`${t} (${typeCounts[t.toLowerCase()]})`).join(', ')}.`:'No single type appears on three or more roster members.'}</span></div></section>
      <section class="ra-roster"><div class="ra-block-head"><div><span class="ra-kicker">PLAYER-BY-PLAYER BREAKDOWN</span><h3>${plannedCount?'Projected Roster':'Roster Breakdown'}</h3></div><span class="ra-count">${entries.length} Pokémon</span></div>
        <div class="ra-filters"><input type="search" class="ra-search" placeholder="Search Pokémon…" aria-label="Search roster Pokémon"><select class="ra-type-filter" aria-label="Filter by type"><option value="">All types</option>${TYPES.map(t=>`<option value="${t.toLowerCase()}">${t}</option>`).join('')}</select><select class="ra-role-filter" aria-label="Filter by role"><option value="">All roles</option>${roles.map(r=>`<option value="${esc(roleLabel(r).toLowerCase())}">${esc(roleLabel(r))}</option>`).join('')}</select><select class="ra-status-filter" aria-label="Filter by roster status"><option value="">${plannedCount?'Drafted + planned':'All drafted'}</option><option value="actual">Drafted only</option>${plannedCount?'<option value="planned">Planned only</option>':''}</select><span class="ra-filter-count">${entries.length} shown</span></div>
        <div class="ra-mon-grid">${mons||`<div class="ra-empty">${plannedCount?'No Pokémon to analyse yet. Add picks to your draft plan to see a projection.':'No drafted Pokémon to analyse yet.'}</div>`}</div>
      </section><footer class="ra-credit">Competitive roles are assigned by your league commissioner. Role names are displayed in player-friendly format.</footer>
    </section>`;
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
  window.SBL.rosterAnalysis={render,bind,roleLabel,uniqueRoles};
})();
