/*
New file: backend/test/critical/tax-engine-unification.spec.ts
Pins tax unification: ONE engine attests every signed/reported
document. The ZATCA builder and the ETA serializer both consume
buildDocumentTax, so the same posted invoice must attest
identically in both documents — same rate, same per-line tax,
same totals — at 15%, 14%, 5%, and 0%, including the legacy
no-allocation fallback. If either builder reintroduces its own
rate math, this spec fails.

WHAT THIS PINS:
- The real buildZatcaInvoice (mock DB) and the real
  serializeSaleToEtaFormat (mock DB), driven on identical
  fixtures, agree line by line and in totals.
- The document-level UBL <cbc:Percent> is the stated attested
  rate (documentVatRate from the engine), never re-derived
  from the first line: a sync package whose stated rate
  disagrees with its line rate signs the STATED rate.
- buildDocumentTax called directly on the same fixture
  returns exactly the numbers both builders attest.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as crypto from 'node:crypto';
import { ZatcaPhase2Service } from '../../src/modules/tax-integration/services/zatca/zatca-phase2.service';
import { EtaSerializerService } from '../../src/modules/tax-integration/services/eta-serializer/eta-serializer.service';
import { buildDocumentTax } from '../../src/modules/tax-integration/engines/document-tax.engine';

async function main(): Promise<void> {
  // ---- ZATCA driver (mock DB, same shape as zatca-document-tax.spec.ts) ----
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const fakeUnit = {
    id: 5,
    private_key_pem: privateKey,
    public_key_pem: publicKey,
    status: 'unregistered',
    environment: 'sandbox',
    last_icv: 0,
    last_invoice_hash: 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMjRiMWUxMDhkNDQ3ZjhlNzY1ZmVhNGU3NDkyNDQ1NQ==',
  };

  function driveZatca(sale: Record<string, unknown>, items: Array<Record<string, unknown>>) {
    function chainable(result: unknown) {
      const q: any = {
        select: () => q,
        selectAll: () => q,
        where: () => q,
        forUpdate: () => q,
        orderBy: () => q,
        values: () => q,
        returningAll: () => q,
        set: () => q,
        execute: async () => result,
        executeTakeFirst: async () => result,
        executeTakeFirstOrThrow: async () => {
          if (result == null) throw new Error('no row');
          return result;
        },
      };
      return q;
    }
    const trx: any = {
      selectFrom: (table: string) => {
        if (table === 'sales') return chainable(sale);
        if (table === 'sale_items') return chainable(items);
        if (table === 'tenants') return chainable({ id: 'tenant-1', business_name: 'Acme Trading Co' });
        if (table === 'settings') return chainable([{ key: 'companyName', value: '"Acme Trading Co"' }]);
        if (table === 'tenant_tax_settings')
          return chainable([{ provider: 'ZATCA_SAUDI', tax_id: '300000000000003', is_active: true }]);
        return chainable(null);
      },
      insertInto: () => chainable(fakeUnit),
      updateTable: () => chainable({}),
    };
    const svc: any = Object.create(ZatcaPhase2Service.prototype);
    svc.db = { transaction: () => ({ execute: async (cb: any) => cb(trx) }) };
    svc.taxSettings = {
      getSettings: async () => ({ environment: 'sandbox', tax_id: '300000000000003' }),
    };
    return svc.buildZatcaInvoice('tenant-1', 7) as Promise<{ ublXml: string; icv: number }>;
  }

  // ---- ETA driver (mock DB, same shape as eta-document-tax.spec.ts) ----
  function driveEta(sale: Record<string, unknown>, items: Array<Record<string, unknown>>) {
    function chainable(result: unknown) {
      const q: any = {
        select: () => q,
        selectAll: () => q,
        where: () => q,
        execute: async () => result,
        executeTakeFirst: async () => result,
        executeTakeFirstOrThrow: async () => {
          if (result == null) throw new Error('no row');
          return result;
        },
      };
      return q;
    }
    const svc: any = Object.create(EtaSerializerService.prototype);
    svc.db = {
      selectFrom: (table: string) => {
        if (table === 'sales') return chainable(sale);
        if (table === 'sale_items') return chainable(items);
        if (table === 'tenant_tax_settings')
          return chainable([{ provider: 'ETA_EGYPT', tax_id: '123456789', is_active: true }]);
        return chainable(null);
      },
    };
    svc.taxSettings = { getSettings: async () => ({ tax_id: '123456789' }) };
    return svc.serializeSaleToEtaFormat('tenant-1', 7) as Promise<any>;
  }

  function percents(xml: string): string[] {
    return [...xml.matchAll(/<cbc:Percent>([^<]+)<\/cbc:Percent>/g)].map((m) => m[1]);
  }
  function payable(xml: string): string {
    const m = xml.match(/<cbc:PayableAmount currencyID="SAR">([^<]+)<\/cbc:PayableAmount>/);
    assert.ok(m, 'PayableAmount present');
    return m[1];
  }

  const baseSale = {
    id: 7,
    doc_no: 'INV-7',
    status: 'posted',
    branch_id: null,
    customer_id: null,
    customer_name: 'Cash',
    created_at: new Date('2026-10-30T10:00:00.000Z'),
    tax_amount: 15,
    zatca_icv: null,
    zatca_hash: null,
    zatca_uuid: null,
    zatca_ubl_xml: null,
    zatca_qr: null,
    zatca_egs_id: null,
    discount: 0,
  };
  const baseItem = {
    qty: 1,
    unit_price: 100,
    product_id: 11,
    product_name: 'Widget',
  };

  const cases: Array<{
    name: string;
    rate: number;
    pricesIncludeTax: boolean;
    saleTaxAmount: number;
    items: Array<Record<string, unknown>>;
    expectedBase: number;
    expectedTax: number;
    expectedTotal: number;
  }> = [
    {
      name: 'stored 15%',
      rate: 15,
      pricesIncludeTax: false,
      saleTaxAmount: 15,
      items: [{ ...baseItem, line_total: 100, net_line_total: 100, allocated_discount: 0, allocated_tax: 15 }],
      expectedBase: 100,
      expectedTax: 15,
      expectedTotal: 115,
    },
    {
      name: 'stored 5%',
      rate: 5,
      pricesIncludeTax: false,
      saleTaxAmount: 10,
      items: [
        {
          ...baseItem,
          qty: 2,
          unit_price: 100,
          line_total: 200,
          net_line_total: 200,
          allocated_discount: 0,
          allocated_tax: 10,
        },
      ],
      expectedBase: 200,
      expectedTax: 10,
      expectedTotal: 210,
    },
    {
      name: 'exempt 0%',
      rate: 0,
      pricesIncludeTax: false,
      saleTaxAmount: 0,
      items: [{ ...baseItem, line_total: 100, net_line_total: 100, allocated_discount: 0, allocated_tax: 0 }],
      expectedBase: 100,
      expectedTax: 0,
      expectedTotal: 100,
    },
    {
      name: 'legacy tax-inclusive 14%, no allocations',
      rate: 14,
      pricesIncludeTax: true,
      saleTaxAmount: 14,
      items: [
        {
          ...baseItem,
          unit_price: 114,
          line_total: 114,
          net_line_total: null,
          allocated_discount: null,
          allocated_tax: null,
        },
      ],
      expectedBase: 100,
      expectedTax: 14,
      expectedTotal: 114,
    },
  ];

  for (const c of cases) {
    const sale = {
      ...baseSale,
      tax_rate: c.rate,
      tax_amount: c.saleTaxAmount,
      prices_include_tax: c.pricesIncludeTax,
    };
    const zatca = await driveZatca(sale, c.items);
    const eta = await driveEta(sale, c.items);
    const engine = buildDocumentTax({
      rate: c.rate,
      pricesIncludeTax: c.pricesIncludeTax,
      documentDigits: 2,
      lines: c.items.map((item) => ({
        lineTotal: Number(item.line_total),
        netLineTotal: item.net_line_total == null ? null : Number(item.net_line_total),
        allocatedDiscount: item.allocated_discount == null ? null : Number(item.allocated_discount),
        allocatedTax: item.allocated_tax == null ? null : Number(item.allocated_tax),
      })),
    });

    // Engine agrees with the expected numbers.
    assert.equal(engine.subtotal, c.expectedBase, `${c.name}: engine subtotal`);
    assert.equal(engine.vatTotal, c.expectedTax, `${c.name}: engine vatTotal`);
    assert.equal(engine.totalWithVat, c.expectedTotal, `${c.name}: engine total`);

    // ZATCA: every Percent in the document is the attested rate, and
    // the payable total equals the engine total.
    const rateLabel = c.rate.toFixed(2);
    const found = percents(zatca.ublXml);
    assert.ok(found.length >= 3, `${c.name}: percents present`);
    for (const p of found) assert.equal(p, rateLabel, `${c.name}: every Percent is ${rateLabel}`);
    assert.equal(payable(zatca.ublXml), c.expectedTotal.toFixed(2), `${c.name}: ZATCA payable`);

    // ETA: same line, same totals — one engine, two documents.
    assert.equal(eta.invoiceLines[0].taxableItems[0].rate, c.rate, `${c.name}: ETA rate`);
    assert.equal(eta.invoiceLines[0].taxableItems[0].amount, c.expectedTax, `${c.name}: ETA tax`);
    assert.equal(eta.invoiceLines[0].netTotal, c.expectedBase, `${c.name}: ETA net`);
    assert.equal(eta.invoiceLines[0].total, c.expectedTotal, `${c.name}: ETA line total`);
    assert.equal(eta.taxTotals[0].amount, c.expectedTax, `${c.name}: ETA tax total`);
    assert.equal(eta.totalAmount, c.expectedTotal, `${c.name}: ETA total`);
  }

  // Multi-line: totals equal the sum of the lines in both documents.
  const multiSale = { ...baseSale, tax_rate: 15, tax_amount: 12, prices_include_tax: false };
  const multiItems = [
    { ...baseItem, line_total: 50, net_line_total: 50, allocated_discount: 0, allocated_tax: 7.5 },
    {
      ...baseItem,
      qty: 1,
      unit_price: 30,
      line_total: 30,
      net_line_total: 30,
      allocated_discount: 0,
      allocated_tax: 4.5,
    },
  ];
  const multiZatca = await driveZatca(multiSale, multiItems);
  const multiEta = await driveEta(multiSale, multiItems);
  assert.equal(payable(multiZatca.ublXml), '92.00');
  assert.equal(multiEta.totalAmount, 92);
  assert.equal(multiEta.taxTotals[0].amount, 12);
  assert.equal(multiEta.invoiceLines[1].total, 34.5);

  // The stated attested rate wins over any line derivation: a sync
  // package whose stated rate is 14 but whose line says 15 signs
  // 14.00 at the document level (old code signed the line's 15.00).
  const syncSvc: any = Object.create(ZatcaPhase2Service.prototype);
  const inconsistent = syncSvc.generateZatcaPackage({
    invoiceNumber: 'INV-9',
    uuid: crypto.randomUUID(),
    issueDate: '2026-10-30',
    issueTime: '10:00:00',
    invoiceType: 'simplified',
    sellerName: 'Seller',
    sellerVatNumber: '300000000000003',
    sellerAddress: { street: 'S', buildingNumber: '1', city: 'Riyadh', postalCode: '12211', district: 'D' },
    customerName: 'Cash',
    lineItems: [
      { id: 1, name: 'Widget', quantity: 1, unitPrice: 100, subtotal: 100, vatAmount: 15, vatRate: 15, total: 115 },
    ],
    subtotal: 100,
    vatTotal: 15,
    totalWithVat: 115,
    documentVatRate: 14,
  });
  // The document-level TaxTotal comes before the lines in the UBL
  // template, so the first TaxTotal Percent is the document rate.
  // (Line percents keep their own line rate, 15.00, by design.)
  const docPercent = [
    ...inconsistent.ublXml.matchAll(/<cac:TaxTotal>[\s\S]*?<cbc:Percent>([^<]+)<\/cbc:Percent>/g),
  ].map((m) => m[1]);
  assert.equal(docPercent[0], '14.00', 'document-level Percent is the stated rate 14.00');

  console.log('Tax engine unification tests passed.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
