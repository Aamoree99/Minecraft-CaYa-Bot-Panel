import { equipUsableTool } from "../worker/equipment";
import type { Bot } from "mineflayer";
import type { BotInstance } from "../../core/BotInstance";
import { abortToken, type ProgressFn, type TaskToken } from "../../core/TaskQueue";
import type { CountMode } from "./index";
import { boundedOp, digCancelable } from "../build/place";
import { runGoto } from "../movement";
import { gatherTarget, inWorkArea, inGatherTravelArea, GoalItemPickup, verifiedPickupDelta } from "./targets";
import { ringSearch } from "./ringSearch";

const miningDropBackoff = new WeakMap<Bot, WeakMap<object, number>>();

interface DropEntityLike {
  id: number;
  name?: string;
  position: Bot["entity"]["position"];
  getDroppedItem?: () => { name?: string } | null;
}

const WOOD_TO_PLANKS: Record<string, string> = {
  oak_planks: "oak_log",
  spruce_planks: "spruce_log",
  birch_planks: "birch_log",
  jungle_planks: "jungle_log",
  acacia_planks: "acacia_log",
  dark_oak_planks: "dark_oak_log",
  mangrove_planks: "mangrove_log",
  cherry_planks: "cherry_log",
  crimson_planks: "crimson_stem",
  warped_planks: "warped_stem",
  bamboo_planks: "bamboo_block"
};

const DROP_SOURCE_BLOCKS: Record<string, string[]> = {
  coal: ["coal_ore", "deepslate_coal_ore"],
  redstone: ["redstone_ore", "deepslate_redstone_ore"],
  diamond: ["diamond_ore", "deepslate_diamond_ore"],
  emerald: ["emerald_ore", "deepslate_emerald_ore"],
  lapis_lazuli: ["lapis_ore", "deepslate_lapis_ore"],
  quartz: ["nether_quartz_ore"],
  clay_ball: ["clay"],
  flint: ["gravel"],
  string: ["cobweb"],
  amethyst_shard: ["amethyst_cluster"]
};

const RAW_GATHERABLE = new Set([
  "dirt",
  "coarse_dirt",
  "rooted_dirt",
  "mud",
  "sand",
  "red_sand",
  "gravel",
  "clay",
  "netherrack",
  "soul_sand",
  "soul_soil",
  "blackstone",
  "basalt",
  "calcite",
  "tuff",
  "dripstone_block",
  "moss_block",
  "snow_block",
  "ice",
  "packed_ice",
  "blue_ice",
  "obsidian",
  "end_stone",
  "cobblestone",
  "cobbled_deepslate"
]);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function requireBot(instance: BotInstance): Bot {
  const bot = instance.bot;
  if (!bot || instance.status !== "online") throw new Error("Bot offline");
  return bot;
}

function countNamed(bot: Bot, names: Iterable<string>): number {
  const set = new Set(names);
  return bot.inventory.items().reduce((sum, item) => sum + (set.has(item.name) ? item.count : 0), 0);
}

function totalInventoryCount(bot: Bot): number {
  return bot.inventory.items().reduce((sum, item) => sum + item.count, 0);
}

function isItemEntity(entity: { name?: string } | null | undefined): boolean {
  const n = (entity?.name ?? "").toLowerCase();
  return n === "item" || n === "items" || n === "item_stack";
}

function droppedItemName(entity: unknown, bot?: Bot): string | null {
  const e = entity as {
    getDroppedItem?: () => { name?: string } | null;
    metadata?: unknown[];
    metadataKeys?: Record<string, number>;
  };
  try {
    const n = e.getDroppedItem?.()?.name;
    if (n) return n;
  } catch {
    /* 1.20.5+ fromNotch can throw — fall through to metadata */
  }
  const meta = e.metadata;
  if (!Array.isArray(meta) || !bot) return null;
  const ix = e.metadataKeys?.item ?? 8;
  const slot = meta[ix];
  if (slot && typeof slot === "object" && "name" in slot && typeof (slot as { name?: unknown }).name === "string") {
    return (slot as { name: string }).name;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Item = require("prismarine-item")(bot.version) as {
      fromNotch: (n: unknown) => { name?: string } | null;
    };
    const parsed = Item.fromNotch(slot);
    return parsed?.name ?? null;
  } catch {
    return null;
  }
}

/** diamond from diamond_ore, oak_log from oak_log, unknown name → keep (don't skip). */
function dropMatchesRequested(dropName: string | null, requested: string | undefined): boolean {
  if (!requested) return true;
  if (!dropName) return true;
  const f = requested.replace(/^minecraft:/, "").toLowerCase();
  const d = dropName.toLowerCase();
  if (d === f) return true;
  if (d.includes(f) || f.includes(d)) return true;
  for (const [item, blocks] of Object.entries(DROP_SOURCE_BLOCKS)) {
    if (d === item && blocks.includes(f)) return true;
    if (f === item && blocks.includes(d)) return true;
  }
  return false;
}

function entityExists(bot: Bot, id: number | undefined): boolean {
  if (id == null) return false;
  return Boolean(bot.entities[id]);
}

/**
 * Yerdeki item entity'lerini gerçekten kaybolmain veya inventory artmain kadar takip eder.
 * Eski kod yalnızca targete yürüdüğü for, pickup gerçekleşmese bile başarı sayıyordu.
 */
export async function runSmartCollectDrops(
  instance: BotInstance,
  filter: string | undefined,
  radius: number,
  token: TaskToken,
  report: ProgressFn,
  maxDurationMs = 45_000,
  retryAfter?: WeakMap<object, number>,
  stopWhen: () => boolean = () => false
): Promise<number> {
  const bot = requireBot(instance);
  const normalizedFilter = filter?.replace(/^minecraft:/, "").toLowerCase();
  const startedAt = Date.now();
  const failures = new Map<number, number>();
  let verified = 0;
  let quietPasses = 0;

  while (!token.cancelled && !stopWhen() && Date.now() - startedAt < maxDurationMs) {
    const drops = (Object.values(bot.entities) as DropEntityLike[]).filter((entity) => {
      if (!entity || !isItemEntity(entity)) return false;
      if ((retryAfter?.get(entity) ?? 0) > Date.now()) return false;
      if (bot.entity.position.distanceTo(entity.position) > radius) return false;
      if (token.workArea && !inWorkArea(entity.position, token.workArea.origin, token.workArea.radius)) return false;
      const name = droppedItemName(entity, bot);
      if (!dropMatchesRequested(name, normalizedFilter)) return false;
      if ((failures.get(entity.id) ?? 0) >= 3) return false;
      return true;
    });

    if (!drops.length) {
      quietPasses++;
      if (quietPasses >= 2) break;
      await sleep(160);
      continue;
    }
    quietPasses = 0;
    drops.sort(
      (a, b) =>
        bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
    );

    const target = drops[0]!;
    const beforeAll = totalInventoryCount(bot);
    const targetName = droppedItemName(target, bot);
    const beforeNamed = targetName ? countNamed(bot, [targetName]) : beforeAll;
    report({
      done: verified,
      total: verified + drops.length,
      label: `Ground items: ${targetName ?? "item"}`
    });

    const dist = bot.entity.position.distanceTo(target.position);
    const gotoTimeout = Math.max(4_000, Math.min(8_000, 2_500 + dist * 400));
    try {
      await runGoto(
        instance,
        target.position.x,
        target.position.y,
        target.position.z,
        1,
        token,
        () => {},
        { timeoutMs: gotoTimeout, canDig: false, allowPlace: false, parkour: false, goal: new GoalItemPickup(target.position) }
      );
    } catch {
      failures.set(target.id, (failures.get(target.id) ?? 0) + 1);
      retryAfter?.set(target, Date.now() + 30_000);
      await sleep(120);
      continue;
    }

    const waitUntil = Date.now() + 2_400;
    let picked = 0;
    while (!token.cancelled && Date.now() < waitUntil) {
      const afterAll = totalInventoryCount(bot);
      const afterNamed = targetName ? countNamed(bot, [targetName]) : afterAll;
      picked = verifiedPickupDelta(beforeAll, beforeNamed, afterAll, afterNamed, Boolean(targetName));
      if (picked > 0) break;
      await sleep(80);
    }

    if (picked) {
      verified += picked;
      failures.delete(target.id);
      retryAfter?.delete(target);
    } else {
      failures.set(target.id, (failures.get(target.id) ?? 0) + 1);
      retryAfter?.set(target, Date.now() + 30_000);

    }
  }

  if (token.cancelled) throw new Error(token.reason ?? "cancelled");
  const remaining = [...failures.keys()].filter(id => entityExists(bot, id)).length;
  if (remaining > 0) throw new Error(`PARTIAL: Picked up ${verified} items; ${remaining} drops could not be collected within the allowed time/attempts.`);
  report({ done: verified, total: verified, label: `Ground items picked up: ${verified}` });
  return verified;
}

/** Kazılan bloğun drop'unu, başka işe geçmeden önce toplar. */
export async function collectDropsAfterDig(
  instance: BotInstance,
  filter: string | undefined,
  token: TaskToken,
  stopWhen: () => boolean = () => false
): Promise<void> {
  await sleep(120);
  try {
    const bot=requireBot(instance);
    let retryAfter=miningDropBackoff.get(bot);
    if(!retryAfter){retryAfter=new WeakMap();miningDropBackoff.set(bot,retryAfter);}
    await runSmartCollectDrops(instance, filter, 8, token, () => {}, 14_000, retryAfter, stopWhen);
  } catch {
    // Kazma işlemini yalnızca pickup best-effort hatası yüzünden failed sayma.
  }
}

function directBlockMatcher(requested: string): (name: string) => boolean {
  const dropSources = DROP_SOURCE_BLOCKS[requested];
  if (dropSources) {
    const sourceSet = new Set(dropSources);
    return (name) => sourceSet.has(name);
  }
  if (requested === "cobblestone") return (name) => name === "stone" || name === "cobblestone";
  if (requested === "cobbled_deepslate") return (name) => name === "deepslate" || name === "cobbled_deepslate";
  if (requested.endsWith("_wool")) return (name) => name === requested;
  if (requested.endsWith("_concrete")) return (name) => name === requested;
  return (name) => name === requested;
}

function isLikelyCraftedItem(name: string): boolean {
  return (
    name.endsWith("_planks") ||
    name.endsWith("_stairs") ||
    name.endsWith("_slab") ||
    name.endsWith("_wall") ||
    name.endsWith("_fence") ||
    name.endsWith("_fence_gate") ||
    name.endsWith("_door") ||
    name.endsWith("_trapdoor") ||
    name.endsWith("_button") ||
    name.endsWith("_pressure_plate") ||
    name.endsWith("_sign") ||
    name.endsWith("_hanging_sign") ||
    name.endsWith("_carpet") ||
    name.endsWith("_bricks") ||
    name.endsWith("_tiles") ||
    name === "stick" ||
    name === "ladder" ||
    name === "barrel" ||
    name === "lantern" ||
    name === "soul_lantern" ||
    name === "crafting_table" ||
    name === "furnace" ||
    name === "decorated_pot"
  );
}

/**
 * Build malzemesi for mantıklı kaynak çözümü.
 * - species planks yalnızca aynı species log/stem kullanır
 * - craftable sonuçlar doğrudan worldda aranmak yerine recipe zincirine gider
 * - doğrudan blok araması `includes` değil kesin isim eşleşmesidir
 */
export async function runSmartCollectBlock(
  instance: BotInstance, name: string, amount: number, token: TaskToken,
  report: ProgressFn, countMode: CountMode = "add"
): Promise<void> {
  const bot = requireBot(instance);
  if (!instance.config.movement.canDig) throw new Error("Digging disabled; administrator must enable canDig");
  const parentArea = token.workArea;
  token.workArea ??= { origin: bot.entity.position.clone(), radius: 16 };
  const area = token.workArea;
  const guard = setInterval(() => {
    if (token.cancelled) return;
    const reason = !bot.entity || bot.health <= 0 ? "Bot died" : instance.status !== "online" ? "Connection lost"
      : !inGatherTravelArea(bot.entity.position, area.origin, area.radius) ? "Left permitted work area"
      : bot.entity.position.y < area.origin.y - 3 ? "Unsafe fall detected" : undefined;
    if (!reason) return;
    token.failureReason=reason;
    abortToken(token, reason);
    bot.pathfinder?.setGoal(null);
    bot.clearControlStates();
    bot.stopDigging();
  }, 100);
  try { await runSmartCollectBlockInner(instance, name, amount, token, report, countMode); }
  finally { clearInterval(guard); token.workArea = parentArea; }
}

async function runSmartCollectBlockInner(
  instance: BotInstance,
  name: string,
  amount: number,
  token: TaskToken,
  report: ProgressFn,
  countMode: CountMode = "add"
): Promise<void> {
  const bot = requireBot(instance);
  const source = name.replace(/^minecraft:/, "");
  const silk = Boolean(bot.heldItem?.enchants?.some((e) => e.name === "silk_touch"));
  const mapping = gatherTarget(bot.registry as never, source, silk);
  const requested = mapping.drop;
  const have = () => requested === "log"
    ? bot.inventory.items().reduce((sum, item) => sum + ((item.name.endsWith("_log") || item.name.endsWith("_stem")) ? item.count : 0), 0)
    : countNamed(bot, [requested]);
  const start = have();
  const target = countMode === "add"
    ? start + Math.max(1, Math.floor(amount))
    : Math.max(1, Math.floor(amount));

  if (requested.endsWith("_log") || requested.endsWith("_stem") || requested === "log") {
    await instance.gather.runCollectWood(
      target,
      requested === "log" ? undefined : requested,
      token,
      report,
      "target"
    );
    return;
  }

  const rawWood = WOOD_TO_PLANKS[requested];
  if (rawWood) {
    const missingPlanks = Math.max(0, target - have());
    if (!missingPlanks) return;
    const rawHave = countNamed(bot, [rawWood]);
    const rawTarget = rawHave + Math.ceil(missingPlanks / 4);
    report({ done: have(), total: target, label: `${requested} for ${rawWood} searching` });
    if (rawWood === "bamboo_block") {
      await runDirectWorldGather(instance, rawWood, rawTarget, token, report);
    } else {
      await instance.gather.runCollectWood(rawTarget, rawWood, token, report, "target");
    }
    await instance.craft.runCraftInline(requested, target, token, report);
    return;
  }

  if (!bot.registry.blocksByName[source] && (instance.craft.canCraft(requested) || isLikelyCraftedItem(requested))) {
    try {
      await instance.craft.runCraftInline(requested, target, token, report);
      if (have() >= target) return;
    } catch {
      // Tarif/ham madde zinciri çözülemezse aşağıda kesin blok aramasına düşer.
    }
  }

  await runDirectWorldGather(instance, requested, target, token, report, mapping.blocks);
}

async function runDirectWorldGather(
  instance: BotInstance,
  requested: string,
  target: number,
  token: TaskToken,
  report: ProgressFn,
  sourceBlocks?: Set<string>
): Promise<void> {
  const bot = requireBot(instance);
  const matcher = sourceBlocks ? (name: string) => sourceBlocks.has(name) : directBlockMatcher(requested);
  const countHave = () => {
    if (requested === "cobblestone") return countNamed(bot, ["cobblestone"]);
    if (requested === "cobbled_deepslate") return countNamed(bot, ["cobbled_deepslate"]);
    return countNamed(bot, [requested]);
  };

  let got = countHave();
  const startingInventory = got;
  let mined = 0;
  report({ done: Math.min(got, target), total: target, label: `${requested} ${got}/${target}` });
  let noProgress = 0;
  const skipped = new Set<string>();

  while (!token.cancelled) {
    got = countHave();
    if (got >= target) break;
    const area = token.workArea ?? { origin: bot.entity.position.clone(), radius: 16 };
    const block = bot.findBlock({
      matching: (b) => matcher(b.name) && (!b.position || (
        inWorkArea(b.position, area.origin, area.radius) && b.position.y >= Math.floor(area.origin.y) &&
        !skipped.has(`${Math.floor(b.position.x)},${Math.floor(b.position.y)},${Math.floor(b.position.z)}`)
      )),
      maxDistance: 32
    });
    if (!block) throw new Error(`PARTIAL: Collected ${got}/${target} ${requested}. No more reachable blocks in permitted area`);

    const key = `${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`;
    const before = got;
    const feetY = Math.floor(bot.entity.position.y);
    const standY = Math.abs(block.position.y - feetY) <= 2 ? block.position.y : feetY;
    try {
      await runGoto(instance, block.position.x, standY, block.position.z, 3, token, () => {}, {
        canDig: false,
        allowPlace: false,
        parkour: false,
        timeoutMs: 15_000
      });
    } catch {
      skipped.add(key);
      noProgress++;
      if (noProgress >= 8) throw new Error(`${requested}: no reachable block nearby`);
      continue;
    }
    if (token.cancelled) throw new Error(token.reason ?? "cancelled");

    got = countHave();
    if (got >= target) break;
    const live = bot.blockAt(block.position);
    if (!live || !matcher(live.name) || !bot.canDigBlock(live)) {
      skipped.add(key);
      noProgress++;
      if (noProgress >= 8) throw new Error(`${requested}: no diggable target found`);
      continue;
    }

    try {
      await equipUsableTool(bot,live);
      if (token.cancelled) throw new Error(token.reason ?? "cancelled");
      got = countHave();
      if (got >= target) break;
      if (!live.canHarvest(bot.heldItem?.type ?? null)) throw new Error(`Tool cannot harvest ${live.name}`);
      const wait = typeof bot.digTime === "function" ? bot.digTime(live) : 1_000;
      const ms = Math.max(3_000, Math.min(12_000, (Number.isFinite(wait) ? wait : 1_000) + 3_500));
      await boundedOp(digCancelable(bot, live, token), token, ms, `dig ${live.name}`, () => {
        try {
          (bot as unknown as { stopDigging?(): void }).stopDigging?.();
        } catch {
          /* */
        }
      });
      const remainingBlock = bot.blockAt(live.position);
      if (remainingBlock?.type === live.type) throw new Error("Server did not confirm block removal");
      mined++;
      await collectDropsAfterDig(instance, requested, token, () => countHave() >= target);
    } catch (error) {
      skipped.add(key);
      noProgress++;
      if (noProgress >= 8) {
        throw new Error(
          `${requested} could not dig: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      continue;
    }

    got = countHave();
    noProgress = got > before ? 0 : noProgress + 1;
    report({ done: Math.min(got, target), total: target, label: `Collected ${got}/${target} ${requested}; blocks mined ${mined}, items gained ${got - startingInventory}` });
    if (noProgress >= 8) throw new Error(`${requested}: dug but drop did not enter inventory`);
  }

  if (token.cancelled) throw new Error(token.reason ?? "cancelled");
}
