/* CP4.169 — one league/season trade-rule contract for previews and server RPCs.
 * No global salary cap is inferred. NULL salary_cap means explicitly cap-free.
 * The database remains authoritative at the moment a trade is accepted.
 */
(function(){
  'use strict';
  const SBL=window.SBL=window.SBL||{};
  let cached=null,scopeKey='',loading=null,loadingKey='';
  function leagueId(){ return String(SBL.leagueDb?.selectedLeagueId?.()||''); }
  function seasonId(){ return String(SBL.leagueDb?.selectedSeasonId?.()||''); }
  function normalize(record){
    if(!record)return null;
    return Object.freeze({
      league_id:String(record.league_id),season_id:String(record.season_id),
      salary_cap:record.salary_cap===null||record.salary_cap===undefined?null:Number(record.salary_cap),
      team_salary_caps:record.team_salary_caps&&typeof record.team_salary_caps==='object'?{...record.team_salary_caps}:{},
      min_roster_size:Number(record.min_roster_size),
      max_roster_size:record.max_roster_size==null?null:Number(record.max_roster_size),
      team_trade_limit:Number(record.team_trade_limit),
      free_agency_trade_limit:Number(record.free_agency_trade_limit),
      updated_at:record.updated_at||null
    });
  }
  function key(l=leagueId(),s=seasonId()){return `${l}|${s}`;}
  function current(){return scopeKey===key()?cached:null;}
  function clearCache(){cached=null;scopeKey='';loading=null;loadingKey='';}
  async function load(client,options={}){
    const l=String(options.leagueId||leagueId()),s=String(options.seasonId||seasonId());
    if(!l||!s){clearCache();return null;}
    const k=key(l,s);
    if(!options.force&&scopeKey===k&&cached)return cached;
    if(!options.force&&loading&&loadingKey===k)return loading;
    const db=client||SBL.getSupabase();
    loadingKey=k;
    const requested=(async()=>{
      const {data,error}=await db.from('league_trade_rules')
        .select('league_id,season_id,salary_cap,team_salary_caps,min_roster_size,max_roster_size,team_trade_limit,free_agency_trade_limit,updated_at')
        .eq('league_id',l).eq('season_id',s).maybeSingle();
      if(error)throw error;
      const rules=normalize(data);
      // A late network response must not overwrite another selected league.
      if(key()===k){cached=rules;scopeKey=k;}
      return rules;
    })();
    loading=requested;
    try{return await requested;}finally{if(loading===requested){loading=null;loadingKey='';}}
  }
  function capFor(team,rules=current()){
    if(!rules)return null;
    const overrides=rules.team_salary_caps||{};
    return Object.prototype.hasOwnProperty.call(overrides,team)
      ? Number(overrides[team]) : rules.salary_cap;
  }
  function validateRoster(points,count,team,rules=current()){
    if(!rules)return ['League/season trade rules have not been configured. Ask an administrator to configure them.'];
    const errors=[];
    if(count<rules.min_roster_size)errors.push(`${team}: ${count} Pokémon is below the minimum of ${rules.min_roster_size}.`);
    if(rules.max_roster_size!=null&&count>rules.max_roster_size)errors.push(`${team}: ${count} Pokémon exceeds the maximum of ${rules.max_roster_size}.`);
    const cap=capFor(team,rules);
    if(cap!=null&&points>cap)errors.push(`${team}: ${points} points exceeds the ${cap}-point cap by ${points-cap}.`);
    return errors;
  }
  function previewSwap({proposerTeam,targetTeam,proposerRoster,targetRoster,offeredCount,requestedCount,offeredPoints,requestedPoints,rules=current()}){
    const proposer=Array.isArray(proposerRoster)?proposerRoster:[];
    const proposedPoints=proposer.reduce((total,mon)=>total+(Number(mon?.points)||0),0)-offeredPoints+requestedPoints;
    const result={proposer:{count:proposer.length-offeredCount+requestedCount,points:proposedPoints},target:null,errors:[]};
    result.errors.push(...validateRoster(proposedPoints,result.proposer.count,proposerTeam,rules));
    if(targetTeam){
      const target=Array.isArray(targetRoster)?targetRoster:[];
      const points=target.reduce((total,mon)=>total+(Number(mon?.points)||0),0)-requestedPoints+offeredPoints;
      result.target={count:target.length-requestedCount+offeredCount,points};
      result.errors.push(...validateRoster(points,result.target.count,targetTeam,rules));
    }
    return result;
  }
  async function save(payload,client){
    const db=client||SBL.getSupabase();
    const l=String(payload?.leagueId||leagueId()),s=String(payload?.seasonId||seasonId());
    if(!l||!s)throw new Error('Select a league and season before editing trade rules.');
    const cap=payload.salaryCap;
    if(cap!==null && String(cap).trim()==='')throw new Error('Choose an explicit salary cap or select Cap-free.');
    for(const field of ['minRoster','teamTradeLimit','freeAgencyTradeLimit']){
      if(payload[field]===null||payload[field]===undefined||String(payload[field]).trim()==='')
        throw new Error('Minimum roster size and trade limits must be entered explicitly.');
    }
    const input={p_league_id:l,p_season_id:s,p_salary_cap:cap===null||cap===''?null:Number(cap),
      p_min_roster_size:Number(payload.minRoster),
      p_max_roster_size:payload.maxRoster==null||payload.maxRoster===''?null:Number(payload.maxRoster),
      p_team_trade_limit:Number(payload.teamTradeLimit),
      p_free_agency_trade_limit:Number(payload.freeAgencyTradeLimit),
      p_team_salary_caps:payload.teamSalaryCaps||{}};
    if(input.p_salary_cap!==null&&(!Number.isFinite(input.p_salary_cap)||input.p_salary_cap<0))throw new Error('Salary cap must be a non-negative number, or disabled for a cap-free league.');
    if(!Number.isInteger(input.p_min_roster_size)||input.p_min_roster_size<0)throw new Error('Minimum roster size must be a non-negative integer.');
    if(input.p_max_roster_size!==null&&(!Number.isInteger(input.p_max_roster_size)||input.p_max_roster_size<input.p_min_roster_size))throw new Error('Maximum roster size must be at least the minimum.');
    for(const value of [input.p_team_trade_limit,input.p_free_agency_trade_limit])if(!Number.isInteger(value)||value<0)throw new Error('Trade limits must be non-negative integers.');
    const {data,error}=await db.rpc('sbl_admin_set_league_trade_rules',input);
    if(error)throw error;
    clearCache();
    if(key()===key(l,s)){cached=normalize(data);scopeKey=key(l,s);}
    return normalize(data);
  }
  SBL.tradeRules={load,save,current,normalize,capFor,validateRoster,previewSwap,clearCache};
})();
