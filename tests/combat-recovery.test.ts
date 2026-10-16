import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Vec3 } from "vec3";
import { CombatService } from "../server/src/modules/combat";
import { TaskQueue } from "../server/src/core/TaskQueue";

function fixture() {
 const bot:any=new EventEmitter();Object.assign(bot,{health:20,entity:{position:new Vec3(0,201,0)},entities:{},players:{},world:{raycast:()=>null},blockAt:()=>({boundingBox:"empty"})});
 const instance:any={bot,status:"online",tasks:new TaskQueue(),config:{username:"Worker",combat:{defendMode:"mob",fleeAtHealth:8}},emit:()=>{},getLogger:()=>({warn:()=>{},error:()=>{},info:()=>{}}),survival:{maybeAutoEat:async()=>{}}};
 const service:any=new CombatService(instance);service.bot=bot;
 return {bot,instance,service};
}

test("retreat rechecks pursuing hostile before reporting recovered",async()=>{
 const {bot,service}=fixture();const mob={id:2,name:"zombie",position:new Vec3(2,201,0)};bot.entities[2]=mob;
 service.findEntityByLabel=()=>mob;
 service.nearestHostile=()=>bot.entity.position.distanceTo(mob.position)<8?mob:null;
 let routes=0;service.fleeFrom=async()=>{routes++;bot.entity.position=new Vec3(routes*18,201,0);if(routes===1)mob.position=new Vec3(17,201,0);};
 await service.runFlee("zombie",{cancelled:false},()=>{});
 assert.equal(routes,2,"a pursuer must trigger another retreat even when health recovered");
 assert.equal(service.getRuntime().mode,"idle");
});

test("survival request clears dependent work and does not stack duplicate flee tasks",async()=>{
 const {service,instance}=fixture();let dependent=false;
 instance.tasks.enqueue({type:"worker",label:"work",priority:50,params:{},requeueOnPreempt:false},()=>token=>new Promise<void>(resolve=>token.abort!.signal.addEventListener("abort",()=>resolve())));
 instance.tasks.enqueue({type:"craft",label:"dependency",priority:30,params:{}},()=>async()=>{dependent=true;});
 service.runFlee=async()=>{};service.enqueueFlee("zombie");service.enqueueFlee("zombie");
 await new Promise(r=>setTimeout(r,30));
 assert.equal(dependent,false);
 assert.equal(instance.tasks.historySummaries.filter((t:any)=>t.type==="flee").length,1);
});

test("unreachable target remains a physical danger for retreat",()=>{
 const {bot,service}=fixture();const mob={id:2,name:"zombie",position:new Vec3(2,201,0)};bot.entities[2]=mob;
 service.unreachableTargets.set(2,Date.now()+15000);
 // Safety must see this entity even though attack selection skips it.
 assert.equal(service.nearestHostile(8,true),mob);
});

test("retreat grace does not immediately re-engage a distant threat",()=>{
 const {service}=fixture();let queued=0;service.retreatUntil=Date.now()+15000;service.nearestHostile=()=>null;service.pickSelfGuardTarget=()=>{queued++;return null;};
 service.selfGuardTick();assert.equal(queued,0);
});

test("hostile detection invalidates worker dependencies before starting defense",async()=>{
 const {service,instance,bot}=fixture();let dependent=false,reason="";
 instance.worker={snapshot:()=>({state:"RUNNING"}),interrupt:(r:string)=>{reason=r;}};
 instance.tasks.enqueue({type:"worker",label:"work",priority:50,params:{},requeueOnPreempt:false},()=>token=>new Promise<void>(resolve=>token.abort!.signal.addEventListener("abort",()=>resolve())));
 instance.tasks.enqueue({type:"craft",label:"dependency",priority:30,params:{}},()=>async()=>{dependent=true;});
 const mob={id:2,name:"zombie",position:new Vec3(2,201,0)};bot.entities[2]=mob;service.pickSelfGuardTarget=()=>mob;service.runDefend=async()=>{};
 service.selfGuardTick();await new Promise(r=>setTimeout(r,30));assert.match(reason,/THREAT/);assert.equal(dependent,false);
 assert.equal(instance.tasks.historySummaries.filter((t:any)=>t.type==="defend").length,1);
});

test("approach budget cools down a moving but unreachable target",async()=>{
 const {spawnSync}=await import("node:child_process");const result=spawnSync(process.execPath,["--import","tsx","-e",`
 (async()=>{
 const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
 const p=require.resolve('./server/src/modules/movement/index.ts');require.cache[p]={id:p,filename:p,loaded:true,exports:{ensureMovement:()=>{},tryPassNearbyDoor:async()=>false}};
 const {CombatService}=require('./server/src/modules/combat/index.ts');let now=100000;Date.now=()=>now+=1000;
 const bot=new EventEmitter(),pos=new Vec3(0,201,0),target={id:2,name:'zombie',position:new Vec3(10,201,0),isValid:true};
 pos.distanceTo=q=>q===target.position?10:1;Object.assign(bot,{health:20,entity:{position:pos,velocity:new Vec3(0,0,0),onGround:true},entities:{2:target},pathfinder:{setGoal:()=>{},isMoving:()=>true},world:{raycast:()=>null}});
 const service=new CombatService({bot,status:'online',controlEpoch:0,config:{combat:{reach:3,chaseDistance:24}},getLogger:()=>({warn:()=>{},debug:()=>{}})});service.bot=bot;
 await service.approachEntity(target,2,{cancelled:false});assert.equal(service.isTargetTemporarilyUnreachable(target),true);
 })().catch(e=>{console.error(e);process.exitCode=1});
 `],{cwd:process.cwd(),encoding:"utf8",timeout:10000});assert.equal(result.status,0,result.stderr+result.stdout);
});
