export function normalizeKey(target: string): string {
  const trimmed = String(target || '').trim();
  if (!trimmed || trimmed === '/') return '/';
  return trimmed.replace(/^\//, '').replace(/\/$/, '') || '/';
}
