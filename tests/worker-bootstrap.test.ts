
import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
test("wood Worker bootstraps by hand with no tools or crafting materials and deposits its harvest",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"caya-wood-bootstrap-"));
 try{
 const config=path.join(dir,"workspace.json");
 fs.writeFileSync(config,JSON.stringify({dimension:"overworld",spawn:{x:-80,y:117,z:416},margin:16,base:{x:960,y:201,z:960},owned:[{min:{x:950,y:200,z:950},max:{x:982,y:220,z:982}}],containers:{WOOD:{x:955,y:201,z:959},FOOD:{x:961,y:201,z:959},TOOLS:{x:963,y:201,z:959}}}));
 const result=spawnSync(process.execPath,["--import","tsx","-e",`
 (async()=>{
 const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3'),data=require('minecraft-data')('26.3');
 const bag={bread:4},calls=[];
 const mock=(name,exports)=>{const p=require.resolve(name);require.cache[p]={id:p,filename:p,loaded:true,exports};};
 mock('./server/src/modules/movement/index.ts',{runGoto:async()=>calls.push('return')});
 mock('./server/src/modules/inventory/chestOps.ts',{
  readChestStock:async()=>{throw Error('Wood bootstrap must not need a tool warehouse')},
  withdrawFromChest:async()=>{throw Error('No tools/materials available')},
  depositToChest:async(_,p)=>{if(p.items.includes('spruce_log')){const n=bag.spruce_log;bag.spruce_log=0;calls.push('deposit');return {movedTotal:n,left:[]}}return {movedTotal:0,left:[]}}
 });
 mock('./server/src/modules/gather/smartGather.ts',{runSmartCollectBlock:async(i,item,n,t)=>{assert.equal(item,'spruce_log');assert.equal(n,8);assert.ok(t.workArea);bag.spruce_log=8;calls.push('gather');}});
 mock('./server/src/modules/craft/smartCraft.ts',{runSmartCraftInline:async()=>{throw Error('No crafting before bootstrap wood')}});
 const {WorkerService}=require('./server/src/modules/worker/index.ts'),{TaskQueue}=require('./server/src/core/TaskQueue.ts');
 const bot=new EventEmitter();Object.assign(bot,{health:20,food:20,username:'Worker',players:{},entity:{position:new Vec3(960,201,960)},registry:data,inventory:{items:()=>Object.entries(bag).filter(([n,c])=>c>0).map(([name,count])=>({name,count,type:data.itemsByName[name].id}))}});
 const i={bot,status:'online',config:{id:'wood-bootstrap',combat:{defendMode:'mob'},inventory:{bannedItems:[]},survival:{foodBlacklist:[]}},tasks:new TaskQueue(),combat:{equipBestWeapon:async()=>{}}};
 const worker=new WorkerService(i);worker.enqueue({mode:'miner',item:'spruce_log',count:8,radius:2,deadlineMs:3000});
 const end=Date.now()+2500;while(['RUNNING','QUEUED'].includes(worker.snapshot().state)&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
 assert.equal(worker.snapshot().state,'DONE',worker.snapshot().reason);assert.equal(worker.snapshot().produced,8);assert.equal(worker.snapshot().deposited,8);
 assert.ok(calls.indexOf('gather')<calls.indexOf('deposit'));assert.equal(bag.spruce_log,0);
 })().catch(e=>{console.error(e);process.exitCode=1});
 `],{cwd:process.cwd(),env:{...process.env,CAYA_DATA_DIR:dir,CAYA_WORKSPACE_FILE:config},encoding:"utf8",timeout:10000});
 assert.equal(result.status,0,result.stderr+result.stdout);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

