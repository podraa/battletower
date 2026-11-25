/* CP4.176 account-owned Match Prep workspace configuration. */
(function(){
  'use strict';
  const SBL=window.SBL=window.SBL||{};
  const TOOLS=['overview','threats','planner','typechart','coverage','switch','speed','matches','notebook','checklist','findings','gameplan'];
  const VALID=new Set(TOOLS);
  const PAGES=[{id:'overview',title:'Overview'},{id:'scouting',title:'Scouting'},
    {id:'analysis',title:'Analysis'},{id:'prep',title:'My Prep'}];
  const VALID_PAGES=new Set(PAGES.map(p=>p.id));
  const PAGE_DEFAULT={overview:'overview',threats:'scouting',planner:'analysis',typechart:'analysis',
    coverage:'analysis',switch:'analysis',speed:'analysis',matches:'scouting',
    notebook:'prep',checklist:'prep',findings:'prep',gameplan:'prep'};
  const pageFor=id=>PAGE_DEFAULT[id]||'overview';
  const PRESETS={
    standard:['overview','threats','planner','typechart','coverage','switch','speed','matches','notebook','checklist','findings','gameplan'],
    quick:['overview','speed','switch','notebook'],
    scouting:['overview','threats','matches','notebook','findings','checklist'],
    planning:['overview','planner','typechart','coverage','speed','switch','gameplan','checklist'],
    empty:['overview']
  };
  function defaultWidth(id){return ['typechart','coverage','notebook','checklist','findings','gameplan'].includes(id)?'half':'full';}
  function preset(name){return {version:2,widgets:(PRESETS[name]||PRESETS.standard).map(id=>({id,width:defaultWidth(id),page:pageFor(id)}))};}
  function clean(value){
    const hasWidgets=Array.isArray(value?.widgets);
    const raw=hasWidgets?value.widgets:[];
    const seen=new Set(),widgets=[];
    for(const item of raw){
      if(!VALID.has(item?.id)||seen.has(item.id))continue;
      seen.add(item.id);
      widgets.push({id:item.id,width:item.width==='half'?'half':'full',page:VALID_PAGES.has(item.page)?item.page:pageFor(item.id)});
    }
    return {version:2,widgets:hasWidgets?widgets:preset('standard').widgets};
  }
  async function identity(){
    const db=SBL.getSupabase();
    const {data,error}=await db.auth.getUser();
    if(error)throw error;
    if(!data?.user)throw new Error('Sign in to save your Match Prep layout.');
    return {db,userId:data.user.id};
  }
  function localKey(userId){return 'battle_tower_prep_layout_v1:'+userId;}
  function readLocal(userId){
    try{const raw=localStorage.getItem(localKey(userId));return raw?clean(JSON.parse(raw)):null;}catch(_){return null;}
  }
  function saveLocal(userId,value){try{localStorage.setItem(localKey(userId),JSON.stringify(clean(value)));}catch(_){} }
  async function load(){
    const {db,userId}=await identity();
    const local=readLocal(userId);
    const {data,error}=await db.from('match_prep_layouts').select('layout,updated_at').eq('user_id',userId).maybeSingle();
    if(error){if(local)return {...local,localOnly:true,userId};throw error;}
    const value=data?clean(data.layout):(local||preset('standard'));
    if(data)saveLocal(userId,value);
    return {...value,userId};
  }
  async function save(value){
    const {db,userId}=await identity();
    const layout=clean(value);
    saveLocal(userId,layout);
    const {error}=await db.from('match_prep_layouts').upsert({user_id:userId,layout},{onConflict:'user_id'});
    if(error)throw error;
    return layout;
  }
  SBL.prepLayouts={TOOLS,PRESETS,PAGES,PAGE_DEFAULT,pageFor,defaultWidth,preset,clean,load,save,readLocal};
})();
