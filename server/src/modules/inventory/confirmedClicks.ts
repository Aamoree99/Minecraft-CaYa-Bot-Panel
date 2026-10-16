import type { EventEmitter } from "events";
import type { Bot } from "mineflayer";
import type { TaskToken } from "../../core/TaskQueue";
import { boundedOp } from "../build/place";

/** A normal click with a stale state ID asks the server to return its authoritative
 * window. No guessed HashedSlot/component hashes, no optimistic cursor state.
 * Used by the 26.1 client, where Mineflayer still serializes ordinary Slot as HashedSlot.
 */
export async function confirmedWindowClick(bot: Bot, slot: number, button: number, token: TaskToken) {
  if (token.cancelled || token.abort?.signal.aborted) throw new Error(token.reason ?? "cancelled");
  const window = bot.currentWindow ?? bot.inventory;
  if (!bot.supportFeature("stateIdUsed") || bot._client.protocolVersion < 770) {
    await boundedOp(bot.clickWindow(slot, button, 0), token, 3000, "container click");
    return;
  }
  const events = bot as unknown as EventEmitter;
  let listener: (() => void) | undefined;
  const event = `setWindowItems:${window.id}`;
  let quietTimer: NodeJS.Timeout | undefined;
  const response = new Promise<void>((resolve) => {
    // Crafting can send more than one full-window update for a click.
    // Consume the complete response burst before inspecting the cursor.
    listener = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(resolve, 75);
    };
    events.on(event, listener);
  });
  try {
    bot._client.write("window_click", {
      windowId: window.id, stateId: -1, slot, mouseButton: button,
      mode: 0, changedSlots: [], cursorItem: null
    });
    await boundedOp(response, token, 3000, "server click confirmation");
  } finally { if (quietTimer) clearTimeout(quietTimer); if (listener) events.removeListener(event, listener); }
}
