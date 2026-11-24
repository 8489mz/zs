/**
 * Scenario 6: يوم تشغيلي كامل تحت الضغط — بيع، آجل، مرتجعات، مشتريات، متجر، تقارير، مزامنة.
 *
 * ## ما الذي يقيسه هذا الملف، وما الذي لا يقيسه
 *
 * اختبار الحِمل **لا يقول** «النظام جاهز للبيع» — لا يعرف إن كانت الميزات مكتملة. أول جولة بيع على
 * الإنتاج كانت أرقام أدائها ممتازة بينما المنصة كلها تبيع بلا دفاتر؛ الاختبار كشفها لأنه **لمس
 * المسار**، لا لأنه قاس السرعة.
 *
 * فغرض هذا الملف: أن **يلمس كل مسار مالي بالتوازي**، ثم تُسأل قاعدة البيانات بعده ستة أسئلة تثبت
 * أن الدفاتر والمخزون ما زالا متسقين (انظر `docs/LOAD_TESTING.md` §8). تلك الأسئلة — لا الـp95 —
 * هي ما يجيب «هل نحن جاهزون؟».
 *
 * ## المجموعات المتزامنة
 *
 *   cash_sales      بيع نقدي: فاتورة + قيد + مخزون + صف الوردية
 *   credit_sales    بيع آجل لعميل عشوائي: قيد ذمم + **تزاحم على صف العميل** (نوع تزاحم آخر)
 *   returns         يبيع ثم يرتجع جزءاً: عكس القيد وإرجاع المخزون — أخطر مسار غير مختبر
 *   hot_product     الجميع على **صنف واحد**: الحمل الموزّع لا يكشف خرق ترتيب الأقفال
 *   purchases       شراء من مورد عشوائي: مخزون داخل + ذمم موردين
 *   storefront      طلبات متجر على نفس المخزون الذي تستهلكه الكاشيرات
 *   catalog_sync    مزامنة كتالوج الكاشير — على كتالوج حقيقي هذه المرة
 *   reports         قراءة تقارير مالية بينما كل ما سبق يكتب
 *   health          هل ما زال الصندوق يرد
 *
 * ⚠️ كل هذا **كتابة حقيقية لا تُلغى**: القيد المزدوج غير قابل للحذف بحكم ثابت معماري، والمخزون
 *    يُستهلك. لا تشغّله على منشأة حقيقية.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import {
  BASE_URL,
  STOREFRONT_SLUG,
  DEFAULT_HEADERS,
  AUTH_USERNAME,
  AUTH_PASSWORD,
  WRITE_THRESHOLDS,
  rampProfile,
  clientIpHeaders,
  writerIpHeaders,
  classifyWriteFailure,
  isLockConflict,
  selectOrderableItems,
  buildOrderPayload,
  loginOrDie,
  sessionParams,
  writeParams,
  RAMP_SECONDS,
  HOLD_SECONDS,
} from '../config.js';

const cashSaleMs = new Trend('fs_cash_sale_ms');
const creditSaleMs = new Trend('fs_credit_sale_ms');
const returnMs = new Trend('fs_return_ms');
const purchaseMs = new Trend('fs_purchase_ms');
const hotSaleMs = new Trend('fs_hot_product_sale_ms');
const reportMs = new Trend('fs_report_ms');
const catalogSyncMs = new Trend('fs_catalog_sync_ms');
const orderMs = new Trend('fs_online_order_ms');

const cashSaleOk = new Rate('fs_cash_sale_success');
const creditSaleOk = new Rate('fs_credit_sale_success');
const returnOk = new Rate('fs_return_success');
const purchaseOk = new Rate('fs_purchase_success');
const hotSaleOk = new Rate('fs_hot_product_success');
const orderOk = new Rate('fs_online_order_success');

const deadlocks = new Counter('fs_deadlocks_detected');
const serverErrors = new Counter('fs_server_errors');
const businessRejects = new Counter('fs_business_rejects');
const rateLimited = new Counter('fs_rate_limited');
const unitsSold = new Counter('fs_units_sold');
const unitsReturned = new Counter('fs_units_returned');
const unitsPurchased = new Counter('fs_units_purchased');
/**
 * رفض بسبب سقف ائتمان العميل ليس فشلاً — هو الحارس يعمل. الجولة الثانية رفضت 282 فاتورة آجلة
 * بـ`CUSTOMER_CREDIT_LIMIT` لأن السيناريو يقصف مئة عميل بلا توقف حتى يمتلئ رصيدهم، وهو سلوك
 * صحيح من السيرفر وخطأ في المحاكاة. يُعَدّ على حدة ولا يُحسب ضمن نسبة النجاح.
 */
const creditLimitReached = new Counter('fs_credit_limit_reached');

function cashierCredentials() {
  const raw = String(__ENV.CASHIERS || '').trim();
  if (!raw) return [{ username: AUTH_USERNAME, password: AUTH_PASSWORD }];
  return raw.split(',').map((pair) => pair.trim()).filter(Boolean).map((pair) => {
    const at = pair.indexOf(':');
    if (at < 1) throw new Error(`CASHIERS entry "${pair}" must be username:password`);
    return { username: pair.slice(0, at), password: pair.slice(at + 1) };
  });
}

/** أوزان المجموعات. المجموع لا يلزم أن يكون واحداً — كل واحدة نسبة من الذروة. */
const MIX = {
  cash_sales: Number(__ENV.MIX_CASH || 0.34),
  credit_sales: Number(__ENV.MIX_CREDIT || 0.14),
  returns: Number(__ENV.MIX_RETURNS || 0.12),
  hot_product: Number(__ENV.MIX_HOT || 0.14),
  purchases: Number(__ENV.MIX_PURCHASES || 0.08),
  storefront: Number(__ENV.MIX_STOREFRONT || 0.12),
  catalog_sync: Number(__ENV.MIX_CATALOG || 0.1),
  reports: Number(__ENV.MIX_REPORTS || 0.06),
};

function stagesFor(share) {
  return rampProfile().map((stage) => ({
    duration: stage.duration,
    target: stage.target > 0 ? Math.max(1, Math.round(stage.target * share)) : 0,
  }));
}

function group(exec, share, gracefulRampDown = '15s') {
  return { executor: 'ramping-vus', startVUs: 1, stages: stagesFor(share), exec, gracefulRampDown };
}

export const options = {
  scenarios: {
    cash_sales: group('cashSaleScenario', MIX.cash_sales),
    credit_sales: group('creditSaleScenario', MIX.credit_sales),
    returns: group('returnScenario', MIX.returns),
    hot_product: group('hotProductScenario', MIX.hot_product),
    purchases: group('purchaseScenario', MIX.purchases),
    storefront: group('storefrontScenario', MIX.storefront),
    catalog_sync: group('catalogSyncScenario', MIX.catalog_sync),
    reports: group('reportScenario', MIX.reports),
    health: {
      executor: 'constant-vus',
      vus: 2,
      duration: `${RAMP_SECONDS + HOLD_SECONDS + 15}s`,
      exec: 'healthScenario',
    },
  },
  thresholds: {
    // لا `http_req_failed` هنا عمداً: الجولة تستدعي رفضاً صحيحاً (سقف الائتمان) وk6 يعدّ كل 4xx
    // فشلاً على مستوى HTTP، فتخرج الجولة حمراء بسبب حارس يعمل. المقياس الدقيق هو نسبة نجاح كل
    // مسار على حدة، و`fs_server_errors` الذي يجب أن يبقى صفراً.
    http_req_duration: WRITE_THRESHOLDS.http_req_duration,
    fs_cash_sale_success: ['rate>0.95'],
    fs_credit_sale_success: ['rate>0.95'],
    fs_return_success: ['rate>0.90'],
    fs_hot_product_success: ['rate>0.90'], // تزاحم مقصود على صف واحد
    fs_deadlocks_detected: ['count==0'],
    fs_server_errors: ['count==0'],
  },
};

// ---------------------------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------------------------

function jsonOrDie(res, what) {
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`${what} returned HTTP ${res.status}: ${String(res.body || '').slice(0, 250)}`);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new Error(`${what} returned a body k6 could not parse: ${String(res.body || '').slice(0, 200)}`);
  }
}

function ensureOpenShift(session, branchId) {
  const opened = http.post(
    `${BASE_URL}/api/cashier-shifts/open`,
    JSON.stringify({ openingCash: 0, note: 'load test', branchId }),
    writeParams(session),
  );
  if (opened.status === 200 || opened.status === 201) return;
  if (String(opened.body || '').includes('SHIFT_ALREADY_OPEN')) return;
  throw new Error(
    `could not open a cashier shift for "${session.username}" (HTTP ${opened.status}): `
    + String(opened.body || '').slice(0, 250),
  );
}

export function setup() {
  const sessions = cashierCredentials().map((c) => loginOrDie(c.username, c.password));

  /**
   * جلسة قراءة التقارير.
   *
   * التقارير المالية تحت `@RequireAnyPermission('accounting', 'accounts')`، وقراءتها بحساب كاشير
   * ترد 403 — فتقيس الجولة رفض التفويض لا التقارير. والحل ليس أخذ أي حساب «مالك»: أول محاولة
   * أخذته من `AUTH_USERNAME` في ملف بيانات الدخول، وكان **لمنشأة أخرى**، فقرأ الإعداد فروع تلك
   * المنشأة وماتت الجولة بـ«لا فرع فيه بضاعة».
   *
   * فالقاعدة هنا: `OWNER=user:pass` صراحةً إن أردت التقارير، **ويجب أن يكون على نفس المنشأة**.
   * وبدونه نجرّب جلسة الكاشير مرة واحدة على تقرير واحد: إن قُبلت استعملناها، وإن رُدّت 403
   * **أُلغيت مجموعة التقارير** بسطر واضح. لا إجهاض للجولة كلها من أجل أقل مساراتها أهمية، ولا
   * تجاهل صامت.
   */
  const cashierTenant = String(sessions[0].tenantId || '');
  for (const session of sessions) {
    if (String(session.tenantId || '') !== cashierTenant) {
      throw new Error(
        `cashiers are not on one tenant: "${sessions[0].username}" is on ${cashierTenant} but `
        + `"${session.username}" is on ${String(session.tenantId || 'unknown')}.`,
      );
    }
  }

  let admin = sessions[0];
  let reportsEnabled = true;
  const ownerPair = String(__ENV.OWNER || '').trim();
  if (ownerPair) {
    const at = ownerPair.indexOf(':');
    if (at < 1) throw new Error('OWNER must be username:password');
    const owner = loginOrDie(ownerPair.slice(0, at), ownerPair.slice(at + 1));
    if (String(owner.tenantId || '') !== cashierTenant) {
      throw new Error(
        `OWNER "${owner.username}" is on tenant ${String(owner.tenantId || 'unknown')} while the cashiers `
        + `are on ${cashierTenant}. A run split across two tenants reads one and writes to the other.`,
      );
    }
    admin = owner;
  }

  // --- فرع فيه بضاعة فعلاً (لا فرع «له مخزن» فقط) ---
  const branches = (jsonOrDie(http.get(`${BASE_URL}/api/branches`, sessionParams(sessions[0])), 'branches').branches || [])
    .filter((b) => b && b.id && b.defaultStockLocationId);
  if (branches.length === 0) {
    throw new Error('no branch has a default stock location; a POS sale is refused with POS_DEFAULT_STOCK_REQUIRED');
  }

  let branchId = 0;
  let locationId = 0;
  let sellable = [];
  const tried = [];
  for (const branch of branches) {
    const candidate = Number(branch.id);
    const body = jsonOrDie(
      http.get(`${BASE_URL}/api/catalog/pos-products?limit=500&branchId=${candidate}`, sessionParams(sessions[0])),
      'POS catalog',
    );
    const rows = body.products || body.items || [];
    const items = rows
      .map((p) => ({
        id: Number(p.id),
        name: String(p.name || ''),
        price: Number(p.retailPrice ?? 0),
        cost: Number(p.retailPrice ?? 0) > 0 ? Math.max(1, Math.round(Number(p.retailPrice) * 0.6)) : 1,
        stock: Number(p.stock ?? 0),
        qty: 1,
      }))
      .filter((p) => p.id > 0 && p.price > 0 && p.stock > 0
        && String(rows.find((r) => Number(r.id) === p.id)?.itemType || 'product') === 'product'
        && !rows.find((r) => Number(r.id) === p.id)?.trackSerials
        && !rows.find((r) => Number(r.id) === p.id)?.hasBom)
      .sort((a, b) => b.stock - a.stock)
      .slice(0, 150);
    tried.push(`${branch.name || '#' + candidate}: ${items.length}/${rows.length}`);
    if (items.length > 0) {
      branchId = candidate;
      locationId = Number(branch.defaultStockLocationId);
      sellable = items;
      break;
    }
  }
  if (sellable.length === 0) {
    throw new Error(`no branch has sellable stock. Tried (sellable/read): ${tried.join(' · ')}`);
  }

  // --- عملاء للبيع الآجل، وموردون للمشتريات ---
  //
  // `boundedPage` يسقف `pageSize` عند **200** (`bounded-page.ts`)، فطلب 500 يعيد 200 ولا
  // شيء أكثر. وهذا ما جعل مئة عميل يستقبلون كل الفواتير الآجلة حتى امتلأت سقوفهم الائتمانية —
  // بدا رفضاً، وكان الحارس يعمل والمحاكاة ضيّقة. نتصفّح الصفحات بدل أن نطلب رقماً لا يُعطى.
  const collectIds = (path, key, pages) => {
    const ids = [];
    for (let page = 1; page <= pages; page += 1) {
      const res = http.get(`${BASE_URL}${path}?page=${page}&pageSize=100`, sessionParams(sessions[0]));
      if (res.status !== 200) break;
      let rows = [];
      try {
        rows = JSON.parse(res.body)[key] || [];
      } catch { break; }
      if (rows.length === 0) break;
      for (const row of rows) {
        const id = Number(row.id);
        if (id > 0) ids.push(id);
      }
      if (rows.length < 100) break;
    }
    return ids;
  };

  const customers = collectIds('/api/customers', 'customers', 6);
  const suppliers = collectIds('/api/suppliers', 'suppliers', 3);

  if (customers.length === 0) {
    throw new Error('no customer found: a credit sale is refused with CUSTOMER_REQUIRED_FOR_CREDIT, so that half would measure nothing');
  }

  // --- ورديات ---
  for (const session of sessions) ensureOpenShift(session, branchId);

  // --- فاتورة تجريبية واحدة: أرخص من اكتشاف الرفض بعد ثلاث دقائق ---
  const probe = http.post(`${BASE_URL}/api/sales`, buildSaleBody([{ ...sellable[0], qty: 1 }], branchId), writeParams(sessions[0], {
    'x-idempotency-key': `fs-probe-${Date.now()}`,
  }));
  if (probe.status !== 200 && probe.status !== 201) {
    throw new Error(`preflight sale was refused (HTTP ${probe.status}). The server said: ${String(probe.body || '').slice(0, 300)}`);
  }

  // --- هل تُقرأ التقارير بهذه الجلسة أصلاً؟ سؤال واحد بدل 244 رفضاً ---
  const reportProbe = http.get(`${BASE_URL}/api/accounting/reports/financial-summary`, sessionParams(admin));
  if (reportProbe.status !== 200) {
    reportsEnabled = false;
    // eslint-disable-next-line no-console
    console.warn(
      `[setup] reports are disabled for this run: "${admin.username}" got HTTP ${reportProbe.status} on `
      + 'the financial summary. Pass OWNER=user:pass for an account on this tenant with the accounting '
      + 'permission to include them.',
    );
  }

  // --- سلة المتجر ---
  let cart = [];
  try {
    const sf = JSON.parse(http.get(`${BASE_URL}/api/storefront/${STOREFRONT_SLUG}/catalog`, { headers: DEFAULT_HEADERS }).body);
    const info = JSON.parse(http.get(`${BASE_URL}/api/storefront/${STOREFRONT_SLUG}/info`, { headers: DEFAULT_HEADERS }).body);
    cart = selectOrderableItems(sf.products || sf.items || [], Number(info.minOrder || 0));
  } catch {}

  // eslint-disable-next-line no-console
  console.log(
    `[setup] ${sessions.length} cashiers + 1 owner · branch #${branchId} (location #${locationId}) · ${sellable.length} sellable products · `
    + `${customers.length} customers · ${suppliers.length} suppliers · ${cart.length} storefront items. `
    + 'Sales, returns and purchases are NOT reversible - this must not be a live tenant.',
  );

  return { sessions, admin, reportsEnabled, sellable, hot: sellable[0], branchId, locationId, customers, suppliers, cart };
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

function buildSaleBody(items, branchId, extra) {
  const lines = items.map((p) => ({ productId: p.id, qty: p.qty, price: p.price }));
  const total = Math.round(lines.reduce((sum, l) => sum + l.price * l.qty, 0) * 100) / 100;
  const base = {
    paymentType: 'cash',
    paymentChannel: 'cash',
    source: 'pos',
    branchId,
    items: lines,
    payments: [{ paymentChannel: 'cash', amount: total }],
    tenderedAmount: total,
    note: 'load test',
  };
  return JSON.stringify({ ...base, ...(extra || {}) });
}

function sessionFor(data) {
  return data.sessions[__VU % data.sessions.length];
}

function pickItems(pool, maxLines) {
  const count = 1 + Math.floor(Math.random() * maxLines);
  const chosen = [];
  const seen = {};
  for (let i = 0; i < count; i += 1) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (seen[pick.id]) continue;
    seen[pick.id] = true;
    chosen.push({ ...pick, qty: 1 + Math.floor(Math.random() * 2) });
  }
  return chosen;
}

/**
 * عدّاد لكل مسار على حدة.
 *
 * البوابة السابقة كانت `__VU <= 2`، و`__VU` في k6 **عام عبر كل المجموعات** لا مرقَّم داخل كل
 * واحدة. فمع 167 مستخدماً موزّعين على تسع مجموعات، لم يقع المستخدمان الأول والثاني في
 * `credit_sales` ولا `returns` ولا `reports` قط — فرُفض 1,543 طلباً **بلا سطر واحد يقول لماذا**،
 * وهو بالضبط ما بُني التصنيف كله لمنعه. البوابة الآن لكل تسمية، فأول رفضين في كل مسار يُطبعان.
 */
const loggedPerLabel = {};

function recordFailure(res, label) {
  const body = String(res.body || '');
  if (isLockConflict(res)) deadlocks.add(1);
  const reason = classifyWriteFailure(res);
  if (reason === 'rate_limited') rateLimited.add(1);
  else if (reason === 'server_error' || reason === 'no_response') serverErrors.add(1);
  else businessRejects.add(1);

  const seen = loggedPerLabel[label] || 0;
  if (seen < 2) {
    loggedPerLabel[label] = seen + 1;
    // eslint-disable-next-line no-console
    console.warn(`[${label} refused: ${reason}] HTTP ${res.status} - ${body.slice(0, 220)}`);
  }
}

function postSale(session, items, branchId, extra, durationMetric, successMetric, label) {
  const body = buildSaleBody(items, branchId, extra);
  const params = writeParams(session, {
    ...clientIpHeaders(__VU),
    'x-idempotency-key': `fs-${label}-${__VU}-${__ITER}-${Date.now()}`,
  });
  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/sales`, body, params);
  durationMetric.add(Date.now() - start);

  // سقف ائتمان العميل يُفحص **قبل** `check`، لا بعده.
  //
  // كان `check` يُنفَّذ أولاً، فيُسجَّل رفضٌ صحيح «فحصاً فاشلاً» وإن استُثني من نسبة النجاح: خرج
  // الإخراج بـ«credit sale posted 41%» و«checks_failed 7.6%» على جولةٍ كلُّ مساراتها سليمة. وقد
  // كتبتُ بنفسي أن عتبةً تبقى حمراء دائماً تُهمَل — ثم صنعتُ واحدة.
  if (String(res.body || '').includes('CUSTOMER_CREDIT_LIMIT')) {
    creditLimitReached.add(1);
    return null;
  }

  const ok = check(res, { [`${label} posted`]: (r) => r.status === 200 || r.status === 201 });
  successMetric.add(ok ? 1 : 0);
  if (!ok) { recordFailure(res, label); return null; }

  unitsSold.add(items.reduce((sum, i) => sum + i.qty, 0));
  try {
    const parsed = JSON.parse(res.body);
    const sale = parsed.sale || parsed;
    return { id: Number(sale.id || parsed.saleId || 0), items };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------------------------

export function cashSaleScenario(data) {
  postSale(sessionFor(data), pickItems(data.sellable, 3), data.branchId, undefined, cashSaleMs, cashSaleOk, 'cash sale');
  sleep(1);
}

/** البيع الآجل: قيد ذمم، و**تزاحم على صف العميل** — نوع تزاحم لا يظهر في البيع النقدي. */
export function creditSaleScenario(data) {
  const customerId = data.customers[Math.floor(Math.random() * data.customers.length)];
  // لا `total` هنا: ليس حقلاً في `UpsertSaleDto`، والأنبوب العام `forbidNonWhitelisted: true`
  // (`request-validation.pipe.ts`) فيرد 400 على أي حقل زائد. أُرسل في أول جولة فرُفضت 959 فاتورة
  // آجلة من 959 — والسيرفر يحسب الإجمالي بنفسه على أي حال.
  postSale(
    sessionFor(data), pickItems(data.sellable, 2), data.branchId,
    { paymentType: 'credit', paymentChannel: 'credit', customerId, payments: [], tenderedAmount: 0 },
    creditSaleMs, creditSaleOk, 'credit sale',
  );
  sleep(1.2);
}

/**
 * يبيع ثم يرتجع جزءاً من نفس الفاتورة.
 *
 * المرتجع مسار **عكسي** على نفس الأقفال: يعكس القيد ويعيد المخزون. وهو أخطر ما كان غير مختبر —
 * الخطأ فيه لا يظهر كبطء، يظهر كمخزون أو دفتر لا يتطابق بعد شهر.
 */
export function returnScenario(data) {
  const session = sessionFor(data);
  const items = pickItems(data.sellable, 2).map((item) => ({ ...item, qty: 2 }));
  const sale = postSale(session, items, data.branchId, undefined, cashSaleMs, cashSaleOk, 'sale before return');
  if (!sale || !sale.id) { sleep(1); return; }

  const returned = sale.items.map((item) => ({ productId: item.id, qty: 1 }));
  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/returns`, JSON.stringify({
    type: 'sale',
    invoiceId: sale.id,
    items: returned,
    settlementMode: 'refund',
    refundMethod: 'cash',
    note: 'load test return',
    // المرتجع يحتاج اعتماداً (`MANAGER_AUTH_REQUIRED` 403)، ويقبل كلمة مرور المستخدم نفسه كما
    // يقبل رمز المشرف (`verifyManagerAuthorization`). غيابه رفض 337 مرتجعاً من 337 في أول جولة.
    managerPin: session.password,
  }), writeParams(session, {
    ...clientIpHeaders(__VU),
    'x-idempotency-key': `fs-return-${__VU}-${__ITER}-${Date.now()}`,
  }));
  returnMs.add(Date.now() - start);

  const ok = check(res, { 'return posted': (r) => r.status === 200 || r.status === 201 });
  returnOk.add(ok ? 1 : 0);
  if (ok) unitsReturned.add(returned.length);
  else recordFailure(res, 'return');
  sleep(1.5);
}

export function hotProductScenario(data) {
  postSale(sessionFor(data), [{ ...data.hot, qty: 1 }], data.branchId, undefined, hotSaleMs, hotSaleOk, 'hot product sale');
  sleep(0.6);
}

/** الشراء: مخزون داخل وذمم موردين — الاتجاه المعاكس للبيع على نفس الجداول. */
export function purchaseScenario(data) {
  if (!data.suppliers || data.suppliers.length === 0) { sleep(2); return; }
  const session = sessionFor(data);
  const supplierId = data.suppliers[Math.floor(Math.random() * data.suppliers.length)];
  const items = pickItems(data.sellable, 2).map((item) => ({ productId: item.id, qty: 5, cost: item.cost }));

  const start = Date.now();
  // `LOCATION_REQUIRED`: سطر الشراء يحتاج **مكان استلام**، والفرع وحده لا يكفي. رفض 30 من 197 في
  // الجولة الثانية — والباقي نجح لأن أصنافه كان لها صف مخزون قائم يستنتج منه المكان.
  const res = http.post(`${BASE_URL}/api/purchases`, JSON.stringify({
    supplierId,
    paymentType: 'credit',
    branchId: data.branchId,
    locationId: data.locationId,
    items: items.map((item) => ({ ...item, locationId: data.locationId })),
    note: 'load test purchase',
  }), writeParams(session, {
    ...clientIpHeaders(__VU),
    'x-idempotency-key': `fs-purchase-${__VU}-${__ITER}-${Date.now()}`,
  }));
  purchaseMs.add(Date.now() - start);

  const ok = check(res, { 'purchase posted': (r) => r.status === 200 || r.status === 201 });
  purchaseOk.add(ok ? 1 : 0);
  if (ok) unitsPurchased.add(items.reduce((sum, i) => sum + i.qty, 0));
  else recordFailure(res, 'purchase');
  sleep(2);
}

export function storefrontScenario(data) {
  if (!data.cart || data.cart.length === 0) { sleep(2); return; }
  const item = data.cart[Math.floor(Math.random() * data.cart.length)];
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/storefront/${STOREFRONT_SLUG}/orders`,
    buildOrderPayload(item, __VU, 'Nasr City, Cairo'),
    { headers: { ...DEFAULT_HEADERS, ...writerIpHeaders(__VU, __ITER) } },
  );
  orderMs.add(Date.now() - start);
  const ok = check(res, { 'online order accepted': (r) => r.status === 200 || r.status === 201 });
  orderOk.add(ok ? 1 : 0);
  if (!ok) recordFailure(res, 'online order');
  sleep(1.5);
}

/** مزامنة الكاشير — على كتالوج حقيقي هذه المرة، لا كتالوج فارغ. */
export function catalogSyncScenario(data) {
  const params = sessionParams(sessionFor(data), clientIpHeaders(__VU));
  const start = Date.now();
  const version = http.get(`${BASE_URL}/api/catalog/pos-products/version`, params);
  check(version, { 'catalog version is 200': (r) => r.status === 200 });
  if (Math.random() < 0.3) {
    http.get(`${BASE_URL}/api/catalog/pos-products?limit=200&branchId=${data.branchId}`, params);
  }
  catalogSyncMs.add(Date.now() - start);
  sleep(1);
}

/** تقارير مالية تُقرأ بينما كل ما سبق يكتب. */
/**
 * التقارير تُقرأ بجلسة **المالك/المحاسب** لا بجلسة كاشير.
 *
 * الجولة الثانية ردّت 403 على 244 طلباً: التقارير المحاسبية تحت
 * `@RequireAnyPermission('accounting', 'accounts')`، وليس من عمل موظف الكاشير أن يقرأ الميزانية.
 * محاكاةُ قراءتها بحساب كاشير تقيس رفض التفويض، لا التقارير تحت الحمل.
 */
export function reportScenario(data) {
  if (!data.reportsEnabled) { sleep(5); return; }
  const params = sessionParams(data.admin, clientIpHeaders(__VU));
  // المسار تحت `api/accounting` لا `api` (`@Controller('api/accounting')`). العنوان الخاطئ ردّ 404
  // في ثلاث مللي ثانية، فبدت التقارير «تفشل» بينما لم تُستدعَ أصلاً.
  const reports = ['financial-summary', 'receivables-payables', 'inventory-value', 'cash-movement'];
  const report = reports[Math.floor(Math.random() * reports.length)];
  const start = Date.now();
  const res = http.get(`${BASE_URL}/api/accounting/reports/${report}`, params);
  reportMs.add(Date.now() - start);
  const ok = check(res, { 'report is 200': (r) => r.status === 200 });
  if (!ok) recordFailure(res, 'report');
  sleep(3);
}

export function healthScenario() {
  check(http.get(`${BASE_URL}/health`), { 'health probe ok': (r) => r.status === 200 });
  sleep(5);
}

/**
 * إقفال الورديات بعد العاصفة.
 *
 * الإقفال يتحقق من **كلمة مرور الكاشير نفسه** (`assertCurrentUserPassword`) لا من رمز مدير، فتُمرَّر
 * كلمة كل جلسة. وهو مسار تسوية نقدية كامل يستحق أن يُمَسّ ولو مرة، لا أن يبقى الوحيد غير المختبر.
 */
export function teardown(data) {
  if (String(__ENV.CLOSE_SHIFTS || '').toLowerCase() !== 'true') return;
  for (const session of data.sessions) {
    const listed = http.get(`${BASE_URL}/api/cashier-shifts?filter=open`, sessionParams(session));
    let shiftId = 0;
    try {
      const rows = JSON.parse(listed.body).cashierShifts || [];
      const mine = rows.find((r) => String(r.openedByUsername || r.opened_by_username || '') === session.username);
      shiftId = Number((mine || rows[0] || {}).id || 0);
    } catch {}
    if (!shiftId) continue;
    const res = http.post(`${BASE_URL}/api/cashier-shifts/${shiftId}/close`, JSON.stringify({
      countedCash: 0,
      note: 'load test close',
      managerPin: session.password,
    }), writeParams(session));
    // eslint-disable-next-line no-console
    console.log(`[teardown] shift ${shiftId} for ${session.username}: HTTP ${res.status}`);
  }
}
