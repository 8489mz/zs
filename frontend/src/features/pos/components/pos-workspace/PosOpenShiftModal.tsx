import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { cashDrawerApi } from '@/lib/api/cash-drawer';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { useAuthStore } from '@/stores/auth-store';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { toast } from '@/shared/components/system-alert';
import { isNetworkOrOfflineError } from '@/features/pos/hooks/usePosSaleMutation';
import { getPosTerminalCode } from '@/features/pos/lib/pos-offline-sync';
import { createOfflineProvisionalShift } from '@/features/pos/lib/pos-offline-vault';
import { isFastOfflineMode } from '@/lib/network-circuit-breaker';
import type { Branch, Location } from '@/types/domain';

export interface PosOpenShiftModalProps {
  open: boolean;
  onClose: () => void;
  branches: Branch[];
  locations: Location[];
  defaultBranchId?: string | number | null;
  defaultLocationId?: string | number | null;
  requirePassword?: boolean;
  onShiftOpened: () => void;
}

interface OpenShiftFormValues {
  openingCash: number;
  branchId: string;
  locationId: string;
  note: string;
  password?: string;
}

export function PosOpenShiftModal(props: PosOpenShiftModalProps) {
  const { t } = useTranslation();
  const { open, onClose, branches, locations, defaultBranchId, defaultLocationId, requirePassword, onShiftOpened } = props;
  const { data: settings } = useSettingsQuery();
  const opener = useAuthStore((state) => state.user);
  const isPasswordRequired = requirePassword ?? Boolean(settings?.requirePasswordOnShiftOpen);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const locationList = Array.isArray(locations) ? locations : [];
  const branchList = Array.isArray(branches) ? branches : [];

  const { register, handleSubmit, setValue, watch, reset } = useForm<OpenShiftFormValues>({
    defaultValues: {
      openingCash: 0,
      branchId: defaultBranchId ? String(defaultBranchId) : '',
      locationId: defaultLocationId ? String(defaultLocationId) : '',
      note: '',
      password: '',
    },
  });

  const watchedBranchId = watch('branchId');
  const watchedLocationId = watch('locationId');

  const availableLocations = useMemo(() => {
    if (!watchedBranchId) return locationList;
    const branchSpecific = locationList.filter((loc) => !loc.branchId || String(loc.branchId) === String(watchedBranchId));
    return branchSpecific.length > 0 ? branchSpecific : locationList;
  }, [locationList, watchedBranchId]);

  const branchOptions = useMemo(() => ([
    { value: '', label: t('pos.pos_workspace.pos_open_shift_modal.s4', 'بدون فرع') },
    ...branchList.map((branch) => ({ value: String(branch.id), label: branch.name })),
  ]), [branchList, t]);

  const locationOptions = useMemo(() => ([
    { value: '', label: t('pos.pos_workspace.pos_open_shift_modal.s8', 'بدون مخزن') },
    ...availableLocations.map((location) => ({ value: String(location.id), label: location.name })),
  ]), [availableLocations, t]);

  useEffect(() => {
    if (open) {
      setError(null);
      setIsSuccess(false);

      const effectiveBranchId = defaultBranchId
        ? String(defaultBranchId)
        : (branchList.length > 0 ? String(branchList[0].id) : '');

      const branchObj = branchList.find(b => String(b.id) === effectiveBranchId);
      const branchLocs = locationList.filter(l => !l.branchId || String(l.branchId) === effectiveBranchId);
      const defaultLoc = (defaultLocationId && locationList.find(l => String(l.id) === String(defaultLocationId)))
        || (branchObj?.defaultStockLocationId && locationList.find(l => String(l.id) === String(branchObj.defaultStockLocationId)))
        || branchLocs.find(l => l.name.includes('الرئيسي') || l.name.toLowerCase().includes('main'))
        || branchLocs[0]
        || locationList[0];

      reset({
        openingCash: 0,
        branchId: effectiveBranchId,
        locationId: defaultLoc?.id ? String(defaultLoc.id) : '',
        note: '',
        password: '',
      });
    }
  }, [open, defaultBranchId, defaultLocationId, branchList, locationList, reset]);

  const handleBranchChange = (nextBranchId: string) => {
    setValue('branchId', nextBranchId);
    const branchObj = branchList.find((b) => String(b.id) === String(nextBranchId));
    const nextLocs = locationList.filter((l) => !l.branchId || String(l.branchId) === String(nextBranchId));
    const nextDefaultLoc = (branchObj?.defaultStockLocationId && locationList.find((l) => String(l.id) === String(branchObj.defaultStockLocationId)))
      || nextLocs.find((l) => l.name.includes(t('pos.pos_workspace.pos_open_shift_modal.s3', 'الرئيسي')) || l.name.toLowerCase().includes('main'))
      || nextLocs[0]
      || locationList[0];
    if (nextDefaultLoc?.id) {
      setValue('locationId', String(nextDefaultLoc.id));
    }
  };

  const onSubmit = async (values: OpenShiftFormValues) => {
    setIsPending(true);
    setError(null);
    const terminalCode = getPosTerminalCode();
    const openingCash = Number(values.openingCash || 0);
    const branchId = values.branchId ? Number(values.branchId) : null;
    const locationId = values.locationId ? Number(values.locationId) : null;
    const note = String(values.note || '').trim();
    const password = isPasswordRequired && values.password ? String(values.password).trim() : undefined;

    const openProvisionalOffline = () => {
      createOfflineProvisionalShift({
        openingCash,
        branchId,
        locationId,
        note,
        terminalCode,
        password,
      });
      toast.info('تم فتح وردية أوفلاين مؤقتة — يمكنك البيع الآن وستُزامن الوردية تلقائياً فور عودة الإنترنت.');
      setIsSuccess(true);
      setTimeout(() => {
        onShiftOpened();
        onClose();
      }, 350);
    };

    try {
      if (isFastOfflineMode()) {
        openProvisionalOffline();
        return;
      }
      await cashDrawerApi.open({
        openingCash,
        branchId,
        locationId,
        note,
        terminalCode,
        password,
      });
      setIsSuccess(true);
      setTimeout(() => {
        onShiftOpened();
        onClose();
      }, 500);
    } catch (err) {
      if (isNetworkOrOfflineError(err)) {
        try {
          openProvisionalOffline();
          return;
        } catch (vaultErr) {
          setError(vaultErr);
          return;
        }
      }
      setError(err);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={() => { if (!isPending) onClose(); }}
      title={t('pos.pos_workspace.pos_open_shift_modal.s0', 'فتح وردية نقطة بيع')}
      subtitle="تأكيد رصيد الافتتاح والفرع والمخزن قبل بدء البيع."
      width="min(580px, 95vw)"
      compact
      closeOnBackdrop={!isPending}
      bodyStyle={{ overflow: 'visible', display: 'flex', flexDirection: 'column', gap: '12px' }}
      footerActions={(
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>
            إلغاء
          </Button>
          <Button type="submit" form="pos-open-shift-form" variant="primary" disabled={isPending}>
            {isPending
              ? t('pos.pos_workspace.pos_open_shift_modal.s13', 'جارٍ الفتح...')
              : t('pos.pos_workspace.pos_open_shift_modal.s12', 'فتح وردية نقطة البيع')}
          </Button>
        </>
      )}
    >
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
          data-testid="shift-opener-identity"
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '9px 12px',
            fontSize: '0.84rem',
            color: '#334155',
            fontWeight: 600,
          }}
        >
          {t('pos.pos_workspace.pos_open_shift_modal.opener_label', 'سيتم فتح الوردية باسم:')}{' '}
          <strong style={{ color: '#0f172a', fontWeight: 800 }}>
            {opener?.displayName || opener?.username || ''}
          </strong>
          {opener?.username ? ` (${opener.username})` : ''}
        </div>

        <form id="pos-open-shift-form" onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: SINGLE_STORE_MODE ? '1fr 1fr' : '1fr 1fr', gap: '10px' }}>
            <Field label={t('pos.pos_workspace.pos_open_shift_modal.s1', 'رصيد الفتح')}>
              <input
                type="number"
                className="no-spin-arrows"
                step="0.01"
                min="0"
                autoFocus
                onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                onFocus={(e) => e.currentTarget.select()}
                {...register('openingCash', { valueAsNumber: true })}
                disabled={isPending}
                style={{
                  width: '100%',
                  height: '36px',
                  boxSizing: 'border-box',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  padding: '0 10px',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  background: '#ffffff',
                }}
              />
            </Field>

            {SINGLE_STORE_MODE ? (
              <Field label={t('pos.pos_workspace.pos_open_shift_modal.s5', 'المخزن الأساسي')}>
                <input
                  value={locationList[0]?.name || t('pos.pos_workspace.pos_open_shift_modal.s6', 'سيتم الربط تلقائيًا بالمخزن الأساسي')}
                  disabled
                  readOnly
                  style={{
                    width: '100%',
                    height: '36px',
                    boxSizing: 'border-box',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    padding: '0 10px',
                    fontSize: '13px',
                    fontWeight: 600,
                    background: '#f8fafc',
                    color: '#475569',
                  }}
                />
              </Field>
            ) : (
              <Field label={t('pos.pos_workspace.pos_open_shift_modal.s2', 'الفرع')}>
                <CustomSelect
                  value={watchedBranchId || ''}
                  onChange={handleBranchChange}
                  options={branchOptions}
                  searchable={false}
                  disabled={isPending}
                  style={{ width: '100%' }}
                />
              </Field>
            )}
          </div>

          {!SINGLE_STORE_MODE && (
            <div style={{ display: 'grid', gridTemplateColumns: isPasswordRequired ? '1fr 1fr' : '1fr', gap: '10px' }}>
              <Field label={t('pos.pos_workspace.pos_open_shift_modal.s7', 'المخزن')}>
                <CustomSelect
                  value={watchedLocationId || ''}
                  onChange={(val) => setValue('locationId', val)}
                  options={locationOptions}
                  searchable={false}
                  disabled={isPending}
                  style={{ width: '100%' }}
                />
              </Field>

              {isPasswordRequired && (
                <Field label={t('pos.pos_workspace.pos_open_shift_modal.password_label', 'كلمة مرور المستخدم الحالي (تأكيد الفتح)')}>
                  <input
                    type="text"
                    className="secure-password-field"
                    placeholder={t('pos.pos_workspace.pos_open_shift_modal.password_placeholder', 'أدخل كلمة المرور لتأكيد فتح الوردية')}
                    required
                    {...register('password', { required: true })}
                    disabled={isPending}
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    style={{
                      width: '100%',
                      height: '36px',
                      boxSizing: 'border-box',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      padding: '0 10px',
                      fontSize: '13px',
                      fontWeight: 700,
                      background: '#ffffff',
                    }}
                  />
                </Field>
              )}
            </div>
          )}

          {SINGLE_STORE_MODE && isPasswordRequired && (
            <Field label={t('pos.pos_workspace.pos_open_shift_modal.password_label', 'كلمة مرور المستخدم الحالي (تأكيد الفتح)')}>
              <input
                type="text"
                className="secure-password-field"
                placeholder={t('pos.pos_workspace.pos_open_shift_modal.password_placeholder', 'أدخل كلمة المرور لتأكيد فتح الوردية')}
                required
                {...register('password', { required: true })}
                disabled={isPending}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                style={{
                  width: '100%',
                  height: '36px',
                  boxSizing: 'border-box',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  padding: '0 10px',
                  fontSize: '13px',
                  fontWeight: 700,
                  background: '#ffffff',
                }}
              />
            </Field>
          )}

          <Field label={t('pos.pos_workspace.pos_open_shift_modal.s9', 'ملاحظة الافتتاح')}>
            <textarea
              rows={2}
              {...register('note')}
              disabled={isPending}
              placeholder="ملاحظات اختيارية حول عهدة الافتتاح..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                padding: '8px 10px',
                fontSize: '13px',
                resize: 'vertical',
                background: '#ffffff',
              }}
            />
          </Field>

          <MutationFeedback
            isError={Boolean(error)}
            isSuccess={isSuccess}
            error={error}
            errorFallback={t('pos.pos_workspace.pos_open_shift_modal.s10', 'تعذر فتح وردية نقطة البيع')}
            successText={t('pos.pos_workspace.pos_open_shift_modal.s11', 'تم فتح وردية نقطة البيع بنجاح.')}
          />
        </form>
      </div>
    </StandardDialog>
  );
}
