/** Source decrease AND destination increase must agree; never count a predicted click alone. */
export function transferredCount(before: readonly [number, number], after: readonly [number, number], wanted: number): number {
  return Math.max(0, Math.min(wanted, before[0] - after[0], after[1] - before[1]));
}
