import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { attachAuthMe } from "../server/src/core/authme";
class FakeBot extends EventEmitter { sent:string[]=[];chat(message:string){this.sent.push(message);} }
const pause=()=>new Promise(resolve=>setTimeout(resolve,15));
test("AuthMe ignores player chat prompts",async()=>{const bot=new FakeBot();attachAuthMe(bot as any,"test-only",{delayMs:1,minGapMs:0});bot.emit("messagestr","/login password","chat");await pause();assert.deepEqual(bot.sent,[]);bot.emit("end");});
test("AuthMe only attempts three system prompts",async()=>{const bot=new FakeBot();attachAuthMe(bot as any,"test-only",{delayMs:1,minGapMs:0});for(let i=0;i<5;i++){bot.emit("messagestr","Please /login password","system");await pause();}assert.equal(bot.sent.length,3);bot.emit("end");});
test("AuthMe successful login cancels delayed attempt",async()=>{const bot=new FakeBot();attachAuthMe(bot as any,"test-only",{delayMs:1,minGapMs:0});bot.emit("messagestr","/login password","system");bot.emit("messagestr","Successful login","system");await pause();assert.deepEqual(bot.sent,[]);bot.emit("end");});
test("AuthMe disconnect cancels delayed attempt and listeners",async()=>{const bot=new FakeBot();attachAuthMe(bot as any,"test-only",{delayMs:1,minGapMs:0});bot.emit("messagestr","/login password","system");bot.emit("end");await pause();assert.deepEqual(bot.sent,[]);assert.equal(bot.listenerCount("messagestr"),0);});
