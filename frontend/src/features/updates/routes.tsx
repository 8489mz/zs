import { createLazyRoute } from '@/app/router/lazy-route';
import type { FeatureRouteModule } from '@/app/router/types';

export const updatesRouteModule: FeatureRouteModule = {
  routes: [{ path: 'updates', element: createLazyRoute(() => import('@/features/updates/pages/UpdatesPage').then((module) => ({ default: module.UpdatesPage }))) }],
  navigation: [{ key: 'updates', label: 'التحديثات', to: '/updates' }],
};
