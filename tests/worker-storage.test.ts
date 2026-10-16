import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("worker supplies a recipe from split stock in two assigned containers",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"caya-split-stock-"));
 try{
 const cfg={dimension:"overworld",spawn:{x:-80,y:117,z:416},margin:16,base:{x:960,y:201,z:960},owned:[{min:{x:950,y:200,z:950},max:{x:982,y:207,z:982}}],containers:{WOOD:{x:955,y:201,z:959},ORES:{x:953,y:201,z:959},FOOD:{x:961,y:201,z:959},TOOLS:{x:963,y:201,z:959}}};
 const config=path.join(dir,"workspace.json");fs.writeFileSync(config,JSON.stringify(cfg));
 const result=spawnSync(process.execPath,["--import","tsx","-e",`
 (async()=>{
 const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3'),data=require('minecraft-data')('26.3'),Recipe=require('prismarine-recipe')(data).Recipe;
 const move=require.resolve('./server/src/modules/movement/index.ts');require.cache[move]={id:move,filename:move,loaded:true,exports:{runGoto:async()=>{}}};
 const stock={955:1,953:1},bag={bread:4},takes=[];
 const chest=require.resolve('./server/src/modules/inventory/chestOps.ts');require.cache[chest]={id:chest,filename:chest,loaded:true,exports:{readChestStock:async(_,p)=>stock[p.x]?({oak_log:stock[p.x]}):({}),withdrawFromChest:async(_,p)=>{const n=Math.min(p.count,stock[p.x]);stock[p.x]-=n;bag[p.item]=(bag[p.item]||0)+n;takes.push({x:p.x,n});return n;},depositToChest:async()=>({movedTotal:0,left:[]})}};
 const craft=require.resolve('./server/src/modules/craft/smartCraft.ts');require.cache[craft]={id:craft,filename:craft,loaded:true,exports:{runSmartCraftInline:async(_,item,target,t,r,a,recipe)=>{const id=data.itemsByName[item].id,ops=(target-(bag[item]||0))/recipe.delta.find(d=>d.id===id&&d.count>0).count;for(const d of recipe.delta){const n=data.items[d.id].name;bag[n]=(bag[n]||0)+d.count*ops;assert.ok(bag[n]>=0,n);}}}};
 const {WorkerService}=require('./server/src/modules/worker/index.ts'),{TaskQueue}=require('./server/src/core/TaskQueue.ts');
 const bot=new EventEmitter();Object.assign(bot,{health:20,food:20,username:'Worker',players:{},entity:{position:new Vec3(960,201,960)},registry:data,recipesAll:id=>Recipe.find(id,null),inventory:{items:()=>Object.entries(bag).filter(([n,c])=>c>0).map(([name,count])=>({name,count,type:data.itemsByName[name].id}))}});
 const instance={bot,status:'online',config:{id:'split',combat:{defendMode:'mob'},inventory:{bannedItems:[]},survival:{foodBlacklist:[]}},tasks:new TaskQueue(),combat:{equipBestWeapon:async()=>{}},craft:{runCraftInline:async()=>{}}};
 const worker=new WorkerService(instance);worker.enqueue({mode:'crafter',item:'wooden_pickaxe',count:1,radius:1});
 const end=Date.now()+2000;while(['RUNNING','QUEUED'].includes(worker.snapshot().state)&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
 assert.equal(worker.snapshot().state,'DONE',worker.snapshot().reason);assert.equal(worker.snapshot().produced,1);assert.equal(stock[955]+stock[953],0);assert.deepEqual(takes,[{x:955,n:1},{x:953,n:1}]);
 })().catch(e=>{console.error(e);process.exitCode=1});
 `],{cwd:process.cwd(),env:{...process.env,CAYA_DATA_DIR:dir,CAYA_WORKSPACE_FILE:config},encoding:"utf8",timeout:10000});assert.equal(result.status,0,result.stderr+result.stdout);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
