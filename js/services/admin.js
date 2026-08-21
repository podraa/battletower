/* Shared admin persistence service used by Draft Room and admin tools. */
(function(){
  'use strict';
  const SBL = window.SBL = window.SBL || {};
  const STATE_ID = '__dashboard_state__';
  const ROSTER_ID = '__rosters__';

  function client(){ return SBL.getSupabase(); }
  function requireUser(user){ if(!user) throw new Error('Admin login required.'); }

  async function saveSharedState(state, user){
    requireUser(user);
    if(!SBL.replays?.saveSharedState) throw new Error('Shared replay service is not available.');
    return SBL.replays.saveSharedState(state, client());
  }

  async function savePublishedRosters(rosters, user){
    requireUser(user);
    if(!SBL.replays?.savePublishedRosters) throw new Error('Shared replay service is not available.');
    return SBL.replays.savePublishedRosters(rosters, client());
  }

  async function persistDraft(state, user){
    await saveSharedState(state, user);
    await savePublishedRosters(state.settings?.rosters || {}, user);
  }

  SBL.admin = {STATE_ID, ROSTER_ID, saveSharedState, savePublishedRosters, persistDraft};
})();
