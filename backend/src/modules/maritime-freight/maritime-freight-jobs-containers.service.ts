import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { resolveFxRate } from '../accounting/fx-rate-resolution';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { convertFxAmount } from '../accounting/engines/fx-conversion.engine';
import { currencyMoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { NotFoundException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { sql, type Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { UpdateMaritimeContainerDto } from './dto/update-container.dto';
import { formatLocalCalendarDay } from '../../common/utils/tenant-timezone.util';

/**
 * MaritimeFreightJobsContainersService — slice S13 of the maritime-freight split.
 * Pure move of 4 methods from MaritimeFreightService (Containers &
 * Demurrage Radar). No behavior change: the bodies are byte-identical;
 * the facade keeps thin delegates with the same names and signatures.
 * Deps are db + the BOUND CROSS-SLICE dep (S12 postContainerDepositJournal)
 * + the slice's own Logger (S13 is one of the 6 logger slices); no
 * mail/WhatsApp/posting/kernel. On the generation tree the facade binds
 * its OWN postContainerDepositJournal method
 * (this.postContainerDepositJournal.bind(this)) — the S12 slice instance
 * does not exist yet; MERGE-OWNED REPOINT: when S12 lands (it merges
 * before S13), repoint the bind to
 * this.jobsCoreService.postContainerDepositJournal.bind(
 * this.jobsCoreService). Functionally identical either way (the facade
 * method becomes a thin delegate after S12 merges). No visibility change
 * — all 4 methods are public. The demurrage scan method carries its
 * JSDoc into the slice; the pin range (scan method through updateContainer)
 * is preserved in this file — no spec repoint travels in this patch,
 * merge-owned. Clock travels verbatim: 3 bare new Date() + 11 with-args
 * new Date() (updateContainer alone has 11) + 1 toISOString() +
 * resolveBusinessDateKey x4 + the clock-b5 §C pattern in updateContainer —
 * pure moves, no UTC-slice normalizer, no instant comparison. Guard:
 * currencyMoneyDigits x1 + the shared-resolver FX call x1 in the moved
 * text; 2 transactions (updateContainer + createContainer), both calling
 * the bound deposit-journal dep inside the open tx — the PGlite hang
 * shape here is TRANSITIVE (via the dep's own account resolution), file-
 * level fix debt, NOT part of the split. The Containers banner travels
 * byte-identical into the slice (file #8 S9 precedent); banner 8 Public
 * Tracking stays in the facade (it precedes getPublicTrackingByToken, S9).
 */

export interface MaritimeFreightJobsContainersDeps {
  db: Kysely<Database>;
  // Bound cross-slice dep (same name as the facade member, so the moved
  // bodies are byte-identical). postContainerDepositJournal lives in S12;
  // the facade binds it. Return type is Promise<any> (the callers never
  // use the return value; the S12 method posts a journal or throws).
  postContainerDepositJournal: (
    trx: any,
    tenantId: string,
    containerId: string,
    amount: number,
    currency: string,
    event: 'open' | 'refund' | 'forfeit',
    userId: number,
  ) => Promise<any>;
}

@Injectable()
export class MaritimeFreightJobsContainersService {
  private readonly db: Kysely<Database>;
  private readonly postContainerDepositJournal: (
    trx: any,
    tenantId: string,
    containerId: string,
    amount: number,
    currency: string,
    event: 'open' | 'refund' | 'forfeit',
    userId: number,
  ) => Promise<any>;
  private readonly logger = new Logger(MaritimeFreightJobsContainersService.name);

  constructor(deps: MaritimeFreightJobsContainersDeps) {
    this.db = deps.db;
    this.postContainerDepositJournal = deps.postContainerDepositJournal;
  }

  // --------------------------------------------------------------------------
  // 7. Containers & Demurrage Radar
  // --------------------------------------------------------------------------
  async getContainers(
    auth: AuthContext,
    filters?: { overdueOnly?: boolean; depositHeldOnly?: boolean; search?: string },
  ) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db
      .selectFrom('maritime_containers as c')
      .innerJoin('maritime_jobs as j', 'j.id', 'c.job_id')
      .select([
        'c.id',
        'c.job_id',
        'c.container_number',
        'c.container_type',
        'c.seal_number',
        'c.free_days',
        'c.return_deadline',
        'c.is_overdue',
        'c.overdue_days',
        'c.demurrage_amount',
        'c.deposit_amount',
        'c.deposit_currency',
        'c.deposit_status',
        'c.empty_returned_at',
        'c.discharged_at',
        'c.gated_out_at',
        'j.job_number',
        'j.customer_name',
        'j.shipping_line_name',
        'j.vessel_name',
        'j.delivery_order_released',
      ])
      .where('c.tenant_id', '=', tenantId);

    if (filters?.overdueOnly) {
      query = query.where('c.is_overdue', '=', true);
    }

    if (filters?.depositHeldOnly) {
      query = query.where('c.deposit_status', '=', 'held_by_line');
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('c.container_number', 'ilike', term),
          eb('j.job_number', 'ilike', term),
          eb('j.customer_name', 'ilike', term),
        ]),
      );
    }

    const rows = await query.orderBy('c.id', 'desc').execute();

    // Recalculate dynamic days remaining / countdown
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return rows.map((row) => {
      let daysRemaining: number | null = null;
      let statusColor: 'green' | 'yellow' | 'red' | 'gray' = 'green';

      if (row.empty_returned_at) {
        statusColor = 'gray'; // Completed
      } else if (row.return_deadline) {
        const deadline = new Date(row.return_deadline);
        deadline.setHours(0, 0, 0, 0);
        const diffTime = deadline.getTime() - today.getTime();
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (daysRemaining < 0) {
          statusColor = 'red'; // Overdue
        } else if (daysRemaining <= 3) {
          statusColor = 'yellow'; // Critical warning
        } else {
          statusColor = 'green'; // Safe
        }
      }

      return {
        ...row,
        daysRemaining,
        statusColor,
      };
    });
  }

  /**
   * INV-MARITIME-DEMURRAGE-AUTO-PLUS-MANUAL: the demurrage
   * scan creates ONE auto DEM charge per overdue container
   * at the live shared-resolver rate, and staff may also
   * enter demurrage manually -- both coexist, never
   * double-charging the same container. The container rate
   * is USD/day (the import module treats the same column as
   * ratePerDayUsd, and the column carries no currency); the
   * charge is converted to the tenant base currency at book
   * digits through the shared resolver, failing closed (no
   * charge, exposure amount still updated by the scan) when
   * no live USD rate is registered. A DEM/DETENTION charge
   * whose name already carries this container number
   * suppresses creation: a manual row stands untouched, an
   * invoiced auto row stays frozen, and an uninvoiced auto
   * row is re-derived to the new converted amount as
   * overdue days grow. Completed jobs get no charge. A
   * zero/unset rate creates no charge and invents no rate.
   * Staff override path: delete the uninvoiced auto row in
   * the charge grid and add a manual DEM row naming the
   * container -- the next scan then leaves it alone.
   */
  async syncDemurrageChargeForContainer(
    tenantId: string,
    jobId: string | number,
    containerNumber: string,
    amountUsd: number,
  ): Promise<'created' | 'updated' | 'skipped'> {
    const jobIdStr = String(jobId);
    const numberKey = String(containerNumber || '')
      .trim()
      .toUpperCase();
    if (!(amountUsd > 0) || !numberKey) return 'skipped';
    const job = await this.db
      .selectFrom('maritime_jobs')
      .select(['status'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', jobIdStr)
      .executeTakeFirst();
    if (!job || job.status === 'completed') return 'skipped';

    const baseCurrency = await tenantBaseCurrency(this.db, tenantId);
    let rate: number;
    try {
      rate = await resolveFxRate(this.db, tenantId, 'USD');
    } catch (err: any) {
      this.logger.warn(
        `Demurrage auto-charge skipped for container ${containerNumber} (job ${jobIdStr}): no live USD rate -- ${err?.message}`,
      );
      return 'skipped';
    }
    const converted = convertFxAmount(amountUsd, rate, currencyMoneyDigits(baseCurrency));

    const existing = await this.db
      .selectFrom('maritime_job_charges')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', jobIdStr)
      .execute();
    const match = existing.find((row) => {
      const names = `${row.charge_name_en || ''} ${row.charge_name_ar || ''}`.toUpperCase();
      return /DEM|DETENTION/i.test(`${row.charge_code || ''} ${names}`) && names.includes(numberKey);
    });
    if (match) {
      const isAutoRow = String(match.charge_name_en || '').startsWith('Demurrage (auto)');
      if (isAutoRow && !match.is_invoiced) {
        await this.db
          .updateTable('maritime_job_charges')
          .set({
            currency: baseCurrency,
            cost_amount: converted,
            sell_amount: converted,
            profit_amount: 0,
            tax_rate_percent: 0,
            tax_amount: 0,
          })
          .where('tenant_id', '=', tenantId)
          .where('job_id', '=', jobIdStr)
          .where('id', '=', String(match.id))
          .execute();
        return 'updated';
      }
      return 'skipped';
    }

    await this.db
      .insertInto('maritime_job_charges')
      .values({
        tenant_id: tenantId,
        job_id: jobIdStr,
        charge_code: 'DEM',
        charge_name_ar: `غرامة تأخير تلقائية — ${containerNumber}`,
        charge_name_en: `Demurrage (auto) — ${containerNumber}`,
        currency: baseCurrency,
        cost_amount: converted,
        sell_amount: converted,
        profit_amount: 0,
        is_local_charge: false,
        tax_rate_percent: 0,
        tax_amount: 0,
        is_invoiced: false,
      })
      .execute();
    return 'created';
  }

  async updateContainer(auth: AuthContext, containerId: string, dto: UpdateMaritimeContainerDto) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      const container = await trx
        .selectFrom('maritime_containers')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', containerId as any)
        .forUpdate()
        .executeTakeFirst();

      if (!container) throw new NotFoundException('Container not found');
      const dischargedAtValue = dto.dischargedAt !== undefined ? dto.dischargedAt : container.discharged_at;
      const returnedAtValue = dto.emptyReturnedAt !== undefined ? dto.emptyReturnedAt : container.empty_returned_at;
      if (
        [dischargedAtValue, returnedAtValue].some(
          (value) => value && !Number.isFinite(new Date(String(value)).getTime()),
        )
      ) {
        throw new BadRequestException('تاريخ تفريغ أو إرجاع الحاوية غير صالح');
      }
      if (
        dischargedAtValue &&
        returnedAtValue &&
        new Date(String(returnedAtValue)).getTime() < new Date(String(dischargedAtValue)).getTime()
      ) {
        throw new BadRequestException('تاريخ إرجاع الحاوية لا يمكن أن يسبق تاريخ التفريغ');
      }
      if (dto.depositAmount !== undefined && Number(dto.depositAmount) !== Number(container.deposit_amount)) {
        throw new BadRequestException('لا يمكن تغيير مبلغ تأمين سبق قيده محاسبياً');
      }
      if (dto.depositCurrency !== undefined && dto.depositCurrency !== container.deposit_currency) {
        throw new BadRequestException('لا يمكن تغيير عملة تأمين سبق قيده محاسبياً');
      }
      if (dto.depositStatus === 'not_required' && Number(container.deposit_amount) > 0) {
        throw new BadRequestException('لا يمكن إلغاء تأمين حاوية له مبلغ وقيد محاسبي');
      }
      const terminalDepositStatus = String(dto.depositStatus || '');
      if (['refunded_to_treasury', 'forfeited'].includes(terminalDepositStatus)) {
        if (['refunded_to_treasury', 'forfeited'].includes(container.deposit_status)) {
          if (container.deposit_status !== terminalDepositStatus)
            throw new BadRequestException('تمت تسوية تأمين الحاوية مسبقاً');
        } else {
          await this.postContainerDepositJournal(
            trx,
            tenantId,
            containerId,
            Number(container.deposit_amount),
            container.deposit_currency,
            terminalDepositStatus === 'forfeited' ? 'forfeit' : 'refund',
            auth.userId,
          );
        }
      } else if (
        ['refunded_to_treasury', 'forfeited'].includes(container.deposit_status) &&
        dto.depositStatus !== undefined &&
        dto.depositStatus !== container.deposit_status
      ) {
        throw new BadRequestException('لا يمكن إعادة فتح تأمين تمت تسويته محاسبياً');
      }

      if (dto.freeDays !== undefined && (!Number.isInteger(dto.freeDays) || dto.freeDays < 0)) {
        throw new BadRequestException('فترة السماح يجب أن تكون عدداً صحيحاً غير سالب');
      }
      if (
        dto.demurrageRatePerDay !== undefined &&
        (!Number.isFinite(dto.demurrageRatePerDay) || dto.demurrageRatePerDay < 0)
      ) {
        throw new BadRequestException('الغرامة اليومية يجب أن تكون غير سالبة');
      }

      const updatePayload: any = {
        updated_at: sql`NOW()`,
      };

      if (dto.sealNumber !== undefined) updatePayload.seal_number = dto.sealNumber;
      if (dto.gatedInAt !== undefined) updatePayload.gated_in_at = dto.gatedInAt ? new Date(dto.gatedInAt) : null;
      if (dto.vesselLoadedAt !== undefined)
        updatePayload.vessel_loaded_at = dto.vesselLoadedAt ? new Date(dto.vesselLoadedAt) : null;
      if (dto.dischargedAt !== undefined)
        updatePayload.discharged_at = dto.dischargedAt ? new Date(dto.dischargedAt) : null;
      if (dto.gatedOutAt !== undefined) updatePayload.gated_out_at = dto.gatedOutAt ? new Date(dto.gatedOutAt) : null;
      if (dto.emptyReturnedAt !== undefined)
        updatePayload.empty_returned_at = dto.emptyReturnedAt ? new Date(dto.emptyReturnedAt) : null;
      if (dto.freeDays !== undefined) updatePayload.free_days = dto.freeDays;
      if (dto.demurrageRatePerDay !== undefined) updatePayload.demurrage_rate_per_day = dto.demurrageRatePerDay;
      if (dto.depositAmount !== undefined) updatePayload.deposit_amount = dto.depositAmount;
      if (dto.depositCurrency !== undefined) updatePayload.deposit_currency = dto.depositCurrency;
      if (dto.depositStatus !== undefined) updatePayload.deposit_status = dto.depositStatus;
      if (dto.emptyReturnProofUrl !== undefined) updatePayload.empty_return_proof_url = dto.emptyReturnProofUrl;
      if (dto.notes !== undefined) updatePayload.notes = dto.notes;

      // An explicit return date takes precedence; otherwise free time starts at discharge.
      const dischargedAt = dto.dischargedAt !== undefined ? dto.dischargedAt : container.discharged_at;
      let deadlineDate = dto.returnDeadline !== undefined ? dto.returnDeadline : container.return_deadline;
      if (
        dto.returnDeadline === undefined &&
        dischargedAt &&
        (dto.dischargedAt !== undefined || dto.freeDays !== undefined || !deadlineDate)
      ) {
        // Free time starts at the tenant-local discharge day, not its UTC day.
        const dischargeDay = await resolveBusinessDateKey(trx, tenantId, dischargedAt);
        const baseDate = new Date(`${dischargeDay}T00:00:00.000Z`);
        baseDate.setUTCDate(baseDate.getUTCDate() + Number(dto.freeDays ?? container.free_days ?? 14));
        deadlineDate = baseDate.toISOString().slice(0, 10);
      }
      if (dto.returnDeadline !== undefined || deadlineDate !== container.return_deadline) {
        updatePayload.return_deadline = deadlineDate || null;
      }
      if (deadlineDate) {
        const returnedAt = dto.emptyReturnedAt !== undefined ? dto.emptyReturnedAt : container.empty_returned_at;
        const endDay = await resolveBusinessDateKey(trx, tenantId, returnedAt ? new Date(returnedAt) : new Date());
        // database.types says string, but pg delivers a DATE column as a
        // host-local-midnight Date at runtime; key whichever shape
        // actually arrives from host-local calendar parts.
        const deadlineDay =
          (deadlineDate as unknown) instanceof Date
            ? formatLocalCalendarDay(deadlineDate as unknown as Date)
            : String(deadlineDate).slice(0, 10);
        const overdueDays = Math.max(0, Math.round((Date.parse(endDay) - Date.parse(deadlineDay)) / 86_400_000));
        updatePayload.is_overdue = !returnedAt && overdueDays > 0;
        updatePayload.overdue_days = overdueDays;
        updatePayload.demurrage_amount =
          overdueDays * Number(dto.demurrageRatePerDay ?? container.demurrage_rate_per_day ?? 0);
      } else {
        updatePayload.is_overdue = false;
        updatePayload.overdue_days = 0;
        updatePayload.demurrage_amount = 0;
      }

      const originalDemurrage = Math.max(
        Number(container.demurrage_amount || 0),
        Number(updatePayload.overdue_days || 0) * Number(container.demurrage_rate_per_day || 0),
      );
      if (Number(updatePayload.demurrage_amount || 0) > Number(container.demurrage_amount || 0) + 0.01) {
        const job = await trx
          .selectFrom('maritime_jobs')
          .select('status')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', container.job_id as any)
          .executeTakeFirst();
        if (job?.status === 'completed') {
          throw new BadRequestException('أعد فتح الشحنة وفوتر غرامة التأخير الجديدة قبل تعديل الحاوية');
        }
      }
      if (originalDemurrage > Number(updatePayload.demurrage_amount || 0) + 0.01) {
        const reason = (dto.notes || '').trim();
        if (
          !['admin', 'super_admin', 'finance_manager'].includes(auth.role.toLowerCase()) ||
          !reason ||
          reason === (container.notes || '').trim()
        ) {
          throw new BadRequestException('خفض غرامة التأخير يتطلب اعتماد مدير مالي وسبباً موثقاً');
        }
        updatePayload.notes = `${container.notes || ''}\nاعتماد خفض الغرامة من ${originalDemurrage} إلى ${updatePayload.demurrage_amount}: ${reason} (مستخدم ${auth.userId})`;
      }

      const [updated] = await trx
        .updateTable('maritime_containers')
        .set(updatePayload)
        .where('tenant_id', '=', tenantId)
        .where('id', '=', containerId as any)
        .returningAll()
        .execute();

      return updated;
    });
  }

  async createContainer(auth: AuthContext, dto: any) {
    const { tenantId } = requireTenantScope(auth);
    const containerNumber = String(dto.containerNumber || '')
      .trim()
      .toUpperCase();
    if (!containerNumber) throw new BadRequestException('رقم الحاوية مطلوب');

    const freeDays = Number(dto.freeDays ?? 14);
    const demurrageRate = Number(dto.demurrageRatePerDay ?? 0);
    if (!Number.isInteger(freeDays) || freeDays < 0 || !Number.isFinite(demurrageRate) || demurrageRate < 0) {
      throw new BadRequestException('فترة السماح أو الغرامة اليومية غير صالحة');
    }
    const deadlineDate = dto.returnDeadline
      ? await resolveBusinessDateKey(this.db, tenantId, dto.returnDeadline)
      : null;
    // Overdue days count from the tenant-local today, not the UTC day.
    const todayKey = await resolveBusinessDateKey(this.db, tenantId, new Date());
    const overdueDays = deadlineDate
      ? Math.max(0, Math.round((Date.parse(todayKey) - Date.parse(deadlineDate)) / 86_400_000))
      : 0;

    let depositStatus: 'not_required' | 'held_by_line' = 'not_required';
    if (dto.depositAmount && Number(dto.depositAmount) > 0) {
      depositStatus = 'held_by_line';
    }

    const inserted = await this.db.transaction().execute(async (trx) => {
      const job = await trx
        .selectFrom('maritime_jobs')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(dto.jobId) as any)
        .forUpdate()
        .executeTakeFirst();
      if (!job) throw new NotFoundException('Shipment Job not found');
      const duplicate = await trx
        .selectFrom('maritime_containers')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', String(dto.jobId))
        .where(sql<string>`UPPER(TRIM(container_number))`, '=', containerNumber)
        .executeTakeFirst();
      if (duplicate) throw new BadRequestException('رقم الحاوية موجود مسبقاً في أمر الشحن');
      const [container] = await trx
        .insertInto('maritime_containers')
        .values({
          tenant_id: tenantId,
          job_id: dto.jobId,
          container_number: containerNumber,
          container_type: dto.containerType || "40' HC",
          seal_number: dto.sealNumber || null,
          gross_weight_kg: Number(dto.grossWeightKg) || 0,
          cbm: Number(dto.cbm) || 0,
          free_days: freeDays,
          return_deadline: deadlineDate,
          is_overdue: overdueDays > 0,
          overdue_days: overdueDays,
          demurrage_rate_per_day: demurrageRate,
          demurrage_amount: overdueDays * demurrageRate,
          deposit_amount: Number(dto.depositAmount) || 0,
          deposit_currency: dto.depositCurrency || 'USD',
          deposit_status: depositStatus,
          notes: dto.notes || null,
        })
        .returningAll()
        .execute();
      if (Number(dto.depositAmount || 0) > 0) {
        await this.postContainerDepositJournal(
          trx,
          tenantId,
          String(container.id),
          Number(dto.depositAmount),
          dto.depositCurrency || 'USD',
          'open',
          auth.userId,
        );
      }
      return container;
    });

    return inserted;
  }
}
