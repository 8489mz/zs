import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { resolveFxRate } from '../accounting/fx-rate-resolution';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { convertFxAmount } from '../accounting/engines/fx-conversion.engine';
import { resolveSaleTaxRate } from '../sales/engines/sale-tax-rate.engine';
import { currencyMoneyDigits } from '../accounting/engines/money-minor-units.engine';
import {
  NotFoundException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { sql, type Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { CreateMaritimeJobDto } from './dto/create-job.dto';
import { DCSA_STANDARD_MILESTONES, ROAD_FREIGHT_MILESTONES } from './maritime-freight.types';
import { calculateAirChargeableWeight, validateIataAwbNumber, IATA_CARGO_IQ_MILESTONES } from './engines/air-freight.engine';
import { validateCmrWaybillNumber } from './engines/road-freight.engine';
import * as crypto from 'crypto';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { formatLocalCalendarDay, getTenantTimezone } from '../../common/utils/tenant-timezone.util';
import { evaluateAcidNumber } from './engines/acid-number.engine';

/**
 * MaritimeFreightJobsCoreService — slice S12 of the maritime-freight split.
 * Pure move of 9 methods from MaritimeFreightService (Shipment Jobs
 * Engine). No behavior change: the bodies are byte-identical except
 * that the 4 private helpers drop the private modifier in the slice
 * (they are cross-slice, so they are public here); the facade keeps
 * thin delegates with the same names and signatures for ALL 9 methods.
 * The 4 privates are cross-slice (ground-proven): the unique-BL guard
 * is called by updateJob in S17, the close guard by updateJob and by
 * addJobMilestone in S18, the road-proof guard by updateJob, by
 * addJobMilestone and by the trucking status update in S16, and the
 * container-deposit poster by updateContainer and createContainer in
 * S13. Deps: db + the posting service (required, not optional) + the
 * tax-rate resolver bound from the quotations slice + the exchange
 * rate, account-id and period-lock kernel methods bound from the
 * facade, plus the slice's own Logger. The tax-rate binding points at
 * the facade's own method on this generation tree; after the S3 merge
 * it binds the delegate that forwards to the quotations slice, so the
 * binding stays correct. This slice carries the money-math allowlist
 * re-split: the 3dp consolidation helper moves here with its method,
 * so the facade entry drops to zero and a new entry for this slice
 * file carries one (same reason, right after the facade entry).
 * PGlite hang shape is present in this slice (pure moves, NOT fixed):
 * the close guard, the road-proof guard and the job reader read the
 * pool handle directly, and the deposit poster reaches the account
 * resolver — recorded as file-level fix debt. Pins are merge-owned:
 * the consolidation-totals and freight-tax reworks, the p0a multi-file
 * read, the clock-b5 date-format pin that travels with the close guard,
 * and the FX multi-file repoint. Pinned methods: the deposit poster,
 * the consolidation sync, the job creator and the quotation converter.
 */

export interface MaritimeFreightJobsCoreDeps {
  db: Kysely<Database>;
  accountingPosting: AccountingPostingService;
  resolveTenantConfiguredTaxRate: (queryable: Kysely<Database>, tenantId: string) => Promise<unknown>;
  resolveFreightExchangeRate: (tenantId: string, currency: string | undefined, suppliedRate?: number) => Promise<number>;
  resolveAccountId: (tenantId: string, code: string, fallbackCode?: string) => Promise<number | null>;
  assertMaritimeJournalPeriodOpen: (trx: any, tenantId: string, entryDate: Date) => Promise<void>;
}

@Injectable()
export class MaritimeFreightJobsCoreService {
  private readonly logger = new Logger(MaritimeFreightJobsCoreService.name);
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly resolveTenantConfiguredTaxRate: (queryable: Kysely<Database>, tenantId: string) => Promise<unknown>;
  private readonly resolveFreightExchangeRate: (tenantId: string, currency: string | undefined, suppliedRate?: number) => Promise<number>;
  private readonly resolveAccountId: (tenantId: string, code: string, fallbackCode?: string) => Promise<number | null>;
  private readonly assertMaritimeJournalPeriodOpen: (trx: any, tenantId: string, entryDate: Date) => Promise<void>;

  constructor(deps: MaritimeFreightJobsCoreDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.resolveTenantConfiguredTaxRate = deps.resolveTenantConfiguredTaxRate;
    this.resolveFreightExchangeRate = deps.resolveFreightExchangeRate;
    this.resolveAccountId = deps.resolveAccountId;
    this.assertMaritimeJournalPeriodOpen = deps.assertMaritimeJournalPeriodOpen;
  }

  async assertJobCanClose(tenantId: string, jobId: string) {
    const [unbilledCharge, unpostedCarrierInvoice, journals, containers, invoicedCharges] = await Promise.all([
      this.db.selectFrom('maritime_job_charges').select('id').where('tenant_id', '=', tenantId)
        .where('job_id', '=', jobId).where('is_invoiced', '=', false)
        .where((eb) => eb.or([eb('cost_amount', '>', 0), eb('sell_amount', '>', 0)]))
        .executeTakeFirst(),
      this.db.selectFrom('maritime_carrier_invoices').select('id').where('tenant_id', '=', tenantId)
        .where('job_id', '=', jobId).where('journal_entry_id', 'is', null).executeTakeFirst(),
      this.db.selectFrom('journal_entries as je')
        .innerJoin('journal_entry_lines as jl', (join: any) => join.onRef('jl.journal_entry_id', '=', 'je.id').onRef('jl.tenant_id', '=', 'je.tenant_id'))
        .select(['je.source_type', 'jl.debit', 'jl.credit'])
        .where('je.tenant_id', '=', tenantId).where('je.source_id', '=', Number(jobId))
        .where('je.status', '=', 'posted')
        .where('je.source_type', 'in', ['maritime_job', 'maritime_job_expense', 'maritime_carrier_invoice'])
        .execute(),
      this.db.selectFrom('maritime_containers').select(['return_deadline', 'empty_returned_at', 'demurrage_rate_per_day'])
        .where('tenant_id', '=', tenantId).where('job_id', '=', jobId).execute(),
      this.db.selectFrom('maritime_job_charges').select(['charge_code', 'charge_name_en', 'sell_amount', 'cost_amount', 'currency'])
        .where('tenant_id', '=', tenantId).where('job_id', '=', jobId).where('is_invoiced', '=', true).execute(),
    ]);
    if (unbilledCharge || unpostedCarrierInvoice) {
      throw new BadRequestException('لا يمكن إغلاق الشحنة: توجد تكاليف غير مفوترة أو فاتورة ناقل غير مرحلة');
    }
    const expenses = journals.filter((row) => row.source_type !== 'maritime_job')
      .reduce((sum, row) => sum + Number(row.debit || 0), 0);
    const billed = journals.filter((row) => row.source_type === 'maritime_job')
      .reduce((sum, row) => sum + Number(row.credit || 0), 0);
    if (expenses > billed + 0.01) {
      throw new BadRequestException('لا يمكن إغلاق الشحنة: المصروفات المرحلة تتجاوز فواتير العميل المرحلة');
    }
    let chargeCostsBase = 0;
    for (const charge of invoicedCharges) {
      chargeCostsBase += Number(charge.cost_amount || 0) *
        await this.resolveFreightExchangeRate(tenantId, charge.currency);
    }
    if (chargeCostsBase > billed + 0.01) {
      throw new BadRequestException('لا يمكن إغلاق الشحنة: تكاليف بنود التشغيل تتجاوز الفواتير المرحلة للعميل');
    }
    // return_deadline is a stored DATE (a Date object from pg, so a raw
    // string comparison against it is always false) and empty_returned_at
    // is an instant: both sides are reduced to tenant-local day keys.
    const deadlineDayKey = (value: unknown): string =>
      // A stored DATE arrives from pg as a host-local-midnight Date, so
      // the UTC slice would render the previous day on any host east of
      // UTC; key it from host-local calendar parts instead.
      value instanceof Date ? formatLocalCalendarDay(value) : String(value || '').slice(0, 10);
    const hasDueDemurrage = (await Promise.all(containers.map(async (container) => {
      if (!container.return_deadline) return false;
      const returnedDay = await resolveBusinessDateKey(
        this.db, tenantId, container.empty_returned_at ? new Date(container.empty_returned_at) : new Date(),
      );
      return returnedDay > deadlineDayKey(container.return_deadline) &&
        Number(container.demurrage_rate_per_day || 0) > 0;
    }))).some(Boolean);
    if (hasDueDemurrage && (billed <= 0 || !invoicedCharges.some((charge) =>
      /DEM|DETENTION/i.test(`${charge.charge_code} ${charge.charge_name_en}`) && Number(charge.sell_amount) > 0))) {
      throw new BadRequestException('لا يمكن إغلاق الشحنة: غرامات الحاويات المستحقة لم تُفوتر للعميل');
    }
  }

  async assertRoadProofOfDelivery(tenantId: string, jobId: string, bookingNumber: string | null | undefined) {
    const cmr = validateCmrWaybillNumber(bookingNumber || '');
    if (!cmr.valid || !cmr.isInternationalCmr) {
      throw new BadRequestException('لا يمكن تأكيد تسليم الشحنة البرية دون رقم بوليصة CMR مكتمل');
    }
    const documents = await this.db.selectFrom('maritime_job_documents')
      .select(['doc_type', 'title', 'file_url']).where('tenant_id', '=', tenantId)
      .where('job_id', '=', jobId).execute();
    if (!documents.some((doc) => /POD|SIGNED.?CMR|إثبات التسليم/i.test(`${doc.doc_type} ${doc.title}`) &&
      /^(https?:\/\/|s3:\/\/)/i.test(doc.file_url))) {
      throw new BadRequestException('يرجى إرفاق مستند إثبات التسليم POD أو بوليصة CMR موقعة قبل التسليم');
    }
  }

  async assertUniqueMasterBl(tenantId: string, mbl: string | null | undefined, jobId?: string, parentJobId?: string | null, trx?: any) {
    const normalized = mbl?.trim().toUpperCase();
    if (!normalized) return;
    const existing: Array<{ id: string; parent_job_id: string | null }> = await (trx || this.db).selectFrom('maritime_jobs').select(['id', 'parent_job_id'])
      .where('tenant_id', '=', tenantId).where(sql<string>`UPPER(TRIM(mbl_number))`, '=', normalized)
      .execute();
    const familyId = parentJobId || jobId;
    if (existing.some((row) => String(row.id) !== jobId &&
      !(familyId && (String(row.id) === String(familyId) || row.parent_job_id === familyId)))) {
      throw new BadRequestException('رقم بوليصة الشحن الرئيسية Master B/L مستخدم في أمر شحن آخر');
    }
  }

  async postContainerDepositJournal(
    trx: any, tenantId: string, containerId: string, amount: number, currency: string,
    event: 'open' | 'refund' | 'forfeit', userId: number,
  ) {
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('مبلغ تأمين الحاوية غير صالح');
    const assetId = await this.resolveAccountId(tenantId, '1170');
    const otherId = await this.resolveAccountId(tenantId, event === 'forfeit' ? '6400' : '1110');
    if (!assetId || !otherId) throw new BadRequestException('حساب أمانات الحاويات أو الخزينة/المصروف غير متاح');
    let baseAmount: number;
    if (event === 'open') {
      // INV-MARITIME-DEPOSIT-FX-CONVERSION: resolve through the shared
      // resolver on the same transaction and convert at the base
      // currency's book digits. A settings/rate mismatch now fails
      // closed through tenantBaseCurrency instead of silently using
      // the row's is_base flag, and the missing-rate message is the
      // resolver's. The refund/forfeit branches below are unchanged:
      // they reuse the opening journal's stored debit.
      const rate = await resolveFxRate(trx, tenantId, currency);
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      baseAmount = convertFxAmount(amount, rate, digits);
    } else {
      const opening = await trx.selectFrom('journal_entries as je')
        .innerJoin('journal_entry_lines as jl', (join: any) => join.onRef('jl.journal_entry_id', '=', 'je.id').onRef('jl.tenant_id', '=', 'je.tenant_id'))
        .select('jl.debit').where('je.tenant_id', '=', tenantId)
        .where('je.source_type', '=', 'maritime_container_deposit_open')
        .where('je.source_id', '=', Number(containerId)).where('je.status', '=', 'posted')
        .where('jl.account_id', '=', assetId).executeTakeFirst();
      if (!opening || Number(opening.debit) <= 0) {
        throw new BadRequestException('يلزم إثبات قيد دفع تأمين الحاوية قبل تسجيل الاسترداد أو المصادرة');
      }
      baseAmount = Number(opening.debit);
    }
    const entryDate = new Date();
    await this.assertMaritimeJournalPeriodOpen(trx, tenantId, entryDate);
    const description = `تأمين حاوية ${containerId}: ${event} (${amount} ${currency})`;
    await this.accountingPosting.postDomainJournal(trx, {
      tenantId, accountId: tenantId, entryDate, description,
      sourceType: `maritime_container_deposit_${event}`, sourceId: Number(containerId), createdBy: userId,
      lines: [
        { accountId: event === 'open' ? assetId : otherId, description, debit: baseAmount, credit: 0, partnerType: 'none', partnerId: null },
        { accountId: event === 'open' ? otherId : assetId, description, debit: 0, credit: baseAmount, partnerType: 'none', partnerId: null },
      ],
    });
  }

  // --------------------------------------------------------------------------
  // 6. Shipment Jobs Engine (Operations & Cost Centers)
  // --------------------------------------------------------------------------

  /**
   * INV-MARITIME-CONSOLIDATION-TOTALS-REAL: a consolidation
   * parent's totals are DERIVED from its children, recomputed on
   * every child change. The parent row's gross_weight_kg,
   * total_cbm and package_count are the sums of the child jobs'
   * values (3dp, matching the air engine's own CBM rounding);
   * for an air parent the volumetric and chargeable weights are
   * recomputed from the summed gross/CBM through the same pure
   * engine every air job uses. A parent with no children keeps
   * whatever totals were entered manually -- an empty sum must
   * never wipe them. A missing parent (deleted concurrently) is
   * a no-op, not an error. All reads/writes go through the
   * caller-supplied queryable, so the sync runs inside the
   * caller's transaction.
   */
  async syncConsolidationParentTotals(
    queryable: any,
    tenantId: string,
    parentJobId: string | number,
  ): Promise<{ synced: boolean; grossWeightKg: number; totalCbm: number; packageCount: number }> {
    const children = await queryable
      .selectFrom('maritime_jobs')
      .select(['gross_weight_kg', 'total_cbm', 'package_count'])
      .where('tenant_id', '=', tenantId)
      .where('parent_job_id', '=', String(parentJobId))
      .execute();
    const round3 = (value: number): number => Math.round(value * 1000) / 1000;
    const grossWeightKg = round3(children.reduce((sum: number, row: any) => sum + Number(row.gross_weight_kg || 0), 0));
    const totalCbm = round3(children.reduce((sum: number, row: any) => sum + Number(row.total_cbm || 0), 0));
    const packageCount = children.reduce((sum: number, row: any) => sum + Number(row.package_count || 0), 0);
    if (children.length === 0) {
      return { synced: false, grossWeightKg: 0, totalCbm: 0, packageCount: 0 };
    }
    const parent = await queryable
      .selectFrom('maritime_jobs')
      .select(['transport_mode'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(parentJobId) as any)
      .executeTakeFirst();
    if (!parent) {
      return { synced: false, grossWeightKg, totalCbm, packageCount };
    }
    const patch: any = {
      gross_weight_kg: grossWeightKg,
      total_cbm: totalCbm,
      package_count: packageCount,
      updated_at: sql`NOW()`,
    };
    if (parent.transport_mode === 'air') {
      const airCalc = calculateAirChargeableWeight({ grossWeightKg, cbm: totalCbm });
      patch.volumetric_weight_kg = airCalc.volumetricWeightKg;
      patch.chargeable_weight_kg = airCalc.chargeableWeightKg;
    }
    await queryable
      .updateTable('maritime_jobs')
      .set(patch)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(parentJobId) as any)
      .execute();
    return { synced: true, grossWeightKg, totalCbm, packageCount };
  }

  async createJob(auth: AuthContext, dto: CreateMaritimeJobDto) {
    const { tenantId } = requireTenantScope(auth);
    const trackingToken = crypto.randomBytes(16).toString('hex');

    const transportMode = dto.transportMode || 'sea';
    let formattedMawb: string | null = dto.mawbNumber || null;
    if (transportMode === 'air' && dto.mawbNumber) {
      const mawbValidation = validateIataAwbNumber(dto.mawbNumber);
      if (!mawbValidation.valid) {
        throw new BadRequestException(mawbValidation.error);
      }
      formattedMawb = mawbValidation.formattedAwb || dto.mawbNumber;
    }

    // INV-MARITIME-ACID-GATE-REQUIRED-ONLY: the ACID format gate is
    // strict ONLY on shipments that require the number (imports
    // into Egyptian ports, UN/LOCODE EG prefix, direction
    // defaulting to 'import' exactly as the insert below does).
    // It runs BEFORE any database access, so a rejected draft
    // costs nothing and leaves nothing behind. Anywhere else a
    // malformed supplied value only warns in the server log and
    // the job proceeds -- the number is stored as supplied and
    // the gate at conversion time is this same check, since
    // every creation path funnels through createJob.
    const acidCheck = evaluateAcidNumber(dto.direction || 'import', dto.podCode, dto.acidNumber);
    if (acidCheck.required && !acidCheck.valid) {
      throw new BadRequestException('رقم ACID مطلوب للشحنات الواردة إلى الموانئ المصرية ويجب أن يتكون من 19 رقماً بالضبط.');
    }
    if (!acidCheck.required && dto.acidNumber && !acidCheck.valid) {
      this.logger.warn(
        `ACID number supplied for a shipment that does not require one is malformed and will be stored as supplied (direction=${dto.direction || 'import'}, pod=${dto.podCode}).`,
      );
    }

    const grossWeightKg = Number(dto.grossWeightKg || 0);
    const totalCbm = Number(dto.totalCbm || 0);
    let volumetricWeightKg = Number(dto.volumetricWeightKg || 0);
    let chargeableWeightKg = Number(dto.chargeableWeightKg || 0);

    if (transportMode === 'air' && (grossWeightKg > 0 || totalCbm > 0)) {
      const airCalc = calculateAirChargeableWeight({ grossWeightKg, cbm: totalCbm });
      volumetricWeightKg = Math.max(volumetricWeightKg, airCalc.volumetricWeightKg);
      chargeableWeightKg = Math.max(chargeableWeightKg, airCalc.chargeableWeightKg);
    }

    const containerNumbers = (dto.containers || []).map((c) => c.containerNumber.trim().toUpperCase());
    if (containerNumbers.some((number) => !number) || new Set(containerNumbers).size !== containerNumbers.length) {
      throw new BadRequestException('لا يمكن إضافة رقم الحاوية أكثر من مرة في أمر الشحن');
    }

    return await this.db.transaction().execute(async (trx) => {
      if (dto.mblNumber?.trim()) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${dto.mblNumber.trim().toUpperCase()}))`.execute(trx);
        await this.assertUniqueMasterBl(tenantId, dto.mblNumber, undefined, dto.parentJobId, trx);
      }
      const tempNumber = `JOB-TMP-${crypto.randomUUID()}`;

      // 1. Insert Job record first with tempNumber
      const [job] = await trx
        .insertInto('maritime_jobs')
        .values({
          tenant_id: tenantId,
          job_number: tempNumber,
          inquiry_id: dto.inquiryId ? String(dto.inquiryId) : null,
          quotation_id: dto.quotationId ? String(dto.quotationId) : null,
          rfq_id: dto.rfqId ? String(dto.rfqId) : null,
          customer_id: dto.customerId ? Number(dto.customerId) : null,
          customer_name: dto.customerName,
          direction: dto.direction || 'import',
          transport_mode: transportMode,
          air_cargo_type: dto.airCargoType || null,
          gross_weight_kg: grossWeightKg,
          volumetric_weight_kg: volumetricWeightKg,
          chargeable_weight_kg: chargeableWeightKg,
          total_cbm: totalCbm,
          package_count: dto.packageCount ? Number(dto.packageCount) : 0,
          flight_number: dto.flightNumber || null,
          flight_date: dto.flightDate || null,
          mawb_number: formattedMawb,
          hawb_number: dto.hawbNumber || null,
          payment_term: dto.paymentTerm || 'prepaid',
          shipping_line_id: dto.shippingLineId ? String(dto.shippingLineId) : null,
          shipping_line_name: dto.shippingLineName,
          booking_number: dto.bookingNumber || null,
          vessel_name: dto.vesselName || null,
          voyage_number: dto.voyageNumber || null,
          pol_code: dto.polCode.toUpperCase(),
          pol_name: dto.polName,
          pod_code: dto.podCode.toUpperCase(),
          pod_name: dto.podName,
          etd: dto.etd || null,
          eta: dto.eta || null,
          port_cut_off: dto.portCutOff ? new Date(dto.portCutOff) : null,
          bl_type: dto.blType || 'original',
          mbl_number: dto.mblNumber?.trim().toUpperCase() || null,
          hbl_number: dto.hblNumber || null,
          shipper_details: dto.shipperDetails || null,
          consignee_details: dto.consigneeDetails || null,
          notify_party: dto.notifyParty || null,
          milestone_status: dto.transportMode === 'air' ? 'BKD' : dto.transportMode === 'road' ? 'TRK_ASSIGN' : 'BOOK',
          cost_center_id: null,
          tracking_token: trackingToken,
          parent_job_id: dto.parentJobId ? String(dto.parentJobId) : null,
          is_consolidation_master: Boolean(dto.isConsolidationMaster),
          acid_number: dto.acidNumber || null,
          acid_issue_date: dto.acidIssueDate ? dto.acidIssueDate : null,
          acid_expiry_date: dto.acidExpiryDate ? dto.acidExpiryDate : null,
          foreign_exporter_id: dto.foreignExporterId || null,
          importer_tax_id: dto.importerTaxId || null,
          quote_roe: dto.quoteRoe != null ? Number(dto.quoteRoe) : null,
          actual_roe: dto.actualRoe != null ? Number(dto.actualRoe) : null,
          forex_gain_loss: dto.forexGainLoss ? Number(dto.forexGainLoss) : 0,
          roe_clause_agreed: dto.roeClauseAgreed !== undefined ? Boolean(dto.roeClauseAgreed) : true,
          si_cutoff_date: dto.siCutoffDate ? new Date(dto.siCutoffDate) : null,
          vgm_cutoff_date: dto.vgmCutoffDate ? new Date(dto.vgmCutoffDate) : null,
          port_cutoff_date: dto.portCutoffDate ? new Date(dto.portCutoffDate) : (dto.portCutOff ? new Date(dto.portCutOff) : null),
          delivery_address: dto.deliveryAddress || null,
          status: 'active',
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .execute();

      const finalJobNumber = formatDailyDocumentNumber('JOB', Number(job.id), new Date(), 4, await getTenantTimezone(trx, tenantId));

      if (dto.parentJobId) {
        await trx
          .updateTable('maritime_jobs')
          .set({
            sub_job_count: sql`sub_job_count + 1`,
            is_consolidation_master: true,
          })
          .where('id', '=', dto.parentJobId as any)
          .where('tenant_id', '=', tenantId)
          .execute();
        // INV-MARITIME-CONSOLIDATION-TOTALS-REAL: the new child
        // counts in the parent's derived totals immediately, in
        // the same transaction.
        await this.syncConsolidationParentTotals(trx, tenantId, dto.parentJobId);
      }

      if (dto.charges && Array.isArray(dto.charges) && dto.charges.length > 0) {
        // T2: same canonical gate as createQuotation, on the sell
        // basis -- the charge rate must be the tenant's configured
        // rate or 0 (exempt); any other client-sent rate throws
        // SALE_TAX_RATE_MISMATCH and rolls the job back.
        const configuredTaxRate = await this.resolveTenantConfiguredTaxRate(trx, tenantId);
        for (const chg of dto.charges) {
          const cost = Number(chg.costAmount || 0);
          const sell = Number(chg.sellAmount || 0);
          const profit = Number(chg.profitAmount ?? (sell - cost));
          const taxPct = resolveSaleTaxRate(chg.taxRatePercent, configuredTaxRate);
          const taxAmt = Number(chg.taxAmount ?? (sell * taxPct / 100));
          await trx
            .insertInto('maritime_job_charges')
            .values({
              tenant_id: tenantId,
              job_id: String(job.id),
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
              is_invoiced: false,
            })
            .execute();
        }
      }

      // 2. Automatically create an Accounting Cost Center under dimension = 'project'
      let costCenterId: string | null = null;
      const modeLabel = dto.transportMode === 'air' ? 'شحنة جوية' : dto.transportMode === 'road' ? 'شحنة برية' : 'شحنة بحرية';
      const existingCc = await trx
        .selectFrom('cost_centers')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('code', '=', finalJobNumber)
        .executeTakeFirst();

      if (existingCc) {
        costCenterId = String(existingCc.id);
      } else {
        const [costCenter] = await trx
          .insertInto('cost_centers')
          .values({
            tenant_id: tenantId,
            code: finalJobNumber,
            name: `${modeLabel}: ${finalJobNumber} - ${dto.customerName}`,
            dimension: 'project',
            is_active: true,
            description: `مركز تكلفة تلقائي للعملية ${finalJobNumber} (${dto.polName} إلى ${dto.podName})`,
          })
          .returning('id')
          .execute();
        if (costCenter) {
          costCenterId = String(costCenter.id);
        }
      }

      // 3. Update job with final job number and cost center
      const [updatedJob] = await trx
        .updateTable('maritime_jobs')
        .set({
          job_number: finalJobNumber,
          cost_center_id: costCenterId,
        })
        .where('id', '=', job.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();

      // 4. Add initial milestone (DCSA BOOK for sea, Cargo iQ BKD for air, TRK_ASSIGN for road)
      const isAir = dto.transportMode === 'air';
      const isRoad = dto.transportMode === 'road';
      const initialKey = isAir ? 'BKD' : isRoad ? 'TRK_ASSIGN' : 'BOOK';
      const initialTitle = isAir
        ? 'تأكيد حجز الشحنة الجوية (Air Cargo Booked)'
        : isRoad
        ? 'تعيين وسيلة النقل البري والسائق (Truck & Driver Assigned)'
        : 'تأكيد الحجز الملاحي (Booking Confirmed)';
      const initialNotes = isAir
        ? `تم فتح أمر التشغيل وتأكيد الحجز الجوي برقم ${dto.mawbNumber || finalJobNumber}`
        : isRoad
        ? `تم فتح أمر التشغيل وتعيين وسيلة النقل البري برقم ${dto.bookingNumber || finalJobNumber}`
        : `تم فتح أمر التشغيل وتأكيد الحجز بنجاح برقم ${dto.bookingNumber || finalJobNumber}`;

      await trx
        .insertInto('maritime_job_milestones')
        .values({
          tenant_id: tenantId,
          job_id: String(job.id),
          milestone_key: initialKey,
          milestone_title: initialTitle,
          location: dto.polName,
          notes: initialNotes,
          recorded_by: auth.userId ? Number(auth.userId) : null,
        })
        .execute();

      // 5. If containers provided, insert them
      if (dto.containers && dto.containers.length > 0) {
        for (const c of dto.containers) {
          const [container] = await trx
            .insertInto('maritime_containers')
            .values({
              tenant_id: tenantId,
              job_id: String(job.id),
              container_number: c.containerNumber.trim().toUpperCase(),
              container_type: c.containerType || '40HC',
              seal_number: c.sealNumber || null,
              gross_weight_kg: Number(c.grossWeightKg || 0),
              cbm: Number(c.cbm || 0),
              free_days: Number(c.freeDays ?? 14),
              deposit_amount: Number(c.depositAmount || 0),
              deposit_currency: c.depositCurrency || 'EGP',
              deposit_status: Number(c.depositAmount || 0) > 0 ? 'held_by_line' : 'not_required',
            })
            .returning('id').execute();
          if (Number(c.depositAmount || 0) > 0) {
            await this.postContainerDepositJournal(trx, tenantId, String(container.id), Number(c.depositAmount),
              c.depositCurrency || 'EGP', 'open', auth.userId);
          }
        }
      }

      // 6. If linked to quotation, update quotation
      if (dto.quotationId) {
        await trx
          .updateTable('maritime_quotations')
          .set({
            status: 'converted_to_job',
            converted_job_id: String(job.id),
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', dto.quotationId as any)
          .execute();
      }

      // 7. If linked to inquiry, update inquiry
      if (dto.inquiryId) {
        await trx
          .updateTable('maritime_inquiries')
          .set({
            status: 'converted_to_job',
            job_id: String(job.id),
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', dto.inquiryId as any)
          .execute();
      }

      return updatedJob;
    });
  }

  async autoConvertQuotationToJob(auth: AuthContext, quotationId: string) {
    const { tenantId } = requireTenantScope(auth);
    // INV-MARITIME-AUTOCONVERT-ROLLBACK-STATUS: capture the status the
    // quote had BEFORE the flip, so a failed conversion restores
    // exactly that status. Restoring a hardcoded 'approved' rewrote
    // history: a failed conversion of a 'sent', 'draft' or 'rejected'
    // quote left it 'approved'. The flip below stays the single
    // atomic predicate UPDATE it always was, so a concurrent
    // conversion still loses the race and reports already-converted
    // without restoring anything it did not flip.
    const priorQuote = await this.db
      .selectFrom('maritime_quotations')
      .select('status')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', quotationId as any)
      .executeTakeFirst();
    const priorStatus = priorQuote?.status ?? null;
    const quote = await this.db
      .updateTable('maritime_quotations')
      .set({ status: 'converted_to_job', updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', quotationId as any)
      .where('status', '!=', 'converted_to_job')
      .returningAll()
      .executeTakeFirst();

    if (!quote) {
      const existing = await this.db
        .selectFrom('maritime_quotations')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', quotationId as any)
        .executeTakeFirst();
      if (!existing) throw new NotFoundException('Quotation not found');
      throw new BadRequestException('تم تحويل عرض السعر هذا إلى أمر تشغيل بالفعل');
    }

    try {
      let rfq: any = null;
      let bid: any = null;
      if (quote.rfq_id) {
        rfq = await this.db
          .selectFrom('maritime_rfqs')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('id', '=', quote.rfq_id as any)
          .executeTakeFirst();
      }
      if (quote.bid_id) {
        bid = await this.db
          .selectFrom('maritime_rfq_bids')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('id', '=', quote.bid_id as any)
          .executeTakeFirst();
      }

      const transportMode = quote.transport_mode || rfq?.transport_mode || 'sea';
      const containerCount = rfq?.container_count || 1;
      const containerType = rfq?.container_type || '40HC';
      const freeDays = bid?.free_days ?? rfq?.target_free_days ?? 14;

      const containersPayload: any[] = [];
      if (transportMode === 'sea') {
        for (let i = 1; i <= containerCount; i++) {
          containersPayload.push({
            containerNumber: `MSKU${Math.floor(1000000 + Math.random() * 9000000)}`,
            containerType,
            freeDays,
            depositAmount: 0,
            depositCurrency: 'EGP',
          });
        }
      }

      return await this.createJob(auth, {
        quotationId: String(quote.id),
        rfqId: quote.rfq_id ? String(quote.rfq_id) : undefined,
        inquiryId: quote.inquiry_id ? String(quote.inquiry_id) : undefined,
        customerId: quote.customer_id,
        customerName: quote.customer_name,
        direction: (rfq?.direction as any) || 'import',
        transportMode: quote.transport_mode || rfq?.transport_mode || 'sea',
        airCargoType: quote.air_cargo_type || rfq?.air_cargo_type || null,
        grossWeightKg: Number(quote.gross_weight_kg || rfq?.gross_weight_kg || 0),
        volumetricWeightKg: Number(quote.volumetric_weight_kg || rfq?.volumetric_weight_kg || 0),
        chargeableWeightKg: Number(quote.chargeable_weight_kg || rfq?.chargeable_weight_kg || 0),
        totalCbm: Number(quote.total_cbm || rfq?.total_cbm || 0),
        packageCount: quote.package_count || rfq?.package_count || 0,
        flightNumber: quote.flight_number || rfq?.flight_number || null,
        flightDate: quote.flight_date || rfq?.flight_date || null,
        mawbNumber: quote.mawb_number || rfq?.mawb_number || null,
        hawbNumber: quote.hawb_number || rfq?.hawb_number || null,
        paymentTerm: quote.payment_term,
        shippingLineId: bid?.shipping_line_id || null,
        shippingLineName: bid?.shipping_line_name || (quote.transport_mode === 'air' ? 'شركة طيران معتمدة' : quote.transport_mode === 'road' ? 'شركة نقل بري معتمدة' : 'خط ملاحي معتمد'),
        polCode: rfq?.pol_code || (quote.transport_mode === 'road' ? 'EGSOC' : quote.transport_mode === 'air' ? 'CAI' : 'CNSHA'),
        polName: rfq?.pol_name || (quote.transport_mode === 'air' ? 'مطار الشحن' : quote.transport_mode === 'road' ? 'الميناء الجاف / موقع الشحن' : 'ميناء الشحن'),
        podCode: rfq?.pod_code || (quote.transport_mode === 'road' ? 'EGTRD' : quote.transport_mode === 'air' ? 'DXB' : 'EGALY'),
        podName: rfq?.pod_name || (quote.transport_mode === 'air' ? 'مطار الوصول' : quote.transport_mode === 'road' ? 'الميناء الجاف / موقع الوصول' : 'ميناء الوصول'),
        bookingNumber: `BKG-${Math.floor(100000 + Math.random() * 900000)}`,
        containers: containersPayload,
        notes: `أمر تشغيل تم تحويله وتفعيله آلياً من عرض السعر ${quote.quotation_number}`,
      });
    } catch (err) {
      // Restore the status captured before the flip -- never a
      // hardcoded value (see INV-MARITIME-AUTOCONVERT-ROLLBACK-STATUS).
      // The flip only happened when priorStatus was read, so a missing
      // row (priorStatus null) restores nothing: the flip already
      // reported not-found / already-converted before the try block.
      if (priorStatus !== null) {
        await this.db
          .updateTable('maritime_quotations')
          .set({ status: priorStatus, updated_at: sql`NOW()` })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', quote.id as any)
          .execute();
      }
      throw err;
    }
  }

  async getJobs(auth: AuthContext, filters?: { status?: string; search?: string; milestone?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status as any);
    }

    if (filters?.milestone && filters.milestone !== 'all') {
      query = query.where('milestone_status', '=', filters.milestone);
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) => eb.or([
        eb('job_number', 'ilike', term),
        eb('customer_name', 'ilike', term),
        eb('booking_number', 'ilike', term),
        eb('mbl_number', 'ilike', term),
        eb('hbl_number', 'ilike', term),
        eb('vessel_name', 'ilike', term)
      ]));
    }

    const jobs = await query.orderBy('id', 'desc').execute();

    // Attach containers count
    const jobIds = jobs.map((j) => String(j.id));
    if (jobIds.length === 0) return [];

    const containers = await this.db
      .selectFrom('maritime_containers')
      .select(['job_id', 'container_number', 'is_overdue'])
      .where('tenant_id', '=', tenantId)
      .where('job_id', 'in', jobIds)
      .execute();

    return jobs.map((job) => {
      const related = containers.filter((c) => c.job_id === String(job.id));
      const hasOverdue = related.some((c) => c.is_overdue);
      return {
        ...job,
        containersCount: related.length,
        hasOverdueContainers: hasOverdue,
      };
    });
  }

  async getJobById(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .executeTakeFirst();

    if (!job) throw new NotFoundException('Shipment Job not found');

    const containers = await this.db
      .selectFrom('maritime_containers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', id)
      .execute();

    const milestones = await this.db
      .selectFrom('maritime_job_milestones')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', id)
      .orderBy('occurred_at', 'asc')
      .execute();

    const insurances = await this.db
      .selectFrom('maritime_cargo_insurances')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', id as any)
      .orderBy('id', 'desc')
      .execute();

    const warehouseReceipts = await this.db
      .selectFrom('maritime_warehouse_receipts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', id as any)
      .orderBy('id', 'desc')
      .execute();

    const truckingTrips = await this.db
      .selectFrom('maritime_inland_trucking_trips')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', id)
      .orderBy('id', 'asc')
      .execute();

    let customerBalance = 0;
    let customerAvailableCredit = 0;
    if (job.customer_id) {
      const cust = await this.db
        .selectFrom('customers')
        .select(['balance'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', job.customer_id as any)
        .executeTakeFirst();
      if (cust) {
        customerBalance = Number(cust.balance || 0);
        customerAvailableCredit = Math.max(0, -customerBalance);
      }
    }

    return {
      ...job,
      customerBalance,
      customerAvailableCredit,
      containers,
      milestones,
      insurances: insurances || [],
      warehouseReceipts: warehouseReceipts || [],
      truckingTrips: truckingTrips || [],
      dcsaDefinitions: DCSA_STANDARD_MILESTONES,
      cargoIqDefinitions: IATA_CARGO_IQ_MILESTONES,
      roadFreightDefinitions: ROAD_FREIGHT_MILESTONES,
    };
  }
}
