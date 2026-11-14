import { pesosToCents } from "./money";
import type { PaymentPayload } from "./pey";

/**
 * What happens when pey says a payment arrived.
 *
 * This is the one place that turns a payment into "this person paid". It is
 * written against a small store interface so it can be tested with a fake
 * database; paymentStore.ts is the real one, on Supabase.
 *
 * The guarantees:
 *  - Every notice is recorded before anything changes, duplicates included.
 *  - A charge goes to "paid" through ONE conditional update
 *    (… WHERE status IN ('pending','expired') RETURNING *). Two deliveries of
 *    the same notice race on that row and only one wins; the other is
 *    recorded as a duplicate and does nothing.
 *  - A late payment — after its request expired — still counts.
 *  - A person who already paid and pays again is never "paid twice": the
 *    money is flagged for a refund and no amount changes.
 *  - The last payment settles the group.
 */

export type ChargeStatus = "pending" | "paid" | "expired" | "failed" | "refunded";

export interface ChargeRow {
  id: string;
  group_id: string;
  member_id: string;
  pey_charge_id: string;
  reference: string;
  amount_cents: number;
  method: "push" | "qr";
  status: ChargeStatus;
  qr_string: string | null;
  codi_id: string | null;
  pey_transaction_id: string | null;
  simulated: boolean;
  created_at: string;
  paid_at: string | null;
  expires_at: string | null;
}

export interface PaymentStore {
  /** Has a notice with this webhook-id already been fully processed? */
  eventProcessed(peyEventId: string): Promise<boolean>;
  recordEvent(e: { peyEventId: string | null; type: string; payload: unknown; groupId: string | null }): Promise<string>;
  finishEvent(id: string, outcome: { processed: boolean; result: string }): Promise<void>;
  findCharge(peyChargeId: string): Promise<ChargeRow | null>;
  /** Atomic: pending|expired → paid. Null when it was already something else. */
  claimCharge(peyChargeId: string, paid: { paidAt: string; transactionId: string | null }): Promise<ChargeRow | null>;
  /** Atomic: paid = false → true. False when the person had already paid. */
  markMemberPaid(memberId: string, paidAt: string): Promise<boolean>;
  groupStatus(groupId: string): Promise<"open" | "collecting" | "settled" | null>;
  allMembersPaid(groupId: string): Promise<boolean>;
  /** Atomic: collecting → settled. */
  settleGroup(groupId: string): Promise<boolean>;
}

export const RESULT = {
  PAID: "pagado",
  PAID_LATE: "pagado (tardío, después de vencer)",
  SETTLED: "cuenta saldada",
  DUPLICATE: "duplicado, ignorado",
  REFUND: "requiere devolución",
  UNKNOWN_CHARGE: "cargo desconocido, ignorado",
  IGNORED_TYPE: "tipo de evento no usado, ignorado",
  SHORT: "monto menor al cobro — revisar, no se aplicó",
  REOPENED: "la cuenta estaba reabierta — requiere revisión",
} as const;

const PAYMENT_TYPES = new Set(["codi.pn.payment_received", "codi.qr.payment_received"]);

/** Which of our charges a payment notice is about. */
export function chargeKey(payload: PaymentPayload): string | null {
  if (payload.type === "codi.qr.payment_received") return payload.codiQrId ?? null;
  if (payload.type === "codi.pn.payment_received") return payload.transactionId ?? null;
  return null;
}

export interface Outcome {
  eventRowId: string;
  processed: boolean;
  result: string;
  settled: boolean;
}

/**
 * Record a notice and apply it. The caller has already proven it came from
 * pey (verifyWebhook) — or, in PEY_MOCK, built it in the simulator.
 *
 * Throws only when the database fails; the webhook then answers 500 and pey
 * retries. A notice is skipped as a duplicate only once a delivery of it was
 * fully processed, so a crash mid-way never loses a payment.
 */
export async function ingestPaymentEvent(
  store: PaymentStore,
  event: { eventId: string | null; payload: PaymentPayload },
  now: () => Date = () => new Date(),
): Promise<Outcome> {
  const { eventId, payload } = event;
  const type = typeof payload?.type === "string" ? payload.type : "desconocido";
  const key = chargeKey(payload);
  const charge = key ? await store.findCharge(key) : null;

  const rowId = await store.recordEvent({
    peyEventId: eventId,
    type,
    payload,
    groupId: charge?.group_id ?? null,
  });

  const done = async (result: string, settled = false): Promise<Outcome> => {
    await store.finishEvent(rowId, { processed: true, result });
    return { eventRowId: rowId, processed: true, result, settled };
  };

  try {
    if (eventId && (await store.eventProcessed(eventId))) return done(RESULT.DUPLICATE);
    if (!PAYMENT_TYPES.has(type)) return done(RESULT.IGNORED_TYPE);
    if (!charge || !key) return done(RESULT.UNKNOWN_CHARGE);

    // Never mark someone paid for less than their share.
    // TODO(pey-docs): the webhook does not say whether `amount` includes the
    // payer's fee; a fee only makes it larger, so "at least" is the safe test.
    if (typeof payload.amount === "number" && pesosToCents(payload.amount) < charge.amount_cents) {
      return done(RESULT.SHORT);
    }

    const paidAt = payload.datePaid ? new Date(payload.datePaid * 1000).toISOString() : now().toISOString();
    const claimed = await store.claimCharge(key, { paidAt, transactionId: payload.transactionId ?? null });

    if (!claimed) {
      // The charge was already paid. Same transaction → the same notice again.
      // A different transaction → the same QR was paid a second time.
      const second =
        charge.status === "paid" &&
        !!payload.transactionId &&
        !!charge.pey_transaction_id &&
        payload.transactionId !== charge.pey_transaction_id;
      return done(second ? `${RESULT.REFUND}: segundo pago del mismo cobro` : RESULT.DUPLICATE);
    }

    const status = await store.groupStatus(claimed.group_id);
    if (status === "open") return done(RESULT.REOPENED);

    if (!(await store.markMemberPaid(claimed.member_id, paidAt))) {
      // They had already paid through another charge. Do not touch amounts.
      return done(`${RESULT.REFUND}: la persona ya había pagado`);
    }

    const late = charge.status === "expired";
    let result: string = late ? RESULT.PAID_LATE : RESULT.PAID;
    let settled = false;
    if (status === "collecting" && (await store.allMembersPaid(claimed.group_id))) {
      settled = await store.settleGroup(claimed.group_id);
      if (settled) result = `${result} · ${RESULT.SETTLED}`;
    }
    return done(result, settled);
  } catch (e) {
    // Leave it unprocessed so pey's retry is not mistaken for a duplicate.
    await store.finishEvent(rowId, { processed: false, result: `error: ${(e as Error).message}` }).catch(() => {});
    throw e;
  }
}
