import { sql } from '../../../../database/kysely';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../../../common/errors/app-error';
import { getDemoDataset, mapIndustryToDemoActivity } from '../demo-datasets';
import { createPasswordRecord } from '../../../../core/auth/utils/password-hasher';
import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { AuditService } from '../../../../core/audit/audit.service';
import type { SeedDemoDataDto, DemoCredential } from './settings-demo-data-shared';

export class SettingsDemoDataSeed {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bound: {
      getDemoDataStatus: (actor: AuthContext) => Promise<{ isEmpty: boolean; productCount: number; saleCount: number; isSuperAdmin: boolean }>;
      scope: (actor: AuthContext) => { tenantId: string; accountId: string };
      assertSuperAdminAndPassword: (password: string, actor: AuthContext) => Promise<void>;
      takeAutoBackup: (actor: AuthContext, reason: string) => Promise<void>;
      wipeAllData: (password: string, actor: AuthContext) => Promise<{ ok: boolean; message: string }>;
    },
  ) {}

  private async getDemoDataStatus(actor: AuthContext): Promise<{ isEmpty: boolean; productCount: number; saleCount: number; isSuperAdmin: boolean }> {
    return this.bound.getDemoDataStatus(actor);
  }

  private scope(actor: AuthContext): { tenantId: string; accountId: string } {
    return this.bound.scope(actor);
  }

  private async assertSuperAdminAndPassword(password: string, actor: AuthContext): Promise<void> {
    return this.bound.assertSuperAdminAndPassword(password, actor);
  }

  private async takeAutoBackup(actor: AuthContext, reason: string): Promise<void> {
    return this.bound.takeAutoBackup(actor, reason);
  }

  private async wipeAllData(password: string, actor: AuthContext): Promise<{ ok: boolean; message: string }> {
    return this.bound.wipeAllData(password, actor);
  }

  async seedComprehensiveDemoData(dtoOrPassword: string | SeedDemoDataDto, actor: AuthContext): Promise<{ ok: boolean; message: string; activity?: string; productsCount?: number; salesCount?: number; onlineOrdersCount?: number; demoCredentials?: DemoCredential[] }> {
    const dto: SeedDemoDataDto = typeof dtoOrPassword === 'string'
      ? { password: dtoOrPassword, activityType: 'supermarket', wipeExisting: true, seedSales: true, seedOnlineOrders: true }
      : {
          activityType: dtoOrPassword?.activityType || 'supermarket',
          password: dtoOrPassword?.password || '',
          wipeExisting: dtoOrPassword?.wipeExisting ?? true,
          seedSales: dtoOrPassword?.seedSales ?? true,
          seedOnlineOrders: dtoOrPassword?.seedOnlineOrders ?? true,
        };

    const status = await this.getDemoDataStatus(actor);
    const scope = this.scope(actor);

    // If store already contains data and user requested wipeExisting:
    if (!status.isEmpty && dto.wipeExisting) {
      await this.assertSuperAdminAndPassword(dto.password || '', actor);
      await this.takeAutoBackup(actor, 'before_demo_seed');
      await this.wipeAllData(dto.password || '', actor);
    } else {
      if (!actor || (!['admin', 'super_admin', 'owner'].includes(actor.role))) {
        throw new AppError('فقط المسؤول أو السوبر أدمن هو المخول ببدء البيانات التجريبية', 'ADMIN_REQUIRED', 403);
      }
      if (!status.isEmpty && actor.role !== 'super_admin') {
        throw new AppError('لا يمكن سكب بيانات تجريبية على متجر يحتوي على بيانات نشطة بالفعل', 'STORE_NOT_EMPTY', 400);
      }
      await this.takeAutoBackup(actor, 'before_demo_seed');
    }

    let targetActivity = dto.activityType?.trim().toLowerCase();
    if (!targetActivity || targetActivity === 'auto' || targetActivity === 'supermarket') {
      const industrySetting = await this.db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'businessIndustry')
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (industrySetting?.value) {
        let ind = industrySetting.value;
        try {
          ind = JSON.parse(industrySetting.value);
        } catch {}
        targetActivity = mapIndustryToDemoActivity(String(ind));
      }
    }

    const dataset = getDemoDataset(targetActivity);
    let insertedProductsCount = 0;
    let insertedSalesCount = 0;
    let insertedOnlineOrdersCount = 0;
    const demoCredentials: DemoCredential[] = [];

    await this.db.transaction().execute(async (trx) => {
      // 1. Ensure Default Branch & Stock Locations
      let branch = await trx.selectFrom('branches').select(['id', 'name']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
      if (!branch) {
        const branchRes = await trx.insertInto('branches').values({
          name: 'الفرع الرئيسي',
          code: 'BR-01',
          sales_stock_mode: 'single_location',
          allow_external_sales_stock: true,
          is_active: true,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        }).returning(['id', 'name']).executeTakeFirst();
        branch = branchRes;
      }

      let location = await trx.selectFrom('stock_locations').select(['id', 'name']).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
      if (!location) {
        const locRes = await trx.insertInto('stock_locations').values({
          name: 'المستودع الرئيسي',
          code: 'LOC-MAIN',
          branch_id: branch?.id ? Number(branch.id) : null,
          location_type: 'internal_warehouse',
          is_active: true,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        }).returning(['id', 'name']).executeTakeFirst();
        location = locRes;
      }

      const branchId = branch?.id ? Number(branch.id) : 1;
      const locationId = location?.id ? Number(location.id) : 1;

      // 2. Demo Users: each new account gets a random one-time password.
      const demoUsers = [
        { username: 'كاشير1', display_name: 'أحمد محمود (كاشير 1)', role: 'cashier' as const, permissions_json: '["pos","sales"]' },
        { username: 'كاشير2', display_name: 'محمد إبراهيم (كاشير 2)', role: 'cashier' as const, permissions_json: '["pos","sales"]' },
        { username: 'admin', display_name: 'مدير النظام التجريبي', role: 'admin' as const, permissions_json: '["*"]' },
      ];

      for (const u of demoUsers) {
        const existing = await trx.selectFrom('users').select('id').where('username', '=', u.username).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
        if (!existing) {
          const temporaryPassword = `${randomBytes(18).toString('base64url')}Aa1!`;
          const passwordRecord = await createPasswordRecord(temporaryPassword);
          await trx.insertInto('users').values({
            username: u.username,
            display_name: u.display_name,
            role: u.role,
            password_hash: passwordRecord.hash,
            password_salt: passwordRecord.salt,
            permissions_json: u.permissions_json,
            is_active: true,
            must_change_password: true,
            failed_login_count: 0,
            default_branch_id: branchId,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).execute();
          demoCredentials.push({ username: u.username, temporaryPassword, mustChangePassword: true });
        }
      }

      // Update tenant activity_type (map 'fashion' dataset key to canonical 'clothing')
      const canonicalActivityType = dataset.key === 'fashion' ? 'clothing' : dataset.key;
      await trx.updateTable('tenants').set({ activity_type: canonicalActivityType }).where('id', '=', scope.tenantId).execute().catch(() => undefined);

      // 3. Product Categories from dataset
      const categoryMap = new Map<string, number>();
      for (const catName of dataset.categories) {
        let catId: number;
        const existingCat = await trx.selectFrom('product_categories').select(['id']).where('name', '=', catName).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
        if (existingCat) {
          catId = Number(existingCat.id);
        } else {
          const res = await trx.insertInto('product_categories').values({
            name: catName,
            is_active: true,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).returning(['id']).executeTakeFirst();
          catId = res ? Number(res.id) : 1;
        }
        categoryMap.set(catName, catId);
      }

      // 4. Suppliers from dataset
      const supplierIds: number[] = [];
      for (const sup of dataset.suppliers) {
        const existingSup = await trx.selectFrom('suppliers').select('id').where('name', '=', sup.name).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
        if (existingSup) {
          supplierIds.push(Number(existingSup.id));
        } else {
          const res = await trx.insertInto('suppliers').values({
            name: sup.name,
            phone: sup.phone,
            address: sup.address,
            balance: sup.balance,
            is_active: true,
            metadata: JSON.stringify({ is_demo: true, activity: dataset.key }),
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).returning(['id']).executeTakeFirst();
          if (res) supplierIds.push(Number(res.id));
        }
      }

      // 5. Customers from dataset
      const customerIds: number[] = [];
      for (const cust of dataset.customers) {
        const existingCust = await trx.selectFrom('customers').select('id').where('name', '=', cust.name).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
        if (existingCust) {
          customerIds.push(Number(existingCust.id));
        } else {
          const res = await trx.insertInto('customers').values({
            name: cust.name,
            phone: cust.phone,
            address: cust.address,
            balance: cust.balance,
            credit_limit: cust.customerType === 'vip' ? 25000 : 5000,
            customer_type: cust.customerType,
            store_credit_balance: 0,
            company_name: '',
            tax_number: '',
            is_active: true,
            metadata: JSON.stringify({ is_demo: true, activity: dataset.key }),
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).returning(['id']).executeTakeFirst();
          if (res) customerIds.push(Number(res.id));
        }
      }

      // 6. Delivery Representatives
      const deliveryRepsData = [
        { name: 'كابتن حسام حسن', phone: '01221110001', full_name: 'حسام حسن إبراهيم', vehicle_plate: 'أ ب ج 1234', rep_type: 'freelance' },
        { name: 'كابتن طارق علي', phone: '01221110002', full_name: 'طارق علي مصطفى', vehicle_plate: 'س ص ع 5678', rep_type: 'freelance' },
        { name: 'كابتن محمود رضا', phone: '01221110003', full_name: 'محمود رضا الشناوي', vehicle_plate: 'د هـ و 9012', rep_type: 'freelance' },
        { name: 'كابتن علي سمير', phone: '01221110004', full_name: 'علي سمير جاد', vehicle_plate: 'ر ز ح 3456', rep_type: 'freelance' },
        { name: 'كابتن خالد نبيل', phone: '01221110005', full_name: 'خالد نبيل فاروق', vehicle_plate: 'ط ك ل 7890', rep_type: 'freelance' },
        { name: 'كابتن أحمد يوسف', phone: '01221110006', full_name: 'أحمد يوسف غانم', vehicle_plate: 'م ن هـ 2345', rep_type: 'freelance' },
      ];

      const deliveryRepIds: number[] = [];
      for (const rep of deliveryRepsData) {
        const existingRep = await trx.selectFrom('delivery_representatives').select('id').where('phone', '=', rep.phone).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
        if (existingRep) {
          deliveryRepIds.push(Number(existingRep.id));
        } else {
          const res = await trx.insertInto('delivery_representatives').values({
            name: rep.name,
            phone: rep.phone,
            full_name: rep.full_name,
            vehicle_plate: rep.vehicle_plate,
            rep_type: rep.rep_type,
            is_active: true,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).returning(['id']).executeTakeFirst();
          if (res) deliveryRepIds.push(Number(res.id));
        }
      }

      // 7. Products from dataset
      const insertedProducts: Array<{ id: number; name: string; barcode: string; cost: number; retail: number; wholesale: number }> = [];
      const defaultCatId = Array.from(categoryMap.values())[0] || 1;

      for (const p of dataset.products) {
        const catId = categoryMap.get(p.category) || defaultCatId;
        const supId = supplierIds.length ? supplierIds[Math.floor(Math.random() * supplierIds.length)] : null;

        const res = await trx.insertInto('products').values({
          name: p.name,
          barcode: p.barcode,
          sku: p.sku || null,
          style_code: p.styleCode || null,
          item_type: 'product',
          item_kind: (p.itemKind as any) || 'standard',
          color: p.color || null,
          size: p.size || null,
          category_id: catId,
          supplier_id: supId,
          cost_price: p.costPrice,
          retail_price: p.retailPrice,
          wholesale_price: p.wholesalePrice,
          stock_qty: p.stockQty,
          min_stock_qty: p.minStockQty,
          default_location_id: locationId,
          is_active: true,
          metadata: JSON.stringify({
            is_demo: true,
            activity: dataset.key,
          }),
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        }).returning(['id']).executeTakeFirst();

        if (res) {
          const pid = Number(res.id);
          const pObj = { id: pid, name: p.name, barcode: p.barcode, cost: p.costPrice, retail: p.retailPrice, wholesale: p.wholesalePrice };
          insertedProducts.push(pObj);

          // Location stock
          await trx.insertInto('product_location_stock').values({
            product_id: pid,
            branch_id: branchId,
            location_id: locationId,
            qty: p.stockQty,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).execute();
        }
      }
      insertedProductsCount = insertedProducts.length;

      // 8. HR Departments & Job Titles & Employees
      const existingEmps = await trx.selectFrom('hr_employees').select('id').where(sql<boolean>`tenant_id = ${scope.tenantId}`).limit(1).executeTakeFirst();
      if (!existingEmps) {
        const hrDepartments = [
          'الإدارة العامة والتنفيذية',
          'المبيعات والكاشير',
          'المخازن واللوجستيات',
          'الحسابات والمالية',
          'خدمة العملاء والتوصيل (الدليفري)',
        ];

        const deptMap = new Map<string, number>();
        for (const dName of hrDepartments) {
          const res = await trx.insertInto('hr_departments').values({
            name: dName,
            description: dName,
            is_active: true,
            created_by: actor.userId,
            updated_by: actor.userId,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).returning(['id']).executeTakeFirst();
          if (res) deptMap.set(dName, Number(res.id));
        }

        const jobTitles = [
          'مدير الفرع العام',
          'مشرف وردية نقطة بيع',
          'كاشير رئيسي',
          'كاشير مساعد',
          'أمين مخزن رئيسي',
          'مساعد أمين مخزن / عمالة',
          'محاسب مالي عام',
          'مراجع ومراقب حسابات',
          'مشرف دليفري وخدمة عملاء',
          'طيار دليفري سريع',
        ];

        const titleMap = new Map<string, number>();
        for (const jName of jobTitles) {
          const res = await trx.insertInto('hr_job_titles').values({
            name: jName,
            description: jName,
            is_active: true,
            created_by: actor.userId,
            updated_by: actor.userId,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).returning(['id']).executeTakeFirst();
          if (res) titleMap.set(jName, Number(res.id));
        }

        const employeesData = [
          { empNo: 'EMP-001', first: 'محمد', last: 'فتحي المنشاوي', title: 'مدير الفرع العام', dept: 'الإدارة العامة والتنفيذية', natId: '29001010101234', salary: 18000 },
          { empNo: 'EMP-002', first: 'طارق', last: 'جمال الدين', title: 'مشرف وردية نقطة بيع', dept: 'المبيعات والكاشير', natId: '29205040101235', salary: 9000 },
          { empNo: 'EMP-003', first: 'أحمد', last: 'محمود عبد السلام', title: 'كاشير رئيسي', dept: 'المبيعات والكاشير', natId: '29508120101236', salary: 6500 },
          { empNo: 'EMP-004', first: 'محمد', last: 'إبراهيم غنيم', title: 'كاشير رئيسي', dept: 'المبيعات والكاشير', natId: '29603150101237', salary: 6500 },
          { empNo: 'EMP-005', first: 'سارة', last: 'أحمد علي', title: 'كاشير مساعد', dept: 'المبيعات والكاشير', natId: '29811200101238', salary: 5500 },
          { empNo: 'EMP-006', first: 'محمود', last: 'شاكر النجار', title: 'كاشير مساعد', dept: 'المبيعات والكاشير', natId: '29709090101239', salary: 5500 },
          { empNo: 'EMP-007', first: 'ياسر', last: 'عزت عبد ربه', title: 'أمين مخزن رئيسي', dept: 'المخازن واللوجستيات', natId: '28904010101240', salary: 8500 },
          { empNo: 'EMP-008', first: 'وليد', last: 'صلاح مراد', title: 'مساعد أمين مخزن / عمالة', dept: 'المخازن واللوجستيات', natId: '29906060101241', salary: 5000 },
          { empNo: 'EMP-009', first: 'إسلام', last: 'عادل بيومي', title: 'مساعد أمين مخزن / عمالة', dept: 'المخازن واللوجستيات', natId: '29801020101242', salary: 5000 },
          { empNo: 'EMP-010', first: 'حازم', last: 'كمال الدين', title: 'محاسب مالي عام', dept: 'الحسابات والمالية', natId: '29107100101243', salary: 11000 },
          { empNo: 'EMP-011', first: 'عمرو', last: 'مجدي الشريف', title: 'مراجع ومراقب حسابات', dept: 'الحسابات والمالية', natId: '28812150101244', salary: 12500 },
          { empNo: 'EMP-012', first: 'رانيا', last: 'مصطفى كامل', title: 'مشرف دليفري وخدمة عملاء', dept: 'خدمة العملاء والتوصيل (الدليفري)', natId: '29402280101245', salary: 7500 },
          { empNo: 'EMP-013', first: 'حسام', last: 'حسن إبراهيم', title: 'طيار دليفري سريع', dept: 'خدمة العملاء والتوصيل (الدليفري)', natId: '29609180101246', salary: 5500 },
          { empNo: 'EMP-014', first: 'طارق', last: 'علي مصطفى', title: 'طيار دليفري سريع', dept: 'خدمة العملاء والتوصيل (الدليفري)', natId: '29705120101247', salary: 5500 },
          { empNo: 'EMP-015', first: 'محمود', last: 'رضا الشناوي', title: 'طيار دليفري سريع', dept: 'خدمة العملاء والتوصيل (الدليفري)', natId: '29510250101248', salary: 5500 },
          { empNo: 'EMP-016', first: 'علي', last: 'سمير جاد', title: 'طيار دليفري سريع', dept: 'خدمة العملاء والتوصيل (الدليفري)', natId: '29903140101249', salary: 5500 },
          { empNo: 'EMP-017', first: 'خالد', last: 'نبيل فاروق', title: 'طيار دليفري سريع', dept: 'خدمة العملاء والتوصيل (الدليفري)', natId: '29807200101250', salary: 5500 },
          { empNo: 'EMP-018', first: 'أحمد', last: 'يوسف غانم', title: 'طيار دليفري سريع', dept: 'خدمة العملاء والتوصيل (الدليفري)', natId: '29712010101251', salary: 5500 },
          { empNo: 'EMP-019', first: 'مينا', last: 'فايز جرجس', title: 'كاشير مساعد', dept: 'المبيعات والكاشير', natId: '29608080101252', salary: 5500 },
          { empNo: 'EMP-020', first: 'كريم', last: 'علاء الدين', title: 'مشرف وردية نقطة بيع', dept: 'المبيعات والكاشير', natId: '29304190101253', salary: 9000 },
        ];

        for (const emp of employeesData) {
          const dId = deptMap.get(emp.dept) || 1;
          const jId = titleMap.get(emp.title) || 1;
          const hireDate = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString().split('T')[0];

          const empRes = await trx.insertInto('hr_employees').values({
            employee_no: emp.empNo,
            first_name: emp.first,
            last_name: emp.last,
            display_name: `${emp.first} ${emp.last}`,
            national_id: emp.natId,
            department_id: dId,
            job_title_id: jId,
            hire_date: hireDate,
            status: 'active',
            compensation_type: 'monthly',
            pay_frequency: 'monthly',
            expected_daily_hours: 8,
            scheduled_check_in_time: '09:00',
            scheduled_check_out_time: '17:00',
            grace_minutes: 15,
            overtime_policy: 'review_only',
            attendance_policy: 'flexible',
            commission_type: 'none',
            delay_policy: 'standard',
            has_social_insurance: false,
            has_income_tax: false,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).returning(['id']).executeTakeFirst();

          if (empRes) {
            const empId = Number(empRes.id);
            await trx.insertInto('hr_employment_contracts').values({
              employee_id: empId,
              contract_no: `CNT-${emp.empNo}`,
              contract_type: 'full_time',
              base_salary: emp.salary,
              currency: 'EGP',
              status: 'active',
              start_date: hireDate,
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
            }).execute();

            for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
              const attDate = new Date(Date.now() - dayOffset * 24 * 3600 * 1000).toISOString().split('T')[0];
              await trx.insertInto('hr_attendance_records').values({
                employee_id: empId,
                work_date: attDate,
                status: 'present',
                check_in_at: new Date(`${attDate}T08:55:00Z`),
                check_out_at: new Date(`${attDate}T17:05:00Z`),
                source: 'manual',
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
              }).execute();
            }
          }
        }
      }

      // 9. Open Cashier Shift for Instant POS Experience
      const existingShift = await trx.selectFrom('cashier_shifts').select('id').where('status', '=', 'open').where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
      if (!existingShift) {
        await trx.insertInto('cashier_shifts').values({
          branch_id: branchId,
          opened_by: actor.userId,
          expected_cash: 1500,
          counted_cash: null,
          status: 'open',
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        }).execute();
      }

      // 10. Historical Purchases across 6 Months (~30 Invoices)
      if (insertedProducts.length > 0 && supplierIds.length > 0) {
        let purchaseCounter = 1001;
        const totalPurchasesTarget = Math.min(30, insertedProducts.length);
        for (let i = 0; i < totalPurchasesTarget; i++) {
          const daysAgo = Math.floor(Math.random() * 175) + 1;
          const pDate = new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();
          const supId = supplierIds[i % supplierIds.length];

          const startIdx = (i * 2) % insertedProducts.length;
          const billProducts = insertedProducts.slice(startIdx, Math.min(insertedProducts.length, startIdx + 3));
          if (billProducts.length === 0) continue;

          let billSubtotal = 0;
          const itemsToInsert: { product_id: number; product_name: string; qty: number; unit_cost: number; line_total: number }[] = [];

          for (const bp of billProducts) {
            const qty = Math.floor(Math.random() * 25) + 10;
            const lineTotal = qty * bp.cost;
            billSubtotal += lineTotal;
            itemsToInsert.push({
              product_id: bp.id,
              product_name: bp.name,
              qty,
              unit_cost: bp.cost,
              line_total: lineTotal,
            });
          }

          const isPaid = i % 4 !== 0;

          const pRes = await trx.insertInto('purchases').values({
            doc_no: `PUR-${purchaseCounter++}`,
            supplier_id: supId,
            subtotal: billSubtotal,
            discount: 0,
            tax_rate: 0,
            tax_amount: 0,
            prices_include_tax: true,
            total: billSubtotal,
            note: 'فاتورة مشتريات تجريبية',
            status: 'posted',
            payment_type: isPaid ? 'cash' : 'credit',
            branch_id: branchId,
            location_id: locationId,
            created_by: actor.userId,
            created_at: pDate,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).returning(['id']).executeTakeFirst();

          if (pRes) {
            const pId = Number(pRes.id);
            for (const item of itemsToInsert) {
              await trx.insertInto('purchase_items').values({
                purchase_id: pId,
                product_id: item.product_id,
                product_name: item.product_name,
                qty: item.qty,
                unit_cost: item.unit_cost,
                line_total: item.line_total,
                unit_name: 'قطعة',
                unit_multiplier: 1,
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
              }).execute();
            }
          }
        }
      }

      // 11. Historical Sales across 6 Months
      if (dto.seedSales && insertedProducts.length > 0 && customerIds.length > 0) {
        let saleCounter = 2001;
        const paymentTypes: ('cash' | 'card' | 'credit')[] = ['cash', 'cash', 'card', 'card', 'cash', 'credit'];
        const deliveryStatuses: ('delivered' | 'assigned' | 'pending')[] = ['delivered', 'delivered', 'delivered', 'assigned', 'pending'];

        // A) Insert precise sample sales from dataset
        for (const sample of (dataset.sampleSales || [])) {
          const sDate = new Date(Date.now() - sample.daysAgo * 24 * 3600 * 1000 - 3 * 3600 * 1000).toISOString();
          const custId = (sample.customerIndex !== undefined && customerIds[sample.customerIndex])
            ? customerIds[sample.customerIndex]
            : customerIds[Math.floor(Math.random() * customerIds.length)];
          const payChannel = sample.paymentChannel === 'card' ? 'card' : sample.paymentChannel === 'instapay' ? 'card' : 'cash';
          const isDelivery = Math.random() < 0.3;
          const repId = isDelivery && deliveryRepIds.length ? deliveryRepIds[0] : null;
          const deliveryFee = isDelivery ? 25 : 0;

          let billSubtotal = 0;
          const itemsToInsert: { product_id: number; product_name: string; qty: number; cost_price: number; unit_price: number; line_total: number }[] = [];

          for (const it of sample.itemIndices) {
            const bp = insertedProducts[it.index] || insertedProducts[0];
            if (!bp) continue;
            const lineTotal = it.qty * bp.retail;
            billSubtotal += lineTotal;
            itemsToInsert.push({
              product_id: bp.id,
              product_name: bp.name,
              qty: it.qty,
              cost_price: bp.cost,
              unit_price: bp.retail,
              line_total: lineTotal,
            });
          }

          if (itemsToInsert.length === 0) continue;

          const total = billSubtotal + deliveryFee;

          const sRes = await trx.insertInto('sales').values({
            doc_no: `INV-${saleCounter++}`,
            table_number: 'صالة',
            order_type: 'retail',
            customer_id: custId,
            payment_type: 'cash',
            payment_channel: payChannel,
            subtotal: billSubtotal,
            discount: 0,
            tax_rate: 0,
            tax_amount: 0,
            delivery_fee: deliveryFee,
            delivery_fee_mode: isDelivery ? 'freelance_courier' : null,
            delivery_rep_id: repId,
            delivery_status: isDelivery ? 'delivered' : null,
            collection_status: isDelivery ? 'cod' : null,
            total,
            paid_amount: total,
            tendered_amount: total,
            change_amount: 0,
            store_credit_used: 0,
            prices_include_tax: true,
            status: 'posted',
            note: `فاتورة تجريبية (${dataset.name})`,
            cancel_reason: '',
            branch_id: branchId,
            location_id: locationId,
            created_by: actor.userId,
            created_at: sDate,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).returning(['id']).executeTakeFirst();

          if (sRes) {
            const sId = Number(sRes.id);
            for (const item of itemsToInsert) {
              await trx.insertInto('sale_items').values({
                sale_id: sId,
                product_id: item.product_id,
                product_name: item.product_name,
                qty: item.qty,
                unit_price: item.unit_price,
                cost_price: item.cost_price,
                line_total: item.line_total,
                unit_name: 'قطعة',
                unit_multiplier: 1,
                price_type: 'retail',
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
              }).execute();
            }
            await trx.insertInto('sale_payments').values({
              sale_id: sId,
              payment_channel: payChannel,
              amount: total,
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
            }).execute();
            insertedSalesCount++;
          }
        }

        // B) Generate remaining sales (~85 additional sales)
        const additionalSalesTarget = 85;
        for (let i = 0; i < additionalSalesTarget; i++) {
          const isRecent = i < 30;
          const daysAgo = isRecent ? Math.floor(Math.random() * 14) : Math.floor(Math.random() * 165) + 15;
          const sDate = new Date(Date.now() - daysAgo * 24 * 3600 * 1000 - Math.floor(Math.random() * 8) * 3600 * 1000).toISOString();

          const custId = customerIds[i % customerIds.length];
          const payType = paymentTypes[i % paymentTypes.length];
          const isDelivery = i % 3 === 0;
          const repId = isDelivery && deliveryRepIds.length ? deliveryRepIds[i % deliveryRepIds.length] : null;
          const rawDeliveryStatus = isDelivery ? deliveryStatuses[i % deliveryStatuses.length] : null;
          const deliveryStatus = rawDeliveryStatus === 'delivered' ? 'delivered' : rawDeliveryStatus === 'assigned' ? 'out_for_delivery' : rawDeliveryStatus === 'pending' ? 'pending' : null;
          const collectionStatus = isDelivery ? 'cod' : null;
          const deliveryFee = isDelivery ? 25 : 0;

          const startIdx = (i * 2) % Math.max(1, insertedProducts.length - 4);
          const billProducts = insertedProducts.slice(startIdx, Math.min(insertedProducts.length, startIdx + Math.floor(Math.random() * 3) + 2));
          if (billProducts.length === 0) continue;

          let billSubtotal = 0;
          const itemsToInsert: { product_id: number; product_name: string; qty: number; cost_price: number; unit_price: number; line_total: number }[] = [];

          for (const bp of billProducts) {
            const qty = Math.floor(Math.random() * 3) + 1;
            const unitPrice = (payType === 'credit' && i % 2 === 0) ? bp.wholesale : bp.retail;
            const lineTotal = qty * unitPrice;
            billSubtotal += lineTotal;
            itemsToInsert.push({
              product_id: bp.id,
              product_name: bp.name,
              qty,
              cost_price: bp.cost,
              unit_price: unitPrice,
              line_total: lineTotal,
            });
          }

          const total = billSubtotal + deliveryFee;
          const paidAmount = payType === 'credit' ? (i % 2 === 0 ? 0 : Math.round(total * 0.5)) : total;

          const sRes = await trx.insertInto('sales').values({
            doc_no: `INV-${saleCounter++}`,
            table_number: 'صالة',
            order_type: 'retail',
            customer_id: custId,
            payment_type: payType === 'credit' ? 'credit' : 'cash',
            payment_channel: payType === 'card' ? 'card' : 'cash',
            subtotal: billSubtotal,
            discount: 0,
            tax_rate: 0,
            tax_amount: 0,
            delivery_fee: deliveryFee,
            delivery_fee_mode: isDelivery ? 'freelance_courier' : null,
            delivery_rep_id: repId,
            delivery_status: deliveryStatus,
            collection_status: collectionStatus,
            total,
            paid_amount: paidAmount,
            tendered_amount: paidAmount,
            change_amount: 0,
            store_credit_used: 0,
            prices_include_tax: true,
            status: 'posted',
            note: `فاتورة مبيعات تجريبية (${dataset.name})`,
            cancel_reason: '',
            branch_id: branchId,
            location_id: locationId,
            created_by: actor.userId,
            created_at: sDate,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).returning(['id']).executeTakeFirst();

          if (sRes) {
            const sId = Number(sRes.id);
            for (const item of itemsToInsert) {
              await trx.insertInto('sale_items').values({
                sale_id: sId,
                product_id: item.product_id,
                product_name: item.product_name,
                qty: item.qty,
                unit_price: item.unit_price,
                cost_price: item.cost_price,
                line_total: item.line_total,
                unit_name: 'قطعة',
                unit_multiplier: 1,
                price_type: 'retail',
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
              }).execute();
            }
            if (paidAmount > 0) {
              await trx.insertInto('sale_payments').values({
                sale_id: sId,
                payment_channel: payType === 'card' ? 'card' : 'cash',
                amount: paidAmount,
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
              }).execute();
            }
            insertedSalesCount++;
          }
        }
      }

      // 12. Storefront Online Orders
      if (dto.seedOnlineOrders && (dataset.sampleOnlineOrders || []).length > 0) {
        let orderSeq = 101;
        for (const o of dataset.sampleOnlineOrders) {
          const oItems: any[] = [];
          let calcSubtotal = 0;
          for (const it of o.itemIndices) {
            const p = insertedProducts[it.index] || insertedProducts[0];
            if (p) {
              const lineTotal = it.qty * p.retail;
              calcSubtotal += lineTotal;
              oItems.push({
                product_id: p.id,
                product_name: p.name,
                barcode: p.barcode,
                quantity: it.qty,
                price: p.retail,
                total: lineTotal,
              });
            }
          }

          const deliveryFee = 30;
          const totalAmount = calcSubtotal + deliveryFee;

          await trx.insertInto('online_orders').values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            order_number: `ON-DEMO-${orderSeq++}`,
            customer_name: o.customerName,
            customer_phone: o.customerPhone,
            customer_address: `${o.city} - ${o.customerAddress}`,
            customer_notes: 'طلب متجر تجريبي',
            items_json: JSON.stringify(oItems),
            subtotal: calcSubtotal,
            delivery_fee: deliveryFee,
            total_amount: totalAmount,
            status: o.status,
            payment_method: o.paymentMethod || 'cod',
            payment_status: o.status === 'delivered' ? 'paid' : 'pending',
            branch_id: branchId,
            sale_id: null,
          }).execute().catch(() => undefined);
          insertedOnlineOrdersCount++;
        }
      }

      // 13. POS Held Sales Drafts
      await trx.insertInto('held_sales').values({
        table_number: 'صالة',
        order_type: 'takeaway',
        paid_amount: 0,
        cash_amount: 0,
        card_amount: 0,
        discount: 0,
        delivery_fee: 0,
        note: `عميل الصالة - طلب معلق (${dataset.name})`,
        search: '',
        price_type: 'retail',
        branch_id: branchId,
        location_id: locationId,
        created_by: actor.userId,
        payment_type: 'cash',
        payment_channel: 'cash',
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      }).execute();

      // 14. Expenses
      const expensesData = [
        { desc: 'فاتورة استهلاك كهرباء ومرافق المقر', amount: 3200, days: 5 },
        { desc: 'إيجار مقر المعرض / المتجر الشهري', amount: 15000, days: 28 },
        { desc: 'صيانة دورية لأجهزة الكاشير ونقاط البيع', amount: 1200, days: 12 },
        { desc: 'مستلزمات نظافة ومطهرات وضيافة', amount: 650, days: 3 },
        { desc: 'مصاريف تسويق ودعاية إلكترونية', amount: 2400, days: 7 },
      ];

      for (const exp of expensesData) {
        const expDate = new Date(Date.now() - exp.days * 24 * 3600 * 1000).toISOString();
        await trx.insertInto('expenses').values({
          title: exp.desc,
          amount: exp.amount,
          expense_date: expDate,
          note: 'مصروف مسجل في النظام',
          branch_id: branchId,
          location_id: locationId,
          created_by: actor.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        }).execute();
      }
    });

    await this.audit.log('ملء البيانات التجريبية الشاملة', `تم ملء النظام بالبيانات التجريبية لنشاط ${dataset.name} بواسطة ${actor.username}`, actor).catch(() => undefined);

    return {
      ok: true,
      message: `تم ملء النظام بنجاح ببيانات تجريبية لنشاط (${dataset.name}): ${insertedProductsCount} صنفاً، ${insertedSalesCount} فاتورة مبيعات، و${insertedOnlineOrdersCount} طلبات متجر إلكتروني!`,
      activity: dataset.key,
      productsCount: insertedProductsCount,
      salesCount: insertedSalesCount,
      onlineOrdersCount: insertedOnlineOrdersCount,
      demoCredentials,
    };
  }
}
