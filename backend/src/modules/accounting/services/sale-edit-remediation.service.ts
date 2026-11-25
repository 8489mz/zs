import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../../database/database.constants';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits } from '../engines/money-minor-units.engine';
import { AccountingPostingService } from '../accounting-posting.service';
import { runSaleEditRemediation, type SaleEditRepairReport } from '../remediation/sale-edit-remediation-repair.engine';

/**
 * Rank 7, sub-package 7d: the only wiring over the sale-edit
 * remediation engines. The engines were complete and tested but had
 * no caller — no service, controller, CLI, or scheduled job ran them.
 *
 * The two operations are deliberately asymmetric:
 *
 * - `discover` is read-only. It always runs in dry-run mode and
 *   writes nothing, so it is safe to call freely.
 * - `apply` posts reversal journals for real money. It requires an
 *   explicit, reviewed sale list AND an explicit confirmation flag,
 *   re-discovers immediately before repairing so a sale that changed
 *   since the dry-run report is never repaired blindly, and never
 *   runs without a root connection (the engine enforces per-sale
 *   transactions itself). There is no scheduled or automatic apply
 *   anywhere: every repair is a named human decision, per tenant.
 */
@Injectable()
export class SaleEditRemediationService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly posting: AccountingPostingService,
  ) {}

  /** Dry-run discovery report for the caller's tenant. Writes nothing. */
  async discover(auth: AuthContext): Promise<SaleEditRepairReport> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    return runSaleEditRemediation(this.db, this.posting, auth, {
      tenantId: scope.tenantId,
      bookDigits,
      mode: 'dry_run',
    });
  }

  /**
   * Apply reversals for exactly the reviewed sale ids. `confirm` must
   * be literally true and `saleIds` non-empty; anything else is a
   * caller error, never a silent no-op. Sale ids that are no longer
   * candidates at apply time are reported as `unmatchedSaleIds` and
   * never repaired.
   */
  async apply(
    auth: AuthContext,
    input: { saleIds: unknown; runId?: unknown; confirm: unknown },
  ): Promise<SaleEditRepairReport & { unmatchedSaleIds: number[] }> {
    if (input.confirm !== true) {
      throw new BadRequestException(
        'Sale-edit remediation apply requires explicit confirmation (confirm: true) with a reviewed sale list.',
      );
    }
    const saleIds = this.validatedSaleIds(input.saleIds);
    const runId = typeof input.runId === 'string' && input.runId.trim() !== '' ? input.runId.trim() : undefined;

    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const report = await runSaleEditRemediation(this.db, this.posting, auth, {
      tenantId: scope.tenantId,
      bookDigits,
      mode: 'apply',
      saleIds,
      runId,
    });
    const matched = new Set(report.items.map((item) => item.saleId));
    return { ...report, unmatchedSaleIds: saleIds.filter((id) => !matched.has(id)) };
  }

  private validatedSaleIds(value: unknown): number[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException('Sale-edit remediation apply requires a non-empty saleIds list.');
    }
    const ids = value.map((id) => Number(id));
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new BadRequestException('saleIds must be positive integers.');
    }
    return [...new Set(ids)].sort((a, b) => a - b);
  }
}
