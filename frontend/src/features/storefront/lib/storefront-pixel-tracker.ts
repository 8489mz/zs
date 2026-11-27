// Safe, asynchronous, non-blocking marketing pixel tracking hub
// Supports Meta (Facebook) Pixel, Google Analytics 4, TikTok Pixel, and Snapchat Pixel

declare global {
  interface Window {
    fbq?: any;
    _fbq?: any;
    gtag?: any;
    dataLayer?: any[];
    ttq?: any;
    snaptr?: any;
    _storefrontPixelsInitialized?: boolean;
  }
}

export interface PixelConfig {
  metaPixelId?: string;
  ga4Id?: string;
  tiktokPixelId?: string;
  snapchatPixelId?: string;
}

export function initStorefrontPixels(config: PixelConfig) {
  if (typeof window === 'undefined') return;

  // 1. Meta (Facebook) Pixel
  if (config.metaPixelId && config.metaPixelId.trim()) {
    const pixelId = config.metaPixelId.trim();
    if (!window.fbq) {
      const n: any = (window.fbq = function () {
        // eslint-disable-next-line prefer-rest-params
        if (n.callMethod) n.callMethod(...arguments); else n.queue.push(arguments);
      });
      if (!window._fbq) window._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      const t = document.createElement('script');
      t.async = true;
      t.src = 'https://connect.facebook.net/en_US/fbevents.js';
      const s = document.getElementsByTagName('script')[0];
      s?.parentNode?.insertBefore(t, s);
    }
    try {
      window.fbq('init', pixelId);
      window.fbq('track', 'PageView');
    } catch {}
  }

  // 2. Google Analytics 4 (GA4)
  if (config.ga4Id && config.ga4Id.trim()) {
    const gaId = config.ga4Id.trim();
    if (!document.getElementById('ga4-script')) {
      const s = document.createElement('script');
      s.id = 'ga4-script';
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
      document.head.appendChild(s);

      window.dataLayer = window.dataLayer || [];
      window.gtag = function () {
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer?.push(arguments);
      };
      window.gtag('js', new Date());
      window.gtag('config', gaId);
    }
  }

  // 3. TikTok Pixel
  if (config.tiktokPixelId && config.tiktokPixelId.trim()) {
    const ttId = config.tiktokPixelId.trim();
    if (!window.ttq) {
      const ttq: any = (window.ttq = []);
      ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'];
      ttq.setAndDefer = function (t: any, e: any) {
        t[e] = function () {
          // eslint-disable-next-line prefer-rest-params
          t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
        };
      };
      for (let i = 0; i < ttq.methods.length; i++) {
        ttq.setAndDefer(ttq, ttq.methods[i]);
      }
      const scr = document.createElement('script');
      scr.async = true;
      scr.src = 'https://analytics.tiktok.com/i18n/pixel/events.js';
      document.head.appendChild(scr);
    }
    try {
      window.ttq.load(ttId);
      window.ttq.page();
    } catch {}
  }

  // 4. Snapchat Pixel
  if (config.snapchatPixelId && config.snapchatPixelId.trim()) {
    const snapId = config.snapchatPixelId.trim();
    if (!window.snaptr) {
      const tr: any = (window.snaptr = function () {
        // eslint-disable-next-line prefer-rest-params
        if (tr.handleRequest) tr.handleRequest(...arguments); else tr.queue.push(arguments);
      });
      tr.queue = [];
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://sc-static.net/scevent.min.js';
      document.head.appendChild(s);
    }
    try {
      window.snaptr('init', snapId);
      window.snaptr('track', 'PAGE_VIEW');
    } catch {}
  }
}

export function trackStorefrontEvent(
  eventName: 'PageView' | 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase',
  data?: {
    contentName?: string;
    contentId?: string | number;
    value?: number;
    currency?: string;
    numItems?: number;
    orderNumber?: string;
  }
) {
  if (typeof window === 'undefined') return;

  const value = data?.value || 0;
  const currency = data?.currency || 'EGP';

  // Meta (Facebook)
  if (window.fbq) {
    try {
      if (eventName === 'PageView') {
        window.fbq('track', 'PageView');
      } else if (eventName === 'ViewContent') {
        window.fbq('track', 'ViewContent', {
          content_name: data?.contentName,
          content_ids: data?.contentId ? [String(data.contentId)] : [],
          content_type: 'product',
          value,
          currency,
        });
      } else if (eventName === 'AddToCart') {
        window.fbq('track', 'AddToCart', {
          content_name: data?.contentName,
          content_ids: data?.contentId ? [String(data.contentId)] : [],
          content_type: 'product',
          value,
          currency,
        });
      } else if (eventName === 'InitiateCheckout') {
        window.fbq('track', 'InitiateCheckout', {
          value,
          currency,
          num_items: data?.numItems || 1,
        });
      } else if (eventName === 'Purchase') {
        window.fbq('track', 'Purchase', {
          value,
          currency,
          num_items: data?.numItems || 1,
        });
      }
    } catch {}
  }

  // GA4
  if (window.gtag) {
    try {
      if (eventName === 'ViewContent') {
        window.gtag('event', 'view_item', {
          items: [{ item_name: data?.contentName, item_id: data?.contentId, price: value }],
          currency,
          value,
        });
      } else if (eventName === 'AddToCart') {
        window.gtag('event', 'add_to_cart', {
          items: [{ item_name: data?.contentName, item_id: data?.contentId, price: value }],
          currency,
          value,
        });
      } else if (eventName === 'InitiateCheckout') {
        window.gtag('event', 'begin_checkout', { currency, value });
      } else if (eventName === 'Purchase') {
        window.gtag('event', 'purchase', {
          transaction_id: data?.orderNumber,
          value,
          currency,
        });
      }
    } catch {}
  }

  // TikTok
  if (window.ttq) {
    try {
      if (eventName === 'ViewContent') {
        window.ttq.track('ViewContent', { content_name: data?.contentName, content_id: String(data?.contentId), value, currency });
      } else if (eventName === 'AddToCart') {
        window.ttq.track('AddToCart', { content_name: data?.contentName, content_id: String(data?.contentId), value, currency });
      } else if (eventName === 'InitiateCheckout') {
        window.ttq.track('InitiateCheckout', { value, currency });
      } else if (eventName === 'Purchase') {
        window.ttq.track('CompletePayment', { value, currency });
      }
    } catch {}
  }

  // Snapchat
  if (window.snaptr) {
    try {
      if (eventName === 'ViewContent') {
        window.snaptr('track', 'VIEW_CONTENT', { item_ids: [String(data?.contentId)], price: value, currency });
      } else if (eventName === 'AddToCart') {
        window.snaptr('track', 'ADD_CART', { item_ids: [String(data?.contentId)], price: value, currency });
      } else if (eventName === 'InitiateCheckout') {
        window.snaptr('track', 'START_CHECKOUT', { price: value, currency });
      } else if (eventName === 'Purchase') {
        window.snaptr('track', 'PURCHASE', { price: value, currency, transaction_id: data?.orderNumber });
      }
    } catch {}
  }
}
