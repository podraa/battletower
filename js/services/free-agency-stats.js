/* Form-aware Free Agency stat resolver. Draft-pool persisted stats are the
 * primary source; Showdown Pokedex is an exact-form fallback only. */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  function createResolver({pokemon,draftDash,pool=[],dex={}}={}){
    let currentPool=Array.isArray(pool)?pool:[];
    let currentDex=dex&&typeof dex==='object'?dex:{};
    function ids(name){return pokemon?.showdownStatsIdCandidates?.(name)||[String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'')];}
    function sameForm(a,b){
      if(pokemon?.sameSpeciesForm?.(a,b)) return true;
      const aa=ids(a),bb=new Set(ids(b));
      return aa.some(x=>bb.has(x));
    }
    function poolEntry(monOrName){
      const name=typeof monOrName==='string'?monOrName:monOrName?.name;
      return currentPool.find(entry=>entry&&sameForm(entry.name,name))||null;
    }
    function exactDexEntry(name){
      const dexData=currentDex?.pokedex||currentDex||{};
      for(const id of ids(name)) if(dexData[id]) return dexData[id];
      return null;
    }
    function resolve(monOrName){
      const name=typeof monOrName==='string'?monOrName:monOrName?.name;
      const entry=poolEntry(name);
      if(entry){
        const hasStats=draftDash?.statValue?.(entry,'hp')!=null || draftDash?.statValue?.(entry,'atk')!=null || draftDash?.statValue?.(entry,'spe')!=null;
        if(hasStats) return entry;
      }
      return exactDexEntry(name);
    }
    function statValue(monOrName,stat){
      const entry=resolve(monOrName);
      return entry?draftDash?.statValue?.(entry,stat)??null:null;
    }
    function matches(mon,stat,min,max){
      if(!stat || (min===''||min==null) && (max===''||max==null)) return true;
      const value=statValue(mon,stat);
      if(value==null||!Number.isFinite(Number(value))) return false;
      return (min===''||min==null||Number.isNaN(Number(min))||Number(value)>=Number(min)) &&
             (max===''||max==null||Number.isNaN(Number(max))||Number(value)<=Number(max));
    }
    function filterPool(mons,stat,min,max){return (Array.isArray(mons)?mons:[]).filter(mon=>matches(mon,stat,min,max));}
    // Stable sort by a base stat. dir: 'desc' (highest first) or 'asc'. Pokémon
    // whose stat cannot be resolved always sort last, in their original order.
    function sortPool(mons,stat,dir){
      const list=(Array.isArray(mons)?mons:[]).map((mon,index)=>({mon,index,value:stat?statValue(mon,stat):null}));
      const sign=dir==='asc'?1:-1;
      list.sort((a,b)=>{
        const av=a.value!=null&&Number.isFinite(Number(a.value)),bv=b.value!=null&&Number.isFinite(Number(b.value));
        if(av!==bv) return av?-1:1;
        if(av&&Number(a.value)!==Number(b.value)) return sign*(Number(a.value)-Number(b.value));
        return a.index-b.index;
      });
      return list.map(x=>x.mon);
    }
    function setSources({pool,dex}={}){
      if(pool!==undefined) currentPool=Array.isArray(pool)?pool:[];
      if(dex!==undefined) currentDex=dex&&typeof dex==='object'?dex:{};
      // Deliberately no negative-result memo: filters always see the latest
      // persisted pool and dex source, including late-arriving data.
    }
    return {resolve,statValue,matches,filterPool,sortPool,setSources,poolEntry,exactDexEntry};
  }
  window.SBL.freeAgencyStats={createResolver};
})();
