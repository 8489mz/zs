import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { canWriteQuotations } from '../../../core/auth/utils/commerce-operation-guards';
import { CreateQuotationDto, UpdateQuotationDto } from '../dto/quotation.dto';
import { SalesWriteService } from './sales-write.service';
import { UpsertSaleDto } from '../dto/upsert-sale.dto';
import { idempotencyStorage } from '../../../core/idempotency/idempotency.context';
import { IdempotencyService, IDEMPOTENCY_STUCK_PROCESSING_MS } from '../../../core/idempotency/idempotency.service';
import { conversionRecoverySaleId, decideConversionRecovery, resolveConversionDiscounts, resolveConversionPaymentTerms } from '../helpers/sales-write.helper';

@Injectable()
export class QuotationsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly salesWrite: SalesWriteService,
    // Optional: same fallback as SalesOrdersService — Nest DI
    // provides the global IdempotencyService; hand-constructed
    // instances in specs/harnesses get a real one over the same db.
    idempotency?: IdempotencyService,
  ) {
    this.idempotency = idempotency ?? new IdempotencyService(db as any);
  }

  private readonly idempotency: IdempotencyService;

  private conversionOperationParams(scope: { tenantId: string; accountId: string }, idemKey: string) {
    return {
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      idempotencyKey: idemKey,
      operationType: 'sale',
    };
  }

  private async markQuotationConverted(id: number, scope: { tenantId: string; accountId: string }, saleId: number): Promise<void> {
    await this.db
      .updateTable('quotations')
      .set({
        status: 'converted',
        sale_id: saleId,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();
  }

  async listQuotations(auth: AuthContext, query?: { status?: string; search?: string }): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    let qb = this.db
      .selectFrom('quotations')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId);

    if (query?.status && query.status !== 'all') {
      qb = qb.where('status', '=', query.status as any);
    }

    if (query?.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      qb = qb.where((eb) =>
        eb.or([
          eb('quotation_number', 'ilike', term),
          eb('customer_name', 'ilike', term),
          eb('customer_phone', 'ilike', term),
        ]),
      );
    }

    const items = await qb.orderBy('created_at', 'desc').limit(100).execute();
    return { quotations: items };
  }

  async getQuotationById(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const quotation = await this.db
      .selectFrom('quotations')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .executeTakeFirst();

    if (!quotation) {
      throw new NotFoundException('عرض السعر غير موجود');
    }

    const items = await this.db
      .selectFrom('quotation_items')
      .selectAll()
      .where('quotation_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .orderBy('id', 'asc')
      .execute();

    return { ...quotation, items };
  }

  async createQuotation(dto: CreateQuotationDto, auth: AuthContext): Promise<Record<string, unknown>> {
    canWriteQuotations(auth);
    const scope = requireTenantScope(auth);
    const quotationNumber = `QUO-${Date.now().toString().slice(-6)}`;
    const now = new Date();

    const result = await this.db.transaction().execute(async (trx) => {
      const quotation = await trx
        .insertInto('quotations')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          quotation_number: quotationNumber,
          customer_id: dto.customerId || null,
          customer_name: dto.customerName.trim(),
          customer_phone: dto.customerPhone?.trim() || null,
          customer_address: dto.customerAddress?.trim() || null,
          branch_id: dto.branchId || null,
          subtotal: dto.subtotal,
          discount_amount: dto.discountAmount || 0,
          tax_amount: dto.taxAmount || 0,
          total_amount: dto.totalAmount,
          valid_until: dto.validUntil ? new Date(dto.validUntil) : null,
          status: 'draft',
          notes: dto.notes?.trim() || null,
          terms_conditions: dto.termsConditions?.trim() || null,
          created_by: auth.userId ? Number(auth.userId) : null,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (dto.items && dto.items.length > 0) {
        for (const item of dto.items) {
          await trx
            .insertInto('quotation_items')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              quotation_id: quotation.id,
              product_id: item.productId,
              product_name: item.productName,
              unit_name: item.unitName || null,
              quantity: item.quantity,
              unit_price: item.unitPrice,
              discount: item.discount || 0,
              total: item.total,
              notes: item.notes || null,
              created_at: now,
            })
            .execute();
        }
      }

      return quotation;
    });

    return { ok: true, quotation: result };
  }

  async updateQuotation(id: number, dto: UpdateQuotationDto, auth: AuthContext): Promise<Record<string, unknown>> {
    canWriteQuotations(auth);
    const scope = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('quotations')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('عرض السعر غير موجود');
    }

    if (existing.status === 'converted') {
      throw new BadRequestException('لا يمكن تعديل عرض سعر تم تحويله لفاتورة بيع');
    }

    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('quotations')
        .set({
          customer_id: dto.customerId !== undefined ? dto.customerId : existing.customer_id,
          customer_name: dto.customerName !== undefined ? dto.customerName.trim() : existing.customer_name,
          customer_phone: dto.customerPhone !== undefined ? dto.customerPhone?.trim() || null : existing.customer_phone,
          customer_address: dto.customerAddress !== undefined ? dto.customerAddress?.trim() || null : existing.customer_address,
          branch_id: dto.branchId !== undefined ? dto.branchId : existing.branch_id,
          subtotal: dto.subtotal !== undefined ? dto.subtotal : existing.subtotal,
          discount_amount: dto.discountAmount !== undefined ? dto.discountAmount : existing.discount_amount,
          tax_amount: dto.taxAmount !== undefined ? dto.taxAmount : existing.tax_amount,
          total_amount: dto.totalAmount !== undefined ? dto.totalAmount : existing.total_amount,
          valid_until: dto.validUntil ? new Date(dto.validUntil) : existing.valid_until,
          status: (dto.status as any) || existing.status,
          notes: dto.notes !== undefined ? dto.notes?.trim() || null : existing.notes,
          terms_conditions: dto.termsConditions !== undefined ? dto.termsConditions?.trim() || null : existing.terms_conditions,
          updated_at: now,
        })
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      if (dto.items) {
        await trx
          .deleteFrom('quotation_items')
          .where('quotation_id', '=', id)
          .where('tenant_id', '=', scope.tenantId)
          .execute();

        for (const item of dto.items) {
          await trx
            .insertInto('quotation_items')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              quotation_id: id,
              product_id: item.productId,
              product_name: item.productName,
              unit_name: item.unitName || null,
              quantity: item.quantity,
              unit_price: item.unitPrice,
              discount: item.discount || 0,
              total: item.total,
              notes: item.notes || null,
              created_at: now,
            })
            .execute();
        }
      }
    });

    return { ok: true, message: 'تم تحديث عرض السعر بنجاح' };
  }

  async deleteQuotation(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    canWriteQuotations(auth);
    const scope = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('quotations')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('عرض السعر غير موجود');
    }

    await this.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('quotation_items')
        .where('quotation_id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      await trx
        .deleteFrom('quotations')
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
    });

    return { ok: true, message: 'تم حذف عرض السعر بنجاح' };
  }

  async convertToSale(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    canWriteQuotations(auth);
    const scope = requireTenantScope(auth);
    const quotation = await this.db
      .selectFrom('quotations')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .executeTakeFirst();

    if (!quotation) {
      throw new NotFoundException('عرض السعر غير موجود');
    }

    if (quotation.status === 'converted' && quotation.sale_id) {
      return { ok: true, message: 'تم تحويل عرض السعر مسبقاً', saleId: quotation.sale_id };
    }

    // INV-CONVERSION-LIFECYCLE-RACES: quotations had no claim at
    // all — status was checked outside any transaction and two
    // concurrent conversions both called createSale, both marked
    // 'converted', and the second overwrote sale_id, producing two
    // sales for one quotation. The claim below mirrors the
    // sales-order ZS-075 claim: one atomic transition into
    // 'converting' (from any status except 'converted' /
    // 'converting', so every previously convertible quotation stays
    // convertible — 'status' is a free varchar, no migration, and
    // no new gate is added), plus the same durable idempotency
    // reservation and stuck-claim recovery as the order path. The
    // previous status is restored on failure, since quotations
    // have no single 'confirmed' state to revert to.
    const previousStatus = String(quotation.status);
    const idemKey = `quote_convert_${scope.tenantId}_${id}`;
    const idemHash = this.idempotency.generateRequestHash({ conversion: 'quotation', id });
    const idemParams = this.conversionOperationParams(scope, idemKey);
    const claimFilter = (eb: any) =>
      eb.and([eb('status', '!=', 'converted'), eb('status', '!=', 'converting')]);

    const claimed = await this.db
      .updateTable('quotations')
      .set({ status: 'converting', updated_at: new Date() } as any)
      .where('id', '=', id)
      .where(claimFilter as any)
      .where('tenant_id', '=', scope.tenantId)
      .returningAll()
      .executeTakeFirst();

    if (!claimed) {
      const current = await this.db
        .selectFrom('quotations')
        .select(['status', 'sale_id', 'updated_at'])
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      if (current?.status === 'converted' && current.sale_id) {
        return { ok: true, message: 'تم تحويل عرض السعر مسبقاً', saleId: current.sale_id };
      }
      if (current && (current.status as string) === 'converting') {
        const row = await this.idempotency.getOperationState(idemParams);
        const verdict = decideConversionRecovery(row, current.updated_at);
        if (verdict === 'attach') {
          const saleId = conversionRecoverySaleId(row);
          if (!saleId) {
            throw new BadRequestException('تعذر تحديد فاتورة تحويل عرض السعر العالق؛ يلزم تدخل يدوي');
          }
          await this.markQuotationConverted(id, scope, saleId);
          return { ok: true, message: 'تم تحويل عرض السعر مسبقاً', saleId };
        }
        if (verdict === 'in-flight') {
          throw new BadRequestException('عرض السعر قيد التحويل حالياً أو تم تغيير حالته');
        }
        // Take over the stale claim by refreshing its timestamp,
        // guarded so a concurrent takeover wins instead: the row
        // must still be 'converting' AND still older than the stuck
        // threshold. Reverting to previousStatus here would restore
        // 'converting' itself (the document was found converting),
        // and no invented status may stand in for the unknown
        // pre-claim status — the claim is refreshed, not rewritten.
        const takenOver = await this.db
          .updateTable('quotations')
          .set({ status: 'converting', updated_at: new Date() } as any)
          .where('id', '=', id)
          .where('status', '=', 'converting' as any)
          .where('updated_at', '<', new Date(Date.now() - IDEMPOTENCY_STUCK_PROCESSING_MS))
          .where('tenant_id', '=', scope.tenantId)
          .returningAll()
          .executeTakeFirst();
        if (!takenOver) {
          throw new BadRequestException('عرض السعر قيد التحويل حالياً أو تم تغيير حالته');
        }
      } else if (current?.status === 'converted') {
        // 'converted' with no sale_id and no committed operation
        // row: no code path produces this (marking sets both
        // atomically), so fail closed for manual review instead of
        // converting a document that claims to be converted.
        const row = await this.idempotency.getOperationState(idemParams);
        if (row?.status === 'committed') {
          const saleId = conversionRecoverySaleId(row);
          if (saleId) {
            await this.markQuotationConverted(id, scope, saleId);
            return { ok: true, message: 'تم تحويل عرض السعر مسبقاً', saleId };
          }
        }
        throw new BadRequestException('عرض السعر مسجل كمحوّل دون فاتورة مرتبطة؛ يلزم تدخل يدوي');
      } else {
        throw new BadRequestException('عرض السعر قيد التحويل حالياً أو تم تغيير حالته');
      }
    }

    let saleAttempted = false;
    try {
      const items = await this.db
        .selectFrom('quotation_items')
        .selectAll()
        .where('quotation_id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .execute();

      if (items.length === 0) {
        throw new BadRequestException('لا يمكن تحويل عرض سعر فارغ إلى فاتورة');
      }

      // Resolve branch
      let branchId = quotation.branch_id;
      if (!branchId) {
        const primaryBranch = await this.db
          .selectFrom('branches')
          .select('id')
          .where('tenant_id', '=', scope.tenantId)
          .orderBy('id', 'asc')
          .executeTakeFirst();
        branchId = primaryBranch ? Number(primaryBranch.id) : 1;
      }

      // INV-CONVERSION-LIFECYCLE-RACES: reserve the conversion
      // operation before createSale runs (same outcomes as the
      // order path: 'committed' attaches, fresh 'processing' fails
      // closed, null / 'failed' / 'recovery_required' proceed).
      const reservation = await this.idempotency.reserveOperation({
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        idempotencyKey: idemKey,
        operationType: 'sale',
        requestHash: idemHash,
      });
      if (reservation?.status === 'committed') {
        const saleId = Number(reservation.documentId) || Number((reservation.responsePayload as any)?.saleId);
        if (!saleId) {
          throw new BadRequestException('تعذر تحديد فاتورة تحويل عرض السعر العالق؛ يلزم تدخل يدوي');
        }
        await this.markQuotationConverted(id, scope, saleId);
        return { ok: true, message: 'تم تحويل عرض السعر مسبقاً', saleId };
      }
      if (reservation?.status === 'processing') {
        throw new BadRequestException('عرض السعر قيد التحويل حالياً أو تم تغيير حالته');
      }

      // INV-CONVERSION-LINE-DISCOUNTS-PRESERVED: same reconciliation as
      // sales-order conversion — the stored discount rows are checked
      // against each other before any sale is created (the stored
      // total_amount is client-supplied and never trusted as the
      // target). Throws CONVERSION_DISCOUNT_MISMATCH on inconsistency.
      const { lineDiscounts, globalDiscount } = resolveConversionDiscounts(
        items.map((item) => ({
          quantity: item.quantity,
          unitPrice: item.unit_price,
          discount: item.discount,
        })),
        quotation.discount_amount,
      );

      // Prepare sale items
      const saleItems = items.map((item, index) => ({
        productId: Number(item.product_id),
        qty: Number(item.quantity),
        price: Number(item.unit_price),
        lineDiscount: lineDiscounts[index],
        unitName: item.unit_name || undefined,
      }));

      const totalAmount = Number(quotation.total_amount);

      // INV-CONVERSION-PAYMENT-TERMS-CARRIED: quotations carry no
      // payment-terms column, so the only representable shape is the
      // historical cash payload. The resolver is called with no stored
      // value (=> 'cash') so both conversions share one terms shape and
      // a future terms column can be wired here without changing the
      // payload construction below.
      const paymentTerms = resolveConversionPaymentTerms(undefined);

      const salePayload: any = {
        branchId,
        customerId: quotation.customer_id ? Number(quotation.customer_id) : undefined,
        customerName: quotation.customer_name,
        customerPhone: quotation.customer_phone || undefined,
        note: `تم إنشاؤها تحويلاً من عرض السعر #${quotation.quotation_number}${quotation.notes ? ` - ${quotation.notes}` : ''}`,
        items: saleItems,
        discount: globalDiscount,
        paymentType: paymentTerms,
        paymentChannel: paymentTerms,
        source: 'dashboard',
        payments: paymentTerms === 'credit'
          ? []
          : [
              {
                paymentChannel: 'cash',
                amount: totalAmount,
              },
            ],
      };

      saleAttempted = true;
      const saleResult: any = await idempotencyStorage.run(
        { idempotencyKey: idemKey, operationType: 'sale', accountId: scope.accountId },
        () => this.salesWrite.createSale(salePayload, auth),
      );
      const saleId = Number(saleResult?.sale?.id || saleResult?.id);

      // Mark quotation as converted
      await this.markQuotationConverted(id, scope, saleId);

      return {
        ok: true,
        message: 'تم تحويل عرض السعر إلى فاتورة بيع بنجاح',
        quotationId: id,
        saleId,
        sale: saleResult?.sale || saleResult,
      };
    } catch (error) {
      // Restore the pre-claim status (guarded: only while still
      // 'converting'), and record a failure on the reserved row
      // only for an attempt that reached the sale writer — same
      // shape as the sales-order catch.
      await this.db
        .updateTable('quotations')
        .set({ status: previousStatus, updated_at: new Date() } as any)
        .where('id', '=', id)
        .where('status', '=', 'converting' as any)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
      if (saleAttempted) {
        const err = error as any;
        const errorCode = err && (err.code || err.name) ? String(err.code || err.name) : 'UNKNOWN_ERROR';
        await this.idempotency.recordFailure(idemParams, errorCode);
      }
      throw error;
    }
  }
}
