(function(){
  'use strict';
  const SBL=window.SBL=window.SBL||{};

  function key(v){
    return String(v||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  }
  function weekNumber(v){
    const m=String(v||'').match(/(\d+)/);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  }
  function compareWeeks(a,b){
    const na=weekNumber(a), nb=weekNumber(b);
    if(na!==nb) return na-nb;
    return String(a||'').localeCompare(String(b||''),undefined,{numeric:true,sensitivity:'base'});
  }
  function rows(replays){
    if(Array.isArray(replays)) return replays;
    return Object.values(replays||{});
  }
  function teamFor(value,teamMap){
    const raw=String(value||'').trim();
    if(!raw) return '';
    return (teamMap&&typeof teamMap==='object' ? teamMap[raw.toLowerCase()] : null) || raw;
  }
  function replayPlayed(replays,teamMap,week,home,away){
    const h=key(home), a=key(away);
    return rows(replays).some(r=>{
      if(!r || String(r.week||'Unassigned')!==String(week||'Unassigned') || !r.players) return false;
      const p1=key(teamFor(r.players.p1,teamMap)), p2=key(teamFor(r.players.p2,teamMap));
      return (p1===h&&p2===a) || (p1===a&&p2===h);
    });
  }
  function currentFixtureWeek(rounds,replays,teamMap){
    const ordered=(rounds||[]).slice().sort((a,b)=>compareWeeks(a?.week,b?.week));
    for(const round of ordered){
      const matches=Array.isArray(round?.matches)?round.matches:[];
      if(matches.some(m=>m && !replayPlayed(replays,teamMap,round.week,m.home,m.away))) return round.week;
    }
    return ordered.length ? ordered[ordered.length-1].week : null;
  }
  function noUpcoming(){
    return {status:'none',opponent:null,week:null,label:'Eliminated / no upcoming battle'};
  }
  function nextOpponentForTeam(team,settings={},replays={},teamMap={}){
    const target=key(team);
    if(!target) return noUpcoming();

    const finals=SBL.finals?.resolveMatchups ? SBL.finals.resolveMatchups(settings?.finals||{}) : null;
    if(finals && finals.status!=='inactive'){
      for(const round of (finals.rounds||[])){
        for(const match of (round.matches||[])){
          if(match?.winner || !match?.teamA || !match?.teamB) continue;
          if(key(match.teamA)===target) return {status:'upcoming',opponent:match.teamB,week:round.name||round.key,label:round.name||round.key};
          if(key(match.teamB)===target) return {status:'upcoming',opponent:match.teamA,week:round.name||round.key,label:round.name||round.key};
        }
      }
      return noUpcoming();
    }

    const rounds=Array.isArray(settings?.fixture?.rounds) ? settings.fixture.rounds : [];
    const currentWeek=currentFixtureWeek(rounds,replays,teamMap);
    if(currentWeek==null) return noUpcoming();
    const ordered=rounds.slice().sort((a,b)=>compareWeeks(a?.week,b?.week));
    for(const round of ordered){
      if(compareWeeks(round.week,currentWeek)<0) continue;
      for(const match of (round.matches||[])){
        if(key(match?.home)!==target && key(match?.away)!==target) continue;
        if(replayPlayed(replays,teamMap,round.week,match.home,match.away)) continue;
        return {status:'upcoming',opponent:key(match.home)===target?match.away:match.home,week:round.week,label:round.week};
      }
    }
    return noUpcoming();
  }

  SBL.schedule={nextOpponentForTeam};
})();
