import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { KYSELY_DB } from '../../database/database.constants';
import { InMemoryRateLimitService } from '../../common/security/in-memory-rate-limit.service';
import { TrialTenantProvisioningService } from '../saas-admin/trial-tenant-provisioning.service';
import { DEFAULT_TRIAL_DAYS } from '../saas-admin/trial.constants';
import { PublicTrialSignupDto } from './dto/public-trial-signup.dto';
import { TrialSignupMailService } from './trial-signup-mail.service';

@Injectable()
export class PublicTrialSignupService {
  private readonly logger = new Logger(PublicTrialSignupService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly rateLimit: InMemoryRateLimitService,
    private readonly provisioning: TrialTenantProvisioningService,
    private readonly mail: TrialSignupMailService,
  ) {}

  private normalizeEmail(value: unknown): string {
    return String(value || '').trim().toLowerCase();
  }

  private normalizePhone(value: unknown): string {
    return this.provisioning.normalizePhoneDigits(value);
  }

  private maskEmail(value: string): string {
    const email = String(value || '').trim().toLowerCase();
    const [localRaw, domainRaw] = email.split('@');
    const local = localRaw || '';
    const domain = domainRaw || '';
    if (!local || !domain) return '***';
    return `${local.slice(0, 2)}***@${domain}`;
  }

  private maskPhone(value: string): string {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '***';
    return `${'*'.repeat(Math.max(8, digits.length - 3))}${digits.slice(-3)}`;
  }

  private sanitizeError(error: unknown): Record<string, unknown> {
    const candidate = (error ?? {}) as Record<string, unknown>;
    return {
      name: typeof candidate.name === 'string' ? candidate.name : 'Error',
      message: typeof candidate.message === 'string' ? candidate.message : 'Unknown error',
      code: typeof candidate.code === 'string' ? candidate.code : undefined,
      constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      table: typeof candidate.table === 'string' ? candidate.table : undefined,
      column: typeof candidate.column === 'string' ? candidate.column : undefined,
    };
  }

  private async guardRateLimit(ip: string, email: string, phone: string): Promise<void> {
    const checks = [
      this.rateLimit.hit(`trial-signup:ip:${ip}`, 10, 3600),
      this.rateLimit.hit(`trial-signup:email:${email}`, 5, 3600),
      this.rateLimit.hit(`trial-signup:phone:${phone}`, 5, 3600),
    ];
    const results = await Promise.all(checks);
    if (results.some((entry) => !entry.allowed)) {
      throw new HttpException('تم تجاوز عدد المحاولات المسموح به. حاول مرة أخرى لاحقًا.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async assertNotDuplicateRecent(email: string, phone: string): Promise<void> {
    const existingTenant = await this.db
      .selectFrom('tenants')
      .select(['id'])
      .where((eb) => eb.or([
        eb(sql<string>`LOWER(COALESCE(owner_email, ''))`, '=', email),
        eb('owner_phone', '=', phone),
      ]))
      .executeTakeFirst();

    if (existingTenant) {
      throw new BadRequestException('يوجد طلب سابق بنفس البريد أو رقم الهاتف. تواصل مع الدعم إذا احتجت المساعدة.');
    }

    const existingRecentSignup = await this.db
      .selectFrom('trial_signups as ts')
      .innerJoin('tenants as t', 't.id', 'ts.tenant_id')
      .select(['ts.id'])
      .where('ts.created_at', '>=', sql<Date>`now() - interval '30 days'`)
      .where((eb) => eb.or([
        eb(sql<string>`LOWER(COALESCE(t.owner_email, ''))`, '=', email),
        eb('t.owner_phone', '=', phone),
      ]))
      .executeTakeFirst();

    if (existingRecentSignup) {
      throw new BadRequestException('يوجد طلب تجربة سابق لنفس البيانات. راجع بريدك الإلكتروني أو تواصل مع الدعم.');
    }
  }

  private shouldRequireMailDelivery(): boolean {
    const mode = String(process.env.MAIL_DELIVERY_MODE || '').trim().toLowerCase();
    const isProduction = String(process.env.NODE_ENV || '').trim() === 'production';
    return isProduction || mode === 'smtp';
  }

  async signup(payload: PublicTrialSignupDto, ip: string): Promise<Record<string, unknown>> {
    let phase = 'start';

    if (String(payload.honeypot || '').trim()) {
      throw new BadRequestException('تعذر تنفيذ الطلب.');
    }

    const email = this.normalizeEmail(payload.ownerEmail);
    const phone = this.normalizePhone(payload.ownerPhone);
    // The person's name when the client sends it; the business name stays
    // the fallback so older clients that send no ownerName keep working.
    const ownerName = String(payload.ownerName || '').trim() || String(payload.businessName || '').trim();
    const maskedEmail = this.maskEmail(email);
    const maskedPhone = this.maskPhone(phone);

    this.logger.log(`public trial signup start | email=${maskedEmail} | phone=${maskedPhone}`);

    try {
      phase = 'rate-limit';
      await this.guardRateLimit(ip, email, phone);
      this.logger.log(`rate limit ok | email=${maskedEmail} | phone=${maskedPhone}`);

      phase = 'duplicate-check';
      await this.assertNotDuplicateRecent(email, phone);
      this.logger.log(`duplicate check ok | email=${maskedEmail} | phone=${maskedPhone}`);

      phase = 'provisioning';
      this.logger.log(`provisioning start | email=${maskedEmail} | phone=${maskedPhone}`);
      const provisioned = await this.provisioning.createTrialTenant(
        {
          businessName: String(payload.businessName || '').trim(),
          ownerName,
          ownerPhone: phone,
          ownerEmail: email,
          days: DEFAULT_TRIAL_DAYS,
          source: 'public-trial-signup',
        },
        { enforceStrongProvidedPassword: false },
      );
      this.logger.log(`provisioning ok | tenantId=${provisioned.tenant.id} | slug=${provisioned.tenant.slug}`);

      const isProduction = String(process.env.NODE_ENV || '').trim() === 'production';
      const debugCredentialsEnabled = String(process.env.PUBLIC_TRIAL_DEBUG_CREDENTIALS || '').trim().toLowerCase() === 'true';

      phase = 'mail-send';
      this.logger.log(`mail send start | tenantId=${provisioned.tenant.id} | slug=${provisioned.tenant.slug}`);
      try {
        await this.mail.sendTrialCredentials({
          businessName: provisioned.tenant.businessName,
          ownerName,
          ownerEmail: email,
          username: provisioned.owner.username,
          temporaryPassword: provisioned.owner.temporaryPassword,
          trialDays: DEFAULT_TRIAL_DAYS,
        });
        this.logger.log(`mail send ok | tenantId=${provisioned.tenant.id} | slug=${provisioned.tenant.slug}`);
      } catch (error) {
        this.logger.error(
          `mail send failed | tenantId=${provisioned.tenant.id} | slug=${provisioned.tenant.slug}`,
          JSON.stringify(this.sanitizeError(error)),
        );

        if (this.shouldRequireMailDelivery()) {
          phase = 'cleanup';
          this.logger.warn(`cleanup start | tenantId=${provisioned.tenant.id} | slug=${provisioned.tenant.slug}`);
          await this.db.transaction().execute(async (trx) => {
            const tenantId = provisioned.tenant.id;
            // Mirrors every insert TrialTenantProvisioningService.createTrialTenant performs,
            // in reverse dependency order, so a mail-send failure never leaves orphaned rows
            // that block deleting the tenant (branches <-> stock_locations is a two-way FK,
            // so the branch's default_stock_location_id must be cleared before either can go).
            await trx.updateTable('branches').set({ default_stock_location_id: null }).where('tenant_id', '=', tenantId).execute();
            await trx.deleteFrom('user_branches').where('tenant_id', '=', tenantId).execute();
            await trx.deleteFrom('stock_locations').where('tenant_id', '=', tenantId).execute();
            await trx.deleteFrom('branches').where('tenant_id', '=', tenantId).execute();
            await trx.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
            await trx.deleteFrom('tenant_subscriptions').where('tenant_id', '=', tenantId).execute();
            await trx.deleteFrom('users').where('tenant_id', '=', tenantId).execute();
            await trx.deleteFrom('trial_signups').where('tenant_id', '=', tenantId).execute();
            await trx.deleteFrom('tenants').where('id', '=', tenantId).execute();
          });
          this.logger.log(`cleanup ok | tenantId=${provisioned.tenant.id} | slug=${provisioned.tenant.slug}`);
          throw new BadRequestException('تعذر إرسال بيانات الدخول حاليًا. يرجى المحاولة مرة أخرى أو التواصل مع الدعم.');
        }
      }

      const response: Record<string, unknown> = {
        ok: true,
        message: 'تم إنشاء نسختك التجريبية بنجاح. أرسلنا بيانات الدخول على بريدك الإلكتروني.',
      };

      if (!isProduction && debugCredentialsEnabled) {
        response.debug = {
          username: provisioned.owner.username,
          temporaryPassword: provisioned.owner.temporaryPassword,
          trialEndsAt: provisioned.tenant.trialEndsAt,
        };
      }

      phase = 'final-success';
      this.logger.log(`final success | tenantId=${provisioned.tenant.id} | slug=${provisioned.tenant.slug}`);
      return response;
    } catch (error) {
      this.logger.error(
        `final failure | phase=${phase} | email=${maskedEmail} | phone=${maskedPhone}`,
        JSON.stringify(this.sanitizeError(error)),
      );
      throw error;
    }
  }
}

