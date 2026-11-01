import { Controller, Get, Param, Post, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AllowAuthenticated, RequirePermissions } from '../auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../auth/interfaces/request-with-auth.interface';
import { Kysely } from 'kysely';
import { Database } from '../../database/database.types';
import { KYSELY_DB } from '../../database/database.constants';
import { Inject } from '@nestjs/common';
import { IdempotencyService, IDEMPOTENCY_STUCK_PROCESSING_MS } from './idempotency.service';

@Controller('api/operations')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class IdempotencyController {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /**
   * INV-IDEMPOTENCY-RETENTION-REVIEW-QUEUE (D5): manual review
   * queue. Read-only — nothing here retries an operation.
   */
  @Get('review-queue')
  @AllowAuthenticated()
  async listReviewQueue(@Query('limit') limit: string | undefined, @Req() req: RequestWithAuth) {
    const { tenantId, accountId } = req.authContext!;
    if (!tenantId || !accountId) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    const items = await this.idempotencyService.listOperationsNeedingReview(
      { tenantId, accountId },
      limit === undefined ? 50 : Number(limit),
    );
    return { items };
  }

  /**
   * INV-IDEMPOTENCY-RETENTION-REVIEW-QUEUE (D5): explicit staff
   * prune of terminal rows older than 30 days. No scheduler exists
   * in this codebase, so the prune is a deliberate human action,
   * gated on settings management, never automatic.
   */
  @Post('prune')
  @RequirePermissions('canManageSettings')
  async pruneTerminal(@Req() req: RequestWithAuth) {
    const { tenantId, accountId } = req.authContext!;
    if (!tenantId || !accountId) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    return this.idempotencyService.pruneTerminalOperations({ tenantId, accountId });
  }

  @Get(':operationType/:idempotencyKey/status')
  @AllowAuthenticated()
  async getOperationStatus(
    @Param('operationType') operationType: string,
    @Param('idempotencyKey') idempotencyKey: string,
    @Req() req: RequestWithAuth
  ) {
    const { tenantId, accountId } = req.authContext!;
    if (!tenantId || !accountId) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const execution = await this.db
      .selectFrom('operation_executions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('account_id', '=', accountId)
      .where('idempotency_key', '=', idempotencyKey)
      .where('operation_type', '=', operationType)
      .executeTakeFirst();

    if (!execution) {
      return { status: 'not_found' };
    }

    const response = {
      status: execution.status,
      operationType: execution.operation_type,
      documentId: execution.document_id,
      response: execution.response_payload ? JSON.parse(execution.response_payload) : undefined,
    };

    if (execution.status === 'processing') {
      const ageMs = Date.now() - new Date(execution.updated_at).getTime();
      if (ageMs > IDEMPOTENCY_STUCK_PROCESSING_MS) {
        response.status = 'recovery_required';
      } else {
        (response as any).retryAfterMs = 2000; // Suggest retry in 2 seconds
      }
    }

    return response;
  }
}
