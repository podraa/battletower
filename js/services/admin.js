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
    const {error} = await client().from('replays').upsert([{
      replay_id: STATE_ID,
      replay_data: {teamMap: state.teamMap || {}, settings: state.settings || {}},
      updated_at: new Date().toISOString()
    }], {onConflict:'replay_id'});
    if(error) throw error;
    await SBL.performance?.invalidate?.('replays:all');
  }

  async function savePublishedRosters(rosters, user){
    requireUser(user);
    const {error} = await client().from('replays').upsert([{
      replay_id: ROSTER_ID,
      replay_data: {rosters: rosters || {}},
      updated_at: new Date().toISOString()
    }], {onConflict:'replay_id'});
    if(error) throw error;
    await SBL.performance?.invalidate?.('replays:all');
  }

  async function persistDraft(state, user){
    await saveSharedState(state, user);
    await savePublishedRosters(state.settings?.rosters || {}, user);
  }

  SBL.admin = {STATE_ID, ROSTER_ID, saveSharedState, savePublishedRosters, persistDraft};
})();
