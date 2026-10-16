import { planSupply } from "./planning";
import {isFood} from "../survival/foods";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../config/paths";
import type { BotInstance } from "../../core/BotInstance";
import { PRIORITY, type TaskToken, type ProgressFn } from "../../core/TaskQueue";
import { runGoto } from "../movement";
import { runSmartCollectBlock } from "../gather/smartGather";
import { runSmartCraftInline } from "../craft/smartCraft";
import { depositToChest, withdrawFromChest, readChestStock } from "../inventory/chestOps";
import { nearbyWorkerVisitor, workspace, owned, usable, type Point, type Workspace } from "./policy";
export type Job = {
    mode: "miner" | "farmer" | "warehouse" | "crafter" | "return";
    item: string;
    count: number;
    origin: Point;
    radius: number;
    deadlineMs: number;
    attempts: number;
    cycles: number;
    intervalMs: number;
};
export function parseJob(a: any, w: Workspace): Job {
    const mode = a.mode;
    if (!["miner", "farmer", "warehouse", "crafter", "return"].includes(mode))
        throw Error("Unknown worker mode");
    const j: Job = { mode, item: String(a.item ?? "cobblestone").replace(/^minecraft:/, ""), count: a.count ?? 64, origin: a.origin ?? w.base, radius: a.radius ?? 4, deadlineMs: a.deadlineMs ?? 120000, attempts: a.attempts ?? 1, cycles: a.cycles ?? 1, intervalMs: a.intervalMs ?? 30000 };
    for (const [k, min, max] of [["count", 1, 4096], ["radius", 1, 16], ["deadlineMs", 1000, 7200000], ["attempts", 1, 3], ["cycles", 1, 720], ["intervalMs", 5000, 300000]] as const)
        if (!Number.isInteger(j[k]) || j[k] < min || j[k] > max)
            throw Error(`Invalid worker ${k}`);
    if (!/^[a-z0-9_]+$/.test(j.item))
        throw Error("Invalid item name");
    if(!j.origin||!owned(w,j.origin))throw Error("Worker search origin outside own space or protected holes");
    for(let x=Math.floor(j.origin.x-j.radius);x<=Math.ceil(j.origin.x+j.radius);x++)
        for(let z=Math.floor(j.origin.z-j.radius);z<=Math.ceil(j.origin.z+j.radius);z++)
            if(!owned(w,{x,y:j.origin.y,z}))throw Error("Worker search area must be wholly assigned own space without protected holes");
    return j;
}
export function category(name: string): string | undefined { if (name === "stick" || /(_log|_wood|_planks|_stem|_hyphae)$/.test(name))
    return "WOOD"; if (/(ore|raw_|ingot|diamond|emerald|coal|lapis|redstone)/.test(name))
    return "ORES"; if (/(wheat|seeds|carrot|potato|beetroot|bread|apple|cooked_)/.test(name))
    return "FOOD"; if (/(_pickaxe|_axe|_shovel|_hoe|_sword|_helmet|_chestplate|_leggings|_boots)$/.test(name))
    return "TOOLS"; if (/(stone|cobblestone|granite|diorite|andesite|deepslate|gravel|sand|dirt)/.test(name))
    return "STONE"; return undefined; }
export function recipeDeficit(recipe: {delta: Array<{id:number,count:number}>}, name: (id:number)=>string, available:(item:string)=>number):number {
    return recipe.delta.filter(d=>d.count<0).reduce((sum,d)=>sum+Math.max(0,-d.count-available(name(d.id))),0);
}
export function workerProgress(report:ProgressFn):ProgressFn {
    let previous=0, units=0;
    return p=>{
        if(Number.isFinite(p.done)&&p.done>=0){units+=Math.max(0,p.done-previous);previous=p.done;}
        report({done:units,total:Math.max(units,units+Math.max(0,p.total-p.done)),label:p.label});
    };
}
export class WorkerService {
    private ledger: any;
    private file: string;
    constructor(private instance: BotInstance) { this.file = path.join(DATA_DIR, `worker-${instance.config.id}.json`); try {
        this.ledger = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (this.ledger.state === "RUNNING" || this.ledger.state === "QUEUED") {
            this.ledger.state = "INTERRUPTED";
            this.ledger.reason = "Process restarted; inventory/containers require reconciliation before explicit resubmission";
            this.save();
        }
    }
    catch {
        this.ledger = null;
    } }
    snapshot() { return this.ledger; }
    interrupt(reason:string){if(this.ledger&&["RUNNING","QUEUED"].includes(this.ledger.state)){this.ledger.interruptionReason=reason;this.save();}}
    private save() {
        const pending=this.file+".pending";
        const fd=fs.openSync(pending,"w",0o600);
        try{fs.writeFileSync(fd,JSON.stringify(this.ledger,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
        fs.renameSync(pending,this.file);
    }
    enqueue(a: Record<string, unknown>) {
        if (!workspace)
            throw Error("Worker requires trusted CAYA_WORKSPACE_FILE");
        if (this.ledger?.state === "RUNNING" || this.ledger?.state === "QUEUED")
            throw Error("A worker assignment is already active");
        if (this.instance.config.combat.defendMode !== "mob")
            throw Error("Worker requires mob-only self-defense");
        const job = parseJob(a, workspace), submittedAt=Date.now(), expiresAt=submittedAt+job.deadlineMs, record = { job, submittedAt, expiresAt, state: "QUEUED", startedAt: 0, finishedAt: 0, cycles: 0, produced: 0, deposited: 0, reason: "", interruptionReason:"", events: [] as any[] };
        this.ledger = record;
        this.save();
        let taskId:string|undefined;
        let queuedDeadline: ReturnType<typeof setTimeout>|undefined;
        const updated=()=>{if(taskId&&record.state==="QUEUED"&&this.instance.tasks.currentSummary?.id!==taskId&&!this.instance.tasks.queueSummaries.some(t=>t.id===taskId))cleared("Queued assignment removed");};
        const cleared = (reason: string) => { if(queuedDeadline)clearTimeout(queuedDeadline); if (record.state === "QUEUED") {
            record.state = "INTERRUPTED";
            record.reason = record.interruptionReason||reason;
            record.finishedAt = Date.now();
            this.save();
        } this.instance.tasks.removeListener("queueCleared", cleared);this.instance.tasks.removeListener("update",updated); };
        this.instance.tasks.on("queueCleared", cleared);this.instance.tasks.on("update",updated);
        const queued=this.instance.tasks.enqueue({ type: "worker", label: `worker ${job.mode}: ${job.item} x${job.count}`, priority: PRIORITY.AUTO, params: { ...job }, timeoutMs: job.deadlineMs + 1000, noProgressMs: Math.max(120000, job.intervalMs + 30000), requeueOnPreempt: false }, () => async (token, queueReport) => {
            const report=workerProgress(queueReport);
            this.instance.tasks.removeListener("queueCleared", cleared);this.instance.tasks.removeListener("update",updated);
            if(queuedDeadline)clearTimeout(queuedDeadline);
            const bot = this.instance.bot;
            if (!bot) {
                record.state = "FAILED";
                record.reason = "Bot offline";
                this.save();
                throw Error("Bot offline");
            }
            const w = workspace!;
            record.state = "RUNNING";
            record.startedAt = Date.now();
            this.save();
            const end = expiresAt;
            let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
            const note = (phase: string, detail: any = {}) => { record.events.push({ at: Date.now(), phase, ...detail }); if (record.events.length > 200)
                record.events.shift(); this.save(); };
            const check = () => { if (token.cancelled)
                throw Error(token.reason ?? "Cancelled"); if (Date.now() >= end)
                throw Error("DEADLINE"); if (this.instance.bot !== bot || this.instance.status !== "online")
                throw Error("DISCONNECTED: explicit reconciliation required"); if (bot.health <= w.criticalHealth) {if(bot.health>0)this.instance.combat.enqueueFlee();throw Error("CRITICAL_HEALTH");} if (nearbyWorkerVisitor(bot))
                throw Error("OWNERSHIP: another player near work area"); };
            const count = (item: string) => bot.inventory.items().reduce((s, i) => s + (i.name === item ? i.count : 0), 0);
            const health = () => { if (bot.health <= (w.criticalHealth ?? 8)) {
                this.instance.tasks.cancelAll("WORKER: critical health; assignment interrupted");
                if (bot.health > 0)
                    this.instance.combat.enqueueFlee();
            } };
            const returnBase = async () => { check(); note("RETURN"); await runGoto(this.instance, w.base.x, w.base.y, w.base.z, 1, token, report, { canDig: false, allowPlace: false, timeoutMs: 30000 }); };
            const sort = async () => { for (const item of bot.inventory.items()) {
                const c = category(item.name);
                if (c && !w.containers[c])
                    throw Error(`MISSING_CONTAINER: ${c}`);
            } for (const [name, p] of Object.entries(w.containers)) {
                check();
                const items = bot.inventory.items().filter(i => category(i.name) === name).map(i => i.name);
                if (!items.length)
                    continue;
                const keepCounts: Record<string, number> = { bread: 4, wheat_seeds: 8, carrot: 4, potato: 4, beetroot_seeds: 8 };
                for (const i of bot.inventory.items())
                    if (/_pickaxe$|_sword$/.test(i.name) && usable(i, bot.registry, w.minDurability))
                        keepCounts[i.name] = 1;
                const r = await depositToChest(this.instance, { ...p, items: [...new Set(items)], keepCounts }, token, report);
                record.deposited += r.movedTotal;
                note("DEPOSIT", { container: name, moved: r.moved, left: r.left });
                if (r.left.length)
                    throw Error("STORAGE_FULL: verified items remain");
            } };
            bot.on("health", health);
            try {
                deadlineTimer = setTimeout(() => { this.instance.tasks.cancelAll("WORKER: deadline exceeded"); }, Math.max(0,end-Date.now()));
                for (let cycle = 0; cycle < job.cycles; cycle++) {
                    check();
                    note("CHECK", { cycle, health: bot.health, food: bot.food });
                    if(job.mode!=="return"&&!bot.inventory.items().some(i=>isFood(i.name)&&!this.instance.config.survival.foodBlacklist.includes(i.name)&&!this.instance.config.inventory.bannedItems.includes(i.name))){const p=w.containers.FOOD;if(!p)throw Error("MISSING_FOOD_CONTAINER");await withdrawFromChest(this.instance,{...p,item:"bread",count:4},token,report);note("FOOD_PROVISIONED");}

                    if (bot.food <= w.foodThreshold) {
                        if (!await this.instance.survival.eatBest()) {
                            const p = w.containers.FOOD;
                            if (!p)
                                throw Error("MISSING_FOOD_CONTAINER");
                            await withdrawFromChest(this.instance, { ...p, item: "bread", count: 8 }, token, report);
                            if (!await this.instance.survival.eatBest())
                                throw Error("MISSING_FOOD");
                        }
                    }
                    await this.instance.combat.equipBestWeapon();
                    const before = count(job.item);
                    let result = "";
                    const supply = async (item: string, needed: number): Promise<void> => {
                        check();
                        if(count(item)>=needed)return;
                        const stock:Record<string,number>={};
                        for(const [c,p] of Object.entries(w.containers)) {
                            if(c!=="TOOLS")Object.assign(stock,await readChestStock(this.instance,p,token,report));
                        }
                        const inventory:Record<string,number>={};
                        for(const i of bot.inventory.items())inventory[i.name]=(inventory[i.name]??0)+i.count;
                        const steps=planSupply(item,needed,inventory,stock,
                            n=>{const id=bot.registry.itemsByName[n]?.id;return id==null?[]:bot.recipesAll(id,null,true);},
                            id=>bot.registry.items[id]?.name??"");
                        for(const step of steps){
                            check();
                            if(step.recipe){
                                const id=bot.registry.itemsByName[step.item].id;
                                const output=step.recipe.delta.find(d=>d.id===id&&d.count>0)!.count;
                                await runSmartCraftInline(this.instance,step.item,count(step.item)+step.count*output,token,report,false,step.recipe);
                                note("SUPPLY_CRAFT",{item:step.item,operations:step.count,delta:step.recipe.delta});
                            }else{
                                const p=w.containers[category(step.item)??""];
                                if(!p)throw Error(`MISSING_CONTAINER: ${step.item}`);
                                await withdrawFromChest(this.instance,{...p,item:step.item,count:step.count},token,report);
                                note("SUPPLY_WITHDRAW",{item:step.item,count:step.count});
                            }
                        }
                        if(count(item)<needed)throw Error(`SUPPLY_RESULT_MISMATCH: ${item}`);
                    };
                    if (job.mode === "miner") {
                        const tool = bot.inventory.items().find(i => /_pickaxe$/.test(i.name) && usable(i, bot.registry, w.minDurability));
                        if (!tool) {
                            const p = w.containers.TOOLS;
                            if (p) {
                                try {
                                    await withdrawFromChest(this.instance, { ...p, item: "wooden_pickaxe", count: 1 }, token, report);
                                }
                                catch (e) {
                                    note("TOOL_WITHDRAW", { error: String(e) });
                                }
                            }
                        }
                        if (!bot.inventory.items().some(i => /_pickaxe$/.test(i.name) && usable(i, bot.registry, w.minDurability))) {
                            await supply("wooden_pickaxe", count("wooden_pickaxe") + 1);
                        }
                        const capacity=bot.inventory.items().filter(i=>/_pickaxe$/.test(i.name)&&usable(i,bot.registry,w.minDurability)).reduce((n,i)=>n+Math.max(0,(bot.registry.items[i.type]?.maxDurability??0)-(i.durabilityUsed??0)-w.minDurability+1),0);
                        const missingCapacity=Math.max(0,job.count-count(job.item)-capacity);
                        if(missingCapacity){const max=bot.registry.itemsByName.wooden_pickaxe?.maxDurability??59;const spares=Math.ceil(missingCapacity/Math.max(1,max-w.minDurability+1));if(spares>8)throw Error("TOOL_CAPACITY: assignment needs more than8 spare tools; split into smaller jobs");await supply("wooden_pickaxe",count("wooden_pickaxe")+spares);}
                        await runGoto(this.instance,job.origin.x,job.origin.y,job.origin.z,2,token,report,{canDig:false,allowPlace:false,timeoutMs:30000});
                        token.workArea = { origin: job.origin, radius: job.radius };
                        let error: unknown;
                        for (let attempt = 0; attempt < job.attempts && count(job.item) < job.count; attempt++) {
                            check();
                            try {
                                await runSmartCollectBlock(this.instance, job.item, job.count, token, report, "target");
                                error = undefined;
                                break;
                            }
                            catch (e) {
                                error = e;
                                note("MINING_ATTEMPT", { attempt, error: String(e) });
                            }
                        }
                        record.produced += Math.max(0, count(job.item) - before);
                        if (count(job.item) < job.count)
                            result = `PARTIAL: ${count(job.item)}/${job.count}; ${String(error ?? "resource unavailable")}`;
                    }
                    else if (job.mode === "farmer") {
                        const seed = ({ wheat: "wheat_seeds", carrot: "carrot", potato: "potato", beetroot: "beetroot_seeds" } as Record<string, string>)[job.item];
                        if (!seed)
                            throw Error("Unsupported assigned crop");
                        if (count(seed) < 1)
                            await supply(seed, 8);
                        const harvestBefore=count(job.item);
                        const crop=({wheat:"wheat",carrot:"carrots",potato:"potatoes",beetroot:"beetroots"} as Record<string,string>)[job.item];
                        await runGoto(this.instance,job.origin.x,job.origin.y,job.origin.z,2,token,report,{canDig:false,allowPlace:false,timeoutMs:30000});
                        token.workArea = { origin: job.origin, radius: Math.ceil(job.radius*Math.SQRT2)+1 };
                        result = await this.instance.farm.runHarvest({ ...job.origin, assignedCrop:crop, radius: job.radius, maxBlocks: 64, replant: true, depositNearest: false }, token, report);
                        record.produced += Math.max(0, count(job.item) - harvestBefore);
                        note("HARVEST", { result, baseline:harvestBefore, remaining:count(job.item) });
                        if (/failed: [1-9]|error/i.test(result))
                            throw Error(result);
                    }
                    else if (job.mode === "crafter") {
                        await supply(job.item, before + job.count);
                        record.produced += Math.max(0, count(job.item) - before);
                        if (count(job.item) < job.count)
                            throw Error("CRAFT_RESULT_MISMATCH");
                    }
                    await returnBase();
                    if (job.mode !== "return")
                        await sort();
                    check();
                    record.cycles++;
                    note("CYCLE_COMPLETE", { cycle: record.cycles });
                    report({ done: record.cycles, total: job.cycles, label: `verified cycles ${record.cycles}/${job.cycles}` });
                    if (result.startsWith("PARTIAL:")) {
                        record.state = "PARTIAL";
                        record.reason = result;
                        break;
                    }
                    if (cycle + 1 < job.cycles) {
                        note("WAIT_NEXT_CYCLE");
                        const until = Math.min(end, Date.now() + job.intervalMs);
                        while (Date.now() < until) {
                            check();
                            await new Promise(r => setTimeout(r, 250));
                        }
                    }
                }
                if (record.state === "RUNNING")
                    record.state = "DONE";
            }
            catch (e) {
                record.state = token.cancelled ? "INTERRUPTED" : "FAILED";
                record.reason = record.interruptionReason||(e instanceof Error ? e.message : String(e));
                throw e;
            }
            finally {
                if (deadlineTimer)
                    clearTimeout(deadlineTimer);
                bot.removeListener("health", health);
                record.finishedAt = Date.now();
                this.save();
            }
        });
        taskId=queued.id;
        if(record.state==="QUEUED")queuedDeadline=setTimeout(()=>{record.interruptionReason="DEADLINE: assignment expired in queue";this.instance.tasks.cancel(queued.id,record.interruptionReason);cleared(record.interruptionReason);},Math.max(0,expiresAt-Date.now()));
        return queued;
    }
}
