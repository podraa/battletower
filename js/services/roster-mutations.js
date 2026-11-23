/* CP4.171: all commissioner roster changes share the same atomic RPC.
 * No page may submit a replacement season JSON object for a roster edit.
 * Pure planReplace is available for tests and future admin tooling.
 */
(function(){
  'use strict';
  const SBL=window.SBL=window.SBL||{};
  function key(value){
    const name=typeof value==='string'?value:String(value?.name||'');
    return name.toLowerCase().replace(/[^a-z0-9]/g,'');
  }
  function name(value){return typeof value==='string'?value.trim():String(value?.name||'').trim();}
  function rosterArray(value){
    if(!Array.isArray(value))throw new Error('Every franchise roster must be an array.');
    return value;
  }
  function owners(rosters){
    if(!rosters||Array.isArray(rosters)||typeof rosters!=='object')throw new Error('Roster data must be a franchise map.');
    const map=new Map();
    for(const [franchise,list] of Object.entries(rosters)){
      for(const mon of rosterArray(list)){
        const identity=key(mon),display=name(mon);
        if(!identity||!display)throw new Error('Roster contains a Pokémon without a name.');
        if(map.has(identity))throw new Error('Duplicate ownership in roster plan: '+display);
        map.set(identity,{franchise,name:display,mon});
      }
    }
    return map;
  }
  function planReplace(before,after){
    const old=owners(before),next=owners(after);
    const operations=new Map();
    const op=franchise=>{
      if(!operations.has(franchise))operations.set(franchise,{franchise,remove:[],add:[]});
      return operations.get(franchise);
    };
    for(const [identity,prev] of old){
      const following=next.get(identity);
      if(!following||following.franchise!==prev.franchise)op(prev.franchise).remove.push(prev.name);
      else if(JSON.stringify(prev.mon)!==JSON.stringify(following.mon)){
        throw new Error('Roster metadata edits are not supported by replacement. Use an explicit metadata editor.');
      }
    }
    for(const [identity,target] of next){
      const prev=old.get(identity);
      if(!prev||prev.franchise!==target.franchise)op(target.franchise).add.push(target.name);
    }
    return [...operations.values()].filter(x=>x.add.length||x.remove.length);
  }
  async function apply(operations,options={}){
    const leagueId=String(options.leagueId||SBL.leagueDb?.selectedLeagueId?.()||'').trim();
    const seasonId=String(options.seasonId||SBL.leagueDb?.selectedSeasonId?.(leagueId)||'').trim();
    if(!leagueId||!seasonId)throw new Error('Select a league and active season before editing rosters.');
    if(!Array.isArray(operations)||!operations.length)return {changed:false};
    for(const item of operations){
      if(!item?.franchise||!Array.isArray(item?.remove)||!Array.isArray(item?.add))throw new Error('Invalid atomic roster operation.');
    }
    const reason=String(options.reason||'Commissioner roster update').trim();
    if(reason.length>500)throw new Error('Roster transaction reason must be 500 characters or fewer.');
    const db=options.client||SBL.getSupabase();
    const {data,error}=await db.rpc('sbl_admin_apply_roster_transaction',{
      p_league_id:leagueId,p_season_id:seasonId,p_operations:operations,p_reason:reason
    });
    if(error)throw error;
    SBL.replays?.invalidateCache?.();
    SBL.services?.rosters?.clearCache?.();
    return {changed:true,result:data};
  }
  async function replace(before,after,options={}){
    return apply(planReplace(before,after),options);
  }
  SBL.rosterMutations=Object.freeze({apply,replace,planReplace,key});
})();
