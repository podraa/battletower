// SBL shared theme engine — single source of truth for every theme preset
// and the logic that applies them. Loaded by every page via <script src>.
// To add or edit a theme, change THEMES here once; every page picks it up
// automatically on next load (no per-page edits needed).
(function(){
  const THEMES=[
    {id:'monochrome', name:'Monochrome', bg:'#0b0b0d', panel:'#17171a', panelAlt:'#222226', border:'#38383d', text:'#f1f1f3', textDim:'#a7a7ad', accent:'#d4d4d8', accentText:'#18181b'},
    {id:'slate', name:'Slate', bg:'#0b0f14', panel:'#151b23', panelAlt:'#1e2630', border:'#303b49', text:'#edf2f7', textDim:'#9ba9b8', accent:'#94a3b8', accentText:'#10151d'},
    {id:'onyx', name:'Onyx', bg:'#08090b', panel:'#111318', panelAlt:'#191c22', border:'#2b3038', text:'#f1f3f6', textDim:'#9ca3af', accent:'#8b949e', accentText:'#0b0d10'},
    {id:'graphite', name:'Graphite', bg:'#0c0d0f', panel:'#17181b', panelAlt:'#212327', border:'#35373d', text:'#eef0f2', textDim:'#9ba0a8', accent:'#a3a9b3', accentText:'#131417'},
    {id:'ivory', name:'Ivory', bg:'#e4e0d7', panel:'#eeeae2', panelAlt:'#e0dbd0', border:'#c8c0b1', text:'#353129', textDim:'#777064', accent:'#a87838', accentText:'#241806'},
    {id:'pearl', name:'Pearl', bg:'#151517', panel:'#222225', panelAlt:'#303034', border:'#47474d', text:'#f7f7f8', textDim:'#b4b4bc', accent:'#d2d2d8', accentText:'#17171a'},
    {id:'rose', name:'Rose', bg:'#1c0510', panel:'#2c0a1c', panelAlt:'#3a0f26', border:'#5a1c3c', text:'#fdeef4', textDim:'#c99cb2', accent:'#f472b6', accentText:'#3b0a24'},
    {id:'ruby', name:'Ruby', bg:'#17070d', panel:'#270d16', panelAlt:'#3a1420', border:'#681f35', text:'#ffeaf1', textDim:'#e889a4', accent:'#ff527d', accentText:'#290710'},
    {id:'crimson', name:'Crimson', bg:'#16070c', panel:'#250b13', panelAlt:'#32101b', border:'#5a1d2b', text:'#fff0f4', textDim:'#d39aaa', accent:'#f43f5e', accentText:'#3a0714'},
    {id:'cherry', name:'Cherry', bg:'#17080b', panel:'#281015', panelAlt:'#3a1820', border:'#672431', text:'#ffecef', textDim:'#e78b9c', accent:'#ff6b81', accentText:'#2b080d'},
    {id:'ember', name:'Ember', bg:'#170a07', panel:'#27130c', panelAlt:'#391f14', border:'#63351f', text:'#fff0e5', textDim:'#d99b77', accent:'#ff8a4c', accentText:'#2a0d07'},
    {id:'orange', name:'Orange', bg:'#1a0f05', panel:'#2a1a0a', panelAlt:'#38220e', border:'#5a3a1a', text:'#fdf3e8', textDim:'#cbab84', accent:'#fb923c', accentText:'#341102'},
    {id:'coral', name:'Coral', bg:'#1b0b08', panel:'#2b1410', panelAlt:'#3a1c16', border:'#63352a', text:'#fff2ed', textDim:'#d2a69a', accent:'#fb7185', accentText:'#3b0d0a'},
    {id:'tangerine', name:'Tangerine', bg:'#1a0e06', panel:'#2b180a', panelAlt:'#3d2510', border:'#6d3f17', text:'#fff1dc', textDim:'#e7a15d', accent:'#ff9d3d', accentText:'#2d1305'},
    {id:'sunset', name:'Sunset', bg:'#180a08', panel:'#29130e', panelAlt:'#3a1b12', border:'#623622', text:'#fff3e8', textDim:'#d3aa8d', accent:'#fb923c', accentText:'#3a1605'},
    {id:'peach', name:'Peach', bg:'#190e0a', panel:'#2a1811', panelAlt:'#3b241a', border:'#68402b', text:'#fff1e7', textDim:'#e7ae8d', accent:'#ffad7a', accentText:'#2d140a'},
    {id:'yellow', name:'Yellow', bg:'#17150a', panel:'#26220f', panelAlt:'#332d14', border:'#544b1f', text:'#fdfaea', textDim:'#c9c08a', accent:'#facc15', accentText:'#332600'},
    {id:'gold', name:'Gold', bg:'#151006', panel:'#261b09', panelAlt:'#38270f', border:'#60471b', text:'#fff5d8', textDim:'#d2b66b', accent:'#f5c542', accentText:'#2b1c04'},
    {id:'marigold', name:'Marigold', bg:'#171006', panel:'#281c09', panelAlt:'#3a2910', border:'#67491b', text:'#fff4d8', textDim:'#e2bd68', accent:'#f5c84b', accentText:'#281804'},
    {id:'honeycomb', name:'Honeycomb', bg:'#171008', panel:'#291c0c', panelAlt:'#3b2911', border:'#654b20', text:'#fff4dc', textDim:'#d8b46b', accent:'#f2c14e', accentText:'#251704'},
    {id:'butter', name:'Butter', bg:'#f0ecd8', panel:'#f7f3e3', panelAlt:'#e8e1c5', border:'#d5c99f', text:'#3b3828', textDim:'#797253', accent:'#b3912f', accentText:'#fffdf3'},
    {id:'emerald', name:'Emerald', bg:'#071410', panel:'#0d2119', panelAlt:'#122c22', border:'#1f4a37', text:'#eafff3', textDim:'#8fc7a8', accent:'#4ade80', accentText:'#052e12'},
    {id:'forest', name:'Forest', bg:'#06120c', panel:'#0c1d14', panelAlt:'#12291c', border:'#1d4630', text:'#e9fff1', textDim:'#87b69a', accent:'#34d399', accentText:'#052416'},
    {id:'jade', name:'Jade', bg:'#07130c', panel:'#0e2116', panelAlt:'#173323', border:'#2b543a', text:'#e8fff0', textDim:'#79c69a', accent:'#4de39a', accentText:'#062513'},
    {id:'mint', name:'Mint', bg:'#071511', panel:'#0d241d', panelAlt:'#143129', border:'#245346', text:'#edfff8', textDim:'#94c9b4', accent:'#6ee7b7', accentText:'#06271d'},
    {id:'moss', name:'Moss', bg:'#101306', panel:'#1e250c', panelAlt:'#2e3512', border:'#4b5520', text:'#f4f8df', textDim:'#b5bd7e', accent:'#a8b84a', accentText:'#202505'},
    {id:'lime', name:'Lime', bg:'#101507', panel:'#1b240b', panelAlt:'#26330f', border:'#43541c', text:'#f5ffe8', textDim:'#b4c58c', accent:'#a3e635', accentText:'#1e2d05'},
    {id:'cyan', name:'Cyan', bg:'#051519', panel:'#0a2129', panelAlt:'#0f2c35', border:'#1c4a57', text:'#eafcff', textDim:'#8bc2cf', accent:'#22d3ee', accentText:'#032a30'},
    {id:'teal', name:'Teal', bg:'#071614', panel:'#0d2220', panelAlt:'#122d2a', border:'#1f4a44', text:'#eafffa', textDim:'#8fc7bb', accent:'#5eead4', accentText:'#062521'},
    {id:'aqua', name:'Aqua', bg:'#041315', panel:'#082127', panelAlt:'#0d3038', border:'#1b5661', text:'#e9feff', textDim:'#8dc8ce', accent:'#2dd4bf', accentText:'#032522'},
    {id:'arctic', name:'Arctic', bg:'#081319', panel:'#0e2029', panelAlt:'#15303c', border:'#27505f', text:'#eefcff', textDim:'#91bac5', accent:'#67e8f9', accentText:'#06252e'},
    {id:'turquoise', name:'Turquoise', bg:'#061517', panel:'#0c2528', panelAlt:'#12383b', border:'#236067', text:'#e8fffe', textDim:'#79c8c5', accent:'#2dd4bf', accentText:'#032522'},
    {id:'deepsea', name:'Deep Sea', bg:'#050f14', panel:'#0a1a22', panelAlt:'#102932', border:'#1d4a59', text:'#e5faff', textDim:'#6fa5b5', accent:'#48c8df', accentText:'#05202a'},
    {id:'lagoon', name:'Lagoon', bg:'#061416', panel:'#0c2428', panelAlt:'#12353a', border:'#245861', text:'#e7ffff', textDim:'#83c5cb', accent:'#2dd4bf', accentText:'#042522'},
    {id:'sky', name:'Sky Blue', bg:'#071426', panel:'#0d2038', panelAlt:'#142b47', border:'#2b4c70', text:'#eef6ff', textDim:'#9db4cc', accent:'#60a5fa', accentText:'#0b1a33'},
    {id:'azure', name:'Azure', bg:'#07111a', panel:'#0e2130', panelAlt:'#163448', border:'#285d7b', text:'#eaf8ff', textDim:'#73bfe8', accent:'#55b9ff', accentText:'#08202d'},
    {id:'cobalt', name:'Cobalt', bg:'#080e1b', panel:'#101a2e', panelAlt:'#172843', border:'#274c7d', text:'#e9f1ff', textDim:'#7096d4', accent:'#5b8dff', accentText:'#0a1830'},
    {id:'navy', name:'Navy', bg:'#060d19', panel:'#0c1727', panelAlt:'#132237', border:'#243c5e', text:'#edf5ff', textDim:'#8fa7c5', accent:'#38bdf8', accentText:'#062039'},
    {id:'ocean', name:'Ocean', bg:'#061118', panel:'#0b202c', panelAlt:'#123342', border:'#205b70', text:'#e6faff', textDim:'#67bfd5', accent:'#45c6e8', accentText:'#05232f'},
    {id:'sapphire', name:'Sapphire', bg:'#060c18', panel:'#0d1830', panelAlt:'#142548', border:'#254777', text:'#eaf1ff', textDim:'#7e9bd0', accent:'#3b82f6', accentText:'#07152d'},
    {id:'steelblue', name:'Steel Blue', bg:'#0a1118', panel:'#141e29', panelAlt:'#1e2c3b', border:'#34495f', text:'#edf5ff', textDim:'#91a7bc', accent:'#7aa7c7', accentText:'#0b1c29'},
    {id:'dusk', name:'Dusk', bg:'#0d0d18', panel:'#17172a', panelAlt:'#23233d', border:'#3a3a61', text:'#f0efff', textDim:'#a5a2c4', accent:'#a78bfa', accentText:'#17102c'},
    {id:'midnight', name:'Midnight', bg:'#050713', panel:'#0b1021', panelAlt:'#131a32', border:'#263454', text:'#eaf0ff', textDim:'#7f8baa', accent:'#818cf8', accentText:'#0b1028'},
    {id:'violet', name:'Violet', bg:'#171224', panel:'#241b38', panelAlt:'#302448', border:'#51406f', text:'#f7f2ff', textDim:'#b9aecf', accent:'#a78bfa', accentText:'#1e1033'},
    {id:'lavender', name:'Lavender', bg:'#110f1c', panel:'#1d1930', panelAlt:'#292342', border:'#453b67', text:'#f6f1ff', textDim:'#b9add3', accent:'#c4b5fd', accentText:'#21153d'},
    {id:'amethyst', name:'Amethyst', bg:'#110a18', panel:'#1c1028', panelAlt:'#2b1940', border:'#4c2d6b', text:'#f5edff', textDim:'#b59bd8', accent:'#b27aff', accentText:'#190d2b'},
    {id:'indigo', name:'Indigo', bg:'#0e0f1f', panel:'#171a30', panelAlt:'#1f2340', border:'#38406a', text:'#eef0ff', textDim:'#a3a8cf', accent:'#818cf8', accentText:'#141033'},
    {id:'grape', name:'Grape', bg:'#120817', panel:'#21102a', panelAlt:'#31183e', border:'#542866', text:'#f9edff', textDim:'#bd9bc9', accent:'#a855f7', accentText:'#210b32'},
    {id:'nebula', name:'Nebula', bg:'#0b0816', panel:'#151026', panelAlt:'#21183a', border:'#3a2d5d', text:'#f1edff', textDim:'#a79bc7', accent:'#8b5cf6', accentText:'#160c2c'},
    {id:'rosepaper', name:'Rose Paper', bg:'#eee5e8', panel:'#f7eef1', panelAlt:'#e7d9df', border:'#d5c0c9', text:'#3d3036', textDim:'#7d6973', accent:'#b86b87', accentText:'#fff7fa'},
    {id:'magenta', name:'Magenta', bg:'#170712', panel:'#280b20', panelAlt:'#38102c', border:'#5c1e4a', text:'#fff0fa', textDim:'#d39abb', accent:'#f0a', accentText:'#3d062c'},
    {id:'fuchsia', name:'Fuchsia', bg:'#170815', panel:'#280d23', panelAlt:'#3b1432', border:'#66205a', text:'#ffeafd', textDim:'#e18bcf', accent:'#ef5fd0', accentText:'#28091e'},
    {id:'blush', name:'Blush', bg:'#170b10', panel:'#27121b', panelAlt:'#3a1c28', border:'#653246', text:'#ffedf4', textDim:'#e8a2b8', accent:'#f58bb0', accentText:'#2a0c15'},
    {id:'pikachu', name:'Pikachu', group:'Pokemon', bg:'#171405', panel:'#29200a', panelAlt:'#3c2d0c', border:'#70551a', text:'#fff9d6', textDim:'#d8c36b', accent:'#facc15', accentText:'#221800'},
    {id:'charizard', name:'Charizard', group:'Pokemon', bg:'#1b0705', panel:'#321008', panelAlt:'#49150b', border:'#7d2a16', text:'#fff2e8', textDim:'#e3a17c', accent:'#f97316', accentText:'#2c0903'},
    {id:'blastoise', name:'Blastoise', group:'Pokemon', bg:'#06121a', panel:'#0b2730', panelAlt:'#12404b', border:'#256776', text:'#e8fbff', textDim:'#83c0ca', accent:'#38bdf8', accentText:'#05212d'},
    {id:'venusaur', name:'Venusaur', group:'Pokemon', bg:'#071208', panel:'#112b18', panelAlt:'#1d3d23', border:'#3c6941', text:'#efffe9', textDim:'#9bc58e', accent:'#4ade80', accentText:'#07200d'},
    {id:'gengar', name:'Gengar', group:'Pokemon', bg:'#100719', panel:'#21102f', panelAlt:'#321647', border:'#5a3475', text:'#faefff', textDim:'#c1a0d5', accent:'#a855f7', accentText:'#1b092b'},
    {id:'umbreon', name:'Umbreon', group:'Pokemon', bg:'#07080c', panel:'#14151b', panelAlt:'#222329', border:'#4b4c4f', text:'#fff6d5', textDim:'#b9ae82', accent:'#facc15', accentText:'#191603'},
    {id:'espeon', name:'Espeon', group:'Pokemon', bg:'#16091a', panel:'#2b1530', panelAlt:'#402044', border:'#70406d', text:'#fff0ff', textDim:'#dda7cf', accent:'#e879f9', accentText:'#33102f'},
    {id:'lucario', name:'Lucario', group:'Pokemon', bg:'#07121a', panel:'#0d2834', panelAlt:'#154253', border:'#2b6877', text:'#eafcff', textDim:'#8bbdc9', accent:'#38bdf8', accentText:'#06202d'},
    {id:'greninja', name:'Greninja', group:'Pokemon', bg:'#050c18', panel:'#0a2035', panelAlt:'#103c54', border:'#235f79', text:'#e8faff', textDim:'#79b7c9', accent:'#ef4444', accentText:'#30070b'},
    {id:'rayquaza', name:'Rayquaza', group:'Pokemon', bg:'#07150b', panel:'#12301a', panelAlt:'#1d4221', border:'#6a5d18', text:'#fff9cf', textDim:'#c4bd75', accent:'#e11d48', accentText:'#fff5e8'},
    {id:'mewtwo', name:'Mewtwo', group:'Pokemon', bg:'#100a18', panel:'#21152b', panelAlt:'#352040', border:'#65447a', text:'#f8f0ff', textDim:'#c1a5d0', accent:'#c084fc', accentText:'#251038'},
    {id:'eevee', name:'Eevee', group:'Pokemon', bg:'#171009', panel:'#2b1a0d', panelAlt:'#3f2814', border:'#714827', text:'#fff3dd', textDim:'#d5ae7b', accent:'#c08457', accentText:'#2b170a'},
    {id:'sylveon', name:'Sylveon', group:'Pokemon', bg:'#170912', panel:'#2a1020', panelAlt:'#40182f', border:'#71385a', text:'#fff0f8', textDim:'#e6a7c2', accent:'#67e8f9', accentText:'#17202a'},
    {id:'scizor', name:'Scizor', group:'Pokemon', bg:'#160507', panel:'#2d0c10', panelAlt:'#43151b', border:'#7b2932', text:'#fff0f1', textDim:'#dc8e95', accent:'#ef4444', accentText:'#2d080d'},
    {id:'metagross', name:'Metagross', group:'Pokemon', bg:'#091015', panel:'#14232d', panelAlt:'#1d3946', border:'#416b78', text:'#effcff', textDim:'#99b8c2', accent:'#60a5fa', accentText:'#091a28'},
    {id:'dragapult', name:'Dragapult', group:'Pokemon', bg:'#071015', panel:'#10232b', panelAlt:'#193944', border:'#2e6570', text:'#eaffff', textDim:'#8ac5c8', accent:'#2dd4bf', accentText:'#062522'},
    {id:'mimikyu', name:'Mimikyu', group:'Pokemon', bg:'#121007', panel:'#28210f', panelAlt:'#3d3218', border:'#6f5b25', text:'#fffbe5', textDim:'#cdbb78', accent:'#eab308', accentText:'#221a03'},
    {id:'dialga', name:'Dialga', group:'Pokemon', bg:'#07121b', panel:'#102a3b', panelAlt:'#18445a', border:'#3b7086', text:'#eafaff', textDim:'#8fb9c8', accent:'#facc15', accentText:'#1f1700'},
    {id:'palkia', name:'Palkia', group:'Pokemon', bg:'#120711', panel:'#25112a', panelAlt:'#3b1942', border:'#71345f', text:'#fff0ff', textDim:'#d09acb', accent:'#22d3ee', accentText:'#06262a'},
    {id:'giratina', name:'Giratina', group:'Pokemon', bg:'#0b080f', panel:'#1b1220', panelAlt:'#2a1b2f', border:'#523c52', text:'#fff4cf', textDim:'#c9ac68', accent:'#f59e0b', accentText:'#271703'},
    {id:'zacian', name:'Ho-Oh', group:'Pokemon', bg:'#140805', panel:'#2a1208', panelAlt:'#43200d', border:'#7d4a19', text:'#fff3d5', textDim:'#dcae68', accent:'#ef4444', accentText:'#fff3d5'},
    {id:'zamazenta', name:'Lugia', group:'Pokemon', bg:'#07111a', panel:'#10273a', panelAlt:'#183f56', border:'#3c7188', text:'#eefcff', textDim:'#9abecb', accent:'#e2e8f0', accentText:'#15212b'},
    {id:'kyogre', name:'Gardevoir', group:'Pokemon', bg:'#140a16', panel:'#271329', panelAlt:'#3d1c40', border:'#6e3c72', text:'#fff0ff', textDim:'#d4a7d0', accent:'#34d399', accentText:'#05271d'},
    {id:'groudon', name:'Zoroark', group:'Pokemon', bg:'#0c0b0f', panel:'#1c151c', panelAlt:'#32212c', border:'#66354b', text:'#fff0f3', textDim:'#c8a0ad', accent:'#ef4444', accentText:'#2b070d'},
    {id:'amber', name:'Amber', bg:'#0e1218', panel:'#161c26', panelAlt:'#1c2432', border:'#2a3444', text:'#e8edf5', textDim:'#8996a8', accent:'#ffb454', accentText:'#1a1206'}
  ];
  // Single shared source of truth for every theme preset on the site.
  // Other scripts on this page (and the loader on other pages) read from
  // window.SBL_THEMES instead of keeping their own copy, so a theme only
  // ever needs to be added in one place.
  window.SBL_THEMES = THEMES;
  window.SBL_THEMES_VERSION = '2026-08-24-pokemon-contrast';
  const THEME_KEY='sbl_dashboard_theme';
  const CUSTOM_KEY='sbl_dashboard_custom_theme';
  const TEAL='#5eead4', RED='#ff7a7a';
  // Older theme IDs remain resolvable so saved user preferences do not break when the theme catalog is curated.
  const LEGACY_THEME_ALIASES={"midnight2":"cobalt","charcoal":"slate","graphite2":"slate","smoke":"slate","silver":"slate","steel2":"cobalt","coffee":"orange","espresso":"orange","mahogany":"crimson","taupe":"orange","copper":"orange","terracotta":"crimson","scarlet":"crimson","berry":"rose","mustard":"yellow","citrus":"yellow","olive":"emerald","seafoam":"emerald","neon":"emerald","cyan2":"cyan","aqua2":"cyan","tropical":"emerald","frost":"cyan","frost2":"cyan","aurora":"emerald","denim":"cobalt","royal":"cobalt","plum":"violet","plum2":"violet","heather":"violet","orchid":"violet","iris":"cobalt","periwinkle":"cobalt","cyberpunk":"rose","twilight":"cobalt","obsidian":"cobalt","carbon":"cobalt","cocoa":"orange","sand":"orange","bronze":"orange","rust":"crimson","wine":"crimson","mauve":"rose","raspberry":"rose","apricot":"orange","cantaloupe":"orange","honey":"yellow","canary":"yellow","green":"emerald","pine":"emerald","chartreuse":"emerald","spring":"emerald","ice":"cyan","glacier":"cobalt","steel":"cobalt","denim2":"cobalt","marine":"cobalt","violet2":"violet","electric":"rose","northern":"cyan","mocha":"orange","ink":"slate","platinum":"slate","coolgray":"cobalt","warmgray":"orange","parchment":"orange","smokyblue":"cobalt","deepteal":"cyan","firefly":"emerald","copperblue":"orange","paper":"peach","cloud":"sky","snow":"sky","linen":"peach","cream":"peach","porcelain":"sky","mist":"sky","dove":"lavender","canvas":"peach","frostwhite":"arctic","cotton":"sky","almond":"peach","marble":"ivory","pearlblue":"sky","sage":"moss","pistachio":"moss","lemonade":"butter","peachcream":"peach","apricotlight":"peach","lilac":"lavender","periwinklelight":"sky","skywash":"sky","mintcream":"moss","tealwash":"arctic","lavenderrose":"rosepaper","bluegraylight":"sky","khaki":"yellow"};
  function read(key, fallback){try{const v=localStorage.getItem(key);return v||fallback}catch(e){return fallback}}
  function custom(){try{return JSON.parse(localStorage.getItem(CUSTOM_KEY)||'null')}catch(e){return null}}
  function themeFor(id){
    if(id==='custom'){
      const c=custom()||{};
      const base=THEMES.find(t=>t.id===(c.base||'amber'))||THEMES[0];
      const out=Object.assign({},base,c,{id:'custom',name:'Custom'});
      if(c.enabled) Object.keys(base).forEach(k=>{if(!['id','name'].includes(k)&&c.enabled[k]===false) out[k]=base[k]});
      return out;
    }
    const resolvedId=LEGACY_THEME_ALIASES[id]||id;
    return THEMES.find(t=>t.id===resolvedId)||THEMES[0];
  }
  function apply(){
    const id=read(THEME_KEY,'amber');
    const t=themeFor(id);
    const r=document.documentElement.style;
    const map={bg:'bg',panel:'panel',panelAlt:'panel-alt',border:'border',text:'text',textDim:'text-dim',accent:'amber',accentText:'amber-text'};
    Object.keys(map).forEach(k=>{if(t[k]) r.setProperty('--'+map[k],t[k])});
    const accent=t.accent||TEAL;
    const accentText=t.accentText||t.text;
    r.setProperty('--teal',accent);
    r.setProperty('--red',`color-mix(in srgb, #ef4444 72%, ${accent})`);
    r.setProperty('--sbl-theme-accent',accent);
    r.setProperty('--accent',accent);
    r.setProperty('--accent-text',accentText);
    r.setProperty('--panel2',t.panelAlt||t.panel);
    r.setProperty('--dim',t.textDim||t.text);
    r.setProperty('--sbl-card-bg',t.panel||t.bg);
    r.setProperty('--sbl-card-alt',t.panelAlt||t.panel||t.bg);
    r.setProperty('--sbl-card-border',t.border||accent);
    r.setProperty('--sbl-page-bg',t.bg);
    r.setProperty('--sbl-text',t.text);
    r.setProperty('--sbl-muted',t.textDim||t.text);
    document.documentElement.dataset.sblTheme=id;
  }

  function applyTheme(id, persist){
    if(persist !== false){ try{ localStorage.setItem(THEME_KEY,id); }catch(e){} }
    apply();
    return themeFor(id);
  }

  function applyGlobalThemeStyle(){
    const styleId='sbl-global-theme-polish';
    let style=document.getElementById(styleId);
    if(!style){
      style=document.createElement('style');
      style.id=styleId;
      document.head.appendChild(style);
    }

    style.textContent=`
      /* =========================================
         GLOBAL THEME SURFACES
         ========================================= */

      html,body{
        background-color:var(--sbl-page-bg) !important;
        color:var(--sbl-text) !important;
      }

      /* Common cards/panels across every page */
      .panel,.card,.set-card,.statbox,.notice,
      .roster-toolbar,.ticker,.speed-matrix-wrap,
      .team-card,.overview-card,.franchise-card,
      .record-card,.next-battle-card,.myteam-budget,
      .myteam-stat-card,.feedback-card,.roster-card,
      .trade-card,.budget-card,.pokemon-card,
      .mon-card,.speed-detail-card,.scout-nature-card,
      .answer-card,.coverage-card,.franchise-card-head,
      .conference-block,.conference-heading{
        background-color:var(--sbl-card-bg) !important;
        background-image:none !important;
        border-color:var(--sbl-card-border) !important;
        color:var(--sbl-text);
      }

      /* Secondary cards / controls */
      .mon,.mon-pill,.pick-card,.chip,.badge,
      .speed-pin-chip,.selected-chip,.prep-mode-tabs,
      .prep-mode-tab,.prep-week-pill,.prep-week-moves,
      .prep-usage-grid>div,.trade-col,
      .free-agent-card,.fa-card{
        background-color:var(--sbl-card-alt) !important;
        border-color:var(--sbl-card-border) !important;
        color:var(--sbl-text);
      }

      input,textarea,select{
        background-color:var(--sbl-card-alt) !important;
        border-color:var(--sbl-card-border) !important;
        color:var(--sbl-text) !important;
      }

      /* =========================================
         HEADINGS / TEXT CONTRAST
         ========================================= */

      .panel h1,.panel h2,.panel h3,.panel h4,.panel h5,.panel h6,
      .card h1,.card h2,.card h3,.card h4,.card h5,.card h6,
      .team-card-name,.overview-card .team-name,
      .franchise-card h1,.franchise-card h2,.franchise-card h3,
      .franchise-card h4,.franchise-header h1,.franchise-header h2,
      .section-title,.page-title,.card-title,.panel-title{
        color:var(--sbl-text) !important;
      }

      /* Existing pages had hard-coded white headings. */
      .death-cause-title,.stats-title,.overview-title,
      .team-overview-title,.fixture-title{
        color:var(--sbl-text) !important;
      }

      .note,.muted,.sub,.meta,.stat-label,
      .team-card-sub,.team-record,.fixture-v,.fixture-status{
        color:var(--sbl-muted) !important;
      }

      /* =========================================
         TEAM OVERVIEW / TEAM CARDS
         ========================================= */

      .team-card{
        background:var(--sbl-card-bg) !important;
        background-image:none !important;
        border:1px solid var(--sbl-card-border) !important;
        color:var(--sbl-text) !important;
      }

      .team-card:hover{
        background:var(--sbl-card-alt) !important;
        background-image:none !important;
        border-color:var(--amber) !important;
      }

      .team-card-name,.team-card-sub,
      .overview-card .team-name,.overview-card .team-record{
        color:var(--sbl-text) !important;
      }

      /* =========================================
         FIXTURES / RESULTS / POSITIVE STATS
         ========================================= */

      .fixture-match{
        background:var(--sbl-card-bg) !important;
        background-image:none !important;
        border-color:var(--sbl-card-border) !important;
        color:var(--sbl-text) !important;
      }

      .fixture-match:hover{
        background:var(--sbl-card-alt) !important;
        border-color:var(--sbl-card-border) !important;
      }

      .fixture-team{color:var(--sbl-text) !important;}
      .fixture-team.fixture-winner{
        color:var(--teal) !important;
        background:color-mix(in srgb,var(--teal) 10%,var(--sbl-card-bg)) !important;
      }

      .fixture-status{
        background:var(--sbl-card-alt) !important;
        color:var(--sbl-muted) !important;
        border-color:var(--sbl-card-border) !important;
      }

      .fixture-result,.fixture-summary,.myteam-summary-result,
      .kills,.kill,.kill-count,.stat-kills,.stat-win,.stat-wins,
      .win-count,.wins,.record-win,.result-win,.win-text{
        color:var(--teal) !important;
      }

      /* =========================================
         LADDER: NEVER HIDE LOWER TEAMS
         ========================================= */

      .standings-row{
        opacity:1 !important;
        visibility:visible !important;
        filter:none !important;
        background:var(--sbl-card-bg) !important;
        background-image:none !important;
        border-color:var(--sbl-card-border) !important;
        color:var(--sbl-text) !important;
      }

      .standings-row:hover{
        background:var(--sbl-card-alt) !important;
      }

      /* =========================================
         DARK SURFACES LEFT BY PAGE-SPECIFIC CSS
         ========================================= */

      #proposePanel,
      #proposePanel .trade-col,
      #tradeViewBody .trade-col,
      #tradeSummary,
      .trade-filter-panel{
        background:var(--sbl-card-bg) !important;
        background-image:none !important;
        border-color:var(--sbl-card-border) !important;
        color:var(--sbl-text) !important;
      }

      #proposePanel select,
      #proposePanel .fa-search-wrap input{
        background:var(--sbl-card-alt) !important;
        border-color:var(--sbl-card-border) !important;
        color:var(--sbl-text) !important;
      }

      #proposePanel .pick-card,
      #tradeViewBody .pick-card{
        background:var(--sbl-card-alt) !important;
        border-color:var(--sbl-card-border) !important;
      }

      #proposePanel .pick-card:hover,
      #tradeViewBody .pick-card:hover{
        background:var(--sbl-card-bg) !important;
        border-color:var(--amber) !important;
      }

      #proposePanel .pick-card .sprite,
      #proposePanel .selected-chip .sprite,
      #tradeViewBody .mon-pill .sprite{
        background:var(--sbl-card-bg) !important;
        border-color:var(--sbl-card-border) !important;
      }

      /* Admin status cards */
      .status-pill.approved,.status-pill.accepted{
        background:color-mix(in srgb,var(--teal) 12%,var(--sbl-card-bg)) !important;
        border-color:color-mix(in srgb,var(--teal) 45%,var(--sbl-card-border)) !important;
        color:var(--teal) !important;
      }

      /* =========================================
         MODALS / POPOUTS
         ========================================= */

      .modal-card,.profile-modal,.summary-modal,
      .overview-modal,.scout-popup-card,.prep-detail-dialog,
      .damage-calc-card{
        background:var(--sbl-card-bg) !important;
        background-image:none !important;
        border-color:var(--sbl-card-border) !important;
        color:var(--sbl-text) !important;
      }

      /* =========================================
         GENERIC BORDERS / BUTTONS
         ========================================= */

      hr{border-color:var(--sbl-card-border) !important;}

      button.ghost,button:not(.primary){
        background:var(--sbl-card-bg);
        border-color:var(--sbl-card-border);
        color:var(--sbl-text);
      }

      button.ghost:hover,button:not(.primary):hover{
        background:var(--sbl-card-alt);
      }

      /* Preserve intentionally white text inside type badges and
         other coloured Pokémon type labels. */
      .type-badge,.type-pill,[class^="type-"],[class*=" type-"]{
        color:#fff !important;
      }
    `;
  }

  // Public site-wide theme API. Pages should use this instead of maintaining
  // their own theme state/apply functions.
  window.SBLTheme = {
    list: () => THEMES.slice(),
    getSavedId: () => read(THEME_KEY,'amber'),
    getCustom: () => custom(),
    resolve: (id) => themeFor(id),
    apply: (id, persist=true) => {
      const target = id || read(THEME_KEY,'amber');
      applyTheme(target, persist);
      return themeFor(target);
    },
    reset: () => {
      try{ localStorage.removeItem(CUSTOM_KEY); }catch(e){}
      applyTheme('amber', true);
      return themeFor('amber');
    }
  };

  apply();
  window.addEventListener('storage',e=>{
    if(e.key===THEME_KEY||e.key===CUSTOM_KEY) apply();
  });
  window.SBLApplyGlobalTheme=apply;
})()
