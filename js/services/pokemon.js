/* SBL shared Pokémon naming + remote sprite service.
 *
 * Sprite source: Pokémon Showdown's HOME sprite set for 3D and Gen 5-style static sprites for 2D.  This is intentionally
 * name-based rather than PokeAPI numeric IDs: Showdown stores alternate forms
 * such as deoxys-attack, aegislash-blade and terapagos-stellar as real sprite
 * filenames. That avoids the missing-form problem caused by treating every
 * form as the base National Dex number.
 *
 * There is deliberately no probing/fallback waterfall, MutationObserver,
 * preload queue, or custom image cache. One Pokémon -> one deterministic URL.
 */
(function(){
  'use strict';
  window.SBL=window.SBL||{};
  window.SBL.pokemon=window.SBL.pokemon||{};

  const SPRITE_ROOTS={
    '3d':'https://play.pokemonshowdown.com/sprites/home/',
    '2d':'https://play.pokemonshowdown.com/sprites/gen5/'
  };
  const SPRITE_PREF_KEY='sbl_sprite_style';
  function getSpriteStyle(){
    try { return localStorage.getItem(SPRITE_PREF_KEY)==='2d' ? '2d' : '3d'; } catch { return '3d'; }
  }
  function setSpriteStyle(style, persist=true){
    const next=style==='2d'?'2d':'3d';
    try { if(persist) localStorage.setItem(SPRITE_PREF_KEY,next); } catch {}
    document.documentElement.dataset.sblSpriteStyle=next;
    document.querySelectorAll('img.sbl-remote-sprite').forEach(img=>{
      const name=img.getAttribute('alt')||img.getAttribute('title')||'';
      applySpriteSource(img,name,next);
    });
    return next;
  }
  document.documentElement.dataset.sblSpriteStyle=getSpriteStyle();

  const ALIASES={
    'chiyu':'chi-yu',
    'scovilalian':'scovillain','scovillian':'scovillain','scovilion':'scovillain','cincinno':'cinccino','daschbun':'dachsbun',
    'landorus-incarnate':'landorus','landorus-i':'landorus','landorus-t':'landorus-therian',
    'tornadus-incarnate':'tornadus','tornadus-i':'tornadus','tornadus-t':'tornadus-therian',
    'thundurus-incarnate':'thundurus','thundurus-i':'thundurus','thundurs':'thundurus','thundurs-incarnate':'thundurus','thundurus-t':'thundurus-therian',
    'terapagos':'terapagos','terapogos':'terapagos','teraagos':'terapagos','terapagos-middle':'terapagos','terapagos-mid':'terapagos','meowstic-male':'meowstic','meowstic-m':'meowstic','meowstic-m':'meowstic','tauros-blaze':'tauros-paldeablaze','tauros-combat':'tauros-paldeacombat',
    'tauros-blaze':'tauros-paldeablaze','tauros-combat':'tauros-paldeacombat','taurus-blaze':'tauros-paldeablaze','taurus-combat':'tauros-paldeacombat',
    'cinccinno':'cinccino','cincinno':'cinccino','daschbun':'dachsbun',
    'enamorus-incarnate':'enamorus','enamorus-i':'enamorus','enamorus-t':'enamorus-therian',
    'hoopa-u':'hoopa-unbound','urshifu-r':'urshifu-rapid-strike','urshifu-s':'urshifu-single-strike',
    'necrozma-dm':'necrozma-dusk-mane','necrozma-dw':'necrozma-dawn-wings',
    'calyrex-ice':'calyrex-ice-rider','calyrex-shadow':'calyrex-shadow-rider',
    'aegislash':'aegislash-shield','mimikyu':'mimikyu-disguised','palafin':'palafin-zero',
    'eiscue':'eiscue-ice','morpeko':'morpeko-full-belly','wishiwashi':'wishiwashi-solo',
    'deoxys':'deoxys-normal','terapagos-normal':'terapagos','terapagos-base':'terapagos','keldeo':'keldeo-ordinary','meloetta':'meloetta-aria',
    'zygarde':'zygarde-50','dudunsparce':'dudunsparce-two-segment','maushold':'maushold-family-of-four'
  };

  /* Forms whose Showdown filename is intentionally not the same as the
   * internal battle/display name. */
  const EXTRA_FORM_FILES={
    'deoxys-attack':'deoxys-attack','deoxys-defense':'deoxys-defense','deoxys-speed':'deoxys-speed',
    'thundurus-incarnate':'thundurus','tornadus-incarnate':'tornadus','landorus-incarnate':'landorus','enamorus-incarnate':'enamorus',
    'thundurus-therian':'thundurus-therian','tornadus-therian':'tornadus-therian','landorus-therian':'landorus-therian','enamorus-therian':'enamorus-therian',
    'urshifu-single-strike':'urshifu','urshifu-rapid-strike':'urshifu-rapidstrike',
    'mr-mime-galar':'mrmime-galar','mr-rime':'mrrime','mr-mime':'mrmime','mime-jr':'mimejr',
    'basculegion-male':'basculegion','basculegion-female':'basculegion-f',
    'basculin-red-striped':'basculin','basculin-blue-striped':'basculin-bluestriped','basculin-white-striped':'basculin-whitestriped',
    'dudunsparce-two-segment':'dudunsparce','dudunsparce-three-segment':'dudunsparce-threesegment',
    'maushold-family-of-four':'maushold','maushold-family-of-three':'maushold-four',
    'tatsugiri-curly':'tatsugiri','tatsugiri-droopy':'tatsugiri-droopy','tatsugiri-stretchy':'tatsugiri-stretchy',
    'tauros-paldea-combat':'tauros-paldeacombat','tauros-paldea-blaze':'tauros-paldeablaze','tauros-paldea-aqua':'tauros-paldeaaqua',
    'squawkabilly-green-plumage':'squawkabilly','squawkabilly-blue-plumage':'squawkabilly-blue','squawkabilly-yellow-plumage':'squawkabilly-yellow','squawkabilly-white-plumage':'squawkabilly-white',
    'ogerpon-teal-mask':'ogerpon','ogerpon-wellspring-mask':'ogerpon-wellspring','ogerpon-hearthflame-mask':'ogerpon-hearthflame','ogerpon-cornerstone-mask':'ogerpon-cornerstone',
    'calyrex-ice-rider':'calyrex-ice','calyrex-shadow-rider':'calyrex-shadow',
    'necrozma-dusk-mane':'necrozma-duskmane','necrozma-dawn-wings':'necrozma-dawnwings','necrozma-ultra':'necrozma-ultra',
    'kyurem-black':'kyurem-black','kyurem-white':'kyurem-white','giratina-origin':'giratina-origin','shaymin-sky':'shaymin-sky','hoopa-unbound':'hoopa-unbound',
    'genesect-douse':'genesect-douse','genesect-shock':'genesect-shock','genesect-burn':'genesect-burn','genesect-chill':'genesect-chill',
    'terapagos':'terapagos','terapagos-normal':'terapagos','terapagos-base':'terapagos','terapagos':'terapagos','terapagos-normal':'terapagos','terapagos-base':'terapagos','terapagos-terastal':'terapagos-terastal','terapagos-stellar':'terapagos-stellar','zacian-crowned':'zacian-crowned','zamazenta-crowned':'zamazenta-crowned'
  };

  const FORM_FILES={
    'chi-yu':'chiyu','chien-pao':'chienpao','ting-lu':'tinglu','wo-chien':'wochien',
    'aegislash-shield':'aegislash',
    'mimikyu-disguised':'mimikyu',
    'palafin-zero':'palafin',
    'eiscue-ice':'eiscue',
    'morpeko-full-belly':'morpeko',
    'wishiwashi-solo':'wishiwashi',
    'deoxys-normal':'deoxys',
    'darmanitan-standard':'darmanitan',
    'giratina-altered':'giratina',
    'keldeo-ordinary':'keldeo',
    'meloetta-aria':'meloetta',
    'shaymin-land':'shaymin',
    'zygarde-50':'zygarde',
    'zygarde-50-percent':'zygarde',
    'basculin-red-striped':'basculin-red-striped',
    'lycanroc-midday':'lycanroc',
    'minior-red-meteor':'minior-redmeteor',
    'pumpkaboo-average':'pumpkaboo',
    'gourgeist-average':'gourgeist',
    'squawkabilly-green-plumage':'squawkabilly-green',
    'squawkabilly-blue-plumage':'squawkabilly-blue',
    'squawkabilly-yellow-plumage':'squawkabilly-yellow',
    'squawkabilly-white-plumage':'squawkabilly-white',
    'dudunsparce-two-segment':'dudunsparce',
    'alcremie-matcha-cream':'alcremie-matchacream',
    'alcremie-mint-cream':'alcremie-mintcream',
    'alcremie-lemon-cream':'alcremie-lemoncream',
    'alcremie-salted-cream':'alcremie-saltedcream',
    'alcremie-ruby-cream':'alcremie-rubycream',
    'alcremie-ruby-swirl':'alcremie-rubyswirl',
    'alcremie-caramel-swirl':'alcremie-caramelswirl',
    'alcremie-rainbow-swirl':'alcremie-rainbowswirl',
    'maushold-family-of-four':'maushold',
    'toxtricity-amped':'toxtricity-amped',
    'indeedee-male':'indeedee-m',
    'indeedee-female':'indeedee-f',
    'meowstic-male':'meowstic',
    'meowstic-female':'meowstic-f',
    'frillish-male':'frillish-m',
    'frillish-female':'frillish-f',
    'jellicent-male':'jellicent-m',
    'jellicent-female':'jellicent-f',
    'pyroar-male':'pyroar-m',
    'pyroar-female':'pyroar-f',
    'oinkologne-male':'oinkologne-m',
    'oinkologne-female':'oinkologne-f',
    'basculegion-male':'basculegion-m',
    'basculegion-female':'basculegion-f',
    'nidoran-m':'nidoran-m',
    'nidoran-f':'nidoran-f',
    'tatsugiri-curly':'tatsugiri-curly',
    'tatsugiri-droopy':'tatsugiri-droopy',
    'tatsugiri-stretchy':'tatsugiri-stretchy',
    'tauros-paldeablaze':'tauros-paldeablaze',
    'tauros-paldea-blaze':'tauros-paldeablaze',
    'tauros-paldeaaqua':'tauros-paldeaaqua',
    'tauros-paldea-aqua':'tauros-paldeaaqua',
    'tauros-paldeacombat':'tauros-paldeacombat',
    'tapu-koko':'tapukoko','tapu-lele':'tapulele','tapu-bulu':'tapubulu','tapu-fini':'tapufini',
    'tauros-paldea-combat':'tauros-paldeacombat',
    'ogerpon-teal-mask':'ogerpon',
    'ogerpon-wellspring-mask':'ogerpon-wellspring',
    'ogerpon-hearthflame-mask':'ogerpon-hearthflame',
    'ogerpon-cornerstone-mask':'ogerpon-cornerstone',
    'terapagos-terastal':'terapagos-terastal',
    'terapagos-stellar':'terapagos-stellar',
    'zacian-crowned':'zacian-crowned',
    'zamazenta-crowned':'zamazenta-crowned',
    'calyrex-ice-rider':'calyrex-ice',
    'calyrex-shadow-rider':'calyrex-shadow',
    'necrozma-dusk-mane':'necrozma-dusk-mane',
    'necrozma-dawn-wings':'necrozma-dawn-wings',
    'necrozma-ultra':'necrozma-ultra',
    'kyurem-black':'kyurem-black',
    'kyurem-white':'kyurem-white',
    'giratina-origin':'giratina-origin',
    'shaymin-sky':'shaymin-sky',
    'hoopa-unbound':'hoopa-unbound',
    'genesect-douse':'genesect-douse',
    'genesect-shock':'genesect-shock',
    'genesect-burn':'genesect-burn',
    'genesect-chill':'genesect-chill',
    'silvally-bug':'silvally-bug','silvally-dark':'silvally-dark','silvally-dragon':'silvally-dragon',
    'silvally-electric':'silvally-electric','silvally-fairy':'silvally-fairy','silvally-fighting':'silvally-fighting',
    'silvally-fire':'silvally-fire','silvally-flying':'silvally-flying','silvally-ghost':'silvally-ghost',
    'silvally-grass':'silvally-grass','silvally-ground':'silvally-ground','silvally-ice':'silvally-ice',
    'silvally-poison':'silvally-poison','silvally-psychic':'silvally-psychic','silvally-rock':'silvally-rock',
    'silvally-steel':'silvally-steel','silvally-water':'silvally-water'
  };

  /* Showdown's HOME filenames use two conventions:
   *   - form separators stay hyphenated (deoxys-attack, landorus-therian)
   *   - many species whose human name contains a hyphen are compacted
   *     (hooh, mrmime, chiyu, greattusk, ironvaliant, etc.)
   * Keep this distinction explicit instead of blindly stripping every hyphen. */
  const COMPACT_BASES=new Set([
    'ho-oh','mr-mime','mr-rime','mime-jr','porygon-z','hakamo-o','jangmo-o','kommo-o',
    'chi-yu','chien-pao','ting-lu','wo-chien',
    'brute-bonnet','flutter-mane','gouging-fire','great-tusk','iron-boulder','iron-bundle',
    'iron-crown','iron-hands','iron-jugulis','iron-leaves','iron-moth','iron-thorns',
    'iron-treads','iron-valiant','raging-bolt','roaring-moon','sandy-shocks','scream-tail',
    'slither-wing','walking-wake'
  ]);

  const TYPO_CANONICAL={
    'scovilalian':'scovillain','cincinno':'cinccino','cinccinno':'cinccino','daschbun':'dachsbun','taurus-blaze':'tauros-paldeablaze','taurus-combat':'tauros-paldeacombat',
    'scovillian':'scovillain',
    'scovilion':'scovillain'
  };

  const FORM_BASES=new Set([
    'aegislash','alcremie','basculin','basculegion','calyrex','darmanitan','deoxys','dudunsparce',
    'eiscue','enamorus','frillish','giratina','gourgeist','indeedee','jellicent','keldeo','kyurem',
    'landorus','lycanroc','maushold','meowstic','meloetta','mimikyu','minior','morpeko','necrozma',
    'oinkologne','ogerpon','oricorio','palafin','pumpkaboo','pyroar','rotom','shaymin','silvally',
    'squawkabilly','tatsugiri','tauros','terapagos','thundurus','tornadus','toxtricity','urshifu',
    'wishiwashi','wormadam','zygarde','zacian','zamazenta','genesect'
  ]);

  const DISPLAY_CANONICAL={
    'scovillain':'Scovillain','terapagos':'Terapagos','meowstic':'Meowstic Male','meowstic-m':'Meowstic Male','tauros-paldeablaze':'Tauros Blaze','tauros-paldeacombat':'Tauros Combat','cinccino':'Cinccino','dachsbun':'Dachsbun',
    'aegislash-blade':'Aegislash','aegislash-shield':'Aegislash',
    'mimikyu-busted':'Mimikyu','mimikyu-busted-totem':'Mimikyu',
    'eiscue-noice':'Eiscue','morpeko-hangry':'Morpeko','wishiwashi-school':'Wishiwashi',
    'cramorant-gulping':'Cramorant','cramorant-gorging':'Cramorant',
    'darmanitan-zen':'Darmanitan','darmanitan-zen-galar':'Darmanitan-Galar',
    'zacian-crowned':'Zacian','zamazenta-crowned':'Zamazenta',
    'terapagos-terastal':'Terapagos','terapagos-stellar':'Terapagos','palafin-hero':'Palafin',
    'minior-meteor':'Minior','meloetta-pirouette':'Meloetta',
    'zygarde-10-percent':'Zygarde','zygarde-50-percent':'Zygarde',
    'necrozma-dusk-mane':'Necrozma','necrozma-dawn-wings':'Necrozma','necrozma-ultra':'Necrozma',
    'giratina-origin':'Giratina','shaymin-sky':'Shaymin','hoopa-unbound':'Hoopa',
    'kyurem-black':'Kyurem','kyurem-white':'Kyurem',
    'keldeo-resolute':'Keldeo','genesect-douse':'Genesect','genesect-shock':'Genesect',
    'genesect-burn':'Genesect','genesect-chill':'Genesect','genesect-frozen':'Genesect',
    'zygarde-complete':'Zygarde','rotom-heat':'Rotom','rotom-wash':'Rotom','rotom-frost':'Rotom',
    'rotom-fan':'Rotom','rotom-mow':'Rotom','dudunsparce-two-segment':'Dudunsparce',
    'dudunsparce-three-segment':'Dudunsparce','maushold-family-of-four':'Maushold',
    'maushold-family-of-three':'Maushold'
  };

  function normalizeName(name){
    let raw=String(name??'').trim().toLowerCase()
      .replace(/[’']/g,'').replace(/[♀]/g,'-f').replace(/[♂]/g,'-m')
      .replace(/[.:]/g,'').replace(/_/g,'-').replace(/\s+/g,'-')
      .replace(/-+/g,'-').replace(/^-|-$/g,'');
    raw=raw.replace(/-(forme|form|style)$/,'');
    raw=raw.replace(/^(thundurus|tornadus|landorus|enamorus)-incarnate(?:-forme)?$/,'$1');
    return TYPO_CANONICAL[raw] || raw;
  }

  function toShowdownId(id){ return normalizeName(id); }

  // Shared roster/trade comparison helpers. These intentionally normalize the
  // optional Paldea token while preserving form identity for everything else.
  function matchKey(name){
    return normalizeName(name)
      .replace(/(^|-)paldea(?=-|$)/g,'')
      .replace(/-+/g,'-')
      .replace(/^-|-$/g,'');
  }
  function sameSpeciesForm(a,b){
    const left=matchKey(a), right=matchKey(b);
    return !!left && !!right && left===right;
  }

  function displayNameWithForm(name){
    const id=normalizeName(name);
    const typo=TYPO_CANONICAL[id]||id;
    const SPECIAL={scovillain:'Scovillain'};
    if(SPECIAL[typo]) return SPECIAL[typo];
    const words=typo.split('-').map((w,i)=>{
      if(!w) return w;
      if(w==='f') return 'F'; if(w==='m') return 'M';
      return w.charAt(0).toUpperCase()+w.slice(1);
    });
    return words.join('-');
  }

  function displayName(name){
    const id=normalizeName(name);
    return DISPLAY_CANONICAL[id]||String(name??'').trim();
  }

  function candidateIds(name){
    const id=normalizeName(name); if(!id)return [];
    const out=[];
    const add=x=>{x=normalizeName(x);if(x&&!out.includes(x))out.push(x);};
    add(id); add(ALIASES[id]); add(normalizeName(displayName(id)));
    return out;
  }

  function spriteFilename(name){
    const ids=candidateIds(name);
    for(const id of ids){
      if(EXTRA_FORM_FILES[id]) return EXTRA_FORM_FILES[id];
      if(FORM_FILES[id]) return FORM_FILES[id];
      if(COMPACT_BASES.has(id)) return id.replace(/[^a-z0-9]/g,'');
      /* Form names keep their separator in Showdown's HOME directory. */
      return id;
    }
    return '';
  }

  function spriteUrl(name,styleOverride){
    const style=styleOverride==='2d'?'2d':styleOverride==='3d'?'3d':getSpriteStyle();
    const file=spriteFilename(name);
    return file ? `${SPRITE_ROOTS[style]}${encodeURIComponent(file)}.png` : '';
  }

  function spriteUrlCandidates(name,styleOverride){
    const style=styleOverride==='2d'?'2d':styleOverride==='3d'?'3d':getSpriteStyle();
    const ids=candidateIds(name);
    const files=[];
    const addFile=f=>{ if(!f) return; const v=String(f).toLowerCase(); if(!files.includes(v)) files.push(v); };
    ids.forEach(id=>{
      addFile(EXTRA_FORM_FILES[id]);
      addFile(FORM_FILES[id]);
      addFile(id);
      addFile(id.replace(/-/g,''));
    });
    // Showdown's two sprite sets are mostly aligned, but a handful of
    // legacy/form names use compact filenames. Keep a deterministic fallback
    // list so hyphenated roster names never result in a broken image.
    return files.map(file=>`${SPRITE_ROOTS[style]}${encodeURIComponent(file)}.png`);
  }

  function applySpriteSource(img,name,style){
    const urls=spriteUrlCandidates(name,style);
    if(!urls.length){ img.classList.add('missing'); return; }
    img.dataset.sblSpriteCandidates=JSON.stringify(urls);
    img.dataset.sblSpriteIndex='0';
    img.classList.remove('missing');
    img.src=urls[0];
  }

  function handleSpriteError(img){
    try {
      const urls=JSON.parse(img.dataset.sblSpriteCandidates||'[]');
      const next=Number(img.dataset.sblSpriteIndex||0)+1;
      if(next<urls.length){
        img.dataset.sblSpriteIndex=String(next);
        img.src=urls[next];
        return;
      }
    } catch {}
    img.classList.add('missing');
  }

  function escapeHtml(s){
    return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function spriteMarkup(name,cls,styleOverride){
    const safe=escapeHtml(name);
    const baseClass=cls||'sprite';
    const urls=spriteUrlCandidates(name,styleOverride);
    if(!urls.length){
      return `<span class="${baseClass} sbl-remote-sprite missing" role="img" aria-label="${safe}" title="${safe}"></span>`;
    }
    const candidates=escapeHtml(JSON.stringify(urls));
    return `<img class="${baseClass} sbl-remote-sprite" src="${urls[0]}" alt="${safe}" title="${safe}" width="96" height="96" decoding="async" data-sbl-sprite-candidates='${candidates}' data-sbl-sprite-index="0" onerror="SBL.pokemon.handleSpriteError(this)">`;
  }

  function spriteCandidates(name){ return candidateIds(name); }
  function installSprite(){}
  function scanSprites(){}

  window.SBL.pokemon.normalizeName=normalizeName;
  window.SBL.pokemon.toShowdownId=toShowdownId;
  window.SBL.pokemon.matchKey=matchKey;
  window.SBL.pokemon.sameSpeciesForm=sameSpeciesForm;
  window.SBL.pokemon.displayName=displayName;
  window.SBL.pokemon.displayNameWithForm=displayNameWithForm;
  window.SBL.pokemon.candidateIds=candidateIds;
  window.SBL.pokemon.spriteFilename=spriteFilename;
  window.SBL.pokemon.spriteCandidates=spriteCandidates;
  window.SBL.pokemon.spriteUrl=spriteUrl;
  window.SBL.pokemon.spriteUrlCandidates=spriteUrlCandidates;
  window.SBL.pokemon.handleSpriteError=handleSpriteError;
  window.SBL.pokemon.spriteMarkup=spriteMarkup;
  window.SBL.pokemon.getSpriteStyle=getSpriteStyle;
  window.SBL.pokemon.setSpriteStyle=setSpriteStyle;
  window.SBL.pokemon.escapeHtml=escapeHtml;
  window.SBL.pokemon.installSprite=installSprite;
  window.SBL.pokemon.scanSprites=scanSprites;
  window.SBL.pokemon.aliases=ALIASES;
})();
