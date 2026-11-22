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

  // CP4.63: team colours, owner usernames and the roster pop-out.
  let TEAM_SETTINGS = {}, TEAM_MAP = {}, TEAM_ROSTERS = {};
  function ownerTag(team){ const o = SBL.teamColors?.ownerLabel?.(TEAM_MAP, team); return o ? `<span class="owner-tag">@${esc(o)}</span>` : ''; }
  function teamTintClass(settings,team){ return SBL.teamColors?.get?.(settings,team) ? ' team-tinted' : ''; }
  function teamTintStyle(settings,team){ return SBL.teamColors?.styleAttr?.(settings,team) || ''; }
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
  function showError(message){
    const app=document.getElementById('app');
    if(app) app.style.display='';
    if(toolbar) toolbar.style.display='none';
    content.innerHTML = `<div class="empty">${esc(message)}</div>`;
  }

  function emptyRosterMessage(snapshot, settings){
    const draftStatus=String(settings?.draft?.status||'').trim().toLowerCase();
    const seasonName=String(snapshot?.name||settings?.activeSeason||'this season');
    if(['setup','lobby','live'].includes(draftStatus)){
      return `<section class="roster-empty-state" role="status" aria-live="polite">
        <div class="roster-empty-kicker">ROSTERS PENDING</div>
        <h2>Awaiting published rosters</h2>
        <p>The ${esc(seasonName)} draft has not been completed yet. Franchise rosters will appear here once the draft is finished and the results have been published.</p>
      </section>`;
    }
    return `<div class="empty">No published rosters are available for ${esc(seasonName)} yet.</div>`;
  }

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
      const leagueId = SBL.leagueDb?.selectedLeagueId?.() || '';
      if(!leagueId){ location.replace('index.html'); return; }

      // Rosters are a league-wide read-only view, not a page that requires
      // the visitor to own a franchise. This matters at season start, when
      // active members may not yet have an assignment.
      const membership = await SBL.leagueDb?.getMembership?.(leagueId, session.user.id, supabase);
      if(!membership || String(membership.status||'').toLowerCase()!=='active'){
        location.replace('index.html');
        return;
      }

      // Reveal the page before loading data so an intentionally empty
      // pre-draft season can show an explanatory state instead of a blank page.
      document.getElementById('app').style.display = '';

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

      TEAM_SETTINGS = settings; TEAM_MAP = result?.state?.teamMap || {}; TEAM_ROSTERS = rosters;
      SBL.teamPopup?.bind(document, () => ({settings: TEAM_SETTINGS, teamMap: TEAM_MAP, rosters: TEAM_ROSTERS}));
      const teams = Object.keys(rosters).sort((a,b)=>a.localeCompare(b));
      const draftStatus=String(settings?.draft?.status||'').trim().toLowerCase();
      if(!teams.length){
        content.innerHTML = emptyRosterMessage(result?.snapshot, settings);
        return;
      }

      // Franchise directory: roster contents remain out of sight until a tile is opened.
      // Reuse the shared, keyboard-accessible roster dialog; no Team Analysis here.
      if(toolbar) toolbar.style.display='none';
      const draftNotice = ['setup','lobby','live'].includes(draftStatus)
        ? `<div class="roster-draft-notice" role="status"><strong>Draft ${draftStatus==='live'?'in progress':'not yet complete'}:</strong> Rosters may still change.</div>` : '';
      // Signature pick is the first officially selected Pokémon for the franchise.
      // If the draft order is not available, show the highest-point published
      // roster entry as a clearly-presented fallback; never invent a Pokémon.
      const recordedPicks=Array.isArray(draftSettings?.picks)?draftSettings.picks:[];
      const teamKey=value=>String(value||'').trim().toLowerCase();
      const signatureFor=team=>{
        const members=Array.isArray(rosters[team])?rosters[team]:[];
        if(!members.length)return null;
        const picked=recordedPicks.filter(p=>teamKey(p.team||p.franchise||p.franchiseName)===teamKey(team))
          .sort((a,b)=>(Number(a.pickNumber)||999999)-(Number(b.pickNumber)||999999));
        for(const p of picked){
          const found=members.find(m=>SBL.pokemon?.sameSpeciesForm?.(m?.name,p?.name) || teamKey(m?.name)===teamKey(p?.name));
          if(found)return found;
        }
        return members.slice().sort((a,b)=>(Number(b?.points)||0)-(Number(a?.points)||0))[0];
      };
      content.innerHTML=`${draftNotice}<div class="roster-directory-intro"><h1>Franchises</h1><span>${teams.length} teams</span></div><div class="roster-franchise-grid">${teams.map(name=>{
        const signature=signatureFor(name);
        return `<button type="button" class="roster-franchise-tile${teamTintClass(settings,name)}"${teamTintStyle(settings,name)} data-team-popup="${esc(name)}" aria-label="Open ${esc(name)} roster">
          <span class="roster-franchise-name">${esc(name)}</span>
          <span class="roster-franchise-signature-art" aria-hidden="true">${signature?sprite(signature.name):'<span class="roster-franchise-empty-mark">?</span>'}</span>
          <span class="roster-franchise-signature-name">${signature?esc(canonicalName(signature.name)):'Awaiting draft'}</span>
        </button>`;
      }).join('')}</div>`;
    }catch(err){
      console.error('Roster load failed:', err);
      showError(`Could not load rosters: ${err?.message || err}`);
    }
  }

  const hardTimeout = setTimeout(() => { if(content.textContent.includes('Loading rosters')) showError('Roster loading is taking too long. Please refresh the page.'); }, 12000);
  loadRosters().finally(() => clearTimeout(hardTimeout));
})();
