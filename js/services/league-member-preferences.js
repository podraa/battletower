/* League-scoped, self-managed member presentation preferences. */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  const SBL=window.SBL;
  function client(db){const value=db||SBL.getSupabase?.();if(!value)throw new Error('Supabase is not ready.');return value;}
  function id(value,label){const clean=String(value||'').trim();if(!clean)throw new Error(`${label} is required.`);return clean;}
  async function get(leagueId,userId,db){
    const league=id(leagueId,'League id'),user=id(userId,'User id');
    const {data,error}=await client(db).from('league_member_preferences')
      .select('league_id,user_id,signature_pokemon,updated_at')
      .eq('league_id',league).eq('user_id',user).maybeSingle();
    if(error)throw error;
    return data||null;
  }
  async function list(leagueId,db){
    const league=id(leagueId,'League id');
    const {data,error}=await client(db).from('league_member_preferences')
      .select('league_id,user_id,signature_pokemon,updated_at')
      .eq('league_id',league);
    if(error)throw error;
    return data||[];
  }
  async function setSignaturePokemon(leagueId,userId,pokemon,db){
    const league=id(leagueId,'League id'),user=id(userId,'User id');
    const name=String(pokemon||'').trim();
    if(name.length>80)throw new Error('Pokémon name is too long.');
    const {data,error}=await client(db).from('league_member_preferences').upsert({
      league_id:league,user_id:user,signature_pokemon:name||null,updated_at:new Date().toISOString()
    },{onConflict:'league_id,user_id'}).select('league_id,user_id,signature_pokemon,updated_at').single();
    if(error)throw error;
    return data;
  }
  SBL.memberPreferences=Object.freeze({get,list,setSignaturePokemon});
})();
