import { useTranslation } from 'react-i18next';
import { DialogShell } from '@/shared/components/dialog-shell';
import { XIcon } from '@/shared/components/icons/AppIcons';
import type { PortalItem } from './portals-data';

interface PortalQrModalProps {
  portal: PortalItem | null;
  onClose: () => void;
  copied: boolean;
  onCopy: (url: string) => void;
}

export function PortalQrModal({ portal, onClose, copied, onCopy }: PortalQrModalProps) {
  const { t } = useTranslation();
  if (!portal) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // INV-HUB-DEAD-END: a resolved destination can already be absolute (the
  // tenant's public store URL), so only prepend the origin for in-app paths.
  const fullUrl =
    portal.path.startsWith('http://') || portal.path.startsWith('https://')
      ? portal.path
      : `${origin}${portal.path}`;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(fullUrl)}`;

  return (
    <DialogShell open={true} onClose={onClose} width="min(440px, 94vw)" ariaLabel={t('portals_hub.portal_qr_modal.s0', "رمز الاستجابة السريعة")}>
      <div dir="rtl" style={{ padding: '24px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
            {t('portals_hub.portal_qr_modal.s1', "رمز QR:")} {portal.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: '4px' }}
          >
            <XIcon size={18} />
          </button>
        </div>

        <p style={{ margin: '0 0 16px', fontSize: '12.5px', color: '#64748b' }}>
          {t('portals_hub.portal_qr_modal.s2', "امسح الكود بكاميرا الموبايل أو التابلت لفتح البوابة مباشرة")}
        </p>

        <div style={{ padding: '16px', borderRadius: '16px', background: '#f8fafc', border: '1px solid #e2e8f0', display: 'inline-block', marginBottom: '16px' }}>
          <img src={qrApiUrl} alt="QR Code" style={{ width: '200px', height: '200px', display: 'block' }} />
        </div>

        <div style={{ background: '#f1f5f9', borderRadius: '10px', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr' }}>
            {fullUrl}
          </span>
          <button
            type="button"
            onClick={() => onCopy(fullUrl)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: copied ? '#059669' : '#170e5e',
              color: '#ffffff',
              fontSize: '11.5px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {copied ? t('portals_hub.portal_qr_modal.s3', "تم النسخ!") : t('portals_hub.portal_qr_modal.s4', "نسخ الرابط")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
