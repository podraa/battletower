/* Pokékipe role-data client. Uses SQL RPCs backed by Supabase pg_net;
 * no Supabase CLI or Edge Function deployment is required. */
(function(){
  'use strict';
  const SBL=window.SBL=window.SBL||{};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function request(payload){
    const client=SBL.getSupabase?.();
    if(!client?.rpc) throw new Error('Supabase database client is unavailable.');
    const leagueId=SBL.leagueDb?.selectedLeagueId?.();
    if(!leagueId) throw new Error('Select a league before loading Pokékipe role data.');
    const action=String(payload?.action||'');
    const formatId=String(payload?.formatId||'');
    const {data:started,error:startError}=await client.rpc('sbl_pokekipe_request',{
      p_league_id:leagueId,p_action:action,p_format_id:formatId||null
    });
    if(startError){
      const message=String(startError.message||startError);
      if(/function .* does not exist|schema cache|could not find the function/i.test(message)){
        throw new Error('The Pokékipe SQL migration has not been applied yet. Run supabase/migrations/046_cp479_pokekipe_sql_proxy.sql in the Supabase SQL Editor.');
      }
      throw new Error(message);
    }
    const requestId=Number(started?.request_id);
    if(!Number.isSafeInteger(requestId)||requestId<=0) throw new Error('Supabase did not return a valid Pokékipe request ID.');
    for(let attempt=0;attempt<60;attempt++){
      if(attempt) await wait(500);
      const {data,error}=await client.rpc('sbl_pokekipe_response',{
        p_league_id:leagueId,p_request_id:requestId
      });
      if(error) throw new Error(String(error.message||error));
      if(data?.pending) continue;
      if(!data?.ok){
        const status=data?.upstreamStatus?` (HTTP ${data.upstreamStatus})`:'';
        throw new Error(String(data?.error||'Pokékipe returned an unexpected response.')+status);
      }
      return data.data;
    }
    throw new Error('Pokékipe is taking too long to respond. Please try again.');
  }
  SBL.pokemonRoles={request};
})();
