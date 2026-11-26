import type { FeatureRouteModule } from '@/app/router/types';
import { createLazyRoute } from '@/app/router/lazy-route';

export const publicTrialRouteModule: FeatureRouteModule = {
  routes: [
    {
      path: 'trial',
      element: createLazyRoute(() =>
        import('@/features/public-trial/pages/TrialSignupPage').then((module) => ({ default: module.TrialSignupPage })),
      ),
    },
  ],
  navigation: [],
};
