/** Pathfinder's diagonal shortcut checks the cheaper side; a straight client path
 * can still clip the other corner. Workers require both side columns clear. */
export function guardWorkerCorners(movements: any): void {
  const diagonal = movements.getMoveDiagonal.bind(movements);
  movements.getMoveDiagonal = (node: any, dir: {x:number,z:number}, neighbors: any[]) => {
    for(const [x,z] of [[dir.x,0],[0,dir.z]])
      for(const y of [0,1]) {
        const block=movements.getBlock(node,x,y,z);
        if(!block || block.physical || block.safe===false)return;
      }
    diagonal(node,dir,neighbors);
  };
}
