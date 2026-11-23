/*
 * SBL TEAM ROSTER POP-OUT (CP4.63)
 *
 * Click anything marked data-team-popup="<team name>" to open that team's
 * roster in an isolated dialog, coloured with the team's colour and showing
 * the owner username(s). Read-only: it only renders data the page already has.
 *
 *   SBL.teamPopup.bind(document, () => ({ settings, teamMap, rosters }));
 */
(function () {
  'use strict';
  window.SBL = window.SBL || {};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TC = () => window.SBL.teamColors;
  let lastFocus = null;

  function rosterFor(rosters, team) {
    const k = TC().key(team);
    for (const [name, list] of Object.entries(rosters || {})) {
      if (TC().key(name) === k) {
        return (Array.isArray(list) ? list : []).map(e => typeof e === 'string' ? { name: e, points: null } : { name: e && e.name, points: e && e.points }).filter(e => e.name);
      }
    }
    return [];
  }
  function close() {
    const el = document.getElementById('sblTeamPopup');
    if (el) el.remove();
    document.body.classList.remove('team-popup-open');
    document.removeEventListener('keydown', onKey, true);
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (_) { /* ignore */ }
  }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

  function open(ctx, team) {
    if (!team) return;
    close();
    lastFocus = document.activeElement;
    const settings = (ctx && ctx.settings) || {};
    const color = TC().get(settings, team);
    const owners = TC().usernamesFor(ctx && ctx.teamMap, team);
    const roster = rosterFor(ctx && ctx.rosters, team).slice().sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0) || String(a.name).localeCompare(String(b.name)));
    const spent = roster.reduce((n, m) => n + (Number(m.points) || 0), 0);
    const spriteOf = name => { try { return window.SBL.pokemon.spriteMarkup(name, 'tp-sprite'); } catch (_) { return ''; } };
    const nameOf = name => { try { return window.SBL.pokemon.displayNameWithForm(name) || name; } catch (_) { return name; } };
    const isMega = m => { try { return !!window.SBL.pokemon.isMega(m.name); } catch (_) { return false; } };
    const megas = roster.filter(isMega).length;
    const wrap = document.createElement('div');
    wrap.id = 'sblTeamPopup';
    wrap.className = 'team-popup-backdrop';
    wrap.innerHTML = `<div class="team-popup${color ? ' team-tinted' : ''}" role="dialog" aria-modal="true" aria-labelledby="tpTitle"${color ? ` style="--team-color:${color}"` : ''}>
      <header class="tp-head"><div><h2 id="tpTitle">${esc(team)}</h2>${owners.length ? `<div class="tp-owner">${owners.map(u => '@' + esc(u)).join(' \u00b7 ')}</div>` : ''}</div><button type="button" class="tp-close" aria-label="Close roster">\u2715</button></header>
      <div class="tp-meta"><span>${roster.length} Pok\u00e9mon</span><span>${spent} pts</span>${megas ? `<span>${megas} Mega${megas === 1 ? '' : 's'}</span>` : ''}</div>
      <div class="tp-grid">${roster.length ? roster.map(m => `<div class="tp-mon">${spriteOf(m.name)}<div><strong>${esc(nameOf(m.name))}</strong>${m.points == null || m.points === '' ? '' : `<span>${esc(m.points)} pts</span>`}${typeof ctx?.getPokemonHistory==='function'?`<button type="button" class="tp-history-btn" data-tp-history="${esc(m.name)}" aria-label="View ${esc(nameOf(m.name))} match history">Match history</button>`:''}</div></div>`).join('') : '<div class="tp-empty">No Pok\u00e9mon on this roster yet.</div>'}</div><div class="tp-history" data-tp-history-panel hidden role="status" aria-live="polite"></div></div>`;
    let historyEpoch=0;
    wrap.addEventListener('click', async e => {
      if (e.target === wrap || e.target.closest('.tp-close')) { close(); return; }
      const button=e.target.closest('[data-tp-history]');
      if(!button || typeof ctx?.getPokemonHistory!=='function')return;
      const species=button.dataset.tpHistory;
      const panel=wrap.querySelector('[data-tp-history-panel]');
      const epoch=++historyEpoch;
      panel.hidden=false;
      panel.innerHTML=`<h3>${esc(nameOf(species))} · Match history</h3><div class="tp-history-loading">Loading recorded games…</div>`;
      try{
        const rows=await ctx.getPokemonHistory(team,species);
        if(epoch!==historyEpoch || !wrap.isConnected)return;
        const list=Array.isArray(rows)?rows:[];
        panel.innerHTML=`<h3>${esc(nameOf(species))} · Match history</h3>`+(list.length
          ? `<p>${list.length} recorded game${list.length===1?'':'s'} · ${list.reduce((n,r)=>n+(Number(r.kills)||0),0)} KOs</p><div class="tp-history-list">${list.map(row=>{
              const id=String(row.id||'');
              const replayLink=/^[a-z0-9-]{3,200}$/i.test(id) ? `<a href="https://replay.pokemonshowdown.com/${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">Replay</a>` : '';
              const outcome=row.resultKnown?(row.won?'Win':'Loss'):'Result pending';
              return `<div class="tp-history-row"><strong>${esc(outcome)} vs ${esc(row.opponent)}</strong><span>${esc(row.week?`Week ${row.week}`:'Week unavailable')} · ${esc((row.species||[]).join(', '))}</span><span>${Number(row.kills)||0} KOs · ${Number(row.deaths)||0} deaths · ${Number(row.dealt)||0} damage dealt ${replayLink}</span></div>`;
            }).join('')}</div>`
          : '<p>No recorded games for this Pokémon in the selected season.</p>');
      }catch(error){
        if(epoch!==historyEpoch||!wrap.isConnected)return;
        panel.innerHTML=`<h3>${esc(nameOf(species))} · Match history</h3><p>Unable to load history: ${esc(error?.message||error)}</p>`;
      }
    });
    document.body.appendChild(wrap);
    document.body.classList.add('team-popup-open');
    document.addEventListener('keydown', onKey, true);
    const btn = wrap.querySelector('.tp-close'); if (btn) btn.focus();
  }

  function bind(root, getCtx) {
    (root || document).addEventListener('click', e => {
      const t = e.target.closest && e.target.closest('[data-team-popup]');
      if (!t) return;
      e.preventDefault();
      open(getCtx ? getCtx() : {}, t.getAttribute('data-team-popup'));
    });
    (root || document).addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target.closest && e.target.closest('[data-team-popup]');
      if (!t || t.tagName === 'BUTTON' || t.tagName === 'A') return;
      e.preventDefault();
      open(getCtx ? getCtx() : {}, t.getAttribute('data-team-popup'));
    });
  }
  window.SBL.teamPopup = { open, close, bind };
})();
