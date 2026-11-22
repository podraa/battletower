/* SBL STATS SERVICE — Phase 2
 *
 * Canonical Pokémon statistics layer. Replay records are normalized once here
 * and every Stats view consumes the same Pokémon-stat object.
 */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  const SBL=window.SBL;

  function rawIdentity(name){
    let id=String(name??'').trim().toLowerCase()
      .replace(/[’']/g,'').replace(/[♀]/g,'-f').replace(/[♂]/g,'-m')
      .replace(/[.:]/g,'').replace(/_/g,'-').replace(/\s+/g,'-')
      .replace(/-+/g,'-').replace(/^-|-$/g,'');
    id=id.replace(/-(forme|form|style)$/,'');
    const typo={scovilalian:'scovillain',scovillian:'scovillain',scovilion:'scovillain'};
    return typo[id]||id;
  }

  // Canonical Mega identity: both public-facing "Mega Charizard X" and
  // Showdown "Charizard-Mega-X" must select the SAME row/profile.
  function identity(name){
    if(SBL.domain?.pokemonKey)return SBL.domain.pokemonKey(name);
    const id=rawIdentity(name);
    let m=id.match(/^mega-(.+?)-([xyz])$/);
    if(m) return `${m[1]}-mega-${m[2]}`;
    m=id.match(/^mega-(.+)$/);
    if(m) return `${m[1]}-mega`;
    m=id.match(/^(.+)-mega([xyz])$/);
    if(m) return `${m[1]}-mega-${m[2]}`;
    m=id.match(/^primal-(kyogre|groudon)$/);
    if(m) return `${m[1]}-primal`;
    return id;
  }
  function permanentFormBaseIdentity(name){
    const id=identity(name);
    let m=id.match(/^(.+)-mega(?:-(?:x|y|z))?$/);
    if(m) return m[1];
    m=id.match(/^(kyogre|groudon)-primal$/);
    return m ? m[1] : null;
  }
  function rosterSpeciesForSide(replay,side){
    return (replay?.teamRoster?.[side]||[]).map(x=>typeof x==='string'?x:String(x?.species||x?.name||'')).filter(Boolean);
  }
  function creditedSpeciesForRoster(replay,side,species){
    const exact=identity(species);
    const matches=Object.values(replay?.mons||{}).filter(m=>m?.side===side&&m?.species);
    if(matches.some(m=>identity(m.species)===exact)) return species;
    const megas=matches.filter(m=>permanentFormBaseIdentity(m.species)===exact);
    // Only substitute when the actual replay has exactly one Mega form for
    // this base. Never infer an evolution from a held Mega Stone or roster.
    return megas.length===1 ? megas[0].species : species;
  }
  function display(name){
    if(SBL.pokemon?.displayNameWithForm) return SBL.pokemon.displayNameWithForm(name);
    return String(name??'').trim();
  }

  function addNumber(obj,key,value){ obj[key]=(Number(obj[key])||0)+(Number(value)||0); }

  function empty(species){
    return {
      species,
      identity:identity(species),
      dealt:0,taken:0,directDamage:0,indirectDamage:0,
      kills:0,deaths:0,assists:0,switches:0,leads:0,
      games:0,appearances:0,
      killLog:[],deathLog:[],assistLog:[],
      coaches:new Set(),replays:new Set()
    };
  }

  function replayDate(replay){
    return Number(replay?.uploadtime||replay?.processedAt||replay?.createdAt||0)||0;
  }

  function normalizeLog(entry,replay,fallbackType){
    const x=entry && typeof entry==='object' ? entry : {};
    return {
      ...x,
      replayId:String(x.replayId||x.replay||x.id||replay?.id||''),
      replayDate:Number(x.replayDate||replayDate(replay))||0,
      turn:Number(x.turn||x.turnNumber||0)||0,
      victim:x.victim==null?'':String(x.victim),
      killer:x.killer==null?'':String(x.killer),
      cause:x.cause==null?'':String(x.cause),
      // Assist records from older/newer parser revisions have used several
      // field names. Prefer the canonical fields, but preserve the actual
      // contribution when it was stored under an alternate name. In particular,
      // Item Removed assists must never be rendered as 0 merely because the UI
      // expected `damage` while the record contains `damageAtRemoval` or
      // `damageContribution`.
      damage:(() => {
        const values=[x.damage,x.damageAtRemoval,x.damageContribution,x.damageDealt,x.dealt,x.amount];
        const firstPositive=values.find(v=>Number.isFinite(Number(v)) && Number(v)>0);
        const firstNumeric=values.find(v=>Number.isFinite(Number(v)));
        return Number(firstPositive ?? firstNumeric ?? 0) || 0;
      })(),
      percent:(() => {
        const values=[x.percent,x.share,x.damagePercent,x.damageShare,x.percentDamage,x.contributionPercent];
        const firstPositive=values.find(v=>Number.isFinite(Number(v)) && Number(v)>0);
        const firstNumeric=values.find(v=>Number.isFinite(Number(v)));
        return Number(firstPositive ?? firstNumeric ?? 0) || 0;
      })(),
      type:x.type||fallbackType
    };
  }

  // The single place where one processed replay mon becomes canonical Stats data.
  function mergeMon(row,mon,replay,options={}){
    const totalDamage=Number(mon?.damageDealt)||0;
    const directDamage=Number(mon?.directDamage)||0;
    const indirectDamage=Number(mon?.indirectDamage)||0;
    const isLegacy=Number(replay?.parserVersion||0)<3;

    addNumber(row,'dealt',isLegacy ? totalDamage : (directDamage+indirectDamage));
    addNumber(row,'taken',mon?.damageTaken);
    addNumber(row,'directDamage',isLegacy ? totalDamage : directDamage);
    addNumber(row,'indirectDamage',isLegacy ? 0 : indirectDamage);
    addNumber(row,'switches',mon?.switches);
    addNumber(row,'leads',mon?.leads);
    addNumber(row,'kills',mon?.kills);
    addNumber(row,'deaths',mon?.deaths);
    addNumber(row,'assists',Array.isArray(mon?.assistLog) ? mon.assistLog.length : mon?.assists);
    const effectiveAppearance=options.appearanceOverride!=null ? Number(options.appearanceOverride)||0 : (Number(mon?.appearances)||0);
    addNumber(row,'games',effectiveAppearance);
    addNumber(row,'appearances',effectiveAppearance);

    if(replay?.id) row.replays.add(replay.id);
    if(typeof options.teamFor==='function'){
      const team=options.teamFor(replay?.players?.[mon?.side]);
      if(team) row.coaches.add(team);
    }

    if(Array.isArray(mon?.killLog)) row.killLog.push(...mon.killLog.map(x=>normalizeLog(x,replay,'kill')));
    if(Array.isArray(mon?.deathLog)) row.deathLog.push(...mon.deathLog.map(x=>normalizeLog(x,replay,'death')));
    if(Array.isArray(mon?.assistLog)) row.assistLog.push(...mon.assistLog.map(x=>normalizeLog(x,replay,'assist')));

    return row;
  }

  // Canonical Pokémon aggregation. Returns a Map keyed by normalized species.
  function pokemonStats(replays,options={}){
    const out=new Map();
    const includeForms=options.includeForms!==false;

    for(const replay of Array.isArray(replays)?replays:[]){
      for(const mon of Object.values(replay?.mons||{})){
        if(!mon?.species) continue;
        const key=includeForms ? identity(mon.species) : identity(display(mon.species));
        if(!key) continue;

        let row=out.get(key);
        if(!row){
          row=empty(display(mon.species));
          out.set(key,row);
        }

        // Preserve the site's existing display convention: identity determines
        // grouping, while the first/available form-aware display name is shown.
        row.species=display(mon.species)||row.species;
        const roster=rosterSpeciesForSide(replay,mon?.side);
        const inSubmittedTeam=roster.some(x=>identity(creditedSpeciesForRoster(replay,mon.side,x))===identity(mon.species));
        mergeMon(row,mon,replay,{...options,appearanceOverride:inSubmittedTeam?1:undefined});
      }
      // Legacy processed replays may have teamRoster but only contain Pokémon
      // that were actually sent out in `mons`. Seed the missing submitted-team
      // members so sitewide appearance stats still mean "brought this week".
      for(const side of ['p1','p2']){
        for(const raw of rosterSpeciesForSide(replay,side)){
          const species=creditedSpeciesForRoster(replay,side,raw);
          if(!species) continue;
          const key=includeForms ? identity(species) : identity(display(species));
          if(!key) continue;
          const already=[...Object.values(replay?.mons||{})].some(mon=>mon?.side===side && mon?.species && identity(mon.species)===key);
          if(already) continue;
          let row=out.get(key);
          if(!row){row=empty(display(species));out.set(key,row);}
          row.species=display(species)||row.species;
          mergeMon(row,{species,side,appearances:1},replay,{...options,appearanceOverride:1});
        }
      }
    }

    return out;
  }

  // Non-blocking variant for large dashboards. The synchronous `pokemon()` API
  // remains available for existing views, while search/autocomplete surfaces can
  // build the same canonical data in small chunks so typing never competes with
  // a full-replay aggregation on the main thread.
  function pokemonAsync(replays,options={},chunkSize=12){
    const source=Array.isArray(replays)?replays:[];
    const out=new Map();
    const includeForms=options.includeForms!==false;
    const teamFor=options.teamFor;
    return new Promise(resolve=>{
      let index=0;
      const step=()=>{
        const end=Math.min(index+Math.max(1,Number(chunkSize)||12),source.length);
        for(;index<end;index++){
          const replay=source[index];
          for(const mon of Object.values(replay?.mons||{})){
            if(!mon?.species) continue;
            const key=includeForms ? identity(mon.species) : identity(display(mon.species));
            if(!key) continue;
            let row=out.get(key);
            if(!row){ row=empty(display(mon.species)); out.set(key,row); }
            row.species=display(mon.species)||row.species;
            const roster=rosterSpeciesForSide(replay,mon?.side);
            const inSubmittedTeam=roster.some(x=>identity(creditedSpeciesForRoster(replay,mon.side,x))===identity(mon.species));
            mergeMon(row,mon,replay,{...options,teamFor,appearanceOverride:inSubmittedTeam?1:undefined});
          }
          for(const side of ['p1','p2']){
            for(const raw of rosterSpeciesForSide(replay,side)){
              const species=creditedSpeciesForRoster(replay,side,raw);
              if(!species) continue;
              const key=includeForms ? identity(species) : identity(display(species));
              if(!key) continue;
              const already=[...Object.values(replay?.mons||{})].some(mon=>mon?.side===side && mon?.species && identity(mon.species)===key);
              if(already) continue;
              let row=out.get(key); if(!row){row=empty(display(species));out.set(key,row);}
              row.species=display(species)||row.species;
              mergeMon(row,{species,side,appearances:1},replay,{...options,teamFor,appearanceOverride:1});
            }
          }
        }
        if(index<source.length){
          if('requestIdleCallback' in window) window.requestIdleCallback(step,{timeout:80});
          else setTimeout(step,0);
          return;
        }
        resolve([...out.values()]
          .map(x=>({...x,coaches:new Set(x.coaches),replays:new Set(x.replays)}))
          .sort((a,b)=>Number(b.dealt||0)-Number(a.dealt||0)
            ||Number(b.kills||0)-Number(a.kills||0)
            ||String(a.species).localeCompare(String(b.species))));
      };
      step();
    });
  }

  function pokemon(replays,options={}){
    return [...pokemonStats(replays,options).values()]
      .map(x=>({...x,coaches:new Set(x.coaches),replays:new Set(x.replays)}))
      .sort((a,b)=>Number(b.dealt||0)-Number(a.dealt||0)
        ||Number(b.kills||0)-Number(a.kills||0)
        ||String(a.species).localeCompare(String(b.species)));
  }

  function getPokemonStats(species,replays,options={}){
    return pokemonStats(replays,options).get(identity(species)) || null;
  }

  function pokemonProfile(species,replays,options={}){
    const target=identity(species);
    const agg=empty(display(species));
    const weeksBrought=new Map();
    const source=pokemonStats(replays,options).get(target);

    if(source){
      Object.assign(agg,source);
      agg.coaches=new Set(source.coaches);
      agg.replays=new Set(source.replays);
      agg.killLog=[...source.killLog];
      agg.deathLog=[...source.deathLog];
      agg.assistLog=[...source.assistLog];
    }

    // Weeks brought is profile-specific metadata, so it remains calculated here
    // while all numerical Pokémon stats/log normalization comes from the canonical
    // aggregation above.
    for(const replay of Array.isArray(replays)?replays:[]){
      const found=Object.values(replay?.mons||{}).some(mon=>mon?.species && identity(mon.species)===target);
      if(found){
        const week=String(replay.week||'');
        if(week) weeksBrought.set(week,(weeksBrought.get(week)||0)+1);
      }
    }
    agg.weeksBrought=weeksBrought;
    return agg;
  }

  function team(replays,teamFor,weekFilter){
    const out=new Map();
    for(const replay of Array.isArray(replays)?replays:[]){
      for(const side of ['p1','p2']){
        const teamName=typeof teamFor==='function'?teamFor(replay.players?.[side]):'';
        if(!teamName) continue;
        const key=String(teamName).trim().toLowerCase();
        if(!out.has(key)) out.set(key,{team:teamName,games:0,wins:0,losses:0,kills:0,deaths:0,dealt:0,taken:0,players:new Set()});
        const row=out.get(key);
        row.games++;
        if(replay.players?.[side]) row.players.add(replay.players[side]);
        const result=replay.results?.[side] || (replay.winner && String(replay.winner).toLowerCase()===String(replay.players?.[side]||'').toLowerCase()?'W':(replay.winner?'L':null));
        if(result==='W') row.wins++; else if(result==='L') row.losses++;
        for(const mon of Object.values(replay.mons||{})) if(mon?.side===side){
          addNumber(row,'kills',mon.kills);
          addNumber(row,'deaths',mon.deaths);
          addNumber(row,'dealt',mon.damageDealt);
          addNumber(row,'taken',mon.damageTaken);
        }
      }
    }
    return [...out.values()];
  }

  function kda(row){
    const kills=Number(row?.kills)||0, deaths=Number(row?.deaths)||0, assists=Number(row?.assists)||0;
    return {kills,deaths,assists,ratio:deaths?((kills+assists)/deaths):null,kd:deaths?(kills/deaths):null};
  }

  function formatKD(kills,deaths) {
    const k=Number(kills)||0,d=Number(deaths)||0;
    return d>0?(k/d).toFixed(2):(k===0?'0.00':'—');
  }
  // Canonical per-franchise roster stats. This layer joins actual replay forms
  // to drafted base forms, so a rostered Greninja is not displayed as unused
  // when its battles are recorded as Greninja-Mega. This joins by team, side
  // and *actual form*; no nickname/species-alias cross-player substitutions.
  function franchiseRosterData(rosters,replays,teamFor) {
    const teams={};
    const keyTeam=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const monName=m=>typeof m==='string'?m:String(m?.name||m?.species||'');
    const newEntry=(species,points=null)=>({species:display(species),points,dealt:0,taken:0,kills:0,deaths:0,assists:0,appearances:0,games:0,killLog:[],deathLog:[]});
    for(const [teamName,members] of Object.entries(rosters||{})) {
      const row={name:teamName,roster:[],byKey:{},rosterBases:{},total:{dealt:0,taken:0,kills:0,deaths:0,appearances:0},linkedPlayers:new Set(),replayCount:0};
      for(const mon of Array.isArray(members)?members:[]) {
        const raw=monName(mon),id=identity(raw);
        if(!id||row.byKey[id])continue;
        const item=newEntry(raw,mon&&typeof mon==='object'?(mon.points??mon.cost??null):null);
        row.byKey[id]=item;row.roster.push(item);
        row.rosterBases[permanentFormBaseIdentity(raw)||id]=item.points;
      }
      teams[teamName]=row;
    }
    for(const replay of Array.isArray(replays)?replays:[]) {
      for(const side of ['p1','p2']) {
        const player=String(replay?.players?.[side]||'');
        const mapped=typeof teamFor==='function'?teamFor(player):'';
        const teamKey=Object.keys(teams).find(t=>keyTeam(t)===keyTeam(mapped));
        if(!teamKey)continue;
        const row=teams[teamKey];row.replayCount++;if(player)row.linkedPlayers.add(player);
        const observations=Object.values(replay?.mons||{}).filter(m=>m?.side===side&&m?.species);
        const findTarget=(species)=>{
          const id=identity(species);if(row.byKey[id])return row.byKey[id];
          const base=permanentFormBaseIdentity(species);
          if(base&&Object.prototype.hasOwnProperty.call(row.rosterBases,base)) {
            // Each permanent battle form owns a different season row. Moving a
            // drafted base's empty placeholder onto the first observed form is
            // safe; moving an already-scored row would incorrectly merge an
            // ordinary Mega, a Z-Mega, and a base-form battle.
            const seed=row.byKey[base];
            if(seed&&!seed.games&&!seed.appearances&&!seed.kills&&!seed.deaths&&!seed.dealt&&!seed.taken){
              row.roster=row.roster.filter(x=>x!==seed);delete row.byKey[base];
            }
            const target=newEntry(species,row.rosterBases[base]);
            row.byKey[id]=target;row.roster.push(target);
            return target;
          }
          if(Object.prototype.hasOwnProperty.call(row.rosterBases,id)) {
            // A base-form battle can occur after the season already recorded a
            // Mega form; restore a separate base row instead of merging forms.
            const target=newEntry(species,row.rosterBases[id]);
            row.byKey[id]=target;row.roster.push(target);return target;
          }
          return null;
        };
        const counted=new Set();
        const teamPreview=(replay?.teamRoster?.[side]||[]).map(monName).filter(Boolean);
        for(const mon of observations) {
          const target=findTarget(mon.species);if(!target)continue;
          const total=Number(mon.damageDealt)||0,direct=Number(mon.directDamage)||0,indirect=Number(mon.indirectDamage)||0;
          target.dealt+=Number(replay.parserVersion||0)>=3 ? direct+indirect : total;
          target.taken+=Number(mon.damageTaken)||0;
          target.kills+=Number(mon.kills)||0;
          target.deaths+=Number(mon.deaths)||0;
          target.assists+=Array.isArray(mon.assistLog)?mon.assistLog.length:(Number(mon.assists)||0);
          if(Array.isArray(mon.killLog))target.killLog.push(...mon.killLog);
          if(Array.isArray(mon.deathLog))target.deathLog.push(...mon.deathLog);
          const seenKey=identity(target.species);
          if(!counted.has(seenKey)) {
            const brought=teamPreview.length?teamPreview.some(sp=>{
              const k=identity(sp);return k===seenKey||k===permanentFormBaseIdentity(target.species);
            }):true;
            const appearances=brought?1:(Number(mon.appearances)||0);
            target.appearances+=appearances;target.games+=appearances;counted.add(seenKey);
          }
        }
        for(const raw of teamPreview) {
          const id=identity(creditedSpeciesForRoster(replay,side,raw));
          const target=findTarget(id)||row.byKey[identity(raw)];
          if(!target)continue;
          const statKey=identity(target.species);
          if(!counted.has(statKey)){target.appearances++;target.games++;counted.add(statKey);}
        }
      }
    }
    for(const team of Object.values(teams))for(const item of team.roster){
      for(const metric of ['dealt','taken','kills','deaths','appearances'])team.total[metric]+=item[metric];
    }
    return teams;
  }
  function franchisePokemonStat(rosters,replays,teamFor,teamName,species) {
    const teams=franchiseRosterData(rosters,replays,teamFor);
    const keyTeam=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const t=Object.keys(teams).find(k=>keyTeam(k)===keyTeam(teamName));
    const roster=t?teams[t].roster:[];
    const wanted=identity(species);
    return roster.find(r=>identity(r.species)===wanted) ||
      roster.find(r=>permanentFormBaseIdentity(r.species)===wanted) ||null;
  }

  SBL.stats={identity,pokemon,pokemonAsync,pokemonStats,getPokemonStats,pokemonProfile,team,kda,formatKD,franchiseRosterData,franchisePokemonStat};
})();
