export function formatLedgerEntryType(rawType?: string | null, note?: string | null): string {
  const type = String(rawType || '').trim().toLowerCase();
  const lowerNote = String(note || '').toLowerCase();

  if (type === 'sale_credit' || type === 'sale') return 'فاتورة بيع آجل';
  if (type === 'sale_paid') return 'فاتورة بيع مدفوعة';
  if (type === 'sale_cancel_restore') return 'إلغاء فاتورة بيع';
  if (type === 'purchase_credit' || type === 'purchase' || type === 'purchase_invoice' || type === 'bill') return 'فاتورة شراء آجل';
  if (type === 'purchase_cancel_restore') return 'إلغاء فاتورة شراء';
  if (type === 'customer_payment' || type === 'collection' || type === 'customer_collection') return 'سداد عميل';
  if (type === 'supplier_payment' || type === 'payment' || type === 'supplier_disbursement') return 'سداد للمورد';
  if (type === 'sale_return' || type === 'customer_return') return 'مرتجع مبيعات';
  if (type === 'sale_return_refund') return 'استرداد مرتجع مبيعات';
  if (type === 'purchase_return' || type === 'supplier_return') return 'مرتجع مشتريات';
  if (type === 'return_document') {
    if (lowerNote.includes('مورد') || lowerNote.includes('شراء') || lowerNote.includes('توريد')) return 'مرتجع مشتريات';
    return 'مرتجع مبيعات';
  }
  if (type === 'opening_balance') return 'رصيد افتتاحي';
  if (type === 'manual_adjustment' || type === 'adjustment') return 'تسوية رصيد';
  if (type === 'credit_note') return 'إشعار دائن';
  if (type === 'debit_note') return 'إشعار مدين';
  if (type === 'discount') return 'خصم تسوية';
  if (type === 'refund') return 'استرداد نقدي';
  if (type === 'invoice') return lowerNote.includes('شراء') ? 'فاتورة شراء آجل' : 'فاتورة بيع آجل';
  if (type.includes('loan_repayment')) return 'سداد سلفة';
  if (type.includes('loan_disbursement') || type.includes('loan')) return 'صرف سلفة';
  if (type === 'journal_entry') return 'قيد يومية';

  return 'قيد حساب';
}
