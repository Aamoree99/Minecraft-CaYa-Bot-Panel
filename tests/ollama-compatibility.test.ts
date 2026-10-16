import test from "node:test";
import assert from "node:assert/strict";
import { ollamaChat } from "../server/src/modules/agent/ollama";

test("MLX compatibility preserves native structured calls and scopes thinking override to the selected profile", async () => {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  const call = { function: { name: "get_status", arguments: {} } };
  globalThis.fetch = (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [call] } }));
  }) as typeof fetch;
  try {
    const tool = { type: "function" as const, function: { name: "get_status", description: "status", parameters: { type: "object", properties: {} } } };
    const model = "qwen3.5-9b-abliterated:mlx-32k";
    const result = await ollamaChat({ host: "http://localhost", model }, [{ role: "user", content: "where?" }], [tool]);
    assert.deepEqual(result.tool_calls, [call]);
    assert.equal(bodies[0].think, false);
    assert.deepEqual(bodies[0].tools, [tool]);
    await ollamaChat({ host: "http://localhost", model }, [{ role: "tool", tool_name: "get_status", content: "real coordinates" }], []);
    assert.equal(bodies[1].think, false);
    await ollamaChat({ host: "http://localhost", model: "another-model" }, [], []);
    assert.equal(Object.hasOwn(bodies[2], "think"), false);
    await ollamaChat({ host: "http://localhost", model, think: true }, [], []);
    assert.equal(bodies[3].think, true);
  } finally {
    globalThis.fetch = original;
  }
});
