/* Product name rules (INV-PRODUCT-NAME-FALLBACK, decision (أ)):
 * no write-time copy — an empty Arabic name stays empty and the English
 * name stays in its own field. The English name is a DISPLAY fallback
 * only: lists show it when the Arabic name is empty, but it is never
 * written into the Arabic field, so reopening the edit form still shows
 * an empty Arabic field. */

/** Names as they are submitted on save: trimmed, never copied across. */
export function resolveProductSubmitNames(values: {
  name?: string | null;
  nameEn?: string | null;
}): { name: string; nameEn: string } {
  return {
    name: values.name?.trim() || '',
    nameEn: values.nameEn?.trim() || '',
  };
}

/** Name as shown in lists: Arabic first, English only when Arabic is empty. */
export function displayProductName(product: {
  name?: string | null;
  nameEn?: string | null;
}): string {
  return product.name?.trim() || product.nameEn?.trim() || '';
}
