# docs/ Index — every document in this folder

This is the **single index over the scattered docs** in `docs/`. If a document
is not listed here, it is invisible — the documentation-integrity check
(`scripts/validate-capabilities-docs.mjs`, run by
`.github/workflows/documentation-integrity.yml`) fails on any top-level
`docs/*.md` file or `docs/*/` subdirectory that has no link in this file.

Start elsewhere for the big picture: the domain index is
[SYSTEM_CAPABILITIES.md](../SYSTEM_CAPABILITIES.md) and the architecture map
is [SYSTEM_BLUEPRINT.md](../SYSTEM_BLUEPRINT.md). This page indexes only what
lives under `docs/` itself.

## Top-level docs

| Document | Purpose |
| --- | --- |
| [CLAUDE_BRAIN.md](CLAUDE_BRAIN.md) | Cognitive methodology for critical analysis and forensic auditing — how an agent thinks, not what a module does. |
| [CLIENT_DELIVERY_RUNBOOK.md](CLIENT_DELIVERY_RUNBOOK.md) | Set up, manage, back up, and troubleshoot the offline (local-server) client delivery. |
| [CODEBASE_MAP.md](CODEBASE_MAP.md) | Static map: where each thing lives and the first file to open. |
| [DEPLOYMENT_PIPELINE.md](DEPLOYMENT_PIPELINE.md) | Oracle VPS deploy pipeline: build on GitHub, ship, swap, health-check. |
| [DEVELOPMENT_MODE.md](DEVELOPMENT_MODE.md) | Local development mode with hot reload (ports and isolation). |
| [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) | Disaster recovery: rebuild on a new server from encrypted backups (full guide). |
| [DTO_AUTHORING_CONTRACT.md](DTO_AUTHORING_CONTRACT.md) | DTO authoring contract: every @Body() payload arrives as a decorated class — caller-verified fields, @IsOptional rules, boolean care, and the 9 pinned exclusions. |
| [ENGINE_MAP.md](ENGINE_MAP.md) | Canonical money engines — the single approved implementation per financial computation. |
| [ENGINE_UNIFICATION_METHODOLOGY.md](ENGINE_UNIFICATION_METHODOLOGY.md) | Method of the engine-unification work: how the canonical engines were derived. |
| [FIRE_DRILL_PLAYBOOK.md](FIRE_DRILL_PLAYBOOK.md) | One-page server-down runbook: six steps to restore the live DB from encrypted backups. |
| [LIVE_SAAS_OPERATIONS_CHECKLIST.md](LIVE_SAAS_OPERATIONS_CHECKLIST.md) | Live SaaS operations: production safety, monitoring, and emergency procedures on Oracle. |
| [LOAD_TESTING.md](LOAD_TESTING.md) | k6 load and stress testing guide (deadlock-free under maximum load). |
| [MAINTENANCE_REFACTORING_REPORT.md](MAINTENANCE_REFACTORING_REPORT.md) | Historical maintenance and refactoring report (2026-08-17, v1.1.12). |
| [MODULE_DOORS.md](MODULE_DOORS.md) | Public-door inventory: what each backend module and frontend feature exposes to others. |
| [PILOT_UAT_CHECKLIST.md](PILOT_UAT_CHECKLIST.md) | Pilot-customer UAT checklist (first-run delivery checks). |
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | Production readiness: safe setup and pre-sale checks (SaaS + tenant lifecycle). |
| [PRODUCT_READINESS_STATUS.md](PRODUCT_READINESS_STATUS.md) | Product readiness verdict (offline pilot ready; scope and status). |
| [SAAS_ENTITLEMENTS_FUTURE_PLAN.md](SAAS_ENTITLEMENTS_FUTURE_PLAN.md) | Future plan: centralised entitlements and plan management (not built). |
| [SAAS_TRIAL_FOUNDATION.md](SAAS_TRIAL_FOUNDATION.md) | SaaS trial and tenant lifecycle foundation (current state). |
| [sentry-live-check.md](sentry-live-check.md) | Sentry live enablement: wiring, deploy gap fix, and the owed live checks (project, DSN, Telegram alerts). |
| [STOCK_MOVEMENTS_WRITES.md](STOCK_MOVEMENTS_WRITES.md) | Inventory of every direct `stock_movements` write (68) with pairing flags. |
| [UI_DESIGN_SYSTEM_RULES.md](UI_DESIGN_SYSTEM_RULES.md) | Enterprise UI design-system rules (premium look, consistency). |

## Subdirectories

| Directory | Purpose |
| --- | --- |
| [archive/](archive/) | Superseded checklists and sign-offs — historical, do not follow. |
| [audit/](audit/) | October 2026 remediation execution and status records. |
| [audit_packs/README.md](audit_packs/README.md) | Engineering audit packs for deep AI-assisted review. |
| [audits/](audits/) | Dated architecture audit handoffs and fix statuses. |
| [capabilities/README.md](capabilities/README.md) | Capability-documentation protocol, registry, and migration manifest. |
| [changelogs/](changelogs/) | Per-batch changelogs. |
| [hr/](hr/) | HR fix records. |
| [reviews/README.md](reviews/README.md) | Live per-module verification register. |

## Rules for adding a doc

1. Put the file under `docs/` (or the subfolder it belongs to) and add one row
   here with a one-line purpose — the integrity check fails until you do.
2. Do not create a second index: this file is the only index for `docs/`.
   The central domain index ([SYSTEM_CAPABILITIES.md](../SYSTEM_CAPABILITIES.md))
   points here with a single line; it does not duplicate these rows.
3. If a document goes stale, fix it in place or mark it superseded and move
   it to `archive/` — do not leave a stale claim in an indexed doc.
