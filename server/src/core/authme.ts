import type { Bot } from "mineflayer";
import fs from "node:fs";
import path from "node:path";

/** Explicit opt-in; passwords stay outside persistent JSON and source control. */
export function enableAuthMe(bot: Bot, username: string, directory = process.env.CAYA_AUTHME_SECRET_DIR): void {
  if (!directory || !/^[A-Za-z0-9_]{1,16}$/.test(username)) return;
  try {
    const file = path.join(directory, `${username}.pass`);
    const stat = fs.statSync(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) return;
    const password = fs.readFileSync(file, "utf8").trim();
    if (password) attachAuthMe(bot, password);
  } catch { /* No configured protected secret: operator login remains available. */ }
}

export function attachAuthMe(bot: Pick<Bot, "on" | "once" | "removeListener" | "chat">, password: string,
  options: { delayMs?: number; minGapMs?: number } = {}): void {
  let attempts = 0, last = -Infinity, done = false;
  let timer: NodeJS.Timeout | undefined;
  const clear = () => { if (timer) clearTimeout(timer); timer = undefined; };
  const message = (text: string, position: string) => {
    if (position === "chat" || done) return;
    if (/successful login|logged in|already logged/i.test(text)) { done = true; clear(); return; }
    if (!/\/login\b/i.test(text) || timer || attempts >= 3 || Date.now() - last < (options.minGapMs ?? 3000)) return;
    attempts++; last = Date.now();
    timer = setTimeout(() => { timer = undefined; if (!done) { try { bot.chat(`/login ${password}`); } catch { /* ended */ } } }, options.delayMs ?? 500);
  };
  bot.on("messagestr", message);
  bot.once("end", () => { done = true; clear(); bot.removeListener("messagestr", message); });
}
