/**
 * FE4 canonical money rounding for the van / field-reps UI.
 *
 * INV-FE4-VAN-MONEY-ROUNDING (proposed): every computed money value in the
 * delivery-reps / maintenance / trade-in UI that used to be rounded inline
 * with `Number((...).toFixed(2))` routes through this one function instead.
 * The function is deliberately a pure re-spelling of the inline sites it
 * replaces: `Number(value.toFixed(2))` with NO input coercion, so routing a
 * site through it changes NO value (NaN stays NaN, exactly as before).
 *
 * Deliberately NOT the backend `roundMoney` semantics: the backend rounds
 * with `Math.round(amount * 10 ** digits)` (half-up on the scaled float),
 * while `toFixed(2)` rounds on the decimal representation — the two differ
 * on float-boundary values (e.g. 1.005 -> 1.00 here, 1.01 there).
 * Aligning the frontend rounding with the backend is a cross-FE policy
 * decision for a later package (the POS-local `roundMoney` in
 * `features/pos/lib/pos.domain.ts` has these same toFixed(2) semantics);
 * this package only removes the duplication, it does not change any value.
 *
 * Currency: all call sites are EGP-denominated van amounts (2dp). A caller
 * on a 3dp tenant currency must NOT use this helper — that is a follow-up,
 * not a silent 2dp cut.
 */
export function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}
