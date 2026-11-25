# DTO Authoring Contract (item (5), D1)

Every `@Body()` payload in `backend/src` must arrive as a **class** decorated
with `class-validator` / `class-transformer` decorators. This contract is the
rulebook every DTO package (D2–D10) follows; the coverage guard
(`backend/scripts/dto-coverage-check.mjs` + `backend/test/critical/
dto-coverage.spec.ts`) pins the count of unvalidated sites and the exact
pinned-exclusion set, so a package that breaks a rule fails its own proof.

## Why: the global pipe only validates classes

`backend/src/common/pipes/request-validation.pipe.ts` is wired globally in
`main.ts:140` as `app.useGlobalPipes(requestValidationPipe)` with
`whitelist: true, transform: true, forbidNonWhitelisted: true,
stopAtFirstError: true`, and `transformOptions: { enableImplicitConversion:
true }`. A rejection is `400 VALIDATION_ERROR` with Arabic messages.

Nest's `ValidationPipe` skips validation whenever the design-time metatype
is not a class. `any`, inline object literals, `Record`, `unknown`, and
**interfaces** all resolve to `Object` and pass through untouched — no
validation, no stripping. Only the 360 dto-class `@Body()` sites get any
runtime validation today. An interface named `*Dto` is the most misleading
case: it looks like a DTO and gets no validation at all (47 sites at D1).

There are no per-route pipe overrides (`@UsePipes` occurs 0 times in
`backend/src`) — the global pipe applies uniformly. **No per-route pipe
opt-out is allowed.** The first DTO on an endpoint immediately enforces
`whitelist` + `forbidNonWhitelisted` there.

## Rule 1 — Every field is caller-verified

A DTO is written from the caller's sends, not from the service's reads
alone. For every site, find the real caller (frontend api file, WebView
flow — the Android apps are WebView wrappers, so the frontend api files
are the mobile caller surface too) and verify each field: name, type,
required vs optional, and any extra fields the caller sends. A DTO
written without the caller's sends WILL break a real flow, because the
first extra field the frontend sends becomes a 400.

Each DTO package's spec carries a **positive case with a real caller
payload** that must still pass, next to the invalid-payload case (extra
or invalid field → 400 `VALIDATION_ERROR`). The positive case is the only
guard — the frontend types many payloads as `unknown`, so there is no
compile-time safety net.

## Rule 2 — `@IsOptional` for optional fields

Never mark a field required unless the caller always sends it. When in
doubt, `@IsOptional()` — a missing optional field must not 400. A field
the caller sends only sometimes is optional, even if the service treats
its absence as a default.

## Rule 3 — Boolean / number care under `enableImplicitConversion`

The global pipe coerces with implicit conversion on. Numbers coerce
safely (`"5"` → `5`). Booleans do NOT: the string `"false"` converts to
boolean `true` (`Boolean("false") === true`). A DTO with a boolean field
must pin the conversion behavior in its spec (send `"false"` and `"true"`
as strings and assert the result), and prefer an explicit `@Transform`
where the caller sends strings.

## Rule 4 — `stopAtFirstError` stays

The user sees only the first validation failure per request. That is the
existing global behavior — DTO packages must not change it, and specs must
not assert multi-error responses.

## Rule 5 — DTO home

New DTO classes live in `src/modules/<module>/dto/`. An existing
`*Dto` **interface** is converted to a class **in place** — in its
current `.dto.ts` file or service/types file, wherever it lives today —
so its import sites do not move. Do not move a type just to put it in
the dto directory; the conversion, not the relocation, is the change.

## Rule 6 — Money endpoints get a positive case, always

`POST charge` (POS terminal payment), `POST calculate-preview`
(end-of-service), fiscal-year open/close/reopen, PDC cheques, forex
revaluation, `ApplyRepricingPayload`, sales-order and purchase-order
creates — a wrongly-strict DTO blocks a real sale, payment, or close.
Each money endpoint's spec must carry a positive case with a real caller
payload, and the parent trials the money modules on a live login before
the chain proceeds past them.

## Rule 7 — Exclusions: only the 15 pinned, never more

These 15 sites must NEVER take a DTO. The coverage guard pins them by
file:line; a package that converts one fails its own proof.

| Site | Why a DTO breaks it |
|---|---|
| `src/core/logging/logs.controller.ts:15` — `POST frontend-error`, `unknown` | Free-form error sink: any JSON up to 10 KB by design (rate-limited, not validated). A DTO would reject legitimate error reports and blind the team to frontend failures. |
| `src/modules/hr/controllers/biometric-attendance.controller.ts:153` — `POST cdata`, `unknown` | ZKTeco device push: the handler reads the body as raw text/`Buffer`, not JSON. A DTO would fail or mangle a non-JSON body and silently lose fingerprint punches. |
| `src/modules/hr/controllers/biometric-attendance.controller.ts:196` — `POST hikvision`, `unknown` | Hikvision device push: raw body, same as above. |
| `src/modules/hr/controllers/biometric-attendance.controller.ts:227` — `POST json`, `unknown` | Generic device push: raw body, same as above. |
| `src/modules/settings/settings.controller.ts:52` — `PUT settings`, `Record<string, unknown>` | Open-ended key/value settings map by design — no fixed field set exists to validate. |
| `src/modules/settings/controllers/settings-backup.controller.ts:61` — `POST backup/config`, `Record<string, unknown>` | Open-ended settings map, same as above. |
| `src/modules/settings/controllers/settings-backup.controller.ts:69` — `POST backup/folder/test`, `Record<string, unknown>` | Open-ended settings map, same as above. |
| `src/modules/settings/controllers/tenant-transfer.controller.ts:53` — multipart upload body, `Record<string, unknown>` | Multipart form field map — open-ended by design. |
| `src/modules/tenant-subscription/tenant-subscription.controller.ts:401` — `POST webhooks/:gateway`, `any` | Provider payload: the provider can add fields at any time (`forbidNonWhitelisted` would 400 a legitimate new event), and signature verification reads `req.rawBody`. |
| `src/modules/storefront/controllers/marketplace-sync.controller.ts:176` — `POST marketplaces/webhook/:marketplace`, `any` | Provider payload, 4 marketplaces (Amazon SP-API, Noon, Jumia, Trendyol) with 4 different notification schemas; the receive service persists the raw payload first. A DTO would 400 a legitimate new event key. |
| `src/modules/storefront/storefront-public.controller.ts:254` — `POST webhooks/paymob`, `any` | Provider payload: `body?.obj` + ~20 fields under `obj` + `custom_fields`; HMAC-SHA512 over concatenated field values. |
| `src/modules/storefront/storefront-public.controller.ts:264` — `POST webhooks/xpay`, `any` | Provider payload: `body?.data \|\| body`, transaction fields under `data` or the root. |
| `src/modules/storefront/storefront-public.controller.ts:274` — `POST webhooks/tap`, `any` | Provider payload: charge object (`id`, `status`, `metadata`, `reference`, `amount`, `currency`, `gateway`, `payment_reference`, `created`); HMAC over a concatenated string of those fields. |
| `src/modules/storefront/storefront-public.controller.ts:284` — `POST webhooks/stripe`, `any` | Provider payload: `type` + `data.object`; the `stripe-signature` header is verified over `req.rawBody`, which the service requires. |
| `src/modules/storefront/storefront-public.controller.ts:303` — `POST webhooks/marketplace/:marketplace`, `any` | Provider payload, same receive path as the :179 webhook — the raw payload is persisted first, 200 only after durable store. |

## Out of scope (not counted, not converted)

- Property-form `@Body('prop')` (57 sites): single-property extraction,
  usually a primitive; the pipe cannot validate a bare string/number.
- `@Query()` / `@Param()` DTOs: the defect is `@Body()` only.
- Response DTOs: the codebase deliberately has no global serializer
  (PERF-1 in `main.ts`); responses stay plain objects.

## The coverage guard and the pin

- `backend/scripts/dto-coverage-check.mjs` walks `backend/src`, classifies
  every `@Body()` site with the grounding classifier, and exits 0 iff the
  non-DTO-class whole-body count equals the pinned number and the
  exclusion set equals the 15 above. Run it any time:
  `node scripts/dto-coverage-check.mjs`.
- `backend/test/critical/dto-coverage.spec.ts` runs the script with
  `--json` and asserts the count and the exclusion set. It is wired into
  `test:critical` (332 → 333 at D1).
- Pin arithmetic: 264 at D1 = 255 convertible + 9 exclusions; 75 at D8 =
  60 convertible + 15 exclusions (D8 adds the 6 storefront webhook
  exclusions and converts 14); 45 at D9 = 30 convertible + 15 exclusions
  (D9 converts 30 hr + tax + approvals sites); 15 at D10 = 0 convertible
  + 15 exclusions (D10 converts the last 30 tail sites). Each DTO
  package converts N sites and updates the pin by exactly N — the script
  constant AND the spec constant, in the same package. The last DTO
  package (D10) pins 15 (exclusions only).
- If the count moves without a pin update, the spec goes red. That is the
  point: the pin moves only deliberately, in a package that proves the
  conversion with a spec.

## Versioning (pointer, not this contract)

API versioning is D11, after all DTO packages: dual-serve `api/v1/...`
on all controllers, following the one live precedent
(`saas-admin-diagnostics.controller.ts:25`). No route is removed and no
URL the frontend calls changes. The versioning package owns that scheme;
DTO packages must not add version prefixes.
