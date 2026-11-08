/*
 * G6 methodology pin (Phase 6 of the engine-unification plan): the standing
 * methodology written in docs/ENGINE_UNIFICATION_METHODOLOGY.md must keep
 * every rule R1–R25 with its heading and its evidence, and no rule section
 * may be silently dropped. A future agent that deletes or renames a rule
 * breaks this spec instead of silently losing the lesson.
 *
 * Grounded at HEAD 30a84e93 (U4 closed: 328 INV lines, guard L196
 * INV-PAYROLL-EOS-DEDUP). The doc distills ~/AGENTS.md + ~/MEMORY.md +
 * the methodology-guard plan (Phase 6) + the U1–U4 merge notes; each rule
 * cites its evidence (SHA, merge note, or dated entry) in the doc's
 * evidence index.
 *
 * Style follows backend/test/critical/engine-map-corrections.spec.ts (M0
 * precedent): plain node:assert checks run by ts-node, no test runner.
 * The spec reads the doc file on disk only; it imports no production code
 * and needs no database. Run: npx ts-node test/critical/methodology-doc.spec.ts
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

async function main(): Promise<void> {
  const docPath = path.join(REPO_ROOT, 'docs/ENGINE_UNIFICATION_METHODOLOGY.md');
  assert.ok(fs.existsSync(docPath), 'docs/ENGINE_UNIFICATION_METHODOLOGY.md must exist');
  const doc = fs.readFileSync(docPath, 'utf8');

  function present(text: string, label: string): void {
    assert.ok(doc.includes(text), `methodology doc must state: ${label}`);
  }

  function ruleHeading(number: string, title: string): void {
    present(`## ${number} — ${title}`, `rule ${number} heading "${title}"`);
  }

  // Provenance: written at a real HEAD, from named sources, with an exit gate.
  present('30a84e93', 'methodology written at HEAD 30a84e93');
  present('328 INV lines', 'INV line count at writing time');
  present('INV-PAYROLL-EOS-DEDUP', 'guard L196 at writing time');
  present('engine-unification-methodology-guard-plan.md', 'source plan file');
  present('Phase 6 exit gate', 'Phase 6 exit gate stated');

  // R1 — scope: money engines only.
  ruleHeading('R1', 'Scope: money engines only');
  present('canonical rounding', 'R1 canonical rounding in scope');
  present('landed cost', 'R1 landed cost in scope');

  // R2 — spirit of the law (highest).
  ruleHeading('R2', 'Spirit of the law (highest, whole system)');
  present('strict with no leniency', 'R2 money strict, no leniency');
  present('block only real loss or fraud', 'R2 guards block only real loss or fraud');
  present('98467f80', 'R2 SPIRIT Q1–Q12 closing SHA');

  // R3 — one canonical engine per computation.
  ruleHeading('R3', 'One canonical engine per computation');
  present('A second implementation of the same computation is a defect', 'R3 duplicate is a defect');
  present('drift apart silently', 'R3 copies drift apart silently');

  // R4 — root-cause grouping.
  ruleHeading('R4', 'Root-cause grouping');
  present('fixed ONCE in the canonical place', 'R4 fix once, canonical place');

  // R5 — no generalization before the correct variant is known.
  ruleHeading('R5', 'No generalization before the correct variant is known');
  present('or the wrong behavior spreads everywhere', 'R5 wrong behavior spreads');

  // R6 — spec before move; typecheck is not proof.
  ruleHeading('R6', 'Spec before move; typecheck is not proof');
  present('fail-without-fix proof is a required gate', 'R6 fail-without-fix gate');
  present('30a84e93', 'R6 U4 R1 precedent commit');

  // R7 — fixes are prospective only.
  ruleHeading('R7', 'Fixes are prospective only');
  present('Never rewrite posted journals or closed periods', 'R7 prospective only');

  // R8 — no hardcoded FX rate.
  ruleHeading('R8', 'No hardcoded FX rate');
  present('48.5 to 56 EGP per USD', 'R8 rate moved 48.5 to 56');

  // R9 — hands-off background-knockout.ts.
  ruleHeading('R9', 'Hands-off background-knockout.ts');
  present('frontend/src/shared/utils/background-knockout.ts', 'R9 hands-off file path');
  present('zero hunks', 'R9 zero hunks required');

  // R10 — batch shape: five disjoint packages, strict order.
  ruleHeading('R10', 'Batch shape: five disjoint packages, strict order');
  present('any failure stops the batch at that', 'R10 failure stops the batch');

  // R11 — parallel generation, serialized shared writes.
  ruleHeading('R11', 'Parallel generation, serialized shared writes');
  present('never share one clone', 'R11 never share one clone');
  present('ONE agent per package', 'R11 one agent per package');

  // R12 — verify on receipt.
  ruleHeading('R12', 'Verify on receipt');
  present('git apply --check', 'R12 apply-check on receipt');
  present('files byte-identical to the', 'R12 byte-identical files');

  // R13 — guard-tail rule (atomic with the invariant append).
  ruleHeading('R13', 'Guard-tail rule (atomic with the invariant append)');
  present('L196', 'R13 guard L196');
  present('42088129841', 'R13 Batch 1 CI failure run');
  present('one atomic change per package', 'R13 atomic change');

  // R14 — merge is a pipeline, not wait-for-all.
  ruleHeading('R14', 'Merge is a pipeline, not wait-for-all');
  present('in strict order 1←5', 'R14 strict merge order');

  // R15 — direct push: one push event per batch.
  ruleHeading('R15', 'Direct push: one push event per batch');
  present('ONE push event', 'R15 one push event per batch');
  present('ssh -F /home/hatch/.ssh/config', 'R15 SSH config flag');
  present('SHA256:b8h6Jq0n6OyIp2Gk8Jpw+rMytzEKm4PLkpFgynAWCNo', 'R15 deploy key fingerprint');

  // R16 — two-stage CI.
  ruleHeading('R16', 'Two-stage CI: fast opens the next batch, full gates deploy');
  present('OPENS the next batch', 'R16 fast stage opens next batch');
  present('575349a0', 'R16 CI split landing SHA');

  // R17 — CI fail-fast.
  ruleHeading('R17', 'CI fail-fast');
  present('CANCEL the other still-running job immediately', 'R17 cancel sibling job');

  // R18 — never ask for decisions.
  ruleHeading('R18', 'Never ask for decisions');
  present('Record each decision + reason', 'R18 record decision + reason');

  // R19 — stop on failure; report the literal error.
  ruleHeading('R19', 'Stop on failure; report the literal error');
  present('stop instantly', 'R19 stop order overrides autonomy');

  // R20 — proof environment.
  ruleHeading('R20', 'Proof environment');
  present('NEVER run locally', 'R20 frontend checks never local');
  present('exit 134', 'R20 frontend OOM exit 134');
  present('NODE_OPTIONS=--max-old-space-size=2048', 'R20 heap flag');
  present('Max 3 package', 'R20 concurrency cap 3');

  // R21 — spec harness rules.
  ruleHeading('R21', 'Spec harness rules');
  present('tear down with `db.destroy()`', 'R21 PGlite teardown');
  present('getFullYear', 'R21 local calendar parts for dates');

  // R22 — patch mechanics.
  ruleHeading('R22', 'Patch mechanics');
  present('Never hand-write unified-diff hunk headers', 'R22 no hand-written hunks');
  present('grep -c node_modules <patch>', 'R22 node_modules patch check');
  present('Never `git stash`', 'R22 no git stash');

  // R23 — live verification, never a relayed SHA.
  ruleHeading('R23', 'Live verification, never a relayed SHA');
  present('never on a relayed report', 'R23 no relayed report as proof');

  // R24 — spec and deliverable hygiene.
  ruleHeading('R24', 'Spec and deliverable hygiene');
  present('block comment only', 'R24 spec header in block comment');
  present('UNIQUE per package', 'R24 unique filenames per package');

  // R25 — back-to-back batch pushes.
  ruleHeading('R25', 'Back-to-back batch pushes');
  present('push them back-to-back in strict order', 'R25 back-to-back in strict order');
  present('ONE ci-full + ONE deploy on the last head', 'R25 one ci-full + one deploy on last head');
  present('cancel prior fast runs', 'R25 pushes cancel prior fast runs');
  present('ci-full never runs on push', 'R25 ci-full never runs on push');
  present('bisect locally against each batch head', 'R25 bisect locally per batch head');
  present('parallel-ready batches only', 'R25 parallel-ready batches only');
  present('sequential batches still get per-batch full CI', 'R25 sequential batches keep per-batch full CI');

  // Evidence index + out-of-scope: every rule traceable, scope explicit.
  present('## Evidence index', 'evidence index section');
  present('## Out of scope', 'out-of-scope section');
  for (let n = 1; n <= 25; n += 1) {
    present(`R${n}`, `evidence index covers R${n}`);
  }

  console.log('methodology doc checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
