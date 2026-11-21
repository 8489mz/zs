import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import { CheckCircleIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';

export interface CollectionReturnResultProps {
  returnResult: { docNo: string; total: number };
  setReturnResult: Dispatch<SetStateAction<{ docNo: string; total: number } | null>>;
}

export function CollectionReturnResult({
  returnResult,
  setReturnResult,
}: CollectionReturnResultProps) {
  const { t } = useTranslation();
  return (
    <div style={{ textAlign: 'center', padding: '24px 16px', backgroundColor: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
      <div style={{ width: '48px', height: '48px', backgroundColor: '#dcfce7', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
        <CheckCircleIcon size={28} color="#16a34a" />
      </div>
      <h4 style={{ fontSize: '16px', fontWeight: 800, color: '#15803d', margin: '0 0 6px' }}>
        {t('delivery_reps.van_collection_tab.s43', "تم إرسال إذن المرتجع للإدارة بنجاح!")}
      </h4>
      <p style={{ fontSize: '13px', fontWeight: 700, color: '#166534', margin: '0 0 12px' }}>
        {t('delivery_reps.van_collection_tab.s44', "رقم الإذن: #")}{returnResult.docNo} {t('delivery_reps.van_collection_tab.s45', "| إجمالي القيمة:")} {returnResult.total.toFixed(2)} <CurrencySymbol />
      </p>
      <div style={{ fontSize: '11.5px', color: '#65a30d', backgroundColor: '#ffffff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d9f99d', maxWidth: '420px', margin: '0 auto 16px', lineHeight: 1.5 }}>
        {t('delivery_reps.van_collection_tab.s46', "ملاحظة رقابية: تم تسجيل إذن المرتجع بحالة (قيد مراجعة الإدارة). لن يتم خصم القيمة من حساب العميل أو زيادة رصيد السيارة إلا بعد اعتماد مشرف المستودع.")}
      </div>
      <Button
        variant="primary"
        onClick={() => setReturnResult(null)}
        style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
      >
        {t('delivery_reps.van_collection_tab.s47', "تسجيل إذن مرتجع جديد")}
      </Button>
    </div>
  );
}
