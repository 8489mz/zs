import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import {
  PricingBulkSetProfileDto,
  PricingPreviewDto,
  PricingRuleListQueryDto,
  PricingRuleMatchDto,
  PricingRuleUpsertDto,
} from './dto/pricing-preview.dto';
import { PricingService } from './pricing.service';

@Controller('api/pricing')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post('preview')
  @RequirePermissions('pricingCenterView')
  preview(@Body() payload: PricingPreviewDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.pricingService.preview(
      {
        ...payload,
        options: {
          applyToWholeStyleCode: Boolean(payload.options?.applyToWholeStyleCode),
          applyToPricingGroup: Boolean(payload.options?.applyToPricingGroup),
          skipActiveOffers: Boolean(payload.options?.skipActiveOffers ?? payload.safeguards?.skipActiveOffers),
          skipCustomerPrices: Boolean(payload.options?.skipCustomerPrices),
          skipManualExceptions: Boolean(
            payload.options?.skipManualExceptions ?? payload.safeguards?.skipManualExceptions,
          ),
        },
        safeguards: payload.safeguards,
        reason: payload.reason,
      },
      req.authContext!,
    );
  }

  @Post('apply')
  @RequirePermissions('pricingCenterManage')
  apply(@Body() payload: PricingPreviewDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.pricingService.apply(
      {
        ...payload,
        options: {
          applyToWholeStyleCode: Boolean(payload.options?.applyToWholeStyleCode),
          applyToPricingGroup: Boolean(payload.options?.applyToPricingGroup),
          skipActiveOffers: Boolean(payload.options?.skipActiveOffers ?? payload.safeguards?.skipActiveOffers),
          skipCustomerPrices: Boolean(payload.options?.skipCustomerPrices),
          skipManualExceptions: Boolean(
            payload.options?.skipManualExceptions ?? payload.safeguards?.skipManualExceptions,
          ),
        },
        safeguards: payload.safeguards,
        reason: payload.reason,
      },
      req.authContext!,
    );
  }

  @Get('runs')
  @RequirePermissions('pricingCenterView')
  listRuns(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.pricingService.listRuns(req.authContext!);
  }

  @Post('runs/:id/undo')
  @RequirePermissions('pricingCenterManage')
  undo(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.pricingService.undo(id, req.authContext!);
  }

  @Post('profiles/bulk-set')
  @RequirePermissions('pricingCenterManage')
  bulkSetProfiles(
    @Body() payload: PricingBulkSetProfileDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.pricingService.bulkSetProfiles(payload, req.authContext!);
  }

  @Get('rules')
  @RequirePermissions('pricingCenterView')
  listRules(@Query() query: PricingRuleListQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.pricingService.listRules(query, req.authContext!);
  }

  @Post('rules')
  @RequirePermissions('pricingCenterManage')
  upsertRule(@Body() payload: PricingRuleUpsertDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.pricingService.upsertRule(payload, req.authContext!);
  }

  @Post('rules/match')
  @RequirePermissions('pricingCenterView')
  matchRule(@Body() payload: PricingRuleMatchDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.pricingService.matchRule(payload, req.authContext!);
  }
}
