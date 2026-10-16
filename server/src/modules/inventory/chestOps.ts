import { usable } from "../worker/policy";
import { withStorageAccess } from "./containerAccess";
import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import type { BotInstance } from "../../core/BotInstance";
import type { ProgressFn, TaskToken } from "../../core/TaskQueue";
import { boundedOp } from "../build/place";
import { confirmedWindowClick } from "./confirmedClicks";
import { transferredCount, transferWithConfirmation } from "./transfer";
import { runGoto } from "../movement";

/**
 * Issue #5 — güvenilir sandık transferi. Eski deposit "best-effort" idi: window
 * hataları sessizce yutuluyor, sandık doluyken bile "depozito bitti" deniyordu
 * (kullanıcı: "depolama var ama kaldıramıyoruz"). Bu çekirdek taşımayı envanter
 * sayımıyla DOĞRULAR, taşınamayanı raporlar ve hiçbir şey taşınamadıysa dürüstçe
 * hata fırlatır. Panel deposit/withdraw aksiyonları ve tarım döngüsü bunu paylaşır.
 */

export const CONTAINER_BLOCKS = new Set(["chest", "trapped_chest", "barrel"]);

export interface ChestTargetSpec {
  /** Optional durability reserve when selecting existing tools; worn stock is not supply. */
  minDurability?: number;
  /** belirli sandık koordinatı; verilmezse en yakın konteyner */
  x?: number;
  y?: number;
  z?: number;
  /** en-yakın araması için yarıçap (default 32) */
  searchRadius?: number;
}

export interface DepositSpec extends ChestTargetSpec {
  /** yalnız bu item adları (tam ad); boş → filter/keep kurallarına göre hepsi */
  items?: string[];
  /** ad-içerir filtresi (panel "filter" alanı) */
  filter?: string;
  /** item başına envanterde bırakılacak adet (ör. tohum sakla) */
  keepCounts?: Record<string, number>;
}

export interface DepositResult {
  chest: { x: number; y: number; z: number };
  moved: Array<{ name: string; count: number }>;
  movedTotal: number;
  /** taşınamayanlar (sandık dolu vb.) */
  left: Array<{ name: string; count: number }>;
  chestFull: boolean;
}

interface ContainerWindow {
  deposit?: (itemType: number, metadata: number | null, count: number) => Promise<void>;
  withdraw?: (itemType: number, metadata: number | null, count: number) => Promise<void>;
  items: () => Array<{ name: string; count: number }>;
  containerItems?: () => Array<{ name: string; count: number }>;
  close: () => void;
}

function requireBot(instance: BotInstance): Bot {
  const bot = instance.bot;
  if (!bot || instance.status !== "online") throw new Error("Bot offline");
  return bot;
}

function countByName(bot: Bot, name: string): number {
  const items = bot.currentWindow ? bot.currentWindow.items() : bot.inventory.items();
  return items.reduce((s, i) => s + (i.name === name ? i.count : 0), 0);
}

function containerCount(win: ContainerWindow, name: string): number {
  return win.containerItems?.().reduce((s, i) => s + (i.name === name ? i.count : 0), 0) ?? 0;
}

async function confirmWindow(bot: Bot, win: ContainerWindow, token: TaskToken) {
  const sync = (bot as unknown as { _syncWindow?: (w: unknown) => Promise<void> })._syncWindow;
  if (!sync) throw new Error("Server window confirmation unavailable");
  await boundedOp(sync.call(bot, win), token, 3000, "confirm container state");
}

/** Hedef sandığı çöz: koordinat verildiyse orada konteyner ara, yoksa en yakın. */
export function resolveContainerBlock(instance: BotInstance, spec: ChestTargetSpec): Block {
  const bot = requireBot(instance);
  if (spec.x != null && spec.y != null && spec.z != null) {
    const v = new Vec3(Math.floor(spec.x), Math.floor(spec.y), Math.floor(spec.z));
    const block = bot.blockAt(v);
    if (!block || !CONTAINER_BLOCKS.has(block.name)) {
      throw new Error(
        `No container at ${v.x},${v.y},${v.z} (found: ${block?.name ?? "unloaded chunk"}) — place a chest/barrel there or fix the coordinates.`
      );
    }
    return block;
  }
  const radius = Math.max(4, Math.min(64, spec.searchRadius ?? 32));
  const found = bot.findBlock({ matching: (b) => CONTAINER_BLOCKS.has(b.name), maxDistance: radius });
  if (!found) throw new Error(`No chest/barrel within ${radius} blocks.`);
  return found;
}

/** dünya-hafızasına sandık içeriğini bildir (panel storage görünümü) */
function emitChestMemory(instance: BotInstance, pos: Vec3, win: ContainerWindow) {
  try {
    instance.emit("chestOpened", {
      serverId: instance.config.serverId,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      dimension: instance.runtime.dimension,
      items: win.containerItems?.().map((i) => ({ name: i.name, count: i.count })) ?? []
    });
  } catch {
    /* memory best-effort */
  }
}

async function openContainerSafe(bot: Bot, block: Block, token: TaskToken): Promise<ContainerWindow> {
  const win = await boundedOp(bot.openContainer(block as never), token, 8_000, "openContainer");
  return win as unknown as ContainerWindow;
}

/**
 * Envanterden sandığa doğrulanmış transfer. Yürür, açar, item item yatırır;
 * her adımda gerçek envanter sayımıyla teyit eder.
 */
async function depositToChestUnlocked(
  instance: BotInstance,
  spec: DepositSpec,
  token: TaskToken,
  report: ProgressFn
): Promise<DepositResult> {
  const bot = requireBot(instance);
  report({ done: 0, total: 1, label: "locating chest" });
  const chest = resolveContainerBlock(instance, spec);
  const cPos = chest.position;

  await runGoto(instance, cPos.x, cPos.y, cPos.z, 2, token, report);
  if (token.cancelled) throw new Error(token.reason ?? "cancelled");

  const keep = instance.config.inventory.keepItems;
  const filter = (spec.filter ?? "").trim().toLowerCase();
  const only = spec.items?.length ? new Set(spec.items.map((n) => n.toLowerCase())) : null;
  const keepCounts = spec.keepCounts ?? {};

  /** item adı → yatırılacak toplam adet planı */
  const plan = new Map<string, number>();
  for (const it of bot.inventory.items()) {
    if (keep.includes(it.name)) continue;
    if (only && !only.has(it.name)) continue;
    if (!only && filter && !it.name.includes(filter)) continue;
    plan.set(it.name, (plan.get(it.name) ?? 0) + it.count);
  }
  for (const [name, hold] of Object.entries(keepCounts)) {
    if (plan.has(name)) plan.set(name, Math.max(0, plan.get(name)! - Math.max(0, hold)));
  }
  for (const [name, n] of [...plan.entries()]) if (n <= 0) plan.delete(name);

  const result: DepositResult = {
    chest: { x: cPos.x, y: cPos.y, z: cPos.z },
    moved: [],
    movedTotal: 0,
    left: [],
    chestFull: false
  };
  if (plan.size === 0) {
    report({ done: 1, total: 1, label: "nothing to deposit" });
    return result;
  }

  const win = await openContainerSafe(bot, chest, token);
  let lastError = "";
  try {
    const total = [...plan.values()].reduce((a, b) => a + b, 0);
    let done = 0;
    for (const [name, wanted] of plan) {
      if (token.cancelled) break;
      const def = bot.registry.itemsByName[name];
      if (!def) continue;
      await confirmWindow(bot, win, token);
      const before = countByName(bot, name);
      const target = Math.min(wanted, before);
      // sandık kısmen dolabilir — stack stack dene ki sığan kadarı kesin girsin
      let movedThis = 0;
      while (movedThis < target) {
        if (token.cancelled) break;
        const chunk = Math.min(64, target - movedThis);
        const snapshot: [number, number] = [countByName(bot, name), containerCount(win, name)];
        let opFailed = false;
        try {
          if (!win.deposit) throw new Error("Chest deposit API unavailable");
          await transferWithConfirmation(win as never, def.id, chunk, false, (slot, button) => confirmedWindowClick(bot, slot, button, token), async () => { await confirmWindow(bot, win, token); } );
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          opFailed = true;
        }
        // hata olsa bile kısmi transfer gerçekleşmiş olabilir — envanterden say
        // Mineflayer keeps bot.inventory stale until the container closes.
        // Request an authoritative window refresh before deciding or repeating.
        try { await confirmWindow(bot, win, token); } catch (e) {
          throw new Error(`Deposit confirmation failed; do not retry automatically: ${String(e)}`);
        }
        const delta = transferredCount(snapshot, [countByName(bot, name), containerCount(win, name)], chunk);
        if (delta > 0) movedThis += delta;
        if (opFailed) break;
        if (delta <= 0) {
          // sunucu taşımayı reddetti (dolu) — doğrulama farkı yakalar
          if (!lastError) lastError = "chest did not accept items (full?)";
          break;
        }
      }
      if (movedThis > 0) {
        result.moved.push({ name, count: movedThis });
        result.movedTotal += movedThis;
      }
      if (movedThis < target) {
        result.left.push({ name, count: target - movedThis });
      }
      done += target;
      report({ done: Math.min(done, total), total, label: `deposit ${name} ${movedThis}/${target}` });
    }
    emitChestMemory(instance, cPos, win);
  } finally {
    try {
      win.close();
    } catch {
      /* */
    }
  }
  if (token.cancelled) throw new Error(token.reason ?? "cancelled");

  result.chestFull = result.left.length > 0;
  if (result.movedTotal === 0) {
    throw new Error(
      `Deposit failed — nothing was stored${lastError ? ` (${lastError})` : ""}. Chest may be full; empty it or target another chest.`
    );
  }
  const movedTxt = result.moved.map((m) => `${m.name}×${m.count}`).join(", ");
  const leftTxt = result.left.length ? ` · could NOT fit: ${result.left.map((m) => `${m.name}×${m.count}`).join(", ")}` : "";
  report({ done: 1, total: 1, label: `deposited ${movedTxt}${leftTxt}` });
  return result;
}

export interface WithdrawSpec extends ChestTargetSpec {
  item: string;
  count: number;
}

/** Sandıktan doğrulanmış çekim (koordinat destekli). */
async function withdrawFromChestUnlocked(
  instance: BotInstance,
  spec: WithdrawSpec,
  token: TaskToken,
  report: ProgressFn
): Promise<number> {
  const bot = requireBot(instance);
  const item = spec.item.replace(/^minecraft:/, "").trim().toLowerCase();
  if (spec.minDurability !== undefined && (!Number.isInteger(spec.minDurability) || spec.minDurability < 1)) throw Error("Invalid durability reserve");
  const accepts = (i: any) => spec.minDurability === undefined || usable(i, bot.registry, spec.minDurability);
  const def = bot.registry.itemsByName[item];
  if (!def) throw new Error(`Unknown item: ${item}`);

  report({ done: 0, total: 1, label: "locating chest" });
  const chest = resolveContainerBlock(instance, spec);
  await runGoto(instance, chest.position.x, chest.position.y, chest.position.z, 2, token, report);
  if (token.cancelled) throw new Error(token.reason ?? "cancelled");

  const before = countByName(bot, item);
  const win = await openContainerSafe(bot, chest, token);
  let lastError = "";
  let confirmedGot = 0;
  try {
    await confirmWindow(bot, win, token);
    const inChest = win.containerItems?.().filter((i) => i.name === item && accepts(i)).reduce((s, i) => s + i.count, 0) ?? 0;
    const target = Math.min(Math.max(1, Math.floor(spec.count)), inChest || spec.count);
    let got = 0;
    while (got < target) {
      if (token.cancelled) break;
      const chunk = Math.min(64, target - got);
      const snapshot: [number, number] = [containerCount(win, item), countByName(bot, item)];
      let opFailed = false;
      try {
        if (!win.withdraw) throw new Error("Chest withdraw API unavailable");
        await transferWithConfirmation(win as never, def.id, chunk, true, (slot, button) => confirmedWindowClick(bot, slot, button, token), async () => { await confirmWindow(bot, win, token); }, accepts );
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        opFailed = true;
      }
      // hata sonrası bile kısmi çekim olabilir — envanterden doğrula
      await confirmWindow(bot, win, token);
      const delta = transferredCount(snapshot, [containerCount(win, item), countByName(bot, item)], chunk);
      if (delta > 0) {
        got += delta;
        confirmedGot = got;
        report({ done: got, total: target, label: `withdraw ${item} ${got}/${target}` });
      }
      if (opFailed) break;
      if (delta <= 0) {
        if (!lastError) lastError = "no items transferred (chest empty or inventory full?)";
        break;
      }
    }
    emitChestMemory(instance, chest.position, win);
  } finally {
    try {
      win.close();
    } catch {
      /* */
    }
  }
  if (token.cancelled) throw new Error(token.reason ?? "cancelled");

  const got = confirmedGot;
  if (got <= 0) {
    throw new Error(`Withdraw failed: ${item} — ${lastError || "not found in chest"}`);
  }
  report({ done: 1, total: 1, label: `withdrew ${item}×${got}` });
  return got;
}


/** Read a designated container through the same bounded, confirmed window path. */
async function readChestStockUnlocked(instance: BotInstance, spec: ChestTargetSpec, token: TaskToken, report: ProgressFn): Promise<Record<string, number>> {
  const bot = requireBot(instance), block = resolveContainerBlock(instance, spec);
  await runGoto(instance, block.position.x, block.position.y, block.position.z, 2, token, report);
  if (token.cancelled) throw Error(token.reason ?? "cancelled");
  const win = await openContainerSafe(bot, block, token);
  try {
    await confirmWindow(bot, win, token);
    emitChestMemory(instance, block.position, win);
    const stock: Record<string, number> = {};
    for (const item of win.containerItems?.() ?? []) if (spec.minDurability === undefined || usable(item, bot.registry, spec.minDurability)) stock[item.name] = (stock[item.name] ?? 0) + item.count;
    return stock;
  } finally { win.close(); }
}

export async function depositToChest(instance: BotInstance, spec: DepositSpec, token: TaskToken, report: ProgressFn): Promise<DepositResult> {
  const block = resolveContainerBlock(instance, spec);
  return withStorageAccess(instance, token, () => depositToChestUnlocked(instance, { ...spec, x:block.position.x, y:block.position.y, z:block.position.z }, token, report));
}

export async function withdrawFromChest(instance: BotInstance, spec: WithdrawSpec, token: TaskToken, report: ProgressFn): Promise<number> {
  const block = resolveContainerBlock(instance, spec);
  return withStorageAccess(instance, token, () => withdrawFromChestUnlocked(instance, { ...spec, x:block.position.x, y:block.position.y, z:block.position.z }, token, report));
}

export async function readChestStock(instance: BotInstance, spec: ChestTargetSpec, token: TaskToken, report: ProgressFn): Promise<Record<string, number>> {
  const block = resolveContainerBlock(instance, spec);
  return withStorageAccess(instance, token, () => readChestStockUnlocked(instance, { ...spec, x:block.position.x, y:block.position.y, z:block.position.z }, token, report));
}
