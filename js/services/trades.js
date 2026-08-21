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
  let tradePromise = null;
  function invalidateTradeCache(){ tradeCache = null; tradePromise = null; }

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

  // Friday 23:59:59 is the weekly cutoff. Saturday/Sunday acceptance misses
  // the following Monday and therefore waits one additional week.
  function effectiveAt(trade) {
    const accepted = acceptedAt(trade);
    if (!accepted) return null;
    const weekMonday = mondayStart(accepted);
    const day = accepted.getDay(); // Sun=0, Mon=1 ... Fri=5, Sat=6
    const weeksAhead = (day === 0 || day === 6) ? 2 : 1;
    const effective = new Date(weekMonday);
    effective.setDate(effective.getDate() + weeksAhead * 7);
    return effective;
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
    if (options?.force) invalidateTradeCache();
    if (tradeCache) return { data: tradeCache, error: null };
    if (tradePromise) return { data: await tradePromise, error: null };
    tradePromise = (async () => {
      const { data, error } = await db.from('trade_requests').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      tradeCache = data || [];
      return tradeCache;
    })();
    try { return { data: await tradePromise, error: null }; } finally { tradePromise = null; }
  }

  async function create(payload, client) {
    const db = client || SBL.getSupabase();
    const { data, error } = await db.from('trade_requests').insert(payload).select('*').maybeSingle();
    if (error) throw error;
    invalidateTradeCache();
    return data || null;
  }

  async function respond(id, status, userId, client) {
    const db = client || SBL.getSupabase();
    const { data, error } = await db.from('trade_requests')
      .update({
        status,
        responded_at: new Date().toISOString(),
        responded_by: userId || null
      })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    invalidateTradeCache();
    return data || null;
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

  async function revert(id, client) {
    const db = client || SBL.getSupabase();
    const { data, error } = await db.rpc('commissioner_revert_trade', { trade_id: id });
    if (error) throw error;
    invalidateTradeCache();
    return data;
  }

  async function setLimits(teamName, teamLimit, freeAgencyLimit, client) {
    const db = client || SBL.getSupabase();
    const { data, error } = await db.rpc('commissioner_set_trade_limits', {
      p_team_name: teamName,
      p_team_trade_limit: teamLimit,
      p_free_agency_trade_limit: freeAgencyLimit
    });
    if (error) throw error;
    invalidateTradeCache();
    return data;
  }

  SBL.services = SBL.services || {};
  SBL.services.trades = {
    load,
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
    futureAcceptedTrades,
    consumedCount,
    allowance,
    invalidateCache: invalidateTradeCache,
    clearCache: invalidateTradeCache
  };
  SBL.trades = SBL.services.trades;
})();
