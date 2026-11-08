import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { todayTenantDate } from '../../../common/utils/tenant-timezone.util';

export type ReturnListRow = {
  id: string;
  rowId: string;
  docNo: string;
  returnType: 'sale' | 'purchase';
  type: 'sale' | 'purchase';
  invoiceId: string;
  invoiceDocNo?: string;
  partyName?: string;
  orderType?: string;
  productId: string;
  productName: string;
  qty: number;
  total: number;
  note: string;
  settlementMode: string;
  refundMethod: string;
  createdAt: unknown;
  date: unknown;
  createdBy?: string;
  createdByName?: string;
  items?: Array<{ productId: string; productName: string; qty: number; total: number; }>;
};

function returnDateKey(value: unknown, timeZone?: string): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return '';
    return timeZone ? todayTenantDate(timeZone, value) : value.toISOString().slice(0, 10);
  }
  return String(value || '').slice(0, 10);
}

export function mapReturnRows(rows: Array<Record<string, unknown>>): ReturnListRow[] {
  const docMap = new Map<string, ReturnListRow>();
  
  for (const row of rows) {
    const docId = String(row.return_document_id);
    if (!docMap.has(docId)) {
      docMap.set(docId, {
        id: docId,
        rowId: docId,
        docNo: String(row.doc_no || 'ZR-' + docId),
        returnType: (row.return_type === 'purchase' ? 'purchase' : 'sale'),
        type: (row.return_type === 'purchase' ? 'purchase' : 'sale'),
        invoiceId: row.invoice_id ? String(row.invoice_id) : '',
        invoiceDocNo: String(row.invoice_doc_no || (row.invoice_id ? (row.return_type === 'purchase' ? 'PO-' + row.invoice_id : 'Z-' + row.invoice_id) : '')),
        partyName: String(row.party_name || (row.return_type === 'sale' ? 'عميل نقدي' : 'مورد')),
        orderType: String(row.order_type || ''),
        productId: '',
        productName: '',
        qty: 0,
        total: 0,
        note: String(row.note || ''),
        settlementMode: String(row.settlement_mode || 'refund'),
        refundMethod: String(row.refund_method || ''),
        createdAt: row.created_at,
        date: row.created_at,
        createdBy: row.created_by ? String(row.created_by) : '',
        createdByName: String(row.created_by_name || ''),
        items: []
      });
    }
    const doc = docMap.get(docId)!;
    const itemQty = Number(row.qty || 0);
    const itemTotal = Number(row.line_total || 0);
    doc.qty += itemQty;
    doc.total += itemTotal;
    doc.items!.push({
      productId: row.product_id ? String(row.product_id) : '',
      productName: String(row.product_name || ''),
      qty: itemQty,
      total: itemTotal,
    });
  }

  const result = Array.from(docMap.values());
  for (const doc of result) {
    if (doc.items!.length === 1) {
      doc.productName = doc.items![0].productName;
      doc.productId = doc.items![0].productId;
    } else {
      doc.productName = `${doc.items!.length} أصناف`;
    }
  }

  return result;
}

export function filterReturnRows(rows: ReturnListRow[], query: Record<string, unknown>, today: string, timeZone?: string): ReturnListRow[] {
  const q = String(query.search || query.q || '').trim().toLowerCase();
  const filter = String(query.filter || query.view || 'all').trim();
  const employee = String(query.employee || query.employeeName || '').trim().toLowerCase();

  return rows.filter((row) => {
    if (filter === 'sales' && row.returnType !== 'sale') return false;
    if (filter === 'purchase' && row.returnType !== 'purchase') return false;
    if (filter === 'today' && returnDateKey(row.createdAt, timeZone) !== today) return false;
    if (employee && !String(row.createdByName || '').toLowerCase().includes(employee)) return false;
    if (!q) return true;
    return [row.docNo, row.productName, row.note, row.returnType, row.createdByName].some((value) => String(value || '').toLowerCase().includes(q));
  });
}

export function summarizeReturnRows(rows: ReturnListRow[], today: string, moneyDigits: MoneyDigits = 2, timeZone?: string) {
  return {
    totalItems: new Set(rows.map((row) => row.id)).size,
    totalAmount: roundMoney(rows.reduce((sum, row) => sum + Number(row.total || 0), 0), moneyDigits),
    salesReturns: new Set(rows.filter((row) => row.returnType === 'sale').map((row) => row.id)).size,
    purchaseReturns: new Set(rows.filter((row) => row.returnType === 'purchase').map((row) => row.id)).size,
    todayCount: new Set(rows.filter((row) => returnDateKey(row.createdAt, timeZone) === today).map((row) => row.id)).size,
    latestDocNo: rows[0]?.docNo || '',
  };
}
