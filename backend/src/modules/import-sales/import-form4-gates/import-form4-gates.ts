// Import Form 4 gates — pure move from ImportSalesService (file #57).
import { BadRequestException } from '@nestjs/common';
import { Kysely, Selectable, Transaction } from 'kysely';
import { Database, ImportShipmentTable } from '../../../database/database.types';
import { evaluateForm4Gate, FORM4_REQUIRED_THRESHOLD_USD } from '../engines/import-form4-gate.engine';

export class ImportForm4GatesSlice {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Form 4 gate on the GRN (receiving) approval path
   * (INV-IMPORT-FORM4-GRN-GATE). Reuses assertForm4ClearanceGate
   * verbatim — same engine, same message, same
   * IMPORT_FORM4_REQUIRED code — so the dialog's already-wired
   * onError path surfaces the named error instead of the success
   * toast. The gate runs on the stored shipment row (B/L value
   * and funding type are read from data, never from caller
   * flags). When no shipment row can be loaded there is no B/L
   * value or funding type to evaluate, so the approval records;
   * the receipt posting itself is still gated at the Arrived
   * transition, which loads the shipment with
   * executeTakeFirstOrThrow. The 42P01 catch covers harnesses
   * without an import_shipments relation; it never skips a
   * gateable shipment, because a shipment row that exists is
   * always gated. Non-receiving stages never reach this method.
   */
  async assertForm4GrnGate(tenantId: string, shipmentId: string): Promise<void> {
    let shipment: Selectable<ImportShipmentTable> | undefined;
    try {
      shipment = await this.db
        .selectFrom('import_shipments')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', shipmentId)
        .executeTakeFirst();
    } catch (err: any) {
      if (err?.code === '42P01') return;
      throw err;
    }
    if (!shipment) return;
    await this.assertForm4ClearanceGate(this.db, tenantId, shipment);
  }

  /**
   * Form 4 clearance gate (INV-IMPORT-FORM4-CLEARANCE-GATE).
   * Caller holds the shipment lock and runs inside the costs
   * transaction; the shipment row already reflects this call's
   * Form 4 fields. The GRN caller (assertForm4GrnGate) passes
   * the plain db handle instead: an unlocked read is safe there
   * because a concurrent Form 4 write can only satisfy the gate,
   * and the receipt posting re-evaluates it under the lock. B/L value is the sum of item quantity x
   * factory unit price in USD. Funding is attributed through
   * project-linked proforma invoices only: an unlinked transfer
   * cannot be attributed to a shipment, so it neither triggers
   * nor satisfies the gate (recorded scoping, same attribution
   * limit as the approval binding). Throws before any write
   * outside this transaction commits.
   *
   * SUPERSEDED SCOPING (I1-P4, trial 2026-11-09 problem 4):
   * the engine's "no funding recorded → gate does not apply"
   * branch NO LONGER exempts a shipment. Every shipment now
   * carries funding_type (migration 2040000000303, default
   * bank_transfer), and it is ALWAYS fed to the engine as a
   * funding method — alongside any transfer methods — so a
   * bank-default shipment above the threshold is gated even
   * with zero supplier_payments rows (the trial defect:
   * MSCU-TEST-002, $2,500, no funding rows, sailed into
   * "In Customs"). A legacy NULL funding_type reads as
   * bank_transfer (defensive default; the migration backfills
   * existing rows with the default). Any bank-channel method
   * anywhere (shipment or transfer) triggers the gate; only
   * all-cash_carried is exempt.
   */
  async assertForm4ClearanceGate(
    executor: Transaction<Database> | Kysely<Database>,
    tenantId: string,
    shipment: Selectable<ImportShipmentTable>,
  ): Promise<void> {
    const items = await executor
      .selectFrom('import_shipment_items')
      .select(['quantity', 'factory_unit_price_usd'])
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', shipment.id)
      .execute();
    const shipmentUsdValue = items.reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.factory_unit_price_usd || 0),
      0,
    );
    let funding: Array<{ payment_method: string | null | undefined; form4_number: string | null | undefined }> = [];
    if (shipment.project_id) {
      funding = await executor
        .selectFrom('supplier_payments')
        .innerJoin('import_proforma_invoices', 'import_proforma_invoices.id', 'supplier_payments.proforma_invoice_id')
        .select([
          'supplier_payments.payment_method as payment_method',
          'supplier_payments.form4_number as form4_number',
        ])
        .where('supplier_payments.tenant_id', '=', tenantId)
        .where('import_proforma_invoices.project_id', '=', shipment.project_id)
        .execute();
    }
    // The shipment's own funding type is always a funding method
    // (see the header): a NULL legacy value means bank_transfer,
    // never "no funding".
    const shipmentFundingType = (shipment as any).funding_type || 'bank_transfer';
    const decision = evaluateForm4Gate({
      shipmentUsdValue,
      fundingMethods: [shipmentFundingType, ...funding.map((f) => f.payment_method)],
      shipmentForm4Number: shipment.form4_number ?? null,
      transferForm4Numbers: funding.map((f) => f.form4_number),
    });
    if (decision.required && !decision.satisfied) {
      throw new BadRequestException(
        `لا يمكن نقل الحاوية (${shipment.container_number}) إلى التخليص الجمركي أو الوصول بلا نموذج 4: شحنة ممولة عبر القنوات البنكية بقيمة ${shipmentUsdValue.toFixed(2)} دولار تتجاوز حد ${FORM4_REQUIRED_THRESHOLD_USD} دولار. سجل رقم نموذج 4 على الشحنة أو على الحوالة الممولة أولاً. [IMPORT_FORM4_REQUIRED]`,
      );
    }
  }
}
