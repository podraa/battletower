(function(){
  const SHARED = true; // league data shared with anyone viewing this dashboard (cloud mode only)
  let STATE = { replays:{}, teamMap:{}, settings:{ caseInsensitiveNames:true } };
  let loaded = false;

  // ---------- shared Supabase storage ----------
  // Admin and public dashboard use the same shared Supabase database.
  const SUPABASE_STATE_ID = '__dashboard_state__';
  const supabase = window.SBL.getSupabase();
  const IS_ADMIN_PAGE = true;
  // ---------- seasons ----------
  // Matches the DEFAULT_SEASON / seasonKey / seasonArchives contract that
  // index.html, stats.html, rosters.html, free-agency.html and
  // match-prep.html already read from (see installSeasonPicker there).
  // Admin is the only page that ever writes a season archive.
  const DEFAULT_SEASON = 'Season 15';
  function seasonKey(name){ return String(name||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'season'; }
  let adminUser = null;
  let adminIsCommissioner = false;

  // One page-level profile cache for user-facing names. The cache is keyed by
  // league so a league switch never reuses stale membership names.
  let LEAGUE_PROFILE_CACHE_LEAGUE = '';
  let LEAGUE_PROFILE_CACHE = new Map();
  let LEAGUE_PROFILE_CACHE_READY = false;

  async function loadLeagueProfileCache(leagueId, {refresh=false} = {}){
    const league = String(leagueId || '').trim();
    if(!league) return LEAGUE_PROFILE_CACHE;
    if(!refresh && LEAGUE_PROFILE_CACHE_READY && LEAGUE_PROFILE_CACHE_LEAGUE === league) return LEAGUE_PROFILE_CACHE;
    try{
      const {data,error} = await supabase.rpc('sbl_admin_list_league_users',{p_league_id:league});
      if(error) throw error;
      LEAGUE_PROFILE_CACHE_LEAGUE = league;
      LEAGUE_PROFILE_CACHE = new Map((data || []).map(p => [String(p.id), p]));
      LEAGUE_PROFILE_CACHE_READY = true;
    }catch(error){
      // Names are cosmetic. Never let a profile lookup failure prevent the
      // league/member UI from rendering; displayNameForUser() will return
      // "Unknown user" for uncached IDs.
      console.warn('League profile cache unavailable:', error);
      if(LEAGUE_PROFILE_CACHE_LEAGUE !== league){
        LEAGUE_PROFILE_CACHE_LEAGUE = league;
        LEAGUE_PROFILE_CACHE = new Map();
      }
      LEAGUE_PROFILE_CACHE_READY = true;
    }
    return LEAGUE_PROFILE_CACHE;
  }

  function hydrateLeagueProfileCache(leagueId, profiles){
    const league = String(leagueId || '').trim();
    if(!league) return;
    LEAGUE_PROFILE_CACHE_LEAGUE = league;
    LEAGUE_PROFILE_CACHE = new Map((profiles || []).map(p => [String(p.id), {id:p.id,username:p.username || ''}]));
    LEAGUE_PROFILE_CACHE_READY = true;
  }

  function displayNameForUser(userId){
    const id = String(userId || '').trim();
    if(!id) return 'Unknown user';
    const cached = LEAGUE_PROFILE_CACHE.get(id);
    return String(cached?.username || '').trim() || 'Unknown user';
  }

  let loadingFromRemote = false;
  let draftRemoteVersion = '';
  let draftSyncBusy = false;
  let adminDraftCfg = '';
  // Mock draft state is deliberately in-memory only; it never touches the live draft service.
  let MOCK_DRAFT_SESSION_ID = '';

  function requireAdmin(){
    if(!adminUser || !adminIsCommissioner) throw new Error('League admin access required.');
  }

  // ---------- Draft ----------
  // Draft state lives inside the same shared settings blob as rosters/free
  // agency (see saveSharedState). Nothing here creates new Supabase tables.
  function defaultDraftState(){
    return {
      status: 'setup',       // 'setup' | 'live' | 'complete'
      mode: 'manual',        // 'manual' | 'ordered'
      defaultBudget: 120,
      minPicks: 10,
      maxPicks: 10,
      budgets: {},            // per-franchise override: {teamName: number}
      pool: [],                // [{id,name,points,types,drafted,draftedBy,pickNumber}]
      authorizedPickerIds: [], // active league members allowed to make their own picks
      order: [],               // [teamName, teamName, ...] one entry per pick slot
      currentPick: 0,
      picks: [],                // [{poolId,name,points,team,pickNumber,ts}]
      // Snapshot of rosters immediately before this draft started. Used by
      // reset so a draft reset cannot leave drafted Pokémon behind.
      preDraftRosters: null,
      updatedAt: null
    };
  }

  function normalizeDraftState(draft){
    const d = Object.assign(defaultDraftState(), draft || {});
    d.budgets = d.budgets && typeof d.budgets === 'object' ? d.budgets : {};
    d.authorizedPickerIds = Array.isArray(d.authorizedPickerIds) ? [...new Set(d.authorizedPickerIds.map(String))] : [];
    d.pool = Array.isArray(d.pool) ? d.pool.map(m => ({
      id: String(m?.id ?? ''),
      name: (SBL.pokemon.displayNameWithForm ? SBL.pokemon.displayNameWithForm(String(m?.name ?? '').trim()) : SBL.pokemon.displayName(String(m?.name ?? '').trim())),
      points: Number(m?.points) || 0,
      isMega: !!m?.isMega,
      costTbd: !!m?.costTbd,
      types: Array.isArray(m?.types) ? m.types.map(t => String(t).trim()).filter(Boolean) : [],
      abilities: Array.isArray(m?.abilities) ? m.abilities.map(a=>String(a).trim()).filter(Boolean) : [],
      baseStats: m?.baseStats && typeof m.baseStats==='object' ? m.baseStats : (m?.stats && typeof m.stats==='object' ? m.stats : null),
      drafted: !!m?.drafted,
      draftedBy: m?.draftedBy || null,
      pickNumber: m?.pickNumber ?? null
    })).filter(m => m.id && m.name) : [];
    d.order = Array.isArray(d.order) ? d.order.map(String) : [];
    d.picks = Array.isArray(d.picks) ? d.picks : [];
    d.currentPick = Number.isFinite(Number(d.currentPick)) ? Number(d.currentPick) : 0;
    d.minPicks = Math.max(10, Number(d.minPicks) || 10);
    d.maxPicks = Math.max(d.minPicks, Number(d.maxPicks) || d.minPicks);
    if(!['setup','lobby','live','complete'].includes(d.status)) d.status = 'setup';
    if(d.mode !== 'ordered') d.mode = 'manual';
    return d;
  }

  async function loadState(){
     loadingFromRemote = true;
     try{
       const {data, error} = await SBL.replays.load(supabase);
       if(error) throw error;
       const {sharedState, replays} = SBL.replays.partition(data);
       STATE.replays = replays || {};
       STATE.teamMap = sharedState?.teamMap || {};
       STATE.settings = Object.assign(
         {caseInsensitiveNames:true, rosters:{}, franchises:{}, franchiseDefinitions:{}, conferenceNames:{a:'Conference A',b:'Conference B'}, leagues:{}, activeLeagueId:''},
         sharedState?.settings || {}
       );
       STATE.settings.rosters=STATE.settings.rosters||{};
       STATE.settings.franchises=STATE.settings.franchises||{};
       STATE.settings.franchiseDefinitions=(STATE.settings.franchiseDefinitions && typeof STATE.settings.franchiseDefinitions==='object') ? STATE.settings.franchiseDefinitions : {};
       STATE.settings.leagues=(STATE.settings.leagues && typeof STATE.settings.leagues==='object') ? STATE.settings.leagues : {};
       STATE.settings.activeLeagueId=STATE.settings.activeLeagueId || SBL.leagueDb?.selectedLeagueId?.() || ''; 
       Object.values(STATE.settings.leagues).forEach(l=>{ if(!Array.isArray(l.members)) l.members = null; });
       STATE.settings.conferenceNames=STATE.settings.conferenceNames||{a:'Conference A',b:'Conference B'};
       STATE.settings.draft = normalizeDraftState(STATE.settings.draft);
       STATE.settings.activeSeason = STATE.settings.activeSeason || DEFAULT_SEASON;
       STATE.settings.seasonArchives = (STATE.settings.seasonArchives && typeof STATE.settings.seasonArchives === 'object') ? STATE.settings.seasonArchives : {};
       STATE.settings.leagueUpdates = Array.isArray(STATE.settings.leagueUpdates) ? STATE.settings.leagueUpdates : [];
       STATE.settings.finals = SBL.finals.normalizeFinalsState(STATE.settings.finals);
       // The shared replay boundary now resolves the selected league + season.
       // Do not restore the top-level league.state here: that would overwrite the
       // season-scoped snapshot returned by SBL.replays.load().
       loaded = true;
     }catch(e){
       console.error('Supabase load failed:', e);
       STATE.replays = {};
       STATE.teamMap = {};
       STATE.settings = {caseInsensitiveNames:true, rosters:{}, franchises:{}, franchiseDefinitions:{}, conferenceNames:{a:'Conference A',b:'Conference B'}, leagues:{}, activeLeagueId:'', draft:defaultDraftState(), activeSeason:'', seasonArchives:{}, leagueUpdates:[], finals:SBL.finals.defaultFinalsState()};
       loaded = false;
       throw e;
     }finally{
       loadingFromRemote = false;
     }
   }

  async function saveReplays(){
     try { await SBL.replays.autoMapReplayUsernames?.(STATE); } catch(e) { console.warn('Automatic replay username mapping skipped:',e); }
     requireAdmin();
     const rows = Object.values(STATE.replays).map(r => ({
       replay_id: r.id,
       replay_data: r,
       updated_at: new Date().toISOString()
     }));
     if(rows.length) await SBL.replays.upsertRows(rows, supabase);
     await saveSharedState();
   }

  async function deleteReplayRemote(id){
     requireAdmin();
     await SBL.replays.deleteIds([id], supabase);
   }

  async function saveSharedState(options={}){
     requireAdmin();
     const context={
       leagueId:String(options.leagueId || SBL.leagueDb?.selectedLeagueId?.() || '').trim(),
       seasonId:String(options.seasonId || SBL.leagueDb?.selectedSeasonId?.(options.leagueId) || '').trim()
     };
     if(!context.leagueId) throw new Error('Select a league before saving shared state.');
     if(!context.seasonId) throw new Error('Select a season before saving shared state.');
     try{
       await SBL.replays.saveSharedState({teamMap:STATE.teamMap, settings:STATE.settings}, supabase, context);
     }catch(err){
       showAdminError('Could not save changes: ' + (err?.message || err));
       throw err;
     }
   }
  // Public rosters are kept in their own row because rosters.html reads
  // __rosters__ directly. Keeping this separate from dashboard state means
  // roster publishing cannot overwrite replay/team/settings data.
  async function savePublishedRosters(rosters,options={}){
     requireAdmin();
     const context={leagueId:String(options.leagueId || SBL.leagueDb?.selectedLeagueId?.() || '').trim(),seasonId:String(options.seasonId || SBL.leagueDb?.selectedSeasonId?.(options.leagueId) || '').trim()};
     await SBL.replays.savePublishedRosters(rosters, supabase, context);
   }
  async function saveTeamMap(){ await saveSharedState(); }
  async function saveSettings(){ await saveSharedState(); }

  // Fixture draft/publish writes are deliberately season-row scoped. They do
  // not call saveSharedState/saveState, whose compatibility path can activate
  // a season as a side effect of an ordinary save.
  async function saveFixture(fixture, source, setting='fixture', extraUpdates={}){
    requireAdmin();
    const normalize=value=>{
      if(!value || !Array.isArray(value.rounds)) return null;
      return {
        rounds:value.rounds.map((r,index)=>({
          week:String(r.week||`Week ${index+1}`).trim(),
          matches:(r.matches||[]).map(m=>({home:String(m.home||'').trim(),away:String(m.away||'').trim()}))
        })),
        source:source||value.source||'upload',
        generatedAt:value.generatedAt||new Date().toISOString()
      };
    };
    const leagueId=String(SBL.leagueDb?.selectedLeagueId?.()||'').trim();
    const seasonId=String(SBL.leagueDb?.selectedSeasonId?.(leagueId)||'').trim();
    if(!leagueId||!seasonId) throw new Error('Select a league and season before saving a fixture.');
    const updates={...extraUpdates,[setting]:normalize(fixture)};
    await SBL.fixtureWorkflow.persistSettings({
      settings:STATE.settings,
      updates,
      loadCurrent:()=>SBL.leagueDb.getSeasonContext(leagueId,supabase,{seasonId}),
      saveCurrent:payload=>SBL.leagueDb.saveSeasonState(leagueId,seasonId,payload,supabase),
      readCurrent:()=>SBL.leagueDb.getSeasonContext(leagueId,supabase,{seasonId}),
      invalidate:async()=>{try{SBL.replays?.invalidateCache?.();await SBL.performance?.invalidate?.('replays:all');}catch(cacheError){console.warn('Fixture saved and verified; cache invalidation was non-fatal:',cacheError);}}
    });
    return STATE.settings[setting];
  }

  async function deleteAllRemote(){
    requireAdmin();
    await SBL.replays.deleteAllExcept([SUPABASE_STATE_ID,'__rosters__'], supabase);
  }

  async function deleteRemoteRowsNotInState(){
     requireAdmin();
     const existing = await SBL.replays.listIds(supabase);
     const stale = (existing || []).map(r=>r.replay_id)
       .filter(id => id !== SUPABASE_STATE_ID && id !== '__rosters__' && !STATE.replays[id]);
     if(stale.length) await SBL.replays.deleteIds(stale, supabase);
   }

  // ---------- season archiving ----------
  // A season archive is a full snapshot of everything that's specific to a
  // season: the processed replays, the team map, and the season-scoped part
  // of settings (rosters, draft, free agency, franchises, trade credits,
  // week tracking). It's stored inside the shared settings blob itself, at
  // settings.seasonArchives[key], in the exact shape index.html / stats.html
  // / rosters.html / free-agency.html / match-prep.html already expect
  // when they resolve a `?season=` link (see installSeasonPicker on those
  // pages) — so archived seasons are viewable there immediately.
  //
  // Fields that carry forward into a new season untouched: teamMap,
  // caseInsensitiveNames, conferenceNames, seasonArchives itself. Everything
  // else is season-scoped and gets reset when a new season starts.
  function uniqueArchiveKey(name, archives, avoidKey){
    const base = seasonKey(name);
    if(!archives[base] || base === avoidKey) return base;
    let n = 2, candidate = `${base}-${n}`;
    while(archives[candidate] && candidate !== avoidKey){ candidate = `${base}-${(++n)}`; }
    return candidate;
  }
  // Snapshot everything about the *current* live season, in the shape an
  // archive entry needs. Excludes seasonArchives/activeSeason themselves so
  // archives never nest inside archives.
  function snapshotCurrentSeason(){
    const { seasonArchives, activeSeason, leagues, activeLeagueId, ...seasonSettings } = STATE.settings;
    return {
      name: STATE.settings.activeSeason || DEFAULT_SEASON,
      archivedAt: new Date().toISOString(),
      teamMap: JSON.parse(JSON.stringify(STATE.teamMap || {})),
      settings: JSON.parse(JSON.stringify(seasonSettings || {})),
      replays: JSON.parse(JSON.stringify(STATE.replays || {}))
    };
  }
  async function clearCurrentRosters(){
    requireAdmin();
    const count = Object.values(STATE.settings.rosters || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
    const freeAgencyCount = Array.isArray(STATE.settings.freeAgency?.mons) ? STATE.settings.freeAgency.mons.length : 0;
    const draft = normalizeDraftState(STATE.settings.draft);
    const pickCount = Array.isArray(draft.picks) ? draft.picks.length : 0;
    if(!confirm(`Clear all ${count} Pokémon from the current season's rosters? This does not delete archived seasons. Franchise assignments are preserved.`)) return false;

    // Ask separately for the other destructive actions. Choosing No to either
    // leaves that subsystem untouched while still clearing the rosters.
    const clearFreeAgency = confirm(`Also clear the Free Agency pool (${freeAgencyCount} Pokémon)?

Choose Cancel to keep Free Agency unchanged.`);
    const resetDraft = confirm(`Also reset draft status? This clears ${pickCount} recorded pick${pickCount===1?'':'s'}, returns drafted Pokémon to available status, and resets the draft to setup.

Choose Cancel to keep draft status unchanged.`);

    let draftResetResult = null;
    if(resetDraft){
      if(!SBL.draft?.resetDraft) throw new Error('Draft reset service is unavailable; no roster or Free Agency changes were saved.');
      draftResetResult = await SBL.draft.resetDraft();
      if(draftResetResult?.state){
        STATE.teamMap = draftResetResult.state.teamMap || STATE.teamMap || {};
        STATE.settings = Object.assign(STATE.settings, draftResetResult.state.settings || {});
      } else {
        // resetDraft persists internally; refresh the local draft snapshot below.
        STATE.settings.draft = normalizeDraftState(STATE.settings.draft);
      }
    }

    // resetDraft may restore its pre-draft roster snapshot, so clear rosters
    // AFTER the draft reset to ensure the requested final state is empty.
    STATE.settings.rosters = {};
    if(clearFreeAgency) STATE.settings.freeAgency = {mons:[]};
    if(resetDraft) STATE.settings.draft = normalizeDraftState(STATE.settings.draft);
    await savePublishedRosters({});
    await saveSharedState();
    await logAdminAction('clear_current_rosters', `Cleared current-season rosters (${count} Pokémon).${clearFreeAgency ? ` Cleared Free Agency (${freeAgencyCount} Pokémon).` : ''}${resetDraft ? ` Reset draft status and cleared ${pickCount} picks.` : ''}`, {pokemonCount:count, freeAgencyCleared:clearFreeAgency, freeAgencyPokemonCount:clearFreeAgency?freeAgencyCount:0, draftReset:resetDraft, draftPickCount:resetDraft?pickCount:0});
    return {cleared:true, freeAgencyCleared:clearFreeAgency, draftReset:resetDraft};
  }
  async function startNewSeason(){
    requireAdmin();
    const rolloverLeagueId = SBL.leagueDb?.selectedLeagueId?.() || STATE.settings.activeLeagueId;
    const currentName = STATE.settings.activeSeason || DEFAULT_SEASON;
    const previousSeasonContext = await SBL.leagueDb?.getSeasonContext?.(rolloverLeagueId,supabase,{seasonKey:seasonKey(currentName)});
    const previousSeasonId = previousSeasonContext?.id || '';
    if(!previousSeasonId) throw new Error('Cannot start a new season because the current season ID could not be resolved. No data was changed.');
    const replayCount = Object.keys(STATE.replays||{}).length;
    const suggested = (()=>{
      const m = currentName.match(/^(.*?)(\d+)\s*$/);
      return m ? `${m[1]}${Number(m[2])+1}` : '';
    })();
    const nextName = prompt(
      `Start a new season?\n\nThis archives "${currentName}" (${replayCount} replay${replayCount===1?'':'s'}, rosters, draft, and free agency as they stand right now) and clears the board for a fresh season. The archived season stays viewable and can be restored as current at any time from Settings.\n\nName the new season:`,
      suggested
    );
    if(nextName === null) return;
    const newName = nextName.trim() || currentName;
    const newSeasonKey = seasonKey(newName);
    if(newSeasonKey===seasonKey(currentName)) throw new Error('Choose a different season name. The current season cannot be started again under the same name.');
    const existingSeasons = await SBL.leagueDb.listSeasons(rolloverLeagueId,supabase);
    if(existingSeasons.some(row=>String(row.season_key)===newSeasonKey && String(row.id)!==String(previousSeasonId))) throw new Error(`A season named "${newName}" already exists. Use Restore Season instead of creating a duplicate.`);
    if(!confirm(`Archive "${currentName}" and start "${newName}"? Registered users keep their franchise assignments, and accounts, league memberships, franchise definitions and history are all kept. Replays, rosters and the draft start fresh for the new season. Make sure all replay data you want preserved is already saved.`)) return;

    const archives = {...(STATE.settings.seasonArchives||{})};
    const key = uniqueArchiveKey(currentName, archives);
    archives[key] = snapshotCurrentSeason();

    STATE.replays = {};
    STATE.teamMap = {...STATE.teamMap}; // carried forward as-is
    STATE.settings = {
      caseInsensitiveNames: STATE.settings.caseInsensitiveNames,
      conferenceNames: STATE.settings.conferenceNames || {a:'Conference A',b:'Conference B'},
      franchiseDefinitions: JSON.parse(JSON.stringify(STATE.settings.franchiseDefinitions || {})),
      franchises: JSON.parse(JSON.stringify(STATE.settings.franchises || {})),
      rosters: {},
      draft: defaultDraftState(),
      freeAgency: {mons:[]},
      tradeCredits: {},
      activeSeason: newName,
      seasonArchives: archives,
      leagues: STATE.settings.leagues || {},
      activeLeagueId: STATE.settings.activeLeagueId || 'main'
    };

    // IMPORTANT: saveSharedState() resolves/activates the season named in
    // STATE.settings.activeSeason and updates selectedSeasonId. Replay writes
    // use selectedSeasonId, so this must happen BEFORE saveReplays(). Otherwise
    // the empty new-season replay set can be written against the previous
    // season ID, and subsequent pages load the wrong season's rows.
    await saveSharedState();
    await deleteAllRemote();          // clear only stale replay rows in the newly activated season
    await saveReplays();              // persist the new season's empty live replay set
    await savePublishedRosters({});   // clear the new season's published-roster compatibility row
    // Franchise ownership is league-scoped and persistent: registered users keep
    // their franchise when a season rolls over. Ownership is intentionally NOT
    // touched here. Admins can still reassign it explicitly, or use People &
    // Franchises -> Reset ownership mappings for a deliberate league-wide reset.
    await logAdminAction('start_new_season', `Started new season "${newName}" after archiving "${currentName}".`, {from:currentName, to:newName, archivedReplayCount:replayCount});
  }
  async function restoreSeasonArchive(key){
    requireAdmin();
    const rolloverLeagueId = SBL.leagueDb?.selectedLeagueId?.() || STATE.settings.activeLeagueId;
    const previousSeasonName = STATE.settings.activeSeason || DEFAULT_SEASON;
    const previousSeasonContext = await SBL.leagueDb?.getSeasonContext?.(rolloverLeagueId,supabase,{seasonKey:seasonKey(previousSeasonName)});
    const previousSeasonId = previousSeasonContext?.id || '';
    if(!previousSeasonId) throw new Error('Cannot restore an archive because the current season ID could not be resolved. No data was changed.');
    const archives = STATE.settings.seasonArchives || {};
    const archive = archives[key];
    if(!archive) return;
    const currentName = STATE.settings.activeSeason || DEFAULT_SEASON;
    if(!confirm(`Make "${archive.name || key}" the current season again? The current season ("${currentName}") will be archived. Registered users keep their franchise assignments; accounts, league memberships, franchise definitions and history are all retained.`)) return;

    const newArchives = {...archives};
    delete newArchives[key];
    const saveKey = uniqueArchiveKey(currentName, newArchives, key);
    newArchives[saveKey] = snapshotCurrentSeason();

    STATE.replays = JSON.parse(JSON.stringify(archive.replays || {}));
    STATE.teamMap = JSON.parse(JSON.stringify(archive.teamMap || {}));
    const leagueRegistrySnapshot = STATE.settings.leagues || {};
    const activeLeagueSnapshot = STATE.settings.activeLeagueId || 'main';
    STATE.settings = Object.assign(
      {caseInsensitiveNames:true, rosters:{}, franchises:{}, franchiseDefinitions:{}, conferenceNames:{a:'Conference A',b:'Conference B'}, freeAgency:{mons:[]}, tradeCredits:{}},
      JSON.parse(JSON.stringify(archive.settings || {}))
    );
    STATE.settings.rosters = STATE.settings.rosters || {};
    STATE.settings.draft = normalizeDraftState(STATE.settings.draft);
    STATE.settings.activeSeason = archive.name || key;
    STATE.settings.seasonArchives = newArchives;
    STATE.settings.leagues = leagueRegistrySnapshot;
    STATE.settings.activeLeagueId = activeLeagueSnapshot;
    STATE.settings.franchiseDefinitions = STATE.settings.franchiseDefinitions || {};

    // Activate the target season first. saveReplays()/upsertRows() assigns
    // rows using leagueDb.selectedSeasonId(); in the old order, the replay
    // rows were written while the PREVIOUS season was still selected, and
    // only the later saveSharedState() switched selectedSeasonId. That left
    // the restored season with no visible replay rows.
    await saveSharedState();                       // activates target season and updates selectedSeasonId
    await deleteAllRemote();                       // clear stale rows in the target season only
    await saveReplays();                           // write restored replay rows under the target season ID
    await savePublishedRosters(STATE.settings.rosters||{}); // keep restored season's roster copy in sync
    // Ownership is league-scoped and persistent; restoring a season does not change it.
    await logAdminAction('restore_season', `Restored archived season "${archive.name || key}" as the current season.`, {archiveKey:key, season:archive.name || key, previousSeason:currentName});
  }
  async function deleteSeasonArchive(key){
    requireAdmin();
    const archives = STATE.settings.seasonArchives || {};
    const archive = archives[key];
    if(!archive) return;
    if(!confirm(`Permanently delete the "${archive.name || key}" archive? This cannot be undone.`)) return;
    const newArchives = {...archives};
    delete newArchives[key];
    STATE.settings.seasonArchives = newArchives;
    await saveSharedState();
    await logAdminAction('delete_season_archive', `Permanently deleted season archive "${archive.name || key}".`, {archiveKey:key, season:archive.name || key});
  }

  async function migrateLocalData(){
    throw new Error('Legacy local-storage migration is no longer used. The admin now uses the shared Supabase database directly.');
  }

  function showAdminError(msg){
    // The admin shell is initially hidden until authentication completes. If
    // startup fails, reveal it so the commissioner sees a useful diagnostic
    // instead of an entirely blank page.
    const app = document.getElementById('app');
    if(app) app.style.display = '';
    let el = document.getElementById('adminError');
    if(!el){
      el = document.createElement('div');
      el.id = 'adminError';
      el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:1000;max-width:420px;padding:10px 14px;border:1px solid var(--red);border-radius:8px;background:var(--panel);color:var(--red);font-size:12px;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
  }

  // Consistent, accessible dialogs for the People workspace. These replace
  // browser-native prompt/confirm popups for member and franchise actions.
  function showAdminTextDialog({title,description='',label='Name',value='',placeholder='',warning='',saveLabel='Save'}={}){
    return new Promise(resolve=>{
      document.getElementById('sblAdminDialog')?.remove();
      const escape=SBL.pokemon.escapeHtml;
      const overlay=document.createElement('div');
      overlay.id='sblAdminDialog'; overlay.className='sbl-admin-dialog-overlay';
      overlay.innerHTML=`<section class="sbl-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="sblAdminDialogTitle">
        <div class="sbl-admin-dialog-kicker">SBL ADMIN</div>
        <h2 id="sblAdminDialogTitle">${escape(title||'Update')}</h2>
        ${description?`<p class="sbl-admin-dialog-description">${escape(description)}</p>`:''}
        <label class="sbl-admin-dialog-label" for="sblAdminDialogInput">${escape(label)}</label>
        <input id="sblAdminDialogInput" type="text" value="${escape(value)}" placeholder="${escape(placeholder)}" autocomplete="off">
        ${warning?`<div class="sbl-admin-dialog-warning">${escape(warning)}</div>`:''}
        <div class="sbl-admin-dialog-actions"><button type="button" class="ghost" data-dialog-cancel>Cancel</button><button type="button" class="primary" data-dialog-save>${escape(saveLabel)}</button></div>
      </section>`;
      document.body.appendChild(overlay);
      const input=overlay.querySelector('#sblAdminDialogInput');
      const finish=result=>{overlay.remove();document.removeEventListener('keydown',onKey);resolve(result);};
      const onKey=e=>{if(e.key==='Escape')finish(null);if(e.key==='Enter'&&document.activeElement===input){e.preventDefault();finish(input.value);}};
      overlay.addEventListener('click',e=>{if(e.target===overlay)finish(null);});
      overlay.querySelector('[data-dialog-cancel]').addEventListener('click',()=>finish(null));
      overlay.querySelector('[data-dialog-save]').addEventListener('click',()=>finish(input.value));
      document.addEventListener('keydown',onKey);
      requestAnimationFrame(()=>{input.focus();input.select();});
    });
  }
  function showAdminConfirmDialog({title,description='',warning='',confirmLabel='Continue',danger=false}={}){
    return new Promise(resolve=>{
      document.getElementById('sblAdminDialog')?.remove();
      const escape=SBL.pokemon.escapeHtml;
      const overlay=document.createElement('div');
      overlay.id='sblAdminDialog'; overlay.className='sbl-admin-dialog-overlay';
      overlay.innerHTML=`<section class="sbl-admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sblAdminDialogTitle">
        <div class="sbl-admin-dialog-kicker">SBL ADMIN</div><h2 id="sblAdminDialogTitle">${escape(title||'Confirm action')}</h2>
        ${description?`<p class="sbl-admin-dialog-description">${escape(description)}</p>`:''}
        ${warning?`<div class="sbl-admin-dialog-warning">${escape(warning)}</div>`:''}
        <div class="sbl-admin-dialog-actions"><button type="button" class="ghost" data-dialog-cancel>Cancel</button><button type="button" class="${danger?'ghost danger-btn':'primary'}" data-dialog-confirm>${escape(confirmLabel)}</button></div>
      </section>`;
      document.body.appendChild(overlay);
      const finish=result=>{overlay.remove();document.removeEventListener('keydown',onKey);resolve(result);};
      const onKey=e=>{if(e.key==='Escape')finish(false);};
      overlay.addEventListener('click',e=>{if(e.target===overlay)finish(false);});
      overlay.querySelector('[data-dialog-cancel]').addEventListener('click',()=>finish(false));
      overlay.querySelector('[data-dialog-confirm]').addEventListener('click',()=>finish(true));
      document.addEventListener('keydown',onKey);
      overlay.querySelector('[data-dialog-confirm]').focus();
    });
  }

  function showAdminLogin(){
    // Not logged in (or no assigned team) — bounce to the login page instead of
    // rendering an inline form here. Any page other than index.html requires an
    // authenticated session with a claimed team before it will show content.
    location.replace('index.html');
  }

  async function initAdminAuth(){
    const {data, error} = await supabase.auth.getSession();
    if(error) throw error;
    if(!data.session){ showAdminLogin(); return false; }
    adminUser = data.session.user;
    const routeLeagueId=String(new URLSearchParams(location.search).get('league')||'').trim();
    if(SBL.leagueDb?.isUuid?.(routeLeagueId)) SBL.leagueDb.setSelectedLeagueId(routeLeagueId);

    // League administration is scoped to the selected league. A platform
    // commissioner can administer every league; a league commissioner/manager
    // can administer only the league(s) where they hold that role.
    // Authorization comes from normalized league_members, not the legacy
    // STATE.settings.leagues[*].members mirror.
    const profile = await SBL.profiles.get(data.session.user.id, 'id,email,is_commissioner,username,status', supabase);
    adminIsCommissioner = !!profile?.is_commissioner;
    let selectedWorkspaceLeague=String(SBL.leagueDb?.selectedLeagueId?.()||routeLeagueId||'').trim();
    if(!SBL.leagueDb?.isUuid?.(selectedWorkspaceLeague)){
      // A platform commissioner can administer any league; a league manager
      // is restricted to their own active memberships. Never invent a legacy
      // "main" league identifier for normalized storage.
      const candidates=adminIsCommissioner
        ? await SBL.leagueDb.listAll(supabase)
        : await SBL.leagueDb.listForUser(adminUser.id,supabase);
      const valid=(candidates||[]).filter(row=>SBL.leagueDb.isUuid(row.id));
      if(valid.length===1) selectedWorkspaceLeague=valid[0].id;
      else if(valid.length>1){
        const active=valid.filter(row=>String(row.status||'active')==='active');
        if(active.length===1) selectedWorkspaceLeague=active[0].id;
      }
      if(SBL.leagueDb?.isUuid?.(selectedWorkspaceLeague)) SBL.leagueDb.setSelectedLeagueId(selectedWorkspaceLeague);
    }
    if(!adminIsCommissioner){
      try{
        const workspaceLeagueId = String(
          selectedWorkspaceLeague ||
          SBL.leagueDb?.selectedLeagueId?.() ||
          new URLSearchParams(location.search).get('league') || ''
        ).trim();
        const isValidWorkspaceLeagueId = typeof SBL.leagueDb?.isUuid === 'function'
          ? SBL.leagueDb.isUuid(workspaceLeagueId)
          : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceLeagueId);
        const member = isValidWorkspaceLeagueId
          ? await SBL.leagueDb.getMembership(workspaceLeagueId, adminUser.id, supabase)
          : null;
        const active = String(member?.status||'').toLowerCase()==='active';
        const role = String(member?.role||'').toLowerCase();
        if(!active || !['commissioner','manager'].includes(role)){
          if(isValidWorkspaceLeagueId){
            location.replace(`league.html?league=${encodeURIComponent(workspaceLeagueId)}`);
          }else{
            location.replace('index.html');
          }
          return false;
        }
        // `requireAdmin()` is intentionally the local gate used by all admin
        // mutations. A league manager/commissioner is an admin for the selected
        // league even though they are not a platform commissioner.
        adminIsCommissioner = true;
      }catch(e){
        console.error('League permission check failed:', e);
        location.replace('index.html');
        return false;
      }
    }
    if(!SBL.leagueDb?.isUuid?.(selectedWorkspaceLeague)){
      showAdminError('Choose a league first. Open League Admin from the intended league workspace, or select a league in the league dashboard.');
      return false;
    }
    SBL.leagueDb.setSelectedLeagueId(selectedWorkspaceLeague);
    document.getElementById('app').style.display = '';
    return true;
  }

  async function refreshSharedState(){
    if(loadingFromRemote || !adminUser) return;
    const before = JSON.stringify({r:Object.keys(STATE.replays).length,t:STATE.teamMap,s:STATE.settings});
    await loadState();
    const after = JSON.stringify({r:Object.keys(STATE.replays).length,t:STATE.teamMap,s:STATE.settings});
    if(before !== after){ renderTicker(); render(); }
  }

  // ---------- helpers ----------
  function normName(n){ return n.trim().toLowerCase().replace(/-/g,' ').replace(/_/g,' '); }
  // ---------- robust Pokémon sprites ----------
  // Keep the Showdown forme separator (`-`), normalize common league names,
  // and try a small candidate list before giving up.  This matters because
  // the league data contains alternate-form names that do not always map
  // 1:1 to a Showdown gen5 filename.
  const SPRITE_ALIASES = {
    'aegislash':'aegislash-shield',
    'darmanitan':'darmanitan',
    'darmanitan-galar':'darmanitan-galar',
    'darmanitan-galar-zen':'darmanitan-galar-zen',
    'terapagos-middle':'terapagos-terastal',
    'terapagos':'terapagos',
    'keldeo':'keldeo-ordinary',
    'zygarde':'zygarde-50',
    'meloetta':'meloetta-aria',
    'shaymin':'shaymin-land',
    'maushold':'maushold-four',
    'dudunsparce':'dudunsparce-two-segment',
    'oricorio':'oricorio-baile',
    'minior':'minior-red-meteor',
    'tatsugiri':'tatsugiri-curly',
    'wishiwashi':'wishiwashi-solo',
    'eiscue':'eiscue-ice',
    'morpeko':'morpeko-full-belly',
    'palafin':'palafin-zero',
    'basculegion':'basculegion-male',
    'basculegion-m':'basculegion-male',
    'basculegion-f':'basculegion-female',
    'indeedee-m':'indeedee-male',
    'indeedee-f':'indeedee-female',
    'meowstic-m':'meowstic-male',
    'meowstic-f':'meowstic-female',
    'frillish-m':'frillish',
    'frillish-f':'frillish',
    'jellicent-m':'jellicent',
    'jellicent-f':'jellicent'
  };

  


  function usernameKey(username){
    return String(username || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g,'')
      .replace(/[_-]+/g,'');
  }
  function teamFor(username){
    const raw = String(username || '').trim();
    if(!raw) return 'Unknown';
    // First honor the exact lower-cased mapping used by existing saved data.
    const exact = STATE.teamMap[raw.toLowerCase()];
    if(exact) return exact;
    // Then support harmless Showdown username variations such as
    // Dossa_37 / dossa37 without requiring the mapping to be entered twice.
    const key = usernameKey(raw);
    for(const [mappedUser, team] of Object.entries(STATE.teamMap || {})){
      if(usernameKey(mappedUser) === key) return team;
    }
    return raw;
  }
  // groups values that only differ by case/whitespace under one canonical label
  // (the first-seen casing) when "case-insensitive names" is on in Settings —
  // this is what keeps e.g. "Team Fire" and "team fire" from splitting into
  // two separate teams just because they were typed differently at different times.
  function groupKey(value){
    return STATE.settings.caseInsensitiveNames ? value.trim().toLowerCase() : value.trim();
  }
  
  // ---------- processing ----------
  // Automatic season week assignment: weeks run Monday -> Sunday.
  // Week 1 begins on the Monday of the earliest replay in the season.
  // Manual overrides (weekOverride === true) are never touched by this logic.
  function replayTimestamp(replay){
    const raw = replay && replay.uploadtime;
    if(raw == null || raw === '') return NaN;
    const n = Number(raw);
    if(!Number.isNaN(n)){
      // Showdown uploadtime is normally Unix seconds; tolerate milliseconds too.
      return n < 1e12 ? n * 1000 : n;
    }
    const t = Date.parse(raw);
    return Number.isNaN(t) ? NaN : t;
  }

  function mondayStart(ts){
    const d = new Date(ts);
    if(Number.isNaN(d.getTime())) return null;
    d.setHours(0,0,0,0);
    const day = d.getDay(); // Sun=0, Mon=1
    const daysSinceMonday = (day + 6) % 7;
    d.setDate(d.getDate() - daysSinceMonday);
    return d;
  }

  function ensureWeekStart(){
    const dates = Object.values(STATE.replays)
      .map(replayTimestamp)
      .filter(Number.isFinite);
    if(!dates.length) return null;
    // Always derive the season start from the earliest replay. This matters when
    // a bulk import is pasted out of chronological order or an older replay is
    // added later: automatic week numbers must remain chronological.
    const start = mondayStart(Math.min(...dates));
    if(start){
      const iso = start.toISOString().slice(0,10);
      STATE.settings.weekStartDate = iso;
    }
    return start;
  }

  function automaticWeekForReplay(replay){
    const ts = replayTimestamp(replay);
    const start = ensureWeekStart();
    if(!Number.isFinite(ts) || !start) return 'Unassigned';
    const replayWeek = mondayStart(ts);
    const diffDays = Math.floor((replayWeek.getTime() - start.getTime()) / 86400000);
    const weekNum = Math.floor(diffDays / 7) + 1;
    return `Week ${Math.max(1, weekNum)}`;
  }

  function assignAutomaticWeeks(){
    // Manual overrides are sacred. Only automatic assignments are recalculated.
    ensureWeekStart();
    for(const replay of Object.values(STATE.replays)){
      if(!replay.weekOverride){
        replay.week = automaticWeekForReplay(replay);
      }
    }
  }

  async function fetchReplayForImport(id){
    if(!SBL.replays || typeof SBL.replays.parseLog !== 'function' || typeof SBL.replays.extractReplayId !== 'function'){
      throw new Error('Replay service is unavailable. Reload the page and try again.');
    }
    // Accuracy data is optional enrichment. The importer must never depend on
    // a third-party data file being reachable.
    try { await SBL.replays.ensureMoveAccuracyData?.(); } catch (_) {}
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
    try {
      const resp = await fetch(`https://replay.pokemonshowdown.com/${encodeURIComponent(id)}.json`, {
        signal: controller?.signal,
        cache: 'no-store'
      });
      if(!resp.ok) throw new Error('replay not found (' + resp.status + ')');
      const json = await resp.json();
      if(!json || typeof json !== 'object') throw new Error('invalid replay response');
      const parsed = SBL.replays.parseLog(json, id);
      if(!parsed || typeof parsed !== 'object') throw new Error('replay parser returned no data');
      parsed.uploadtime = json.uploadtime || parsed.uploadtime || null;
      parsed.weekOverride = false;
      parsed.processedAt = Date.now();
      return parsed;
    } catch(e) {
      if(e?.name === 'AbortError') throw new Error('request timed out after 20 seconds');
      throw e;
    } finally {
      if(timer) clearTimeout(timer);
    }
  }

  async function processUrls(urlsRaw, logEl){
    if(!SBL.replays || typeof SBL.replays.extractReplayId !== 'function' || typeof SBL.replays.parseLog !== 'function'){
      appendLog(logEl, 'Replay service failed to load. Reload the admin page before processing replays.', true);
      return;
    }
    // Move accuracy data is enrichment only. A temporary Showdown data/network
    // failure must never prevent the replay importer itself from running.
    try{
      try { await SBL.replays.ensureMoveAccuracyData?.(); } catch (_) { /* optional enrichment */ }
    }catch(e){
      appendLog(logEl, `Move data unavailable — continuing without accuracy-sensitive luck: ${e.message}`, true);
    }
    const rawLines = String(urlsRaw || '').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(rawLines.length === 0){ appendLog(logEl, 'No links provided.', true); return; }

    // De-duplicate IDs before fetching, while preserving the order in which the
    // user pasted them for the import log. Week assignment itself is based on
    // replay upload timestamps, not paste order.
    const ids = [];
    const seen = new Set();
    let invalid = 0, skipped = 0;
    for(const url of rawLines){
      const id = SBL.replays.extractReplayId(url);
      if(!id){ appendLog(logEl, `Could not read a replay id from: ${url}`, true); invalid++; continue; }
      if(seen.has(id) || STATE.replays[id]){
        if(STATE.replays[id] && Number(STATE.replays[id].parserVersion||0) < 7){
          if(!seen.has(id)){
            appendLog(logEl, `Reprocessing older parser version: ${id}`, false);
            ids.push(id);
            seen.add(id);
          }
          continue;
        }
        appendLog(logEl, `Already processed: ${id} — skipped`, false);
        skipped++;
        continue;
      }
      seen.add(id);
      ids.push(id);
    }
    if(!ids.length){
      appendLog(logEl, `Done. 0 added, ${skipped} already had, ${invalid} invalid, 0 failed.`, false);
      return;
    }

    let added = 0, failed = 0;
    const queue = ids.slice();
    const worker = async()=>{
      while(queue.length){
        const id = queue.shift();
        try{
          const parsed = await fetchReplayForImport(id);
          STATE.replays[id] = parsed;
          appendLog(logEl, `✓ ${id}  (${parsed.players.p1 || '?'} vs ${parsed.players.p2 || '?'})`, false, true);
          added++;
        }catch(e){
          appendLog(logEl, `✗ ${id} — ${e.message}`, true);
          failed++;
        }
      }
    };
    // Fetch several replays at once so a large bulk import does not take forever,
    // while avoiding an unbounded burst of requests.
    await Promise.all(Array.from({length: Math.min(6, ids.length)}, worker));

    // Assign ALL automatic weeks only after the complete bulk is loaded. This
    // makes the result deterministic regardless of paste order or fetch timing.
    let persisted = true;
    if(added > 0){
      assignAutomaticWeeks();
      try {
        await saveSettings();
        await saveReplays();
      } catch(e) {
        persisted = false;
        appendLog(logEl, `⚠ ${added} replay(s) parsed but could not be saved: ${e?.message || e}`, true);
      }
    }
    const persistenceNote = persisted ? '' : ' Persistence failed; do not leave this page until the data is recovered.';
    appendLog(logEl, `Done. ${added} added, ${skipped} already had, ${invalid} invalid, ${failed} failed.${persistenceNote}`, !persisted);
    await logAdminAction(
      'process_replays',
      `Processed replays: ${added} added, ${skipped} skipped, ${invalid} invalid, ${failed} failed, persisted=${persisted}.`,
      {added, skipped, invalid, failed, persisted}
    );
    appendLog(logEl, `Done. ${added} added, ${skipped} already had, ${invalid} invalid, ${failed} failed.`, false);
    renderTicker();
    render();
  }
  function appendLog(el, text, isErr, isOk){
    const line = document.createElement('div');
    line.className = isErr ? 'err' : (isOk ? 'ok' : '');
    line.textContent = text;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  // ---------- aggregation ----------
  function allReplays(weekFilter){
    const all = Object.values(STATE.replays);
    if(!weekFilter || weekFilter === 'ALL') return all;
    if(weekFilter === 'LAST4') return all.slice().sort((a,b)=>replayTimestamp(b)-replayTimestamp(a)).slice(0,4);
    return all.filter(r => r.week === weekFilter);
  }
  function weeksList(){
    const set = new Set(Object.values(STATE.replays).map(r=>r.week || 'Unassigned'));
    return Array.from(set).sort((a,b)=>{
      const sa=String(a??''), sb=String(b??'');
      const na=parseInt(sa.match(/\d+/)?.[0]||'',10);
      const nb=parseInt(sb.match(/\d+/)?.[0]||'',10);
      const aNum=Number.isFinite(na), bNum=Number.isFinite(nb);
      if(aNum && bNum && na!==nb) return na-nb;
      if(aNum!==bNum) return aNum ? -1 : 1;
      if(sa==='Unassigned') return 1;
      if(sb==='Unassigned') return -1;
      return sa.localeCompare(sb,undefined,{numeric:true,sensitivity:'base'});
    });
  }
  function globalPokemonStats(weekFilter){
    const out = {}; // normSpecies -> {species, dealt, taken, kills, deaths, games, coaches}
    for(const r of allReplays(weekFilter)){
      if(!r || !r.mons || !r.players) continue;
      for(const k in r.mons){
        const m = r.mons[k];
        const nk = normName(m.species);
        if(!out[nk]) out[nk] = {species:m.species, dealt:0, taken:0, kills:0, deaths:0, assists:0, games:0, killLog:[], deathLog:[], assistLog:[], coaches:new Set()};
        out[nk].dealt += m.damageDealt;
        out[nk].taken += m.damageTaken;
        out[nk].kills += m.kills;
        out[nk].deaths += m.deaths;
        out[nk].games += m.appearances;
        out[nk].assists += (m.assists || 0);
        if(m.killLog) out[nk].killLog.push(...m.killLog);
        if(m.deathLog) out[nk].deathLog.push(...m.deathLog);
        if(m.assistLog) out[nk].assistLog.push(...m.assistLog);
        out[nk].coaches.add(teamFor(r.players[m.side]));
      }
    }
    return Object.values(out).sort((a,b)=>b.dealt-a.dealt);
  }
  function teamPokemonStats(weekFilter){
    const groups = {}; // groupKey -> { label, species: {normSpecies -> stats} }
    for(const r of allReplays(weekFilter)){
      if(!r || !r.mons || !r.players) continue;
      for(const side of ['p1','p2']){
        const team = teamFor(r.players[side]);
        const gk = groupKey(team);
        if(!groups[gk]) groups[gk] = { label: team, species: {} };
        const bucket = groups[gk].species;
        for(const k in r.mons){
          const m = r.mons[k];
          if(m.side !== side) continue;
          const nk = normName(m.species);
          if(!bucket[nk]) bucket[nk] = {species:m.species, dealt:0, taken:0, kills:0, deaths:0, assists:0, games:0, killLog:[], deathLog:[], assistLog:[]};
          bucket[nk].dealt += m.damageDealt;
          bucket[nk].taken += m.damageTaken;
          bucket[nk].kills += m.kills;
          bucket[nk].deaths += m.deaths;
          bucket[nk].games += m.appearances;
          bucket[nk].assists += (m.assists || 0);
          if(m.killLog) bucket[nk].killLog.push(...m.killLog);
          if(m.deathLog) bucket[nk].deathLog.push(...m.deathLog);
          if(m.assistLog) bucket[nk].assistLog.push(...m.assistLog);
        }
      }
    }
    const out = {};
    for(const gk in groups) out[groups[gk].label] = groups[gk].species;
    return out;
  }
  // ---------- duplicate detection (Settings) ----------
  // Normalizes a username so that things like "dossa37"/"dossa_37" (punctuation
  // difference) and "podraa"/"podrrraaa" (repeated-letter typo) collapse to the
  // same key: strip anything that isn't a letter/digit, then collapse any run of
  // the same character down to one (so "rrr"/"aaa" runs match a single r/a).
  
  function usernameGameCounts(){
    const counts = {};
    for(const r of Object.values(STATE.replays)){
      if(!r || !r.players) continue;
      for(const side of ['p1','p2']){
        const u = (r.players[side]||'').trim();
        if(!u) continue;
        const key = u.toLowerCase();
        counts[key] = (counts[key]||0) + 1;
      }
    }
    return counts;
  }
  // returns groups of raw usernames that look like the same person typed differently
  function findDuplicatePlayerGroups(){
    const seen = {}; // lowercase username -> raw display username (first seen casing)
    for(const r of Object.values(STATE.replays)){
      if(!r || !r.players) continue;
      for(const side of ['p1','p2']){
        const u = (r.players[side]||'').trim();
        if(!u) continue;
        const key = u.toLowerCase();
        if(!seen[key]) seen[key] = u;
      }
    }
    const counts = usernameGameCounts();
    const byFuzzy = {};
    for(const key in seen){
      const fk = SBL.util.fuzzyKey(key);
      if(!fk) continue;
      if(!byFuzzy[fk]) byFuzzy[fk] = [];
      byFuzzy[fk].push(seen[key]);
    }
    const groups = [];
    for(const fk in byFuzzy){
      const usernames = byFuzzy[fk];
      if(usernames.length < 2) continue;
      // skip groups that are already fully merged (all mapped to the same team)
      const teams = new Set(usernames.map(u=>teamFor(u)));
      if(teams.size <= 1) continue;
      const sorted = usernames.slice().sort((a,b)=> (counts[b.toLowerCase()]||0) - (counts[a.toLowerCase()]||0) || a.localeCompare(b));
      groups.push({ usernames: sorted, canonical: sorted[0], counts });
    }
    return groups.sort((a,b)=> a.canonical.localeCompare(b.canonical));
  }
  function mergePlayerGroup(usernames, canonicalLabel){
    for(const u of usernames){
      STATE.teamMap[u.trim().toLowerCase()] = canonicalLabel;
    }
  }
  // returns pairs of current team labels whose Pokémon rosters overlap heavily —
  // in a draft league each team's roster is fixed, so two "different" team tags
  // sharing most of the same mons are almost certainly the same team typed two ways
  function findDuplicateTeamPairs(){
    const teams = teamPokemonStats('ALL');
    const labels = Object.keys(teams);
    const rosterOf = {}; // label -> Set(normSpecies)
    const gamesOf = {}; // label -> total appearances (for picking the canonical tag)
    for(const label of labels){
      rosterOf[label] = new Set(Object.keys(teams[label]));
      gamesOf[label] = Object.values(teams[label]).reduce((sum,s)=>sum+s.games,0);
    }
    const pairs = [];
    for(let i=0;i<labels.length;i++){
      for(let j=i+1;j<labels.length;j++){
        const a = labels[i], b = labels[j];
        const ra = rosterOf[a], rb = rosterOf[b];
        if(ra.size < 2 || rb.size < 2) continue;
        let overlap = 0;
        for(const sp of ra) if(rb.has(sp)) overlap++;
        const ratio = overlap / Math.min(ra.size, rb.size);
        if(ratio >= 0.5 && overlap >= 2){
          const [bigger, smaller] = gamesOf[a] >= gamesOf[b] ? [a,b] : [b,a];
          pairs.push({ bigger, smaller, overlap, ratio, biggerGames: gamesOf[bigger], smallerGames: gamesOf[smaller] });
        }
      }
    }
    return pairs.sort((x,y)=> y.ratio - x.ratio);
  }
  // maps every raw username currently resolving to `label` back to that username,
  // so a team-roster merge can point all of them at the canonical label too
  function usernamesForTeamLabel(label){
    const out = new Set();
    for(const r of Object.values(STATE.replays)){
      if(!r || !r.players) continue;
      for(const side of ['p1','p2']){
        const u = (r.players[side]||'').trim();
        if(u && teamFor(u) === label) out.add(u);
      }
    }
    return Array.from(out);
  }

  // ---------- CSV export ----------
  function download(filename, text){
    const blob = new Blob([text], {type:'text/csv;charset=utf-8;'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }
  function toCSV(rows){
    return rows.map(r => r.map(v=>{
      const s = String(v);
      return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
    }).join(',')).join('\n');
  }
  function exportGlobalCSV(weekFilter, label){
    const stats = globalPokemonStats(weekFilter);
    const rows = [['Pokemon','Total Damage Dealt','Avg Damage Dealt per Game','Kills','Assists','Deaths','Games Played']];
    stats.forEach(s => rows.push([s.species, s.dealt.toFixed(2), (s.games? (s.dealt/s.games):0).toFixed(2), s.kills, s.assists, s.deaths, s.games]));
    download(`Damage Leaderboard - ${label}.csv`, toCSV(rows));
  }
  function exportTeamCSVs(weekFilter, label){
    const teams = teamPokemonStats(weekFilter);
    for(const team in teams){
      const rows = [['Pokemon','Total Damage Dealt','Total Damage Taken','Total Kills','Total Assists','Total Deaths','Appearances']];
      const list = Object.values(teams[team]).sort((a,b)=>b.dealt-a.dealt);
      list.forEach(s => rows.push([s.species, s.dealt.toFixed(2), s.taken.toFixed(2), s.kills, s.assists, s.deaths, s.games]));
      download(`${team} - ${label}.csv`, toCSV(rows));
    }
  }
  // ---------- rendering ----------
  const contentEl = document.getElementById('content');
  const tabsEl = document.getElementById('tabs');
  const appEl = document.getElementById('app');
  const sidebarToggle = document.getElementById('adminSidebarToggle');
  let activeTab = 'overview';

  // Sidebar collapse is a local UI preference; it never touches league data.
  const SIDEBAR_KEY = 'sbl_admin_sidebar_collapsed';
  const NAV_GROUP_KEY = 'sbl_admin_nav_group';
  let sidebarCollapsed = localStorage.getItem(SIDEBAR_KEY) === '1';
  let openNavGroup = localStorage.getItem(NAV_GROUP_KEY) || '';
  function applySidebarState(){
    if(!appEl) return;
    appEl.classList.toggle('admin-sidebar-collapsed', sidebarCollapsed);
    if(sidebarToggle){
      sidebarToggle.setAttribute('aria-expanded', String(!sidebarCollapsed));
      sidebarToggle.setAttribute('aria-label', sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
      sidebarToggle.title = sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
      const icon = sidebarToggle.querySelector('.admin-sidebar-toggle-icon');
      if(icon) icon.textContent = sidebarCollapsed ? '›' : '‹';
    }
  }
  applySidebarState();
  sidebarToggle?.addEventListener('click', ()=>{
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0');
    applySidebarState();
  });

  function syncAdminNavGroups() {
    tabsEl.querySelectorAll('.admin-nav-group').forEach(group => {
      const name = group.dataset.navGroup || '';
      const open = name === openNavGroup;
      group.classList.toggle('open', open);
      const toggle = group.querySelector('.admin-nav-group-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', String(open));
    });
  }

  // Keep the admin rail quiet: one section open at a time, with the choice
  // surviving reloads. The section containing the current page wins on first load.
  if (!openNavGroup) {
    const activeItem = tabsEl.querySelector('.admin-nav-item.active');
    const activeGroup = activeItem?.closest('.admin-nav-group');
    openNavGroup = activeGroup?.dataset.navGroup || 'home';
  }
  syncAdminNavGroups();

  tabsEl.addEventListener('click', (e)=>{
    const groupToggle = e.target.closest('.admin-nav-group-toggle');
    if(groupToggle){
      const group = groupToggle.closest('.admin-nav-group');
      const name = group?.dataset.navGroup || '';
      openNavGroup = group?.classList.contains('open') ? '' : name;
      localStorage.setItem(NAV_GROUP_KEY, openNavGroup);
      syncAdminNavGroups();
      return;
    }
    const item = e.target.closest('.admin-nav-item');
    if(!item) return;
    activeTab = item.dataset.tab;
    tabsEl.querySelectorAll('.admin-nav-item').forEach(b=>b.classList.toggle('active', b.dataset.tab===activeTab));
    const group = item.closest('.admin-nav-group');
    openNavGroup = group?.dataset.navGroup || openNavGroup;
    localStorage.setItem(NAV_GROUP_KEY, openNavGroup);
    syncAdminNavGroups();
    render();
  });

  function renderTicker(){
    const ticker = document.getElementById('ticker');
    if(!ticker) return;
    const top = globalPokemonStats('ALL').slice(0,6);
    if(top.length === 0){
      ticker.innerHTML = `<div class="tick empty"><div class="lbl">Season</div><div class="val">No games processed yet</div></div>`;
      return;
    }
    ticker.innerHTML = top.map(s => `
      <div class="tick">
        <div class="lbl">Dmg Dealt</div>
        <div class="pname-cell">${SBL.pokemon.spriteMarkup(s.species,'sprite')}<div>
          <div class="name">${SBL.pokemon.escapeHtml(SBL.pokemon.displayName(s.species))}</div>
          <div class="val">${s.dealt.toFixed(0)}%</div>
        </div></div>
      </div>`).join('');
  }


  // ---------- kill/death audit trail ----------
  // Encodes a mon's kill or death log onto a table cell so it can be clicked open
  // to see exactly which replay/turn/cause each credited kill or death came from —
  // lets you trace a count against a hand-kept tally without me having to guess.
  function auditAttr(species, type, list, showLink){
    const payload = JSON.stringify({species, type, list: list || [], showLink: showLink !== false});
    return `class="num ${type==='kills'?'kills ':''}auditable" data-audit="${SBL.pokemon.escapeHtml(payload)}"`;
  }
  // same payload as auditAttr but without the class="" — for elements (like the
  // Golden Fist row) that already carry their own class list
  function auditDataAttr(species, type, list, showLink){
    const payload = JSON.stringify({species, type, list: list || [], showLink: showLink !== false});
    return `data-audit="${SBL.pokemon.escapeHtml(payload)}"`;
  }
  function closeAudit(){
    const el = document.getElementById('auditModal');
    if(el) el.innerHTML = '';
    document.documentElement.style.overflow='';
    document.body.style.overflow='';
  }
  // Global backdrop safety net for every audit/overview overlay. This avoids
  // relying on individual renderers having exactly the right target check.
  document.addEventListener('pointerdown', (e)=>{
    const overlay = e.target.closest?.('.audit-overlay');
    if(overlay && e.target === overlay){ closeAudit(); }
  }, true);

  function closeTopPopup(){ return !!document.querySelector('#auditModal .audit-overlay') && (closeAudit(),true); }
  function openAudit(species, type, list, showLink){
    showLink = showLink !== false;
    const label = type === 'kills' ? 'Knockouts' : 'Deaths';
    const rows = (list || []).slice().sort((a,b)=> (a.replayId||'').localeCompare(b.replayId||'') || (a.turn-b.turn));
    document.getElementById('auditModal').innerHTML = `
      <div class="audit-overlay" id="auditOverlay">
        <div class="audit-box">
          <h3>${SBL.pokemon.escapeHtml(SBL.pokemon.displayName(species))} — ${label} (${rows.length})</h3>
          <div class="audit-sub">Every ${type==='kills'?'knockout':'death'} credited to this Pokémon this scope, with the turn${showLink?', replay,':''} and why it was credited.</div>
          ${rows.length===0 ? `<div class="empty-state">No entries.</div>` : `<ul class="audit-list">
            ${rows.map(r=>`<li>
              <span>Turn ${r.turn} — ${type==='kills' ? 'vs ' + SBL.pokemon.escapeHtml(r.victim||'?') : (r.killer ? 'by ' + SBL.pokemon.escapeHtml(r.killer) : 'unattributed')} <span class="audit-cause">(${SBL.pokemon.escapeHtml(r.cause||'—')})</span></span>
              ${showLink ? `<a href="https://replay.pokemonshowdown.com/${SBL.pokemon.escapeHtml(r.replayId)}" target="_blank" rel="noopener">${SBL.pokemon.escapeHtml(r.replayId)}</a>` : ''}
            </li>`).join('')}
          </ul>`}
          <div class="foot-actions"><button class="ghost" id="auditClose">Close</button></div>
        </div>
      </div>`;
    document.getElementById('auditClose').addEventListener('click', closeAudit);
    document.getElementById('auditOverlay').addEventListener('click', (e)=>{ if(e.target.id === 'auditOverlay') closeAudit(); });
  }

  function render(){
    document.getElementById('app').classList.toggle('wide', activeTab === 'players');
    const seasonBadge = document.getElementById('seasonBadge');
    if(seasonBadge) seasonBadge.textContent = loaded ? (STATE.settings.activeSeason || DEFAULT_SEASON) : '';
    if(!loaded){ contentEl.innerHTML = `<div class="empty-state">Loading…</div>`; return; }
    const renderers = {
      league: renderLeagueManager,
      people: renderPeople,
      overview: renderOverview,
      process: renderProcess,
      players: renderPlayers,
      'legacy-migration': renderLegacyMigration,
      'bug-reports': renderBugReports,
      draft: renderDraft,
      freeagency: renderFreeAgency,
      trades: renderTrades,
      updates: renderUpdates,
      commissioner: renderPeople,
      'franchise-requests': renderFranchiseRequests,
      'admin-log': drawAdminLog,
      seasonsetup: renderSeasonSetup,
      settings: renderPeople,
      'settings-franchises': () => renderSettings('franchises'),
      'settings-data': () => renderSettings('data'),
      'settings-system': () => renderSettings('system')
    };
    const renderer = renderers[activeTab];
    if(!renderer) return;
    const result = renderer();
    // Most admin tools render synchronously, while a few load league data first.
    // Organise their top-level panels only after their content is in the DOM so
    // existing IDs, event handlers and data operations remain untouched.
    if(result && typeof result.then === 'function'){
      result.then(() => applyAdminSectionWorkspace()).catch(err => console.error('Admin section rendering failed:', err));
    }else{
      applyAdminSectionWorkspace();
    }
  }

  const ADMIN_SECTION_WORKSPACE_TABS = new Set([
    'people','legacy-migration','draft','freeagency','trades','updates',
    'franchise-requests','settings-franchises','settings-data','settings-system'
  ]);
  function applyAdminSectionWorkspace(container=contentEl, workspaceKey='main', headingOverride=''){
    if(container === contentEl && !ADMIN_SECTION_WORKSPACE_TABS.has(activeTab)) return;
    if(container.querySelector(':scope > .admin-focused-workspace')) return;
    let host = container;
    let panels = Array.from(host.children).filter(el => el.classList?.contains('panel'));
    // People & Franchises and System Settings keep a semantic admin-section
    // wrapper around their title/metrics and the individual panels.
    if(panels.length < 2 && container === contentEl){
      const sectionHost = Array.from(contentEl.children).find(el => el.classList?.contains('admin-section'));
      if(sectionHost){
        const nestedPanels = Array.from(sectionHost.children).filter(el => el.classList?.contains('panel'));
        if(nestedPanels.length >= 2){ host = sectionHost; panels = nestedPanels; }
      }
    }
    // Small two-panel tools are easier to use as one continuous workflow.
    // Only substantial workspaces get a section switcher.
    if(panels.length < 3) return;

    const workspace = document.createElement('section');
    workspace.className = 'admin-focused-workspace';
    workspace.setAttribute('aria-label', 'Admin section workspace');
    const heading = headingOverride || tabsEl.querySelector(`.admin-nav-item[data-tab="${activeTab}"]`)?.textContent?.trim() || 'Administration';
    const header = document.createElement('div');
    header.className = 'admin-focused-workspace-head';
    header.innerHTML = `<div><div class="admin-focused-eyebrow">Admin workspace</div><h2>${SBL.pokemon.escapeHtml(heading)}</h2><p>Choose a section to work on. Only one section is shown at a time.</p></div>`;
    const nav = document.createElement('nav');
    nav.className = 'admin-focused-section-nav';
    nav.setAttribute('aria-label', `${heading} sections`);
    const body = document.createElement('div');
    body.className = 'admin-focused-section-content';
    const storageKey = `sbl_admin_section_${activeTab}_${workspaceKey}`;
    const savedIndex = Number(localStorage.getItem(storageKey) || 0);
    const initialIndex = Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < panels.length ? savedIndex : 0;

    panels.forEach((panel, index) => {
      const titleNode = panel.querySelector(':scope > h2, :scope > h3, :scope > .section-head-row h2, :scope > .section-head-row h3, :scope > .admin-section-title h2');
      const title = titleNode?.textContent?.trim() || `Section ${index + 1}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `admin-focused-section-tab${index === initialIndex ? ' active' : ''}`;
      button.dataset.adminSectionIndex = String(index);
      button.setAttribute('aria-current', index === initialIndex ? 'page' : 'false');
      button.innerHTML = `<strong>${SBL.pokemon.escapeHtml(title)}</strong>`;
      nav.appendChild(button);

      const pane = document.createElement('section');
      pane.className = `admin-focused-section-pane${index === initialIndex ? ' active' : ''}`;
      pane.dataset.adminSectionPane = String(index);
      pane.setAttribute('aria-label', title);
      pane.appendChild(panel);
      body.appendChild(pane);
    });

    workspace.append(header, nav, body);
    host.appendChild(workspace);
    nav.addEventListener('click', event => {
      const button = event.target.closest('[data-admin-section-index]');
      if(!button) return;
      const index = button.dataset.adminSectionIndex;
      nav.querySelectorAll('[data-admin-section-index]').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-current', active ? 'page' : 'false');
      });
      body.querySelectorAll('.admin-focused-section-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.adminSectionPane === index));
      localStorage.setItem(storageKey, index);
    });
  }

  // jump to another tab programmatically
  function goToTab(tab){
    // Legacy User Control destinations now land in the consolidated workspace.
    activeTab = tab === 'commissioner' || tab === 'settings' ? 'people' : tab;
    tabsEl.querySelectorAll('.admin-nav-item').forEach(b=>b.classList.toggle('active', b.dataset.tab===activeTab));
    render();
  }

  async function renderOverview(){
    const replayCount = Object.keys(STATE.replays||{}).length;
    const leagueId=String(SBL.leagueDb?.selectedLeagueId?.()||'').trim();
    let franchises=[];
    try{
      if(!leagueId) throw new Error('No league is selected.');
      franchises=(await SBL.leagueDb.listFranchises(leagueId,supabase)).filter(f=>String(f.status||'active')==='active');
    }catch(e){ console.warn('League Dashboard franchise count unavailable:',e); }
    const users = new Set();
    Object.values(STATE.replays||{}).forEach(r=>{ ['p1','p2'].forEach(side=>{ const u=String(r?.players?.[side]||'').trim(); if(u) users.add(u); }); });
    const weeks = weeksList();
    const currentWeek = weeks.length ? weeks[weeks.length-1] : 'No week set';
    const finals = SBL.finals.normalizeFinalsState(STATE.settings.finals);
    const finalsGenerated = !!(finals && Array.isArray(finals.rounds) && finals.rounds.length && finals.status !== 'inactive');
    const finalsChampion = finals?.champion || '';
    const finalsStatus = finalsChampion ? `Champion: ${finalsChampion}` : finalsGenerated ? 'Finals in progress' : 'Not generated';

    contentEl.innerHTML = `
      <div class="admin-dashboard-hero">
        <div>
          <div class="admin-dashboard-kicker">League administration</div>
          <h2>${SBL.pokemon.escapeHtml(STATE.settings.activeSeason||DEFAULT_SEASON)}</h2>
          <div class="note">A calm overview of what is happening now, with the admin actions you are most likely to need.</div>
        </div>
        <div class="admin-dashboard-meta"><strong>${SBL.pokemon.escapeHtml(currentWeek)}</strong><span class="note">Current week</span></div>
      </div>

      <div class="admin-dashboard-grid">
        <section class="admin-dashboard-card">
          <h3>At a glance</h3>
          <div class="admin-dashboard-stats">
            <div class="admin-dashboard-stat"><div class="lbl">Franchises</div><div class="val">${franchises.length}</div></div>
            <div class="admin-dashboard-stat"><div class="lbl">Users</div><div class="val">${users.size}</div></div>
            <div class="admin-dashboard-stat"><div class="lbl">Processed replays</div><div class="val">${replayCount}</div></div>
            <div class="admin-dashboard-stat"><div class="lbl">Finals</div><div class="val">${SBL.pokemon.escapeHtml(finalsChampion ? 'Complete' : finalsGenerated ? 'Active' : 'Setup')}</div></div>
          </div>
          <div style="margin-top:14px;">
            <div class="admin-dashboard-status"><span class="note">Season</span><strong>${SBL.pokemon.escapeHtml(STATE.settings.activeSeason||DEFAULT_SEASON)}</strong></div>
            <div class="admin-dashboard-status"><span class="note">Finals status</span><strong>${SBL.pokemon.escapeHtml(finalsStatus)}</strong></div>
          </div>
        </section>

        <section class="admin-dashboard-card">
          <h3>Quick actions</h3>
          <div class="admin-quick-actions">
            <button class="admin-quick-action" data-overview-tab="process"><strong>Process replay</strong><span>→</span></button>
            <button class="admin-quick-action" data-overview-tab="seasonsetup"><strong>Manage season</strong><span>→</span></button>
            <button class="admin-quick-action" data-overview-tab="people"><strong>People &amp; Franchises</strong><span>→</span></button>
            <button class="admin-quick-action" data-overview-tab="bug-reports"><strong>Bug Reports &amp; Feedback</strong><span>→</span></button>
          </div>
        </section>
      </div>`;
    contentEl.querySelectorAll('[data-overview-tab]').forEach(btn=>btn.addEventListener('click',()=>goToTab(btn.dataset.overviewTab)));
  }


  async function renderBugReports(){
    requireAdmin();
    const escape=SBL.pokemon.escapeHtml;
    const leagueId=String(SBL.leagueDb?.selectedLeagueId?.()||'').trim();
    const statusLabel=value=>value==='in-progress'?'In progress':value==='resolved'?'Resolved':value==='wont-fix'?"Won't fix":'New';
    contentEl.innerHTML=`<section class="admin-section bug-reports-workspace">
      <div class="admin-section-title"><div><div class="admin-dashboard-kicker">League feedback</div><h2>Bug Reports &amp; Feedback</h2><div class="note">Submissions from the league dashboard are collected across current and archived seasons. Update their status as you review and resolve them.</div></div><button type="button" class="ghost small" id="refreshBugReports">Refresh</button></div>
      <div class="panel"><div id="bugReportList"><div class="empty-state">Loading feedback…</div></div><div id="bugReportStatus" class="note" aria-live="polite"></div></div>
    </section>`;
    const host=document.getElementById('bugReportList');
    const message=document.getElementById('bugReportStatus');
    let seasons=[];
    const collect=()=>seasons.flatMap(season=>{
      const feedback=Array.isArray(season.data?.settings?.feedback)?season.data.settings.feedback:[];
      return feedback.map(item=>({...item,_seasonId:season.id,_seasonName:season.name||'Archived season'}));
    }).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
    const draw=()=>{
      const rows=collect();
      host.innerHTML=rows.length?rows.map(item=>{
        const type=String(item.type||'bug').replace(/[^a-z0-9_-]/gi,'');
        const status=['new','in-progress','resolved','wont-fix'].includes(item.status)?item.status:'new';
        const created=item.createdAt?new Date(item.createdAt).toLocaleString():'Date unavailable';
        return `<article class="feedback-card admin-feedback-card"><div class="feedback-card-head"><div><div class="feedback-card-title">${escape(item.title||'Untitled submission')}</div><div class="feedback-meta">${escape(type.toUpperCase())} · ${escape(item.submittedBy||'Unknown account')}${item.team?' · '+escape(item.team):''} · ${escape(item._seasonName)} · ${escape(created)}</div></div><label class="admin-feedback-status">Status<select data-feedback-status="${escape(item.id||'')}" data-feedback-season="${escape(item._seasonId)}" data-previous-status="${status}"><option value="new" ${status==='new'?'selected':''}>New</option><option value="in-progress" ${status==='in-progress'?'selected':''}>In progress</option><option value="resolved" ${status==='resolved'?'selected':''}>Resolved</option><option value="wont-fix" ${status==='wont-fix'?'selected':''}>Won't fix</option></select></label></div><div class="admin-feedback-description">${escape(item.description||'No details supplied.')}</div></article>`;
      }).join(''):'<div class="empty-state">No bug reports or feedback have been submitted for this league yet.</div>';
    };
    const refresh=async()=>{
      if(!leagueId) throw new Error('Select a league before viewing feedback.');
      seasons=await SBL.leagueDb.listSeasons(leagueId,supabase);
      draw();
    };
    try{await refresh();}catch(error){host.innerHTML=`<div class="empty-state">Could not load feedback: ${escape(error.message||error)}</div>`;}
    document.getElementById('refreshBugReports')?.addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{await refresh();message.textContent='Feedback refreshed.';}
      catch(error){message.textContent=error?.message||'Could not refresh feedback.';}
      finally{button.disabled=false;}
    });
    host.addEventListener('change',async event=>{
      const control=event.target.closest('[data-feedback-status]');if(!control)return;
      const id=String(control.dataset.feedbackStatus||''),seasonId=String(control.dataset.feedbackSeason||''),next=String(control.value||'new'),previous=String(control.dataset.previousStatus||'new');
      const season=seasons.find(x=>String(x.id)===seasonId);
      const feedback=season?.data?.settings?.feedback;
      const row=Array.isArray(feedback)?feedback.find(x=>String(x.id||'')===id):null;
      if(!season||!row){control.value=previous;message.textContent='That submission could not be found. Refresh and try again.';return;}
      control.disabled=true;row.status=next;row.updatedAt=new Date().toISOString();
      try{
        const {error}=await supabase.from('league_seasons').update({data:season.data,updated_at:new Date().toISOString()}).eq('league_id',leagueId).eq('id',seasonId);
        if(error)throw error;
        const currentSeasonId=String(SBL.leagueDb?.selectedSeasonId?.(leagueId)||'');
        if(currentSeasonId===seasonId) STATE.settings.feedback=feedback;
        control.dataset.previousStatus=next;message.textContent=`Updated “${row.title||'submission'}” to ${statusLabel(next)}.`;
      }catch(error){row.status=previous;control.value=previous;message.textContent=error?.message||'Could not save the feedback status.';}
      finally{control.disabled=false;}
    });
  }

  async function renderLegacyMigration(preselectedSeasonId=''){
    const escape=SBL.pokemon.escapeHtml;contentEl.innerHTML='<div class="panel"><h2>Archived Seasons</h2><div class="sub">Loading replay archives…</div></div>';
    const leagueId=String(SBL.leagueDb?.selectedLeagueId?.()||'').trim();if(!leagueId){contentEl.innerHTML='<div class="panel"><h2>Archived Seasons</h2><div class="empty-state">Select a league first.</div></div>';return;}
    const archive=SBL.legacyArchive;if(!archive){contentEl.innerHTML='<div class="panel"><h2>Archived Seasons</h2><div class="err">Legacy archive service did not load. Refresh the page.</div></div>';return;}
    let seasons=[];try{seasons=await archive.list(leagueId);}catch(err){contentEl.innerHTML=`<div class="panel"><h2>Archived Seasons</h2><div class="err">${escape(err.message||err)}</div><p class="sub">Apply migrations 031 and 034 if this is a new database.</p></div>`;return;}
    contentEl.innerHTML=`<div class="admin-section archived-seasons-workspace">
      <div class="admin-section-title"><div><div class="admin-dashboard-kicker">Historical data</div><h2>Archived Seasons</h2><div class="note">Choose an existing archive or create a new one. Replay import, player assignments and alternate matching appear only after you select an archive.</div></div></div>
      <div class="archived-season-entry-grid">
        <div class="panel"><h3>Make a new archived season</h3><p class="sub">Create an empty historical archive first. You can add replays and assign players afterwards.</p><label for="legacyNewName">Season name</label><input id="legacyNewName" placeholder="Season 8"><label for="legacyNewLabel">Season label (optional)</label><input id="legacyNewLabel" placeholder="2023–24"><button class="primary" id="createLegacySeason">Create archived season</button><div class="log" id="legacyCreateLog"></div></div>
        <div class="panel"><h3>Archived seasons</h3><p class="sub">Select an archive to manage its replay data and historical identities.</p><label for="legacyTargetSeason">Select archived season</label><select id="legacyTargetSeason"><option value="">Choose an archived season…</option>${seasons.map(x=>`<option value="${escape(x.id)}">${escape(x.name)}${x.season_label?' — '+escape(x.season_label):''}</option>`).join('')}</select>${seasons.length?'': '<div class="empty-state">No archived seasons yet. Create one to get started.</div>'}</div>
      </div>
      <div id="legacyArchiveDetail"></div>
    </div>`;
    const selector=document.getElementById('legacyTargetSeason');
    if(preselectedSeasonId && seasons.some(x=>String(x.id)===String(preselectedSeasonId))) selector.value=String(preselectedSeasonId);
    document.getElementById('createLegacySeason')?.addEventListener('click',async()=>{const btn=document.getElementById('createLegacySeason'),log=document.getElementById('legacyCreateLog'),name=document.getElementById('legacyNewName').value.trim();if(!name){appendLog(log,'Enter a season name.',true);return;}btn.disabled=true;try{const created=await archive.create(leagueId,name,document.getElementById('legacyNewLabel').value);await renderLegacyMigration(created.id);}catch(e){appendLog(log,e.message||e,true);btn.disabled=false;}});
    const draw=async()=>{const seasonId=selector?.value,season=seasons.find(x=>x.id===seasonId),host=document.getElementById('legacyArchiveDetail');if(!host||!season){if(host)host.innerHTML='';return;}host.innerHTML='<div class="panel">Loading replay archive…</div>';try{const [players,mappings,suggestions,replays,accounts]=await Promise.all([archive.listPlayers(leagueId,seasonId),archive.listMappings(leagueId,seasonId),archive.listSuggestions(leagueId,seasonId),archive.listReplays(leagueId,seasonId),archive.listLeagueAccounts(leagueId)]);const mapped=new Map(mappings.map(m=>[m.username_key,m]));
      host.innerHTML=`<div class="panel"><h3>3. Import replay archive</h3><p class="sub">Paste one Showdown replay URL per line. Full private replay keys are retained. The replay data is stored in this historical archive only.</p><label for="legacyReplayFile">Replay list file (optional)</label><input type="file" id="legacyReplayFile" accept=".txt,.csv,.json,text/plain,text/csv,application/json"><p class="sub">You can also paste replay URLs below, one per line.</p><textarea id="legacyReplayUrls" rows="7" placeholder="https://replay.pokemonshowdown.com/gen9...\nhttps://replay.pokemonshowdown.com/gen9...-privatekey"></textarea><button class="primary" id="importLegacyReplays">Import replays</button><div class="log" id="legacyReplayLog"></div><h4>Imported replays (${replays.length})</h4>${replays.length?`<ul>${replays.map(r=>`<li><a target="_blank" rel="noopener" href="${escape(r.replay_url)}">${escape(r.replay_id)}</a> · ${escape(r.imported_at||'')}</li>`).join('')}</ul>`:'<p class="sub">No replays imported yet.</p>'}</div>
      <div class="panel"><h3>4. Assign historical players</h3><p class="sub">These usernames were discovered directly from replay archives. Give each player their historical team name. Linking an account is optional and only records historical identity; it does not grant league membership or alter current franchise ownership.</p>${players.length?`<div class="legacy-player-assignment-list">${players.map((p,i)=>{const m=mapped.get(String(p.username).toLowerCase().replace(/[^a-z0-9]+/g,''));return `<div class="panel legacy-player-row"><div><strong>${escape(p.username)}</strong><div class="sub">${p.replay_count} replay(s) · ${p.pokemon.length} observed Pokémon</div><details><summary>Observed Pokémon</summary><p class="sub">${escape(p.pokemon.join(', ')||'No Pokémon parsed')}</p></details></div><label>Historical team name<input data-legacy-team="${i}" value="${escape(m?.franchise_name||'')}" placeholder="Team name"></label><label>Link to league account (optional)<select data-legacy-account="${i}"><option value="">Do not link an account</option>${accounts.map(a=>`<option value="${escape(a.id)}" ${m?.account_user_id===a.id?'selected':''}>${escape(a.username)} · ${escape(a.membership_status)}</option>`).join('')}</select></label></div>`;}).join('')}</div><button class="primary" id="saveLegacyPlayers">Save player assignments</button> <button class="ghost" id="generateLegacyAlts">Find alternate usernames (>70% Pokémon overlap)</button><div class="log" id="legacyAssignmentLog"></div>`:'<p class="sub">Import replays to discover historical players here.</p>'}${mappings.length?`<h4>Saved assignments</h4><ul>${mappings.map(m=>`<li><b>${escape(m.showdown_username)}</b> → ${escape(m.franchise_name)}${m.account_user_id?' · linked to registered account':''}</li>`).join('')}</ul>`:''}</div>
      <div class="panel"><h3>5. Alternate username suggestions</h3><p class="sub">Suggestions compare Pokémon observed across archived replays. Matches must be strictly greater than 70%. They are never auto-approved; an admin must review them.</p>${suggestions.length?suggestions.map((r,i)=>`<div class="panel"><b>${escape(r.showdown_username)}</b> may be an alternate for ${escape(r.evidence?.reference_username||'')} · ${escape(r.franchise_name)} · ${(Number(r.match_ratio)*100).toFixed(1)}% overlap<p class="sub">Matched Pokémon: ${escape((r.evidence?.matched_pokemon||[]).join(', '))}</p>${r.status==='pending'?`<button class="primary" data-legacy-approve="${i}">Approve and assign</button> <button class="danger" data-legacy-reject="${i}">Reject</button>`:`<span class="sub">${escape(r.status)}</span>`}</div>`).join(''):'<p class="sub">No suggestions yet. Save at least one player assignment, then run alternate detection.</p>'}</div>`;
      document.getElementById('legacyReplayFile')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{const text=await file.text();let values=[];if(file.name.toLowerCase().endsWith('.json')){const parsed=JSON.parse(text);values=Array.isArray(parsed)?parsed:(parsed.replays||parsed.urls||[]);values=values.map(x=>typeof x==='string'?x:(x.url||x.replay_url||x.replay_id||''));}else{const tokens=text.split(/[\r\n,]+/).map(x=>x.trim().replace(/^['\"]|['\"]$/g,''));values=tokens.filter(x=>/^https?:\/\/replay\.pokemonshowdown\.com\//i.test(x)||/^[a-z0-9]+-[0-9]+(?:-[a-z0-9]+)?$/i.test(x));}const urls=values.filter(Boolean).join('\n');document.getElementById('legacyReplayUrls').value=urls;const log=document.getElementById('legacyReplayLog');appendLog(log,`Loaded ${urls.split(/\r?\n/).filter(x=>x.trim()).length} replay reference(s) from ${file.name}.`,false,true);}catch(err){appendLog(document.getElementById('legacyReplayLog'),'Could not read replay list: '+(err.message||err),true);}});
      document.getElementById('importLegacyReplays')?.addEventListener('click',async()=>{const btn=document.getElementById('importLegacyReplays'),log=document.getElementById('legacyReplayLog'),urls=document.getElementById('legacyReplayUrls').value;if(!urls.trim()){appendLog(log,'Paste at least one replay URL.',true);return;}btn.disabled=true;try{const result=await archive.importUrls(leagueId,seasonId,urls,msg=>appendLog(log,msg,false,true));appendLog(log,`Imported ${result.length} replay(s). Discovered ${new Set(result.flatMap(x=>x.evidence.players)).size} player usernames.`,false,true);await draw();}catch(e){appendLog(log,'Import failed: '+(e.message||e),true);}finally{btn.disabled=false;}});
      document.getElementById('saveLegacyPlayers')?.addEventListener('click',async()=>{const log=document.getElementById('legacyAssignmentLog'),rows=players.map((p,i)=>({username:p.username,franchise:document.querySelector(`[data-legacy-team="${i}"]`)?.value.trim(),account_user_id:document.querySelector(`[data-legacy-account="${i}"]`)?.value||'',evidence:{replay_count:p.replay_count,observed_pokemon:p.pokemon}})).filter(x=>x.franchise);if(!rows.length){appendLog(log,'Assign at least one historical team name.',true);return;}try{await archive.saveMappings(leagueId,seasonId,rows);appendLog(log,`Saved ${rows.length} historical player assignment(s).`,false,true);await draw();}catch(e){appendLog(log,e.message||e,true);}});
      document.getElementById('generateLegacyAlts')?.addEventListener('click',async()=>{const btn=document.getElementById('generateLegacyAlts'),log=document.getElementById('legacyAssignmentLog');btn.disabled=true;try{const rows=await archive.generateSuggestions(leagueId,seasonId);appendLog(log,`Generated ${rows.length} alternate username suggestion(s).`,false,true);await draw();}catch(e){appendLog(log,e.message||e,true);}finally{btn.disabled=false;}});
      suggestions.forEach((r,i)=>{host.querySelector(`[data-legacy-approve="${i}"]`)?.addEventListener('click',async()=>{if(!confirm(`Assign ${r.showdown_username} to ${r.franchise_name} as a possible alternate?`))return;try{await archive.reviewSuggestion(leagueId,r,true);await draw();}catch(e){alert(e.message||e);}});host.querySelector(`[data-legacy-reject="${i}"]`)?.addEventListener('click',async()=>{try{await archive.reviewSuggestion(leagueId,r,false);await draw();}catch(e){alert(e.message||e);}});});
      applyAdminSectionWorkspace(host, 'legacy-archive-detail', 'Historical archive workspace');
    }catch(e){host.innerHTML=`<div class="panel"><div class="err">${escape(e.message||e)}</div></div>`;}};
    selector?.addEventListener('change',draw);if(selector?.value)await draw();
  }

  function renderProcess(){
    const count = Object.keys(STATE.replays).length;
    contentEl.innerHTML = `
      <div class="panel">
        <h2>Add replays</h2>
        <label>Showdown replay links (one per line)</label>
        <textarea id="urlsInput" placeholder="https://replay.pokemonshowdown.com/gen9natdexdraft-xxxxxxxx"></textarea>
        <div class="sub" style="margin-top:10px;">Weeks are assigned automatically from the replay date, Monday through Sunday. You can manually override an individual replay below.</div>
        <button class="primary" id="processBtn">Process replays</button>
        <div class="log" id="processLog"></div>
      </div>
      <div class="panel">
        <h2>Processed this season <span class="badge">${count} replays</span></h2>
        <div class="foot-actions" style="margin:10px 0 14px;"><button type="button" class="danger" id="removeAllSeasonReplays" ${count===0 ? "disabled" : ""}>Remove all replays from this season</button><span class="sub">Only replay rows in the currently selected season are removed. Season settings and rosters are kept.</span></div>
        ${count===0 ? `<div class="empty-state">Nothing processed yet — paste some replay links above.</div>` : `
          <div class="foot-actions" style="margin-top:0; margin-bottom:12px;">
            <button type="button" class="ghost" id="reprocessAll">Reprocess all replays (re-fetches &amp; re-parses everything)</button>
          </div>
          <div class="replay-filter-card">
            <div class="replay-filter-head">
              <div>
                <div class="replay-filter-title">Filter replays</div>
                <div class="replay-filter-help">Narrow the processed replay list by week and/or franchise. A franchise may have multiple Showdown usernames.</div>
              </div>
              <button type="button" class="ghost small" id="clearReplayFilters">Clear</button>
            </div>
            <div class="replay-filter-grid admin-filter-grid">
              <div><label for="replayWeekFilter">Week</label><select id="replayWeekFilter"><option value="ALL">All weeks</option>${weeksList().map(w=>`<option value="${SBL.pokemon.escapeHtml(w)}">${SBL.pokemon.escapeHtml(w)}</option>`).join('')}</select></div>
              <div><label for="replayFranchiseFilter">Franchise</label><select id="replayFranchiseFilter"><option value="ALL">All franchises</option>${replayFranchisesList().map(f=>`<option value="${SBL.pokemon.escapeHtml(f)}">${SBL.pokemon.escapeHtml(f)}</option>`).join('')}</select></div>
            </div>
          </div>
          <div id="processedReplayTable">${renderReplayTable()}</div>`}
      </div>
    `;
    document.getElementById('processBtn').addEventListener('click', async ()=>{
      const btn = document.getElementById('processBtn');
      const input = document.getElementById('urlsInput');
      const logEl = document.getElementById('processLog');
      if(!btn || !input || !logEl) return;
      const urls = input.value || '';
      logEl.innerHTML = '';
      btn.disabled = true;
      try{
        await processUrls(urls, logEl);
      }catch(e){
        console.error('Process replays failed:', e);
        appendLog(logEl, `Process replays failed: ${e?.message || e}`, true);
      }finally{
        btn.disabled = false;
      }
    });
    const weekFilter = document.getElementById('replayWeekFilter');
    const franchiseFilter = document.getElementById('replayFranchiseFilter');
    const replayTableHost = document.getElementById('processedReplayTable');
    function redrawReplayTable(){
      if(replayTableHost) replayTableHost.innerHTML = renderReplayTable(weekFilter?.value || 'ALL', franchiseFilter?.value || 'ALL');
    }
    weekFilter?.addEventListener('change', redrawReplayTable);
    franchiseFilter?.addEventListener('change', redrawReplayTable);
    document.getElementById('clearReplayFilters')?.addEventListener('click', ()=>{
      if(weekFilter) weekFilter.value='ALL';
      if(franchiseFilter) franchiseFilter.value='ALL';
      redrawReplayTable();
    });
    const removeAllBtn = document.getElementById('removeAllSeasonReplays');
    removeAllBtn?.addEventListener('click', async ()=>{
      const seasonName = STATE.settings.activeSeason || 'the selected season';
      const total = Object.keys(STATE.replays || {}).length;
      if(!total) return;
      if(!confirm(`Permanently remove all ${total} processed replays from ${seasonName}? This does not delete rosters or season settings.`)) return;
      removeAllBtn.disabled = true;
      try{
        await deleteAllRemote();
        STATE.replays = {};
        await logAdminAction('remove_season_replays', `Removed ${total} replay(s) from ${seasonName}.`, {season:seasonName,count:total});
        render();
      }catch(err){
        alert('Could not remove season replays: ' + (err?.message || err));
        removeAllBtn.disabled = false;
      }
    });
    const reBtn = document.getElementById('reprocessAll');
    if(reBtn) reBtn.addEventListener('click', async (event)=>{
      event.preventDefault();
      reBtn.disabled = true;
      const logEl = document.getElementById('processLog');
      try{
        await reprocessAll(logEl);
      }catch(e){
        appendLog(logEl, `Reprocess failed: ${e.message}`, true);
        console.error('Reprocess failed:', e);
      }finally{
        reBtn.disabled = false;
      }
    });
  }
  async function reprocessAll(logEl){
    if(!logEl) logEl = document.getElementById('processLog');
    appendLog(logEl, 'Starting replay reprocessing…', false, true);
    try{
      try { await SBL.replays.ensureMoveAccuracyData?.(); } catch (_) { /* optional enrichment */ }
    }catch(e){
      appendLog(logEl, `Move data unavailable — continuing without accuracy-sensitive luck: ${e.message}`, true);
      MOVE_DATA = {};
    }
    const ids = Object.keys(STATE.replays || {});
    if(!ids.length){
      appendLog(logEl, 'No processed replays found.', true);
      return;
    }
    let ok=0, failed=0;
    for(const id of ids){
      const oldReplay = STATE.replays[id];
      try{
        const resp = await fetch(`https://replay.pokemonshowdown.com/${id}.json`);
        if(!resp.ok) throw new Error('not found (' + resp.status + ')');
        const json = await resp.json();
        const parsed = SBL.replays.parseLog(json, id);
        parsed.uploadtime = json.uploadtime;
        // Preserve a manual week exactly. Failed fetch/parse leaves oldReplay
        // untouched, so reprocessing can never destroy an existing replay.
        parsed.weekOverride = !!oldReplay.weekOverride;
        parsed.week = oldReplay.weekOverride
          ? (oldReplay.week || 'Unassigned')
          : automaticWeekForReplay(parsed);
        parsed.processedAt = oldReplay.processedAt;
        STATE.replays[id] = parsed;
        appendLog(logEl, `✓ reprocessed ${id}`, false, true);
        ok++;
      }catch(e){
        appendLog(logEl, `✗ ${id} — ${e.message} (existing replay preserved)`, true);
        failed++;
      }
    }
    if(ok > 0){
      assignAutomaticWeeks();
      await saveSettings();
      await saveReplays();
    }
    try{
      await logAdminAction(
        'reprocess_replays',
        `Reprocessed all replays: ${ok} updated, ${failed} failed.`,
        {updated: ok, failed}
      );
    }catch(e){
      appendLog(logEl, `Admin log update failed: ${e.message}`, true);
    }
    appendLog(logEl, `Reprocess complete. ${ok} updated, ${failed} failed.`, false);
    renderTicker();
    render();
  }

  function replayFranchisesList(){
    const franchises = new Set();
    Object.values(STATE.replays).forEach(r=>{
      if(!r?.players) return;
      ['p1','p2'].forEach(side=>{
        const name = String(teamFor(r.players[side]) || '').trim();
        if(name) franchises.add(name);
      });
    });
    // Include configured franchises even if they have no processed replay yet.
    configuredFranchises().forEach(f=>{ if(f?.name) franchises.add(f.name); });
    return Array.from(franchises).sort((a,b)=>a.localeCompare(b));
  }
  function renderReplayTable(weekFilter='ALL', franchiseFilter='ALL'){
    const list = Object.values(STATE.replays)
      .filter(r => weekFilter === 'ALL' || String(r.week||'Unassigned') === String(weekFilter))
      .filter(r => {
        if(franchiseFilter === 'ALL') return true;
        const p1 = String(teamFor(r.players?.p1)||'').trim();
        const p2 = String(teamFor(r.players?.p2)||'').trim();
        return p1 === String(franchiseFilter) || p2 === String(franchiseFilter);
      })
      .sort((a,b)=>b.processedAt-a.processedAt);
    const rows = list.map(r => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px;min-width:210px;flex-wrap:wrap;">
            <input type="text" class="week-override-input" data-week-id="${SBL.pokemon.escapeHtml(r.id)}" value="${SBL.pokemon.escapeHtml(r.week||'Unassigned')}" placeholder="Week 1">
            ${r.weekOverride ? '<span class="badge" title="Manual week override — reprocessing will preserve this week">Manual</span>' : '<span class="badge" title="Automatically assigned from replay upload date">Auto</span>'}
          </div>
        </td>
        <td>
          <div class="replay-matchup-cell">
            <div class="replay-player-map">
              <span class="replay-player-name">${SBL.pokemon.escapeHtml(r.players.p1||'?')}</span>
              <select class="replay-franchise-select" data-replay-team="${SBL.pokemon.escapeHtml(r.id)}" data-side="p1" aria-label="Franchise for ${SBL.pokemon.escapeHtml(r.players.p1||'?')}">
                <option value="">Unassigned</option>${franchiseOptions(teamFor(r.players?.p1))}
              </select>
            </div>
            <span class="replay-vs">vs</span>
            <div class="replay-player-map">
              <span class="replay-player-name">${SBL.pokemon.escapeHtml(r.players.p2||'?')}</span>
              <select class="replay-franchise-select" data-replay-team="${SBL.pokemon.escapeHtml(r.id)}" data-side="p2" aria-label="Franchise for ${SBL.pokemon.escapeHtml(r.players.p2||'?')}">
                <option value="">Unassigned</option>${franchiseOptions(teamFor(r.players?.p2))}
              </select>
            </div>
          </div>
        </td>
        <td style="color:var(--text-dim)">${SBL.pokemon.escapeHtml(r.format||'')}</td>
        <td class="num" style="white-space:nowrap;"><button class="ghost small" data-save-week="${SBL.pokemon.escapeHtml(r.id)}">Save week</button> <button class="ghost small" data-save-replay-franchises="${SBL.pokemon.escapeHtml(r.id)}">Save franchises</button> ${r.weekOverride ? `<button class="ghost small" data-auto-week="${SBL.pokemon.escapeHtml(r.id)}">Auto</button>` : ''} <button class="ghost small danger-btn" data-remove="${SBL.pokemon.escapeHtml(r.id)}">Remove</button></td>
      </tr>`).join('');
    setTimeout(()=>{
      document.querySelectorAll('[data-save-week]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const id = btn.dataset.saveWeek; const replay = STATE.replays[id];
          const input = document.querySelector(`[data-week-id="${CSS.escape(id)}"]`);
          if(!replay || !input) return;
          const week = input.value.trim() || 'Unassigned'; replay.week = week; replay.weekOverride = true;
          await saveReplays(); await logAdminAction('set_replay_week', `Set replay ${id} to ${week} (manual week override).`, {replayId:id, week}); renderTicker(); render();
        });
      });
      document.querySelectorAll('[data-auto-week]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const id = btn.dataset.autoWeek; const replay = STATE.replays[id]; if(!replay) return;
          replay.weekOverride = false; replay.week = automaticWeekForReplay(replay); assignAutomaticWeeks();
          await saveReplays(); await logAdminAction('restore_replay_auto_week', `Restored automatic week assignment for replay ${id}.`, {replayId:id, week:replay.week}); renderTicker(); render();
        });
      });
      document.querySelectorAll('[data-save-replay-franchises]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const id = btn.dataset.saveReplayFranchises;
          const replay = STATE.replays[id];
          if(!replay) return;
          const selects = document.querySelectorAll(`[data-replay-team="${CSS.escape(id)}"]`);
          for(const select of selects){
            const side = select.dataset.side;
            const username = String(replay.players?.[side] || '').trim().toLowerCase();
            const franchise = String(select.value || '').trim();
            if(username){
              if(franchise) STATE.teamMap[username] = franchise;
              else delete STATE.teamMap[username];
            }
          }
          await saveTeamMap();
          await logAdminAction('set_replay_franchises', `Assigned replay ${id} players to franchises.`, {
            replayId:id, p1:teamFor(replay.players?.p1), p2:teamFor(replay.players?.p2)
          });
          renderTicker();
          render();
        });
      });
      document.querySelectorAll('[data-remove]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const id = btn.dataset.remove; const replay = STATE.replays[id]; delete STATE.replays[id]; await deleteReplayRemote(id);
          await logAdminAction('remove_replay', `Removed processed replay ${id}.`, {replayId:id, players: replay?.players || null}); renderTicker(); render();
        });
      });
    }, 0);
    return rows ? `<table><thead><tr><th>Week</th><th>Matchup</th><th>Format</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty-state">No replays match these filters.</div>`;
  }

  function weekSort(a,b){
    const sa=String(a??''), sb=String(b??'');
    const na=parseInt(sa.match(/\d+/)?.[0]||'',10);
    const nb=parseInt(sb.match(/\d+/)?.[0]||'',10);
    const aNum=Number.isFinite(na), bNum=Number.isFinite(nb);
    if(aNum && bNum && na!==nb) return na-nb;
    if(aNum!==bNum) return aNum ? -1 : 1;
    if(sa==='Unassigned') return 1; if(sb==='Unassigned') return -1;
    return sa.localeCompare(sb,undefined,{numeric:true,sensitivity:'base'});
  }
  function weekSelectorHtml(id){
    const weeks = weeksList().sort(weekSort);
    return `<select id="${id}">
      <option value="ALL">All season</option>
      <option value="LAST4">Last 4 games</option>
      ${weeks.map(w=>`<option value="${SBL.pokemon.escapeHtml(w)}">${SBL.pokemon.escapeHtml(w)}</option>`).join('')}
    </select>`;
  }

  function renderLeaderboards(){
    contentEl.innerHTML = `
      <div class="panel">
        <h2>Damage Leaderboard</h2>
        <div class="row" style="align-items:flex-end;">
          <div><label>Scope</label>${weekSelectorHtml('globalWeek')}</div>
          <div style="flex:0;"><button class="ghost" id="exportGlobal">Export CSV</button></div>
        </div>
        <div id="globalTable"></div>
      </div>`;


    const sel = document.getElementById('globalWeek');
    function drawGlobal(){
      const stats = globalPokemonStats(sel.value);
      document.getElementById('globalTable').innerHTML = stats.length===0 ? `<div class="empty-state">No data for this scope yet.</div>` :
        `<table><thead><tr><th class="rank">#</th><th>Pokémon</th><th class="num">Dmg Dealt</th><th class="num">Dmg Taken</th><th class="num">Kills</th><th class="num">Assists</th><th class="num">Deaths</th><th class="num">Games</th><th class="num">Avg Dmg/Game</th></tr></thead><tbody>
        ${stats.map((s,i)=>`<tr>
          <td class="rank">${i+1}</td>
          <td class="pname"><div class="pname-cell">${SBL.pokemon.spriteMarkup(s.species,'sprite-xl')}${SBL.pokemon.escapeHtml(SBL.pokemon.displayName(s.species))}</div></td>
          <td class="num dealt">${s.dealt.toFixed(1)}</td>
          <td class="num taken">${s.taken.toFixed(1)}</td>
          <td ${auditAttr(s.species,'kills',s.killLog)}>${s.kills}</td>
          <td ${auditAttr(s.species,'assists',s.assistLog)}>${s.assists}</td>
          <td ${auditAttr(s.species,'deaths',s.deathLog)}>${s.deaths}</td>
          <td class="num">${s.games}</td>
          <td class="num">${(s.games? s.dealt/s.games:0).toFixed(1)}</td>
        </tr>`).join('')}</tbody></table>`;
    }
    sel.addEventListener('change', drawGlobal);
    document.getElementById('exportGlobal').addEventListener('click', ()=> exportGlobalCSV(sel.value, sel.value==='ALL'?'Season':sel.value));
    drawGlobal();
  }

  function renderGoldenFist(){
    contentEl.innerHTML = `
      <div class="panel gf-panel">
        <h2>🥇 Golden Fist</h2>
        <div class="row" style="align-items:flex-end;">
          <div><label>Scope</label>${weekSelectorHtml('gfWeek')}</div>
          <div style="flex:0;"><button class="ghost" id="exportGF">Export CSV</button></div>
        </div>
        <div class="note" style="margin-bottom:12px;">Ranked by Kills − Deaths. Ties broken by total kills.</div>
        <div id="gfList"></div>
      </div>`;

    const gfSel = document.getElementById('gfWeek');
    function drawGF(){
      const stats = globalPokemonStats(gfSel.value)
        .map(s => ({...s, diff: s.kills - s.deaths}))
        .sort((a,b)=> b.diff - a.diff || b.kills - a.kills);
      const el = document.getElementById('gfList');
      if(stats.length === 0){ el.innerHTML = `<div class="empty-state">No data for this scope yet.</div>`; return; }
      const medals = ['🥇','🥈','🥉'];
      el.innerHTML = `<div class="gf-list">${stats.map((s,i)=>`
        <div class="gf-row ${i<3?'top'+(i+1):''} auditable-row" ${auditDataAttr(s.species,'kills',s.killLog,false)}>
          <div class="gf-rank">${medals[i] || (i+1)}</div>
          ${SBL.pokemon.spriteMarkup(s.species,'gf-sprite')}
          <div class="gf-info">
            <div class="gf-name">${SBL.pokemon.escapeHtml(SBL.pokemon.displayName(s.species))}</div>
            <div class="gf-coach">${SBL.pokemon.escapeHtml(Array.from(s.coaches).sort().join(', '))}</div>
            <div class="gf-sub">${s.kills} kills · ${s.assists} assists · ${s.deaths} deaths · ${s.games} games</div>
          </div>
          <div class="gf-diff ${s.diff<0?'neg':''}">${s.diff>0?'+':''}${s.diff}</div>
        </div>`).join('')}</div>`;
    }
    gfSel.addEventListener('change', drawGF);
    document.getElementById('exportGF').addEventListener('click', ()=>{
      const stats = globalPokemonStats(gfSel.value).map(s=>({...s, diff:s.kills-s.deaths})).sort((a,b)=>b.diff-a.diff || b.kills-a.kills);
      const rows = [['Rank','Pokemon','Kills','Deaths','Differential','Games Played','Coach(es)']];
      stats.forEach((s,i)=> rows.push([i+1, s.species, s.kills, s.deaths, s.diff, s.games, Array.from(s.coaches).sort().join('; ')]));
      download(`Golden Fist - ${gfSel.value==='ALL'?'Season':gfSel.value}.csv`, toCSV(rows));
    });
    drawGF();
  }

  function renderTeams(){
    const teams = Object.keys(teamPokemonStats('ALL')).sort();
    contentEl.innerHTML = `
      <div class="panel">
        <h2>Franchise Stats</h2>
        <div class="row" style="align-items:flex-end;">
          <div><label>Scope</label>${weekSelectorHtml('teamsWeek')}</div>
          <div><label>Team</label><select id="teamSelect">${teams.map(t=>`<option>${SBL.pokemon.escapeHtml(t)}</option>`).join('')}</select></div>
          <div style="flex:0;"><button class="ghost" id="exportTeams">Export all teams (CSV)</button></div>
        </div>
        ${teams.length===0 ? `<div class="empty-state">No replays processed yet.</div>` : `<div class="note" id="coachLine" style="margin:-6px 0 14px;"></div><div id="teamTable"></div>`}
      </div>`;
    if(teams.length===0) return;
    const weekSel = document.getElementById('teamsWeek');
    const teamSel = document.getElementById('teamSelect');
    function draw(){
      const coaches = usernamesForTeamLabel(teamSel.value);
      document.getElementById('coachLine').innerHTML = coaches.length===0 ? '' :
        `Coached by <strong>${coaches.map(SBL.pokemon.escapeHtml).join(', ')}</strong>`;
      const data = teamPokemonStats(weekSel.value);
      const list = Object.values(data[teamSel.value]||{}).sort((a,b)=>b.dealt-a.dealt);
      document.getElementById('teamTable').innerHTML = list.length===0 ? `<div class="empty-state">No data for this team/scope.</div>` :
        `<table><thead><tr><th class="rank">#</th><th>Pokémon</th><th class="num">Dmg Dealt</th><th class="num">Dmg Taken</th><th class="num">Kills</th><th class="num">Assists</th><th class="num">Deaths</th><th class="num">Appearances</th></tr></thead><tbody>
        ${list.map((s,i)=>`<tr>
          <td class="rank">${i+1}</td>
          <td class="pname"><div class="pname-cell">${SBL.pokemon.spriteMarkup(s.species,'sprite-xl')}${SBL.pokemon.escapeHtml(SBL.pokemon.displayName(s.species))}</div></td>
          <td class="num dealt">${s.dealt.toFixed(1)}</td>
          <td class="num taken">${s.taken.toFixed(1)}</td>
          <td ${auditAttr(s.species,'kills',s.killLog)}>${s.kills}</td>
          <td ${auditAttr(s.species,'assists',s.assistLog)}>${s.assists}</td>
          <td ${auditAttr(s.species,'deaths',s.deathLog)}>${s.deaths}</td>
          <td class="num">${s.games}</td>
        </tr>`).join('')}</tbody></table>`;
    }
    weekSel.addEventListener('change', draw);
    teamSel.addEventListener('change', draw);
    document.getElementById('exportTeams').addEventListener('click', ()=> exportTeamCSVs(weekSel.value, weekSel.value==='ALL'?'Season':weekSel.value));
    draw();
  }

  // ---------- replays grouped by player ----------
  function playerReplayGroups(){
    const groups = {}; // lowercase username -> {label, team, replays:[]}
    for(const r of Object.values(STATE.replays)){
      if(!r || !r.players) continue;
      for(const side of ['p1','p2']){
        const uname = (r.players[side]||'').trim();
        if(!uname) continue;
        const key = usernameKey(uname);
        if(!groups[key]) groups[key] = { label: uname, team: teamFor(uname), replays: [] };
        const oppSide = side === 'p1' ? 'p2' : 'p1';
        groups[key].replays.push({
          id: r.id,
          week: r.week || 'Unassigned',
          format: r.format || '',
          opponent: (r.players[oppSide] || '?').trim() || '?',
          processedAt: r.processedAt || 0
        });
      }
    }
    return Object.values(groups).sort((a,b)=> a.label.localeCompare(b.label));
  }

  function renderPlayers(){
    const groups = playerReplayGroups();
    contentEl.innerHTML = `
      <div class="panel">
        <h2>Replays by Player</h2>
        <div class="note">Every processed replay this season, grouped by Showdown username. Click a player to expand their list.</div>
        ${groups.length===0 ? `<div class="empty-state">No replays processed yet.</div>` : `
          <input type="text" id="playerFilter" class="player-filter" placeholder="Filter by username or team…">
          <div id="playerGroups"></div>`}
      </div>`;
    if(groups.length===0) return;

    const wrap = document.getElementById('playerGroups');
    function draw(filter){
      const f = (filter||'').trim().toLowerCase();
      const filtered = !f ? groups : groups.filter(g =>
        g.label.toLowerCase().includes(f) || g.team.toLowerCase().includes(f));
      wrap.innerHTML = filtered.length===0 ? `<div class="empty-state">No players match "${SBL.pokemon.escapeHtml(filter)}".</div>` :
        filtered.map(g=>{
          const list = g.replays.slice().sort((a,b)=> b.processedAt - a.processedAt);
          return `<details class="player-group">
            <summary><span class="pg-name">${SBL.pokemon.escapeHtml(g.label)}</span><span class="pg-team badge">${SBL.pokemon.escapeHtml(g.team)}</span><span class="badge">${list.length} replay${list.length===1?'':'s'}</span></summary>
            <div class="player-table-wrap">
              <table><thead><tr><th>Week</th><th>Opponent</th><th>Format</th><th></th></tr></thead><tbody>
                ${list.map(rp=>`<tr>
                  <td>${SBL.pokemon.escapeHtml(rp.week)}</td>
                  <td>${SBL.pokemon.escapeHtml(rp.opponent)}</td>
                  <td style="color:var(--text-dim)">${SBL.pokemon.escapeHtml(rp.format)}</td>
                  <td class="num"><a class="nav-link" href="https://replay.pokemonshowdown.com/${SBL.pokemon.escapeHtml(rp.id)}" target="_blank" rel="noopener">View replay</a></td>
                </tr>`).join('')}
              </tbody></table>
            </div>
          </details>`;
        }).join('');
    }
    document.getElementById('playerFilter').addEventListener('input', (e)=> draw(e.target.value));
    draw('');
  }


  function rosterKey(s){
    return String(s||'').trim().toLowerCase().replace(/[\s_-]+/g,'');
  }

  function normalizeRosterName(name){
    return String(name || '').replace(/[_]+/g,' ').replace(/\s+/g,' ').trim();
  }

  function parseRosterWorkbook(wb){
    const out = {};
    const teamHeaders = ['team','franchise','team name','franchise name'];
    const monHeaders = ['pokemon','pokémon','species','pokemon species','pick','roster'];

    for(const sheetName of wb.SheetNames){
      const sheet = wb.Sheets[sheetName];
      if(!sheet) continue;

      const rows = XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
      if(!rows.length) continue;

      const headers = rows[0].map(v => String(v).trim().toLowerCase());
      const teamCol = headers.findIndex(h => teamHeaders.includes(h));
      const monCol = headers.findIndex(h => monHeaders.includes(h));

      // The attached Season 15 workbook uses one team per sheet, with
      // points in Column A and Pokémon in Column C. Preserve those points.
      const isPointAndNameLayout = rows.some(row =>
        !Number.isNaN(Number(row?.[0])) && String(row?.[2] ?? '').trim()
      );

      if(isPointAndNameLayout){
        const team = normalizeRosterName(sheetName);
        const mons = [];
        for(const row of rows){
          const name = normalizeRosterName(row?.[2]);
          const points = Number(row?.[0]);
          if(!name || Number.isNaN(points)) continue;
          if(!mons.some(x => rosterKey(x.name) === rosterKey(name))){
            mons.push({name, points});
          }
        }
        if(team && mons.length) out[team] = mons;
        continue;
      }

      // Also support the more generic Team/Franchise + Pokémon/Species format.
      const defaultTeam = normalizeRosterName(sheetName);
      for(let r=1;r<rows.length;r++){
        const row=rows[r];
        const team=normalizeRosterName(teamCol>=0 ? row[teamCol] : defaultTeam);
        if(!team) continue;

        const values=[];
        if(monCol>=0){
          const value=normalizeRosterName(row[monCol]);
          if(value) values.push({name:value, points:null});
        }else{
          for(let c=0;c<row.length;c++){
            if(c===teamCol) continue;
            const value=normalizeRosterName(row[c]);
            if(value) values.push({name:value, points:null});
          }
        }

        if(!out[team]) out[team]=[];
        values.forEach(mon=>{
          if(/^(pokemon|pokémon|species|name|pick|roster)$/i.test(mon.name)) return;
          if(!out[team].some(x=>rosterKey(x.name)===rosterKey(mon.name))){
            out[team].push(mon);
          }
        });
      }
    }

    Object.keys(out).forEach(team=>{
      out[team].sort((a,b)=>a.name.localeCompare(b.name));
      if(!out[team].length) delete out[team];
    });
    return out;
  }

  function normalizeStoredRosters(rosters){
    const out = {};
    for(const [team, list] of Object.entries(rosters || {})){
      out[team] = (Array.isArray(list) ? list : []).map(mon => {
        if(typeof mon === 'string') return {name:mon, points:null};
        return {name:String(mon?.name ?? ''), points:mon?.points ?? null};
      }).filter(mon => mon.name);
    }
    return out;
  }

  function rosterDisplay(mon){
    const points = mon?.points;
    return `${SBL.pokemon.escapeHtml(mon?.name || '')}${points == null || points === '' ? '' : ` (${SBL.pokemon.escapeHtml(points)} pts)`}`;
  }

  async function publishRosters(rosters){
    const context={leagueId:String(SBL.leagueDb?.selectedLeagueId?.()||'').trim(),seasonId:String(SBL.leagueDb?.selectedSeasonId?.()||'').trim()};
    if(!context.leagueId) throw new Error('No league is selected. Return to the league selector, choose the league, then reopen roster publishing.');
    if(!context.seasonId) throw new Error('No season is selected for this league. Reload the admin page and confirm the active season before publishing.');
    const normalized = normalizeStoredRosters(rosters);
    if(!Object.keys(normalized).length) throw new Error('No rosters to publish.');

    STATE.settings = STATE.settings || {};
    STATE.settings.rosters = normalized;

    // These two writes intentionally remain separate: dashboard state contains
    // all admin settings, while __rosters__ is the public roster-page contract.
    await saveSharedState(context);
    await savePublishedRosters(normalized,context);
    await logAdminAction(
      'publish_rosters',
      `Published rosters for ${Object.keys(normalized).length} franchise${Object.keys(normalized).length===1?'':'s'}.`,
      {franchises:Object.keys(normalized), rosterCounts:Object.fromEntries(Object.entries(normalized).map(([team,list])=>[team,list.length]))}
    );
  }

  // ---------- Draft ----------
  // Setup lives here (board, budgets, order, mode, start/reset). Making picks
  // happens on the separate draft.html "Draft Room" page, which reads/writes
  // the same STATE.settings.draft blob plus STATE.settings.rosters.
  let DRAFT_ROUND_BUILDER = [];
  let ACTIVE_MEMBER_FRANCHISES = [];
  let ACTIVE_LEAGUE_FRANCHISES = [];
  let ACTIVE_SEASON_SITOUT_USERS = new Set();
  let ACTIVE_MEMBER_FRANCHISES_LOADED = false;
  // Draft picks are commissioner-managed; user-side authorised pickers are disabled.

  function genDraftId(){
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function draftFranchises(){
    // Lottery/draft eligibility is exactly the current active player membership
    // + franchise assignment set. Never use stale saved lottery names or maps.
    if(!ACTIVE_MEMBER_FRANCHISES_LOADED) return [];
    return [...new Set(ACTIVE_MEMBER_FRANCHISES.map(f=>String(f.name||'').trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b, undefined, {sensitivity:'base'}));
  }

  async function saveDraft(){
    requireAdmin();
    const result = await SBL.draft.saveDraftState(STATE.settings.draft);
    if(result?.state){
      STATE.teamMap = result.state.teamMap || STATE.teamMap || {};
      STATE.settings = Object.assign(STATE.settings, result.state.settings || {});
      STATE.settings.rosters = STATE.settings.rosters || {};
      STATE.settings.draft = normalizeDraftState(STATE.settings.draft);
    }
    return result;
  }

  // Live draft synchronization for the commissioner page. The Draft Room is
  // authoritative for participant actions; Admin must reread the shared draft
  // state whenever another browser advances the clock so the commissioner
  // controls (especially the on-clock franchise) never become stale.
  async function syncAdminDraftFromRemote(){
    if(draftSyncBusy || activeTab !== 'draft' || !loaded) return;
    draftSyncBusy = true;
    try{
      // Cheap check first: only download the season blob if something changed.
      const v=await SBL.draft.version().catch(()=>null);
      if(v){
        const ld=normalizeDraftState(STATE.settings.draft);
        const stale=v.cfg!==adminDraftCfg||v.status!==ld.status||Number(v.pick_count)!==ld.picks.length||Number(v.pool_count)!==ld.pool.length;
        if(!stale) return;
        adminDraftCfg=v.cfg;
      }
      const shared=await SBL.draft.read();
      const remoteDraft=normalizeDraftState(shared.settings?.draft);
      const version=String(shared.updatedAt||remoteDraft.updatedAt||'')+'|'+remoteDraft.status+'|'+remoteDraft.currentPick+'|'+remoteDraft.picks.length;
      const changed=version!==draftRemoteVersion;
      if(changed){
        draftRemoteVersion=version;
        const localDraft=normalizeDraftState(STATE.settings.draft);
        if(!(localDraft.status==='setup' && remoteDraft.status==='setup')){
          STATE.settings.rosters = shared.settings?.rosters || STATE.settings.rosters || {};
          STATE.settings.draft = remoteDraft;
          STATE.teamMap = shared.teamMap || STATE.teamMap || {};
          if(activeTab==='draft') drawDraft();
        }
      }
    }catch(e){
      console.warn('Live draft admin sync failed:',e);
    }finally{
      draftSyncBusy=false;
    }
  }
  function startAdminDraftSync(){
    clearInterval(window.__draftAdminSyncHandle);
    window.__draftAdminSyncHandle=setInterval(syncAdminDraftFromRemote,60000);
    try{
      if(window.__sblDraftAdminUnsubscribe) window.__sblDraftAdminUnsubscribe();
      const applyLive=(fn)=>p=>{
        const n=fn({teamMap:STATE.teamMap,settings:STATE.settings},p);
        STATE.settings=Object.assign(STATE.settings,n.settings);
        STATE.settings.draft=normalizeDraftState(STATE.settings.draft);
        if(activeTab==='draft') drawDraft();
      };
      window.__sblDraftAdminUnsubscribe=SBL.draft.subscribeLive({
        onPick:applyLive(SBL.draft.applyPickToState),
        onRevert:applyLive(SBL.draft.applyRevertToState),
        onCheck:()=>syncAdminDraftFromRemote(),
        onStatus:ok=>{ if(ok) syncAdminDraftFromRemote(); }
      },'admin-draft-live');
    }catch(e){ console.warn('Admin draft realtime unavailable:',e); }
  }

  // ---------- Draft Pokémon typing cache ----------
  // Typing is resolved during Draft Setup and stored with each draft entry.
  // The browser keeps a local cache so a Pokémon is only looked up once per
  // browser. Existing draft data is also used to seed the cache immediately.

  const DRAFT_TYPE_CACHE_KEY = 'sbl_pokemon_typing_cache_v2';
  const DRAFT_TYPE_LOOKUP_CONCURRENCY = 24;

  const POKEMON_API_ALIASES = {
    'darmanitan-galar':'darmanitan-galar',
    'darmanitan-galar-zen':'darmanitan-galar-zen',
    'terapagos-middle':'terapagos',
    'terapagos':'terapagos',
    'aegislash':'aegislash-shield',
    'keldeo':'keldeo-ordinary',
    'zygarde':'zygarde-50',
    'darmanitan':'darmanitan-standard',
    'mimikyu':'mimikyu-disguised',
    'meloetta':'meloetta-aria',
    'shaymin':'shaymin-land',
    'maushold':'maushold-family-of-four',
    'tauros-paldea-aqua':'tauros-paldea-aqua-breed',
    'tauros-paldea-blaze':'tauros-paldea-blaze-breed',
    'tauros-paldea-combat':'tauros-paldea-combat-breed',
    'toxtricity':'toxtricity-amped',
    'dudunsparce':'dudunsparce-two-segment',
    'oricorio':'oricorio-baile',
    'oricorio-baile':'oricorio-baile',
    'oricorio-pom-pom':'oricorio-pom-pom',
    'oricorio-pau':'oricorio-pau',
    'oricorio-sensu':'oricorio-sensu',
    'minior':'minior-red-meteor',
    'tatsugiri':'tatsugiri-curly',
    'wishiwashi':'wishiwashi-solo',
    'eiscue':'eiscue-ice',
    'morpeko':'morpeko-full-belly',
    'squawkabilly-b':'squawkabilly-blue-plumage',
    'squawkabilly-w':'squawkabilly-white-plumage',
    'squawkabilly-y':'squawkabilly-yellow-plumage',
    'squawkabilly-g':'squawkabilly-green-plumage'
  };

  // These are only used when the league's display name does not have a
  // directly usable API form. They are cached just like API results.
  const POKEMON_TYPE_FALLBACKS = {
    'darmanitan-galar':['Ice'],
    'terapagos-middle':['Normal'],
    'aegislash':['Steel','Ghost'],
    'keldeo':['Water','Fighting'],
    'zygarde':['Dragon','Ground'],
    'darmanitan':['Fire'],
    'mimikyu':['Ghost','Fairy'],
    'meloetta':['Normal','Psychic'],
    'shaymin':['Grass'],
    'maushold':['Normal'],
    'tauros-paldea-aqua':['Fighting','Water'],
    'tauros-paldea-blaze':['Fighting','Fire'],
    'tauros-paldea-combat':['Fighting'],
    'toxtricity':['Electric','Poison'],
    'dudunsparce':['Normal'],
    'jellicent':['Water','Ghost'],
    'frillish':['Water','Ghost'],
    'oricorio':['Fire','Flying'],
    'oricorio-baile':['Fire','Flying'],
    'oricorio-pom-pom':['Electric','Flying'],
    'oricorio-pau':['Psychic','Flying'],
    'oricorio-sensu':['Ghost','Flying'],
    'minior':['Rock','Flying'],
    'tatsugiri':['Dragon','Water'],
    'wishiwashi':['Water'],
    'eiscue':['Ice'],
    'morpeko':['Electric','Dark'],
    'pyroar':['Fire','Normal'],
    'squawkabilly-b':['Normal','Flying'],
    'squawkabilly-w':['Normal','Flying'],
    'squawkabilly-y':['Normal','Flying'],
    'squawkabilly-g':['Normal','Flying'],
    'ogerpon':['Grass'],
    'ogerpon-teal':['Grass'],
    'ogerpon-hearthflame':['Grass','Fire'],
    'ogerpon-wellspring':['Grass','Water'],
    'ogerpon-cornerstone':['Grass','Rock']
  };

  function draftTypeKey(name){
    return String(name || '')
      .trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[’']/g,'')
      .replace(/[.]/g,'')
      .replace(/[♀]/g,'-f')
      .replace(/[♂]/g,'-m')
      .replace(/[_\s]+/g,'-')
      .replace(/-+/g,'-')
      .replace(/^-|-$/g,'');
  }

  function draftApiSlug(name){
    let key=draftTypeKey(name);
    // League workbooks label Mega forms as 'Mega-Species' (or Mega-Species-X/Y/Z),
    // while PokéAPI only exposes the base species for many of these forms.
    if(key.startsWith('mega-')) key=key.slice(5).replace(/-[xyz]$/,'');
    key=key.replace(/-mega-([xyz])$/,'').replace(/-mega$/,'');
    return POKEMON_API_ALIASES[key] || key;
  }

  // Base stats are persisted with each draft-pool entry. Keep Mega form names
  // intact here; their stats are not interchangeable with the base species.
  function draftStatsApiCandidates(name){
    let key=draftTypeKey(name);
    if(key.startsWith('mega-')){const tail=key.slice(5),xy=tail.match(/^(.+?)-([xyz])$/);key=xy?`${xy[1]}-mega-${xy[2]}`:`${tail}-mega`;}
    else {const trailing=key.match(/^(.+?)-mega(?:-([xyz]))?$/);if(trailing)key=`${trailing[1]}-mega${trailing[2]?'-'+trailing[2]:''}`;}
    const shared=SBL.pokemon?.draftStatsApiCandidates?.(name)||[];
    return [...new Set(key.includes('-mega')||key.startsWith('mega-')?[key,...shared]:[...shared,key])];
  }
  function draftStatsApiSlug(name){return draftStatsApiCandidates(name)[0]||'';}
  const DRAFT_STATS_CACHE_KEY='sbl_pokemon_base_stats_v2';
  function readDraftStatsCache(){try{return JSON.parse(localStorage.getItem(DRAFT_STATS_CACHE_KEY)||'{}')||{}}catch(_){return {}}}
  let DRAFT_STATS_CACHE=readDraftStatsCache();
  function draftStatsComplete(stats){return ['hp','atk','def','spa','spd','spe'].every(k=>stats?.[k]!==undefined&&stats?.[k]!==null&&stats?.[k]!==''&&Number.isFinite(Number(stats[k])))}
  function draftStatsFromApi(raw){
    const out={},map={hp:'hp',attack:'atk',defense:'def','special-attack':'spa','special-defense':'spd',speed:'spe'};
    for(const row of (raw?.stats||[])){const k=map[row?.stat?.name],v=Number(row?.base_stat);if(k&&Number.isFinite(v))out[k]=v;}
    return draftStatsComplete(out)?out:null;
  }
  async function fetchDraftBaseStats(name){
    const candidates=draftStatsApiCandidates(name);if(!candidates.length)throw new Error('Invalid Pokémon name');
    for(const slug of candidates){
      if(draftStatsComplete(DRAFT_STATS_CACHE[slug]))return {...DRAFT_STATS_CACHE[slug]};
    }
    const failures=[];
    for(const slug of candidates){
      // PokéAPI occasionally rate-limits bulk repairs. Retry transient failures
      // with a short backoff; do not mistake a temporary 429/5xx for a missing form.
      for(let attempt=0;attempt<3;attempt++){
        try{
          const response=await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(slug)}`);
          if(!response.ok){
            failures.push(`${slug}: HTTP ${response.status}`);
            if(response.status===429||response.status>=500){if(attempt<2){await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));continue;}}
            break;
          }
          const stats=draftStatsFromApi(await response.json());
          if(!stats){failures.push(`${slug}: incomplete six-stat response`);break;}
          DRAFT_STATS_CACHE[slug]=stats;
          // Cache the league's exact label too, so a repeat repair is instant.
          const requested=candidates[0];DRAFT_STATS_CACHE[requested]=stats;
          try{localStorage.setItem(DRAFT_STATS_CACHE_KEY,JSON.stringify(DRAFT_STATS_CACHE))}catch(_){}
          return {...stats};
        }catch(error){
          failures.push(`${slug}: ${error?.message||String(error)}`);
          if(attempt<2)await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
        }
      }
    }
    throw new Error(`Could not resolve base stats for ${name}. Tried ${candidates.join(', ')}. ${failures.join('; ')}`);
  }
  async function assignDraftStats(pool,statusEl){
    const out=pool.map(m=>({...m})),missing=out.filter(m=>!draftStatsComplete(m.baseStats));
    if(!missing.length){if(statusEl)statusEl.innerHTML=`<div class="note">Base stats assigned to ${out.length}/${out.length} Pokémon. All six stats are available for filtering.</div>`;return out;}
    let cursor=0,done=0;async function worker(){while(cursor<missing.length){const mon=missing[cursor++];try{mon.baseStats=await fetchDraftBaseStats(mon.name)}catch(error){mon.statLookupError=String(error?.message||error)}done++;if(statusEl)statusEl.innerHTML=`<div class="note">Loading base stats… ${done}/${missing.length}</div>`;}}
    await Promise.all(Array.from({length:Math.min(4,missing.length)},worker));
    const unresolved=out.filter(m=>!draftStatsComplete(m.baseStats));
    if(statusEl){
      const names=unresolved.slice(0,15).map(m=>SBL.pokemon.escapeHtml(m.name)).join(', ');
      const details=unresolved.map(m=>`<li><strong>${SBL.pokemon.escapeHtml(m.name)}</strong>: ${SBL.pokemon.escapeHtml(m.statLookupError||'No complete stat response')}</li>`).join('');
      statusEl.innerHTML=`<div class="note ${unresolved.length?'danger':''}">Base stats assigned to ${out.length-unresolved.length}/${out.length} Pokémon.${unresolved.length?` ${unresolved.length} still need stat data: ${names}${unresolved.length>15?'…':''}.<details style="margin-top:8px"><summary>Show lookup diagnostics</summary><ul style="margin:6px 0 0;padding-left:20px">${details}</ul></details>`:' All six stats are available for filtering.'}</div>`;
    }
    return out;
  }

  function loadDraftTypeCache(){
    try{
      const raw=localStorage.getItem(DRAFT_TYPE_CACHE_KEY);
      const parsed=raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed==='object' ? parsed : {};
    }catch(e){
      return {};
    }
  }

  let DRAFT_TYPE_CACHE=loadDraftTypeCache();

  function saveDraftTypeCache(){
    try{
      localStorage.setItem(DRAFT_TYPE_CACHE_KEY, JSON.stringify(DRAFT_TYPE_CACHE));
    }catch(e){
      // localStorage can be unavailable/full; the draft still works.
    }
  }

  function cacheDraftTypes(name, types){
    const key=draftTypeKey(name);
    if(!key || !Array.isArray(types) || !types.length) return;
    DRAFT_TYPE_CACHE[key]=types.slice();
  }

  function seedDraftTypeCache(pool){
    let changed=false;
    for(const mon of (Array.isArray(pool) ? pool : [])){
      if(Array.isArray(mon?.types) && mon.types.length){
        const key=draftTypeKey(mon.name);
        if(key && !DRAFT_TYPE_CACHE[key]){
          DRAFT_TYPE_CACHE[key]=mon.types.slice();
          changed=true;
        }
      }
    }
    if(changed) saveDraftTypeCache();
  }

  function getCachedDraftTypes(name){
    const key=draftTypeKey(name);
    const cached=DRAFT_TYPE_CACHE[key];
    return Array.isArray(cached) && cached.length ? cached.slice() : null;
  }

  async function fetchPokemonTypesUncached(name){
    const original=String(name || '').trim();
    const key=draftTypeKey(original);

    // Use the shared local Pokédex first. It includes Mega-specific typings
    // (which differ from their base species) and avoids invalid Mega API slugs.
    const sharedTypes=SBL.pokemonTypes?.lookupTypes?.(original) || [];
    if(sharedTypes.length){
      return sharedTypes.map(t=>String(t).charAt(0).toUpperCase()+String(t).slice(1));
    }

    if(POKEMON_TYPE_FALLBACKS[key]){
      return POKEMON_TYPE_FALLBACKS[key].slice();
    }

    const slug=draftApiSlug(original);
    if(!slug) throw new Error(`Could not determine typing for ${original}.`);

    const response=await fetch(
      `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(slug)}`
    );

    if(!response.ok){
      throw new Error(`Could not determine typing for ${original}.`);
    }

    const data=await response.json();
    const types=(data.types || [])
      .sort((a,b)=>Number(a.slot||0)-Number(b.slot||0))
      .map(t=>String(t.type?.name||''))
      .filter(Boolean)
      .map(t=>t.charAt(0).toUpperCase()+t.slice(1));

    if(!types.length){
      throw new Error(`Could not determine typing for ${original}.`);
    }

    return types;
  }

  async function resolveDraftTypes(names,statusEl){
    const unique=[];
    const seen=new Set();

    for(const name of names){
      const key=draftTypeKey(name);
      if(key && !seen.has(key)){
        seen.add(key);
        unique.push({name,key});
      }
    }

    const missing=unique.filter(x=>!getCachedDraftTypes(x.name));
    const cachedCount=unique.length-missing.length;

    if(statusEl){
      statusEl.innerHTML=`<div class="note">Typing cache: ${cachedCount} cached, ${missing.length} to look up…</div>`;
    }

    const failures=[];
    let completed=0;

    // Resolve missing entries concurrently, but cap concurrency so the API
    // isn't flooded. Cached entries never make a network request.
    let cursor=0;
    async function worker(){
      while(cursor<missing.length){
        const item=missing[cursor++];
        try{
          const types=await fetchPokemonTypesUncached(item.name);
          cacheDraftTypes(item.name,types);
        }catch(error){
          failures.push({name:item.name,error});
        }
        completed++;
        if(statusEl){
          statusEl.innerHTML=`<div class="note">Assigning typings… ${cachedCount+completed}/${unique.length} (${missing.length} new lookups)</div>`;
        }
      }
    }

    const workers=Array.from({length:Math.min(DRAFT_TYPE_LOOKUP_CONCURRENCY,missing.length)},()=>worker());
    await Promise.all(workers);

    saveDraftTypeCache();

    if(failures.length){
      throw new Error(`Could not determine typing for: ${failures.map(x=>x.name).join(', ')}`);
    }

    return new Map(unique.map(x=>[x.key,getCachedDraftTypes(x.name)]));
  }

  async function assignDraftTypes(pool,statusEl){
    seedDraftTypeCache(pool);

    const typeMap=await resolveDraftTypes(
      pool.map(m=>m.name),
      statusEl
    );

    return pool.map(mon=>({
      ...mon,
      types:typeMap.get(draftTypeKey(mon.name)) || []
    }));
  }

  function draftSpent(d, team){
    return (d.picks || []).filter(p => p.team === team)
      .reduce((sum, p) => sum + (Number(p.points) || 0), 0);
  }

  function draftBudget(d, team){
    return Number(d.budgets?.[team] ?? d.defaultBudget) || 0;
  }

  function draftRemaining(d, team){
    return draftBudget(d, team) - draftSpent(d, team);
  }

  function draftOnClock(d){
    return d.mode === 'ordered' ? (d.order[d.currentPick] || null) : null;
  }

  async function makeAdminDraftPick(poolId){
    requireAdmin();
    const teamSelect=document.getElementById('adminDraftPickTeam');
    const selectedTeam=String(teamSelect?.value||'').trim();
    const current=normalizeDraftState(STATE.settings.draft);
    const target=current.pool.find(m=>m.id===String(poolId));
    const team=current.mode==='ordered' ? draftOnClock(current) : selectedTeam;
    if(!target) throw new Error('That Pokémon is no longer on the draft board.');
    if(!team) throw new Error('Select a franchise before making the pick.');
    const result=await SBL.draft.applyPick(target.id,team,'commissioner',{teamMap:STATE.teamMap,settings:STATE.settings});
    if(result?.state){
      STATE.teamMap=result.state.teamMap||STATE.teamMap||{};
      STATE.settings=Object.assign(STATE.settings,result.state.settings||{});
      STATE.settings.rosters=STATE.settings.rosters||{};
      STATE.settings.draft=normalizeDraftState(STATE.settings.draft);
    }
    if(result?.pick && !result.pick.faRemoved && (STATE.settings?.freeAgency?.mons||[]).length){
      alert(`${target.name} was drafted, but it was not found in Free Agency, so it was not removed from that list. Check the name match.`);
    }
    await savePublishedRosters(STATE.settings.rosters||{});
    const pick=result?.state?.settings?.draft?.picks?.find(p=>String(p.poolId)===String(target.id)&&String(p.team)===String(team));
    await logAdminAction('admin_draft_pick',`Commissioner selected ${target.name} for ${team}.`,{team,pokemon:target.name,points:Number(target.points)||0,pickNumber:pick?.pickNumber});
    return result;
  }


  // ---------- Draft lottery (CP4.1) ----------
  // The proposed order + odds can be published ahead of time; the draw and the
  // pick-by-pick reveal are live, and every open Draft Room follows along
  // because the lottery lives in the shared draft state.
  let LOTTERY_WORK = null;                 // unsaved edits while status is 'setup'
  const LOTTERY_UI = { rounds:'', snake:true, paste:'', err:'' };

  function lotteryWork(d, franchises){
    if(!LOTTERY_WORK){
      const L=SBL.draftLottery;
      const saved=L.normalize(d.lottery,franchises);
      const active=(franchises||[]).map(String);
      const activeKey=new Set(active.map(x=>x.toLowerCase()));
      const oldWeights=new Map((saved.proposed||[]).map((name,i)=>[String(name).toLowerCase(),Number(saved.weights?.[i])||1]));
      const proposed=(saved.proposed||[]).filter(name=>activeKey.has(String(name).toLowerCase()));
      const present=new Set(proposed.map(x=>x.toLowerCase()));
      active.forEach(name=>{if(!present.has(name.toLowerCase()))proposed.push(name);});
      const weights=proposed.map(name=>oldWeights.get(name.toLowerCase())||1);
      const picks=Math.min(Math.max(1,Number(saved.picks)||proposed.length),proposed.length);
      LOTTERY_WORK=Object.assign({},saved,{proposed,weights,picks});
    }
    return LOTTERY_WORK;
  }
  const lotEsc = v => SBL.pokemon.escapeHtml(v);
  const pctText = x => x >= 0.9995 ? '100%' : x < 0.0005 ? '–' : (x * 100).toFixed(1) + '%';

  function lotteryOddsTable(l){
    const o = SBL.draftLottery.odds(l), cols = l.proposed.length;
    return `<div style="overflow-x:auto"><table class="lottery-odds"><thead><tr><th>#</th><th>Franchise (worst record first)</th><th>Weight</th>
      ${Array.from({length:cols},(_,i)=>`<th>Pick ${i+1}</th>`).join('')}</tr></thead><tbody>
      ${l.proposed.map((t,i)=>`<tr><td>${i+1}</td><td>${lotEsc(t)}</td><td>${l.weights[i]}</td>
        ${o[i].slice(0,cols).map((x,p)=>`<td class="${x>=0.2?'hot':''}">${pctText(x)}${p < l.picks ? '' : ''}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`;
  }

  function lotteryPanelHtml(d, franchises){
    const L = SBL.draftLottery, locked = !(d.status === 'setup' || d.status === 'lobby');
    const saved = d.lottery ? L.normalize(d.lottery, franchises) : null;
    const st = saved ? saved.status : 'setup';
    const badge = locked && st !== 'applied' ? 'LOCKED' : st.toUpperCase();
    let body = '';

    if(st === 'setup' && !locked){
      const w = lotteryWork(d, franchises), n = w.proposed.length;
      body = `
        <div class="note">Enter last season's finishing order, <strong>worst record first</strong> (slot 1 gets the best odds). Users can see the proposed order and odds as soon as you publish them.</div>
        <div class="row" style="align-items:flex-end">
          <div style="flex:2"><label>Paste order (one franchise per line)</label>
            <textarea id="lotPaste" rows="4" placeholder="Worst record first…">${lotEsc(LOTTERY_UI.paste)}</textarea></div>
          <div style="flex:0"><button class="ghost" id="lotUsePaste">Use pasted order</button></div>
        </div>
        <div id="lotList" class="lottery-slots">
          ${w.proposed.map((t,i)=>`<div class="lottery-slot"><span class="n">${i+1}</span><span class="t">${lotEsc(t)}</span>
            <input type="number" min="1" step="1" value="${w.weights[i]}" data-lot-weight="${i}" title="Weight (odds are relative)">
            <button class="ghost small" data-lot-move="${i}" data-dir="-1" ${i===0?'disabled':''}>▲</button>
            <button class="ghost small" data-lot-move="${i}" data-dir="1" ${i===n-1?'disabled':''}>▼</button></div>`).join('')}
        </div>
        <div class="row" style="align-items:flex-end;margin-top:10px">
          <div><label>Odds preset</label><select id="lotPreset">
            ${Object.entries(L.PRESETS).map(([k,v])=>`<option value="${k}" ${w.preset===k?'selected':''}>${lotEsc(v.label)}</option>`).join('')}
            <option value="custom" ${w.preset==='custom'?'selected':''}>Custom (edit weights above)</option></select></div>
          <div><label>Lottery picks drawn (1–${n})</label><input type="number" id="lotPicks" min="1" max="${n}" value="${w.picks}"></div>
        </div>
        <div class="note">Picks after the drawn ones keep the proposed order. Exact odds:</div>
        ${n >= 2 ? lotteryOddsTable(w) : ''}
        <div class="foot-actions">
          <button class="ghost" id="lotPublish">Publish order &amp; odds to users</button>
          <button class="primary" id="lotRun">Run the lottery</button>
        </div>`;
    } else if(saved && (st === 'drawn' || st === 'applied')){
      const K = Math.min(saved.picks, saved.result.length), total = saved.result.length, left = total - saved.revealed;
      const full = saved.revealed >= total;
      const ok = L.verify(saved);
      body = `
        <div class="note">Seed <code>${lotEsc(saved.seed)}</code> · ${ok ? '✓ re-running this seed reproduces the result' : '⚠ result does not match its seed'}</div>
        <ol class="lottery-result">
          ${saved.result.map((t,i)=>{
            const shown = L.visiblePicks(saved)[i];
            return `<li class="${shown?'shown':'hidden'}"><span class="n">${i+1}</span> ${lotEsc(t)}
              <span class="note" style="margin:0 0 0 8px">${shown ? '' : '(not revealed yet — you can see it)'}${shown && i < K ? ` · was slot ${saved.proposed.indexOf(t)+1}` : ''}</span></li>`; }).join('')}
        </ol>
        ${st === 'drawn' && !locked ? `
          <div class="foot-actions">
            ${full ? '' : `<button class="primary" id="lotRevealNext">Reveal next position (${left} left)</button><button class="ghost" id="lotRevealAll">Reveal all positions</button>`}
            <button class="ghost danger-btn" id="lotReset">Discard &amp; redo</button>
          </div>
          ${full ? `<div class="row" style="align-items:flex-end;margin-top:10px">
            <div><label>Rounds</label><input type="number" id="lotRounds" min="1" value="${lotEsc(LOTTERY_UI.rounds || d.maxPicks)}"></div>
            <div><label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:8px"><input type="checkbox" id="lotSnake" ${LOTTERY_UI.snake?'checked':''}> Snake</label></div>
            <div style="flex:0"><button class="primary" id="lotApply">Lock lottery &amp; set draft order</button></div></div>` : ''}`
        : ''}
        ${st === 'applied' ? `<div class="note">Applied on ${lotEsc(new Date(saved.appliedAt).toLocaleString())}. The draft order below was generated from this result.</div>
          ${!locked ? '<div class="foot-actions"><button class="ghost danger-btn" id="lotReset">Reset lottery &amp; clear draft order</button></div>' : ''}` : ''}`;
    } else {
      body = `<div class="note">The lottery was not run before the draft started.</div>`;
    }
    return `<div class="panel" id="lotteryPanel"><h2>Draft lottery <span class="badge">${badge}</span></h2>${body}
      <div class="note danger" id="lotErr">${lotEsc(LOTTERY_UI.err)}</div></div>`;
  }

  function wireLottery(franchises){
    const L = SBL.draftLottery, $ = id => document.getElementById(id);
    const cur = () => STATE.settings.draft;
    const fail = e => { LOTTERY_UI.err = e.message || String(e); const el = $('lotErr'); if(el) el.textContent = LOTTERY_UI.err; };
    const persist = async (lot, action, msg) => {
      LOTTERY_UI.err = '';
      cur().lottery = lot; LOTTERY_WORK = null;
      await saveDraft();
      await logAdminAction(action, msg, {status:lot.status, seed:lot.seed||null});
      drawDraft();
    };
    const work = () => LOTTERY_WORK;

    $('lotUsePaste')?.addEventListener('click', () => {
      const raw = $('lotPaste').value; LOTTERY_UI.paste = raw;
      const byKey = new Map(franchises.map(f => [f.toLowerCase(), f]));
      const names = raw.split(/\r?\n/).map(x => x.replace(/^\s*\d+[.)\s-]+/, '').trim()).filter(Boolean);
      const unknown = names.filter(n => !byKey.has(n.toLowerCase()));
      if(unknown.length) return fail(new Error('Not recognised as franchises: ' + unknown.join(', ')));
      const order = names.map(n => byKey.get(n.toLowerCase()));
      const missing = franchises.filter(f => !order.includes(f));
      if(missing.length) return fail(new Error('Missing from your list: ' + missing.join(', ')));
      const w = work(); w.proposed = order;
      if(w.preset !== 'custom') w.weights = L.presetWeights(w.preset, order.length);
      LOTTERY_UI.err = ''; drawDraft();
    });
    contentEl.querySelectorAll('[data-lot-move]').forEach(b => b.addEventListener('click', () => {
      const w = work(), i = Number(b.dataset.lotMove), j = i + Number(b.dataset.dir);
      if(j < 0 || j >= w.proposed.length) return;
      [w.proposed[i], w.proposed[j]] = [w.proposed[j], w.proposed[i]];
      if(w.preset === 'custom') [w.weights[i], w.weights[j]] = [w.weights[j], w.weights[i]];
      drawDraft();
    }));
    contentEl.querySelectorAll('[data-lot-weight]').forEach(inp => inp.addEventListener('change', () => {
      const w = work(); w.weights[Number(inp.dataset.lotWeight)] = Number(inp.value) || 0; w.preset = 'custom'; drawDraft();
    }));
    $('lotPreset')?.addEventListener('change', e => {
      const w = work(); w.preset = e.target.value;
      if(w.preset !== 'custom') w.weights = L.presetWeights(w.preset, w.proposed.length);
      drawDraft();
    });
    $('lotPicks')?.addEventListener('change', e => { work().picks = Math.max(1, Math.min(work().proposed.length, Number(e.target.value) || 1)); drawDraft(); });

    $('lotPublish')?.addEventListener('click', async () => {
      try{
        const w = work(), errs = L.validate(w, franchises); if(errs.length) return fail(new Error(errs[0]));
        await persist(Object.assign({}, w, {status:'setup'}), 'publish_draft_lottery_order', 'Published the proposed lottery order and odds.');
      }catch(e){ fail(e); }
    });
    $('lotRun')?.addEventListener('click', async () => {
      try{
        const w = work(), errs = L.validate(w, franchises); if(errs.length) return fail(new Error(errs[0]));
        const summary = w.proposed.map((t,i) => (i+1) + '. ' + t).join('\n');
        if(!confirm('Run the lottery with this proposed order (worst record first)?\n\n' + summary)) return;
        await persist(L.run(w), 'run_draft_lottery', 'Ran the draft lottery.');
      }catch(e){ fail(e); }
    });
    const reveal = async count => {
      try{
        const l = Object.assign({}, cur().lottery), total = l.result.length;
        l.revealed = Math.min(total, count);
        await persist(l, 'reveal_draft_lottery', 'Revealed lottery positions (' + l.revealed + '/' + total + ').');
      }catch(e){ fail(e); }
    };
    $('lotRevealNext')?.addEventListener('click', () => reveal((cur().lottery.revealed || 0) + 1));
    $('lotRevealAll')?.addEventListener('click', () => reveal(Infinity));
    $('lotApply')?.addEventListener('click', async () => {
      try{
        const d = cur(), rounds = Number($('lotRounds').value), snake = $('lotSnake').checked;
        if(!Number.isFinite(rounds) || rounds < 1) return fail(new Error('Enter a valid number of rounds.'));
        LOTTERY_UI.rounds = rounds; LOTTERY_UI.snake = snake;
        const l = Object.assign({}, d.lottery, {status:'applied', appliedAt:new Date().toISOString()});
        d.order = L.buildOrder(l.result, rounds, snake); d.mode = 'ordered'; DRAFT_ROUND_BUILDER = l.result.slice();
        await persist(l, 'apply_draft_lottery', `Applied the lottery result as a ${rounds}-round ${snake ? 'snake' : 'straight'} draft order.`);
      }catch(e){ fail(e); }
    });
    $('lotReset')?.addEventListener('click', async () => {
      if(!confirm('Discard this lottery result' + (cur().lottery?.status === 'applied' ? ' and clear the draft order generated from it' : '') + '?')) return;
      try{
        const d = cur(), l = Object.assign({}, d.lottery, {status:'setup', result:[], revealed:0, seed:'', drawnAt:null, appliedAt:null});
        if(d.lottery?.status === 'applied') d.order = [];
        await persist(l, 'reset_draft_lottery', 'Reset the draft lottery.');
      }catch(e){ fail(e); }
    });
  }

function renderDraft(){ return drawDraft(); }

  function draftRoomUrl(view){
    const url = new URL('draft.html', location.href);
    const params = new URLSearchParams(location.search);
    const leagueId = params.get('league') || SBL.leagueDb?.selectedLeagueId?.() || '';
    const seasonId = params.get('season_id') || SBL.leagueDb?.selectedSeasonId?.() || '';
    if(leagueId) url.searchParams.set('league', leagueId);
    if(seasonId) url.searchParams.set('season_id', seasonId);
    if(view) url.searchParams.set('view', view);
    return url.href;
  }


  const MOCK_DRAFT_STORAGE_PREFIX = 'sbl_admin_mock_draft_v1:';
  const MOCK_DRAFT_CURRENT_PREFIX = 'sbl_admin_mock_draft_current_v1:';
  function mockDraftContextKey(){
    const params=new URLSearchParams(location.search);
    return `${params.get('league')||SBL.leagueDb?.selectedLeagueId?.()||''}:${params.get('season_id')||SBL.leagueDb?.selectedSeasonId?.()||''}`;
  }
  function mockDraftSessionKey(id){return MOCK_DRAFT_STORAGE_PREFIX+String(id||'');}
  function cloneMockDraftState(d, franchises){
    const draft=JSON.parse(JSON.stringify(normalizeDraftState(d)));
    draft.status='live';
    draft.currentPick=0;
    draft.picks=[];
    draft.pool=(draft.pool||[]).map((m,i)=>({...m,id:String(m.id??i),drafted:false,draftedBy:null,pickNumber:null}));
    // Manual drafts still need a stable franchise sequence for the visual board;
    // this sequence is display-only and does not impose ordered-mode restrictions.
    if(!draft.order.length) draft.order=franchises.slice();
    const rosters=JSON.parse(JSON.stringify(STATE.settings.rosters||{}));
    franchises.forEach(team=>{if(!Object.keys(rosters).some(k=>String(k).trim().toLowerCase()===String(team).trim().toLowerCase()))rosters[team]=[];});
    const settings=JSON.parse(JSON.stringify(STATE.settings||{}));
    settings.rosters=rosters;
    settings.draft=draft;
    return {teamMap:JSON.parse(JSON.stringify(STATE.teamMap||{})),settings};
  }
  function mockDraftHtml(d,franchises){
    if(d.status!=='setup') return '<div class="panel"><div class="admin-dashboard-kicker">ADMINISTRATIVE SIMULATION</div><h2>Full mock draft</h2><div class="note">Start a mock draft while the real draft is in Setup. Once the real draft opens, this launcher is disabled to keep the test configuration aligned with the live setup.</div></div>';
    const context=mockDraftContextKey();
    try{MOCK_DRAFT_SESSION_ID=localStorage.getItem(MOCK_DRAFT_CURRENT_PREFIX+context)||'';}catch(_){MOCK_DRAFT_SESSION_ID='';}
    let existing=null;
    if(MOCK_DRAFT_SESSION_ID){try{existing=JSON.parse(localStorage.getItem(mockDraftSessionKey(MOCK_DRAFT_SESSION_ID))||'null');}catch(_){existing=null;}}
    const roomUrl=existing?draftRoomUrlWithMock(MOCK_DRAFT_SESSION_ID,''):'';
    const presentUrl=existing?draftRoomUrlWithMock(MOCK_DRAFT_SESSION_ID,'present'):'';
    return `<div class="panel" id="mockDraftPanel">
      <div class="row" style="align-items:center;justify-content:space-between"><div><div class="admin-dashboard-kicker">ADMINISTRATIVE SIMULATION</div><h2>Full mock draft</h2><div class="note">Launch the actual Draft Room in an isolated simulation: commissioner console, live draft board, pick confirmations, rosters, budgets and the full-screen presentation reveal. Picks are saved only in this browser's local storage and are never sent to Supabase or the real draft.</div></div><span class="badge">NO LIVE DATA WRITES</span></div>
      ${existing?`<div class="note" style="margin-top:12px">A mock draft session exists for this league and season. Its simulated picks are preserved locally until you reset or replace the session.</div><div class="foot-actions"><a class="primary" href="${roomUrl}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center">Open mock Draft Room ↗</a><a class="ghost" href="${presentUrl}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center">Open mock presentation ↗</a><button class="ghost danger-btn" id="clearMockDraftSessionBtn">Discard session</button></div>`:`<div class="note">Snapshot includes the current Pokémon pool and point values, franchise budgets, minimum/maximum roster limits, draft mode, and configured draft order.</div><button class="primary" id="startMockDraftBtn" ${!d.pool.length||!franchises.length?'disabled':''}>Launch full mock draft ↗</button>`}
      <div class="note danger" id="mockDraftError"></div>
    </div>`;
  }
  function draftRoomUrlWithMock(sessionId,view){
    const url=new URL(draftRoomUrl(view),location.href);
    url.searchParams.set('mock_draft',String(sessionId));
    return url.href;
  }
  function wireMockDraft(d,franchises){
    document.getElementById('startMockDraftBtn')?.addEventListener('click',()=>{
      requireAdmin();
      const err=document.getElementById('mockDraftError');if(err)err.textContent='';
      if(d.status!=='setup')return;
      if(!franchises.length||!d.pool?.length) {if(err)err.textContent='Add a draft pool and active franchises before starting a mock draft.';return;}
      try{
        const sessionId=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
        const initialState=cloneMockDraftState(d,franchises);
        const session={version:1,id:sessionId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),leagueId:SBL.leagueDb?.selectedLeagueId?.()||new URLSearchParams(location.search).get('league')||'',seasonId:SBL.leagueDb?.selectedSeasonId?.()||new URLSearchParams(location.search).get('season_id')||'',state:initialState,initialState};
        localStorage.setItem(mockDraftSessionKey(sessionId),JSON.stringify(session));
        localStorage.setItem(MOCK_DRAFT_CURRENT_PREFIX+mockDraftContextKey(),sessionId);
        MOCK_DRAFT_SESSION_ID=sessionId;
        const url=draftRoomUrlWithMock(sessionId,'');
        const opened=window.open(url,'_blank');
        if(opened)opened.opener=null;
        drawDraft();
      }catch(e){if(err)err.textContent=e?.message||String(e);}
    });
    document.getElementById('clearMockDraftSessionBtn')?.addEventListener('click',()=>{
      requireAdmin();
      if(!confirm('Discard this mock draft session and all of its simulated picks? The real draft is unaffected.'))return;
      try{if(MOCK_DRAFT_SESSION_ID)localStorage.removeItem(mockDraftSessionKey(MOCK_DRAFT_SESSION_ID));localStorage.removeItem(MOCK_DRAFT_CURRENT_PREFIX+mockDraftContextKey());MOCK_DRAFT_SESSION_ID='';drawDraft();}catch(e){const err=document.getElementById('mockDraftError');if(err)err.textContent=e?.message||String(e);}
    });
  }

  function drawDraft(){
    let d = STATE.settings.draft = normalizeDraftState(STATE.settings.draft);
    const franchises = draftFranchises();
    const editable = d.status === 'setup';
    const draftedCount = d.pool.filter(m => m.drafted).length;

    contentEl.innerHTML = `
      <div class="panel">
        <h2>Draft status</h2>
        <div class="row" style="align-items:center">
          <div>
            <span class="badge">${SBL.pokemon.escapeHtml(d.status.toUpperCase())}</span>
            <span class="badge">${d.mode === 'ordered' ? 'Ordered' : 'Manual'} mode</span>
            <span class="badge">${draftedCount}/${d.pool.length} drafted</span>
            <span class="badge">${d.minPicks}-${d.maxPicks} Pokémon/team</span>
            ${d.status === 'live' ? `<span class="badge">On the clock: ${SBL.pokemon.escapeHtml(draftOnClock(d) || (d.mode === 'manual' ? 'Admin controlled' : 'Complete'))}</span>` : ''}
          </div>
        </div>
        <div class="note">${
          d.status === 'setup' ? 'Configure the board, budgets, and order, then open the Draft Room so users can join.' :
          d.status === 'lobby' ? 'The Draft Room is open. Users can join now. Start the draft only when everyone is ready.' :
          d.status === 'live' ? 'The draft is live. The commissioner makes all picks from the commissioner controls; the user Draft Room is read-only for picks.' :
          'This draft is complete. Reset to start a new one.'
        }</div>
        <div class="foot-actions">
          <a class="ghost" href="${draftRoomUrl()}" target="_blank" rel="noopener" style="text-decoration:none; display:inline-flex; align-items:center;">Open Draft Room ↗</a>
          <a class="ghost" href="${draftRoomUrl('present')}" target="_blank" rel="noopener" style="text-decoration:none; display:inline-flex; align-items:center;">Open Presentation ↗</a>
          ${d.status === 'setup' ? `<button class="primary" id="openDraftRoomBtn">Set up draft</button>` : ''}${d.status === 'lobby' ? `<button class="primary" id="startDraftBtn">Start draft</button>` : ''}
          ${d.status === 'live' ? `<button class="primary danger-btn" id="endDraftBtn">End draft &amp; finalize rosters</button>` : ''}
          ${d.status !== 'setup' ? `<button class="ghost danger-btn" id="resetDraftBtn">Reset draft</button>` : ''}
        </div>
        <div class="note danger" id="draftStatusErr"></div>
      </div>

      ${d.status === 'complete' ? `
      <div class="panel">
        <h2>Final draft results</h2>
        <div class="note">Every pick from the completed draft, in pick order.</div>
        <div style="overflow:auto;margin-top:12px">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr><th style="text-align:left;padding:9px">Pick #</th><th style="text-align:left;padding:9px">Picked</th><th style="text-align:left;padding:9px">By</th><th style="text-align:left;padding:9px">Points</th><th style="text-align:left;padding:9px">Made by</th></tr></thead>
            <tbody>${(d.picks||[]).slice().sort((a,b)=>Number(a.pickNumber||0)-Number(b.pickNumber||0)).map(p=>`<tr><td style="padding:9px">${SBL.pokemon.escapeHtml(p.pickNumber ?? '—')}</td><td style="padding:9px">${SBL.pokemon.escapeHtml(p.name || '—')}</td><td style="padding:9px"><strong>${SBL.pokemon.escapeHtml(p.team || '—')}</strong></td><td style="padding:9px">${p.skipped ? '—' : SBL.pokemon.escapeHtml(p.points ?? 0)}</td><td style="padding:9px">${SBL.pokemon.escapeHtml(p.madeBy || 'Team owner')}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      ` : ''}

      ${d.status === 'setup' ? `
      <div class="panel">
        <h2>Draft roster limits</h2>
        <div class="note">Set how many Pokémon each franchise must draft at minimum and may draft at maximum. The minimum cannot be lower than 10.</div>
        <div class="row" style="align-items:flex-end;margin-top:10px">
          <div><label>Minimum Pokémon per franchise</label><input type="number" min="10" step="1" id="draftMinPicks" value="${SBL.pokemon.escapeHtml(d.minPicks)}"></div>
          <div><label>Maximum Pokémon per franchise</label><input type="number" min="10" step="1" id="draftMaxPicks" value="${SBL.pokemon.escapeHtml(d.maxPicks)}"></div>
          <div style="flex:0"><button class="ghost" id="saveDraftLimitsBtn">Save limits</button></div>
        </div>
        <div class="note">Current: ${d.minPicks} minimum · ${d.maxPicks} maximum.</div>
        <div class="note danger" id="draftLimitsErr"></div>
      </div>
      ` : ''}

      ${d.status === 'live' ? `
      <div class="panel">
        <h2>Make a draft pick</h2>
        <div class="note">${
          d.mode === 'ordered'
            ? `On the clock: <strong>${SBL.pokemon.escapeHtml(draftOnClock(d) || 'Draft order complete')}</strong>. The commissioner can make the pick on that franchise's behalf.`
            : 'Manual mode: choose any franchise below. Budget rules still apply.'
        }</div>
        <div class="row" style="align-items:flex-end;margin-top:10px">
          <div>
            <label>Franchise</label>
            <select id="adminDraftPickTeam" ${d.mode === 'ordered' ? 'disabled' : ''}>
              ${franchises.map(t => `<option value="${SBL.pokemon.escapeHtml(t)}" ${t === draftOnClock(d) ? 'selected' : ''}>${SBL.pokemon.escapeHtml(t)} — ${draftRemaining(d,t)} / ${draftBudget(d,t)} pts remaining</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Pick</label>
            <input type="search" id="adminDraftPokemonSearch" placeholder="Search Pokémon…" autocomplete="off">
            <select id="adminDraftPickPokemon" size="1">
              <option value="">Search above to choose a Pokémon</option>
            </select>
          </div>
          <div style="flex:0"><button class="primary" id="adminMakePickBtn">Make pick</button></div>
        </div>
        <div class="note danger" id="adminDraftPickErr"></div>
      </div>
      ` : ''}

      <div class="panel">
        <h2>Draft board</h2>
        <div class="note">Import an Excel or CSV workbook using the same automatic Pokémon / points detection as Free Agency, or add Pokémon one at a time below.${editable ? '' : ' Locked while the draft is live or complete — reset the draft to make changes.'}</div>
        <div class="row" style="align-items:center;margin-top:10px">
          <div class="note" id="draftStatsCoverage" style="flex:1;margin:0">Base stats: ${d.pool.filter(m=>draftStatsComplete(m.baseStats)).length}/${d.pool.length} Pokémon</div>
          <div style="flex:0"><button class="ghost" id="repairDraftStats" type="button">Repair missing base stats</button></div>
        </div>
        <div id="draftBoardStatus" style="margin-top:8px"></div>
        ${editable ? `
        <div class="row" style="align-items:flex-end;margin-top:10px">
          <div class="note" style="flex:1;margin:0">Free Agency is the draft pool. Load the board straight from it so names always match and every pick removes the Pokémon from Free Agency.</div>
          <div style="flex:0"><button class="primary" id="loadBoardFromFA">Load board from Free Agency (${(STATE.settings?.freeAgency?.mons||[]).length})</button></div>
        </div>
        <div class="row" style="align-items:flex-end;margin-top:10px">
          <div><label>Draft board workbook</label><input id="draftBoardFile" type="file" accept=".xlsx,.xls,.csv"></div>
          <div style="flex:0"><button class="ghost" id="importDraftBoard">Import / Replace board</button></div>
        </div>
        <div class="row" style="align-items:flex-end">
          <div><label>Pokémon name</label><input type="text" id="draftMonName" placeholder="e.g. Landorus-Therian"></div>
          <div style="max-width:120px"><label>Points</label><input type="text" id="draftMonPoints" placeholder="20"></div>
          <div style="flex:0"><button class="ghost" id="addDraftMonBtn">Add to board</button></div>
        </div>
        ` : ''}
        <div style="margin-top:12px">
          <input type="search" id="draftBoardSearch" placeholder="Search Pokémon to view the board…" autocomplete="off" aria-label="Search draft board">
          <div id="draftBoardResults" style="max-height:min(65vh,720px);overflow:auto;overscroll-behavior:contain;margin-top:10px">
            <div class="empty-state">Search for a Pokémon to view matching entries. The full board remains stored but is not rendered until you search.</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>Budgets</h2>
        <div class="row" style="align-items:flex-end">
          <div><label>League default budget</label><input type="text" id="draftDefaultBudget" value="${SBL.pokemon.escapeHtml(d.defaultBudget)}"></div>
          <div style="flex:0"><button class="ghost" id="saveDefaultBudgetBtn">Save default</button></div>
        </div>
        <div class="note">Optional per-franchise overrides — leave blank to use the default.</div>
        <div style="margin-top:10px">
          ${franchises.length ? franchises.map(t => {
            const total = draftBudget(d,t);
            const used = draftSpent(d,t);
            const remaining = total - used;
            return `
            <div class="map-row" style="align-items:center">
              <div style="flex:2"><strong>${SBL.pokemon.escapeHtml(t)}</strong><div class="note" style="margin:3px 0 0">${used} spent · ${remaining} remaining / ${total} total</div></div>
              <input type="text" data-budget-override="${SBL.pokemon.escapeHtml(t)}" placeholder="${SBL.pokemon.escapeHtml(d.defaultBudget)}" value="${d.budgets[t] != null ? SBL.pokemon.escapeHtml(d.budgets[t]) : ''}" style="flex:1">
            </div>`;
          }).join('') : '<div class="empty-state">No approved franchises yet — approve teams in the User Control tab first.</div>'}
        </div>
        ${franchises.length ? `<div class="foot-actions"><button class="ghost" id="saveBudgetOverridesBtn">Save overrides</button></div>` : ''}
        <div class="note danger" id="draftBudgetErr"></div>
      </div>

      <div class="panel">
        <h2>Draft order</h2>
        <div class="row" style="align-items:center">
          <label style="display:flex;align-items:center;gap:8px;margin:0;cursor:pointer;">
            <input type="checkbox" id="draftModeToggle" ${d.mode === 'ordered' ? 'checked' : ''} ${editable ? '' : 'disabled'}>
            Ordered draft (auto-advance through a draft order). Leave unchecked to assign picks to any franchise manually.
          </label>
        </div>
        ${d.mode === 'ordered' ? `
        <div class="note">Build one round of pick order below, then generate the full order across all rounds.</div>
        ${editable ? `
        <div class="row" style="align-items:flex-end">
          <div><label>Add franchise to round order</label>
            <select id="orderRoundSelect">
              ${franchises.filter(t => !DRAFT_ROUND_BUILDER.includes(t)).map(t => `<option value="${SBL.pokemon.escapeHtml(t)}">${SBL.pokemon.escapeHtml(t)}</option>`).join('')}
            </select>
          </div>
          <div style="flex:0"><button class="ghost" id="addToRoundBtn" ${franchises.filter(t => !DRAFT_ROUND_BUILDER.includes(t)).length ? '' : 'disabled'}>Add</button></div>
          <div style="flex:0"><button class="ghost" id="clearRoundBtn">Clear round</button></div>
        </div>
        <div id="roundOrderList" class="note">${DRAFT_ROUND_BUILDER.length ? DRAFT_ROUND_BUILDER.map((t,i)=>`${i+1}. ${SBL.pokemon.escapeHtml(t)}`).join(' · ') : 'No franchises added to the round yet.'}</div>
        <div class="row" style="align-items:flex-end;margin-top:10px">
          <div><label>Rounds</label><input type="text" id="draftRounds" placeholder="e.g. 8"></div>
          <div><label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:8px;"><input type="checkbox" id="draftSnake" checked> Snake (reverse order each round)</label></div>
          <div style="flex:0"><button class="primary" id="generateOrderBtn">Generate full order</button></div>
        </div>
        ` : ''}
        <div class="note">${d.order.length} total picks scheduled.</div>
        ${d.order.length ? `<div class="note" style="max-height:160px;overflow:auto">${d.order.map((t,i)=>`#${i+1} ${SBL.pokemon.escapeHtml(t)}`).join(' · ')}</div>` : ''}
        ${editable && d.order.length ? `<div class="foot-actions"><button class="ghost danger-btn" id="clearOrderBtn">Clear order</button></div>` : ''}
        ` : ''}
        <div class="note danger" id="draftOrderErr"></div>
      </div>
    `;
    // Commissioner owns lottery setup/run/reveal. The presentation window is display-only.
    contentEl.insertAdjacentHTML('beforeend', lotteryPanelHtml(d, franchises));
    wireLottery(franchises);
    contentEl.insertAdjacentHTML('beforeend', mockDraftHtml(d,franchises));
    wireMockDraft(d,franchises);
    // -- status panel --
    document.getElementById('openDraftRoomBtn')?.addEventListener('click', async () => {
      const err = document.getElementById('draftStatusErr');
      if(err) err.textContent = '';
      if(!d.pool.length){ if(err) err.textContent = 'Add at least one Pokémon to the draft board first.'; return; }
      const roomWindow = window.open(draftRoomUrl(), '_blank', 'noopener');
      try{
        const result = await SBL.draft.openLobby(d, STATE.settings.rosters || {});
        if(result?.state){
          STATE.teamMap = result.state.teamMap || STATE.teamMap || {};
          STATE.settings = Object.assign(STATE.settings, result.state.settings || {});
          STATE.settings.rosters = STATE.settings.rosters || {};
          STATE.settings.draft = normalizeDraftState(STATE.settings.draft);
          d = STATE.settings.draft;
        }
        await logAdminAction('open_draft_room', 'Opened the Draft Room lobby for participants.', {status:d.status});
        if(roomWindow && !roomWindow.closed) roomWindow.focus();
        drawDraft();
      }catch(e){ if(err) err.textContent = e.message || String(e); }
    });
    document.getElementById('startDraftBtn')?.addEventListener('click', async () => {
      const err = document.getElementById('draftStatusErr');
      err.textContent = '';
      if(d.status !== 'lobby'){ err.textContent = 'Open the Draft Room first, then start the draft when everyone is ready.'; return; }
      if(!d.pool.length){ err.textContent = 'Add at least one Pokémon to the draft board first.'; return; }
      if(d.minPicks < 10 || d.maxPicks < d.minPicks){ err.textContent = 'Set valid draft limits first. Minimum is 10 and maximum must be at least the minimum.'; return; }
      if(d.mode === 'ordered' && d.order.length){
        const pickCounts = franchises.map(team => ({team, count:d.order.filter(x=>String(x).trim()===String(team).trim()).length}));
        const invalid = pickCounts.filter(x=>x.count<d.minPicks || x.count>d.maxPicks);
        if(invalid.length){
          err.textContent = 'Draft order is outside the per-franchise limits: ' + invalid.map(x=>`${x.team}: ${x.count} picks (required ${d.minPicks}-${d.maxPicks})`).join('; ') + '. Check that every franchise is included in the round order and that the number of rounds is within the limits.';
          return;
        }
      }
      if(d.mode === 'ordered' && !d.order.length){ err.textContent = 'Generate a draft order first, or switch to manual mode.'; return; }
      try{
        const result = await SBL.draft.startDraft();
        if(result?.state){
          STATE.teamMap = result.state.teamMap || STATE.teamMap || {};
          STATE.settings = Object.assign(STATE.settings, result.state.settings || {});
          STATE.settings.rosters = STATE.settings.rosters || {};
          STATE.settings.draft = normalizeDraftState(STATE.settings.draft);
          d = STATE.settings.draft;
        }
        await logAdminAction('start_draft', 'Started the draft.', {status:d.status});
        drawDraft();
      }catch(e){ err.textContent = e.message; }
    });
    document.getElementById('endDraftBtn')?.addEventListener('click', async () => {
      const err = document.getElementById('draftStatusErr');
      err.textContent = '';
      if(!confirm('End the draft and finalize the current rosters? This cannot be undone without resetting the draft.')) return;
      try{
        const result = await SBL.draft.endDraft();
        if(result?.state){
          STATE.teamMap = result.state.teamMap || STATE.teamMap || {};
          STATE.settings = Object.assign(STATE.settings, result.state.settings || {});
          STATE.settings.rosters = STATE.settings.rosters || {};
          STATE.settings.draft = normalizeDraftState(STATE.settings.draft);
          d = STATE.settings.draft;
        }
        // Publish the roster snapshot immediately so the public roster page is finalized.
        await savePublishedRosters(STATE.settings.rosters || {});
        await logAdminAction('end_draft', 'Ended the draft and finalized the current rosters.', {status:d.status, picks:d.picks?.length || 0});
        drawDraft();
      }catch(e){ err.textContent = e.message; }
    });
    document.getElementById('resetDraftBtn')?.addEventListener('click', async () => {
      const err = document.getElementById('draftStatusErr');
      if(!confirm('Reset the draft? This clears every pick made so far. Pokémon return to the board as available. The draft board, budgets, and order stay as configured.')) return;
      try{
        const result = await SBL.draft.resetDraft();
        if(result?.state){
          STATE.teamMap = result.state.teamMap || STATE.teamMap || {};
          STATE.settings = Object.assign(STATE.settings, result.state.settings || {});
          STATE.settings.rosters = STATE.settings.rosters || {};
          STATE.settings.draft = normalizeDraftState(STATE.settings.draft);
          d = STATE.settings.draft;
        }
        await logAdminAction('reset_draft', 'Reset the draft; all picks were cleared.', {status:d.status});
        drawDraft();
      }catch(e){ err.textContent = e.message; }
    });

    // -- draft board panel --
    const renderPokemonSearchResults = (query, targetId, includeDrafted=true) => {
      const target = document.getElementById(targetId);
      if(!target) return;
      const q = String(query || '').trim().toLowerCase();
      if(!q){
        target.innerHTML = '<div class="empty-state">Search for a Pokémon to view matching entries. The full board remains stored but is not rendered until you search.</div>';
        return;
      }
      const matches = d.pool.filter(m => (includeDrafted || !m.drafted) && m.name.toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,60);
      if(!matches.length){ target.innerHTML='<div class="empty-state">No Pokémon match that search.</div>'; return; }
      if(target.tagName === 'SELECT'){
        target.innerHTML='<option value="">Select a Pokémon</option>'+matches.map(m=>`<option value="${SBL.pokemon.escapeHtml(m.id)}">${SBL.pokemon.escapeHtml(m.name)} — ${m.points} pts</option>`).join('');
      }else{
        target.innerHTML='<table><thead><tr><th>Pokémon</th><th>Types</th><th class="num">Points</th><th>Status</th>'+(editable ? '<th></th>' : '')+'<\/tr><\/thead><tbody>'+matches.map(m=>`<tr><td>${SBL.pokemon.escapeHtml(m.name)}</td><td>${(m.types||[]).map(SBL.pokemon.escapeHtml).join(' / ')||'<span class="note">—</span>'}</td><td class="num">${m.points}</td><td>${m.drafted?`<span class="badge">→ ${SBL.pokemon.escapeHtml(m.draftedBy||'')}</span>`:'<span class="note">Available</span>'}</td>${editable?`<td><button class="ghost small danger-btn" data-remove-mon="${SBL.pokemon.escapeHtml(m.id)}">Remove</button></td>`:''}</tr>`).join('')+'</tbody></table>'+(d.pool.length>matches.length?'<div class="note" style="margin-top:8px">Showing up to 60 matching Pokémon.</div>':'');
        target.querySelectorAll('[data-remove-mon]').forEach(btn=>btn.addEventListener('click', async () => {
          const status = document.getElementById('draftBoardStatus');
          try{ const removed=d.pool.find(m=>m.id===btn.dataset.removeMon); d.pool=d.pool.filter(m=>m.id!==btn.dataset.removeMon); await saveDraft(); await logAdminAction('remove_draft_pokemon',`Removed ${removed?.name||btn.dataset.removeMon} from the draft board.`,{id:btn.dataset.removeMon,name:removed?.name||null}); drawDraft(); }catch(e){ if(status) status.innerHTML=`<div class="note danger">${SBL.pokemon.escapeHtml(e.message)}</div>`; }
        }));
      }
    };
    document.getElementById('draftBoardSearch')?.addEventListener('input', e=>renderPokemonSearchResults(e.target.value,'draftBoardResults',true));
    document.getElementById('adminDraftPokemonSearch')?.addEventListener('input', e=>renderPokemonSearchResults(e.target.value,'adminDraftPickPokemon',false));
    document.getElementById('loadBoardFromFA')?.addEventListener('click', async () => {
      const status = document.getElementById('draftBoardStatus');
      const raw = Array.isArray(STATE.settings?.freeAgency?.mons) ? STATE.settings.freeAgency.mons : [];
      const list = raw.map(e => typeof e === 'string' ? {name:e.trim(), points:0}
        : {name:String(e?.name||'').trim(), points:Number(e?.points)||0, isMega:!!e?.isMega, costTbd:!!e?.costTbd}).filter(m => m.name);
      if(!list.length){ status.innerHTML = '<div class="note danger">Free Agency has no Pokémon. Publish the Tier List under Free Agency first.</div>'; return; }
      if(d.pool.length && !d.pool.some(m => m.drafted) && !confirm(`Replace the current board (${d.pool.length} Pokémon) with the ${list.length} Pokémon in Free Agency?`)) return;
      try{
        seedDraftTypeCache(d.pool);
        const fresh = list.map(m => ({id:genDraftId(), name:m.name, points:m.points, isMega:!!m.isMega, costTbd:!!m.costTbd, types:[], drafted:false, draftedBy:null, pickNumber:null}));
        status.innerHTML = `<div class="note">Assigning Pokémon typings… 0/${fresh.length}</div>`;
        d.pool = await assignDraftTypes(fresh, status);
        d.pool = await assignDraftStats(d.pool, status);
        await saveDraft();
        await logAdminAction('load_draft_board_from_fa', `Loaded ${d.pool.length} Pokémon from Free Agency into the draft board.`, {count:d.pool.length});
        drawDraft();
      }catch(e){
        status.innerHTML = `<div class="note danger">${SBL.pokemon.escapeHtml(e.message)}</div>`;
      }
    });
    document.getElementById('repairDraftStats')?.addEventListener('click', async () => {
      const status=document.getElementById('draftBoardStatus'),button=document.getElementById('repairDraftStats');
      if(!d.pool.length){if(status)status.innerHTML='<div class="note">The draft board is empty.</div>';return;}
      button.disabled=true;button.textContent='Loading stats…';
      try{
        d.pool=await assignDraftStats(d.pool,status);
        await saveDraft();
        await logAdminAction('repair_draft_base_stats',`Repaired base stats for the draft pool.`,{total:d.pool.length,complete:d.pool.filter(m=>draftStatsComplete(m.baseStats)).length});
        const coverage=document.getElementById('draftStatsCoverage');if(coverage)coverage.textContent=`Base stats: ${d.pool.filter(m=>draftStatsComplete(m.baseStats)).length}/${d.pool.length} Pokémon`;
        drawDraft();
      }catch(error){if(status)status.innerHTML=`<div class="note danger">${SBL.pokemon.escapeHtml(error.message||String(error))}</div>`;}
      finally{button.disabled=false;button.textContent='Repair missing base stats';}
    });
    document.getElementById('importDraftBoard')?.addEventListener('click', async () => {
      const file = document.getElementById('draftBoardFile').files?.[0];
      const status = document.getElementById('draftBoardStatus');
      if(!file){ status.innerHTML = '<div class="note danger">Choose a file first.</div>'; return; }
      status.innerHTML = '<div class="note">Reading workbook…</div>';
      try{
        const wb = XLSX.read(await file.arrayBuffer(), {type:'array'});
        const parsed = parseFreeAgencyWorkbook(wb); // scans all worksheets and supported Pokémon/points layouts
        if(d.pool.some(m => m.drafted) === false && d.pool.length && !confirm(`Replace the current board (${d.pool.length} Pokémon) with ${parsed.length} from this workbook?`)) return;

        // Preserve all typings already known from the current board before
        // replacing it. This makes re-imports nearly instantaneous.
        seedDraftTypeCache(d.pool);

        const importedPool = parsed.map(m => ({
          id: genDraftId(),
          name: m.name,
          points: Number(m.points) || 0,
          isMega: !!m.isMega,
          costTbd: !!m.costTbd,
          types: [],
          drafted: false,
          draftedBy: null,
          pickNumber: null
        }));

        status.innerHTML = `<div class="note">Assigning Pokémon typings… 0/${importedPool.length}</div>`;
        d.pool = await assignDraftTypes(importedPool, status);
        d.pool = await assignDraftStats(d.pool, status);
        await saveDraft();
        await logAdminAction('import_draft_board', `Imported ${d.pool.length} Pokémon into the draft board.`, {count:d.pool.length, source:file.name});
        drawDraft();
      }catch(e){
        status.innerHTML = `<div class="note danger">${SBL.pokemon.escapeHtml(e.message)}</div>`;
      }
    });
    document.getElementById('addDraftMonBtn')?.addEventListener('click', async () => {
      const status = document.getElementById('draftBoardStatus');
      const name = document.getElementById('draftMonName').value.trim();
      const points = Number(document.getElementById('draftMonPoints').value);
      if(!name || !Number.isFinite(points)){ status.innerHTML = '<div class="note danger">Enter a name and a numeric point value.</div>'; return; }
      if(d.pool.some(m => m.name.toLowerCase() === name.toLowerCase())){ status.innerHTML = '<div class="note danger">That Pokémon is already on the board.</div>'; return; }
      try{
        status.innerHTML = `<div class="note">Finding typing for ${SBL.pokemon.escapeHtml(name)}…</div>`;
        /*
         * Manual entry must use the same resolver as Excel imports.
         * The import path goes through fetchPokemonTypesUncached(), which
         * applies draftApiSlug() and the special-form fallbacks before calling
         * PokéAPI. Calling the shared legacy wrapper here was bypassing that
         * proven path.
         */
        const types = await fetchPokemonTypesUncached(name);
        let baseStats=null;try{baseStats=await fetchDraftBaseStats(name)}catch(error){status.innerHTML=`<div class="note danger">${SBL.pokemon.escapeHtml(name)} was added, but its base stats could not be resolved: ${SBL.pokemon.escapeHtml(error.message||String(error))}. Use Repair missing base stats later.</div>`;}
        d.pool.push({
          id: genDraftId(),
          name,
          points,
          types,
          baseStats,
          drafted: false,
          draftedBy: null,
          pickNumber: null
        });
        await saveDraft();
        await logAdminAction('add_draft_pokemon', `Added ${name} to the draft board for ${points} points.`, {name, points});
        drawDraft();
      }catch(e){ status.innerHTML = `<div class="note danger">${SBL.pokemon.escapeHtml(e.message)}</div>`; }
    });
    document.getElementById('adminMakePickBtn')?.addEventListener('click', async () => {
      const err = document.getElementById('adminDraftPickErr');
      const btn = document.getElementById('adminMakePickBtn');
      const pokemon = document.getElementById('adminDraftPickPokemon')?.value;
      err.textContent = '';
      if(!pokemon){
        err.textContent = 'Select a Pokémon first.';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try{
        await makeAdminDraftPick(pokemon);
        drawDraft();
      }catch(e){
        err.textContent = e.message || String(e);
      }finally{
        btn.disabled = false;
        btn.textContent = 'Make pick';
      }
    });

    document.getElementById('saveDraftLimitsBtn')?.addEventListener('click', async () => {
      const err = document.getElementById('draftLimitsErr');
      err.textContent = '';
      const min = Number(document.getElementById('draftMinPicks').value);
      const max = Number(document.getElementById('draftMaxPicks').value);
      if(!Number.isInteger(min) || min < 10){ err.textContent = 'Minimum Pokémon must be a whole number of at least 10.'; return; }
      if(!Number.isInteger(max) || max < min){ err.textContent = 'Maximum Pokémon must be a whole number at least as large as the minimum.'; return; }
      try { d.minPicks=min; d.maxPicks=max; await saveDraft(); await logAdminAction('set_draft_limits', `Set draft limits to ${min}-${max} Pokémon per franchise.`, {minPicks:min,maxPicks:max}); drawDraft(); }
      catch(e){ err.textContent=e.message; }
    });

    // -- budgets panel --
    document.getElementById('saveDefaultBudgetBtn')?.addEventListener('click', async () => {
      const err = document.getElementById('draftBudgetErr');
      const val = Number(document.getElementById('draftDefaultBudget').value);
      if(!Number.isFinite(val) || val < 0){ err.textContent = 'Enter a valid non-negative number.'; return; }
      try{
        d.defaultBudget = val;
        await saveDraft();
        await logAdminAction('set_default_draft_budget', `Set the default draft budget to ${val}.`, {budget:val});
        drawDraft();
      }catch(e){ err.textContent = e.message; }
    });
    document.getElementById('saveBudgetOverridesBtn')?.addEventListener('click', async () => {
      const err = document.getElementById('draftBudgetErr');
      const inputs = contentEl.querySelectorAll('[data-budget-override]');
      const next = {};
      for(const inp of inputs){
        const raw = inp.value.trim();
        if(!raw) continue;
        const val = Number(raw);
        if(!Number.isFinite(val) || val < 0){ err.textContent = `Invalid budget for ${inp.dataset.budgetOverride}.`; return; }
        next[inp.dataset.budgetOverride] = val;
      }
      try{
        d.budgets = next;
        await saveDraft();
        await logAdminAction('set_draft_budget_overrides', `Updated custom draft budgets for ${Object.keys(next).length} franchise${Object.keys(next).length===1?'':'s'}.`, {budgets:next});
        drawDraft();
      }catch(e){ err.textContent = e.message; }
    });

    // -- draft order panel --
    document.getElementById('draftModeToggle')?.addEventListener('change', async (e) => {
      const err = document.getElementById('draftOrderErr');
      try{
        d.mode = e.target.checked ? 'ordered' : 'manual';
        await saveDraft();
        await logAdminAction('set_draft_mode', `Changed draft mode to ${d.mode}.`, {mode:d.mode});
        drawDraft();
      }catch(e2){ err.textContent = e2.message; }
    });
    document.getElementById('addToRoundBtn')?.addEventListener('click', () => {
      const sel = document.getElementById('orderRoundSelect');
      if(sel && sel.value && !DRAFT_ROUND_BUILDER.includes(sel.value)) DRAFT_ROUND_BUILDER.push(sel.value);
      drawDraft();
    });
    document.getElementById('clearRoundBtn')?.addEventListener('click', () => {
      DRAFT_ROUND_BUILDER = [];
      drawDraft();
    });
    document.getElementById('generateOrderBtn')?.addEventListener('click', async () => {
      const err = document.getElementById('draftOrderErr');
      const rounds = Number(document.getElementById('draftRounds').value);
      const snake = document.getElementById('draftSnake').checked;
      if(!DRAFT_ROUND_BUILDER.length){ err.textContent = 'Add the franchises to the round order first.'; return; }
      if(!Number.isInteger(rounds) || rounds < 1){ err.textContent = 'Enter a valid whole number of rounds.'; return; }
      const missing = franchises.filter(team => !DRAFT_ROUND_BUILDER.some(x=>String(x).trim()===String(team).trim()));
      const unexpected = DRAFT_ROUND_BUILDER.filter(team => !franchises.some(x=>String(x).trim()===String(team).trim()));
      if(missing.length || unexpected.length){
        err.textContent = [missing.length ? `Add every franchise to the round order. Missing: ${missing.join(', ')}.` : '', unexpected.length ? `Remove franchises that are not currently active: ${unexpected.join(', ')}.` : ''].filter(Boolean).join(' ');
        return;
      }
      if(DRAFT_ROUND_BUILDER.length !== franchises.length){ err.textContent = 'Each active franchise must appear exactly once in the round order.'; return; }
      if(rounds < d.minPicks || rounds > d.maxPicks){ err.textContent = `Choose between ${d.minPicks} and ${d.maxPicks} rounds. Each complete round gives every franchise one pick, so ${rounds} rounds would give each franchise ${rounds} picks.`; return; }
      try{
        const order = [];
        for(let r = 0; r < rounds; r++){
          const seq = (snake && r % 2 === 1) ? [...DRAFT_ROUND_BUILDER].reverse() : DRAFT_ROUND_BUILDER;
          order.push(...seq);
        }
        d.order = order;
        await saveDraft();
        await logAdminAction('generate_draft_order', `Generated a ${rounds}-round${rounds===1?'':'s'} ${snake?'snake':'straight'} draft order with ${order.length} picks.`, {rounds, snake, order});
        drawDraft();
      }catch(e){ err.textContent = e.message; }
    });
    document.getElementById('clearOrderBtn')?.addEventListener('click', async () => {
      const err = document.getElementById('draftOrderErr');
      try{
        d.order = [];
        await saveDraft();
        await logAdminAction('clear_draft_order', 'Cleared the draft order.', {});
        drawDraft();
      }catch(e){ err.textContent = e.message; }
    });
  }

  // ---------- Free Agency ----------
  // Free Agency deliberately uses the same shared dashboard-state mechanism as
  // the existing roster importer. It does not create a replay row or alter any
  // replay/stat processing logic.
  function normalizeFreeAgencyName(name){
    return (SBL.pokemon?.displayNameWithForm ? SBL.pokemon.displayNameWithForm(name) : (SBL.pokemon?.displayName ? SBL.pokemon.displayName(name) : String(name ?? '')))
      .replace(/[’']/g, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function freeAgencyKey(name){
    return normalizeFreeAgencyName(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function parseFreeAgencyWorkbook(wb){
    if(!wb?.SheetNames?.length) throw new Error('The workbook has no worksheets.');

    const out=[]; const seen=new Set(); const byKey=new Map(); const conflicts=new Set(); const warnings=[]; const sourceSheets=[];
    const pointHeader=value=>{
      const text=String(value??'').trim();
      const match=text.match(/^(\d+)\s*(?:POINTS?|PTS?|PT)$/i) || text.match(/^(\d+)\s+POINTS?$/i);
      return match?Number(match[1]):null;
    };
    const isMegaHeader=value=>/^\s*MEGAS?(?:\s*\(.*\))?\s*$/i.test(String(value??''));
    const isNameHeader=value=>/^(?:pok[eé]mon|pokemon|species|name|pok[eé]mon name|pokemon name|draft pick|player)(?:\s*[a-z0-9]+)?$/i.test(String(value??'').trim());
    const isPointsHeader=value=>/^(?:(?:draft|auction|point|points|tier|base|pokemon)\s+)*(?:points?|pts?|pt|cost|value)(?:\s*(?:\([^)]*\)|[a-z0-9]+))*$/i.test(String(value??'').trim());
    const add=(rawName,points,meta={})=>{
      const name=normalizeFreeAgencyName(rawName);
      if(!name || /^(pokemon|pokémon|species|name|pick|roster|points?|pts?|cost|tier|value)$/i.test(name)) return;
      const key=freeAgencyKey(name);
      if(!key) return;
      const numeric=Number(points);
      if(!Number.isFinite(numeric) || numeric<0 || numeric>1000) return;
      if(seen.has(key)){
        const previous=byKey.get(key);
        if(previous && (previous.points!==numeric || !!previous.isMega!==!!meta.isMega) && !conflicts.has(key)){
          conflicts.add(key);
          warnings.push(`${name} appears more than once with different point values or categories (${previous.points} vs ${numeric}); the first occurrence was kept. Check this entry before publishing.`);
        }
        return;
      }
      seen.add(key); const entry={name,points:numeric,...meta}; byKey.set(key,entry); out.push(entry);
    };

    for(const sheetName of wb.SheetNames){
      const sheet=wb.Sheets?.[sheetName]; if(!sheet) continue;
      let rows=[];
      try{ rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false}); }
      catch(error){ warnings.push(`${sheetName}: could not read worksheet (${error.message})`); continue; }
      if(!Array.isArray(rows)||!rows.length) continue;
      let sheetCount=0;
      const before=out.length;

      // Layout A: tiered columns. The heading row may appear anywhere and the
      // worksheet may have any name; every numeric POINTS column is a tier.
      for(let hr=0;hr<Math.min(rows.length,80);hr++){
        const headers=rows[hr]||[];
        const tierCols=[];
        headers.forEach((h,c)=>{
          const pts=pointHeader(h);
          if(pts!==null) tierCols.push({c,points:pts});
          else if(isMegaHeader(h)) tierCols.push({c,points:1,isMega:true});
        });
        if(!tierCols.length) continue;
        for(const tier of tierCols){
          for(let r=hr+1;r<rows.length;r++){
            const value=rows[r]?.[tier.c];
            if(value===undefined||value===null||String(value).trim()==='') continue;
            const meta=tier.isMega?{isMega:true,costTbd:true}:{};
            add(value,tier.points,meta);
          }
        }
        if(out.length>before){ sourceSheets.push(sheetName); sheetCount=out.length-before; break; }
      }

      // Layout B: a conventional table with Pokémon/Name and Points/Cost
      // columns. Supports headers such as Species | Draft Cost and Pokemon | Tier.
      if(out.length===before){
        for(let hr=0;hr<Math.min(rows.length,80);hr++){
          const headers=rows[hr]||[]; const pairs=[];
          headers.forEach((h,c)=>{
            if(!isNameHeader(h)) return;
            const next=headers.findIndex((x,i)=>i>c && isPointsHeader(x));
            if(next>c) pairs.push({nameCol:c,pointsCol:next});
          });
          if(!pairs.length) continue;
          for(let r=hr+1;r<rows.length;r++) for(const pair of pairs){
            const rawName=rows[r]?.[pair.nameCol], rawPoints=rows[r]?.[pair.pointsCol];
            if(rawName===undefined||String(rawName).trim()==='') continue;
            const value=String(rawPoints??'').replace(/[^\d.-]/g,'');
            if(value==='') continue;
            add(rawName,Number(value));
          }
          if(out.length>before){ sourceSheets.push(sheetName); sheetCount=out.length-before; break; }
        }
      }

      // Layout C: repeated Pokémon / Points column pairs, e.g. Pokemon A | Cost A
      // | Pokemon B | Cost B. Only use explicit header pairs to avoid guessing.
      if(out.length===before){
        for(let hr=0;hr<Math.min(rows.length,80);hr++){
          const headers=rows[hr]||[]; const pairs=[];
          headers.forEach((h,c)=>{
            if(!isNameHeader(h)) return;
            const next=headers.findIndex((x,i)=>i>c && isPointsHeader(x));
            if(next>c) pairs.push({nameCol:c,pointsCol:next});
          });
          if(!pairs.length) continue;
          for(let r=hr+1;r<rows.length;r++) for(const pair of pairs){
            const name=rows[r]?.[pair.nameCol], raw=rows[r]?.[pair.pointsCol];
            const value=String(raw??'').replace(/[^\d.-]/g,'');
            if(String(name??'').trim() && value!=='') add(name,Number(value));
          }
          if(out.length>before){ sourceSheets.push(sheetName); sheetCount=out.length-before; break; }
        }
      }
    }

    if(!out.length){
      throw new Error('I could not identify Pokémon and point values in this workbook. Use either point-tier columns (for example “20 Points”, “19 Points”, “Megas”) or a table with “Pokémon” and “Points”/“Cost” headings. The worksheet can have any name.');
    }
    out.sort((a,b)=>b.points-a.points||Number(!!b.isMega)-Number(!!a.isMega)||a.name.localeCompare(b.name));
    out.importWarnings=warnings;
    out.sourceSheets=[...new Set(sourceSheets)];
    return out;
  }

  async function publishFreeAgency(pool,sourceName){
    requireAdmin();
    const mons=pool.map(m=>({name:String(m.name||'').trim(),points:Number(m.points)||0,...(m.isMega?{isMega:true,costTbd:true}:{})})).filter(m=>m.name);
    if(!mons.length) throw new Error('Free Agency pool is empty.');
    STATE.settings=STATE.settings||{};
    STATE.settings.freeAgency={mons,source:String(sourceName||'Workbook'),updatedAt:new Date().toISOString()};
    await saveSharedState();
    await logAdminAction('publish_free_agency', `Published Free Agency with ${mons.length} Pokémon from ${String(sourceName||'Workbook')}.`, {count:mons.length, source:String(sourceName||'Workbook')});
  }

  function renderFreeAgency(){
    const current=Array.isArray(STATE.settings?.freeAgency?.mons)?STATE.settings.freeAgency.mons:[];
    const groups={};
    current.forEach(m=>{const p=Number(m.points)||0;(groups[p]??=[]).push(m);});
    const tiers=Object.keys(groups).sort((a,b)=>Number(b)-Number(a));

    contentEl.innerHTML=`
      <div class="panel">
        <h2>Free Agency</h2>
        <div class="note">Import an Excel or CSV workbook. The importer scans every worksheet and recognises point-tier columns or Pokémon / Points tables; the worksheet does not need a specific name.</div>
        <div class="row" style="align-items:flex-end;margin-top:14px">
          <div><label>Tier List workbook</label><input id="freeAgencyFile" type="file" accept=".xlsx,.xls,.csv"></div>
          <div style="flex:0"><button class="primary" id="importFreeAgency">Import / Preview Workbook</button></div>
        </div>
        <div id="freeAgencyStatus" style="margin-top:12px"></div>
      </div>
      <div class="panel">
        <h2>Published Free Agency <span class="badge">${current.length} Pokémon</span></h2>
        ${current.length?`<div class="note">${SBL.pokemon.escapeHtml(STATE.settings?.freeAgency?.source||'Workbook')}</div>`:'<div class="empty-state">No Free Agency pool published yet.</div>'}
      </div>`;

    document.getElementById('importFreeAgency').onclick=async()=>{
      const file=document.getElementById('freeAgencyFile').files?.[0];
      const status=document.getElementById('freeAgencyStatus');
      if(!file){status.innerHTML='<div class="note danger">Choose the Tier List workbook first.</div>';return;}
      const btn=document.getElementById('importFreeAgency'); btn.disabled=true; status.innerHTML='<div class="note">Scanning workbook sheets and detecting Pokémon point values…</div>';
      try{
        const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
        const pool=parseFreeAgencyWorkbook(wb);
        status.innerHTML=`<div class="panel" style="padding:12px"><strong>Workbook imported successfully</strong><div class="note">Found ${pool.length} Pokémon across ${new Set(pool.map(x=>x.points)).size} point values in ${pool.sourceSheets?.length||1} worksheet(s), including ${pool.filter(x=>x.isMega).length} Mega forms. Mega costs are marked TBD and temporarily set to 1 point for sprite testing. ${pool.sourceSheets?.length?`Source: ${SBL.pokemon.escapeHtml(pool.sourceSheets.join(', '))}.`:``}</div>${pool.importWarnings?.length?`<div class="note danger">Review before publishing:<ul>${pool.importWarnings.map(w=>`<li>${SBL.pokemon.escapeHtml(w)}</li>`).join('')}</ul></div>`:''}<div style="max-height:380px;overflow:auto;margin-top:12px"><table><thead><tr><th>Pokémon</th><th>Points</th><th>Category</th></tr></thead><tbody>${pool.map(m=>`<tr><td>${SBL.pokemon.spriteMarkup(m.name,'sprite')} ${SBL.pokemon.escapeHtml(m.name)}</td><td class="num">${m.points}</td><td>${m.isMega?'Mega · cost TBD':'Standard'}</td></tr>`).join('')}</tbody></table></div><div class="foot-actions" style="margin-top:12px"><button class="primary" id="confirmFreeAgency">Publish Free Agency</button><button class="ghost" id="cancelFreeAgency">Cancel</button></div></div>`;
        document.getElementById('cancelFreeAgency').onclick=renderFreeAgency;
        document.getElementById('confirmFreeAgency').onclick=async()=>{const b=document.getElementById('confirmFreeAgency');b.disabled=true;try{await publishFreeAgency(pool,file.name);renderFreeAgency()}catch(e){status.innerHTML='<div class="note danger">'+SBL.pokemon.escapeHtml(e.message)+'</div>';b.disabled=false;}};
      }catch(e){status.innerHTML='<div class="note danger">'+SBL.pokemon.escapeHtml(e.message)+'</div>'}
      finally{btn.disabled=false}
    };
  }

  // ---------- Commissioner: team-claim approvals + trade oversight ----------
  // These read/write the `profiles` and `trade_requests` tables. Commissioners
  // can approve/reject Free Agency requests, reset resolved trades, and revert
  // accepted trades. Team-to-team acceptance remains handled by accept_trade().
  let COMM_PROFILES = null;
  let COMM_MEMBER_FRANCHISES = [];
  let COMM_TRADES = null;
  // Which section of the Trades workspace is showing.
  let COMM_TRADES_VIEW = 'pending';
  let ADMIN_TRADE_SEASON = new Date().getFullYear();

  let COMM_TRADE_LIMITS = [];

  async function loadCommissionerData(){
    // Trade management must not be blocked by an unrelated trade-limit/profile
    // query. Load each admin data source independently so the trade ledger still
    // renders when franchise_trade_limits is missing/empty or profiles fail.
    const currentLeagueId = String(SBL.leagueDb?.selectedLeagueId?.() || STATE.settings.activeLeagueId || '').trim();
    const [profilesResult, tradeResult, limitResult] = await Promise.allSettled([
      currentLeagueId ? supabase.rpc('sbl_admin_list_league_users',{p_league_id:currentLeagueId}) : Promise.resolve({data:[],error:null}),
      SBL.trades.load(supabase,{force:true}),
      supabase.from('franchise_trade_limits').select('*').eq('season', ADMIN_TRADE_SEASON).eq('league_id', currentLeagueId).order('team_name')
    ]);

    if(profilesResult.status === 'fulfilled' && !profilesResult.value?.error) COMM_PROFILES = profilesResult.value?.data || [];
    else { console.warn('League member profiles failed to load:', profilesResult.reason || profilesResult.value?.error); COMM_PROFILES = []; }
    if(currentLeagueId && profilesResult.status === 'fulfilled' && !profilesResult.value?.error){
      hydrateLeagueProfileCache(currentLeagueId, COMM_PROFILES);
    }
    try{
      COMM_MEMBER_FRANCHISES=currentLeagueId && SBL.franchiseOwnership?.listActiveMemberFranchises
        ? await SBL.franchiseOwnership.listActiveMemberFranchises(currentLeagueId,supabase) : [];
    }catch(error){ COMM_MEMBER_FRANCHISES=[]; console.warn('Active member franchise assignments unavailable for trade controls:',error); }

    if(tradeResult.status === 'rejected') throw tradeResult.reason;
    if(tradeResult.value?.error) throw tradeResult.value.error;
    COMM_TRADES = Array.isArray(tradeResult.value?.data) ? tradeResult.value.data : [];

    if(limitResult.status === 'fulfilled' && !limitResult.value?.error){
      COMM_TRADE_LIMITS = Array.isArray(limitResult.value.data) ? limitResult.value.data : [];
    } else {
      COMM_TRADE_LIMITS = [];
      console.warn('Franchise trade limits unavailable; trade ledger will still load.', limitResult.reason || limitResult.value?.error);
    }
  }

  async function loadFranchiseRequests(){
    requireAdmin();
    const leagueId = String(SBL.leagueDb?.selectedLeagueId?.() || STATE.settings.activeLeagueId || '').trim();
    if(!leagueId) throw new Error('No league is selected.');

    const [requestsResult, franchisesResult] = await Promise.all([
      supabase.from('franchise_requests')
        .select('id,league_id,user_id,franchise_id,status,created_at,rejection_reason,resolved_at,resolved_by')
        .eq('league_id', leagueId)
        .eq('status', 'pending')
        .order('created_at', {ascending:true}),
      supabase.from('franchises')
        .select('id,league_id,name,conference,claim_state,status')
        .eq('league_id', leagueId)
        .order('name', {ascending:true}),
    ]);

    if(requestsResult.error) throw requestsResult.error;
    if(franchisesResult.error) throw franchisesResult.error;

    await loadLeagueProfileCache(leagueId);
    const franchisesById = new Map((franchisesResult.data || []).map(f => [String(f.id), f]));
    const groups = new Map();

    (requestsResult.data || []).forEach(r => {
      const franchise = franchisesById.get(String(r.franchise_id));
      const key = String(r.franchise_id);
      if(!groups.has(key)) groups.set(key, {franchise, requests:[]});
      groups.get(key).requests.push({request:r});
    });

    return {leagueId, groups:[...groups.values()].sort((a,b)=>String(a.franchise?.name||'').localeCompare(String(b.franchise?.name||'')))};
  }

  function franchiseRequestCard(item){
    const r = item.request;
    const display = displayNameForUser(r.user_id);
    const created = r.created_at ? new Date(r.created_at).toLocaleString() : 'Unknown time';
    return `<div class="franchise-request-row">
      <div class="franchise-request-person">
        <strong>${SBL.pokemon.escapeHtml(display)}</strong>
        <span class="note">Requested ${SBL.pokemon.escapeHtml(created)}</span>
      </div>
      <div class="foot-actions">
        <button class="teal" type="button" data-franchise-request-approve="${SBL.pokemon.escapeHtml(r.id)}">Approve</button>
        <button class="danger" type="button" data-franchise-request-reject="${SBL.pokemon.escapeHtml(r.id)}">Reject</button>
      </div>
    </div>`;
  }

  async function renderFranchiseRequests(){
    contentEl.innerHTML = `<div class="empty-state">Loading franchise requests…</div>`;
    try{
      const {leagueId, groups} = await loadFranchiseRequests();
      if(activeTab !== 'franchise-requests') return;

      contentEl.innerHTML = `
        <div class="panel">
          <div class="section-head-row">
            <div><h2>Franchise Requests</h2><div class="note">Pending requests for the selected league. Multiple users may request the same franchise; approve one specific request or reject one with a required reason.</div></div>
            <div class="foot-actions"><button class="ghost" type="button" id="refreshFranchiseRequests">Refresh</button></div>
          </div>
        </div>
        ${groups.length ? groups.map(g=>`
          <div class="panel franchise-request-group">
            <div class="section-head-row">
              <div><h3>${SBL.pokemon.escapeHtml(g.franchise?.name || '(unknown franchise)')}</h3><div class="note">${g.requests.length} pending request${g.requests.length===1?'':'s'}</div></div>
              <span class="status-pill requested">requested</span>
            </div>
            <div class="franchise-request-list">${g.requests.map(franchiseRequestCard).join('')}</div>
          </div>`).join('') : `
          <div class="panel"><div class="empty-state">No pending franchise requests for this league.</div></div>`}
        <div class="note" id="franchiseRequestStatus"></div>`;

      const statusEl = document.getElementById('franchiseRequestStatus');
      document.getElementById('refreshFranchiseRequests')?.addEventListener('click', ()=>renderFranchiseRequests());

      contentEl.querySelectorAll('[data-franchise-request-approve]').forEach(btn=>btn.addEventListener('click', async()=>{
        const requestId = btn.dataset.franchiseRequestApprove;
        btn.disabled = true;
        if(statusEl) statusEl.textContent = '';
        try{
          const {data,error} = await supabase.rpc('sbl_approve_franchise_request',{p_request_id:requestId});
          if(error) throw error;
          if(statusEl) statusEl.textContent = `Approved ${requestId}. Refreshing…`;
          await renderFranchiseRequests();
        }catch(e){
          if(statusEl){ statusEl.className='note danger'; statusEl.textContent=`Could not approve request: ${e?.message||e}`; }
          btn.disabled = false;
        }
      }));

      contentEl.querySelectorAll('[data-franchise-request-reject]').forEach(btn=>btn.addEventListener('click', async()=>{
        const requestId = btn.dataset.franchiseRequestReject;
        const reason = window.prompt('Reason for rejecting this franchise request:');
        if(reason === null) return;
        const trimmed = String(reason).trim();
        if(!trimmed){ if(statusEl) statusEl.textContent='A rejection reason is required.'; return; }
        btn.disabled = true;
        if(statusEl){ statusEl.className='note'; statusEl.textContent=''; }
        try{
          const {data,error} = await supabase.rpc('sbl_reject_franchise_request',{p_request_id:requestId,p_rejection_reason:trimmed});
          if(error) throw error;
          if(statusEl) statusEl.textContent = `Rejected ${requestId}. Refreshing…`;
          await renderFranchiseRequests();
        }catch(e){
          if(statusEl){ statusEl.className='note danger'; statusEl.textContent=`Could not reject request: ${e?.message||e}`; }
          btn.disabled = false;
        }
      }));
    }catch(e){
      if(activeTab === 'franchise-requests'){
        contentEl.innerHTML = `<div class="panel"><div class="note danger">Could not load franchise requests: ${SBL.pokemon.escapeHtml(e.message||e)}</div></div>`;
      }
    }
  }

  function renderCommissioner(){
    contentEl.innerHTML = `<div class="empty-state">Loading user control data…</div>`;
    loadCommissionerData().then(()=>{
      if(activeTab === 'commissioner') drawCommissioner();
    }).catch(e=>{
      if(activeTab === 'commissioner'){
        contentEl.innerHTML = `<div class="panel"><div class="note danger">Could not load user control data: ${SBL.pokemon.escapeHtml(e.message)}</div></div>`;
      }
    });
  }

  function renderTrades(){
    contentEl.innerHTML = `<div class="empty-state">Loading trades…</div>`;
    loadCommissionerData().then(()=>{
      if(activeTab === 'trades') drawTrades();
    }).catch(e=>{
      if(activeTab === 'trades'){
        contentEl.innerHTML = `<div class="panel"><div class="note danger">Could not load trades: ${SBL.pokemon.escapeHtml(e.message)}</div></div>`;
      }
    });
  }

  function commClaimRow(p, showApproveReject){
    const isApproved = p.status === 'approved';
    return `<div class="trade-card">
      <div class="trade-head">
        <div>
          <div class="trade-teams">${SBL.pokemon.escapeHtml(activeFranchiseNameForUser(p.id) || '(no franchise assigned)')}</div>
          <div class="trade-sub"><strong>${SBL.pokemon.escapeHtml(displayNameForUser(p.id))}</strong> · joined ${new Date(p.created_at).toLocaleDateString()}</div>
        </div>
        <span class="status-pill ${p.status}">${p.status}</span>
      </div>
      ${p.is_commissioner ? '<span class="badge">Commissioner</span>' : ''}
      <div class="foot-actions">
        ${showApproveReject ? `
          <button class="teal" data-comm-action="approve" data-id="${p.id}">Approve</button>
          <button class="danger" data-comm-action="reject" data-id="${p.id}">Reject</button>
        ` : isApproved ? `
          <button class="danger" data-comm-action="reject" data-id="${p.id}">Reject</button>
          <button class="ghost small" data-comm-action="revoke" data-id="${p.id}">Set to pending</button>
        ` : `
          <button class="ghost small" data-comm-action="revoke" data-id="${p.id}">Set to pending</button>
        `}
        ${adminIsCommissioner
          ? ''
          : (p.is_commissioner
            ? `<button class="ghost small" data-comm-action="remove-commissioner" data-id="${p.id}">Remove commissioner</button>`
            : `<button class="ghost small" data-comm-action="make-commissioner" data-id="${p.id}">Make commissioner</button>`)}
      </div>
      <div class="note danger" id="commErr-${p.id}"></div>
    </div>`;
  }

  function commTradeRow(t){
    const canRevoke = t.status !== 'pending';
    const canRevert = t.status === 'accepted';
    const isFA = (t.target_team == null || String(t.target_team).trim() === '');
    const canCredit = t.status === 'pending';
    const canRejectFA = isFA && t.status === 'pending';
    const offered = (t.mons_offered||[]).map(SBL.pokemon.escapeHtml).join(', ') || '—';
    const requested = (t.mons_requested||[]).map(SBL.pokemon.escapeHtml).join(', ') || '—';

    return `<div class="trade-card">
      <div class="trade-head">
        <div class="trade-head-main">
          <span class="trade-kind-badge ${isFA ? 'fa' : 'team'}">${isFA ? 'Free Agency' : 'Team Trade'}</span>
          <div class="trade-teams">${SBL.pokemon.escapeHtml(t.proposer_team)}${isFA ? '' : ` &nbsp;⇄&nbsp; ${SBL.pokemon.escapeHtml(t.target_team)}`}</div>
        </div>
        <span class="status-pill ${t.status}">${t.status}</span>
      </div>
      <div class="trade-sub">${new Date(t.created_at).toLocaleString()}</div>
      <div class="trade-cols">
        <div class="trade-col">
          <h4>${SBL.pokemon.escapeHtml(t.proposer_team)} sends</h4>
          <div class="trade-mons">${offered}</div>
        </div>
        ${isFA ? '' : `<div class="trade-col">
          <h4>${SBL.pokemon.escapeHtml(t.target_team)} sends</h4>
          <div class="trade-mons">${requested}</div>
        </div>`}
      </div>
      ${(canCredit || canRejectFA || canRevoke || canRevert) ? `<div class="foot-actions">
        ${canCredit ? `<button class="teal small" data-trade-action="credit" data-trade-id="${t.id}" title="Manually apply this trade on the players' behalf">Credit trade</button>` : ''}
        ${canRejectFA ? `<button class="danger small" data-trade-action="reject-fa" data-trade-id="${t.id}">Reject</button>` : ''}
        ${canRevert ? `<button class="ghost small danger-btn" data-trade-action="revert" data-trade-id="${t.id}" title="Undo the roster swap and end this trade">Revert &amp; end</button>` : ''}
        ${canRevoke ? `<button class="ghost small" data-trade-action="revoke" data-trade-id="${t.id}">Reset to pending</button>` : ''}
      </div>` : `<div class="note trade-inactive-note">This trade isn't currently actionable.</div>`}
      <div class="note danger" id="tradeCommErr-${t.id}"></div>
    </div>`;
  }

  async function saveManualTradeCredits(){
    STATE.settings = STATE.settings || {};
    STATE.settings.tradeCredits = STATE.settings.tradeCredits || {};
    await saveSharedState();
  }

  function manualTradeCreditsFor(profileId){
    STATE.settings = STATE.settings || {};
    STATE.settings.tradeCredits = STATE.settings.tradeCredits || {};
    return Math.max(0, Number(STATE.settings.tradeCredits[profileId]) || 0);
  }

  function activePlayerProfiles(){
    return (COMM_PROFILES||[]).filter(p=>String(p.membership_status||'').toLowerCase()==='active' && String(p.member_type||'player')==='player');
  }
  function activeFranchiseNameForUser(userId){
    const row=(COMM_MEMBER_FRANCHISES||[]).find(x=>String(x.userId)===String(userId));
    return row?.franchise?.name || '';
  }

  function drawManualTradeCredits(){
    const profiles = activePlayerProfiles();
    const credits = STATE.settings?.tradeCredits || {};
    return `
      <div class="panel">
        <h2>Manual Trade Credits</h2>
        <div class="note">Select a player and add the number of trades you want to credit them. This is separate from individual trade requests.</div>
        <div class="row" style="margin-top:14px;align-items:end;">
          <div>
            <label for="manualTradePlayer">Player</label>
            <select id="manualTradePlayer" style="width:100%;">
              <option value="">Select a player…</option>
              ${profiles.map(p=>`<option value="${SBL.pokemon.escapeHtml(p.id)}">${SBL.pokemon.escapeHtml(displayNameForUser(p.id) + (activeFranchiseNameForUser(p.id) ? ' · ' + activeFranchiseNameForUser(p.id) : ''))}</option>`).join('')}
            </select>
          </div>
          <div style="max-width:180px;">
            <label for="manualTradeAmount">Trades to credit</label>
            <input id="manualTradeAmount" type="number" min="1" step="1" value="1" style="width:100%;background:var(--panel-alt);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 10px;">
          </div>
          <div style="flex:0 0 auto;">
            <button class="primary" id="creditManualTrades">Credit trades</button>
          </div>
        </div>
        <div id="manualTradeCreditStatus" class="note"></div>
        <div style="margin-top:16px;">
          ${profiles.length ? `<table><thead><tr><th>Player</th><th>Team</th><th class="num">Manual credits</th></tr></thead><tbody>
            ${profiles.map(p=>`<tr><td>${SBL.pokemon.escapeHtml(displayNameForUser(p.id))}</td><td>${SBL.pokemon.escapeHtml(activeFranchiseNameForUser(p.id) || '—')}</td><td class="num">${manualTradeCreditsFor(p.id)}</td></tr>`).join('')}
          </tbody></table>` : '<div class="empty-state">No approved players found.</div>'}
        </div>
      </div>`;
  }

  function tradeManagerRows(){
    const season = new Date().getFullYear();
    const teams = [...new Set((COMM_MEMBER_FRANCHISES||[]).map(x=>x.franchise?.name).filter(Boolean))].sort();
    const rows = teams.map(team=>{
      const row = COMM_TRADE_LIMITS.find(x=>x.team_name===team) || {team_name:team, team_trade_limit:8, free_agency_trade_limit:8};
      const teamUsed = COMM_TRADES.filter(t=>t.status==='accepted').filter(t=>(t.target_team != null && String(t.target_team).trim() !== '') && (t.proposer_team===team || t.target_team===team) && new Date(t.created_at).getFullYear()===season).length;
      const faUsed = COMM_TRADES.filter(t=>t.status==='accepted').filter(t=>t.target_team===null && t.proposer_team===team && new Date(t.created_at).getFullYear()===season).length;
      const teamLimit = Math.max(0, Number(row.team_trade_limit) || 0);
      const faLimit = Math.max(0, Number(row.free_agency_trade_limit) || 0);
      return `<tr>
        <td><strong>${SBL.pokemon.escapeHtml(team)}</strong><div class="note">${SBL.pokemon.escapeHtml(displayNameForUser((COMM_MEMBER_FRANCHISES||[]).find(x=>x.franchise?.name===team)?.userId))}</div></td>
        <td class="num"><span>${teamUsed} used</span></td>
        <td class="num"><input class="trade-limit-input" type="number" min="0" step="1" id="teamRemaining-${encodeURIComponent(team)}" value="${Math.max(0,teamLimit-teamUsed)}" aria-label="${SBL.pokemon.escapeHtml(team)} team trades remaining"></td>
        <td class="num"><span>${faUsed} used</span></td>
        <td class="num"><input class="trade-limit-input" type="number" min="0" step="1" id="faRemaining-${encodeURIComponent(team)}" value="${Math.max(0,faLimit-faUsed)}" aria-label="${SBL.pokemon.escapeHtml(team)} Free Agency trades remaining"></td>
        <td><button class="primary small" data-save-trade-limits="${SBL.pokemon.escapeHtml(team)}">Save</button><div class="note danger" id="tradeLimitErr-${encodeURIComponent(team)}"></div></td>
      </tr>`;
    }).join('');
    return `<div class="panel">
      <h2>Team Trade Limits</h2>
      <div class="note">Each franchise has <strong>two separate allowances</strong>: 8 team-to-team trades and 8 Free Agency trades by default. Edit the <strong>trades remaining</strong> directly below for each player/franchise; the underlying total allowance is adjusted automatically to preserve that remaining number after trades already used.</div>
      <div style="overflow:auto;margin-top:14px;">
        ${rows ? `<table><thead><tr><th>Player / Franchise</th><th class="num">Team trades used</th><th class="num">Team trades remaining</th><th class="num">FA trades used</th><th class="num">FA trades remaining</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty-state">No approved franchises yet.</div>'}
      </div>
    </div>`;
  }



  function tradeSubNav(){
    const pendingCount = COMM_TRADES.filter(t=>t.status==='pending').length;
    const views = [
      {id:'pending', label:'Pending', count:pendingCount},
      {id:'history', label:'History', count:null},
      {id:'limits', label:'Team Limits', count:null},
      {id:'credits', label:'Manual Credits', count:null}
    ];
    return `<div class="trade-subnav" role="tablist" aria-label="Trades view">
      ${views.map(v=>`<button type="button" class="trade-subnav-item ${COMM_TRADES_VIEW===v.id?'active':''}" data-trade-view="${v.id}" role="tab" aria-selected="${COMM_TRADES_VIEW===v.id}">
        ${v.label}${v.count ? ` <span class="badge">${v.count}</span>` : ''}
      </button>`).join('')}
    </div>`;
  }

  function drawTradesPendingView(){
    const pending = COMM_TRADES.filter(t=>t.status==='pending');
    return `<div class="panel">
      <div class="section-head-row">
        <div>
          <h2>Pending Trades</h2>
          <div class="note">Awaiting a response, or ready for you to credit on the players' behalf.</div>
        </div>
      </div>
      <div class="trade-list">
        ${pending.length ? pending.map(commTradeRow).join('') : '<div class="empty-state">No pending trades right now.</div>'}
      </div>
    </div>`;
  }

  function drawTradesHistoryView(){
    const history = COMM_TRADES.filter(t=>t.status!=='pending')
      .sort((a,b)=> new Date(b.created_at) - new Date(a.created_at));
    return `<div class="panel">
      <div class="section-head-row">
        <div>
          <h2>Trade History</h2>
          <div class="note">Completed, rejected, and reverted trades.</div>
        </div>
      </div>
      <div class="trade-list">
        ${history.length ? history.map(commTradeRow).join('') : '<div class="empty-state">No trade history yet.</div>'}
      </div>
    </div>`;
  }  function drawTrades(){
    let body;
    if(COMM_TRADES_VIEW === 'history') body = drawTradesHistoryView();
    else if(COMM_TRADES_VIEW === 'limits') body = tradeManagerRows();
    else if(COMM_TRADES_VIEW === 'credits') body = drawManualTradeCredits();
    else body = drawTradesPendingView();

    contentEl.innerHTML = `
      <div class="trade-workspace-head">
        <h2 class="trade-workspace-title">Trades <span class="badge">${COMM_TRADES.length} total</span></h2>
      </div>
      ${tradeSubNav()}
      ${body}`;

    contentEl.querySelectorAll('button[data-trade-view]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        COMM_TRADES_VIEW = btn.dataset.tradeView;
        drawTrades();
      });
    });

    document.getElementById('creditManualTrades')?.addEventListener('click', async ()=>{
      const playerId = document.getElementById('manualTradePlayer')?.value;
      const amount = Number(document.getElementById('manualTradeAmount')?.value);
      const statusEl = document.getElementById('manualTradeCreditStatus');
      if(statusEl){ statusEl.className='note'; statusEl.textContent=''; }
      if(!playerId){ if(statusEl){statusEl.className='note danger';statusEl.textContent='Select a player first.';} return; }
      if(!Number.isInteger(amount) || amount < 1){ if(statusEl){statusEl.className='note danger';statusEl.textContent='Enter a whole number of trades to credit.';} return; }
      const player = activePlayerProfiles().find(p => String(p.id) === String(playerId));
      if(!player) throw new Error('Player not found.');
      const btn=document.getElementById('creditManualTrades');
      btn.disabled=true;
      try{
        STATE.settings = STATE.settings || {};
        STATE.settings.tradeCredits = STATE.settings.tradeCredits || {};
        const before = manualTradeCreditsFor(playerId);
        STATE.settings.tradeCredits[playerId] = before + amount;
        await saveManualTradeCredits();
        const after = STATE.settings.tradeCredits[playerId];
        await logAdminAction('manual_trade_credit', `Credited ${amount} trade${amount===1?'':'s'} to ${activeFranchiseNameForUser(player.id) || displayNameForUser(player.id)}. Total manual credits: ${after}.`, {profileId:playerId, team:activeFranchiseNameForUser(player.id) || null, amount, total:after});
        if(statusEl){statusEl.className='note';statusEl.textContent=`Credited ${amount} trade${amount===1?'':'s'} to ${activeFranchiseNameForUser(player.id) || displayNameForUser(player.id)}. Total manual credits: ${after}.`;}
        drawTrades();
      }catch(e){
        if(statusEl){statusEl.className='note danger';statusEl.textContent='Could not credit trades: ' + e.message;}
      }finally{
        const b=document.getElementById('creditManualTrades'); if(b) b.disabled=false;
      }
    });

    contentEl.querySelectorAll('button[data-save-trade-limits]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const team = btn.dataset.saveTradeLimits;
        const key = encodeURIComponent(team);
        const teamRemaining = Number(document.getElementById(`teamRemaining-${key}`)?.value);
        const faRemaining = Number(document.getElementById(`faRemaining-${key}`)?.value);
        const teamUsed = COMM_TRADES.filter(t=>
          t.status==='accepted' &&
          (t.target_team != null && String(t.target_team).trim() !== '') &&
          (t.proposer_team===team || t.target_team===team) &&
          new Date(t.created_at).getFullYear()===new Date().getFullYear()
        ).length;
        const faUsed = COMM_TRADES.filter(t=>
          t.status==='accepted' &&
          t.target_team===null &&
          t.proposer_team===team &&
          new Date(t.created_at).getFullYear()===new Date().getFullYear()
        ).length;
        const teamLimit = teamUsed + teamRemaining;
        const faLimit = faUsed + faRemaining;
        const errEl = document.getElementById(`tradeLimitErr-${key}`);
        if(errEl){errEl.textContent='';errEl.className='note danger';}
        if(!Number.isInteger(teamRemaining)||teamRemaining<0||!Number.isInteger(faRemaining)||faRemaining<0){if(errEl)errEl.textContent='Enter whole numbers 0 or greater for trades remaining.';return;}
        btn.disabled=true;
        try{
          await SBL.trades.setLimits(team, teamLimit, faLimit, supabase);
          await logAdminAction('set_trade_limits', `Set trade limits for ${team}: ${teamLimit} team trades, ${faLimit} Free Agency trades.`, {team, teamLimit, freeAgencyLimit:faLimit});
          await loadCommissionerData();
          if(activeTab==='trades') drawTrades();
        }catch(e){if(errEl)errEl.textContent=e.message;btn.disabled=false;}
      });
    });

    contentEl.querySelectorAll('button[data-trade-action]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const id = Number(btn.dataset.tradeId);
        const action = btn.dataset.tradeAction;
        const errEl = document.getElementById(`tradeCommErr-${id}`);
        if(errEl){ errEl.className='note'; errEl.textContent=''; }
        if(action === 'revert' && !confirm('This undoes the roster swap from this accepted trade and ends it — it will NOT go back to pending. Continue?')) return;
        if(action === 'credit' && !confirm('Credit this trade to the players now? This will apply the roster swap on their behalf.')) return;
        btn.disabled = true;
        try{
          if(action === 'credit'){
            const trade = COMM_TRADES.find(t => Number(t.id) === id);
            if(!trade) throw new Error('Trade not found.');
            if((trade.target_team == null || String(trade.target_team).trim() === '')){
              await SBL.trades.acceptFreeAgency(id, supabase);
            }else{
              // Team-to-team trades normally use accept_trade() from the receiving
              // player's dashboard. The admin can trigger the same server-side
              // operation here when a player needs the trade credited manually.
              await SBL.trades.accept(id, supabase);
            }
          } else if(action === 'reject-fa'){
            await SBL.trades.respond(id, 'rejected', adminUser.id, supabase);
          } else if(action === 'revoke'){
            const trade = COMM_TRADES.find(t => Number(t.id) === id);
            if(!trade) throw new Error('Trade not found.');
            await SBL.trades.respond(id, 'pending', null, supabase);

            // Revoke means the previously accepted trade is being reopened.
            // Restore the pre-trade roster ownership immediately so that if the
            // proposer subsequently withdraws the pending trade, the published
            // roster is already back in its original state.
            if(trade.status === 'accepted' || trade.status === 'reverted'){
              reconcileRevertedTradeRoster(trade);
              await saveSharedState();
              await savePublishedRosters(STATE.settings.rosters || {});
            }

            // A pending trade does not consume a completed trade slot. Moving an
            // accepted trade back to pending therefore restores one trade credit
            // to each involved franchise/player immediately. This is deliberately
            // not written into profile.trade_credits: those are separate
            // commissioner-granted bonus credits, and adding one there as well
            // would refund the same trade twice.
            if(trade.status === 'accepted'){
              console.info(`Trade #${id} revoked: one trade allowance restored to ${trade.proposer_team}${trade.target_team ? ` and ${trade.target_team}` : ''}.`);
            }
          } else if(action === 'revert'){
            const trade = COMM_TRADES.find(t => Number(t.id) === id);
            if(!trade) throw new Error('Trade not found.');

            if((trade.target_team == null || String(trade.target_team).trim() === '')){
              // Free Agency reversions must not depend on the team-to-team
              // commissioner_revert_trade RPC. That RPC validates both sides
              // of a roster swap and can reject a FA pickup when the receiving
              // roster has since changed. A FA trade has only one recipient,
              // so revert it directly and restore the Pokémon to the FA pool.
              await SBL.trades.respond(id, 'reverted', adminUser.id, supabase);

              reconcileRevertedTradeRoster(trade);
              restoreRevertedFreeAgencyPool(trade);
              await saveSharedState();
              await savePublishedRosters(STATE.settings.rosters || {});
            } else {
              await SBL.trades.revert(id, supabase);

              // Older deployments of the RPC can end the trade without restoring
              // the roster snapshot. Reconcile the roster locally and persist both
              // dashboard state and the public roster row. The reconciliation is
              // idempotent, so it is safe if the RPC already restored the rosters.
              reconcileRevertedTradeRoster(trade);
              await saveSharedState();
              await savePublishedRosters(STATE.settings.rosters || {});
            }
          }
          const trade = COMM_TRADES.find(t => Number(t.id) === id);
          await SBL.performance?.invalidate('trades:all');
          await SBL.performance?.invalidate('replays:all');
          await logAdminAction('commissioner_trade_action', `Commissioner ${action} action on trade #${id}.`, {
            tradeId:id, action, proposerTeam:trade?.proposer_team || null, targetTeam:trade?.target_team || null
          });
          await loadCommissionerData();
          if(activeTab === 'trades') drawTrades();
        }catch(e){
          if(errEl){ errEl.className='note danger'; errEl.textContent=e.message; }
          else showAdminError(e.message);
          btn.disabled=false;
        }
      });
    });
  }

  // Reconcile the published roster after a commissioner reverts a trade.
  // The database RPC is responsible for ending the trade; this client-side
  // reconciliation keeps the roster snapshot in STATE.settings.rosters in sync
  // even when an older/alternate RPC only updates the trade status.
  function restoreRevertedFreeAgencyPool(trade){
    if(!trade || (trade.target_team != null && String(trade.target_team).trim() !== '')) return;
    STATE.settings = STATE.settings || {};
    STATE.settings.freeAgency = STATE.settings.freeAgency || {mons:[]};
    const pool = Array.isArray(STATE.settings.freeAgency.mons) ? STATE.settings.freeAgency.mons : [];
    const key = name => rosterKey(name);
    const existing = new Set(pool.map(mon => key(typeof mon === 'string' ? mon : mon?.name)));

    // Prefer the point value from the draft pool, then from any remaining
    // published FA metadata. The Pokémon is restored exactly once.
    const pointLookup = {};
    for(const mon of (STATE.settings?.draft?.pool || [])){
      if(mon?.name) pointLookup[key(mon.name)] = mon.points ?? null;
    }
    for(const mon of pool){
      const name = typeof mon === 'string' ? mon : mon?.name;
      if(name && pointLookup[key(name)] == null && typeof mon !== 'string') pointLookup[key(name)] = mon.points ?? null;
    }

    const requested = Array.isArray(trade.mons_requested) ? trade.mons_requested : [];
    for(const name of requested){
      const k = key(name);
      if(!k || existing.has(k)) continue;
      pool.push({name, points: pointLookup[k] ?? null});
      existing.add(k);
    }
    STATE.settings.freeAgency.mons = pool;
  }

  function reconcileRevertedTradeRoster(trade){
    if(!trade) throw new Error('Trade not found while reverting roster.');
    STATE.settings = STATE.settings || {};
    STATE.settings.rosters = normalizeStoredRosters(STATE.settings.rosters || {});
    const rosters = STATE.settings.rosters;
    const proposer = String(trade.proposer_team || '').trim();
    const target = trade.target_team == null ? null : String(trade.target_team || '').trim();
    if(!proposer) throw new Error('Trade has no proposer team.');

    const offered = (Array.isArray(trade.mons_offered) ? trade.mons_offered : []).map(normalizeRosterName).filter(Boolean);
    const requested = (Array.isArray(trade.mons_requested) ? trade.mons_requested : []).map(normalizeRosterName).filter(Boolean);
    const key = n => rosterKey(n);

    // Capture point metadata before removing anything. This matters because the
    // accepted trade may have moved the only copy of a Pokémon to the other side.
    const pointLookup = {};
    for(const list of Object.values(rosters)){
      for(const mon of (Array.isArray(list) ? list : [])){
        if(mon?.name) pointLookup[key(mon.name)] = mon;
      }
    }
    for(const mon of (STATE.settings?.draft?.pool || [])){
      if(mon?.name && !pointLookup[key(mon.name)]) pointLookup[key(mon.name)] = {name:mon.name, points:mon.points ?? null};
    }
    const entry = name => {
      const found = pointLookup[key(name)];
      return {name, points: found?.points ?? null};
    };
    const remove = (team, names) => {
      if(!team) return;
      const list = Array.isArray(rosters[team]) ? rosters[team] : [];
      const removeKeys = new Set(names.map(key));
      rosters[team] = list.filter(mon => !removeKeys.has(key(mon.name)));
    };
    const addMissing = (team, names) => {
      if(!team) return;
      const list = Array.isArray(rosters[team]) ? rosters[team] : [];
      const have = new Set(list.map(mon => key(mon.name)));
      for(const name of names){
        if(!have.has(key(name))){ list.push(entry(name)); have.add(key(name)); }
      }
      rosters[team] = list;
    };

    // Restore the exact pre-trade ownership:
    // proposer gets offered back; target gets requested back. For Free Agency,
    // the offered Pokémon return to the proposer and requested Pokémon leave.
    remove(proposer, requested);
    addMissing(proposer, offered);
    if(target){
      remove(target, offered);
      addMissing(target, requested);
    }
    STATE.settings.rosters = normalizeStoredRosters(rosters);
  }

  async function logAdminAction(actionType, message, metadata={}){
    const user = adminUser || (await supabase.auth.getUser()).data?.user;
    // Keep the existing admin_email column for backwards compatibility, but
    // store the admin's username in it for all new log entries.
    let adminUsername = null;
    try{
      const cachedProfile = (COMM_PROFILES || []).find(p => String(p.id) === String(user?.id));
      adminUsername = cachedProfile?.username || null;
      if(!adminUsername && user?.id){
        const profileRow = await SBL.profiles.get(user.id, 'username', supabase);
        adminUsername = profileRow?.username || null;
      }
    }catch(e){
      console.warn('Could not load admin username for audit log:', e);
    }
    const entry = {
      league_id: SBL.leagueDb?.selectedLeagueId?.() || null,
      admin_id: user?.id || null,
      admin_email: adminUsername || user?.email || null,
      action_type: actionType,
      message,
      metadata: Object.assign({
        season: STATE.settings?.activeSeason || DEFAULT_SEASON,
        page: 'admin.html'
      }, metadata || {})
    };

    // Primary audit store. Do not silently swallow this failure: if the insert
    // is rejected by Supabase (for example, an RLS policy), keep a local/shared
    // fallback so the action is still visible in the Admin Log.
    try{
      const {error} = await supabase.from('admin_logs').insert(entry);
      if(!error) return true;
      console.warn('Admin log write failed:', error);
    }catch(e){
      console.warn('Admin log write failed:', e);
    }

    try{
      STATE.settings = STATE.settings || {};
      const fallback = Array.isArray(STATE.settings.adminLogFallback)
        ? STATE.settings.adminLogFallback
        : [];
      fallback.unshift({
        ...entry,
        created_at: new Date().toISOString(),
        id: `fallback-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
      });
      STATE.settings.adminLogFallback = fallback.slice(0, 500);
      await saveSharedState();
      return false;
    }catch(e){
      console.warn('Admin log fallback write failed:', e);
      return false;
    }
  }

  async function drawAdminLog(){
    let logs = [];
    let loadError = '';
    try{
      let logQuery=supabase.from('admin_logs').select('*').order('created_at', {ascending:false}).limit(500);
      const currentLeagueId=SBL.leagueDb?.selectedLeagueId?.()||'';
      if(currentLeagueId) logQuery=logQuery.eq('league_id',currentLeagueId);
      const {data, error} = await logQuery;
      if(error) throw error;
      logs = data || [];
    }catch(e){ loadError = e.message || 'Could not load admin log.'; }

    // Include any entries that could not be written to admin_logs (for example
    // while the table's INSERT policy is being fixed).
    const fallback = Array.isArray(STATE.settings?.adminLogFallback)
      ? STATE.settings.adminLogFallback : [];
    if(fallback.length){
      const seen = new Set(logs.map(x => `${x.created_at}|${x.action_type}|${x.message}`));
      fallback.forEach(x => {
        const key = `${x.created_at}|${x.action_type}|${x.message}`;
        if(!seen.has(key)) logs.push(x);
      });
      logs.sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    const actions = [...new Set(logs.map(log => String(log.action_type || 'action')).filter(Boolean))].sort();
    contentEl.innerHTML = `
      <div class="panel">
        <div class="section-head-row">
          <div><h2>Admin Log</h2><div class="note">User control and administrative actions.</div></div>
          <div class="foot-actions">
            <select id="adminLogActionFilter" class="input">
              <option value="all">All actions</option>
              ${actions.map(a => `<option value="${SBL.pokemon.escapeHtml(a)}">${SBL.pokemon.escapeHtml(a)}</option>`).join('')}
            </select>
            <button class="ghost" id="refreshAdminLogBtn">Refresh</button>
          </div>
        </div>
        ${loadError ? `<div class="note danger">${SBL.pokemon.escapeHtml(loadError)}</div>` : ''}
        ${!loadError && !logs.length ? '<div class="empty-state">No admin actions have been logged yet.</div>' : ''}
        ${logs.length ? `<div class="admin-log-list">${logs.map(log => `
          <div class="admin-log-row" data-action="${SBL.pokemon.escapeHtml(log.action_type || 'action')}">
            <div class="admin-log-time">${SBL.pokemon.escapeHtml(new Date(log.created_at).toLocaleString())}</div>
            <div class="admin-log-action"><strong>${SBL.pokemon.escapeHtml(log.action_type || 'action')}</strong></div>
            <div class="admin-log-message">${SBL.pokemon.escapeHtml(log.message || '')}</div>
            <div class="admin-log-admin"><span class="admin-log-admin-label">Admin</span><strong>${SBL.pokemon.escapeHtml(displayNameForUser(log.admin_id))}</strong></div>
          </div>`).join('')}</div>` : ''}
      </div>`;
    document.getElementById('refreshAdminLogBtn')?.addEventListener('click', drawAdminLog);
    document.getElementById('adminLogActionFilter')?.addEventListener('change', e => {
      const selected=e.target.value;
      document.querySelectorAll('.admin-log-row').forEach(row => row.style.display = selected==='all'||row.dataset.action===selected ? '' : 'none');
    });
  }

  function drawCommissioner(){
    const pending = COMM_PROFILES.filter(p=>p.status==='pending');
    const approved = COMM_PROFILES.filter(p=>p.status==='approved');
    const rejected = COMM_PROFILES.filter(p=>p.status==='rejected');

    contentEl.innerHTML = `
      <div class="panel">
        <h2>User Control</h2>
        <div class="note">User administration only. Franchise ownership and franchise requests are managed in Franchise Requests and the normalised franchise system.</div>
      </div>
      <div class="panel">
        <h3>Profile &amp; permission administration</h3>
        ${approved.length ? approved.map(p=>`<div class="trade-card">
          <div class="trade-head">
            <div><div class="trade-teams">${SBL.pokemon.escapeHtml(p.username || displayNameForUser(p.id))}</div><div class="trade-sub">${SBL.pokemon.escapeHtml(displayNameForUser(p.id))}</div></div>
            ${p.is_commissioner ? '<span class="badge">Commissioner</span>' : ''}
          </div>
          <div class="foot-actions">
            ${adminIsCommissioner ? '' : (p.is_commissioner
              ? `<button class="ghost small" data-comm-action="remove-commissioner" data-id="${p.id}">Remove commissioner</button>`
              : `<button class="ghost small" data-comm-action="make-commissioner" data-id="${p.id}">Make commissioner</button>`)}
          </div>
          <div class="note danger" id="commErr-${p.id}"></div>
        </div>`).join('') : '<div class="empty-state">No approved users.</div>'}
      </div>`;

    contentEl.querySelectorAll('button[data-comm-action]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const id = btn.dataset.id;
        const action = btn.dataset.commAction;
        const errEl = document.getElementById(`commErr-${id}`);
        if(errEl) errEl.textContent='';
        btn.disabled=true;
        try{
          let patch=null;
          if((action==='make-commissioner' || action==='remove-commissioner') && adminIsCommissioner){
            throw new Error('Commissioners cannot change commissioner permissions. Only the owner can change permissions at the commissioner level.');
          }
          if(action==='make-commissioner') patch={is_commissioner:true};
          else if(action==='remove-commissioner') patch={is_commissioner:false};
          if(patch){
            await SBL.profiles.update(id, patch, supabase);
            const profile = (COMM_PROFILES || []).find(p => String(p.id) === String(id));
            await logAdminAction('commissioner_profile_action', `Changed ${displayNameForUser(id)}: ${action}.`, {profileId:id, action});
          }
          await loadCommissionerData();
          if(activeTab==='commissioner') drawCommissioner();
        }catch(e){
          if(errEl){errEl.className='note danger';errEl.textContent=e.message;}
          else showAdminError(e.message);
          btn.disabled=false;
        }
      });
    });
  }

  // ---------- Finals Mode ----------
  function finalsTeamFor(username){
    const k=String(username||'').trim().toLowerCase();
    return STATE.teamMap[k] || String(username||'').trim();
  }
  function finalsReplayScore(r){
    const score={p1:0,p2:0};
    for(const side of ['p1','p2']){
      const roster=Array.isArray(r?.teamRoster?.[side])?r.teamRoster[side]:[];
      const unique=new Set(roster.map(x=>String(typeof x==='string'?x:(x?.species||x?.name||'')).trim().toLowerCase()).filter(Boolean));
      if(!unique.size){ score[side]=0; continue; }
      const fainted=new Set(Object.values(r.mons||{}).filter(m=>m?.side===side && Number(m.deaths||0)>0).map(m=>String(m.species||'').trim().toLowerCase()).filter(Boolean));
      score[side]=Math.max(0,unique.size-fainted.size);
    }
    return score;
  }
  function finalsFixtureResult(week,home,away){
    for(const r of Object.values(STATE.replays||{})){
      if(!r?.players || String(r.week||'')!==String(week||'')) continue;
      const a=finalsTeamFor(r.players.p1), b=finalsTeamFor(r.players.p2);
      const same=(x,y)=>String(x||'').trim().toLowerCase()===String(y||'').trim().toLowerCase();
      if(!((same(a,home)&&same(b,away))||(same(a,away)&&same(b,home)))) continue;
      const score=finalsReplayScore(r); const p1=String(r.winner||'').trim().toLowerCase();
      const winner=same(p1,r.players.p1)?a:same(p1,r.players.p2)?b:null;
      return winner?{winner,score}:null;
    }
    return null;
  }
  function finalsStandings(){
    const map={};
    const rosters=STATE.settings.rosters||{};
    Object.keys(rosters).forEach(team=>{ map[String(team).trim().toLowerCase()]={team,wins:0,losses:0,diff:0,dealt:0}; });
    const fixture=STATE.settings.fixture||{};
    for(const round of (fixture.rounds||[])) for(const m of (round.matches||[])){
      const r=(()=>{
        for(const replay of Object.values(STATE.replays||{})){
          if(!replay?.players || String(replay.week||'')!==String(round.week||'')) continue;
          const a=finalsTeamFor(replay.players.p1), b=finalsTeamFor(replay.players.p2);
          const same=(x,y)=>String(x||'').trim().toLowerCase()===String(y||'').trim().toLowerCase();
          if(!((same(a,m.home)&&same(b,m.away))||(same(a,m.away)&&same(b,m.home)))) continue;
          const w=String(replay.winner||'').trim().toLowerCase();
          return same(w,replay.players.p1)?{winner:a,score:finalsReplayScore(replay)}:same(w,replay.players.p2)?{winner:b,score:finalsReplayScore(replay)}:null;
        }
        return null;
      })();
      if(!r?.winner) continue;
      const hk=String(m.home).trim().toLowerCase(), ak=String(m.away).trim().toLowerCase(), wk=String(r.winner).trim().toLowerCase();
      const lk=wk===hk?ak:hk, margin=Math.max(0,Number(Math.max(r.score.p1,r.score.p2))-Number(Math.min(r.score.p1,r.score.p2)));
      if(map[wk]){map[wk].wins++;map[wk].diff+=margin;} if(map[lk]){map[lk].losses++;map[lk].diff-=margin;}
    }
    const sort=(a,b)=>b.wins-a.wins || b.diff-a.diff || b.dealt-a.dealt || a.team.localeCompare(b.team,undefined,{sensitivity:'base'});
    const assignments=STATE.settings.franchises||{};
    const conf=t=>{ const exact=assignments[t.team]; if(exact==='a'||exact==='b')return exact; const k=t.team.toLowerCase(); const found=Object.keys(assignments).find(x=>x.toLowerCase()===k); return found?assignments[found]:''; };
    const a=Object.values(map).filter(x=>conf(x)==='a').sort(sort), b=Object.values(map).filter(x=>conf(x)==='b').sort(sort);
    return {a,b};
  }
  function openAdminFinalsScore(roundKey, matchId){
    const finals=SBL.finals.resolveMatchups(STATE.settings.finals||SBL.finals.defaultFinalsState());
    const round=finals.rounds.find(r=>r.key===roundKey), m=round?.matches.find(x=>x.id===matchId); if(!m||!m.teamA||!m.teamB)return;
    const overlay=document.createElement('div'); overlay.className='admin-score-overlay'; overlay.innerHTML=`<div class="admin-score-modal"><button type="button" class="modal-close" aria-label="Close">×</button><div class="finals-kicker">${SBL.pokemon.escapeHtml(round.name)}</div><h2>${SBL.pokemon.escapeHtml(m.teamA)} <span>vs</span> ${SBL.pokemon.escapeHtml(m.teamB)}</h2><div class="admin-score-grid"><label class="finals-score-team"><span class="finals-score-team-name">${SBL.pokemon.escapeHtml(m.teamA)}</span><input class="score-number finals-score-input-a" type="number" min="0" step="1" inputmode="numeric" value="${m.scoreA??''}" aria-label="${SBL.pokemon.escapeHtml(m.teamA)} score"></label><label class="finals-score-team"><span class="finals-score-team-name">${SBL.pokemon.escapeHtml(m.teamB)}</span><input class="score-number finals-score-input-b" type="number" min="0" step="1" inputmode="numeric" value="${m.scoreB??''}" aria-label="${SBL.pokemon.escapeHtml(m.teamB)} score"></label></div><div class="note">The higher score determines the winner. Saving advances the bracket immediately.</div><div class="foot-actions"><button type="button" class="primary" data-admin-score-save>Save score</button></div></div>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove(); overlay.querySelector('.modal-close').addEventListener('click',close); overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
    overlay.querySelectorAll('.score-number').forEach(input=>input.addEventListener('input',()=>{if(input.value!==''&&Number(input.value)<0)input.value='0';})); overlay.querySelector('[data-admin-score-save]').addEventListener('click',async()=>{const btn=overlay.querySelector('[data-admin-score-save]');const a=overlay.querySelector('.finals-score-input-a').value,b=overlay.querySelector('.finals-score-input-b').value;if(a===''||b===''){alert('Enter both scores.');return;}btn.disabled=true;try{STATE.settings.finals=SBL.finals.setResult(STATE.settings.finals,roundKey,matchId,{scoreA:a,scoreB:b});await saveSettings();await logAdminAction('set_finals_score',`Entered Finals score for ${matchId}.`,{round:roundKey,match:matchId,scoreA:Number(a),scoreB:Number(b)});close();renderSeasonSetup();}catch(err){alert('Could not save score: '+err.message);btn.disabled=false;}});
  }

  function renderFinalsAdminPanel(){
    const finals=SBL.finals.resolveMatchups(STATE.settings.finals||SBL.finals.defaultFinalsState());
    const monday=finals.startMonday || SBL.finals.mondayISO(new Date(Date.now()+7*86400000));
    const teams=activeMemberConfiguredFranchises().map(f=>f.name);

    // Build the automatic seed order for the initial editor. Once Finals exist,
    // the saved seed order becomes the editor's starting point instead.
    const autoStandings=finalsStandings();
    const autoSeeds=SBL.finals.makeSeedList(autoStandings.a.slice(0,6),autoStandings.b.slice(0,6));
    const seedSource=finals.seeds.length ? finals.seeds : autoSeeds;
    const selected=new Map(seedSource.map(s=>[Number(s.seed),String(s.team||'')]));

    const seedEditor=Array.from({length:12},(_,i)=>{
      const seed=i+1, value=selected.get(seed)||'';
      const options=teams.map(team=>`<option value="${SBL.pokemon.escapeHtml(team)}" ${team===value?'selected':''}>${SBL.pokemon.escapeHtml(team)}</option>`).join('');
      const bye=seed<=4?'QF bye':'';
      return `<div class="finals-seed-editor-row"><div class="finals-seed-number">#${seed}</div><select class="finals-seed-select" data-finals-seed="${seed}"><option value="">Select team…</option>${options}</select><span class="finals-seed-note">${bye}</span></div>`;
    }).join('');

    const matchRows=finals.rounds.map(r=>`<div class="panel finals-admin-round-panel"><h3 class="finals-admin-round-head">${SBL.pokemon.escapeHtml(r.name)} <span class="badge">${SBL.pokemon.escapeHtml(r.label)}</span></h3>${r.matches.map((m,mi)=>{
      const canPick=m.teamA&&m.teamB;
      const a=SBL.pokemon.escapeHtml(m.teamA||'TBD'), b=SBL.pokemon.escapeHtml(m.teamB||'TBD');
      const ready=m.teamA&&m.teamB;
      return `<div class="finals-admin-match-row" data-finals-admin-match="${m.id}"><button type="button" class="finals-admin-match-main" data-open-finals-score="${r.key}" data-open-finals-match="${m.id}"><span class="finals-admin-match-label">${r.key==='playin'?`PI ${mi+1}`:r.key==='quarterfinals'?`QF ${mi+1}`:r.key==='semifinals'?`SF ${mi+1}`:'FINAL'}</span><span class="finals-admin-teams"><strong>${a}</strong><span>vs</span><strong>${b}</strong></span><span class="finals-admin-score">${m.scoreA!=null&&m.scoreB!=null?`${m.scoreA} – ${m.scoreB}`:'—'}</span><span class="note">${m.winner?`Winner: ${SBL.pokemon.escapeHtml(m.winner)}`:ready?'Click to enter score':'Waiting'}</span></button>${canPick&&ready?`<select class="finals-winner-select" data-finals-round="${r.key}" data-finals-match="${m.id}"><option value="">Set winner…</option><option value="${a}" ${m.winner===m.teamA?'selected':''}>${a}</option><option value="${b}" ${m.winner===m.teamB?'selected':''}>${b}</option></select>`:'<span class="badge">Waiting</span>'}</div>`;
    }).join('')}</div>`).join('');

    const currentSeedCount=[...selected.values()].filter(Boolean).length;
    const isGenerated=finals.status!=='inactive' && finals.rounds.length>0;
    const seedNote=isGenerated
      ? 'Edit any autogenerated seed below, then use Regenerate Finals to rebuild the bracket with the new order. You do not need to re-enter all 12 teams.'
      : 'Seeds are autogenerated from the top 6 in each conference using the Finals seeding rules. You can edit any seed before generating the bracket.';

    return `<div class="panel"><h2>Finals Mode</h2><div class="note">${seedNote} Seeds 1–4 receive quarterfinal byes. Seeds 5–12 play the single-round play-in: 5v12, 6v11, 7v10, 8v9. After all four play-ins are decided, the lowest-seeded winner plays #1, the next-lowest plays #2, then #3 and #4. Every round runs Monday–Sunday.</div><div class="row finals-admin-start-row"><div><label>Finals start Monday</label><input type="date" id="finalsStartMonday" value="${monday}"></div><button class="primary" id="generateFinalsBtn">${isGenerated?'Regenerate Finals':'Generate Finals'}</button>${isGenerated?`<button class="ghost danger-btn" id="clearFinalsBtn">Clear Finals</button>`:''}</div><div id="finalsAdminStatus" class="note"></div><div class="finals-seed-editor"><div class="finals-seed-editor-head"><div><h3 class="finals-admin-round-head">Finals Seeds</h3><div class="note">${currentSeedCount}/12 seeds selected. Pick each team once.</div></div><span class="badge">${isGenerated?'Editable bracket seeds':'Auto-generated seeds'}</span></div>${seedEditor}</div>${isGenerated?`<div class="finals-admin-results-head"><div><h3 class="finals-admin-round-head">Finals Results</h3><div class="note finals-admin-results-note">Enter scores in the matchup popup or choose the winner directly here. Winner selection is admin-only; saving resolves the bracket immediately.</div></div><button class="primary" id="saveFinalsResultsBtn">Save Results</button></div><div id="finalsResultsStatus" class="note"></div>${matchRows}${finals.champion?`<div class="panel finals-admin-champion"><strong>Champion:</strong> ${SBL.pokemon.escapeHtml(finals.champion)}</div>`:''}`:''}</div>`;
  }

  // Active franchise choices are derived from active league members and their
  // authoritative franchise_assignments. Historical Showdown identity mappings
  // are intentionally excluded from current conference/draft configuration.
  async function loadActiveMemberFranchiseList(){
    const leagueId=SBL.leagueDb?.selectedLeagueId?.()||STATE.settings.activeLeagueId||'';
    if(!leagueId||!SBL.franchiseOwnership?.listActiveMemberFranchises) throw new Error('Active league membership service is unavailable.');
    const [rows,franchises]=await Promise.all([
      SBL.franchiseOwnership.listActiveMemberFranchises(leagueId,supabase),
      SBL.leagueDb.listFranchises(leagueId,supabase)
    ]);
    ACTIVE_MEMBER_FRANCHISES=(rows||[]).map(row=>({name:String(row.franchise?.name||'').trim(),conference:String(row.franchise?.conference||''),userId:String(row.userId||''),franchiseId:String(row.franchise?.id||'')})).filter(f=>f.name);
    ACTIVE_LEAGUE_FRANCHISES=(franchises||[]).filter(f=>String(f.status||'active')==='active').map(f=>({name:String(f.name||'').trim(),conference:String(f.conference||''),franchiseId:String(f.id||'')})).filter(f=>f.name);
    // A sit-out preserves ownership but removes that franchise from this season's
    // setup controls (conference assignments, manual differential, fixtures, etc.).
    ACTIVE_SEASON_SITOUT_USERS = new Set();
    try {
      const season = await SBL.leagueDb.getSeasonContext(leagueId, supabase);
      if (season?.id) {
        const {data: statuses, error: statusError} = await supabase.from('league_season_memberships')
          .select('user_id,status').eq('league_id', leagueId).eq('season_id', season.id);
        if (statusError) throw statusError;
        ACTIVE_SEASON_SITOUT_USERS = new Set((statuses||[]).filter(row=>String(row.status||'').toLowerCase()==='sitting_out').map(row=>String(row.user_id||'')));
      }
    } catch (error) {
      // Fail closed for season-configuration choices rather than accidentally
      // including a known-sit-out franchise when the season status cannot load.
      console.warn('Could not load season sit-out statuses for setup lists:', error);
      ACTIVE_SEASON_SITOUT_USERS = new Set(ACTIVE_MEMBER_FRANCHISES.map(f=>String(f.userId||'')));
    }
    ACTIVE_MEMBER_FRANCHISES_LOADED=true;
  }

  function configuredFranchises(){
    const configured = STATE.settings.franchises && typeof STATE.settings.franchises === 'object'
      ? STATE.settings.franchises : {};
    const definitions = STATE.settings.franchiseDefinitions && typeof STATE.settings.franchiseDefinitions === 'object'
      ? STATE.settings.franchiseDefinitions : {};
    if(ACTIVE_MEMBER_FRANCHISES_LOADED){
      return ACTIVE_LEAGUE_FRANCHISES.slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}))
        .map(f=>({name:f.name,franchiseId:f.franchiseId,conference:f.conference||configured[f.name]||definitions[f.name]?.conference||''}));
    }
    // Fail closed before normalized franchise rows load. Never derive a live
    // franchise list from replay usernames or profile.team_name.
    return [];
  }

  function activeMemberConfiguredFranchises(){
    const configured=STATE.settings.franchises&&typeof STATE.settings.franchises==='object'?STATE.settings.franchises:{};
    const definitions=STATE.settings.franchiseDefinitions&&typeof STATE.settings.franchiseDefinitions==='object'?STATE.settings.franchiseDefinitions:{};
    return ACTIVE_MEMBER_FRANCHISES.filter(f=>!ACTIVE_SEASON_SITOUT_USERS.has(String(f.userId||'')))
      .slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}))
      .map(f=>({name:f.name,franchiseId:f.franchiseId,conference:f.conference||configured[f.name]||definitions[f.name]?.conference||''}));
  }

  function franchiseOptions(selected=''){
    return configuredFranchises().map(f =>
      `<option value="${SBL.pokemon.escapeHtml(f.name)}" ${String(selected)===String(f.name)?'selected':''}>${SBL.pokemon.escapeHtml(f.name)}</option>`
    ).join('');
  }

  function saveFranchiseConferences(map){
    STATE.settings.franchises = map;
    return saveSettings();
  }

  // Return the number of rounds needed for a single round-robin. This is only
  // used to suggest a fixture length in the UI; the actual fixture generator
  // below is responsible for building the schedule.
  function roundRobinWeekCount(teamList){
    const n = [...new Set((teamList || []).map(t=>String(t || '').trim()).filter(Boolean))].length;
    return n < 2 ? 0 : (n % 2 === 0 ? n - 1 : n);
  }

  // ---------- Fixture / schedule ----------
  // Robust conference-aware scheduler.
  // Rules are configurable through STATE.settings.fixtureRules:
  //   interConferencePerWeek: default 1
  //   maxGamesPerTeamPerWeek: default 1
  // The default produces conference-first schedules, with one cross-conference
  // match per week whenever the league has at least one legal cross pairing.
  function conferenceOf(conferenceMap, team){
    const map = conferenceMap || {};
    if(map[team] === 'a' || map[team] === 'b') return map[team];
    const key = String(team || '').trim().toLowerCase();
    const found = Object.keys(map).find(k => String(k).trim().toLowerCase() === key);
    return found && (map[found] === 'a' || map[found] === 'b') ? map[found] : '';
  }

  function fixtureRules(){
    const r = STATE.settings.fixtureRules || {};
    return {
      interConferencePerWeek: Math.max(0, Math.min(10, Number.isFinite(Number(r.interConferencePerWeek)) ? Number(r.interConferencePerWeek) : 1)),
      maxGamesPerTeamPerWeek: Math.max(1, Math.min(2, Number.isFinite(Number(r.maxGamesPerTeamPerWeek)) ? Number(r.maxGamesPerTeamPerWeek) : 1))
    };
  }

  function pairKey(a,b){ return [String(a),String(b)].sort((x,y)=>x.localeCompare(y,undefined,{sensitivity:'base'})).join('||'); }
  function seededOrder(items, seed){
    return items.slice().sort((a,b)=>{
      const ha = [...String(a)].reduce((n,c)=>((n*31+c.charCodeAt(0))>>>0), seed>>>0);
      const hb = [...String(b)].reduce((n,c)=>((n*31+c.charCodeAt(0))>>>0), seed>>>0);
      return ha-hb || String(a).localeCompare(String(b));
    });
  }

  // Maximum matching for a set of available teams. Existing pair counts are
  // used as the cost so unique conference opponents are exhausted before a
  // return meeting is introduced.
  function maximumMatching(teams, pairCounts, seed){
    const available = seededOrder(teams, seed);
    const edges = [];
    for(let i=0;i<available.length;i++) for(let j=i+1;j<available.length;j++){
      const a=available[i], b=available[j];
      edges.push({a,b,count:pairCounts[pairKey(a,b)]||0});
    }
    edges.sort((x,y)=>x.count-y.count || String(x.a).localeCompare(String(y.a)) || String(x.b).localeCompare(String(y.b)));
    const used=new Set(), out=[];
    for(const e of edges){
      if(used.has(e.a)||used.has(e.b)) continue;
      used.add(e.a); used.add(e.b); out.push({home:e.a,away:e.b});
    }
    return out;
  }

  function chooseInterMatches(confA, confB, pairCounts, alreadyPlayed, quota, seed){
    const candidates=[];
    for(const a of confA) for(const b of confB){
      const key=pairKey(a,b);
      if(alreadyPlayed.has(a)||alreadyPlayed.has(b)) continue;
      candidates.push({a,b,count:pairCounts[key]||0});
    }
    candidates.sort((x,y)=>x.count-y.count || ((seededOrder([x.a],seed)[0]||'').localeCompare(seededOrder([y.a],seed)[0]||'')) || String(x.b).localeCompare(String(y.b)));
    const out=[];
    const used=new Set();
    for(const c of candidates){
      if(out.length>=quota) break;
      if(used.has(c.a)||used.has(c.b)) continue;
      used.add(c.a); used.add(c.b); out.push({home:c.a,away:c.b});
    }
    return out;
  }

  function generateFixture(teamNames, numWeeks, conferenceMap, rulesOverride){
    const rules = Object.assign(fixtureRules(), rulesOverride || {});
    const weeks = Math.max(1, parseInt(numWeeks,10)||1);
    const teams=[...new Set(teamNames.map(t=>String(t||'').trim()).filter(Boolean))];
    const confA=teams.filter(t=>conferenceOf(conferenceMap,t)==='a');
    const confB=teams.filter(t=>conferenceOf(conferenceMap,t)==='b');
    if(!confA.length || !confB.length) throw new Error('Assign every franchise to Conference A or Conference B before generating a conference fixture.');
    if(confA.length < 2 && confB.length < 2 && rules.interConferencePerWeek === 0) throw new Error('Each conference needs at least two teams when inter-conference games are disabled.');

    const pairCounts=Object.create(null);
    const rounds=[];
    const maxGames=rules.maxGamesPerTeamPerWeek;
    const crossQuota=rules.interConferencePerWeek;

    for(let w=0; w<weeks; w++){
      const played=new Set();
      const matches=[];
      const cross=chooseInterMatches(confA,confB,pairCounts,played,crossQuota,w+1);
      for(const m of cross){ matches.push(m); played.add(m.home); played.add(m.away); pairCounts[pairKey(m.home,m.away)]=(pairCounts[pairKey(m.home,m.away)]||0)+1; }

      // Fill each conference with the maximum number of legal pairings among
      // teams still available. With maxGamesPerTeamPerWeek=1 this guarantees
      // no team appears twice in a week.
      const remainingA=confA.filter(t=>!played.has(t));
      const remainingB=confB.filter(t=>!played.has(t));
      const intraA=maximumMatching(remainingA,pairCounts,1000+w*17);
      const intraB=maximumMatching(remainingB,pairCounts,2000+w*17);
      for(const m of [...intraA,...intraB]){
        if(played.has(m.home)||played.has(m.away)) continue;
        matches.push(m); played.add(m.home); played.add(m.away); pairCounts[pairKey(m.home,m.away)]=(pairCounts[pairKey(m.home,m.away)]||0)+1;
      }

      // If maxGamesPerTeamPerWeek is explicitly >1, fill a second pass using
      // still-available teams only. Default remains one game per team.
      if(maxGames>1){
        for(const group of [confA,confB]){
          const extra=maximumMatching(group.filter(t=>!played.has(t)),pairCounts,3000+w*19);
          for(const m of extra){ matches.push(m); played.add(m.home); played.add(m.away); pairCounts[pairKey(m.home,m.away)]=(pairCounts[pairKey(m.home,m.away)]||0)+1; }
        }
      }
      rounds.push({week:`Week ${w+1}`,matches});
    }
    return rounds;
  }

  function fixtureMatchCount(fixture){
    return (fixture?.rounds || []).reduce((total, round) => total + ((round && Array.isArray(round.matches)) ? round.matches.length : 0), 0);
  }

  function fixtureConferenceIssues(fixture, conferenceMap){
    const rounds=fixture?.rounds||[], issues=[];
    for(const r of rounds){
      let cross=0; const used=new Set();
      for(const m of r.matches||[]){
        const ca=conferenceOf(conferenceMap,m.home), cb=conferenceOf(conferenceMap,m.away);
        if(ca && cb && ca!==cb) cross++;
        if(used.has(m.home)||used.has(m.away)) issues.push({week:r.week,type:'duplicate-team',team:used.has(m.home)?m.home:m.away});
        used.add(m.home); used.add(m.away);
      }
      if(cross>fixtureRules().interConferencePerWeek) issues.push({week:r.week,type:'cross',cross});
    }
    return issues;
  }
  function validateFixture(fixture, conferenceMap, rulesOverride){
    const rules=Object.assign(fixtureRules(),rulesOverride||{});
    const rounds=fixture?.rounds||[];
    const issues=[];
    const known=new Set(Object.keys(conferenceMap||{}).map(k=>String(k).trim().toLowerCase()));
    rounds.forEach(r=>{
      const used=new Set();
      let cross=0;
      for(const m of (r.matches||[])){
        const home=String(m.home||'').trim(), away=String(m.away||'').trim();
        if(!home||!away){ issues.push(`${r.week}: match has a missing team.`); continue; }
        const hk=home.toLowerCase(), ak=away.toLowerCase();
        if(used.has(hk)) issues.push(`${r.week}: ${home} is scheduled more than once.`);
        if(used.has(ak)) issues.push(`${r.week}: ${away} is scheduled more than once.`);
        used.add(hk); used.add(ak);
        const ca=conferenceOf(conferenceMap,home), cb=conferenceOf(conferenceMap,away);
        if(!ca||!cb) issues.push(`${r.week}: ${home} vs ${away} has an unassigned conference.`);
        else if(ca!==cb) cross++;
        if(ca!==cb && cross>rules.interConferencePerWeek) issues.push(`${r.week}: more than ${rules.interConferencePerWeek} inter-conference game${rules.interConferencePerWeek===1?'':'s'}.`);
        if(!known.has(hk)||!known.has(ak)) issues.push(`${r.week}: ${home} vs ${away} contains a team not in the current franchise mapping.`);
      }
    });
    return issues;
  }
  function stripFranchiseSuffix(name){ return String(name||'').replace(/\s*\([^()]*\)\s*$/,'').trim(); }
  function normalizeFranchiseLookupName(name){
    return stripFranchiseSuffix(String(name||''))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g,'')
      .replace(/kajiu/g,'kaiju');
  }
  function editDistance(a,b){
    const x=String(a||''), y=String(b||'');
    const prev=Array.from({length:y.length+1},(_,i)=>i);
    for(let i=1;i<=x.length;i++){
      const cur=[i];
      for(let j=1;j<=y.length;j++) cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));
      for(let j=0;j<cur.length;j++) prev[j]=cur[j];
    }
    return prev[y.length];
  }
  function reconcileFranchiseName(name, knownNames){
    const raw=stripFranchiseSuffix(String(name||'').trim());
    if(!raw) return raw;
    const names=Array.isArray(knownNames)?knownNames.filter(Boolean):[];
    const exact=names.find(n=>String(n).trim()===raw);
    if(exact) return exact;
    const key=normalizeFranchiseLookupName(raw);
    const ci=names.find(n=>normalizeFranchiseLookupName(n)===key);
    if(ci) return ci;
    // Conservative typo recovery for imported spreadsheets. Only accept a
    // single close candidate and require a substantial shared name.
    const candidates=names.map(n=>({name:n,key:normalizeFranchiseLookupName(n),distance:editDistance(key,normalizeFranchiseLookupName(n))}))
      .filter(x=>x.key && x.distance<=2 && Math.min(x.key.length,key.length)>=8)
      .sort((a,b)=>a.distance-b.distance || a.name.localeCompare(b.name));
    if(candidates.length===1) return candidates[0].name;
    if(candidates.length>1 && candidates[0].distance<candidates[1].distance) return candidates[0].name;
    return raw;
  }

  // ---------- fixture upload parser ----------
  function parseFixtureWorkbook(wb){
    const sheetName = wb.SheetNames.find(n => /fixture|schedule/i.test(String(n).trim())) || wb.SheetNames[0];
    if(!sheetName) throw new Error('The workbook has no sheets.');
    const sheet = wb.Sheets[sheetName];

    // Layout 1: one match per row, with Week/Home/Away style column headers.
    const objRows = XLSX.utils.sheet_to_json(sheet, {defval:''});
    const simple = parseSimpleFixtureRows(objRows);
    if(simple) return reconcileParsedFixture(simple);

    // Layout 2: the league's own "FIXTURE" tab layout — several weeks placed
    // side by side, each a 4-column group (Home / VS / Away / blank) with a
    // "Week N" + date-range header row above its matches, repeating down and
    // across the sheet.
    const aoa = XLSX.utils.sheet_to_json(sheet, {header:1, defval:''});
    const blocked = parseBlockFixtureRows(aoa);
    if(blocked) return reconcileParsedFixture(blocked);

    throw new Error(`No Week/Home/Away table or "Week N" block layout found on the "${sheetName}" sheet.`);
  }
  // Runs every parsed Home/Away name through reconcileFranchiseName() against
  // the current Player -> Team mapping, so an uploaded fixture's spelling
  // gets corrected to the established franchise name on the spot — same
  // place regardless of which of the two sheet layouts it came from.
  function reconcileParsedFixture(parsed){
    const knownNames = activeMemberConfiguredFranchises().map(f => f.name);
    let corrected = 0;
    const corrections = [];
    const rounds = (parsed.rounds || []).map(r => ({
      week: r.week,
      matches: (r.matches || []).map(m => {
        const home = reconcileFranchiseName(m.home, knownNames);
        const away = reconcileFranchiseName(m.away, knownNames);
        if(home !== m.home) { corrected++; corrections.push({from:m.home, to:home}); }
        if(away !== m.away) { corrected++; corrections.push({from:m.away, to:away}); }
        return {home, away};
      })
    }));
    return {...parsed, rounds, corrected, corrections};
  }
  function parseSimpleFixtureRows(rows){
    if(!rows.length) return null;
    const fieldValue = (row, candidates) => {
      const keys = Object.keys(row);
      const key = keys.find(k => candidates.includes(String(k).trim().toLowerCase()));
      return key ? String(row[key] ?? '').trim() : '';
    };
    const weekOrder = [];
    const weekMap = {};
    let matched = 0, skipped = 0, currentWeek = '';
    for(const row of rows){
      const home = stripFranchiseSuffix(fieldValue(row, ['home','home team','hometeam','team a','teama']));
      const away = stripFranchiseSuffix(fieldValue(row, ['away','away team','awayteam','team b','teamb']));
      if(!home && !away) continue;
      const explicitWeek = fieldValue(row, ['week','round','wk']);
      if(explicitWeek) currentWeek = explicitWeek;
      const week = currentWeek || 'Week 1';
      if(!home || !away){ skipped++; continue; }
      if(!weekMap[week]){ weekMap[week] = []; weekOrder.push(week); }
      weekMap[week].push({home, away});
      matched++;
    }
    if(!matched) return null; // doesn't look like the simple header layout
    const rounds = weekOrder.map(week => ({week, matches:weekMap[week]}));
    return {rounds, skipped};
  }
  function parseBlockFixtureRows(aoa){
    const WEEK_RE = /^\s*week\s*\d+\b/i;
    const blocks = [];
    const rows = Array.isArray(aoa) ? aoa : [];

    // Find every explicit Week N label. League workbooks commonly place
    // multiple week blocks side-by-side, so each label is treated as the
    // anchor for one independent block.
    rows.forEach((row, r) => (row || []).forEach((cell, c) => {
      const text = String(cell ?? '').trim();
      if(WEEK_RE.test(text)) {
        const n = parseInt((text.match(/\d+/) || ['0'])[0], 10);
        blocks.push({row:r, col:c, week:`Week ${n}`});
      }
    }));
    if(!blocks.length) return null;

    // Deduplicate identical anchors and reject accidental duplicate Week N
    // labels at the same position rather than silently merging their games.
    const seenAnchors = new Set();
    const uniqueBlocks = blocks.filter(b => {
      const key = `${b.row}:${b.col}:${b.week}`;
      if(seenAnchors.has(key)) return false;
      seenAnchors.add(key);
      return true;
    });

    const weekMap = Object.create(null);
    const weekOrder = [];
    let skipped = 0;

    function addMatch(week, home, away){
      home = stripFranchiseSuffix(String(home ?? '').trim());
      away = stripFranchiseSuffix(String(away ?? '').trim());
      if(!home && !away) return false;
      if(!home || !away){ skipped++; return false; }
      if(!weekMap[week]) { weekMap[week] = []; weekOrder.push(week); }
      weekMap[week].push({home, away});
      return true;
    }

    for(const block of uniqueBlocks){
      const week = block.week;
      if(!weekMap[week]) { weekMap[week] = []; weekOrder.push(week); }

      // Read down from this Week label until the next Week label in the same
      // column. This supports the league's normal vertical block format.
      for(let r=block.row+1; r<rows.length; r++){
        const row = rows[r] || [];
        const here = String(row[block.col] ?? '').trim();
        if(WEEK_RE.test(here)) break;

        // Preferred layout: Home | VS | Away in the three columns below the
        // Week header.
        const c0 = String(row[block.col] ?? '').trim();
        const c1 = String(row[block.col+1] ?? '').trim().toLowerCase();
        const c2 = String(row[block.col+2] ?? '').trim();
        if(c0 && c2 && (!c1 || /^vs\.?$/i.test(c1) || /vs/i.test(c1))) {
          addMatch(week, c0, c2);
          continue;
        }

        // Some exported sheets put Home and Away directly adjacent.
        if(c0 && c1 && !/^vs\.?$/i.test(c1) && !/date|time|result|score/i.test(c1)) {
          addMatch(week, c0, c1);
          continue;
        }
      }
    }

    // Fallback for horizontal layouts where a Week N block is followed by a
    // Home / VS / Away header on the same row and match rows beneath it.
    for(const block of uniqueBlocks){
      const week = block.week;
      const headerLimit = Math.min(rows.length, block.row + 5);
      let matchHeaderRow = -1;
      for(let r=block.row+1; r<headerLimit; r++){
        const row = rows[r] || [];
        const slice = row.slice(block.col, block.col+6).map(v=>String(v??'').trim().toLowerCase());
        if(slice.some(v=>v==='home' || v==='home team') && slice.some(v=>v==='away' || v==='away team')) {
          matchHeaderRow = r; break;
        }
      }
      if(matchHeaderRow < 0) continue;
      const header = rows[matchHeaderRow] || [];
      const vals = header.slice(block.col, block.col+8).map(v=>String(v??'').trim().toLowerCase());
      const homeOffset = vals.findIndex(v=>v==='home' || v==='home team');
      const awayOffset = vals.findIndex(v=>v==='away' || v==='away team');
      if(homeOffset < 0 || awayOffset < 0) continue;
      for(let r=matchHeaderRow+1; r<rows.length; r++){
        const row = rows[r] || [];
        const anyWeek = row.some(v=>WEEK_RE.test(String(v??'').trim()));
        if(anyWeek) break;
        const home = row[block.col+homeOffset];
        const away = row[block.col+awayOffset];
        if(home || away) addMatch(week, home, away);
      }
    }

    // Normalise and sort by numeric week. Remove exact duplicate matches that
    // can occur when a workbook contains both a block and a summary table.
    const rounds = weekOrder
      .map(week => ({week, matches:weekMap[week] || []}))
      .map(r => {
        const seen = new Set();
        r.matches = r.matches.filter(m => {
          const k = pairKey(m.home,m.away);
          if(seen.has(k)) return false;
          seen.add(k); return true;
        });
        return r;
      })
      .filter(r => r.matches.length)
      .sort((a,b) => parseInt(a.week.match(/\d+/)?.[0]||0,10) - parseInt(b.week.match(/\d+/)?.[0]||0,10));

    if(!rounds.length) return null;
    return {rounds, skipped};
  }
  // ---------- League Updates ----------
  // Simple announcement feed stored in the shared __dashboard_state__ blob
  // (STATE.settings.leagueUpdates). Publishing writes an entry immediately;
  // there is no separate draft state, matching "create/publish" as one action.
  const UPDATE_CATEGORIES = ['League', 'Schedule', 'Rules', 'Site'];
  function genUpdateId(){ return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function renderUpdates(){
    const updates = (Array.isArray(STATE.settings.leagueUpdates) ? STATE.settings.leagueUpdates : [])
      .slice()
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    contentEl.innerHTML = `
      <div class="panel">
        <h2>Publish an Update</h2>
        <div class="note">Posted updates appear here immediately for anyone with access to this shared league data. There's no draft/preview step — Publish posts it right away.</div>
        <div class="row" style="margin-top:12px;">
          <div style="flex:2; min-width:220px;">
            <label>Title</label>
            <input type="text" id="updateTitle" placeholder="e.g. Week 6 fixtures are live">
          </div>
          <div style="flex:1; min-width:160px;">
            <label>Category</label>
            <select id="updateCategory">
              ${UPDATE_CATEGORIES.map(c => `<option value="${SBL.pokemon.escapeHtml(c)}">${SBL.pokemon.escapeHtml(c)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-bottom:12px;">
          <label>Update</label>
          <textarea id="updateBody" placeholder="What's the update?" style="min-height:110px;"></textarea>
        </div>
        <div class="foot-actions">
          <button class="primary" id="publishUpdateBtn">Publish update</button>
          <span id="publishUpdateStatus"></span>
        </div>
      </div>

      <div class="panel">
        <h2>Published Updates <span class="badge">${updates.length}</span></h2>
        <div id="updatesList" style="margin-top:6px;">
          ${updates.length ? '' : '<div class="empty-state">Nothing published yet. Updates you publish above will show up here.</div>'}
        </div>
      </div>
    `;

    const listEl = document.getElementById('updatesList');
    if(updates.length){
      listEl.innerHTML = updates.map(u => `
        <div class="map-row update-row" style="align-items:flex-start;">
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="pname">${SBL.pokemon.escapeHtml(u.title || '(untitled)')}</span>
              <span class="badge update-badge-${SBL.pokemon.escapeHtml((u.category || 'League').toLowerCase())}">${SBL.pokemon.escapeHtml(u.category || 'League')}</span>
            </div>
            <div class="note" style="margin-top:4px; white-space:pre-wrap;">${SBL.pokemon.escapeHtml(u.body || '')}</div>
            <div class="note" style="margin-top:6px; color:var(--text-dim);">${u.createdAt ? new Date(u.createdAt).toLocaleString() : ''}${u.publishedBy ? ' · ' + SBL.pokemon.escapeHtml(u.publishedBy) : ''}</div>
          </div>
          <button class="ghost small danger-btn" data-delete-update="${SBL.pokemon.escapeHtml(u.id)}">Delete</button>
        </div>
      `).join('');
    }

    document.getElementById('publishUpdateBtn').addEventListener('click', async () => {
      const title = document.getElementById('updateTitle').value.trim();
      const category = document.getElementById('updateCategory').value;
      const body = document.getElementById('updateBody').value.trim();
      const status = document.getElementById('publishUpdateStatus');
      if(!title || !body){
        if(status) status.innerHTML = `<span style="color:var(--red);">Title and update text are both required.</span>`;
        return;
      }
      const btn = document.getElementById('publishUpdateBtn');
      btn.disabled = true;
      try{
        let publishedBy = null;
        try{
          const cachedProfile = (COMM_PROFILES || []).find(p => String(p.id) === String(adminUser?.id));
          publishedBy = cachedProfile?.username || adminUser?.email || null;
        }catch(e){ publishedBy = adminUser?.email || null; }
        const entry = {
          id: genUpdateId(),
          title,
          category: UPDATE_CATEGORIES.includes(category) ? category : 'League',
          body,
          createdAt: new Date().toISOString(),
          publishedBy
        };
        STATE.settings.leagueUpdates = [entry, ...(Array.isArray(STATE.settings.leagueUpdates) ? STATE.settings.leagueUpdates : [])];
        await saveSettings();
        await logAdminAction('publish_league_update', `Published a "${entry.category}" update: ${entry.title}`, {updateId: entry.id, category: entry.category});
        if(activeTab === 'updates') renderUpdates();
      }catch(e){
        if(status) status.innerHTML = `<span style="color:var(--red);">Could not publish: ${SBL.pokemon.escapeHtml(e.message)}</span>`;
        btn.disabled = false;
      }
    });

    listEl?.querySelectorAll('[data-delete-update]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteUpdate;
        const target = (STATE.settings.leagueUpdates || []).find(u => u.id === id);
        if(!confirm(`Delete this update${target ? ': "' + target.title + '"' : ''}? This can't be undone.`)) return;
        btn.disabled = true;
        try{
          STATE.settings.leagueUpdates = (STATE.settings.leagueUpdates || []).filter(u => u.id !== id);
          await saveSettings();
          await logAdminAction('delete_league_update', `Deleted a published update: ${target ? target.title : id}`, {updateId: id});
          if(activeTab === 'updates') renderUpdates();
        }catch(e){
          alert('Could not delete: ' + e.message);
          btn.disabled = false;
        }
      });
    });
  }

  function renderSeasonSetup(){
    const franchises = activeMemberConfiguredFranchises();
    const conferenceMap = STATE.settings.conferenceNames || {};
    const conferenceA = conferenceMap.a || 'Conference A';
    const conferenceB = conferenceMap.b || 'Conference B';
    const manualDiffs = (STATE.settings.ladderDifferentials && typeof STATE.settings.ladderDifferentials === 'object') ? STATE.settings.ladderDifferentials : {};
    const seasonArchives = STATE.settings.seasonArchives || {};
    const archiveEntries = Object.entries(seasonArchives).sort((a,b)=> (b[1].archivedAt||'').localeCompare(a[1].archivedAt||''));
    contentEl.innerHTML = `
      <div class="panel">
        <h2>Season</h2>
        <div class="note">Current season: <strong>${SBL.pokemon.escapeHtml(STATE.settings.activeSeason || DEFAULT_SEASON)}</strong> — ${Object.keys(STATE.replays||{}).length} replay${Object.keys(STATE.replays||{}).length===1?'':'s'} processed.</div>
        <div class="row" style="align-items:end;gap:10px;flex-wrap:wrap;margin-top:12px;"><div style="min-width:220px;flex:1;"><label for="renameSeasonInput">Season display name</label><input id="renameSeasonInput" value="${SBL.pokemon.escapeHtml(STATE.settings.activeSeason || DEFAULT_SEASON)}" maxlength="80"></div><button class="ghost" id="renameSeasonBtn">Save season name</button></div>
        <div class="foot-actions">
          <button class="primary" id="newSeasonBtn">Start new season…</button>
          <button class="ghost danger-btn" id="clearRostersBtn">Clear current rosters</button>
        </div>
        <div class="note" style="margin-top:10px;">Starting a new season archives every replay, roster, draft, and free-agency pool exactly as it stands right now, then clears the board so you can start drafting fresh. Nothing is deleted — archived seasons stay viewable and any one of them can be set back as current below.</div>
        <div id="seasonArchiveRows" style="margin-top:16px;">
          ${archiveEntries.length ? archiveEntries.map(([key,a])=>`
            <div class="map-row" style="align-items:center;">
              <div style="flex:1;">
                <div style="font-weight:600;">${SBL.pokemon.escapeHtml(a.name||key)}</div>
                <div class="note" style="margin:2px 0 0;">${Object.keys(a.replays||{}).length} replay${Object.keys(a.replays||{}).length===1?'':'s'} · archived ${a.archivedAt ? new Date(a.archivedAt).toLocaleDateString() : '—'}</div>
              </div>
              <button class="ghost small" data-restore-season="${SBL.pokemon.escapeHtml(key)}">Set as current</button>
              <button class="ghost small danger-btn" data-delete-season="${SBL.pokemon.escapeHtml(key)}">Delete</button>
            </div>`).join('') : '<div class="empty-state">No archived seasons yet.</div>'}
        </div>
      </div>

      <div class="panel">
        <h2>Roster Management</h2>
        <div class="note">
          Upload the season's rosters from Excel or CSV. The existing roster importer supports the league's
          Season 15 workbook format (one team per sheet, points in Column A and Pokémon in Column C), as well
          as a generic Team / Franchise + Pokémon / Species table. Uploaded rosters are only previewed until you
          click <strong>Publish rosters</strong>.
        </div>
        <div class="row" style="margin-top:14px; align-items:end; flex-wrap:wrap;">
          <div style="flex:1; min-width:260px;">
            <label>Roster workbook (.xlsx / .xls / .csv)</label>
            <input type="file" id="rosterFile" accept=".xlsx,.xls,.csv">
          </div>
          <button class="ghost" id="loadRosterFileBtn">Read roster file</button>
          <button class="primary" id="publishRostersBtn" disabled>Publish rosters</button>
          <button class="ghost danger-btn" id="clearRostersFromManagementBtn" type="button">Clear current rosters</button>
        </div>
        <div class="note" style="margin-top:8px;">Clear removes current-season Pokémon from rosters. You will separately be asked whether to clear the Free Agency pool and reset draft status. Archived seasons and franchise assignments are preserved.</div>
        <div id="rosterUploadStatus"></div>
        <div id="rosterPreview" style="margin-top:14px;"></div>
      </div>
      <div class="panel manual-diff-panel">
        <h2>Manual Ladder Differentials</h2>
        <div class="manual-diff-help">Set a franchise's differential at the current played week when the automatic result is wrong. Future fixture results continue from this baseline. Leave blank to use the automatic calculation.</div>
        <div id="manualDifferentialRows" class="manual-diff-grid"></div>
        <div class="manual-diff-actions" style="margin-top:10px;">
          <button class="primary small" id="saveManualDifferentials">Save</button>
          <button class="ghost small" id="clearManualDifferentials">Clear overrides</button>
          <span id="manualDifferentialStatus"></span>
        </div>
      </div>

      <div class="panel">
        <h2>Franchise Conferences</h2>
        <div class="note">Every franchise from the published roster is listed below. Click its conference dropdown to assign it. This setting is stored in Admin only and does not change the roster data.</div>
        <div class="row" style="margin-top:12px; gap:12px; align-items:end;">
          <div style="flex:1;"><label>Conference 1 name</label><input type="text" id="conferenceNameA" value="${SBL.pokemon.escapeHtml(conferenceA)}"></div>
          <div style="flex:1;"><label>Conference 2 name</label><input type="text" id="conferenceNameB" value="${SBL.pokemon.escapeHtml(conferenceB)}"></div>
          <button class="primary" id="saveConferenceNames">Save conference names</button>
        </div>
        <div id="franchiseConferenceRows" style="margin-top:16px;">
          ${franchises.length ? franchises.map(f=>`
            <div class="map-row" style="align-items:center;">
              <div style="flex:1; font-weight:600;">${SBL.pokemon.escapeHtml(f.name)}</div>
              <select class="franchise-conference-select" data-franchise="${SBL.pokemon.escapeHtml(f.name)}" data-franchise-id="${SBL.pokemon.escapeHtml(f.franchiseId||'')}" style="min-width:220px;">
                <option value="">Unassigned</option>
                <option value="a" ${f.conference==='a'?'selected':''}>${SBL.pokemon.escapeHtml(conferenceA)}</option>
                <option value="b" ${f.conference==='b'?'selected':''}>${SBL.pokemon.escapeHtml(conferenceB)}</option>
              </select>
            </div>`).join('') : '<div class="empty-state">No franchise names found in Player → Team name mapping yet. Add mappings below, and each unique team name will appear here.</div>'}
        </div>
      </div>
      <div class="panel">
        <h2>Playoffs / Qualification</h2>
        <div class="note">Controls the "Qualification" tab in each franchise's summary popup on the Season page — current standing, the path to the top 6 (who needs to win or lose), and remaining fixtures. Leave this off during the regular season and switch it on once the playoff picture is worth showing, typically toward the end of the season.</div>
        <div class="row" style="margin-top:12px; align-items:center;">
          <label style="display:flex; align-items:center; gap:8px; margin:0; cursor:pointer;">
            <input type="checkbox" id="qualificationToggle" ${STATE.settings.qualificationEnabled ? 'checked' : ''}>
            Show the Qualification tab on the Season page
          </label>
        </div>
      </div>
      ${renderFinalsAdminPanel()}
      ${(()=>{
        const fxTeamNames = franchises.map(f=>f.name);
        const fxConfA = franchises.filter(f=>f.conference==='a').map(f=>f.name);
        const fxConfB = franchises.filter(f=>f.conference==='b').map(f=>f.name);
        window.__suggestedFixtureWeeks = fxTeamNames.length < 2 ? '' :
          (fxConfA.length>=2 && fxConfB.length>=2 && fxConfA.length+fxConfB.length===fxTeamNames.length)
            ? Math.max(roundRobinWeekCount(fxConfA), roundRobinWeekCount(fxConfB), 1)
            : roundRobinWeekCount(fxTeamNames);
        return '';
      })()}      <div class="panel">
        <h2>Fixture / Schedule</h2>
        <div class="note">Generate or upload a round-robin schedule as a private draft first. It only appears on the public Season page after you explicitly publish it.</div>
        <div class="note" style="margin-top:6px;">Assign every franchise to a conference above first — the generator will then schedule each team against the other teams in its own conference, plus at most one inter-conference match per week (the league's actual rule). Uploads are checked against the same rule and flagged if a week ends up with more than one cross-conference game.</div>
        <div id="fixtureTargetStatus" class="note" style="margin-top:10px;">Checking selected league and season…</div>
        <div id="fixtureSummary" style="margin-top:14px;"></div>
        <div class="row" style="margin-top:14px; gap:12px; align-items:end; flex-wrap:wrap;">
          <div>
            <label>Weeks</label>
            <input type="text" inputmode="numeric" id="fixtureWeeks" value="${window.__suggestedFixtureWeeks || ''}" placeholder="e.g. 11" style="width:90px;">
          </div>
          <div>
            <label>Inter-conference games / week</label>
            <input type="number" min="0" max="10" step="1" id="fixtureInterGames" value="${fixtureRules().interConferencePerWeek}" style="width:130px;">
          </div>
          <div>
            <label>Max games / team / week</label>
            <input type="number" min="1" max="2" step="1" id="fixtureMaxGames" value="${fixtureRules().maxGamesPerTeamPerWeek}" style="width:130px;">
          </div>
          <button class="primary" id="generateFixtureBtn">Generate fixture draft</button>
          <button class="ghost" id="publishFixtureBtn" disabled>Publish fixture</button>
          <button class="ghost" id="discardFixtureDraftBtn" disabled>Discard draft</button>
        </div>
        <div class="note" style="margin-top:8px;">Uses the ${franchises.length} franchise${franchises.length===1?'':'s'} currently in the Player → Team name mapping below. Teams are conference-first, each team is limited to the configured maximum games per week, and the generator prioritises unique conference opponents before repeats. With the default of 1 inter-conference game per week, it will schedule one cross-conference matchup whenever a legal pairing is available.</div>
        <div class="row" style="margin-top:18px; gap:12px; align-items:end; flex-wrap:wrap;">
          <div>
            <label>Upload fixture (.xlsx / .xls / .csv)</label>
            <input type="file" id="fixtureFile" accept=".xlsx,.xls,.csv">
          </div>
          <button type="button" class="ghost" id="uploadFixtureBtn" style="position:relative;z-index:5;pointer-events:auto;cursor:pointer;">Upload fixture draft</button>
        </div>
        <div class="note" style="margin-top:8px;">Accepts either a simple table with <code>Week</code> / <code>Home</code> / <code>Away</code> columns (any order), or the league's own "FIXTURE" tab layout (multiple "Week N" blocks with Home / VS / Away rows underneath, side by side). If the workbook has a sheet named "FIXTURE" or "Schedule", that sheet is used automatically.</div>
        <div id="fixtureStatus" style="margin-top:8px"></div>
        <div class="note" style="margin-top:14px;">Once a fixture is saved, this looks at each replay's two franchises, finds which scheduled fixture match they belong to, and sets that replay's week to match — so the Season page picks it up automatically instead of you setting each replay's week by hand. If a pair of teams played each other more than once (e.g. a return leg), games are matched to scheduled meetings in the order they were played.</div>
        <div id="matchReplaysStatus" style="margin-top:8px;"></div>
        <div class="foot-actions" style="margin-top:14px;">
          <button class="ghost" id="matchReplaysBtn">Match replays to fixture weeks</button>
          <button class="ghost danger-btn" id="clearFixtureBtn">Clear fixture</button>
        </div>
      </div>`;
    let pendingRosterUpload = null;
    const rosterStatus = document.getElementById('rosterUploadStatus');
    const rosterPreview = document.getElementById('rosterPreview');
    // Season Management uses two levels of lightweight navigation:
    // major tools first, then a small local sub-navigation where several
    // closely related controls belong together. Existing panels, IDs,
    // handlers and data operations are deliberately left untouched.
    const seasonPanels = Array.from(contentEl.querySelectorAll(':scope > .panel'));
    const seasonPrimary = [
      {title:'Season', help:'Season lifecycle and archives.', indexes:[0]},
      {title:'Rosters', help:'Publish the current rosters.', indexes:[1]},
      {title:'Competition', help:'Standings, conferences and qualification.', indexes:[2,3,4], sub:[
        {title:'Standings', index:2},
        {title:'Conferences', index:3},
        {title:'Qualification', index:4}
      ]},
      {title:'Finals', help:'Bracket, seeding and results.', indexes:[5]},
      {title:'Schedule', help:'Fixture generation and matching.', indexes:[6]}
    ];

    const workspace=document.createElement('div'); workspace.className='season-admin-workspace';
    const header=document.createElement('div'); header.className='season-admin-workspace-head';
    header.innerHTML=`<div><div class="season-admin-eyebrow">Season Management</div><h2>${SBL.pokemon.escapeHtml(STATE.settings.activeSeason || DEFAULT_SEASON)}</h2></div><div class="season-admin-head-meta">${Object.keys(STATE.replays||{}).length} replay${Object.keys(STATE.replays||{}).length===1?'':'s'} processed</div>`;
    const nav=document.createElement('div'); nav.className='season-admin-local-nav';
    const main=document.createElement('div'); main.className='season-admin-content';

    seasonPrimary.forEach((group,index)=>{
      const button=document.createElement('button');
      button.type='button'; button.dataset.seasonPrimary=String(index); button.className=`season-admin-local-tab ${index===0?'active':''}`;
      button.innerHTML=`<strong>${SBL.pokemon.escapeHtml(group.title)}</strong><span>${SBL.pokemon.escapeHtml(group.help)}</span>`;
      nav.appendChild(button);

      const pane=document.createElement('section'); pane.className=`season-admin-pane ${index===0?'active':''}`; pane.dataset.seasonPrimaryPane=String(index); pane.setAttribute('aria-label',group.title);
      const panels=group.indexes.map(i=>seasonPanels[i]).filter(Boolean);
      if(group.sub){
        const subnav=document.createElement('div'); subnav.className='season-admin-subnav';
        const subcontent=document.createElement('div'); subcontent.className='season-admin-subcontent';
        group.sub.forEach((sub,subIndex)=>{
          const sb=document.createElement('button'); sb.type='button'; sb.className=`season-admin-subtab ${subIndex===0?'active':''}`; sb.dataset.seasonSub=String(subIndex); sb.textContent=sub.title; subnav.appendChild(sb);
          const sp=document.createElement('div'); sp.className=`season-admin-subpane ${subIndex===0?'active':''}`; sp.dataset.seasonSubPane=String(subIndex);
          if(seasonPanels[sub.index]) sp.appendChild(seasonPanels[sub.index]);
          subcontent.appendChild(sp);
        });
        pane.appendChild(subnav); pane.appendChild(subcontent);
      }else{
        panels.forEach(panel=>pane.appendChild(panel));
      }
      main.appendChild(pane);
    });

    workspace.appendChild(header); workspace.appendChild(nav); workspace.appendChild(main); contentEl.appendChild(workspace);
    seasonPanels.forEach(panel=>{ if(panel.parentElement===contentEl) panel.remove(); });

    nav.querySelectorAll('[data-season-primary]').forEach(btn=>btn.addEventListener('click',()=>{
      const target=btn.dataset.seasonPrimary;
      nav.querySelectorAll('[data-season-primary]').forEach(b=>{const active=b===btn;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');});
      main.querySelectorAll('.season-admin-pane').forEach(p=>p.classList.toggle('active',p.dataset.seasonPrimaryPane===target));
    }));
    main.querySelectorAll('.season-admin-pane').forEach(pane=>{
      pane.querySelectorAll('[data-season-sub]').forEach(btn=>btn.addEventListener('click',()=>{
        const target=btn.dataset.seasonSub;
        pane.querySelectorAll('[data-season-sub]').forEach(b=>b.classList.toggle('active',b===btn));
        pane.querySelectorAll('.season-admin-subpane').forEach(p=>p.classList.toggle('active',p.dataset.seasonSubPane===target));
      }));
    });

    // Finals controls use delegated events so they remain clickable even after
    // the Season Management panels are regrouped/re-rendered. This also keeps
    // the controls resilient to later admin-panel additions.
    if(contentEl.__finalsControlsHandler) contentEl.removeEventListener('click', contentEl.__finalsControlsHandler);
    if(contentEl.__finalsChangeHandler) contentEl.removeEventListener('change', contentEl.__finalsChangeHandler);
    contentEl.__finalsControlsHandler = async (event)=>{
      const generateBtn = event.target.closest?.('#generateFinalsBtn');
      if(generateBtn){
        event.preventDefault();
        if(generateBtn.disabled) return;
        const start=SBL.finals.mondayISO(document.getElementById('finalsStartMonday')?.value || new Date());
        if(STATE.settings.finals?.status!=='inactive' && !confirm('Regenerate Finals? This replaces the current bracket and clears all finals results.')) return;
        const seedSelects=[...contentEl.querySelectorAll('.finals-seed-select')];
        const seeds=seedSelects.map((el,i)=>({seed:i+1,team:el.value}));
        try{ SBL.finals.validateSeeds(seeds); }catch(err){ alert(err.message); return; }
        generateBtn.disabled=true;
        try{
          STATE.settings.finals=SBL.finals.generate(start,seeds);
          await saveSettings();
          await logAdminAction('generate_finals',`Generated Finals beginning ${start}.`,{startMonday:start,seeds});
          renderSeasonSetup();
        }catch(err){
          alert('Could not generate Finals: '+err.message);
          generateBtn.disabled=false;
        }
        return;
      }
      const clearBtn = event.target.closest?.('#clearFinalsBtn');
      if(clearBtn){
        event.preventDefault();
        if(!confirm('Clear Finals Mode and all current finals results?')) return;
        clearBtn.disabled=true;
        try{
          STATE.settings.finals=SBL.finals.defaultFinalsState();
          await saveSettings();
          await logAdminAction('clear_finals','Cleared Finals Mode.',{});
          renderSeasonSetup();
        }catch(err){
          alert('Could not clear Finals: '+err.message);
          clearBtn.disabled=false;
        }
      }
    };
    contentEl.__finalsChangeHandler = null;

    const saveResultsBtn = contentEl.querySelector('#saveFinalsResultsBtn');
    if(saveResultsBtn){
      saveResultsBtn.addEventListener('click', async ()=>{
        if(saveResultsBtn.disabled) return;
        const status=document.getElementById('finalsResultsStatus');
        const selects=[...contentEl.querySelectorAll('.finals-winner-select')];
        const current=SBL.finals.resolveMatchups(STATE.settings.finals||SBL.finals.defaultFinalsState());
        const changes=[];
        for(const row of contentEl.querySelectorAll('.finals-admin-match-row')){
          const roundKey=row.querySelector('[data-finals-round]')?.dataset.finalsRound;
          const matchId=row.dataset.finalsAdminMatch;
          const match=current.rounds.find(r=>r.key===roundKey)?.matches.find(m=>m.id===matchId);
          if(!match) continue;
          const select=row.querySelector('.finals-winner-select');
          const scoreA=row.querySelector('.finals-score-input-a')?.value;
          const scoreB=row.querySelector('.finals-score-input-b')?.value;
          if(select?.value || scoreA!==undefined || scoreB!==undefined){
            const changedWinner=select?.value && select.value!==String(match.winner||'');
            const changedScore=(scoreA!==undefined && String(scoreA)!==String(match.scoreA??'')) || (scoreB!==undefined && String(scoreB)!==String(match.scoreB??''));
            if(changedWinner||changedScore) changes.push({roundKey,matchId,winner:select?.value||null,scoreA,scoreB});
          }
        }
        if(!changes.length){ if(status) status.textContent='No new results to save.'; return; }
        saveResultsBtn.disabled=true; if(status) status.textContent=`Saving ${changes.length} result${changes.length===1?'':'s'}…`;
        try{
          const roundOrder={playin:0,quarterfinals:1,semifinals:2,grandfinal:3};
          changes.sort((a,b)=>(roundOrder[a.roundKey]??99)-(roundOrder[b.roundKey]??99));
          for(const change of changes){
            const payload={};
            if(change.scoreA!==undefined && change.scoreA!=='' || change.scoreB!==undefined && change.scoreB!==''){ payload.scoreA=change.scoreA; payload.scoreB=change.scoreB; }
            else if(change.winner) payload.winner=change.winner;
            STATE.settings.finals=SBL.finals.setResult(STATE.settings.finals,change.roundKey,change.matchId,payload);
            await logAdminAction('set_finals_result',`Set Finals result for ${change.matchId}.`,{round:change.roundKey,match:change.matchId,winner:STATE.settings.finals.rounds.find(r=>r.key===change.roundKey)?.matches.find(m=>m.id===change.matchId)?.winner||null,scoreA:change.scoreA??null,scoreB:change.scoreB??null});
          }
          await saveSettings(); renderSeasonSetup();
        }catch(err){ if(status) status.textContent='Could not save Finals result: '+err.message; saveResultsBtn.disabled=false; }
      });
    }

    // Matchup click opens the same score editor used by the public Finals display.
    contentEl.querySelectorAll('[data-open-finals-score]').forEach(btn=>btn.addEventListener('click',()=>openAdminFinalsScore(btn.dataset.openFinalsScore,btn.dataset.openFinalsMatch)));

    contentEl.addEventListener('click', contentEl.__finalsControlsHandler);

    const rosterFile = document.getElementById('rosterFile');
    const loadRosterFileBtn = document.getElementById('loadRosterFileBtn');
    const publishRostersBtn = document.getElementById('publishRostersBtn');
    const clearRostersFromManagementBtn = document.getElementById('clearRostersFromManagementBtn');

    function drawRosterPreview(rosters, title){
      const normalized = normalizeStoredRosters(rosters);
      const teams = Object.entries(normalized).sort((a,b)=>a[0].localeCompare(b[0]));
      if(!teams.length){
        rosterPreview.innerHTML = '<div class="empty-state">No rosters found in that file.</div>';
        return;
      }
      const totalMons = teams.reduce((sum,[,list])=>sum + list.length, 0);
      rosterPreview.innerHTML = `
        <div class="note" style="margin-bottom:10px;">
          <strong>${SBL.pokemon.escapeHtml(title || 'Roster preview')}</strong> ·
          ${teams.length} franchise${teams.length===1?'':'s'} · ${totalMons} Pokémon
        </div>
        <div class="roster-admin-grid">
          ${teams.map(([team,list])=>`
            <div class="roster-admin-card">
              <h3>${SBL.pokemon.escapeHtml(team)} <span class="badge">${list.length}</span></h3>
              <div class="roster-admin-mons">
                ${list.map(mon=>rosterDisplay(mon)).join('<br>')}
              </div>
            </div>`).join('')}
        </div>`;
    }

    drawRosterPreview(STATE.settings.rosters || {}, 'Currently published rosters');

    clearRostersFromManagementBtn?.addEventListener('click', async ()=>{
      const btn = clearRostersFromManagementBtn;
      const status = document.getElementById('rosterUploadStatus');
      btn.disabled = true;
      try{
        const result = await clearCurrentRosters();
        if(result){
          pendingRosterUpload = null;
          if(rosterFile) rosterFile.value = '';
          if(publishRostersBtn) publishRostersBtn.disabled = true;
          drawRosterPreview({}, 'Currently published rosters');
          const extras = [result.freeAgencyCleared ? 'Free Agency pool cleared' : 'Free Agency preserved', result.draftReset ? 'draft reset' : 'draft status preserved'];
          if(status) status.innerHTML = `<div class="note">Current-season rosters cleared and saved. ${extras.join('; ')}. Archived seasons and franchise assignments were preserved.</div>`;
          renderTicker();
        }
      }catch(err){
        if(status) status.innerHTML = `<div class="note danger">Could not clear rosters: ${SBL.pokemon.escapeHtml(err?.message || err)}</div>`;
      }finally{
        btn.disabled = false;
      }
    });

    loadRosterFileBtn.addEventListener('click', async ()=>{
      const file = rosterFile.files?.[0];
      if(!file){
        rosterStatus.innerHTML = '<div class="note danger">Choose a roster file first.</div>';
        return;
      }
      loadRosterFileBtn.disabled = true;
      publishRostersBtn.disabled = true;
      rosterStatus.innerHTML = '<div class="note">Reading roster workbook…</div>';
      try{
        const wb = XLSX.read(await file.arrayBuffer(), {type:'array'});
        const parsed = parseRosterWorkbook(wb);
        if(!Object.keys(parsed).length) throw new Error('No valid rosters were found in that file.');
        pendingRosterUpload = normalizeStoredRosters(parsed);
        drawRosterPreview(pendingRosterUpload, `Preview: ${file.name}`);
        rosterStatus.innerHTML = `<div class="note">Loaded ${Object.keys(pendingRosterUpload).length} franchise${Object.keys(pendingRosterUpload).length===1?'':'s'} from <strong>${SBL.pokemon.escapeHtml(file.name)}</strong>. Review the preview, then publish when ready.</div>`;
        publishRostersBtn.disabled = false;
      }catch(err){
        pendingRosterUpload = null;
        rosterPreview.innerHTML = '';
        rosterStatus.innerHTML = `<div class="note danger">Could not read that roster file: ${SBL.pokemon.escapeHtml(err.message)}</div>`;
      }finally{
        loadRosterFileBtn.disabled = false;
      }
    });

    publishRostersBtn.addEventListener('click', async ()=>{
      if(!pendingRosterUpload || !Object.keys(pendingRosterUpload).length) return;
      const teams = Object.keys(pendingRosterUpload);
      const monCount = Object.values(pendingRosterUpload).reduce((sum,list)=>sum+list.length,0);
      if(!confirm(`Replace the current published rosters with ${teams.length} franchise${teams.length===1?'':'s'} and ${monCount} Pokémon?`)) return;
      publishRostersBtn.disabled = true;
      loadRosterFileBtn.disabled = true;
      rosterStatus.innerHTML = '<div class="note">Publishing rosters…</div>';
      try{
        await publishRosters(pendingRosterUpload);
        rosterStatus.innerHTML = `<div class="note">Published ${teams.length} franchise${teams.length===1?'':'s'} and ${monCount} Pokémon. ✓</div>`;
        pendingRosterUpload = null;
        rosterFile.value = '';
        drawRosterPreview(STATE.settings.rosters || {}, 'Currently published rosters');
      }catch(err){
        rosterStatus.innerHTML = `<div class="note danger">Could not publish rosters: ${SBL.pokemon.escapeHtml(err.message)}</div>`;
      }finally{
        loadRosterFileBtn.disabled = false;
        publishRostersBtn.disabled = true;
      }
    });

    const manualDiffRows = document.getElementById('manualDifferentialRows');
    if(manualDiffRows){
      manualDiffRows.innerHTML = franchises.length ? franchises.map(f=>{
        const key = f.name;
        const stored = Object.prototype.hasOwnProperty.call(manualDiffs,key) ? manualDiffs[key] : '';
        const val = (stored && typeof stored === 'object' && Object.prototype.hasOwnProperty.call(stored,'value')) ? stored.value : stored;
        return `<div class="manual-diff-row">
          <div class="manual-diff-name" title="${SBL.pokemon.escapeHtml(f.name)}">${SBL.pokemon.escapeHtml(f.name)}</div>
          <input class="manual-diff-input" data-franchise="${SBL.pokemon.escapeHtml(f.name)}" type="text" inputmode="numeric" autocomplete="off" value="${val === '' ? '' : SBL.pokemon.escapeHtml(String(val))}" placeholder="Auto" aria-label="Manual differential for ${SBL.pokemon.escapeHtml(f.name)}">
        </div>`;
      }).join('') : '<div class="empty-state">No franchises found yet.</div>';
    }
    document.getElementById('saveManualDifferentials')?.addEventListener('click', async ()=>{
      const next = {};
      const rounds = Array.isArray(STATE.settings?.fixture?.rounds) ? STATE.settings.fixture.rounds : [];
      // Store the correction as a baseline at the latest played fixture round.
      // Future played rounds are added on top of this baseline by the Season page.
      let throughRoundIndex = -1;
      rounds.forEach((round, idx)=>{
        const played = (round.matches || []).some(match=>{
          const res = typeof findFixtureResult === 'function' ? findFixtureResult(round.week, match.home, match.away) : null;
          return !!(res && res.played && res.winner && res.winnerScore != null && res.loserScore != null);
        });
        if(played) throughRoundIndex = idx;
      });
      const throughWeek = throughRoundIndex >= 0 ? (rounds[throughRoundIndex]?.week || null) : null;
      document.querySelectorAll('.manual-diff-input').forEach(input=>{
        const name = input.dataset.franchise || '';
        const raw = input.value.trim();
        if(name && raw !== '' && Number.isFinite(Number(raw))) next[name] = {value:Number(raw), throughRoundIndex, throughWeek};
      });
      STATE.settings.ladderDifferentials = next;
      await saveSettings();
      await logAdminAction('set_ladder_differentials', 'Updated manual ladder differential overrides.', {overrides: next});
      const status = document.getElementById('manualDifferentialStatus');
      if(status) status.innerHTML = `<div class="note">Saved ${Object.keys(next).length} manual differential override${Object.keys(next).length===1?'':'s'}. ✓</div>`;
    });
    document.getElementById('clearManualDifferentials')?.addEventListener('click', async ()=>{
      if(!confirm('Clear all manual ladder differential overrides?')) return;
      STATE.settings.ladderDifferentials = {};
      await saveSettings();
      await logAdminAction('clear_ladder_differentials', 'Cleared manual ladder differential overrides.', {});
      renderSeasonSetup();
    });

    const fixtureSummaryEl = document.getElementById('fixtureSummary');
    function fixtureSummaryRows(fixtureData){
      const fixture = fixtureData ?? STATE.settings?.fixture ?? window.currentFixture ?? [];
      if(Array.isArray(fixture?.rounds)){
        return fixture.rounds.flatMap((round,index)=>(Array.isArray(round?.matches)?round.matches:[]).map(match=>({
          week:String(round?.week || `Week ${index+1}`).trim(),
          home:String(match?.home ?? match?.Home ?? '').trim(),
          away:String(match?.away ?? match?.Away ?? '').trim()
        })));
      }
      if(Array.isArray(fixture)) return fixture.map((match,index)=>({
        week:String(match?.week ?? match?.Week ?? `Week ${index+1}`).trim(),
        home:String(match?.home ?? match?.Home ?? '').trim(),
        away:String(match?.away ?? match?.Away ?? '').trim()
      }));
      return [];
    }
    function drawFixtureSummary(){
      const host=document.getElementById('fixtureSummary');
      if(!host) return;
      const published=STATE.settings?.fixture||null;
      const draft=STATE.settings?.fixtureDraft||null;
      const count=fixture=>SBL.fixtureWorkflow?.summarize?.(fixture)||({weeks:Array.isArray(fixture?.rounds)?fixture.rounds.length:0,matches:fixtureMatchCount(fixture)});
      const renderWeeks=fixture=>{
        const rows=fixtureSummaryRows(fixture).filter(match=>match.home&&match.away);
        const byWeek=new Map();
        rows.forEach(match=>{if(!byWeek.has(match.week))byWeek.set(match.week,[]);byWeek.get(match.week).push(match);});
        return [...byWeek.keys()].sort((a,b)=>weekSort(a,b)).map(week=>`
          <section class="fixture-week" data-week="${SBL.pokemon.escapeHtml(week)}"><h4>${SBL.pokemon.escapeHtml(week)}</h4>
            <div class="fixture-week-matches">${byWeek.get(week).map(match=>`<div class="fixture-match"><span class="fixture-team fixture-home">${SBL.pokemon.escapeHtml(match.home)}</span><span class="fixture-vs">VS</span><span class="fixture-team fixture-away">${SBL.pokemon.escapeHtml(match.away)}</span></div>`).join('')}</div>
          </section>`).join('');
      };
      const pub=count(published), dr=count(draft);
      const stateLine= draft
        ? `<div class="note" role="status"><strong>Draft not published.</strong> ${dr.weeks} weeks / ${dr.matches} matches. ${published?`Published fixture remains live: ${pub.weeks} weeks / ${pub.matches} matches.`:'No published fixture exists yet.'}</div>`
        : published
          ? `<div class="note" role="status"><strong>Published.</strong> ${pub.weeks} weeks / ${pub.matches} matches.</div>`
          : '<div class="note" role="status">Nothing generated yet. Generate or upload a draft, review it, then publish.</div>';
      host.innerHTML=stateLine+
        (published?`<div class="note" style="margin-top:8px;">Published fixture: ${pub.weeks} weeks / ${pub.matches} matches.</div>`:'')+
        (draft?`<h3 style="margin:12px 0 6px;">Draft preview</h3>${renderWeeks(draft)}`:
          published?`<h3 style="margin:12px 0 6px;">Published fixture preview</h3>${renderWeeks(published)}`:'');
      const publish=document.getElementById('publishFixtureBtn');
      const discard=document.getElementById('discardFixtureDraftBtn');
      if(publish) publish.disabled=!draft || !dr.matches;
      if(discard) discard.disabled=!draft;
    }
    async function refreshFixtureTargetStatus(){
      const host=document.getElementById('fixtureTargetStatus'); if(!host) return;
      const leagueId=String(SBL.leagueDb?.selectedLeagueId?.()||'').trim();
      const seasonId=String(SBL.leagueDb?.selectedSeasonId?.(leagueId)||'').trim();
      if(!leagueId||!seasonId){host.innerHTML='<span class="note danger">No selected league/season. Fixture changes cannot be saved.</span>';return;}
      try{
        const [league,selected,seasons]=await Promise.all([
          SBL.leagueDb.getLeague(leagueId,supabase),
          SBL.leagueDb.getSeasonContext(leagueId,supabase,{seasonId}),
          SBL.leagueDb.listSeasons(leagueId,supabase)
        ]);
        const active=(seasons||[]).find(x=>x.status==='active');
        const targetName=selected?.name||STATE.settings.activeSeason||seasonId;
        const leagueName=league?.name||STATE.settings.leagues?.[leagueId]?.name||leagueId;
        host.innerHTML=`<strong>Publishing to:</strong> ${SBL.pokemon.escapeHtml(leagueName)} / ${SBL.pokemon.escapeHtml(targetName)}<div class="note">league_id: <code>${SBL.pokemon.escapeHtml(leagueId)}</code><br>season_id: <code>${SBL.pokemon.escapeHtml(seasonId)}</code></div>${selected?.status!=='active'?`<div class="note danger" style="margin-top:5px;">Warning: this selected season is not the active season (${SBL.pokemon.escapeHtml(active?.name||'no active season')}). Publishing here will not update visitors viewing the active season.</div>`:''}`;
      }catch(err){host.innerHTML=`<span class="note danger">Could not verify fixture destination: ${SBL.pokemon.escapeHtml(err?.message||err)}</span>`;}
    }
    function fixtureMatchCount(fixtureData){return fixtureSummaryRows(fixtureData).filter(match=>match.home&&match.away).length;}
    window.drawFixtureSummary = drawFixtureSummary;
    drawFixtureSummary();
    refreshFixtureTargetStatus();

    document.getElementById('generateFixtureBtn')?.addEventListener('click', async ()=>{
      const franchiseList=activeMemberConfiguredFranchises();
      const teamNames=franchiseList.map(f=>f.name);
      if(teamNames.length<2){alert('Add at least 2 franchises to the Player → Team name mapping before generating a fixture.');return;}
      const conferenceMap={}; franchiseList.forEach(f=>{conferenceMap[f.name]=f.conference;});
      const unassigned=franchiseList.filter(f=>f.conference!=='a'&&f.conference!=='b');
      if(unassigned.length){alert('Every franchise must be assigned to Conference A or Conference B before generating a fixture.');return;}
      const weeksInput=parseInt(document.getElementById('fixtureWeeks').value,10);
      if(!weeksInput||weeksInput<1){alert('Enter how many weeks the season should run.');return;}
      if(STATE.settings.fixtureDraft&&!confirm('Replace the existing unpublished fixture draft?'))return;
      const interGames=Math.max(0,Math.min(10,parseInt(document.getElementById('fixtureInterGames').value,10)||0));
      const maxGames=Math.max(1,Math.min(2,parseInt(document.getElementById('fixtureMaxGames').value,10)||1));
      if(interGames>Math.min(10,Math.floor(teamNames.length/2))){alert('Inter-conference games per week cannot exceed half the league size.');return;}
      const btn=document.getElementById('generateFixtureBtn'); btn.disabled=true;
      try{
        const rules={interConferencePerWeek:interGames,maxGamesPerTeamPerWeek:maxGames};
        const rounds=generateFixture(teamNames,weeksInput,conferenceMap,rules);
        await saveFixture({rounds},'generated','fixtureDraft',{fixtureRules:rules});
        await logAdminAction('generate_fixture_draft',`Generated a ${rounds.length}-week fixture draft for ${teamNames.length} franchises.`,{teams:teamNames.length,weeks:rounds.length,interConferencePerWeek:interGames,maxGamesPerTeamPerWeek:maxGames});
        renderSeasonSetup();
        alert(`Fixture draft generated: ${rounds.length} weeks / ${fixtureMatchCount({rounds})} matches. It is not published yet.`);
      }catch(err){alert('Could not save fixture draft: '+(err?.message||err));btn.disabled=false;}
    });

    document.getElementById('publishFixtureBtn')?.addEventListener('click',async()=>{
      const draft=STATE.settings.fixtureDraft;
      if(!draft?.rounds?.length){alert('Generate or upload a fixture draft first.');return;}
      const matches=fixtureMatchCount(draft),weeks=draft.rounds.length;
      if(STATE.settings.fixture&&!confirm(`Replace the existing published fixture with this draft (${weeks} weeks / ${matches} matches)?`))return;
      const btn=document.getElementById('publishFixtureBtn');btn.disabled=true;
      try{
        await saveFixture(draft,draft.source||'generated','fixture',{fixtureDraft:null});
        await logAdminAction('publish_fixture',`Published fixture: ${weeks} weeks / ${matches} matches.`,{weeks,matches,source:draft.source||'generated'});
        renderSeasonSetup();
        alert(`Fixture published and verified in the database: ${weeks} weeks / ${matches} matches.`);
      }catch(err){alert('Could not publish fixture: '+(err?.message||err));btn.disabled=false;}
    });

    document.getElementById('discardFixtureDraftBtn')?.addEventListener('click',async()=>{
      if(!STATE.settings.fixtureDraft)return;
      if(!confirm('Discard the unpublished fixture draft? The published fixture will remain unchanged.'))return;
      const btn=document.getElementById('discardFixtureDraftBtn');btn.disabled=true;
      try{await saveFixture(null,null,'fixtureDraft');renderSeasonSetup();}
      catch(err){alert('Could not discard fixture draft: '+(err?.message||err));btn.disabled=false;}
    });

    document.getElementById('matchReplaysBtn')?.addEventListener('click', async ()=>{
      const status = document.getElementById('matchReplaysStatus');
      const fixture = STATE.settings.fixture;
      const rounds = Array.isArray(fixture?.rounds) ? fixture.rounds : [];
      if(!rounds.length){ status.innerHTML = '<div class="note danger">Generate or upload a fixture first.</div>'; return; }
      if(!confirm('This sets the week on every matching replay to whatever the fixture says, overwriting any week currently on it (manual or auto). Continue?')) return;
      const btn = document.getElementById('matchReplaysBtn');
      btn.disabled = true;
      try{
        // Heal the already-saved fixture's team names against the current
        // Player -> Team mapping before matching, so a stored fixture from
        // before this reconciliation existed (or one with a stray typo) gets
        // fixed in place rather than requiring a fresh re-upload. Persist any
        // corrections back to the saved fixture so the Season page's schedule
        // and results — which read the same STATE.settings.fixture — benefit
        // from the fix immediately too.
        const knownNames = activeMemberConfiguredFranchises().map(f => f.name);
        const fixtureCorrections = [];
        let fixtureNamesFixed = false;
        rounds.forEach(r=>{
          (r.matches||[]).forEach(m=>{
            const home = reconcileFranchiseName(m.home, knownNames);
            const away = reconcileFranchiseName(m.away, knownNames);
            if(home !== m.home){ fixtureCorrections.push({from:m.home, to:home}); m.home = home; fixtureNamesFixed = true; }
            if(away !== m.away){ fixtureCorrections.push({from:m.away, to:away}); m.away = away; fixtureNamesFixed = true; }
          });
        });
        if(fixtureNamesFixed) await saveFixture({rounds}, fixture.source);

        // Every scheduled meeting between a given pair of franchises, in the
        // order the fixture plays them (so a return leg lines up as the 2nd
        // meeting, not the 1st).
        const fixtureMeetingsByPair = {};
        rounds.forEach(r=>{
          (r.matches||[]).forEach(m=>{
            const pairKey = [groupKey(m.home), groupKey(m.away)].sort().join('|');
            if(!fixtureMeetingsByPair[pairKey]) fixtureMeetingsByPair[pairKey] = [];
            fixtureMeetingsByPair[pairKey].push(r.week);
          });
        });
        // Every actual replay between that same pair, in the order they were played.
        const replaysByPair = {};
        for(const r of Object.values(STATE.replays)){
          if(!r?.players) continue;
          const t1 = teamFor(r.players.p1), t2 = teamFor(r.players.p2);
          const pairKey = [groupKey(t1), groupKey(t2)].sort().join('|');
          if(!replaysByPair[pairKey]) replaysByPair[pairKey] = [];
          replaysByPair[pairKey].push(r);
        }
        Object.values(replaysByPair).forEach(list => list.sort((a,b)=>(a.uploadtime||0)-(b.uploadtime||0) || (a.processedAt||0)-(b.processedAt||0)));

        let changed = 0, alreadyRight = 0, unmatched = 0;
        for(const pairKey in replaysByPair){
          const weeks = fixtureMeetingsByPair[pairKey] || [];
          replaysByPair[pairKey].forEach((replay, i)=>{
            const week = weeks[i];
            if(!week){ unmatched++; return; }
            if(replay.week === week && replay.weekOverride){ alreadyRight++; return; }
            replay.week = week;
            replay.weekOverride = true;
            changed++;
          });
        }

        // Diagnostic for the unmatched case: rather than just saying "check the
        // names line up," work out exactly which franchise-name strings appear
        // on one side (fixture Home/Away vs. replays-via-Player→Team mapping)
        // but not the other, so a spelling/whitespace/case mismatch is visible
        // at a glance instead of requiring a manual side-by-side hunt.
        let mismatchNote = '';
        if(unmatched){
          const fixtureTeamNames = new Map(); // normalized key -> original spelling
          rounds.forEach(r=>{
            (r.matches||[]).forEach(m=>{
              [m.home, m.away].forEach(name=>{
                const key = groupKey(name);
                if(!fixtureTeamNames.has(key)) fixtureTeamNames.set(key, name);
              });
            });
          });
          const replayTeamNames = new Map();
          for(const r of Object.values(STATE.replays)){
            if(!r?.players) continue;
            [teamFor(r.players.p1), teamFor(r.players.p2)].forEach(name=>{
              const key = groupKey(name);
              if(!replayTeamNames.has(key)) replayTeamNames.set(key, name);
            });
          }
          const onlyInReplays = [...replayTeamNames.keys()].filter(k=>!fixtureTeamNames.has(k)).map(k=>replayTeamNames.get(k));
          const onlyInFixture = [...fixtureTeamNames.keys()].filter(k=>!replayTeamNames.has(k)).map(k=>fixtureTeamNames.get(k));
          const preview = (list) => list.slice(0,6).map(n=>`"${SBL.pokemon.escapeHtml(n)}"`).join(', ') + (list.length>6?`, +${list.length-6} more`:'');
          if(onlyInReplays.length || onlyInFixture.length){
            mismatchNote = `<div class="note danger" style="margin-top:6px;">Name mismatch — these don't line up character-for-character (case/spacing counts unless "case-insensitive names" is on in Settings):
              ${onlyInReplays.length ? `<div style="margin-top:4px;">In replays (via Player → Team mapping) but not in the fixture: ${preview(onlyInReplays)}</div>` : ''}
              ${onlyInFixture.length ? `<div style="margin-top:4px;">In the fixture but not in any replay's mapped team: ${preview(onlyInFixture)}</div>` : ''}
            </div>`;
          }
        }

        if(changed) await saveReplays();
        await logAdminAction('match_replays_to_fixture', `Matched replay weeks to the saved fixture: ${changed} updated, ${alreadyRight} already correct, ${unmatched} replay(s) had no corresponding fixture match.${fixtureNamesFixed ? ` Auto-corrected ${fixtureCorrections.length} fixture team name(s) to match the Player → Team mapping.` : ''}`, {changed, alreadyRight, unmatched, fixtureNamesFixed: fixtureCorrections.length});
        renderTicker();
        render();
        // render() just rebuilt the whole settings panel (including this status
        // box) from scratch, so the old `status` node is gone — re-query it
        // after the rebuild instead of writing into the stale reference.
        const freshStatus = document.getElementById('matchReplaysStatus');
        const correctionNote = fixtureNamesFixed
          ? `<div class="note" style="margin-top:6px;">Auto-corrected ${fixtureCorrections.length} fixture name${fixtureCorrections.length===1?'':'s'} to match the established franchise spelling:<br>${fixtureCorrections.map(c=>`"${SBL.pokemon.escapeHtml(c.from)}" → "${SBL.pokemon.escapeHtml(c.to)}"`).join('<br>')}</div>`
          : '';
        if(freshStatus) freshStatus.innerHTML = `<div class="note${unmatched?' danger':''}">${changed} replay${changed===1?'':'s'} updated${alreadyRight?`, ${alreadyRight} already correct`:''}.${unmatched?` ${unmatched} replay${unmatched===1?'':'s'} didn't match any scheduled fixture matchup — check the two franchises' names line up with the Player → Team name mapping.` : ' ✓'}</div>${correctionNote}${mismatchNote}`;
      }catch(err){
        status.innerHTML = `<div class="note danger">Could not match replays: ${SBL.pokemon.escapeHtml(err.message)}</div>`;
      }finally{
        btn.disabled = false;
      }
    });

    document.getElementById('clearFixtureBtn')?.addEventListener('click', async ()=>{
      if(!STATE.settings.fixture) return;
      if(!confirm('Clear the saved fixture? This cannot be undone.')) return;
      await saveFixture(null, null);
      await logAdminAction('clear_fixture', 'Cleared the saved fixture.', {});
      renderSeasonSetup();
    });

    document.getElementById('renameSeasonBtn')?.addEventListener('click', async ()=>{
      const button=document.getElementById('renameSeasonBtn');
      const name=String(document.getElementById('renameSeasonInput')?.value||'').trim();
      if(!name){alert('Enter a season name.');return;}
      button.disabled=true;
      try{
        const leagueId=SBL.leagueDb?.selectedLeagueId?.()||'';
        const seasonId=SBL.leagueDb?.selectedSeasonId?.(leagueId)||'';
        if(!leagueId||!seasonId) throw new Error('The current league and season could not be resolved.');
        const renamed=await SBL.leagueDb.renameSeason(leagueId,seasonId,name,supabase);
        STATE.settings.activeSeason=renamed.name;
        await logAdminAction('rename_season',`Renamed the current season to "${renamed.name}".`,{leagueId,seasonId,seasonKey:renamed.season_key,name:renamed.name});
        renderTicker();render();
      }catch(e){alert('Could not rename season: '+(e?.message||e));button.disabled=false;}
    });

    document.getElementById('newSeasonBtn')?.addEventListener('click', async ()=>{
      const btn = document.getElementById('newSeasonBtn');
      btn.disabled = true;
      try{
        await startNewSeason();
        renderTicker();
        render();
      }catch(err){
        alert('Could not start a new season: ' + err.message);
        btn.disabled = false;
      }
    });
    document.getElementById('clearRostersBtn')?.addEventListener('click', async ()=>{
      const btn=document.getElementById('clearRostersBtn'); btn.disabled=true;
      try{ if(await clearCurrentRosters()){ renderTicker(); render(); } }
      catch(err){ alert('Could not clear rosters: ' + err.message); btn.disabled=false; }
    });
    document.querySelectorAll('[data-restore-season]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        btn.disabled = true;
        try{
          await restoreSeasonArchive(btn.dataset.restoreSeason);
          renderTicker();
          render();
        }catch(err){
          alert('Could not restore that season: ' + err.message);
          btn.disabled = false;
        }
      });
    });
    document.querySelectorAll('[data-delete-season]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        btn.disabled = true;
        try{
          await deleteSeasonArchive(btn.dataset.deleteSeason);
          render();
        }catch(err){
          alert('Could not delete that archive: ' + err.message);
          btn.disabled = false;
        }
      });
    });

    document.getElementById('saveConferenceNames')?.addEventListener('click', async ()=>{
      const a = document.getElementById('conferenceNameA').value.trim() || 'Conference A';
      const b = document.getElementById('conferenceNameB').value.trim() || 'Conference B';
      STATE.settings.conferenceNames = {a,b};
      const current = STATE.settings.franchises && typeof STATE.settings.franchises === 'object' ? STATE.settings.franchises : {};
      STATE.settings.franchises = current;
      await saveSettings();
      await logAdminAction('set_conference_names', `Set conference names to "${a}" and "${b}".`, {conferenceA:a, conferenceB:b});
      renderSeasonSetup();
    });

    document.querySelectorAll('.franchise-conference-select').forEach(select=>{
      select.addEventListener('change', async ()=>{
        const map = STATE.settings.franchises && typeof STATE.settings.franchises === 'object' ? {...STATE.settings.franchises} : {};
        const franchise = select.dataset.franchise;
        const franchiseId = select.dataset.franchiseId;
        if(select.value) map[franchise] = select.value;
        else delete map[franchise];
        try{
          if(!franchiseId) throw new Error('This franchise is not linked to an active franchise record. Refresh the page and try again.');
          await SBL.leagueDb.updateFranchiseDefinition(SBL.leagueDb.selectedLeagueId(),franchiseId,franchise,select.value,supabase);
          await saveFranchiseConferences(map);
          const row=ACTIVE_MEMBER_FRANCHISES.find(f=>String(f.franchiseId)===String(franchiseId)); if(row) row.conference=select.value;
          const registryRow=ACTIVE_LEAGUE_FRANCHISES.find(f=>String(f.franchiseId)===String(franchiseId)); if(registryRow) registryRow.conference=select.value;
          await logAdminAction('set_franchise_conference', `Set ${franchise} to ${select.value ? (select.value==='a' ? conferenceA : conferenceB) : 'Unassigned'}.`, {franchise, franchiseId, conference:select.value || null});
        }catch(err){
          alert('Could not save conference assignment: ' + err.message);
          renderSeasonSetup();
        }
      });
    });

    document.getElementById('qualificationToggle')?.addEventListener('change', async (e)=>{
      STATE.settings.qualificationEnabled = e.target.checked;
      await saveSettings();
      await logAdminAction('set_qualification_enabled', `Qualification tab ${e.target.checked ? 'enabled' : 'disabled'} on the Season page.`, {enabled:e.target.checked});
    });

  }

  // ---------- League Manager ----------
  function leagueRegistry(){
    STATE.settings.leagues = (STATE.settings.leagues && typeof STATE.settings.leagues === 'object') ? STATE.settings.leagues : {};
    return STATE.settings.leagues;
  }
  function leagueId(value){
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'league';
  }
  function snapshotLeagueState(){
    const settings = JSON.parse(JSON.stringify(STATE.settings || {}));
    delete settings.leagues;
    delete settings.activeLeagueId;
    return { teamMap:JSON.parse(JSON.stringify(STATE.teamMap||{})), settings, replays:JSON.parse(JSON.stringify(STATE.replays||{})) };
  }
  function ensureLeagueRegistry(){
    const leagues = leagueRegistry();
    if(!Object.keys(leagues).length){
      leagues.main = {id:'main', name:'SBL', description:'Primary league', createdAt:new Date().toISOString(), joinCode:makeLeagueJoinCode(), members:[], state:snapshotLeagueState()};
      STATE.settings.activeLeagueId='main';
    }
    Object.values(leagues).forEach(l=>{
      if(!l.joinCode) l.joinCode=makeLeagueJoinCode();
      if(!Array.isArray(l.members)) l.members=[];
      l.members=l.members.map(m=>typeof m==='string'?{userId:m,status:'active',role:'player',franchise:'',team:''}:{...m,status:m.status||'active',role:m.role||'player',franchise:m.franchise||m.team||'',team:m.team||m.franchise||''});
    });
    const active = STATE.settings.activeLeagueId || Object.keys(leagues)[0];
    STATE.settings.activeLeagueId = leagues[active] ? active : Object.keys(leagues)[0];
    const current = leagues[STATE.settings.activeLeagueId];
    if(current) current.name = current.name || 'SBL';
    return leagues;
  }

  function makeLeagueJoinCode(){
    const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code='';
    for(let i=0;i<8;i++) code+=chars[Math.floor(Math.random()*chars.length)];
    return code;
  }
  async function switchLeague(nextId){
    requireAdmin();
    const leagues = ensureLeagueRegistry();
    const target = leagues[nextId];
    if(!target) throw new Error('League not found.');
    const currentId = STATE.settings.activeLeagueId;
    if(nextId === currentId) return;
    if(!confirm(`Switch from "${leagues[currentId]?.name || currentId}" to "${target.name || nextId}"?\n\nThe current league will be saved as-is, and the selected league will become the live league for this site.`)) return;
    // Persist the currently selected league before changing the local selection.
    // The normalized Supabase adapter uses the browser selection to choose its
    // write target, so switching the selection too early would save the wrong league.
    if(SBL.leagueDb?.setSelectedLeagueId && currentId) SBL.leagueDb.setSelectedLeagueId(currentId);
    leagues[currentId] = {...leagues[currentId], state:snapshotLeagueState()};
    const restored = target.state || {teamMap:{},settings:{},replays:{}};
    STATE.teamMap = JSON.parse(JSON.stringify(restored.teamMap || {}));
    STATE.replays = JSON.parse(JSON.stringify(restored.replays || {}));
    STATE.settings = Object.assign(
      {caseInsensitiveNames:true, rosters:{}, franchises:{}, franchiseDefinitions:{}, conferenceNames:{a:'Conference A',b:'Conference B'}, draft:defaultDraftState(), seasonArchives:{}, leagueUpdates:[], finals:SBL.finals.defaultFinalsState()},
      JSON.parse(JSON.stringify(restored.settings || {}))
    );
    STATE.settings.leagues = leagues;
    STATE.settings.activeLeagueId = nextId;
    STATE.settings.draft = normalizeDraftState(STATE.settings.draft);
    STATE.settings.seasonArchives = STATE.settings.seasonArchives || {};
    STATE.settings.franchiseDefinitions = STATE.settings.franchiseDefinitions || {};
    if(SBL.leagueDb?.setSelectedLeagueId) SBL.leagueDb.setSelectedLeagueId(nextId);
    ACTIVE_MEMBER_FRANCHISES=[]; ACTIVE_LEAGUE_FRANCHISES=[]; ACTIVE_SEASON_SITOUT_USERS=new Set(); ACTIVE_MEMBER_FRANCHISES_LOADED=false;
    LOTTERY_WORK=null;
    await loadActiveMemberFranchiseList();
    await deleteAllRemote();
    await saveReplays();
    await savePublishedRosters(STATE.settings.rosters || {});
    await logAdminAction('switch_league', `Switched active league to "${target.name || nextId}".`, {from:currentId,to:nextId});
    renderTicker();
    render();
  }
  let leagueSetupStep = 1;
  let leagueSetupDraft = null;
  let focusManageFranchisesAfterCreate = false;

  function blankLeagueSetup(){
    return {
      name:'', description:'', season:'Season 1',
      conferenceA:'Conference A', conferenceB:'Conference B',
      franchises:[], interConferencePerWeek:1, maxGamesPerTeamPerWeek:1,
      weeks:'', qualification:false
    };
  }

  function setupFranchiseRows(){
    const rows = leagueSetupDraft?.franchises || [];
    if(!rows.length) return '<div class="empty-state">No franchises added yet. Add them below or paste a list.</div>';
    return rows.map((f,i)=>`<div class="league-setup-franchise-row">
      <span class="league-setup-franchise-number">${i+1}</span>
      <input type="text" value="${SBL.pokemon.escapeHtml(f.name)}" data-setup-franchise-name="${i}" aria-label="Franchise ${i+1} name">
      <select data-setup-franchise-conf="${i}" aria-label="Conference for ${SBL.pokemon.escapeHtml(f.name)}">
        <option value="a" ${f.conference==='a'?'selected':''}>${SBL.pokemon.escapeHtml(leagueSetupDraft.conferenceA)}</option>
        <option value="b" ${f.conference==='b'?'selected':''}>${SBL.pokemon.escapeHtml(leagueSetupDraft.conferenceB)}</option>
      </select>
      <button class="ghost small danger-btn" type="button" data-setup-remove-franchise="${i}">Remove</button>
    </div>`).join('');
  }

  function setupStepNav(){
    return `<div class="league-setup-steps" aria-label="League setup steps">
      ${[['1','Basics'],['2','Franchises'],['3','Competition'],['4','Review']].map(([n,label])=>`<div class="league-setup-step ${Number(n)===leagueSetupStep?'current':''} ${Number(n)<leagueSetupStep?'done':''}"><span>${n}</span><label>${label}</label></div>`).join('')}
    </div>`;
  }

  function leagueMembers(league){
    if(!Array.isArray(league.members)) league.members=[];
    // Removed memberships remain in Supabase as history, but they are no
    // longer part of the admin UI's current membership set. Keeping them out
    // here also makes removed users eligible to be added again later.
    return league.members.filter(m=>String(m?.status||'').trim().toLowerCase()!=='removed');
  }


  function memberFranchiseOptions(league, selected=''){
    const names=configuredFranchises().map(f=>f.name);
    return `<option value="">No franchise assigned</option>${names.map(n=>`<option value="${SBL.pokemon.escapeHtml(n)}" ${String(n)===String(selected)?'selected':''}>${SBL.pokemon.escapeHtml(n)}</option>`).join('')}`;
  }

  function renderLeagueManager(){
    const leagues=ensureLeagueRegistry();
    const activeId=STATE.settings.activeLeagueId;
    const active=leagues[activeId] || {};

    if(leagueSetupDraft){
      const d=leagueSetupDraft;
      let body='';
      if(leagueSetupStep===1) body=`
        <div class="league-setup-intro"><div class="admin-dashboard-kicker">New league</div><h2>Set up your league</h2><p>Give the league a name, choose its starting season, then we'll build the rest of the structure for you.</p></div>
        <div class="league-setup-form-grid">
          <div class="field-wide"><label for="setupLeagueName">League name</label><input id="setupLeagueName" value="${SBL.pokemon.escapeHtml(d.name)}" placeholder="e.g. SBL Academy"></div>
          <div class="field-wide"><label for="setupLeagueDescription">Description <span class="note">optional</span></label><input id="setupLeagueDescription" value="${SBL.pokemon.escapeHtml(d.description)}" placeholder="A short description of this league"></div>
          <div><label for="setupSeason">Starting season</label><input id="setupSeason" value="${SBL.pokemon.escapeHtml(d.season)}" placeholder="Season 1"></div>
          <div><label for="setupConfA">Conference 1</label><input id="setupConfA" value="${SBL.pokemon.escapeHtml(d.conferenceA)}"></div>
          <div><label for="setupConfB">Conference 2</label><input id="setupConfB" value="${SBL.pokemon.escapeHtml(d.conferenceB)}"></div>
        </div>`;
      if(leagueSetupStep===2) body=`
        <div class="league-setup-intro"><div class="admin-dashboard-kicker">Step 2 of 4</div><h2>Build the franchise list <span class="note">optional</span></h2><p>Add the teams that belong to this league now, or skip this step and add them later in Manage Franchises.</p></div>
        <div class="league-setup-import-row"><textarea id="setupFranchisePaste" rows="4" placeholder="Paste franchise names, one per line\nAurora\nBlaze\nComets\nDragons"></textarea><button class="ghost" type="button" id="setupPasteAdd">Add pasted franchises</button></div>
        <div class="league-setup-franchise-list">${setupFranchiseRows()}</div>
        <div class="league-setup-add-row"><input id="setupFranchiseName" placeholder="Franchise name"><select id="setupFranchiseConf"><option value="a">${SBL.pokemon.escapeHtml(d.conferenceA)}</option><option value="b">${SBL.pokemon.escapeHtml(d.conferenceB)}</option></select><button class="primary" type="button" id="setupAddFranchise">Add franchise</button></div>
        <div class="note league-setup-tip">You can change conferences later. The important thing here is simply getting the league's teams defined once, so replay assignment, rosters, trades, standings and Finals all use the same franchise list.</div>`;
      if(leagueSetupStep===3) body=`
        <div class="league-setup-intro"><div class="admin-dashboard-kicker">Step 3 of 4</div><h2>Choose the competition format</h2><p>These are sensible starting defaults. You can change the detailed season settings later.</p></div>
        <div class="league-setup-preset-row"><button class="ghost" type="button" data-setup-preset="standard12">12-team, 2-conference</button><button class="ghost" type="button" data-setup-preset="roundrobin">Simple round robin</button></div>
        <div class="league-setup-form-grid">
          <div><label for="setupWeeks">Regular-season weeks <span class="note">optional</span></label><input id="setupWeeks" inputmode="numeric" value="${SBL.pokemon.escapeHtml(d.weeks)}" placeholder="Auto-suggest"></div>
          <div><label for="setupInter">Cross-conference games / week</label><input id="setupInter" type="number" min="0" max="10" value="${d.interConferencePerWeek}"></div>
          <div><label for="setupMaxGames">Max games / team / week</label><input id="setupMaxGames" type="number" min="1" max="2" value="${d.maxGamesPerTeamPerWeek}"></div>
          <div class="league-setup-check"><label><input id="setupQualification" type="checkbox" ${d.qualification?'checked':''}> Show playoff qualification information</label></div>
        </div>
        <div class="note league-setup-tip">The league starts with an empty draft, free-agency pool, trades, replays and Finals. Once the league exists, Season Management is where you publish rosters and generate or upload the schedule.</div>`;
      if(leagueSetupStep===4){
        const a=d.franchises.filter(f=>f.conference==='a'), b=d.franchises.filter(f=>f.conference==='b');
        body=`<div class="league-setup-intro"><div class="admin-dashboard-kicker">Ready to create</div><h2>${SBL.pokemon.escapeHtml(d.name || 'Unnamed league')}</h2><p>Review the structure below. Creating the league will make it the active league for this installation.</p></div>
        <div class="league-setup-review-grid">
          <div><span>Starting season</span><strong>${SBL.pokemon.escapeHtml(d.season || 'Season 1')}</strong></div>
          <div><span>Franchises</span><strong>${d.franchises.length}</strong></div>
          <div><span>${SBL.pokemon.escapeHtml(d.conferenceA)}</span><strong>${a.length}</strong></div>
          <div><span>${SBL.pokemon.escapeHtml(d.conferenceB)}</span><strong>${b.length}</strong></div>
          <div><span>Cross-conference / week</span><strong>${d.interConferencePerWeek}</strong></div>
          <div><span>Games / team / week</span><strong>${d.maxGamesPerTeamPerWeek}</strong></div>
        </div>
        <div class="league-setup-review-list"><strong>Franchises</strong><div>${d.franchises.map(f=>`<span>${SBL.pokemon.escapeHtml(f.name)} <small>${f.conference==='a'?SBL.pokemon.escapeHtml(d.conferenceA):SBL.pokemon.escapeHtml(d.conferenceB)}</small></span>`).join('') || '<span>No franchises yet</span>'}</div></div>`;
      }
      contentEl.innerHTML=`<div class="admin-section league-manager league-setup"><div class="league-setup-shell">${setupStepNav()}${body}<div id="leagueSetupStatus" class="note"></div><div class="league-setup-actions"><button class="ghost" id="leagueSetupCancel">Cancel</button><div><button class="ghost" id="leagueSetupBack" ${leagueSetupStep===1?'disabled':''}>Back</button><button class="primary" id="leagueSetupNext">${leagueSetupStep===4?'Create league':'Continue'}</button></div></div></div></div>`;

      const status=document.getElementById('leagueSetupStatus');
      function syncStepFields(){
        if(leagueSetupStep===1){ d.name=document.getElementById('setupLeagueName').value.trim(); d.description=document.getElementById('setupLeagueDescription').value.trim(); d.season=document.getElementById('setupSeason').value.trim()||'Season 1'; d.conferenceA=document.getElementById('setupConfA').value.trim()||'Conference A'; d.conferenceB=document.getElementById('setupConfB').value.trim()||'Conference B'; }
        if(leagueSetupStep===2){ contentEl.querySelectorAll('[data-setup-franchise-name]').forEach(el=>{const i=Number(el.dataset.setupFranchiseName); if(d.franchises[i]) d.franchises[i].name=el.value.trim();}); contentEl.querySelectorAll('[data-setup-franchise-conf]').forEach(el=>{const i=Number(el.dataset.setupFranchiseConf); if(d.franchises[i]) d.franchises[i].conference=el.value;}); d.franchises=d.franchises.filter(f=>f.name); }
        if(leagueSetupStep===3){ d.weeks=document.getElementById('setupWeeks').value.trim(); d.interConferencePerWeek=Math.max(0,Math.min(10,Number(document.getElementById('setupInter').value)||0)); d.maxGamesPerTeamPerWeek=Math.max(1,Math.min(2,Number(document.getElementById('setupMaxGames').value)||1)); d.qualification=!!document.getElementById('setupQualification').checked; }
      }
      document.getElementById('leagueSetupCancel').onclick=()=>{leagueSetupDraft=null;leagueSetupStep=1;renderLeagueManager();};
      document.getElementById('leagueSetupBack').onclick=()=>{syncStepFields();leagueSetupStep=Math.max(1,leagueSetupStep-1);renderLeagueManager();};
      document.getElementById('leagueSetupNext').onclick=async()=>{
        syncStepFields();
        if(leagueSetupStep===1 && !d.name){status.textContent='Give the league a name first.';return;}
        if(leagueSetupStep===1 && d.conferenceA.toLowerCase()===d.conferenceB.toLowerCase()){status.textContent='Conference names must be different.';return;}
        if(leagueSetupStep<4){leagueSetupStep++;renderLeagueManager();return;}
        const id=leagueId(d.name);
        if(leagues[id]){status.textContent='A league with that name already exists.';return;}
        leagues[activeId]={...leagues[activeId],state:snapshotLeagueState()};
        const defs={}, confs={}; d.franchises.forEach(f=>{defs[f.name]={name:f.name,conference:f.conference};confs[f.name]=f.conference;});
        const newSettings={caseInsensitiveNames:true,rosters:{},franchises:confs,franchiseDefinitions:defs,conferenceNames:{a:d.conferenceA,b:d.conferenceB},draft:defaultDraftState(),seasonArchives:{},leagueUpdates:[],finals:SBL.finals.defaultFinalsState(),activeSeason:d.season||'Season 1',qualificationEnabled:d.qualification,fixtureRules:{interConferencePerWeek:d.interConferencePerWeek,maxGamesPerTeamPerWeek:d.maxGamesPerTeamPerWeek}};
        if(d.weeks) newSettings.fixtureRules.regularSeasonWeeks=Number(d.weeks)||undefined;
        leagues[id]={id,name:d.name,description:d.description,createdAt:new Date().toISOString(),joinCode:makeLeagueJoinCode(),members:[{userId:String(adminUser.id),email:adminUser.email||'',username:'',franchise:'',team:'',role:'commissioner',status:'active',addedAt:new Date().toISOString()}],state:{teamMap:{},settings:newSettings,replays:{}}};
        STATE.teamMap={}; STATE.replays={}; STATE.settings=Object.assign({},newSettings,{leagues,activeLeagueId:id});
        try{
          if(SBL.leagueDb?.isAvailable && await SBL.leagueDb.isAvailable(supabase)){
            // Create the league itself with zero franchises. Franchise definitions
            // are optional and are added afterward through the same authoritative
            // sbl_create_franchise RPC used by Manage Franchises.
            const created=await SBL.leagueDb.createLeague({name:d.name,description:d.description,joinCode:leagues[id].joinCode,createdBy:String(adminUser.id),state:{teamMap:{},settings:newSettings,replays:{}}},supabase);
            SBL.leagueDb.setSelectedLeagueId(created.id);
            STATE.settings.activeLeagueId=created.id;
            for(const franchise of d.franchises){
              await SBL.leagueDb.createFranchise(created.id,franchise.name,franchise.conference,franchise.metadata||{},supabase);
            }
            // Refresh the normalized registry so the admin page immediately sees
            // the UUID-backed league rather than the temporary legacy slug.
            const visible=await SBL.leagueDb.listAll(supabase);
            STATE.settings.leagues={};
            for(const l of visible){ const full=await SBL.leagueDb.getLeague(l.id,supabase); if(full) STATE.settings.leagues[l.id]=full; }
            await loadState();
          }else{
            await deleteAllRemote();await saveReplays();await savePublishedRosters({});
          }
          await logAdminAction('create_league',`Created and activated league "${d.name}".`,{leagueId:STATE.settings.activeLeagueId,name:d.name});
          leagueSetupDraft=null;leagueSetupStep=1;focusManageFranchisesAfterCreate=true;renderTicker();goToTab('league');
        }catch(e){console.error(e);status.textContent=e.message||'Could not create the league.';}
      };
      document.getElementById('setupAddFranchise')?.addEventListener('click',()=>{const n=document.getElementById('setupFranchiseName').value.trim();if(!n)return; if(d.franchises.some(f=>f.name.toLowerCase()===n.toLowerCase())){status.textContent='That franchise already exists.';return;} d.franchises.push({name:n,conference:document.getElementById('setupFranchiseConf').value});renderLeagueManager();});
      document.getElementById('setupPasteAdd')?.addEventListener('click',()=>{const names=document.getElementById('setupFranchisePaste').value.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);let added=0;names.forEach(n=>{if(!d.franchises.some(f=>f.name.toLowerCase()===n.toLowerCase())){d.franchises.push({name:n,conference:d.franchises.length%2?'b':'a'});added++;}});status.textContent=added?`Added ${added} franchise${added===1?'':'s'}.`:'No new franchise names were found.';renderLeagueManager();});
      contentEl.querySelectorAll('[data-setup-remove-franchise]').forEach(btn=>btn.addEventListener('click',()=>{d.franchises.splice(Number(btn.dataset.setupRemoveFranchise),1);renderLeagueManager();}));
      contentEl.querySelectorAll('[data-setup-preset]').forEach(btn=>btn.addEventListener('click',()=>{if(btn.dataset.setupPreset==='standard12'){d.interConferencePerWeek=1;d.maxGamesPerTeamPerWeek=1;if(d.franchises.length===12)d.franchises.forEach((f,i)=>f.conference=i<6?'a':'b');if(!d.weeks)d.weeks='11';}else{d.interConferencePerWeek=0;d.maxGamesPerTeamPerWeek=1;}renderLeagueManager();}));
      return;
    }

    const definitions=STATE.settings.franchiseDefinitions && typeof STATE.settings.franchiseDefinitions==='object' ? STATE.settings.franchiseDefinitions : {};
    const franchiseList=configuredFranchises();
    contentEl.innerHTML=`<div class="admin-section league-manager">
      <div class="admin-section-title"><div><div class="admin-dashboard-kicker">League Manager</div><h2>One installation, multiple leagues</h2><div class="note">Each league has its own franchises, rosters, season, replays, trades, draft and Finals.</div></div><button class="primary" id="startLeagueSetup">Set up a league</button></div>
      <div class="league-manager-active panel"><div><span class="league-manager-label">Active league</span><strong>${SBL.pokemon.escapeHtml(active.name || activeId)}</strong><span class="note">${SBL.pokemon.escapeHtml(active.description || 'No description')}</span></div><span class="badge update-badge-league">LIVE</span></div>
      <div class="panel league-manager-quick"><div><h3>Get started</h3><div class="note">New league? Use the guided setup instead of configuring every section separately.</div></div><div class="league-manager-quick-actions"><button class="primary" id="startLeagueSetup2">Set up a new league</button><button class="ghost" id="goCurrentSeason">Open current league settings</button></div></div>
      <div class="panel league-members-panel"><div class="league-manager-panel-head"><div><h3>Invite players</h3><div class="note">Share this code with registered players so they can request access. Manage approvals and assignments in People &amp; Franchises.</div></div></div><div class="league-invite-strip"><div><span class="admin-dashboard-kicker">Invite code</span><strong>${SBL.pokemon.escapeHtml(active.joinCode||'--------')}</strong></div><button class="ghost small" id="regenerateLeagueCode">Regenerate</button><button class="ghost small" type="button" id="openPeopleWorkspace">Manage people</button></div></div>
    </div>`;
    if(focusManageFranchisesAfterCreate){
      focusManageFranchisesAfterCreate=false;
      requestAnimationFrame(()=>document.querySelector('.manage-franchises-panel')?.scrollIntoView({behavior:'smooth',block:'start'}));
    }
    if(document.getElementById('normalizedFranchiseList')) {
    const franchiseCount=document.getElementById('normalizedFranchiseCount');
    const franchiseListEl=document.getElementById('normalizedFranchiseList');
    const franchiseStatus=document.getElementById('normalizedFranchiseStatus');
    const franchiseNameInput=document.getElementById('normalizedFranchiseName');
    const franchiseConferenceInput=document.getElementById('normalizedFranchiseConference');
    let ownershipByFranchise=new Map();
    let ownershipMismatch=new Set();
    let franchiseRows=[];

    async function loadOwnership(){
      ownershipByFranchise=await SBL.franchiseOwnership.loadActiveOwnershipMap(activeId,supabase);
      return ownershipByFranchise;
    }

    function franchiseIdForUser(userId){
      const target=String(userId||'');
      for(const [franchiseId,assignedUserId] of ownershipByFranchise.entries()){
        if(String(assignedUserId)===target) return franchiseId;
      }
      return null;
    }

    const drawNormalizedFranchises=async()=>{
      if(!franchiseListEl || !activeId || !SBL.leagueDb?.listFranchises) return;
      try{
        franchiseRows=await SBL.leagueDb.listFranchises(activeId,supabase);
        await loadOwnership();
        ownershipMismatch=new Set();
        for(const f of franchiseRows){
          const hasAssignment=ownershipByFranchise.has(String(f.id));
          const claimsAssigned=String(f.claim_state||'').toLowerCase()==='assigned';
          if(hasAssignment!==claimsAssigned) ownershipMismatch.add(String(f.id));
        }
        for(const franchiseId of ownershipByFranchise.keys()){
          if(!franchiseRows.some(f=>String(f.id)===String(franchiseId))) ownershipMismatch.add(String(franchiseId));
        }
        if(franchiseCount) franchiseCount.textContent=String(franchiseRows.length);
        if(!franchiseRows.length){
          franchiseListEl.innerHTML='<div class="empty-state">No normalized franchises exist yet. Add the first one above.</div>';
          return;
        }
        franchiseListEl.innerHTML=franchiseRows.map(f=>{
          const franchiseId=String(f.id);
          const ownerUserId=ownershipByFranchise.get(franchiseId);
          const ownerProfileName=ownerUserId ? displayNameForUser(ownerUserId) : '';
          const mismatch=ownershipMismatch.has(franchiseId);
          const locked=String(f.claim_state||'').toLowerCase()==='locked';
          const ownerLabel=mismatch ? 'Data mismatch' : (ownerUserId ? ownerProfileName : (locked?'Locked':'Unowned'));
          const stateLabel=mismatch ? 'Data mismatch' : (locked?'Locked':(ownerUserId?'Assigned':(f.claim_state||'available')));
          const lockDetails=locked
            ? `<span class="note">Reason: ${SBL.pokemon.escapeHtml(f.locked_reason||'No reason recorded.')} · By: ${SBL.pokemon.escapeHtml(displayNameForUser(f.locked_by)||'Unknown user')} · ${f.locked_at?SBL.pokemon.escapeHtml(new Date(f.locked_at).toLocaleString()):'time unavailable'}</span>`
            : '';
          const action=locked
            ? `<button class="ghost small" type="button" data-reopen-franchise="${SBL.pokemon.escapeHtml(franchiseId)}">Reopen</button>`
            : `<button class="ghost small" type="button" data-lock-franchise="${SBL.pokemon.escapeHtml(franchiseId)}">Lock</button>`;
          return `<div class="league-franchise-row"><div><strong>${SBL.pokemon.escapeHtml(f.name)}</strong><span class="note">${f.conference?SBL.pokemon.escapeHtml((STATE.settings.conferenceNames||{})[f.conference]||f.conference):'Conference not assigned'} · ${SBL.pokemon.escapeHtml(stateLabel)}</span>${lockDetails}</div><div class="league-member-ownership"><span class="note franchise-owner-label">${SBL.pokemon.escapeHtml(ownerLabel)}</span>${action}</div></div>`;
        }).join('');

        franchiseListEl.querySelectorAll('[data-lock-franchise]').forEach(el=>el.addEventListener('click',async()=>{
          const franchiseId=el.dataset.lockFranchise;
          const franchise=franchiseRows.find(f=>String(f.id)===String(franchiseId));
          if(!franchise)return;
          const reason=window.prompt(`Reason for locking ${franchise.name}:`);
          if(reason===null)return;
          const trimmed=String(reason).trim();
          if(!trimmed){franchiseStatus.textContent='A lock reason is required.';return;}
          el.disabled=true;
          try{
            await SBL.franchiseOwnership.lockFranchise(activeId,franchiseId,trimmed,supabase);
            await refreshMemberAndFranchiseLists();
            await logAdminAction('lock_franchise',`Locked franchise "${franchise.name}".`,{leagueId:activeId,franchiseId,reason:trimmed});
            franchiseStatus.textContent=`Locked ${franchise.name}.`;
          }catch(e){franchiseStatus.textContent='Could not lock franchise: '+(e?.message||e);el.disabled=false;}
        }));

        franchiseListEl.querySelectorAll('[data-reopen-franchise]').forEach(el=>el.addEventListener('click',async()=>{
          const franchiseId=el.dataset.reopenFranchise;
          const franchise=franchiseRows.find(f=>String(f.id)===String(franchiseId));
          if(!franchise)return;
          if(!confirm(`Reopen ${franchise.name}? It will become available or requested depending on pending requests.`))return;
          el.disabled=true;
          try{
            await SBL.franchiseOwnership.reopenFranchise(activeId,franchiseId,supabase);
            await refreshMemberAndFranchiseLists();
            await logAdminAction('reopen_franchise',`Reopened franchise "${franchise.name}".`,{leagueId:activeId,franchiseId});
            franchiseStatus.textContent=`Reopened ${franchise.name}.`;
          }catch(e){franchiseStatus.textContent='Could not reopen franchise: '+(e?.message||e);el.disabled=false;}
        }));
      }catch(e){
        if(franchiseCount) franchiseCount.textContent='—';
        if(franchiseListEl) franchiseListEl.innerHTML=`<div class="empty-state">Could not load normalized franchises: ${SBL.pokemon.escapeHtml(e.message||e)}</div>`;
      }
    };
    document.getElementById('addNormalizedFranchise')?.addEventListener('click',async()=>{
      const name=String(franchiseNameInput?.value||'').trim();
      const conference=String(franchiseConferenceInput?.value||'').trim();
      if(!name){ if(franchiseStatus) franchiseStatus.textContent='Enter a franchise name first.'; return; }
      const btn=document.getElementById('addNormalizedFranchise');
      if(btn) btn.disabled=true;
      if(franchiseStatus) franchiseStatus.textContent='Creating franchise…';
      try{
        await SBL.leagueDb.createFranchise(activeId,name,conference,{},supabase);
        if(franchiseNameInput) franchiseNameInput.value='';
        if(franchiseStatus) franchiseStatus.textContent=`Created "${name}". It has no owner or request.`;
        await drawNormalizedFranchises();
      }catch(e){
        if(franchiseStatus) franchiseStatus.textContent=e.message||'Could not create franchise.';
      }finally{ if(btn) btn.disabled=false; }
    });
    franchiseNameInput?.addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('addNormalizedFranchise')?.click();});
    const memberStatus=document.getElementById('leagueMemberStatus');
    const memberUser=document.getElementById('leagueMemberUser');
    const memberFranchise=document.getElementById('leagueMemberFranchise');
    const memberRole=document.getElementById('leagueMemberRole');
    (async()=>{try{
      if(SBL.leagueDb?.isAvailable && await SBL.leagueDb.isAvailable(supabase)){
        const normalized=await SBL.leagueDb.getLeague(activeId,supabase);
        if(normalized && Array.isArray(normalized.members)){
          active.members=normalized.members.map(m=>Object.assign({},m,{status:m.status||'active'}));
        }
      }
      await loadLeagueProfileCache(activeId);
      await drawNormalizedFranchises();
      const pendingList=document.getElementById('leagueMembersList');
      const activeList=document.getElementById('leagueActiveMembersList');
      const pendingMembers=()=>leagueMembers(active).filter(m=>String(m.status||'').toLowerCase()==='pending');
      const availableFranchises=()=>franchiseRows
        .filter(f=>String(f.status||'active').toLowerCase()==='active')
        .filter(f=>!ownershipByFranchise.has(String(f.id)))
        .filter(f=>String(f.claim_state||'').toLowerCase()!=='locked')
        .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));

      const refreshLeagueMembers=async()=>{
        const refreshed=await SBL.leagueDb.getLeague(activeId,supabase);
        if(!refreshed) throw new Error('League could not be refreshed after the ownership change.');
        active.members=(refreshed.members||[]).map(m=>Object.assign({},m,{status:m.status||'active'}));
        return active.members;
      };
      const refreshLeagueProfileCache=async()=>{ await loadLeagueProfileCache(activeId,{refresh:true}); };
      const refreshMemberAndFranchiseLists=async()=>{
        await refreshLeagueMembers();
        await refreshLeagueProfileCache();
        await drawNormalizedFranchises();
        drawPending();
        drawActive();
      };

      const drawPending=()=>{
        const pending=pendingMembers();
        const available=availableFranchises();
        document.getElementById('leagueMemberCount').textContent=String(pending.length);
        pendingList.innerHTML=pending.length ? pending.map((m,i)=>`
          <div class="league-member-row pending">
            <div><strong>${SBL.pokemon.escapeHtml(displayNameForUser(m.userId))}</strong><span class="note">Join request pending</span></div>
            <div class="league-member-ownership">
              <select data-approve-franchise-for="${SBL.pokemon.escapeHtml(m.userId)}" aria-label="Franchise for ${SBL.pokemon.escapeHtml(displayNameForUser(m.userId))}">
                <option value="">Approve without a franchise</option>
                ${available.map(f=>`<option value="${SBL.pokemon.escapeHtml(f.id)}">${SBL.pokemon.escapeHtml(f.name)}</option>`).join('')}
              </select>
              <button class="primary small" data-approve-member="${i}">Approve</button>
            </div>
            <span class="league-member-pending">Awaiting approval</span>
            <button class="ghost small danger-btn" data-reject-member="${i}">Reject</button>
          </div>`).join('') : '<div class="empty-state">No pending membership requests.</div>';

        pendingList.querySelectorAll('[data-approve-member]').forEach(el=>el.addEventListener('click',async()=>{
          const i=Number(el.dataset.approveMember), m=pendingMembers()[i];
          if(!m?.userId) return;
          const select=pendingList.querySelector(`[data-approve-franchise-for="${CSS.escape(m.userId)}"]`);
          const franchiseId=select?.value||null;
          const franchiseName=franchiseId ? (franchiseRows.find(f=>String(f.id)===String(franchiseId))?.name||'selected franchise') : '';
          if(!confirm(franchiseId ? `Approve ${displayNameForUser(m.userId)} and assign ${franchiseName}?` : `Approve ${displayNameForUser(m.userId)} without a franchise?`)) return;
          el.disabled=true;
          if(select) select.disabled=true;
          try{
            await SBL.franchiseOwnership.approveMembershipAndAssign(activeId,m.userId,franchiseId,supabase);
            await refreshMemberAndFranchiseLists();
            await logAdminAction('approve_league_member',
              franchiseId ? `Approved ${displayNameForUser(m.userId)} and assigned franchise "${franchiseName}".` : `Approved ${displayNameForUser(m.userId)} for league "${active.name||activeId}" without a franchise.`,
              {leagueId:activeId,userId:m.userId,franchiseId});
            memberStatus.textContent=franchiseId ? `Approved ${displayNameForUser(m.userId)} and assigned ${franchiseName}.` : `Approved ${displayNameForUser(m.userId)}. Membership is active with no franchise.`;
          }catch(e){
            memberStatus.textContent='Could not approve membership: '+(e?.message||e);
            el.disabled=false;
            if(select) select.disabled=false;
          }
        }));

        pendingList.querySelectorAll('[data-reject-member]').forEach(el=>el.addEventListener('click',async()=>{
          const i=Number(el.dataset.rejectMember), m=pendingMembers()[i];
          if(!m?.userId) return;
          const reason=window.prompt(`Reason for rejecting ${displayNameForUser(m.userId)}'s league membership:`);
          if(reason===null) return;
          const trimmed=String(reason).trim();
          if(!trimmed){ memberStatus.textContent='A rejection reason is required.'; return; }
          el.disabled=true;
          try{
            const {data,error}=await supabase.rpc('sbl_reject_league_membership',{p_league_id:activeId,p_user_id:m.userId});
            if(error) throw error;
            m.status=data?.status||'rejected'; m.approvedAt=null;
            await logAdminAction('reject_league_member',`Rejected ${displayNameForUser(m.userId)} from league "${active.name||activeId}".`,{leagueId:activeId,userId:m.userId,rejectionReason:trimmed});
            memberStatus.textContent=`Rejected ${displayNameForUser(m.userId)}. Reason recorded in the admin action log.`;
            drawPending(); drawActive();
          }catch(e){ memberStatus.textContent='Could not reject membership: '+(e?.message||e); el.disabled=false; }
        }));
      };

      const drawActive=()=>{
        const members=leagueMembers(active).filter(m=>String(m.status||'').toLowerCase()==='active');
        const ownershipTargets=leagueMembers(active).filter(m=>['active','pending'].includes(String(m.status||'').toLowerCase()));
        const available=availableFranchises();
        activeList.innerHTML=members.length ? members.map((m,i)=>{
          const franchiseId=franchiseIdForUser(m.userId);
          const franchiseRow=franchiseId ? franchiseRows.find(f=>String(f.id)===String(franchiseId)) : null;
          const mismatch=franchiseId ? ownershipMismatch.has(String(franchiseId)) : false;
          const hasFranchise=!!franchiseId && !mismatch;
          const franchiseLabel=mismatch ? 'Data mismatch' : (franchiseRow?.name||'No franchise');
          const targets=ownershipTargets.filter(t=>String(t.userId)!==String(m.userId));
          const assignmentControl=`<select data-assign-franchise-for="${SBL.pokemon.escapeHtml(m.userId)}" aria-label="Assign franchise to ${SBL.pokemon.escapeHtml(displayNameForUser(m.userId))}"><option value="">${hasFranchise?'Change franchise…':'Assign franchise…'}</option>${available.map(f=>`<option value="${SBL.pokemon.escapeHtml(f.id)}">${SBL.pokemon.escapeHtml(f.name)}</option>`).join('')}</select><button class="ghost small" type="button" data-assign-franchise="${SBL.pokemon.escapeHtml(m.userId)}">${hasFranchise?'Change':'Assign'}</button>`;
          const ownershipControls=mismatch
            ? `<span class="note">Data mismatch</span>`
            : hasFranchise
              ? `<div class="league-member-ownership"><span class="note">${SBL.pokemon.escapeHtml(franchiseLabel)}</span>${assignmentControl}<button class="ghost small" type="button" data-vacate-franchise="${SBL.pokemon.escapeHtml(m.userId)}">Vacate</button><select data-reassign-to="${SBL.pokemon.escapeHtml(m.userId)}" aria-label="Reassign ${SBL.pokemon.escapeHtml(franchiseLabel)} to"><option value="">Reassign to…</option>${targets.map(t=>`<option value="${SBL.pokemon.escapeHtml(t.userId)}">${SBL.pokemon.escapeHtml(displayNameForUser(t.userId))}${String(t.status||'').toLowerCase()==='pending'?' · Pending':''}</option>`).join('')}</select><button class="ghost small" type="button" data-reassign-franchise="${SBL.pokemon.escapeHtml(m.userId)}">Reassign</button></div>`
              : `<div class="league-member-ownership">${assignmentControl}</div>`;
          return `<div class="league-member-row"><div><strong>${SBL.pokemon.escapeHtml(displayNameForUser(m.userId))}</strong><span class="note">${SBL.pokemon.escapeHtml(m.status||'active')}</span></div><select data-member-role="${i}"><option value="player" ${(m.role||'player')==='player'?'selected':''}>Player</option><option value="manager" ${(m.role||'player')==='manager'?'selected':''}>Manager</option><option value="commissioner" ${(m.role||'player')==='commissioner'?'selected':''}>Commissioner</option></select>${ownershipControls}<button class="ghost small danger-btn" data-remove-member="${i}">Remove</button></div>`;
        }).join('') : '<div class="empty-state">No active members yet.</div>';

        activeList.querySelectorAll('[data-member-role]').forEach(el=>el.addEventListener('change',async()=>{
          const i=Number(el.dataset.memberRole);
          const members=leagueMembers(active).filter(m=>String(m.status||'').toLowerCase()==='active');
          const member=members[i]; if(!member?.userId)return;
          const nextRole=String(el.value||'player').toLowerCase(); el.disabled=true;
          try{
            const {data,error}=await supabase.rpc('sbl_set_league_member_role',{target_league:activeId,target_user:member.userId,new_role:nextRole});
            if(error)throw error;
            member.role=data?.role||nextRole;
            await saveSharedState();
            await logAdminAction('set_league_member_role',`Changed league member role to ${member.role}.`,{leagueId:activeId,userId:member.userId,role:member.role});
            drawActive();
          }catch(e){ el.value=member.role||'player'; alert('Could not change league member role: '+(e?.message||e)); el.disabled=false; }
        }));

        activeList.querySelectorAll('[data-assign-franchise]').forEach(el=>el.addEventListener('click',async()=>{
          const userId=el.dataset.assignFranchise;
          const member=leagueMembers(active).find(m=>String(m.userId)===String(userId));
          const select=activeList.querySelector(`[data-assign-franchise-for="${CSS.escape(userId)}"]`);
          const franchiseId=select?.value||'';
          if(!member?.userId)return;
          if(!franchiseId){memberStatus.textContent='Choose a franchise first.';return;}
          if(!availableFranchises().some(f=>String(f.id)===String(franchiseId))){memberStatus.textContent='That franchise is no longer available.';return;}
          const franchiseName=franchiseRows.find(f=>String(f.id)===String(franchiseId))?.name||'selected franchise';
          const previousFranchiseId=franchiseIdForUser(userId);
          const previousFranchiseName=previousFranchiseId?(franchiseRows.find(f=>String(f.id)===String(previousFranchiseId))?.name||'their current franchise'):null;
          const confirmText=previousFranchiseName
            ? `Move ${displayNameForUser(member.userId)} from ${previousFranchiseName} to ${franchiseName}? Their current assignment will be vacated. Any pending requests for ${franchiseName} will be invalidated.`
            : `Assign ${franchiseName} to ${displayNameForUser(member.userId)}? Any pending requests for ${franchiseName} will be invalidated.`;
          if(!confirm(confirmText))return;
          el.disabled=true; if(select)select.disabled=true;
          try{
            const result=await SBL.franchiseOwnership.commissionerAssignFranchise(activeId,userId,franchiseId,supabase);
            const assigned=await SBL.franchiseOwnership.getUserFranchise(activeId,userId,supabase);
            if(String(assigned?.franchiseId||'')!==String(franchiseId))throw new Error('The RPC returned, but active ownership could not be verified.');
            await refreshMemberAndFranchiseLists();
            await logAdminAction('commissioner_assign_franchise',`${previousFranchiseName?`Moved ${displayNameForUser(member.userId)} from ${previousFranchiseName} to ${franchiseName}`:`Assigned franchise "${franchiseName}" to ${displayNameForUser(member.userId)}`}.`,{leagueId:activeId,userId,franchiseId,previousFranchiseId,assignmentId:assigned.assignmentId,invalidatedRequestCount:result?.invalidated_request_count||0});
            memberStatus.textContent=`Assigned ${franchiseName} to ${displayNameForUser(member.userId)}. Active ownership was verified.${result?.invalidated_request_count?` ${result.invalidated_request_count} pending request(s) invalidated.`:''}`;
          }catch(e){memberStatus.textContent='Could not assign franchise: '+(e?.message||e);el.disabled=false;if(select)select.disabled=false;}
        }));

        activeList.querySelectorAll('[data-vacate-franchise]').forEach(el=>el.addEventListener('click',async()=>{
          const userId=el.dataset.vacateFranchise;
          const member=leagueMembers(active).find(m=>String(m.userId)===String(userId));
          const franchiseId=franchiseIdForUser(userId);
          if(!member?.userId||!franchiseId||ownershipMismatch.has(String(franchiseId)))return;
          const franchiseName=franchiseRows.find(f=>String(f.id)===String(franchiseId))?.name||'their franchise';
          if(!confirm(`Vacate ${franchiseName} from ${displayNameForUser(member.userId)}? They will remain active in the league with no franchise.`))return;
          const lockAfterVacate=confirm(`Also lock ${franchiseName} after vacating it?\n\nOK = lock it\nCancel = leave it available/requested.`);
          el.disabled=true;
          try{
            if(!SBL.franchiseOwnership?.vacateFranchise)throw new Error('Franchise ownership service is not available.');
            await SBL.franchiseOwnership.vacateFranchise(activeId,franchiseId,userId,supabase,lockAfterVacate);
            await refreshMemberAndFranchiseLists();
            await logAdminAction('vacate_franchise',`Vacated franchise "${franchiseName}" from ${displayNameForUser(member.userId)}${lockAfterVacate?' and locked it':''}.`,{leagueId:activeId,userId,franchiseId,lockAfterVacate});
            memberStatus.textContent=lockAfterVacate
              ? `Vacated and locked ${franchiseName}. ${displayNameForUser(member.userId)} remains active in the league with no franchise.`
              : `Vacated ${franchiseName}. ${displayNameForUser(member.userId)} remains active in the league with no franchise.`;
          }catch(e){memberStatus.textContent='Could not vacate franchise: '+(e?.message||e);el.disabled=false;}
        }));

        activeList.querySelectorAll('[data-reassign-franchise]').forEach(el=>el.addEventListener('click',async()=>{
          const fromUserId=el.dataset.reassignFranchise;
          const select=activeList.querySelector(`[data-reassign-to="${CSS.escape(fromUserId)}"]`);
          const toUserId=select?.value||'';
          const fromMember=leagueMembers(active).find(m=>String(m.userId)===String(fromUserId));
          const toMember=leagueMembers(active).find(m=>String(m.userId)===String(toUserId));
          const franchiseId=franchiseIdForUser(fromUserId);
          if(!franchiseId||ownershipMismatch.has(String(franchiseId))||!toMember?.userId){memberStatus.textContent='Choose a destination member first.';return;}
          const franchiseName=franchiseRows.find(f=>String(f.id)===String(franchiseId))?.name||'this franchise';
          if(!confirm(`Reassign ${franchiseName} from ${displayNameForUser(fromMember.userId)} to ${displayNameForUser(toMember.userId)}?`))return;
          el.disabled=true;if(select)select.disabled=true;
          try{
            if(!SBL.franchiseOwnership?.reassignFranchise)throw new Error('Franchise ownership service is not available.');
            await SBL.franchiseOwnership.reassignFranchise(activeId,franchiseId,fromUserId,toMember.userId,supabase);
            await refreshMemberAndFranchiseLists();
            await logAdminAction('reassign_franchise',`Reassigned franchise "${franchiseName}" from ${displayNameForUser(fromMember.userId)} to ${displayNameForUser(toMember.userId)}.`,{leagueId:activeId,franchiseId,fromUserId,toUserId:toMember.userId});
            memberStatus.textContent=`Reassigned ${franchiseName} to ${displayNameForUser(toMember.userId)}.`;
          }catch(e){memberStatus.textContent='Could not reassign franchise: '+(e?.message||e);el.disabled=false;if(select)select.disabled=false;}
        }));

        activeList.querySelectorAll('[data-remove-member]').forEach(el=>el.addEventListener('click',async()=>{
          const i=Number(el.dataset.removeMember);
          const members=leagueMembers(active).filter(m=>String(m.status||'').toLowerCase()==='active');
          const removed=members[i]; if(!removed?.userId)return;
          const removedFranchiseId=franchiseIdForUser(removed.userId);
          const removedFranchise=removedFranchiseId ? franchiseRows.find(f=>String(f.id)===String(removedFranchiseId)) : null;
          if(!confirm(`Remove ${displayNameForUser(removed.userId)} from "${active.name||activeId}"? Their franchise, if any, will be released atomically.`))return;
          const lockAfterRemove=!!removedFranchise && confirm(`Also lock ${removedFranchise.name} after removing ${displayNameForUser(removed.userId)}?\n\nOK = lock it\nCancel = leave it available/requested.`);
          el.disabled=true;
          try{
            if(!SBL.franchiseOwnership?.removeLeagueMember)throw new Error('Franchise ownership service is not available.');
            await SBL.franchiseOwnership.removeLeagueMember(activeId,removed.userId,supabase,lockAfterRemove);
            await refreshMemberAndFranchiseLists();
            await logAdminAction('remove_league_member',`Removed ${displayNameForUser(removed.userId)} from league "${active.name||activeId}"${lockAfterRemove?' and locked the released franchise':''}.`,{leagueId:activeId,userId:removed.userId,franchiseId:removedFranchiseId,lockAfterRemove});
            memberStatus.textContent=lockAfterRemove
              ? `Removed ${displayNameForUser(removed.userId)} and locked ${removedFranchise.name}.`
              : `Removed ${displayNameForUser(removed.userId)}. Any franchise they owned was released.`;
          }catch(e){memberStatus.textContent='Could not remove league member: '+(e?.message||e);el.disabled=false;}
        }));
      };

      memberUser.innerHTML='<option value="">Select a user…</option>'+[...LEAGUE_PROFILE_CACHE.values()].filter(p=>!leagueMembers(active).some(m=>String(m.userId)===String(p.id))).map(p=>`<option value="${SBL.pokemon.escapeHtml(p.id)}">${SBL.pokemon.escapeHtml(displayNameForUser(p.id))}</option>`).join('');
      drawPending(); drawActive();
      document.getElementById('addLeagueMember').onclick=async()=>{const userId=memberUser.value;if(!userId){memberStatus.textContent='Select a user first.';return;}if(leagueMembers(active).some(m=>String(m.userId)===String(userId))){memberStatus.textContent='That user is already a member.';return;}const p=LEAGUE_PROFILE_CACHE.get(String(userId));const member={userId,username:p?.username||'',role:memberRole.value||'manager',status:'active',addedAt:new Date().toISOString()};leagueMembers(active).push(member);await saveSharedState();await refreshLeagueProfileCache();await logAdminAction('add_league_member',`Added ${displayNameForUser(member.userId)} to league "${active.name||activeId}".`,{leagueId:activeId,userId,role:member.role});memberUser.value='';drawPending();drawActive();memberStatus.textContent='Member added.';};
    }catch(e){const pendingList=document.getElementById('leagueMembersList');if(pendingList) pendingList.innerHTML=`<div class="empty-state">Could not load membership requests: ${SBL.pokemon.escapeHtml(e.message||e)}</div>`;}})();
    } // End legacy inline membership/franchise manager (replaced by People workspace).
    document.getElementById('openPeopleWorkspace')?.addEventListener('click',()=>goToTab('people'));
    document.getElementById('regenerateLeagueCode')?.addEventListener('click',async()=>{active.joinCode=makeLeagueJoinCode();await saveSharedState();await logAdminAction('regenerate_league_code',`Regenerated invite code for league "${active.name||activeId}".`,{leagueId:activeId});renderLeagueManager();});

    const start=()=>{leagueSetupDraft=blankLeagueSetup();leagueSetupStep=1;renderLeagueManager();};
    document.getElementById('startLeagueSetup')?.addEventListener('click',start);document.getElementById('startLeagueSetup2')?.addEventListener('click',start);
    document.getElementById('goCurrentSeason')?.addEventListener('click',()=>goToTab('seasonsetup'));
  }

  async function renderPeople(){
    requireAdmin();
    const leagueId=String(SBL.leagueDb?.selectedLeagueId?.() || STATE.settings.activeLeagueId || '').trim();
    if(!leagueId){contentEl.innerHTML='<div class="empty-state">Select a league before managing people and franchises.</div>';return;}
    contentEl.innerHTML=`<div class="admin-section people-workspace">
      <div class="admin-section-title"><div><div class="admin-dashboard-kicker">League operations</div><h2>People &amp; Franchises</h2><div class="note" id="peopleCurrentSeason">Loading current season…</div></div><button type="button" class="ghost small" id="peopleRefresh">Refresh</button></div>
      <div class="admin-kpi-grid" id="peopleMetrics"><div class="panel"><span>Loading</span></div></div>
      <div class="panel"><div class="section-head-row"><div><h3>League Members</h3><div class="note">Actual players with a membership record in this league, including current, sitting-out, pending and historical members. Test accounts are listed separately.</div></div></div>
        <div id="peopleDirectory"><div class="empty-state">Loading league members…</div></div>
        <div id="peopleAccountStatus" class="note" aria-live="polite"></div>
      </div>
      <div class="panel"><div class="section-head-row"><div><h3>Test Accounts</h3><div class="note">Accounts marked for testing are kept separate from the league's actual player list. They remain league-scoped and can still be used to test league features.</div></div></div>
        <div id="peopleTestAccounts"><div class="empty-state">Loading test accounts…</div></div>
      </div>
      <div class="panel"><div class="section-head-row"><div><h3>Membership requests</h3><div class="note">Approve or reject people who have requested to join. Approval does not require assigning a franchise immediately.</div></div></div><div id="peoplePending"><div class="empty-state">Loading…</div></div></div>
      <div class="panel"><div class="section-head-row"><div><h3>Manage active members &amp; roles</h3><div class="note">Manage each member's league role (including Commissioner) and franchise participation. Assign or change franchises. Changing ownership vacates the member's previous assignment and invalidates pending requests for the selected franchise. A sit-out changes only this season's participation status. Their franchise remains assigned and reserved for when they return.</div></div></div><div id="peopleMembers"><div class="empty-state">Loading…</div></div><div id="peopleActionStatus" class="note" aria-live="polite"></div></div>
      <div class="panel"><div class="section-head-row"><div><h3>Franchises</h3><div class="note">Archive unused franchises without deleting their identity or history. Archived franchises can be restored later.</div></div></div>
        <div class="people-add-row"><input id="peopleFranchiseName" placeholder="New franchise name"><input id="peopleFranchiseConference" placeholder="Conference (optional)"><button type="button" class="primary small" id="peopleCreateFranchise">Create franchise</button></div>
        <div id="peopleFranchises"><div class="empty-state">Loading…</div></div>
      </div>
      <div class="panel admin-danger-section"><div class="section-head-row"><div><h3>Reset franchise ownership</h3><div class="note">Vacates current ownership and cancels pending franchise claims for this league. Keeps all accounts, league memberships, franchise definitions, archived seasons, replay data and assignment/request history.</div></div></div><button type="button" class="ghost danger-btn" id="peopleResetOwnership">Reset ownership mappings</button><div id="peopleResetStatus" class="note" aria-live="polite"></div></div>
    </div>`;

    const $=id=>document.getElementById(id);
    const status=$('peopleAccountStatus');
    const actionStatus=$('peopleActionStatus');
    let profiles=[], league=null, season=null, franchises=[], assignments=[], pendingRequests=[], seasonStatuses=new Map();
    const refresh=async()=>{
      $('peopleRefresh').disabled=true;
      try{
        const results=await Promise.all([
          supabase.rpc('sbl_admin_list_league_users',{p_league_id:leagueId}),
          SBL.leagueDb.getLeague(leagueId,supabase),
          SBL.leagueDb.getSeasonContext(leagueId,supabase),
          SBL.leagueDb.listFranchises(leagueId,supabase),
        ]);
        if(results[0].error) throw results[0].error;
        profiles=results[0].data||[]; league=results[1]; season=results[2]; franchises=results[3]||[];
        if(!season?.id) throw new Error('No current season could be resolved for this league.');
        $('peopleCurrentSeason').textContent=`${season.name} · Sit-outs do not remove accounts or league membership.`;
        const [assignmentResult,requestResult,seasonStatusResult]=await Promise.all([
          supabase.from('franchise_assignments').select('id,league_id,franchise_id,user_id,status,assigned_at,vacated_at').eq('league_id',leagueId).eq('status','active'),
          supabase.from('franchise_requests').select('id,league_id,user_id,franchise_id,status,created_at').eq('league_id',leagueId).eq('status','pending').order('created_at',{ascending:true}),
          supabase.from('league_season_memberships').select('user_id,status').eq('league_id',leagueId).eq('season_id',season.id)
        ]);
        if(assignmentResult.error) throw assignmentResult.error;
        if(requestResult.error) throw requestResult.error;
        if(seasonStatusResult.error) throw seasonStatusResult.error;
        assignments=assignmentResult.data||[]; pendingRequests=requestResult.data||[];
        seasonStatuses=new Map((seasonStatusResult.data||[]).map(row=>[String(row.user_id),row.status]));
        const allMembers=(league?.members||[]);
        const members=allMembers.filter(m=>String(m.status||'').toLowerCase()!=='removed');
        const playerMembers=allMembers.filter(m=>String(m.member_type||'player')!=='test_account');
        const testMembers=allMembers.filter(m=>String(m.member_type||'player')==='test_account');
        const pending=members.filter(m=>String(m.status||'').toLowerCase()==='pending');
        const active=members.filter(m=>String(m.status||'').toLowerCase()==='active' && String(m.member_type||'player')!=='test_account');
        const activeTestAccounts=members.filter(m=>String(m.status||'').toLowerCase()==='active' && String(m.member_type||'player')==='test_account');
        const assignedUsers=new Set(assignments.map(a=>String(a.user_id)));
        const owners=new Map(assignments.map(a=>[String(a.franchise_id),String(a.user_id)]));
        const name=id=>{const p=profiles.find(row=>String(row.id)===String(id));return String(p?.username||'Unknown user');};
        $('peopleMetrics').innerHTML=[['League players',playerMembers.length],['Test accounts',testMembers.length],['Active players',active.length],['Awaiting approval',pending.length],['Assigned franchises',assignments.length],['Sitting out',active.filter(m=>seasonStatuses.get(String(m.userId||m.user_id))==='sitting_out').length]].map(([label,value])=>`<div class="panel people-metric"><span>${SBL.pokemon.escapeHtml(label)}</span><strong>${value}</strong></div>`).join('');
        const memberIds=new Set(allMembers.map(m=>String(m.userId||m.user_id)));
        const membershipLabel=value=>({active:'Current member',pending:'Awaiting approval',removed:'Historical member',rejected:'Membership rejected',cancelled:'Membership cancelled'}[String(value||'').toLowerCase()]||String(value||'Membership recorded'));
        const renderDirectoryRows=(rows,targetType)=>rows.length?rows.map(m=>{
          const uid=String(m.userId||m.user_id); const memberStatus=String(m.status||'').toLowerCase();
          const seasonStatus=seasonStatuses.get(uid)||'participating';
          const seasonLabel=memberStatus==='active'?(seasonStatus==='sitting_out'?' · Sitting out this season':' · Current season') : '';
          const action=targetType==='test_account'?'Mark as test account':'Mark as player';
          const nextType=targetType==='test_account'?'player':'test_account';
          return `<div class="people-row"><div><strong>${SBL.pokemon.escapeHtml(name(uid))}</strong><span class="note">${SBL.pokemon.escapeHtml(membershipLabel(memberStatus))} · ${SBL.pokemon.escapeHtml(m.role||'player')}${SBL.pokemon.escapeHtml(seasonLabel)}</span></div><div class="people-actions"><button type="button" class="ghost small" data-people-member-type="${SBL.pokemon.escapeHtml(uid)}" data-next-member-type="${nextType}">${action}</button></div></div>`;
        }).join(''):'<div class="empty-state">None.</div>';
        $('peopleDirectory').innerHTML=`<div class="people-subsection"><h4>Players (${playerMembers.length})</h4>${renderDirectoryRows(playerMembers,'test_account')}</div>`;
        $('peopleTestAccounts').innerHTML=`<div class="people-subsection"><h4>Test accounts (${testMembers.length})</h4>${renderDirectoryRows(testMembers,'player')}</div>`;
        const renderPendingRows=rows=>rows.length?rows.map(m=>`<div class="people-row"><div><strong>${SBL.pokemon.escapeHtml(name(m.userId||m.user_id))}</strong><span class="note">Membership pending · ${SBL.pokemon.escapeHtml(m.role||'player')}</span></div><div class="people-actions"><button class="primary small" data-people-approve="${SBL.pokemon.escapeHtml(m.userId||m.user_id)}">Approve</button><button class="ghost small danger-btn" data-people-reject="${SBL.pokemon.escapeHtml(m.userId||m.user_id)}">Reject</button></div></div>`).join(''):'<div class="empty-state">None.</div>';
        $('peoplePending').innerHTML=`<div class="people-subsection"><h4>Player requests (${pending.filter(m=>String(m.member_type||'player')!=='test_account').length})</h4>${renderPendingRows(pending.filter(m=>String(m.member_type||'player')!=='test_account'))}</div><div class="people-subsection"><h4>Test account requests (${pending.filter(m=>String(m.member_type||'player')==='test_account').length})</h4>${renderPendingRows(pending.filter(m=>String(m.member_type||'player')==='test_account'))}</div>`;
        const renderManagedRows=rows=>rows.length?rows.map(m=>{
          const uid=String(m.userId||m.user_id); const assignment=assignments.find(a=>String(a.user_id)===uid); const franchise=assignment?franchises.find(f=>String(f.id)===String(assignment.franchise_id)):null;
          const available=franchises.filter(f=>String(f.status||'active')==='active' && String(f.claim_state||'')!=='locked' && !owners.has(String(f.id)));
          const participation=seasonStatuses.get(uid)||'participating';
          const assignmentControl=`<select data-people-assign-select="${SBL.pokemon.escapeHtml(uid)}"><option value="">${franchise?'Change franchise…':'Assign franchise…'}</option>${available.map(f=>`<option value="${SBL.pokemon.escapeHtml(f.id)}">${SBL.pokemon.escapeHtml(f.name)}</option>`).join('')}</select><button type="button" class="ghost small" data-people-assign="${SBL.pokemon.escapeHtml(uid)}">${franchise?'Change':'Assign'}</button>`;
          const role=String(m.role||'player').toLowerCase();
          const memberType=String(m.member_type||'player').toLowerCase();
          const roleSelection=memberType==='test_account'?'test_account':role;
          const roleControl=`<label class="people-role-control"><span>League role</span><select data-people-role="${SBL.pokemon.escapeHtml(uid)}" aria-label="League role for ${SBL.pokemon.escapeHtml(name(uid))}"><option value="player" ${roleSelection==='player'?'selected':''}>Player</option><option value="manager" ${roleSelection==='manager'?'selected':''}>Manager</option><option value="commissioner" ${roleSelection==='commissioner'?'selected':''}>Commissioner</option><option value="test_account" ${roleSelection==='test_account'?'selected':''}>Test account</option></select></label>`;
          return `<div class="people-row"><div><strong>${SBL.pokemon.escapeHtml(name(uid))}</strong><span class="note">${SBL.pokemon.escapeHtml(m.role||'player')} · ${participation==='sitting_out'?'Sitting out this season':(franchise?`Currently assigned: ${SBL.pokemon.escapeHtml(franchise.name)}`:'Participating · no franchise assigned')}${participation==='sitting_out'&&franchise?` · Franchise remains reserved: ${SBL.pokemon.escapeHtml(franchise.name)}`:''}</span></div><div class="people-actions">${roleControl}${participation==='sitting_out'?`<button type="button" class="ghost small" data-people-return="${SBL.pokemon.escapeHtml(uid)}">Mark returning</button>`:`${assignmentControl}<button type="button" class="ghost small" data-people-sitout="${SBL.pokemon.escapeHtml(uid)}">Mark sit-out</button>`}</div></div>`;
        }).join(''):'<div class="empty-state">None.</div>';
        $('peopleMembers').innerHTML=`<div class="people-subsection"><h4>Players (${active.length})</h4>${renderManagedRows(active)}</div><div class="people-subsection"><h4>Test accounts (${activeTestAccounts.length})</h4>${renderManagedRows(activeTestAccounts)}</div>`;
        // Bind Assign directly to each freshly rendered button. Delegated clicks
        // were intermittently lost when the People workspace was re-rendered.
        $('peopleMembers').querySelectorAll('[data-people-assign]').forEach(button=>{
          button.type='button';
          button.addEventListener('click',event=>{
            event.preventDefault();
            const uid=String(button.dataset.peopleAssign||'');
            const select=Array.from($('peopleMembers').querySelectorAll('[data-people-assign-select]'))
              .find(node=>String(node.dataset.peopleAssignSelect||'')===uid);
            const fid=String(select?.value||'');
            void run(button,async()=>{
              if(!uid) throw new Error('The selected member could not be identified. Refresh the page and try again.');
              if(!fid) throw new Error('Choose a franchise first.');
              const selected=franchises.find(f=>String(f.id)===fid);
              if(!selected||String(selected.status||'active')!=='active'||String(selected.claim_state||'')==='locked'||assignments.some(a=>String(a.franchise_id)===fid))
                throw new Error('That franchise is no longer available. Refresh and choose another franchise.');
              actionStatus.textContent=`Assigning ${selected.name}…`;
              const previousAssignment=assignments.find(a=>String(a.user_id)===uid);
              const previousFranchise=previousAssignment?franchises.find(f=>String(f.id)===String(previousAssignment.franchise_id)):null;
              const invalidatedCount=pendingRequests.filter(r=>String(r.franchise_id)===fid).length;
              const confirmText=previousFranchise
                ? `Move ${name(uid)} from ${previousFranchise.name} to ${selected.name}? The previous assignment will be vacated${invalidatedCount?` and ${invalidatedCount} pending request(s) for ${selected.name} invalidated`:''}.`
                : `Assign ${selected.name} to ${name(uid)}?${invalidatedCount?` This will invalidate ${invalidatedCount} pending request(s) for that franchise.`:''}`;
              if(!await showAdminConfirmDialog({title:previousFranchise?'Confirm franchise change':'Confirm franchise assignment',description:confirmText,confirmLabel:previousFranchise?'Change franchise':'Assign franchise'})) return;
              const result=await SBL.franchiseOwnership.commissionerAssignFranchise(leagueId,uid,fid,supabase);
              if(result?.ok===false) throw new Error(result.message||'The assignment RPC did not confirm success.');
              const assigned=await SBL.franchiseOwnership.getUserFranchise(leagueId,uid,supabase);
              if(String(assigned?.franchiseId||'')!==fid) throw new Error('The RPC returned, but the active assignment could not be verified. Refresh and inspect franchise ownership before retrying.');
              await logAdminAction('commissioner_assign_franchise',`${previousFranchise?`Moved ${nameForAudit(uid)} from ${previousFranchise.name} to ${selected.name}`:`Assigned ${selected.name} to ${nameForAudit(uid)}`}.`,{leagueId,userId:uid,franchiseId:fid,previousFranchiseId:previousAssignment?.franchise_id||null,assignmentId:assigned.assignmentId,invalidatedRequestCount:result?.invalidated_request_count??invalidatedCount});
              actionStatus.textContent=`${previousFranchise?`Moved ${nameForAudit(uid)} from ${previousFranchise.name} to ${selected.name}`:`Assigned ${selected.name} to ${nameForAudit(uid)}`}. Active ownership was verified.${result?.invalidated_request_count?` ${result.invalidated_request_count} pending request(s) invalidated.`:''}`;
            });
          });
        });
        $('peopleFranchises').innerHTML=franchises.length?franchises.map(f=>{
          const owner=owners.get(String(f.id)); const archived=String(f.status||'active')==='inactive'; const locked=String(f.claim_state||'')==='locked';
          return `<div class="people-row people-franchise-row"><div><strong>${SBL.pokemon.escapeHtml(f.name)}</strong><span class="note">${SBL.pokemon.escapeHtml(f.conference||'No conference')} · ${archived?'Archived':owner?`Assigned to ${SBL.pokemon.escapeHtml(name(owner))}`:locked?'Locked':'Available'}</span></div><div class="people-actions"><button type="button" class="ghost small" data-people-edit-franchise="${SBL.pokemon.escapeHtml(f.id)}">Edit details</button>${archived?`<button class="ghost small" data-people-restore-franchise="${SBL.pokemon.escapeHtml(f.id)}">Restore</button>`:(!owner&&!locked?`<button class="ghost small danger-btn" data-people-archive-franchise="${SBL.pokemon.escapeHtml(f.id)}">Archive</button>`:'')}</div><div class="people-franchise-edit" data-people-franchise-form="${SBL.pokemon.escapeHtml(f.id)}" hidden><label>Franchise name<input type="text" data-people-franchise-name value="${SBL.pokemon.escapeHtml(f.name)}"></label><label>Conference<input type="text" data-people-franchise-conference value="${SBL.pokemon.escapeHtml(f.conference||'')}" maxlength="80" placeholder="Optional"></label><div class="people-actions"><button type="button" class="primary small" data-people-save-franchise="${SBL.pokemon.escapeHtml(f.id)}">Save changes</button><button type="button" class="ghost small" data-people-cancel-franchise="${SBL.pokemon.escapeHtml(f.id)}">Cancel</button></div></div></div>`;
        }).join(''):'<div class="empty-state">No franchise definitions yet.</div>';
        if(pendingRequests.length){
          const franchiseById=new Map(franchises.map(f=>[String(f.id),f]));
          $('peoplePending').insertAdjacentHTML('beforeend',`<div class="people-subsection"><h4>Pending franchise claims</h4>${pendingRequests.map(r=>`<div class="people-row"><div><strong>${SBL.pokemon.escapeHtml(name(r.user_id))}</strong><span class="note">${SBL.pokemon.escapeHtml(franchiseById.get(String(r.franchise_id))?.name||'Unknown franchise')} · requested ${r.created_at?SBL.pokemon.escapeHtml(new Date(r.created_at).toLocaleDateString()):'date unavailable'}</span></div><div class="people-actions"><button class="ghost small danger-btn" data-people-reject-claim="${SBL.pokemon.escapeHtml(r.user_id)}">Cancel claim</button></div></div>`).join('')}</div>`);
        }
      }catch(e){
        const message=SBL.pokemon.escapeHtml(e?.message||e);
        $('peopleDirectory').innerHTML=`<div class="empty-state">Could not load league members: ${message}</div>`;
        $('peoplePending').innerHTML=`<div class="empty-state">Could not load membership data: ${message}</div>`;
        $('peopleMembers').innerHTML=`<div class="empty-state">Could not load member data: ${message}</div>`;
        $('peopleFranchises').innerHTML=`<div class="empty-state">Could not load franchise data: ${message}</div>`;
        status.textContent='Some account or league data could not be loaded. No records were changed.';
      }finally{$('peopleRefresh').disabled=false;}
    };
    const run=async(button,fn)=>{if(button)button.disabled=true;try{await fn();await refresh();}catch(e){actionStatus.textContent=e?.message||String(e);if(button)button.disabled=false;}};
    $('peopleRefresh').addEventListener('click',refresh);
    const handleMemberTypeChange=async event=>{
      const button=event.target.closest('[data-people-member-type]');
      if(!button)return;
      const uid=String(button.dataset.peopleMemberType||''),nextType=String(button.dataset.nextMemberType||'');
      if(!uid||!['player','test_account'].includes(nextType))return;
      button.disabled=true;
      try{
        const {data,error}=await supabase.rpc('sbl_set_league_member_type',{p_league_id:leagueId,p_user_id:uid,p_member_type:nextType});
        if(error)throw error;
        await logAdminAction('set_league_member_type',`Changed ${nameForAudit(uid)} to ${nextType==='test_account'?'a test account':'a league player'}.`,{leagueId,userId:uid,memberType:nextType});
        status.textContent=`${nameForAudit(uid)} is now listed as ${nextType==='test_account'?'a test account':'a league player'}.`;
        await refresh();
      }catch(error){button.disabled=false;status.textContent=error?.message||'Could not update account type.';}
    };
    $('peopleDirectory').addEventListener('click',handleMemberTypeChange);
    $('peopleTestAccounts').addEventListener('click',handleMemberTypeChange);
    const nameForAudit=uid=>{const p=profiles.find(row=>String(row.id)===String(uid));return String(p?.username||'Unknown user');};
    $('peopleCreateFranchise').addEventListener('click',async e=>{
      const button=e.currentTarget;
      const franchiseName=$('peopleFranchiseName').value.trim();
      const conference=$('peopleFranchiseConference').value.trim();
      if(!franchiseName){status.textContent='Enter a franchise name.';$('peopleFranchiseName').focus();return;}
      button.disabled=true; button.textContent='Creating…'; status.textContent='Creating franchise…';
      try{
        await SBL.leagueDb.createFranchise(leagueId,franchiseName,conference,{},supabase);
        // Refresh only this league's franchise definitions. Do not reload
        // memberships, requests, season context or ownership after each create.
        franchises=await SBL.leagueDb.listFranchises(leagueId,supabase);
        const owners=new Map(assignments.map(a=>[String(a.franchise_id),String(a.user_id)]));
        $('peopleFranchises').innerHTML=franchises.length?franchises.map(f=>{
          const owner=owners.get(String(f.id)); const archived=String(f.status||'active')==='inactive'; const locked=String(f.claim_state||'')==='locked';
          return `<div class="people-row people-franchise-row"><div><strong>${SBL.pokemon.escapeHtml(f.name)}</strong><span class="note">${SBL.pokemon.escapeHtml(f.conference||'No conference')} · ${archived?'Archived':owner?`Assigned to ${SBL.pokemon.escapeHtml(nameForAudit(owner))}`:locked?'Locked':'Available'}</span></div><div class="people-actions"><button type="button" class="ghost small" data-people-edit-franchise="${SBL.pokemon.escapeHtml(f.id)}">Edit details</button>${archived?`<button class="ghost small" data-people-restore-franchise="${SBL.pokemon.escapeHtml(f.id)}">Restore</button>`:(!owner&&!locked?`<button class="ghost small danger-btn" data-people-archive-franchise="${SBL.pokemon.escapeHtml(f.id)}">Archive</button>`:'')}</div><div class="people-franchise-edit" data-people-franchise-form="${SBL.pokemon.escapeHtml(f.id)}" hidden><label>Franchise name<input type="text" data-people-franchise-name value="${SBL.pokemon.escapeHtml(f.name)}"></label><label>Conference<input type="text" data-people-franchise-conference value="${SBL.pokemon.escapeHtml(f.conference||'')}" maxlength="80" placeholder="Optional"></label><div class="people-actions"><button type="button" class="primary small" data-people-save-franchise="${SBL.pokemon.escapeHtml(f.id)}">Save changes</button><button type="button" class="ghost small" data-people-cancel-franchise="${SBL.pokemon.escapeHtml(f.id)}">Cancel</button></div></div></div>`;
        }).join(''):'<div class="empty-state">No franchise definitions yet.</div>';
        // Make the newly created franchise immediately available in the
        // existing assignment selectors without refreshing the whole workspace.
        const createdRow=franchises.find(f=>String(f.name).toLowerCase()===franchiseName.toLowerCase());
        if(createdRow){
          $('peopleMembers').querySelectorAll('[data-people-assign-select]').forEach(select=>{
            if(!Array.from(select.options).some(option=>String(option.value)===String(createdRow.id))){
              const option=document.createElement('option'); option.value=createdRow.id; option.textContent=createdRow.name; select.appendChild(option);
            }
          });
        }
        $('peopleFranchiseName').value=''; $('peopleFranchiseConference').value='';
        status.textContent=`Created ${franchiseName}. You can create another franchise immediately.`;
        await logAdminAction('admin_create_franchise',`Created franchise ${franchiseName}.`,{leagueId,name:franchiseName});
      }catch(error){status.textContent=error?.message||'Could not create franchise.';}
      finally{button.disabled=false;button.textContent='Create franchise';}
    });
    $('peopleFranchiseName').addEventListener('keydown',e=>{if(e.key==='Enter')$('peopleCreateFranchise').click();});
    $('peoplePending').addEventListener('click',e=>{
      const approve=e.target.closest('[data-people-approve]'); const reject=e.target.closest('[data-people-reject]'); const rejectClaim=e.target.closest('[data-people-reject-claim]');
      if(approve) run(approve,async()=>{await SBL.franchiseOwnership.approveMembershipAndAssign(leagueId,approve.dataset.peopleApprove,null,supabase);await logAdminAction('approve_league_membership',`Approved ${nameForAudit(approve.dataset.peopleApprove)}.`,{leagueId,userId:approve.dataset.peopleApprove});});
      if(reject) run(reject,async()=>{if(!confirm(`Reject the membership request from ${nameForAudit(reject.dataset.peopleReject)}?`))return;await SBL.franchiseOwnership.rejectLeagueMembership(leagueId,reject.dataset.peopleReject,supabase);await logAdminAction('reject_league_membership',`Rejected ${nameForAudit(reject.dataset.peopleReject)}.`,{leagueId,userId:reject.dataset.peopleReject});});
      if(rejectClaim) run(rejectClaim,async()=>{const uid=rejectClaim.dataset.peopleRejectClaim;if(!confirm(`Cancel ${nameForAudit(uid)}'s pending franchise claim? Their membership and account will remain.`))return;await SBL.franchiseOwnership.rejectFranchiseClaim(leagueId,uid,supabase);await logAdminAction('reject_franchise_claim',`Cancelled pending franchise claim for ${nameForAudit(uid)}.`,{leagueId,userId:uid});});
    });
    $('peopleMembers').addEventListener('change',e=>{
      const control=e.target.closest('[data-people-role]');
      if(!control)return;
      const uid=String(control.dataset.peopleRole||'');
      const member=(league?.members||[]).find(m=>String(m.userId||m.user_id)===uid);
      const nextRole=String(control.value||'player').toLowerCase();
      if(!member||!uid){actionStatus.textContent='Could not identify that league member.';return;}
      const previousRole=String(member.role||'player').toLowerCase();
      const previousType=String(member.member_type||'player').toLowerCase();
      if(nextRole===previousRole && nextRole!=='test_account' && previousType!=='test_account')return;
      control.disabled=true;
      void (async()=>{
        try{
          if(nextRole==='test_account'){
            const {error}=await supabase.rpc('sbl_set_league_member_type',{p_league_id:leagueId,p_user_id:uid,p_member_type:'test_account'});
            if(error)throw error;
            member.member_type='test_account';
            await logAdminAction('set_league_member_type',`Changed ${nameForAudit(uid)} to a test account.`,{leagueId,userId:uid,memberType:'test_account'});
            actionStatus.textContent=`${nameForAudit(uid)} is now classified as a test account in this league.`;
          }else{
            if(previousType==='test_account'){
              const {error:typeError}=await supabase.rpc('sbl_set_league_member_type',{p_league_id:leagueId,p_user_id:uid,p_member_type:'player'});
              if(typeError)throw typeError;
              member.member_type='player';
            }
            const {data,error}=await supabase.rpc('sbl_set_league_member_role',{target_league:leagueId,target_user:uid,new_role:nextRole});
            if(error)throw error;
            member.role=data?.role||nextRole;
            await logAdminAction('set_league_member_role',`Changed ${nameForAudit(uid)}'s league role to ${member.role}.`,{leagueId,userId:uid,role:member.role});
            actionStatus.textContent=`${nameForAudit(uid)} is now a ${member.role} in this league.`;
          }
          await refresh();
        }catch(error){control.value=previousType==='test_account'?'test_account':previousRole;control.disabled=false;actionStatus.textContent=error?.message||'Could not update league role.';}
      })();
    });
    $('peopleMembers').addEventListener('click',e=>{
      const sitout=e.target.closest('[data-people-sitout]'); const returning=e.target.closest('[data-people-return]');
      if(sitout) run(sitout,async()=>{const uid=sitout.dataset.peopleSitout;if(!confirm(`Mark ${nameForAudit(uid)} as sitting out for ${season.name}? Their account, active league membership and current franchise assignment remain intact. The franchise stays reserved for them when they return.`))return;await SBL.franchiseOwnership.setSeasonMemberStatus(leagueId,season.id,uid,'sitting_out',supabase);await logAdminAction('mark_member_sit_out',`Marked ${nameForAudit(uid)} as sitting out for ${season.name}.`,{leagueId,seasonId:season.id,userId:uid});});
      if(returning) run(returning,async()=>{const uid=returning.dataset.peopleReturn;await SBL.franchiseOwnership.setSeasonMemberStatus(leagueId,season.id,uid,'participating',supabase);await logAdminAction('mark_member_returning',`Marked ${nameForAudit(uid)} as returning for ${season.name}.`,{leagueId,seasonId:season.id,userId:uid});actionStatus.textContent=`${nameForAudit(uid)} is participating again. Their existing franchise assignment remains in place.`;});
    });
    $('peopleFranchises').addEventListener('click',e=>{
      const edit=e.target.closest('[data-people-edit-franchise]');
      const save=e.target.closest('[data-people-save-franchise]');
      const cancel=e.target.closest('[data-people-cancel-franchise]');
      const archive=e.target.closest('[data-people-archive-franchise]'); const restore=e.target.closest('[data-people-restore-franchise]');
      if(edit){
        const form=Array.from($('peopleFranchises').querySelectorAll('[data-people-franchise-form]')).find(node=>node.dataset.peopleFranchiseForm===edit.dataset.peopleEditFranchise);
        if(form) form.hidden=!form.hidden;
      }
      if(cancel){
        const form=Array.from($('peopleFranchises').querySelectorAll('[data-people-franchise-form]')).find(node=>node.dataset.peopleFranchiseForm===cancel.dataset.peopleCancelFranchise);
        if(form) form.hidden=true;
      }
      if(save) run(save,async()=>{
        const f=franchises.find(x=>String(x.id)===String(save.dataset.peopleSaveFranchise)); if(!f)return;
        const form=Array.from($('peopleFranchises').querySelectorAll('[data-people-franchise-form]')).find(node=>node.dataset.peopleFranchiseForm===save.dataset.peopleSaveFranchise);
        if(!form) throw new Error('The franchise editor could not be found. Refresh and try again.');
        const cleanedName=String(form.querySelector('[data-people-franchise-name]')?.value||'').trim();
        const nextConference=String(form.querySelector('[data-people-franchise-conference]')?.value||'').trim();
        if(!cleanedName) throw new Error('Franchise name cannot be blank.');
        if(nextConference.length>80) throw new Error('Conference must be 80 characters or fewer.');
        await SBL.leagueDb.updateFranchiseDefinition(leagueId,f.id,cleanedName,nextConference,supabase);
        await logAdminAction('edit_franchise_definition',`Updated franchise ${f.name} to ${cleanedName}${nextConference?` (${nextConference})`:''}.`,{leagueId,franchiseId:f.id,oldName:f.name,newName:cleanedName,conference:nextConference||null});
        actionStatus.textContent=`Updated ${cleanedName}.`;
      });
      if(archive) run(archive,async()=>{const f=franchises.find(x=>String(x.id)===String(archive.dataset.peopleArchiveFranchise));if(!f)return;if(!confirm(`Archive ${f.name}? It will disappear from active franchise choices but its definition and history will remain.`))return;await SBL.franchiseOwnership.archiveFranchise(leagueId,f.id,supabase);await logAdminAction('archive_franchise',`Archived franchise ${f.name}.`,{leagueId,franchiseId:f.id});});
      if(restore) run(restore,async()=>{const f=franchises.find(x=>String(x.id)===String(restore.dataset.peopleRestoreFranchise));if(!f)return;await SBL.franchiseOwnership.restoreFranchise(leagueId,f.id,supabase);await logAdminAction('restore_franchise',`Restored franchise ${f.name}.`,{leagueId,franchiseId:f.id});});
    });
    $('peopleResetOwnership').addEventListener('click',e=>run(e.currentTarget,async()=>{
      const preview=`This will vacate every active franchise assignment and cancel pending franchise claims for ${league?.name||'this league'}.\n\nIt will NOT delete accounts, profiles, league memberships, franchise definitions, season data, replays or history.\n\nContinue?`;
      if(!confirm(preview))return;
      const typed=prompt('Type RESET OWNERSHIP to confirm this league-wide reset.');if(typed!=='RESET OWNERSHIP')throw new Error('Reset cancelled. Confirmation text did not match.');
      const result=await SBL.franchiseOwnership.resetFranchiseMappings(leagueId,season.id,supabase);
      status.textContent=`Reset complete: ${Number(result?.assignments_vacated||0)} assignments vacated; ${Number(result?.requests_cancelled||0)} franchise requests cancelled. Accounts and memberships were preserved.`;
      await logAdminAction('reset_franchise_mappings','Reset franchise ownership mappings while preserving users and membership records.',{leagueId,seasonId:season.id,seasonName:season.name,result});
    }));
    await refresh();
  }

  function renderSettings(mode='franchises'){
    const showFranchises = mode === 'franchises';
    const showData = mode === 'data';
    const showSystem = mode === 'system';
    contentEl.innerHTML = `
      ${showFranchises ? `
      <div class="admin-section"><div class="admin-section-title"><div><h2>Franchises &amp; Users</h2><div class="note">Manage the mapping between Showdown usernames and league franchises, then clean up likely duplicates.</div></div></div>
      <div class="panel"><div class="admin-subsection"><h3>Showdown → franchise mapping</h3><div class="note">Map each Pokémon Showdown username to a franchise in the currently selected league. Replay imports use this mapping to attribute results to the correct SBL franchise.</div><div id="mapRows" style="margin-top:12px;"></div><div class="map-row"><input type="text" id="newUser" placeholder="Showdown username"><select id="newTeam"><option value="">Loading league franchises…</option></select><button class="ghost small" id="addMap">Add mapping</button></div></div></div>
      <div class="panel"><div class="admin-subsection"><h3>Duplicate users</h3><div class="note">Review usernames that look like the same person typed differently and merge them into the canonical mapping.</div><div id="dupPlayers" style="margin-top:12px;"></div></div></div>
      <div class="panel"><div class="admin-subsection"><h3>Duplicate franchises</h3><div class="note">Review likely duplicate team tags whose rosters overlap heavily and merge them under the established franchise name.</div><div id="dupTeams" style="margin-top:12px;"></div></div></div></div>` : ''}
      ${showSystem ? `
      <div class="admin-section"><div class="admin-section-title"><div><h2>System Settings</h2><div class="note">Small global behaviors that affect how admin data is grouped and interpreted.</div></div></div>
      <div class="panel"><div class="admin-subsection"><h3>Grouping behavior</h3><div class="note">These settings do not change stored replay data; they control how franchise names are grouped in the admin tools.</div><label style="display:flex;align-items:center;gap:8px;margin:0;cursor:pointer;"><input type="checkbox" id="caseInsensitiveToggle" ${STATE.settings.caseInsensitiveNames ? 'checked' : ''}> Ignore case when grouping team names</label></div></div></div>` : ''}
      ${showData ? `
      <div class="admin-section"><div class="admin-section-title"><div><h2>Data Management</h2><div class="note">Backup, restore, and maintenance tools for the shared league data.</div></div></div>
      <div class="panel"><div class="admin-subsection"><h3>Storage</h3><div class="note">Storage mode: <strong>Shared Supabase database</strong></div><div class="note">All replay, team, and settings data is stored in the shared database used by the public dashboard.</div></div><div class="admin-danger-section"><h3>Backup &amp; reset</h3><div class="foot-actions"><button class="ghost" id="exportBackup">Download backup (.json)</button><button class="ghost" id="importBackupBtn">Restore from backup</button><input type="file" id="importBackupFile" accept="application/json" style="display:none;"><button class="ghost danger-btn" id="resetAll">Clear all season data</button></div></div></div></div>` : ''}`;
    if(showFranchises){
    const mapRows = document.getElementById('mapRows');
    const selectedLeagueId=String(SBL.leagueDb?.selectedLeagueId?.()||'').trim();
    let mappingFranchises=[];
    const mappingFranchiseOptions=(selected='')=>mappingFranchises.map(f=>`<option value="${SBL.pokemon.escapeHtml(f.name)}" ${String(selected)===String(f.name)?'selected':''}>${SBL.pokemon.escapeHtml(f.name)}</option>`).join('');
    function drawMap(){
      const entries = Object.entries(STATE.teamMap);
      mapRows.innerHTML = entries.length===0 ? `<div class="empty-state">No mappings yet.</div>` :
        entries.map(([u,t])=>`
        <div class="map-row">
          <input type="text" value="${SBL.pokemon.escapeHtml(u)}" disabled>
          <select class="franchise-map-select" data-map-user="${SBL.pokemon.escapeHtml(u)}"><option value="">Unassigned</option>${mappingFranchiseOptions(t)}</select>
          <button class="ghost small danger-btn" data-del="${SBL.pokemon.escapeHtml(u)}">Remove</button>
        </div>`).join('');
      mapRows.querySelectorAll('[data-map-user]').forEach(select=>{
        select.addEventListener('change', async ()=>{
          const username = select.dataset.mapUser;
          const franchise = String(select.value || '').trim();
          if(!username) return;
          if(franchise) STATE.teamMap[username] = franchise;
          else delete STATE.teamMap[username];
          await saveTeamMap();
          await logAdminAction('set_player_mapping', `Mapped ${username} to franchise "${franchise || 'Unassigned'}".`, {username, franchise:franchise || null});
          renderTicker();
          render();
        });
      });
      mapRows.querySelectorAll('[data-del]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const removedTeam = STATE.teamMap[btn.dataset.del];
          delete STATE.teamMap[btn.dataset.del];
          await saveTeamMap();
          await logAdminAction('remove_player_mapping', `Removed player → team mapping for ${btn.dataset.del}.`, {username:btn.dataset.del, team:removedTeam || null});
          drawMap();
          render();
        });
      });
    }
    drawMap();
    (async()=>{
      try{
        mappingFranchises=await SBL.leagueDb.listFranchises(selectedLeagueId,supabase);
        const activeMappingFranchises=mappingFranchises.filter(f=>String(f.status||'active')==='active');
        mappingFranchises=activeMappingFranchises.map(f=>({name:f.name,conference:f.conference||''}));
        const addSelect=document.getElementById('newTeam');
        if(addSelect)addSelect.innerHTML='<option value="">Select franchise…</option>'+mappingFranchiseOptions();
        drawMap();
      }catch(error){
        const addSelect=document.getElementById('newTeam');
        if(addSelect)addSelect.innerHTML='<option value="">Could not load franchises</option>';
        mapRows.innerHTML=`<div class="empty-state">Could not load this league's franchise definitions: ${SBL.pokemon.escapeHtml(error?.message||error)}</div>`;
      }
    })();

    const dupPlayersEl = document.getElementById('dupPlayers');
    function drawDupPlayers(){
      const groups = findDuplicatePlayerGroups();
      dupPlayersEl.innerHTML = groups.length===0 ? `<div class="empty-state">No likely duplicates found.</div>` :
        groups.map((g,i)=>{
          const canonicalTeam = STATE.teamMap[g.canonical.toLowerCase()] || g.canonical;
          return `<div class="map-row" style="align-items:center;">
            <div style="flex:1;">
              ${g.usernames.map(u=>SBL.pokemon.escapeHtml(u)).join(' <span style="color:var(--text-dim)">≈</span> ')}
              <span class="badge">keep "${SBL.pokemon.escapeHtml(canonicalTeam)}"</span>
            </div>
            <button class="ghost small" data-merge-players="${i}">Merge</button>
          </div>`;
        }).join('');
      dupPlayersEl.querySelectorAll('[data-merge-players]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const g = groups[parseInt(btn.dataset.mergePlayers,10)];
          const canonicalTeam = STATE.teamMap[g.canonical.toLowerCase()] || g.canonical;
          mergePlayerGroup(g.usernames, canonicalTeam);
          await saveTeamMap();
          await logAdminAction('merge_duplicate_players', `Merged ${g.usernames.length} player-name variants under "${canonicalTeam}".`, {usernames:g.usernames, canonicalTeam});
          drawMap();
          drawDupPlayers();
          render();
        });
      });
    }
    drawDupPlayers();

    const dupTeamsEl = document.getElementById('dupTeams');
    function drawDupTeams(){
      const pairs = findDuplicateTeamPairs();
      dupTeamsEl.innerHTML = pairs.length===0 ? `<div class="empty-state">No likely duplicates found.</div>` :
        pairs.map((p,i)=>`<div class="map-row" style="align-items:center;">
            <div style="flex:1;">
              ${SBL.pokemon.escapeHtml(p.smaller)} <span style="color:var(--text-dim)">≈</span> ${SBL.pokemon.escapeHtml(p.bigger)}
              <span class="badge">${p.overlap} shared mons</span>
              <span class="badge">keep "${SBL.pokemon.escapeHtml(p.bigger)}" (${p.biggerGames} appearances vs ${p.smallerGames})</span>
            </div>
            <button class="ghost small" data-merge-teams="${i}">Merge</button>
          </div>`).join('');
      dupTeamsEl.querySelectorAll('[data-merge-teams]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const p = pairs[parseInt(btn.dataset.mergeTeams,10)];
          const usernames = [...usernamesForTeamLabel(p.bigger), ...usernamesForTeamLabel(p.smaller)];
          mergePlayerGroup(usernames, p.bigger);
          await saveTeamMap();
          await logAdminAction('merge_duplicate_teams', `Merged duplicate team mappings into "${p.bigger}".`, {smaller:p.smaller, bigger:p.bigger, overlap:p.overlap, usernames});          
          drawMap();
          drawDupPlayers();
          drawDupTeams();
          render();
        });
      });
    }
    drawDupTeams();

    document.getElementById('addMap')?.addEventListener('click', async ()=>{
      const rawUser = document.getElementById('newUser').value.trim();
      const u = rawUser.toLowerCase();
      const t = document.getElementById('newTeam').value.trim();
      if(!u || !t){showAdminError('Enter a Showdown username and select a league franchise.');return;}
      if(!mappingFranchises.some(f=>String(f.name)===t)){showAdminError('Choose a franchise from the selected league.');return;}
      STATE.teamMap[u] = t;
      await saveTeamMap();
      await logAdminAction('add_player_mapping', `Mapped ${rawUser} to team "${t}".`, {username:rawUser, team:t});
      document.getElementById('newUser').value='';
      document.getElementById('newTeam').value='';
      drawMap();
    });
    }
    if(showSystem){
      document.getElementById('caseInsensitiveToggle')?.addEventListener('change', async (e)=>{
        STATE.settings.caseInsensitiveNames = e.target.checked;
        await saveSettings();
        await logAdminAction('set_case_insensitive_names', `Case-insensitive team grouping ${e.target.checked ? 'enabled' : 'disabled'}.`, {enabled:e.target.checked});
      });
    }
    if(showData){
      document.getElementById('resetAll')?.addEventListener('click', async ()=>{
        if(!confirm('This clears every processed replay for the whole league. Continue?')) return;
        STATE.replays = {}; await deleteAllRemote(); await saveSharedState();
        await logAdminAction('clear_all_season_data', 'Cleared all processed replay data for the current season.', {season:STATE.settings.activeSeason || DEFAULT_SEASON});
        renderTicker(); render();
      });
      document.getElementById('exportBackup')?.addEventListener('click', ()=>{
        const blob = new Blob([JSON.stringify(STATE, null, 2)], {type:'application/json'});
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
        link.download = `league-dashboard-backup-${new Date().toISOString().slice(0,10)}.json`; link.click();
      });
      document.getElementById('importBackupBtn')?.addEventListener('click', ()=>document.getElementById('importBackupFile')?.click());
      document.getElementById('importBackupFile')?.addEventListener('change', async (e)=>{
        const file=e.target.files[0]; if(!file) return;
        try{
          const text=await file.text(); const data=JSON.parse(text); if(!data.replays) throw new Error('not a valid backup file');
          if(!confirm(`This will replace your current data with the backup (${Object.keys(data.replays).length} replays). Continue?`)) return;
          STATE.replays=data.replays||{}; STATE.teamMap=data.teamMap||{}; STATE.settings=Object.assign({caseInsensitiveNames:true,rosters:{}},data.settings||{});
          STATE.settings.rosters=STATE.settings.rosters||{}; STATE.settings.draft=normalizeDraftState(STATE.settings.draft);
          await deleteRemoteRowsNotInState(); await saveReplays(); await saveTeamMap(); await saveSettings();
          await logAdminAction('restore_backup', `Restored dashboard state from backup with ${Object.keys(STATE.replays).length} replays.`, {replayCount:Object.keys(STATE.replays).length});
          renderTicker(); render();
        }catch(err){ alert('Could not read that backup file: ' + err.message); }
        e.target.value='';
      });
    }
  }
  // ---------- Fixture upload controller ----------
  // This controller is deliberately self-contained.  The upload button must
  // not depend on Season Setup's other controls or on the fixture generator.
  async function handleFixtureUploadClick(event){
    const button = event?.target?.closest ? event.target.closest('#uploadFixtureBtn') : document.getElementById('uploadFixtureBtn');
    if(!button) return;
    const input = document.getElementById('fixtureFile');
    const status = document.getElementById('fixtureStatus');
    const file = input?.files?.[0];
    if(!file){
      if(status) status.innerHTML = '<div class="note danger">Choose a fixture file first.</div>';
      input?.focus();
      return;
    }

    const setStatus = (html) => { if(status) status.innerHTML = html; };
    const originalText = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy','true');
    setStatus(`<div class="note">Reading <strong>${SBL.pokemon.escapeHtml(file.name)}</strong>…</div>`);

    try{
      if(typeof XLSX === 'undefined') throw new Error('The spreadsheet reader has not loaded. Refresh the page and try again.');

      const buffer = await file.arrayBuffer();
      setStatus('<div class="note">Parsing fixture workbook…</div>');
      const wb = XLSX.read(buffer, {type:'array', cellDates:false});
      const parsed = parseFixtureWorkbook(wb);
      if(!parsed || !Array.isArray(parsed.rounds) || !parsed.rounds.length){
        throw new Error('No fixture weeks or matches were found in the workbook.');
      }

      // Reconcile again immediately before validation.  This means the upload
      // remains compatible with the established Player → Team mapping even if
      // Season Setup was re-rendered after the file was selected.
      const reconciled = reconcileParsedFixture(parsed);
      const conferenceMap = {};
      activeMemberConfiguredFranchises().forEach(f => { conferenceMap[f.name] = f.conference; });
      const hasConferenceAssignments = Object.keys(conferenceMap).length > 0 && Object.values(conferenceMap).some(Boolean);

      setStatus(`<div class="note">Validating ${reconciled.rounds.length} week${reconciled.rounds.length===1?'':'s'}…</div>`);

      // Structural validation always applies. Conference validation applies
      // when the league has conference assignments; this keeps upload useful
      // during setup while preventing a bad fixture from reaching production.
      const structuralIssues = validateFixtureStructure(reconciled.rounds);
      if(structuralIssues.length) throw new Error(structuralIssues.slice(0,8).join(' '));

      if(hasConferenceAssignments){
        const issues = validateFixture({rounds:reconciled.rounds}, conferenceMap, fixtureRules());
        if(issues.length) throw new Error(`Fixture validation failed: ${issues.slice(0,8).join(' ')}`);
      }

      const matchCount = reconciled.rounds.reduce((n,r)=>n+(r.matches||[]).length,0);
      if(matchCount < 1) throw new Error('The workbook contained no valid Home vs Away matches.');

      const confirmed = STATE.settings.fixtureDraft
        ? confirm(`Replace the unpublished fixture draft with ${reconciled.rounds.length} weeks / ${matchCount} matches from “${file.name}”?`)
        : true;
      if(!confirmed){
        setStatus('<div class="note">Upload cancelled. The existing draft and published fixture were not changed.</div>');
        return;
      }

      setStatus(`<div class="note">Saving ${matchCount} matches as an unpublished draft…</div>`);
      const fixture = {
        rounds: reconciled.rounds.map((r,i)=>({
          week: normalizeFixtureWeek(r.week, i+1),
          matches: (r.matches||[]).map(m=>({home:String(m.home).trim(), away:String(m.away).trim()}))
        })),
        source:'upload',
        generatedAt:new Date().toISOString()
      };

      // Atomic application: only mutate STATE after parsing + validation pass.
      await saveFixture(fixture, 'upload', 'fixtureDraft');
      await logAdminAction('upload_fixture_draft', `Uploaded fixture draft with ${fixture.rounds.length} weeks / ${matchCount} matches from ${file.name}.`, {
        weeks:fixture.rounds.length, matches:matchCount, file:file.name, corrections:reconciled.corrections||[]
      });

      setStatus(`<div class="note"><strong>Fixture draft uploaded. ✓</strong> ${fixture.rounds.length} weeks / ${matchCount} matches imported. It is not public until you publish it.${reconciled.corrected ? ` Corrected ${reconciled.corrected} franchise name${reconciled.corrected===1?'':'s'} to match the current mapping.` : ''}</div>`);
      window.drawFixtureSummary?.();
    }catch(err){
      console.error('[SBL] Fixture upload failed:', err);
      setStatus(`<div class="note danger"><strong>Fixture upload failed.</strong> ${SBL.pokemon.escapeHtml(err?.message || String(err))}</div>`);
    }finally{
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = originalText;
    }
  }

  function normalizeFixtureWeek(value, fallback){
    const text = String(value ?? '').trim();
    const n = parseInt((text.match(/\d+/)||[])[0],10);
    return Number.isFinite(n) && n > 0 ? `Week ${n}` : `Week ${fallback}`;
  }

  function validateFixtureStructure(rounds){
    const issues=[];
    const seenWeeks=new Set();
    const knownPairs=new Set();
    (rounds||[]).forEach((r,idx)=>{
      const week=normalizeFixtureWeek(r.week,idx+1);
      const weekNum=parseInt(week.match(/\d+/)?.[0]||idx+1,10);
      if(seenWeeks.has(week)) issues.push(`Duplicate ${week} block.`);
      seenWeeks.add(week);
      const used=new Set();
      const matches=Array.isArray(r.matches)?r.matches:[];
      if(!matches.length) issues.push(`${week} contains no matches.`);
      matches.forEach(m=>{
        const home=String(m.home||'').trim(), away=String(m.away||'').trim();
        if(!home||!away){ issues.push(`${week} contains an incomplete match.`); return; }
        const h=home.toLowerCase(), a=away.toLowerCase();
        if(h===a) issues.push(`${week}: ${home} cannot play itself.`);
        if(used.has(h)) issues.push(`${week}: ${home} is scheduled more than once.`);
        if(used.has(a)) issues.push(`${week}: ${away} is scheduled more than once.`);
        used.add(h); used.add(a);
        const pair=pairKey(home,away);
        const globalPair=`${weekNum}::${pair}`;
        if(knownPairs.has(globalPair)) issues.push(`${week}: duplicate matchup ${home} vs ${away}.`);
        knownPairs.add(globalPair);
      });
    });
    return issues;
  }

  // The upload button is delegated so Season Setup re-renders cannot orphan it.
  document.addEventListener('click', (event)=>{
    const button = event.target.closest('#uploadFixtureBtn');
    if(!button) return;
    event.preventDefault();
    event.stopPropagation();
    handleFixtureUploadClick(event);
  }, true);

  document.addEventListener('change', (event)=>{
    const input=event.target.closest('#fixtureFile');
    if(!input) return;
    const status=document.getElementById('fixtureStatus');
    const file=input.files?.[0];
    if(status) status.innerHTML=file
      ? `<div class="note">Ready to upload <strong>${SBL.pokemon.escapeHtml(file.name)}</strong>. Click <strong>Upload &amp; replace fixture</strong>.</div>`
      : '';
  }, true);

  // ---------- init ----------
  document.addEventListener('click', (e)=>{
    const cell = e.target.closest('[data-audit]');
    if(!cell) return;
    try{
      const {species, type, list, showLink} = JSON.parse(cell.dataset.audit);
      openAudit(species, type, list, showLink);
    }catch(err){ /* malformed payload, ignore */ }
  });
  (async function init(){
    try{
      const authenticated = await initAdminAuth();
      if(!authenticated) return;
      await loadState();
      try{await loadActiveMemberFranchiseList();}catch(error){console.warn('Active-member franchise list unavailable:',error);ACTIVE_MEMBER_FRANCHISES=[];ACTIVE_LEAGUE_FRANCHISES=[];ACTIVE_SEASON_SITOUT_USERS=new Set();ACTIVE_MEMBER_FRANCHISES_LOADED=true;}
      renderTicker();
      render();
    }catch(e){
      console.error(e);
      showAdminError('Admin initialization failed: ' + e.message);
    }
  })();

})();

document.addEventListener('DOMContentLoaded', function(){
  // Start with every navigation category collapsed.
  document.querySelectorAll('[aria-expanded="true"]').forEach(function(el){
    var label=(el.textContent||'').trim();
    if (/Replay Management|League Operations|Administration/.test(label)) {
      el.setAttribute('aria-expanded','false');
    }
  });
  document.querySelectorAll('.nav-group.open, .admin-nav-group.open, .ops-group.open, .navigation-group.open').forEach(function(el){
    el.classList.remove('open');
  });
  document.querySelectorAll('.nav-group.active, .admin-nav-group.active').forEach(function(el){
    el.classList.remove('active');
  });
});
