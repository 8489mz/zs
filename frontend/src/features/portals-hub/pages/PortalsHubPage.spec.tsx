import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { buildStorePublicUrl } from '@/lib/store-public-url';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthTenant } from '@/types/auth';
import { PortalsHubPage } from './PortalsHubPage';
import { PORTALS_LIST, resolvePortalDestination } from '../components/portals-data';
import { PortalQrModal } from '../components/PortalQrModal';

afterEach(() => {
  // The hub may still be mounted here (RTL cleanup runs after this hook),
  // so reset the store inside act to avoid an act() warning.
  act(() => {
    useAuthStore.setState({ tenant: null });
  });
});

function tenantWithSlug(slug: string): AuthTenant {
  return {
    id: 'tenant-1',
    accountId: 'account-1',
    slug,
    businessName: 'Test Store',
    status: 'active',
    isTrial: false,
    trialEndsAt: null,
    trialDaysRemaining: null,
  };
}

function renderHub() {
  return render(
    <MemoryRouter initialEntries={['/hub']}>
      <PortalsHubPage />
    </MemoryRouter>
  );
}

function searchInput() {
  return screen.getByPlaceholderText(/ابحث عن بوابة/i);
}

describe('PortalsHubPage Component & Layout', () => {
  it('renders the header and every portal in the catalogue by default', () => {
    renderHub();

    expect(screen.getByText('مركز البوابات الرقمية وشاشات الخدمة الذاتية')).toBeInTheDocument();

    // Driven off the data file so adding a portal cannot silently skip this assertion.
    for (const portal of PORTALS_LIST) {
      expect(screen.getByText(portal.title)).toBeInTheDocument();
    }
  });

  it('keeps the "all" pill count in step with the catalogue', () => {
    renderHub();
    expect(screen.getByRole('button', { name: `الكل (${PORTALS_LIST.length})` })).toBeInTheDocument();
  });

  it('filters portals when clicking a category pill', async () => {
    const user = userEvent.setup();
    renderHub();

    await user.click(screen.getByRole('button', { name: 'خدمة ذاتية' }));

    for (const portal of PORTALS_LIST) {
      if (portal.category === 'staff') {
        expect(screen.getByText(portal.title)).toBeInTheDocument();
      } else {
        expect(screen.queryByText(portal.title)).not.toBeInTheDocument();
      }
    }
  });

  it('performs live search across keywords and restores the list when cleared', async () => {
    const user = userEvent.setup();
    renderHub();

    // 'طيار' only appears in the delivery portal's keywords.
    await user.type(searchInput(), 'طيار');
    expect(screen.getByText('بوابة مندوبي التوصيل')).toBeInTheDocument();
    expect(screen.queryByText('بوابة الموظف الذاتية')).not.toBeInTheDocument();

    await user.clear(searchInput());
    expect(screen.getByText('بوابة الموظف الذاتية')).toBeInTheDocument();
    expect(screen.getByText('شاشة المطبخ (KDS)')).toBeInTheDocument();
  });
});

/* INV-HUB-DEAD-END: the storefront card linked to the bare `/store`, which
 * matches no route, so opening it landed on the NotFound page. These tests
 * pin the resolved destination of every hub card to a route that exists.
 *
 * HUB_ROUTE_PATTERNS is the pinned copy of the routes the hub may point at:
 * the public storefront routes and the in-app routes in
 * `frontend/src/app/router/root-router.tsx`, plus the feature-module routes
 * in `frontend/src/app/router/registry.ts` (`contracting/*` and
 * `owner-companion`). Keep it in step with the router when adding a portal.
 */
const HUB_ROUTE_PATTERNS = [
  '/', // store-host root: a subdomain public store URL resolves here
  '/portal',
  '/punch',
  '/track',
  '/freight-portal',
  '/portal/carrier-quote/:rfqId',
  '/contracting/*',
  '/driver',
  '/van-sales',
  '/kds',
  '/pos/customer-display',
  '/signage',
  '/table/:tableNo',
  '/owner-companion',
  '/store/:slug',
  '/st/:slug',
  '/shop/:slug',
];

function matchesRoutePattern(pattern: string, pathname: string): boolean {
  if (pattern === '/') return pathname === '/';
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (pattern.endsWith('/*')) {
    if (pathParts.length < patternParts.length - 1) return false;
  } else if (patternParts.length !== pathParts.length) {
    return false;
  }
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part === '*') return true;
    if (part.startsWith(':')) continue;
    if (part !== pathParts[i]) return false;
  }
  return true;
}

function destinationPathname(destination: string): string {
  try {
    return new URL(destination, 'http://localhost').pathname;
  } catch {
    return destination;
  }
}

describe('hub destinations resolve to real routes (INV-HUB-DEAD-END)', () => {
  it('resolves the storefront card to the tenant public store URL, never the bare /store', () => {
    const storefront = PORTALS_LIST.find((portal) => portal.id === 'storefront')!;
    expect(resolvePortalDestination(storefront, 'almhnds')).toBe(buildStorePublicUrl('almhnds'));
    expect(resolvePortalDestination(storefront, 'almhnds')).not.toBe('/store');
  });

  it('falls back to the shared /st/store destination when no tenant slug is known', () => {
    const storefront = PORTALS_LIST.find((portal) => portal.id === 'storefront')!;
    expect(resolvePortalDestination(storefront, null)).toBe(buildStorePublicUrl('store'));
    expect(resolvePortalDestination(storefront, '')).toBe(buildStorePublicUrl('store'));
    expect(destinationPathname(resolvePortalDestination(storefront, undefined))).toBe('/st/store');
  });

  it('leaves every other portal on its own in-app path', () => {
    for (const portal of PORTALS_LIST) {
      if (portal.id === 'storefront') continue;
      expect(resolvePortalDestination(portal, 'almhnds')).toBe(portal.path);
    }
  });

  it('every resolved hub destination matches an existing route pattern', () => {
    for (const portal of PORTALS_LIST) {
      const destination = resolvePortalDestination(portal, 'almhnds');
      const pathname = destinationPathname(destination);
      expect(
        HUB_ROUTE_PATTERNS.some((pattern) => matchesRoutePattern(pattern, pathname)),
        `${portal.id} resolves to ${destination}, which matches no route`,
      ).toBe(true);
    }
  });

  it('renders the storefront card at the tenant public store URL once the tenant is known', () => {
    act(() => {
      useAuthStore.setState({ tenant: tenantWithSlug('almhnds') });
    });
    renderHub();

    const storeUrl = buildStorePublicUrl('almhnds');
    expect(screen.getByText(storeUrl)).toBeInTheDocument();
    const openLinks = screen.getAllByRole('link', { name: 'فتح' });
    expect(openLinks.some((link) => link.getAttribute('href') === storeUrl)).toBe(true);
    expect(openLinks.some((link) => link.getAttribute('href') === '/store')).toBe(false);
  });

  it('renders no dead /store link when no tenant slug is known', () => {
    renderHub();

    expect(screen.getByText(buildStorePublicUrl('store'))).toBeInTheDocument();
    const openLinks = screen.getAllByRole('link', { name: 'فتح' });
    expect(openLinks.some((link) => link.getAttribute('href') === '/store')).toBe(false);
  });

  it('shows the absolute store URL in the QR modal without prepending the app origin', () => {
    const storefront = PORTALS_LIST.find((portal) => portal.id === 'storefront')!;
    render(
      <PortalQrModal
        portal={{ ...storefront, path: 'https://almhnds.zsystemai.com' }}
        onClose={() => undefined}
        copied={false}
        onCopy={() => undefined}
      />,
    );

    expect(screen.getByText('https://almhnds.zsystemai.com')).toBeInTheDocument();
    expect(screen.queryByText(/http:\/\/localhost:3000https:\/\//)).not.toBeInTheDocument();
  });
});
