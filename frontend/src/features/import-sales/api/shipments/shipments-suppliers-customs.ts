import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/http';

export interface ChinaSupplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  balance: number;
  chinese_name?: string;
  city?: string;
  province?: string;
  moq_description?: string;
  production_lead_time_days?: number;
  verified_bank_details?: any;
  incoterms_accepted?: string[];
  qc_rating?: number;
  quality_certifications?: string[];
  audit_status?: string;
  import_notes?: string;
}

export const useChinaSuppliersQuery = () => {
  return useQuery({
    queryKey: ['china-suppliers'],
    queryFn: async () => {
      return await http<ChinaSupplier[]>('/api/import-sales/china-suppliers');
    },
  });
};

export interface CreateChinaSupplierPayload {
  name: string;
  chineseName?: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  moqDescription?: string;
  productionLeadTimeDays?: number;
  bankBeneficiary?: string;
  bankName?: string;
  bankSwift?: string;
  bankAccount?: string;
  incotermsAccepted?: string[];
  notes?: string;
}

export const useCreateChinaSupplierMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateChinaSupplierPayload) => {
      return await http('/api/import-sales/china-suppliers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['china-suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });
};

export const useUpsertSupplierMetaMutation = (defaultSupplierId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      const targetSupplierId = dto?.supplierId || defaultSupplierId;
      const payload = {
        chineseName: dto.chineseName ?? dto.chinese_name,
        city: dto.city,
        province: dto.province,
        moqDescription: dto.moqDescription ?? dto.moq_description,
        verifiedBankDetails: dto.verifiedBankDetails ?? dto.verified_bank_details,
        incotermsAccepted: dto.incotermsAccepted ?? dto.incoterms_accepted,
        qualityCertifications: dto.qualityCertifications ?? dto.quality_certifications,
        notes: dto.notes,
        productionLeadTimeDays:
          dto.productionLeadTimeDays !== undefined
            ? Number(dto.productionLeadTimeDays)
            : dto.production_lead_time_days !== undefined
              ? Number(dto.production_lead_time_days)
              : undefined,
        qcRating:
          dto.qcRating !== undefined
            ? Number(dto.qcRating)
            : dto.qc_rating !== undefined
              ? Number(dto.qc_rating)
              : undefined,
        auditStatus: dto.auditStatus ?? dto.audit_status,
      };
      return await http(`/api/import-sales/suppliers/${targetSupplierId}/meta`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['china-suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });
};

export const useQcInspectionsQuery = (projectId?: string, shipmentId?: string) => {
  return useQuery({
    queryKey: ['qc-inspections', projectId, shipmentId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);
      if (shipmentId) params.set('shipmentId', shipmentId);
      return await http<any[]>(`/api/import-sales/qc-inspections?${params.toString()}`);
    },
  });
};

export const useCreateQcInspectionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      return await http('/api/import-sales/qc-inspections', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qc-inspections'] });
    },
  });
};

export const useAciComplianceQuery = (id: string) => {
  return useQuery({
    queryKey: ['aci-compliance', id],
    queryFn: async () => {
      return await http<any>(`/api/import-sales/aci-compliance/${id}`);
    },
    enabled: !!id,
  });
};

export const useUpsertAciComplianceMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: any) => {
      return await http('/api/import-sales/aci-compliance', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aci-compliance'] });
      queryClient.invalidateQueries({ queryKey: ['import-command-center'] });
    },
  });
};

export const useCustomsTariffsQuery = (search?: string, sector?: string) => {
  return useQuery({
    queryKey: ['customs-tariffs', search, sector],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (sector && sector !== 'all') params.append('sector', sector);
      const qs = params.toString();
      const url = qs ? `/api/import-sales/customs-tariffs?${qs}` : '/api/import-sales/customs-tariffs';
      return await http<any[]>(url);
    },
  });
};

export const useCustomsTariffSectorsQuery = () => {
  return useQuery({
    queryKey: ['customs-tariffs-sectors'],
    queryFn: async () => {
      return await http<Array<{ id: string; name_ar: string; name_en: string; description_ar: string }>>(
        '/api/import-sales/customs-tariffs/sectors'
      );
    },
    staleTime: 1000 * 60 * 30,
  });
};

export const useSectorPresetsQuery = () => {
  return useQuery({
    queryKey: ['import-sector-presets'],
    queryFn: async () => {
      return await http<Array<{ key: string; nameAr: string; nameEn: string; categoryName: string }>>(
        '/api/import-sales/sector-presets'
      );
    },
    staleTime: 1000 * 60 * 30,
  });
};

export const useSyncOfficialTariffsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return await http('/api/import-sales/customs-tariffs/sync-official', { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customs-tariffs'] });
    },
  });
};

export const useCalculateCustomsMutation = () => {
  return useMutation({
    mutationFn: async (dto: { hsCode: string; cifValueEgp: number }) => {
      return await http<any>('/api/import-sales/calculate-customs', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
  });
};

export const useCloseProjectMutation = (defaultProjectId?: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: string | { projectId?: string; approvalRequestId: string; closingNotes?: string }) => {
      const projectId = typeof args === 'string' ? defaultProjectId : args.projectId || defaultProjectId;
      const approvalRequestId = typeof args === 'string' ? args : args.approvalRequestId;
      const closingNotes = typeof args === 'string' ? undefined : (args as any).closingNotes;
      return await http(`/api/import-sales/projects/${projectId}/close`, {
        method: 'POST',
        body: JSON.stringify({ approvalRequestId, closingNotes }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-projects'] });
      if (defaultProjectId) {
        queryClient.invalidateQueries({ queryKey: ['import-projects', defaultProjectId] });
      }
      queryClient.invalidateQueries({ queryKey: ['import-command-center'] });
    },
  });
};
