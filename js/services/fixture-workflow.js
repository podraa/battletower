/* Transaction helper for season-scoped fixture draft/publish persistence. */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  // Postgres jsonb does not preserve object key order, so a value read back
  // after saving can have its keys reordered (e.g. {home,away} -> {away,home}).
  // Compare structurally: object key order is irrelevant, array order is not.
  function canonical(v){
    if(Array.isArray(v)) return v.map(canonical);
    if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>{o[k]=canonical(v[k]);});return o;}
    return v===undefined?null:v;
  }
  function equal(a,b){return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
  async function persistSettings({settings,updates,loadCurrent,saveCurrent,readCurrent,invalidate}={}){
    if(!settings||typeof settings!=='object') throw new Error('Fixture settings object is required.');
    const keys=Object.keys(updates||{}),previous={};
    keys.forEach(key=>{previous[key]={exists:Object.prototype.hasOwnProperty.call(settings,key),value:clone(settings[key])};});
    Object.entries(updates||{}).forEach(([key,value])=>{settings[key]=clone(value);});
    try{
      const current=await loadCurrent();
      if(!current) throw new Error('The selected season could not be found.');
      const payload=clone(current.data||{});payload.settings=payload.settings||{};
      Object.entries(updates||{}).forEach(([key,value])=>{payload.settings[key]=clone(value);});
      await saveCurrent(payload);
      const verified=await readCurrent();
      if(!verified?.data?.settings) throw new Error('The season row could not be re-read after saving.');
      for(const [key,value] of Object.entries(updates||{})) if(!equal(verified.data.settings[key],value)) throw new Error(`Database verification failed for ${key}.`);
      for(const key of keys) settings[key]=clone(verified.data.settings[key]);
      if(typeof invalidate==='function') await invalidate();
      return {settings:verified.data.settings,row:verified};
    }catch(error){
      for(const key of keys){if(previous[key].exists)settings[key]=previous[key].value;else delete settings[key];}
      throw error;
    }
  }
  function publishedRounds(settings){return Array.isArray(settings?.fixture?.rounds)?settings.fixture.rounds:[];}
  function summarize(fixture){
    const rounds=Array.isArray(fixture?.rounds)?fixture.rounds:[];
    return {weeks:rounds.length,matches:rounds.reduce((n,round)=>n+(Array.isArray(round?.matches)?round.matches.filter(m=>String(m?.home||'').trim()&&String(m?.away||'').trim()).length:0),0)};
  }
  window.SBL.fixtureWorkflow={equal,persistSettings,publishedRounds,summarize};
})();
