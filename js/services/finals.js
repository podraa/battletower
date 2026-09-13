(function(){
  const SBL = window.SBL = window.SBL || {};

  function key(v){ return String(v||'').trim().toLowerCase(); }
  function mondayISO(date){
    const d = new Date(date);
    d.setHours(12,0,0,0);
    const day = d.getDay();
    const delta = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate()+delta);
    return d.toISOString().slice(0,10);
  }
  function addDays(iso, days){
    const d=new Date(`${iso}T12:00:00`); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10);
  }
  function roundWindow(startMonday, roundIndex){
    const start=addDays(startMonday, roundIndex*7), end=addDays(start,6);
    const fmt=(iso)=>new Date(`${iso}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'});
    return {start,end,label:`${fmt(start)} – ${fmt(end)}`};
  }
  function defaultFinalsState(){
    return {status:'inactive', startMonday:null, generatedAt:null, releasedAt:null, seeds:[], rounds:[], champion:null, updatedAt:null};
  }
  function normalizeFinalsState(raw){
    const f=Object.assign(defaultFinalsState(), raw||{});
    f.releasedAt=f.releasedAt?String(f.releasedAt):null;
    f.seeds=Array.isArray(f.seeds)?f.seeds.map((s,i)=>({seed:Number(s.seed)||i+1,conference:s.conference||'',conferenceSeed:Number(s.conferenceSeed)||null,team:String(s.team||'')})).filter(s=>s.team):[];
    f.rounds=Array.isArray(f.rounds)?f.rounds.map(r=>({
      key:String(r.key||''), name:String(r.name||''), start:String(r.start||''), end:String(r.end||''), label:String(r.label||''),
      matches:Array.isArray(r.matches)?r.matches.map(m=>({
        id:String(m.id||''), seedA:m.seedA==null?null:Number(m.seedA), seedB:m.seedB==null?null:Number(m.seedB),
        teamA:m.teamA||null, teamB:m.teamB||null, winner:m.winner||null, scoreA:m.scoreA==null||m.scoreA===''?null:Number(m.scoreA), scoreB:m.scoreB==null||m.scoreB===''?null:Number(m.scoreB), status:m.status||'pending',
        source:m.source||'bracket', note:m.note||''
      })):[]
    })):[];
    if(!['inactive','scheduled','live','complete'].includes(f.status)) f.status='inactive';
    f.startMonday=f.startMonday?mondayISO(f.startMonday):null;
    return f;
  }
  // Automatic Finals seeding:
  // - The top 6 from each conference qualify.
  // - The conference champion / #1 seed from each conference is guaranteed
  //   one of the first two overall seeds (one per conference).
  // - Seeds #3 and #4 are NOT the second-place teams from each conference.
  //   They are simply the two best records among the remaining ten qualifiers.
  // - Seeds #5-#12 are then the remaining qualifiers ordered by the normal
  //   standings tiebreaks.
  // This is deliberately separate from the manual seed editor: admins can
  // override every seed manually when generating Finals.
  function makeSeedList(confA, confB){
    const a=(confA||[]).slice(0,6).filter(Boolean);
    const b=(confB||[]).slice(0,6).filter(Boolean);
    const qualified=[...a.map((x,i)=>({...x,conference:'a',conferenceSeed:i+1})),
      ...b.map((x,i)=>({...x,conference:'b',conferenceSeed:i+1}))];
    const byTeam=new Map(qualified.map(x=>[key(x.team),x]));
    const winners=[];
    if(a[0]) winners.push(a[0]);
    if(b[0]) winners.push(b[0]);

    const compare=(x,y)=>
      Number(y.wins||0)-Number(x.wins||0) ||
      Number(y.diff||0)-Number(x.diff||0) ||
      Number(y.dealt||0)-Number(x.dealt||0) ||
      String(x.team||'').localeCompare(String(y.team||''),undefined,{sensitivity:'base'});

    const remaining=qualified.filter(x=>!winners.some(w=>key(w.team)===key(x.team))).sort(compare);
    const firstFour=[...winners.sort((x,y)=>String(x.conference).localeCompare(String(y.conference))),...remaining.slice(0,2)];
    const used=new Set(firstFour.map(x=>key(x.team)));
    const rest=qualified.filter(x=>!used.has(key(x.team))).sort(compare);
    const ordered=[...firstFour,...rest].slice(0,12);
    return ordered.map((x,i)=>({
      seed:i+1,
      conference:x.conference||'',
      conferenceSeed:Number(x.conferenceSeed)||null,
      team:x.team
    }));
  }
  function match(id,seedA,seedB,teamA=null,teamB=null){ return {id,seedA,seedB,teamA,teamB,winner:null,status:'pending',source:'bracket'}; }
  function validateSeeds(seeds){
    const s=(seeds||[]).map((x,i)=>({seed:Number(x.seed)||i+1,team:String(x.team||'').trim()})).sort((a,b)=>a.seed-b.seed);
    if(s.length!==12) throw new Error('Finals require exactly 12 seeds.');
    const numbers=s.map(x=>x.seed);
    if(numbers.some((n,i)=>n!==i+1)) throw new Error('Finals seeds must be numbered 1 through 12.');
    if(s.some(x=>!x.team)) throw new Error('Every seed must have a team.');
    const seen=new Set();
    for(const x of s){ const k=key(x.team); if(seen.has(k)) throw new Error(`A team cannot occupy more than one seed: ${x.team}.`); seen.add(k); }
    return s;
  }
  function generate(startMonday, seeds){
    const s=validateSeeds(seeds);
    const seedMap=Object.fromEntries(s.map(x=>[x.seed,x.team]));
    const rounds=[
      {key:'playin',name:'Play-In',...roundWindow(startMonday,0),matches:[match('pi-5-12',5,12,seedMap[5],seedMap[12]),match('pi-6-11',6,11,seedMap[6],seedMap[11]),match('pi-7-10',7,10,seedMap[7],seedMap[10]),match('pi-8-9',8,9,seedMap[8],seedMap[9])]},
      {key:'quarterfinals',name:'Quarterfinals',...roundWindow(startMonday,1),matches:[match('qf-1-89',1,null,seedMap[1],null),match('qf-4-5-12',4,null,seedMap[4],null),match('qf-2-7-10',2,null,seedMap[2],null),match('qf-3-6-11',3,null,seedMap[3],null)]},
      {key:'semifinals',name:'Semifinals',...roundWindow(startMonday,2),matches:[match('sf-1-4',1,4,null,null),match('sf-2-3',2,3,null,null)]},
      {key:'grandfinal',name:'Grand Final',...roundWindow(startMonday,3),matches:[match('gf-1-2',1,2,null,null)]}
    ];
    const now=new Date().toISOString();
    return {status:'scheduled',startMonday,generatedAt:now,releasedAt:now,seeds:s.map(x=>({...x,conference:'',conferenceSeed:null})),rounds,champion:null,updatedAt:now};
  }
  function resolveMatchups(finals){
    const f=normalizeFinalsState(finals);
    const seedTeam=s=>f.seeds.find(x=>Number(x.seed)===Number(s))?.team||null;
    const getMatch=(roundKey,id)=>f.rounds.find(r=>r.key===roundKey)?.matches.find(m=>m.id===id)||null;
    const winnerOf=(roundKey,id)=>getMatch(roundKey,id)?.winner||null;
    const setTeams=(m,a,b)=>{ if(m){m.teamA=a||null;m.teamB=b||null;} };
    const pi={
      '5-12':winnerOf('playin','pi-5-12'),'6-11':winnerOf('playin','pi-6-11'),'7-10':winnerOf('playin','pi-7-10'),'8-9':winnerOf('playin','pi-8-9')
    };
    const qf=f.rounds.find(r=>r.key==='quarterfinals');
    if(qf){
      // The four play-in winners do NOT stay attached to their original
      // play-in matchup. Once all four play-ins are complete, rank the
      // winners by their original seed (highest numeric seed = lowest seed)
      // and pair them against the four bye teams from best seed to worst:
      //   lowest-seeded play-in winner -> #1
      //   next-lowest -> #2
      //   next-lowest -> #3
      //   highest-seeded -> #4
      // Until all four play-ins are complete, leave the play-in side TBD.
      const playInWinners=Object.entries(pi)
        .map(([source,winner])=>({source,winner,seed:Number(String(winner||'').trim())||null}))
        .filter(x=>x.winner)
        .map(x=>{
          const original=f.seeds.find(s=>key(s.team)===key(x.winner));
          return {...x,seed:original?.seed??null};
        })
        .filter(x=>Number.isFinite(x.seed))
        .sort((a,b)=>b.seed-a.seed);
      const complete=playInWinners.length===4;
      const byeSeeds=[1,2,3,4];
      qf.matches.forEach((m,i)=>{
        const byeSeed=byeSeeds[i];
        const winner=complete?playInWinners[i]?.winner:null;
        setTeams(m,seedTeam(byeSeed),winner);
        m.seedA=byeSeed;
        m.seedB=complete?(playInWinners[i]?.seed??null):null;
        m.source=complete?`playin:${playInWinners[i].source}`:'playin:pending';
      });
    }
    const sf=f.rounds.find(r=>r.key==='semifinals');
    if(sf){
      setTeams(sf.matches.find(m=>m.id==='sf-1-4'),winnerOf('quarterfinals','qf-1-89'),winnerOf('quarterfinals','qf-4-5-12'));
      setTeams(sf.matches.find(m=>m.id==='sf-2-3'),winnerOf('quarterfinals','qf-2-7-10'),winnerOf('quarterfinals','qf-3-6-11'));
    }
    const gf=f.rounds.find(r=>r.key==='grandfinal');
    if(gf){ setTeams(gf.matches[0],winnerOf('semifinals','sf-1-4'),winnerOf('semifinals','sf-2-3')); }
    return f;
  }
  function setWinner(finals,roundKey,matchId,winner){
    return setResult(finals,roundKey,matchId,{winner});
  }
  function setResult(finals,roundKey,matchId,result={}){
    const f=resolveMatchups(finals);
    const r=f.rounds.find(x=>x.key===roundKey); if(!r) throw new Error('Finals round not found.');
    const m=r.matches.find(x=>x.id===matchId); if(!m) throw new Error('Finals match not found.');
    const allowed=[m.teamA,m.teamB].filter(Boolean);
    let winner=result.winner||null;
    const hasA=result.scoreA!==undefined && result.scoreA!==null && result.scoreA!=='';
    const hasB=result.scoreB!==undefined && result.scoreB!==null && result.scoreB!=='';
    if(hasA || hasB){
      if(!hasA || !hasB) throw new Error('Enter both scores.');
      const a=Number(result.scoreA), b=Number(result.scoreB);
      if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0||!Number.isInteger(a)||!Number.isInteger(b)) throw new Error('Scores must be non-negative whole numbers.');
      if(a===b) throw new Error('A Finals match cannot be tied.');
      m.scoreA=a; m.scoreB=b;
      winner=a>b?m.teamA:m.teamB;
    } else if(result.clearScore){
      m.scoreA=null; m.scoreB=null;
    }
    if(!winner || !allowed.some(x=>key(x)===key(winner))) throw new Error('Winner must be one of the teams in this match.');
    const previousWinner=m.winner;
    if(result.clearScore){ m.scoreA=null; m.scoreB=null; }
    m.winner=allowed.find(x=>key(x)===key(winner)); m.status='complete';
    if(previousWinner && key(previousWinner)!==key(m.winner)){
      const idx=f.rounds.findIndex(x=>x.key===roundKey);
      for(let i=idx+1;i<f.rounds.length;i++) for(const later of f.rounds[i].matches){ later.winner=null; later.status='pending'; }
      f.champion=null;
    }
    f.champion=roundKey==='grandfinal'?m.winner:null;
    const hasPending=f.rounds.some(x=>x.matches.some(y=>y.status!=='complete'));
    f.status=f.champion?'complete':(hasPending?'live':'scheduled');
    f.updatedAt=new Date().toISOString();
    return resolveMatchups(f);
  }
  function clearWinner(finals,roundKey,matchId){
    const f=normalizeFinalsState(finals), r=f.rounds.find(x=>x.key===roundKey), m=r?.matches.find(x=>x.id===matchId);
    if(!m) return f;
    const affectedSeeds=[];
    m.winner=null;m.status='pending';
    f.champion=null;
    // Clearing a match invalidates every later-round result; retaining those would create impossible brackets.
    const idx=f.rounds.findIndex(x=>x.key===roundKey);
    for(let i=idx+1;i<f.rounds.length;i++) for(const later of f.rounds[i].matches){ later.winner=null;later.status='pending'; }
    f.status='live';f.updatedAt=new Date().toISOString();
    return resolveMatchups(f);
  }
  SBL.finals={defaultFinalsState,normalizeFinalsState,mondayISO,addDays,roundWindow,makeSeedList,validateSeeds,generate,resolveMatchups,setWinner,setResult,clearWinner};
})();
