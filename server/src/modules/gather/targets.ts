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
