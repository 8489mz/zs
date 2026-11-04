/*
 * Auto-quote shared resolver (INV-MARITIME-AUTOQUOTE-SHARED-RESOLVER).
 *
 * THE GAP: the automated pipeline priced every auto-quote with
 * `config.defaultExchangeRate || 48.5` -- a hardcoded EGP/USD
 * rate baked into the default config in 48.5 days, while the
 * live rate moved to 56. Every auto-quote converted at a stale
 * rate, silently, with no registered-rate check anywhere.
 *
 * THE RULE: an automated quotation converts only at the live
 * registered rate from the single shared resolver
 * (resolveFxRate): the base currency resolves to 1, a currency
 * with no registered rate fails closed. There is no default,
 * no fallback and no hardcoded rate anywhere in the pipeline
 * path. When the rate is missing, the pipeline skips that RFQ
 * only, records the reason in its details, and keeps processing
 * the remaining RFQs. The removed defaultExchangeRate config
 * key is stripped on read and on save, so a stored old config
 * can never resurface as a rate.
 *
 * WHAT THIS PINS, driving the REAL service on PGlite (EGP base,
 * USD live 56 as seeded data):
 * - resolveAutoQuoteExchangeRate returns the registered 56 for
 *   USD, 1 for the base currency, and throws when no rate is
 *   registered;
 * - the real processAutomatedPipelineForTenant, with the manual
 *   checkpoint off and a past cut-off, SKIPS an RFQ whose bid
 *   currency has no registered rate: zero awards, zero quotes,
 *   the RFQ untouched, and the skip reason recorded;
 * - a stored config carrying the old key comes back without
 *   it, and saving strips it from the stored JSON;
 * - source pins: no 48.5 / defaultExchangeRate in the pipeline
 *   body or the config type, and none in the three frontend
 *   files (the settings tab shows a live-rate note instead).
 *
 * HONEST LIMIT: the award + quotation branch of the pipeline
 * is not driven here (awardBid/createQuotation need their full
 * table set); the live-rate quote path end to end is a
 * live-Postgres rehearsal item. Frontend copy is pinned by
 * source read, not proven in a browser; frontend typecheck /
 * vitest were not run here (no frontend dependencies on this
 * machine). ApplyMarginModal's separate 48.5 manual-margin
 * prefill is deliberately untouched -- a recorded residual,
 * not silently changed.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const authT2 = { tenantId: 't2', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const service = new MaritimeFreightService(db, {} as never, {} as never, {} as never);

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE maritime_rfqs (id bigint PRIMARY KEY, tenant_id text, rfq_number text, status text, auto_awarded boolean, cut_off_deadline timestamptz, target_rate_max numeric, customer_id bigint, customer_name text, customer_phone text, customer_email text, payment_term text, pol_name text, pod_name text, container_count int, container_type text);
      CREATE TABLE maritime_rfq_bids (id bigint PRIMARY KEY, tenant_id text, rfq_id text, currency text, free_days numeric, total_freight_cost numeric, shipping_line_name text);
      INSERT INTO settings VALUES ('t1','currency','EGP'),('t2','currency','EGP');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','EGP',1,true),('t2','EGP',1,true);
      INSERT INTO settings VALUES ('t1','maritime_pipeline_config','{"automationMode":"hybrid","requireManualAwardAndMargin":false,"defaultExchangeRate":48.5}');
      INSERT INTO maritime_rfqs VALUES (1,'t1','RFQ-1','sent',false,'2020-01-01',NULL,NULL,'Acme',NULL,NULL,'prepaid','Alex','Jeddah',1,'20FT');
      INSERT INTO maritime_rfq_bids VALUES (1,'t1','1','USD',20,1000,'Line A');
    `);

    // 1. Missing USD rate: the pipeline skips this RFQ only, loudly.
    const skipped = await service.processAutomatedPipelineForTenant(auth);
    assert.equal(skipped.awardedCount, 0);
    assert.equal(skipped.quotesGenerated, 0);
    assert.equal(skipped.details.length, 1);
    assert.match(skipped.details[0], /لا يوجد سعر صرف مسجل/);
    assert.match(skipped.details[0], /RFQ-1/);
    const rfq = await (db as any).selectFrom('maritime_rfqs').select(['status', 'auto_awarded']).where('id', '=', 1).executeTakeFirstOrThrow();
    assert.equal(rfq.status, 'sent');
    assert.equal(rfq.auto_awarded, false);

    // 2. The resolver itself: live rate, base currency, fail-closed.
    await (db as any).insertInto('currency_exchange_rates').values({ tenant_id: 't1', currency_code: 'USD', exchange_rate: 56, is_base: false }).execute();
    assert.equal(await service.resolveAutoQuoteExchangeRate('t1', 'USD'), 56);
    assert.equal(await service.resolveAutoQuoteExchangeRate('t1', 'EGP'), 1);
    await assert.rejects(service.resolveAutoQuoteExchangeRate('t2', 'USD'), /سعر صرف USD غير متاح/);

    // 3. The legacy config key is stripped on read and on save.
    const config: any = await service.getTenantPipelineConfig('t1');
    assert.ok(!('defaultExchangeRate' in config), 'the legacy key must not resurface');
    assert.equal(config.requireManualAwardAndMargin, false, 'other stored keys survive');
    const saved: any = await service.savePipelineSettings(auth, { marginFloor: 160 } as never);
    assert.ok(!('defaultExchangeRate' in saved));
    const storedRow = await (db as any).selectFrom('settings').select('value').where('tenant_id', '=', 't1').where('key', '=', 'maritime_pipeline_config').executeTakeFirstOrThrow();
    assert.ok(!String(storedRow.value).includes('defaultExchangeRate'), 'the stored JSON must not keep the key');

    // 4. Source pins.
    const serviceSource = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight.service.ts'), 'utf8');
    const pipelineStart = serviceSource.indexOf('async processAutomatedPipelineForTenant(');
    const pipelineEnd = serviceSource.indexOf('\n  async ', pipelineStart + 10);
    const pipelineBody = serviceSource.slice(pipelineStart, pipelineEnd);
    assert.ok(pipelineBody.includes('resolveAutoQuoteExchangeRate'), 'the pipeline must resolve through the helper');
    assert.ok(!pipelineBody.includes('48.5'), 'no hardcoded rate in the pipeline');
    assert.ok(!pipelineBody.includes('defaultExchangeRate'), 'no config-default rate in the pipeline');
    const typesSource = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight.types.ts'), 'utf8');
    assert.ok(!typesSource.includes('defaultExchangeRate'), 'the config type must not carry the key');
    assert.ok(!typesSource.includes('48.5'), 'the config default must not carry a hardcoded rate');
    for (const rel of [
      '../../../frontend/src/features/maritime-freight/components/MaritimePipelineSettingsTab.tsx',
      '../../../frontend/src/features/maritime-freight/context/MaritimeContext.tsx',
      '../../../frontend/src/features/maritime-freight/api/maritime-freight.api.ts',
    ]) {
      const content = readFileSync(resolve(__dirname, rel), 'utf8');
      assert.ok(!content.includes('defaultExchangeRate'), `${rel} must not reference the removed key`);
      assert.ok(!content.includes('48.5'), `${rel} must not hardcode the rate`);
    }
    const settingsTab = readFileSync(resolve(__dirname, '../../../frontend/src/features/maritime-freight/components/MaritimePipelineSettingsTab.tsx'), 'utf8');
    assert.ok(settingsTab.includes('سعر الصرف الحي المسجل'), 'the settings tab explains the live rate');

    console.log('maritime auto-quote shared resolver checks passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
