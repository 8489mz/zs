import { Injectable, Inject } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import type { Database } from '../../../database/database.types';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { SalesWriteService } from './sales-write.service';
import type { CreateSalesOrderDto } from '../dto/sales-order.dto';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { SalesOrdersAvailability } from './sales-orders/sales-orders-availability';
import { SalesOrdersConversionClaims } from './sales-orders/sales-orders-conversion-claims';
import { SalesOrdersReads } from './sales-orders/sales-orders-reads';
import { SalesOrdersCreation } from './sales-orders/sales-orders-creation';
import { SalesOrdersConfirmation } from './sales-orders/sales-orders-confirmation';
import { SalesOrdersConversion } from './sales-orders/sales-orders-conversion';
import { SalesOrdersDeletion } from './sales-orders/sales-orders-deletion';

@Injectable()
export class SalesOrdersService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly salesWrite: SalesWriteService,
    // Optional: Nest DI provides the global IdempotencyService, but
    // specs and harnesses construct this service by hand with two
    // arguments — fall back to a real instance over the same db so
    // conversion recovery never runs against an undefined service.
    idempotency?: IdempotencyService,
  ) {
    this.idempotency = idempotency ?? new IdempotencyService(db as any);
  }

  private readonly idempotency: IdempotencyService;

  private _availability: SalesOrdersAvailability | null = null;
  private _conversionClaims: SalesOrdersConversionClaims | null = null;
  private _reads: SalesOrdersReads | null = null;
  private _creation: SalesOrdersCreation | null = null;
  private _confirmation: SalesOrdersConfirmation | null = null;
  private _conversion: SalesOrdersConversion | null = null;
  private _deletion: SalesOrdersDeletion | null = null;

  private get availability(): SalesOrdersAvailability {
    return (this._availability ??= new SalesOrdersAvailability(this.db));
  }

  private get conversionClaims(): SalesOrdersConversionClaims {
    return (this._conversionClaims ??= new SalesOrdersConversionClaims(this.db));
  }

  private get reads(): SalesOrdersReads {
    return (this._reads ??= new SalesOrdersReads(this.db, {
      resolveStoredOrderLocation: (order, scope) => this.availability.resolveStoredOrderLocation(order, scope),
    }));
  }

  private get creation(): SalesOrdersCreation {
    return (this._creation ??= new SalesOrdersCreation(this.db, {
      resolveOrderWarehouse: (trx, scope, branchId, requestedLocationId) => this.availability.resolveOrderWarehouse(trx, scope, branchId, requestedLocationId),
      loadServiceProductIds: (trx, scope, productIds) => this.availability.loadServiceProductIds(trx, scope, productIds),
    }));
  }

  private get confirmation(): SalesOrdersConfirmation {
    return (this._confirmation ??= new SalesOrdersConfirmation(this.db, {
      loadServiceProductIds: (trx, scope, productIds) => this.availability.loadServiceProductIds(trx, scope, productIds),
    }));
  }

  private get conversion(): SalesOrdersConversion {
    return (this._conversion ??= new SalesOrdersConversion(this.db, this.salesWrite, this.idempotency, {
      conversionOperationParams: (scope, idemKey) => this.conversionClaims.conversionOperationParams(scope, idemKey),
      markOrderConverted: (id, scope, saleId) => this.conversionClaims.markOrderConverted(id, scope, saleId),
      revertConvertingClaim: (id, scope) => this.conversionClaims.revertConvertingClaim(id, scope),
    }));
  }

  private get deletion(): SalesOrdersDeletion {
    return (this._deletion ??= new SalesOrdersDeletion(this.db, this.idempotency, {
      conversionOperationParams: (scope, idemKey) => this.conversionClaims.conversionOperationParams(scope, idemKey),
      cancelOrder: (id, auth) => this.confirmation.cancelOrder(id, auth),
    }));
  }

  async getLocationAvailability(
    productId: number,
    locationId: number | null,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.availability.getLocationAvailability(productId, locationId, auth);
  }

  async listOrders(
    auth: AuthContext,
    query?: { status?: string; search?: string; limit?: number; offset?: number }
  ): Promise<Record<string, unknown>> {
    return this.reads.listOrders(auth, query);
  }
  async getOrderById(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reads.getOrderById(id, auth);
  }

  async createOrder(dto: CreateSalesOrderDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.creation.createOrder(dto, auth);
  }

  async confirmAndReserve(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.confirmation.confirmAndReserve(id, auth);
  }
  async cancelOrder(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.confirmation.cancelOrder(id, auth);
  }

  async convertToSale(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.conversion.convertToSale(id, auth);
  }

  async deleteOrder(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.deletion.deleteOrder(id, auth);
  }
}
