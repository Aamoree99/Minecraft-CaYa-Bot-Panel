
import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
test("partner automation follows the target queue, rejects partial work and cancels dependencies",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"caya-partner-flow-"));
 try{
 const file=path.join(dir,"workspace.json"),ids=["11111111-1111-3111-8111-111111111111","22222222-2222-3222-8222-222222222222"];
 fs.writeFileSync(file,JSON.stringify({dimension:"overworld",partnerUuids:ids,spawn:{x:-80,y:117,z:416},margin:16,base:{x:960,y:201,z:960},owned:[],containers:{}}));
 const result=spawnSync(process.execPath,["--import","tsx","-e",`
 (async()=>{
 const assert=require('node:assert/strict'),{TaskQueue}=require('./server/src/core/TaskQueue.ts'),{RuleEngine}=require('./server/src/modules/automation/RuleEngine.ts');
 const ids=${JSON.stringify(ids)},order=[];
 function actor(name,id){let state='DONE';const i={config:{id:name,username:name,serverId:'same'},status:'online',runtime:{dimension:'overworld'},bot:{players:{[name]:{uuid:id}}},tasks:new TaskQueue(),worker:{snapshot:()=>({state})}};
 i.enqueueAction=a=>i.tasks.enqueue({type:a.type,label:name,priority:50,params:{},requeueOnPreempt:false},()=>async token=>{state='RUNNING';order.push(name+':start');if(a.waitForever)await new Promise(resolve=>token.abort.signal.addEventListener('abort',resolve,{once:true}));state=a.partial?'PARTIAL':'DONE';order.push(name+':end');});return i;}
 const a=actor('A',ids[0]),b=actor('B',ids[1]),map=new Map([['A',a],['B',b]]),engine=new RuleEngine({get:id=>map.get(id)});
 const fire=engine.fireMatching;let context;engine.fireMatching=(_,__,ctx)=>context=ctx;engine.onTaskEvent('A','done','worker','worker miner: spruce_log x8');assert.equal(context.workerState,'DONE');engine.onTaskEvent('A','done','goto','return');assert.equal(context.workerState,'');engine.fireMatching=fire;
 let result=await engine.runActionWithResult('A',{type:'worker',partnerBotId:'B'}, {},true,1000,0);
 assert.equal(result.status,'done');assert.deepEqual(order,['B:start','B:end']);assert.equal(a.tasks.historySummaries.length,0);assert.equal(b.tasks.historySummaries.length,1);
 b.sendChat=text=>order.push('said:'+text);engine.liveBotContext=id=>({bot:id});
 await engine.runActionWithResult('A',{type:'report_status',partnerBotId:'B',message:'{bot}',to:'chat'},{bot:'A'},false,1000,0);
 assert.equal(order.at(-1),'said:B');
 await assert.rejects(()=>engine.runActionWithResult('A',{type:'worker',partnerBotId:'B',partial:true},{},true,1000,0),/did not complete/);
 b.bot.players.B.uuid='00000000-0000-0000-0000-000000000000';
 await assert.rejects(()=>engine.runActionWithResult('A',{type:'worker',partnerBotId:'B'},{},true,1000,0),/partner/);
 b.bot.players.B.uuid=ids[1];b.config.serverId='other';
 await assert.rejects(()=>engine.runActionWithResult('A',{type:'worker',partnerBotId:'B'},{},true,1000,0),/partner/);b.config.serverId='same';
 const offline=engine.runActionWithResult('A',{type:'worker',partnerBotId:'B',waitForever:true},{},true,1000,0);
 setTimeout(()=>b.status='stopped',20);await assert.rejects(()=>offline,/disconnected/);await new Promise(r=>setTimeout(r,20));assert.equal(b.tasks.currentSummary,null);b.status='online';
 const timed=await engine.runActionWithResult('A',{type:'worker',partnerBotId:'B',waitForever:true},{},true,10,0);
 assert.equal(timed.status,'timeout');await new Promise(r=>setTimeout(r,20));assert.equal(b.tasks.currentSummary,null);
 const pending=engine.runActionWithResult('A',{type:'worker',partnerBotId:'B',waitForever:true},{},true,1000,0);
 setTimeout(()=>engine.cancelRunsForBot('A','explicit user cancellation'),20);
 await assert.rejects(()=>pending,/cancel/i);await new Promise(r=>setTimeout(r,20));
 assert.equal(b.tasks.currentSummary,null);assert.equal(b.tasks.queueSummaries.length,0);
 })().catch(e=>{console.error(e);process.exitCode=1});
 `],{cwd:process.cwd(),env:{...process.env,CAYA_DATA_DIR:dir,CAYA_WORKSPACE_FILE:file},encoding:"utf8",timeout:10000});
 assert.equal(result.status,0,result.stderr+result.stdout);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

