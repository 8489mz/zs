import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { paginateRows } from '../../common/utils/pagination';
import { getTenantTimezone, todayTenantDate } from '../../common/utils/tenant-timezone.util';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { UpsertServiceDto } from './dto/upsert-service.dto';
import { IdempotencyService } from '../../core/idempotency/idempotency.service';
import { idempotencyStorage } from '../../core/idempotency/idempotency.context';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';

type ServicePaymentChannel = 'cash' | 'card';

type ServiceFinanceScope = {
  branchId: number | null;
  locationId: number | null;
};

@Injectable()
export class ServicesService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private normalizePaymentChannel(value: unknown): ServicePaymentChannel {
    return String(value || '').trim() === 'card' ? 'card' : 'cash';
  }

  private toNullableNumber(value: unknown): number | null {
    const numberValue = Number(value || 0);
    return numberValue > 0 ? numberValue : null;
  }

  private async getOpenShiftFinanceScope(db: Kysely<Database>, auth: AuthContext): Promise<ServiceFinanceScope> {
    const scope = requireTenantScope(auth);
    const result = await sql<{ branch_id?: number | string | null; location_id?: number | string | null }>`
      select branch_id, location_id
      from cashier_shifts
      where tenant_id = ${scope.tenantId}
        and opened_by = ${auth.userId}
        and status = 'open'
      order by id desc
      limit 1
    `.execute(db);

    const row = result.rows?.[0] || null;
    return {
      branchId: this.toNullableNumber(row?.branch_id),
      locationId: this.toNullableNumber(row?.location_id),
    };
  }

  // INV-SERVICES-TREASURY-APPEND-ONLY: treasury legs for a service are
  // append-only. The live cash balance of a service is the sum of its
  // legs; superseding it posts a NEGATIVE cash_out leg (the established
  // cash_out sign: sales-write posts cash_out legs as -Math.abs(amount),
  // and computeShiftCashDrawerMovements counts amount < 0 as cash out).
  // Nothing is ever DELETEed here, so the original leg keeps its id,
  // amount and created_at forever.
  private async postServiceTreasuryReversal(
    db: Kysely<Database>,
    serviceId: number,
    serviceName: string,
    auth: AuthContext,
    scope: ServiceFinanceScope,
  ): Promise<number> {
    const tenantScope = requireTenantScope(auth);
    const live = await sql<{ total?: number | string | null }>`
      select coalesce(sum(amount), 0) as total
      from treasury_transactions
      where tenant_id = ${tenantScope.tenantId}
        and reference_type = 'service'
        and reference_id = ${serviceId}
    `.execute(db);
    const liveCash = Number(live.rows?.[0]?.total || 0);
    if (!(liveCash > 0)) return 0;
    await sql`
      insert into treasury_transactions (
        txn_type, amount, note, reference_type, reference_id, branch_id, location_id, created_by, created_at, tenant_id, account_id
      ) values (
        'cash_out', ${-liveCash}, ${`عكس خدمة نقدي: ${String(serviceName || '').trim()}`}, 'service', ${serviceId}, ${scope.branchId}, ${scope.locationId}, ${auth.userId}, ${new Date()}, ${tenantScope.tenantId}, ${tenantScope.accountId}
      )
    `.execute(db);
    return liveCash;
  }

  private async syncServiceTreasuryTransaction(
    db: Kysely<Database>,
    serviceId: number,
    service: { name?: string; amount?: number; date?: string; paymentChannel?: ServicePaymentChannel },
    auth: AuthContext,
    scope: ServiceFinanceScope,
  ): Promise<number | null> {
    const tenantScope = requireTenantScope(auth);
    // Append-only: reverse the live cash balance with a cash_out leg,
    // never DELETE the old legs. created_at is NOW (the creation
    // moment), never the backdated service_date (F4): the old code
    // dated the re-inserted leg at service_date while shift
    // attribution windows on created_at.
    await this.postServiceTreasuryReversal(db, serviceId, service.name || '', auth, scope);

    const amount = Number(service.amount || 0);
    const paymentChannel = this.normalizePaymentChannel(service.paymentChannel);
    if (paymentChannel !== 'cash' || !(amount > 0)) {
      return null;
    }

    const inserted = await sql<{ id: number }>`
      insert into treasury_transactions (
        txn_type, amount, note, reference_type, reference_id, branch_id, location_id, created_by, created_at, tenant_id, account_id
      ) values (
        'cash_in', ${amount}, ${`خدمة نقدي: ${String(service.name || '').trim()}`}, 'service', ${serviceId}, ${scope.branchId}, ${scope.locationId}, ${auth.userId}, ${new Date()}, ${tenantScope.tenantId}, ${tenantScope.accountId}
      )
      returning id
    `.execute(db);
    return Number(inserted.rows?.[0]?.id || 0) || null;
  }

  // INV-SERVICES-TREASURY-APPEND-ONLY (closed-shift guard): a service
  // whose cash entered inside a CLOSED shift may not be updated or
  // deleted. Two predicates, one window ([shift.created_at,
  // shift.closed_at], branch/location null-tolerant, the same window
  // computeShiftServiceBreakdown uses): (a) any cash_in treasury leg
  // of the service dated inside the window — reversal legs are
  // excluded, they record the update moment, not the cash entry;
  // (b) the service row itself, because the shift service detail
  // reads the services table (created_by + created_at window), so
  // changing the amount rewrites the closed shift's reported cash
  // even though services.created_at never moves. Card services have
  // no treasury leg, so (b) is what protects them. Checked inside
  // the transaction AFTER the FOR UPDATE lock, BEFORE any reversal,
  // so a refused call changes nothing.
  private async assertServiceNotInClosedShift(
    db: Kysely<Database>,
    serviceId: number,
    serviceRow: { branch_id?: number | string | null; location_id?: number | string | null; created_by?: number | string | null; created_at?: Date | string | null },
    operation: 'update' | 'delete',
    auth: AuthContext,
  ): Promise<void> {
    const tenantScope = requireTenantScope(auth);
    const branchId = this.toNullableNumber(serviceRow.branch_id);
    const locationId = this.toNullableNumber(serviceRow.location_id);
    const createdBy = Number(serviceRow.created_by || 0) || null;
    const createdAt = serviceRow.created_at ? new Date(serviceRow.created_at) : null;
    const found = await sql<{ id: number }>`
      select cs.id
      from cashier_shifts cs
      where cs.tenant_id = ${tenantScope.tenantId}
        and cs.status = 'closed'
        and (
          exists (
            select 1 from treasury_transactions tt
            where tt.tenant_id = ${tenantScope.tenantId}
              and tt.reference_type = 'service'
              and tt.reference_id = ${serviceId}
              and tt.txn_type = 'cash_in'
              and tt.created_at >= cs.created_at
              and (cs.closed_at is null or tt.created_at <= cs.closed_at)
              and (cs.branch_id is null or tt.branch_id is null or tt.branch_id = cs.branch_id)
              and (cs.location_id is null or tt.location_id is null or tt.location_id = cs.location_id)
          )
          or (
            ${createdBy}::bigint is not null and ${createdBy}::bigint = cs.opened_by
            and ${createdAt}::timestamptz is not null and ${createdAt}::timestamptz >= cs.created_at
            and (cs.closed_at is null or ${createdAt}::timestamptz <= cs.closed_at)
            and (cs.branch_id is null or ${branchId}::int is null or ${branchId}::int = cs.branch_id)
            and (cs.location_id is null or ${locationId}::int is null or ${locationId}::int = cs.location_id)
          )
        )
      limit 1
    `.execute(db);
    if (found.rows?.length) {
      throw new AppError(
        operation === 'delete'
          ? 'لا يمكن حذف خدمة تنتمي إلى وردية مغلقة'
          : 'لا يمكن تعديل خدمة تنتمي إلى وردية مغلقة',
        'SERVICE_SHIFT_CLOSED',
        422,
      );
    }
  }

  async listServices(query: Record<string, unknown>, auth: AuthContext, db: Kysely<Database> = this.db): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    // Book digits once per call; `db` is the transaction handle when the
    // caller runs inside runInTransaction, never the pool inside a txn.
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(db, scope.tenantId));
    const result = await sql<{
      id: number;
      name: string;
      amount: string | number;
      notes: string;
      service_date: string;
      payment_channel?: string | null;
      branch_id?: string | number | null;
      location_id?: string | number | null;
      branch_name?: string | null;
      location_name?: string | null;
      created_by_name: string | null;
    }>`
      select s.id, s.name, s.amount, s.notes, s.service_date, coalesce(s.payment_channel, 'cash') as payment_channel,
             s.branch_id, s.location_id, coalesce(b.name, '') as branch_name, coalesce(l.name, '') as location_name, u.username as created_by_name
      from services s
      left join branches b on b.id = s.branch_id and b.tenant_id = ${scope.tenantId}
      left join stock_locations l on l.id = s.location_id and l.tenant_id = ${scope.tenantId}
      left join users u on u.id = s.created_by and u.tenant_id = ${scope.tenantId}
      where s.tenant_id = ${scope.tenantId}
      order by s.id desc
    `.execute(db);

    const search = String(query.search || '').trim().toLowerCase();
    const filter = String(query.filter || 'all').trim().toLowerCase();
    // INV-SERVICES-TODAY-COUNT: "today" is the TENANT-local day, and a row
    // counts when its service_date falls on that day. The old code compared
    // String(row.serviceDate).slice(0, 10) with a UTC ISO date -- but
    // service_date is TIMESTAMPTZ, which pg returns as a JS Date, so
    // String(date) is "Wed Nov 05 ..." and the comparison could never
    // match (todayCount was always 0); and the UTC day itself was wrong
    // for 00:00-02:00 Cairo. Format the row's date in the tenant timezone.
    const businessTz = await getTenantTimezone(db, scope.tenantId);
    const today = todayTenantDate(businessTz);
    const isToday = (value: unknown): boolean => {
      const date = value instanceof Date ? value : new Date(String(value ?? ''));
      return Number.isFinite(date.getTime()) && todayTenantDate(businessTz, date) === today;
    };

    let rows = result.rows.map((row) => ({
      id: String(row.id),
      name: row.name || '',
      amount: Number(row.amount || 0),
      notes: row.notes || '',
      serviceDate: row.service_date,
      paymentChannel: this.normalizePaymentChannel(row.payment_channel),
      branchId: row.branch_id ? String(row.branch_id) : '',
      locationId: row.location_id ? String(row.location_id) : '',
      branchName: row.branch_name || '',
      locationName: row.location_name || '',
      createdByName: row.created_by_name || '',
    }));

    if (filter === 'today') rows = rows.filter((row) => isToday(row.serviceDate));
    else if (filter === 'high') rows = rows.filter((row) => Number(row.amount || 0) >= 100);
    else if (filter === 'notes') rows = rows.filter((row) => String(row.notes || '').trim().length > 0);

    if (search) {
      rows = rows.filter((row) => [row.name, row.notes, row.createdByName, row.branchName, row.locationName].some((value) => String(value || '').toLowerCase().includes(search)));
    }

    const paged = paginateRows(rows, query, { defaultSize: 20 });
    const totalAmount = roundMoney(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0), moneyDigits);
    const cashAmount = roundMoney(rows.filter((row) => row.paymentChannel === 'cash').reduce((sum, row) => sum + Number(row.amount || 0), 0), moneyDigits);
    const cardAmount = roundMoney(rows.filter((row) => row.paymentChannel === 'card').reduce((sum, row) => sum + Number(row.amount || 0), 0), moneyDigits);
    const todayRows = rows.filter((row) => isToday(row.serviceDate));
    const highestAmount = rows.length ? Math.max(...rows.map((row) => Number(row.amount || 0))) : 0;
    const latest = rows[0] || null;

    return {
      services: paged.rows,
      pagination: paged.pagination,
      summary: {
        totalItems: rows.length,
        totalAmount,
        cashAmount,
        cardAmount,
        todayCount: todayRows.length,
        averageAmount: rows.length ? roundMoney(totalAmount / rows.length, moneyDigits) : 0,
        highestAmount,
        latestServiceName: latest?.name || '',
        latestCreatedByName: latest?.createdByName || '',
      },
      scope,
    };
  }

  async createService(payload: UpsertServiceDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const tenantScope = requireTenantScope(auth);
    const idemCtx = idempotencyStorage.getStore();
    if (idemCtx?.idempotencyKey) {
      const cached = await this.idempotency.check(idemCtx.idempotencyKey, tenantScope);
      if (cached) return cached.response;
    }

    const service = payload.service;
    const normalizedService = {
      name: String(service.name || '').trim(),
      amount: Number(service.amount || 0),
      notes: String(service.notes || '').trim(),
      date: service.date,
      paymentChannel: this.normalizePaymentChannel(service.paymentChannel),
    };

    // Captured inside the transaction and logged only after it commits, so
    // the audit entry names the journal entry and treasury transaction
    // that really exist — never a number from a rolled-back attempt.
    // A holder object (not plain `let`s): TS narrows a `let` initialized
    // to null to `never` past a callback assignment, a property does not
    // narrow that way.
    const capture: {
      serviceId: number;
      postingResult: { posted: boolean; journalEntryId: number | null } | null;
      treasuryTransactionId: number | null;
    } = { serviceId: 0, postingResult: null, treasuryTransactionId: null };

    const finalResponse = await this.tx.runInTransaction(this.db, async (trx) => {
      const financeScope = await this.getOpenShiftFinanceScope(trx, auth);
      const inserted = await sql<{ id?: number }>`
        insert into services (name, amount, notes, service_date, payment_channel, branch_id, location_id, created_by, tenant_id, account_id)
        values (${normalizedService.name}, ${normalizedService.amount}, ${normalizedService.notes}, ${new Date(normalizedService.date)}, ${normalizedService.paymentChannel}, ${financeScope.branchId}, ${financeScope.locationId}, ${auth.userId}, ${tenantScope.tenantId}, ${tenantScope.accountId})
        returning id
      `.execute(trx);

      capture.serviceId = Number(inserted.rows?.[0]?.id || 0);
      if (!(capture.serviceId > 0)) throw new AppError('Service could not be saved', 'SERVICE_SAVE_FAILED', 400);

      capture.treasuryTransactionId = await this.syncServiceTreasuryTransaction(trx, capture.serviceId, normalizedService, auth, financeScope);
      capture.postingResult = await this.accountingPosting.postService(trx, capture.serviceId, 1, auth);

      const responsePayload = { ok: true, ...(await this.listServices({}, auth, trx)) };
      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: tenantScope.tenantId, accountId: tenantScope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType },
          responsePayload
        );
      }
      return responsePayload;
    });

    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantScope.tenantId));
    const journalPart = capture.postingResult?.journalEntryId ? ` — قيد #${capture.postingResult.journalEntryId}` : '';
    const treasuryPart = capture.treasuryTransactionId ? ` — خزينة #${capture.treasuryTransactionId}` : '';
    await this.audit.log(
      'إضافة خدمة',
      `تمت إضافة خدمة #${capture.serviceId} — ${normalizedService.name} — ${normalizedService.amount.toFixed(digits)} بواسطة ${auth.username}${journalPart}${treasuryPart}`,
      auth,
    );
    return finalResponse;
  }

  async updateService(id: number, payload: UpsertServiceDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const tenantScope = requireTenantScope(auth);
    const idemCtx = idempotencyStorage.getStore();
    if (idemCtx?.idempotencyKey) {
      const cached = await this.idempotency.check(idemCtx.idempotencyKey, tenantScope);
      if (cached) return cached.response;
    }

    const service = payload.service;
    const normalizedService = {
      name: String(service.name || '').trim(),
      amount: Number(service.amount || 0),
      notes: String(service.notes || '').trim(),
      date: service.date,
      paymentChannel: this.normalizePaymentChannel(service.paymentChannel),
    };

    const finalResponse = await this.tx.runInTransaction(this.db, async (trx) => {
      const existing = await sql<{ id: number; branch_id?: number | string | null; location_id?: number | string | null; revision: number; created_by?: number | string | null; created_at?: Date | string | null; name?: string | null }>`
        select id, branch_id, location_id, revision, created_by, created_at, name
        from services
        where tenant_id = ${tenantScope.tenantId} and id = ${id}
        for update
      `.execute(trx);

      const existingRow = existing.rows?.[0] || null;
      if (!existingRow) throw new AppError('Service not found', 'SERVICE_NOT_FOUND', 404);

      await this.assertServiceNotInClosedShift(trx, id, existingRow, 'update', auth);

      const financeScope = { branchId: this.toNullableNumber(existingRow.branch_id), locationId: this.toNullableNumber(existingRow.location_id) };

      await this.accountingPosting.reverseService(trx, id, existingRow.revision, auth);

      const newRevision = existingRow.revision + 1;

      await sql`
        update services
        set name = ${normalizedService.name}, amount = ${normalizedService.amount}, notes = ${normalizedService.notes}, service_date = ${new Date(normalizedService.date)}, payment_channel = ${normalizedService.paymentChannel}, revision = ${newRevision}
        where tenant_id = ${tenantScope.tenantId} and id = ${id}
      `.execute(trx);

      await this.syncServiceTreasuryTransaction(trx, id, normalizedService, auth, financeScope);
      await this.accountingPosting.postService(trx, id, newRevision, auth);

      const responsePayload = { ok: true, ...(await this.listServices({}, auth, trx)) };
      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: tenantScope.tenantId, accountId: tenantScope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType },
          responsePayload
        );
      }
      return responsePayload;
    });

    await this.audit.log('تعديل خدمة', 'تم تعديل خدمة بواسطة ' + auth.username, auth);
    return finalResponse;
  }

  async deleteService(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const tenantScope = requireTenantScope(auth);
    const idemCtx = idempotencyStorage.getStore();
    if (idemCtx?.idempotencyKey) {
      const cached = await this.idempotency.check(idemCtx.idempotencyKey, tenantScope);
      if (cached) return cached.response;
    }

    const finalResponse = await this.tx.runInTransaction(this.db, async (trx) => {
      const existing = await sql<{ id: number; revision: number; name?: string | null; branch_id?: number | string | null; location_id?: number | string | null; created_by?: number | string | null; created_at?: Date | string | null }>`
        select id, revision, name, branch_id, location_id, created_by, created_at
        from services
        where tenant_id = ${tenantScope.tenantId} and id = ${id}
        for update
      `.execute(trx);

      if (!existing.rows.length) throw new AppError('Service not found', 'SERVICE_NOT_FOUND', 404);
      const existingRow = existing.rows[0];

      await this.assertServiceNotInClosedShift(trx, id, existingRow, 'delete', auth);

      await this.accountingPosting.reverseService(trx, id, existingRow.revision, auth);
      // Append-only: reverse the live cash with a cash_out leg, never
      // DELETE the treasury rows; the service row itself is hard-deleted.
      await this.postServiceTreasuryReversal(trx, id, existingRow.name || '', auth, {
        branchId: this.toNullableNumber(existingRow.branch_id),
        locationId: this.toNullableNumber(existingRow.location_id),
      });
      await sql`delete from services where tenant_id = ${tenantScope.tenantId} and id = ${id}`.execute(trx);

      const responsePayload = { ok: true, ...(await this.listServices({}, auth, trx)) };
      if (idemCtx && idemCtx.idempotencyKey && idemCtx.operationType) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: tenantScope.tenantId, accountId: tenantScope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType },
          responsePayload
        );
      }
      return responsePayload;
    });

    await this.audit.log('حذف خدمة', 'تم حذف خدمة بواسطة ' + auth.username, auth);
    return finalResponse;
  }
}
