
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
      calcEnginePromise=(async()=>{
        let lastError=null;
        for(const source of [
          'https://cdn.jsdelivr.net/npm/@smogon/calc@0.11.0/+esm',
          'https://esm.sh/@smogon/calc@0.11.0?bundle'
        ]){
          try{
            const C=normalizeCalcModule(await import(source));
            if(C){window.calc=C;return C;}
            lastError=new Error('Calculator API was not exposed by '+source);
          }catch(error){lastError=error;}
        }
        throw new Error('Switch-In calculator could not load from either provider: '+(lastError?.message||'network unavailable'));
      })().catch(err=>{calcEnginePromise=null;throw err;});
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
let STATE={profileUserId:'',replays:{},teamMap:{},settings:{caseInsensitiveNames:true,rosters:{}},profileTeam:'',compareOpponent:'',comparePokemon:'',setPokemon:'',prepSection:'overview',prepCoverageMon:'',prepSwitchAtkItem:'',prepSwitchDefItem:'',prepSwitchWeather:'',prepSwitchTerrain:'',prepSwitchHits:'',prepSwitchAtkEVs:{hp:0,atk:0,def:0,spa:0,spd:0,spe:0},prepSwitchAllDefEVs:{hp:0,def:0,spd:0},prepSwitchAttackerSide:'opponent'};
// CP4.170: page-scoped, bounded read models. Repeated team switches never
// rescan every replay and requery the same species; invalidated on reload.
const TEAM_AGGREGATE_CACHE=new Map(), TEAM_MON_CACHE=new Map();
// Remain stable across rerenders; the shared catalogue has its own versioned
// TTL. This page cache is cleared when the league/season is reloaded.
const PREP_COVERAGE_MOVE_CACHE=new Map();
STATE.franchiseNames=[];
function clearMatchPrepReadModels(){TEAM_AGGREGATE_CACHE.clear();TEAM_MON_CACHE.clear();PREP_COVERAGE_MOVE_CACHE.clear();}
const $=id=>document.getElementById(id);
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function roleDisplayLabel(value){const spaced=String(value??'').trim().replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[._-]+/g,' ').replace(/\s+/g,' ').trim();if(/^(?:cleric|celric)$/i.test(spaced))return 'Recovery';if(/^speed control$/i.test(spaced)||/^sticky web(?: setter|s)?$/i.test(spaced))return 'Sticky Webs';if(/^hazard setter$/i.test(spaced))return '';if(/^stealth rock setter$/i.test(spaced))return 'Stealth Rock';if(/^spikes setter$/i.test(spaced))return 'Spikes';if(/^toxic spikes setter$/i.test(spaced))return 'Toxic Spikes';return spaced.replace(/\b\w/g,c=>c.toUpperCase());}
function roleDisplayList(values){const seen=new Set(),out=[];(Array.isArray(values)?values:[]).forEach(value=>{const label=roleDisplayLabel(value);const key=label.toLocaleLowerCase();if(label&&!seen.has(key)){seen.add(key);out.push(label);}});return out;}
function norm(s){
  const raw=String(s??'').trim().toLowerCase().replace(/[-_]/g,' ');
  // A legacy replay contains Comfey with the species text reversed as "yefmoc".
  // Treat it as Comfey for all joins while preserving the replay statistics.
  if(raw.replace(/\s+/g,'')==='yefmoc') return 'comfey';
  return raw.replace(/\s+/g,' ');
}
function teamKey(s){return norm(s).replace(/[^a-z0-9]/g,'')}
function sameTeam(a,b){return teamKey(a)===teamKey(b)}
function teamFor(u){return SBL.domain.replayTeamLabel(STATE,u)}
function spriteId(s){ return SBL.pokemon.normalizeName(s); }
function spriteCandidates(s){ return SBL.pokemon.candidateIds(s); }
function sprite(s,cls='sprite'){ return SBL.pokemon.spriteMarkup(s, cls); }
function allRows(){return Object.values(STATE.replays)}
function rowsForTeam(team){return allRows().filter(r=>sameTeam(teamFor(r.players?.p1),team)||sameTeam(teamFor(r.players?.p2),team))}
function sideForTeam(r,team){if(sameTeam(teamFor(r.players?.p1),team))return 'p1';if(sameTeam(teamFor(r.players?.p2),team))return 'p2';return null}
function formBaseKey(s){
  const k=norm(canonicalSpecies(s));
  return k.replace(/\s+(?:hisui|galar|alola|alolan|paldea|paldean|kantonian|johto|sinnoh|unova|kalos|hoenn|origin|therian|incarnate|resolute|ordinary|rapid|single|ice|shadow|dusk|dawn|crowned|hero|school|noice|hangry|busted|blade|zen|meteor|stellar|terastal|complete|10 percent|50 percent|family of three|family of four|male|female|m|f)$/i,'');
}
function resolveReplaySpecies(raw, rosterSpecies){
  const species=canonicalSpecies(raw);
  if(!Array.isArray(rosterSpecies)||!rosterSpecies.length)return species;
  // A display prefix (Mega Greninja) and a Showdown suffix
  // (Greninja-Mega) are one permanent form, never two roster entries.
  const exact=rosterSpecies.find(r=>speciesKey(r)===speciesKey(species));
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
    const k=speciesKey(species);
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
    const k=speciesKey(sp);
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
// games) end up under two different keys - the replay-logged one then gets
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
  let raw=String(s??'').trim().replace(/[\u2013 - ]/g,'-').replace(/\s+/g,' ');
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
  // compactMap, and - critically - the roster/replay matching in
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
function speciesKey(name){
  return SBL.domain?.pokemonKey?.(canonicalSpecies(name))||norm(canonicalSpecies(name)).replace(/\s+/g,'-');
}
function hasCurrentRoster(team){return rosterForTeam(team).length>0}
function cloneReplayEvidence(record){
  return {...record,
    replays:new Set(record?.replays instanceof Set?record.replays:[]),
    weeks:new Set(record?.weeks instanceof Set?record.weeks:[]),
    gameSets:Array.isArray(record?.gameSets)?record.gameSets.slice():[],
    items:{...(record?.items||{})},confirmedItems:{...(record?.confirmedItems||{})},
    inferredItems:{...(record?.inferredItems||{})},
    itemEvidence:Object.fromEntries(Object.entries(record?.itemEvidence||{}).map(([key,values])=>[key,[...(values||[])]])),
    moveDamage:JSON.parse(JSON.stringify(record?.moveDamage||{}))
  };
}
function mergeReplayEvidence(target,source){
  if(source?.replays instanceof Set)source.replays.forEach(id=>target.replays.add(id));
  if(source?.weeks instanceof Set)source.weeks.forEach(week=>target.weeks.add(week));
  const gameSetByReplay=new Map(target.gameSets.map((row,index)=>[row.replayId?String(row.replayId):`${row.week||''}|${JSON.stringify(row.moves||{})}`,index]));
  for(const row of (source?.gameSets||[])){
    const key=row.replayId?String(row.replayId):`${row.week||''}|${JSON.stringify(row.moves||{})}`;
    const index=gameSetByReplay.get(key);
    if(index===undefined){target.gameSets.push({...row,moves:{...(row.moves||{})},items:{...(row.items||{})}});gameSetByReplay.set(key,target.gameSets.length-1);continue;}
    const current=target.gameSets[index];
    current.moves=current.moves||{};for(const [move,count] of Object.entries(row.moves||{}))current.moves[move]=(Number(current.moves[move])||0)+(Number(count)||0);
    current.items=current.items||{};for(const [item,count] of Object.entries(row.items||{}))current.items[item]=(Number(current.items[item])||0)+(Number(count)||0);
    current.confirmedItems=current.confirmedItems||{};for(const [item,count] of Object.entries(row.confirmedItems||{}))current.confirmedItems[item]=Math.max(Number(current.confirmedItems[item]||0),Number(count)||0);
    current.inferredItems=current.inferredItems||{};for(const [item,count] of Object.entries(row.inferredItems||{}))current.inferredItems[item]=Math.max(Number(current.inferredItems[item]||0),Number(count)||0);
    current.sentOut=(Number(current.sentOut)||0)+(Number(row.sentOut)||0);
    current.led=(Number(current.led)||0)+(Number(row.led)||0);
  }
  for(const [key,value] of Object.entries(source?.items||{}))target.items[key]=(Number(target.items[key])||0)+(Number(value)||0);
  for(const [key,value] of Object.entries(source?.confirmedItems||{}))target.confirmedItems[key]=Math.max(Number(target.confirmedItems[key]||0),Number(value)||0);
  for(const [key,value] of Object.entries(source?.inferredItems||{}))target.inferredItems[key]=Math.max(Number(target.inferredItems[key]||0),Number(value)||0);
  for(const [key,values] of Object.entries(source?.itemEvidence||{})){
    const dest=target.itemEvidence[key]||(target.itemEvidence[key]=[]);
    for(const value of (values||[]))if(!dest.includes(value))dest.push(value);
  }
  for(const [move,entry] of Object.entries(source?.moveDamage||{})){
    const dest=target.moveDamage[move]||(target.moveDamage[move]={hits:0,uses:0,damage:0,percentSum:0,percentHits:0,percentSamples:[],maxPercent:null,critHits:0,observedGames:0,targets:{}});
    for(const field of ['hits','uses','damage','percentSum','percentHits','critHits','observedGames'])dest[field]=(Number(dest[field])||0)+(Number(entry?.[field])||0);
    const remaining=Math.max(0,120-(dest.percentSamples||[]).length);
    dest.percentSamples=[...(dest.percentSamples||[]),...(entry?.percentSamples||[]).slice(0,remaining)];
    if(entry?.maxPercent!=null)dest.maxPercent=Math.max(dest.maxPercent??0,Number(entry.maxPercent)||0);
    for(const [targetKey,record] of Object.entries(entry?.targets||{})){
      const targetRow=dest.targets[targetKey]||(dest.targets[targetKey]={hits:0,percentSum:0,percentHits:0});
      for(const field of ['hits','percentSum','percentHits'])targetRow[field]=(Number(targetRow[field])||0)+(Number(record?.[field])||0);
    }
  }
  return target;
}
function aggregateUncached(team){
  const games=rowsForTeam(team);const mons={};let wins=0;const pairCounts={};
  const currentRoster=rosterForTeam(team);
  // Seed the analysis with every current-roster Pokémon so the page represents
  // the current roster even when a Pokémon has not appeared in a processed replay.
  for(const mon of currentRoster){
    const species=canonicalSpecies(rosterMonName(mon)); const k=speciesKey(species);
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
      const k=speciesKey(m.species);
      if(!mons[k])mons[k]={species:m.species,appearances:0,kills:0,deaths:0,dealt:0,taken:0,replays:new Set(),gameSets:[],weeks:new Set(),items:{},confirmedItems:{},inferredItems:{},itemEvidence:{}};
      const a=mons[k];
      // Sitewide appearance semantics: m.appearances means the Pokémon was
      // brought in the submitted team for this replay, not merely sent onto
      // the field. Count it once per replay.
      a.appearances+=Number(m.appearances||0)||1;a.kills+=Number(m.kills||0);a.deaths+=Number(m.deaths||0);
      a.leads=(Number(a.leads)||0)+Number(m.leads||0);
      a.sentOut=(Number(a.sentOut)||0)+Number(m.sentOut||0);
      a.dealt+=Number(m.damageDealt||0);a.taken+=Number(m.damageTaken||0);a.replays.add(r.id);
      a.moveDamage ||= {};
      for(const [move,entry] of Object.entries(m.moveDamage||{})){
        const out=a.moveDamage[move] ||= {hits:0,uses:0,damage:0,percentSum:0,percentHits:0,percentSamples:[],maxPercent:null,critHits:0,observedGames:0,targets:{}};
        out.observedGames++;
        for(const field of ['hits','damage','percentSum','percentHits','critHits'])out[field]+=Number(entry[field]||0);
        // The parser has move attempts, including misses, on the same replay's move map.
        out.uses+=Number(m.moves?.[move]||0);
        out.percentSamples.push(...(entry.percentSamples||[]).slice(0,Math.max(0,120-out.percentSamples.length)));
        if(entry.maxPercent!=null)out.maxPercent=Math.max(out.maxPercent??0,Number(entry.maxPercent)||0);
        for(const [target,record] of Object.entries(entry.targets||{})){
          const dest=out.targets[target] ||= {hits:0,percentSum:0,percentHits:0};
          for(const field of ['hits','percentSum','percentHits'])dest[field]+=Number(record[field]||0);
        }
      }
      const replayWeek=String(r.week??r.round??r.roundNumber??'').trim();if(replayWeek && Number(m.appearances||0)>0)a.weeks.add(replayWeek);
      for(const [item,count] of Object.entries(m.items||{})) a.items[item]=(a.items[item]||0)+Number(count||0);
      for(const [item,count] of Object.entries(m.confirmedItems||{})) a.confirmedItems[item]=Math.max(Number(a.confirmedItems[item]||0),Number(count||0));
      for(const [item,count] of Object.entries(m.inferredItems||{})) a.inferredItems[item]=Math.max(Number(a.inferredItems[item]||0),Number(count||0));
      for(const [item,evidence] of Object.entries(m.itemEvidence||{})){a.itemEvidence[item] ||= [];for(const ev of (evidence||[]))if(!a.itemEvidence[item].includes(ev))a.itemEvidence[item].push(ev);}
      const moves={...(m.moves||{})};
      a.gameSets.push({replayId:String(r.id||r.replay_id||''),week: replayWeek, moves, items:{...(m.items||{})}, confirmedItems:{...(m.confirmedItems||{})}, inferredItems:{...(m.inferredItems||{})}, sentOut:Number(m.sentOut||0), led:Number(m.leads||0)>0 ? 1 : 0});
      seen.push(k)
    }
    seen.sort();for(let i=0;i<seen.length;i++)for(let j=i+1;j<seen.length;j++){const key=seen[i]+'|'+seen[j];pairCounts[key]=(pairCounts[key]||0)+1}
  }
  // CP4.168: one franchise-scoped replay read model for Stats, My Team,
  // Standings and Match Prep. Never sum kills across every team in the league.
  // The model keeps permanent forms (Mega, Z-Mega, Primal) separate.
  const shared=SBL.stats?.franchiseRosterData({[team]:currentRoster},games,teamFor)?.[team];
  if(shared){
    // Use the Stats module's form-aware identity for BOTH metrics and replay
    // evidence. Otherwise a display alias can leave a nonzero bring count
    // without the associated clicked moves, weeks and replay links.
    const allowed=new Set(shared.roster.map(x=>SBL.stats.identity(x.species)));
    const evidenceByIdentity=new Map();
    for(const evidence of Object.values(mons)){
      const identity=SBL.stats.identity(evidence.species);
      if(!allowed.has(identity))continue;
      const existing=evidenceByIdentity.get(identity);
      if(existing)mergeReplayEvidence(existing,evidence);
      else evidenceByIdentity.set(identity,cloneReplayEvidence(evidence));
    }
    for(const k of Object.keys(mons))delete mons[k];
    for(const row of shared.roster){
      const k=speciesKey(row.species);
      const retained=evidenceByIdentity.get(SBL.stats.identity(row.species));
      mons[k]=retained ? {...retained,species:row.species} :
        {species:row.species,appearances:0,kills:0,deaths:0,dealt:0,taken:0,replays:new Set(),gameSets:[],weeks:new Set(),items:{},confirmedItems:{},inferredItems:{},itemEvidence:{}};
      Object.assign(mons[k],{appearances:row.appearances,kills:row.kills,deaths:row.deaths,dealt:row.dealt,taken:row.taken});
    }
    Object.keys(pairCounts).forEach(k=>{const [x,y]=k.split('|');if(!mons[x]||!mons[y])delete pairCounts[k];});
  } else if(hasCurrentRoster(team)){
    const allowed=new Set(currentRoster.map(x=>speciesKey(rosterMonName(x))).filter(Boolean));
    Object.keys(mons).forEach(k=>{if(!allowed.has(speciesKey(mons[k].species)))delete mons[k]});
    Object.keys(pairCounts).forEach(k=>{const [x,y]=k.split('|');if(!allowed.has(x)||!allowed.has(y))delete pairCounts[k]});
  }
  return {games,wins,losses:Math.max(0,games.length-wins),mons,pairCounts}
}
function aggregate(team){
  const key=teamKey(team);
  if(TEAM_AGGREGATE_CACHE.has(key))return TEAM_AGGREGATE_CACHE.get(key);
  const value=aggregateUncached(team);
  if(TEAM_AGGREGATE_CACHE.size>=36)TEAM_AGGREGATE_CACHE.delete(TEAM_AGGREGATE_CACHE.keys().next().value);
  TEAM_AGGREGATE_CACHE.set(key,value);
  return value;
}
function formatGameDate(v){if(!v)return 'N/A';const d=new Date(v);return Number.isNaN(d.getTime())?'N/A':d.toLocaleDateString()}
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

// PokeAPI knows many newer Mega forms by numeric form ID even when its
// species-name endpoint or Showdown's current Pokedex has no matching entry.
// Always resolve the exact Mega ID before trying a less specific species.
function exactMegaApiId(species){
  return window.SBL?.pokemon?.megaPokeapiId?.(species)||null;
}
function matchPrepApiCandidates(species){
  const id=exactMegaApiId(species);
  return [...(id?[String(id)]:[]),...pokemonDexCandidates(species)];
}
// The legacy fallback is shared by Speed, scouting and move selectors.
// Cache both completed and in-flight requests rather than fetching the same
// full PokéAPI species payload again each time the team is switched.
const POKEAPI_REQUEST_CACHE=new Map();
async function requestPokemonApi(slug){
  const key=String(slug||'').trim().toLowerCase();
  if(!key)return null;
  const hit=POKEAPI_REQUEST_CACHE.get(key);
  if(hit && hit.until>Date.now())return hit.promise;
  const promise=(async()=>{
    try{
      const r=await fetch('https://pokeapi.co/api/v2/pokemon/'+encodeURIComponent(key),{cache:'force-cache'});
      return r.ok?await r.json():null;
    }catch(_){return null;}
  })();
  if(POKEAPI_REQUEST_CACHE.size>=100)POKEAPI_REQUEST_CACHE.delete(POKEAPI_REQUEST_CACHE.keys().next().value);
  POKEAPI_REQUEST_CACHE.set(key,{promise,until:Date.now()+2*60*1000});
  return promise;
}

async function fetchBaseSpeed(species){
  const key=norm(canonicalSpecies(species));
  if(SPEED_CACHE.has(key))return SPEED_CACHE.get(key);
  // The SAME exact-form profile supplies the analyser's speed, typing and
  // damage inputs. Never use base-species speed for an unsupported Mega.
  const profile=await fetchPokemonData(species);
  let value=Number(profile?.stats?.speed);
  if(!profile || !Number.isFinite(value) || value<=0){
    value=isProtectedBattleForm(species)?null:baseSpeedForSpecies(species);
  }
  SPEED_CACHE.set(key,value);
  return value;
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
  // Franchise definitions remain authoritative even on a brand-new season
  // that has no published rosters or indexed replays yet.
  return [...new Map([...replayTeams,...rosterTeams,...STATE.franchiseNames].filter(Boolean).map(t=>[teamKey(t),t])).values()].sort((a,b)=>a.localeCompare(b));
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
  const unique = [...new Map(names.map(x=>[speciesKey(x),x])).values()];
  // Battle-only formes (Aegislash Blade, Mimikyu Busted, etc.) are internal
  // replay representations, not separate roster Pokémon. If they resolve to
  // the same canonical species, only show the canonical name.
  return unique[0] || String(m?.species || '');
}


async function franchiseMonsUncached(team){
  // Match Prep operates on one row per current-roster species.
  // Do not use groupEquivalentVariants here: that function intentionally groups
  // Pokémon with identical speed signatures, which can incorrectly merge two
  // completely different species (and makes matchup rows disappear).
  const source=aggregate(team).mons;
  const merged=new Map();
  for(const m of Object.values(source)){
    const species=canonicalSpecies(m.species);
    const key=speciesKey(species);
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

async function franchiseMons(team){
  const key=teamKey(team);
  if(TEAM_MON_CACHE.has(key))return TEAM_MON_CACHE.get(key);
  const pending=franchiseMonsUncached(team);
  if(TEAM_MON_CACHE.size>=36)TEAM_MON_CACHE.delete(TEAM_MON_CACHE.keys().next().value);
  TEAM_MON_CACHE.set(key,pending);
  try{return await pending;}catch(error){if(TEAM_MON_CACHE.get(key)===pending)TEAM_MON_CACHE.delete(key);throw error;}
}

// All matchup calculations now use the shared service; no page-local chart.
const MATCHUPS=window.SBL?.matchups;
if(!MATCHUPS)throw new Error('Matchup engine unavailable.');
const TYPE_NAMES=MATCHUPS.types;
const normalizedTypes=MATCHUPS.normalizedTypes;
const typeChartMultiplier=MATCHUPS.multiplier;
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
const POKEMON_DATA_PENDING=new Map();
const MATCHUP_BUNDLE_CACHE=new Map();
function isProtectedBattleForm(species){
  const slug=String(window.SBL?.domain?.pokemonKey?.(species)||spriteId(species)||'').toLowerCase();
  return /(?:-mega(?:-[xyz])?|-primal|-hisui|-galar|-alola|-therian|-origin|-crowned|-terastal|-stellar|-battle-bond|-blaze|-combat|-aqua)$/.test(slug)
    || /^(?:mega-|primal-)/.test(slug);
}
async function exactCatalogueBundle(species){
  const key=speciesKey(species);
  if(MATCHUP_BUNDLE_CACHE.has(key))return MATCHUP_BUNDLE_CACHE.get(key);
  if(!window.SBL.pokemonCatalog?.getMatchupBundle)return null;
  try{
    const bundle=await window.SBL.pokemonCatalog.getMatchupBundle(species);
    MATCHUP_BUNDLE_CACHE.set(key,bundle||null);
    return bundle||null;
  }catch(error){
    console.warn('Central matchup catalogue unavailable for',species,error);
    return null;
  }
}
async function exactCatalogueProfile(species){
  const bundle=await exactCatalogueBundle(species);
  if(bundle?.profile)return bundle.profile;
  if(!window.SBL.pokemonCatalog?.getBattleProfile)return null;
  try{return await window.SBL.pokemonCatalog.getBattleProfile(species);}
  catch(error){
    console.warn('Exact-form catalogue profile unavailable for',species,error);
    return null;
  }
}
function showdownProfileCandidates(species){
  const list=exactMegaApiId(species) && window.SBL.pokemon?.showdownStatsIdCandidates
    ? window.SBL.pokemon.showdownStatsIdCandidates(species)
    : showdownDexCandidates(species);
  if(!isProtectedBattleForm(species))return list;
  const id=window.SBL.domain?.pokemonCatalogId?.(species)||spriteId(species).replace(/[^a-z0-9]/g,'');
  // A missing exact form is UNAVAILABLE, never the base Pokémon's data.
  return list.filter(x=>String(x).toLowerCase().replace(/[^a-z0-9]/g,'')===id);
}
function apiProfileCandidates(species){
  const numeric=exactMegaApiId(species);
  if(numeric)return [String(numeric)];
  const list=pokemonDexCandidates(species);
  return isProtectedBattleForm(species)?list.filter(x=>String(x).replace(/[^a-z0-9]/g,'')===window.SBL.domain.pokemonCatalogId(species)):list;
}
async function loadPokemonData(species){
  const bundle=await exactCatalogueBundle(species);
  const canonical=bundle?.profile || await exactCatalogueProfile(species);
  if(canonical)return {stats:canonical.stats,types:canonical.types,abilities:canonical.abilities,
    source:canonical.source,version:canonical.version,identity:bundle?.identity||SBL.domain?.pokemonKey?.(species)||species,
    profileSource:bundle?.profileSource||canonical.source,moveSource:bundle?.moveSource||'unavailable',moveVersion:bundle?.moveVersion||''};
  const dex=await loadShowdownDex();
  if(dex){
    for(const slug of showdownProfileCandidates(species)){
      const d=dex[slug];
      if(!d?.baseStats && !d?.types && !d?.abilities)continue;
      const bs=d.baseStats||{};
      return {
        stats:{hp:bs.hp,attack:bs.attack??bs.atk,defense:bs.defense??bs.def,
          'special-attack':bs['special-attack']??bs.spa,
          'special-defense':bs['special-defense']??bs.spd,speed:bs.speed??bs.spe},
        types:(d.types||[]).map(String),abilities:Object.values(d.abilities||{}).map(String).filter(Boolean),
        source:'showdown-exact-form'
      };
    }
  }
  for(const slug of apiProfileCandidates(species)){
    const d=await requestPokemonApi(slug);
    if(!d)continue;
    return {
      stats:Object.fromEntries((d.stats||[]).map(x=>[x.stat?.name,x.base_stat]).filter(x=>x[0])),
      types:(d.types||[]).slice().sort((a,b)=>a.slot-b.slot).map(x=>x.type?.name).filter(Boolean),
      abilities:(d.abilities||[]).map(x=>x.ability?.name).filter(Boolean),source:'pokeapi-exact-form'
    };
  }
  return null;
}
async function fetchPokemonData(species){
  const key=speciesKey(species);
  if(POKEMON_DATA_CACHE.has(key))return POKEMON_DATA_CACHE.get(key);
  if(POKEMON_DATA_PENDING.has(key))return POKEMON_DATA_PENDING.get(key);
  const pending=loadPokemonData(species);
  POKEMON_DATA_PENDING.set(key,pending);
  try{
    const value=await pending;
    POKEMON_DATA_CACHE.set(key,value);
    return value;
  }finally{
    if(POKEMON_DATA_PENDING.get(key)===pending)POKEMON_DATA_PENDING.delete(key);
  }
}
async function fetchTypes(species){
  const key=speciesKey(species);
  if(TYPE_CACHE.has(key))return TYPE_CACHE.get(key);
  // Share the same form-level read with scouting and damage analysis. This
  // eliminates a separate Pokédex/PokeAPI waterfall for every type tile.
  const data=await fetchPokemonData(species);
  const types=normalizedTypes(data?.types||[]);
  TYPE_CACHE.set(key,types);
  return types;
}

function typePills(types){return types.length?`<div class="type-row">${types.map(t=>`<span class="type-pill type-${esc(t)}">${esc(t)}</span>`).join('')}</div>`:'<div class="type-row"><span class="type-pill type-unknown">Type unknown</span></div>'}
function typePill(type){const t=String(type||'').trim();return t?`<span class="type-pill type-${esc(t)}">${esc(t)}</span>`:''}
function combinedMultiplier(attackingTypes,defendingTypes){return MATCHUPS.bestStabMultiplier(attackingTypes,defendingTypes)}
function defensiveMultiplier(attackingType,defendingTypes){return MATCHUPS.defense(attackingType,defendingTypes)}
function defensiveTypeEffectiveness(types){return MATCHUPS.defensiveEffectiveness(types)}
function matchupLabel(mult){if(mult===null)return ['Unknown','matchup-neutral'];if(mult>=4)return ['Extremely effective','matchup-good'];if(mult>=2)return ['Super effective','matchup-good'];if(mult===0)return ['Immune','matchup-bad'];if(mult<=.25)return ['Highly resisted','matchup-bad'];if(mult<=.5)return ['Resisted','matchup-bad'];return ['Neutral','matchup-neutral']}
function scoutingEffectiveness(mult){if(mult===null)return 'Unknown';if(mult>=4)return 'Extremely effective';if(mult>=2)return 'Super effective';if(mult===0)return 'Immune';if(mult<=.25)return 'Highly resisted';if(mult<=.5)return 'Resisted';return 'Neutral'}
function fmtMult(v){if(v===null)return '?';if(v===0)return '0×';if(v===.25)return '¼×';if(v===.5)return '½×';return Number.isInteger(v)?v+'×':v.toFixed(2)+'×'}
function moveKey(s){return norm(s).replace(/[^a-z0-9]/g,'')}
const ROLE_RULES=[
  ['Stealth Rock',['stealthrock']],
  ['Spikes',['spikes']],
  ['Toxic Spikes',['toxicspikes']],
  ['Hazard remover',['rapidspin','defog','mortalspin']],
  ['Setup sweeper',['swordsdance','nastyplot','dragondance','quiverdance','calmmind','bulkup','agility','shellsmash','shiftgear','autotomize','curse','workup','tailglow','filletaway']],
  ['Sticky Webs',['stickyweb']],
  ['Status spreader',['willowisp','thunderwave','toxic','spore','sleeppowder','stunspore','glare','yawn']],
  ['Pivot',['uturn','voltswitch','flipturn','partingshot','teleport']],
  ['Screens',['reflect','lightscreen','auroraveil']],
  ['Recovery',['recover','roost','slackoff','softboiled','wish','moonlight','morningsun','synthesis','shoreup','rest']],
  ['Physical attacker',['closecombat','earthquake','flareblitz','bravebird','stoneedge','knockoff','crunch','ironhead','playrough','liquidation','drainpunch','machpunch','suckerpunch','bulletpunch']],
  ['Special attacker',['fireblast','flamethrower','hydropump','surf','icebeam','thunderbolt','thunder','shadowball','darkpulse','psychic','psychic','moonblast','energyball','gigadrain','makeitrain','dracometeor','dragonpulse']],
];
function inferRoles(m){const moves=new Set((m.gameSets||[]).flatMap(g=>g.moves||[]).map(moveKey));const roles=[];for(const [role,keys] of ROLE_RULES){if(keys.some(k=>moves.has(k)))roles.push(role)}const abilities=(m.abilities||[]).map(a=>String(typeof a==='string'?a:(a?.name||''))).join(' ').toLowerCase();if(/drizzle|drought|sand stream|snow warning|desolate land|primordial sea|orichalcum pulse/.test(abilities))roles.push('Weather Setter');if(/electric surge|grassy surge|psychic surge|misty surge/.test(abilities))roles.push('Terrain Setter');return [...new Set(roles)].length?[...new Set(roles)]:['Unclassified'];}
function aggregateMoveCounts(mons){const counts={};for(const m of mons)for(const g of m.gameSets||[])for(const move of g.moves||[]){const k=String(move).trim();if(!k)continue;counts[k]=(counts[k]||0)+1}return counts}
function pct(n,d){return d?Math.round(n/d*100):0}

function roleDescription(role){
  return {
    'Stealth Rock':'Can set Stealth Rock to punish opposing switches.',
    'Spikes':'Can set Spikes to damage grounded Pokémon as they switch in.',
    'Toxic Spikes':'Can set Toxic Spikes to poison opposing grounded Pokémon.',
    'Sticky Webs':'Can set Sticky Web to lower the Speed of opposing grounded Pokémon.',
    'Hazard remover':'Likely focused on removing hazards while preserving momentum.',
    'Setup sweeper':'Likely focused on boosting and converting a free turn into a sweep.',
    
    'Status spreader':'Likely focused on spreading debilitating status conditions.',
    'Pivot':'Likely focused on gaining momentum through forced switches.',
    'Screens':'Likely focused on team support through screen effects.',
    'Recovery':'Likely built to stay healthy and repeatedly enter the field.',
    'Weather Setter':'Uses an ability to establish weather for the team.',
    'Terrain Setter':'Uses an ability to establish terrain for the team.',
    'Physical attacker':'Likely uses physical damage as its main offensive route.',
    'Special attacker':'Likely uses special damage as its main offensive route.',
    'Unclassified':'No clear role could be inferred from the recorded moves.'
  }[role]||'Role inferred from the Pokémon’s recorded moves.';
}
function observedMoves(m){
  // Older summaries store moves as {name:count}; newer parsers may use arrays.
  // Never stringify an entire move map into the bogus move '[object Object]'.
  return [...new Set((m.gameSets||[]).flatMap(g=>Array.isArray(g.moves)?g.moves:Object.keys(g.moves||{}))
    .map(x=>String(x?.name||x||'').trim()).filter(Boolean))];
}
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


function matchupNoteWeek(team, opponent){
  const rounds=Array.isArray(STATE.settings?.fixture?.rounds)?STATE.settings.fixture.rounds:[];
  const same=(a,b)=>teamKey(a)===teamKey(b);
  const played=(week,home,away)=>Object.values(STATE.replays||{}).some(r=>{
    if(!r || String(r.week||'Unassigned')!==String(week) || !r.players)return false;
    const a=teamFor(r.players.p1),b=teamFor(r.players.p2);
    return (same(a,home)&&same(b,away))||(same(a,away)&&same(b,home));
  });
  let historicalMatch='';
  for(const round of rounds){
    for(const match of (round.matches||[])){
      if(!((same(match.home,team)&&same(match.away,opponent))||(same(match.away,team)&&same(match.home,opponent))))continue;
      const week=String(round.week||'Unassigned');
      if(!played(week,match.home,match.away))return week;
      if(!historicalMatch)historicalMatch=week;
    }
  }
  if(historicalMatch)return historicalMatch;
  const weeks=Object.values(STATE.replays||{}).map(r=>String(r?.week||'').trim()).filter(Boolean);
  if(weeks.length){
    weeks.sort((a,b)=>{const na=Number(String(a).replace(/[^0-9.-]/g,'')),nb=Number(String(b).replace(/[^0-9.-]/g,''));if(Number.isFinite(na)&&Number.isFinite(nb))return nb-na;return b.localeCompare(a,undefined,{numeric:true});});
    return weeks[0];
  }
  return 'Unassigned';
}
function notesWeekLabel(week){
  const raw=String(week||'Unassigned');
  return /^\d+$/.test(raw)?`Week ${raw}`:raw;
}

async function renderMatchPrep(yourTeam, selectedOpponent, intelBridge){
  const names=teamNames();
  const opponent=selectedOpponent && !sameTeam(selectedOpponent,yourTeam)
    ? selectedOpponent
    : (names.find(n=>!sameTeam(n,yourTeam))||'');
  if(!opponent){
    return `<section class="panel"><h2>Match Prep</h2><p class="panel-desc">Choose an opponent franchise to start preparing for the match.</p><div class="empty">No opposing franchise is available.</div></section>`;
  }
  // One catalogue request for both rosters, before any per-Pokémon helpers run.
  // An unpopulated/offline catalogue still permits existing verified sources.
  if(window.SBL.pokemonCatalog?.preloadBattleProfiles){
    try{
      const species=[...Object.values(aggregate(yourTeam).mons),...Object.values(aggregate(opponent).mons)].map(m=>m.species);
      await window.SBL.pokemonCatalog.preloadBattleProfiles(species);
    }catch(error){console.warn('Central catalogue preload unavailable; exact-form fallbacks remain guarded.',error);}
  }
  const [your,opp]=await Promise.all([franchiseMons(yourTeam),franchiseMons(opponent)]);
  const all=[...your,...opp];
  const typePairs=await Promise.all(all.map(async m=>[m.species,await fetchTypes(m.species)]));
  const typeMap=Object.fromEntries(typePairs);
  const matchupWeek=matchupNoteWeek(yourTeam,opponent);
  // Notes are lazy-loaded when the card is opened so team/opponent/section
  // selectors never wait on a separate notes-history request.
  const matchupNote=null;
  const matchupNotes=[];
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
  const usageFor=m=>{
    // The displayed Pokémon has already been resolved by the central
    // form-aware franchiseRosterData projection. Do not try a different Mega
    // or Primal form when a particular species has zero appearances.
    const exact=opponentAggregate.mons[speciesKey(m.species)];
    return exact||m||{appearances:0,kills:0,deaths:0,dealt:0,taken:0,replays:new Set(),gameSets:[],weeks:new Set(),items:{},confirmedItems:{},inferredItems:{},itemEvidence:{}};
  };

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
      <div class="prep-card-section"><span>Likely roles</span><div class="prep-chip-row">${roleDisplayList(roles).length?roleDisplayList(roles).map(x=>`<span class="prep-chip">${esc(x)}</span>`).join(''):'<span class="small">Unclear</span>'}</div></div>
      <div class="prep-card-section"><span>Point value</span><div class="small">${info?.points!==''&&info?.points!=null?esc(info.points)+' pts':'Point value unavailable'}</div></div>
    </div>
    <div class="prep-card-section"><span>Type effectiveness</span>${group('Weaknesses',weaknesses)}${group('Resistances',resistances)}${group('Immunities',immunities)}</div>
    <div class="prep-card-section"><span>Base stats</span><div class="prep-stat-grid">${[['hp','HP'],['attack','Atk'],['defense','Def'],['special-attack','SpA'],['special-defense','SpD'],['speed','Spe']].map(([k,l])=>`<span class="prep-chip">${l}: ${baseStats[k]??'N/A'}</span>`).join('')}</div></div>`;
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
    const weekSections=broughtInWeeks.length?broughtInWeeks.map((w,i)=>{const st=weekStats.get(String(w))||{moves:{},items:{},led:0,sentOut:0};const ms=Object.entries(st.moves).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const its=Object.entries(st.items).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const led=Number(st.led||0)>0&&Number(st.sentOut||0)>0;const sent=Number(st.sentOut||0)>0;const status=led?'Led · Sent out':sent?'Sent out':'Brought only';const moveUses=ms.reduce((a,x)=>a+Number(x[1]||0),0);const itemUses=its.reduce((a,x)=>a+Number(x[1]||0),0);return `<article class="prep-analysis-week" data-week-pane="${esc(w)}" ${i?'hidden':''}><div class="prep-analysis-week-head"><div><strong>${esc(weekLabel(w))}</strong><small>${status}</small></div><span class="prep-week-status-dot ${led?'is-led':sent?'is-sent':'is-brought'}"></span></div><div class="prep-analysis-week-stats"><span><b>${moveUses}</b> move uses</span><span><b>${itemUses}</b> item records</span></div><div class="prep-analysis-columns"><div><div class="prep-analysis-subhead">Moves clicked</div>${usageRows(ms,'moves',moveUses)}</div><div><div class="prep-analysis-subhead">Items held</div>${usageRows(its,'items',itemUses)}</div></div></article>`;}).join(''):'<div class="small">No round-by-round move evidence available. A confirmed bring can exist without an observed move.</div>';
    const weekButtons=broughtInWeeks.map((w,i)=>`<button type="button" class="prep-analysis-week-btn${i?'':' active'}" data-prep-week-btn="${esc(w)}" aria-pressed="${i?'false':'true'}">${esc(weekLabel(w))}</button>`).join('');
    const matchupItems=goodInto.length?goodInto.map(x=>`<span class="prep-chip">${esc(displaySpecies(x))}</span>`).join(''):'<span class="small">No clear type advantage</span>';
    const analysisHtml=`<div class="matchprep-analysis-overview">
      <section class="prep-analysis-season">
        <div class="prep-analysis-section-head"><div><span class="prep-analysis-eyebrow">Season overview</span><h3>How ${esc(displaySpecies(m))} has been used</h3><p>All recorded battles for this season. <strong>Brought</strong> means included in the submitted team; <strong>Sent Out</strong> means it actually entered battle.</p></div></div>
        <div class="prep-analysis-summary-grid"><div class="prep-analysis-stat"><span>Brought</span><strong>${broughtTotal}</strong><small>submitted teams</small></div><div class="prep-analysis-stat"><span>Led</span><strong>${ledTotal}</strong><small>battle starts</small></div><div class="prep-analysis-stat"><span>Sent out</span><strong>${sentOutTotal}</strong><small>field appearances</small></div></div>
        <div class="prep-analysis-overview-grid">
          <section class="prep-analysis-table-card"><div class="prep-analysis-card-head"><div><h4>Moves actually observed</h4><small>Each count is a replay where the move was used. Unclicked moves cannot be inferred from a battle replay.</small></div><strong>${Object.values(seasonMovesBrought).reduce((a,b)=>a+Number(b||0),0)}</strong></div><div class="prep-analysis-list">${usageRows(sortedMoveBroughtEntries,'moves',broughtInWeeks.length||1)}</div></section>
          <section class="prep-analysis-table-card"><div class="prep-analysis-card-head"><div><h4>Items held</h4><small>Items actually recorded on this Pokémon</small></div><strong>${totalItemUses===1&&Object.keys(usage.items||{}).length===0?0:totalItemUses}</strong></div><div class="prep-analysis-list">${usageRows(sortedItemEntries,'items')}</div></section>
        </div>
        <div class="prep-analysis-extra-grid"><div class="prep-analysis-mini-card"><span>Strong into ${opponent}</span><div class="prep-chip-row">${matchupItems}</div></div><div class="prep-analysis-mini-card"><span>Likely roles</span><div class="prep-chip-row">${roleDisplayList(roles).length?roleDisplayList(roles).map(x=>`<span class="prep-chip">${esc(x)}</span>`).join(''):'<span class="small">Unclear</span>'}</div></div></div>
      </section>
      <section class="prep-analysis-weeks-section"><div class="prep-analysis-section-head"><div><span class="prep-analysis-eyebrow">Weekly breakdown</span><h3>Usage by week</h3><p>Select a week to view its usage without scrolling through the entire season.</p></div><div class="prep-analysis-week-buttons" role="group" aria-label="Select week">${weekButtons}</div></div><div class="prep-analysis-weeks">${weekSections}</div></section>
    </div>`;
    const threat=goodInto.length?`Strong into ${goodInto.length} Pokémon`:'No clear type advantage';
    const tc=goodInto.length?'matchup-bad':'matchup-neutral';
    return `<article class="prep-opponent-card prep-opponent-popout" data-prep-popout="${esc(m.species)}" data-prep-team="opponent"><button type="button" class="prep-popout-trigger legacy-mon-card"><span class="mon-head">${sprite(m.species,'prep-sprite')}<span><span class="mon-name prep-legacy-name"><strong>${esc(displaySpecies(m))}</strong><span class="prep-inline-types">${effTypes.map(t=>typePill(t)).join('')}</span></span><span class="muted">Brought ${usage.appearances||0} time${Number(usage.appearances||0)===1?'':'s'} · ${usage.replays?.size||0} replay link${(usage.replays?.size||0)===1?'':'s'}</span></span></span><span class="chips prep-legacy-chips"><span class="chip"><b>${usage.kills||0}</b> K</span><span class="chip"><b>${usage.deaths||0}</b> D</span><span class="chip"><b>${Number(usage.dealt||0).toFixed(0)}</b> dmg</span></span><span class="small prep-legacy-threat">${esc(threat)}</span></button><div class="prep-popout-data" hidden data-usage="${esc(usageHtml)}" data-scouting="${esc(scoutingHtml)}" data-analysis="${esc(analysisHtml)}" data-appearances="${usage.appearances||0}" data-kills="${usage.kills||0}" data-deaths="${usage.deaths||0}" data-dealt="${Number(usage.dealt||0).toFixed(0)}" data-taken="${Number(usage.taken||0).toFixed(0)}"></div></article>`;
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
      <div class="prep-card-section"><span>Likely roles</span><div class="prep-chip-row">${roleDisplayList(roles).length?roleDisplayList(roles).map(x=>`<span class="prep-chip">${esc(x)}</span>`).join(''):'<span class="small">Unclear</span>'}</div></div>
      <div class="prep-card-section"><span>Point value</span><div class="small">${info?.points!==''&&info?.points!=null?esc(info.points)+' pts':'Point value unavailable'}</div></div>
    </div>
    <div class="prep-card-section"><span>Type effectiveness</span>${group('Weaknesses',weaknesses)}${group('Resistances',resistances)}${group('Immunities',immunities)}</div>
    <div class="prep-card-section"><span>Base stats</span><div class="prep-stat-grid">${[['hp','HP'],['attack','Atk'],['defense','Def'],['special-attack','SpA'],['special-defense','SpD'],['speed','Spe']].map(([k,l])=>`<span class="prep-chip">${l}: ${baseStats[k]??'N/A'}</span>`).join('')}</div></div>`;
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
    const weekSections=broughtInWeeks.length?broughtInWeeks.map((w,i)=>{const st=weekStats.get(String(w))||{moves:{},items:{},led:0,sentOut:0};const ms=Object.entries(st.moves).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const its=Object.entries(st.items).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const led=Number(st.led||0)>0&&Number(st.sentOut||0)>0;const sent=Number(st.sentOut||0)>0;const status=led?'Led · Sent out':sent?'Sent out':'Brought only';const moveUses=ms.reduce((a,x)=>a+Number(x[1]||0),0);const itemUses=its.reduce((a,x)=>a+Number(x[1]||0),0);return `<article class="prep-analysis-week" data-week-pane="${esc(w)}" ${i?'hidden':''}><div class="prep-analysis-week-head"><div><strong>${esc(weekLabel(w))}</strong><small>${status}</small></div><span class="prep-week-status-dot ${led?'is-led':sent?'is-sent':'is-brought'}"></span></div><div class="prep-analysis-week-stats"><span><b>${moveUses}</b> move uses</span><span><b>${itemUses}</b> item records</span></div><div class="prep-analysis-columns"><div><div class="prep-analysis-subhead">Moves clicked</div>${usageRows(ms,'moves',moveUses)}</div><div><div class="prep-analysis-subhead">Items held</div>${usageRows(its,'items',itemUses)}</div></div></article>`;}).join(''):'<div class="small">No round-by-round move evidence available. A confirmed bring can exist without an observed move.</div>';
    const weekButtons=broughtInWeeks.map((w,i)=>`<button type="button" class="prep-analysis-week-btn${i?'':' active'}" data-prep-week-btn="${esc(w)}" aria-pressed="${i?'false':'true'}">${esc(weekLabel(w))}</button>`).join('');
    const matchupItems=strongInto.length?strongInto.map(x=>`<span class="prep-chip">${esc(displaySpecies(x))}</span>`).join(''):'<span class="small">No clear type advantage</span>';
    const analysisHtml=`<div class="matchprep-analysis-overview">
      <section class="prep-analysis-season">
        <div class="prep-analysis-section-head"><div><span class="prep-analysis-eyebrow">Season overview</span><h3>How ${esc(displaySpecies(m))} has been used</h3><p>All recorded battles for this season. <strong>Brought</strong> means included in the submitted team; <strong>Sent Out</strong> means it actually entered battle.</p></div></div>
        <div class="prep-analysis-summary-grid"><div class="prep-analysis-stat"><span>Brought</span><strong>${broughtTotal}</strong><small>submitted teams</small></div><div class="prep-analysis-stat"><span>Led</span><strong>${ledTotal}</strong><small>battle starts</small></div><div class="prep-analysis-stat"><span>Sent out</span><strong>${sentOutTotal}</strong><small>field appearances</small></div></div>
        <div class="prep-analysis-overview-grid">
          <section class="prep-analysis-table-card"><div class="prep-analysis-card-head"><div><h4>Moves actually observed</h4><small>Each count is a replay where the move was used. Unclicked moves cannot be inferred from a battle replay.</small></div><strong>${Object.values(seasonMovesBrought).reduce((a,b)=>a+Number(b||0),0)}</strong></div><div class="prep-analysis-list">${usageRows(sortedMoveBroughtEntries,'moves',broughtInWeeks.length||1)}</div></section>
          <section class="prep-analysis-table-card"><div class="prep-analysis-card-head"><div><h4>Items held</h4><small>Items actually recorded on this Pokémon</small></div><strong>${totalItemUses===1&&Object.keys(usage.items||{}).length===0?0:totalItemUses}</strong></div><div class="prep-analysis-list">${usageRows(sortedItemEntries,'items')}</div></section>
        </div>
        <div class="prep-analysis-extra-grid"><div class="prep-analysis-mini-card"><span>Strong into ${opponent}</span><div class="prep-chip-row">${matchupItems}</div></div><div class="prep-analysis-mini-card"><span>Likely roles</span><div class="prep-chip-row">${roleDisplayList(roles).length?roleDisplayList(roles).map(x=>`<span class="prep-chip">${esc(x)}</span>`).join(''):'<span class="small">Unclear</span>'}</div></div></div>
      </section>
      <section class="prep-analysis-weeks-section"><div class="prep-analysis-section-head"><div><span class="prep-analysis-eyebrow">Weekly breakdown</span><h3>Usage by week</h3><p>Select a week to view its usage without scrolling through the entire season.</p></div><div class="prep-analysis-week-buttons" role="group" aria-label="Select week">${weekButtons}</div></div><div class="prep-analysis-weeks">${weekSections}</div></section>
    </div>`;
    const threat=strongInto.length?`Strong into ${strongInto.length} Pokémon`:'No clear type advantage';
    const tc=strongInto.length?'matchup-good':'matchup-neutral';
    return `<article class="prep-opponent-card prep-opponent-popout" data-prep-popout="${esc(m.species)}" data-prep-team="your"><button type="button" class="prep-popout-trigger legacy-mon-card"><span class="mon-head">${sprite(m.species,'prep-sprite')}<span><span class="mon-name prep-legacy-name"><strong>${esc(displaySpecies(m))}</strong><span class="prep-inline-types">${effTypes.map(t=>typePill(t)).join('')}</span></span><span class="muted">Brought ${usage.appearances||0} time${Number(usage.appearances||0)===1?'':'s'} · ${usage.replays?.size||0} replay link${(usage.replays?.size||0)===1?'':'s'}</span></span></span><span class="chips prep-legacy-chips"><span class="chip"><b>${usage.kills||0}</b> K</span><span class="chip"><b>${usage.deaths||0}</b> D</span><span class="chip"><b>${Number(usage.dealt||0).toFixed(0)}</b> dmg</span></span><span class="small prep-legacy-threat">${esc(threat)}</span></button><div class="prep-popout-data" hidden data-usage="${esc(usageHtml)}" data-scouting="${esc(scoutingHtml)}" data-analysis="${esc(analysisHtml)}" data-appearances="${usage.appearances||0}" data-kills="${usage.kills||0}" data-deaths="${usage.deaths||0}" data-dealt="${Number(usage.dealt||0).toFixed(0)}" data-taken="${Number(usage.taken||0).toFixed(0)}"></div></article>`;
  }))).join('');

  // -------- Defensive / Offensive Type Chart & Team Coverage Chart --------
  // Both built from YOUR roster's typing (via typeMap, already fetched above).
  // Defensive: how each of your Pokémon takes each attacking type.
  // Offensive: the best multiplier each of your Pokémon can land on each
  // defending type, assuming a same-type (STAB) move - a simple, move-data-free
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
    <tbody>${rows.length?rows.map(r=>`<tr><th><div class="tc-row-mon">${sprite(r.mon.species,'tc-row-sprite')}<span>${esc(displaySpecies(r.mon))}</span></div></th>${r[cellsKey].map(mult=>`<td class="${cellClassFn(mult)}"><span>${mult===null?'N/A':fmtMult(mult)}</span></td>`).join('')}</tr>`).join(''):`<tr><td colspan="${TYPE_NAMES.length+1}"><div class="empty">No Pokémon on your current roster yet.</div></td></tr>`}</tbody>
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
  // super-effective damage. This uses central catalogue move candidates rather than assuming a Pokémon's
  // typing equals its movepool. Candidates are not format-legality proof.
  const coverageMoveCache=PREP_COVERAGE_MOVE_CACHE;
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
    const key=speciesKey(species);
    if(coverageMoveCache.has(key))return coverageMoveCache.get(key);
    // Shared, versioned move catalogue is the preferred source for both
    // coverage and Switch-In. Avoid hundreds of individual PokeAPI requests.
    if(window.SBL.pokemonCatalog?.getMatchupBundle){
      try{
        const bundle=await exactCatalogueBundle(species);
        if(bundle?.moves?.length){
          const moves=bundle.moves.map(m=>({...m,type:String(m.type||'').replace(/\b\w/g,c=>c.toUpperCase()),
            evidence:'catalogued',rulesetVerified:false,source:m.source||bundle.moveSource||'global-catalogue'}));
          coverageMoveCache.set(key,moves);return moves;
        }
      }catch(error){console.warn('Central move catalogue unavailable; trying a labelled fallback.',error);}
    }else if(window.SBL.pokemonCatalog?.getDamagingLearnset){
      try{
        const result=await window.SBL.pokemonCatalog.getDamagingLearnset(species);
        if(result?.moves?.length){
          const moves=result.moves.map(m=>({...m,type:String(m.type||'').replace(/\b\w/g,c=>c.toUpperCase()),evidence:'catalogued',rulesetVerified:false}));
          coverageMoveCache.set(key,moves);return moves;
        }
      }catch(error){console.warn('Move catalogue unavailable; trying a labelled fallback.',error);}
    }
    let raw=[];
    const megaId=exactMegaApiId(species);
    // Unversioned custom Z-Mega rulesets are not interchangeable with the
    // base species. Never show a guessed candidate movepool when exact-form data is missing.
    if(/-mega-z$/.test(SBL.domain?.pokemonKey?.(species)||'')){
      coverageMoveCache.set(key,[]);return [];
    }
    // A Mega ordinarily inherits its base species' learnset. Query its own
    // form first for newer moves, then the base species only for moves.
    // Mega forms use the base species learnset if the form has no distinct
    // movepool. Do not accidentally try the generic token "mega" as a species.
    const canonical=window.SBL?.pokemon?.normalizeName?.(species)||String(species||'').toLowerCase();
    const megaBase=canonical.match(/^mega-(.+?)(?:-[xyz])?$/)?.[1]
      ||canonical.match(/^(.+?)-mega(?:-[xyz]|[xyz])?$/)?.[1]
      ||null;
    const moveSlugs=[...(megaId?[String(megaId)]:[]),
      ...(megaBase?coverageDexSlug(megaBase):coverageDexSlug(species))];
    for(const slug of moveSlugs){
      const d=await requestPokemonApi(slug);
      if(!d)continue;
      raw=(d.moves||[]).map(x=>({name:x.move?.name,url:x.move?.url})).filter(x=>x.name&&x.url);
      if(raw.length)break;
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
            type,category,power,source:'pokeapi-fallback',evidence:'catalogued',rulesetVerified:false
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
  const tentativeForm=window.SBL?.matchupIntelligence?.unverifiedCustomForm?.({species:coverageSelected});
  const observedCoverageKeys=new Set(observedMoves(your.find(m=>speciesKey(m.species)===speciesKey(coverageSelected))||{}).map(moveKey));
  const offensiveCoverageMoves=coverageMoves.filter(m=>!window.SBL?.matchupIntelligence?.isConditionalMove?.(m))
    .filter(m=>!tentativeForm||observedCoverageKeys.has(moveKey(m.name)));
  const selectedCoverageObj=your.find(m=>norm(m.species)===norm(coverageSelected));
  const coverageIntel=window.SBL?.matchupIntelligence;
  const coverageObservedMoves=selectedCoverageObj?observedMoves(selectedCoverageObj):[];
  const coverageObservedKeys=new Set(coverageObservedMoves.map(move=>norm(move)));
  const coverageUnverifiedCustom=!!(selectedCoverageObj&&coverageIntel?.unverifiedCustomForm?.({species:selectedCoverageObj.species}));
  // Custom Mega-Z catalogue entries are not treated as usable attacks until
  // they are confirmed in a replay or the league-specific ruleset is verified.
  const assessableCoverageMoves=coverageUnverifiedCustom
    ?offensiveCoverageMoves.filter(move=>coverageObservedKeys.has(norm(move.name))):offensiveCoverageMoves;
  const coverageAttacker=selectedCoverageObj?{
    species:selectedCoverageObj.species,types:typeMap[selectedCoverageObj.species]||[],
    stats:POKEMON_DATA_CACHE.get(speciesKey(selectedCoverageObj.species))?.stats||{},
    candidateMoves:assessableCoverageMoves,observedMoves:coverageObservedMoves
  }:null;
  // One pair evaluation per opposing Pokémon supplies the same physical/special,
  // STAB, type and exact-form baseline used by Team Planner and Threat Board.
  const coverageOutcome=new Map(coverageAttacker&&coverageIntel?coverageOpp.map(mon=>{
    const defender={species:mon.species,types:typeMap[mon.species]||[],
      stats:POKEMON_DATA_CACHE.get(speciesKey(mon.species))?.stats||{}};
    return [speciesKey(mon.species),coverageIntel.pair(coverageAttacker,defender)];
  }):[]);
  const coverageRows=(()=>{
    const byType=new Map();
    assessableCoverageMoves.forEach(move=>{
      const type=SBL.matchups?.normalizeTypeName?.(move.type)||String(move.type||'');
      if(!type)return;
      if(!byType.has(type))byType.set(type,[]);
      byType.get(type).push(move);
    });
    return [...byType.entries()].map(([type,moves])=>{
      const typeTargets=[],targets=[],unassessedTargets=[];
      coverageOpp.forEach(mon=>{
        const pair=coverageOutcome.get(speciesKey(mon.species));
        const attacks=(pair?.attacks||[]).filter(attack=>
          SBL.matchups?.normalizeTypeName?.(attack.type)===type &&
          !['conditional','ruleset-unverified','observed-untyped','typing-only'].includes(attack.evidence) &&
          Number(attack.multiplier)>=2
        ).sort((a,b)=>(b.estimatedPercent??-1)-(a.estimatedPercent??-1)||
          (b.multiplier??-1)-(a.multiplier??-1));
        if(!attacks.length)return;
        const best=attacks[0];
        const row={mon,move:best.name,multiplier:best.multiplier,estimatedPercent:best.estimatedPercent,
          category:best.category,evidence:best.evidence};
        typeTargets.push(row);
        if(best.estimatedPercent!==null && best.estimatedPercent>=20)targets.push(row);
        else if(best.estimatedPercent===null)unassessedTargets.push(row);
      });
      moves.sort((a,b)=>Number(b.power||0)-Number(a.power||0)||a.name.localeCompare(b.name));
      return {type,moves,typeTargets,targets,unassessedTargets};
    }).sort((a,b)=>b.targets.length-a.targets.length||b.typeTargets.length-a.typeTargets.length||TYPE_NAMES.indexOf(a.type)-TYPE_NAMES.indexOf(b.type));
  })();
  const coverageByMon=(()=>{
    const byMon=new Map();
    coverageRows.forEach(row=>row.typeTargets.forEach(target=>{
      const key=speciesKey(target.mon.species);
      const current=byMon.get(key)||{mon:target.mon,types:[],meaningfulTypes:[],unassessedTypes:[]};
      if(!current.types.includes(row.type))current.types.push(row.type);
      if(target.estimatedPercent!==null && target.estimatedPercent>=20 && !current.meaningfulTypes.includes(row.type))current.meaningfulTypes.push(row.type);
      if(target.estimatedPercent===null && !current.unassessedTypes.includes(row.type))current.unassessedTypes.push(row.type);
      byMon.set(key,current);
    }));
    return byMon;
  })();
  const superEffectiveTargets=[...coverageByMon.values()].filter(row=>row.meaningfulTypes.length)
    .sort((a,b)=>b.meaningfulTypes.length-a.meaningfulTypes.length||displaySpecies(a.mon).localeCompare(displaySpecies(b.mon)));
  const coverageEvidenceReady=assessableCoverageMoves.length>0;
  const coverageEvidenceHint=coverageUnverifiedCustom
    ?(coverageEvidenceReady?'Only replay-observed moves are scored for this custom Mega-Z form; other catalogue entries remain unverified.':'Custom Mega-Z move candidates are not verified for this league. Only moves confirmed in replays can be assessed.')
    :coverageEvidenceReady?'Catalogue candidates are possibilities, not confirmed moves this coach selected or proof of current-format legality. Estimates use both attacking and defending stats, move category and STAB.'
    :'Move evidence unavailable for this form or ruleset. Unknown coverage is not a safe matchup. Check the catalogue and selected season.';
  const typeGridChip=(type)=>{
    const row=coverageRows.find(r=>r.type===type);
    const meaningful=row?.targets.length||0;
    const typeOnly=row?.typeTargets.length||0;
    const covered=!!row;
    const cls=meaningful?'tc2-type-hot':typeOnly||covered?'tc2-type-warm':'tc2-type-cold';
    const title=meaningful?`${type}: meaningful super-effective baseline against ${meaningful} opponent${meaningful===1?'':'s'}`:
      typeOnly?`${type}: type advantage exists, but damage is low or unassessed against ${typeOnly} opponent${typeOnly===1?'':'s'}`:
      covered?`${type}: damaging candidate exists, but no super-effective target`:`${type}: no catalogued damaging candidate`;
    const monName=displaySpecies(selectedCoverageObj||{species:coverageSelected});
    const attrs=covered?` data-cov-type="${esc(type)}" data-cov-mon="${esc(monName)}" data-cov-moves="${esc(JSON.stringify(row.moves.map(m=>({name:m.name,category:m.category,power:m.power}))))}"`:'';
    const count=meaningful?meaningful:(typeOnly?'?':'');
    return `<div class="tc2-type-chip ${cls}${covered?' tc2-type-clickable':''}" title="${esc(title)}"${attrs}>${typePill(type)}${count?`<span class="tc2-type-count">${count}</span>`:''}</div>`;
  };
  const oppCard=(mon)=>{
    const hit=coverageByMon.get(speciesKey(mon.species));
    const assessed=coverageOutcome.get(speciesKey(mon.species));
    const value=assessed?.estimatedPercent??null;
    const state=value===null?'unknown':value>=45?'pressure':value>=20?'chip':'limited';
    const label=value===null?'Damage unassessed':value>=45?'Potential pressure':value>=20?'Chip possible':'Limited baseline';
    const detail=assessed?.best&&value!==null?`${assessed.best.name} (${assessed.best.category}) · ~${value}% baseline · ${assessed.evidence==='observed'?'observed in replay':'catalogue candidate'}`:
      (assessed?.reason||'No move could be assessed; unknown is not evidence of safety');
    const typeLabel=hit?.meaningfulTypes?.length?'Meaningful 2×+ options':hit?.types?.length?'Type advantage only; damage not established':'';
    const typePillsHtml=hit?.meaningfulTypes?.length?hit.meaningfulTypes:hit?.types||[];
    return `<div class="tc2-opp-card tc2-opp-${state}">
      <div class="tc2-opp-sprite-wrap">${sprite(mon.species,'tc2-opp-sprite')}</div>
      <div class="tc2-opp-name">${esc(displaySpecies(mon))}</div>
      <div class="tc2-opp-safe-label">${esc(label)}</div>
      <div class="tc2-opp-explanation">${esc(detail)}</div>
      ${typePillsHtml.length?`<div class="tc2-opp-hit-types" title="${esc(typeLabel)}"><small>${esc(typeLabel)}</small>${typePillsHtml.map(t=>typePill(t)).join('')}</div>`:''}
    </div>`;
  };
  // Select up to four attacking types by distinct opponents with meaningful
  // baseline damage, not by type effectiveness alone.
  const bestCoverageCombo=(rows,k)=>{
    const candidates=rows.filter(r=>r.targets.length>0);
    if(!candidates.length)return{types:[],total:0};
    if(candidates.length<=k){
      const covered=new Set();
      candidates.forEach(r=>r.targets.forEach(t=>covered.add(norm(t.mon.species))));
      return{types:candidates.map(r=>({type:r.type,count:r.targets.length})),total:covered.size};
    }
    const n=candidates.length;let best=null;const chosen=[];
    const recurse=start=>{
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
  const bestComboBlock=bestCombo.types.length?`<div class="tc2-best-combo"><span class="tc2-best-combo-label">Meaningful ${bestCombo.types.length===1?'':'4-type '}coverage</span><div class="tc2-best-combo-types">${bestCombo.types.map(t=>typePill(t.type)).join('')}</div><span class="tc2-best-combo-note">${bestCombo.total} of ${coverageOpp.length} opponents</span></div>`:'';
  const topThree=coverageRows.filter(r=>r.targets.length>0).sort((a,b)=>b.targets.length-a.targets.length).slice(0,3);
  const topThreeBlock=topThree.length?`<div class="tc2-top3"><span class="tc2-top3-label">Top damaging types</span><div class="tc2-top3-list">${topThree.map((r,i)=>`<div class="tc2-top3-item"><span class="tc2-top3-rank">${i+1}</span>${typePill(r.type)}<span class="tc2-top3-count">${r.targets.length}</span></div>`).join('')}</div></div>`:'';
  const monStrip=selectedCoverageObj?`<div class="tc2-mon-strip">${sprite(selectedCoverageObj.species,'tc2-mon-sprite')}<div class="tc2-mon-info"><strong>${esc(displaySpecies(selectedCoverageObj))}</strong><div class="type-row">${(typeMap[selectedCoverageObj.species]||[]).map(t=>typePill(t)).join('')}</div></div>${bestComboBlock}<div class="tc2-mon-metrics"><div class="tc2-metric"><b>${coverageRows.filter(r=>r.targets.length).length}</b><span>Types with meaningful hits</span></div><div class="tc2-metric"><b>${superEffectiveTargets.length}/${coverageOpp.length}</b><span>Opponents with 2× damage options</span></div></div></div>`:'';
  const coverageSection=`<section id="prepTeamCoverage" class="panel prep-selectable-section tc2" data-prep-section="coverage">
    <div class="tc2-head"><div class="tc2-head-text"><div class="coverage-kicker">OFFENSIVE SCOUTING</div><h2>Type Coverage</h2><p class="panel-desc" style="margin:0">Select a Pokémon to compare its catalogue move candidates against the opposing roster. Colours reflect assessed damage, not type effectiveness alone. Amber means a type advantage exists but damage is low or unknown.</p></div><div class="coverage-analysis-select"><label for="prepCoverageMon">Your Pokémon</label><select id="prepCoverageMon">${your.map(m=>`<option value="${esc(m.species)}" ${norm(m.species)===norm(coverageSelected)?'selected':''}>${esc(displaySpecies(m))}</option>`).join('')}</select></div></div>
    ${monStrip}
    <p class="tc2-source-hint">${coverageEvidenceHint} Two-turn and recharge moves require conditions and are excluded from this baseline. A 1× move can still deal significant damage.</p>
    <div class="tc2-map">
      <div class="tc2-panel"><div class="tc2-panel-head"><span>Type coverage</span><em>By attacking type</em></div>${topThreeBlock}<div class="tc2-type-grid">${TYPE_NAMES.map(typeGridChip).join('')}</div></div>
      <div class="tc2-panel"><div class="tc2-panel-head"><span>Opponent scouting</span><em>${superEffectiveTargets.length} of ${coverageOpp.length} have meaningful 2× damage options</em></div><div class="tc2-opp-grid">${coverageOpp.length?coverageOpp.map(oppCard).join(''):'<div class="tc2-empty">No opposing roster loaded yet.</div>'}</div></div>
    </div>
    ${!coverageRows.length?`<div class="tc2-empty">${coverageUnverifiedCustom&&!coverageEvidenceReady?'Custom Mega-Z move legality is unverified. No unobserved catalogue moves are counted as coverage.':'No assessable damaging move candidates are available. This is missing data, not zero offensive coverage.'}</div>`:''}
  </section>`;


  // -------- CP4.174: shared, evidence-aware matchup intelligence --------
  // Keep one lightweight model for Threat Board and Team Planner. The selected
  // six are shared; changing them immediately refreshes BOTH read-only views.
  const validPlannerNames=your.map(m=>m.species);
  if(STATE.prepPlannerTeam!==teamKey(yourTeam)){
    STATE.prepPlannerTeam=teamKey(yourTeam);
    STATE.prepPlannerSelected=validPlannerNames.slice(0,6);
  }
  if(!Array.isArray(STATE.prepPlannerSelected))STATE.prepPlannerSelected=validPlannerNames.slice(0,6);
  STATE.prepPlannerSelected=validPlannerNames.filter(sp=>STATE.prepPlannerSelected.some(v=>speciesKey(v)===speciesKey(sp))).slice(0,6);
  const intel=window.SBL?.matchupIntelligence;
  if(!intel)throw new Error('Shared matchup intelligence service was not loaded. Refresh Match Prep.');
  // Base stats are already in the exact-form profile cache from roster preload.
  // Never substitute a normal form's stats when a custom Mega is missing.
  const intelStatsFor=species=>POKEMON_DATA_CACHE.get(speciesKey(species))?.stats||{};
  const intelMoveCache=new Map();
  const intelMoveInFlight=new Map();
  const intelMon=m=>({species:m.species,types:typeMap[m.species]||[],maxSpeed:m.maxSpeed,
    baseSpeed:m.baseSpeed,stats:intelStatsFor(m.species),candidateMoves:intelMoveCache.get(speciesKey(m.species))||[],
    observedMoves:observedFor(usageFor(m)),usage:usageFor(m)});
  const intelModel=()=>intel.evaluate({your:your.map(m=>({species:m.species,types:typeMap[m.species]||[],
    maxSpeed:m.maxSpeed,baseSpeed:m.baseSpeed,stats:intelStatsFor(m.species),candidateMoves:window.__sblPlannerMoves?.[m.species]||[],observedMoves:observedFor(m),usage:m})),
    opponent:opp.map(intelMon),selected:STATE.prepPlannerSelected,
    games:opponentAggregate.games.length});
  const evidenceLabel=e=>({'observed':'Observed replay move','possible':'Catalogue candidate; format and set unverified','catalogued':'Catalogue candidate; format and set unverified',
    'typing-only':'Possible STAB type (move unverified)','observed-untyped':'Observed, move type unknown','conditional':'Conditional move, not baseline','ruleset-unverified':'Custom-form move legality unverified'}[e]||'Unknown');
  const intelPairSummary=pair=>pair.best?
    `${esc(pair.best.name)} · ~${pair.estimatedPercent}% baseline · ${esc(evidenceLabel(pair.evidence))}`:
    esc(pair.reason);
  const intelStatusTone=(score,valid=true)=>!valid||score===null?'unknown':score>=70?'high':score>=40?'medium':'low';
  const intelPressureGrade=(score,valid=true)=>!valid||score===null?'Unassessed':score>=70?'High potential':score>=40?'Moderate potential':'Low projected damage';
  const intelEvidenceBadge=(kind)=>`<span class="prep-intel-evidence ${kind==='observed'?'observed':(kind==='possible'||kind==='catalogued')?'possible':'unverified'}">${esc(evidenceLabel(kind))}</span>`;
  const intelTypeList=(species)=>(typeMap[species]||[]).length?(typeMap[species]||[]).map(typePill).join(''):'<span class="prep-intel-faint">Type unknown</span>';
  const intelMonMarkup=(mon,klass='prep-intel-mini-sprite')=>`<span class="prep-intel-mon">${sprite(mon.species,klass)}<span class="prep-intel-mon-name"><strong>${esc(displaySpecies(mon))}</strong><span class="prep-intel-types">${intelTypeList(mon.species)}</span></span></span>`;
  const intelMultLabel=(multiplier)=>multiplier===null?'?':multiplier===0?'0×':multiplier===.25?'¼×':multiplier===.5?'½×':Number.isInteger(multiplier)?`${multiplier}×`:`${multiplier}×`;
  // Every matrix cell compares assessable attacks in both directions. Keep
  // conditional moves and the exact assumptions in expandable evidence, not
  // in an unexplained colour or raw type multiplier.
  const intelOptionLine=(pair,side)=>pair?.best?
    `<strong>${esc(pair.best.name)}</strong> · ~${pair.estimatedPercent}% baseline · ${esc(evidenceLabel(pair.best.evidence))}${pair.moveContrast?`<small class="prep-intel-contrast">${esc(pair.moveContrast)}</small>`:''}`:
    `<strong>Not assessed</strong> · ${esc(pair?.reason||'Move or exact-form data missing')}`;
  const intelAttackEvidence=(pair,label)=>`<div class="prep-intel-pair-evidence"><h5>${esc(label)}</h5>
    ${pair?.attacks?.length?`<ul>${pair.attacks.map(a=>`<li><strong>${esc(a.name||a.type||'Unknown move')}</strong><span>${esc(a.evidence==='conditional'?'Needs setup/charging, not scored':a.evidence==='observed'?'Seen in replay':a.evidence==='typing-only'?'Typing only, move unverified':a.evidence==='ruleset-unverified'?'Custom-form legality unverified':'Catalogue candidate; format and set unverified')} · ${a.estimatedPercent===null?'Damage not assessed':'~'+a.estimatedPercent+'% baseline'} · ${intelMultLabel(a.multiplier)} type</span></li>`).join('')}</ul>`:'<p>No available attack data.</p>'}
</div>`;
  const intelPairDetails=(enemy,ally,pair)=>{
    const yours=intel.pair(ally,intelMon(enemy));
    const options=intel.assessOptions(yours,pair);
    const context=options.fullyAssessed?'Both directions have baseline move and stat data. This is not a predicted outcome.':
      'At least one direction lacks assessable moves or exact-form stats. Do not interpret an unknown as a safe matchup.';
    return `<div class="prep-intel-pair-detail">
      <div class="prep-intel-pair-heading"><div><span class="prep-intel-kicker">Matchup options</span><h4>${esc(displaySpecies(ally))} vs ${esc(displaySpecies(enemy))}</h4></div><span class="prep-intel-outcome ${options.tone}">${esc(options.label)}</span></div>
      <p class="prep-intel-muted">${esc(context)}</p>
      <div class="prep-intel-options-grid"><div><span>Your available attack</span><p>${intelOptionLine(yours,'you')}</p></div><div><span>Opponent's possible attack</span><p>${intelOptionLine(pair,'them')}</p></div></div>
      <div class="prep-intel-actions"><button type="button" data-intel-switch="${esc(enemy.species)}">Check actual damage in Switch-In</button></div>
      <details class="prep-intel-extra prep-intel-pair-advanced"><summary>Scored move evidence and assumptions</summary>
        <p class="prep-intel-muted">These estimates assume level 100, neutral natures, 0 EVs, 31 IVs, average damage rolls, and no items, abilities, boosts or field effects. Catalogue candidates are hypothetical, not confirmed legal moves or a confirmed four-move set. Charge/recharge moves are excluded from baseline threat ratings.</p>
        <div class="prep-intel-options-grid">${intelAttackEvidence(yours,'Your candidate moves')}${intelAttackEvidence(pair,'Opponent candidate moves')}</div>
        <p class="prep-intel-muted">Defensive typing alone does not establish a safe switch-in. Check abilities, items, Speed and actual damage before deciding.</p>
      </details>
    </div>`;
  };
  const intelDetailMarkup=row=>{
    if(!row)return '<div class="prep-new-empty">Choose an opposing Pokémon to inspect the matchup.</div>';
    const m=row.enemy,sc=row.scouting;
    const resists=row.pairs.filter(x=>x.maxMultiplier!==null&&x.maxMultiplier<=.5);
    const hits=row.affected;
    const weakButMinor=row.pairs.filter(x=>!x.threatened&&x.maxMultiplier>=2);
    const obs=m.observedMoves||[];
    const observed=moveEvidence(m);
    const sample=Number(m.usage?.appearances||0);
    const statsComplete=!!intelStatsFor(m.species)?.hp;
    const headline=row.assessed===0?'Not enough reliable data to rank this threat':
      hits.length?`Potential pressure against ${hits.length} of your ${row.pairs.length} picks`:
      `No high-pressure baseline hit identified in ${row.assessed} assessed matchups`;
    const customUnverified=window.SBL?.matchupIntelligence?.unverifiedCustomForm?.(m);
    const nextStep=row.assessed===0?
      (isProtectedBattleForm(m.species)&&!statsComplete?'Exact-form Mega stats are missing. Check form data before assessing damage.':
        customUnverified?'Custom Mega-Z moves are not verified for this league ruleset. Check an actual replay or validate the format-specific movepool before ranking an attack.':
        'Inspect its catalogued moves and exact-form stats to assess attacks.'):
      hits.length?'Check its strongest plausible attacks in the damage calculator before choosing a switch-in.':
      'Check possible coverage, abilities and setup before treating a defensive answer as safe.';
    const hitRow=x=>`<div class="prep-intel-target-row">${intelMonMarkup(x.ally)}<div class="prep-intel-attack"><strong>${x.best?.name?esc(x.best.name):'Move not established'}</strong><span>${x.best?`${x.best.power} BP · ${esc(x.best.category)} · ${intelMultLabel(x.best.multiplier)}${x.best.stab>1?' STAB':''} · ~${x.estimatedPercent}% baseline`:'Damage unassessed'}</span>${intelEvidenceBadge(x.evidence)}${x.moveContrast?`<small class="prep-intel-contrast">${esc(x.moveContrast)}</small>`:''}</div></div>`;
    const shortObserved=observed.moves.slice(0,3).map(x=>esc(x.name)).join(', ');
    return `<div class="prep-intel-detail-top">${intelMonMarkup(m,'prep-new-detail-sprite')}
      <span class="prep-intel-evidence ${row.assessed?'medium':'unknown'}">${row.assessed?row.assessed+'/'+row.pairs.length+' assessed':'Unassessed'}</span></div>
      <section class="prep-dossier-readout" aria-label="Scouting summary"><span class="prep-intel-kicker">Quick read</span>
        <h3>${esc(headline)}</h3>
        <div class="prep-dossier-facts"><div><span>Seen in replays</span><strong>${sample} ${sample===1?'appearance':'appearances'}</strong><small>${shortObserved?'Moves: '+shortObserved:'No moves observed this season'}</small></div>
        <div><span>Against your selected six</span><strong>${row.assessed}/${row.pairs.length} assessed</strong><small>${hits.length} possible meaningful baseline hits; unassessed is not safe</small></div></div>
        <p class="prep-dossier-next"><strong>What to do next:</strong> ${esc(nextStep)}</p>
      </section>
      ${hits.length?`<section class="prep-dossier-top-threats"><h4>Top possible threats</h4>${hits.slice(0,2).map(hitRow).join('')}${hits.length>2?`<p class="prep-intel-muted">${hits.length-2} more in full evidence below.</p>`:''}</section>`:''}
      <div class="prep-intel-actions"><button type="button" data-intel-load="${esc(m.species)}">Load / refresh move data</button><button type="button" data-intel-switch="${esc(m.species)}">Check damage in Switch-In</button></div>
      <details class="prep-intel-extra prep-dossier-advanced" data-intel-extra="dossier"><summary>Full scouting evidence and calculations</summary>
        <div class="prep-intel-detail-scores"><div class="prep-intel-kpi"><span>Hypothetical offensive potential</span><strong>${row.score===null||!row.pairs.length?'Unassessed':row.score+' / 100'}</strong><small>${row.assessed}/${row.pairs.length} pairs assessed; not a set prediction</small></div><div class="prep-intel-kpi"><span>Replay scouting priority</span><strong>${sample?sc.score+' / 100':'No sample'}</strong><small>${esc(sc.confidence)}, ${sample} appearances</small></div></div>
        ${intelMoveHistory(m)}
        <div class="prep-intel-detail-block"><h4>Meaningful potential attacks</h4>${hits.length?hits.map(hitRow).join(''):'<p class="prep-intel-muted">None established by the baseline screen. This does not prove safety.</p>'}</div>
        ${weakButMinor.length?`<div class="prep-intel-detail-block"><h4>Type advantages without established major damage</h4><p class="prep-intel-muted">Super-effective typing alone is not a reliable threat. Move power, stats, conditions or observations may be missing.</p>${weakButMinor.map(hitRow).join('')}</div>`:''}
        <div class="prep-intel-detail-block"><h4>Potential defensive answers</h4>${resists.length?`<div class="prep-intel-answer-list">${resists.map(x=>`<span>${esc(displaySpecies(x.ally))} <b>${intelMultLabel(x.maxMultiplier)}</b></span>`).join('')}</div>`:'<p class="prep-intel-muted">No fully resisted or immune pairing established by available typing.</p>'}<p class="prep-intel-muted">Resistances cannot establish safe switch-ins, especially against uncovered moves.</p></div>
        <div class="prep-intel-detail-block"><h4>Moves observed in replays</h4><div class="prep-intel-evidence-list">${obs.length?obs.map(x=>`<span>${esc(x)}</span>`).join(''):'<span class="prep-intel-faint">No observed moves yet</span>'}</div></div>
        <p class="prep-intel-muted">Baseline: level 100, neutral nature, 0 EVs, 31 IVs, average damage roll. No assumed item, ability, boost, weather or investment. Conditional two-turn attacks are not default recommendations; see catalogue candidates for possibilities.</p>
      </details>
      ${intelDossierNotes(m.species)}`;
  };
  // CP4.177: private Pokémon dossiers reuse the existing, RLS-protected
  // preparation records. Never put notes in shared replay or scouting data.
  const dossierScope={leagueId:String(SBL.leagueDb?.selectedLeagueId?.()||''),
    seasonId:String(SBL.leagueDb?.selectedSeasonId?.()||''),opponent};
  const dossierNotes={items:[],loaded:false,error:'',drafts:new Map(),busy:false};
  const dossierKey=species=>speciesKey(species);
  const monNotes=species=>dossierNotes.items.filter(x=>x.item_type==='finding'&&
    x.context?.kind==='pokemon-note'&&dossierKey(x.context?.species)===dossierKey(species));
  const moveEvidence=mon=>{
    const usage=usageFor(mon);
    return SBL.moveIntelligence?.summarize?.(usage,opponentAggregate.games.length)||{moves:[],indexed:0,available:0};
  };
  const intelDossierNotes=species=>`<section class="prep-dossier-notes" aria-label="Private notes for ${esc(species)}">
      <div class="prep-dossier-heading"><h4>Private notes for ${esc(species)}</h4><span>Only you can see these notes</span></div>
      <form data-intel-note-form="${esc(species)}" class="prep-dossier-note-form">
        <label for="prepIntelNoteText">Scouting observation or reminder</label>
        <textarea id="prepIntelNoteText" data-intel-note-text="${esc(species)}" rows="3" maxlength="2000" placeholder="e.g. Review a possible coverage move, observed item, or planned defensive answer">${esc(dossierNotes.drafts.get(dossierKey(species))||'')}</textarea>
        <button type="submit" ${dossierNotes.busy?'disabled':''}>Save Pokémon note</button>
      </form>
      <div class="prep-dossier-note-status" id="prepIntelNoteStatus" role="status" aria-live="polite">${esc(dossierNotes.error||(!dossierNotes.loaded?'Loading private notes...':''))}</div>
      <div class="prep-dossier-note-list">${monNotes(species).length?monNotes(species).map(note=>`<div class="prep-dossier-note"><p>${esc(note.content)}</p><button type="button" data-intel-note-delete="${esc(note.id)}" aria-label="Delete note">Delete</button></div>`).join(''):
        `<p class="prep-intel-muted">${dossierNotes.loaded?'No notes about this Pokémon yet.':'Your saved notes will appear here.'}</p>`}</div>
    </section>`;
  const intelMoveHistory=mon=>{
    const stats=moveEvidence(mon);
    const entries=stats.moves.slice(0,12);
    const rows=entries.map(move=>`<tr><th scope="row">${esc(move.name)}</th>
      <td>${move.battles}/${stats.available}</td><td>${move.uses}</td>
      <td>${move.hits?`${move.hits} hit${move.hits===1?'':'s'}`:'Not indexed'}</td>
      <td>${move.medianPercent===null?'Unknown':`${move.medianPercent.toFixed(1)}%`}</td>
      <td>${move.totalPercent===null?'Unknown':`${move.totalPercent.toFixed(1)}%`}</td></tr>`).join('');
    return `<div class="prep-intel-detail-block prep-dossier-moves"><h4>Observed move performance</h4>
      <p class="prep-intel-muted">Replays show what this coach actually used, not their unrevealed set. Percentages are target max HP lost, not predicted damage. Critical hits, investment and conditions can alter results.</p>
      ${entries.length?`<div class="prep-dossier-moves-scroll"><table><thead><tr><th>Move</th><th>Replays</th><th>Uses</th><th>Hits</th><th>Median hit</th><th>Total HP%</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<p class="prep-intel-muted">${Number(mon?.usage?.appearances||0)>0?'Confirmed in the replay team, but no move was observed or indexed for this Pokémon. Being brought does not prove a move was used.':'No replay appearances or observed moves recorded for this Pokémon in the selected season.'}</p>`}
      <p class="prep-intel-muted">${stats.indexed?`${stats.indexed} damaging move${stats.indexed===1?'':'s'} with indexed hit evidence.`:'Damage by move has not been indexed in existing replays.'} Older replays need reprocessing to populate exact move-damage evidence. Indirect damage is excluded.</p>
    </div>`;
  };
  const threatLevel=s=>s===null?'low':s>=70?'high':s>=40?'medium':'low';
  STATE.prepThreatSelected=opp.some(m=>speciesKey(m.species)===speciesKey(STATE.prepThreatSelected))?
    STATE.prepThreatSelected:(opp[0]?.species||'');
  window.__sblLoadIntelOpponentMoves=async species=>{
    const key=speciesKey(species);
    if(intelMoveCache.has(key))return intelMoveCache.get(key);
    if(intelMoveInFlight.has(key))return intelMoveInFlight.get(key);
    const promise=(async()=>{
      let moves=[];
      try{moves=await loadCoverageMoves(species);}catch(error){console.warn('Threat move lookup unavailable:',error);}
      intelMoveCache.set(key,moves||[]);
      window.__sblRefreshPrepThreatBoard?.();
      window.__sblRefreshPrepTeamPlanner?.();
      return moves;
    })();
    intelMoveInFlight.set(key,promise);
    try{return await promise;}finally{intelMoveInFlight.delete(key);}
  };
  window.__sblLoadAllIntelOpponentMoves=async()=>{
    const root=document.getElementById('prepThreatBoard')||document.getElementById('prepTeamPlanner');
    const status=document.getElementById('prepIntelLoadStatus');
    let completed=0;
    const names=opp.map(m=>m.species);
    // Two workers limit simultaneous network requests. Do not issue an N-way
    // burst for leagues with large opponent rosters.
    const pending=[...names];
    await Promise.all([0,1].map(async()=>{
      while(pending.length){
        const species=pending.shift();
        await window.__sblLoadIntelOpponentMoves?.(species);
        completed++;
        if(status)status.textContent=`${completed}/${names.length} inspected`;
      }
    }));
    if(status)status.textContent=`${completed}/${names.length} inspected`;
    return completed;
  };
  window.__sblRefreshPrepThreatBoard=()=>{
    const root=document.getElementById('prepThreatBoard');if(!root)return;
    const model=intelModel();
    const query=String(root.querySelector('#prepThreatSearch')?.value||'').trim().toLowerCase();
    const filter=root.querySelector('#prepThreatFilter')?.value||'all';
    const sort=root.querySelector('#prepThreatSort')?.value||'matchup';
    let rows=model.threats.filter(r=>!query||displaySpecies(r.enemy).toLowerCase().includes(query)||(typeMap[r.enemy.species]||[]).join(' ').toLowerCase().includes(query));
    rows=rows.filter(r=>filter==='all'||(filter==='unscouted'?!Number(r.enemy.usage?.appearances||0):
      filter==='high'?r.score>=70:filter==='medium'?r.score>=40&&r.score<70:filter==='unassessed'?r.score===null:r.score!==null&&r.score<40));
    rows.sort((a,b)=>sort==='scouting'?(b.scouting.score??-1)-(a.scouting.score??-1):
      sort==='bring'?(b.scouting.bring??-1)-(a.scouting.bring??-1):
      sort==='kos'?Number(b.scouting.kos||0)-Number(a.scouting.kos||0):
      (b.score??-1)-(a.score??-1));
    const body=root.querySelector('#prepThreatRows');
    if(body)body.innerHTML=rows.map(r=>{
      const selected=speciesKey(r.enemy.species)===speciesKey(STATE.prepThreatSelected);
      const evidence=moveEvidence(r.enemy);
      const top=evidence.moves[0];
      const plays=Number(r.enemy.usage?.appearances||0);
      return `<button type="button" class="prep-dossier-card ${selected?'selected':''}"
        data-threat-mon="${esc(r.enemy.species)}" aria-pressed="${selected?'true':'false'}" aria-controls="prepThreatDetail">
        ${intelMonMarkup(r.enemy,'prep-new-table-sprite')}
        <span class="prep-dossier-snapshot"><span>${plays} ${plays===1?'appearance':'appearances'}</span><span>${Number(r.enemy.usage?.kills||0)} KOs</span></span>
        <span class="prep-dossier-secondary">${top?`Observed: ${esc(top.name)} (${top.battles} ${top.battles===1?'battle':'battles'})`:'No observed move data'}</span>
        <span class="prep-dossier-open">${selected?'Viewing dossier':'View dossier'}</span>
      </button>`;
    }).join('');
    const empty=root.querySelector('#prepThreatEmpty');if(empty)empty.hidden=!!rows.length;
    const count=root.querySelector('#prepThreatCount');if(count)count.textContent=`${rows.length} of ${opp.length} opponent Pokémon`;
    const overview=root.querySelector('#prepIntelThreatSummary');
    if(overview){const high=model.threats.filter(t=>model.active.length&&t.score>=70).length,scouted=model.threats.filter(t=>Number(t.enemy.usage?.appearances||0)>0).length;
      overview.innerHTML=`<div class="prep-intel-summary-tile"><span>Selected team</span><strong>${model.active.length} / 6</strong><small>Change in Team Planner</small></div><div class="prep-intel-summary-tile"><span>Possible coverage to check</span><strong>${model.active.length?high:'N/A'}</strong><small>Hypothetical screen, not confirmed danger</small></div><div class="prep-intel-summary-tile"><span>Replay evidence</span><strong>${scouted} / ${opp.length}</strong><small>Opponents brought in replays</small></div>`;}
    const selected=model.threats.find(r=>speciesKey(r.enemy.species)===speciesKey(STATE.prepThreatSelected));
    const detail=root.querySelector('#prepThreatDetail');
    if(detail){
      const draft=detail.querySelector('[data-intel-note-text]');
      if(draft)dossierNotes.drafts.set(dossierKey(draft.dataset.intelNoteText),draft.value);
      const wasExpanded=detail.querySelector('[data-intel-extra="dossier"]')?.open||false;
      detail.innerHTML=intelDetailMarkup(selected);
      const nowAdvanced=detail.querySelector('[data-intel-extra="dossier"]');
      if(nowAdvanced&&wasExpanded)nowAdvanced.open=true;
    }
  };
  const threatBoardSection=`<section id="prepThreatBoard" class="panel prep-selectable-section prep-new-section prep-intel-v2" data-prep-section="threats">
    <div class="prep-new-section-head"><div><span class="prep-new-kicker">MATCHUP SCOUTING</span><h2>Opponent Scouting Board</h2><p class="panel-desc">See which opposing Pokémon pressure your selected six and why. Scouting history and matchup danger are shown separately.</p></div><div class="prep-new-count"><strong id="prepThreatCount">${opp.length} opponent Pokémon</strong><small>OPPONENT ROSTER</small></div></div>
    <div id="prepIntelThreatSummary" class="prep-intel-summary" aria-label="Threat overview"></div>
    <div class="prep-new-toolbar prep-intel-toolbar"><input id="prepThreatSearch" type="search" placeholder="Find an opponent or type" aria-label="Search opponent threats"><select id="prepThreatSort" aria-label="Sort threats"><option value="matchup">Sort: matchup pressure</option><option value="scouting">Sort: scouting priority</option><option value="bring">Sort: bring rate</option><option value="kos">Sort: KOs</option></select><select id="prepThreatFilter" aria-label="Filter threat priority"><option value="all">All opponents</option><option value="high">High potential</option><option value="medium">Moderate potential</option><option value="low">Lower potential</option><option value="unassessed">Damage unassessed</option><option value="unscouted">No recorded appearances</option></select><button type="button" data-intel-load-all>Analyse all opponent moves</button><span class="prep-intel-muted" id="prepIntelLoadStatus" role="status">Move data loads for the selected dossier; use Analyse all for the entire roster</span></div>
    <div class="prep-new-threat-layout"><div class="prep-intel-threat-list-panel"><div class="prep-intel-list-heading"><strong>Opponent roster</strong><span>Choose a Pokémon to open its dossier below</span></div><div id="prepThreatRows" class="prep-intel-threat-list" aria-label="Threat roster"></div><div id="prepThreatEmpty" class="prep-new-empty" hidden>No Pokémon match this filter.</div></div><aside id="prepThreatDetail" class="prep-new-detail" aria-label="Selected threat details"></aside></div>
    <p class="prep-new-footnote">Offensive potential uses base power, physical or special attacking and defensive stats, STAB and type effectiveness, limited to a hypothetical four-move coverage screen. No EVs, items, abilities or setup are assumed. It is not an actual damage calculation or a confirmed opponent set.</p>
  </section>`;
  const plannerMarkup=()=>{
    const query=String(STATE.prepPlannerSearch||'').toLowerCase();
    const model=intelModel(),team=model.active;
    const filtered=your.filter(m=>!query||displaySpecies(m).toLowerCase().includes(query)||(typeMap[m.species]||[]).join(' ').toLowerCase().includes(query));
    const high=model.threats.filter(t=>t.score>=70).length;
    const speedRows=team.map(m=>({mon:m,beats:opp.filter(o=>m.maxSpeed!=null&&o.maxSpeed!=null&&m.maxSpeed>o.maxSpeed).length,
      total:opp.filter(o=>m.maxSpeed!=null&&o.maxSpeed!=null).length})).sort((a,b)=>b.beats-a.beats);
    const offensiveRows=team.map(ally=>{
      const attacker={species:ally.species,types:typeMap[ally.species]||[],
        candidateMoves:window.__sblPlannerMoves?.[ally.species]||[],observedMoves:observedFor(ally)};
      const targets=opp.map(enemy=>({enemy,hit:intel.pair(attacker,{species:enemy.species,types:typeMap[enemy.species]||[]})}))
        .filter(entry=>entry.hit.threatened&&entry.hit.evidence!=='typing-only');
      return {ally,targets};
    }).filter(row=>row.targets.length).sort((a,b)=>b.targets.length-a.targets.length);
    const pressuredWeaknesses=model.weaknesses.filter(w=>w.sources.length).sort((a,b)=>b.sources.length-a.sources.length||b.vulnerable.length-a.vulnerable.length);
    const unpressuredWeaknesses=model.weaknesses.filter(w=>!w.sources.length);
    const weaknessMarkup=pressuredWeaknesses.map(w=>`<details class="prep-intel-weakness" data-intel-weakness="${esc(w.type)}"><summary><span class="prep-intel-weakness-leading">${typePill(w.type)}<span><strong>${w.vulnerable.length} of ${team.length} weak</strong><small>${w.sources.length} opposing attack source${w.sources.length===1?'':'s'}</small></span></span><span class="prep-intel-weakness-preview">${w.sources.length?esc(displaySpecies(w.sources[0].enemy))+' and others':'No identified source'}</span></summary>
      <div class="prep-intel-weakness-body"><div class="prep-intel-weakness-targets"><span class="prep-intel-kicker">Your Pokémon at risk</span><div class="prep-intel-answer-list">${w.vulnerable.map(x=>`<span>${esc(displaySpecies(x))}</span>`).join('')}</div></div>
      <span class="prep-intel-kicker">Opponents that can exploit it</span>
      ${w.sources.length?w.sources.map(src=>`<div class="prep-intel-source-row">${intelMonMarkup(src.enemy)}<div class="prep-intel-source-explain"><strong>${src.move?esc(src.move):esc(w.type)+' STAB potential'}</strong>${intelEvidenceBadge(src.evidence)}<span>Targets: ${src.targets.map(x=>esc(displaySpecies(x))).join(', ')}</span></div><div class="prep-intel-source-actions"><button type="button" data-intel-load="${esc(src.enemy.species)}">Moves</button><button type="button" data-intel-switch="${esc(src.enemy.species)}">Switch-In</button></div></div>`).join(''):'<p class="prep-intel-muted">No confirmed opponent move source. This is still a vulnerability worth checking.</p>'}
      </div></details>`).join('');
    const matrix=`<div class="prep-intel-matrix-wrap" role="region" aria-label="Matchup options matrix" tabindex="0"><table class="prep-intel-matrix"><thead><tr><th scope="col">Your team / Opponent</th>${opp.map(x=>`<th scope="col"><span class="prep-intel-matrix-mon">${sprite(x.species,'prep-intel-matrix-sprite')}<span>${esc(displaySpecies(x))}</span></span></th>`).join('')}</tr></thead><tbody>${team.map(ally=>`<tr><th scope="row">${intelMonMarkup(ally,'prep-intel-matrix-sprite')}</th>${opp.map(enemy=>{
      const against=model.lookup(enemy,ally),ours=intel.pair(ally,intelMon(enemy));
      const outcome=intel.assessOptions(ours,against);
      const oursLabel=ours.best?'~'+ours.estimatedPercent+'%':'?';
      const theirsLabel=against.best?'~'+against.estimatedPercent+'%':'?';
      const detail=`Your option: ${ours.best?.name||'unassessed'} (${oursLabel}); opponent option: ${against.best?.name||'unassessed'} (${theirsLabel}). Hypothetical baseline, not a predicted winner.`;
      return `<td><button type="button" class="prep-intel-cell ${outcome.tone}" data-intel-pair="${esc(enemy.species)}" data-intel-defender="${esc(ally.species)}" title="${esc(detail)}" aria-label="${esc(displaySpecies(ally))} versus ${esc(displaySpecies(enemy))}: ${esc(outcome.label)}. ${esc(detail)}"><strong>${esc(outcome.label)}</strong><small>You ${oursLabel} · Them ${theirsLabel}</small></button></td>`;
    }).join('')}</tr>`).join('')||`<tr><td colspan="${opp.length+1}" class="prep-new-empty">Select Pokémon to compare matchups.</td></tr>`}</tbody></table></div>`;
    const prior=STATE.prepIntelPair||{};
    const selectedEnemy=opp.find(x=>speciesKey(x.species)===speciesKey(prior.enemy));
    const selectedAlly=team.find(x=>speciesKey(x.species)===speciesKey(prior.ally));
    const pairDetails=selectedEnemy&&selectedAlly?intelPairDetails(selectedEnemy,selectedAlly,model.lookup(selectedEnemy,selectedAlly)):
      '<div class="prep-intel-pair-placeholder">Select any matrix cell to see the move evidence for that pairing, then open Switch-In to calculate damage.</div>';
    const biggest=model.threats.filter(t=>t.affected.length).slice(0,4);
    return `<div class="prep-intel-summary" aria-label="Selected team overview"><div class="prep-intel-summary-tile"><span>Your picks</span><strong>${team.length} / 6</strong><small>${team.length===6?'Team complete':`${6-team.length} spots to fill`}</small></div><div class="prep-intel-summary-tile"><span>Identified pressure types</span><strong>${pressuredWeaknesses.length}</strong><small>${unpressuredWeaknesses.length} other vulnerabilities</small></div><div class="prep-intel-summary-tile"><span>Scouting screens completed</span><strong>${team.length?model.threats.reduce((n,t)=>n+t.assessed,0)+' / '+(team.length*opp.length):'N/A'}</strong><small>${team.length?'Unknown matchups are not safe matchups':'Select a Pokémon first'}</small></div></div>
    <div class="prep-new-planner-layout"><section class="prep-new-roster-side prep-intel-surface"><div class="prep-new-planner-top"><div><h3>Build your six</h3><p>Select a Pokémon to add or remove it. Changes update both tools.</p></div><span class="prep-new-selected-count"><b>${team.length}</b> / 6</span></div><div class="prep-new-roster-grid">${filtered.map(m=>{const on=team.some(x=>speciesKey(x.species)===speciesKey(m.species));return `<button type="button" class="prep-new-roster-card ${on?'selected':''}" aria-pressed="${on?'true':'false'}" data-planner-mon="${esc(m.species)}" ${!on&&team.length>=6?'disabled':''}>${sprite(m.species,'prep-new-roster-sprite')}<span><strong>${esc(displaySpecies(m))}</strong><small>${(typeMap[m.species]||[]).map(esc).join(' / ')||'Typing unavailable'} | Speed ${m.baseSpeed??'N/A'}</small></span><i aria-hidden="true">${on?'✓':'+'}</i></button>`;}).join('')||'<div class="prep-new-empty">No Pokémon match your search.</div>'}</div></section>
    <section class="prep-new-planner-card prep-intel-selected-panel"><div class="prep-new-card-title"><h3>Selected six</h3><button type="button" class="prep-new-clear" data-planner-clear>Clear team</button></div><div class="prep-new-selected-list">${team.length?team.map(m=>`<div class="prep-new-selected-row">${sprite(m.species,'prep-new-selected-sprite')}<div><strong>${esc(displaySpecies(m))}</strong><small>${(typeMap[m.species]||[]).join(' / ')}</small></div><button type="button" data-planner-remove="${esc(m.species)}" aria-label="Remove ${esc(displaySpecies(m))}">×</button></div>`).join(''):'<div class="prep-new-empty">Choose from your roster to start the matchup analysis.</div>'}</div><p class="prep-new-validation">${team.length===6?'Ready to review matchups.':`${6-team.length} selections remaining.`}</p></section></div>
    <div class="prep-intel-priority-grid"><section class="prep-new-planner-card"><div class="prep-intel-panel-heading"><div><span class="prep-intel-kicker">DEFENSIVE PRESSURE</span><h3>Weaknesses worth preparing for</h3></div><span class="prep-intel-panel-count">${pressuredWeaknesses.length} types</span></div><p>Start with type vulnerabilities the opposing roster could exploit. A type weakness does not mean the move deals meaningful damage.</p>${team.length?(weaknessMarkup||'<div class="prep-new-empty">No opposing attack source identified yet. Other raw type weaknesses are below.</div>'):'<div class="prep-new-empty">Choose Pokémon above to reveal team weaknesses.</div>'}
      ${team.length&&unpressuredWeaknesses.length?`<details class="prep-intel-extra prep-intel-raw"><summary>Other type weaknesses (${unpressuredWeaknesses.length}), no identified opposing source</summary><div class="prep-intel-raw-list">${unpressuredWeaknesses.map(w=>`<div>${typePill(w.type)} <strong>${w.vulnerable.length}/${team.length} weak</strong><span>${w.vulnerable.map(x=>esc(displaySpecies(x))).join(', ')}</span></div>`).join('')}</div><p>These are type vulnerabilities, but the current opponent data does not identify an attack source. Unknown coverage remains possible.</p></details>`:''}</section>
      <section class="prep-new-planner-card"><div class="prep-intel-panel-heading"><div><span class="prep-intel-kicker">OPPONENT WATCHLIST</span><h3>Who threatens this selection?</h3></div><span class="prep-intel-panel-count">${biggest.length} flagged</span></div><p>Potential damaging moves checked against the selected six, considering base power and offensive and defensive stats. Not a confirmed set.</p>${team.length&&biggest.length?biggest.map(t=>`<div class="prep-intel-watch-row">${intelMonMarkup(t.enemy)}<div class="prep-intel-watch-meta"><strong>${t.affected.length}/${team.length} at risk</strong><span>${t.affected.slice(0,2).map(x=>esc(displaySpecies(x.ally))).join(', ')}${t.affected.length>2?' and more':''}</span></div><button type="button" data-intel-load="${esc(t.enemy.species)}">Moves</button></div>`).join(''):'<div class="prep-new-empty">No matchups flagged yet. Select your six to start.</div>'}</section></div>
    <section class="prep-new-planner-card prep-intel-matrix-panel"><div class="prep-intel-panel-heading"><div><span class="prep-intel-kicker">PAIRWISE COMPARISON</span><h3>Matchup matrix</h3></div><span class="prep-intel-panel-count">${team.length} × ${opp.length}</span></div><p>Colours compare the attacks actually assessable on both sides, not just type weaknesses. Each cell shows your strongest available option and the opponent's possible option. Tap for move evidence, assumptions and alternatives. Colours are <strong>not win probabilities or safe-switch guarantees</strong>.</p><div class="prep-intel-matrix-legend"><span><b class="edge">Edge</b> Your potential advantage</span><span><b class="trade">Trade</b> Both sides threaten</span><span><b class="risk">Risk</b> Opponent pressure</span><span><b class="caution">Check</b> Conditional / partial</span><span><b class="even">Even</b> No clear baseline edge</span><span><b class="unknown">?</b> Missing data</span></div>${matrix}<div id="prepIntelPairDetail" class="prep-intel-pair-detail-container" aria-live="polite">${pairDetails}</div></section>
    <div class="prep-new-planner-insights"><section class="prep-new-planner-card"><div class="prep-intel-panel-heading"><div><span class="prep-intel-kicker">OPTIONAL CHANGES</span><h3>Possible swaps</h3></div></div><p>These improve type exposure only, not predicted results.</p>${model.suggestions.length?model.suggestions.map(s=>`<div class="prep-intel-suggestion"><strong>${esc(displaySpecies(s.incoming))} for ${esc(displaySpecies(s.outgoing))}</strong><span>${s.oldCount} to ${s.newCount} potential pressures, down ${s.gain}</span></div>`).join(''):'<span class="prep-intel-faint">No obvious type-exposure improvement from the bench.</span>'}</section>
      <section class="prep-new-planner-card"><details class="prep-intel-extra"><summary>Offensive coverage</summary><p>Catalogued moves that could hit opponents super-effectively.</p>${offensiveRows.length?offensiveRows.map(x=>`<div class="prep-intel-match-row"><strong>${esc(displaySpecies(x.ally))}</strong><span>${x.targets.map(t=>`${esc(displaySpecies(t.enemy))}: ${intelPairSummary(t.hit)}`).join(' | ')}</span></div>`).join(''):'<span class="prep-intel-faint">Move metadata is not available yet. Select a Pokémon to load it.</span>'}</details><details class="prep-intel-extra"><summary>Speed overview</summary><p>Level 100 maximum Speed, positive nature, 252 EVs and no field effects.</p>${speedRows.map(x=>`<div class="prep-new-speed-row">${sprite(x.mon.species,'prep-new-pressure-sprite')}<strong>${esc(displaySpecies(x.mon))}</strong><b>${x.mon.maxSpeed??'N/A'}</b><span>${x.total?`${x.beats}/${x.total} outsped`:'Unknown'}</span></div>`).join('')||'<span class="prep-intel-faint">Select your six.</span>'}</details></section></div>`;
  };
  window.__sblRefreshPrepTeamPlanner=()=>{
    const root=document.getElementById('prepPlannerContent');
    if(!root)return;
    const expanded=[...root.querySelectorAll('details[data-intel-weakness][open]')].map(x=>x.dataset.intelWeakness);
    root.innerHTML=plannerMarkup();
    root.querySelectorAll('details[data-intel-weakness]').forEach(x=>{if(expanded.includes(x.dataset.intelWeakness))x.open=true;});
  };
  const teamPlannerSection=`<section id="prepTeamPlanner" class="panel prep-selectable-section prep-new-section prep-intel-v2" data-prep-section="planner"><div class="prep-new-section-head"><div><span class="prep-new-kicker">PREPARE YOUR SIX</span><h2>Team Planner</h2><p class="panel-desc">Build your six, see who exploits each weakness and investigate potential counters. Threat Board updates from the same selection.</p></div></div><div class="prep-new-toolbar"><input id="prepPlannerSearch" type="search" value="${esc(STATE.prepPlannerSearch||'')}" placeholder="Search your roster…" aria-label="Search your roster"></div><div id="prepPlannerContent"></div></section>`;
  window.__sblPlannerMoves={};
  window.__sblLoadPlannerMoveTypes=async species=>{
    if(!window.__sblPlannerMoves[species]){
      try{window.__sblPlannerMoves[species]=await loadCoverageMoves(species);}catch(_){window.__sblPlannerMoves[species]=[];}
    }
    return window.__sblPlannerMoves[species];
  };
  // Only prefetch selected-side move data. Opponent movepools load on demand,
  // not one query per enemy during every Match Prep render.
  // Populate the initial panel immediately; movepool lookups run after paint.
  // A cold PokeAPI cache must never block switching the selected opponent.

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
    if(m.webs && MATCHUPS.stickyWebAffected({species,types:typeMap[species]||[]}))v=Math.floor(v*2/3);
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
      if(m.webs && MATCHUPS.stickyWebAffected({species:mon.species,types:typeMap[mon.species]||[]}))v=Math.floor(v*2/3);
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
  // The selector is populated from the shared damaging move candidates immediately
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
  const switchSection=`<section id="prepSwitchAnalyser" class="panel prep-selectable-section" data-prep-section="switch"><div class="switch-analyser-head"><div><h2>Switch-In Analyser</h2><p class="panel-desc">Choose the attacking side, damaging move, and switch-in defender.</p></div><button type="button" id="prepSwitchRoleToggle" class="switch-role-toggle" aria-pressed="false">↔ Swap attacker / defender</button></div><p class="panel-desc">Choose an attacking Pokémon and one of its catalogued damaging move candidates. Current-format legality is not implied. Set the offensive EVs and each switch-in Pokémon's defensive EVs individually. Weather and terrain only affect moves they actually influence.</p><div class="prep-switch-controls"><div><label>Attacker Pokémon <span class="switch-side-label">(${switchAttackerSide==='your'?'Your Team':'Opponent Team'})</span></label><select id="prepSwitchMon">${switchAttackerMons.map(m=>`<option value="${esc(m.species)}" ${m.species===switchMon?.species?'selected':''}>${esc(displaySpecies(m))}</option>`).join('')}</select></div><div><label>Damaging Move</label><select id="prepSwitchMove"><option value="">${observedMoveOptions.length?'Select a damaging move':'Loading moves…'}</option>${observedMoveOptions.map(m=>`<option value="${esc(m)}" ${norm(m)===norm(defaultMove)?'selected':''}>${esc(m)}</option>`).join('')}</select></div><div id="prepSwitchHitsField" style="display:none"><label>Number of Hits</label><select id="prepSwitchHits"><option value="">Auto</option></select></div></div><div class="prep-item-controls"><div><label>Attacker Item</label>${switchItemSelect('prepSwitchAtkItem',switchAtkItem,'offensive')}</div><div><label>Switch-In Item</label>${switchItemSelect('prepSwitchDefItem',switchDefItem,'defensive')}</div><div><label>Offensive EVs</label><button type="button" id="prepSwitchAtkEVs" class="damage-calc-primary">Set EVs</button></div><div><label>Defensive EVs</label><button type="button" id="prepSwitchAllDefEVs" class="prep-all-evs-btn">Set All EVs</button></div></div><div class="prep-item-controls"><div><label>Weather</label>${switchFieldSelect('prepSwitchWeather',switchWeather,switchWeatherOptions)}</div><div><label>Terrain</label>${switchFieldSelect('prepSwitchTerrain',switchTerrain,switchTerrainOptions)}</div></div>${switchRows}</section>`;

  const latestMatchesSection=matchHistoryForTeam(opponent,false).replace('<section class="panel">','<section id="prepLatestMatches" class="panel prep-selectable-section" data-prep-section="matches">');
  // CP4.179: The matchup renderer and the interactive event handlers are
  // different function scopes. Handlers must receive the live, per-render
  // scouting context explicitly; previously dossierScope and several other
  // locals were referenced out of scope, aborting ALL event registration.
  if(intelBridge)Object.assign(intelBridge,{
    dossierScope,dossierNotes,dossierKey,intelModel,intelPairDetails,opp
  });
  return `<section class="panel prep-hero-panel"><div class="prep-hero"><div><h2>Match Prep</h2><p class="panel-desc" style="margin:0">Prepare <strong>${esc(yourTeam)}</strong> for a match against <strong>${esc(opponent)}</strong>. Match usage, scouting, recent replays and battle tools are combined here.</p></div><div class="prep-hero-controls"><div><label>Your Team</label><select id="prepYourTeam">${names.map(n=>`<option value="${esc(n)}" ${sameTeam(n,yourTeam)?'selected':''}>${esc(n)}</option>`).join('')}</select></div><div><label>Opponent</label><select id="prepOpponent">${names.filter(n=>!sameTeam(n,yourTeam)).map(n=>`<option value="${esc(n)}" ${sameTeam(n,opponent)?'selected':''}>${esc(n)}</option>`).join('')}</select></div></div><div class="prep-side-swap"><span class="prep-side-swap-label">Team sides</span><button type="button" id="prepSwapTeams" aria-label="Swap your team and opponent">↔ Swap Team</button><button type="button" id="prepNotesToggle" class="prep-notes-toggle" aria-expanded="false" aria-controls="prepNotesPanel">✎ Notebook <kbd>Alt+N</kbd>${matchupNote?.content?.trim()?' ·':''}</button></div></div></section>
  <div id="prepNotesBackdrop" class="prep-notes-backdrop" hidden></div>
  <section id="prepNotesPanel" class="prep-notes-panel" hidden aria-label="Matchup notes" role="dialog" aria-modal="true" aria-labelledby="prepNotesTitle">
    <div class="prep-notes-editor">
      <div class="prep-notes-head"><div><div class="prep-notes-title-row"><strong id="prepNotesTitle">Notes for ${esc(opponent)}</strong><span class="prep-notes-shortcut">Alt+N</span></div><span class="small">Private matchup notes · organized by week</span></div><div class="prep-notes-head-actions"><span class="prep-notes-save-status" id="prepNotesStatus" aria-live="polite">Saved</span><button type="button" id="prepNotesClose" class="prep-notes-close" aria-label="Close notes">×</button></div></div>
      <div class="prep-notes-toolbar"><label>Week <select id="prepNotesWeek">${[...new Set([matchupWeek,...matchupNotes.map(n=>String(n.week_key||'legacy'))])].map(w=>`<option value="${esc(w)}" ${String(w)===String(matchupWeek)?'selected':''}>${esc(notesWeekLabel(w))}${w==='legacy'?' · older':''}</option>`).join('')}</select></label><button type="button" id="prepNotesNewWeek" class="prep-notes-action">＋ New week</button><button type="button" id="prepNotesExport" class="prep-notes-action">Export</button></div>
      <div id="prepNotesNewWeekRow" class="prep-notes-new-week" hidden><input id="prepNotesNewWeekInput" type="text" maxlength="40" placeholder="e.g. Week 6"><button type="button" id="prepNotesStartWeek">Start</button></div>
      <textarea id="prepMatchupNotes" class="prep-notes-textarea" rows="6" placeholder="Write anything you want to remember about this matchup…">${esc(matchupNote?.content||'')}</textarea>
      <div class="prep-notes-history"><span id="prepNotesHistoryLabel">${matchupNotes.length?`${matchupNotes.length} saved ${matchupNotes.length===1?'week':'weeks'}`:'No older notes yet'}</span><span>Older notes stay available above</span></div>
      <div class="prep-notes-footer"><span>Esc to close</span><span>Saved to this matchup</span></div>
    </div>
  </section>
  <section class="panel prep-section-picker">
    <div class="prep-section-tabs" id="prepSectionTabs" role="tablist" aria-label="Match Prep sections">
      <button type="button" class="prep-section-tab" data-section="overview" role="tab">Team Overview</button>
      <button type="button" class="prep-section-tab" data-section="threats" role="tab">Threat Board</button>
      <button type="button" class="prep-section-tab" data-section="planner" role="tab">Team Planner</button>
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
  ${threatBoardSection}
  ${teamPlannerSection}
  ${latestMatchesSection}
  ${typeChartSection}
  ${coverageSection}
  ${speedSection}
  ${switchSection}`;
}

async function render(){
  const renderToken=(STATE.prepRenderToken||0)+1;
  STATE.prepRenderToken=renderToken;
  const sel=$('teamSelect');
  const availableTeams=teamNames();
  const team=availableTeams.find(n=>sameTeam(n,STATE.prepOpponent)) ||
    availableTeams.find(n=>sameTeam(n,sel?.value)) || '';
  if(!availableTeams.length){$('main').innerHTML='<div class="panel"><div class="empty">No franchise data available.</div></div>';return}
  {
    if(!STATE.prepYourTeam || !availableTeams.some(n=>sameTeam(n,STATE.prepYourTeam))) {
      STATE.prepYourTeam=availableTeams.find(n=>sameTeam(n,STATE.profileTeam))||team;
    }
    const yourTeam=STATE.prepYourTeam;
    const scheduled=SBL.schedule.nextOpponentForTeam(yourTeam,STATE.settings,STATE.replays,STATE.teamMap);
    const scheduledOpponent=scheduled.status==='upcoming' ? scheduled.opponent : '';
    let opponent=(STATE.prepOpponent && !sameTeam(STATE.prepOpponent,yourTeam)) ? STATE.prepOpponent : scheduledOpponent;
    // Manual matchup preparation is valid even when the fixture has no
    // upcoming game. Only the automatic default requires an upcoming match.
    if(!opponent || sameTeam(opponent,yourTeam)) {
      opponent=availableTeams.find(n=>!sameTeam(n,yourTeam))||'';
    }
    STATE.prepOpponent=opponent;
    // Switch-In Analyser role swapping: mirror the same attacker/defender side
    // logic used inside renderMatchPrep so the event handlers below (which run
    // in this separate function scope) can resolve the correct teams instead
    // of referencing undefined variables.
    const switchAttackerSide=STATE.prepSwitchAttackerSide==='your'?'your':'opponent';
    const switchAttackerTeamName=switchAttackerSide==='your'?yourTeam:opponent;
    const switchDefenderTeamName=switchAttackerSide==='your'?opponent:yourTeam;
    const intelBridge={};
    // Build the next view off-DOM. Never paint an intermediate loading state
    // when a team/section control changes; replacing the current view atomically
    // prevents the visible page-flash that used to look like a reload.
    try{
      const nextMarkup=await renderMatchPrep(yourTeam,opponent,intelBridge);
      // A selector can change again while the async view is being built. Never
      // let an older render win the race and replace the newer selection.
      if(renderToken!==STATE.prepRenderToken) return;
      const main=$('main');
      if(main){
        main.innerHTML=nextMarkup;
        // Bind primary matchup controls BEFORE optional scouting widgets.
        // A failure in a secondary widget must never disable team switching.
        $('prepYourTeam')?.addEventListener('change',async e=>{
          STATE.prepSection=STATE.prepSection||'overview';
          const previousOpponent=STATE.prepOpponent;
          STATE.prepYourTeam=e.target.value;
          const next=SBL.schedule.nextOpponentForTeam(STATE.prepYourTeam,STATE.settings,STATE.replays,STATE.teamMap);
          const candidates=[next.status==='upcoming'?next.opponent:'',previousOpponent,...teamNames()];
          STATE.prepOpponent=candidates.find(name=>name && teamNames().some(t=>sameTeam(t,name)) && !sameTeam(name,STATE.prepYourTeam))||'';
          if($('teamSelect'))$('teamSelect').value=STATE.prepOpponent;
          if(STATE.prepOpponent){const u=new URL(location.href);u.searchParams.set('team',STATE.prepOpponent);history.replaceState(null,'',u);}
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
        window.__sblRefreshPrepThreatBoard?.(); window.__sblRefreshPrepTeamPlanner?.();
        // The currently viewed dossier should not stay unassessed just because
        // nobody discovered an extra "Inspect moves" button. Load its data
        // automatically; bulk lookup remains opt-in to avoid a large fallback
        // PokéAPI request burst on every team change.
        const initialThreat=STATE.prepThreatSelected;
        if(initialThreat) void window.__sblLoadIntelOpponentMoves?.(initialThreat);
        // Two bounded background workers add catalogue move candidates incrementally.
        // Renders are token-scoped, so an older selection cannot refresh the
        // newly selected team after a slow external catalogue response.
        const selectedNames=[...(STATE.prepPlannerSelected||[])];
        const fetchSelectedMoves=window.__sblLoadPlannerMoveTypes;
        const pending=[...selectedNames];
        void Promise.allSettled([0,1].map(async()=>{
          while(pending.length && renderToken===STATE.prepRenderToken){
            await fetchSelectedMoves(pending.shift());
            if(renderToken===STATE.prepRenderToken){
              window.__sblRefreshPrepThreatBoard?.();
              window.__sblRefreshPrepTeamPlanner?.();
            }
          }
        }));
      }
    }catch(e){
      if(renderToken!==STATE.prepRenderToken)return;
      console.error('Match Prep render failed:',e);
      $('main').innerHTML=`<section class="panel"><div class="empty">Match Prep could not load: ${esc(e.message||e)}</div></section>`;
      return;
    }

    // Event wiring uses the exact context captured while building this view;
    // do not read closures that only exist inside renderMatchPrep().
    const {dossierScope,dossierNotes,dossierKey,intelModel,intelPairDetails,opp}=intelBridge;
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
    const threatRoot=$('prepThreatBoard');
    if(threatRoot){
      // Load only the account's records for this opponent and season.
      // Do not block viewing the roster if authentication or migration fails.
      if(SBL.prepTracker?.list){
        void SBL.prepTracker.list(dossierScope).then(items=>{
          if(!threatRoot.isConnected)return;
          dossierNotes.items=items||[];dossierNotes.loaded=true;dossierNotes.error='';
          window.__sblRefreshPrepThreatBoard?.();
        }).catch(error=>{
          if(!threatRoot.isConnected)return;
          dossierNotes.loaded=true;dossierNotes.error='Could not load private notes: '+String(error?.message||error);
          window.__sblRefreshPrepThreatBoard?.();
        });
      }
      threatRoot.addEventListener('input',event=>{
        const note=event.target.closest('[data-intel-note-text]');
        if(note)dossierNotes.drafts.set(dossierKey(note.dataset.intelNoteText),note.value);
      });
      threatRoot.addEventListener('submit',async event=>{
        const form=event.target.closest('[data-intel-note-form]');if(!form)return;
        event.preventDefault();
        const species=form.dataset.intelNoteForm;
        const text=form.querySelector('textarea')?.value.trim();
        if(!text||dossierNotes.busy)return;
        dossierNotes.busy=true;
        const submit=form.querySelector('button[type=submit]');if(submit)submit.disabled=true;
        const status=threatRoot.querySelector('#prepIntelNoteStatus');if(status)status.textContent='Saving...';
        try{
          const saved=await SBL.prepTracker.add(dossierScope,{type:'finding',content:text,
            sourceWidget:'threats',context:{kind:'pokemon-note',species}});
          dossierNotes.items.unshift(saved);dossierNotes.drafts.delete(dossierKey(species));
          void SBL.prepWorkspace?.refreshItems?.();
          if(threatRoot.isConnected)window.__sblRefreshPrepThreatBoard?.();
        }catch(error){if(status)status.textContent='Could not save: '+String(error?.message||error);}
        finally{dossierNotes.busy=false;if(submit)submit.disabled=false;}
      });
      threatRoot.addEventListener('input',e=>{if(e.target.id==='prepThreatSearch')window.__sblRefreshPrepThreatBoard?.();});
      threatRoot.addEventListener('change',e=>{if(e.target.id==='prepThreatSort'||e.target.id==='prepThreatFilter')window.__sblRefreshPrepThreatBoard?.();});
    }
    const inspectIntelOpponent=async species=>{
      await window.__sblLoadIntelOpponentMoves?.(species);
    };
    const inspectInSwitch=async species=>{
      STATE.prepSwitchAttackerSide='opponent';
      STATE.prepSwitchMon=species;
      STATE.prepSwitchMove='';
      STATE.prepSection='switch';
      STATE.prepJumpToSection=true;
      await render();
    };
    $('prepThreatBoard')?.addEventListener('click',async e=>{
      const removeNote=e.target.closest('[data-intel-note-delete]');
      if(removeNote){
        if(!window.confirm('Delete this private Pokémon note?'))return;
        removeNote.disabled=true;
        try{await SBL.prepTracker.remove(removeNote.dataset.intelNoteDelete);
          dossierNotes.items=dossierNotes.items.filter(x=>String(x.id)!==removeNote.dataset.intelNoteDelete);
          void SBL.prepWorkspace?.refreshItems?.();
          window.__sblRefreshPrepThreatBoard?.();
        }catch(error){const status=threatRoot.querySelector('#prepIntelNoteStatus');
          if(status)status.textContent='Could not delete: '+String(error?.message||error);removeNote.disabled=false;}
        return;
      }
      const row=e.target.closest('[data-threat-mon]');
      const load=e.target.closest('[data-intel-load]');
      const link=e.target.closest('[data-intel-switch]');
      if(link){await inspectInSwitch(link.dataset.intelSwitch);return;}
      const all=e.target.closest('[data-intel-load-all]');
      if(all){all.disabled=true;all.textContent='Inspecting moves…';try{await window.__sblLoadAllIntelOpponentMoves?.();}finally{all.disabled=false;all.textContent='Analyse all opponent moves';}return;}
      if(load){await inspectIntelOpponent(load.dataset.intelLoad);return;}
      if(row){STATE.prepThreatSelected=row.dataset.threatMon;
        window.__sblRefreshPrepThreatBoard?.();
        threatRoot.querySelector('#prepThreatDetail')?.scrollIntoView({behavior:'smooth',block:'start'});}
    });
    $('prepTeamPlanner')?.addEventListener('click',async e=>{
      const pairButton=e.target.closest('[data-intel-pair]');
      if(pairButton){
        const model=intelModel();
        const enemy=opp.find(m=>speciesKey(m.species)===speciesKey(pairButton.dataset.intelPair));
        const ally=model.active.find(m=>speciesKey(m.species)===speciesKey(pairButton.dataset.intelDefender));
        if(enemy&&ally){
          STATE.prepIntelPair={enemy:enemy.species,ally:ally.species};
          const dest=document.getElementById('prepIntelPairDetail');
          if(dest)dest.innerHTML=intelPairDetails(enemy,ally,model.lookup(enemy,ally));
        }
        return;
      }
      const load=e.target.closest('[data-intel-load]');
      const link=e.target.closest('[data-intel-switch]');
      if(link){await inspectInSwitch(link.dataset.intelSwitch);return;}
      if(load){await inspectIntelOpponent(load.dataset.intelLoad);return;}
    });
    const plannerRoot=$('prepTeamPlanner');
    if(plannerRoot){
      plannerRoot.addEventListener('input',e=>{if(e.target.id==='prepPlannerSearch'){STATE.prepPlannerSearch=e.target.value;window.__sblRefreshPrepTeamPlanner?.();}});
      plannerRoot.addEventListener('click',async e=>{
        const clear=e.target.closest('[data-planner-clear]');
        const remove=e.target.closest('[data-planner-remove]');
        const pick=e.target.closest('[data-planner-mon]');
        if(clear){STATE.prepPlannerSelected=[];}
        else if(remove){STATE.prepPlannerSelected=STATE.prepPlannerSelected.filter(x=>norm(x)!==norm(remove.dataset.plannerRemove));}
        else if(pick){const species=pick.dataset.plannerMon;const has=STATE.prepPlannerSelected.some(x=>norm(x)===norm(species));if(has)STATE.prepPlannerSelected=STATE.prepPlannerSelected.filter(x=>norm(x)!==norm(species));else if(STATE.prepPlannerSelected.length<6)STATE.prepPlannerSelected.push(species);}
        else return;
        const chosen=[...STATE.prepPlannerSelected];
        window.__sblRefreshPrepTeamPlanner?.();
        window.__sblRefreshPrepThreatBoard?.();
        // Do not block selecting a Pokémon while move lookups are in flight.
        const loadMoves=window.__sblLoadPlannerMoveTypes;
        const expectedRender=STATE.prepRenderToken;
        void Promise.allSettled(chosen.map(species=>loadMoves?.(species))).then(()=>{
          if(expectedRender!==STATE.prepRenderToken)return;
          window.__sblRefreshPrepTeamPlanner?.();
          window.__sblRefreshPrepThreatBoard?.();
        });
      });
    }


    const notesStatus=$('prepNotesStatus');
    const notesWeekSelect=$('prepNotesWeek');
    const matchupWeek=matchupNoteWeek(yourTeam,opponent);
    let activeNotesWeek=matchupWeek;
    let matchupNotes=[];
    let matchupNotesLoaded=false;
    let matchupNotesLoadPromise=null;
    let matchupSaveTimer=null;
    let matchupSaveInFlight=null;
    const setNotesStatus=(text)=>{if(notesStatus)notesStatus.textContent=text;};
    const noteForWeek=(week)=>matchupNotes.find(n=>String(n.week_key||'legacy')===String(week))||null;
    const refreshWeekOptions=()=>{
      const values=[activeNotesWeek,...matchupNotes.map(n=>String(n.week_key||'legacy'))];
      const unique=[...new Set(values)];
      if(!unique.includes(matchupWeek))unique.unshift(matchupWeek);
      if(notesWeekSelect){notesWeekSelect.innerHTML=unique.map(w=>`<option value="${esc(w)}" ${String(w)===String(activeNotesWeek)?'selected':''}>${esc(notesWeekLabel(w))}${w==='legacy'?' · older':''}</option>`).join('');}
    };
    const loadNotesData=async()=>{
      if(matchupNotesLoaded)return matchupNotes;
      if(matchupNotesLoadPromise)return matchupNotesLoadPromise;
      matchupNotesLoadPromise=(async()=>{
        try{
          matchupNotes=await SBL.notes?.getMatchupNotes?.(STATE.prepOpponent)||[];
          matchupNotesLoaded=true;
          refreshWeekOptions();
        }catch(err){
          console.warn('Matchup notes history load failed:',err);
          matchupNotes=[];
          refreshWeekOptions();
        }finally{
          matchupNotesLoadPromise=null;
        }
        return matchupNotes;
      })();
      return matchupNotesLoadPromise;
    };
    const loadNotesWeek=async(week)=>{
      activeNotesWeek=String(week||'Unassigned');
      const field=$('prepMatchupNotes');
      if(!field)return;
      clearTimeout(matchupSaveTimer);
      await loadNotesData();
      const note=noteForWeek(activeNotesWeek);
      field.value=note?.content||'';
      setNotesStatus('Saved');
      const hasCurrent=!!note?.content?.trim();
      const btn=$('prepNotesToggle'); if(btn)btn.classList.toggle('has-note',hasCurrent);
    };
    const saveMatchupNote=async()=>{
      const field=$('prepMatchupNotes'); if(!field)return;
      const content=field.value;
      setNotesStatus('Saving…');
      try{
        const data=await SBL.notes.setMatchupNote(STATE.prepOpponent,content,{weekKey:activeNotesWeek});
        matchupNotes=matchupNotes.filter(n=>String(n.week_key||'')!==String(activeNotesWeek));
        matchupNotes.push(data);
        matchupNotes.sort((a,b)=>Date.parse(b.updated_at||'')-Date.parse(a.updated_at||''));
        matchupNotesLoaded=true;
        refreshWeekOptions();
        setNotesStatus('Saved');
      }catch(err){ console.error('Matchup note save failed:',err); setNotesStatus('Could not save'); }
    };
    const toggleNotes=async(open)=>{
      const panel=$('prepNotesPanel'),backdrop=$('prepNotesBackdrop'),button=$('prepNotesToggle'); if(!panel||!button)return;
      const next=typeof open==='boolean'?open:panel.hidden;
      panel.hidden=!next; if(backdrop) backdrop.hidden=!next;
      button.setAttribute('aria-expanded',next?'true':'false');
      document.body.classList.toggle('prep-notes-open',next);
      if(next){
        await loadNotesData();
        await loadNotesWeek(activeNotesWeek);
        setTimeout(()=>{$('prepMatchupNotes')?.focus();},0);
      }
    };
    $('prepNotesToggle')?.addEventListener('click',()=>{if(!SBL.prepWorkspace?.reveal?.('notebook'))toggleNotes();});
    $('prepNotesClose')?.addEventListener('click',()=>{toggleNotes(false);});
    $('prepNotesBackdrop')?.addEventListener('click',()=>{toggleNotes(false);});
    notesWeekSelect?.addEventListener('change',async()=>{await saveMatchupNote();await loadNotesWeek(notesWeekSelect.value);});
    $('prepNotesNewWeek')?.addEventListener('click',()=>{const row=$('prepNotesNewWeekRow');if(row){row.hidden=!row.hidden;if(!row.hidden){$('prepNotesNewWeekInput')?.focus();}}});
    $('prepNotesStartWeek')?.addEventListener('click',async()=>{
      const input=$('prepNotesNewWeekInput'); const value=String(input?.value||'').trim();
      if(!value){input?.focus();return;}
      await loadNotesData();
      await saveMatchupNote();
      activeNotesWeek=value;
      matchupNotes.push({week_key:value,content:'',updated_at:new Date().toISOString()});
      refreshWeekOptions();
      if(notesWeekSelect)notesWeekSelect.value=value;
      const row=$('prepNotesNewWeekRow');if(row)row.hidden=true;
      if(input)input.value='';
      await loadNotesWeek(value);
    });
    $('prepNotesExport')?.addEventListener('click',async()=>{
      try{
        await loadNotesData();
        await saveMatchupNote();
        const rows=await SBL.notes.getMatchupNotes(STATE.prepOpponent);
        const lines=[`Battle Tower Match Prep Notes`,`Opponent: ${STATE.prepOpponent}`,`Exported: ${new Date().toLocaleString()}`,'' ];
        rows.slice().sort((a,b)=>String(a.week_key||'').localeCompare(String(b.week_key||''),undefined,{numeric:true})).forEach(row=>{lines.push(`## ${notesWeekLabel(row.week_key)}`,'',String(row.content||'').trim()||'(No note saved for this week.)','',`Last saved: ${row.updated_at||''}`,'');});
        const blob=new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'});
        const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`battle-tower-${String(STATE.prepOpponent).replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase() || 'matchup'}-notes.txt`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
      }catch(err){console.error('Notes export failed:',err);setNotesStatus('Could not export');}
    });
    document.addEventListener('keydown',(event)=>{
      const target=event.target;
      const typing=target && (target.matches?.('input,textarea,select,[contenteditable="true"]') || target.isContentEditable);
      if(event.key==='Escape' && !$('prepNotesPanel')?.hidden){ event.preventDefault(); toggleNotes(false); return; }
      if(!typing && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase()==='n'){ event.preventDefault(); if(!SBL.prepWorkspace?.reveal?.('notebook'))toggleNotes(); }
    });
    $('prepMatchupNotes')?.addEventListener('input',()=>{clearTimeout(matchupSaveTimer);setNotesStatus('Unsaved changes');matchupSaveTimer=setTimeout(saveMatchupNote,300);});
    $('prepMatchupNotes')?.addEventListener('change',()=>{clearTimeout(matchupSaveTimer);saveMatchupNote();});
    $('prepMatchupNotes')?.addEventListener('blur',()=>{clearTimeout(matchupSaveTimer);saveMatchupNote();});
    refreshWeekOptions();
    showPrepSection(STATE.prepSection||'overview');
    // CP4.176: mount the actual Match Prep panels into a personal dashboard.
    // This runs after the legacy tab state is set so it can reveal all chosen
    // widgets, while preserving existing element IDs and event listeners.
    SBL.prepWorkspace?.mount?.({
      leagueId:SBL.leagueDb?.selectedLeagueId?.(),
      seasonId:SBL.leagueDb?.selectedSeasonId?.(),
      opponent:STATE.prepOpponent,
      week:matchupWeek
    });
    if(STATE.prepJumpToSection){
      SBL.prepWorkspace?.reveal?.(STATE.prepSection);
      STATE.prepJumpToSection=false;
    }

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
      // This is the same Pokémon Profile pane used in Rosters and My Team.
      const teamOverview=SBL.pokemonProfile.pane({performance:{
        appearances:Number(data?.dataset?.appearances)||0,kills:Number(data?.dataset?.kills)||0,
        deaths:Number(data?.dataset?.deaths)||0,dealt:Number(data?.dataset?.dealt)||0,
        taken:Number(data?.dataset?.taken)||0
      }});
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
        if(root)await SBL.pokemonProfile.fill(root,{species,loadProfile:fetchPokemonData});
      }
      loadPrepPokemonData();
    }));

    // CP4.181: never call renderMatchPrep() as an isolated HTML factory here.
    // It also creates the planner/scouting closures and resets their caches.
    // An orphaned coverage-only refresh previously corrupted all three tools.
    $('prepCoverageMon')?.addEventListener('change',async e=>{
      STATE.prepCoverageMon=e.target.value;
      STATE.prepSection='coverage';
      await render();
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
    if(!window.__sblCoverageChipListenerInstalled){
      window.__sblCoverageChipListenerInstalled=true;
      document.addEventListener('click',e=>{
      const chip=e.target.closest?.('.tc2-type-chip[data-cov-type]');
      if(!chip)return;
      e.preventDefault();
      let moves=[];
      try{moves=JSON.parse(chip.dataset.covMoves||'[]');}catch(err){moves=[];}
      openCoverageMovesModal(chip.dataset.covType,chip.dataset.covMon,moves);
      },{capture:true});
    }
    // Switch-In Analyser role swapping is LOCAL to the analyser. It must never
    // mutate STATE.prepYourTeam / STATE.prepOpponent, because those are the
    // canonical teams used everywhere else in Match Prep.
    $('prepGlobalRoleToggle')?.remove();
    $('prepSwitchRoleToggle')?.addEventListener('click',async e=>{
      e.preventDefault();
      STATE.prepSwitchAttackerSide=STATE.prepSwitchAttackerSide==='your'?'opponent':'your';
      STATE.prepSwitchMon=''; STATE.prepSwitchMove=''; STATE.prepSwitchHits='';
      STATE.prepSwitchAtkItem=''; STATE.prepSwitchDefItem='';
      STATE.prepSwitchEVsByMon={}; // New side takes stored Set All defensive preset.
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
      host.innerHTML=`<div class="switch-ev-card" role="dialog" aria-modal="true"><div class="switch-ev-head"><div><h3>${typePill(type)}</h3><p>Damaging ${esc(type)}-type catalogue candidates. These are not confirmed set choices or proof of current-format legality.</p></div><button type="button" id="covMovesClose">Close ✕</button></div><div class="cov-moves-list">${sorted.length?sorted.map(chip).join(''):'<span class="small">No moves found.</span>'}</div></div>`;
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
      const title=isAtk ? `Offensive EVs for ${displaySpecies({species})}` : `Defensive EVs for ${displaySpecies({species})}`;
      const stats=isAtk ? ['atk','spa'] : ['hp','def','spd'];
      const labels={hp:'HP',atk:'Attack',def:'Defence',spa:'Sp. Attack',spd:'Sp. Defence',spe:'Speed'};
      const host=document.createElement('div');host.className='switch-ev-modal';
      host.innerHTML=`<div class="switch-ev-card" role="dialog" aria-modal="true"><div class="switch-ev-head"><div><h3>${esc(title)}</h3><p>${isAtk?'These EVs control the opposing Pokémon using the selected move.':'Set HP, Defense and Sp. Defense EVs for this defending Pokémon. Saved values immediately recalculate damage ranges.'}</p></div><button type="button" id="switchEvClose">Close ✕</button></div><div class="switch-ev-grid-modal">${stats.map(k=>`<div class="switch-ev-field"><span class="switch-ev-field-label">${labels[k]}</span><div class="switch-ev-cell"><button type="button" class="switch-ev-step" data-ev-target="switchEv_${k}" data-delta="-4" aria-label="Decrease ${labels[k]} EV">−</button><input id="switchEv_${k}" type="number" min="0" max="252" step="4" value="${!current[k]?'':Number(current[k])}" inputmode="numeric"><button type="button" class="switch-ev-step" data-ev-target="switchEv_${k}" data-delta="4" aria-label="Increase ${labels[k]} EV">+</button></div></div>`).join('')}</div><div class="switch-ev-actions"><button type="button" id="switchEvReset">Reset to 0</button><button type="button" id="switchEvSave" class="damage-calc-primary">Save EVs</button></div></div>`;
      document.body.appendChild(host);
requestAnimationFrame(()=>host.classList.add('open'));
      const close=()=>{host.classList.remove('open');setTimeout(()=>host.remove(),150);document.removeEventListener('keydown',onKey);};
      const onKey=e=>{if(e.key==='Escape')close();};document.addEventListener('keydown',onKey);
      host.querySelector('#switchEvClose').onclick=close;
      host.addEventListener('click',e=>{if(e.target===host)close();});
      host.querySelectorAll('.switch-ev-step').forEach(btn=>{
        btn.addEventListener('click',event=>{
          event.preventDefault();
          const input=host.querySelector('#'+btn.dataset.evTarget);
          if(!input)return;
          input.value=Math.max(0,Math.min(252,(Number(input.value)||0)+(Number(btn.dataset.delta)||0)));
        });
      });
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
      const current={hp:0,def:0,spd:0,...(STATE.prepSwitchAllDefEVs||{})};
      const host=document.createElement('div');host.className='switch-ev-modal';
      const labels={hp:'HP',def:'Defence',spd:'Sp. Defence'};
      host.innerHTML=`<div class="switch-ev-card" role="dialog" aria-modal="true"><div class="switch-ev-head"><div><h3>Set EVs for all switch-ins</h3><p>Apply the same defensive EVs to every Pokémon on the defending side of this analyser.</p></div><button type="button" id="switchAllEvClose">Close ✕</button></div><div class="switch-ev-grid-modal">${['hp','def','spd'].map(k=>`<div class="switch-ev-field"><span class="switch-ev-field-label">${labels[k]}</span><div class="switch-ev-cell"><button type="button" class="switch-ev-step" data-ev-target="switchAllEv_${k}" data-delta="-4" aria-label="Decrease ${labels[k]} EV">−</button><input id="switchAllEv_${k}" type="number" min="0" max="252" step="4" value="${!current[k]?'':Number(current[k])}" inputmode="numeric"><button type="button" class="switch-ev-step" data-ev-target="switchAllEv_${k}" data-delta="4" aria-label="Increase ${labels[k]} EV">+</button></div></div>`).join('')}</div><div class="switch-ev-actions"><button type="button" id="switchAllEvReset">Reset to 0</button><button type="button" id="switchAllEvSave" class="damage-calc-primary">Apply to all</button></div></div>`;
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
        STATE.prepSwitchAllDefEVs={hp:next.hp,def:next.def,spd:next.spd};
        const mons=await franchiseMons(switchDefenderTeamName);
        STATE.prepSwitchEVsByMon=STATE.prepSwitchEVsByMon||{};
        mons.forEach(m=>{STATE.prepSwitchEVsByMon[m.species]={...next};});
        close();await renderSwitchResults();
      };
    }

    const switchMoveCache={};
    async function damagingLearnset(species){
      const cacheKey=speciesKey(species);
      if(switchMoveCache[cacheKey])return switchMoveCache[cacheKey];
      const moves=await loadCoverageMoves(species);
      switchMoveCache[cacheKey]=Array.isArray(moves)?moves:[];
      return switchMoveCache[cacheKey];
    }
    async function populateSwitchMoveSelect(preferred=''){
      const sel=$('prepSwitchMove'); if(!sel) return [];
      const species=$('prepSwitchMon')?.value;
      const attacker=(await franchiseMons(switchAttackerTeamName)).find(m=>norm(m.species)===norm(species))||{species};
      sel.innerHTML='<option value="">Loading damaging moves…</option>';
      sel.value='';
      try{
        const moves=species?await Promise.race([damagingLearnset(species),new Promise(resolve=>setTimeout(()=>resolve([]),7000))]):[];
        let list=[...new Set((moves||[]).filter(Boolean).map(x=>typeof x==='string'?x:x.name))];
        if(!list.length && attacker){
          try{
            const C=await getCalcEngine(),gen=C.Generations.get(9);
            // The replay parser is a source of observed moves, not legality.
            // Only use a move the damage engine confirms has real base power.
            list=[...new Set(observedFor(attacker).filter(name=>{
              const known=gen.moves.get(name);
              return Number(known?.bp??known?.basePower)>0 &&
                ['Physical','Special'].includes(String(known?.category||''));
            }))];
          }catch(error){console.warn('Observed-move validation unavailable:',error);}
        }
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
        sel.innerHTML='<option value="">No damaging move candidates available - check the Pokémon catalogue or replay observations</option>';
        STATE.prepSwitchMove='';
        return [];
      }catch(err){
        sel.innerHTML='<option value="">No damaging move candidates available - check the Pokémon catalogue or replay observations</option>';
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
      if(!mon||!move){mount.innerHTML='<div class="empty">Select a damaging move to analyse switch-ins.</div>';return;}
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
            // Shared catalogue adapter uses native form data when available;
            // otherwise an exact versioned form profile with explicit stats,
            // type and ability overrides. An unknown custom form is never
            // calculated as its weaker base form.
            const makeCalcPokemon=async (species,opts)=>{
              if(!SBL.pokemonCatalog?.createCalcPokemon)
                throw new Error('Centralised battle-form adapter is unavailable.');
              return SBL.pokemonCatalog.createCalcPokemon(C,gen,canonicalSpecies(species),opts);
            };
            const atk=await makeCalcPokemon(mon,{level:100,item:atkItem||undefined,ability:attackerAbility||undefined,evs:STATE.prepSwitchAtkEVs||{hp:0,atk:0,def:0,spa:0,spd:0,spe:0},boosts:chargeBoost||undefined});
            const evs=(STATE.prepSwitchEVsByMon||{})[target.species]||STATE.prepSwitchAllDefEVs||{hp:0,atk:0,def:0,spa:0,spd:0,spe:0};
            const def=await makeCalcPokemon(target.species,{level:100,item:STATE.prepSwitchDefItem||undefined,ability:defenderAbility||undefined,evs});
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
        mount.innerHTML=`<div class="prep-switch-grid">${rows.map(r=>`<article class="prep-switch-card prep-switch-ev-card" data-switch-ev-mon="${esc(r.target.species)}"><div class="switch-card-top">${sprite(r.target.species,'prep-switch-sprite')}<div class="switch-card-identity"><strong class="switch-card-name">${esc(displaySpecies(r.target))}</strong><div class="switch-card-types">${typePills(typeMapForSpecies[r.target.species]||[])}</div><div class="switch-card-evs">EVs: ${esc(formatSwitchEVs((STATE.prepSwitchEVsByMon||{})[r.target.species]||STATE.prepSwitchAllDefEVs||{hp:0,atk:0,def:0,spa:0,spd:0,spe:0}))}</div></div><button type="button" class="prep-switch-ev-toggle">Set EVs</button></div>${r.error?`<div class="switch-card-detail">Calculation unavailable: ${esc(r.error)}</div>`:r.immune?`<div class="switch-card-result"><div><div class="switch-card-result-label">Damage</div><div class="prep-damage-range">No effect</div></div><div class="switch-card-verdict">Immune</div></div><div class="switch-card-detail">${esc(move)} does no damage to ${esc(displaySpecies(r.target))}.</div><div class="switch-card-footer"><span class="prep-switch-note">Safe switch-in</span></div>`:`<div class="switch-card-result"><div><div class="switch-card-result-label">Damage taken</div><div class="prep-damage-range">${Number.isFinite(r.pctMin)&&Number.isFinite(r.pctMax)?`${r.pctMin.toFixed(1)}%–${r.pctMax.toFixed(1)}%`:'Unavailable'}</div></div><div class="switch-card-verdict">${r.ko==='sash'?'Would KO without Focus Sash':r.ko==='guaranteed'?'Guaranteed KO':r.ko==='possible'?`KO ${Number.isInteger(r.koChance)?r.koChance:r.koChance.toFixed(2)}% of the time`:r.pctMax<=35?'Excellent':r.pctMax<=55?'Generally safe':'Risky'}</div></div><div class="switch-card-detail">${r.min}–${r.max} raw damage from ${esc(move)}${r.hits>1?` (${r.hits}× hits)`:''}${r.heal?` · ${r.heal} HP healed (${r.healPctLabel} max HP when triggered) · ${r.netMin}–${r.netMax} net damage`:''}</div><div class="switch-card-footer"><span class="prep-switch-note">${r.ko==='sash'?'Would KO without Focus Sash':r.ko==='guaranteed'?'KO - guaranteed from the minimum roll':r.ko==='possible'?`KO ${Number.isInteger(r.koChance)?r.koChance:r.koChance.toFixed(2)}% of the time`:r.pctMax<=35?'Excellent switch-in':r.pctMax<=55?'Generally safe':'Risky switch-in'}</span>${Number.isFinite(r.hp)?`<span class="switch-card-hp">${r.hp} HP</span>`:''}</div>`}</article>`).join('')}</div>`;
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
  const wanted=speciesKey(key);
  const m=a.mons[key] || a.mons[wanted] || Object.values(a.mons).find(x=>speciesKey(x.species)===wanted);
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
      return `<div class="scout-base-stat"><div class="scout-base-stat-head"><span>${label}</span><strong>${value||'N/A'}</strong></div><div class="scout-stat-bar"><i style="width:${Math.min(100,value/180*100)}%"></i></div></div>`;
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
  clearMatchPrepReadModels();
  try{
    const {data:authData}=await supabase.auth.getUser();
    const user=authData?.user||null;
    if(!user){ location.replace('index.html'); return; }
    STATE.profileUserId=user.id;
    const leagueId = SBL.leagueDb?.selectedLeagueId?.() || '';
    if(!leagueId){ location.replace('index.html'); return; }
    const currentFranchise = SBL.franchiseOwnership?.getUserFranchise
      ? await SBL.franchiseOwnership.getUserFranchise(leagueId, user.id, supabase)
      : null;
    STATE.profileTeam=currentFranchise?.franchise?.name||'';
    if(!currentFranchise?.franchiseId){ location.replace('index.html'); return; }
    document.getElementById('app').style.display = '';
    const {data,error}=await SBL.replays.load(supabase);
    if(error)throw error;
    const { sharedState, replays, publishedRosters, normalizedSeason } = SBL.replays.partition(data);
    const shared = sharedState || {};
    const snap=SBL.seasons.getSnapshot(shared);
    STATE.teamMap=snap.teamMap;
    STATE.settings=Object.assign(STATE.settings,snap.settings||{});
    STATE.settings.rosters=STATE.settings.rosters||{};
    const seasonReplays=snap.archived && !normalizedSeason ? snap.replays : replays;
    if(seasonReplays && typeof seasonReplays==='object'){
      for(const [id,replay] of Object.entries(seasonReplays)) if(id && replay) STATE.replays[id]=replay;
    }
    if(!normalizedSeason && publishedRosters && typeof publishedRosters==='object' && Object.keys(STATE.settings.rosters||{}).length===0){
      STATE.settings.rosters=publishedRosters;
    }
    // Load the league's current franchise directory independently of roster or
    // replay presence. Failure to list is non-fatal; existing sources remain.
    try{
      const franchises=await SBL.leagueDb.listFranchises(leagueId,supabase);
      STATE.franchiseNames=(franchises||[])
        .filter(f=>String(f.status||'active').toLowerCase()==='active')
        .map(f=>String(f.name||'').trim()).filter(Boolean);
    }catch(error){console.warn('Match Prep franchise directory unavailable:',error);}
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
  const teams=teamNames();

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

// Private preparation snapshots contain only the current analyser inputs,
// never account information, private draft queues or another player's sets.
window.__sblPrepStateSnapshot=function(widget){
  const fields=widget==='switch'
    ?['prepSwitchAttackerSide','prepSwitchMon','prepSwitchMove','prepSwitchHits','prepSwitchAtkItem','prepSwitchDefItem','prepSwitchWeather','prepSwitchTerrain','prepSwitchAtkEVs','prepSwitchAllDefEVs','prepSwitchEVsByMon']
    :widget==='speed'
    ?['prepSpeedSelected','prepSpeedConfig','prepSpeedMods','prepSpeedPinned','prepSpeedBenchmark']
    :widget==='planner'||widget==='threats'
    ?['prepPlannerSelected','prepPlannerSearch']
    :[];
  const result={};
  fields.forEach(key=>{if(STATE[key]!==undefined)result[key]=JSON.parse(JSON.stringify(STATE[key]));});
  return result;
};
window.__sblRestorePrepState=async function(snapshot){
  if(!snapshot||typeof snapshot!=='object')return;
  const widget=String(snapshot.widget||'');
  const allowed=widget==='switch'
    ?['prepSwitchAttackerSide','prepSwitchMon','prepSwitchMove','prepSwitchHits','prepSwitchAtkItem','prepSwitchDefItem','prepSwitchWeather','prepSwitchTerrain','prepSwitchAtkEVs','prepSwitchAllDefEVs','prepSwitchEVsByMon']
    :widget==='speed'
    ?['prepSpeedSelected','prepSpeedConfig','prepSpeedMods','prepSpeedPinned','prepSpeedBenchmark']
    :widget==='planner'||widget==='threats'
    ?['prepPlannerSelected','prepPlannerSearch']
    :[];
  const source=snapshot.state||{};
  for(const key of allowed){
    if(Object.prototype.hasOwnProperty.call(source,key))STATE[key]=JSON.parse(JSON.stringify(source[key]));
  }
  STATE.prepSection=widget;
  STATE.prepJumpToSection=true;
  await render();
};

window.__dashboardNextOpponent = function(team){ try{ const next=SBL.schedule.nextOpponentForTeam(team||STATE.profileTeam,STATE.settings,STATE.replays,STATE.teamMap); return next.status==='upcoming'?next.opponent:''; }catch(e){ return ''; } };
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
