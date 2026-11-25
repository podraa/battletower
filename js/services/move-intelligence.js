/* CP4.177: Conservative, replay-first move scouting. No move popularity guesses.
 * Consumes parsed replay ledgers and existing per-game usage, scoped by caller.
 */
(function(){
  'use strict';
  const SBL=window.SBL=window.SBL||{};
  const key=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const finite=x=>Number.isFinite(Number(x))?Number(x):0;
  const round=n=>Math.round(n*10)/10;
  function summarize(usage={},teamGames=0){
    const sets=Array.isArray(usage.gameSets)?usage.gameSets:[];
    const ledger=usage.moveDamage||{};
    const rows=new Map();
    for(const game of sets){
      for(const [name,uses] of Object.entries(game.moves||{})){
        const id=key(name);if(!id)continue;
        const row=rows.get(id)||{name,uses:0,battles:0,hits:0,medianPercent:null,totalPercent:null};
        row.uses+=Math.max(0,finite(uses));
        if(Number(uses)>0)row.battles++;
        rows.set(id,row);
      }
    }
    for(const [name,record] of Object.entries(ledger)){
      const id=key(name);if(!id)continue;
      const row=rows.get(id)||{name,uses:0,battles:0,hits:0,medianPercent:null,totalPercent:null};
      row.hits+=Math.max(0,finite(record.hits));
      if(!row.battles)row.battles=Math.max(0,finite(record.observedGames));
      if(!row.uses)row.uses=Math.max(0,finite(record.uses));
      const samples=(record.percentSamples||[]).map(Number).filter(n=>Number.isFinite(n)&&n>=0&&n<=100).sort((a,b)=>a-b);
      if(samples.length){const mid=Math.floor(samples.length/2);row.medianPercent=round(samples.length%2?samples[mid]:(samples[mid-1]+samples[mid])/2);}
      if(finite(record.percentHits)>0)row.totalPercent=round(finite(record.percentSum));
      row.critHits=Math.max(0,finite(record.critHits));
      row.targets=record.targets||{};
      rows.set(id,row);
    }
    const moves=[...rows.values()].sort((a,b)=>b.battles-a.battles||b.uses-a.uses||b.hits-a.hits||a.name.localeCompare(b.name));
    return {moves,available:Math.max(sets.length,finite(usage.appearances)),teamGames:finite(teamGames),
      indexed:moves.filter(x=>x.hits>0&&x.totalPercent!==null).length,
      sampleWarning:moves.some(x=>x.battles<=2)};
  }
  SBL.moveIntelligence={summarize};
})();
