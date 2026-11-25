/*
New file: backend/test/critical/zatca-seller-identity-and-profile.spec.ts
Pins ZATCA seller identity and clearance profile
(INV-ZATCA-SELLER-IDENTITY-AND-PROFILE).

THE GAPS, both in the signed document itself:
1. Seller identity was hardcoded: the name was a fixed demo
   string and the VAT number fell back to the fabricated
   '300000000000003' whenever no tax ID was configured — a
   fabricated identity that even defeated the downstream
   15-digit check, because the fake IS 15 digits. The VAT
   declaration already fails closed on a missing tax ID; the
   signer did not.
2. The clearance profile was hardcoded: every signed document
   carried <ProfileID>reporting:1.0</ProfileID>, including
   standard B2B invoices that ZATCA clears — those must carry
   clearance:1.0. The submission service already routes B2B to
   the clearance endpoint and B2C to reporting; the document
   itself misstated its profile.

THE RULE: the VAT number comes from the active ZATCA tax-settings
row (15 digits, else fail closed before the ICV chain advances);
the name follows companyName, then storeName, then the tenant
business name; ProfileID follows the invoice type. The structured
seller address has no configured source and stays as-is until a
structured address settings surface exists.

WHAT THIS PINS: the pure identity table, plus the REAL
buildZatcaInvoice driven with a mock DB (same harness shape as
the document-tax spec): a B2B sale signs with clearance:1.0 and
the configured name/VAT; a B2C sale signs with reporting:1.0;
a missing/inactive/malformed tax ID throws with zero EGS
updates (no ICV advance).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as crypto from 'node:crypto';
import { ZatcaPhase2Service } from '../../src/modules/tax-integration/services/zatca/zatca-phase2.service';
import {
  resolveZatcaSellerIdentity,
  parseSettingsText,
} from '../../src/modules/tax-integration/engines/zatca-seller-identity.engine';

function testIdentityTable(): void {
  assert.deepEqual(
    resolveZatcaSellerIdentity({
      taxId: '300123456700003',
      isActive: true,
      companyName: '"Acme Co"',
      storeName: 'Other',
      businessName: 'Tenant Co',
    }),
    { sellerName: 'Acme Co', sellerVatNumber: '300123456700003' },
  );
  assert.equal(
    resolveZatcaSellerIdentity({ taxId: '300123456700003', storeName: '  Shop Name  ', businessName: 'Tenant Co' })
      .sellerName,
    'Shop Name',
  );
  assert.equal(
    resolveZatcaSellerIdentity({ taxId: '300123456700003', businessName: 'Tenant Co' }).sellerName,
    'Tenant Co',
  );
  assert.equal(parseSettingsText('"Quoted Name"'), 'Quoted Name');
  assert.equal(parseSettingsText('Raw Name'), 'Raw Name');
  assert.equal(parseSettingsText(''), '');
  assert.equal(parseSettingsText(null), '');

  assert.throws(() => resolveZatcaSellerIdentity({ isActive: true, companyName: 'Acme' }), /not configured/);
  assert.throws(
    () => resolveZatcaSellerIdentity({ taxId: '300000000000003', isActive: false, companyName: 'Acme' }),
    /inactive/,
  );
  assert.throws(() => resolveZatcaSellerIdentity({ taxId: '12345', companyName: 'Acme' }), /15-digit/);
  assert.throws(() => resolveZatcaSellerIdentity({ taxId: '300123456700003' }), /seller name is not configured/);
  assert.throws(() => resolveZatcaSellerIdentity({ taxId: ' 300123456700003 ' }), /seller name is not configured/);
}

async function main(): Promise<void> {
  testIdentityTable();

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

  function drive(opts: {
    customerId: number | null;
    taxId?: string | null;
    isActive?: boolean;
    egsUpdates: { count: number };
  }) {
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
      customer_id: opts.customerId,
      customer_name: 'Buyer Co',
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
    const customer = { id: 9, name: 'Buyer Co', tax_number: '300987654300003', address: 'Buyer Street' };
    const trx: any = {
      selectFrom: (table: string) => {
        if (table === 'sales') return chainable(sale);
        if (table === 'sale_items') return chainable(items);
        if (table === 'customers') return chainable(customer);
        if (table === 'tenants') return chainable({ id: 'tenant-1', business_name: 'Tenant Co' });
        if (table === 'settings') return chainable([{ key: 'companyName', value: '"Acme Trading Co"' }]);
        if (table === 'tenant_tax_settings')
          return chainable(
            opts.taxId == null
              ? []
              : [{ provider: 'ZATCA_SAUDI', tax_id: opts.taxId, is_active: opts.isActive ?? true }],
          );
        return chainable(null);
      },
      insertInto: () => chainable(fakeUnit),
      updateTable: () => {
        opts.egsUpdates.count += 1;
        return chainable({});
      },
    };
    const svc: any = Object.create(ZatcaPhase2Service.prototype);
    svc.db = { transaction: () => ({ execute: async (cb: any) => cb(trx) }) };
    svc.taxSettings = {
      getSettings: async () => ({ environment: 'sandbox' }),
    };
    return svc.buildZatcaInvoice('tenant-1', 7) as Promise<{ ublXml: string; icv: number }>;
  }

  // B2B: clearance profile + configured identity.
  const b2bUpdates = { count: 0 };
  const b2b = await drive({ customerId: 9, taxId: '300123456700003', egsUpdates: b2bUpdates });
  assert.equal(b2b.icv, 1);
  assert.match(b2b.ublXml, /<cbc:ProfileID>clearance:1\.0<\/cbc:ProfileID>/);
  assert.match(b2b.ublXml, /<cbc:RegistrationName><!\[CDATA\[Acme Trading Co\]\]><\/cbc:RegistrationName>/);
  assert.match(b2b.ublXml, /<cbc:CompanyID>300123456700003<\/cbc:CompanyID>/);
  assert.doesNotMatch(b2b.ublXml, /300000000000003/);

  // B2C: reporting profile, same configured identity.
  const b2c = await drive({ customerId: null, taxId: '300123456700003', egsUpdates: { count: 0 } });
  assert.match(b2c.ublXml, /<cbc:ProfileID>reporting:1\.0<\/cbc:ProfileID>/);
  assert.match(b2c.ublXml, /<cbc:RegistrationName><!\[CDATA\[Acme Trading Co\]\]><\/cbc:RegistrationName>/);

  // Missing tax ID: fail closed before any EGS update (no ICV advance).
  const missingUpdates = { count: 0 };
  await assert.rejects(drive({ customerId: 9, taxId: null, egsUpdates: missingUpdates }), /not configured/);
  assert.equal(missingUpdates.count, 0);

  // Inactive settings and malformed tax ID: same fail-closed.
  await assert.rejects(
    drive({ customerId: 9, taxId: '300123456700003', isActive: false, egsUpdates: { count: 0 } }),
    /inactive/,
  );
  await assert.rejects(drive({ customerId: 9, taxId: '12345', egsUpdates: { count: 0 } }), /15-digit/);

  console.log('ZATCA seller identity and profile tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
