import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { applyStockDelta } from '../../common/utils/location-stock-ledger';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { UpsertTradeInDto } from './dto/upsert-tradein.dto';
import { normalizeArabicSearch } from '../../common/utils/arabic-search.util';
import { valueStockReceipt } from '../accounting/inventory-valuation';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, toMinorUnits } from '../accounting/engines/money-minor-units.engine';

/**
 * Pure link check for an exchange trade-in (D-M3-P10-1): the linked
 * sale must exist (the service query is tenant-scoped, so a null row
 * also covers a sale of another tenant — never leak its existence)
 * and must be a posted sale. A draft or cancelled sale settles
 * nothing, so it cannot absorb a trade-in credit.
 */
export function assertExchangeSaleLink(
  sale: { status: string } | null | undefined,
): void {
  if (!sale) {
    throw new AppError(
      'Linked sale for the exchange does not exist',
      'TRADEIN_EXCHANGE_SALE_NOT_FOUND',
      404,
    );
  }
  if (sale.status !== 'posted') {
    throw new AppError(
      'Linked sale for the exchange is not a posted sale',
      'TRADEIN_EXCHANGE_SALE_NOT_POSTED',
      422,
    );
  }
}

@Injectable()
export class TradeInService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  async listTransactions(
    auth: AuthContext,
    filters?: {
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const scope = requireTenantScope(auth);
    let baseQuery = this.db
      .selectFrom('trade_in_transactions')
      .where('tenant_id', '=', scope.tenantId);

    if (filters?.q && filters.q.trim()) {
      const term = `%${normalizeArabicSearch(filters.q)}%`;
      baseQuery = baseQuery.where(sql<boolean>`(
        lower(doc_no) like ${term}
        OR TRANSLATE(LOWER(COALESCE(seller_name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
        OR lower(seller_phone) like ${term}
        OR lower(seller_national_id) like ${term}
        OR lower(serial_number) like ${term}
        OR TRANSLATE(LOWER(COALESCE(device_model, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${term}
      )`);
    }

    const totalRes = await baseQuery
      .select((eb) => eb.fn.count('id').as('count'))
      .executeTakeFirst();
    const total = Number(totalRes?.count || 0);

    const page = Math.max(1, Number(filters?.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(filters?.pageSize || 25)));
    const offset = (page - 1) * pageSize;

    const items = await baseQuery
      .selectAll()
      .orderBy('id', 'desc')
      .limit(pageSize)
      .offset(offset)
      .execute();

    return {
      transactions: items.map((t) => ({
        id: String(t.id),
        docNo: t.doc_no,
        sellerName: t.seller_name,
        sellerPhone: t.seller_phone,
        sellerNationalId: t.seller_national_id,
        deviceBrand: t.device_brand,
        deviceModel: t.device_model,
        serialNumber: t.serial_number,
        imei2: t.imei_2,
        deviceConditionNotes: t.device_condition_notes,
        agreedPurchasePrice: Number(t.agreed_purchase_price),
        transactionType: t.transaction_type,
        createdProductId: t.created_product_id ? String(t.created_product_id) : null,
        saleId: t.sale_id ? String(t.sale_id) : null,
        paymentMethod: t.payment_method,
        signatureData: t.signature_data,
        branchId: t.branch_id ? String(t.branch_id) : null,
        locationId: t.location_id ? String(t.location_id) : null,
        notes: t.notes,
        createdAt: t.created_at,
      })),
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getTransaction(id: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const item = await this.db
      .selectFrom('trade_in_transactions')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!item) {
      throw new AppError('عملية شراء المستعمل غير موجودة', 'TRADEIN_NOT_FOUND', 404);
    }

    return {
      transaction: {
        id: String(item.id),
        docNo: item.doc_no,
        sellerName: item.seller_name,
        sellerPhone: item.seller_phone,
        sellerNationalId: item.seller_national_id,
        deviceBrand: item.device_brand,
        deviceModel: item.device_model,
        serialNumber: item.serial_number,
        imei2: item.imei_2,
        deviceConditionNotes: item.device_condition_notes,
        agreedPurchasePrice: Number(item.agreed_purchase_price),
        transactionType: item.transaction_type,
        createdProductId: item.created_product_id ? String(item.created_product_id) : null,
        saleId: item.sale_id ? String(item.sale_id) : null,
        paymentMethod: item.payment_method,
        signatureData: item.signature_data,
        branchId: item.branch_id ? String(item.branch_id) : null,
        locationId: item.location_id ? String(item.location_id) : null,
        notes: item.notes,
        createdAt: item.created_at,
      },
    };
  }

  async createTransaction(payload: UpsertTradeInDto, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      // A lost HTTP response or two cashier clicks must not purchase and pay
      // for the same serial twice. Serialize the tenant+serial check across
      // connections before creating stock, serial and treasury rows.
      const serial = payload.serialNumber.trim();
      await sql`SELECT pg_advisory_xact_lock(hashtext(${scope.tenantId}), hashtext(${serial}))`.execute(trx);
      const existingIntake = await trx.selectFrom('trade_in_transactions')
        .select(['id', 'doc_no'])
        .where('tenant_id', '=', scope.tenantId).where('serial_number', '=', serial)
        .orderBy('id', 'desc')
        .executeTakeFirst();
      if (existingIntake) {
        // If an intake exists, verify if the serial is still active in stock.
        // A serial currently in stock cannot be purchased again.
        // If the serial was sold or retired, a new trade-in cycle is permitted.
        const serialRow = await trx.selectFrom('product_serials')
          .select(['id', 'status'])
          .where('tenant_id', '=', scope.tenantId)
          .where('serial_number', '=', serial)
          .orderBy('id', 'desc')
          .executeTakeFirst();
        if (serialRow && serialRow.status === 'in_stock') {
          throw new AppError(`Device serial already has trade-in document ${existingIntake.doc_no}; reconcile the original before retrying`, 'TRADEIN_DUPLICATE_SERIAL', 409);
        } else if (!serialRow) {
          throw new AppError(`Device serial already has trade-in document ${existingIntake.doc_no}; reconcile the original before retrying`, 'TRADEIN_DUPLICATE_SERIAL', 409);
        }
      }
      const agreed = Number(payload.agreedPurchasePrice);
      if (!Number.isFinite(agreed) || agreed < 0) {
        throw new AppError('Trade-in acquisition value is invalid', 'TRADEIN_COST_INVALID', 400);
      }
      try {
        toMinorUnits(agreed, currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId)));
      } catch {
        throw new AppError('Trade-in cost exceeds tenant currency minor-unit precision', 'TRADEIN_CURRENCY_PRECISION_INVALID', 422);
      }
      const transactionType = payload.transactionType ?? 'cash_purchase';
      if (transactionType !== 'cash_purchase' && transactionType !== 'exchange_trade_in') {
        throw new AppError('Trade-in transaction type is not supported', 'TRADEIN_TYPE_UNSUPPORTED', 422);
      }
      const isExchange = transactionType === 'exchange_trade_in';
      if (isExchange) {
        // An exchange settles the used device against the new-device
        // sale it links: the sale must exist, belong to this tenant
        // and be posted, or the link is meaningless.
        if (!payload.saleId || !Number.isSafeInteger(payload.saleId) || payload.saleId <= 0) {
          throw new AppError('An exchange trade-in must link the new-device sale', 'TRADEIN_EXCHANGE_SALE_REQUIRED', 422);
        }
        const linkedSale = await trx.selectFrom('sales')
          .select(['id', 'status'])
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', payload.saleId)
          .forUpdate()
          .executeTakeFirst();
        assertExchangeSaleLink(linkedSale);
        if (agreed > 0 && !payload.createdProductId && !payload.autoAddToInventory) {
          throw new AppError('A valued exchange must stock the used device (link a product or auto-add it to inventory)', 'TRADEIN_EXCHANGE_PRODUCT_REQUIRED', 422);
        }
      } else if (agreed > 0 && (!['cash', 'bank'].includes(payload.paymentMethod ?? 'cash') ||
          (!payload.createdProductId && !payload.autoAddToInventory))) {
        throw new AppError('Paid trade-in requires a physical receipt and immediate cash or default-bank payout', 'TRADEIN_POSTING_UNSUPPORTED', 422);
      }
      const conditionState = payload.deviceConditionState || 'used';
      const stateSuffixMap: Record<string, string> = {
        new_sealed: '(جديد متبرشم)',
        like_new: '(كسر زيرو)',
        used: '(مستعمل)',
        for_parts: '(قطع غيار)',
      };
      const conditionLabelMap: Record<string, string> = {
        new_sealed: 'جديد متبرشم (Sealed)',
        like_new: 'كسر زيرو (Like New)',
        used: 'مستعمل (Used)',
        for_parts: 'قطع غيار / تالف (For Parts)',
      };

      const conditionTag = conditionLabelMap[conditionState] || 'مستعمل';
      const rawNotes = payload.deviceConditionNotes?.trim() || '';
      const formattedConditionNotes = `[الحالة: ${conditionTag}] ${rawNotes}`.trim();

      // Insert transaction placeholder to obtain atomic sequence ID
      const insertedTxn = await trx
        .insertInto('trade_in_transactions')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          doc_no: 'PENDING_TRD',
          seller_name: payload.sellerName.trim(),
          seller_phone: payload.sellerPhone.trim(),
          seller_national_id: payload.sellerNationalId.trim(),
          device_brand: payload.deviceBrand?.trim() ?? null,
          device_model: payload.deviceModel.trim(),
          serial_number: payload.serialNumber.trim(),
          imei_2: payload.imei2?.trim() ?? null,
          device_condition_notes: formattedConditionNotes,
          agreed_purchase_price: payload.agreedPurchasePrice,
          transaction_type: transactionType,
          created_product_id: payload.createdProductId ?? null,
          sale_id: payload.saleId ?? null,
          // An exchange pays nothing out: 'exchange' records that no
          // payout rail applies, so no reader mistakes the row for a
          // cash purchase awaiting its treasury leg.
          payment_method: isExchange ? 'exchange' : (payload.paymentMethod ?? 'cash'),
          signature_data: payload.signatureData ?? null,
          branch_id: payload.branchId ?? null,
          location_id: payload.locationId ?? null,
          notes: payload.notes?.trim() ?? null,
        })
        .returning('id')
        .executeTakeFirst();

      if (!insertedTxn?.id) {
        throw new AppError('تعذر تسجيل عملية الشراء', 'CREATE_TRADEIN_FAILED', 400);
      }

      const txnId = Number(insertedTxn.id);
      const docNo = formatDailyDocumentNumber('TRD', txnId);

      await trx
        .updateTable('trade_in_transactions')
        .set({ doc_no: docNo })
        .where('id', '=', txnId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      let targetProductId = payload.createdProductId ?? null;
      if (targetProductId != null) {
        const target = await trx.selectFrom('products').select('id')
          .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(targetProductId)).executeTakeFirst();
        if (!target || !Number.isSafeInteger(Number(targetProductId))) {
          throw new AppError('Trade-in linked product does not belong to this tenant', 'TRADEIN_PRODUCT_SCOPE_INVALID', 404);
        }
      }
      if (payload.autoAddToInventory && !targetProductId) {
        const brandPrefix = payload.deviceBrand?.trim() ? `${payload.deviceBrand.trim()} ` : '';
        const stateSuffix = stateSuffixMap[conditionState] || '(مستعمل)';
        const productName = `${brandPrefix}${payload.deviceModel.trim()} ${stateSuffix}`;
        const existingProd = await trx.selectFrom('products')
          .select('id').where('tenant_id', '=', scope.tenantId).where('name', '=', productName).executeTakeFirst();
        if (existingProd) {
          targetProductId = Number(existingProd.id);
        } else {
          const resalePrice = payload.resalePrice && payload.resalePrice > 0 ? payload.resalePrice : agreed;
          const insertedProd = await trx.insertInto('products').values({
            tenant_id: scope.tenantId, account_id: scope.accountId, name: productName,
            barcode: `DEV-${payload.serialNumber.trim().slice(-8)}-${txnId}`,
            cost_price: agreed, retail_price: resalePrice, wholesale_price: agreed,
            stock_qty: 0, min_stock_qty: 0, is_active: true, track_serials: true,
            notes: `تم شراؤه وتنازل العميل عبر إيصال ${docNo} [${conditionTag}]`,
          }).returning('id').executeTakeFirst();
          if (!insertedProd?.id) throw new AppError('Could not create used inventory product', 'TRADEIN_PRODUCT_CREATE_FAILED', 500);
          targetProductId = Number(insertedProd.id);
        }
      }
      if (targetProductId) {
        // A serial currently active in inventory cannot be acquired again while in stock.
        // If it was previously sold, re-purchasing the used device is permitted.
        const occupiedSerial = await trx.selectFrom('product_serials')
          .select(['id', 'product_id', 'status'])
          .where('tenant_id', '=', scope.tenantId)
          .where('serial_number', '=', payload.serialNumber.trim())
          .where('status', '=', 'in_stock')
          .executeTakeFirst();
        if (occupiedSerial) {
          throw new AppError('الجهاز مسجل بالفعل وموجود بالمخزن حالياً؛ لا يمكن إعادة شرائه قبل خروجه من المخزن أو بيعه', 'TRADEIN_SERIAL_ALREADY_REGISTERED', 409);
        }


        // Also receive explicit existing product links: a recorded IMEI without
        // an actual stock movement previously created invisible inventory.
        await trx.updateTable('products').set({track_serials:true})
          .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(targetProductId)).execute();
        const stockChange = await applyStockDelta(trx, {
          productId: Number(targetProductId), delta: 1,
          branchId: payload.branchId ?? null, locationId: payload.locationId ?? null,
          tenantId: scope.tenantId, accountId: scope.accountId, allowNegative: false,
        });
        await trx.insertInto('stock_movements').values({
          product_id: Number(targetProductId), movement_type: 'tradein_in',
          qty: 1, before_qty: stockChange.scopeBefore, after_qty: stockChange.scopeAfter,
          unit_cost: agreed, total_cost: agreed,
          reason: 'شراء جهاز مستعمل', note: `شراء مستعمل إيصال ${docNo}`,
          reference_type: 'trade_in', reference_id: txnId,
          branch_id: payload.branchId ?? null, location_id: payload.locationId ?? null,
          created_by: auth.userId ? Number(auth.userId) : null,
          tenant_id: scope.tenantId, account_id: scope.accountId,
        } as any).execute();
        await valueStockReceipt(trx, scope.tenantId, Number(targetProductId), stockChange.globalAfter, 1, agreed);
        await trx.updateTable('trade_in_transactions').set({ created_product_id: Number(targetProductId) })
          .where('tenant_id', '=', scope.tenantId).where('id', '=', txnId).execute();
      }

      // If a product ID was linked or auto-created, automatically register the IMEI in product_serials
      if (targetProductId) {
        {
          await trx
            .insertInto('product_serials')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              product_id: targetProductId,
              serial_number: payload.serialNumber.trim(),
              imei_2: payload.imei2?.trim() ?? null,
              status: 'in_stock',
              cost_price: payload.agreedPurchasePrice,
              branch_id: payload.branchId ?? null,
              location_id: payload.locationId ?? null,
              notes: `شراء مستعمل إيصال رقم ${docNo} من ${payload.sellerName}`,
            })
            .execute();
        }
      }

      // A real immediate payout (cash or configured bank) and its inventory
      // valuation journal are atomic. Never book an unsupported payment rail.
      // An exchange pays nothing out — the used-device value settles
      // against the linked sale, not through the treasury.
      if (agreed > 0 && !isExchange) {
        await trx
          .insertInto('treasury_transactions')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            txn_type: 'expense',
            amount: -agreed,
            payment_channel: payload.paymentMethod === 'bank' ? 'bank' : 'cash',
            note: `سداد شراء جهاز ${payload.deviceBrand ? `${payload.deviceBrand} ` : ''}${payload.deviceModel} (إقرار ${docNo}) - البائع: ${payload.sellerName}`,
            reference_type: 'trade_in',
            reference_id: txnId,
            branch_id: payload.branchId ?? null,
            location_id: payload.locationId ?? null,
            created_by: auth.userId ? Number(auth.userId) : null,
          })
          .execute();
      }

      // Receipt, cash transfer and posted journal commit or roll back as one unit.
      // Exchange (D-M3-P10-1): NO journal and NO cash payout here. The
      // used device is stocked above, but its value is NOT yet credited
      // against the linked sale: the sale flow derives what a customer
      // still owes from sales.paid_amount / store_credit_used / returns
      // only, so a GL-only Dr 1140 / Cr 1130 credit would leave the
      // sale showing the full amount still collectible (double
      // collection), and the remaining-receivable cap has no clean
      // source inside this package (PaymentAllocationService's
      // reversal sum is private). Posting that journal would be a
      // wrong journal; the missing journal is the recorded open
      // question for the follow-up package (see the package report),
      // which must teach the allocation readers to absorb the credit
      // before any journal is posted.
      if (!isExchange) {
        await this.accountingPosting.postTradeInCashPurchase(trx, txnId, auth);
      }
      return { id: String(txnId), docNo };
    });

    await this.audit.log(
      'Create Trade-In Transaction',
      `Registered used device purchase ${result.docNo} (${payload.deviceModel} IMEI: ${payload.serialNumber})`,
      auth,
    );

    return { ok: true, id: result.id, docNo: result.docNo };
  }

  async deleteTransaction(id: number, auth: AuthContext) {
    const scope = requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      const document = await trx.selectFrom('trade_in_transactions')
        .select(['id', 'agreed_purchase_price', 'created_product_id', 'sale_id', 'transaction_type'])
        .where('tenant_id', '=', scope.tenantId).where('id', '=', id)
        .forUpdate().executeTakeFirst();
      if (!document) throw new AppError('Trade-in document not found', 'TRADEIN_NOT_FOUND', 404);
      const [stock, cash] = await Promise.all([
        trx.selectFrom('stock_movements').select('id')
          .where('tenant_id', '=', scope.tenantId).where('reference_type', '=', 'trade_in').where('reference_id', '=', id)
          .executeTakeFirst(),
        trx.selectFrom('treasury_transactions').select('id')
          .where('tenant_id', '=', scope.tenantId).where('reference_type', '=', 'trade_in').where('reference_id', '=', id)
          .executeTakeFirst(),
      ]);
      // Never delete a purchase/trade-in source after it has affected inventory,
      // cash or an associated sale. A real reversal must preserve source history.
      if (Number(document.agreed_purchase_price) > 0 || document.created_product_id ||
          document.sale_id || document.transaction_type !== 'cash_purchase' || stock || cash) {
        throw new AppError('Posted trade-in cannot be deleted; record an audited inventory/finance reversal instead', 'TRADEIN_REVERSAL_REQUIRED', 409);
      }
      await trx.deleteFrom('trade_in_transactions').where('tenant_id', '=', scope.tenantId).where('id', '=', id).execute();
    });
    await this.audit.log('Delete Trade-In Transaction', `Deleted zero-impact trade-in draft #${id}`, auth);
    return { ok: true };
  }
}
