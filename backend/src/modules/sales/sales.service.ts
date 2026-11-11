import { Injectable } from '@nestjs/common';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { HeldSaleDto } from './dto/held-sale.dto';
import { PosAuditEventDto } from './dto/pos-audit-event.dto';
import { UpsertSaleDto, SalesOrderConversionRelease } from './dto/upsert-sale.dto';
import { SalesQueryService } from './services/sales-query.service';
import { SalesWriteService, type SystemApprovedSaleTerms } from './services/sales-write.service';

@Injectable()
export class SalesService {
  constructor(
    private readonly query: SalesQueryService,
    private readonly write: SalesWriteService,
  ) {}

  async listSales(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.query.listSales(query, auth);
  }

  async getSaleById(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.query.getSaleById(id, auth);
  }

  async createSale(payload: UpsertSaleDto, auth: AuthContext, approvedTerms?: SystemApprovedSaleTerms, conversionRelease?: SalesOrderConversionRelease): Promise<Record<string, unknown>> {
    return this.write.createSale(payload, auth, approvedTerms, conversionRelease);
  }

  async authorizeDiscountOverride(secret: string, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.write.authorizeDiscountOverride(secret, auth);
  }

  async cancelSale(saleId: number, reason: string, managerPin: string, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.write.cancelSale(saleId, reason, managerPin, auth);
  }

  async updateSale(saleId: number, payload: UpsertSaleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.write.updateSale(saleId, payload, auth);
  }

  async listHeldSales(auth: AuthContext): Promise<Record<string, unknown>> {
    return this.query.listHeldSales(auth);
  }

  async saveHeldSale(payload: HeldSaleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.write.saveHeldSale(payload, auth);
  }

  async deleteHeldSale(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.write.deleteHeldSale(id, auth);
  }

  async clearHeldSales(auth: AuthContext): Promise<Record<string, unknown>> {
    return this.write.clearHeldSales(auth);
  }

  async logPosAuditEvent(payload: PosAuditEventDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.write.logPosAuditEvent(payload, auth);
  }
}
