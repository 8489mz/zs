# Sentry live check — Item 7 (weakness-fix chain, plan §12.10)

> Repo note (2026-11-18, final-3 Package 2, INV-SENTRY-LIVE-CHECK-FILE): this file was written in the audit workspace at `e3dbdeee3` and is added to the repo here. The Item 7 package has since landed on main as `ef3a365fe` (fallback queue, after Deploy #93); DEPLOY-9 (migration auto-revert, `691f45ab6`), DEPLOY-10 and DEPLOY-11 are all live. The owed checks in §3 and §7.4 remain NOT DONE — that is what this file records.

- Date: 2026-11-18. Base HEAD: `e3dbdeee3` (verified via `git ls-remote` at dispatch; worktree `~/workspace/audit/zs-weakness-item7-wt`, detached HEAD `e3dbdeee3`, clean before work).
- Extended 2026-11-18 ~18:10 — Telegram alerts (user decision 18:10): same package, amended into the same commit, no new invariant id. New section §7 below; the how-to gained a 6th step; repo side gained a Telegram check script + DEPLOY-11.
- Verdict: **code is wired correctly on both sides, but the live state is UNKNOWN, and one real code gap was found and fixed** — the deploy workflow never passed the Sentry DSN into the frontend build, so the live frontend bundle could never report errors. Package built at `e3dbdeee3` and landed on main as `ef3a365fe` (see §5).

## 1. Wiring — verified in code at e3dbdeee3

### Backend (NestJS) — wired, fail-closed
- `backend/src/main.ts:42-46` — `Sentry.init` runs only when `process.env.ERROR_TRACKING_ENABLED === 'true'` **and** `process.env.SENTRY_DSN` is set. `tracesSampleRate: 0`, `profilesSampleRate: 0`. `environment` defaults to `'production'`, `release` from `SENTRY_RELEASE`.
- `backend/src/main.ts:47-96` — `beforeSend` redacts auth headers (`authorization`, `cookie`, `session-id`, `csrf-token`), all cookies, and body keys containing `password` / `token` / `secret` / `connection` / `smtp` / `db`.
- `backend/src/common/filters/global-exception.filter.ts:69-72` — unhandled exceptions are captured via `Sentry.captureException`.
- `backend/src/config/env.schema.ts:61-65` — `SENTRY_DSN` (default `''`), `SENTRY_ENVIRONMENT` (default `'production'`), `SENTRY_RELEASE`, `SENTRY_SAMPLE_RATE` (default `0.1`), `ERROR_TRACKING_ENABLED` (boolean string). Lines `203-204`: **startup throws** `SENTRY_DSN must be configured when ERROR_TRACKING_ENABLED=true` — enabling without a DSN is rejected, not silently off.
- `backend/package.json:69` — `@sentry/node ^10.64.0` installed.
- `backend/.env.example:52-59` and `.env.production.example:37-41` document `ERROR_TRACKING_ENABLED=false` + empty `SENTRY_DSN`.

### Frontend (React/Vite) — wired, lazy, fail-closed
- `frontend/src/lib/error-tracking.ts` — `isErrorTrackingEnabled()` requires `VITE_ERROR_TRACKING_ENABLED === 'true'` **and** `VITE_SENTRY_DSN`; `@sentry/react` is loaded by dynamic `import()` only when enabled (PERF-7 — the SDK never enters the startup bundle otherwise). `Sentry.init` with `tracesSampleRate: 0`, `replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 0`.
- `frontend/src/main.tsx:7,10` — `initErrorTracking()` is called at app startup. Wiring is real, not dead code.
- `frontend/package.json:65` — `@sentry/react ^10.64.0` installed. `frontend/vite.config.ts:221` chunks it into `vendor-sentry`.
- `frontend/.env.production.example` documents the flags (`VITE_ERROR_TRACKING_ENABLED=false`, `VITE_SENTRY_DSN=` empty, environment `production`, all sample rates `0`).
- Traces / profiles / replays: **all 0, as the plan claimed** — backend traces 0 + profiles 0 (`main.ts:45-46`); frontend traces 0 + both replay rates 0 (`error-tracking.ts`). No sampling cost, no session recording.

### No runtime-config escape hatch
- There is no runtime config mechanism for the frontend (no `/config.json`, no `window.__CONFIG__` for env). Vite inlines `import.meta.env.VITE_*` **at build time**. A DSN set anywhere after the build can never reach the shipped bundle. This is what makes the deploy-path gap below decisive.

## 2. Deploy path — THE GAP (fixed in this package)

- `.github/workflows/deploy-oracle.yml`, "Build frontend" step (was lines 69-81): passed only **four** `VITE_` vars — `VITE_API_BASE_URL`, `VITE_CSRF_COOKIE_NAME`, `VITE_PLATFORM_TENANT_ID`, `VITE_STOREFRONT_ROOT_DOMAIN`. **No `VITE_ERROR_TRACKING_ENABLED`, no `VITE_SENTRY_DSN`.**
- Consequence: even if a Sentry project existed and its DSN were stored in GitHub or on the server, the live frontend build would ship with tracking off. The frontend half of Sentry was unreachable by configuration alone.
- Backend needs no workflow change: its env comes from a **server-side `.env` file** the repo never writes (`deploy-oracle.yml` step 6 reads `$TARGET_DIR/backend/.env`, then `$TARGET_DIR/.env`, then `/var/www/zsystems/.env`; `pm2 start … --node-args="--env-file=$ENV_FILE"` on a fresh start, `pm2 reload --update-env` otherwise).
- No `SENTRY_*` name appears in any workflow or deploy script, and no Sentry secret/variable exists in the repo (names only would be visible — none are). No DSN value is committed anywhere (verified by grep; the new guard also forbids `ingest.sentry.io` in the workflow).

### The fix (landed on main as ef3a365fe — see §5)
- `deploy-oracle.yml` "Build frontend" env now passes:
  - `VITE_ERROR_TRACKING_ENABLED: ${{ vars.VITE_ERROR_TRACKING_ENABLED || 'false' }}` (GitHub **variable** — a boolean flag)
  - `VITE_SENTRY_DSN: ${{ secrets.VITE_SENTRY_DSN || '' }}` (GitHub **secret** — masked in logs)
- Defaults keep tracking **off** until both values exist. The DSN is a secret (not a var) so it never prints in build logs; it is public by design once shipped (it is embedded in the JS bundle — it can only *send* events, never read data), but there is no reason to expose it in plaintext in repo settings.
- `docs/DEPLOYMENT_PIPELINE.md` §3 (secrets table) + §4 (backend `.env` highlights + frontend build env) now list both values and where they are set.
- Guard: `backend/test/critical/deploy-pipeline.spec.ts` **DEPLOY-10** — asserts both vars reach the frontend build env with their safe defaults and forbids a literal DSN in the workflow. **DEPLOY-9 is reserved** for the pending Item 5 package (migration auto-revert, commit `0e7728d01`, not yet on main) so the two packages never collide on a number. No new spec file; the critical count is unchanged.

## 3. Live state — UNKNOWN (two checks owed, not claimable from here)

A subagent cannot SSH to the live Oracle server and cannot open the Sentry dashboard. **Do NOT claim Sentry is on or off live.** These two checks are owed to the parent (browser + server access):

### Owed check A — live server env (needs server access)
On the Oracle server, as the deploy user:
1. `grep -E '^(ERROR_TRACKING_ENABLED|SENTRY_DSN|SENTRY_ENVIRONMENT|SENTRY_RELEASE)=' /var/www/zsystems/backend/.env` (fall back to `/var/www/zsystems/.env` if the first file does not exist — same order as `deploy-oracle.yml` step 6). Record whether each line exists and whether the DSN line is non-empty. **Never paste the DSN value into chat or a file** — report only "set / unset".
2. `pm2 show zsystems-backend` / `pm2 env <id>`: confirm the running process actually carries `ERROR_TRACKING_ENABLED` (a reload with `--update-env` does not re-read the `.env` file the way a fresh `pm2 start --env-file=` does — if the file was edited after the last fresh start, the process may still run with the old env; a `pm2 restart` is the reliable way to pick it up).
3. Expected "on" state: `ERROR_TRACKING_ENABLED=true` + non-empty `SENTRY_DSN` in both the file and the process env. Anything else = backend Sentry is off.

### Owed check B — Sentry dashboard recent events (needs browser + the Sentry login)
1. Open the Sentry dashboard (sentry.io), sign in, pick the zs project.
2. Issues → check for events from the `production` environment in the last 7 days. Any event = on and receiving. Zero events + check A "on" = either nothing errored (possible) or events are not arriving (misconfigured DSN/project) — distinguish by triggering one known error and watching for it.
3. If there is **no zs project at all** in Sentry (or nobody knows the login — no Sentry credentials exist in the repo or the vault notes), Sentry was never set up: the answer is "off because it was never created", and setup is: create a project at sentry.io → copy the DSN → set GitHub secret `VITE_SENTRY_DSN` + GitHub variable `VITE_ERROR_TRACKING_ENABLED=true` → set `ERROR_TRACKING_ENABLED=true` + `SENTRY_DSN` in the server `.env` → redeploy (frontend needs a fresh build; backend needs a restart) → verify with check B.

## 4. Existing docs — no duplication
- `docs/LIVE_SAAS_OPERATIONS_CHECKLIST.md:181-186` already has a short technical Sentry paragraph (disabled by default, flags, rates 0, redaction, source maps postponed). It is an ops note, not a user how-to — the new `sentry-how-to.md` (plain 5 steps, Arabic) does not duplicate it.
- `docs/PRODUCT_READINESS_STATUS.md:7,59,62` mentions Sentry activation as outstanding hardening; `docs/PRODUCTION_READINESS.md:72` states the fail-closed rule. Both agree with the code.

## 5. Package built (code gap was real)
- Worktree: `~/workspace/audit/zs-weakness-item7-wt` at `e3dbdeee3`. Commit: `33157afcf` "fix(deploy): pass Sentry flags into the frontend build so the live bundle can carry the DSN (INV-SENTRY-LIVE-ENABLEMENT)" — 6 files, +300/-4. **Landed on main as `ef3a365fe`** via the fallback queue (SSH push after Deploy #93, ci-fast #265 green). The Item 5 package landed first as `691f45ab6` (DEPLOY-9), so the §2.7 rows are in DEPLOY order (9 before 10) as planned; the merge-order note below is discharged.
- Files: `.github/workflows/deploy-oracle.yml`, `backend/test/critical/deploy-pipeline.spec.ts` (DEPLOY-10 + DEPLOY-11), `ARCHITECTURE_INVARIANTS.md` (§2.7 header + DEPLOY-10/DEPLOY-11 rows + `INV-SENTRY-LIVE-ENABLEMENT` as last INV line, 668 lines), `backend/test/critical/architecture-guard.spec.ts` (tail → `INV-SENTRY-LIVE-ENABLEMENT`), `docs/DEPLOYMENT_PIPELINE.md` (§3 + §4 + Telegram check line), `backend/scripts/check-telegram-alerts.cjs` (new, Telegram bot check).
- Telegram extension (2026-11-18 18:10): the original commit was `6c8f0a3f3`; it was **amended** (never pushed) to `33157afcf` to include the Telegram work — same message, same invariant id, no new INV id, guard tail unchanged. The extension adds the check script + DEPLOY-11 + the §2.7 DEPLOY-11 row + the §7 Telegram grounding in this note + a 6th step in `sentry-how-to.md`.
- Proof (real exits, no pipes): `deploy-pipeline.spec.ts` FAIL-FIRST exit 1 on the unpatched workflow (named the `VITE_ERROR_TRACKING_ENABLED from vars` assertion), exit 0 after the fix (`all deploy and backup invariants hold (DEPLOY-1..DEPLOY-10)`); after the Telegram extension the same spec FAIL-FIRST exit 1 with the check script removed (ENOENT), exit 0 after restore (`DEPLOY-1..DEPLOY-11`); `architecture-guard.spec.ts` exit 0; backend `tsc --noEmit` exit 0; `git diff --check` exit 0; workflow YAML parses (`yaml.safe_load` OK). The Telegram script itself: no-env exit 1 (names `TELEGRAM_BOT_TOKEN`), token-only exit 1 (names `TELEGRAM_CHAT_ID`), both dummy + `--check-only` exit 0, both dummy default-mode exit 1 (no route to `api.telegram.org` from this VM, no value leaked). `node backend/scripts/check-architecture-guardrails.cjs` exit **1** — sole violation is the PRE-EXISTING Item 4 file-size cap (`users.service.ts` 1068 lines vs baseline 1061, the +7 lines from the Item 4 commit itself); this package touches no `backend/src` file (0 diff lines in `users.service.ts`) and cannot affect the cap — the repair is a separate owed commit on top of `e3dbdeee3`. Patch + clean-tree proof worktree recorded in the progress log.
- **Merge-order note — DISCHARGED:** Item 5 landed first (`691f45ab6`), then this package (`ef3a365fe`); the §2.7 rows are in DEPLOY order (9 before 10). The Item 4 file-size cap named in the proof paragraph above was repaired separately (`74a3db853`, partial split of `users.service.ts`); the guardrails check is green since.

## 6. Observations (recorded, not fixed — out of scope)
- `SENTRY_SAMPLE_RATE` is declared in `env.schema.ts:64` (default `0.1`) but **never read by any backend code** (only `env.schema.ts` references it) — dead config; the hardcoded `0` rates in `main.ts` govern. Harmless; not worth a package.
- `frontend/.env.production.example` is **mixed-encoding**: ASCII/CRLF at the top, UTF-16LE from the "Sentry Error Tracking" section onward (NUL bytes between characters) — `grep` cannot see the Sentry section and `file` reports `data`. The flags are documented, just unreadable to plain-text tools. Cosmetic; not fixed here.
- `pm2 reload --update-env` (deploy step 6) does not re-read the `.env` file — see owed check A step 2. If the backend DSN is added to the file, the backend must be restarted (not just reloaded) to pick it up.

## 7. Telegram alerts — route decision, grounding, owed steps (added 2026-11-18 18:10)

### 7.1 The decision: Sentry's built-in Telegram integration (route a), NOT a repo webhook (route b)

- **Chosen — route (a): Sentry's own "Telegram Alerts Bot" integration, configured entirely in the Sentry dashboard.** No repo code is needed for the Sentry→Telegram link itself, and none was written for it. Grounded in Sentry's own docs (docs.sentry.io "Telegram" integration page: Settings → Integrations → Telegram Alerts Bot) and its linked installation FAQ (telegra.ph "Telegram Alerts Bot FAQ"): you start Sentry's bot in Telegram, it replies with a unique personal key for that chat, you install the integration in Sentry, then in an alert rule you add the action "Notify integration → Telegram Alerts Bot" and paste that key into the action's Settings. Any alert matching the rule is then delivered to that chat by Sentry's bot.
- **Rejected — route (b): a Sentry webhook into a repo endpoint that re-posts via the repo's own bot.** The repo *could* support it — it already has the pattern (marketplace webhook receipt: public receiver, HMAC-SHA256 signature capture over the raw bytes, durable store-first, `marketplace-sync-webhooks-receive.service.ts`) — but it would need all of this built new: a public unauthenticated `POST` endpoint for Sentry webhooks, a Sentry internal integration with a webhook URL + client secret for signature verification, Sentry payload parsing, dedup, and mapping onto `TelegramAlertsService.sendMessage`. That is a new public attack surface + a new secret to store, for zero benefit over the zero-code dashboard integration. It stays rejected unless the dashboard integration ever proves unusable.

### 7.2 Two different bots — do not confuse them

- **The repo's own bot** (token + chat id from `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`, GitHub secrets + `/etc/zsystems/telegram.env` on the server) carries only: deploy failure/rollback alerts (`deploy-oracle.yml`, failure-only), up/down state-change alerts (`uptime-watch.yml`), and DB-down incident alerts (`TelegramAlertsService` via the health controller, plus the super-admin `POST /api/health/telegram-test` endpoint). It never sees Sentry issues.
- **Sentry's bot** carries only Sentry issue alerts, under the user's Sentry login, using the personal key from §7.4 step 2. It knows nothing about deploys or uptime.
- If the user wants everything in **one** Telegram chat, add Sentry's bot to the same chat/group that already receives the deploy alerts and use that chat's personal key — then both bots post to the same place. Or keep them in separate chats. Either way the two setups are independent.

### 7.3 How Telegram alerting works in this repo today (re-verified in code)

- Bot API call shape, identical in all four places: `POST https://api.telegram.org/bot<token>/sendMessage` with `chat_id` + `text` (`deploy-oracle.yml:225-236`, `uptime-watch.yml:58-74`, `deploy/scripts/zsystems-restore-drill.sh:22-46` + `zsystems-watch.sh:24-42` reading `/etc/zsystems/telegram.env`, `backend/src/core/alerts/telegram-alerts.service.ts:95-125` via `fetch` with `parse_mode: HTML`).
- `TelegramAlertsService` reads token/chat id from `process.env` first, with a per-tenant `settings` override (`telegram_alerts_*`); it holds **no** hardcoded values. Its `sendMessage` fails soft (returns `{ ok: false }`) when either value is missing; `sendIncidentAlert` / `sendDeploymentAlert` build the Arabic formatted message.
- `backend/src/config/env.schema.ts:67-68,159-160` declares both vars (default `''`).
- **Observation, NOT fixed here:** `backend/src/modules/saas-admin/saas-diagnostics.service.ts:283-285` (`dispatchWebhookAlert`) falls back to a **literal bot token + chat id committed in source** when the env vars are empty. Values are deliberately not recorded here. The repo is public, so anyone can read them and the fallback defeats the secret — but removing it changes behaviour (diagnostics alerts would stop entirely when env is missing) and rotating the token is a user decision, so rotation + removal is a separate package, not part of this one.

### 7.4 Owed dashboard steps — exact, in order (needs the user's Sentry dashboard + Telegram)

**Dependency first: none of this fires until §3 checks A + B pass** — Sentry must actually be receiving events (project exists, DSN set in GitHub + server `.env`, redeploy + restart done). A Telegram rule on a Sentry that receives nothing alerts about nothing.

1. **Get the chat key (Telegram, 1 minute).** In Telegram, send `/start` to Sentry's Telegram Alerts Bot (or add the bot to the group that should receive the alerts and send `/start` there). The bot replies with a unique personal key for that chat — copy it. Treat the key like a credential: it lives only in the Sentry alert rule, never in the repo, never pasted in chat. Lost key: send `/start` again.
2. **Install the integration (Sentry dashboard).** Sentry → Settings → Integrations → **Telegram Alerts Bot** → Install.
3. **Create the alert rule (Sentry dashboard).** Alerts → create a new **Issue alert**, e.g. named "zs production errors → Telegram". Conditions: **"An issue is first seen"** (every new issue), environment = **production**. Action: **Notify integration → Telegram Alerts Bot**, paste the key from step 1 into the action's Settings. Save.
4. **NO uptime/downtime rule.** Do **not** create any metric alert on health/uptime — the user declined downtime pings (clients call immediately anyway), and up/down is already covered by `uptime-watch.yml`, which is the wanted channel for that.
5. **Test it.** Trigger one known error and watch for the Telegram message within minutes. If nothing arrives: re-check the key in the rule, that the rule is enabled, that the bot is still in the chat / not muted, and that check B shows the error in Sentry at all.

### 7.5 What the repo side CAN prove — and what it cannot

- **Built in this package:** `backend/scripts/check-telegram-alerts.cjs` (+ DEPLOY-11 in `deploy-pipeline.spec.ts`). It proves the **repo's own bot** can post: presence of both env vars, token validity (`getMe`), chat reachability (`getChat`), optional `--send-test` message. It fails closed (exit 1, naming the missing var by name) with no secrets set, and never prints a value. On the server: `source /etc/zsystems/telegram.env && node backend/scripts/check-telegram-alerts.cjs --send-test`.
- **Cannot be proven from this VM:** the live `getMe` / `getChat` / `--send-test` success path — this VM has no route to `api.telegram.org` (dummy-token run fails at the network, exit 1, no leak) and no secrets exist here. That success path is proven on the server, where the secrets live, by the command above.
- **Not provable from the repo at all:** that the Sentry dashboard rule exists and fires — that is a dashboard fact, verified only by step 5 above (a real error → a real Telegram message).
- **Missing pieces, exactly, and who supplies them:** (a) a Sentry project + Sentry login — the user (no Sentry credentials exist in the repo or the vault notes); (b) the personal key from Sentry's bot — the user, in Telegram, step 1; (c) the GitHub secret `VITE_SENTRY_DSN` + var `VITE_ERROR_TRACKING_ENABLED=true` + server `.env` `ERROR_TRACKING_ENABLED=true` + `SENTRY_DSN` — the user, already owed from §3; (d) **nothing new** to store in GitHub or the repo for the Telegram link itself — no new secret, no new workflow var; the key lives in the Sentry alert rule only.
