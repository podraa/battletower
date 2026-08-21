/*
 * SBL PROFILES SERVICE
 *
 * Phase 6D: centralizes profile-table reads and mutations used by page UIs.
 * Authentication/session ownership remains in js/auth.js; this module owns
 * profile data access so pages do not duplicate Supabase queries.
 */
(function () {
  'use strict';

  window.SBL = window.SBL || {};
  window.SBL.services = window.SBL.services || {};
  const SBL = window.SBL;

  function client(db) {
    return db || SBL.getSupabase();
  }

  async function get(userId, fields = '*', db) {
    if (!userId) return null;
    const { data, error } = await client(db)
      .from('profiles')
      .select(fields)
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function list(options = {}, db) {
    let query = client(db).from('profiles').select(options.fields || '*');
    if (options.orderBy) {
      query = query.order(options.orderBy, { ascending: options.ascending !== false });
    }
    if (options.status) query = query.eq('status', options.status);
    if (options.excludeUserId) query = query.neq('id', options.excludeUserId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function create(payload, db) {
    const { data, error } = await client(db)
      .from('profiles')
      .insert(payload || {})
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function update(userId, patch, db) {
    if (!userId) throw new Error('Profile id is required.');
    const { data, error } = await client(db)
      .from('profiles')
      .update(patch || {})
      .eq('id', userId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  SBL.services.profiles = { get, list, create, update };
  SBL.profiles = SBL.services.profiles;
})();
