import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { validate } from 'class-validator';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { CreateOnlineOrderDto } from '../../src/modules/storefront/dto/create-online-order.dto';

/*
 * Storefront contact minima (INV-SPIRIT-STOREFRONT-CONTACT-MINIMA).
 *
 * THE CHANGE: a recipient name needs at least two letters (was: at
 * least 3 characters and 3 letters, at the DTO, the service create
 * path and the service edit path), and a delivery address needs only
 * to be non-empty after trimming (was: at least 5 characters and 3
 * letters). The thresholds are coordinator-chosen simple minima,
 * flagged for the owner to change.
 *
 * THE PHONE RULE IS UNCHANGED and is pinned here as a regression
 * guard: Egypt keeps 11 digits starting 010/011/012/015 at the
 * service, other countries keep 7-16 digits, and the DTO keeps its
 * generic 7-16 pattern.
 *
 * WHAT THIS PINS (real createOnlineOrder/updateCustomerOrder with a
 * stubbed Kysely-shaped db, following storefront-line-total-digits):
 * the gates fire for a one-letter name, a blank address and a bad
 * Egyptian phone, and a two-letter name with a one-word address and a
 * valid Egyptian phone passes all three gates (the call then fails
 * later on the stubbed catalog, which proves the gates let it
 * through).
 */

function makeFakeDb(rowsByTable: Record<string, any[]>): any {
  const eb: any = Object.assign(
    (..._args: any[]) => true,
    { or: (..._args: any[]) => true, and: (..._args: any[]) => true },
  );
  const makeQuery = (table: string): any => {
    const q: any = new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === 'execute') return async () => rowsByTable[table] ?? [];
        if (prop === 'executeTakeFirst') return async () => (rowsByTable[table] ?? [])[0];
        if (prop === 'then') return undefined;
        return (...args: any[]) => {
          for (const arg of args) {
            if (typeof arg === 'function') {
              try { arg(eb); } catch { /* expression-builder shapes only */ }
            }
          }
          return q;
        };
      },
      apply() { return q; },
    });
    return q;
  };
  return { selectFrom: (table: string) => makeQuery(table) };
}

const PRODUCT = {
  id: 1, name: 'منتج', barcode: '', retail_price: 10, metadata: null,
  is_active: true, item_type: 'product', stock_qty: 100, reserved_qty: 0,
};

function makeService(): any {
  const svc: any = new (StorefrontService as any)(makeFakeDb({ products: [PRODUCT], product_offers: [] }), {}, {}, {});
  svc.getTenantBySlug = async () => ({ id: 'tenant-1', currency: 'EGP', slug: 'shop', activity_type: null });
  svc.getTenantSettingsMap = async () => new Map<string, string>([['currency', 'EGP']]);
  svc.reapExpiredReservations = async () => undefined;
  svc.resolveOrderCharges = async () => ({
    deliveryFee: 0, deliveryZoneId: null, deliveryZoneName: null,
    discountAmount: 0, appliedCouponCode: null,
  });
  svc.findCustomerOrderByToken = async () => ({
    status: 'pending', kitchen_draft_sale_id: null, sale_id: null,
    payment_status: 'unpaid', fulfillment_type: 'delivery', order_type: 'delivery',
    country_code: 'EG',
  });
  return svc;
}

const GATE_WORDS = /اسم|عنوان|هاتف/;

async function expectGateError(promise: Promise<unknown>, word: string): Promise<void> {
  let caught: unknown;
  try { await promise; } catch (error) { caught = error; }
  assert.ok(caught, `expected a rejection mentioning ${word}`);
  assert.match(String((caught as Error).message || ''), new RegExp(word), 'gate error message');
}

async function expectPastGates(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const message = String((error as Error).message || '');
    assert.doesNotMatch(message, GATE_WORDS, `input passed the contact gates but failed later: ${message}`);
  }
}

async function main(): Promise<void> {
  const svc = makeService();
  const baseDto: any = {
    customerName: 'لي',
    customerPhone: '01012345678',
    customerAddress: 'شارع',
    countryCode: 'EG',
    items: [{ productId: 1, quantity: 1 }],
  };

  // A two-letter name and a one-word address pass the create gates.
  await expectPastGates(svc.createOnlineOrder('shop', { ...baseDto }));

  // A one-letter name is still rejected at create and at edit.
  await expectGateError(
    svc.createOnlineOrder('shop', { ...baseDto, customerName: 'ل' }), 'حرفين');
  await expectGateError(
    svc.updateCustomerOrder('shop', 'ORD-1', 'tok', { ...baseDto, customerName: 'A' }), 'حرفين');

  // A blank (whitespace-only) address is rejected; a short real address passes.
  await expectGateError(
    svc.createOnlineOrder('shop', { ...baseDto, customerAddress: '   ' }), 'عنوان');
  await expectPastGates(svc.createOnlineOrder('shop', { ...baseDto, customerAddress: 'ab' }));
  await expectGateError(
    svc.updateCustomerOrder('shop', 'ORD-1', 'tok', { ...baseDto, customerAddress: '   ' }), 'عنوان');

  // PHONE REGRESSION — the Egyptian rule is unchanged.
  await expectGateError(
    svc.createOnlineOrder('shop', { ...baseDto, customerPhone: '0101234567' }), 'هاتف');
  await expectGateError(
    svc.createOnlineOrder('shop', { ...baseDto, customerPhone: '01912345678' }), 'هاتف');
  await expectGateError(
    svc.createOnlineOrder('shop', { ...baseDto, customerPhone: '011123456' }), 'هاتف');
  await expectPastGates(svc.createOnlineOrder('shop', { ...baseDto, customerPhone: '01512345678' }));
  // A non-Egyptian number keeps the generic 7-16 digit rule.
  await expectPastGates(svc.createOnlineOrder('shop', { ...baseDto, countryCode: 'SA', customerPhone: '555123456' }));

  // DTO pins: two letters pass, one letter fails, bad Egyptian phone fails.
  const dtoOk = Object.assign(new CreateOnlineOrderDto(), baseDto);
  const okViolations = await validate(dtoOk);
  assert.equal(
    okViolations.filter((v) => v.property === 'customerName').length, 0,
    'DTO accepts a two-letter name',
  );
  const dtoShort = Object.assign(new CreateOnlineOrderDto(), { ...baseDto, customerName: 'ل' });
  const shortViolations = await validate(dtoShort);
  assert.ok(
    shortViolations.some((v) => v.property === 'customerName'),
    'DTO still rejects a one-letter name',
  );
  const dtoPhone = Object.assign(new CreateOnlineOrderDto(), { ...baseDto, customerPhone: '010123' });
  const phoneViolations = await validate(dtoPhone);
  assert.ok(
    phoneViolations.some((v) => v.property === 'customerPhone'),
    'DTO still rejects a phone below 7 digits (generic rule unchanged)',
  );
  const dtoPhoneGeneric = Object.assign(new CreateOnlineOrderDto(), { ...baseDto, customerPhone: '0101234567' });
  const genericViolations = await validate(dtoPhoneGeneric);
  assert.equal(
    genericViolations.filter((v) => v.property === 'customerPhone').length, 0,
    'DTO keeps the generic 7-16 rule; the Egyptian 11-digit rule is enforced by the service (pinned above)',
  );

  console.log('storefront contact minima checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
