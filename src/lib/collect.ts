import type { ChargeRow } from "./payments";
import type { ChargeMethod, CreatedCharge } from "./pey";

/**
 * Asking one person for their share — the rules, separate from the database
 * so they can be tested on their own. groups.ts wires them to Supabase and
 * pey.
 */

export class CollectError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface CollectDeps {
  /** The group and the member, after their secret has been checked. */
  load(): Promise<{
    group: { id: string; name: string; status: "open" | "collecting" | "settled"; payer_id: string };
    member: { id: string; name: string; share_cents: number | null; paid: boolean };
  }>;
  /** Every charge this member has, newest first. */
  chargesOf(memberId: string): Promise<ChargeRow[]>;
  expire(chargeId: string): Promise<void>;
  savePhone(memberId: string, phone: string): Promise<void>;
  createCharge(input: { amountCents: number; concept: string; reference: string; phone?: string | null }): Promise<CreatedCharge>;
  insertCharge(row: Omit<ChargeRow, "id" | "created_at" | "paid_at" | "pey_transaction_id" | "status">): Promise<ChargeRow>;
  now(): Date;
}

/** A pending charge whose request has not run out yet. */
export function isLive(c: ChargeRow, now: Date): boolean {
  return c.status === "pending" && (!c.expires_at || new Date(c.expires_at).getTime() > now.getTime());
}

export function cleanPhone(input: unknown): string | null {
  if (input === undefined || input === null || input === "") return null;
  const digits = String(input).replace(/\D/g, "");
  // A Mexican number written with its country code: keep the last 10.
  const ten = digits.length === 12 && digits.startsWith("52") ? digits.slice(2) : digits;
  if (!/^[0-9]{10}$/.test(ten)) throw new CollectError("El celular debe tener 10 dígitos");
  return ten;
}

/**
 * Charge a member their share.
 *
 *  - Only while collecting, and only if they have not paid.
 *  - A live request of the same kind is handed back instead of a new one —
 *    tapping the button twice never sends two requests.
 *  - `resend` deliberately replaces a live push request. The old one is
 *    marked expired; if it is paid anyway, the webhook still applies it.
 */
export async function requestPaymentWith(
  deps: CollectDeps,
  opts: { phone?: unknown; method?: unknown; resend?: unknown },
): Promise<{ charge: ChargeRow; reused: boolean }> {
  const { group, member } = await deps.load();

  if (group.status === "settled") throw new CollectError("Esta cuenta ya está saldada", 409);
  if (group.status !== "collecting") throw new CollectError("Los cobros todavía no están activos", 409);
  if (member.paid) throw new CollectError("Ya pagaste tu parte", 409);
  if (member.id === group.payer_id) throw new CollectError("Tú pagaste la cuenta: no te toca pagar", 409);
  const amount = member.share_cents ?? 0;
  if (amount <= 0) throw new CollectError("Tu parte es $0.00: no hay nada que pagar", 409);

  const phone = cleanPhone(opts.phone);
  const method: ChargeMethod = opts.method === "qr" ? "qr" : phone ? "push" : "qr";
  if (opts.method === "push" && !phone) throw new CollectError("Escribe tu celular para recibir la solicitud de cobro");

  const now = deps.now();
  const mine = await deps.chargesOf(member.id);

  // Requests that ran out are expired now, so the record says so.
  for (const c of mine) {
    if (c.status === "pending" && !isLive(c, now)) {
      await deps.expire(c.id);
      c.status = "expired";
    }
  }

  const live = mine.find((c) => c.method === method && isLive(c, now));
  if (live && !(opts.resend === true && method === "push")) {
    return { charge: live, reused: true };
  }
  if (live) {
    await deps.expire(live.id);
    live.status = "expired";
  }

  if (phone) await deps.savePhone(member.id, phone);

  const reference = `${group.id}:${member.id}:${mine.length + 1}`;
  const created = await deps.createCharge({
    amountCents: amount,
    concept: `${group.name} · ${member.name}`,
    reference,
    phone: method === "push" ? phone : null,
  });

  const charge = await deps.insertCharge({
    group_id: group.id,
    member_id: member.id,
    pey_charge_id: created.peyChargeId,
    reference,
    amount_cents: amount,
    method: created.method,
    qr_string: created.qrString,
    codi_id: created.codiId,
    simulated: created.simulated,
    expires_at: created.expiresAt,
  });
  return { charge, reused: false };
}
