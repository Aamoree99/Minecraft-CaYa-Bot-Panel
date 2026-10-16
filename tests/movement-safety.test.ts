import test from "node:test";
import assert from "node:assert/strict";
import {safeDropLimit,unexpectedFall} from "../server/src/modules/movement/safety";
test("configured maximum drop is a ceiling",()=>{assert.equal(safeDropLimit(20,3),3);assert.equal(safeDropLimit(20,0),0);assert.equal(safeDropLimit(5,10),4);});
test("unexpected large fall is detected including its landing",()=>{assert.equal(unexpectedFall(251,245,3,false),true);assert.equal(unexpectedFall(251,248,3,false),false);assert.equal(unexpectedFall(251,253,3,false),false);});
test("water avoids a dry-fall false alarm",()=>assert.equal(unexpectedFall(251,245,3,true),false));
