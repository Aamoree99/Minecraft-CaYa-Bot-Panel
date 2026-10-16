import test from "node:test";
import assert from "node:assert/strict";
const protocol=require("minecraft-protocol");
const {writeBlockPlace}=require("mineflayer/lib/blockPlace");
const hit={location:{x:398,y:251,z:400},direction:1,cursorX:0,cursorY:1,cursorZ:0.5,insideBlock:false,worldBorderHit:false};
test("native block placement preserves the exact face and hit coordinates",()=>{let sent:any;const bot={protocolVersion:777,_client:{write:(name:string,params:any)=>{sent={name,params};}}};writeBlockPlace(bot,{...hit,hand:0,sequence:7});assert.deepEqual(sent.params.hitResult,hit);assert.equal(sent.params.sequence,7);assert.ok(protocol.createSerializer({state:"play",isServer:false,version:"26.3"}).createPacketBuffer(sent).length);});
test("block placement retains legacy775 layout",()=>{let sent:any;writeBlockPlace({protocolVersion:775,_client:{write:(_:string,p:any)=>sent=p}},hit);assert.deepEqual(sent,hit);});
test("invalid native hit never reaches the wire",()=>{let sent=false;assert.throws(()=>writeBlockPlace({protocolVersion:777,_client:{write:()=>sent=true}},{...hit,cursorY:NaN}),/Invalid block hit/);assert.equal(sent,false);});

test("dig, cancel and release IDs switch at protocol777",()=>{const {getPlayerActionIds}=require("mineflayer/lib/playerActionIds");assert.deepEqual(getPlayerActionIds({protocolVersion:777}),{start:0,abort:2,finish:3,releaseUseItem:6});assert.deepEqual(getPlayerActionIds({protocolVersion:775}),{start:0,abort:1,finish:2,releaseUseItem:5});});
