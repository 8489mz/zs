import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { PurchasesService } from '../purchases/purchases.service';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../accounting/accounting-tenant-foundation.service';
import { UpsertDrugDto } from './dto/upsert-drug.dto';
import { UpsertBatchDto } from './dto/upsert-batch.dto';
import { UpsertPrescriptionDto } from './dto/upsert-prescription.dto';
import { UpsertShortageDto } from './dto/upsert-shortage.dto';
import { UpsertClinicalServiceDto } from './dto/upsert-clinical-service.dto';
import { MasterRegistrySlice } from './pharmacy/master-registry.slice';
import { DistributorInvoiceSlice } from './pharmacy/distributor-invoice.slice';
import { DrugsSlice } from './pharmacy/drugs.slice';
import { BatchesSlice } from './pharmacy/batches.slice';
import { PrescriptionsSlice } from './pharmacy/prescriptions.slice';
import { ShortagesSlice } from './pharmacy/shortages.slice';
import { ClinicalSlice } from './pharmacy/clinical.slice';
import { DashboardSlice } from './pharmacy/dashboard.slice';

@Injectable()
export class PharmacyService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly purchases: PurchasesService,
    private readonly accountingFoundation: AccountingTenantFoundationService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private masterRegistrySliceInstance?: MasterRegistrySlice;
  private get masterRegistrySlice(): MasterRegistrySlice {
    return (this.masterRegistrySliceInstance ??= new MasterRegistrySlice(
      this.db,
    ));
  }

  private distributorInvoiceSliceInstance?: DistributorInvoiceSlice;
  private get distributorInvoiceSlice(): DistributorInvoiceSlice {
    return (this.distributorInvoiceSliceInstance ??= new DistributorInvoiceSlice(
      this.db,
      this.purchases,
    ));
  }

  private drugsSliceInstance?: DrugsSlice;
  private get drugsSlice(): DrugsSlice {
    return (this.drugsSliceInstance ??= new DrugsSlice(
      this.db,
    ));
  }

  private batchesSliceInstance?: BatchesSlice;
  private get batchesSlice(): BatchesSlice {
    return (this.batchesSliceInstance ??= new BatchesSlice(
      this.db,
    ));
  }

  private prescriptionsSliceInstance?: PrescriptionsSlice;
  private get prescriptionsSlice(): PrescriptionsSlice {
    return (this.prescriptionsSliceInstance ??= new PrescriptionsSlice(
      this.db,
      this.accountingFoundation,
      this.accountingPosting,
    ));
  }

  private shortagesSliceInstance?: ShortagesSlice;
  private get shortagesSlice(): ShortagesSlice {
    return (this.shortagesSliceInstance ??= new ShortagesSlice(
      this.db,
    ));
  }

  private clinicalSliceInstance?: ClinicalSlice;
  private get clinicalSlice(): ClinicalSlice {
    return (this.clinicalSliceInstance ??= new ClinicalSlice(
      this.db,
      this.accountingFoundation,
      this.accountingPosting,
    ));
  }

  private dashboardSliceInstance?: DashboardSlice;
  private get dashboardSlice(): DashboardSlice {
    return (this.dashboardSliceInstance ??= new DashboardSlice(
      this.db,
    ));
  }


  getMasterCatalog(filters?: { q?: string; drugClass?: string; page?: number; pageSize?: number }) {
    return this.masterRegistrySlice.getMasterCatalog(filters);
  }

  async seedAllMasterDrugs(auth: AuthContext) {
    return this.masterRegistrySlice.seedAllMasterDrugs(auth);
  }

  async importSelectedMasterDrugs(auth: AuthContext, masterIds: string[]) {
    return this.masterRegistrySlice.importSelectedMasterDrugs(auth, masterIds);
  }

  async lookupBarcode(auth: AuthContext, barcode: string) {
    return this.masterRegistrySlice.lookupBarcode(auth, barcode);
  }

  async importDistributorInvoice(
    auth: AuthContext,
    dto: {
      distributor: string; supplierId?: number; locationId?: number;
      invoiceNumber?: string; invoiceDate?: string;
      paymentType?: 'credit' | 'cash';
      lines: Array<{
        productName: string; barcode?: string;
        quantity: number; bonusQuantity?: number;
        publicPrice: number; costPrice: number;
        expiryDate: string; batchNumber?: string;
      }>;
    },
  ) {
    return this.distributorInvoiceSlice.importDistributorInvoice(auth, dto);
  }

  async listDrugs(
    auth: AuthContext,
    filters?: {
      q?: string;
      activeIngredient?: string;
      dosageForm?: string;
      controlledLevel?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    return this.drugsSlice.listDrugs(auth, filters);
  }

  async findSubstitutes(auth: AuthContext, activeIngredient: string, strength?: string) {
    return this.drugsSlice.findSubstitutes(auth, activeIngredient, strength);
  }

  async upsertDrug(auth: AuthContext, dto: UpsertDrugDto) {
    return this.drugsSlice.upsertDrug(auth, dto);
  }

  async deleteDrug(auth: AuthContext, id: number) {
    return this.drugsSlice.deleteDrug(auth, id);
  }

  async listBatches(
    auth: AuthContext,
    filters?: {
      status?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    return this.batchesSlice.listBatches(auth, filters);
  }

  async upsertBatch(auth: AuthContext, dto: UpsertBatchDto) {
    return this.batchesSlice.upsertBatch(auth, dto);
  }

  async getBatchesFEFO(
    auth: AuthContext,
    params: {
      drugId?: number;
      productId?: number;
      excludeExpired?: boolean;
      minQuantity?: number;
    },
  ) {
    return this.batchesSlice.getBatchesFEFO(auth, params);
  }

  async listPrescriptions(
    auth: AuthContext,
    filters?: {
      status?: string;
      insuranceProvider?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    return this.prescriptionsSlice.listPrescriptions(auth, filters);
  }

  async upsertPrescription(auth: AuthContext, dto: UpsertPrescriptionDto) {
    return this.prescriptionsSlice.upsertPrescription(auth, dto);
  }

  async listShortages(
    auth: AuthContext,
    filters?: {
      status?: string;
      priority?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    return this.shortagesSlice.listShortages(auth, filters);
  }

  async upsertShortage(auth: AuthContext, dto: UpsertShortageDto) {
    return this.shortagesSlice.upsertShortage(auth, dto);
  }

  async updateShortageStatus(auth: AuthContext, id: number, status: string) {
    return this.shortagesSlice.updateShortageStatus(auth, id, status);
  }

  async listClinicalServices(auth: AuthContext, limit = 50) {
    return this.clinicalSlice.listClinicalServices(auth, limit);
  }

  async createClinicalService(auth: AuthContext, dto: UpsertClinicalServiceDto) {
    return this.clinicalSlice.createClinicalService(auth, dto);
  }

  async getDashboardStats(auth: AuthContext) {
    return this.dashboardSlice.getDashboardStats(auth);
  }
}
