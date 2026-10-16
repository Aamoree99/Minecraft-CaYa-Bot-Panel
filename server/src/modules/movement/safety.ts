/** Configuration is a maximum, never permission to silently raise drop height. */
export function safeDropLimit(health: number, configured = 3): number {
  const ceiling = Number.isFinite(configured) ? Math.max(0, Math.min(10, configured)) : 3;
  const affordable = 3 + Math.max(0, Math.floor((Number.isFinite(health) ? health : 20) - 4));
  return Math.min(ceiling, affordable);
}
export function unexpectedFall(lastGroundY: number, currentY: number, limit: number, inLiquid: boolean): boolean {
  return !inLiquid && lastGroundY - currentY > limit + 0.25;
}
