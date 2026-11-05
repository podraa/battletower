/*
 * SBL USAGE HELPER
 *
 * "Most used" means Pokémon that actually appeared in a match this season.
 * Franchise stat maps are roster-driven (every rostered Pokémon is present with
 * zeroed stats), so ranking them without a minimum-usage rule would present
 * unused roster entries as "top used".
 */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  function topUsed(stats,limit){
    const list=Array.isArray(stats)?stats:Object.values(stats||{});
    return list
      .filter(m=>m && m.species && Number(m.appearances||0)>0)
      .sort((a,b)=>Number(b.appearances||0)-Number(a.appearances||0)||Number(b.dealt||0)-Number(a.dealt||0)||String(a.species).localeCompare(String(b.species)))
      .slice(0,limit==null?5:limit);
  }
  window.SBL.usage={topUsed};
})();
