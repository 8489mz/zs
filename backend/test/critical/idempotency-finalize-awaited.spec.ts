/*
 * INV-IDEMPOTENCY-FINALIZE-AWAITED: the interceptor must AWAIT the
 * finalize before emitting the handler's response, and must never
 * swallow a finalize failure silently.
 *
 * THE RACE (old code): the success path finalized inside a
 * fire-and-forget tap() whose async callback RxJS does not await,
 * with an empty catch. The response could reach the caller (and a
 * fast retry could read 'processing' -> 409) before the commit
 * landed, and a finalize DB failure left the row stuck on
 * 'processing' forever with no trace — the original caller believed
 * it succeeded, and every retry escalated to 422 recovery_required
 * with the successful result unretrievable.
 *
 * WHAT THIS PINS, driving the REAL interceptor with a stub
 * IdempotencyService (the ordering is the behaviour under test;
 * the guarded UPDATE itself is finalizeIfStillProcessing's):
 * 1. The response is NOT emitted until finalize resolves (a
 *    deferred finalize gates the emission).
 * 2. When finalize resolves, it ran with the reservation and the
 *    handler's result, and the response is that result.
 * 3. When finalize rejects, the committed result is still
 *    returned, the row is flagged recovery_required, and the
 *    failure is logged loudly.
 *
 * Deliberately NOT covered here: the failure path's recordFailure
 * (already awaited), the 60s processing->recovery_required
 * escalation in reserveOperation, and the D5 30-day prune / manual
 * review queue (separate approved package).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { firstValueFrom, of } from 'rxjs';
import { IdempotencyInterceptor } from '../../src/core/idempotency/idempotency.interceptor';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

function buildRequest(): any {
  return {
    headers: { 'x-idempotency-key': 'key-1' },
    authContext: { tenantId: 't-1', accountId: 'a-1' } as AuthContext,
    method: 'POST',
    route: { path: '/sales' },
    path: '/sales',
    body: { amount: 10 },
    params: {},
  };
}

function buildContext(request: any): any {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

function deferred<T = void>(): { promise: Promise<T>; release: (value: T) => void } {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function main(): Promise<void> {
  // Case 1: response waits for finalize.
  {
    const gate = deferred<void>();
    const finalizeCalls: any[] = [];
    const stub: any = {
      generateRequestHash: () => 'hash-1',
      reserveOperation: async () => null,
      finalizeIfStillProcessing: async (...args: any[]) => {
        finalizeCalls.push(args);
        await gate.promise;
      },
      markRecoveryRequired: async () => {
        throw new Error('must not be called on the success path');
      },
    };
    const interceptor = new IdempotencyInterceptor(stub);
    const outcome = firstValueFrom(
      interceptor.intercept(buildContext(buildRequest()), { handle: () => of('OK') } as any),
    );
    let settled = false;
    outcome.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(settled, false, 'response must not be emitted before finalize resolves');
    assert.equal(finalizeCalls.length, 1, 'finalize must have been called exactly once');
    assert.equal(finalizeCalls[0][1], 'OK', 'finalize must record the handler result');
    gate.release();
    assert.equal(await outcome, 'OK');
  }

  // Case 2: finalize failure still returns the result, flags recovery, logs loudly.
  {
    const recoveryCalls: any[] = [];
    const errorCalls: string[] = [];
    const stub: any = {
      generateRequestHash: () => 'hash-1',
      reserveOperation: async () => null,
      finalizeIfStillProcessing: async () => {
        throw new Error('DB unavailable');
      },
      markRecoveryRequired: async (...args: any[]) => {
        recoveryCalls.push(args);
      },
    };
    const interceptor = new IdempotencyInterceptor(stub);
    (interceptor as any).logger = { error: (message: string) => errorCalls.push(String(message)) };
    const result = await firstValueFrom(
      interceptor.intercept(buildContext(buildRequest()), { handle: () => of('PAID') } as any),
    );
    assert.equal(result, 'PAID', 'the committed result must still be returned');
    assert.equal(recoveryCalls.length, 1, 'the row must be flagged recovery_required');
    assert.equal(recoveryCalls[0][1], 'IDEMPOTENCY_FINALIZE_FAILED');
    assert.ok(errorCalls.some((message) => message.includes('DB unavailable')), 'the finalize failure must be logged');
    assert.ok(errorCalls.some((message) => message.includes('key-1')), 'the log must name the key');
  }

  // Case 3: happy path — finalize once, no recovery flagging.
  {
    const recoveryCalls: any[] = [];
    const finalizeCalls: any[] = [];
    const stub: any = {
      generateRequestHash: () => 'hash-1',
      reserveOperation: async () => null,
      finalizeIfStillProcessing: async (...args: any[]) => {
        finalizeCalls.push(args);
      },
      markRecoveryRequired: async (...args: any[]) => {
        recoveryCalls.push(args);
      },
    };
    const interceptor = new IdempotencyInterceptor(stub);
    const result = await firstValueFrom(
      interceptor.intercept(buildContext(buildRequest()), { handle: () => of({ id: 5 }) } as any),
    );
    assert.deepEqual(result, { id: 5 });
    assert.equal(finalizeCalls.length, 1);
    assert.equal(recoveryCalls.length, 0);
  }

  console.log('idempotency finalize-awaited checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
