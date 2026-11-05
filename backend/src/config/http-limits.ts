// Shared HTTP body-size limits for the Express bootstrap (backend/src/main.ts).
//
// The products import sends one JSON body per file: 10,000 normalized rows are
// ~4.5 MB, so the JSON limit must clear that with headroom. It is capped at 10mb
// to match nginx `client_max_body_size 10m` (deploy/nginx/*.conf) — a larger
// Express limit would only move the rejection to nginx with a raw 413.
// INV-IMPORT-PRODUCTS-BILINGUAL-NAMES-PAYLOAD (ARCHITECTURE_INVARIANTS.md).
export const JSON_BODY_LIMIT = '10mb' as const;

/** JSON_BODY_LIMIT in bytes: Express/body-parser parses '10mb' as 10 MiB. */
export const JSON_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
