import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { VanRepFinancialLedgerService } from '../services/van-rep-financial-ledger.service';
import type {
  AddRepBonusOrCommissionPayload,
  GetRepFinancialLedgerFilters,
  PushRepShortagesToPayrollPayload,
  SettleRepFinancialItemPayload,
} from './van-sales-types';

export class RepFinancialLedgerService {
  constructor(private readonly getRepFinancialLedgerService: () => VanRepFinancialLedgerService) {}
  async getRepFinancialLedger(tenantId: string, filters: GetRepFinancialLedgerFilters) {
    return this.getRepFinancialLedgerService().getRepFinancialLedger(tenantId, filters);
  }

  async settleRepFinancialItem(
    tenantId: string,
    accountId: string,
    id: number,
    payload: SettleRepFinancialItemPayload,
    authContext: AuthContext,
  ) {
    return this.getRepFinancialLedgerService().settleRepFinancialItem(tenantId, accountId, id, payload, authContext);
  }

  async resolveRepLinkedUserId(dbConn: any, tenantId: string, repId: number | null): Promise<number | null> {
    return this.getRepFinancialLedgerService().resolveRepLinkedUserId(dbConn, tenantId, repId);
  }

  async pushRepShortagesToPayroll(
    tenantId: string,
    accountId: string,
    payload: PushRepShortagesToPayrollPayload,
    authContext: AuthContext,
  ) {
    return this.getRepFinancialLedgerService().pushRepShortagesToPayroll(tenantId, accountId, payload, authContext);
  }

  async addRepBonusOrCommission(
    tenantId: string,
    accountId: string,
    payload: AddRepBonusOrCommissionPayload,
    authContext: AuthContext,
  ) {
    return this.getRepFinancialLedgerService().addRepBonusOrCommission(tenantId, accountId, payload, authContext);
  }
}
