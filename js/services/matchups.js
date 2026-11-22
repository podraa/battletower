/* Battle Tower matchup engine — CP4.167, shared by Match Prep and future views.
 * Attack type is the first dimension; defender types multiply as in Showdown.
 * Returns null rather than claiming a matchup when typing is unavailable.
 */
(function () {
  'use strict';
  window.SBL=window.SBL||{};
  const SBL=window.SBL;
const TYPE_NAMES=['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
const TYPE_CHART={
  Normal:{Rock:.5,Steel:.5,Ghost:0},Fire:{Fire:.5,Water:.5,Grass:2,Ice:2,Bug:2,Rock:.5,Dragon:.5,Steel:2},Water:{Fire:2,Water:.5,Grass:.5,Ground:2,Rock:2,Dragon:.5},Electric:{Water:2,Electric:.5,Grass:.5,Ground:0,Flying:2,Dragon:.5},Grass:{Fire:.5,Water:2,Grass:.5,Poison:.5,Ground:2,Flying:.5,Bug:.5,Rock:2,Dragon:.5,Steel:.5},Ice:{Fire:.5,Water:.5,Grass:2,Ground:2,Flying:2,Dragon:2,Ice:.5,Steel:.5},Fighting:{Normal:2,Ice:2,Rock:2,Dark:2,Steel:2,Poison:.5,Flying:.5,Psychic:.5,Bug:.5,Ghost:0,Fairy:.5},Poison:{Grass:2,Poison:.5,Ground:.5,Rock:.5,Ghost:.5,Steel:0,Fairy:2},Ground:{Fire:2,Electric:2,Grass:.5,Poison:2,Flying:0,Bug:.5,Rock:2,Steel:2},Flying:{Grass:2,Electric:.5,Fighting:2,Bug:2,Rock:.5,Steel:.5},Psychic:{Fighting:2,Poison:2,Psychic:.5,Steel:.5,Dark:0},Bug:{Fire:.5,Grass:2,Fighting:.5,Poison:.5,Flying:.5,Psychic:2,Ghost:.5,Dark:2,Steel:.5,Fairy:.5},Rock:{Fire:2,Ice:2,Flying:2,Bug:2,Fighting:.5,Ground:.5,Steel:.5},Ghost:{Normal:0,Psychic:2,Ghost:2,Dark:.5},Dragon:{Dragon:2,Steel:.5,Fairy:0},Dark:{Fighting:.5,Psychic:2,Ghost:2,Dark:.5,Fairy:.5},Steel:{Fire:.5,Water:.5,Electric:.5,Ice:2,Rock:2,Fairy:2,Steel:.5},Fairy:{Fire:.5,Fighting:2,Poison:.5,Dragon:2,Dark:2,Steel:.5}
};

function normalizeTypeName(type){const raw=String(type||'').trim().toLowerCase();return raw?raw.charAt(0).toUpperCase()+raw.slice(1):'';}
function normalizedTypes(types){return [...new Set((Array.isArray(types)?types:[]).map(normalizeTypeName).filter(t=>TYPE_NAMES.includes(t)))];}
function multiplier(attacking,defending){const a=normalizeTypeName(attacking),d=normalizeTypeName(defending);return TYPE_CHART[a]?.[d]??1;}
function defense(attacking,defendingTypes){const types=normalizedTypes(defendingTypes);return types.length?types.reduce((n,t)=>n*multiplier(attacking,t),1):null;}
function bestStabMultiplier(attackingTypes,defendingTypes){
  const attacks=normalizedTypes(attackingTypes),defs=normalizedTypes(defendingTypes);
  if(!attacks.length||!defs.length)return null;
  return Math.max(...attacks.map(a=>defense(a,defs)));
}
function defensiveEffectiveness(types){const defs=normalizedTypes(types);return TYPE_NAMES.map(type=>({type,mult:defs.length?defense(type,defs):null}));}
SBL.matchups={types:TYPE_NAMES,normalizeTypeName,normalizedTypes,multiplier,defense,bestStabMultiplier,defensiveEffectiveness};
})();
