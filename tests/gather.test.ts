import test from "node:test";
import assert from "node:assert/strict";
import minecraftData from "minecraft-data";
import {gatherTarget,inWorkArea} from "../server/src/modules/gather/targets";
const data=minecraftData("26.1");
for(const [block,drop] of [["stone","cobblestone"],["diamond_ore","diamond"],["iron_ore","raw_iron"]])test(`${block} counts ${drop}`,()=>assert.equal(gatherTarget(data as any,block,false).drop,drop));
test("Silk Touch counts original block",()=>assert.equal(gatherTarget(data as any,"stone",true).drop,"stone"));
test("item request uses data drop sources",()=>assert.ok(gatherTarget(data as any,"diamond",false).blocks.has("diamond_ore")));
test("palette probes need no position",()=>assert.equal(inWorkArea(null,{x:10,y:70,z:10},16),true));
test("work area bounds all axes",()=>{assert.equal(inWorkArea({x:27,y:70,z:10},{x:10,y:70,z:10},16),false);assert.equal(inWorkArea({x:10,y:50,z:10},{x:10,y:70,z:10},16),false);});

test("wood search ignores canopy leftovers and out-of-area trunks",async()=>{
 const {GatherService}=await import("../server/src/modules/gather");
 const {Vec3}=require("vec3"),blocks=new Map<string,any>();
 const put=(x:number,y:number,z:number,name:string)=>{const b={position:new Vec3(x,y,z),name,boundingBox:"block"};blocks.set(b.position.toString(),b);return b;};
 const floating=put(0,74,0,"spruce_log");put(0,73,0,"spruce_leaves");
 const rooted=put(4,70,0,"spruce_log");put(4,69,0,"grass_block");
 const outside=put(20,70,0,"spruce_log");put(20,69,0,"grass_block");
 const bot:any={entity:{position:new Vec3(0,70,0)},findBlocks:()=>[floating.position,rooted.position,outside.position],blockAt:(p:any)=>blocks.get(p.toString())??{position:p,name:"air",boundingBox:"empty"}};
 const gather:any=new GatherService({} as any),match=(n:string)=>n==="spruce_log",area={origin:new Vec3(0,70,0),radius:8};
 assert.equal(gather.findTreeBase(bot,match,40,new Map(),area),rooted);
 const reachable=put(6,70,0,"spruce_log");put(6,69,0,"podzol");
 bot.findBlocks=()=>[rooted.position,reachable.position];
 bot.pathfinder={movements:{},getPathTo:(_:any,goal:any)=>goal.pos.x===4?{status:"noPath",path:[]}:{status:"success",path:[1,2],cost:2}};
 assert.equal(gather.findTreeBase(bot,match,40,new Map(),area),reachable);
 delete bot.pathfinder;bot.findBlocks=()=>[floating.position,rooted.position,outside.position];
 blocks.delete(rooted.position.toString());assert.equal(gather.findTreeBase(bot,match,40,new Map(),area),null);
});

test("wood harvest shares the usable-tool selector instead of swallowing legacy tool API failures",async()=>{
 const {GatherService}=await import("../server/src/modules/gather");
 const axe={type:1,name:"wooden_axe",slot:38,durabilityUsed:0};
 let equipped:any;
 const bot:any={registry:{items:{1:{maxDurability:59}}},inventory:{items:()=>[axe]},tool:{getDigTime:(_:any,item:any)=>item?1500:3000},equip:async(item:any)=>{equipped=item;},heldItem:null};
 const service:any=new GatherService({config:{inventory:{bannedItems:[]}}} as any);
 await service.equipFor(bot,{name:"spruce_log",canHarvest:()=>true});
 assert.equal(equipped,axe);
 equipped=null;const {equipUsableTool}=await import("../server/src/modules/worker/equipment");
 await equipUsableTool(bot,{name:"spruce_log",canHarvest:()=>true},["wooden_axe"]);assert.equal(equipped,null,"reserved server wand must never be equipped for mining");
});


test("visible reachable trunk is harvested without repeating a looser approach goal",async()=>{
 const {GatherService}=await import("../server/src/modules/gather");const {Vec3}=require("vec3");
 const pos=new Vec3(3,70,0),block={position:pos,name:"spruce_log",boundingBox:"block"};let mined=false,approaches=0;
 const bot:any={entity:{position:new Vec3(0,70,0)},blockAt:()=>mined?null:block,blockAtCursor:()=>block};
 const service:any=new GatherService({} as any);service.stopPath=()=>{};service.snapLookAt=async()=>{};service.equipFor=async()=>{};
 service.timedDig=async()=>{mined=true;};service.approachTrunkColumn=async()=>{approaches++;};
 await service.digTreeBlock(bot,block,{cancelled:false},()=>{});assert.equal(mined,true);assert.equal(approaches,0);
});
