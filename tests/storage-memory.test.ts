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
