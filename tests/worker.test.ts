import test from "node:test";
import assert from "node:assert/strict";
import {parseJob,category,WorkerService} from "../server/src/modules/worker";
import {parseWorkspace} from "../server/src/modules/worker/policy";
const w=parseWorkspace({dimension:"overworld",spawn:{x:-80,y:117,z:416},margin:16,base:{x:960,y:201,z:960},owned:[{min:{x:950,y:200,z:950},max:{x:982,y:207,z:982}}],containers:{}});
test("worker rejects infinite deadlines, retries, invalid item and searches crossing ownership",()=>{for(const a of [{deadlineMs:Infinity},{deadlineMs:3600001},{attempts:0},{attempts:4},{cycles:0},{radius:17},{item:"../bad"},{origin:{x:951,y:201,z:951}}])assert.throws(()=>parseJob({mode:"miner",...a},w));assert.equal(parseJob({mode:"miner",count:64},w).attempts,1);});
test("warehouse assignments classify distinct materials without claiming unrelated items",()=>{for(const [item,c] of Object.entries({oak_log:"WOOD",cobblestone:"STONE",raw_iron:"ORES",wheat_seeds:"FOOD",iron_pickaxe:"TOOLS"}))assert.equal(category(item),c);assert.equal(category("nether_star"),undefined);});
test("worker cannot start with no trusted workspace",()=>{const instance:any={config:{id:"workspace-required-unit"}};const worker=new WorkerService(instance);assert.throws(()=>worker.enqueue({mode:"miner"}),/trusted/);});

test("armor replaces exhausted equipment with usable existing armor",async()=>{const {equipUsableArmor}=await import("../server/src/modules/worker/equipment");const worn={type:1,name:"iron_chestplate",durabilityUsed:99},spare={type:1,name:"iron_chestplate",durabilityUsed:2};const slots:any[]=Array(46).fill(null);slots[6]=worn;let equipped:any;const bot:any={currentWindow:null,registry:{items:{1:{maxDurability:100}}},supportFeature:()=>false,inventory:{slots,items:()=>[worn,spare]},equip:async(i:any,d:string)=>{equipped={i,d};slots[6]=i;}};await equipUsableArmor(bot);assert.equal(equipped.i,spare);assert.equal(equipped.d,"torso");});
