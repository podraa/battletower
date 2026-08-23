/* SBL Stats UI — Phase 3: Pokémon profile renderer (luck-rank-kills-per-game-ui-v2) */
(function(){
  'use strict';
  window.SBLStatsUI = window.SBLStatsUI || {};
  window.SBLStatsUI.renderPokemonProfile = function(species, weekFilter, d){
    const {pokemonProfileData,escapeHtml,pokemonLink,spriteImg,displayCause,replayContext,luckPokemonRank}=d;

    const s = pokemonProfileData(species, weekFilter);
    if(!s || !Number(s.games)) return `<div class="empty-state">No data for ${escapeHtml(species)} in this scope.</div>`;

    // The stats service is the source of truth, but old replay records can still
    // contain incomplete event objects. Normalize both the aggregate and every
    // event before any HTML is generated. This is deliberately defensive: one
    // malformed event must never make the entire Pokémon profile fail.
    const safeSet = value => value instanceof Set ? value : new Set(Array.isArray(value) ? value : []);
    const safeMap = value => value instanceof Map ? value : new Map();
    s.coaches = safeSet(s.coaches);
    s.weeksBrought = safeMap(s.weeksBrought);
    s.killLog = Array.isArray(s.killLog) ? s.killLog : [];
    s.assistLog = Array.isArray(s.assistLog) ? s.assistLog : [];
    s.deathLog = Array.isArray(s.deathLog) ? s.deathLog : [];
    s.kills = Number(s.kills)||0; s.assists = Number(s.assists)||0; s.deaths = Number(s.deaths)||0;
    s.dealt = Number(s.dealt)||0; s.taken = Number(s.taken)||0;
    s.directDamage = Number(s.directDamage)||0; s.indirectDamage = Number(s.indirectDamage)||0;
    s.switches = Number(s.switches)||0; s.leads = Number(s.leads)||0;

    const replayViewUrl = (replayId, turn) => {
      const id = String(replayId || '').trim();
      if (!id) return '';
      const n = Number(turn);
      return `https://replay.pokemonshowdown.com/${encodeURIComponent(id)}${Number.isFinite(n) && n >= 0 ? `?turn=${encodeURIComponent(n)}` : ''}`;
    };

    const normalizeProfileLog = (entry, fallbackType) => {
      const x = (entry && typeof entry === 'object') ? entry : {};
      return {
        replayId: String(x.replayId || x.replay || x.id || ''),
        replayDate: Number(x.replayDate || 0) || 0,
        turn: Number(x.turn || x.turnNumber || 0) || 0,
        victim: x.victim == null ? '' : String(x.victim),
        killer: x.killer == null ? '' : String(x.killer),
        cause: x.cause == null ? '' : String(x.cause),
        damage: (() => {
          const values=[x.damage,x.damageAtRemoval,x.damageContribution,x.damageDealt,x.dealt,x.amount];
          const firstPositive=values.find(v=>Number.isFinite(Number(v)) && Number(v)>0);
          const firstNumeric=values.find(v=>Number.isFinite(Number(v)));
          return Number(firstPositive ?? firstNumeric ?? 0) || 0;
        })(),
        percent: (() => {
          const values=[x.percent,x.share,x.damagePercent,x.damageShare,x.percentDamage,x.contributionPercent];
          const firstPositive=values.find(v=>Number.isFinite(Number(v)) && Number(v)>0);
          const firstNumeric=values.find(v=>Number.isFinite(Number(v)));
          return Number(firstPositive ?? firstNumeric ?? 0) || 0;
        })(),
        type: x.type || fallbackType
      };
    };
    const safeReplayContext = replayId => {
      try { return replayContext(replayId || ''); } catch(e) { return {week:'—', matchup:'—'}; }
    };
    const safeCause = cause => {
      try { return displayCause(cause); } catch(e) { return cause ? String(cause) : '—'; }
    };
    // Victim/killer cells intentionally show only the Pokémon name.
    // Do not render type badges here; those make the event tables unnecessarily busy.
    const safeEventPokemon = (name, fallback='?') => {
      if(!name) return fallback;
      const label = escapeHtml(String(name));
      try {
        return `<span class="pokemon-click profile-event-pokemon" role="button" tabindex="0" data-pokemon="${label}" title="Open ${label} profile">${label}</span>`;
      } catch(e) { return label; }
    };
    const kd = s.deaths ? (s.kills/s.deaths).toFixed(2) : (s.kills ? '∞' : '0');
    const avg = s.games ? (s.dealt/s.games).toFixed(1) : '0';
    const luckScope = weekFilter || 'ALL';
    const luckRank = typeof luckPokemonRank === 'function' ? luckPokemonRank(s.species, luckScope) : null;
    const luckRankLabel = luckRank ? `#${luckRank.rank}` : '—';
    const killRows = (Array.isArray(s.killLog) ? s.killLog : []).map(x=>normalizeProfileLog(x,'kill')).sort((a,b)=>(a.replayDate-b.replayDate)||(a.turn-b.turn));
    const assistRows = (Array.isArray(s.assistLog) ? s.assistLog : []).map(x=>normalizeProfileLog(x,'assist')).sort((a,b)=>(a.replayDate-b.replayDate)||(a.turn-b.turn));
    const deathRows = (Array.isArray(s.deathLog) ? s.deathLog : []).map(x=>normalizeProfileLog(x,'death')).sort((a,b)=>(a.replayDate-b.replayDate)||(a.turn-b.turn));
    const killPanel = killRows.length ? `<table><thead><tr><th>Week</th><th>Matchup</th><th>Turn</th><th>Victim</th><th>Cause</th><th>Replay</th></tr></thead><tbody>${killRows.map(x=>`<tr><td>${escapeHtml(safeReplayContext(x.replayId).week)}</td><td>${escapeHtml(safeReplayContext(x.replayId).matchup)}</td><td>${x.turn}</td><td>${x.victim ? safeEventPokemon(x.victim) : '?'}</td><td>${escapeHtml(safeCause(x.cause))}</td><td>${x.replayId ? `<a class="nav-link" href="${escapeHtml(replayViewUrl(x.replayId, x.turn))}" target="_blank" rel="noopener">View</a>` : '<span class="note">Unavailable</span>'}</td></tr>`).join('')}</tbody></table>` : `<div class="empty-state">No knockouts.</div>`;
    const assistPanel = assistRows.length ? `<table><thead><tr><th>Week</th><th>Matchup</th><th>Turn</th><th>Victim</th><th>Damage</th><th>Share</th><th>Reason</th><th>Killer</th><th>Replay</th></tr></thead><tbody>${assistRows.map(x=>`<tr><td>${escapeHtml(safeReplayContext(x.replayId).week)}</td><td>${escapeHtml(safeReplayContext(x.replayId).matchup)}</td><td>${x.turn}</td><td>${x.victim ? safeEventPokemon(x.victim) : '?'}</td><td class="num dealt">${Number(x.damage||0).toFixed(1)}</td><td class="num">${Number(x.percent||0).toFixed(1)}%</td><td>${escapeHtml(safeCause(x.cause||'damage'))}</td><td>${x.killer ? safeEventPokemon(x.killer) : '?'}</td><td>${x.replayId ? `<a class="nav-link" href="${escapeHtml(replayViewUrl(x.replayId, x.turn))}" target="_blank" rel="noopener">View</a>` : '<span class="note">Unavailable</span>'}</td></tr>`).join('')}</tbody></table>` : `<div class="empty-state">No assists.</div>`;
    const deathPanel = deathRows.length ? `<table><thead><tr><th>Week</th><th>Matchup</th><th>Turn</th><th>Killer</th><th>Replay</th></tr></thead><tbody>${deathRows.map(x=>`<tr><td>${escapeHtml(safeReplayContext(x.replayId).week)}</td><td>${escapeHtml(safeReplayContext(x.replayId).matchup)}</td><td>${x.turn}</td><td>${x.killer ? safeEventPokemon(x.killer,'Unattributed') : 'Unattributed'}</td><td>${x.replayId ? `<a class="nav-link" href="${escapeHtml(replayViewUrl(x.replayId, x.turn))}" target="_blank" rel="noopener">View</a>` : '<span class="note">Unavailable</span>'}</td></tr>`).join('')}</tbody></table>` : `<div class="empty-state">No deaths.</div>`;
    return `<div class="panel pokemon-profile">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        ${spriteImg(s.species,'sprite-xl')}
        <div><h2 style="margin:0;color:var(--text);text-transform:none;letter-spacing:0;font-size:20px;">${pokemonLink(s.species, escapeHtml(s.species))}</h2>
        <div class="note" style="margin-top:3px;">${escapeHtml(Array.from(s.coaches).sort().join(', '))}</div></div>
      </div>
      <div class="profile-section-tabs" role="tablist" aria-label="Pokémon profile sections">
        <button type="button" class="profile-section-tab active" data-profile-tab="overview">Overview</button>
        <button type="button" class="profile-section-tab" data-profile-tab="damage">Damage</button>
        <button type="button" class="profile-section-tab" data-profile-tab="usage">Usage</button>
        <button type="button" class="profile-section-tab" data-profile-tab="kills">Knockouts (${s.kills})</button>
        <button type="button" class="profile-section-tab" data-profile-tab="assists">Assists (${s.assists||0})</button>
        <button type="button" class="profile-section-tab" data-profile-tab="deaths">Deaths (${s.deaths})</button>
      </div>

      <section class="profile-section-panel" data-profile-section="overview">
        <h3 class="mini-heading">Battle overview</h3>
        <div class="profile-summary-grid">
          <div><span>Games</span><strong>${s.games}</strong></div>
          <div><span>Knockouts</span><strong class="kills">${s.kills}</strong></div>
          <div><span>Assists</span><strong>${s.assists||0}</strong></div>
          <div><span>Deaths</span><strong class="taken">${s.deaths}</strong></div>
          <div><span>K/D</span><strong>${kd}</strong></div>
          <div><span>Avg dmg/game</span><strong>${avg}</strong></div>
          <div><span>Knockouts / Game</span><strong>${s.games?(s.kills/s.games).toFixed(2):'0.00'}</strong></div>
          ${luckRank ? `<div><span>Luck Rank</span><strong>${luckRankLabel}</strong><div class="note">${luckRank.score>=0?'+':''}${luckRank.score.toFixed(2)} luck</div></div>` : ''}
        </div>
      </section>

      <section class="profile-section-panel" data-profile-section="damage" hidden>
        <h3 class="mini-heading">Damage</h3>
        <div class="profile-summary-grid">
          <div><span>Damage dealt</span><strong class="dealt">${s.dealt.toFixed(1)}</strong></div>
          <div><span>Damage taken</span><strong class="taken">${s.taken.toFixed(1)}</strong></div>
          <div><span>Direct damage</span><strong>${Number(s.directDamage||0).toFixed(1)}</strong></div>
          <div><span>Indirect damage</span><strong>${Number(s.indirectDamage||0).toFixed(1)}</strong></div>
        </div>
      </section>

      <section class="profile-section-panel" data-profile-section="usage" hidden>
        <h3 class="mini-heading">Usage</h3>
        <div class="profile-summary-grid">
          <div><span>Switches</span><strong>${Number(s.switches||0)}</strong></div>
          <div><span>Leads</span><strong>${Number(s.leads||0)}</strong></div>
        </div>
        <div class="profile-weeks" style="margin-top:14px;padding:12px 14px;background:var(--panel2);border:1px solid var(--border);border-radius:8px;">
          <div class="mini-heading" style="margin-bottom:8px;">Weeks Brought</div>
          <div style="display:flex;flex-wrap:wrap;gap:7px;">${Array.from(s.weeksBrought.keys()).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(w=>`<span class="badge">${escapeHtml(w)}</span>`).join('') || '<span class="note">No roster data recorded.</span>'}</div>
        </div>
      </section>

      <section class="profile-section-panel" data-profile-section="kills" hidden><h3 class="mini-heading">Knockout record</h3>${killPanel}</section>
      <section class="profile-section-panel" data-profile-section="assists" hidden><h3 class="mini-heading">Assist record</h3>${assistPanel}</section>
      <section class="profile-section-panel" data-profile-section="deaths" hidden><h3 class="mini-heading">Death record</h3>${deathPanel}</section>
    </div>`;
  };

  window.SBLStatsUI.bindPokemonProfileTabs = function(root){

    const tabs=[...root.querySelectorAll('[data-profile-tab]')];
    const panels=[...root.querySelectorAll('[data-profile-section]')];
    tabs.forEach(tab=>tab.addEventListener('click',()=>{
      const name=tab.dataset.profileTab;
      tabs.forEach(t=>t.classList.toggle('active',t===tab));
      panels.forEach(panel=>panel.hidden=panel.dataset.profileSection!==name);
    }));
  };
})();
