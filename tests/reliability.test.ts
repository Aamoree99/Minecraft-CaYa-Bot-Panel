import test from "node:test";
import assert from "node:assert/strict";
import minecraftData from "minecraft-data";
import { smartPreviewPlan } from "../server/src/modules/craft/smartCraft";
const registry = minecraftData("26.1");
const Recipe = require("prismarine-recipe")(registry).Recipe;
function instance(items: Array<{name:string;count:number}> = []) {
  return { bot: {registry, inventory:{items:()=>items}, recipesAll:(id:number,_meta:unknown,table:unknown)=>Recipe.find(id,null).filter((r:any)=>!r.requiresTable||table)} } as any;
}
for (const [name, input, count] of [["stick","oak_planks",2],["crafting_table","oak_planks",4],["wooden_pickaxe","oak_planks",3]] as const) {
 test(`recipe ${name} includes actual materials`,()=>{
  const plan=smartPreviewPlan(instance(),name,name==="stick"?4:1);
  assert.ok(plan.some(p=>p.item.endsWith("_planks")&&p.count===count), JSON.stringify(plan));
 });
}
test("craft uses existing materials without adding them again",()=>{
 const plan=smartPreviewPlan(instance([{name:"oak_planks",count:4}]),"crafting_table",1);
 assert.deepEqual(plan,[{kind:"craft",item:"crafting_table",count:1}]);
});
import {runSmartCraftInline} from "../server/src/modules/craft/smartCraft";
test("strict craft does not recursively gather missing raw ingredients",async()=>{
 const inst=instance();inst.status="online";inst.config={movement:{allowPlace:false}};inst.gather={runCollectBlock:()=>assert.fail("unexpected gathering")};
 await assert.rejects(runSmartCraftInline(inst,"stick",4,{cancelled:false},()=>{},false),/Missing materials/);
});
