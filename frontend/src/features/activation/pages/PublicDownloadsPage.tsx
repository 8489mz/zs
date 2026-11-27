import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  ArchiveIcon,
  CheckCircleIcon,
  CopyIcon,
  DownloadIcon,
  InfoIcon,
  LinkIcon,
  MonitorIcon,
  PrinterIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { usePublicDownloads } from '@/features/activation/hooks/usePublicDownloads';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

const CARD_STYLE: CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '14px',
  padding: '20px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  textAlign: 'right',
};

const SUB_CARD_STYLE: CSSProperties = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  textAlign: 'right',
};

const PRIMARY_BTN: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  backgroundColor: '#170e5e',
  color: '#ffffff',
  border: '1px solid #170e5e',
  borderRadius: '10px',
  padding: '9px 15px',
  fontSize: '13px',
  fontWeight: 700,
  textDecoration: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const SECONDARY_BTN: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  border: '1px solid #cbd5e1',
  borderRadius: '10px',
  padding: '9px 15px',
  fontSize: '13px',
  fontWeight: 600,
  textDecoration: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const LTR_CHIP: CSSProperties = {
  direction: 'ltr',
  unicodeBidi: 'isolate',
  display: 'inline-block',
  backgroundColor: '#e2e8f0',
  color: '#0f172a',
  padding: '1px 6px',
  borderRadius: '5px',
  fontSize: '0.75rem',
  fontFamily: 'monospace',
};

const SECTION_BAR: CSSProperties = {
  width: '3px',
  height: '16px',
  backgroundColor: '#170e5e',
  borderRadius: '2px',
  display: 'inline-block',
  flexShrink: 0,
};

export function PublicDownloadsPage() {
  const { manifest, bridgeState, checkBridgeStatus } = usePublicDownloads();

  async function handleCopySha(hash: string) {
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      toast.success('تم نسخ بصمة التحقق (SHA-256)');
    } catch {
      toast.info(hash);
    }
  }

  async function handleProbeBridge() {
    const ok = await checkBridgeStatus();
    if (ok) toast.success('أداة ربط الأجهزة متصلة وجاهزة على هذا الجهاز');
    else toast.warning('الجسر غير شغّال حالياً على المنفذ 18181 — قم بتنزيله وتشغيله أولاً');
  }

  const badgeColors =
    bridgeState.status === 'online'
      ? { bg: '#dcfce7', fg: '#166534' }
      : bridgeState.status === 'checking'
        ? { bg: '#e0f2fe', fg: '#075985' }
        : { bg: '#f1f5f9', fg: '#475569' };

  return (
    <div
      dir="rtl"
      style={{
        height: '100vh',
        overflowY: 'auto',
        backgroundColor: '#f8fafc',
        color: '#0f172a',
        padding: '24px 16px 40px',
        textAlign: 'right',
      }}
    >
      <div
        style={{
          maxWidth: '1080px',
          width: 'min(100%, 1080px)',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          textAlign: 'right',
        }}
      >
        <header
          style={{
            ...CARD_STYLE,
            padding: '16px 20px',
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '14px',
          }}
        >
          <div style={{ flex: '1 1 320px', display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'right' }}>
            <img
              src="/logo_cropped.png"
              alt="Z-Systems"
              style={{ width: '42px', height: '42px', objectFit: 'contain', borderRadius: '10px', flexShrink: 0 }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            <div style={{ textAlign: 'right' }}>
              <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', textAlign: 'right' }}>
                مركز تحميل أدوات وتجهيزات Z-Systems
              </h1>
              <p style={{ margin: '3px 0 0', fontSize: '0.8125rem', color: '#64748b', textAlign: 'right' }}>
                رابط ثابت لتنزيل أداة الطباعة الصامتة ومتطلبات الويندوز (Windows 10 / 11)
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                backgroundColor: badgeColors.bg,
                color: badgeColors.fg,
                border: '1px solid #e2e8f0',
                whiteSpace: 'nowrap',
              }}
            >
              <CheckCircleIcon size={14} />
              {bridgeState.status === 'online'
                ? `الجسر متصل (${bridgeState.version ? `v${bridgeState.version}` : '127.0.0.1:18181'})`
                : bridgeState.status === 'checking'
                  ? 'جاري فحص الجسر...'
                  : 'الجسر غير متصل حالياً'}
            </span>

            <button type="button" onClick={handleProbeBridge} style={SECONDARY_BTN}>
              <RefreshCwIcon size={15} />
              <span>فحص الاتصال</span>
            </button>

            <Link to="/login" style={SECONDARY_BTN}>
              <LinkIcon size={15} />
              <span>تسجيل الدخول</span>
            </Link>
          </div>
        </header>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '16px',
            alignItems: 'stretch',
          }}
        >
          <section style={CARD_STYLE}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={SECTION_BAR} />
                <PrinterIcon size={18} color="#170e5e" />
                <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#1e293b' }}>
                  أداة ربط الطابعات والأجهزة (Z-Systems Bridge)
                </h2>
              </div>
              <span
                style={{
                  backgroundColor: '#eef2ff',
                  color: '#170e5e',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: '999px',
                  whiteSpace: 'nowrap',
                }}
              >
                الإصدار {manifest.version}
              </span>
            </div>

            <p style={{ margin: 0, fontSize: '0.8125rem', color: '#475569', lineHeight: 1.65, textAlign: 'right' }}>
              تشغّل الطباعة الصامتة من المتصفح مباشرة بدون نوافذ معاينة، وتدعم درج النقدية وأجهزة الدفع والشبكة عبر المنفذ
              المحلي <span style={LTR_CHIP}>127.0.0.1:18181</span>. ملف واحد مستقل بدون تثبيت.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <a href={manifest.exeUrl} download={manifest.exeFile} style={{ ...PRIMARY_BTN, flex: '1 1 170px' }}>
                <DownloadIcon size={16} />
                <span>تحميل مباشر (EXE)</span>
              </a>

              <a href={manifest.zipUrl} download={manifest.zipFile} style={{ ...SECONDARY_BTN, flex: '1 1 170px' }}>
                <ArchiveIcon size={16} />
                <span>تحميل مضغوط (ZIP)</span>
              </a>
            </div>

            <div style={{ ...SUB_CARD_STYLE, fontSize: '0.75rem', color: '#475569', marginTop: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <span>
                  <span style={LTR_CHIP}>{manifest.exeFile}</span> — {formatBytes(manifest.exeSizeBytes)}
                </span>
                <span>
                  <span style={LTR_CHIP}>{manifest.zipFile}</span> — {formatBytes(manifest.zipSizeBytes)}
                </span>
              </div>
              {manifest.exeSha256 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <code
                    dir="ltr"
                    title={manifest.exeSha256}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: '0.72rem',
                      color: '#334155',
                    }}
                  >
                    SHA-256: {manifest.exeSha256}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopySha(manifest.exeSha256)}
                    style={{ ...SECONDARY_BTN, padding: '4px 9px', fontSize: '0.72rem', borderRadius: '6px' }}
                  >
                    <CopyIcon size={12} />
                    <span>نسخ</span>
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <section style={CARD_STYLE}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={SECTION_BAR} />
              <MonitorIcon size={18} color="#170e5e" />
              <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#1e293b' }}>
                متطلبات تشغيل الويندوز والأدوات المساندة
              </h2>
            </div>

            <div style={SUB_CARD_STYLE}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>
                Microsoft Visual C++ Redistributable (x64)
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.55, textAlign: 'right' }}>
                حزمة رسمية من مايكروسوفت، مطلوبة على أجهزة ويندوز الجديدة لتشغيل قاعدة بيانات نسخة الأوفلاين (Electron)
                بسلاسة. الجسر نفسه يعمل بدونه تلقائياً.
              </p>
              <a
                href="https://aka.ms/vs/17/release/vc_redist.x64.exe"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...PRIMARY_BTN, alignSelf: 'flex-start' }}
              >
                <DownloadIcon size={15} />
                <span>تحميل Visual C++ x64 الرسمي</span>
              </a>
            </div>

            <div style={SUB_CARD_STYLE}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>
                برنامج فك الضغط 7-Zip (مجاني واختياري)
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.55, textAlign: 'right' }}>
                نظام Windows 10 و11 يفتح ملفات <span style={LTR_CHIP}>.zip</span> تلقائياً بدون برامج إضافية، ويمكنك
                استخدام 7-Zip مجاناً لأي أرشيفات إضافية.
              </p>
              <a
                href="https://www.7-zip.org/download.html"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...SECONDARY_BTN, alignSelf: 'flex-start' }}
              >
                <ArchiveIcon size={15} />
                <span>تحميل 7-Zip الرسمي</span>
              </a>
            </div>
          </section>
        </div>

        <section style={CARD_STYLE}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={SECTION_BAR} />
            <ShieldCheckIcon size={18} color="#170e5e" />
            <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#1e293b' }}>
              خطوات التثبيت والتشغيل السريعة عند العميل
            </h2>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '12px',
            }}
          >
            <div style={SUB_CARD_STYLE}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#170e5e' }}>1. حفظ الملف في مجلد ثابت</div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569', lineHeight: 1.6, textAlign: 'right' }}>
                أنشئ مجلداً مثل <span style={LTR_CHIP}>C:\Z-Systems-Bridge</span> وضع بداخله{' '}
                <span style={LTR_CHIP}>z-systems-bridge.exe</span> فقط.
              </p>
            </div>

            <div style={SUB_CARD_STYLE}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#170e5e' }}>2. التشغيل وتجاوز تنبيه ويندوز</div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569', lineHeight: 1.6, textAlign: 'right' }}>
                شغّل الملف مرة واحدة؛ إن ظهر تنبيه <span style={LTR_CHIP}>Windows protected your PC</span> اضغط{' '}
                <span style={LTR_CHIP}>More info ← Run anyway</span>.
              </p>
            </div>

            <div style={SUB_CARD_STYLE}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#170e5e' }}>3. التأكد من الاتصال</div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569', lineHeight: 1.6, textAlign: 'right' }}>
                ستظهر أيقونة <strong>Z</strong> بجانب الساعة ويعمل الجسر تلقائياً مع إقلاع ويندوز، واضغط زر «فحص الاتصال»
                بالأعلى للتأكد.
              </p>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              fontSize: '0.76rem',
              color: '#64748b',
              borderTop: '1px solid #f1f5f9',
              paddingTop: '10px',
              textAlign: 'right',
            }}
          >
            <InfoIcon size={15} />
            <span>روابط التحميل الثابتة:</span>
            <span style={LTR_CHIP}>/downloads/z-systems-bridge.exe</span>
            <span style={LTR_CHIP}>/downloads/z-systems-bridge.zip</span>
            <span>— تتحدث تلقائياً بنفس الرابط مع كل إصدار جديد.</span>
          </div>
        </section>
      </div>
    </div>
  );
}
