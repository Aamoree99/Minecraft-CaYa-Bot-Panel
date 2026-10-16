import test from "node:test";
import assert from "node:assert/strict";
import { transferredCount } from "../server/src/modules/inventory/transfer";
for (const [label,before,after,wanted,expected] of [
 ["complete",[16,0],[0,16],16,16],
 ["partial",[16,60],[12,64],16,4],
 ["rejected",[16,64],[16,64],16,0],
 ["unconfirmed destination",[16,0],[0,0],16,0],
 ["unconfirmed source",[16,0],[16,16],16,0],
 ["bounded",[32,0],[0,32],16,16]
] as const) test(label,()=>assert.equal(transferredCount(before,after,wanted),expected));
import { transferWithConfirmation } from "../server/src/modules/inventory/transfer";
test("each click waits for server confirmation before the next",async()=>{
 const slots:any[]=[null,{type:1,count:16,stackSize:64}];
 const win:any={slots,inventoryStart:1,inventoryEnd:2,selectedItem:null};let pending=false;let clicks=0;
 const click=async(slot:number,button:number)=>{assert.equal(pending,false);pending=true;clicks++;if(!win.selectedItem){win.selectedItem=slots[slot];slots[slot]=null;}else if(button===1){slots[slot]??={type:1,count:0,stackSize:64};slots[slot].count++;win.selectedItem.count--;if(!win.selectedItem.count)win.selectedItem=null;}else {slots[slot]=win.selectedItem;win.selectedItem=null;}};
 await transferWithConfirmation(win,1,8,false,click,async()=>{assert.equal(pending,true);pending=false;});
 assert.equal(slots[0].count,8);assert.equal(slots[1].count,8);assert.equal(win.selectedItem,null);assert.equal(clicks,10);
});
