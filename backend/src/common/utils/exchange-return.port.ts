import type { Transaction } from '../../database/kysely';
import type { Database } from '../../database/database.types';
import type { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import type { CreateReturnDto } from '../../modules/returns/dto/create-return.dto';
import type { allocateRefundTenders } from '../../modules/returns/engines/refund-tender.engine';
import type { settlePosExchange } from '../../modules/sales/engines/pos-exchange.engine';

/**
 * Phase 1 B7 — the shared exchange-return port
 * (INV-PHASE1-B7-RETURNS-SALES-DECOUPLED).
 *
 * The returns|sales circular pair is broken by extracting the
 * exchange-return execution behind this port: the ExchangeReturnContext
 * type + the ExchangeReturnPort abstract class live here, in the shared
 * layer, so the sales module can prepare + settle an exchange return
 * without importing any returns file. ReturnsService extends the port
 * (its two methods already match the abstract signatures exactly) and
 * ReturnsModule binds it ({ provide: ExchangeReturnPort, useExisting:
 * ReturnsService }) and is @Global(), so SalesModule resolves the
 * port without importing ReturnsModule.
 *
 * The feature-module imports below are type-only (erased at runtime):
 * CreateReturnDto is the prepare payload, the allocateRefundTenders
 * input shape is the context's refundBase field, and settlePosExchange
 * gives the settle return type — so the moved type and the port
 * signatures stay byte-identical to the service's own, with zero
 * runtime coupling from shared to any feature module. The
 * module-boundary method states explicitly that src/common imports
 * are not edges.
 *
 * MOVE, never duplicate: the type + the port exist in exactly one
 * place. returns.types.ts re-exports the type for returns-internal
 * consumers; returns.service.ts re-exports it too.
 */
export interface ExchangeReturnContext {
  returnId: number;
  total: number;
  customerId: number;
  branchId: number | null;
  locationId: number | null;
  refundBase: Omit<Parameters<typeof allocateRefundTenders>[0], 'amount' | 'requested'>;
}

export abstract class ExchangeReturnPort {
  abstract prepareExchangeReturn(
    trx: Transaction<Database>,
    payload: CreateReturnDto,
    auth: AuthContext,
  ): Promise<ExchangeReturnContext>;

  abstract settleExchangeReturn(
    trx: Transaction<Database>,
    context: ExchangeReturnContext,
    saleTotal: number,
    requested: 'cash' | 'card' | 'store_credit',
    auth: AuthContext,
    managerPin?: string,
  ): Promise<ReturnType<typeof settlePosExchange>>;
}
