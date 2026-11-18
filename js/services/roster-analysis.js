/* Shared Team Analysis renderer. Supports actual + planned roster projections. */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  const TYPES=['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
  const esc=s=>String(s??'').replace(/[&<>\'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  function roleLabel(value){
    const raw=String(value??'').trim();
    if(!raw)return '';
    return raw.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[._-]+/g,' ').replace(/\s+/g,' ').trim().replace(/\b\w/g,c=>c.toUpperCase());
  }
  function render(opts){
    opts=opts||{};
    const team=opts.team||'Roster';
    const entries=(opts.entries||[]).map(m=>({name:String(m.name||''),types:Array.isArray(m.types)&&m.types.length?m.types:(window.SBL.pokemonTypes?.lookupTypes(m.name)||[]),roles:Array.isArray(m.roles)?m.roles:[],abilities:Array.isArray(m.abilities)?m.abilities:[],status:m.status==='planned'?'planned':'actual'})).filter(m=>m.name);
    const roles=[...new Set([...(opts.roles||[]),...entries.flatMap(m=>m.roles)])].sort((a,b)=>roleLabel(a).localeCompare(roleLabel(b)));
    const typeCounts=Object.fromEntries(TYPES.map(t=>[t.toLowerCase(),0]));
    entries.forEach(m=>m.types.forEach(t=>{const k=String(t).toLowerCase();if(k in typeCounts)typeCounts[k]++;}));
    const roleCounts=Object.fromEntries(roles.map(r=>[r,0]));
    entries.forEach(m=>m.roles.forEach(r=>{if(r in roleCounts)roleCounts[r]++;}));
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
      return `<article class="ra-mon ${m.status==='planned'?'is-planned':'is-actual'}" data-name="${name.toLowerCase()}" data-types="${esc(types.join('|'))}" data-roles="${esc(rs.join('|').toLowerCase())}">
        <div class="ra-mon-sprite">${opts.sprite?opts.sprite(m.name):''}</div>
        <div class="ra-mon-main"><div class="ra-mon-title"><strong>${name}</strong><span class="ra-status ${m.status==='planned'?'planned':'actual'}">${status}</span></div><div class="ra-mon-tags">${m.types.map(t=>`<span class="type-badge type-${esc(String(t).toLowerCase())}">${esc(t)}</span>`).join('')||'<span class="ra-muted">Types unavailable</span>'}</div>
        <div class="ra-role-tags">${rs.map(r=>`<span class="ra-role-tag">${esc(roleLabel(r))}</span>`).join('')||'<span class="ra-muted">No role assigned</span>'}</div>${abilities}</div></article>`;
    }).join('');
    const rolesMarkup=roles.length?roles.map(r=>`<div class="ra-role-row ${roleCounts[r]?'':'is-missing'}"><span title="${esc(roleLabel(r))}">${esc(roleLabel(r))}</span><div class="ra-role-bar"><i style="width:${entries.length?Math.min(100,roleCounts[r]/entries.length*100):0}%"></i></div><strong>${roleCounts[r]}</strong></div>`).join(''):'<p class="ra-muted">No competitive roles have been assigned by the commissioner yet.</p>';
    const sourceLabel=plannedCount?`${actualCount} drafted + ${plannedCount} planned`:`${actualCount} drafted`;
    return `<section class="roster-analysis" aria-label="Team Analysis">
      <div class="ra-head"><div><span class="ra-kicker">TEAM ANALYSIS</span><h2>${esc(opts.heading||'Team Analysis')}</h2><p>${esc(team)} · ${entries.length} Pokémon · ${sourceLabel}</p></div><div class="ra-score"><strong>${covered}<span>/18</span></strong><small>Types covered</small></div></div>
      <div class="ra-projection-key"><span><i class="ra-key-dot actual"></i>Drafted</span>${plannedCount?'<span><i class="ra-key-dot planned"></i>Planned pick</span>':''}<span class="ra-projection-note">${plannedCount?'Projection includes your remaining draft plan.':'Based on your current roster.'}</span></div>
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
        <div class="ra-filters"><input type="search" class="ra-search" placeholder="Search Pokémon…" aria-label="Search roster Pokémon"><select class="ra-type-filter" aria-label="Filter by type"><option value="">All types</option>${TYPES.map(t=>`<option value="${t.toLowerCase()}">${t}</option>`).join('')}</select><select class="ra-role-filter" aria-label="Filter by role"><option value="">All roles</option>${roles.map(r=>`<option value="${esc(r.toLowerCase())}">${esc(roleLabel(r))}</option>`).join('')}</select><select class="ra-status-filter" aria-label="Filter by roster status"><option value="">${plannedCount?'Drafted + planned':'All drafted'}</option><option value="actual">Drafted only</option>${plannedCount?'<option value="planned">Planned only</option>':''}</select><span class="ra-filter-count">${entries.length} shown</span></div>
        <div class="ra-mon-grid">${mons||`<div class="ra-empty">${plannedCount?'No Pokémon to analyse yet. Add picks to your draft plan to see a projection.':'No drafted Pokémon to analyse yet.'}</div>`}</div>
      </section><footer class="ra-credit">Competitive roles are assigned by your league commissioner. Role names are displayed in player-friendly format.</footer>
    </section>`;
  }
  function bind(root){
    if(!root||root.dataset.raBound==='1')return;root.dataset.raBound='1';
    root.addEventListener('input',e=>{if(e.target.matches('.ra-search'))filter(e.target.closest('.roster-analysis'));});
    root.addEventListener('change',e=>{if(e.target.matches('.ra-type-filter,.ra-role-filter,.ra-status-filter'))filter(e.target.closest('.roster-analysis'));});
  }
  function filter(panel){
    if(!panel)return;const q=(panel.querySelector('.ra-search')?.value||'').trim().toLowerCase(),type=panel.querySelector('.ra-type-filter')?.value||'',role=panel.querySelector('.ra-role-filter')?.value||'',status=panel.querySelector('.ra-status-filter')?.value||'';
    let n=0;panel.querySelectorAll('.ra-mon').forEach(card=>{const show=(!q||card.dataset.name.includes(q))&&(!type||card.dataset.types.split('|').includes(type))&&(!role||card.dataset.roles.split('|').includes(role))&&(!status||card.classList.contains(status==='planned'?'is-planned':'is-actual'));card.hidden=!show;if(show)n++;});
    const count=panel.querySelector('.ra-filter-count');if(count)count.textContent=`${n} shown`;
  }
  window.SBL.rosterAnalysis={render,bind,roleLabel};
})();
