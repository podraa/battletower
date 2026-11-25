/* CP4.176 private preparation tasks, findings and game plans. */
(function(){
  'use strict';
  const SBL=window.SBL=window.SBL||{};
  const TYPES=new Set(['task','finding','plan']);
  function scopeKey(value){return String(value||'').trim().toLowerCase().replace(/[-_]+/g,' ').replace(/\s+/g,' ');}
  function validateScope(context){
    const leagueId=String(context?.leagueId||''), seasonId=String(context?.seasonId||'');
    const opponent=String(context?.opponent||'').trim();
    if(!leagueId||!seasonId||!opponent)throw new Error('Select a league, season and opponent to save your preparation.');
    return {leagueId,seasonId,opponent,opponentKey:scopeKey(opponent)};
  }
  async function auth(){
    const db=SBL.getSupabase();
    const {data,error}=await db.auth.getUser();
    if(error)throw error;
    if(!data?.user)throw new Error('Sign in to save private preparation.');
    return {db,userId:data.user.id};
  }
  async function list(context){
    const scope=validateScope(context),{db,userId}=await auth();
    const {data,error}=await db.from('match_prep_items').select('id,user_id,league_id,season_id,opponent_key,opponent_name,item_type,content,is_done,source_widget,context,created_at,updated_at')
      .eq('user_id',userId).eq('league_id',scope.leagueId).eq('season_id',scope.seasonId)
      .eq('opponent_key',scope.opponentKey).order('created_at',{ascending:false}).limit(300);
    if(error)throw error;
    return data||[];
  }
  async function add(context,entry){
    const scope=validateScope(context),{db,userId}=await auth();
    if(!TYPES.has(entry?.type))throw new Error('Invalid preparation item type.');
    const content=String(entry.content||'').trim();
    if(!content)throw new Error('Enter something to save.');
    const row={user_id:userId,league_id:scope.leagueId,season_id:scope.seasonId,opponent_key:scope.opponentKey,
      opponent_name:scope.opponent,item_type:entry.type,content:content.slice(0,8000),is_done:false,
      source_widget:entry.sourceWidget?String(entry.sourceWidget).slice(0,80):null,
      context:entry.context&&typeof entry.context==='object'?entry.context:{}};
    const {data,error}=await db.from('match_prep_items').insert(row).select('*').single();
    if(error)throw error;return data;
  }
  async function update(id,patch){
    const {db,userId}=await auth();
    const payload={};
    if(Object.prototype.hasOwnProperty.call(patch,'content'))payload.content=String(patch.content||'').slice(0,8000);
    if(Object.prototype.hasOwnProperty.call(patch,'is_done'))payload.is_done=!!patch.is_done;
    if(!Object.keys(payload).length)throw new Error('Nothing to update.');
    const {data,error}=await db.from('match_prep_items').update(payload).eq('id',id).eq('user_id',userId).select('*').single();
    if(error)throw error;return data;
  }
  async function remove(id){
    const {db,userId}=await auth();
    const {error}=await db.from('match_prep_items').delete().eq('id',id).eq('user_id',userId);
    if(error)throw error;
  }
  SBL.prepTracker={list,add,update,remove,scopeKey};
})();
