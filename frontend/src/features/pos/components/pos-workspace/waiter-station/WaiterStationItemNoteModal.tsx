// Item-note modal for the waiter station active order view.
// Pure move; the page keeps all state and mounts this component.

import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { WaiterCartItem } from '@/features/pos/hooks/useWaiterStation';

export interface WaiterStationItemNoteModalProps {
  activeItemNoteModal: WaiterCartItem | null;
  itemNoteText: string;
  setItemNoteText: Dispatch<SetStateAction<string>>;
  setActiveItemNoteModal: Dispatch<SetStateAction<WaiterCartItem | null>>;
  handleSaveItemNote: () => void;
}

export function WaiterStationItemNoteModal({
  activeItemNoteModal,
  itemNoteText,
  setItemNoteText,
  setActiveItemNoteModal,
  handleSaveItemNote,
}: WaiterStationItemNoteModalProps) {
  const { t } = useTranslation();
  return (
    <>
      {activeItemNoteModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div style={{ background: '#ffffff', borderRadius: '12px', padding: '18px', width: '360px', maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
              {t('pos.waiter_station_page.s42', "ملاحظات تحضير الطبق:")} {activeItemNoteModal.name}
            </h3>
            <textarea
              rows={3}
              placeholder={t('pos.waiter_station_page.s43', "مثال: بدون بصل / صوص جانبي / مستوي جيداً / يقدم مع المقبلات")}
              value={itemNoteText}
              onChange={(e) => setItemNoteText(e.target.value)}
              style={{ width: '100%', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '8px', fontSize: '13px', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => setActiveItemNoteModal(null)}
                style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
              >
                {t('pos.waiter_station_page.s44', "إلغاء")}
              </button>
              <button
                type="button"
                onClick={handleSaveItemNote}
                style={{ background: '#170e5e', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '6px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
              >
                {t('pos.waiter_station_page.s45', "تأكيد الملاحظة")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
