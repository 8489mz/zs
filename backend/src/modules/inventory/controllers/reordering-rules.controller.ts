import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { ReorderingRulesService } from '../services/reordering-rules.service';
import {
  CreateReorderingRuleDto,
  UpdateReorderingRuleDto,
  RunReorderingEvaluationDto,
} from '../dto/reordering-rule.dto';

@Controller('api/inventory/reordering-rules')
@UseGuards(SessionAuthGuard)
export class ReorderingRulesController {
  constructor(private readonly reorderingService: ReorderingRulesService) {}

  @Get()
  listRules(
    @Query() query: { warehouseId?: string; status?: 'all' | 'breached' | 'normal'; q?: string },
    @Req() req: RequestWithAuth,
  ) {
    return this.reorderingService.listRules(
      {
        warehouseId: query.warehouseId ? Number(query.warehouseId) : undefined,
        status: query.status,
        q: query.q,
      },
      req.authContext!,
    );
  }

  @Post()
  createRule(@Body() dto: CreateReorderingRuleDto, @Req() req: RequestWithAuth) {
    return this.reorderingService.createRule(dto, req.authContext!);
  }

  @Put(':id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateReorderingRuleDto, @Req() req: RequestWithAuth) {
    return this.reorderingService.updateRule(Number(id), dto, req.authContext!);
  }

  @Delete(':id')
  deleteRule(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.reorderingService.deleteRule(Number(id), req.authContext!);
  }

  @Post('run')
  runEvaluation(@Body() dto: RunReorderingEvaluationDto, @Req() req: RequestWithAuth) {
    return this.reorderingService.runEvaluation(dto, req.authContext!);
  }
}
