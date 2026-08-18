/* SBL Stats UI — Phase 3: Golden Fist renderer */
(function(){
  'use strict';
  window.SBLStatsUI = window.SBLStatsUI || {};
  window.SBLStatsUI.renderGoldenFist = function(d){
    const {globalPokemonStats,weekSelectorHtml,spriteImg,escapeHtml,auditDataAttr}=d;
    const contentEl = document.getElementById('content');

    contentEl.innerHTML = `
      <div class="panel gf-panel">
        <h2>🥇 Golden Fist</h2>
        <div class="row" style="align-items:flex-end;">
          <div><label>Scope</label>${weekSelectorHtml('gfWeek')}</div>
        </div>
        <div class="note" style="margin-bottom:12px;">Ranked by Kills − Deaths. Ties broken by total kills.</div>
        <div id="gfList"></div>
      </div>`;

    const gfSel = document.getElementById('gfWeek');
    function drawGF(){
      const stats = globalPokemonStats(gfSel.value)
        .map(s => ({...s, diff: s.kills - s.deaths}))
        .sort((a,b)=> b.diff - a.diff || b.kills - a.kills);
      const el = document.getElementById('gfList');
      if(stats.length === 0){ el.innerHTML = `<div class="empty-state">No data for this scope yet.</div>`; return; }
      const medals = ['🥇','🥈','🥉'];
      el.innerHTML = `<div class="gf-list">${stats.map((s,i)=>`
        <div class="gf-row ${i<3?'top'+(i+1):''}">
          <div class="gf-rank">${medals[i] || (i+1)}</div>
          ${spriteImg(s.species,'gf-sprite')}
          <div class="gf-info">
            <div class="gf-name"><span class="pokemon-click" role="button" tabindex="0" data-pokemon="${escapeHtml(s.species)}" title="Open ${escapeHtml(s.species)} profile">${escapeHtml(s.species)}</span></div>
            <div class="gf-sub"><span class="summary-kad-link" ${auditDataAttr(s.species,'kills',s.killLog,false)}>${s.kills} kills</span> · ${s.assists||0} assists · ${s.deaths} deaths · ${s.games} games</div>
          </div>
          <div class="gf-coach">${escapeHtml(Array.from(s.coaches).sort().join(', '))}</div>
          <div class="gf-diff ${s.diff<0?'neg':''}">${s.diff>0?'+':''}${s.diff}</div>
        </div>`).join('')}</div>`;
    }
    gfSel.addEventListener('change', drawGF);

    drawGF();
  };
})();
