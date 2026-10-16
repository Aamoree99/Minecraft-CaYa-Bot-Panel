import test from "node:test";
import assert from "node:assert/strict";
import {TaskQueue} from "../server/src/core/TaskQueue";
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function terminal(q:TaskQueue){for(let i=0;i<100;i++){if(q.historySummaries.length)return q.historySummaries[0]!;await sleep(20);}throw Error("task hung");}
test("timeout aborts a hung task",async()=>{const q=new TaskQueue();q.enqueue({type:"craft",label:"test",priority:50,params:{},timeoutMs:40} as any,()=>async()=>{await new Promise(()=>{});});assert.match((await terminal(q)).error??"",/TIMEOUT/);});
test("no progress aborts work",async()=>{const q=new TaskQueue();q.enqueue({type:"craft",label:"test",priority:50,params:{},noProgressMs:40} as any,()=>async()=>{await new Promise(()=>{});});assert.match((await terminal(q)).error??"",/No progress/);});
test("cancel clears the queue and aborts token",async()=>{const q=new TaskQueue();let token:any;q.enqueue({type:"craft",label:"test",priority:50,params:{}},()=>async(t)=>{token=t;await new Promise<void>(r=>t.abort!.signal.addEventListener("abort",()=>r()));});q.enqueue({type:"craft",label:"queued",priority:50,params:{}},()=>async()=>assert.fail("ran cancelled task"));q.cancelAll("user cancelled");await sleep(20);assert.equal(token.cancelled,true);assert.equal(q.queueSummaries.length,0);assert.ok(q.historySummaries.every(t=>t.state==="cancelled"));});
