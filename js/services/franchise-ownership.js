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

  async function loadActiveOwnershipMap(leagueId, client) {
    const league = requireId(leagueId, 'leagueId');
    const D = db(client);
    const { data, error } = await D
      .from('franchise_assignments')
      .select('franchise_id,user_id')
      .eq('league_id', league)
      .eq('status', 'active');
    if (error) throw error;
    const map = new Map();
    for (const row of (data || [])) {
      if (row?.franchise_id && row?.user_id) {
        map.set(String(row.franchise_id), String(row.user_id));
      }
    }
    return map;
  }

  async function getFranchiseOwner(leagueId, franchiseId, client) {
    const league = requireId(leagueId, 'leagueId');
    const franchise = requireId(franchiseId, 'franchiseId');
    const D = db(client);

    const ownership = await loadActiveOwnershipMap(league, D);
    const ownerUserId = ownership.get(franchise);
    if (!ownerUserId) return null;
    const { data: membership, error: membershipError } = await D
      .from('league_members').select('status,member_type')
      .eq('league_id', league).eq('user_id', ownerUserId).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || String(membership.status || '').toLowerCase() !== 'active' || String(membership.member_type || 'player') !== 'player') return null;

    const { data: assignment, error: assignmentError } = await D
      .from('franchise_assignments')
      .select('id,league_id,franchise_id,user_id,status,assigned_at,vacated_at')
      .eq('league_id', league)
      .eq('franchise_id', franchise)
      .eq('user_id', ownerUserId)
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
    if (String(franchiseRow.status || '').toLowerCase() !== 'active') return null;

    return assignmentResult(assignment, franchiseRow);
  }

  async function listActiveMemberFranchises(leagueId, client) {
    const league = requireId(leagueId, 'leagueId');
    const D = db(client);
    const { data: members, error: memberError } = await D
      .from('league_members')
      .select('user_id,role,member_type,status')
      .eq('league_id', league)
      .eq('status', 'active');
    if (memberError) throw memberError;
    const playerIds = [...new Set((members || [])
      .filter(m => String(m.member_type || 'player') === 'player')
      .map(m => String(m.user_id || '')).filter(Boolean))];
    if (!playerIds.length) return [];

    const [{ data: assignments, error: assignmentError }, { data: franchises, error: franchiseError }] = await Promise.all([
      D.from('franchise_assignments').select('id,league_id,franchise_id,user_id,status,assigned_at,vacated_at')
        .eq('league_id', league).eq('status', 'active').in('user_id', playerIds),
      D.from('franchises').select('id,league_id,name,conference,status,archived_at')
        .eq('league_id', league).eq('status', 'active')
    ]);
    if (assignmentError) throw assignmentError;
    if (franchiseError) throw franchiseError;
    const byFranchise = new Map((franchises || []).map(f => [String(f.id), f]));
    const memberByUser = new Map((members || []).map(m => [String(m.user_id), m]));
    return (assignments || []).map(a => {
      const franchise = byFranchise.get(String(a.franchise_id));
      const member = memberByUser.get(String(a.user_id));
      if (!franchise || !member) return null;
      return { userId: String(a.user_id), role: member.role || 'player', memberType: member.member_type || 'player', assignment: a, franchise: franchiseResult(franchise) };
    }).filter(Boolean).sort((a,b) => a.franchise.name.localeCompare(b.franchise.name, undefined, {sensitivity:'base'}));
  }

  async function getUserFranchise(leagueId, userId, client) {
    const league = requireId(leagueId, 'leagueId');
    const user = requireId(userId, 'userId');
    const D = db(client);
    const { data: membership, error: membershipError } = await D
      .from('league_members').select('status,member_type')
      .eq('league_id', league).eq('user_id', user).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || String(membership.status || '').toLowerCase() !== 'active' || String(membership.member_type || 'player') !== 'player') return null;

    const ownership = await loadActiveOwnershipMap(league, D);
    const franchiseId = [...ownership.entries()].find(([, assignedUserId]) => String(assignedUserId) === user)?.[0];
    if (!franchiseId) return null;

    const { data: assignment, error: assignmentError } = await D
      .from('franchise_assignments')
      .select('id,league_id,franchise_id,user_id,status,assigned_at,vacated_at')
      .eq('league_id', league)
      .eq('franchise_id', franchiseId)
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
    if (String(franchiseRow.status || '').toLowerCase() !== 'active') return null;

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

    const ownership = await loadActiveOwnershipMap(league, D);
    return !ownership.has(franchise);
  }

  async function canUserActForFranchise(leagueId, userId, franchiseId, client) {
    const league = requireId(leagueId, 'leagueId');
    const user = requireId(userId, 'userId');
    const franchise = requireId(franchiseId, 'franchiseId');
    const D = db(client);

    const { data: membership, error: membershipError } = await D
      .from('league_members').select('status,member_type')
      .eq('league_id', league).eq('user_id', user).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || String(membership.status || '').toLowerCase() !== 'active' || String(membership.member_type || 'player') !== 'player') return false;
    const ownership = await loadActiveOwnershipMap(league, D);
    if (ownership.get(franchise) !== user) return false;
    const { data: franchiseRow, error: franchiseError } = await D
      .from('franchises').select('id,status').eq('id', franchise).eq('league_id', league).maybeSingle();
    if (franchiseError) throw franchiseError;
    return String(franchiseRow?.status || '').toLowerCase() === 'active';
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

    const ownership = await loadActiveOwnershipMap(league, D);
    if (ownership.has(franchise)) return { valid: false, reason: 'franchise_owned', membership, franchise: franchiseResult(franchiseRow) };
    if ([...ownership.values()].some(ownerUserId => String(ownerUserId) === user)) {
      return { valid: false, reason: 'user_already_has_franchise', membership, franchise: franchiseResult(franchiseRow) };
    }

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

  async function removeLeagueMember(leagueId, userId, client, lock = false) {
    return rpc('sbl_remove_league_member', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_user_id: requireId(userId, 'userId'),
      p_lock: !!lock
    }, client);
  }

  async function rejectLeagueMembership(leagueId, userId, client) {
    return rpc('sbl_reject_league_membership', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_user_id: requireId(userId, 'userId')
    }, client);
  }

  async function approveMembershipAndAssign(leagueId, userId, franchiseId = null, client) {
    return rpc('sbl_approve_membership_and_assign', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_user_id: requireId(userId, 'userId'),
      p_franchise_id: franchiseId ? requireId(franchiseId, 'franchiseId') : null
    }, client);
  }

  async function commissionerAssignFranchise(leagueId, userId, franchiseId, client) {
    return rpc('sbl_commissioner_assign_franchise', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_user_id: requireId(userId, 'userId'),
      p_franchise_id: requireId(franchiseId, 'franchiseId')
    }, client);
  }

  async function vacateFranchise(leagueId, franchiseId, userId, client, lock = false) {
    return rpc('sbl_vacate_franchise', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_franchise_id: requireId(franchiseId, 'franchiseId'),
      p_user_id: requireId(userId, 'userId'),
      p_lock: !!lock
    }, client);
  }

  async function reassignFranchise(leagueId, franchiseId, fromUserId, toUserId, client) {
    return rpc('sbl_reassign_franchise', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_franchise_id: requireId(franchiseId, 'franchiseId'),
      p_from_user_id: requireId(fromUserId, 'fromUserId'),
      p_to_user_id: requireId(toUserId, 'toUserId')
    }, client);
  }

  async function lockFranchise(leagueId, franchiseId, reason, client) {
    const trimmed = String(reason || '').trim();
    if (!trimmed) throw new Error('A lock reason is required.');
    return rpc('sbl_lock_franchise', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_franchise_id: requireId(franchiseId, 'franchiseId'),
      p_reason: trimmed
    }, client);
  }

  async function reopenFranchise(leagueId, franchiseId, client) {
    return rpc('sbl_reopen_franchise', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_franchise_id: requireId(franchiseId, 'franchiseId')
    }, client);
  }


  async function setSeasonMemberStatus(leagueId, seasonId, userId, status, client) {
    return rpc('sbl_set_season_member_status', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_season_id: requireId(seasonId, 'seasonId'),
      p_user_id: requireId(userId, 'userId'),
      p_status: String(status || '')
    }, client);
  }

  async function resetFranchiseMappings(leagueId, seasonId, client) {
    return rpc('sbl_reset_franchise_mappings', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_season_id: requireId(seasonId, 'seasonId')
    }, client);
  }

  async function archiveFranchise(leagueId, franchiseId, client) {
    return rpc('sbl_archive_franchise', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_franchise_id: requireId(franchiseId, 'franchiseId')
    }, client);
  }

  async function restoreFranchise(leagueId, franchiseId, client) {
    return rpc('sbl_restore_franchise', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_franchise_id: requireId(franchiseId, 'franchiseId')
    }, client);
  }

  async function addLeagueMember(leagueId, userId, role, client) {
    return rpc('sbl_admin_add_league_member', {
      p_league_id: requireId(leagueId, 'leagueId'),
      p_user_id: requireId(userId, 'userId'),
      p_role: String(role || 'player')
    }, client);
  }

  SBL.franchiseOwnership = {
    loadActiveOwnershipMap,
    listActiveMemberFranchises,
    getFranchiseOwner,
    getUserFranchise,
    isFranchiseAvailable,
    canUserActForFranchise,
    validateFranchiseClaim,
    requestFranchiseClaim,
    approveFranchiseClaim,
    rejectFranchiseClaim,
    cancelFranchiseClaim,
    removeLeagueMember,
    approveMembershipAndAssign,
    commissionerAssignFranchise,
    rejectLeagueMembership,
    vacateFranchise,
    reassignFranchise,
    lockFranchise,
    reopenFranchise,
    resetFranchiseMappings,
    setSeasonMemberStatus,
    archiveFranchise,
    restoreFranchise,
    addLeagueMember
  };
})();
