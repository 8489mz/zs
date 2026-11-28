// EDC / Sunmi terminal banner — the direct-dispatch card shown when a
// card leg or card preset is active and a terminal exists. Pure move;
// the dialog keeps all state and mounts this component with the
// terminal session and its callbacks.

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { PosTerminalDeviceConfig } from '@/types/domain-models/settings';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { CreditCardIcon, CheckIcon } from '@/shared/components/icons/AppIcons';
import { isFastOfflineMode } from '@/lib/network-circuit-breaker';

export function PosCheckoutTerminalBanner({
  isCardLegOrPresetActive,
  pos,
  activeTerminals,
  selectedTerminalId,
  setSelectedTerminalId,
  terminalSession,
  handleDispatchTerminal,
  onConfirmSale,
  handleCancelTerminal,
}: {
  isCardLegOrPresetActive: boolean;
  pos: PosWorkspaceState;
  activeTerminals: PosTerminalDeviceConfig[];
  selectedTerminalId: string;
  setSelectedTerminalId: Dispatch<SetStateAction<string>>;
  terminalSession: {
    status: 'idle' | 'initiating' | 'waiting' | 'approved' | 'declined' | 'cancelled' | 'recovery_required';
    transactionId?: string;
    message?: string;
    approvalCode?: string;
  };
  handleDispatchTerminal: () => Promise<void>;
  onConfirmSale: (() => void) | undefined;
  handleCancelTerminal: () => Promise<void>;
}) {
  const [manualRefDraft, setManualRefDraft] = useState('');
  const isOfflineNow = isFastOfflineMode();

  return (
    <>
      {/* Offline 4G Standalone Card Terminal Fallback Notice */}
      {(isCardLegOrPresetActive || pos.cardAmount > 0) && isOfflineNow && (
        <div style={{
          padding: '8px 12px',
          background: '#fffbeb',
          borderRadius: '6px',
          border: '1px solid #fde68a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 240px' }}>
            <CreditCardIcon size={16} color="#b45309" />
            <div style={{ fontSize: '11.5px', color: '#92400e', fontWeight: 600 }}>
              وضع الأوفلاين: يمكنك السحب عبر شريحة الماكينة المستقلة (4G) وتأكيد الفاتورة مباشرة
            </div>
          </div>
          <input
            type="text"
            value={manualRefDraft}
            onChange={(e) => {
              const ref = e.target.value;
              setManualRefDraft(ref);
              const trimmed = ref.trim();
              pos.setTerminalPaymentDetails?.(
                trimmed
                  ? {
                      ...(pos.terminalPaymentDetails || {}),
                      rrn: trimmed,
                      cardScheme: pos.terminalPaymentDetails?.cardScheme || 'card',
                    }
                  : null,
              );
            }}
            placeholder="رقم إيصال الماكينة (اختياري)"
            style={{
              height: '30px',
              width: '175px',
              padding: '0 8px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid #fcd34d',
              background: '#ffffff',
              color: '#0f172a',
            }}
          />
        </div>
      )}

      {/* EDC / Sunmi POS Terminal Direct Dispatch Banner (Active for Card payments when terminal exists) */}
      {(isCardLegOrPresetActive || pos.cardAmount > 0) && (pos.settingsQuery?.data?.posTerminalEnabled === true) && activeTerminals.length > 0 && (
        <div style={{
          padding: '8px 12px',
          background: '#f8fafc',
          borderRadius: '6px',
          border: '1px dashed #cbd5e1',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          {/* Active Terminal Selector if multiple terminals exist */}
          {activeTerminals.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>ماكينة الدفع:</span>
              {activeTerminals.map((term) => {
                const isSelected = (selectedTerminalId || activeTerminals[0].id) === term.id;
                return (
                  <button
                    key={term.id}
                    type="button"
                    onClick={() => setSelectedTerminalId(term.id)}
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      border: isSelected ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      background: isSelected ? '#ede9fe' : '#ffffff',
                      color: isSelected ? '#170e5e' : '#475569',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {term.name || term.provider}
                    {term.isDefault && <span style={{ fontSize: '9px', opacity: 0.8 }}>(افتراضية)</span>}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CreditCardIcon size={18} color="#170e5e" />
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                  {activeTerminals.find((t) => t.id === selectedTerminalId)?.name || pos.settingsQuery?.data?.posTerminalName || 'ماكينة الدفع (Sunmi / EDC)'}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  إرسال {formatCurrency(pos.cardAmount > 0 ? pos.cardAmount : pos.totals.total)} إلى شاشة جهاز الدفع آلياً
                </div>
              </div>
            </div>
            {terminalSession.status === 'idle' || terminalSession.status === 'declined' || terminalSession.status === 'cancelled' ? (
              <Button
                type="button"
                variant="primary"
                onClick={handleDispatchTerminal}
                style={{ minHeight: '32px', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' }}
              >
                إرسال للماكينة
              </Button>
            ) : terminalSession.status === 'approved' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <CheckIcon size={14} color="#16a34a" />
                  <span>معتمد ({terminalSession.approvalCode})</span>
                </span>
                {pos.terminalPaymentDetails?.cardScheme ? (
                  <span style={{ background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
                    {pos.terminalPaymentDetails.cardScheme === 'knet' ? 'KNET كي نت' : pos.terminalPaymentDetails.cardScheme === 'mada' ? 'مدى mada' : pos.terminalPaymentDetails.cardScheme}
                  </span>
                ) : null}
                {onConfirmSale ? (
                  <Button
                    type="button"
                    variant="success"
                    onClick={() => onConfirmSale()}
                    style={{ minHeight: '30px', padding: '0 10px', fontSize: '11.5px', fontWeight: 800 }}
                  >
                    تأكيد الفاتورة (F2)
                  </Button>
                ) : null}
              </div>
            ) : terminalSession.status === 'recovery_required' ? (
              <span role="alert" style={{ color: '#b91c1c', fontSize: '12px', fontWeight: 700 }}>
                {terminalSession.message}
              </span>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={handleCancelTerminal}
                style={{ minHeight: '30px', fontSize: '11px', color: '#dc2626' }}
              >
                إلغاء
              </Button>
            )}
          </div>

          {(terminalSession.status === 'initiating' || terminalSession.status === 'waiting') && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 10px',
              background: '#eff6ff',
              borderRadius: '4px',
              border: '1px solid #bfdbfe',
              fontSize: '12px',
              color: '#1d4ed8'
            }}>
              <span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></span>
              <span>{terminalSession.message}</span>
            </div>
          )}

          {terminalSession.status === 'declined' && (
            <div style={{ padding: '6px 10px', background: '#fef2f2', borderRadius: '4px', border: '1px solid #fecaca', fontSize: '12px', color: '#b91c1c' }}>
              {terminalSession.message}
            </div>
          )}
        </div>
      )}
    </>
  );
}
