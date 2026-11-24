import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { LockIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';

export interface CreateSalesOrderPageWarehouseProps {
  t: ReturnType<typeof useTranslation>['t'];
  reservationExpiresAt: string;
  setReservationExpiresAt: Dispatch<SetStateAction<string>>;
  customerAddress: string;
  setCustomerAddress: Dispatch<SetStateAction<string>>;
  selectedWarehouseId: number | null;
  selectWarehouse: (id: number | null) => void;
  warehouseOptions: { value: string; label: any; }[];
  autoReserve: boolean;
  setAutoReserve: Dispatch<SetStateAction<boolean>>;
}
export function CreateSalesOrderPageWarehouse({ t, reservationExpiresAt, setReservationExpiresAt, customerAddress, setCustomerAddress, selectedWarehouseId, selectWarehouse, warehouseOptions, autoReserve, setAutoReserve }: CreateSalesOrderPageWarehouseProps) {
  return (
    <>
    {/* Section 2: Stock Reservation & Delivery Settings */}
    <section className="document-prototype-section" style={{ marginTop: '12px' }}>
      <h3 className="document-prototype-section-title">{t('sales.create_sales_order_page.s28', "حجز المخزون وموقع التسليم")}</h3>
      <div className="purchase-prototype-form-grid" style={{ marginBottom: '14px' }}>
        <Field label={t('sales.create_sales_order_page.s29', "صلاحية حجز المخزون حتى")}>
          <input
            className="purchase-prototype-field-input"
            type="date"
            value={reservationExpiresAt}
            onChange={(e) => setReservationExpiresAt(e.target.value)}
          />
        </Field>

        <Field label={t('sales.create_sales_order_page.s30', "عنوان العميل / موقع التسليم")}>
          <input
            className="purchase-prototype-field-input"
            type="text"
            placeholder={t('sales.create_sales_order_page.s31', "العنوان التفصيلي للتسليم أو الاستلام...")}
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
          />
        </Field>

        {/* INV-SALES-ORDER-WAREHOUSE-SELECTION: the warehouse the
        order reserves from. Defaults to the branch's default
        selling warehouse; the line availability and the approval
        check both read this warehouse. */}
        <Field label={t('sales.create_sales_order_page.s79', "مخزن الحجز")}>
          <CustomSelect
            value={selectedWarehouseId != null ? String(selectedWarehouseId) : ''}
            onChange={(val) => selectWarehouse(val ? Number(val) : null)}
            options={warehouseOptions}
            placeholder={t('sales.create_sales_order_page.s80', "اختر المخزن...")}
          />
        </Field>
      </div>

      {/* Auto Reservation Banner */}
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: autoReserve ? '#eff6ff' : '#f8fafc',
          borderRadius: '8px',
          border: `1px solid ${autoReserve ? '#bfdbfe' : '#e2e8f0'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'all 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <LockIcon size={18} color={autoReserve ? '#1d4ed8' : '#64748b'} />
          <div>
            <span style={{ fontSize: '13px', fontWeight: 700, color: autoReserve ? '#1e3a8a' : '#334155', display: 'block' }}>
              {t('sales.create_sales_order_page.s32', "تفعيل حجز المخزون التلقائي فور الحفظ (Stock Reservation)")}
            </span>
            <span style={{ fontSize: '11.5px', color: autoReserve ? '#2563eb' : '#64748b' }}>
              {t('sales.create_sales_order_page.s33', "يتم زيادة الكمية المحجوزة للمنتجات ومنع بيعها في الكاشير أو المتجر الإلكتروني حتى إتمام الفاتورة.")}
            </span>
          </div>
        </div>
        <input
          type="checkbox"
          checked={autoReserve}
          onChange={(e) => setAutoReserve(e.target.checked)}
          style={{ width: '18px', height: '18px', cursor: 'pointer' }}
        />
      </div>
    </section>
    </>
  );
}
