/*
 * SBL STATS PAGE
 *
 * Page controller extracted from stats.html during Phase 6G refactor.
 * This is a mechanical extraction: runtime behavior is intentionally unchanged.
 */
(function(){
  const SHARED = true; // league data shared with anyone viewing this dashboard (cloud mode only)
  const escapeHtml = (...args) => window.SBL.pokemon.escapeHtml(...args);

  function battleLabel(replayId, fallback = 'Battle') {
    const id = String(replayId || '');
    const r = STATE?.replays?.[id];
    if (r?.players?.p1 || r?.players?.p2) {
      const p1 = teamFor(r.players.p1) || r.players.p1 || 'P1';
      const p2 = teamFor(r.players.p2) || r.players.p2 || 'P2';
      return `${p1} vs ${p2}`;
    }
    if (r?.team1 || r?.team2) return `${r.team1 || 'P1'} vs ${r.team2 || 'P2'}`;
    return fallback;
  }

  let STATE = { replays:{}, teamMap:{}, settings:{ caseInsensitiveNames:true, teamLogos:{}, bannerMode:'top', bannerTeam:'', rosters:{}, conferences:{} } };
  let PUBLISHED_ROSTERS = {};
  let loaded = false;
  let pokemonSearchCache = null;
  let pokemonSearchCachePromise = null;

  // ---------- shared Supabase storage ----------
  // Public dashboard: read-only. Admin page: authenticated writes.
  const SUPABASE_STATE_ID = '__dashboard_state__';
  const supabase = window.SBL.getSupabase();
  const IS_ADMIN_PAGE = document.body.dataset.admin === 'true';
  const POLL_MS = 10000;
  let adminUser = null;
  let loadingFromRemote = false;

  function requireAdmin(){
    if(!IS_ADMIN_PAGE || !adminUser) throw new Error('Admin login required to change shared data.');
  }

  async function loadState(){
    loadingFromRemote = true;
    try{
      const { data, error } = await SBL.replays.load(supabase);
      if(error) throw error;
      const { sharedState, replays, publishedRosters } = SBL.replays.partition(data);
      const snap=SBL.seasons.getSnapshot(sharedState || {});
      const titleEl=document.getElementById('seasonTitle'); if(titleEl) titleEl.textContent=`SBL ${snap.name}: National Dex Draft`;
      STATE.replays = snap.archived ? snap.replays : replays;
      STATE.teamMap = snap.teamMap || {};
      STATE.settings = Object.assign({caseInsensitiveNames:true, teamLogos:{}, bannerMode:'top', bannerTeam:'', rosters:{}}, snap.settings || {});

      // The Rosters page treats __dashboard_state__.settings.rosters as the
      // primary published roster, with __rosters__ as the compatibility fallback.
      // Keep that exact roster in a dedicated variable so Franchise Stats does
      // not accidentally depend on replay-derived team data.
      const dashboardRosters = (STATE.settings.rosters && typeof STATE.settings.rosters === 'object')
        ? STATE.settings.rosters : {};
      PUBLISHED_ROSTERS = Object.keys(dashboardRosters).length
        ? dashboardRosters
        : (publishedRosters && typeof publishedRosters === 'object' ? publishedRosters : {});
      if(!snap.archived){
        const {data:tradeRows} = await SBL.trades.load(supabase);
        PUBLISHED_ROSTERS = SBL.trades.getEffectiveRosters(PUBLISHED_ROSTERS, tradeRows || []);
      }
      STATE.settings.rosters = PUBLISHED_ROSTERS;
      STATE.settings.teamLogos = STATE.settings.teamLogos || {};
      const bp=JSON.parse(localStorage.getItem('sbl-banner-preferences')||'null'); if(bp){ STATE.settings.bannerMode=bp.bannerMode||STATE.settings.bannerMode; STATE.settings.bannerTeam=bp.bannerTeam||STATE.settings.bannerTeam; }
      loaded = true;
    }catch(e){
      console.error('Supabase load failed:', e);
      if(!loaded){
        STATE.replays = {};
        STATE.teamMap = {};
        STATE.settings = {caseInsensitiveNames:true, teamLogos:{}, bannerMode:'top', bannerTeam:'', rosters:{}, conferences:{}};
        loaded = true;
      }
      if(IS_ADMIN_PAGE) showAdminError('Could not load shared data: ' + e.message);
      else {
        const el=document.getElementById('content');
        if(el) el.innerHTML=`<div class="panel"><div class="empty-state"><strong>Could not load shared dashboard data.</strong><br>${SBL.pokemon.escapeHtml(e.message||e)}</div></div>`;
      }
    }finally{
      loadingFromRemote = false;
    }
  }

  async function saveReplays(){
     requireAdmin();
     const rows = Object.values(STATE.replays).map(r => ({
       replay_id: r.id,
       replay_data: r,
       updated_at: new Date().toISOString()
     }));
     const existing = await SBL.replays.listIds(supabase);
     const stale = (existing || []).map(r=>r.replay_id).filter(id => id !== SUPABASE_STATE_ID && !STATE.replays[id]);
     if(stale.length) await SBL.replays.deleteIds(stale, supabase);
     if(rows.length) await SBL.replays.upsertRows(rows, supabase);
     await saveSharedState();
   }

  async function saveSharedState(){
     requireAdmin();
     await SBL.replays.saveSharedState({teamMap:STATE.teamMap, settings:STATE.settings}, supabase);
   }
  async function saveTeamMap(){ await saveSharedState(); }
  async function saveSettings(){ await saveSharedState(); }

  async function deleteAllRemote(){
     requireAdmin();
     await SBL.replays.deleteAllExcept([SUPABASE_STATE_ID], supabase);
   }

  async function migrateLocalData(){
    requireAdmin();
    const rawR = localStorage.getItem('league-dash:replays-data');
    const rawM = localStorage.getItem('league-dash:player-team-map');
    const rawS = localStorage.getItem('league-dash:settings');
    if(!rawR && !rawM && !rawS) throw new Error('No old local dashboard data was found in this browser.');
    if(rawR) STATE.replays = JSON.parse(rawR);
    if(rawM) STATE.teamMap = JSON.parse(rawM);
    if(rawS) STATE.settings = Object.assign({caseInsensitiveNames:true, teamLogos:{}, bannerMode:'top', bannerTeam:''}, JSON.parse(rawS));
    STATE.settings.teamLogos = STATE.settings.teamLogos || {};
    await saveReplays();
    await saveSharedState();
  }

  function replayDataSignature(replays){
    return Object.values(replays || {}).map(r => [
      r?.id || '',
      r?.processedAt || 0,
      r?.parserVersion || 0,
      r?.mons ? Object.values(r.mons).reduce((sum,m) =>
        sum + (Number(m?.directDamage)||0) + (Number(m?.indirectDamage)||0) +
        (Number(m?.kills)||0) + (Number(m?.deaths)||0) + (Number(m?.assists)||0), 0) : 0
    ].join(':')).sort().join('|');
  }

  async function refreshSharedState(){
    if(loadingFromRemote) return;
    const before = JSON.stringify({
      r: replayDataSignature(STATE.replays),
      t: STATE.teamMap,
      s: STATE.settings
    });
    await loadState();
    pokemonSearchCache = null;
    pokemonSearchCachePromise = null;
    const after = JSON.stringify({
      r: replayDataSignature(STATE.replays),
      t: STATE.teamMap,
      s: STATE.settings
    });
    if(before !== after){
      renderTicker();
      render();
    }
  }

  function showAdminError(msg){
    const el = document.getElementById('adminError');
    if(el){ el.textContent = msg; el.style.display = 'block'; }
  }

  function showAdminLogin(){
    // Not logged in (or no assigned team) — bounce to the login page instead of
    // rendering an inline form here. Every page other than index.html requires
    // an authenticated session with a claimed team before it will show content.
    location.replace('index.html');
  }

  async function initAdminAuth(){
    // Stats requires an authenticated Supabase session, but it must not require
    // a team/profile lookup just to render the dashboard. The login page is the
    // place where team assignment is handled.
    const {data, error} = await supabase.auth.getSession();
    if(error || !data?.session){
      showAdminLogin();
      return false;
    }
    adminUser = data.session.user;
    const app = document.getElementById('app');
    if(app) app.style.display = '';
    return true;
  }

  // ---------- helpers ----------
  function normName(n){
    const raw=String(n??'').trim().toLowerCase().replace(/-/g,' ').replace(/_/g,' ').replace(/\s+/g,' ');
    if(raw.replace(/\s+/g,'')==='yefmoc') return 'comfey';
    return raw;
  }
  // Statistics identity MUST preserve battle forms. The old normName() is a
  // display/search normalizer and is not safe as the primary key for stats.
  // Use the shared stats service so Deoxys-Speed, Thundurus-Incarnate, etc.
  // remain separate records.
  function statIdentity(n){
    if(window.SBL?.stats?.identity) return window.SBL.stats.identity(n);
    let id=String(n??'').trim().toLowerCase().replace(/[’']/g,'').replace(/[♀]/g,'-f').replace(/[♂]/g,'-m').replace(/[.:]/g,'').replace(/_/g,'-').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
    id=id.replace(/-(forme|form|style)$/,'');
    const typo={scovilalian:'scovillain',scovillian:'scovillain',scovilion:'scovillain'};
    return typo[id]||id;
  }
    // Pokémon typing is loaded from Showdown's public Pokédex and cached locally.
  // This keeps the dashboard data-driven while avoiding a huge hard-coded type table.
  let POKEDEX_TYPES = {};
  function dexKey(species){
    return String(species||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  }
  function pokemonTypes(species){
    const d = POKEDEX_TYPES[dexKey(species)];
    return d?.types || [];
  }
  const TYPE_CLASS = {Normal:'normal',Fire:'fire',Water:'water',Electric:'electric',Grass:'grass',Ice:'ice',Fighting:'fighting',Poison:'poison',Ground:'ground',Flying:'flying',Psychic:'psychic',Bug:'bug',Rock:'rock',Ghost:'ghost',Dragon:'dragon',Dark:'dark',Steel:'steel',Fairy:'fairy'};
  function typeBadges(species){
    const types = pokemonTypes(species);
    if(!types.length) return '';
    return `<span class="type-badges">${types.map(t=>`<span class="type-badge type-${TYPE_CLASS[t]||'other'}">${SBL.pokemon.escapeHtml(t)}</span>`).join('')}</span>`;
  }
  function pokemonLink(species, innerHtml, title, showType=true){
    const safe = SBL.pokemon.escapeHtml(species);
    return `<span class="pokemon-click" role="button" tabindex="0" data-pokemon="${safe}" title="${SBL.pokemon.escapeHtml(title || `Open ${species} profile`)}">${innerHtml}${showType ? typeBadges(species) : ''}</span>`;
  }
  function pokemonName(species, withSprite=true, spriteClass='sprite'){
    return pokemonLink(species, withSprite ? `${SBL.pokemon.spriteMarkup(species,spriteClass)}<span>${SBL.pokemon.escapeHtml(species)}</span>` : `<span>${SBL.pokemon.escapeHtml(species)}</span>`);
  }
  function teamFor(username){
    const key = (username||'').trim().toLowerCase();
    return STATE.teamMap[key] || (username||'').trim() || 'Unknown';
  }
  // groups values that only differ by case/whitespace under one canonical label
  // (the first-seen casing) when "case-insensitive names" is on in Settings —
  // this is what keeps e.g. "Team Fire" and "team fire" from splitting into
  // two separate teams just because they were typed differently at different times.
  function groupKey(value){
    return STATE.settings.caseInsensitiveNames ? String(value||'').trim().toLowerCase() : String(value||'').trim();
  }
  function rosterTeamKey(value){ return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]/g,''); }
  function sameRosterTeam(a,b){ return rosterTeamKey(a)===rosterTeamKey(b); }
  function rosterMonName(mon){
    if(typeof mon==='string') return mon.trim();
    if(mon && typeof mon==='object') return String(mon.name ?? mon.species ?? mon.pokemon ?? '').trim();
    return String(mon??'').trim();
  }
  function canonicalRosterSpecies(mon){ const s=rosterMonName(mon); return normName(s)==='comfey'?'Comfey':s; }
  
  // ---------- processing ----------
  // Automatic season week assignment: weeks run Monday -> Sunday.
  // Week 1 begins on the Monday of the earliest replay in the season.
  // Manual overrides (weekOverride === true) are never touched by this logic.
  function replayTimestampMs(replay){
    const n=Number(replay?.uploadtime||0);
    if(!n) return 0;
    return n < 1e12 ? n*1000 : n;
  }
  function mondayStartMs(ms){
    const d=new Date(ms);
    const day=d.getDay();
    const diff=(day===0?-6:1-day);
    d.setHours(0,0,0,0); d.setDate(d.getDate()+diff);
    return d.getTime();
  }
  function ensureSeasonStart(){
    if(STATE.settings.seasonStartMonday) return Number(STATE.settings.seasonStartMonday);
    const times=Object.values(STATE.replays).map(replayTimestampMs).filter(Boolean);
    if(!times.length) return null;
    const start=mondayStartMs(Math.min(...times));
    STATE.settings.seasonStartMonday=start;
    return start;
  }
  function autoWeekForReplay(replay){
    const ts=replayTimestampMs(replay);
    if(!ts) return 'Unassigned';
    let start=ensureSeasonStart();
    if(!start || mondayStartMs(ts)<start){ start=mondayStartMs(ts); STATE.settings.seasonStartMonday=start; }
    const n=Math.floor((mondayStartMs(ts)-start)/604800000)+1;
    return `Week ${n}`;
  }
  function recalculateAllWeeks(){
    const times=Object.values(STATE.replays).map(replayTimestampMs).filter(Boolean);
    if(!times.length) return;
    STATE.settings.seasonStartMonday=mondayStartMs(Math.min(...times));
    for(const r of Object.values(STATE.replays)) r.week=autoWeekForReplay(r);
  }

  async function processUrls(urlsRaw, week, logEl){
    await SBL.replays.ensureMoveAccuracyData();
    const urls = urlsRaw.split('\n').map(s=>s.trim()).filter(Boolean);
    if(urls.length === 0){ appendLog(logEl, 'No links provided.', true); return; }
    let added = 0, skipped = 0, failed = 0;
    for(const url of urls){
      const id = SBL.util.extractReplayId(url);
      if(!id){ appendLog(logEl, `Could not read a replay id from: ${url}`, true); failed++; continue; }
      if(STATE.replays[id]){ appendLog(logEl, `Already processed: ${id} — skipped`, false); skipped++; continue; }
      try{
        const resp = await fetch(`https://replay.pokemonshowdown.com/${id}.json`);
        if(!resp.ok) throw new Error('replay not found (' + resp.status + ')');
        const json = await resp.json();
        const parsed = SBL.replays.parseLog(json, id);
        parsed.week = autoWeekForReplay(parsed);
        parsed.processedAt = Date.now();
        STATE.replays[id] = parsed;
        appendLog(logEl, `✓ ${id}  (${parsed.players.p1 || '?'} vs ${parsed.players.p2 || '?'})`, false, true);
        added++;
      }catch(e){
        appendLog(logEl, `✗ ${id} — ${e.message}`, true);
        failed++;
      }
    }
    if(added > 0){ recalculateAllWeeks(); await saveReplays(); }
    appendLog(logEl, `Done. ${added} added, ${skipped} already had, ${failed} failed.`, false);
    renderTicker();
    render(); // refresh whatever tab is open
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
  function weekSort(a,b){
    const sa=String(a??''), sb=String(b??'');
    const na=parseInt(sa.match(/\d+/)?.[0]||'',10);
    const nb=parseInt(sb.match(/\d+/)?.[0]||'',10);
    const aNum=Number.isFinite(na), bNum=Number.isFinite(nb);
    if(aNum && bNum && na!==nb) return na-nb;
    if(aNum!==bNum) return aNum ? -1 : 1;
    if(sa==='Unassigned') return 1;
    if(sb==='Unassigned') return -1;
    return sa.localeCompare(sb,undefined,{numeric:true,sensitivity:'base'});
  }
  function weeksList(){
    const set = new Set(Object.values(STATE.replays).map(r=>r.week || 'Unassigned'));
    return Array.from(set).sort(weekSort);
  }
  function globalPokemonStats(weekFilter){
    // One canonical aggregation path. This preserves form identity and keeps
    // the leaderboard, search, profile cards and audit counts in agreement.
    return SBL.stats.pokemon(allReplays(weekFilter), {teamFor});
  }

  // Precompute the expensive all-Pokémon aggregation after the first dashboard
  // paint. The search tab can therefore open its controls immediately instead of
  // blocking the click while every replay is re-aggregated synchronously.
  function preparePokemonSearchCache(){
    if(pokemonSearchCache) return Promise.resolve(pokemonSearchCache);
    if(pokemonSearchCachePromise) return pokemonSearchCachePromise;
    pokemonSearchCachePromise=new Promise(resolve=>{
      const run=()=>{
        try{
          const replays=allReplays('ALL');
          const asyncBuild=typeof SBL.stats.pokemonAsync==='function'
            ? SBL.stats.pokemonAsync(replays,{teamFor},10)
            : Promise.resolve(globalPokemonStats('ALL'));
          asyncBuild.then(rows=>{
            pokemonSearchCache=rows||[];
            pokemonSearchCachePromise=null;
            resolve(pokemonSearchCache);
            if(activeTab==='pokemonsearch') window.__SBL_POKEMON_SEARCH_REFRESH?.();
          }).catch(err=>{
            console.warn('Pokémon search cache build failed:',err);
            pokemonSearchCache=[]; pokemonSearchCachePromise=null; resolve(pokemonSearchCache);
            if(activeTab==='pokemonsearch') window.__SBL_POKEMON_SEARCH_REFRESH?.();
          });
          return;
        }catch(err){
          console.warn('Pokémon search cache build failed:',err);
          pokemonSearchCache=[];
        }
        pokemonSearchCachePromise=null;
        resolve(pokemonSearchCache);
        if(activeTab==='pokemonsearch') window.__SBL_POKEMON_SEARCH_REFRESH?.();
      };
      if('requestIdleCallback' in window) window.requestIdleCallback(run,{timeout:1200});
      else setTimeout(run,0);
    });
    return pokemonSearchCachePromise;
  }

  // Roster uploads have existed in both array form and wrapped/object form.
  // Normalize them here so Franchise Stats never dies on a published roster
  // object such as { pokemon:[...] } or { roster:[...] }.
  function rosterEntries(roster){
    if(Array.isArray(roster)) return roster;
    if(roster && typeof roster==='object'){
      for(const key of ['pokemon','roster','mons','members','entries']){
        if(Array.isArray(roster[key])) return roster[key];
      }
      // Last-resort support for an object keyed by Pokemon name.
      const vals=Object.values(roster);
      if(vals.length && vals.every(v=>typeof v==='string' || (v && typeof v==='object'))) return vals;
    }
    return [];
  }
  function rosterForTeam(team){
    const rosters=STATE.settings?.rosters||{};
    const key=Object.keys(rosters).find(k=>sameRosterTeam(k,team));
    return key ? rosterEntries(rosters[key]) : [];
  }
  function currentRosterTeamForPokemon(species){
    const target=statIdentity(species);
    if(!target) return '';
    const rosters=STATE.settings?.rosters||{};
    for(const team of Object.keys(rosters)){
      const mons=rosterEntries(rosters[team]);
      if(mons.some(mon=>statIdentity(canonicalRosterSpecies(mon))===target)) return team;
    }
    return '';
  }
  function isCurrentRosterPokemon(team,species){
    const r=rosterForTeam(team);
    return !r.length || r.some(x=>statIdentity(canonicalRosterSpecies(x))===statIdentity(species));
  }

  // ---------- Franchise Stats: completely roster-driven ----------
  // The published roster is the ONLY source of truth for franchise membership.
  // Replay records are used only to fill statistics for Pokemon that are already
  // on that published roster. This prevents traded/released/old replay Pokemon
  // from leaking into the current franchise display.
  function franchiseRosterData(weekFilter='ALL'){
    const raw = (PUBLISHED_ROSTERS && Object.keys(PUBLISHED_ROSTERS).length)
      ? PUBLISHED_ROSTERS
      : (STATE.settings?.rosters || {});
    const result = {};

    // Build the complete current roster first, including zero-game Pokemon.
    for(const [teamName, rawRoster] of Object.entries(raw || {})){
      if(!String(teamName).trim()) continue;
      const roster = rosterEntries(rawRoster);
      const team = {
        name:String(teamName),
        roster:[],
        byKey:{},
        total:{dealt:0,taken:0,kills:0,deaths:0,assists:0,appearances:0},
        linkedPlayers:new Set(),
        replayCount:0
      };

      for(const item of roster){
        const species = canonicalRosterSpecies(item);
        const key = statIdentity(species);
        if(!key || team.byKey[key]) continue;
        const points = item && typeof item==='object'
          ? (item.points ?? item.cost ?? item.price ?? null)
          : null;
        const stat = {
          species,
          points,
          dealt:0,
          taken:0,
          kills:0,
          deaths:0,
          assists:0,
          appearances:0,
          killLog:[],
          deathLog:[],
          assistLog:[]
        };
        team.byKey[key]=stat;
        team.roster.push(stat);
      }
      result[team.name]=team;
    }

    // Fill the roster entries from replay data. A replay can contribute only if
    // the player is explicitly mapped to this franchise.
    for(const replay of allReplays(weekFilter)){
      if(!replay || !replay.mons) continue;
      for(const side of ['p1','p2']){
        const username=String(replay.players?.[side]||'').trim();
        if(!username) continue;
        const mappedTeam=teamFor(username);
        if(!mappedTeam || mappedTeam==='Unknown') continue;
        const teamName=Object.keys(result).find(t=>sameRosterTeam(t,mappedTeam));
        if(!teamName) continue;
        const team=result[teamName];
        team.linkedPlayers.add(username);
        team.replayCount++;

        for(const stat of Object.values(replay.mons)){
          if(!stat || stat.side!==side || !stat.species) continue;
          const species=normName(stat.species)==='comfey' ? 'Comfey' : String(stat.species);
          const target=team.byKey[statIdentity(species)];
          if(!target) continue;
          target.dealt += Number(stat.damageDealt)||0;
          target.taken += Number(stat.damageTaken)||0;
          target.kills += Number(stat.kills)||0;
          target.deaths += Number(stat.deaths)||0;
          target.assists += Array.isArray(stat.assistLog) ? stat.assistLog.length : (Number(stat.assists)||0);
          target.appearances += Number(stat.appearances)||0;
          if(Array.isArray(stat.killLog)) target.killLog.push(...stat.killLog);
          if(Array.isArray(stat.deathLog)) target.deathLog.push(...stat.deathLog);
          if(Array.isArray(stat.assistLog)) target.assistLog.push(...stat.assistLog);
        }
      }
    }

    for(const team of Object.values(result)){
      for(const stat of team.roster){
        team.total.dealt += stat.dealt;
        team.total.taken += stat.taken;
        team.total.kills += stat.kills;
        team.total.deaths += stat.deaths;
        team.total.assists += stat.assists;
        team.total.appearances += stat.appearances;
      }
    }
    return result;
  }

  // Kept as the common data API used by CSV export and the older Settings tools.
  function teamPokemonStats(weekFilter){
    const data=franchiseRosterData(weekFilter);
    const out={};
    for(const [team,info] of Object.entries(data)) out[team]=info.byKey;
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
    const rows = [['Pokemon','Total Damage Dealt','Direct Damage','Indirect Damage','Avg Damage Dealt per Game','Assists','Games Played','Switches','Leads']];
    stats.forEach(s => rows.push([s.species, s.dealt.toFixed(2), Number(s.directDamage||0).toFixed(2), Number(s.indirectDamage||0).toFixed(2), (s.games? (s.dealt/s.games):0).toFixed(2), s.assists||0, s.games, s.switches||0, s.leads||0]));
    download(`Damage Leaderboard - ${label}.csv`, toCSV(rows));
  }
  function exportTeamCSVs(weekFilter, label){
    const teams = teamPokemonStats(weekFilter);
    for(const team in teams){
      const rows = [['Pokemon','Total Damage Dealt','Total Damage Taken','Total Kills','Total Assists','Total Fallen','Appearances']];
      const list = Object.values(teams[team]).sort((a,b)=>b.dealt-a.dealt);
      list.forEach(s => rows.push([s.species, s.dealt.toFixed(2), s.taken.toFixed(2), s.kills, s.assists||0, s.deaths, s.games]));
      download(`${team} - ${label}.csv`, toCSV(rows));
    }
  }
  // ---------- rendering ----------
  const contentEl = document.getElementById('content');
  const tabsEl = document.getElementById('tabs');
  let activeTab = 'overview';

  tabsEl.addEventListener('click', (e)=>{
    if(e.target.tagName !== 'BUTTON') return;
    activeTab = e.target.dataset.tab;
    [...tabsEl.children].forEach(b=>b.classList.toggle('active', b.dataset.tab===activeTab));
    render();
  });

  // Bind Pokémon profile clicks directly as well as through the document delegate.
  // This makes dynamically-rendered rows/cards clickable even after a section redraw.
  function bindPokemonClicks(root=document){
    root.querySelectorAll?.('.pokemon-click, .search-match[data-pokemon]').forEach(el=>{
      if(el.dataset.pokemonBound === '1') return;
      el.dataset.pokemonBound = '1';
      el.addEventListener('click', (e)=>{
        // Audit cells own their click behavior.
        if(e.target.closest('[data-audit]')) return;
        e.preventDefault();
        e.stopPropagation();
        openPokemonProfile(el.dataset.pokemon);
      });
      el.addEventListener('keydown', (e)=>{
        if((e.key==='Enter'||e.key===' ') && !e.target.closest('[data-audit]')){
          e.preventDefault();
          e.stopPropagation();
          openPokemonProfile(el.dataset.pokemon);
        }
      });
    });
  }

  function renderTicker(){
    const mount=document.getElementById('bannerMount'); if(!mount) return;
    mount.innerHTML=renderBanner();
    const mode=document.getElementById('bannerMode'); const team=document.getElementById('bannerTeam');
    mode?.addEventListener('change',async e=>{STATE.settings.bannerMode=e.target.value; await saveSettingsIfPossible(); renderTicker();});
    team?.addEventListener('change',async e=>{STATE.settings.bannerTeam=e.target.value; await saveSettingsIfPossible(); renderTicker();});
  }
  async function saveSettingsIfPossible(){
    if(IS_ADMIN_PAGE && adminUser){ try{ await saveSharedState(); }catch(e){ console.warn(e); } }
    localStorage.setItem('sbl-banner-preferences', JSON.stringify({bannerMode:STATE.settings.bannerMode,bannerTeam:STATE.settings.bannerTeam}));
  }


  function hideStatsNav(){
    const nav=document.getElementById('pageNav');
    if(nav) nav.classList.add('nav-hidden');
  }
  function showStatsNav(){
    const nav=document.getElementById('pageNav');
    if(nav) nav.classList.remove('nav-hidden');
  }
  function lockPopupScroll(){
    document.documentElement.style.overflow='hidden';
    document.body.style.overflow='hidden';
    hideStatsNav();
  }
  function unlockPopupScroll(){
    if(!document.querySelector('.pokemon-overlay, .audit-overlay')){
      document.documentElement.style.overflow='';
      document.body.style.overflow='';
    }
    if(!document.querySelector('.pokemon-overlay, .audit-overlay, [role="dialog"]')){
      showStatsNav();
    }
  }
  function closePokemonProfile(){
    const el=document.getElementById('pokemonProfileModal');
    if(el) el.remove();
    unlockPopupScroll();
  }
  function openPokemonProfile(species){
    const modalId='pokemonProfileModal';
    closePokemonProfile();
    const root=document.createElement('div');
    root.innerHTML=`<div class="pokemon-overlay" id="${modalId}">
      <div class="pokemon-modal" role="dialog" aria-modal="true" aria-label="${SBL.pokemon.escapeHtml(species)} profile">
        <div class="pokemon-modal-head pokemon-profile-banner" style="background:var(--panel) !important;color:var(--text) !important;border-bottom:1px solid var(--border) !important;">
          <strong>Pokémon Profile</strong>
          <button class="ghost small" id="pokemonProfileClose" type="button">Close ✕</button>
        </div>
        <div class="pokemon-modal-body" id="pokemonProfileBody"></div>
      </div>
    </div>`;
    const modal=root.firstElementChild;
    document.body.appendChild(modal);
    lockPopupScroll();
    const overlay=document.getElementById(modalId);
    const closeBtn=document.getElementById('pokemonProfileClose');
    closeBtn.addEventListener('click',closePokemonProfile);
    overlay.addEventListener('click',e=>{ if(e.target===overlay) closePokemonProfile(); });
    const body=document.getElementById('pokemonProfileBody');
    try{
      body.innerHTML=renderPokemonProfile(species,'ALL');
      bindPokemonProfileTabs(overlay);
    }catch(err){
      console.error('Failed to render Pokémon profile:',err);
      body.innerHTML=`<div class="empty-state"><strong>Could not load this Pokémon profile.</strong><div class="note" style="margin-top:6px;">The replay data for ${SBL.pokemon.escapeHtml(species)} could not be rendered. The rest of Stats is still available.</div></div>`;
    }
    requestAnimationFrame(()=>closeBtn?.focus());
  }

  function openReplaySummary(replayId){
    lockPopupScroll();
    const r = STATE.replays[replayId];
    if(!r){ return; }
    const p1 = (r.players?.p1 || '?').trim() || '?';
    const p2 = (r.players?.p2 || '?').trim() || '?';
    const winner = (r.winner || '').trim();
    const resultText = winner ? `${winner} won` : 'Result unavailable';
    const mons = Object.values(r.mons || {});
    const sideMons = side => {
      const seen={};
      const ensure=(species, base={})=>{
        const key=SBL.stats.identity(species);
        if(!seen[key]) seen[key]={side,species, kills:0,assists:0,deaths:0,damageDealt:0,damageTaken:0,appearances:0,killLog:[],deathLog:[],assistLog:[]};
        return seen[key];
      };
      (r.teamRoster?.[side]||[]).forEach(sp=>ensure(sp));
      mons.filter(m=>m.side===side).forEach(m=>{
        const target=ensure(m.species);
        target.species = m.species;
        target.kills += Number(m.kills)||0;
        target.deaths += Number(m.deaths)||0;
        target.assists += Array.isArray(m.assistLog) ? m.assistLog.length : (Number(m.assists)||0);
        target.damageDealt += Number(m.damageDealt)||0;
        target.damageTaken += Number(m.damageTaken)||0;
        target.appearances += Number(m.appearances)||0;
        if(Array.isArray(m.killLog)) target.killLog.push(...m.killLog);
        if(Array.isArray(m.deathLog)) target.deathLog.push(...m.deathLog);
        if(Array.isArray(m.assistLog)) target.assistLog.push(...m.assistLog);
      });
      return Object.values(seen).sort((a,b)=>
        (b.kills-a.kills) || (a.deaths-b.deaths) || (b.damageDealt-a.damageDealt));
    };
    const sideCard = (side, player) => {
      const list = sideMons(side);
      const team = teamFor(player);
      const kills = list.reduce((n,m)=>n+m.kills,0);
      const deaths = list.reduce((n,m)=>n+m.deaths,0);
      const assists = list.reduce((n,m)=>n+(Number(m.assists)||0),0);
      const dealt = list.reduce((n,m)=>n+m.damageDealt,0);
      const taken = list.reduce((n,m)=>n+m.damageTaken,0);
      return `<div class="summary-side">
        <div class="summary-side-head"><div><strong>${SBL.pokemon.escapeHtml(player)}</strong><div class="summary-team">${SBL.pokemon.escapeHtml(team)}</div></div><div class="summary-score">${deaths} fainted</div></div>
        <div class="summary-line"><span>${kills} kills</span><span>${assists} assists</span><span>${dealt.toFixed(1)}damage dealt</span><span>${taken.toFixed(1)}damage taken</span></div>
        <div class="summary-mons">${list.map(m=>`<div class="summary-mon">
          ${pokemonLink(m.species, `${SBL.pokemon.spriteMarkup(m.species,'sprite')}<div class="summary-mon-main"><div class="pname-cell"><strong>${SBL.pokemon.escapeHtml(m.species)}</strong></div><div class="summary-mon-stats"><span class="summary-kad-link" data-audit='${SBL.pokemon.escapeHtml(JSON.stringify({species:m.species,type:'kills',list:m.killLog||[],showLink:true}))}'>${m.kills} K</span> · <span class="summary-kad-link" data-audit='${SBL.pokemon.escapeHtml(JSON.stringify({species:m.species,type:'assists',list:m.assistLog||[],showLink:true}))}'>${m.assists||0} A</span> · <span class="summary-kad-link" data-audit='${SBL.pokemon.escapeHtml(JSON.stringify({species:m.species,type:'deaths',list:m.deathLog||[],showLink:true}))}'>${m.deaths} D</span> · ${m.damageDealt.toFixed(1)} dmg</div></div>`)}
          ${m.appearances ? (m.deaths ? '<span class="badge danger-badge">Fainted</span>' : '<span class="badge">Survived</span>') : '<span class="badge">Not sent</span>'}
        </div>`).join('') || '<div class="empty-state">No Pokémon recorded.</div>'}</div>
      </div>`;
    };
    document.getElementById('auditModal').innerHTML = `
      <div class="audit-overlay" id="replaySummaryOverlay">
        <div class="audit-box replay-summary-box">
          <div class="summary-header">
            <div><div class="summary-kicker">${SBL.pokemon.escapeHtml(r.week || 'Unassigned')} · ${SBL.pokemon.escapeHtml(r.format || 'Replay')}</div><h3>${SBL.pokemon.escapeHtml(p1)} <span class="summary-vs">vs</span> ${SBL.pokemon.escapeHtml(p2)}</h3><div class="summary-result">${SBL.pokemon.escapeHtml(resultText)}</div></div>
            <div class="summary-meta"><span>${mons.length} Pokémon recorded</span><span>Replay ${SBL.pokemon.escapeHtml(r.id)}</span></div>
          </div>
          <div class="summary-grid">${sideCard('p1',p1)}${sideCard('p2',p2)}</div>
          <div class="summary-actions"><span class="note">${SBL.pokemon.escapeHtml(battleLabel(r.id))}</span><button class="ghost" id="summaryClose">Close</button></div>
        </div>
      </div>`;
    document.getElementById('summaryClose').addEventListener('click', closeAudit);
    document.getElementById('replaySummaryOverlay').addEventListener('click', e=>{ if(e.target.id==='replaySummaryOverlay') closeAudit(); });
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
    if(!el) return;
    const overlays = el.querySelectorAll('.audit-overlay');
    if(!overlays.length){ el.replaceChildren(); unlockPopupScroll(); return; }
    // Remove every mounted audit overlay. This also cleans up duplicate overlays
    // left by older event bindings, so one click always closes the popup.
    overlays.forEach(overlay => overlay.remove());
    el.replaceChildren();
    unlockPopupScroll();
  }

  if(!window.__SBL_TEAM_OVERVIEW_CLOSE_BOUND){
    window.__SBL_TEAM_OVERVIEW_CLOSE_BOUND=true;
    const closeOverviewFromEvent = e=>{
      const btn=e.target?.closest?.('#teamOverviewClose'); if(!btn) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const modal=document.getElementById('auditModal');
      if(modal) modal.replaceChildren();
      if(typeof updateModalPageLock==='function') updateModalPageLock();
      if(typeof unlockPopupScroll==='function') unlockPopupScroll();
    };
    window.addEventListener('click', closeOverviewFromEvent, true);
    window.addEventListener('pointerup', closeOverviewFromEvent, true);
  }

  function closeAllPopups(){
    document.getElementById('auditModal')?.replaceChildren();
    document.getElementById('pokemonProfileModal')?.remove();
    document.getElementById('assistProfileModal')?.remove();
    document.getElementById('luckPokemonModal')?.remove();
    unlockPopupScroll();
  }

  // Global backdrop safety net for every audit/overview overlay. This avoids
  // relying on individual renderers having exactly the right target check.
  document.addEventListener('pointerdown', (e)=>{
    const overlay = e.target.closest?.('.audit-overlay');
    if(overlay && e.target === overlay){ closeAudit(); }
  }, true);

  function closeTopPopup(){
    const pokemon = document.getElementById('pokemonProfileModal');
    if(pokemon){ pokemon.remove(); unlockPopupScroll(); return true; }
    const assist = document.getElementById('assistProfileModal');
    if(assist){ assist.remove(); unlockPopupScroll(); return true; }
    const luck = document.getElementById('luckPokemonModal');
    if(luck){ luck.remove(); unlockPopupScroll(); return true; }
    const audit = document.querySelector('#auditModal .audit-overlay');
    if(audit){ closeAudit(); return true; }
    return false;
  }
  function replayContext(replayId){
    const r=STATE.replays?.[replayId];
    if(!r) return {week:'—', matchup:'—'};
    const p1=(r.players?.p1||'?').trim()||'?';
    const p2=(r.players?.p2||'?').trim()||'?';
    return {week:r.week||'Unassigned', matchup:`${p1} vs ${p2}`};
  }

  function openAudit(species, type, list, showLink){
    lockPopupScroll();
    showLink = showLink !== false;
    const label = type === 'kills' ? 'Knockouts' : (type === 'assists' ? 'Assists' : 'Fallen');
    const rows = (list || []).slice().sort((a,b)=> (a.replayId||'').localeCompare(b.replayId||'') || (a.turn-b.turn));
    document.getElementById('auditModal').innerHTML = `
      <div class="audit-overlay" id="auditOverlay">
        <div class="audit-box">
          <h3>${pokemonLink(species, SBL.pokemon.escapeHtml(species))} — ${label} (${rows.length})</h3>
          <div class="audit-sub">Every ${type==='kills'?'knockout':(type==='assists'?'assist':'death')} credited to this Pokémon this scope, with the turn${showLink?', replay,':''} and why it was credited.</div>
          ${rows.length===0 ? `<div class="empty-state">No entries.</div>` : `<ul class="audit-list">
            ${rows.map(r=>`<li>
              <span><strong>${SBL.pokemon.escapeHtml(replayContext(r.replayId).week)}</strong> · ${SBL.pokemon.escapeHtml(replayContext(r.replayId).matchup)} · Turn ${r.turn} — ${type==='kills' ? 'vs ' + (r.victim ? pokemonLink(r.victim, SBL.pokemon.escapeHtml(r.victim), '', false) : '?') : (type==='assists' ? 'helped finish ' + (r.victim ? pokemonLink(r.victim, SBL.pokemon.escapeHtml(r.victim), '', false) : '?') + ' — ' + Number(r.percent||0).toFixed(1) + '% damage (' + Number(r.damage||0).toFixed(1) + ')' + (r.killer ? ' · killer: ' + pokemonLink(r.killer, SBL.pokemon.escapeHtml(r.killer), '', false) : '') : (r.killer ? 'by ' + pokemonLink(r.killer, SBL.pokemon.escapeHtml(r.killer), '', false) : 'unattributed'))} <span class="audit-cause">(${SBL.pokemon.escapeHtml(displayCause(r.cause))})</span></span>
              ${showLink ? `<span class="note">${SBL.pokemon.escapeHtml(battleLabel(r.replayId))}</span>` : ''}
            </li>`).join('')}
          </ul>`}
          <div class="foot-actions"><button class="ghost" id="auditClose">Close</button></div>
        </div>
      </div>`;
    document.getElementById('auditClose').addEventListener('click', closeAudit);
    document.getElementById('auditOverlay').addEventListener('click', (e)=>{ if(e.target.id === 'auditOverlay') closeAudit(); });
  }


  function openAssistProfile(species, scope='ALL'){
    const stats = globalPokemonStats(scope).find(s=>statIdentity(s.species)===statIdentity(species));
    const rows = (stats?.assistLog || []).slice().sort((a,b)=>(a.replayDate-b.replayDate)||(a.turn-b.turn));
    lockPopupScroll();
    const root=document.createElement('div');
    root.innerHTML=`<div class="pokemon-overlay" id="assistProfileModal"><div class="pokemon-modal" role="dialog" aria-modal="true" aria-label="${SBL.pokemon.escapeHtml(species)} assists">
      <div class="pokemon-modal-head"><strong>${SBL.pokemon.escapeHtml(species)} — Assists (${rows.length})</strong><button class="ghost small" id="assistProfileClose" type="button">Close ✕</button></div>
      <div class="pokemon-modal-body"><h3 class="mini-heading">Assist record</h3>
      ${rows.length ? `<table><thead><tr><th>Week</th><th>Matchup</th><th>Turn</th><th>Victim</th><th>Damage</th><th>Share</th><th>Reason</th><th>Killer</th><th>Replay</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${SBL.pokemon.escapeHtml(safeReplayContext(x.replayId).week)}</td><td>${SBL.pokemon.escapeHtml(safeReplayContext(x.replayId).matchup)}</td><td>${x.turn}</td><td>${x.victim ? pokemonLink(x.victim,SBL.pokemon.escapeHtml(x.victim),'',false) : '?'}</td><td class="num dealt">${Number(x.damage||0).toFixed(1)}</td><td class="num">${Number(x.percent||0).toFixed(1)}%</td><td>${SBL.pokemon.escapeHtml(safeCause(x.cause||'damage'))}</td><td>${x.killer ? pokemonLink(x.killer,SBL.pokemon.escapeHtml(x.killer),'',false) : '?'}</td><td>${x.replayId ? `<span class="note">${SBL.pokemon.escapeHtml(battleLabel(x.replayId))}</span>` : '<span class="note">Unavailable</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">No assists recorded.</div>'}
      </div></div></div>`;
    document.body.appendChild(root.firstElementChild);
    const modal=document.getElementById('assistProfileModal');
    const close=()=>{modal?.remove();unlockPopupScroll();};
    document.getElementById('assistProfileClose').addEventListener('click',close); modal.addEventListener('click',e=>{if(e.target===modal)close();});
  }


  function render(){
    document.getElementById('app').classList.toggle('wide', activeTab === 'teams' || activeTab === 'global' || activeTab === 'assists' || activeTab === 'goldenfist' || activeTab === 'luckiest' || activeTab === 'pokemonsearch' || activeTab === 'misc' || activeTab === 'season' || activeTab === 'replays' || activeTab === 'overview');
    if(!loaded){ contentEl.innerHTML = `<div class="empty-state">Loading…</div>`; return; }
    if(activeTab === 'overview') return renderLeagueOverview();
    if(activeTab === 'process') return renderProcess();
    if(activeTab === 'global') return renderLeaderboards();
    if(activeTab === 'assists') return renderAssistLeaderboard();
    if(activeTab === 'pokemonsearch') return renderPokemonSearch();
    if(activeTab === 'goldenfist') return renderGoldenFist();
    if(activeTab === 'luckiest') return renderLuckiestTeam();
    if(activeTab === 'misc') return renderMisc();
    if(activeTab === 'teams') return renderTeams();
    if(activeTab === 'season') return renderSeason();
    if(activeTab === 'replays') return renderReplayBrowser();
    if(activeTab === 'settings') return renderSettings();
  }
  // jump to another tab programmatically (e.g. the Franchise Stats hyperlink)
  function goToTab(tab){
    activeTab = tab;
    [...tabsEl.children].forEach(b=>b.classList.toggle('active', b.dataset.tab===activeTab));
    render();
  }

  function teamStandings(weekFilter='ALL'){ return teamComparisonData(weekFilter); }
  function teamLogo(team){ return STATE.settings.teamLogos?.[groupKey(team)] || STATE.settings.teamLogos?.[team] || ''; }

  function renderLeagueOverview(){
    const data=teamStandings('ALL');
    const allMons=teamPokemonStats('ALL');
    contentEl.innerHTML=`<div class="league-overview-wrap">
      <div class="league-overview-head">
        <div><div class="league-overview-kicker">Season standings</div><h2>League Overview</h2><div class="note">The table, distilled. Click a franchise for the full team summary.</div></div>
        <div class="league-overview-count">${data.length} franchise${data.length===1?'':'s'}</div>
      </div>
      <div id="overviewTeams"></div>
    </div>`;
    const el=document.getElementById('overviewTeams');
    if(!data.length){el.innerHTML='<div class="empty-state">No team data yet.</div>';return;}

    el.innerHTML=`<div class="league-overview-grid">${data.map((t,index)=>{
      const mons=Object.values(allMons[t.team]||{}).sort((a,b)=>b.appearances-a.appearances||b.dealt-a.dealt);
      const top=mons[0];
      const ordinal=index===0?'1st':index===1?'2nd':index===2?'3rd':`${index+1}th`;
      const rankTone=index===0?'gold':index===1?'silver':index===2?'bronze':'';
      return `<div class="league-card ${rankTone}" data-team-card="${SBL.pokemon.escapeHtml(t.team)}" tabindex="0" role="button" aria-label="Open ${SBL.pokemon.escapeHtml(t.team)} league summary">
        <div class="league-card-glow"></div>
        <div class="league-card-main">
          <div class="league-card-top">
            <div class="league-rank">${index+1}</div>
            <div class="league-card-identity">
              <div class="league-position">${ordinal} place</div>
              <div class="league-team-name">${SBL.pokemon.escapeHtml(t.team)}</div>
              <div class="league-record">${t.wins}–${t.losses}</div>
            </div>
            ${top?`<div class="league-card-sprite">${SBL.pokemon.spriteMarkup(top.species,'league-card-sprite')}</div>`:''}
          </div>
          <div class="league-card-bottom">
            <div class="league-feature">
              <span class="league-feature-label">Signature pick</span>
              <span class="league-feature-name">${top?SBL.pokemon.escapeHtml(top.species):'No Pokémon data'}</span>
            </div>
            <span class="league-open-hint">View team <span aria-hidden="true">→</span></span>
          </div>
        </div>
      </div>`;
    }).join('')}</div>`;

    el.querySelectorAll('[data-team-card]').forEach(card=>{
      const open=()=>openTeamOverview(card.dataset.teamCard);
      card.addEventListener('click',open);
      card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
    });
  }
  function openTeamOverview(team){
    const data=teamStandings('ALL');
    const t=data.find(x=>x.team===team);
    if(!t) return;
    const all=teamPokemonStats('ALL');
    const mons=Object.values(all[team]||{}).filter(m=>m && m.species).sort((a,b)=>Number(b.appearances||0)-Number(a.appearances||0)||Number(b.dealt||0)-Number(a.dealt||0)).slice(0,6);
    document.getElementById('auditModal').innerHTML=`<div class="audit-overlay" id="teamOverviewOverlay"><div class="audit-box overview-modal"><div class="summary-header"><div><div class="summary-kicker">League Overview</div><h3>${SBL.pokemon.escapeHtml(team)}</h3><div class="summary-result" style="color:var(--text-dim);font-weight:600;">${t.wins}–${t.losses} · ${t.games} game${t.games===1?'':'s'}</div></div><button class="ghost small" id="teamOverviewClose">Close ✕</button></div><div class="profile-grid"><div><span>Record</span><strong>${t.wins}-${t.losses}</strong></div><div><span>Win %</span><strong>${t.games?(100*t.wins/t.games).toFixed(1)+'%':'—'}</strong></div><div><span>Differential</span><strong>${Number(t.diff||0)>0?'+':''}${Number(t.diff||0)}</strong></div><div><span>Damage dealt</span><strong>${Number(t.dealt||0).toFixed(1)}</strong></div></div><div class="section-divider"></div><h3 class="mini-heading">Top used Pokémon</h3>${mons.length?mons.map(m=>`<div class="summary-mon">${pokemonLink(m.species,`${SBL.pokemon.spriteMarkup(m.species,'sprite')}<div class="summary-mon-main"><strong>${SBL.pokemon.escapeHtml(m.species)}</strong><div class="summary-mon-stats">${m.appearances||0} games · ${m.kills||0} K · ${(m.appearances ? (Number(m.kills||0)/Number(m.appearances)).toFixed(2) : '0.00')} K/G · ${m.deaths||0} D · ${(Number(m.dealt)||0).toFixed(1)} dmg</div></div>`)}</div>`).join(''):'<div class="empty-state">No Pokémon data.</div>'}</div></div>`;
    updateModalPageLock?.();
    const closeBtn=document.getElementById('teamOverviewClose');
    if(closeBtn) closeBtn.onclick=(e)=>{e.preventDefault();e.stopPropagation();closeAudit();};
    const overlay=document.getElementById('teamOverviewOverlay');
    if(overlay) overlay.onclick=(e)=>{if(e.target===overlay)closeAudit();};
  }

  function renderProcess(){
    const count = Object.keys(STATE.replays).length;
    contentEl.innerHTML = `
      <div class="panel">
        <h2>Add replays</h2>
        <label>Showdown replay links (one per line)</label>
        <textarea id="urlsInput" placeholder="https://replay.pokemonshowdown.com/gen9natdexdraft-xxxxxxxx"></textarea>
        <button class="primary" id="processBtn">Process replays</button>
        <div class="log" id="processLog"></div>
      </div>
      <div class="panel">
        <h2>Processed this season <span class="badge">${count} replays</span></h2>
        ${count===0 ? `<div class="empty-state">Nothing processed yet — paste some replay links above.</div>` : `
          <div class="foot-actions" style="margin-top:0; margin-bottom:12px;">
            <button class="ghost" id="reprocessAll">Reprocess all replays (re-fetches &amp; re-parses everything)</button>
          </div>
          ${renderReplayTable()}`}
      </div>
    `;
    document.getElementById('processBtn').addEventListener('click', async ()=>{
      const btn = document.getElementById('processBtn');
      const urls = document.getElementById('urlsInput').value;
      const logEl = document.getElementById('processLog');
      logEl.innerHTML = '';
      btn.disabled = true;
      await processUrls(urls, '', logEl);
      btn.disabled = false;
    });
    const reBtn = document.getElementById('reprocessAll');
    if(reBtn) reBtn.addEventListener('click', async ()=>{
      reBtn.disabled = true;
      const logEl = document.getElementById('processLog');
      await reprocessAll(logEl);
      reBtn.disabled = false;
    });
  }

  async function reprocessAll(logEl){
    await SBL.replays.ensureMoveAccuracyData();
    const ids = Object.keys(STATE.replays);
    let ok=0, failed=0;
    for(const id of ids){
      
      try{
        const resp = await fetch(`https://replay.pokemonshowdown.com/${id}.json`);
        if(!resp.ok) throw new Error('not found (' + resp.status + ')');
        const json = await resp.json();
        const oldReplay = STATE.replays[id];
        const parsed = SBL.replays.parseLog(json, id);
        parsed.uploadtime = json.uploadtime;
        parsed.weekOverride = !!oldReplay.weekOverride;
        parsed.week = oldReplay.weekOverride
          ? (oldReplay.week || 'Unassigned')
          : autoWeekForReplay(parsed);
        parsed.processedAt = oldReplay.processedAt;
        STATE.replays[id] = parsed;
        appendLog(logEl, `✓ reprocessed ${id}`, false, true);
        ok++;
      }catch(e){
        appendLog(logEl, `✗ ${id} — ${e.message}`, true);
        failed++;
      }
    }
    recalculateAllWeeks();
    await saveReplays();
    appendLog(logEl, `Reprocess complete. ${ok} updated, ${failed} failed.`, false);
    renderTicker();
    render();
  }

  function renderReplayTable(){
    const list = Object.values(STATE.replays).sort((a,b)=>b.processedAt-a.processedAt);
    const rows = list.map(r => `
      <tr>
        <td>${SBL.pokemon.escapeHtml(r.week||'Unassigned')}</td>
        <td>${SBL.pokemon.escapeHtml(r.players.p1||'?')} <span style="color:var(--text-dim)">vs</span> ${SBL.pokemon.escapeHtml(r.players.p2||'?')}</td>
        <td style="color:var(--text-dim)">${SBL.pokemon.escapeHtml(r.format||'')}</td>
        <td class="num"><button class="ghost small danger-btn" data-remove="${r.id}">Remove</button></td>
      </tr>`).join('');
    setTimeout(()=>{
      document.querySelectorAll('[data-remove]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          delete STATE.replays[btn.dataset.remove];
          await saveReplays();
          renderTicker();
          render();
        });
      });
    }, 0);
    return `<table><thead><tr><th>Week</th><th>Matchup</th><th>Format</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function weekSelectorHtml(id){
    const weeks = weeksList();
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
        <div class="stats-controls stats-controls-damage">
          <div class="stats-control"><label for="globalWeek">Scope</label>${weekSelectorHtml('globalWeek')}</div>
          <div class="stats-control"><label for="globalDamageType">Damage type</label><select id="globalDamageType"><option value="dealt">Total Damage</option><option value="directDamage">Direct Damage</option><option value="indirectDamage">Indirect Damage</option></select></div>
        </div>
        <div id="globalTable"></div>
        <a class="nav-link" id="toTeamsLink">Want per-team breakdowns? → View Franchise Stats</a>
      </div>`;

    document.getElementById('toTeamsLink').addEventListener('click', ()=> goToTab('teams'));

    const sel = document.getElementById('globalWeek');
    const damageType = document.getElementById('globalDamageType');
    function drawGlobal(){
      const key = damageType.value;
      const label = key==='directDamage' ? 'Direct Damage' : (key==='indirectDamage' ? 'Indirect Damage' : 'Total Damage');
      const stats = globalPokemonStats(sel.value).slice().sort((a,b)=>(Number(b[key])||0)-(Number(a[key])||0) || (Number(b.kills)||0)-(Number(a.kills)||0) || String(a.species).localeCompare(String(b.species)));
      document.getElementById('globalTable').innerHTML = stats.length===0 ? `<div class="empty-state">No data for this scope yet.</div>` :
        `<table><thead><tr><th class="rank">#</th><th>Pokémon</th><th class="num">${label}</th><th class="num">Total</th><th class="num">Direct</th><th class="num">Indirect</th><th class="num">Kills</th><th class="num">Kills/Game</th><th class="num">Assists</th><th class="num">Fallen</th><th class="num">Games</th></tr></thead><tbody>
        ${stats.map((s,i)=>`<tr>
          <td class="rank">${i+1}</td>
          <td class="pname"><div class="pname-cell">${pokemonName(s.species,true,'sprite-xl')}</div></td>
          <td class="num dealt"><strong>${(Number(s[key])||0).toFixed(1)}</strong></td>
          <td class="num dealt">${(Number(s.dealt)||0).toFixed(1)}</td>
          <td class="num">${(Number(s.directDamage)||0).toFixed(1)}</td>
          <td class="num">${(Number(s.indirectDamage)||0).toFixed(1)}</td>
          <td ${auditAttr(s.species,'kills',s.killLog)}>${s.kills}</td>
          <td class="num">${s.games ? (s.kills/s.games).toFixed(2) : '0.00'}</td>
          <td ${auditAttr(s.species,'assists',s.assistLog)}>${s.assists||0}</td>
          <td ${auditAttr(s.species,'deaths',s.deathLog)}>${s.deaths}</td>
          <td class="num">${s.games}</td>
        </tr>`).join('')}</tbody></table>`;
    }
    sel.addEventListener('change', drawGlobal);
    damageType.addEventListener('change', drawGlobal);
    drawGlobal();
  }

  function renderAssistLeaderboard(){
    contentEl.innerHTML = `
      <div class="panel">
        <h2>Assist Leaderboard</h2>
        <div class="row" style="align-items:flex-end;">
          <div><label>Scope</label>${weekSelectorHtml('assistWeek')}</div>
        </div>
        <div class="note" style="margin:8px 0 14px;">Every Pokémon is shown so zero-assist rows are visible too. Click an assist count to audit exactly what each assist was credited for.</div>
        <div id="assistTable"></div>
      </div>`;
    const sel=document.getElementById('assistWeek');
    function draw(){
      const stats=globalPokemonStats(sel.value).sort((a,b)=>(b.assists||0)-(a.assists||0) || b.dealt-a.dealt || a.species.localeCompare(b.species));
      document.getElementById('assistTable').innerHTML = stats.length ? `<table><thead><tr><th class="rank">#</th><th>Pokémon</th><th class="num">Assists</th><th class="num">Kills</th><th class="num">Damage Dealt</th><th class="num">Damage Taken</th><th class="num">Games</th></tr></thead><tbody>${stats.map((s,i)=>`<tr><td class="rank">${i+1}</td><td class="pname"><div class="pname-cell"><span class="pokemon-click" role="button" tabindex="0" data-assist-pokemon="${SBL.pokemon.escapeHtml(s.species)}" title="View assists for ${SBL.pokemon.escapeHtml(s.species)}">${pokemonName(s.species,true,'sprite-xl')}</span></div></td><td ${auditAttr(s.species,'assists',s.assistLog)}>${s.assists||0}</td><td class="num">${s.kills}</td><td class="num dealt">${s.dealt.toFixed(1)}</td><td class="num taken">${s.taken.toFixed(1)}</td><td class="num">${Number.isFinite(s.games)?s.games:0}</td></tr>`).join('')}</tbody></table>` : `<div class="empty-state">No assists recorded for this scope yet.</div>`;
    }
    sel.addEventListener('change',draw);
    draw();
  }

  function renderPokemonSearch(){
    contentEl.innerHTML = `
      <div class="panel">
        <h2>Pokémon Search</h2>
        <div class="pokemon-search-box">
          <div class="search-input-wrap">
            <label>Search by Pokémon name</label>
            <input type="text" id="pokemonSearchInput" placeholder="e.g. Slowking-Galar, Haxorus, Cinderace…" autocomplete="off">
            <div class="pokemon-search-hint">Search is live as you type. Press <strong>/</strong> anywhere on the dashboard to jump here.</div>
          </div>
          <div class="pokemon-type-filter">
            <label>Search by type</label>
            <select id="pokemonTypeFilter">
              <option value="all">All types</option>
              ${Object.keys(TYPE_CLASS).map(t=>`<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="pokemonSearchTable"><div class="empty-state">Preparing Pokémon search…</div></div>
      </div>`;

    const input = document.getElementById('pokemonSearchInput');
    const typeFilter = document.getElementById('pokemonTypeFilter');
    input?.addEventListener('input', renderPokemonSearchTable);
    typeFilter?.addEventListener('change', renderPokemonSearchTable);
    window.__SBL_POKEMON_SEARCH_REFRESH=renderPokemonSearchTable;
    input?.focus();
    preparePokemonSearchCache();

    function renderPokemonSearchTable(){
      const table = document.getElementById('pokemonSearchTable');
      if(!table || !input || !typeFilter) return;
      if(!pokemonSearchCache){
        table.innerHTML='<div class="empty-state">Preparing Pokémon search…</div>';
        return;
      }
      const q = input.value.trim().toLowerCase();
      const wantedType = typeFilter.value;
      const stats = pokemonSearchCache.filter(s => {
        const name=s.species.toLowerCase();
        return (!q || name.includes(q)) && (wantedType==='all' || pokemonTypes(s.species).includes(wantedType));
      }).sort((a,b)=>a.species.localeCompare(b.species,undefined,{sensitivity:'base'}));
      if(!stats.length){
        table.innerHTML = `<div class="empty-state">${q ? `No Pokémon matching <strong>${SBL.pokemon.escapeHtml(input.value.trim())}</strong> in this scope.` : 'No Pokémon data for this scope yet.'}</div>`;
        return;
      }
      table.innerHTML = `<table><thead><tr>
        <th>Pokémon</th><th>Coach / Team</th><th class="num">Luck Rank</th><th class="num">Dmg Dealt</th><th class="num">Dmg Taken</th><th class="num">Kills</th><th class="num">Kills/Game</th><th class="num">Assists</th><th class="num">Fallen</th><th class="num">Games</th><th class="num">Avg Dmg/Game</th>
      </tr></thead><tbody>
        ${stats.map(s=>`<tr class="search-match" data-pokemon="${SBL.pokemon.escapeHtml(s.species)}" tabindex="0" role="button" title="Open ${SBL.pokemon.escapeHtml(s.species)} profile" style="cursor:pointer;">
          <td class="pname"><div class="pname-cell">${pokemonName(s.species,true,'sprite-xl')}</div></td>
          <td>${SBL.pokemon.escapeHtml(Array.from(s.coaches).sort().join(', ') || 'Unknown')}</td>
          <td class="num">${(() => { const lr=luckPokemonRank(s.species,'ALL'); return lr ? `<strong>#${lr.rank}</strong>` : '—'; })()}</td>
          <td class="num dealt">${s.dealt.toFixed(1)}</td>
          <td class="num taken">${s.taken.toFixed(1)}</td>
          <td ${auditAttr(s.species,'kills',s.killLog)}>${s.kills}</td>
          <td class="num">${s.games ? (s.kills/s.games).toFixed(2) : '0.00'}</td>
          <td ${auditAttr(s.species,'assists',s.assistLog)}>${s.assists||0}</td>
          <td ${auditAttr(s.species,'deaths',s.deathLog)}>${s.deaths}</td>
          <td class="num">${s.games}</td>
          <td class="num">${(s.games ? s.dealt/s.games : 0).toFixed(1)}</td>
        </tr>`).join('')}
      </tbody></table>`;
      bindPokemonClicks(table);
    }
  }


  // ---------- Pokémon profile / death causes / team comparison ----------
  function pokemonProfileData(species, weekFilter){
    return SBL.stats.pokemonProfile(species,allReplays(weekFilter),{teamFor});
  }

  function luckPokemonRank(species, scope){
    const target=normName(species);
    if(!target) return null;
    // Ranking is based on every Pokémon that was actually brought in the
    // selected scope. Pokémon with no luck events still belong in the pool at
    // a neutral score of 0. Pokémon that were never brought are not ranked.
    const brought=globalPokemonStats(scope).filter(p=>Number(p.games||0)>0);
    if(!brought.some(p=>normName(p.species)===target)) return null;
    const scored=luckPokemonData(scope);
    const scoreByName=new Map(scored.map(p=>[normName(p.species),Number(p.score)||0]));
    const rows=brought.map(p=>({species:p.species,score:scoreByName.get(normName(p.species))||0,games:Number(p.games)||0}));
    rows.sort((a,b)=>b.score-a.score || b.games-a.games || a.species.localeCompare(b.species,undefined,{sensitivity:'base'}));
    const index=rows.findIndex(p=>normName(p.species)===target);
    if(index<0) return null;
    return {rank:index+1,score:rows[index].score,total:rows.length};
  }

  function statsProfileUIDeps(){
    return {pokemonProfileData,escapeHtml,pokemonLink,spriteImg,displayCause,replayContext,luckPokemonRank};
  }

  function renderPokemonProfileFallback(species, weekFilter){
    const s = SBL.stats.pokemonProfile(species, allReplays(weekFilter), {teamFor});
    if(!s || !Number(s.games)) return `<div class="empty-state">No data for ${SBL.pokemon.escapeHtml(species)} in this scope.</div>`;
    const num = v => Number(v)||0;
    const esc = v => SBL.pokemon.escapeHtml(v == null ? '' : String(v));
    const coaches = Array.from(s.coaches instanceof Set ? s.coaches : []).sort().join(', ');
    const kd = num(s.deaths) ? (num(s.kills)/num(s.deaths)).toFixed(2) : (num(s.kills) ? '∞' : '0');
    const killsPerGame = num(s.games) ? (num(s.kills)/num(s.games)).toFixed(2) : '0.00';
    let fallbackLuckRank = null;
    try { fallbackLuckRank = luckPokemonRank(s.species, weekFilter || 'ALL'); } catch(e) {}
    const profileLogRows = (list, type) => (Array.isArray(list) ? list : []).map((entry) => {
      const x = entry && typeof entry === 'object' ? entry : {};
      const replayId = String(x.replayId || x.replay || x.id || '');
      const replayDate = Number(x.replayDate || 0) || 0;
      const turn = Number(x.turn || x.turnNumber || 0) || 0;
      const victim = x.victim == null ? '' : String(x.victim);
      const killer = x.killer == null ? '' : String(x.killer);
      const cause = x.cause == null ? '' : String(x.cause);
      const damage = Number(
        x.damage ?? x.damageAtRemoval ?? x.damageContribution ??
        x.damageDealt ?? x.dealt ?? x.amount ?? 0
      ) || 0;
      const percent = Number(
        x.percent ?? x.share ?? x.damagePercent ?? x.damageShare ??
        x.percentDamage ?? x.contributionPercent ?? 0
      ) || 0;
      let ctx = {week:'—', matchup:'—'};
      try { ctx = replayContext(replayId || ''); } catch(e) {}
      let shownCause = cause || '—';
      try { shownCause = displayCause(cause); } catch(e) {}
      return {replayId,replayDate,turn,victim,killer,cause:shownCause,damage,percent,week:ctx.week||'—',matchup:ctx.matchup||'—'};
    }).sort((a,b)=>(a.replayDate-b.replayDate)||(a.turn-b.turn));
    const renderProfileLogTable = (list, type) => {
      const rows = profileLogRows(list,type);
      if(!rows.length) return `<div class="empty-state">No ${type === 'kill' ? 'kills' : type === 'assist' ? 'assists' : 'deaths'}.</div>`;
      if(type === 'kill') return `<table><thead><tr><th>Week</th><th>Matchup</th><th>Turn</th><th>Victim</th><th>Cause</th><th>Replay</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${SBL.pokemon.escapeHtml(String(x.week))}</td><td>${SBL.pokemon.escapeHtml(String(x.matchup))}</td><td>${x.turn}</td><td>${x.victim ? pokemonLink(x.victim,SBL.pokemon.escapeHtml(x.victim),'',false) : '?'}</td><td>${SBL.pokemon.escapeHtml(String(x.cause))}</td><td>${x.replayId ? `<span class="note">${SBL.pokemon.escapeHtml(battleLabel(x.replayId))}</span>` : '<span class="note">Unavailable</span>'}</td></tr>`).join('')}</tbody></table>`;
      if(type === 'assist') return `<table><thead><tr><th>Week</th><th>Matchup</th><th>Turn</th><th>Victim</th><th>Damage</th><th>Share</th><th>Reason</th><th>Killer</th><th>Replay</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${SBL.pokemon.escapeHtml(String(x.week))}</td><td>${SBL.pokemon.escapeHtml(String(x.matchup))}</td><td>${x.turn}</td><td>${x.victim ? pokemonLink(x.victim,SBL.pokemon.escapeHtml(x.victim),'',false) : '?'}</td><td class="num dealt">${x.damage.toFixed(1)}</td><td class="num">${x.percent.toFixed(1)}%</td><td>${SBL.pokemon.escapeHtml(String(x.cause || 'damage'))}</td><td>${x.killer ? pokemonLink(x.killer,SBL.pokemon.escapeHtml(x.killer),'',false) : '?'}</td><td>${x.replayId ? `<span class="note">${SBL.pokemon.escapeHtml(battleLabel(x.replayId))}</span>` : '<span class="note">Unavailable</span>'}</td></tr>`).join('')}</tbody></table>`;
      return `<table><thead><tr><th>Week</th><th>Matchup</th><th>Turn</th><th>Killer</th><th>Replay</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${SBL.pokemon.escapeHtml(String(x.week))}</td><td>${SBL.pokemon.escapeHtml(String(x.matchup))}</td><td>${x.turn}</td><td>${x.killer ? pokemonLink(x.killer,SBL.pokemon.escapeHtml(x.killer),'',false) : 'Unattributed'}</td><td>${x.replayId ? `<span class="note">${SBL.pokemon.escapeHtml(battleLabel(x.replayId))}</span>` : '<span class="note">Unavailable</span>'}</td></tr>`).join('')}</tbody></table>`;
    };
    return `<div class="panel pokemon-profile">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        ${SBL.pokemon.spriteMarkup(s.species,'sprite-xl')}
        <div><h2 style="margin:0;color:var(--text);text-transform:none;letter-spacing:0;font-size:20px;">${pokemonLink(s.species, esc(s.species))}</h2>
        <div class="note" style="margin-top:3px;">${esc(coaches)}</div></div>
      </div>
      <div class="profile-section-tabs" role="tablist">
        <button type="button" class="profile-section-tab active" data-profile-tab="overview">Overview</button>
        <button type="button" class="profile-section-tab" data-profile-tab="damage">Damage</button>
        <button type="button" class="profile-section-tab" data-profile-tab="usage">Usage</button>
        <button type="button" class="profile-section-tab" data-profile-tab="kills">Knockouts (${num(s.kills)})</button>
        <button type="button" class="profile-section-tab" data-profile-tab="assists">Assists (${num(s.assists)})</button>
        <button type="button" class="profile-section-tab" data-profile-tab="deaths" >Fallen (${num(s.deaths)})</button>
      </div>
      <section class="profile-section-panel" data-profile-section="overview"><h3 class="mini-heading">Battle overview</h3><div class="profile-summary-grid">
        <div><span>Games</span><strong>${num(s.games)}</strong></div><div><span>Knockouts</span><strong>${num(s.kills)}</strong></div><div><span>Assists</span><strong>${num(s.assists)}</strong></div><div><span>Fallen</span><strong>${num(s.deaths)}</strong></div><div><span>K/D</span><strong>${kd}</strong></div><div><span>Avg dmg/game</span><strong>${num(s.games)?(num(s.dealt)/num(s.games)).toFixed(1):'0'}</strong></div><div><span>Knockouts / Game</span><strong>${killsPerGame}</strong></div>${fallbackLuckRank ? `<div><span>Luck Rank</span><strong>#${fallbackLuckRank.rank}</strong><div class=\"note\">${fallbackLuckRank.score>=0?'+':''}${Number(fallbackLuckRank.score||0).toFixed(2)} luck</div></div>` : ''}
      </div></section>
      <section class="profile-section-panel" data-profile-section="damage" hidden><h3 class="mini-heading">Damage</h3><div class="profile-summary-grid">
        <div><span>Damage dealt</span><strong>${num(s.dealt).toFixed(1)}</strong></div><div><span>Damage taken</span><strong>${num(s.taken).toFixed(1)}</strong></div><div><span>Direct damage</span><strong>${num(s.directDamage).toFixed(1)}</strong></div><div><span>Indirect damage</span><strong>${num(s.indirectDamage).toFixed(1)}</strong></div>
      </div></section>
      <section class="profile-section-panel" data-profile-section="usage" hidden><h3 class="mini-heading">Usage</h3><div class="profile-summary-grid"><div><span>Switches</span><strong>${num(s.switches)}</strong></div><div><span>Leads</span><strong>${num(s.leads)}</strong></div></div></section>
      <section class="profile-section-panel" data-profile-section="kills" hidden><h3 class="mini-heading">Knockout record</h3>${renderProfileLogTable(s.killLog,'kill')}</section>
      <section class="profile-section-panel" data-profile-section="assists" hidden><h3 class="mini-heading">Assist record</h3>${renderProfileLogTable(s.assistLog,'assist')}</section>
      <section class="profile-section-panel" data-profile-section="deaths" hidden><h3 class="mini-heading">Death record</h3>${renderProfileLogTable(s.deathLog,'death')}</section>
    </div>`;
  }

  function renderPokemonProfile(species, weekFilter){
    try {
      if(window.SBLStatsUI && typeof window.SBLStatsUI.renderPokemonProfile === 'function'){
        return window.SBLStatsUI.renderPokemonProfile(species, weekFilter, statsProfileUIDeps());
      }
    } catch(err) {
      console.warn('Profile module failed; using inline profile fallback.', err);
    }
    return renderPokemonProfileFallback(species, weekFilter);
  }

  function bindPokemonProfileTabs(root){
    try {
      if(window.SBLStatsUI && typeof window.SBLStatsUI.bindPokemonProfileTabs === 'function'){
        return window.SBLStatsUI.bindPokemonProfileTabs(root);
      }
    } catch(err) {
      console.warn('Profile tab module failed; using inline tab binding.', err);
    }
    const tabs=[...root.querySelectorAll('[data-profile-tab]')];
    const panels=[...root.querySelectorAll('[data-profile-section]')];
    tabs.forEach(tab=>tab.addEventListener('click',()=>{
      const name=tab.dataset.profileTab;
      tabs.forEach(t=>t.classList.toggle('active',t===tab));
      panels.forEach(panel=>panel.hidden=panel.dataset.profileSection!==name);
    }));
  }



  function luckTeamData(scope){
    const out={};
    for(const r of allReplays(scope)){
      if(!r || !r.players || !r.luck) continue;
      for(const side of ['p1','p2']){
        const team=teamFor(r.players[side]);
        if(!team) continue;
        const key=groupKey(team);
        if(!out[key]) out[key]={team,games:0,crits:0,critLuck:0,dodges:0,moveDodgeLuck:0,lowAccuracyHits:0,lowAccuracyHitLuck:0,lowAccuracyDodges:0,statusDodgeLuck:0,secondaryProcs:0,secondaryLuck:0,secondaryDodges:0,secondaryDodgeLuck:0,flinches:0,flinchLuck:0,confusionSelfHits:0,confusionLuck:0,protectSuccesses:0,protectLuck:0,fullParalysis:0,paralysisDodgeLuck:0,paralysisDodges:0,sleepTurns:0,sleepEvents:0,sleepDurationLuck:0,freezeTurns:0,freezeEvents:0,freezeDurationLuck:0};
        const t=out[key];
        t.games++;
        const l=r.luck[side] || {};
        for(const k of ['crits','critLuck','dodges','moveDodgeLuck','lowAccuracyHits','lowAccuracyHitLuck','lowAccuracyDodges','statusDodgeLuck','secondaryProcs','secondaryLuck','secondaryDodges','secondaryDodgeLuck','flinches','flinchLuck','confusionSelfHits','confusionLuck','protectSuccesses','protectLuck','fullParalysis','paralysisDodgeLuck','paralysisDodges','sleepTurns','sleepEvents','sleepDurationLuck','freezeTurns','freezeEvents','freezeDurationLuck']) t[k]+=Number(l[k]||0);
      }
    }
    return Object.values(out).map(t=>{
      t.score=t.critLuck+t.moveDodgeLuck+t.lowAccuracyHitLuck+t.statusDodgeLuck+t.secondaryLuck+t.secondaryDodgeLuck+t.flinchLuck+t.confusionLuck+t.protectLuck+t.paralysisDodgeLuck+t.sleepDurationLuck+t.freezeDurationLuck;
      return t;
    }).sort((a,b)=>b.score-a.score || b.games-a.games || a.team.localeCompare(b.team,undefined,{sensitivity:'base'}));
  }

  function luckPokemonData(scope){
    const out={};
    for(const r of allReplays(scope)){
      if(!r || !r.luckPokemon) continue;
      for(const [mk,l] of Object.entries(r.luckPokemon)){
        const species=String(l.species||mk.split('|')[1]||'').trim();
        if(!species) continue;
        const side=mk.split('|')[0];
        const replayTeam=teamFor(r.players?.[side]);
        const currentTeam=currentRosterTeamForPokemon(species);
        const team=currentTeam || replayTeam;
        const key=normName(species);
        if(!out[key]) out[key]={species,team,teams:new Set(),games:0,crits:0,critLuck:0,dodges:0,moveDodgeLuck:0,lowAccuracyHits:0,lowAccuracyHitLuck:0,lowAccuracyDodges:0,statusDodgeLuck:0,secondaryProcs:0,secondaryLuck:0,secondaryDodges:0,secondaryDodgeLuck:0,flinches:0,flinchLuck:0,confusionSelfHits:0,confusionLuck:0,protectSuccesses:0,protectLuck:0,fullParalysis:0,paralysisDodgeLuck:0,paralysisDodges:0,sleepTurns:0,sleepEvents:0,sleepDurationLuck:0,freezeTurns:0,freezeEvents:0,freezeDurationLuck:0};
        const p=out[key];
        if(team) p.teams.add(team);
        p.games++;
        for(const k of ['crits','critLuck','dodges','moveDodgeLuck','lowAccuracyHits','lowAccuracyHitLuck','lowAccuracyDodges','statusDodgeLuck','secondaryProcs','secondaryLuck','secondaryDodges','secondaryDodgeLuck','flinches','flinchLuck','confusionSelfHits','confusionLuck','protectSuccesses','protectLuck','fullParalysis','paralysisDodgeLuck','paralysisDodges','sleepTurns','sleepEvents','sleepDurationLuck','freezeTurns','freezeEvents','freezeDurationLuck']) p[k]+=Number(l[k]||0);
      }
    }
    return Object.values(out).map(p=>{
      p.team=Array.from(p.teams).join(', ');
      p.score=p.critLuck+p.moveDodgeLuck+p.lowAccuracyHitLuck+p.statusDodgeLuck+p.secondaryLuck+p.secondaryDodgeLuck+p.flinchLuck+p.confusionLuck+p.protectLuck+p.paralysisDodgeLuck+p.sleepDurationLuck+p.freezeDurationLuck;
      return p;
    }).sort((a,b)=>b.score-a.score || b.games-a.games || a.species.localeCompare(b.species,undefined,{sensitivity:'base'}));
  }

  function luckGameData(scope){
    const rows=[];
    for(const r of allReplays(scope)){
      if(!r || !r.luck) continue;
      let score=0;
      const totals={crits:0,dodges:0,lowAccuracyHits:0,statusDodges:0,secondary:0,flinches:0,confusion:0,protect:0,fullParalysis:0,sleep:0,freeze:0};
      for(const side of ['p1','p2']){
        const l=r.luck[side]||{};
        score += Number(l.critLuck||0)+Number(l.moveDodgeLuck||0)+Number(l.lowAccuracyHitLuck||0)+Number(l.statusDodgeLuck||0)+Number(l.secondaryLuck||0)+Number(l.secondaryDodgeLuck||0)+Number(l.flinchLuck||0)+Number(l.confusionLuck||0)+Number(l.protectLuck||0)+Number(l.paralysisDodgeLuck||0)+Number(l.sleepDurationLuck||0)+Number(l.freezeDurationLuck||0);
        totals.crits += Number(l.crits||0);
        totals.dodges += Number(l.dodges||0);
        totals.lowAccuracyHits += Number(l.lowAccuracyHits||0);
        totals.statusDodges += Number(l.statusDodgeLuck||0);
        totals.secondary += Number(l.secondaryLuck||0)+Number(l.secondaryDodgeLuck||0);
        totals.flinches += Number(l.flinches||0);
        totals.confusion += Number(l.confusionSelfHits||0);
        totals.protect += Number(l.protectSuccesses||0);
        totals.fullParalysis += Number(l.fullParalysis||0);
        totals.sleep += Number(l.sleepDurationLuck||0);
        totals.freeze += Number(l.freezeDurationLuck||0);
      }
      const p1=r.players?.p1||'?'; const p2=r.players?.p2||'?';
      rows.push({id:r.id||'',p1, p2, team1:teamFor(p1), team2:teamFor(p2), winner:r.winner||'', score, ...totals, uploadtime:Number(r.uploadtime||0)});
    }
    return rows.sort((a,b)=>b.score-a.score || b.uploadtime-a.uploadtime);
  }

  function openLuckPokemonSummary(species, scope){
    const rows=[];
    for(const r of allReplays(scope)){
      if(!r || !r.luckPokemon) continue;
      for(const [mk,l] of Object.entries(r.luckPokemon)){
        const sp=String(l.species||mk.split('|')[1]||'');
        if(normName(sp)!==normName(species)) continue;
        const events=Array.isArray(l.luckEvents)?l.luckEvents:[];
        if(!events.length) continue;
        const side=mk.split('|')[0];
        const currentTeam=currentRosterTeamForPokemon(sp);
        rows.push({replayId:r.id,turnEvents:events,team:currentTeam || teamFor(r.players?.[side]),opponent:teamFor(r.players?.[side==='p1'?'p2':'p1']),uploadtime:Number(r.uploadtime||0)});
      }
    }
    rows.sort((a,b)=>b.uploadtime-a.uploadtime);
    const events=rows.flatMap(x=>x.turnEvents.map(e=>({...e,replayId:x.replayId,team:x.team,opponent:x.opponent})));
    const score=events.reduce((n,e)=>n+Number(e.score||0),0);
    const byTurn={};
    for(const e of events){ const k=String(e.turn||0); (byTurn[k] ||= []).push(e); }
    const root=document.createElement('div');
    root.innerHTML=`<div class="pokemon-overlay" id="luckPokemonModal"><div class="pokemon-modal" role="dialog" aria-modal="true" aria-label="Luck summary for ${SBL.pokemon.escapeHtml(species)}"><div class="pokemon-modal-head"><div style="display:flex;align-items:center;gap:10px;">${SBL.pokemon.spriteMarkup(species,'sprite-xl')}<div><strong>${SBL.pokemon.escapeHtml(species)}</strong><div class="note">Luck summary · ${score>=0?'+':''}${score.toFixed(2)} luck</div></div></div><button class="ghost small" id="luckPokemonClose" type="button">Close ✕</button></div><div class="pokemon-modal-body"><div class="profile-grid"><div><span>Lucky events</span><strong>${events.filter(e=>e.score>0).length}</strong></div><div><span>Unlucky events</span><strong>${events.filter(e=>e.score<0).length}</strong></div><div><span>Games</span><strong>${rows.length}</strong></div><div><span>Net luck</span><strong>${score>=0?'+':''}${score.toFixed(2)}</strong></div></div><div class="section-divider"></div><h3 class="mini-heading">What turns did ${SBL.pokemon.escapeHtml(species)} get lucky?</h3>${Object.keys(byTurn).sort((a,b)=>Number(a)-Number(b)).map(turn=>`<div style="margin:0 0 12px;padding:10px 12px;background:var(--panel2);border:1px solid var(--border);border-radius:8px;"><strong>Turn ${SBL.pokemon.escapeHtml(turn)}</strong>${byTurn[turn].map(e=>`<div style="display:flex;gap:8px;align-items:flex-start;margin-top:7px;">${e.score>=0?'🍀':'💀'}<div><strong>${SBL.pokemon.escapeHtml(e.type.replace(/-/g,' '))}</strong> <span class="note">${e.score>=0?'+':''}${Number(e.score).toFixed(2)}</span><div class="note">${SBL.pokemon.escapeHtml(e.detail)} · ${SBL.pokemon.escapeHtml(e.team)} vs ${SBL.pokemon.escapeHtml(e.opponent)} · ${SBL.pokemon.escapeHtml(battleLabel(e.replayId))}</div></div></div>`).join('')}</div>`).join('') || '<div class="empty-state">No turn-by-turn luck events are stored yet. Reprocess the replays with the latest parser.</div>'}</div></div></div>`;
    document.body.appendChild(root.firstElementChild); document.body.style.overflow='hidden'; hideStatsNav();
    const modal=document.getElementById('luckPokemonModal');
    const closeLuck=()=>{modal.remove();document.body.style.overflow='';showStatsNav();};
    document.getElementById('luckPokemonClose').addEventListener('click',closeLuck);
    modal.addEventListener('click',e=>{if(e.target===modal)closeLuck();});
  }

  function renderLuckiestTeam(){
    contentEl.innerHTML=`<div class="panel">
      <h2>🍀 Luckiest</h2>
      <div class="luck-explanation"><div class="luck-explanation-title">How luck is scored</div><div class="luck-explanation-body">Luck is weighted by how unlikely each event was. Move misses use the move's actual accuracy; crits use the move's crit stage; low-accuracy hits use the move's actual hit chance; secondary effects (status, confusion, flinch, and secondary boosts) are scored from their actual proc chance; and consecutive protection uses Showdown's 1/3 success multiplier. Paralysis is scored for acting through full-paralysis checks, while sleep/freeze duration is scored against the normal duration baseline. Deterministic effects are not scored as luck.</div></div>
      <div class="stats-controls"><div class="stats-control"><label for="luckView">View</label><select id="luckView"><option value="team">Team</option><option value="pokemon">Pokemon</option><option value="game">Luckiest Game</option></select></div><div class="stats-control"><label for="luckWeek">Scope</label>${weekSelectorHtml('luckWeek')}</div></div>
      <div id="luckTable"></div>
    </div>`;
    const scopeSel=document.getElementById('luckWeek');
    const viewSel=document.getElementById('luckView');
    function draw(){
      const view=viewSel.value;
      if(view==='game'){
        const rows=luckGameData(scopeSel.value);
        document.getElementById('luckTable').innerHTML=!rows.length?`<div class="empty-state">No luck data for this scope yet. Reprocess the replays after updating the luck parser.</div>`:`<div class="franchise-table-wrap"><table class="franchise-table"><thead><tr><th>#</th><th>Game</th><th>Matchup</th><th>Winner</th><th class="num">Luck</th><th class="num">Crits</th><th class="num">Dodges</th><th class="num">Low-Acc Hits</th><th class="num">Status</th><th class="num">Secondary</th><th class="num">Flinches</th><th class="num">Confusion</th><th class="num">Protect</th><th class="num">Sleep</th><th class="num">Freeze</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td><span class="note">${SBL.pokemon.escapeHtml(battleLabel(r.id, r.id || 'Battle'))}</span></td><td><strong>${SBL.pokemon.escapeHtml(r.team1)}</strong> vs <strong>${SBL.pokemon.escapeHtml(r.team2)}</strong></td><td>${SBL.pokemon.escapeHtml(r.winner||'—')}</td><td class="num"><strong>${r.score>=0?'+':''}${r.score.toFixed(2)}</strong></td><td class="num">${r.crits}</td><td class="num">${r.dodges}</td><td class="num">${r.lowAccuracyHits}</td><td class="num">${r.statusDodges.toFixed(2)}</td><td class="num">${r.secondary>=0?'+':''}${r.secondary.toFixed(2)}</td><td class="num">${r.flinches}</td><td class="num">${r.confusion}</td><td class="num">${r.protect}</td><td class="num">${r.sleep>=0?'+':''}${r.sleep.toFixed(2)}</td><td class="num">${r.freeze>=0?'+':''}${r.freeze.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>`;
        return;
      }
      const pokemon=view==='pokemon';
      const rows=pokemon?luckPokemonData(scopeSel.value):luckTeamData(scopeSel.value);
      document.getElementById('luckTable').innerHTML=!rows.length?`<div class="empty-state">No luck data for this scope yet. Reprocess the replays after updating the luck parser.</div>`:`<div class="franchise-table-wrap"><table class="franchise-table"><thead><tr><th>#</th><th>${pokemon?'Pokemon':'Team'}</th><th class="num">Luck</th><th class="num">Crits</th><th class="num">Dodges</th><th class="num">Low-Acc Hits</th><th class="num">Status/Secondary</th><th class="num">Flinches</th><th class="num">Confusion</th><th class="num">Protect</th><th class="num">Full Paras</th><th class="num">Sleep</th><th class="num">Freeze</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${pokemon?`<span class="luck-pokemon-row" role="button" tabindex="0" data-luck-pokemon="${SBL.pokemon.escapeHtml(r.species)}" style="display:inline-flex;align-items:center;gap:7px;cursor:pointer;">${SBL.pokemon.spriteMarkup(r.species,'sprite')}<strong>${SBL.pokemon.escapeHtml(r.species)}</strong></span><div class="note">${SBL.pokemon.escapeHtml(r.team||'')}</div>`:`<strong>${SBL.pokemon.escapeHtml(r.team)}</strong><div class="note">${r.games} game${r.games===1?'':'s'}</div>`}</td><td class="num"><strong>${r.score>=0?'+':''}${r.score.toFixed(2)}</strong></td><td class="num">${r.crits}</td><td class="num">${r.dodges}</td><td class="num">${r.lowAccuracyHits}</td><td class="num">${(Number(r.statusDodgeLuck||0)+Number(r.secondaryLuck||0)+Number(r.secondaryDodgeLuck||0)).toFixed(2)}</td><td class="num">${r.flinches}</td><td class="num">${r.confusionSelfHits}</td><td class="num">${r.protectSuccesses}</td><td class="num">${r.fullParalysis}</td><td class="num">${r.sleepTurns} turns <span class="note">(${r.sleepDurationLuck>=0?'+':''}${r.sleepDurationLuck.toFixed(1)})</span></td><td class="num">${r.freezeTurns} turns <span class="note">(${r.freezeDurationLuck>=0?'+':''}${r.freezeDurationLuck.toFixed(1)})</span></td></tr>`).join('')}</tbody></table></div>`;
      if(pokemon){ document.querySelectorAll('[data-luck-pokemon]').forEach(el=>{el.addEventListener('click',()=>openLuckPokemonSummary(el.dataset.luckPokemon,scopeSel.value)); el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openLuckPokemonSummary(el.dataset.luckPokemon,scopeSel.value);}});}); }
    }
    scopeSel.addEventListener('change',draw);
    viewSel.addEventListener('change',draw);
    draw();
  }

  function renderMisc(){
    contentEl.innerHTML=`<div class="misc-wrap">
      <div class="panel misc-hero">
        <div>
          <h2>Misc Stats</h2>
          <div class="note">Fun league records and battle oddities from every processed replay.</div>
        </div>
        <div class="stats-control misc-stat-control"><label for="miscStat">Stat</label>
          <select id="miscStat"></select>
        </div>
      </div>
      <div class="panel misc-formula">
        <strong>How these stats work</strong>
        <span>Select a stat below to see its exact definition at the top of the leaderboard.</span>
        <span>Calculated/event-based stats are derived directly from the processed battle logs; raw totals are aggregated across all processed battles.</span>
      </div>
      <div id="miscGrid"></div>
    </div>`;

    const esc=v=>SBL.pokemon.escapeHtml(String(v??''));
    const all=()=>allReplays().filter(r=>r && r.misc);
    const STATUS_LABELS={tox:'Toxic',psn:'Poison',brn:'Burn',par:'Paralysis',slp:'Sleep',frz:'Freeze'};
    const statusCounter=()=>{
      const counts={};
      for(const r of all()) for(const [k,v] of Object.entries(r.misc?.statusInflicted||{})){
        const label=STATUS_LABELS[String(k).trim().toLowerCase()] || String(k).trim();
        counts[label]=(counts[label]||0)+Number(v||0);
      }
      return Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    };
    const topCounter=(field)=>{
      const counts={};
      for(const r of all()) for(const [k,v] of Object.entries(r.misc?.[field]||{})) counts[k]=(counts[k]||0)+Number(v||0);
      return Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    };
    const pokemonArray=(field,metric)=>{
      const counts={};
      for(const r of all()) for(const x of (r.misc?.[field]||[])){
        if(!x?.pokemon) continue;
        const display = SBL?.replays?.canonicalBattleSpecies ? SBL.replays.canonicalBattleSpecies(x.pokemon) : String(x.pokemon);
        const k=String(display).trim().toLowerCase();
        if(!counts[k]) counts[k]={pokemon:display,value:0};
        counts[k].value += metric?Number(x[metric]||0):1;
      }
      return Object.values(counts)
        .sort((a,b)=>b.value-a.value||a.pokemon.localeCompare(b.pokemon));
    };
    const pokemonMap=(metric)=>{
      const counts={};
      for(const r of all()) for(const x of Object.values(r.misc?.pokemon||{})){
        if(!x?.species) continue;
        const species=canonical(x.species);
        counts[species]=(counts[species]||0)+Number(x[metric]||0);
      }
      // Flinch counts also exist in the parser's per-Pokémon luck records. Use
      // them as a compatibility fallback for replays that predate the Misc
      // flinch field, while never double-counting replays that already have it.
      if(metric==='flinches'){
        // Older replay records may have flinches in luckPokemon but not in misc.pokemon.
        // Use the per-Pokémon misc count when present; otherwise fall back to the
        // corresponding luckPokemon record for that same Pokémon instance.
        for(const r of all()){
          const miscMons=Object.values(r.misc?.pokemon||{});
          for(const x of Object.values(r.luckPokemon||{})){
            if(!x?.species || Number(x.flinches||0)<=0) continue;
            const species=canonical(x.species);
            const matching=miscMons.filter(m=>canonical(m?.species||'')===species);
            const miscCount=matching.reduce((sum,m)=>sum+Number(m?.flinches||0),0);
            const luckCount=Number(x.flinches||0);
            if(miscCount===0) counts[species]=(counts[species]||0)+luckCount;
          }
        }
      }
      return Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    };
    const itemSprite=(name)=>{
      // Showdown item IDs are kebab-case, but its current icon directory does not
      // contain every newer item. Use Showdown first, then PokeAPI as a reliable
      // fallback for newer Gen 9 items.
      const raw=String(name||'').trim().toLowerCase().replace(/[’']/g,'');
      const aliases={
        'booster energy':'booster-energy','heavy-duty boots':'heavy-duty-boots','assault vest':'assault-vest',
        'clear amulet':'clear-amulet','eject pack':'eject-pack','blunder policy':'blunder-policy',
        'weakness policy':'weakness-policy','grassy seed':'grassy-seed','mirror herb':'mirror-herb','ability shield':'ability-shield'
      };
      const id=aliases[raw] || raw.replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
      if(!id) return '';
      const label=esc(name);
      // PokeAPI's maintained item sprite collection includes the newer Gen 9
      // items that are absent from some Showdown icon mirrors. Use it first,
      // then Showdown as a fallback for legacy/custom icons.
      const pokeapi=`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${encodeURIComponent(id)}.png`;
      const showdown=`https://play.pokemonshowdown.com/sprites/itemicons/${encodeURIComponent(id)}.png`;
      return `<img class="sprite misc-item-sprite" src="${pokeapi}" data-fallback-src="${showdown}" alt="${label}" title="${label}" width="32" height="32" loading="lazy" onerror="if(this.dataset.fallbackSrc && this.src!==this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;this.removeAttribute('data-fallback-src')}else{this.style.display='none'}">`;
    };
    const rowLabel=(label,kind)=>{
      if(kind==='pokemon') return `${SBL.pokemon.spriteMarkup(canonical(label),'misc-pokemon-sprite')}<span>${esc(label)}</span>`;
      if(kind==='status') return `<span>${esc(statusDisplayName(label))}</span>`;
      if(kind==='item') return `${itemSprite(label)}<span>${esc(label)}</span>`;
      return esc(label);
    };
    const statusDisplayName=(value)=>({tox:'Toxic',psn:'Poison',brn:'Burn',par:'Paralysis',slp:'Sleep',frz:'Freeze'})[String(value||'').toLowerCase()]||value;
    const statRows=(rows,kind)=>{
      if(!rows.length) return '<div class="empty-state">No data yet.</div>';
      return `<div class="misc-list">${rows.map((x,i)=>`<div class="misc-row"><span class="misc-rank">${i+1}</span><span class="misc-name${kind?' misc-with-sprite':''}">${rowLabel(x[0],kind)}</span><strong>${esc(x[2] ?? Number(x[1]).toLocaleString(undefined,{maximumFractionDigits:2}))}</strong></div>`).join('')}</div>`;
    };
    const monRows=(rows)=>{
      if(!rows.length) return '<div class="empty-state">No data yet.</div>';
      return `<div class="misc-list">${rows.map((x,i)=>`<div class="misc-row"><span class="misc-rank">${i+1}</span><span class="misc-name">${esc(x.pokemon)}</span><strong>${Number(x.value).toLocaleString()}</strong></div>`).join('')}</div>`;
    };
    const battleRows=(rows, formatter)=>{
      if(!rows.length) return '<div class="empty-state">No data yet.</div>';
      return `<div class="misc-list">${rows.map((x,i)=>`<div class="misc-row misc-battle-row"><span class="misc-rank">${i+1}</span><span class="misc-name">${esc(formatter(x))}</span><strong>${esc(x.value)}</strong></div>`).join('')}</div>`;
    };

    const battleMetric=(label, getValue, descending=true)=>{
      const rows=[];
      for(const r of all()){
        const value=Number(getValue(r)||0);
        if(!Number.isFinite(value) || value<=0) continue;
        rows.push({r,value});
      }
      rows.sort((a,b)=>(descending?b.value-a.value:a.value-b.value) || String(a.r.id).localeCompare(String(b.r.id)));
      return rows.map(x=>[battleLabel(x.r.id,x.r.id),x.value]);
    };

    const canonical=(name)=>SBL?.replays?.canonicalBattleSpecies ? SBL.replays.canonicalBattleSpecies(name) : String(name||'');

    const crossMatchKillStreak=()=>{
      const states={};
      const best={};
      const ordered=all().slice().sort((a,b)=>(replayTimestampMs(a)-replayTimestampMs(b)) || String(a.id||'').localeCompare(String(b.id||'')));
      for(const r of ordered){
        for(const [mk,x] of Object.entries(r.misc?.pokemon||{})){
          if(!x?.species) continue;
          const side=String(mk).split('|')[0];
          const team=teamFor(r.players?.[side]) || r.players?.[side] || side;
          const species=canonical(x.species);
          const key=`${String(team).trim().toLowerCase()}|${normName(species)}`;
          const downs=Math.max(0,Number(x.downs||0));
          const fallen=Math.max(0,Number(x.fallen||0));
          if(!states[key]) states[key]={pokemon:species,team,current:0,matches:0,startId:null,startBattle:null};
          const st=states[key];
          if(downs>0){
            st.current+=downs;
            st.matches+=1;
            if(!st.startId) st.startId=r.id;
          }
          if(fallen>0){
            if(st.current>0){
              const prev=best[key];
              if(!prev || st.current>prev.value || (st.current===prev.value && st.matches>prev.matches)) best[key]={pokemon:st.pokemon,team:st.team,value:st.current,matches:st.matches,replayId:r.id};
            }
            st.current=0; st.matches=0; st.startId=null; st.startBattle=null;
          }
        }
      }
      for(const [key,st] of Object.entries(states)){
        if(st.current>0){
          const prev=best[key];
          if(!prev || st.current>prev.value || (st.current===prev.value && st.matches>prev.matches)) best[key]={pokemon:st.pokemon,team:st.team,value:st.current,matches:st.matches,replayId:null};
        }
      }
      return Object.values(best).sort((a,b)=>b.value-a.value||b.matches-a.matches||a.pokemon.localeCompare(b.pokemon));
    };

    const statDefinitions=[
      {category:'Move Usage',name:'Most Used Move',desc:'Shows which moves have been used most often across all processed battles.',kind:'text',fn:()=>topCounter('moveUses')},
      {category:'Move Usage',name:'Most Missed Move',desc:'Shows which moves have produced the most misses in total. This is a raw miss count, not a miss rate.',kind:'text',fn:()=>topCounter('misses')},
      {category:'Move Usage',name:'Most Spammy Pokémon',desc:'Shows the biggest single example of a Pokémon repeatedly using the same move in one battle.',kind:'text',fn:()=>all().map(r=>r.misc?.mostSpammy).filter(Boolean).map(x=>[`${x.pokemon} · ${x.move} · ${battleLabel(x.replayId)}`,Number(x.count||0)]).sort((a,b)=>b[1]-a[1])},
      {category:'Items & Switching',name:'Most Consumed Item',desc:'Shows which held items have been consumed most often by their users.',kind:'item',fn:()=>topCounter('itemConsumed')},
      {category:'Items & Switching',name:'Most Knocked Off Item',desc:'Shows which held items have been specifically removed by Knock Off most often.',kind:'item',fn:()=>topCounter('itemKnockedOff')},
      {category:'Items & Switching',name:'Most Removed Item',desc:'Shows which held items have been removed by any tracked removal effect most often.',kind:'item',fn:()=>topCounter('itemRemoved')},
      {category:'Items & Switching',name:'Most Switches in a Battle',desc:'Shows which battle had the most total switches by both players combined.',fn:()=>battleMetric('switches',r=>r.misc?.mostSwitchesInBattle?.count)},
      {category:'Combat',name:'Most Statuses Inflicted',desc:'Shows which status conditions were successfully inflicted most often. Toxic is displayed as Toxic rather than the replay shorthand tox.',fn:()=>statusCounter()},
      {category:'Combat',name:'Most Critical Hits by Pokémon',desc:'Shows which Pokémon have landed the most critical hits across all processed battles.',kind:'pokemon',fn:()=>pokemonMap('crits')},
      {category:'Combat',name:'Most Flinches by Pokémon',desc:'Shows which Pokémon have successfully caused the most flinches across all processed battles.',kind:'pokemon',fn:()=>pokemonMap('flinches')},
      {category:'Battle Records',name:'Longest Battle',desc:'Shows every battle ranked by turn count. Use the sort control to view the longest or shortest battles first.',fn:()=>battleMetric('turns',r=>r.misc?.longestBattle)},
      {category:'Battle Records',name:'First Blood',desc:'Shows which Pokémon have scored the first KO of a battle most often.',kind:'pokemon',fn:()=>{const c={};for(const r of all()){const x=r.misc?.firstBlood;if(x?.pokemon){const k=canonical(x.pokemon);c[k]=(c[k]||0)+1;}}return Object.entries(c).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));}},
      {category:'Battle Records',name:'First Blood → Win',desc:'Shows how often each Pokémon’s first-blood KO came from the side that ultimately won. The percentage is wins after first blood divided by that Pokémon’s first-blood games.',kind:'pokemon',fn:()=>{const c={};for(const r of all()){const x=r.misc?.firstBloodWon;if(!x?.pokemon)continue;const k=canonical(x.pokemon);if(!c[k])c[k]={first:0,wins:0};c[k].first++;if(x.won)c[k].wins++;}return Object.entries(c).map(([k,v])=>[k,v.first?Math.round(v.wins/v.first*1000)/10:0,`${v.wins}/${v.first} (${v.first?Math.round(v.wins/v.first*1000)/10:0}%)`]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));}},
      {category:'Battle Records',name:'Most Comeback Wins',desc:'Shows which teams won after being down at least one Pokémon for more than half of the battle. The parser measures turns spent behind in remaining Pokémon.',fn:()=>{const c={};for(const r of all())for(const x of (r.misc?.comebackSides||[])){const player=r.players?.[x.side];if(!player)continue;const team=teamFor(player)||player;c[team]=(c[team]||0)+1;}return Object.entries(c).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));}},
      {category:'Momentum',name:'Kill Streak',desc:'Shows the longest uninterrupted KO streak by a Pokémon across matches. The streak continues through matches where the Pokémon does not appear and ends only when that Pokémon is KOed.',kind:'pokemon',fn:()=>crossMatchKillStreak().map(x=>[x.pokemon,x.value,`${x.value} KOs${x.matches>1?` · ${x.matches} matches`:''}`])},
      {category:'Momentum',name:'Most Closers',desc:'Shows which Pokémon have landed the final KO that ended the opponent’s full roster most often.',kind:'pokemon',fn:()=>pokemonArray('closers').map(x=>[x.pokemon,x.value])},
      {category:'Momentum',name:'Most Revenge KOs',desc:'Shows which Pokémon most often answered a teammate’s recent KO with a KO of their own. A revenge KO uses the parser’s tracked two-turn response window.',kind:'pokemon',fn:()=>pokemonArray('revengeKOs').map(x=>[x.pokemon,x.value])},
      {category:'Momentum',name:'Most Trade KOs',desc:'Shows which Pokémon have been involved in rapid KO exchanges where an opposing KO is answered within the tracked exchange window.',kind:'pokemon',fn:()=>pokemonArray('trades').map(x=>[x.pokemon,x.value])},
      {category:'Momentum',name:'Sacrifices',desc:'Shows Pokémon that objectively look like a sack: they entered after a teammate fainted, were KOed within two active turns, and did not score a KO. This measures the sequence, not player intent.',kind:'pokemon',fn:()=>pokemonArray('sacrifices').map(x=>[x.pokemon,x.value])},
      {category:'Faints',name:'Most First to Fall',desc:'Shows which Pokémon are most often the first Pokémon KOed in their battles.',kind:'pokemon',fn:()=>{const c={};for(const r of all()){const x=r.misc?.firstFallen;if(x?.pokemon){const k=canonical(x.pokemon);c[k]=(c[k]||0)+1;}}return Object.entries(c).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));}},
      {category:'Faints',name:'Most Last to Fall',desc:'Shows which Pokémon are most often the final Pokémon KOed on their losing side.',kind:'pokemon',fn:()=>{const c={};for(const r of all()){const x=r.misc?.lastFallen;if(x?.pokemon){const k=canonical(x.pokemon);c[k]=(c[k]||0)+1;}}return Object.entries(c).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));}}
    ];

    const sel=document.getElementById('miscStat');
    const categories=[...new Set(statDefinitions.map(x=>x.category))];
    sel.innerHTML=categories.map(cat=>`<optgroup label="${esc(cat)}">${statDefinitions.filter(x=>x.category===cat).map(x=>`<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('')}</optgroup>`).join('');
    function draw(){
      const name=sel.value;
      const def=statDefinitions.find(x=>x.name===name) || statDefinitions[0];
      const rows=def.fn();
      const sortableBattle = def.name === 'Longest Battle';
      const sortControl = sortableBattle ? `<label class="stats-control misc-sort-control">Sort <select id="miscBattleSort"><option value="desc">Longest first</option><option value="asc">Shortest first</option></select></label>` : '';
      document.getElementById('miscGrid').innerHTML=`<div class="panel misc-card">
        <div class="misc-card-head"><div><h3>${esc(def.name)}</h3><div class="note">${esc(def.desc)}</div></div><div class="misc-card-actions">${sortControl}<span class="count">${rows.length} entries</span></div></div>
        <div id="miscRows">${statRows(rows,def.kind)}</div>
      </div>`;
      if(sortableBattle){
        const sort=document.getElementById('miscBattleSort');
        const renderSorted=()=>{
          const sorted=[...rows].sort((a,b)=>(sort.value==='asc'?a[1]-b[1]:b[1]-a[1])||String(a[0]).localeCompare(String(b[0])));
          document.getElementById('miscRows').innerHTML=statRows(sorted,def.kind);
        };
        sort.addEventListener('change',renderSorted);
      }
    }
    sel.addEventListener('change',draw);
    draw();
  }

  function teamComparisonData(weekFilter){
    const out={};
    // Current roster teams must remain visible even before they have replay data.
    for(const rosterTeam of Object.keys(STATE.settings?.rosters||{})){
      const key=groupKey(rosterTeam);
      if(!out[key]) out[key]={team:rosterTeam,players:new Set(),games:0,wins:0,losses:0,kills:0,deaths:0,dealt:0,taken:0};
    }
    for(const r of allReplays(weekFilter)){
      if(!r || !r.players) continue;
      const sides=['p1','p2'];
      for(const side of sides){
        const team=teamFor(r.players[side]); const key=groupKey(team);
        if(!out[key]) out[key]={team,players:new Set(),games:0,wins:0,losses:0,kills:0,deaths:0,dealt:0,taken:0};
        const t=out[key]; t.games++; t.players.add(r.players[side]||'?');
        const result = r.results && r.results[side] ? r.results[side] : (r.winner && r.winner.toLowerCase()===(r.players[side]||'').toLowerCase() ? 'W' : (r.winner ? 'L' : null));
        if(result==='W') t.wins++;
        else if(result==='L') t.losses++;
        for(const k in r.mons){ const m=r.mons[k]; if(m.side===side){t.kills+=m.kills||0;t.deaths+=m.deaths||0;t.dealt+=m.damageDealt||0;t.taken+=m.damageTaken||0;} }
      }
    }
    return Object.values(out).sort((a,b)=>b.wins-a.wins || (b.kills-b.deaths)-(a.kills-a.deaths) || b.dealt-a.dealt);
  }

  // ---------- fixture (schedule) ----------
  // The fixture is generated/uploaded from Admin -> Settings and stored in the
  // same shared settings blob, so it's already present in STATE.settings.fixture
  // by the time this renders. Matches are cross-referenced against processed
  // replays (by week + the two franchise names) to show a result once played.
  function findFixtureResult(week, home, away){
    const target = new Set([groupKey(home), groupKey(away)]);
    for(const r of Object.values(STATE.replays)){
      if(!r || !r.players) continue;
      if((r.week || 'Unassigned') !== week) continue;
      const t1 = teamFor(r.players.p1), t2 = teamFor(r.players.p2);
      const pair = new Set([groupKey(t1), groupKey(t2)]);
      if(pair.size !== 2 || ![...pair].every(x => target.has(x))) continue;
      let winnerTeam = null;
      if(r.winner){
        const wLower = String(r.winner).trim().toLowerCase();
        if(wLower === String(r.players.p1 || '').trim().toLowerCase()) winnerTeam = t1;
        else if(wLower === String(r.players.p2 || '').trim().toLowerCase()) winnerTeam = t2;
      }
      return {played:true, winner:winnerTeam};
    }
    return {played:false};
  }
  function renderFixturePanel(){
    const fixture = STATE.settings?.fixture;
    const rounds = Array.isArray(fixture?.rounds) ? fixture.rounds : [];
    if(!rounds.length){
      return `<div class="panel">
        <h2>Fixture</h2>
        <div class="empty-state">No fixture has been published yet. The commissioner can generate or upload one from Admin → Settings.</div>
      </div>`;
    }
    const matchCount = rounds.reduce((sum,r)=>sum+(r.matches?r.matches.length:0),0);
    return `<div class="panel">
      <h2>Fixture</h2>
      <div class="note">${rounds.length} week${rounds.length===1?'':'s'} · ${matchCount} match${matchCount===1?'':'es'}${fixture.source==='upload'?' · uploaded':''}</div>
      <div class="fixture-weeks">
        ${rounds.map(r=>{
          const matches = Array.isArray(r.matches) ? r.matches : [];
          return `<div class="fixture-week">
            <div class="fixture-week-title">${SBL.pokemon.escapeHtml(r.week||'')}</div>
            <div class="fixture-matches">
              ${matches.length ? matches.map(m=>{
                const res = findFixtureResult(r.week, m.home, m.away);
                const homeWin = res.played && res.winner && groupKey(res.winner)===groupKey(m.home);
                const awayWin = res.played && res.winner && groupKey(res.winner)===groupKey(m.away);
                return `<div class="fixture-match ${res.played?'fixture-played':''}">
                  <span class="fixture-team ${homeWin?'fixture-winner':''}">${SBL.pokemon.escapeHtml(m.home)}</span>
                  <span class="fixture-vs">vs</span>
                  <span class="fixture-team ${awayWin?'fixture-winner':''}">${SBL.pokemon.escapeHtml(m.away)}</span>
                  <span class="fixture-status">${res.played ? (res.winner ? `${SBL.pokemon.escapeHtml(res.winner)} won` : 'Played') : 'Not played yet'}</span>
                </div>`;
              }).join('') : '<div class="conference-empty">No matches this week.</div>'}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  function standingsPanelHtml(){
    const data = teamComparisonData('ALL');
    const assignments = STATE.settings?.franchises || {};
    const configuredNames = STATE.settings?.conferenceNames || {};
    const conferenceNames = {
      one: String(configuredNames.a || 'Conference A').trim() || 'Conference A',
      two: String(configuredNames.b || 'Conference B').trim() || 'Conference B'
    };

    // The admin page stores conference assignments by franchise name. Match those
    // assignments case-insensitively so a harmless capitalization difference does
    // not cause a team to disappear from its conference.
    const conferenceFor = team => {
      const exact = assignments[team];
      if(exact === 'a' || exact === 'b') return exact;
      const key = String(team||'').trim().toLowerCase();
      const found = Object.keys(assignments).find(k => String(k).trim().toLowerCase() === key);
      if(found && (assignments[found] === 'a' || assignments[found] === 'b')) return assignments[found];
      return 'Unassigned';
    };

    const groups = {one:[], two:[], Unassigned:[]};
    data.forEach(team => {
      const conf = conferenceFor(team.team);
      (groups[conf === 'a' ? 'one' : conf === 'b' ? 'two' : 'Unassigned']).push(team);
    });

    // Keep the same ranking logic inside each conference.
    Object.values(groups).forEach(list => list.sort((a,b)=>
      b.wins-a.wins ||
      (b.kills-b.deaths)-(a.kills-a.deaths) ||
      b.dealt-a.dealt ||
      a.team.localeCompare(b.team,undefined,{sensitivity:'base'})
    ));

    function ladder(title, list, subtitle, extraClass=''){
      return `<section class="conference-block ${extraClass}">
        <div class="conference-heading">
          <div><div class="conference-title">${SBL.pokemon.escapeHtml(title)}</div><div class="conference-sub">${SBL.pokemon.escapeHtml(subtitle)}</div></div>
          <div class="conference-count">${list.length} franchise${list.length===1?'':'s'}</div>
        </div>
        ${list.length ? `<div class="standings-ladder">${list.map((x,i)=>{
          const pct=x.games ? (100*x.wins/x.games).toFixed(1)+'%' : '—';
          const diff=x.kills-x.deaths;
          return `<div class="standings-row standings-clickable ${i===0?'top1':i===1?'top2':''}" data-standings-team="${SBL.pokemon.escapeHtml(x.team)}" role="button" tabindex="0" title="View ${SBL.pokemon.escapeHtml(x.team)} summary">
            <div class="standings-rank">${i+1}</div>
            <div class="standings-team">
              <div class="standings-team-name">${SBL.pokemon.escapeHtml(x.team)}</div>
              <div class="standings-record">${x.wins}-${x.losses} record · ${x.games} game${x.games===1?'':'s'}</div>
            </div>
            <div class="standings-stat"><span class="standings-stat-label">W-L</span>${x.wins}-${x.losses}</div>
            <div class="standings-stat standings-pct"><span class="standings-stat-label">Win %</span>${pct}</div>
            <div class="standings-stat"><span class="standings-stat-label">K-D</span><span class="${diff>=0?'kills':'taken'}">${diff>0?'+':''}${diff}</span></div>
            <div class="standings-stat"><span class="standings-stat-label">Damage</span>${x.dealt.toFixed(1)}</div>
          </div>`;
        }).join('')}</div>` : `<div class="conference-empty">No franchises assigned to this conference.</div>`}
      </section>`;
    }

    const note = Object.keys(assignments).length
      ? 'Standings are split using the conference assignments saved in Admin → Settings. Unassigned franchises remain visible below.'
      : 'No conference assignments have been saved yet. Assign each franchise to a conference from Admin → Settings.';

    return `<div class="panel">
      <h2>Standings</h2>
      <div class="note">${SBL.pokemon.escapeHtml(note)}</div>
      <div class="conference-standings">
        ${ladder(conferenceNames.one,groups.one,'Conference standings')}
        ${ladder(conferenceNames.two,groups.two,'Conference standings')}
        ${groups.Unassigned.length ? ladder('Unassigned',groups.Unassigned,'Franchises without an East/West assignment','unassigned') : ''}
      </div>
    </div>`;
  }

  function renderSeason(){
    contentEl.innerHTML = renderFixturePanel() + standingsPanelHtml();

    // Reuse the exact same franchise summary card used by League Overview.
    contentEl.querySelectorAll('[data-standings-team]').forEach(row=>{
      const open=()=>openTeamOverview(row.dataset.standingsTeam);
      row.addEventListener('click',open);
      row.addEventListener('keydown',e=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); open(); } });
    });
  }


  function spriteImg(species, cls){
    return SBL.pokemon.spriteMarkup(species, cls || 'sprite');
  }

  function renderGoldenFist(){
    return window.SBLStatsUI.renderGoldenFist({globalPokemonStats,weekSelectorHtml,spriteImg,escapeHtml,auditDataAttr,download,toCSV});
  }

  function renderTeams(){
    const data=franchiseRosterData('ALL');
    const teams=Object.keys(data).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
    const defaultTeam=teams[0] || '';

    contentEl.innerHTML=`
      <div class="franchise-shell">
        <div class="franchise-header panel">
          <div>
            <h2>Franchise Stats</h2>
            <div class="note">Every Pokémon shown below comes directly from the currently published roster. A Pokémon remains visible even if it has 0 appearances. Replay data only fills its statistics.</div>
          </div>
          <div class="franchise-actions">
            <div>
              <label for="franchiseTeamFilter">Franchise</label>
              <select id="franchiseTeamFilter">
                ${teams.map(t=>`<option value="${SBL.pokemon.escapeHtml(t)}">${SBL.pokemon.escapeHtml(t)}</option>`).join('')}
              </select>
            </div>
            <button class="ghost" id="exportTeams">Export CSV</button>
          </div>
        </div>
        <div id="franchiseCards" class="franchise-cards"></div>
      </div>`;

    if(!teams.length){
      document.getElementById('franchiseCards').innerHTML=`<div class="panel empty-state">No published rosters were found.</div>`;
      return;
    }

    const cards=document.getElementById('franchiseCards');
    const filter=document.getElementById('franchiseTeamFilter');
    filter.value=defaultTeam;

    function draw(){
      const selected=filter.value;
      const info=data[selected];
      if(!info){
        cards.innerHTML=`<div class="panel empty-state">No roster data found for this franchise.</div>`;
        return;
      }
      const linked=Array.from(info.linkedPlayers).sort((a,b)=>a.localeCompare(b));
      const total=info.total;
      const activeMons=info.roster.filter(s=>s.appearances>0).length;
      const sortedRoster=[...info.roster].sort((a,b)=>{ const ap=Number(a.points); const bp=Number(b.points); const aValid=Number.isFinite(ap); const bValid=Number.isFinite(bp); if(aValid&&bValid&&bp!==ap) return bp-ap; if(aValid!==bValid) return aValid?-1:1; return String(a.species||'').localeCompare(String(b.species||''),undefined,{sensitivity:'base'}); });
      const rows=sortedRoster.map((s,i)=>`
        <tr>
          <td class="rank">${i+1}</td>
          <td><div class="pname-cell">${pokemonName(s.species,true,'sprite-xl')}</div></td>
          <td class="num">${s.points==null||s.points===''?'—':SBL.pokemon.escapeHtml(s.points)}</td>
          <td class="num dealt">${s.dealt.toFixed(1)}</td>
          <td class="num taken">${s.taken.toFixed(1)}</td>
          <td class="num kills">${s.kills}</td>
          <td class="num">${s.appearances ? (s.kills/s.appearances).toFixed(2) : '0.00'}</td>
          <td ${auditAttr(s.species,'assists',s.assistLog)}>${s.assists||0}</td>
          <td class="num taken">${s.deaths}</td>
          <td class="num">${s.appearances}</td>
        </tr>`).join('');
      cards.innerHTML=`
        <section class="franchise-card panel">
          <div class="franchise-card-head">
            <div>
              <div class="franchise-title">${SBL.pokemon.escapeHtml(info.name)}</div>
              <div class="franchise-sub">${info.roster.length} rostered Pokémon · ${activeMons} with appearances</div>
              ${linked.length ? `<div class="franchise-coaches">${linked.map(escapeHtml).join(', ')}</div>` : `<div class="franchise-coaches muted">No player↔franchise mapping found for replay stats</div>`}
            </div>
            <div class="franchise-total-grid">
              <div><span>Damage</span><strong>${total.dealt.toFixed(1)}</strong></div>
              <div><span>Taken</span><strong>${total.taken.toFixed(1)}</strong></div>
              <div><span>Knockouts</span><strong>${total.kills}</strong></div>
              <div><span>Assists</span><strong>${total.assists||0}</strong></div>
              <div><span>Fallen</span><strong>${total.deaths}</strong></div>
            </div>
          </div>
          <div class="franchise-table-wrap">
            <table class="franchise-table">
              <thead><tr><th>#</th><th>Pokémon</th><th class="num">Points</th><th class="num">Dmg Dealt</th><th class="num">Dmg Taken</th><th class="num">Kills</th><th class="num">Kills/Game</th><th class="num">Assists</th><th class="num">Fallen</th><th class="num">Apps</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </section>`;
      bindPokemonClicks(cards);
    }

    filter.addEventListener('change',draw);
    document.getElementById('exportTeams').addEventListener('click',()=>exportTeamCSVs(selectedExportTeam(),'Season'));
    function selectedExportTeam(){ return filter.value || defaultTeam; }
    draw();
  }

  // ---------- replay browser ----------
  function replayBrowserData(){
    return Object.values(STATE.replays).map(r=>{
      const p1=(r.players?.p1||'?').trim()||'?';
      const p2=(r.players?.p2||'?').trim()||'?';
      const winner=(r.winner||'').trim();
      let result='Unknown';
      if(winner){
        if(winner.toLowerCase()===p1.toLowerCase()) result=`${p1} won`;
        else if(winner.toLowerCase()===p2.toLowerCase()) result=`${p2} won`;
        else result=`${winner} won`;
      }
      const mons=Object.values(r.mons||{});
      const pokemon=[...new Set(mons.map(m=>m.species).filter(Boolean))];
      const teams=[teamFor(p1),teamFor(p2)];
      return {r,p1,p2,winner,result,pokemon,teams,week:r.week||'Unassigned',format:r.format||'—'};
    }).sort((a,b)=> (String(b.week).localeCompare(String(a.week),undefined,{numeric:true})) || ((b.r.processedAt||0)-(a.r.processedAt||0)));
  }

  function renderReplayBrowser(){
    const data=replayBrowserData();
    const weeks=[...new Set(data.map(x=>x.week))].sort(weekSort);
    const players=[...new Set(data.flatMap(x=>[x.p1,x.p2]).filter(x=>x&&x!=='?'))].sort((a,b)=>a.localeCompare(b));
    const teams=[...new Set(data.flatMap(x=>x.teams).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    contentEl.innerHTML=`
      <div class="panel">
        <h2>Replay Browser</h2>
        <div class="note">Search and filter every processed replay. Click <strong>View replay</strong> to open the original Pokémon Showdown battle.</div>
        <div class="row" style="align-items:flex-end;margin-top:0;">
          <div style="min-width:210px;flex:1"><label>Search</label><input id="replaySearch" type="text" placeholder="Player, franchise, Pokémon, replay ID…"></div>
          <div><label>Week</label><select id="replayWeek"><option value="ALL">All weeks</option>${weeks.map(w=>`<option value="${SBL.pokemon.escapeHtml(w)}">${SBL.pokemon.escapeHtml(w)}</option>`).join('')}</select></div>
          <div><label>Player</label><select id="replayPlayer"><option value="ALL">All players</option>${players.map(x=>`<option value="${SBL.pokemon.escapeHtml(x)}">${SBL.pokemon.escapeHtml(x)}</option>`).join('')}</select></div>
          <div><label>Franchise</label><select id="replayTeam"><option value="ALL">All franchises</option>${teams.map(x=>`<option value="${SBL.pokemon.escapeHtml(x)}">${SBL.pokemon.escapeHtml(x)}</option>`).join('')}</select></div>
          <div><label>Result</label><select id="replayResult"><option value="ALL">All results</option><option value="KNOWN">Completed</option><option value="UNKNOWN">Unknown result</option></select></div>
        </div>
        <div id="replayCount" class="note" style="margin-top:12px;"></div>
        <div id="replayBrowserBody" style="margin-top:10px;"></div>
      </div>`;

    const search=document.getElementById('replaySearch');
    const controls=['replayWeek','replayPlayer','replayTeam','replayResult'].map(id=>document.getElementById(id));
    function draw(){
      const q=search.value.trim().toLowerCase();
      const [week,player,team,result]=controls.map(x=>x.value);
      const filtered=data.filter(x=>{
        if(week!=='ALL' && x.week!==week) return false;
        if(player!=='ALL' && x.p1!==player && x.p2!==player) return false;
        if(team!=='ALL' && !x.teams.includes(team)) return false;
        if(result==='KNOWN' && !x.winner) return false;
        if(result==='UNKNOWN' && x.winner) return false;
        if(q){
          const hay=[x.r.id,x.week,x.p1,x.p2,x.result,x.format,...x.teams,...x.pokemon].join(' ').toLowerCase();
          if(!hay.includes(q)) return false;
        }
        return true;
      });
      document.getElementById('replayCount').textContent=`Showing ${filtered.length} of ${data.length} replay${data.length===1?'':'s'}.`;
      document.getElementById('replayBrowserBody').innerHTML=!filtered.length?`<div class="empty-state">No replays match those filters.</div>`:`<table><thead><tr><th class="rank">#</th><th>Week</th><th>Matchup</th><th>Franchises</th><th>Format</th><th>Result</th><th></th><th></th></tr></thead><tbody>${filtered.map((x,i)=>`<tr>
        <td class="rank">${i+1}</td>
        <td>${SBL.pokemon.escapeHtml(x.week)}</td>
        <td class="pname">${SBL.pokemon.escapeHtml(x.p1)} <span style="color:var(--text-dim)">vs</span> ${SBL.pokemon.escapeHtml(x.p2)}</td>
        <td><span class="badge">${SBL.pokemon.escapeHtml(x.teams[0]||'?')}</span> <span style="color:var(--text-dim)">vs</span> <span class="badge">${SBL.pokemon.escapeHtml(x.teams[1]||'?')}</span></td>
        <td style="color:var(--text-dim)">${SBL.pokemon.escapeHtml(x.format)}</td>
        <td>${x.winner ? `<span class="kills">${SBL.pokemon.escapeHtml(x.result)}</span>` : `<span class="badge">Unknown</span>`}</td>
        <td class="num"><button class="ghost small" data-replay-summary="${SBL.pokemon.escapeHtml(x.r.id)}">Summary</button></td>
        <td class="num"><span class="note">${SBL.pokemon.escapeHtml(battleLabel(x.r.id))}</span></td>
      </tr>`).join('')}</tbody></table>`;
    }
    search.addEventListener('input',draw);
    controls.forEach(c=>c.addEventListener('change',draw));
    draw();
  }

  function renderSettings(){
    const entries = Object.entries(STATE.teamMap);
    contentEl.invisible;
    contentEl.innerHTML = `
      <div class="panel">
        <h2>Player → Team name mapping</h2>
        <div class="note">Map each Showdown username to your league's team/trainer name, so stats group correctly. Unmapped usernames just show as-is.</div>
        <div class="row" style="margin-top:12px; align-items:center;">
          <label style="display:flex; align-items:center; gap:8px; margin:0; cursor:pointer;">
            <input type="checkbox" id="caseInsensitiveToggle" ${STATE.settings.caseInsensitiveNames ? 'checked' : ''}>
            Ignore case when grouping team names (e.g. "Team Fire" and "team fire" count as the same team)
          </label>
        </div>
        <div id="mapRows" style="margin-top:12px;"></div>
        <div class="map-row">
          <input type="text" id="newUser" placeholder="showdown username">
          <input type="text" id="newTeam" placeholder="team name">
          <button class="ghost small" id="addMap">Add</button>
        </div>
      </div>
      <div class="panel">
        <h2>Possible duplicate players</h2>
        <div class="note">Usernames that look like the same person typed differently (e.g. <code>dossa37</code> / <code>dossa_37</code>, or <code>podraa</code> / <code>podrrraaa</code>). Merging points every variant at whichever one has played the most games.</div>
        <div id="dupPlayers" style="margin-top:12px;"></div>
      </div>
      <div class="panel">
        <h2>Possible duplicate teams (shared roster)</h2>
        <div class="note">Since this is a draft league each team's roster is fixed — two team tags whose Pokémon overlap heavily are probably the same team under two different names. Merging groups everything under the tag with the most total appearances.</div>
        <div id="dupTeams" style="margin-top:12px;"></div>
      </div>
      <div class="panel">
        <h2>Shared data</h2>
        <div class="note">Shared database: <strong>Supabase</strong>. You are signed in as the league administrator.</div>
        <div class="foot-actions">
          <button class="ghost" id="migrateLocal">Migrate old browser data to shared database</button>
          <button class="ghost" id="refreshShared">Reload shared data</button>
          <button class="ghost" id="adminLogout">Log out</button>
        </div>
      </div>
      <div class="panel">
        <h2>Data</h2>
        <div class="note">Removing a replay updates every leaderboard immediately. Back up regularly.</div>
        <div class="note">Removing a replay updates every leaderboard immediately. Back up regularly if you're on local storage.</div>
        <div class="foot-actions">
          <button class="ghost" id="exportBackup">Download backup (.json)</button>
          <button class="ghost" id="importBackupBtn">Restore from backup</button>
          <input type="file" id="importBackupFile" accept="application/json" style="display:none;">
          <button class="ghost danger-btn" id="resetAll">Clear all season data</button>
        </div>
      </div>`;
    const mapRows = document.getElementById('mapRows');
    function drawMap(){
      const entries = Object.entries(STATE.teamMap);
      mapRows.innerHTML = entries.length===0 ? `<div class="empty-state">No mappings yet.</div>` :
        entries.map(([u,t])=>`
        <div class="map-row">
          <input type="text" value="${SBL.pokemon.escapeHtml(u)}" disabled>
          <input type="text" value="${SBL.pokemon.escapeHtml(t)}" disabled>
          <button class="ghost small danger-btn" data-del="${SBL.pokemon.escapeHtml(u)}">Remove</button>
        </div>`).join('');
      mapRows.querySelectorAll('[data-del]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          delete STATE.teamMap[btn.dataset.del];
          await saveTeamMap();
          drawMap();
          render();
        });
      });
    }
    drawMap();

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
          drawMap();
          drawDupPlayers();
          drawDupTeams();
          render();
        });
      });
    }
    drawDupTeams();

    document.getElementById('caseInsensitiveToggle').addEventListener('change', async (e)=>{
      STATE.settings.caseInsensitiveNames = e.target.checked;
      await saveSettings();
      render();
    });
    document.getElementById('addMap').addEventListener('click', async ()=>{
      const u = document.getElementById('newUser').value.trim().toLowerCase();
      const t = document.getElementById('newTeam').value.trim();
      if(!u || !t) return;
      STATE.teamMap[u] = t;
      await saveTeamMap();
      document.getElementById('newUser').value='';
      document.getElementById('newTeam').value='';
      drawMap();
    });
    document.getElementById('migrateLocal').addEventListener('click', async ()=>{
      try{
        if(!confirm('Upload this browser\'s old local dashboard data to the shared database? Existing shared data will be merged/replaced by the local state.')) return;
        await migrateLocalData();
        alert('Migration complete. The shared database now contains this browser\'s dashboard data.');
        renderTicker(); render();
      }catch(err){ alert('Migration failed: ' + err.message); }
    });
    document.getElementById('refreshShared').addEventListener('click', async ()=>{
      await loadState(); renderTicker(); render();
    });
    document.getElementById('adminLogout').addEventListener('click', async ()=>{
      await supabase.auth.signOut();
      adminUser = null;
      showAdminLogin();
    });
    document.getElementById('resetAll').addEventListener('click', async ()=>{
      if(!confirm('This clears every processed replay for the whole league. Continue?')) return;
      STATE.replays = {};
      await deleteAllRemote();
      await saveSharedState();
      renderTicker();
      render();
    });
    document.getElementById('exportBackup').addEventListener('click', ()=>{
      const blob = new Blob([JSON.stringify(STATE, null, 2)], {type:'application/json'});
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `league-dashboard-backup-${new Date().toISOString().slice(0,10)}.json`;
      link.click();
    });
    document.getElementById('importBackupBtn').addEventListener('click', ()=>{
      document.getElementById('importBackupFile').click();
    });
    document.getElementById('importBackupFile').addEventListener('change', async (e)=>{
      const file = e.target.files[0];
      if(!file) return;
      try{
        const text = await file.text();
        const data = JSON.parse(text);
        if(!data.replays) throw new Error('not a valid backup file');
        if(!confirm(`This will replace your current data with the backup (${Object.keys(data.replays).length} replays). Continue?`)) return;
        STATE.replays = data.replays || {};
        STATE.teamMap = data.teamMap || {};
        STATE.settings = Object.assign({caseInsensitiveNames:true}, data.settings || {});
        await saveReplays();
        await saveSharedState();
        renderTicker();
        render();
      }catch(err){
        alert('Could not read that backup file: ' + err.message);
      }
      e.target.value = '';
    });
  }

  async function loadPokemonTypes(){
    try{
      const cached = localStorage.getItem('sbl_pokedex_types_v1');
      if(cached) POKEDEX_TYPES = JSON.parse(cached);
      const res = await fetch('https://play.pokemonshowdown.com/data/pokedex.json',{cache:'force-cache'});
      if(!res.ok) throw new Error('Pokédex request failed');
      const dex = await res.json();
      const out = {};
      for(const [key,val] of Object.entries(dex)){
        if(Array.isArray(val.types)) out[key.toLowerCase().replace(/[^a-z0-9]/g,'')] = {types:val.types};
      }
      POKEDEX_TYPES = out;
      localStorage.setItem('sbl_pokedex_types_v1',JSON.stringify(out));
    }catch(e){
      console.warn('Could not load Pokémon typing data; cached data will be used.',e);
    }
  }

  // ---------- init ----------
  document.addEventListener('keydown', (e)=>{
    if(e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    goToTab('pokemonsearch');
  });
  document.addEventListener('keydown', (e)=>{
    if((e.key==='Enter' || e.key===' ') && e.target.closest('[data-assist-pokemon]')){
      e.preventDefault();
      e.target.closest('[data-assist-pokemon]').click();
    }
    if((e.key==='Enter' || e.key===' ') && e.target.closest('[data-pokemon]')){
      e.preventDefault();
      e.target.closest('[data-pokemon]').click();
    }
    if(e.key==='Escape') { e.preventDefault(); closeTopPopup(); }
  });
  document.addEventListener('click', (e)=>{
    const auditCell = e.target.closest('[data-audit]');
    const assistPokemon = e.target.closest('[data-assist-pokemon]');
    if(assistPokemon && !auditCell){
      e.preventDefault(); e.stopPropagation(); openAssistProfile(assistPokemon.dataset.assistPokemon, document.getElementById('assistWeek')?.value || 'ALL'); return;
    }
    const pokemon = e.target.closest('[data-pokemon]');
    if(pokemon && !auditCell){
      e.preventDefault();
      e.stopPropagation();
      openPokemonProfile(pokemon.dataset.pokemon);
      return;
    }
    const summaryBtn = e.target.closest('[data-replay-summary]');
    if(summaryBtn){
      e.preventDefault();
      openReplaySummary(summaryBtn.dataset.replaySummary);
      return;
    }
    const cell = auditCell;
    if(!cell) return;
    try{
      const {species, type, list, showLink} = JSON.parse(cell.dataset.audit);
      openAudit(species, type, list, showLink);
    }catch(err){ /* malformed payload, ignore */ }
  });
  // Catch Pokémon links inserted by any tab renderer. This complements the delegated click handler.
  const pokemonObserver = new MutationObserver(mutations=>{
    for(const m of mutations){
      for(const node of m.addedNodes){
        if(node.nodeType===1) bindPokemonClicks(node);
      }
    }
  });
  pokemonObserver.observe(document.body,{childList:true,subtree:true});

  (async function init(){
    // Stats is a protected page: direct URL access requires a login.
    if(IS_ADMIN_PAGE){
      const ok = await initAdminAuth();
      if(!ok) return;
    } else {
      const app = document.getElementById('app');
      if(app) app.style.display = '';
    }

    await loadState();

    // Render the active tab immediately after the shared state is available.
    // The banner/ticker is auxiliary UI and must never be able to prevent the
    // League Overview from rendering on the initial page load.
    render();
    try{ renderTicker(); }catch(e){ console.warn('Banner render failed:', e); }
    // Warm the Pokémon search index after the first paint.
    preparePokemonSearchCache();

    // Pokémon typing is enhancement data; do not block the initial dashboard.
    loadPokemonTypes().then(()=>{
      try{ render(); }catch(e){ console.warn('Post-type render failed:', e); }
      try{ renderTicker(); }catch(e){ console.warn('Post-type banner render failed:', e); }
    });
    // Public dashboard polls the shared database every 10 seconds. This keeps the
    // viewer page read-only while still making new replay data appear automatically.
    if(!IS_ADMIN_PAGE){
      setInterval(async ()=>{ try{ await refreshSharedState(); }catch(e){ console.warn('Shared refresh failed', e); } }, POLL_MS);
    }
  })();
})();
