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
import { resolveConversionDiscounts } from '../helpers/sales-write.helper';

@Injectable()
export class QuotationsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly salesWrite: SalesWriteService,
  ) {}

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

    const salePayload: any = {
      branchId,
      customerId: quotation.customer_id ? Number(quotation.customer_id) : undefined,
      customerName: quotation.customer_name,
      customerPhone: quotation.customer_phone || undefined,
      note: `تم إنشاؤها تحويلاً من عرض السعر #${quotation.quotation_number}${quotation.notes ? ` - ${quotation.notes}` : ''}`,
      items: saleItems,
      discount: globalDiscount,
      paymentType: 'cash',
      paymentChannel: 'cash',
      source: 'dashboard',
      payments: [
        {
          paymentChannel: 'cash',
          amount: totalAmount,
        },
      ],
    };

    const saleResult: any = await this.salesWrite.createSale(salePayload, auth);
    const saleId = Number(saleResult?.sale?.id || saleResult?.id);

    // Mark quotation as converted
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

    return {
      ok: true,
      message: 'تم تحويل عرض السعر إلى فاتورة بيع بنجاح',
      quotationId: id,
      saleId,
      sale: saleResult?.sale || saleResult,
    };
  }
}
