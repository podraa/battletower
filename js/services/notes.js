/*
 * BATTLE TOWER MATCH PREP NOTES SERVICE
 *
 * Notes are coach-owned and scoped to league + season + opponent + note week.
 * Older weekly notes remain available instead of being overwritten.
 */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  window.SBL.services=window.SBL.services||{};
  const SBL=window.SBL;
  const CACHE=new Map();
  const DRAFT_PREFIX='battle_tower_matchup_note_draft_v2|';
  let activeUserId='';

  function client(){return SBL.getSupabase();}
  function leagueId(){return SBL.leagueDb?.selectedLeagueId?.()||'';}
  function seasonId(){return SBL.leagueDb?.selectedSeasonId?.()||'';}
  function scopeKey(value){return String(value||'').trim().toLowerCase().replace(/[-_]+/g,' ').replace(/\s+/g,' ');}
  function weekKey(value){return String(value||'Unassigned').trim()||'Unassigned';}
  function cacheKey(type,league,season,scope,week){return [activeUserId,type,league,season||'',scopeKey(scope),weekKey(week)].join('|');}
  function draftKey(league,season,opponent,week){return DRAFT_PREFIX+[activeUserId,league,season,scopeKey(opponent),scopeKey(week)].join('|');}
  function readDraft(league,season,opponent,week){try{const raw=localStorage.getItem(draftKey(league,season,opponent,week));return raw?JSON.parse(raw):null;}catch(_){return null;}}
  function writeDraft(league,season,opponent,week,content,updatedAt){if(!activeUserId)return;try{localStorage.setItem(draftKey(league,season,opponent,week),JSON.stringify({weekKey:weekKey(week),content:String(content??''),updatedAt:updatedAt||new Date().toISOString()}));}catch(_){} }
  function clearDraft(league,season,opponent,week){try{localStorage.removeItem(draftKey(league,season,opponent,week));}catch(_){} }
  function stageMatchupDraft(opponent,content,options={}){
    const league=options.leagueId||leagueId(), season=options.seasonId||seasonId();
    if(!league||!season||!opponent||!activeUserId)return;
    writeDraft(league,season,opponent,weekKey(options.weekKey||options.week),content);
  }
  function localDrafts(league,season,opponent){
    if(!activeUserId)return [];
    const prefix=DRAFT_PREFIX+[activeUserId,league,season,scopeKey(opponent)].join('|')+'|';
    const result=[];
    try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;const draft=JSON.parse(localStorage.getItem(key)||'null');if(!draft)continue;result.push({week_key:draft.weekKey||key.slice(prefix.length),content:String(draft.content||''),updated_at:draft.updatedAt||'',localDraft:true});}}catch(_){}
    return result;
  }

  async function getMatchupNotes(opponentTeam, options={}){
    const league=options.leagueId||leagueId();
    const season=options.seasonId||seasonId();
    const opponent=String(opponentTeam||'').trim();
    if(!league||!season||!opponent)return [];
    const db=client();
    const user=(await db.auth.getUser()).data.user;
    if(!user)return [];
    activeUserId=user.id;
    const key=cacheKey('matchup-list',league,season,opponent,'all');
    if(CACHE.has(key))return mergeDrafts(CACHE.get(key),league,season,opponent);
    const {data,error}=await db.from('match_prep_notes').select('*')
      .eq('user_id',user.id).eq('league_id',league).eq('season_id',season)
      .eq('note_type','matchup').eq('scope_key',scopeKey(opponent))
      .order('updated_at',{ascending:false});
    if(error)throw error;
    const rows=Array.isArray(data)?data:[];
    CACHE.set(key,rows);
    return mergeDrafts(rows,league,season,opponent);
  }

  function mergeDrafts(rows,league,season,opponent){
    const map=new Map((rows||[]).map(row=>[weekKey(row.week_key).toLowerCase(),row]));
    localDrafts(league,season,opponent).forEach(draft=>{
      const week=weekKey(draft.week_key).toLowerCase(),existing=map.get(week);
      if(!existing||Date.parse(draft.updated_at||'')>Date.parse(existing.updated_at||''))map.set(week,{...(existing||{}),...draft});
    });
    return [...map.values()].sort((a,b)=>Date.parse(b.updated_at||0)-Date.parse(a.updated_at||0));
  }

  async function getMatchupNote(opponentTeam, options={}){
    const week=weekKey(options.weekKey||options.week||'Unassigned');
    const rows=await getMatchupNotes(opponentTeam,options);
    const exact=rows.find(row=>weekKey(row.week_key)===week);
    if(exact)return exact;
    const legacy=rows.find(row=>weekKey(row.week_key)==='legacy');
    if(week!=='legacy' && legacy && options.includeLegacy!==false)return {...legacy,legacyFallback:true};
    return null;
  }

  async function setMatchupNote(opponentTeam,content,options={}){
    const db=client(), league=options.leagueId||leagueId(), season=options.seasonId||seasonId();
    const opponent=String(opponentTeam||'').trim();
    const week=weekKey(options.weekKey||options.week||'Unassigned');
    const user=(await db.auth.getUser()).data.user;
    if(user)activeUserId=user.id;
    if(!user||!league||!season||!opponent)throw new Error('A selected league, season, and opponent are required for matchup notes.');
    const row={user_id:user.id,league_id:league,season_id:season,note_type:'matchup',opponent_team:opponent,species:null,week_key:week,scope_key:scopeKey(opponent),content:String(content??'')};
    const {data,error}=await db.from('match_prep_notes').upsert(row,{onConflict:'user_id,league_id,season_id,note_type,scope_key,week_key'}).select('*').single();
    if(error)throw error;
    CACHE.set(cacheKey('matchup',league,season,opponent,week),data);
    // Do not erase a newer edit typed while this request was in flight.
    const pending=readDraft(league,season,opponent,week);
    if(!pending || pending.content===String(content??''))clearDraft(league,season,opponent,week);
    CACHE.delete(cacheKey('matchup-list',league,season,opponent,'all'));
    return data;
  }

  function clearCache(){CACHE.clear();}
  SBL.services.notes={getMatchupNote,getMatchupNotes,setMatchupNote,stageMatchupDraft,clearCache,scopeKey,weekKey};
  SBL.notes=SBL.services.notes;
})();
