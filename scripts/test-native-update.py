#!/usr/bin/env python3
"""Root-only isolated integration test: real npm/build/systemd/HTTP, synthetic state.
Never connects a Minecraft bot or invokes the production updater/unit.
"""
import hashlib, json, os, pathlib, shutil, subprocess, tempfile, time, urllib.request
P=pathlib.Path
assert os.geteuid()==0, "Run as root in the installed CT"
source=P(__file__).resolve().parent.parent
root=P(tempfile.mkdtemp(prefix="caya-native-update-",dir="/var/tmp"))
root.chmod(0o755)
app=root/"app"; state=root/"state"; hooks=root/"hooks"; protected=root/"protected"
unit="caya-native-update-test-"+root.name.rsplit("-",1)[-1]+".service"
unitfile=P("/run/systemd/system")/unit
log=open(root/"integration.log","w")
print("SCRATCH",root,flush=True)
def run(args,check=True,**kw):
 return subprocess.run(list(map(str,args)),check=check,stdout=log,stderr=subprocess.STDOUT,**kw)
def git(*args):
 return subprocess.check_output(["runuser","-u","caya","--","git","-C",str(app),*args],text=True).strip()
def commit(message):
 git("add",".");git("-c","user.name=Updater integration","-c","user.email=integration@localhost","commit","-m",message)
 return git("rev-parse","HEAD")
def health():
 with urllib.request.urlopen("http://127.0.0.1:3003/api/state",timeout=5) as r:
  data=json.load(r);assert data["bots"]==[];assert "26.3" in data["supportedVersions"]
def digest():
 files=[state/"data/preservation.json",state/"secrets/Synthetic.pass",hooks/"synthetic.cjs",protected/"caya-bot-Synthetic.pass",unitfile]
 return {str(p):(hashlib.sha256(p.read_bytes()).hexdigest(),p.stat().st_mode & 0o777,p.stat().st_uid) for p in files}
def update(ref):
 return run(["bash",source/"scripts/caya-update",ref],check=False,env=env).returncode
try:
 run(["git","-c","safe.directory="+str(source),"clone","--no-hardlinks",source,app])
 for d in [state/"data",state/"secrets",hooks,protected]:d.mkdir(parents=True,exist_ok=True)
 (state/"data/preservation.json").write_text('{"synthetic":true,"value":"preserve"}\n')
 for p in [state/"secrets/Synthetic.pass",protected/"caya-bot-Synthetic.pass"]:p.write_text("synthetic-not-a-real-secret\n");p.chmod(0o600)
 (hooks/"synthetic.cjs").write_text("// isolated hook fixture\n")
 run(["chown","-R","caya:caya",app,state])
 git("switch","-c","integration/base")
 baseline=git("rev-parse","HEAD")
 (state/"deployed-revision").write_text(baseline+"\n")
 unitfile.write_text(f"[Service]\nType=simple\nUser=caya\nWorkingDirectory={app}\nEnvironment=PATH=/opt/node22/bin:/usr/bin:/bin\nEnvironment=CAYA_HOST=127.0.0.1\nEnvironment=CAYA_PORT=3003\nEnvironment=CAYA_DATA_DIR={state}/data\nExecStart=/opt/node22/bin/node {app}/server/dist/index.js\nRestart=no\n")
 run(["systemctl","daemon-reload"])
 env={**os.environ,"CAYA_UPDATE_APP":str(app),"CAYA_UPDATE_STATE":str(state),"CAYA_UPDATE_UNIT":unit,"CAYA_UPDATE_UNIT_FILE":str(unitfile),"CAYA_UPDATE_HOOKS":str(hooks),"CAYA_UPDATE_SECRET_DIR":str(protected)}
 assert update("HEAD")==0,"initial install"
 run(["systemctl","start",unit]);time.sleep(3);health()
 before=digest()
 git("switch","-c","integration/success")
 with (app/"docs/SAUNA_HANDOFF.md").open("a") as f:f.write("\nIsolated updater success fixture.\n")
 candidate=commit("isolated successful update")
 # Return to the previous source so the updater performs a real fast-forward.
 git("switch","integration/base")
 assert update(candidate)==0,"successful update"
 baseline=candidate
 assert (state/"deployed-revision").read_text().strip()==baseline
 health();assert digest()==before
 print("PASS success: real install/build/start/health and preservation",flush=True)
 results=[]
 for scenario in ["bootstrap","npm-ci","build","start","health"]:
  git("switch","-c","integration/"+scenario,baseline)
  if scenario=="bootstrap":
   p=app/"vendor/native/sources.json";data=json.loads(p.read_text());data["mineflayer"]["integrity"]="sha512-invalid";p.write_text(json.dumps(data,indent=2)+"\n")
  elif scenario=="npm-ci":
   p=app/"package.json";data=json.loads(p.read_text());data["dependencies"]["express"]="0.0.1";p.write_text(json.dumps(data,indent=2)+"\n")
  elif scenario=="build":
   p=app/"package.json";data=json.loads(p.read_text());data["scripts"]["build"]="npm run build -w server && node -e \"process.exit(42)\"";p.write_text(json.dumps(data,indent=2)+"\n")
  elif scenario=="start":
   p=app/"server/src/index.ts";p.write_text("process.exit(42);\n"+p.read_text())
  else:
   p=app/"server/src/index.ts";p.write_text(p.read_text().replace('const app = express();','const app = express();\n  app.get("/api/state", (_req, res) => { res.status(503).json({test: true}); });'))
  bad=commit("isolated failure: "+scenario)
  git("switch","-c","integration/run-"+scenario,baseline)
  offset=log.tell();rc=update(bad);log.flush()
  assert rc!=0,scenario+" unexpectedly succeeded"
  health();assert digest()==before,scenario+" state changed"
  assert (state/"deployed-revision").read_text().strip()==baseline
  assert git("rev-parse","HEAD")==baseline
  assert not git("status","--porcelain"),scenario+" dirty rollback tree"
  text=(root/"integration.log").read_text()[offset:]
  expected={"bootstrap":"Dependency integrity mismatch", "npm-ci":"npm ci", "build":"process.exit(42)","start":"Update failed", "health":"503"}[scenario]
  assert expected in text,scenario+" missing failure evidence"
  assert "Rollback build failed" not in text and "Rollback service health failed" not in text
  results.append({"scenario":scenario,"exit":rc,"rollback":"PASS"})
  print("PASS",scenario,"exit",rc,"rollback build/start/health/preservation",flush=True)
 # Validate all archived members stay inside synthetic fixture paths (no live secrets).
 import tarfile
 for archive in (state/"backups/updates").glob("*.tar.gz"):
  with tarfile.open(archive) as t:
   assert all(n.startswith(str(root).lstrip("/")+"/") or n==str(unitfile).lstrip("/") for n in t.getnames())
 (root/"results.json").write_text(json.dumps({"baseline":baseline,"results":results,"snapshot_isolation":"PASS"},indent=2))
 print("PASS all snapshots isolated; results",root/"results.json",flush=True)
finally:
 run(["systemctl","stop",unit],check=False)
 unitfile.unlink(missing_ok=True)
 run(["systemctl","daemon-reload"],check=False)
 run(["systemctl","reset-failed",unit],check=False)
 log.close()
 print("STOPPED isolated unit; scratch retained for inspection",root,flush=True)
