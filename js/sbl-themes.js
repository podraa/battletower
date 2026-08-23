// SBL shared theme engine — single source of truth for every theme preset
// and the logic that applies them. Loaded by every page via <script src>.
// To add or edit a theme, change THEMES here once; every page picks it up
// automatically on next load (no per-page edits needed).
(function(){
  const THEMES=[
    {id:'cyberpunk-neon', name:'Cyberpunk Neon', group:'Cyber', bg:'#05060b', panel:'#0c101c', panelAlt:'#151a2a', border:'#25405c', text:'#effcff', textDim:'#7fa7b8', accent:'#00f0ff', accentText:'#001a1e', accent2:'#ec1406'},
    {id:'synthwave', name:'Synthwave', group:'Cyber', bg:'#10051a', panel:'#1d0a2b', panelAlt:'#2d1040', border:'#55206b', text:'#fff0ff', textDim:'#c28bd4', accent:'#ff3cac', accentText:'#27001b', accent2:'#32fa87'},
    {id:'vaporwave', name:'Vaporwave', group:'Cyber', bg:'#0b0820', panel:'#171239', panelAlt:'#241b52', border:'#4d3c7c', text:'#f8f3ff', textDim:'#a99bd0', accent:'#67e8f9', accentText:'#071c28', accent2:'#fb6754'},
    {id:'holographic', name:'Holographic', group:'Cyber', bg:'#0b0f16', panel:'#121b26', panelAlt:'#1c2a38', border:'#36546a', text:'#effcff', textDim:'#8fb8c5', accent:'#a78bfa', accentText:'#17102c', accent2:'#d9fb74'},
    {id:'plasma', name:'Plasma', group:'Cyber', bg:'#090512', panel:'#160b22', panelAlt:'#241237', border:'#4c2563', text:'#fff2ff', textDim:'#c092d0', accent:'#e879f9', accentText:'#26002c', accent2:'#78fb64'},
    {id:'glitch', name:'Glitch', group:'Cyber', bg:'#050505', panel:'#0d0d0d', panelAlt:'#181818', border:'#303030', text:'#f8f8f8', textDim:'#999999', accent:'#00ff9d', accentText:'#00170e', accent2:'#ec065f'},
    {id:'crt', name:'CRT Terminal', group:'Cyber', bg:'#030805', panel:'#07130a', panelAlt:'#0b1d10', border:'#1c4527', text:'#d8ffe4', textDim:'#6db27e', accent:'#39ff88', accentText:'#001b09', accent2:'#fa2fa9'},
    {id:'rgb-gamer', name:'RGB Gamer', group:'Cyber', bg:'#07070b', panel:'#11111a', panelAlt:'#1a1a29', border:'#35354e', text:'#f6f6ff', textDim:'#a5a5bf', accent:'#ff3cac', accentText:'#240016', accent2:'#32fa87'},
    {id:'monochrome', name:'Monochrome', bg:'#0b0b0d', panel:'#17171a', panelAlt:'#222226', border:'#38383d', text:'#f1f1f3', textDim:'#a7a7ad', accent:'#d4d4d8', accentText:'#18181b', accent2:'#bd9fd1'},
    {id:'slate', name:'Slate', bg:'#0b0f14', panel:'#151b23', panelAlt:'#1e2630', border:'#303b49', text:'#edf2f7', textDim:'#9ba9b8', accent:'#94a3b8', accentText:'#10151d', accent2:'#887cc0'},
    {id:'onyx', name:'Onyx', bg:'#08090b', panel:'#111318', panelAlt:'#191c22', border:'#2b3038', text:'#f1f3f6', textDim:'#9ca3af', accent:'#8b949e', accentText:'#0b0d10', accent2:'#6f65b5'},
    {id:'graphite', name:'Graphite', bg:'#0c0d0f', panel:'#17181b', panelAlt:'#212327', border:'#35373d', text:'#eef0f2', textDim:'#9ba0a8', accent:'#a3a9b3', accentText:'#131417', accent2:'#9182c3'},
    {id:'ivory', name:'Ivory', bg:'#e4e0d7', panel:'#eeeae2', panelAlt:'#e0dbd0', border:'#c8c0b1', text:'#353129', textDim:'#777064', accent:'#a87838', accentText:'#241806', accent2:'#8fa233'},
    {id:'pearl', name:'Pearl', bg:'#151517', panel:'#222225', panelAlt:'#303034', border:'#47474d', text:'#f7f7f8', textDim:'#b4b4bc', accent:'#d2d2d8', accentText:'#17171a', accent2:'#bd9fd1'},
    {id:'rose', name:'Rose', bg:'#1c0510', panel:'#2c0a1c', panelAlt:'#3a0f26', border:'#5a1c3c', text:'#fdeef4', textDim:'#c99cb2', accent:'#f472b6', accentText:'#3b0a24', accent2:'#f6695e'},
    {id:'ruby', name:'Ruby', bg:'#17070d', panel:'#270d16', panelAlt:'#3a1420', border:'#681f35', text:'#ffeaf1', textDim:'#e889a4', accent:'#ff527d', accentText:'#290710', accent2:'#fa8546'},
    {id:'crimson', name:'Crimson', bg:'#16070c', panel:'#250b13', panelAlt:'#32101b', border:'#5a1d2b', text:'#fff0f4', textDim:'#d39aaa', accent:'#f43f5e', accentText:'#3a0714', accent2:'#f8832c'},
    {id:'cherry', name:'Cherry', bg:'#17080b', panel:'#281015', panelAlt:'#3a1820', border:'#672431', text:'#ffecef', textDim:'#e78b9c', accent:'#ff6b81', accentText:'#2b080d', accent2:'#fba45d'},
    {id:'ember', name:'Ember', bg:'#170a07', panel:'#27130c', panelAlt:'#391f14', border:'#63351f', text:'#fff0e5', textDim:'#d99b77', accent:'#ff8a4c', accentText:'#2a0d07', accent2:'#faf040'},
    {id:'orange', name:'Orange', bg:'#1a0f05', panel:'#2a1a0a', panelAlt:'#38220e', border:'#5a3a1a', text:'#fdf3e8', textDim:'#cbab84', accent:'#fb923c', accentText:'#341102', accent2:'#effa2e'},
    {id:'coral', name:'Coral', bg:'#1b0b08', panel:'#2b1410', panelAlt:'#3a1c16', border:'#63352a', text:'#fff2ed', textDim:'#d2a69a', accent:'#fb7185', accentText:'#3b0d0a', accent2:'#fba65f'},
    {id:'tangerine', name:'Tangerine', bg:'#1a0e06', panel:'#2b180a', panelAlt:'#3d2510', border:'#6d3f17', text:'#fff1dc', textDim:'#e7a15d', accent:'#ff9d3d', accentText:'#2d1305', accent2:'#e7fa32'},
    {id:'sunset', name:'Sunset', bg:'#180a08', panel:'#29130e', panelAlt:'#3a1b12', border:'#623622', text:'#fff3e8', textDim:'#d3aa8d', accent:'#fb923c', accentText:'#3a1605', accent2:'#effa2e'},
    {id:'peach', name:'Peach', bg:'#190e0a', panel:'#2a1811', panelAlt:'#3b241a', border:'#68402b', text:'#fff1e7', textDim:'#e7ae8d', accent:'#ffad7a', accentText:'#2d140a', accent2:'#fbf96b'},
    {id:'yellow', name:'Yellow', bg:'#17150a', panel:'#26220f', panelAlt:'#332d14', border:'#544b1f', text:'#fdfaea', textDim:'#c9c08a', accent:'#facc15', accentText:'#332600', accent2:'#99f909'},
    {id:'gold', name:'Gold', bg:'#151006', panel:'#261b09', panelAlt:'#38270f', border:'#60471b', text:'#fff5d8', textDim:'#d2b66b', accent:'#f5c542', accentText:'#2b1c04', accent2:'#b6f92e'},
    {id:'marigold', name:'Marigold', bg:'#171006', panel:'#281c09', panelAlt:'#3a2910', border:'#67491b', text:'#fff4d8', textDim:'#e2bd68', accent:'#f5c84b', accentText:'#281804', accent2:'#b8f937'},
    {id:'honeycomb', name:'Honeycomb', bg:'#171008', panel:'#291c0c', panelAlt:'#3b2911', border:'#654b20', text:'#fff4dc', textDim:'#d8b46b', accent:'#f2c14e', accentText:'#251704', accent2:'#bdf53b'},
    {id:'butter', name:'Butter', bg:'#f0ecd8', panel:'#f7f3e3', panelAlt:'#e8e1c5', border:'#d5c99f', text:'#3b3828', textDim:'#797253', accent:'#b3912f', accentText:'#fffdf3', accent2:'#80ad2a'},
    {id:'emerald', name:'Emerald', bg:'#071410', panel:'#0d2119', panelAlt:'#122c22', border:'#1f4a37', text:'#eafff3', textDim:'#8fc7a8', accent:'#4ade80', accentText:'#052e12', accent2:'#3ae0da'},
    {id:'forest', name:'Forest', bg:'#06120c', panel:'#0c1d14', panelAlt:'#12291c', border:'#1d4630', text:'#e9fff1', textDim:'#87b69a', accent:'#34d399', accentText:'#052416', accent2:'#28aad1'},
    {id:'jade', name:'Jade', bg:'#07130c', panel:'#0e2116', panelAlt:'#173323', border:'#2b543a', text:'#e8fff0', textDim:'#79c69a', accent:'#4de39a', accentText:'#062513', accent2:'#3cd2e5'},
    {id:'mint', name:'Mint', bg:'#071511', panel:'#0d241d', panelAlt:'#143129', border:'#245346', text:'#edfff8', textDim:'#94c9b4', accent:'#6ee7b7', accentText:'#06271d', accent2:'#5ccbe8'},
    {id:'moss', name:'Moss', bg:'#101306', panel:'#1e250c', panelAlt:'#2e3512', border:'#4b5520', text:'#f4f8df', textDim:'#b5bd7e', accent:'#a8b84a', accentText:'#202505', accent2:'#5fb342'},
    {id:'lime', name:'Lime', bg:'#101507', panel:'#1b240b', panelAlt:'#26330f', border:'#43541c', text:'#f5ffe8', textDim:'#b4c58c', accent:'#a3e635', accentText:'#1e2d05', accent2:'#28e924'},
    {id:'cyan', name:'Cyan', bg:'#051519', panel:'#0a2129', panelAlt:'#0f2c35', border:'#1c4a57', text:'#eafcff', textDim:'#8bc2cf', accent:'#22d3ee', accentText:'#032a30', accent2:'#104df2'},
    {id:'teal', name:'Teal', bg:'#071614', panel:'#0d2220', panelAlt:'#122d2a', border:'#1f4a44', text:'#eafffa', textDim:'#8fc7bb', accent:'#5eead4', accentText:'#062521', accent2:'#4ca5ec'},
    {id:'aqua', name:'Aqua', bg:'#041315', panel:'#082127', panelAlt:'#0d3038', border:'#1b5661', text:'#e9feff', textDim:'#8dc8ce', accent:'#2dd4bf', accentText:'#032522', accent2:'#257ecf'},
    {id:'arctic', name:'Arctic', bg:'#081319', panel:'#0e2029', panelAlt:'#15303c', border:'#27505f', text:'#eefcff', textDim:'#91bac5', accent:'#67e8f9', accentText:'#06252e', accent2:'#5483fb'},
    {id:'turquoise', name:'Turquoise', bg:'#061517', panel:'#0c2528', panelAlt:'#12383b', border:'#236067', text:'#e8fffe', textDim:'#79c8c5', accent:'#2dd4bf', accentText:'#032522', accent2:'#257ecf'},
    {id:'deepsea', name:'Deep Sea', bg:'#050f14', panel:'#0a1a22', panelAlt:'#102932', border:'#1d4a59', text:'#e5faff', textDim:'#6fa5b5', accent:'#48c8df', accentText:'#05202a', accent2:'#3761e1'},
    {id:'lagoon', name:'Lagoon', bg:'#061416', panel:'#0c2428', panelAlt:'#12353a', border:'#245861', text:'#e7ffff', textDim:'#83c5cb', accent:'#2dd4bf', accentText:'#042522', accent2:'#257ecf'},
    {id:'sky', name:'Sky Blue', bg:'#071426', panel:'#0d2038', panelAlt:'#142b47', border:'#2b4c70', text:'#eef6ff', textDim:'#9db4cc', accent:'#60a5fa', accentText:'#0b1a33', accent2:'#684efa'},
    {id:'azure', name:'Azure', bg:'#07111a', panel:'#0e2130', panelAlt:'#163448', border:'#285d7b', text:'#eaf8ff', textDim:'#73bfe8', accent:'#55b9ff', accentText:'#08202d', accent2:'#4b49fa'},
    {id:'cobalt', name:'Cobalt', bg:'#080e1b', panel:'#101a2e', panelAlt:'#172843', border:'#274c7d', text:'#e9f1ff', textDim:'#7096d4', accent:'#5b8dff', accentText:'#0a1830', accent2:'#814efa'},
    {id:'navy', name:'Navy', bg:'#060d19', panel:'#0c1727', panelAlt:'#132237', border:'#243c5e', text:'#edf5ff', textDim:'#8fa7c5', accent:'#38bdf8', accentText:'#062039', accent2:'#273bf9'},
    {id:'ocean', name:'Ocean', bg:'#061118', panel:'#0b202c', panelAlt:'#123342', border:'#205b70', text:'#e6faff', textDim:'#67bfd5', accent:'#45c6e8', accentText:'#05232f', accent2:'#3356eb'},
    {id:'sapphire', name:'Sapphire', bg:'#060c18', panel:'#0d1830', panelAlt:'#142548', border:'#254777', text:'#eaf1ff', textDim:'#7e9bd0', accent:'#3b82f6', accentText:'#07152d', accent2:'#5628f9'},
    {id:'steelblue', name:'Steel Blue', bg:'#0a1118', panel:'#141e29', panelAlt:'#1e2c3b', border:'#34495f', text:'#edf5ff', textDim:'#91a7bc', accent:'#7aa7c7', accentText:'#0b1c29', accent2:'#6e6dc4'},
    {id:'dusk', name:'Dusk', bg:'#0d0d18', panel:'#17172a', panelAlt:'#23233d', border:'#3a3a61', text:'#f0efff', textDim:'#a5a2c4', accent:'#a78bfa', accentText:'#17102c', accent2:'#e774fb'},
    {id:'midnight', name:'Midnight', bg:'#050713', panel:'#0b1021', panelAlt:'#131a32', border:'#263454', text:'#eaf0ff', textDim:'#7f8baa', accent:'#818cf8', accentText:'#0b1028', accent2:'#b46cfa'},
    {id:'violet', name:'Violet', bg:'#171224', panel:'#241b38', panelAlt:'#302448', border:'#51406f', text:'#f7f2ff', textDim:'#b9aecf', accent:'#a78bfa', accentText:'#1e1033', accent2:'#e774fb'},
    {id:'lavender', name:'Lavender', bg:'#110f1c', panel:'#1d1930', panelAlt:'#292342', border:'#453b67', text:'#f6f1ff', textDim:'#b9add3', accent:'#c4b5fd', accentText:'#21153d', accent2:'#e174fb'},
    {id:'amethyst', name:'Amethyst', bg:'#110a18', panel:'#1c1028', panelAlt:'#2b1940', border:'#4c2d6b', text:'#f5edff', textDim:'#b59bd8', accent:'#b27aff', accentText:'#190d2b', accent2:'#fb6bf8'},
    {id:'indigo', name:'Indigo', bg:'#0e0f1f', panel:'#171a30', panelAlt:'#1f2340', border:'#38406a', text:'#eef0ff', textDim:'#a3a8cf', accent:'#818cf8', accentText:'#141033', accent2:'#b46cfa'},
    {id:'grape', name:'Grape', bg:'#120817', panel:'#21102a', panelAlt:'#31183e', border:'#542866', text:'#f9edff', textDim:'#bd9bc9', accent:'#a855f7', accentText:'#210b32', accent2:'#fa41e5'},
    {id:'nebula', name:'Nebula', bg:'#0b0816', panel:'#151026', panelAlt:'#21183a', border:'#3a2d5d', text:'#f1edff', textDim:'#a79bc7', accent:'#8b5cf6', accentText:'#160c2c', accent2:'#e948f9'},
    {id:'rosepaper', name:'Rose Paper', bg:'#eee5e8', panel:'#f7eef1', panelAlt:'#e7d9df', border:'#d5c0c9', text:'#3d3036', textDim:'#7d6973', accent:'#b86b87', accentText:'#fff7fa', accent2:'#b5735f'},
    {id:'magenta', name:'Magenta', bg:'#170712', panel:'#280b20', panelAlt:'#38102c', border:'#5c1e4a', text:'#fff0fa', textDim:'#d39abb', accent:'#f0a', accentText:'#3d062c'},
    {id:'fuchsia', name:'Fuchsia', bg:'#170815', panel:'#280d23', panelAlt:'#3b1432', border:'#66205a', text:'#ffeafd', textDim:'#e18bcf', accent:'#ef5fd0', accentText:'#28091e', accent2:'#f14c6a'},
    {id:'blush', name:'Blush', bg:'#170b10', panel:'#27121b', panelAlt:'#3a1c28', border:'#653246', text:'#ffedf4', textDim:'#e8a2b8', accent:'#f58bb0', accentText:'#2a0c15', accent2:'#f79676'},
    {id:'pikachu', name:'Pikachu', group:'Pokemon', bg:'#171405', panel:'#29200a', panelAlt:'#3c2d0c', border:'#70551a', text:'#fff9d6', textDim:'#d8c36b', accent:'#facc15', accentText:'#221800', accent2:'#09f9c4'},
    {id:'charizard', name:'Charizard', group:'Pokemon', bg:'#1b0705', panel:'#321008', panelAlt:'#49150b', border:'#7d2a16', text:'#fff2e8', textDim:'#e3a17c', accent:'#f97316', accentText:'#2c0903', accent2:'#09f966'},
    {id:'blastoise', name:'Blastoise', group:'Pokemon', bg:'#06121a', panel:'#0b2730', panelAlt:'#12404b', border:'#256776', text:'#e8fbff', textDim:'#83c0ca', accent:'#38bdf8', accentText:'#05212d', accent2:'#f927bd'},
    {id:'venusaur', name:'Venusaur', group:'Pokemon', bg:'#071208', panel:'#112b18', panelAlt:'#1d3d23', border:'#3c6941', text:'#efffe9', textDim:'#9bc58e', accent:'#4ade80', accentText:'#07200d', accent2:'#733ae0'},
    {id:'gengar', name:'Gengar', group:'Pokemon', bg:'#100719', panel:'#21102f', panelAlt:'#321647', border:'#5a3475', text:'#faefff', textDim:'#c1a0d5', accent:'#a855f7', accentText:'#1b092b', accent2:'#fa9c41'},
    {id:'umbreon', name:'Umbreon', group:'Pokemon', bg:'#07080c', panel:'#14151b', panelAlt:'#222329', border:'#4b4c4f', text:'#fff6d5', textDim:'#b9ae82', accent:'#facc15', accentText:'#191603', accent2:'#09f9c4'},
    {id:'espeon', name:'Espeon', group:'Pokemon', bg:'#16091a', panel:'#2b1530', panelAlt:'#402044', border:'#70406d', text:'#fff0ff', textDim:'#dda7cf', accent:'#e879f9', accentText:'#33102f', accent2:'#fbe464'},
    {id:'lucario', name:'Lucario', group:'Pokemon', bg:'#07121a', panel:'#0d2834', panelAlt:'#154253', border:'#2b6877', text:'#eafcff', textDim:'#8bbdc9', accent:'#38bdf8', accentText:'#06202d', accent2:'#f927bd'},
    {id:'greninja', name:'Greninja', group:'Pokemon', bg:'#050c18', panel:'#0a2035', panelAlt:'#103c54', border:'#235f79', text:'#e8faff', textDim:'#79b7c9', accent:'#ef4444', accentText:'#30070b', accent2:'#35f231'},
    {id:'rayquaza', name:'Rayquaza', group:'Pokemon', bg:'#07150b', panel:'#12301a', panelAlt:'#1d4221', border:'#6a5d18', text:'#fff9cf', textDim:'#c4bd75', accent:'#e11d48', accentText:'#fff5e8', accent2:'#46da17'},
    {id:'mewtwo', name:'Mewtwo', group:'Pokemon', bg:'#100a18', panel:'#21152b', panelAlt:'#352040', border:'#65447a', text:'#f8f0ff', textDim:'#c1a5d0', accent:'#c084fc', accentText:'#251038', accent2:'#fbb471'},
    {id:'eevee', name:'Eevee', group:'Pokemon', bg:'#171009', panel:'#2b1a0d', panelAlt:'#3f2814', border:'#714827', text:'#fff3dd', textDim:'#d5ae7b', accent:'#c08457', accentText:'#2b170a', accent2:'#4abf7a'},
    {id:'sylveon', name:'Sylveon', group:'Pokemon', bg:'#170912', panel:'#2a1020', panelAlt:'#40182f', border:'#71385a', text:'#fff0f8', textDim:'#e6a7c2', accent:'#67e8f9', accentText:'#17202a', accent2:'#fb54eb'},
    {id:'scizor', name:'Scizor', group:'Pokemon', bg:'#160507', panel:'#2d0c10', panelAlt:'#43151b', border:'#7b2932', text:'#fff0f1', textDim:'#dc8e95', accent:'#ef4444', accentText:'#2d080d', accent2:'#35f231'},
    {id:'metagross', name:'Metagross', group:'Pokemon', bg:'#091015', panel:'#14232d', panelAlt:'#1d3946', border:'#416b78', text:'#effcff', textDim:'#99b8c2', accent:'#60a5fa', accentText:'#091a28', accent2:'#fa4e9f'},
    {id:'dragapult', name:'Dragapult', group:'Pokemon', bg:'#071015', panel:'#10232b', panelAlt:'#193944', border:'#2e6570', text:'#eaffff', textDim:'#8ac5c8', accent:'#2dd4bf', accentText:'#062522', accent2:'#b625cf'},
    {id:'mimikyu', name:'Mimikyu', group:'Pokemon', bg:'#121007', panel:'#28210f', panelAlt:'#3d3218', border:'#6f5b25', text:'#fffbe5', textDim:'#cdbb78', accent:'#eab308', accentText:'#221a03', accent2:'#06e0a7'},
    {id:'dialga', name:'Dialga', group:'Pokemon', bg:'#07121b', panel:'#102a3b', panelAlt:'#18445a', border:'#3b7086', text:'#eafaff', textDim:'#8fb9c8', accent:'#facc15', accentText:'#1f1700', accent2:'#09f9c4'},
    {id:'palkia', name:'Palkia', group:'Pokemon', bg:'#120711', panel:'#25112a', panelAlt:'#3b1942', border:'#71345f', text:'#fff0ff', textDim:'#d09acb', accent:'#22d3ee', accentText:'#06262a', accent2:'#f210d9'},
    {id:'giratina', name:'Giratina', group:'Pokemon', bg:'#0b080f', panel:'#1b1220', panelAlt:'#2a1b2f', border:'#523c52', text:'#fff4cf', textDim:'#c9ac68', accent:'#f59e0b', accentText:'#271703', accent2:'#06ed93'},
    {id:'zacian', name:'Ho-Oh', group:'Pokemon', bg:'#140805', panel:'#2a1208', panelAlt:'#43200d', border:'#7d4a19', text:'#fff3d5', textDim:'#dcae68', accent:'#ef4444', accentText:'#fff3d5', accent2:'#35f231'},
    {id:'zamazenta', name:'Lugia', group:'Pokemon', bg:'#07111a', panel:'#10273a', panelAlt:'#183f56', border:'#3c7188', text:'#eefcff', textDim:'#9abecb', accent:'#e2e8f0', accentText:'#15212b', accent2:'#d19fb5'},
    {id:'kyogre', name:'Gardevoir', group:'Pokemon', bg:'#140a16', panel:'#271329', panelAlt:'#3d1c40', border:'#6e3c72', text:'#fff0ff', textDim:'#d4a7d0', accent:'#34d399', accentText:'#05271d', accent2:'#9028d1'},
    {id:'groudon', name:'Zoroark', group:'Pokemon', bg:'#0c0b0f', panel:'#1c151c', panelAlt:'#32212c', border:'#66354b', text:'#fff0f3', textDim:'#c8a0ad', accent:'#ef4444', accentText:'#2b070d', accent2:'#35f231'},

    // =========================
    // PREMIUM / CLEAN
    // =========================
    {id:'obsidian', name:'Obsidian', group:'Premium', bg:'#050506', panel:'#101012', panelAlt:'#1a1a1d', border:'#303035', text:'#f5f5f7', textDim:'#9c9ca5', accent:'#e5e7eb', accentText:'#151517', accent2:'#ac9fd1'},
    {id:'platinum', name:'Platinum', group:'Premium', bg:'#dfe3e8', panel:'#f1f3f5', panelAlt:'#d4d9df', border:'#bcc3cc', text:'#252a31', textDim:'#68717d', accent:'#64748b', accentText:'#f8fafc', accent2:'#594a99'},
    {id:'paper', name:'Paper', group:'Premium', bg:'#f5f1e8', panel:'#fffdf8', panelAlt:'#ebe5d8', border:'#d6ccba', text:'#292722', textDim:'#716b60', accent:'#806b4a', accentText:'#fffdf8', accent2:'#73823e'},
    {id:'porcelain', name:'Porcelain', group:'Premium', bg:'#e9eef2', panel:'#f8fafb', panelAlt:'#dfe6eb', border:'#c4d0d8', text:'#27313a', textDim:'#687783', accent:'#52758a', accentText:'#f7fbfd', accent2:'#44468d'},
    {id:'charcoal', name:'Charcoal', group:'Premium', bg:'#101113', panel:'#1a1c20', panelAlt:'#25282d', border:'#3b3f46', text:'#f1f3f5', textDim:'#a2a8b1', accent:'#c0c7d1', accentText:'#17191c', accent2:'#a89fd1'},

    // =========================
    // SYNTHWAVE / CYBER
    // =========================
    {id:'cyberpunk', name:'Cyberpunk', group:'Crazy', bg:'#090514', panel:'#160a25', panelAlt:'#24103b', border:'#51206d', text:'#f8f0ff', textDim:'#c08bd8', accent:'#ff2bd6', accentText:'#24001e', accent2:'#f9224e'},
    {id:'synthwave', name:'Synthwave', group:'Crazy', bg:'#10051b', panel:'#1d0a2d', panelAlt:'#301044', border:'#5d286e', text:'#fff0ff', textDim:'#c993d0', accent:'#ff4fd8', accentText:'#280020', accent2:'#fa4364'},
    {id:'vaporwave', name:'Vaporwave', group:'Crazy', bg:'#100c22', panel:'#1b1540', panelAlt:'#29205a', border:'#51458a', text:'#f7f3ff', textDim:'#bdb4df', accent:'#7df9ff', accentText:'#071f2a', accent2:'#6ea0fb'},
    {id:'holographic', name:'Holographic', group:'Crazy', bg:'#07131a', panel:'#10232c', panelAlt:'#17363e', border:'#35606a', text:'#f0ffff', textDim:'#91c6cc', accent:'#c084fc', accentText:'#1b0d2d', accent2:'#fb71ee'},
    {id:'plasma', name:'Plasma', group:'Crazy', bg:'#12050c', panel:'#23091a', panelAlt:'#38102a', border:'#64224f', text:'#fff0fa', textDim:'#d99bc4', accent:'#ff3b81', accentText:'#30000f', accent2:'#fa6131'},
    {id:'glitch', name:'Glitch', group:'Crazy', bg:'#080b0d', panel:'#11161a', panelAlt:'#1a2025', border:'#35434b', text:'#f3ffff', textDim:'#8db3bc', accent:'#00f5d4', accentText:'#001c18', accent2:'#067ce3'},
    {id:'terminal', name:'Terminal', group:'Crazy', bg:'#030805', panel:'#07140b', panelAlt:'#0d2012', border:'#1d4b29', text:'#d9ffe4', textDim:'#70b982', accent:'#39ff88', accentText:'#03130a', accent2:'#2ffaf9'},
    {id:'crt', name:'CRT', group:'Crazy', bg:'#07100a', panel:'#0d1b10', panelAlt:'#142718', border:'#274c2e', text:'#d9ffe0', textDim:'#7caf84', accent:'#8cff98', accentText:'#06100a', accent2:'#74fbd3'},
    {id:'matrix', name:'Matrix', group:'Crazy', bg:'#020703', panel:'#061006', panelAlt:'#0b1a0b', border:'#174217', text:'#d9ffdb', textDim:'#62a966', accent:'#00ff41', accentText:'#001a05', accent2:'#06eccb'},
    {id:'rgb', name:'RGB Gamer', group:'Crazy', bg:'#08080c', panel:'#111119', panelAlt:'#1b1b27', border:'#393947', text:'#f8f8ff', textDim:'#a9a9c0', accent:'#00e5ff', accentText:'#001a20', accent2:'#064bec'},

    // =========================
    // COSMIC
    // =========================
    {id:'galaxy', name:'Galaxy', group:'Cosmic', bg:'#060713', panel:'#0e1024', panelAlt:'#171a35', border:'#2d3560', text:'#f0f1ff', textDim:'#9ca5d2', accent:'#c084fc', accentText:'#1d0c2f', accent2:'#fb71ee'},
    {id:'deep-space', name:'Deep Space', group:'Cosmic', bg:'#02040b', panel:'#080d18', panelAlt:'#10182a', border:'#1e3150', text:'#eaf3ff', textDim:'#738ca8', accent:'#38bdf8', accentText:'#031722', accent2:'#273bf9'},
    {id:'starlight', name:'Starlight', group:'Cosmic', bg:'#080912', panel:'#121529', panelAlt:'#1c2040', border:'#343b67', text:'#f4f5ff', textDim:'#a5abd0', accent:'#f8fafc', accentText:'#141724', accent2:'#a09ad6'},
    {id:'supernova', name:'Supernova', group:'Cosmic', bg:'#130706', panel:'#25100a', panelAlt:'#3a180c', border:'#67311a', text:'#fff5e8', textDim:'#dda777', accent:'#ffd166', accentText:'#2a1500', accent2:'#cafb58'},
    {id:'aurora', name:'Aurora', group:'Cosmic', bg:'#051216', panel:'#0b2226', panelAlt:'#12383a', border:'#245d5a', text:'#eaffff', textDim:'#82c1c0', accent:'#67e8f9', accentText:'#052229', accent2:'#5483fb'},
    {id:'eclipse', name:'Eclipse', group:'Cosmic', bg:'#09070d', panel:'#15101c', panelAlt:'#221827', border:'#3e2b48', text:'#f6efff', textDim:'#a996b0', accent:'#f59e0b', accentText:'#261500', accent2:'#b8ed06'},

    // =========================
    // NATURE / PRETTY
    // =========================
    {id:'sakura', name:'Sakura', group:'Pretty', bg:'#160a10', panel:'#28121b', panelAlt:'#3a1b27', border:'#653342', text:'#fff1f6', textDim:'#d8a3b3', accent:'#f9a8d4', accentText:'#341025', accent2:'#f97e76'},
    {id:'matcha', name:'Matcha', group:'Pretty', bg:'#0d1209', panel:'#17200f', panelAlt:'#253018', border:'#425331', text:'#f1f8e8', textDim:'#a5b88f', accent:'#a3c95c', accentText:'#162006', accent2:'#54c84e'},
    {id:'ocean-breeze', name:'Ocean Breeze', group:'Pretty', bg:'#06151a', panel:'#0c242c', panelAlt:'#123841', border:'#285e68', text:'#eaffff', textDim:'#8ec4ca', accent:'#5eead4', accentText:'#062522', accent2:'#4ca5ec'},
    {id:'lavender-mist', name:'Lavender Mist', group:'Pretty', bg:'#15111d', panel:'#211a2e', panelAlt:'#302640', border:'#514367', text:'#f8f2ff', textDim:'#b7a8c9', accent:'#d8b4fe', accentText:'#251536', accent2:'#fb74f0'},
    {id:'rose-gold', name:'Rose Gold', group:'Pretty', bg:'#170f12', panel:'#281b20', panelAlt:'#3b282f', border:'#62454f', text:'#fff5f7', textDim:'#cdb0b8', accent:'#e7a6b1', accentText:'#35151c', accent2:'#e3b28c'},
    {id:'cotton-candy', name:'Cotton Candy', group:'Pretty', bg:'#0f101b', panel:'#191a2b', panelAlt:'#272943', border:'#46496b', text:'#f8f6ff', textDim:'#b0b1d1', accent:'#f9a8d4', accentText:'#3a1028', accent2:'#f97e76'},
    {id:'moonlight', name:'Moonlight', group:'Pretty', bg:'#0a0d16', panel:'#121827', panelAlt:'#1d2638', border:'#33415b', text:'#f1f5ff', textDim:'#9eabc0', accent:'#dbeafe', accentText:'#172033', accent2:'#8b74fb'},
    {id:'meadow', name:'Meadow', group:'Pretty', bg:'#08120b', panel:'#102016', panelAlt:'#18301f', border:'#2f5337', text:'#effff2', textDim:'#91b99b', accent:'#86efac', accentText:'#06220e', accent2:'#73f0eb'},

    // =========================
    // ELEMENTAL
    // =========================
    {id:'inferno', name:'Inferno', group:'Elemental', bg:'#140504', panel:'#260b07', panelAlt:'#3b1109', border:'#682116', text:'#fff0e8', textDim:'#d99075', accent:'#ff5a36', accentText:'#330700', accent2:'#2cfa4d'},
    {id:'blood-moon', name:'Blood Moon', group:'Elemental', bg:'#100306', panel:'#21070d', panelAlt:'#350b15', border:'#5e1725', text:'#ffeef1', textDim:'#ce7f8d', accent:'#ff334f', accentText:'#310006', accent2:'#4afa29'},
    {id:'toxic', name:'Toxic', group:'Elemental', bg:'#0a1004', panel:'#141f08', panelAlt:'#20310c', border:'#3e5b17', text:'#f2ffe5', textDim:'#a4c47b', accent:'#c6ff00', accentText:'#172400', accent2:'#06bdec'},
    {id:'electric', name:'Electric', group:'Elemental', bg:'#0d0c03', panel:'#1c1906', panelAlt:'#2b2609', border:'#514a14', text:'#fffde4', textDim:'#c9bd65', accent:'#ffe600', accentText:'#2b2400', accent2:'#06ecd1'},
    {id:'frostbite', name:'Frostbite', group:'Elemental', bg:'#061219', panel:'#0b202c', panelAlt:'#123447', border:'#2b5e75', text:'#ecfbff', textDim:'#8bbdcc', accent:'#93e9ff', accentText:'#06212b', accent2:'#fb74e3'},
    {id:'volcanic', name:'Volcanic', group:'Elemental', bg:'#160703', panel:'#2b0d06', panelAlt:'#421309', border:'#752518', text:'#fff0e4', textDim:'#d98b69', accent:'#ff7a18', accentText:'#2d0900', accent2:'#10f96e'},
    {id:'storm', name:'Storm', group:'Elemental', bg:'#080c13', panel:'#111827', panelAlt:'#1b2537', border:'#35445d', text:'#edf4ff', textDim:'#98a9c1', accent:'#93c5fd', accentText:'#0b1b32', accent2:'#fb74b6'},

    // =========================
    // POKEMON-INSPIRED
    // =========================
    {id:'master-ball', name:'Master Ball', group:'Pokemon', bg:'#100719', panel:'#21102e', panelAlt:'#321643', border:'#613071', text:'#fff0ff', textDim:'#c69ad2', accent:'#c084fc', accentText:'#1c092a', accent2:'#fbb471'},
    {id:'ultra-ball', name:'Ultra Ball', group:'Pokemon', bg:'#080a0e', panel:'#13171d', panelAlt:'#20262e', border:'#3c4652', text:'#f3f6fa', textDim:'#a4afb9', accent:'#facc15', accentText:'#211900', accent2:'#09f9c4'},
    {id:'great-ball', name:'Great Ball', group:'Pokemon', bg:'#06101a', panel:'#0c1f31', panelAlt:'#123653', border:'#285b82', text:'#edf8ff', textDim:'#8bb2cc', accent:'#3b82f6', accentText:'#06152b', accent2:'#f9287c'},
    {id:'pokeball', name:'Pokéball', group:'Pokemon', bg:'#120607', panel:'#260d10', panelAlt:'#3b1519', border:'#6c242c', text:'#fff1f2', textDim:'#d99a9e', accent:'#ef4444', accentText:'#300305', accent2:'#35f231'},
    {id:'mew', name:'Mew', group:'Pokemon', bg:'#160b15', panel:'#281525', panelAlt:'#3b2038', border:'#69445f', text:'#fff0fb', textDim:'#d3a9c5', accent:'#f0a5d8', accentText:'#35102c', accent2:'#cded82'},
    {id:'darkrai', name:'Darkrai', group:'Pokemon', bg:'#06050b', panel:'#100d18', panelAlt:'#1b1627', border:'#372c4a', text:'#eeeaff', textDim:'#9f94b5', accent:'#a78bfa', accentText:'#180d2c', accent2:'#fb9374'},
    {id:'volcarona', name:'Volcarona', group:'Pokemon', bg:'#170a04', panel:'#2b1608', panelAlt:'#40200b', border:'#6f3614', text:'#fff4e4', textDim:'#dda66e', accent:'#fb923c', accentText:'#2b0e03', accent2:'#2efa86'},
    {id:'garchomp', name:'Garchomp', group:'Pokemon', bg:'#081019', panel:'#102334', panelAlt:'#183b54', border:'#2d607e', text:'#edf9ff', textDim:'#8cb5c8', accent:'#60a5fa', accentText:'#071a2d', accent2:'#fa4e9f'},
    {id:'zeraora', name:'Zeraora', group:'Pokemon', bg:'#111005', panel:'#211e08', panelAlt:'#332f0d', border:'#5a531a', text:'#fffce6', textDim:'#c7bc68', accent:'#fde047', accentText:'#272000', accent2:'#3afad7'},
    {id:'lugia', name:'Lugia', group:'Pokemon', bg:'#081117', panel:'#12232d', panelAlt:'#1d3542', border:'#3a5c6a', text:'#eefcff', textDim:'#9ab7c1', accent:'#e2e8f0', accentText:'#17212a', accent2:'#d19fb5'},

    // =========================
    // ABSOLUTELY UNHINGED
    // =========================
    {id:'void', name:'Void', group:'Unhinged', bg:'#000000', panel:'#070707', panelAlt:'#101010', border:'#242424', text:'#f5f5f5', textDim:'#777777', accent:'#ffffff', accentText:'#000000', accent2:'#9fd1d1'},
    {id:'nuclear', name:'Nuclear', group:'Unhinged', bg:'#090c03', panel:'#141a05', panelAlt:'#202a08', border:'#40530d', text:'#f4ffd8', textDim:'#a9bf63', accent:'#b6ff00', accentText:'#162200', accent2:'#4806ec'},
    {id:'hellfire', name:'Hellfire', group:'Unhinged', bg:'#120000', panel:'#250505', panelAlt:'#3c0808', border:'#681313', text:'#fff0ed', textDim:'#d88479', accent:'#ff1f1f', accentText:'#300000', accent2:'#17f9f9'},
    {id:'black-gold', name:'Black & Gold', group:'Unhinged', bg:'#070707', panel:'#11100c', panelAlt:'#1c1910', border:'#40371d', text:'#fff8df', textDim:'#bbaa72', accent:'#f5c542', accentText:'#241800', accent2:'#2e65f9'},
    {id:'whiteout', name:'Whiteout', group:'Unhinged', bg:'#f4f5f7', panel:'#ffffff', panelAlt:'#e7e9ed', border:'#cdd1d8', text:'#17191d', textDim:'#69717d', accent:'#111827', accentText:'#ffffff', accent2:'#735e30'},
    {id:'chaos', name:'Chaos', group:'Unhinged', bg:'#0a0710', panel:'#17101e', panelAlt:'#24172d', border:'#493354', text:'#fff5ff', textDim:'#c1a6c6', accent:'#ff3cac', accentText:'#23001a', accent2:'#32fa87'},
    {id:'neon-city', name:'Neon City', group:'Unhinged', bg:'#05070d', panel:'#0b101b', panelAlt:'#131c2c', border:'#263c5a', text:'#edfaff', textDim:'#83a9bc', accent:'#00f0ff', accentText:'#001b20', accent2:'#ec1406'},
    {id:'radioactive', name:'Radioactive', group:'Unhinged', bg:'#070b03', panel:'#101805', panelAlt:'#192408', border:'#334b0c', text:'#efffd8', textDim:'#91ae58', accent:'#7fff00', accentText:'#0d1b00', accent2:'#7a06ec'},
    {id:'amber', name:'Amber', bg:'#0e1218', panel:'#161c26', panelAlt:'#1c2432', border:'#2a3444', text:'#e8edf5', textDim:'#8996a8', accent:'#ffb454', accentText:'#1a1206', accent2:'#ddfa48'}
  ];
  // Single shared source of truth for every theme preset on the site.
  // Other scripts on this page (and the loader on other pages) read from
  // window.SBL_THEMES instead of keeping their own copy, so a theme only
  // ever needs to be added in one place.
  window.SBL_THEMES = THEMES;
  window.SBL_THEMES_VERSION = '2026-08-24-pokemon-contrast';
  const THEME_KEY='sbl_dashboard_theme';
  const CUSTOM_KEY='sbl_dashboard_custom_theme';
  const FAVORITES_KEY='sbl_dashboard_theme_favorites';
  const RECENT_KEY='sbl_dashboard_theme_recent';
  const TEAL='#5eead4', RED='#ff7a7a';
  // Older theme IDs remain resolvable so saved user preferences do not break when the theme catalog is curated.
  const LEGACY_THEME_ALIASES={"midnight2":"cobalt","charcoal":"slate","graphite2":"slate","smoke":"slate","silver":"slate","steel2":"cobalt","coffee":"orange","espresso":"orange","mahogany":"crimson","taupe":"orange","copper":"orange","terracotta":"crimson","scarlet":"crimson","berry":"rose","mustard":"yellow","citrus":"yellow","olive":"emerald","seafoam":"emerald","neon":"emerald","cyan2":"cyan","aqua2":"cyan","tropical":"emerald","frost":"cyan","frost2":"cyan","aurora":"emerald","denim":"cobalt","royal":"cobalt","plum":"violet","plum2":"violet","heather":"violet","orchid":"violet","iris":"cobalt","periwinkle":"cobalt","cyberpunk":"rose","twilight":"cobalt","obsidian":"cobalt","carbon":"cobalt","cocoa":"orange","sand":"orange","bronze":"orange","rust":"crimson","wine":"crimson","mauve":"rose","raspberry":"rose","apricot":"orange","cantaloupe":"orange","honey":"yellow","canary":"yellow","green":"emerald","pine":"emerald","chartreuse":"emerald","spring":"emerald","ice":"cyan","glacier":"cobalt","steel":"cobalt","denim2":"cobalt","marine":"cobalt","violet2":"violet","electric":"rose","northern":"cyan","mocha":"orange","ink":"slate","platinum":"slate","coolgray":"cobalt","warmgray":"orange","parchment":"orange","smokyblue":"cobalt","deepteal":"cyan","firefly":"emerald","copperblue":"orange","paper":"peach","cloud":"sky","snow":"sky","linen":"peach","cream":"peach","porcelain":"sky","mist":"sky","dove":"lavender","canvas":"peach","frostwhite":"arctic","cotton":"sky","almond":"peach","marble":"ivory","pearlblue":"sky","sage":"moss","pistachio":"moss","lemonade":"butter","peachcream":"peach","apricotlight":"peach","lilac":"lavender","periwinklelight":"sky","skywash":"sky","mintcream":"moss","tealwash":"arctic","lavenderrose":"rosepaper","bluegraylight":"sky","khaki":"yellow"};
  function read(key, fallback){try{const v=localStorage.getItem(key);return v||fallback}catch(e){return fallback}}
  function readJSON(key, fallback){try{const v=JSON.parse(localStorage.getItem(key)||'null');return v==null?fallback:v}catch(e){return fallback}}
  function writeJSON(key, value){try{localStorage.setItem(key, JSON.stringify(value))}catch(e){}}
  function contrast(hex){
    const h=String(hex||'').replace('#',''); if(h.length!==6) return 4.5;
    const rgb=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4));
    const l=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]; return (1.05)/(l+.05);
  }
  function favoriteIds(){return readJSON(FAVORITES_KEY,[]).filter(id=>typeof id==='string')}
  function recentIds(){return readJSON(RECENT_KEY,[]).filter(id=>typeof id==='string')}
  function setFavorites(ids){writeJSON(FAVORITES_KEY,[...new Set(ids)])}
  function setRecent(id){if(!id||id==='custom') return; writeJSON(RECENT_KEY,[id,...recentIds().filter(x=>x!==id)].slice(0,12))}
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
  }

  function applyTheme(id, persist){
    if(persist !== false){ try{ localStorage.setItem(THEME_KEY,id); }catch(e){} }
    const root=document.documentElement;
    const previous=root.dataset.sblTheme;
    if(previous && previous!==id){ root.classList.add('sbl-theme-transition'); window.clearTimeout(window.__sblThemeTransitionTimer); window.__sblThemeTransitionTimer=window.setTimeout(()=>root.classList.remove('sbl-theme-transition'),280); }
    apply();
    const t=themeFor(id);
    setRecent(t.id);
    const bgContrast=contrast(t.text);
    root.dataset.sblThemeTone = bgContrast>7 ? 'light-text' : 'dark-text';
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
        opacity:.16;
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
        opacity:.10;
      }

      /* Ambient glow follows major interactive surfaces. */
      .panel,.card,.set-card,.statbox,.notice,
      .roster-toolbar,.ticker,.speed-matrix-wrap,
      .team-card,.overview-card,.franchise-card,
      .modal-card,.profile-modal,.summary-modal,
      .theme-card,.theme-preview,.popout,.dropdown-menu{
        box-shadow:
          0 10px 30px color-mix(in srgb,var(--sbl-theme-accent) 5%,transparent),
          var(--sbl-shadow,0 12px 34px rgba(0,0,0,.08));
      }

      .panel:hover,.card:hover,.set-card:hover,.statbox:hover,
      .team-card:hover,.overview-card:hover,.franchise-card:hover,
      .theme-card:hover,.popout:hover{
        box-shadow:
          0 0 0 1px color-mix(in srgb,var(--sbl-theme-accent) 12%,transparent),
          0 10px 34px color-mix(in srgb,var(--sbl-theme-accent) 10%,transparent),
          var(--sbl-shadow,0 12px 34px rgba(0,0,0,.08));
      }

      /* Small accent glow on controls, without making every element neon. */
      button,.btn,.primary,.btn-primary,.accent-btn,
      input,select,textarea,.search-input,.filter-input{
        transition:box-shadow .18s ease,filter .18s ease,border-color .18s ease,background-color .18s ease;
      }
      button:hover,.btn:hover,.primary:hover,.btn-primary:hover,.accent-btn:hover{
        box-shadow:0 0 18px color-mix(in srgb,var(--sbl-theme-accent) 18%,transparent);
      }
      input:focus,select:focus,textarea:focus,.search-input:focus,.filter-input:focus{
        box-shadow:0 0 0 3px color-mix(in srgb,var(--sbl-theme-accent) 12%,transparent),
                   0 0 18px color-mix(in srgb,var(--sbl-theme-accent) 12%,transparent) !important;
      }

      /* Accent line/highlight on navigation and section headings. */
      .page-nav,.top-nav,.site-nav{
        box-shadow:
          0 1px 0 color-mix(in srgb,var(--sbl-theme-accent) 14%,transparent),
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
          radial-gradient(900px 520px at 8% 0%, color-mix(in srgb,var(--sbl-theme-accent) 11%,transparent), transparent 68%),
          radial-gradient(760px 480px at 94% 18%, color-mix(in srgb,var(--sbl-theme-accent2) 9%,transparent), transparent 70%),
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
          0 0 0 1px color-mix(in srgb,var(--sbl-theme-accent2) 12%,transparent) !important;
      }

      .page-nav{
        background-image:
          linear-gradient(90deg,
            color-mix(in srgb,var(--sbl-theme-accent) 9%,transparent),
            transparent 48%,
            color-mix(in srgb,var(--sbl-theme-accent2) 8%,transparent)) !important;
      }

      .primary,.btn-primary,.accent-btn{
        box-shadow:0 6px 20px color-mix(in srgb,var(--sbl-theme-accent) 18%,transparent);
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
      @media(prefers-reduced-motion:reduce){html.sbl-theme-transition *,[data-sbl-theme=rgb-gamer] .page-nav{transition:none!important;animation:none!important}}
    `;
  }

  // Public site-wide theme API. Pages should use this instead of maintaining
  // their own theme state/apply functions.
  window.SBLTheme = {
    list: () => THEMES.slice(),
    getSavedId: () => read(THEME_KEY,'amber'),
    getCustom: () => custom(),
    getFavorites: () => favoriteIds(),
    getRecent: () => recentIds(),
    isFavorite: (id) => favoriteIds().includes(id),
    toggleFavorite: (id) => { const ids=favoriteIds(); const next=ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]; setFavorites(next); return next; },
    saveCustom: (theme) => { const base=themeFor(theme?.base||'amber'); const customTheme=Object.assign({},base,theme||{}, {id:'custom',name:theme?.name||'Custom'}); writeJSON(CUSTOM_KEY,customTheme); applyTheme('custom',true); return customTheme; },
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
