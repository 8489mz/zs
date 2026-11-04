/*
 * ACID format gate, strict only where required
 * (INV-MARITIME-ACID-GATE-REQUIRED-ONLY).
 *
 * THE GAP: the invariants file requires the 19-digit ACID
 * number for shipments importing into Egyptian ports, but
 * nothing enforced it -- createJob stored whatever string it
 * was given, and a missing or malformed number surfaced only
 * (if ever) at the port.
 *
 * THE RULE, two tiers: the format gate is STRICT only on
 * shipments that require the number -- imports into Egyptian
 * ports (UN/LOCODE country prefix EG). A missing or malformed
 * ACID there rejects the job before any database access.
 * Anywhere else (other destinations, exports, cross-trade) a
 * malformed supplied value only warns in the server log and
 * the job proceeds; the number is stored as supplied. The
 * format is exactly 19 digits after trimming -- no spaces or
 * hyphens inside. Quotation ACID is deliberately ungated
 * (drafts); this same gate catches it at conversion, since
 * every creation path funnels through createJob.
 *
 * WHAT THIS PINS: the pure engine's truth table, imported
 * directly (no re-implementation), plus the REAL createJob
 * gate driven on a table-less PGlite handle -- the gate
 * throws before any database access, so a passing gate fails
 * later on the missing tables instead of with an ACID error,
 * which is exactly the proof that the gate let it through.
 * Cases: Egypt-import + missing / 18-digit / lettered /
 * hyphenated ACID rejects; Egypt-import + valid 19 digits,
 * padded with spaces, passes the gate; lowercase/whitespace
 * EG port codes count; an unset direction defaults to
 * import; non-Egypt imports, Egypt exports and cross-trade
 * pass the gate with malformed values.
 *
 * HONEST LIMIT: the success path (a full job creation) is a
 * live-Postgres rehearsal item; only the gate itself is
 * proven here. Quotation ACID stays ungated by design.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import {
  evaluateAcidNumber,
  isValidAcidNumber,
  requiresAcidNumber,
} from '../../src/modules/maritime-freight/engines/acid-number.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  // 1. Pure-engine truth table.
  assert.equal(requiresAcidNumber('import', 'EGALY'), true);
  assert.equal(requiresAcidNumber('import', 'egaly'), true, 'port codes are case-insensitive');
  assert.equal(requiresAcidNumber('import', ' EGPSD '), true, 'port codes are trimmed');
  assert.equal(requiresAcidNumber('import', 'EGSOK'), true);
  assert.equal(requiresAcidNumber('import', 'SAJED'), false);
  assert.equal(requiresAcidNumber('import', ''), false);
  assert.equal(requiresAcidNumber('import', undefined), false);
  assert.equal(requiresAcidNumber('export', 'EGALY'), false);
  assert.equal(requiresAcidNumber('cross_trade', 'EGALY'), false);
  assert.equal(requiresAcidNumber('IMPORT', 'EGALY'), true, 'direction is case-insensitive');

  assert.equal(isValidAcidNumber('1234567890123456789'), true);
  assert.equal(isValidAcidNumber('  1234567890123456789  '), true, 'surrounding spaces trim away');
  assert.equal(isValidAcidNumber('123456789012345678'), false, '18 digits');
  assert.equal(isValidAcidNumber('12345678901234567890'), false, '20 digits');
  assert.equal(isValidAcidNumber('123456789012345678A'), false, 'a letter fails');
  assert.equal(isValidAcidNumber('1234567890-123456789'), false, 'a hyphen fails');
  assert.equal(isValidAcidNumber('1234 567890123456789'), false, 'an inner space fails');
  assert.equal(isValidAcidNumber(''), false);
  assert.equal(isValidAcidNumber(undefined), false);

  assert.deepEqual(evaluateAcidNumber('import', 'EGALY', undefined), { required: true, valid: false });
  assert.deepEqual(evaluateAcidNumber('export', 'EGALY', 'bad'), { required: false, valid: false });

  // 2. The real createJob gate, on a table-less handle: the gate
  // runs before any database access.
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const service = new MaritimeFreightService(db, {} as never, {} as never, {} as never);
  const baseDto: any = { transportMode: 'sea', containers: [], polCode: 'CNSHA', polName: 'Shanghai', podName: 'Alexandria' };

  try {
    // Required + missing / malformed: rejected with the ACID error.
    await assert.rejects(
      service.createJob(auth, { ...baseDto, direction: 'import', podCode: 'EGALY' }),
      /ACID/,
    );
    await assert.rejects(
      service.createJob(auth, { ...baseDto, direction: 'import', podCode: 'EGALY', acidNumber: '123456789012345678' }),
      /ACID/,
    );
    await assert.rejects(
      service.createJob(auth, { ...baseDto, direction: 'import', podCode: 'EGALY', acidNumber: '123456789012345678A' }),
      /ACID/,
    );
    await assert.rejects(
      service.createJob(auth, { ...baseDto, direction: 'import', podCode: 'egaly', acidNumber: '123-456' }),
      /ACID/,
    );
    // Unset direction defaults to import: still gated.
    await assert.rejects(
      service.createJob(auth, { ...baseDto, podCode: 'EGDAM' }),
      /ACID/,
    );

    // Passing the gate fails later on the missing tables -- and
    // crucially NOT with an ACID error.
    const expectTableError = async (dto: any): Promise<void> => {
      await assert.rejects(
        service.createJob(auth, dto),
        (err: any) => err instanceof Error && !/ACID/.test(err.message) && /does not exist|relation/i.test(err.message),
      );
    };
    await expectTableError({ ...baseDto, direction: 'import', podCode: 'EGALY', acidNumber: '1234567890123456789' });
    await expectTableError({ ...baseDto, direction: 'import', podCode: 'EGALY', acidNumber: '  1234567890123456789  ' });
    await expectTableError({ ...baseDto, direction: 'import', podCode: 'SAJED', acidNumber: 'bad' });
    await expectTableError({ ...baseDto, direction: 'export', podCode: 'EGALY', acidNumber: 'bad' });
    await expectTableError({ ...baseDto, direction: 'cross_trade', podCode: 'EGALY' });
    await expectTableError({ ...baseDto, direction: 'import', podCode: 'SAJED' });

    console.log('maritime ACID gate required-only checks passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
