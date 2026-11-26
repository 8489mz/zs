# AI Agents Standard Guidelines for Z-Systems

## Capability documentation ownership

Read [SYSTEM_BLUEPRINT.md](SYSTEM_BLUEPRINT.md) for dependencies, then [SYSTEM_CAPABILITIES.md](SYSTEM_CAPABILITIES.md) to find the owning domain file. Follow [the documentation protocol](docs/capabilities/README.md). For any audit, read [the review evidence policy](docs/reviews/README.md) and update `docs/reviews/module-review-status.json` only when scoped verification evidence exists; historic “100%” is not a current release sign-off.

Document every changed/new capability in its owning domain file, including implementation references, limitations, and actual test evidence/date/commit. The central file is an index only: do not append feature histories there. Update the blueprint for dependency changes and the registry/index for new domains. Cross-domain changes use one owner and links, not copied descriptions. Historical “100%” labels are not current verification. This routing rule supersedes older instructions to append details to SYSTEM_CAPABILITIES.md.

> 🔴 **CONSTITUTIONAL DIRECTIVE FOR ALL AI AGENTS:**
> This repository is governed by `SAAS_ELECTRON_ISOLATION_CONSTITUTION.md`. Any agent modifying files must read and comply with the architectural boundaries and safety invariants outlined below.

---

## 1. Architectural Boundaries (Cloud SaaS vs Offline Desktop)
- **Production Server:** Oracle Cloud VPS (PostgreSQL DB, Node.js NestJS Backend, React Vite Frontend).
- **Cloud SaaS Mode (`APP_MODE=CLOUD_SAAS`):**
  - Pure multi-tenant SaaS.
  - Platform tenant `zs` represents central super-admin administration.
  - Strict tenant scoping (`tenant_id`) across all DB queries.
  - **Zero Desktop Overlap:** Do NOT add desktop fallback logic or ignore `zs` in cloud services.
- **Desktop Mode (`APP_MODE=SELF_CONTAINED`):**
  - Isolated offline environment.

## 1-b. Performance Invariants (`PERFORMANCE_CONSTITUTION.md`)
- Read `PERFORMANCE_CONSTITUTION.md` before touching `frontend/vite.config.ts`, `backend/src/main.ts`, the app shell's imports, the POS/product catalog, the public storefront catalog, or any index migration.
- Never statically import heavy libraries (`jspdf`, `html2canvas`, `xlsx`, `recharts`, `html5-qrcode`, `pdfjs-dist`, `@sentry/react`) from code the app shell reaches — use `import()` / `React.lazy`.
- Never re-register a global `ClassSerializerInterceptor`; never scan a query result inside a loop over another result (build a `Map`).
- The POS offline catalog (IndexedDB) must stay: it lets cashiers sell without internet. Its version must never be built from `products.updated_at` (moves on every sale) — use `catalog_updated_at` (PERF-9).
- Guards: `performance-hot-paths.spec.ts` + `npm --prefix frontend run qa:perf` (both in `npm run guards`). A failing perf guard is almost always right.

## 1-c. Production Deploy & Backup Invariants (`ARCHITECTURE_INVARIANTS.md` §2.7, DEPLOY-1..6)
- Read §2.7 before touching `.github/workflows/deploy-oracle.yml` or `deploy/scripts/zsystems-backup.sh`.
- Never build on the production server: `npm run build` / `vite build` / `nest build` run on the GitHub runner only; the server receives a prebuilt `release.tgz`.
- Never `rm -rf` a live `dist` folder; the server swaps folders with `mv` and rolls back automatically on a failed health check. Migrations run before the swap.
- Never switch PM2 to `cluster` / `-i max`: auth cache, login limiter and job queue live in process memory (O13).
- Never use `docker exec -t` in the backup script; never commit an Object Storage pre-authenticated URL (the repo is public).
- Guard: `backend/test/critical/deploy-pipeline.spec.ts` (in `npm run guards`). If it fails, the guard is right — fix the code, not the guard.

## 1-d. Backup Restore & Tenant Transfer Invariants (`ARCHITECTURE_INVARIANTS.md` §2.8 RESTORE-1..3, §2.9 TRANSFER-1..5)
- Never renumber ids when moving or restoring a tenant; keep original ids (offline rows use the tenant's reserved block above 1,000,000,000).
- Whoever disables FK checks (`session_replication_role = 'replica'`) must run `findOrphanedReferences` before commit; never weaken it to let a restore pass.
- Never decide a column's meaning from its name (`account_id` is an FK on `journal_entry_lines`).
- Guards: `backup-restore-integrity.spec.ts`, `tenant-transfer.spec.ts`.

## 1-e. Retail Clothing & Variant Stock Invariants (دستور عزل ألوان ومقاسات الملابس وحظر النقل العابر للأرصدة)
- **Strict Color Isolation (حظر نقل رصيد صنف إلى لون مختلف نهائياً):**
  - When consolidating or modifying variants in fashion groups (`saveFashionGroup` / `FashionGroupEditorCard`), stock consolidation is strictly allowed ONLY into the EXACT SAME color (`normalizeArabicSearch(target.color) === normalizeArabicSearch(source.color)`).
  - NEVER fall back to `drafts[0]`, `kept[0]`, or an arbitrary remaining variant. If a color is removed and has stock, it MUST NOT be merged into a different color. It must be zeroed explicitly via inventory adjustment, preserved in the table for manual review, or rejected.
- **Archive & Zero-Stock Unblocking (عدم تعطيل تصفير وأرشفة الأصناف ذات الفروقات التاريخية):**
  - When zeroing stock on archive or variant deletion (`options.zeroStock` / `zeroRemovedStock`), the purpose IS to eliminate any historical discrepancies between global stock and location stock. Do NOT block zeroing with `FASHION_STOCK_RECONCILIATION_REQUIRED` when zeroing is requested; allow the zeroing engine to deduct available location rows and reset both global and location stock to 0 cleanly.
  - Location resolution must never send `0` (`Number(null) === 0`) to `stock_movements`. If a product has no location specified, fall back to its `default_location_id` or active tenant location or pass SQL `null`.

## 2. Inviolable Core Invariants
- Financial transactions & journal entries are immutable double-entry ledgers.
- Passwords MUST always be hashed with `bcrypt` (never plaintext).
- Never modify or remove `tenant_id` isolation logic.

## 3. Strict Execution Policy
- NEVER run `npm run build` or `git push` automatically without explicit user command.
- NEVER run extensive guards, typechecks (`tsc`), or test suites automatically between iterative testing workflow steps. Postpone them strictly until the very end upon explicit user command to preserve flow and speed.
- Consultation Mode: If the user asks a question with `?` or `؟`, advise first without running modifying code.

## 4. UI & Arabic Design System
- Arabic RTL layout by default (`dir="rtl"`).
- All chat responses wrapped in `<div dir="rtl">...</div>`.
- 0 Emojis policy across all UI screens (use `@/shared/components/icons/AppIcons`).
- Strict Ban on AI Sparkles / Magic Stars Icons: NEVER use the 4-pointed sparkle / magic star icon (`SparklesIcon` / `WandMagicIcon` or `m12 3-1.912...` SVG) anywhere in the ERP system. Always use real operational business icons (`DownloadIcon`, `RefreshCwIcon`, `SlidersIcon`, `PlusCircleIcon`, `CheckShieldIcon`, etc.).
- Strict Ban on Lightning / Zap Icons: NEVER use the lightning bolt / zap icon (`ZapIcon` / `Zap` or `13 2 3 14 12 14 11 22...` SVG) anywhere in the ERP system. The system is a serious, institutional ERP platform; automated processes, speed, and settings must always be represented by real operational business icons (`SlidersIcon`, `SettingsIcon`, `CheckShieldIcon`, `RefreshCwIcon`, `CpuIcon`, etc.).
- Standard modal framework (`StandardDialog` / `DialogShell`).
- Centralized combobox system (`CustomSelect`).
- **Strict RTL Stepper Standard (دستور أزرار العدادات والكميات: الزائد يميناً والناقص يساراً):**
  - في كافة أزرار العدادات وتعديل الكميات (`Stepper` / `Quantity Controls`) عبر المنظومة بالكامل (نقاط البيع، فواتير التوزيع الميداني، أذونات التحميل، وسلات الشراء والمودالات):
  - **الزائد (`+`) يجب أن يكون دائماً على اليمين، والناقص (`-`) دائماً على اليسار!**
  - في بيئات RTL، العنصر الأول في DOM يظهر جهة اليمين، لذا يجب برمجياً كتابة زر الزيادة `+` أولاً، تليه خانة/نص الكمية في المنتصف، ثم زر الإنقاص `-` أخيراً جهة اليسار: `[+] (الكمية) [-]`. يُمنع منعاً باتاً عكس هذا الترتيب.

## 5. Workspace Keep-Alive, Zero-Re-render & Data Integrity Architecture (دستور السرعة اللحظية وحماية البيانات في مساحات العمل المتعددة)
- **Unified Route Single-Mount Boundary:** Multi-tab workspaces must use single unified routes (`path: 'workspace'` and `path: 'workspace/*'`) to prevent layout and provider unmounting.
- **Strict Lazy Tab Mounting via `visitedTabs` (التحميل الكسول الصارم للتابات ومنع الاختناق الشبكي):**
  - تمنع منعاً باتاً المعمارية القديمة بتركيب كافة تابات مساحة العمل دفعة واحدة في الـ DOM عند الفتح الأول (حظر Eager Hidden Mounting).
  - التاب لا يتم إنشاؤه في الـ DOM ولا يُطلق استعلاماته الشبكية إطلاقاً إلا عند نقر المستخدم عليه أو تحويم المؤشر نحوه لأول مرة عبر `visitedTabs` (`new Set([currentSubPath])`).
  - هذا يحمي مسبح اتصالات المتصفح (Max 6 concurrent TCP connections) من طوابير الانتظار الشبكية (Waterfall / Request Queueing) ويمنع سقوط الطلبات بالـ Timeout.
- **Inactive Tab Freezing via `KeepAliveTabPane` (دستور تجميد التابات الخاملة ومنع إعادة الرسم):**
  - كافة التابات داخل حاوية الـ Keep-Alive تُغلف بمكون `KeepAliveTabPane` المحمي بـ `React.memo` مع فاحص مقارنة مخصص:
    `if (!prev.isActive && !next.isActive && prev.isVisited === next.isVisited && prev.Component === next.Component) return true;`
  - التاب المخفي بـ `display: none` لا يُستهلك منه أي جزء من دورة معالجة المتصفح (0ms) عند التنقل بين التابات الأخرى، مما يحقق سرعة تبديل لحظية (0ms - 15ms).
- **Zero Phantom Empty States (دستور ثبات البيانات وحظر الإفراغ الوهمي):**
  - السرعة لا تعني أبداً تجاوز البيانات أو إظهار شاشات فارغة مضللة.
  - بمجرد زيارة التاب، يظل المكون محفوظاً في ذاكرة المتصفح بأسلوب Keep-Alive بكامل حالته (`data`, `filters`, `pagination`, `scroll`), فلا يعود المستخدم ليجد الصفحة فارغة أو يُجبر على إعادة التحميل.
  - الاستماع لـ `refreshKey` يضمن التحديث التلقائي لكافة التابات الحية عند إنشاء أو تعديل أي حركة جديدة.
- **Light Aggregate Badges Standard (دستور العدادات الخفيفة وحظر سحب الجداول للأعداد):**
  - يُمنع منعاً باتاً استدعاء مسارات الجداول الكاملة (`getInquiries()`, `getOrders()`, إلخ) لمجرد حساب أطوال المصفوفات (`.length`) لعرض شارات التابات.
  - يجب دائماً توفير نقطة نهاية مجمعة سريعة في الباك إند (`/counts`) تعتمد على استعلامات SQL تجميعية متوازية `COUNT(*)` تُنفذ في ملليمترات قليلة (~2ms) وتعيد كائناً صغيراً (~50 بايت) لحماية الذاكرة والشبكة.
- **Hover Pre-fetching Standard (دستور التجهيز اللحظي بالتحويم):**
  - أزرار التابات ومسارات العمل يجب تزويدها بأحداث `onMouseEnter` و `onFocus` لبدء التحميل في الذاكرة قبل اكتمال نقرة الفأرة بنحو 50-100 ملي ثانية.
  - مسارات العمل الرئيسية يجب إدراجها في محرك التحميل المسبق الخامل `route-prefetch.ts`.
- **Memory Hydration Protection:** Never reset tab counts/badges to 0 on navigation or re-render; always hydrate from memory (`memoryCachedCounts`) and `sessionStorage`.

## 6. Universal 1280px Layout & Zero Width-Jumping Standard
- Fixed maximum container width: `max-width: 1280px; width: min(100%, 1280px); margin: 0 auto;`.
- Root grid columns must enforce `grid-template-columns: minmax(0, 1fr);` and child containers must use `min-width: 0;` to strictly prevent wide child tables from expanding the workspace container.
- Zero-clipping card standard: compact table headers and use `<colgroup>` to guarantee full visibility within the 1280px boundary.

## 7. Strict Stable-Sizing & Anti-Ballooning Modal Standard (دستور ثبات أبعاد النوافذ المنبثقة ومنع التمدد أو الانكماش الفجائي)
- Modals that fetch data or render lists/KPIs must specify a pre-balanced `minHeight` on `StandardDialog` (e.g. `min(560px, 85vh)`).
- Never initialize loading state to `false` when fetching on mount; always start with `useState(true)` to prevent the dialog from rendering empty then ballooning.
- Render centered spinners (`minHeight: 280px+`) during fetch, and guard KPI cards with `—` instead of flashing `0` or `undefined`.
- **Strict Fixed Container Height on Tabbed Modals:** Modals with tabs/filters must enforce a fixed height on their inner list/table container (e.g. `height: 335px; minHeight: 335px; maxHeight: 335px; boxSizing: border-box;`).
- **Zero Empty-State Collapse:** When a tab has 0 items, empty states must fill 100% of the internal container height (`display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 335px;`) to prevent the modal from collapsing or ballooning vertically when switching between full and empty tabs.
- Prevent jarring shrink/expansion: dialog must open and remain at its definitive dimensions across all tabs.

## 8. Strict Zero-Native-Alert & Zero-Native-Confirm Standard
- NEVER use raw `window.alert(...)`, `alert(...)`, or `window.confirm(...)`, `confirm(...)` anywhere in UI screens.
- Exclusively use the Universal Toast framework (`toast.success`, `toast.error`, `toast.warning`, `toast.info` from `@/shared/components/system-alert`) for non-blocking feedback.
- For mandatory confirmations, exclusively use `await systemConfirm(...)`, `systemAlert`, or `StandardDialog` / `ActionConfirmDialog`.
- Global interceptor shield in `SystemAlertProvider` automatically captures and upgrades any legacy alerts into modern toasts.

## 9. Strict Migration Sequence & Dynamic Auto-Detection Standard
- **Mandatory Folder Scan:** AI agents MUST NEVER guess migration numbers from memory or prior session state.
- Before creating any migration in `backend/src/database/migrations`, you MUST inspect the disk to discover the actual highest numerical prefix among all existing `.ts` migration files.
- The new migration file MUST be numbered strictly as `(Highest + 1)`.
- Kysely sorts migrations alphabetically; never duplicate a prefix or insert a migration alphabetically before an already executed one.

## 10. Strict Universal Document Numbering Standard (دستور الترقيم الموحد للوثائق والأذونات)
- **Universal Formula:** All generated document numbers, vouchers, requisitions, invoices, orders, and tickets across all modules MUST follow the unified format:
  `PREFIX-YYMMDD-XXXX` (e.g. `JOB-260914-0001`, `RFQ-260914-0001`, `MR-260914-0001`, `STMT-260914-0001`, `ZM-260914-0001`).
- **Strict 6-Digit Date (`YYMMDD`):** NEVER use 4-digit years like `2026` or static numbers. Always embed the 2-digit year, 2-digit month, and 2-digit day (`YYMMDD` such as `260914`).
- **Standard Sequence Padding:** Sequence counter must be at least 4 digits (`0001`, `0002`, ...), padded with leading zeros.
- **Unified Engine:** Use `getDailyDocumentPrefix(prefix)` and `formatDailyDocumentNumber(...)` from `backend/src/common/utils/document-number.util.ts`. All frontend placeholders, examples, and mock formats must mirror this exact format.

## 11. Strict Universal 14"-to-32" Multi-Screen Zero-Scroll Standard (دستور ملاءمة الشاشات من 14 إلى 32 بوصة وحظر السكرول الخارجي)
- **Universal Zero-Scroll Boundary:** All modals, popups, dialogs, POS workstations, and full-screen ERP workflows MUST fit seamlessly on small 14-inch laptop screens (`1366x768` or 1080p with 125%-150% Windows scaling, vertical viewport ~560px - 640px) up to 32-inch desktop monitors with **ZERO outer vertical scrolling (`بدون سكرول`)**.
- **Compact Dialog Architecture:**
  - Use `compact` mode on `StandardDialog` / `DialogShell` (`padding: 14px 18px !important;`, compact header/footer margins).
  - Expand modal width horizontally (e.g., `width="1180px"` or `min(1180px, 96vw)`) into balanced 2-column or 3-column layouts rather than tall stacked sections.
  - Interactive inputs, tags, and search bars must maintain compact heights (`32px - 36px`, `padding: 6px 10px`, `fontSize: 12.5px - 13px`).
- **Internal Slim Scrollbars Only:**
  - Outer dialog shells must NEVER show scrollbars (`overflow: hidden` on root wrapper).
  - Long lists, candidate matches, or order histories must be confined to internal containers with strict `maxHeight` (e.g. `240px - 290px`) and slim scrollbars (`.thin-scrollbar`).
  - Action and confirmation buttons must always remain 100% visible and unclipped without any scrolling.

## 12. Strict Zero Tab-Flicker & Zero Font-Shift Standard (دستور منع رعشة التابات والتنقل اللحظي)
- **Zero Font-Weight Shifting:** NEVER toggle `fontWeight` between active and inactive tab buttons (e.g. `700` active vs `500` inactive). In Arabic typography, changing font weight alters text width and forces all neighboring tabs to horizontally jerk/flicker ("رعشة أفقية"). Always use a uniform `fontWeight: 600` for both active and inactive tabs, differentiating the active state exclusively through high-contrast colors (e.g. deep royal navy `#170e5e` vs light background `#f8fafc`).
- **Instant 0ms Switching:** NEVER apply CSS transitions (`transition: all 0.15s ease`) to tab buttons. Tab switching must be immediate (0ms) without any layout delay or color shimmer.
- **Symmetrical Borders & Box-Sizing:** Enforce `box-sizing: border-box` and consistent 1px borders across all tabs to prevent subpixel layout jumping.

## 13. Strict Financial & Operational Audit Protocol (دستور التدقيق الحسابي ومنع الأخطاء الصامتة والكود الميت)
- **TypeCheck Is Never Business Proof:** An exit code 0 on TypeScript compilation (`tsc`) only proves syntactical and type alignment; it NEVER proves financial correctness or that money is deducted. Financial transactions and calculations MUST be proven with executable unit tests (`.spec.ts`) asserting concrete numerical scenarios.
- **Tests Must Import Production Code (حظر تكرار المنطق في الاختبارات):** Unit tests must NEVER re-implement business formulas locally. Calculation engines must be extracted as pure functions in dedicated engine modules (e.g. `ipc-calculation.engine.ts`) imported identically by both the production service and the test suite. If tests duplicate the logic locally, they test their own assumptions rather than the code issuing the financial transactions.
- **End-to-End Call Path & Zero Dead Code:** Whenever writing conditional business logic or smart calculation engines in the backend, you MUST inspect every UI form/modal that calls that endpoint. Never allow frontend default values to mask, short-circuit, or turn backend calculation formulas into unreachable dead code.
- **Accumulator & Edge-Case Safety:** Never check an accumulator's empty state inside a loop (e.g. `&& backchargeAmount === 0`) because it silently drops subsequent items of the same type. Always aggregate first using `Map<string, number>` or array reducers, and mentally walk through edge cases with multiple rows of the same type.
- **Deferred Constraint Pattern (`NOT VALID`) Before Backfill (قاعدة القيد المؤجل قبل الترحيل البياني):** When adding foreign keys or composite constraints on tables with legacy data, constraints MUST be added with `NOT VALID` in the initial DDL migration. They must ONLY be validated with `VALIDATE CONSTRAINT` in the subsequent DML migration AFTER the data backfill and ID redirection have finished. Adding validated foreign keys prior to backfilling legacy IDs crashes immediately on production databases.
- **Zero Error-Swallowing in Migrations (حظر ابتلاع أخطاء التحقق بالـ Catch-All):** Never wrap constraint validation or reconciliation checks in `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE NOTICE`. If an orphan row exists or validation fails, the migration MUST fail loudly (`RAISE EXCEPTION` or unhandled error) to abort the transaction and protect database integrity.
- **Mandatory Pre/Post Migration Reconciliation Assertion (دستور التسوية القبلي والبعدي الإلزامي):** Any migration that redirects foreign keys, maps IDs, or touches financial ledgers MUST snapshot `COUNT(*)` and financial sums (e.g. `SUM(total_amount)`, `SUM(net_payable)`) per tenant before changes, and assert zero discrepancy / zero row loss after changes, throwing a hard exception if any delta exists.
- **Inviolable Invariant Ceilings (الثوابت الحاكمة والسقوف الإلزامية):**
  - Advance recoveries MUST be capped at remaining advance (`Math.min(amount, advanceTotal - previousRecovered)`) on ALL execution paths, including manual overrides.
  - Retention holdbacks apply strictly to Gross Work Done (GWD), never to Materials on Site (MOS) or Escalations, and are capped at the contractual limit.
  - Penalty deductions (Liquidated Damages) MUST be capped by the contractual LD cap.
  - Header summaries and itemized deduction records must strictly reconcile without silent discrepancy (Single Source of Truth).
- **Mandatory Documentation After Every Fix (التوثيق الإلزامي بعد كل إصلاح):** No audit phase or structural fix is complete until `ARCHITECTURE_INVARIANTS.md` is updated (new invariants, newly forbidden patterns, migration ledger, phase status, open items) and the owning domain file linked from `SYSTEM_CAPABILITIES.md` reflects any changed capability. Undocumented fixes are re-broken by the next session that lacks the context.
- **No Silent Skips (حظر التخطي الصامت):** Never guard a financial posting with `if (account) { ...post... }`. A missing account must either be auto-created via a `resolveAccountByCode`-style helper or raise an exception. Skipping the journal while the stock/cost side has already been written leaves the books out of balance with no error and no trace.
- **Sequence Numbers Are Never `COUNT(*) + 1`:** Document and journal numbers must be generated by inserting a collision-proof temporary value and renaming by the returned identity. `COUNT(*) + 1` produces duplicate numbers under concurrency.
- **Never Mask Schema Errors With `as any`:** Casting a query builder to `any` disables the only check that catches references to non-existent tables and columns. Three such errors once left an entire feature (forex revaluation) throwing at runtime while appearing healthy.
- **Control Gates Must Not Trust Caller Flags:** A gate whose activation depends on a client-supplied boolean or dropdown is bypassed by omitting it. Derive the condition from the data (e.g. an unlinked payment on a contract with an unspent contractual advance IS an advance payment, regardless of how it was labelled).
- **Canonical Lock Order (ترتيب الأقفال القانوني):** All stock mutations lock `products` before `product_location_stock`, and iterate invoice items sorted ascending by `productId`. Any other order deadlocks (SQLSTATE 40P01) against concurrent flows. Route every stock write through `applyStockDelta`.

## 14. Continuous Audit Learning & Autonomous Rigor Protocol (دستور الاستيعاب المنهجي والارتقاء الذاتي لمستوى المدقق الأول)
- **Mandatory Audit Assimilation on Every Review (الاستيعاب المنهجي الإلزامي لكل مراجعة تدقيقية):**
  Whenever an external audit or review (e.g. from Claude Opus or a financial auditor) rejects a fix or uncovers a flaw, edge-case, or shortcoming, the agent MUST NEVER treat it as a routine one-line patch. The agent MUST immediately dissect the auditor's underlying thinking methodology (منهج الفكر وزاوية التشريح)، and permanently record:
  1. What implicit assumption or blind spot allowed the flaw to pass? (ما هو الافتراض الضمني أو النقطة العمياء التي سمحت بمرور الخلل؟).
  2. How did the auditor discover it? Which regulatory, contractual, or mathematical angle was applied? (ما هي الزاوية الرقابية أو الحسابية التي اتبعها المدقق لكشف القصور؟).
  3. The structural, architectural countermeasure to permanently eliminate this class of flaws across all current and future modules.
- **The Autonomous Triad: Developer, Auditor, Fixer (المثلث الرقابي المستقل: المبرمج، المدقق، والمصلح):**
  The ultimate standard is for the agent to achieve "First-Time Right" execution (الإصلاح الصحيح والكامل من أول مرة دون حاجة لمُراجع خارجي). Before presenting any solution, the agent MUST role-play the ruthless auditor against its own code:
  - "If an adversarial auditor were looking to reject this submission, which edge-case or call path would break it?"
  - "Does any frontend default value, state lifecycle, or type casting silently short-circuit this business engine?"
  - "Does this database migration withstand production tables containing legacy, orphan, or null records without crashing or losing rows?"
- **Permanent Methodological Compounding (تراكم الخبرة والمنهج للموديولات القادمة):**
  All audit lessons learned in Contracting (e.g. Invariant Ceilings, Bounded Windows, NOT VALID constraints, Pure Engine Extraction, Gateway Gates) must be proactively carried over and applied independently to forthcoming enterprise modules (Logistics, Supply Chain, Multi-Currency Treasury, Fleet Management), allowing the agent to uncover and fix deep architectural shortcomings autonomously before anyone else points them out.
- **Phase 1 Concrete Audit Lessons (دروس تدقيق المرحلة الأولى المستوعبة):**
  1. *Cumulative Exposure vs Single Transaction (الحساب التراكمي لسقوف الضمانات - Invariant G1-C):* Checking a transaction against a guarantee ceiling on a single-event basis (`amount <= guarantee`) is a fatal vulnerability. In enterprise operations, disbursements are staged in multiple partial tranches. Gates MUST always sum historical unrecovered disbursements: `Σ prior + requested <= guarantee`.
  2. *Objective Server-Side Inference vs User Dropdown Silence (الاستدلال الموضوعي وحظر ترك الرقابة لاختيار المستخدم):* A regulatory gate must never depend on the subject's self-classification. If a dropdown defaults to a non-gated status (`progress`), the gate can be silently bypassed. The backend must infer the substantive nature of the transaction based on contract reality (`!invoiceId && advance_pct > 0 && prior < contract_advance`).
- **Phase 2 Concrete Audit Lessons (دروس تدقيق المرحلة الثانية المستوعبة):**
  3. *Call-Path Continuity & Wiring (اكتمال مسار الاستدعاء والتوصيل الحقيقي - L13):* An engine with 100% green unit tests is completely useless if the calling service fails to feed it historical data (e.g. `historicalInvoicedLines` in `goods-receipt.service.ts`), causing `priorQty = 0` and enabling double billing. Always inspect the caller's query and arguments.
  4. *Enforcement Authority vs Advisory Tags (سلطة الحجب الإلزامية وحظر الاكتفاء بالوسم - L13):* Storing a status (`three_way_match_status`) is purely cosmetic if downstream operations (`postPurchase`, `createSupplierPayment`) do not block on it. Regulatory checks MUST throw `422 Unprocessable Entity` on mismatch.
  5. *Maker-Checker Governance for Overrides (حوكمة الاستثناءات وفصل المهام - L14):* Overrides (`allowOverride`) MUST enforce maker-checker separation (`auth.userId !== record.created_by`), role checks (`admin`/`super_admin`), minimum rationale length (>= 10 chars), and MUST NEVER allow overriding physical reality (invoicing > accepted GRN quantity).
  6. *Disk Migration Reality vs Memory Assumption (حقيقة الهجرة على القرص مقابل افتراضات الذاكرة - L15):* Never assume a column exists because code references it (`purchase.po_id`). Always verify the physical migration file on disk (`migrations/*.ts`). Missing columns return `undefined` silently and turn business logic into dead code.
  7. *Retroactive Landed Cost Allocation (توزيع التكاليف اللاحقة بين المباع والمتبقي - L16):* When landed costs arrive after units have been sold, costs MUST be proportionally allocated: sold portion to COGS (5110) and remaining portion to Inventory (1140), preserving historical WAC without distortion.
  8. *Subledger Mathematical Continuity (الاتصال الرياضي للأستاذ المساعد وكشف الحركة - L17):* Every stock movement must record true `before_qty` and `after_qty` matching prior movements; never hardcode `0`. Inventory assets (1140) must have `partner_type: 'none'` to avoid polluting supplier subledgers.

## 15. Strict Universal Document & Transaction Form Standard (دستور وثائق وفورمز المعاملات الكبرى الموحد)
- **Mandatory Full-Page Architecture:** All commercial and financial transaction documents (Purchase Orders, Purchase Bills, Sales Orders, Quotations, Stock Issues, RFQs) MUST be built as dedicated full pages (e.g. `/purchases/orders/new`, `/sales/orders/new`, `/sales/quotations/new`). Trapping multi-line commercial documents inside small popups/modals is strictly prohibited.
- **Reference Template Component:** All transaction forms MUST follow `frontend/src/shared/components/UniversalDocumentFormTemplate.tsx` as their single source of truth and architectural blueprint.
- **Visual Anatomy & Invariants:**
  1. **Universal 1280px Container:** `max-width: 1280px; width: min(100%, 1280px); margin: 0 auto;`.
  2. **Universal Header (`PageHeader`):** Live document status badge (`is-draft` / `is-confirmed`) and live financial total, with decision action buttons pinned at top-left (`إلغاء المسودة` danger secondary, `حفظ كمسودة` secondary, `اعتماد الوثيقة` primary `#170e5e`).
  3. **Vertical Section Indicator:** Every major section MUST use `.document-prototype-section-title` featuring the prominent royal navy vertical accent bar (`::before` vertical line).
  4. **Dynamic Items Table:** Header toolbar with quick actions (`+ صنف`, `+ خدمة`, `% ضريبة`, `خصم`), dual-mode combobox (searching existing catalog or free-text new item), and bottom dashed buttons (`dashedAction`: `+ إضافة صنف`, `مسح باركود`, `+ منتج جديد`).
  5. **Symmetrical Bottom Split:** Notes on the right (60%) and financial summary totals on the left (40%) with clear calculations of subtotal, discounts, taxes, and final grand total.
  6. **Auto-Draft Persistence:** All forms must implement `useFormDraft` with `DraftRestoredBanner`.

## 16. Strict Dropdown Chevron & Safe-Padding Standard (دستور عزل سهم القوائم المنسدلة ومنع تداخل النصوص مع الأسهم)
- **The Anti-Pattern:** In Arabic RTL layouts, dropdown chevrons/arrows are positioned on the left (`left: 8px`). If the select input/trigger does not enforce adequate left padding or accidentally reverses padding (`padding: 0 28px 0 12px`), long labels, customer names, or phone numbers in English/parentheses expand under the chevron, causing visual text collision and unreadable overlapping.
- **Mandatory Safe-Padding Standard:**
  1. **Strict Left Safe-Zone:** All dropdown inputs, comboboxes, and custom select triggers (`CustomSelect`, `.custom-select-wrapper input`, `select:not([multiple])`) MUST enforce a minimum safe padding of `padding-left: 36px !important;` (or `padding-inline-end: 36px`).
  2. **Text Ellipsis Protection:** Overlong text MUST be strictly clipped with `text-overflow: ellipsis; white-space: nowrap; overflow: hidden;` so the text gracefully terminates with `...` before reaching the chevron, leaving at least 10px of clean whitespace.
  3. **Zero Inverted Padding:** Never reverse left and right padding in RTL dropdowns. Right padding is for text initiation (`12px`), while left padding is exclusively reserved for the chevron action zone (`36px`).

## 17. The 10/10 Golden Modal Standard (دستور النوافذ المنبثقة الذهبي الموحد)
- **Reference Blueprint:** `CrmDealCreateModal.tsx` and `StandardModalExample.tsx`.
- **Inviolable Architectural & Visual Invariants:**
  1. **Ultra-Soft Enterprise Sections:** Replace heavy gray boxes with soft, bright tint (`background: #fbfcfd !important; border: 1px solid #edf2f7 !important; border-radius: 10px !important; padding: 11px 14px !important;`).
  2. **Visual Breathing Room:** Field label gap MUST be `5px` (`gap: 5px !important;`, never cramped 3px). Field labels must use `0.78rem` (12.5px), font weight `600`, color `#475569`.
  3. **Universal 35px Height:** Inputs, custom selects, and comboboxes in modals MUST have `height: 35px !important;` with `padding: 0 12px;` for comfortable clicking and typing while maintaining zero-scroll.
  4. **Proportional Grid Distribution:** NEVER divide mixed text fields equally into `1fr 1fr 1fr 1fr`. Long text fields like emails and company names MUST receive wider proportional columns (e.g. `1.5fr` for email, `1.3fr` for company, `1.1fr` for phone/contact) to prevent text clipping.
  5. **Textarea Height & Multi-line Room:** Textareas must enforce `min-height: 60px !important; line-height: 1.5 !important; padding: 8px 12px !important;` to comfortably display 3-4 lines of notes.
  6. **Zero-Scroll Boundary:** Modal height must fit completely within 14" to 32" screens without outer vertical scroll.

## 18. Strict Commercial Scope & Operation Mode Standard (دستور الفصل بين نمط المحلات المبسط ونمط المؤسسات المتقدم ومنع صدمة التعقيد)
- **The Core Architectural Invariant:**
  Commercial enterprises operate at two fundamentally different scales, and presenting enterprise accounting to small retail merchants creates cognitive overload and user abandonment:
  1. **Simple Retail Mode (`enableEnterpriseFeatures: false`):**
     - Tailored for retail shops, supermarkets, boutiques, and small points of sale.
     - **Sales:** Restricted to POS, direct sales invoices, returns, and customers. Hides CRM, Sales Orders (SOs), quotations, and price lists.
     - **Purchases:** Restricted to direct purchase bills, new bill, returns, and suppliers. Hides POs, RFQs, and reorder suggestions.
     - **Inventory:** Restricted to catalog, categories, basic warehouses, and physical stock count. Hides inventory tree, storage bins, and internal issue/transfer orders.
     - **Finance:** Strictly renamed to **"الخزينة والمصروفات" (Cash Drawer & Expenses)**. Shows ONLY cash drawer/treasury and daily expenses. Hides all complex accounting: accounts tree, journal entries, cost centers, checks (PDC), bank reconciliation, balance sheet, cash flows, withholding tax, and fixed assets.
  2. **Enterprise Trading Mode (`enableEnterpriseFeatures: true`):**
     - Tailored for wholesale distributors, trading companies, and large organizations.
     - Activates the full enterprise suite: POs, RFQs, SOs, inventory tree, bin locations, full accounting ledgers, checks portfolio, bank reconciliations, and cost centers.
  3. **Silent Accounting Invariant (المحاسبة الصامتة في الخلفية):**
     - Even in Simple Retail Mode, the backend continues to post double-entry ledger entries silently in the background. If a business upgrades from Simple to Enterprise after months of operation, their financial books and ledger history remain 100% intact and immediately ready for auditors.
  4. **Pillar Independence:**
     - Pillars requiring enterprise financials by definition (`contracting`, `maritime_freight`, `manufacturing`) MUST always enforce `enableEnterpriseFeatures: true`. Only the commerce/retail pillar provides the user-toggleable operational mode.

## 19. Strict Mobile Single-Row Horizontal KPI Strip Standard (دستور شرائط الإحصائيات الأفقية المدمجة في شاشات الموبايل وحظر البلوكات المتراكمة)
- **The Core Problem & Mobile Viewport Trap:**
  When rendering summary statistics, KPI metrics, or financial breakdowns on mobile screens (e.g. Van Sales, POS, Field Reps, Daily Cash Count):
  - Naive CSS Grid `repeat(4, 1fr)` or separate vertically stacked card boxes cause disastrous layout collapse. In mobile viewports (<400px), CSS Grid items have a default `min-width: auto` which cannot shrink below content width, forcing tracks to collapse into a single vertical column, or causing each KPI to take a full row (wasting 250px+ of vertical space).
- **The Bulletproof Flex-Row Architectural Standard (المعيار الهندسي الصارم المعتمد):**
  - **Single Compact Row:** All 3, 4, or 5 KPI metrics MUST always be presented in **exactly 1 horizontal row** with a total height of ~34px to ~38px.
  - **Root Container:**
    ```tsx
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '6px 4px',
    textAlign: 'center',
    ```
  - **Child Metric Item (الخلايا الإحصائية الداخلية):**
    ```tsx
    flex: '1 1 0',
    minWidth: 0,
    borderInlineEnd: isLast ? 'none' : '1px solid #e2e8f0',
    padding: '2px 4px',
    textAlign: 'center',
    ```
  - **Micro-Typography Hierarchy:**
    - Label: `fontSize: '9.5px' - '10px'`, `fontWeight: 700`, `color: '#64748b'`, `marginBottom: '2px'`.
    - Value: `fontSize: '11px' - '12px'`, `fontWeight: 900`, `whiteSpace: 'nowrap'`.
  - **Strict Ban:** NEVER render KPI stats as separate vertically stacked cards on mobile. NEVER use CSS Grid `repeat(N, 1fr)` without strict min-width overrides.

## 16. Strict Single Source of Truth & Zero-Duplicate Action Dialogs Standard (دستور المصدر الواحد الشامل لنوافذ التأكيد والإجراءات التشغيلية)
- **حظر تكرار النوافذ البرمجية:** إذا كان هناك إجراء تشغيلي (مثل أرشفة الصنف، حذفه، تنشيطه، أو تغيير حالته) متوفراً في أكثر من شاشة أو مكان (مثل جدول الاستعراض وشاشة التعديل):
  - **يُمنع منعاً باتاً** برمجة نافذة تأكيد مختلفة أو استخدام `systemConfirm` في مكان ومودال مخصص في مكان آخر لنفس الإجراء.
- **المكون المشترك الموحد (Shared Reusable Dialog):**
  - يجب دائماً استخراج نافذة التأكيد في مكون مشترك مستقل (مثل `ProductArchiveConfirmDialog`) كـ Single Source of Truth.
  - الزر في أي شاشة يكون مجرد مشغل (`Trigger`) يستدعي نفس المكون الموحد ويمرر له البيانات ومؤشرات الحالة.
- **التوحيد البصري والوظيفي الكامل:**
  - أي تحسين بصري (مثل إضافة أيقونة التحذير ذات المثلث الأصفر المؤسسي، ملخص الصنف والباركود، شارات التنبيه المخزني، النقاط التشغيلية التوضيحية) يتم إجراؤه في هذا المكون الموحد لتنعكس تلقائياً وفوراً في كافة الشاشات بنسبة 100% وبدون سطر كود واحد مكرر.

## 20. Strict Global Root Landing & Back Button Standard (دستور زر الرجوع وحظر أسهم الرجوع في الشاشات الرئيسية)
- في الشريط العلوي الموحد `GlobalAppToolbar`:
- **حظر زر الرجوع في كافة الشاشات الرئيسية وصفحات الهبوط للقطاعات والموديولات:**
  - يُحظر نهائياً وبشكل قاطع ظهور زر الرجوع على أي صفحة رئيسية أو صفحة هبوط للمنظومة أو القطاعات المتخصصة (`/`, `/dashboard`, `/maritime`, `/maritime-freight`, `/maritime/inquiries`, `/contracting`, `/contracting/projects`, `/pos`, `/van-sales`, `/inventory/van-sales`, `/manufacturing`, `/driver`, `/setup`, `/activate`).
  - يتم فحص المسار مركزياً عبر دالة `isRootLandingRoute(location.pathname)`.
- **اشتراط تاريخ التصفح الفعلي داخل الجلسة (Real Navigation History Gate):**
  - لا يظهر زر الرجوع إطلاقاً إلا إذا كان للمستخدم تاريخ تنقل سابق داخل نفس جلسة التطبيق (`window.history.length > 1 && window.history.state?.idx > 0`).
  - عند فتح أي صفحة مباشرة عبر الرابط أو إعادة تحميل المتصفح (Refresh)، يُخفى زر الرجوع تلقائياً لمنع قذف المستخدم لخارج التطبيق أو إلى لوحة تجزئة عامة لا تخص نشاطه.

## 21. Strict Mobile-Compact Layout & Inviolable Desktop-Isolation Constitution (دستور شاشات الموبايل المضغوطة وعزل نسخة الكمبيوتر التام)
- **عزل نسخة الكمبيوتر التام وحظر مساسها (Inviolable Desktop Isolation):**
  - **يُمنع منعاً باتاً ونهائياً** اختصار أو تقليص أو ضغط أي نص أو كارت أو زر في نسخة الكمبيوتر (`Desktop > 768px`).
  - نسخة الكمبيوتر تحتفظ بنصوصها الكاملة وتوزيع أعمدتها الواسع (4 أعمدة للكروت والتبويبات) دون أي اختزال أو مساس.
  - جميع التعديلات والاختصارات والتوزيعات الثنائية تطبق حصرياً على شاشات الموبايل (`<= 768px`).
- **فئات المرافق الموحدة للنصوص المزدوجة:**
  - يُعتمد حصرياً على فئات النظام القياسية في `mobile-layout.css`:
    - `.desktop-only` و `.desktop-only-inline`: للنسخة الكاملة على الكمبيوتر (`display: none !important` على الموبايل).
    - `.mobile-only` و `.mobile-only-inline`: للنسخة المختصرة على الموبايل (`display: none !important` على الكمبيوتر).
- **الشبكة الثنائية لكروت المؤشرات (`2x2 KPI Grid`):**
  - على الموبايل، تُعرض كروت المؤشرات في شبكة ثنائية متوازنة (`grid-template-columns: repeat(2, 1fr)`) بدلاً من التكدس الرأسي المفرط سطر بسطر.
  - حشو مدمج (`10px 12px`) مع أيقونات رشيقة (32px) وأرقام واضحة وعناوين مختصرة عبر فئة `.workspace-compact-kpi-grid`.
- **الشبكة الثنائية للتبويبات وزر التحديث المانع للقص (`Zero-Clipping Actions`):**
  - تبويبات بيئات العمل تتبنى شبكة ثنائية متناسقة (`repeat(2, 1fr)`) بارتفاع 34px بدلاً من عمود فردي لكل زر.
  - زر التحديث في الهيدر يُعرض كأيقونة مربعة مدمجة (`34px`, `flex-shrink: 0`) تمنع التآكل والقص (`Zero-Clipping`) في الحافة اليسرى للشاشة.
- **دستور النوافذ المنبثقة ونماذج المودال على الموبايل والكمبيوتر (Modal Form Constitution):**
  - **حظر حشر أكثر من حقلين في سطر واحد على الموبايل (`Max 2-Columns on Mobile`):** يُمنع نهائياً حشر 3 أو 4 أو 6 حقول إدخال وقوائم منسدلة في سطر واحد على الموبايل، منعاً لتآكل الحقول إلى شرائح بعرض 50 بكسل وتآكل التسميات ("اسم العميل أو الشر..."). يجب تحويل شبكات النماذج الكثيفة إلى شبكة ثنائية متناسقة (`1fr 1fr`) مع تمديد الحقول الرئيسية (مثل اسم العميل أو توصيف البضاعة) بكامل العرض (`span 2`).
  - **الحماية البصرية لترويسات المودال ومنع انكسار الأقواس (`BiDi Wrap Protection`):** تُعزل كافة التسميات والترجمات الإنجليزية بين قوسين في عناوين المودالات وأقسامها (مثل `(New Ocean RFQ)` و `(Customer Information)` و `(Air Freight / AWB)`) داخل فئة `.desktop-only-inline` لتجنب انكسار الأقواس وتداخل اتجاهات النصوص ثنائية اللغة (BiDi) على شاشات الموبايل الضيقة.
  - **عزل نسخة الكمبيوتر التام:** تحتفظ النوافذ المنبثقة على الديسكتوب بتوزيع أعمدتها الواسع ونصوصها التوضيحية وتسمياتها الإنجليزية المكتملة دون أي مساس.
  - **الدمج السطري لفلاتر الفئات والأقاليم (`Single-Row Filters & Swipeable Lanes`):** فلاتر الفئات الثلاثية في نوافذ الاختيار والترسية (`CarrierSelectionGrid`) تندمج في سطر واحد ثلاثي الأعمدة (`repeat(3, 1fr)`) على الموبايل مع عناوين مدمجة بدلاً من 3 أسطر متراكمة، وتتحول شرائح الأقاليم إلى شريط تمرير أفقي سائل (`nowrap; overflow-x: auto`) في سطر واحد بدلاً من التكدس في 5 أسطر.
- **دستور شاشات الإعدادات والسياسات على الموبايل (`Settings & Policies Mobile Constitution`):**
  - التبويبات الفرعية للإعدادات تندمج في شبكة ثنائية 2-column مع عناوين عربية رشيقة تمنع تدفق النص الإنجليزي خارج الأزرار.
  - أزرار الهيدر الإجرائية (الفحص والحفظ) تتوزع في شبكة ثنائية بكامل العرض لمنع انقذاف زر الحفظ خارج الشاشة وتآكله.
  - حظر أسهم العدادات الافتراضية (Number Spinners) لمنع التشويه في بيئات RTL.
  - عزل التسميات الإنجليزية بين قوسين في عناوين الأقسام والمحطات وقنوات الإرسال تحت `.desktop-only-inline` لمنع انكسار الأقواس (BiDi wrap break).
  - تثبيت مربعات الاختيار (Checkboxes) على حافة البطاقة مع `flex-shrink: 0` و `flex: 1; min-width: 0` لكتلة النصوص لمنع تداخل الشيك بوكس مع أسطر الشرح.

## 22. Strict Enterprise High-Density Table & Compact Layout Standard (دستور التنسيق والضغط الجمالي المتزن للجداول والبيانات الكثيفة)
- **فلسفة الضغط الجمالي المتزن (The Visual Density & Compression Philosophy):**
  - تحقيق أعلى كثافة معلوماتية تشغيلية (High Information Density) مع الحفاظ التام على المظهر المؤسسي الأنيق والراحة البصرية للعين (`0px Horizontal Scroll`).
  - حظر التمدد العشوائي للأسطر الذي يولد السكرول الأفقي المشوه، وفي نفس الوقت حظر التكدس القبيح أو التآكل.
- **التوزيع الهرمي متعدد الأسطر داخل الخلايا (Intelligent 2-to-3 Line Cell Structure):**
  - بدلاً من تكديس كافة التفاصيل (مثل: الحاوية + الأوزان + الأحجام + أعداد الطرود + بيان الصنف) في سطر أفقي واحد طويل يدفع العمود للتمدد ويجبر الجدول على السكرول:
  - تُقسّم البيانات داخل الخلية هرمياً إلى 2 أو 3 أسطر متسقة:
    1. **السطر الأول (البيان الرئيسي):** رمز الحاوية أو الكود الأساسي بخط داكن بارز (`fontWeight: 700`, `fontSize: 0.78rem`).
    2. **السطر الثاني (الأبعاد والأوزان):** الأرقام والأوزان والطرود بخط ناعم بلون رمادي أردوازي (`#64748b`, `fontSize: 0.70rem`) مفصولة بنقاط فاصلة خفيفة (`•`).
    3. **السطر الثالث (التوصيف):** بيان الصنف بخط أصغر ملتف طبيعياً (`word-break: break-word; white-space: normal`, `fontSize: 0.70rem`) دون مد عرض الخلية.
- **التيبوجرافي الدقيق لأسماء الجهات والعملاء (Proportional Entity Typography):**
  - أسماء الشركات والعملاء الكبرى يجب ألا تلتهم مساحة الجدول بخطوط ضخمة:
    - **اسم العميل/الجهة:** `fontSize: '0.69rem'` إلى `'0.70rem'` (حوالي 11px) بوزن خط متزن `650` مع `line-height: 1.35` و `word-break: break-word`.
    - **بيانات التواصل التابعة (هاتف، بريد إلكتروني):** `fontSize: '0.65rem'` بلون رمادي هادئ (`#64748b`).
- **اختصار الشارات والإجراءات لتحرير مساحات الأعمدة الحيوية (Lean Badges & Action Buttons):**
  - استبدال العبارات الطويلة المزدحمة في الشارات بكلمات مؤسسية محكمة رشيقة:
    - `معمد (أمر تشغيل)` بدلاً من `تم التعميد (أمر تشغيل)`.
    - `تم التسعير` بدلاً من `تم تسعيرها للعميل`.
    - `طلب جديد` بدلاً من `طلب مستلم جديد`.
  - أزرار الإجراءات المتسلسلة تكون مقتضبة ومباشرة (مثل: `فتح الـ RFQ ←` بدلاً من `طلب التسعير جاهز`)، بأبعاد رشيقة (`max-width: 96px - 100px`، حشو `4px 6px`، خط `0.70rem`).
  - تقليص الحصة النسبية لعمودي الحالة والإجراءات إلى الحجم الأدنى (`8% - 10%`)، وإعادة تخصيص المساحة المحررة (4% - 6%) لخدمة أعمدة المحتوى الجوهري (اسم العميل والمسار والبيان).
- **دستور الجدول الثابت وحظر الـ minWidth العشوائي (`table-layout: fixed`):**
  - يُحظر نهائياً وضع `min-width` عشوائي ثابت (مثل `1020px` أو `1060px`) على الجداول داخل الحاويات المستقرة.
  - يُعتمد حصرياً `table-layout: fixed` مع `width: 100%` ونسب `<colgroup>` محكمة مجموعها 100% بالضبط، لضمان ملء عرض الشاشة 100% دون أي سكرول أفقي نهائياً.

## 23. Strict Intelligent Title Truncation, Responsive Typography & Zero-Header-Collision Standard (دستور الاختصار الذكي للعناوين، التيبوجرافي التفاعلي، وحظر تصادم وتداخل الهيدرات)
- **القاعدة العامة الحاكمة (The Universal Invariant):**
  عندما يكون العنوان أو اسم الصنف أو المستند طويلاً ومساحة الشاشة محدودة أو ضيقة (مثل شاشات اللابتوب 14 بوصة، النوافذ المنبثقة، أو عند تصغير المتصفح)، يجب على النظام التعامل بذكاء كامل عبر آليتين متكاملتين:
  1. **التصغير الديناميكي التفاعلي لحجم الخط ("أو يصغر الكلام" - Dynamic Responsive Typography):**
     - عند زيادة طول النص (أكثر من 25 حرفاً أو 40 حرفاً)، يتقلص حجم الخط تلقائياً وديناميكياً (عبر دوال تقييم طول النص مثل: `text.length > 40 ? '0.78rem' : text.length > 25 ? '0.84rem' : '0.94rem'` أو عبر `clamp(0.78rem, 1vw + 0.5rem, 0.98rem)`).
     - تصغير الخط يتيح استيعاب أكبر قدر ممكن من النص قبل الحاجة للقطع، ويمنع تضخم العناصر.
  2. **الاختصار الآمن بالقطع والنقاط ("يختصره" - Smart Truncation & Ellipsis):**
     - فرض `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; max-width: min(500px, 45vw);` على العنصر النشط أو العنوان الطويل.
     - **الإتاحة الكاملة بالتلميح الإلزامي (Mandatory Tooltip):** تزويد العنصر دائماً بخاصية `title={fullText}` لضمان قدرة المستخدم على قراءة النص كاملاً بمجرد تحويم مؤشر الفأرة (Hover).
- **حظر الالتفاف والتداخل نهائياً في أشرطة الأدوات العلوية (Zero Header Wrap & Collision):**
  - **حظر `flex-wrap: wrap`:** يُمنع منعاً باتاً تفعيل الالتفاف داخل أشرطة التنقل العلوية أو مسارات التتبع (`purchase-prototype-breadcrumb`, `document-prototype-breadcrumb`) أو هيدرات الصفحات ذات الارتفاع المحدد (`height: 45px` أو شريط الإجراءات).
  - الالتفاف داخل شريط بارتفاع ثابت يتسبب في تراكب الأسطر وتصادم النصوص فوق بعضها البعض مشوهاً المظهر العام للنظام.
  - يُفرض دائماً: `flex-wrap: nowrap !important; white-space: nowrap !important; min-width: 0; overflow: hidden;`.
- **حماية المسارات السابقة ومربع البحث (Path & Search Boundary Protection):**
  - المسارات السابقة في شجرة التتبع (مثل `الرئيسية › الأصناف`) تأخذ `flex-shrink: 0; white-space: nowrap;` للحفاظ على وضوح التسلسل الهرمي.
  - العنصر الأخير والنشط (اسم الصفحة أو الصنف) يأخذ `flex-shrink: 1; min-width: 0;` ليمتص هو الانكماش والاختصار بنقاط `...`.
  - مربع البحث في شريط الأدوات العلوي يجب أن يتمتع بمرونة التكيف (`min-width: 0; flex-shrink: 1; width: clamp(8.5rem, 12vw, 11.5rem)`) ولا يلتهم المساحة المخصصة للعنوان في الشاشات الصغيرة.

## 24. Strict Mandatory Multilingual & English Translation Standard (دستور الترجمة الإنجليزية الإلزامية ومنع النصوص والتنسيقات المعزولة)
- **قاعدة عامة إلزامية على مستوى المنظومة بالكامل (The Universal Multilingual Invariant):**
  - يُمنع منعاً باتاً إضافة أي شاشة جديدة، أو تعديل شاشة قائمة، أو إضافة نافذة منبثقة (Modal)، أو تبويب (Tab)، أو زر (Button)، أو شارة (Badge)، أو قائمة منسدلة دون توفير ودعم ترجمتها الإنجليزية فورياً وكاملاً.
  - أي نص جديد يُضاف عبر `t('namespace.key', 'نص عربي')` يجب فوراً وفي نفس اللحظة تسجيل ترجمته المقابلة في `frontend/src/locales/en.json`.
  - أي نصوص أو خيارات أو حالات مصفوفات مباشرة (مثل خيارات الـ Status أو الفلاتر أو الأزرار) يجب فوراً تسجيل ترجمتها ومطابقتها في قاموس الترجمة المركزي `frontend/src/lib/ui-dictionary.json`.
- **حظر تشفير التواريخ بالعربي نهائياً (Strict Ban on Hardcoded 'ar-EG' Dates):**
  - يُمنع منعاً باتاً كتابة `toLocaleDateString('ar-EG')` أو `toLocaleString('ar-EG')` أو `toLocaleTimeString('ar-EG')` بشكل ثابت ومجرد في أي مكون أو جدول أو صفحة.
  - التواريخ يجب دائماً أن تكون واعية بلغة الواجهة (Language-Aware):
    `isEn ? 'en-US' : 'ar-EG'` أو عبر قراءة لغة الواجهة الحالية `i18n.language === 'en' ? 'en-US' : 'ar-EG'`.
    عند اختيار الإنجليزية، تظهر التواريخ بالأشهر الإنجليزية والأرقام القياسية (مثل `Oct 14, 07:41 PM`) تلقائياً.
- **معيار رشاقة مسميات وأبعاد أزرار الجداول الإنجليزية (Zero-Clipping Action Buttons Standard):**
  - النصوص الإنجليزية تأخذ بطبيعتها مساحة أفقية أطول من العربية بنحو 1.5 إلى 2 ضعف (مثال: "مندوب دليفري" 12 حرفاً مقابل "Delivery representative" 23 حرفاً).
  - يجب دائماً اختيار مصطلحات إنجليزية مؤسسية رشيقة وموجزة تناسب أزرار الجداول:
    - `Delivery Rep` بدلاً من `Delivery representative`.
    - `Client Cancelled` بدلاً من `Cancelled by the client`.
    - `Order #` بدلاً من `RFQ Number`.
    - `In Cart (POS)` بدلاً من نصوص مطولة.
  - ضمان اتساع أعمدة الإجراءات (`minWidth: 360px+` في جداول الأوردرات) وتخصيص شبكة الأزرار (`gridTemplateColumns`) بحشو مريح (`padding: 0 4px - 6px`) لمنع أي تآكل أو قص للحروف (Zero Clipping).
- **حظر السقوط الصامت للمفاتيح (Zero Arabic Fallback Swallowing):**
  - يُمنع الاعتماد على السقوط التلقائي للغة العربية (Fallback to Arabic) عند تصفح النظام بالإنجليزية.
  - الحفاظ الدائم على نسبة تغطية 100% لمفاتيح `en.json` وعدم ترك أي مفتاح فارغاً أو متطابقاً مع النص العربي.

## 25. Strict Sidebar Zero-Duplication Standard (دستور منع التكرار الصارم في القوائم الجانبية والأنشطة)
- **حظر التكرار المطلق في القائمة الجانبية (Zero Sidebar Duplication Invariant):**
  - يُمنع منعاً باتاً تكرار أي بند أو مسار تنقل في السايد بار مرتين (سواء بين الاختصارات العلوية والمجموعات المنسدلة، أو بين مجموعتين مختلفتين).
  - **العزل البنيوي التلقائي:** أي بند يُدرج في الاختصارات السريعة العلوية للنشاط (`primaryNavigationKeys`) يُستبعد برمجياً وتلقائياً من كافة المجموعات (`sidebarGroups`) أسفله عبر محرك `deduplicatedSidebarGroups` في `app-shell.tsx`.
  - **حظر المجموعات الفارغة:** إذا استُنفدت عناصر أي مجموعة بالكامل بسبب تصعيدها للأعلى، تُحجب المجموعة ورأسها تلقائياً من العرض.
  - **حوكمة التحديد اللحظي:** المجموعات المنسدلة لا تُبرز ولا تُفتح تلقائياً عند الوقوف على اختصار علوي، مما يمنع التشتت والفتح غير المبرر للمجموعات.

## 26. Hardware Bridge Fixed-URL Replacement Standard (دستور ثبات روابط الجسر واستبدال النسخ القديمة بالحديثة في مكانها)
- **روابط التحميل الثابتة للجسر (`/download`):**
  - النسخ العامة المتاحة للعملاء عبر صفحة `/download` هي دائماً وبشكل ثابت:
    - `frontend/public/downloads/z-systems-bridge.exe` (`/downloads/z-systems-bridge.exe`)
    - `frontend/public/downloads/z-systems-bridge.zip` (`/downloads/z-systems-bridge.zip`)
    - `frontend/public/downloads/bridge-manifest.json`
- **قاعدة الاستبدال الإلزامية عند أي تحديث للجسر (`tools/z-systems-bridge/Program.cs` أو `src/ui/diagnostics.html`):**
  - يُمنع منعاً باتاً إنشاء ملفات مرقّمة بإصدار داخل اسم الملف (مثل `z-systems-bridge-v1.3.exe`) أو ترك نسخ قديمة متراكمة في `frontend/public/downloads/`.
  - عند أي تعديل على الجسر، يجب إعادة بناء `tools/z-systems-bridge/z-systems-bridge.exe` عبر `tools/z-systems-bridge/build.bat` (والذي يستدعي تلقائياً `scripts/sync-bridge-downloads.cjs`) أو تشغيل `node scripts/sync-bridge-downloads.cjs` بعد التجميع، لمسح أي ملفات قديمة واستبدال `z-systems-bridge.exe` و`z-systems-bridge.zip` و`bridge-manifest.json` **في مكانها وبنفس الأسماء الثابتة** حتى لا يتغير رابط التحميل أبداً.
  - يُمنع منعاً باتاً نسخ `bridge-config.json` أو `debug.log` إلى مجلد `frontend/public/downloads/`.


