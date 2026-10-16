import test from "node:test";
import assert from "node:assert/strict";
import mcData from "minecraft-data";
import {gatherTarget} from "../server/src/modules/gather/targets";
const protocol=require("minecraft-protocol");
test("native target uses release777 registry and correct ordinary drops",()=>{const d=mcData("26.3")!;assert.equal(d.version.version,777);for(const [block,item] of [["stone","cobblestone"],["diamond_ore","diamond"],["iron_ore","raw_iron"]])assert.equal(gatherTarget(d as any,block!,false).drop,item);});
test("777 teleport confirm serializes resolved position and rotation",()=>{const s=protocol.createSerializer({state:"play",isServer:false,version:"26.3"});const b=s.createPacketBuffer({name:"teleport_confirm",params:{teleportId:1,x:1,y:2,z:3,yaw:90,pitch:0}});assert.equal(b.length,34);});
test("777 native tick_end packet and feature are present",()=>{const s=protocol.createSerializer({state:"play",isServer:false,version:"26.3"});assert.equal(s.createPacketBuffer({name:"tick_end",params:{}}).length,1);assert.equal(require("prismarine-registry")("26.3").supportFeature("sendsClientTickEndPacket"),true);});
test("existing Mineflayer plugins keep their public injection API",()=>{assert.equal(typeof require("mineflayer-pathfinder").pathfinder,"function");assert.equal(typeof require("mineflayer-tool").plugin,"function");assert.equal(typeof require("mineflayer-armor-manager"),"function");});

test("777 block interaction rejects the fork's legacy flat payload",()=>{
 const s=protocol.createSerializer({state:"play",isServer:false,version:"26.3"});
 const hit={location:{x:398,y:251,z:400},direction:1,cursorX:0.5,cursorY:0.5,cursorZ:0.5,insideBlock:false,worldBorderHit:false};
 assert.throws(()=>s.createPacketBuffer({name:"block_place",params:{hand:0,...hit,sequence:0}}),/location/);
 assert.ok(s.createPacketBuffer({name:"block_place",params:{hand:0,hitResult:hit,sequence:0}}).length>1);
});
test("777 entity delta must preserve finite entity coordinates",()=>{
 const {EventEmitter}=require("node:events");const {Vec3}=require("vec3");
 const bot=new EventEmitter();bot.registry=require("prismarine-registry")("26.3");bot.version="26.3";bot.supportFeature=bot.registry.supportFeature;bot._client=new EventEmitter();
 require("mineflayer/lib/plugins/entities")(bot);
 bot.entities[17]={id:17,position:new Vec3(0,251,0)};
 bot._client.emit("rel_entity_move",{entityId:17,delta:{onGround:true,x:0.5,y:0,z:0,steps:[]}});
 assert.equal(bot.entities[17].position.x,0.5);
});
