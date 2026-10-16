import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("AI warehouse reads exclude foreign stock and bounded return cannot accept model coordinates or an unbounded job", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caya-agent-worker-"));
  try {
    const file = path.join(dir, "workspace.json");
    fs.writeFileSync(file, JSON.stringify({ dimension: "overworld", spawn: { x: 0, y: 70, z: 0 }, base: { x: 1, y: 70, z: 1 }, margin: 16, owned: [], containers: { WOOD: { x: 2, y: 70, z: 2 } } }));
    const result = spawnSync(process.execPath, ["--import", "tsx", "-e", `
      (async () => {
        const assert = require("node:assert/strict");
        const { executeTool } = require("./server/src/modules/agent/tools.ts");
        const { defaultMcpSettings } = require("./server/src/modules/agent/settings.ts");
        const settings = defaultMcpSettings(); settings.tools.movement = false;
        const actions = [];
        const row = { x: 2, y: 70, z: 2, dimension: "overworld", updatedAt: 1000, items: [{name:"spruce_log",count:8},{name:"spruce_log",count:5}] };
        const ctx = { settings, inst: { status: "online", bot: {}, config: { serverId: "s" }, enqueueAction: a => { actions.push(a); return {id:"task",label:"return"}; } }, manager: { worldMemory: { chestsFor: id => { assert.equal(id,"s"); return [row,{...row,x:90},{...row,dimension:"the_nether"}]; } } } };
        const stock = await executeTool(ctx,"get_storage_stock",{});
        assert.equal(stock.isError,false);
        const parsed = JSON.parse(stock.text); assert.equal(parsed.containers.length,1); assert.equal(parsed.containers[0].items[0].count,13); assert.match(parsed.source,/cached/);
        assert.equal((await executeTool(ctx,"worker_return",{})).isError,true);
        assert.equal(actions.length,0);
        settings.tools.movement = true;
        assert.equal((await executeTool(ctx,"worker_return",{origin:{x:9999,y:70,z:9999},deadlineMs:7200000,mode:"miner"})).isError,false);
        assert.equal(actions.length,1); assert.equal(actions[0].mode,"return"); assert.equal(actions[0].deadlineMs,30000); assert.deepEqual(actions[0].origin,{x:1,y:70,z:1}); assert.equal(actions[0].cycles,1);
        ctx.inst.status="stopped";
        assert.equal((await executeTool(ctx,"worker_return",{})).isError,true); assert.equal(actions.length,1);
      })().catch(e => { console.error(e); process.exitCode=1; });
    `], { cwd: process.cwd(), env: { ...process.env, CAYA_DATA_DIR: dir, CAYA_WORKSPACE_FILE: file }, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
