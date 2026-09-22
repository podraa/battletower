/*
 * SBL FRANCHISE OWNERSHIP SERVICE
 *
 * Canonical ownership boundary.
 * Ownership authority: public.franchise_assignments
 * Franchise authority: public.franchises
 * Membership/request authority: public.league_members
 *
 * Deliberately does NOT use profile.team_name, teamMap, legacy registries,
 * or season snapshots as an ownership source.
 */
(function () {
  'use strict';

  window.SBL = window.SBL || {};
  const SBL = window.SBL;

  function db(client) {
    const D = client || SBL.getSupabase?.();
    if (!D) throw new Error('Supabase is not ready.');
    return D;
  }

  function requireId(value, label) {
    const id = String(value || '').trim();
    if (!id) throw new Error(`${label} is required.`);
    return id;
  }

  function franchiseResult(franchise) {
    if (!franchise) return null;
    return {
      id: franchise.id,
      leagueId: franchise.league_id,
      name: franchise.name || '',
      conference: franchise.conference || null,
      status: franchise.status || 'active',
      archivedAt: franchise.archived_at || null
    };
  }

  function assignmentResult(row, franchise) {
    if (!row) return null;
    return {
      assignmentId: row.id,
      leagueId: row.league_id,
      franchiseId: row.franchise_id,
      userId: row.user_id,
      status: row.status,
      assignedAt: row.assigned_at,
      vacatedAt: row.vacated_at,
      franchise: franchiseResult(franchise)
    };
  }

  async function getFranchiseOwner(leagueId, franchiseId, client) {
    const league = requireId(leagueId, 'leagueId');
    const franchise = requireId(franchiseId, 'franchiseId');
    const D = db(client);

    const { data: assignment, error: assignmentError } = await D
      .from('franchise_assignments')
      .select('id,league_id,franchise_id,user_id,status,assigned_at,vacated_at')
      .eq('league_id', league)
      .eq('franchise_id', franchise)
      .eq('status', 'active')
      .maybeSingle();

    if (assignmentError) throw assignmentError;
    if (!assignment) return null;

    const { data: franchiseRow, error: franchiseError } = await D
      .from('franchises')
      .select('id,league_id,name,conference,status,archived_at')
      .eq('id', assignment.franchise_id)
      .eq('league_id', league)
      .maybeSingle();

    if (franchiseError) throw franchiseError;
    if (!franchiseRow) throw new Error('Ownership assignment references a franchise that could not be loaded.');

    return assignmentResult(assignment, franchiseRow);
  }

  async function getUserFranchise(leagueId, userId, client) {
    const league = requireId(leagueId, 'leagueId');
    const user = requireId(userId, 'userId');
    const D = db(client);

    const { data: assignment, error: assignmentError } = await D
      .from('franchise_assignments')
      .select('id,league_id,franchise_id,user_id,status,assigned_at,vacated_at')
      .eq('league_id', league)
      .eq('user_id', user)
      .eq('status', 'active')
      .maybeSingle();

    if (assignmentError) throw assignmentError;
    if (!assignment) return null;

    const { data: franchiseRow, error: franchiseError } = await D
      .from('franchises')
      .select('id,league_id,name,conference,status,archived_at')
      .eq('id', assignment.franchise_id)
      .eq('league_id', league)
      .maybeSingle();

    if (franchiseError) throw franchiseError;
    if (!franchiseRow) throw new Error('Ownership assignment references a franchise that could not be loaded.');

    return assignmentResult(assignment, franchiseRow);
  }

  async function isFranchiseAvailable(leagueId, franchiseId, client) {
    const league = requireId(leagueId, 'leagueId');
    const franchise = requireId(franchiseId, 'franchiseId');
    const D = db(client);

    const { data: franchiseRow, error: franchiseError } = await D
      .from('franchises')
      .select('id,league_id,name,conference,status,archived_at')
      .eq('id', franchise)
      .eq('league_id', league)
      .maybeSingle();

    if (franchiseError) throw franchiseError;
    if (!franchiseRow || franchiseRow.status !== 'active') return false;

    const { data: assignment, error: assignmentError } = await D
      .from('franchise_assignments')
      .select('id')
      .eq('league_id', league)
      .eq('franchise_id', franchise)
      .eq('status', 'active')
      .maybeSingle();

    if (assignmentError) throw assignmentError;
    return !assignment;
  }

  async function canUserActForFranchise(leagueId, userId, franchiseId, client) {
    const league = requireId(leagueId, 'leagueId');
    const user = requireId(userId, 'userId');
    const franchise = requireId(franchiseId, 'franchiseId');
    const D = db(client);

    const { data: assignment, error } = await D
      .from('franchise_assignments')
      .select('id')
      .eq('league_id', league)
      .eq('user_id', user)
      .eq('franchise_id', franchise)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw error;
    return !!assignment;
  }

  async function validateFranchiseClaim(leagueId, userId, franchiseId, client) {
    const league = requireId(leagueId, 'leagueId');
    const user = requireId(userId, 'userId');
    const franchise = requireId(franchiseId, 'franchiseId');
    const D = db(client);

    const { data: membership, error: membershipError } = await D
      .from('league_members')
      .select('id,league_id,user_id,role,status,requested_franchise_id,requested_at,approved_at')
      .eq('league_id', league)
      .eq('user_id', user)
      .in('status', ['pending', 'active'])
      .maybeSingle();

    if (membershipError) throw membershipError;
    if (!membership) return { valid: false, reason: 'not_a_member', membership: null, franchise: null };

    const { data: franchiseRow, error: franchiseError } = await D
      .from('franchises')
      .select('id,league_id,name,conference,status,archived_at')
      .eq('id', franchise)
      .eq('league_id', league)
      .maybeSingle();

    if (franchiseError) throw franchiseError;
    if (!franchiseRow) return { valid: false, reason: 'franchise_not_found', membership, franchise: null };
    if (franchiseRow.status !== 'active') return { valid: false, reason: 'franchise_inactive', membership, franchise: franchiseResult(franchiseRow) };

    const { data: franchiseAssignment, error: franchiseAssignmentError } = await D
      .from('franchise_assignments')
      .select('id,user_id')
      .eq('league_id', league)
      .eq('franchise_id', franchise)
      .eq('status', 'active')
      .maybeSingle();

    if (franchiseAssignmentError) throw franchiseAssignmentError;
    if (franchiseAssignment) return { valid: false, reason: 'franchise_owned', membership, franchise: franchiseResult(franchiseRow) };

    const { data: userAssignment, error: userAssignmentError } = await D
      .from('franchise_assignments')
      .select('id,franchise_id')
      .eq('league_id', league)
      .eq('user_id', user)
      .eq('status', 'active')
      .maybeSingle();

    if (userAssignmentError) throw userAssignmentError;
    if (userAssignment) return { valid: false, reason: 'user_already_has_franchise', membership, franchise: franchiseResult(franchiseRow) };

    return { valid: true, reason: null, membership, franchise: franchiseResult(franchiseRow) };
  }

  async function rpc(name, args, client) {
    const D = db(client);
    const { data, error } = await D.rpc(name, args);
    if (error) throw error;
    return data;
  }

  async function requestFranchiseClaim(leagueId, franchiseId, client) {
    return rpc('sbl_request_franchise', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_franchise_id: requireId(franchiseId, 'franchiseId')
    }, client);
  }

  async function approveFranchiseClaim(leagueId, userId, client) {
    return rpc('sbl_approve_franchise_claim', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_user_id: requireId(userId, 'userId')
    }, client);
  }

  async function rejectFranchiseClaim(leagueId, userId, client) {
    return rpc('sbl_reject_franchise_claim', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_user_id: requireId(userId, 'userId')
    }, client);
  }

  async function cancelFranchiseClaim(leagueId, client) {
    return rpc('sbl_cancel_franchise_claim', {
      p_league_id: requireId(leagueId, 'leagueId')
    }, client);
  }

  SBL.franchiseOwnership = {
    getFranchiseOwner,
    getUserFranchise,
    isFranchiseAvailable,
    canUserActForFranchise,
    validateFranchiseClaim,
    requestFranchiseClaim,
    approveFranchiseClaim,
    rejectFranchiseClaim,
    cancelFranchiseClaim
  };
})();
