import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireAnyPermission } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import {
  MarketplaceSyncService,
  AmazonConfig,
  NoonConfig,
  JumiaConfig,
  TrendyolConfig,
  SupportedMarketplace,
  MarketplaceSkuMapping,
  MarketplaceFeeCalculationInput,
  BulkMappingImportRow,
  MarketplaceSettlementInput,
  FbaInboundShipment,
} from '../services/marketplace-sync.service';

@Controller('api/storefront/marketplaces')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireAnyPermission('storefront', 'settings')
export class MarketplaceSyncController {
  constructor(private readonly syncService: MarketplaceSyncService) {}

  @Get('config')
  getConfig(@Req() req: RequestWithAuth) {
    return this.syncService.getConfig(req.authContext!);
  }

  @Post('config')
  saveConfig(
    @Body() payload: {
      amazon?: Partial<AmazonConfig>;
      noon?: Partial<NoonConfig>;
      jumia?: Partial<JumiaConfig>;
      trendyol?: Partial<TrendyolConfig>;
    },
    @Req() req: RequestWithAuth,
  ) {
    return this.syncService.saveConfig(payload, req.authContext!);
  }

  @Post('test-connection')
  testConnection(@Body('marketplace') marketplace: SupportedMarketplace, @Req() req: RequestWithAuth) {
    return this.syncService.testConnection(marketplace, req.authContext!);
  }

  @Get('mappings')
  getMappings(@Req() req: RequestWithAuth) {
    return this.syncService.getMappings(req.authContext!);
  }

  @Post('mappings')
  saveMapping(
    @Body() payload: Omit<MarketplaceSkuMapping, 'id'> & { id?: string },
    @Req() req: RequestWithAuth,
  ) {
    return this.syncService.saveMapping(payload, req.authContext!);
  }

  @Delete('mappings/:id')
  deleteMapping(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.syncService.deleteMapping(id, req.authContext!);
  }

  @Post('sync-inventory')
  syncInventory(@Query('marketplace') marketplace: SupportedMarketplace | undefined, @Req() req: RequestWithAuth) {
    return this.syncService.syncInventory(req.authContext!, marketplace as any);
  }

  @Post('simulate-order')
  simulateOrder(@Body('marketplace') marketplace: 'amazon' | 'noon', @Req() req: RequestWithAuth) {
    const target = marketplace === 'noon' ? 'noon' : 'amazon';
    return this.syncService.simulateIncomingOrder(target, req.authContext!);
  }

  @Post('calculate-fees')
  calculateFees(@Body() input: MarketplaceFeeCalculationInput) {
    return this.syncService.calculateMarketplaceFees(input);
  }

  @Get('listing-studio/:productId')
  getListingStudio(@Param('productId', ParseIntPipe) productId: number, @Req() req: RequestWithAuth) {
    return this.syncService.generateListingContent(productId, req.authContext!);
  }

  @Post('competitor-price/:id')
  updateCompetitorPrice(
    @Param('id') id: string,
    @Body() payload: { competitorPrice?: number; buyBoxPrice?: number },
    @Req() req: RequestWithAuth,
  ) {
    return this.syncService.updateCompetitorPrice(id, payload, req.authContext!);
  }

  @Get('export-flat-file')
  exportFlatFile(@Query('marketplace') marketplace: SupportedMarketplace, @Req() req: RequestWithAuth) {
    const target = marketplace || 'amazon';
    return this.syncService.exportFlatFile(target, req.authContext!);
  }

  @Post('import-mappings')
  importMappings(@Body('rows') rows: BulkMappingImportRow[], @Req() req: RequestWithAuth) {
    return this.syncService.importMappings(rows, req.authContext!);
  }

  @Get('settlements')
  getSettlements(@Req() req: RequestWithAuth) {
    return this.syncService.getSettlements(req.authContext!);
  }

  @Post('settlements/reconcile')
  reconcileSettlement(@Body() input: MarketplaceSettlementInput, @Req() req: RequestWithAuth) {
    return this.syncService.reconcileSettlement(input, req.authContext!);
  }

  @Get('settlement-accounts')
  getSettlementAccounts(@Req() req: RequestWithAuth) {
    return this.syncService.getSettlementAccounts(req.authContext!);
  }

  @Post('sync-live')
  syncLive(@Req() req: RequestWithAuth, @Body('productId') productId?: number) {
    return this.syncService.syncStockLive(productId ? Number(productId) : undefined, req.authContext!);
  }

  @Post('repricing-settings/:id')
  saveRepricingSettings(
    @Param('id') id: string,
    @Body()
    payload: {
      repricingEnabled: boolean;
      minPrice?: number;
      maxPrice?: number;
      repricingRule?: 'match_buy_box' | 'undercut_buy_box' | 'match_lowest' | 'undercut_lowest';
      repricingDelta?: number;
    },
    @Req() req: RequestWithAuth,
  ) {
    return this.syncService.saveRepricingSettings(id, payload, req.authContext!);
  }

  @Post('run-repricing-bot')
  runRepricingBot(@Body('marketplace') marketplace: SupportedMarketplace | undefined, @Req() req: RequestWithAuth) {
    return this.syncService.runRepricingBot(marketplace, req.authContext!);
  }

  @Get('inbound-shipments')
  getInboundShipments(@Req() req: RequestWithAuth) {
    return this.syncService.getInboundShipments(req.authContext!);
  }

  @Post('inbound-shipments')
  createInboundShipment(
    @Body() input: Omit<FbaInboundShipment, 'id' | 'shipmentNumber' | 'createdAt'>,
    @Req() req: RequestWithAuth,
  ) {
    return this.syncService.createInboundShipment(input, req.authContext!);
  }

  @Get('inbound-shipments/:id/packing-slip')
  exportPackingSlip(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.syncService.exportPackingSlip(id, req.authContext!);
  }

  @Post('inbound-shipments/:id/receive')
  recordShipmentReceiving(
    @Param('id') id: string,
    @Body('receivedItems') receivedItems: { productId: number; marketplaceSku: string; quantityReceived: number }[],
    @Req() req: RequestWithAuth,
  ) {
    return this.syncService.recordShipmentReceiving(id, receivedItems, req.authContext!);
  }

  @Get('inbound-shipments/:id/discrepancy-claim')
  getDiscrepancyClaimReport(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.syncService.getDiscrepancyClaimReport(id, req.authContext!);
  }

  @Get('analytics')
  getMarketplaceAnalytics(
    @Query('period') period: 'all' | '30d' | '7d' | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.syncService.getMarketplaceAnalytics(period || '30d', req.authContext!);
  }

  @Post('webhook/:marketplace')
  handleWebhook(
    @Param('marketplace') marketplace: SupportedMarketplace,
    @Body() payload: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.syncService.handleMarketplaceWebhook(marketplace, payload, req.authContext?.tenantId);
  }

  @Get('webhook-events')
  listWebhookEvents(
    @Query('marketplace') marketplace: SupportedMarketplace | undefined,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.syncService.listMarketplaceWebhookEvents(req.authContext!, {
      marketplace,
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /**
   * Relay stored inbound marketplace webhook events to their handlers
   * (INV-MARKETPLACE-OUTBOX-RELAY). Staff-triggered and guarded by
   * the controller's storefront/settings permission: each stored
   * event is verified (HMAC-SHA256 over the captured raw bytes
   * against the tenant's per-marketplace webhookSecret) before its
   * handler runs, and a signature failure rejects the event loudly
   * instead of processing it. A relay failure leaves the event
   * stored and retryable, never silently dropped.
   */
  @Post('webhooks/relay')
  relayWebhookEvents(@Query('limit') limit: string | undefined, @Req() req: RequestWithAuth) {
    return this.syncService.relayMarketplaceWebhookEvents(req.authContext!, {
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('onboarding-check')
  getSellerOnboardingCheck(@Req() req: RequestWithAuth) {
    return this.syncService.getSellerOnboardingCheck(req.authContext!);
  }

  @Post('onboarding-profile')
  saveOnboardingProfile(@Body() body: any, @Req() req: RequestWithAuth) {
    return this.syncService.saveOnboardingProfile(body, req.authContext!);
  }

  @Post('gtin-exemption')
  generateGtinExemption(@Body() body: any, @Req() req: RequestWithAuth) {
    return this.syncService.generateGtinExemption(body, req.authContext!);
  }
}

