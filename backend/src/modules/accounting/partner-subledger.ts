import { lockAccountingPeriod } from './accounting-period-lock';
import { BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { tenantBaseCurrency } from './accounting-currency';
import { currencyMoneyDigits, fromMinorUnits, toMinorUnits } from './engines/money-minor-units.engine';

/** New domain documents post GL and the shared partner ledger in the same transaction. */
export async function syncPostedPartnerLedger(db: Kysely<Database>, tenantId: string, entryId: number): Promise<void> {
  const movements = await db.selectFrom('journal_entry_lines as l')
    .innerJoin('accounting_accounts as a', join => join.onRef('a.id', '=', 'l.account_id').onRef('a.tenant_id', '=', 'l.tenant_id'))
    .innerJoin('journal_entries as j', join => join.onRef('j.id', '=', 'l.journal_entry_id').onRef('j.tenant_id', '=', 'l.tenant_id'))
    .select(['l.partner_type', 'l.partner_id', 'l.debit', 'l.credit', 'l.branch_id', 'l.location_id', 'j.entry_date', 'j.description', 'j.account_id', 'j.created_by', 'j.source_type', 'a.code', 'a.is_receivable', 'a.is_payable'])
    .where('l.tenant_id', '=', tenantId).where('j.tenant_id', '=', tenantId).where('l.journal_entry_id', '=', entryId)
    .where(eb => eb.or([eb('a.is_receivable', '=', true), eb('a.is_payable', '=', true), eb('a.code', 'in', ['1130', '2110'])]))
    .orderBy('l.partner_type').orderBy('l.partner_id').execute();
  const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(db, tenantId));
  const groups = new Map<string, { row: typeof movements[number]; amount: number }>();
  for (const row of movements) {
    // Broker-capitalisation receipt leg (INV-IMPORT-BROKER-
    // CAPITALISATION): the broker-advance asset (code 1130
    // fallback, never flagged receivable/payable) is relieved by
    // a partner-less credit line on the receipt journal and its
    // reversal mirror. It has no partner subledger: the advance
    // bookkeeping is its counterparty. The exemption is scoped
    // to receipt journals and to unflagged 1130 accounts only;
    // a partner-less line on any flagged control account still
    // throws below.
    if (
      (!row.partner_id || row.partner_type === 'none') &&
      (row.source_type === 'import_inventory_receipt' || row.source_type === 'import_inventory_receipt_reversal') &&
      row.code === '1130' && !row.is_receivable && !row.is_payable
    ) {
      continue;
    }
    if (!['customer', 'supplier'].includes(row.partner_type) || !row.partner_id) throw new BadRequestException('حركة الحساب الرقابي تتطلب شريكاً محدداً من نفس المنشأة.');
    const key = `${row.partner_type}:${row.partner_id}`;
    const group = groups.get(key) || { row, amount: 0 };
    group.amount += row.partner_type === 'customer' ? Number(row.debit) - Number(row.credit) : Number(row.credit) - Number(row.debit);
    groups.set(key, group);
  }
  for (const { row, amount: raw } of groups.values()) {
    // The journal lines already use tenant minor units; never discard a KWD/OMR fil
    // before updating the partner running balance and immutable subledger source.
    const amount = fromMinorUnits(toMinorUnits(raw, bookDigits), bookDigits);
    if (!amount) continue;
    const customer = row.partner_type === 'customer';
    const table = customer ? 'customers' : 'suppliers';
    const ledger = customer ? 'customer_ledger' : 'supplier_ledger';
    const partner = await db.updateTable(table).set({ balance: sql`coalesce(balance, 0) + ${amount}`, updated_at: new Date() })
      .where('tenant_id', '=', tenantId).where('id', '=', Number(row.partner_id)).returning('balance').executeTakeFirst();
    if (!partner) throw new BadRequestException('شريك القيد لا يتبع المنشأة.');
    const fields = customer ? { customer_id: Number(row.partner_id) } : { supplier_id: Number(row.partner_id) };
    await (db as any).insertInto(ledger).values({ ...fields, tenant_id: tenantId, account_id: row.account_id || tenantId,
      entry_type: 'journal_document', amount, balance_after: Number(partner.balance), note: row.description,
      reference_type: 'journal_entry', reference_id: entryId, created_by: row.created_by,
      created_at: row.entry_date, branch_id: row.branch_id, location_id: row.location_id,
    }).execute();
  }
}

/** A shipping line/subcontractor id is never a suppliers.id. Keep the identity mapping explicit. */
export async function ensureDomainSupplier(db: Kysely<Database>, tenantId: string, domain: 'shipping_line' | 'subcontractor', domainId: string | number, name: string): Promise<number> {
  await lockAccountingPeriod(db, tenantId);
  const table = domain === 'shipping_line' ? 'shipping_lines' : 'contracting_subcontractors';
  const source = await (db as any).selectFrom(table).select('id').where('tenant_id', '=', tenantId).where('id', '=', domainId).executeTakeFirst();
  if (!source) throw new BadRequestException('هوية المورد النطاقية لا تتبع المنشأة.');
  const linked = await sql<{ supplier_id: number }>`select supplier_id from accounting_supplier_links
    where tenant_id = ${tenantId} and domain = ${domain} and domain_id = ${String(domainId)} for update`.execute(db);
  if (linked.rows[0]) return Number(linked.rows[0].supplier_id);
  const supplier = await db.insertInto('suppliers').values({ tenant_id: tenantId, account_id: tenantId,
    name, phone: '', address: '', balance: 0, notes: `${domain}:${domainId}`, is_active: true,
  } as any).returning('id').executeTakeFirstOrThrow();
  await sql`insert into accounting_supplier_links (tenant_id, domain, domain_id, supplier_id)
    values (${tenantId}, ${domain}, ${String(domainId)}, ${supplier.id})`.execute(db);
  return Number(supplier.id);
}
