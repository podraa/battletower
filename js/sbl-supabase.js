
/*
 * SBL SHARED SUPABASE CLIENT
 *
 * One connection definition for the entire site.
 * Pages should use:
 *   const { supabase } = window.SBL;
 */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://dfxdkkemltukxaklhcpo.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_H7iIBiJTxY77lBAcpJn2VQ_u2hAG2CN';

  window.SBL = window.SBL || {};

  let client = null;

  function getClient() {
    if (client) return client;

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase library has not loaded yet.');
    }

    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return client;
  }

  window.SBL.getSupabase = getClient;

  Object.defineProperty(window.SBL, 'supabase', {
    configurable: true,
    get: getClient
  });
})();
