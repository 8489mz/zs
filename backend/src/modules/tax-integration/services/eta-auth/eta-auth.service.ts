import { Injectable, BadRequestException } from '@nestjs/common';
import { TaxSettingsService } from '../tax-settings/tax-settings.service';

@Injectable()
export class EtaAuthService {
  constructor(private readonly taxSettings: TaxSettingsService) {}

  async getAccessToken(tenantId: string): Promise<string | null> {
    const settings = await this.taxSettings.getSettings(tenantId, 'ETA_EGYPT');
    if (!settings || !settings.client_id || !settings.client_secret || !settings.is_active) {
      throw new BadRequestException('ETA Settings not configured or inactive for this tenant');
    }

    const authUrl =
      settings.environment === 'production'
        ? 'https://id.eta.gov.eg/connect/token'
        : 'https://id.preprod.eta.gov.eg/connect/token';

    try {
      const response = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: settings.client_id,
          client_secret: settings.client_secret,
          scope: 'InvoicingAPI',
        }).toString(),
      });

      if (!response.ok) {
        let errorMsg = 'Unknown error';
        try {
          const errBody = await response.json();
          errorMsg = errBody.error_description || errBody.error || response.statusText;
        } catch {
          errorMsg = response.statusText;
        }

        let friendlyMsg = errorMsg;
        if (
          errorMsg === 'invalid_client' ||
          errorMsg === 'Bad Request' ||
          errorMsg.includes('invalid_client') ||
          response.status === 400
        ) {
          friendlyMsg = 'بيانات الربط (Client ID أو Secret) غير صحيحة أو غير صالحة للبيئة المختارة';
        } else if (response.status === 401 || response.status === 403) {
          friendlyMsg = 'غير مصرح بالوصول، يرجى مراجعة بيانات الربط الضريبي';
        }

        throw new BadRequestException(`فشل المصادقة مع الضرائب: ${friendlyMsg}`);
      }

      const data = await response.json();
      return data.access_token;
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(error.message || 'فشل الاتصال بسيرفر الضرائب');
    }
  }
}
