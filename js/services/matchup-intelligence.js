/* Battle Tower matchup intelligence - CP4.177.
 * Estimates offensive pressure from a *hypothetical* four-move coverage set.
 * It is never a damage calculation or proof of the opponent's actual set.
 * Replay observations and unverified catalogue candidates stay distinct.
 */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  const SBL=window.SBL;
  const id=value=>SBL.domain?.pokemonCatalogId?.(value)||String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const typesOf=mon=>SBL.matchups?.normalizedTypes?.(mon?.types||[])||[];
  const seenOf=mon=>new Set((mon?.observedMoves||[]).map(id));
  // Custom Z-Mega forms have no universal National Dex legality contract.
  // An indexed cross-generation learnset is NOT evidence of legality in the
  // league's ruleset. Only observed moves may be scored by default.
  const unverifiedCustomForm=mon=>/(?:-mega-z)$/.test(SBL.domain?.pokemonKey?.(mon?.species)||'') &&
    mon?.verifiedRulesetMoves!==true;
  const finite=n=>Number.isFinite(Number(n))&&Number(n)>0?Number(n):null;
  function statsOf(mon){
    const s=mon?.stats||{};
    return {hp:finite(s.hp),atk:finite(s.attack??s.atk),def:finite(s.defense??s.def),
      spa:finite(s['special-attack']??s.spa),spd:finite(s['special-defense']??s.spd),
      spe:finite(s.speed??s.spe??mon?.baseSpeed)};
  }
  function damageType(move){
    return finite(move?.power??move?.base_power??move?.basePower)!==null &&
      ['physical','special'].includes(String(move?.category||'').toLowerCase()) &&
      !!SBL.matchups?.normalizeTypeName?.(move.type);
  }
  // A catalogue candidate is not necessarily a realistic one-turn attack. Keep
  // charge/recharge options visible in detailed evidence, but never use them
  // to colour a matchup or declare a credible offensive threat without
  // checking weather, items or other battle conditions.
  const CONDITIONAL=new Set([
    'solarbeam','solarblade','meteorbeam','skullbash','skyattack','razorwind',
    'freezeshock','iceburn','fly','bounce','dig','dive','phantomforce',
    'shadowforce','hyperbeam','gigaimpact','rockwrecker','roaroftime',
    'frenzyplant','blastburn','hydrocannon','prismaticlaser','eternabeam'
  ]);
  const isConditionalMove=move=>CONDITIONAL.has(id(move?.name));
  function candidateMoves(mon){
    // `candidateMoves` is the current name. `legalMoves` remains a read-only
    // compatibility alias for older callers, but the catalogue is not
    // ruleset-specific and must never be described as verified legality.
    return Array.isArray(mon?.candidateMoves)?mon.candidateMoves:
      Array.isArray(mon?.legalMoves)?mon.legalMoves:[];
  }
  function screenableMoves(mon){
    const seen=new Set();
    const observed=seenOf(mon);
    return candidateMoves(mon).filter(damageType).filter(m=>{
      const k=id(m.name);if(!k||seen.has(k)||isConditionalMove(m))return false;
      if(unverifiedCustomForm(mon)&&!observed.has(k))return false;
      seen.add(k);return true;
    });
  }
  // Variable-base-power and unusual damage formulae need a full calculator.
  // Don't invent a conventional damage screen for these moves.
  const VARIABLE=new Set([
    'electroball','gyroball','grassknot','lowkick','heavyslam','heatcrash','flail','reversal',
    'eruption','waterspout','crushgrip','wringout','storedpower','powertrip','ragefist',
    'lastrespects','beatup','present','trumpcard','terablast','weatherball','terrainpulse',
    'naturalgift','magnitude','return','frustration','punishment','fissure','sheercold',
    'guillotine','horndrill','endeavor','superfang','ruination','naturesmadness','nightshade',
    'seismictoss','dragonrage','sonicboom','psywave','finalgambit','counter','mirrorcoat',
    'metalburst','bide','bodypress','foulplay','psyshock','psystrike','secretsword','photongeyser'
  ]);
  // Strength is based on *base stats*, a neutral-nature level-100 0-EV/31-IV
  // proxy, 0.925 average damage roll, and no items/abilities/boosts/weather.
  // It intentionally never claims to predict an actual damage roll.
  function screenMove(attacker,defender,move){
    const a=statsOf(attacker),d=statsOf(defender);
    const category=String(move.category||'').toLowerCase();
    const multiplier=SBL.matchups.defense(move.type,typesOf(defender));
    if(multiplier===null)return {percent:null,why:'Unknown defending type',multiplier};
    if(multiplier===0)return {percent:0,why:'Type immune before abilities',multiplier};
    if(isConditionalMove(move))return {percent:null,why:'Charge/recharge turn or field/item condition not assessed',multiplier};
    if(VARIABLE.has(id(move.name)))return {percent:null,why:'Conditional or unusual damage formula',multiplier};
    const attack=category==='physical'?a.atk:a.spa;
    const defense=category==='physical'?d.def:d.spd;
    if(!attack||!defense||!d.hp)return {percent:null,why:'Exact-form base stats unavailable',multiplier};
    const bp=finite(move.power??move.base_power??move.basePower);
    if(!bp)return {percent:null,why:'Move base power unavailable',multiplier};
    const attStat=2*attack+36,defStat=2*defense+36,hpStat=2*d.hp+141;
    const stab=typesOf(attacker).includes(SBL.matchups.normalizeTypeName(move.type))?1.5:1;
    const raw=((42*bp*attStat/defStat/50)+2)*stab*multiplier*.925/hpStat*100;
    return {percent:Math.min(100,Math.round(raw/5)*5),why:'Neutral, uninvested baseline only',multiplier,stab};
  }
  const pressureTier=n=>n===null?'unassessed':n>=65?'strong':n>=45?'moderate':n>=20?'chip':'limited';
  function evaluateMove(attacker,defender,move,observed){
    const screen=screenMove(attacker,defender,move);
    return {name:String(move.name),type:SBL.matchups.normalizeTypeName(move.type),
      power:finite(move.power??move.base_power??move.basePower),category:String(move.category||''),
      evidence:observed.has(id(move.name))?'observed':(move.evidence==='catalogued'?'catalogued':'possible'),
      multiplier:screen.multiplier??null,estimatedPercent:screen.percent??null,
      tier:pressureTier(screen.percent??null),why:screen.why||'',stab:screen.stab||1};
  }
  function compareAttack(a,b){
    return (b.estimatedPercent??-1)-(a.estimatedPercent??-1)||
      (a.evidence==='observed'?-1:0)-(b.evidence==='observed'?-1:0)||
      (b.multiplier??-1)-(a.multiplier??-1)||String(a.name||'').localeCompare(String(b.name||''));
  }
  function pair(attacker,defender,coverageMoves){
    const attackTypes=typesOf(attacker),defTypes=typesOf(defender);
    if(!attackTypes.length||!defTypes.length)return {unknown:true,attacks:[],threatened:false,maxMultiplier:null,
      estimatedPercent:null,tier:'unassessed',best:null,status:'Unknown typing',reason:'Exact-form typing unavailable'};
    const observed=seenOf(attacker);
    const moves=Array.isArray(coverageMoves)?coverageMoves:screenableMoves(attacker);
    const attacks=moves.map(move=>evaluateMove(attacker,defender,move,observed));
    // Preserve these possibilities for inspection without making them default
    // team-planning recommendations. This is especially important for moves
    // such as Solar Beam without sun or Power Herb.
    const conditional=candidateMoves(attacker).filter(m=>damageType(m)&&isConditionalMove(m))
      .map(move=>({...evaluateMove(attacker,defender,move,observed),evidence:'conditional',
        estimatedPercent:null,tier:'unassessed',why:'Requires an extra turn or a specific field/item condition'}));
    attacks.push(...conditional);
    if(unverifiedCustomForm(attacker)){
      attacks.push(...candidateMoves(attacker).filter(damageType)
        .filter(m=>!observed.has(id(m.name))&&!isConditionalMove(m))
        .map(m=>({...evaluateMove(attacker,defender,m,observed),
          evidence:'ruleset-unverified',estimatedPercent:null,tier:'unassessed',
          why:'Custom-form move legality has not been verified for this league'})));
    }
    const untyped=(attacker.observedMoves||[]).filter(name=>!(candidateMoves(attacker).some(m=>id(m.name)===id(name))))
      .map(name=>({name,type:null,power:null,evidence:'observed-untyped',multiplier:null,estimatedPercent:null,tier:'unassessed'}));
    attacks.push(...untyped);
    if(!screenableMoves(attacker).length)for(const type of attackTypes)attacks.push({name:null,type,power:null,
      evidence:'typing-only',multiplier:SBL.matchups.defense(type,defTypes),estimatedPercent:null,tier:'unassessed'});
    attacks.sort(compareAttack);
    const rated=attacks.filter(x=>x.multiplier!==null&&!['conditional','ruleset-unverified'].includes(x.evidence));
    const maxMultiplier=rated.length?Math.max(...rated.map(x=>x.multiplier)):null;
    const best=attacks.find(x=>x.estimatedPercent!==null)||null;
    // Explain the physical/special choice. Raw base power alone is not a
    // damage comparison: defenders often have very different Def and SpD.
    const alternative=best?attacks.find(x=>x.estimatedPercent!==null &&
      x.category!==best.category && id(x.name)!==id(best.name)):null;
    const moveContrast=alternative?`${best.name} (${best.category}, ~${best.estimatedPercent}% baseline) versus ${alternative.name} (${alternative.category}, ~${alternative.estimatedPercent}% baseline). Physical and special attacks use different offensive and defensive stats; base power alone does not decide the better hit.`:null;
    const estimatedPercent=best?.estimatedPercent??null;
    const threatened=estimatedPercent!==null&&estimatedPercent>=45;
    const tier=pressureTier(estimatedPercent);
    const status=best?({strong:'Strong potential hit',moderate:'Potentially meaningful hit',chip:'Chip damage possible',limited:'Limited baseline damage'}[tier]):
      maxMultiplier!==null&&maxMultiplier>=2?'Type weakness, damage unassessed':'Move power or stats unassessed';
    const reason=best?`${best.name} (${best.category}, ${best.power} BP, ${best.multiplier}×${best.stab>1?' STAB':''}) · ~${estimatedPercent}% baseline · ${best.evidence}`:
      maxMultiplier!==null&&maxMultiplier>=2?'Super-effective type exists; damaging capability not verified':'No reliable offensive estimate';
    return {unknown:estimatedPercent===null,attacks,threatened,maxMultiplier,estimatedPercent,tier,best,alternative,moveContrast,status,
      evidence:best?.evidence||(rated[0]?.evidence||'unknown'),reason:unverifiedCustomForm(attacker)&&!best?'Custom Mega-Z: no observed, verified-format move to score':reason};
  }
  // Read both directions before assigning a matrix colour. These are
  // comparisons of *assessable options*, not predicted wins or safe switches.
  function assessOptions(ours,theirs){
    const own=ours?.estimatedPercent??null,opposing=theirs?.estimatedPercent??null;
    const ownHit=own!==null&&own>=45,opposingHit=opposing!==null&&opposing>=45;
    const bothKnown=own!==null&&opposing!==null;
    let tone='unknown',label='Needs data';
    if(opposingHit&&!ownHit){tone='risk';label='Risk';}
    else if(ownHit&&opposingHit){tone='trade';label='Trade';}
    else if(ownHit&&bothKnown){tone='edge';label='Edge';}
    else if(ownHit){tone='caution';label='Potential';}
    else if(bothKnown){tone='even';label='No clear edge';}
    else if((ours?.maxMultiplier??0)>=2||(theirs?.maxMultiplier??0)>=2){tone='caution';label='Check moves';}
    return {tone,label,ours:own,theirs:opposing,fullyAssessed:bothKnown,
      ownMove:ours?.best||null,opponentMove:theirs?.best||null};
  }
  function scouting(mon,maximumKOs=1,games=0){
    const played=Number(games)||0,u=mon?.usage||{};
    if(!played)return {score:null,label:'Unscouted',confidence:'No replay sample',bring:null,sent:null,kos:Number(u.kills||0),games:0};
    const bring=Math.min(100,Math.round(Number(u.appearances||0)/played*100));
    const sentCount=(u.gameSets||[]).filter(x=>Number(x.sentOut||0)>0).length;
    const sent=Math.min(100,Math.round(sentCount/played*100));
    const kos=Math.max(0,Number(u.kills||0));
    const score=Math.min(100,Math.round(bring*.48+sent*.27+Math.min(100,kos/Math.max(1,maximumKOs)*100)*.25));
    return {score,label:score>=70?'Frequently used':score>=35?'Sometimes used':'Rarely observed',
      confidence:played>=5?'Broader sample':played>=2?'Limited sample':'Single replay',bring,sent,kos,games:played};
  }
  // Hypothetical coverage cannot freely combine a whole learnset.
  // Greedily select at most four DISTINCT moves by their marginal baseline
  // pressure across the selected six. Observed moves win close ties, but
  // observations across replays are NOT assumed to be one real set.
  function coverageFour(enemy,active){
    const moves=screenableMoves(enemy);if(moves.length<=4||!active.length)return moves;
    const observed=seenOf(enemy),chosen=[],bestByTarget=active.map(()=>0);
    while(chosen.length<4){
      let bestMove=null,bestValue=-Infinity;
      for(const move of moves){
        if(chosen.some(m=>id(m.name)===id(move.name)))continue;
        const value=active.reduce((sum,ally,i)=>{
          const estimated=screenMove(enemy,ally,move).percent;
          return sum+Math.max(0,(estimated??0)-bestByTarget[i]);
        },0)+(observed.has(id(move.name))?0.2:0);
        if(value>bestValue){bestValue=value;bestMove=move;}
      }
      if(!bestMove||bestValue<=0)break;
      chosen.push(bestMove);
      active.forEach((ally,i)=>{bestByTarget[i]=Math.max(bestByTarget[i],screenMove(enemy,ally,bestMove).percent??0);});
    }
    return chosen;
  }
  function evaluate({your=[],opponent=[],selected=[],games=0}={}){
    const active=selected.length?your.filter(m=>selected.some(x=>id(x)===id(m.species))):[];
    const allPairs=new Map();
    const coverage=new Map(opponent.map(enemy=>[id(enemy.species),coverageFour(enemy,active)]));
    for(const enemy of opponent)for(const ally of your){
      const chosen=active.some(a=>id(a.species)===id(ally.species))?coverage.get(id(enemy.species)):undefined;
      allPairs.set(id(enemy.species)+'|'+id(ally.species),pair(enemy,ally,chosen));
    }
    const lookup=(enemy,ally)=>allPairs.get(id(enemy.species)+'|'+id(ally.species))||pair(enemy,ally);
    const maxKOs=Math.max(1,...opponent.map(m=>Number(m.usage?.kills||0)));
    const threats=opponent.map(enemy=>{
      const pairs=active.map(ally=>({ally,...lookup(enemy,ally)}));
      const assessed=pairs.filter(p=>p.estimatedPercent!==null);
      const affected=pairs.filter(p=>p.threatened),confirmed=affected.filter(p=>p.best?.evidence==='observed');
      const missing=active.length-assessed.length;
      // Weighted highest-three meaningful matchups. Low-power SE moves no
      // longer turn multiple opponents into an automatic 75/100 "High".
      const ranked=assessed.map(p=>p.estimatedPercent).sort((a,b)=>b-a);
      const top=ranked.slice(0,Math.min(3,ranked.length));
      const score=top.length?Math.min(100,Math.round(top.reduce((s,x)=>s+x,0)/top.length)):null;
      const possible=coverage.get(id(enemy.species))||[];
      const best=pairs.filter(p=>p.best).sort((a,b)=>(b.estimatedPercent??-1)-(a.estimatedPercent??-1))[0]||null;
      return {enemy,pairs,affected,confirmed,missing,assessed:assessed.length,
        score,label:!active.length?'Choose your six':score===null?'Damage unassessed':
          missing?'Partial matchup data':score>=70?'Strong offensive potential':score>=40?'Moderate offensive potential':'Limited projected damage',
        evidence:possible.length?'Hypothetical four-move screen':'Move data unavailable',
        evidenceCount:confirmed.length,possibleMoves:possible.map(m=>m.name),best,
        scouting:scouting(enemy,maxKOs,games)};
    }).sort((a,b)=>(b.score??-1)-(a.score??-1));
    const weaknesses=(SBL.matchups?.types||[]).map(type=>{
      const vulnerable=active.filter(mon=>SBL.matchups.defense(type,typesOf(mon))>1);
      const sources=opponent.map(enemy=>{
        const observed=seenOf(enemy);
        const moves=screenableMoves(enemy).filter(m=>SBL.matchups.normalizeTypeName(m.type)===type);
        const choices=moves.map(move=>({move,peak:Math.max(0,...vulnerable.map(ally=>screenMove(enemy,ally,move).percent||0))}));
        choices.sort((a,b)=>b.peak-a.peak||(observed.has(id(a.move.name))?-1:1));
        const best=choices[0]?.move;
        return best?{enemy,move:best.name,evidence:observed.has(id(best.name))?'observed':(best.evidence==='catalogued'?'catalogued':'possible'),
          targets:vulnerable.filter(mon=>lookup(enemy,mon).attacks.some(a=>id(a.name)===id(best.name)&&a.multiplier>=2))}:
          typesOf(enemy).includes(type)?{enemy,move:null,evidence:'typing-only',targets:vulnerable}:null;
      }).filter(x=>x&&x.targets.length);
      return {type,vulnerable,sources};
    }).filter(x=>x.vulnerable.length).sort((a,b)=>b.vulnerable.length-a.vulnerable.length);
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
  SBL.matchupIntelligence={pair,scouting,evaluate,id,screenMove,coverageFour,pressureTier,assessOptions,isConditionalMove,unverifiedCustomForm,candidateMoves:screenableMoves};
})();
