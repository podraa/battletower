
/*
 * SBL SHARED AUTH
 *
 * Centralized session/profile helpers. This is intentionally a thin layer
 * around the existing Supabase auth/profile model; it does not change auth
 * behavior or database structure.
 */
(function () {
  'use strict';

  window.SBL = window.SBL || {};

  function client() {
    return window.SBL.getSupabase();
  }

  async function getSession() {
    const { data, error } = await client().auth.getSession();
    if (error) throw error;
    return data?.session || null;
  }

  async function getUser() {
    const session = await getSession();
    return session?.user || null;
  }

  async function getProfile(userId) {
    const user = userId || (await getUser())?.id;
    if (!user) return null;

    const { data, error } = await client()
      .from('profiles')
      .select('*')
      .eq('id', user)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  async function requireLogin() {
    const session = await getSession();
    if (!session?.user) {
      throw new Error('You must be logged in.');
    }
    return session;
  }

  async function isCommissioner(userId) {
    const profile = await getProfile(userId);
    return !!profile?.is_commissioner;
  }

  function onAuthStateChange(callback) {
    return client().auth.onAuthStateChange(callback);
  }

  window.SBL.auth = {
    getSession,
    getUser,
    getProfile,
    requireLogin,
    isCommissioner,
    onAuthStateChange
  };
})();
