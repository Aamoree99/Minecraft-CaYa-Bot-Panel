import type { BotInstance } from "../../core/BotInstance";
import { isTokenAborted, type TaskToken } from "../../core/TaskQueue";

// One CaYa process: serialize a complete read/transfer/confirmation transaction.
// This is not a reservation of a recipe, nor a lock against human players.
const busy = new Set<string>();
const waiting = new Map<string, Set<() => void>>();

export async function withResourceAccess<T>(key: string, token: TaskToken, action: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 30000;
  while (busy.has(key)) {
    if (isTokenAborted(token)) throw Error(token.reason ?? "cancelled");
    if (Date.now() >= deadline) throw Error("STORAGE_BUSY: container access deadline");
    await new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const done = () => { clearTimeout(timer); waiting.get(key)?.delete(done); token.abort?.signal.removeEventListener("abort", done); resolve(); };
      const list = waiting.get(key) ?? new Set<() => void>();
      list.add(done); waiting.set(key, list);
      token.abort?.signal.addEventListener("abort", done, {once:true});
      timer = setTimeout(done, 100);
    });
  }
  if (isTokenAborted(token)) throw Error(token.reason ?? "cancelled");
  busy.add(key);
  try { return await action(); }
  finally {
    busy.delete(key);
    const list = waiting.get(key); waiting.delete(key);
    for (const wake of list ?? []) wake();
  }
}

/** Conservative prototype: one storage transaction per server profile/dimension.
 * All bots sharing a world must share that profile. Separate processes and
 * external players require reconciliation; this does not reserve recipe inputs.
 */
export function withStorageAccess<T>(instance: BotInstance, token: TaskToken, action: () => Promise<T>): Promise<T> {
  return withResourceAccess(JSON.stringify([instance.config.serverId,instance.runtime.dimension]),token,action);
}
