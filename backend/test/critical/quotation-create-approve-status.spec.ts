/*
 * I10-A (R8): "اعتماد وحفظ عرض السعر" saved a DRAFT.
 *
 * WHAT WAS WRONG (live re-test 2026-11-09 §5(d)): a new quotation
 * QUO-183760 was created for عميل اختبار 00001, 1,200 EGP, with the
 * success toast — but it saved as مسودة despite clicking
 * "اعتماد وحفظ". Grounding at base 36292db2:
 * - CreateQuotationPage's "حفظ كمسودة", "اعتماد عرض السعر" and
 *   "اعتماد وحفظ عرض السعر" buttons ALL called the same
 *   handleSubmit, whose payload carried no status/approve flag;
 * - CreateQuotationDto had no status field and
 *   QuotationsService.createQuotation hardcoded status: 'draft';
 * - no UI path anywhere could move a quotation out of draft
 *   (quotationsApi.update accepts a status but has zero callers;
 *   the quotations list offers only print/convert/delete).
 * So the approve button was a dead promise: the flow never sent
 * approval and the backend never honoured one.
 *
 * THE FIX (canonical place, this service): createQuotation honours
 * an explicit creation status, whitelisted to 'sent' | 'draft'.
 * 'sent' is the issued/approved document in the existing status
 * vocabulary (draft → sent → accepted → converted): 'accepted' is
 * the CUSTOMER's response and 'converted' is set by convertToSale,
 * so creation may never mint either — both fail closed to 'draft'.
 * No migration: status is a free varchar(50) with default 'draft'.
 *
 * WHAT THIS PINS, driving the REAL QuotationsService on PGlite:
 * - create without a status still lands as 'draft' (existing
 *   behaviour pinned), items stored;
 * - create with status 'sent' lands as 'sent' — clicking
 *   approve-and-save produces an APPROVED (issued) quotation;
 * - create with 'accepted' or 'converted' fails closed to 'draft';
 * - listQuotations({ status: 'sent' }) returns the approved one,
 *   so the list shows it under مرسلة, not مسودات.
 *
 * Deliberately NOT driven here: the React button wiring (pinned by
 * CreateQuotationPage.spec.tsx — approve sends status 'sent',
 * save-as-draft sends 'draft'); live-Postgres acceptance.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { QuotationsService } from '../../src/modules/sales/services/quotations.service';
import type { CreateQuotationDto } from '../../src/modules/sales/dto/quotation.dto';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const AUTH = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: [],
} as unknown as AuthContext;

function baseDto(overrides: Record<string, unknown> = {}): CreateQuotationDto {
  return {
    customerId: 42,
    customerName: 'عميل اختبار 00001',
    customerPhone: '01000000001',
    subtotal: 1200,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 1200,
    items: [
      {
        productId: 7,
        productName: 'اختبار صنف استيراد 001',
        unitName: 'قطعة',
        quantity: 10,
        unitPrice: 120,
        discount: 0,
        total: 1200,
      },
    ],
    ...overrides,
  } as CreateQuotationDto;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE quotations (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, quotation_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, branch_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, valid_until timestamptz, status text NOT NULL, sale_id bigint, notes text, terms_conditions text, created_by bigint, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE quotation_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, quotation_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
    `);

    // createQuotation never touches the sale writer; an empty stub
    // keeps the service hand-constructible like the conversion specs.
    const service = new QuotationsService(db as any, {} as any);

    async function quoteRow(id: number): Promise<{ status: string; number: string }> {
      const row = await db
        .selectFrom('quotations')
        .select(['status', 'quotation_number'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return { status: String(row.status), number: String(row.quotation_number) };
    }

    // Case 1: no status → draft (existing behaviour pinned), items stored.
    {
      const res: any = await service.createQuotation(baseDto(), AUTH);
      assert.ok(res.ok, 'create without status succeeds');
      assert.equal(await quoteRow(res.quotation.id).then((r) => r.status), 'draft');
      assert.match(res.quotation.quotation_number, /^QUO-\d{6}$/);
      const items = await db
        .selectFrom('quotation_items')
        .selectAll()
        .where('quotation_id', '=', res.quotation.id)
        .execute();
      assert.equal(items.length, 1);
      assert.equal(items[0].product_name, 'اختبار صنف استيراد 001');
    }

    // Case 2: the re-test defect — approve-and-save must land 'sent'.
    let approvedId: number;
    {
      const res: any = await service.createQuotation(baseDto({ status: 'sent' }), AUTH);
      assert.ok(res.ok, 'create with status sent succeeds');
      approvedId = res.quotation.id;
      const row = await quoteRow(approvedId);
      assert.equal(row.status, 'sent', 'approve-and-save produces an APPROVED quotation, not a draft');
    }

    // Case 3: 'accepted' is the customer's response — creation may
    // never mint it; fails closed to 'draft'. The cast simulates a
    // client sending a status outside the creation vocabulary.
    {
      const res: any = await service.createQuotation(
        baseDto({ status: 'accepted' }) as unknown as CreateQuotationDto,
        AUTH,
      );
      assert.equal((await quoteRow(res.quotation.id)).status, 'draft');
    }

    // Case 4: 'converted' is set only by convertToSale — creation
    // may never mint it either.
    {
      const res: any = await service.createQuotation(
        baseDto({ status: 'converted' }) as unknown as CreateQuotationDto,
        AUTH,
      );
      assert.equal((await quoteRow(res.quotation.id)).status, 'draft');
    }

    // Case 5: the approved quotation is visible under the 'sent'
    // list filter — i.e. the list no longer shows it as a draft.
    {
      const listed: any = await service.listQuotations(AUTH, { status: 'sent' });
      const ids = listed.quotations.map((q: any) => q.id);
      assert.ok(ids.includes(approvedId!), 'approved quotation listed under sent');
      assert.ok(
        listed.quotations.every((q: any) => q.status === 'sent'),
        'sent filter returns only sent quotations',
      );
      const drafts: any = await service.listQuotations(AUTH, { status: 'draft' });
      assert.ok(
        !drafts.quotations.map((q: any) => q.id).includes(approvedId!),
        'approved quotation is NOT listed under drafts',
      );
    }
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => {
    console.log('Quotation create approve-status tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
