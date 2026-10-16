import test from "node:test";
import assert from "node:assert/strict";
import { parseJob, category, WorkerService } from "../server/src/modules/worker";
import { parseWorkspace } from "../server/src/modules/worker/policy";
const w = parseWorkspace({ dimension: "overworld", spawn: { x: -80, y: 117, z: 416 }, margin: 16, base: { x: 960, y: 201, z: 960 }, owned: [{ min: { x: 950, y: 200, z: 950 }, max: { x: 982, y: 207, z: 982 } }], containers: {} });
test("worker rejects infinite deadlines, retries, invalid item and searches crossing ownership", () => { for (const a of [{ deadlineMs: Infinity }, { deadlineMs: 7200001 }, { attempts: 0 }, { attempts: 4 }, { cycles: 0 }, { radius: 17 }, { item: "../bad" }, { origin: { x: 951, y: 201, z: 951 } }])
    assert.throws(() => parseJob({ mode: "miner", ...a }, w)); assert.equal(parseJob({ mode: "miner", count: 64 }, w).attempts, 1); });
test("warehouse assignments classify distinct materials without claiming unrelated items", () => { for (const [item, c] of Object.entries({ oak_log: "WOOD", cobblestone: "STONE", raw_iron: "ORES", wheat_seeds: "FOOD", iron_pickaxe: "TOOLS" }))
    assert.equal(category(item), c); assert.equal(category("nether_star"), undefined); });
test("worker cannot start with no trusted workspace", () => { const instance: any = { config: { id: "workspace-required-unit" } }; const worker = new WorkerService(instance); assert.throws(() => worker.enqueue({ mode: "miner" }), /trusted/); });
test("armor replaces exhausted equipment with usable existing armor", async () => { const { equipUsableArmor } = await import("../server/src/modules/worker/equipment"); const worn = { type: 1, name: "iron_chestplate", durabilityUsed: 99 }, spare = { type: 1, name: "iron_chestplate", durabilityUsed: 2 }; const slots: any[] = Array(46).fill(null); slots[6] = worn; let equipped: any; const bot: any = { currentWindow: null, registry: { items: { 1: { maxDurability: 100 } } }, supportFeature: () => false, inventory: { slots, items: () => [worn, spare] }, equip: async (i: any, d: string) => { equipped = { i, d }; slots[6] = i; } }; await equipUsableArmor(bot); assert.equal(equipped.i, spare); assert.equal(equipped.d, "torso"); });

test("cancelled queued worker persists interruption and permits explicit resubmission",async()=>{
 const fs=await import("node:fs"),os=await import("node:os"),path=await import("node:path"),cp=await import("node:child_process");const dir=fs.mkdtempSync(path.join(os.tmpdir(),"caya-worker-unit-"));
 try{const config=path.join(dir,"workspace.json");fs.writeFileSync(config,JSON.stringify({...w,dimension:"overworld"}));const result=cp.spawnSync(process.execPath,["--import","tsx","-e",`
  const assert=require('node:assert/strict');const {TaskQueue}=require('./server/src/core/TaskQueue.ts');const {WorkerService}=require('./server/src/modules/worker/index.ts');
  const tasks=new TaskQueue();tasks.enqueue({type:'blocker',label:'blocker',priority:50,params:{},requeueOnPreempt:false},()=>token=>new Promise(resolve=>token.abort.signal.addEventListener('abort',()=>resolve())));tasks.pause();const instance={config:{id:'queued',combat:{defendMode:'mob'}},tasks};const worker=new WorkerService(instance);
  const task=worker.enqueue({mode:'return'});assert.equal(worker.snapshot().state,'QUEUED');tasks.cancel(task.id,'user cancel');assert.equal(worker.snapshot().state,'INTERRUPTED');
  assert.equal(tasks.listenerCount('queueCleared'),0);worker.enqueue({mode:'return'});tasks.cancelAll('Bot died; task cancelled');assert.equal(worker.snapshot().state,'INTERRUPTED');assert.match(worker.snapshot().reason,/Bot died/);const {SurvivalService}=require('./server/src/modules/survival/index.ts');const survival=new SurvivalService(instance);assert.throws(()=>survival.enqueueHunt(),/animal hunting/);assert.throws(()=>survival.enqueueAcquireFood(),/pantry/);
  const {EventEmitter}=require('node:events'),{Vec3}=require('vec3'),{attachWorkspace}=require('./server/src/modules/worker/policy.ts');
  const bot=new EventEmitter();bot.entity={position:new Vec3(960,201,960),velocity:new Vec3(0,0,0)};bot.entities={1:{name:'creeper',position:new Vec3(963.5,201,960)}};
  let stopped=false,cancelReason='';const guarded={status:'online',runtime:{dimension:'overworld'},tasks:{cancelAll:r=>cancelReason=r},stop:()=>stopped=true};attachWorkspace(guarded,bot);bot.emit('physicsTick');assert.equal(stopped,true);assert.match(cancelReason,/CREEPER_PROXIMITY/);stopped=false;bot.emit('entityDead',bot.entities[1]);bot.emit('physicsTick');assert.equal(stopped,false);
  const activeJob={state:'RUNNING',interruptionReason:''};guarded.worker={snapshot:()=>activeJob,interrupt:r=>activeJob.interruptionReason=r};let invalidated=false;guarded.invalidateControl=()=>invalidated=true;bot.players={visitor:{username:'Visitor',entity:{position:new Vec3(965,201,960)}}};bot.emit('physicsTick');assert.match(cancelReason,/OWNERSHIP/);assert.equal(invalidated,true);delete bot.players.visitor;
  bot.heldItem={name:'water_bucket'};assert.throws(()=>bot.activateItem(),/liquid use/);
 `],{cwd:process.cwd(),env:{...process.env,CAYA_DATA_DIR:dir,CAYA_WORKSPACE_FILE:config},encoding:"utf8",timeout:10000});assert.equal(result.status,0,result.stderr+result.stdout);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("mining replaces faster exhausted tool with slower usable harvest tool",async()=>{const {equipUsableTool}=await import("../server/src/modules/worker/equipment");const worn={type:1,name:"iron_pickaxe",slot:9,durabilityUsed:249},spare={type:2,name:"wooden_pickaxe",slot:10,durabilityUsed:2};let selected:any;const bot:any={heldItem:worn,registry:{items:{1:{maxDurability:250},2:{maxDurability:59}}},inventory:{items:()=>[worn,spare]},tool:{getDigTime:(_:any,i:any)=>i?.type===1?10:i?.type===2?30:100},equip:async(i:any)=>{selected=i;}};await equipUsableTool(bot,{name:"stone",canHarvest:(type:any)=>type===1||type===2});assert.equal(selected,spare);});

test("worker search cannot span a protected structure hidden between valid corners",()=>{const protectedSpace=parseWorkspace({...w,dimension:"overworld",protected:[{min:{x:961,y:200,z:960},max:{x:961,y:202,z:960}}]});assert.throws(()=>parseJob({mode:"miner",origin:{x:960,y:201,z:960},radius:4},protectedSpace),/protected holes/);});

test("malformed and nonfinite worker origins fail before coordinate iteration",()=>{for(const origin of ["bad",{}, {x:Infinity,y:201,z:960},{x:NaN,y:201,z:960}])assert.throws(()=>parseJob({mode:"miner",origin},w));});


test("recipe selection accounts for assigned stock rather than arbitrary wood variant order",async()=>{
 const {recipeDeficit}=await import("../server/src/modules/worker");
 const names:Record<number,string>={1:"poplar_planks",2:"oak_planks",3:"stick"};
 const recipes=[{kind:"poplar",delta:[{id:1,count:-3},{id:3,count:-2}]},{kind:"oak",delta:[{id:2,count:-3},{id:3,count:-2}]}];
 const stock:Record<string,number>={oak_planks:64,stick:64};
 recipes.sort((a,b)=>recipeDeficit(a,id=>names[id],n=>stock[n]??0)-recipeDeficit(b,id=>names[id],n=>stock[n]??0));
 assert.equal(recipes[0].kind,"oak");
 assert.equal(recipeDeficit(recipes[1],id=>names[id],n=>stock[n]??0),3);
});


test("worker deadline includes time blocked in queue",async()=>{
 const fs=await import("node:fs"),os=await import("node:os"),path=await import("node:path"),cp=await import("node:child_process");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"caya-worker-deadline-"));
 try{
  const config=path.join(dir,"workspace.json");fs.writeFileSync(config,JSON.stringify({...w,dimension:"overworld"}));
  const result=cp.spawnSync(process.execPath,["--import","tsx","-e",`
   (async()=>{const assert=require('node:assert/strict'),{TaskQueue}=require('./server/src/core/TaskQueue.ts'),{WorkerService}=require('./server/src/modules/worker/index.ts');
   const tasks=new TaskQueue();tasks.enqueue({type:'blocker',label:'blocker',priority:50,params:{},requeueOnPreempt:false},()=>token=>new Promise(resolve=>token.abort.signal.addEventListener('abort',resolve)));tasks.pause();
   const worker=new WorkerService({config:{id:'deadline',combat:{defendMode:'mob'}},tasks});worker.enqueue({mode:'return',deadlineMs:1000});
   await new Promise(r=>setTimeout(r,1150));assert.equal(worker.snapshot().state,'INTERRUPTED');assert.match(worker.snapshot().reason,/DEADLINE/);assert.equal(tasks.queueSummaries.length,0);tasks.cancelAll('cleanup');
   })().catch(e=>{console.error(e);process.exitCode=1});
  `],{cwd:process.cwd(),env:{...process.env,CAYA_DATA_DIR:dir,CAYA_WORKSPACE_FILE:config},encoding:"utf8",timeout:10000});
  assert.equal(result.status,0,result.stderr+result.stdout);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test("worker forwards real child progress across child counter resets",async()=>{
 const {workerProgress}=await import("../server/src/modules/worker");const updates:any[]=[];const report=workerProgress(p=>updates.push(p));
 for(const done of [0,1,0,1,2,2,3])report({done,total:64,label:"mining"});
 assert.deepEqual(updates.map(p=>p.done),[0,1,1,2,3,3,4]);
});


test("synthetic workspace protects its supporting deck while allowing surface work",async()=>{
 const {owned}=await import("../server/src/modules/worker/policy");
 const fixture=parseWorkspace({dimension:"overworld",spawn:{x:0,y:70,z:0},margin:16,base:{x:0,y:70,z:0},owned:[{min:{x:-10,y:69,z:-10},max:{x:10,y:75,z:10}}],protected:[{min:{x:-10,y:69,z:-10},max:{x:10,y:69,z:10}}],containers:{}});
 assert.equal(owned(fixture,{x:1,y:69,z:1}),false);
 assert.equal(owned(fixture,{x:1,y:70,z:1}),true);
});




test("worker routes cannot cut the blocked side of a diagonal glass corner",async()=>{
 const {guardWorkerCorners}=await import("../server/src/modules/movement/corners");
 let blocked=true;const moves:any={getBlock:(_:unknown,x:number,y:number,z:number)=>({physical:blocked&&x===0&&z===-1&&y===0,safe:true}),getMoveDiagonal:(_:unknown,__:unknown,out:any[])=>out.push("diagonal")};
 guardWorkerCorners(moves);const neighbors:any[]=[];moves.getMoveDiagonal({}, {x:1,z:-1},neighbors);assert.deepEqual(neighbors,[]);
 blocked=false;moves.getMoveDiagonal({}, {x:1,z:-1},neighbors);assert.deepEqual(neighbors,["diagonal"]);
});


test("finite mining travel tolerates observed block approach drift without broadening resource search",async()=>{
 const {inWorkArea,inGatherTravelArea}=await import("../server/src/modules/gather/targets");
 const origin={x:975,y:201,z:960},target={x:970,y:201,z:958},observedFeet={x:969.4092864222439,y:201,z:957.6792227299444};
 assert.equal(inWorkArea(target,origin,6),true);
 assert.equal(inWorkArea(observedFeet,origin,6),false);
 assert.equal(inGatherTravelArea(observedFeet,origin,6),true);
 assert.equal(inGatherTravelArea({x:967,y:201,z:956},origin,6),false);
});


test("warehouse raw oak logs plan reserves pickaxe planks while making sticks",async()=>{
 const {planSupply}=await import("../server/src/modules/worker/planning");
 const data=require("minecraft-data")("26.3"),Recipe=require("prismarine-recipe")(data).Recipe;
 const recipes=(n:string)=>Recipe.find(data.itemsByName[n].id,null).filter((r:any)=>r.delta.some((d:any)=>d.count<0));
 const name=(id:number)=>data.items[id].name;
 const steps=planSupply("wooden_pickaxe",1,{}, {oak_log:2},recipes,name);
 const bag:Record<string,number>={},stock:Record<string,number>={oak_log:2};
 for(const step of steps){
  if(!step.recipe){assert.ok(stock[step.item]>=step.count);stock[step.item]-=step.count;bag[step.item]=(bag[step.item]??0)+step.count;}
  else for(const d of step.recipe.delta){const n=name(d.id);bag[n]=(bag[n]??0)+d.count*step.count;assert.ok(bag[n]>=0,`overcommitted ${n}`);}
 }
 assert.equal(bag.wooden_pickaxe,1);assert.equal(stock.oak_log,0);assert.equal(bag.oak_planks,3);assert.equal(bag.stick,2);
 assert.throws(()=>planSupply("wooden_pickaxe",1,{}, {oak_log:1},recipes,name),/MISSING_MATERIAL/);
 assert.throws(()=>planSupply("diamond_pickaxe",1,{}, {oak_log:2},recipes,name),/MISSING_MATERIAL/);
});


test("worker allows spectator observation but guards nearby interactive players",async()=>{
 const {nearbyWorkerVisitor}=await import("../server/src/modules/worker/policy");
 const {Vec3}=require("vec3");const bot:any={username:"Worker",entity:{position:new Vec3(0,201,0)},players:{owner:{username:"Owner",gamemode:3,entity:{position:new Vec3(1,201,0)}}}};
 assert.equal(nearbyWorkerVisitor(bot),false);
 for(const mode of [0,1,2,undefined]){bot.players.owner.gamemode=mode;assert.equal(nearbyWorkerVisitor(bot),true);}
 bot.players.owner.entity.position=new Vec3(25,201,0);assert.equal(nearbyWorkerVisitor(bot),false);
});


test("assigned harvest ignores mature neighboring crops",async()=>{
 const {matchesHarvestCrop}=await import("../server/src/modules/farm/crops");
 const block=(name:string,age:number)=>({name,getProperties:()=>({age})}) as any;
 assert.equal(matchesHarvestCrop(block("wheat",7),"carrots"),false);
 assert.equal(matchesHarvestCrop(block("carrots",0),"carrots"),false);
 assert.equal(matchesHarvestCrop(block("carrots",7),"carrots"),true);
 assert.equal(matchesHarvestCrop(block("wheat",7)),true);
});

test("worker excludes warehouse seed provision from same-item crop production",async()=>{
 const fs=await import("node:fs"),os=await import("node:os"),path=await import("node:path"),cp=await import("node:child_process");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"caya-crop-unit-"));
 try{const config=path.join(dir,"workspace.json");fs.writeFileSync(config,JSON.stringify({...w,dimension:"overworld",containers:{FOOD:{x:960,y:201,z:960}}}));
 const result=cp.spawnSync(process.execPath,["--import","tsx","-e",`
 (async()=>{
 const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
 const movementPath=require.resolve('./server/src/modules/movement/index.ts');const movement=require(movementPath);require.cache[movementPath].exports={...movement,runGoto:async()=>{}};
 const chestPath=require.resolve('./server/src/modules/inventory/chestOps.ts');const chest={...require(chestPath)};require.cache[chestPath].exports=chest;let carrots=0,stock=8;
 chest.readChestStock=async()=>({carrot:stock});chest.withdrawFromChest=async(_,spec)=>{assert.equal(spec.item,'carrot');carrots+=spec.count;stock-=spec.count;};
 chest.depositToChest=async()=>{const n=Math.max(0,carrots-4);stock+=n;carrots-=n;return {moved:[],movedTotal:n,left:[]};};
 const {TaskQueue}=require('./server/src/core/TaskQueue.ts'),{WorkerService}=require('./server/src/modules/worker/index.ts');
 const bot=new EventEmitter();Object.assign(bot,{username:'Worker',health:20,food:20,players:{},entity:{position:new Vec3(960,201,960)},registry:{itemsByName:{carrot:{id:1}},items:{1:{name:'carrot'}}},inventory:{items:()=>[{name:'bread',count:4},...(carrots?[{name:'carrot',count:carrots}]:[])]}});
 let crop;const instance={bot,status:'online',config:{id:'crop',combat:{defendMode:'mob'},survival:{foodBlacklist:[]},inventory:{bannedItems:[]}},tasks:new TaskQueue(),combat:{equipBestWeapon:async()=>{}},farm:{runHarvest:async o=>{crop=o.assignedCrop;return 'No mature crops';}}};
 const worker=new WorkerService(instance);worker.enqueue({mode:'farmer',item:'carrot',radius:1});
 const end=Date.now()+2000;while(['RUNNING','QUEUED'].includes(worker.snapshot().state)&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
 assert.equal(worker.snapshot().state,'DONE',worker.snapshot().reason);assert.equal(crop,'carrots');assert.equal(worker.snapshot().produced,0);assert.equal(carrots+stock,8);
 })().catch(e=>{console.error(e);process.exitCode=1});
 `],{cwd:process.cwd(),env:{...process.env,CAYA_DATA_DIR:dir,CAYA_WORKSPACE_FILE:config},encoding:"utf8",timeout:10000});assert.equal(result.status,0,result.stderr+result.stdout);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
