import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../config/paths";
import type { BotInstance } from "../../core/BotInstance";
import { PRIORITY, type TaskToken, type ProgressFn } from "../../core/TaskQueue";
import { runGoto } from "../movement";
import { runSmartCollectBlock } from "../gather/smartGather";
import { runSmartCraftInline } from "../craft/smartCraft";
import { depositToChest, withdrawFromChest } from "../inventory/chestOps";
import { workspace, owned, usable, type Point, type Workspace } from "./policy";
export type Job={mode:"miner"|"farmer"|"warehouse"|"crafter"|"return";item:string;count:number;origin:Point;radius:number;deadlineMs:number;attempts:number;cycles:number;intervalMs:number};
export function parseJob(a:any,w:Workspace):Job {
 const mode=a.mode;if(!["miner","farmer","warehouse","crafter","return"].includes(mode))throw Error("Unknown worker mode");
 const j:Job={mode,item:String(a.item??"cobblestone").replace(/^minecraft:/,""),count:a.count??64,origin:a.origin??w.base,radius:a.radius??4,deadlineMs:a.deadlineMs??120000,attempts:a.attempts??1,cycles:a.cycles??1,intervalMs:a.intervalMs??30000};
 for(const [k,min,max] of [["count",1,4096],["radius",1,16],["deadlineMs",1000,3600000],["attempts",1,3],["cycles",1,720],["intervalMs",5000,300000]] as const)if(!Number.isInteger(j[k])||j[k]<min||j[k]>max)throw Error(`Invalid worker ${k}`);
 if(!/^[a-z0-9_]+$/.test(j.item))throw Error("Invalid item name");
 for(const dx of [-j.radius,j.radius])for(const dz of [-j.radius,j.radius])if(!owned(w,{x:j.origin.x+dx,y:j.origin.y,z:j.origin.z+dz}))throw Error("Worker search area must be wholly assigned own space");
 return j;
}
export function category(name:string):string|undefined {if(/(_log|_wood|_planks|_stem|_hyphae)$/.test(name))return "WOOD";if(/(ore|raw_|ingot|diamond|emerald|coal|lapis|redstone)/.test(name))return "ORES";if(/(wheat|seeds|carrot|potato|beetroot|bread|apple|cooked_)/.test(name))return "FOOD";if(/(_pickaxe|_axe|_shovel|_hoe|_sword|_helmet|_chestplate|_leggings|_boots)$/.test(name))return "TOOLS";if(/(stone|cobblestone|granite|diorite|andesite|deepslate|gravel|sand|dirt)/.test(name))return "STONE";return undefined;}
export class WorkerService {
 private ledger:any;
 private file:string;
 constructor(private instance:BotInstance){this.file=path.join(DATA_DIR,`worker-${instance.config.id}.json`);try{this.ledger=JSON.parse(fs.readFileSync(this.file,"utf8"));if(this.ledger.state==="RUNNING"||this.ledger.state==="QUEUED"){this.ledger.state="INTERRUPTED";this.ledger.reason="Process restarted; inventory/containers require reconciliation before explicit resubmission";this.save();}}catch{this.ledger=null;}}
 snapshot(){return this.ledger;}
 private save(){fs.writeFileSync(this.file,JSON.stringify(this.ledger,null,2),{mode:0o600});}
 enqueue(a:Record<string,unknown>){
  if(!workspace)throw Error("Worker requires trusted CAYA_WORKSPACE_FILE");
  if(this.ledger?.state==="RUNNING"||this.ledger?.state==="QUEUED")throw Error("A worker assignment is already active");
  if(this.instance.config.combat.defendMode!=="mob")throw Error("Worker requires mob-only self-defense");
  const job=parseJob(a,workspace),record={job,state:"QUEUED",startedAt:0,finishedAt:0,cycles:0,produced:0,deposited:0,reason:"",events:[] as any[]};this.ledger=record;this.save();
  const cleared=(reason:string)=>{if(record.state==="QUEUED"){record.state="INTERRUPTED";record.reason=reason;record.finishedAt=Date.now();this.save();}this.instance.tasks.removeListener("queueCleared",cleared);};this.instance.tasks.on("queueCleared",cleared);
  return this.instance.tasks.enqueue({type:"worker",label:`worker ${job.mode}: ${job.item} x${job.count}`,priority:PRIORITY.AUTO,params:{...job},timeoutMs:job.deadlineMs+1000,noProgressMs:Math.max(120000,job.intervalMs+30000),requeueOnPreempt:false},()=>async(token,report)=>{
   this.instance.tasks.removeListener("queueCleared",cleared);
   const bot=this.instance.bot;if(!bot){record.state="FAILED";record.reason="Bot offline";this.save();throw Error("Bot offline");}const w=workspace!;record.state="RUNNING";record.startedAt=Date.now();this.save();const end=record.startedAt+job.deadlineMs;let deadlineTimer:ReturnType<typeof setTimeout>|undefined;
   const note=(phase:string,detail:any={})=>{record.events.push({at:Date.now(),phase,...detail});if(record.events.length>200)record.events.shift();this.save();};
   const check=()=>{if(token.cancelled)throw Error(token.reason??"Cancelled");if(Date.now()>=end)throw Error("DEADLINE");if(this.instance.bot!==bot||this.instance.status!=="online")throw Error("DISCONNECTED: explicit reconciliation required");if(bot.health<=w.criticalHealth)throw Error("CRITICAL_HEALTH");};
   const count=(item:string)=>bot.inventory.items().reduce((s,i)=>s+(i.name===item?i.count:0),0);
   const health=()=>{if(bot.health<=(w.criticalHealth??8)){this.instance.tasks.cancelAll("WORKER: critical health; assignment interrupted");if(bot.health>0)this.instance.combat.enqueueFlee();}};
   const returnBase=async()=>{check();note("RETURN");await runGoto(this.instance,w.base.x,w.base.y,w.base.z,1,token,report,{canDig:false,allowPlace:false,timeoutMs:30000});};
   const sort=async()=>{for(const [name,p] of Object.entries(w.containers)){check();const items=bot.inventory.items().filter(i=>category(i.name)===name).map(i=>i.name);if(!items.length)continue;const keepCounts:Record<string,number>={bread:4,wheat_seeds:8,carrot:4,potato:4,beetroot_seeds:8};for(const i of bot.inventory.items())if(/_pickaxe$|_sword$/.test(i.name)&&usable(i,bot.registry,w.minDurability))keepCounts[i.name]=1;const r=await depositToChest(this.instance,{...p,items:[...new Set(items)],keepCounts},token,report);record.deposited+=r.movedTotal;note("DEPOSIT",{container:name,moved:r.moved,left:r.left});if(r.left.length)throw Error("STORAGE_FULL: verified items remain");}};
   bot.on("health",health);
   try{
    deadlineTimer=setTimeout(()=>{this.instance.tasks.cancelAll("WORKER: deadline exceeded");},job.deadlineMs);
    for(let cycle=0;cycle<job.cycles;cycle++){
     check();note("CHECK",{cycle,health:bot.health,food:bot.food});
     if(bot.food<=(w.foodThreshold??14)&&!await this.instance.survival.eatBest())throw Error("MISSING_FOOD");
     await this.instance.combat.equipBestWeapon();
     const before=count(job.item);let result="";
     if(job.mode==="miner"){
      const tool=bot.inventory.items().find(i=>/_pickaxe$/.test(i.name)&&usable(i,bot.registry,w.minDurability));
      if(!tool){const p=w.containers.TOOLS;if(p){try{await withdrawFromChest(this.instance,{...p,item:"wooden_pickaxe",count:1},token,report);}catch(e){note("TOOL_WITHDRAW",{error:String(e)});}}}
      if(!bot.inventory.items().some(i=>/_pickaxe$/.test(i.name)&&usable(i,bot.registry,w.minDurability))){await runSmartCraftInline(this.instance,"wooden_pickaxe",count("wooden_pickaxe")+1,token,report,false);}
      token.workArea={origin:job.origin,radius:job.radius};let error:unknown;
      for(let attempt=0;attempt<job.attempts&&count(job.item)<before+job.count;attempt++){check();try{await runSmartCollectBlock(this.instance,job.item,before+job.count,token,report,"target");error=undefined;break;}catch(e){error=e;note("MINING_ATTEMPT",{attempt,error:String(e)});}}
      record.produced+=Math.max(0,count(job.item)-before);if(count(job.item)<before+job.count)result=`PARTIAL: ${count(job.item)-before}/${job.count}; ${String(error??"resource unavailable")}`;
     }else if(job.mode==="farmer"){
      token.workArea={origin:job.origin,radius:job.radius};result=await this.instance.farm.runHarvest({...job.origin,radius:job.radius,maxBlocks:64,replant:true},token,report);record.produced+=Math.max(0,count(job.item)-before);note("HARVEST",{result});if(/failed: [1-9]|error/i.test(result))throw Error(result);
     }else if(job.mode==="crafter"){
      await runSmartCraftInline(this.instance,job.item,before+job.count,token,report,false);record.produced+=Math.max(0,count(job.item)-before);if(count(job.item)<before+job.count)throw Error("CRAFT_RESULT_MISMATCH");
     }
     await returnBase();if(job.mode!=="return")await sort();check();record.cycles++;note("CYCLE_COMPLETE",{cycle:record.cycles});report({done:record.cycles,total:job.cycles,label:`verified cycles ${record.cycles}/${job.cycles}`});
     if(result.startsWith("PARTIAL:")){record.state="PARTIAL";record.reason=result;break;}
     if(cycle+1<job.cycles){note("WAIT_NEXT_CYCLE");const until=Math.min(end,Date.now()+job.intervalMs);while(Date.now()<until){check();await new Promise(r=>setTimeout(r,250));}}
    }
    if(record.state==="RUNNING")record.state="DONE";
   }catch(e){record.state=token.cancelled?"INTERRUPTED":"FAILED";record.reason=e instanceof Error?e.message:String(e);throw e;}finally{if(deadlineTimer)clearTimeout(deadlineTimer);bot.removeListener("health",health);record.finishedAt=Date.now();this.save();}
  });
 }
}
