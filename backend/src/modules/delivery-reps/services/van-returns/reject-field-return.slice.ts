import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';

export class RejectFieldReturnSlice {
  constructor(private readonly db: Kysely<Database>) {}

  private get anyDb(): any {
    return this.db;
  }

  /**
   * Rejects a pending field return with a reason.
   */
  async rejectFieldReturn(tenantId: string, returnId: number, rejectionReason: string, rejectedByUserId: number) {
    const ret = await this.anyDb
      .selectFrom('van_field_returns')
      .select(['id', 'status'])
      .where('id', '=', returnId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!ret) throw new AppError('طلب المرتجع غير موجود', 'RETURN_NOT_FOUND', 404);
    if (ret.status !== 'pending_approval') {
      throw new AppError(`طلب المرتجع تمت معالجته بالفعل بحالة (${ret.status})`, 'RETURN_ALREADY_PROCESSED', 400);
    }

    await this.anyDb
      .updateTable('van_field_returns')
      .set({
        status: 'rejected',
        rejection_reason: rejectionReason || 'تم الرفض بواسطة الإدارة',
        approved_by: rejectedByUserId,
        approved_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', returnId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, returnId, status: 'rejected' };
  }
}
