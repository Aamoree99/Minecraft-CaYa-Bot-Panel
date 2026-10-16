import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {confirmedWindowClick} from "../server/src/modules/inventory/confirmedClicks";
test("modern click uses ordinary server action and waits for authoritative window",async()=>{
 const bot:any=new EventEmitter();const window={id:7};bot.currentWindow=window;bot.supportFeature=()=>true;
 let packet:any;bot._client={protocolVersion:775,write:(name:string,data:any)=>{assert.equal(name,"window_click");packet=data;setTimeout(()=>bot.emit("setWindowItems:7"),10);}};
 let resolved=false;const promise=confirmedWindowClick(bot,4,1,{cancelled:false}).then(()=>resolved=true);
 assert.equal(resolved,false);assert.deepEqual(packet,{windowId:7,stateId:-1,slot:4,mouseButton:1,mode:0,changedSlots:[],cursorItem:null});await promise;
 assert.equal(resolved,true);assert.equal(bot.listenerCount("setWindowItems:7"),0);
});
import {craftConfirmed} from "../server/src/modules/craft/confirmedCraft";
test("craft restores inventory primitives after errors",async()=>{
 const bot:any=new EventEmitter();bot._client={protocolVersion:775};bot.clickWindow=async()=>{};bot.putAway=async()=>{};bot.putSelectedItemRange=async()=>{};
 const originals=[bot.clickWindow,bot.putAway,bot.putSelectedItemRange];bot.craft=async()=>{assert.notEqual(bot.clickWindow,originals[0]);throw new Error("server rejected recipe");};
 await assert.rejects(craftConfirmed(bot,{} as any,undefined,{cancelled:false}),/server rejected/);
 assert.deepEqual([bot.clickWindow,bot.putAway,bot.putSelectedItemRange],originals);
});
test("cancelled click sends no packet",async()=>{
 const bot:any={_client:{write:()=>assert.fail("packet after cancellation")}};
 await assert.rejects(confirmedWindowClick(bot,0,0,{cancelled:true,reason:"user cancelled"}),/user cancelled/);
});
test("craft errors close the window and refresh inventory without another craft",async()=>{
 const bot:any=new EventEmitter();bot._client={protocolVersion:775,state:"play"};bot.inventory={id:0};bot.clickWindow=async()=>{};bot.putAway=async()=>{};bot.putSelectedItemRange=async()=>{};let closed=0,refreshed=0,crafted=0;
 bot.closeWindow=async(w:any)=>{assert.equal(w.id,0);closed++;};bot._syncWindow=async(w:any)=>{assert.equal(w.id,0);refreshed++;};bot.craft=async()=>{crafted++;throw new Error("cancelled midway");};
 await assert.rejects(craftConfirmed(bot,{} as any,undefined,{cancelled:false}),/cancelled midway/);
 assert.equal(closed,1);assert.equal(refreshed,1);assert.equal(crafted,1);
});
