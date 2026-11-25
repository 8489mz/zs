import { sql, type Kysely } from '../../../../database/kysely';
import { listSupportedDemoActivities } from '../demo-datasets';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';

export class SettingsDemoDataStatus {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: {
      scope: (actor: AuthContext) => { tenantId: string; accountId: string };
    },
  ) {}

  private scope(actor: AuthContext): { tenantId: string; accountId: string } {
    return this.bound.scope(actor);
  }

  async getDemoDataStatus(actor: AuthContext): Promise<{ isEmpty: boolean; productCount: number; saleCount: number; isSuperAdmin: boolean }> {
    const scope = this.scope(actor);
    const productCountRes = await this.db
      .selectFrom('products')
      .select(this.db.fn.count('id').as('cnt'))
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    const saleCountRes = await this.db
      .selectFrom('sales')
      .select(this.db.fn.count('id').as('cnt'))
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();

    const productCount = Number(productCountRes?.cnt || 0);
    const saleCount = Number(saleCountRes?.cnt || 0);
    const isEmpty = productCount === 0 && saleCount === 0;
    const isSuperAdmin = actor.role === 'super_admin';

    return {
      isEmpty,
      productCount,
      saleCount,
      isSuperAdmin,
    };
  }

  listActivities() {
    return listSupportedDemoActivities();
  }
}
