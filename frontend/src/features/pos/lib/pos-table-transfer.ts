/* INV-REST-FLOOR-TRANSFER-TRUTH (T10-E, F6): the whole-table transfer
 * lived as two inline copies (PosWorkspace + PosWorkspaceHeader) that
 * persisted via raw API calls and never invalidated the held-drafts
 * query, so a draft saved on table 5 existed in the DB while the floor,
 * table 5 and the held list all still read the pre-transfer snapshot —
 * and the fall-through branch toasted success while persisting nothing
 * (notably for split checks stored as "N - شيك k", which never equalled
 * "N"). One shared handler now owns the transfer: branch (a) renames a
 * held draft server-side, branch (b) saves the live cart as a held draft
 * on the target table THROUGH saveHeldDraftMutation (whose onSuccess is
 * the only invalidation the old code bypassed), and after either
 * persisting branch the handler invalidates queryKeys.posHeldDrafts and
 * awaits the refetch before the caller closes the dialog — so the lists
 * show the draft on table 5 immediately. A missing source is an error,
 * never a success toast.
 *
 * INV-REST-FLOOR-VERIFY-REFETCH (T13-A): the write resolving is not proof
 * it landed — a rename the server accepts but never applies, or a save
 * that resolves without persisting, still left the floor showing the old
 * table under a success toast. After the refetch the handler re-reads the
 * held-drafts cache and only reports success when the re-read shows the
 * order on the target table and nothing left on the source; anything
 * else is a named error, never a success.
 */
import type { QueryClient } from '@tanstack/react-query';
import { queryClient as appQueryClient } from '@/app/providers';
import { queryKeys } from '@/app/query-keys';
import { getFriendlyApiErrorMessage } from '@/lib/api-error-message';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';

/* Split checks are stored as "N - شيك k" (PosSplitBillModal) — they
 * belong to source table N, so a transfer from N must find them. */
export function normalizeTableNumber(value: unknown): string {
  const raw = String(value ?? '').trim();
  const split = raw.match(/^(.+?)\s*-\s*شيك\s*\d+\s*$/);
  return (split ? split[1] : raw).trim();
}

export interface TransferSourceDraft {
  id: string | number;
  tableNumber?: string | number | null;
}

export function findTransferSourceDrafts(
  heldDrafts: TransferSourceDraft[],
  from: string,
): TransferSourceDraft[] {
  const want = normalizeTableNumber(from);
  return heldDrafts.filter((d) => normalizeTableNumber(d.tableNumber) === want);
}

export interface TableTransferCartItem {
  productId?: unknown;
  qty?: unknown;
  price?: unknown;
  name?: unknown;
  unitName?: unknown;
  unitMultiplier?: unknown;
  priceType?: string;
  notes?: unknown;
  modifiers?: unknown;
  seatNumber?: unknown;
  course?: unknown;
}

export interface TransferHeldDraftPayloadInput {
  to: string;
  cart: TableTransferCartItem[];
  customerId?: string | null;
  paymentType?: unknown;
  discount?: number;
  deliveryFee?: number;
  note?: string;
  search?: string;
  priceType?: unknown;
  branchId?: string | null;
  locationId?: string | null;
  cashAmount?: number;
  cardAmount?: number;
  transferAmount?: number;
  paymentChannel?: unknown;
  orderType?: string;
}

/* The branch-(b) payload, byte-identical in shape to the old inline
 * handler — one builder so the two transfer copies cannot drift apart. */
export function buildTransferHeldDraftPayload(input: TransferHeldDraftPayloadInput): unknown {
  return {
    customerId: input.customerId || null,
    paymentType: input.paymentType,
    discount: input.discount,
    deliveryFee: input.deliveryFee,
    note: input.note,
    search: input.search,
    priceType: input.priceType,
    branchId: input.branchId || null,
    locationId: input.locationId || null,
    cashAmount: input.cashAmount,
    cardAmount: input.cardAmount,
    transferAmount: input.transferAmount,
    paymentChannel: input.paymentChannel,
    orderType: input.orderType || 'dine_in',
    tableNumber: input.to,
    items: input.cart.map((item) => ({
      productId: Number(item.productId || 0),
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      name: String(item.name || '').trim(),
      unitName: String(item.unitName || '').trim(),
      unitMultiplier: Number(item.unitMultiplier || 1),
      priceType: item.priceType === 'wholesale' ? 'wholesale' : 'retail',
      notes: String(item.notes || '').trim(),
      modifiers: item.modifiers || [],
      seatNumber: item.seatNumber ? Number(item.seatNumber) : undefined,
      course: item.course || undefined,
    })),
  };
}

/* Invalidate AND await the refetch: invalidateQueries alone only marks
 * the query stale, and the caller closes the dialog right after this
 * resolves — awaiting refetchQueries is what makes the fresh draft
 * visible in the floor / held lists immediately. */
export async function refreshHeldDrafts(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.posHeldDrafts });
  await queryClient.refetchQueries({ queryKey: queryKeys.posHeldDrafts });
}

export type TableTransferOutcome =
  | { status: 'renamed'; draftId: string | number }
  | { status: 'held-saved' }
  | { status: 'error'; message: string };

/* The re-read after a transfer write: refreshHeldDrafts (invalidate +
 * await refetch) is the read path — this just surfaces what it landed.
 * An empty cache means the re-read never landed, which the verifier
 * below treats as unverified, never as success. */
export function readHeldDrafts(queryClient: QueryClient): TransferSourceDraft[] {
  return queryClient.getQueryData<TransferSourceDraft[]>(queryKeys.posHeldDrafts) ?? [];
}

export interface TransferVerification {
  from: string;
  to: string;
  /* Branch (a): the renamed draft must be the one on the target table. */
  draftId?: string | number;
  /* Branch (b): the saved draft is new, so the target table must hold
   * strictly more drafts than before the write — a pre-existing draft
   * on the target must not stand in for the one just saved. */
  minTargetCount?: number;
}

/* Verify-after-write: the re-read must show the transferred order on
 * the target table and nothing left on the source. Either half failing
 * means the write cannot be proven to have landed. */
export function verifyTransferLanded(
  heldDrafts: TransferSourceDraft[],
  verification: TransferVerification,
): boolean {
  const wantTarget = normalizeTableNumber(verification.to);
  const wantSource = normalizeTableNumber(verification.from);
  const onTarget = heldDrafts.filter((d) => normalizeTableNumber(d.tableNumber) === wantTarget);
  const onSource = heldDrafts.filter((d) => normalizeTableNumber(d.tableNumber) === wantSource);
  if (onSource.length > 0) return false;
  if (verification.draftId !== undefined) {
    return onTarget.some((d) => String(d.id) === String(verification.draftId));
  }
  return onTarget.length > (verification.minTargetCount ?? 0);
}

function transferVerifyFailedMessage(from: string, to: string): string {
  return `تعذر التحقق من نقل الطلب من طاولة ${from} إلى طاولة ${to} بعد الحفظ — لم يظهر الطلب على طاولة ${to} بعد إعادة القراءة. تحقق من قائمة الطاولات قبل إعادة المحاولة.`;
}

export interface TableTransferInput extends TransferHeldDraftPayloadInput {
  queryClient?: QueryClient;
  from: string;
  heldDrafts: TransferSourceDraft[];
  tableNumber: string;
  saveHeldDraft: (payload: unknown) => Promise<unknown>;
  renameHeldDraftTable?: (draftId: number, toTable: string) => Promise<unknown>;
}

export async function transferTableOrder(input: TableTransferInput): Promise<TableTransferOutcome> {
  const { from, to } = input;
  const queryClient = input.queryClient ?? appQueryClient;
  if (normalizeTableNumber(from) === normalizeTableNumber(to)) {
    return { status: 'error', message: `طاولة المصدر والهدف واحدة (${from}) — اختر طاولة أخرى.` };
  }

  const matches = findTransferSourceDrafts(input.heldDrafts, from);
  if (matches.length > 1) {
    // Several split checks on one table: moving only the first would
    // silently move the wrong check — refuse with a named message.
    return {
      status: 'error',
      message: `الطاولة ${from} لديها ${matches.length} شيكات محفوظة — انقل كل شيك على حدة من قائمة الطاولات المفتوحة.`,
    };
  }
  const sourceDraft = matches[0];
  if (sourceDraft) {
    try {
      const rename = input.renameHeldDraftTable ?? restaurantAdvancedFnbApi.renameHeldDraftTable;
      await rename(Number(sourceDraft.id), to);
    } catch (error) {
      return {
        status: 'error',
        message: getFriendlyApiErrorMessage(error, `تعذر نقل الطلب من طاولة ${from} إلى طاولة ${to}`),
      };
    }
    await refreshHeldDrafts(queryClient);
    if (
      !verifyTransferLanded(readHeldDrafts(queryClient), { from, to, draftId: sourceDraft.id })
    ) {
      return { status: 'error', message: transferVerifyFailedMessage(from, to) };
    }
    return { status: 'renamed', draftId: sourceDraft.id };
  }

  const isLiveCartOnSource =
    input.cart.length > 0 && normalizeTableNumber(input.tableNumber) === normalizeTableNumber(from);
  if (isLiveCartOnSource) {
    const targetCountBefore = findTransferSourceDrafts(input.heldDrafts, to).length;
    try {
      await input.saveHeldDraft(buildTransferHeldDraftPayload(input));
    } catch (error) {
      return {
        status: 'error',
        message: getFriendlyApiErrorMessage(error, `تعذر نقل الطلب من طاولة ${from} إلى طاولة ${to}`),
      };
    }
    await refreshHeldDrafts(queryClient);
    if (
      !verifyTransferLanded(readHeldDrafts(queryClient), {
        from,
        to,
        minTargetCount: targetCountBefore,
      })
    ) {
      return { status: 'error', message: transferVerifyFailedMessage(from, to) };
    }
    return { status: 'held-saved' };
  }

  // INV-REST-FLOOR-TRANSFER-TRUTH (T10-E, F6): the old fall-through set
  // the table and toasted success while persisting NOTHING. No draft
  // and no live cart on the source is an error, never a success.
  return {
    status: 'error',
    message: `لا يوجد طلب على طاولة ${from} لنقله إلى طاولة ${to}.`,
  };
}

export type RenameHeldDraftOutcome =
  | { status: 'renamed'; draftId: string | number }
  | { status: 'error'; message: string };

/* Standalone rename for the held-drafts dialog (same post-rename
 * invalidation as a transfer), reusing renameHeldDraftTable. */
export async function renameHeldDraftTableAndRefresh(input: {
  queryClient?: QueryClient;
  draftId: string | number;
  toTable: string;
  renameHeldDraftTable?: (draftId: number, toTable: string) => Promise<unknown>;
}): Promise<RenameHeldDraftOutcome> {
  const to = String(input.toTable ?? '').trim();
  if (!to) {
    return { status: 'error', message: 'أدخل رقم طاولة صحيحاً.' };
  }
  try {
    const rename = input.renameHeldDraftTable ?? restaurantAdvancedFnbApi.renameHeldDraftTable;
    await rename(Number(input.draftId), to);
  } catch (error) {
    return {
      status: 'error',
      message: getFriendlyApiErrorMessage(error, `تعذر تغيير طاولة الطلب المحفوظ إلى ${to}`),
    };
  }
  await refreshHeldDrafts(input.queryClient ?? appQueryClient);
  return { status: 'renamed', draftId: input.draftId };
}
