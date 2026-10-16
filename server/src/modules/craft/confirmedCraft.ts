import type { Bot } from "mineflayer";
import type { TaskToken } from "../../core/TaskQueue";
import { confirmedWindowClick } from "../inventory/confirmedClicks";

/** Keep Mineflayer recipe execution, but confirm its public click/put-away primitives
 * on HashedSlot clients. In particular, exhausting an ingredient must not leave
 * a guessed empty cursor or race the next crafting-slot update.
 */
export async function craftConfirmed(bot: Bot, recipe: Parameters<Bot["craft"]>[0], table: Parameters<Bot["craft"]>[2], token: TaskToken) {
  if (bot._client.protocolVersion < 770) { await bot.craft(recipe, 1, table); return; }
  const originalClick = bot.clickWindow;
  const originalPutAway = bot.putAway;
  const originalPutSelected = bot.putSelectedItemRange;
  const placeCursor = async (start: number, end: number, win: any, preferred?: number) => {
    for (let attempts=0; win.selectedItem && attempts<128; attempts++) {
      if (token.cancelled) throw new Error(token.reason ?? "cancelled");
      const selected=win.selectedItem;
      const accepts=(slot:number)=>!win.slots[slot] || (win.slots[slot].type===selected.type && win.slots[slot].count<selected.stackSize && JSON.stringify(win.slots[slot].components)===JSON.stringify(selected.components));
      let dest=preferred!=null && preferred>=start && preferred<end && accepts(preferred)?preferred:-1;
      if(dest<0) for(let i=start;i<end;i++)if(accepts(i)){dest=i;break;}
      if(dest<0)throw new Error("Inventory full while returning craft cursor");
      const before=selected.count;
      await confirmedWindowClick(bot,dest,0,token);
      if(win.selectedItem && win.selectedItem.count>=before)throw new Error("Server rejected craft cursor return");
    }
    if(win.selectedItem)throw new Error("Craft cursor return attempt limit");
  };
  bot.clickWindow = (async (slot: number, button: number, mode: number) => {
    if(mode!==0) return originalClick.call(bot,slot,button,mode);
    await confirmedWindowClick(bot,slot,button,token);
  }) as Bot["clickWindow"];
  bot.putSelectedItemRange = placeCursor as Bot["putSelectedItemRange"];
  bot.putAway = (async (slot: number) => {
    const win=bot.currentWindow ?? bot.inventory;
    await confirmedWindowClick(bot,slot,0,token);
    await placeCursor(win.inventoryStart,win.inventoryEnd,win);
  }) as Bot["putAway"];
  try { await bot.craft(recipe,1,table); }
  finally { bot.clickWindow=originalClick;bot.putAway=originalPutAway;bot.putSelectedItemRange=originalPutSelected; }
}
