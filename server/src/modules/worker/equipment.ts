import type { Bot } from "mineflayer";
import { usable, workspace } from "./policy";
// Keep armor-manager's existing slot/material comparison; add durability reserve.
const armor = require("mineflayer-armor-manager/dist/lib/invUtil");
export async function equipUsableArmor(bot: Bot): Promise<void> {
    if (bot.currentWindow)
        return;
    for (const item of bot.inventory.items().filter(i => usable(i, bot.registry, workspace?.minDurability ?? 8)).sort((a, b) => (a.durabilityUsed ?? 0) - (b.durabilityUsed ?? 0))) {
        const dest = armor.findArmorDestination(item), index = armor.findArmorDestinationIndex(item);
        if (!dest || index < 0)
            continue;
        const current = armor.equipped(bot.inventory, !bot.supportFeature("doesntHaveOffHandSlot"))[index];
        if (!current || !usable(current, bot.registry, workspace?.minDurability ?? 8) || armor.isNewArmorBetter(current, item))
            await bot.equip(item, dest);
    }
}

/** Reuse tool plugin dig-time scoring, but never offer an exhausted tool. */
export async function equipUsableTool(bot:Bot,block:any,banned:string[]=[]):Promise<void>{
 const b=bot as any;if(!b.tool)bot.loadPlugin(require("mineflayer-tool").plugin);
 const candidates=bot.inventory.items().filter(i=>!banned.includes(i.name)&&usable(i,bot.registry,workspace?.minDurability??8)&&block.canHarvest(i.type));
 const empty=block.canHarvest(null);const best=candidates.sort((a,b)=>bToolTime(a)-bToolTime(b))[0];
 function bToolTime(item:any){return b.tool.getDigTime(block,item);}
 if(!best){if(!empty)throw Error(`MISSING_TOOL: cannot harvest ${block.name}`);if(bot.heldItem)await bot.unequip("hand");return;}
 if(empty&&bToolTime(undefined)<=bToolTime(best)){if(bot.heldItem)await bot.unequip("hand");return;}
 if(bot.heldItem?.slot!==best.slot)await bot.equip(best,"hand");
}
