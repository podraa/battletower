(function(){
  const SHARED = true; // league data shared with anyone viewing this dashboard (cloud mode only)
  let STATE = { replays:{}, teamMap:{}, settings:{ caseInsensitiveNames:true, teamLogos:{}, bannerMode:'top', bannerTeam:'', rosters:{}, conferences:{} } };
  let PUBLISHED_ROSTERS = {};
  let loaded = false;

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

  async function refreshSharedState(){
    if(loadingFromRemote) return;
    const before = JSON.stringify({r:Object.keys(STATE.replays).length,t:STATE.teamMap,s:STATE.settings});
    await loadState();
    const after = JSON.stringify({r:Object.keys(STATE.replays).length,t:STATE.teamMap,s:STATE.settings});
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
    const {data, error} = await supabase.auth.getSession();
    if(error){ showAdminLogin(); return false; }
    if(!data.session){ showAdminLogin(); return false; }
    const profile = await SBL.profiles.get(data.session.user.id, 'team_name', supabase);
     if(!profile?.team_name){
      // Logged in but hasn't claimed/been assigned a team yet — no access to
      // the rest of the site until that's done from the login page.
      showAdminLogin();
      return false;
    }
    adminUser = data.session.user;
    document.getElementById('app').style.display = '';
    return true;
  }

  // ---------- helpers ----------
  function normName(n){
    const raw=String(n??'').trim().toLowerCase().replace(/-/g,' ').replace(/_/g,' ').replace(/\s+/g,' ');
    if(raw.replace(/\s+/g,'')==='yefmoc') return 'comfey';
    return raw;
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
  function weeksList(){
    const set = new Set(Object.values(STATE.replays).map(r=>r.week || 'Unassigned'));
    return Array.from(set).sort((a,b)=>{ if(a==='Unassigned') return 1; if(b==='Unassigned') return -1; const na=parseInt(String(a).replace(/\D/g,''),10), nb=parseInt(String(b).replace(/\D/g,''),10); return (na||999999)-(nb||999999); });
  }
  function globalPokemonStats(weekFilter){
    const out = {}; // normSpecies -> {species, dealt, taken, kills, deaths, games, coaches}
    for(const r of allReplays(weekFilter)){
      for(const k in r.mons){
        const m = r.mons[k];
        const displaySpecies = normName(m.species)==='comfey' ? 'Comfey' : m.species;
        const nk = normName(displaySpecies);
        if(!out[nk]) out[nk] = {species:displaySpecies, dealt:0, taken:0, kills:0, deaths:0, games:0, killLog:[], deathLog:[], coaches:new Set()};
        out[nk].dealt += m.damageDealt;
        out[nk].taken += m.damageTaken;
        out[nk].kills += m.kills;
        out[nk].deaths += m.deaths;
        out[nk].games += m.appearances;
        if(m.killLog) out[nk].killLog.push(...m.killLog);
        if(m.deathLog) out[nk].deathLog.push(...m.deathLog);
        out[nk].coaches.add(teamFor(r.players[m.side]));
      }
    }
    return Object.values(out).sort((a,b)=>b.dealt-a.dealt);
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
    const target=normName(species);
    if(!target) return '';
    const rosters=STATE.settings?.rosters||{};
    for(const team of Object.keys(rosters)){
      const mons=rosterEntries(rosters[team]);
      if(mons.some(mon=>normName(canonicalRosterSpecies(mon))===target)) return team;
    }
    return '';
  }
  function isCurrentRosterPokemon(team,species){
    const r=rosterForTeam(team);
    return !r.length || r.some(x=>normName(canonicalRosterSpecies(x))===normName(species));
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
        total:{dealt:0,taken:0,kills:0,deaths:0,appearances:0},
        linkedPlayers:new Set(),
        replayCount:0
      };

      for(const item of roster){
        const species = canonicalRosterSpecies(item);
        const key = normName(species);
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
          appearances:0,
          killLog:[],
          deathLog:[]
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
          const target=team.byKey[normName(species)];
          if(!target) continue;
          target.dealt += Number(stat.damageDealt)||0;
          target.taken += Number(stat.damageTaken)||0;
          target.kills += Number(stat.kills)||0;
          target.deaths += Number(stat.deaths)||0;
          target.appearances += Number(stat.appearances)||0;
          if(Array.isArray(stat.killLog)) target.killLog.push(...stat.killLog);
          if(Array.isArray(stat.deathLog)) target.deathLog.push(...stat.deathLog);
        }
      }
    }

    for(const team of Object.values(result)){
      for(const stat of team.roster){
        team.total.dealt += stat.dealt;
        team.total.taken += stat.taken;
        team.total.kills += stat.kills;
        team.total.deaths += stat.deaths;
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
    const rows = [['Pokemon','Total Damage Dealt','Avg Damage Dealt per Game','Games Played']];
    stats.forEach(s => rows.push([s.species, s.dealt.toFixed(2), (s.games? (s.dealt/s.games):0).toFixed(2), s.games]));
    download(`Damage Leaderboard - ${label}.csv`, toCSV(rows));
  }
  function exportTeamCSVs(weekFilter, label){
    const teams = teamPokemonStats(weekFilter);
    for(const team in teams){
      const rows = [['Pokemon','Total Damage Dealt','Total Damage Taken','Total Kills','Total Deaths','Appearances']];
      const list = Object.values(teams[team]).sort((a,b)=>b.dealt-a.dealt);
      list.forEach(s => rows.push([s.species, s.dealt.toFixed(2), s.taken.toFixed(2), s.kills, s.deaths, s.games]));
      download(`${team} - ${label}.csv`, toCSV(rows));
    }
  }
  // ---------- rendering ----------
  const contentEl = document.getElementById('content');
  const tabsEl = document.getElementById('tabs');
  let activeTab = 'season';

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


  function updateModalPageLock(){
    const locked = !!document.querySelector('.audit-overlay, .pokemon-overlay');
    document.documentElement.classList.toggle('modal-page-locked', locked);
    document.body.classList.toggle('modal-page-locked', locked);
    if(locked){
      document.documentElement.style.overflow='hidden';
      document.body.style.overflow='hidden';
    }else{
      document.documentElement.style.overflow='';
      document.body.style.overflow='';
    }
  }

  function closePokemonProfile(){
    const el=document.getElementById('pokemonProfileModal');
    if(el) el.remove();
    updateModalPageLock();
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
        <div class="pokemon-modal-body">${renderPokemonProfile(species,'ALL')}</div>
      </div>
    </div>`;
    document.body.appendChild(root.firstElementChild);
    updateModalPageLock();
    const overlay=document.getElementById(modalId);
    document.getElementById('pokemonProfileClose').addEventListener('click',closePokemonProfile);
    overlay.addEventListener('click',e=>{ if(e.target===overlay) closePokemonProfile(); });
    requestAnimationFrame(()=>document.getElementById('pokemonProfileClose')?.focus());
  }

  function openReplaySummary(replayId){
    const r = STATE.replays[replayId];
    if(!r){ return; }
    const p1 = (r.players?.p1 || '?').trim() || '?';
    const p2 = (r.players?.p2 || '?').trim() || '?';
    const winner = (r.winner || '').trim();
    const resultText = winner ? `${winner} won` : 'Result unavailable';
    const mons = Object.values(r.mons || {});
    const sideMons = side => { const seen={}; (r.teamRoster?.[side]||[]).forEach(sp=>seen[normName(sp)]={side,species:sp,kills:0,deaths:0,damageDealt:0,damageTaken:0,appearances:0}); mons.filter(m=>m.side===side).forEach(m=>seen[normName(m.species)]=m); return Object.values(seen).sort((a,b)=>
      (b.kills-a.kills) || (a.deaths-b.deaths) || (b.damageDealt-a.damageDealt)); };
    const sideCard = (side, player) => {
      const list = sideMons(side);
      const team = teamFor(player);
      const kills = list.reduce((n,m)=>n+m.kills,0);
      const deaths = list.reduce((n,m)=>n+m.deaths,0);
      const dealt = list.reduce((n,m)=>n+m.damageDealt,0);
      const taken = list.reduce((n,m)=>n+m.damageTaken,0);
      return `<div class="summary-side">
        <div class="summary-side-head"><div><strong>${SBL.pokemon.escapeHtml(player)}</strong><div class="summary-team">${SBL.pokemon.escapeHtml(team)}</div></div><div class="summary-score">${deaths} fainted</div></div>
        <div class="summary-line"><span>${kills} kills</span><span>${dealt.toFixed(1)}damage dealt</span><span>${taken.toFixed(1)}damage taken</span></div>
        <div class="summary-mons">${list.map(m=>`<div class="summary-mon">
          ${pokemonLink(m.species, `${SBL.pokemon.spriteMarkup(m.species,'sprite')}<div class="summary-mon-main"><div class="pname-cell"><strong>${SBL.pokemon.escapeHtml(m.species)}</strong></div><div class="summary-mon-stats">${m.kills} K · ${m.deaths} D · ${m.damageDealt.toFixed(1)} dmg</div></div>`)}
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
          <div class="summary-actions"><a class="primary nav-link" href="https://replay.pokemonshowdown.com/${SBL.pokemon.escapeHtml(r.id)}" target="_blank" rel="noopener">Open Showdown replay</a><button class="ghost" id="summaryClose">Close</button></div>
        </div>
      </div>`;
    updateModalPageLock();
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
    const overlay = el.querySelector('.audit-overlay');
    if(!overlay){ el.innerHTML=''; updateModalPageLock?.(); return; }
    overlay.classList.add('is-closing');
    window.setTimeout(()=>{
      if(el.contains(overlay)) overlay.remove();
      updateModalPageLock?.();
    }, 180);
  }
  // Global backdrop safety net for every audit/overview overlay. This avoids
  // relying on individual renderers having exactly the right target check.
  document.addEventListener('pointerdown', (e)=>{
    const overlay = e.target.closest?.('.audit-overlay');
    if(overlay && e.target === overlay){ closeAudit(); }
  }, true);

  function closeTopPopup(){
    const pokemon=document.getElementById('pokemonProfileModal');
    if(pokemon){pokemon.remove();updateModalPageLock?.();return true;}
    const audit=document.querySelector('#auditModal .audit-overlay');
    if(audit){closeAudit();return true;}
    return false;
  }
  function openAudit(species, type, list, showLink){
    showLink = showLink !== false;
    const label = type === 'kills' ? 'Kills' : 'Deaths';
    const rows = (list || []).slice().sort((a,b)=> (a.replayId||'').localeCompare(b.replayId||'') || (a.turn-b.turn));
    document.getElementById('auditModal').innerHTML = `
      <div class="audit-overlay" id="auditOverlay">
        <div class="audit-box">
          <h3>${pokemonLink(species, SBL.pokemon.escapeHtml(species))} — ${label} (${rows.length})</h3>
          <div class="audit-sub">Every ${type==='kills'?'kill':'death'} credited to this Pokémon this scope, with the turn${showLink?', replay,':''} and why it was credited.</div>
          ${rows.length===0 ? `<div class="empty-state">No entries.</div>` : `<ul class="audit-list">
            ${rows.map(r=>`<li>
              <span>Turn ${r.turn} — ${type==='kills' ? 'vs ' + (r.victim ? pokemonLink(r.victim, SBL.pokemon.escapeHtml(r.victim), '', false) : '?') : (r.killer ? 'by ' + pokemonLink(r.killer, SBL.pokemon.escapeHtml(r.killer), '', false) : 'unattributed')} <span class="audit-cause">(${SBL.pokemon.escapeHtml(r.cause||'—')})</span></span>
              ${showLink ? `<a href="https://replay.pokemonshowdown.com/${SBL.pokemon.escapeHtml(r.replayId)}" target="_blank" rel="noopener">${SBL.pokemon.escapeHtml(r.replayId)}</a>` : ''}
            </li>`).join('')}
          </ul>`}
          <div class="foot-actions"><button class="ghost" id="auditClose">Close</button></div>
        </div>
      </div>`;
    updateModalPageLock();
    document.getElementById('auditClose').addEventListener('click', closeAudit);
    document.getElementById('auditOverlay').addEventListener('click', (e)=>{ if(e.target.id === 'auditOverlay') closeAudit(); });
  }


  function render(){
    document.getElementById('app').classList.toggle('wide', activeTab === 'teams' || activeTab === 'global' || activeTab === 'goldenfist' || activeTab === 'luckiest' || activeTab === 'pokemonsearch' || activeTab === 'causes' || activeTab === 'season' || activeTab === 'replays' || activeTab === 'overview');
    if(!loaded){ contentEl.innerHTML = `<div class="empty-state">Loading…</div>`; return; }
    if(activeTab === 'overview') return renderLeagueOverview();
    if(activeTab === 'process') return renderProcess();
    if(activeTab === 'global') return renderLeaderboards();
    if(activeTab === 'pokemonsearch') return renderPokemonSearch();
    if(activeTab === 'goldenfist') return renderGoldenFist();
    if(activeTab === 'luckiest') return renderLuckiestTeam();
    if(activeTab === 'causes') return renderDeathCauses();
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
  function renderBanner(){
    const mode=STATE.settings.bannerMode||'top';
    const teams=teamStandings('ALL');
    const teamOptions=teams.map(t=>`<option value="${SBL.pokemon.escapeHtml(t.team)}" ${STATE.settings.bannerTeam===t.team?'selected':''}>${SBL.pokemon.escapeHtml(t.team)}</option>`).join('');
    const controls=`<div class="banner-controls"><div><label>Banner</label><select id="bannerMode"><option value="top" ${mode==='top'?'selected':''}>Top Pokémon</option><option value="team" ${mode==='team'?'selected':''}>Team Stats</option><option value="golden" ${mode==='golden'?'selected':''}>Golden Fist</option></select></div><div id="bannerTeamWrap" style="display:${mode==='top'||mode==='golden'?'none':'block'}"><label>Team</label><select id="bannerTeam">${teamOptions}</select></div></div>`;
    let cards='';
    if(mode==='golden'){
      cards=globalPokemonStats('ALL').map(s=>({...s,diff:s.kills-s.deaths})).sort((a,b)=>b.diff-a.diff||b.kills-a.kills).slice(0,5).map((s,i)=>`<div class="banner-pokemon"><div style="font-family:var(--mono);color:var(--text-dim);width:24px">${i+1}</div>${SBL.pokemon.spriteMarkup(s.species,'sprite')}<div><div class="name">${SBL.pokemon.escapeHtml(s.species)}</div><div class="banner-stat">${s.diff>0?'+':''}${s.diff}</div><div class="note" style="margin:2px 0 0">${s.kills} K · ${s.deaths} D</div></div></div>`).join('');
    } else if(mode==='top'){
      cards=globalPokemonStats('ALL').slice(0,5).map(s=>`<div class="banner-pokemon">${SBL.pokemon.spriteMarkup(s.species,'sprite')}<div><div class="name">${SBL.pokemon.escapeHtml(s.species)}</div><div class="banner-stat">${s.dealt.toFixed(0)} ⚔</div><div class="note" style="margin:2px 0 0">${s.kills} K · ${s.deaths} D</div></div></div>`).join('');
    } else {
      const selected=teams.find(t=>t.team===STATE.settings.bannerTeam)||teams[0];
      if(selected){
        const list=Object.values(teamPokemonStats('ALL')[selected.team]||{}).sort((a,b)=>b.appearances-a.appearances||b.dealt-a.dealt).slice(0,5);
        cards=`<div class="banner-team-card"><img class="team-logo" src="${SBL.pokemon.escapeHtml(teamLogo(selected.team))}" onerror="this.style.display='none'" alt=""><div><div class="name">${SBL.pokemon.escapeHtml(selected.team)}</div><div class="banner-stat">${selected.wins}-${selected.losses}</div><div class="note" style="margin:2px 0 0">${selected.games?((100*selected.wins/selected.games).toFixed(1)+'% win rate'): 'No games'}</div></div></div>`+list.map(s=>`<div class="banner-pokemon">${SBL.pokemon.spriteMarkup(s.species,'sprite')}<div><div class="name">${SBL.pokemon.escapeHtml(s.species)}</div><div class="banner-stat">${s.appearances} games</div><div class="note" style="margin:2px 0 0">${s.kills} K · ${s.deaths} D</div></div></div>`).join('');
      }
    }
    return controls+`<div class="ticker" id="ticker">${cards||'<div class="tick empty"><div class="val">No banner data yet</div></div>'}</div>`;
  }
  function renderLeagueOverview(){
    const data=teamStandings('ALL').slice().sort((a,b)=>a.team.localeCompare(b.team,undefined,{sensitivity:'base'}));
    contentEl.innerHTML=`<div class="panel"><h2>League Overview</h2><div class="note">Click a franchise for a quick league summary.</div><div id="overviewTeams" style="margin-top:18px"></div></div>`;
    const el=document.getElementById('overviewTeams');
    if(!data.length){el.innerHTML='<div class="empty-state">No team data yet.</div>';return;}
    el.innerHTML=`<div class="team-card-grid">${data.map(t=>{const mons=Object.values(teamPokemonStats('ALL')[t.team]||{}).sort((a,b)=>b.appearances-a.appearances||b.dealt-a.dealt); const top=mons[0]?.species; const logo=teamLogo(t.team); const sprite=top?`<div class="team-card-top-wrap">${SBL.pokemon.spriteMarkup(top,'team-card-top-sprite')}</div>`:''; return `<div class="team-card" data-team-card="${SBL.pokemon.escapeHtml(t.team)}"><div class="team-card-head"><div class="team-card-copy">${logo?`<img class="team-logo" src="${SBL.pokemon.escapeHtml(logo)}" alt="" style="display:none">`:''}<div class="team-card-name">${SBL.pokemon.escapeHtml(t.team)}</div><div class="team-card-sub">${t.wins}-${t.losses}</div></div>${sprite}</div></div>`}).join('')}</div>`;
    el.querySelectorAll('[data-team-card]').forEach(card=>card.addEventListener('click',()=>openTeamOverview(card.dataset.teamCard)));
  }
  // Every remaining (unplayed) fixture match involving this team, in
  // schedule order — the literal games left on the "route to qualification".
  function conferenceRemainingFixtures(team){
    const fixture = STATE.settings?.fixture;
    const rounds = Array.isArray(fixture?.rounds) ? fixture.rounds : [];
    const remaining = [];
    rounds.forEach(r=>{
      (r.matches || []).forEach(m=>{
        if(groupKey(m.home) !== groupKey(team) && groupKey(m.away) !== groupKey(team)) return;
        const res = findFixtureResult(r.week, m.home, m.away);
        if(res.played) return;
        const opponent = groupKey(m.home) === groupKey(team) ? m.away : m.home;
        remaining.push({week: r.week, opponent});
      });
    });
    return remaining;
  }

  // Qualification engine: exhaustive final-table simulation for the current
  // conference. It considers every remaining fixture that can change the
  // conference teams' overall win totals, including cross-conference games.
  // A team is qualified only if EVERY possible final table keeps it inside
  // the finals cut. An exact seed is clinched only if EVERY possible final
  // table gives that same seed.
  function qualificationMatches(conf){
    const rounds = Array.isArray(STATE.settings?.fixture?.rounds) ? STATE.settings.fixture.rounds : [];
    const out=[];
    for(const r of rounds){
      for(const m of (r.matches||[])){
        const home=String(m.home||'').trim(), away=String(m.away||'').trim();
        if(!home||!away) continue;
        // Conference qualification is based on the same overall win totals
        // used by the standings. Therefore EVERY remaining game involving a
        // team in this conference can change its final seed, including
        // cross-conference games. A cross-conference winner simply gives no
        // additional win to a conference team.
        if(conferenceOf(home)!==conf && conferenceOf(away)!==conf) continue;
        const res=findFixtureResult(r.week,home,away);
        if(res.played) continue;
        out.push({week:r.week,home,away,homeKey:groupKey(home),awayKey:groupKey(away)});
      }
    }
    return out;
  }

  function qualificationBaseTeams(conf){
    return (conferenceGroups()[conf==='a'?'one':'two']||[]).map(x=>({
      team:x.team,wins:Number(x.wins||0),diff:Number(x.diff||0),dealt:Number(x.dealt||0)
    }));
  }

  function qualificationRank(base,matches,assignment){
    const rows=base.map(x=>({...x}));
    const byKey=new Map(rows.map(x=>[groupKey(x.team),x]));
    assignment.forEach((v,i)=>{
      if(v==null) return;
      const m=matches[i];
      const winner=byKey.get(v===0?m.homeKey:m.awayKey);
      if(winner) winner.wins++;
    });
    rows.sort((a,b)=>b.wins-a.wins||b.diff-a.diff||b.dealt-a.dealt||a.team.localeCompare(b.team,undefined,{sensitivity:'base'}));
    return rows;
  }

  function qualificationEnumerate(conf){
    const matches=qualificationMatches(conf), base=qualificationBaseTeams(conf);
    const outcomes=[];
    const a=Array(matches.length).fill(0);
    function dfs(i){
      if(i===matches.length){outcomes.push({assignment:a.slice(),ranking:qualificationRank(base,matches,a)});return;}
      a[i]=0; dfs(i+1); a[i]=1; dfs(i+1);
    }
    // Conference schedules are normally small. If a pathological schedule is
    // supplied, stop rather than fabricate qualification results.
    if(matches.length>18) return {matches,base,outcomes:[],tooMany:true};
    dfs(0);
    return {matches,base,outcomes,tooMany:false};
  }

  function qualificationScenarioResults(team,matches,assignment){
    const key=groupKey(team), own=[], other=[];
    matches.forEach((m,i)=>{
      const v=assignment[i]; if(v==null) return;
      const winner=v===0?m.home:m.away, loser=v===0?m.away:m.home;
      if(m.homeKey===key||m.awayKey===key) own.push({winner,loser,won:m.homeKey===key?v===0:v===1});
      else other.push({winner,loser,index:i});
    });
    return {own,other};
  }

  // A result is relevant to a displayed route only when flipping that single
  // game changes the team's final seed. This removes the old "X stays ahead"
  // filler while retaining every result that actually changes the seed.
  function qualificationPivotalAssignment(team,seed,matches,base,assignment){
    const out=[];
    for(let i=0;i<assignment.length;i++){
      const flipped=assignment.slice(); flipped[i]=assignment[i]===0?1:0;
      const s1=qualificationRank(base,matches,assignment).findIndex(x=>groupKey(x.team)===groupKey(team))+1;
      const s2=qualificationRank(base,matches,flipped).findIndex(x=>groupKey(x.team)===groupKey(team))+1;
      if(s2!==s1) out.push(i);
    }
    return out;
  }

  function qualificationScenarioText(team,seed,matches,base,assignment){
    const rank=qualificationRank(base,matches,assignment);
    const currentSeed=rank.findIndex(x=>groupKey(x.team)===groupKey(team))+1;
    const pivotal=qualificationPivotalAssignment(team,seed,matches,base,assignment);
    const indexes=new Set(pivotal);
    const own=[], others=[];
    matches.forEach((m,i)=>{
      if(!indexes.has(i)) return;
      const v=assignment[i];
      const winner=v===0?m.home:m.away, loser=v===0?m.away:m.home;
      if(m.homeKey===groupKey(team)||m.awayKey===groupKey(team)) own.push({winner,loser,won:(m.homeKey===groupKey(team)?v===0:v===1)});
      else others.push({winner,loser});
    });
    const parts=[];
    if(own.length){
      const wins=own.filter(x=>x.won).length, total=conferenceRemainingFixtures(team).length;
      if(wins===own.length && wins===total) parts.push(`Win your final game${total===1?'':'s'}`);
      else if(wins===0 && own.length===total) parts.push(`Lose your final game${total===1?'':'s'}`);
      else own.forEach(x=>parts.push(x.won?`Beat ${SBL.pokemon.escapeHtml(x.loser)}`:`Lose to ${SBL.pokemon.escapeHtml(x.winner)}`));
    }
    for(const x of others) parts.push(`Have ${SBL.pokemon.escapeHtml(x.winner)} beat ${SBL.pokemon.escapeHtml(x.loser)}`);
    if(!parts.length) return 'This seed is reachable without any single result being decisive; multiple result combinations can produce it.';
    return parts.join('; ');
  }

  // Maximum possible differential swing between two tied teams from the
  // remaining games. A win can add at most 6 differential and a loss can
  // subtract at most 6, so a pair of independent final games can swing the
  // gap by at most 12. This prevents impossible tiebreak routes (for example
  // a required +17 swing) from being presented as reachable scenarios.
  function qualificationMaxDifferentialSwing(team,opp,matches){
    const teamKey=groupKey(team), oppKey=groupKey(opp);
    let maxSwing=0;
    for(const m of matches){
      const involvesTeam=m.homeKey===teamKey||m.awayKey===teamKey;
      const involvesOpp=m.homeKey===oppKey||m.awayKey===oppKey;
      if(involvesTeam && involvesOpp) maxSwing += 12;
      else if(involvesTeam || involvesOpp) maxSwing += 6;
    }
    return maxSwing;
  }

  function qualificationDifferentialFeasible(team,ranked,base,matches=[]){
    const me=ranked.find(x=>groupKey(x.team)===groupKey(team)); if(!me) return true;
    const mine=base.find(x=>groupKey(x.team)===groupKey(team));
    if(!mine) return true;
    for(const o of ranked){
      if(groupKey(o.team)===groupKey(team)||o.wins!==me.wins) continue;
      const opp=base.find(x=>groupKey(x.team)===groupKey(o.team));
      const gap=Number(opp?.diff||0)-Number(mine?.diff||0);
      const need=Math.abs(gap)+1;
      if(need>qualificationMaxDifferentialSwing(team,o.team,matches)) return false;
    }
    return true;
  }

  function qualificationDifferentialNote(team,ranked,base,matches=[],assignment=[]){
    const me=ranked.find(x=>groupKey(x.team)===groupKey(team)); if(!me) return '';
    const mine=base.find(x=>groupKey(x.team)===groupKey(team));
    if(!mine) return '';

    const notes=[];
    for(const o of ranked){
      if(groupKey(o.team)===groupKey(team)||o.wins!==me.wins) continue;
      const opp=base.find(x=>groupKey(x.team)===groupKey(o.team));
      const gap=Number(opp?.diff||0)-Number(mine?.diff||0);
      const need=Math.abs(gap)+1;

      // Find the remaining games that actually move the two tied teams'
      // differentials in this scenario. A win margin for the user's team
      // adds that margin; a loss subtracts it. Likewise, the opponent's
      // win adds its margin. This lets the explanation describe the two
      // margins together instead of giving only an abstract differential gap.
      let myGame=null, oppGame=null;
      matches.forEach((m,i)=>{
        const hk=m.homeKey, ak=m.awayKey;
        if(hk===groupKey(team)||ak===groupKey(team)) myGame={m,i};
        if(hk===groupKey(o.team)||ak===groupKey(o.team)) oppGame={m,i};
      });

      if(gap>0){
        let detail='';
        if(myGame && oppGame && myGame.i!==oppGame.i){
          // If both teams are playing, the required relative swing is: 
          // user's win margin + opponent's loss margin >= need.
          detail=` <strong>Need a +${need} swing.</strong> Your win margin + ${SBL.pokemon.escapeHtml(o.team)}'s loss margin must be at least ${need}.`;
          detail+=` Example: they lose by 5 → you need to win by ${Math.max(1,need-5)}.`;
          detail+=` They lose by 1 → you need to win by ${Math.max(1,need-1)}.`;
        } else if(myGame){
          detail=` Your result is the relevant margin swing: you need to win by at least ${need} more differential than your current deficit allows.`;
        } else if(oppGame){
          detail=` Their result is the relevant margin swing: they need to lose by enough to give you the required ${need}-point swing.`;
        }
        notes.push(`${SBL.pokemon.escapeHtml(o.team)} is currently ${gap} differential ahead. If you finish tied on ${me.wins} wins, you need to gain at least ${need} differential to pass them.${detail}`);
      } else if(gap<0){
        const lead=-gap;
        let detail='';
        if(myGame && oppGame && myGame.i!==oppGame.i){
          detail=` <strong>Need a +${lead+1} swing.</strong> Their win margin + your loss margin must be at least ${lead+1}.`;
          detail+=` Example: you lose by 5 → they need to win by ${Math.max(1,lead+1-5)}.`;
          detail+=` You lose by 1 → they need to win by ${Math.max(1,lead)}.`;
        }
        notes.push(`You are currently ${lead} differential ahead of ${SBL.pokemon.escapeHtml(o.team)}. If you finish tied on ${me.wins} wins, they need to gain at least ${lead+1} differential to pass you.${detail}`);
      } else {
        notes.push(`You and ${SBL.pokemon.escapeHtml(o.team)} are currently tied on differential at ${me.wins} wins, so the remaining game margins will decide the seed.`);
      }
    }
    return notes.join('<br>');
  }

  function qualificationBuildAnalysis(team){
    const conf=conferenceOf(team); if(!conf) return null;
    const currentList=conferenceGroups()[conf==='a'?'one':'two']||[];
    const currentSeed=currentList.findIndex(x=>groupKey(x.team)===groupKey(team))+1;
    if(currentSeed<1) return null;
    const engine=qualificationEnumerate(conf);
    if(engine.tooMany) return {error:'Too many unplayed conference games to enumerate safely.'};
    const {matches,base,outcomes}=engine;
    const bySeed=new Map();
    outcomes.forEach(o=>{
      const seed=o.ranking.findIndex(x=>groupKey(x.team)===groupKey(team))+1;
      if(!bySeed.has(seed)) bySeed.set(seed,[]);
      bySeed.get(seed).push(o);
    });
    const reachableSeeds=[...bySeed.keys()].sort((a,b)=>a-b);
    const finalsSeeds=reachableSeeds.filter(s=>s<=6);
    // A franchise outside the top six of its conference can never be
    // finals-clinched, even if a malformed/partial scenario enumeration only
    // exposes its current seed. Keep the cutoff as a hard invariant.
    const finalsClinched=currentSeed<=6 && reachableSeeds.length>0 && reachableSeeds.every(s=>s<=6);
    const exactClinched=currentSeed<=6 && reachableSeeds.length===1 && reachableSeeds[0]===currentSeed;

    // Pick routes by number of pivotal games, then by total wording length.
    const routes={};
    for(const [seed,arr] of bySeed){
      const candidates=[];
      for(const o of arr){
        const pivotal=qualificationPivotalAssignment(team,seed,matches,base,o.assignment);
        const text=qualificationScenarioText(team,seed,matches,base,o.assignment);
        const ranked=qualificationRank(base,matches,o.assignment);
        // Do not display a route if its final tiebreak would require more
        // differential swing than the remaining games can physically produce.
        if(!qualificationDifferentialFeasible(team,ranked,base,matches)) continue;
        candidates.push({assignment:o.assignment,text,pivotalCount:pivotal.length});
      }
      candidates.sort((a,b)=>a.pivotalCount-b.pivotalCount||a.text.length-b.text.length);
      const seen=new Set(); routes[seed]=[];
      for(const c of candidates){
        const sig=c.text;
        if(seen.has(sig)) continue;
        seen.add(sig); routes[seed].push(c);
        // A maximum of three genuinely different routes keeps the panel readable
        // without hiding distinct ways a seed can be reached.
        if(routes[seed].length>=3) break;
      }
    }
    return {conf,currentSeed,reachableSeeds,finalsSeeds,finalsClinched,exactClinched,routes,matches,base};
  }

  function qualificationPathHtml(team){
    const a=qualificationBuildAnalysis(team);
    if(!a) return `<div class="route-status">No conference qualification picture is available.</div>`;
    if(a.error) return `<div class="route-status">${SBL.pokemon.escapeHtml(a.error)}</div>`;
    const confName=conferenceDisplayName(a.conf);
    const status=a.exactClinched?`Finals Qualified — #${a.currentSeed} Clinched`:a.finalsClinched?`Finals Qualified — currently #${a.currentSeed}`:a.finalsSeeds.length?`Still in the hunt — currently #${a.currentSeed}`:`Eliminated from the finals`;
    const cls=a.finalsClinched?'qualified':(a.finalsSeeds.length?'alive':'eliminated');
    const explanation=a.exactClinched?'Your seed is locked.':a.finalsClinched?'Your finals place is locked, but your seed can still change.':a.finalsSeeds.length?'You are not qualified yet. You can still reach the finals, but you can also miss them.':'No remaining results can put you in the top 6.';
    let html=`<div class="route-status ${cls}"><strong>${status}</strong> in ${SBL.pokemon.escapeHtml(confName)}. ${explanation}</div>`;
    const other=a.finalsSeeds.length ? a.reachableSeeds.filter(s=>s!==a.currentSeed) : [];
    if(other.length){
      html+=`<div class="seed-change-panel"><h3 class="mini-heading" style="margin:0 0 4px;">How your seed can change</h3><p class="seed-change-intro">These are the possible finishing positions other than your current seed. Each one shows the results that would put you there.</p><div class="seed-change-list">`;
      for(const seed of other){
        const label=seed<=6?`Could finish #${seed}`:`Could finish #${seed} — outside the finals`;
        const tag=seed<=6?'Finals position':'Outside finals';
        html+=`<div class="seed-change-card"><div class="seed-change-head"><strong class="seed-change-title">${label}</strong><span class="seed-change-tag">${tag}</span></div><div class="seed-change-body">`;
        const routes=a.routes[seed]||[];
        routes.forEach(r=>{
          html+=`<div class="seed-route">${r.text}.</div>`;
          const ranked=qualificationRank(a.base,a.matches,r.assignment);
          const note=qualificationDifferentialNote(team,ranked,a.base,a.matches,r.assignment);
          if(note) html+=`<div class="seed-tiebreak">${note}</div>`;
        });
        html+=`</div></div>`;
      }
      html+=`</div></div>`;
    }
    const remaining=conferenceRemainingFixtures(team);
    if(remaining.length){
      html+=`<h3 class="mini-heading" style="margin-top:14px;">Remaining fixtures</h3><div class="route-remaining">${remaining.map(r=>`<div class="route-remaining-row"><span>${SBL.pokemon.escapeHtml(r.week)}</span><span>vs ${SBL.pokemon.escapeHtml(r.opponent)}</span></div>`).join('')}</div>`;
    }
    return html;
  }

  function qualificationStatus(team){
    const a=qualificationBuildAnalysis(team); if(!a||a.error) return null;
    if(a.finalsClinched) return {cls:a.exactClinched?'clinched':'in',label:a.exactClinched?'Clinched':'In'};
    return a.finalsSeeds.length?{cls:'alive',label:'At Risk'}:{cls:'eliminated',label:'Eliminated'};
  }

  // Most recent `n` played fixture results for a franchise, in chronological
  // (oldest-first) order — used to render the W/L form pills on Standings.
  function teamRecentForm(team, n=4){
    const fixture = STATE.settings?.fixture;
    const rounds = Array.isArray(fixture?.rounds) ? fixture.rounds : [];
    const out = [];
    for(const round of rounds){
      for(const match of (round.matches || [])){
        if(groupKey(match.home) !== groupKey(team) && groupKey(match.away) !== groupKey(team)) continue;
        const res = findFixtureResult(round.week, match.home, match.away);
        if(!res.played || !res.winner) continue;
        out.push({week: round.week, win: groupKey(res.winner) === groupKey(team)});
      }
    }
    return out.slice(-n);
  }


  function openTeamOverview(team){
    const data=teamStandings('ALL'); const t=data.find(x=>x.team===team); if(!t)return;
    const i=data.indexOf(t); // overall league rank (0-based)
    const mons=Object.values(teamPokemonStats('ALL')[team]||{}).sort((a,b)=>b.appearances-a.appearances||b.dealt-a.dealt).slice(0,5);
    // Conference rank: same pool + same ranking rule the standings ladder uses,
    // just filtered down to teams sharing this team's conference (or the
    // Unassigned bucket, when conferenceOf() returns '').
    const conf = conferenceOf(team);
    const confName = conferenceDisplayName(conf);
    const confList = data.filter(x=>conferenceOf(x.team)===conf).sort((a,b)=>
      b.wins-a.wins ||
      Number(b.diff||0)-Number(a.diff||0) ||
      b.dealt-a.dealt ||
      a.team.localeCompare(b.team,undefined,{sensitivity:'base'})
    );
    const confIndex = confList.findIndex(x=>x.team===team);
    const ordinal = idx => { const n=idx+1; return `${n}${n===1?'st':n===2?'nd':n===3?'rd':'th'}`; };

    const summaryTabHtml = `<div class="profile-grid"><div><span>Record</span><strong>${t.wins}-${t.losses}</strong></div><div><span>Win %</span><strong>${t.games?(100*t.wins/t.games).toFixed(1)+'%':'—'}</strong></div><div><span>Games</span><strong>${t.games}</strong></div><div><span>Differential</span><strong>${Number(t.diff||0)>0?'+':''}${Number(t.diff||0)}</strong></div></div><div class="section-divider"></div><h3 class="mini-heading">Top used Pokémon</h3>${mons.map(m=>`<div class="summary-mon">${pokemonLink(m.species,`${SBL.pokemon.spriteMarkup(m.species,'sprite')}<div class="summary-mon-main"><strong>${SBL.pokemon.escapeHtml(m.species)}</strong><div class="summary-mon-stats">${m.appearances} games · ${m.kills} K · ${m.deaths} D</div></div>`)}</div>`).join('')||'<div class="empty-state">No Pokémon data.</div>'}`;

    // The commissioner can toggle whether the Qualification tab shows at all
    // (typically switched on once the playoff picture matters, near the end
    // of the regular season) from Admin → Season Setup.
    const qualificationEnabled = !!STATE.settings?.qualificationEnabled;
    const tabsHtml = qualificationEnabled ? `<div class="modal-tabs" role="tablist">
        <button type="button" class="modal-tab active" data-modal-tab="summary" role="tab" aria-selected="true">Season Summary</button>
        <button type="button" class="modal-tab" data-modal-tab="qualification" role="tab" aria-selected="false">Qualification</button>
      </div>` : '';
    const qualificationPanelHtml = qualificationEnabled ? `<div class="modal-tab-panel" data-modal-panel="qualification" hidden>${qualificationPathHtml(team)}</div>` : '';

    document.getElementById('auditModal').innerHTML=`<div class="audit-overlay" id="teamOverviewOverlay"><div class="audit-box overview-modal"><div class="summary-header"><div><div class="summary-kicker">${SBL.pokemon.escapeHtml(confName)} Position</div><h3>${ordinal(confIndex)} — ${SBL.pokemon.escapeHtml(team)}</h3><div class="summary-result" style="color:var(--text-dim);font-weight:600;">${ordinal(i)} overall in the league</div></div><button class="ghost small" id="teamOverviewClose">Close ✕</button></div>${tabsHtml}<div class="modal-tab-panel" data-modal-panel="summary">${summaryTabHtml}</div>${qualificationPanelHtml}</div></div>`;
    updateModalPageLock();
    const closeBtn=document.getElementById('teamOverviewClose');
    if(closeBtn) closeBtn.onclick=(e)=>{e.preventDefault();e.stopPropagation();closeAudit();};
    const overlay=document.getElementById('teamOverviewOverlay');
    if(overlay) overlay.onclick=(e)=>{if(e.target===overlay)closeAudit();};

    if(qualificationEnabled){
      const overlay = document.getElementById('teamOverviewOverlay');
      overlay.querySelectorAll('[data-modal-tab]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          overlay.querySelectorAll('[data-modal-tab]').forEach(b=>{
            const active = b===btn;
            b.classList.toggle('active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
          });
          overlay.querySelectorAll('[data-modal-panel]').forEach(p=>{ p.hidden = p.dataset.modalPanel !== btn.dataset.modalTab; });
        });
      });
    }
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
        <div class="row" style="align-items:flex-end;">
          <div><label>Scope</label>${weekSelectorHtml('globalWeek')}</div>
          <div><label>Damage type</label><select id="globalDamageType"><option value="dealt">Total Damage</option><option value="directDamage">Direct Damage</option><option value="indirectDamage">Indirect Damage</option></select></div>
          <div style="flex:0;"><button class="ghost" id="exportGlobal">Export CSV</button></div>
        </div>
        <div id="globalTable"></div>
        <a class="nav-link" id="toTeamsLink">Want per-team breakdowns? → View Franchise Stats</a>
      </div>`;

    document.getElementById('toTeamsLink').addEventListener('click', ()=> goToTab('teams'));

    const sel = document.getElementById('globalWeek');
    const damageType=document.getElementById('globalDamageType');
    function drawGlobal(){
      const key=document.getElementById('globalDamageType').value;
      const label=key==='directDamage'?'Direct Damage':(key==='indirectDamage'?'Indirect Damage':'Total Damage');
      const stats = globalPokemonStats(sel.value).slice().sort((a,b)=>(Number(b[key])||0)-(Number(a[key])||0)||Number(b.kills||0)-Number(a.kills||0));
      document.getElementById('globalTable').innerHTML = stats.length===0 ? `<div class="empty-state">No data for this scope yet.</div>` :
        `<table><thead><tr><th class="rank">#</th><th>Pokémon</th><th class="num">${label}</th><th class="num">Total</th><th class="num">Direct</th><th class="num">Indirect</th><th class="num">Kills</th><th class="num">Deaths</th><th class="num">Games</th></tr></thead><tbody>
        ${stats.map((s,i)=>`<tr><td class="rank">${i+1}</td><td class="pname"><div class="pname-cell">${pokemonName(s.species,true,'sprite-xl')}</div></td><td class="num dealt"><strong>${(Number(s[key])||0).toFixed(1)}</strong></td><td class="num">${(Number(s.dealt)||0).toFixed(1)}</td><td class="num">${(Number(s.directDamage)||0).toFixed(1)}</td><td class="num">${(Number(s.indirectDamage)||0).toFixed(1)}</td><td ${auditAttr(s.species,'kills',s.killLog)}>${s.kills}</td><td ${auditAttr(s.species,'deaths',s.deathLog)}>${s.deaths}</td><td class="num">${s.games}</td></tr>`).join('')}</tbody></table>`;
    }
    sel.addEventListener('change', drawGlobal);
    damageType.addEventListener('change', drawGlobal);
    document.getElementById('exportGlobal').addEventListener('click', ()=> exportGlobalCSV(sel.value, sel.value==='ALL'?'Season':sel.value));
    drawGlobal();
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
        <div id="pokemonSearchTable"></div>
      </div>`;

    const input = document.getElementById('pokemonSearchInput');
    const typeFilter = document.getElementById('pokemonTypeFilter');
    const table = document.getElementById('pokemonSearchTable');
    // Aggregate once per search view. Recomputing every replay on every keystroke
    // made live search feel progressively slower as the league grew.
    const rawStats = globalPokemonStats('ALL');

    function draw(){
      const q = input.value.trim().toLowerCase();
      const wantedType = typeFilter.value;
      const grouped = new Map();
      rawStats.forEach(raw => {
        const canonical = SBL.pokemon.displayName(raw.species);
        const k = norm(canonical);
        if(!k) return;
        if(!grouped.has(k)){
          grouped.set(k,{...raw,species:canonical,coaches:new Set(raw.coaches||[])});
        }else{
          const g=grouped.get(k);
          g.coaches = new Set([...(g.coaches||[]),...(raw.coaches||[])]);
          ['dealt','taken','kills','assists','deaths','games'].forEach(key=>{
            if(key in g || key in raw) g[key]=(Number(g[key])||0)+(Number(raw[key])||0);
          });
          if(raw.killLog) g.killLog=[...(g.killLog||[]),...raw.killLog];
          if(raw.assistLog) g.assistLog=[...(g.assistLog||[]),...raw.assistLog];
          if(raw.deathLog) g.deathLog=[...(g.deathLog||[]),...raw.deathLog];
        }
      });
      const stats = [...grouped.values()].filter(s => {
        const name=s.species.toLowerCase();
        return (!q || name.includes(q)) && (wantedType==='all' || pokemonTypes(s.species).includes(wantedType));
      }).sort((a,b)=>a.species.localeCompare(b.species,undefined,{sensitivity:'base'}));
      if(!stats.length){
        table.innerHTML = `<div class="empty-state">${q ? `No Pokémon matching <strong>${SBL.pokemon.escapeHtml(input.value.trim())}</strong> in this scope.` : 'No Pokémon data for this scope yet.'}</div>`;
        return;
      }
      table.innerHTML = `<table><thead><tr>
        <th>Pokémon</th><th>Coach / Team</th><th class="num">Dmg Dealt</th><th class="num">Dmg Taken</th><th class="num">Kills</th><th class="num">Deaths</th><th class="num">Games</th><th class="num">Avg Dmg/Game</th>
      </tr></thead><tbody>
        ${stats.map(s=>`<tr class="search-match" data-pokemon="${SBL.pokemon.escapeHtml(s.species)}" tabindex="0" role="button" title="Open ${SBL.pokemon.escapeHtml(s.species)} profile" style="cursor:pointer;">
          <td class="pname"><div class="pname-cell">${pokemonName(s.species,true,'sprite-xl')}</div></td>
          <td>${SBL.pokemon.escapeHtml(Array.from(s.coaches).sort().join(', ') || 'Unknown')}</td>
          <td class="num dealt">${s.dealt.toFixed(1)}</td>
          <td class="num taken">${s.taken.toFixed(1)}</td>
          <td ${auditAttr(s.species,'kills',s.killLog)}>${s.kills}</td>
          <td ${auditAttr(s.species,'deaths',s.deathLog)}>${s.deaths}</td>
          <td class="num">${s.games}</td>
          <td class="num">${(s.games ? s.dealt/s.games : 0).toFixed(1)}</td>
        </tr>`).join('')}
      </tbody></table>`;
      bindPokemonClicks(table);
    }

    input.addEventListener('input', draw);
    typeFilter.addEventListener('change', draw);
    setTimeout(()=>input.focus(), 0);
    draw();
  }


  // ---------- Pokémon profile / death causes / team comparison ----------
  function pokemonProfileData(species, weekFilter){
    const target = normName(species);
    const rows = [];
    const coaches = new Set();
    for(const r of allReplays(weekFilter)){
      for(const k in r.mons){
        const m = r.mons[k];
        if(normName(m.species) !== target) continue;
        coaches.add(teamFor(r.players[m.side]));
        rows.push({replay:r, mon:m});
      }
    }
    const weeksBrought = new Map();
    const agg = {species: rows[0]?.mon?.species || species, dealt:0,taken:0,kills:0,deaths:0,games:0,killLog:[],deathLog:[],coaches,weeksBrought};
    // Record every week in which the Pokémon was on the six-mon team preview,
    // including games where it was never sent into battle.
    for(const replay of allReplays(weekFilter)){
      const week = replay.week;
      for(const k in (replay.mons||{})){
        const mon = replay.mons[k];
        if(normName(mon.species) === target){
          const key = String(week || '');
          if(key) weeksBrought.set(key, (weeksBrought.get(key)||0) + 1);
          break;
        }
      }
    }
    rows.forEach(({replay,mon})=>{
      agg.dealt += mon.damageDealt||0; agg.taken += mon.damageTaken||0;
      agg.kills += mon.kills||0; agg.deaths += mon.deaths||0; agg.games += mon.appearances||0;
      // Keep the replay timestamp with each event so profile history can be
      // ordered by when the battle was played/uploaded rather than by turn.
      const replayDate = Number(replay.uploadtime || replay.processedAt || 0);
      agg.killLog.push(...(mon.killLog||[]).map(x=>({...x, replayDate})));
      agg.deathLog.push(...(mon.deathLog||[]).map(x=>({...x, replayDate})));
    });
    return agg;
  }

  function renderPokemonProfile(species, weekFilter){
    const s = pokemonProfileData(species, weekFilter);
    if(!s.games) return `<div class="empty-state">No data for ${SBL.pokemon.escapeHtml(species)} in this scope.</div>`;
    const kd = s.deaths ? (s.kills/s.deaths).toFixed(2) : (s.kills ? '∞' : '0');
    const avg = s.games ? (s.dealt/s.games).toFixed(1) : '0';
    return `<div class="panel pokemon-profile">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        ${SBL.pokemon.spriteMarkup(s.species,'sprite-xl')}
        <div><h2 style="margin:0;color:var(--text);text-transform:none;letter-spacing:0;font-size:20px;">${pokemonLink(s.species, SBL.pokemon.escapeHtml(s.species))}</h2>
        <div class="note" style="margin-top:3px;">${SBL.pokemon.escapeHtml(Array.from(s.coaches).sort().join(', '))}</div></div>
      </div>
      <div class="profile-grid">
        <div><span>Games</span><strong>${s.games}</strong></div><div><span>Kills</span><strong class="kills">${s.kills}</strong></div>
        <div><span>Deaths</span><strong class="taken">${s.deaths}</strong></div><div><span>K/D</span><strong>${kd}</strong></div>
        <div><span>Damage dealt</span><strong class="dealt">${s.dealt.toFixed(1)}</strong></div><div><span>Damage taken</span><strong class="taken">${s.taken.toFixed(1)}</strong></div>
        <div><span>Avg dmg/game</span><strong>${avg}</strong></div><div><span>Kill rate/game</span><strong>${s.games?(s.kills/s.games).toFixed(2):'0'}</strong></div>
      </div>
      <div class="profile-weeks" style="margin-top:14px;padding:12px 14px;background:var(--panel2);border:1px solid var(--border);border-radius:8px;">
        <div class="mini-heading" style="margin-bottom:8px;">Weeks Brought</div>
        <div style="display:flex;flex-wrap:wrap;gap:7px;">${Array.from(s.weeksBrought.keys()).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(w=>`<span class="badge">${SBL.pokemon.escapeHtml(w)}</span>`).join('') || '<span class="note">No roster data recorded.</span>'}</div>
      </div>
      <div class="section-divider"></div>
      <div class="profile-two-col">
        <div><h3 class="mini-heading">Kill record</h3>${s.killLog.length ? `<table><thead><tr><th>Turn</th><th>Victim</th><th>Cause</th><th>Replay</th></tr></thead><tbody>${s.killLog.slice().sort((a,b)=>(a.replayDate-b.replayDate) || (a.turn-b.turn)).map(x=>`<tr><td>${x.turn}</td><td>${x.victim ? pokemonLink(x.victim, SBL.pokemon.escapeHtml(x.victim), '', false) : '?'}</td><td>${SBL.pokemon.escapeHtml(x.cause||'—')}</td><td><a class="nav-link" href="https://replay.pokemonshowdown.com/${SBL.pokemon.escapeHtml(x.replayId)}" target="_blank" rel="noopener">View</a></td></tr>`).join('')}</tbody></table>`:`<div class="empty-state">No kills.</div>`}</div>
        <div><h3 class="mini-heading">Death record</h3>${s.deathLog.length ? `<table><thead><tr><th>Turn</th><th>Killer</th><th>Replay</th></tr></thead><tbody>${s.deathLog.slice().sort((a,b)=>(a.replayDate-b.replayDate) || (a.turn-b.turn)).map(x=>`<tr><td>${x.turn}</td><td>${x.killer ? pokemonLink(x.killer, SBL.pokemon.escapeHtml(x.killer), '', false) : 'Unattributed'}</td><td><a class="nav-link" href="https://replay.pokemonshowdown.com/${SBL.pokemon.escapeHtml(x.replayId)}" target="_blank" rel="noopener">View</a></td></tr>`).join('')}</tbody></table>`:`<div class="empty-state">No deaths.</div>`}</div>
      </div>
    </div>`;
  }

  function luckTeamData(scope){
    const out={};
    for(const r of allReplays(scope)){
      if(!r || !r.players || !r.luck) continue;
      for(const side of ['p1','p2']){
        const team=teamFor(r.players[side]);
        if(!team) continue;
        const key=groupKey(team);
        if(!out[key]) out[key]={team,games:0,crits:0,critLuck:0,dodges:0,moveDodgeLuck:0,lowAccuracyHits:0,lowAccuracyHitLuck:0,lowAccuracyDodges:0,statusDodgeLuck:0,fullParalysis:0,paralysisDodgeLuck:0,paralysisDodges:0,sleepTurns:0,sleepEvents:0,sleepDurationLuck:0,freezeTurns:0,freezeEvents:0,freezeDurationLuck:0};
        const t=out[key];
        t.games++;
        const l=r.luck[side] || {};
        for(const k of ['crits','critLuck','dodges','moveDodgeLuck','lowAccuracyHits','lowAccuracyHitLuck','lowAccuracyDodges','statusDodgeLuck','fullParalysis','paralysisDodgeLuck','paralysisDodges','sleepTurns','sleepEvents','sleepDurationLuck','freezeTurns','freezeEvents','freezeDurationLuck']) t[k]+=Number(l[k]||0);
      }
    }
    return Object.values(out).map(t=>{
      t.score=t.critLuck+t.moveDodgeLuck+t.lowAccuracyHitLuck+t.statusDodgeLuck+t.paralysisDodgeLuck+t.sleepDurationLuck+t.freezeDurationLuck;
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
        if(!out[key]) out[key]={species,team,teams:new Set(),games:0,crits:0,critLuck:0,dodges:0,moveDodgeLuck:0,lowAccuracyHits:0,lowAccuracyHitLuck:0,lowAccuracyDodges:0,statusDodgeLuck:0,fullParalysis:0,paralysisDodgeLuck:0,paralysisDodges:0,sleepTurns:0,sleepEvents:0,sleepDurationLuck:0,freezeTurns:0,freezeEvents:0,freezeDurationLuck:0};
        const p=out[key];
        if(team) p.teams.add(team);
        p.games++;
        for(const k of ['crits','critLuck','dodges','moveDodgeLuck','lowAccuracyHits','lowAccuracyHitLuck','lowAccuracyDodges','statusDodgeLuck','fullParalysis','paralysisDodgeLuck','paralysisDodges','sleepTurns','sleepEvents','sleepDurationLuck','freezeTurns','freezeEvents','freezeDurationLuck']) p[k]+=Number(l[k]||0);
      }
    }
    return Object.values(out).map(p=>{
      p.team=Array.from(p.teams).join(', ');
      p.score=p.critLuck+p.moveDodgeLuck+p.lowAccuracyHitLuck+p.statusDodgeLuck+p.paralysisDodgeLuck+p.sleepDurationLuck+p.freezeDurationLuck;
      return p;
    }).sort((a,b)=>b.score-a.score || b.games-a.games || a.species.localeCompare(b.species,undefined,{sensitivity:'base'}));
  }

  function luckGameData(scope){
    const rows=[];
    for(const r of allReplays(scope)){
      if(!r || !r.luck) continue;
      let score=0;
      const totals={crits:0,dodges:0,lowAccuracyHits:0,statusDodges:0,fullParalysis:0,sleep:0,freeze:0};
      for(const side of ['p1','p2']){
        const l=r.luck[side]||{};
        score += Number(l.critLuck||0)+Number(l.moveDodgeLuck||0)+Number(l.lowAccuracyHitLuck||0)+Number(l.statusDodgeLuck||0)+Number(l.paralysisDodgeLuck||0)+Number(l.sleepDurationLuck||0)+Number(l.freezeDurationLuck||0);
        totals.crits += Number(l.crits||0);
        totals.dodges += Number(l.dodges||0);
        totals.lowAccuracyHits += Number(l.lowAccuracyHits||0);
        totals.statusDodges += Number(l.statusDodgeLuck||0);
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
    root.innerHTML=`<div class="pokemon-overlay" id="luckPokemonModal"><div class="pokemon-modal" role="dialog" aria-modal="true" aria-label="Luck summary for ${SBL.pokemon.escapeHtml(species)}"><div class="pokemon-modal-head"><div style="display:flex;align-items:center;gap:10px;">${SBL.pokemon.spriteMarkup(species,'sprite-xl')}<div><strong>${SBL.pokemon.escapeHtml(species)}</strong><div class="note">Luck summary · ${score>=0?'+':''}${score.toFixed(2)} luck</div></div></div><button class="ghost small" id="luckPokemonClose" type="button">Close ✕</button></div><div class="pokemon-modal-body"><div class="profile-grid"><div><span>Lucky events</span><strong>${events.filter(e=>e.score>0).length}</strong></div><div><span>Unlucky events</span><strong>${events.filter(e=>e.score<0).length}</strong></div><div><span>Games</span><strong>${rows.length}</strong></div><div><span>Net luck</span><strong>${score>=0?'+':''}${score.toFixed(2)}</strong></div></div><div class="section-divider"></div><h3 class="mini-heading">What turns did ${SBL.pokemon.escapeHtml(species)} get lucky?</h3>${Object.keys(byTurn).sort((a,b)=>Number(a)-Number(b)).map(turn=>`<div style="margin:0 0 12px;padding:10px 12px;background:var(--panel2);border:1px solid var(--border);border-radius:8px;"><strong>Turn ${SBL.pokemon.escapeHtml(turn)}</strong>${byTurn[turn].map(e=>`<div style="display:flex;gap:8px;align-items:flex-start;margin-top:7px;">${e.score>=0?'🍀':'💀'}<div><strong>${SBL.pokemon.escapeHtml(e.type.replace(/-/g,' '))}</strong> <span class="note">${e.score>=0?'+':''}${Number(e.score).toFixed(2)}</span><div class="note">${SBL.pokemon.escapeHtml(e.detail)} · ${SBL.pokemon.escapeHtml(e.team)} vs ${SBL.pokemon.escapeHtml(e.opponent)} · <a class="nav-link" href="https://replay.pokemonshowdown.com/${SBL.pokemon.escapeHtml(e.replayId)}" target="_blank" rel="noopener">Replay</a></div></div></div>`).join('')}</div>`).join('') || '<div class="empty-state">No turn-by-turn luck events are stored yet. Reprocess the replays with the latest parser.</div>'}</div></div></div>`;
    document.body.appendChild(root.firstElementChild); updateModalPageLock();
    const modal=document.getElementById('luckPokemonModal');
    document.getElementById('luckPokemonClose').addEventListener('click',()=>{modal.remove();updateModalPageLock();});
    modal.addEventListener('click',e=>{if(e.target===modal){modal.remove();updateModalPageLock();}});
  }

  function renderLuckiestTeam(){
    contentEl.innerHTML=`<div class="panel">
      <h2>🍀 Luckiest</h2>
      <div class="luck-explanation"><div class="luck-explanation-title">How luck is scored</div><div class="luck-explanation-body">Luck is weighted by how unlikely each event was. Move misses use the move's actual accuracy, status dodges use the probability of the status roll failing, crits use the move's crit stage, and low-accuracy hits use the move's actual hit chance. One-turn sleep is lucky; longer sleep and freeze are increasingly unlucky.</div></div>
      <div class="row" style="align-items:flex-end;gap:12px;"><div><label>View</label><select id="luckView"><option value="team">Team</option><option value="pokemon">Pokemon</option><option value="game">Luckiest Game</option></select></div><div><label>Scope</label>${weekSelectorHtml('luckWeek')}</div></div>
      <div id="luckTable"></div>
    </div>`;
    const scopeSel=document.getElementById('luckWeek');
    const viewSel=document.getElementById('luckView');
    function draw(){
      const view=viewSel.value;
      if(view==='game'){
        const rows=luckGameData(scopeSel.value);
        document.getElementById('luckTable').innerHTML=!rows.length?`<div class="empty-state">No luck data for this scope yet. Reprocess the replays after updating the luck parser.</div>`:`<div class="franchise-table-wrap"><table class="franchise-table"><thead><tr><th>#</th><th>Game</th><th>Matchup</th><th>Winner</th><th class="num">Luck</th><th class="num">Crits</th><th class="num">Dodges</th><th class="num">Low-Acc Hits</th><th class="num">Status</th><th class="num">Sleep</th><th class="num">Freeze</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td><a class="nav-link" href="https://replay.pokemonshowdown.com/${SBL.pokemon.escapeHtml(r.id)}" target="_blank" rel="noopener">${SBL.pokemon.escapeHtml(r.id||'Replay')}</a></td><td><strong>${SBL.pokemon.escapeHtml(r.team1)}</strong> vs <strong>${SBL.pokemon.escapeHtml(r.team2)}</strong></td><td>${SBL.pokemon.escapeHtml(r.winner||'—')}</td><td class="num"><strong>${r.score>=0?'+':''}${r.score.toFixed(2)}</strong></td><td class="num">${r.crits}</td><td class="num">${r.dodges}</td><td class="num">${r.lowAccuracyHits}</td><td class="num">${r.statusDodges.toFixed(2)}</td><td class="num">${r.sleep>=0?'+':''}${r.sleep.toFixed(2)}</td><td class="num">${r.freeze>=0?'+':''}${r.freeze.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>`;
        return;
      }
      const pokemon=view==='pokemon';
      const rows=pokemon?luckPokemonData(scopeSel.value):luckTeamData(scopeSel.value);
      document.getElementById('luckTable').innerHTML=!rows.length?`<div class="empty-state">No luck data for this scope yet. Reprocess the replays after updating the luck parser.</div>`:`<div class="franchise-table-wrap"><table class="franchise-table"><thead><tr><th>#</th><th>${pokemon?'Pokemon':'Team'}</th><th class="num">Luck</th><th class="num">Crits</th><th class="num">Dodges</th><th class="num">Low-Acc Hits</th><th class="num">Status Dodges</th><th class="num">Full Paras</th><th class="num">Sleep</th><th class="num">Freeze</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${pokemon?`<span class="luck-pokemon-row" role="button" tabindex="0" data-luck-pokemon="${SBL.pokemon.escapeHtml(r.species)}" style="display:inline-flex;align-items:center;gap:7px;cursor:pointer;">${SBL.pokemon.spriteMarkup(r.species,'sprite')}<strong>${SBL.pokemon.escapeHtml(r.species)}</strong></span><div class="note">${SBL.pokemon.escapeHtml(r.team||'')}</div>`:`<strong>${SBL.pokemon.escapeHtml(r.team)}</strong><div class="note">${r.games} game${r.games===1?'':'s'}</div>`}</td><td class="num"><strong>${r.score>=0?'+':''}${r.score.toFixed(2)}</strong></td><td class="num">${r.crits}</td><td class="num">${r.dodges}</td><td class="num">${r.lowAccuracyHits}</td><td class="num">${r.statusDodgeLuck.toFixed(2)}</td><td class="num">${r.fullParalysis}</td><td class="num">${r.sleepTurns} turns <span class="note">(${r.sleepDurationLuck>=0?'+':''}${r.sleepDurationLuck.toFixed(1)})</span></td><td class="num">${r.freezeTurns} turns <span class="note">(${r.freezeDurationLuck>=0?'+':''}${r.freezeDurationLuck.toFixed(1)})</span></td></tr>`).join('')}</tbody></table></div>`;
      if(pokemon){ document.querySelectorAll('[data-luck-pokemon]').forEach(el=>{el.addEventListener('click',()=>openLuckPokemonSummary(el.dataset.luckPokemon,scopeSel.value)); el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openLuckPokemonSummary(el.dataset.luckPokemon,scopeSel.value);}});}); }
    }
    scopeSel.addEventListener('change',draw);
    viewSel.addEventListener('change',draw);
    draw();
  }

  function renderDeathCauses(){
    contentEl.innerHTML=`<div class="panel"><h2>Death Causes</h2><div class="cause-subheading">Top victims</div><div id="causeBody"></div></div>`;
    const sel={value:'ALL'};
    function draw(){
      const counts={}; const pokemon={}; const causeLogs={};
      for(const r of allReplays(sel.value)) for(const k in r.mons){
        const m=r.mons[k];
        for(const d of (m.deathLog||[])){
          const raw=(d.cause||'Other'); const cleanCause=String(raw).replace(/^(item|ability):\s*/i,'').trim(); const c=/^(unattributed)$/i.test(cleanCause)?'Other':(/stealth rock|spikes|toxic spikes|sticky web/i.test(cleanCause)?'Hazard':(/recoil/i.test(cleanCause)?'Recoil':(/psn|tox|brn|poison|burn/i.test(cleanCause)?'Status':cleanCause))); counts[c]=(counts[c]||0)+1;
          if(!pokemon[c]) pokemon[c]={}; const sp=m.species; pokemon[c][sp]=(pokemon[c][sp]||0)+1;
          if(!causeLogs[c]) causeLogs[c]=[]; causeLogs[c].push({pokemon:sp,...d});
        }
      }
      const rows=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
      document.getElementById('causeBody').innerHTML=!rows.length?`<div class="empty-state">No deaths recorded.</div>`:`<div class="death-cause-list">${rows.map(([c,n],i)=>{const top=Object.entries(pokemon[c]).sort((a,b)=>b[1]-a[1]).slice(0,6);return `<div class="death-cause-entry"><div class="death-cause-rank">${i+1}</div><div class="death-cause-main"><div class="death-cause-title">${SBL.pokemon.escapeHtml(c)} <span class="badge">${n}</span></div><div class="death-cause-mons">${top.map(([sp,v])=>`<span class="death-cause-mon">${SBL.pokemon.spriteMarkup(sp,'death-cause-sprite')}${pokemonLink(sp, SBL.pokemon.escapeHtml(sp), '', false)}<span class="badge">${v}</span></span>`).join('')}</div></div></div>`}).join('')}</div>`;
    }
    draw();
  }

  // Replay-result score for ladder purposes. This is the number of Pokémon
  // remaining on each side when the battle ends (the score shown for a played
  // fixture), not credited KOs. That keeps indirect/residual kills from changing
  // the ladder differential.
  function replayResultScore(r){
    if(!r || !r.players) return null;
    const score={p1:0,p2:0};
    for(const side of ['p1','p2']){
      const roster=Array.isArray(r.teamRoster?.[side]) ? r.teamRoster[side] : [];
      const unique=new Set(roster.map(normName).filter(Boolean));
      let remaining=unique.size;
      if(unique.size){
        const fainted=new Set();
        for(const m of Object.values(r.mons||{})){
          if(m.side===side && Number(m.deaths||0)>0) fainted.add(normName(m.species));
        }
        remaining=Math.max(0, unique.size-fainted.size);
      }
      score[side]=remaining;
    }
    return score;
  }

  function teamComparisonData(weekFilter){
    const out={};
    // Standings are fixture-driven: games, wins/losses, and differential come
    // ONLY from the result shown by the Fixture panel. Replay K/D is never used
    // for ladder differential or record.
    for(const rosterTeam of Object.keys(STATE.settings?.rosters||{})){
      const key=groupKey(rosterTeam);
      if(!out[key]) out[key]={team:rosterTeam,players:new Set(),games:0,wins:0,losses:0,diff:0,kills:0,deaths:0,dealt:0,taken:0};
    }

    // Keep the ordinary replay-derived stat totals for team overview/details,
    // but deliberately do NOT derive games/W-L/differential from replay stats.
    for(const r of allReplays(weekFilter)){
      if(!r || !r.players) continue;
      for(const side of ['p1','p2']){
        const team=teamFor(r.players[side]);
        const key=groupKey(team);
        if(!out[key]) out[key]={team,players:new Set(),games:0,wins:0,losses:0,diff:0,kills:0,deaths:0,dealt:0,taken:0};
        const t=out[key];
        t.players.add(r.players[side]||'?');
        for(const k in (r.mons||{})){
          const m=r.mons[k];
          if(m.side===side){
            t.kills+=m.kills||0;
            t.deaths+=m.deaths||0;
            t.dealt+=m.damageDealt||0;
            t.taken+=m.damageTaken||0;
          }
        }
      }
    }

    // The Fixture is the single source of truth for the ladder record.
    const fixture = STATE.settings?.fixture;
    const rounds = Array.isArray(fixture?.rounds) ? fixture.rounds : [];
    const wantedWeek = weekFilter && weekFilter !== 'ALL' && weekFilter !== 'LAST4' ? weekFilter : null;
    for(const round of rounds){
      if(wantedWeek && round.week !== wantedWeek) continue;
      for(const match of (round.matches || [])){
        const home = match.home, away = match.away;
        const homeKey = groupKey(home), awayKey = groupKey(away);
        if(!out[homeKey]) out[homeKey]={team:home,players:new Set(),games:0,wins:0,losses:0,diff:0,kills:0,deaths:0,dealt:0,taken:0};
        if(!out[awayKey]) out[awayKey]={team:away,players:new Set(),games:0,wins:0,losses:0,diff:0,kills:0,deaths:0,dealt:0,taken:0};
        const res = findFixtureResult(round.week, home, away);
        if(!res.played || !res.winner || res.winnerScore == null || res.loserScore == null) continue;
        const margin = Number(res.winnerScore) - Number(res.loserScore);
        const winnerKey = groupKey(res.winner);
        const loserKey = winnerKey === homeKey ? awayKey : homeKey;
        const winner = out[winnerKey], loser = out[loserKey];
        if(!winner || !loser) continue;
        winner.games += 1; winner.wins += 1; winner.diff += margin;
        loser.games += 1; loser.losses += 1; loser.diff -= margin;
      }
    }

    // Manual Admin corrections are baselines, not permanent replacements.
    // The entered value is the franchise's differential through the latest
    // played fixture at the time it was saved. Any fixture results from later
    // rounds continue accumulating on top of that baseline.
    const manualDiffs = (STATE.settings?.ladderDifferentials && typeof STATE.settings.ladderDifferentials === 'object') ? STATE.settings.ladderDifferentials : {};
    const fixtureRoundIndexByWeek = {};
    rounds.forEach((round, idx)=>{ fixtureRoundIndexByWeek[String(round.week)] = idx; });
    Object.values(out).forEach(t=>{
      const key = Object.keys(manualDiffs).find(k => groupKey(k) === groupKey(t.team));
      if(key == null) return;
      const raw = manualDiffs[key];
      // Backward compatibility with the old format, which stored a plain number.
      if(raw !== null && typeof raw === 'object' && Number.isFinite(Number(raw.value))){
        const throughIdx = Number.isInteger(Number(raw.throughRoundIndex)) ? Number(raw.throughRoundIndex) : -1;
        let futureDiff = 0;
        if(throughIdx >= 0){
          for(let idx=throughIdx+1; idx<rounds.length; idx++){
            const round = rounds[idx];
            if(weekFilter && weekFilter !== 'ALL' && weekFilter !== 'LAST4' && round.week !== weekFilter) continue;
            for(const match of (round.matches || [])){
              const res = findFixtureResult(round.week, match.home, match.away);
              if(!res.played || !res.winner || res.winnerScore == null || res.loserScore == null) continue;
              const margin = Number(res.winnerScore) - Number(res.loserScore);
              const teamKey = groupKey(t.team);
              if(groupKey(res.winner) === teamKey) futureDiff += margin;
              else if(groupKey(res.winner) === groupKey(match.home) || groupKey(res.winner) === groupKey(match.away)) futureDiff -= margin;
            }
          }
        }
        t.diff = Number(raw.value) + futureDiff;
      } else if(raw !== '' && Number.isFinite(Number(raw))){
        // Legacy overrides remain supported as a permanent value until edited in Admin.
        t.diff = Number(raw);
      }
    });

    // Keep LAST4 meaningful for callers that use it: use the four most recent
    // played fixture rounds rather than four arbitrary replay records.
    if(weekFilter === 'LAST4'){
      const recentWeeks=[];
      for(let i=rounds.length-1;i>=0 && recentWeeks.length<4;i--){
        const round=rounds[i];
        if((round.matches||[]).some(m=>{const r=findFixtureResult(round.week,m.home,m.away);return r.played&&r.winner&&r.winnerScore!=null&&r.loserScore!=null;})) recentWeeks.unshift(round.week);
      }
      for(const t of Object.values(out)){ t.games=0;t.wins=0;t.losses=0;t.diff=0; }
      for(const round of rounds){
        if(!recentWeeks.includes(round.week)) continue;
        for(const match of (round.matches||[])){
          const res=findFixtureResult(round.week,match.home,match.away);
          if(!res.played || !res.winner || res.winnerScore==null || res.loserScore==null) continue;
          const margin=Number(res.winnerScore)-Number(res.loserScore);
          const wk=groupKey(res.winner), lk=wk===groupKey(match.home)?groupKey(match.away):groupKey(match.home);
          if(out[wk]){out[wk].games++;out[wk].wins++;out[wk].diff+=margin;}
          if(out[lk]){out[lk].games++;out[lk].losses++;out[lk].diff-=margin;}
        }
      }
    }

    return Object.values(out).sort((a,b)=>b.wins-a.wins || b.diff-a.diff || b.dealt-a.dealt || a.team.localeCompare(b.team,undefined,{sensitivity:'base'}));
  }

  // ---------- fixture (schedule) ----------
  // The fixture is generated/uploaded from Admin -> Season Setup and stored in the
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
      // Scoreline comes from the replay result: Pokémon remaining at the end
      // of the battle. Do not use credited KOs, because residual/indirect KOs
      // can make individual kill attribution differ from the fixture result.
      const resultScore = replayResultScore(r) || {p1:0,p2:0};
      const homeIsT1 = groupKey(t1) === groupKey(home);
      const homeScore = homeIsT1 ? resultScore.p1 : resultScore.p2;
      const awayScore = homeIsT1 ? resultScore.p2 : resultScore.p1;
      // Winner's score always presented first (6-x), regardless of which side
      // is "home" in the fixture — so the scoreline never reads like the loser
      // won just because they happened to be listed first.
      const homeWon = winnerTeam && groupKey(winnerTeam) === groupKey(home);
      const awayWon = winnerTeam && groupKey(winnerTeam) === groupKey(away);
      const winnerScore = homeWon ? homeScore : awayWon ? awayScore : null;
      const loserScore = homeWon ? awayScore : awayWon ? homeScore : null;
      return {played:true, winner:winnerTeam, homeScore, awayScore, winnerScore, loserScore};
    }
    return {played:false};
  }
  // Shared ranking rule used everywhere standings are ordered: wins, then
  // kill/death differential, then damage dealt, then name as a final tiebreak.
  function standingsSort(a, b){
    return b.wins - a.wins ||
      Number(b.diff||0) - Number(a.diff||0) ||
      b.dealt - a.dealt ||
      a.team.localeCompare(b.team, undefined, {sensitivity: 'base'});
  }
  // Splits every franchise into its conference bucket (or "Unassigned"),
  // each already sorted by standingsSort. Reused by the standings ladder,
  // the Finals Qualification panel, and each franchise's qualification route.
  function conferenceGroups(){
    const data = teamComparisonData('ALL');
    const assignments = STATE.settings?.franchises || {};
    const conferenceFor = team => {
      const exact = assignments[team];
      if(exact === 'a' || exact === 'b') return exact;
      const key = String(team||'').trim().toLowerCase();
      const found = Object.keys(assignments).find(k => String(k).trim().toLowerCase() === key);
      if(found && (assignments[found] === 'a' || assignments[found] === 'b')) return assignments[found];
      return 'Unassigned';
    };
    const groups = {one: [], two: [], Unassigned: []};
    data.forEach(team => {
      const conf = conferenceFor(team.team);
      (groups[conf === 'a' ? 'one' : conf === 'b' ? 'two' : 'Unassigned']).push(team);
    });
    Object.values(groups).forEach(list => list.sort(standingsSort));
    return groups;
  }
  function conferenceOf(team){
    const map = STATE.settings?.franchises || {};
    const exact = map[team];
    if(exact === 'a' || exact === 'b') return exact;
    const key = String(team||'').trim().toLowerCase();
    const found = Object.keys(map).find(k => String(k).trim().toLowerCase() === key);
    return (found && (map[found]==='a' || map[found]==='b')) ? map[found] : '';
  }
  // Human-readable conference label ('' from conferenceOf() means Unassigned),
  // using the same custom names configured in Admin -> Season Setup.
  function conferenceDisplayName(conf){
    const configuredNames = STATE.settings?.conferenceNames || {};
    if(conf==='a') return String(configuredNames.a || 'Conference A').trim() || 'Conference A';
    if(conf==='b') return String(configuredNames.b || 'Conference B').trim() || 'Conference B';
    return 'Unassigned';
  }
  // Remembers which week is showing across re-renders; reset to null whenever
  // the fixture itself changes shape (see renderFixturePanel below).
  let selectedFixtureWeek = null;

  // The "current" week is the first one with an unplayed match, or the last
  // week if the whole fixture has already been played out.
  function currentFixtureWeek(rounds){
    for(const r of rounds){
      const matches = Array.isArray(r.matches) ? r.matches : [];
      if(matches.some(m => !findFixtureResult(r.week, m.home, m.away).played)) return r.week;
    }
    return rounds.length ? rounds[rounds.length - 1].week : null;
  }

  function renderFixturePanel(){
    const fixture = STATE.settings?.fixture;
    const rounds = Array.isArray(fixture?.rounds) ? fixture.rounds : [];
    if(!rounds.length){
      selectedFixtureWeek = null;
      return `<div class="panel">
        <h2>Fixture</h2>
        <div class="empty-state">No fixture has been published yet. The commissioner can generate or upload one from Admin → Season Setup.</div>
      </div>`;
    }
    const weekNames = rounds.map(r => r.week);
    if(!selectedFixtureWeek || !weekNames.includes(selectedFixtureWeek)){
      selectedFixtureWeek = currentFixtureWeek(rounds);
    }
    const activeRound = rounds.find(r => r.week === selectedFixtureWeek) || rounds[0];
    const matches = Array.isArray(activeRound.matches) ? activeRound.matches : [];
    const interMatches = matches.filter(m => {
      const ca = conferenceOf(m.home), cb = conferenceOf(m.away);
      return ca && cb && ca !== cb;
    });
    const regularMatches = matches.filter(m => {
      const ca = conferenceOf(m.home), cb = conferenceOf(m.away);
      return !(ca && cb && ca !== cb);
    });
    const matchCount = rounds.reduce((sum,r)=>sum+(r.matches?r.matches.length:0),0);
    return `<div class="panel">
      <div class="fixture-panel-head">
        <h2>Fixture</h2>
        <select id="fixtureWeekSelect" class="fixture-week-select">
          ${weekNames.map(w=>`<option value="${SBL.pokemon.escapeHtml(w)}" ${w===selectedFixtureWeek?'selected':''}>${SBL.pokemon.escapeHtml(w)}</option>`).join('')}
        </select>
      </div>
      <div class="note">${rounds.length} week${rounds.length===1?'':'s'} · ${matchCount} match${matchCount===1?'':'es'}${fixture.source==='upload'?' · uploaded':''}</div>
      <div class="fixture-weeks">
        <div class="fixture-week">
          <div class="fixture-week-title">${SBL.pokemon.escapeHtml(activeRound.week||'')}</div>
          <div class="fixture-matches">
            ${regularMatches.length ? regularMatches.map(m=>{
              const res = findFixtureResult(activeRound.week, m.home, m.away);
              const homeWin = res.played && res.winner && groupKey(res.winner)===groupKey(m.home);
              const awayWin = res.played && res.winner && groupKey(res.winner)===groupKey(m.away);
              const scoreline = res.played ? (res.winner ? `${res.winnerScore}\u2013${res.loserScore}` : `${res.homeScore}\u2013${res.awayScore}`) : '';
              const statusText = res.played ? (res.winner ? `${SBL.pokemon.escapeHtml(res.winner)} won ${scoreline}` : `Played ${scoreline}`) : 'Not played yet';
              return `<div class="fixture-match ${res.played?'fixture-played':''}">
                <div class="fixture-team ${homeWin?'fixture-winner':''}">${SBL.pokemon.escapeHtml(m.home)}</div>
                <div class="fixture-vs"${res.played?` data-score="${SBL.pokemon.escapeHtml(res.winner ? `${res.winnerScore}–${res.loserScore}` : `${res.homeScore}–${res.awayScore}`)}"`:''}>${res.played?'':'VS'}</div>
                <div class="fixture-team ${awayWin?'fixture-winner':''}">${SBL.pokemon.escapeHtml(m.away)}</div>
                <div class="fixture-status">${statusText}</div>
              </div>`;
            }).join('') : '<div class="conference-empty">No conference matches this week.</div>'}
          </div>
          ${interMatches.length ? `<div class="fixture-inter-section">
            <div class="fixture-inter-label">INTER-CONFERENCE</div>
            ${interMatches.map(m=>{
              const res = findFixtureResult(activeRound.week, m.home, m.away);
              const homeWin = res.played && res.winner && groupKey(res.winner)===groupKey(m.home);
              const awayWin = res.played && res.winner && groupKey(res.winner)===groupKey(m.away);
              const scoreline = res.played ? (res.winner ? `${res.winnerScore}\u2013${res.loserScore}` : `${res.homeScore}\u2013${res.awayScore}`) : '';
              const statusText = res.played ? (res.winner ? `${SBL.pokemon.escapeHtml(res.winner)} won ${scoreline}` : `Played ${scoreline}`) : 'Not played yet';
              return `<div class="fixture-match fixture-inter ${res.played?'fixture-played':''}">
                <div class="fixture-team ${homeWin?'fixture-winner':''}">${SBL.pokemon.escapeHtml(m.home)}</div>
                <div class="fixture-vs"${res.played?` data-score="${SBL.pokemon.escapeHtml(res.winner ? `${res.winnerScore}–${res.loserScore}` : `${res.homeScore}–${res.awayScore}`)}"`:''}>${res.played?'':'VS'}</div>
                <div class="fixture-team ${awayWin?'fixture-winner':''}">${SBL.pokemon.escapeHtml(m.away)}</div>
                <div class="fixture-status">${statusText}</div>
              </div>`;
            }).join('')}
          </div>` : ''}
        </div>
      </div>
    </div>`;
  }

  function standingsPanelHtml(){
    const assignments = STATE.settings?.franchises || {};
    const configuredNames = STATE.settings?.conferenceNames || {};
    const conferenceNames = {
      one: String(configuredNames.a || 'Conference A').trim() || 'Conference A',
      two: String(configuredNames.b || 'Conference B').trim() || 'Conference B'
    };

    const groups = conferenceGroups();

    function ladder(title, list, subtitle, extraClass=''){
      const isConference = extraClass !== 'unassigned';
      return `<section class="conference-block ${extraClass}">
        <div class="conference-heading">
          <div><div class="conference-title">${SBL.pokemon.escapeHtml(title)}</div><div class="conference-sub">${SBL.pokemon.escapeHtml(subtitle)}</div></div>
          <div class="conference-count">${list.length} franchise${list.length===1?'':'s'}</div>
        </div>
        ${list.length ? `<div class="standings-ladder">${list.map((x,i)=>{
          const pct=x.games ? (100*x.wins/x.games).toFixed(1)+'%' : '—';
          const diff=Number(x.diff||0);
          const finalsBound = isConference && i<6;
          const form = teamRecentForm(x.team,4);
          const formHtml = form.length ? `<div class="standings-form">${form.map(f=>`<span class="form-pip ${f.win?'win':'loss'}">${f.win?'W':'L'}</span>`).join('')}</div>` : '';
          const status = isConference ? qualificationStatus(x.team) : null;
          const statusChip = status ? `<span class="status-chip ${status.cls}">${SBL.pokemon.escapeHtml(status.label)}</span>` : '';
          return `<div class="standings-row standings-clickable ${i===0?'top1':i===1?'top2':''} ${finalsBound?'finals-bound':''}" data-standings-team="${SBL.pokemon.escapeHtml(x.team)}" role="button" tabindex="0" title="View ${SBL.pokemon.escapeHtml(x.team)}'s route to qualification">
            <div class="standings-rank">${i+1}</div>
            <div class="standings-team">
              <div class="standings-team-name">${SBL.pokemon.escapeHtml(x.team)}${finalsBound?'<span class="finals-chip">Finals</span>':''}${statusChip}</div>
              <div class="standings-record">${x.wins}-${x.losses} record · ${x.games} game${x.games===1?'':'s'}</div>
              ${formHtml}
            </div>
            <div class="standings-stat"><span class="standings-stat-label">W-L</span>${x.wins}-${x.losses}</div>
            <div class="standings-stat standings-pct"><span class="standings-stat-label">Win %</span>${pct}</div>

            <div class="standings-stat"><span class="standings-stat-label">Diff</span><span class="${diff>=0?'kills':'taken'}">${diff>0?'+':''}${diff}</span></div>
            <div class="standings-stat"><span class="standings-stat-label">Damage</span>${x.dealt.toFixed(1)}</div>
          </div>`;
        }).join('')}</div>` : `<div class="conference-empty">No franchises assigned to this conference.</div>`}
      </section>`;
    }

    const note = Object.keys(assignments).length
      ? 'Standings are split using the conference assignments saved in Admin → Season Setup. The top 6 in each conference (highlighted, tagged "Finals") are finals bound. Click any franchise to see its route to qualification.'
      : 'No conference assignments have been saved yet. Assign each franchise to a conference from Admin → Season Setup.';

    return `<div class="panel">
      <h2>Standings</h2>
      <div class="note">${SBL.pokemon.escapeHtml(note)}</div>
      <div class="conference-standings">
        ${ladder(conferenceNames.one,groups.one,'Conference standings')}
        ${ladder(conferenceNames.two,groups.two,'Conference standings')}
        ${groups.Unassigned.length ? ladder('Unassigned',groups.Unassigned,'Franchises without a conference assignment','unassigned') : ''}
      </div>
    </div>`;
  }

  function renderSeason(){
    contentEl.innerHTML = renderFixturePanel() + standingsPanelHtml();

    const weekSelect = document.getElementById('fixtureWeekSelect');
    if(weekSelect){
      weekSelect.addEventListener('change', e=>{
        selectedFixtureWeek = e.target.value;
        renderSeason();
      });
    }

    // Reuse the exact same franchise summary card used by League Overview.
    contentEl.querySelectorAll('[data-standings-team]').forEach(row=>{
      const open=()=>openTeamOverview(row.dataset.standingsTeam);
      row.addEventListener('click',open);
      row.addEventListener('keydown',e=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); open(); } });
    });
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
        <div class="gf-row ${i<3?'top'+(i+1):''}">
          <div class="gf-rank">${medals[i] || (i+1)}</div>
          ${SBL.pokemon.spriteMarkup(s.species,'gf-sprite')}
          <div class="gf-info">
            <div class="gf-name"><span class="pokemon-click" role="button" tabindex="0" data-pokemon="${SBL.pokemon.escapeHtml(s.species)}" title="Open ${SBL.pokemon.escapeHtml(s.species)} profile">${SBL.pokemon.escapeHtml(s.species)}</span></div>
            <div class="gf-sub"><span class="summary-kad-link" ${auditDataAttr(s.species,'kills',s.killLog,false)}>${s.kills} kills</span> · ${s.deaths} deaths · ${s.games} games</div>
          </div>
          <div class="gf-coach">${SBL.pokemon.escapeHtml(Array.from(s.coaches).sort().join(', '))}</div>
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
              <div><span>Kills</span><strong>${total.kills}</strong></div>
              <div><span>Deaths</span><strong>${total.deaths}</strong></div>
            </div>
          </div>
          <div class="franchise-table-wrap">
            <table class="franchise-table">
              <thead><tr><th>#</th><th>Pokémon</th><th class="num">Points</th><th class="num">Dmg Dealt</th><th class="num">Dmg Taken</th><th class="num">Kills</th><th class="num">Deaths</th><th class="num">Apps</th></tr></thead>
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
    const weeks=[...new Set(data.map(x=>x.week))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}));
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
        <td class="num"><a class="nav-link" href="https://replay.pokemonshowdown.com/${SBL.pokemon.escapeHtml(x.r.id)}" target="_blank" rel="noopener">View replay</a></td>
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
    if((e.key==='Enter' || e.key===' ') && e.target.closest('[data-pokemon]')){
      e.preventDefault();
      e.target.closest('[data-pokemon]').click();
    }
    if(e.key==='Escape') { e.preventDefault(); closeTopPopup(); }
  });
  document.addEventListener('click', (e)=>{
    const auditCell = e.target.closest('[data-audit]');
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
    const ok = await initAdminAuth();
    if(!ok) return;
    await loadState();
    renderTicker();
    render();
    await loadPokemonTypes();
    renderTicker();
    render();
    // Public dashboard polls the shared database every 10 seconds. This keeps the
    // viewer page read-only while still making new replay data appear automatically.
    if(!IS_ADMIN_PAGE){
      setInterval(async ()=>{ try{ await refreshSharedState(); }catch(e){ console.warn('Shared refresh failed', e); } }, POLL_MS);
    }
  })();
})();
