import test from "node:test";
import assert from "node:assert/strict";
import { transferredCount } from "../server/src/modules/inventory/transfer";
for (const [label,before,after,wanted,expected] of [
 ["complete",[16,0],[0,16],16,16],
 ["partial",[16,60],[12,64],16,4],
 ["rejected",[16,64],[16,64],16,0],
] as const) test(label,()=>assert.equal(transferredCount(before,after,wanted),expected));
import { transferWithConfirmation } from "../server/src/modules/inventory/transfer";
test("each click waits for server confirmation before the next",async()=>{
 const slots:any[]=[null,{type:1,count:16,stackSize:64}];
 const win:any={slots,inventoryStart:1,inventoryEnd:2,selectedItem:null};let pending=false;let clicks=0;
 const click=async(slot:number,button:number)=>{assert.equal(pending,false);pending=true;clicks++;if(!win.selectedItem){win.selectedItem=slots[slot];slots[slot]=null;}else if(button===1){slots[slot]??={type:1,count:0,stackSize:64};slots[slot].count++;win.selectedItem.count--;if(!win.selectedItem.count)win.selectedItem=null;}else {slots[slot]=win.selectedItem;win.selectedItem=null;}};
 await transferWithConfirmation(win,1,8,false,click,async()=>{assert.equal(pending,true);pending=false;});
 assert.equal(slots[0].count,8);assert.equal(slots[1].count,8);assert.equal(win.selectedItem,null);assert.equal(clicks,10);
});

test("transfer rejects excess or mismatched server deltas instead of hiding them",()=>{
 for(const [before,after,wanted] of [
  [[4,0],[0,4],2],
  [[16,0],[0,0],16],
  [[16,0],[16,16],16],
  [[4,0],[2,1],2],
  [[4,0],[5,0],2]
 ] as const) assert.throws(()=>transferredCount(before,after,wanted),/TRANSFER_MISMATCH/);
 assert.equal(transferredCount([4,0],[2,2],2),2);
});

test("withdrawal skips exhausted source tools and selects a later usable stack",async()=>{
 const worn={type:1,count:1,stackSize:1,durabilityUsed:52},fresh={type:1,count:1,stackSize:1,durabilityUsed:3};
 const win:any={slots:[worn,fresh,null],inventoryStart:2,inventoryEnd:3,selectedItem:null},seen:number[]=[];
 await transferWithConfirmation(win,1,1,true,async(slot,button)=>{
  seen.push(slot);const x=win.slots[slot];win.slots[slot]=win.selectedItem;win.selectedItem=x;
 },async()=>{},item=>(item.durabilityUsed??0)<=51);
 assert.deepEqual(seen,[1,2]);assert.equal(win.slots[0],worn);assert.equal(win.slots[2],fresh);assert.equal(win.selectedItem,null);
});
