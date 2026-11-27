import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { UpsertCustomerDto } from '../dto/upsert-customer.dto';
import { validateAndNormalizePhone } from '../../../core/utils/phone-utils';
import { extractCustomerVisitDays } from '../../delivery-reps/van-routes-schedule.util';
import type { RawBuilder } from 'kysely';

export interface CustomerCrudSliceBoundDeps {
  tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
  tenantId: (actor: AuthContext) => string;
  tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
  customerNameExists: (name: string, actor: AuthContext, excludeId?: number) => Promise<boolean>;
  findCustomerByPhone: (
    phone: string,
    actor: AuthContext,
    excludeId?: number,
  ) => Promise<{ id: number; name: string; phone: string } | null>;
  buildDuplicatePhoneWarning: (existing: { id: number; name: string; phone: string }) => Record<string, unknown>;
  addCustomerOpeningBalance: (
    customerId: number,
    amount: number,
    actor: AuthContext,
    db: Kysely<Database>,
  ) => Promise<void>;
  listCustomers: (query: Record<string, unknown>, actor: AuthContext) => Promise<Record<string, unknown>>;
}

export class CustomerCrudSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bound: CustomerCrudSliceBoundDeps,
  ) {}

  private tenantPredicate(actor: AuthContext, alias?: string) {
    return this.bound.tenantPredicate(actor, alias);
  }

  private tenantId(actor: AuthContext): string {
    return this.bound.tenantId(actor);
  }

  private tenantFields(actor: AuthContext) {
    return this.bound.tenantFields(actor);
  }

  private async customerNameExists(name: string, actor: AuthContext, excludeId?: number): Promise<boolean> {
    return this.bound.customerNameExists(name, actor, excludeId);
  }

  private async findCustomerByPhone(
    phone: string,
    actor: AuthContext,
    excludeId?: number,
  ): Promise<{ id: number; name: string; phone: string } | null> {
    return this.bound.findCustomerByPhone(phone, actor, excludeId);
  }

  private buildDuplicatePhoneWarning(existing: { id: number; name: string; phone: string }): Record<string, unknown> {
    return this.bound.buildDuplicatePhoneWarning(existing);
  }

  private async addCustomerOpeningBalance(
    customerId: number,
    amount: number,
    actor: AuthContext,
    db: Kysely<Database>,
  ): Promise<void> {
    return this.bound.addCustomerOpeningBalance(customerId, amount, actor, db);
  }

  private async listCustomers(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.bound.listCustomers(query, actor);
  }

  /**
   * F4 (trial problem 4), warn-not-block (user-approved 2026-11-27):
   * a POS "add customer" once created a fake customer ("عميل وهمي
   * للاختبار", 01000000000) because the phone was never required or
   * checked. The first fix made the phone REQUIRED and threw on a
   * missing, malformed, or placeholder phone — but that gate blocked
   * real work (POS quick-create by name only, and editing an
   * existing customer until a valid phone was entered). The phone
   * NEVER blocks now: the same checks still run (the codebase's
   * established validateAndNormalizePhone, plus the minimal
   * placeholder guard for numbers whose subscriber digits past the
   * 3-digit trunk prefix are all identical), but a failure only
   * returns a phoneWarning alongside the phone to store — empty
   * phone stores '' (customers.phone is NOT NULL), an invalid or
   * placeholder phone stores the raw trimmed value (no data is
   * lost), a valid phone stores the normalized national number.
   * The shared validator is untouched: users.service.ts keeps
   * enforcing INVALID_PHONE. Callers decide what to do with the
   * warning (create stores it; update keeps the existing phone on
   * a warned value instead of overwriting a good number).
   */
  private validateCustomerPhone(raw: unknown): { phone: string; warning?: Record<string, unknown> } {
    const trimmed = String(raw || '').trim();
    if (!trimmed) {
      return {
        phone: '',
        warning: { message: 'لم يتم إدخال رقم هاتف لهذا العميل', code: 'CUSTOMER_PHONE_MISSING' },
      };
    }
    const result = validateAndNormalizePhone(trimmed);
    if (!result.isValid) {
      return {
        phone: trimmed,
        warning: { message: result.error || 'رقم الهاتف غير صحيح', code: 'CUSTOMER_PHONE_INVALID' },
      };
    }
    const digits = result.nationalNumber.replace(/\D/g, '');
    const subscriber = digits.slice(3);
    if (subscriber.length >= 4 && [...subscriber].every((d) => d === subscriber[0])) {
      return {
        phone: trimmed,
        warning: {
          message: 'رقم الهاتف يبدو رقماً وهمياً، أدخل رقم هاتف حقيقياً',
          code: 'CUSTOMER_PHONE_PLACEHOLDER',
        },
      };
    }
    return { phone: result.nationalNumber };
  }

  /**
   * INV-VAN-PRICE-LIST-WIRING: resolves a requested price-list
   * assignment to a storable id. null/undefined (no assignment) pass
   * through as null. An unknown id, a foreign-tenant id, or a
   * non-integer is refused with PRICE_LIST_NOT_FOUND (400) before
   * anything is written. An INACTIVE list id is returned as given:
   * the assignment is preserved for reactivation and the engine
   * resolves it as "no list" while it is inactive.
   */
  private async resolveAssignablePriceListId(
    requested: number | null | undefined,
    actor: AuthContext,
  ): Promise<number | null> {
    if (requested == null) return null;
    const id = Number(requested);
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('Price list not found', 'PRICE_LIST_NOT_FOUND', 400);
    }
    const list = await this.db
      .selectFrom('price_lists')
      .select(['id'])
      .where('id', '=', id)
      .where('tenant_id', '=', this.tenantId(actor))
      .executeTakeFirst();
    if (!list) throw new AppError('Price list not found', 'PRICE_LIST_NOT_FOUND', 400);
    return id;
  }

  async createCustomer(payload: UpsertCustomerDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Customer name is required', 'CUSTOMER_NAME_REQUIRED', 400);
    if (await this.customerNameExists(name, actor))
      throw new AppError('Customer already exists', 'CUSTOMER_EXISTS', 400);
    // F4 warn-not-block: a missing / malformed / placeholder phone
    // never refuses the create; it only returns a phoneWarning.
    const { phone, warning: phoneWarning } = this.validateCustomerPhone(payload.phone);
    // INV-VAN-PRICE-LIST-WIRING: an unknown or foreign list id is
    // refused before anything is written; an inactive list id is
    // stored (assignment preserved for reactivation).
    const priceListId = await this.resolveAssignablePriceListId(payload.priceListId, actor);

    const inserted = await this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('customers')
        .values({
          name,
          phone,
          address: String(payload.address || '').trim(),
          balance: 0,
          customer_type: ['vip', 'credit', 'wholesale', 'half_wholesale'].includes(payload.type as string)
            ? payload.type
            : 'cash',
          price_list_id: priceListId,
          credit_limit: Number(payload.creditLimit || 0),
          store_credit_balance: Number(payload.storeCreditBalance || 0),
          company_name: String(payload.companyName || '').trim(),
          tax_number: String(payload.taxNumber || '').trim(),
          metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
          is_active: true,
          ...this.tenantFields(actor),
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.addCustomerOpeningBalance(Number(inserted.id), Number(payload.balance || 0), actor, trx);

      const customerCode = `C-${String(inserted.id).padStart(4, '0')}`;
      const initialMeta: any = {
        ...(payload.metadata || {}),
        customer_code: customerCode,
        code: customerCode,
      };
      if (initialMeta.visit_day !== undefined || initialMeta.visit_days !== undefined) {
        const { visitDays, visitDay } = extractCustomerVisitDays(initialMeta);
        initialMeta.visit_days = visitDays;
        initialMeta.visit_day = visitDay;
      }
      await (trx as any)
        .updateTable('customers')
        .set({ metadata: JSON.stringify(initialMeta) })
        .where('id', '=', inserted.id)
        .where('tenant_id', '=', actor.tenantId)
        .execute();

      return inserted;
    });

    const customerCode = `C-${String(inserted.id).padStart(4, '0')}`;
    await this.audit.log('إضافة عميل', `تم إضافة العميل ${name} [${customerCode}] بواسطة ${actor.username}`, actor);

    const listing = await this.listCustomers({}, actor);
    // No duplicate lookup for an empty phone: two phone-less
    // customers are not duplicates of each other. A format warning
    // (missing / invalid / placeholder) wins over a duplicate
    // warning — it describes the value just stored.
    const duplicate = phone ? await this.findCustomerByPhone(phone, actor, Number(inserted.id)) : null;
    return {
      ok: true,
      id: String(inserted.id),
      customers: listing.customers,
      ...(phoneWarning
        ? { phoneWarning }
        : duplicate
          ? { phoneWarning: this.buildDuplicatePhoneWarning(duplicate) }
          : {}),
    };
  }

  async updateCustomer(id: number, payload: UpsertCustomerDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const existing = await this.db
      .selectFrom('customers')
      .select(['id', 'phone', 'balance', 'store_credit_balance'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!existing) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Customer name is required', 'CUSTOMER_NAME_REQUIRED', 400);
    if (await this.customerNameExists(name, actor, id))
      throw new AppError('Customer already exists', 'CUSTOMER_EXISTS', 400);
    // F4 warn-not-block: an empty / missing phone in the payload keeps
    // the existing stored phone; an invalid / placeholder phone warns
    // and keeps it too (a bad value never overwrites a good number).
    // Only a valid new phone is stored.
    const trimmedPhone = String(payload.phone || '').trim();
    let phone: string;
    let phoneWarning: Record<string, unknown> | undefined;
    let phoneChanged = false;
    if (!trimmedPhone) {
      phone = existing.phone || '';
    } else {
      const checked = this.validateCustomerPhone(payload.phone);
      if (checked.warning) {
        phone = existing.phone || '';
        phoneWarning = checked.warning;
      } else {
        phone = checked.phone;
        phoneChanged = phone !== (existing.phone || '');
      }
    }

    const requestedBalance = Number(payload.balance ?? existing.balance ?? 0);
    if (Math.abs(Number(existing.balance || 0) - requestedBalance) > 0.0001) {
      throw new AppError(
        'Balance cannot be edited from customer form; use opening balance/import/reconcile flow',
        'CUSTOMER_BALANCE_EDIT_FORBIDDEN',
        400,
      );
    }

    const requestedStoreCredit = Number(payload.storeCreditBalance ?? existing.store_credit_balance ?? 0);
    if (Math.abs(Number(existing.store_credit_balance || 0) - requestedStoreCredit) > 0.0001) {
      throw new AppError('Store credit cannot be edited from customer form', 'CUSTOMER_CREDIT_EDIT_FORBIDDEN', 400);
    }

    // INV-VAN-PRICE-LIST-WIRING: the list assignment is written only
    // when the payload carries the key (absent = unchanged, so
    // callers that do not manage lists never detach one); null
    // clears it. Unknown/foreign ids are refused.
    const priceListId =
      payload.priceListId !== undefined
        ? await this.resolveAssignablePriceListId(payload.priceListId, actor)
        : undefined;

    const metaToSave: any = payload.metadata ? { ...payload.metadata } : null;
    if (metaToSave && typeof metaToSave === 'object') {
      if (metaToSave.visit_day !== undefined || metaToSave.visit_days !== undefined) {
        const { visitDays, visitDay } = extractCustomerVisitDays(metaToSave);
        metaToSave.visit_days = visitDays;
        metaToSave.visit_day = visitDay;
      }
    }

    await this.db
      .updateTable('customers')
      .set({
        name,
        phone,
        address: String(payload.address || '').trim(),
        customer_type: ['vip', 'credit', 'wholesale', 'half_wholesale'].includes(payload.type as string)
          ? payload.type
          : 'cash',
        ...(priceListId !== undefined ? { price_list_id: priceListId } : {}),
        credit_limit: Number(payload.creditLimit || 0),
        company_name: String(payload.companyName || '').trim(),
        tax_number: String(payload.taxNumber || '').trim(),
        metadata: metaToSave ? JSON.stringify(metaToSave) : null,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();

    await this.audit.log('تعديل عميل', `تم تحديث العميل #${id} بواسطة ${actor.username}`, actor);
    const listing = await this.listCustomers({}, actor);
    // The duplicate check runs only when the phone actually changed:
    // an edit that keeps the existing phone must not newly warn about
    // a duplicate the customer already had. A format warning wins
    // over a duplicate warning.
    const duplicate = phoneChanged ? await this.findCustomerByPhone(phone, actor, id) : null;
    return {
      ok: true,
      customers: listing.customers,
      ...(phoneWarning
        ? { phoneWarning }
        : duplicate
          ? { phoneWarning: this.buildDuplicatePhoneWarning(duplicate) }
          : {}),
    };
  }

  async deleteCustomer(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const customer = await this.db
      .selectFrom('customers')
      .select(['id', 'balance', 'store_credit_balance'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();

    if (!customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
    if (Math.abs(Number(customer.balance || 0)) > 0.0001)
      throw new AppError('Customer has outstanding balance', 'CUSTOMER_HAS_BALANCE', 400);
    if (Math.abs(Number(customer.store_credit_balance || 0)) > 0.0001)
      throw new AppError('Customer has store credit balance', 'CUSTOMER_HAS_CREDIT', 400);

    const [salesCount, paymentCount, ledgerCount] = await Promise.all([
      this.db
        .selectFrom('sales')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('customer_id', '=', id)
        .where(this.tenantPredicate(actor))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('customer_payments')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('customer_id', '=', id)
        .where(this.tenantPredicate(actor))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('customer_ledger')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('customer_id', '=', id)
        .where(this.tenantPredicate(actor))
        .executeTakeFirstOrThrow(),
    ]);

    if (Number(salesCount.count || 0) || Number(paymentCount.count || 0) || Number(ledgerCount.count || 0)) {
      throw new AppError('Customer has financial history and cannot be deleted', 'CUSTOMER_HAS_HISTORY', 400);
    }

    await this.db
      .deleteFrom('product_customer_prices')
      .where('customer_id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();
    await this.db
      .updateTable('customers')
      .set({ is_active: false, updated_at: sql`NOW()` })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();
    await this.audit.log('حذف عميل', `تم تعطيل العميل #${id} بواسطة ${actor.username}`, actor);

    const listing = await this.listCustomers({}, actor);
    return { ok: true, customers: listing.customers };
  }
}
