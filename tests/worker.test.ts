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
  assert.equal(tasks.listenerCount('queueCleared'),0);worker.enqueue({mode:'return'});tasks.cancelAll('Bot died; task cancelled');assert.equal(worker.snapshot().state,'INTERRUPTED');assert.match(worker.snapshot().reason,/Bot died/);
  const {EventEmitter}=require('node:events'),{Vec3}=require('vec3'),{attachWorkspace}=require('./server/src/modules/worker/policy.ts');
  const bot=new EventEmitter();bot.entity={position:new Vec3(960,201,960),velocity:new Vec3(0,0,0)};bot.entities={1:{name:'creeper',position:new Vec3(963.5,201,960)}};
  let stopped=false,cancelReason='';const guarded={status:'online',runtime:{dimension:'overworld'},tasks:{cancelAll:r=>cancelReason=r},stop:()=>stopped=true};attachWorkspace(guarded,bot);bot.emit('physicsTick');assert.equal(stopped,true);assert.match(cancelReason,/CREEPER_PROXIMITY/);bot.heldItem={name:'water_bucket'};assert.throws(()=>bot.activateItem(),/liquid use/);
 `],{cwd:process.cwd(),env:{...process.env,CAYA_DATA_DIR:dir,CAYA_WORKSPACE_FILE:config},encoding:"utf8",timeout:10000});assert.equal(result.status,0,result.stderr+result.stdout);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("mining replaces faster exhausted tool with slower usable harvest tool",async()=>{const {equipUsableTool}=await import("../server/src/modules/worker/equipment");const worn={type:1,name:"iron_pickaxe",slot:9,durabilityUsed:249},spare={type:2,name:"wooden_pickaxe",slot:10,durabilityUsed:2};let selected:any;const bot:any={heldItem:worn,registry:{items:{1:{maxDurability:250},2:{maxDurability:59}}},inventory:{items:()=>[worn,spare]},tool:{getDigTime:(_:any,i:any)=>i?.type===1?10:i?.type===2?30:100},equip:async(i:any)=>{selected=i;}};await equipUsableTool(bot,{name:"stone",canHarvest:(type:any)=>type===1||type===2});assert.equal(selected,spare);});
