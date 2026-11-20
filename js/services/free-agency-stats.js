/* Form-aware Free Agency stat resolver. Draft-pool persisted stats are the
 * primary source; Showdown Pokedex is an exact-form fallback only. */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  function createResolver({pokemon,draftDash,pool=[],dex={}}={}){
    let currentPool=Array.isArray(pool)?pool:[];
    let currentDex=dex&&typeof dex==='object'?dex:{};
    let poolIndex=new Map(), statCache=new Map(), resolvedCache=new Map();
    function ids(name){return pokemon?.showdownStatsIdCandidates?.(name)||[String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'')];}
    function sameForm(a,b){
      if(pokemon?.sameSpeciesForm?.(a,b)) return true;
      const aa=ids(a),bb=new Set(ids(b)); return aa.some(x=>bb.has(x));
    }
    function indexPool(){
      poolIndex=new Map();
      currentPool.forEach(entry=>{if(!entry)return; for(const id of ids(entry.name)) if(!poolIndex.has(id))poolIndex.set(id,entry);});
      statCache.clear(); resolvedCache.clear();
    }
    function poolEntry(monOrName){
      const name=typeof monOrName==='string'?monOrName:monOrName?.name;
      for(const id of ids(name)) if(poolIndex.has(id)) return poolIndex.get(id);
      // Preserve form-aware matching for unusual aliases not represented by IDs.
      return currentPool.find(entry=>entry&&sameForm(entry.name,name))||null;
    }
    function exactDexEntry(name){
      const dexData=currentDex?.pokedex||currentDex||{};
      for(const id of ids(name)) if(dexData[id]) return dexData[id];
      return null;
    }
    function resolve(monOrName){
      const name=typeof monOrName==='string'?monOrName:monOrName?.name;
      const cacheKey=ids(name)[0]||String(name||'');
      if(resolvedCache.has(cacheKey)) return resolvedCache.get(cacheKey);
      const entry=poolEntry(name),dexEntry=exactDexEntry(name);
      const value=!entry?dexEntry:!dexEntry?entry:{...dexEntry,...entry,baseStats:{...(dexEntry.baseStats||{}),...(entry.stats||{}),...(entry.baseStats||{})}};
      resolvedCache.set(cacheKey,value||null); return value||null;
    }
    function statValue(monOrName,stat){
      const name=typeof monOrName==='string'?monOrName:monOrName?.name;
      const cacheKey=`${ids(name)[0]||String(name||'')}|${stat}`;
      if(statCache.has(cacheKey)) return statCache.get(cacheKey);
      const entry=resolve(monOrName),value=entry?draftDash?.statValue?.(entry,stat)??null:null;
      statCache.set(cacheKey,value); return value;
    }
    function matches(mon,stat,min,max){
      if(!stat || (min===''||min==null) && (max===''||max==null)) return true;
      const value=statValue(mon,stat);
      if(value==null||!Number.isFinite(Number(value))) return false;
      return (min===''||min==null||Number.isNaN(Number(min))||Number(value)>=Number(min)) &&
             (max===''||max==null||Number.isNaN(Number(max))||Number(value)<=Number(max));
    }
    function filterPool(mons,stat,min,max){return (Array.isArray(mons)?mons:[]).filter(mon=>matches(mon,stat,min,max));}
    function sortPool(mons,stat,dir){
      const list=(Array.isArray(mons)?mons:[]).map((mon,index)=>({mon,index,value:stat?statValue(mon,stat):null}));
      const sign=dir==='asc'?1:-1;
      list.sort((a,b)=>{const av=a.value!=null&&Number.isFinite(Number(a.value)),bv=b.value!=null&&Number.isFinite(Number(b.value));if(av!==bv)return av?-1:1;if(av&&Number(a.value)!==Number(b.value))return sign*(Number(a.value)-Number(b.value));return a.index-b.index;});
      return list.map(x=>x.mon);
    }
    function setSources({pool,dex}={}){
      if(pool!==undefined) currentPool=Array.isArray(pool)?pool:[];
      if(dex!==undefined) currentDex=dex&&typeof dex==='object'?dex:{};
      indexPool();
    }
    indexPool();
    return {resolve,statValue,matches,filterPool,sortPool,setSources,poolEntry,exactDexEntry};
  }
  window.SBL.freeAgencyStats={createResolver};
})();
