import { BadRequestException } from '@nestjs/common';

export class ImportApprovalGateSlice {
  constructor() {}

  /**
   * Helper to verify and consume a Maker-Checker approval request for sensitive actions
   */
  async verifyAndConsumeApprovalRequest(
    trx: any,
    tenantId: string,
    actionType: string,
    referenceId: string,
    approvalRequestId?: string,
    expectedDetails?: {
      amount?: number;
      projectId?: string;
      partnerId?: string;
      currency?: string;
      proformaInvoiceId?: string;
      supplierId?: string;
      paymentMethod?: string;
      shipmentId?: string;
      receiptId?: string;
      brokerExpenseId?: string;
      tripId?: string;
    },
  ): Promise<void> {
    if (!approvalRequestId) return;

    const req = await trx
      .selectFrom('import_approval_requests')
      .selectAll()
      .where('id', '=', approvalRequestId)
      .where('tenant_id', '=', tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!req) {
      throw new BadRequestException('طلب الاعتماد (Maker-Checker) المحدد غير موجود.');
    }

    if (req.action_type !== actionType) {
      throw new BadRequestException(`نوع طلب الاعتماد (${req.action_type}) لا يطابق الإجراء المطلوب (${actionType}).`);
    }

    if (req.status === 'executed') {
      throw new BadRequestException(
        'طلب الاعتماد تم استهلاكه وتنفيذه مسبقاً ولا يمكن استخدامه مجدداً (Single-Use Token).',
      );
    }

    if (req.status !== 'approved') {
      throw new BadRequestException(
        `طلب الاعتماد غير مؤهل للتنفيذ، حالته الحالية (${req.status}) وليست معتمدة (approved).`,
      );
    }

    if (referenceId && req.reference_id && req.reference_id !== referenceId) {
      throw new BadRequestException(
        `طلب الاعتماد مرتبط بمرجع (${req.reference_id}) يختلف عن المعرف المطلوب (${referenceId}).`,
      );
    }

    if (expectedDetails && !req.request_payload) throw new BadRequestException('بيانات الموافقة التفصيلية إلزامية.');
    if (req.request_payload) {
      const payload =
        typeof req.request_payload === 'string' ? JSON.parse(req.request_payload || '{}') : req.request_payload;

      if (expectedDetails?.partnerId && payload.partnerId !== expectedDetails.partnerId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص للشريك (${payload.partnerId}) ولا يطابق الشريك المطلوب (${expectedDetails.partnerId}).`,
        );
      }

      if (expectedDetails?.projectId && payload.projectId !== expectedDetails.projectId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص للمشروع (${payload.projectId}) ولا يطابق المشروع (${expectedDetails.projectId}).`,
        );
      }

      // Supplier binding: compare as strings — the payload may
      // carry the supplier id as a number (trip-expense
      // approvals) while the caller passes a string, and the
      // binding must mean "the same supplier", not "the same
      // JSON type" (INV-IMPORT-FX-TRIPS-POSTING).
      if (expectedDetails?.supplierId && String(payload.supplierId ?? '') !== String(expectedDetails.supplierId)) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص للمورد (${payload.supplierId}) ولا يطابق المورد المطلوب (${expectedDetails.supplierId}).`,
        );
      }

      // Receipt binding (INV-IMPORT-RECEIPT-REVERSAL): a reversal
      // or legacy-review approval authorizes exactly one shipment
      // and one receipt. The reference_id already binds the
      // shipment; these payload checks bind the receipt and
      // reject a token minted for a different document.
      if (expectedDetails?.shipmentId && payload.shipmentId !== expectedDetails.shipmentId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص للشحنة (${payload.shipmentId}) ولا يطابق الشحنة المطلوبة (${expectedDetails.shipmentId}).`,
        );
      }
      if (expectedDetails?.receiptId && String(payload.receiptId ?? '') !== expectedDetails.receiptId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص لسند استلام (${payload.receiptId}) ولا يطابق سند الاستلام المطلوب (${expectedDetails.receiptId}).`,
        );
      }

      // Broker-expense binding (INV-IMPORT-BROKER-CAPITALISATION): a
      // verification approval authorizes exactly one broker
      // expense. The reference_id already binds the expense id;
      // this payload check binds the expense id carried in the
      // payload too, so a token minted for another receipt cannot
      // verify this one.
      if (
        expectedDetails?.brokerExpenseId &&
        String(payload.brokerExpenseId ?? '') !== expectedDetails.brokerExpenseId
      ) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص لمصروف مخلص (${payload.brokerExpenseId}) ولا يطابق المصروف المطلوب (${expectedDetails.brokerExpenseId}).`,
        );
      }

      // Sourcing-trip binding (INV-IMPORT-FX-TRIPS-POSTING): a
      // trip-expense approval authorizes exactly one trip. The
      // reference_id already binds the trip id; this payload
      // check binds the trip id carried in the payload too.
      if (expectedDetails?.tripId && String(payload.tripId ?? '') !== expectedDetails.tripId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص لرحلة توريد (${payload.tripId}) ولا يطابق الرحلة المطلوبة (${expectedDetails.tripId}).`,
        );
      }

      if (expectedDetails?.currency && String(payload.currency || '').toUpperCase() !== expectedDetails.currency) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص لعملة (${payload.currency}) ولا يطابق عملة الحوالة المطلوبة (${expectedDetails.currency}).`,
        );
      }

      if (expectedDetails?.proformaInvoiceId && payload.proformaInvoiceId !== expectedDetails.proformaInvoiceId) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص للفاتورة المبدئية (${payload.proformaInvoiceId}) ولا يطابق الفاتورة المطلوبة (${expectedDetails.proformaInvoiceId}).`,
        );
      }

      // Payment-method binding (INV-IMPORT-PAYMENT-METHODS): an
      // approval that names a payment method authorizes only that
      // method, exactly like the currency binding above. An
      // approval with no method in its payload cannot authorize a
      // method-bound transfer: the approver never saw the method.
      if (expectedDetails?.paymentMethod && payload.paymentMethod !== expectedDetails.paymentMethod) {
        throw new BadRequestException(
          `طلب الاعتماد مخصص لطريقة دفع (${payload.paymentMethod}) ولا يطابق طريقة الدفع المطلوبة (${expectedDetails.paymentMethod}).`,
        );
      }

      if (expectedDetails?.amount !== undefined) {
        if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0)
          throw new BadRequestException('الموافقة لا تحتوي على سقف مبلغ صالح.');
        const approvedAmount = Number(payload.amount);
        if (expectedDetails.amount > approvedAmount + 0.01) {
          throw new BadRequestException(
            `مبلغ الصرف المطلوب (${expectedDetails.amount.toFixed(2)}) يتجاوز سقف المبلغ المعتمد في طلب الموافقة (${approvedAmount.toFixed(2)}).`,
          );
        }
      }
    }

    // Mark as executed so it cannot be replayed or reused
    await trx
      .updateTable('import_approval_requests')
      .set({
        status: 'executed',
        decided_at: new Date(),
      })
      .where('id', '=', approvalRequestId)
      .where('tenant_id', '=', tenantId)
      .execute();
  }
}
