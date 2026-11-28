import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { loadAntiTheftSettings } from '../../../common/utils/anti-theft-settings.util';
import { roundMoneyToTwoDecimals } from '../../../common/utils/financial-integrity';
import { WhatsAppAlertPort } from '../../../common/utils/whatsapp-alert.port';
import { evaluateTransferAging } from '../engines/shrinkage-reconciliation.engine';

export interface InTransitCustodyItem {
  transferId: string;
  docNo: string;
  fromLocationName: string;
  toLocationName: string;
  carrierEmployeeId: string | null;
  carrierName: string;
  createdByName: string;
  createdAt: string;
  ageHours: number;
  isOverdue: boolean;
  overdueByHours: number;
  itemsCount: number;
  totalQty: number;
  estimatedCost: number;
  alertedAt: string | null;
}

@Injectable()
export class InTransitAgingMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InTransitAgingMonitorService.name);
  private intervalHandle: NodeJS.Timeout | null = null;
  private startupHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    @Optional() private readonly whatsappService?: WhatsAppAlertPort,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    this.startupHandle = setTimeout(() => {
      this.scanAllTenantsForOverdueTransfers().catch((err) => {
        this.logger.warn(`Initial in-transit aging check error: ${err?.message}`);
      });
    }, 60_000);
    this.intervalHandle = setInterval(
      () => {
        this.scanAllTenantsForOverdueTransfers().catch((err) => {
          this.logger.warn(`Periodic in-transit aging check error: ${err?.message}`);
        });
      },
      30 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.startupHandle) {
      clearTimeout(this.startupHandle);
      this.startupHandle = null;
    }
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async scanAllTenantsForOverdueTransfers(): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    let totalAlerted = 0;
    try {
      const tenants = await this.db
        .selectFrom('stock_transfers')
        .select('tenant_id')
        .distinct()
        .where('status', '=', 'sent')
        .where('in_transit_alerted_at', 'is', null)
        .execute();

      for (const row of tenants) {
        if (!row.tenant_id) continue;
        try {
          totalAlerted += await this.checkOverdueTransfersForTenant(String(row.tenant_id));
        } catch (err: any) {
          this.logger.warn(`In-transit check failed for tenant ${row.tenant_id}: ${err?.message}`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`scanAllTenantsForOverdueTransfers error: ${err?.message}`);
    } finally {
      this.isRunning = false;
    }
    return totalAlerted;
  }

  async checkOverdueTransfersForTenant(tenantId: string): Promise<number> {
    const antiTheft = await loadAntiTheftSettings(this.db, tenantId);
    const alertHours = Math.max(1, Number(antiTheft.inTransitAlertHours || 4));
    const openRows = await this.db
      .selectFrom('stock_transfers as t')
      .leftJoin('stock_locations as fl', (j) =>
        j.onRef('fl.id', '=', 't.from_location_id').onRef('fl.tenant_id', '=', 't.tenant_id'),
      )
      .leftJoin('stock_locations as tl', (j) =>
        j.onRef('tl.id', '=', 't.to_location_id').onRef('tl.tenant_id', '=', 't.tenant_id'),
      )
      .leftJoin('users as cu', (j) => j.onRef('cu.id', '=', 't.created_by').onRef('cu.tenant_id', '=', 't.tenant_id'))
      .select([
        't.id',
        't.doc_no',
        't.carrier_name',
        't.created_at',
        't.account_id',
        'fl.name as from_location_name',
        'tl.name as to_location_name',
        'cu.username as created_by_name',
      ])
      .where('t.tenant_id', '=', tenantId)
      .where('t.status', '=', 'sent')
      .where('t.in_transit_alerted_at', 'is', null)
      .execute();

    if (!openRows.length) return 0;

    const now = new Date();
    const overdueList = openRows
      .map((row) => ({
        row,
        aging: evaluateTransferAging({
          transferId: String(row.id),
          docNo: String(row.doc_no || `TR-${row.id}`),
          createdAt: row.created_at as Date,
          alertHours,
          now,
        }),
      }))
      .filter((entry) => entry.aging.isOverdue);

    if (!overdueList.length) return 0;

    const tenant = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'owner_phone'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    for (const { row, aging } of overdueList) {
      await this.db
        .updateTable('stock_transfers')
        .set({ in_transit_alerted_at: sql`NOW()`, updated_at: sql`NOW()` })
        .where('id', '=', Number(row.id))
        .where('tenant_id', '=', tenantId)
        .execute();

      const systemActor: AuthContext = {
        userId: 0,
        sessionId: 'in-transit-aging-monitor',
        username: 'نظام مراقبة البضاعة بالطريق',
        tenantId,
        accountId: String(row.account_id || tenantId),
        role: 'admin',
        permissions: ['*'],
      };

      await this.audit.log(
        'إنذار تأخر استلام بضاعة بالطريق',
        `إذن التحويل ${aging.docNo} متأخر في الطريق منذ ${aging.ageHours} ساعة (الحد: ${alertHours} ساعة) | من: ${row.from_location_name || '—'} -> إلى: ${row.to_location_name || '—'}` +
          (row.carrier_name ? ` | الناقل: ${row.carrier_name}` : ''),
        systemActor,
        { eventCode: AUDIT_EVENT_CODES.INVENTORY_IN_TRANSIT_OVERDUE },
      );

      if (this.whatsappService && tenant?.owner_phone) {
        const text =
          `*درع منع الخسائر - بضاعة عالقة بالطريق لم تُستلم*\n` +
          `*${tenant.business_name || 'إدارة المخازن'}*\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `رقم الإذن: *${aging.docNo}*\n` +
          `من: ${row.from_location_name || '—'}\n` +
          `إلى: ${row.to_location_name || '—'}\n` +
          `الناقل / حامل البضاعة: *${row.carrier_name || 'غير محدد'}*\n` +
          `صرفه: ${row.created_by_name || '—'}\n` +
          `المدة المنقضية: *${aging.ageHours} ساعة* (تجاوز الحد ${alertHours} ساعة)\n\n` +
          `_يرجى التحقق فوراً من موقع البضاعة مع الناقل وأمين المخزن._`;
        await this.whatsappService.sendRawMessage(tenantId, tenant.owner_phone, text).catch((err) => {
          this.logger.warn(`Overdue transfer WhatsApp alert failed: ${err?.message}`);
        });
      }
    }

    return overdueList.length;
  }

  async listInTransitCustody(auth: AuthContext): Promise<{
    alertThresholdHours: number;
    openCount: number;
    overdueCount: number;
    totalEstimatedCost: number;
    transfers: InTransitCustodyItem[];
  }> {
    const scope = requireTenantScope(auth);
    const antiTheft = await loadAntiTheftSettings(this.db, scope.tenantId);
    const alertHours = Math.max(1, Number(antiTheft.inTransitAlertHours || 4));

    const openRows = await this.db
      .selectFrom('stock_transfers as t')
      .leftJoin('stock_locations as fl', (j) =>
        j.onRef('fl.id', '=', 't.from_location_id').onRef('fl.tenant_id', '=', 't.tenant_id'),
      )
      .leftJoin('stock_locations as tl', (j) =>
        j.onRef('tl.id', '=', 't.to_location_id').onRef('tl.tenant_id', '=', 't.tenant_id'),
      )
      .leftJoin('users as cu', (j) => j.onRef('cu.id', '=', 't.created_by').onRef('cu.tenant_id', '=', 't.tenant_id'))
      .select([
        't.id',
        't.doc_no',
        't.carrier_employee_id',
        't.carrier_name',
        't.in_transit_alerted_at',
        't.created_at',
        'fl.name as from_location_name',
        'tl.name as to_location_name',
        'cu.username as created_by_name',
      ])
      .where('t.tenant_id', '=', scope.tenantId)
      .where('t.status', '=', 'sent')
      .orderBy('t.created_at', 'asc')
      .execute();

    if (!openRows.length) {
      return {
        alertThresholdHours: alertHours,
        openCount: 0,
        overdueCount: 0,
        totalEstimatedCost: 0,
        transfers: [],
      };
    }

    const transferIds = openRows.map((r) => Number(r.id));
    const itemStats = await this.db
      .selectFrom('stock_transfer_items as i')
      .leftJoin('products as p', (j) => j.onRef('p.id', '=', 'i.product_id').onRef('p.tenant_id', '=', 'i.tenant_id'))
      .select([
        'i.transfer_id',
        sql<number>`COUNT(*)`.as('items_count'),
        sql<number>`COALESCE(SUM(i.qty), 0)`.as('total_qty'),
        sql<number>`COALESCE(SUM(i.qty * COALESCE(p.cost_price, 0)), 0)`.as('est_cost'),
      ])
      .where('i.tenant_id', '=', scope.tenantId)
      .where('i.transfer_id', 'in', transferIds)
      .groupBy('i.transfer_id')
      .execute();

    const statsMap = new Map<number, { itemsCount: number; totalQty: number; estCost: number }>();
    for (const s of itemStats) {
      statsMap.set(Number(s.transfer_id), {
        itemsCount: Number(s.items_count || 0),
        totalQty: Number(Number(s.total_qty || 0).toFixed(3)),
        estCost: roundMoneyToTwoDecimals(Number(s.est_cost || 0)),
      });
    }

    const now = new Date();
    let overdueCount = 0;
    let totalEstimatedCost = 0;

    const transfers: InTransitCustodyItem[] = openRows.map((row) => {
      const aging = evaluateTransferAging({
        transferId: String(row.id),
        docNo: String(row.doc_no || `TR-${row.id}`),
        createdAt: row.created_at as Date,
        alertHours,
        now,
      });
      if (aging.isOverdue) overdueCount += 1;
      const stats = statsMap.get(Number(row.id)) || { itemsCount: 0, totalQty: 0, estCost: 0 };
      totalEstimatedCost += stats.estCost;

      return {
        transferId: String(row.id),
        docNo: aging.docNo,
        fromLocationName: String(row.from_location_name || '—'),
        toLocationName: String(row.to_location_name || '—'),
        carrierEmployeeId: row.carrier_employee_id ? String(row.carrier_employee_id) : null,
        carrierName: String(row.carrier_name || ''),
        createdByName: String(row.created_by_name || ''),
        createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : '',
        ageHours: aging.ageHours,
        isOverdue: aging.isOverdue,
        overdueByHours: aging.overdueByHours,
        itemsCount: stats.itemsCount,
        totalQty: stats.totalQty,
        estimatedCost: stats.estCost,
        alertedAt: row.in_transit_alerted_at ? new Date(String(row.in_transit_alerted_at)).toISOString() : null,
      };
    });

    return {
      alertThresholdHours: alertHours,
      openCount: transfers.length,
      overdueCount,
      totalEstimatedCost: roundMoneyToTwoDecimals(totalEstimatedCost),
      transfers,
    };
  }
}
