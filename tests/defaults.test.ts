import test from "node:test";
import assert from "node:assert/strict";
import {defaultBotConfig} from "../server/src/types";
test("new bots require explicit destructive permission",()=>{const b=defaultBotConfig("Test","server");assert.equal(b.autostart,false);assert.equal(b.movement.canDig,false);assert.equal(b.movement.allowPlace,false);assert.equal(b.combat.defendMode,"off");});
