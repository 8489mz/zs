/*
New file: backend/test/critical/zatca-document-tax.spec.ts
Pins tax unification package 1: the signed ZATCA document attests the
POSTED invoice through the unified document-tax engine — never a
recomputation at a hardcoded rate. The old builder hardcoded 15% and
re-derived every line's tax from line_total (gross, discount-blind,
tax-inclusive-blind), so an exempt sale signed as 15%, a 14% sale
signed as 15%, and a tax-inclusive sale signed at 15% of its
tax-inclusive total. The document-level <cbc:Percent> was hardcoded
15.00 even though per-line percents were already data-driven.

WHAT THIS PINS:
- Pure rule table for buildDocumentTax: stored allocations
  (net_line_total / allocated_tax) win over any recomputation;
  legacy lines without allocations fall back to the STORED rate
  only (never a hardcoded one), with tax-inclusive extraction;
  document totals equal the sum of the document lines exactly.
- The real buildZatcaInvoice, driven with a mock DB: a stored 14%
  sale signs at 14.00, an exempt sale at 0.00, a legacy
  tax-inclusive sale at its stored 14% — with no 15.00 anywhere.
- The sync generateZatcaPackage path: the document percent follows
  the passed line rate (0% data signs at 0.00, not 15.00).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as crypto from 'node:crypto';
import { ZatcaPhase2Service } from '../../src/modules/tax-integration/services/zatca/zatca-phase2.service';
import { buildDocumentTax } from '../../src/modules/tax-integration/engines/document-tax.engine';

async function main(): Promise<void> {
  // ---- Pure engine: stored allocations win ----
  const stored = buildDocumentTax({
    rate: 15,
    pricesIncludeTax: false,
    documentDigits: 2,
    lines: [{ lineTotal: 66.7, netLineTotal: 66.7, allocatedTax: 10.01 }],
  });
  assert.equal(stored.lines[0].base, 66.7);
  assert.equal(stored.lines[0].tax, 10.01);
  assert.equal(stored.lines[0].total, 76.71);
  assert.equal(stored.rate, 15);

  // Exempt sale: stored rate 0 signs at 0, not 15.
  const exempt = buildDocumentTax({
    rate: 0,
    pricesIncludeTax: false,
    documentDigits: 2,
    lines: [{ lineTotal: 100, netLineTotal: 100, allocatedTax: 0 }],
  });
  assert.equal(exempt.vatTotal, 0);
  assert.equal(exempt.totalWithVat, 100);

  // Stored allocations + tax-inclusive prices: no extraction math.
  const inclusiveStored = buildDocumentTax({
    rate: 15,
    pricesIncludeTax: true,
    documentDigits: 2,
    lines: [{ lineTotal: 115, netLineTotal: 100, allocatedTax: 15 }],
  });
  assert.equal(inclusiveStored.lines[0].base, 100);
  assert.equal(inclusiveStored.lines[0].tax, 15);

  // ---- Legacy fallback: stored rate only ----
  const legacyExclusive = buildDocumentTax({
    rate: 14,
    pricesIncludeTax: false,
    documentDigits: 2,
    lines: [{ lineTotal: 100 }],
  });
  assert.equal(legacyExclusive.lines[0].tax, 14);
  assert.equal(legacyExclusive.rate, 14);

  const legacyInclusive = buildDocumentTax({
    rate: 14,
    pricesIncludeTax: true,
    documentDigits: 2,
    lines: [{ lineTotal: 114 }],
  });
  assert.equal(legacyInclusive.lines[0].base, 100);
  assert.equal(legacyInclusive.lines[0].tax, 14);

  const legacyDiscount = buildDocumentTax({
    rate: 15,
    pricesIncludeTax: false,
    documentDigits: 2,
    lines: [{ lineTotal: 120, allocatedDiscount: 20 }],
  });
  assert.equal(legacyDiscount.lines[0].base, 100);
  assert.equal(legacyDiscount.lines[0].tax, 15);

  // Multi-line: document totals equal the sum of the document lines.
  const multi = buildDocumentTax({
    rate: 15,
    pricesIncludeTax: false,
    documentDigits: 2,
    lines: [
      { lineTotal: 50, netLineTotal: 50, allocatedTax: 7.5 },
      { lineTotal: 30, netLineTotal: 30, allocatedTax: 4.5 },
    ],
  });
  assert.equal(multi.subtotal, 80);
  assert.equal(multi.vatTotal, 12);
  assert.equal(multi.totalWithVat, 92);

  // ---- Fail-closed ----
  assert.throws(
    () => buildDocumentTax({ rate: -5, pricesIncludeTax: false, documentDigits: 2, lines: [{ lineTotal: 100 }] }),
    /DOCUMENT_TAX_RATE_INVALID/,
  );
  assert.throws(
    () => buildDocumentTax({ rate: 15, pricesIncludeTax: false, documentDigits: 2, lines: [] }),
    /DOCUMENT_TAX_NO_LINES/,
  );
  assert.throws(
    () =>
      buildDocumentTax({ rate: 15, pricesIncludeTax: false, documentDigits: 2, lines: [{ lineTotal: Number.NaN }] }),
    /DOCUMENT_TAX_LINE_INVALID/,
  );
  assert.throws(
    () =>
      buildDocumentTax({
        rate: 15,
        pricesIncludeTax: false,
        documentDigits: 2,
        lines: [{ lineTotal: 100, netLineTotal: 100, allocatedTax: -1 }],
      }),
    /DOCUMENT_TAX_ALLOCATION_INVALID/,
  );
  assert.throws(
    () =>
      buildDocumentTax({
        rate: 15,
        pricesIncludeTax: false,
        documentDigits: 2,
        lines: [{ lineTotal: 100, allocatedDiscount: 150 }],
      }),
    /DOCUMENT_TAX_LINE_INVALID/,
  );

  // ---- Real buildZatcaInvoice, mock DB ----
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

  function drive(sale: Record<string, unknown>, items: Array<Record<string, unknown>>) {
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

  const baseSale = {
    id: 7,
    doc_no: 'INV-7',
    status: 'posted',
    branch_id: null,
    customer_id: null,
    customer_name: 'Cash',
    created_at: new Date('2026-10-30T10:00:00.000Z'),
    tax_amount: 14,
    zatca_icv: null,
    zatca_hash: null,
    zatca_uuid: null,
    zatca_ubl_xml: null,
    zatca_qr: null,
    zatca_egs_id: null,
  };

  // Stored 14% sale signs at 14.00 — the old builder signed 15.00/15.00/115.00.
  const stored14 = await drive({ ...baseSale, tax_rate: 14, prices_include_tax: false }, [
    {
      qty: 1,
      unit_price: 100,
      line_total: 100,
      product_name: 'Widget',
      net_line_total: 100,
      allocated_discount: 0,
      allocated_tax: 14,
    },
  ]);
  assert.equal(stored14.icv, 1);
  assert.match(stored14.ublXml, /<cbc:Percent>14\.00<\/cbc:Percent>/);
  assert.match(stored14.ublXml, /<cbc:TaxAmount currencyID="SAR">14\.00<\/cbc:TaxAmount>/);
  assert.match(stored14.ublXml, /<cbc:PayableAmount currencyID="SAR">114\.00<\/cbc:PayableAmount>/);
  assert.doesNotMatch(stored14.ublXml, /15\.00/);

  // Exempt sale signs at 0.00.
  const exemptSale = await drive({ ...baseSale, tax_rate: 0, tax_amount: 0, prices_include_tax: false }, [
    {
      qty: 1,
      unit_price: 100,
      line_total: 100,
      product_name: 'Widget',
      net_line_total: 100,
      allocated_discount: 0,
      allocated_tax: 0,
    },
  ]);
  assert.match(exemptSale.ublXml, /<cbc:Percent>0\.00<\/cbc:Percent>/);
  assert.match(exemptSale.ublXml, /<cbc:PayableAmount currencyID="SAR">100\.00<\/cbc:PayableAmount>/);
  assert.doesNotMatch(exemptSale.ublXml, /15\.00/);

  // Legacy tax-inclusive sale without allocations: stored 14% extracted.
  const legacySale = await drive({ ...baseSale, tax_rate: 14, tax_amount: 14, prices_include_tax: true }, [
    {
      qty: 1,
      unit_price: 114,
      line_total: 114,
      product_name: 'Widget',
      net_line_total: null,
      allocated_discount: null,
      allocated_tax: null,
    },
  ]);
  assert.match(legacySale.ublXml, /<cbc:Percent>14\.00<\/cbc:Percent>/);
  assert.match(legacySale.ublXml, /<cbc:TaxAmount currencyID="SAR">14\.00<\/cbc:TaxAmount>/);
  assert.match(legacySale.ublXml, /<cbc:PayableAmount currencyID="SAR">114\.00<\/cbc:PayableAmount>/);
  assert.doesNotMatch(legacySale.ublXml, /15\.00/);

  // ---- Sync path: document percent follows the passed line rate ----
  const syncSvc: any = Object.create(ZatcaPhase2Service.prototype);
  const syncPkg = syncSvc.generateZatcaPackage({
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
      { id: 1, name: 'Widget', quantity: 1, unitPrice: 100, subtotal: 100, vatAmount: 0, vatRate: 0, total: 100 },
    ],
    subtotal: 100,
    vatTotal: 0,
    totalWithVat: 100,
    documentVatRate: 0,
  });
  assert.match(syncPkg.ublXml, /<cbc:Percent>0\.00<\/cbc:Percent>/);
  assert.doesNotMatch(syncPkg.ublXml, /15\.00/);

  console.log('ZATCA document-tax tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
