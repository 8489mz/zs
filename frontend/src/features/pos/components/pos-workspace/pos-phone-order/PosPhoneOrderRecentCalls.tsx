// Recent incoming calls log — the caller-ID tab: header actions (clear the
// log, simulate a ring) and the call list with a per-row open-customer
// action. Pure move; the dialog keeps all state and mounts this component
// with the list and its callbacks.

import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import { formatDate } from '@/lib/format';
import { callerIdService, type CallerIdCallEvent } from '@/features/pos/lib/pos-caller-id-service';
import { PhoneCallIcon, PhoneIncomingIcon, SearchIcon, TrashIcon } from '@/shared/components/icons/AppIcons';

export function PosPhoneOrderRecentCalls({
  recentCallsList,
  setRecentCallsList,
  handleSimulateCall,
  handlePickRecentCall,
}: {
  recentCallsList: CallerIdCallEvent[];
  setRecentCallsList: Dispatch<SetStateAction<CallerIdCallEvent[]>>;
  handleSimulateCall: () => void;
  handlePickRecentCall: (phone: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', margin: '0 0 4px 0' }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s18', "سجل المكالمات الواردة الأخيرة (Caller ID Log)")}
          </h3>
          <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s19', "يمكنك الضغط على أي مكالمة فائتة أو واردة لفتح ملف العميل وبدء الطلب فوراً.")}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              callerIdService.clearRecentCalls();
              setRecentCallsList([]);
              toast.info(t('pos.pos_workspace.pos_phone_order_dialog.s20', "تم مسح سجل المكالمات"));
            }}
            disabled={recentCallsList.length === 0}
          >
            <TrashIcon size={14} style={{ marginLeft: '4px' }} />
            {t('pos.pos_workspace.pos_phone_order_dialog.s21', "مسح السجل")}
          </Button>
          <Button
            size="sm"
            style={{ background: '#170e5e', color: '#ffffff', fontWeight: 700 }}
            onClick={handleSimulateCall}
          >
            <PhoneIncomingIcon size={14} style={{ marginLeft: '4px' }} />
            {t('pos.pos_workspace.pos_phone_order_dialog.s22', "محاكاة رنين وارد")}
          </Button>
        </div>
      </div>

      {recentCallsList.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 24px',
            textAlign: 'center',
            background: '#f8fafc',
            borderRadius: '12px',
            border: '1px dashed #cbd5e1',
          }}
        >
          <PhoneIncomingIcon size={36} color="#94a3b8" style={{ marginBottom: '10px' }} />
          <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s23', "لا توجد مكالمات مسجلة في الجلسة الحالية")}
          </div>
          <p style={{ fontSize: '0.8rem', color: '#64748b', maxWidth: '380px', margin: 0 }}>
            {t('pos.pos_workspace.pos_phone_order_dialog.s24', "بمجرد توصيل جهاز كاشف الأرقام USB أو استقبال رنين، ستظهر الأرقام هنا تلقائياً.")}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '420px', overflowY: 'auto' }}>
          {recentCallsList.map((call) => (
            <div
              key={call.id}
              style={{
                background: '#ffffff',
                padding: '12px 16px',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: '#eff6ff',
                    color: '#2563eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <PhoneCallIcon size={18} />
                </div>
                <div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>
                    {call.phone}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                    {call.callerName ? `${call.callerName} • ` : ''}
                    {formatDate(call.timestamp)}
                  </div>
                </div>
              </div>

              <Button
                size="sm"
                style={{ background: '#170e5e', color: '#ffffff', fontWeight: 700 }}
                onClick={() => handlePickRecentCall(call.phone)}
              >
                <SearchIcon size={13} style={{ marginLeft: '4px' }} />
                {t('pos.pos_workspace.pos_phone_order_dialog.s25', "فتح ملف العميل وبدء الطلب")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
