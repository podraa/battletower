(function(){
  'use strict';
  const SBL=window.SBL=window.SBL||{};
  const esc=(v)=>SBL.pokemon?.escapeHtml ? SBL.pokemon.escapeHtml(String(v ?? '')) : String(v ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const $=(s)=>document.querySelector(s);
  function setLeagueStatus(message){const el=$('#leagueDeleteStatus');if(el)el.textContent=message||'';}

  let currentUser=null;
  let healthData=null;
  let users=[];
  let leagues=[];
  let testAccounts=[];
  let changeLogEntries=[];
  let superAdmin=false;

  function setError(message){
    const el=$('#adminHubError');
    if(!el) return;
    el.textContent=message || '';
    el.hidden=!message;
  }

  function formatTime(value){
    if(!value) return '—';
    const d=new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString([], {dateStyle:'medium',timeStyle:'short'});
  }

  function statusClass(status){
    const value=String(status||'').toLowerCase();
    return value==='healthy'||value==='reachable'||value==='active' ? 'is-good' : value==='suspended'||value==='archived' ? 'is-muted' : 'is-warn';
  }

  function displayNameForUser(userId){
    const id=String(userId||'').trim();
    const user=users.find(u=>String(u?.id||'').trim()===id);
    return String(user?.username||'').trim() || 'Unknown user';
  }

  function renderHealth(){
    const grid=$('#healthGrid');
    if(!grid || !healthData) return;
    const db=healthData.database||{};
    const cards=[
      ['Database',db.status,'Core database reachable',statusClass(db.status)],
      ['Authentication',healthData.authentication?.status,'Session and auth layer reachable',statusClass(healthData.authentication?.status)],
      ['Active leagues',db.active_leagues ?? healthData.active_leagues ?? 0,'Currently active platform leagues','is-neutral'],
      ['Registered users',db.users ?? '—','Use Users below for the full directory','is-neutral'],
      ['League members',db.league_members ?? 0,'Active and historical memberships','is-neutral'],
      ['League replays',db.league_replays ?? 0,'Normalized replay records','is-neutral'],
      ['Legacy state',db.legacy_dashboard_rows ?? 0,'Legacy dashboard source rows still retained','is-neutral'],
      ['Site admins',healthData.site_admins ?? 0,'Active platform administrators','is-neutral']
    ];
    grid.innerHTML=cards.map(([label,value,note,cls])=>`<article class="health-card"><div class="health-card-top"><span>${esc(label)}</span><span class="health-dot ${cls}"></span></div><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');
    $('#healthTimestamp').textContent=`Checked ${formatTime(healthData.checked_at)}`;
  }

  function renderLeagues(){
    const wrap=$('#leagueTable');
    if(!wrap) return;
    if(!leagues.length){ wrap.innerHTML='<div class="site-admin-empty">No leagues found.</div>'; return; }
    wrap.innerHTML=`<table><thead><tr><th>League</th><th>Status</th><th>Members</th><th>Franchises</th><th>Created</th><th>ID</th><th>Action</th></tr></thead><tbody>${leagues.map(l=>`<tr><td><strong>${esc(l.name)}</strong><span class="cell-sub">${esc(l.description||'')}</span></td><td><span class="status-chip ${statusClass(l.status)}">${esc(l.status)}</span></td><td class="num">${esc(l.member_count)}</td><td class="num">${esc(l.franchise_count)}</td><td>${esc(formatTime(l.created_at))}</td><td><code>${esc(l.id)}</code></td><td><button type="button" class="table-action danger-btn" data-delete-league="${esc(l.id)}">Delete league</button></td></tr>`).join('')}</tbody></table>`;
    wrap.querySelectorAll('[data-delete-league]').forEach(button=>button.addEventListener('click',async()=>{
      const league=leagues.find(item=>String(item.id)===String(button.dataset.deleteLeague));
      if(!league)return;
      const name=String(league.name||'').trim();
      const warning=`Permanently delete "${name}"?\n\nThis removes the league and its operational records, including memberships, franchise definitions/assignments, seasons, draft, fixtures, trades and league-scoped replay data.\n\nImported sbl_legacy_* archive seasons, results, replays, mappings and audit records will be detached and preserved. Registered accounts, profiles and other leagues are not deleted.\n\nThis cannot be undone.`;
      if(!window.confirm(warning))return;
      const typed=window.prompt(`Type the exact league name to confirm deletion:\n${name}`);
      if(typed===null)return;
      if(typed.trim()!==name){setLeagueStatus('League name did not match. Nothing was deleted.');return;}
      button.disabled=true;
      try{
        setError('');setLeagueStatus('Deleting league and preserving imported archives…');
        const result=await SBL.siteAdmin.deleteLeague(league.id,typed);
        const preserved=result?.preserved_archive_rows||{};
        const snapshots=result?.preserved_historical_snapshots||{};
        const archiveTotal=Object.values(preserved).reduce((sum,value)=>sum+Number(value||0),0);
        const snapshotTotal=Object.values(snapshots).reduce((sum,value)=>sum+Number(value||0),0);
        await load();
        setLeagueStatus(`Deleted ${name}. Preserved ${archiveTotal} imported archive rows and ${snapshotTotal} historical season/replay snapshots.`);
      }catch(error){setLeagueStatus(error?.message||'Could not delete the league.');button.disabled=false;}
    }));
  }

  function renderChangeLog(){
    const wrap=$('#changeLogTable');
    if(!wrap) return;
    if(!changeLogEntries.length){ wrap.innerHTML='<div class="site-admin-empty">No change-log entries recorded yet.</div>'; return; }
    const typeLabel=(value)=>String(value||'change').replace(/(^|_)([a-z])/g,(_,a,b)=>b.toUpperCase());
    wrap.innerHTML=changeLogEntries.map(entry=>`<article class="change-log-entry"><div class="change-log-meta"><span class="change-log-version">${esc(entry.build_version)}</span><span class="status-chip is-neutral">${esc(typeLabel(entry.change_type))}</span><time>${esc(formatTime(entry.created_at))}</time></div><h3>${esc(entry.title)}</h3><p>${esc(entry.summary)}</p>${entry.details?`<details><summary>Details</summary><div>${esc(entry.details).replace(/\n/g,'<br>')}</div></details>`:''}</article>`).join('');
  }

  function wireChangeLog(){
    const button=$('#addChangeLog');
    if(!button) return;
    button.addEventListener('click',async()=>{
      const version=$('#changeVersion')?.value.trim();
      const type=$('#changeType')?.value;
      const title=$('#changeTitle')?.value.trim();
      const summary=$('#changeSummary')?.value.trim();
      const details=$('#changeDetails')?.value.trim();
      if(!version||!title||!summary){setError('Build/version, change title, and summary are required.');return;}
      button.disabled=true;
      try{
        setError('');
        await SBL.siteAdmin.addChangeLog(version,type,title,summary,details);
        $('#changeVersion').value=''; $('#changeTitle').value=''; $('#changeSummary').value=''; $('#changeDetails').value='';
        changeLogEntries=await SBL.siteAdmin.changeLog();
        renderChangeLog();
      }catch(e){setError(e.message||'Could not record change.');}
      finally{button.disabled=false;}
    });
  }

  function renderRegisteredAccounts(){
    const wrap=$('#registeredAccountTable');if(!wrap)return;
    if(!users.length){wrap.innerHTML='<div class="site-admin-empty">No registered accounts found.</div>';return;}
    wrap.innerHTML=`<table><thead><tr><th>Account</th><th>Email</th><th>Site role</th><th>Username action</th></tr></thead><tbody>${users.map(u=>`<tr><td><strong>${esc(String(u.username||'').trim()||'Unknown user')}</strong><span class="cell-sub"><code>${esc(u.id)}</code></span></td><td>${esc(u.email||'—')}</td><td>${esc(u.site_role||'User')}</td><td><button class="table-action" data-account-username="${esc(u.id)}">Change username</button></td></tr>`).join('')}</tbody></table>`;
    wrap.querySelectorAll('[data-account-username]').forEach(btn=>btn.addEventListener('click',async()=>{
      const target=users.find(u=>String(u.id)===String(btn.dataset.accountUsername));if(!target)return;
      const next=prompt(`Set username for ${target.username||target.email||'this account'}:`,target.username||'');if(next===null)return;
      const clean=next.trim();if(!/^[A-Za-z0-9_-]{2,24}$/.test(clean)){setError('Username must be 2–24 characters and use only letters, numbers, underscores or hyphens.');return;}
      btn.disabled=true;try{setError('');await SBL.profiles.changeUsername(target.id,clean);await load();}catch(e){setError(e.message||'Could not change username.');btn.disabled=false;}
    }));
  }


  function renderTestAccounts(){
    const table=$('#testAccountTable');
    const userSelect=$('#testAccountUserSelect');
    const leagueSelect=$('#testAccountLeagueSelect');
    if(userSelect){
      const selected=userSelect.value;
      userSelect.innerHTML='<option value="">Choose an account…</option>'+users.map(u=>`<option value="${esc(u.id)}">${esc(String(u.username||u.email||'Unknown user'))} · ${esc(u.email||u.id)}</option>`).join('');
      if(selected) userSelect.value=selected;
    }
    if(leagueSelect){
      const selected=leagueSelect.value;
      leagueSelect.innerHTML='<option value="">Choose a league…</option>'+leagues.map(l=>`<option value="${esc(l.id)}">${esc(l.name||'Unnamed league')}</option>`).join('');
      if(selected) leagueSelect.value=selected;
    }
    if(!table)return;
    if(!testAccounts.length){
      table.innerHTML='<div class="site-admin-empty">No league-scoped test accounts are currently marked.</div>';
      return;
    }
    table.innerHTML=`<table><thead><tr><th>Account</th><th>League</th><th>Membership</th><th>League role</th><th>Marked</th><th>Action</th></tr></thead><tbody>${testAccounts.map(row=>`<tr><td><strong>${esc(row.username||'Unknown user')}</strong><span class="cell-sub">${esc(row.email||row.user_id)}</span></td><td><strong>${esc(row.league_name||'Unknown league')}</strong><span class="cell-sub"><code>${esc(row.league_id)}</code></span></td><td>${esc(row.membership_status||'—')}</td><td>${esc(row.role||'player')}</td><td>${esc(formatTime(row.created_at))}</td><td><button type="button" class="table-action" data-test-account-player data-league="${esc(row.league_id)}" data-user="${esc(row.user_id)}">Convert to player</button></td></tr>`).join('')}</tbody></table>`;
  }

  function wireTestAccounts(){
    const add=$('#markTestAccount');
    const status=$('#testAccountStatus');
    add?.addEventListener('click',async()=>{
      const userId=$('#testAccountUserSelect')?.value||'';
      const leagueId=$('#testAccountLeagueSelect')?.value||'';
      if(!userId||!leagueId){if(status)status.textContent='Choose both an account and a league.';return;}
      add.disabled=true;
      try{
        if(status)status.textContent='Updating league-scoped test-account classification…';
        await SBL.siteAdmin.setTestAccount(leagueId,userId,'test_account');
        if(status)status.textContent='Account marked as a test account for that league.';
        await load();
      }catch(error){if(status)status.textContent=error?.message||'Could not mark this account as a test account.';}
      finally{add.disabled=false;}
    });
    $('#testAccountTable')?.addEventListener('click',async event=>{
      const button=event.target.closest('[data-test-account-player]');
      if(!button)return;
      button.disabled=true;
      try{
        await SBL.siteAdmin.setTestAccount(button.dataset.league,button.dataset.user,'player');
        if(status)status.textContent='Account returned to the normal player category for that league.';
        await load();
      }catch(error){if(status)status.textContent=error?.message||'Could not update test-account classification.';button.disabled=false;}
    });
  }

  function renderAdmins(){
    const wrap=$('#adminTable');
    if(!wrap) return;
    wrap.innerHTML=`<div class="admin-access-form"><div><label for="adminUserSelect">Authorize user</label><select id="adminUserSelect"><option value="">Choose a user…</option>${users.map(u=>`<option value="${esc(u.id)}">${esc(String(u.username||'').trim() || 'Unknown user')}</option>`).join('')}</select></div><div><label for="adminRoleSelect">Role</label><select id="adminRoleSelect"><option value="admin">Admin</option><option value="super_admin">Super admin</option></select></div><div><label>&nbsp;</label><button class="site-admin-button primary" id="grantAdmin" type="button">Authorize</button></div></div><table><thead><tr><th>User</th><th>Site role</th><th>League commissioner</th><th>Status</th><th>Action</th></tr></thead><tbody>${users.filter(u=>u.site_role).map(u=>`<tr><td><strong>${esc(String(u.username||'').trim() || 'Unknown user')}</strong></td><td>${esc(u.site_role)}</td><td>${u.is_commissioner ? 'Yes' : 'No'}</td><td><span class="status-chip ${statusClass(u.site_status)}">${esc(u.site_status)}</span></td><td><button class="table-action" data-admin-user="${esc(u.id)}" data-admin-status="${u.site_status==='active'?'suspended':'active'}">${u.site_status==='active'?'Suspend':'Activate'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="site-admin-empty">No site administrators configured.</td></tr>'}</tbody></table>`;
    $('#grantAdmin')?.addEventListener('click',async()=>{
      const userId=$('#adminUserSelect')?.value;
      if(!userId){setError('Choose a user first.');return;}
      try{setError(''); await SBL.siteAdmin.setAdmin(userId,$('#adminRoleSelect').value,'active'); await load();}catch(e){setError(e.message||'Could not authorize user.');}
    });
    wrap.querySelectorAll('[data-admin-user]').forEach(btn=>btn.addEventListener('click',async()=>{
      try{setError(''); await SBL.siteAdmin.setAdmin(btn.dataset.adminUser,'admin',btn.dataset.adminStatus); await load();}catch(e){setError(e.message||'Could not update administrator.');}
    }));
  }

  async function load(){
    $('#refreshHealth').disabled=true;
    try{
      const base=[SBL.siteAdmin.health(),SBL.siteAdmin.leagues(),SBL.siteAdmin.users(),SBL.siteAdmin.testAccounts()];
      if(superAdmin) base.push(SBL.siteAdmin.changeLog());
      const results=await Promise.all(base);
      [healthData,leagues,users,testAccounts]=results;
      if(superAdmin) changeLogEntries=results[4]||[];
      renderHealth(); renderLeagues(); renderRegisteredAccounts(); renderTestAccounts(); renderAdmins();
      if(superAdmin) renderChangeLog();
    }catch(e){setError(e.message||'Could not load site administration data.');}
    finally{$('#refreshHealth').disabled=false;}
  }

  async function init(){
    try{
      const session=await SBL.auth.requireLogin();
      currentUser=session.user;
      const allowed=await SBL.siteAdmin.isSiteAdmin(currentUser.id);
      if(!allowed){ location.replace('index.html'); return; }
      superAdmin=await SBL.siteAdmin.isSuperAdmin(currentUser.id);
      const profile=await SBL.auth.getProfile(currentUser.id);
      $('#adminIdentity').textContent=`${String(profile?.username||'').trim() || displayNameForUser(currentUser.id)} · ${superAdmin?'Super admin':'Site admin'}`;
      $('#changeLogSection').hidden=!superAdmin;
      $('#app').style.display='';
      $('#refreshHealth').addEventListener('click',load);
      if(superAdmin) wireChangeLog();
      wireTestAccounts();
      await load();
    }catch(e){
      setError(e.message||'You are not authorized to access the Admin Hub.');
      setTimeout(()=>location.replace('index.html'),1200);
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
