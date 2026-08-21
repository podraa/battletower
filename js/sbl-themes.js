// SBL shared theme engine — single source of truth for every theme preset
// and the logic that applies them. Loaded by every page via <script src>.
// To add or edit a theme, change THEMES here once; every page picks it up
// automatically on next load (no per-page edits needed).
(function(){
  const THEMES=[    // Black / Gray
    {id:'monochrome', name:'Monochrome', bg:'#0b0b0d', panel:'#17171a', panelAlt:'#222226', border:'#38383d', text:'#f1f1f3', textDim:'#a7a7ad', accent:'#d4d4d8', accentText:'#18181b'},
    {id:'slate', name:'Slate', bg:'#0b0f14', panel:'#151b23', panelAlt:'#1e2630', border:'#303b49', text:'#edf2f7', textDim:'#9ba9b8', accent:'#94a3b8', accentText:'#10151d'},
    {id:'midnight2', name:'Midnight II', bg:'#060810', panel:'#0c1220', panelAlt:'#131b2c', border:'#263653', text:'#e9f0ff', textDim:'#8290aa', accent:'#718cff', accentText:'#080f20'},
    {id:'onyx', name:'Onyx', bg:'#08090b', panel:'#111318', panelAlt:'#191c22', border:'#2b3038', text:'#f1f3f6', textDim:'#9ca3af', accent:'#8b949e', accentText:'#0b0d10'},
    {id:'charcoal', name:'Charcoal', bg:'#0c0d10', panel:'#16181d', panelAlt:'#20232a', border:'#343944', text:'#eef0f4', textDim:'#9aa2ad', accent:'#a8b0bc', accentText:'#101217'},
    {id:'graphite', name:'Graphite', bg:'#0c0d0f', panel:'#17181b', panelAlt:'#212327', border:'#35373d', text:'#eef0f2', textDim:'#9ba0a8', accent:'#a3a9b3', accentText:'#131417'},
    {id:'graphite2', name:'Graphite II', bg:'#101114', panel:'#1b1d21', panelAlt:'#272a30', border:'#3b3f48', text:'#f3f4f6', textDim:'#a3a7b0', accent:'#b0b5bf', accentText:'#15171b'},
    {id:'smoke', name:'Smoke', bg:'#121416', panel:'#1c1f22', panelAlt:'#282c30', border:'#3d4248', text:'#f2f4f5', textDim:'#aeb5bb', accent:'#c0c5ca', accentText:'#17191b'},
    {id:'silver', name:'Silver', bg:'#111317', panel:'#1c2026', panelAlt:'#282d35', border:'#414750', text:'#f4f6f8', textDim:'#aeb7c1', accent:'#c5cbd2', accentText:'#15181c'},
    {id:'steel2', name:'Steel II', bg:'#0b1015', panel:'#151d25', panelAlt:'#202b35', border:'#364957', text:'#edf5fb', textDim:'#91a8b8', accent:'#82a9c1', accentText:'#0d1b24'},
    {id:'pearl', name:'Pearl', bg:'#151517', panel:'#222225', panelAlt:'#303034', border:'#47474d', text:'#f7f7f8', textDim:'#b4b4bc', accent:'#d2d2d8', accentText:'#17171a'},
    // Brown / Bronze
    {id:'coffee', name:'Coffee', bg:'#110c09', panel:'#211610', panelAlt:'#2e1e15', border:'#50382a', text:'#f9f1e8', textDim:'#c4a995', accent:'#d6a77a', accentText:'#2e1708'},
    {id:'espresso', name:'Espresso', bg:'#100b08', panel:'#1e1510', panelAlt:'#2a1d16', border:'#493329', text:'#f5eee8', textDim:'#bda18f', accent:'#c58b68', accentText:'#1b0f0a'},
    {id:'mahogany', name:'Mahogany', bg:'#120806', panel:'#21100d', panelAlt:'#321714', border:'#54261e', text:'#ffece7', textDim:'#c38b7b', accent:'#d06e55', accentText:'#250b08'},
    {id:'taupe', name:'Taupe', bg:'#14110f', panel:'#221d19', panelAlt:'#302923', border:'#50463d', text:'#f4eee8', textDim:'#aaa097', accent:'#bca58e', accentText:'#201a16'},
    {id:'copper', name:'Copper', bg:'#140c08', panel:'#24150e', panelAlt:'#382317', border:'#5c3926', text:'#fff0e5', textDim:'#c79572', accent:'#d98854', accentText:'#261108'},
    {id:'terracotta', name:'Terracotta', bg:'#160b08', panel:'#271511', panelAlt:'#3a211a', border:'#663b2c', text:'#fff0e9', textDim:'#cf9a84', accent:'#dc795d', accentText:'#2a1009'},
    // Red
    {id:'ruby', name:'Ruby', bg:'#17070d', panel:'#270d16', panelAlt:'#3a1420', border:'#681f35', text:'#ffeaf1', textDim:'#e889a4', accent:'#ff527d', accentText:'#290710'},
    {id:'crimson', name:'Crimson', bg:'#16070c', panel:'#250b13', panelAlt:'#32101b', border:'#5a1d2b', text:'#fff0f4', textDim:'#d39aaa', accent:'#f43f5e', accentText:'#3a0714'},
    {id:'scarlet', name:'Scarlet', bg:'#160608', panel:'#260d10', panelAlt:'#381419', border:'#64202b', text:'#ffecef', textDim:'#e88a98', accent:'#ff536d', accentText:'#27070b'},
    {id:'cherry', name:'Cherry', bg:'#17080b', panel:'#281015', panelAlt:'#3a1820', border:'#672431', text:'#ffecef', textDim:'#e78b9c', accent:'#ff6b81', accentText:'#2b080d'},
    {id:'ember', name:'Ember', bg:'#170a07', panel:'#27130c', panelAlt:'#391f14', border:'#63351f', text:'#fff0e5', textDim:'#d99b77', accent:'#ff8a4c', accentText:'#2a0d07'},
    // Pink / Rose
    {id:'rose', name:'Rose', bg:'#1c0510', panel:'#2c0a1c', panelAlt:'#3a0f26', border:'#5a1c3c', text:'#fdeef4', textDim:'#c99cb2', accent:'#f472b6', accentText:'#3b0a24'},
    {id:'blush', name:'Blush', bg:'#170b10', panel:'#27121b', panelAlt:'#3a1c28', border:'#653246', text:'#ffedf4', textDim:'#e8a2b8', accent:'#f58bb0', accentText:'#2a0c15'},
    {id:'berry', name:'Berry', bg:'#160914', panel:'#250f20', panelAlt:'#39182e', border:'#602646', text:'#ffeaf5', textDim:'#d895b4', accent:'#e878b2', accentText:'#270b1b'},
    {id:'magenta', name:'Magenta', bg:'#170712', panel:'#280b20', panelAlt:'#38102c', border:'#5c1e4a', text:'#fff0fa', textDim:'#d39abb', accent:'#f0a', accentText:'#3d062c'},
    {id:'fuchsia', name:'Fuchsia', bg:'#170815', panel:'#280d23', panelAlt:'#3b1432', border:'#66205a', text:'#ffeafd', textDim:'#e18bcf', accent:'#ef5fd0', accentText:'#28091e'},
    // Orange
    {id:'orange', name:'Orange', bg:'#1a0f05', panel:'#2a1a0a', panelAlt:'#38220e', border:'#5a3a1a', text:'#fdf3e8', textDim:'#cbab84', accent:'#fb923c', accentText:'#341102'},
    {id:'coral', name:'Coral', bg:'#1b0b08', panel:'#2b1410', panelAlt:'#3a1c16', border:'#63352a', text:'#fff2ed', textDim:'#d2a69a', accent:'#fb7185', accentText:'#3b0d0a'},
    {id:'peach', name:'Peach', bg:'#190e0a', panel:'#2a1811', panelAlt:'#3b241a', border:'#68402b', text:'#fff1e7', textDim:'#e7ae8d', accent:'#ffad7a', accentText:'#2d140a'},
    {id:'tangerine', name:'Tangerine', bg:'#1a0e06', panel:'#2b180a', panelAlt:'#3d2510', border:'#6d3f17', text:'#fff1dc', textDim:'#e7a15d', accent:'#ff9d3d', accentText:'#2d1305'},
    // Yellow / Gold
    {id:'yellow', name:'Yellow', bg:'#17150a', panel:'#26220f', panelAlt:'#332d14', border:'#544b1f', text:'#fdfaea', textDim:'#c9c08a', accent:'#facc15', accentText:'#332600'},
    {id:'honeycomb', name:'Honeycomb', bg:'#171008', panel:'#291c0c', panelAlt:'#3b2911', border:'#654b20', text:'#fff4dc', textDim:'#d8b46b', accent:'#f2c14e', accentText:'#251704'},
    {id:'marigold', name:'Marigold', bg:'#171006', panel:'#281c09', panelAlt:'#3a2910', border:'#67491b', text:'#fff4d8', textDim:'#e2bd68', accent:'#f5c84b', accentText:'#281804'},
    {id:'mustard', name:'Mustard', bg:'#151106', panel:'#251c09', panelAlt:'#362a10', border:'#5b481c', text:'#f9f0d5', textDim:'#cdb46a', accent:'#d8b94c', accentText:'#241905'},
       // Green
    {id:'emerald', name:'Emerald', bg:'#071410', panel:'#0d2119', panelAlt:'#122c22', border:'#1f4a37', text:'#eafff3', textDim:'#8fc7a8', accent:'#4ade80', accentText:'#052e12'},
    {id:'lime', name:'Lime', bg:'#101507', panel:'#1b240b', panelAlt:'#26330f', border:'#43541c', text:'#f5ffe8', textDim:'#b4c58c', accent:'#a3e635', accentText:'#1e2d05'},
    {id:'citrus', name:'Citrus', bg:'#111406', panel:'#202408', panelAlt:'#30360e', border:'#4d5718', text:'#f3fbd9', textDim:'#aebe62', accent:'#d4e34f', accentText:'#172006'},
    {id:'olive', name:'Olive', bg:'#121307', panel:'#22230d', panelAlt:'#303113', border:'#4b4c1b', text:'#f7f8e8', textDim:'#c0c18f', accent:'#bef264', accentText:'#283006'},
    {id:'forest', name:'Forest', bg:'#06120c', panel:'#0c1d14', panelAlt:'#12291c', border:'#1d4630', text:'#e9fff1', textDim:'#87b69a', accent:'#34d399', accentText:'#052416'},
    {id:'jade', name:'Jade', bg:'#07130c', panel:'#0e2116', panelAlt:'#173323', border:'#2b543a', text:'#e8fff0', textDim:'#79c69a', accent:'#4de39a', accentText:'#062513'},
    {id:'mint', name:'Mint', bg:'#071511', panel:'#0d241d', panelAlt:'#143129', border:'#245346', text:'#edfff8', textDim:'#94c9b4', accent:'#6ee7b7', accentText:'#06271d'},
    {id:'seafoam', name:'Seafoam', bg:'#071513', panel:'#10251f', panelAlt:'#193a32', border:'#2a5d4f', text:'#e6fff9', textDim:'#82d0bb', accent:'#69e4c0', accentText:'#06251d'},
    {id:'neon', name:'Neon', bg:'#07110b', panel:'#0d2114', panelAlt:'#12341c', border:'#1d572c', text:'#edfff2', textDim:'#8fc79d', accent:'#a3ff12', accentText:'#142b04'},
    // Teal / Cyan
    {id:'cyan', name:'Cyan', bg:'#051519', panel:'#0a2129', panelAlt:'#0f2c35', border:'#1c4a57', text:'#eafcff', textDim:'#8bc2cf', accent:'#22d3ee', accentText:'#032a30'},
    {id:'cyan2', name:'Cyan II', bg:'#061218', panel:'#0b202a', panelAlt:'#12313d', border:'#1f5367', text:'#e6fbff', textDim:'#6cc7dd', accent:'#4fd9ef', accentText:'#05232e'},
    {id:'deepsea', name:'Deep Sea', bg:'#050f14', panel:'#0a1a22', panelAlt:'#102932', border:'#1d4a59', text:'#e5faff', textDim:'#6fa5b5', accent:'#48c8df', accentText:'#05202a'},
    {id:'teal', name:'Teal', bg:'#071614', panel:'#0d2220', panelAlt:'#122d2a', border:'#1f4a44', text:'#eafffa', textDim:'#8fc7bb', accent:'#5eead4', accentText:'#062521'},
    {id:'aqua', name:'Aqua', bg:'#041315', panel:'#082127', panelAlt:'#0d3038', border:'#1b5661', text:'#e9feff', textDim:'#8dc8ce', accent:'#2dd4bf', accentText:'#032522'},
    {id:'aqua2', name:'Aqua II', bg:'#061316', panel:'#0c2429', panelAlt:'#12373d', border:'#21636c', text:'#e5ffff', textDim:'#70cdd2', accent:'#54e2e8', accentText:'#052329'},
    {id:'tropical', name:'Tropical', bg:'#061610', panel:'#0d281d', panelAlt:'#143a28', border:'#266044', text:'#effff6', textDim:'#8fcbb0', accent:'#34d399', accentText:'#052b1c'},
    {id:'arctic', name:'Arctic', bg:'#081319', panel:'#0e2029', panelAlt:'#15303c', border:'#27505f', text:'#eefcff', textDim:'#91bac5', accent:'#67e8f9', accentText:'#06252e'},
    {id:'frost', name:'Frost', bg:'#081419', panel:'#101f27', panelAlt:'#183138', border:'#2c4f5c', text:'#e9f8fc', textDim:'#8fbdc8', accent:'#7dd8ea', accentText:'#062229'},
    {id:'frost2', name:'Frost II', bg:'#091318', panel:'#12232c', panelAlt:'#1d3440', border:'#365968', text:'#edfaff', textDim:'#9dc4d2', accent:'#8de2f2', accentText:'#0b2029'},
    {id:'aurora', name:'Aurora', bg:'#08120f', panel:'#10201b', panelAlt:'#19352a', border:'#2c5b45', text:'#e9fff4', textDim:'#82c9a3', accent:'#79f2b0', accentText:'#09251a'},
    // Blue
    {id:'sky', name:'Sky Blue', bg:'#071426', panel:'#0d2038', panelAlt:'#142b47', border:'#2b4c70', text:'#eef6ff', textDim:'#9db4cc', accent:'#60a5fa', accentText:'#0b1a33'},
    {id:'azure', name:'Azure', bg:'#07111a', panel:'#0e2130', panelAlt:'#163448', border:'#285d7b', text:'#eaf8ff', textDim:'#73bfe8', accent:'#55b9ff', accentText:'#08202d'},
    {id:'cobalt', name:'Cobalt', bg:'#080e1b', panel:'#101a2e', panelAlt:'#172843', border:'#274c7d', text:'#e9f1ff', textDim:'#7096d4', accent:'#5b8dff', accentText:'#0a1830'},
    {id:'navy', name:'Navy', bg:'#060d19', panel:'#0c1727', panelAlt:'#132237', border:'#243c5e', text:'#edf5ff', textDim:'#8fa7c5', accent:'#38bdf8', accentText:'#062039'},
    {id:'denim', name:'Denim', bg:'#08101a', panel:'#101e2d', panelAlt:'#182c40', border:'#2c4b68', text:'#e9f3ff', textDim:'#7899b9', accent:'#6f9fd0', accentText:'#0b1c2b'},
    {id:'royal', name:'Royal Blue', bg:'#080b1a', panel:'#111832', panelAlt:'#19234a', border:'#304275', text:'#eef2ff', textDim:'#9daee0', accent:'#6366f1', accentText:'#10133a'},
    {id:'ocean', name:'Ocean', bg:'#061118', panel:'#0b202c', panelAlt:'#123342', border:'#205b70', text:'#e6faff', textDim:'#67bfd5', accent:'#45c6e8', accentText:'#05232f'},
    // Purple
    {id:'violet', name:'Violet', bg:'#171224', panel:'#241b38', panelAlt:'#302448', border:'#51406f', text:'#f7f2ff', textDim:'#b9aecf', accent:'#a78bfa', accentText:'#1e1033'},
    {id:'lavender', name:'Lavender', bg:'#110f1c', panel:'#1d1930', panelAlt:'#292342', border:'#453b67', text:'#f6f1ff', textDim:'#b9add3', accent:'#c4b5fd', accentText:'#21153d'},
    {id:'plum', name:'Plum', bg:'#120817', panel:'#200d29', panelAlt:'#2c1238', border:'#4c245d', text:'#faefff', textDim:'#c6a6d4', accent:'#c084fc', accentText:'#260a33'},
    {id:'plum2', name:'Deep Plum', bg:'#130817', panel:'#200e25', panelAlt:'#32143a', border:'#57205f', text:'#fae9ff', textDim:'#c18acb', accent:'#d36bea', accentText:'#210a27'},
    {id:'heather', name:'Heather', bg:'#100d17', panel:'#1b1625', panelAlt:'#292139', border:'#493b5f', text:'#f3eefb', textDim:'#aa9cba', accent:'#b69bdf', accentText:'#171021'},
    {id:'amethyst', name:'Amethyst', bg:'#110a18', panel:'#1c1028', panelAlt:'#2b1940', border:'#4c2d6b', text:'#f5edff', textDim:'#b59bd8', accent:'#b27aff', accentText:'#190d2b'},
    {id:'orchid', name:'Orchid', bg:'#16091a', panel:'#251027', panelAlt:'#38183d', border:'#61276a', text:'#ffeefe', textDim:'#d69bd9', accent:'#e68aff', accentText:'#260b2c'},
    {id:'indigo', name:'Indigo', bg:'#0e0f1f', panel:'#171a30', panelAlt:'#1f2340', border:'#38406a', text:'#eef0ff', textDim:'#a3a8cf', accent:'#818cf8', accentText:'#141033'},
    {id:'iris', name:'Iris', bg:'#0e0b1a', panel:'#18132b', panelAlt:'#251e42', border:'#41356f', text:'#f0edff', textDim:'#a69bd4', accent:'#8f83ff', accentText:'#17102d'},
    {id:'periwinkle', name:'Periwinkle', bg:'#0d0e1b', panel:'#17192e', panelAlt:'#232747', border:'#3b4777', text:'#eef0ff', textDim:'#a2addf', accent:'#9aa8ff', accentText:'#141735'},
    {id:'cyberpunk', name:'Cyberpunk', bg:'#10051a', panel:'#1d0a2d', panelAlt:'#2a1040', border:'#4e1d69', text:'#fff1ff', textDim:'#c59bd5', accent:'#e879f9', accentText:'#30073a'},
    {id:'twilight', name:'Twilight', bg:'#0c0a16', panel:'#151126', panelAlt:'#211c3b', border:'#3a3160', text:'#efedff', textDim:'#9c96c4', accent:'#8d7cff', accentText:'#130f28'},
    // Additional palettes
    {id:'obsidian', name:'Obsidian', bg:'#050608', panel:'#0e1116', panelAlt:'#171b22', border:'#2a313d', text:'#f3f6fa', textDim:'#929dab', accent:'#7dd3fc', accentText:'#07131b'},
    {id:'carbon', name:'Carbon', bg:'#090a0c', panel:'#14171b', panelAlt:'#20242a', border:'#343a43', text:'#f0f2f5', textDim:'#a1a8b2', accent:'#c4b5fd', accentText:'#171225'},
    {id:'cocoa', name:'Cocoa', bg:'#120b08', panel:'#21140f', panelAlt:'#302018', border:'#51362a', text:'#fff3e8', textDim:'#c7a68f', accent:'#e0a16b', accentText:'#2b1508'},
    {id:'sand', name:'Sand', bg:'#15110c', panel:'#241d14', panelAlt:'#332a1d', border:'#554734', text:'#fbf3e3', textDim:'#c4b394', accent:'#e7c27d', accentText:'#2a1b09'},
    {id:'bronze', name:'Bronze', bg:'#130d08', panel:'#24170d', panelAlt:'#342312', border:'#5c4122', text:'#fff1dc', textDim:'#c9a77b', accent:'#d9a441', accentText:'#2b1905'},
    {id:'rust', name:'Rust', bg:'#160907', panel:'#28130e', panelAlt:'#3a1d16', border:'#673327', text:'#fff0e8', textDim:'#d09b86', accent:'#e76f51', accentText:'#2b0c07'},
    {id:'wine', name:'Wine', bg:'#13070d', panel:'#240e18', panelAlt:'#351522', border:'#5b2539', text:'#ffedf3', textDim:'#d19aaa', accent:'#d94f70', accentText:'#300813'},
    {id:'mauve', name:'Mauve', bg:'#140c13', panel:'#251522', panelAlt:'#362032', border:'#5a3852', text:'#faeef7', textDim:'#c5a4bb', accent:'#d08abf', accentText:'#291326'},
    {id:'raspberry', name:'Raspberry', bg:'#17070f', panel:'#290d1a', panelAlt:'#3b1425', border:'#66233f', text:'#ffebf2', textDim:'#d889a7', accent:'#ec4c8a', accentText:'#310616'},
    {id:'apricot', name:'Apricot', bg:'#180d08', panel:'#29170e', panelAlt:'#3a2115', border:'#65402a', text:'#fff1e5', textDim:'#d6a789', accent:'#ff9f68', accentText:'#321408'},
    {id:'cantaloupe', name:'Cantaloupe', bg:'#170d08', panel:'#2a1710', panelAlt:'#3b2217', border:'#68402d', text:'#fff3e9', textDim:'#d9aa8e', accent:'#ffb07c', accentText:'#32150a'},
    {id:'gold', name:'Gold', bg:'#151006', panel:'#261b09', panelAlt:'#38270f', border:'#60471b', text:'#fff5d8', textDim:'#d2b66b', accent:'#f5c542', accentText:'#2b1c04'},
    {id:'honey', name:'Honey', bg:'#171008', panel:'#291b0b', panelAlt:'#3b2810', border:'#674b1d', text:'#fff4dc', textDim:'#d6b56f', accent:'#eab308', accentText:'#2a1b03'},
    {id:'canary', name:'Canary', bg:'#151405', panel:'#25240a', panelAlt:'#363411', border:'#55521b', text:'#fbfbdc', textDim:'#c8c77a', accent:'#fde047', accentText:'#302f03'},
    {id:'green', name:'Classic Green', bg:'#071309', panel:'#0d2113', panelAlt:'#14301b', border:'#23502d', text:'#edfff0', textDim:'#8fbd9b', accent:'#4ade80', accentText:'#052b12'},
    {id:'moss', name:'Moss', bg:'#101306', panel:'#1e250c', panelAlt:'#2e3512', border:'#4b5520', text:'#f4f8df', textDim:'#b5bd7e', accent:'#a8b84a', accentText:'#202505'},
    {id:'pine', name:'Pine', bg:'#06110b', panel:'#0b1d13', panelAlt:'#112a1a', border:'#1d4730', text:'#e8fff0', textDim:'#82b697', accent:'#22c55e', accentText:'#052512'},
    {id:'chartreuse', name:'Chartreuse', bg:'#0f1406', panel:'#1b2409', panelAlt:'#29340d', border:'#43521a', text:'#f4ffdf', textDim:'#b5c979', accent:'#bef264', accentText:'#1c2b04'},
    {id:'spring', name:'Spring', bg:'#07150d', panel:'#0d2417', panelAlt:'#15351f', border:'#25583a', text:'#eafff3', textDim:'#8ac7a2', accent:'#86efac', accentText:'#082516'},
    {id:'lagoon', name:'Lagoon', bg:'#061416', panel:'#0c2428', panelAlt:'#12353a', border:'#245861', text:'#e7ffff', textDim:'#83c5cb', accent:'#2dd4bf', accentText:'#042522'},
    {id:'turquoise', name:'Turquoise', bg:'#061517', panel:'#0c2528', panelAlt:'#12383b', border:'#236067', text:'#e8fffe', textDim:'#79c8c5', accent:'#2dd4bf', accentText:'#032522'},
    {id:'ice', name:'Ice', bg:'#071419', panel:'#10242c', panelAlt:'#183740', border:'#2d5965', text:'#effcff', textDim:'#98c7d0', accent:'#a5f3fc', accentText:'#09252d'},
    {id:'glacier', name:'Glacier', bg:'#07131a', panel:'#0f222c', panelAlt:'#183542', border:'#2b5668', text:'#edfaff', textDim:'#8fb9c9', accent:'#7dd3fc', accentText:'#062333'},
    {id:'steel', name:'Steel', bg:'#0a1015', panel:'#151e26', panelAlt:'#202c35', border:'#374955', text:'#edf5f9', textDim:'#91a5b2', accent:'#9cc4d4', accentText:'#0d1d24'},
    {id:'sapphire', name:'Sapphire', bg:'#060c18', panel:'#0d1830', panelAlt:'#142548', border:'#254777', text:'#eaf1ff', textDim:'#7e9bd0', accent:'#3b82f6', accentText:'#07152d'},
    {id:'denim2', name:'Deep Denim', bg:'#08111b', panel:'#101f2f', panelAlt:'#192e44', border:'#2b4d6d', text:'#eaf4ff', textDim:'#82a3c0', accent:'#4f9bdc', accentText:'#081d30'},
    {id:'marine', name:'Marine', bg:'#061018', panel:'#0b1c28', panelAlt:'#123044', border:'#20526b', text:'#e8faff', textDim:'#6fb0c7', accent:'#38bdf8', accentText:'#062238'},
    {id:'steelblue', name:'Steel Blue', bg:'#0a1118', panel:'#141e29', panelAlt:'#1e2c3b', border:'#34495f', text:'#edf5ff', textDim:'#91a7bc', accent:'#7aa7c7', accentText:'#0b1c29'},
    {id:'dusk', name:'Dusk', bg:'#0d0d18', panel:'#17172a', panelAlt:'#23233d', border:'#3a3a61', text:'#f0efff', textDim:'#a5a2c4', accent:'#a78bfa', accentText:'#17102c'},
    {id:'midnight', name:'Midnight', bg:'#050713', panel:'#0b1021', panelAlt:'#131a32', border:'#263454', text:'#eaf0ff', textDim:'#7f8baa', accent:'#818cf8', accentText:'#0b1028'},
    {id:'violet2', name:'Electric Violet', bg:'#12091b', panel:'#1f1030', panelAlt:'#2d1645', border:'#4e2770', text:'#f9efff', textDim:'#c19bd4', accent:'#c084fc', accentText:'#210c31'},
    {id:'grape', name:'Grape', bg:'#120817', panel:'#21102a', panelAlt:'#31183e', border:'#542866', text:'#f9edff', textDim:'#bd9bc9', accent:'#a855f7', accentText:'#210b32'},
    {id:'electric', name:'Electric Purple', bg:'#10091a', panel:'#1b0f2d', panelAlt:'#2a1743', border:'#4b2b6d', text:'#f8efff', textDim:'#c2a1da', accent:'#d946ef', accentText:'#2d0a33'},
    {id:'nebula', name:'Nebula', bg:'#0b0816', panel:'#151026', panelAlt:'#21183a', border:'#3a2d5d', text:'#f1edff', textDim:'#a79bc7', accent:'#8b5cf6', accentText:'#160c2c'},
    {id:'northern', name:'Northern Lights', bg:'#07110f', panel:'#0d211d', panelAlt:'#15352d', border:'#285949', text:'#eafff7', textDim:'#86c5af', accent:'#5eead4', accentText:'#062520'},
    {id:'mocha', name:'Mocha', bg:'#100b09', panel:'#1e1511', panelAlt:'#2c2019', border:'#4a382d', text:'#f7eee7', textDim:'#bba392', accent:'#c4a484', accentText:'#21150e'},
    {id:'ink', name:'Ink', bg:'#07090d', panel:'#10141b', panelAlt:'#1a202a', border:'#2d3541', text:'#eef3f8', textDim:'#8e9aa8', accent:'#e2e8f0', accentText:'#11151b'},
    {id:'platinum', name:'Platinum', bg:'#0d1014', panel:'#181d23', panelAlt:'#242b33', border:'#3d4650', text:'#f5f7f9', textDim:'#a9b2bc', accent:'#d1d5db', accentText:'#171a1f'},
    {id:'coolgray', name:'Cool Gray', bg:'#0d1117', panel:'#171d25', panelAlt:'#222a34', border:'#394552', text:'#edf2f7', textDim:'#9aa7b4', accent:'#a5b4fc', accentText:'#14162b'},
    {id:'warmgray', name:'Warm Gray', bg:'#121110', panel:'#201e1b', panelAlt:'#2e2b27', border:'#4b4741', text:'#f3f1ed', textDim:'#ada79d', accent:'#d6c6b2', accentText:'#211d18'},
    {id:'parchment', name:'Parchment', bg:'#17130d', panel:'#292219', panelAlt:'#3a3024', border:'#5b4c3a', text:'#fff8e9', textDim:'#c8b79c', accent:'#e8c98b', accentText:'#2a1d0c'},
    {id:'smokyblue', name:'Smoky Blue', bg:'#0a1017', panel:'#151e29', panelAlt:'#202d3a', border:'#35485a', text:'#edf5fb', textDim:'#8ea7ba', accent:'#7dd3fc', accentText:'#0a1c27'},
    {id:'deepteal', name:'Deep Teal', bg:'#061111', panel:'#0c1d1c', panelAlt:'#122c2a', border:'#1e4a46', text:'#e8fffc', textDim:'#83bbb5', accent:'#14b8a6', accentText:'#04221f'},
    {id:'firefly', name:'Firefly', bg:'#07100d', panel:'#0e1c16', panelAlt:'#173027', border:'#2a4d40', text:'#eafff4', textDim:'#83b7a1', accent:'#a3e635', accentText:'#162803'},
    {id:'copperblue', name:'Copper Blue', bg:'#0b1015', panel:'#172027', panelAlt:'#25333b', border:'#40515a', text:'#eef7fa', textDim:'#93aab2', accent:'#f59e0b', accentText:'#2c1703'},
       // Light presets
     {id:'ivory', name:'Ivory', bg:'#e4e0d7', panel:'#eeeae2', panelAlt:'#e0dbd0', border:'#c8c0b1', text:'#353129', textDim:'#777064', accent:'#a87838', accentText:'#241806'},
     {id:'paper', name:'Paper', bg:'#e5e4df', panel:'#efefeb', panelAlt:'#e2e1dc', border:'#c9c7bf', text:'#35342f', textDim:'#74726b', accent:'#756344', accentText:'#20190e'},
     {id:'cloud', name:'Cloud', bg:'#dfe5eb', panel:'#e9eef2', panelAlt:'#dce2e8', border:'#bec8d2', text:'#2d3742', textDim:'#6e7b88', accent:'#4773bd', accentText:'#08182f'},
     {id:'snow', name:'Snow', bg:'#e2e8ec', panel:'#edf1f4', panelAlt:'#dfe5e9', border:'#c1cbd4', text:'#2c3740', textDim:'#707c85', accent:'#3284ae', accentText:'#052238'},
     {id:'linen', name:'Linen', bg:'#e4ddd3', panel:'#eee9e2', panelAlt:'#dfd7cb', border:'#c9bbaa', text:'#373027', textDim:'#786d60', accent:'#a36436', accentText:'#241105'},
     {id:'cream', name:'Cream', bg:'#e7e1d1', panel:'#f0ebdf', panelAlt:'#e1dac6', border:'#c9bb8f', text:'#37331f', textDim:'#766d4c', accent:'#ad8315', accentText:'#241900'},
     {id:'porcelain', name:'Porcelain', bg:'#e1e5e8', panel:'#ebeff2', panelAlt:'#dde2e6', border:'#bec7cf', text:'#303840', textDim:'#707a83', accent:'#4677bb', accentText:'#091b36'},
     {id:'mist', name:'Mist', bg:'#e2e3e5', panel:'#ececed', panelAlt:'#dedfe1', border:'#c1c4c8', text:'#34363a', textDim:'#72757a', accent:'#687b91', accentText:'#111a25'},
     {id:'dove', name:'Dove', bg:'#e3e1e3', panel:'#edebed', panelAlt:'#dedcdf', border:'#c2bec4', text:'#37343a', textDim:'#757179', accent:'#826d8d', accentText:'#211526'},
     {id:'canvas', name:'Canvas', bg:'#e3ddd2', panel:'#eee9e1', panelAlt:'#ded6c7', border:'#c7b99f', text:'#363127', textDim:'#766d5d', accent:'#8e6e39', accentText:'#241805'},
     {id:'frostwhite', name:'Frost', bg:'#dce7eb', panel:'#eaf0f2', panelAlt:'#d5e0e4', border:'#b7c9cf', text:'#2c393e', textDim:'#667b81', accent:'#29909b', accentText:'#052326'},
     {id:'cotton', name:'Cotton', bg:'#e4e4e4', panel:'#ededed', panelAlt:'#dddddd', border:'#c5c5c5', text:'#353535', textDim:'#707070', accent:'#698894', accentText:'#0d1c23'},
     {id:'almond', name:'Almond', bg:'#e4ddd5', panel:'#eee9e3', panelAlt:'#ddd2c4', border:'#c5b49f', text:'#383027', textDim:'#786a59', accent:'#a66b42', accentText:'#250f04'},
     {id:'marble', name:'Marble', bg:'#e2e2e2', panel:'#ececec', panelAlt:'#dcdcdc', border:'#c2c2c2', text:'#353535', textDim:'#707070', accent:'#818181', accentText:'#151515'},

     // 15 new light themes
     {id:'rosepaper', name:'Rose Paper', bg:'#eee5e8', panel:'#f7eef1', panelAlt:'#e7d9df', border:'#d5c0c9', text:'#3d3036', textDim:'#7d6973', accent:'#b86b87', accentText:'#fff7fa'},
     {id:'pearlblue', name:'Pearl Blue', bg:'#e4ebf1', panel:'#f0f5f8', panelAlt:'#dce5ec', border:'#c4d1db', text:'#2d3943', textDim:'#6c7b86', accent:'#4f86b3', accentText:'#f8fcff'},
     {id:'sage', name:'Sage', bg:'#e3e9e0', panel:'#eef3eb', panelAlt:'#d9e2d5', border:'#becbb8', text:'#303a2d', textDim:'#6e7b69', accent:'#6d8f62', accentText:'#f8fff5'},
     {id:'pistachio', name:'Pistachio', bg:'#e8ebdc', panel:'#f1f4e8', panelAlt:'#dfe4d0', border:'#c8d0ae', text:'#343827', textDim:'#72785e', accent:'#82934a', accentText:'#fbfff1'},
     {id:'butter', name:'Butter', bg:'#f0ecd8', panel:'#f7f3e3', panelAlt:'#e8e1c5', border:'#d5c99f', text:'#3b3828', textDim:'#797253', accent:'#b3912f', accentText:'#fffdf3'},
     {id:'lemonade', name:'Lemonade', bg:'#f0efd9', panel:'#f8f7e9', panelAlt:'#e8e7c9', border:'#d2d0a7', text:'#3b3b29', textDim:'#777751', accent:'#9a972d', accentText:'#fffef2'},
     {id:'peachcream', name:'Peach Cream', bg:'#f0e3da', panel:'#f8eee8', panelAlt:'#ead8cc', border:'#d8bfae', text:'#3e332d', textDim:'#7d6a5e', accent:'#c47f5a', accentText:'#fff9f5'},
     {id:'apricotlight', name:'Apricot Light', bg:'#f1e2d7', panel:'#f8ece4', panelAlt:'#ead7c9', border:'#d7b9a5', text:'#3d312b', textDim:'#7c695d', accent:'#c97a4b', accentText:'#fff9f5'},
     {id:'lilac', name:'Lilac', bg:'#e9e4ee', panel:'#f3eef6', panelAlt:'#e1d9e8', border:'#cbbfd4', text:'#37313d', textDim:'#756b7e', accent:'#8870a8', accentText:'#fffaff'},
     {id:'periwinklelight', name:'Periwinkle Light', bg:'#e5e8f2', panel:'#f0f2f8', panelAlt:'#dce1ee', border:'#c2c9dc', text:'#303746', textDim:'#6d7688', accent:'#6477ad', accentText:'#fbfcff'},
     {id:'skywash', name:'Sky Wash', bg:'#e1ebf0', panel:'#eef5f8', panelAlt:'#d7e4ea', border:'#bcd0da', text:'#2e3940', textDim:'#687883', accent:'#4e91ad', accentText:'#f7fdff'},
     {id:'mintcream', name:'Mint Cream', bg:'#e0ece7', panel:'#edf6f2', panelAlt:'#d4e4de', border:'#b9d0c7', text:'#2c3b35', textDim:'#65776f', accent:'#4e927d', accentText:'#f7fffc'},
     {id:'tealwash', name:'Teal Wash', bg:'#dfeae9', panel:'#ecf4f3', panelAlt:'#d4e2e1', border:'#b7cdcb', text:'#2d3a39', textDim:'#657674', accent:'#478d8a', accentText:'#f7fffe'},
     {id:'lavenderrose', name:'Lavender Rose', bg:'#ece4eb', panel:'#f6edf5', panelAlt:'#e4d8e3', border:'#d0bdce', text:'#3a3139', textDim:'#766b74', accent:'#a16d96', accentText:'#fff9fe'},
     {id:'bluegraylight', name:'Blue Gray Light', bg:'#e4e7ea', panel:'#eff1f3', panelAlt:'#dce0e4', border:'#c3c9cf', text:'#30363b', textDim:'#6d747a', accent:'#687f95', accentText:'#fbfdff'},
// Special
    {id:'amber', name:'Amber', bg:'#0e1218', panel:'#161c26', panelAlt:'#1c2432', border:'#2a3444', text:'#e8edf5', textDim:'#8996a8', accent:'#ffb454', accentText:'#1a1206'},
    {id:'sunset', name:'Sunset', bg:'#180a08', panel:'#29130e', panelAlt:'#3a1b12', border:'#623622', text:'#fff3e8', textDim:'#d3aa8d', accent:'#fb923c', accentText:'#3a1605'},
    {id:'khaki', name:'Khaki', bg:'#121209', panel:'#211f12', panelAlt:'#302e19', border:'#4e4b29', text:'#f2f0d9', textDim:'#b6b287', accent:'#c3bd68', accentText:'#1c1c0d'}
  ];
  // Single shared source of truth for every theme preset on the site.
  // Other scripts on this page (and the loader on other pages) read from
  // window.SBL_THEMES instead of keeping their own copy, so a theme only
  // ever needs to be added in one place.
  window.SBL_THEMES = THEMES;
  const THEME_KEY='sbl_dashboard_theme';
  const CUSTOM_KEY='sbl_dashboard_custom_theme';
  const TEAL='#5eead4', RED='#ff7a7a';
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
    return THEMES.find(t=>t.id===id)||THEMES[0];
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
