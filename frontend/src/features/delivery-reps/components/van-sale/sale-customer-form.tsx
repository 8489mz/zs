import { useTranslation } from 'react-i18next';
import type { CustomerOption } from './van-sale-types';
import { CustomSelect } from '@/shared/ui/custom-select';

export interface SaleCustomerFormProps {
  customers: CustomerOption[];
  newCustomerName: string;
  onNewCustomerNameChange: (val: string) => void;
  onSelectCustomer: (val: number | '') => void;
}

export function SaleCustomerForm({
  customers,
  newCustomerName,
  onNewCustomerNameChange,
  onSelectCustomer,
}: SaleCustomerFormProps) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <div>
        <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
          {t('delivery_reps.van_sale_tab.s19', "اختيار المحل / العميل:")}
        </label>
        <CustomSelect
          value=""
          onChange={(val) => onSelectCustomer(val ? Number(val) : '')}
          options={[
            { value: '', label: t('delivery_reps.van_sale_tab.s20', "-- عميل نقدي عام (أو اختر من خط السير) --") },
            ...customers.map((c) => ({
              value: String(c.id),
              label: `${c.customerCode ? `[${c.customerCode.replace(/^#/, '')}] ` : ''}${c.name}${c.route ? ` (${c.route})` : ''}`,
              hint: `مديونية: ${c.balance.toFixed(2)}${c.creditLimit ? ` | سقف: ${c.creditLimit.toFixed(2)}` : ''}`,
            })),
          ]}
          placeholder={t('delivery_reps.van_sale_tab.s21', "اختر المحل / العميل من القائمة")}
        />
      </div>
      <div>
        <input
          type="text"
          value={newCustomerName}
          onChange={(e) => onNewCustomerNameChange(e.target.value)}
          placeholder={t('delivery_reps.van_sale_tab.s22', "أو اكتب اسم محل جديد (عميل فوري نقدي)...")}
          style={{
            width: '100%',
            height: '34px',
            backgroundColor: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            padding: '0 10px',
            fontSize: '11.5px',
            boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  );
}
