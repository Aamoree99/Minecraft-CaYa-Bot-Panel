import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { detachUntilEnd } from "../server/src/core/botCleanup";

test("stopping keeps library end cleanup and tolerates late socket errors", async () => {
 const bot = new EventEmitter();
 let ticks = 0;
 const timer = setInterval(() => ticks++, 5);
 let ended = 0;
 bot.once("end", () => { clearInterval(timer); ended++; });
 let staleMovement = 0;
 bot.on("move", () => staleMovement++);
 try {
  detachUntilEnd(bot);
  bot.emit("move");
  bot.emit("error", new Error("late socket error"));
  bot.emit("end");
  const before = ticks;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(ticks, before);
  assert.equal(ended, 1);
  assert.equal(staleMovement, 0);
  assert.equal(bot.listenerCount("end"), 0);
  assert.doesNotThrow(() => bot.emit("error", new Error("after end")));
 } finally { clearInterval(timer); }
});
