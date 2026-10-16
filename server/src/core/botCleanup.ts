import type { EventEmitter } from "node:events";

/** Keep library shutdown handlers until the socket emits its asynchronous end. */
export function detachUntilEnd(bot: EventEmitter): void {
  for (const event of bot.eventNames()) {
    if (event !== "end") bot.removeAllListeners(event);
  }
  const ignoreLateError = () => {};
  bot.on("error", ignoreLateError);
  bot.once("end", () => {
    bot.removeAllListeners();
    bot.on("error", ignoreLateError);
  });
}
