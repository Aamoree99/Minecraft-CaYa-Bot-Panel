import test from "node:test";
import assert from "node:assert/strict";
test("automatic drop collection skips an entity during its retry cooldown",async()=>{
 const {runSmartCollectDrops}=await import("../server/src/modules/gather/smartGather");
 const {Vec3}=await import("vec3");let inspected=0;
 const entity={id:1,name:"item",position:new Vec3(1,201,0),getDroppedItem:()=>{inspected++;return {name:"cobblestone"};}};
 const bot:any={entity:{position:new Vec3(0,201,0)},entities:{1:entity}};
 const instance:any={bot,status:"online"};
 const cooldown=new WeakMap<object,number>();cooldown.set(entity,Date.now()+30000);
 assert.equal(await runSmartCollectDrops(instance,"cobblestone",8,{cancelled:false},()=>{},1000,cooldown),0);
 assert.equal(inspected,0);

});

