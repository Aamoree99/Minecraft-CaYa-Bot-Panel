import test from "node:test";
import assert from "node:assert/strict";
import { TaskQueue } from "../server/src/core/TaskQueue";
import { withResourceAccess } from "../server/src/modules/inventory/containerAccess";

test("two independent queues serialize contested stock and hand off mined material",async()=>{
 const miner=new TaskQueue(),crafter=new TaskQueue();let stock=0,crafted=0,active=0,peak=0;
 const access=(t:any,action:()=>void)=>withResourceAccess("test-shared-world",t,async()=>{peak=Math.max(peak,++active);try{await new Promise(r=>setTimeout(r,10));action();}finally{active--;}});
 miner.enqueue({type:"worker",label:"miner",priority:50,params:{},requeueOnPreempt:false},()=>async t=>access(t,()=>{stock+=2;}));
 const take=()=>async(t:any)=>access(t,()=>{if(stock>=2){stock-=2;crafted++;}});
 crafter.enqueue({type:"worker",label:"crafter",priority:50,params:{},requeueOnPreempt:false},take);
 const competitor=new TaskQueue();competitor.enqueue({type:"worker",label:"competing crafter",priority:50,params:{},requeueOnPreempt:false},take);
 const until=Date.now()+1000;while([miner,crafter,competitor].some(q=>q.currentSummary)&&Date.now()<until)await new Promise(r=>setTimeout(r,5));
 assert.equal(peak,1);assert.equal(crafted,1);assert.equal(stock,0);assert.equal(miner.historySummaries.length,1);assert.equal(crafter.historySummaries.length,1);
});

test("cancelled storage waiter cannot transfer or unlock the current holder",async()=>{
 let release!:()=>void,entered=false;const first=withResourceAccess("cancel",{cancelled:false},()=>new Promise<void>(r=>{release=r;}));
 const token={cancelled:false,abort:new AbortController()};const second=withResourceAccess("cancel",token,async()=>{entered=true;});
 token.cancelled=true;token.abort.abort();await assert.rejects(second,/cancel/);assert.equal(entered,false);
 release();await first;await withResourceAccess("cancel",{cancelled:false},async()=>{entered=true;});assert.equal(entered,true);
});

test("failed storage operation releases access for reconciliation",async()=>{
 await assert.rejects(withResourceAccess("failure",{cancelled:false},async()=>{throw Error("full chest");}),/full/);
 assert.equal(await withResourceAccess("failure",{cancelled:false},async()=>42),42);
});


