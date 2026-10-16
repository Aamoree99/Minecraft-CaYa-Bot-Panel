import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const arrival of ["travel", "equip"]) test(`mining rechecks inventory after ${arrival} before breaking another block`, () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "-e", `
    (async()=>{
      const assert=require('node:assert/strict'),{Vec3}=require('vec3');
      let count=0,digs=0;
      const path=require.resolve('./server/src/modules/movement/index.ts');
      require.cache[path]={id:path,filename:path,loaded:true,exports:{runGoto:async()=>{if('${arrival}'==='travel')count=64;}}};
      const equipPath=require.resolve('./server/src/modules/worker/equipment.ts');
      require.cache[equipPath]={id:equipPath,filename:equipPath,loaded:true,exports:{equipUsableTool:async()=>{if('${arrival}'==='equip')count=64;}}};
      const block={name:'stone',type:1,position:new Vec3(1,201,0),canHarvest:()=>true};
      const bot={health:20,entity:{position:new Vec3(0,201,0)},registry:require('minecraft-data')('26.3'),
        inventory:{items:()=>count?[{name:'cobblestone',count}]:[]},findBlock:()=>block,blockAt:()=>block,canDigBlock:()=>true,
        dig:async()=>{digs++;throw Error('unnecessary dig');},stopDigging:()=>{},digTime:()=>1,entities:{}};
      const {runSmartCollectBlock}=require('./server/src/modules/gather/smartGather.ts');
      await runSmartCollectBlock({bot,status:'online',config:{movement:{canDig:true}}},'cobblestone',64,{cancelled:false},()=>{},'target');
      assert.equal(digs,0);assert.equal(count,64);
    })().catch(e=>{console.error(e);process.exitCode=1});
  `], { cwd:process.cwd(), encoding:"utf8", timeout:10000 });
  assert.equal(result.status,0,result.stderr+result.stdout);
});
