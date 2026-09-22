(function(){
  'use strict';
  window.SBL = window.SBL || {};

  function client(){ return window.SBL?.getSupabase?.() || null; }

  async function isSiteAdmin(userId){
    const db=client();
    if(!db) return false;
    const {data,error}=await db.rpc('sbl_is_site_admin',{target_user:userId || null});
    if(error) throw error;
    return data === true;
  }

  async function health(){
    const db=client();
    if(!db) throw new Error('Supabase client unavailable.');
    const {data,error}=await db.rpc('sbl_admin_health_snapshot');
    if(error) throw error;
    return data || {};
  }

  async function users(){
    const db=client();
    if(!db) throw new Error('Supabase client unavailable.');
    const {data,error}=await db.rpc('sbl_admin_list_users');
    if(error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function leagues(){
    const db=client();
    if(!db) throw new Error('Supabase client unavailable.');
    const {data,error}=await db.rpc('sbl_admin_list_leagues');
    if(error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function isSuperAdmin(userId){
    const db=client();
    if(!db) return false;
    const {data,error}=await db.rpc('sbl_is_super_admin',{target_user:userId || null});
    if(error) throw error;
    return data === true;
  }

  async function changeLog(){
    const db=client();
    if(!db) throw new Error('Supabase client unavailable.');
    const {data,error}=await db.rpc('sbl_admin_list_change_log');
    if(error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function addChangeLog(version,type,title,summary,details){
    const db=client();
    if(!db) throw new Error('Supabase client unavailable.');
    const {data,error}=await db.rpc('sbl_admin_add_change_log',{target_version:version,target_type:type,target_title:title,target_summary:summary,target_details:details || null});
    if(error) throw error;
    return data;
  }

  async function setAdmin(userId,role,status){
    const db=client();
    if(!db) throw new Error('Supabase client unavailable.');
    const {data,error}=await db.rpc('sbl_admin_set_admin',{target_user:userId,target_role:role,target_status:status});
    if(error) throw error;
    return data;
  }

  SBL.siteAdmin={isSiteAdmin,isSuperAdmin,health,users,leagues,setAdmin,changeLog,addChangeLog};
})();
