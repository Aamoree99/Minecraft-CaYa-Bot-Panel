import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir,userInfo} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
test("updater preflight rejects dirty trees and loss of patch history",()=>{
 const dir=mkdtempSync(join(tmpdir(),"caya-updater-test-"));const app=join(dir,"repo"),state=join(dir,"state");mkdirSync(app);mkdirSync(state);
 const git=(...args:string[])=>{const r=spawnSync("git",args,{cwd:app,encoding:"utf8"});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const check=(ref:string)=>spawnSync("bash",[resolve("scripts/caya-update"),"--check",ref],{encoding:"utf8",env:{...process.env,CAYA_UPDATE_APP:app,CAYA_UPDATE_STATE:state,CAYA_UPDATE_USER:userInfo().username}});
 try{git("init","-b","sauna/development");git("config","user.name","Test");git("config","user.email","test@example.test");writeFileSync(join(app,"source"),"one");git("add","source");git("commit","-m","base");const base=git("rev-parse","HEAD");assert.equal(check("HEAD").status,0);writeFileSync(join(app,"source"),"two");assert.equal(check("HEAD").status,2);git("add","source");git("commit","-m","patch");assert.equal(check(base).status,2);assert.equal(check("--bad").status,2);assert.equal(check("HEAD").status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("updater uses the verified deployed revision rather than a newer development HEAD",()=>{
 const dir=mkdtempSync(join(tmpdir(),"caya-deployed-test-"));const app=join(dir,"repo"),state=join(dir,"state");mkdirSync(app);mkdirSync(state);
 const git=(...args:string[])=>{const r=spawnSync("git",args,{cwd:app,encoding:"utf8"});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 try {git("init","-b","sauna/development");git("config","user.name","Test");git("config","user.email","test@example.test");writeFileSync(join(app,"source"),"stable");git("add","source");git("commit","-m","deployed");const deployed=git("rev-parse","HEAD");writeFileSync(join(state,"deployed-revision"),deployed+"\n");writeFileSync(join(app,"source"),"new");git("add","source");git("commit","-m","development");
 const r=spawnSync("bash",[resolve("scripts/caya-update"),"--check","HEAD"],{encoding:"utf8",env:{...process.env,CAYA_UPDATE_APP:app,CAYA_UPDATE_STATE:state,CAYA_UPDATE_USER:userInfo().username}});assert.equal(r.status,0,r.stderr);assert.ok(r.stdout.includes(`previous ${deployed}`),r.stdout);
 }finally {rmSync(dir,{recursive:true,force:true});}
});
