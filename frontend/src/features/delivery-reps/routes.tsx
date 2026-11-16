import { lazy } from 'react';
import type { FeatureRouteModule } from '@/app/router/types';

const DeliveryRepsPage = lazy(() => import('./pages/DeliveryRepsPage'));
const DeliveryDriverMobilePage = lazy(() =>
  import('./pages/DeliveryDriverMobilePage').then((m) => ({ default: m.DeliveryDriverMobilePage }))
);
const VanSalesMobilePage = lazy(() => import('./pages/VanSalesMobilePage'));
const VanSalesAdminManagementPage = lazy(() => import('./pages/VanSalesAdminManagementPage'));

export const deliveryRepsRoutes: FeatureRouteModule = {
  routes: [
    {
      path: 'delivery-reps',
      element: <DeliveryRepsPage />,
    },
    {
      path: 'driver-mobile',
      element: <DeliveryDriverMobilePage />,
    },
    {
      path: 'van-sales/mobile',
      element: <VanSalesMobilePage />,
    },
    {
      path: 'mobile/van-sales',
      element: <VanSalesMobilePage />,
    },
    {
      path: 'van-sales/admin',
      element: <VanSalesAdminManagementPage />,
    },
    {
      path: 'van-sales/management',
      element: <VanSalesAdminManagementPage />,
    },
    {
      path: 'inventory/van-sales',
      element: <VanSalesAdminManagementPage />,
    },
  ],
  navigation: [
    {
      key: 'delivery-reps',
      label: 'إدارة المناديب',
      to: '/delivery-reps',
      keywords: ['مندوب', 'المناديب', 'مناديب التوصيل', 'توصيل', 'دليفري', 'تسوية', 'عهدة', 'كباتن'],
    },
    { key: 'driver-mobile', label: 'شاشة المندوب', to: '/driver-mobile' },
    { key: 'van-sales-mobile', label: 'البيع الميداني (موبايل)', to: '/van-sales/mobile' },
    { key: 'van-sales-admin', label: 'سيارات التوزيع (الفان)', to: '/inventory/van-sales' },
  ]
};

