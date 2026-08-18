/*
 * SBL REPLAY SERVICE
 *
 * Phase 4E: read-only abstraction over the existing replays table.
 *
 * The database schema is intentionally unchanged. The table currently stores
 * both normal replay rows and several special records. This service keeps that
 * knowledge in one place so pages do not each implement their own filtering.
 */
(function () {
  'use strict';

  window.SBL = window.SBL || {};
  const SBL = window.SBL;

  const SPECIAL_IDS = new Set([
    '__dashboard_state__',
    '__rosters__',
    '__free_agency__'
  ]);

  const STATE_ID = '__dashboard_state__';
  const ROSTERS_ID = '__rosters__';
  const FREE_AGENCY_ID = '__free_agency__';

  async function load(client) {
    const db = client || (SBL.getSupabase ? SBL.getSupabase() : null);
    if (!db) throw new Error('Supabase client is not available.');

    const { data, error } = await db
      .from('replays')
      .select('replay_id,replay_data');

    if (error) throw error;
    return { data: data || [], error: null };
  }

  function partition(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let sharedState = null;
    let publishedRosters = {};
    let publishedFreeAgency = null;
    const replays = {};

    for (const row of list) {
      if (!row || !row.replay_id) continue;

      if (row.replay_id === STATE_ID) {
        sharedState = row.replay_data || {};
        continue;
      }

      if (row.replay_id === ROSTERS_ID) {
        publishedRosters = row.replay_data?.rosters || {};
        continue;
      }

      if (row.replay_id === FREE_AGENCY_ID) {
        publishedFreeAgency = row.replay_data || null;
        continue;
      }

      if (!SPECIAL_IDS.has(row.replay_id)) {
        replays[row.replay_id] = row.replay_data || {};
      }
    }

    // Older dashboard snapshots could contain replay rows inside the shared
    // state blob. Preserve that compatibility behavior here rather than on
    // every page.
    if (sharedState?.replays && typeof sharedState.replays === 'object') {
      for (const [id, replay] of Object.entries(sharedState.replays)) {
        if (id && replay && typeof replay === 'object') {
          replays[id] = replay;
        }
      }
    }

    return {
      sharedState,
      replays,
      publishedRosters,
      publishedFreeAgency
    };
  }

  function isReplayId(id) {
    return !!id && !SPECIAL_IDS.has(id);
  }

  function getSpecialIds() {
    return {
      state: STATE_ID,
      rosters: ROSTERS_ID,
      freeAgency: FREE_AGENCY_ID
    };
  }

  SBL.replays = {
    STATE_ID,
    ROSTERS_ID,
    FREE_AGENCY_ID,
    load,
    partition,
    isReplayId,
    getSpecialIds
  };
})();


/* SBL Replay Service — Phase 5B
 *
 * Canonical Showdown replay parser extracted from the legacy page implementations.
 * This is the single parser entry point for replay imports and regression tests.
 */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  const SBL=window.SBL;
  function normName(n){ return String(n??'').trim().toLowerCase().replace(/-/g,' ').replace(/_/g,' ').replace(/\s+/g,' '); }
  function parseHP(token){
    if(!token) return 0;
    // Replay HTML stores the battle-log payload with escaped slashes (e.g.
    // `85\/100`). When that payload is read back as text, the backslash is
    // still present. Normalize it before parsing so `current/max` tokens are
    // treated as fractions rather than falling through to Number("85\\")
    // and becoming NaN/0. This is especially important for damage ledgers: a
    // zero HP baseline silently turns every later damage contribution into 0.
    token = String(token).replace(/\\\//g,'/').split(' ')[0];
    if(token.includes('/')){
      const a = Number(token.split('/')[0]);
      return Number.isFinite(a) ? Math.max(0,a) : 0;
    }
    const v = parseFloat(token);
    return Number.isFinite(v) ? Math.max(0,v) : 0;
  }
  // Showdown replay HP tokens are usually "current/max". parseHP() intentionally
  // converts that to a percentage for battle-state math, so assists need a separate
  // helper to retain the actual max-HP denominator.
  function parseMaxHP(token){
    if(!token) return null;
    // Keep this normalization in sync with parseHP(): replay HTML can expose
    // escaped current/max tokens such as `85\/100`.
    token = String(token).replace(/\\\//g,'/').split(' ')[0];
    if(!token.includes('/')) return null;
    const parts = token.split('/');
    const max = Number(parts[1]);
    return Number.isFinite(max) && max > 0 ? max : null;
  }
  function sideOf(slot){ return slot.slice(0,2); } // 'p1' / 'p2'

  // ---------- Showdown move data for luck calculations ----------
  // Accuracy comes from the same move data used by Pokemon Showdown, rather
  // than a manually maintained list. The replay itself tells us which move
  // was used; this lookup tells us that move's base accuracy.
  const MOVE_DATA_URL = 'https://play.pokemonshowdown.com/data/moves.json';
  let MOVE_DATA = null;
  let MOVE_ACCURACY_PROMISE = null;
  function moveKey(name){ return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  async function ensureMoveAccuracyData(){
    if(MOVE_DATA) return MOVE_DATA;
    if(MOVE_ACCURACY_PROMISE) return MOVE_ACCURACY_PROMISE;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    MOVE_ACCURACY_PROMISE = fetch(MOVE_DATA_URL, {cache:'force-cache', signal:controller.signal})
      .then(r=>{ if(!r.ok) throw new Error('could not load Showdown move data (' + r.status + ')'); return r.json(); })
      .then(data=>{
        const out = {};
        for(const [id, move] of Object.entries(data || {})){
          if(!move) continue;
          const acc = move.accuracy;
          const value = (typeof acc === 'number') ? acc : null;
          const statusChances = {};
          if(move.status) statusChances[move.status] = 100;
          const secondaries = Array.isArray(move.secondaries) ? move.secondaries : (move.secondary && move.secondary !== false ? [move.secondary] : []);
          const secondaryEffects = [];
          for(const sec of secondaries){
            if(!sec) continue;
            const chance = typeof sec.chance === 'number' ? sec.chance : 100;
            const effect = {chance};
            if(sec.status) { effect.kind='status'; effect.value=String(sec.status); statusChances[sec.status] = Math.max(statusChances[sec.status] || 0, chance); }
            else if(sec.volatileStatus) { effect.kind='volatileStatus'; effect.value=String(sec.volatileStatus); }
            else if(sec.boosts) { effect.kind='boost'; effect.value=JSON.stringify(sec.boosts); }
            else if(sec.flinch) { effect.kind='flinch'; effect.value='flinch'; }
            else if(sec.volatileStatus === 'confusion') { effect.kind='volatileStatus'; effect.value='confusion'; }
            else continue;
            secondaryEffects.push(effect);
          }
          // willCrit (e.g. Frost Breath, Storm Throw, Zippy Zap, Wicked Blow, Surging
          // Strikes) marks a move as an automatic, deterministic critical hit. Showdown
          // encodes this separately from critRatio, not as critRatio:4, so both must be
          // captured or guaranteed crits get scored as lucky.
          const entry = {accuracy:value, statusChances, secondaryEffects, critRatio:(typeof move.critRatio === 'number' ? move.critRatio : 1), willCrit:!!move.willCrit};
          out[moveKey(id)] = entry;
          if(move.name) out[moveKey(move.name)] = entry;
        }
        MOVE_DATA = out;
        return out;
      })
      .catch(err=>{
        console.warn('Move accuracy data unavailable; accuracy-sensitive luck events will be skipped.', err);
        MOVE_DATA = {};
        return MOVE_DATA;
      })
      .finally(()=>clearTimeout(timeout));
    return MOVE_ACCURACY_PROMISE;
  }
  function getMoveAccuracy(name){
    if(!MOVE_DATA) return null;
    const entry = MOVE_DATA && MOVE_DATA[moveKey(name)];
    return entry && typeof entry.accuracy === 'number' ? entry.accuracy : null;
  }
  function getMoveStatusChance(name, status){
    const entry = MOVE_DATA && MOVE_DATA[moveKey(name)];
    if(!entry || !entry.statusChances) return null;
    const value = entry.statusChances[status];
    return typeof value === 'number' ? value : null;
  }
  function getMoveSecondaryChance(name, kind, value){
    const entry = MOVE_DATA && MOVE_DATA[moveKey(name)];
    if(!entry || !Array.isArray(entry.secondaryEffects)) return null;
    const matches = entry.secondaryEffects.filter(e => e && e.kind === kind && (value == null || e.value === value));
    if(!matches.length) return null;
    const chance = Math.max(...matches.map(e => Number(e.chance)));
    return Number.isFinite(chance) ? chance : null;
  }
  function isLowAccuracyMove(name){
    const acc = getMoveAccuracy(name);
    return acc !== null && acc <= 85;
  }
  // Luck is weighted by how unlikely the observed event was.
  function rarityLuck(probability){
    if(typeof probability !== 'number' || probability <= 0 || probability > 1) return 0;
    return (1 / probability) - 1;
  }
  function statusDodgeLuck(chance){
    // The event is failure of the status roll. 100% status has no separate roll.
    if(typeof chance !== 'number' || chance <= 0 || chance >= 100) return 0;
    return rarityLuck(1 - (chance / 100));
  }
  function moveDodgeLuck(accuracy){
    if(typeof accuracy !== 'number' || accuracy < 0 || accuracy >= 100) return 0;
    return rarityLuck(1 - (accuracy / 100));
  }
  function lowAccuracyHitLuck(accuracy){
    if(typeof accuracy !== 'number' || accuracy <= 0 || accuracy > 100) return 0;
    return rarityLuck(accuracy / 100);
  }
  function critChance(name){
    const entry = MOVE_DATA && MOVE_DATA[moveKey(name)];
    const ratio = entry && typeof entry.critRatio === 'number' ? entry.critRatio : 1;
    // Moves with a guaranteed critical hit are excluded from luck scoring.
    // Their crit is deterministic, so it should not count as a lucky crit.
    // Guaranteed crits are flagged via willCrit (Frost Breath, Storm Throw,
    // Zippy Zap, Wicked Blow, Surging Strikes), not via critRatio.
    if((entry && entry.willCrit) || ratio >= 4) return null;
    if(ratio >= 3) return 0.5;
    if(ratio >= 2) return 0.125;
    return 1 / 24;
  }
  function critLuck(name){
    const chance = critChance(name);
    return chance === null ? 0 : rarityLuck(chance);
  }
  function paralysisDodgeLuck(){ return rarityLuck(0.75); }
  function durationLuck(turns){
    if(!Number.isFinite(turns) || turns <= 0) return 0;
    return 2 - turns;
  }
  function newLuckSide(){ return {
    crits:0,critLuck:0,dodges:0,moveDodgeLuck:0,lowAccuracyHits:0,lowAccuracyHitLuck:0,lowAccuracyDodges:0,
    statusDodgeLuck:0,secondaryProcs:0,secondaryLuck:0,secondaryDodges:0,secondaryDodgeLuck:0,
    flinches:0,flinchLuck:0,confusionSelfHits:0,confusionLuck:0,protectSuccesses:0,protectLuck:0,
    fullParalysis:0,paralysisDodgeLuck:0,paralysisDodges:0,sleepTurns:0,sleepEvents:0,sleepDurationLuck:0,
    freezeTurns:0,freezeEvents:0,freezeDurationLuck:0,luckEvents:[]
  }; }
  // ---------- replay parsing ----------

  function canonicalBattleSpecies(name){
    const raw = String(name || '').trim();
    if(!raw) return raw;
    if(window.SBL?.pokemon?.displayName) return SBL.pokemon.displayName(raw);
    const id = raw.toLowerCase().replace(/[’']/g,'').replace(/_/g,'-').replace(/\s+/g,'-').replace(/-+/g,'-');
    const map = {
      'mimikyu-busted':'Mimikyu','aegislash-blade':'Aegislash','aegislash-shield':'Aegislash',
      'terapagos-terastal':'Terapagos','terapagos-stellar':'Terapagos','terapagos-terastal-form':'Terapagos',
      'palafin-hero':'Palafin','zacian-crowned':'Zacian','zamazenta-crowned':'Zamazenta',
      'eiscue-noice':'Eiscue','morpeko-hangry':'Morpeko','wishiwashi-school':'Wishiwashi',
      'cramorant-gulping':'Cramorant','cramorant-gorging':'Cramorant','darmanitan-zen':'Darmanitan',
      'darmanitan-zen-galar':'Darmanitan-Galar','meloetta-pirouette':'Meloetta','minior-meteor':'Minior',
      'zygarde-10-percent':'Zygarde','zygarde-50-percent':'Zygarde','necrozma-dusk-mane':'Necrozma',
      'necrozma-dawn-wings':'Necrozma','necrozma-ultra':'Necrozma','giratina-origin':'Giratina',
      'shaymin-sky':'Shaymin','hoopa-unbound':'Hoopa','kyurem-black':'Kyurem','kyurem-white':'Kyurem',
      'keldeo-resolute':'Keldeo'
    };
    return map[id] || raw;
  }

  function parseLog(json, replayId){
    const lines = json.log.split('\n');
    const players = {p1:'', p2:''};
    const slots = {}; // slotId -> {species, hp, side, monId}
    let nextMonInstance = 0;
    // Reuse a battle identity by side + nickname, never by displayed species.
    // The nickname belongs to the physical Pokémon even while Zoroark is under
    // Illusion, so this lets switches preserve persistent state without merging
    // a disguised Zoroark into an already-seen Pokémon of the displayed species.
    const persistentMonIds = {}; // side|nickname -> stable physical battle identity
    const mons = {}; // unique battle-stint id -> stats
    const appearedThisReplay = new Set();
    const teamRoster = {p1:[], p2:[]};
    let lastMove = null; // {source, target, move}
    let currentTurn = 0;
    let winner = null;
    const luck = {p1:newLuckSide(), p2:newLuckSide()};
    const luckPokemon = {};
    function pokemonLuckForSlot(slot){
      const mk = monKey(slot);
      if(!mk) return null;
      if(!luckPokemon[mk]) luckPokemon[mk] = Object.assign({species:(slots[slot] && slots[slot].species) || ''}, newLuckSide());
      return luckPokemon[mk];
    }
    function addLuckEvent(target, type, score, detail){
      if(!target || !Array.isArray(target.luckEvents)) return;
      target.luckEvents.push({turn:currentTurn, type, score:Number(score||0), detail:String(detail||'')});
    }
    const sleeping = {};
    const frozen = {};
    const pendingStatusChecks = {};
    const protectStreak = {};
    const pendingSecondaryChecks = {};
    const pendingConfusionSource = {};
    const currentMajorStatus = {};
    const turnActivity = {}; // slot -> move/switch/cant for the current turn
    // NOTE: these three all store direct references to a mon's *stats object*
    // (captured at the moment of the event via ensureMon), never a slot label.
    // A slot label like "p1a" gets reused by a different mon later in the game,
    // so resolving it lazily at credit-time would silently attribute damage/
    // kills to whoever happens to be standing there now instead of whoever
    // actually did it.
    let lastAttacker = {}; // targetSlot -> attacker's stats object (for kill credit)
    // Cumulative damage contributions against each individual victim during this replay.
    // Used to award assists when a non-killer dealt at least 50% of the victim's max HP.
    let damageContributors = {}; // victim monKey -> {attacker monKey -> {stats, damage, direct, indirect}}
    let itemAssistContributors = {}; // victim monKey -> {canonical contributor key -> {side,species,stats,turn}}
    let healingWishSourceByMon = {}; // recipient monKey -> healer stats
    let revivalSourceByMon = {}; // recipient monKey -> reviver stats (failsafe)
    const sideHasMadeSwitch = {p1:false,p2:false};
    const sideLeadCount = {p1:0,p2:0};
    // Poison/burn (unlike confusion) persist through a switch — the same individual
    // keeps ticking for the same status after it returns to the field. So this is
    // keyed by the *individual mon* (monKey: side+species), not by slot, and is
    // deliberately NOT cleared on switch — only when the status actually ends.
    let statusSourceByMon = {}; // monKey -> stats object that inflicted brn/psn/tox on them
    let hazardSetter = {}; // side -> {hazardName: setter's stats object}
    // side (the side that GOT toxic-spiked) -> setter's stats object.
    // Toxic Spikes are a side-wide condition, so this survives switches/faints
    // and lets residual poison damage inherit kill credit from the setter.
    let toxicSpikesSetter = {};
    let delayedSetter = {}; // side -> {moveName: setter's stats object}, for Future Sight / Doom Desire
    let pendingDelayedHit = {}; // targetSlot -> {stats, cause}; Showdown emits the delayed hit as -end, then an untagged -damage
    let residualSourceByMon = {}; // monKey -> source stats for lingering move damage (Curse, Salt Cure, trapping, etc.)
    let weatherSetter = {}; // weather name -> setter's stats object for weather chip kill credit

    const HAZARD_MOVES = ['Stealth Rock','Spikes'];
    const DELAYED_MOVES = ['Future Sight','Doom Desire'];
    const STATUS_TAGS = ['psn','tox','brn'];
    const RESIDUAL_MOVES = [
      'Curse','Salt Cure','Bind','Clamp','Fire Spin','Magma Storm','Sand Tomb',
      'Whirlpool','Wrap','Infestation','Snap Trap','Thunder Cage','Jaw Lock',
      'Whirlpool','Nightmare'
    ];
    const WEATHER_NAMES = ['Sandstorm','Hail','Snow'];


    function classifyDamageCause(cause, tags, move){
      const c = String(cause || '').trim().toLowerCase();
      const t = String(tags || '').toLowerCase();
      // Showdown's explicit move source is authoritative: this is direct damage.
      if(c.startsWith('move:')) return 'direct';
      if(/\[from\]\s*move:/i.test(t)) return 'direct';
      // Self-inflicted/recoil/environmental damage is never credited to an opposing mon.
      if(/confusion|recoil|life orb|substitute|belly drum|curse.*self|struggle recoil/i.test(t)) return 'self';
      if(c.includes('stealth rock') || c.includes('spikes') || c.includes('toxic spikes') || c.includes('sticky web') ||
         c.includes('sandstorm') || c.includes('hail') || c.includes('snow') || c.includes('leech seed') ||
         c.includes('residual') || c.includes('item') || c.includes('ability') || c.includes('status:') ||
         /\[from\]\s*(item|ability|status|sandstorm|hail|snow|leech seed|stealth rock|spikes|toxic spikes|sticky web)/i.test(t)) return 'indirect';
      // The untagged-line fallback (case 4 below) sets "cause" to the attacking
      // move's own bare name (e.g. "Earthquake", not "move:Earthquake"). Without
      // this check that bare name doesn't match the "move:" prefix test above and
      // falls through to the "indirect" catch-all, so every ordinary move hit
      // resolved via that fallback was being counted as indirect damage.
      if(!t && move && c === String(move).trim().toLowerCase()) return 'direct';
      // If we have an explicit source but it is not a move, treat it as indirect.
      if(c) return 'indirect';
      return 'direct';
    }

    function ofSlotFromTag(tag){
      // tag like "[of] p2a: Ferrothorn" -> "p2a"
      const m = tag.match(/p[1-4][a-f]/);
      return m ? m[0] : null;
    }

    function monKey(slot){
      const s = slots[slot];
      return s?.monId || null;
    }
    function ensureMon(slot){
      const s = slots[slot];
      if(!s) return null;
      const k = monKey(slot);
      if(!mons[k]) mons[k] = {
        id:k, side:s.side, species:s.species, damageDealt:0, damageTaken:0,
        kills:0, deaths:0, assists:0, appearances:0, killLog:[], deathLog:[], assistLog:[],
        moves: {}, switches:0, leads:0,
        damageDealt:0, damageTaken:0, directDamage:0, indirectDamage:0,
        totalHpAvailable:(Number(s.hpMax)>0 ? Number(s.hpMax) : 100),
        initialHp:(Number(s.hpMax)>0 ? Number(s.hpMax) : 100),
        maxHpObserved:(Number(s.hpMax)>0 ? Number(s.hpMax) : null)
      };
      if(Number.isFinite(s.hpMax) && s.hpMax > 0){
        const maxHp = Number(s.hpMax);
        mons[k].maxHpObserved = Math.max(mons[k].maxHpObserved || 0, maxHp);
        // The first observed maximum HP is the reference HP for assist scaling.
        // Do not overwrite it on later switch-ins/form changes.
        if(!Number.isFinite(mons[k].initialHp) || mons[k].initialHp <= 100 && maxHp > 100 && mons[k].totalHpAvailable === 100){
          mons[k].initialHp = maxHp;
          mons[k].totalHpAvailable = maxHp;
        }
      }
      if(!appearedThisReplay.has(k)){
        appearedThisReplay.add(k);
        mons[k].appearances += 1;
      }
      return mons[k];
    }

    // Re-label the mon currently in `slot` when its true species is revealed
    // or changes WITHOUT a switch event — Illusion breaking (`|replace|`) or
    // a mid-battle forme change like Terapagos Terastallizing into
    // Terapagos-Terastal (`|-formechange|`/`|detailschange|`). Until this is
    // called, everything recorded for that slot stays keyed to whatever
    // species was last seen at switch-in (the Illusion disguise, or
    // Terapagos's pre-transform forme).
    //
    // This renames/merges the existing stats OBJECT rather than starting a
    // fresh one at the new key, because lastAttacker/damageContributors/
    // statusSourceByMon/hazardSetter/etc. all hold direct references to that
    // object (see the note above lastAttacker) — relabeling it in place is
    // what makes credit already "in flight" resolve to the true species once
    // it's known, instead of only fixing future events.
    function migrateSlotSpecies(slot, newSpecies){
      const s = slots[slot];
      if(!s || !newSpecies) return;
      s.species = newSpecies;
      const k = monKey(slot);
      if(k && mons[k]) mons[k].species = newSpecies;
      if(k && luckPokemon[k]) luckPokemon[k].species = newSpecies;
    }


    function addSecondaryProcLuck(attackerSide, attackerMk, targetSide, targetMk, chance, type, detail){
      if(typeof chance !== 'number' || chance <= 0 || chance >= 100) return;
      const score = rarityLuck(chance / 100);
      if(luck[attackerSide]) { luck[attackerSide].secondaryProcs += 1; luck[attackerSide].secondaryLuck += score; addLuckEvent(luck[attackerSide], type, score, detail); }
      if(attackerMk && luckPokemon[attackerMk]) { luckPokemon[attackerMk].secondaryProcs += 1; luckPokemon[attackerMk].secondaryLuck += score; addLuckEvent(luckPokemon[attackerMk], type, score, detail); }
      if(luck[targetSide]) { luck[targetSide].secondaryLuck -= score; addLuckEvent(luck[targetSide], type + '-against', -score, detail); }
      if(targetMk && luckPokemon[targetMk]) { luckPokemon[targetMk].secondaryLuck -= score; addLuckEvent(luckPokemon[targetMk], type + '-against', -score, detail); }
    }
    function addSecondaryDodgeLuck(targetSide, targetMk, chance, type, detail){
      if(typeof chance !== 'number' || chance <= 0 || chance >= 100) return;
      const score = rarityLuck(1 - (chance / 100));
      if(luck[targetSide]) { luck[targetSide].secondaryDodges += 1; luck[targetSide].secondaryDodgeLuck += score; addLuckEvent(luck[targetSide], type + '-dodge', score, detail); }
      if(targetMk && luckPokemon[targetMk]) { luckPokemon[targetMk].secondaryDodges += 1; luckPokemon[targetMk].secondaryDodgeLuck += score; addLuckEvent(luckPokemon[targetMk], type + '-dodge', score, detail); }
    }
    function addStatusDodgeLuck(targetSide, chance, targetMk){
      const score = statusDodgeLuck(chance);
      if(luck[targetSide]) { luck[targetSide].statusDodgeLuck += score; addLuckEvent(luck[targetSide], 'status-dodge', score, `${chance}% status chance avoided`); }
      if(targetMk && luckPokemon[targetMk]) { luckPokemon[targetMk].statusDodgeLuck += score; addLuckEvent(luckPokemon[targetMk], 'status-dodge', score, `${chance}% status chance avoided`); }
    }
    function finalizePendingStatusChecks(){
      for(const key of Object.keys(pendingStatusChecks)){
        const checks = pendingStatusChecks[key];
        for(const check of checks){
          if(!check.resolved && !check.cancelled){
            addStatusDodgeLuck(check.targetSide, check.chance, check.targetMk || key);
            check.resolved = true;
          }
        }
        delete pendingStatusChecks[key];
      }
      for(const key of Object.keys(pendingSecondaryChecks)){
        const checks = pendingSecondaryChecks[key];
        for(const check of checks){
          if(!check.resolved && !check.cancelled){
            addSecondaryDodgeLuck(check.targetSide, check.targetMk || key, check.chance, check.kind, `${check.value} secondary effect avoided`);
            check.resolved = true;
          }
        }
        delete pendingSecondaryChecks[key];
      }
    }
    function finalizeStatusDuration(mk, status){
      const store = status === 'slp' ? sleeping : frozen;
      const st = store[mk];
      if(!st) return;
      const side = mk.split('|')[0];
      const score = durationLuck(st.turns);
      if(luck[side]){
        if(status === 'slp') luck[side].sleepDurationLuck += score;
        if(status === 'frz') luck[side].freezeDurationLuck += score;
      }
      const monLuck = luckPokemon[mk];
      if(monLuck){
        if(status === 'slp') monLuck.sleepDurationLuck += score;
        if(status === 'frz') monLuck.freezeDurationLuck += score;
        addLuckEvent(monLuck, status === 'slp' ? 'sleep' : 'freeze', score, `${st.turns} turn${st.turns===1?'':'s'} ${status === 'slp' ? 'sleep' : 'freeze'}`);
      }
      const sideLuck = luck[side];
      if(sideLuck) addLuckEvent(sideLuck, status === 'slp' ? 'sleep' : 'freeze', score, `${st.turns} turn${st.turns===1?'':'s'} ${status === 'slp' ? 'sleep' : 'freeze'}`);
      delete store[mk];
    }

    for(const raw of lines){
      if(!raw.startsWith('|')) continue;
      const parts = raw.split('|');
      const cmd = parts[1];

      if(cmd === 'poke' && parts[3]){
        const side = parts[2];
        const species = parts[3].split(',')[0].trim();
        if((side==='p1'||side==='p2') && species && !teamRoster[side].some(x=>normName(x)===normName(species))) teamRoster[side].push(species);
      } else if(cmd === 'player' && parts[3]){
        const side = parts[2];
        if(side === 'p1' || side === 'p2') players[side] = parts[3];
      } else if(cmd === 'turn'){
        const t = parseInt(parts[2], 10);
        if(!isNaN(t)){
          // Resolve the previous turn's paralysis outcome. A paralyzed Pokémon
          // that successfully used a move that turn gets a lucky +1; one that
          // lost the turn to full paralysis gets -1. Switching does not count as
          // either outcome.
          if(currentTurn > 0){
            for(const slot of Object.keys(turnActivity)){
              const mk = monKey(slot);
              if(!mk || currentMajorStatus[mk] !== 'par') continue;
              const side = sideOf(slot);
              if(turnActivity[slot] === 'move'){
                luck[side].paralysisDodges += 1;
                const paraScore = paralysisDodgeLuck();
                luck[side].paralysisDodgeLuck += paraScore;
                addLuckEvent(luck[side], 'paralysis', paraScore, 'acted through paralysis');
                const monLuck = pokemonLuckForSlot(slot);
                if(monLuck){ monLuck.paralysisDodges += 1; monLuck.paralysisDodgeLuck += paraScore; addLuckEvent(monLuck, 'paralysis', paraScore, 'acted through paralysis'); }
              } else if(turnActivity[slot] === 'cant'){
                luck[side].fullParalysis += 1;
                const paraBad = rarityLuck(0.25);
                luck[side].paralysisDodgeLuck -= paraBad;
                addLuckEvent(luck[side], 'full-paralysis', -paraBad, 'lost turn to full paralysis');
                const monLuck = pokemonLuckForSlot(slot);
                if(monLuck){ monLuck.fullParalysis += 1; monLuck.paralysisDodgeLuck -= paraBad; addLuckEvent(monLuck, 'full-paralysis', -paraBad, 'lost turn to full paralysis'); }
              }
            }
          }
          for(const k of Object.keys(turnActivity)) delete turnActivity[k];
          currentTurn = t;
          for(const mk of Object.keys(sleeping)){
            const st = sleeping[mk];
            if(st && st.lastCountedTurn < currentTurn){
              const side = mk.split('|')[0];
              if(luck[side]) luck[side].sleepTurns += 1;
              if(luckPokemon[mk]) luckPokemon[mk].sleepTurns += 1;
              st.turns += 1;
              st.lastCountedTurn = currentTurn;
            }
          }
          for(const mk of Object.keys(frozen)){
            const st = frozen[mk];
            if(st && st.lastCountedTurn < currentTurn){
              const side = mk.split('|')[0];
              if(luck[side]) luck[side].freezeTurns += 1;
              if(luckPokemon[mk]) luckPokemon[mk].freezeTurns += 1;
              st.turns += 1;
              st.lastCountedTurn = currentTurn;
            }
          }
          finalizePendingStatusChecks();
        }
      } else if(cmd === 'win'){
        winner = (parts[2] || '').trim() || null;
      } else if(cmd === 'switch' || cmd === 'drag'){
        const slotFull = parts[2];
        if(slotFull) turnActivity[slotFull.split(':')[0].trim()] = 'switch'; // "p1a: Nickname"
        const slot = slotFull.split(':')[0].trim();
        const side = sideOf(slot);
        const species = parts[3].split(',')[0].trim();
        const hp = parseHP(parts[4] || '100/100');
        // Capture the individual that is leaving BEFORE replacing the slot.
        // The slot is reused after switches, so this must be resolved first.
        const oldMonKey = slots[slot] ? monKey(slot) : null;
        // Use the battle nickname as the physical identity. This survives
        // ordinary switches and, unlike species, cannot be stolen by a Zoroark
        // Illusion that temporarily displays as another species.
        const nickname = slotFull.includes(':') ? slotFull.split(':').slice(1).join(':').trim() : species;
        const stableKey = side + '|nick:' + normName(nickname || species);
        let monId = persistentMonIds[stableKey];
        if(!monId){
          monId = side + '|' + (++nextMonInstance);
          persistentMonIds[stableKey] = monId;
        }
        slots[slot] = {species, hp, hpMax: parseMaxHP(parts[4] || '100/100'), side, monId};
        const newStats = ensureMon(slot);
        if(oldMonKey){
          // A real replacement: count the incoming Pokémon as a switch.
          sideHasMadeSwitch[side] = true;
          if(newStats) newStats.switches = (Number(newStats.switches)||0) + 1;
        } else if(!sideHasMadeSwitch[side] && currentTurn <= 1){
          // First send-out(s) of the battle are leads. This also supports doubles:
          // both initial Pokémon can receive a Lead before the first real switch.
          if(newStats){ newStats.leads = (Number(newStats.leads)||0) + 1; sideLeadCount[side] += 1; }
        }
        // A new mon now occupies this slot — any prior *direct-hit* attacker
        // credit for this slot belonged to the mon that just left, so that must
        // not carry over. Status-source credit (poison/burn) is intentionally
        // NOT cleared here — it lives in statusSourceByMon, keyed to the
        // individual mon rather than the slot, because poison/burn persist
        // through a switch and must keep crediting the original inflictor
        // when the same mon returns and the status keeps ticking.
        delete lastAttacker[slot];
        delete pendingDelayedHit[slot];
        if(oldMonKey) delete residualSourceByMon[oldMonKey];
        // ensureMon already ran above.
      } else if(cmd === 'replace'){
        // Illusion breaking: Showdown reveals the true species of whatever
        // is currently in this slot. No switch occurs — the same physical
        // stint continues, so re-key its stats to the real species instead
        // of leaving them attributed to the disguise.
        const slotFull = parts[2];
        const slot = slotFull ? slotFull.split(':')[0].trim() : null;
        const species = parts[3] ? parts[3].split(',')[0].trim() : '';
        if(slot && species) migrateSlotSpecies(slot, species);
      } else if(cmd === '-formechange' || cmd === 'detailschange'){
        // Mid-battle forme change with no accompanying switch — e.g.
        // Terapagos Terastallizing into Terapagos-Terastal, or any other
        // battle-only forme (Aegislash stance, Morpeko Hunger Switch, etc.).
        // Re-key so stats for the rest of this stint land on the new forme;
        // canonicalSpecies() downstream still collapses battle-only formes
        // back to their base species for aggregation.
        const slotFull = parts[2];
        const slot = slotFull ? slotFull.split(':')[0].trim() : null;
        const species = parts[3] ? parts[3].split(',')[0].trim() : '';
        if(slot && species) migrateSlotSpecies(slot, species);
      } else if(cmd === 'move'){
        finalizePendingStatusChecks();
        const source = parts[2] ? parts[2].split(':')[0].trim() : null;
        const target = parts[4] ? parts[4].split(':')[0].trim() : null;
        const moveName = parts[3] ? parts[3].trim() : '';
        if(source) {
          turnActivity[source] = 'move';
          const normalizedMove = moveKey(moveName);
          if(normalizedMove !== 'protect' && normalizedMove !== 'detect' && normalizedMove !== 'banefulbunker' && normalizedMove !== 'kingsshield' && normalizedMove !== 'spikyshield' && normalizedMove !== 'silktrap' && normalizedMove !== 'obstruct' && normalizedMove !== 'burningbulwark' && normalizedMove !== 'maxguard') protectStreak[source] = 0;
          lastMove = {source, target, targets: target ? [target] : [], move: moveName, accuracy:getMoveAccuracy(moveName), hitCounted:false, turn:currentTurn};
          if(source && target && sideOf(source) !== sideOf(target)){
            const targetMk = monKey(target);
            if(targetMk && !currentMajorStatus[targetMk]){
              const statusEntries = MOVE_DATA?.[moveKey(moveName)]?.statusChances || {};
              for(const [status, chanceRaw] of Object.entries(statusEntries)){
                const chance = Number(chanceRaw);
                // 100% status effects are deterministic once the move hits.
                // Only probabilistic status rolls participate in luck scoring.
                if(Number.isFinite(chance) && chance > 0 && chance < 100){
                  (pendingStatusChecks[targetMk] ||= []).push({targetSide:sideOf(target), targetMk, status, chance, source, target, resolved:false, cancelled:false});
                }
              }
              const moveEntry = MOVE_DATA && MOVE_DATA[moveKey(moveName)];
              for(const effect of (moveEntry?.secondaryEffects || [])){
                if(!effect || typeof effect.chance !== 'number' || effect.chance <= 0 || effect.chance >= 100) continue;
                const key = `${effect.kind}:${effect.value}`;
                // Status effects are already tracked above. Track other secondary rolls here.
                if(effect.kind === 'status') continue;
                (pendingSecondaryChecks[targetMk] ||= []).push({targetSide:sideOf(target), targetMk, source, target, kind:effect.kind, value:effect.value, chance:effect.chance, key, resolved:false, cancelled:false});
              }
            }
          }
          const moveStats = ensureMon(source);
          if(moveStats && moveName){
            if(!moveStats.moves) moveStats.moves = {};
            moveStats.moves[moveName] = (moveStats.moves[moveName] || 0) + 1;
          }
        }
        if(source && HAZARD_MOVES.includes(moveName)){
          const oppSide = sideOf(source) === 'p1' ? 'p2' : 'p1';
          const setterStats = ensureMon(source);
          if(setterStats){
            if(!hazardSetter[oppSide]) hazardSetter[oppSide] = {};
            hazardSetter[oppSide][moveName] = setterStats;
          }
        }
        if(source && DELAYED_MOVES.includes(moveName)){
          const oppSide = sideOf(source) === 'p1' ? 'p2' : 'p1';
          const setterStats = ensureMon(source);
          if(setterStats){
            if(!delayedSetter[oppSide]) delayedSetter[oppSide] = {};
            delayedSetter[oppSide][moveName] = setterStats;
          }
        }
        if(source && moveName === 'Toxic Spikes'){
          // Toxic Spikes are a side-wide condition. Keep the Pokémon that most
          // recently established the Toxic Spikes on that side so a later
          // switch-in, poison tick, and eventual faint can all inherit the
          // setter's kill credit even if the setter has switched out or fainted.
          const oppSide = sideOf(source) === 'p1' ? 'p2' : 'p1';
          const setterStats = ensureMon(source);
          if(setterStats) toxicSpikesSetter[oppSide] = setterStats;
        }
      } else if(cmd === '-end'){
        // Future Sight / Doom Desire are represented by Showdown as:
        //   |-end|target|move: Future Sight
        //   |-damage|target|...
        // The -damage line is deliberately untagged, so looking for
        // 'Future Sight' in its tags will never work. Resolve the setter
        // at the -end event and carry it into the following damage event.
        const slotFull = parts[2];
        const effect = parts.slice(3).join('|');
        
        if(slotFull){
          const slot = slotFull.split(':')[0].trim();
          const mk = monKey(slot);
          if(mk){
            const endedResidual = RESIDUAL_MOVES.find(m => effect.includes(m));
            if(endedResidual && residualSourceByMon[mk]?.cause === endedResidual){
              delete residualSourceByMon[mk];
            }
          }
        }

        if(slotFull && (effect.includes('move: Future Sight') || effect.includes('move: Doom Desire'))){
          const slot = slotFull.split(':')[0].trim();
          const delayedHit = DELAYED_MOVES.find(m => effect.includes('move: ' + m));
          if(delayedHit && delayedSetter[sideOf(slot)] && delayedSetter[sideOf(slot)][delayedHit]){
            pendingDelayedHit[slot] = {
              stats: delayedSetter[sideOf(slot)][delayedHit],
              cause: delayedHit
            };
          }
        }
      } else if(cmd === '-miss'){
        const source = parts[2] ? parts[2].split(':')[0].trim() : null;
        const target = parts[3] ? parts[3].split(':')[0].trim() : null;
        if(source && target && sideOf(source) !== sideOf(target)){
          const targetSide = sideOf(target);
          // A miss is a dodge for the target. We also resolve the actual move
          // accuracy so the replay records whether this was a low-accuracy
          // dodge, rather than guessing from a hard-coded move list.
          if(luck[targetSide]){
            luck[targetSide].dodges += 1;
            if(lastMove && lastMove.source === source && lastMove.target === target){
              // Because the move missed, none of its secondary status rolls happened.
              // Cancel the pending status checks created by this move so a miss can
              // never be mistaken for a successful status-roll dodge.
              const missedMk = monKey(target);
              if(missedMk && pendingStatusChecks[missedMk]){
                pendingStatusChecks[missedMk] = pendingStatusChecks[missedMk].filter(check => check.source !== source || check.target !== target);
                if(!pendingStatusChecks[missedMk].length) delete pendingStatusChecks[missedMk];
              }
              if(missedMk && pendingSecondaryChecks[missedMk]){
                pendingSecondaryChecks[missedMk] = pendingSecondaryChecks[missedMk].filter(check => check.source !== source || check.target !== target);
                if(!pendingSecondaryChecks[missedMk].length) delete pendingSecondaryChecks[missedMk];
              }
              const accuracy = getMoveAccuracy(lastMove.move);
              if(accuracy !== null){
                const score = moveDodgeLuck(accuracy);
                luck[targetSide].moveDodgeLuck += score;
                addLuckEvent(luck[targetSide], 'dodge', score, `${lastMove.move} missed (${accuracy}% accurate)`);
                const monLuck = pokemonLuckForSlot(target);
                if(monLuck) { monLuck.moveDodgeLuck += score; addLuckEvent(monLuck, 'dodge', score, `${lastMove.move} missed (${accuracy}% accurate)`); }
              }
              if(isLowAccuracyMove(lastMove.move)){
                luck[targetSide].lowAccuracyDodges += 1;
                const monLuck = pokemonLuckForSlot(target);
                if(monLuck) monLuck.lowAccuracyDodges += 1;
              }
              // IMPORTANT: a move miss only means the move itself was dodged.
              // Never award a separate paralysis/sleep/freeze dodge here, because
              // the secondary status roll never occurred when the move missed.
            }
          }
          if(lastMove && lastMove.source === source && lastMove.target === target){
            lastMove.missed = true;
            lastMove.accuracy = getMoveAccuracy(lastMove.move);
          }
        }
      } else if(cmd === '-enditem' || cmd === '-item'){
        const targetFull = parts[2];
        const itemName = parts[3] ? parts[3].split('|')[0].trim() : '';
        const tags = parts.slice(4).join('|');
        if(targetFull){
          const target = targetFull.split(':')[0].trim();
          const targetMk = monKey(target);
          let sourceStats = null;
          if(tags.includes('[of]')){
            const ofSlot = ofSlotFromTag(tags);
            if(ofSlot && slots[ofSlot]) sourceStats = ensureMon(ofSlot);
          }
          // Successful item removal/transfer is an assist-capable contribution.
          // Snapshot the contributor's damage HERE, at the item-removal event.
          // Do not wait until faint: the victim/source identity can change or the
          // live contribution map can be cleared/merged before the faint is read.
          if(targetMk && sourceStats && sourceStats.side !== sideOf(target)){
            // Item removal is a separate strategic contribution.  NEVER use the
            // item-removal event itself as a replacement for the attacker's damage.
            // Store only the contributor identity here.  At faint time we rebuild
            // the damage from every matching damage-contributor entry, including
            // multiple battle stints/forms of the same Pokémon.
            const contributorKey = `${String(sourceStats.side||'')}|${normName(canonicalBattleSpecies(sourceStats.species||''))}`;
            (itemAssistContributors[targetMk] ||= {})[contributorKey] = {
              stats: sourceStats,
              side: String(sourceStats.side||''),
              species: canonicalBattleSpecies(sourceStats.species||''),
              turn: currentTurn
            };
          }
        }
      } else if(cmd === '-flinch'){
        const target = parts[2] ? parts[2].split(':')[0].trim() : null;
        if(target && lastMove && lastMove.target === target && sideOf(lastMove.source) !== sideOf(target)){
          const chance = getMoveSecondaryChance(lastMove.move, 'flinch', 'flinch');
          if(chance !== null && chance > 0 && chance < 100){
            const mk=monKey(target);
            if(mk && pendingSecondaryChecks[mk]){
              for(const check of pendingSecondaryChecks[mk]) if(check.source===lastMove.source && check.target===target && check.kind==='flinch') check.resolved=true;
              pendingSecondaryChecks[mk]=pendingSecondaryChecks[mk].filter(check=>!check.resolved);
              if(!pendingSecondaryChecks[mk].length) delete pendingSecondaryChecks[mk];
            }
            const score = rarityLuck(chance / 100);
            const aSide=sideOf(lastMove.source), tSide=sideOf(target);
            luck[aSide].flinches += 1; luck[aSide].flinchLuck += score; addLuckEvent(luck[aSide], 'flinch', score, `${lastMove.move} flinched (${chance}% chance)`);
            const aLuck=pokemonLuckForSlot(lastMove.source); if(aLuck){aLuck.flinches+=1;aLuck.flinchLuck+=score;addLuckEvent(aLuck,'flinch',score,`${lastMove.move} flinched (${chance}% chance)`);}
            luck[tSide].flinchLuck -= score; addLuckEvent(luck[tSide], 'flinch-against', -score, `${lastMove.move} caused a flinch (${chance}% chance)`);
            const tLuck=pokemonLuckForSlot(target); if(tLuck){tLuck.flinchLuck-=score;addLuckEvent(tLuck,'flinch-against',-score,`${lastMove.move} caused a flinch (${chance}% chance)`);}
          }
        }
      } else if(cmd === '-confusion'){
        const target = parts[2] ? parts[2].split(':')[0].trim() : null;
        if(target && lastMove && lastMove.target === target && sideOf(lastMove.source) !== sideOf(target)){
          const chance=getMoveSecondaryChance(lastMove.move,'volatileStatus','confusion');
          if(chance !== null && chance > 0 && chance < 100){
            const mk=monKey(target);
            if(mk && pendingSecondaryChecks[mk]){
              for(const check of pendingSecondaryChecks[mk]) if(check.source===lastMove.source && check.target===target && check.kind==='volatileStatus' && check.value==='confusion') check.resolved=true;
              pendingSecondaryChecks[mk]=pendingSecondaryChecks[mk].filter(check=>!check.resolved);
              if(!pendingSecondaryChecks[mk].length) delete pendingSecondaryChecks[mk];
            }
            addSecondaryProcLuck(sideOf(lastMove.source),monKey(lastMove.source),sideOf(target),monKey(target),chance,'confusion-proc',`${lastMove.move} caused confusion (${chance}% chance)`);
            pendingConfusionSource[monKey(target)] = ensureMon(lastMove.source);
          }
        }
      } else if(cmd === '-boost' || cmd === '-unboost'){
        const target=parts[2] ? parts[2].split(':')[0].trim() : null;
        if(target && lastMove && lastMove.target === target && sideOf(lastMove.source) !== sideOf(target)){
          const chance=getMoveSecondaryChance(lastMove.move,'boost',null);
          if(chance !== null && chance > 0 && chance < 100){
            const mk=monKey(target);
            if(mk && pendingSecondaryChecks[mk]){
              for(const check of pendingSecondaryChecks[mk]) if(check.source===lastMove.source && check.target===target && check.kind==='boost') check.resolved=true;
              pendingSecondaryChecks[mk]=pendingSecondaryChecks[mk].filter(check=>!check.resolved);
              if(!pendingSecondaryChecks[mk].length) delete pendingSecondaryChecks[mk];
            }
            addSecondaryProcLuck(sideOf(lastMove.source),monKey(lastMove.source),sideOf(target),mk,chance,'secondary-boost',`${lastMove.move} triggered a secondary stat change (${chance}% chance)`);
          }
        }
      } else if(cmd === '-activate'){
        const slotFull=parts[2];
        const effect=parts.slice(3).join('|');
        const slot=slotFull ? slotFull.split(':')[0].trim() : null;
        if(slot && /move:\s*(Protect|Detect|Baneful Bunker|King's Shield|Spiky Shield|Silk Trap|Obstruct|Burning Bulwark|Max Guard)/i.test(effect) && lastMove?.source===slot){
          const n=(protectStreak[slot]||0)+1;
          protectStreak[slot]=n;
          if(n>1){
            const chance=Math.pow(1/3,n-1); const score=rarityLuck(chance);
            luck[sideOf(slot)].protectSuccesses += 1; luck[sideOf(slot)].protectLuck += score; addLuckEvent(luck[sideOf(slot)],'protect',score,`successful consecutive protection (${(chance*100).toFixed(1)}% chance)`);
            const ml=pokemonLuckForSlot(slot); if(ml){ml.protectSuccesses+=1;ml.protectLuck+=score;addLuckEvent(ml,'protect',score,`successful consecutive protection (${(chance*100).toFixed(1)}% chance)`);}
          }
        } else if(slot && /confusion/i.test(effect) && pendingConfusionSource[monKey(slot)]) {
          // Keep the source attached until a self-hit is actually observed.
        }
      } else if(cmd === '-crit'){
        const target = parts[2] ? parts[2].split(':')[0].trim() : null;
        if(lastMove && target && lastMove.source && sideOf(lastMove.source) !== sideOf(target)){
          const attackerSide = sideOf(lastMove.source);
          // Guaranteed-crit moves are deterministic and must not count as lucky crits.
          const critChanceValue = critChance(lastMove.move);
          if(critChanceValue !== null){
            if(luck[attackerSide]){
              luck[attackerSide].crits += 1;
              luck[attackerSide].critLuck += rarityLuck(critChanceValue);
              addLuckEvent(luck[attackerSide], 'crit', rarityLuck(critChanceValue), `${lastMove.move} crit (${critChanceValue.toFixed(1)}% chance)`);
            }
            const monLuck = pokemonLuckForSlot(lastMove.source);
            if(monLuck){ monLuck.crits += 1; monLuck.critLuck += rarityLuck(critChanceValue); addLuckEvent(monLuck, 'crit', rarityLuck(critChanceValue), `${lastMove.move} crit (${critChanceValue.toFixed(1)}% chance)`); }
          }
        }
      
      } else if(cmd === '-weather'){
        const weather = (parts[2] || '').trim();
        const tags = parts.slice(3).join('|');
        if(weather === 'none'){ weatherSetter = {}; } else if(weather && WEATHER_NAMES.includes(weather)){
          let setter = null;
          if(tags.includes('[of]')){
            const ofSlot = ofSlotFromTag(tags);
            if(ofSlot && slots[ofSlot]) setter = ensureMon(ofSlot);
          }
          if(setter) weatherSetter[weather] = setter;
          else if(weather === 'none') delete weatherSetter[weather];
        }
      } else if(cmd === '-start'){
        const slotFull = parts[2];
        const effect = parts.slice(3).join('|');
        if(slotFull){
          const slot = slotFull.split(':')[0].trim();
          const mk = monKey(slot);
          const residual = RESIDUAL_MOVES.find(m => effect.includes(m));
          if(mk && residual && lastMove && lastMove.target === slot && sideOf(lastMove.source) !== sideOf(slot)){
            const sourceStats = ensureMon(lastMove.source);
            if(sourceStats) residualSourceByMon[mk] = {stats:sourceStats, cause:residual};
          }
        }
} else if(cmd === '-status'){
        const slotFull = parts[2];
        if(!slotFull) continue;
        const slot = slotFull.split(':')[0].trim();
        const mk = monKey(slot);
        if(!mk) continue;
        const statusTags = parts.slice(3).join('|');
        let inflictorStats = null;
        if(statusTags.includes('Toxic Spikes') && toxicSpikesSetter[sideOf(slot)]){
          // Poisoned on switch-in by Toxic Spikes. There is no attacker's move
          // line for the later residual damage, so permanently associate this
          // individual Pokémon with the Toxic Spikes setter until its status
          // is cured. This is keyed by mon identity rather than slot because
          // the poisoned Pokémon can switch out and back in.
          inflictorStats = toxicSpikesSetter[sideOf(slot)];
        } else if(lastMove && lastMove.target === slot && sideOf(lastMove.source) !== sideOf(slot)){
          inflictorStats = ensureMon(lastMove.source);
        }
        if(inflictorStats) {
          statusSourceByMon[mk] = inflictorStats;
          const inflictorSide = inflictorStats.side;
          const statusCode = ['brn','psn','tox','par','slp','frz','drg'].find(code => statusTags.split('|').some(x => x.trim() === code)) || null;
          currentMajorStatus[mk] = statusCode || currentMajorStatus[mk] || null;
          if(statusCode && lastMove && lastMove.target === slot){
            const pending = pendingStatusChecks[mk] || [];
            for(const check of pending){
              if(check.status === statusCode) check.resolved = true;
            }
            pendingStatusChecks[mk] = pending.filter(check => !check.resolved);
            if(!pendingStatusChecks[mk].length) delete pendingStatusChecks[mk];
          }
          if(statusCode && lastMove && lastMove.target === slot && sideOf(lastMove.source) !== sideOf(slot)){
            const chance = getMoveStatusChance(lastMove.move, statusCode);
            if(chance !== null && chance > 0 && chance < 100){
              addSecondaryProcLuck(sideOf(lastMove.source), monKey(lastMove.source), sideOf(slot), mk, chance, 'status-proc', `${lastMove.move} inflicted ${statusCode} (${chance}% chance)`);
            }
          }
          if(statusCode === 'slp'){
            sleeping[mk] = {startTurn:currentTurn, lastCountedTurn:currentTurn, turns:0};
            if(inflictorSide && luck[inflictorSide]) luck[inflictorSide].sleepEvents += 1;
            const targetLuck = pokemonLuckForSlot(slot);
            if(targetLuck) targetLuck.sleepEvents += 1;
          } else if(statusCode === 'frz'){
            frozen[mk] = {startTurn:currentTurn, lastCountedTurn:currentTurn, turns:0};
            if(inflictorSide && luck[inflictorSide]) luck[inflictorSide].freezeEvents += 1;
            const targetLuck = pokemonLuckForSlot(slot);
            if(targetLuck) targetLuck.freezeEvents += 1;
          } else if(statusCode === 'par'){
            // The status itself is not automatically treated as lucky/unlucky.
            // Luck comes from avoiding the status roll or from the duration/turn
            // behaviour of the status.
          }
          if(lastMove && !lastMove.hitCounted && lastMove.target === slot && isLowAccuracyMove(lastMove.move)){
            if(luck[inflictorSide]) luck[inflictorSide].lowAccuracyHits += 1;
            lastMove.hitCounted = true;
          }
        }
      } else if(cmd === 'cant'){
        const slotFull = parts[2];
        const reason = parts[3] ? parts[3].trim() : '';
        if(slotFull && reason === 'par'){
          const slot = slotFull.split(':')[0].trim();
          turnActivity[slot] = 'cant';
        }
      } else if(cmd === '-block' || cmd === '-fail' || cmd === '-notarget'){
        const slotFull = parts[2];
        if(slotFull){
          const slot = slotFull.split(':')[0].trim();
          const mk = monKey(slot);
          if(mk && pendingStatusChecks[mk]) delete pendingStatusChecks[mk];
          if(mk && pendingSecondaryChecks[mk]) delete pendingSecondaryChecks[mk];
          if(cmd === '-fail' && slot) protectStreak[slot] = 0;
          if(mk && pendingSecondaryChecks[mk]) delete pendingSecondaryChecks[mk];
          if(mk && pendingSecondaryChecks[mk]) delete pendingSecondaryChecks[mk];
          if(mk && pendingSecondaryChecks[mk]) delete pendingSecondaryChecks[mk];
        }
      } else if(cmd === '-immune'){
        const slotFull = parts[2];
        if(slotFull){
          const slot = slotFull.split(':')[0].trim();
          const mk = monKey(slot);
          if(mk && pendingStatusChecks[mk]) delete pendingStatusChecks[mk];
        }
      } else if(cmd === '-curestatus'){
        const slotFull = parts[2];
        if(!slotFull) continue;
        const slot = slotFull.split(':')[0].trim();
        const mk = monKey(slot);
        // status is gone — clear credit so it can't be reused if this individual
        // is somehow attributed residual status damage again later
        if(mk){
          const curedStatus = parts[3] ? parts[3].split('|')[0].trim() : currentMajorStatus[mk];
          if(curedStatus === 'slp') finalizeStatusDuration(mk, 'slp');
          if(curedStatus === 'frz') finalizeStatusDuration(mk, 'frz');
          delete currentMajorStatus[mk];
          delete statusSourceByMon[mk];
        }
      } else if(cmd === '-damage'){
        const slotFull = parts[2];
        if(!slotFull) continue;
        const slot = slotFull.split(':')[0].trim();
        if(!slots[slot]) continue;
        const newHp = parseHP(parts[3]);
        const oldHp = slots[slot].hp;
        const dmg = Math.max(0, oldHp - newHp);
        slots[slot].hp = newHp;
        const targetStats = ensureMon(slot);
        if(targetStats) targetStats.damageTaken += dmg;
        if(lastMove && lastMove.target === slot && sideOf(lastMove.source) !== sideOf(slot)){
          if(!lastMove.hitCounted && isLowAccuracyMove(lastMove.move)){
            const attackerSide = sideOf(lastMove.source);
            const hitScore = lowAccuracyHitLuck(getMoveAccuracy(lastMove.move));
            if(luck[attackerSide]){
              luck[attackerSide].lowAccuracyHits += 1;
              luck[attackerSide].lowAccuracyHitLuck += hitScore;
              addLuckEvent(luck[attackerSide], 'low-accuracy-hit', hitScore, `${lastMove.move} hit (${getMoveAccuracy(lastMove.move)}% accurate)`);
            }
            const monLuck = pokemonLuckForSlot(lastMove.source);
            if(monLuck){
              monLuck.lowAccuracyHits += 1;
              monLuck.lowAccuracyHitLuck += hitScore;
              addLuckEvent(monLuck, 'low-accuracy-hit', hitScore, `${lastMove.move} hit (${getMoveAccuracy(lastMove.move)}% accurate)`);
            }
            lastMove.hitCounted = true;
          }
        }
        if(dmg <= 0) continue;

        const tags = parts.slice(4).join('|');
        if(tags && /confusion/i.test(tags) && pendingConfusionSource[monKey(slot)]){
          const targetSide=sideOf(slot); const sourceStats=pendingConfusionSource[monKey(slot)];
          const score=rarityLuck(0.3333333333);
          luck[targetSide].confusionSelfHits += 1; luck[targetSide].confusionLuck -= score; addLuckEvent(luck[targetSide],'confusion-self-hit',-score,'hit itself in confusion (33.3% chance)');
          const ml=pokemonLuckForSlot(slot); if(ml){ml.confusionSelfHits+=1;ml.confusionLuck-=score;addLuckEvent(ml,'confusion-self-hit',-score,'hit itself in confusion (33.3% chance)');}
          if(sourceStats && sourceStats.side !== targetSide){ luck[sourceStats.side].confusionLuck += score; addLuckEvent(luck[sourceStats.side],'confusion-caused',score,'opponent hit itself in confusion (33.3% chance)'); }
          delete pendingConfusionSource[monKey(slot)];
        }
        let attackerStats = null;
        let cause = null;

        // 1) explicit [of] source. Showdown attaches [of] to many damage lines,
        // including ordinary moves as well as indirect effects. Resolve it first so
        // direct move damage is never lost just because the line contains metadata.
        if(tags.includes('[of]')){
          const ofSlot = ofSlotFromTag(tags);
          if(ofSlot && slots[ofSlot]){
            attackerStats = ensureMon(ofSlot);
            const effectM = tags.match(/\[from\]\s*([^\|\[]+)/);
            cause = effectM ? effectM[1].trim() : 'contact/held-item effect';
          }
        }
        // 2) entry hazard chip (Stealth Rock / Spikes) -> credit whoever set it
        if(!attackerStats){
          const hazardHit = HAZARD_MOVES.find(h => tags.includes(h));
          if(hazardHit && hazardSetter[sideOf(slot)] && hazardSetter[sideOf(slot)][hazardHit]){
            attackerStats = hazardSetter[sideOf(slot)][hazardHit];
            cause = hazardHit;
          }
        }
        // 3) residual status damage (burn/poison/toxic) -> credit whoever inflicted the status.
        // Looked up by the mon's own identity (monKey), not the slot, since poison/burn
        // persist through a switch and must keep crediting the original inflictor even
        // after this individual left and came back to the same or a different slot.
        // This is also what gives a Toxic Spikes setter the kill when poison damage
        // is the final damage instance before fainting.
        if(!attackerStats){
          const statusHit = STATUS_TAGS.find(s => tags.includes('[from] ' + s));
          const mk = monKey(slot);
          if(statusHit && mk && statusSourceByMon[mk]){
            attackerStats = statusSourceByMon[mk];
            const sourceWasToxicSpikes = (
              toxicSpikesSetter[sideOf(slot)] &&
              toxicSpikesSetter[sideOf(slot)] === attackerStats
            );
            cause = sourceWasToxicSpikes
              ? 'Toxic Spikes'
              : 'residual ' + statusHit;
          }
        }
        // 3b) delayed hits (Future Sight / Doom Desire).
        // Showdown puts the move name on a preceding -end event, NOT on the
        // subsequent -damage line, so use the pending source captured there.
        if(!attackerStats && pendingDelayedHit[slot]){
          attackerStats = pendingDelayedHit[slot].stats;
          cause = pendingDelayedHit[slot].cause;
          delete pendingDelayedHit[slot];
        }

        // 3c) lingering move effects (Curse, Salt Cure, trapping damage, Nightmare, etc.)
        // Showdown identifies these on the damage line but does not always include [of].
        if(!attackerStats){
          const mk = monKey(slot);
          const residualHit = RESIDUAL_MOVES.find(m => tags.includes('[from] ' + m));
          if(residualHit && mk && residualSourceByMon[mk]?.cause === residualHit){
            attackerStats = residualSourceByMon[mk].stats;
            cause = residualHit;
          }
        }
        // 3d) weather chip. If Showdown supplied the weather's originating setter,
        // credit the setter instead of leaving the KO unattributed.
        if(!attackerStats){
          const weatherHit = WEATHER_NAMES.find(w => tags.includes('[from] ' + w));
          if(weatherHit && weatherSetter[weatherHit]){
            attackerStats = weatherSetter[weatherHit];
            cause = weatherHit;
          }
        }

        // 4) fallback: direct hit from the most recent move, if it targeted this slot.
        //    Showdown only omits [from]/[of] entirely on a -damage line for a genuine
        //    direct move hit — weather chip, confusion self-hits, recoil, etc. always
        //    carry a tag (just not one of the specific ones matched above). So this
        //    fallback must only fire on a completely untagged line, or it ends up
        //    crediting stale "last real attacker" info to indirect damage it never dealt.
        if(!attackerStats && tags === '' && lastMove && lastMove.source && lastMove.turn === currentTurn && sideOf(lastMove.source) !== sideOf(slot)){
          attackerStats = ensureMon(lastMove.source);
          cause = lastMove.move || 'direct hit';
        }

        if(attackerStats && attackerStats.side !== slots[slot].side){
          const damageClass = classifyDamageCause(cause, tags, lastMove?.move);
          if(damageClass === 'self'){
            lastAttacker[slot] = {stats:null, cause:'Self-inflicted', turn:currentTurn};
            continue;
          }
          attackerStats.damageDealt += dmg;
          if(damageClass === 'indirect') attackerStats.indirectDamage += dmg;
          else attackerStats.directDamage += dmg;
          // Track this attacker's cumulative contribution to this specific victim.
          const victimMk = monKey(slot);
          const attackerMk = attackerStats.id || (attackerStats.side + '|' + normName(attackerStats.species));
          if(victimMk && attackerMk){
            if(!damageContributors[victimMk]) damageContributors[victimMk] = {};
            if(!damageContributors[victimMk][attackerMk]) damageContributors[victimMk][attackerMk] = {stats:attackerStats, damage:0, direct:0, indirect:0};
            damageContributors[victimMk][attackerMk].damage += dmg;
            const isIndirect = classifyDamageCause(cause, tags, lastMove?.move) === 'indirect';
            damageContributors[victimMk][attackerMk][isIndirect ? 'indirect' : 'direct'] += dmg;
          }
          lastAttacker[slot] = {stats: attackerStats, cause, turn: currentTurn};
        } else {
          // This damage instance landed but couldn't be attributed to an opposing
          // mon (environmental chip we couldn't trace, self-inflicted damage, etc.).
          // Clear any earlier attacker on file for this slot — otherwise a mon that
          // survives a real hit and later dies to something untraceable still has
          // the kill wrongly credited to whoever landed that earlier real hit.
          lastAttacker[slot] = {stats:null, cause:'Other', turn:currentTurn};
        }
      } else if(cmd === '-heal' || cmd === '-sethp'){
        const slotFull = parts[2];
        if(!slotFull) continue;
        const slot = slotFull.split(':')[0].trim();
        if(!slots[slot]) continue;
        const oldHp = Number(slots[slot].hp)||0;
        const newHp = parseHP(parts[3]);
        slots[slot].hp = newHp;
        const gain = Math.max(0, newHp - oldHp);
        const targetStats = ensureMon(slot);
        if(targetStats && gain > 0) targetStats.totalHpAvailable = (Number(targetStats.totalHpAvailable)||100) + gain;
        const tags = parts.slice(4).join('|');
        if(targetStats && tags.includes('Healing Wish')){
          const sourceTag = tags.match(/\[(?:wisher|of)\]\s*(p[12][a-f])\s*:/i);
          const sourceSlot = sourceTag ? sourceTag[1] : ofSlotFromTag(tags);
          if(sourceSlot && slots[sourceSlot]) healingWishSourceByMon[monKey(slot)] = ensureMon(sourceSlot);
        }
        if(targetStats && tags.includes('Revival Blessing')){
          const sourceTag = tags.match(/\[(?:reviver|of)\]\s*(p[12][a-f])\s*:/i);
          const sourceSlot = sourceTag ? sourceTag[1] : ofSlotFromTag(tags);
          if(sourceSlot && slots[sourceSlot]) revivalSourceByMon[monKey(slot)] = ensureMon(sourceSlot);
        }
        const parsedMaxHp = parseMaxHP(parts[3]);
        if(parsedMaxHp) slots[slot].hpMax = Math.max(slots[slot].hpMax || 0, parsedMaxHp);
      } else if(cmd === 'faint'){
        const slotFull = parts[2];
        if(!slotFull) continue;
        const slot = slotFull.split(':')[0].trim();
        if(!slots[slot]) continue;
        const victimMk = monKey(slot);
        const deadStats = ensureMon(slot);
        const killerInfo = lastAttacker[slot];
        const killerStats = killerInfo ? killerInfo.stats : null;
        const credited = !!(killerStats && killerStats.side !== slots[slot].side);
        if(deadStats){
          const deadKey = monKey(slot);
          if(deadKey){
            if(sleeping[deadKey]) finalizeStatusDuration(deadKey, 'slp');
            if(frozen[deadKey]) finalizeStatusDuration(deadKey, 'frz');
            delete currentMajorStatus[deadKey];
            delete sleeping[deadKey];
            delete frozen[deadKey];
            delete pendingStatusChecks[deadKey];
          }
          deadStats.deaths += 1;
          deadStats.deathLog.push({
            replayId, turn: currentTurn,
            killer: credited ? killerStats.species : null,
            cause: credited ? killerInfo.cause : (killerInfo?.cause || 'Other')
          });
        }
        if(credited){
          killerStats.kills += 1;
          killerStats.killLog.push({
            replayId, turn: currentTurn,
            victim: deadStats ? deadStats.species : slots[slot].species,
            cause: killerInfo.cause
          });
        }

        // Assist credit: scaled damage threshold with a 25% floor, plus explicit
        // strategic contribution events (item removal and Healing Wish/Revival Blessing).
        const victimInitialHp = deadStats && Number(deadStats.initialHp) > 0 ? Number(deadStats.initialHp) : 100;
        const victimTotalHp = deadStats && Number(deadStats.totalHpAvailable) > 0 ? Number(deadStats.totalHpAvailable) : victimInitialHp;
        const assistThresholdPct = Math.max(25, 50 * (victimInitialHp / victimTotalHp));
        const contributions = victimMk ? damageContributors[victimMk] : null;
        const candidates = new Map();
        const assistKey = stats => `${String(stats?.side||'')}|${normName(canonicalBattleSpecies(stats?.species||''))}`;
        if(contributions){
          for(const attackerMk of Object.keys(contributions)){
            const contribution = contributions[attackerMk];
            const assistStats = contribution && contribution.stats;
            if(!assistStats || assistStats.side === slots[slot].side || (killerStats && assistStats === killerStats)) continue;
            const percentOfPool = (Number(contribution.damage)||0) / victimTotalHp * 100;
            if(percentOfPool + 1e-9 >= assistThresholdPct){
              const key = assistKey(assistStats) || assistStats.id;
              const existing = candidates.get(key);
              if(existing){
                existing.damage += Number(contribution.damage)||0;
                existing.percent = victimTotalHp > 0 ? (existing.damage / victimTotalHp * 100) : 0;
              } else {
                candidates.set(key, {stats:assistStats, reason:'damage', damage:Number(contribution.damage)||0, percent:percentOfPool});
              }
            }
          }
        }
        const itemSources = victimMk ? itemAssistContributors[victimMk] : null;
        if(itemSources) for(const itemEntry of Object.values(itemSources)){
          const source = itemEntry?.stats || null;
          const sourceSide = String(itemEntry?.side || source?.side || '');
          const sourceSpecies = canonicalBattleSpecies(itemEntry?.species || source?.species || '');
          if(!source || sourceSide === String(slots[slot].side||'') || (killerStats && source === killerStats)) continue;

          // IMPORTANT: item removal does NOT own a damage value.  The damage is
          // rebuilt from the canonical damage ledger for this victim by matching
          // side + canonical species and SUMMING every matching stint.  This is
          // deliberately independent of the transient mon/stint ID used by the
          // -enditem line, so a switch/form change can never turn real damage into 0.
          let damage = 0;
          const current = damageContributors?.[victimMk] || {};
          for(const contribution of Object.values(current)){
            const c = contribution?.stats;
            if(!c) continue;
            if(String(c.side||'') !== sourceSide) continue;
            if(normName(canonicalBattleSpecies(c.species||'')) !== normName(sourceSpecies)) continue;
            damage += Number(contribution.damage)||0;
          }
          const percent = victimTotalHp > 0 ? (damage / victimTotalHp * 100) : 0;
          const reason = percent > 50 ? 'item removal + damage' : 'item removal';
          // Preserve the actual contributor stats object while using the same
          // stable identity key as ordinary damage assists. If this Pokémon
          // already qualified for a damage assist, merge the item-removal event
          // into that one record instead of creating a duplicate assist.
          const candidateKey = `${sourceSide}|${normName(sourceSpecies)}`;
          const existing = candidates.get(candidateKey);
          if(existing){
            existing.stats = source;
            existing.damage = damage;
            existing.percent = percent;
            existing.reason = reason;
          } else {
            candidates.set(candidateKey, {stats:source, reason, damage, percent});
          }
        }
        const wishSource = victimMk ? healingWishSourceByMon[victimMk] : null;
        if(wishSource && wishSource.side !== slots[slot].side && (!killerStats || wishSource !== killerStats)) candidates.set(wishSource.id, {stats:wishSource, reason:'Healing Wish', damage:0, percent:0});
        const revivalSource = victimMk ? revivalSourceByMon[victimMk] : null;
        if(revivalSource && revivalSource.side !== slots[slot].side && (!killerStats || revivalSource !== killerStats)) candidates.set(revivalSource.id, {stats:revivalSource, reason:'Revival Blessing', damage:0, percent:0});
        for(const entry of candidates.values()){
          const assistStats = entry.stats;
          assistStats.assists = (Number(assistStats.assists)||0) + 1;
          if(!Array.isArray(assistStats.assistLog)) assistStats.assistLog = [];
          assistStats.assistLog.push({
            replayId, turn: currentTurn, victim: deadStats ? deadStats.species : slots[slot].species,
            damage: Number(entry.damage)||0, percent: Number(entry.percent)||0, killer: killerStats ? killerStats.species : null, cause: entry.reason
          });
        }
        if(victimMk) delete damageContributors[victimMk];
        delete lastAttacker[slot];
        delete pendingDelayedHit[slot];
      }
    }

    // Resolve the final turn's paralysis outcome as well. A paralyzed Pokémon
    // that successfully acted gets +1 luck; one that lost its action to full
    // paralysis gets -1. Switching is neither lucky nor unlucky here.
    if(currentTurn > 0){
      for(const slot of Object.keys(turnActivity)){
        const mk = monKey(slot);
        if(!mk || currentMajorStatus[mk] !== 'par') continue;
        const side = sideOf(slot);
        if(turnActivity[slot] === 'move') luck[side].paralysisDodges += 1;
        else if(turnActivity[slot] === 'cant') luck[side].fullParalysis += 1;
      }
    }
    // If the battle ended while a Pokémon was still asleep/frozen, finalize the
    // duration so the stored luck summary still records how many turns the status lasted.
    for(const mk of Object.keys(sleeping)) finalizeStatusDuration(mk, 'slp');
    for(const mk of Object.keys(frozen)) finalizeStatusDuration(mk, 'frz');
    finalizePendingStatusChecks();

    // Collapse battle stints back to league-level Pokémon identities only after
    // parsing is complete. This prevents Illusion/Transform/form changes/switches
    // and duplicate species from contaminating attribution while the replay is
    // being processed.
    const aggregatedMons = {};
    for(const stint of Object.values(mons)){
      const species = canonicalBattleSpecies(stint.species);
      const key = stint.side + '|' + normName(species);
      if(!aggregatedMons[key]){
        aggregatedMons[key] = Object.assign({}, stint, {
          id:key, species, appearances:1, moves:{...(stint.moves||{})}, killLog:[...(stint.killLog||[])], deathLog:[...(stint.deathLog||[])], assistLog:[...(stint.assistLog||[])],
          switches:Number(stint.switches||0), leads:Number(stint.leads||0), directDamage:Number(stint.directDamage||0), indirectDamage:Number(stint.indirectDamage||0),
          totalHpAvailable:Number(stint.totalHpAvailable||0), initialHp:Number(stint.initialHp||100)
        });
      } else {
        const out = aggregatedMons[key];
        out.damageDealt += Number(stint.damageDealt||0);
        out.damageTaken += Number(stint.damageTaken||0);
        out.kills += Number(stint.kills||0);
        out.deaths += Number(stint.deaths||0);
        out.assists += Number(stint.assists||0);
        out.switches += Number(stint.switches||0); out.leads += Number(stint.leads||0);
        out.directDamage += Number(stint.directDamage||0); out.indirectDamage += Number(stint.indirectDamage||0);
        out.totalHpAvailable += Number(stint.totalHpAvailable||0);
        out.killLog.push(...(stint.killLog||[]));
        out.deathLog.push(...(stint.deathLog||[]));
        out.assistLog.push(...(stint.assistLog||[]));
        for(const [mv,count] of Object.entries(stint.moves||{})) out.moves[mv]=(out.moves[mv]||0)+Number(count||0);
        if(Number.isFinite(stint.maxHpObserved)) out.maxHpObserved=Math.max(out.maxHpObserved||0,stint.maxHpObserved);
      }
    }
    // Final parser invariant: total damage must equal direct + indirect.
    // This also repairs records produced by an older parser version when one of
    // the new buckets was missing, without changing the underlying K/D/A logs.
    for(const m of Object.values(aggregatedMons)){
      const direct = Number(m.directDamage)||0;
      const indirect = Number(m.indirectDamage)||0;
      const total = Number(m.damageDealt)||0;
      if(direct + indirect > 0) m.damageDealt = direct + indirect;
      else if(total > 0){
        // Legacy replay: retain total damage until it is explicitly reprocessed.
        m.directDamage = total;
        m.indirectDamage = 0;
      }
    }

    const aggregatedLuckPokemon = {};
    for(const [mk,l] of Object.entries(luckPokemon)){
      const species=canonicalBattleSpecies(l.species || mk.split('|')[1] || '');
      if(!species) continue;
      const side=String(mk).split('|')[0];
      const key=side+'|'+normName(species);
      if(!aggregatedLuckPokemon[key]) aggregatedLuckPokemon[key]=Object.assign({species}, newLuckSide());
      const out=aggregatedLuckPokemon[key];
      for(const k of ['crits','critLuck','dodges','moveDodgeLuck','lowAccuracyHits','lowAccuracyHitLuck','lowAccuracyDodges','statusDodgeLuck','secondaryProcs','secondaryLuck','secondaryDodges','secondaryDodgeLuck','flinches','flinchLuck','confusionSelfHits','confusionLuck','protectSuccesses','protectLuck','fullParalysis','paralysisDodgeLuck','paralysisDodges','sleepTurns','sleepEvents','sleepDurationLuck','freezeTurns','freezeEvents','freezeDurationLuck']) out[k]+=Number(l[k]||0);
      out.luckEvents.push(...(l.luckEvents||[]));
    }
    return { parserVersion: 5, id: replayId, format: json.formatid || json.format || '', uploadtime: json.uploadtime || null,
      players, mons:aggregatedMons, winner, teamRoster, luck, luckPokemon:aggregatedLuckPokemon,
      };
  }
  SBL.replays.parseLog=parseLog;
  SBL.replays.ensureMoveAccuracyData=ensureMoveAccuracyData;
  // Test-only hook: regression tests can inject a small Showdown move-data map
  // without depending on the network. Production code never calls this.
  SBL.replays.__setMoveDataForTests = data => { MOVE_DATA = data || {}; MOVE_ACCURACY_PROMISE = Promise.resolve(MOVE_DATA); };
  SBL.replays.canonicalBattleSpecies=canonicalBattleSpecies;
})();
