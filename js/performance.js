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

  async function cached(key, loader, options={}){
    const mem=memory.get(key);
    if(fresh(mem)) return mem.value;
    const persisted=await idbGet(key);
    if(fresh(persisted)){
      memory.set(key,persisted);
      return persisted.value;
    }
    const value=await loader();
    const entry={ts:Date.now(),value};
    memory.set(key,entry);
    // Do not make the first page render wait for IndexedDB serialization.
    // Large replay payloads can take noticeable time to clone/write, which
    // used to make the dashboard feel frozen even though the live Supabase
    // request had already completed. Cache persistence is deliberately
    // fire-and-forget; the live result is returned immediately.
    idbPut(key,entry).catch(()=>{});
    return value;
  }

  async function invalidate(key){
    if(key){ memory.delete(key); await idbDelete(key); return; }
    memory.clear();
    const db=await openDb();
    if(!db) return;
    return new Promise(resolve=>{
      try{ const req=db.transaction(STORE,'readwrite').objectStore(STORE).clear(); req.onsuccess=()=>resolve(); req.onerror=()=>resolve(); }
      catch(_){ resolve(); }
    });
  }

  function patch(){
    if(!window.SBL) return;
    const perf=window.SBL.performance=window.SBL.performance||{};
    perf.cached=cached; perf.invalidate=invalidate; perf.clear=invalidate;

    if(window.SBL.replays && !window.SBL.replays.__phase4fPatched){
      const original=window.SBL.replays.load;
      if(typeof original==='function'){
        window.SBL.replays.load=function(client){
          return cached('replays:all',()=>original(client));
        };
        window.SBL.replays.__phase4fPatched=true;
      }
    }
    if(window.SBL.trades && !window.SBL.trades.__phase4fPatched){
      const original=window.SBL.trades.load;
      if(typeof original==='function'){
        window.SBL.trades.load=function(client){
          return cached('trades:all',()=>original(client));
        };
        window.SBL.trades.__phase4fPatched=true;
      }
    }
  }
  patch();
  // A tiny retry covers pages where services are loaded asynchronously.
  setTimeout(patch,0);
  setTimeout(patch,50);
  setTimeout(patch,250);
})();
