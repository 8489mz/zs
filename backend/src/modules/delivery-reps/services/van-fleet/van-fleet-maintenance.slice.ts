import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';

export class VanFleetMaintenanceSlice {
  constructor(private readonly db: Kysely<Database>) {}

  private get anyDb(): any {
    return this.db;
  }

  async getFleetMaintenanceAlerts(tenantId: string, vehicleId?: number, repId?: number) {
    // INV-REP-SCOPED-DRIVER-READS (M19/D10): a driver call carries
    // repId and sees alerts only for vehicles assigned to him — either
    // as the vehicle's assigned rep (fleet_vehicles.assigned_rep_id)
    // or as an active driver on it (fleet_vehicle_drivers). An
    // explicitly requested vehicle outside that set is refused with a
    // specific 403. A rep with no vehicle simply gets no alerts.
    // Staff calls (no repId) keep the full-tenant behaviour.
    let repVehicleIds: Set<number> | null = null;
    if (repId != null) {
      const [assigned, driven] = await Promise.all([
        this.anyDb
          .selectFrom('fleet_vehicles')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('assigned_rep_id', '=', repId)
          .execute(),
        this.anyDb
          .selectFrom('fleet_vehicle_drivers')
          .select('vehicle_id')
          .where('tenant_id', '=', tenantId)
          .where('rep_id', '=', repId)
          .where('is_active', '=', true)
          .execute(),
      ]);
      repVehicleIds = new Set<number>();
      for (const row of [...(assigned || []), ...(driven || [])]) {
        const id = Number(row.id ?? row.vehicle_id);
        if (Number.isInteger(id) && id > 0) repVehicleIds.add(id);
      }
      if (vehicleId && !repVehicleIds.has(Number(vehicleId))) {
        throw new AppError(
          'هذه المركبة ليست مسندة إليك، لا يمكنك الاطلاع على تنبيهات صيانتها',
          'REP_VEHICLE_NOT_ASSIGNED',
          403,
        );
      }
    }

    let vehicleQuery = this.anyDb
      .selectFrom('fleet_vehicles as fv')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'fv.assigned_rep_id')
      .select([
        'fv.id',
        'fv.plate_number as plateNumber',
        'fv.model_name as modelName',
        sql<number>`cast(fv.current_odometer as numeric)`.as('currentOdometer'),
        'fv.license_expires_at as licenseExpiresAt',
        'fv.status',
        'fv.assigned_rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
      ])
      .where('fv.tenant_id', '=', tenantId);

    if (vehicleId) {
      vehicleQuery = vehicleQuery.where('fv.id', '=', vehicleId);
    }
    if (repVehicleIds) {
      vehicleQuery = vehicleQuery.where('fv.id', 'in', [...repVehicleIds]);
    }

    const vehicles = await vehicleQuery.execute();
    const alerts: Array<{
      id: string;
      vehicleId: number;
      plateNumber: string;
      repName: string;
      type: 'oil_change' | 'license_expiry';
      severity: 'warning' | 'critical';
      title: string;
      description: string;
      currentValue: string | number;
      thresholdValue: string | number;
      dueDate?: string;
    }> = [];

    const now = new Date();

    for (const v of vehicles) {
      const vId = Number(v.id);
      const currOdo = Number(v.currentOdometer || 0);

      if (v.licenseExpiresAt) {
        const expDate = new Date(v.licenseExpiresAt);
        const diffMs = expDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays <= 0) {
          alerts.push({
            id: `license-exp-${vId}`,
            vehicleId: vId,
            plateNumber: v.plateNumber,
            repName: v.repName,
            type: 'license_expiry',
            severity: 'critical',
            title: `رخصة منتهية للمركبة (${v.plateNumber})`,
            description: `انتهت رخصة المركبة بتاريخ ${v.licenseExpiresAt} (منذ ${Math.abs(diffDays)} يوم).`,
            currentValue: 'منتهية',
            thresholdValue: v.licenseExpiresAt,
            dueDate: v.licenseExpiresAt,
          });
        } else if (diffDays <= 30) {
          alerts.push({
            id: `license-due-${vId}`,
            vehicleId: vId,
            plateNumber: v.plateNumber,
            repName: v.repName,
            type: 'license_expiry',
            severity: 'warning',
            title: `اقتراب انتهاء رخصة المركبة (${v.plateNumber})`,
            description: `متبقي ${diffDays} يوم على انتهاء رخصة المركبة (تاريخ الانتهاء: ${v.licenseExpiresAt}).`,
            currentValue: `${diffDays} يوم متبقي`,
            thresholdValue: v.licenseExpiresAt,
            dueDate: v.licenseExpiresAt,
          });
        }
      }

      const latestOilChange = await this.anyDb
        .selectFrom('fleet_oil_changes')
        .selectAll()
        .where('vehicle_id', '=', vId)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'active')
        .orderBy('created_at', 'desc')
        .executeTakeFirst();

      if (latestOilChange) {
        const nextDue = Number(latestOilChange.next_due_odometer || 0);
        const alertKm = Number(latestOilChange.alert_km_before || 500);
        const kmRemaining = nextDue - currOdo;

        if (kmRemaining <= 0) {
          alerts.push({
            id: `oil-overdue-${vId}`,
            vehicleId: vId,
            plateNumber: v.plateNumber,
            repName: v.repName,
            type: 'oil_change',
            severity: 'critical',
            title: `تجاوز موعد غيار الزيت (${v.plateNumber})`,
            description: `تجاوزت السيارة موعد غيار الزيت بـ ${Math.abs(kmRemaining)} كم! (العداد الحالي: ${currOdo}، المقرر: ${nextDue} كم - نوع الزيت: ${latestOilChange.oil_type}).`,
            currentValue: currOdo,
            thresholdValue: nextDue,
          });
        } else if (kmRemaining <= alertKm) {
          alerts.push({
            id: `oil-due-${vId}`,
            vehicleId: vId,
            plateNumber: v.plateNumber,
            repName: v.repName,
            type: 'oil_change',
            severity: 'warning',
            title: `اقتراب موعد غيار الزيت (${v.plateNumber})`,
            description: `متبقي ${kmRemaining} كم فقط على موعد غيار الزيت (العداد الحالي: ${currOdo}، المقرر: ${nextDue} كم - نوع الزيت: ${latestOilChange.oil_type}${latestOilChange.with_filter ? ' مع فلتر' : ''}).`,
            currentValue: currOdo,
            thresholdValue: nextDue,
          });
        }
      }
    }

    return { ok: true, alerts };
  }
}
