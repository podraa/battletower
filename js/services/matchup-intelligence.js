/* Battle Tower matchup intelligence - CP4.174.
 * Shared read-only explanations for Threat Board and Team Planner. No live
 * private queues, sets or writes. Type-only possibilities are NEVER moves.
 */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  const SBL=window.SBL;
  function id(value){return SBL.domain?.pokemonCatalogId?.(value)||String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
  function unique(list){return [...new Set((list||[]).filter(Boolean))];}
  function typesOf(mon){return SBL.matchups?.normalizedTypes?.(mon?.types||[])||[];}
  function damageType(move){return Number(move?.power??move?.base_power??0)>0 && ['physical','special'].includes(String(move?.category||'').toLowerCase()) && !!SBL.matchups?.normalizeTypeName?.(move.type);}
  function legalMoves(mon){return unique((mon?.legalMoves||[]).filter(damageType).map(m=>id(m.name)))
    .map(k=>(mon.legalMoves||[]).find(m=>id(m.name)===k));}
  function observedSet(mon){return new Set((mon?.observedMoves||[]).map(id));}
  function pair(attacker,defender){
    const attackTypes=typesOf(attacker),defTypes=typesOf(defender);
    if(!attackTypes.length||!defTypes.length)return {unknown:true,attacks:[],threatened:false,maxMultiplier:null,status:'Unknown typing',reason:'Exact-form typing unavailable'};
    const seen=observedSet(attacker);
    const moves=legalMoves(attacker);
    const attacks=moves.map(move=>({name:String(move.name),type:SBL.matchups.normalizeTypeName(move.type),power:Number(move.power??move.base_power),
      evidence:seen.has(id(move.name))?'observed':'possible',
      multiplier:SBL.matchups.defense(move.type,defTypes)}));
    // A replay may prove a move occurred but lack metadata specifying its type.
    // Never guess the type of that move.
    const unresolved=(attacker.observedMoves||[]).filter(name=>!moves.some(m=>id(m.name)===id(name)))
      .map(name=>({name,type:null,power:null,evidence:'observed-untyped',multiplier:null}));
    attacks.push(...unresolved);
    // If no legal damaging move metadata exists, surface hypothetical STAB
    // pressure as an unverified *type* only, never as a purported legal move.
    if(!moves.length)for(const type of attackTypes)attacks.push({name:null,type,power:null,evidence:'typing-only',multiplier:SBL.matchups.defense(type,defTypes)});
    attacks.sort((a,b)=>Number(b.multiplier??-1)-Number(a.multiplier??-1)||
      (a.evidence==='observed'?-1:1)-(b.evidence==='observed'?-1:1));
    const rated=attacks.filter(x=>x.multiplier!==null);
    const maxMultiplier=rated.length?Math.max(...rated.map(x=>x.multiplier)):null;
    const threatened=maxMultiplier!==null&&maxMultiplier>=2;
    const reliable=rated.some(x=>x.evidence!=='typing-only'&&x.multiplier>=2);
    const best=rated.find(x=>x.multiplier===maxMultiplier)||null;
    const status=threatened?(reliable?'Super-effective move available':'Potential type weakness'):
      maxMultiplier===0?'Type immunity':maxMultiplier===null?'Unknown coverage':'No super-effective coverage identified';
    return {unknown:maxMultiplier===null,attacks,threatened,maxMultiplier,best,status,
      evidence:best?.evidence||'unknown',
      reason:best?(best.name?`${best.name} (${best.type}) · ${best.multiplier}× · ${best.evidence}`:
        `${best.type} STAB potential · ${best.multiplier}× · move not confirmed`):'No verified attack data'};
  }
  function scouting(mon,maximumKOs=1,games=0){
    const played=Number(games)||0,u=mon?.usage||{};
    if(!played)return {score:null,label:'Unscouted',confidence:'No replay sample',bring:null,sent:null,kos:Number(u.kills||0),games:0};
    const bring=Math.min(100,Math.round(Number(u.appearances||0)/played*100));
    const sentCount=(u.gameSets||[]).filter(x=>Number(x.sentOut||0)>0).length;
    const sent=Math.min(100,Math.round(sentCount/played*100));
    const kos=Math.max(0,Number(u.kills||0));
    // Scouting score is based ONLY on history; never claim it measures battle danger.
    const score=Math.min(100,Math.round(bring*.48+sent*.27+Math.min(100,kos/Math.max(1,maximumKOs)*100)*.25));
    return {score,label:score>=70?'Frequently used':score>=35?'Sometimes used':'Rarely observed',
      confidence:played>=5?'Broader sample':played>=2?'Limited sample':'Single replay',bring,sent,kos,games:played};
  }
  function evaluate({your=[],opponent=[],selected=[],games=0}={}){
    const active=selected.length?your.filter(m=>selected.some(x=>id(x)===id(m.species))):[];
    const allPairs=new Map();
    for(const enemy of opponent)for(const ally of your)allPairs.set(id(enemy.species)+'|'+id(ally.species),pair(enemy,ally));
    const lookup=(enemy,ally)=>allPairs.get(id(enemy.species)+'|'+id(ally.species))||pair(enemy,ally);
    const maxKOs=Math.max(1,...opponent.map(m=>Number(m.usage?.kills||0)));
    const threats=opponent.map(enemy=>{
      const pairs=active.map(ally=>({ally,...lookup(enemy,ally)}));
      const affected=pairs.filter(p=>p.threatened),confirmed=affected.filter(p=>p.evidence!=='typing-only');
      const knownPairs=pairs.filter(p=>p.maxMultiplier!==null);
      // Missing exact-form typing must not silently score as a safe matchup.
      // Rank only assessed pairs and explicitly mark incomplete coverage.
      const score=knownPairs.length?Math.round(100*(affected.length/knownPairs.length)*.75+
        (affected.some(p=>p.maxMultiplier>=4)?15:0)+(confirmed.length?10:0)):null;
      const hasMoveEvidence=enemy.legalMoves?.some(damageType)||false;
      const missing=active.length-knownPairs.length;
      return {enemy,pairs,affected,confirmed,missing,score:score===null?null:Math.min(100,score),
        label:!active.length?'Choose your six':!knownPairs.length?'Unknown matchup':
          missing?'Partial matchup data':!affected.length?'Limited type pressure':
          hasMoveEvidence?(affected.length>=3?'High':'Targeted'):'Potential (unverified)',
        evidence:hasMoveEvidence?'Move catalogue':'Typing only',
        scouting:scouting(enemy,maxKOs,games)};
    }).sort((a,b)=>(b.score??-1)-(a.score??-1));
    const weaknesses=(SBL.matchups?.types||[]).map(type=>{
      const vulnerable=active.filter(mon=>SBL.matchups.defense(type,typesOf(mon))>1);
      const sources=opponent.map(enemy=>{
        const observed=observedSet(enemy);
        const moves=legalMoves(enemy).filter(m=>SBL.matchups.normalizeTypeName(m.type)===type);
        const confirmed=moves.filter(m=>observed.has(id(m.name)));
        const best=confirmed[0]||moves[0];
        return best?{enemy,move:best.name,evidence:confirmed.length?'observed':'possible',targets:vulnerable.filter(mon=>lookup(enemy,mon).attacks.some(a=>id(a.name)===id(best.name)&&a.multiplier>=2))}:
          typesOf(enemy).includes(type)?{enemy,move:null,evidence:'typing-only',targets:vulnerable}:null;
      }).filter(x=>x&&x.targets.length);
      return {type,vulnerable,sources};
    }).filter(x=>x.vulnerable.length).sort((a,b)=>b.vulnerable.length-a.vulnerable.length);
    // A conservative substitution suggestion uses only type weaknesses; no
    // claim that a proposed replacement survives a calculated damage roll.
    const omitted=your.filter(m=>!active.some(a=>id(a.species)===id(m.species)));
    const exposure=mon=>opponent.filter(enemy=>lookup(enemy,mon).threatened).length;
    const suggestions=[];
    for(const incoming of omitted)for(const outgoing of active){
      const gain=exposure(outgoing)-exposure(incoming);
      if(gain>0)suggestions.push({incoming,outgoing,gain,oldCount:exposure(outgoing),newCount:exposure(incoming)});
    }
    suggestions.sort((a,b)=>b.gain-a.gain||a.incoming.species.localeCompare(b.incoming.species));
    return {active,opponent,threats,weaknesses,suggestions:suggestions.slice(0,3),lookup};
  }
  SBL.matchupIntelligence={pair,scouting,evaluate,id};
})();
