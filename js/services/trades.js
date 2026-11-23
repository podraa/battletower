/*
 * SBL TRADES SERVICE
 *
 * Phase 4D: central trade timing/allowance logic.
 *
 * The database/RPC contract remains unchanged. Accepted trades may still be
 * written to the published roster immediately by the existing RPCs; this
 * service overlays the league's weekly effective-date rule when pages read
 * the roster. Reverted trades no longer consume an allowance.
 */
(function () {
  'use strict';
  window.SBL = window.SBL || {};
  const SBL = window.SBL;
  let tradeCache = null;
  let tradeCacheKey = '';
  let tradePromise = null;
  let tradePromiseKey = '';
  const DEFAULT_TIMING_SETTINGS = { cutoff_day: 5, cutoff_hour: 23, cutoff_minute: 59, weekday_weeks_ahead: 1, after_cutoff_weeks_ahead: 2 };
  let timingSettings = { ...DEFAULT_TIMING_SETTINGS };
  function setTimingSettings(row){ timingSettings = { ...DEFAULT_TIMING_SETTINGS, ...(row || {}) }; }
  function invalidateTradeCache(){ tradeCache = null; tradeCacheKey=''; tradePromise = null; tradePromiseKey=''; }

  function acceptedAt(trade) {
    const raw = trade?.responded_at || trade?.accepted_at || trade?.updated_at || trade?.created_at;
    const t = raw ? new Date(raw) : new Date(NaN);
    return Number.isFinite(t.getTime()) ? t : null;
  }

  function mondayStart(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    d.setDate(d.getDate() - ((day + 6) % 7));
    return d;
  }

  // League-persisted cutoff and effective-week settings. Comparisons use the
  // browser-local league timezone, matching the legacy roster schedule.
  function effectiveAt(trade) {
    const accepted = acceptedAt(trade);
    if (!accepted) return null;
    const weekMonday = mondayStart(accepted);
    const rule = { ...timingSettings, ...(trade?.timing_snapshot || {}) };
    const cutoffDay = Math.max(1, Math.min(5, Number(rule.cutoff_day) || 5));
    const cutoff = new Date(weekMonday);
    cutoff.setDate(cutoff.getDate() + cutoffDay - 1);
    cutoff.setHours(Number(rule.cutoff_hour) || 0, Number(rule.cutoff_minute) || 0, 59, 999);
    const beforeOrAtCutoff = accepted.getTime() <= cutoff.getTime();
    const weeksAhead = beforeOrAtCutoff
      ? Math.max(1, Number(rule.weekday_weeks_ahead) || 1)
      : Math.max(1, Number(rule.after_cutoff_weeks_ahead) || 2);
    const effective = new Date(weekMonday);
    effective.setDate(effective.getDate() + weeksAhead * 7);
    return effective;
  }

  async function loadTimingSettings(client){
    const db=client||SBL.getSupabase();
    const leagueId=SBL.leagueDb?.selectedLeagueId?.()||'';
    if(!leagueId){ setTimingSettings(null); return timingSettings; }
    const {data,error}=await db.from('league_trade_timing_settings').select('*').eq('league_id',leagueId).maybeSingle();
    if(error && error.code!=='42P01') throw error;
    setTimingSettings(error?null:data||null);
    return timingSettings;
  }

  function isAccepted(trade) {
    return String(trade?.status || '').toLowerCase() === 'accepted';
  }

  function isActive(trade, now = new Date()) {
    if (!isAccepted(trade)) return false;
    const when = effectiveAt(trade);
    return !!when && when.getTime() <= new Date(now).getTime();
  }

  function isScheduled(trade, now = new Date()) {
    return isAccepted(trade) && !isActive(trade, now);
  }

  function formatEffectiveDate(trade, locale = undefined) {
    const d = effectiveAt(trade);
    return d ? d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }) : '—';
  }

  function key(name) {
    if (SBL.pokemon?.normalizeName) return SBL.pokemon.normalizeName(name).replace(/-/g, '');
    return String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function cloneRosters(rosters) {
    const out = {};
    for (const [team, list] of Object.entries(rosters || {})) {
      out[team] = (Array.isArray(list) ? list : []).map(m => {
        if (typeof m === 'string') return { name: m, points: null };
        return { ...m, name: String(m?.name ?? '').trim() };
      }).filter(m => m.name);
    }
    return out;
  }

  function removeOne(list, name) {
    const target = key(name);
    const idx = list.findIndex(m => key(m?.name) === target);
    return idx >= 0 ? list.splice(idx, 1)[0] : null;
  }

  function addIfMissing(list, mon) {
    if (!mon?.name) return;
    if (!list.some(m => key(m?.name) === key(mon.name))) list.push({ ...mon });
  }

  function futureAcceptedTrades(trades, now = new Date()) {
    return (Array.isArray(trades) ? trades : [])
      .filter(t => isScheduled(t, now))
      .sort((a, b) => acceptedAt(b)?.getTime() - acceptedAt(a)?.getTime());
  }

  // Accepted RPCs historically update __dashboard_state__.settings.rosters
  // immediately. To honour the league timing rule without changing the DB,
  // reverse only future-effective accepted trades when pages read the roster.
  function getEffectiveRosters(rawRosters, trades, now = new Date()) {
    const out = cloneRosters(rawRosters);
    for (const trade of futureAcceptedTrades(trades, now)) {
      const proposer = String(trade.proposer_team || '').trim();
      const target = trade.target_team == null ? null : String(trade.target_team || '').trim();
      if (!proposer || !out[proposer]) continue;

      const offered = Array.isArray(trade.mons_offered) ? trade.mons_offered : [];
      const requested = Array.isArray(trade.mons_requested) ? trade.mons_requested : [];

      if (target && out[target]) {
        const removedOffered = [];
        const removedRequested = [];
        for (const name of offered) {
          const mon = removeOne(out[target], name);
          if (mon) removedOffered.push(mon);
        }
        for (const name of requested) {
          const mon = removeOne(out[proposer], name);
          if (mon) removedRequested.push(mon);
        }
        for (const mon of removedOffered) addIfMissing(out[proposer], mon);
        for (const mon of removedRequested) addIfMissing(out[target], mon);
      } else {
        // Free Agency pickup: the accepted pickup is not roster-effective yet.
        for (const name of requested) removeOne(out[proposer], name);
      }
    }
    return out;
  }

  function restoreFutureFreeAgencyPool(pool, rawRosters, trades, now = new Date()) {
    const out = Array.isArray(pool) ? pool.map(x => typeof x === 'string' ? {name:x, points:null} : {...x}) : [];
    const have = new Set(out.map(m => key(m?.name)));
    for (const trade of futureAcceptedTrades(trades, now)) {
      if (trade.target_team != null) continue;
      const requested = Array.isArray(trade.mons_requested) ? trade.mons_requested : [];
      for (const name of requested) {
        if (have.has(key(name))) continue;
        let found = null;
        for (const list of Object.values(rawRosters || {})) {
          found = (Array.isArray(list) ? list : []).find(m => key(typeof m === 'string' ? m : m?.name) === key(name));
          if (found) break;
        }
        const item = typeof found === 'string' ? {name:found, points:null} : (found ? {...found} : {name, points:null});
        out.push(item);
        have.add(key(name));
      }
    }
    return out;
  }

  function consumedCount(trades, team, kind = 'team', season = null) {
    return (Array.isArray(trades) ? trades : []).filter(t => {
      if (!isAccepted(t)) return false; // reverted trades restore the allowance
      if (season != null && Number(t.season ?? new Date(t.created_at).getFullYear()) !== Number(season)) return false;
      if (kind === 'freeagency') return t.target_team == null && t.proposer_team === team;
      return t.target_team != null && (t.proposer_team === team || t.target_team === team);
    }).length;
  }

  function allowance(trades, team, limit = 8, kind = 'team', season = null, bonusCredits = 0) {
    const used = consumedCount(trades, team, kind, season);
    const total = Math.max(0, Number(limit) || 0) + Math.max(0, Number(bonusCredits) || 0);
    return { limit: Math.max(0, Number(limit) || 0), used, credits: Math.max(0, Number(bonusCredits) || 0), remaining: Math.max(0, total - used) };
  }

  async function load(client, options = {}) {
    const db = client || SBL.getSupabase();
    const leagueId = SBL.leagueDb?.selectedLeagueId?.() || '';
    const seasonId = SBL.leagueDb?.selectedSeasonId?.() || '';
    if (options?.force) invalidateTradeCache();
    const cacheKey=`${leagueId||'legacy'}|${seasonId||''}`;
    if (tradeCache && tradeCacheKey===cacheKey) return { data: tradeCache, error: null };
    if (tradePromise && tradePromiseKey===cacheKey) return { data: await tradePromise, error: null };
    tradePromiseKey=cacheKey;
    tradePromise = (async () => {
      await loadTimingSettings(db);
      let query = db.from('trade_requests').select('*').order('created_at', { ascending: false });
      if (leagueId) query = query.eq('league_id', leagueId);
      if (seasonId) query = query.or(`season_id.is.null,season_id.eq.${seasonId}`);
      const { data, error } = await query;
      if (error) throw error;
      tradeCache = data || [];
      tradeCacheKey=cacheKey;
      return tradeCache;
    })();
    try { return { data: await tradePromise, error: null }; } finally { tradePromise = null; }
  }

  async function create(payload, client) {
    const db = client || SBL.getSupabase();
    const leagueId = SBL.leagueDb?.selectedLeagueId?.() || '';
    const seasonId = SBL.leagueDb?.selectedSeasonId?.() || null;
    const row = Object.assign({}, payload || {});
    if (leagueId) row.league_id = leagueId;
    if (seasonId) row.season_id = seasonId;
    if(!leagueId||!seasonId)throw new Error('Select an active league and season before proposing a trade.');
    const {data,error}=await db.rpc('sbl_propose_trade',{
      p_league_id:leagueId,p_season_id:seasonId,p_target_team:row.target_team??null,
      p_mons_offered:row.mons_offered||[],p_mons_requested:row.mons_requested||[]
    });
    if (error) throw error;
    invalidateTradeCache();
    return data || null;
  }

  async function respond(id,status,userId,client){
    const db=client||SBL.getSupabase();
    const {data,error}=await db.rpc('sbl_respond_trade',{p_trade_id:id,p_status:status});
    if(error)throw error;
    invalidateTradeCache();
    return data||null;
  }

  async function accept(id, client) {
    const db = client || SBL.getSupabase();
    const { data, error } = await db.rpc('accept_trade', { trade_id: id });
    if (error) throw error;
    invalidateTradeCache();
    return data;
  }

  async function acceptFreeAgency(id, client) {
    const db = client || SBL.getSupabase();
    const { data, error } = await db.rpc('commissioner_accept_free_agency_trade', { trade_id: id });
    if (error) throw error;
    invalidateTradeCache();
    return data;
  }

  async function revert(id, client, action='revert') {
    const db = client || SBL.getSupabase();
    const { data, error } = await db.rpc('sbl_commissioner_trade_reversal', { p_trade_id: id, p_action: action });
    if (error) throw error;
    invalidateTradeCache();
    return data;
  }

  async function setLimits(teamName, teamLimit, freeAgencyLimit, client) {
    const db = client || SBL.getSupabase();
    const leagueId=SBL.leagueDb?.selectedLeagueId?.();
    if(leagueId){
      const seasonId=SBL.leagueDb?.selectedSeasonId?.()||null;
      const season=new Date().getFullYear();
      const values={league_id:leagueId,season_id:seasonId,season,team_name:String(teamName||'').trim(),team_trade_limit:Number(teamLimit)||0,free_agency_trade_limit:Number(freeAgencyLimit)||0};
      let result=await db.from('franchise_trade_limits').update(values).eq('league_id',leagueId).eq('season',season).eq('team_name',values.team_name).select('*').maybeSingle();
      if(result.error) throw result.error;
      if(!result.data) result=await db.from('franchise_trade_limits').insert(values).select('*').maybeSingle();
      if(result.error) throw result.error;
      invalidateTradeCache();
      return result.data;
    }
    const { data, error } = await db.rpc('commissioner_set_trade_limits', {
      p_team_name: teamName,
      p_team_trade_limit: teamLimit,
      p_free_agency_trade_limit: freeAgencyLimit
    });
    if (error) throw error;
    invalidateTradeCache();
    return data;
  }

  // CP4.168: all roster/FA consumers must project the same transaction-effective
  // state. No page may treat a stale FA pool entry as available if it is owned.
  // Historical/archived season views must pass {archived:true} and never have
  // current trade rows retroactively applied to a finished season.
  function projectRosterState(settings, trades, options={}) {
    const source=settings&&typeof settings==='object'?settings:{};
    const raw=cloneRosters(source.rosters||{});
    const active=options.archived ? raw : getEffectiveRosters(raw,trades||[],options.now||new Date());
    const originalPool=Array.isArray(source.freeAgency?.mons)?source.freeAgency.mons:[];
    const pool=options.archived ? originalPool.slice() : restoreFutureFreeAgencyPool(originalPool,raw,trades||[],options.now||new Date());
    const owned=new Map();
    const conflicts=[];
    for(const [team,mons] of Object.entries(active)) {
      for(const mon of mons){
        const species=typeof mon==='string'?mon:mon?.name;
        const id=key(species);
        if(!id)continue;
        if(owned.has(id)&&owned.get(id)!==team)conflicts.push({species,teams:[owned.get(id),team]});
        else owned.set(id,team);
      }
    }
    // Filter AFTER effective ownership is resolved; never return a drafted
    // Pokémon as available just because settings.freeAgency.mons is stale.
    const seen=new Set();
    const available=pool.filter(mon=>{
      const id=key(typeof mon==='string'?mon:mon?.name);
      if(!id||seen.has(id)||owned.has(id))return false;
      seen.add(id); return true;
    });
    return {rosters:active, available, owned, conflicts};
  }
  function sortedPokemon(list) {
    return (Array.isArray(list)?list:[]).slice().sort((a,b)=>{
      const name=x=>String(typeof x==='string'?x:x?.name||'').trim();
      return name(a).localeCompare(name(b),undefined,{numeric:true,sensitivity:'base'});
    });
  }
  function filterPokemon(list,query='',options={}) {
    const q=String(query||'').trim().toLowerCase();
    const min=options.minPoints==null||options.minPoints===''?null:Number(options.minPoints);
    const max=options.maxPoints==null||options.maxPoints===''?null:Number(options.maxPoints);
    return sortedPokemon(list).filter(mon=>{
      const name=typeof mon==='string'?mon:mon?.name||'';
      const pts=typeof mon==='string'?NaN:Number(mon?.points);
      return (!q||String(name).toLowerCase().includes(q)) &&
        (min===null||(Number.isFinite(pts)&&pts>=min)) &&
        (max===null||(Number.isFinite(pts)&&pts<=max));
    });
  }

  SBL.services = SBL.services || {};
  SBL.services.trades = {
    load,
    loadTimingSettings,
    timingSettings: () => ({ ...timingSettings }),
    create,
    respond,
    accept,
    acceptFreeAgency,
    revert,
    setLimits,
    acceptedAt,
    effectiveAt,
    isAccepted,
    isActive,
    isScheduled,
    formatEffectiveDate,
    getEffectiveRosters,
    restoreFutureFreeAgencyPool,
    projectRosterState,
    sortedPokemon,
    filterPokemon,
    futureAcceptedTrades,
    consumedCount,
    allowance,
    invalidateCache: invalidateTradeCache,
    clearCache: invalidateTradeCache
  };
  SBL.trades = SBL.services.trades;
})();
