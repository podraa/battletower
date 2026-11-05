/* Pure helpers for the per-user draft dashboard (no DOM, no network).
 * Budget math, the "reserve points for the rest of your roster" spend limit,
 * and the pool filter/sort used by draft.html. */
(function(){
  'use strict';
  window.SBL = window.SBL || {};
  const key = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function budgetInfo(d, team){
    const picks = (d.picks || []).filter(p => key(p.team) === key(team));
    const budgetKey = Object.keys(d.budgets || {}).find(k => key(k) === key(team));
    const total = Number((budgetKey == null ? d.defaultBudget : d.budgets[budgetKey])) || 0;
    const spent = picks.reduce((n, p) => n + (Number(p.points) || 0), 0);
    const minPicks = Number(d.minPicks) || 0, maxPicks = Number(d.maxPicks) || 0;
    return {
      total, spent, left: total - spent, picks: picks.length, minPicks, maxPicks,
      need: Math.max(0, minPicks - picks.length),      // picks still required
      room: Math.max(0, maxPicks - picks.length)       // picks still allowed
    };
  }

  function minPoolCost(d){
    const costs = (d.pool || []).filter(m => !m.drafted).map(m => Number(m.points) || 0);
    return costs.length ? Math.min(...costs) : 0;
  }

  /* The most a single pick may cost while still leaving enough points to fill
   * the remaining required roster slots at the cheapest available price. */
  function spendLimit(d, team){
    const b = budgetInfo(d, team);
    const reserve = Math.max(0, b.need - 1) * minPoolCost(d);
    return b.left - reserve;
  }

  function canAfford(d, team, mon){
    const b = budgetInfo(d, team);
    return b.room > 0 && (Number(mon.points) || 0) <= spendLimit(d, team);
  }

  const STAT_ALIASES = {
    hp: ['hp'], atk: ['atk','attack'], def: ['def','defense'],
    spa: ['spa','specialattack','spatk','spattack'],
    spd: ['spd','specialdefense','spdef','spdefense'],
    spe: ['spe','speed']
  };
  function statValue(mon, stat){
    const sources = [mon?.baseStats, mon?.stats].filter(x=>x&&typeof x==='object');
    if(!sources.length) return null;
    const aliases = STAT_ALIASES[stat] || [String(stat||'').toLowerCase().replace(/[^a-z]/g,'')];
    for(const source of sources){
      const entries = Object.entries(source).map(([k,v]) => [String(k).toLowerCase().replace(/[^a-z]/g,''), v]);
      for(const alias of aliases){
        const found = entries.find(([k]) => k === alias);
        if(found && found[1] != null && found[1] !== '' && Number.isFinite(Number(found[1]))) return Number(found[1]);
      }
      // Some imported sources store the six stats in the canonical PokeAPI order.
      if(Array.isArray(source)){
        const idx = ({hp:0,atk:1,def:2,spa:3,spd:4,spe:5})[stat];
        const value = source[idx]?.base_stat ?? source[idx]?.value ?? source[idx];
        if(value != null && Number.isFinite(Number(value))) return Number(value);
      }
    }
    return null;
  }

  function allTypes(pool){
    const set = new Set();
    (pool || []).forEach(m => (m.types || []).forEach(t => t && set.add(String(t))));
    return [...set].sort();
  }

  function applyFilters(d, team, f, queueIds){
    const q = key(f.q), types = (f.types || []).map(t => t.toLowerCase()), ability=key(f.ability||'');
    const statKey=String(f.stat||'').trim();
    const minStat=f.statMin===''||f.statMin==null?null:Number(f.statMin);
    const maxStat=f.statMax===''||f.statMax==null?null:Number(f.statMax);
    const minP = f.minPts === '' || f.minPts == null ? null : Number(f.minPts);
    const maxP = f.maxPts === '' || f.maxPts == null ? null : Number(f.maxPts);
    const queued = new Set((queueIds || []).map(String));
    return (d.pool || []).filter(m => {
      if (m.drafted && !f.showDrafted) return false;
      const mega=!!m.isMega || !!window.SBL?.pokemon?.isMega?.(m.name);
      if(f.mega==='mega'&&!mega) return false;
      if(f.mega==='standard'&&mega) return false;
      if (q && !key(m.name).includes(q)) return false;
      if (types.length && !(m.types || []).some(t => types.includes(String(t).toLowerCase()))) return false;
      if (ability && !(m.abilities||[]).some(a=>key(a).includes(ability))) return false;
      if(statKey&&(minStat!=null&&!Number.isNaN(minStat)||maxStat!=null&&!Number.isNaN(maxStat))){
        const value=statValue(m,statKey);
        if(value==null)return false;
        if(minStat!=null&&!Number.isNaN(minStat)&&value<minStat)return false;
        if(maxStat!=null&&!Number.isNaN(maxStat)&&value>maxStat)return false;
      }
      const pts = Number(m.points) || 0;
      if (minP != null && !Number.isNaN(minP) && pts < minP) return false;
      if (maxP != null && !Number.isNaN(maxP) && pts > maxP) return false;
      if (f.affordable && !m.drafted && !canAfford(d, team, m)) return false;
      if (f.queuedOnly && !queued.has(String(m.id))) return false;
      return true;
    });
  }

  function sortPool(list, sort){
    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    const pts = m => Number(m.points) || 0;
    const copy = list.slice();
    if (sort === 'pts-asc') return copy.sort((a, b) => pts(a) - pts(b) || byName(a, b));
    if (sort === 'name') return copy.sort(byName);
    if (sort === 'type') return copy.sort((a, b) => String((a.types || [])[0] || '~').localeCompare(String((b.types || [])[0] || '~')) || byName(a, b));
    return copy.sort((a, b) => pts(b) - pts(a) || byName(a, b)); // pts-desc
  }

  /* How many picks until this team is up (0 = on the clock), or null. */
  function picksUntil(d, team){
    if (d.mode !== 'ordered' || !team) return null;
    for (let i = d.currentPick; i < (d.order || []).length; i++) if (key(d.order[i]) === key(team)) return i - d.currentPick;
    return null;
  }

  window.SBL.draftDash = { budgetInfo, minPoolCost, spendLimit, canAfford, allTypes, statValue, applyFilters, sortPool, picksUntil };
})();
