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
  const DRAFT_PREFIX='battle_tower_matchup_note_draft|';

  function client(){return SBL.getSupabase();}
  function leagueId(){return SBL.leagueDb?.selectedLeagueId?.()||'';}
  function seasonId(){return SBL.leagueDb?.selectedSeasonId?.()||'';}
  function scopeKey(value){return String(value||'').trim().toLowerCase().replace(/[-_]+/g,' ').replace(/\s+/g,' ');}
  function weekKey(value){return String(value||'Unassigned').trim()||'Unassigned';}
  function cacheKey(type,league,season,scope,week){return [type,league,season||'',scopeKey(scope),weekKey(week)].join('|');}
  function draftKey(league,season,opponent,week){return DRAFT_PREFIX+[league,season,scopeKey(opponent),scopeKey(week)].join('|');}
  function readDraft(league,season,opponent,week){try{const raw=localStorage.getItem(draftKey(league,season,opponent,week));return raw?JSON.parse(raw):null;}catch(_){return null;}}
  function writeDraft(league,season,opponent,week,content,updatedAt){try{localStorage.setItem(draftKey(league,season,opponent,week),JSON.stringify({content:String(content??''),updatedAt:updatedAt||new Date().toISOString()}));}catch(_){} }

  async function getMatchupNotes(opponentTeam, options={}){
    const league=options.leagueId||leagueId();
    const season=options.seasonId||seasonId();
    const opponent=String(opponentTeam||'').trim();
    if(!league||!season||!opponent)return [];
    const key=cacheKey('matchup-list',league,season,opponent,'all');
    if(CACHE.has(key))return CACHE.get(key);
    const db=client();
    const user=(await db.auth.getUser()).data.user;
    if(!user)return [];
    const {data,error}=await db.from('match_prep_notes').select('*')
      .eq('user_id',user.id).eq('league_id',league).eq('season_id',season)
      .eq('note_type','matchup').eq('scope_key',scopeKey(opponent))
      .order('updated_at',{ascending:false});
    if(error)throw error;
    const rows=Array.isArray(data)?data:[];
    const resolved=rows.map(row=>{
      const wk=weekKey(row.week_key);
      const draft=readDraft(league,season,opponent,wk);
      if(draft && Date.parse(draft.updatedAt||'')>Date.parse(row.updated_at||'')) return {...row,content:draft.content,updated_at:draft.updatedAt,localDraft:true};
      return row;
    });
    CACHE.set(key,resolved);
    return resolved;
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
    if(!user||!league||!season||!opponent)throw new Error('A selected league, season, and opponent are required for matchup notes.');
    const row={user_id:user.id,league_id:league,season_id:season,note_type:'matchup',opponent_team:opponent,species:null,week_key:week,scope_key:scopeKey(opponent),content:String(content??'')};
    const {data,error}=await db.from('match_prep_notes').upsert(row,{onConflict:'user_id,league_id,note_type,scope_key,week_key'}).select('*').single();
    if(error)throw error;
    CACHE.set(cacheKey('matchup',league,season,opponent,week),data);
    writeDraft(league,season,opponent,week,data?.content||'',data?.updated_at);
    CACHE.delete(cacheKey('matchup-list',league,season,opponent,'all'));
    return data;
  }

  function clearCache(){CACHE.clear();}
  SBL.services.notes={getMatchupNote,getMatchupNotes,setMatchupNote,clearCache,scopeKey,weekKey};
  SBL.notes=SBL.services.notes;
})();
