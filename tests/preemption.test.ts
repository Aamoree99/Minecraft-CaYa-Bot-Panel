import test from "node:test";
import assert from "node:assert/strict";
import {CraftService} from "../server/src/modules/craft";
import {GatherService} from "../server/src/modules/gather";
test("quantity skills are never automatically replayed after preemption",()=>{
 const captured:any[]=[];const inst:any={tasks:{enqueue:(def:any)=>{captured.push(def);return def;}}};
 new CraftService(inst).enqueueCraft("stick",4);
 const gather=new GatherService(inst);gather.enqueueCollectBlock("stone",4);gather.enqueueCollectWood(4);gather.enqueueMine("iron",4);
 assert.equal(captured.length,4);assert.ok(captured.every(d=>d.requeueOnPreempt===false));
});
