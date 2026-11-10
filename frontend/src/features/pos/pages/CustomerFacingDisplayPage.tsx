import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CustomerDisplayPayload } from '@/features/pos/types/pos-customer-display.types';
import {
  getCustomerDisplayInitialState,
  subscribeCustomerDisplayState,
} from '@/features/pos/lib/pos-customer-display-bridge';
import { buildQrSvg } from '@/lib/qrcode';
import {
  TagIcon,
  AwardIcon,
} from '@/shared/components/icons/AppIcons';
import { useIsolatedDisplayLanguage } from '@/features/pos/hooks/useIsolatedDisplayLanguage';
import { CfdHeader } from '../components/customer-display/CfdHeader';
import { CfdIdleView, type PromotionItem } from '../components/customer-display/CfdIdleView';
import { CfdScanningView } from '../components/customer-display/CfdScanningView';
import { CfdCompletedView } from '../components/customer-display/CfdCompletedView';

/* INV-REST-DISPLAY-ZERO-SHOWROOM (T14-D): the idle rotation is neutral
 * welcome + loyalty only. The old hardcoded showroom promos (showroom
 * offers, InstaPay/cards payment claims, delivery/WhatsApp claims) are
 * gone: none of them is data-driven — the page reads only the live-sale
 * payload — so no invented perk or payment method is shown. The welcome
 * promo is driven by the real storeName from the payload. */
export function buildDefaultPromotions(storeName: string): PromotionItem[] {
  return [
    {
      id: 'promo-welcome',
      title: `أهلاً وسهلاً بكم في ${storeName}`,
      subtitle: 'نسعد بخدمتكم في كل زيارة.',
      badge: 'أهلاً بكم',
      icon: <TagIcon size={26} color="#170e5e" />,
    },
    {
      id: 'promo-loyalty',
      title: 'برنامج ولاء ومكافآت العملاء',
      subtitle: 'اجمع نقاطاً مع كل فاتورة شراء واستبدلها بخصومات مالية فورية على مشترياتك القادمة.',
      badge: 'نقاط ومكافآت',
      icon: <AwardIcon size={26} color="#170e5e" />,
    },
  ];
}

export function CustomerFacingDisplayPage() {
  const { currentLang, toggleLanguage } = useIsolatedDisplayLanguage('cfd_ui_lang');
  const navigate = useNavigate();
  const [payload, setPayload] = useState<CustomerDisplayPayload>(() => {
    return (
      getCustomerDisplayInitialState() || {
        status: 'idle',
        storeName: 'Z-Systems Store',
        items: [],
        subtotal: 0,
        discount: 0,
        tax: 0,
        total: 0,
        itemCount: 0,
        updatedAt: Date.now(),
      }
    );
  });

  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [promoIndex, setPromoIndex] = useState<number>(0);

  // 1. Subscribe to POS real-time updates
  useEffect(() => {
    const unsubscribe = subscribeCustomerDisplayState((nextPayload) => {
      setPayload(nextPayload);
    });
    return () => unsubscribe();
  }, []);

  // 2. Real-time digital clock ticker
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('ar-EG', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
      setCurrentDate(
        now.toLocaleDateString('ar-EG', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const promotions = useMemo(
    () => buildDefaultPromotions(payload.storeName),
    [payload.storeName],
  );

  // 3. Promotional banner rotation for Idle state
  useEffect(() => {
    if (payload.status !== 'idle') return;
    const interval = setInterval(() => {
      setPromoIndex((prev) => (prev + 1) % promotions.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [payload.status, promotions]);

  // 4. Auto-revert completed screen back to idle after 12 seconds
  useEffect(() => {
    if (payload.status !== 'completed') return;
    const timer = setTimeout(() => {
      setPayload((prev) => {
        if (prev.status === 'completed') {
          return { ...prev, status: 'idle', items: [], total: 0 };
        }
        return prev;
      });
    }, 12000);
    return () => clearTimeout(timer);
  }, [payload.status, payload.updatedAt]);

  // Keyboard shortcuts for exiting fullscreen or returning to displays
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' ||
        (e.altKey && e.key === 'Backspace') ||
        (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
      ) {
        if (!document.fullscreenElement) {
          navigate('/displays');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const qrSvg = useMemo(() => {
    if (!payload.payment?.qrData) return '';
    return buildQrSvg(payload.payment.qrData, {
      size: 160,
      quietZone: 1,
      color: '#170e5e',
      bgColor: '#ffffff',
    });
  }, [payload.payment?.qrData]);

  const storefrontUrl = typeof window !== 'undefined' ? `${window.location.origin}/storefront` : '';
  const loyaltyQrSvg = useMemo(() => {
    return buildQrSvg(storefrontUrl || 'https://z-systems.app', {
      size: 140,
      quietZone: 1,
      color: '#170e5e',
      bgColor: '#ffffff',
    });
  }, [storefrontUrl]);

  const latestItemKey = useMemo(() => {
    if (!payload.items || payload.items.length === 0) return null;
    return payload.items[payload.items.length - 1]?.id;
  }, [payload.items]);

  return (
    <div className="cfd-container" dir="rtl">
      <CfdHeader
        currentLang={currentLang}
        onToggleLanguage={toggleLanguage}
        storeName={payload.storeName}
        branchName={payload.branchName}
        currentTime={currentTime}
        currentDate={currentDate}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        onBack={() => navigate('/displays')}
      />

      <main className="cfd-main">
        {payload.status === 'idle' && (
          <CfdIdleView
            storeName={payload.storeName}
            promotions={promotions}
            promoIndex={promoIndex}
            setPromoIndex={setPromoIndex}
            loyaltyQrSvg={loyaltyQrSvg}
          />
        )}

        {(payload.status === 'scanning' || payload.status === 'payment') && (
          <CfdScanningView
            payload={payload}
            latestItemKey={latestItemKey}
            qrSvg={qrSvg}
          />
        )}

        {payload.status === 'completed' && (
          <CfdCompletedView payload={payload} />
        )}
      </main>
    </div>
  );
}

export default CustomerFacingDisplayPage;
