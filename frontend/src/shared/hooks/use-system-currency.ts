import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrencySymbol, getCurrencyDecimals, getGlobalSystemCurrency, CurrencyCode } from '@/lib/currencies';

export function useSystemCurrency(overrideCurrency?: string | null) {
  useTranslation();
  const rawCode =
    overrideCurrency ||
    getGlobalSystemCurrency() ||
    'EGP';
  const currencyCode = String(rawCode).trim().toUpperCase() as CurrencyCode;
  const currencySymbol = getCurrencySymbol(currencyCode);
  const decimals = getCurrencyDecimals(currencyCode);

  // INV-CRM-OPPORTUNITY-FORM-RESET: the returned object (and its closures)
  // must keep a stable identity across re-renders. Returning a fresh object
  // on every render made every consumer's useMemo/useEffect that depended on
  // it recompute/re-run on every render -- in CrmDealCreateModal that reset
  // the form to empty while the user was typing, so no opportunity could
  // ever be created. Identity changes only when the currency itself changes.
  return useMemo(() => {
    const formatNumber = (val: number | string | undefined | null): string => {
      const num = Number(val || 0);
      return num.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    };

    const formatCurrency = (val: number | string | undefined | null): string => {
      return `${formatNumber(val)} ${currencySymbol}`;
    };

    return {
      currencyCode,
      currencySymbol,
      decimals,
      formatNumber,
      formatCurrency,
    };
  }, [currencyCode, currencySymbol, decimals]);
}
