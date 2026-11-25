import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { Database } from '../../../../database/database.types';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';

export class DeleteChequeSlice {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Delete cheque record (safe guards prevent deleting settled cheques or cheques with financial postings)
   */
  async deleteCheque(authContext: AuthContext, id: number): Promise<{ success: boolean }> {
    const tenantId = String(authContext.tenantId || '');

    return this.db.transaction().execute(async (trx: any) => {
      const existing = await trx
        .selectFrom('accounting_cheques')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .selectAll()
        .forUpdate()
        .executeTakeFirst();

      if (!existing) {
        throw new NotFoundException('الشيك غير موجود');
      }

      if (['collected', 'cleared', 'endorsed'].includes(existing.status)) {
        throw new BadRequestException('لا يمكن حذف شيك تم تحصيله أو صرفه أو تظهيره، يمكنك إلغاؤه بدلاً من ذلك');
      }

      if (existing.journal_entry_id) {
        throw new BadRequestException(
          'لا يمكن حذف شيك له قيود محاسبية مسجلة، قم بإلغاء الشيك للحفاظ على التسلسل المالي',
        );
      }

      await trx.deleteFrom('accounting_cheques').where('tenant_id', '=', tenantId).where('id', '=', id).execute();

      return { success: true };
    });
  }
}
