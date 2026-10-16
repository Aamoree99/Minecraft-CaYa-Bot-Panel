import test from "node:test";
import assert from "node:assert/strict";
test("persistent stock seed sums multiple stacks and isolates dimensions",async()=>{
 const {ChestStockIndex}=await import("../server/src/modules/build/stock");const index=new ChestStockIndex();
 index.seed([{x:1,y:2,z:3,dimension:"overworld",items:[{name:"oak_log",count:64},{name:"oak_log",count:15}]},{x:1,y:2,z:3,dimension:"the_nether",items:[{name:"oak_log",count:100}]}],"overworld");
 assert.equal(index.stockOf(["oak_log"]),79);assert.equal(index.size,1);assert.equal(index.list()[0].seeded,true);
});

test("world memory keeps same coordinates in separate dimensions",async()=>{
 const {WorldMemory}=await import("../server/src/modules/world/memory");const memory:any=new WorldMemory();memory.persist=()=>{};
 for(const dimension of ["overworld","the_nether"])memory.upsertChest({serverId:"test",x:1,y:2,z:3,dimension,items:[]});
 assert.equal(memory.chestsFor("test").length,2);
});

test("native fetch persists the post-transfer contents rather than the pre-transfer snapshot",async()=>{
 const {spawnSync}=await import("node:child_process");const result=spawnSync(process.execPath,["--import","tsx","-e",`
 (async()=>{
 const assert=require('node:assert/strict'),{Vec3}=require('vec3');
 const p=require.resolve('./server/src/modules/build/place.ts');require.cache[p]={id:p,filename:p,loaded:true,exports:{pathNear:async()=>{},boundedOp:async op=>op}};
 const {ChestStockIndex,fetchFromStorage}=require('./server/src/modules/build/stock.ts');
 let carried=0,stored=4;const snapshots=[],position=new Vec3(1,201,0);
 const win={containerItems:()=>stored?[{name:'oak_log',type:1,count:stored}]:[],withdraw:async(id,meta,n)=>{stored-=n;carried+=n;},close:()=>{}};
 const bot={entity:{position:new Vec3(0,201,0)},inventory:{items:()=>carried?[{name:'oak_log',count:carried}]:[],emptySlotCount:()=>36},registry:{itemsByName:{oak_log:{id:1,stackSize:64}}},blockAt:()=>({name:'chest',position}),pathfinder:{setGoal:()=>{}},clearControlStates:()=>{},openContainer:async()=>win};
 const instance={bot,status:'online',config:{serverId:'memory'},runtime:{dimension:'overworld'},emit:(event,row)=>snapshots.push(row),getLogger:()=>({warn:()=>{}})};
 const index=new ChestStockIndex();index.seed([{x:1,y:201,z:0,dimension:'overworld',items:[{name:'oak_log',count:4}]}],'overworld');
 assert.equal(await fetchFromStorage(instance,index,['oak_log'],2,{cancelled:false}),2);
 assert.equal(carried,2);assert.equal(stored,2);assert.equal(index.stockOf(['oak_log']),2);
 assert.equal(snapshots.at(-1).items[0].count,2,'persistent memory must receive the final snapshot');
 })().catch(e=>{console.error(e);process.exitCode=1});
 `],{cwd:process.cwd(),encoding:"utf8",timeout:10000});assert.equal(result.status,0,result.stderr+result.stdout);
});
