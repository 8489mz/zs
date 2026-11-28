import type { Kysely, Transaction } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { loadAntiTheftSettings } from '../../../common/utils/anti-theft-settings.util';
import { authorizeManagerSecret, isSoloAdminOverride } from '../../../common/utils/manager-approval';
import type { WhatsAppAlertPort } from '../../../common/utils/whatsapp-alert.port';

type DbOrTx = Kysely<Database> | Transaction<Database>;

export async function assertWriteOffManagerPassword(
  trx: DbOrTx,
  auth: AuthContext,
  secret: string | undefined,
  messages: { requiredMsg: string; requiredCode: string; passwordOnlyMsg: string; passwordOnlyCode: string },
): Promise<{ authorizedById: number | null; authorizedByName: string }> {
  const normalized = String(secret || '').trim();
  if (!normalized) {
    throw new AppError(messages.requiredMsg, messages.requiredCode, 403);
  }
  const approval = await authorizeManagerSecret(trx, auth, normalized);
  if (approval.mode !== 'account' || !approval.authorizedById) {
    throw new AppError(messages.passwordOnlyMsg, messages.passwordOnlyCode, 403);
  }
  return { authorizedById: approval.authorizedById, authorizedByName: approval.authorizedByName };
}

export async function resolveTransferAntiTheftContext(
  trx: DbOrTx,
  tenantId: string,
  payload: {
    carrierEmployeeId?: number;
    carrierName?: string;
    recipientName?: string;
    managerPin?: string;
  },
  hasDestinationLocation: boolean,
  issueMode: 'transfer_to_branch_stock' | 'final_issue',
  auth: AuthContext,
): Promise<{
  effectiveIssueMode: 'transfer_to_branch_stock' | 'final_issue';
  carrierEmployeeId: number | null;
  carrierName: string | null;
}> {
  const antiTheft = await loadAntiTheftSettings(trx, tenantId);
  const effectiveIssueMode =
    antiTheft.strictTwoStepTransfers && hasDestinationLocation && issueMode === 'final_issue'
      ? 'transfer_to_branch_stock'
      : issueMode;

  if (
    effectiveIssueMode === 'final_issue' &&
    !hasDestinationLocation &&
    antiTheft.requireManagerForWriteOff &&
    auth.role !== 'admin' &&
    auth.role !== 'super_admin'
  ) {
    await assertWriteOffManagerPassword(trx, auth, payload.managerPin, {
      requiredMsg: 'الصرف النهائي من المخزون يتطلب اعتماد مدير محدد (درع منع السرقة مفعّل)',
      requiredCode: 'FINAL_ISSUE_APPROVAL_REQUIRED',
      passwordOnlyMsg: 'اعتماد الصرف النهائي يتطلب كلمة مرور مدير محدد وليس رمزاً مشتركاً',
      passwordOnlyCode: 'FINAL_ISSUE_APPROVAL_REQUIRED',
    });
  }

  const carrierEmployeeId = payload.carrierEmployeeId ? Number(payload.carrierEmployeeId) : null;
  let carrierName = String(payload.carrierName || payload.recipientName || '').trim() || null;
  if (carrierEmployeeId && !carrierName) {
    const emp = await trx
      .selectFrom('users')
      .select(['username', 'display_name'])
      .where('id', '=', carrierEmployeeId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (emp) carrierName = String(emp.display_name || emp.username || '').trim() || null;
  }

  return { effectiveIssueMode, carrierEmployeeId, carrierName };
}

export async function assertTransferMakerChecker(
  trx: DbOrTx,
  tenantId: string,
  createdBy: number | null | undefined,
  auth: AuthContext,
): Promise<void> {
  const antiTheft = await loadAntiTheftSettings(trx, tenantId);
  if (antiTheft.strictTwoStepTransfers && createdBy != null && Number(createdBy) === Number(auth.userId)) {
    const soloAdmin = await isSoloAdminOverride(trx, tenantId, auth);
    if (!soloAdmin) {
      throw new AppError(
        'لا يجوز لمن أنشأ إذن التحويل استلامه بنفسه؛ يجب الاستلام من مستخدم آخر (فصل المهام مفعّل)',
        'TRANSFER_SELF_RECEIVE_FORBIDDEN',
        403,
      );
    }
  }
}

export async function loadCategoryStockItemsForTwoStep(
  db: DbOrTx,
  tenantId: string,
  categoryId: number,
  fromLocationId: number,
): Promise<Array<{ productId: number; qty: number }>> {
  const antiTheft = await loadAntiTheftSettings(db, tenantId);
  if (!antiTheft.strictTwoStepTransfers) return [];
  const stocks = await db
    .selectFrom('product_location_stock as pls')
    .innerJoin('products as p', (join) =>
      join.onRef('p.id', '=', 'pls.product_id').onRef('p.tenant_id', '=', 'pls.tenant_id'),
    )
    .select(['pls.product_id', 'pls.qty'])
    .where('p.category_id', '=', categoryId)
    .where('pls.location_id', '=', fromLocationId)
    .where('pls.qty', '>', 0)
    .where('p.tenant_id', '=', tenantId)
    .execute();
  if (stocks.length === 0) {
    throw new AppError('No stock found for this category in the source location', 'NO_STOCK', 400);
  }
  return stocks.map((s) => ({ productId: Number(s.product_id), qty: Number(s.qty) }));
}

export async function sendTransferShortageWhatsAppAlert(
  db: Kysely<Database>,
  whatsappService: WhatsAppAlertPort | undefined,
  tenantId: string,
  meta: { docNo: string; carrierName: string; totalShortfallQty: number; varianceReason: string; receiverName: string },
): Promise<void> {
  if (!whatsappService) return;
  const tenant = await db
    .selectFrom('tenants')
    .select(['business_name', 'owner_phone'])
    .where('id', '=', tenantId)
    .executeTakeFirst();
  if (!tenant?.owner_phone) return;
  const text =
    `*درع منع الخسائر - إنذار فاقد/عجز في تحويل مخزني*\n` +
    `*${tenant.business_name || 'إدارة المخازن'}*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `رقم الإذن: *${meta.docNo}*\n` +
    `المستلم: ${meta.receiverName}\n` +
    (meta.carrierName ? `الناقل / حامل البضاعة: *${meta.carrierName}*\n` : '') +
    `إجمالي الكمية المفقودة: *${meta.totalShortfallQty}*\n` +
    `السبب المسجل: ${meta.varianceReason}\n\n` +
    `_يرجى المراجعة الفورية مع أمين المخزن والناقل._`;
  await whatsappService.sendRawMessage(tenantId, tenant.owner_phone, text);
}

export async function sendDamageWhatsAppAlert(
  db: Kysely<Database>,
  whatsappService: WhatsAppAlertPort | undefined,
  tenantId: string,
  meta: {
    productName: string;
    locationName: string;
    qty: number;
    totalCost: number;
    reason: string;
    note: string;
    actorName: string;
    approvedByName?: string;
  },
): Promise<void> {
  if (!whatsappService) return;
  const tenant = await db
    .selectFrom('tenants')
    .select(['business_name', 'owner_phone'])
    .where('id', '=', tenantId)
    .executeTakeFirst();
  if (!tenant?.owner_phone) return;
  const text =
    `*درع منع الخسائر - إنذار تسجيل تالف/هالك مخزني*\n` +
    `*${tenant.business_name || 'إدارة المخازن'}*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `الصنف: *${meta.productName}*\n` +
    `المخزن: ${meta.locationName}\n` +
    `الكمية: *${meta.qty}*\n` +
    `التكلفة: *${meta.totalCost.toLocaleString('en-US')}*\n` +
    `المسجل: ${meta.actorName}\n` +
    (meta.approvedByName ? `المعتمد: ${meta.approvedByName}\n` : '') +
    `السبب: ${meta.note || meta.reason}\n\n` +
    `_يرجى التحقق من البضاعة التالفة فعلياً._`;
  await whatsappService.sendRawMessage(tenantId, tenant.owner_phone, text);
}

export async function generateStockTransferDocNo(trx: DbOrTx, transferId: number, tenantId: string): Promise<string> {
  const settingRow = await trx
    .selectFrom('settings')
    .select(['value'])
    .where('key', '=', 'invoiceNumberingScheme')
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  let scheme = 'daily';
  if (settingRow?.value) {
    try {
      scheme = JSON.parse(settingRow.value);
    } catch {
      scheme = String(settingRow.value);
    }
  }
  if (scheme === 'sequential') return `ZTR-${transferId}`;
  const now = new Date();
  const datePrefix = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `ZTR-${datePrefix}-${String(transferId).padStart(4, '0')}`;
}

export function groupTransferItemsByTransfer(
  items: Array<{
    id: unknown;
    transfer_id: unknown;
    product_id: unknown;
    product_name?: unknown;
    qty?: unknown;
    serial_tracking?: unknown;
    batch_tracking?: unknown;
  }>,
): Map<string, Record<string, unknown>[]> {
  const byTransfer = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const key = String(item.transfer_id);
    if (!byTransfer.has(key)) byTransfer.set(key, []);
    const serialTracking: unknown =
      typeof item.serial_tracking === 'string' ? JSON.parse(item.serial_tracking) : item.serial_tracking;
    const batchTracking: unknown =
      typeof item.batch_tracking === 'string' ? JSON.parse(item.batch_tracking) : item.batch_tracking;
    byTransfer.get(key)!.push({
      id: String(item.id),
      productId: String(item.product_id),
      productName: item.product_name || '',
      qty: Number(item.qty || 0),
      serialTracking: Array.isArray(serialTracking) ? serialTracking : [],
      batchTracking: Array.isArray(batchTracking) ? batchTracking : [],
    });
  }
  return byTransfer;
}
