/* SBL Global Pokémon Catalogue — CP4.153
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
  function clearCache(){cache.clear();inflight.clear();}
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
  async function getMoves(moveIds) {
    const ids = [...new Set((Array.isArray(moveIds) ? moveIds : [moveIds]).map(normalizeId).filter(Boolean))];
    if (!ids.length) return [];
    return once('catalog:moves:'+ids.slice().sort().join(','),async()=>{
    const { data, error } = await client()
      .from('pokemon_moves_active')
      .select('*')
      .in('move_id', ids);
    if (error) throw error;
    return data || [];
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

  SBL.pokemonCatalog = {
    normalizeId,
    getMeta,
    isReady,
    getSpecies,
    searchSpecies,
    getMoves,
    getLearnset,
    getSpeciesWithLearnset,
    clearCache,
  };
})();
