import { goals } from "mineflayer-pathfinder";
export interface Point { x: number; y: number; z: number }
interface Registry {
  blocksByName: Record<string, {name: string; drops?: number[]}>;
  blocksArray: Array<{name: string; drops?: number[]}>;
  items: Record<number, {name: string}>;
}
/** Missing positions are palette prefilters, not real-world spatial candidates. */
export function inWorkArea(position: Point | null | undefined, origin: Point, radius: number): boolean {
  if (!position) return true;
  return Math.hypot(position.x-origin.x, position.y-origin.y, position.z-origin.z) <= radius;
}
/** Foot position may be off-center while reaching an in-area block; search stays exact. */
export function inGatherTravelArea(position:Point,origin:Point,radius:number):boolean {
  return inWorkArea(position,origin,radius+1);
}
export function gatherTarget(registry: Registry, requested: string, silk: boolean) {
  const block = registry.blocksByName[requested];
  const drop = block && silk ? requested : block && block.drops?.length === 1
    ? registry.items[block.drops[0]!]?.name ?? requested : requested;
  const blocks = new Set<string>();
  if (block && drop !== requested) blocks.add(requested);
  else {
    for (const candidate of registry.blocksArray) {
      if (candidate.name === requested || candidate.drops?.some((id) => registry.items[id]?.name === drop)) blocks.add(candidate.name);
    }
  }
  return { drop, blocks };
}

/** Path nodes are block coordinates; item pickup needs actual feet coordinates. */
export class GoalItemPickup extends goals.Goal {
  constructor(private readonly item: Point) { super(); }
  heuristic(node: Point): number {
    return Math.max(0, Math.hypot(node.x + 0.5 - this.item.x, node.z + 0.5 - this.item.z) - 0.8)
      + Math.max(0, Math.abs(node.y - this.item.y) - 0.8);
  }
  isEnd(node: Point): boolean {
    return Math.hypot(node.x + 0.5 - this.item.x, node.z + 0.5 - this.item.z) <= 0.8
      && Math.abs(node.y - this.item.y) <= 0.8;
  }
}

export function verifiedPickupDelta(beforeAll: number, beforeNamed: number, afterAll: number, afterNamed: number, knownName: boolean): number {
  return Math.max(0, knownName ? afterNamed - beforeNamed : afterAll - beforeAll);
}
