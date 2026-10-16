import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("per-bot personas persist independently and reach only the selected bot prompt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "caya-persona-test-"));
  process.env.CAYA_DATA_DIR = dir;
  try {
    const { defaultMcpSettings, defaultMcpBotSettings, loadMcpSettings, saveMcpSettings } = await import("../server/src/modules/agent/settings");
    const { AgentService } = await import("../server/src/modules/agent");
    const { AgentRuntime } = await import("../server/src/modules/agent/runtime");
    const settings = defaultMcpSettings();
    settings.chat.personality = "Shared friendly helper";
    settings.bots.caya = defaultMcpBotSettings();
    const service: any = {
      settings,
      manager: { mustGet: (id: string) => { assert.ok(["caya", "partnerbot"].includes(id)); } },
      emitStatus() {}
    };
    const patch = (id: string, value: any) => AgentService.prototype.setBotAgent.call(service, id, value);
    patch("partnerbot", { personality: "Friendly mathematician", agentEnabled: false });
    patch("partnerbot", { goal: "Count resources" });
    await saveMcpSettings(settings);
    const restored = loadMcpSettings();
    assert.equal(restored.bots.partnerbot.personality, "Friendly mathematician");
    assert.equal(restored.bots.caya.personality, "");
    assert.equal(restored.chat.personality, "Shared friendly helper");
    assert.equal(restored.bots.partnerbot.agentEnabled, false);
    assert.equal(restored.bots.partnerbot.autopilot, false);
    const prompt = (id: string) => {
      const runtime: any = new AgentRuntime({
        inst: { config: { id, username: id, serverId: "test" } },
        manager: { getServer: () => ({ name: "Test", host: "localhost" }) }
      } as any);
      runtime.stateSnapshot = () => "stopped";
      return runtime.buildSystemPrompt(restored, true, "game") as string;
    };
    assert.match(prompt("partnerbot"), /PERSONA: Friendly mathematician/);
    assert.doesNotMatch(prompt("partnerbot"), /PERSONA: Shared/);
    assert.match(prompt("caya"), /PERSONA: Shared friendly helper/);
    assert.doesNotMatch(prompt("caya"), /mathematician/);
    assert.match(prompt("partnerbot"), /SAME language/);
    assert.match(prompt("partnerbot"), /replies must be SHORT/);
    patch("partnerbot", { personality: "x".repeat(700) });
    assert.equal(settings.bots.partnerbot.personality?.length, 600);
    patch("partnerbot", { personality: "" });
    await saveMcpSettings(settings);
    restored.bots.partnerbot = settings.bots.partnerbot;
    assert.match(prompt("partnerbot"), /PERSONA: Shared friendly helper/);
    // Legacy files have no per-bot persona: defaults must preserve the shared behavior.
    writeFileSync(join(dir, "mcp.json"), JSON.stringify({ chat: { personality: "Legacy" }, bots: { caya: { goal: "Old goal" } } }));
    const legacy = loadMcpSettings();
    assert.equal(legacy.bots.caya.personality, "");
    assert.equal(legacy.bots.caya.goal, "Old goal");
    assert.equal(legacy.chat.personality, "Legacy");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
