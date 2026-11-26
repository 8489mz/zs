import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { demoDataApi, type SeedDemoDataResult } from '@/features/settings/api/demo-data.api';
import { clearCatalogStorage, clearPosWorkspaceStorage } from '@/features/pos';
import { useAuthStore } from '@/stores/auth-store';
import { isPlatformAdmin } from '@/shared/system/runtime-environment';
import { SettingsDemoDataWizardQuickstart } from './settings-demo-data-wizard-section/settings-demo-data-wizard-quickstart';
import { SettingsDemoDataWizardHero } from './settings-demo-data-wizard-section/settings-demo-data-wizard-hero';
import { SettingsDemoDataWizardNotification } from './settings-demo-data-wizard-section/settings-demo-data-wizard-notification';
import { SettingsDemoDataWizardActivityGrid } from './settings-demo-data-wizard-section/settings-demo-data-wizard-activity-grid';
import { SettingsDemoDataWizardConfig } from './settings-demo-data-wizard-section/settings-demo-data-wizard-config';
import { SettingsDemoDataWizardWipeZone } from './settings-demo-data-wizard-section/settings-demo-data-wizard-wipe-zone';
import { SettingsDemoDataWizardLoading } from './settings-demo-data-wizard-section/settings-demo-data-wizard-loading';
import { SettingsDemoDataWizardPasswordModal } from './settings-demo-data-wizard-section/settings-demo-data-wizard-password-modal';
import { SettingsDemoDataWizardClearModal } from './settings-demo-data-wizard-section/settings-demo-data-wizard-clear-modal';
import { SettingsDemoDataWizardSuccessDialog } from './settings-demo-data-wizard-section/settings-demo-data-wizard-success-dialog';


export function SettingsDemoDataWizardSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isQuickStart = searchParams.get('setup') === 'quickstart' || searchParams.get('setup') === '1';
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isPlatform = isPlatformAdmin(user);

  // State
  const [selectedActivityKey, setSelectedActivityKey] = useState<string>('supermarket');
  const [wipeExisting, setWipeExisting] = useState<boolean>(isPlatform);
  const [seedSales, setSeedSales] = useState<boolean>(true);
  const [seedOnlineOrders, setSeedOnlineOrders] = useState<boolean>(true);
  const [password, setPassword] = useState<string>('');
  const [showPasswordModal, setShowPasswordModal] = useState<boolean>(false);
  const [showClearModal, setShowClearModal] = useState<boolean>(false);
  const [clearPassword, setClearPassword] = useState<string>('');
  const [successResult, setSuccessResult] = useState<SeedDemoDataResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // Queries
  const statusQuery = useQuery({
    queryKey: ['demo-data', 'status'],
    queryFn: () => demoDataApi.getStatus(),
    staleTime: 10_000,
  });

  const activitiesQuery = useQuery({
    queryKey: ['demo-data', 'activities'],
    queryFn: () => demoDataApi.getActivities(),
    staleTime: 60_000,
  });

  const status = statusQuery.data;
  const activities = Array.isArray(activitiesQuery.data) ? activitiesQuery.data : [];
  const selectedActivity = activities.find((a) => a.key === selectedActivityKey) || activities[0];

  // Seed Mutation
  const seedMutation = useMutation({
    mutationFn: async (vars: { activityType: string; pass: string }) => {
      return demoDataApi.seedDemoData({
        activityType: vars.activityType,
        password: vars.pass,
        wipeExisting,
        seedSales,
        seedOnlineOrders,
      });
    },
    onSuccess: (data) => {
      setShowPasswordModal(false);
      setPassword('');
      setErrorMessage(null);
      setSuccessResult(data);
      queryClient.invalidateQueries({ queryKey: ['demo-data'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: (err: any) => {
      setErrorMessage(err?.message || 'حدث خطأ أثناء استيراد البيانات التجريبية. يرجى التحقق من كلمة المرور.');
    },
  });

  // Clear Mutation (clean demo wipe)
  const clearMutation = useMutation({
    mutationFn: async (pass: string) => {
      return demoDataApi.clearDemoData(pass);
    },
    onSuccess: (data) => {
      setShowClearModal(false);
      setClearPassword('');
      setNotification({ kind: 'success', message: data.message });
      clearPosWorkspaceStorage();
      void clearCatalogStorage();
      queryClient.invalidateQueries({ queryKey: ['demo-data'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
    },
    onError: (err: any) => {
      setNotification({ kind: 'error', message: err?.message || 'فشل تفريغ البيانات التجريبية.' });
    },
  });

  // Handle Main Start Action
  const handleStartSeed = () => {
    setErrorMessage(null);
    if (!isPlatform && status && !status.isEmpty) {
      setErrorMessage('المتجر يحتوي على بيانات نشطة بالفعل. لتصفير المتجر والبدء الفعلي، يرجى مراجعة إدارة المنصة (السوبر أدمن).');
      return;
    }
    // If database is not empty and user requested wiping existing data, we must ask for password
    if (status && !status.isEmpty && wipeExisting) {
      setShowPasswordModal(true);
    } else {
      // Direct execution without password for empty DB or append mode
      seedMutation.mutate({ activityType: selectedActivityKey, pass: '' });
    }
  };

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
      <SettingsDemoDataWizardQuickstart
        isQuickStart={isQuickStart}
        t={t}
        navigate={navigate}
      />

      <SettingsDemoDataWizardHero
        t={t}
        statusQuery={statusQuery}
        status={status}
      />

      <SettingsDemoDataWizardNotification
        notification={notification}
        setNotification={setNotification}
      />

      <SettingsDemoDataWizardActivityGrid
        t={t}
        activitiesQuery={activitiesQuery}
        activities={activities}
        selectedActivityKey={selectedActivityKey}
        setSelectedActivityKey={setSelectedActivityKey}
      />

      <SettingsDemoDataWizardConfig
        t={t}
        isPlatform={isPlatform}
        wipeExisting={wipeExisting}
        setWipeExisting={setWipeExisting}
        seedSales={seedSales}
        setSeedSales={setSeedSales}
        seedOnlineOrders={seedOnlineOrders}
        setSeedOnlineOrders={setSeedOnlineOrders}
        status={status}
        selectedActivity={selectedActivity}
        selectedActivityKey={selectedActivityKey}
        seedMutation={seedMutation}
        handleStartSeed={handleStartSeed}
        errorMessage={errorMessage}
      />

      <SettingsDemoDataWizardWipeZone
        isPlatform={isPlatform}
        t={t}
        setShowClearModal={setShowClearModal}
      />

      <SettingsDemoDataWizardLoading
        seedMutation={seedMutation}
        t={t}
        selectedActivity={selectedActivity}
        selectedActivityKey={selectedActivityKey}
      />

      <SettingsDemoDataWizardPasswordModal
        showPasswordModal={showPasswordModal}
        setShowPasswordModal={setShowPasswordModal}
        setPassword={setPassword}
        setErrorMessage={setErrorMessage}
        t={t}
        selectedActivity={selectedActivity}
        password={password}
        seedMutation={seedMutation}
        selectedActivityKey={selectedActivityKey}
        errorMessage={errorMessage}
      />

      <SettingsDemoDataWizardClearModal
        isPlatform={isPlatform}
        showClearModal={showClearModal}
        setShowClearModal={setShowClearModal}
        setClearPassword={setClearPassword}
        t={t}
        clearPassword={clearPassword}
        clearMutation={clearMutation}
      />

      <SettingsDemoDataWizardSuccessDialog
        successResult={successResult}
        setSuccessResult={setSuccessResult}
        t={t}
        selectedActivity={selectedActivity}
        navigate={navigate}
      />
    </div>
  );
}
