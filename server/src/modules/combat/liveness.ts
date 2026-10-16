import type {Bot} from "mineflayer";
const dead=new WeakSet<object>();
const tracked=new WeakSet<object>();
export function trackEntityDeaths(bot:Pick<Bot,"on"|"once"|"removeListener">):void{
 if(tracked.has(bot))return;tracked.add(bot);
 const died=(entity:object)=>{dead.add(entity);};
 bot.on("entityDead",died);bot.once("end",()=>{bot.removeListener("entityDead",died);});
}
export function isDeadEntity(entity:{isValid?:boolean;health?:number}):boolean{return dead.has(entity)||entity.isValid===false||typeof entity.health==="number"&&entity.health<=0;}
