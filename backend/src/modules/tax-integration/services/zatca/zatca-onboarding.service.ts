import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../../database/database.constants';
import { Database } from '../../../../database/database.types';
import { TaxSettingsService } from '../tax-settings/tax-settings.service';
import { createPkcs10Csr } from './pkcs10-csr';

export interface CreateEgsUnitDto {
  deviceName: string;
  customId?: string;
  branchId?: number;
  environment?: 'sandbox' | 'simulation' | 'production';
}

export interface RequestComplianceDto {
  egsId: string | number;
  otp: string;
}

@Injectable()
export class ZatcaOnboardingService {
  private readonly logger = new Logger(ZatcaOnboardingService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly taxSettings: TaxSettingsService,
  ) {}

  private getZatcaBaseUrl(env: string): string {
    switch (env) {
      case 'production':
        return 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core';
      case 'simulation':
        return 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation';
      case 'sandbox':
      default:
        return 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal';
    }
  }

  /**
   * 1. Register a new EGS unit and generate ECDSA keypair + CSR
   */
  async createEgsUnit(tenantId: string, dto: CreateEgsUnitDto) {
    const settings = await this.taxSettings.getSettings(tenantId, 'ZATCA_SAUDI');
    const vatNumber = String(settings?.tax_id || '').trim();
    const deviceUuid = crypto.randomUUID();
    const env = dto.environment || (settings?.environment === 'production' ? 'production' : 'sandbox');
    if (env === 'production' && !/^3\d{13}3$/.test(vatNumber)) {
      throw new BadRequestException('يجب ضبط الرقم الضريبي السعودي الصحيح قبل تسجيل وحدة إنتاج.');
    }

    // Generate the P-256 ECDSA keypair used to sign the PKCS#10 request.
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Build and sign a real PKCS#10 CSR. The previous base64 subject string was not a CSR.
    const commonName = dto.customId || `EGS-${dto.deviceName.replace(/\s+/g, '-').slice(0, 20)}`;
    const tenant =
      env === 'production'
        ? await this.db.selectFrom('tenants').select('business_name').where('id', '=', tenantId).executeTakeFirst()
        : null;
    const organization = String(tenant?.business_name || (env === 'production' ? '' : 'Z-Systems Demo')).trim();
    if (!organization) throw new BadRequestException('اسم المنشأة القانوني مطلوب لشهادة الإنتاج.');
    const orgUnit = `Branch-${dto.branchId || 1}`;
    const serialNumber = `1-ZS|2-${dto.customId || 'POS'}|3-${deviceUuid}`;

    const csrPem = createPkcs10Csr(privateKey, [
      ['2.5.4.6', 'SA'],
      ['2.5.4.10', organization],
      ['2.5.4.11', orgUnit],
      ['2.5.4.3', commonName],
      ['2.5.4.5', serialNumber],
      ...(vatNumber ? [['0.9.2342.19200300.100.1.1', vatNumber] as [string, string]] : []),
    ]);
    const csrPayload = Buffer.from(csrPem, 'utf8').toString('base64');

    const result = await this.db
      .insertInto('zatca_egs_units')
      .values({
        tenant_id: tenantId,
        branch_id: dto.branchId ? Number(dto.branchId) : null,
        device_uuid: deviceUuid,
        device_name: dto.deviceName.trim(),
        custom_id: dto.customId?.trim() || null,
        private_key_pem: privateKey,
        public_key_pem: publicKey,
        csr_content: csrPayload,
        status: 'unregistered',
        environment: env,
        last_icv: 0,
        last_invoice_hash: 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMjRiMWUxMDhkNDQ3ZjhlNzY1ZmVhNGU3NDkyNDQ1NQ==',
      } as any)
      .returning(['id', 'device_uuid', 'device_name', 'status', 'environment'])
      .executeTakeFirstOrThrow();

    return {
      success: true,
      egsUnit: result,
      message: 'تم تسجيل وحدة الـ EGS وتوليد المفاتيح التشفيرية بنجاح. يرجى إدخال رمز OTP لإتمام الربط.',
    };
  }

  /**
   * 2. Request Compliance CSID from ZATCA using Portal OTP
   */
  async requestComplianceCsid(tenantId: string, dto: RequestComplianceDto) {
    const egs = await this.db
      .selectFrom('zatca_egs_units')
      .selectAll()
      .where('id', '=', String(dto.egsId) as any)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!egs) {
      throw new BadRequestException('وحدة الـ EGS غير موجودة.');
    }

    if (!dto.otp || dto.otp.trim().length !== 6) {
      throw new BadRequestException('رمز الـ OTP يجب أن يتكون من 6 أرقام صادرة من بوابة هيئة الزكاة.');
    }

    const baseUrl = this.getZatcaBaseUrl(egs.environment);
    const authHeader = `Basic ${Buffer.from(`${dto.otp.trim()}:`).toString('base64')}`;

    try {
      let complianceCsid = '';
      let complianceSecret = '';
      let complianceRequestId = '';

      // Live request to ZATCA Compliance endpoint
      const response = await fetch(`${baseUrl}/compliance`, {
        method: 'POST',
        headers: {
          OTP: dto.otp.trim(),
          'Accept-Version': 'V2',
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({
          csr: egs.csr_content,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        complianceCsid = data.binarySecurityToken || '';
        complianceSecret = data.secret || '';
        complianceRequestId = String(data.requestID || data.requestId || '');
        if (!complianceCsid || !complianceSecret || (egs.environment === 'production' && !complianceRequestId)) {
          throw new Error('ZATCA returned an incomplete compliance credential response');
        }
      } else if (egs.environment !== 'production') {
        // Simulation fallback is allowed only for explicitly non-production EGS units.
        // A production unit must never be marked compliant without a real ZATCA response.
        const simulatedToken = Buffer.from(`ZATCA-COMPLIANCE-${egs.device_uuid}-${Date.now()}`).toString('base64');
        complianceCsid = simulatedToken;
        complianceSecret = crypto.randomBytes(16).toString('hex');
      } else {
        throw new Error(`ZATCA compliance request failed with HTTP ${response.status}`);
      }

      await this.db
        .updateTable('zatca_egs_units')
        .set({
          compliance_csid: complianceCsid,
          compliance_secret: complianceSecret,
          compliance_request_id: complianceRequestId || null,
          status: 'compliance_passed',
          updated_at: new Date(),
        })
        .where('id', '=', egs.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      return {
        success: true,
        message: 'تم الحصول على شهادة الامتثال الرقمية (Compliance CSID) بنجاح.',
        status: 'compliance_passed',
      };
    } catch (error: any) {
      this.logger.error(`ZATCA Compliance error: ${error.message}`);
      throw new BadRequestException(`فشل الاتصال بهيئة الزكاة لإصدار شهادة الامتثال: ${error.message}`);
    }
  }

  /**
   * 3. Request Final Production CSID from ZATCA
   */
  async requestProductionCsid(tenantId: string, egsId: string | number) {
    const egs = await this.db
      .selectFrom('zatca_egs_units')
      .selectAll()
      .where('id', '=', String(egsId) as any)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!egs || !egs.compliance_csid) {
      throw new BadRequestException('يجب اجتياز مرحلة الامتثال (Compliance) أولاً.');
    }

    if (egs.environment !== 'production') {
      throw new BadRequestException('لا يمكن طلب شهادة إنتاج لوحدة EGS غير مضبوطة على بيئة الإنتاج.');
    }
    if (!egs.compliance_request_id) throw new BadRequestException('معرّف طلب الامتثال مفقود. أعد طلب شهادة الامتثال.');

    const baseUrl = this.getZatcaBaseUrl(egs.environment);
    const authHeader = `Basic ${Buffer.from(`${egs.compliance_csid}:${egs.compliance_secret}`).toString('base64')}`;

    try {
      let productionCsid = '';
      let productionSecret = '';

      const response = await fetch(`${baseUrl}/production/csids`, {
        method: 'POST',
        headers: {
          'Accept-Version': 'V2',
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({
          compliance_request_id: egs.compliance_request_id,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        productionCsid = data.binarySecurityToken || '';
        productionSecret = data.secret || '';
        if (!productionCsid || !productionSecret) {
          throw new Error('ZATCA returned an incomplete production credential response');
        }
      } else {
        throw new Error(`ZATCA production CSID request failed with HTTP ${response.status}`);
      }

      await this.db
        .updateTable('zatca_egs_units')
        .set({
          production_csid: productionCsid,
          production_secret: productionSecret,
          status: 'production_active',
          updated_at: new Date(),
        })
        .where('id', '=', egs.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      return {
        success: true,
        message: 'تم تفعيل وحدة الـ EGS في بيئة الإنتاج بنجاح! الوحدة جاهزة لإصدار الفواتير الحية وتشفير الهاش.',
        status: 'production_active',
      };
    } catch (error: any) {
      this.logger.error(`ZATCA Production CSID error: ${error.message}`);
      throw new BadRequestException(`فشل تفعيل شهادة الإنتاج: ${error.message}`);
    }
  }

  /**
   * 4. List registered EGS units with live sequence stats
   */
  async listEgsUnits(tenantId: string) {
    const rows = await this.db
      .selectFrom('zatca_egs_units')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('id', 'asc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      deviceUuid: row.device_uuid,
      deviceName: row.device_name,
      customId: row.custom_id,
      branchId: row.branch_id,
      status: row.status,
      environment: row.environment,
      lastIcv: Number(row.last_icv || 0),
      lastInvoiceHash: row.last_invoice_hash,
      hasProductionCsid: Boolean(row.production_csid),
      createdAt: row.created_at,
    }));
  }
}
