(function(){
  'use strict';
  const SBL=window.SBL=window.SBL||{};
  const esc=(v)=>SBL.pokemon?.escapeHtml ? SBL.pokemon.escapeHtml(String(v ?? '')) : String(v ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const $=(s)=>document.querySelector(s);

  let currentUser=null;
  let healthData=null;
  let users=[];
  let leagues=[];
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
    wrap.innerHTML=`<table><thead><tr><th>League</th><th>Status</th><th>Members</th><th>Franchises</th><th>Created</th><th>ID</th></tr></thead><tbody>${leagues.map(l=>`<tr><td><strong>${esc(l.name)}</strong><span class="cell-sub">${esc(l.description||'')}</span></td><td><span class="status-chip ${statusClass(l.status)}">${esc(l.status)}</span></td><td class="num">${esc(l.member_count)}</td><td class="num">${esc(l.franchise_count)}</td><td>${esc(formatTime(l.created_at))}</td><td><code>${esc(l.id)}</code></td></tr>`).join('')}</tbody></table>`;
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

  function renderAdmins(){
    const wrap=$('#adminTable');
    if(!wrap) return;
    wrap.innerHTML=`<div class="admin-access-form"><div><label for="adminUserSelect">Authorize user</label><select id="adminUserSelect"><option value="">Choose a user…</option>${users.map(u=>`<option value="${esc(u.id)}">${esc(u.username||u.email||u.id)}${u.email && u.username ? ` — ${esc(u.email)}` : ''}</option>`).join('')}</select></div><div><label for="adminRoleSelect">Role</label><select id="adminRoleSelect"><option value="admin">Admin</option><option value="super_admin">Super admin</option></select></div><div><label>&nbsp;</label><button class="site-admin-button primary" id="grantAdmin" type="button">Authorize</button></div></div><table><thead><tr><th>User</th><th>Site role</th><th>League commissioner</th><th>Status</th><th>Action</th></tr></thead><tbody>${users.filter(u=>u.site_role).map(u=>`<tr><td><strong>${esc(u.username||'Unnamed')}</strong><span class="cell-sub">${esc(u.email||u.id)}</span></td><td>${esc(u.site_role)}</td><td>${u.is_commissioner ? 'Yes' : 'No'}</td><td><span class="status-chip ${statusClass(u.site_status)}">${esc(u.site_status)}</span></td><td><button class="table-action" data-admin-user="${esc(u.id)}" data-admin-status="${u.site_status==='active'?'suspended':'active'}">${u.site_status==='active'?'Suspend':'Activate'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="site-admin-empty">No site administrators configured.</td></tr>'}</tbody></table>`;
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
      const base=[SBL.siteAdmin.health(),SBL.siteAdmin.leagues(),SBL.siteAdmin.users()];
      if(superAdmin) base.push(SBL.siteAdmin.changeLog());
      const results=await Promise.all(base);
      [healthData,leagues,users]=results;
      if(superAdmin) changeLogEntries=results[3]||[];
      renderHealth(); renderLeagues(); renderAdmins();
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
      $('#adminIdentity').textContent=`${profile?.username || currentUser.email || 'Site administrator'} · ${superAdmin?'Super admin':'Site admin'}`;
      $('#changeLogSection').hidden=!superAdmin;
      $('#app').style.display='';
      $('#refreshHealth').addEventListener('click',load);
      if(superAdmin) wireChangeLog();
      await load();
    }catch(e){
      setError(e.message||'You are not authorized to access the Admin Hub.');
      setTimeout(()=>location.replace('index.html'),1200);
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
