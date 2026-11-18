// Recent orders log — the customer's order history with a per-order repeat
// action and a start-first-order button for customers with no orders yet.
// Pure move; the dialog keeps all state and mounts this component with
// the recent orders and its callbacks.

import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDate } from '@/lib/format';
import type { PosCustomerDeliveryProfileOrder } from '@/features/pos/api/pos.api';
import { ClockIcon, PlusIcon, ReceiptIcon, RotateCcwIcon } from '@/shared/components/icons/AppIcons';

export function PosPhoneOrderDialogOrdersLog({
  recentOrders,
  handleStartNewOrder,
  handleReorder,
}: {
  recentOrders: PosCustomerDeliveryProfileOrder[];
  handleStartNewOrder: () => void;
  handleReorder: (order: PosCustomerDeliveryProfileOrder) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <ReceiptIcon size={13} color="#170e5e" />
          <span>{t('pos.pos_workspace.pos_phone_order_dialog.s88', "سجل طلبات العميل السابقة")}</span>
        </div>
        <span style={{ fontSize: '0.6875rem', color: '#64748b' }}>
          {recentOrders.length} {t('pos.pos_workspace.pos_phone_order_dialog.s89', "طلبات مسجلة")}
        </span>
      </div>

      {recentOrders.length === 0 ? (
        <div
          style={{
            background: '#f8fafc',
            padding: '24px 12px',
            borderRadius: '8px',
            border: '1px dashed #cbd5e1',
            textAlign: 'center',
          }}
        >
          <ClockIcon size={24} color="#94a3b8" style={{ marginBottom: '4px' }} />
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s90', "لا توجد طلبات سابقة مسجلة لهذا العميل")}
          </div>
          <p style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px', marginBottom: '8px' }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s91', "يمكنك بدء أول طلب له وسيقوم النظام بحفظ عنوانه وتفضيلاته تلقائياً.")}
          </p>
          <Button
            style={{ background: '#170e5e', color: '#ffffff', fontWeight: 700, fontSize: '0.72rem', padding: '3px 8px' }}
            onClick={handleStartNewOrder}
          >
            <PlusIcon size={12} style={{ marginLeft: '4px' }} />
            {t('pos.pos_workspace.pos_phone_order_dialog.s92', "بدء أول طلب للعميل")}
          </Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '255px', overflowY: 'auto', paddingLeft: '2px' }}>
          {recentOrders.map((order) => (
            <div
              key={order.id}
              style={{
                background: '#ffffff',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                padding: '6px 8px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#170e5e' }}>
                    {order.docNo}
                  </span>
                  <span style={{ fontSize: '0.65rem', color: '#64748b' }}>
                    {order.createdAt ? formatDate(order.createdAt) : ''}
                  </span>
                </div>
                <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0f172a' }}>
                  {formatCurrency(order.total)}
                </span>
              </div>

              {/* Items breakdown list */}
              <div style={{ background: '#f8fafc', padding: '4px 6px', borderRadius: '4px', fontSize: '0.7rem', color: '#334155' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {order.items.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>
                        <strong>{item.qty}x</strong> {item.name}
                        {item.modifiers && item.modifiers.length > 0 && (
                          <span style={{ color: '#64748b', fontSize: '0.65rem', marginRight: '4px' }}>
                            ({item.modifiers.map((m: any) => m.name || m).join(' + ')})
                          </span>
                        )}
                      </span>
                      <span style={{ color: '#64748b', fontWeight: 600 }}>{formatCurrency(item.lineTotal)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Order Footer & Repeat Button */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '2px' }}>
                <div style={{ fontSize: '0.65rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
                  {order.customerAddress ? `العنوان: ${order.customerAddress}` : t('pos.pos_workspace.pos_phone_order_dialog.s93', "بدون عنوان محدد")}
                </div>
                <Button
                  size="sm"
                  style={{
                    background: '#170e5e',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                  }}
                  onClick={() => handleReorder(order)}
                >
                  <RotateCcwIcon size={11} style={{ marginLeft: '3px' }} />
                  {t('pos.pos_workspace.pos_phone_order_dialog.s94', "تكرار هذا الطلب")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
