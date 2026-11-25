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
  function conferenceFor(ctx,team){
    const settings=ctx?.settings||{};
    const canonical=(ctx?.franchises||[]).find(row=>TC().key(row?.name)===TC().key(team));
    const legacy=settings.franchises&&typeof settings.franchises==='object'
      ?Object.entries(settings.franchises).find(([name])=>TC().key(name)===TC().key(team))?.[1]:null;
    const definition=settings.franchiseDefinitions&&typeof settings.franchiseDefinitions==='object'
      ?Object.entries(settings.franchiseDefinitions).find(([name])=>TC().key(name)===TC().key(team))?.[1]:null;
    const raw=String(canonical?.conference||legacy||definition?.conference||'').trim();
    if(!raw)return '';
    const key=raw.toLowerCase(),names=settings.conferenceNames||{};
    return String(names[key]||names[raw]||((key==='a'||key==='b')?`Conference ${key.toUpperCase()}`:raw));
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
    const conference = conferenceFor(ctx,team);
    const wrap = document.createElement('div');
    wrap.id = 'sblTeamPopup';
    wrap.className = 'team-popup-backdrop';
    wrap.innerHTML = `<div class="team-popup${color ? ' team-tinted' : ''}" role="dialog" aria-modal="true" aria-labelledby="tpTitle"${color ? ` style="--team-color:${color}"` : ''}>
      <header class="tp-head"><div class="tp-heading-copy"><h2 id="tpTitle">${esc(team)}</h2><div class="tp-subtitle">${owners.length ? `<span class="tp-owner">${owners.map(u => '@' + esc(u)).join(' · ')}</span>` : ''}${conference ? `<span class="tp-conference">${esc(conference)}</span>` : ''}</div></div><button type="button" class="tp-close" aria-label="Close roster">×</button></header>
      <div class="tp-meta"><span><strong>${roster.length}</strong><small>Pokémon</small></span><span><strong>${spent}</strong><small>Points spent</small></span>${megas ? `<span><strong>${megas}</strong><small>Mega${megas === 1 ? '' : 's'}</small></span>` : ''}</div>
      <div class="tp-grid">${roster.length ? roster.map(m => `<button type="button" class="tp-profile-btn" data-tp-profile="${esc(m.name)}" aria-label="Open Pokémon profile for ${esc(nameOf(m.name))}" title="Open Pokémon profile"><span class="tp-sprite-wrap">${spriteOf(m.name)}</span><span class="tp-profile-copy"><strong>${esc(nameOf(m.name))}</strong>${m.points == null || m.points === '' ? '' : `<span class="tp-points">${esc(m.points)} pts</span>`}</span><span class="tp-open-indicator" aria-hidden="true">›</span></button>`).join('') : '<div class="tp-empty">No Pokémon on this roster yet.</div>'}</div><div class="tp-history" data-tp-history-panel hidden role="status" aria-live="polite"></div></div>`;
    wrap.addEventListener('click',async e=>{
      if(e.target===wrap || e.target.closest('.tp-close')){close();return;}
      const button=e.target.closest('[data-tp-profile]');if(!button)return;
      const species=button.dataset.tpProfile;
      button.disabled=true;
      try{
        const performance=typeof ctx?.getPokemonProfile==='function'
          ?await ctx.getPokemonProfile(team,species):null;
        close();
        SBL.pokemonProfile?.open({species,performance});
      }catch(error){
        // A replay lookup failure must never prevent the Pokémon Data profile.
        close();SBL.pokemonProfile?.open({species});
        console.warn('Season profile performance unavailable',error);
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
