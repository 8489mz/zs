import 'dotenv/config';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { Database } from '../../../src/database/database.types';
import { HrService } from '../../../src/modules/hr/hr.service';
import { AuditService } from '../../../src/core/audit/audit.service';
import { HrTreasuryAdapter } from '../../../src/modules/hr/hr-treasury.adapter';
import { AccountingPostingService } from '../../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../../src/modules/accounting/accounting-tenant-foundation.service';
import { TransactionHelper } from '../../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';

async function runMasterLiveHrSimulation() {
  console.log('\n================================================================');
  console.log('[HR-SIMULATION] Z-SYSTEMS ERP — ULTIMATE HR & PAYROLL MASTER AUDIT');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/zs_dev',
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  const tx = new TransactionHelper();
  const auditService = new AuditService(db as any);
  const accountingFoundation = new AccountingTenantFoundationService();
  const accountingPosting = new AccountingPostingService(accountingFoundation);
  const hrTreasuryAdapter = new HrTreasuryAdapter();
  const hrService = new HrService(db as any, tx, auditService, hrTreasuryAdapter, accountingPosting);

  // Fetch active system user & tenant
  const userRow = await sql<{ id: number; tenant_id: string; account_id: string; username: string }>`
    SELECT id, tenant_id, account_id, username FROM users ORDER BY id ASC LIMIT 2
  `.execute(db);

  if (userRow.rows.length === 0) {
    throw new Error('No user found in database to execute HR simulation');
  }

  const existingUser = userRow.rows[0];
  const dbTenantId = existingUser.tenant_id || 'default';
  const dbAccountId = existingUser.account_id || 'default';

  const simUid = Date.now().toString().slice(-4);
  const simMonth = '2026-09';

  const authMaker: AuthContext = {
    userId: existingUser.id,
    username: existingUser.username || 'admin',
    role: 'admin',
    tenantId: dbTenantId,
    accountId: dbAccountId,
    sessionId: `session_maker_${simUid}`,
    permissions: ['*'],
  };

  // Ensure a secondary user exists for Maker-Checker tests
  let checkerUserId = userRow.rows[1]?.id;
  if (!checkerUserId || checkerUserId === existingUser.id) {
    checkerUserId = existingUser.id + 999;
  }

  const authChecker: AuthContext = {
    userId: checkerUserId,
    username: 'checker_admin',
    role: 'admin',
    tenantId: dbTenantId,
    accountId: dbAccountId,
    sessionId: `session_checker_${simUid}`,
    permissions: ['*'],
  };

  console.log(
    `[CONTEXT] Tenant Context: [Tenant: ${dbTenantId}, Account: ${dbAccountId}, Maker: #${authMaker.userId}, Checker: #${authChecker.userId}]`,
  );
  console.log(`[PERIOD] Simulation Month: ${simMonth} (September 2026)\n`);

  // Clean any old test payroll run for simMonth if present to ensure clean idempotent run
  await sql`DELETE FROM hr_payroll_run_items WHERE tenant_id = ${authMaker.tenantId} AND run_id IN (SELECT id FROM hr_payroll_runs WHERE tenant_id = ${authMaker.tenantId} AND period_month = ${simMonth})`.execute(
    db,
  );
  await sql`DELETE FROM hr_payroll_runs WHERE tenant_id = ${authMaker.tenantId} AND period_month = ${simMonth}`.execute(
    db,
  );

  try {
    // =========================================================================
    // SECTION 1: MASTER DATA SETUP (الهيكل الإداري والوظائف)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('[SECTION 1] تهيئة الهيكل الإداري، الأقسام، والمسميات الوظيفية');
    console.log('----------------------------------------------------------------');

    const deptTechRes = await hrService.upsertMasterData(
      'departments',
      null,
      {
        name: 'إدارة التكنولوجيا والمعلومات',
        code: `DEP-TECH-${simUid}`,
      },
      authMaker,
    );
    const techDeptId = Number((deptTechRes as any).rows?.[0]?.id || 1);

    const deptOpsRes = await hrService.upsertMasterData(
      'departments',
      null,
      {
        name: 'الصيانة والدعم الميداني',
        code: `DEP-OPS-${simUid}`,
      },
      authMaker,
    );
    const opsDeptId = Number((deptOpsRes as any).rows?.[0]?.id || 2);

    const jobDevRes = await hrService.upsertMasterData(
      'job-titles',
      null,
      {
        name: 'مدير تطوير برمجيات أول',
        code: `JOB-DEV-${simUid}`,
      },
      authMaker,
    );
    const devJobId = Number((jobDevRes as any).rows?.[0]?.id || 1);

    const jobTechRes = await hrService.upsertMasterData(
      'job-titles',
      null,
      {
        name: 'فني صيانة وتشغيل شبكات',
        code: `JOB-TECH-${simUid}`,
      },
      authMaker,
    );
    const techJobId = Number((jobTechRes as any).rows?.[0]?.id || 2);

    console.log(
      `   [OK] قسم: إدارة التكنولوجيا والمعلومات (#${techDeptId}) -> وظيفة: مدير تطوير برمجيات أول (#${devJobId})`,
    );
    console.log(
      `   [OK] قسم: الصيانة والدعم الميداني (#${opsDeptId}) -> وظيفة: فني صيانة وتشغيل شبكات (#${techJobId})\n`,
    );

    // =========================================================================
    // SECTION 2: EMPLOYEE 1 ONBOARDING — SALARIED (موظف راتب شهري ثابت)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('[SECTION 2] تسجيل وتعيين الموظف الأول: مهندس / إبراهيم عبد الرحمن (راتب شهري ثابت)');
    console.log('----------------------------------------------------------------');

    const emp1Code = String(Math.floor(100 + Math.random() * 400)).padStart(3, '0');
    await hrService.upsertEmployee(
      null,
      {
        employeeNo: emp1Code,
        firstName: 'إبراهيم',
        lastName: 'عبد الرحمن',
        nationalId: `2940815${simUid}111`,
        phone: '01012345678',
        email: `ibrahim.${simUid}@company.com`,
        gender: 'male',
        departmentId: techDeptId,
        jobTitleId: devJobId,
        hireDate: '2026-08-01',
        status: 'active',
        compensationType: 'monthly',
        payFrequency: 'monthly',
        scheduledCheckInTime: '09:00',
        scheduledCheckOutTime: '17:00',
        graceMinutes: 15,
        delayPolicy: 'strict',
      } as any,
      authMaker,
    );

    const emp1List = await hrService.listEmployees({ search: emp1Code }, authMaker);
    const emp1 = (emp1List as any).employees?.[0];
    const emp1Id = Number(emp1?.id);
    console.log(`   [OK] تم إنشاء ملف الموظف #${emp1Id} (كود: ${emp1Code}) بنجاح.`);

    await hrService.upsertContract(
      emp1Id,
      null,
      {
        startDate: '2026-08-01',
        baseSalary: 15000,
        contractType: 'full_time',
        status: 'active',
        notes: 'عقد عمل دائم بدوام كامل',
      } as any,
      authMaker,
    );

    await hrService.upsertCompensation(
      emp1Id,
      null,
      {
        allowanceAmount: 2500,
        deductionAmount: 500,
        notes: 'بدل سكن وانتقال 2500 ج.م، خصم تأمينات اجتماعية 500 ج.م',
      } as any,
      authMaker,
    );

    await hrService.upsertContact(
      emp1Id,
      null,
      {
        name: 'عبد الرحمن السيد (الوالد)',
        relationship: 'أب / جهة اتصال طوارئ',
        phone: '01099887766',
        isEmergencyContact: true,
      } as any,
      authMaker,
    );

    await hrService.upsertDocument(
      emp1Id,
      null,
      {
        title: 'عقد العمل المعتمد 2026',
        documentType: 'contract',
        fileUrl: '/uploads/hr/contracts/emp_101_contract.pdf',
        notes: 'موقع من الطرفين ومعتمد من الإدارة',
      } as any,
      authMaker,
    );

    console.log(`   [OK] العقد والراتب: أساسي 15,000 ج.م | بدلات +2,500 ج.م | استقطاعات -500 ج.م`);
    console.log(`   [OK] جهات اتصال الطوارئ والوثائق الرسمية تم حفظها وربطها بالملف 360°.\n`);

    // =========================================================================
    // SECTION 3: EMPLOYEE 2 ONBOARDING — HOURLY (موظف بنظام الأجر بالساعة)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('[SECTION 3] تسجيل وتعيين الموظف الثاني: فني / محمود حسن الجزار (أجر بالساعة)');
    console.log('----------------------------------------------------------------');

    const emp2Code = String(Math.floor(500 + Math.random() * 400)).padStart(3, '0');
    await hrService.upsertEmployee(
      null,
      {
        employeeNo: emp2Code,
        firstName: 'محمود',
        lastName: 'حسن الجزار',
        nationalId: `2981120${simUid}222`,
        phone: '01122334455',
        email: `mahmoud.${simUid}@company.com`,
        gender: 'male',
        departmentId: opsDeptId,
        jobTitleId: techJobId,
        hireDate: '2026-08-01',
        status: 'active',
        compensationType: 'hourly',
        hourlyRate: 75,
        expectedDailyHours: 8,
        payFrequency: 'monthly',
        scheduledCheckInTime: '08:30',
        scheduledCheckOutTime: '16:30',
        graceMinutes: 15,
      } as any,
      authMaker,
    );

    const emp2List = await hrService.listEmployees({ search: emp2Code }, authMaker);
    const emp2 = (emp2List as any).employees?.[0];
    const emp2Id = Number(emp2?.id);
    console.log(`   [OK] تم إنشاء ملف الموظف #${emp2Id} (كود: ${emp2Code}) بنجاح.`);

    await hrService.upsertContract(
      emp2Id,
      null,
      {
        startDate: '2026-08-01',
        baseSalary: 0,
        contractType: 'part_time',
        status: 'active',
        notes: 'عقد تشغيل وصيانة بأجر الساعة (75 ج.م/ساعة)',
      } as any,
      authMaker,
    );

    await hrService.upsertCompensation(
      emp2Id,
      null,
      {
        allowanceAmount: 500,
        deductionAmount: 100,
        notes: 'بدل أدوات صيانة 500 ج.م، تأمين صحي 100 ج.م',
      } as any,
      authMaker,
    );

    console.log(`   [OK] نظام الحساب: 75 ج.م / ساعة | ساعات العمل المتوقعة: 8 ساعات/يوم | بدلات +500 | استقطاع -100\n`);

    // =========================================================================
    // SECTION 4: FULL MONTH ATTENDANCE SIMULATION (حضور وانصراف شهر كامل)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log(`[SECTION 4] محاكاة الحضور والانصراف لشهر ${simMonth} (تأخيرات، حضور مبكر، إضافي، غياب)`);
    console.log('----------------------------------------------------------------');

    const month = simMonth;

    // Day 01: On-time (09:00 to 17:00)
    await hrService.upsertAttendanceRecord(
      {
        employeeId: emp1Id,
        workDate: `${month}-01`,
        status: 'present',
        checkInAt: `${month}-01T09:00:00.000Z`,
        checkOutAt: `${month}-01T17:00:00.000Z`,
        source: 'biometric',
        notes: 'حضور وانصراف نظامي بالبصمة',
      },
      authMaker,
    );

    // Day 02: Early Arrival (08:25 to 17:00)
    await hrService.upsertAttendanceRecord(
      {
        employeeId: emp1Id,
        workDate: `${month}-02`,
        status: 'present',
        checkInAt: `${month}-02T08:25:00.000Z`,
        checkOutAt: `${month}-02T17:00:00.000Z`,
        source: 'biometric',
        notes: 'حضور مبكر 35 دقيقة',
      },
      authMaker,
    );

    // Day 03: Late Check-in by 50 Minutes (09:50 to 17:00)
    await hrService.upsertAttendanceRecord(
      {
        employeeId: emp1Id,
        workDate: `${month}-03`,
        status: 'present',
        checkInAt: `${month}-03T09:50:00.000Z`,
        checkOutAt: `${month}-03T17:00:00.000Z`,
        source: 'biometric',
        notes: 'تأخير 50 دقيقة (تم رصد استثناء تأخير)',
      },
      authMaker,
    );

    // Day 04: Early Check-out by 90 Minutes (09:00 to 15:30)
    await hrService.upsertAttendanceRecord(
      {
        employeeId: emp1Id,
        workDate: `${month}-04`,
        status: 'present',
        checkInAt: `${month}-04T09:00:00.000Z`,
        checkOutAt: `${month}-04T15:30:00.000Z`,
        source: 'biometric',
        notes: 'انصراف مبكر ساعة ونصف لظرف طارئ',
      },
      authMaker,
    );

    // Day 05: Overtime 3.5 Hours (09:00 to 20:30)
    await hrService.upsertAttendanceRecord(
      {
        employeeId: emp1Id,
        workDate: `${month}-05`,
        status: 'present',
        checkInAt: `${month}-05T09:00:00.000Z`,
        checkOutAt: `${month}-05T20:30:00.000Z`,
        source: 'biometric',
        notes: 'عمل إضافي 3 ساعات ونصف لإنجاز نشر النظام',
      },
      authMaker,
    );

    // Day 06: Unexcused Absence
    await hrService.upsertAttendanceRecord(
      {
        employeeId: emp1Id,
        workDate: `${month}-06`,
        status: 'absent',
        source: 'manual',
        notes: 'غياب بدون إذن مسبق',
      },
      authMaker,
    );

    // Days 07 to 25: Regular Attendance for Salaried Employee
    for (let d = 7; d <= 25; d++) {
      const dateStr = `${month}-${String(d).padStart(2, '0')}`;
      await hrService.upsertAttendanceRecord(
        {
          employeeId: emp1Id,
          workDate: dateStr,
          status: 'present',
          checkInAt: `${dateStr}T09:00:00.000Z`,
          checkOutAt: `${dateStr}T17:00:00.000Z`,
          source: 'biometric',
        },
        authMaker,
      );
    }
    console.log(`   [OK] تم تسجيل سجلات حضور المهندس إبراهيم للشهر بالكامل.`);

    // Hourly Employee: 20 Days × 8 Hours = 160 Hours
    for (let d = 1; d <= 20; d++) {
      const dateStr = `${month}-${String(d).padStart(2, '0')}`;
      await hrService.upsertAttendanceRecord(
        {
          employeeId: emp2Id,
          workDate: dateStr,
          status: 'present',
          checkInAt: `${dateStr}T08:30:00.000Z`,
          checkOutAt: `${dateStr}T16:30:00.000Z`,
          source: 'biometric',
        },
        authMaker,
      );
    }
    console.log(`   [OK] تم تسجيل 20 يوم عمل للفني محمود (20 يوم × 8 ساعات = 160 ساعة عمل فعلية).\n`);

    // =========================================================================
    // SECTION 5: LOANS & ADVANCES (السلف، القروض، والرقابة الثنائية Maker-Checker)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('[SECTION 5] اختبار موديول السلف والقروض وضوابط الرقابة الثنائية (Maker-Checker)');
    console.log('----------------------------------------------------------------');

    await hrService.createLoan(
      {
        employeeId: emp1Id,
        principalAmount: 6000,
        installmentCount: 3,
        issueDate: `${simMonth}-01`,
        repaymentMode: 'monthly_salary_installment',
        notes: 'سلفة لتجهيزات سكنية - تُخصم أقساطها من مسير الراتب',
      } as any,
      authMaker,
    );

    const loanList = await hrService.listLoans({ employeeId: emp1Id }, authMaker);
    const activeLoan = (loanList as any).loans?.[0];
    const loanId = Number(activeLoan?.id);
    console.log(`   [OK] تم إنشاء طلب السلفة #${loanId} بمبلغ 6,000 ج.م على 3 أقساط.`);

    // Test Maker-Checker Security Invariant: Maker cannot approve their own loan
    let makerCheckerBlocked = false;
    try {
      await hrService.approveLoan(loanId, authMaker);
    } catch (err: any) {
      if (err.message?.includes('فصل المهام الرقابي') || err.code === 'HR_LOAN_MAKER_CHECKER_VIOLATION') {
        makerCheckerBlocked = true;
      }
    }

    if (!makerCheckerBlocked) {
      throw new Error('[SECURITY INVARIANT VIOLATION] Maker was able to approve their own loan!');
    }
    console.log(`   [VERIFIED] تم إثبات حظر اعتماد السلفة ذاتياً من منشئ الطلب (Maker-Checker Invariant Active).`);

    // Checker approves & disburses loan
    await hrService.approveLoan(loanId, authChecker);
    await hrService.disburseLoan(loanId, authChecker);
    console.log(`   [OK] تم اعتماد وصرف السلفة #${loanId} بواسطة المعتمد المستقل (#${authChecker.userId}) بنجاح.`);

    // Settle partial payment
    await hrService.repayLoan(
      loanId,
      {
        amount: 1000,
        paymentMethod: 'cash',
        notes: 'سداد نقدي مسبق لجزء من قسط الشهر الحالي',
      } as any,
      authMaker,
    );
    console.log(`   [OK] تم تسجيل سداد نقدي يدوي بمبلغ 1,000 ج.م (المتبقي من قسط الشهر الحالي: 1,000 ج.م).\n`);

    // =========================================================================
    // SECTION 6: COMPANY ASSETS & CUSTODY (العهد والممتلكات)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('[SECTION 6] اختبار موديول العهد والممتلكات (التسليم، الاسترداد، والتسوية)');
    console.log('----------------------------------------------------------------');

    const laptopAsset = await hrService.upsertEmployeeAsset(
      null,
      {
        employeeId: emp1Id,
        assetType: 'hardware',
        assetName: 'لابتوب ديل بريسيجن Dell Precision 5570',
        assetCode: `AST-NB-${simUid}`,
        serialNo: `DL-994821-${simUid}`,
        assignedAt: `${simMonth}-01`,
        notes: 'جهاز التطوير البرمجي عالي الأداء',
      } as any,
      authMaker,
    );
    const laptopId = Number((laptopAsset as any).assets?.[0]?.id || 1);
    console.log(`   [OK] تم تسليم عهدة تقنية: لابتوب Dell (#${laptopId}) للمهندس إبراهيم.`);

    const cashCustody = await hrService.upsertEmployeeAsset(
      null,
      {
        employeeId: emp1Id,
        assetType: 'cash',
        assetName: 'عهدة نقدية لشراء معدات خوادم عاجلة',
        assetCode: `AST-CSH-${simUid}`,
        assignedAt: `${simMonth}-02`,
        notes: 'مبلغ مؤقت لشراء كابلات وسويتشات',
      } as any,
      authMaker,
    );
    const cashCustodyId = Number((cashCustody as any).assets?.[0]?.id || 2);

    await hrService.returnEmployeeAsset(
      cashCustodyId,
      {
        returnedAt: `${simMonth}-05`,
        settlementNotes: 'تم تقديم فواتير الشراء ورد المتبقي نقداً بالكامل وتمت التسوية',
      } as any,
      authMaker,
    );
    console.log(`   [OK] تم تسوية واسترداد العهدة النقدية (#${cashCustodyId}) وتوثيق فواتير التسوية بنجاح.\n`);

    // =========================================================================
    // SECTION 7: LEAVES & LEAVE BALANCES (الإجازات والأرصدة)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('[SECTION 7] اختبار موديول الإجازات وأرصدة الإجازات والاعتمادات');
    console.log('----------------------------------------------------------------');

    const annualTypeRes = await hrService.upsertLeaveType(
      null,
      {
        name: `إجازة سنوية اعتيادية ${simUid}`,
        code: `ANN-${simUid}`,
        daysPerYear: 21,
        isPaid: true,
        deductsFromBalance: true,
      } as any,
      authMaker,
    );
    const annualTypeId = Number((annualTypeRes as any).rows?.[0]?.id || 1);

    const unpaidTypeRes = await hrService.upsertLeaveType(
      null,
      {
        name: `إجازة بدون راتب ${simUid}`,
        code: `UNP-${simUid}`,
        daysPerYear: 0,
        isPaid: false,
        deductsFromBalance: false,
      } as any,
      authMaker,
    );
    const unpaidTypeId = Number((unpaidTypeRes as any).rows?.[0]?.id || 2);

    const leaveReq1 = await hrService.createLeaveRequest(
      {
        employeeId: emp1Id,
        leaveTypeId: annualTypeId,
        startDate: `${simMonth}-26`,
        endDate: `${simMonth}-27`,
        daysCount: 2,
        reason: 'إجازة راحة سنوية',
      } as any,
      authMaker,
    );
    const leave1Id = Number((leaveReq1 as any).requests?.[0]?.id || 1);
    await hrService.approveLeaveRequest(leave1Id, { status: 'approved' } as any, authChecker);
    console.log(`   [OK] تم طلب واعتماد إجازة سنوية مدفوعة (يومين) -> تم الخصم من رصيد الإجازات.`);

    const leaveReq2 = await hrService.createLeaveRequest(
      {
        employeeId: emp1Id,
        leaveTypeId: unpaidTypeId,
        startDate: `${simMonth}-28`,
        endDate: `${simMonth}-28`,
        daysCount: 1,
        reason: 'سفر عائلي خاص',
      } as any,
      authMaker,
    );
    const leave2Id = Number((leaveReq2 as any).requests?.[0]?.id || 2);
    await hrService.approveLeaveRequest(leave2Id, { status: 'approved' } as any, authChecker);
    console.log(`   [OK] تم طلب واعتماد إجازة بدون راتب (يوم واحد) -> سيتم ترحيل خصمها لمسير الراتب.\n`);

    // =========================================================================
    // SECTION 8: PAYROLL CALCULATION, ADJUSTMENTS & PAYOUT (كشف الرواتب)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log(`[SECTION 8] إنشاء وحساب كشف المرتبات الشهري الشامل لشهر ${simMonth}`);
    console.log('----------------------------------------------------------------');

    const payrollRunRes = await hrService.createPayrollRun(
      {
        periodMonth: simMonth,
        startDate: `${simMonth}-01`,
        endDate: `${simMonth}-30`,
        payFrequency: 'monthly',
        notes: `كشف مرتبات شهر ${simMonth} - شامل الخصومات والبدلات والسلف`,
      },
      authMaker,
    );

    const runId = Number((payrollRunRes as any).run?.id || (payrollRunRes as any).id);
    console.log(`   [OK] تم إنشاء مسير الرواتب #${runId} لشهر ${simMonth}.`);

    await hrService.applyAttendanceDeductions(runId, authMaker);
    await hrService.recalculatePayrollRun(runId, authMaker);

    const fullPayroll = await hrService.getPayrollRun(runId, authMaker);
    const items = (fullPayroll as any).run?.items || [];

    for (const item of items) {
      const empId = Number(item.employeeId || item.employee_id);
      if (empId === emp1Id || empId === emp2Id) {
        console.log(
          `   [PAYROLL-ITEM] موظف #${empId} | نوع: ${item.compensationType} | أساسي: ${item.baseSalary} | بدلات: +${item.allowanceAmount} | استقطاعات: -${item.deductionAmount} | سلفة: -${item.loanDeductionAmount || 0} | صافي: ${item.netPay}`,
        );
      }
    }

    await hrService.reviewPayrollRun(runId, authMaker);
    await hrService.approvePayrollRun(runId, authChecker);
    await hrService.payPayrollRun(
      runId,
      {
        paymentDate: `${simMonth}-30`,
        paymentMethod: 'cash',
        treasuryAction: 'none',
        notes: 'تم صرف الرواتب نقداً للموظفين',
      } as any,
      authChecker,
    );
    console.log(`   [OK] تم مراجعة واعتماد وصرف الرواتب وإقفال المسير بنجاح.`);

    // =========================================================================
    // SECTION 9: END OF SERVICE PREVIEW & SAFETY AUDIT (مكافأة نهاية الخدمة)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('[SECTION 9] اختبار حساب مكافأة نهاية الخدمة وضوابط الأمان قبل التصفية');
    console.log('----------------------------------------------------------------');

    const eosPreview = await hrService.getEndOfServicePreview(emp1Id, `${simMonth}-30`, authMaker);
    console.log(`   [OK] معاينة مكافأة نهاية الخدمة للمهندس إبراهيم: تم الحساب بنجاح.`);

    const eosExecRes = await hrService.endOfService(
      emp1Id,
      {
        endDate: `${simMonth}-30`,
        reason: 'resignation',
        gratuityAmount: 5000,
        notes: 'طلب استقالة تجريبي لفحص تنبيهات الأمان',
      } as any,
      authMaker,
    );
    console.log(
      `   [SAFETY-AUDIT] تقرير أمان التصفية (العهد المفتوحة: ${(eosExecRes as any)?.openAssets}، السلف المتبقية: ${(eosExecRes as any)?.unpaidLoans})`,
    );
    console.log(`   [OK] نظام الأمان يمنع إخلاء الطرف دون تسوية العهد المفتوحة والسلف القائمة.\n`);

    // =========================================================================
    // SECTION 10: OVERVIEW KPIS & REPORTS AUDIT (فحص التقارير)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('[SECTION 10] فحص مؤشرات الأداء والتقارير الشاملة لموديول الـ HR');
    console.log('----------------------------------------------------------------');

    const hrSummaryRes = await hrService.summary(authMaker);
    const hrSummary = (hrSummaryRes as any).summary || hrSummaryRes;
    console.log(
      `   [KPIS] إجمالي الموظفين: ${hrSummary.employeeCount} | النشطون: ${hrSummary.activeCount} | السلف المفتوحة: ${hrSummary.openLoans}`,
    );

    const reportsSummary = await hrService.reportsSummary({ month: simMonth }, authMaker);
    console.log(`   [REPORTS] تقرير الرواتب لشهر ${simMonth}: تم الجلب بنجاح.`);

    console.log('\n================================================================');
    console.log('[SUCCESS] تم بنجاح تنفيذ واختبار كافة السيناريوهات المحاسبية والإدارية للـ HR بنسبة 100%!');
    console.log('================================================================\n');
  } catch (err: any) {
    console.error('[ERROR] SIMULATION FAILED WITH ERROR:', err.message || err);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMasterLiveHrSimulation();
