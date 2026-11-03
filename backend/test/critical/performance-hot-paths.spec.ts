import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import { buildPosCatalogVersion } from '../../src/modules/catalog/engines/pos-catalog-version.engine';

// Guard for the performance invariants PERF-1 … PERF-4 (ARCHITECTURE_INVARIANTS.md §2.6).
// Each block locks a fix that was cheap to undo by accident and expensive to notice: nothing breaks
// functionally, the system just gets slow again. If one of these fails, read §2.6 before "fixing"
// the test — the test is usually right.

const SRC = join(__dirname, '..', '..', 'src');
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8');

const actor: AuthContext = {
  userId: 1,
  sessionId: 'perf-session',
  username: 'perf',
  role: 'admin',
  permissions: ['products', 'sales'],
  tenantId: 'tenant-perf',
  accountId: 'account-perf',
};

type StockRow = { product_id: number; location_id: number | null; qty: number };

// Minimal Kysely stand-in: only what resolveScopedStockByProduct touches.
function fakeDbReturning(rows: StockRow[]) {
  const builder = {
    select: () => builder,
    where: () => builder,
    execute: async () => rows,
  };
  return { selectFrom: () => builder };
}

function createCatalogService(rows: StockRow[]): any {
  return new CatalogProductService(fakeDbReturning(rows) as any, {} as any, {} as any);
}

// PERF-2 — behaviour of the scoped-stock aggregation must be exactly what it was before the rewrite.
async function testScopedStockSemantics(): Promise<void> {
  const service = createCatalogService([
    { product_id: 1, location_id: 10, qty: 5 },
    { product_id: 1, location_id: 20, qty: 3 },
    { product_id: 1, location_id: null, qty: 2 },
    { product_id: 2, location_id: 20, qty: 4 },
    { product_id: 3, location_id: 10, qty: 1 },
  ]);
  const products = [
    { id: 1, stock_qty: 10 }, // 5 + 3 assigned, 2 unassigned: no discrepancy
    { id: 2, stock_qty: 9 },  // 4 assigned elsewhere, no unassigned row: INV-POS-NET-STOCK-DISPLAY — the old "discrepancy 5 is sellable" add is gone, because checkout never credits stock with no location row (it reads the pool row only); display must equal the checkout figure, 0 here
    { id: 3, stock_qty: 1 },
    { id: 4, stock_qty: 7 },  // no stock rows at all: INV-POS-NET-STOCK-DISPLAY — no location row and no pool row means checkout can sell 0 at location 10, even though the global figure is 7
  ];

  const scoped = await service.resolveScopedStockByProduct([1, 2, 3, 4], [10], products, actor);
  assert.equal(scoped.stock.get('1'), 7, 'location 10 (5) + unassigned row (2)');
  assert.equal(scoped.stock.get('2'), 0, 'not in location 10 and no pool row: nothing checkout can sell');
  assert.equal(scoped.stock.get('3'), 1);
  assert.equal(scoped.stock.get('4'), 0, 'no location row and no pool row: nothing checkout can sell at location 10');
  assert.deepEqual(scoped.locations.get('1'), [10, 20]);
  assert.deepEqual(scoped.locations.get('2'), [20]);

  const multi = await service.resolveScopedStockByProduct([1], [10, 20], [{ id: 1, stock_qty: 10 }], actor);
  assert.equal(multi.stock.get('1'), 10, 'two eligible locations sum (5 + 3) plus unassigned (2)');

  const unscoped = await service.resolveScopedStockByProduct([1, 4], [], products, actor);
  assert.equal(unscoped.stock.get('1'), 10, 'no location scope: global stock_qty');
  assert.equal(unscoped.stock.get('4'), 7);
}

// PERF-2 — the full POS catalog sync (20k products, branch-scoped) must stay linear.
// The O(products × rows) version took minutes here; the linear one takes well under a second.
async function testScopedStockIsLinear(): Promise<void> {
  const productCount = 20_000;
  const rows: StockRow[] = [];
  const products: Array<{ id: number; stock_qty: number }> = [];
  for (let id = 1; id <= productCount; id++) {
    products.push({ id, stock_qty: 10 });
    rows.push({ product_id: id, location_id: 1, qty: 4 }, { product_id: id, location_id: 2, qty: 6 });
  }
  const service = createCatalogService(rows);
  const started = Date.now();
  const scoped = await service.resolveScopedStockByProduct([], [1], products, actor, true);
  const elapsed = Date.now() - started;
  assert.equal(scoped.stock.size, productCount);
  assert.equal(scoped.stock.get('123'), 4);
  assert.ok(elapsed < 2_000, `scoped stock for ${productCount} products took ${elapsed}ms — quadratic loop is back?`);
}

// PERF-2 — whole-catalog id lists go out as ONE array parameter, not one bind parameter per id
// (Postgres rejects > 65,535 parameters, i.e. a big catalog would crash the products page).
function testWholeCatalogIdListsUseArrayParameter(): void {
  const service = createCatalogService([]);
  const compiled = service.productIdAny('pls.product_id', [1, 2, 3]);
  const node = compiled.toOperationNode();
  const json = JSON.stringify(node);
  assert.ok(json.includes('ANY('), 'productIdAny must compile to = ANY($1::bigint[])');

  const source = read('modules/catalog/services/catalog-product.service.ts');
  const body = source.slice(source.indexOf('private async resolveScopedStockByProduct'), source.indexOf('private async buildListProductsContext'));
  assert.ok(!/stockRows\.(filter|find|some|reduce)\(/.test(body.slice(body.indexOf('for (const product of products)'))),
    'the per-product loop must read pre-aggregated maps, never rescan stockRows');
  assert.ok(body.includes("this.productIdAny('pls.product_id', productIds)"), 'stock rows filter uses the array parameter');
  const contextBody = source.slice(source.indexOf('private async buildListProductsContext'), source.indexOf('private filterListProducts'));
  assert.ok(!contextBody.includes("'in', productIds"), 'buildListProductsContext receives every product id — use productIdAny');
}

// PERF-1 — no global ClassSerializerInterceptor (it deep-copied every response).
function testNoGlobalClassSerializer(): void {
  const main = read('main.ts');
  assert.ok(!/new\s+ClassSerializerInterceptor/.test(main), 'ClassSerializerInterceptor must not be registered globally');
}

// A cold checkout must not need a second pool connection while it holds a transaction.
// With N concurrent cashiers and a pool of N, the old this.db read made every sale wait
// for another sale to release a connection (until the pool timeout).
async function testCheckoutSettingsUseTransactionConnection(): Promise<void> {
  const service: any = Object.create(SalesWriteService.prototype);
  service.db = { selectFrom: () => { throw new Error('opened a second pool connection'); } };
  const whereCalls: unknown[][] = [];
  const query: any = {
    select: () => query,
    where: (...args: unknown[]) => { whereCalls.push(args); return query; },
    execute: async () => [{ key: 'requireCashierShiftForSales', value: 'false' }],
  };
  const trx = { selectFrom: (table: string) => {
    assert.equal(table, 'settings');
    return query;
  } };
  const settings = await service.getTenantSettingsMap(trx, 'perf-checkout-cold-cache');
  assert.equal(settings.get('requireCashierShiftForSales'), false);
  assert.ok(whereCalls.some(([column, operator, keys]) => column === 'key' && operator === 'in' && Array.isArray(keys) && keys.includes('invoiceNumberingScheme')),
    'checkout must read only its needed settings');

  const source = read('modules/sales/services/sales-write.service.ts');
  assert.ok(!/this\.getTenantSettingsMap\(scope\.tenantId\)|this\.getTenantSettingsMap\(tenantId\)/.test(source),
    'every checkout settings call must pass its current transaction/query executor');
}

// PERF-3 — the hot-path index migration (136) exists and keeps its contract.
function testHotPathIndexMigration(): void {
  const file = join(SRC, 'database', 'migrations', '2040000000136_performance_hot_path_indexes.ts');
  assert.ok(existsSync(file), 'migration 136 (hot-path indexes) must exist');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { migration } = require(file);
  assert.equal(typeof migration.up, 'function');
  assert.equal(typeof migration.down, 'function');
  const text = readFileSync(file, 'utf8');
  for (const name of ['idx_held_sales_tenant_created', 'idx_purchase_items_tenant_product', 'idx_treasury_tenant_created']) {
    assert.ok(text.includes(name), `${name} must stay in migration 136`);
  }
  assert.ok(!/DROP INDEX[^;]*(pkey|uidx|uniq|unique)/i.test(text), 'migration 136 must never drop a unique index or primary key');
}

// PERF-4 — storefront catalog: stale data is served immediately while the refresh runs in background.
async function testStorefrontStaleWhileRevalidate(): Promise<void> {
  const service: any = Object.create(StorefrontService.prototype);
  service.catalogCache = new Map();
  service.inFlightCatalogPromises = new Map();
  let refreshStarted = 0;
  service.getTenantBySlug = () => {
    refreshStarted++;
    return new Promise(() => undefined); // a refresh that never finishes
  };

  const staleData = { categories: [], products: [{ id: 1 }] };
  const now = Date.now();
  service.catalogCache.set('shop', { data: staleData, expiresAt: now - 1_000, staleUntil: now + 60_000 });

  const result = await Promise.race([
    service.getStorefrontCatalog('shop'),
    new Promise((resolve) => setTimeout(() => resolve('TIMED_OUT'), 500)),
  ]);
  assert.equal(result, staleData, 'stale catalog must be returned without waiting for the refresh');
  assert.equal(refreshStarted, 1, 'a background refresh must have been started');

  await service.getStorefrontCatalog('shop');
  assert.equal(refreshStarted, 1, 'singleflight: no second refresh while one is in flight');

  const fresh = { categories: [], products: [] };
  service.catalogCache.set('fresh', { data: fresh, expiresAt: now + 60_000, staleUntil: now + 300_000 });
  assert.equal(await service.getStorefrontCatalog('fresh'), fresh);
  assert.equal(refreshStarted, 1, 'a fresh hit touches nothing');

  const source = read('modules/storefront/storefront.service.ts');
  const body = source.slice(source.indexOf('async getStorefrontCatalog'), source.indexOf('async getSearchSuggestions'));
  assert.ok(body.includes('Promise.all('), 'catalog rebuild reads run in parallel (PERF-4)');
}

// PERF-9 — the POS offline-catalog version ignores stock. Every change of it makes every terminal
// re-download the whole catalog, so a sale (stock move) must never change it.
function testPosCatalogVersionIgnoresStock(): void {
  const base = { productCount: 100, unitCount: 120, offerCount: 3, lastUpdatedAt: '2026-09-21T10:00:00.000Z' };
  const v = buildPosCatalogVersion(base);
  assert.equal(buildPosCatalogVersion({ ...base }), v, 'deterministic');
  assert.notEqual(buildPosCatalogVersion({ ...base, lastUpdatedAt: '2026-09-21T10:00:01.000Z' }), v, 'catalog edit moves it');
  assert.notEqual(buildPosCatalogVersion({ ...base, productCount: 99 }), v, 'product removed moves it');
  assert.notEqual(buildPosCatalogVersion({ ...base, unitCount: 119 }), v, 'deleted unit moves it (a deletion cannot raise MAX)');
  assert.notEqual(buildPosCatalogVersion({ ...base, offerCount: 2 }), v, 'deactivated offer moves it');
  assert.equal(buildPosCatalogVersion({ ...base, lastUpdatedAt: '1969-12-31T22:00:00.000Z' }), 'v2-100-120-3-0');

  const source = read('modules/catalog/services/catalog-product.service.ts');
  const body = source.slice(source.indexOf('async getPosCatalogVersion'), source.indexOf('async listPosProducts'));
  assert.ok(body.includes('MAX(p.catalog_updated_at)'), 'version must read products.catalog_updated_at');
  assert.ok(!/MAX\(p\.updated_at\)/.test(body), 'products.updated_at moves on every sale (applyStockDelta) — never use it for the POS version');

  const file = join(SRC, 'database', 'migrations', '2040000000137_products_catalog_updated_at.ts');
  assert.ok(existsSync(file), 'migration 137 (catalog_updated_at trigger) must exist');
  const text = readFileSync(file, 'utf8');
  for (const column of ['stock_qty', 'reserved_qty']) {
    assert.ok(text.includes(`- '${column}'`), `the trigger must ignore ${column}`);
  }
  assert.ok(/BEFORE UPDATE ON products/.test(text), 'catalog_updated_at is maintained by a trigger, not by each writer');
}

async function run(): Promise<void> {
  testPosCatalogVersionIgnoresStock();
  await testScopedStockSemantics();
  await testScopedStockIsLinear();
  testWholeCatalogIdListsUseArrayParameter();
  testNoGlobalClassSerializer();
  await testCheckoutSettingsUseTransactionConnection();
  testHotPathIndexMigration();
  await testStorefrontStaleWhileRevalidate();
  // eslint-disable-next-line no-console
  testPublicCatalogIsSerializedOnce();
  testLoadSuiteIsUsable();

  // eslint-disable-next-line no-console
  console.log('performance-hot-paths.spec: all performance invariants hold (PERF-1..PERF-4, PERF-9, PERF-10, PERF-15) and the load suite is wired');
}

/**
 * The k6 suite is the only thing that measures the box under real concurrency, and two mistakes in
 * it are silent: a header the app never reads, and load sizes that cannot be dialled up without
 * editing files (so nobody dials them up).
 */
/**
 * PERF-10 — كتالوج المتجر العام يُسلسَل **مرة لكل بناء**، لا مرة لكل زائر.
 *
 * التخزين المؤقت كان يحفظ الكائن، وExpress يعيد `JSON.stringify` له في كل طلب. على منشأة بـ12,140
 * صنفاً (قياس 24 سبتمبر 2026) يعني ذلك بناء نحو ثلاثة ميجابايت من النصّ لكل زائر، على نواتين،
 * والبيانات مخزَّنة أصلاً: التخزين كان يوفّر الاستعلام ولا يوفّر المعالج.
 */
function testPublicCatalogIsSerializedOnce(): void {
  const service = read('modules/storefront/storefront.service.ts');
  const controller = read('modules/storefront/storefront-public.controller.ts');

  assert.ok(
    /catalogCache = new Map<string, \{ data: any; json: string;/.test(service),
    'the public catalogue cache must hold the serialized payload, not just the object',
  );
  assert.ok(
    /json: JSON\.stringify\(result\)/.test(service),
    'the catalogue must be serialized where it is built, once per cache fill',
  );
  assert.ok(
    /async getStorefrontCatalogJson/.test(service) && /return cached\.json/.test(service),
    'a cache hit must return the stored string rather than rebuilding it',
  );

  // الرد نصّ مُسلسَل، فلا بد من ترويسة النوع صراحةً وإلا أرسله Express كـtext/html.
  assert.ok(
    /@Header\('Content-Type', 'application\/json; charset=utf-8'\)/.test(controller),
    'returning a pre-serialized string needs an explicit JSON content type, or Express sends text/html',
  );
  assert.ok(
    /getStorefrontCatalogJson\(slug\)/.test(controller),
    'the public catalogue route must serve the cached string',
  );
  // الافتراضي بلا معاملات يبقى الكتالوج كاملاً: الواجهة تبحث وتفرز في المتصفح، وتغييره يكسرها.
  assert.ok(
    /const wantsPage = \[/.test(controller) && /if \(wantsPage\) \{/.test(controller) && /getStorefrontCatalogPage/.test(controller),
    'pagination must be opt-in: the storefront page filters client-side and a changed default breaks it',
  );
  assert.ok(
    /Math\.min\(200, Math\.max\(1, Number\(query\.pageSize\) \|\| 50\)\)/.test(service),
    'a paged request must be capped, or "pagination" is a way to ask for everything with extra steps',
  );
}

function testLoadSuiteIsUsable(): void {
  const ROOT = join(__dirname, '..', '..', '..');
  const loadFile = (relative: string) => readFileSync(join(ROOT, 'load-tests', relative), 'utf8').replace(/\r\n/g, '\n');

  // Parse every scenario the way k6 does, before checking anything about its contents.
  //
  // `node --check` is not that gate: it wraps the file as CommonJS, and it exited 0 on a pos-sell.js
  // that k6 refused outright with "Line 255:42 Unexpected identifier". The cause was an apostrophe
  // inside a single-quoted English string ("another branch's warehouse") that re-tokenised into
  // something the CJS wrapper accepted and goja did not. A green local check, a dead production
  // round. acorn in module mode flags it at 255:41 — one column off k6's own number.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const acorn = require('acorn');
  const scenarioFiles = readdirSync(join(ROOT, 'load-tests', 'scenarios'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `scenarios/${name}`);
  for (const relative of [...scenarioFiles, 'config.js']) {
    try {
      acorn.parse(loadFile(relative), { ecmaVersion: 2022, sourceType: 'module' });
    } catch (error) {
      assert.fail(`load-tests/${relative} does not parse as an ES module: ${(error as Error).message}`);
    }
  }

  const config = loadFile('config.js');
  assert.ok(/export function rampProfile/.test(config), 'load sizes must be adjustable from the environment');
  assert.ok(/PEAK_VUS/.test(config) && /HOLD_SECONDS/.test(config), 'the profile must expose peak and hold');
  assert.ok(
    /SPOOF_CLIENT_IPS/.test(config) && /!== 'true'\) return \{\}/.test(config),
    'per-VU client addresses must stay behind an explicit opt-in, or a broken rate limit hides behind them',
  );

  // A scenario that needs a session must fail on a bad login instead of counting 401s: the first
  // real run reported "100% failed" with fast responses, which reads like the server fell over
  // when the actual cause was the placeholder admin/admin credentials never being replaced.
  // The login handshake lived in three copies before a fourth scenario needed CSRF on top of it.
  // It is one function in config.js now, and these are its properties.
  assert.ok(/export function loginOrDie/.test(config), 'config.js must own the login handshake');
  assert.ok(/throw new Error\(/.test(config), 'loginOrDie must abort on a bad login, not let scenarios iterate on 401s');
  // The cookie name is deployment-specific (SESSION_COOKIE_NAME); this deployment uses zs_cloud_*
  // names, so anything hard-coded works on one server and silently 401s on another.
  assert.ok(
    /value === sessionId/.test(config),
    'loginOrDie must discover the session cookie name from the login response, not assume it',
  );
  // The session travels in a cookie, like a browser. ALLOW_SESSION_ID_HEADER is off in CLOUD_SAAS
  // on purpose, and a load test does not get to ask production to loosen that.
  assert.ok(
    /cookies: \{ \[session\.cookieName\]: session\.sessionId \}/.test(config),
    'sessionParams must carry the session cookie',
  );
  // Writes are the new part: the guard demands a CSRF cookie AND the x-csrf-token header on every
  // unsafe method (session-auth.guard.ts), so a write scenario without it gets 403, not 401.
  assert.ok(
    /'x-csrf-token'\] = session\.csrfValue/.test(config),
    'writeParams must send the CSRF header, or every POST is refused with 403',
  );

  for (const scenario of ['pos-catalog-sync.js', 'stress-all.js', 'pos-sell.js']) {
    const source = loadFile(join('scenarios', scenario));
    assert.ok(/loginOrDie/.test(source), `${scenario} must use the shared login handshake, not its own copy`);
    assert.ok(
      !/'X-Session-Id'/.test(source),
      `${scenario} must not rely on the session header: the cloud guard rejects it`,
    );
    assert.ok(
      !/cookies: data/.test(source),
      `${scenario} must not pass k6 response cookies as request cookies: the shapes differ and nothing is sent`,
    );
  }

  // `resolveClientIp` reads X-Real-IP only. X-Forwarded-For is sent and ignored, so a scenario
  // using it silently fails to control the address it thinks it controls. Comments are stripped
  // first: the scenarios explain the distinction in prose, and prose is not what runs.
  const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const scenario of ['auth-login-burst.js', 'pos-catalog-sync.js', 'storefront-checkout.js', 'stress-all.js', 'pos-sell.js', 'full-system.js']) {
    const source = codeOf(loadFile(join('scenarios', scenario)));
    assert.ok(
      !/X-Forwarded-For/.test(source),
      `${scenario} must address the client with X-Real-IP: the app never reads X-Forwarded-For`,
    );
  }

  for (const scenario of ['pos-catalog-sync.js', 'storefront-checkout.js', 'stress-all.js']) {
    const source = loadFile(join('scenarios', scenario));
    assert.ok(/stages: rampProfile\(\)/.test(source), `${scenario} must take its load size from the shared profile`);
  }

  // The three launchers must agree, or the profile you asked for is not the profile you ran.
  const launchers: Array<[string, string]> = [['run.sh', loadFile('run.sh')], ['run.bat', loadFile('run.bat')], ['runner.cjs', loadFile('runner.cjs')]];
  for (const [name, source] of launchers) {
    for (const profile of ['heavy', 'extreme', 'soak']) {
      assert.ok(source.includes(profile), `${name} is missing the ${profile} profile`);
    }
    assert.ok(/no-thresholds/.test(source), `${name} must drop SLA thresholds for the measurement profile`);
    assert.ok(/PEAK_VUS/.test(source), `${name} must pass the load size to k6 explicitly (k6 does not inherit the shell env)`);
  }

  // `docker --version` succeeds without access to the daemon socket, so probing the binary told us
  // docker was usable and every run then died on "permission denied" after printing a header that
  // looked like the test was starting. The ubuntu user on the server needs sudo, as the rest of the
  // repo's scripts already assume.
  for (const [name, source] of [launchers[0], launchers[2]]) {
    assert.ok(/docker info/.test(source), `${name} must probe the docker daemon, not just the binary`);
    // Shell spells it `sudo -n docker`, Node spells it spawnSync('sudo', ['-n', 'docker', …]).
    assert.ok(
      /sudo[^A-Za-z0-9]{1,8}-n[^A-Za-z0-9]{1,8}docker/.test(source),
      `${name} must fall back to sudo docker like every other script here`,
    );
  }

  // A name used at runtime but never imported is a crash that only fires on the fallback path — the
  // one path nobody exercises. `stress-all.js` referenced SESSION_COOKIE_NAME without importing it,
  // so "could not spot the session cookie" would have thrown ReferenceError instead of falling back.
  for (const scenario of ['pos-catalog-sync.js', 'storefront-checkout.js', 'stress-all.js', 'auth-login-burst.js', 'pos-sell.js']) {
    const raw = loadFile(join('scenarios', scenario));
    const body = codeOf(raw);
    const imported = (raw.match(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\.\/config\.js'/) || [, ''])[1];
    for (const name of ['SESSION_COOKIE_NAME', 'writerIpHeaders', 'classifyWriteFailure', 'clientIpHeaders', 'rampProfile']) {
      if (new RegExp(`\\b${name}\\b`).test(body)) {
        assert.ok(
          new RegExp(`\\b${name}\\b`).test(imported),
          `${scenario} uses ${name} but never imports it from config.js`,
        );
      }
    }
  }

  // The per-iteration visitor address is a stronger spoof than the per-VU one, so it stays behind the
  // same explicit opt-in — otherwise a removed O60 limit would never show up in any run.
  assert.ok(
    /export function writerIpHeaders/.test(config)
    && /writerIpHeaders[\s\S]{0,400}SPOOF_CLIENT_IPS[\s\S]{0,120}!== 'true'\) return \{\}/.test(config),
    'writerIpHeaders must honour the same SPOOF_CLIENT_IPS opt-in as clientIpHeaders',
  );

  // The 24 Sep 2026 production run reported 0.19% order success with zero deadlocks and read as
  // "the server held". It had not been tested: `createOnlineOrder` validates stock BEFORE opening a
  // transaction, so every refusal left the write path untouched. Each successful order reserves
  // stock, so a create-only scenario runs exactly as long as the catalogue's spare stock and then
  // measures the refusal branch for the remaining two minutes. Three properties keep that from
  // recurring silently.
  for (const scenario of ['storefront-checkout.js', 'stress-all.js']) {
    const source = codeOf(loadFile(join('scenarios', scenario)));
    assert.ok(
      /selectOrderableItems\(items, minOrder\)/.test(source),
      `${scenario} must pick products through selectOrderableItems, not the first ones the catalogue returns`,
    );
    assert.ok(
      /throw new Error\([\s\S]{0,400}stock/i.test(source),
      `${scenario} must refuse to start when nothing is orderable, instead of reporting a near-zero success rate`,
    );
    assert.ok(
      /orders\/\$\{encodeURIComponent\(orderNumber\)\}\/cancel/.test(source) && /'x-order-token'/.test(source),
      `${scenario} must cancel the order it created so the reservation is returned and the write load is sustainable`,
    );
    assert.ok(
      /classifyWriteFailure\(res\)/.test(source),
      `${scenario} must record why the server refused: a rejection rate with no reason is not a measurement`,
    );
    assert.ok(
      /writerIpHeaders\(__VU, __ITER\)/.test(source),
      `${scenario} must present a fresh visitor per iteration, or O60 (30 orders / IP / 10 min) caps the run`,
    );

    // Second run, same shape of waste: the server refused 8225 of 8225 with one sentence —
    // "الحد الأدنى للطلب هو 700 ج". The cart was one unit of one product, always, so it never
    // cleared a minimum that the storefront advertises on its own /info route.
    assert.ok(
      /minOrder/.test(source) && /\/info/.test(source),
      `${scenario} must read the storefront's minimum order and build a cart that clears it`,
    );
    // And the cheapest possible insurance against a third round of this: place one real order in
    // setup() and abort on the server's own words, rather than learning it 2.5 minutes later.
    assert.ok(
      /preflight order was refused/.test(source),
      `${scenario} must place (and cancel) one probe order in setup and abort if the server refuses it`,
    );
  }

  // The probe would be theatre if it did not carry the same cart the run will use.
  for (const scenario of ['storefront-checkout.js', 'stress-all.js']) {
    const source = codeOf(loadFile(join('scenarios', scenario)));
    assert.ok(
      /buildOrderPayload\(cart\[0\]/.test(source),
      `${scenario}'s preflight must send the same cart shape the iterations send`,
    );
  }

  // pos-sell.js is the only scenario that issues invoices, so it carries the properties that make a
  // selling run mean something — and the warning that it cannot be undone.
  {
    const sell = codeOf(loadFile(join('scenarios', 'pos-sell.js')));
    assert.ok(
      /preflight sale was refused/.test(sell),
      'pos-sell.js must post (and check) one real sale in setup before the load starts',
    );
    assert.ok(
      /writeParams\(/.test(sell),
      'pos-sell.js posts sales, so it must use writeParams: a session cookie alone is refused with 403',
    );
    // A sale needs an open shift; without one the whole run is OPEN_SHIFT_REQUIRED and measures the
    // authorization branch. And the shift row is where one cashier's sales serialise, so it is also
    // the thing being measured.
    assert.ok(
      /cashier-shifts\/open/.test(sell) && /OPEN_SHIFT_REQUIRED/.test(sell),
      'pos-sell.js must open a cashier shift and count the refusals that mean it failed to',
    );
    // A shift belongs to a user (`opened_by`), but GET /api/cashier-shifts is filtered by tenant.
    // Reading that list to decide "do I have one?" lets c1's open shift convince c2 it has one, and
    // every sale c2 makes is then refused. Opening and treating SHIFT_ALREADY_OPEN as success asks
    // the server the question only it can answer.
    assert.ok(
      /SHIFT_ALREADY_OPEN/.test(sell) && !/cashier-shifts\?filter=open/.test(sell),
      'pos-sell.js must not infer its own shift from the tenant-wide list; open and accept SHIFT_ALREADY_OPEN',
    );
    // A POS sale without branchId is POS_BRANCH_REQUIRED, and the branch without a default stock
    // location is POS_DEFAULT_STOCK_REQUIRED. Both are cheap to check once, in setup.
    assert.ok(
      /defaultStockLocationId/.test(sell) && /source: 'pos',[^]{0,40}branchId,/.test(sell),
      'pos-sell.js must resolve a branch with a default stock location and send it on every sale',
    );
    // A branch with a default stock location is not the same as a branch with stock in it. The first
    // branch on this tenant had an empty warehouse while 50,000 units sat in another branch's, and
    // globalStock cannot tell the difference — only the branch-scoped catalog can, and only when
    // branchId is passed to it, exactly as the cashier screen does.
    assert.ok(
      /pos-products\?limit=\d+&branchId=/.test(sell) && !/globalStock/.test(sell),
      'pos-sell.js must read the catalogue scoped to the selling branch and use that stock, not the global figure',
    );
    // Distributed load does not collide. One product under every VU does.
    assert.ok(
      /hotProductScenario/.test(sell),
      'pos-sell.js must drive part of its load at a single product, or nothing tests the canonical lock order',
    );
    assert.ok(
      /trackSerials|serials/.test(sell) && /hasBom|bom/.test(sell),
      'pos-sell.js must skip serial-tracked and BOM items: they fail for reasons that are not performance',
    );
  }

  // A deadlock detector that cannot see a deadlock.
  //
  // Every scenario searched the response body for '40P01'. It never arrives: postgres-error.mapper.ts
  // translates 40P01 and 40001 into STOCK_CONFLICT with HTTP 409 and an Arabic message before the
  // response leaves. So the detector was blind to every deadlock the application HANDLED — which is
  // all of them. On 24 Sep 2026 it reported zero while pg_stat_database.deadlocks said one.
  assert.ok(
    /export function isLockConflict/.test(config) && /STOCK_CONFLICT/.test(config) && /409/.test(config),
    'the lock-conflict detector must know the mapped code, not just the raw SQLSTATE the app never returns',
  );
  for (const scenario of ['full-system.js', 'pos-sell.js', 'storefront-checkout.js', 'stress-all.js']) {
    const source = codeOf(loadFile(join('scenarios', scenario)));
    assert.ok(
      /isLockConflict\(/.test(source) && !/includes\('40P01'\)/.test(source),
      `${scenario} must detect lock conflicts through isLockConflict: grepping the body for 40P01 finds nothing`,
    );
  }

  // full-system.js is the readiness run: it is the only scenario that touches every financial path
  // at once, and the only reason to trust its "zero deadlocks" is that every path actually fired.
  {
    const full = codeOf(loadFile(join('scenarios', 'full-system.js')));
    for (const [what, pattern] of [
      ['returns', /\/api\/returns/],
      ['credit sales', /paymentType: 'credit'/],
      ['purchases', /\/api\/purchases/],
      ['storefront orders', /\/orders`/],
      ['catalogue sync', /pos-products\/version/],
      ['reports under write load', /\/api\/accounting\/reports\//],
    ] as Array<[string, RegExp]>) {
      assert.ok(pattern.test(full), `full-system.js must exercise ${what}: a path it never touches is a path it never cleared`);
    }
    assert.ok(
      /preflight sale was refused/.test(full),
      "full-system.js must post one real sale in setup and abort on the server's own words",
    );
    // Closing a shift verifies the CASHIER's own password, not a manager PIN.
    assert.ok(
      /managerPin: session\.password/.test(full),
      'shift close authenticates the cashier themselves (assertCurrentUserPassword), so pass their password',
    );
    // A run that measures nothing is the failure mode this suite keeps re-learning.
    assert.ok(
      /CUSTOMER_REQUIRED_FOR_CREDIT/.test(full),
      'full-system.js must refuse to start without customers, or the credit half measures refusals',
    );
    // A return needs manager authorization (MANAGER_AUTH_REQUIRED); the cashier's own password is
    // accepted. Omitting it refused 337 of 337 returns on the first run.
    assert.ok(
      /managerPin: session\.password,\s*\}\), writeParams/.test(full)
      || /note: 'load test return',[^]{0,400}managerPin: session\.password/.test(full),
      'a return must carry manager authorization, or every one of them is refused with 403',
    );
    // The accounting reports live under api/accounting. The bare /api/reports path 404s in 3ms and
    // looks exactly like a failing report.
    assert.ok(
      /\/api\/accounting\/reports\//.test(full) && !/\$\{BASE_URL\}\/api\/reports\//.test(full),
      'reports are mounted under api/accounting; the short path returns 404 and measures nothing',
    );
    // __VU is GLOBAL across k6 scenarios. Gating the "why was this refused" log on it meant three
    // whole paths failed 100% with not one line explaining why — the exact failure the
    // classification work exists to prevent.
    assert.ok(
      /loggedPerLabel/.test(full) && !/__VU <= 2/.test(full),
      'the refusal log must be gated per path, not on __VU: k6 numbers VUs globally across scenarios',
    );
    // A credit limit being enforced is the guard working. Counting it as a failed check makes the
    // run red for a correct refusal and buries the failures that are real.
    assert.ok(
      /CUSTOMER_CREDIT_LIMIT/.test(full) && /creditLimitReached\.add\(1\)/.test(full),
      'a refusal on the customer credit limit must be counted apart, not scored as a failure',
    );
    // ...and it must be recognised BEFORE check() runs, or k6 still records a failed check and the
    // run reads red on a path that behaved perfectly.
    assert.ok(
      /CUSTOMER_CREDIT_LIMIT[^]{0,200}const ok = check\(res/.test(full),
      'the credit-limit refusal must be caught before the check, not after: a correct refusal must not print as a failed check',
    );
    // http_req_failed counts every 4xx, including the refusals this run deliberately provokes.
    // A threshold that is always red stops being read.
    assert.ok(
      !/\.\.\.WRITE_THRESHOLDS,/.test(full) && /http_req_duration: WRITE_THRESHOLDS\.http_req_duration/.test(full),
      'full-system must not gate on http_req_failed: the per-path success rates are the precise measure',
    );
    // A purchase line needs its receiving location; the branch alone is not enough (LOCATION_REQUIRED).
    assert.ok(
      /locationId: data\.locationId/.test(full),
      'a purchase line must carry the receiving location, or it is refused with LOCATION_REQUIRED',
    );
    // Reports sit behind accounting permissions. Reading them as a till operator measures a 403.
    assert.ok(
      /sessionParams\(data\.admin/.test(full),
      'financial reports must be read with the owner session: a cashier gets 403 and the run measures authorization',
    );
    // An owner session from a DIFFERENT tenant read that tenant's branches and the run died with
    // "no branch has sellable stock". Nothing else would have caught it; the login payload carries
    // the tenant, so setup compares them.
    assert.ok(
      /is on tenant \$\{String\(owner\.tenantId/.test(full) && /session\.tenantId/.test(full),
      'setup must refuse to run when the sessions are split across tenants: one reads while the other writes',
    );
    // `paginateRows` caps pageSize at 100. Asking for 500 returns 100 and quietly narrows the run —
    // it is why a hundred customers absorbed every credit sale until their limits filled.
    assert.ok(
      !/pageSize=[2-9]\d\d/.test(full),
      'pageSize is capped at 100 by paginateRows; page through instead of asking for a number you cannot get',
    );
    // Reports are the least important path. A missing permission must disable them with one line,
    // not abort a three-minute run, and not fail 244 checks in silence either.
    assert.ok(
      /reportsEnabled/.test(full) && /reports are disabled for this run/.test(full),
      'a report permission the session lacks must disable that group loudly, not abort or spam failures',
    );
  }

  // The integrity questions are the point of the readiness run; the scenario is only how they get asked.
  {
    const sqlPath = join(ROOT, 'load-tests', 'verify-integrity.sql');
    assert.ok(existsSync(sqlPath), 'load-tests/verify-integrity.sql must exist: the run proves nothing without it');
    const checks = readFileSync(sqlPath, 'utf8');
    for (const [what, needle] of [
      ['unbalanced journals', 'unbalanced_entries'],
      ['stock ledger drift', 'stock_ledger_mismatches'],
      ['sales with no journal', 'sales_without_journal'],
      ['unresolved posting failures', 'open_posting_failures'],
      ['orphan reservations', 'orphan_reservations'],
      ['returns with no reversing journal', 'returns_without_journal'],
    ] as Array<[string, string]>) {
      assert.ok(checks.includes(needle), `the integrity check for ${what} must stay in verify-integrity.sql`);
    }
  }

  // The cart builder is the single place that decides what is orderable, so the two conditions that
  // each cost us a wasted production round live here: available stock, and a line total that clears
  // the storefront's minimum.
  const cfg = codeOf(config);
  assert.ok(
    /export function selectOrderableItems/.test(cfg),
    'config.js must own the orderable-item selection, so both scenarios cannot drift apart',
  );
  assert.ok(
    /inStock !== false/.test(cfg) && /Number\(p\.stockQty \|\| 0\) > 0/.test(cfg),
    'selectOrderableItems must skip items with no available stock',
  );
  assert.ok(
    /Math\.ceil\(floor \/ price\)/.test(cfg),
    'selectOrderableItems must size the quantity to clear the minimum order, not send one unit blindly',
  );
}

run().then(
  () => process.exit(0),
  (error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  },
);
