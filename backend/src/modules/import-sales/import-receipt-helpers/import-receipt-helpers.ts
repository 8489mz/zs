// Import receipt helpers — pure move from ImportSalesService (file #57).
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Selectable, Transaction } from 'kysely';
import { Database, ImportShipmentItemTable } from '../../../database/database.types';

export class ImportReceiptHelpersSlice {
  async lockShipment(trx: Transaction<Database>, tenantId: string, shipmentId: string) {
    const shipment = await trx
      .selectFrom('import_shipments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', shipmentId)
      .forUpdate()
      .executeTakeFirst();
    if (!shipment) throw new NotFoundException('الشحنة غير موجودة');
    const receipt = await trx
      .selectFrom('import_inventory_receipts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('shipment_id', '=', shipmentId)
      .executeTakeFirst();
    return { shipment, receipt };
  }

  assertShipmentEditable(state: Awaited<ReturnType<ImportReceiptHelpersSlice['lockShipment']>>) {
    if (state.receipt?.state === 'legacy_review_required' || (!state.receipt && state.shipment.status === 'Arrived')) {
      throw new BadRequestException('الشحنة القديمة تحتاج مراجعة الاستلام وتسوية معتمدة قبل أي تعديل أو إعادة ترحيل');
    }
    if (state.receipt) {
      throw new BadRequestException('تم ترحيل الشحنة للمخزون؛ لا يمكن تعديل الكميات أو التكاليف إلا عبر تسوية معتمدة');
    }
  }

  /**
   * INV-IMPORT-RECEIPT-SUPPLIER-FAIL-CLOSED: the supplier credited by
   * an import receipt / late-expense journal is the shipment supplier,
   * else the linked project's feasibility supplier. There is no
   * fallback to the tenant's first supplier and no auto-created
   * generic supplier: crediting the wrong subledger silently
   * misstates supplier balances. The resolved id is validated to
   * belong to this tenant's suppliers. Callers must resolve BEFORE
   * any stock or journal write.
   */
  async resolveImportReceiptSupplierId(trx: any, tenantId: string, shipment: any): Promise<number> {
    const candidates: number[] = [];
    if (shipment?.supplier_id) candidates.push(Number(shipment.supplier_id));
    if (shipment?.project_id) {
      const proj = await trx
        .selectFrom('import_projects')
        .select('feasibility_data')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', shipment.project_id)
        .executeTakeFirst();
      const f =
        typeof proj?.feasibility_data === 'string' ? JSON.parse(proj.feasibility_data) : proj?.feasibility_data || {};
      if (f?.supplierId) candidates.push(Number(f.supplierId));
    }
    for (const candidate of candidates) {
      if (!Number.isSafeInteger(candidate) || candidate <= 0) continue;
      const supplier = await trx
        .selectFrom('suppliers')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', candidate)
        .executeTakeFirst();
      if (supplier) return Number(supplier.id);
    }
    throw new BadRequestException(
      'لا يمكن ترحيل قيد استلام أو مصروف متأخر بلا مورد محدد: حدد مورد الشحنة أو مورد دراسة جدوى المشروع قبل الترحيل. [IMPORT_RECEIPT_SUPPLIER_REQUIRED]',
    );
  }

  /**
   * INV-IMPORT-RECEIPT-JE-SUPPLIER-SUBACCOUNT: resolve the import
   * project's cost centre for the receipt journal, following the
   * contracting canonical pattern (resolve-or-create by code
   * CC-<project code>, dimension 'project'). The receipt journal
   * used to post every line with a NULL cost centre, so the JE
   * screen showed '-' and the project attribution lived nowhere
   * on the journal itself. A shipment with no project has no
   * project cost centre (NULL, honest); a project_id pointing at
   * a missing project row fails closed instead of posting an
   * unattributed journal. The concurrent-create race is absorbed
   * by the (tenant_id, code) unique key: a do-nothing conflict
   * re-reads the row the other transaction inserted.
   */
  async resolveImportProjectCostCenter(trx: any, tenantId: string, shipment: any): Promise<number | null> {
    const projectId = shipment?.project_id;
    if (!projectId) return null;
    const project = await trx
      .selectFrom('import_projects')
      .select(['project_no', 'title', 'allocated_capital'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!project?.project_no) {
      throw new BadRequestException(
        'لا يمكن ترحيل قيد استلام شحنة مشروعها غير موجود في هذه المنشأة؛ راجع مشروع الشحنة قبل الترحيل. [IMPORT_RECEIPT_PROJECT_NOT_FOUND]',
      );
    }
    const code = `CC-${project.project_no}`;
    const existing = await trx
      .selectFrom('cost_centers')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (existing) return Number(existing.id);
    const inserted = await trx
      .insertInto('cost_centers')
      .values({
        tenant_id: tenantId,
        code,
        name: `مشروع: ${project.title || project.project_no}`,
        dimension: 'project',
        budget_amount: Number(project.allocated_capital || 0),
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['tenant_id', 'code']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted) return Number(inserted.id);
    const raced = await trx
      .selectFrom('cost_centers')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (raced) return Number(raced.id);
    throw new BadRequestException(
      'تعذر تحديد مركز تكلفة مشروع الاستلام؛ أعد المحاولة. [IMPORT_RECEIPT_COST_CENTER_UNRESOLVED]',
    );
  }

  costLine(item: Selectable<ImportShipmentItemTable>) {
    return {
      id: item.id,
      productId: Number(item.product_id),
      quantity: Number(item.quantity),
      receivedQuantity: Number(item.received_quantity ?? item.quantity),
      factoryUnitPriceUsd: Number(item.factory_unit_price_usd),
      shortageHandlingMethod: item.shortage_handling_method ?? 'capitalize',
    };
  }
}
