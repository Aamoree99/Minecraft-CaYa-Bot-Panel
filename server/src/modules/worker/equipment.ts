import type {Bot} from "mineflayer";
import {usable,workspace} from "./policy";
// Keep armor-manager's existing slot/material comparison; add durability reserve.
const armor=require("mineflayer-armor-manager/dist/lib/invUtil");
export async function equipUsableArmor(bot:Bot):Promise<void>{
 if(bot.currentWindow)return;
 for(const item of bot.inventory.items().filter(i=>usable(i,bot.registry,workspace?.minDurability??8)).sort((a,b)=>(a.durabilityUsed??0)-(b.durabilityUsed??0))){
  const dest=armor.findArmorDestination(item),index=armor.findArmorDestinationIndex(item);
  if(!dest||index<0)continue;
  const current=armor.equipped(bot.inventory,!bot.supportFeature("doesntHaveOffHandSlot"))[index];
  if(!current||!usable(current,bot.registry,workspace?.minDurability??8)||armor.isNewArmorBetter(current,item))await bot.equip(item,dest);
 }
}
