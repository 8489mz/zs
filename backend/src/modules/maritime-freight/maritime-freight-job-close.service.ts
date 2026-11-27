import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { resolveFxRate } from '../accounting/fx-rate-resolution';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { convertFxAmount } from '../accounting/engines/fx-conversion.engine';
import { resolveSaleTaxRate } from '../sales/engines/sale-tax-rate.engine';
import { forexOffsetCode } from '../accounting/engines/forex-difference.engine';
import { currencyMoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';
import { NotFoundException, BadRequestException, Injectable } from '@nestjs/common';
import { sql, type Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { calculateAirChargeableWeight, validateIataAwbNumber } from './engines/air-freight.engine';
import { JobChargeDto, UpdateJobChargesDto } from './dto/itemized-charges.dto';

/**
 * MaritimeFreightJobCloseService — slice S17 of the maritime-freight split.
 * Pure move of 7 methods from MaritimeFreightService (Job Close:
 * the job update, the itemized charges grid, the forex gain/loss
 * helper, the shared FX offset account helper, and the stored-money
 * close posting). No behavior change: the bodies are byte-identical
 * except that the one private helper drops the private modifier in
 * the slice (it is called only from inside this slice); the facade
 * keeps thin delegates with the same names and signatures for the
 * other 6 methods. The job update lives here, NOT in the jobs-core
 * slice — it calls the close posting, so keeping it there would cycle
 * the two slices. Deps: db + the posting service (required, not
 * optional) + 5 bound helpers from the jobs-core slice + the
 * tenant-configured tax-rate resolver bound from the quotations slice
 * + 2 bound account helpers from the customs slice. On this
 * generation tree the facade binds its own methods for all 8 bound
 * deps; when the jobs-core, quotations and customs slices land (they
 * merge before this one), the merge repoints each binding to its
 * slice instance — functionally identical either way, since the
 * facade methods become thin delegates after those merges. The two
 * customs helpers sit in the file between this slice's methods and
 * stay in the facade for their own slice. PGlite hang shape is
 * present in this slice (pure moves, NOT fixed): the job update calls
 * the close guard and the road-proof guard inside its open
 * transaction — recorded as file-level fix debt. Pins are merge-owned:
 * the charge-grid range, the stored-money rework (including the
 * trailing banner marker), the p0a multi-file read, the freight-tax
 * multi-file counts, the consolidation-totals rework, and the FX
 * multi-file repoint. Pinned methods: the charges updater, the forex
 * gain/loss helper, and the stored-money close posting. The job
 * update itself is unpinned.
 */

export interface MaritimeFreightJobCloseDeps {
  db: Kysely<Database>;
  accountingPosting: AccountingPostingService;
  assertJobCanClose: (tenantId: string, jobId: string) => Promise<void>;
  assertRoadProofOfDelivery: (
    tenantId: string,
    jobId: string,
    bookingNumber: string | null | undefined,
  ) => Promise<void>;
  assertUniqueMasterBl: (
    tenantId: string,
    mbl: string | null | undefined,
    jobId?: string,
    parentJobId?: string | null,
    trx?: any,
  ) => Promise<void>;
  syncConsolidationParentTotals: (
    queryable: any,
    tenantId: string,
    parentJobId: string | number,
  ) => Promise<{ synced: boolean; grossWeightKg: number; totalCbm: number; packageCount: number }>;
  getJobById: (auth: AuthContext, id: string) => Promise<any>;
  resolveTenantConfiguredTaxRate: (queryable: Kysely<Database>, tenantId: string) => Promise<unknown>;
  hasPostedCloseJournal: (queryable: any, tenantId: string, sourceType: string, sourceId: number) => Promise<boolean>;
  resolveMaritimeAccountIdOn: (
    queryable: any,
    tenantId: string,
    code: string,
    fallbackCode?: string,
  ) => Promise<number | null>;
}

@Injectable()
export class MaritimeFreightJobCloseService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly assertJobCanClose: (tenantId: string, jobId: string) => Promise<void>;
  private readonly assertRoadProofOfDelivery: (
    tenantId: string,
    jobId: string,
    bookingNumber: string | null | undefined,
  ) => Promise<void>;
  private readonly assertUniqueMasterBl: (
    tenantId: string,
    mbl: string | null | undefined,
    jobId?: string,
    parentJobId?: string | null,
    trx?: any,
  ) => Promise<void>;
  private readonly syncConsolidationParentTotals: (
    queryable: any,
    tenantId: string,
    parentJobId: string | number,
  ) => Promise<{ synced: boolean; grossWeightKg: number; totalCbm: number; packageCount: number }>;
  private readonly getJobById: (auth: AuthContext, id: string) => Promise<any>;
  private readonly resolveTenantConfiguredTaxRate: (queryable: Kysely<Database>, tenantId: string) => Promise<unknown>;
  private readonly hasPostedCloseJournal: (
    queryable: any,
    tenantId: string,
    sourceType: string,
    sourceId: number,
  ) => Promise<boolean>;
  private readonly resolveMaritimeAccountIdOn: (
    queryable: any,
    tenantId: string,
    code: string,
    fallbackCode?: string,
  ) => Promise<number | null>;

  constructor(deps: MaritimeFreightJobCloseDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.assertJobCanClose = deps.assertJobCanClose;
    this.assertRoadProofOfDelivery = deps.assertRoadProofOfDelivery;
    this.assertUniqueMasterBl = deps.assertUniqueMasterBl;
    this.syncConsolidationParentTotals = deps.syncConsolidationParentTotals;
    this.getJobById = deps.getJobById;
    this.resolveTenantConfiguredTaxRate = deps.resolveTenantConfiguredTaxRate;
    this.hasPostedCloseJournal = deps.hasPostedCloseJournal;
    this.resolveMaritimeAccountIdOn = deps.resolveMaritimeAccountIdOn;
  }

  async updateJob(auth: AuthContext, id: string, dto: any) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('maritime_jobs')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .forUpdate()
        .executeTakeFirst();

      if (!existing) throw new NotFoundException('Shipment Job not found');
      const closingMode = dto.transportMode || existing.transport_mode;
      if (dto.status === 'completed' && existing.status !== 'completed') {
        await this.assertJobCanClose(tenantId, id);
        if (closingMode === 'air' && existing.milestone_status !== 'DLV') {
          throw new BadRequestException('إغلاق الشحنة الجوية يتطلب استكمال معالم Cargo iQ حتى التسليم');
        }
        if (closingMode === 'road') {
          await this.assertRoadProofOfDelivery(tenantId, id, dto.bookingNumber ?? existing.booking_number);
        }
      }
      if (dto.mblNumber !== undefined) {
        if (dto.mblNumber?.trim()) {
          await sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${dto.mblNumber.trim().toUpperCase()}))`.execute(
            trx,
          );
        }
        await this.assertUniqueMasterBl(tenantId, dto.mblNumber, id, existing.parent_job_id, trx);
      }

      const updatePayload: any = {
        updated_at: sql`NOW()`,
      };

      const transportMode = dto.transportMode || existing.transport_mode;
      if (dto.transportMode !== undefined) updatePayload.transport_mode = dto.transportMode;
      if (dto.airCargoType !== undefined) updatePayload.air_cargo_type = dto.airCargoType || null;
      if (dto.flightNumber !== undefined) updatePayload.flight_number = dto.flightNumber || null;
      if (dto.flightDate !== undefined) updatePayload.flight_date = dto.flightDate || null;

      if (transportMode === 'air' && dto.mawbNumber) {
        const mawbValidation = validateIataAwbNumber(dto.mawbNumber);
        if (!mawbValidation.valid) {
          throw new BadRequestException(mawbValidation.error);
        }
        updatePayload.mawb_number = mawbValidation.formattedAwb || dto.mawbNumber;
      } else if (dto.mawbNumber !== undefined) {
        updatePayload.mawb_number = dto.mawbNumber || null;
      }

      if (dto.hawbNumber !== undefined) updatePayload.hawb_number = dto.hawbNumber || null;

      const grossWeightKg =
        dto.grossWeightKg !== undefined ? Number(dto.grossWeightKg || 0) : Number(existing.gross_weight_kg || 0);
      const totalCbm = dto.totalCbm !== undefined ? Number(dto.totalCbm || 0) : Number(existing.total_cbm || 0);
      let volumetricWeightKg =
        dto.volumetricWeightKg !== undefined
          ? Number(dto.volumetricWeightKg || 0)
          : Number(existing.volumetric_weight_kg || 0);
      let chargeableWeightKg =
        dto.chargeableWeightKg !== undefined
          ? Number(dto.chargeableWeightKg || 0)
          : Number(existing.chargeable_weight_kg || 0);

      if (transportMode === 'air' && (grossWeightKg > 0 || totalCbm > 0)) {
        const airCalc = calculateAirChargeableWeight({ grossWeightKg, cbm: totalCbm });
        volumetricWeightKg = Math.max(volumetricWeightKg, airCalc.volumetricWeightKg);
        chargeableWeightKg = Math.max(chargeableWeightKg, airCalc.chargeableWeightKg);
      }

      if (dto.grossWeightKg !== undefined) updatePayload.gross_weight_kg = grossWeightKg;
      if (dto.volumetricWeightKg !== undefined || (transportMode === 'air' && volumetricWeightKg > 0))
        updatePayload.volumetric_weight_kg = volumetricWeightKg;
      if (dto.chargeableWeightKg !== undefined || (transportMode === 'air' && chargeableWeightKg > 0))
        updatePayload.chargeable_weight_kg = chargeableWeightKg;
      if (dto.totalCbm !== undefined) updatePayload.total_cbm = totalCbm;
      if (dto.packageCount !== undefined) updatePayload.package_count = Number(dto.packageCount || 0);
      if (dto.status !== undefined) updatePayload.status = dto.status;
      if (dto.vesselName !== undefined) updatePayload.vessel_name = dto.vesselName || null;
      if (dto.voyageNumber !== undefined) updatePayload.voyage_number = dto.voyageNumber || null;
      if (dto.bookingNumber !== undefined) updatePayload.booking_number = dto.bookingNumber || null;
      if (dto.polCode !== undefined) updatePayload.pol_code = dto.polCode;
      if (dto.polName !== undefined) updatePayload.pol_name = dto.polName;
      if (dto.podCode !== undefined) updatePayload.pod_code = dto.podCode;
      if (dto.podName !== undefined) updatePayload.pod_name = dto.podName;
      if (dto.etd !== undefined) updatePayload.etd = dto.etd || null;
      if (dto.eta !== undefined) updatePayload.eta = dto.eta || null;
      if (dto.portCutOff !== undefined) updatePayload.port_cut_off = dto.portCutOff || null;
      // INV-PHASE1-D-M1-JOB-FIELDS: the 9 fields the three job cards
      // PUT (JobConsolidationTab, JobEgyptianAciCard,
      // JobExportCutoffsCard) were silently dropped — the service
      // updated only updated_at while the UI toasted success. Wired
      // through with the same values the caller sends, no
      // transformation. isConsolidation -> is_consolidation_master
      // (the column createJob already writes from
      // dto.isConsolidationMaster); the toggle-off design (master
      // with children) stays a separate question — this is the field
      // passthrough only, so false persists as false.
      if (dto.isConsolidation !== undefined) updatePayload.is_consolidation_master = dto.isConsolidation;
      if (dto.acidNumber !== undefined) updatePayload.acid_number = dto.acidNumber || null;
      if (dto.acidIssueDate !== undefined) updatePayload.acid_issue_date = dto.acidIssueDate || null;
      if (dto.acidExpiryDate !== undefined) updatePayload.acid_expiry_date = dto.acidExpiryDate || null;
      if (dto.foreignExporterId !== undefined) updatePayload.foreign_exporter_id = dto.foreignExporterId || null;
      if (dto.importerTaxId !== undefined) updatePayload.importer_tax_id = dto.importerTaxId || null;
      if (dto.siCutoffDate !== undefined) updatePayload.si_cutoff_date = dto.siCutoffDate || null;
      if (dto.vgmCutoffDate !== undefined) updatePayload.vgm_cutoff_date = dto.vgmCutoffDate || null;
      if (dto.portCutoffDate !== undefined) updatePayload.port_cutoff_date = dto.portCutoffDate || null;
      if (dto.blType !== undefined) updatePayload.bl_type = dto.blType;
      if (dto.mblNumber !== undefined) updatePayload.mbl_number = dto.mblNumber?.trim().toUpperCase() || null;
      if (dto.hblNumber !== undefined) updatePayload.hbl_number = dto.hblNumber || null;
      if (dto.shipperDetails !== undefined) updatePayload.shipper_details = dto.shipperDetails || null;
      if (dto.consigneeDetails !== undefined) updatePayload.consignee_details = dto.consigneeDetails || null;
      if (dto.notifyParty !== undefined) updatePayload.notify_party = dto.notifyParty || null;
      if (dto.shippingLineId !== undefined) updatePayload.shipping_line_id = dto.shippingLineId || null;
      if (dto.shippingLineName !== undefined) updatePayload.shipping_line_name = dto.shippingLineName;
      if (dto.notes !== undefined) updatePayload.notes = dto.notes || null;

      const [updatedJob] = await trx
        .updateTable('maritime_jobs')
        .set(updatePayload)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .returningAll()
        .execute();

      // INV-MARITIME-STORED-MONEY-POST-AT-CLOSE: closing the job
      // posts its stored money in the same transaction, so a failed
      // posting rolls the close back with it. A re-close of an
      // already-completed job re-runs the (idempotent) posting, so
      // a RETN-completed job can still post here as the recovery
      // path when the milestone path failed.
      if (dto.status === 'completed') {
        await this.postStoredMoneyAtClose(trx, tenantId, id, auth);
      }

      // INV-MARITIME-CONSOLIDATION-TOTALS-REAL: editing a child
      // re-derives its parent's totals in the same transaction, so
      // the parent can never drift from its line items. Editing a
      // parent directly (no parent_job_id) leaves its totals as
      // edited until the next child change re-derives them.
      if ((updatedJob as any)?.parent_job_id) {
        await this.syncConsolidationParentTotals(trx, tenantId, (updatedJob as any).parent_job_id);
      }

      return updatedJob;
    });
  }

  // ==========================================
  // 1. Itemized Charges Grid & Multi-Currency ROE
  // ==========================================

  async getQuotationCharges(auth: AuthContext, quotationId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_quotation_charges')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('quotation_id', '=', String(quotationId))
      .orderBy('id', 'asc')
      .execute();
  }

  async getJobCharges(auth: AuthContext, jobId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_job_charges')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(jobId))
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * INV-MARITIME-CHARGE-GRID-LINE-UPDATES: the charge grid updates
   * line by line, keyed by the stored row id -- never
   * delete-all + reinsert, which destroyed invoiced history on
   * every save. The stored is_invoiced flag is authoritative:
   * a caller-supplied isInvoiced is IGNORED on existing rows
   * (an invoiced row is left byte-untouched however the payload
   * revalues it, so a round-tripped float can never rewrite
   * invoiced history) and REJECTED on new rows (a new row
   * cannot invent invoiced history). Rows with an id that does
   * not belong to this job, and duplicate ids in one payload,
   * are rejected. Stored rows absent from the payload are
   * deleted EXCEPT invoiced rows, which survive omission. The
   * marked-total guard runs over the STORED invoiced rows after
   * the update (converted through the shared resolver on the
   * transaction handle -- never the pool handle inside the
   * transaction), against the posted maritime_job revenue.
   * A completed job still rejects the whole update first.
   */
  async updateJobCharges(auth: AuthContext, jobId: string | number, dto: UpdateJobChargesDto) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.getJobById(auth, String(jobId));
    if (job.status === 'completed') {
      throw new BadRequestException('أعد فتح الشحنة قبل تعديل مصروفاتها ورسومها');
    }
    return await this.db.transaction().execute(async (trx) => {
      const stored = await trx
        .selectFrom('maritime_job_charges')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', String(jobId))
        .forUpdate()
        .execute();
      const storedById = new Map(stored.map((row) => [String(row.id), row]));

      const seenIds = new Set<string>();
      for (const charge of dto.charges) {
        if (charge.id == null) continue;
        const key = String(charge.id);
        if (seenIds.has(key)) {
          throw new BadRequestException('بند التكلفة مكرر في نفس الحفظ؛ كل بند يظهر مرة واحدة فقط');
        }
        seenIds.add(key);
        if (!storedById.has(key)) {
          throw new NotFoundException('بند التكلفة غير موجود في هذه الشحنة');
        }
      }

      // T2: same canonical gate as createQuotation / createJob, on
      // the sell basis -- re-saving a charge re-validates its rate
      // against the tenant's configured rate (or 0 = exempt).
      // Invoiced rows stay frozen above and never reach this.
      const configuredTaxRate = await this.resolveTenantConfiguredTaxRate(trx, tenantId);
      const computeValues = (chg: JobChargeDto) => {
        const cost = Number(chg.costAmount || 0);
        const sell = Number(chg.sellAmount || 0);
        const profit = Number(chg.profitAmount ?? sell - cost);
        const taxPct = resolveSaleTaxRate(chg.taxRatePercent, configuredTaxRate);
        const taxAmt = Number(chg.taxAmount ?? (sell * taxPct) / 100);
        return {
          charge_code: chg.chargeCode || 'CHG',
          charge_name_ar: chg.chargeNameAr || 'رسوم نولون / خدمات',
          charge_name_en: chg.chargeNameEn || 'Freight / Logistics Charge',
          currency: chg.currency || 'USD',
          cost_amount: cost,
          sell_amount: sell,
          profit_amount: profit,
          is_local_charge: Boolean(chg.isLocalCharge),
          tax_rate_percent: taxPct,
          tax_amount: taxAmt,
        };
      };

      const keptIds = new Set<string>();
      for (const chg of dto.charges) {
        if (chg.id != null) {
          const key = String(chg.id);
          keptIds.add(key);
          const row = storedById.get(key)!;
          // Invoiced rows are frozen: the stored flag stands and
          // the row is left byte-untouched whatever the payload
          // claims about its amounts or its invoiced flag.
          if (row.is_invoiced) continue;
          await trx
            .updateTable('maritime_job_charges')
            .set(computeValues(chg))
            .where('tenant_id', '=', tenantId)
            .where('job_id', '=', String(jobId))
            .where('id', '=', String(chg.id))
            .execute();
        } else {
          // A new row cannot arrive already invoiced: the flag
          // comes only from the invoicing flow itself.
          if (chg.isInvoiced) {
            throw new BadRequestException('لا يمكن إنشاء بند جديد موسوماً كمفوتر؛ الوسم يأتي من الفوترة فقط');
          }
          await trx
            .insertInto('maritime_job_charges')
            .values({
              tenant_id: tenantId,
              job_id: String(jobId),
              ...computeValues(chg),
              is_invoiced: false,
            })
            .execute();
        }
      }

      const omitted = stored.filter((row) => !keptIds.has(String(row.id)) && !row.is_invoiced);
      if (omitted.length > 0) {
        await trx
          .deleteFrom('maritime_job_charges')
          .where('tenant_id', '=', tenantId)
          .where('job_id', '=', String(jobId))
          .where(
            'id',
            'in',
            omitted.map((row) => String(row.id)),
          )
          .execute();
      }

      const invoicedRows = await trx
        .selectFrom('maritime_job_charges')
        .select(['sell_amount', 'currency'])
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', String(jobId))
        .where('is_invoiced', '=', true)
        .execute();
      if (invoicedRows.length > 0) {
        const posted = await trx
          .selectFrom('journal_entries as je')
          .innerJoin('journal_entry_lines as jl', (join: any) =>
            join.onRef('jl.journal_entry_id', '=', 'je.id').onRef('jl.tenant_id', '=', 'je.tenant_id'),
          )
          .select(sql<number>`COALESCE(SUM(jl.credit), 0)`.as('amount'))
          .where('je.tenant_id', '=', tenantId)
          .where('je.source_id', '=', Number(jobId))
          .where('je.source_type', '=', 'maritime_job')
          .where('je.status', '=', 'posted')
          .executeTakeFirst();
        let markedTotal = 0;
        for (const row of invoicedRows) {
          if (Number(row.sell_amount || 0) <= 0) {
            throw new BadRequestException('لا يمكن وسم بند تكلفة مفوتر دون مبلغ بيع للعميل');
          }
          markedTotal += Number(row.sell_amount) * (await resolveFxRate(trx, tenantId, row.currency || 'USD'));
        }
        if (markedTotal > Number(posted?.amount || 0) + 0.01) {
          throw new BadRequestException('البنود الموسومة مفوترة تتجاوز فواتير العميل المرحلة فعلياً');
        }
      }

      return await trx
        .selectFrom('maritime_job_charges')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', String(jobId))
        .orderBy('id', 'asc')
        .execute();
    });
  }

  async calculateJobForexGainLoss(auth: AuthContext, jobId: string | number, actualRoe: number) {
    const { tenantId } = requireTenantScope(auth);
    if (!Number.isFinite(actualRoe) || actualRoe <= 0) {
      throw new BadRequestException('سعر الصرف الفعلي يجب أن يكون موجباً وصالحاً');
    }
    const job = await this.db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(jobId) as any)
      .executeTakeFirst();

    if (!job) throw new NotFoundException('Job not found');

    const quoteRoe = Number(job.quote_roe || 0);
    // INV-MARITIME-FOREX-GAIN-LOSS-BOOK-DIGITS: the base currency
    // comes strictly from tenantBaseCurrency (fail-closed on a
    // settings/rate mismatch, no silent EGP fallback), and the
    // stored spread rounds at the base currency's book digits
    // through the canonical engine. convertFxAmount is not used:
    // the spread can be negative or zero.
    const baseCurrency = await tenantBaseCurrency(this.db, tenantId);
    const invoices = await this.db
      .selectFrom('maritime_carrier_invoices')
      .select(['currency', 'total_invoiced_amount'])
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(jobId))
      .where('journal_entry_id', 'is not', null)
      .execute();
    const foreignInvoices = invoices.filter((invoice) => invoice.currency.toUpperCase() !== baseCurrency.toUpperCase());
    if (new Set(foreignInvoices.map((invoice) => invoice.currency.toUpperCase())).size > 1) {
      throw new BadRequestException('توجد أكثر من عملة ناقل؛ يلزم احتساب فروق الصرف لكل عملة على حدة');
    }
    if (foreignInvoices.length > 0 && (!Number.isFinite(quoteRoe) || quoteRoe <= 0)) {
      throw new BadRequestException('سعر الصرف التعاقدي غير متاح لحساب فرق العملة');
    }
    const foreignTotal = foreignInvoices.reduce((sum, invoice) => sum + Number(invoice.total_invoiced_amount || 0), 0);
    const forexGainLoss = roundMoney((quoteRoe - actualRoe) * foreignTotal, currencyMoneyDigits(baseCurrency));

    const [updated] = await this.db
      .updateTable('maritime_jobs')
      .set({
        actual_roe: actualRoe,
        forex_gain_loss: forexGainLoss,
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(jobId) as any)
      .returningAll()
      .execute();

    return updated;
  }

  /**
   * The chart's shared FX offset account (7180 gain / 7280 loss,
   * forexOffsetCode), created on demand EXACTLY as the forex
   * revaluation service creates it (same parent 7100/7200, same
   * names, same flags) when the tenant chart does not have it yet.
   * The name is the chart's name for this code; forking a second
   * code for the same difference would split one difference across
   * two accounts and break the revaluation service's own name
   * check on the shared code. A missing parent fails closed.
   */
  async resolveMaritimeFxOffsetAccountOn(
    queryable: any,
    tenantId: string,
    accountId: string,
    gain: boolean,
  ): Promise<number> {
    const code = forexOffsetCode(gain ? 1 : -1);
    const nameEn = gain ? 'Unrealized FX Gains' : 'Unrealized FX Losses';
    const existing = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'is_active', 'account_type', 'name_en'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (existing) {
      const expectedType = gain ? 'revenue' : 'expense';
      if (!existing.is_active || existing.account_type !== expectedType || existing.name_en !== nameEn) {
        throw new BadRequestException('حساب فروق العملة غير نشط أو تصنيفه غير صحيح.');
      }
      return Number(existing.id);
    }
    const parentCode = gain ? '7100' : '7200';
    const parent = await queryable
      .selectFrom('accounting_accounts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', parentCode)
      .executeTakeFirst();
    if (!parent)
      throw new BadRequestException('حساب الإيرادات أو المصروفات الأخرى غير موجود؛ لا يمكن إنشاء حساب فروق العملة.');
    await queryable
      .insertInto('accounting_accounts')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        code,
        name_ar: gain ? 'أرباح فروق عملة غير محققة' : 'خسائر فروق عملة غير محققة',
        name_en: nameEn,
        account_type: gain ? 'revenue' : 'expense',
        normal_balance: gain ? 'credit' : 'debit',
        account_group: gain ? 'income' : 'operating_expenses',
        parent_id: Number(parent.id),
        is_active: true,
        is_system: true,
        allow_manual_entries: false,
        is_control_account: false,
        is_cash_bank: false,
        is_receivable: false,
        is_payable: false,
        is_inventory: false,
        is_tax: false,
        description_ar: '',
        sort_order: Number(code),
      } as any)
      .onConflict((oc: any) => oc.columns(['tenant_id', 'code']).doNothing())
      .execute();
    const created = await queryable
      .selectFrom('accounting_accounts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (!created) throw new BadRequestException('حساب فروق العملة غير موجود؛ لا يمكن ترحيل فرق العملة عند الإغلاق.');
    return Number(created.id);
  }

  /**
   * INV-MARITIME-STORED-MONEY-POST-AT-CLOSE: stored-only maritime
   * money posts automatically when a job closes, to explicit
   * accounts, with no extra staff work. Every slice reads and
   * writes through the caller-supplied queryable only (a
   * transaction handle from updateJob, the pool handle from the
   * RETN milestone path), converts through the shared resolver at
   * book digits, and is idempotent per source row: a posted close
   * journal for the same (sourceType, sourceId) is never posted
   * twice, so reopening and re-closing a job posts only genuinely
   * new rows. Slices:
   * - forex gain/loss: the stored spread adjusts the carrier
   *   payable (2110) against the shared offset account (7180 gain /
   *   7280 loss), only when a posted carrier invoice exists to
   *   adjust; a spread with no posted invoice is skipped, never
   *   invented into a payable movement.
   * - inland trucking: COMPLETED trips only (delivered /
   *   empty_returned) post their cost as expense (6400, fallback
   *   5100) against 2110. The sell side is NOT posted: billing
   *   the customer stays in the job-charges/invoice flow, and
   *   posting it here too would double the revenue.
   * - cargo insurance: active policies post their premium as
   *   expense (6400, fallback 5100) against 2110. Claims stay
   *   stored-only (contingent, separate decision).
   * - container demurrage_amount is DELIBERATELY NOT posted here:
   *   demurrage is billed as DEM charges through the normal
   *   invoice flow (the close guard already demands one), and
   *   posting the stored amount too would double-count it.
   * Trucking + insurance costs roll into the job's
   * other_costs_total / net_profit by the same formula the
   * carrier-invoice and expense paths use. Missing expense or
   * payable accounts fail closed; nothing is silently skipped.
   * The supplier subledger is not written (not decided): the
   * payable legs use partnerType 'none'.
   */
  async postStoredMoneyAtClose(
    queryable: any,
    tenantId: string,
    jobId: string | number,
    auth: AuthContext,
  ): Promise<{
    posted: boolean;
    journalEntryIds: number[];
    forex: { posted: boolean; amount: number; reason: string | null };
    trucking: { postedCount: number; amount: number };
    insurance: { postedCount: number; amount: number };
  }> {
    const { accountId } = requireTenantScope(auth);
    const job = await queryable
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(jobId) as any)
      .executeTakeFirst();
    if (!job) throw new NotFoundException('Job not found');
    const baseCurrency = await tenantBaseCurrency(queryable, tenantId);
    const digits = currencyMoneyDigits(baseCurrency);
    const costCenterId = job.cost_center_id ? Number(job.cost_center_id) : null;
    const entryDate = new Date();
    const journalEntryIds: number[] = [];
    let postedCosts = 0;

    const postCloseJournal = async (
      sourceType: string,
      sourceId: number,
      description: string,
      lines: Array<{ accountId: number; debit: number; credit: number }>,
    ): Promise<number> => {
      return this.accountingPosting.postDomainJournal(queryable, {
        tenantId,
        accountId,
        entryDate,
        description,
        sourceType,
        sourceId,
        createdBy: auth.userId || null,
        lines: lines.map((line) => ({
          ...line,
          costCenterId,
          description,
          partnerType: 'none' as const,
          partnerId: null,
        })),
      });
    };

    // 1. Forex gain/loss against the carrier payable.
    let forex: { posted: boolean; amount: number; reason: string | null } = { posted: false, amount: 0, reason: null };
    const spread = roundMoney(Number(job.forex_gain_loss || 0), digits);
    if (spread !== 0) {
      const postedInvoice = await queryable
        .selectFrom('maritime_carrier_invoices')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', String(jobId))
        .where('journal_entry_id', 'is not', null)
        .executeTakeFirst();
      if (!postedInvoice) {
        forex = { posted: false, amount: spread, reason: 'no posted carrier invoice to adjust' };
      } else if (await this.hasPostedCloseJournal(queryable, tenantId, 'maritime_job_forex_close', Number(job.id))) {
        forex = { posted: false, amount: spread, reason: 'already posted at an earlier close' };
      } else {
        const payableId = await this.resolveMaritimeAccountIdOn(queryable, tenantId, '2110');
        if (!payableId)
          throw new BadRequestException(
            'تعذر ترحيل فرق العملة عند الإغلاق: حساب الذمم الدائنة (2110) غير متاح في شجرة الحسابات.',
          );
        const gain = spread > 0;
        const offsetId = await this.resolveMaritimeFxOffsetAccountOn(queryable, tenantId, accountId, gain);
        const amount = Math.abs(spread);
        const entryId = await postCloseJournal(
          'maritime_job_forex_close',
          Number(job.id),
          `فرق عملة عند إغلاق الشحنة #${job.job_number}`,
          gain
            ? [
                { accountId: payableId, debit: amount, credit: 0 },
                { accountId: offsetId, debit: 0, credit: amount },
              ]
            : [
                { accountId: offsetId, debit: amount, credit: 0 },
                { accountId: payableId, debit: 0, credit: amount },
              ],
        );
        journalEntryIds.push(entryId);
        forex = { posted: true, amount: spread, reason: null };
      }
    }

    // 2. Completed trucking trips: cost only.
    let truckingCount = 0;
    let truckingAmount = 0;
    const trips = await queryable
      .selectFrom('maritime_inland_trucking_trips')
      .select(['id', 'trip_number', 'trip_status', 'cost_amount', 'currency'])
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(jobId))
      .execute();
    for (const trip of trips) {
      if (!['delivered', 'empty_returned'].includes(String(trip.trip_status))) continue;
      const cost = Number(trip.cost_amount || 0);
      if (!(cost > 0)) continue;
      if (await this.hasPostedCloseJournal(queryable, tenantId, 'maritime_trucking_close', Number(trip.id))) continue;
      const rate = await resolveFxRate(queryable, tenantId, trip.currency || undefined);
      const baseCost = convertFxAmount(cost, rate, digits);
      if (!(baseCost > 0)) continue;
      const expenseId = await this.resolveMaritimeAccountIdOn(queryable, tenantId, '6400', '5100');
      const payableId = await this.resolveMaritimeAccountIdOn(queryable, tenantId, '2110');
      if (!expenseId || !payableId) {
        throw new BadRequestException(
          'تعذر ترحيل تكلفة النقل البري عند الإغلاق: حساب المصروف (6400/5100) أو الذمم الدائنة (2110) غير متاح.',
        );
      }
      const entryId = await postCloseJournal(
        'maritime_trucking_close',
        Number(trip.id),
        `تكلفة نقل بري عند إغلاق الشحنة #${job.job_number} - الرحلة ${trip.trip_number}`,
        [
          { accountId: expenseId, debit: baseCost, credit: 0 },
          { accountId: payableId, debit: 0, credit: baseCost },
        ],
      );
      journalEntryIds.push(entryId);
      truckingCount++;
      truckingAmount = roundMoney(truckingAmount + baseCost, digits);
    }

    // 3. Active cargo-insurance premiums.
    let insuranceCount = 0;
    let insuranceAmount = 0;
    const policies = await queryable
      .selectFrom('maritime_cargo_insurances')
      .select(['id', 'policy_number', 'premium_amount', 'currency', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(jobId) as any)
      .execute();
    for (const policy of policies) {
      if (String(policy.status) !== 'active') continue;
      const premium = Number(policy.premium_amount || 0);
      if (!(premium > 0)) continue;
      if (await this.hasPostedCloseJournal(queryable, tenantId, 'maritime_insurance_close', Number(policy.id)))
        continue;
      const rate = await resolveFxRate(queryable, tenantId, policy.currency || undefined);
      const basePremium = convertFxAmount(premium, rate, digits);
      if (!(basePremium > 0)) continue;
      const expenseId = await this.resolveMaritimeAccountIdOn(queryable, tenantId, '6400', '5100');
      const payableId = await this.resolveMaritimeAccountIdOn(queryable, tenantId, '2110');
      if (!expenseId || !payableId) {
        throw new BadRequestException(
          'تعذر ترحيل قسط التأمين عند الإغلاق: حساب المصروف (6400/5100) أو الذمم الدائنة (2110) غير متاح.',
        );
      }
      const entryId = await postCloseJournal(
        'maritime_insurance_close',
        Number(policy.id),
        `قسط تأمين بضائع عند إغلاق الشحنة #${job.job_number} - الوثيقة ${policy.policy_number}`,
        [
          { accountId: expenseId, debit: basePremium, credit: 0 },
          { accountId: payableId, debit: 0, credit: basePremium },
        ],
      );
      journalEntryIds.push(entryId);
      insuranceCount++;
      insuranceAmount = roundMoney(insuranceAmount + basePremium, digits);
    }

    // 4. Roll the posted costs into the job P&L by the same formula
    // the carrier-invoice and expense paths use.
    postedCosts = roundMoney(truckingAmount + insuranceAmount, digits);
    if (postedCosts > 0) {
      const fresh = await queryable
        .selectFrom('maritime_jobs')
        .select(['client_invoiced_total', 'carrier_cost_total', 'other_costs_total'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(jobId) as any)
        .executeTakeFirstOrThrow();
      const newOther = roundMoney(Number(fresh.other_costs_total || 0) + postedCosts, digits);
      const newNet = roundMoney(
        Number(fresh.client_invoiced_total || 0) - (Number(fresh.carrier_cost_total || 0) + newOther),
        digits,
      );
      await queryable
        .updateTable('maritime_jobs')
        .set({ other_costs_total: newOther, net_profit: newNet, updated_at: sql`NOW()` })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(jobId) as any)
        .execute();
    }

    return {
      posted: journalEntryIds.length > 0,
      journalEntryIds,
      forex,
      trucking: { postedCount: truckingCount, amount: truckingAmount },
      insurance: { postedCount: insuranceCount, amount: insuranceAmount },
    };
  }

  // ==========================================
  // 2. Consolidation & Sub-Jobs (LCL Multi-HBL)
  // ==========================================
}
