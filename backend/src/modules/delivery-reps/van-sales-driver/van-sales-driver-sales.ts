import { Injectable } from '@nestjs/common';
import type { VanSalesService } from '../van-sales.service';

/**
 * Driver sales slice of the van-sales controller split (file #30, S3).
 * Pure move of the driver sales handlers out of VanSalesController:
 * bodies byte-identical, signatures minus NestJS decorators only.
 * The facade keeps thin delegates with the same names and signatures.
 * Bound deps only: the sales service plus the facade kernel helper,
 * passed bound so the moved bodies stay byte-identical.
 */
export interface VanSalesDriverSalesDeps {
  vanSalesService: VanSalesService;
  // Bound kernel helper (stays in the facade; passed bound so the moved
  // bodies stay byte-identical).
  verifyDriver: (
    authHeader: string,
  ) => Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string }>;
}

@Injectable()
export class VanSalesDriverSalesSlice {
  private readonly vanSalesService: VanSalesService;
  private readonly verifyDriver: VanSalesDriverSalesDeps['verifyDriver'];

  constructor(deps: VanSalesDriverSalesDeps) {
    this.vanSalesService = deps.vanSalesService;
    this.verifyDriver = deps.verifyDriver;
  }

  async executeSale(
    authHeader: string,
    body: {
      tripId: number;
      customerId?: number;
      customerName?: string;
      customerPhone?: string;
      paymentMethod: 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';
      paidAmount?: number;
      items: {
        productId: number;
        qty: number;
        unitPrice?: number;
        unitName?: string;
        unitMultiplier?: number;
        isBonus?: boolean;
        bonusReason?: string;
        originalPrice?: number;
        // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: per-line TOTAL
        // discount amount (POS lineDiscount semantics).
        lineDiscount?: number;
      }[];
      notes?: string;
      deliveryGpsLat?: number;
      deliveryGpsLng?: number;
      // INV-VAN-OFFLINE-TIMESTAMPS: why no GPS fix was captured at
      // submit time ('timeout' | 'denied' | 'unavailable').
      gpsMissingReason?: 'timeout' | 'denied' | 'unavailable';
      deliveryProofPhoto?: string;
      packagingBreakdown?: { cartonsCount?: number; piecesCount?: number; itemsCount?: number };
      clientTxId?: string;
      cashDiscountAmount?: number;
      supervisorOverridePin?: string;
      supervisorOverrideReason?: string;
      transferReference?: string;
      transferReceiptUrl?: string;
      recipientName?: string;
      recipientPhone?: string;
      recipientRole?: string;
      recipientSignature?: string;
      // INV-VAN-OFFLINE-TIMESTAMPS: the instant the sale was made
      // offline (outbox createdAt, ISO with offset).
      offlineCreatedAt?: string;
    },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.executeFieldSale(driver.repId, driver.tenantId, driver.accountId, body);
  }

  async listDriverSales(
    authHeader: string,
    dateScope?: 'today' | 'yesterday' | 'week' | 'all',
    customerId?: string,
    paymentMethod?: string,
    search?: string,
    tripId?: string,
    discountedOnly?: string,
  ) {
    const driver = await this.verifyDriver(authHeader);
    const sales = await this.vanSalesService.listDriverSales(driver.tenantId, driver.repId, {
      dateScope: dateScope || 'all',
      customerId: customerId ? Number(customerId) : undefined,
      paymentMethod,
      search,
      tripId: tripId ? Number(tripId) : undefined,
      discountedOnly: discountedOnly === 'true',
    });
    return { ok: true, sales };
  }

  async recordCollection(
    authHeader: string,
    body: {
      tripId: number;
      customerId: number;
      amount: number;
      paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer';
      transferReference?: string;
      transferReceiptUrl?: string;
      supervisorOverridePin?: string;
      notes?: string;
      gpsLat?: number;
      gpsLng?: number;
      clientTxId?: string;
      // INV-VAN-OFFLINE-TIMESTAMPS: the instant the collection was
      // made offline (outbox createdAt, ISO with offset).
      offlineCreatedAt?: string;
    },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.recordFieldCollection(driver.repId, driver.tenantId, driver.accountId, body);
  }

  async executeDamagedSwap(
    authHeader: string,
    tripId: number,
    body: {
      customerId?: number;
      damagedProductId: number;
      damagedQty: number;
      damageReason?: string;
      replacementProductId: number;
      replacementQty: number;
      notes?: string;
      clientTxId?: string;
    },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.executeDamagedSwap(driver.repId, driver.tenantId, driver.accountId, {
      tripId,
      ...body,
    });
  }

  async listTripDamagedSwaps(authHeader: string, tripId: number) {
    const driver = await this.verifyDriver(authHeader);
    const swaps = await this.vanSalesService.listTripDamagedSwaps(driver.tenantId, tripId, driver.repId);
    return { ok: true, swaps };
  }

  async getCustomerEligibleSales(authHeader: string, customerId: number) {
    const driver = await this.verifyDriver(authHeader);
    const sales = await this.vanSalesService.getCustomerEligibleSales(driver.tenantId, customerId, driver.repId);
    return { ok: true, sales };
  }

  async submitFieldReturn(
    authHeader: string,
    body: {
      tripId: number;
      customerId: number;
      saleId?: number | null;
      returnReason: 'damaged' | 'expired' | 'manufacturing_defect' | 'stagnant' | 'order_mismatch' | 'customer_request';
      refundMethod?: 'credit' | 'cash';
      items: {
        productId: number;
        qty: number;
        unitPrice: number;
        saleItemId?: number;
        unitMultiplier?: number;
        unitName?: string;
      }[];
      notes?: string;
      // INV-VAN-OFFLINE-TIMESTAMPS: the instant the return was made
      // offline (outbox createdAt, ISO with offset).
      offlineCreatedAt?: string;
    },
  ) {
    const driver = await this.verifyDriver(authHeader);
    return this.vanSalesService.submitFieldReturn(driver.repId, driver.tenantId, driver.accountId, body);
  }
}
