import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { NotFoundException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { sql, type Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { DCSA_STANDARD_MILESTONES, ShipmentMilestoneKey, ROAD_FREIGHT_MILESTONES } from './maritime-freight.types';
import { IATA_CARGO_IQ_MILESTONES } from './engines/air-freight.engine';
import { type WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { ReleaseDeliveryOrderDto } from './dto/release-delivery-order.dto';

/**
 * MaritimeFreightJobsMilestonesService — slice S18 of the
 * maritime-freight split. Pure move of 4 methods from
 * MaritimeFreightService (Job Milestones, Delivery Order release,
 * Milestone WhatsApp). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names
 * and signatures. Deps are db + the REQUIRED whatsAppGatewayService +
 * the 4 BOUND CROSS-SLICE deps (S12 assertJobCanClose,
 * assertRoadProofOfDelivery, getJobById; S17 postStoredMoneyAtClose)
 * + the slice's own Logger (S18 is one of the 6 logger slices); no
 * mail/posting/kernel. On the generation tree the facade binds its OWN
 * methods (this.assertJobCanClose.bind(this) etc.) — the S12/S17 slice
 * instances do not exist yet; MERGE-OWNED REPOINTS: when S12/S17 land
 * (they merge before S18), repoint the binds to
 * this.jobsCoreService.<name>.bind(this.jobsCoreService) for the three
 * S12 deps and to this.jobCloseService.postStoredMoneyAtClose.bind(
 * this.jobCloseService) for the S17 dep. Functionally identical either
 * way (the facade methods become thin delegates after S12/S17 merge).
 * No visibility change — all 4 methods are public; all 4 are called
 * from the controller, so all 4 get facade delegates. The
 * releaseDeliveryOrder JSDoc travels with the method (it is part of
 * the method span). No banner travels into this slice. The clock-b4
 * pin travels with addJobMilestone (its tenant-timezone date key call
 * is preserved byte-identical, no UTC-slice normalizer, no instant
 * comparison). The stored-money pin reads addJobMilestone's body for
 * its close-posting call — the body is preserved byte-identical in
 * this file, so the per-slice read works at merge (merge-owned
 * repoint). Clock travels verbatim: 1 bare date construction + 2
 * with-args + 3 now-calls, all pure moves. Guard: no transactions,
 * no posting, no money helpers in the moved text — no PGlite hang
 * shape in S18 (the cross-slice calls sit outside any transaction;
 * there is none).
 */

export interface MaritimeFreightJobsMilestonesDeps {
  db: Kysely<Database>;
  whatsAppGatewayService: WhatsAppGatewayService;
  // Bound cross-slice deps (same names as the facade members, so the
  // moved bodies are byte-identical). assertJobCanClose +
  // assertRoadProofOfDelivery + getJobById live in S12;
  // postStoredMoneyAtClose lives in S17; the facade binds them.
  // Promise<any> throughout (S10/S14 precedent — none of the four has
  // an explicit return type the slice must match, except
  // postStoredMoneyAtClose whose object return flows through unchanged).
  assertJobCanClose: (tenantId: string, jobId: string) => Promise<any>;
  assertRoadProofOfDelivery: (
    tenantId: string,
    jobId: string,
    bookingNumber: string | null | undefined,
  ) => Promise<any>;
  getJobById: (auth: AuthContext, id: string) => Promise<any>;
  postStoredMoneyAtClose: (queryable: any, tenantId: string, jobId: string | number, auth: AuthContext) => Promise<any>;
}

@Injectable()
export class MaritimeFreightJobsMilestonesService {
  private readonly db: Kysely<Database>;
  private readonly whatsAppGatewayService: WhatsAppGatewayService;
  private readonly assertJobCanClose: (tenantId: string, jobId: string) => Promise<any>;
  private readonly assertRoadProofOfDelivery: (
    tenantId: string,
    jobId: string,
    bookingNumber: string | null | undefined,
  ) => Promise<any>;
  private readonly getJobById: (auth: AuthContext, id: string) => Promise<any>;
  private readonly postStoredMoneyAtClose: (
    queryable: any,
    tenantId: string,
    jobId: string | number,
    auth: AuthContext,
  ) => Promise<any>;
  private readonly logger = new Logger(MaritimeFreightJobsMilestonesService.name);

  constructor(deps: MaritimeFreightJobsMilestonesDeps) {
    this.db = deps.db;
    this.whatsAppGatewayService = deps.whatsAppGatewayService;
    this.assertJobCanClose = deps.assertJobCanClose;
    this.assertRoadProofOfDelivery = deps.assertRoadProofOfDelivery;
    this.getJobById = deps.getJobById;
    this.postStoredMoneyAtClose = deps.postStoredMoneyAtClose;
  }

  async addJobMilestone(
    auth: AuthContext,
    jobId: string,
    milestoneKey: ShipmentMilestoneKey,
    notes?: string,
    location?: string,
  ) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.db
      .selectFrom('maritime_jobs')
      .select(['transport_mode', 'milestone_status'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', jobId)
      .executeTakeFirst();
    if (!job) throw new NotFoundException('Shipment Job not found');
    if (job.transport_mode === 'air') {
      const currentIndex = IATA_CARGO_IQ_MILESTONES.findIndex((m) => m.key === job.milestone_status);
      const nextIndex = IATA_CARGO_IQ_MILESTONES.findIndex((m) => m.key === milestoneKey);
      if (nextIndex < 0 || nextIndex !== currentIndex + 1) {
        throw new BadRequestException('لا يمكن تخطي المعالم الإلزامية لمسار الشحن الجوي Cargo iQ');
      }
    }
    if (milestoneKey === 'RETN') await this.assertJobCanClose(tenantId, jobId);
    if (milestoneKey === 'RETN') {
      const containers = await this.db
        .selectFrom('maritime_containers')
        .select(['discharged_at'])
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', jobId)
        .execute();
      if (
        containers.some(
          (container) => !container.discharged_at || new Date(container.discharged_at).getTime() > Date.now(),
        )
      ) {
        throw new BadRequestException('لا يمكن إرجاع الحاويات قبل تسجيل تفريغها');
      }
    }
    if (job.transport_mode === 'road' && milestoneKey === 'TRK_POD') {
      const roadJob = await this.db
        .selectFrom('maritime_jobs')
        .select('booking_number')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', jobId)
        .executeTakeFirst();
      await this.assertRoadProofOfDelivery(tenantId, jobId, roadJob?.booking_number);
    }
    const milestoneDef =
      DCSA_STANDARD_MILESTONES.find((m) => m.key === milestoneKey) ||
      IATA_CARGO_IQ_MILESTONES.find((m) => m.key === milestoneKey) ||
      ROAD_FREIGHT_MILESTONES.find((m) => m.key === milestoneKey);
    const milestoneTitle = milestoneDef ? `${milestoneDef.title_ar} (${milestoneDef.title_en})` : milestoneKey;

    await this.db
      .insertInto('maritime_job_milestones')
      .values({
        tenant_id: tenantId,
        job_id: jobId,
        milestone_key: milestoneKey,
        milestone_title: milestoneTitle,
        location: location || null,
        notes: notes || null,
        recorded_by: auth.userId ? Number(auth.userId) : null,
      })
      .execute();

    // Update job milestone status and automated triggers
    const updatePayload: any = {
      milestone_status: milestoneKey,
      updated_at: sql`NOW()`,
    };

    if (milestoneKey === 'DISC') {
      // 1. Container Discharged at destination port: Start free days clock & calculate deadline
      const containers = await this.db
        .selectFrom('maritime_containers')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', jobId)
        .execute();

      const now = new Date();
      for (const c of containers) {
        if (!c.discharged_at) {
          const freeDays = Number(c.free_days ?? 14);
          const deadline = new Date(now);
          deadline.setDate(deadline.getDate() + freeDays);
          await this.db
            .updateTable('maritime_containers')
            .set({
              discharged_at: now,
              return_deadline: await resolveBusinessDateKey(this.db, tenantId, deadline),
              updated_at: sql`NOW()`,
            })
            .where('id', '=', c.id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
      }
    } else if (milestoneKey === 'GTO') {
      // 2. Gate-out: Release D/O and record container gate-out
      updatePayload.delivery_order_released = true;
      updatePayload.delivery_order_released_at = sql`NOW()`;
      await this.db
        .updateTable('maritime_containers')
        .set({ gated_out_at: sql`NOW()`, updated_at: sql`NOW()` })
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', jobId)
        .where('gated_out_at', 'is', null)
        .execute();
    } else if (milestoneKey === 'DLVR') {
      // 3. Delivered to client premises
      updatePayload.delivered_to_client_at = sql`NOW()`;
    } else if (milestoneKey === 'RETN') {
      // 4. Empty Container Returned: close container & job
      const containers = await this.db
        .selectFrom('maritime_containers')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', jobId)
        .execute();
      updatePayload.status = 'completed';
      for (const container of containers.filter((row) => !row.empty_returned_at)) {
        const deadline = container.return_deadline ? Date.parse(container.return_deadline) : Date.now();
        const overdueDays = Math.max(0, Math.floor((Date.now() - deadline) / 86_400_000));
        await this.db
          .updateTable('maritime_containers')
          .set({
            empty_returned_at: sql`NOW()`,
            deposit_status: ['refunded_to_treasury', 'forfeited'].includes(container.deposit_status)
              ? container.deposit_status
              : Number(container.deposit_amount || 0) > 0
                ? 'pending_return_proof'
                : 'not_required',
            is_overdue: false,
            overdue_days: overdueDays,
            demurrage_amount: overdueDays * Number(container.demurrage_rate_per_day || 0),
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', container.id)
          .execute();
      }
    }

    // INV-MARITIME-STORED-MONEY-POST-AT-CLOSE: the RETN milestone
    // closes the job, so its stored money posts here, BEFORE the
    // status update below -- a failed posting leaves the job open
    // and loud, and the idempotent posting can be recovered by a
    // re-close through updateJob.
    if (milestoneKey === 'RETN') {
      await this.postStoredMoneyAtClose(this.db, tenantId, jobId, auth);
    }

    const [updatedJob] = await this.db
      .updateTable('maritime_jobs')
      .set(updatePayload)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', jobId)
      .returningAll()
      .execute();

    // Automated Proactive WhatsApp Notification on Milestone Change
    try {
      let customerPhone: string | null = null;
      if (updatedJob.customer_id) {
        const cust = await this.db
          .selectFrom('customers')
          .select(['phone'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', updatedJob.customer_id)
          .executeTakeFirst();
        customerPhone = cust?.phone || null;
      }
      if (!customerPhone && (updatedJob as any).customer_phone) {
        customerPhone = (updatedJob as any).customer_phone;
      }

      if (customerPhone) {
        const msgData = await this.getMilestoneWhatsAppMessage(auth, jobId, milestoneKey);
        await this.whatsAppGatewayService.sendRawMessage(tenantId, customerPhone, msgData.message);
        this.logger.log(`Auto-sent WhatsApp milestone update to ${customerPhone} for job ${updatedJob.job_number}`);
      }
    } catch (err: any) {
      this.logger.debug(`Could not auto-send milestone WhatsApp for job ${jobId}: ${err?.message}`);
    }

    return updatedJob;
  }

  /**
   * INV-MARITIME-DELIVERY-ORDER-RELEASE-GATES: releasing a delivery
   * order runs two tiers. PAYMENT is a strict precondition (money
   * tier): when the job has been invoiced, the client must have
   * paid within the same 0.01 full-payment band settle uses, or the
   * release is rejected before any milestone is written; an
   * uninvoiced job has nothing due and releases freely. DOCUMENTS
   * only warn (workflow tier, spirit of the law): a sea job with
   * no cleared customs declaration, or a caller-flagged incomplete
   * set on any mode, still releases -- but the warning and its
   * reason are recorded in the milestone notes and returned, so
   * the gap is visible instead of silently waived. A caller flag
   * can never mark documents complete: the customs check is
   * derived from the stored declarations, never trusted from the
   * request. Air/road keep their existing milestone checks.
   */
  async releaseDeliveryOrder(auth: AuthContext, jobId: string, dto?: ReleaseDeliveryOrderDto) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.getJobById(auth, jobId);
    const invoiced = Number(job?.client_invoiced_total || 0);
    const paid = Number(job?.client_paid_total || 0);
    if (invoiced > 0 && paid < invoiced - 0.01) {
      throw new BadRequestException(
        `لا يمكن إصدار إذن التسليم قبل اكتمال السداد: إجمالي الفواتير ${invoiced} والمسدد ${paid}.`,
      );
    }
    const isAir = job?.transport_mode === 'air';
    const isRoad = job?.transport_mode === 'road';
    const isSea = !isAir && !isRoad;
    let documentsWarning: string | null = null;
    if (isSea) {
      const cleared = await this.db
        .selectFrom('maritime_customs_declarations')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', jobId)
        .where('status', '=', 'cleared')
        .executeTakeFirst();
      if (!cleared) {
        documentsWarning = 'لا يوجد بيان جمركي مُخَلَّص (cleared) لهذه الشحنة';
      }
    }
    if (dto?.documentsComplete === false) {
      documentsWarning = 'أبلغ الموظف أن المستندات غير مكتملة';
    }
    if (documentsWarning && dto?.documentReason?.trim()) {
      documentsWarning = dto.documentReason.trim();
    }
    const milestoneKey = isAir ? 'AWD' : isRoad ? 'TRK_POD' : 'GTO';
    const milestoneTitle = isAir
      ? 'تم اعتماد وإصدار إذن التسليم الجوي وبوليصة الشحن (Air Cargo Delivery Order) للعميل'
      : isRoad
        ? 'توقيع بوليصة الشحن البري وتأكيد استلام وتسليم البضاعة (Signed Waybill / POD)'
        : 'تم اعتماد وإصدار إذن التسليم الملاحي الرسمي (Delivery Order D/O) للعميل';
    const notes = documentsWarning ? `${milestoneTitle}\nتنبيه مستندات: ${documentsWarning}` : milestoneTitle;
    const released = await this.addJobMilestone(auth, jobId, milestoneKey, notes);
    return { ...released, paymentVerified: true, documentsWarning };
  }

  async sendMilestoneWhatsApp(
    auth: AuthContext,
    jobId: string,
    milestoneKey: ShipmentMilestoneKey,
    targetPhone?: string,
  ) {
    const { tenantId } = requireTenantScope(auth);
    const msgData = await this.getMilestoneWhatsAppMessage(auth, jobId, milestoneKey);
    let phone = targetPhone || msgData.customerPhone;

    if (!phone) {
      const job = await this.getJobById(auth, jobId);
      if (job.customer_id) {
        const cust = await this.db
          .selectFrom('customers')
          .select(['phone'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', job.customer_id)
          .executeTakeFirst();
        phone = cust?.phone || null;
      }
    }

    if (!phone) {
      return { success: false, message: 'لا يوجد رقم هاتف مسجل للعميل' };
    }

    const res = await this.whatsAppGatewayService.sendRawMessage(tenantId, phone, msgData.message);
    return res;
  }

  async getMilestoneWhatsAppMessage(auth: AuthContext, jobId: string, milestoneKey: ShipmentMilestoneKey) {
    const job = await this.getJobById(auth, jobId);
    const trackingUrl = job.tracking_token
      ? `${process.env.APP_PUBLIC_URL || 'https://app.zsystemai.com'}/public/track/${job.tracking_token}`
      : '';

    const milestoneDef =
      DCSA_STANDARD_MILESTONES.find((m) => m.key === milestoneKey) ||
      IATA_CARGO_IQ_MILESTONES.find((m) => m.key === milestoneKey) ||
      ROAD_FREIGHT_MILESTONES.find((m) => m.key === milestoneKey);
    const title = milestoneDef ? milestoneDef.title_ar : milestoneKey;

    let actionContext = '';
    switch (milestoneKey) {
      case 'BOOK':
      case 'BKD':
      case 'TRK_ASSIGN':
        actionContext =
          job.transport_mode === 'road'
            ? `تم تأكيد حجز النقل البري وتعيين الشاحنة والسائق بنجاح برقم: ${job.booking_number || job.job_number}`
            : `تم تأكيد حجز الشحنة بنجاح برقم الحجز: ${job.booking_number || job.mawb_number || job.job_number}`;
        break;
      case 'GTI':
        actionContext = `وصلت الحاوية ودخلت ساحة ميناء الشحن (${job.pol_name}) بانتظار التحميل على السفينة.`;
        break;
      case 'TRK_GATE_IN':
        actionContext = `وصلت الشاحنة إلى موقع التحميل (${job.pol_name}) وبدأت إجراءات الدخول والوزن.`;
        break;
      case 'RCS':
        actionContext = `تم استلام الشحنة بمستودع قرية البضائع بمطار الشحن (${job.pol_name}) والتحقق من الأوزان والأبعاد.`;
        break;
      case 'LOAD':
        actionContext = `تم تحميل وشحن الحاوية على متن السفينة (${job.vessel_name || 'السفينة المحددة'}) وجاري التجهيز للإبحار.`;
        break;
      case 'TRK_LOADED':
        actionContext = `تم إتمام تحميل وتربيط البضاعة بالشاحنة ووزن الحمولة بنجاح وجاهزة للتحرك.`;
        break;
      case 'MAN':
        actionContext = `تم إدراج الشحنة على مانيفست رحلة الطيران المجدولة بنجاح.`;
        break;
      case 'DEPT':
      case 'DEP':
      case 'TRK_DISPATCH':
        actionContext =
          job.transport_mode === 'air'
            ? `أقلعت رحلة الشحن الجوي (${job.flight_number || 'الرحلة المجدولة'}) من مطار ${job.pol_name} متجهة إلى ${job.pod_name}. موعد الوصول المتوقع (ETA): ${job.eta || 'قيد المتابعة'}.`
            : job.transport_mode === 'road'
              ? `انطلقت الشاحنة رسمياً على مسار الرحلة متجهة إلى ${job.pod_name}. موعد الوصول المتوقع (ETA): ${job.eta || 'قيد المتابعة'}.`
              : `أبحرت السفينة رسمياً من ${job.pol_name} متجهة إلى ${job.pod_name}. موعد الوصول المتوقع (ETA): ${job.eta || 'قيد المتابعة'}.`;
        break;
      case 'ARRI':
      case 'ARR':
      case 'TRK_ARRIVED':
        actionContext =
          job.transport_mode === 'air'
            ? `هبطت طائرة الشحن الجوي بحمد الله في مطار المقصد (${job.pod_name}) وجاري تفريغ الشحنة إلى قرية البضائع.`
            : job.transport_mode === 'road'
              ? `وصلت الشاحنة بحمد الله إلى موقع المقصد (${job.pod_name}) بانتظار بدء إجراءات التفريغ.`
              : `وصلت السفينة بحمد الله إلى ميناء المقصد (${job.pod_name}) وجاري ربط السفينة وبدء عمليات التفريغ.`;
        break;
      case 'DISC':
        actionContext = `تم تفريغ الحاوية على رصيف ميناء ${job.pod_name} وبدأ سريان فترة السماح (Free Days). جاري بدء إجراءات التخليص الجمركي.`;
        break;
      case 'TRK_BORDER':
        actionContext = `وصلت الشاحنة إلى المنفذ البري / المعبر الجمركي وجاري فحص وتخليص البضاعة العابرة للحدود.`;
        break;
      case 'RCF':
        actionContext = `تم تفريغ ودخول الشحنة لمستودع قرية البضائع بمطار ${job.pod_name} وجاهزة لإجراءات المعاينة والتخليص.`;
        break;
      case 'CUST':
        actionContext = `تم إنهاء كافة إجراءات الإفراج والمطابقة الجمركية للشحنة بنجاح.`;
        break;
      case 'NFD':
        actionContext = `تم إشعار العميل المستلم بوصول الشحنة لمطار المقصد وجاري التنسيق للتسليم النهائي.`;
        break;
      case 'GTO':
      case 'AWD':
        actionContext =
          job.transport_mode === 'air'
            ? `تم إصدار إذن التسليم الجوي وبوليصة الشحن (Delivery Order D/O) وتجهيز الشحنة للاستلام.`
            : `تم إصدار إذن التسليم الملاحي (Delivery Order D/O) وخروج الحاوية من بوابة الميناء في طريقها للعنوان المحدد.`;
        break;
      case 'TRK_UNLOADED':
        actionContext = `تم تفريغ البضاعة ومطابقة الطرود والكميات بمستودع المستلم.`;
        break;
      case 'DLVR':
      case 'DLV':
      case 'TRK_POD':
        actionContext = `تم تسليم البضاعة كاملة وتوقيع إشعار / بوليصة الاستلام بنجاح (Proof of Delivery). نشكركم على ثقتكم في خدماتنا اللوجستية!`;
        break;
      case 'RETN':
        actionContext = `تم إرجاع الحاوية الفارغة لساحة التوكيل الملاحي بنجاح وجاري استرداد مبالغ التأمين للخزينة.`;
        break;
    }

    const modeName = job.transport_mode === 'air' ? 'الجوية' : job.transport_mode === 'road' ? 'البرية' : 'الملاحية';
    const message =
      `عزيزنا العميل ${job.customer_name}،\n` +
      `تحديث جديد بخصوص شحنتكم ${modeName} [${job.job_number}]:\n` +
      `المرحلة الحالية: ${title}\n` +
      `${actionContext}\n\n` +
      `يمكنكم متابعة معالم الشحنة المجدولة عبر رابط التتبع (الأحداث تقديرية وليست قراءة مباشرة من الناقل):\n` +
      `${trackingUrl}\n\n` +
      `فريق العمليات واللوجستيات — Z-Systems`;

    return {
      jobId: job.id,
      jobNumber: job.job_number,
      customerName: job.customer_name,
      customerPhone: job.customer_phone || null,
      milestoneKey,
      milestoneTitle: title,
      message,
    };
  }
}
