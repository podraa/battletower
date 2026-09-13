// SBL shared theme engine — single source of truth for every theme preset
// and the logic that applies them. Loaded by every page via <script src>.
// To add or edit a theme, change THEMES here once; every page picks it up
// automatically on next load (no per-page edits needed).
(function(){
  const THEMES=[
    {id:'amber', name:'Amber', bg:'#0e1218', panel:'#1e242e', panelAlt:'#2f3743', border:'#2a3444', text:'#e8edf5', textDim:'#8996a8', accent:'#ffb454', accentText:'#1a1206', accent2:'#ddfa48'},
    {id:'slate', name:'Slate', bg:'#0b0f14', panel:'#1d232b', panelAlt:'#313842', border:'#303b49', text:'#edf2f7', textDim:'#9ba9b8', accent:'#94a3b8', accentText:'#10151d', accent2:'#887cc0'},
    {id:'onyx', name:'Onyx', bg:'#08090b', panel:'#191b20', panelAlt:'#2d2f35', border:'#2b3038', text:'#f1f3f6', textDim:'#9ca3af', accent:'#8b949e', accentText:'#0b0d10', accent2:'#6f65b5'},
    {id:'graphite', name:'Graphite', bg:'#0c0d0f', panel:'#1f2023', panelAlt:'#343639', border:'#35373d', text:'#eef0f2', textDim:'#9ba0a8', accent:'#a3a9b3', accentText:'#131417', accent2:'#9182c3'},
    {id:'monochrome', name:'Monochrome', bg:'#0b0b0d', panel:'#1f1f22', panelAlt:'#353538', border:'#38383d', text:'#f1f1f3', textDim:'#a7a7ad', accent:'#d4d4d8', accentText:'#18181b', accent2:'#bd9fd1'},
    {id:'ivory', name:'Ivory', bg:'#e4e0d7', panel:'#eeeae2', panelAlt:'#e0dbd0', border:'#c8c0b1', text:'#353129', textDim:'#777064', accent:'#a87838', accentText:'#241806', accent2:'#8fa233'},
    {id:'rose', name:'Rose', bg:'#1c0510', panel:'#331324', panelAlt:'#4b2338', border:'#5a1c3c', text:'#fdeef4', textDim:'#c99cb2', accent:'#f472b6', accentText:'#3b0a24', accent2:'#f6695e'},
    {id:'crimson', name:'Crimson', bg:'#16070c', panel:'#2d141b', panelAlt:'#43242e', border:'#5a1d2b', text:'#fff0f4', textDim:'#d39aaa', accent:'#f43f5e', accentText:'#3a0714', accent2:'#f8832c'},
    {id:'ember', name:'Ember', bg:'#170a07', panel:'#2f1b15', panelAlt:'#4a3228', border:'#63351f', text:'#fff0e5', textDim:'#d99b77', accent:'#ff8a4c', accentText:'#2a0d07', accent2:'#faf040'},
    {id:'orange', name:'Orange', bg:'#1a0f05', panel:'#312213', panelAlt:'#493522', border:'#5a3a1a', text:'#fdf3e8', textDim:'#cbab84', accent:'#fb923c', accentText:'#341102', accent2:'#effa2e'},
    {id:'gold', name:'Gold', bg:'#151006', panel:'#2e2312', panelAlt:'#493923', border:'#60471b', text:'#fff5d8', textDim:'#d2b66b', accent:'#f5c542', accentText:'#2b1c04', accent2:'#b6f92e'},
    {id:'emerald', name:'Emerald', bg:'#071410', panel:'#152921', panelAlt:'#263e35', border:'#1f4a37', text:'#eafff3', textDim:'#8fc7a8', accent:'#4ade80', accentText:'#052e12', accent2:'#3ae0da'},
    {id:'forest', name:'Forest', bg:'#06120c', panel:'#15251c', panelAlt:'#263b2f', border:'#1d4630', text:'#e9fff1', textDim:'#87b69a', accent:'#34d399', accentText:'#052416', accent2:'#28aad1'},
    {id:'jade', name:'Jade', bg:'#07130c', panel:'#16291e', panelAlt:'#2b4436', border:'#2b543a', text:'#e8fff0', textDim:'#79c69a', accent:'#4de39a', accentText:'#062513', accent2:'#3cd2e5'},
    {id:'mint', name:'Mint', bg:'#071511', panel:'#152c25', panelAlt:'#28433b', border:'#245346', text:'#edfff8', textDim:'#94c9b4', accent:'#6ee7b7', accentText:'#06271d', accent2:'#5ccbe8'},
    {id:'cyan', name:'Cyan', bg:'#051519', panel:'#132930', panelAlt:'#233e46', border:'#1c4a57', text:'#eafcff', textDim:'#8bc2cf', accent:'#22d3ee', accentText:'#032a30', accent2:'#104df2'},
    {id:'teal', name:'Teal', bg:'#071614', panel:'#152a28', panelAlt:'#263f3c', border:'#1f4a44', text:'#eafffa', textDim:'#8fc7bb', accent:'#5eead4', accentText:'#062521', accent2:'#4ca5ec'},
    {id:'aqua', name:'Aqua', bg:'#041315', panel:'#11292f', panelAlt:'#224249', border:'#1b5661', text:'#e9feff', textDim:'#8dc8ce', accent:'#2dd4bf', accentText:'#032522', accent2:'#257ecf'},
    {id:'arctic', name:'Arctic', bg:'#081319', panel:'#162830', panelAlt:'#29424d', border:'#27505f', text:'#eefcff', textDim:'#91bac5', accent:'#67e8f9', accentText:'#06252e', accent2:'#5483fb'},
    {id:'deepsea', name:'Deep Sea', bg:'#050f14', panel:'#13222a', panelAlt:'#243b43', border:'#1d4a59', text:'#e5faff', textDim:'#6fa5b5', accent:'#48c8df', accentText:'#05202a', accent2:'#3761e1'},
    {id:'sky', name:'Sky Blue', bg:'#071426', panel:'#15283f', panelAlt:'#283d57', border:'#2b4c70', text:'#eef6ff', textDim:'#9db4cc', accent:'#60a5fa', accentText:'#0b1a33', accent2:'#684efa'},
    {id:'azure', name:'Azure', bg:'#07111a', panel:'#162937', panelAlt:'#2a4558', border:'#285d7b', text:'#eaf8ff', textDim:'#73bfe8', accent:'#55b9ff', accentText:'#08202d', accent2:'#4b49fa'},
    {id:'cobalt', name:'Cobalt', bg:'#080e1b', panel:'#182235', panelAlt:'#2b3a53', border:'#274c7d', text:'#e9f1ff', textDim:'#7096d4', accent:'#5b8dff', accentText:'#0a1830', accent2:'#814efa'},
    {id:'navy', name:'Navy', bg:'#060d19', panel:'#151f2f', panelAlt:'#273548', border:'#243c5e', text:'#edf5ff', textDim:'#8fa7c5', accent:'#38bdf8', accentText:'#062039', accent2:'#273bf9'},
    {id:'ocean', name:'Ocean', bg:'#061118', panel:'#142833', panelAlt:'#264452', border:'#205b70', text:'#e6faff', textDim:'#67bfd5', accent:'#45c6e8', accentText:'#05232f', accent2:'#3356eb'},
    {id:'sapphire', name:'Sapphire', bg:'#060c18', panel:'#152037', panelAlt:'#283858', border:'#254777', text:'#eaf1ff', textDim:'#7e9bd0', accent:'#3b82f6', accentText:'#07152d', accent2:'#5628f9'},
    {id:'steelblue', name:'Steel Blue', bg:'#0a1118', panel:'#1c2630', panelAlt:'#313e4c', border:'#34495f', text:'#edf5ff', textDim:'#91a7bc', accent:'#7aa7c7', accentText:'#0b1c29', accent2:'#6e6dc4'},
    {id:'dusk', name:'Dusk', bg:'#0d0d18', panel:'#1f1f31', panelAlt:'#36364d', border:'#3a3a61', text:'#f0efff', textDim:'#a5a2c4', accent:'#a78bfa', accentText:'#17102c', accent2:'#e774fb'},
    {id:'midnight', name:'Midnight', bg:'#050713', panel:'#141829', panelAlt:'#272d43', border:'#263454', text:'#eaf0ff', textDim:'#7f8baa', accent:'#818cf8', accentText:'#0b1028', accent2:'#b46cfa'},
    {id:'violet', name:'Violet', bg:'#171224', panel:'#2c233f', panelAlt:'#423758', border:'#51406f', text:'#f7f2ff', textDim:'#b9aecf', accent:'#a78bfa', accentText:'#1e1033', accent2:'#e774fb'},
    {id:'lavender', name:'Lavender', bg:'#110f1c', panel:'#252137', panelAlt:'#3b3652', border:'#453b67', text:'#f6f1ff', textDim:'#b9add3', accent:'#c4b5fd', accentText:'#21153d', accent2:'#e174fb'},
    {id:'indigo', name:'Indigo', bg:'#0e0f1f', panel:'#1f2237', panelAlt:'#323650', border:'#38406a', text:'#eef0ff', textDim:'#a3a8cf', accent:'#818cf8', accentText:'#141033', accent2:'#b46cfa'},
    {id:'nebula', name:'Nebula', bg:'#0b0816', panel:'#1d182e', panelAlt:'#342c4b', border:'#3a2d5d', text:'#f1edff', textDim:'#a79bc7', accent:'#8b5cf6', accentText:'#160c2c', accent2:'#e948f9'},
    {id:'rosepaper', name:'Rose Paper', bg:'#eee5e8', panel:'#f7eef1', panelAlt:'#e7d9df', border:'#d5c0c9', text:'#3d3036', textDim:'#7d6973', accent:'#b86b87', accentText:'#fff7fa', accent2:'#b5735f'},
    {id:'fuchsia', name:'Fuchsia', bg:'#170815', panel:'#30152b', panelAlt:'#4c2843', border:'#66205a', text:'#ffeafd', textDim:'#e18bcf', accent:'#ef5fd0', accentText:'#28091e', accent2:'#f14c6a'},
    {id:'paper', name:'Paper', group:'Premium', bg:'#f5f1e8', panel:'#fffdf8', panelAlt:'#ebe5d8', border:'#d6ccba', text:'#292722', textDim:'#716b60', accent:'#806b4a', accentText:'#fffdf8', accent2:'#73823e'},
    {id:'porcelain', name:'Porcelain', group:'Premium', bg:'#e9eef2', panel:'#f8fafb', panelAlt:'#dfe6eb', border:'#c4d0d8', text:'#27313a', textDim:'#687783', accent:'#52758a', accentText:'#f7fbfd', accent2:'#44468d'},
    {id:'snowfall', name:'Snowfall', group:'Light', bg:'#f7f9fc', panel:'#ffffff', panelAlt:'#edf2f7', border:'#d5dde7', text:'#202733', textDim:'#687586', accent:'#5b7fa3', accentText:'#ffffff', accent2:'#8b9cf6'},
    {id:'cloud', name:'Cloud', group:'Light', bg:'#eef3f7', panel:'#fafdff', panelAlt:'#e2e9ef', border:'#c9d5df', text:'#27323d', textDim:'#6f7d89', accent:'#4f7ea8', accentText:'#ffffff', accent2:'#7b86d6'},
    {id:'linen', name:'Linen', group:'Light', bg:'#f4efe7', panel:'#fffaf2', panelAlt:'#ebe2d5', border:'#d8cbb9', text:'#3b352e', textDim:'#7b7165', accent:'#9a7650', accentText:'#fffaf3', accent2:'#80955b'},
    {id:'sage-light', name:'Sage Light', group:'Light', bg:'#edf3ec', panel:'#f9fcf7', panelAlt:'#e1eadf', border:'#c8d7c4', text:'#2d3a30', textDim:'#6c7c6e', accent:'#5d8a69', accentText:'#ffffff', accent2:'#7b9e52'},
    {id:'mint-light', name:'Mint Light', group:'Light', bg:'#eaf6f2', panel:'#f9fffd', panelAlt:'#dcece7', border:'#bdd5ce', text:'#243934', textDim:'#668078', accent:'#3f9a86', accentText:'#ffffff', accent2:'#4b8fd1'},
    {id:'sky-light', name:'Sky Light', group:'Light', bg:'#eaf3fb', panel:'#f9fcff', panelAlt:'#dce9f5', border:'#c0d4e5', text:'#263747', textDim:'#6b7f91', accent:'#4c86b8', accentText:'#ffffff', accent2:'#6978d8'},
    {id:'lavender-light', name:'Lavender Light', group:'Light', bg:'#f2effa', panel:'#fcfaff', panelAlt:'#e7e1f3', border:'#d2c8e3', text:'#342f40', textDim:'#766d86', accent:'#8066aa', accentText:'#ffffff', accent2:'#b16b9e'},
    {id:'rose-light', name:'Rose Light', group:'Light', bg:'#f8eef2', panel:'#fffafd', panelAlt:'#efdee5', border:'#dfc6d0', text:'#3d3037', textDim:'#806d76', accent:'#b56683', accentText:'#ffffff', accent2:'#c77a67'},
    {id:'pikachu', name:'Pikachu', group:'Pokemon', bg:'#171405', panel:'#302813', panelAlt:'#4d3f21', border:'#70551a', text:'#fff9d6', textDim:'#d8c36b', accent:'#facc15', accentText:'#221800', accent2:'#09f9c4'},
    {id:'charizard', name:'Charizard', group:'Pokemon', bg:'#1b0705', panel:'#391811', panelAlt:'#582920', border:'#7d2a16', text:'#fff2e8', textDim:'#e3a17c', accent:'#f97316', accentText:'#2c0903', accent2:'#09f966'},
    {id:'blastoise', name:'Blastoise', group:'Pokemon', bg:'#06121a', panel:'#142f37', panelAlt:'#26505a', border:'#256776', text:'#e8fbff', textDim:'#83c0ca', accent:'#38bdf8', accentText:'#05212d', accent2:'#f927bd'},
    {id:'venusaur', name:'Venusaur', group:'Pokemon', bg:'#071208', panel:'#193220', panelAlt:'#304d36', border:'#3c6941', text:'#efffe9', textDim:'#9bc58e', accent:'#4ade80', accentText:'#07200d', accent2:'#733ae0'},
    {id:'gengar', name:'Gengar', group:'Pokemon', bg:'#100719', panel:'#291836', panelAlt:'#432a57', border:'#5a3475', text:'#faefff', textDim:'#c1a0d5', accent:'#a855f7', accentText:'#1b092b', accent2:'#fa9c41'},
    {id:'umbreon', name:'Umbreon', group:'Pokemon', bg:'#07080c', panel:'#1c1d23', panelAlt:'#35363b', border:'#4b4c4f', text:'#fff6d5', textDim:'#b9ae82', accent:'#facc15', accentText:'#191603', accent2:'#09f9c4'},
    {id:'lucario', name:'Lucario', group:'Pokemon', bg:'#07121a', panel:'#15303b', panelAlt:'#295262', border:'#2b6877', text:'#eafcff', textDim:'#8bbdc9', accent:'#38bdf8', accentText:'#06202d', accent2:'#f927bd'},
    {id:'cyberpunk-neon', name:'Cyberpunk Neon', group:'Cyber', bg:'#05060b', panel:'#151824', panelAlt:'#292d3c', border:'#25405c', text:'#effcff', textDim:'#7fa7b8', accent:'#00f0ff', accentText:'#001a1e', accent2:'#ec1406'},
    {id:'synthwave', name:'Synthwave', group:'Crazy', bg:'#10051b', panel:'#251334', panelAlt:'#422454', border:'#5d286e', text:'#fff0ff', textDim:'#c993d0', accent:'#ff4fd8', accentText:'#280020', accent2:'#fa4364'},
    {id:'vaporwave', name:'Vaporwave', group:'Crazy', bg:'#100c22', panel:'#231d47', panelAlt:'#3b3368', border:'#51458a', text:'#f7f3ff', textDim:'#bdb4df', accent:'#7df9ff', accentText:'#071f2a', accent2:'#6ea0fb'},
    {id:'glitch', name:'Glitch', group:'Crazy', bg:'#080b0d', panel:'#191e22', panelAlt:'#2d3338', border:'#35434b', text:'#f3ffff', textDim:'#8db3bc', accent:'#00f5d4', accentText:'#001c18', accent2:'#067ce3'},
    {id:'crt', name:'CRT', group:'Crazy', bg:'#07100a', panel:'#152318', panelAlt:'#28392c', border:'#274c2e', text:'#d9ffe0', textDim:'#7caf84', accent:'#8cff98', accentText:'#06100a', accent2:'#74fbd3'},
    {id:'galaxy', name:'Galaxy', group:'Cosmic', bg:'#060713', panel:'#16182c', panelAlt:'#2b2d46', border:'#2d3560', text:'#f0f1ff', textDim:'#9ca5d2', accent:'#c084fc', accentText:'#1d0c2f', accent2:'#fb71ee'},
    {id:'sakura', name:'Sakura', group:'Pretty', bg:'#160a10', panel:'#301a23', panelAlt:'#4b2e39', border:'#653342', text:'#fff1f6', textDim:'#d8a3b3', accent:'#f9a8d4', accentText:'#341025', accent2:'#f97e76'},
    {id:'matcha', name:'Matcha', group:'Pretty', bg:'#0d1209', panel:'#1f2817', panelAlt:'#38422c', border:'#425331', text:'#f1f8e8', textDim:'#a5b88f', accent:'#a3c95c', accentText:'#162006', accent2:'#54c84e'},
    {id:'copper', name:'Copper', group:'Warm', bg:'#170d08', panel:'#2b1a12', panelAlt:'#463027', border:'#654331', text:'#fff2e8', textDim:'#d0a28a', accent:'#e69a63', accentText:'#2b1207', accent2:'#f2c14e'},
    {id:'wine', name:'Wine', group:'Warm', bg:'#17080f', panel:'#2d1520', panelAlt:'#472433', border:'#613044', text:'#ffeff5', textDim:'#d2a0b2', accent:'#e879a7', accentText:'#2d091a', accent2:'#c58cff'},
    {id:'terracotta', name:'Terracotta', group:'Warm', bg:'#1b0d0a', panel:'#302019', panelAlt:'#493129', border:'#664238', text:'#fff1e8', textDim:'#d3a493', accent:'#e58b67', accentText:'#2c1008', accent2:'#e5c05b'},
    {id:'pine', name:'Pine', group:'Nature', bg:'#07110d', panel:'#17251d', panelAlt:'#2a3a30', border:'#385341', text:'#ecfff3', textDim:'#94b9a2', accent:'#69c18a', accentText:'#082416', accent2:'#c3d85b'},
    {id:'olive', name:'Olive', group:'Nature', bg:'#11130a', panel:'#262a16', panelAlt:'#3b4124', border:'#525b2e', text:'#f4f8df', textDim:'#b0ba83', accent:'#b7c95a', accentText:'#202609', accent2:'#68c77b'},
    {id:'lagoon', name:'Lagoon', group:'Cool', bg:'#061318', panel:'#132b31', panelAlt:'#25434a', border:'#32616b', text:'#eaffff', textDim:'#8fc3c9', accent:'#4fd1c5', accentText:'#052420', accent2:'#5ca9ff'},
    {id:'denim', name:'Denim', group:'Cool', bg:'#08111d', panel:'#17273a', panelAlt:'#2a3e55', border:'#345674', text:'#edf6ff', textDim:'#91abc2', accent:'#6da7dc', accentText:'#092033', accent2:'#8b7cf6'},
    {id:'plum', name:'Plum', group:'Expressive', bg:'#130b18', panel:'#29182f', panelAlt:'#432746', border:'#5b3561', text:'#fcefff', textDim:'#c3a4c9', accent:'#c084fc', accentText:'#210b2d', accent2:'#f27ac7'},
    {id:'peony', name:'Peony', group:'Expressive', bg:'#180a12', panel:'#311923', panelAlt:'#4b2935', border:'#643946', text:'#fff0f5', textDim:'#d5a2b2', accent:'#f08ab5', accentText:'#351024', accent2:'#b99aff'},
    {id:'aurora', name:'Aurora', group:'Cosmic', bg:'#071014', panel:'#17262e', panelAlt:'#293d47', border:'#365766', text:'#edffff', textDim:'#91b6c0', accent:'#65e6c7', accentText:'#06251e', accent2:'#9c7bff'},
    {id:'eclipse', name:'Eclipse', group:'Cosmic', bg:'#090811', panel:'#1c1928', panelAlt:'#312d42', border:'#45405a', text:'#f2efff', textDim:'#aaa4bd', accent:'#b6a1ff', accentText:'#171129', accent2:'#ef82c9'},
    {id:'terminal', name:'Terminal', group:'Experimental', bg:'#070d09', panel:'#132018', panelAlt:'#24352a', border:'#31503a', text:'#e4ffe9', textDim:'#86ad91', accent:'#72f28b', accentText:'#06210d', accent2:'#4de0c0'},
    {id:'paper-blue', name:'Paper Blue', group:'Light', bg:'#edf3f8', panel:'#fbfdff', panelAlt:'#e0e9f1', border:'#c5d3df', text:'#28343f', textDim:'#6e7d89', accent:'#537fa5', accentText:'#ffffff', accent2:'#7774cf'},
    {id:'cream', name:'Cream', group:'Light', bg:'#f5efe2', panel:'#fffaf0', panelAlt:'#e9dfcf', border:'#d7c9b3', text:'#39332b', textDim:'#776e61', accent:'#96714a', accentText:'#fffaf1', accent2:'#788d52'},
    {id:'mist', name:'Mist', group:'Light', bg:'#eef3f2', panel:'#fbfdfc', panelAlt:'#e1e9e7', border:'#c8d6d3', text:'#293634', textDim:'#6d7e7b', accent:'#4f8d86', accentText:'#ffffff', accent2:'#687fc1'},
  ];
  // Single shared source of truth for every theme preset on the site.
  // Other scripts on this page (and the loader on other pages) read from
  // window.SBL_THEMES instead of keeping their own copy, so a theme only
  // ever needs to be added in one place.
  window.SBL_THEMES = THEMES;
  window.SBL_THEMES_VERSION = '2026-09-12-theme-studio-v3';
  const THEME_KEY='sbl_dashboard_theme';
  const CUSTOM_KEY='sbl_dashboard_custom_theme';
  const FAVORITES_KEY='sbl_dashboard_theme_favorites';
  const RECENT_KEY='sbl_dashboard_theme_recent';
  const TEAL='#5eead4', RED='#ff7a7a';
  // Older theme IDs remain resolvable so saved user preferences do not break when the theme catalog is curated.
  const LEGACY_THEME_ALIASES={"midnight2":"cobalt","charcoal":"slate","graphite2":"slate","smoke":"slate","silver":"slate","steel2":"cobalt","coffee":"orange","espresso":"orange","mahogany":"crimson","taupe":"orange","copper":"orange","terracotta":"crimson","scarlet":"crimson","berry":"rose","mustard":"slate","citrus":"slate","olive":"emerald","seafoam":"emerald","neon":"emerald","cyan2":"cyan","aqua2":"cyan","tropical":"emerald","frost":"cyan","frost2":"cyan","aurora":"emerald","denim":"cobalt","royal":"cobalt","plum":"violet","plum2":"violet","heather":"violet","orchid":"violet","iris":"cobalt","periwinkle":"cobalt","cyberpunk":"rose","twilight":"cobalt","obsidian":"cobalt","carbon":"cobalt","cocoa":"orange","sand":"orange","bronze":"orange","rust":"crimson","wine":"crimson","mauve":"rose","raspberry":"rose","apricot":"orange","cantaloupe":"orange","honey":"slate","canary":"slate","green":"emerald","pine":"emerald","chartreuse":"emerald","spring":"emerald","ice":"cyan","glacier":"cobalt","steel":"cobalt","denim2":"cobalt","marine":"cobalt","violet2":"violet","electric":"rose","northern":"cyan","mocha":"orange","ink":"slate","platinum":"slate","coolgray":"cobalt","warmgray":"orange","parchment":"orange","smokyblue":"cobalt","deepteal":"cyan","firefly":"emerald","copperblue":"orange","paper":"slate","cloud":"sky","snow":"sky","linen":"slate","cream":"slate","porcelain":"sky","mist":"sky","dove":"lavender","canvas":"slate","frostwhite":"arctic","cotton":"sky","almond":"slate","marble":"ivory","pearlblue":"sky","sage":"slate","pistachio":"slate","lemonade":"slate","peachcream":"slate","apricotlight":"slate","lilac":"lavender","periwinklelight":"sky","skywash":"sky","mintcream":"slate","tealwash":"arctic","lavenderrose":"rosepaper","bluegraylight":"sky","khaki":"slate","holographic":"galaxy","magenta":"rose","blush":"rosepaper","plasma":"crimson","rgb-gamer":"synthwave","pearl":"monochrome","ruby":"crimson","cherry":"rose","coral":"rose","tangerine":"orange","sunset":"orange","peach":"ember","yellow":"pikachu","marigold":"gold","honeycomb":"gold","butter":"ivory","moss":"matcha","lime":"matcha","turquoise":"aqua","lagoon":"aqua","amethyst":"dusk","grape":"gengar","espeon":"galaxy","greninja":"crimson","rayquaza":"crimson","mewtwo":"galaxy","eevee":"ember","sylveon":"arctic","scizor":"crimson","metagross":"sky","dragapult":"aqua","mimikyu":"pikachu","dialga":"umbreon","palkia":"cyan","giratina":"umbreon","zacian":"crimson","zamazenta":"monochrome","kyogre":"forest","groudon":"crimson","peach-light":"linen","buttercream":"ivory","stone-light":"sage-light","terminal":"venusaur","matrix":"venusaur","rgb":"cyberpunk-neon","deep-space":"navy","starlight":"monochrome","supernova":"gold","eclipse":"umbreon","ocean-breeze":"teal","lavender-mist":"lavender","rose-gold":"blush","cotton-candy":"sakura","moonlight":"monochrome","meadow":"crt","inferno":"charizard","blood-moon":"crimson","toxic":"umbreon","frostbite":"vaporwave","volcanic":"charizard","storm":"lavender","master-ball":"galaxy","ultra-ball":"umbreon","great-ball":"sapphire","pokeball":"crimson","mew":"sakura","darkrai":"dusk","volcarona":"orange","garchomp":"sky","zeraora":"gold","lugia":"monochrome","void":"monochrome","nuclear":"umbreon","hellfire":"crimson","black-gold":"gold","whiteout":"paper","chaos":"synthwave","neon-city":"cyberpunk-neon","radioactive":"matcha","amber":"gold"};
  function read(key, fallback){try{const v=localStorage.getItem(key);return v||fallback}catch(e){return fallback}}
  function readJSON(key, fallback){try{const v=JSON.parse(localStorage.getItem(key)||'null');return v==null?fallback:v}catch(e){return fallback}}
  function writeJSON(key, value){try{localStorage.setItem(key, JSON.stringify(value))}catch(e){}}
  function hexRgb(hex){
    const h=String(hex||'').replace('#','');
    if(h.length!==6 || /[^0-9a-f]/i.test(h)) return null;
    return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));
  }
  function relativeLuminance(hex){
    const rgb=hexRgb(hex); if(!rgb) return 0.5;
    const c=rgb.map(v=>v/255).map(v=>v<=0.03928?v/12.92:Math.pow((v+.055)/1.055,2.4));
    return .2126*c[0]+.7152*c[1]+.0722*c[2];
  }
  function contrast(a,b){
    const x=relativeLuminance(a), y=relativeLuminance(b);
    const hi=Math.max(x,y), lo=Math.min(x,y);
    return (hi+.05)/(lo+.05);
  }
  function mixHex(a,b,amount){
    const ar=hexRgb(a), br=hexRgb(b); if(!ar||!br) return a||b;
    const t=Math.max(0,Math.min(1,amount));
    return '#'+ar.map((v,i)=>Math.round(v+(br[i]-v)*t).toString(16).padStart(2,'0')).join('');
  }
  function bestTextColor(bg){
    const candidates=['#111827','#0b1220','#ffffff'];
    return candidates.sort((a,b)=>contrast(b,bg)-contrast(a,bg))[0];
  }
  function normalizeTheme(theme){
    const t=Object.assign({},theme||{});
    // Theme presets are treated as palettes, not trusted CSS. Correct only
    // combinations that would make normal controls difficult to read.
    let accent=t.accent;
    let accentText=bestTextColor(accent);
    if(contrast(accent,accentText)<4.5){
      const toward=accentText==='#ffffff'?'#000000':'#ffffff';
      for(let i=1;i<=8 && contrast(accent,accentText)<4.5;i++) accent=mixHex(accent,toward,.08);
    }
    t.accent=accent;
    t.accentText=contrast(accent,t.accentText)>=4.5?accentText:bestTextColor(accent);
    let dim=t.textDim;
    if(t.panel && dim && contrast(t.panel,dim)<4.5){
      for(let i=1;i<=6 && contrast(t.panel,dim)<4.5;i++) dim=mixHex(dim,t.text,.10);
    }
    t.textDim=dim;
    if(t.border && t.panelAlt && contrast(t.panelAlt,t.border)<1.35){
      let border=t.border;
      for(let i=1;i<=5 && contrast(t.panelAlt,border)<1.35;i++) border=mixHex(border,t.text,.14);
      t.border=border;
    }
    return t;
  }
  function favoriteIds(){return readJSON(FAVORITES_KEY,[]).filter(id=>typeof id==='string')}
  function recentIds(){return readJSON(RECENT_KEY,[]).filter(id=>typeof id==='string')}
  function setFavorites(ids){writeJSON(FAVORITES_KEY,[...new Set(ids)])}
  function setRecent(id){if(!id||id==='custom') return; writeJSON(RECENT_KEY,[id,...recentIds().filter(x=>x!==id)].slice(0,12))}
  function custom(){try{return JSON.parse(localStorage.getItem(CUSTOM_KEY)||'null')}catch(e){return null}}
  function themeFor(id){
    if(id==='custom'){
      const c=custom()||{};
      const baseId=THEMES.some(t=>t.id===c.base)?c.base:(LEGACY_THEME_ALIASES[c.base]||'slate');
      const base=THEMES.find(t=>t.id===baseId)||THEMES[0];
      const out=Object.assign({},base,c,{id:'custom',name:'Custom'});
      if(c.enabled) Object.keys(base).forEach(k=>{if(!['id','name'].includes(k)&&c.enabled[k]===false) out[k]=base[k]});
      return normalizeTheme(out);
    }
    const resolvedId=THEMES.some(t=>t.id===id)?id:(LEGACY_THEME_ALIASES[id]||id);
    return normalizeTheme(THEMES.find(t=>t.id===resolvedId)||THEMES[0]);
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
    const accent2=t.accent2||accent;
    r.setProperty('--sbl-theme-accent',accent);
    r.setProperty('--sbl-theme-accent2',accent2);
    r.setProperty('--accent',accent);
    r.setProperty('--accent2',accent2);
    r.setProperty('--accent-text',accentText);
    r.setProperty('--sbl-theme-gradient',`linear-gradient(135deg, color-mix(in srgb, ${accent} 14%, transparent), transparent 46%, color-mix(in srgb, ${accent2} 12%, transparent))`);
    r.setProperty('--panel2',t.panelAlt||t.panel);
    r.setProperty('--dim',t.textDim||t.text);
    r.setProperty('--sbl-card-bg',t.panel||t.bg);
    r.setProperty('--sbl-card-alt',t.panelAlt||t.panel||t.bg);
    // A pale neutral surface is deliberately mixed into darker themes so content areas have a little breathing room.
    r.setProperty('--sbl-contrast-surface', `color-mix(in srgb, ${t.text||'#fff'} 9%, ${t.panelAlt||t.panel||t.bg})`);
    r.setProperty('--sbl-contrast-soft', `color-mix(in srgb, ${t.text||'#fff'} 4%, ${t.panel||t.bg})`);
    r.setProperty('--sbl-card-border',t.border||accent);
    r.setProperty('--sbl-page-bg',t.bg);
    r.setProperty('--sbl-success',`color-mix(in srgb, #22c55e 72%, ${accent})`);
    r.setProperty('--sbl-danger',`color-mix(in srgb, #ef4444 72%, ${accent})`);
    r.setProperty('--sbl-warning',`color-mix(in srgb, #f59e0b 72%, ${accent})`);
    r.setProperty('--sbl-info',`color-mix(in srgb, #38bdf8 72%, ${accent})`);
    r.setProperty('--sbl-focus',accent);
    r.setProperty('--sbl-shadow',`0 12px 34px color-mix(in srgb, ${accent} 10%, transparent)`);
    r.setProperty('--sbl-text',t.text);
    r.setProperty('--sbl-muted',t.textDim||t.text);
    document.documentElement.dataset.sblTheme=id;
    document.documentElement.dataset.sblThemeGroup=String(t.group||'').toLowerCase().replace(/[^a-z0-9]+/g,'-');
    const hex=String(t.bg||'').replace('#','');
    let lum=0;
    if(hex.length===6){
      const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4));
      lum=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
    }
    const tone=lum>.55?'light':lum<.16?'dark':'balanced';
    document.documentElement.dataset.sblThemeTone=tone;
    const toneVars={
      light:{ambient:'0.055',ambientAlt:'0.035',glow:'0.08',shadow:'0 10px 28px rgba(31,41,55,.10)'},
      balanced:{ambient:'0.09',ambientAlt:'0.055',glow:'0.12',shadow:'0 12px 34px rgba(0,0,0,.13)'},
      dark:{ambient:'0.15',ambientAlt:'0.09',glow:'0.18',shadow:'0 12px 34px rgba(0,0,0,.22)'}
    }[tone];
    r.setProperty('--sbl-ambient-opacity',toneVars.ambient);
    r.setProperty('--sbl-ambient-alt-opacity',toneVars.ambientAlt);
    r.setProperty('--sbl-glow-strength',toneVars.glow);
    r.setProperty('--sbl-surface-shadow',toneVars.shadow);
  }

  function applyTheme(id, persist){
    if(persist !== false){ try{ localStorage.setItem(THEME_KEY,id); }catch(e){} }
    const root=document.documentElement;
    const previous=root.dataset.sblTheme;
    if(previous && previous!==id){ root.classList.add('sbl-theme-transition'); window.clearTimeout(window.__sblThemeTransitionTimer); window.__sblThemeTransitionTimer=window.setTimeout(()=>root.classList.remove('sbl-theme-transition'),280); }
    apply();
    const t=themeFor(id);
    setRecent(t.id);
    root.dataset.sblThemeGroup = String(t.group||'').toLowerCase().replace(/[^a-z0-9]+/g,'-');
    return t;
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

      /* =========================================
         GLOBAL AMBIENT GLOW
         Gives the whole site the same subtle
         atmospheric lighting as the theme background.
         The effect is intentionally soft and restrained.
         ========================================= */
      body{
        position:relative;
        isolation:isolate;
      }
      body::before,body::after{
        content:"";
        position:fixed;
        pointer-events:none;
        z-index:-1;
        border-radius:999px;
        filter:blur(70px);
        opacity:var(--sbl-ambient-opacity,.09);
        transform:translateZ(0);
        will-change:transform;
      }
      body::before{
        width:42vw;
        height:42vw;
        max-width:620px;
        max-height:620px;
        left:-12vw;
        top:8vh;
        background:radial-gradient(circle,var(--sbl-theme-accent) 0%,transparent 68%);
      }
      body::after{
        width:36vw;
        height:36vw;
        max-width:540px;
        max-height:540px;
        right:-10vw;
        bottom:4vh;
        background:radial-gradient(circle,var(--sbl-info) 0%,transparent 70%);
        opacity:var(--sbl-ambient-alt-opacity,.055);
      }

      /* Ambient glow follows major interactive surfaces. */
      .panel,.card,.set-card,.statbox,.notice,
      .roster-toolbar,.ticker,.speed-matrix-wrap,
      .team-card,.overview-card,.franchise-card,
      .modal-card,.profile-modal,.summary-modal,
      .theme-card,.theme-preview,.popout,.dropdown-menu{
        box-shadow:
          0 10px 30px color-mix(in srgb,var(--sbl-theme-accent) 5%,transparent),
          var(--sbl-surface-shadow,var(--sbl-shadow,0 12px 34px rgba(0,0,0,.08)));
      }

      .panel:hover,.card:hover,.set-card:hover,.statbox:hover,
      .team-card:hover,.overview-card:hover,.franchise-card:hover,
      .theme-card:hover,.popout:hover{
        box-shadow:
          0 0 0 1px color-mix(in srgb,var(--sbl-theme-accent) 12%,transparent),
          0 10px 34px color-mix(in srgb,var(--sbl-theme-accent) 10%,transparent),
          var(--sbl-surface-shadow,var(--sbl-shadow,0 12px 34px rgba(0,0,0,.08)));
      }

      /* Small accent glow on controls, without making every element neon. */
      button,.btn,.primary,.btn-primary,.accent-btn,
      input,select,textarea,.search-input,.filter-input{
        transition:box-shadow .18s ease,filter .18s ease,border-color .18s ease,background-color .18s ease;
      }
      button:hover,.btn:hover,.primary:hover,.btn-primary:hover,.accent-btn:hover{
        box-shadow:0 0 18px color-mix(in srgb,var(--sbl-theme-accent) var(--sbl-glow-strength,12%),transparent);
      }
      input:focus,select:focus,textarea:focus,.search-input:focus,.filter-input:focus{
        box-shadow:0 0 0 3px color-mix(in srgb,var(--sbl-theme-accent) 12%,transparent),
                   0 0 18px color-mix(in srgb,var(--sbl-theme-accent) 12%,transparent) !important;
      }

      /* Accent line/highlight on navigation and section headings. */
      .page-nav,.top-nav,.site-nav{
        box-shadow:
          0 1px 0 color-mix(in srgb,var(--sbl-theme-accent) calc(var(--sbl-glow-strength,12%) * .90),transparent),
          0 8px 28px color-mix(in srgb,var(--sbl-theme-accent) 6%,transparent);
      }
      h1,h2,h3,.section-title,.page-title{
        text-shadow:0 0 18px color-mix(in srgb,var(--sbl-theme-accent) 10%,transparent);
      }

      @media(prefers-reduced-motion:reduce){
        body::before,body::after{will-change:auto;}
        button,.btn,.primary,.btn-primary,.accent-btn,input,select,textarea,.search-input,.filter-input{transition:none!important;}
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
         DISTINCT THEME ATMOSPHERE
         Each theme gets a second accent and a restrained
         two-tone ambient field. This is intentionally
         theme-driven rather than one generic glow.
         ========================================= */

      body{
        background-color:var(--sbl-page-bg) !important;
        background-image:
          radial-gradient(900px 520px at 8% 0%, color-mix(in srgb,var(--sbl-theme-accent) calc(var(--sbl-glow-strength,12%) * .70),transparent), transparent 68%),
          radial-gradient(760px 480px at 94% 18%, color-mix(in srgb,var(--sbl-theme-accent2) calc(var(--sbl-glow-strength,12%) * .55),transparent), transparent 70%),
          var(--sbl-theme-gradient) !important;
        background-attachment:fixed;
      }

      .panel,.card,.modal-card,.profile-modal,.summary-modal,
      .overview-modal,.scout-popup-card,.prep-detail-dialog,
      .damage-calc-card{
        background-image:
          linear-gradient(145deg,
            color-mix(in srgb,var(--sbl-theme-accent) 3%,transparent),
            transparent 42%,
            color-mix(in srgb,var(--sbl-theme-accent2) 3%,transparent)) !important;
      }

      .panel:hover,.card:hover{
        box-shadow:
          0 14px 38px color-mix(in srgb,var(--sbl-theme-accent) 10%,transparent),
          0 0 0 1px color-mix(in srgb,var(--sbl-theme-accent2) calc(var(--sbl-glow-strength,12%) * .75),transparent) !important;
      }

      .page-nav{
        background-image:
          linear-gradient(90deg,
            color-mix(in srgb,var(--sbl-theme-accent) 9%,transparent),
            transparent 48%,
            color-mix(in srgb,var(--sbl-theme-accent2) 8%,transparent)) !important;
      }

      .primary,.btn-primary,.accent-btn{
        box-shadow:0 6px 20px color-mix(in srgb,var(--sbl-theme-accent) var(--sbl-glow-strength,12%),transparent);
      }

      input:focus,select:focus,textarea:focus{
        box-shadow:0 0 0 3px color-mix(in srgb,var(--sbl-theme-accent) 12%,transparent),
                   0 0 22px color-mix(in srgb,var(--sbl-theme-accent2) 10%,transparent) !important;
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
      .sbl-theme-transition{color-scheme:dark;}
      :focus-visible{outline-color:var(--sbl-focus) !important;}
      .ok,.success,.status-success,.positive,.text-success{color:var(--sbl-success) !important;}
      .danger,.error,.status-danger,.negative,.text-danger{color:var(--sbl-danger) !important;}
      .warning,.status-warning,.text-warning{color:var(--sbl-warning) !important;}
      .info,.status-info,.text-info{color:var(--sbl-info) !important;}
      .panel,.card,.modal-card,.profile-modal,.summary-modal{box-shadow:var(--sbl-shadow,0 12px 34px rgba(0,0,0,.08));}
      .page-nav a:hover,.page-nav button:hover{color:var(--sbl-theme-accent) !important;}
      .primary,.btn-primary,.accent-btn{background:var(--sbl-theme-accent) !important;color:var(--accent-text) !important;border-color:var(--sbl-theme-accent) !important;}
      .primary:hover,.btn-primary:hover,.accent-btn:hover{filter:brightness(1.08);}
      .type-badge,.type-pill,[class^="type-"],[class*=" type-"]{ color:#fff !important; }
      html.sbl-theme-transition *,html.sbl-theme-transition *::before,html.sbl-theme-transition *::after{transition-property:background-color,border-color,color,box-shadow,fill,stroke !important;transition-duration:220ms !important;}
      [data-sbl-theme-group=unhinged] .page-nav{box-shadow:0 0 22px color-mix(in srgb,var(--accent) 18%,transparent);}
      [data-sbl-theme=cyberpunk] .page-nav,[data-sbl-theme=neon-city] .page-nav{background-image:linear-gradient(90deg,color-mix(in srgb,var(--accent) 10%,transparent),transparent 45%,color-mix(in srgb,var(--accent) 8%,transparent)) !important;}
      [data-sbl-theme=crt] body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:99999;background:repeating-linear-gradient(to bottom,rgba(255,255,255,.025) 0,rgba(255,255,255,.025) 1px,transparent 1px,transparent 4px);mix-blend-mode:overlay;}
      [data-sbl-theme=glitch] .page-nav,[data-sbl-theme=glitch] .panel{filter:saturate(1.04);}
      [data-sbl-theme=rgb-gamer] .page-nav{animation:sblRgbHue 8s linear infinite;}
      @keyframes sblRgbHue{0%{filter:hue-rotate(0deg)}100%{filter:hue-rotate(360deg)}}
      /* =========================================
         THEME-SPECIFIC MOTION
         ========================================= */
      [data-sbl-theme=rgb-gamer] .page-nav{
        animation:sblRgbHue 8s linear infinite;
      }

      [data-sbl-theme=glitch] .page-nav{
        position:relative;
        overflow:hidden;
      }
      [data-sbl-theme=glitch] .page-nav::after{
        content:"";position:absolute;inset:0;pointer-events:none;opacity:.22;
        background:repeating-linear-gradient(to bottom,transparent 0 6px,rgba(255,255,255,.10) 7px,transparent 8px);
        mix-blend-mode:screen;
      }
      body.sbl-glitch-transition-out::before{
        content:"";position:fixed;inset:0;z-index:2147483647;pointer-events:none;
        background:
          linear-gradient(90deg,rgba(255,0,75,.22),transparent 18%,transparent 82%,rgba(0,220,255,.20)),
          repeating-linear-gradient(to bottom,transparent 0 5px,rgba(255,255,255,.10) 6px,transparent 7px);
        animation:sblGlitchOut .18s steps(2,end) both;
      }
      body.sbl-glitch-transition-out #app,body.sbl-glitch-transition-out .page-nav{
        animation:sblGlitchJitter .18s steps(2,end) both;
      }
      @keyframes sblGlitchOut{
        0%{opacity:0;clip-path:inset(0)}
        20%{opacity:1;clip-path:inset(12% 0 62% 0);transform:translateX(-5px)}
        42%{clip-path:inset(56% 0 21% 0);transform:translateX(6px)}
        65%{clip-path:inset(26% 0 43% 0);transform:translateX(-3px)}
        100%{opacity:0;clip-path:inset(0);transform:none}
      }
      @keyframes sblGlitchJitter{
        0%{transform:none;filter:none}
        25%{transform:translate(3px,-1px);filter:hue-rotate(28deg)}
        50%{transform:translate(-4px,1px);filter:hue-rotate(-24deg)}
        75%{transform:translate(2px,0);filter:saturate(1.7)}
        100%{transform:none;filter:none}
      }

      [data-sbl-theme=aurora] body::before,[data-sbl-theme=nebula] body::before{
        animation:sblAmbientDrift 12s ease-in-out infinite alternate;
      }
      [data-sbl-theme=aurora] .page-nav,[data-sbl-theme=sunset] .page-nav{
        background-size:200% 100% !important;
        animation:sblGradientShift 10s ease-in-out infinite alternate;
      }
      [data-sbl-theme=ember] .page-nav,[data-sbl-theme=crimson] .page-nav{
        animation:sblWarmPulse 5s ease-in-out infinite;
      }
      @keyframes sblGradientShift{from{background-position:0% 50%}to{background-position:100% 50%}}
      @keyframes sblAmbientDrift{from{transform:translate3d(-2vw,-1vh,0) scale(1)}to{transform:translate3d(3vw,2vh,0) scale(1.06)}}
      @keyframes sblWarmPulse{0%,100%{box-shadow:0 1px 0 color-mix(in srgb,var(--sbl-theme-accent) calc(var(--sbl-glow-strength,12%) * .90),transparent),0 8px 28px color-mix(in srgb,var(--sbl-theme-accent) 6%,transparent)}50%{box-shadow:0 1px 0 color-mix(in srgb,var(--sbl-theme-accent) 25%,transparent),0 8px 32px color-mix(in srgb,var(--sbl-theme-accent) calc(var(--sbl-glow-strength,12%) * .70),transparent)}}

      @media(prefers-reduced-motion:reduce){
        html.sbl-theme-transition *,[data-sbl-theme=rgb-gamer] .page-nav,
        [data-sbl-theme=aurora] body::before,[data-sbl-theme=nebula] body::before,
        [data-sbl-theme=aurora] .page-nav,[data-sbl-theme=sunset] .page-nav,
        [data-sbl-theme=ember] .page-nav,[data-sbl-theme=crimson] .page-nav{transition:none!important;animation:none!important}
      }
    `;
  }

  // Public site-wide theme API. Pages should use this instead of maintaining
  // their own theme state/apply functions.
  window.SBLTheme = {
    list: () => THEMES.map(normalizeTheme),
    getSavedId: () => read(THEME_KEY,'amber'),
    getCustom: () => custom(),
    getFavorites: () => favoriteIds(),
    getRecent: () => recentIds(),
    isFavorite: (id) => favoriteIds().includes(id),
    toggleFavorite: (id) => { const ids=favoriteIds(); const next=ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]; setFavorites(next); return next; },
    saveCustom: (theme) => { const base=themeFor(theme?.base||'amber'); const customTheme=normalizeTheme(Object.assign({},base,theme||{}, {id:'custom',name:theme?.name||'Custom'})); writeJSON(CUSTOM_KEY,customTheme); applyTheme('custom',true); return customTheme; },
    clearCustom: () => { try{localStorage.removeItem(CUSTOM_KEY)}catch(e){}; return applyTheme('amber',true); },
    exportTheme: (id) => JSON.stringify(themeFor(id||read(THEME_KEY,'amber')),null,2),
    importTheme: (payload) => { const obj=typeof payload==='string'?JSON.parse(payload):payload; if(!obj||typeof obj!=='object') throw new Error('Invalid theme'); return window.SBLTheme.saveCustom(obj); },
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

  applyGlobalThemeStyle();
  apply();
  window.addEventListener('storage',e=>{
    if(e.key===THEME_KEY||e.key===CUSTOM_KEY) apply();
  });
  window.SBLApplyGlobalTheme=apply;
})()
