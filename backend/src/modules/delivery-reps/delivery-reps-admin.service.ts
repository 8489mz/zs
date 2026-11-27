/**
 * DeliveryRepsAdminService — slice S1 of the delivery-reps split.
 * Pure move of the four admin methods from DeliveryRepsService: list,
 * create, update, remove. No behavior change: bodies are byte-identical
 * apart from trailing whitespace stripped on moved lines.
 * Deps: database + audit + the two kernel helpers, bound from the facade
 * and stored under their original names, plus the S0 pin helpers used
 * by update. The facade keeps thin public delegates with the original
 * signatures.
 */

import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../common/errors/app-error';
import { Database } from '../../database/database.types';
import { UpsertDeliveryRepDto } from './dto/upsert-delivery-rep.dto';
import { createPasswordRecord } from '../../core/auth/utils/password-hasher';
import { assertSecurePasscode } from '../../core/auth/utils/password-policy';
import { parseMetadata, repPinVersion, withPinVersion } from './delivery-reps.helpers';

export interface DeliveryRepsAdminDeps {
  db: Kysely<Database>;
  audit: AuditService;
  tenantPredicate: (actor: AuthContext) => RawBuilder<boolean>;
  tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
}

@Injectable()
export class DeliveryRepsAdminService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly tenantPredicate: (actor: AuthContext) => RawBuilder<boolean>;
  private readonly tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };

  constructor(deps: DeliveryRepsAdminDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.tenantPredicate = deps.tenantPredicate;
    this.tenantFields = deps.tenantFields;
  }

  async list(actor: AuthContext): Promise<Record<string, unknown>> {
    const reps = await this.db
      .selectFrom('delivery_representatives as dr')
      .selectAll('dr')
      .select([
        sql<string | null>`coalesce(
          (SELECT fv.plate_number
           FROM fleet_vehicle_drivers fvd
           JOIN fleet_vehicles fv ON fv.id = fvd.vehicle_id
           WHERE fvd.rep_id = dr.id AND fvd.tenant_id = dr.tenant_id AND fvd.is_active = true
           ORDER BY fvd.id DESC LIMIT 1),
          (SELECT fv2.plate_number
           FROM fleet_vehicles fv2
           WHERE fv2.assigned_rep_id = dr.id AND fv2.tenant_id = dr.tenant_id
           ORDER BY fv2.id DESC LIMIT 1),
          dr.vehicle_plate
        )`.as('vehicle_plate'),
        sql<number | null>`coalesce(
          (SELECT fv.van_location_id
           FROM fleet_vehicle_drivers fvd
           JOIN fleet_vehicles fv ON fv.id = fvd.vehicle_id
           WHERE fvd.rep_id = dr.id AND fvd.tenant_id = dr.tenant_id AND fvd.is_active = true
           ORDER BY fvd.id DESC LIMIT 1),
          (SELECT fv2.van_location_id
           FROM fleet_vehicles fv2
           WHERE fv2.assigned_rep_id = dr.id AND fv2.tenant_id = dr.tenant_id
           ORDER BY fv2.id DESC LIMIT 1),
          dr.van_location_id
        )`.as('van_location_id'),
        sql<string | null>`(
          SELECT fvd.shift_name
          FROM fleet_vehicle_drivers fvd
          WHERE fvd.rep_id = dr.id AND fvd.tenant_id = dr.tenant_id AND fvd.is_active = true
          ORDER BY fvd.id DESC LIMIT 1
        )`.as('shift_name'),
      ])
      .where(this.tenantPredicate(actor))
      .orderBy('dr.is_active', 'desc')
      .orderBy('dr.name', 'asc')
      .execute();

    const sanitized = reps.map((r) => {
      const { pin_hash, pin_salt, ...rest } = r;
      return {
        ...rest,
        // حالة وجود الرمز فقط كقيمة منطقية دون تسريب التجزئة (البند O20)
        has_pin: Boolean(pin_hash),
      };
    });

    return { ok: true, deliveryReps: sanitized };
  }

  async create(payload: UpsertDeliveryRepDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Name is required', 'NAME_REQUIRED', 400);

    // الرمز يُجزَّأ قبل الكتابة — لا يُخزَّن نصاً صريحاً (البند O20)
    if (payload.pinCode) {
      assertSecurePasscode(String(payload.pinCode), { phone: payload.phone });
    }
    const createPinRecord = payload.pinCode ? await createPasswordRecord(String(payload.pinCode)) : null;

    const isVanRep =
      payload.isVanRep !== undefined
        ? Boolean(payload.isVanRep)
        : payload.repType === 'van' || payload.repType === 'both';
    const repType = payload.repType || (isVanRep ? 'van' : 'delivery');

    const defaultPermissions = {
      can_edit_routes: false,
      can_add_customers: true,
      require_gps_on_visit: true,
      can_give_discount: false,
      // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: per-line only by
      // default — the invoice channel needs an explicit grant at rep
      // creation (UpsertDeliveryRepModal). max_discount_percent is
      // stored inert: the tenant cap governs enforcement.
      can_give_invoice_discount: false,
      max_discount_percent: 0,
      can_sell_over_credit_limit: false,
      can_collect_cash: true,
    };
    const permissions = payload.permissions ? { ...defaultPermissions, ...payload.permissions } : defaultPermissions;

    const [inserted] = await this.db
      .insertInto('delivery_representatives')
      .values({
        name,
        phone: payload.phone || null,
        full_name: payload.fullName || null,
        national_id: payload.nationalId || null,
        address: payload.address || null,
        vehicle_plate: payload.vehiclePlate || null,
        pin_hash: createPinRecord?.hash ?? null,
        pin_salt: createPinRecord?.salt ?? null,
        rep_type: repType,
        is_van_rep: isVanRep,
        is_active: payload.isActive !== false,
        permissions: permissions,
        // M14: مندوب جديد يبدأ بنسخة PIN رقم 0 — لا رموز صادرة قبله أصلاً.
        metadata: { ...((payload.metadata || {}) as Record<string, any>), pin_version: 0 },
        ...this.tenantFields(actor),
      })
      .returning(['id'])
      .execute();

    await this.audit.log('إضافة مندوب توصيل', `تم إضافة المندوب ${name} (${repType}) بواسطة ${actor.username}`, actor);
    return this.list(actor);
  }

  async update(id: number, payload: UpsertDeliveryRepDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Name is required', 'NAME_REQUIRED', 400);

    const existing = await this.db
      .selectFrom('delivery_representatives')
      .select(['id', 'permissions', 'phone', 'metadata'])
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!existing) throw new AppError('Delivery representative not found', 'NOT_FOUND', 404);

    if (payload.pinCode) {
      assertSecurePasscode(String(payload.pinCode), { phone: payload.phone || existing.phone || undefined });
    }
    const updatePinRecord = payload.pinCode ? await createPasswordRecord(String(payload.pinCode)) : null;

    // M14: تغيير PIN من مسار الإدارة يرفع نسخة الـPIN أيضاً — وإلا بقيت
    // الرموز الصادرة تحت الـPIN القديم صالحة 30 يوماً. دمج metadata
    // يحفظ النسخة حتى لو أرسل المتصل metadata كاملة بدونها.
    const currentPinVersion = repPinVersion(existing.metadata);
    const nextPinVersion = updatePinRecord ? currentPinVersion + 1 : currentPinVersion;
    const mergedMetadata =
      updatePinRecord || payload.metadata !== undefined
        ? withPinVersion(
            payload.metadata !== undefined
              ? { ...parseMetadata(existing.metadata), ...(payload.metadata as Record<string, any>) }
              : existing.metadata,
            nextPinVersion,
          )
        : undefined;

    const isVanRep =
      payload.isVanRep !== undefined
        ? Boolean(payload.isVanRep)
        : payload.repType
          ? payload.repType === 'van' || payload.repType === 'both'
          : undefined;

    let mergedPermissions: any = undefined;
    if (payload.permissions !== undefined) {
      let currentPerms: any = {};
      if (typeof existing.permissions === 'string') {
        try {
          currentPerms = JSON.parse(existing.permissions);
        } catch {
          currentPerms = {};
        }
      } else if (existing.permissions && typeof existing.permissions === 'object') {
        currentPerms = existing.permissions;
      }
      mergedPermissions = { ...currentPerms, ...payload.permissions };
    }

    await this.db
      .updateTable('delivery_representatives')
      .set({
        name,
        phone: payload.phone || null,
        full_name: payload.fullName !== undefined ? payload.fullName || null : undefined,
        national_id: payload.nationalId !== undefined ? payload.nationalId || null : undefined,
        address: payload.address !== undefined ? payload.address || null : undefined,
        vehicle_plate: payload.vehiclePlate !== undefined ? payload.vehiclePlate || null : undefined,
        pin_hash: updatePinRecord ? updatePinRecord.hash : undefined,
        pin_salt: updatePinRecord ? updatePinRecord.salt : undefined,
        rep_type: payload.repType !== undefined ? payload.repType : undefined,
        is_van_rep: isVanRep !== undefined ? isVanRep : undefined,
        is_active: payload.isActive !== undefined ? payload.isActive : undefined,
        ...(mergedPermissions !== undefined ? { permissions: mergedPermissions } : {}),
        ...(mergedMetadata !== undefined ? { metadata: mergedMetadata } : {}),
        updated_at: sql`NOW()`,
      })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();

    await this.audit.log('تعديل مندوب توصيل', `تم تعديل المندوب #${id} بواسطة ${actor.username}`, actor);
    return this.list(actor);
  }

  async remove(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const existing = await this.db
      .selectFrom('delivery_representatives')
      .select(['id'])
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!existing) throw new AppError('Delivery representative not found', 'NOT_FOUND', 404);

    await this.db
      .updateTable('delivery_representatives')
      .set({ is_active: false, updated_at: sql`NOW()` })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();

    await this.audit.log('حذف مندوب توصيل', `تم تعطيل المندوب #${id} بواسطة ${actor.username}`, actor);
    return this.list(actor);
  }
}
