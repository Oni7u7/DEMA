/**
 * Pesos. Every amount in the app is whole centavos; the only place a decimal
 * peso exists is at the edge with pey, whose API takes and returns MXN as a
 * number with decimals (see docs/pey-api.md).
 */

import { formatCents } from "./netting";

export type Currency = "MXN";
export const CURRENCY: Currency = "MXN";

export function isCurrency(value: unknown): value is Currency {
  return value === "MXN";
}

/** "$2,500.00 MXN" — always labelled. */
export function formatMoney(cents: number, currency: Currency = CURRENCY): string {
  return `${formatCents(cents)} ${currency}`;
}

/** Centavos → the peso number pey expects. 41667 → 416.67. */
export function centsToPesos(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("Amounts must be whole, non-negative centavos");
  }
  // Two decimals exactly: integer division keeps float error out of the cents.
  return Number(`${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);
}

/** A peso number from pey → centavos. 416.67 → 41667. */
export function pesosToCents(pesos: number): number {
  if (typeof pesos !== "number" || !Number.isFinite(pesos) || pesos < 0) {
    throw new Error("Not a peso amount");
  }
  return Math.round(pesos * 100);
}
