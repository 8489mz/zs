export function compareSemver(v1: string, v2: string): number {
  const p1 = (v1 || '0.0.0').replace(/^[vV]/, '').split('.').map(Number);
  const p2 = (v2 || '0.0.0').replace(/^[vV]/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}
