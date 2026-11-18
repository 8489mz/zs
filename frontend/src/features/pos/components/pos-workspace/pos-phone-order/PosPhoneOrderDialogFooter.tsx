// Footer row of the phone-order dialog — the customer line plus the close,
// WhatsApp send and start-new-order buttons. Pure move; the dialog keeps all
// state and mounts this component with the customer and order state.

import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { openWhatsAppChat, formatRestaurantOrderWhatsAppMessage } from '@/lib/whatsapp';
import { SendIcon, PlusIcon } from '@/shared/components/icons/AppIcons';
import type { PosCustomerDeliveryProfile } from '@/features/pos/api/pos.api';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';

export function PosPhoneOrderDialogFooter({
  currentCustomer,
  isSearchActive,
  phoneQuery,
  onClose,
  activeTab,
  pos,
  currentDeliveryFee,
  currencySym,
  isKwd,
  isKsa,
  handleStartNewOrder,
}: {
  currentCustomer: PosCustomerDeliveryProfile['customer'] | null | undefined;
  isSearchActive: boolean;
  phoneQuery: string;
  onClose: () => void;
  activeTab: 'desk' | 'recent_calls' | 'hardware';
  pos: PosWorkspaceState;
  currentDeliveryFee: number;
  currencySym: string;
  isKwd: boolean;
  isKsa: boolean;
  handleStartNewOrder: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
      <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
        {currentCustomer ? (
          <span>{t('pos.pos_workspace.pos_phone_order_dialog.s5', "العميل المحدد:")} <strong>{currentCustomer.name}</strong> ({currentCustomer.phone || t('pos.pos_workspace.pos_phone_order_dialog.s6', "بدون هاتف")})</span>
        ) : isSearchActive ? (
          <span>{t('pos.pos_workspace.pos_phone_order_dialog.s7', "نتائج البحث للرقم:")} <strong>{phoneQuery}</strong></span>
        ) : (
          <span>{t('pos.pos_workspace.pos_phone_order_dialog.s8', "أدخل 6 أرقام على الأقل للبحث السريع")}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <Button variant="secondary" size="sm" onClick={onClose} style={{ fontSize: '0.78rem' }}>
          {t('pos.pos_workspace.pos_phone_order_dialog.s9', "إلغاء وإغلاق")}
        </Button>
        {currentCustomer && activeTab === 'desk' && (
          <>
            {currentCustomer.phone ? (
              <Button
                size="sm"
                variant="secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  color: '#166534',
                }}
                onClick={() => {
                  const msg = formatRestaurantOrderWhatsAppMessage({
                    customerName: currentCustomer.name,
                    total: Number(pos.totals?.total || 0),
                    deliveryFee: currentDeliveryFee,
                    items: pos.cart.map((c) => ({ name: c.name, qty: c.qty, price: c.price })),
                    storeName: pos.settingsQuery?.data?.storeName || pos.settingsQuery?.data?.brandName || t('pos.pos_workspace.pos_phone_order_dialog.s10', "المتجر"),
                    currency: currencySym,
                  });
                  openWhatsAppChat(currentCustomer.phone, msg);
                }}
                title={isKwd ? t('pos.pos_workspace.pos_phone_order_dialog.s11', "إرسال تفاصيل الطلب وخيارات السداد K-NET عبر الواتساب") : isKsa ? t('pos.pos_workspace.pos_phone_order_dialog.s12', "إرسال تفاصيل الطلب وخيارات السداد الإلكتروني عبر الواتساب") : t('pos.pos_workspace.pos_phone_order_dialog.s13', "إرسال تفاصيل الطلب للعميل عبر الواتساب")}
              >
                <SendIcon size={13} color="#166534" />
                <span>{isKwd ? t('pos.pos_workspace.pos_phone_order_dialog.s14', "واتساب وسداد K-NET") : isKsa ? t('pos.pos_workspace.pos_phone_order_dialog.s15', "واتساب وسداد إلكتروني") : t('pos.pos_workspace.pos_phone_order_dialog.s16', "إرسال واتساب")}</span>
              </Button>
            ) : null}
            <Button
              size="sm"
              style={{ background: '#170e5e', color: '#ffffff', fontWeight: 700, fontSize: '0.78rem' }}
              onClick={handleStartNewOrder}
            >
              <PlusIcon size={14} style={{ marginLeft: '4px' }} />
              {t('pos.pos_workspace.pos_phone_order_dialog.s17', "بدء طلب جديد للعميل")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
