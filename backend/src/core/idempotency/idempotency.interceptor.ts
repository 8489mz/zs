import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { IdempotencyService } from './idempotency.service';
import { RequestWithAuth } from '../auth/interfaces/request-with-auth.interface';
import { idempotencyStorage } from './idempotency.context';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly idempotencyService: IdempotencyService) {}

  /**
   * INV-IDEMPOTENCY-FINALIZE-AWAITED: the business work committed,
   * but its result could not be recorded (finalize failed). The
   * response is still the committed result — failing the request
   * now would invite a retry against an operation whose work is
   * already done. The row is marked recovery_required (guarded:
   * only from 'processing') and the failure is logged loudly, so a
   * retry gets a clear 422 instead of spinning on 'processing'.
   */
  private async flagFinalizeFailure(reservation: {
    tenantId: string;
    accountId: string;
    idempotencyKey: string;
    operationType: string;
  }, finalizeErr: unknown): Promise<void> {
    this.logger.error(
      `Idempotency finalize failed for key=${reservation.idempotencyKey} operation=${reservation.operationType}: ${(finalizeErr as any)?.message || finalizeErr}`,
    );
    try {
      await this.idempotencyService.markRecoveryRequired(reservation, 'IDEMPOTENCY_FINALIZE_FAILED');
    } catch (markErr: any) {
      this.logger.error(
        `Idempotency recovery marking failed for key=${reservation.idempotencyKey}: ${markErr?.message || markErr}`,
      );
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const idempotencyKey = request.headers['x-idempotency-key'] as string;

    // Only apply if key is provided and user is authenticated
    if (!idempotencyKey || !request.authContext) {
      return next.handle();
    }

    const method = (request.method || '').toUpperCase();
    // Non-mutating read-only HTTP methods must not reserve idempotency operations
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    const { tenantId, accountId } = request.authContext;
    const routePath = request.route?.path || request.path || '';
    const operationType = `${request.method}:${routePath}`;
    const requestHash = this.idempotencyService.generateRequestHash(request.body, request.params);

    const reservation = {
      tenantId: tenantId || '',
      accountId: accountId || '',
      idempotencyKey,
      operationType,
      requestHash,
    };

    return from(this.idempotencyService.reserveOperation(reservation)).pipe(
      switchMap((existingResult) => {
        if (existingResult) {
          if (existingResult.status === 'committed') {
            return of(existingResult.responsePayload);
          } else if (existingResult.status === 'failed') {
            // Return stored failure
            return throwError(() => new HttpException(
              existingResult.responsePayload || existingResult.errorCode || 'Operation previously failed',
              HttpStatus.BAD_REQUEST
            ));
          } else if (existingResult.status === 'processing') {
            return throwError(() => new ConflictException('Operation is currently processing'));
          } else if (existingResult.status === 'recovery_required') {
            return throwError(() => new HttpException('Operation requires manual recovery', HttpStatus.UNPROCESSABLE_ENTITY));
          }
        }

        // Proceed to handler if reserved, wrapping in AsyncLocalStorage context
        return new Observable<any>((subscriber) => {
          idempotencyStorage.run(
            { idempotencyKey, operationType, accountId: reservation.accountId },
            () => {
              // INV-IDEMPOTENCY-FINALIZE-AWAITED: the finalize is
              // awaited BEFORE the response is emitted. The old
              // fire-and-forget tap() let the response (and a fast
              // retry) outrun the commit, and swallowed finalize
              // failures left the row stuck on 'processing'.
              next.handle().pipe(
                switchMap((res) =>
                  from(this.idempotencyService.finalizeIfStillProcessing(reservation, res)).pipe(
                    map(() => res),
                    catchError((finalizeErr) =>
                      from(this.flagFinalizeFailure(reservation, finalizeErr)).pipe(map(() => res)),
                    ),
                  ),
                ),
                catchError((err) => {
                  const errorCode = (err && (err.code || err.name)) ? String(err.code || err.name) : 'UNKNOWN_ERROR';
                  const errorPayload = typeof err?.getResponse === 'function'
                    ? err.getResponse()
                    : { message: err?.message || 'Operation failed' };

                  return from(
                    this.idempotencyService.recordFailure(
                      reservation,
                      errorCode,
                      errorPayload
                    )
                  ).pipe(
                    switchMap(() => throwError(() => err)),
                    catchError(() => throwError(() => err))
                  );
                })
              ).subscribe(subscriber);
            }
          );
        });
      })
    );
  }
}
