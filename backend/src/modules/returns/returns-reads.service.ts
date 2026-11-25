import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { getTenantTimezone } from '../../common/utils/tenant-timezone.util';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope, type TenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { boundedPage } from '../../common/utils/bounded-page';
import { mapReturnRows } from './helpers/returns-listing.helper';
import { Database } from '../../database/database.types';
import { buildInvoiceReturnedQuantities } from './helpers/return-invoice-quantities.helper';

export interface ReturnsReadsDeps {
  db: Kysely<Database>;
  tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
  scope: (auth: AuthContext) => TenantScope;
}

@Injectable()
export class ReturnsReadsService {
  private readonly db: Kysely<Database>;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
  private readonly scope: (auth: AuthContext) => TenantScope;

  constructor(deps: ReturnsReadsDeps) {
    this.db = deps.db;
    this.tenantPredicate = deps.tenantPredicate;
    this.scope = deps.scope;
  }

  async listReturns(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const today = await resolveBusinessDateKey(this.db, this.scope(auth).tenantId, new Date());
    // The "today" filter compares the tenant day against row days keyed
    // in the same zone (INV-SINGLE-SERVER-CLOCK-TENANT-TZ): without the
    // zone the helper falls back to a UTC slice and the filter drops
    // in-window returns 00:00-02:59 Cairo.
    const tenantTimezone = await getTenantTimezone(this.db, this.scope(auth).tenantId);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, this.scope(auth).tenantId));
    // INV-RETURNS-SERVICES-USERS-SQL-PAGINATION: the page is fetched
    // from SQL — the old in-memory pagination semantics are preserved
    // (defaultSize 20, page clamped to [1, totalPages], cap 200), and
    // the summary stays exact over the FULL filtered set. The per-doc
    // derived values are the same ones mapReturnRows computes (docNo
    // fallback always 'ZR-' + id; returnType 'purchase' iff
    // return_type = 'purchase'; productName is the single item's name
    // or 'N أصناف'; refundTotal is roundMoney(total + tipRelief +
    // courierRelief, 3) per doc). The filter is NOT lowercased; q is
    // trim().toLowerCase() over the derived fields.
    const q = String(query.search || query.q || '')
      .trim()
      .toLowerCase();
    const filter = String(query.filter || query.view || 'all').trim();
    const employee = String(query.employee || query.employeeName || '')
      .trim()
      .toLowerCase();
    const docs = sql<{
      id: number;
      doc_no: string;
      return_type: string;
      note: string;
      created_by_name: string;
      date_key: string;
      refund_total: string;
      product_name: string;
    }>`
      SELECT rd.id,
        coalesce(nullif(rd.doc_no, ''), 'ZR-' || rd.id) AS doc_no,
        CASE WHEN rd.return_type = 'purchase' THEN 'purchase' ELSE 'sale' END AS return_type,
        coalesce(rd.note, '') AS note,
        coalesce(u.username, '') AS created_by_name,
        (rd.created_at AT TIME ZONE ${tenantTimezone})::date AS date_key,
        ROUND(coalesce(SUM(ri.line_total), 0) + coalesce(MAX(rd.tip_relief), 0) + coalesce(MAX(rd.courier_relief), 0), 3) AS refund_total,
        CASE WHEN COUNT(ri.id) = 1 THEN MAX(ri.product_name) ELSE COUNT(ri.id) || ' أصناف' END AS product_name
      FROM return_documents rd
      INNER JOIN return_items ri ON ri.return_document_id = rd.id AND ri.tenant_id = rd.tenant_id
      LEFT JOIN users u ON u.id = rd.created_by AND u.tenant_id = rd.tenant_id
      WHERE ${this.tenantPredicate(auth, 'rd')}
      GROUP BY rd.id, rd.doc_no, rd.return_type, rd.note, rd.created_at, u.username
    `;
    const outerWhere = sql<boolean>`true${filter === 'sales' ? sql` AND d.return_type = 'sale'` : sql``}${filter === 'purchase' ? sql` AND d.return_type = 'purchase'` : sql``}${filter === 'today' ? sql` AND d.date_key = ${today}::date` : sql``}${employee ? sql` AND strpos(lower(d.created_by_name), ${employee}) > 0` : sql``}${q ? sql` AND (strpos(lower(d.doc_no), ${q}) > 0 OR strpos(lower(d.product_name), ${q}) > 0 OR strpos(lower(d.note), ${q}) > 0 OR strpos(lower(d.return_type), ${q}) > 0 OR strpos(lower(d.created_by_name), ${q}) > 0)` : sql``}`;
    const counts = await sql<{
      total_items: string;
      total_amount: string;
      sales_returns: string;
      purchase_returns: string;
      today_count: string;
      latest_doc_no: string | null;
    }>`
      SELECT COUNT(*) AS total_items,
        coalesce(SUM(d.refund_total), 0) AS total_amount,
        COUNT(*) FILTER (WHERE d.return_type = 'sale') AS sales_returns,
        COUNT(*) FILTER (WHERE d.return_type = 'purchase') AS purchase_returns,
        COUNT(*) FILTER (WHERE d.date_key = ${today}::date) AS today_count,
        (array_agg(d.doc_no ORDER BY d.id DESC))[1] AS latest_doc_no
      FROM (${docs}) d
      WHERE ${outerWhere}
    `.execute(this.db);
    const totalItems = Number(counts.rows[0]?.total_items || 0);
    const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 20);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const pageIds = await sql<{ id: number }>`
      SELECT d.id FROM (${docs}) d WHERE ${outerWhere} ORDER BY d.id DESC LIMIT ${pageSize} OFFSET ${offset}
    `.execute(this.db);
    const ids = pageIds.rows.map((row) => Number(row.id || 0)).filter((id) => id > 0);
    const rows = ids.length
      ? await this.db
          .selectFrom('return_items as ri')
          .innerJoin('return_documents as rd', (join) =>
            join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'),
          )
          .leftJoin('users as u', (join) =>
            join.onRef('u.id', '=', 'rd.created_by').onRef('u.tenant_id', '=', 'rd.tenant_id'),
          )
          .leftJoin('sales as s', (join) =>
            join
              .on('rd.return_type', '=', 'sale')
              .onRef('s.id', '=', 'rd.invoice_id')
              .onRef('s.tenant_id', '=', 'rd.tenant_id'),
          )
          .leftJoin('customers as c', (join) =>
            join.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 'rd.tenant_id'),
          )
          .leftJoin('purchases as p', (join) =>
            join
              .on('rd.return_type', '=', 'purchase')
              .onRef('p.id', '=', 'rd.invoice_id')
              .onRef('p.tenant_id', '=', 'rd.tenant_id'),
          )
          .leftJoin('suppliers as sup', (join) =>
            join.onRef('sup.id', '=', 'p.supplier_id').onRef('sup.tenant_id', '=', 'rd.tenant_id'),
          )
          .select([
            'ri.id',
            'rd.id as return_document_id',
            'rd.doc_no',
            'rd.return_type',
            'rd.invoice_id',
            'ri.product_id',
            'ri.product_name',
            'ri.qty',
            'ri.line_total',
            'rd.note',
            'rd.settlement_mode',
            'rd.refund_method',
            'rd.refund_allocations',
            'rd.tip_relief',
            'rd.courier_relief',
            'rd.created_at',
            'rd.created_by',
            'u.username as created_by_name',
            sql<string>`coalesce(s.doc_no, p.doc_no, '')`.as('invoice_doc_no'),
            sql<string>`coalesce(c.name, sup.name, case when rd.return_type = 'sale' then 'عميل نقدي' else 'مورد' end)`.as(
              'party_name',
            ),
            sql<string>`coalesce(s.order_type, '')`.as('order_type'),
          ])
          .where('rd.id', 'in', ids)
          .where(this.tenantPredicate(auth, 'rd'))
          .where(this.tenantPredicate(auth, 'ri'))
          .orderBy('rd.id', 'desc')
          .orderBy('ri.id', 'asc')
          .execute()
      : [];
    const mapped = mapReturnRows(rows as Array<Record<string, unknown>>);
    // The summary is exact over the FULL filtered set, never page-scoped.
    const summary = {
      totalItems,
      totalAmount: roundMoney(Number(counts.rows[0]?.total_amount || 0), moneyDigits),
      salesReturns: Number(counts.rows[0]?.sales_returns || 0),
      purchaseReturns: Number(counts.rows[0]?.purchase_returns || 0),
      todayCount: Number(counts.rows[0]?.today_count || 0),
      latestDocNo: counts.rows[0]?.latest_doc_no || '',
    };
    return {
      returns: mapped,
      pagination: { page: safePage, pageSize, totalItems, totalPages },
      summary,
      scope: this.scope(auth),
    };
  }

  /* INV-STATEMENT-RETURN-ROW-DETAILS: single return-document read for the
   * supplier/customer statement details button. A ledger row carries only
   * the return id (reference_type 'return_document', entry_type
   * 'purchase_return' / 'sale_return'); the ZPR/ZR number, the party, the
   * original invoice, the items and the journal number live on the return
   * document and its lines, never on the ledger row. The journal number is
   * read from journal_entries.entry_no -- never fabricated from the journal
   * id (gapless numbering, INV-JE-NUMBERING-GAP). The journal source type
   * follows the return type ('purchase_return' / 'sales_return'). A missing
   * return throws RETURN_NOT_FOUND, never PURCHASE_NOT_FOUND: the id is a
   * return id, and a purchase lookup on it would either fail with the wrong
   * error or -- worse -- return an unrelated invoice whose id happened to
   * collide. */
  async getReturnById(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const row = await this.db
      .selectFrom('return_documents as rd')
      .leftJoin('sales as s', (join) =>
        join
          .on('rd.return_type', '=', 'sale')
          .onRef('s.id', '=', 'rd.invoice_id')
          .onRef('s.tenant_id', '=', 'rd.tenant_id'),
      )
      .leftJoin('customers as c', (join) =>
        join.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 'rd.tenant_id'),
      )
      .leftJoin('purchases as p', (join) =>
        join
          .on('rd.return_type', '=', 'purchase')
          .onRef('p.id', '=', 'rd.invoice_id')
          .onRef('p.tenant_id', '=', 'rd.tenant_id'),
      )
      .leftJoin('suppliers as sup', (join) =>
        join.onRef('sup.id', '=', 'p.supplier_id').onRef('sup.tenant_id', '=', 'rd.tenant_id'),
      )
      .leftJoin('branches as b', (join) =>
        join.onRef('b.id', '=', 'rd.branch_id').onRef('b.tenant_id', '=', 'rd.tenant_id'),
      )
      .leftJoin('stock_locations as l', (join) =>
        join.onRef('l.id', '=', 'rd.location_id').onRef('l.tenant_id', '=', 'rd.tenant_id'),
      )
      .leftJoin('users as u', (join) =>
        join.onRef('u.id', '=', 'rd.created_by').onRef('u.tenant_id', '=', 'rd.tenant_id'),
      )
      .select([
        'rd.id',
        'rd.doc_no',
        'rd.return_type',
        'rd.invoice_id',
        'rd.settlement_mode',
        'rd.refund_method',
        'rd.refund_allocations',
        'rd.total',
        'rd.tip_relief',
        'rd.courier_relief',
        'rd.forfeited_header_discount',
        'rd.goodwill_amount',
        'rd.goodwill_reason',
        'rd.header_discount_mode',
        'rd.note',
        'rd.created_at',
        'rd.created_by',
        sql<string>`coalesce(s.doc_no, p.doc_no, '')`.as('invoice_doc_no'),
        sql<string>`coalesce(c.name, sup.name, '')`.as('party_name'),
        'b.name as branch_name',
        'l.name as location_name',
        'u.username as created_by_name',
      ])
      .where('rd.id', '=', id)
      .where(this.tenantPredicate(auth, 'rd'))
      .executeTakeFirst();

    if (!row) throw new AppError('Return not found', 'RETURN_NOT_FOUND', 404);

    const items = await this.db
      .selectFrom('return_items')
      .select(['id', 'product_id', 'product_name', 'qty', 'unit_total', 'line_total', 'allocated_tax'])
      .where('return_document_id', '=', id)
      .where(this.tenantPredicate(auth))
      .orderBy('id', 'asc')
      .execute();

    const journalSourceType = row.return_type === 'sale' ? 'sales_return' : 'purchase_return';
    const journal = await this.db
      .selectFrom('journal_entries')
      .select(['id', 'entry_no'])
      .where('source_type', '=', journalSourceType)
      .where('source_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();

    return {
      returnDocument: {
        id: String(row.id),
        docNo: row.doc_no || (row.return_type === 'sale' ? `ZR-${row.id}` : `ZPR-${row.id}`),
        returnType: row.return_type,
        invoiceId: row.invoice_id ? String(row.invoice_id) : '',
        invoiceDocNo: row.invoice_doc_no || '',
        partyName: row.party_name || '',
        total: Number(row.total || 0),
        tipRelief: Number(row.tip_relief || 0),
        courierRelief: Number(row.courier_relief || 0),
        refundTotal: Number(row.total || 0) + Number(row.tip_relief || 0) + Number(row.courier_relief || 0),
        forfeitedHeaderDiscount: Number(row.forfeited_header_discount || 0),
        goodwillAmount: Number(row.goodwill_amount || 0),
        goodwillReason: row.goodwill_reason || '',
        headerDiscountMode: row.header_discount_mode === 'forfeit' ? 'forfeit' : 'original',
        note: row.note || '',
        settlementMode: row.settlement_mode || '',
        refundMethod: row.refund_method || '',
        refundAllocations: (() => {
          const raw: unknown = row.refund_allocations;
          if (raw == null) return [];
          try {
            const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })(),
        date: row.created_at,
        branchName: row.branch_name || '',
        locationName: row.location_name || '',
        createdBy: row.created_by_name || '',
        journalEntryId: journal ? String(journal.id) : '',
        journalNo: journal ? journal.entry_no || '' : '',
        items: items.map((item) => ({
          id: String(item.id),
          productId: item.product_id ? String(item.product_id) : '',
          productName: item.product_name || '',
          qty: Number(item.qty || 0),
          unitTotal: Number(item.unit_total || 0),
          lineTotal: Number(item.line_total || 0),
          allocatedTax: Number(item.allocated_tax || 0),
        })),
      },
      scope,
    };
  }

  /** Unpaginated invoice-return history, used only to guide the UI.
   * Transactional posting independently checks quantities with invoice locks.
   */
  async getInvoiceReturnedQuantities(
    type: string,
    invoiceId: number,
    auth: AuthContext,
  ): Promise<{ returnedQtyByLine: Record<string, number>; blockedProductIds: string[] }> {
    if (!['sale', 'purchase'].includes(type)) {
      throw new AppError('Invalid return type', 'RETURN_TYPE_INVALID', 400);
    }
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0)
      throw new AppError('Invalid invoice', 'INVOICE_NOT_FOUND', 404);
    const tenantId = this.scope(auth).tenantId;
    const returnType = type as 'sale' | 'purchase';
    const parent =
      returnType === 'sale'
        ? await this.db
            .selectFrom('sales')
            .select('id')
            .where('id', '=', invoiceId)
            .where('tenant_id', '=', tenantId)
            .where('status', '=', 'posted')
            .executeTakeFirst()
        : await this.db
            .selectFrom('purchases')
            .select('id')
            .where('id', '=', invoiceId)
            .where('tenant_id', '=', tenantId)
            .where('status', '=', 'posted')
            .executeTakeFirst();
    if (!parent) throw new AppError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    const rows = await this.db
      .selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) =>
        join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'),
      )
      .select([
        'ri.product_id',
        'ri.sale_item_id',
        'ri.purchase_item_id',
        (eb) => eb.fn.sum<number>('ri.qty').as('returned_qty'),
      ])
      .where('rd.return_type', '=', returnType)
      .where('rd.invoice_id', '=', invoiceId)
      .where('rd.tenant_id', '=', tenantId)
      .where('ri.tenant_id', '=', tenantId)
      .groupBy(['ri.product_id', 'ri.sale_item_id', 'ri.purchase_item_id'])
      .execute();
    return buildInvoiceReturnedQuantities(returnType, rows);
  }
}
