/* SBL SHARED DATA FACADE — Phase 6G
 *
 * Thin orchestration layer over the canonical replay/trade/league services.
 * Pages may opt into one-call reads without changing their existing local
 * state shapes. No schema or persistence behavior changes here.
 */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  const SBL=window.SBL;
  async function loadDashboard(options={}){
    const db=options.client || SBL.getSupabase();
    const [rows,trades]=await Promise.all([
      SBL.replays.load(db,{force:!!options.force}),
      options.trades===false ? Promise.resolve({data:[]}) : SBL.trades.load(db,{force:!!options.force})
    ]);
    const partition=SBL.replays.partition(rows.data||[]);
    return {
      rows: rows.data||[],
      trades: trades.data||[],
      sharedState: partition.sharedState||{},
      replays: partition.replays||{},
      publishedRosters: partition.publishedRosters||{},
      publishedFreeAgency: partition.publishedFreeAgency||null
    };
  }
  function invalidate(){ SBL.replays?.invalidateCache?.(); SBL.trades?.invalidateCache?.(); }
  SBL.data={loadDashboard,invalidate,clearCache:invalidate};
})();
