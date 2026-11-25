import { AppError } from '../../../../common/errors/app-error';

/**
 * ZATCA invoice statuses under which the sale is immutable.
 *
 * Signing is the point of no return: generating the signed invoice
 * ('generated') advances the EGS unit's ICV chain, stores the signed
 * UBL XML, the invoice hash, and the QR on the sale, and there is no
 * reset path. 'cleared', 'reported', and 'warning' mean ZATCA accepted
 * the invoice. Editing or cancelling the sale after any of these
 * states would leave a signed attestation (and a consumed ICV)
 * describing amounts the books no longer contain, while the
 * replacement invoice would consume a second ICV for the same sale.
 *
 * 'not_submitted' was never signed; 'failed' and 'rejected' were never
 * accepted, so correcting and re-signing them is the only workable
 * path (the ICV-chain consequence of re-signing after a rejection
 * belongs to the submission package, not to this guard).
 */
export const ZATCA_SIGNED_STATUSES = ['generated', 'cleared', 'reported', 'warning'] as const;

export function isZatcaSignedStatus(status: unknown): boolean {
  return (ZATCA_SIGNED_STATUSES as readonly string[]).includes(
    String(status || '')
      .trim()
      .toLowerCase(),
  );
}

/** Throws before any mutation when the sale carries a signed ZATCA invoice. */
export function assertSaleNotZatcaSigned(status: unknown): void {
  if (!isZatcaSignedStatus(status)) return;
  throw new AppError(
    'فاتورة موقعة ضريبياً (ZATCA)؛ لا يمكن تعديلها أو إلغاؤها بعد التوقيع — التصحيح يكون بإشعار دائن.',
    'SALE_ZATCA_SIGNED_IMMUTABLE',
    422,
  );
}
