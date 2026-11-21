import { Kysely } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { EGYPTIAN_MASTER_DRUGS } from '../data/egyptian-master-drugs.data';

export class DashboardSlice {
  constructor(private readonly db: Kysely<Database>) {}

  // -------------------------------------------------------------
  // 8. PHARMACY DASHBOARD STATS
  // -------------------------------------------------------------
  async getDashboardStats(auth: AuthContext) {
    const scope = requireTenantScope(auth);

    const [drugsCountRes, shortagesCountRes, activeRxCountRes, batchesRes] = await Promise.all([
      this.db
        .selectFrom('pharmacy_drugs')
        .where('tenant_id', '=', scope.tenantId)
        .select((eb) => eb.fn.count('id').as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('pharmacy_shortages')
        .where('tenant_id', '=', scope.tenantId)
        .where('status', '=', 'needed')
        .select((eb) => eb.fn.count('id').as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('pharmacy_prescriptions')
        .where('tenant_id', '=', scope.tenantId)
        .where('status', '=', 'dispensed')
        .select((eb) => eb.fn.count('id').as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('pharmacy_batches')
        .where('tenant_id', '=', scope.tenantId)
        .select((eb) => [eb.fn.count('id').as('total')])
        .executeTakeFirst(),
    ]);

    return {
      totalDrugs: Number(drugsCountRes?.count || 0),
      neededShortages: Number(shortagesCountRes?.count || 0),
      dispensedPrescriptions: Number(activeRxCountRes?.count || 0),
      totalBatches: Number(batchesRes?.total || 0),
      masterDrugsCatalogSize: EGYPTIAN_MASTER_DRUGS.length,
    };
  }
}
