/*
 * Rep financial ledger (van-sales split-5 out of VanSalesService).
 * Pure move: the 4 controller-called ledger methods
 * (getRepFinancialLedger, settleRepFinancialItem,
 * pushRepShortagesToPayroll, addRepBonusOrCommission) plus the 6
 * private helpers they alone use (waiver-approval gate, custody-leg
 * guard, shortage receiving-shift + cash-row, waiver threshold,
 * linked-user resolution), unchanged, behind the VanSalesService
 * delegating facade. The facade owns the injected services; this
 * service receives them bound via VanRepFinancialLedgerDeps, so the
 * moved bodies are byte-identical to the originals. The Category 1-a
 * date line inside pushRepShortagesToPayroll
 * (`new Date().toISOString().slice(0, 7)`) moves byte-identical —
 * the date fix itself is NOT in slice scope.
 * resolveRepLinkedUserId keeps a facade delegate: S4's
 * recordTripExpense calls it and S1's getTripLifecycle binds it.
 */
import { Kysely } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { Database } from '../../../database/database.types';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { VanRepFinancialLedgerDeps } from './van-rep-financial-ledger/van-rep-financial-ledger.types';
import { GetRepFinancialLedgerSlice } from './van-rep-financial-ledger/get-rep-financial-ledger.slice';
import { SettleRepFinancialItemSlice } from './van-rep-financial-ledger/settle-rep-financial-item.slice';
import { RepWaiverClusterSlice } from './van-rep-financial-ledger/rep-waiver-cluster.slice';
import { RepShortageCustodySlice } from './van-rep-financial-ledger/rep-shortage-custody.slice';
import { PushRepShortagesToPayrollSlice } from './van-rep-financial-ledger/push-rep-shortages-to-payroll.slice';
import { AddRepBonusOrCommissionSlice } from './van-rep-financial-ledger/add-rep-bonus-or-commission.slice';

export class VanRepFinancialLedgerService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly verifySupervisorPin: VanRepFinancialLedgerDeps['verifySupervisorPin'];

  constructor(deps: VanRepFinancialLedgerDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.verifySupervisorPin = deps.verifySupervisorPin;
  }

  private get anyDb(): any {
    return this.db;
  }

  private get ledgerDeps(): VanRepFinancialLedgerDeps {
    return {
      db: this.db,
      audit: this.audit,
      accountingPosting: this.accountingPosting,
      verifySupervisorPin: this.verifySupervisorPin,
    };
  }

  private getRepFinancialLedgerInstance?: GetRepFinancialLedgerSlice;
  private get getRepFinancialLedgerSlice(): GetRepFinancialLedgerSlice {
    return (this.getRepFinancialLedgerInstance ??= new GetRepFinancialLedgerSlice(this.ledgerDeps));
  }

  private settleRepFinancialItemInstance?: SettleRepFinancialItemSlice;
  private get settleRepFinancialItemSlice(): SettleRepFinancialItemSlice {
    return (this.settleRepFinancialItemInstance ??= new SettleRepFinancialItemSlice(this.ledgerDeps, {
      assertRepWaiverApproval: (trxAny, tenantId, accountId, item, payload, actorUserId, auth) =>
        this.waiverClusterSlice.assertRepWaiverApproval(trxAny, tenantId, accountId, item, payload, actorUserId, auth),
      assertRepStockShortageCustodyLeg: (trx, tenantId, item, amount, bookDigits) =>
        this.shortageCustodySlice.assertRepStockShortageCustodyLeg(trx, tenantId, item, amount, bookDigits),
      resolveRepShortageReceivingShift: (trx, params) =>
        this.shortageCustodySlice.resolveRepShortageReceivingShift(trx, params),
      insertRepShortageCashRow: (trx, params) => this.shortageCustodySlice.insertRepShortageCashRow(trx, params),
    }));
  }

  private waiverClusterInstance?: RepWaiverClusterSlice;
  private get waiverClusterSlice(): RepWaiverClusterSlice {
    return (this.waiverClusterInstance ??= new RepWaiverClusterSlice(this.ledgerDeps));
  }

  private shortageCustodyInstance?: RepShortageCustodySlice;
  private get shortageCustodySlice(): RepShortageCustodySlice {
    return (this.shortageCustodyInstance ??= new RepShortageCustodySlice(this.ledgerDeps));
  }

  private pushRepShortagesToPayrollInstance?: PushRepShortagesToPayrollSlice;
  private get pushRepShortagesToPayrollSlice(): PushRepShortagesToPayrollSlice {
    return (this.pushRepShortagesToPayrollInstance ??= new PushRepShortagesToPayrollSlice(this.ledgerDeps));
  }

  private addRepBonusOrCommissionInstance?: AddRepBonusOrCommissionSlice;
  private get addRepBonusOrCommissionSlice(): AddRepBonusOrCommissionSlice {
    return (this.addRepBonusOrCommissionInstance ??= new AddRepBonusOrCommissionSlice(this.ledgerDeps));
  }

  async getRepFinancialLedger(
    tenantId: string,
    filters: {
      repId?: number;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
      businessDay?: string;
    },
  ) {
    return this.getRepFinancialLedgerSlice.getRepFinancialLedger(tenantId, filters);
  }

  async settleRepFinancialItem(
    tenantId: string,
    accountId: string,
    id: number,
    payload: {
      method: 'cash' | 'waiver';
      notes?: string;
      reason?: string;
      supervisorPin?: string;
    },
    authContext: AuthContext,
  ) {
    return this.settleRepFinancialItemSlice.settleRepFinancialItem(tenantId, accountId, id, payload, authContext);
  }

  async resolveRepLinkedUserId(dbConn: any, tenantId: string, repId: number | null): Promise<number | null> {
    return this.waiverClusterSlice.resolveRepLinkedUserId(dbConn, tenantId, repId);
  }

  async pushRepShortagesToPayroll(
    tenantId: string,
    accountId: string,
    payload: {
      settlementIds: number[];
      targetMonth?: string;
    },
    authContext: AuthContext,
  ) {
    return this.pushRepShortagesToPayrollSlice.pushRepShortagesToPayroll(tenantId, accountId, payload, authContext);
  }

  async addRepBonusOrCommission(
    tenantId: string,
    accountId: string,
    payload: {
      repId: number;
      entryType: 'bonus' | 'commission';
      amount: number;
      notes: string;
    },
    authContext: AuthContext,
  ) {
    return this.addRepBonusOrCommissionSlice.addRepBonusOrCommission(tenantId, accountId, payload, authContext);
  }
}
