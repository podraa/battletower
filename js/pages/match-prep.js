
/* ===== Extracted inline Match Prep block 1 ===== */

(function(){
  // Shared calculator engine loader. The Damage Calculator has been removed,
  // but the Switch-In Analyser still needs @smogon/calc, so this loader is
  // kept and exposed on window for the rest of Match Prep to use.
  let calcEnginePromise=null;
  function normalizeCalcModule(mod){
    const candidates=[mod,mod?.default,mod?.default?.default];
    for(const c of candidates){
      if(c && typeof c.Pokemon==='function' && typeof c.Move==='function' && typeof c.calculate==='function' && c.Generations) return c;
    }
    return null;
  }
  async function getCalcEngine(){
    const existing=normalizeCalcModule(window.calc);
    if(existing){ window.calc=existing; return existing; }
    if(!calcEnginePromise){
      calcEnginePromise=import('https://cdn.jsdelivr.net/npm/@smogon/calc@0.11.0/+esm')
        .then(mod=>{
          const C=normalizeCalcModule(mod);
          if(!C) throw new Error('The Smogon calculator loaded, but its Pokemon/Move API was not exposed correctly.');
          window.calc=C;
          return C;
        })
        .catch(err=>{calcEnginePromise=null; throw err;});
    }
    return calcEnginePromise;
  }
  // Match Prep's Switch-In Analyser runs from the main Match Prep scope.
  window.getCalcEngine = getCalcEngine;
})();

/* ===== End block 1 ===== */

/* ===== Extracted inline Match Prep block 3 ===== */

(function(){
const STATE_ID='__dashboard_state__';

const supabase=window.SBL.getSupabase();
let STATE={profileUserId:'',replays:{},teamMap:{},settings:{caseInsensitiveNames:true,rosters:{}},profileTeam:'',compareOpponent:'',comparePokemon:'',setPokemon:'',prepSection:'overview',prepCoverageMon:'',prepSwitchAtkItem:'',prepSwitchDefItem:'',prepSwitchWeather:'',prepSwitchTerrain:'',prepSwitchHits:'',prepSwitchAtkEVs:{hp:0,atk:0,def:0,spa:0,spd:0,spe:0},prepSwitchAttackerSide:'opponent'};
const $=id=>document.getElementById(id);
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function norm(s){
  const raw=String(s??'').trim().toLowerCase().replace(/[-_]/g,' ');
  // A legacy replay contains Comfey with the species text reversed as "yefmoc".
  // Treat it as Comfey for all joins while preserving the replay statistics.
  if(raw.replace(/\s+/g,'')==='yefmoc') return 'comfey';
  return raw.replace(/\s+/g,' ');
}
function teamKey(s){return norm(s).replace(/[^a-z0-9]/g,'')}
function sameTeam(a,b){return teamKey(a)===teamKey(b)}
function teamFor(u){const raw=String(u||'').trim();const k=raw.toLowerCase();return STATE.teamMap[k]||raw||'Unknown'}
function spriteId(s){ return SBL.pokemon.normalizeName(s); }
function spriteCandidates(s){ return SBL.pokemon.candidateIds(s); }
function sprite(s,cls='sprite'){ return SBL.pokemon.spriteMarkup(s, cls); }
function allRows(){return Object.values(STATE.replays)}
// Resolve a team's next unplayed fixture opponent. Shared by Match Prep's
// default-opponent logic and the standalone Damage Calculator, so the
// calculator can default to "who am I actually playing next" too.
function nextScheduledOpponent(team){
  const key=v=>teamKey(v);
  const target=key(team);
  // Finals Mode takes precedence once the regular season is over. The first
  // unresolved finals match involving this team is its next opponent.
  const finals=window.SBL?.finals?.resolveMatchups ? window.SBL.finals.resolveMatchups(STATE.settings?.finals||{}) : null;
  if(finals && finals.status!=='inactive') {
    for(const round of (finals.rounds||[])){
      for(const match of (round.matches||[])){
        if(match.winner || !match.teamA || !match.teamB) continue;
        if(key(match.teamA)===target) return match.teamB;
        if(key(match.teamB)===target) return match.teamA;
      }
    }
  }
  const rounds=Array.isArray(STATE.settings?.fixture?.rounds) ? STATE.settings.fixture.rounds : [];
  const played=(week,home,away)=>Object.values(STATE.replays||{}).some(r=>{
    if(!r || String(r.week||'Unassigned')!==String(week) || !r.players) return false;
    const a=key(teamFor(r.players.p1)), b=key(teamFor(r.players.p2));
    return (a===key(home)&&b===key(away)) || (a===key(away)&&b===key(home));
  });
  for(const round of rounds){
    for(const match of (round.matches||[])){
      if(key(match.home)!==target && key(match.away)!==target) continue;
      if(played(round.week,match.home,match.away)) continue;
      return key(match.home)===target ? match.away : match.home;
    }
  }
  return '';
}
function rowsForTeam(team){return allRows().filter(r=>sameTeam(teamFor(r.players?.p1),team)||sameTeam(teamFor(r.players?.p2),team))}
function sideForTeam(r,team){if(sameTeam(teamFor(r.players?.p1),team))return 'p1';if(sameTeam(teamFor(r.players?.p2),team))return 'p2';return null}
function formBaseKey(s){
  const k=norm(canonicalSpecies(s));
  return k.replace(/\s+(?:hisui|galar|alola|alolan|paldea|paldean|kantonian|johto|sinnoh|unova|kalos|hoenn|origin|therian|incarnate|resolute|ordinary|rapid|single|ice|shadow|dusk|dawn|crowned|hero|school|noice|hangry|busted|blade|zen|meteor|stellar|terastal|complete|10 percent|50 percent|family of three|family of four|male|female|m|f)$/i,'');
}
function resolveReplaySpecies(raw, rosterSpecies){
  const species=canonicalSpecies(raw);
  if(!Array.isArray(rosterSpecies)||!rosterSpecies.length)return species;
  const exact=rosterSpecies.find(r=>norm(r)===norm(species));
  if(exact)return exact;
  // Replay parsers sometimes lose the forme suffix. If exactly one rostered
  // Pokémon shares the same base species, attach the roster's real forme.
  const base=formBaseKey(species);
  const candidates=rosterSpecies.filter(r=>formBaseKey(r)===base);
  return candidates.length===1?candidates[0]:species;
}
function monsForSide(r,side,preferredRoster=[]){
  const out={};
  const replayRoster=(r.teamRoster?.[side]||[]).map(rosterMonName).filter(Boolean);
  const replaySpecies=replayRoster.map(canonicalSpecies).filter(Boolean);
  const resolutionRoster=(preferredRoster.length?preferredRoster:replayRoster).map(rosterMonName).map(canonicalSpecies).filter(Boolean);
  for(const m of Object.values(r.mons||{})){
    if(String(m?.side||'').toLowerCase()!==side || !m.species)continue;
    const species=resolveReplaySpecies(m.species,resolutionRoster);
    const k=norm(species);
    if(!out[k])out[k]={...m,species,_fromReplay:true};
    else{
      const x=out[k];
      x.appearances=(Number(x.appearances)||0)+(Number(m.appearances)||0);
      x.kills=(Number(x.kills)||0)+(Number(m.kills||0));
      x.deaths=(Number(x.deaths)||0)+(Number(m.deaths||0));
      x.damageDealt=(Number(x.damageDealt)||0)+(Number(m.damageDealt||0));
      x.damageTaken=(Number(x.damageTaken)||0)+(Number(m.damageTaken||0));
      x.moves={...(x.moves||{})}; for(const [mv,c] of Object.entries(m.moves||{})) x.moves[mv]=(x.moves[mv]||0)+Number(c||0);
      x.items={...(x.items||{})}; for(const [it,c] of Object.entries(m.items||{})) x.items[it]=(x.items[it]||0)+Number(c||0);
      x.confirmedItems={...(x.confirmedItems||{})}; for(const [it,c] of Object.entries(m.confirmedItems||{})) x.confirmedItems[it]=(x.confirmedItems[it]||0)+Number(c||0); x.inferredItems={...(x.inferredItems||{})}; for(const [it,c] of Object.entries(m.inferredItems||{})) x.inferredItems[it]=(x.inferredItems[it]||0)+Number(c||0);
      x.leads=(Number(x.leads)||0)+Number(m.leads||0); x.sentOut=(Number(x.sentOut)||0)+Number(m.sentOut||0);
    }
  }
  // A submitted team member is an appearance even when there was no switch-in
  // event. This is the sitewide definition used by Match Prep and Stats.
  for(const sp of replaySpecies){
    const k=norm(sp);
    if(!out[k])out[k]={species:sp,appearances:1,kills:0,deaths:0,damageDealt:0,damageTaken:0,moves:{},items:{},leads:0,sentOut:0,_fromReplay:true};
    else out[k].appearances=1;
  }
  return Object.values(out);
}
function rosterForTeam(team){
  const rosters=STATE.settings?.rosters||{};
  const key=Object.keys(rosters).find(k=>sameTeam(k,team));
  return key ? (Array.isArray(rosters[key]) ? rosters[key] : []) : [];
}
function rosterMonName(mon){
  if(typeof mon==='string') return mon.trim();
  if(mon && typeof mon==='object') return String(mon.name ?? mon.species ?? mon.pokemon ?? '').trim();
  return String(mon ?? '').trim();
}
// Some Pokémon change their reported species mid-battle (or are always logged
// under a held-item-triggered forme) even though they were drafted/rostered
// under their base name. Without collapsing these back to the base species,
// the roster-seeded entry (0 games) and the replay-logged entry (the actual
// games) end up under two different keys — the replay-logged one then gets
// dropped entirely because it doesn't match the roster's "allowed" set, which
// is why some Pokémon (mostly ones with multiple forms) showed no replays.
const BATTLE_ONLY_FORM_MAP={
  'mimikyu busted':'Mimikyu','mimikyu busted totem':'Mimikyu',
  'eiscue noice':'Eiscue',
  'morpeko hangry':'Morpeko',
  'aegislash blade':'Aegislash',
  'wishiwashi school':'Wishiwashi',
  'cramorant gulping':'Cramorant','cramorant gorging':'Cramorant',
  'darmanitan zen':'Darmanitan','darmanitan zen galar':'Darmanitan-Galar',
  'zacian crowned':'Zacian','zamazenta crowned':'Zamazenta',
  'terapagos terastal':'Terapagos','terapagos stellar':'Terapagos',
  'palafin hero':'Palafin',
  'minior meteor':'Minior',
  'meloetta pirouette':'Meloetta',
  // Common replay/form spellings. These preserve real forms instead of
  // collapsing them into their base species.
  'zoroark hisui':'Zoroark-Hisui','zoroark-hisui':'Zoroark-Hisui',
  'growlithe hisui':'Growlithe-Hisui','growlithe-hisui':'Growlithe-Hisui',
  'arcanine hisui':'Arcanine-Hisui','arcanine-hisui':'Arcanine-Hisui',
  'voltorb hisui':'Voltorb-Hisui','voltorb-hisui':'Voltorb-Hisui',
  'electrode hisui':'Electrode-Hisui','electrode-hisui':'Electrode-Hisui',
  'typhlosion hisui':'Typhlosion-Hisui','typhlosion-hisui':'Typhlosion-Hisui',
  'qwilfish hisui':'Qwilfish-Hisui','qwilfish-hisui':'Qwilfish-Hisui',
  'sneasel hisui':'Sneasel-Hisui','sneasel-hisui':'Sneasel-Hisui',
  'samurott hisui':'Samurott-Hisui','samurott-hisui':'Samurott-Hisui',
  'lilligant hisui':'Lilligant-Hisui','lilligant-hisui':'Lilligant-Hisui',
  'zorua hisui':'Zorua-Hisui','zorua-hisui':'Zorua-Hisui',
  'braviary hisui':'Braviary-Hisui','braviary-hisui':'Braviary-Hisui',
  'goodra hisui':'Goodra-Hisui','goodra-hisui':'Goodra-Hisui',
  'avalugg hisui':'Avalugg-Hisui','avalugg-hisui':'Avalugg-Hisui',
  'decidueye hisui':'Decidueye-Hisui','decidueye-hisui':'Decidueye-Hisui',
  'sliggoo hisui':'Sliggoo-Hisui','sliggoo-hisui':'Sliggoo-Hisui',
  'basculin white stripe':'Basculin-White-Striped','basculin-white-stripe':'Basculin-White-Striped',
  'basculegion female':'Basculegion-F','basculegion-female':'Basculegion-F',
  'basculegion male':'Basculegion','basculegion-male':'Basculegion'
};
function canonicalSpecies(s){
  let raw=String(s??'').trim().replace(/[–—]/g,'-').replace(/\s+/g,' ');
  // Use the shared Pokémon naming contract everywhere in Match Prep.
  // Free Agency is the canonical roster-facing naming source, so Incarnate
  // forms such as Thundurus-Incarnate resolve to the same base display name
  // used by the rest of the site.
  if(window.SBL?.pokemon?.normalizeName){
    const normalized=window.SBL.pokemon.normalizeName(raw);
    if(normalized==='scovillain') raw='Scovillain';
    else if(/^(landorus|tornadus|thundurus|enamorus)-incarnate$/.test(normalized)) raw=normalized.replace('-incarnate','');
    else if(normalized==='thundurs') raw='Thundurus';
  }
  if(window.SBL?.pokemon?.displayName && window.SBL.pokemon.normalizeName(raw)==='scovillain') raw='Scovillain';
  // Some rosters/replay sources spell regional forms with the region name as
  // a PREFIX ("Hisuian Zoroark", "Galarian Zapdos", "Alolan Raichu", "Paldean
  // Tauros") instead of Showdown's suffix convention ("Zoroark-Hisui",
  // "Zapdos-Galar", "Raichu-Alola"). Every lookup below (BATTLE_ONLY_FORM_MAP,
  // compactMap, and — critically — the roster/replay matching in
  // resolveReplaySpecies/formBaseKey) only recognises the suffix form, so a
  // prefix-spelled roster entry silently failed to link up with its replay
  // stats. Reorder prefix forms into the suffix form up front so both
  // spellings resolve identically from here on.
  const prefixMatch=/^(alolan|galarian|hisuian|paldean|kantonian)\s+(.+)$/i.exec(raw);
  if(prefixMatch){
    const region={alolan:'Alola',galarian:'Galar',hisuian:'Hisui',paldean:'Paldea',kantonian:'Kanto'}[prefixMatch[1].toLowerCase()];
    raw=`${prefixMatch[2]}-${region}`;
  }
  const n=norm(raw);
  if(n==='comfey')return 'Comfey';
  if(BATTLE_ONLY_FORM_MAP[n])return BATTLE_ONLY_FORM_MAP[n];
  if(/-tera$/i.test(raw))raw=raw.replace(/-tera$/i,'');
  const compact=n.replace(/[^a-z0-9]/g,'');
  const compactMap={
    zoroarkhisui:'Zoroark-Hisui',zoruahisui:'Zorua-Hisui',
    growlithehisui:'Growlithe-Hisui',arcaninehisui:'Arcanine-Hisui',
    voltorbhisui:'Voltorb-Hisui',electrodehisui:'Electrode-Hisui',
    typhlosionhisui:'Typhlosion-Hisui',qwilfishhisui:'Qwilfish-Hisui',
    sneaselhisu:'Sneasel-Hisui',sneaselhisui:'Sneasel-Hisui',
    samurotthisui:'Samurott-Hisui',lilliganthisui:'Lilligant-Hisui',
    braviaryhisui:'Braviary-Hisui',goodrahisui:'Goodra-Hisui',
    avalugghisui:'Avalugg-Hisui',decidueyehisui:'Decidueye-Hisui',sliggoohisui:'Sliggoo-Hisui'
  };
  return compactMap[compact]||raw;
}
function hasCurrentRoster(team){return rosterForTeam(team).length>0}
function aggregate(team){
  const games=rowsForTeam(team);const mons={};let wins=0;const pairCounts={};
  const currentRoster=rosterForTeam(team);
  // Seed the analysis with every current-roster Pokémon so the page represents
  // the current roster even when a Pokémon has not appeared in a processed replay.
  for(const mon of currentRoster){
    const species=canonicalSpecies(rosterMonName(mon)); const k=norm(species);
    if(species && !mons[k]) mons[k]={species,appearances:0,kills:0,deaths:0,dealt:0,taken:0,replays:new Set(),gameSets:[],weeks:new Set(),items:{},confirmedItems:{},inferredItems:{},itemEvidence:{}};
  }
  for(const r of games){
    const side=sideForTeam(r,team);if(!side)continue;
    const winner=String(r.winner||'').trim();const player=r.players?.[side]||'';
    if(winner&&winner.toLowerCase()===player.toLowerCase())wins++;
    const seen=[];
    for(const m of monsForSide(r,side,currentRoster)){
      // A teamRoster entry is only a roster snapshot. It must not count as an
      // appearance or replay participation unless it exists in r.mons.
      if(m._fromReplay!==true) continue;
      const k=norm(m.species);
      if(!mons[k])mons[k]={species:m.species,appearances:0,kills:0,deaths:0,dealt:0,taken:0,replays:new Set(),gameSets:[],weeks:new Set(),items:{},confirmedItems:{},inferredItems:{},itemEvidence:{}};
      const a=mons[k];
      // Sitewide appearance semantics: m.appearances means the Pokémon was
      // brought in the submitted team for this replay, not merely sent onto
      // the field. Count it once per replay.
      a.appearances+=Number(m.appearances||0)||1;a.kills+=Number(m.kills||0);a.deaths+=Number(m.deaths||0);
      a.leads=(Number(a.leads)||0)+Number(m.leads||0);
      a.sentOut=(Number(a.sentOut)||0)+Number(m.sentOut||0);
      a.dealt+=Number(m.damageDealt||0);a.taken+=Number(m.damageTaken||0);a.replays.add(r.id);const replayWeek=String(r.week??r.round??r.roundNumber??'').trim();if(replayWeek && Number(m.appearances||0)>0)a.weeks.add(replayWeek);
      for(const [item,count] of Object.entries(m.items||{})) a.items[item]=(a.items[item]||0)+Number(count||0);
      for(const [item,count] of Object.entries(m.confirmedItems||{})) a.confirmedItems[item]=Math.max(Number(a.confirmedItems[item]||0),Number(count||0));
      for(const [item,count] of Object.entries(m.inferredItems||{})) a.inferredItems[item]=Math.max(Number(a.inferredItems[item]||0),Number(count||0));
      for(const [item,evidence] of Object.entries(m.itemEvidence||{})){a.itemEvidence[item] ||= [];for(const ev of (evidence||[]))if(!a.itemEvidence[item].includes(ev))a.itemEvidence[item].push(ev);}
      const moves={...(m.moves||{})};
      a.gameSets.push({week: replayWeek, moves, items:{...(m.items||{})}, confirmedItems:{...(m.confirmedItems||{})}, inferredItems:{...(m.inferredItems||{})}, sentOut:Number(m.sentOut||0), led:Number(m.leads||0)>0 ? 1 : 0});
      seen.push(k)
    }
    seen.sort();for(let i=0;i<seen.length;i++)for(let j=i+1;j<seen.length;j++){const key=seen[i]+'|'+seen[j];pairCounts[key]=(pairCounts[key]||0)+1}
  }
  // Kills and deaths in Match Prep must use the exact same source as
  // the Golden Fist leaderboard: aggregate the per-Pokémon replay fields
  // across the full replay set, independent of the current team roster.
  // This prevents the Team Overview counts from drifting from Golden Fist.
  const goldenFistKD={};
  for(const r of allRows()){
    for(const k in (r.mons||{})){
      const m=r.mons[k];
      const species=canonicalSpecies(m?.species);
      const nk=norm(species);
      if(!nk) continue;
      if(!goldenFistKD[nk]) goldenFistKD[nk]={kills:0,deaths:0};
      goldenFistKD[nk].kills += Number(m?.kills||0)||0;
      goldenFistKD[nk].deaths += Number(m?.deaths||0)||0;
    }
  }
  Object.values(mons).forEach(a=>{
    const kd=goldenFistKD[norm(a.species)];
    if(kd){
      a.kills=kd.kills;
      a.deaths=kd.deaths;
    }
  });

  if(hasCurrentRoster(team)){
    const allowed=new Set(currentRoster.map(x=>norm(canonicalSpecies(rosterMonName(x)))).filter(Boolean));
    Object.keys(mons).forEach(k=>{if(!allowed.has(norm(mons[k].species)))delete mons[k]});
    Object.keys(pairCounts).forEach(k=>{const [x,y]=k.split('|');if(!allowed.has(x)||!allowed.has(y))delete pairCounts[k]});
  }
  return {games,wins,losses:Math.max(0,games.length-wins),mons,pairCounts}
}
function formatGameDate(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString()}
function replayUrl(id){
  const raw=String(id??'').trim();
  if(!raw)return '';
  if(/^https?:\/\//i.test(raw))return raw;
  return `https://replay.pokemonshowdown.com/${encodeURIComponent(raw)}`;
}
function replayTitle(id){
  const raw=String(id??'').trim();
  return raw.replace(/^https?:\/\/(?:replay\.)?pokemonshowdown\.com\//i,'').replace(/\/$/,'');
}
function matchHistoryForTeam(team,bare=false){
  const games=rowsForTeam(team).slice().sort((a,b)=>{
    const ad=new Date(a.date||a.timestamp||a.created_at||0).getTime();
    const bd=new Date(b.date||b.timestamp||b.created_at||0).getTime();
    return bd-ad;
  });
  if(!games.length)return bare ? '<div class="empty">No recorded replays were found for this franchise.</div>' : `<section class="panel"><h2>Match History</h2><p class="panel-desc">No recorded replays were found for this franchise.</p></section>`;
  const html=`<section class="panel"><h2>Latest Matches</h2><p class="panel-desc">Recorded replays involving <strong>${esc(team)}</strong>, newest first. Round information is shown when available.</p><div class="replay-list">${games.map(r=>{
    const p1=teamFor(r.players?.p1),p2=teamFor(r.players?.p2);
    const side=sideForTeam(r,team);
    const opponent=side==='p1'?p2:p1;
    const player=side==='p1'?r.players?.p1:r.players?.p2;
    const winner=String(r.winner||'').trim();
    const won=winner && player && winner.toLowerCase()===String(player).toLowerCase();
    const result=winner ? (won?'Win':'Loss') : 'Result unavailable';
    const resultClass=won?'win':(winner?'loss':'neutral');
    const href=replayUrl(r.id);
    const label=replayTitle(r.id)||'View replay';
    const roundRaw=r.round ?? r.roundNumber ?? r.matchRound ?? r.tournamentRound ?? r.metadata?.round ?? r.match?.round ?? '';
    const roundText=String(roundRaw??'').trim();
    const roundBadge=roundText ? `<span class="replay-round">Round ${esc(roundText)}</span>` : '';
    return `<article class="replay-row"><div class="replay-result ${resultClass}">${esc(result)}</div><div class="replay-match"><div class="replay-teams"><strong>${esc(team)}</strong><span>vs</span><strong>${esc(opponent)}</strong></div><div class="replay-meta">${roundBadge}${roundBadge?' · ':''}${esc(formatGameDate(r.date||r.timestamp||r.created_at))} · ${esc(label)}</div></div>${href?`<a class="replay-button" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Open Replay ↗</a>`:''}</article>`;
  }).join('')}</div></section>`;
  return bare ? html.replace(/^<section class="panel">/,'').replace(/<\/section>$/,'') : html;
}


/* Base Speed data is embedded from Pokémon Database's published Gen 9
   Pokédex values. Match Prep never depends on a live third-party request. */
const BASE_SPEED={
  abomasnow:60,absol:75,aerodactyl:130,alakazam:120,altaria:80,ambipom:115,amoonguss:30,arcanine:95,azelf:115,azumarill:50,
  baxcalibur:87,blastoise:78,blaziken:80,breloom:70,bellibolt:45,bronzong:33,bulbasaur:45,
  charizard:100,chienpao:135,clodsire:45,cloyster:70,corviknight:67,crobat:130,cyclizar:121,
  decidueye:70,delphox:104,ditto:48,dragonite:80,dragapult:142,drifblim:80,drifloon:70,
  dugtrio:120,dusclops:25,dusknoir:45,eelektross:40,espathra:105,excadrill:88,exeggutor:55,
  feraligatr:78,flamigo:90,florges:75,flygon:100,forretress:30,furret:90,garchomp:102,gardevoir:80,
  gengar:110,gholdengo:84,gigalith:25,glaceon:65,gliscor:95,golduck:85,golurk:55,gothitelle:65,
  greninja:122,gyarados:81,hatterene:29,hawlucha:118,heatran:77,heracross:85,hippowdon:47,
  honchkrow:71,hydreigon:98,indeedee:85,ironbundle:136,ironhands:50,ironjugulis:108,ironmoth:110,
  ironthorns:72,ironvaliant:116,ivysaur:60,jellicent:60,jolteon:130,kingambit:50,kingdra:85,
  klefki:75,kommoo:85,krookodile:92,lapras:60,latias:110,latios:110,leafeon:95,lickilicky:50,
  lopunny:105,lucario:90,ludicolo:70,lunatone:70,lycanroc:112,magcargo:30,mawile:50,medicham:80,
  meganium:80,meowstic:104,metagross:70,milotic:81,mimikyu:96,mienshao:105,moltres:90,
  mrmime:90,mudsdale:35,muk:50,murkrow:91,nacli:35,naclstack:35,nihilego:103,ninetales:100,
  noivern:123,orthworm:65,oranguru:60,oricorio:93,palafin:100,pawmot:105,pecharunt:88,
  pelipper:65,perrserker:50,pidgeot:101,pikachu:90,pincurchin:15,politoed:70,polteageist:70,
  porygonz:79,primeape:95,probopass:40,pyroar:106,quagsire:35,quaquaval:85,raichu:110,
  rapidash:105,rayquaza:95,regieleki:200,regidrago:80,regirock:50,registeel:50,relicanth:55,
  roaringmoon:119,roserade:90,rotom:86,sableye:50,salazzle:117,samurott:70,sandslash:65,
  sceptile:120,scizor:65,scovillain:75,sharpedo:95,squawkabilly:92,shaymin:100,shedinja:40,shiftry:80,
  shinx:45,skarmory:70,slaking:100,slowbro:30,slowking:30,smeargle:75,sneasler:120,snorlax:30,
  solgaleo:97,spectrier:130,starmie:115,staraptor:100,steelix:30,sudowoodo:30,suicune:85,sylveon:60,
  talonflame:126,tauros:100,tentacruel:100,terapagos:71,toxapex:35,toxtricity:75,toedscruel:100,torkoal:20,
  torterra:56,trapinch:10,tsareena:72,tyranitar:61,tyrantrum:71,umbreon:65,urshifu:97,ursaluna:50,
  veluza:75,venomoth:90,venusaur:80,vileplume:50,volcarona:100,walkingwake:109,watchog:77,weepinbell:55,
  whimsicott:116,wiglett:95,wigglytuff:45,wochien:85,wooper:15,xatu:95,xerneas:99,yamask:30,yveltal:99,zapdos:100,zygarde:95,
  mewtwo:130,mew:100,rayquaza:95,kyogre:90,groudon:90,arceus:120,greninja:122
};
const SPEED_ALIASES={
  'mr mime':'mrmime','mr. mime':'mrmime','farfetchd':'farfetchd',
  'nidoran female':'nidoranf','nidoran male':'nidoranm',
  'landorus therian':'landorus','tornadus therian':'tornadus','thundurus therian':'thundurus'
};
function speedKey(name){
  let raw=String(name||'').trim().toLowerCase();

  // Normalize punctuation while preserving the hyphen as a form separator.
  raw=raw
    .replace(/[’']/g,'')
    .replace(/[♀]/g,'-f')
    .replace(/[♂]/g,'-m')
    .replace(/[.:]/g,'')
    .replace(/\s+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'');

  const aliases={
    'mr-mime':'mrmime',
    'mr-rime':'mrrime',
    'mime-jr':'mimejr',
    'type-null':'typenull',
    'farfetchd':'farfetchd',
    'sirfetchd':'sirfetchd',
    'nidoran-f':'nidoranf',
    'nidoran-m':'nidoranm',
    'landorus-therian':'landorus',
    'landorus-incarnate':'landorus',
    'tornadus-therian':'tornadus',
    'tornadus-incarnate':'tornadus',
    'thundurus-therian':'thundurus',
    'thundurus-incarnate':'thundurus',
    'enamorus-therian':'enamorus',
    'enamorus-incarnate':'enamorus',
    'keldeo-resolute':'keldeo',
    'keldeo-ordinary':'keldeo',
    'meloetta-pirouette':'meloetta',
    'meloetta-aria':'meloetta',
    'hoopa-unbound':'hoopa',
    'hoopa-confined':'hoopa',
    'lycanroc-midday':'lycanroc',
    'lycanroc-midnight':'lycanroc',
    'lycanroc-dusk':'lycanroc',
    'oricorio-baile':'oricorio',
    'oricorio-pom-pom':'oricorio',
    'oricorio-pau':'oricorio',
    'oricorio-sensu':'oricorio',
    'basculin-red-striped':'basculin',
    'basculin-blue-striped':'basculin',
    'basculin-white-striped':'basculin',
    'darmanitan-standard':'darmanitan',
    'darmanitan-zen':'darmanitan',
    'zygarde-10':'zygarde',
    'zygarde-50':'zygarde',
    'zygarde-complete':'zygarde',
    'necrozma-dusk-mane':'necrozma',
    'necrozma-dawn-wings':'necrozma',
    'necrozma-ultra':'necrozma',
    'calyrex-ice-rider':'calyrex',
    'calyrex-shadow-rider':'calyrex',
    'urshifu-single-strike':'urshifu',
    'urshifu-rapid-strike':'urshifu',
    'indeedee-female':'indeedee',
    'indeedee-male':'indeedee',
    'meowstic-female':'meowstic',
    'meowstic-male':'meowstic'
  };

  if(aliases[raw]) return aliases[raw];
  const compact=raw.replace(/-/g,'');
  if(BASE_SPEED[compact]!==undefined) return compact;

  // First try the complete hyphenated form, then progressively remove
  // form suffixes until a base species remains.
  const parts=raw.split('-');
  for(let i=parts.length;i>=1;i--){
    const candidate=parts.slice(0,i).join('').replace(/[^a-z0-9]/g,'');
    if(BASE_SPEED[candidate]!==undefined)return candidate;
  }
  return compact;
}
function baseSpeedForSpecies(species){
  const k=speedKey(species);
  if(BASE_SPEED[k]!==undefined)return BASE_SPEED[k];

  const raw=String(species||'').trim().toLowerCase()
    .replace(/[’']/g,'')
    .replace(/[♀]/g,'-f')
    .replace(/[♂]/g,'-m')
    .replace(/[.:]/g,'')
    .replace(/\s+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'');

  // Try compacting the full hyphenated name.
  const compact=raw.replace(/[^a-z0-9]/g,'');
  if(BASE_SPEED[compact]!==undefined)return BASE_SPEED[compact];

  // Try the species portion before a form suffix.
  const parts=raw.split('-');
  for(let i=parts.length-1;i>=1;i--){
    const candidate=parts.slice(0,i).join('').replace(/[^a-z0-9]/g,'');
    if(BASE_SPEED[candidate]!==undefined)return BASE_SPEED[candidate];
  }

  // Final prefix fallback for uncommon form labels.
  for(const base of Object.keys(BASE_SPEED)){
    if(compact.startsWith(base) && base.length>=5)return BASE_SPEED[base];
  }
  return null;
}
const SPEED_CACHE = new Map();
let SHOWDOWN_DEX_PROMISE = null;

function showdownDexCandidates(species){
  const original=String(species||'').trim().toLowerCase()
    .replace(/[’']/g,'')
    .replace(/[♀]/g,'-f').replace(/[♂]/g,'-m')
    .replace(/[.:]/g,'')
    .replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
  const aliases={
    'scream-tail':'screamtail','scream tail':'screamtail','screamtail':'screamtail',
    'zoroark-hisui':'zoroark-hisui','zoroark hisui':'zoroark-hisui',
    'mr-mime':'mr-mime','mr-mime-galar':'mr-mime-galar','mr-rime':'mr-rime',
    'landorus-incarnate':'landorus','landorus-therian':'landorus-therian','landorus-t':'landorus-therian',
    'tornadus-incarnate':'tornadus','tornadus-therian':'tornadus-therian','tornadus-t':'tornadus-therian',
    'thundurus-incarnate':'thundurus','thundurus-therian':'thundurus-therian','thundurus-t':'thundurus-therian',
    'enamorus-incarnate':'enamorus','enamorus-therian':'enamorus-therian','enamorus-t':'enamorus-therian',
    'squawkabilly-blue-plumage':'squawkabilly-blue-plumage','squawkabilly-yellow-plumage':'squawkabilly-yellow-plumage',
    'squawkabilly-white-plumage':'squawkabilly-white-plumage','squawkabilly-green-plumage':'squawkabilly-green-plumage',
    'nidoran-f':'nidoran-f','nidoran-m':'nidoran-m','indeedee-f':'indeedee-f','indeedee-m':'indeedee-m',
    'meowstic-f':'meowstic-f','meowstic-m':'meowstic-m'
  };
  const out=[]; const add=x=>{if(!x)return;x=String(x).replace(/[^a-z0-9-]/g,'').replace(/-+/g,'-');if(x&&!out.includes(x))out.push(x)};
  // spriteCandidates contains the site's battle-form aliases (including
  // Scream Tail and many regional forms), so the scouting data lookup uses the
  // same IDs as the sprites instead of guessing a base species.
  try{spriteCandidates(species).forEach(add)}catch(e){}
  add(aliases[original]||original); add(original); add(original.replace(/-/g,''));
  const parts=original.split('-'); for(let i=parts.length-1;i>=1;i--) add(parts.slice(0,i).join('-'));
  return out;
}

let SHOWDOWN_POKEDEX_SOURCE_PROMISE=null;
async function loadShowdownPokedexSource(){
  if(SHOWDOWN_POKEDEX_SOURCE_PROMISE)return SHOWDOWN_POKEDEX_SOURCE_PROMISE;
  SHOWDOWN_POKEDEX_SOURCE_PROMISE=fetch('https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/pokedex.ts',{cache:'force-cache'})
    .then(r=>r.ok?r.text():null).catch(()=>null);
  return SHOWDOWN_POKEDEX_SOURCE_PROMISE;
}
function abilitiesFromShowdownSource(source, species){
  if(!source)return [];
  const out=[];
  const add=v=>{const x=String(v||'').trim();if(x&&!out.some(a=>norm(a)===norm(x)))out.push(x)};
  for(const slug of pokemonDexCandidates(species)){
    const keyRe=new RegExp('\\n\\s*'+slug.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')+'\\s*:\\s*\\{');
    const m=keyRe.exec('\\n'+source);
    if(!m)continue;
    const tail=source.slice(m.index+m[0].length,m.index+m[0].length+2200);
    const am=/\\babilities\\s*:\\s*\\{([\\s\\S]*?)\\}/.exec(tail);
    if(!am)continue;
    const quoted=/[0-9H]+\\s*:\\s*[\\"']([^\\"']+)[\\"']/g; let q;
    while((q=quoted.exec(am[1])))add(q[1]);
    if(out.length)return out;
  }
  return out;
}
async function loadShowdownDex(){
  if(SHOWDOWN_DEX_PROMISE)return SHOWDOWN_DEX_PROMISE;
  // Never let the remote Pokédex request leave scouting cards stuck on
  // "Loading…". If Showdown is slow/unavailable, callers fall back to PokeAPI.
  SHOWDOWN_DEX_PROMISE=(async()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    try{
      const r=await fetch('https://play.pokemonshowdown.com/data/pokedex.json',{cache:'force-cache',signal:controller.signal});
      return r.ok?await r.json():null;
    }catch(e){
      return null;
    }finally{
      clearTimeout(timer);
    }
  })();
  return SHOWDOWN_DEX_PROMISE;
}

async function fetchBaseSpeed(species){
  const cacheKey=String(species||'').trim().toLowerCase();
  if(SPEED_CACHE.has(cacheKey))return SPEED_CACHE.get(cacheKey);

  const embedded=baseSpeedForSpecies(species);
  if(embedded!==null){SPEED_CACHE.set(cacheKey,embedded);return embedded;}

  // Use the same canonical Pokédex data that Showdown itself uses. This is
  // much more complete than maintaining a hand-written speed table.
  const dex=await loadShowdownDex();
  if(dex){
    for(const slug of showdownDexCandidates(species)){
      const d=dex[slug];
      const value=Number(d?.baseStats?.spe);
      if(Number.isFinite(value)){
        SPEED_CACHE.set(cacheKey,value); return value;
      }
    }
  }

  // Final fallback for anything not present in the Showdown data.
  for(const slug of pokemonDexCandidates(species)){
    try{
      const r=await fetch('https://pokeapi.co/api/v2/pokemon/'+encodeURIComponent(slug));
      if(!r.ok)continue;
      const d=await r.json();
      const st=(d.stats||[]).find(x=>x.stat?.name==='speed');
      const value=Number(st?.base_stat);
      if(Number.isFinite(value)){SPEED_CACHE.set(cacheKey,value);return value;}
    }catch(e){}
  }
  SPEED_CACHE.set(cacheKey,null); return null;
}

function minSpeedFromBase(base,level=100){
  const raw=Math.floor((2*Number(base)*level)/100)+5;
  return Math.floor(raw*0.9);
}
function maxSpeedFromBase(base,level=100){
  const raw=Math.floor(((2*Number(base)+31+63)*level)/100)+5;
  return Math.floor(raw*1.1);
}
function scarfSpeedFromMax(max){ return Math.floor(max*1.5); }

function teamNames(){
  const replayTeams=allRows().flatMap(r=>[teamFor(r.players?.p1),teamFor(r.players?.p2)]).filter(Boolean);
  const rosterTeams=Object.keys(STATE.settings?.rosters||{});
  return [...new Map([...replayTeams,...rosterTeams].map(t=>[teamKey(t),t])).values()].sort((a,b)=>a.localeCompare(b));
}

function statSignatureForMon(m){
  const base=m.baseSpeed??m.speed??null;
  const max=m.maxSpeed??m.max??null;
  const scarf=m.scarfSpeed??(max!=null?scarfSpeedFromMax(Number(max)):null);
  return `${base}|${max}|${scarf}`;
}
function groupEquivalentVariants(list){
  const groups=new Map(),out=[];
  for(const m of list){
    const key=statSignatureForMon(m);
    if(!groups.has(key)){
      const g={...m,names:[m.species],variantCount:1};
      groups.set(key,g);out.push(g);
    }else{
      const g=groups.get(key);
      g.names.push(m.species);
      g.variantCount++;
      g.appearances=(Number(g.appearances)||0)+(Number(m.appearances)||0);
      if(m.replays?.size && g.replays?.size) m.replays.forEach(x=>g.replays.add(x));
    }
  }
  return out;
}
function displaySpecies(m){
  const rawNames = Array.isArray(m?.names) && m.names.length ? m.names : [m?.species];
  const names = rawNames.map(x=>canonicalSpecies(x)).filter(Boolean);
  const unique = [...new Map(names.map(x=>[norm(x),x])).values()];
  // Battle-only formes (Aegislash Blade, Mimikyu Busted, etc.) are internal
  // replay representations, not separate roster Pokémon. If they resolve to
  // the same canonical species, only show the canonical name.
  return unique[0] || String(m?.species || '');
}


async function franchiseMons(team){
  // Match Prep operates on one row per current-roster species.
  // Do not use groupEquivalentVariants here: that function intentionally groups
  // Pokémon with identical speed signatures, which can incorrectly merge two
  // completely different species (and makes matchup rows disappear).
  const source=aggregate(team).mons;
  const merged=new Map();
  for(const m of Object.values(source)){
    const species=canonicalSpecies(m.species);
    const key=norm(species);
    if(!key) continue;
    if(!merged.has(key)){
      merged.set(key,{...m,species,replays:m.replays instanceof Set?new Set(m.replays):new Set(),gameSets:Array.isArray(m.gameSets)?m.gameSets.slice():[]});
    }else{
      const x=merged.get(key);
      x.appearances=(Number(x.appearances)||0)+(Number(m.appearances)||0);
      x.kills=(Number(x.kills)||0)+(Number(m.kills)||0);
      x.deaths=(Number(x.deaths)||0)+(Number(m.deaths)||0);
      x.dealt=(Number(x.dealt)||0)+(Number(m.dealt)||0);
      x.taken=(Number(x.taken)||0)+(Number(m.taken)||0);
      x.leads=(Number(x.leads)||0)+(Number(m.leads)||0);
      x.moves={...(x.moves||{})}; for(const [mv,c] of Object.entries(m.moves||{}))x.moves[mv]=(x.moves[mv]||0)+Number(c||0);
      x.items={...(x.items||{})}; for(const [it,c] of Object.entries(m.items||{}))x.items[it]=(x.items[it]||0)+Number(c||0);
      x.confirmedItems={...(x.confirmedItems||{})}; for(const [it,c] of Object.entries(m.confirmedItems||{}))x.confirmedItems[it]=Math.max(Number(x.confirmedItems[it]||0),Number(c||0));
      x.inferredItems={...(x.inferredItems||{})}; for(const [it,c] of Object.entries(m.inferredItems||{}))x.inferredItems[it]=Math.max(Number(x.inferredItems[it]||0),Number(c||0));
      if(m.replays instanceof Set)m.replays.forEach(r=>x.replays.add(r));
      if(Array.isArray(m.gameSets))x.gameSets.push(...m.gameSets);
    }
  }
  const enriched=await Promise.all([...merged.values()].map(async m=>{
    const base=await fetchBaseSpeed(m.species);
    const max=base===null?null:maxSpeedFromBase(base,100);
    return {...m,baseSpeed:base,minSpeed:base===null?null:minSpeedFromBase(base,100),maxSpeed:max,scarfSpeed:max===null?null:scarfSpeedFromMax(max),names:[m.species]};
  }));
  enriched.sort((a,b)=>b.appearances-a.appearances||a.species.localeCompare(b.species));
  return enriched;
}

const TYPE_NAMES=['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
const TYPE_CHART={
  Normal:{Rock:.5,Steel:.5,Ghost:0},Fire:{Fire:.5,Water:.5,Grass:2,Ice:2,Bug:2,Rock:.5,Dragon:.5,Steel:2},Water:{Fire:2,Water:.5,Grass:.5,Ground:2,Rock:2,Dragon:.5},Electric:{Water:2,Electric:.5,Grass:.5,Ground:0,Flying:2,Dragon:.5},Grass:{Fire:.5,Water:2,Grass:.5,Poison:.5,Ground:2,Flying:.5,Bug:.5,Rock:2,Dragon:.5,Steel:.5},Ice:{Fire:.5,Water:.5,Grass:2,Ground:2,Flying:2,Dragon:2,Ice:.5,Steel:.5},Fighting:{Normal:2,Ice:2,Rock:2,Dark:2,Steel:2,Poison:.5,Flying:.5,Psychic:.5,Bug:.5,Ghost:0,Fairy:.5},Poison:{Grass:2,Poison:.5,Ground:.5,Rock:.5,Ghost:.5,Steel:0,Fairy:2},Ground:{Fire:2,Electric:2,Grass:.5,Poison:2,Flying:0,Bug:.5,Rock:2,Steel:2},Flying:{Grass:2,Electric:.5,Fighting:2,Bug:2,Rock:.5,Steel:.5},Psychic:{Fighting:2,Poison:2,Psychic:.5,Steel:.5,Dark:0},Bug:{Fire:.5,Grass:2,Fighting:.5,Poison:.5,Flying:.5,Psychic:2,Ghost:.5,Dark:2,Steel:.5,Fairy:.5},Rock:{Fire:2,Ice:2,Flying:2,Bug:2,Fighting:.5,Ground:.5,Steel:.5},Ghost:{Normal:0,Psychic:2,Ghost:2,Dark:.5},Dragon:{Dragon:2,Steel:.5,Fairy:0},Dark:{Fighting:.5,Psychic:2,Ghost:2,Dark:.5,Fairy:.5},Steel:{Fire:.5,Water:.5,Electric:.5,Ice:2,Rock:2,Fairy:2,Steel:.5},Fairy:{Fire:.5,Fighting:2,Poison:.5,Dragon:2,Dark:2,Steel:.5}
};
function normalizeTypeName(type){
  const raw=String(type||'').trim().toLowerCase();
  if(!raw)return '';
  return raw.charAt(0).toUpperCase()+raw.slice(1);
}
function normalizedTypes(types){
  return Array.from(new Set((Array.isArray(types)?types:[]).map(normalizeTypeName).filter(t=>TYPE_NAMES.includes(t))));
}
function typeChartMultiplier(attacking,defending){
  const a=normalizeTypeName(attacking), d=normalizeTypeName(defending);
  return TYPE_CHART[a]?.[d]??1;
}
const TYPE_CACHE=new Map();
const POKEMON_DATA_CACHE=new Map();
function pokemonDexCandidates(species){
  const raw=spriteId(species), out=[], add=x=>{if(x&&!out.includes(x))out.push(x)};
  const aliases={
    'ogerpon-teal-mask':'ogerpon','ogerpon-wellspring-mask':'ogerpon-wellspring',
    'ogerpon-hearthflame-mask':'ogerpon-hearthflame','ogerpon-cornerstone-mask':'ogerpon-cornerstone',
    'tauros-paldea-combat':'tauros-paldea-combat','tauros-paldea-blaze':'tauros-paldea-blaze','tauros-paldea-aqua':'tauros-paldea-aqua',
    'squawkabilly-green-plumage':'squawkabilly','squawkabilly-blue-plumage':'squawkabilly-blue',
    'squawkabilly-yellow-plumage':'squawkabilly-yellow','squawkabilly-white-plumage':'squawkabilly-white'
  };
  add(aliases[raw]||raw); add(raw);
  const parts=raw.split('-');
  for(let i=parts.length-1;i>=1;i--) add(parts.slice(0,i).join('-'));
  return out;
}
async function fetchPokemonData(species){
  const key=norm(canonicalSpecies(species));
  if(POKEMON_DATA_CACHE.has(key)) return POKEMON_DATA_CACHE.get(key);
  const dex=await loadShowdownDex();
  if(dex){
    // Showdown's pokedex.json keys are fully compacted (no hyphens/spaces —
    // e.g. "landorustherian", "taurospaldeacombat"), so forme lookups need
    // showdownDexCandidates (which runs everything through spriteCandidates
    // and includes that compacted form). pokemonDexCandidates only trims
    // hyphenated segments off the end, which never produces a compacted key,
    // so every Pokémon with a non-cosmetic forme (Therian, regional forms,
    // Paldean Tauros, Ogerpon masks, etc.) was skipping the Showdown dex
    // entirely and falling through to a much less reliable PokeAPI guess
    // (or no data at all) — this was the root cause of formes not showing
    // data in the scouting popup.
    for(const slug of showdownDexCandidates(species)){
      const d=dex[slug];
      if(d?.baseStats || d?.types || d?.abilities){
        const bs=d.baseStats||{};
        const stats={
          hp:bs.hp,
          attack:bs.attack??bs.atk,
          defense:bs.defense??bs.def,
          'special-attack':bs['special-attack']??bs.spa,
          'special-defense':bs['special-defense']??bs.spd,
          speed:bs.speed??bs.spe
        };
        const data={
          stats,
          types:(d.types||[]).map(String),
          abilities:Object.values(d.abilities||{}).map(String).filter(Boolean)
        };
        POKEMON_DATA_CACHE.set(key,data); return data;
      }
    }
  }
  for(const slug of pokemonDexCandidates(species)){
    try{
      const r=await fetch('https://pokeapi.co/api/v2/pokemon/'+encodeURIComponent(slug));
      if(!r.ok)continue;
      const d=await r.json();
      const data={
        stats:Object.fromEntries((d.stats||[]).map(x=>[x.stat?.name,x.base_stat]).filter(x=>x[0])),
        types:(d.types||[]).sort((a,b)=>a.slot-b.slot).map(x=>x.type?.name).filter(Boolean),
        abilities:(d.abilities||[]).map(x=>x.ability?.name).filter(Boolean)
      };
      POKEMON_DATA_CACHE.set(key,data); return data;
    }catch(e){}
  }
  POKEMON_DATA_CACHE.set(key,null); return null;
}
async function fetchTypes(species){
  const key=norm(canonicalSpecies(species));
  if(TYPE_CACHE.has(key))return TYPE_CACHE.get(key);

  // Prefer Showdown's own canonical Pokédex so unusual names/forms and
  // aliases don't depend on guessing a third-party URL slug.
  const dex=await loadShowdownDex();
  if(dex){
    for(const slug of showdownDexCandidates(species)){
      const types=normalizedTypes(dex[slug]?.types||[]);
      if(types.length){TYPE_CACHE.set(key,types);return types;}
    }
  }

  for(const slug of pokemonDexCandidates(species)){
    try{
      const r=await fetch('https://pokeapi.co/api/v2/pokemon/'+encodeURIComponent(slug));
      if(!r.ok)continue;
      const d=await r.json();
      const types=normalizedTypes((d.types||[]).sort((a,b)=>a.slot-b.slot).map(x=>x.type?.name).filter(Boolean));
      if(types.length){TYPE_CACHE.set(key,types);return types}
    }catch(e){}
  }
  TYPE_CACHE.set(key,[]);return [];
}

function typePills(types){return types.length?`<div class="type-row">${types.map(t=>`<span class="type-pill type-${esc(t)}">${esc(t)}</span>`).join('')}</div>`:'<div class="type-row"><span class="type-pill type-unknown">Type unknown</span></div>'}
function typePill(type){const t=String(type||'').trim();return t?`<span class="type-pill type-${esc(t)}">${esc(t)}</span>`:''}
function combinedMultiplier(attackingTypes,defendingTypes){if(!attackingTypes.length||!defendingTypes.length)return null;return Math.max(...attackingTypes.map(a=>defendingTypes.reduce((m,d)=>m*typeChartMultiplier(a,d),1)))}
function defensiveMultiplier(attackingType,defendingTypes){if(!defendingTypes.length)return null;return defendingTypes.reduce((m,d)=>m*typeChartMultiplier(attackingType,d),1)}
function defensiveTypeEffectiveness(types){
  const defs=normalizedTypes(types);
  if(!defs.length)return TYPE_NAMES.map(type=>({type,mult:null}));
  return TYPE_NAMES.map(type=>({type,mult:defensiveMultiplier(type,defs)}));
}
function matchupLabel(mult){if(mult===null)return ['Unknown','matchup-neutral'];if(mult>=4)return ['Extremely effective','matchup-good'];if(mult>=2)return ['Super effective','matchup-good'];if(mult===0)return ['Immune','matchup-bad'];if(mult<=.25)return ['Highly resisted','matchup-bad'];if(mult<=.5)return ['Resisted','matchup-bad'];return ['Neutral','matchup-neutral']}
function scoutingEffectiveness(mult){if(mult===null)return 'Unknown';if(mult>=4)return 'Extremely effective';if(mult>=2)return 'Super effective';if(mult===0)return 'Immune';if(mult<=.25)return 'Highly resisted';if(mult<=.5)return 'Resisted';return 'Neutral'}
function fmtMult(v){if(v===null)return '?';if(v===0)return '0×';if(v===.25)return '¼×';if(v===.5)return '½×';return Number.isInteger(v)?v+'×':v.toFixed(2)+'×'}
function moveKey(s){return norm(s).replace(/[^a-z0-9]/g,'')}
const ROLE_RULES=[
  ['Hazard setter',['stealthrock','spikes','toxicspikes','stickyweb']],
  ['Hazard remover',['rapidspin','defog','mortalspin']],
  ['Setup sweeper',['swordsdance','nastyplot','dragondance','quiverdance','calmmind','bulkup','agility','shellsmash','shiftgear','autotomize','curse','workup','tailglow','filletaway']],
  ['Speed control',['tailwind','trickroom','electroweb','icywind','stringshot']],
  ['Status spreader',['willowisp','thunderwave','toxic','spore','sleeppowder','stunspore','glare','yawn']],
  ['Pivot',['uturn','voltswitch','flipturn','partingshot','teleport']],
  ['Screens',['reflect','lightscreen','auroraveil']],
  ['Recovery',['recover','roost','slackoff','softboiled','wish','moonlight','morningsun','synthesis','shoreup','rest']],
  ['Physical attacker',['closecombat','earthquake','flareblitz','bravebird','stoneedge','knockoff','crunch','ironhead','playrough','liquidation','drainpunch','machpunch','suckerpunch','bulletpunch']],
  ['Special attacker',['fireblast','flamethrower','hydropump','surf','icebeam','thunderbolt','thunder','shadowball','darkpulse','psychic','psychic','moonblast','energyball','gigadrain','makeitrain','dracometeor','dragonpulse']],
];
function inferRoles(m){const moves=new Set((m.gameSets||[]).flatMap(g=>g.moves||[]).map(moveKey));const roles=[];for(const [role,keys] of ROLE_RULES){if(keys.some(k=>moves.has(k)))roles.push(role)}return roles.length?roles:['Unclassified'];}
function aggregateMoveCounts(mons){const counts={};for(const m of mons)for(const g of m.gameSets||[])for(const move of g.moves||[]){const k=String(move).trim();if(!k)continue;counts[k]=(counts[k]||0)+1}return counts}
function leadFromReplay(r,side){const candidates=[r.leads?.[side],r.lead?.[side],r.firstPokemon?.[side],r.firstSwitch?.[side]];for(const c of candidates){if(typeof c==='string'&&c)return c;if(c?.species)return c.species}return null}
function teamLeads(team){const counts={};for(const r of rowsForTeam(team)){const side=sideForTeam(r,team);const lead=side?leadFromReplay(r,side):null;if(lead)counts[lead]=(counts[lead]||0)+1}return counts}
function weaknessSummary(typesByMon){const out={};for(const t of TYPE_NAMES)out[t]={weak:0,resist:0,immune:0};for(const types of Object.values(typesByMon)){for(const atk of TYPE_NAMES){const m=defensiveMultiplier(atk,types);if(m>=2)out[atk].weak++;else if(m===0)out[atk].immune++;else if(m<=.5)out[atk].resist++}}return out}
function pct(n,d){return d?Math.round(n/d*100):0}

function roleDescription(role){
  return {
    'Hazard setter':'Likely focused on establishing entry hazards and forcing switches.',
    'Hazard remover':'Likely focused on removing hazards while preserving momentum.',
    'Setup sweeper':'Likely focused on boosting and converting a free turn into a sweep.',
    'Speed control':'Likely focused on controlling Speed for the team.',
    'Status spreader':'Likely focused on spreading debilitating status conditions.',
    'Pivot':'Likely focused on gaining momentum through forced switches.',
    'Screens':'Likely focused on team support through screen effects.',
    'Recovery':'Likely built to stay healthy and repeatedly enter the field.',
    'Physical attacker':'Likely uses physical damage as its main offensive route.',
    'Special attacker':'Likely uses special damage as its main offensive route.',
    'Unclassified':'No clear role could be inferred from the recorded moves.'
  }[role]||'Role inferred from the Pokémon’s recorded moves.';
}
function observedMoves(m){return [...new Set((m.gameSets||[]).flatMap(g=>g.moves||[]).map(x=>String(x).trim()).filter(Boolean))]}
function roleMoves(m,role){
  const observed=observedMoves(m);const keys=new Set((ROLE_RULES.find(x=>x[0]===role)?.[1]||[]));
  const primary=observed.filter(x=>keys.has(moveKey(x)));
  const secondary=observed.filter(x=>!primary.includes(x));
  return [...primary,...secondary];
}
function canonicalMoveSet(moves){
  return [...new Set((moves||[]).map(x=>String(x||'').trim().toLowerCase()).filter(Boolean))].sort().join('|');
}
function observedSetKeys(m){
  return new Set((m.gameSets||[]).map(g=>canonicalMoveSet(g.moves||[])).filter(Boolean));
}
function suggestedSetsForMon(m){
  const roles=inferRoles(m);const observed=observedMoves(m);const existing=observedSetKeys(m);
  return roles.map(role=>{
    const candidates=roleMoves(m,role);
    const moves=candidates.slice(0,4);
    return {role,moves,observedCount:observed.length};
  }).filter(s=>{
    const key=canonicalMoveSet(s.moves);
    return !key || !existing.has(key);
  });
}
function setSuggestionsMarkup(m){
  const sets=suggestedSetsForMon(m);
  if(!sets.length)return '<div class="empty">No additional potential sets were identified beyond the recorded sets.</div>';
  return `<div class="set-role-grid">${sets.map(s=>`<article class="set-suggestion"><h4>${esc(s.role)}</h4><div class="role-desc">${esc(roleDescription(s.role))}</div><div class="set-moves">${s.moves.length?s.moves.map(x=>`<div class="set-move observed">${esc(x)}</div>`).join(''):'<div class="set-move">No observed moves</div>'}</div><div class="observed-note">Built from ${s.observedCount} observed move${s.observedCount===1?'':'s'} and the inferred role. This is a scouting hypothesis, not a confirmed set.</div></article>`).join('')}</div>`;
}
function defensiveTypeRows(data,total){
  return TYPE_NAMES.map(t=>({t,w:data[t].weak,r:data[t].resist,i:data[t].immune})).filter(x=>x.w||x.r||x.i).sort((a,b)=>(b.w-a.w)||(b.i-a.i)||(b.r-a.r)||a.t.localeCompare(b.t));
}
function defensiveProfileCard(title,data,total){
  const rows=defensiveTypeRows(data,total);
  return `<div class="defensive-team"><h3>${title}</h3><table class="type-count-table"><thead><tr><th>Type</th><th class="num">Weak</th><th class="num">Resist</th><th class="num">Immune</th></tr></thead><tbody>${rows.slice().sort((a,b)=>(Number(b.maxSpeed??b.max??b.speed??-1)-Number(a.maxSpeed??a.max??a.speed??-1))).map(x=>`<tr><td>${typePills([x.t])}</td><td class="num ${x.w?'count-bad':'count-neutral'}">${x.w}/${total}</td><td class="num ${x.r?'count-good':'count-neutral'}">${x.r}/${total}</td><td class="num ${x.i?'count-good':'count-neutral'}">${x.i}/${total}</td></tr>`).join('')}</tbody></table><div class="small" style="margin-top:9px">Weak = 2× or more. Resist = ½× or less. Immunity = 0×.</div></div>`;
}

async function comparisonTypes(species){
  // Type data is supplementary to Match Prep. A slow/unavailable PokéAPI
  // request must never prevent the comparison UI from rendering.
  try{
    return await Promise.race([
      fetchTypes(species),
      new Promise(resolve=>setTimeout(()=>resolve([]),2500))
    ]);
  }catch(e){
    console.warn('Type lookup failed for',species,e);
    return [];
  }
}


async function renderMatchPrep(yourTeam, selectedOpponent){
  const names=teamNames();
  const opponent=selectedOpponent && !sameTeam(selectedOpponent,yourTeam)
    ? selectedOpponent
    : (names.find(n=>!sameTeam(n,yourTeam))||'');
  const your=await franchiseMons(yourTeam);
  const opp=await franchiseMons(opponent);
  if(!opponent){
    return `<section class="panel"><h2>Match Prep</h2><p class="panel-desc">Choose an opponent franchise to start preparing for the match.</p><div class="empty">No opposing franchise is available.</div></section>`;
  }
  const all=[...your,...opp];
  const typePairs=await Promise.all(all.map(async m=>[m.species,await fetchTypes(m.species)]));
  const typeMap=Object.fromEntries(typePairs);
  const rosterLookup=(team)=>{
    const out=new Map();
    for(const raw of rosterForTeam(team)){
      const name=rosterMonName(raw); if(!name)continue;
      out.set(norm(name),{name,points:raw&&typeof raw==='object' ? (raw.points??raw.pointValue??raw.cost??'') : '',ability:raw&&typeof raw==='object' ? (raw.ability??raw.abilities??raw.Ability??'') : ''});
    }
    return out;
  };
  const oppRoster=rosterLookup(opponent);
  const yourRoster=rosterLookup(yourTeam);
  const observedFor=m=>observedMoves(m);
  const rolesFor=m=>inferRoles(m);
  const opponentAggregate=aggregate(opponent);
  const usageFor=m=>opponentAggregate.mons[norm(m.species)] || opponentAggregate.mons[m.species] || {appearances:0,kills:0,deaths:0,dealt:0,taken:0,replays:new Set(),gameSets:[],weeks:new Set(),items:{},confirmedItems:{},inferredItems:{},itemEvidence:{}};

  // -------- Opponent Team Overview --------
  // Show the concrete matchup instead of subjective labels: which of YOUR
  // Pokémon this opponent is naturally strong into based on its typing.
  const goodIntoFor=(m)=>your.filter(y=>{
    const mult=combinedMultiplier(typeMap[m.species]||[],typeMap[y.species]||[]);
    return mult>=2;
  });
  const opponentCards=(await Promise.all(opp.map(async m=>{
    const info=oppRoster.get(norm(m.species));
    const goodInto=goodIntoFor(m);
    const moves=observedFor(m).slice(0,6);
    const roles=rolesFor(m).slice(0,3);
    const usage=usageFor(m);
    const pdata=await fetchPokemonData(m.species);
    const abilities=pdata?.abilities||[];
    const baseStats=pdata?.stats||{};
    const prettyAbility=a=>String(a).replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    const effTypes=normalizedTypes(typeMap[m.species]||pdata?.types||[]);
    const allTypes=['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
    const eff=defensiveTypeEffectiveness(effTypes).filter(x=>x.mult!==null && x.mult!==1);
    const weaknesses=eff.filter(x=>x.mult>1),resistances=eff.filter(x=>x.mult>0&&x.mult<1),immunities=eff.filter(x=>x.mult===0);
    const group=(title,items)=>`<div class="prep-popup-subsection"><strong>${title}</strong><div class="prep-chip-row">${items.length?items.map(x=>`<span class="prep-chip">${esc(x.type)} ${fmtMult(x.mult)}</span>`).join(''):'<span class="small">None</span>'}</div></div>`;
    const scoutingHtml=`<div class="prep-popup-grid">
      <div class="prep-card-section"><span>Typing</span><div class="type-row">${effTypes.length?effTypes.map(t=>typePill(t)).join(''):'<span class="small">Typing unavailable</span>'}</div></div>
      <div class="prep-card-section"><span>Strong into</span><div class="prep-chip-row">${goodInto.length?goodInto.map(x=>`<span class="prep-chip">${esc(displaySpecies(x))}</span>`).join(''):'<span class="small">No clear type advantage</span>'}</div></div>
      <div class="prep-card-section"><span>Vulnerable to</span><div class="prep-chip-row">${(() => { const vulnerable=your.filter(y=>{const mult=combinedMultiplier(normalizedTypes(typeMap[y.species]||[]),normalizedTypes(typeMap[m.species]||[])); return mult!==null && mult>=2;}); return vulnerable.length?vulnerable.map(x=>`<span class="prep-chip">${esc(displaySpecies(x))}</span>`).join(''):'<span class="small">No clear disadvantage</span>'; })()}</div></div>
      <div class="prep-card-section"><span>Abilities</span><div class="prep-chip-row">${abilities.length?abilities.map(a=>`<span class="prep-chip">${esc(prettyAbility(a))}</span>`).join(''):'<span class="small">Unavailable</span>'}</div></div>
      <div class="prep-card-section"><span>Observed moves</span><div class="prep-chip-row">${moves.length?moves.map(x=>`<span class="prep-chip">${esc(x)}</span>`).join(''):'<span class="small">No recorded moves</span>'}</div></div>
      <div class="prep-card-section"><span>Likely roles</span><div class="prep-chip-row">${roles.length?roles.map(x=>`<span class="prep-chip">${esc(x)}</span>`).join(''):'<span class="small">Unclear</span>'}</div></div>
      <div class="prep-card-section"><span>Point value</span><div class="small">${info?.points!==''&&info?.points!=null?esc(info.points)+' pts':'Point value unavailable'}</div></div>
    </div>
    <div class="prep-card-section"><span>Type effectiveness</span>${group('Weaknesses',weaknesses)}${group('Resistances',resistances)}${group('Immunities',immunities)}</div>
    <div class="prep-card-section"><span>Base stats</span><div class="prep-stat-grid">${[['hp','HP'],['attack','Atk'],['defense','Def'],['special-attack','SpA'],['special-defense','SpD'],['speed','Spe']].map(([k,l])=>`<span class="prep-chip">${l}: ${baseStats[k]??'—'}</span>`).join('')}</div></div>`;
    const usageHtml=`<div class="prep-usage-grid"><div><span>Appearances</span><strong>${usage.appearances||0}</strong></div><div><span>KOs</span><strong>${usage.kills||0}</strong></div><div><span>Deaths</span><strong>${usage.deaths||0}</strong></div><div><span>Damage dealt</span><strong>${Number(usage.dealt||0).toFixed(0)}</strong></div><div><span>Damage taken</span><strong>${Number(usage.taken||0).toFixed(0)}</strong></div></div>`;
    const broughtInWeeks=[...(usage.weeks||[])].sort((a,b)=>{const na=Number(a),nb=Number(b);if(Number.isFinite(na)&&Number.isFinite(nb))return na-nb;return String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});});
    const weekLabel=w=>/^\d+$/.test(String(w))?`Week ${w}`:String(w);
    const weekStats=new Map();
    for(const set of (usage.gameSets||[])){const wk=String(set.week??'').trim();if(!wk)continue;const cur=weekStats.get(wk)||{moves:{},items:{},led:0,sentOut:0};for(const [move,count] of Object.entries(set.moves||{}))cur.moves[move]=(cur.moves[move]||0)+Number(count||0);for(const [item,count] of Object.entries(set.items||{}))cur.items[item]=(cur.items[item]||0)+Number(count||0);for(const [item,count] of Object.entries(set.confirmedItems||{}))cur.items[item]=Math.max(Number(cur.items[item]||0),Number(count||0));for(const [item,count] of Object.entries(set.inferredItems||{}))cur.items[item]=Math.max(Number(cur.items[item]||0),Number(count||0));cur.led+=Number(set.led||0);cur.sentOut+=Number(set.sentOut||0);weekStats.set(wk,cur);}
    // Season-level usage is derived from every recorded game set. Older
    // aggregate records may not have a top-level `moves` object even though
    // the weekly gameSets do, so never let the season overview appear empty
    // when the week-by-week data is present.
    const seasonMoves={};
    const seasonMovesBrought={};
    const seasonItems={};
    const seasonItemEvidence={};
    for(const set of (usage.gameSets||[])){
      const seenMoves=new Set();
      for(const [move,count] of Object.entries(set.moves||{})){const k=String(move).trim();if(k){seasonMoves[k]=(seasonMoves[k]||0)+Number(count||0);seenMoves.add(k);}}
      // Replay logs do not expose the full four-move team sheet. A move is
      // therefore counted as "brought" when it is observed on that week's
      // battle set; each set contributes at most one bring for a move.
      for(const k of seenMoves) seasonMovesBrought[k]=(seasonMovesBrought[k]||0)+1;
      for(const [item,count] of Object.entries(set.items||{})){const k=String(item).trim();if(k)seasonItems[k]=(seasonItems[k]||0)+Number(count||0);}
      for(const [item,count] of Object.entries(set.confirmedItems||{})){const k=String(item).trim();if(k){seasonItems[k]=Math.max(Number(seasonItems[k]||0),Number(count||0));seasonItemEvidence[k]='confirmed';}}
      for(const [item,count] of Object.entries(set.inferredItems||{})){const k=String(item).trim();if(k && seasonItemEvidence[k] !== 'confirmed'){seasonItems[k]=Math.max(Number(seasonItems[k]||0),Number(count||0));seasonItemEvidence[k]='inferred';}}
    }
    // Some replay/parser versions expose item evidence on the aggregate Pokémon
    // record as well as inside gameSets. Merge both shapes so inferred items are
    // never silently omitted from Season Overview.
    for(const [item,count] of Object.entries(usage.confirmedItems||{})){const k=String(item).trim();if(k){seasonItems[k]=Math.max(Number(seasonItems[k]||0),Number(count||0));seasonItemEvidence[k]='confirmed';}}
    for(const [item,count] of Object.entries(usage.inferredItems||{})){const k=String(item).trim();if(k && seasonItemEvidence[k] !== 'confirmed'){seasonItems[k]=Math.max(Number(seasonItems[k]||0),Number(count||0));seasonItemEvidence[k]='inferred';}}
    for(const [move,count] of Object.entries(usage.moves||{})){const k=String(move).trim();if(k&&!seasonMoves[k])seasonMoves[k]=Number(count||0);}
    for(const [item,count] of Object.entries(usage.items||{})){const k=String(item).trim();if(k&&!seasonItems[k])seasonItems[k]=Number(count||0);}
    const sortedMoveBroughtEntries=Object.entries(seasonMovesBrought).sort((a,b)=>Number(b[1])-Number(a[1])||a[0].localeCompare(b[0]));
    const sortedMoveEntries=Object.entries(seasonMoves).sort((a,b)=>Number(b[1])-Number(a[1])||a[0].localeCompare(b[0]));
    const sortedItemEntries=Object.entries(seasonItems).sort((a,b)=>Number(b[1])-Number(a[1])||a[0].localeCompare(b[0]));
    const sentOutTotal=[...(usage.gameSets||[])].reduce((n,g)=>n+Number(g.sentOut||0),0);
    const ledFromGameSets=[...(usage.gameSets||[])].reduce((n,g)=>n+(Number(g.led)||0),0);
    const ledTotal=Math.min(ledFromGameSets>0?ledFromGameSets:Number(usage.leads||0),sentOutTotal);
    const broughtTotal=Number(usage.appearances||0);
    const totalMoveUses=Object.values(seasonMoves).reduce((a,b)=>a+Number(b||0),0);
    const totalItemUses=Object.values(seasonItems).reduce((a,b)=>a+Number(b||0),0);
    const pct=(count,total)=>total?`${Math.round((Number(count)||0)/total*100)}%`:'0%';
    const usageRows=(entries,label,totalOverride=null)=>entries.length?entries.map(([name,count])=>{const total=totalOverride!=null?Number(totalOverride)||0:(label==='moves'?totalMoveUses:totalItemUses);const evidence=label==='items'&&seasonItemEvidence[name]==='inferred'?'<small class="prep-analysis-inferred">Inferred</small>':'';return `<div class="prep-analysis-row"><span>${esc(name)}${evidence}</span><div class="prep-analysis-row-value"><strong>${Number(count)||0}</strong><small>${pct(count,total)}</small></div></div>`;}).join(''):`<div class="small">No recorded ${label.toLowerCase()}.</div>`;
    const weekSections=broughtInWeeks.length?broughtInWeeks.map((w,i)=>{const st=weekStats.get(String(w))||{moves:{},items:{},led:0,sentOut:0};const ms=Object.entries(st.moves).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const its=Object.entries(st.items).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const led=Number(st.led||0)>0&&Number(st.sentOut||0)>0;const sent=Number(st.sentOut||0)>0;const status=led?'Led · Sent out':sent?'Sent out':'Brought only';const moveUses=ms.reduce((a,x)=>a+Number(x[1]||0),0);const itemUses=its.reduce((a,x)=>a+Number(x[1]||0),0);return `<article class="prep-analysis-week" data-week-pane="${esc(w)}" ${i?'hidden':''}><div class="prep-analysis-week-head"><div><strong>${esc(weekLabel(w))}</strong><small>${status}</small></div><span class="prep-week-status-dot ${led?'is-led':sent?'is-sent':'is-brought'}"></span></div><div class="prep-analysis-week-stats"><span><b>${moveUses}</b> move uses</span><span><b>${itemUses}</b> item records</span></div><div class="prep-analysis-columns"><div><div class="prep-analysis-subhead">Moves clicked</div>${usageRows(ms,'moves',moveUses)}</div><div><div class="prep-analysis-subhead">Items held</div>${usageRows(its,'items',itemUses)}</div></div></article>`;}).join(''):'<div class="small">No recorded battle weeks for this Pokémon.</div>';
    const weekButtons=broughtInWeeks.map((w,i)=>`<button type="button" class="prep-analysis-week-btn${i?'':' active'}" data-prep-week-btn="${esc(w)}" aria-pressed="${i?'false':'true'}">${esc(weekLabel(w))}</button>`).join('');
    const matchupItems=goodInto.length?goodInto.map(x=>`<span class="prep-chip">${esc(displaySpecies(x))}</span>`).join(''):'<span class="small">No clear type advantage</span>';
    const analysisHtml=`<div class="matchprep-analysis-overview">
      <section class="prep-analysis-season">
        <div class="prep-analysis-section-head"><div><span class="prep-analysis-eyebrow">Season overview</span><h3>How ${esc(displaySpecies(m))} has been used</h3><p>All recorded battles for this season. <strong>Brought</strong> means included in the submitted team; <strong>Sent Out</strong> means it actually entered battle.</p></div></div>
        <div class="prep-analysis-summary-grid"><div class="prep-analysis-stat"><span>Brought</span><strong>${broughtTotal}</strong><small>submitted teams</small></div><div class="prep-analysis-stat"><span>Led</span><strong>${ledTotal}</strong><small>battle starts</small></div><div class="prep-analysis-stat"><span>Sent out</span><strong>${sentOutTotal}</strong><small>field appearances</small></div></div>
        <div class="prep-analysis-overview-grid">
          <section class="prep-analysis-table-card"><div class="prep-analysis-card-head"><div><h4>Moves brought</h4><small>Number of battle sets where each move was observed. Replay logs do not expose unclicked moves.</small></div><strong>${Object.values(seasonMovesBrought).reduce((a,b)=>a+Number(b||0),0)}</strong></div><div class="prep-analysis-list">${usageRows(sortedMoveBroughtEntries,'moves',broughtInWeeks.length||1)}</div></section>
          <section class="prep-analysis-table-card"><div class="prep-analysis-card-head"><div><h4>Items held</h4><small>Items actually recorded on this Pokémon</small></div><strong>${totalItemUses===1&&Object.keys(usage.items||{}).length===0?0:totalItemUses}</strong></div><div class="prep-analysis-list">${usageRows(sortedItemEntries,'items')}</div></section>
        </div>
        <div class="prep-analysis-extra-grid"><div class="prep-analysis-mini-card"><span>Strong into ${opponent}</span><div class="prep-chip-row">${matchupItems}</div></div><div class="prep-analysis-mini-card"><span>Likely roles</span><div class="prep-chip-row">${roles.length?roles.map(x=>`<span class="prep-chip">${esc(x)}</span>`).join(''):'<span class="small">Unclear</span>'}</div></div></div>
      </section>
      <section class="prep-analysis-weeks-section"><div class="prep-analysis-section-head"><div><span class="prep-analysis-eyebrow">Weekly breakdown</span><h3>Usage by week</h3><p>Select a week to view its usage without scrolling through the entire season.</p></div><div class="prep-analysis-week-buttons" role="group" aria-label="Select week">${weekButtons}</div></div><div class="prep-analysis-weeks">${weekSections}</div></section>
    </div>`;
    const threat=goodInto.length?`Strong into ${goodInto.length} Pokémon`:'No clear type advantage';
    const tc=goodInto.length?'matchup-bad':'matchup-neutral';
    return `<article class="prep-opponent-card prep-opponent-popout" data-prep-popout="${esc(m.species)}" data-prep-team="opponent"><button type="button" class="prep-popout-trigger legacy-mon-card"><span class="mon-head">${sprite(m.species,'prep-sprite')}<span><span class="mon-name prep-legacy-name"><strong>${esc(displaySpecies(m))}</strong><span class="prep-inline-types">${effTypes.map(t=>typePill(t)).join('')}</span></span><span class="muted">${usage.replays?.size||0} replay${(usage.replays?.size||0)===1?'':'s'} · ${usage.appearances||0} appearances</span></span></span><span class="chips prep-legacy-chips"><span class="chip"><b>${usage.kills||0}</b> K</span><span class="chip"><b>${usage.deaths||0}</b> D</span><span class="chip"><b>${Number(usage.dealt||0).toFixed(0)}</b> dmg</span></span><span class="small prep-legacy-threat">${esc(threat)}</span></button><div class="prep-popout-data" hidden data-usage="${esc(usageHtml)}" data-scouting="${esc(scoutingHtml)}" data-analysis="${esc(analysisHtml)}" data-appearances="${usage.appearances||0}" data-kills="${usage.kills||0}" data-deaths="${usage.deaths||0}" data-dealt="${Number(usage.dealt||0).toFixed(0)}" data-taken="${Number(usage.taken||0).toFixed(0)}"></div></article>`;
  }))).join('');

  // -------- Your Team Overview --------
  // Mirrors the opponent card grid above but for YOUR roster, so both sides
  // of the matchup can be scouted from the same panel via a tab toggle.
  const strongIntoFor=(m)=>opp.filter(o=>{
    const attackerTypes=normalizedTypes(typeMap[m.species]||[]);
    const defenderTypes=normalizedTypes(typeMap[o.species]||[]);
    const mult=combinedMultiplier(attackerTypes,defenderTypes);
    return mult!==null && mult>=2;
  });
  const yourAggregate=aggregate(yourTeam);
  const yourUsageFor=m=>yourAggregate.mons[norm(m.species)] || yourAggregate.mons[m.species] || {appearances:0,kills:0,deaths:0,dealt:0,taken:0,replays:new Set(),gameSets:[],weeks:new Set(),items:{},confirmedItems:{},inferredItems:{},itemEvidence:{}};
  const yourCards=(await Promise.all(your.map(async m=>{
    const info=yourRoster.get(norm(m.species));
    const strongInto=strongIntoFor(m);
    const moves=observedFor(m).slice(0,6);
    const roles=rolesFor(m).slice(0,3);
    const usage=yourUsageFor(m);
    const pdata=await fetchPokemonData(m.species);
    const abilities=pdata?.abilities||[];
    const baseStats=pdata?.stats||{};
    const prettyAbility=a=>String(a).replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    const effTypes=normalizedTypes(typeMap[m.species]||pdata?.types||[]);
    const allTypes=['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
    const eff=defensiveTypeEffectiveness(effTypes).filter(x=>x.mult!==null && x.mult!==1);
    const weaknesses=eff.filter(x=>x.mult>1),resistances=eff.filter(x=>x.mult>0&&x.mult<1),immunities=eff.filter(x=>x.mult===0);
    const group=(title,items)=>`<div class="prep-popup-subsection"><strong>${title}</strong><div class="prep-chip-row">${items.length?items.map(x=>`<span class="prep-chip">${esc(x.type)} ${fmtMult(x.mult)}</span>`).join(''):'<span class="small">None</span>'}</div></div>`;
    const scoutingHtml=`<div class="prep-popup-grid">
      <div class="prep-card-section"><span>Typing</span><div class="type-row">${effTypes.length?effTypes.map(t=>typePill(t)).join(''):'<span class="small">Typing unavailable</span>'}</div></div>
      <div class="prep-card-section"><span>Strong into opponent</span><div class="prep-chip-row">${strongInto.length?strongInto.map(x=>`<span class="prep-chip">${esc(displaySpecies(x))}</span>`).join(''):'<span class="small">No clear type advantage</span>'}</div></div>
      <div class="prep-card-section"><span>Abilities</span><div class="prep-chip-row">${abilities.length?abilities.map(a=>`<span class="prep-chip">${esc(prettyAbility(a))}</span>`).join(''):'<span class="small">Unavailable</span>'}</div></div>
      <div class="prep-card-section"><span>Observed moves</span><div class="prep-chip-row">${moves.length?moves.map(x=>`<span class="prep-chip">${esc(x)}</span>`).join(''):'<span class="small">No recorded moves</span>'}</div></div>
      <div class="prep-card-section"><span>Likely roles</span><div class="prep-chip-row">${roles.length?roles.map(x=>`<span class="prep-chip">${esc(x)}</span>`).join(''):'<span class="small">Unclear</span>'}</div></div>
      <div class="prep-card-section"><span>Point value</span><div class="small">${info?.points!==''&&info?.points!=null?esc(info.points)+' pts':'Point value unavailable'}</div></div>
    </div>
    <div class="prep-card-section"><span>Type effectiveness</span>${group('Weaknesses',weaknesses)}${group('Resistances',resistances)}${group('Immunities',immunities)}</div>
    <div class="prep-card-section"><span>Base stats</span><div class="prep-stat-grid">${[['hp','HP'],['attack','Atk'],['defense','Def'],['special-attack','SpA'],['special-defense','SpD'],['speed','Spe']].map(([k,l])=>`<span class="prep-chip">${l}: ${baseStats[k]??'—'}</span>`).join('')}</div></div>`;
    const usageHtml=`<div class="prep-usage-grid"><div><span>Appearances</span><strong>${usage.appearances||0}</strong></div><div><span>KOs</span><strong>${usage.kills||0}</strong></div><div><span>Deaths</span><strong>${usage.deaths||0}</strong></div><div><span>Damage dealt</span><strong>${Number(usage.dealt||0).toFixed(0)}</strong></div><div><span>Damage taken</span><strong>${Number(usage.taken||0).toFixed(0)}</strong></div></div>`;
    const broughtInWeeks=[...(usage.weeks||[])].sort((a,b)=>{const na=Number(a),nb=Number(b);if(Number.isFinite(na)&&Number.isFinite(nb))return na-nb;return String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});});
    const weekLabel=w=>/^\d+$/.test(String(w))?`Week ${w}`:String(w);
    const weekStats=new Map();
    for(const set of (usage.gameSets||[])){const wk=String(set.week??'').trim();if(!wk)continue;const cur=weekStats.get(wk)||{moves:{},items:{},led:0,sentOut:0};for(const [move,count] of Object.entries(set.moves||{}))cur.moves[move]=(cur.moves[move]||0)+Number(count||0);for(const [item,count] of Object.entries(set.items||{}))cur.items[item]=(cur.items[item]||0)+Number(count||0);for(const [item,count] of Object.entries(set.confirmedItems||{}))cur.items[item]=Math.max(Number(cur.items[item]||0),Number(count||0));for(const [item,count] of Object.entries(set.inferredItems||{}))cur.items[item]=Math.max(Number(cur.items[item]||0),Number(count||0));cur.led+=Number(set.led||0);cur.sentOut+=Number(set.sentOut||0);weekStats.set(wk,cur);}
    // Season-level usage is derived from every recorded game set. Older
    // aggregate records may not have a top-level `moves` object even though
    // the weekly gameSets do, so never let the season overview appear empty
    // when the week-by-week data is present.
    const seasonMoves={};
    const seasonMovesBrought={};
    const seasonItems={};
    const seasonItemEvidence={};
    for(const set of (usage.gameSets||[])){
      const seenMoves=new Set();
      for(const [move,count] of Object.entries(set.moves||{})){const k=String(move).trim();if(k){seasonMoves[k]=(seasonMoves[k]||0)+Number(count||0);seenMoves.add(k);}}
      // Replay logs do not expose the full four-move team sheet. A move is
      // therefore counted as "brought" when it is observed on that week's
      // battle set; each set contributes at most one bring for a move.
      for(const k of seenMoves) seasonMovesBrought[k]=(seasonMovesBrought[k]||0)+1;
      for(const [item,count] of Object.entries(set.items||{})){const k=String(item).trim();if(k)seasonItems[k]=(seasonItems[k]||0)+Number(count||0);}
      for(const [item,count] of Object.entries(set.confirmedItems||{})){const k=String(item).trim();if(k){seasonItems[k]=Math.max(Number(seasonItems[k]||0),Number(count||0));seasonItemEvidence[k]='confirmed';}}
      for(const [item,count] of Object.entries(set.inferredItems||{})){const k=String(item).trim();if(k && seasonItemEvidence[k] !== 'confirmed'){seasonItems[k]=Math.max(Number(seasonItems[k]||0),Number(count||0));seasonItemEvidence[k]='inferred';}}
    }
    for(const [move,count] of Object.entries(usage.moves||{})){const k=String(move).trim();if(k&&!seasonMoves[k])seasonMoves[k]=Number(count||0);}
    for(const [item,count] of Object.entries(usage.items||{})){const k=String(item).trim();if(k&&!seasonItems[k])seasonItems[k]=Number(count||0);}
    const sortedMoveBroughtEntries=Object.entries(seasonMovesBrought).sort((a,b)=>Number(b[1])-Number(a[1])||a[0].localeCompare(b[0]));
    const sortedMoveEntries=Object.entries(seasonMoves).sort((a,b)=>Number(b[1])-Number(a[1])||a[0].localeCompare(b[0]));
    const sortedItemEntries=Object.entries(seasonItems).sort((a,b)=>Number(b[1])-Number(a[1])||a[0].localeCompare(b[0]));
    const sentOutTotal=[...(usage.gameSets||[])].reduce((n,g)=>n+Number(g.sentOut||0),0);
    const ledFromGameSets=[...(usage.gameSets||[])].reduce((n,g)=>n+(Number(g.led)||0),0);
    const ledTotal=Math.min(ledFromGameSets>0?ledFromGameSets:Number(usage.leads||0),sentOutTotal);
    const broughtTotal=Number(usage.appearances||0);
    const totalMoveUses=Object.values(seasonMoves).reduce((a,b)=>a+Number(b||0),0);
    const totalItemUses=Object.values(seasonItems).reduce((a,b)=>a+Number(b||0),0);
    const pct=(count,total)=>total?`${Math.round((Number(count)||0)/total*100)}%`:'0%';
    const usageRows=(entries,label,totalOverride=null)=>entries.length?entries.map(([name,count])=>{const total=totalOverride!=null?Number(totalOverride)||0:(label==='moves'?totalMoveUses:totalItemUses);const evidence=label==='items'&&seasonItemEvidence[name]==='inferred'?'<small class="prep-analysis-inferred">Inferred</small>':'';return `<div class="prep-analysis-row"><span>${esc(name)}${evidence}</span><div class="prep-analysis-row-value"><strong>${Number(count)||0}</strong><small>${pct(count,total)}</small></div></div>`;}).join(''):`<div class="small">No recorded ${label.toLowerCase()}.</div>`;
    const weekSections=broughtInWeeks.length?broughtInWeeks.map((w,i)=>{const st=weekStats.get(String(w))||{moves:{},items:{},led:0,sentOut:0};const ms=Object.entries(st.moves).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const its=Object.entries(st.items).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const led=Number(st.led||0)>0&&Number(st.sentOut||0)>0;const sent=Number(st.sentOut||0)>0;const status=led?'Led · Sent out':sent?'Sent out':'Brought only';const moveUses=ms.reduce((a,x)=>a+Number(x[1]||0),0);const itemUses=its.reduce((a,x)=>a+Number(x[1]||0),0);return `<article class="prep-analysis-week" data-week-pane="${esc(w)}" ${i?'hidden':''}><div class="prep-analysis-week-head"><div><strong>${esc(weekLabel(w))}</strong><small>${status}</small></div><span class="prep-week-status-dot ${led?'is-led':sent?'is-sent':'is-brought'}"></span></div><div class="prep-analysis-week-stats"><span><b>${moveUses}</b> move uses</span><span><b>${itemUses}</b> item records</span></div><div class="prep-analysis-columns"><div><div class="prep-analysis-subhead">Moves clicked</div>${usageRows(ms,'moves',moveUses)}</div><div><div class="prep-analysis-subhead">Items held</div>${usageRows(its,'items',itemUses)}</div></div></article>`;}).join(''):'<div class="small">No recorded battle weeks for this Pokémon.</div>';
    const weekButtons=broughtInWeeks.map((w,i)=>`<button type="button" class="prep-analysis-week-btn${i?'':' active'}" data-prep-week-btn="${esc(w)}" aria-pressed="${i?'false':'true'}">${esc(weekLabel(w))}</button>`).join('');
    const matchupItems=strongInto.length?strongInto.map(x=>`<span class="prep-chip">${esc(displaySpecies(x))}</span>`).join(''):'<span class="small">No clear type advantage</span>';
    const analysisHtml=`<div class="matchprep-analysis-overview">
      <section class="prep-analysis-season">
        <div class="prep-analysis-section-head"><div><span class="prep-analysis-eyebrow">Season overview</span><h3>How ${esc(displaySpecies(m))} has been used</h3><p>All recorded battles for this season. <strong>Brought</strong> means included in the submitted team; <strong>Sent Out</strong> means it actually entered battle.</p></div></div>
        <div class="prep-analysis-summary-grid"><div class="prep-analysis-stat"><span>Brought</span><strong>${broughtTotal}</strong><small>submitted teams</small></div><div class="prep-analysis-stat"><span>Led</span><strong>${ledTotal}</strong><small>battle starts</small></div><div class="prep-analysis-stat"><span>Sent out</span><strong>${sentOutTotal}</strong><small>field appearances</small></div></div>
        <div class="prep-analysis-overview-grid">
          <section class="prep-analysis-table-card"><div class="prep-analysis-card-head"><div><h4>Moves brought</h4><small>Number of battle sets where each move was observed. Replay logs do not expose unclicked moves.</small></div><strong>${Object.values(seasonMovesBrought).reduce((a,b)=>a+Number(b||0),0)}</strong></div><div class="prep-analysis-list">${usageRows(sortedMoveBroughtEntries,'moves',broughtInWeeks.length||1)}</div></section>
          <section class="prep-analysis-table-card"><div class="prep-analysis-card-head"><div><h4>Items held</h4><small>Items actually recorded on this Pokémon</small></div><strong>${totalItemUses===1&&Object.keys(usage.items||{}).length===0?0:totalItemUses}</strong></div><div class="prep-analysis-list">${usageRows(sortedItemEntries,'items')}</div></section>
        </div>
        <div class="prep-analysis-extra-grid"><div class="prep-analysis-mini-card"><span>Strong into ${opponent}</span><div class="prep-chip-row">${matchupItems}</div></div><div class="prep-analysis-mini-card"><span>Likely roles</span><div class="prep-chip-row">${roles.length?roles.map(x=>`<span class="prep-chip">${esc(x)}</span>`).join(''):'<span class="small">Unclear</span>'}</div></div></div>
      </section>
      <section class="prep-analysis-weeks-section"><div class="prep-analysis-section-head"><div><span class="prep-analysis-eyebrow">Weekly breakdown</span><h3>Usage by week</h3><p>Select a week to view its usage without scrolling through the entire season.</p></div><div class="prep-analysis-week-buttons" role="group" aria-label="Select week">${weekButtons}</div></div><div class="prep-analysis-weeks">${weekSections}</div></section>
    </div>`;
    const threat=strongInto.length?`Strong into ${strongInto.length} Pokémon`:'No clear type advantage';
    const tc=strongInto.length?'matchup-good':'matchup-neutral';
    return `<article class="prep-opponent-card prep-opponent-popout" data-prep-popout="${esc(m.species)}" data-prep-team="your"><button type="button" class="prep-popout-trigger legacy-mon-card"><span class="mon-head">${sprite(m.species,'prep-sprite')}<span><span class="mon-name prep-legacy-name"><strong>${esc(displaySpecies(m))}</strong><span class="prep-inline-types">${effTypes.map(t=>typePill(t)).join('')}</span></span><span class="muted">${usage.replays?.size||0} replay${(usage.replays?.size||0)===1?'':'s'} · ${usage.appearances||0} appearances</span></span></span><span class="chips prep-legacy-chips"><span class="chip"><b>${usage.kills||0}</b> K</span><span class="chip"><b>${usage.deaths||0}</b> D</span><span class="chip"><b>${Number(usage.dealt||0).toFixed(0)}</b> dmg</span></span><span class="small prep-legacy-threat">${esc(threat)}</span></button><div class="prep-popout-data" hidden data-usage="${esc(usageHtml)}" data-scouting="${esc(scoutingHtml)}" data-analysis="${esc(analysisHtml)}" data-appearances="${usage.appearances||0}" data-kills="${usage.kills||0}" data-deaths="${usage.deaths||0}" data-dealt="${Number(usage.dealt||0).toFixed(0)}" data-taken="${Number(usage.taken||0).toFixed(0)}"></div></article>`;
  }))).join('');

  // -------- Defensive / Offensive Type Chart & Team Coverage Chart --------
  // Both built from YOUR roster's typing (via typeMap, already fetched above).
  // Defensive: how each of your Pokémon takes each attacking type.
  // Offensive: the best multiplier each of your Pokémon can land on each
  // defending type, assuming a same-type (STAB) move — a simple, move-data-free
  // proxy for offensive coverage that's accurate for typing-driven matchups.
  const typeChartMonRow=(mon)=>{
    const types=normalizedTypes(typeMap[mon.species]||[]);
    const defensive=TYPE_NAMES.map(atk=>types.length?types.reduce((v,def)=>v*typeChartMultiplier(atk,def),1):null);
    const offensive=TYPE_NAMES.map(def=>types.length?Math.max(...types.map(atk=>typeChartMultiplier(atk,def))):null);
    return {mon,types,defensive,offensive};
  };
  const typeChartRows=your.map(typeChartMonRow);
  const defCellClass=(mult)=>{
    if(mult===null)return 'tc-cell-unknown';
    if(mult===0)return 'tc-cell-immune';
    if(mult>=4)return 'tc-cell-vweak';
    if(mult>=2)return 'tc-cell-weak';
    if(mult<=0.25)return 'tc-cell-vresist';
    if(mult<1)return 'tc-cell-resist';
    return 'tc-cell-neutral';
  };
  const offCellClass=(mult)=>{
    if(mult===null)return 'tc-cell-unknown';
    if(mult===0)return 'tc-cell-noeffect';
    if(mult>=4)return 'tc-cell-vsuper';
    if(mult>=2)return 'tc-cell-super';
    if(mult<1)return 'tc-cell-weakhit';
    return 'tc-cell-neutral';
  };
  const typeChartTable=(rows,cellsKey,cellClassFn)=>`<div class="tc-table-wrap"><table class="tc-table">
    <thead><tr><th class="tc-corner">Pokémon</th>${TYPE_NAMES.map(t=>`<th>${typePill(t)}</th>`).join('')}</tr></thead>
    <tbody>${rows.length?rows.map(r=>`<tr><th><div class="tc-row-mon">${sprite(r.mon.species,'tc-row-sprite')}<span>${esc(displaySpecies(r.mon))}</span></div></th>${r[cellsKey].map(mult=>`<td class="${cellClassFn(mult)}"><span>${mult===null?'—':fmtMult(mult)}</span></td>`).join('')}</tr>`).join(''):`<tr><td colspan="${TYPE_NAMES.length+1}"><div class="empty">No Pokémon on your current roster yet.</div></td></tr>`}</tbody>
  </table></div>`;
  const typeChartSection=`<section id="prepTypeChart" class="panel prep-selectable-section" data-prep-section="typechart">
    <div class="team-overview-head">
      <div><h2 id="prepTypeChartTitle">Defensive Type Chart</h2><p class="panel-desc" style="margin:0">How your current roster's typing holds up against each attacking type (Defensive), or hits each defending type with a same-type move (Offensive).</p></div>
      <div class="team-overview-toggle" role="tablist" aria-label="Type Chart mode">
        <button type="button" class="team-overview-toggle-btn active" data-typechart-mode="defensive" aria-pressed="true">Defensive</button>
        <button type="button" class="team-overview-toggle-btn" data-typechart-mode="offensive" aria-pressed="false">Offensive</button>
      </div>
    </div>
    <div data-typechart-grid="defensive">${typeChartTable(typeChartRows,'defensive',defCellClass)}</div>
    <div data-typechart-grid="offensive" hidden>${typeChartTable(typeChartRows,'offensive',offCellClass)}</div>
    <div class="tc-legend"><span class="tc-legend-item"><i class="tc-cell-vweak"></i>4× weak</span><span class="tc-legend-item"><i class="tc-cell-weak"></i>2× weak</span><span class="tc-legend-item"><i class="tc-cell-neutral"></i>1×</span><span class="tc-legend-item"><i class="tc-cell-resist"></i>½× resist</span><span class="tc-legend-item"><i class="tc-cell-vresist"></i>¼× resist</span><span class="tc-legend-item"><i class="tc-cell-immune"></i>Immune</span></div>
  </section>`;

  // -------- Interactive Type Coverage --------
  // Select one of YOUR Pokémon and show the actual damaging move types it can
  // use physically and specially, plus the opposing Pokémon each type hits for
  // super-effective damage. This is based on the Pokémon's current legal
  // damaging learnset rather than assuming its typing equals its movepool.
  const coverageMoveCache=new Map();
  const coverageDexSlug=(species)=>{
    const original=String(species||'').trim().toLowerCase()
      .replace(/[’']/g,'').replace(/[♀]/g,'-f').replace(/[♂]/g,'-m')
      .replace(/[.:]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
    const aliases={
      'landorus-incarnate':'landorus','tornadus-incarnate':'tornadus','thundurus-incarnate':'thundurus',
      'enamorus-incarnate':'enamorus','landorus-therian':'landorus-therian','tornadus-therian':'tornadus-therian',
      'thundurus-therian':'thundurus-therian','enamorus-therian':'enamorus-therian'
    };
    const out=[]; const add=x=>{if(x&&!out.includes(x))out.push(x)};
    add(aliases[original]||original); add(original); add(original.replace(/-/g,''));
    const parts=original.split('-'); for(let i=parts.length-1;i>=1;i--) add(parts.slice(0,i).join('-'));
    return out;
  };
  const loadCoverageMoves=async(species)=>{
    const key=norm(species);
    if(coverageMoveCache.has(key))return coverageMoveCache.get(key);
    let raw=[];
    for(const slug of coverageDexSlug(species)){
      try{
        const r=await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(slug)}`,{cache:'force-cache'});
        if(!r.ok)continue;
        const d=await r.json();
        raw=(d.moves||[]).map(x=>({name:x.move?.name,url:x.move?.url})).filter(x=>x.name&&x.url);
        if(raw.length)break;
      }catch(e){}
    }
    const details=[];
    for(let i=0;i<raw.length;i+=18){
      const batch=raw.slice(i,i+18);
      const result=await Promise.all(batch.map(async entry=>{
        try{
          const r=await fetch(entry.url,{cache:'force-cache'}); if(!r.ok)return null;
          const d=await r.json();
          const category=String(d.damage_class?.name||'').toLowerCase();
          const power=Number(d.power);
          const type=String(d.type?.name||'').replace(/\b\w/g,c=>c.toUpperCase());
          if(power>0&&(category==='physical'||category==='special')&&type) return {
            name:String(d.name||entry.name).split('-').map(x=>x?x[0].toUpperCase()+x.slice(1):x).join(' '),
            type,category,power
          };
        }catch(e){}
        return null;
      }));
      result.filter(Boolean).forEach(x=>details.push(x));
    }
    const unique=[...new Map(details.map(x=>[`${norm(x.name)}|${x.category}`,x])).values()]
      .sort((a,b)=>a.category.localeCompare(b.category)||a.type.localeCompare(b.type)||a.name.localeCompare(b.name));
    coverageMoveCache.set(key,unique); return unique;
  };
  const coverageSelected=STATE.prepCoverageMon && your.some(m=>norm(m.species)===norm(STATE.prepCoverageMon))
    ?STATE.prepCoverageMon:(your[0]?.species||'');
  STATE.prepCoverageMon=coverageSelected;
  const coverageMoves=coverageSelected?await loadCoverageMoves(coverageSelected):[];
  const coverageOpp=opp;
  const offensiveCoverageMoves=coverageMoves.filter(m=>m.type!=='Normal');
  const selectedCoverageObj=your.find(m=>norm(m.species)===norm(coverageSelected));
  const superEffectiveTargets=(()=>{
    const byMon=new Map();
    offensiveCoverageMoves.forEach(move=>{
      coverageOpp.forEach(mon=>{
        const defs=normalizedTypes(typeMap[mon.species]||[]);
        if(!defs.length)return;
        const mult=defs.reduce((v,d)=>v*typeChartMultiplier(move.type,d),1);
        if(mult>=2){
          const key=norm(mon.species);
          const prev=byMon.get(key);
          if(!prev||mult>prev.mult)byMon.set(key,{mon,mult,types:prev?.types||[]});
          const entry=byMon.get(key);
          if(!entry.types.includes(move.type))entry.types.push(move.type);
        }
      });
    });
    return [...byMon.values()].sort((a,b)=>b.mult-a.mult||displaySpecies(a.mon).localeCompare(displaySpecies(b.mon)));
  })();
  // Merge physical + special into one row per attacking TYPE (previously two
  // parallel panels duplicated the same target lists under each category).
  // Category is now a small tag on each move chip instead of a whole column.
  const coverageRows=(()=>{
    const byType=new Map();
    offensiveCoverageMoves.forEach(m=>{
      if(!byType.has(m.type))byType.set(m.type,[]);
      byType.get(m.type).push(m);
    });
    return [...byType.entries()].map(([type,moves])=>{
      const targets=coverageOpp.map(mon=>{
        const defs=normalizedTypes(typeMap[mon.species]||[]);
        const mult=defs.length?defs.reduce((v,d)=>v*typeChartMultiplier(type,d),1):null;
        return {mon,mult};
      }).filter(t=>t.mult!==null&&t.mult>=2);
      moves.sort((a,b)=>b.power-a.power||a.name.localeCompare(b.name));
      return {type,moves,targets};
    }).sort((a,b)=>b.targets.length-a.targets.length||TYPE_NAMES.indexOf(a.type)-TYPE_NAMES.indexOf(b.type));
  })();
  // Coverage map: two panels that read at a glance —
  // (1) which attacking types the selected Pokémon actually threatens with,
  //     lit up in that type's own colour when it lands 2×+ on the scouted
  //     team, dim when the type is on its movepool but whiffs, and grayed
  //     out entirely when it has no damaging move of that type at all;
  // (2) the full opposing roster, each Pokémon lit up when exploitable and
  //     faded to grayscale when it's safe from this attacker.
  // No move names are shown anywhere — just the shape of the matchup.
  const hitByMon=new Map(superEffectiveTargets.map(e=>[norm(e.mon.species),e]));
  const typeGridChip=(type)=>{
    const row=coverageRows.find(r=>r.type===type);
    const count=row?row.targets.length:0;
    const covered=!!row;
    const cls=count>0?'tc2-type-hot':covered?'tc2-type-warm':'tc2-type-cold';
    const title=count>0?`${type}: hits ${count} opposing Pokémon super-effectively — click to see moves`:covered?`${type}: no opposing Pokémon is weak to this — click to see moves`:`${type}: no damaging move of this type`;
    const monName=displaySpecies(selectedCoverageObj||{species:coverageSelected});
    const attrs=covered?` data-cov-type="${esc(type)}" data-cov-mon="${esc(monName)}" data-cov-moves="${esc(JSON.stringify(row.moves.map(m=>({name:m.name,category:m.category,power:m.power}))))}"`:'';
    return `<div class="tc2-type-chip ${cls}${covered?' tc2-type-clickable':''}" title="${esc(title)}"${attrs}>${typePill(type)}${count>0?`<span class="tc2-type-count">${count}</span>`:''}</div>`;
  };
  const oppCard=(mon)=>{
    const hit=hitByMon.get(norm(mon.species));
    return `<div class="tc2-opp-card ${hit?'tc2-opp-hit':'tc2-opp-safe'}">
      <div class="tc2-opp-sprite-wrap">${sprite(mon.species,'tc2-opp-sprite')}</div>
      <div class="tc2-opp-name">${esc(displaySpecies(mon))}</div>
      ${hit?`<div class="tc2-opp-hit-types">${hit.types.map(t=>typePill(t)).join('')}</div>`:'<div class="tc2-opp-safe-label">Not threatened</div>'}
    </div>`;
  };
  // Best 4-type coverage: brute-force the combination of up to 4 attacking
  // types (from types the mon actually has damaging moves for) that hits
  // the most *distinct* opposing Pokémon super-effectively. Small search
  // space (at most a handful of covered types), so exact brute force is
  // cheap and beats a greedy approximation.
  const bestCoverageCombo=(rows,k)=>{
    const candidates=rows.filter(r=>r.targets.length>0);
    if(!candidates.length)return{types:[],total:0};
    if(candidates.length<=k){
      const covered=new Set();
      candidates.forEach(r=>r.targets.forEach(t=>covered.add(norm(t.mon.species))));
      return{types:candidates.map(r=>({type:r.type,count:r.targets.length})),total:covered.size};
    }
    const n=candidates.length;
    let best=null;
    const chosen=[];
    const recurse=(start)=>{
      if(chosen.length===k){
        const covered=new Set();let sum=0;
        chosen.forEach(i=>{candidates[i].targets.forEach(t=>covered.add(norm(t.mon.species)));sum+=candidates[i].targets.length;});
        const size=covered.size;
        if(!best||size>best.size||(size===best.size&&sum>best.sum))best={size,sum,idx:[...chosen]};
        return;
      }
      for(let i=start;i<n;i++){chosen.push(i);recurse(i+1);chosen.pop();}
    };
    recurse(0);
    return{types:best.idx.map(i=>({type:candidates[i].type,count:candidates[i].targets.length})),total:best.size};
  };
  const bestCombo=bestCoverageCombo(coverageRows,4);
  const bestComboBlock=bestCombo.types.length?`<div class="tc2-best-combo"><span class="tc2-best-combo-label">Best ${bestCombo.types.length===1?'':bestCombo.types.length+'-type'} coverage</span><div class="tc2-best-combo-types">${bestCombo.types.map(t=>typePill(t.type)).join('')}</div><span class="tc2-best-combo-note">${bestCombo.total} of ${coverageOpp.length} opponents</span></div>`:'';
  const topThree=coverageRows.filter(r=>r.targets.length>0).sort((a,b)=>b.targets.length-a.targets.length).slice(0,3);
  const topThreeBlock=topThree.length?`<div class="tc2-top3"><span class="tc2-top3-label">Top types</span><div class="tc2-top3-list">${topThree.map((r,i)=>`<div class="tc2-top3-item"><span class="tc2-top3-rank">${i+1}</span>${typePill(r.type)}<span class="tc2-top3-count">${r.targets.length}</span></div>`).join('')}</div></div>`:'';
  const monStrip=selectedCoverageObj?`<div class="tc2-mon-strip">${sprite(selectedCoverageObj.species,'tc2-mon-sprite')}<div class="tc2-mon-info"><strong>${esc(displaySpecies(selectedCoverageObj))}</strong><div class="type-row">${(typeMap[selectedCoverageObj.species]||[]).map(t=>typePill(t)).join('')}</div></div>${bestComboBlock}<div class="tc2-mon-metrics"><div class="tc2-metric"><b>${coverageRows.length}</b><span>Types&nbsp;covered</span></div><div class="tc2-metric"><b>${superEffectiveTargets.length}/${coverageOpp.length}</b><span>Threatened</span></div></div></div>`:'';
  const coverageSection=`<section id="prepTeamCoverage" class="panel prep-selectable-section tc2" data-prep-section="coverage">
    <div class="tc2-head"><div class="tc2-head-text"><div class="coverage-kicker">OFFENSIVE SCOUTING</div><h2>Type Coverage</h2><p class="panel-desc" style="margin:0">Pick one of your Pokémon to see what it threatens super-effectively, type by type.</p></div><div class="coverage-analysis-select"><label for="prepCoverageMon">Your Pokémon</label><select id="prepCoverageMon">${your.map(m=>`<option value="${esc(m.species)}" ${norm(m.species)===norm(coverageSelected)?'selected':''}>${esc(displaySpecies(m))}</option>`).join('')}</select></div></div>
    ${monStrip}
    <div class="tc2-map">
      <div class="tc2-panel"><div class="tc2-panel-head"><span>Type coverage</span><em>By attacking type</em></div>${topThreeBlock}<div class="tc2-type-grid">${TYPE_NAMES.map(typeGridChip).join('')}</div></div>
      <div class="tc2-panel"><div class="tc2-panel-head"><span>Opponent scouting</span><em>${superEffectiveTargets.length} of ${coverageOpp.length} exploitable</em></div><div class="tc2-opp-grid">${coverageOpp.length?coverageOpp.map(oppCard).join(''):'<div class="tc2-empty">No opposing roster loaded yet.</div>'}</div></div>
    </div>
    ${!coverageRows.length?'<div class="tc2-empty">No legal damaging moves outside Normal-type were found for this Pokémon.</div>':''}
  </section>`;

  const speedNature=(n)=>n==='positive'?1.1:n==='negative'?0.9:1;
  const speedStatFor=(base,evs,natureKey)=>Math.floor(Math.floor((2*base+31+Math.floor((evs||0)/4))*100/100+5)*speedNature(natureKey));
  const speedCfgFor=(species)=>({nature:'positive',evs:252,...(STATE.prepSpeedConfig?.[species]||{})});
  const speedMods=STATE.prepSpeedMods||{your:{tailwind:false,paralysis:false,scarf:false,webs:false,stage:0},opp:{tailwind:false,paralysis:false,scarf:false,webs:false,stage:0},trickRoom:false};
  const stageMult=n=>({'-6':2/8,'-5':2/7,'-4':2/6,'-3':2/5,'-2':2/4,'-1':2/3,'0':1,'1':3/2,'2':4/2,'3':5/2,'4':6/2,'5':7/2,'6':8/2}[n]??1);
  const effectiveSpeed=(base,species,side)=>{
    const cfg=speedCfgFor(species);
    let v=speedStatFor(base,cfg.evs,cfg.nature);
    const m=speedMods[side]||{};
    if(m.stage)v=Math.floor(v*stageMult(m.stage));
    if(m.scarf)v=Math.floor(v*1.5);
    if(m.tailwind)v=Math.floor(v*2);
    if(m.paralysis)v=Math.floor(v*0.5);
    if(m.webs)v=Math.floor(v*2/3);
    return v;
  };
  const pinned=STATE.prepSpeedPinned||[];
  const modBtn=(side,key,label)=>`<button type="button" class="speed-mod-btn ${speedMods[side]?.[key]?'active':''}" data-speed-side="${side}" data-speed-mod="${key}">${label}</button>`;
  const stageBtn=(side,val,label)=>`<button type="button" class="speed-mod-btn ${(speedMods[side]?.stage||0)===val?'active':''}" data-speed-side="${side}" data-speed-stage="${val}">${label}</button>`;

  // Speed Workbench: select multiple Pokémon from YOUR team; always show every
  // Pokémon on the opponent team as columns in the comparison matrix.
  // Speed Workbench reads best when everything is laid out fastest-to-slowest
  // by base Speed, so sort both the opponent columns and the Pokémon picker
  // by base Speed (highest first; unknown base Speed sinks to the bottom).
  const byBaseSpeedDesc=(a,b)=>(b.baseSpeed??-1)-(a.baseSpeed??-1)||a.species.localeCompare(b.species);
  const yourSpeedSorted=[...your].sort(byBaseSpeedDesc);
  const oppSpeedSorted=[...opp].sort(byBaseSpeedDesc);
  const validYourSpecies=yourSpeedSorted.map(m=>m.species);
  let selectedSpeedMons=Array.isArray(STATE.prepSpeedSelected)
    ?STATE.prepSpeedSelected.filter(x=>validYourSpecies.includes(x))
    :(STATE.prepSpeedSelected&&validYourSpecies.includes(STATE.prepSpeedSelected)?[STATE.prepSpeedSelected]:[]);
  selectedSpeedMons=validYourSpecies.filter(sp=>selectedSpeedMons.includes(sp));
  STATE.prepSpeedSelected=selectedSpeedMons;
  window.__speedWorkbenchData={your:yourSpeedSorted,opp:oppSpeedSorted};
  const selectedFirst=selectedSpeedMons[0]||yourSpeedSorted[0]?.species||'';
  let selMonObj=yourSpeedSorted.find(m=>m.species===selectedFirst);
  const selCfg=selMonObj?speedCfgFor(selMonObj.species):{nature:'positive',evs:252};

  const speedValueFor=(mon,side)=>effectiveSpeed(mon.baseSpeed||0,mon.species,side);
  const speedOutcome=(yourSpeed,oppSpeed)=>{
    if(yourSpeed===oppSpeed)return ['Tie','speed-tie'];
    const youFirst=speedMods.trickRoom?yourSpeed<oppSpeed:yourSpeed>oppSpeed;
    return [youFirst?'You':'Opp.',''+(youFirst?'speed-faster':'speed-slower')];
  };

  const speedMatrix=`
    <div class="speed-matrix-wrap">
      <table class="speed-matrix"><caption class="speed-axis-opponents"><span>OPPONENT POKÉMON</span></caption>
        <thead><tr>
          <th class="speed-axis-corner"><span class="speed-axis-you">YOUR POKÉMON</span></th>
          ${oppSpeedSorted.map(m=>`<th><div class="speed-matrix-mon">${sprite(m.species,'speed-matrix-sprite')}<span>${esc(displaySpecies(m))}</span></div></th>`).join('')}
        </tr></thead>
        <tbody>
          ${selectedSpeedMons.length ? selectedSpeedMons.map(species=>{
            const ym=yourSpeedSorted.find(m=>m.species===species); if(!ym)return '';
            const yv=speedValueFor(ym,'your');
            return `<tr data-speed-row="${esc(species)}"><th><div class="speed-matrix-mon speed-matrix-your">${sprite(ym.species,'speed-matrix-sprite')}<span>${esc(displaySpecies(ym))}</span><small>${yv} Spe</small></div></th>
              ${oppSpeedSorted.map(om=>{
                const ov=speedValueFor(om,'opp');
                const [label,cls]=speedOutcome(yv,ov);
                return `<td><div class="speed-cell ${cls}"><strong>${label}</strong><span>${yv} vs ${ov}</span></div></td>`;
              }).join('')}
            </tr>`;
          }).join('') : `<tr class="speed-no-selection-row"><td colspan="${Math.max(1,oppSpeedSorted.length+1)}"><strong>Select your Pokémon above</strong><span>All ${oppSpeedSorted.length} opponent Pokémon are already shown across the matrix.</span></td></tr>`}
        </tbody>
      </table>
    </div>`;

  let solverText='Select one of your Pokémon to see the EV threshold against the first opponent.';
  const solverOpp=oppSpeedSorted[0];
  if(selMonObj&&solverOpp){
    const selectedOppSpeed=effectiveSpeed(solverOpp.baseSpeed||0,solverOpp.species,'opp');
    let neededEvs=null;
    for(let e=0;e<=252;e+=4){
      let testV=speedStatFor(selMonObj.baseSpeed||0,e,selCfg.nature);
      const m=speedMods.your||{};
      if(m.stage)testV=Math.floor(testV*stageMult(m.stage));
      if(m.scarf)testV=Math.floor(testV*1.5);
      if(m.tailwind)testV=Math.floor(testV*2);
      if(m.paralysis)testV=Math.floor(testV*.5);
      const beats=speedMods.trickRoom?testV<selectedOppSpeed:testV>selectedOppSpeed;
      if(beats){neededEvs=e;break;}
    }
    solverText=neededEvs===null
      ?`Even at 252 EVs with a beneficial nature, ${esc(displaySpecies(selMonObj))} cannot ${speedMods.trickRoom?'go slower than':'outspeed'} ${esc(displaySpecies(solverOpp))} under the current modifiers.`
      :`${esc(displaySpecies(selMonObj))} needs <strong>${neededEvs} EVs</strong> (beneficial nature) to ${speedMods.trickRoom?'go slower than':'outspeed'} ${esc(displaySpecies(solverOpp))}.`;
  }

  const speedSection=`<section id="prepSpeedWorkbench" class="panel prep-selectable-section" data-prep-section="speed">
    <div class="speed-workbench-head">
      <div><h2>Speed Workbench</h2><p class="panel-desc">Select one or more of your Pokémon. Every Pokémon on the opponent team is always shown in the matrix.</p></div>
    </div>

    <div class="speed-multiselect-card speed-matrix-toolbar">
      <div class="speed-multiselect-head"><div><label>Your Pokémon</label><span>Choose the rows shown in the matrix.</span></div><strong id="speedSelectionCount">${selectedSpeedMons.length}/${your.length}</strong></div>
      <button type="button" id="speedSelectPokemon" class="speed-select-launcher">Select Pokémon <span>${selectedSpeedMons.length ? `${selectedSpeedMons.length} selected` : 'Choose Pokémon to compare'}</span></button>
    </div>

    ${speedMatrix}

    <div class="speed-condition-bar">
      <div class="speed-condition-group"><span class="speed-condition-title">Your side</span><div class="speed-mod-row">${modBtn('your','tailwind','Tailwind')}${modBtn('your','paralysis','Paralysis')}${modBtn('your','webs','Webs')}${modBtn('your','scarf','Choice Scarf')}${stageBtn('your',-2,'-2')}${stageBtn('your',-1,'-1')}${stageBtn('your',1,'+1')}${stageBtn('your',2,'+2')}</div></div>
      <div class="speed-condition-group"><span class="speed-condition-title">Opponent side</span><div class="speed-mod-row">${modBtn('opp','tailwind','Tailwind')}${modBtn('opp','paralysis','Paralysis')}${modBtn('opp','webs','Webs')}${modBtn('opp','scarf','Choice Scarf')}${stageBtn('opp',-2,'-2')}${stageBtn('opp',-1,'-1')}${stageBtn('opp',1,'+1')}${stageBtn('opp',2,'+2')}</div></div>
      <div class="speed-condition-group speed-field-group"><span class="speed-condition-title">Field</span><div class="speed-mod-row"><button type="button" class="speed-mod-btn ${speedMods.trickRoom?'active':''}" data-speed-trickroom="1">Trick Room</button></div></div>
    </div>
  </section>`;

  // Update only the Speed Workbench DOM. Selection/modifier clicks must not
  // rebuild Match Prep or reset the user's scroll position.
  window.__sblRefreshSpeedWorkbench=()=>{
    const root=document.getElementById('prepSpeedWorkbench');
    const data=window.__speedWorkbenchData||{your:[],opp:[]};
    if(!root) return;
    const yourMons=Array.isArray(data.your)?data.your:[];
    const oppMons=Array.isArray(data.opp)?data.opp:[];
    const selected=Array.isArray(STATE.prepSpeedSelected)?STATE.prepSpeedSelected.filter(sp=>yourMons.some(m=>m.species===sp)):[];
    STATE.prepSpeedSelected=selected;
    const calcSpeed=(mon,side)=>{
      const cfg={nature:'positive',evs:252,...(STATE.prepSpeedConfig?.[mon.species]||{})};
      let v=speedStatFor(mon.baseSpeed||0,cfg.evs,cfg.nature);
      const m=STATE.prepSpeedMods?.[side]||{};
      if(m.stage)v=Math.floor(v*stageMult(m.stage));
      if(m.scarf)v=Math.floor(v*1.5);
      if(m.tailwind)v=Math.floor(v*2);
      if(m.paralysis)v=Math.floor(v*.5);
      if(m.webs)v=Math.floor(v*2/3);
      return v;
    };
    const outcome=(yv,ov)=>{
      if(yv===ov)return ['Tie','speed-tie'];
      const youFirst=STATE.prepSpeedMods?.trickRoom?yv<ov:yv>ov;
      return [youFirst?'You':'Opp.',''+(youFirst?'speed-faster':'speed-slower')];
    };
    const matrix=`<div class="speed-matrix-wrap"><table class="speed-matrix"><caption class="speed-axis-opponents"><span>OPPONENT POKÉMON</span></caption><thead><tr><th class="speed-axis-corner"><span class="speed-axis-you">YOUR POKÉMON</span></th>${oppMons.map(m=>`<th><div class="speed-matrix-mon">${sprite(m.species,'speed-matrix-sprite')}<span>${esc(displaySpecies(m))}</span></div></th>`).join('')}</tr></thead><tbody>${selected.length?selected.map(species=>{const ym=yourMons.find(m=>m.species===species);if(!ym)return '';const yv=calcSpeed(ym,'your');return `<tr data-speed-row="${esc(species)}"><th><div class="speed-matrix-mon speed-matrix-your">${sprite(ym.species,'speed-matrix-sprite')}<span>${esc(displaySpecies(ym))}</span><small>${yv} Spe</small></div></th>${oppMons.map(om=>{const ov=calcSpeed(om,'opp');const [label,cls]=outcome(yv,ov);return `<td><div class="speed-cell ${cls}"><strong>${label}</strong><span>${yv} vs ${ov}</span></div></td>`;}).join('')}</tr>`;}).join(''):`<tr class="speed-no-selection-row"><td colspan="${Math.max(1,oppMons.length+1)}"><strong>Select your Pokémon above</strong><span>All ${oppMons.length} opponent Pokémon are already shown across the matrix.</span></td></tr>`}</tbody></table></div>`;
    const old=root.querySelector('.speed-matrix-wrap');
    if(old) old.outerHTML=matrix;
    const count=root.querySelector('#speedSelectionCount');
    if(count) count.textContent=`${selected.length}/${yourMons.length}`;
    const launcher=root.querySelector('#speedSelectPokemon span');
    if(launcher) launcher.textContent=selected.length?`${selected.length} selected`:'Choose Pokémon to compare';
    root.querySelectorAll('.speed-mod-btn[data-speed-mod]').forEach(b=>{b.classList.toggle('active',!!STATE.prepSpeedMods?.[b.dataset.speedSide]?.[b.dataset.speedMod]);});
    root.querySelectorAll('.speed-mod-btn[data-speed-stage]').forEach(b=>{b.classList.toggle('active',(STATE.prepSpeedMods?.[b.dataset.speedSide]?.stage||0)===Number(b.dataset.speedStage));});
    root.querySelector('[data-speed-trickroom]')?.classList.toggle('active',!!STATE.prepSpeedMods?.trickRoom);
  };

  // -------- Switch-in Analyser --------
  // Keep the two item selectors intentionally role-specific.
  const switchOpponentItemOptions=[
    ['', 'No item'],
    ['Choice Band','Choice Band'],['Choice Specs','Choice Specs'],['Choice Scarf','Choice Scarf'],
    ['Life Orb','Life Orb'],['Expert Belt','Expert Belt'],['Metronome','Metronome'],
    ['Muscle Band','Muscle Band'],['Wise Glasses','Wise Glasses'],
    ['Black Belt','Black Belt'],['Black Glasses','Black Glasses'],['Charcoal','Charcoal'],
    ['Dragon Fang','Dragon Fang'],['Fairy Feather','Fairy Feather'],['Hard Stone','Hard Stone'],
    ['Magnet','Magnet'],['Metal Coat','Metal Coat'],['Miracle Seed','Miracle Seed'],
    ['Mystic Water','Mystic Water'],['Never-Melt Ice','Never-Melt Ice'],['Poison Barb','Poison Barb'],
    ['Sharp Beak','Sharp Beak'],['Silk Scarf','Silk Scarf'],['Silver Powder','Silver Powder'],
    ['Soft Sand','Soft Sand'],['Spell Tag','Spell Tag'],['Twisted Spoon','Twisted Spoon'],
    ['Draco Plate','Draco Plate'],['Dread Plate','Dread Plate'],['Earth Plate','Earth Plate'],
    ['Fist Plate','Fist Plate'],['Flame Plate','Flame Plate'],['Icicle Plate','Icicle Plate'],
    ['Insect Plate','Insect Plate'],['Iron Plate','Iron Plate'],['Meadow Plate','Meadow Plate'],
    ['Mind Plate','Mind Plate'],['Pixie Plate','Pixie Plate'],
    ['Sky Plate','Sky Plate'],['Spooky Plate','Spooky Plate'],['Stone Plate','Stone Plate'],
    ['Toxic Plate','Toxic Plate'],['Zap Plate','Zap Plate'],['Splash Plate','Splash Plate'],
    ['Lustrous Orb','Lustrous Orb'],['Adamant Orb','Adamant Orb'],['Griseous Orb','Griseous Orb'],
    ['Adamant Crystal','Adamant Crystal'],['Lustrous Globe','Lustrous Globe'],['Griseous Core','Griseous Core'],
    ['Soul Dew','Soul Dew']
  ];
  const switchDefensiveItemOptions=[
    ['', 'No item'],
    ['Assault Vest','Assault Vest'],['Eviolite','Eviolite'],['Focus Sash','Focus Sash'],
    ['Leftovers','Leftovers'],['Heavy-Duty Boots','Heavy-Duty Boots'],['Rocky Helmet','Rocky Helmet'],
    ['Black Sludge','Black Sludge'],['Sitrus Berry','Sitrus Berry'],['Wiki Berry','Wiki Berry'],
    ['Aguav Berry','Aguav Berry'],['Iapapa Berry','Iapapa Berry'],['Figy Berry','Figy Berry'],
    ['Mago Berry','Mago Berry'],['Air Balloon','Air Balloon'],['Safety Goggles','Safety Goggles'],
    ['Occa Berry','Occa Berry (Fire resistance)'],['Passho Berry','Passho Berry (Water resistance)'],
    ['Wacan Berry','Wacan Berry (Electric resistance)'],['Rindo Berry','Rindo Berry (Grass resistance)'],
    ['Yache Berry','Yache Berry (Ice resistance)'],['Chople Berry','Chople Berry (Fighting resistance)'],
    ['Kebia Berry','Kebia Berry (Poison resistance)'],['Shuca Berry','Shuca Berry (Ground resistance)'],
    ['Coba Berry','Coba Berry (Flying resistance)'],['Payapa Berry','Payapa Berry (Psychic resistance)'],
    ['Tanga Berry','Tanga Berry (Bug resistance)'],['Charti Berry','Charti Berry (Rock resistance)'],
    ['Kasib Berry','Kasib Berry (Ghost resistance)'],['Haban Berry','Haban Berry (Dragon resistance)'],
    ['Colbur Berry','Colbur Berry (Dark resistance)'],['Babiri Berry','Babiri Berry (Steel resistance)'],
    ['Chilan Berry','Chilan Berry (Normal resistance)'],['Roseli Berry','Roseli Berry (Fairy resistance)']
  ];
  const switchItemSelect=(id,value,kind='defensive')=>{
    const options=kind==='offensive'?switchOpponentItemOptions:switchDefensiveItemOptions;
    const selected=options.some(([v])=>v===value)?value:'';
    return `<select id="${id}">${options.map(([v,label])=>`<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(label)}</option>`).join('')}</select>`;
  };
  const switchAttackerSide=STATE.prepSwitchAttackerSide==='your'?'your':'opponent';
  const switchAttackerMons=switchAttackerSide==='your'?your:opp;
  const switchDefenderMons=switchAttackerSide==='your'?opp:your;
  const switchAttackerTeamName=switchAttackerSide==='your'?yourTeam:opponent;
  const switchDefenderTeamName=switchAttackerSide==='your'?opponent:yourTeam;
  const defaultOppMon=STATE.prepSwitchMon&&switchAttackerMons.some(m=>m.species===STATE.prepSwitchMon)?STATE.prepSwitchMon:(switchAttackerMons[0]?.species||'');
  const switchMon=switchAttackerMons.find(m=>m.species===defaultOppMon)||switchAttackerMons[0];
  const observedMoveOptions=switchMon?observedFor(switchMon):[];
  // The analyser must work even when a move has never appeared in a replay.
  // The selector is populated from the legal damaging learnset immediately
  // after render, with observed moves used only as a preferred starting point.
  const defaultMove=STATE.prepSwitchMove||observedMoveOptions[0]||'';
  const switchRows=`<div id="switchResults"><div class="empty">Select a damaging move to calculate switch-ins.</div></div>`;
  const switchAtkItem=STATE.prepSwitchAtkItem||'';
  const switchDefItem=STATE.prepSwitchDefItem||'';
  const switchWeather=STATE.prepSwitchWeather||'';
  const switchTerrain=STATE.prepSwitchTerrain||'';
  const switchWeatherOptions=[['','Clear'],['Rain','Rain'],['Sun','Sun'],['Sand','Sand'],['Snow','Snow'],['Hail','Hail'],['Strong Winds','Strong Winds'],['Heavy Rain','Heavy Rain'],['Harsh Sunshine','Harsh Sunshine']];
  const switchTerrainOptions=[['','None'],['Electric','Electric'],['Grassy','Grassy'],['Misty','Misty'],['Psychic','Psychic']];
  const switchFieldSelect=(id,value,options)=>`<select id="${id}">${options.map(([v,label])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(label)}</option>`).join('')}</select>`;
  const switchSection=`<section id="prepSwitchAnalyser" class="panel prep-selectable-section" data-prep-section="switch"><div class="switch-analyser-head"><div><h2>Switch-In Analyser</h2><p class="panel-desc">Choose the attacking side, damaging move, and switch-in defender.</p></div><button type="button" id="prepSwitchRoleToggle" class="switch-role-toggle" aria-pressed="false">↔ Swap attacker / defender</button></div><p class="panel-desc">Choose an attacking Pokémon and one of its damaging learnset moves. Set the attacker EVs and each switch-in Pokémon's defensive EVs individually. Weather and terrain only affect moves they actually influence.</p><div class="prep-switch-controls"><div><label>Attacker Pokémon <span class="switch-side-label">(${switchAttackerSide==='your'?'Your Team':'Opponent Team'})</span></label><select id="prepSwitchMon">${switchAttackerMons.map(m=>`<option value="${esc(m.species)}" ${m.species===switchMon?.species?'selected':''}>${esc(displaySpecies(m))}</option>`).join('')}</select></div><div><label>Damaging Move</label><select id="prepSwitchMove"><option value="">${observedMoveOptions.length?'Select a damaging move':'Loading moves…'}</option>${observedMoveOptions.map(m=>`<option value="${esc(m)}" ${norm(m)===norm(defaultMove)?'selected':''}>${esc(m)}</option>`).join('')}</select></div><div id="prepSwitchHitsField" style="display:none"><label>Number of Hits</label><select id="prepSwitchHits"><option value="">Auto</option></select></div></div><div class="prep-item-controls"><div><label>Attacker Item</label>${switchItemSelect('prepSwitchAtkItem',switchAtkItem,'offensive')}</div><div><label>Switch-In Item</label>${switchItemSelect('prepSwitchDefItem',switchDefItem,'defensive')}</div><div><label>Attacker EVs</label><button type="button" id="prepSwitchAtkEVs" class="damage-calc-primary">Set EVs</button></div><div><label>Defensive EVs</label><button type="button" id="prepSwitchAllDefEVs" class="prep-all-evs-btn">Set All EVs</button></div></div><div class="prep-item-controls"><div><label>Weather</label>${switchFieldSelect('prepSwitchWeather',switchWeather,switchWeatherOptions)}</div><div><label>Terrain</label>${switchFieldSelect('prepSwitchTerrain',switchTerrain,switchTerrainOptions)}</div></div>${switchRows}</section>`;

  const latestMatchesSection=matchHistoryForTeam(opponent,false).replace('<section class="panel">','<section id="prepLatestMatches" class="panel prep-selectable-section" data-prep-section="matches">');
  return `<section class="panel prep-hero-panel"><div class="prep-hero"><div><h2>Match Prep</h2><p class="panel-desc" style="margin:0">Prepare <strong>${esc(yourTeam)}</strong> for a match against <strong>${esc(opponent)}</strong>. Match usage, scouting, recent replays and battle tools are combined here.</p></div><div class="prep-hero-controls"><div><label>Your Team</label><select id="prepYourTeam">${names.map(n=>`<option value="${esc(n)}" ${sameTeam(n,yourTeam)?'selected':''}>${esc(n)}</option>`).join('')}</select></div><div><label>Opponent</label><select id="prepOpponent">${names.filter(n=>!sameTeam(n,yourTeam)).map(n=>`<option value="${esc(n)}" ${sameTeam(n,opponent)?'selected':''}>${esc(n)}</option>`).join('')}</select></div></div><div class="prep-side-swap"><span class="prep-side-swap-label">Team sides</span><button type="button" id="prepSwapTeams" aria-label="Swap your team and opponent">↔ Swap Team</button></div></div></section>
  <section class="panel prep-section-picker">
    <div class="prep-section-tabs" id="prepSectionTabs" role="tablist" aria-label="Match Prep sections">
      <button type="button" class="prep-section-tab" data-section="overview" role="tab">Team Overview</button>
      <button type="button" class="prep-section-tab" data-section="typechart" role="tab">Type Chart</button>
      <button type="button" class="prep-section-tab" data-section="coverage" role="tab">Team Coverage</button>
      <button type="button" class="prep-section-tab" data-section="switch" role="tab">Switch-In Analyser</button>
      <button type="button" class="prep-section-tab" data-section="speed" role="tab">Speed Workbench</button>
      <button type="button" class="prep-section-tab" data-section="matches" role="tab">Replays</button>
    </div>
  </section>
  <section id="prepTeamOverview" class="panel prep-selectable-section" data-prep-section="overview">
    <div class="team-overview-head">
      <div><h2 id="prepTeamOverviewTitle">Team Overview</h2><p class="panel-desc" style="margin:0">Your team and the opponent are shown together. Click any Pokémon to view Usage Stats and Scouting. Both sides expose the same matchup information.</p></div>
    </div>
    <div class="team-overview-side-by-side">
      <div class="team-overview-side">
        <div class="team-overview-side-head"><h3>Your Team</h3><span>${esc(yourTeam)}</span></div>
        <div class="prep-opponent-grid" data-overview-grid="your">${yourCards}</div>
      </div>
      <div class="team-overview-side">
        <div class="team-overview-side-head"><h3>Opponent Team</h3><span>${esc(opponent)}</span></div>
        <div class="prep-opponent-grid" data-overview-grid="opponent">${opponentCards}</div>
      </div>
    </div>
  </section>
  ${latestMatchesSection}
  ${typeChartSection}
  ${coverageSection}
  ${speedSection}
  ${switchSection}`;
}

async function render(){
  const sel=$('teamSelect');const team=sel.value;
  if(!team){$('main').innerHTML='<div class="panel"><div class="empty">No franchise data available.</div></div>';return}
  {
    if(!STATE.prepYourTeam || !teamNames().some(n=>sameTeam(n,STATE.prepYourTeam))) STATE.prepYourTeam=STATE.profileTeam||team;
    const yourTeam=STATE.prepYourTeam;
    const scheduledOpponent=nextScheduledOpponent(yourTeam);
    let opponent=(STATE.prepOpponent && !sameTeam(STATE.prepOpponent,yourTeam)) ? STATE.prepOpponent : scheduledOpponent || teamNames().find(n=>!sameTeam(n,yourTeam))||'';
    if(!opponent || sameTeam(opponent,yourTeam)) opponent=scheduledOpponent || teamNames().find(n=>!sameTeam(n,yourTeam))||'';
    STATE.prepOpponent=opponent;
    // Switch-In Analyser role swapping: mirror the same attacker/defender side
    // logic used inside renderMatchPrep so the event handlers below (which run
    // in this separate function scope) can resolve the correct teams instead
    // of referencing undefined variables.
    const switchAttackerSide=STATE.prepSwitchAttackerSide==='your'?'your':'opponent';
    const switchAttackerTeamName=switchAttackerSide==='your'?yourTeam:opponent;
    const switchDefenderTeamName=switchAttackerSide==='your'?opponent:yourTeam;
    // Build the next view off-DOM. Never paint an intermediate loading state
    // when a team/section control changes; replacing the current view atomically
    // prevents the visible page-flash that used to look like a reload.
    try{
      const nextMarkup=await renderMatchPrep(yourTeam,opponent);
      const main=$('main');
      if(main) main.innerHTML=nextMarkup;
    }catch(e){
      console.error('Match Prep render failed:',e);
      $('main').innerHTML=`<section class="panel"><div class="empty">Match Prep could not load: ${esc(e.message||e)}</div></section>`;
      return;
    }

    // Section picker: sections are shown one at a time.
    const prepSectionTabs=Array.from(document.querySelectorAll('.prep-section-tab'));
    const prepSelectableSections=Array.from(document.querySelectorAll('.prep-selectable-section[data-prep-section]'));
    const showPrepSection=(value)=>{
      const next=value||'overview';
      STATE.prepSection=next;
      prepSelectableSections.forEach(section=>{ section.hidden=section.dataset.prepSection!==next; });
      prepSectionTabs.forEach(tab=>{
        const active=tab.dataset.section===next;
        tab.classList.toggle('active',active);
        tab.setAttribute('aria-selected',active?'true':'false');
      });
    };
    prepSectionTabs.forEach(tab=>tab.addEventListener('click',()=>showPrepSection(tab.dataset.section)));
    showPrepSection(STATE.prepSection||'overview');

    // Type Chart: toggle between Defensive and Offensive matrices.
    {
      const toggleBtns=document.querySelectorAll('#prepTypeChart .team-overview-toggle-btn[data-typechart-mode]');
      const grids={
        defensive: document.querySelector('[data-typechart-grid="defensive"]'),
        offensive: document.querySelector('[data-typechart-grid="offensive"]')
      };
      const title=document.getElementById('prepTypeChartTitle');
      const setTypeChartMode=(mode)=>{
        STATE.prepTypeChartMode=mode;
        toggleBtns.forEach(btn=>{
          const active=btn.dataset.typechartMode===mode;
          btn.classList.toggle('active',active);
          btn.setAttribute('aria-pressed',active?'true':'false');
        });
        if(grids.defensive)grids.defensive.hidden=mode!=='defensive';
        if(grids.offensive)grids.offensive.hidden=mode!=='offensive';
        if(title)title.textContent=mode==='offensive'?'Offensive Type Chart':'Defensive Type Chart';
      };
      toggleBtns.forEach(btn=>btn.addEventListener('click',()=>setTypeChartMode(btn.dataset.typechartMode)));
      setTypeChartMode(STATE.prepTypeChartMode==='offensive'?'offensive':'defensive');
    }

    // Match Prep opponent cards open their detailed scouting information in a modal popout.
    document.querySelectorAll('.prep-popout-trigger').forEach(btn=>btn.addEventListener('click',e=>{
      e.preventDefault(); e.stopPropagation();
      const card=btn.closest('.prep-opponent-popout');
      if(!card)return;
      const existing=document.getElementById('prepOpponentDetailModal');
      if(existing)existing.remove();
      const species=card.dataset.prepPopout||'';
      const title=displaySpecies({species})||card.querySelector('.prep-card-title strong')?.textContent||species||'Opponent Pokémon';
      const spriteHtml=card.querySelector('.prep-popout-trigger img')?.outerHTML||'';
      const cardTypes=card.querySelector('.prep-inline-types')?.innerHTML||'';
      const data=card.querySelector('.prep-popout-data');
      const usage=data?.dataset.usage||'<div class="small">No usage data.</div>';
      const scouting=data?.dataset.scouting||'<div class="small">No scouting data.</div>';
      // Page 1: recreate the old Team Overview Pokémon popup layout exactly.
      // Page 2: Match Prep analysis only — matchup, observed moves and likely roles.
      const teamOverview=`
        <div class="scout-popup-section">
          <h3>Performance</h3>
          <div class="scout-performance-grid">
            <div class="scout-performance-stat"><span>Appearances</span><strong>${esc(data?.dataset?.appearances||'—')}</strong></div>
            <div class="scout-performance-stat"><span>KOs</span><strong>${esc(data?.dataset?.kills||'—')}</strong></div>
            <div class="scout-performance-stat"><span>Deaths</span><strong>${esc(data?.dataset?.deaths||'—')}</strong></div>
            <div class="scout-performance-stat"><span>Damage dealt</span><strong>${esc(data?.dataset?.dealt||'—')}</strong></div>
            <div class="scout-performance-stat"><span>Damage taken</span><strong>${esc(data?.dataset?.taken||'—')}</strong></div>
          </div>
        </div>
        <div class="scout-popup-section">
          <h3>Abilities</h3><div id="prepScoutAbilities" class="scout-abilities"><div class="muted">Loading…</div></div>
        </div>
        <div class="scout-popup-columns">
          <div class="scout-popup-section">
            <h3>Base stat spread</h3>
            <div id="prepScoutBaseStats" class="scout-base-grid"><div class="muted">Loading…</div></div>
            <div id="prepScoutBaseTotal"></div>
            <div id="prepScoutNatureStats"></div>
          </div>
          <div class="scout-popup-section">
            <h3>Type effectiveness</h3>
            <div id="prepScoutTypeEffectiveness"><div class="muted">Loading…</div></div>
          </div>
        </div>`;
      const rawAnalysis=card.querySelector('.prep-popout-data')?.dataset.analysis || '<div class="small">No analysis data.</div>'; const analysisOverview=`<div class="prep-analysis-grid">${rawAnalysis}</div>`;
      const modal=document.createElement('div');
      modal.id='prepOpponentDetailModal';
      modal.className='prep-detail-modal';
      modal.innerHTML=`<div class="prep-detail-backdrop"></div><div class="prep-detail-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><button type="button" class="prep-detail-close" aria-label="Close">×</button><div class="prep-detail-summary-row"><div class="prep-card-head"><div>${spriteHtml}</div><div class="prep-detail-title"><h2>${esc(title)}</h2><div class="prep-detail-types">${cardTypes||'<span class="small">Typing loading…</span>'}</div></div></div><div class="prep-popup-nav"><div class="prep-mode-tabs"><button type="button" class="prep-mode-tab active" data-mode="team">Pokémon Data</button><button type="button" class="prep-mode-tab" data-mode="opponent">Analysis</button></div></div></div><div id="prepModeContent">${teamOverview}</div></div>`;
      document.body.appendChild(modal);
      requestAnimationFrame(()=>modal.classList.add('open'));
      const close=()=>{if(modal.dataset.closing==='1')return;modal.dataset.closing='1';modal.classList.remove('open');setTimeout(()=>modal.remove(),180);document.removeEventListener('keydown',onKey);};
      const onKey=e=>{if(e.key==='Escape')close();};
      modal.querySelector('.prep-detail-close').addEventListener('click',close);
      modal.querySelector('.prep-detail-backdrop').addEventListener('click',close);
      modal.querySelectorAll('.prep-mode-tab').forEach(tab=>tab.addEventListener('click',()=>{
        modal.querySelectorAll('.prep-mode-tab').forEach(t=>t.classList.toggle('active',t===tab));
        modal.querySelector('#prepModeContent').innerHTML=tab.dataset.mode==='opponent'?analysisOverview:teamOverview;
        if(tab.dataset.mode==='team') loadPrepPokemonData();
      }));
      modal.querySelector('#prepModeContent')?.addEventListener('click',e=>{
        const week=e.target.closest('.prep-week-pill'); if(!week)return;
        const movesBox=e.currentTarget.querySelector('.prep-week-moves'); if(!movesBox)return;
        e.currentTarget.querySelectorAll('.prep-week-pill').forEach(w=>w.classList.toggle('active',w===week));
        let moves=[]; try{moves=JSON.parse(week.dataset.movesJson||'[]')}catch{}
        movesBox.innerHTML=`<div class="prep-week-moves-title">Moves used in ${esc(week.textContent.replace('›','').trim())}</div><div class="prep-week-moves-list">${moves.length?moves.map(m=>`<span class="prep-chip">${esc(m)}</span>`).join(''):'<span class="small">No recorded moves for this week.</span>'}</div>`;
        movesBox.hidden=false;
      });
      modal.querySelector('#prepModeContent')?.addEventListener('click',e=>{
        const btn=e.target.closest('[data-prep-week-btn]'); if(!btn)return;
        const root=e.currentTarget;
        const week=btn.dataset.prepWeekBtn;
        root.querySelectorAll('[data-prep-week-btn]').forEach(b=>{
          const active=b===btn;
          b.classList.toggle('active',active);
          b.setAttribute('aria-pressed',active?'true':'false');
        });
        root.querySelectorAll('[data-week-pane]').forEach(p=>{p.hidden=p.dataset.weekPane!==week;});
      });

      async function loadPrepPokemonData(){
        const root=modal.querySelector('#prepModeContent');
        if(!root || !root.querySelector('#prepScoutBaseStats')) return;
        try{
          const pd=await fetchPokemonData(species);
          if(!pd){
            root.querySelector('#prepScoutBaseStats').innerHTML='<div class="muted">Base stats unavailable.</div>';
            root.querySelector('#prepScoutTypeEffectiveness').innerHTML='<div class="muted">Type data unavailable.</div>';
            root.querySelector('#prepScoutAbilities').innerHTML='<div class="muted">Abilities unavailable.</div>';
            return;
          }
          const statMap=pd.stats||{};
          const statNames=[['hp','HP'],['attack','Atk'],['defense','Def'],['special-attack','SpA'],['special-defense','SpD'],['speed','Spe']];
          root.querySelector('#prepScoutBaseStats').innerHTML=statNames.map(([k,label])=>{const value=Number(statMap[k])||0;return `<div class="scout-base-stat"><div class="scout-base-stat-head"><span>${label}</span><strong>${value||'—'}</strong></div><div class="scout-stat-bar"><i style="width:${Math.min(100,value/180*100)}%"></i></div></div>`;}).join('');
          root.querySelector('#prepScoutBaseTotal').innerHTML=`<div class="scout-stat-total"><span>Total base stats</span><strong>${statNames.reduce((sum,[k])=>sum+(Number(statMap[k])||0),0)}</strong></div>`;
          const statValue=(base,hp,boost)=>{base=Number(base)||0;if(hp)return 2*base+31+63+110;const neutral=Math.floor((2*base+31+63))+5;return boost?Math.floor(neutral*1.1):neutral;};
          const natureRows=boost=>statNames.map(([k,label])=>{const v=statValue(statMap[k],k==='hp',boost);return `<div class="scout-nature-row"><span>${label}</span><div class="bar"><i style="width:${Math.min(100,v/500*100)}%"></i></div><strong>${v}</strong></div>`;}).join('');
          root.querySelector('#prepScoutNatureStats').innerHTML=`<div class="scout-nature-stats"><div class="scout-nature-card"><h4>Neutral nature · Lv. 100 · 31 IV / 252 EV</h4>${natureRows(false)}</div><div class="scout-nature-card"><h4>Boosting nature · Lv. 100 · 31 IV / 252 EV</h4>${natureRows(true)}</div></div>`;
          const abilities=pd.abilities||[];
          const prettyAbility=a=>String(a).replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
          root.querySelector('#prepScoutAbilities').innerHTML=abilities.length?abilities.map(a=>`<span class="scout-ability">${esc(prettyAbility(a))}</span>`).join(''):'<div class="muted">No abilities listed.</div>';
          const types=normalizedTypes(pd.types||[]);
          const allTypes=['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
          const eff=allTypes.map(type=>({type,mult:types.reduce((v,def)=>v*typeChartMultiplier(type,def),1)})).filter(x=>x.mult!==1);
          const group=(name,cls,items)=>`<div class="scout-type-group ${cls}"><h4>${name}</h4>${items.length?`<div class="scout-type-list">${items.map(x=>`<span class="scout-type-pill">${x.type} <b>${fmtMult(x.mult)}</b></span>`).join('')}</div>`:'<div class="muted">None</div>'}</div>`;
          root.querySelector('#prepScoutTypeEffectiveness').innerHTML=`<div class="scout-type-groups">${group('Weaknesses','weak',eff.filter(x=>x.mult>1))}${group('Resistances','resist',eff.filter(x=>x.mult>0&&x.mult<1))}${group('Immunities','immune',eff.filter(x=>x.mult===0))}</div>`;
        }catch(err){
          root.querySelector('#prepScoutBaseStats').innerHTML='<div class="muted">Base stats unavailable.</div>';
          root.querySelector('#prepScoutTypeEffectiveness').innerHTML='<div class="muted">Type data unavailable.</div>';
          root.querySelector('#prepScoutAbilities').innerHTML='<div class="muted">Abilities unavailable.</div>';
        }
      }
      document.addEventListener('keydown',onKey);
      loadPrepPokemonData();
    }));

$('prepYourTeam')?.addEventListener('change',async e=>{
      STATE.prepSection=STATE.prepSection||'overview';
      STATE.prepYourTeam=e.target.value;
      STATE.prepOpponent=nextScheduledOpponent(STATE.prepYourTeam)||teamNames().find(n=>!sameTeam(n,STATE.prepYourTeam))||'';
      STATE.prepSwitchMon='';STATE.prepSwitchMove='';STATE.prepSwitchHits='';STATE.prepSwitchAtkItem='';STATE.prepSwitchDefItem='';STATE.prepSwitchEVsByMon={};STATE.prepCoverageMon='';
      await render();
    });
    $('prepSwapTeams')?.addEventListener('click',async()=>{
      const previousYour=STATE.prepYourTeam;
      const previousOpponent=STATE.prepOpponent;
      if(!previousYour || !previousOpponent || sameTeam(previousYour,previousOpponent)) return;
      STATE.prepYourTeam=previousOpponent;
      STATE.prepOpponent=previousYour;
      STATE.prepSection=STATE.prepSection||'overview';
      STATE.prepSwitchMon='';STATE.prepSwitchMove='';STATE.prepSwitchHits='';STATE.prepSwitchAtkItem='';STATE.prepSwitchDefItem='';STATE.prepSwitchEVsByMon={};STATE.prepCoverageMon='';
      if($('teamSelect')) $('teamSelect').value=STATE.prepOpponent;
      const u=new URL(location.href);u.searchParams.set('team',STATE.prepOpponent);history.replaceState(null,'',u);
      await render();
    });
    $('prepOpponent')?.addEventListener('change',async e=>{
      STATE.prepSection=STATE.prepSection||'overview';
      STATE.prepOpponent=e.target.value;STATE.prepSwitchMon='';STATE.prepSwitchMove='';STATE.prepSwitchHits='';STATE.prepSwitchAtkItem='';STATE.prepSwitchDefItem='';STATE.prepSwitchEVsByMon={};STATE.prepCoverageMon='';
      if($('teamSelect')) $('teamSelect').value=e.target.value;
      const u=new URL(location.href);u.searchParams.set('team',e.target.value);history.replaceState(null,'',u);
      await render();
    });
    const refreshCoverageOnly=async()=>{
      const current=document.getElementById('prepTeamCoverage');
      if(!current)return;
      current.setAttribute('aria-busy','true');
      try{
        const html=await renderMatchPrep(STATE.prepYourTeam,STATE.prepOpponent);
        const holder=document.createElement('div');
        holder.innerHTML=html;
        const next=holder.querySelector('#prepTeamCoverage');
        if(!next)throw new Error('Coverage section could not be rebuilt.');
        current.replaceWith(next);
        const select=next.querySelector('#prepCoverageMon');
        select?.addEventListener('change',async ev=>{
          STATE.prepCoverageMon=ev.target.value;
          await refreshCoverageOnly();
        });
      }catch(err){
        console.error('Coverage refresh failed:',err);
      }finally{
        document.getElementById('prepTeamCoverage')?.removeAttribute('aria-busy');
      }
    };
    $('prepCoverageMon')?.addEventListener('change',async e=>{
      e.preventDefault();
      STATE.prepCoverageMon=e.target.value;
      STATE.prepSection='coverage';
      await refreshCoverageOnly();
    });
    $('prepSwitchMon')?.addEventListener('change',async e=>{
      const species=e.target.value;
      STATE.prepSwitchMon=species;
      STATE.prepSwitchMove='';
      STATE.prepSwitchHits='';
      // Changing the attacker resets only the attacker's EVs. Defender EVs persist.
      // Keep the analyser mounted; refresh only its move selector and result cards.
      STATE.prepSwitchAtkEVs={hp:0,atk:0,def:0,spa:0,spd:0,spe:0};
      await populateSwitchMoveSelect();
      if($('prepSwitchMove')?.value) await renderSwitchResults();
      else { const mount=$('switchResults'); if(mount) mount.innerHTML='<div class="empty">Select a damaging move to calculate switch-ins.</div>'; }
    });
    $('prepSwitchMove')?.addEventListener('change',async e=>{
      STATE.prepSwitchMove=e.target.value;STATE.prepSwitchHits='';await renderSwitchResults();
    });
    $('prepSwitchHits')?.addEventListener('change',async e=>{
      STATE.prepSwitchHits=e.target.value;await renderSwitchResults();
    });
    $('prepSwitchAtkItem')?.addEventListener('change',async e=>{
      STATE.prepSwitchAtkItem=e.target.value;await renderSwitchResults();
    });
    $('prepSwitchDefItem')?.addEventListener('change',async e=>{
      STATE.prepSwitchDefItem=e.target.value;await renderSwitchResults();
    });
    $('prepSwitchWeather')?.addEventListener('change',async e=>{
      STATE.prepSwitchWeather=e.target.value;await renderSwitchResults();
    });
    $('prepSwitchTerrain')?.addEventListener('change',async e=>{
      STATE.prepSwitchTerrain=e.target.value;await renderSwitchResults();
    });
    $('prepSwitchAtkEVs')?.addEventListener('click',e=>{e.preventDefault();openSwitchAtkEvModal();});
    $('prepSwitchAllDefEVs')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openSwitchAllDefEvModal();});
    document.addEventListener('click',e=>{
      const chip=e.target.closest?.('.tc2-type-chip[data-cov-type]');
      if(!chip)return;
      e.preventDefault();
      let moves=[];
      try{moves=JSON.parse(chip.dataset.covMoves||'[]');}catch(err){moves=[];}
      openCoverageMovesModal(chip.dataset.covType,chip.dataset.covMon,moves);
    },{capture:true});
    // Switch-In Analyser role swapping is LOCAL to the analyser. It must never
    // mutate STATE.prepYourTeam / STATE.prepOpponent, because those are the
    // canonical teams used everywhere else in Match Prep.
    $('prepGlobalRoleToggle')?.remove();
    $('prepSwitchRoleToggle')?.addEventListener('click',async e=>{
      e.preventDefault();
      STATE.prepSwitchAttackerSide=STATE.prepSwitchAttackerSide==='your'?'opponent':'your';
      STATE.prepSwitchMon=''; STATE.prepSwitchMove=''; STATE.prepSwitchHits='';
      STATE.prepSwitchAtkItem=''; STATE.prepSwitchDefItem='';
      STATE.prepSwitchEVsByMon={}; STATE.prepSwitchAtkEVs={hp:0,atk:0,def:0,spa:0,spd:0,spe:0};
      await render();
    });

    // -------- Speed Workbench wiring --------
    document.querySelectorAll('.speed-mod-btn[data-speed-mod]').forEach(b=>{
      b.addEventListener('click',()=>{
        const side=b.dataset.speedSide, key=b.dataset.speedMod;
        STATE.prepSpeedMods=STATE.prepSpeedMods||{your:{tailwind:false,paralysis:false,scarf:false,webs:false,stage:0},opp:{tailwind:false,paralysis:false,scarf:false,webs:false,stage:0},trickRoom:false};
        STATE.prepSpeedMods[side][key]=!STATE.prepSpeedMods[side][key];
        window.__sblRefreshSpeedWorkbench?.();
      });
    });
    document.querySelectorAll('.speed-mod-btn[data-speed-stage]').forEach(b=>{
      b.addEventListener('click',()=>{
        const side=b.dataset.speedSide, val=Number(b.dataset.speedStage);
        STATE.prepSpeedMods=STATE.prepSpeedMods||{your:{tailwind:false,paralysis:false,scarf:false,webs:false,stage:0},opp:{tailwind:false,paralysis:false,scarf:false,webs:false,stage:0},trickRoom:false};
        STATE.prepSpeedMods[side].stage=(STATE.prepSpeedMods[side].stage||0)===val?0:val;
        window.__sblRefreshSpeedWorkbench?.();
      });
    });
    $('main').querySelector('[data-speed-trickroom]')?.addEventListener('click',()=>{
      STATE.prepSpeedMods=STATE.prepSpeedMods||{your:{tailwind:false,paralysis:false,scarf:false,webs:false,stage:0},opp:{tailwind:false,paralysis:false,scarf:false,webs:false,stage:0},trickRoom:false};
      STATE.prepSpeedMods.trickRoom=!STATE.prepSpeedMods.trickRoom;
      window.__sblRefreshSpeedWorkbench?.();
    });
    document.querySelectorAll('.speed-row-select').forEach(b=>{
      b.addEventListener('click',()=>{
        STATE.prepSpeedSelected=b.dataset.speedMon?[b.dataset.speedMon]:[];
        window.__sblRefreshSpeedWorkbench?.();
      });
    });
    // -------- Speed Workbench selection --------
    // The picker is intentionally isolated from the matrix. Nothing is committed
    // until the user presses Complete.
    $('speedSelectPokemon')?.addEventListener('click',e=>{
      e.preventDefault();
      const data=window.__speedWorkbenchData||{your:[],opp:[]};
      const yourMons=Array.isArray(data.your)?data.your:[];
      let temp=new Set(Array.isArray(STATE.prepSpeedSelected)?STATE.prepSpeedSelected:[]);
      const existing=document.getElementById('speedPokemonPickerModal');
      if(existing) existing.remove();

      const host=document.createElement('div');
      host.id='speedPokemonPickerModal';
      host.className='speed-picker-clean-backdrop';
      host.innerHTML=`<div class="speed-picker-clean-dialog" role="dialog" aria-modal="true" aria-labelledby="speedPickerTitle">
        <div class="speed-picker-clean-head">
          <div><h3 id="speedPickerTitle">Select Pokémon</h3><p>Choose the Pokémon you want in the Speed matrix.</p></div>
          <button type="button" class="speed-picker-clean-close" aria-label="Close">×</button>
        </div>
        <div class="speed-picker-clean-grid"></div>
        <div class="speed-picker-clean-foot"><span class="speed-picker-clean-count"></span><div><button type="button" class="speed-picker-clean-cancel">Cancel</button><button type="button" class="speed-picker-clean-complete">Complete</button></div></div>
      </div>`;
      document.body.appendChild(host);
      requestAnimationFrame(()=>host.classList.add('open'));

      const grid=host.querySelector('.speed-picker-clean-grid');
      const count=host.querySelector('.speed-picker-clean-count');
      const draw=()=>{
        count.textContent=`${temp.size} selected`;
        grid.innerHTML=yourMons.map(mon=>{
          const selected=temp.has(mon.species);
          return `<button type="button" class="speed-picker-clean-option ${selected?'selected':''}" data-species="${esc(mon.species)}">${sprite(mon.species,'speed-picker-clean-sprite')}<span><strong>${esc(displaySpecies(mon))}</strong><small>${selected?'Selected':'Click to select'}</small></span><i>${selected?'✓':''}</i></button>`;
        }).join('');
      };
    const close=()=>{
        document.removeEventListener('keydown',onKey);
        if(host.dataset.closing==='1') return;
        host.dataset.closing='1';
        host.classList.remove('open');
        setTimeout(()=>host.remove(),240);
      };
      const onKey=e=>{if(e.key==='Escape')close();};
      document.addEventListener('keydown',onKey);
      host.querySelector('.speed-picker-clean-close').addEventListener('click',close);
      host.querySelector('.speed-picker-clean-cancel').addEventListener('click',close);
      host.addEventListener('click',e=>{
        if(e.target===host) close();
        const card=e.target.closest('.speed-picker-clean-option');
        if(!card || !host.contains(card)) return;
        const species=card.dataset.species;
        if(temp.has(species)) temp.delete(species); else temp.add(species);
        STATE.prepSpeedSelected=[...temp].filter(sp=>yourMons.some(m=>m.species===sp));
        window.__sblRefreshSpeedWorkbench?.();
        draw();
      });
      host.querySelector('.speed-picker-clean-complete').addEventListener('click',()=>{
        STATE.prepSpeedSelected=[...temp].filter(species=>yourMons.some(m=>m.species===species));
        window.__sblRefreshSpeedWorkbench?.();
        close();
      });
      draw();
    });
    $('speedConfigNature')?.addEventListener('change',async e=>{
      const species=Array.isArray(STATE.prepSpeedSelected)?STATE.prepSpeedSelected[0]:STATE.prepSpeedSelected;
      if(!species)return;
      STATE.prepSpeedConfig=STATE.prepSpeedConfig||{};
      STATE.prepSpeedConfig[species]={...(STATE.prepSpeedConfig[species]||{evs:252}),nature:e.target.value};
      await render();
    });
    $('speedConfigEvs')?.addEventListener('input',e=>{
      const out=$('speedConfigEvsOut'); if(out)out.textContent=e.target.value;
    });
    $('speedConfigEvs')?.addEventListener('change',async e=>{
      const species=Array.isArray(STATE.prepSpeedSelected)?STATE.prepSpeedSelected[0]:STATE.prepSpeedSelected;
      if(!species)return;
      STATE.prepSpeedConfig=STATE.prepSpeedConfig||{};
      STATE.prepSpeedConfig[species]={...(STATE.prepSpeedConfig[species]||{nature:'positive'}),evs:Number(e.target.value)};
      await render();
    });
    $('speedPinBenchmark')?.addEventListener('click',async e=>{
      e.preventDefault();
      const target=$('speedBenchmarkMon')?.value||STATE.prepSpeedBenchmark;
      if(!target)return;
      STATE.prepSpeedPinned=STATE.prepSpeedPinned||[];
      if(!STATE.prepSpeedPinned.includes(target))STATE.prepSpeedPinned.push(target);
      await render();
    });
    document.querySelectorAll('.speed-unpin').forEach(b=>{
      b.addEventListener('click',async e=>{
        e.preventDefault();
        const target=b.dataset.unpin;
        STATE.prepSpeedPinned=(STATE.prepSpeedPinned||[]).filter(p=>p!==target);
        await render();
      });
    });

    function openCoverageMovesModal(type,monName,moves){
      const sorted=[...(moves||[])].sort((a,b)=>(b.power||0)-(a.power||0)||String(a.name).localeCompare(String(b.name)));
      const chip=(m)=>`<span class="cov-move-chip cov-move-${esc(m.category)}"><i class="cov-move-cat">${m.category==='physical'?'P':'S'}</i>${esc(m.name)}<b>${esc(m.power)}</b></span>`;
      const host=document.createElement('div');host.className='switch-ev-modal';
      host.innerHTML=`<div class="switch-ev-card" role="dialog" aria-modal="true"><div class="switch-ev-head"><div><h3>${typePill(type)}</h3><p>Damaging ${esc(type)}-type moves this Pokémon can learn.</p></div><button type="button" id="covMovesClose">Close ✕</button></div><div class="cov-moves-list">${sorted.length?sorted.map(chip).join(''):'<span class="small">No moves found.</span>'}</div></div>`;
      document.body.appendChild(host);
      requestAnimationFrame(()=>host.classList.add('open'));
      const close=()=>{host.classList.remove('open');setTimeout(()=>host.remove(),150);document.removeEventListener('keydown',onKey);};
      const onKey=e=>{if(e.key==='Escape')close();};document.addEventListener('keydown',onKey);
      host.querySelector('#covMovesClose').onclick=close;
      host.addEventListener('click',e=>{if(e.target===host)close();});
    }
    function zeroEVs(){return {hp:0,atk:0,def:0,spa:0,spd:0,spe:0};}
    function openSwitchEvModal(mode,species){
      const isAtk=mode==='attacker';
      const current=isAtk ? {...(STATE.prepSwitchAtkEVs||{})} : {...((STATE.prepSwitchEVsByMon||{})[species]||{})};
      const title=isAtk ? `EVs for ${displaySpecies({species})}` : `Defensive EVs for ${displaySpecies({species})}`;
      const stats=isAtk ? ['atk','spa'] : ['hp','def','spd'];
      const labels={hp:'HP',atk:'Attack',def:'Defence',spa:'Sp. Attack',spd:'Sp. Defence',spe:'Speed'};
      const host=document.createElement('div');host.className='switch-ev-modal';
      host.innerHTML=`<div class="switch-ev-card" role="dialog" aria-modal="true"><div class="switch-ev-head"><div><h3>${esc(title)}</h3><p>${isAtk?'These EVs control the opposing Pokémon using the selected move.':'Set only the defensive EVs used when this Pokémon switches in.'}</p></div><button type="button" id="switchEvClose">Close ✕</button></div><div class="switch-ev-grid-modal">${stats.map(k=>`<div class="switch-ev-field"><span class="switch-ev-field-label">${labels[k]}</span><div class="switch-ev-cell"><button type="button" class="switch-ev-step" data-ev-target="switchEv_${k}" data-delta="-4" aria-label="Decrease ${labels[k]} EV">−</button><input id="switchEv_${k}" type="number" min="0" max="252" step="4" value="${!current[k]?'':Number(current[k])}" inputmode="numeric"><button type="button" class="switch-ev-step" data-ev-target="switchEv_${k}" data-delta="4" aria-label="Increase ${labels[k]} EV">+</button></div></div>`).join('')}</div><div class="switch-ev-actions"><button type="button" id="switchEvReset">Reset to 0</button><button type="button" id="switchEvSave" class="damage-calc-primary">Save EVs</button></div></div>`;
      document.body.appendChild(host);
requestAnimationFrame(()=>host.classList.add('open'));
      const close=()=>{host.classList.remove('open');setTimeout(()=>host.remove(),150);document.removeEventListener('keydown',onKey);};
      const onKey=e=>{if(e.key==='Escape')close();};document.addEventListener('keydown',onKey);
      host.querySelector('#switchEvClose').onclick=close;
      host.addEventListener('click',e=>{if(e.target===host)close();});
      host.querySelector('#switchEvReset').onclick=()=>stats.forEach(k=>host.querySelector('#switchEv_'+k).value=0);
      host.querySelector('#switchEvSave').onclick=async()=>{
        const next={...zeroEVs()};stats.forEach(k=>next[k]=Math.max(0,Math.min(252,Number(host.querySelector('#switchEv_'+k).value)||0)));
        if(isAtk) STATE.prepSwitchAtkEVs=next; else {STATE.prepSwitchEVsByMon=STATE.prepSwitchEVsByMon||{};STATE.prepSwitchEVsByMon[species]=next;}
        close();await renderSwitchResults();
      };
    }
    function openSwitchDefEvModal(species){openSwitchEvModal('defender',species);}
    function openSwitchAtkEvModal(){const species=$('prepSwitchMon')?.value;if(species)openSwitchEvModal('attacker',species);}
    function openSwitchAllDefEvModal(){
      const current={hp:0,def:0,spd:0};
      const host=document.createElement('div');host.className='switch-ev-modal';
      const labels={hp:'HP',def:'Defence',spd:'Sp. Defence'};
      host.innerHTML=`<div class="switch-ev-card" role="dialog" aria-modal="true"><div class="switch-ev-head"><div><h3>Set EVs for all switch-ins</h3><p>Apply the same HP, Defence, and Sp. Defence EVs to every Pokémon in your current team.</p></div><button type="button" id="switchAllEvClose">Close ✕</button></div><div class="switch-ev-grid-modal">${['hp','def','spd'].map(k=>`<div class="switch-ev-field"><span class="switch-ev-field-label">${labels[k]}</span><div class="switch-ev-cell"><button type="button" class="switch-ev-step" data-ev-target="switchAllEv_${k}" data-delta="-4" aria-label="Decrease ${labels[k]} EV">−</button><input id="switchAllEv_${k}" type="number" min="0" max="252" step="4" value="${!current[k]?'':Number(current[k])}" inputmode="numeric"><button type="button" class="switch-ev-step" data-ev-target="switchAllEv_${k}" data-delta="4" aria-label="Increase ${labels[k]} EV">+</button></div></div>`).join('')}</div><div class="switch-ev-actions"><button type="button" id="switchAllEvReset">Reset to 0</button><button type="button" id="switchAllEvSave" class="damage-calc-primary">Apply to all</button></div></div>`;
      document.body.appendChild(host);requestAnimationFrame(()=>host.classList.add('open'));
      host.querySelectorAll('.switch-ev-step').forEach(btn=>{
        const apply=()=>{const input=host.querySelector('#'+btn.dataset.evTarget);if(!input)return;const min=Number(input.min)||0,max=Number(input.max)||252,step=Number(input.step)||4;const value=Number(input.value)||0;input.value=Math.max(min,Math.min(max,value+Number(btn.dataset.delta||0)));input.dispatchEvent(new Event('input',{bubbles:true}));};
        btn.addEventListener('click',e=>{e.preventDefault();apply();});
        let timer=null;btn.addEventListener('pointerdown',e=>{e.preventDefault();btn.setPointerCapture?.(e.pointerId);timer=setTimeout(()=>{timer=setInterval(apply,70);},350);});
        const stop=()=>{if(timer){clearTimeout(timer);clearInterval(timer);timer=null;}};btn.addEventListener('pointerup',stop);btn.addEventListener('pointercancel',stop);btn.addEventListener('pointerleave',stop);
      });
      const close=()=>{host.classList.remove('open');setTimeout(()=>host.remove(),150);document.removeEventListener('keydown',onKey);};
      const onKey=e=>{if(e.key==='Escape')close();};document.addEventListener('keydown',onKey);
      host.querySelector('#switchAllEvClose').onclick=close;
      host.addEventListener('click',e=>{if(e.target===host)close();});
      host.querySelector('#switchAllEvReset').onclick=()=>['hp','def','spd'].forEach(k=>host.querySelector('#switchAllEv_'+k).value=0);
      host.querySelector('#switchAllEvSave').onclick=async()=>{
        const next={...zeroEVs()};['hp','def','spd'].forEach(k=>next[k]=Math.max(0,Math.min(252,Number(host.querySelector('#switchAllEv_'+k).value)||0)));
        const mons=await franchiseMons(STATE.prepYourTeam);
        STATE.prepSwitchEVsByMon=STATE.prepSwitchEVsByMon||{};
        mons.forEach(m=>{STATE.prepSwitchEVsByMon[m.species]={...next};});
        close();await renderSwitchResults();
      };
    }

    const switchMoveCache={};
    async function damagingLearnset(species){
      const cacheKey=norm(species);
      if(switchMoveCache[cacheKey]) return switchMoveCache[cacheKey];
      const candidates=pokemonDexCandidates(species);
      let learnset=[];
      for(const slug of candidates){
        try{
          const r=await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(slug)}`,{cache:'force-cache'});
          if(!r.ok) continue;
          const data=await r.json();
          learnset=(data.moves||[]).map(entry=>({name:entry.move?.name,url:entry.move?.url})).filter(x=>x.name&&x.url);
          if(learnset.length) break;
        }catch(e){}
      }
      if(!learnset.length){ switchMoveCache[cacheKey]=[]; return []; }
      // Fetch move details concurrently in small batches so the selector does not
      // sit on "Loading" indefinitely on large learnsets.
      const details=[];
      const batchSize=12;
      for(let i=0;i<learnset.length;i+=batchSize){
        const batch=learnset.slice(i,i+batchSize);
        const results=await Promise.all(batch.map(async entry=>{
          try{
            const r=await fetch(entry.url,{cache:'force-cache'});
            if(!r.ok) return null;
            const md=await r.json();
            const cls=String(md.damage_class?.name||'').toLowerCase();
            const power=Number(md.power);
            if(power>0 && (cls==='physical'||cls==='special')){
              const pretty=String(md.name||entry.name).split('-').map(x=>x?x[0].toUpperCase()+x.slice(1):x).join(' ');
              return {name:pretty,power};
            }
          }catch(e){}
          return null;
        }));
        results.filter(Boolean).forEach(x=>details.push(x));
      }
      const unique=[...new Map(details.map(x=>[norm(x.name),x])).values()].sort((a,b)=>a.name.localeCompare(b.name));
      switchMoveCache[cacheKey]=unique;
      return unique;
    }
    async function populateSwitchMoveSelect(preferred=''){
      const sel=$('prepSwitchMove'); if(!sel) return [];
      const species=$('prepSwitchMon')?.value;
      const attacker=(await franchiseMons(switchAttackerTeamName)).find(m=>norm(m.species)===norm(species))||{species};
      sel.innerHTML='<option value="">Loading damaging moves…</option>';
      sel.value='';
      try{
        const moves=species?await Promise.race([damagingLearnset(species),new Promise(resolve=>setTimeout(()=>resolve([]),7000))]):[];
        const list=[...new Set((moves||[]).filter(Boolean).map(x=>typeof x==='string'?x:x.name))];
        if(list.length){
          const preferredNow=preferred||STATE.prepSwitchMove||'';
          sel.innerHTML=list.map(m=>`<option value="${esc(m)}" ${norm(m)===norm(preferredNow)?'selected':''}>${esc(m)}</option>`).join('');
          const wanted=list.find(m=>norm(m)===norm(preferredNow));
          sel.value=wanted||list[0];
          STATE.prepSwitchMove=sel.value||'';
          return list;
        }
        // Never default to an arbitrary observed move: some observed moves are
        // status/setup moves and are invalid for damage calculations.
        sel.innerHTML='<option value="">No legal damaging moves found</option>';
        STATE.prepSwitchMove='';
        return [];
      }catch(err){
        sel.innerHTML='<option value="">No legal damaging moves found</option>';
        STATE.prepSwitchMove='';
        return [];
      }
    }
    function switchCalcSpecies(species){
      const raw=String(species||'').trim();
      const key=raw.toLowerCase().replace(/[’']/g,'').replace(/[.:]/g,'').replace(/[_\s]+/g,'-').replace(/-+/g,'-');
      if(window.SBL?.pokemon?.displayNameWithForm) return window.SBL.pokemon.displayNameWithForm(raw);
      return raw;
    }
    function formatSwitchEVs(evs){
      const labels={hp:'HP',atk:'Atk',def:'Def',spa:'SpA',spd:'SpD',spe:'Spe'};
      const stats=['hp','atk','def','spa','spd','spe'];
      const parts=stats.filter(k=>Number(evs?.[k])>0).map(k=>`${Number(evs[k])} ${labels[k]}`);
      return parts.length ? parts.join(' / ') : '0 EVs';
    }

    async function renderSwitchResults(){
      const mount=$('switchResults');if(!mount)return;
      const mon=$('prepSwitchMon')?.value;const move=$('prepSwitchMove')?.value;
      if(!mon||!move){mount.innerHTML='<div class="empty">Select an observed move to analyse switch-ins.</div>';return;}
      mount.innerHTML='<div class="empty">Calculating switch-in ranges…</div>';
      try{
        const C=await getCalcEngine();const gen=C.Generations.get(9);
        const atkItem=STATE.prepSwitchAtkItem||'';
        const rows=[];
        // Abilities matter for switch-ins (e.g. Wonder Guard, Water Absorb,
        // Flash Fire, Levitate, Sap Sipper, Storm Drain, Volt Absorb, etc.).
        // Prefer an ability explicitly stored on the roster. If none is stored,
        // use the species' ability only when there is a single unambiguous choice.
        const abilityName=v=>{
          if(Array.isArray(v)) return String(v[0]||'').trim();
          if(v&&typeof v==='object') return String(v.name??v.ability??'').trim();
          return String(v||'').trim();
        };
        const speciesAbilities=async species=>(await fetchPokemonData(species))?.abilities||[];
        const attackerRoster=rosterForTeam(switchAttackerTeamName).find(x=>norm(rosterMonName(x))===norm(mon));
        const attackerData=await fetchPokemonData(mon);
        const attackerAbility=abilityName(attackerRoster?.ability??attackerRoster?.abilities) || ((attackerData?.abilities||[]).length===1 ? attackerData.abilities[0] : '');
        // Multi-hit moves need an explicit hit count passed to the calc engine,
        // or the engine only computes a single hit. Expose a "Number of Hits"
        // selector for moves with a variable hit count (e.g. Bullet Seed,
        // Rock Blast, Population Bomb) so the user can pick an exact count
        // instead of only ever seeing an averaged/assumed result. Loaded Dice
        // guarantees the near-maximum hit count in-game, so that remains the
        // default assumption when the selector is left on "Auto".
        const moveKey=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,'');
        const moveDataRaw=gen.moves.get(move);
        const multihit=moveDataRaw?.multihit;
        const hasLoadedDice=String(atkItem||'').toLowerCase()==='loaded dice';
        let hitsMin=null,hitsMax=null;
        if(Array.isArray(multihit)){hitsMin=Number(multihit[0]);hitsMax=Number(multihit[1]);}
        else if(typeof multihit==='number'){hitsMin=hitsMax=Number(multihit);}
        const hitsField=$('prepSwitchHitsField'),hitsSelect=$('prepSwitchHits');
        if(hitsField&&hitsSelect){
          if(hitsMin!=null&&hitsMax!=null&&hitsMax>hitsMin){
            const opts=['<option value="">Auto (Loaded Dice / average)</option>']
              .concat(Array.from({length:hitsMax-hitsMin+1},(_,i)=>hitsMin+i).map(n=>`<option value="${n}">${n} hits</option>`));
            const optsHtml=opts.join('');
            if(hitsSelect.innerHTML!==optsHtml) hitsSelect.innerHTML=optsHtml;
            const storedHits=STATE.prepSwitchHits;
            const validStored=storedHits!==''&&Number.isFinite(Number(storedHits))&&Number(storedHits)>=hitsMin&&Number(storedHits)<=hitsMax;
            if(!validStored) STATE.prepSwitchHits='';
            hitsSelect.value=validStored?String(storedHits):'';
            hitsField.style.display='';
          }else{
            hitsField.style.display='none';
            if(STATE.prepSwitchHits!=='') STATE.prepSwitchHits='';
          }
        }
        const explicitHits=STATE.prepSwitchHits!==''&&Number.isFinite(Number(STATE.prepSwitchHits))?Number(STATE.prepSwitchHits):null;
        let switchHits;
        if(explicitHits!=null&&hitsMin!=null&&explicitHits>=hitsMin&&explicitHits<=hitsMax) switchHits=explicitHits;
        else if(Array.isArray(multihit)) switchHits=hasLoadedDice?multihit[1]:Math.round((multihit[0]+multihit[1])/2);
        else if(typeof multihit==='number') switchHits=multihit;
        const ALWAYS_CRIT_MOVES=['surgingstrikes','wickedblow'];
        const forceCrit=ALWAYS_CRIT_MOVES.includes(moveKey(move));
        // Meteor Beam and Electro Shot raise the user's Sp. Atk on the same
        // turn they hit (unlike other charge moves), matching Showdown.
        const CHARGE_MOVE_BOOSTS={'meteorbeam':{spa:1},'electroshot':{spa:1}};
        const chargeBoost=CHARGE_MOVE_BOOSTS[moveKey(move)];
        const switchWeatherVal=STATE.prepSwitchWeather||'';
        const switchTerrainVal=STATE.prepSwitchTerrain||'';
        const switchFieldOptions={};
        if(switchWeatherVal) switchFieldOptions.weather=switchWeatherVal;
        if(switchTerrainVal) switchFieldOptions.terrain=switchTerrainVal;
        const switchField=typeof C.Field==='function' && (switchWeatherVal||switchTerrainVal) ? new C.Field(switchFieldOptions) : undefined;
        const mv=new C.Move(gen,move,{isCrit:forceCrit||undefined,hits:switchHits});
        for(const target of await franchiseMons(switchDefenderTeamName)){
          try{
            const defTypes=typeMapForSpecies[target.species]||await fetchTypes(target.species);
            const targetRoster=rosterForTeam(switchDefenderTeamName).find(x=>norm(rosterMonName(x))===norm(target.species));
            const targetData=await fetchPokemonData(target.species);
            const defenderAbility=abilityName(targetRoster?.ability??targetRoster?.abilities) || ((targetData?.abilities||[]).length===1 ? targetData.abilities[0] : '');
            const moveType=String(mv.type?.name||mv.type||'');
            const normAbility=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,'');
            const atkAb=normAbility(attackerAbility), defAb=normAbility(defenderAbility);
            const bypass=['moldbreaker','teravolt','turboblaze','myceliummight'].includes(atkAb);
            const typeMult=moveType&&defTypes.length?defTypes.reduce((v,t)=>v*typeChartMultiplier(moveType,t),1):1;
            const abilityBlocked=!bypass && (
              (defAb==='wonderguard' && typeMult<=1) ||
              (defAb==='waterabsorb' && moveType==='Water') ||
              (defAb==='voltabsorb' && moveType==='Electric') ||
              (defAb==='motordrive' && moveType==='Electric') ||
              (defAb==='lightningrod' && moveType==='Electric') ||
              (defAb==='flashfire' && moveType==='Fire') ||
              (defAb==='levitate' && moveType==='Ground') ||
              (defAb==='sapsipper' && moveType==='Grass') ||
              (defAb==='stormdrain' && moveType==='Water') ||
              (defAb==='dryskin' && moveType==='Water') ||
              (defAb==='eartheater' && moveType==='Ground') ||
              (defAb==='wellbakedbody' && moveType==='Fire')
            );
            const immuneByChart=!!(moveType && defTypes.length && typeMult===0);
            if(immuneByChart || abilityBlocked){
              rows.push({target,min:0,max:0,pctMin:0,pctMax:0,ko:null,immune:true,ability:defenderAbility,desc:''});
              continue;
            }
            const makeCalcPokemon=(species,opts)=>{
              const raw=canonicalSpecies(species);
              const candidates=[raw, ...spriteCandidates(raw).map(x=>String(x).replace(/-/g,' '))].filter(Boolean);
              let lastErr;
              for(const candidate of candidates){ try{return new C.Pokemon(gen,candidate,opts);}catch(e){lastErr=e;} }
              throw lastErr||new Error('Unsupported Pokémon: '+raw);
            };
            const atk=makeCalcPokemon(mon,{level:100,item:atkItem||undefined,ability:attackerAbility||undefined,evs:STATE.prepSwitchAtkEVs||{hp:0,atk:0,def:0,spa:0,spd:0,spe:0},boosts:chargeBoost||undefined});
            const evs=(STATE.prepSwitchEVsByMon||{})[target.species]||{hp:0,atk:0,def:0,spa:0,spd:0,spe:0};
            const def=makeCalcPokemon(target.species,{level:100,item:STATE.prepSwitchDefItem||undefined,ability:defenderAbility||undefined,evs});
            const res=switchField?C.calculate(gen,atk,def,mv,switchField):C.calculate(gen,atk,def,mv);
            const flattenSwitch=v=>{const out=[];const walk=x=>{if(Array.isArray(x))x.forEach(walk);else if(Number.isFinite(Number(x)))out.push(Number(x));};walk(v);return out;};
            const dmg=res.damage;
            let numericDmg;
            if(Array.isArray(dmg)&&dmg.length&&Array.isArray(dmg[0])){
              const hitsMatrix=dmg.map(hit=>flattenSwitch(hit));
              const count=Math.max(...hitsMatrix.map(a=>a.length));
              numericDmg=Array.from({length:count},(_,i)=>hitsMatrix.reduce((sum,a)=>sum+(a[i]??a[a.length-1]??0),0));
            }else numericDmg=flattenSwitch(dmg);
            if(!numericDmg.length) throw new Error('No numeric damage result was returned for this move.');
            let max=Math.max(...numericDmg);
            let min=Math.min(...numericDmg);
            // Type-resistance berries halve damage only when their matching type hits super effectively.
            const resistBerryTypes={
              'occa berry':'fire','passho berry':'water','wacan berry':'electric','rindo berry':'grass',
              'yache berry':'ice','chople berry':'fighting','kebia berry':'poison','shuca berry':'ground',
              'coba berry':'flying','payapa berry':'psychic','tanga berry':'bug','charti berry':'rock',
              'kasib berry':'ghost','haban berry':'dragon','colbur berry':'dark','babiri berry':'steel',
              'chilan berry':'normal','roseli berry':'fairy'
            };
            const heldDefItem=String(STATE.prepSwitchDefItem||'').toLowerCase();
            const resistType=resistBerryTypes[heldDefItem];
            const resistApplies=resistType && moveType.toLowerCase()===resistType && typeMult>1;
            if(resistApplies){ numericDmg=numericDmg.map(d=>Math.floor(d/2)); }
            min=Math.min(...numericDmg); max=Math.max(...numericDmg);
            const berryName=String(STATE.prepSwitchDefItem||'').toLowerCase();
            const healingBerry=['sitrus berry','wiki berry','aguav berry','iapapa berry','figy berry','mago berry'].includes(berryName);
            const berryHealFraction=berryName==='sitrus berry'?0.25:healingBerry?(1/3):0;
            // Healing berries only activate when the hit leaves the Pokémon at or
            // below the berry's HP threshold: Sitrus at 50% HP or less, and the
            // other recovery berries at 25% HP or less. Check this per damage
            // roll so recovery is only shown when at least one possible roll
            // actually triggers the berry.
            const data=await fetchPokemonData(target.species);
            const baseHp=Number(data?.stats?.hp);
            const engineHp=Number(def.maxHP);
            const formulaHp=Number.isFinite(baseHp) ? (2*baseHp+31+110) : NaN;
            const hp=Number.isFinite(engineHp)&&engineHp>0 ? engineHp : formulaHp;
            // Berry activation is checked against the damage of each individual hit.
            // Sitrus activates at 50% HP remaining; the other recovery berries at 25% HP remaining.
            const berryActivationDamageFraction=berryName==='sitrus berry'?0.5:0.75;
            const berryActivationDamage=healingBerry&&Number.isFinite(hp)?hp*berryActivationDamageFraction:Infinity;
            const berryActivates=healingBerry&&numericDmg.some(d=>d>=berryActivationDamage);
            const immune=max===0;
            const healPct=berryActivates?berryHealFraction*100:0;
            const healPctLabel=berryActivates?(berryName==='sitrus berry'?'1/4':'1/3'):'';
            const heal=berryActivates?Math.floor(hp*berryHealFraction):0;
            // Apply the berry only to rolls that actually cross its activation
            // threshold, so a berry that does not activate during the hit is not
            // shown as recovery and does not alter those rolls.
            const adjustedRolls=numericDmg.map(d=>Math.max(0,d-(healingBerry&&d>=berryActivationDamage?heal:0)));
            min=Math.min(...adjustedRolls); max=Math.max(...adjustedRolls);
            const netMin=min, netMax=max;
            const pctMin=!immune&&Number.isFinite(hp)&&hp>0?(netMin/hp*100):immune?0:null;
            const pctMax=!immune&&Number.isFinite(hp)&&hp>0?(netMax/hp*100):immune?0:null;
            const rawPctMin=!immune&&Number.isFinite(hp)&&hp>0?(Math.min(...numericDmg)/hp*100):immune?0:null;
            const rawPctMax=!immune&&Number.isFinite(hp)&&hp>0?(Math.max(...numericDmg)/hp*100):immune?0:null;
            const focusSash=String(STATE.prepSwitchDefItem||'').toLowerCase()==='focus sash';
            const koRolls=!immune&&Number.isFinite(hp)&&hp>0?adjustedRolls.filter(d=>d>=hp).length:0;
            const koChance=adjustedRolls.length?koRolls/adjustedRolls.length*100:null;
            const wouldKoWithoutSash=koRolls>0;
            const ko=focusSash&&wouldKoWithoutSash?'sash':(!immune&&Number.isFinite(hp)&&hp>0?(koChance===100?'guaranteed':koChance>0?'possible':'no'):null);
            rows.push({target,min,max,netMin,netMax,pctMin,pctMax,rawPctMin,rawPctMax,heal:berryActivates?heal:0,healPct,healPctLabel,berryActivates,ko,koChance,focusSash,wouldKoWithoutSash,immune,hp,hits:switchHits,ability:defenderAbility,attackerAbility,desc:typeof res.fullDesc==='function'?res.fullDesc():''});
          }catch(err){rows.push({target,error:err.message||String(err)});}
        }
        /* Preserve roster order; switch-in cards are never sorted by damage. */
        mount.innerHTML=`<div class="prep-switch-grid">${rows.map(r=>`<article class="prep-switch-card prep-switch-ev-card" data-switch-ev-mon="${esc(r.target.species)}"><div class="switch-card-top">${sprite(r.target.species,'prep-switch-sprite')}<div class="switch-card-identity"><strong class="switch-card-name">${esc(displaySpecies(r.target))}</strong><div class="switch-card-types">${typePills(typeMapForSpecies[r.target.species]||[])}</div><div class="switch-card-evs">EVs: ${esc(formatSwitchEVs((STATE.prepSwitchEVsByMon||{})[r.target.species]||{hp:0,atk:0,def:0,spa:0,spd:0,spe:0}))}</div></div><button type="button" class="prep-switch-ev-toggle">Set EVs</button></div>${r.error?`<div class="switch-card-detail">Calculation unavailable: ${esc(r.error)}</div>`:r.immune?`<div class="switch-card-result"><div><div class="switch-card-result-label">Damage</div><div class="prep-damage-range">No effect</div></div><div class="switch-card-verdict">Immune</div></div><div class="switch-card-detail">${esc(move)} does no damage to ${esc(displaySpecies(r.target))}.</div><div class="switch-card-footer"><span class="prep-switch-note">Safe switch-in</span></div>`:`<div class="switch-card-result"><div><div class="switch-card-result-label">Damage taken</div><div class="prep-damage-range">${Number.isFinite(r.pctMin)&&Number.isFinite(r.pctMax)?`${r.pctMin.toFixed(1)}%–${r.pctMax.toFixed(1)}%`:'Unavailable'}</div></div><div class="switch-card-verdict">${r.ko==='sash'?'Would KO without Focus Sash':r.ko==='guaranteed'?'Guaranteed KO':r.ko==='possible'?`KO ${Number.isInteger(r.koChance)?r.koChance:r.koChance.toFixed(2)}% of the time`:r.pctMax<=35?'Excellent':r.pctMax<=55?'Generally safe':'Risky'}</div></div><div class="switch-card-detail">${r.min}–${r.max} raw damage from ${esc(move)}${r.hits>1?` (${r.hits}× hits)`:''}${r.heal?` · ${r.heal} HP healed (${r.healPctLabel} max HP when triggered) · ${r.netMin}–${r.netMax} net damage`:''}</div><div class="switch-card-footer"><span class="prep-switch-note">${r.ko==='sash'?'Would KO without Focus Sash':r.ko==='guaranteed'?'KO — guaranteed from the minimum roll':r.ko==='possible'?`KO ${Number.isInteger(r.koChance)?r.koChance:r.koChance.toFixed(2)}% of the time`:r.pctMax<=35?'Excellent switch-in':r.pctMax<=55?'Generally safe':'Risky switch-in'}</span>${Number.isFinite(r.hp)?`<span class="switch-card-hp">${r.hp} HP</span>`:''}</div>`}</article>`).join('')}</div>`;
        mount.querySelectorAll('.prep-switch-ev-toggle').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const card=btn.closest('.prep-switch-ev-card');const species=card?.dataset.switchEvMon;if(species)openSwitchDefEvModal(species);}));
        mount.querySelectorAll('.prep-switch-ev-card').forEach(card=>card.addEventListener('click',e=>{
          if(e.target.closest('button'))return;
          const sel=window.getSelection?.();
          if(sel && !sel.isCollapsed && String(sel).trim()) return;
          const species=card.dataset.switchEvMon;
          if(species)openSwitchDefEvModal(species);
        }));
      }catch(err){mount.innerHTML=`<div class="empty">Could not calculate switch-ins: ${esc(err.message||err)}</div>`;}
    }

    // Build a local type map for switch-in cards and calculate once after render.
    const typeMapForSpecies={};
    for(const m of await franchiseMons(switchDefenderTeamName)){typeMapForSpecies[m.species]=await fetchTypes(m.species);}
    await populateSwitchMoveSelect(STATE.prepSwitchMove||'');
    if($('prepSwitchMove')?.value) await renderSwitchResults();
    return;
  }
  // Team Overview has been absorbed into Match Prep.
  return;
}
async function openPokemonScoutPopup(team,key){
  const a=aggregate(team);
  const wanted=norm(key);
  const m=a.mons[key] || a.mons[wanted] || Object.values(a.mons).find(x=>norm(x.species)===wanted);
  if(!m){console.warn('Could not open Pokémon scout popup:',team,key,Object.keys(a.mons));return;}

  const host=document.createElement('div');
  host.innerHTML=`<div class="scout-popup-overlay" id="scoutPopupOverlay">
    <div class="scout-popup-card" role="dialog" aria-modal="true" aria-label="${esc(displaySpecies(m))}">
      <div class="scout-popup-head">
        <div class="scout-popup-title">
          ${sprite(m.species)}
          <div>
            <h2>${esc(displaySpecies(m))}</h2>
            <div class="muted">${m.replays.size} replays · ${m.appearances} appearances</div>
          </div>
        </div>
        <div class="scout-popup-actions"><button class="scout-popup-close" id="scoutPopupClose" type="button">Close ✕</button></div>
      </div>

      <div class="scout-popup-section">
        <h3>Performance</h3>
        <div class="scout-performance-grid">
          <div class="scout-performance-stat"><span>Appearances</span><strong>${m.appearances}</strong></div>
          <div class="scout-performance-stat"><span>KOs</span><strong>${m.kills}</strong></div>
          <div class="scout-performance-stat"><span>Deaths</span><strong>${m.deaths}</strong></div>
          <div class="scout-performance-stat"><span>Damage dealt</span><strong>${Number(m.dealt||0).toFixed(0)}</strong></div>
          <div class="scout-performance-stat"><span>Damage taken</span><strong>${Number(m.taken||0).toFixed(0)}</strong></div>
        </div>
      </div>

      <div class="scout-popup-section">
        <h3>Abilities</h3>
        <div id="scoutAbilities" class="scout-abilities"><div class="muted">Loading…</div></div>
      </div>

      <div class="scout-popup-columns">
        <div class="scout-popup-section">
          <h3>Base stat spread</h3>
          <div id="scoutBaseStats" class="scout-base-grid"><div class="muted">Loading…</div></div>
          <div id="scoutBaseTotal"></div>
        </div>
        <div class="scout-popup-section">
          <h3>Type effectiveness</h3>
          <div id="scoutTypeEffectiveness"><div class="muted">Loading…</div></div>
        </div>
      </div>
    </div>
  </div>`;

  document.body.appendChild(host);
  const overlay=host.querySelector('#scoutPopupOverlay');
  requestAnimationFrame(()=>overlay.classList.add('open'));

  const close=()=>{
    document.removeEventListener('keydown',onKey);
    overlay.classList.remove('open');
    setTimeout(()=>host.remove(),160);
  };
  host.querySelector('#scoutPopupClose').addEventListener('click',close);
  host.querySelector('#scoutPopupOverlay').addEventListener('click',e=>{
    if(e.target.id==='scoutPopupOverlay')close();
  });
  const onKey=e=>{if(e.key==='Escape')close();};
  document.addEventListener('keydown',onKey);

  try{
    const data=await fetchPokemonData(m.species);
    if(!data){
      host.querySelector('#scoutBaseStats').innerHTML='<div class="muted">Base stats unavailable.</div>';
      host.querySelector('#scoutTypeEffectiveness').innerHTML='<div class="muted">Type data unavailable.</div>';
      host.querySelector('#scoutAbilities').innerHTML='<div class="muted">Abilities unavailable.</div>';
      return;
    }

    const statMap=data.stats||{};
    const statNames=[
      ['hp','HP'],['attack','Atk'],['defense','Def'],
      ['special-attack','SpA'],['special-defense','SpD'],['speed','Spe']
    ];
    host.querySelector('#scoutBaseStats').innerHTML=statNames.map(([k,label])=>{
      const value=Number(statMap[k])||0;
      return `<div class="scout-base-stat"><div class="scout-base-stat-head"><span>${label}</span><strong>${value||'—'}</strong></div><div class="scout-stat-bar"><i style="width:${Math.min(100,value/180*100)}%"></i></div></div>`;
    }).join('');
    host.querySelector('#scoutBaseTotal').innerHTML=`<div class="scout-stat-total"><span>Total base stats</span><strong>${statNames.reduce((sum,[k])=>sum+(Number(statMap[k])||0),0)}</strong></div>`;

    const abilities=data.abilities||[];
    const prettyAbility=a=>a.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    host.querySelector('#scoutAbilities').innerHTML=abilities.length
      ? abilities.map(a=>`<span class="scout-ability">${prettyAbility(a)}</span>`).join('')
      : '<div class="muted">No abilities listed.</div>';

    const displayTypes=(data.types||[]).map(x=>String(x)).filter(Boolean).map(x=>x[0].toUpperCase()+x.slice(1));
    // Level 100, 31 IV, 252 EVs. Neutral vs one boosting nature.
    const statValue=(base,hp,boost)=>{
      base=Number(base)||0;
      if(hp) return 2*base+31+63+110;
      const neutral=Math.floor((2*base+31+63)*1)+5;
      return boost ? Math.floor(neutral*1.1) : neutral;
    };
    const natureKeys=[['hp','HP'],['attack','Atk'],['defense','Def'],['special-attack','SpA'],['special-defense','SpD'],['speed','Spe']];
    const natureRows=boost=>natureKeys.map(([k,label])=>{
      const v=statValue(statMap[k],k==='hp',boost);
      return `<div class="scout-nature-row"><span>${label}</span><div class="bar"><i style="width:${Math.min(100,v/500*100)}%"></i></div><strong>${v}</strong></div>`;
    }).join('');
    host.querySelector('#scoutBaseTotal').insertAdjacentHTML('afterend',`
      <div class="scout-nature-stats">
        <div class="scout-nature-card"><h4>Neutral nature · Lv. 100 · 31 IV / 252 EV</h4>${natureRows(false)}</div>
        <div class="scout-nature-card"><h4>Boosting nature · Lv. 100 · 31 IV / 252 EV</h4>${natureRows(true)}</div>
      </div>
    `);

    const types=(data.types||[]).map(x=>String(x)).filter(Boolean)
      .map(x=>x[0].toUpperCase()+x.slice(1));

    const allTypes=['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
    const eff=allTypes.map(type=>{
      const mult=types.reduce((v,def)=>v*typeChartMultiplier(type,def),1);
      return {type,mult};
    }).filter(x=>x.mult!==1);

    const weaknesses=eff.filter(x=>x.mult>1);
    const resistances=eff.filter(x=>x.mult>0 && x.mult<1);
    const immunities=eff.filter(x=>x.mult===0);
    const group=(title,cls,items)=>`<div class="scout-type-group ${cls}"><h4>${title}</h4>${
      items.length ? `<div class="scout-type-list">${items.map(x=>`<span class="scout-type-pill">${x.type} <b>${fmtMult(x.mult)}</b></span>`).join('')}</div>` : '<div class="muted">None</div>'
    }</div>`;
    host.querySelector('#scoutTypeEffectiveness').innerHTML=`<div class="scout-type-groups">
      ${group('Weaknesses','weak',weaknesses)}
      ${group('Resistances','resist',resistances)}
      ${group('Immunities','immune',immunities)}
    </div>`;
  }catch(e){
    host.querySelector('#scoutBaseStats').innerHTML='<div class="muted">Base stats unavailable.</div>';
    host.querySelector('#scoutTypeEffectiveness').innerHTML='<div class="muted">Type data unavailable.</div>';
  }
}

async function load(){
  try{
    const {data:authData}=await supabase.auth.getUser();
    const user=authData?.user||null;
    if(!user){ location.replace('index.html'); return; }
    const profile=await SBL.profiles.get(user.id, 'team_name', supabase);
    STATE.profileUserId=user.id; STATE.profileTeam=profile?.team_name||'';
    if(!STATE.profileTeam){ location.replace('index.html'); return; }
    document.getElementById('app').style.display = '';
    const {data,error}=await SBL.replays.load(supabase);
    if(error)throw error;
    const { sharedState, replays, publishedRosters } = SBL.replays.partition(data);
    const shared = sharedState || {};
    const snap=SBL.seasons.getSnapshot(shared);
    STATE.teamMap=snap.teamMap;
    STATE.settings=Object.assign(STATE.settings,snap.settings||{});
    STATE.settings.rosters=STATE.settings.rosters||{};
    const seasonReplays=snap.archived ? snap.replays : replays;
    if(seasonReplays && typeof seasonReplays==='object'){
      for(const [id,replay] of Object.entries(seasonReplays)) if(id && replay) STATE.replays[id]=replay;
    }
    if(publishedRosters && typeof publishedRosters==='object' && Object.keys(STATE.settings.rosters||{}).length===0){
      STATE.settings.rosters=publishedRosters;
    }
    const {data:tradeRows} = await SBL.trades.load(supabase);
    STATE.settings.rosters = SBL.trades.getEffectiveRosters(STATE.settings.rosters || {}, tradeRows || []);
  }catch(e){
    $('main').innerHTML=`<div class="panel"><div class="empty">Could not load shared replay data: ${esc(e.message)}</div></div>`;
    return;
  }

  const replayTeams=allRows()
    .flatMap(r=>[teamFor(r.players?.p1),teamFor(r.players?.p2)])
    .filter(Boolean);
  const rosterTeams=Object.keys(STATE.settings?.rosters||{});
  const teams=[...new Set([...replayTeams,...rosterTeams])]
    .sort((a,b)=>a.localeCompare(b));

  const qs=new URLSearchParams(location.search);
  const requested=qs.get('team');

  $('teamSelect').innerHTML=teams.length
    ? teams.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')
    : '<option value="">No teams found</option>';

  // Resolve the user's actual next scheduled opponent from the fixture.
  // This is the default whenever Match Prep is opened without an explicit
  // ?team=... parameter, regardless of which page the user came from.
  function nextOpponentForTeam(team){
    const key=v=>teamKey(v);
    const target=key(team);
    const finals=window.SBL?.finals?.resolveMatchups ? window.SBL.finals.resolveMatchups(STATE.settings?.finals||{}) : null;
    if(finals && finals.status!=='inactive') {
      for(const round of (finals.rounds||[])){
        for(const match of (round.matches||[])){
          if(match.winner || !match.teamA || !match.teamB) continue;
          if(key(match.teamA)===target) return match.teamB;
          if(key(match.teamB)===target) return match.teamA;
        }
      }
    }
    const rounds=Array.isArray(STATE.settings?.fixture?.rounds) ? STATE.settings.fixture.rounds : [];
    const played=(week,home,away)=>Object.values(STATE.replays||{}).some(r=>{
      if(!r || String(r.week||'Unassigned')!==String(week) || !r.players) return false;
      const a=key(teamFor(r.players.p1)), b=key(teamFor(r.players.p2));
      return (a===key(home)&&b===key(away)) || (a===key(away)&&b===key(home));
    });
    for(const round of rounds){
      for(const match of (round.matches||[])){
        if(key(match.home)!==target && key(match.away)!==target) continue;
        if(played(round.week,match.home,match.away)) continue;
        return key(match.home)===target ? match.away : match.home;
      }
    }
    return '';
  }

  let defaultOpponent='';
  if(requested && teams.some(t=>sameTeam(t,requested))){
    defaultOpponent=teams.find(t=>sameTeam(t,requested))||requested;
  }else if(STATE.profileTeam){
    defaultOpponent=nextOpponentForTeam(STATE.profileTeam);
    if(defaultOpponent) defaultOpponent=teams.find(t=>sameTeam(t,defaultOpponent))||defaultOpponent;
    if(!defaultOpponent) defaultOpponent=teams.find(t=>!sameTeam(t,STATE.profileTeam))||'';
  }
  if(defaultOpponent){
    $('teamSelect').value=defaultOpponent;
    STATE.prepOpponent=defaultOpponent;
  }
  await render();
}


$('teamSelect').addEventListener('change',async()=>{
  STATE.prepSection=STATE.prepSection||'overview';
  const selected=$('teamSelect').value;
  if(selected){
    STATE.prepOpponent=selected;
    const u=new URL(location.href);
    u.searchParams.set('team',selected);
    history.replaceState(null,'',u);
  }
  await render();
});




// Public read-only bridge for the standalone Damage Calculator. These helpers
// live in the main app scope, so publish them here rather than referencing
// private identifiers from another script block.
window.__dashboardTeamNames = teamNames;
window.__dashboardRosterForTeam = rosterForTeam;
window.__dashboardRosterMonName = rosterMonName;
window.__dashboardGetTeams = function(){
  const fromSelect=[...document.querySelectorAll('#teamSelect option')].map(o=>o.value).filter(Boolean);
  const fromState=teamNames();
  return [...new Map([...fromSelect,...fromState].map(t=>[teamKey(t),t])).values()]
    .sort((a,b)=>String(a).localeCompare(String(b)));
};
window.__dashboardProfileTeam = function(){ return typeof STATE!=='undefined' ? (STATE.profileTeam||'') : ''; };
window.__dashboardNextOpponent = function(team){ try{ return nextScheduledOpponent(team||STATE.profileTeam)||''; }catch(e){ return ''; } };
window.__dashboardGetRosterNames = function(team){
  const raw=rosterForTeam(team);
  const arr=Array.isArray(raw)?raw:[];
  return [...new Set(arr.map(rosterMonName).map(x=>String(x||'').trim()).filter(Boolean))];
};

load();
})();

/* ===== End block 3 ===== */

/* ===== Extracted inline Match Prep block 4 ===== */

(function(){
function normalizeSwitchTypes(root){
 const scope=root||document;
 scope.querySelectorAll('#switchResults .type-row,#switchResults .types-row,#switchResults .switch-types').forEach(function(row){
  row.classList.add('switch-type-row');
  const badges=Array.from(row.children).filter(function(el){return !el.classList.contains('type-empty');});
  if(badges.length===1){
   const empty=document.createElement('span');
   empty.className='type-empty';
   empty.setAttribute('aria-hidden','true');
   row.appendChild(empty);
  }
 });
}
function init(){
 normalizeSwitchTypes(document);
 const results=document.getElementById('switchResults');
 if(!results)return;
 new MutationObserver(function(){normalizeSwitchTypes(results);}).observe(results,{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* ===== End block 4 ===== */
