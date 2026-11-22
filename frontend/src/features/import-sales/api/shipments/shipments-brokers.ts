import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { todayLocalDateKey } from '@/lib/format';

export interface CustomsBroker {
  id: string;
  name: string;
  license_no?: string;
  license_number?: string;
  port_name?: string;
  phone?: string;
  customs_ports?: string[];
  is_active?: boolean;
  total_advances_egp?: number;
  total_liquidated_egp?: number;
  unliquidated_balance_egp?: number;
  current_balance_egp?: number;
  created_at?: string;
}

export const useCustomsBrokersQuery = () => {
  return useQuery({
    queryKey: ['customs-brokers'],
    queryFn: async () => {
      const data = await http<CustomsBroker[]>('/api/import-sales/customs-brokers');
      return data;
    },
  });
};

export const useCreateCustomsBrokerMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        name: dto.name,
        licenseNo: dto.licenseNo ?? dto.licenseNumber ?? dto.license_no,
        phone: dto.phone,
        email: dto.email,
        customsPorts:
          dto.customsPorts ??
          (dto.portName ? [dto.portName] : dto.customs_ports ? dto.customs_ports : undefined),
        taxNumber: dto.taxNumber ?? dto.tax_number,
        commercialRegistry: dto.commercialRegistry ?? dto.commercial_registry,
        notes: dto.notes,
      };
      return await http<CustomsBroker>('/api/import-sales/customs-brokers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customs-brokers'] });
    },
  });
};

export const useDisburseBrokerAdvanceMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        brokerId: dto.brokerId ?? dto.broker_id,
        projectId: dto.projectId || dto.project_id || undefined,
        shipmentId: dto.shipmentId || dto.shipment_id || undefined,
        advanceNo: dto.advanceNo || dto.advance_no || `ADV-${Date.now().toString().slice(-6)}`,
        amountEgp: Number(dto.amountEgp ?? dto.amount_egp ?? dto.amount ?? 0),
        disbursementDate: dto.disbursementDate || dto.disbursement_date || todayLocalDateKey(),
        paymentMethod: dto.paymentMethod || dto.payment_method || 'bank_transfer',
        treasuryAccountId: dto.treasuryAccountId || dto.treasury_account_id || undefined,
        notes: dto.notes || undefined,
      };
      return await http<any>('/api/import-sales/customs-brokers/advances', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customs-brokers'] });
      queryClient.invalidateQueries({ queryKey: ['customs-broker-statement'] });
    },
  });
};

export const useLiquidateBrokerExpenseMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        brokerId: dto.brokerId ?? dto.broker_id,
        advanceId: dto.advanceId || dto.advance_id || undefined,
        projectId: dto.projectId || dto.project_id || undefined,
        shipmentId: dto.shipmentId || dto.shipment_id || undefined,
        receiptNo: dto.receiptNo || dto.receiptNumber || dto.receipt_no || `REC-${Date.now().toString().slice(-6)}`,
        expenseDate: dto.expenseDate || dto.expense_date || todayLocalDateKey(),
        category: dto.category || dto.expenseCategory || 'clearance_fees',
        amountEgp: Number(dto.amountEgp ?? dto.amount_egp ?? dto.amount ?? 0),
        isCapitalized: dto.isCapitalized ?? dto.is_capitalized ?? true,
        isRefundableVat: dto.isRefundableVat ?? dto.is_refundable_vat ?? false,
        attachmentUrl: dto.attachmentUrl || dto.attachment_url || undefined,
        notes: dto.notes || undefined,
      };
      return await http<any>('/api/import-sales/customs-brokers/liquidate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customs-brokers'] });
      queryClient.invalidateQueries({ queryKey: ['customs-broker-statement'] });
    },
  });
};

export const useVerifyBrokerExpenseMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: { expenseId: string; approvalRequestId: string }) => {
      return await http<any>(`/api/import-sales/customs-brokers/expenses/${dto.expenseId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ approvalRequestId: dto.approvalRequestId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customs-brokers'] });
      queryClient.invalidateQueries({ queryKey: ['customs-broker-statement'] });
    },
  });
};

export const useCustomsBrokerStatementQuery = (brokerId: string) => {
  return useQuery({
    queryKey: ['customs-broker-statement', brokerId],
    queryFn: async () => {
      return await http<any>(`/api/import-sales/customs-brokers/${brokerId}/statement`);
    },
    enabled: !!brokerId,
  });
};
