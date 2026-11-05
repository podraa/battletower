/* Draft lottery: pure logic, no DOM and no database access.
 *
 * Model
 *   proposed : franchise names, slot 1 first. Slot 1 = best lottery odds
 *              (the worst record last season). The admin types this in.
 *   weights  : one positive number per slot. A franchise's chance at each
 *              lottery pick is its weight / (sum of weights still in the draw).
 *   picks    : how many picks are drawn (1..N). Everyone not drawn keeps
 *              their proposed order after the drawn picks (worst record first).
 *   seed     : the draw is fully determined by the seed, so anyone can re-run
 *              it and confirm the published result (see verify()).
 *
 * Stored on the draft state as draft.lottery:
 *   { status:'setup'|'drawn'|'applied', proposed, weights, preset, picks,
 *     seed, drawnAt, result, revealed, appliedAt }
 *   `revealed` counts how many drawn picks the commissioner has revealed,
 *   counting down from the last drawn pick to pick 1.
 */
(function(){
  'use strict';

  const PRESETS = {
    flat:   { label:'Flat (everyone equal)',          make:n => Array.from({length:n},()=>1) },
    gentle: { label:'Gentle (worst record favoured)',  make:n => Array.from({length:n},(_,i)=>n-i) },
    top:    { label:'Top-heavy (NBA-style)',           make:n => Array.from({length:n},(_,i)=> i<3 ? 140 : Math.max(5,Math.round(140*Math.pow(0.85,i-2)))) }
  };

  function presetWeights(preset,n){ return (PRESETS[preset]||PRESETS.gentle).make(n); }

  /* ---- seeded randomness ------------------------------------------------ */
  function hashSeed(str){
    let h = 1779033703 ^ String(str).length;
    for(const c of String(str)){ h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function rngFrom(seed){            // mulberry32
    let a = hashSeed(seed);
    return function(){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function newSeed(){
    try{
      const b = new Uint32Array(2); (globalThis.crypto || window.crypto).getRandomValues(b);
      return b[0].toString(36) + b[1].toString(36);
    }catch(_){ return Date.now().toString(36) + Math.random().toString(36).slice(2); }
  }

  /* ---- config ------------------------------------------------------------ */
  function normalize(l, franchises){
    const x = Object.assign({ status:'setup', proposed:[], weights:[], preset:'gentle', picks:0,
      seed:'', drawnAt:null, result:[], revealed:0, appliedAt:null }, l || {});
    x.proposed = Array.isArray(x.proposed) ? x.proposed.map(String) : [];
    if(!x.proposed.length && Array.isArray(franchises)) x.proposed = franchises.slice();
    const n = x.proposed.length;
    x.weights = Array.isArray(x.weights) ? x.weights.map(Number) : [];
    if(x.weights.length !== n || x.weights.some(w => !(w > 0))) x.weights = presetWeights(x.preset === 'custom' ? 'gentle' : x.preset, n);
    x.picks = Math.min(n, Math.max(0, Math.floor(Number(x.picks) || 0))) || n;
    x.result = Array.isArray(x.result) ? x.result.map(String) : [];
    x.revealed = Math.max(0, Math.min(n, Math.floor(Number(x.revealed) || 0)));
    if(!['setup','drawn','applied'].includes(x.status)) x.status = 'setup';
    return x;
  }

  /* Returns a list of human-readable problems; empty list = ready to draw. */
  function validate(l, franchises){
    const errs = [];
    const p = l.proposed || [];
    if(p.length < 2) errs.push('Add at least two franchises to the proposed order.');
    const seen = new Set();
    for(const t of p){ if(seen.has(t.toLowerCase())) errs.push('"' + t + '" appears more than once.'); seen.add(t.toLowerCase()); }
    if(Array.isArray(franchises) && franchises.length){
      const known = new Set(franchises.map(f => f.toLowerCase()));
      p.filter(t => !known.has(t.toLowerCase())).forEach(t => errs.push('"' + t + '" is not a franchise in this league.'));
      const have = new Set(p.map(t => t.toLowerCase()));
      franchises.filter(f => !have.has(f.toLowerCase())).forEach(f => errs.push('"' + f + '" is missing from the proposed order.'));
    }
    if((l.weights || []).length !== p.length || l.weights.some(w => !(w > 0))) errs.push('Every slot needs a weight greater than 0.');
    if(!(l.picks >= 1 && l.picks <= p.length)) errs.push('Lottery picks must be between 1 and ' + p.length + '.');
    return errs;
  }

  /* ---- the draw ---------------------------------------------------------- */
  function draw(l, seed){
    const n = l.proposed.length, K = Math.min(n, l.picks || n), rnd = rngFrom(seed);
    const left = l.proposed.map((team,i) => ({ team, w:l.weights[i], slot:i }));
    const result = [];
    for(let p = 0; p < K; p++){
      const total = left.reduce((s,e) => s + e.w, 0);
      let r = rnd() * total, idx = 0;
      for(; idx < left.length - 1; idx++){ r -= left[idx].w; if(r < 0) break; }
      result.push(left[idx].team); left.splice(idx, 1);
    }
    left.sort((a,b) => a.slot - b.slot).forEach(e => result.push(e.team));
    return result;
  }

  function run(l, seed){
    const s = seed || newSeed();
    return Object.assign({}, l, { seed:s, result:draw(l, s), revealed:0, status:'drawn', drawnAt:new Date().toISOString() });
  }

  /* Anyone can re-run the published seed and compare. */
  function verify(l){
    if(!l || !l.seed || !l.result || !l.result.length) return false;
    const again = draw(l, l.seed);
    return again.length === l.result.length && again.every((t,i) => t === l.result[i]);
  }

  /* ---- odds matrix: odds[team index (proposed order)][pick index] ---------- */
  function odds(l){
    const n = l.proposed.length, K = Math.min(n, l.picks || n), w = l.weights;
    const out = Array.from({length:n}, () => new Array(n).fill(0));
    if(n <= 16){
      const size = 1 << n, prob = new Float64Array(size), pop = new Uint8Array(size);
      for(let m = 1; m < size; m++) pop[m] = pop[m >> 1] + (m & 1);
      prob[0] = 1;
      for(let m = 0; m < size; m++){
        if(!prob[m] || pop[m] >= K) continue;
        let tot = 0; for(let i = 0; i < n; i++) if(!(m & (1 << i))) tot += w[i];
        for(let i = 0; i < n; i++){
          if(m & (1 << i)) continue;
          const pr = prob[m] * w[i] / tot;
          prob[m | (1 << i)] += pr;
          out[i][pop[m]] += pr;               // team i takes pick (pop[m] + 1)
        }
      }
      for(let m = 0; m < size; m++){          // not-drawn teams keep proposed order
        if(pop[m] !== K || !prob[m]) continue;
        let slot = K;
        for(let i = 0; i < n; i++) if(!(m & (1 << i))) out[i][slot++] += prob[m];
      }
      return out;
    }
    const runs = 20000, rnd = rngFrom('odds-estimate');   // large leagues: estimate
    const idx = new Map(l.proposed.map((t,i) => [t,i]));
    for(let r = 0; r < runs; r++){
      const order = draw(l, 'e' + r + ':' + Math.floor(rnd() * 1e9));
      order.forEach((t,p) => { out[idx.get(t)][p] += 1 / runs; });
    }
    return out;
  }

  /* ---- reveal state ----------------------------------------------------------
   * Picks are revealed K, K-1, ... 1. Once every drawn pick is out, the rest of
   * the order is shown too (it would give away who was not drawn earlier).      */
  function visiblePicks(l){
    const K = Math.min(l.result.length, l.picks), n = l.result.length;
    const vis = new Array(n).fill(false);
    if(l.status === 'setup' || !n) return vis;
    // Reveal lottery-drawn picks from the bottom up first (K, K-1 ... 1).
    // Then reveal the remaining non-drawn positions one at a time as well;
    // never expose the whole order merely because the lottery picks are done.
    const count=Math.max(0,Math.min(n,Math.floor(Number(l.revealed)||0)));
    for(let r=0;r<Math.min(count,K);r++) vis[K-1-r]=true;
    for(let r=K;r<count;r++) vis[r]=true;
    return vis;
  }

  /* ---- bridge to the draft order --------------------------------------------- */
  function buildOrder(roundOne, rounds, snake){
    const out = [];
    for(let r = 0; r < rounds; r++) out.push(...((snake && r % 2 === 1) ? roundOne.slice().reverse() : roundOne));
    return out;
  }

  /* Draft board rows: one per round, each slot { pickNumber, team, pick|null }. */
  function boardRows(order, picks, perRound){
    const byNo = new Map((picks || []).filter(p => p.pickNumber).map(p => [Number(p.pickNumber), p]));
    const rows = [];
    for(let i = 0; i < order.length; i += perRound){
      rows.push(order.slice(i, i + perRound).map((team, j) => {
        const no = i + j + 1; return { pickNumber:no, team, pick:byNo.get(no) || null };
      }));
    }
    return rows;
  }

  window.SBL = window.SBL || {};
  window.SBL.draftLottery = { PRESETS, presetWeights, normalize, validate, newSeed, draw, run, verify, odds, visiblePicks, buildOrder, boardRows };
})();
