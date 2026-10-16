import test from "node:test";
import assert from "node:assert/strict";
import {goals} from "mineflayer-pathfinder";
import {GoalItemPickup,verifiedPickupDelta} from "../server/src/modules/gather/targets";
test("adjacent block is not already inside physical pickup range",()=>{
 const item={x:399.0625,y:251,z:400.389};const adjacent={x:400,y:251,z:400};
 assert.equal(new goals.GoalNear(item.x,item.y,item.z,1).isEnd(adjacent as any),true);
 const goal=new GoalItemPickup(item);assert.equal(goal.isEnd(adjacent),false);assert.equal(goal.isEnd({x:399,y:251,z:400}),true);
});
test("a stack pickup counts items rather than one entity",()=>assert.equal(verifiedPickupDelta(30,0,34,4,true),4));
test("despawn without inventory increase is not a pickup",()=>assert.equal(verifiedPickupDelta(30,0,30,0,true),0));
test("unknown metadata can use total inventory without negative progress",()=>{assert.equal(verifiedPickupDelta(30,0,32,0,false),2);assert.equal(verifiedPickupDelta(30,0,29,0,false),0);});
