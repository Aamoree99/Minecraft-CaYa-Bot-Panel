import test from "node:test";
import assert from "node:assert/strict";
import { transferredCount } from "../server/src/modules/inventory/transfer";
for (const [label,before,after,wanted,expected] of [
 ["complete",[16,0],[0,16],16,16],
 ["partial",[16,60],[12,64],16,4],
 ["rejected",[16,64],[16,64],16,0],
 ["unconfirmed destination",[16,0],[0,0],16,0],
 ["unconfirmed source",[16,0],[16,16],16,0],
 ["bounded",[32,0],[0,32],16,16]
] as const) test(label,()=>assert.equal(transferredCount(before,after,wanted),expected));
