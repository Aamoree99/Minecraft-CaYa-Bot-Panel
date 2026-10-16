export function harvestResultError(harvested: number, replanted: number, failed: number, replant: boolean, depositError?: string): string | null {
  const issues: string[]=[];
  if (failed) issues.push(`${failed} failed cells`);
  if (replant && replanted<harvested) issues.push(`replanted ${replanted}/${harvested} (missing seeds or planting rejected)`);
  if (depositError) issues.push(`deposit failed: ${depositError}`);
  return issues.length ? `PARTIAL: Harvested ${harvested}; ${issues.join("; ")}` : null;
}
