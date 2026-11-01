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
}
