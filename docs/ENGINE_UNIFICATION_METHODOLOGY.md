# Engine Unification Methodology

Status: written 2026-11-08 at HEAD `30a84e93` (U4 closed: 328 INV lines,
guard L196 = `INV-PAYROLL-EOS-DEDUP`), package G6 of unification batch U7.
Source: `~/AGENTS.md` + `~/MEMORY.md` + `~/workspace/audit/zs-accounting/engine-unification-methodology-guard-plan.md`
(Phase 6) + the U1–U4 merge notes. Phase 6 exit gate: one methodology file
with every rule tied to evidence (a SHA, a merge note, or a dated entry).

Scope: this file records HOW the money-engine unification was done (the
batch machine). It does NOT duplicate the repo's house rules in
`AGENTS.md` (UI standards, migration numbering, document-number format,
performance constitution) — those stay there and are referenced, not copied.
Money engines here mean: canonical rounding, currency conversion / FX
resolution, tax, costing / WAC, posting digits, landed cost. Non-money
engines (inventory, manufacturing, maritime, HR, pharmacy, maintenance
logic) are out of scope for unification by decision.

Rules are numbered R1–R25 with stable headings so
`backend/test/critical/methodology-doc.spec.ts` can pin them. When a new
lesson is proven, add a rule here WITH its evidence in the same package and
extend the pinning spec in that package — an undocumented lesson is
re-broken by the next session that lacks the context.

## R1 — Scope: money engines only

Unification covers money engines only: canonical rounding, FX conversion /
rate resolution, tax, costing / WAC, posting digits, landed cost.
Inventory / manufacturing calculations, inline cash-variance logic in
settlement paths, and frontend / backend duplication outside money stay out
of this programme. Evidence: MEMORY.md (money-engine unification scoped to
MONEY engines only, 2026-11-01) and the Phase 0 plan §1.

## R2 — Spirit of the law (highest, whole system)

Money, balances, digits, and postings are strict with no leniency. Daily
workflow rules serve the real human merchant: warn or allow with a recorded
reason or override instead of blocking real work for a formal rule; guards
block only real loss or fraud. Evidence: user decision 2026-11-04,
SPIRIT Q1–Q12 decided and executed (14 packages, base `36688dc2`, closed
and verified live 2026-11-04 at `98467f80`).

## R3 — One canonical engine per computation

Each computation has ONE canonical implementation and every caller uses it.
A second implementation of the same computation is a defect even when its
result happens to match today, because the two copies drift apart silently.
Evidence: `docs/ENGINE_MAP.md` header (live at HEAD `30a84e93`).

## R4 — Root-cause grouping

When forming a batch, group problems by SHARED ROOT CAUSE first. Any
problems sharing one root cause get fixed ONCE in the canonical place and
generalized to all occurrences, in ONE package, instead of one package per
occurrence. Genuinely separate defects still get their own packages.
Evidence: user correction 2026-11-06, methodology fix; governs Batch 7
onward and every future coordinator's grouping.

## R5 — No generalization before the correct variant is known

A behavior cannot be generalized until the correct variant is known (policy
decision + a spec pinning it), or the wrong behavior spreads everywhere.
Evidence: user correction 2026-11-06 (same entry as R4).

## R6 — Spec before move; typecheck is not proof

The spec drives the real code and proves the fix: it must fail without the
fix and pass with it (fail-without-fix proof is a required gate). A
typecheck exit 0 alone is not proof of anything financial. A value-only
spec that cannot distinguish the duplicate from the engine is not enough —
pin the routing (e.g. counting wrappers), as U4 R1 did. Evidence: repo
`AGENTS.md` §13 ("TypeCheck Is Never Business Proof"); U4 merge notes,
R1 section (commit `30a84e93`).

## R7 — Fixes are prospective only

Never rewrite posted journals or closed periods. Old postings stay as-is;
fixes apply to new postings only. Evidence: standing rule in MEMORY.md
(Batches section).

## R8 — No hardcoded FX rate

No exchange rate may ever be hardcoded in code. Every rate resolves live
through the shared resolver (`resolveFxRate` / `convertFxAmount`). The rate
the system was built against moved from 48.5 to 56 EGP per USD. Evidence:
MEMORY.md (FX HARDCODE BAN).

## R9 — Hands-off background-knockout.ts

NEVER touch `frontend/src/shared/utils/background-knockout.ts` or the
instant cut path. All background-removal work stays in the AI engine
(`ai-background-removal.ts`) only. Every package diff must show zero hunks
in that file, or the package is NOT accepted. Evidence: user directive
2026-10-31 (highest priority, all chats); `~/AGENTS.md` instant-engine
hands-off entry.

## R10 — Batch shape: five disjoint packages, strict order

Up to 5 separate, disjoint packages per batch (U7 has 4), applied in strict
order, each verified live on its own; any failure stops the batch at that
package; earlier ones stay. No long single-branch accumulation. One file
belongs to one package per batch; the same file may be touched again in a
later batch, never in the same batch. Evidence: MEMORY.md (Batches);
`~/AGENTS.md` parallel-generation rule (user decision 2026-11-06 15:44).

## R11 — Parallel generation, serialized shared writes

ONE agent per package is the right granularity — the fix and the spec are
ONE coupled unit (the spec proves the fix). Parallelize ACROSS packages
(disjoint files), never within one. Generation runs in SEPARATE worktrees
on the same verified base; parallel subagents must never share one clone
for git operations (ref/index lock collision, 2026-10-30). The SHARED
writes — the invariant file and the guard-spec L196 — are serialized at
merge; the EOF-append conflict rule binds the merge, never generation.
Evidence: `~/AGENTS.md` (parallel generation rule, granularity rule,
2026-11-06 lesson correction); U4 merge notes (OOM note aside, generation
in separate worktrees worked).

## R12 — Verify on receipt

The fix chat verifies each package IMMEDIATELY when its agent delivers it:
`git apply --check` on the verified live HEAD, files byte-identical to the
patch, 0 hunks in `background-knockout.ts`, no agent change to
`ARCHITECTURE_INVARIANTS.md` or `architecture-guard.spec.ts` (except G7,
whose subject IS the guard), no `node_modules` in the patch, spec file
present. Confirm it or send it back with the exact problem — never wait for
the other packages. Evidence: user decision 2026-11-06 16:15.

## R13 — Guard-tail rule (atomic with the invariant append)

`backend/test/critical/architecture-guard.spec.ts` L196 asserts the LAST
`- INV-` line of `ARCHITECTURE_INVARIANTS.md` equals a hardcoded expected
id. Every package that appends an invariant line MUST update L196 to its
own INV id in the SAME commit, or CI goes red. The invariant append and
the L196 update are one atomic change per package. Evidence: proven
2026-11-05, Batch 1 CI failure run 42088129841 (L196 still expected
`INV-CLOSED-SHIFT-POST-CLOSE-REFRESH` after 5 commits appended their
lines).

## R14 — Merge is a pipeline, not wait-for-all

Merge each package as soon as it finishes, in strict order 1←5, with merge
running alongside generation. A merge failure stops only that package.
Order still binds (L196 must end at the last package's id, every
intermediate state consistent) — only the waiting was removed. Evidence:
user decision 2026-11-06 16:01.

## R15 — Direct push: one push event per batch

Muse pushes directly to main via the SSH deploy key — all package commits
in ONE push event, so CI runs exactly once per batch (GitHub counts pushes,
not commits). Push gates per package: no deleted file, no binary file, no
`background-knockout.ts`. Verify live HEAD immediately before push. The
user can revoke the key anytime by deleting the deploy key; the push_files
flow remains the fallback. SSH setup: ALWAYS invoke with
`ssh -F /home/hatch/.ssh/config` (git:
`GIT_SSH_COMMAND="ssh -F /home/hatch/.ssh/config"`); Host alias
`github-new` → `ssh.github.com:443`, key `id_ed25519_zs_new`, fingerprint
`SHA256:b8h6Jq0n6OyIp2Gk8Jpw+rMytzEKm4PLkpFgynAWCNo`, repo `8489mz/zs`.
Deploy keys are ONE repo only. Evidence: user decisions 2026-11-06 17:23
(direct-push model) and 2026-11-07 19:5x (SSH deploy-key push, supersedes
push_files + approval cards); U4 push 2026-11-08 ~11:18 EET
(`fa585416..30a84e93`, one push event).

## R16 — Two-stage CI: fast opens the next batch, full gates deploy

CI is split into a FAST stage (architecture / contract guards + typecheck —
green in minutes) that OPENS the next batch's generation, and the FULL CI
that stays the DEPLOY gate. Path-based triggering: a frontend-only change
does not run the whole backend, EXCEPT the API-contracts check, which
depends on the backend and is not skipped with it. Evidence: user decision
2026-11-06 15:25; split landed as `575349a0`, repaired as `73bf61a6`;
first-ever ci-full run green on `fa585416` (U3 close, 2026-11-08 ~10:14 EET).

## R17 — CI fail-fast

When one CI job fails, CANCEL the other still-running job immediately so it
stops burning Actions minutes, then fix the failed one — never let a
sibling job run to completion after its counterpart already failed the run.
Evidence: user directive 2026-11-07 ~20:33, proven on Batch 15 CI #2813.

## R18 — Never ask for decisions

Muse never asks the user for a decision. For anything that needs a
decision, Muse decides in his place and acts immediately on the recommended
option, without asking first. Record each decision + reason in merge notes /
memory so it stays reviewable. Evidence: user directive 2026-11-07 12:57
EET (highest standing rule, all chats); full-autonomy order 2026-11-07
~20:29 EET (never stop, never ask, never wait for a tap).

## R19 — Stop on failure; report the literal error

On any failure, stop and report the literal error without fixing it
silently. Never push a single package alone — gather a full batch and push
in ONE push event. A stop or pause order overrides chaining and autonomy:
stop instantly. Evidence: full-autonomy order 2026-11-07 ~20:29 EET;
Antigravity chaining rule (`~/AGENTS.md`, user directive 2026-11-02).

## R20 — Proof environment

Backend typecheck + specs run locally via ts-node (no jest binary exists).
Frontend typecheck / build NEVER run locally — they OOM on this VM (heap
limit, exit 134, proven 3x in Batch 6); GitHub CI after each push is the
frontend typecheck proof. Never retry frontend checks locally. Heavy
spec / tsc runs use `NODE_OPTIONS=--max-old-space-size=2048`. Max 3 package
agents running at once on the 8 GB VM (U4 had OOM kills with 5).
Evidence: `~/AGENTS.md` (frontend-tsc entry, user directive 2026-11-06);
U4 merge notes (exit 137 kills, mitigation that worked).

## R21 — Spec harness rules

PGlite specs tear down with `db.destroy()` only: an extra `pg.close()`
throws "PGlite is closed" and masks the real test result. Never build an
expected date string from UTC `toISOString()` after local-midnight
`setHours(0,0,0,0)` — in UTC+2 it yields the previous day; build the date
string from local calendar parts (`getFullYear` / `getMonth` / `getDate`).
When a shared posting / service method changes, grep ALL its spec callers
(`test/` including acceptance specs) and run every one. A spec driving a
transactional service method whose internals read `this.db` (pool handle)
inside the service's own open transaction hangs silently on PGlite (single
connection serialises) — use direct-helper specs + a live-Postgres
rehearsal item for the posting branch. Evidence: `~/AGENTS.md`
(timezone-date-keys entry 2026-11-04, shared-method entry 2026-10-31,
PGlite-harness entry 2026-11-04).

## R22 — Patch mechanics

Generate patches mechanically (apply the edits to the worktree,
`git diff` into the patch file, restore, prove with
`git apply --check`). Never hand-write unified-diff hunk headers —
hand-computed line counts were wrong in 5 of 6 hunks once. Never
`git add -A` in a worktree that holds a `node_modules` symlink (stage
explicit paths only); before EVERY commit and before delivering ANY patch,
verify `git status` shows no `node_modules` entry and
`grep -c node_modules <patch>` is 0. Never `git stash` in a batch (shared
across worktrees — use `cp` backups). Never restore a mutation with
`git checkout -- <file>` on a file holding uncommitted package work (it
discards ALL uncommitted edits in that file — back the file up with `cp`
first, or reverse the mutation with the same targeted edit). EOF-append
patches conflict by construction: two packages appending to
`ARCHITECTURE_INVARIANTS.md` from the SAME base always conflict on the
second apply — generate sequentially in ONE worktree on one chained base,
re-verify live HEAD immediately before generating, and never ship
stale-base patches. Rebase recovery for an EOF-append-only conflict:
abort the rebase and re-apply the patch fresh on the live HEAD instead of
resolving markers by hand. Evidence: `~/AGENTS.md` (hunk-header, stash,
node_modules-symlink, EOF-append, rebase-recovery entries, 2026-11-01 –
2026-11-05).

## R23 — Live verification, never a relayed SHA

Never trust a relayed commit SHA suffix — verify identity from the live
repo (`git fetch` + `rev-parse` + diff). A package is closed only on live
verification, never on a relayed report or Antigravity opinion. Evidence:
MEMORY.md (standing rules, Batches); `~/AGENTS.md` (EOF-append entry).

## R24 — Spec and deliverable hygiene

Spec header prose goes inside a `/* ... */` block comment only, never as
bare text before the imports — bare header prose is a syntax error the user
has had to fix at apply time (five specs). Deliverable file names are
English, exactly as downloaded, and UNIQUE per package — every delivered
file carries the package slug in its name (a generic name collides in
Downloads with `(1)` and Antigravity may read the stale file). Code, comments,
invariant notes, spec headers, error strings, and filenames stay English;
only the explanatory reply stays in simple Arabic. Every package-delivery
reply ends with the short Antigravity reminder block (full standing text:
`~/workspace/audit/zs-accounting/antigravity-standing-instructions.md`).
The new-chat handoff prompt
(`~/workspace/audit/zs-accounting/new-chat-handoff-prompt.md`) is a
SNAPSHOT: refresh it whenever a package is verified live or a decision is
made; each refresh REPLACES the whole state section instead of appending.
Evidence: `~/AGENTS.md` (spec-header, unique-filenames, handoff-prompt
entries, 2026-10-31 – 2026-11-02).

## R25 — Back-to-back batch pushes

When several batches are generated in parallel and ready together, push them back-to-back in strict order: each batch is rebased onto the live head and re-verified before its push, with no CI wait between pushes.
Run ONE ci-full + ONE deploy on the last head only.
Pushes cancel prior fast runs (`concurrency: cancel-in-progress: true` per ref), and ci-full never runs on push — it is dispatch-only, so the parent dispatches it once on the last head.
If the final ci-full fails, bisect locally against each batch head to attribute the failure.
Scope: parallel-ready batches only — sequential batches still get per-batch full CI.
Evidence: parent decision 2026-11-08 ~12:05 EET (U5–U7); `batch-u567-state.md`; saving ≈75 min wall-clock (2× full CI + 2× deploy + fast cancellations).

## Evidence index (where each rule comes from)

| Rule | Source |
|---|---|
| R1 | MEMORY.md, money-engine scope (2026-11-01); Phase 0 plan §1 |
| R2 | User decision 2026-11-04; SPIRIT Q1–Q12, base `36688dc2` → `98467f80` |
| R3 | `docs/ENGINE_MAP.md` header, live at `30a84e93` |
| R4, R5 | User correction 2026-11-06 (root-cause grouping) |
| R6 | Repo `AGENTS.md` §13; U4 R1, commit `30a84e93` |
| R7 | MEMORY.md, Batches (prospective only) |
| R8 | MEMORY.md, FX HARDCODE BAN (48.5 → 56) |
| R9 | User directive 2026-10-31; `~/AGENTS.md` hands-off entry |
| R10 | MEMORY.md, Batches; `~/AGENTS.md` 2026-11-06 15:44 |
| R11 | `~/AGENTS.md` (parallel generation, granularity, 2026-11-06 lesson) |
| R12 | User decision 2026-11-06 16:15 (verify-on-receipt) |
| R13 | Proven 2026-11-05, Batch 1 CI run 42088129841 |
| R14 | User decision 2026-11-06 16:01 (merge pipeline) |
| R15 | User decisions 2026-11-06 17:23 and 2026-11-07 19:5x; U4 push `fa585416..30a84e93` |
| R16 | User decision 2026-11-06 15:25; `575349a0` / `73bf61a6`; U3 close `fa585416` |
| R17 | User directive 2026-11-07 ~20:33; Batch 15 CI #2813 |
| R18 | User directives 2026-11-07 12:57 and ~20:29 EET |
| R19 | Full-autonomy order 2026-11-07 ~20:29; `~/AGENTS.md` 2026-11-02 |
| R20 | `~/AGENTS.md` (frontend-tsc OOM, 2026-11-06); U4 merge notes (exit 137) |
| R21 | `~/AGENTS.md` (PGlite, timezone, shared-method, harness entries) |
| R22 | `~/AGENTS.md` (hunk-header, stash, node_modules, EOF-append, rebase entries) |
| R23 | MEMORY.md, Batches; `~/AGENTS.md` (EOF-append entry) |
| R24 | `~/AGENTS.md` (spec-header, unique-filenames, handoff entries) |
| R25 | Parent decision 2026-11-08 ~12:05 EET (back-to-back pushes, U5–U7); `batch-u567-state.md`; `concurrency: cancel-in-progress: true` per ref |

## Out of scope (deliberately not in this file)

- Repo house rules (UI / RTL / modals, migration numbering, document-number
  format, performance constitution, deploy / backup invariants): live in
  repo `AGENTS.md` §§1–22 and stay there.
- Non-money engine unification and module domain logic: deferred by scope
  (R1).
- Capabilities documentation refresh: package C8 (same batch, U7).
- The permanent guard that enforces this methodology: package G7 (same
  batch, U7) — it pins the engine map and the forbidden patterns; this file
  is the human-readable record, the guard is the machine-enforced one.
