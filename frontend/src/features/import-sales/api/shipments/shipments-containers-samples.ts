import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { todayLocalDateKey } from '@/lib/format';

export const useContainerDepositsQuery = (shipmentId?: string) => {
  return useQuery({
    queryKey: ['container-deposits', shipmentId],
    queryFn: async () => {
      const url = shipmentId ? `/api/import-sales/container-deposits?shipmentId=${shipmentId}` : '/api/import-sales/container-deposits';
      return await http<any[]>(url);
    },
  });
};

export const useRecordContainerDepositMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        shipmentId: dto.shipmentId || dto.shipment_id,
        projectId: dto.projectId || dto.project_id || undefined,
        containerNo: dto.containerNo || dto.containerNumber || dto.container_no,
        shippingLine: dto.shippingLine || dto.shipping_line,
        depositAmountEgp: Number(dto.depositAmountEgp ?? dto.deposit_amount_egp ?? 0),
        paymentDate: dto.paymentDate || dto.payment_date || todayLocalDateKey(),
        expectedReturnDate: dto.expectedReturnDate || dto.freeDaysDeadline || dto.expected_return_date || undefined,
        treasuryAccountId: dto.treasuryAccountId || dto.treasury_account_id || undefined,
        notes: dto.notes || undefined,
      };
      // INV-IMPORT-CONTAINER-DEPOSIT (I3-D8): do NOT send receiptNo or
      // idempotencyKey — RecordContainerDepositDto declares neither, the
      // global whitelist + forbidNonWhitelisted pipe rejects them, and
      // the service has no deposit idempotency handling, so sending
      // them made every deposit fail before the service ran.
      return await http<any>('/api/import-sales/container-deposits', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['container-deposits'] });
    },
  });
};

export const useRefundContainerDepositMutation = (defaultDepositId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: any) => {
      const depositId = args?.depositId || defaultDepositId;
      const raw = args?.dto !== undefined ? args.dto : args;
      const payload = {
        actualReturnDate: raw.actualReturnDate || raw.actual_return_date || todayLocalDateKey(),
        refundedAmountEgp: Number(raw.refundedAmountEgp ?? raw.refunded_amount_egp ?? 0),
        deductionsAmountEgp:
          raw.deductionsAmountEgp !== undefined
            ? Number(raw.deductionsAmountEgp)
            : raw.deductedDamagesEgp !== undefined
              ? Number(raw.deductedDamagesEgp)
              : undefined,
        deductionReason: raw.deductionReason || raw.deduction_reason || raw.notes || undefined,
        treasuryAccountId: raw.treasuryAccountId || raw.treasury_account_id || undefined,
      };
      return await http<any>(`/api/import-sales/container-deposits/${depositId}/return-refund`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['container-deposits'] });
    },
  });
};

export const useContainerPreordersQuery = (shipmentId?: string) => {
  return useQuery({
    queryKey: ['container-preorders', shipmentId],
    queryFn: async () => {
      const url = shipmentId ? `/api/import-sales/preorders?shipmentId=${shipmentId}` : '/api/import-sales/preorders';
      return await http<any[]>(url);
    },
  });
};

export const useCreateContainerPreorderMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const depositTreasuryAccountId =
        dto.depositTreasuryAccountId ?? dto.deposit_treasury_account_id ?? dto.treasuryAccountId;
      const payload = {
        shipmentId: dto.shipmentId || dto.shipment_id,
        projectId: dto.projectId || dto.project_id || undefined,
        customerId: Number(dto.customerId ?? dto.customer_id),
        productId: Number(dto.productId ?? dto.product_id),
        reservedQuantity: Number(dto.reservedQuantity ?? dto.reserved_quantity),
        unitPriceEgp: Number(dto.unitPriceEgp ?? dto.unit_price_egp ?? dto.agreedUnitPriceEgp ?? dto.agreed_unit_price_egp),
        depositAmountEgp: dto.depositAmountEgp !== undefined ? Number(dto.depositAmountEgp) : undefined,
        depositTreasuryAccountId: depositTreasuryAccountId ? Number(depositTreasuryAccountId) : undefined,
        expectedDeliveryDate: dto.expectedDeliveryDate || dto.expected_delivery_date || undefined,
        notes: dto.notes || undefined,
      };
      // INV-IMPORT-FLOATING-RESERVATION (I4-D12): send exactly the
      // CreateContainerPreorderDto fields. The old payload sent
      // `agreedUnitPriceEgp` + `idempotencyKey` (neither declared on
      // the DTO) and never sent the DTO's required `unitPriceEgp`,
      // so the global whitelist + forbidNonWhitelisted pipe rejected
      // every create with 400 before the service ran — the same
      // class as the I3-D8 deposit failure. There is no server-side
      // preorder idempotency, so no key is sent.
      return await http<any>('/api/import-sales/preorders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['container-preorders'] });
    },
  });
};

export const useCancelPreorderMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ preorderId, reason }: { preorderId: string; reason?: string }) => {
      return await http<any>(`/api/import-sales/preorders/${preorderId}/cancel`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['container-preorders'] });
      queryClient.invalidateQueries({ queryKey: ['container-autopsy'] });
    },
  });
};

export const useContainerAutopsyQuery = (shipmentId: string) => {
  return useQuery({
    queryKey: ['container-autopsy', shipmentId],
    queryFn: async () => {
      return await http<any>(`/api/import-sales/shipments/${shipmentId}/autopsy`);
    },
    enabled: !!shipmentId,
  });
};

export const useSampleOrdersQuery = (projectId?: string) => {
  return useQuery({
    queryKey: ['sample-orders', projectId],
    queryFn: async () => {
      const url = projectId ? `/api/import-sales/samples?projectId=${projectId}` : '/api/import-sales/samples';
      return await http<any[]>(url);
    },
  });
};

export const useCreateSampleOrderMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const payload = {
        projectId: dto.projectId || dto.project_id || undefined,
        supplierId: Number(dto.supplierId ?? dto.supplier_id),
        sampleCode: dto.sampleCode || dto.sample_code || `SMP-${Date.now().toString().slice(-6)}`,
        itemName: dto.itemName || dto.sampleName || dto.item_name,
        sampleCostForeign:
          dto.sampleCostForeign !== undefined
            ? Number(dto.sampleCostForeign)
            : dto.sampleCostUsd !== undefined
              ? Number(dto.sampleCostUsd)
              : 0,
        freightCostForeign:
          dto.freightCostForeign !== undefined
            ? Number(dto.freightCostForeign)
            : dto.courierCostUsd !== undefined
              ? Number(dto.courierCostUsd)
              : 0,
        currency: dto.currency || 'USD',
        requestDate: dto.requestDate || dto.request_date || todayLocalDateKey(),
        courierTrackingNo: dto.courierTrackingNo || dto.trackingNumber || dto.courier_tracking_no || undefined,
        notes: dto.notes || undefined,
      };
      return await http<any>('/api/import-sales/samples', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sample-orders'] });
    },
  });
};

export const useUpdateSampleInspectionMutation = (defaultSampleId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: any) => {
      const sampleId = args?.sampleId || defaultSampleId;
      const raw = args?.dto !== undefined ? args.dto : args;
      const payload = {
        qualityScore:
          raw.qualityScore !== undefined
            ? Number(raw.qualityScore)
            : raw.qualityRating !== undefined
              ? Number(raw.qualityRating) * 20
              : undefined,
        decision: raw.decision,
        referenceSampleApproved:
          raw.referenceSampleApproved !== undefined
            ? Boolean(raw.referenceSampleApproved)
            : raw.isGoldenSample !== undefined
              ? Boolean(raw.isGoldenSample)
              : undefined,
        defectAnalysis: raw.defectAnalysis ?? raw.inspectionNotes ?? raw.defect_analysis,
        receivedDate: raw.receivedDate || todayLocalDateKey(),
      };
      return await http<any>(`/api/import-sales/samples/${sampleId}/inspection`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sample-orders'] });
    },
  });
};
