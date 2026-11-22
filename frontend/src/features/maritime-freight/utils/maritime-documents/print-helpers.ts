import { buildQrSvg } from '@/lib/qrcode';

export function escapeHtml(str?: string | number | null): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getTrackingQrCode(trackingRef?: string | null, size = 70): string {
  if (!trackingRef || !String(trackingRef).trim()) return '';
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://app.z-systems.com';
  const trackingUrl = `${baseUrl}/public/track/${encodeURIComponent(String(trackingRef).trim())}`;
  return buildQrSvg(trackingUrl, { size, quietZone: 1, color: '#170e5e', bgColor: '#ffffff' });
}
