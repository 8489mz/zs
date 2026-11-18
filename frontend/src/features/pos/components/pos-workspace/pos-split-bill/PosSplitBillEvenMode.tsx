// MODE 2 split evenly — guest-count controls (2–6), the guest shares list
// (per-guest pay actions, collected-not-paid state, paid badge) and the
// progress summary (collected sum vs total, retry-post button, close).
// Pure move; the modal keeps all state and mounts this component with the
// guest list and callbacks. The slice calls useTranslation itself.

import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { CheckIcon, UsersIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import type { EvenSplitGuest } from '../pos-split-bill.helpers';

interface PosSplitBillEvenModeProps {
  guestCount: number;
  handleGuestCountChange: (count: number) => void;
  evenGuests: EvenSplitGuest[];
  isProcessingPayment: boolean;
  handlePayGuest: (guestId: number, method: 'cash' | 'card' | 'transfer') => Promise<void>;
  totalAmount: number;
  finalizeEvenSplit: (guests: EvenSplitGuest[]) => Promise<boolean>;
  onClose: () => void;
}

export function PosSplitBillEvenMode({
  guestCount,
  handleGuestCountChange,
  evenGuests,
  isProcessingPayment,
  handlePayGuest,
  totalAmount,
  finalizeEvenSplit,
  onClose,
}: PosSplitBillEvenModeProps) {
  const { t } = useTranslation();
  return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Guest Count Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <UsersIcon size={18} color="#170e5e" />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                    {t('pos.pos_workspace.pos_split_bill_modal.s37', "عدد الضيوف للتقسيم:")}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[2, 3, 4, 5, 6].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleGuestCountChange(num)}
                      style={{
                        padding: '5px 14px',
                        borderRadius: '6px',
                        border: guestCount === num ? '2px solid #170e5e' : '1px solid #cbd5e1',
                        background: guestCount === num ? '#170e5e' : '#ffffff',
                        color: guestCount === num ? '#ffffff' : '#334155',
                        fontWeight: 800,
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      {num} {t('pos.pos_workspace.pos_split_bill_modal.s38', "ضيوف")}
                    </button>
                  ))}
                </div>
                <div style={{ marginInlineStart: 'auto', fontSize: '13px', color: '#64748b' }}>
                  {t('pos.pos_workspace.pos_split_bill_modal.s39', "نصيب كل ضيف:")} <strong style={{ color: '#0f172a', fontSize: '14px' }}>{formatCurrency(evenGuests[0]?.amount || 0)}</strong>
                </div>
              </div>

              {/* Guest Shares List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
                {evenGuests.map((guest) => (
                  <div
                    key={guest.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      border: guest.paid ? '1.5px solid #bbf7d0' : '1px solid #e2e8f0',
                      background: guest.paid ? '#f0fdf4' : '#ffffff',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: guest.paid ? '#16a34a' : '#170e5e',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px',
                          fontWeight: 800,
                        }}
                      >
                        {guest.id}
                      </span>
                      <div>
                        <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>{guest.name}</strong>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          {t('pos.pos_workspace.pos_split_bill_modal.s40', "المبلغ المطلوب:")} <strong style={{ color: '#170e5e' }}>{formatCurrency(guest.amount)}</strong>
                        </div>
                      </div>
                    </div>

                    <div>
                      {guest.paid ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#166534', fontWeight: 800, fontSize: '12.5px' }}>
                          <CheckIcon size={16} />
                          <span>{t('pos.pos_workspace.pos_split_bill_modal.s41', "تم السداد (")}{guest.method === 'card' ? t('pos.pos_workspace.pos_split_bill_modal.s42', "شبكة") : guest.method === 'transfer' ? t('pos.pos_workspace.pos_split_bill_modal.s43', "تحويل") : t('pos.pos_workspace.pos_split_bill_modal.s44', "نقد")})</span>
                        </div>
                      ) : guest.collected ? (
                        // INV-REST-SPLIT-REAL-TOTALS (I33): the money was
                        // taken but no sale posted yet — collected, not paid.
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#92400e', fontWeight: 800, fontSize: '12.5px' }}>
                          <span>{t('pos.pos_workspace.pos_split_bill_modal.s51', "تم التحصيل — بانتظار ترحيل البيع (")}{guest.method === 'card' ? t('pos.pos_workspace.pos_split_bill_modal.s42', "شبكة") : guest.method === 'transfer' ? t('pos.pos_workspace.pos_split_bill_modal.s43', "تحويل") : t('pos.pos_workspace.pos_split_bill_modal.s44', "نقد")})</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <Button
                            type="button"
                            variant="primary"
                            disabled={isProcessingPayment}
                            onClick={() => void handlePayGuest(guest.id, 'cash')}
                            style={{ minHeight: '32px', fontSize: '12px', padding: '0 14px' }}
                          >
                            {t('pos.pos_workspace.pos_split_bill_modal.s45', "سداد نقد")}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={isProcessingPayment}
                            onClick={() => void handlePayGuest(guest.id, 'card')}
                            style={{ minHeight: '32px', fontSize: '12px', padding: '0 14px', borderColor: '#170e5e', color: '#170e5e' }}
                          >
                            {t('pos.pos_workspace.pos_split_bill_modal.s46', "سداد شبكة")}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={isProcessingPayment}
                            onClick={() => void handlePayGuest(guest.id, 'transfer')}
                            style={{ minHeight: '32px', fontSize: '12px', padding: '0 14px', borderColor: '#0369a1', color: '#0369a1' }}
                          >
                            {t('pos.pos_workspace.pos_split_bill_modal.s54', "سداد تحويل")}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Progress Summary */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '10px', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ fontSize: '12.5px', color: '#475569' }}>
                  {t('pos.pos_workspace.pos_split_bill_modal.s47', "تم تحصيل:")} <strong style={{ color: '#16a34a' }}>
                    {formatCurrency(evenGuests.filter((g) => g.collected).reduce((s, g) => s + g.amount, 0))}
                  </strong> {t('pos.pos_workspace.pos_split_bill_modal.s48', "من أصل")} <strong style={{ color: '#0f172a' }}>{formatCurrency(totalAmount)}</strong>
                </div>

                {/* INV-REST-SPLIT-REAL-TOTALS (I33): every share collected
                    but the final sale failed to post — retry the posting
                    without re-collecting money that was already taken. */}
                {evenGuests.length > 0 && evenGuests.every((g) => g.collected) && !evenGuests.every((g) => g.paid) && (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={isProcessingPayment}
                    onClick={() => void finalizeEvenSplit(evenGuests)}
                    style={{ minHeight: '32px', fontSize: '12px', padding: '0 14px' }}
                  >
                    {t('pos.pos_workspace.pos_split_bill_modal.s52', "إعادة محاولة ترحيل البيع")}
                  </Button>
                )}

                <Button type="button" variant="secondary" onClick={onClose} disabled={isProcessingPayment}>
                  {t('pos.pos_workspace.pos_split_bill_modal.s49', "إغلاق")}
                </Button>
              </div>
            </div>
  );
}
