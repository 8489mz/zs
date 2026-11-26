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

export function PublicDownloadsPage() {
  const { manifest, bridgeState, checkBridgeStatus } = usePublicDownloads();

  async function handleCopySha(label: string, hash: string) {
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      toast.success(`تم نسخ بصمة التحقق (${label})`);
    } catch {
      toast.info(hash);
    }
  }

  async function handleProbeBridge() {
    const ok = await checkBridgeStatus();
    if (ok) {
      toast.success('أداة ربط الأجهزة متصلة وجاهزة على هذا الجهاز');
    } else {
      toast.warning('الجسر غير شغّال حالياً على المنفذ 18181 — قم بتنزيله وتشغيله أولاً');
    }
  }

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  };

  const primaryButtonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    backgroundColor: '#170e5e',
    color: '#ffffff',
    border: '1px solid #170e5e',
    borderRadius: '10px',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: 700,
    textDecoration: 'none',
    cursor: 'pointer',
  };

  const secondaryButtonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    border: '1px solid #cbd5e1',
    borderRadius: '10px',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: 600,
    textDecoration: 'none',
    cursor: 'pointer',
  };

  const sectionBarStyle: React.CSSProperties = {
    width: '3px',
    height: '16px',
    backgroundColor: '#170e5e',
    borderRadius: '2px',
    display: 'inline-block',
    flexShrink: 0,
  };

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        color: '#0f172a',
        padding: '24px 16px 40px',
      }}
    >
      <div
        style={{
          maxWidth: '1080px',
          width: 'min(100%, 1080px)',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
        }}
      >
        <header
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '18px 20px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img
              src="/logo_cropped.png"
              alt="Z-Systems"
              style={{ width: '44px', height: '44px', objectFit: 'contain', borderRadius: '10px' }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            <div>
              <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                مركز تحميل أدوات وتجهيزات Z-Systems
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
                رابط ثابت ومباشر لتنزيل أداة الطباعة الصامتة ومتطلبات التشغيل على أجهزة الكاشير (Windows 10 / 11)
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                backgroundColor:
                  bridgeState.status === 'online'
                    ? '#dcfce7'
                    : bridgeState.status === 'checking'
                      ? '#e0f2fe'
                      : '#f1f5f9',
                color:
                  bridgeState.status === 'online'
                    ? '#166534'
                    : bridgeState.status === 'checking'
                      ? '#075985'
                      : '#475569',
                border: '1px solid #e2e8f0',
              }}
            >
              <CheckCircleIcon size={14} />
              {bridgeState.status === 'online'
                ? `الجسر متصل (${bridgeState.version ? `v${bridgeState.version}` : '127.0.0.1:18181'})`
                : bridgeState.status === 'checking'
                  ? 'جاري فحص الجسر على الجهاز...'
                  : 'الجسر غير متصل على هذا الجهاز'}
            </span>

            <button type="button" onClick={handleProbeBridge} style={secondaryButtonStyle}>
              <RefreshCwIcon size={15} />
              <span>فحص الاتصال</span>
            </button>

            <Link to="/login" style={secondaryButtonStyle}>
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
          <section style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={sectionBarStyle} />
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
                  padding: '3px 9px',
                  borderRadius: '999px',
                }}
              >
                الإصدار {manifest.version}
              </span>
            </div>

            <p style={{ margin: 0, fontSize: '0.8125rem', color: '#475569', lineHeight: 1.65 }}>
              تشغّل الطباعة الصامتة من المتصفح مباشرة بدون نوافذ معاينة، وتدعم درج النقدية وأجهزة الدفع والشبكة عبر المنفذ
              المحلي <code>127.0.0.1:18181</code>. ملف واحد مستقل بدون تثبيت.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <a
                href={manifest.exeUrl}
                download={manifest.exeFile}
                style={{ ...primaryButtonStyle, flex: '1 1 200px' }}
              >
                <DownloadIcon size={16} />
                <span>تحميل مباشر ({manifest.exeFile})</span>
              </a>

              <a
                href={manifest.zipUrl}
                download={manifest.zipFile}
                style={{ ...secondaryButtonStyle, flex: '1 1 200px' }}
              >
                <ArchiveIcon size={16} />
                <span>نسخة مضغوطة ({manifest.zipFile})</span>
              </a>
            </div>

            <div
              style={{
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                fontSize: '0.75rem',
                color: '#475569',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <span>حجم الملف التنفيذي (.exe): {formatBytes(manifest.exeSizeBytes)}</span>
                <span>حجم الملف المضغوط (.zip): {formatBytes(manifest.zipSizeBytes)}</span>
              </div>
              {manifest.exeSha256 ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ direction: 'ltr', unicodeBidi: 'plaintext', wordBreak: 'break-all' }}>
                    SHA-256: {manifest.exeSha256}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopySha('EXE', manifest.exeSha256)}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '3px 8px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      color: '#0f172a',
                    }}
                  >
                    <CopyIcon size={12} />
                    <span>نسخ</span>
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <section style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={sectionBarStyle} />
              <MonitorIcon size={18} color="#170e5e" />
              <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#1e293b' }}>
                متطلبات تشغيل الويندوز والأدوات المساندة
              </h2>
            </div>

            <div
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>
                Microsoft Visual C++ Redistributable (x64)
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.55 }}>
                حزمة رسمية من مايكروسوفت، مطلوبة على أجهزة ويندوز الجديدة لتشغيل قاعدة بيانات نسخة الأوفلاين (Electron)
                بسلاسة. الجسر نفسه يعمل بدونه تلقائياً.
              </p>
              <div>
                <a
                  href="https://aka.ms/vs/17/release/vc_redist.x64.exe"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={primaryButtonStyle}
                >
                  <DownloadIcon size={15} />
                  <span>تحميل Visual C++ x64 (من مايكروسوفت)</span>
                </a>
              </div>
            </div>

            <div
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>
                برنامج فك الضغط 7-Zip (مجاني واختياري)
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.55 }}>
                نظام Windows 10 و11 يفتح ملفات <code>.zip</code> تلقائياً بدون برامج إضافية، ويمكنك استخدام 7-Zip مجاناً
                لأي أرشيفات إضافية.
              </p>
              <div>
                <a
                  href="https://www.7-zip.org/download.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={secondaryButtonStyle}
                >
                  <ArchiveIcon size={15} />
                  <span>تحميل 7-Zip الرسمي</span>
                </a>
              </div>
            </div>
          </section>
        </div>

        <section style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={sectionBarStyle} />
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
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px' }}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '4px', color: '#170e5e' }}>
                1. حفظ الملف في مجلد ثابت
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569', lineHeight: 1.55 }}>
                أنشئ مجلداً مثل <code dir="ltr">C:\Z-Systems-Bridge</code> وضع بداخله{' '}
                <code dir="ltr">z-systems-bridge.exe</code> فقط (أو استخرجه من ملف <code>.zip</code>).
              </p>
            </div>

            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px' }}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '4px', color: '#170e5e' }}>
                2. التشغيل وتجاوز تنبيه ويندوز
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569', lineHeight: 1.55 }}>
                شغّل الملف مرة واحدة؛ إن ظهر تنبيه <code dir="ltr">Windows protected your PC</code> اضغط{' '}
                <code dir="ltr">More info</code> ثم <code dir="ltr">Run anyway</code>.
              </p>
            </div>

            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px' }}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '4px', color: '#170e5e' }}>
                3. التأكد من الاتصال
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569', lineHeight: 1.55 }}>
                ستظهر أيقونة <strong>Z</strong> بجانب الساعة ويعمل الجسر تلقائياً مع إقلاع ويندوز. اضغط زر "فحص
                الاتصال" بالأعلى للتأكد.
              </p>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.76rem',
              color: '#64748b',
              borderTop: '1px solid #f1f5f9',
              paddingTop: '10px',
            }}
          >
            <InfoIcon size={15} />
            <span>
              روابط التحميل الثابتة: <code dir="ltr">/downloads/z-systems-bridge.exe</code> و{' '}
              <code dir="ltr">/downloads/z-systems-bridge.zip</code> — تتحدث تلقائياً بنفس الرابط مع كل إصدار جديد.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
