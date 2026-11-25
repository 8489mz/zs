import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';

@Injectable()
export class HrTreasuryAdapter {
  async recordLoanDisbursement(
    db: Kysely<Database>,
    loan: { id: number; amount: number; employeeName: string; branchId: number | null; locationId: number | null },
    auth: AuthContext,
  ): Promise<void> {
    const scope = requireTenantScope(auth);
    await sql`
      INSERT INTO treasury_transactions (
        txn_type, amount, note, reference_type, reference_id, branch_id, location_id, created_by, tenant_id, account_id
      )
      VALUES (
        'cash_out',
        ${-Math.abs(Number(loan.amount || 0))},
        ${`Employee advance/loan paid: ${loan.employeeName}`},
        'hr_employee_loan',
        ${loan.id},
        ${loan.branchId},
        ${loan.locationId},
        ${auth.userId},
        ${scope.tenantId},
        ${scope.accountId}
      )
    `.execute(db);
  }

  async recordLoanRepayment(
    db: Kysely<Database>,
    repayment: {
      ledgerId: number;
      loanId: number;
      amount: number;
      employeeName: string;
      branchId: number | null;
      locationId: number | null;
    },
    auth: AuthContext,
  ): Promise<void> {
    const scope = requireTenantScope(auth);
    await sql`
      INSERT INTO treasury_transactions (
        txn_type, amount, note, reference_type, reference_id, branch_id, location_id, created_by, tenant_id, account_id
      )
      VALUES (
        'cash_in',
        ${Math.abs(Number(repayment.amount || 0))},
        ${`Employee loan repayment: ${repayment.employeeName} / loan #${repayment.loanId}`},
        'hr_employee_loan_repayment',
        ${repayment.ledgerId},
        ${repayment.branchId},
        ${repayment.locationId},
        ${auth.userId},
        ${scope.tenantId},
        ${scope.accountId}
      )
    `.execute(db);
  }

  async recordPayrollPayment(
    db: Kysely<Database>,
    payment: { runId: number; amount: number; branchId: number | null; locationId: number | null },
    auth: AuthContext,
  ): Promise<void> {
    const scope = requireTenantScope(auth);
    await sql`
      INSERT INTO treasury_transactions (
        txn_type, amount, note, reference_type, reference_id, branch_id, location_id, created_by, tenant_id, account_id
      )
      VALUES (
        'cash_out',
        ${-Math.abs(Number(payment.amount || 0))},
        ${`Payroll payment for run #${payment.runId}`},
        'hr_payroll_payment',
        ${payment.runId},
        ${payment.branchId},
        ${payment.locationId},
        ${auth.userId},
        ${scope.tenantId},
        ${scope.accountId}
      )
    `.execute(db);
  }
}
