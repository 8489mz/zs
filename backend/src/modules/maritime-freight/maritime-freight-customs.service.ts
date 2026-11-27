import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { resolveFxRate } from '../accounting/fx-rate-resolution';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { convertFxAmount } from '../accounting/engines/fx-conversion.engine';
import { currencyMoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';
import { NotFoundException, BadRequestException, Injectable } from '@nestjs/common';
import { sql, Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import {
  CreateCustomsDeclarationDto,
  CreateCustomsDeclarationItemDto,
  UpdateCustomsDeclarationStatusDto,
} from './dto/customs-declaration.dto';

/**
 * MaritimeFreightCustomsService — slice S5 of the maritime-freight split.
 * Pure move of 10 methods from MaritimeFreightService (customs
 * declarations: HS codes + duty tracking, internal record-keeping).
 * No behavior change: the bodies are byte-identical; the facade keeps
 * thin delegates with the same names and signatures for the 7 methods
 * anything outside the slice calls. Deps are db + accountingPosting
 * (REQUIRED — postCustomsDutyAtClearance posts the duty journal via
 * this.accountingPosting.postDomainJournal inside the caller's tx).
 * No mail, no WhatsApp, no logger (this.logger x0 in the moved text).
 * The 3 in-slice-only privates (mapCustomsDeclarationRow,
 * mapCustomsItemRow, postCustomsDutyAtClearance) stay private here and
 * have NO facade delegate — zero callers outside the service file
 * (ground-proven by grep; file #8 S7/S10 precedent). The 2
 * cross-slice privates (resolveMaritimeAccountIdOn,
 * hasPostedCloseJournal) are PUBLIC here (private in the facade
 * delegate) — S17 calls them through its bound slice instance
 * (TS2341; merge-owned edge). Both take a caller-supplied queryable,
 * so close postings never read this.db from inside an open tx.
 * The 15-line customs opener banner travels before
 * mapCustomsDeclarationRow; the Freight Audit banner travels after
 * updateCustomsDeclarationStatus (pin trap: the customs-duty pin
 * slices statusBody to '// Freight Audit'). Date handling travels
 * verbatim: new Date() x2 (duty + status), resolveBusinessDateKey x1,
 * tenantBaseCurrency x3; no instant comparison, no UTC-slice
 * normalizer. Pinned: createCustomsDeclaration,
 * addCustomsDeclarationItem, updateCustomsDeclarationStatus (driven
 * by maritime-customs-duty-book-digits.spec.ts — the pin #14 repoint
 * is merge-owned). postCustomsDutyAtClearance is unpinned (driven
 * only through updateCustomsDeclarationStatus). No PGlite hang shape
 * in this slice: the 3 tx sites are safe (pure mappers + a
 * trx-passing posting; the account/journal callees take a queryable).
 * No spec repoint travels in this patch — merge-owned.
 */

export interface MaritimeFreightCustomsDeps {
  db: Kysely<Database>;
  accountingPosting: AccountingPostingService;
}

@Injectable()
export class MaritimeFreightCustomsService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;

  constructor(deps: MaritimeFreightCustomsDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
  }

  // --------------------------------------------------------------------------
  // Customs Declarations (HS Codes & Duty Tracking — internal record-keeping)
  // --------------------------------------------------------------------------
  // NOT live filing with a customs authority: this closes the "customs is only
  // descriptive text in the carrier directory" gap by giving HS codes, declared
  // value, and duty amounts a real place to live and be totalled, so a shipment's
  // landed cost is complete. Government EDI filing needs a broker/authority
  // integration and credentials this session does not have (O18).
  //
  // INV-MARITIME-CUSTOMS-DUTY-BOOK-DIGITS: the status machine is
  // permissive-forward and strict-backward. 'cleared' is terminal
  // because clearance posts money to the ledger; a cleared
  // declaration can never move again. Same-status transitions
  // are not listed: a retried request gets a clear error naming
  // both states instead of a silent no-op.
  private mapCustomsDeclarationRow(r: any) {
    return {
      id: String(r.id),
      jobId: String(r.job_id),
      declarationNumber: r.declaration_number,
      declarationType: r.declaration_type,
      customsAuthority: r.customs_authority,
      brokerName: r.broker_name,
      submittedDate: r.submitted_date,
      clearedDate: r.cleared_date,
      status: r.status,
      totalCustomsValue: Number(r.total_customs_value),
      totalDutyAmount: Number(r.total_duty_amount),
      currency: r.currency,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapCustomsItemRow(r: any) {
    return {
      id: String(r.id),
      declarationId: String(r.declaration_id),
      hsCode: r.hs_code,
      commodityDescription: r.commodity_description,
      quantity: Number(r.quantity),
      unit: r.unit,
      customsValue: Number(r.customs_value),
      dutyRatePercent: Number(r.duty_rate_percent),
      dutyAmount: Number(r.duty_amount),
      notes: r.notes,
    };
  }

  async listCustomsDeclarations(auth: AuthContext, jobId: string) {
    const { tenantId } = requireTenantScope(auth);
    const rows = await this.db
      .selectFrom('maritime_customs_declarations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', jobId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((r) => this.mapCustomsDeclarationRow(r));
  }

  async getCustomsDeclarationDetail(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    const declaration = await this.db
      .selectFrom('maritime_customs_declarations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!declaration) throw new NotFoundException('البيان الجمركي غير موجود');

    const items = await this.db
      .selectFrom('maritime_customs_declaration_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('declaration_id', '=', id)
      .execute();

    return {
      declaration: this.mapCustomsDeclarationRow(declaration),
      items: items.map((i) => this.mapCustomsItemRow(i)),
    };
  }

  async createCustomsDeclaration(auth: AuthContext, jobId: string, dto: CreateCustomsDeclarationDto) {
    const { tenantId } = requireTenantScope(auth);

    return this.db.transaction().execute(async (trx) => {
      const job = await trx
        .selectFrom('maritime_jobs')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', jobId)
        .executeTakeFirst();
      if (!job) throw new NotFoundException('عملية الشحن غير موجودة');

      const items = dto.items || [];
      let totalCustomsValue = 0;
      let totalDutyAmount = 0;
      // INV-MARITIME-CUSTOMS-DUTY-BOOK-DIGITS: every line duty is
      // rounded once at the tenant's book digits -- never the
      // hardcoded 2dp the code used to apply -- and the header
      // total is the sum of the rounded lines.
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      const computedItems = items.map((item) => {
        const customsValue = Number(item.customsValue || 0);
        const dutyRatePercent = Number(item.dutyRatePercent || 0);
        const dutyAmount = roundMoney(customsValue * (dutyRatePercent / 100), digits);
        totalCustomsValue += customsValue;
        totalDutyAmount += dutyAmount;
        return { ...item, dutyAmount };
      });

      const declarationRow = await trx
        .insertInto('maritime_customs_declarations')
        .values({
          tenant_id: tenantId,
          job_id: jobId,
          declaration_number: dto.declarationNumber || null,
          declaration_type: dto.declarationType || 'import',
          customs_authority: dto.customsAuthority || null,
          broker_name: dto.brokerName || null,
          status: 'pending',
          total_customs_value: totalCustomsValue,
          total_duty_amount: totalDutyAmount,
          currency: dto.currency || 'USD',
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const insertedItems: any[] = [];
      for (const item of computedItems) {
        const itemRow = await trx
          .insertInto('maritime_customs_declaration_items')
          .values({
            tenant_id: tenantId,
            declaration_id: String(declarationRow.id),
            hs_code: item.hsCode,
            commodity_description: item.commodityDescription || '',
            quantity: item.quantity || 0,
            unit: item.unit || 'PCS',
            customs_value: item.customsValue,
            duty_rate_percent: item.dutyRatePercent,
            duty_amount: item.dutyAmount,
            notes: item.notes || null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        insertedItems.push(itemRow);
      }

      return {
        declaration: this.mapCustomsDeclarationRow(declarationRow),
        items: insertedItems.map((i) => this.mapCustomsItemRow(i)),
      };
    });
  }

  async addCustomsDeclarationItem(auth: AuthContext, declarationId: string, dto: CreateCustomsDeclarationItemDto) {
    const { tenantId } = requireTenantScope(auth);

    return this.db.transaction().execute(async (trx) => {
      const declaration = await trx
        .selectFrom('maritime_customs_declarations')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', declarationId)
        .forUpdate()
        .executeTakeFirst();
      if (!declaration) throw new NotFoundException('البيان الجمركي غير موجود');

      const customsValue = Number(dto.customsValue || 0);
      const dutyRatePercent = Number(dto.dutyRatePercent || 0);
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      const dutyAmount = roundMoney(customsValue * (dutyRatePercent / 100), digits);

      const itemRow = await trx
        .insertInto('maritime_customs_declaration_items')
        .values({
          tenant_id: tenantId,
          declaration_id: declarationId,
          hs_code: dto.hsCode,
          commodity_description: dto.commodityDescription || '',
          quantity: dto.quantity || 0,
          unit: dto.unit || 'PCS',
          customs_value: customsValue,
          duty_rate_percent: dutyRatePercent,
          duty_amount: dutyAmount,
          notes: dto.notes || null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('maritime_customs_declarations')
        .set({
          total_customs_value: Number(declaration.total_customs_value) + customsValue,
          total_duty_amount: Number(declaration.total_duty_amount) + dutyAmount,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', declarationId)
        .execute();

      return this.mapCustomsItemRow(itemRow);
    });
  }

  /**
   * INV-MARITIME-CUSTOMS-DUTY-BOOK-DIGITS: the duty posted when a
   * declaration clears. The stored total duty converts from the
   * declaration currency through the shared resolver at book
   * digits (fail closed when no rate is registered -- money tier
   * strict), posts Dr 6400 (fallback 5100) / Cr 2110 with the
   * job's cost center and partnerType 'none' (the supplier
   * subledger is not written: not decided), and rolls into the
   * job's other_costs_total / net_profit by the same formula
   * the carrier-invoice and close postings use. A posted
   * clearance journal for the same declaration is never posted
   * twice, and a zero duty posts nothing. Runs inside the
   * caller's transaction, so a failed posting rolls the status
   * change back with it: a declaration is never 'cleared' with
   * no journal behind it.
   */
  private async postCustomsDutyAtClearance(
    trx: any,
    tenantId: string,
    accountId: string,
    declaration: any,
    auth: AuthContext,
  ): Promise<number | null> {
    const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
    const totalDuty = roundMoney(Number(declaration.total_duty_amount || 0), digits);
    if (!(totalDuty > 0)) return null;
    if (await this.hasPostedCloseJournal(trx, tenantId, 'maritime_customs_declaration', Number(declaration.id))) {
      return null;
    }
    const rate = await resolveFxRate(trx, tenantId, declaration.currency || undefined);
    const baseDuty = convertFxAmount(totalDuty, rate, digits);
    if (!(baseDuty > 0)) return null;
    const expenseId = await this.resolveMaritimeAccountIdOn(trx, tenantId, '6400', '5100');
    const payableId = await this.resolveMaritimeAccountIdOn(trx, tenantId, '2110');
    if (!expenseId || !payableId) {
      throw new BadRequestException(
        'تعذر ترحيل الرسوم الجمركية عند التخليص: حساب المصروف (6400/5100) أو الذمم الدائنة (2110) غير متاح.',
      );
    }
    const job = await trx
      .selectFrom('maritime_jobs')
      .select(['cost_center_id', 'client_invoiced_total', 'carrier_cost_total', 'other_costs_total'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', declaration.job_id)
      .executeTakeFirst();
    const description = `رسوم جمركية عند التخليص - البيان ${declaration.declaration_number || declaration.id}`;
    const entryId = await this.accountingPosting.postDomainJournal(trx, {
      tenantId,
      accountId,
      entryDate: new Date(),
      description,
      sourceType: 'maritime_customs_declaration',
      sourceId: Number(declaration.id),
      createdBy: auth.userId || null,
      lines: [
        {
          accountId: expenseId,
          debit: baseDuty,
          credit: 0,
          costCenterId: job?.cost_center_id ? Number(job.cost_center_id) : null,
          description,
          partnerType: 'none' as const,
          partnerId: null,
        },
        {
          accountId: payableId,
          debit: 0,
          credit: baseDuty,
          costCenterId: job?.cost_center_id ? Number(job.cost_center_id) : null,
          description,
          partnerType: 'none' as const,
          partnerId: null,
        },
      ],
    });
    if (job) {
      const newOther = roundMoney(Number(job.other_costs_total || 0) + baseDuty, digits);
      const newNet = roundMoney(
        Number(job.client_invoiced_total || 0) - (Number(job.carrier_cost_total || 0) + newOther),
        digits,
      );
      await trx
        .updateTable('maritime_jobs')
        .set({ other_costs_total: newOther, net_profit: newNet, updated_at: sql`NOW()` })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', declaration.job_id)
        .execute();
    }
    return entryId;
  }

  async updateCustomsDeclarationStatus(auth: AuthContext, id: string, dto: UpdateCustomsDeclarationStatusDto) {
    const { tenantId, accountId } = requireTenantScope(auth);
    const allowedTransitions: Record<string, string[]> = {
      pending: ['submitted', 'cleared', 'held', 'rejected'],
      submitted: ['cleared', 'held', 'rejected'],
      held: ['submitted', 'cleared', 'rejected'],
      cleared: [],
      rejected: ['submitted', 'pending'],
    };

    return this.db.transaction().execute(async (trx) => {
      const declaration = await trx
        .selectFrom('maritime_customs_declarations')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!declaration) throw new NotFoundException('البيان الجمركي غير موجود');
      const allowed = allowedTransitions[String(declaration.status)] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `لا يمكن نقل البيان الجمركي من الحالة ${declaration.status} إلى الحالة ${dto.status}.`,
        );
      }
      const updatePayload: any = { status: dto.status, updated_at: sql`NOW()` };
      if (dto.declarationNumber) updatePayload.declaration_number = dto.declarationNumber;
      // Status dates are business days: the tenant-local day, not UTC.
      const statusDay = await resolveBusinessDateKey(trx, tenantId, new Date());
      if (dto.status === 'submitted') updatePayload.submitted_date = statusDay;
      if (dto.status === 'cleared') updatePayload.cleared_date = statusDay;

      const [updated] = await trx
        .updateTable('maritime_customs_declarations')
        .set(updatePayload)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .returningAll()
        .execute();

      if (!updated) throw new NotFoundException('البيان الجمركي غير موجود');
      if (dto.status === 'cleared') {
        await this.postCustomsDutyAtClearance(trx, tenantId, accountId, updated, auth);
      }
      return this.mapCustomsDeclarationRow(updated);
    });
  }

  // --------------------------------------------------------------------------
  // Freight Audit & Rate Reconciliation (CargoWise Benchmark)
  // --------------------------------------------------------------------------
  /**
   * INV-MARITIME-STORED-MONEY-POST-AT-CLOSE: account resolution on a
   * caller-supplied queryable (transaction handle or pool), mirroring
   * resolveAccountId, so close postings never read this.db from
   * inside an open transaction.
   */
  async resolveMaritimeAccountIdOn(
    queryable: any,
    tenantId: string,
    code: string,
    fallbackCode?: string,
  ): Promise<number | null> {
    const acc = await queryable
      .selectFrom('accounting_accounts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (acc) return Number(acc.id);
    if (fallbackCode) {
      const fallback = await queryable
        .selectFrom('accounting_accounts')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('code', '=', fallbackCode)
        .where('is_active', '=', true)
        .executeTakeFirst();
      if (fallback) return Number(fallback.id);
    }
    return null;
  }

  async hasPostedCloseJournal(
    queryable: any,
    tenantId: string,
    sourceType: string,
    sourceId: number,
  ): Promise<boolean> {
    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('source_type', '=', sourceType)
      .where('source_id', '=', sourceId)
      .where('status', '=', 'posted')
      .executeTakeFirst();
    return Boolean(existing);
  }
}
