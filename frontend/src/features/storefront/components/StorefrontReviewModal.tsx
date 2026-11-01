import { useStorefrontLang } from '@/i18n';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import React, { useState, useEffect } from 'react';
import { StorefrontProduct, StorefrontReview } from '../types/storefront.types';
import { storefrontApi } from '../api/storefront.api';
import { IconStar, IconClose } from './StorefrontIcons';
import { getAutoProductPhoto, generatePremiumProductSvg } from '../lib/storefront-photo-matcher';
import { CheckCircleIcon, AlertCircleIcon } from '@/shared/components/icons/AppIcons';
import { useBodyScrollLock } from '@/shared/components/dialog-shell';

interface StorefrontReviewModalProps {
  isOpen: boolean;
  product: StorefrontProduct | null;
  slug: string;
  onClose: () => void;
  onReviewSubmitted?: (productId: number, newAvg: number, newCount: number) => void;
}

const RATING_LABELS: Record<number, string> = {
  5: 'ممتاز جداً (5/5)',
  4: 'جيد جداً (4/5)',
  3: 'جيد (3/5)',
  2: 'مقبول (2/5)',
  1: 'سيء (1/5)',
};

const RATING_LABELS_EN: Record<number, string> = {
  5: 'Excellent (5/5)',
  4: 'Very Good (4/5)',
  3: 'Good (3/5)',
  2: 'Fair (2/5)',
  1: 'Poor (1/5)',
};

export function StorefrontReviewModal({
  isOpen,
  product,
  slug,
  onClose,
  onReviewSubmitted,
}: StorefrontReviewModalProps) {
  const { t, isEn, dir } = useStorefrontLang();
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [customerName, setCustomerName] = useState('');
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [reviews, setReviews] = useState<StorefrontReview[]>([]);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);

  useBodyScrollLock(isOpen && Boolean(product));

  // Fetch past reviews when modal opens
  useEffect(() => {
    if (isOpen && product) {
      setRating(5);
      setHoverRating(0);
      setCustomerName('');
      setComment('');
      setSuccessMessage('');
      setErrorMessage('');
      setIsLoadingReviews(true);

      storefrontApi
        .getProductReviews(slug, product.id)
        .then((res) => {
          if (res?.ok && Array.isArray(res.reviews)) {
            setReviews(res.reviews);
          }
        })
        .catch(() => {
          setReviews([]);
        })
        .finally(() => {
          setIsLoadingReviews(false);
        });
    }
  }, [isOpen, product, slug]);

  if (!isOpen || !product) return null;

  const displayPhotoUrl = product.imageUrl || getAutoProductPhoto(product.name, product.categoryName);
  const activeStar = hoverRating || rating;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;

    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const res = await storefrontApi.submitReview(slug, product.id, {
        rating,
        customerName: customerName.trim() || undefined,
        comment: comment.trim() || undefined,
      });

      if (res?.ok) {
        setSuccessMessage(isEn ? 'Thank you! Your review has been submitted.' : 'شكراً لك! تم تسجيل تقييمك بنجاح.');
        onReviewSubmitted?.(product.id, res.avgRating, res.reviewCount);

        // Add to local list of reviews immediately
        const newRev: StorefrontReview = {
          id: Date.now(),
          rating,
          customerName: customerName.trim() || (isEn ? 'Store Customer' : 'عميل المتجر'),
          comment: comment.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
        setReviews((prev) => [newRev, ...prev]);

        // Auto close after 1.5s
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setErrorMessage(res?.message || (isEn ? 'Could not submit review, please try again later.' : 'تعذر إرسال التقييم، يرجى المحاولة لاحقاً'));
      }
    } catch (err: any) {
      setErrorMessage(err.message || (isEn ? 'An error occurred while submitting your review.' : 'حدث خطأ أثناء إرسال التقييم'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      dir={dir}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.48)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'sfAppleBackdropIn 0.16s cubic-bezier(0.22, 1, 0.36, 1) forwards',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '20px',
          width: '100%',
          maxWidth: '480px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
          border: '1px solid #e2e8f0',
          position: 'relative',
          willChange: 'transform, opacity',
          animation: 'sfAppleSpringOpen 0.22s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <IconStar size={18} fill="#f59e0b" color="#f59e0b" />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
              {t('storefront.storefront_review_modal.s0', "تقييم المنتج ومشاركة رأيك")}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              width: '34px',
              height: '34px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#475569',
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#fee2e2';
              e.currentTarget.style.color = '#dc2626';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.color = '#475569';
            }}
          >
            <IconClose size={15} />
          </button>
        </div>

        {/* Product Snapshot Info */}
        <div
          style={{
            padding: '12px 18px',
            background: '#f8fafc',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <img
            src={displayPhotoUrl}
            alt={product.name}
            onError={(e) => {
              e.currentTarget.src = generatePremiumProductSvg(product.name, product.categoryName);
            }}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '8px',
              objectFit: 'cover',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: '13.5px',
                fontWeight: 800,
                color: '#0f172a',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {product.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
              <span style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e' }}>
                {product.price > 0 ? `${product.price} ${getGlobalCurrencySymbol()}` : t('storefront.storefront_review_modal.s1', "مجاني")}
              </span>
              <span
                style={{
                  fontSize: '10.5px',
                  color: '#64748b',
                  background: '#e2e8f0',
                  padding: '1px 6px',
                  borderRadius: '4px',
                }}
              >
                {product.categoryName || t('storefront.storefront_review_modal.s2', "عام")}
              </span>
            </div>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '18px' }}>
          {/* Rating Stars Picker */}
          <div style={{ textAlign: 'center', marginBottom: '18px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
              {t('storefront.storefront_review_modal.s3', "كيف تقيّم هذا المنتج؟")}
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                direction: 'ltr',
                padding: '6px 12px',
                background: '#fefce8',
                borderRadius: '12px',
                border: '1px solid #fef08a',
              }}
            >
              {[1, 2, 3, 4, 5].map((star) => {
                const isLit = star <= activeStar;
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    aria-label={`${star} نجوم`}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '2px',
                      cursor: 'pointer',
                      transform: isLit ? 'scale(1.15)' : 'scale(1)',
                      transition: 'transform 0.15s ease',
                    }}
                  >
                    <IconStar
                      size={28}
                      fill={isLit ? '#f59e0b' : 'none'}
                      color={isLit ? '#f59e0b' : '#cbd5e1'}
                      strokeWidth={1.5}
                    />
                  </button>
                );
              })}
            </div>
            <div
              style={{
                marginTop: '6px',
                fontSize: '12.5px',
                fontWeight: 700,
                color: '#b45309',
                minHeight: '18px',
              }}
            >
              {(isEn ? RATING_LABELS_EN : RATING_LABELS)[activeStar] || ''}
            </div>
          </div>

          {/* Feedback messages */}
          {successMessage && (
            <div
              style={{
                padding: '10px 14px',
                marginBottom: '14px',
                borderRadius: '8px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                color: '#166534',
                fontSize: '12.5px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <CheckCircleIcon size={16} color="#15803d" />
              <span>{successMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div
              style={{
                padding: '10px 14px',
                marginBottom: '14px',
                borderRadius: '8px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                fontSize: '12.5px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <AlertCircleIcon size={16} color="#991b1b" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Customer Name (Optional) */}
          <div style={{ marginBottom: '14px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '12.5px',
                fontWeight: 700,
                color: '#475569',
                marginBottom: '5px',
              }}
            >
              {t('storefront.storefront_review_modal.s4', "اسمك (اختياري - يظهر مع التقييم):")}
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={t('storefront.storefront_review_modal.s5', "مثال: أحمد مصطفى أو عميل المتجر")}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                boxSizing: 'border-box',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Comment / Review (Optional) */}
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '12.5px',
                fontWeight: 700,
                color: '#475569',
                marginBottom: '5px',
              }}
            >
              {t('storefront.storefront_review_modal.s6', "رأيك أو تعليقك على المنتج (اختياري):")}
            </label>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('storefront.storefront_review_modal.s7', "اكتب تجربتك مع المنتج، جودته، وسرعة الاستلام...")}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                boxSizing: 'border-box',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Submit Action */}
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              width: '100%',
              padding: '10px 16px',
              borderRadius: '10px',
              background: '#170e5e',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 800,
              border: 'none',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1,
              boxShadow: '0 4px 12px rgba(23, 14, 94, 0.25)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!isSubmitting) e.currentTarget.style.background = '#24168f';
            }}
            onMouseLeave={(e) => {
              if (!isSubmitting) e.currentTarget.style.background = '#170e5e';
            }}
          >
            {isSubmitting ? t('storefront.storefront_review_modal.s8', "جاري إرسال التقييم...") : t('storefront.storefront_review_modal.s9', "إرسال التقييم")}
          </button>
        </form>

        {/* Previous Reviews Showcase */}
        <div
          style={{
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            padding: '14px 18px',
            borderBottomLeftRadius: '16px',
            borderBottomRightRadius: '16px',
          }}
        >
          <div
            style={{
              fontSize: '12.5px',
              fontWeight: 800,
              color: '#334155',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{t('storefront.storefront_review_modal.s10', "آراء وتقييمات العملاء السابقة (")}{reviews.length})</span>
            {product.rating && product.rating > 0 ? (
              <span style={{ color: '#d97706', fontSize: '12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <IconStar size={13} fill="#f59e0b" color="#f59e0b" />
                <span>{Number(product.rating).toFixed(1)} / 5</span>
              </span>
            ) : null}
          </div>

          {isLoadingReviews ? (
            <div style={{ textAlign: 'center', padding: '12px', fontSize: '12px', color: '#94a3b8' }}>
              {t('storefront.storefront_review_modal.s11', "جاري تحميل آراء المشترين...")}
            </div>
          ) : reviews.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '14px 10px',
                fontSize: '12px',
                color: '#64748b',
                background: '#ffffff',
                borderRadius: '8px',
                border: '1px dashed #cbd5e1',
              }}
            >
              {t('storefront.storefront_review_modal.s12', "لا توجد تقييمات مسجلة بعد لهذا المنتج. كن أول من يقيّمه وشارك رأيك!")}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
              {reviews.map((rev) => (
                <div
                  key={rev.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#1e293b' }}>
                      {rev.customerName || t('storefront.storefront_review_modal.s13', "عميل المتجر")}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      {[...Array(5)].map((_, idx) => (
                        <IconStar
                          key={idx}
                          size={10}
                          fill={idx < rev.rating ? '#f59e0b' : '#e2e8f0'}
                          color={idx < rev.rating ? '#f59e0b' : '#e2e8f0'}
                        />
                      ))}
                    </div>
                  </div>
                  {rev.comment && (
                    <div style={{ fontSize: '12px', color: '#475569', lineHeight: '1.4' }}>
                      {rev.comment}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
