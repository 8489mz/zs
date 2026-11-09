import type { ReactNode } from 'react';

export interface AppRouteDefinition {
  index?: boolean;
  path?: string;
  element: ReactNode;
}

export interface NavigationItemDefinition {
  key: string;
  label: string;
  to: string;
  end?: boolean;
  platformOnly?: boolean;
  activePaths?: string[];
  // INV-IMPORT-FX-RATE-REGISTRATION (I9-E): extra search terms the
  // global search and the sidebar search match against, in addition
  // to the label. A screen's label rarely contains every word a user
  // searches for ("سعر الصرف" vs the forex label "تقييم العملات
  // وفروق الصرف") — without keywords the screen is unfindable even
  // though it exists. Keywords are search-only; they never render.
  keywords?: string[];
}

export interface FeatureRouteModule {
  routes: AppRouteDefinition[];
  navigation?: NavigationItemDefinition[];
}
