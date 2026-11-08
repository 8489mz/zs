import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SmartphoneIcon } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { productSerialsApi } from '@/features/products/api/product-serials.api';
import { getSerialEntryState, getSerialLookupError } from '@/features/pos/lib/pos.domain';
import type { PosItem } from '@/features/pos/types/pos.types';

interface PosLineSerialEntryProps {
  item: PosItem;
  onAddSerial: (lineKey: string, serial: string) => void;
  onRemoveSerial: (lineKey: string, serial: string) => void;
}

/* Serial entry on a POS cart line (LF-P3): a serial-tracked line added by
 * tile/tap/search used to carry no serials and offered no way to enter one,
 * so the cashier hit a dead end at confirm. The cashier types or scans one
 * serial per unit here; each serial is validated live against the serial
 * lookup (must belong to this product and be in_stock) and the specific
 * reason is shown — never a generic message. Confirm stays blocked by the
 * existing validatePosSaleInput until serials count == qty. */
export function PosLineSerialEntry({ item, onAddSerial, onRemoveSerial }: PosLineSerialEntryProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = getSerialEntryState(item);
  const serials = item.serials || [];
  const complete = state.complete;

  async function handleAdd() {
    const raw = draft.trim();
    if (!raw) {
      const message = 'أدخل رقم السيريال أولاً.';
      setError(message);
      toast.error(message);
      return;
    }
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      const found = await productSerialsApi.lookup(raw);
      const lookupError = getSerialLookupError(raw, found, String(item.productId), item.name);
      if (lookupError) {
        setError(lookupError);
        toast.error(lookupError);
        return;
      }
      onAddSerial(item.lineKey, raw);
      setDraft('');
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذّرت إضافة السيريال.';
      setError(message);
      toast.error(message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      style={{
        marginTop: '4px',
        background: complete ? '#f0fdf4' : '#fffbeb',
        border: complete ? '1px solid #bbf7d0' : '1px solid #fde68a',
        borderRadius: '6px',
        padding: '5px 7px',
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', fontWeight: 700, color: complete ? '#15803d' : '#92400e' }}>
        <SmartphoneIcon size={12} color={complete ? '#15803d' : '#92400e'} />
        <span>
          {t('pos.serials_entered', 'سيريال / IMEI')}: {state.entered} {t('pos.serials_of', 'من')} {state.required}
          {complete ? ` — ${t('pos.serials_complete', 'مكتمل')}` : ` — ${t('pos.serials_missing', 'متبقٍ')} ${state.missing}`}
        </span>
      </div>

      {serials.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
          {serials.map((serial) => (
            <span
              key={serial}
              dir="ltr"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#7e22ce',
                background: '#faf5ff',
                border: '1px solid #e9d5ff',
                borderRadius: '4px',
                padding: '1px 3px 1px 6px',
              }}
            >
              {serial}
              <button
                type="button"
                aria-label={`حذف السيريال ${serial}`}
                title={t('pos.serial_remove', 'حذف السيريال')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7e22ce', fontSize: '0.85rem', lineHeight: 1, padding: '0 1px' }}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveSerial(item.lineKey, serial);
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {!complete && (
        <div style={{ display: 'flex', gap: '4px', marginTop: '5px' }}>
          <input
            type="text"
            dir="ltr"
            aria-label={t('pos.serial_input', 'السيريال / IMEI')}
            placeholder={t('pos.serial_placeholder', 'امسح أو اكتب السيريال / IMEI')}
            value={draft}
            disabled={checking}
            autoComplete="off"
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              height: '30px',
              fontSize: '0.8rem',
              padding: '0 8px',
              boxSizing: 'border-box',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              textAlign: 'left',
            }}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleAdd();
              }
            }}
          />
          <button
            type="button"
            disabled={checking}
            style={{
              flexShrink: 0,
              height: '30px',
              padding: '0 10px',
              fontSize: '0.78rem',
              fontWeight: 700,
              color: '#ffffff',
              background: '#170e5e',
              border: 'none',
              borderRadius: '6px',
              cursor: checking ? 'wait' : 'pointer',
            }}
            onClick={(event) => {
              event.stopPropagation();
              void handleAdd();
            }}
          >
            {checking ? t('pos.serial_checking', 'جارٍ الفحص...') : t('pos.serial_add', 'إضافة')}
          </button>
        </div>
      )}

      {error && (
        <div role="alert" style={{ fontSize: '0.72rem', color: '#b91c1c', fontWeight: 700, marginTop: '4px' }}>
          {error}
        </div>
      )}
    </div>
  );
}
