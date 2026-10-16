import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {confirmedWindowClick} from "../server/src/modules/inventory/confirmedClicks";
test("modern click uses ordinary server action and waits for authoritative window",async()=>{
 const bot:any=new EventEmitter();const window={id:7};bot.currentWindow=window;bot.supportFeature=()=>true;
 let packet:any;bot._client={write:(name:string,data:any)=>{assert.equal(name,"window_click");packet=data;setTimeout(()=>bot.emit("setWindowItems:7"),10);}};
 let resolved=false;const promise=confirmedWindowClick(bot,4,1,{cancelled:false}).then(()=>resolved=true);
 assert.equal(resolved,false);assert.deepEqual(packet,{windowId:7,stateId:-1,slot:4,mouseButton:1,mode:0,changedSlots:[],cursorItem:null});await promise;
 assert.equal(resolved,true);assert.equal(bot.listenerCount("setWindowItems:7"),0);
});
