/*
 * SBL ROSTERS PAGE
 *
 * Page controller extracted from rosters.html during Phase 6G.
 * Rendering stays page-specific; Supabase/configuration stays in the shared layer.
 */
(function () {
  'use strict';


  const content = document.getElementById('content');
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
  function sprite(name){ return SBL.pokemon.spriteMarkup(name, 'sprite'); }

  // CP4.63: team colours, owner usernames and the roster pop-out.
  let TEAM_SETTINGS = {}, TEAM_MAP = {}, TEAM_ROSTERS = {}, TEAM_FRANCHISES = [], TEAM_ACTIVE_ASSIGNMENTS = [], TEAM_SIGNATURE_BY_FRANCHISE = new Map(), TEAM_OWNER_LABELS = {};
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
    content.innerHTML = `<div class="empty">${esc(message)}</div>`;
  }

  function teamKey(value){return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');}
  function conferenceInfo(team, settings=TEAM_SETTINGS, directory=TEAM_FRANCHISES){
    const canonical=(directory||[]).find(row=>teamKey(row?.name)===teamKey(team));
    const legacy=settings?.franchises&&typeof settings.franchises==='object'
      ?Object.entries(settings.franchises).find(([name])=>teamKey(name)===teamKey(team))?.[1]:null;
    const definition=settings?.franchiseDefinitions&&typeof settings.franchiseDefinitions==='object'
      ?Object.entries(settings.franchiseDefinitions).find(([name])=>teamKey(name)===teamKey(team))?.[1]:null;
    const raw=String(canonical?.conference||legacy||definition?.conference||'').trim();
    if(!raw)return {key:'__unassigned',label:'Unassigned',assigned:false};
    const key=raw.toLowerCase();
    const names=settings?.conferenceNames&&typeof settings.conferenceNames==='object'?settings.conferenceNames:{};
    const configured=names[key]??names[raw]??'';
    const label=String(configured||((key==='a'||key==='b')?`Conference ${key.toUpperCase()}`:raw)).trim();
    return {key,label,assigned:true};
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
      // Franchise visibility is driven by canonical active ownership assignments,
      // not the franchise definition list or stale roster keys. Unassigned and
      // inactive definitions must never appear as participating teams.
      TEAM_ACTIVE_ASSIGNMENTS=await withTimeout(
        SBL.franchiseOwnership.listActiveMemberFranchises(leagueId,supabase),
        7000,'Loading active franchise assignments'
      );
      TEAM_FRANCHISES=[...new Map(TEAM_ACTIVE_ASSIGNMENTS.map(row=>[teamKey(row?.franchise?.name),row?.franchise]).filter(([key,row])=>key&&row)).values()];
      const activeUserIds=[...new Set(TEAM_ACTIVE_ASSIGNMENTS.map(row=>String(row?.userId||'')).filter(Boolean))];
      let profiles=[];
      try{
        if(activeUserIds.length&&SBL.profiles?.list)profiles=await withTimeout(SBL.profiles.list({userIds:activeUserIds,fields:'id,username'},supabase),7000,'Loading active franchise owners');
      }catch(error){console.warn('Active franchise usernames unavailable; roster cards will omit owner labels.',error);}
      const usernames=new Map((profiles||[]).map(row=>[String(row.id),String(row.username||'').trim()]));
      TEAM_MAP={};TEAM_OWNER_LABELS={};
      TEAM_ACTIVE_ASSIGNMENTS.forEach(row=>{
        const username=usernames.get(String(row.userId||''));
        const franchise=String(row?.franchise?.name||'').trim();
        if(username&&franchise){TEAM_MAP[username]=franchise;TEAM_OWNER_LABELS[franchise]=username;}
      });
      TEAM_SIGNATURE_BY_FRANCHISE=new Map();
      try{
        const preferences=await withTimeout(SBL.memberPreferences.list(leagueId,supabase),7000,'Loading signature picks');
        const byUser=new Map((preferences||[]).map(row=>[String(row.user_id),String(row.signature_pokemon||'').trim()]));
        TEAM_ACTIVE_ASSIGNMENTS.forEach(row=>{
          const selected=byUser.get(String(row.userId||''));
          if(selected)TEAM_SIGNATURE_BY_FRANCHISE.set(teamKey(row.franchise?.name),selected);
        });
      }catch(error){console.warn('Member signature preferences unavailable; using automatic signature picks.',error);}
      const draftSettings = settings?.draft;
      if(draftSettings && typeof draftSettings === 'object'){
        DRAFT_BUDGETS = {
          defaultBudget: Number(draftSettings.defaultBudget) || FALLBACK_BUDGET,
          budgets: (draftSettings.budgets && typeof draftSettings.budgets === 'object') ? draftSettings.budgets : {}
        };
      }

      TEAM_SETTINGS = settings; TEAM_ROSTERS = rosters;
      // History is deliberately lazy: visiting Rosters loads no replay corpus.
      // The first Pokémon click uses the season-scoped replay service once;
      // subsequent selections reuse the same in-page promise and data.
      // Profile statistics are fetched lazily only on a Pokémon click. The
      // shared Pokémon Profile renders the same data view as Match Prep.
      let profileReplaysPromise=null;
      const getPokemonProfile=async(team,species)=>{
        if(!profileReplaysPromise){
          profileReplaysPromise=(async()=>{
            const payload=await SBL.replays.load(supabase);
            if(payload.error)throw payload.error;
            const part=SBL.replays.partition(payload.data);
            const snap=SBL.seasons.getSnapshot(part.sharedState||{});
            return {rows:Object.values(snap.archived&&!part.normalizedSeason?snap.replays:part.replays),state:part.sharedState||{}};
          })().catch(error=>{profileReplaysPromise=null;throw error;});
        }
        const {rows,state}=await profileReplaysPromise;
        return SBL.stats.franchisePokemonStat(TEAM_ROSTERS,rows,username=>SBL.domain.replayTeamLabel(state,username),team,species);
      };
      SBL.teamPopup?.bind(document, () => ({settings: TEAM_SETTINGS, teamMap: TEAM_MAP, rosters: TEAM_ROSTERS,
        franchises: TEAM_FRANCHISES, getPokemonProfile}));
      const teams=[...new Map(TEAM_ACTIVE_ASSIGNMENTS.map(row=>{
        const name=String(row?.franchise?.name||'').trim();return [teamKey(name),name];
      }).filter(([key,name])=>key&&name)).values()].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
      const draftStatus=String(settings?.draft?.status||'').trim().toLowerCase();
      if(!teams.length){
        content.innerHTML = `<section class="roster-empty-state"><div class="roster-empty-kicker">FRANCHISE DIRECTORY</div><h2>No active franchises</h2><p>Only franchises with an active player assignment appear here. Once a coach is approved and assigned, their franchise will appear automatically.</p></section>`;
        return;
      }

      // Franchise contents remain hidden until a tile is opened. Conference
      // assignment comes from the league-scoped franchises table, with the
      // saved settings map retained only as a compatibility fallback.
      const draftNotice = ['setup','lobby','live'].includes(draftStatus)
        ? `<div class="roster-draft-notice" role="status"><strong>Draft ${draftStatus==='live'?'in progress':'not yet complete'}:</strong> Rosters may still change.</div>` : '';
      const recordedPicks=Array.isArray(draftSettings?.picks)?draftSettings.picks:[];
      const rosterForFranchise=team=>{
        const entry=Object.entries(rosters).find(([name])=>teamKey(name)===teamKey(team));
        return Array.isArray(entry?.[1])?entry[1]:[];
      };
      const exportAllRosters=()=>{
        if(!SBL.leagueExports?.downloadAllRosters)throw new Error('The shared roster exporter is not loaded.');
        SBL.leagueExports.downloadAllRosters({
          settings,rosters,franchises:TEAM_FRANCHISES,activeFranchises:teams,
          ownerLabels:TEAM_OWNER_LABELS,teamMap:TEAM_MAP
        });
        const status=content.querySelector('#rosterExportStatus');
        if(status)status.textContent=`Exported ${teams.length} active franchises and ${teams.reduce((n,team)=>n+rosterForFranchise(team).length,0)} Pokémon.`;
      };
      const signatureFor=team=>{
        const members=rosterForFranchise(team);
        if(!members.length)return null;
        const coachChoice=TEAM_SIGNATURE_BY_FRANCHISE.get(teamKey(team));
        if(coachChoice){
          const chosen=members.find(mon=>SBL.pokemon?.sameSpeciesForm?.(mon?.name,coachChoice)||teamKey(mon?.name)===teamKey(coachChoice));
          if(chosen)return {mon:chosen,label:'Coach-selected pick'};
        }
        const picked=recordedPicks.filter(p=>teamKey(p.team||p.franchise||p.franchiseName)===teamKey(team))
          .sort((a,b)=>(Number(a.pickNumber)||999999)-(Number(b.pickNumber)||999999));
        for(const pick of picked){
          const found=members.find(m=>SBL.pokemon?.sameSpeciesForm?.(m?.name,pick?.name) || teamKey(m?.name)===teamKey(pick?.name));
          if(found)return {mon:found,label:'Signature pick'};
        }
        const fallback=members.slice().sort((a,b)=>(Number(b?.points)||0)-(Number(a?.points)||0))[0];
        return fallback?{mon:fallback,label:'Highest-point pick'}:null;
      };
      const conferenceRows=[...new Map(teams.map(team=>{
        const info=conferenceInfo(team,settings,TEAM_FRANCHISES);return [info.key,info];
      }))].map(([key,info])=>({key,...info}));
      const conferenceOrder=Object.keys(settings?.conferenceNames||{}).map(key=>String(key).toLowerCase());
      conferenceRows.sort((a,b)=>{
        const ai=conferenceOrder.indexOf(a.key),bi=conferenceOrder.indexOf(b.key);
        if(ai>=0||bi>=0)return (ai<0?999:ai)-(bi<0?999:bi)||a.label.localeCompare(b.label);
        if(a.key==='__unassigned')return 1;if(b.key==='__unassigned')return -1;
        return a.label.localeCompare(b.label);
      });
      const options=conferenceRows.map(row=>`<option value="${esc(row.key)}">${esc(row.label)}</option>`).join('');
      content.innerHTML=`<div class="roster-page">
        <header class="roster-directory-intro"><div><span class="roster-page-kicker">LEAGUE DIRECTORY</span><h1>Franchises</h1><p>Browse franchise rosters by conference.</p></div><div class="roster-directory-actions"><span class="roster-total-count" id="rosterTotalCount">${teams.length} franchises</span><button type="button" class="primary roster-export-button" id="exportAllRosters">Export All Rosters (.xlsx)</button><span class="roster-export-status" id="rosterExportStatus" role="status"></span></div></header>
        ${draftNotice}
        <div class="roster-toolbar" role="search" aria-label="Filter franchises">
          <div class="roster-filter-field roster-search-field"><label for="rosterSearch">Search franchises</label><input id="rosterSearch" type="search" placeholder="Search by team name..." autocomplete="off"></div>
          <div class="roster-filter-field"><label for="rosterConferenceFilter">Conference</label><select id="rosterConferenceFilter"><option value="all">All conferences</option>${options}</select></div>
          <div class="roster-summary" id="rosterSummary" aria-live="polite">Showing ${teams.length} of ${teams.length} franchises</div>
        </div>
        <div id="rosterDirectoryGroups" class="roster-directory-groups"></div>
      </div>`;
      const renderDirectory=()=>{
        const search=String(content.querySelector('#rosterSearch')?.value||'').trim().toLowerCase();
        const selected=String(content.querySelector('#rosterConferenceFilter')?.value||'all');
        const filtered=teams.filter(name=>{
          const info=conferenceInfo(name,settings,TEAM_FRANCHISES);
          const signature=signatureFor(name)?.mon;
          const matchesConference=selected==='all'||info.key===selected;
          const matchesSearch=!search||name.toLowerCase().includes(search)||String(signature?.name||'').toLowerCase().includes(search);
          return matchesConference&&matchesSearch;
        });
        const groups=conferenceRows.filter(row=>selected==='all'||row.key===selected)
          .map(row=>({key:row.key,label:row.label,teams:filtered.filter(name=>conferenceInfo(name,settings,TEAM_FRANCHISES).key===row.key).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}))}))
          .filter(row=>row.teams.length);
        const groupMarkup=groups.map(group=>`<section class="roster-conference-section" aria-labelledby="rosterGroup-${esc(group.key)}">
          <div class="roster-conference-heading"><h2 id="rosterGroup-${esc(group.key)}">${esc(group.label)}</h2><span>${group.teams.length} ${group.teams.length===1?'franchise':'franchises'}</span></div>
          <div class="roster-franchise-grid">${group.teams.map(name=>{
            const members=rosterForFranchise(name);
            const signature=signatureFor(name);
            const info=conferenceInfo(name,settings,TEAM_FRANCHISES);
            const spent=rosterPoints(members);
            const signatureArt=signature?sprite(signature.mon.name):'<span class="roster-franchise-empty-mark">+</span>';
            const signatureCopy=signature?`<small>${esc(signature.label)}</small><strong>${esc(canonicalName(signature.mon.name))}</strong><span>${members.length} Pokémon · ${spent} pts</span>`:'<small>Roster status</small><strong>Awaiting draft</strong><span>No published picks yet</span>';
            return `<button type="button" class="roster-franchise-tile${teamTintClass(settings,name)}"${teamTintStyle(settings,name)} data-team-popup="${esc(name)}" aria-label="Open ${esc(name)} roster">
              <span class="roster-franchise-card-top"><strong class="roster-franchise-name">${esc(name)}</strong><span class="roster-conference-pill">${esc(info.label)}</span></span>
              <span class="roster-franchise-card-body"><span class="roster-franchise-signature-art sbl-signature-sprite-frame" aria-hidden="true">${signatureArt}</span><span class="roster-franchise-signature-copy">${signatureCopy}</span><span class="roster-franchise-card-arrow" aria-hidden="true">›</span></span>
              ${ownerTag(name)}
            </button>`;
          }).join('')}</div>
        </section>`).join('');
        const groupsHost=content.querySelector('#rosterDirectoryGroups');
        if(groupsHost)groupsHost.innerHTML=groupMarkup||'<div class="roster-filter-empty">No franchises match these filters.</div>';
        const summary=content.querySelector('#rosterSummary');
        if(summary)summary.textContent=`Showing ${filtered.length} of ${teams.length} franchises`;
        const total=content.querySelector('#rosterTotalCount');
        if(total)total.textContent=`${filtered.length} of ${teams.length} franchises`;
      };
      content.querySelector('#rosterSearch')?.addEventListener('input',renderDirectory);
      content.querySelector('#rosterConferenceFilter')?.addEventListener('change',renderDirectory);
      content.querySelector('#exportAllRosters')?.addEventListener('click',()=>{try{exportAllRosters();}catch(error){const status=content.querySelector('#rosterExportStatus');if(status)status.textContent=`Could not export rosters: ${error?.message||error}`;}});
      renderDirectory();
    }catch(err){
      console.error('Roster load failed:', err);
      showError(`Could not load rosters: ${err?.message || err}`);
    }
  }

  const hardTimeout = setTimeout(() => { if(content.textContent.includes('Loading rosters')) showError('Roster loading is taking too long. Please refresh the page.'); }, 12000);
  loadRosters().finally(() => clearTimeout(hardTimeout));
})();
