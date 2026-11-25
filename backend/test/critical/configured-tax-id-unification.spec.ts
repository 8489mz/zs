/*
New file: backend/test/critical/configured-tax-id-unification.spec.ts
Pins tax unification package 2: ONE pure rule picks the tenant's
configured tax row for every tax consumer — the VAT declaration,
the ZATCA signer, and the ETA serializer. Selection is shared;
validation stays local to each consumer.

WHAT THIS PINS:
- Pure rule table for selectConfiguredTaxRow: exact provider
  wins; with fallback (declaration only) a blank matched row
  loses to the first non-blank row; without fallback (ZATCA,
  ETA) a missing provider means no row and a blank or
  inactive matched row is returned as-is so the consumer's
  own fail-closed message survives.
- The real buildZatcaInvoice: a blank SAUDI row plus a filled
  ETA row still fails closed (no cross-jurisdiction leak);
  inactive and missing rows fail with their own messages;
  a valid SAUDI row signs with the SAUDI number.
- The real serializeSaleToEtaFormat: no ETA row throws the
  settings error; a blank ETA number keeps the legacy
  '100000' item-code fallback; a valid row is used.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as crypto from 'node:crypto';
import { ZatcaPhase2Service } from '../../src/modules/tax-integration/services/zatca/zatca-phase2.service';
import { EtaSerializerService } from '../../src/modules/tax-integration/services/eta-serializer/eta-serializer.service';
import { selectConfiguredTaxRow } from '../../src/modules/tax-integration/engines/configured-tax-id.engine';

async function main(): Promise<void> {
  // ---- Pure rule table ----
  const saudi = { provider: 'ZATCA_SAUDI', tax_id: '300000000000003', is_active: true };
  const egypt = { provider: 'ETA_EGYPT', tax_id: '123456789', is_active: true };

  assert.deepEqual(selectConfiguredTaxRow([saudi, egypt], { provider: 'ZATCA_SAUDI', allowFallback: false }), {
    taxId: '300000000000003',
    isActive: true,
  });
  assert.deepEqual(selectConfiguredTaxRow([egypt], { provider: 'ZATCA_SAUDI', allowFallback: false }), null);
  // Blank matched row is returned as-is without fallback: the
  // consumer fails closed on it instead of borrowing Egypt's number.
  assert.deepEqual(
    selectConfiguredTaxRow([{ provider: 'ZATCA_SAUDI', tax_id: '  ', is_active: true }, egypt], {
      provider: 'ZATCA_SAUDI',
      allowFallback: false,
    }),
    { taxId: '', isActive: true },
  );
  // Inactive is reported, never hidden.
  assert.deepEqual(
    selectConfiguredTaxRow([{ provider: 'ZATCA_SAUDI', tax_id: '300000000000003', is_active: false }], {
      provider: 'ZATCA_SAUDI',
      allowFallback: false,
    }),
    { taxId: '300000000000003', isActive: false },
  );
  // Fallback (declaration only): blank preferred loses to a
  // non-blank row; all blank means no row.
  assert.deepEqual(
    selectConfiguredTaxRow([{ provider: 'ZATCA_SAUDI', tax_id: '', is_active: true }, egypt], {
      provider: 'ZATCA_SAUDI',
      allowFallback: true,
    }),
    { taxId: '123456789', isActive: true },
  );
  assert.deepEqual(
    selectConfiguredTaxRow(
      [
        { provider: 'ZATCA_SAUDI', tax_id: '', is_active: true },
        { provider: 'ETA_EGYPT', tax_id: ' ', is_active: true },
      ],
      { provider: 'ZATCA_SAUDI', allowFallback: true },
    ),
    null,
  );
  assert.equal(selectConfiguredTaxRow([], { provider: 'ZATCA_SAUDI', allowFallback: true }), null);
  assert.equal(selectConfiguredTaxRow(null, { provider: 'ZATCA_SAUDI', allowFallback: false }), null);
  assert.deepEqual(
    selectConfiguredTaxRow([{ provider: 'ZATCA_SAUDI', tax_id: 300000000000003, is_active: true }], {
      provider: 'ZATCA_SAUDI',
      allowFallback: false,
    }),
    { taxId: '', isActive: true },
  );

  // ---- Real ZATCA builder drives ----
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

  function driveZatca(taxRows: Array<Record<string, unknown>>, egsUpdates: { count: number }) {
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
    const sale = {
      id: 7,
      doc_no: 'INV-7',
      status: 'posted',
      branch_id: null,
      customer_id: null,
      customer_name: 'Cash',
      created_at: new Date('2026-10-30T10:00:00.000Z'),
      tax_rate: 15,
      tax_amount: 15,
      prices_include_tax: false,
      zatca_icv: null,
      zatca_hash: null,
      zatca_uuid: null,
      zatca_ubl_xml: null,
      zatca_qr: null,
      zatca_egs_id: null,
    };
    const items = [
      {
        qty: 1,
        unit_price: 100,
        line_total: 100,
        product_name: 'Widget',
        net_line_total: 100,
        allocated_discount: 0,
        allocated_tax: 15,
      },
    ];
    const trx: any = {
      selectFrom: (table: string) => {
        if (table === 'sales') return chainable(sale);
        if (table === 'sale_items') return chainable(items);
        if (table === 'tenants') return chainable({ id: 'tenant-1', business_name: 'Tenant Co' });
        if (table === 'settings') return chainable([{ key: 'companyName', value: '"Acme Trading Co"' }]);
        if (table === 'tenant_tax_settings') return chainable(taxRows);
        return chainable(null);
      },
      insertInto: () => chainable(fakeUnit),
      updateTable: () => {
        egsUpdates.count += 1;
        return chainable({});
      },
    };
    const svc: any = Object.create(ZatcaPhase2Service.prototype);
    svc.db = { transaction: () => ({ execute: async (cb: any) => cb(trx) }) };
    svc.taxSettings = { getSettings: async () => ({ environment: 'sandbox' }) };
    return svc.buildZatcaInvoice('tenant-1', 7) as Promise<{ ublXml: string; icv: number }>;
  }

  const valid = await driveZatca([saudi, egypt], { count: 0 });
  assert.match(valid.ublXml, /<cbc:CompanyID>300000000000003<\/cbc:CompanyID>/);

  const leakUpdates = { count: 0 };
  await assert.rejects(
    driveZatca([{ provider: 'ZATCA_SAUDI', tax_id: ' ', is_active: true }, egypt], leakUpdates),
    /not configured/,
  );
  assert.equal(leakUpdates.count, 0);

  await assert.rejects(
    driveZatca([{ provider: 'ZATCA_SAUDI', tax_id: '300000000000003', is_active: false }], { count: 0 }),
    /inactive/,
  );
  await assert.rejects(driveZatca([egypt], { count: 0 }), /not configured/);

  // ---- Real ETA serializer drives ----
  function driveEta(taxRows: Array<Record<string, unknown>>) {
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
    const sale = {
      id: 7,
      doc_no: 'INV-7',
      status: 'posted',
      customer_id: null,
      customer_name: 'Cash',
      created_at: new Date('2026-10-30T10:00:00.000Z'),
      tax_rate: 14,
      tax_amount: 14,
      prices_include_tax: false,
      discount: 0,
    };
    const items = [
      {
        qty: 1,
        unit_price: 100,
        product_id: 11,
        product_name: 'Widget',
        line_total: 100,
        net_line_total: 100,
        allocated_discount: 0,
        allocated_tax: 14,
      },
    ];
    const svc: any = Object.create(EtaSerializerService.prototype);
    svc.db = {
      selectFrom: (table: string) => {
        if (table === 'sales') return chainable(sale);
        if (table === 'sale_items') return chainable(items);
        if (table === 'tenant_tax_settings') return chainable(taxRows);
        return chainable(null);
      },
    };
    svc.taxSettings = { getSettings: async () => null };
    return svc.serializeSaleToEtaFormat('tenant-1', 7) as Promise<any>;
  }

  const etaValid = await driveEta([saudi, egypt]);
  assert.equal(etaValid.invoiceLines[0].taxableItems[0].amount, 14);
  assert.match(etaValid.invoiceLines[0].itemCode, /EG-123456789-11/);

  await assert.rejects(driveEta([saudi]), /ETA Settings not configured/);

  const etaBlank = await driveEta([{ provider: 'ETA_EGYPT', tax_id: '', is_active: true }]);
  assert.match(etaBlank.invoiceLines[0].itemCode, /EG-100000-11/);

  console.log('Configured tax id unification tests passed.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
