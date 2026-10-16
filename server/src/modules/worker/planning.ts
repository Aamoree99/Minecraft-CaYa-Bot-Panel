/** Pure bounded warehouse planner. Each branch reserves inputs before siblings. */
export type Recipe = { delta: Array<{id:number,count:number}>; requiresTable?: boolean };
export type SupplyStep = {item:string; count:number; recipe?:Recipe};
export function planSupply(item:string, needed:number, inventory:Record<string,number>, stock:Record<string,number>, recipes:(name:string)=>Recipe[], name:(id:number)=>string):SupplyStep[] {
    let budget=20000;
    type State={bag:Record<string,number>; stock:Record<string,number>; steps:SupplyStep[]};
    const clone=(s:State):State=>({bag:{...s.bag},stock:{...s.stock},steps:[...s.steps]});
    const take=(s:State,item:string,n:number,stack:Set<string>):State|null=>{
        if(--budget<0)throw Error("SUPPLY_PLAN_LIMIT");
        s=clone(s);
        const held=Math.min(n,s.bag[item]??0);s.bag[item]=(s.bag[item]??0)-held;n-=held;
        const stored=Math.min(n,s.stock[item]??0);s.stock[item]=(s.stock[item]??0)-stored;n-=stored;
        if(stored)s.steps.push({item,count:stored});
        if(!n)return s;
        if(stack.has(item)||stack.size>=5)return null;
        const next=new Set([...stack,item]);
        for(const recipe of recipes(item)){
            const output=recipe.delta.find(d=>d.count>0&&name(d.id)===item)?.count;
            if(!output||!recipe.delta.some(d=>d.count<0))continue;
            const operations=Math.ceil(n/output);
            let branch:State|null=clone(s);
            for(const d of recipe.delta.filter(d=>d.count<0)){
                branch=take(branch!,name(d.id),-d.count*operations,next);
                if(!branch)break;
            }
            if(!branch)continue;
            for(const d of recipe.delta.filter(d=>d.count>0)){
                const key=name(d.id);branch.bag[key]=(branch.bag[key]??0)+d.count*operations;
            }
            branch.bag[item]-=n;
            branch.steps.push({item,count:operations,recipe});
            return branch;
        }
        return null;
    };
    const result=take({bag:{...inventory},stock:{...stock},steps:[]},item,needed,new Set());
    if(!result)throw Error(`MISSING_MATERIAL: no bounded warehouse recipe for ${item} x${needed}`);
    return result.steps;
}
