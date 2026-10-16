import { isDeadEntity, trackEntityDeaths } from "../combat/liveness";
import fs from "node:fs";
import type { Bot } from "mineflayer";
import type { BotInstance } from "../../core/BotInstance";
export interface Point {
    x: number;
    y: number;
    z: number;
}
export interface Box {
    min: Point;
    max: Point;
}
export interface Workspace {
    partnerUuids?: string[];
    spawn: Point;
    margin: number;
    base: Point;
    owned: Box[];
    protected: Box[];
    containers: Record<string, Point>;
    minDurability: number;
    criticalHealth: number;
    foodThreshold: number;
}
export function parseWorkspace(v: any): Workspace {
    const point = (p: any): p is Point => p && [p.x, p.y, p.z].every(Number.isFinite);
    if (!v || v.dimension !== "overworld" || !point(v.spawn) || !point(v.base) || !Number.isFinite(v.margin) || v.margin < 4 || v.margin > 64 || !Array.isArray(v.owned) || !v.containers)
        throw Error("Invalid trusted Overworld workspace");
    const w: Workspace = { ...v, protected:v.protected??[], minDurability: v.minDurability ?? 8, criticalHealth: v.criticalHealth ?? 8, foodThreshold: v.foodThreshold ?? 14 };
    if (w.partnerUuids !== undefined && (!Array.isArray(w.partnerUuids) || w.partnerUuids.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))))
        throw Error("Invalid trusted partner UUID roster");
    w.partnerUuids = [...new Set((w.partnerUuids ?? []).map(id => id.toLowerCase()))];
    if (!Number.isFinite(w.minDurability) || w.minDurability < 1)
        throw Error("Invalid durability threshold");
    if (!Number.isFinite(w.criticalHealth) || w.criticalHealth < 2 || w.criticalHealth > 18 || !Number.isFinite(w.foodThreshold) || w.foodThreshold < 1 || w.foodThreshold > 20)
        throw Error("Invalid survival thresholds");
    if(!Array.isArray(w.protected))throw Error("Invalid protected boxes");
    for (const b of [...w.owned,...w.protected])
        if (!point(b.min) || !point(b.max) || ["x", "y", "z"].some(k => (b.min as any)[k] > (b.max as any)[k]) || !insideWorld(w, b.min) || !insideWorld(w, b.max))
            throw Error("Invalid owned workspace box");
    for (const p of [w.base, ...Object.values(w.containers)])
        if (!point(p) || !insideWorld(w, p))
            throw Error("Workspace point outside authorized bounds");
    return w;
}
export function insideWorld(w: Workspace, p: Point, padding = w.margin): boolean { return !!p && [p.x, p.y, p.z].every(Number.isFinite) && p.x >= w.spawn.x - 4000 + padding && p.x <= w.spawn.x + 4000 - padding && p.z >= w.spawn.z - 4000 + padding && p.z <= w.spawn.z + 4000 - padding && p.y >= -64 && p.y <= 319; }
export function inBox(p: Point, b: Box): boolean { return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z; }
export function owned(w: Workspace, p: Point): boolean { return insideWorld(w, p) && w.owned.some(b => inBox(p, b)) && !w.protected.some(b=>inBox(p,b)); }
export function containerAllowed(w: Workspace, p: Point): boolean { return insideWorld(w, p) && Object.values(w.containers).some(c => c.x === p.x && c.y === p.y && c.z === p.z); }
export function usable(item: any, registry: any, min = 8): boolean { const max = registry?.items?.[item.type]?.maxDurability; if (!max)
    return true; const used = item.durabilityUsed ?? 0; return Number.isFinite(used) && used >= 0 && max - used >= min; }
const file = process.env.CAYA_WORKSPACE_FILE;
export const workspace: Workspace | undefined = file ? parseWorkspace(JSON.parse(fs.readFileSync(file, "utf8"))) : undefined;
export function assertPosition(p: Point, dimension = "overworld"): void { if (workspace && (dimension !== "overworld" || !insideWorld(workspace, p)))
    throw Error("BOUNDARY: target outside padded Overworld workspace"); }
export function assertOwned(p: Point): void { assertPosition(p); if (workspace && !owned(workspace, p))
    throw Error("OWNERSHIP: mutation outside explicitly assigned own area"); }
export function guardMovements(m: any): void { if (!workspace)
    return; const w = workspace; m.exclusionAreasStep.push((b: any) => insideWorld(w, b?.position) ? 0 : Infinity); m.exclusionAreasBreak.push((b: any) => owned(w, b?.position) ? 0 : Infinity); m.exclusionAreasPlace.push((b: any) => owned(w, b?.position) ? 0 : Infinity); }
// Trust is scoped to the reviewed workspace; names never confer partner status.
export function nearbyWorkerVisitor(bot: Pick<Bot,"players"|"username"|"entity">, partnerUuids: readonly string[] = workspace?.partnerUuids ?? []): boolean {
    const roster = new Set(partnerUuids.map(id => id.toLowerCase()));
    const selfUuid = bot.players?.[bot.username]?.uuid;
    const member = typeof selfUuid === "string" && roster.has(selfUuid.toLowerCase());
    return Object.values(bot.players??{}).some(p=>p.username!==bot.username && p.gamemode!==3 &&
        !(member && typeof p.uuid === "string" && roster.has(p.uuid.toLowerCase())) &&
        p.entity && p.entity.position.distanceTo(bot.entity.position)<24);
}
export function attachWorkspace(instance: BotInstance, bot: Bot): void {
    if (!workspace)
        return;
    trackEntityDeaths(bot);
    const w = workspace;
    let lastBlocked = 0;
    const tick = () => {
        if (!bot.entity || instance.status !== "online")
            return;
        const p = bot.entity.position, v = bot.entity.velocity;
        const job=instance.worker?.snapshot();
        if(job?.state==="RUNNING" && nearbyWorkerVisitor(bot)){
            const reason="OWNERSHIP: another player near active work area";
            if(job.interruptionReason!==reason){instance.worker.interrupt(reason);instance.tasks.cancelAll(reason);instance.invalidateControl(reason);}
            return;
        }
        if(Object.values(bot.entities).some(e=>e.name==="creeper"&&!isDeadEntity(e)&&e.position.distanceTo(p)<4)){
            const reason="CREEPER_PROXIMITY: no safe separation; emergency disconnect";
            instance.worker?.interrupt(reason);instance.tasks.cancelAll(reason);instance.stop();instance.runtime.lastError=reason;return;
        }
        if (instance.runtime.dimension !== "overworld" || !insideWorld(w, p, 0)) {
            instance.tasks.cancelAll("BOUNDARY: outside authorized Overworld; explicit safe recovery required");
            instance.stop();
            return;
        }
        if (!insideWorld(w, p.offset(v.x * 20, 0, v.z * 20)) && Date.now() - lastBlocked > 1000) {
            lastBlocked = Date.now();
            instance.tasks.cancelAll("BOUNDARY: approaching padded limit");
            instance.invalidateControl("BOUNDARY");
        }
    };
    bot.on("physicsTick", tick);
    bot.once("end", () => { bot.removeListener("physicsTick", tick); });
    const dimension = () => { if (instance.runtime.dimension !== "overworld")
        throw Error("BOUNDARY: Overworld only"); };
    const dig = bot.dig;
    bot.dig = (async (block: any, forceLook: any = true, direction: any = "auto") => { dimension(); assertOwned(block.position); if(bot.heldItem&&!usable(bot.heldItem,bot.registry,w.minDurability))throw Error("EQUIPMENT: worn tool cannot dig"); return dig.call(bot, block, forceLook, direction); }) as Bot["dig"];
    const place = bot.placeBlock;
    bot.placeBlock = (async function (this: Bot, block, face, ...args) { dimension(); assertOwned(block.position.plus(face)); if (this.heldItem && /bucket$/.test(this.heldItem.name))
        throw Error("SAFETY: worker liquid placement is disabled"); return place.call(this, block, face, ...args); }) as Bot["placeBlock"];
    const activate = bot.activateBlock;
    bot.activateBlock = (async function (this: Bot, block, ...args) { dimension(); assertPosition(block.position); if (["chest", "barrel", "trapped_chest"].includes(block.name)) {
        if (!containerAllowed(w, block.position))
            throw Error("OWNERSHIP: unassigned container");
    }
    else
        assertOwned(block.position); if (this.heldItem && /bucket$/.test(this.heldItem.name))
        throw Error("SAFETY: worker liquid use is disabled"); return activate.call(this, block, ...args); }) as Bot["activateBlock"];
    const activateItem=bot.activateItem;bot.activateItem=function(this:Bot,...args){if(this.heldItem&&/bucket$/.test(this.heldItem.name))throw Error("SAFETY: worker liquid use is disabled");return activateItem.call(this,...args);};
    const furnace=bot.openFurnace;bot.openFurnace=(async function(this:Bot,block,...args){dimension();if(!containerAllowed(w,block.position))throw Error("OWNERSHIP: unassigned furnace");return furnace.call(this,block,...args);}) as Bot["openFurnace"];
    const open = bot.openContainer;
    bot.openContainer = (async function (this: Bot, block, ...args) { dimension(); if (!containerAllowed(w, block.position))
        throw Error("OWNERSHIP: unassigned container"); return open.call(this, block, ...args); }) as Bot["openContainer"];
    const attack = bot.attack;
    bot.attack = function (this: Bot, entity, ...args) { dimension(); assertOwned(entity.position); if (entity.type === "player" || (entity as any).username || !["zombie", "skeleton", "spider", "creeper", "husk", "stray", "drowned", "cave_spider", "zombie_villager", "phantom"].includes(entity.name ?? ""))
        return; return attack.call(this, entity, ...args); };
    const equip = bot.equip;
    bot.equip = (async function (this: Bot, item, ...args) { if (typeof item === "object" && item && !usable(item, this.registry, w.minDurability))
        throw Error("EQUIPMENT: exhausted/worn item rejected"); return equip.call(this, item, ...args); }) as Bot["equip"];
}
