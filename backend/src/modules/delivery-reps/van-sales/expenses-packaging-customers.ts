import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { VanExpensesPackagingCustomersService } from '../services/van-expenses-packaging-customers.service';
import type {
  CreateDriverCustomerBody,
  RecordPackagingMovementPayload,
  RecordTripExpensePayload,
} from './van-sales-types';

export class ExpensesPackagingCustomersService {
  constructor(private readonly getExpensesPackagingCustomers: () => VanExpensesPackagingCustomersService) {}
  async recordTripExpense(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: RecordTripExpensePayload,
    authContext?: AuthContext,
  ): Promise<{ ok: boolean; expenseId: number; totalTripExpenses: number }> {
    return this.getExpensesPackagingCustomers().recordTripExpense(repId, tenantId, accountId, payload, authContext);
  }

  async getTripExpenses(tripId: number, tenantId: string, repId?: number) {
    return this.getExpensesPackagingCustomers().getTripExpenses(tripId, tenantId, repId);
  }

  async recordPackagingMovement(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: RecordPackagingMovementPayload,
  ): Promise<{ ok: boolean; movementId: number }> {
    return this.getExpensesPackagingCustomers().recordPackagingMovement(repId, tenantId, accountId, payload);
  }

  async getTripPackagingMovements(tripId: number, tenantId: string, repId?: number) {
    return this.getExpensesPackagingCustomers().getTripPackagingMovements(tripId, tenantId, repId);
  }

  async getCustomerPackagingBalance(customerId: number, tenantId: string, repId?: number) {
    return this.getExpensesPackagingCustomers().getCustomerPackagingBalance(customerId, tenantId, repId);
  }

  async createDriverCustomer(repId: number, tenantId: string, accountId: string, body: CreateDriverCustomerBody) {
    return this.getExpensesPackagingCustomers().createDriverCustomer(repId, tenantId, accountId, body);
  }

  async getCustomerSuggestedOrder(tenantId: string, accountId: string, repId: number, customerId: number) {
    return this.getExpensesPackagingCustomers().getCustomerSuggestedOrder(tenantId, accountId, repId, customerId);
  }

  async getCustomerLastSoldPrices(tenantId: string, customerId: number, repId?: number) {
    return this.getExpensesPackagingCustomers().getCustomerLastSoldPrices(tenantId, customerId, repId);
  }

  async getCustomerFieldStatement(tenantId: string, customerId: number, repId?: number) {
    return this.getExpensesPackagingCustomers().getCustomerFieldStatement(tenantId, customerId, repId);
  }
}
