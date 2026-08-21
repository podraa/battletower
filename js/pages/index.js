(function(){
  const SUPABASE_STATE_ID = '__dashboard_state__';
  
  const ROSTER_BUDGET = 115; // keep in sync with the `budget` constant in accept_trade()
  function currentSeason(){ return new Date().getFullYear(); }
  const supabase = window.SBL.getSupabase();

  // ---------- shared theme ----------
  // Theme state and application live in js/sbl-themes.js. The dashboard only
  // consumes the shared API so theme behavior cannot drift between pages.
  const THEMES = window.SBLTheme?.list?.() || window.SBL_THEMES || [];
  const THEME_STORAGE_KEY = 'sbl_dashboard_theme';
  const CUSTOM_THEME_KEY = 'sbl_dashboard_custom_theme';
  const getSavedThemeId = () => window.SBLTheme?.getSavedId?.() || localStorage.getItem(THEME_STORAGE_KEY) || 'amber';
  const getCustomTheme = () => window.SBLTheme?.getCustom?.() || null;
  const applyTheme = (id, persist=true) => window.SBLTheme?.apply ? window.SBLTheme.apply(id, persist) : null;
  applyTheme(getSavedThemeId(), false);

  const appEl = document.getElementById('app');
  const contentEl = document.getElementById('content');


  let session = null;
  let profile = null;
  let DASH = { teamMap:{}, settings:{ rosters:{}, freeAgency:{ mons:[] }, feedback:[] }, replays:{} };
  let trades = [];
  let tradeLimits = [];
  let activeTradeSeason = new Date().getFullYear();
  let activeTab = 'myteam';
  let draft = { target:'', offered:new Set(), requested:new Set(), faQuery:'' };
  let statusMsg = '';
    // Shared trade status helper. The trade composer is rendered dynamically,
    // so keep this helper independent of the auth form's local setMsg().
    function setStatus(text, danger){
      statusMsg = String(text ?? '');
      const el = document.getElementById('tradeMsg');
      if(el){
        el.className = 'note' + (danger ? ' danger' : ' ok');
        el.textContent = statusMsg;
      }
    }

  // ---------- helpers ----------
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
  function teamsList(){ return Object.keys(DASH.settings.rosters||{}).sort(); }
  function myRoster(){ return (profile && profile.team_name && DASH.settings.rosters[profile.team_name]) || []; }
  function rosterPoints(list){ return (list||[]).reduce((s,m)=> s + (Number(m.points)||0), 0); }
  function freeAgencyMons(){
    const pool = Array.isArray(DASH.settings?.freeAgency?.mons)
      ? DASH.settings.freeAgency.mons
      : [];

    // Free Agency is only for genuinely undrafted Pokémon. The published
    // Free Agency board may still contain a Pokémon that was later drafted,
    // traded, or otherwise moved onto a team, so filter against every
    // currently published team roster before showing anything as available.
    const drafted = new Set();
    for(const roster of Object.values(DASH.settings?.rosters || {})){
      for(const mon of (Array.isArray(roster) ? roster : [])){
        const name = typeof mon === 'string' ? mon : mon?.name;
        if(name) drafted.add(SBL.pokemon.matchKey(name));
      }
    }

    return pool.filter(mon => mon?.name && !drafted.has(SBL.pokemon.matchKey(mon.name)));
  }

  // ---------- pokémon stat aggregation (mirrors stats.html) ----------
  function normName(n){
    return String(n??'').trim().toLowerCase().replace(/-/g,' ').replace(/_/g,' ').replace(/\s+/g,' ');
  }

  // Pokémon forms can be named differently between the Free Agency board,
  // published rosters, and trade records. Treat the optional "Paldea"
  // regional token as equivalent while preserving the actual stored name.
    
  function canonicalPokemonName(name,candidates){
    const exact=String(name??'').trim();
    const exactMatch=(candidates||[]).find(c=>normName(c)===normName(exact));
    if(exactMatch) return exactMatch;
    const k=SBL.pokemon.matchKey(exact);
    return (candidates||[]).find(c=>SBL.pokemon.matchKey(c)===k) || exact;
  }

  // Pokémon forms can be named differently between the Free Agency board,
  // published rosters, and trade records. In particular, Paldean Tauros
  // forms may appear as either "Tauros Paldea Blaze" or "Tauros Blaze".
  // The shared Pokémon service now owns the comparison key.
  function canonicalPokemonName(name, candidates){
    const target = normName(name);
    const exact = (candidates||[]).find(c => normName(c) === target);
    if(exact) return exact;

    const key = SBL.pokemon.matchKey(name);
    const match = (candidates||[]).find(c => SBL.pokemon.matchKey(c) === key);
    return match || name;
  }

  function canonicalTradePokemonName(name, roster, freeAgencyPool){
    const candidates = [
      ...(Array.isArray(roster) ? roster : []).map(m => typeof m === 'string' ? m : m?.name),
      ...(Array.isArray(freeAgencyPool) ? freeAgencyPool : []).map(m => typeof m === 'string' ? m : m?.name)
    ].filter(Boolean);
    return canonicalPokemonName(name, candidates);
  }
  function teamFor(username){
    const key = (username||'').trim().toLowerCase();
    return DASH.teamMap[key] || (username||'').trim() || 'Unknown';
  }
  // Aggregates this coach's season stats for one species across every stored
  // replay where that Pokémon appeared on the coach's side.
  function myPokemonStats(species){
    if(!profile || !profile.team_name) return null;
    const target = normName(species);
    let dealt=0, taken=0, kills=0, deaths=0, assists=0, games=0, winGames=0, wins=0;
    for(const r of Object.values(DASH.replays||{})){
      for(const k in (r.mons||{})){
        const m = r.mons[k];
        if(normName(m.species) !== target) continue;
        if(teamFor(r.players?.[m.side]) !== profile.team_name) continue;
        dealt += m.damageDealt||0;
        taken += m.damageTaken||0;
        kills += m.kills||0;
        deaths += m.deaths||0;
        assists += m.assists||0;
        const appearances = m.appearances||0;
        games += appearances;
        if(appearances > 0){
          winGames++;
          // Replays store the winner as a username (r.winner), not a per-side
          // results map, so fall back to comparing against the coach on this side.
          const result = r.results && r.results[m.side] ? r.results[m.side]
            : (r.winner && r.winner.toLowerCase()===(r.players?.[m.side]||'').toLowerCase() ? 'W' : (r.winner ? 'L' : null));
          if(result === 'W') wins++;
        }
      }
    }
    return { dealt, taken, kills, deaths, assists, games, winPct: winGames ? Math.round(100*wins/winGames) : null };
  }

  // ---------- data loading ----------
  async function loadDashboardState(){
    const { data, error } = await SBL.replays.load(supabase);
    if(error) throw error;
    const { sharedState, replays } = SBL.replays.partition(data);
    const shared = sharedState || {};
    const snap = SBL.seasons.getSnapshot(shared);
    DASH.teamMap = snap.teamMap;
    DASH.settings = Object.assign({ rosters:{}, freeAgency:{mons:[]} }, snap.settings || {});
    DASH.settings.rosters = normalizeStoredRosters(DASH.settings.rosters||{});
    DASH.replays = snap.archived ? snap.replays : replays;
  }

  async function loadProfile(){
    const uid = session.user.id;
    let data = await SBL.profiles.get(uid, '*', supabase);
    if(!data){
      data = await SBL.profiles.create({ id: uid, email: session.user.email }, supabase);
    }
    profile = data;
  }

  async function loadTrades(){
    // The active trade season is controlled by the commissioner reset, not by
    // the calendar year. This is critical after an end-of-season reset.
    const {data:seasonRow, error:seasonErr} = await supabase
      .from('trade_season_settings')
      .select('active_season')
      .eq('id', 1)
      .maybeSingle();
    if(seasonErr) throw seasonErr;
    activeTradeSeason = Number(seasonRow?.active_season) || new Date().getFullYear();

    const {data, error} = await SBL.trades.load(supabase);
    if(error) throw error;
    trades = data || [];

    const {data:limits, error:limitErr} = await supabase
      .from('franchise_trade_limits')
      .select('*')
      .eq('season', activeTradeSeason);
    if(limitErr){
      console.warn('Franchise trade limits unavailable; using 8-trade defaults:', limitErr.message);
      tradeLimits = [];
    }else{
      tradeLimits = limits || [];
    }
  }

  function tradeLimitFor(team, kind){
    const row = tradeLimits.find(x => x.team_name === team);
    if(!row) return 8;
    return kind === 'freeagency' ? Math.max(0, Number(row.free_agency_trade_limit) || 0) : Math.max(0, Number(row.team_trade_limit) || 0);
  }

  function completedTradeCount(team, kind='team'){
    return SBL.trades.consumedCount(trades, team, kind, activeTradeSeason);
  }

  function tradeAllowance(team, kind='team'){
    const limit=tradeLimitFor(team,kind);
    const used=completedTradeCount(team,kind);
    // Commissioner-granted credits belong to the player account. They are
    // shown on the player's dashboard and added to the normal allowance.
    // For a franchise-level display we leave the franchise limit itself intact.
    const credits = profile?.team_name === team ? Math.max(0, Number(profile?.trade_credits) || 0) : 0;
    return {limit,used,credits,remaining:Math.max(0,limit+credits-used)};
  }

  async function refreshAll(){
    await Promise.all([loadDashboardState(), loadProfile(), loadTrades()]);
    const rawRosters = DASH.settings.rosters || {};
    DASH.settings.rosters = SBL.trades.getEffectiveRosters(rawRosters, trades);
    DASH.settings.freeAgency = DASH.settings.freeAgency || {mons:[]};
    DASH.settings.freeAgency.mons = SBL.trades.restoreFutureFreeAgencyPool(
      DASH.settings.freeAgency.mons || [],
      rawRosters,
      trades
    );
  }

  // ---------- auth screens ----------
  function renderAuthGate(){
    appEl.querySelector('header .sub').textContent = 'Sign in to manage your team';
    contentEl.innerHTML = `
      <div class="gate">
        <div class="panel">
          <div class="gate-mark">SBL</div>
          <h2>Welcome back</h2>
          <div class="gate-sub">Sign in to manage your team, or create an account to get started.</div>
          <label>Email</label>
          <input id="authEmail" type="email" autocomplete="username" placeholder="you@example.com" style="margin-bottom:12px;">
          <label>Password</label>
          <input id="authPassword" type="password" autocomplete="current-password" placeholder="Password" style="margin-bottom:14px;">
          <div class="foot-actions">
            <button class="primary" id="loginBtn" style="flex:1;">Log in</button>
            <button class="ghost" id="signupBtn" style="flex:1;">Sign up</button>
          </div>
          <div id="authMsg" class="note"></div>
        </div>
      </div>`;
    const msgEl = document.getElementById('authMsg');
    const setMsg = (text, danger)=>{ msgEl.className = 'note' + (danger?' danger':' ok'); msgEl.textContent = text; };

    document.getElementById('loginBtn').onclick = async ()=>{
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      if(!email || !password){ setMsg('Enter your email and password.', true); return; }
      const btn = document.getElementById('loginBtn'); btn.disabled = true;
      const {data, error} = await supabase.auth.signInWithPassword({email, password});
      btn.disabled = false;
      if(error){ setMsg(error.message, true); return; }
      session = data.session;
      await boot();
    };

    document.getElementById('signupBtn').onclick = async ()=>{
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      if(!email || !password){ setMsg('Enter an email and password.', true); return; }
      if(password.length < 6){ setMsg('Password should be at least 6 characters.', true); return; }
      const btn = document.getElementById('signupBtn'); btn.disabled = true;
      const {data, error} = await supabase.auth.signUp({email, password});
      btn.disabled = false;
      if(error){ setMsg(error.message, true); return; }
      if(data.session){ session = data.session; await boot(); }
      else{ setMsg('Account created — check your email to confirm, then log in.', false); }
    };
  }

  // ---------- team claim / status gate ----------
  function renderTeamClaim(){
    const current = profile.team_name || '';
    const currentUsername = profile.username || '';
    const needsUsername = !currentUsername;
    const title = needsUsername ? 'Choose your username' : (current ? 'Your profile' : 'Choose your franchise');
    const intro = needsUsername
      ? 'Choose the username you want to use in the league. Your username identifies you and will be connected to your franchise.'
      : 'Choose the franchise you own. Your username stays connected to this franchise unless an admin changes your profile.';

    contentEl.innerHTML = `
      <div class="gate">
        <div class="panel">
          <h2>${title}</h2>
          <div class="note">${intro}</div>
          ${needsUsername ? `
            <label style="margin-top:12px;">Username</label>
            <input id="usernamePick" type="text" value="" maxlength="24" placeholder="e.g. Poorvansh" autocomplete="nickname">
            <div class="note">2–24 characters. Letters, numbers, underscores and hyphens only. Usernames are unique.</div>
            <div class="foot-actions">
              <button class="primary" id="saveUsernameBtn">Continue</button>
            </div>
          ` : `
            <div class="profile-summary" style="margin-top:14px;">
              <div><strong>Username</strong><br>${SBL.pokemon.escapeHtml(currentUsername)}</div>
            </div>
            <div id="teamClaimFields"><div class="note">Loading available franchises…</div></div>
            <div class="foot-actions">
              <button class="primary" id="claimBtn" disabled>${current ? 'Update franchise' : 'Submit franchise claim'}</button>
            </div>
          `}
          <div id="claimMsg" class="note"></div>
        </div>
      </div>`;

    const msgEl = document.getElementById('claimMsg');

    // Username is deliberately a separate onboarding step. This guarantees that
    // every account gets a league username before entering the normal dashboard,
    // even if the account already has a pending/approved franchise claim.
    if(needsUsername){
      const btn = document.getElementById('saveUsernameBtn');
      btn.onclick = async ()=>{
        const username = document.getElementById('usernamePick').value.trim();
        if(!/^[A-Za-z0-9_-]{2,24}$/.test(username)){
          msgEl.className='note danger';
          msgEl.textContent='Username must be 2–24 characters and use only letters, numbers, underscores or hyphens.';
          return;
        }
        btn.disabled = true;
        try{
          await SBL.profiles.update(session.user.id, {username}, supabase);
          if(error) throw error;
          await loadProfile();
          renderTeamClaim();
        }catch(e){
          msgEl.className='note danger';
          msgEl.textContent = /duplicate|unique/i.test(e.message||'') ? 'That username is already taken. Please choose another.' : e.message;
          btn.disabled = false;
        }
      };
      return;
    }

    (async ()=>{
      const allTeams = teamsList();
      let taken = new Set();
      try{
        const data = await SBL.profiles.list({fields:'team_name', status:'approved', excludeUserId:session.user.id}, supabase);
        if(error) throw error;
        taken = new Set((data||[]).map(p=>p.team_name).filter(Boolean));
      }catch(e){
        console.warn('Could not check claimed teams:', e);
      }
      const teams = allTeams.filter(t => t === current || !taken.has(t));

      const fieldsEl = document.getElementById('teamClaimFields');
      if(!fieldsEl) return;
      fieldsEl.innerHTML = teams.length ? `
        <label style="margin-top:12px;">Franchise</label>
        <select id="teamPick">
          <option value="">— Select a franchise —</option>
          ${teams.map(t=>`<option value="${SBL.pokemon.escapeHtml(t)}" ${t===current?'selected':''}>${SBL.pokemon.escapeHtml(t)}</option>`).join('')}
        </select>` : `
        <label style="margin-top:12px;">Franchise name</label>
        <input id="teamPickText" type="text" value="${SBL.pokemon.escapeHtml(current)}" placeholder="Type your franchise's exact name">
        <div class="note">Franchises haven't been published yet, so type the exact franchise name — an admin will match it up.</div>`;

      const btn = document.getElementById('claimBtn');
      btn.disabled = false;
      btn.onclick = async ()=>{
        const val = teams.length ? document.getElementById('teamPick').value.trim() : document.getElementById('teamPickText').value.trim();
        if(!val){ msgEl.className='note danger'; msgEl.textContent='Pick or type a franchise name.'; return; }
        btn.disabled = true;
        try{
          await SBL.profiles.update(session.user.id, { team_name: val, status: 'pending' }, supabase);
          if(error) throw error;
          await loadProfile();
          render();
        }catch(e){
          msgEl.className='note danger';
          msgEl.textContent = e.message;
          btn.disabled = false;
        }
      };
    })();
  }

  function renderPendingOrRejected(){
    const rejected = profile.status === 'rejected';
    contentEl.innerHTML = `
      <div class="gate">
        <div class="panel">
          <h2>${rejected ? 'Claim rejected' : 'Waiting for approval'}</h2>
          <div class="note">
            ${rejected
              ? `Your claim for <strong>${SBL.pokemon.escapeHtml(profile.team_name)}</strong> was rejected. Pick a different team below, or reach out to your commissioner if you think this is a mistake.`
              : `Your claim for <strong>${SBL.pokemon.escapeHtml(profile.team_name)}</strong> is <span class="status-pill pending">pending</span>. A commissioner needs to approve it before you can manage your roster or propose trades. You can still browse Free Agency below.`}
          </div>
          <div class="foot-actions">
            <button class="ghost" id="changeTeamBtn">${rejected ? 'Pick a different team' : 'Change team pick'}</button>
          </div>
        </div>
      </div>`;
    document.getElementById('changeTeamBtn').onclick = ()=>{ renderTeamClaim(); };
  }

  function recordAdjustKey(){ return `sbl_record_adjust_${session?.user?.id||'anonymous'}_${profile?.team_name||'team'}`; }
  function getRecordAdjustments(){
    try{ const x=JSON.parse(localStorage.getItem(recordAdjustKey())||'{}'); return {wins:Math.max(0,Number(x.wins)||0),losses:Math.max(0,Number(x.losses)||0)}; }catch(e){ return {wins:0,losses:0}; }
  }
  function saveRecordAdjustment(kind){
    const x=getRecordAdjustments(); x[kind==='win'?'wins':'losses']++; try{localStorage.setItem(recordAdjustKey(),JSON.stringify(x));}catch(e){} return x;
  }
  // Pull the official W/L record from the same completed match results that feed the ladder.
  // Replay rows may use either {p1,p2} or [player1,player2] for players.
  function myTeamRecord(){
    const team=String(profile?.team_name||'').trim();
    let wins=0, losses=0, games=0;
    const same=(a,b)=>String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();
    for(const r of Object.values(DASH.replays||{})){
      if(!r || !r.players) continue;
      const players=Array.isArray(r.players) ? r.players : [r.players.p1,r.players.p2];
      let mySide=-1;
      for(let side=0;side<2;side++){
        if(same(teamFor(players[side]),team)){ mySide=side; break; }
      }
      if(mySide<0) continue;
      const results=r.results||{};
      const direct=results[mySide] ?? results[mySide===0?'p1':'p2'];
      const v=typeof direct==='string' ? direct.trim().toLowerCase() : '';
      let result=(v==='w'||v==='win'||v==='won')?'W':(v==='l'||v==='loss'||v==='lost')?'L':'';
      if(!result && r.winner) result=same(r.winner,players[mySide])?'W':'L';
      if(!result) continue;
      games++;
      if(result==='W') wins++; else losses++;
    }
    return {wins,losses,games};
  }

  let lastRandomTradeKey = '';

  function randomTradeSuggestion(){
    const mine=myRoster();
    const myPts=rosterPoints(mine);
    const candidates=[];
    for(const team of teamsList().filter(t=>t!==profile.team_name)){
      const theirs=DASH.settings.rosters[team]||[];
      for(const give of mine){
        for(const get of theirs){
          const myAfter=myPts-(Number(give.points)||0)+(Number(get.points)||0);
          const theirAfter=rosterPoints(theirs)-(Number(get.points)||0)+(Number(give.points)||0);
          if(mine.length < 10 || theirs.length < 10) continue;
          if(myAfter>ROSTER_BUDGET || theirAfter>ROSTER_BUDGET) continue;
          candidates.push({team,give,get});
        }
      }
    }
    if(!candidates.length) return null;

    // Prefer a different suggestion when the user presses Reroll. If there is
    // only one legal trade, keep returning it rather than showing no result.
    const fresh = candidates.filter(s => `${s.team}|${s.give.name}|${s.get.name}` !== lastRandomTradeKey);
    const pool = fresh.length ? fresh : candidates;
    const picked = pool[Math.floor(Math.random()*pool.length)];
    lastRandomTradeKey = `${picked.team}|${picked.give.name}|${picked.get.name}`;
    return picked;
  }

  function useRandomTradeSuggestion(s){
    if(!s) return;
    // Pre-fill the existing trade composer; nothing is submitted automatically.
    draft.target=s.team;
    draft.offered=new Set([s.give.name]);
    draft.requested=new Set([s.get.name]);
    draft.faQuery='';
    activeTab='trades';
    window.tradeViewFilter='pending';
    renderTabs();
    render();
    requestAnimationFrame(()=>{
      document.getElementById('proposePanel')?.scrollIntoView({behavior:'smooth',block:'start'});
    });
  }

  // ---------- Bug reports / suggestions ----------
  function feedbackItems(){
    const list = Array.isArray(DASH.settings?.feedback) ? DASH.settings.feedback : [];
    return list.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
  }
  function feedbackStatusLabel(v){
    return v==='in-progress' ? 'In Progress' : v==='wont-fix' ? "Won't Fix" : v==='resolved' ? 'Resolved' : 'New';
  }
  async function submitFeedback(){
    const type=document.getElementById('feedbackType')?.value||'bug';
    const title=document.getElementById('feedbackTitle')?.value.trim()||'';
    const description=document.getElementById('feedbackDescription')?.value.trim()||'';
    const msg=document.getElementById('feedbackMsg');
    if(!title||!description){ if(msg){msg.className='note danger';msg.textContent='Please give the submission a title and description.';} return; }
    const btn=document.getElementById('submitFeedbackBtn'); if(btn) btn.disabled=true;
    try{
      DASH.settings.feedback=feedbackItems();
      DASH.settings.feedback.unshift({
        id:'fb-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),
        type,title,description,
        submittedBy:profile.username||profile.team_name||'League user',
        team:profile.team_name||'',
        status:'new',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
      });
      await SBL.replays.saveSharedState({teamMap:DASH.teamMap,settings:DASH.settings}, supabase);
      if(msg){msg.className='note ok';msg.textContent='Submitted. Thanks — the commissioners can review it from the Admin Dashboard.';}
      document.getElementById('feedbackTitle').value=''; document.getElementById('feedbackDescription').value='';
      renderFeedback();
    }catch(e){ if(msg){msg.className='note danger';msg.textContent='Could not submit: '+e.message;} }
    finally{ if(btn) btn.disabled=false; }
  }
  function renderFeedback(){
    const items=feedbackItems();
    const mine=items.filter(x=>x.submittedBy===profile.username && (!x.team || x.team===profile.team_name));
    contentEl.innerHTML=`
      <section class="panel">
        <div class="myteam-section-head"><div><h2>Bug Fixes & Suggestions</h2><div class="note">Found a bug or have an idea? Send it straight to the commissioners.</div></div></div>
        <div class="feedback-form-grid" style="margin-top:14px">
          <div><label for="feedbackType">Type</label><select id="feedbackType"><option value="bug">Bug Report</option><option value="suggestion">Suggestion</option><option value="ui">UI / Design</option><option value="league">League / Rules</option><option value="other">Other</option></select></div>
          <div><label for="feedbackTitle">Title</label><input id="feedbackTitle" type="text" maxlength="120" placeholder="Short summary"></div>
          <div class="full"><label for="feedbackDescription">Details</label><textarea id="feedbackDescription" rows="6" maxlength="3000" placeholder="Tell us what happened, what you expected, or what you'd like changed." style="width:100%;resize:vertical"></textarea></div>
        </div>
        <div class="foot-actions"><button class="primary" id="submitFeedbackBtn">Submit</button></div>
        <div id="feedbackMsg" class="note"></div>
      </section>
      <section class="panel">
        <div class="myteam-section-head"><div><h2>Your submissions</h2><div class="note">Track the status of feedback you've sent.</div></div></div>
        <div class="feedback-list">${mine.length?mine.map(x=>`<div class="feedback-card"><div class="feedback-card-head"><div><div class="feedback-card-title">${SBL.pokemon.escapeHtml(x.title)}</div><div class="feedback-meta">${SBL.pokemon.escapeHtml(x.type)} · ${new Date(x.createdAt).toLocaleString()}</div></div><span class="feedback-status ${SBL.pokemon.escapeHtml(x.status)}">${feedbackStatusLabel(x.status)}</span></div><div class="note" style="margin-top:9px;white-space:pre-wrap">${SBL.pokemon.escapeHtml(x.description)}</div></div>`).join(''):'<div class="empty-state">You have not submitted anything yet.</div>'}</div>
      </section>`;
    document.getElementById('submitFeedbackBtn').onclick=submitFeedback;
  }

  // ---------- My Team tab ----------
  function nextBattleForTeam(team){
    const rounds = Array.isArray(DASH.settings?.fixture?.rounds) ? DASH.settings.fixture.rounds : [];
    const key = v => String(v||'').trim().toLowerCase().replace(/[^a-z0-9]/g);
    const target = key(team);
    const played = (week, home, away) => Object.values(DASH.replays||{}).some(r=>{
      if(!r || (r.week||'Unassigned') !== week || !r.players) return false;
      const p1=teamFor(r.players.p1), p2=teamFor(r.players.p2), a=key(p1), b=key(p2);
      return (a===key(home)&&b===key(away)) || (a===key(away)&&b===key(home));
    });
    for(const round of rounds){
      for(const match of (round.matches||[])){
        if(key(match.home)!==target && key(match.away)!==target) continue;
        if(played(round.week,match.home,match.away)) continue;
        return {week:round.week,opponent:key(match.home)===target?match.away:match.home};
      }
    }
    return null;
  }
  function wireNextBattle(){
    const card=document.getElementById('nextBattleCard'), op=document.getElementById('nextBattleOpponent'), meta=document.getElementById('nextBattleMeta');
    if(!card||!op||!meta) return;
    const battle=nextBattleForTeam(profile.team_name);
    if(!battle){ op.textContent='No upcoming battle'; meta.textContent='Open Match Prep →'; card.href='match-prep.html'; return; }
    op.textContent=battle.opponent; meta.textContent=`${battle.week} · Open Match Prep →`;
    card.href=`match-prep.html?team=${encodeURIComponent(battle.opponent)}`;
  }

  function matchResultForTeam(r, team){
    if(!r || !r.players) return '';
    const players=Array.isArray(r.players)?r.players:[r.players.p1,r.players.p2];
    let side=-1;
    for(let i=0;i<2;i++){ if(String(teamFor(players[i])).trim().toLowerCase()===String(team).trim().toLowerCase()){ side=i; break; } }
    if(side<0) return '';
    const results=r.results||{};
    const direct=results[side] ?? results[side===0?'p1':'p2'];
    const v=typeof direct==='string'?direct.trim().toLowerCase():'';
    if(v==='w'||v==='win'||v==='won') return 'W';
    if(v==='l'||v==='loss'||v==='lost') return 'L';
    if(r.winner) return String(r.winner).trim().toLowerCase()===String(players[side]||'').trim().toLowerCase()?'W':'L';
    return '';
  }
  function myTeamMatchData(){
    const team=profile?.team_name||'';
    return Object.entries(DASH.replays||{}).map(([id,r])=>{
      if(!r||!r.players) return null;
      const players=Array.isArray(r.players)?r.players:[r.players.p1,r.players.p2];
      const sides=players.map(p=>teamFor(p));
      const side=sides.findIndex(t=>String(t).trim().toLowerCase()===String(team).trim().toLowerCase());
      if(side<0) return null;
      return {id:r.id||id,r,players,teams:sides,opponent:sides[side===0?1:0]||players[side===0?1:0]||'Unknown',result:matchResultForTeam(r,team),week:r.week||'Unassigned',format:r.format||'Replay',date:r.created_at||r.createdAt||r.timestamp||r.date||''};
    }).filter(Boolean).sort((a,b)=>{const wa=parseInt(String(a.week).match(/\d+/)?.[0]||'-1',10);const wb=parseInt(String(b.week).match(/\d+/)?.[0]||'-1',10);if(wb!==wa)return wb-wa;const da=Date.parse(a.date)||0,db=Date.parse(b.date)||0;return db-da;});
  }
  function recentBattleRowHtml(x){
    const resultClass=x.result==='W'?'win':x.result==='L'?'loss':'unknown';
    const resultText=x.result==='W'?'Win':x.result==='L'?'Loss':'Unknown';
    const date=x.date?new Date(x.date).toLocaleDateString():'—';
    return `<div class="recent-battle-row"><div class="recent-battle-week">${SBL.pokemon.escapeHtml(x.week)}</div><div><div class="recent-battle-match">${SBL.pokemon.escapeHtml(profile.team_name)}<span class="vs">vs</span>${SBL.pokemon.escapeHtml(x.opponent)}</div><div class="recent-battle-meta">${SBL.pokemon.escapeHtml(x.format)} · ${SBL.pokemon.escapeHtml(date)}</div></div><div class="recent-result ${resultClass}">${resultText}</div><button class="ghost small" type="button" data-myteam-match="${SBL.pokemon.escapeHtml(x.id)}">Summary</button></div>`;
  }
  function openMyTeamReplaySummary(replayId){
    const r=DASH.replays?.[replayId];
    if(!r) return;
    const p1=(r.players?.p1||'?').trim()||'?'; const p2=(r.players?.p2||'?').trim()||'?';
    const winner=(r.winner||'').trim(); const resultText=winner?`${winner} won`:'Result unavailable';
    const mons=Object.values(r.mons||{});
    const sideMons=side=>{const seen={};(r.teamRoster?.[side]||[]).forEach(sp=>seen[normName(sp)]={side,species:sp,kills:0,assists:0,deaths:0,damageDealt:0,damageTaken:0,appearances:0});mons.filter(m=>m.side===side).forEach(m=>seen[normName(m.species)]=m);return Object.values(seen).sort((a,b)=>(b.kills-a.kills)||(a.deaths-b.deaths)||(b.damageDealt-a.damageDealt));};
    const sideCard=(side,player)=>{const list=sideMons(side),team=teamFor(player),kills=list.reduce((n,m)=>n+(Number(m.kills)||0),0),deaths=list.reduce((n,m)=>n+(Number(m.deaths)||0),0),assists=list.reduce((n,m)=>n+(Number(m.assists)||0),0),dealt=list.reduce((n,m)=>n+(Number(m.damageDealt)||0),0),taken=list.reduce((n,m)=>n+(Number(m.damageTaken)||0),0);return `<div class="myteam-summary-side"><div class="myteam-summary-side-head"><div><strong>${SBL.pokemon.escapeHtml(player)}</strong><div class="myteam-summary-team">${SBL.pokemon.escapeHtml(team)}</div></div><div class="myteam-summary-score">${deaths} fainted</div></div><div class="myteam-summary-line"><span>${kills} kills</span><span>${assists} assists</span><span>${dealt.toFixed(1)}% damage dealt</span><span>${taken.toFixed(1)}% taken</span></div><div class="myteam-summary-mons">${list.map(m=>`<div class="myteam-summary-mon">${SBL.pokemon.spriteMarkup(m.species,'sprite')}<div class="myteam-summary-mon-main"><strong>${SBL.pokemon.escapeHtml(SBL.pokemon.displayName(m.species))}</strong><div class="myteam-summary-mon-stats">${m.kills||0} K · ${m.assists||0} A · ${m.deaths||0} D · ${(Number(m.damageDealt)||0).toFixed(1)}% dmg</div></div>${m.appearances?(m.deaths?'<span class="badge danger-badge">Fainted</span>':'<span class="badge">Survived</span>'):'<span class="badge">Not sent</span>'}</div>`).join('')||'<div class="empty-state">No Pokémon recorded.</div>'}</div></div>`;};
    let overlay=document.getElementById('myteamReplayOverlay'); if(overlay) overlay.remove();
    overlay=document.createElement('div'); overlay.className='myteam-replay-overlay'; overlay.id='myteamReplayOverlay';
    overlay.innerHTML=`<div class="myteam-replay-box"><div class="myteam-summary-header"><div><div class="myteam-summary-kicker">${SBL.pokemon.escapeHtml(r.week||'Unassigned')} · ${SBL.pokemon.escapeHtml(r.format||'Replay')}</div><h3>${SBL.pokemon.escapeHtml(p1)} <span class="myteam-summary-vs">vs</span> ${SBL.pokemon.escapeHtml(p2)}</h3><div class="myteam-summary-result">${SBL.pokemon.escapeHtml(resultText)}</div></div><div class="myteam-summary-meta"><span>${mons.length} Pokémon recorded</span><span>Replay ${SBL.pokemon.escapeHtml(r.id||replayId)}</span></div></div><div class="myteam-summary-grid">${sideCard('p1',p1)}${sideCard('p2',p2)}</div><div class="myteam-summary-actions"><a class="primary nav-link" href="https://replay.pokemonshowdown.com/${SBL.pokemon.escapeHtml(r.id||replayId)}" target="_blank" rel="noopener">Open Showdown replay</a><button class="ghost" type="button" id="myteamReplayClose">Close</button></div></div>`;
    document.body.appendChild(overlay); document.body.style.overflow='hidden';
    const close=()=>{overlay.remove();document.body.style.overflow='';};
    document.getElementById('myteamReplayClose').onclick=close; overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
    overlay._close=close;
  }

  function renderMyTeam(){
    if(profile.status !== 'approved'){
      contentEl.innerHTML = `<div class="panel"><div class="empty-state">Your team claim needs to be approved by a commissioner before you can manage your roster.</div></div>`;
      return;
    }
    const roster=myRoster();
    const pts=rosterPoints(roster);
    const remaining=Math.max(0,ROSTER_BUDGET-pts);
    const pct=Math.min(100,Math.round((pts/ROSTER_BUDGET)*100));
    const rec=myTeamRecord();
    const stats=roster.map(m=>({m,s:myPokemonStats(m.name)}));
    const played=stats.filter(x=>x.s?.games>0);
    const topKills=[...played].sort((a,b)=>(b.s.kills||0)-(a.s.kills||0))[0];
    const topDeaths=[...played].sort((a,b)=>(b.s.deaths||0)-(a.s.deaths||0))[0];
    const mostBrought=[...played].sort((a,b)=>(b.s.games||0)-(a.s.games||0))[0];
    const topAssists=[...played].sort((a,b)=>(b.s.assists||0)-(a.s.assists||0))[0];
    const totalKills=played.reduce((n,x)=>n+(x.s.kills||0),0);
    const totalDeaths=played.reduce((n,x)=>n+(x.s.deaths||0),0);
    const totalAssists=played.reduce((n,x)=>n+(x.s.assists||0),0);
    const suggestion=randomTradeSuggestion();

    contentEl.innerHTML=`
      <section class="myteam-hero">
        <div class="myteam-hero-grid">
          <div>
            <div class="myteam-kicker">My Team</div>
            <div class="myteam-title">${SBL.pokemon.escapeHtml(profile.team_name)}</div>
            <div class="myteam-sub">${roster.length} Pokémon on your active roster · ${rec.games} games played</div>
            <div class="myteam-record">
              <button type="button" class="record-box win record-adjust" data-record-adjust="win"><span class="label">Wins</span><span class="value">${rec.wins}</span></button>
              <button type="button" class="record-box loss record-adjust" data-record-adjust="loss"><span class="label">Losses</span><span class="value">${rec.losses}</span></button>
              <div class="record-box"><div class="label">Record</div><div class="value">${rec.wins}-${rec.losses}</div></div>
            </div>
            <div class="record-note">Replay results are included automatically. Use +1 for a manually recorded result that is not in the replay feed.</div>
          </div>
          <div class="myteam-hero-side">
            <a class="next-battle-card" id="nextBattleCard" href="match-prep.html">
              <div class="next-battle-kicker">Next Battle</div>
              <div class="next-battle-opponent" id="nextBattleOpponent">Loading…</div>
              <div class="next-battle-meta" id="nextBattleMeta">Open Match Prep →</div>
            </a>
            <div class="myteam-budget">
              <div class="myteam-budget-head"><span class="myteam-budget-label">Draft Budget</span><span class="myteam-budget-value">${pts}<span style="color:var(--text-dim);font-size:13px"> / ${ROSTER_BUDGET}</span></span></div>
              <div class="myteam-budget-bar"><div class="myteam-budget-fill" style="width:${pct}%"></div></div>
              <div class="myteam-budget-remaining"><span>Spent</span><span>${remaining} pts remaining</span></div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="myteam-section-head"><div><h2>Team Display</h2><div class="note">Your active roster, with draft cost and season production.</div></div></div>
        ${roster.length?`<div class="myteam-roster-grid">${roster.map(mon=>{
          const st=myPokemonStats(mon.name); const has=st&&st.games>0;
          return `<div class="myteam-mon">
            <div class="myteam-mon-top">${SBL.pokemon.spriteMarkup(mon.name,'sprite')}<div><div class="myteam-mon-name">${SBL.pokemon.escapeHtml(SBL.pokemon.displayName(mon.name))}</div><div class="myteam-mon-points">${mon.points!=null?SBL.pokemon.escapeHtml(mon.points)+' pts':'Unranked'}</div></div></div>
            <div class="myteam-mon-stats">
              <div class="myteam-mon-stat"><div class="v">${has?st.games:'—'}</div><div class="l">Games</div></div>
              <div class="myteam-mon-stat"><div class="v" style="color:var(--teal)">${has?st.kills:'—'}</div><div class="l">Kills</div></div>
              <div class="myteam-mon-stat"><div class="v" style="color:var(--red)">${has?st.deaths:'—'}</div><div class="l">Deaths</div></div>
            </div>
          </div>`;
        }).join('')}</div>`:'<div class="empty-state">No roster published for your team yet.</div>'}
      </section>

      <section class="panel" id="recentBattlesPanel">
        <div class="myteam-section-head"><div><h2>Recent Battles</h2><div class="note">Your latest completed matches. Click Summary to view the full replay-browser-style match breakdown.</div></div><button class="ghost small" type="button" id="viewAllBattlesBtn">View all</button></div>
        <div class="recent-battles-list">${myTeamMatchData().slice(0,5).map(recentBattleRowHtml).join('') || '<div class="empty-state">No match history yet.</div>'}</div>
      </section>

      <div class="myteam-dashboard-grid">
        <section class="panel">
          <div class="myteam-section-head"><div><h2>Basic Stats</h2><div class="note">Quick season leaders from your roster.</div></div></div>
          <div class="myteam-stat-grid">
            <div class="myteam-stat-card"><div class="eyebrow">Top Kills</div><div class="big stat-mon">${topKills?SBL.pokemon.spriteMarkup(topKills.m.name,'sprite'):''}<span>${topKills?SBL.pokemon.escapeHtml(SBL.pokemon.displayName(topKills.m.name)):'—'}</span></div><div class="small">${topKills?`${topKills.s.kills} KOs`: 'No games recorded'}</div></div>
            <div class="myteam-stat-card"><div class="eyebrow">Top Deaths</div><div class="big stat-mon">${topDeaths?SBL.pokemon.spriteMarkup(topDeaths.m.name,'sprite'):''}<span>${topDeaths?SBL.pokemon.escapeHtml(SBL.pokemon.displayName(topDeaths.m.name)):'—'}</span></div><div class="small">${topDeaths?`${topDeaths.s.deaths} deaths`: 'No games recorded'}</div></div>
            <div class="myteam-stat-card"><div class="eyebrow">Most Brought</div><div class="big stat-mon">${mostBrought?SBL.pokemon.spriteMarkup(mostBrought.m.name,'sprite'):''}<span>${mostBrought?SBL.pokemon.escapeHtml(SBL.pokemon.displayName(mostBrought.m.name)):'—'}</span></div><div class="small">${mostBrought?`${mostBrought.s.games} games`: 'No games recorded'}</div></div>
            <div class="myteam-stat-card"><div class="eyebrow">Top Assists</div><div class="big stat-mon">${topAssists?SBL.pokemon.spriteMarkup(topAssists.m.name,'sprite'):''}<span>${topAssists?SBL.pokemon.escapeHtml(SBL.pokemon.displayName(topAssists.m.name)):'—'}</span></div><div class="small">${topAssists?`${topAssists.s.assists} assists`: 'No games recorded'}</div></div>
            <div class="myteam-stat-card"><div class="eyebrow">Team Kills</div><div class="big">${totalKills}</div><div class="small">Across ${rec.games} team games</div></div>
            <div class="myteam-stat-card"><div class="eyebrow">Team Deaths</div><div class="big">${totalDeaths}</div><div class="small">${totalAssists} assists recorded</div></div>
          </div>
        </section>

        <section class="panel">
          <div class="myteam-section-head"><div><h2>Random Trade Suggestions</h2><div class="note">Find a random legal 1-for-1 swap with another franchise.</div></div></div>
          <div class="random-trade">
            <div id="randomTradeResult">${suggestion?`<div class="random-trade-flow"><div class="random-trade-side"><div class="label">You give</div><div class="random-trade-mon stat-mon">${SBL.pokemon.spriteMarkup(suggestion.give.name,'sprite')}<span>${SBL.pokemon.escapeHtml(SBL.pokemon.displayName(suggestion.give.name))}</span></div><div class="note" style="margin:2px 0 0">${suggestion.give.points} pts</div></div><div class="random-trade-arrow">→</div><div class="random-trade-side"><div class="label">You get · ${SBL.pokemon.escapeHtml(suggestion.team)}</div><div class="random-trade-mon stat-mon">${SBL.pokemon.spriteMarkup(suggestion.get.name,'sprite')}<span>${SBL.pokemon.escapeHtml(SBL.pokemon.displayName(suggestion.get.name))}</span></div><div class="note" style="margin:2px 0 0">${suggestion.get.points} pts</div></div></div>`:'<div class="empty-state" style="padding:8px 0">No legal random swap found right now.</div>'}</div>
            <div class="foot-actions" style="margin-top:10px"><button class="ghost small" id="rerollTradeBtn">🎲 Reroll</button>${suggestion?'<button class="primary small" id="useTradeSuggestionBtn">Use suggestion</button>':''}</div>
          </div>
        </section>
      </div>`;

    document.getElementById('rerollTradeBtn').onclick=()=>renderMyTeam();
    if(suggestion){ document.getElementById('useTradeSuggestionBtn').onclick=()=>useRandomTradeSuggestion(suggestion); }
    wireNextBattle();
}

  function renderProposeTrade(){
    const el = document.getElementById('proposePanel');
    const roster = myRoster();
    const otherTeams = teamsList().filter(t=>t!==profile.team_name);
    const targetIsFA = draft.target === '';
    const targetRoster = targetIsFA ? null : (DASH.settings.rosters[draft.target] || []);
    const requestPool = targetIsFA ? freeAgencyMons() : (targetRoster || []);

    function pickCard(m, role){
      const set = role === 'offered' ? draft.offered : draft.requested;
      const checked = set.has(m.name);
      return `<div class="pick-card${checked?' checked':''}" data-role="${role}" data-name="${SBL.pokemon.escapeHtml(m.name)}" role="button" tabindex="0" aria-pressed="${checked}">
        <span class="pick-card-check">✓</span>
        ${SBL.pokemon.spriteMarkup(m.name,'sprite')}
        <div class="pick-card-name">${SBL.pokemon.escapeHtml(SBL.pokemon.displayName(m.name))}</div>
        ${m.points!=null?`<div class="pick-card-pts">${SBL.pokemon.escapeHtml(m.points)} pts</div>`:''}
      </div>`;
    }

    function chipsHtml(role){
      const set = role === 'offered' ? draft.offered : draft.requested;
      const pool = role === 'offered' ? roster : requestPool;
      return Array.from(set).map(name=>{
        const m = pool.find(x=>x.name===name) || {name, points:null};
        return `<span class="selected-chip">${SBL.pokemon.spriteMarkup(m.name,'sprite')} ${SBL.pokemon.escapeHtml(m.name)}<button type="button" data-remove="${SBL.pokemon.escapeHtml(name)}" data-role="${role}" aria-label="Remove ${SBL.pokemon.escapeHtml(name)}">×</button></span>`;
      }).join('');
    }

    function faResultsHtml(){
      const q = (draft.faQuery||'').trim().toLowerCase();
      if(!q) return '<div class="fa-hint">Only Pokémon that are currently undrafted are available in Free Agency.</div>';
      const matches = freeAgencyMons().filter(m=>m.name.toLowerCase().includes(q)).slice(0,30);
      if(!matches.length) return `<div class="fa-empty">No free agents match “${SBL.pokemon.escapeHtml(draft.faQuery)}”.</div>`;
      return matches.map(m=>pickCard(m,'requested')).join('');
    }

    el.innerHTML = `
      <h2>Propose a Trade</h2>
      <div class="note">You can offer multiple Pokémon for multiple Pokémon. Point totals do not have to match, but after the trade neither roster may exceed 115 points or fall below 10 Pokémon. Each team gets 8 completed trades per season.</div>
      <div class="row">
        <div>
          <label>Trade with</label>
          <select id="targetSelect">
            <option value="" ${targetIsFA?'selected':''}>— Free Agency —</option>
            ${otherTeams.map(t=>`<option value="${SBL.pokemon.escapeHtml(t)}" ${t===draft.target?'selected':''}>${SBL.pokemon.escapeHtml(t)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="trade-cols">
        <div class="trade-col">
          <h4>You give ${targetIsFA?'(optional for a free-agency pickup)':''}</h4>
          <div class="selected-row" id="offeredSelected">${chipsHtml('offered')}</div>
          <div class="pick-grid" id="offeredPicks">
            ${roster.length ? roster.map(m=>pickCard(m,'offered')).join('') : '<div class="empty-state">Your roster is empty.</div>'}
          </div>
        </div>
        <div class="trade-col">
          <h4>You get ${targetIsFA?'(undrafted only)':''}</h4>
          <div class="selected-row" id="requestedSelected">${chipsHtml('requested')}</div>
          ${targetIsFA ? `
            <div class="fa-search-wrap">
              <input type="text" id="faSearch" placeholder="Search undrafted Pokémon…" value="${SBL.pokemon.escapeHtml(draft.faQuery||'')}" autocomplete="off">
            </div>
            <div class="pick-grid" id="requestedPicks">${faResultsHtml()}</div>
          ` : `
            <div class="pick-grid" id="requestedPicks">
              ${requestPool.length ? requestPool.map(m=>pickCard(m,'requested')).join('') : '<div class="empty-state">That team has no published roster.</div>'}
            </div>
          `}
        </div>
      </div>
      <div class="note" id="tradeSummary"></div>
      <div class="foot-actions">
        <button class="ghost" id="clearTradeSelectionBtn" type="button">Clear selected</button>
        <button class="primary" id="submitTradeBtn">Send trade proposal</button>
      </div>
      <div id="tradeMsg" class="note"></div>`;

    function totalPts(role){
      const set = role === 'offered' ? draft.offered : draft.requested;
      const pool = role === 'offered' ? roster : requestPool;
      return Array.from(set).reduce((s,name)=>{ const m = pool.find(x=>x.name===name); return s + (m ? (Number(m.points)||0) : 0); }, 0);
    }

    function tradeLimitMessage(team, kind='team'){
      const a = tradeAllowance(team, kind);
      const label = kind === 'freeagency' ? 'Free Agency trades' : 'team-to-team trades';
      return `${SBL.pokemon.escapeHtml(team)} has used ${a.used}/${a.limit} ${label} this season (${a.remaining} remaining)`;
    }

    function updateTradeSummary(){
      const summaryEl = document.getElementById('tradeSummary');
      if(!summaryEl) return;
      const offPts = totalPts('offered'), reqPts = totalPts('requested');
      const proposerAfter = roster.length - draft.offered.size + draft.requested.size;
      const targetAfter = targetIsFA ? null : ((targetRoster||[]).length - draft.requested.size + draft.offered.size);
      const pointDelta = reqPts - offPts;
      const bits = [`Give ${offPts} pts / Get ${reqPts} pts${pointDelta===0 ? ' — balanced' : pointDelta>0 ? ` — you gain ${pointDelta} pts` : ` — you lose ${Math.abs(pointDelta)} pts`}`];
      bits.push(`Your roster after: ${proposerAfter}${proposerAfter<10?' (below 10 minimum)':''}`);
      bits.push(`${tradeLimitMessage(profile.team_name, targetIsFA ? 'freeagency' : 'team')}`);
      if(!targetIsFA){
        bits.push(`${SBL.pokemon.escapeHtml(draft.target)} roster after: ${targetAfter}${targetAfter<10?' (below 10 minimum)':''}`);
        bits.push(`${tradeLimitMessage(draft.target, 'team')}`);
      }
      summaryEl.textContent = bits.join(' · ');
    }
    updateTradeSummary();

    document.getElementById('targetSelect').onchange = (e)=>{
      draft.target = e.target.value;
      draft.requested = new Set();
      draft.faQuery = '';
      renderProposeTrade();
    };

    function bindPickCards(container){
      container.querySelectorAll('.pick-card').forEach(card=>{
        const toggle = ()=>{
          const role = card.dataset.role, name = card.dataset.name;
          const set = role === 'offered' ? draft.offered : draft.requested;
          if(set.has(name)) set.delete(name); else set.add(name);
          card.classList.toggle('checked', set.has(name));
          card.setAttribute('aria-pressed', set.has(name));
          const rowId = role === 'offered' ? 'offeredSelected' : 'requestedSelected';
          document.getElementById(rowId).innerHTML = chipsHtml(role);
          bindChipRemovers();
          updateTradeSummary();
        };
        card.addEventListener('click', toggle);
        card.addEventListener('keydown', (e)=>{
          if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); }
        });
      });
    }

    function bindChipRemovers(){
      el.querySelectorAll('.selected-chip button[data-remove]').forEach(btn=>{
        btn.onclick = ()=>{
          const role = btn.dataset.role, name = btn.dataset.remove;
          const set = role === 'offered' ? draft.offered : draft.requested;
          set.delete(name);
          document.getElementById(role === 'offered' ? 'offeredSelected' : 'requestedSelected').innerHTML = chipsHtml(role);
          const grid = document.getElementById(role === 'offered' ? 'offeredPicks' : 'requestedPicks');
          const card = grid && Array.from(grid.querySelectorAll('.pick-card')).find(c=>c.dataset.name === name);
          if(card){ card.classList.remove('checked'); card.setAttribute('aria-pressed','false'); }
          bindChipRemovers();
          updateTradeSummary();
        };
      });
    }

    bindPickCards(el);
    bindChipRemovers();

    if(targetIsFA){
      const searchInput = document.getElementById('faSearch');
      searchInput.addEventListener('input', (e)=>{
        draft.faQuery = e.target.value;
        const grid = document.getElementById('requestedPicks');
        grid.innerHTML = faResultsHtml();
        bindPickCards(grid);
      });
    }

    document.getElementById('clearTradeSelectionBtn').onclick = ()=>{
      draft.offered = new Set();
      draft.requested = new Set();
      const msgEl = document.getElementById('tradeMsg');
      if(msgEl){ msgEl.className='note'; msgEl.textContent=''; }
      renderProposeTrade();
    };

    document.getElementById('submitTradeBtn').onclick = async ()=>{
      const msgEl = document.getElementById('tradeMsg');
      if(draft.offered.size < 1 || draft.requested.size < 1){ msgEl.className='note danger'; msgEl.textContent='Select at least one Pokémon on each side.'; return; }
      const offPts = totalPts('offered'), reqPts = totalPts('requested');
      const proposerAfter = roster.length - draft.offered.size + draft.requested.size;
      const proposerPointsAfter = rosterPoints(roster) - offPts + reqPts;

      // Each team gets 8 completed trades per season. Team trades consume a
      // slot for both teams; Free Agency trades consume a slot for the team
      // making the pickup. Pending trades do not consume a slot.
      const proposerAllowance = tradeAllowance(profile.team_name, targetIsFA ? 'freeagency' : 'team');
      if(proposerAllowance.remaining <= 0){
        msgEl.className='note danger';
        msgEl.textContent=`You don't have any ${targetIsFA ? 'Free Agency' : 'team-to-team'} trades remaining.`;
        return;
      }

      if(proposerAfter < 10){
        msgEl.className='note danger';
        msgEl.textContent=`Invalid trade: your roster would have ${proposerAfter} Pokémon. Both sides must have at least 10.`;
        return;
      }

      if(proposerPointsAfter > ROSTER_BUDGET){
        msgEl.className='note danger';
        msgEl.textContent=`Invalid trade: your roster would be ${proposerPointsAfter}/${ROSTER_BUDGET} points, which is ${proposerPointsAfter-ROSTER_BUDGET} over the limit. You give ${offPts} points and receive ${reqPts} points.`;
        return;
      }

      if(!targetIsFA){
        const targetAfter = (targetRoster||[]).length - draft.requested.size + draft.offered.size;
        const targetPointsAfter = rosterPoints(targetRoster||[]) - reqPts + offPts;
        const targetAllowance = tradeAllowance(draft.target, 'team');

        if(targetAllowance.remaining <= 0){
          msgEl.className='note danger';
          msgEl.textContent=`${draft.target} doesn't have any team-to-team trades remaining.`;
          return;
        }

        if(targetAfter < 10){
          msgEl.className='note danger';
          msgEl.textContent=`Invalid trade: ${draft.target}'s roster would have ${targetAfter} Pokémon. Both sides must have at least 10.`;
          return;
        }

        if(targetPointsAfter > ROSTER_BUDGET){
          msgEl.className='note danger';
          msgEl.textContent=`Invalid trade: ${draft.target}'s roster would be ${targetPointsAfter}/${ROSTER_BUDGET} points, which is ${targetPointsAfter-ROSTER_BUDGET} over the limit. They give ${reqPts} points and receive ${offPts} points.`;
          return;
        }
      }
      const btn = document.getElementById('submitTradeBtn'); btn.disabled = true;
      msgEl.className='note'; msgEl.textContent='Sending…';
      try{
        // Always submit the canonical Pokémon name used by the published
        // roster/Free Agency data. This prevents form-name differences such
        // as "Tauros Blaze" vs "Tauros Paldea Blaze" from breaking accept_trade.
        const canonicalOffered = Array.from(draft.offered).map(name =>
          canonicalTradePokemonName(name, roster, [])
        );
        const canonicalRequested = Array.from(draft.requested).map(name =>
          canonicalTradePokemonName(name, targetIsFA ? [] : targetRoster, targetIsFA ? freeAgencyMons() : [])
        );

        await SBL.trades.create({
           proposer_team: profile.team_name,
           target_team: targetIsFA ? null : draft.target,
           mons_offered: canonicalOffered,
           mons_requested: canonicalRequested
         }, supabase);
        draft = { target:'', offered:new Set(), requested:new Set(), faQuery:'' };
        await loadTrades();
        activeTab = 'trades';
        markTradeTabSeen('all');
        setStatus('Trade proposal sent.', false);
        renderTabs(); render();
      }catch(e){
        msgEl.className='note danger'; msgEl.textContent = e.message;
        btn.disabled = false;
      }
    };
  }

  // ---------- Trades tab ----------
  function tradeCard(t, role){
    const canRespond = role === 'incoming' && t.status === 'pending';
    const canWithdraw = role === 'outgoing' && t.status === 'pending';
    return `<div class="trade-card" data-id="${t.id}">
      <div class="trade-head">
        <div>
          <div class="trade-teams">${SBL.pokemon.escapeHtml(t.proposer_team)}<span class="arrow">→</span>${t.target_team ? SBL.pokemon.escapeHtml(t.target_team) : 'Free Agency'}</div>
          <div class="trade-sub">${new Date(t.created_at).toLocaleString()}${t.status === 'accepted' ? ` · ${SBL.trades.isScheduled(t) ? 'Effective' : 'Active'} ${SBL.trades.formatEffectiveDate(t)}` : ''}</div>
        </div>
        <span class="status-pill ${t.status}">${t.status === 'accepted' && SBL.trades.isScheduled(t) ? 'scheduled' : t.status}</span>
      </div>
      <div class="trade-cols">
        <div class="trade-col"><h4>Offered</h4><div class="mon-list">${(t.mons_offered||[]).length ? t.mons_offered.map(n=>`<span class="mon-pill">${SBL.pokemon.spriteMarkup(n)} ${SBL.pokemon.escapeHtml(n)}</span>`).join('') : '<span class="note">Nothing</span>'}</div></div>
        <div class="trade-col"><h4>Requested</h4><div class="mon-list">${(t.mons_requested||[]).length ? t.mons_requested.map(n=>`<span class="mon-pill">${SBL.pokemon.spriteMarkup(n)} ${SBL.pokemon.escapeHtml(n)}</span>`).join('') : '<span class="note">Nothing</span>'}</div></div>
      </div>
      ${canRespond ? `<div class="foot-actions">
          <button class="teal small" data-action="accept" data-id="${t.id}">Accept</button>
          <button class="danger small" data-action="reject" data-id="${t.id}">Reject</button>
        </div>` : ''}
      ${canWithdraw ? `<div class="foot-actions">
          <button class="ghost small" data-action="withdraw" data-id="${t.id}">Withdraw</button>
        </div>` : ''}
      <div class="note trade-err" id="tradeErr-${t.id}"></div>
    </div>`;
  }

  function bindTradeActions(){
    contentEl.querySelectorAll('button[data-action]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const id = Number(btn.dataset.id);
        const action = btn.dataset.action;
        const errEl = document.getElementById(`tradeErr-${id}`);
        if(errEl){ errEl.className='note'; errEl.textContent=''; }
        btn.disabled = true;
        try{
          if(action === 'accept'){
            await SBL.trades.accept(id, supabase);
          } else if(action === 'reject'){
            await SBL.trades.respond(id, 'rejected', session.user.id, supabase);
          } else if(action === 'withdraw'){
            await SBL.trades.respond(id, 'withdrawn', session.user.id, supabase);
          }
          await refreshAll();
          render();
        }catch(e){
          if(errEl){
            errEl.className = 'note danger';
            errEl.textContent = e.message;
          }
          btn.disabled = false;
        }
      });
    });
  }

  function renderTrades(){
    if(profile.status !== 'approved'){
      contentEl.innerHTML = `<div class="panel"><div class="empty-state">Your team claim needs to be approved by a commissioner before you can send or receive trades.</div></div>`;
      return;
    }

    const myTeam = profile.team_name;
    const pending = trades.filter(t =>
      t.status === 'pending' &&
      (t.proposer_team === myTeam || t.target_team === myTeam)
    );
    const completed = trades.filter(t =>
      t.status !== 'pending' &&
      (t.proposer_team === myTeam || t.target_team === myTeam)
    );
    const freeAgency = trades.filter(t =>
      t.target_team === null &&
      (t.proposer_team === myTeam || t.target_team === myTeam)
    );

    const selected = window.tradeViewFilter || 'pending';
    const list = selected === 'completed' ? completed : selected === 'freeagency' ? freeAgency : pending;

    const incoming = pending.filter(t => t.target_team === myTeam);
    const outgoing = pending.filter(t => t.proposer_team === myTeam);

    let body = '';

    if(selected === 'pending'){
      body = `
        <div class="panel">
          <h2>Incoming <span class="badge">${incoming.length}</span></h2>
          ${incoming.length ? incoming.map(t=>tradeCard(t,'incoming')).join('') : '<div class="empty-state">No incoming trade offers.</div>'}
        </div>
        <div class="panel">
          <h2>Sent by you <span class="badge">${outgoing.length}</span></h2>
          ${outgoing.length ? outgoing.map(t=>tradeCard(t,'outgoing')).join('') : '<div class="empty-state">You have no pending sent trades.</div>'}
        </div>`;
    } else if(selected === 'completed'){
      body = `
        <div class="panel">
          <h2>Completed Trades <span class="badge">${completed.length}</span></h2>
          <div class="note">Accepted, rejected, withdrawn, and reverted trades involving your team.</div>
          ${completed.length ? completed.map(t=>tradeCard(t,'history')).join('') : '<div class="empty-state">No completed trades yet.</div>'}
        </div>`;
    } else {
      body = `
        <div class="panel">
          <h2>Free Agency Trades <span class="badge">${freeAgency.length}</span></h2>
          <div class="note">All Free Agency requests involving your team, including pending and completed requests.</div>
          ${freeAgency.length ? freeAgency.map(t=>tradeCard(t, t.status === 'pending' && t.target_team === myTeam ? 'incoming' : t.status === 'pending' ? 'outgoing' : 'history')).join('') : '<div class="empty-state">No Free Agency trades yet.</div>'}
        </div>`;
    }

    contentEl.innerHTML = `
      <div class="panel" id="proposePanel"></div>
      <div class="panel">
        <div class="trade-tab-head"><div><h2>Your Trade Allowance</h2><div class="note">Your franchise has two separate trade pools. The numbers below are your actual current allowance for this season. Commissioner credits are shown separately.</div></div></div>
        <div class="trade-cols" style="margin-top:12px;">
          <div class="trade-col">
            <h4>Team-to-team trades</h4>
            <div class="budget-value">${tradeAllowance(myTeam,'team').remaining > 0 ? `${tradeAllowance(myTeam,'team').remaining} remaining` : `You don't have any team-to-team trades remaining`}</div>
            <div class="note">${tradeAllowance(myTeam,'team').used} used · ${tradeAllowance(myTeam,'team').limit} total allowance</div>
          </div>
          <div class="trade-col">
            <h4>Free Agency trades</h4>
            <div class="budget-value">${tradeAllowance(myTeam,'freeagency').remaining > 0 ? `${tradeAllowance(myTeam,'freeagency').remaining} remaining` : `You don't have any Free Agency trades remaining`}</div>
            <div class="note">${tradeAllowance(myTeam,'freeagency').used} used · ${tradeAllowance(myTeam,'freeagency').limit} total allowance</div>
          </div>
          ${profile?.trade_credits ? `<div class="trade-col">
            <h4>Commissioner credits</h4>
            <div class="budget-value">${Number(profile.trade_credits)||0}</div>
            <div class="note">Extra trades granted directly to your account</div>
          </div>` : ''}
        </div>
      </div>
      <div class="panel trade-filter-panel">
        <div class="trade-tab-head">
          <div>
            <h2 style="margin-bottom:4px;">Trades</h2>
            <div class="note">Keep pending, completed, and Free Agency trades separated so the page stays clean.</div>
          </div>
          <div>
            <label for="tradeViewSelect">View</label>
            <select id="tradeViewSelect" style="min-width:190px;">
              <option value="pending" ${selected==='pending'?'selected':''}>Pending</option>
              <option value="completed" ${selected==='completed'?'selected':''}>Completed</option>
              <option value="freeagency" ${selected==='freeagency'?'selected':''}>Free Agency</option>
            </select>
          </div>
        </div>
      </div>
      <div id="tradeViewBody">${body}</div>`;

    try{
      renderProposeTrade();
    }catch(e){
      const p = document.getElementById('proposePanel');
      if(p) p.innerHTML = `<h2>Propose a Trade</h2><div class="note danger">Couldn't load the trade builder: ${SBL.pokemon.escapeHtml(e.message||String(e))}</div>`;
    }

    document.getElementById('tradeViewSelect')?.addEventListener('change', e=>{
      window.tradeViewFilter = e.target.value;
      if(e.target.value === 'pending') markTradeTabSeen('pending');
      else if(e.target.value === 'completed') markTradeTabSeen('history');
      else markTradeTabSeen('all');
      renderTrades();
    });

    bindTradeActions();
  }

  function tradeSeenKey(){
    return `sbl_trade_seen_${session?.user?.id || 'anonymous'}`;
  }

  function getTradeSeen(){
    try{
      const raw = localStorage.getItem(tradeSeenKey());
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        pending: new Set(Array.isArray(parsed.pending) ? parsed.pending.map(Number) : []),
        history: new Set(Array.isArray(parsed.history) ? parsed.history.map(Number) : [])
      };
    }catch(e){
      return {pending:new Set(), history:new Set()};
    }
  }

  function saveTradeSeen(seen){
    try{
      localStorage.setItem(tradeSeenKey(), JSON.stringify({
        pending: Array.from(seen.pending),
        history: Array.from(seen.history)
      }));
    }catch(e){}
  }

  function markTradeTabSeen(tab){
    if(!profile?.team_name) return;
    const seen = getTradeSeen();
    const mine = profile.team_name;
    if(tab === 'pending' || tab === 'all'){
      trades.filter(t => t.target_team === mine && t.status === 'pending')
        .forEach(t => seen.pending.add(Number(t.id)));
    }
    if(tab === 'history' || tab === 'all'){
      trades.filter(t => t.status !== 'pending' && (t.proposer_team === mine || t.target_team === mine))
        .forEach(t => seen.history.add(Number(t.id)));
    }
    saveTradeSeen(seen);
  }

  function unreadTradeCounts(){
    const seen = getTradeSeen();
    const myTeam = profile?.team_name;
    if(!myTeam) return {incoming:0, history:0};
    return {
      incoming: trades.filter(t => t.target_team === myTeam && t.status === 'pending' && !seen.pending.has(Number(t.id))).length,
      history: trades.filter(t => t.status !== 'pending' && (t.proposer_team === myTeam || t.target_team === myTeam) && !seen.history.has(Number(t.id))).length
    };
  }

  const UPDATES_SEEN_KEY = 'sbl_myteam_updates_seen';
  function getUpdatesSeen(){
    try{
      const raw = JSON.parse(localStorage.getItem(UPDATES_SEEN_KEY) || '[]');
      return new Set(Array.isArray(raw) ? raw.map(String) : []);
    }catch(e){ return new Set(); }
  }
  function saveUpdatesSeen(seen){
    try{ localStorage.setItem(UPDATES_SEEN_KEY, JSON.stringify([...seen])); }catch(e){}
  }
  function leagueUpdates(){
    return (Array.isArray(DASH.settings?.leagueUpdates) ? DASH.settings.leagueUpdates : [])
      .slice().filter(u => u && u.id)
      .sort((a,b) => String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  }
  function unreadUpdateCount(){
    const seen = getUpdatesSeen();
    return leagueUpdates().filter(u => !seen.has(String(u.id))).length;
  }
  function markUpdatesSeen(){
    const seen = getUpdatesSeen();
    leagueUpdates().forEach(u => seen.add(String(u.id)));
    saveUpdatesSeen(seen);
  }
  function renderUpdates(){
    const updates = leagueUpdates();
    markUpdatesSeen();
    contentEl.innerHTML = `
      <section class="panel">
        <div class="myteam-section-head">
          <div><div class="myteam-kicker">League</div><h2>Updates</h2><div class="note">Announcements and important league changes published by the commissioner.</div></div>
        </div>
        <div class="league-updates-list">
          ${updates.length ? updates.map(u => {
            const category = String(u.category || 'League').toLowerCase().replace(/[^a-z]/g,'');
            const label = String(u.category || 'League');
            const author = u.publishedBy ? ` · ${SBL.pokemon.escapeHtml(u.publishedBy)}` : '';
            const date = u.createdAt ? new Date(u.createdAt).toLocaleString() : '';
            return `<article class="league-update-card"><div class="league-update-head"><div><div class="league-update-title">${SBL.pokemon.escapeHtml(u.title || '(untitled)')}</div><div class="league-update-meta">${SBL.pokemon.escapeHtml(date)}${author}</div></div><span class="league-update-badge ${SBL.pokemon.escapeHtml(category)}">${SBL.pokemon.escapeHtml(label)}</span></div><div class="league-update-body">${SBL.pokemon.escapeHtml(u.body || '')}</div></article>`;
          }).join('') : '<div class="empty-state">No league updates have been published yet.</div>'}
        </div>
      </section>`;
  }

  function renderTabs(){
    let nav = document.getElementById('tabs');
    if(!nav){
      nav = document.createElement('nav');
      nav.className = 'tabs';
      nav.id = 'tabs';
      contentEl.before(nav);
    }
    const unread = unreadTradeCounts();
    const totalUnread = unread.incoming + unread.history;
    const tabs = [
      ['myteam','Dashboard'],
      ['trades',`Trades${totalUnread ? ` <span class="tab-badge">${totalUnread}</span>` : ''}`],
      ['updates',`Updates${unreadUpdateCount() ? ` <span class="tab-badge">${unreadUpdateCount()}</span>` : ''}`],
      ['matches','Match History'],
      ['feedback','Bug Fixes / Suggestions'],
      ['account','Account']
    ];
    nav.innerHTML = tabs.map(([id,label])=>`<button data-tab="${id}" class="${activeTab===id?'active':''}">${label}</button>`).join('');
    nav.querySelectorAll('button').forEach(b=>{
      b.onclick = ()=>{
        activeTab = b.dataset.tab;
        if(activeTab === 'trades') markTradeTabSeen('all');
        renderTabs();
        render();
      };
    });
  }

  if(!window.__SBL_MYTEAM_ACCOUNT_NAV_BOUND){
    window.__SBL_MYTEAM_ACCOUNT_NAV_BOUND=true;
    const openAccountFromEvent = e=>{
      const btn=e.target?.closest?.('#tabs button[data-tab="account"]'); if(!btn) return;
      e.preventDefault(); e.stopImmediatePropagation();
      activeTab='account';
      try { renderTabs(); render(); }
      catch(err){
        console.error('Account tab failed to render:', err);
        if(contentEl) contentEl.innerHTML='<div class="panel"><h2>Account</h2><div class="note danger">The Account view could not render. Please refresh and try again.</div></div>';
      }
    };
    window.addEventListener('click', openAccountFromEvent, true);
    window.addEventListener('pointerup', openAccountFromEvent, true);
  }

  function renderAccount(){
    const status = String(profile?.status || 'unknown').toLowerCase();
    const statusLabel = status === 'approved' ? 'Approved' : status === 'pending' ? 'Pending approval' : status === 'rejected' ? 'Rejected' : status;
    const themes = Array.isArray(window.SBL_THEMES) ? window.SBL_THEMES : [];
    const savedTheme = window.SBLTheme?.getSavedId?.() || document.documentElement.dataset.sblTheme || 'amber';
    const currentTheme = themes.find(t => t.id === savedTheme) || themes[0];
    contentEl.innerHTML = `<div class="panel account-panel">
      <div class="myteam-section-head"><div><div class="myteam-kicker">Account</div><h2>Account</h2><div class="note">Your SBL account, franchise assignment, and site preferences.</div></div></div>
      <div class="profile-grid">
        <div><span>Username</span><strong>${SBL.pokemon.escapeHtml(profile?.username || '—')}</strong></div>
        <div><span>Franchise</span><strong>${SBL.pokemon.escapeHtml(profile?.team_name || '—')}</strong></div>
        <div><span>Status</span><strong>${SBL.pokemon.escapeHtml(statusLabel)}</strong></div>
        <div><span>Trade credits</span><strong>${Number(profile?.trade_credits || 0)}</strong></div>
      </div>
      <div class="section-divider"></div>
      <div class="account-preferences">
        <div class="account-preferences-head"><div><h3 class="mini-heading">Theme</h3><div class="note">Choose the site theme. It applies immediately and is saved for your browser.</div></div><span class="badge" id="accountThemeName">${SBL.pokemon.escapeHtml(currentTheme?.name || 'Theme')}</span></div>
        <div class="account-theme-grid" id="accountThemeGrid">
          ${themes.map(t => `<button type="button" class="account-theme-swatch${t.id===savedTheme?' active':''}" data-account-theme="${SBL.pokemon.escapeHtml(t.id)}" title="${SBL.pokemon.escapeHtml(t.name)}" aria-label="${SBL.pokemon.escapeHtml(t.name)}" aria-pressed="${t.id===savedTheme?'true':'false'}"><span class="theme-swatch-preview" style="background:${SBL.pokemon.escapeHtml(t.bg)};border-color:${SBL.pokemon.escapeHtml(t.border)}"><i style="background:${SBL.pokemon.escapeHtml(t.accent)}"></i><b style="background:${SBL.pokemon.escapeHtml(t.panel)}"></b></span><span>${SBL.pokemon.escapeHtml(t.name)}</span></button>`).join('')}
        </div>
      </div>
      <div class="section-divider"></div>
      <div class="row" style="justify-content:flex-end;"><button type="button" class="ghost" id="accountLogoutBtn">Log out</button></div>
    </div>`;
    document.getElementById('accountThemeGrid')?.addEventListener('click', e=>{
      const btn=e.target.closest('[data-account-theme]'); if(!btn || !window.SBLTheme?.apply) return;
      const id=btn.dataset.accountTheme; const theme=window.SBLTheme.apply(id,true);
      document.querySelectorAll('#accountThemeGrid [data-account-theme]').forEach(x=>{const active=x.dataset.accountTheme===id;x.classList.toggle('active',active);x.setAttribute('aria-pressed',active?'true':'false');});
      const label=document.getElementById('accountThemeName'); if(label) label.textContent=theme?.name||id;
    });
    document.getElementById('accountLogoutBtn')?.addEventListener('click', async ()=>{try{await SBL.auth.signOut();}catch(e){console.error('Logout failed:',e);}session=null;profile=null;activeTab='myteam';render();});
  }

  function renderMatches(){
    if(profile.status!=='approved'){contentEl.innerHTML='<div class="panel"><div class="empty-state">Your team claim needs to be approved before viewing match history.</div></div>';return;}
    const rows=myTeamMatchData();
    contentEl.innerHTML=`<div class="panel"><div class="myteam-section-head"><div><h2>Match History</h2><div class="note">Every processed replay involving ${SBL.pokemon.escapeHtml(profile.team_name)}.</div></div></div><div class="recent-battles-list">${rows.length?rows.map(recentBattleRowHtml).join(''):'<div class="empty-state">No match history yet.</div>'}</div></div>`;
  }

  function render(){
    if(!session){ document.getElementById('tabs')?.remove(); renderAuthGate(); return; }
    if(!profile){ document.getElementById('tabs')?.remove(); contentEl.innerHTML = '<div class="empty-state">Loading…</div>'; return; }

    if(!profile.username || !profile.team_name){ document.getElementById('tabs')?.remove(); renderTeamClaim(); return; }
    if(profile.status === 'pending' || profile.status === 'rejected'){
      renderTabs();
      if(activeTab === 'account') return renderAccount();
      return renderPendingOrRejected();
    }

    renderTabs();
    if(activeTab === 'myteam') return renderMyTeam();
    if(activeTab === 'updates') return renderUpdates();
    if(activeTab === 'matches') return renderMatches();
    if(activeTab === 'trades') return renderTrades();
    if(activeTab === 'feedback') return renderFeedback();
    if(activeTab === 'account') return renderAccount();
  }

  async function boot(){
    contentEl.innerHTML = '<div class="empty-state">Loading…</div>';
    try{
      await refreshAll();
      render();
    }catch(e){
      contentEl.innerHTML = `<div class="panel"><div class="note danger">Could not load your dashboard: ${SBL.pokemon.escapeHtml(e.message)}</div></div>`;
    }
  }

  contentEl.addEventListener('click',e=>{
    const matchBtn=e.target.closest('[data-myteam-match]');
    if(matchBtn){e.preventDefault();openMyTeamReplaySummary(matchBtn.dataset.myteamMatch);return;}
    const recordBtn=e.target.closest('[data-record-adjust]');
    if(recordBtn){e.preventDefault();openRecordGamesPopup(recordBtn.dataset.recordAdjust);return;}
  });
  function openRecordGamesPopup(kind){
    const matches=myTeamMatchData().filter(x=>x.result===(kind==='win'?'W':'L'));
    let overlay=document.getElementById('myteamRecordOverlay'); if(overlay) overlay.remove();
    overlay=document.createElement('div'); overlay.className='myteam-replay-overlay'; overlay.id='myteamRecordOverlay';
    overlay.innerHTML=`<div class="myteam-replay-box" style="max-width:760px"><div class="myteam-summary-header"><div><div class="myteam-summary-kicker">${kind==='win'?'Wins':'Losses'}</div><h3>${kind==='win'?'Games you won':'Games you lost'}</h3><div class="myteam-summary-result">${matches.length} ${kind==='win'?'win':'loss'}${matches.length===1?'':'s'}</div></div><div class="myteam-summary-meta"><span>${SBL.pokemon.escapeHtml(profile.team_name)}</span></div></div><div class="recent-battles-list">${matches.length?matches.map(recentBattleRowHtml).join(''):'<div class="empty-state">No recorded games in this category.</div>'}</div><div class="myteam-summary-actions"><button class="ghost" type="button" id="recordGamesClose">Close</button></div></div>`;
    document.body.appendChild(overlay);document.body.style.overflow='hidden';
    const close=()=>{overlay.remove();document.body.style.overflow='';};
    document.getElementById('recordGamesClose').onclick=close;overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
  }

  (async function init(){
    const {data} = await supabase.auth.getSession();
    session = data.session;
    if(session){ await boot(); }
    else{ renderAuthGate(); }

    supabase.auth.onAuthStateChange((event, newSession)=>{
      if(event === 'SIGNED_OUT'){ session=null; profile=null; trades=[]; render(); }
    });
  })();
})();
