import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { Logger } from '@nestjs/common';
import { parseTerminalHostAndPort } from './pos-terminal-shared';
import type { PosTerminalInfo } from './pos-terminal-shared';

export class PosTerminalTerminals {
  constructor(
    private readonly db?: Kysely<Database>,
    private readonly logger: Logger,
  ) {}

  /**
   * Get configured POS Terminals for the tenant from settings
   */
  async getTerminals(tenantId: string): Promise<PosTerminalInfo[]> {
    if (!this.db) {
      return [
        {
          id: 'term-main-01',
          name: 'جهاز شبكة الكاشير الرئيسي (EDC)',
          type: 'edc_standalone',
          status: 'online',
          provider: 'POS Network EDC',
          ipAddress: '192.168.1.150:8080',
        },
      ];
    }

    try {
      const rows = await this.db
        .selectFrom('settings')
        .selectAll()
        .where('tenant_id', '=', String(tenantId))
        .execute();

      const settingsMap: Record<string, any> = {};
      for (const row of rows) {
        try {
          settingsMap[row.key] = JSON.parse(row.value);
        } catch {
          settingsMap[row.key] = row.value;
        }
      }

      const isEnabled = settingsMap.posTerminalEnabled === true || settingsMap.posTerminalEnabled === 'true';
      if (!isEnabled) {
        return [];
      }

      const providerDisplayNames: Record<string, string> = {
        geidea: 'Geidea POS (جيديا - شبكة مدى / السعودية)',
        paymob: 'Paymob Smart POS (باي موب)',
        fawry: 'Fawry POS / PAX (فوري - أجهزة PAX)',
        network_international: 'Network International (NI - الإمارات)',
        knet_pos: 'KNET POS (كي نت - الكويت)',
        mock_sandbox: 'محاكي نقاط البيع التجريبي (Simulator)',
      };

      let terminalsList: PosTerminalInfo[] = [];

      const rawCountry = String(settingsMap.country || '').trim().toUpperCase();
      const rawCurrency = String(settingsMap.currency || '').trim().toUpperCase();
      let country = rawCountry;
      if (!country) {
        if (rawCurrency === 'KWD') country = 'KW';
        else if (rawCurrency === 'SAR') country = 'SA';
        else if (rawCurrency === 'AED') country = 'AE';
        else country = 'EG';
      }

      // Check if multi-terminal posTerminals array is configured
      if (Array.isArray(settingsMap.posTerminals) && settingsMap.posTerminals.length > 0) {
        terminalsList = settingsMap.posTerminals
          .filter((t: any) => {
            if (!t || t.enabled === false) return false;
            const provKey = String(t.provider || '').toLowerCase();
            // Strict country isolation
            if (country === 'EG' && (provKey === 'knet_pos' || provKey === 'knet')) return false;
            if (country === 'KW' && (provKey === 'fawry' || provKey === 'paymob')) return false;
            if (country === 'SA' && (provKey === 'knet_pos' || provKey === 'knet' || provKey === 'fawry' || provKey === 'paymob')) return false;
            return true;
          })
          .map((t: any, idx: number) => {
            const providerKey = t.provider || (country === 'KW' ? 'knet_pos' : country === 'SA' ? 'geidea' : 'fawry');
            const parsed = parseTerminalHostAndPort(String(t.ip || '192.168.1.150'), Number(t.port || 8080));
            return {
              id: String(t.id || `term-${idx + 1}`),
              name: `${t.name || `ماكينة ${idx + 1}`} - ${providerDisplayNames[providerKey] || providerKey}`,
              type: 'edc_standalone' as const,
              status: 'online' as const,
              provider: providerDisplayNames[providerKey] || providerKey,
              ipAddress: `${parsed.host}:${parsed.port}`,
              isDefault: Boolean(t.isDefault),
              pairingKey: t.pairingKey ? String(t.pairingKey).trim() : undefined,
              terminalTid: t.terminalTid ? String(t.terminalTid).trim() : undefined,
            };
          });
      }

      // Fallback to legacy single terminal
      if (terminalsList.length === 0) {
        const name = settingsMap.posTerminalName || 'جهاز الكاشير الرئيسي (EDC)';
        const provider = settingsMap.posTerminalProvider || (country === 'KW' ? 'knet_pos' : country === 'SA' ? 'geidea' : 'fawry');
        const parsed = parseTerminalHostAndPort(settingsMap.posTerminalIp || '192.168.1.3', Number(settingsMap.posTerminalPort || 8080));

        terminalsList = [
          {
            id: 'term-main-01',
            name: `${name} - ${providerDisplayNames[provider] || provider}`,
            type: 'edc_standalone',
            status: 'online',
            provider: providerDisplayNames[provider] || provider,
            ipAddress: `${parsed.host}:${parsed.port}`,
            isDefault: true,
            pairingKey: settingsMap.posTerminalPairingKey,
            terminalTid: settingsMap.posTerminalTid,
          },
        ];
      }

      return terminalsList;
    } catch (err) {
      this.logger.error(`Error loading terminals for tenant ${tenantId}:`, err);
      return [];
    }
  }

  async getTenantBaseCurrency(tenantId: string): Promise<string> {
    if (!this.db) return 'EGP';
    try {
      const rows = await this.db
        .selectFrom('settings')
        .select(['key', 'value'])
        .where('tenant_id', '=', String(tenantId))
        .where('key', 'in', ['currency', 'baseCurrency', 'globalCurrency'])
        .execute();

      for (const row of rows) {
        if (row.value) {
          try {
            const parsed = JSON.parse(row.value);
            if (typeof parsed === 'string' && parsed.trim()) return parsed.trim().toUpperCase();
          } catch {
            const raw = String(row.value).replace(/['"]+/g, '').trim().toUpperCase();
            if (raw) return raw;
          }
        }
      }
    } catch {}
    return 'EGP';
  }
}
