/* Shared league-scoped workbook builders used by League Admin and Rosters. */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  const SBL=window.SBL;
  const key=value=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  const speciesKey=value=>SBL.pokemon?.matchKey?.(value)||String(value||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  const esc=value=>String(value??'').trim();
  const list=value=>Array.isArray(value)?value:[];
  function workbook(filename,sheets){
    if(!SBL.spreadsheetExport?.downloadWorkbook)throw new Error('Spreadsheet export service is unavailable.');
    return SBL.spreadsheetExport.downloadWorkbook(filename,sheets);
  }
  function normalizeRoster(rosters){
    const out={};
    Object.entries(rosters||{}).forEach(([team,mons])=>{
      out[team]=list(mons).map(mon=>typeof mon==='string'?{name:mon,points:null}:{...mon,name:String(mon?.name??mon?.species??'').trim()}).filter(mon=>mon.name);
    });
    return out;
  }
  function activeFranchiseNames(context){
    const supplied=list(context.activeFranchises||context.franchises);
    return [...new Map(supplied.map(item=>{
      const name=String(typeof item==='string'?item:item?.name||'').trim();
      return [key(name),name];
    }).filter(([k,name])=>k&&name))].map(([,name])=>name).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
  }
  function rosterFor(rosters,team){
    const entry=Object.entries(rosters||{}).find(([name])=>key(name)===key(team));
    return list(entry?.[1]);
  }
  function pointBudget(settings,team){
    const draft=settings?.draft||{};
    const exact=Object.entries(draft.budgets||{}).find(([name])=>key(name)===key(team))?.[1];
    return Number.isFinite(Number(exact))?Number(exact):(Number(draft.defaultBudget)||115);
  }
  function ownerLabel(context,team){
    const direct=Object.entries(context.ownerLabels||{}).find(([name])=>key(name)===key(team))?.[1];
    if(direct)return String(direct);
    return SBL.teamColors?.ownerLabel?.(context.teamMap||{},team)||'';
  }
  function conferenceFor(context,team){
    const row=list(context.franchises).find(item=>key(item?.name)===key(team));
    const raw=String(row?.conference||'').trim();
    if(raw){
      const names=context.settings?.conferenceNames||{};
      return String(names[raw.toLowerCase()]||names[raw]||((raw.toLowerCase()==='a'||raw.toLowerCase()==='b')?`Conference ${raw.toUpperCase()}`:raw));
    }
    const legacy=Object.entries(context.settings?.franchises||{}).find(([name])=>key(name)===key(team))?.[1];
    if(legacy==='a'||legacy==='b')return String(context.settings?.conferenceNames?.[legacy]||`Conference ${legacy.toUpperCase()}`);
    return 'Unassigned';
  }
  function seasonFilename(settings){return String(settings?.activeSeason||'Current-Season').replace(/[^a-z0-9-_]+/gi,'-');}

  function downloadDraftBoard(context={}){
    const settings=context.settings||{},rosters=normalizeRoster(context.rosters||settings.rosters||{});
    const board=new Map();
    list(settings.draft?.pool).forEach(mon=>{if(mon?.name)board.set(speciesKey(mon.name),{...mon,_inAvailablePool:false});});
    list(settings.freeAgency?.mons).forEach(mon=>{
      if(!mon?.name)return;
      const id=speciesKey(mon.name),prior=board.get(id)||{};
      board.set(id,{...prior,...mon,_inAvailablePool:true});
    });
    const picks=list(settings.draft?.picks);
    const owned=new Map();
    Object.entries(rosters).forEach(([team,mons])=>mons.forEach(mon=>owned.set(speciesKey(mon.name),team)));
    const takenStyle={fill:{patternType:'solid',fgColor:{rgb:'FCE4D6'}},font:{bold:true,color:{rgb:'9C0006'}},alignment:{vertical:'center',wrapText:true}};
    const availableStyle={fill:{patternType:'solid',fgColor:{rgb:'E2F0D9'}},font:{bold:true,color:{rgb:'38761D'}},alignment:{vertical:'center',wrapText:true}};
    const offBoardStyle={fill:{patternType:'solid',fgColor:{rgb:'E7E6E6'}},font:{color:{rgb:'666666'}},alignment:{vertical:'center',wrapText:true}};
    const rows=[...board.values()].map((mon,index)=>{
      const pick=picks.find(item=>speciesKey(item?.name||item?.pokemon||item?.species)===speciesKey(mon.name));
      const currentOwner=String(owned.get(speciesKey(mon.name))||'');
      const draftedBy=String(mon.draftedBy||pick?.team||pick?.franchise||'');
      const isAvailable=!!mon._inAvailablePool&&!currentOwner;
      const status=currentOwner?`TAKEN BY ${currentOwner}`:isAvailable?(draftedBy?`AVAILABLE · previously drafted by ${draftedBy}`:'AVAILABLE'):(draftedBy?`TAKEN BY ${draftedBy}`:'OFF BOARD');
      const style=currentOwner||(!isAvailable&&draftedBy)?takenStyle:isAvailable?availableStyle:offBoardStyle;
      return {mon,index,currentOwner,draftedBy,isAvailable,status,pickNumber:mon.pickNumber??pick?.pickNumber??pick?.pick_number??'',statusStyle:style};
    }).sort((a,b)=>(Number(b.mon.points)||0)-(Number(a.mon.points)||0)||String(a.mon.name).localeCompare(String(b.mon.name))||a.index-b.index);
    if(!rows.length)throw new Error('There is no published Free Agency or draft board to export.');
    const tiers=new Map();
    rows.forEach(item=>{
      const tier=item.mon.points==null||item.mon.points===''?'COST TBD':`${Number(item.mon.points)||0} POINT${Number(item.mon.points)===1?'':'S'}`;
      if(!tiers.has(tier))tiers.set(tier,[]);tiers.get(tier).push(item);
    });
    const tierEntries=[...tiers.entries()].sort((a,b)=>a[0]==='COST TBD'?1:b[0]==='COST TBD'?-1:Number(b[0].split(' ')[0])-Number(a[0].split(' ')[0]));
    const grid=[tierEntries.map(([label])=>label)],gridStyles=[];
    const max=Math.max(0,...tierEntries.map(([,items])=>items.length));
    for(let r=0;r<max;r++){
      const values=[];
      tierEntries.forEach(([,items],col)=>{
        const item=items[r];if(!item){values.push('');return;}
        const name=SBL.pokemon?.displayNameWithForm?.(item.mon.name)||item.mon.name;
        values.push(`${name}\n${item.status}`);
        gridStyles.push({row:grid.length,col,style:item.statusStyle});
      });
      grid.push(values);
    }
    const statKeys=['hp','atk','def','spa','spd','spe'];
    const headers=['Points','Pokémon','Type','Form','Status','Drafted by','Pick #','HP','Attack','Defense','Sp. Atk','Sp. Def','Speed','BST','Abilities'];
    const full=[headers],rowStyles={},cellStyles=[];
    rows.forEach(({mon,currentOwner,draftedBy,isAvailable,pickNumber,status,statusStyle})=>{
      const stats=statKeys.map(stat=>mon?.baseStats?.[stat]??mon?.stats?.[stat]??'');
      const types=list(mon.types).join(' / ');
      const abilities=list(mon.abilities).map(a=>typeof a==='string'?a:a?.name).filter(Boolean);
      const ri=full.length;
      full.push([mon.points==null?'':Number(mon.points),SBL.pokemon?.displayNameWithForm?.(mon.name)||mon.name,types,SBL.pokemon?.isMega?.(mon.name)||mon.isMega?'Mega':'Standard',status,draftedBy,pickNumber,...stats,stats.every(x=>x!==''&&Number.isFinite(Number(x)))?stats.reduce((sum,x)=>sum+Number(x),0):'', [...new Set(abilities)].join(', ')]);
      if(currentOwner||(!isAvailable&&draftedBy))rowStyles[ri]=takenStyle;
      cellStyles.push({row:ri,col:4,style:statusStyle});
    });
    return workbook(`Battle-Tower-${seasonFilename(settings)}-Free-Agency-Draft-Board.xlsx`,[
      {name:'Draft Board',rows:grid,widths:tierEntries.map(()=>28),cellStyles:gridStyles,rowHeights:grid.map((_,i)=>i===0?28:38),autoFilter:false},
      {name:'Full List',rows:full,widths:[10,25,18,12,14,25,10,9,11,11,11,11,11,9,34],rowStyles,cellStyles},
      {name:'Legend',rows:[['Status','Meaning'],['TAKEN BY [franchise]','Already drafted or appears on a published roster. Highlighted in pale red.'],['AVAILABLE','Included in the current Free Agency pool. Highlighted in pale green.'],['OFF BOARD','In the draft catalogue but not currently available and not owned.'],['Points','Current Free Agency point allocation.'],['Stats','Catalogue or draft-pool base stats; blank means unavailable.']],widths:[24,90],autoFilter:false}
    ]);
  }

  function downloadAllRosters(context={}){
    const settings=context.settings||{},rosters=normalizeRoster(context.rosters||settings.rosters||{});
    const teams=activeFranchiseNames(context);
    if(!teams.length)throw new Error('No actively assigned franchises are available to export.');
    const allRows=[['Conference','Franchise','Owner','Pokémon','Points','Mega','Draft pick']];
    const summary=[['Conference','Franchise','Owner','Pokémon count','Points spent','Budget','Budget remaining','Mega count']];
    const picks=list(settings.draft?.picks);
    const ordered=teams.slice().sort((a,b)=>conferenceFor(context,a).localeCompare(conferenceFor(context,b))||a.localeCompare(b));
    for(const team of ordered){
      const conf=conferenceFor(context,team),owner=ownerLabel(context,team);
      const mons=rosterFor(rosters,team).slice().sort((a,b)=>(Number(b.points)||0)-(Number(a.points)||0)||String(a.name).localeCompare(String(b.name)));
      const spent=mons.reduce((sum,mon)=>sum+(Number(mon.points)||0),0),budget=pointBudget(settings,team),megas=mons.filter(mon=>SBL.pokemon?.isMega?.(mon.name)).length;
      summary.push([conf,team,owner,mons.length,spent,budget,budget-spent,megas]);
      if(!mons.length)allRows.push([conf,team,owner,'','','','']);
      mons.forEach(mon=>{
        const pick=picks.find(item=>key(item?.team||item?.franchise||item?.franchiseName)===key(team)&&speciesKey(item?.name||item?.pokemon||item?.species)===speciesKey(mon.name));
        allRows.push([conf,team,owner,SBL.pokemon?.displayNameWithForm?.(mon.name)||mon.name,mon.points??'',SBL.pokemon?.isMega?.(mon.name)?'Yes':'No',pick?.pickNumber??pick?.pick_number??'']);
      });
    }
    return workbook(`Battle-Tower-${seasonFilename(settings)}-All-Rosters.xlsx`,[
      {name:'All Pokémon',rows:allRows,widths:[20,28,24,28,12,10,14]},
      {name:'Team Summary',rows:summary,widths:[20,28,24,16,14,12,20,12]}
    ]);
  }

  function replayScore(replay){
    if(!replay?.players)return null;
    const score={p1:0,p2:0};
    for(const side of ['p1','p2']){
      const roster=list(replay.teamRoster?.[side]);
      const normalize=value=>String(value||'').trim().toLowerCase().replace(/[-_]+/g,' ').replace(/\s+/g,' ');
      const unique=new Set(roster.map(normalize).filter(Boolean));
      let remaining=unique.size;
      if(unique.size){
        const fainted=new Set();
        Object.values(replay.mons||{}).forEach(mon=>{if(mon?.side===side&&Number(mon.deaths||0)>0)fainted.add(normalize(mon.species));});
        remaining=Math.max(0,unique.size-fainted.size);
      }
      score[side]=remaining;
    }
    return score;
  }
  function findResult(context,week,home,away){
    const group=value=>context.settings?.caseInsensitiveNames===false?String(value||'').trim():String(value||'').trim().toLowerCase();
    const target=new Set([group(home),group(away)]);
    for(const replay of Object.values(context.replays||{})){
      if(!replay?.players||(replay.week||'Unassigned')!==week)continue;
      const team1=SBL.domain?.replayTeamLabel?.({teamMap:context.teamMap||{},settings:context.settings||{}},replay.players.p1)||'';
      const team2=SBL.domain?.replayTeamLabel?.({teamMap:context.teamMap||{},settings:context.settings||{}},replay.players.p2)||'';
      const pair=new Set([group(team1),group(team2)]);
      if(pair.size!==2||![...pair].every(value=>target.has(value)))continue;
      let winner=null;
      const w=String(replay.winner||'').trim().toLowerCase();
      if(w&&w===String(replay.players.p1||'').trim().toLowerCase())winner=team1;
      else if(w&&w===String(replay.players.p2||'').trim().toLowerCase())winner=team2;
      const score=replayScore(replay)||{p1:0,p2:0};
      const homeIsP1=group(team1)===group(home);
      const homeScore=homeIsP1?score.p1:score.p2,awayScore=homeIsP1?score.p2:score.p1;
      const homeWon=winner&&group(winner)===group(home),awayWon=winner&&group(winner)===group(away);
      return {played:true,winner,homeScore,awayScore,winnerScore:homeWon?homeScore:awayWon?awayScore:null,loserScore:homeWon?awayScore:awayWon?homeScore:null};
    }
    return {played:false};
  }
  function downloadFixture(context={}){
    const settings=context.settings||{};
    const rounds=SBL.fixtureWorkflow?.publishedRounds?.(settings)||list(settings.fixture?.rounds);
    if(!rounds.length)throw new Error('There is no published fixture to export.');
    const rows=[['Week','Home franchise','Home conference','Away franchise','Away conference','Match type','Status','Winner','Winner score','Loser score','Home score','Away score']];
    const summary=[['Week','Matches','Inter-conference matches','Played','Remaining']],rowStyles={};
    const playedStyle={fill:{patternType:'solid',fgColor:{rgb:'E2F0D9'}},font:{color:{rgb:'274E13'}}};
    const interStyle={fill:{patternType:'solid',fgColor:{rgb:'DDEBF7'}},font:{color:{rgb:'1F4E78'}}};
    const confCode=team=>{
      const row=list(context.franchises).find(item=>key(item?.name)===key(team));
      if(row?.conference)return String(row.conference).toLowerCase();
      const value=Object.entries(settings.franchises||{}).find(([name])=>key(name)===key(team))?.[1];
      return value==='a'||value==='b'?value:'';
    };
    const confName=team=>conferenceFor(context,team);
    for(const round of rounds){
      const matches=list(round.matches);let interCount=0,playedCount=0;
      for(const match of matches){
        const home=String(match.home||''),away=String(match.away||''),hc=confCode(home),ac=confCode(away);
        const inter=!!hc&&!!ac&&hc!==ac;if(inter)interCount++;
        const result=findResult(context,String(round.week||''),home,away);if(result.played)playedCount++;
        const ri=rows.length;
        rows.push([String(round.week||''),home,confName(home),away,confName(away),inter?'Inter-conference':'Conference',result.played?'Played':'Not played',result.winner||'',result.played?(result.winnerScore??''):'',result.played?(result.loserScore??''):'',result.played?(result.homeScore??''):'',result.played?(result.awayScore??''):'']);
        if(result.played)rowStyles[ri]=playedStyle;else if(inter)rowStyles[ri]=interStyle;
      }
      summary.push([String(round.week||''),matches.length,interCount,playedCount,matches.length-playedCount]);
    }
    return workbook(`Battle-Tower-${seasonFilename(settings)}-Fixture.xlsx`,[
      {name:'Full Fixture',rows,widths:[14,28,20,28,20,20,16,28,14,14,14,14],rowStyles},
      {name:'Weekly Summary',rows:summary,widths:[16,14,24,14,14]}
    ]);
  }
  SBL.leagueExports=Object.freeze({downloadDraftBoard,downloadAllRosters,downloadFixture});
})();
