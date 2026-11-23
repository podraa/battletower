/* Shared Pokemon Profile pane: My Team, Rosters, and Match Prep. CP4.173.
 * A page supplies season performance; exact-form species data comes from the
 * shared catalogue (or a verified, exact Showdown Dex entry). No base fallback
 * is used for unknown permanent forms. */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  const SBL=window.SBL;
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pretty=x=>String(x||'').replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const statNames=[['hp','HP'],['attack','Atk'],['defense','Def'],['special-attack','SpA'],['special-defense','SpD'],['speed','Spe']];
  let dexPromise=null;
  const typeNames=['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
  function idOf(name){return SBL.domain?.pokemonCatalogId?.(name)||String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
  async function profileData(species){
    try{const data=await SBL.pokemonCatalog?.getBattleProfile?.(species);if(data)return data;}
    catch(error){console.warn('Battle catalogue profile unavailable:',error);}
    if(!dexPromise){dexPromise=fetch('https://play.pokemonshowdown.com/data/pokedex.json',{cache:'force-cache'}).then(r=>{if(!r.ok)throw new Error('Pokédex unavailable');return r.json();}).catch(()=>null);}
    const dex=await dexPromise;
    if(!dex)return null;
    const key=idOf(species);
    const exact=Object.entries(dex).find(([k])=>k.toLowerCase().replace(/[^a-z0-9]/g,'')===key)?.[1];
    if(!exact)return null;
    const raw=exact.baseStats||{};
    return {stats:{hp:raw.hp,attack:raw.atk,defense:raw.def,'special-attack':raw.spa,'special-defense':raw.spd,speed:raw.spe},types:exact.types||[],abilities:Object.values(exact.abilities||{}),source:'showdown-exact-form'};
  }
  function pane({performance={}}={}){
    const p=performance||{};
    const metrics=[['Appearances',p.appearances??p.games??0],['KOs',p.kills??0],['Deaths',p.deaths??0],['Damage dealt',Math.round(Number(p.dealt)||0)],['Damage taken',Math.round(Number(p.taken)||0)]];
    return `<div class="shared-pokemon-profile" data-shared-pokemon-profile>
      <div class="scout-popup-section"><h3>Performance</h3><div class="scout-performance-grid">${metrics.map(([label,n])=>`<div class="scout-performance-stat"><span>${esc(label)}</span><strong>${esc(n)}</strong></div>`).join('')}</div></div>
      <div class="scout-popup-section"><h3>Abilities</h3><div id="prepScoutAbilities" class="scout-abilities"><div class="muted">Loading…</div></div></div>
      <div class="scout-popup-columns"><div class="scout-popup-section"><h3>Base stat spread</h3><div id="prepScoutBaseStats" class="scout-base-grid"><div class="muted">Loading…</div></div><div id="prepScoutBaseTotal"></div><div id="prepScoutNatureStats"></div></div>
      <div class="scout-popup-section"><h3>Type effectiveness</h3><div id="prepScoutTypeEffectiveness"><div class="muted">Loading…</div></div></div></div>
    </div>`;
  }
  async function fill(container,{species,loadProfile}={}){
    const root=container?.querySelector?.('[data-shared-pokemon-profile]')||container;
    if(!root?.querySelector?.('#prepScoutBaseStats'))return;
    const set=(id,html)=>{if(root.isConnected!==false){const el=root.querySelector('#'+id);if(el)el.innerHTML=html;}};
    try{
      const data=await (typeof loadProfile==='function'?loadProfile(species):profileData(species));
      if(!data){
        set('prepScoutBaseStats','<div class="muted">Exact-form stats unavailable.</div>');
        set('prepScoutAbilities','<div class="muted">Exact-form abilities unavailable.</div>');
        set('prepScoutTypeEffectiveness','<div class="muted">Exact-form type data unavailable.</div>');return;
      }
      const stats=data.stats||{};
      set('prepScoutBaseStats',statNames.map(([key,label])=>{const val=Number(stats[key])||0;return `<div class="scout-base-stat"><div class="scout-base-stat-head"><span>${label}</span><strong>${val||'—'}</strong></div><div class="scout-stat-bar"><i style="width:${Math.min(100,val/180*100)}%"></i></div></div>`;}).join(''));
      set('prepScoutBaseTotal',`<div class="scout-stat-total"><span>Total base stats</span><strong>${statNames.reduce((sum,[key])=>sum+(Number(stats[key])||0),0)}</strong></div>`);
      const calc=(base,hp,boost)=>{base=Number(base)||0;if(!base)return 0;return hp?(2*base+31+63+110):Math.floor(((2*base+31+63)+5)*(boost?1.1:1));};
      const nature=boost=>statNames.map(([key,label])=>{const v=calc(stats[key],key==='hp',boost);return `<div class="scout-nature-row"><span>${label}</span><div class="bar"><i style="width:${Math.min(100,v/500*100)}%"></i></div><strong>${v||'—'}</strong></div>`;}).join('');
      set('prepScoutNatureStats',`<div class="scout-nature-stats"><div class="scout-nature-card"><h4>Neutral nature · Lv. 100 · 31 IV / 252 EV</h4>${nature(false)}</div><div class="scout-nature-card"><h4>Boosting nature · Lv. 100 · 31 IV / 252 EV</h4>${nature(true)}</div></div>`);
      set('prepScoutAbilities',(data.abilities||[]).length?(data.abilities||[]).map(a=>`<span class="scout-ability">${esc(pretty(a))}</span>`).join(''):'<div class="muted">No abilities listed.</div>');
      const types=SBL.matchups?.normalizedTypes?.(data.types||[])||[];
      if(!types.length){set('prepScoutTypeEffectiveness','<div class="muted">Type data unavailable for this form.</div>');return;}
      const eff=(SBL.matchups?.defensiveEffectiveness?.(types)||typeNames.map(type=>({type,mult:null}))).filter(x=>x.mult!==1 && x.mult!==null);
      const mult=x=>x===0?'0×':x===.25?'¼×':x===.5?'½×':String(x)+'×';
      const group=(title,cls,rows)=>`<div class="scout-type-group ${cls}"><h4>${title}</h4>${rows.length?`<div class="scout-type-list">${rows.map(x=>`<span class="scout-type-pill">${esc(x.type)} <b>${esc(mult(x.mult))}</b></span>`).join('')}</div>`:'<div class="muted">None</div>'}</div>`;
      set('prepScoutTypeEffectiveness',`<div class="scout-type-groups">${group('Weaknesses','weak',eff.filter(x=>x.mult>1))}${group('Resistances','resist',eff.filter(x=>x.mult>0&&x.mult<1))}${group('Immunities','immune',eff.filter(x=>x.mult===0))}</div>`);
    }catch(error){set('prepScoutBaseStats',`<div class="muted">Could not load Pokémon Profile: ${esc(error?.message||error)}</div>`);}
  }
  function close(){document.getElementById('sharedPokemonProfileModal')?.remove();}
  function open({species,performance,loadProfile}={}){
    if(!species)return;
    close();
    const title=SBL.pokemon?.displayNameWithForm?.(species)||species;
    const sprite=SBL.pokemon?.spriteMarkup?.(species,'prep-sprite')||'';
    const types=(SBL.pokemonTypes?.lookupTypes?.(species)||[]).map(x=>`<span class="type-pill type-${esc(x)}">${esc(pretty(x))}</span>`).join('');
    const modal=document.createElement('div');modal.id='sharedPokemonProfileModal';modal.className='prep-detail-modal shared-pokemon-modal';
    modal.innerHTML=`<div class="prep-detail-backdrop"></div><div class="prep-detail-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)} Pokémon Profile"><button type="button" class="prep-detail-close" aria-label="Close Pokémon Profile">×</button><div class="prep-detail-summary-row"><div class="prep-card-head">${sprite}<div class="prep-detail-title"><h2>${esc(title)}</h2><div class="prep-detail-types">${types}</div></div></div></div><div class="prep-popup-nav"><div class="prep-mode-tabs"><span class="prep-mode-tab active">Pokémon Profile</span></div></div><div id="prepModeContent">${pane({performance})}</div></div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(()=>modal.classList.add('open'));
    const onKey=e=>{if(e.key==='Escape')onClose();};
    const onClose=()=>{document.removeEventListener('keydown',onKey);close();};
    modal.querySelector('.prep-detail-close').addEventListener('click',onClose);
    modal.querySelector('.prep-detail-backdrop').addEventListener('click',onClose);
    document.addEventListener('keydown',onKey);
    void fill(modal,{species,loadProfile});
  }
  SBL.pokemonProfile={pane,fill,open,close,profileData};
})();
