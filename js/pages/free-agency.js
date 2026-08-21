// Free Agency page controller extracted from free-agency.html during Phase 6G refactor.
(()=>{
const db = window.SBL.getSupabase();
const DEFAULT_SEASON='Season 15';

// ---- access gate: must be logged in AND have a claimed team, or bounce to login ----
async function enforceAccessGate(){
  const {data:{session}} = await db.auth.getSession();
  if(!session){ location.replace('index.html'); return false; }
  const {data:profile, error} = await db.from('profiles').select('team_name').eq('id', session.user.id).maybeSingle();
  if(error || !profile?.team_name){ location.replace('index.html'); return false; }
  document.getElementById('app').style.display = '';
  return true;
}
function selectedSeasonSnapshot(shared){
  const settings=shared?.settings||{},archives=settings.seasonArchives||{},requested=new URLSearchParams(location.search).get('season');
  if(requested&&archives[requested]){const a=archives[requested];return{name:a.name||requested,key:requested,settings:a.settings||{},archived:true,archives};}
  return{name:settings.activeSeason||DEFAULT_SEASON,key:'',settings,archived:false,archives};
}
function installSeasonPicker(shared){
  // Season picker UI removed; still resolve which season's data to use.
  return selectedSeasonSnapshot(shared);
}


let settings={rosters:{},freeAgency:{mons:[]}};
let allRosters={};

const $=id=>document.getElementById(id);
const esc=s=>String(s??''). replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const key=s=>String(s||''). trim().toLowerCase()
  .replace(/[\u2018\u2019']/g,'')
  .replace(/[♀]/g,'-f')
  .replace(/[♂]/g,'-m')
  .replace(/[\s_]+/g,'-')
  .replace(/[^a-z0-9-]/g,'')
  .replace(/-+/g,'-')
  .replace(/^-|-$/g,'');

// --- filter state ---
let filterName='';
let filterTypes=new Set();
let filterPoints='';
let filterAvail='all';
let filterMove='';
let filterAbility='';
let filterStat='';
let filterStatMin='';
let dexData={pokedex:{},learnsets:{}};
let filterRenderTimer=null;

const ALL_TYPES=['normal','fire','water','electric','grass','ice','fighting','poison',
  'ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];

function normalizeRosters(raw){
  const out={};
  for(const [team,list] of Object.entries(raw||{})){
    if(!Array.isArray(list))continue;
    out[team]=list.map(x=>typeof x==='string'
      ?{name:(SBL.pokemon?.displayNameWithForm ? SBL.pokemon.displayNameWithForm(x) : x),points:null}
      :{name:(SBL.pokemon?.displayNameWithForm ? SBL.pokemon.displayNameWithForm(String(x?.name??x?.species??'')) : String(x?.name??x?.species??'')),points:x?.points??null}
    ).filter(x=>x.name);
  }
  return out;
}


function owner(name){
  for(const [team,list] of Object.entries(allRosters))
    for(const mon of list)
      if(SBL.pokemon.sameSpeciesForm(name, mon.name)) return team;
  return null;
}


function sprite(name){ return SBL.pokemon.spriteMarkup(name, 'sprite'); }

// ---- Static Pokémon type table ----
// Every mon's type is fixed game data — it never changes — so instead of
// calling an external API for it on every page load (which is what made
// this page laggy: a live network round-trip per Pokémon, repeated on every
// background refresh), the full type table is embedded right here and the
// lookup below is a synchronous, in-memory object read. No network calls,
// no async batching, no re-render storms.
const TYPE_TABLE={"bulbasaur":["grass","poison"],"ivysaur":["grass","poison"],"venusaur":["grass","poison"],"charmander":["fire"],"charmeleon":["fire"],"charizard":["fire","flying"],"squirtle":["water"],"wartortle":["water"],"blastoise":["water"],"caterpie":["bug"],"metapod":["bug"],"butterfree":["bug","flying"],"weedle":["bug","poison"],"kakuna":["bug","poison"],"beedrill":["bug","poison"],"pidgey":["normal","flying"],"pidgeotto":["normal","flying"],"pidgeot":["normal","flying"],"rattata":["normal"],"raticate":["normal"],"spearow":["normal","flying"],"fearow":["normal","flying"],"ekans":["poison"],"arbok":["poison"],"pikachu":["electric"],"raichu":["electric"],"sandshrew":["ground"],"sandslash":["ground"],"nidoran-f":["poison"],"nidorina":["poison"],"nidoqueen":["poison","ground"],"nidoran-m":["poison"],"nidorino":["poison"],"nidoking":["poison","ground"],"clefairy":["fairy"],"clefable":["fairy"],"vulpix":["fire"],"ninetales":["fire"],"jigglypuff":["normal","fairy"],"wigglytuff":["normal","fairy"],"zubat":["poison","flying"],"golbat":["poison","flying"],"oddish":["grass","poison"],"gloom":["grass","poison"],"vileplume":["grass","poison"],"paras":["bug","grass"],"parasect":["bug","grass"],"venonat":["bug","poison"],"venomoth":["bug","poison"],"diglett":["ground"],"dugtrio":["ground"],"meowth":["normal"],"persian":["normal"],"psyduck":["water"],"golduck":["water"],"mankey":["fighting"],"primeape":["fighting"],"growlithe":["fire"],"arcanine":["fire"],"poliwag":["water"],"poliwhirl":["water"],"poliwrath":["water","fighting"],"abra":["psychic"],"kadabra":["psychic"],"alakazam":["psychic"],"machop":["fighting"],"machoke":["fighting"],"machamp":["fighting"],"bellsprout":["grass","poison"],"weepinbell":["grass","poison"],"victreebel":["grass","poison"],"tentacool":["water","poison"],"tentacruel":["water","poison"],"geodude":["rock","ground"],"graveler":["rock","ground"],"golem":["rock","ground"],"ponyta":["fire"],"rapidash":["fire"],"slowpoke":["water","psychic"],"slowbro":["water","psychic"],"magnemite":["electric","steel"],"magneton":["electric","steel"],"farfetchd":["normal","flying"],"doduo":["normal","flying"],"dodrio":["normal","flying"],"seel":["water"],"dewgong":["water","ice"],"grimer":["poison"],"muk":["poison"],"shellder":["water"],"cloyster":["water","ice"],"gastly":["ghost","poison"],"haunter":["ghost","poison"],"gengar":["ghost","poison"],"onix":["rock","ground"],"drowzee":["psychic"],"hypno":["psychic"],"krabby":["water"],"kingler":["water"],"voltorb":["electric"],"electrode":["electric"],"exeggcute":["grass","psychic"],"exeggutor":["grass","psychic"],"cubone":["ground"],"marowak":["ground"],"hitmonlee":["fighting"],"hitmonchan":["fighting"],"lickitung":["normal"],"koffing":["poison"],"weezing":["poison"],"rhyhorn":["ground","rock"],"rhydon":["ground","rock"],"chansey":["normal"],"tangela":["grass"],"kangaskhan":["normal"],"horsea":["water"],"seadra":["water"],"goldeen":["water"],"seaking":["water"],"staryu":["water"],"starmie":["water","psychic"],"mr-mime":["psychic","fairy"],"scyther":["bug","flying"],"jynx":["ice","psychic"],"electabuzz":["electric"],"magmar":["fire"],"pinsir":["bug"],"tauros":["normal"],"magikarp":["water"],"gyarados":["water","flying"],"lapras":["water","ice"],"ditto":["normal"],"eevee":["normal"],"vaporeon":["water"],"jolteon":["electric"],"flareon":["fire"],"porygon":["normal"],"omanyte":["rock","water"],"omastar":["rock","water"],"kabuto":["rock","water"],"kabutops":["rock","water"],"aerodactyl":["rock","flying"],"snorlax":["normal"],"articuno":["ice","flying"],"zapdos":["electric","flying"],"moltres":["fire","flying"],"dratini":["dragon"],"dragonair":["dragon"],"dragonite":["dragon","flying"],"mewtwo":["psychic"],"mew":["psychic"],"chikorita":["grass"],"bayleef":["grass"],"meganium":["grass"],"cyndaquil":["fire"],"quilava":["fire"],"typhlosion":["fire"],"totodile":["water"],"croconaw":["water"],"feraligatr":["water"],"sentret":["normal"],"furret":["normal"],"hoothoot":["normal","flying"],"noctowl":["normal","flying"],"ledyba":["bug","flying"],"ledian":["bug","flying"],"spinarak":["bug","poison"],"ariados":["bug","poison"],"crobat":["poison","flying"],"chinchou":["water","electric"],"lanturn":["water","electric"],"pichu":["electric"],"cleffa":["fairy"],"igglybuff":["normal","fairy"],"togepi":["fairy"],"togetic":["fairy","flying"],"natu":["psychic","flying"],"xatu":["psychic","flying"],"mareep":["electric"],"flaaffy":["electric"],"ampharos":["electric"],"bellossom":["grass"],"marill":["water","fairy"],"azumarill":["water","fairy"],"sudowoodo":["rock"],"politoed":["water"],"hoppip":["grass","flying"],"skiploom":["grass","flying"],"jumpluff":["grass","flying"],"aipom":["normal"],"sunkern":["grass"],"sunflora":["grass"],"yanma":["bug","flying"],"wooper":["water","ground"],"quagsire":["water","ground"],"espeon":["psychic"],"umbreon":["dark"],"murkrow":["dark","flying"],"slowking":["water","psychic"],"misdreavus":["ghost"],"unown":["psychic"],"wobbuffet":["psychic"],"girafarig":["normal","psychic"],"pineco":["bug"],"forretress":["bug","steel"],"dunsparce":["normal"],"gligar":["ground","flying"],"steelix":["steel","ground"],"snubbull":["fairy"],"granbull":["fairy"],"qwilfish":["water","poison"],"scizor":["bug","steel"],"shuckle":["bug","rock"],"heracross":["bug","fighting"],"sneasel":["dark","ice"],"teddiursa":["normal"],"ursaring":["normal"],"slugma":["fire"],"magcargo":["fire","rock"],"swinub":["ice","ground"],"piloswine":["ice","ground"],"corsola":["water","rock"],"remoraid":["water"],"octillery":["water"],"delibird":["ice","flying"],"mantine":["water","flying"],"skarmory":["steel","flying"],"houndour":["dark","fire"],"houndoom":["dark","fire"],"kingdra":["water","dragon"],"phanpy":["ground"],"donphan":["ground"],"porygon2":["normal"],"stantler":["normal"],"smeargle":["normal"],"tyrogue":["fighting"],"hitmontop":["fighting"],"smoochum":["ice","psychic"],"elekid":["electric"],"magby":["fire"],"miltank":["normal"],"blissey":["normal"],"raikou":["electric"],"entei":["fire"],"suicune":["water"],"larvitar":["rock","ground"],"pupitar":["rock","ground"],"tyranitar":["rock","dark"],"lugia":["psychic","flying"],"ho-oh":["fire","flying"],"celebi":["psychic","grass"],"treecko":["grass"],"grovyle":["grass"],"sceptile":["grass"],"torchic":["fire"],"combusken":["fire","fighting"],"blaziken":["fire","fighting"],"mudkip":["water"],"marshtomp":["water","ground"],"swampert":["water","ground"],"poochyena":["dark"],"mightyena":["dark"],"zigzagoon":["normal"],"linoone":["normal"],"wurmple":["bug"],"silcoon":["bug"],"beautifly":["bug","flying"],"cascoon":["bug"],"dustox":["bug","poison"],"lotad":["water","grass"],"lombre":["water","grass"],"ludicolo":["water","grass"],"seedot":["grass"],"nuzleaf":["grass","dark"],"shiftry":["grass","dark"],"taillow":["normal","flying"],"swellow":["normal","flying"],"wingull":["water","flying"],"pelipper":["water","flying"],"ralts":["psychic","fairy"],"kirlia":["psychic","fairy"],"gardevoir":["psychic","fairy"],"surskit":["bug","water"],"masquerain":["bug","flying"],"shroomish":["grass"],"breloom":["grass","fighting"],"slakoth":["normal"],"vigoroth":["normal"],"slaking":["normal"],"nincada":["bug","ground"],"ninjask":["bug","flying"],"shedinja":["bug","ghost"],"whismur":["normal"],"loudred":["normal"],"exploud":["normal"],"makuhita":["fighting"],"hariyama":["fighting"],"azurill":["normal","fairy"],"nosepass":["rock"],"skitty":["normal"],"delcatty":["normal"],"sableye":["dark","ghost"],"mawile":["steel","fairy"],"aron":["steel","rock"],"lairon":["steel","rock"],"aggron":["steel","rock"],"meditite":["fighting","psychic"],"medicham":["fighting","psychic"],"electrike":["electric"],"manectric":["electric"],"plusle":["electric"],"minun":["electric"],"volbeat":["bug"],"illumise":["bug"],"roselia":["grass","poison"],"gulpin":["poison"],"swalot":["poison"],"carvanha":["water","dark"],"sharpedo":["water","dark"],"wailmer":["water"],"wailord":["water"],"numel":["fire","ground"],"camerupt":["fire","ground"],"torkoal":["fire"],"spoink":["psychic"],"grumpig":["psychic"],"spinda":["normal"],"trapinch":["ground"],"vibrava":["ground","dragon"],"flygon":["ground","dragon"],"cacnea":["grass"],"cacturne":["grass","dark"],"swablu":["normal","flying"],"altaria":["dragon","flying"],"zangoose":["normal"],"seviper":["poison"],"lunatone":["rock","psychic"],"solrock":["rock","psychic"],"barboach":["water","ground"],"whiscash":["water","ground"],"corphish":["water"],"crawdaunt":["water","dark"],"baltoy":["ground","psychic"],"claydol":["ground","psychic"],"lileep":["rock","grass"],"cradily":["rock","grass"],"anorith":["rock","bug"],"armaldo":["rock","bug"],"feebas":["water"],"milotic":["water"],"castform":["normal"],"kecleon":["normal"],"shuppet":["ghost"],"banette":["ghost"],"duskull":["ghost"],"dusclops":["ghost"],"tropius":["grass","flying"],"chimecho":["psychic"],"absol":["dark"],"wynaut":["psychic"],"snorunt":["ice"],"glalie":["ice"],"spheal":["ice","water"],"sealeo":["ice","water"],"walrein":["ice","water"],"clamperl":["water"],"huntail":["water"],"gorebyss":["water"],"relicanth":["water","rock"],"luvdisc":["water"],"bagon":["dragon"],"shelgon":["dragon"],"salamence":["dragon","flying"],"beldum":["steel","psychic"],"metang":["steel","psychic"],"metagross":["steel","psychic"],"regirock":["rock"],"regice":["ice"],"registeel":["steel"],"latias":["dragon","psychic"],"latios":["dragon","psychic"],"kyogre":["water"],"groudon":["ground"],"rayquaza":["dragon","flying"],"jirachi":["steel","psychic"],"deoxys-normal":["psychic"],"turtwig":["grass"],"grotle":["grass"],"torterra":["grass","ground"],"chimchar":["fire"],"monferno":["fire","fighting"],"infernape":["fire","fighting"],"piplup":["water"],"prinplup":["water"],"empoleon":["water","steel"],"starly":["normal","flying"],"staravia":["normal","flying"],"staraptor":["normal","flying"],"bidoof":["normal"],"bibarel":["normal","water"],"kricketot":["bug"],"kricketune":["bug"],"shinx":["electric"],"luxio":["electric"],"luxray":["electric"],"budew":["grass","poison"],"roserade":["grass","poison"],"cranidos":["rock"],"rampardos":["rock"],"shieldon":["rock","steel"],"bastiodon":["rock","steel"],"burmy":["bug"],"wormadam-plant":["bug","grass"],"mothim":["bug","flying"],"combee":["bug","flying"],"vespiquen":["bug","flying"],"pachirisu":["electric"],"buizel":["water"],"floatzel":["water"],"cherubi":["grass"],"cherrim":["grass"],"shellos":["water"],"gastrodon":["water","ground"],"ambipom":["normal"],"drifloon":["ghost","flying"],"drifblim":["ghost","flying"],"buneary":["normal"],"lopunny":["normal"],"mismagius":["ghost"],"honchkrow":["dark","flying"],"glameow":["normal"],"purugly":["normal"],"chingling":["psychic"],"stunky":["poison","dark"],"skuntank":["poison","dark"],"bronzor":["steel","psychic"],"bronzong":["steel","psychic"],"bonsly":["rock"],"mime-jr":["psychic","fairy"],"happiny":["normal"],"chatot":["normal","flying"],"spiritomb":["ghost","dark"],"gible":["dragon","ground"],"gabite":["dragon","ground"],"garchomp":["dragon","ground"],"munchlax":["normal"],"riolu":["fighting"],"lucario":["fighting","steel"],"hippopotas":["ground"],"hippowdon":["ground"],"skorupi":["poison","bug"],"drapion":["poison","dark"],"croagunk":["poison","fighting"],"toxicroak":["poison","fighting"],"carnivine":["grass"],"finneon":["water"],"lumineon":["water"],"mantyke":["water","flying"],"snover":["grass","ice"],"abomasnow":["grass","ice"],"weavile":["dark","ice"],"magnezone":["electric","steel"],"lickilicky":["normal"],"rhyperior":["ground","rock"],"tangrowth":["grass"],"electivire":["electric"],"magmortar":["fire"],"togekiss":["fairy","flying"],"yanmega":["bug","flying"],"leafeon":["grass"],"glaceon":["ice"],"gliscor":["ground","flying"],"mamoswine":["ice","ground"],"porygon-z":["normal"],"gallade":["psychic","fighting"],"probopass":["rock","steel"],"dusknoir":["ghost"],"froslass":["ice","ghost"],"rotom":["electric","ghost"],"uxie":["psychic"],"mesprit":["psychic"],"azelf":["psychic"],"dialga":["steel","dragon"],"palkia":["water","dragon"],"heatran":["fire","steel"],"regigigas":["normal"],"giratina-altered":["ghost","dragon"],"cresselia":["psychic"],"phione":["water"],"manaphy":["water"],"darkrai":["dark"],"shaymin-land":["grass"],"arceus":["normal"],"victini":["psychic","fire"],"snivy":["grass"],"servine":["grass"],"serperior":["grass"],"tepig":["fire"],"pignite":["fire","fighting"],"emboar":["fire","fighting"],"oshawott":["water"],"dewott":["water"],"samurott":["water"],"patrat":["normal"],"watchog":["normal"],"lillipup":["normal"],"herdier":["normal"],"stoutland":["normal"],"purrloin":["dark"],"liepard":["dark"],"pansage":["grass"],"simisage":["grass"],"pansear":["fire"],"simisear":["fire"],"panpour":["water"],"simipour":["water"],"munna":["psychic"],"musharna":["psychic"],"pidove":["normal","flying"],"tranquill":["normal","flying"],"unfezant":["normal","flying"],"blitzle":["electric"],"zebstrika":["electric"],"roggenrola":["rock"],"boldore":["rock"],"gigalith":["rock"],"woobat":["psychic","flying"],"swoobat":["psychic","flying"],"drilbur":["ground"],"excadrill":["ground","steel"],"audino":["normal"],"timburr":["fighting"],"gurdurr":["fighting"],"conkeldurr":["fighting"],"tympole":["water"],"palpitoad":["water","ground"],"seismitoad":["water","ground"],"throh":["fighting"],"sawk":["fighting"],"sewaddle":["bug","grass"],"swadloon":["bug","grass"],"leavanny":["bug","grass"],"venipede":["bug","poison"],"whirlipede":["bug","poison"],"scolipede":["bug","poison"],"cottonee":["grass","fairy"],"whimsicott":["grass","fairy"],"petilil":["grass"],"lilligant":["grass"],"basculin-red-striped":["water"],"sandile":["ground","dark"],"krokorok":["ground","dark"],"krookodile":["ground","dark"],"darumaka":["fire"],"darmanitan-standard":["fire"],"maractus":["grass"],"dwebble":["bug","rock"],"crustle":["bug","rock"],"scraggy":["dark","fighting"],"scrafty":["dark","fighting"],"sigilyph":["psychic","flying"],"yamask":["ghost"],"cofagrigus":["ghost"],"tirtouga":["water","rock"],"carracosta":["water","rock"],"archen":["rock","flying"],"archeops":["rock","flying"],"trubbish":["poison"],"garbodor":["poison"],"zorua":["dark"],"zoroark":["dark"],"minccino":["normal"],"cinccino":["normal"],"gothita":["psychic"],"gothorita":["psychic"],"gothitelle":["psychic"],"solosis":["psychic"],"duosion":["psychic"],"reuniclus":["psychic"],"ducklett":["water","flying"],"swanna":["water","flying"],"vanillite":["ice"],"vanillish":["ice"],"vanilluxe":["ice"],"deerling":["normal","grass"],"sawsbuck":["normal","grass"],"emolga":["electric","flying"],"karrablast":["bug"],"escavalier":["bug","steel"],"foongus":["grass","poison"],"amoonguss":["grass","poison"],"frillish-male":["water","ghost"],"jellicent-male":["water","ghost"],"alomomola":["water"],"joltik":["bug","electric"],"galvantula":["bug","electric"],"ferroseed":["grass","steel"],"ferrothorn":["grass","steel"],"klink":["steel"],"klang":["steel"],"klinklang":["steel"],"tynamo":["electric"],"eelektrik":["electric"],"eelektross":["electric"],"elgyem":["psychic"],"beheeyem":["psychic"],"litwick":["ghost","fire"],"lampent":["ghost","fire"],"chandelure":["ghost","fire"],"axew":["dragon"],"fraxure":["dragon"],"haxorus":["dragon"],"cubchoo":["ice"],"beartic":["ice"],"cryogonal":["ice"],"shelmet":["bug"],"accelgor":["bug"],"stunfisk":["ground","electric"],"mienfoo":["fighting"],"mienshao":["fighting"],"druddigon":["dragon"],"golett":["ground","ghost"],"golurk":["ground","ghost"],"pawniard":["dark","steel"],"bisharp":["dark","steel"],"bouffalant":["normal"],"rufflet":["normal","flying"],"braviary":["normal","flying"],"vullaby":["dark","flying"],"mandibuzz":["dark","flying"],"heatmor":["fire"],"durant":["bug","steel"],"deino":["dark","dragon"],"zweilous":["dark","dragon"],"hydreigon":["dark","dragon"],"larvesta":["bug","fire"],"volcarona":["bug","fire"],"cobalion":["steel","fighting"],"terrakion":["rock","fighting"],"virizion":["grass","fighting"],"tornadus-incarnate":["flying"],"thundurus-incarnate":["electric","flying"],"reshiram":["dragon","fire"],"zekrom":["dragon","electric"],"landorus-incarnate":["ground","flying"],"kyurem":["dragon","ice"],"keldeo-ordinary":["water","fighting"],"meloetta-aria":["normal","psychic"],"genesect":["bug","steel"],"chespin":["grass"],"quilladin":["grass"],"chesnaught":["grass","fighting"],"fennekin":["fire"],"braixen":["fire"],"delphox":["fire","psychic"],"froakie":["water"],"frogadier":["water"],"greninja":["water","dark"],"bunnelby":["normal"],"diggersby":["normal","ground"],"fletchling":["normal","flying"],"fletchinder":["fire","flying"],"talonflame":["fire","flying"],"scatterbug":["bug"],"spewpa":["bug"],"vivillon":["bug","flying"],"litleo":["fire","normal"],"pyroar-male":["fire","normal"],"flabebe":["fairy"],"floette":["fairy"],"florges":["fairy"],"skiddo":["grass"],"gogoat":["grass"],"pancham":["fighting"],"pangoro":["fighting","dark"],"furfrou":["normal"],"espurr":["psychic"],"meowstic-male":["psychic"],"honedge":["steel","ghost"],"doublade":["steel","ghost"],"aegislash-shield":["steel","ghost"],"spritzee":["fairy"],"aromatisse":["fairy"],"swirlix":["fairy"],"slurpuff":["fairy"],"inkay":["dark","psychic"],"malamar":["dark","psychic"],"binacle":["rock","water"],"barbaracle":["rock","water"],"skrelp":["poison","water"],"dragalge":["poison","dragon"],"clauncher":["water"],"clawitzer":["water"],"helioptile":["electric","normal"],"heliolisk":["electric","normal"],"tyrunt":["rock","dragon"],"tyrantrum":["rock","dragon"],"amaura":["rock","ice"],"aurorus":["rock","ice"],"sylveon":["fairy"],"hawlucha":["fighting","flying"],"dedenne":["electric","fairy"],"carbink":["rock","fairy"],"goomy":["dragon"],"sliggoo":["dragon"],"goodra":["dragon"],"klefki":["steel","fairy"],"phantump":["ghost","grass"],"trevenant":["ghost","grass"],"pumpkaboo-average":["ghost","grass"],"gourgeist-average":["ghost","grass"],"bergmite":["ice"],"avalugg":["ice"],"noibat":["flying","dragon"],"noivern":["flying","dragon"],"xerneas":["fairy"],"yveltal":["dark","flying"],"zygarde-50":["dragon","ground"],"diancie":["rock","fairy"],"hoopa":["psychic","ghost"],"volcanion":["fire","water"],"rowlet":["grass","flying"],"dartrix":["grass","flying"],"decidueye":["grass","ghost"],"litten":["fire"],"torracat":["fire"],"incineroar":["fire","dark"],"popplio":["water"],"brionne":["water"],"primarina":["water","fairy"],"pikipek":["normal","flying"],"trumbeak":["normal","flying"],"toucannon":["normal","flying"],"yungoos":["normal"],"gumshoos":["normal"],"grubbin":["bug"],"charjabug":["bug","electric"],"vikavolt":["bug","electric"],"crabrawler":["fighting"],"crabominable":["fighting","ice"],"oricorio-baile":["fire","flying"],"cutiefly":["bug","fairy"],"ribombee":["bug","fairy"],"rockruff":["rock"],"lycanroc-midday":["rock"],"wishiwashi-solo":["water"],"mareanie":["poison","water"],"toxapex":["poison","water"],"mudbray":["ground"],"mudsdale":["ground"],"dewpider":["water","bug"],"araquanid":["water","bug"],"fomantis":["grass"],"lurantis":["grass"],"morelull":["grass","fairy"],"shiinotic":["grass","fairy"],"salandit":["poison","fire"],"salazzle":["poison","fire"],"stufful":["normal","fighting"],"bewear":["normal","fighting"],"bounsweet":["grass"],"steenee":["grass"],"tsareena":["grass"],"comfey":["fairy"],"oranguru":["normal","psychic"],"passimian":["fighting"],"wimpod":["bug","water"],"golisopod":["bug","water"],"sandygast":["ghost","ground"],"palossand":["ghost","ground"],"pyukumuku":["water"],"type-null":["normal"],"silvally":["normal"],"minior-red-meteor":["rock","flying"],"komala":["normal"],"turtonator":["fire","dragon"],"togedemaru":["electric","steel"],"mimikyu-disguised":["ghost","fairy"],"bruxish":["water","psychic"],"drampa":["normal","dragon"],"dhelmise":["ghost","grass"],"jangmo-o":["dragon"],"hakamo-o":["dragon","fighting"],"kommo-o":["dragon","fighting"],"tapu-koko":["electric","fairy"],"tapu-lele":["psychic","fairy"],"tapu-bulu":["grass","fairy"],"tapu-fini":["water","fairy"],"cosmog":["psychic"],"cosmoem":["psychic"],"solgaleo":["psychic","steel"],"lunala":["psychic","ghost"],"nihilego":["rock","poison"],"buzzwole":["bug","fighting"],"pheromosa":["bug","fighting"],"xurkitree":["electric"],"celesteela":["steel","flying"],"kartana":["grass","steel"],"guzzlord":["dark","dragon"],"necrozma":["psychic"],"magearna":["steel","fairy"],"marshadow":["fighting","ghost"],"poipole":["poison"],"naganadel":["poison","dragon"],"stakataka":["rock","steel"],"blacephalon":["fire","ghost"],"zeraora":["electric"],"meltan":["steel"],"melmetal":["steel"],"grookey":["grass"],"thwackey":["grass"],"rillaboom":["grass"],"scorbunny":["fire"],"raboot":["fire"],"cinderace":["fire"],"sobble":["water"],"drizzile":["water"],"inteleon":["water"],"skwovet":["normal"],"greedent":["normal"],"rookidee":["flying"],"corvisquire":["flying"],"corviknight":["flying","steel"],"blipbug":["bug"],"dottler":["bug","psychic"],"orbeetle":["bug","psychic"],"nickit":["dark"],"thievul":["dark"],"gossifleur":["grass"],"eldegoss":["grass"],"wooloo":["normal"],"dubwool":["normal"],"chewtle":["water"],"drednaw":["water","rock"],"yamper":["electric"],"boltund":["electric"],"rolycoly":["rock"],"carkol":["rock","fire"],"coalossal":["rock","fire"],"applin":["grass","dragon"],"flapple":["grass","dragon"],"appletun":["grass","dragon"],"silicobra":["ground"],"sandaconda":["ground"],"cramorant":["flying","water"],"arrokuda":["water"],"barraskewda":["water"],"toxel":["electric","poison"],"toxtricity-amped":["electric","poison"],"sizzlipede":["fire","bug"],"centiskorch":["fire","bug"],"clobbopus":["fighting"],"grapploct":["fighting"],"sinistea":["ghost"],"polteageist":["ghost"],"hatenna":["psychic"],"hattrem":["psychic"],"hatterene":["psychic","fairy"],"impidimp":["dark","fairy"],"morgrem":["dark","fairy"],"grimmsnarl":["dark","fairy"],"obstagoon":["dark","normal"],"perrserker":["steel"],"cursola":["ghost"],"sirfetchd":["fighting"],"mr-rime":["ice","psychic"],"runerigus":["ground","ghost"],"milcery":["fairy"],"alcremie":["fairy"],"falinks":["fighting"],"pincurchin":["electric"],"snom":["ice","bug"],"frosmoth":["ice","bug"],"stonjourner":["rock"],"eiscue-ice":["ice"],"indeedee-male":["psychic","normal"],"morpeko-full-belly":["electric","dark"],"cufant":["steel"],"copperajah":["steel"],"dracozolt":["electric","dragon"],"arctozolt":["electric","ice"],"dracovish":["water","dragon"],"arctovish":["water","ice"],"duraludon":["steel","dragon"],"dreepy":["dragon","ghost"],"drakloak":["dragon","ghost"],"dragapult":["dragon","ghost"],"zacian":["fairy"],"zamazenta":["fighting"],"eternatus":["poison","dragon"],"kubfu":["fighting"],"urshifu-single-strike":["fighting","dark"],"zarude":["dark","grass"],"regieleki":["electric"],"regidrago":["dragon"],"glastrier":["ice"],"spectrier":["ghost"],"calyrex":["psychic","grass"],"wyrdeer":["normal","psychic"],"kleavor":["bug","rock"],"ursaluna":["ground","normal"],"basculegion-male":["water","ghost"],"sneasler":["fighting","poison"],"overqwil":["dark","poison"],"enamorus-incarnate":["fairy","flying"],"sprigatito":["grass"],"floragato":["grass"],"meowscarada":["grass","dark"],"fuecoco":["fire"],"crocalor":["fire"],"skeledirge":["fire","ghost"],"quaxly":["water"],"quaxwell":["water"],"quaquaval":["water","fighting"],"lechonk":["normal"],"oinkologne-male":["normal"],"tarountula":["bug"],"spidops":["bug"],"nymble":["bug"],"lokix":["bug","dark"],"pawmi":["electric"],"pawmo":["electric","fighting"],"pawmot":["electric","fighting"],"tandemaus":["normal"],"maushold-family-of-four":["normal"],"fidough":["fairy"],"dachsbun":["fairy"],"smoliv":["grass","normal"],"dolliv":["grass","normal"],"arboliva":["grass","normal"],"squawkabilly-green-plumage":["normal","flying"],"nacli":["rock"],"naclstack":["rock"],"garganacl":["rock"],"charcadet":["fire"],"armarouge":["fire","psychic"],"ceruledge":["fire","ghost"],"tadbulb":["electric"],"bellibolt":["electric"],"wattrel":["electric","flying"],"kilowattrel":["electric","flying"],"maschiff":["dark"],"mabosstiff":["dark"],"shroodle":["poison","normal"],"grafaiai":["poison","normal"],"bramblin":["grass","ghost"],"brambleghast":["grass","ghost"],"toedscool":["ground","grass"],"toedscruel":["ground","grass"],"klawf":["rock"],"capsakid":["grass"],"scovillain":["grass","fire"],"rellor":["bug"],"rabsca":["bug","psychic"],"flittle":["psychic"],"espathra":["psychic"],"tinkatink":["fairy","steel"],"tinkatuff":["fairy","steel"],"tinkaton":["fairy","steel"],"wiglett":["water"],"wugtrio":["water"],"bombirdier":["flying","dark"],"finizen":["water"],"palafin-zero":["water"],"varoom":["steel","poison"],"revavroom":["steel","poison"],"cyclizar":["dragon","normal"],"orthworm":["steel"],"glimmet":["rock","poison"],"glimmora":["rock","poison"],"greavard":["ghost"],"houndstone":["ghost"],"flamigo":["flying","fighting"],"cetoddle":["ice"],"cetitan":["ice"],"veluza":["water","psychic"],"dondozo":["water"],"tatsugiri-curly":["dragon","water"],"annihilape":["fighting","ghost"],"clodsire":["poison","ground"],"farigiraf":["normal","psychic"],"dudunsparce-two-segment":["normal"],"kingambit":["dark","steel"],"great-tusk":["ground","fighting"],"scream-tail":["fairy","psychic"],"brute-bonnet":["grass","dark"],"flutter-mane":["ghost","fairy"],"slither-wing":["bug","fighting"],"sandy-shocks":["electric","ground"],"iron-treads":["ground","steel"],"iron-bundle":["ice","water"],"iron-hands":["fighting","electric"],"iron-jugulis":["dark","flying"],"iron-moth":["fire","poison"],"iron-thorns":["rock","electric"],"frigibax":["dragon","ice"],"arctibax":["dragon","ice"],"baxcalibur":["dragon","ice"],"gimmighoul":["ghost"],"gholdengo":["steel","ghost"],"wo-chien":["dark","grass"],"chien-pao":["dark","ice"],"ting-lu":["dark","ground"],"chi-yu":["dark","fire"],"roaring-moon":["dragon","dark"],"iron-valiant":["fairy","fighting"],"koraidon":["fighting","dragon"],"miraidon":["electric","dragon"],"walking-wake":["water","dragon"],"iron-leaves":["grass","psychic"],"dipplin":["grass","dragon"],"poltchageist":["grass","ghost"],"sinistcha":["grass","ghost"],"okidogi":["poison","fighting"],"munkidori":["poison","psychic"],"fezandipiti":["poison","fairy"],"ogerpon":["grass"],"archaludon":["steel","dragon"],"hydrapple":["grass","dragon"],"gouging-fire":["fire","dragon"],"raging-bolt":["electric","dragon"],"iron-boulder":["rock","psychic"],"iron-crown":["steel","psychic"],"terapagos":["normal"],"pecharunt":["poison","ghost"],"deoxys-attack":["psychic"],"deoxys-defense":["psychic"],"deoxys-speed":["psychic"],"wormadam-sandy":["bug","ground"],"wormadam-trash":["bug","steel"],"shaymin-sky":["grass","flying"],"giratina-origin":["ghost","dragon"],"rotom-heat":["electric","fire"],"rotom-wash":["electric","water"],"rotom-frost":["electric","ice"],"rotom-fan":["electric","flying"],"rotom-mow":["electric","grass"],"castform-sunny":["fire"],"castform-rainy":["water"],"castform-snowy":["ice"],"basculin-blue-striped":["water"],"darmanitan-zen":["fire","psychic"],"meloetta-pirouette":["normal","fighting"],"tornadus-therian":["flying"],"thundurus-therian":["electric","flying"],"landorus-therian":["ground","flying"],"kyurem-black":["dragon","ice"],"kyurem-white":["dragon","ice"],"keldeo-resolute":["water","fighting"],"meowstic-female":["psychic"],"aegislash-blade":["steel","ghost"],"pumpkaboo-small":["ghost","grass"],"pumpkaboo-large":["ghost","grass"],"pumpkaboo-super":["ghost","grass"],"gourgeist-small":["ghost","grass"],"gourgeist-large":["ghost","grass"],"gourgeist-super":["ghost","grass"],"venusaur-mega":["grass","poison"],"charizard-mega-x":["fire","dragon"],"charizard-mega-y":["fire","flying"],"blastoise-mega":["water"],"alakazam-mega":["psychic"],"gengar-mega":["ghost","poison"],"kangaskhan-mega":["normal"],"pinsir-mega":["bug","flying"],"gyarados-mega":["water","dark"],"aerodactyl-mega":["rock","flying"],"mewtwo-mega-x":["psychic","fighting"],"mewtwo-mega-y":["psychic"],"ampharos-mega":["electric","dragon"],"scizor-mega":["bug","steel"],"heracross-mega":["bug","fighting"],"houndoom-mega":["dark","fire"],"tyranitar-mega":["rock","dark"],"blaziken-mega":["fire","fighting"],"gardevoir-mega":["psychic","fairy"],"mawile-mega":["steel","fairy"],"aggron-mega":["steel"],"medicham-mega":["fighting","psychic"],"manectric-mega":["electric"],"banette-mega":["ghost"],"absol-mega":["dark"],"garchomp-mega":["dragon","ground"],"lucario-mega":["fighting","steel"],"abomasnow-mega":["grass","ice"],"floette-eternal":["fairy"],"latias-mega":["dragon","psychic"],"latios-mega":["dragon","psychic"],"swampert-mega":["water","ground"],"sceptile-mega":["grass","dragon"],"sableye-mega":["dark","ghost"],"altaria-mega":["dragon","fairy"],"gallade-mega":["psychic","fighting"],"audino-mega":["normal","fairy"],"sharpedo-mega":["water","dark"],"slowbro-mega":["water","psychic"],"steelix-mega":["steel","ground"],"pidgeot-mega":["normal","flying"],"glalie-mega":["ice"],"diancie-mega":["rock","fairy"],"metagross-mega":["steel","psychic"],"kyogre-primal":["water"],"groudon-primal":["ground","fire"],"rayquaza-mega":["dragon","flying"],"pikachu-rock-star":["electric"],"pikachu-belle":["electric"],"pikachu-pop-star":["electric"],"pikachu-phd":["electric"],"pikachu-libre":["electric"],"pikachu-cosplay":["electric"],"hoopa-unbound":["psychic","dark"],"camerupt-mega":["fire","ground"],"lopunny-mega":["normal","fighting"],"salamence-mega":["dragon","flying"],"beedrill-mega":["bug","poison"],"rattata-alola":["dark","normal"],"raticate-alola":["dark","normal"],"raticate-totem-alola":["dark","normal"],"pikachu-original-cap":["electric"],"pikachu-hoenn-cap":["electric"],"pikachu-sinnoh-cap":["electric"],"pikachu-unova-cap":["electric"],"pikachu-kalos-cap":["electric"],"pikachu-alola-cap":["electric"],"raichu-alola":["electric","psychic"],"sandshrew-alola":["ice","steel"],"sandslash-alola":["ice","steel"],"vulpix-alola":["ice"],"ninetales-alola":["ice","fairy"],"diglett-alola":["ground","steel"],"dugtrio-alola":["ground","steel"],"meowth-alola":["dark"],"persian-alola":["dark"],"geodude-alola":["rock","electric"],"graveler-alola":["rock","electric"],"golem-alola":["rock","electric"],"grimer-alola":["poison","dark"],"muk-alola":["poison","dark"],"exeggutor-alola":["grass","dragon"],"marowak-alola":["fire","ghost"],"greninja-battle-bond":["water","dark"],"greninja-ash":["water","dark"],"zygarde-10-power-construct":["dragon","ground"],"zygarde-50-power-construct":["dragon","ground"],"zygarde-complete":["dragon","ground"],"gumshoos-totem":["normal"],"vikavolt-totem":["bug","electric"],"oricorio-pom-pom":["electric","flying"],"oricorio-pau":["psychic","flying"],"oricorio-sensu":["ghost","flying"],"lycanroc-midnight":["rock"],"wishiwashi-school":["water"],"lurantis-totem":["grass"],"salazzle-totem":["poison","fire"],"minior-orange-meteor":["rock","flying"],"minior-yellow-meteor":["rock","flying"],"minior-green-meteor":["rock","flying"],"minior-blue-meteor":["rock","flying"],"minior-indigo-meteor":["rock","flying"],"minior-violet-meteor":["rock","flying"],"minior-red":["rock","flying"],"minior-orange":["rock","flying"],"minior-yellow":["rock","flying"],"minior-green":["rock","flying"],"minior-blue":["rock","flying"],"minior-indigo":["rock","flying"],"minior-violet":["rock","flying"],"mimikyu-busted":["ghost","fairy"],"mimikyu-totem-disguised":["ghost","fairy"],"mimikyu-totem-busted":["ghost","fairy"],"kommo-o-totem":["dragon","fighting"],"magearna-original":["steel","fairy"],"pikachu-partner-cap":["electric"],"marowak-totem":["fire","ghost"],"ribombee-totem":["bug","fairy"],"rockruff-own-tempo":["rock"],"lycanroc-dusk":["rock"],"araquanid-totem":["water","bug"],"togedemaru-totem":["electric","steel"],"necrozma-dusk":["psychic","steel"],"necrozma-dawn":["psychic","ghost"],"necrozma-ultra":["psychic","dragon"],"pikachu-starter":["electric"],"eevee-starter":["normal"],"pikachu-world-cap":["electric"],"meowth-galar":["steel"],"ponyta-galar":["psychic"],"rapidash-galar":["psychic","fairy"],"slowpoke-galar":["psychic"],"slowbro-galar":["poison","psychic"],"farfetchd-galar":["fighting"],"weezing-galar":["poison","fairy"],"mr-mime-galar":["ice","psychic"],"articuno-galar":["psychic","flying"],"zapdos-galar":["fighting","flying"],"moltres-galar":["dark","flying"],"slowking-galar":["poison","psychic"],"corsola-galar":["ghost"],"zigzagoon-galar":["dark","normal"],"linoone-galar":["dark","normal"],"darumaka-galar":["ice"],"darmanitan-galar-standard":["ice"],"darmanitan-galar-zen":["ice","fire"],"yamask-galar":["ground","ghost"],"stunfisk-galar":["ground","steel"],"zygarde-10":["dragon","ground"],"cramorant-gulping":["flying","water"],"cramorant-gorging":["flying","water"],"toxtricity-low-key":["electric","poison"],"eiscue-noice":["ice"],"indeedee-female":["psychic","normal"],"morpeko-hangry":["electric","dark"],"zacian-crowned":["fairy","steel"],"zamazenta-crowned":["fighting","steel"],"eternatus-eternamax":["poison","dragon"],"urshifu-rapid-strike":["fighting","water"],"zarude-dada":["dark","grass"],"calyrex-ice":["psychic","ice"],"calyrex-shadow":["psychic","ghost"],"venusaur-gmax":["grass","poison"],"charizard-gmax":["fire","flying"],"blastoise-gmax":["water"],"butterfree-gmax":["bug","flying"],"pikachu-gmax":["electric"],"meowth-gmax":["normal"],"machamp-gmax":["fighting"],"gengar-gmax":["ghost","poison"],"kingler-gmax":["water"],"lapras-gmax":["water","ice"],"eevee-gmax":["normal"],"snorlax-gmax":["normal"],"garbodor-gmax":["poison"],"melmetal-gmax":["steel"],"rillaboom-gmax":["grass"],"cinderace-gmax":["fire"],"inteleon-gmax":["water"],"corviknight-gmax":["flying","steel"],"orbeetle-gmax":["bug","psychic"],"drednaw-gmax":["water","rock"],"coalossal-gmax":["rock","fire"],"flapple-gmax":["grass","dragon"],"appletun-gmax":["grass","dragon"],"sandaconda-gmax":["ground"],"toxtricity-amped-gmax":["electric","poison"],"centiskorch-gmax":["fire","bug"],"hatterene-gmax":["psychic","fairy"],"grimmsnarl-gmax":["dark","fairy"],"alcremie-gmax":["fairy"],"copperajah-gmax":["steel"],"duraludon-gmax":["steel","dragon"],"urshifu-single-strike-gmax":["fighting","dark"],"urshifu-rapid-strike-gmax":["fighting","water"],"toxtricity-low-key-gmax":["electric","poison"],"growlithe-hisui":["fire","rock"],"arcanine-hisui":["fire","rock"],"voltorb-hisui":["electric","grass"],"electrode-hisui":["electric","grass"],"typhlosion-hisui":["fire","ghost"],"qwilfish-hisui":["dark","poison"],"sneasel-hisui":["fighting","poison"],"samurott-hisui":["water","dark"],"lilligant-hisui":["grass","fighting"],"zorua-hisui":["normal","ghost"],"zoroark-hisui":["normal","ghost"],"braviary-hisui":["psychic","flying"],"sliggoo-hisui":["steel","dragon"],"goodra-hisui":["steel","dragon"],"avalugg-hisui":["ice","rock"],"decidueye-hisui":["grass","fighting"],"dialga-origin":["steel","dragon"],"palkia-origin":["water","dragon"],"basculin-white-striped":["water"],"basculegion-female":["water","ghost"],"enamorus-therian":["fairy","flying"],"tauros-paldea-combat-breed":["fighting"],"tauros-paldea-blaze-breed":["fighting","fire"],"tauros-paldea-aqua-breed":["fighting","water"],"wooper-paldea":["poison","ground"],"oinkologne-female":["normal"],"dudunsparce-three-segment":["normal"],"palafin-hero":["water"],"maushold-family-of-three":["normal"],"tatsugiri-droopy":["dragon","water"],"tatsugiri-stretchy":["dragon","water"],"squawkabilly-blue-plumage":["normal","flying"],"squawkabilly-yellow-plumage":["normal","flying"],"squawkabilly-white-plumage":["normal","flying"],"gimmighoul-roaming":["ghost"],"koraidon-limited-build":["fighting","dragon"],"koraidon-sprinting-build":["fighting","dragon"],"koraidon-swimming-build":["fighting","dragon"],"koraidon-gliding-build":["fighting","dragon"],"miraidon-low-power-mode":["electric","dragon"],"miraidon-drive-mode":["electric","dragon"],"miraidon-aquatic-mode":["electric","dragon"],"miraidon-glide-mode":["electric","dragon"],"ursaluna-bloodmoon":["ground","normal"],"ogerpon-wellspring-mask":["grass","water"],"ogerpon-hearthflame-mask":["grass","fire"],"ogerpon-cornerstone-mask":["grass","rock"],"terapagos-terastal":["normal"],"terapagos-stellar":["normal"],"clefable-mega":["fairy","flying"],"victreebel-mega":["grass","poison"],"starmie-mega":["water","psychic"],"dragonite-mega":["dragon","flying"],"meganium-mega":["grass","fairy"],"feraligatr-mega":["water","dragon"],"skarmory-mega":["steel","flying"],"froslass-mega":["ice","ghost"],"emboar-mega":["fire","fighting"],"excadrill-mega":["ground","steel"],"scolipede-mega":["bug","poison"],"scrafty-mega":["dark","fighting"],"eelektross-mega":["electric"],"chandelure-mega":["ghost","fire"],"chesnaught-mega":["grass","fighting"],"delphox-mega":["fire","psychic"],"greninja-mega":["water","dark"],"pyroar-mega":["fire","normal"],"floette-mega":["fairy"],"malamar-mega":["dark","psychic"],"barbaracle-mega":["rock","fighting"],"dragalge-mega":["poison","dragon"],"hawlucha-mega":["fighting","flying"],"zygarde-mega":["dragon","ground"],"drampa-mega":["normal","dragon"],"falinks-mega":["fighting"],"raichu-mega-x":["electric"],"raichu-mega-y":["electric"],"chimecho-mega":["psychic","steel"],"absol-mega-z":["dark","ghost"],"staraptor-mega":["fighting","flying"],"garchomp-mega-z":["dragon"],"lucario-mega-z":["fighting","steel"],"heatran-mega":["fire","steel"],"darkrai-mega":["dark"],"golurk-mega":["ground","ghost"],"meowstic-male-mega":["psychic"],"crabominable-mega":["fighting","ice"],"golisopod-mega":["bug","steel"],"magearna-mega":["steel","fairy"],"magearna-original-mega":["steel","fairy"],"zeraora-mega":["electric"],"scovillain-mega":["grass","fire"],"glimmora-mega":["rock","poison"],"tatsugiri-curly-mega":["dragon","water"],"tatsugiri-droopy-mega":["dragon","water"],"tatsugiri-stretchy-mega":["dragon","water"],"baxcalibur-mega":["dragon","ice"],"meowstic-female-mega":["psychic"]};

// A handful of common alternate spellings (abbreviated formes, Showdown
// shorthand, etc.) that don't match the table's key directly.
const TYPE_CANONICAL_FALLBACK={
  'cinccino':['normal'],
  'dachsbun':['fairy'],
  'meowstic':['psychic'],
  'tauros-paldeablaze':['fighting','fire'],
  'tauros-paldeacombat':['fighting'],
  // Incarnate formes are displayed by the shared naming service as their
  // Free Agency/base roster names. Keep their type data attached to those
  // canonical names so the badges survive the normalization.
  'landorus':['ground','flying'],
  'tornadus':['flying'],
  'thundurus':['electric','flying'],
  'enamorus':['fairy','flying']
};

const TYPE_ALIASES={
  'landorus-incarnate':'landorus',
  'landorus-t':'landorus-therian',
  'tornadus-incarnate':'tornadus',
  'tornadus-t':'tornadus-therian',
  'thundurus-incarnate':'thundurus',
  'thundurus-t':'thundurus-therian',
  'enamorus-incarnate':'enamorus',
  'enamorus-t':'enamorus-therian',
  'hoopa-u':'hoopa-unbound',
  'urshifu-r':'urshifu-rapid-strike',
  'urshifu-s':'urshifu-single-strike',
  'necrozma-dusk-mane':'necrozma-dusk',
  'necrozma-dawn-wings':'necrozma-dawn',
  'necrozma-dm':'necrozma-dusk',
  'necrozma-dw':'necrozma-dawn',
  'calyrex-ice-rider':'calyrex-ice',
  'calyrex-shadow-rider':'calyrex-shadow',
  'giratina-o':'giratina-origin',
  'meowstic-f':'meowstic-female',
  'meowstic-m':'meowstic-male',
  'meowstic':'meowstic-male',
  'terapagos':'terapagos','terapogos':'terapagos','teraagos':'terapagos','terapagos-middle':'terapagos',
  'tauros-paldeablaze':'tauros-paldea-blaze-breed',
  'tauros-paldeacombat':'tauros-paldea-combat-breed',
  'tauros-blaze':'tauros-paldea-blaze-breed',
  'tauros-combat':'tauros-paldea-combat-breed',
  'taurus-blaze':'tauros-paldea-blaze-breed',
  'taurus-combat':'tauros-paldea-combat-breed',
  'cinccino':'cinccino',
  'dachsbun':'dachsbun',
  'daschbun':'dachsbun',
  'cincinno':'cinccino','cinccinno':'cinccino',
  'indeedee-f':'indeedee-female',
  'basculegion-f':'basculegion-female',
  'oinkologne-f':'oinkologne-female',
  'zygarde-10':'zygarde-10-power-construct',
  'zygarde-50':'zygarde-50-power-construct',
  'ogerpon-wellspring':'ogerpon-wellspring-mask',
  'ogerpon-hearthflame':'ogerpon-hearthflame-mask',
  'ogerpon-cornerstone':'ogerpon-cornerstone-mask',
  'mime-jr':'mime-jr',
  'mr-mime-galar':'mr-mime-galar',
  'darmanitan-galar':'darmanitan-galar-standard',
  'aegislash':'aegislash-shield',
  'wishiwashi':'wishiwashi-solo',
  'minior':'minior-red-meteor',
  'eiscue':'eiscue-ice',
  'morpeko':'morpeko-full-belly',
  'toxtricity':'toxtricity-amped',
  'mimikyu':'mimikyu-disguised',
  'cramorant':'cramorant',
  'zacian':'zacian',
  'zamazenta':'zamazenta'
};

// Look up a mon's types synchronously. Tries the full normalized name, then
// known aliases, then progressively shorter prefixes (dropping one trailing
// hyphen-segment at a time) so any forme not explicitly listed above still
// resolves to its base species' typing rather than coming up empty.
function lookupTypes(name){
  const normalized=SBL?.pokemon?.normalizeName ? SBL.pokemon.normalizeName(name) : key(name);
  const k=key(normalized);
  if(TYPE_TABLE[k]) return TYPE_TABLE[k];
  if(TYPE_CANONICAL_FALLBACK[k]) return TYPE_CANONICAL_FALLBACK[k];
  if(TYPE_ALIASES[k] && TYPE_TABLE[TYPE_ALIASES[k]]) return TYPE_TABLE[TYPE_ALIASES[k]];
  let parts=k.split('-');
  while(parts.length>1){
    parts=parts.slice(0,-1);
    const candidate=parts.join('-');
    if(TYPE_TABLE[candidate]) return TYPE_TABLE[candidate];
    if(TYPE_ALIASES[candidate] && TYPE_TABLE[TYPE_ALIASES[candidate]]) return TYPE_TABLE[TYPE_ALIASES[candidate]];
  }
  return [];
}

function typeBadge(t){
  return `<span class="mon-type-badge type-${t}">${esc(t)}</span>`;
}

function openSelection(mon){
  const types=lookupTypes(mon.name);
  const modal=document.createElement('div');
  modal.className='modal';
  modal.innerHTML=`<div class="modalbox">
    <h2>${esc((SBL.pokemon.displayNameWithForm ? SBL.pokemon.displayNameWithForm(mon.name) : SBL.pokemon.displayName(mon.name)))}</h2>
    <div class="note">${mon.points} points · ${owner(mon.name)?'Drafted':'Available'}</div>
    <div class="modal-types">${types.map(typeBadge).join('')||''}</div>
    <p class="note">${owner(mon.name)?`Drafted by <strong>${esc(owner(mon.name))}</strong>.`:'This Pokémon is available — it does not appear on any currently published roster.'}</p>
    <div class="actions"><button class="btn" id="modalClose">Close</button></div>
  </div>`;
  document.body.appendChild(modal);
  document.body.classList.add('modal-open');
  const close=()=>{modal.remove();document.body.classList.remove('modal-open');document.removeEventListener('keydown',onKey);};
  const onKey=e=>{if(e.key==='Escape') close();};
  modal.querySelector('#modalClose').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close();};
  document.addEventListener('keydown',onKey);
}

let lastDataSignature=null;

async function load(){
  const result=await SBL.freeAgency.load(db);
  settings=result.settings||settings;
  allRosters=result.rosters||{};
  const mons=result.pool||[];

  // Skip the (expensive, focus-stealing) re-render on the periodic 5s poll
  // unless the pool or rosters actually changed since last time.
  const signature=JSON.stringify({mons,allRosters});
  const changed=signature!==lastDataSignature;
  lastDataSignature=signature;
  if(changed) render();
}

function dexKey(name){
  return SBL.pokemon.toShowdownId(name).replace(/[^a-z0-9-]/g,'');
}
function getDexEntry(name){
  const k=dexKey(name);
  if(dexData.pokedex[k]) return dexData.pokedex[k];
  const compact=k.replace(/-/g,'');
  if(dexData.pokedex[compact]) return dexData.pokedex[compact];
  const base=k.split('-')[0];
  return dexData.pokedex[base]||null;
}
function getLearnset(name){
  const k=dexKey(name);
  return dexData.learnsets[k]?.learnset || dexData.learnsets[k] || {};
}
const filterMemo=new Map();
function hasMove(name, needle){
  if(!needle) return true;
  const mk='m|'+key(name)+'|'+key(needle); if(filterMemo.has(mk)) return filterMemo.get(mk);
  const q=key(needle).replace(/-/g,'');
  if(!q) return true;
  const ls=getLearnset(name);
  const out=Object.keys(ls).some(m=>m.replace(/-/g,'').includes(q)); filterMemo.set(mk,out); return out;
}
function hasAbility(name, needle){
  if(!needle) return true;
  const mk='a|'+key(name)+'|'+key(needle); if(filterMemo.has(mk)) return filterMemo.get(mk);
  const q=String(needle).trim().toLowerCase();
  const e=getDexEntry(name);
  const out=Object.values(e?.abilities||{}).some(a=>String(a).toLowerCase().includes(q)); filterMemo.set(mk,out); return out;
}
function meetsStat(name, stat, min){
  if(!stat || min==='') return true;
  const mk='s|'+key(name)+'|'+stat+'|'+min; if(filterMemo.has(mk)) return filterMemo.get(mk);
  const e=getDexEntry(name), v=Number(e?.baseStats?.[stat]);
  const out=Number.isFinite(v) && v>=Number(min); filterMemo.set(mk,out); return out;
}
async function loadDexData(){
  if(dexData.loaded) return;
  try{
    const [p,l]=await Promise.all([
      fetch('https://play.pokemonshowdown.com/data/pokedex.json').then(r=>r.json()),
      fetch('https://play.pokemonshowdown.com/data/learnsets.json').then(r=>r.json())
    ]);
    dexData={pokedex:p,learnsets:l,loaded:true};
    render();
  }catch(err){
    console.warn('Pokémon filter data failed to load:',err);
    dexData.loaded=true;
  }
}
function scheduleFilterRender(){
  clearTimeout(filterRenderTimer);
  filterRenderTimer=setTimeout(()=>{ if(!document.hidden) renderResults(); },120);
}

function applyFilters(mons){
  return mons.filter(m=>{
    // name
    if(filterName && !String(m.name).toLowerCase().includes(filterName)) return false;
    // points
    if(filterPoints!=='' && String(Number(m.points))!==filterPoints) return false;
    // availability
    const taken=!!owner(m.name);
    if(filterAvail==='available' && taken) return false;
    if(filterAvail==='taken' && !taken) return false;
    if(filterMove && !hasMove(m.name,filterMove)) return false;
    if(filterAbility && !hasAbility(m.name,filterAbility)) return false;
    if(!meetsStat(m.name,filterStat,filterStatMin)) return false;
    if(filterTypes.size>0){
      const types=lookupTypes(m.name);
      if(!types.some(t=>filterTypes.has(t))) return false;
    }
    return true;
  });
}

function renderResults(){
  const allMons=Array.isArray(settings.freeAgency?.mons)?settings.freeAgency.mons:[];
  const visible=applyFilters(allMons);

  let free=0,taken=0;
  visible.forEach(m=>owner(m.name)?taken++:free++);

  const groups={};
  visible.forEach(m=>{const p=Number(m.points)||0;(groups[p]??=[]).push(m);});
  const tiers=Object.keys(groups).sort((a,b)=>Number(b)-Number(a));

  const results=$('results');
  if(!results) return;

  const activeFilters=(filterName?1:0)+(filterTypes.size>0?1:0)+(filterPoints!==''?1:0)+(filterAvail!=='all'?1:0)+(filterMove?1:0)+(filterAbility?1:0)+(filterStat?1:0)+(filterStatMin!==''?1:0);

  results.innerHTML=`
    <div class="summary">
      <div class="stat"><div class="note">Showing</div><b>${visible.length}</b></div>
      <div class="stat"><div class="note">Available</div><b>${free}</b></div>
      <div class="stat"><div class="note">Taken</div><b>${taken}</b></div>
      <div class="stat"><div class="note">Total pool</div><b>${allMons.length}</b></div>
      ${activeFilters?`<button class="clear-filters" id="clearFilters">Clear filters (${activeFilters})</button>`:''}
    </div>
    ${tiers.length ? tiers.map(p=>{
      const label=Number(p)===1?'1 POINT':`${p} POINTS`;
      return `<section class="tier">
        <div class="tier-head"><h2>${label}</h2><span class="note">${groups[p].length} shown</span></div>
        <div class="grid">${groups[p].map(m=>{
          const o=owner(m.name), types=lookupTypes(m.name);
          return `<article class="mon ${o?'taken':''}" data-name="${esc(m.name)}">
            ${sprite(m.name)}
            <div class="mon-name">${esc((SBL.pokemon.displayNameWithForm ? SBL.pokemon.displayNameWithForm(m.name) : SBL.pokemon.displayName(m.name)))}</div>
            <div class="mon-points">${m.points} pts</div>
            <div class="mon-types">${types.map(typeBadge).join('')}</div>
            <div class="mon-status ${o?'taken-status':'available'}">${o?'Drafted by '+esc(o):'Available'}</div>
          </article>`;
        }).join('')}</div>
      </section>`;
    }).join('') : `<div class="empty">${allMons.length?'No Pokémon match your filters.':'No Free Agency pool has been published yet.'}</div>`}`;

  const clearBtn=$('clearFilters');
  if(clearBtn) clearBtn.onclick=()=>{
    filterName='';filterTypes.clear();filterPoints='';filterAvail='all';filterMove='';filterAbility='';filterStat='';filterStatMin='';
    syncFilterControls();
    renderResults();
  };

  results.querySelectorAll('.mon').forEach(el=>el.onclick=()=>{
    const m=allMons.find(x=>key(x.name)===key(el.dataset.name));
    if(m) openSelection(m);
  });
}

function syncFilterControls(){
  const vals={
    searchName:filterName, filterMove, filterAbility, filterStatMin
  };
  Object.entries(vals).forEach(([id,val])=>{
    const el=$(id); if(el && document.activeElement!==el && el.value!==val) el.value=val;
  });
  const points=$('filterPoints');
  if(points){
    const allMons=Array.isArray(settings.freeAgency?.mons)?settings.freeAgency.mons:[];
    const pointValues=[...new Set(allMons.map(m=>Number(m.points)).filter(Number.isFinite))].sort((a,b)=>b-a);
    const wanted=filterPoints;
    points.innerHTML='<option value="">All point values</option>'+pointValues.map(p=>`<option value="${p}">${p} pts</option>`).join('');
    points.value=pointValues.some(p=>String(p)===wanted)?wanted:'';
    if(points.value!==wanted) filterPoints='';
  }
  const stat=$('filterStat'); if(stat && stat.value!==filterStat) stat.value=filterStat;
  document.querySelectorAll('[data-avail]').forEach(btn=>btn.classList.toggle('active',btn.dataset.avail===filterAvail));
  document.querySelectorAll('[data-type]').forEach(chip=>chip.classList.toggle('active',filterTypes.has(chip.dataset.type)));
}

function render(){
  const allMons=Array.isArray(settings.freeAgency?.mons)?settings.freeAgency.mons:[];
  if($('results') && $('searchName') && $('filterMove') && $('filterAbility')){
    renderResults();
    syncFilterControls();
    return;
  }

  const pointValues=[...new Set(allMons.map(m=>Number(m.points)||0))].sort((a,b)=>b-a);

  $('main').innerHTML=`
    <div class="toolbar">
      <div class="toolbar-wide"><label>Search by name</label><input type="text" id="searchName" value="${esc(filterName)}" placeholder="e.g. Landorus, Cinderace…" autocomplete="off"></div>
      <div class="points-filter"><label for="filterPoints">Points</label><select class="filter-select" id="filterPoints"><option value="">All point values</option>${pointValues.map(p=>`<option value="${p}" ${filterPoints===String(p)?'selected':''}>${p} pts</option>`).join('')}</select></div>
      <div><label>Availability</label><div class="avail-toggle"><button class="avail-btn ${filterAvail==='all'?'active':''}" data-avail="all">All</button><button class="avail-btn ${filterAvail==='available'?'active':''}" data-avail="available">Available</button><button class="avail-btn ${filterAvail==='taken'?'active':''}" data-avail="taken">Taken</button></div></div>
      <div class="toolbar-wide"><label>Move</label><input type="text" id="filterMove" value="${esc(filterMove)}" placeholder="e.g. Earthquake, Knock Off…" autocomplete="off"></div>
      <div class="toolbar-wide"><label>Ability</label><input type="text" id="filterAbility" value="${esc(filterAbility)}" placeholder="e.g. Intimidate, Levitate…" autocomplete="off"></div>
      <div><label>Base stat</label><select class="filter-select" id="filterStat"><option value=""> </option>${[['hp','HP'],['atk','Attack'],['def','Defense'],['spa','Sp. Atk'],['spd','Sp. Def'],['spe','Speed']].map(([v,n])=>`<option value="${v}" ${filterStat===v?'selected':''}>${n}</option>`).join('')}</select></div>
      <div><label>Minimum</label><input type="number" id="filterStatMin" min="1" max="255" value="${esc(filterStatMin)}" placeholder="e.g. 120"></div>
    </div>
    <div class="type-filter-wrap"><label>Filter by type</label><div class="type-chips">${ALL_TYPES.map(t=>`<span class="type-chip type-${t}${filterTypes.has(t)?' active':''}" data-type="${t}">${t}</span>`).join('')}</div></div>
    <div id="results"></div>`;

  const schedule=()=>scheduleFilterRender();
  $('searchName').oninput=e=>{filterName=e.target.value.toLowerCase();schedule();};
  $('filterMove').oninput=e=>{filterMove=e.target.value;schedule();};
  $('filterAbility').oninput=e=>{filterAbility=e.target.value;schedule();};
  $('filterStatMin').oninput=e=>{filterStatMin=e.target.value;schedule();};
  $('filterPoints').onchange=e=>{filterPoints=e.target.value;renderResults();syncFilterControls();};
  $('filterStat').onchange=e=>{filterStat=e.target.value;renderResults();syncFilterControls();};

  document.querySelectorAll('[data-avail]').forEach(btn=>btn.onclick=()=>{filterAvail=btn.dataset.avail;renderResults();syncFilterControls();});
  document.querySelectorAll('[data-type]').forEach(chip=>chip.onclick=()=>{
    const t=chip.dataset.type;
    filterTypes.has(t)?filterTypes.delete(t):filterTypes.add(t);
    renderResults();syncFilterControls();
  });

  renderResults();
}

(async()=>{
  const ok = await enforceAccessGate();
  if(!ok) return;
  loadDexData();
  load().catch(e=>$("main").innerHTML=`<div class="empty">Could not load Free Agency: ${esc(String(e?.message||e))}</div>`);
  setInterval(()=>{if(!document.hidden)load().catch(()=>{});},5000);
})();
})();
