import { useState } from 'react';
import type { StorefrontInfo } from '../types/storefront.types';
import { resolveStorefrontBrand, StorefrontBrandLogo } from './StorefrontHeader';

interface StorefrontFooterProps {
  info?: StorefrontInfo | null;
  onOpenCart?: () => void;
  onOpenOrders?: () => void;
  onOpenCategories?: () => void;
  onGoHome?: () => void;
  onToggleDeals?: () => void;
}

export function StorefrontFooter({
  info,
  onOpenCart: _onOpenCart,
  onOpenOrders,
  onOpenCategories,
  onGoHome,
  onToggleDeals,
}: StorefrontFooterProps) {
  const safeInfo: StorefrontInfo = info || {
    tenantId: '',
    slug: '',
    businessName: '',
    enabled: true,
    title: '',
    bio: '',
    announcement: '',
    bannerUrl: '',
    deliveryFee: 0,
    minOrder: 0,
    whatsappPhone: '',
    currency: 'EGP',
    smartDealsEnabled: false,
  };

  const brand = resolveStorefrontBrand(safeInfo);
  const whatsappNumber = (safeInfo.whatsappPhone || '').replace(/[^0-9]/g, '');
  const cleanPhone = whatsappNumber.startsWith('01') ? `2${whatsappNumber}` : whatsappNumber;
  const currentYear = new Date().getFullYear();

  const [activePolicy, setActivePolicy] = useState<{ title: string; content: string } | null>(null);

  const supportEmail =
    safeInfo.supportEmail?.trim() ||
    ((safeInfo as unknown as Record<string, unknown>).email as string | undefined)?.trim() ||
    '';

  const policies = {
    contact: {
      title: 'تواصل معنا',
      content: cleanPhone
        ? `يسعدنا تواصلك معنا مباشرة عبر واتساب أو الهاتف على الرقم ${safeInfo.whatsappPhone || safeInfo.contactPhone || ''}${supportEmail ? ` أو عبر البريد الإلكتروني ${supportEmail}` : ''} طوال أيام الأسبوع.`
        : supportEmail
          ? `يسعدنا تواصلك معنا عبر البريد الإلكتروني ${supportEmail}${safeInfo.contactPhone ? ` أو هاتفياً على ${safeInfo.contactPhone}` : ''} للرد على كافة استفساراتك وطلباتك في أسرع وقت.`
          : 'يسعدنا دائماً خدمتكم والتواصل معكم والرد على كافة استفساراتكم وطلباتكم في أسرع وقت.',
    },
    faq: {
      title: 'الأسئلة الشائعة',
      content:
        'يمكنك الطلب بسهولة عبر إضافة المنتجات إلى سلة المشتريات ثم الضغط على إتمام الطلب وإدخال بيانات التوصيل. نوفر خدمة الدفع عند الاستلام والتوصيل السريع لكافة المناطق.',
    },
    shippingReturns: {
      title: 'الشحن والاسترجاع',
      content:
        'يتم شحن الطلبات خلال 24 إلى 48 ساعة من تأكيد الطلب. كما يحق للعميل استبدال أو استرجاع المنتج خلال 14 يوماً من تاريخ الاستلام بشرط أن يكون بحالته الأصلية.',
    },
    qualityGuarantee: {
      title: 'ضمان الجودة والأصالة',
      content:
        'نحرص على انتقاء وتقديم أفضل المنتجات الأصلية بعناية فائقة وبأعلى معايير الجودة، مع فحص وتغليف كل طلب باحترافية لضمان وصوله بأفضل حالة.',
    },
    privacy: {
      title: 'سياسة الخصوصية',
      content:
        'نحن نلتزم بحماية بياناتك الشخصية واستخدامها فقط لتنفيذ طلباتك وتحسين تجربة التسوق. جميع بياناتك ومعاملاتك محمية بأعلى معايير الأمان والخصوصية.',
    },
    terms: {
      title: 'شروط الخدمة',
      content:
        'باستخدامك للمتجر فإنك توافق على شروط الخدمة والأسعار المعلنة. نحرص دائماً على تقديم أفضل جودة وأدق مواصفات لكافة المنتجات المعروضة.',
    },
  };

  const storeDescription =
    (safeInfo.bio || safeInfo.description || '').trim() ||
    'وجهتك المفضلة لتجربة تسوق مميزة وسلسة. نوفر لكم تشكيلة مختارة بعناية بأعلى جودة وأفضل الأسعار.';

  const scrollTopAndRun = (fn?: () => void) => {
    if (fn) fn();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="sf-stylehub-footer-outer" dir="rtl">
      <div className="sf-stylehub-footer-card">
        <div className="sf-stylehub-footer-grid">
          {/* Column 1: Brand + Description + Outline Social Icons */}
          <div className="sf-stylehub-col-brand">
            <div className="sf-stylehub-brand-row">
              {safeInfo.logo_url || safeInfo.logoUrl ? (
                <StorefrontBrandLogo
                  src={(safeInfo.logo_url || safeInfo.logoUrl)!}
                  alt={brand.title}
                  size={28}
                />
              ) : (
                <span className="sf-stylehub-cube-icon" aria-hidden="true">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                </span>
              )}
              <h3 dir="auto" className="sf-stylehub-brand-name">
                {brand.title}
              </h3>
            </div>

            <p className="sf-stylehub-brand-desc">{storeDescription}</p>

            <div className="sf-stylehub-socials">
              {/* Facebook */}
              {safeInfo.facebookUrl ? (
                <a
                  href={safeInfo.facebookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sf-stylehub-social-link"
                  aria-label="فيسبوك"
                  title="فيسبوك"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
                  </svg>
                </a>
              ) : (
                <span
                  className="sf-stylehub-social-link sf-social-empty"
                  aria-label="فيسبوك"
                  title="فيسبوك (يمكنك تفعيله من إعدادات المتجر)"
                  style={{ opacity: 0.45, cursor: 'default' }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
                  </svg>
                </span>
              )}

              {/* Instagram */}
              {safeInfo.instagramUrl ? (
                <a
                  href={safeInfo.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sf-stylehub-social-link"
                  aria-label="إنستغرام"
                  title="إنستغرام"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                  </svg>
                </a>
              ) : (
                <span
                  className="sf-stylehub-social-link sf-social-empty"
                  aria-label="إنستغرام"
                  title="إنستغرام (يمكنك تفعيله من إعدادات المتجر)"
                  style={{ opacity: 0.45, cursor: 'default' }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                  </svg>
                </span>
              )}

              {/* Twitter / X */}
              {safeInfo.twitterUrl ? (
                <a
                  href={safeInfo.twitterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sf-stylehub-social-link"
                  aria-label="إكس / تويتر"
                  title="إكس / تويتر"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
                  </svg>
                </a>
              ) : (
                <span
                  className="sf-stylehub-social-link sf-social-empty"
                  aria-label="إكس / تويتر"
                  title="إكس / تويتر (يمكنك تفعيله من إعدادات المتجر)"
                  style={{ opacity: 0.45, cursor: 'default' }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
                  </svg>
                </span>
              )}

              {/* TikTok */}
              {safeInfo.tiktokUrl && (
                <a
                  href={safeInfo.tiktokUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sf-stylehub-social-link"
                  aria-label="تيك توك"
                  title="تيك توك"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
                  </svg>
                </a>
              )}

              {/* YouTube */}
              {safeInfo.youtubeUrl && (
                <a
                  href={safeInfo.youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sf-stylehub-social-link"
                  aria-label="يوتيوب"
                  title="يوتيوب"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
                    <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
                  </svg>
                </a>
              )}

              {/* Telegram */}
              {safeInfo.telegramUrl && (
                <a
                  href={safeInfo.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sf-stylehub-social-link"
                  aria-label="تليجرام"
                  title="تليجرام"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </a>
              )}

              {/* WhatsApp */}
              {cleanPhone ? (
                <a
                  href={`https://wa.me/${cleanPhone}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sf-stylehub-social-link"
                  aria-label="واتساب"
                  title="واتساب"
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                  </svg>
                </a>
              ) : (
                <span
                  className="sf-stylehub-social-link sf-social-empty"
                  aria-label="واتساب"
                  title="واتساب (يمكنك تفعيله من إعدادات المتجر)"
                  style={{ opacity: 0.45, cursor: 'default' }}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                  </svg>
                </span>
              )}
            </div>
          </div>

          {/* Column 2: Quick Links (روابط سريعة) */}
          <div>
            <h4 className="sf-stylehub-col-heading">روابط سريعة</h4>
            <ul className="sf-stylehub-links-list">
              <li>
                <button
                  type="button"
                  onClick={() => scrollTopAndRun(onGoHome)}
                  className="sf-stylehub-link-btn"
                >
                  تسوق الكل
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => (onOpenCategories ? onOpenCategories() : scrollTopAndRun(onGoHome))}
                  className="sf-stylehub-link-btn"
                >
                  الأكثر مبيعاً
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => scrollTopAndRun(onToggleDeals || onGoHome)}
                  className="sf-stylehub-link-btn"
                >
                  العروض والتخفيضات
                </button>
              </li>
            </ul>
          </div>

          {/* Column 3: Customer Service (خدمة العملاء) */}
          <div>
            <h4 className="sf-stylehub-col-heading">خدمة العملاء</h4>
            <ul className="sf-stylehub-links-list">
              <li>
                {cleanPhone ? (
                  <a
                    href={`https://wa.me/${cleanPhone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sf-stylehub-link-btn"
                    style={{ textDecoration: 'none', display: 'inline-block' }}
                  >
                    تواصل معنا
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActivePolicy(policies.contact)}
                    className="sf-stylehub-link-btn"
                  >
                    تواصل معنا
                  </button>
                )}
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setActivePolicy(policies.shippingReturns)}
                  className="sf-stylehub-link-btn"
                >
                  الشحن والاسترجاع
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setActivePolicy(policies.qualityGuarantee)}
                  className="sf-stylehub-link-btn"
                >
                  ضمان الجودة
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => (onOpenOrders ? onOpenOrders() : setActivePolicy(policies.shippingReturns))}
                  className="sf-stylehub-link-btn"
                >
                  تتبع الطلب
                </button>
              </li>
            </ul>
          </div>

          {/* Column 4: Stay Connected (ابقَ على تواصل) */}
          <div className="sf-stylehub-col-connect">
            <h4 className="sf-stylehub-col-heading">ابقَ على تواصل</h4>

            {supportEmail ? (
              <a
                href={`mailto:${supportEmail}`}
                className="sf-stylehub-support-mail"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <span dir="ltr">{supportEmail}</span>
              </a>
            ) : null}

            {safeInfo.contactPhone ? (
              <a
                href={`tel:${safeInfo.contactPhone}`}
                className="sf-stylehub-support-mail"
                style={{ marginTop: supportEmail ? '8px' : '0' }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <span dir="ltr">{safeInfo.contactPhone}</span>
              </a>
            ) : null}

            {!supportEmail && !safeInfo.contactPhone && (
              <div
                className="sf-stylehub-support-mail"
                style={{ opacity: 0.6, cursor: 'default' }}
                title="يمكنك ضبط وسائل التواصل من لوحة الإعدادات"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <span>خدمة العملاء متاحة أونلاين</span>
              </div>
            )}
          </div>
        </div>

        <hr className="sf-stylehub-divider" />

        {/* Centered Bottom Copyright & Legal Links */}
        <div className="sf-stylehub-bottom">
          <p className="sf-stylehub-copyright">
            © {currentYear} <span dir="auto">{brand.title}</span>. جميع الحقوق محفوظة.
          </p>
          <div className="sf-stylehub-bottom-links">
            <button
              type="button"
              onClick={() => setActivePolicy(policies.privacy)}
              className="sf-stylehub-bottom-link"
            >
              سياسة الخصوصية
            </button>
            <span style={{ color: '#d1d5db' }}>|</span>
            <button
              type="button"
              onClick={() => setActivePolicy(policies.terms)}
              className="sf-stylehub-bottom-link"
            >
              شروط الخدمة
            </button>
          </div>
        </div>
      </div>

      {/* Policy Modal */}
      {activePolicy && (
        <div
          onClick={() => setActivePolicy(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid #e2e8f0',
              padding: '22px 24px',
              maxWidth: '460px',
              width: '100%',
              boxShadow: '0 20px 40px rgba(15, 23, 42, 0.16)',
              position: 'relative',
              direction: 'rtl',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                {activePolicy.title}
              </h3>
              <button
                type="button"
                onClick={() => setActivePolicy(null)}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  width: '32px',
                  height: '32px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#64748b',
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <p style={{ margin: 0, fontSize: '13.5px', color: '#475569', lineHeight: 1.7 }}>
              {activePolicy.content}
            </p>
          </div>
        </div>
      )}
    </footer>
  );
}
