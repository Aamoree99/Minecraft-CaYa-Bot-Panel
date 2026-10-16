import test from "node:test";
import assert from "node:assert/strict";
const protocol=require("minecraft-protocol");
const {writeBlockPlace}=require("mineflayer/lib/blockPlace");
const hit={location:{x:398,y:251,z:400},direction:1,cursorX:0,cursorY:1,cursorZ:0.5,insideBlock:false,worldBorderHit:false};
test("native block placement preserves the exact face and hit coordinates",()=>{let sent:any;const bot={protocolVersion:777,_client:{write:(name:string,params:any)=>{sent={name,params};}}};writeBlockPlace(bot,{...hit,hand:0,sequence:7});assert.deepEqual(sent.params.hitResult,hit);assert.equal(sent.params.sequence,7);assert.ok(protocol.createSerializer({state:"play",isServer:false,version:"26.3"}).createPacketBuffer(sent).length);});
test("block placement retains legacy775 layout",()=>{let sent:any;writeBlockPlace({protocolVersion:775,_client:{write:(_:string,p:any)=>sent=p}},hit);assert.deepEqual(sent,hit);});
test("invalid native hit never reaches the wire",()=>{let sent=false;assert.throws(()=>writeBlockPlace({protocolVersion:777,_client:{write:()=>sent=true}},{...hit,cursorY:NaN}),/Invalid block hit/);assert.equal(sent,false);});

test("dig, cancel and release IDs switch at protocol777",()=>{const {getPlayerActionIds}=require("mineflayer/lib/playerActionIds");assert.deepEqual(getPlayerActionIds({protocolVersion:777}),{start:0,abort:2,finish:3,releaseUseItem:6});assert.deepEqual(getPlayerActionIds({protocolVersion:775}),{start:0,abort:1,finish:2,releaseUseItem:5});});

function entityBot(type:string){const {EventEmitter}=require("node:events"),{Vec3}=require("vec3");const bot=new EventEmitter();bot.registry=require("prismarine-registry")("26.3");bot.version="26.3";bot.supportFeature=bot.registry.supportFeature;bot._client=new EventEmitter();require("mineflayer/lib/plugins/entities")(bot);bot.entities[17]={id:17,type,position:new Vec3(0,251,0),velocity:new Vec3(0,0,0)};return bot;}
test("wire delta applies every step for players and mobs without rescaling twice",()=>{
 const s=protocol.createSerializer({state:"play",isServer:true,version:"26.3"});const d=protocol.createDeserializer({state:"play",isServer:false,version:"26.3"});
 const bytes=s.createPacketBuffer({name:"rel_entity_move",params:{entityId:17,delta:{onGround:true,steps:[{ticks:1,x:0.5,y:0,z:0},{ticks:2,x:0,y:0.25,z:1}]}}});
 const packet=d.parsePacketBuffer(bytes).data;
 for(const type of ["player","mob"]){const bot=entityBot(type);bot._client.emit(packet.name,packet.params);assert.equal(bot.entities[17].position.x,0.5);assert.equal(bot.entities[17].position.y,251.25);assert.equal(bot.entities[17].position.z,1);}
});
test("linear delta and stepped absolute sync retain finite coordinates",()=>{const bot=entityBot("mob");bot._client.emit("rel_entity_move",{entityId:17,delta:{onGround:true,dX:0.5,dY:0,dZ:0,steps:[]}});assert.equal(bot.entities[17].position.x,0.5);bot._client.emit("sync_entity_position",{entityId:17,position:{type:"stepped",path:{steps:[{position:{x:10,y:70,z:10},tickOffset:1},{position:{x:11,y:71,z:12},tickOffset:2}]}},yaw:90,pitch:0,onGround:true});assert.deepEqual([bot.entities[17].position.x,bot.entities[17].position.y,bot.entities[17].position.z],[11,71,12]);assert.equal(bot.entities[17].velocity.x,0);});
test("invalid entity coordinates are rejected before NaN propagates",()=>{const bot=entityBot("player");assert.throws(()=>bot._client.emit("rel_entity_move",{entityId:17,delta:{x:Infinity,y:0,z:0}}),/Invalid entity movement/);assert.equal(bot.entities[17].position.x,0);});



function physicsClock(t:any){
 const {performance}=require("node:perf_hooks");let now=1000;let frame=()=>{};
 t.mock.method(performance,"now",()=>now);
 t.mock.method(globalThis,"setInterval",(callback:()=>void)=>{frame=callback;return 0;});
 return ()=>{now+=50;frame();};
}

test("consecutive native teleports flush only the latest resolved pose on the client tick",(t)=>{
 const {EventEmitter}=require("node:events"),{Vec3}=require("vec3");
 const bot=new EventEmitter();bot.registry=require("prismarine-registry")("26.3");bot.version="26.3";bot.protocolVersion=777;bot.supportFeature=bot.registry.supportFeature;bot._client=new EventEmitter();bot._client.state="play";bot.blockAt=()=>null;bot.entity={position:new Vec3(0,118,0),velocity:new Vec3(0,0,0),yaw:0,pitch:0};
 const writes:any[]=[];bot._client.write=(name:string,params:any)=>writes.push({name,params:{...params}});
 const tick=physicsClock(t);
 require("mineflayer/lib/plugins/physics")(bot,{});
 t.after(()=>bot.emit("end"));
 bot.emit("login");
 bot._client.emit("position",{teleportId:1,x:1,y:118,z:3,yaw:90,pitch:10,flags:{}});
 bot._client.emit("position",{teleportId:2,x:2,y:0,z:1,yaw:10,pitch:5,flags:{x:true,y:true,z:true,yaw:true,pitch:true}});
 assert.deepEqual(writes,[]);
 tick();
 bot.emit("end");
 assert.deepEqual(writes.map(w=>w.name),["position_look","teleport_confirm","tick_end"]);
 const pose=writes[1].params;assert.deepEqual({...pose,pitch:15},{teleportId:2,x:3,y:118,z:4,yaw:100,pitch:15});assert.ok(Math.abs(pose.pitch-15)<1e-10);
 bot.emit("end");
});


test("configuration transition discards a pending native teleport acknowledgement",(t)=>{
 const {EventEmitter}=require("node:events"),{Vec3}=require("vec3");
 const bot=new EventEmitter();bot.registry=require("prismarine-registry")("26.3");bot.protocolVersion=777;bot.supportFeature=bot.registry.supportFeature;bot._client=new EventEmitter();bot._client.state="play";bot.blockAt=()=>null;bot.entity={position:new Vec3(0,118,0),velocity:new Vec3(0,0,0),yaw:0,pitch:0};
 const writes:any[]=[];bot._client.write=(name:string)=>writes.push(name);
 const tick=physicsClock(t);require("mineflayer/lib/plugins/physics")(bot,{});t.after(()=>bot.emit("end"));bot.emit("login");
 bot._client.emit("position",{teleportId:1,x:1,y:118,z:3,yaw:90,pitch:10,flags:{}});
 bot._client.emit("start_configuration");
 tick();
 assert.deepEqual(writes,[]);
});


test("native relative player rotation resolves each axis before converting units",()=>{
 const {EventEmitter}=require("node:events"),{Vec3}=require("vec3"),conv=require("mineflayer/lib/conversions");
 const bot=new EventEmitter();bot.registry=require("prismarine-registry")("26.3");bot.protocolVersion=777;bot.supportFeature=bot.registry.supportFeature;bot._client=new EventEmitter();bot.entity={position:new Vec3(0,118,0),velocity:new Vec3(0,0,0),yaw:conv.fromNotchianYaw(90),pitch:conv.fromNotchianPitch(10)};
 require("mineflayer/lib/plugins/physics")(bot,{});
 bot._client.emit("player_rotation",{yaw:20,pitch:-5,relativeYaw:true,relativePitch:true});
 assert.ok(Math.abs(conv.toNotchianYaw(bot.entity.yaw)-110)<1e-10);assert.ok(Math.abs(conv.toNotchianPitch(bot.entity.pitch)-5)<1e-10);
 bot._client.emit("player_rotation",{yaw:45,pitch:10,relativeYaw:false,relativePitch:true});
 assert.ok(Math.abs(conv.toNotchianYaw(bot.entity.yaw)-45)<1e-10);assert.ok(Math.abs(conv.toNotchianPitch(bot.entity.pitch)-15)<1e-10);
 bot.emit("end");
});

test("777 input matches the simulated jump when pathfinder changes next-tick controls",(t)=>{
 const {EventEmitter}=require("node:events"),{Vec3}=require("vec3");
 const bot=new EventEmitter();bot.registry=require("prismarine-registry")("26.3");bot.version="26.3";bot.protocolVersion=777;bot.supportFeature=bot.registry.supportFeature;
 bot._client=new EventEmitter();bot._client.state="play";bot.blockAt=()=>({});bot.inventory={slots:Array(46).fill(null)};bot.entity={position:new Vec3(0,70,0),velocity:new Vec3(0,0,0),yaw:0,pitch:0,onGround:true,effects:{},attributes:{}};
 const writes:any[]=[];bot._client.write=(name:string,params:any)=>writes.push({name,params});
 const tick=physicsClock(t);require("mineflayer/lib/plugins/physics")(bot,{});t.after(()=>bot.emit("end"));bot.emit("login");
 bot._client.emit("position",{teleportId:1,x:0,y:70,z:0,yaw:0,pitch:0,flags:{}});tick();writes.length=0;
 bot.physicsEnabled=true;bot.isAlive=true;
 bot.physics.simulatePlayer=(state:any)=>({apply:(b:any)=>{assert.equal(state.control.jump,true);b.entity.position.y+=0.42;}});
 bot.on("physicsTick",()=>bot.setControlState("jump",false));
 bot.setControlState("jump",true);tick();
 assert.equal(writes.find(w=>w.name==="player_input").params.inputs.jump,true);
 assert.equal(bot.getControlState("jump"),false);
 assert.ok(writes.some(w=>w.name==="position"||w.name==="position_look"),JSON.stringify({writes,position:bot.entity.position}));
});

test("777 collision bounds use the server float player width at a step face",(t)=>{
 const {EventEmitter}=require("node:events"),{Vec3}=require("vec3");
 const bot=new EventEmitter();bot.registry=require("prismarine-registry")("26.3");bot.protocolVersion=777;bot.supportFeature=bot.registry.supportFeature;bot._client=new EventEmitter();bot.entity={position:new Vec3(0,70,0),velocity:new Vec3(0,0,0),yaw:0,pitch:0};
 physicsClock(t);require("mineflayer/lib/plugins/physics")(bot,{});t.after(()=>bot.emit("end"));
 const serverHalfWidth=Math.fround(0.6)/2,stepFace=1010;
 assert.ok(stepFace+0.3-serverHalfWidth<stepFace,"old double half width penetrated the server step");
 assert.equal(bot.physics.playerHalfWidth,serverHalfWidth);
 assert.equal(stepFace+bot.physics.playerHalfWidth-serverHalfWidth,stepFace);
 assert.equal(bot.physics.playerHeight,Math.fround(1.8));
});
