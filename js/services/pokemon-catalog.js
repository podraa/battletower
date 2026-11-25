/* SBL Global Pokémon Catalogue - CP4.153
 * Read-only client access to the versioned Showdown catalogue.
 * Existing synchronous name/sprite helpers remain available as compatibility
 * fallbacks; pages can migrate to this async data service incrementally.
 */
(function () {
  'use strict';
  window.SBL = window.SBL || {};
  const SBL = window.SBL;

  // Bounded, single-flight, client-side cache. The global catalogue is
  // versioned and immutable between syncs; short TTL ensures updates land
  // without fetching the same species/moves/learnset for each analyser.
  const inflight=new Map(), cache=new Map();
  const TTL_MS=5*60*1000, MAX_CACHE=350;
  async function once(key,request){
    const now=Date.now(),hit=cache.get(key);
    if(hit && hit.expires>now)return hit.value;
    if(inflight.has(key))return inflight.get(key);
    const promise=(async()=>{
      const value=await request();
      if(cache.size>=MAX_CACHE)cache.delete(cache.keys().next().value);
      cache.set(key,{value,expires:Date.now()+TTL_MS});
      return value;
    })();
    inflight.set(key,promise);
    try{return await promise;}finally{if(inflight.get(key)===promise)inflight.delete(key);}
  }
  function clearCache(){cache.clear();inflight.clear();clearBattleCache();}
  function client() {
    if (typeof SBL.getSupabase !== 'function') throw new Error('Supabase client is not ready.');
    return SBL.getSupabase();
  }
  function normalizeId(value) {
    return SBL.domain?.pokemonCatalogId ? SBL.domain.pokemonCatalogId(value) : String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  async function getMeta() {return once('catalog:meta',async()=>{
    const { data, error } = await client()
      .from('pokemon_catalog_meta')
      .select('active_version,source_url,synced_at,species_count,move_count,learnset_count')
      .eq('singleton', true)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  });}
  async function isReady() {
    const meta = await getMeta();
    return Boolean(meta?.active_version);
  }
  async function getSpecies(id) {
    const key = normalizeId(id);
    if (!key) return null;
    return once('catalog:species:'+key,async()=>{
    const { data, error } = await client()
      .from('pokemon_catalog_active')
      .select('*')
      .eq('pokemon_id', key)
      .maybeSingle();
    if (error) throw error;
    return data || null;
    });
  }
  async function searchSpecies(query, options = {}) {
    const term = String(query || '').trim();
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 30));
    let request = client().from('pokemon_catalog_active').select(
      'pokemon_id,name,base_species,forme,num,generation,types,base_stats,abilities,is_mega,is_battle_only,is_nonstandard'
    );
    if (term) request = request.ilike('name', `%${term.replace(/[%_,]/g, ' ')}%`);
    if (options.generation) request = request.eq('generation', Number(options.generation));
    if (options.standardOnly === true) request = request.is('is_nonstandard', null);
    const { data, error } = await request.order('num', { ascending: true }).limit(limit);
    if (error) throw error;
    return data || [];
  }
  async function listSpecies(options = {}) {
    const limit=Math.max(1,Math.min(5000,Number(options.limit)||2500));
    const pageSize=Math.max(100,Math.min(1000,Number(options.pageSize)||750));
    const fields='pokemon_id,name,base_species,forme,num,generation,types,base_stats,abilities,is_mega,is_battle_only,is_nonstandard';
    const rows=[];
    for(let offset=0;offset<limit;offset+=pageSize){
      const end=Math.min(limit-1,offset+pageSize-1);
      let query=client().from('pokemon_catalog_active').select(fields).order('num',{ascending:true}).order('name',{ascending:true}).range(offset,end);
      if(options.standardOnly===true)query=query.is('is_nonstandard',null);
      const {data,error}=await query;
      if(error)throw error;
      rows.push(...(data||[]));
      if(!data||data.length<end-offset+1)break;
    }
    return rows;
  }

  async function getMoves(moveIds) {
    const ids = [...new Set((Array.isArray(moveIds) ? moveIds : [moveIds]).map(normalizeId).filter(Boolean))];
    if (!ids.length) return [];
    return once('catalog:moves:'+ids.slice().sort().join(','),async()=>{
      const rows=[];
      // Showdown species can have hundreds of legal move records. Split .in()
      // to prevent oversized query strings and backend request failures.
      const chunks=[];
      for(let i=0;i<ids.length;i+=75)chunks.push(ids.slice(i,i+75));
      // At most 3 concurrent requests, rather than a sequential 9+ request
      // waterfall for large movesets or an unbounded burst.
      for(let i=0;i<chunks.length;i+=3){
        const responses=await Promise.all(chunks.slice(i,i+3).map(chunk=>
          client().from('pokemon_moves_active')
            .select('move_id,name,type,category,base_power,is_nonstandard,source_version')
            .in('move_id',chunk)
        ));
        for(const response of responses){
          if(response.error)throw response.error;
          rows.push(...(response.data||[]));
        }
      }
      return rows;
    });
  }
  async function getLearnset(pokemonId) {
    const key = normalizeId(pokemonId);
    if (!key) return [];
    return once('catalog:learnset:'+key,async()=>{
    const { data, error } = await client()
      .from('pokemon_learnsets_active')
      .select('pokemon_id,move_id,sources')
      .eq('pokemon_id', key)
      .order('move_id', { ascending: true });
    if (error) throw error;
    return data || [];
    });
  }
  async function getSpeciesWithLearnset(pokemonId) {
    const [species, learnset] = await Promise.all([getSpecies(pokemonId), getLearnset(pokemonId)]);
    if (!species) return null;
    const moves = await getMoves(learnset.map(row => row.move_id));
    const byId = new Map(moves.map(move => [move.move_id, move]));
    return { ...species, learnset: learnset.map(row => ({ ...row, move: byId.get(row.move_id) || null })) };
  }

  // CP4.170: exact battle-form read model for all scouting and analyser pages.
  // A profile must never inherit the base form's stats, type or abilities when
  // an alternate form is missing from the active version. "null" is a real
  // unavailable result, not permission to guess the base Pokemon.
  const battleCache = new Map();
  const BATTLE_PROFILE_MAX = 350;
  let batchSerial = Promise.resolve();
  function readBattleCache(key) {
    const hit=battleCache.get(key);
    if (!hit) return {found:false,value:null};
    if (hit.expires<=Date.now()) { battleCache.delete(key);return {found:false,value:null}; }
    return {found:true,value:hit.value};
  }
  function rememberBattle(key,value) {
    if (battleCache.has(key))battleCache.delete(key);
    if (battleCache.size>=BATTLE_PROFILE_MAX)battleCache.delete(battleCache.keys().next().value);
    battleCache.set(key,{value,expires:Date.now()+TTL_MS});
  }
  function toBattleProfile(row) {
    if(!row)return null;
    const raw=row.base_stats||{};
    if(!Object.values(raw).some(value=>Number.isFinite(Number(value))&&Number(value)>0))return null;
    const stats={
      hp: Number(raw.hp??raw.HP)||0,
      attack: Number(raw.atk??raw.attack)||0,
      defense: Number(raw.def??raw.defense)||0,
      'special-attack':Number(raw.spa??raw['special-attack'])||0,
      'special-defense':Number(raw.spd??raw['special-defense'])||0,
      speed:Number(raw.spe??raw.speed)||0
    };
    const abilities=Array.isArray(row.abilities)?row.abilities:Object.values(row.abilities||{});
    return Object.freeze({
      id:String(row.pokemon_id),name:String(row.name||''),
      baseSpecies:String(row.base_species||''),stats,
      types:(Array.isArray(row.types)?row.types:[]).map(String),
      abilities:abilities.map(String).filter(Boolean),
      weightkg:row.weight_kg==null?null:Number(row.weight_kg),
      source:'global-catalogue',version:String(row.source_version||'')
    });
  }
  async function preloadBattleProfiles(names) {
    // Serialize very short overlapping batches to avoid a remote request per
    // species when several tabs and analysers render simultaneously.
    const ids=[...new Set((names||[]).map(normalizeId).filter(Boolean))];
    if(!ids.length)return new Map();
    const populate=async()=>{
      const requested=ids.filter(id=>!readBattleCache(id).found);
      if(requested.length){
        const meta=await getMeta();
        if(!meta?.active_version){
          requested.forEach(id=>rememberBattle(id,null));
        }else{
          // Pokemon lists are small (<100 in practice), but chunk anyway to
          // keep PostgREST request URLs bounded.
          for(let i=0;i<requested.length;i+=75){
            const chunk=requested.slice(i,i+75);
            const {data,error}=await client().from('pokemon_catalog_active')
              .select('pokemon_id,name,base_species,types,base_stats,abilities,weight_kg,source_version')
              .in('pokemon_id',chunk);
            if(error)throw error;
            const byId=new Map((data||[]).map(row=>[String(row.pokemon_id),toBattleProfile(row)]));
            chunk.forEach(id=>rememberBattle(id,byId.get(id)||null));
          }
        }
      }
      return new Map(ids.map(id=>[id,readBattleCache(id).value]));
    };
    const pending=batchSerial.then(populate,populate);
    batchSerial=pending.then(()=>undefined,()=>undefined);
    return pending;
  }
  async function getBattleProfile(name){
    const id=normalizeId(name);
    if(!id)return null;
    const hit=readBattleCache(id);
    if(hit.found)return hit.value;
    const rows=await preloadBattleProfiles([name]);
    return rows.get(id)||null;
  }
  // Exact-form damage calculator adapter. @smogon/calc supports per-instance
  // species overrides; use them only when the active catalogue contains all
  // six real stats, typing and ability for that exact form. Never substitute
  // base-form combat stats for an unsupported Mega/Z-Mega/Primal.
  async function createCalcPokemon(C,gen,species,options={}){
    if(!C?.Pokemon)throw new Error('Damage calculator is not available.');
    const raw=String(species||'').trim();
    const id=normalizeId(raw);
    const protectedForm=/(?:mega(?:x|y|z)?|primal)$/.test(id);
    let nativeError=null;
    // User-facing rosters may say "Mega Greninja", but @smogon/calc expects
    // Showdown's "Greninja-Mega". Try both without ever accepting base-form
    // stats as a substitute for a permanent form.
    const formKey=SBL.domain?.pokemonKey?.(raw)||'';
    const nativeCandidates=[raw];
    const pretty=s=>String(s||'').split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join('-');
    if(/-mega(?:-[xyz])?$/.test(formKey) || /-primal$/.test(formKey)){
      const m=formKey.match(/^(.+)-(mega(?:-[xyz])?|primal)$/);
      if(m)nativeCandidates.push(pretty(m[1])+'-'+pretty(m[2]));
    }
    for(const candidate of [...new Set(nativeCandidates)]){
      try{
        const native=new C.Pokemon(gen,candidate,options);
        if(!protectedForm||normalizeId(native.name||candidate)===id)return native;
      }catch(err){nativeError=err;}
    }
    if(!protectedForm)throw nativeError||new Error('Unknown calculator species: '+raw);
    const exact=await getBattleProfile(raw);
    const rawStats=exact?.stats||{};
    const baseStats={hp:Number(rawStats.hp),atk:Number(rawStats.attack),def:Number(rawStats.defense),
      spa:Number(rawStats['special-attack']),spd:Number(rawStats['special-defense']),spe:Number(rawStats.speed)};
    const complete=Object.values(baseStats).every(x=>Number.isFinite(x)&&x>0&&x<=255);
    if(!exact||!complete||!Array.isArray(exact.types)||!exact.types.length||
       !Array.isArray(exact.abilities)||!exact.abilities.length||
       !Number.isFinite(exact.weightkg)||exact.weightkg<=0){
      throw new Error(`No complete versioned battle profile for ${raw}; calculation unavailable.`);
    }
    const types=exact.types.map(type=>String(type).trim().replace(/^./,c=>c.toUpperCase()));
    if(types.length>2||types.some(type=>!type))throw new Error('Invalid catalogue type data for '+raw);
    // Prefer the catalogue's authoritative base_species when supplied. The
    // same Mega may arrive as "Mega Raichu X", "Raichu-Mega-X" or
    // "Raichu-MegaX"; stripping a suffix from the *display* name fails for
    // every prefix-style form. Canonical keys are for identity, never for
    // deriving alternate-form stats.
    const canonical=SBL.domain?.pokemonKey?.(raw)||'';
    const match=canonical.match(/^(.+)-(?:mega(?:-[xyz])?|primal)$/);
    const bareKey=match?.[1]||'';
    const fromKey=bareKey?bareKey.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join('-'):'';
    const catalogueBase=String(exact.baseSpecies||'').trim();
    const base=catalogueBase&&normalizeId(catalogueBase)!==id?catalogueBase:fromKey;
    if(!base||normalizeId(base)===id)
      throw new Error('Cannot resolve a calculator base species for '+raw+' ('+canonical+')');
    const customOptions={...options,name:raw,
      ability:options.ability||exact.abilities[0],
      overrides:{name:raw,baseStats,types,abilities:exact.abilities,weightkg:exact.weightkg}};
    let result;
    try{result=new C.Pokemon(gen,base,customOptions);}
    catch(err){throw new Error('Calculator could not construct base species '+base+' for '+raw+': '+(err?.message||err));}
    // The calculator computes battle stats from its own species table. Prove
    // that every override took effect before returning a custom Mega.
    if(!result?.species?.baseStats ||
       Object.entries(baseStats).some(([stat,value])=>Number(result.species.baseStats[stat])!==value) ||
       (Array.isArray(result.types) && (result.types.length!==types.length ||
         result.types.some((type,i)=>normalizeId(type)!==normalizeId(types[i]))))){
      throw new Error('Calculator did not apply the exact-form overrides for '+raw);
    }
    return result;
  }
  function clearBattleCache(){battleCache.clear();}
  // A shared, versioned learnset read for the Switch-In move chooser and
  // Team Planner. Do NOT claim current-format legality from a cross-generation
  // Showdown learnset; source rows are retained for future ruleset filtering.
  async function getDamagingLearnset(pokemonName){
    const id=normalizeId(pokemonName);
    if(!id)return null;
    return once('catalog:damaging:'+id,async()=>{
      const profile=await getBattleProfile(pokemonName);
      const key=SBL.domain?.pokemonKey?.(pokemonName)||String(pokemonName||'').toLowerCase();
      const standardMega=key.match(/^(.+)-(?:mega(?:-[xy])?|primal)$/);
      // A missing exact Mega profile must still permit browsing its *base*
      // damaging learnset. Damage itself remains unavailable until the exact
      // battle profile is verified. Custom Z-Mega never inherits by guess.
      if(!profile && !standardMega)return null;
      let rows=profile?await getLearnset(id):[], inheritedFrom=null;
      if(!rows.length){
        // Mega and Primal forms inherit their species' moves. Explicitly
        // forbid Z-Mega base inheritance: an unversioned custom ruleset
        // could have different legality and we must not guess.
        const match=standardMega;
        if(match){
          inheritedFrom=normalizeId(match[1]);
          rows=await getLearnset(inheritedFrom);
        }
      }
      const meta=await getMeta();
      if(!rows.length)return {moves:[],source:profile?'global-catalogue':'inherited-base-learnset',inheritedFrom,
        version:String(profile?.version||meta?.active_version||''),evidence:'catalogued',rulesetVerified:false};
      const known=await getMoves(rows.map(row=>row.move_id));
      const moves=known.filter(m=>Number(m.base_power)>0 && ['Physical','Special'].includes(String(m.category||'').replace(/^./,x=>x.toUpperCase())))
        .map(m=>({name:String(m.name||m.move_id||''),type:String(m.type||''),category:String(m.category||'').toLowerCase(),power:Number(m.base_power),
          sources:rows.find(row=>row.move_id===m.move_id)?.sources||[],source:profile?'global-catalogue':'inherited-base-learnset',evidence:'catalogued',rulesetVerified:false,
          catalogVersion:String(m.source_version||profile?.version||meta?.active_version||'')}))
        .filter(m=>m.name).sort((a,b)=>a.name.localeCompare(b.name));
      return {moves,source:profile?'global-catalogue':'inherited-base-learnset',inheritedFrom,
        version:String(profile?.version||meta?.active_version||''),evidence:'catalogued',rulesetVerified:false};
    });
  }

  // One canonical read facade for Match Prep. Identity, exact-form battle
  // profile and damaging move candidates are resolved through the same active
  // catalogue version. Learnset rows are cross-generation catalogue evidence,
  // not proof that a move is legal in the selected league format or on a real
  // opponent set. Callers must preserve that provenance in their UI.
  async function getMatchupBundle(name){
    const identity=SBL.domain?.pokemonKey?.(name)||String(name||'').trim().toLowerCase();
    const id=normalizeId(name);
    if(!id)return null;
    return once('catalog:matchup:'+id,async()=>{
      const [profile,learnset]=await Promise.all([getBattleProfile(name),getDamagingLearnset(name)]);
      const moves=Array.isArray(learnset?.moves)?learnset.moves.map(move=>({...move,
        evidence:'catalogued',rulesetVerified:false,
        source:move.source||learnset.source||'global-catalogue',
        catalogVersion:move.catalogVersion||learnset.version||profile?.version||''})):[];
      return Object.freeze({identity:String(identity),catalogId:id,profile:profile||null,moves,
        profileSource:profile?.source||'unavailable',profileVersion:String(profile?.version||''),
        moveSource:String(learnset?.source||'unavailable'),moveVersion:String(learnset?.version||profile?.version||''),
        inheritedFrom:learnset?.inheritedFrom||null,rulesetVerified:false,
        moveEvidence:'catalogued',hasExactProfile:!!profile});
    });
  }

  SBL.pokemonCatalog = {
    normalizeId,
    getMeta,
    isReady,
    getSpecies,
    searchSpecies,
    listSpecies,
    getMoves,
    getLearnset,
    getSpeciesWithLearnset,
    getDamagingLearnset,
    getMatchupBundle,
    getBattleProfile,
    createCalcPokemon,
    preloadBattleProfiles,
    toBattleProfile,
    clearCache,
  };
})();
