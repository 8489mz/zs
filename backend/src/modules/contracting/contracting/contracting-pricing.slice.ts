import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { ContractingPricingService } from '../services/contracting-pricing.service';
import {
  CreateMasterPriceItemDto,
  UpdateMasterPriceItemDto,
  CreateEngineeringConstantDto,
  AutoPriceBoqItemDto,
} from '../dto/contracting.dto';

export class ContractingPricingSlice {
  private readonly pricingService: ContractingPricingService;

  constructor(private readonly db: Kysely<Database>) {
    this.pricingService = new ContractingPricingService({
      db: this.db,
    });
  }

  // ==========================================================================
  // 12. Master Price List (أسعار السوق للخامات والمصنعيات والمعدات)
  // ==========================================================================

  async getMasterPriceList(auth: AuthContext, query?: { itemType?: string; category?: string; search?: string }) {
    return this.pricingService.getMasterPriceList(auth, query);
  }

  async createMasterPriceItem(auth: AuthContext, dto: CreateMasterPriceItemDto) {
    return this.pricingService.createMasterPriceItem(auth, dto);
  }

  async updateMasterPriceItem(auth: AuthContext, id: string, dto: UpdateMasterPriceItemDto) {
    return this.pricingService.updateMasterPriceItem(auth, id, dto);
  }

  async deleteMasterPriceItem(auth: AuthContext, id: string) {
    return this.pricingService.deleteMasterPriceItem(auth, id);
  }

  // ==========================================================================
  // 13. Engineering Constants & Auto-Pricing Engine
  // ==========================================================================

  async getEngineeringConstants(auth: AuthContext) {
    return this.pricingService.getEngineeringConstants(auth);
  }

  async createEngineeringConstant(auth: AuthContext, dto: CreateEngineeringConstantDto) {
    return this.pricingService.createEngineeringConstant(auth, dto);
  }

  async autoPriceBoqItem(auth: AuthContext, dto: AutoPriceBoqItemDto) {
    return this.pricingService.autoPriceBoqItem(auth, dto);
  }
}
