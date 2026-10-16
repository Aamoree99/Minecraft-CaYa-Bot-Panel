import test from "node:test";
import assert from "node:assert/strict";
import {harvestResultError} from "../server/src/modules/farm/result";
test("complete harvest and replant",()=>assert.equal(harvestResultError(3,3,0,true),null));
test("partial replant is explicit",()=>assert.match(harvestResultError(3,1,0,true)??"",/replanted 1\/3/));
test("harvest without replant requested",()=>assert.equal(harvestResultError(3,0,0,false),null));
test("failed cells and failed deposit are not success",()=>{assert.match(harvestResultError(2,2,1,true)??"",/1 failed/);assert.match(harvestResultError(3,3,0,true,"full")??"",/deposit.*full/);});
