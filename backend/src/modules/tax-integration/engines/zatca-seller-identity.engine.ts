import { BadRequestException } from '@nestjs/common';

/**
 * ZATCA seller identity (INV-ZATCA-SELLER-IDENTITY-AND-PROFILE):
 * the signed document must attest the TENANT's own identity, never
 * a hardcoded demo name or a fabricated VAT number. The VAT number
 * comes from the active ZATCA_SAUDI tax-settings row; the name
 * follows the established precedence companyName setting, then
 * storeName setting, then the tenant's registered business name.
 * Settings values may be JSON-quoted strings or legacy raw text.
 * Anything missing, inactive, blank, or malformed fails closed
 * BEFORE the ICV chain advances — a signed document must never
 * carry an identity the tenant did not configure.
 */
export function parseSettingsText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'string' ? parsed.trim() : trimmed;
  } catch {
    return trimmed;
  }
}

export function resolveZatcaSellerIdentity(input: {
  taxId?: unknown;
  isActive?: unknown;
  companyName?: unknown;
  storeName?: unknown;
  businessName?: unknown;
}): { sellerName: string; sellerVatNumber: string } {
  if (input.isActive === false) {
    throw new BadRequestException('ZATCA tax settings are inactive; activate them before signing invoices.');
  }
  const taxId = typeof input.taxId === 'string' ? input.taxId.trim() : '';
  if (!/^\d{15}$/.test(taxId)) {
    throw new BadRequestException(
      'ZATCA seller VAT number is not configured; set a 15-digit ZATCA tax ID before signing invoices.',
    );
  }
  const sellerName =
    parseSettingsText(input.companyName) ||
    parseSettingsText(input.storeName) ||
    (typeof input.businessName === 'string' ? input.businessName.trim() : '');
  if (!sellerName) {
    throw new BadRequestException('ZATCA seller name is not configured; set a company name before signing invoices.');
  }
  return { sellerName, sellerVatNumber: taxId };
}
