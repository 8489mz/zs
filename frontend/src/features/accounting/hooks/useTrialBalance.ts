/* Trial balance data hook (INV-TRIAL-BALANCE-PAGE): page files must go
 * through feature hooks instead of calling the api layer or React Query
 * directly (page-composition guard). The query key and fetcher are the
 * same ones the page used before the extraction, so caching behaviour is
 * unchanged.
 */
import { useQuery } from '@tanstack/react-query';
import { financialReportsApi, type TrialBalanceReportData } from '../api/accounting.api';

export type { TrialBalanceReportData };

export function useTrialBalance(asOfDate: string) {
  return useQuery({
    queryKey: ['trial-balance', asOfDate],
    queryFn: () => financialReportsApi.trialBalance({ asOfDate }),
  });
}
