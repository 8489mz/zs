/** A fixed upper bound prevents list endpoints from materializing a tenant's full history. */
export function boundedPage(pageValue: unknown, sizeValue: unknown, maxSize = 200, defaultSize = 50): { page: number; pageSize: number; offset: number } {
  const rawPage = Number(pageValue);
  const rawSize = Number(sizeValue);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1;
  const pageSize = Number.isSafeInteger(rawSize) && rawSize > 0 ? Math.min(rawSize, maxSize) : defaultSize;
  return { page, pageSize, offset: (page - 1) * pageSize };
}
