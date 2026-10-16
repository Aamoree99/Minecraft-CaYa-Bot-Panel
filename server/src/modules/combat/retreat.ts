import type {Bot} from "mineflayer";
import {Vec3} from "vec3";
import {insideWorld,type Workspace,type Point} from "../worker/policy";
export const retreatSeparation=(initial:number)=>Math.min(initial+4,10);
export function retreatCandidates(bot:Pick<Bot,"blockAt">,pos:Vec3,from:Point,dist:number,w?:Workspace):Vec3[]{
 const origin=pos.clone();origin.y=Math.ceil(origin.y);
 const initial=Math.hypot(pos.x-from.x,pos.z-from.z),required=retreatSeparation(initial);
    const angle = initial>0.1 ? Math.atan2(pos.z-from.z,pos.x-from.x) : 0;

    const candidates:Vec3[]=[];
    if(w)candidates.push(new Vec3(w.base.x,w.base.y,w.base.z));
    for(const distance of [dist,Math.min(dist,12),Math.min(dist,8),Math.min(dist,4)])for(const turn of [0,Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2,3*Math.PI/4,-3*Math.PI/4,Math.PI])candidates.push(origin.offset(Math.cos(angle+turn)*distance,0,Math.sin(angle+turn)*distance));
    const safe=candidates.filter(p=>{
      if(w&&!insideWorld(w,p))return false;
      if(Math.hypot(p.x-from.x,p.z-from.z)<required)return false;
      const floor=bot.blockAt(p.offset(0,-1,0)),feet=bot.blockAt(p),head=bot.blockAt(p.offset(0,1,0));
      return floor?.boundingBox==="block"&&!["magma_block","campfire","cactus"].includes(floor.name)&&feet?.name==="air"&&head?.name==="air";
    });
    const hazards=new Set(["fire","soul_fire","lava","water","powder_snow","cactus","sweet_berry_bush","campfire","soul_campfire"]);
    const clear=(p:Vec3)=>{const d=origin.distanceTo(p),steps=Math.ceil(d*2);for(let n=1;n<=steps;n++){const q=origin.offset((p.x-origin.x)*n/steps,(p.y-origin.y)*n/steps,(p.z-origin.z)*n/steps);if(hazards.has(bot.blockAt(q)?.name??"")||hazards.has(bot.blockAt(q.offset(0,1,0))?.name??"")||bot.blockAt(q)?.boundingBox!=="empty"||bot.blockAt(q.offset(0,1,0))?.boundingBox!=="empty"||bot.blockAt(q.offset(0,-1,0))?.boundingBox!=="block")return false;}return true;};
    const corridors=safe.filter(clear);
    const routes=corridors.sort((a,b)=>Math.hypot(b.x-from.x,b.z-from.z)-Math.hypot(a.x-from.x,a.z-from.z));
 return routes;
}
