import type { FeatureRouteModule } from '@/app/router/types';
import { createLazyRoute } from '@/app/router/lazy-route';

export const portalsHubRouteModule: FeatureRouteModule = {
  routes: [
    {
      path: 'hub',
      element: createLazyRoute(() =>
        import('@/features/portals-hub/pages/PortalsHubPage').then((module) => ({ default: module.PortalsHubPage })),
      ),
    },
  ],
  navigation: [],
};
