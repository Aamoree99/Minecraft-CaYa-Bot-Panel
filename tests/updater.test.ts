import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
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
test("unwritable generated output fails preflight before maintenance",{skip:process.getuid?.()===0},()=>{
 const dir=mkdtempSync(join(tmpdir(),"caya-permissions-test-"));const app=join(dir,"repo"),state=join(dir,"state");mkdirSync(app);mkdirSync(state);
 const git=(...args:string[])=>{const r=spawnSync("git",args,{cwd:app,encoding:"utf8"});assert.equal(r.status,0,r.stderr);};
 try {git("init","-b","sauna/development");git("config","user.name","Test");git("config","user.email","test@example.test");writeFileSync(join(app,".gitignore"),"server/dist/\n");git("add",".gitignore");git("commit","-m","base");mkdirSync(join(app,"server/dist"),{recursive:true});writeFileSync(join(app,"server/dist/output.js"),"output",{mode:0o444});
 const r=spawnSync("bash",[resolve("scripts/caya-update"),"--check","HEAD"],{encoding:"utf8",env:{...process.env,CAYA_UPDATE_APP:app,CAYA_UPDATE_STATE:state,CAYA_UPDATE_USER:userInfo().username}});assert.equal(r.status,2);assert.match(r.stderr,/not writable/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test("updater prepares native archives before ci and stops on bootstrap failure",()=>{
 const dir=mkdtempSync(join(tmpdir(),"caya-native-update-test-"));const app=join(dir,"repo"),bin=join(dir,"bin"),trace=join(dir,"calls");mkdirSync(app);mkdirSync(bin);
 const source=readFileSync(resolve("scripts/caya-update"),"utf8");const build=source.match(/^build\(\) \{[\s\S]*?^\}/m)?.[0];assert.ok(build);
 writeFileSync(join(bin,"npm"),`#!/bin/sh
echo "$*" >> "$TRACE"
if [ "$*" = "run prepare:native-deps" ] && [ "$FAIL_BOOTSTRAP" = "yes" ]; then exit 42; fi
`,{mode:0o755});
 const run=(fail=false)=>{writeFileSync(trace,"");const result=spawnSync("bash",["-c",'as_caya() { "$@"; }\n'+build+'\nbuild'],{encoding:"utf8",env:{...process.env,APP:app,TRACE:trace,FAIL_BOOTSTRAP:fail?"yes":"no",PATH:bin+":"+process.env.PATH}});return {status:result.status,calls:readFileSync(trace,"utf8").trim().split("\n")};};
 try {
  const legacy=run();assert.equal(legacy.status,0);assert.match(legacy.calls[0]!,/^ci /);
  mkdirSync(join(app,"vendor/native"),{recursive:true});writeFileSync(join(app,"vendor/native/sources.json"),"{}");
  const native=run();assert.equal(native.status,0);assert.equal(native.calls[0],"run prepare:native-deps");assert.match(native.calls[1]!,/^ci /);assert.equal(native.calls.at(-1),"run build");
  const failure=run(true);assert.equal(failure.status,42);assert.deepEqual(failure.calls,["run prepare:native-deps"]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test("native archive integrity is independent of restrictive updater file permissions",()=>{
 const result=spawnSync("python3",["-B","-c",`
import importlib.util,tempfile,os
from pathlib import Path
spec=importlib.util.spec_from_file_location("native", "scripts/prepare-native-deps.py")
native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);package=root/"package";package.mkdir()
 plain=package/"plain.js";plain.write_text("module.exports=1\\n")
 executable=package/"exec.js";executable.write_text("#!/usr/bin/env node\\n")
 plain.chmod(0o644);executable.chmod(0o755);native.archive(package,root/"a.tgz")
 plain.chmod(0o600);executable.chmod(0o700);native.archive(package,root/"b.tgz")
 assert (root/"a.tgz").read_bytes()==(root/"b.tgz").read_bytes()
`],{encoding:"utf8"});assert.equal(result.status,0,result.stderr);
});
