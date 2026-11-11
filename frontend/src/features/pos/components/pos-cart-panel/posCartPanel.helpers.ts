import type { PosItem } from '@/features/pos/types/pos.types';
import type { PosCartPanelProps } from './posCartPanel.types';

export function getLowStockLines(cart: PosItem[]) {
  return cart.filter((item) => (Number(item.currentStock || 0) - (Number(item.qty || 0) * Number(item.unitMultiplier || 1))) <= Number(item.minStock || 0));
}

export function getAlertMessages(props: PosCartPanelProps) {
  const lowStockLines = props.allowNegativeStockSales ? [] : getLowStockLines(props.cart);
  const hasZeroPriceLine = props.cart.some((item) => Number(item.price || 0) <= 0);
  const belowCostLines = props.cart.filter((item) => Number(item.price || 0) < Number(item.costPrice || 0));
  
  return [
    props.paymentType !== 'credit' && !props.hasOpenShift ? 'افتح وردية كاشير أولًا قبل تسجيل فاتورة نقدية أو بطاقة.' : '',
    props.paymentType === 'credit' && !props.customerId ? 'البيع الآجل يحتاج اختيار عميل حتى يتم حفظ المديونية بشكل صحيح.' : '',
    hasZeroPriceLine ? 'يوجد صنف بسعر صفر داخل السلة. راجع التسعير قبل إتمام البيع.' : '',
    props.hasDiscountPermissionViolation ? 'يوجد خصم غير مسموح به لهذا المستخدم.' : '',
    props.adminDiscountWarning || '',
    props.hasPricePermissionViolation ? 'يوجد تعديل سعر غير مسموح به لهذا المستخدم.' : '',
    belowCostLines.length ? `تحذير: يوجد أصناف يتم بيعها بأقل من سعر التكلفة (${belowCostLines.map((item) => item.name).join('، ')})` : '',
    lowStockLines.length ? `هذه الفاتورة ستجعل بعض الأصناف عند الحد الأدنى أو أقل: ${lowStockLines.map((item) => item.name).join('، ')}` : '',
  ].filter(Boolean);
}
