import { Database } from '../../../../database/database.types';
import { Kysely, type Transaction } from 'kysely';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import { authorizeManagerSecret } from '../../../../common/utils/manager-approval';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../../../accounting/accounting-posting.service';
import { TenantScope } from './restaurant-fnb-types';

export class RestaurantFnbManagerCompSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly assertManagerCaller: (scope: TenantScope) => void,
    private readonly resolveCompAccount: (
      queryable: Kysely<Database> | Transaction<Database>,
      tenantId: string,
      configuredId: number | null | undefined,
      fallbackCode: string,
    ) => Promise<number>,
    private readonly accountingPosting?: AccountingPostingService,
  ) {}

  async recordManagerComp(
    scope: TenantScope,
    dto: {
      saleId?: number;
      tableNumber?: string;
      compType: 'vip_guest' | 'customer_complaint' | 'staff_meal' | 'promotional_tasting';
      managerName: string;
      managerPin?: string;
      amount: number;
      itemsSummary?: string;
      notes?: string;
    },
  ) {
    // INV-REST-FNB-CLAIMS-POST: only a manager caller may record a comp.
    this.assertManagerCaller(scope);
    const compTypes = ['vip_guest', 'customer_complaint', 'staff_meal', 'promotional_tasting'] as const;
    if (!compTypes.includes(dto.compType as (typeof compTypes)[number])) {
      throw new AppError('نوع الضيافة غير معروف', 'INVALID_COMP_TYPE', 400);
    }
    if (!dto.amount || Number(dto.amount) <= 0) {
      throw new AppError('مبلغ الضيافة يجب أن يكون أكبر من الصفر', 'INVALID_COMP_AMOUNT', 400);
    }

    const accountId = String(scope.accountId || '').trim();
    if (!accountId) {
      throw new AppError('Tenant/account scope is required', 'TENANT_SCOPE_REQUIRED', 403);
    }

    // The comp row and its journal commit or roll back together.
    return this.db.transaction().execute(async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const amount = roundMoney(Number(dto.amount), moneyDigits);
      if (amount <= 0) {
        throw new AppError('مبلغ الضيافة يجب أن يكون أكبر من الصفر', 'INVALID_COMP_AMOUNT', 400);
      }

      // INV-REST-FNB-CLAIMS-POST: the PIN the modal collects is actually
      // checked — via the one shared authorizeManagerSecret (PIN or an
      // active admin's login password; R3-D stores the PIN hashed). The
      // recorded manager is the VERIFIED approver it returns, never the
      // client-supplied free-text name.
      const isAdminCaller = String(scope.role || '') === 'admin' || String(scope.role || '') === 'super_admin';
      const cleanPin = String(dto.managerPin || '').trim();
      const approval =
        !isAdminCaller || cleanPin
          ? await authorizeManagerSecret(trx, { tenantId: scope.tenantId, accountId } as AuthContext, cleanPin)
          : {
              mode: 'account' as const,
              authorizedById: Number(scope.userId || 0) || undefined,
              authorizedByName: String(scope.username || 'المدير'),
            };

      // INV-REST-FNB-CLAIMS-POST: a comp on a named sale posts against a
      // REAL, POSTED sale of this tenant only. The sale must already have
      // a journal (its receivable exists in the GL); a draft or an
      // unposted sale has no receivable to credit, so a comp on it is
      // refused — apply the comp to the cart before checkout instead.
      // The amount may not exceed what the customer still owes after
      // earlier posted comps on the same sale.
      let journalEntryId: number | null = null;
      let saleDocNo = '';
      if (dto.saleId) {
        const saleId = Number(dto.saleId);
        const sale = await trx
          .selectFrom('sales')
          .select([
            'id',
            'doc_no',
            'customer_id',
            'total',
            'paid_amount',
            'store_credit_used',
            'branch_id',
            'location_id',
          ])
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', saleId)
          .executeTakeFirst();
        if (!sale) {
          throw new AppError('الفاتورة غير موجودة لدى هذه المنشأة', 'SALE_NOT_FOUND', 404);
        }
        const saleJournal = await trx
          .selectFrom('journal_entries')
          .select(['id'])
          .where('tenant_id', '=', scope.tenantId)
          .where('source_type', '=', 'sale')
          .where('source_id', '=', saleId)
          .where('status', 'in', ['draft', 'posted'])
          .executeTakeFirst();
        if (!saleJournal) {
          throw new AppError('الفاتورة لم تُرحَّل بعد؛ طبّق الضيافة على السلة قبل إتمام البيع', 'SALE_NOT_POSTED', 422);
        }
        const priorCompRows = await trx
          .selectFrom('restaurant_manager_comps')
          .select(['id', 'amount'])
          .where('tenant_id', '=', scope.tenantId)
          .where('sale_id', '=', saleId)
          .execute();
        let priorPosted = 0;
        for (const row of priorCompRows) {
          const priorJournal = await trx
            .selectFrom('journal_entries')
            .select(['id'])
            .where('tenant_id', '=', scope.tenantId)
            .where('source_type', '=', 'manager_comp')
            .where('source_id', '=', Number(row.id))
            .where('status', '=', 'posted')
            .executeTakeFirst();
          if (priorJournal) priorPosted = roundMoney(priorPosted + Number(row.amount || 0), moneyDigits);
        }
        const remaining = roundMoney(
          Number(sale.total || 0) - Number(sale.paid_amount || 0) - Number(sale.store_credit_used || 0) - priorPosted,
          moneyDigits,
        );
        if (amount > remaining) {
          throw new AppError(
            `مبلغ الضيافة (${amount}) يتجاوز المتبقي على الفاتورة (${remaining})`,
            'COMP_EXCEEDS_RECEIVABLE',
            422,
          );
        }
        saleDocNo = String(sale.doc_no || sale.id);

        const [comp] = await trx
          .insertInto('restaurant_manager_comps')
          .values({
            tenant_id: scope.tenantId,
            branch_id: scope.branchId || null,
            sale_id: saleId,
            table_number: dto.tableNumber || null,
            comp_type: dto.compType,
            manager_name: approval.authorizedByName,
            amount,
            items_summary: dto.itemsSummary || null,
            notes: dto.notes || null,
            created_at: new Date(),
          })
          .returningAll()
          .execute();

        // INV-REST-FNB-CLAIMS-POST: the comp POSTS. A comp is a price
        // reduction on an already-posted sale, so it posts exactly the
        // discount leg postSale uses for a sale discount: debit the sales
        // discount account (settings sales_discount_account_id, fallback
        // code 4300), credit the customer receivable (settings
        // customer_receivable_account_id, fallback 1130). The journal is
        // the posting the old response claimed; the comp row and the
        // journal are linked by source_type 'manager_comp' + the comp id.
        const settings = await trx
          .selectFrom('accounting_settings')
          .select(['sales_discount_account_id', 'customer_receivable_account_id'])
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', 1)
          .executeTakeFirst();
        const discountAccountId = await this.resolveCompAccount(
          trx,
          scope.tenantId,
          settings?.sales_discount_account_id ?? null,
          '4300',
        );
        const receivableAccountId = await this.resolveCompAccount(
          trx,
          scope.tenantId,
          settings?.customer_receivable_account_id ?? null,
          '1130',
        );
        const customerId = sale.customer_id ? Number(sale.customer_id) : null;
        if (!this.accountingPosting) {
          throw new AppError('الضيافة على فاتورة مسجلة تحتاج خدمة الترحيل المحاسبي', 'FNB_POSTING_UNAVAILABLE', 500);
        }
        journalEntryId = await this.accountingPosting.postDomainJournal(trx, {
          sourceType: 'manager_comp',
          sourceId: Number(comp.id),
          tenantId: scope.tenantId,
          accountId,
          entryDate: new Date(),
          description: `ضيافة إدارة على الفاتورة ${saleDocNo} — ${dto.compType}`,
          branchId: sale.branch_id ? Number(sale.branch_id) : scope.branchId || null,
          locationId: sale.location_id ? Number(sale.location_id) : null,
          createdBy: scope.userId || null,
          lines: [
            {
              accountId: discountAccountId,
              description: `ضيافة إدارة على الفاتورة ${saleDocNo}`,
              debit: amount,
              credit: 0,
              partnerType: 'none',
              partnerId: null,
              branchId: sale.branch_id ? Number(sale.branch_id) : null,
              locationId: sale.location_id ? Number(sale.location_id) : null,
            },
            {
              accountId: receivableAccountId,
              description: `تخفيض مديونية عميل بضيافة إدارة على الفاتورة ${saleDocNo}`,
              debit: 0,
              credit: amount,
              partnerType: customerId ? 'customer' : 'none',
              partnerId: customerId,
              branchId: sale.branch_id ? Number(sale.branch_id) : null,
              locationId: sale.location_id ? Number(sale.location_id) : null,
            },
          ],
        });

        return {
          success: true,
          comp,
          journalEntryId,
          message: `تم اعتماد وقيد ضيافة الإدارة بقيمة ${amount} على الفاتورة ${saleDocNo} بنجاح`,
        };
      }

      // INV-REST-FNB-CLAIMS-POST: no sale yet — this is the current-cart
      // authorization. There is no receivable to credit and no journal to
      // post against, so NO journal is posted here: the comp is recorded
      // as an approved authorization, and the discount posts with the
      // sale (the cart discount the POS applies, posted by postSale's
      // discount leg). Posting a journal now as well would count the same
      // discount twice. The response says exactly that — it never claims
      // a posting that did not happen.
      const [comp] = await trx
        .insertInto('restaurant_manager_comps')
        .values({
          tenant_id: scope.tenantId,
          branch_id: scope.branchId || null,
          sale_id: null,
          table_number: dto.tableNumber || null,
          comp_type: dto.compType,
          manager_name: approval.authorizedByName,
          amount,
          items_summary: dto.itemsSummary || null,
          notes: dto.notes || null,
          created_at: new Date(),
        })
        .returningAll()
        .execute();

      return {
        success: true,
        comp,
        journalEntryId: null,
        message: `تم اعتماد ضيافة الإدارة بقيمة ${amount} وتسجيلها؛ يُرحَّل الخصم مع الفاتورة عند إتمام البيع`,
      };
    });
  }
}
