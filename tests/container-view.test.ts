
import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
test("occluded container interaction walks to a visible side before opening",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"caya-container-view-"));
 try{
 const r=spawnSync(process.execPath,["--import","tsx","-e",`
 (async()=>{
 const assert=require('node:assert/strict'),{Vec3}=require('vec3');
 const calls=[];let visible=false;
 const move=require.resolve('./server/src/modules/movement/index.ts');require.cache[move]={id:move,filename:move,loaded:true,exports:{runGoto:async(i,x,y,z)=>{calls.push('move');i.bot.entity.position=new Vec3(x,y,z);if(calls.length>1)visible=true;}}};
 const chest={name:'chest',position:new Vec3(2,70,0),boundingBox:'block'},bot={entity:{position:new Vec3(0,70,0)},canSeeBlock:()=>visible,blockAt:p=>p.equals(chest.position)?chest:{name:p.y===69?'stone':'air',position:p,boundingBox:p.y===69?'block':'empty'},_syncWindow:async()=>{},openContainer:async()=>{assert.equal(visible,true);calls.push('open');return {containerItems:()=>[],close:()=>calls.push('close')}}};
 const i={bot,status:'online',config:{serverId:'test'},runtime:{dimension:'overworld'},emit:()=>{}};
 const {readChestStock}=require('./server/src/modules/inventory/chestOps.ts');
 assert.deepEqual(await readChestStock(i,{x:2,y:70,z:0},{cancelled:false,abort:new AbortController()},()=>{}),{});
 assert.deepEqual(calls,['move','move','open','close']);
 })().catch(e=>{console.error(e);process.exitCode=1});
 `],{cwd:process.cwd(),env:{...process.env,CAYA_DATA_DIR:dir},encoding:"utf8",timeout:10000});
 assert.equal(r.status,0,r.stderr+r.stdout);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

