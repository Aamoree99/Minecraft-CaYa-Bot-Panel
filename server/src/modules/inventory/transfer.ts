/** Source decrease AND destination increase must agree; never count a predicted click alone. */
export function transferredCount(before: readonly [number, number], after: readonly [number, number], wanted: number): number {
  const removed = before[0] - after[0], added = after[1] - before[1];
  if (removed !== added || removed < 0 || removed > wanted)
    throw new Error(`TRANSFER_MISMATCH: source=${removed}, destination=${added}, requested=${wanted}; reconcile before retry`);
  return removed;
}

interface Stack { type: number; count: number; stackSize: number }
interface TransferWindow {
  slots: Array<Stack | null>;
  inventoryStart: number;
  inventoryEnd: number;
  selectedItem: Stack | null;
}
/** Ordinary inventory clicks, confirmed individually (modern protocols don't acknowledge accepted clicks). */
export async function transferWithConfirmation(
  win: TransferWindow, type: number, wanted: number, withdraw: boolean,
  click: (slot: number, button: number) => Promise<void>, confirm: () => Promise<void>
): Promise<void> {
  const sourceStart = withdraw ? 0 : win.inventoryStart;
  const sourceEnd = withdraw ? win.inventoryStart : win.inventoryEnd;
  const destStart = withdraw ? win.inventoryStart : 0;
  const destEnd = withdraw ? win.inventoryEnd : win.inventoryStart;
  const find = (start: number, end: number, pred: (item: Stack | null) => boolean) => {
    for (let i=start; i<end; i++) if (pred(win.slots[i] ?? null)) return i;
    return -1;
  };
  const checkedClick = async (slot: number, button: number) => { await click(slot,button); await confirm(); };
  let left = wanted;
  for (let attempts=0; left>0 && attempts<128; attempts++) {
    if (win.selectedItem) throw new Error("Container cursor occupied; refusing ambiguous transfer");
    const source = find(sourceStart,sourceEnd,(i)=>i?.type===type);
    if (source<0) break;
    let dest = find(destStart,destEnd,(i)=>i?.type===type && i.count<i.stackSize);
    if (dest<0) dest=find(destStart,destEnd,(i)=>i===null);
    if (dest<0) throw new Error("destination full");
    await checkedClick(source,0);
    const stack = win.selectedItem as Stack | null;
    if (!stack || stack.type!==type) throw new Error("Server rejected source pickup");
    const destination = win.slots[dest];
    const capacity = stack.stackSize - (destination?.count ?? 0);
    const amount = Math.min(left,stack.count,capacity);
    const before = destination?.count ?? 0;
    if (Math.min(stack.count,capacity) <= left) await checkedClick(dest,0);
    else for(let n=0;n<amount;n++) await checkedClick(dest,1);
    const moved = (win.slots[dest]?.count ?? 0)-before;
    if (win.selectedItem) await checkedClick(source,0);
    if (win.selectedItem) throw new Error("Server did not confirm cursor return");
    if (moved<=0) throw new Error("Server rejected destination transfer");
    left -= moved;
  }
  if (left>0) throw new Error(`Transfer incomplete: ${wanted-left}/${wanted}`);
}
