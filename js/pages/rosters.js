/*
 * SBL ROSTERS PAGE
 *
 * Page controller extracted from rosters.html during Phase 6G.
 * Rendering stays page-specific; Supabase/configuration stays in the shared layer.
 */
(function () {
  'use strict';


  const content = document.getElementById('content');
  const toolbar = document.getElementById('toolbar');
  const rosterSelect = document.getElementById('rosterSelect');
  const rosterSummary = document.getElementById('rosterSummary');
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  // Remove an accidental top-level single-letter text node without touching real page content.
  document.body.childNodes.forEach(node => {
    if(node.nodeType === Node.TEXT_NODE && node.textContent.trim() === 'n') node.remove();
  });

  // Rosters deliberately reuse the same data/name/sprite pipeline as Free Agency.
  // This keeps roster display and FA display on one canonical representation.
  function canonicalName(name){
    return SBL.pokemon?.displayNameWithForm ? SBL.pokemon.displayNameWithForm(name) : String(name ?? '').trim();
  }
  function sprite(name){
      // Rosters uses an explicit sprite map for the few form/typo names that
      // have historically differed between roster data and Free Agency. This
      // deliberately bypasses the generic form resolver for these entries.
      const raw=String(name??'').trim().toLowerCase().replace(/[’']/g,'').replace(/\s+/g,'-');
      const explicit={
        'terapagos':'terapagos','terapogos':'terapagos','terapagos-middle':'terapagos','terapagos-mid':'terapagos',
        'thundurus-i':'thundurus','thundurus-incarnate':'thundurus','thunduurs-i':'thundurus','thundurs-i':'thundurus','thundurs':'thundurus',
        'tauros-blaze':'tauros-paldeablaze','taurus-blaze':'tauros-paldeablaze','tauros-paldea-blaze':'tauros-paldeablaze',
        'tauros-combat':'tauros-paldeacombat','taurus-combat':'tauros-paldeacombat','tauros-paldea-combat':'tauros-paldeacombat',
        'meowstic-male':'meowstic','meowstic-m':'meowstic',
        'cincinno':'cinccino','cinccinno':'cinccino','daschbun':'dachsbun'
      };
      const file=explicit[raw];
      if(file){
        const label=SBL.pokemon?.displayNameWithForm ? SBL.pokemon.displayNameWithForm(name) : String(name??'').trim();
        const safe=esc(label);
        const fallback=(file==='tauros-paldeablaze'||file==='tauros-paldeacombat')?'tauros':(file==='thundurus'?'thundurus':'');
        const fallbackAttr=fallback ? ` data-sbl-fallback=\"https://play.pokemonshowdown.com/sprites/home/${fallback}.png\"` : '';
        return `<img class=\"sprite sbl-remote-sprite\" src=\"https://play.pokemonshowdown.com/sprites/home/${file}.png\" alt=\"${safe}\" title=\"${safe}\" width=\"96\" height=\"96\" decoding=\"async\"${fallbackAttr} onerror=\"if(this.dataset.sblFallback&&!this.dataset.sblTried){this.dataset.sblTried='1';this.src=this.dataset.sblFallback}else{this.style.display='none'}\">`;
      }
      return SBL.pokemon.spriteMarkup(name, 'sprite');
    }

  const FALLBACK_BUDGET = 115;
  let DRAFT_BUDGETS = {defaultBudget: FALLBACK_BUDGET, budgets: {}};
  function teamBudget(team){
    const override = DRAFT_BUDGETS.budgets?.[team];
    return Number.isFinite(Number(override)) ? Number(override) : (Number(DRAFT_BUDGETS.defaultBudget) || FALLBACK_BUDGET);
  }
  function rosterPoints(list){
    return (Array.isArray(list) ? list : []).reduce((sum, mon) => {
      const points = Number(mon?.points);
      return sum + (Number.isFinite(points) ? points : 0);
    }, 0);
  }
  function budgetMarkup(team, list){
    const spent = rosterPoints(list);
    const remaining = teamBudget(team) - spent;
    const cls = remaining < 0 ? 'negative' : 'good';
    return `<div class="budget-wrap"><div class="budget-label">Budget remaining</div><div class="budget-value ${cls}">${remaining} pts</div></div>`;
  }
  function renderPokemon(team, mon){
    const name = canonicalName(mon?.name);
    const points = mon?.points == null || mon?.points === '' ? '' : `<div class="mon-points">${esc(mon.points)} pts</div>`;
    return `<div class="mon">${sprite(name)}<div class="mon-info"><div class="mon-name">${esc(name)}</div><div class="mon-team">${esc(team)}</div>${points}</div></div>`;
  }
  function showError(message){ content.innerHTML = `<div class="empty">${esc(message)}</div>`; }

  async function withTimeout(promise, ms, label){
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out. Check that Supabase is reachable and try refreshing.')), ms); });
    try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
  }

  async function loadRosters(){
    try{
      if(!window.supabase || !window.SBL?.freeAgency?.load) throw new Error('The shared roster/Free Agency services did not load.');
      const supabase = window.SBL.getSupabase();

      // Keep the same access rule as before, but do not use it for data loading.
      const {data:{session}} = await supabase.auth.getSession();
      if(!session){ location.replace('index.html'); return; }
      const {data:gateProfile, error:gateErr} = await supabase.from('profiles').select('team_name').eq('id', session.user.id).maybeSingle();
      if(gateErr || !gateProfile?.team_name){ location.replace('index.html'); return; }

      const result = await withTimeout(SBL.freeAgency.load(supabase), 10000, 'Loading the roster data');
      let rosters = result?.rosters || {};
      const settings = result?.settings || {};
      const draftSettings = settings?.draft;
      if(draftSettings && typeof draftSettings === 'object'){
        DRAFT_BUDGETS = {
          defaultBudget: Number(draftSettings.defaultBudget) || FALLBACK_BUDGET,
          budgets: (draftSettings.budgets && typeof draftSettings.budgets === 'object') ? draftSettings.budgets : {}
        };
      }

      const teams = Object.keys(rosters).sort((a,b)=>a.localeCompare(b));
      if(!teams.length){ content.innerHTML = '<div class="empty">No rosters have been uploaded yet.</div>'; return; }

      document.getElementById('app').style.display = '';
      toolbar.style.display = '';
      rosterSelect.innerHTML = ['<option value="__all__">All rosters</option>', ...teams.map(team => `<option value="${esc(team)}">${esc(team)}</option>`)].join('');

      function renderSelection(team){
        const selectedTeams = team === '__all__' ? teams : [team];
        const totalMons = selectedTeams.reduce((sum, name) => sum + (rosters[name]?.length || 0), 0);
        rosterSummary.textContent = team === '__all__' ? `${teams.length} franchises · ${totalMons} Pokémon` : `${rosters[team]?.length || 0} Pokémon · ${rosterPoints(rosters[team])} pts spent`;
        content.innerHTML = `<div class="grid${team === '__all__' ? '' : ' single'}">${selectedTeams.map(name => `
          <section class="card">
            <div class="head"><div><h2>${esc(name)}</h2><span class="count">${rosters[name].length} Pokémon</span></div>${budgetMarkup(name, rosters[name])}</div>
            <div class="mons">${rosters[name].map(mon => renderPokemon(name, mon)).join('')}</div>
          </section>`).join('')}</div>`;
      }

      rosterSelect.onchange = () => renderSelection(rosterSelect.value);
      renderSelection('__all__');
    }catch(err){
      console.error('Roster load failed:', err);
      showError(`Could not load rosters: ${err?.message || err}`);
    }
  }

  const hardTimeout = setTimeout(() => { if(content.textContent.includes('Loading rosters')) showError('Roster loading is taking too long. Please refresh the page.'); }, 12000);
  loadRosters().finally(() => clearTimeout(hardTimeout));
})();
