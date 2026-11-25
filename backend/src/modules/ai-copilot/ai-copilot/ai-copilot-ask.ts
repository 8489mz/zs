import { sql, type Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import type { CopilotResponse, AiProvider } from './ai-copilot-types';
import type { Logger } from '@nestjs/common';

export class AiCopilotAsk {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly logger: Logger,
    private readonly bound: {
      getEffectiveAiConfig: (tenantId: string) => Promise<{
        provider: AiProvider;
        apiKey: string | null;
        model: string;
        baseUrl?: string;
      }>;
      askOpenAi: (
        question: string,
        snapshot: Record<string, unknown>,
        apiKey: string,
        model?: string,
        baseUrl?: string,
      ) => Promise<{ answer: string; suggestedQuestions: string[] } | null>;
    },
  ) {}

  private async getEffectiveAiConfig(tenantId: string): Promise<{
    provider: AiProvider;
    apiKey: string | null;
    model: string;
    baseUrl?: string;
  }> {
    return this.bound.getEffectiveAiConfig(tenantId);
  }

  private async askOpenAi(
    question: string,
    snapshot: Record<string, unknown>,
    apiKey: string,
    model = 'gpt-4o-mini',
    baseUrl = 'https://api.openai.com/v1',
  ): Promise<{ answer: string; suggestedQuestions: string[] } | null> {
    return this.bound.askOpenAi(question, snapshot, apiKey, model, baseUrl);
  }

  async ask(question: string, actor: AuthContext): Promise<CopilotResponse> {
    const { tenantId } = requireTenantScope(actor);
    const q = (question || '').trim().toLowerCase();

    // 1. Gather live operational snapshot with full error resilience
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    let todayCount = 0;
    let todaySales = 0;
    let todayCash = 0;
    let weekCount = 0;
    let weekSales = 0;
    let customerDebt = 0;
    let lowStock = 0;
    let totalProducts = 0;
    let inventoryCost = 0;
    let inventoryRetailValue = 0;
    let todayExpenses = 0;
    let monthExpenses = 0;
    let recentExpenses: Array<{ title: string; amount: number }> = [];
    let supplierDebt = 0;
    let topSuppliers: Array<{ name: string; phone: string | null; balance: number }> = [];
    let treasuryBalance = 0;
    let overdueInstallmentsCount = 0;
    let overdueInstallmentsAmount = 0;
    let topDebtors: Array<{ name: string; phone: string | null; balance: number }> = [];
    let lowStockItems: Array<{ name: string; stock_qty: number; min_stock_qty: number }> = [];
    let topTodayRows: Array<{ product_name: string; total_qty: number; total_amount: number }> = [];
    let topMonthlyRows: Array<{ product_name: string; total_qty: number }> = [];

    try {
      // Sales today
      const salesToday = await this.db
        .selectFrom('sales')
        .select([
          sql<number>`COUNT(*)`.as('count'),
          sql<number>`COALESCE(SUM(total), 0)`.as('total_sales'),
          sql<number>`COALESCE(SUM(paid_amount), 0)`.as('cash_collected'),
        ])
        .where('tenant_id', '=', tenantId)
        .where('created_at', '>=', startOfToday)
        .where('created_at', '<=', endOfToday)
        .where('status', '!=', 'cancelled')
        .executeTakeFirst();

      todayCount = Number(salesToday?.count || 0);
      todaySales = Number(salesToday?.total_sales || 0);
      todayCash = Number(salesToday?.cash_collected || 0);
    } catch (err: any) {
      this.logger.warn(`Failed to query sales today for copilot: ${err?.message || err}`);
    }

    try {
      // Sales last 7 days
      const salesWeek = await this.db
        .selectFrom('sales')
        .select([
          sql<number>`COUNT(*)`.as('count'),
          sql<number>`COALESCE(SUM(total), 0)`.as('total_sales'),
        ])
        .where('tenant_id', '=', tenantId)
        .where('created_at', '>=', sevenDaysAgo)
        .where('status', '!=', 'cancelled')
        .executeTakeFirst();

      weekCount = Number(salesWeek?.count || 0);
      weekSales = Number(salesWeek?.total_sales || 0);
    } catch (err: any) {
      this.logger.warn(`Failed to query weekly sales for copilot: ${err?.message || err}`);
    }

    try {
      // Top 5 selling products today (column in sale_items is 'qty' and 'line_total')
      const rows = await this.db
        .selectFrom('sale_items as si')
        .innerJoin('sales as s', 's.id', 'si.sale_id')
        .select([
          'si.product_name',
          sql<number>`COALESCE(SUM(si.qty), 0)`.as('total_qty'),
          sql<number>`COALESCE(SUM(si.line_total), 0)`.as('total_amount'),
        ])
        .where('s.tenant_id', '=', tenantId)
        .where('s.created_at', '>=', startOfToday)
        .where('s.created_at', '<=', endOfToday)
        .where('s.status', '!=', 'cancelled')
        .groupBy('si.product_name')
        .orderBy(sql`SUM(si.line_total)`, 'desc')
        .limit(5)
        .execute();

      topTodayRows = rows.map((r) => ({
        product_name: r.product_name,
        total_qty: Number(r.total_qty || 0),
        total_amount: Number(r.total_amount || 0),
      }));
    } catch (err: any) {
      this.logger.warn(`Failed to query top products today for copilot: ${err?.message || err}`);
    }

    try {
      // Top 5 selling products of last 30 days
      const rows = await this.db
        .selectFrom('sale_items as si')
        .innerJoin('sales as s', 's.id', 'si.sale_id')
        .select([
          'si.product_name',
          sql<number>`COALESCE(SUM(si.qty), 0)`.as('total_qty'),
        ])
        .where('s.tenant_id', '=', tenantId)
        .where('s.created_at', '>=', thirtyDaysAgo)
        .where('s.status', '!=', 'cancelled')
        .groupBy('si.product_name')
        .orderBy(sql`SUM(si.qty)`, 'desc')
        .limit(5)
        .execute();

      topMonthlyRows = rows.map((r) => ({
        product_name: r.product_name,
        total_qty: Number(r.total_qty || 0),
      }));
    } catch (err: any) {
      this.logger.warn(`Failed to query monthly top products for copilot: ${err?.message || err}`);
    }

    try {
      // Top debtors
      const rows = await this.db
        .selectFrom('customers')
        .select(['name', 'phone', 'balance'])
        .where('tenant_id', '=', tenantId)
        .where('balance', '>', 0)
        .orderBy('balance', 'desc')
        .limit(5)
        .execute();

      topDebtors = rows.map((r) => ({
        name: r.name,
        phone: r.phone,
        balance: Number(r.balance || 0),
      }));

      const totalCustomerDebt = await this.db
        .selectFrom('customers')
        .select(sql<number>`COALESCE(SUM(balance), 0)`.as('total'))
        .where('tenant_id', '=', tenantId)
        .where('balance', '>', 0)
        .executeTakeFirst();

      customerDebt = Number(totalCustomerDebt?.total || 0);
    } catch (err: any) {
      this.logger.warn(`Failed to query customer debt for copilot: ${err?.message || err}`);
    }

    try {
      // Expenses today & month
      const expToday = await sql<{ total: number }>`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM expenses
        WHERE tenant_id = ${tenantId}
          AND expense_date >= ${startOfToday}
          AND expense_date <= ${endOfToday}
      `.execute(this.db);
      todayExpenses = Number(expToday.rows[0]?.total || 0);

      const expMonth = await sql<{ total: number }>`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM expenses
        WHERE tenant_id = ${tenantId}
          AND expense_date >= ${thirtyDaysAgo}
      `.execute(this.db);
      monthExpenses = Number(expMonth.rows[0]?.total || 0);

      const expList = await sql<{ title: string; amount: number }>`
        SELECT title, amount
        FROM expenses
        WHERE tenant_id = ${tenantId}
        ORDER BY id DESC
        LIMIT 3
      `.execute(this.db);
      recentExpenses = expList.rows.map((r) => ({ title: r.title, amount: Number(r.amount || 0) }));
    } catch (err: any) {
      this.logger.warn(`Failed to query expenses for copilot: ${err?.message || err}`);
    }

    try {
      // Supplier payables
      const suppRows = await this.db
        .selectFrom('suppliers')
        .select(['name', 'phone', 'balance'])
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .where('balance', '>', 0)
        .orderBy('balance', 'desc')
        .limit(5)
        .execute();

      topSuppliers = suppRows.map((s) => ({
        name: s.name,
        phone: s.phone,
        balance: Number(s.balance || 0),
      }));

      const totalSuppDebt = await this.db
        .selectFrom('suppliers')
        .select(sql<number>`COALESCE(SUM(balance), 0)`.as('total'))
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .where('balance', '>', 0)
        .executeTakeFirst();

      supplierDebt = Number(totalSuppDebt?.total || 0);
    } catch (err: any) {
      this.logger.warn(`Failed to query suppliers for copilot: ${err?.message || err}`);
    }

    try {
      // Treasury balance
      const treasuryRow = await sql<{ total: number }>`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM treasury_transactions
        WHERE tenant_id = ${tenantId}
      `.execute(this.db);
      treasuryBalance = Number(treasuryRow.rows[0]?.total || 0);
    } catch (err: any) {
      this.logger.warn(`Failed to query treasury balance for copilot: ${err?.message || err}`);
    }

    try {
      // Overdue customer installments
      const instRow = await sql<{ count: number; total: number }>`
        SELECT COUNT(*) as count, COALESCE(SUM(amount - paid_amount), 0) as total
        FROM customer_installments
        WHERE tenant_id = ${tenantId}
          AND status IN ('pending', 'overdue')
          AND due_date < ${now}
      `.execute(this.db);
      overdueInstallmentsCount = Number(instRow.rows[0]?.count || 0);
      overdueInstallmentsAmount = Number(instRow.rows[0]?.total || 0);
    } catch (err: any) {
      this.logger.warn(`Failed to query customer installments for copilot: ${err?.message || err}`);
    }

    try {
      // Low stock items
      const lowStockCount = await this.db
        .selectFrom('products')
        .select(sql<number>`COUNT(*)`.as('count'))
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .where(sql<boolean>`COALESCE(stock_qty, 0) <= COALESCE(min_stock_qty, 5)`)
        .executeTakeFirst();

      lowStock = Number(lowStockCount?.count || 0);

      const items = await this.db
        .selectFrom('products')
        .select(['name', 'stock_qty', 'min_stock_qty'])
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .where(sql<boolean>`COALESCE(stock_qty, 0) <= COALESCE(min_stock_qty, 5)`)
        .limit(5)
        .execute();

      lowStockItems = items.map((p) => ({
        name: p.name,
        stock_qty: Number(p.stock_qty || 0),
        min_stock_qty: Number(p.min_stock_qty || 5),
      }));
    } catch (err: any) {
      this.logger.warn(`Failed to query low stock items for copilot: ${err?.message || err}`);
    }

    try {
      // Total Inventory stats
      const inventoryStats = await this.db
        .selectFrom('products')
        .select([
          sql<number>`COUNT(*)`.as('total_products'),
          sql<number>`COALESCE(SUM(COALESCE(stock_qty, 0) * COALESCE(cost_price, 0)), 0)`.as('inventory_cost'),
          sql<number>`COALESCE(SUM(COALESCE(stock_qty, 0) * COALESCE(retail_price, 0)), 0)`.as('inventory_retail_value'),
        ])
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .executeTakeFirst();

      totalProducts = Number(inventoryStats?.total_products || 0);
      inventoryCost = Number(inventoryStats?.inventory_cost || 0);
      inventoryRetailValue = Number(inventoryStats?.inventory_retail_value || 0);
    } catch (err: any) {
      this.logger.warn(`Failed to query inventory stats for copilot: ${err?.message || err}`);
    }

    // Snapshot object
    const snapshot = {
      todaySales,
      todayCount,
      todayCash,
      weekSales,
      weekCount,
      todayExpenses,
      monthExpenses,
      recentExpenses,
      customerDebt,
      overdueInstallmentsCount,
      overdueInstallmentsAmount,
      supplierDebt,
      topSuppliers,
      treasuryBalance,
      lowStock,
      totalProducts,
      inventoryCost,
      inventoryRetailValue,
      topDebtors: topDebtors.map((d) => ({ name: d.name, debt: Number(d.balance), phone: d.phone })),
      lowStockItems: lowStockItems.map((p) => ({ name: p.name, stock: Number(p.stock_qty), min: Number(p.min_stock_qty || 5) })),
      topProductsToday: topTodayRows.map((p) => ({ name: p.product_name, qty: Number(p.total_qty), total: Number(p.total_amount) })),
      topProductsMonth: topMonthlyRows.map((p) => ({ name: p.product_name, qty: Number(p.total_qty) })),
    };

    // 2. Try Generative AI (Gemini or OpenAI / Custom) if API key is present
    const aiConfig = await this.getEffectiveAiConfig(tenantId);
    if (aiConfig.apiKey && aiConfig.apiKey.trim()) {
      try {
        let llmResponse: { answer: string; suggestedQuestions: string[] } | null = null;
        if (aiConfig.provider === 'openai' || aiConfig.provider === 'custom' || aiConfig.apiKey.startsWith('sk-')) {
          llmResponse = await this.askOpenAi(question, snapshot, aiConfig.apiKey.trim(), aiConfig.model, aiConfig.baseUrl);
        } else {
          llmResponse = await this.askGemini(question, snapshot, aiConfig.apiKey.trim(), aiConfig.model);
        }

        if (llmResponse) {
          return {
            answer: llmResponse.answer,
            suggestedQuestions: llmResponse.suggestedQuestions,
            metrics: snapshot,
            engine: aiConfig.provider === 'openai' ? 'openai_llm' : aiConfig.provider === 'custom' ? 'custom_llm' : 'gemini_llm',
          };
        }
      } catch (err: any) {
        this.logger.warn(`Cloud LLM copilot failed, falling back to local engine: ${err?.message || err}`);
      }
    }

    // 3. Robust Local Deterministic NLP Analytics Engine (Zero Internet Dependency / Fallback)
    return this.runLocalAnalyticsEngine(q, snapshot);
  }

  private async askGemini(
    question: string,
    snapshot: Record<string, unknown>,
    apiKey: string,
    configuredModel?: string,
  ): Promise<{ answer: string; suggestedQuestions: string[] } | null> {
    const prompt = `أنت (زاد AI)، المساعد والمستشار التجاري والمالي الذكي لنظام إدارة المنشآت Z-Systems.
لديك البيانات الحالية المباشرة لنشاط المنشأة كمرجع لك عند الحاجة:
${JSON.stringify(snapshot, null, 2)}

قواعدك الصارمة جداً:
1. أجب «على قد السؤال بالضبط» وبإيجاز شديد ومباشر (من سطر إلى 3 أسطر كحد أقصى).
2. ممنوع نهائياً سرد تقرير شامل أو استعراض أقسام وأرقام لم يطلبها المستخدم (مثل رصيد الخزينة أو المخزون أو الموردين دفعة واحدة)!
3. إذا سأل المستخدم عن بند محدد فقط (مثل: المبيعات، أو الخزينة، أو ديون العملاء)، أجب عن ذلك البند بالتحديد فقط بالأرقام المتاحة دون زيادة.
4. إذا كان السؤال دردشة أو تعليقاً أو تحية أو سؤالاً شخصياً عنك (مثل: "هو انت ai؟" أو "ينفع ترد عليا؟" أو "رد على قد السؤال")، أجب بروح ذكية ومرحة وموجزة في سطر واحد دون سرد أي أرقام أو بيانات من النظام!
5. تحدث باللغة العربية بأسلوب راقٍ ومهذب (لهجة مصرية مبسطة أو فصحى يسيرة).
6. اقترح فقط 3 أسئلة تالية قصيرة ومركزة تناسب نفس موضوع السؤال المطروح فقط.

السؤال: "${question}"

أجب بصيغة JSON فقط بهذا الشكل:
{
  "answer": "الإجابة المباشرة والموجزة على قد السؤال تماماً",
  "suggestedQuestions": ["سؤال 1", "سؤال 2", "سؤال 3"]
}`;

    const cleanConfigured = (configuredModel || '').trim();
    const candidateModels = [
      ...(cleanConfigured ? [cleanConfigured] : []),
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash-latest',
      'gemini-2.0-flash-exp',
      'gemini-1.5-flash',
      'gemini-pro',
    ];

    for (const model of candidateModels) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.3,
            },
          }),
        });

        if (!res.ok) {
          if (res.status === 404) continue;
          return null;
        }

        const data = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) continue;

        try {
          const cleanJson = rawText.replace(/```json\s*/i, '').replace(/```\s*$/i, '').trim();
          const parsed = JSON.parse(cleanJson);
          const ans = parsed.answer || parsed.response || parsed.reply || parsed.text || rawText;
          return {
            answer: typeof ans === 'string' ? ans : JSON.stringify(ans),
            suggestedQuestions: Array.isArray(parsed.suggestedQuestions) && parsed.suggestedQuestions.length > 0
              ? parsed.suggestedQuestions
              : ['مبيعات وأرباح اليوم', 'أكثر العملاء مديونية', 'الأصناف الحرجة في المخزن'],
          };
        } catch {
          return {
            answer: rawText,
            suggestedQuestions: ['مبيعات وأرباح اليوم', 'أكثر العملاء مديونية', 'الأصناف الحرجة في المخزن'],
          };
        }
      } catch {
        // try next candidate model
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  }

  private runLocalAnalyticsEngine(q: string, s: any): CopilotResponse {
    // 1: المصروفات والنفقات التشغيلية
    if (q.includes('مصروف') || q.includes('مصاريف') || q.includes('نفقات') || q.includes('مصروفات') || q.includes('صرفنا') || q.includes('خرج') || q.includes('نثريات') || q.includes('تكاليف')) {
      const recentList = s.recentExpenses && s.recentExpenses.length > 0
        ? `\n\n**أحدث بنود المصروفات المسجلة:**\n` + s.recentExpenses.map((e: any, i: number) => `${i + 1}. **${e.title}**: ${Number(e.amount || 0).toLocaleString('ar-EG')} ج.م`).join('\n')
        : '';

      return {
        answer: `**تقرير المصروفات والنفقات التشغيلية:**\n\n` +
          `- إجمالي مصروفات اليوم: **${Number(s.todayExpenses || 0).toLocaleString('ar-EG')} ج.م**.\n` +
          `- إجمالي مصروفات آخر 30 يوماً: **${Number(s.monthExpenses || 0).toLocaleString('ar-EG')} ج.م**.\n` +
          `- نسبة المصروفات لمبيعات اليوم: **${s.todaySales > 0 ? ((s.todayExpenses / s.todaySales) * 100).toFixed(1) + '%' : '0%'}**.${recentList}\n\n` +
          `**توصية زاد:** راقب النثريات اليومية واحتفظ بفواتير المصروفات التشغيلية في النظام لخصمها من وعاء الأرباح وحساب صافي الدخل بدقة.`,
        suggestedQuestions: [
          'كسبت كام النهاردة؟',
          'فلوس الخزينة والدرج الحالية',
          'مستحقات وفواتير الموردين',
        ],
        metrics: s,
        engine: 'local_analytics',
      };
    }

    // 2: الخزينة والدرج والسيولة النقدية
    if (q.includes('خزينة') || q.includes('خزنة') || q.includes('درج') || q.includes('كاش') || q.includes('سيولة') || q.includes('سيوله') || q.includes('نقدية') || q.includes('نقديه')) {
      return {
        answer: `**حركة الخزينة والسيولة النقدية:**\n\n` +
          `- رصيد الخزينة الإجمالي المسجل: **${Number(s.treasuryBalance || 0).toLocaleString('ar-EG')} ج.م**.\n` +
          `- النقدية المحصلة بالدرج اليوم: **${Number(s.todayCash || 0).toLocaleString('ar-EG')} ج.م**.\n` +
          `- إجمالي مبيعات اليوم (نقدي وآجل): **${Number(s.todaySales || 0).toLocaleString('ar-EG')} ج.م**.\n` +
          `- مصروفات اليوم النقدية: **${Number(s.todayExpenses || 0).toLocaleString('ar-EG')} ج.م**.\n\n` +
          `**توصية زاد:** قم بعمل جرد فعلي للنقدية ومطابقتها مع الدرج قبل إغلاق وردية الكاشير لتفادي أي عجز أو ترحيل خاطئ.`,
        suggestedQuestions: [
          'كسبت كام النهاردة؟',
          'صرفنا كام مصاريف النهاردة؟',
          'مين أكتر عملاء عليهم فلوس؟',
        ],
        metrics: s,
        engine: 'local_analytics',
      };
    }

    // 3: الموردين والشركات ومستحقات الشراء
    if (q.includes('مورد') || q.includes('موردين') || q.includes('شركات') || q.includes('شركه') || q.includes('شركة') || q.includes('فواتير الشراء') || q.includes('مشتريات') || q.includes('مستحقات المورد')) {
      const suppStr = s.topSuppliers && s.topSuppliers.length > 0
        ? `\n\n**أكبر الموردين مستحقات حالياً:**\n` + s.topSuppliers.map((sup: any, i: number) => `${i + 1}. **${sup.name}**: ${Number(sup.balance || 0).toLocaleString('ar-EG')} ج.م ${sup.phone ? `(هاتف: ${sup.phone})` : ''}`).join('\n')
        : '\n\nممتاز! لا توجد مستحقات معلقة للموردين حالياً.';

      return {
        answer: `**موقف مستحقات وفواتير الموردين:**\n\n` +
          `- إجمالي المبالغ المستحقة للموردين: **${Number(s.supplierDebt || 0).toLocaleString('ar-EG')} ج.م**${suppStr}\n\n` +
          `**توصية زاد:** قم بجدولة دفعات الموردين في مواعيد منتظمة، واستفد من خصومات السداد المبكر التي تمنحها الشركات لرفع هامش ربحك.`,
        suggestedQuestions: [
          'فلوس الخزينة والدرج الحالية',
          'ايه نواقص المخزن الحرجة؟',
          'مين أكتر عملاء عليهم فلوس؟',
        ],
        metrics: s,
        engine: 'local_analytics',
      };
    }

    // 4: ديون العملاء والتحصيل والأقساط
    if (q.includes('دين') || q.includes('ديون') || q.includes('عملاء') || q.includes('عميل') || q.includes('فلوس') || q.includes('تحصيل') || q.includes('اجل') || q.includes('آجل') || q.includes('مستحقات') || q.includes('قسط') || q.includes('أقساط') || q.includes('اقساط')) {
      const debtorsStr = s.topDebtors && s.topDebtors.length > 0
        ? `\n\n**أكبر العملاء مديونية حالياً:**\n` + s.topDebtors.map((c: any, i: number) => `${i + 1}. **${c.name}**: ${Number(c.debt || 0).toLocaleString('ar-EG')} ج.م ${c.phone ? `(هاتف: ${c.phone})` : ''}`).join('\n')
        : '\n\nممتاز! لا توجد مديونيات متأخرة على العملاء.';

      const overdueInstStr = s.overdueInstallmentsCount > 0
        ? `\n**تنبيه الأقساط:** يوجد **${s.overdueInstallmentsCount}** قسط متأخر بقيمة **${Number(s.overdueInstallmentsAmount || 0).toLocaleString('ar-EG')} ج.م** تحتاج متابعة فورية.`
        : '';

      return {
        answer: `**موقف ديون ومستحقات العملاء والأقساط:**\n\n` +
          `- إجمالي المبالغ الآجلة لدى العملاء: **${Number(s.customerDebt || 0).toLocaleString('ar-EG')} ج.م**.${overdueInstStr}${debtorsStr}\n\n` +
          `**توصية زاد:** استفد من خاصية إرسال كشوف الحسابات عبر الواتساب لتذكير العملاء بلطف بسداد مستحقاتهم، وربط السداد السريع بمكافآت نقاط الولاء.`,
        suggestedQuestions: [
          'كسبت كام النهاردة؟',
          'مستحقات وفواتير الموردين',
          'ايه نواقص المخزن الحرجة؟',
        ],
        metrics: s,
        engine: 'local_analytics',
      };
    }

    // 5: النواقص والمخزون ورأس المال المقيد
    if (q.includes('نواقص') || q.includes('مخزن') || q.includes('بضاعة') || q.includes('بضاعه') || q.includes('راكد') || q.includes('خلصت') || q.includes('منتجات') || q.includes('قيمة المخزون') || q.includes('جرد') || q.includes('راس المال') || q.includes('رأس المال') || q.includes('تكلفة البضاعة')) {
      const itemsStr = s.lowStockItems && s.lowStockItems.length > 0
        ? `\n\n**أبرز الأصناف التي قاربت على النفاد:**\n` + s.lowStockItems.map((p: any, i: number) => `${i + 1}. **${p.name}** (المتبقي: **${p.stock}** قطعة - حد الأمان: ${p.min})`).join('\n')
        : '\n\nجميع الأصناف متوفرة وتتخطى حدود الأمان.';

      const potentialProfit = Math.max(0, Number(s.inventoryRetailValue || 0) - Number(s.inventoryCost || 0));

      return {
        answer: `**حالة المخزون ورأس المال المقيد:**\n\n` +
          `- إجمالي الأصناف النشطة: **${s.totalProducts} صنف**.\n` +
          `- تكلفة المخزون الحالي (رأس المال المجمد): **${Number(s.inventoryCost || 0).toLocaleString('ar-EG')} ج.م**.\n` +
          `- القيمة البيعية التقديرية: **${Number(s.inventoryRetailValue || 0).toLocaleString('ar-EG')} ج.م**.\n` +
          `- هامش الربح الإجمالي المتوقع في البضاعة: **${potentialProfit.toLocaleString('ar-EG')} ج.م**.\n` +
          `- أصناف حرجة تحتاج إعادة طلب: **${s.lowStock} صنف**${itemsStr}\n\n` +
          `**توصية زاد:** قم بإنشاء أوامر شراء عاجلة للأصناف الحرجة لتجنب نفاد المخزون وفقدان العملاء.`,
        suggestedQuestions: [
          'كسبت كام النهاردة؟',
          'مين أكتر عملاء عليهم فلوس؟',
          'أكتر 5 منتجات مبيعاً',
        ],
        metrics: s,
        engine: 'local_analytics',
      };
    }

    // 6: الأكثر طلباً ومبيعاً
    if (q.includes('اكثر') || q.includes('أكثر') || q.includes('شائع') || q.includes('سحب') || q.includes('مبيعا') || q.includes('مبيعاً') || q.includes('ترند') || q.includes('اعلى مبيع') || q.includes('أعلى مبيع') || q.includes('بست سيلر')) {
      const monthlyStr = s.topProductsMonth && s.topProductsMonth.length > 0
        ? `\n\n**الأكثر مبيعاً خلال آخر 30 يوماً:**\n` + s.topProductsMonth.map((p: any, i: number) => `${i + 1}. **${p.name}** (إجمالي مبيعات: **${p.qty}** قطعة)`).join('\n')
        : '\n\nلم يتم تسجيل بيانات مبيعات كافية خلال الشهر.';

      return {
        answer: `**تحليل الأصناف الأكثر طلباً وحركة:**${monthlyStr}\n\n` +
          `**توصية زاد:** احرص على الحفاظ على مخزون أمان مرتفع من هذه الأصناف الرابحة، وفكر في عمل عروض مجمعة (Bundles) مع الأصناف الأقل حركة لزيادة متوسط قيمة الفاتورة.`,
        suggestedQuestions: [
          'كسبت كام النهاردة؟',
          'ايه نواقص المخزن الحرجة؟',
          'ازاي أزود أرباحي النهاردة؟',
        ],
        metrics: s,
        engine: 'local_analytics',
      };
    }

    // 7: استشارات وأفكار لزيادة الأرباح وتطوير النشاط (Business Advisory)
    if (q.includes('نصيحة') || q.includes('نصيحه') || q.includes('ازاي') || q.includes('كيف') || q.includes('أزود') || q.includes('ازود') || q.includes('زيادة') || q.includes('تطوير') || q.includes('افكار') || q.includes('أفكار') || q.includes('اقتراح') || q.includes('اقتراحات')) {
      return {
        answer: `**خطة ذكية مقترحة لزيادة أرباحك وتطوير المنشأة:**\n\n` +
          `1. **التحصيل السريع:** لديك **${Number(s.customerDebt || 0).toLocaleString('ar-EG')} ج.م** ديون خارجية. تحصيل 30% منها يوفر لك سيولة فورية تمول بها مشتريات بضائع سريعة الدوران دون الحاجة للاستدانة.\n` +
          `2. **حماية المبيعات من النواقص:** يوجد **${s.lowStock} صنف حرج**. كل زبون يطلب صنفاً ناقصاً يقلل ولاءه؛ جهز أمر شراء اليوم للأصناف الأكثر طلباً.\n` +
          `3. **عروض الحزم (Cross-selling):** اربط المنتجات الأكثر مبيعاً مع الأصناف بطيئة الحركة في عرض مخفض لزيادة متوسط قيمة الفاتورة.\n` +
          `4. **ضبط المصروفات:** احرص على ألا تتجاوز المصاريف اليومية نسبة 15% من إجمالي المبيعات لتعظيم صافي أرباحك.\n\n` +
          `**توصية زاد:** فعّل نظام نقاط الولاء لعملائك لضمان عودتهم المستمرة للشراء.`,
        suggestedQuestions: [
          'كسبت كام النهاردة؟',
          'مين أكتر عملاء عليهم فلوس؟',
          'ايه نواقص المخزن الحرجة؟',
        ],
        metrics: s,
        engine: 'local_analytics',
      };
    }

    // 8: مبيعات وأرباح اليوم أو الأسبوع
    if (q.includes('كسبت') || q.includes('ارباح') || q.includes('أرباح') || q.includes('مبيعات') || q.includes('اليوم') || q.includes('دخل') || q.includes('اسبوع') || q.includes('أسبوع') || q.includes('شهر') || q.includes('فواتير') || q.includes('بيع')) {
      const topStr = s.topProductsToday && s.topProductsToday.length > 0
        ? `\n\n**أعلى الأصناف طلباً اليوم:**\n` + s.topProductsToday.map((p: any, i: number) => `${i + 1}. **${p.name}** (${p.qty} قطعة بـ ${Number(p.total || 0).toLocaleString('ar-EG')} ج.م)`).join('\n')
        : '\n\nلم يتم تسجيل مبيعات أصناف محددة لليوم بعد.';

      return {
        answer: `**تقرير مبيعات وأداء النشاط:**\n\n` +
          `- إجمالي مبيعات اليوم: **${Number(s.todaySales || 0).toLocaleString('ar-EG')} ج.م** (${s.todayCount} فاتورة).\n` +
          `- النقدية المحصلة بالدرج اليوم: **${Number(s.todayCash || 0).toLocaleString('ar-EG')} ج.م**.\n` +
          `- مصروفات اليوم: **${Number(s.todayExpenses || 0).toLocaleString('ar-EG')} ج.م**.\n` +
          `- صافي النقدية التقديري اليوم: **${Number((s.todayCash || 0) - (s.todayExpenses || 0)).toLocaleString('ar-EG')} ج.م**.\n` +
          `- إجمالي مبيعات آخر 7 أيام: **${Number(s.weekSales || 0).toLocaleString('ar-EG')} ج.م** (${s.weekCount} فاتورة).${topStr}\n\n` +
          `**توصية زاد:** ${s.todayCount > 0 ? 'معدل البيع ممتاز، احرص على مطابقة جرد النقدية بالدرج قبل إغلاق الوردية.' : 'ننصح بتفعيل عروض ترويجية للأصناف سريعة الدوران لتحريك المبيعات اليوم.'}`,
        suggestedQuestions: [
          'مين أكتر عملاء عليهم فلوس؟',
          'ايه نواقص المخزن الحرجة؟',
          'فلوس الخزينة والدرج الحالية',
        ],
        metrics: s,
        engine: 'local_analytics',
      };
    }

    // 9: الإجابة الشاملة العامة (Executive Overview)
    return {
      answer: `**أهلاً بك يا فندم! إليك نبض المنشأة الشامل لحظة بلحظة:**\n\n` +
        `- **مبيعات اليوم:** ${Number(s.todaySales || 0).toLocaleString('ar-EG')} ج.م (${s.todayCount} فاتورة).\n` +
        `- **المحصل نقداً بالدرج:** ${Number(s.todayCash || 0).toLocaleString('ar-EG')} ج.م.\n` +
        `- **مصروفات اليوم:** ${Number(s.todayExpenses || 0).toLocaleString('ar-EG')} ج.م.\n` +
        `- **مبيعات آخر 7 أيام:** ${Number(s.weekSales || 0).toLocaleString('ar-EG')} ج.م.\n` +
        `- **ديون العملاء الآجلة:** ${Number(s.customerDebt || 0).toLocaleString('ar-EG')} ج.م.\n` +
        `- **مستحقات الموردين:** ${Number(s.supplierDebt || 0).toLocaleString('ar-EG')} ج.م.\n` +
        `- **نواقص المخزن الحرجة:** ${s.lowStock} صنف يحتاج لإعادة طلب.\n` +
        `- **رأس المال المقيد بالمخزون:** ${Number(s.inventoryCost || 0).toLocaleString('ar-EG')} ج.م بالتكلفة.\n\n` +
        `أنا هنا لمساعدتك! يمكنك اختيار سؤال جاهز من المقترحات أدناه أو كتابة سؤالك وسأجيبك فوراً.`,
      suggestedQuestions: [
        'كسبت كام النهاردة؟',
        'فلوس الخزينة والدرج الحالية',
        'مين أكتر عملاء عليهم فلوس؟',
        'مستحقات وفواتير الموردين',
        'ايه نواقص المخزن الحرجة؟',
        'أكتر 5 منتجات مبيعاً',
      ],
      metrics: s,
      engine: 'local_analytics',
    };
  }
}
