/* SBL Phase 4F — shared client-side performance cache.
 * Read-through IndexedDB cache for expensive shared reads. Writes remain
 * authoritative in Supabase and invalidate the cache through SBL.performance.
 * No database schema changes.
 */
(function(){
  'use strict';
  const DB_NAME='sbl-client-cache';
  const DB_VERSION=1;
  const STORE='payloads';
  const TTL=2*60*1000;
  const memory=new Map();
  const inFlight=new Map();
  let dbPromise=null;

  function openDb(){
    if(dbPromise) return dbPromise;
    if(!('indexedDB' in window)) return Promise.resolve(null);
    dbPromise=new Promise(resolve=>{
      try{
        const req=indexedDB.open(DB_NAME,DB_VERSION);
        req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
        req.onsuccess=()=>resolve(req.result);
        req.onerror=()=>resolve(null);
      }catch(_){ resolve(null); }
    });
    return dbPromise;
  }
  async function idbGet(key){
    const db=await openDb();
    if(!db) return null;
    return new Promise(resolve=>{
      try{
        const req=db.transaction(STORE,'readonly').objectStore(STORE).get(key);
        req.onsuccess=()=>resolve(req.result||null);
        req.onerror=()=>resolve(null);
      }catch(_){ resolve(null); }
    });
  }
  async function idbPut(key,value){
    const db=await openDb();
    if(!db) return;
    return new Promise(resolve=>{
      try{
        const req=db.transaction(STORE,'readwrite').objectStore(STORE).put(value,key);
        req.onsuccess=()=>resolve(); req.onerror=()=>resolve();
      }catch(_){ resolve(); }
    });
  }
  async function idbDelete(key){
    const db=await openDb();
    if(!db) return;
    return new Promise(resolve=>{
      try{
        const req=db.transaction(STORE,'readwrite').objectStore(STORE).delete(key);
        req.onsuccess=()=>resolve(); req.onerror=()=>resolve();
      }catch(_){ resolve(); }
    });
  }
  function fresh(entry){ return entry && (Date.now()-entry.ts)<TTL; }

  // Bumped by every invalidation. A loader that started before an
  // invalidation must not write its (possibly pre-write) result afterwards.
  let generation=0;
  const inScope=(k,prefix)=>k===prefix||String(k).startsWith(prefix+'|');

  async function idbKeys(){
    const db=await openDb();
    if(!db) return [];
    return new Promise(resolve=>{
      try{
        const req=db.transaction(STORE,'readonly').objectStore(STORE).getAllKeys();
        req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>resolve(null);
      }catch(_){ resolve(null); }
    });
  }
  async function idbClear(){
    const db=await openDb();
    if(!db) return;
    return new Promise(resolve=>{
      try{ const req=db.transaction(STORE,'readwrite').objectStore(STORE).clear(); req.onsuccess=()=>resolve(); req.onerror=()=>resolve(); }
      catch(_){ resolve(); }
    });
  }

  /* cached(key, loader, {accept}): `accept(value)` must approve a value before
   * it is served from cache OR stored, so an entry can never be served for a
   * scope it does not belong to. */
  async function cached(key, loader, options={}){
    const accept=typeof options.accept==='function' ? options.accept : null;
    const usable=v=>!accept || accept(v);
    const mem=memory.get(key);
    if(fresh(mem) && usable(mem.value)) return mem.value;
    if(mem) memory.delete(key);
    if(inFlight.has(key)) return inFlight.get(key);
    const gen=generation;
    const promise=(async()=>{
      const persisted=await idbGet(key);
      if(fresh(persisted) && usable(persisted.value)){
        if(gen===generation) memory.set(key,persisted);
        return persisted.value;
      }
      const value=await loader();
      if(gen===generation && usable(value)) store(key,value);
      return value;
    })();
    inFlight.set(key,promise);
    try{ return await promise; }
    finally{ if(inFlight.get(key)===promise) inFlight.delete(key); }
  }
  function store(key,value){
    const entry={ts:Date.now(),value};
    memory.set(key,entry);
    // Do not make the first page render wait for IndexedDB serialization.
    idbPut(key,entry).catch(()=>{});
  }

  // invalidate('replays:all') clears every league/season scope under that name.
  async function invalidate(key){
    generation++;
    if(key){
      for(const k of Array.from(memory.keys())) if(inScope(k,key)) memory.delete(k);
      for(const k of Array.from(inFlight.keys())) if(inScope(k,key)) inFlight.delete(k);
      const keys=await idbKeys();
      if(keys===null){ await idbClear(); return; } // cannot enumerate: clearing everything is the safe choice
      await Promise.all(keys.filter(k=>inScope(k,key)).map(idbDelete));
      return;
    }
    memory.clear();
    inFlight.clear();
    await idbClear();
  }

  function selection(){
    const ld=window.SBL && window.SBL.leagueDb;
    const league=(ld && ld.selectedLeagueId && ld.selectedLeagueId())||'';
    const season=(league && ld.selectedSeasonId && ld.selectedSeasonId(league))||'';
    return {league,season};
  }
  const scoped=(name,league,season)=>name+'|'+league+'|'+season;

  function stateRow(rows){ return (Array.isArray(rows)?rows:[]).find(r=>r && r.replay_id==='__dashboard_state__')||null; }
  // A cached bundle is only valid for the exact league + season it describes.
  function bundleMatches(rows,league,season){
    const row=stateRow(rows);
    const marker=row && (row.normalizedSeason || (row.replay_data && row.replay_data.__normalizedSeason));
    return !!marker && marker.id===season && !!row.replay_data && !!row.replay_data.settings && row.replay_data.settings.activeLeagueId===league;
  }
  function tradesMatch(rows,league){
    return Array.isArray(rows) && rows.every(t=>!t || !t.league_id || t.league_id===league);
  }

  function patch(){
    if(!window.SBL) return;
    const perf=window.SBL.performance=window.SBL.performance||{};
    perf.cached=cached; perf.invalidate=invalidate; perf.clear=invalidate;
    perf.idle=(fn, timeout=1200)=>{
      if('requestIdleCallback' in window) return window.requestIdleCallback(fn,{timeout});
      return window.setTimeout(fn,0);
    };
    perf.preload=(key,loader)=>cached(key,loader).catch(()=>null);

    if(window.SBL.replays && !window.SBL.replays.__phase4fPatched){
      const original=window.SBL.replays.load;
      if(typeof original==='function'){
        window.SBL.replays.load=async function(client,options){
          const opts=options||{};
          const sel=selection();
          // Without a proven league+season (first visit, or force) go straight
          // to the loader, then remember the result under the scope it RESOLVED.
          if(!sel.league || !sel.season || opts.force){
            const gen=generation;
            const result=await original(client,opts);
            const row=stateRow(result.data);
            const marker=row && (row.normalizedSeason || (row.replay_data && row.replay_data.__normalizedSeason));
            const league=row && row.replay_data && row.replay_data.settings && row.replay_data.settings.activeLeagueId;
            if(gen===generation && marker && marker.id && league && bundleMatches(result.data,league,marker.id)) store(scoped('replays:all',league,marker.id),result.data);
            return result;
          }
          const data=await cached(scoped('replays:all',sel.league,sel.season),async()=>(await original(client,opts)).data,{accept:v=>bundleMatches(v,sel.league,sel.season)});
          return {data,error:null};
        };
        window.SBL.replays.__phase4fPatched=true;
      }
    }
    if(window.SBL.trades && !window.SBL.trades.__phase4fPatched){
      const original=window.SBL.trades.load;
      if(typeof original==='function'){
        window.SBL.trades.load=async function(client,options){
          const opts=options||{};
          const sel=selection();
          if(!sel.league || !sel.season || opts.force) return original(client,opts);
          const data=await cached(scoped('trades:all',sel.league,sel.season),async()=>(await original(client,opts)).data,{accept:v=>tradesMatch(v,sel.league)});
          return {data,error:null};
        };
        window.SBL.trades.__phase4fPatched=true;
      }
    }
  }
  // Entries written by earlier builds used season-agnostic keys. They can no
  // longer be read, but remove them so they cannot linger.
  idbDelete('replays:all').catch(()=>{}); idbDelete('trades:all').catch(()=>{});
  patch();
  // A tiny retry covers pages where services are loaded asynchronously.
  setTimeout(patch,0);
  setTimeout(patch,50);
  setTimeout(patch,250);
})();

(function(){
  const api=window.SBL=window.SBL||{};
  api.performance=api.performance||{};
  api.performance.warm=function(task){
    if(typeof task!=="function") return;
    const run=()=>{try{const r=task(); if(r&&typeof r.catch==="function") r.catch(()=>{});}catch(e){}};
    if('requestIdleCallback' in window) window.requestIdleCallback(run,{timeout:1500});
    else setTimeout(run,250);
  };
})();
