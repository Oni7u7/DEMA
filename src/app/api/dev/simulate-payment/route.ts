import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { centsToPesos } from "@/lib/money";
import { supabasePaymentStore } from "@/lib/paymentStore";
import { ingestPaymentEvent, type ChargeRow } from "@/lib/payments";
import { isMock, type PaymentPayload } from "@/lib/pey";
import { serverClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/dev/simulate-payment — SIMULADO. Only exists with PEY_MOCK=1;
 * otherwise it is a 404, in every environment.
 *
 * It builds the notice pey would send for a charge and hands it to exactly
 * the same code as the real webhook (ingestPaymentEvent), minus the signature
 * check — there is no pey to sign it.
 *
 * Body: { chargeId, kind? }
 *   kind "pay"    (default) the payment arrives.
 *   kind "repeat" the SAME notice arrives again (same webhook-id and
 *                 transaction) — it must be recorded and ignored.
 *   kind "second" a DIFFERENT payment of the same charge — it must be
 *                 flagged for a refund.
 */
export async function POST(request: Request) {
  if (!isMock()) return new NextResponse(null, { status: 404 });

  let body: { chargeId?: unknown; kind?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const kind = body.kind === "repeat" || body.kind === "second" ? body.kind : "pay";

  const { data, error } = await serverClient().from("charges").select("*").eq("id", String(body.chargeId ?? "")).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  const charge = data as ChargeRow | null;
  if (!charge) return NextResponse.json({ error: "Ese cobro no existe" }, { status: 404 });
  if (!charge.simulated) return NextResponse.json({ error: "Solo se simulan cobros simulados" }, { status: 409 });

  // The first payment of a charge keeps one transaction id, so "repeat" can
  // send it again byte for byte.
  const firstTx = charge.method === "push" ? charge.pey_charge_id : `SIMTX${charge.id.replace(/-/g, "").slice(0, 20).toUpperCase()}`;
  const transactionId = kind === "second" ? `SIMTX${randomBytes(10).toString("hex").toUpperCase()}` : firstTx;
  const eventId = kind === "second" ? `msg_sim_${randomBytes(8).toString("hex")}` : `msg_sim_${charge.id}`;

  const payload: PaymentPayload = {
    type: charge.method === "push" ? "codi.pn.payment_received" : "codi.qr.payment_received",
    amount: centsToPesos(charge.amount_cents),
    transactionId,
    ...(charge.method === "qr" ? { codiQrId: charge.pey_charge_id } : {}),
    datePaid: Math.floor(Date.now() / 1000),
    concept: "SIMULADO",
    metadata: { externalMetadata: { reference: charge.reference } },
  };

  try {
    const outcome = await ingestPaymentEvent(supabasePaymentStore(), { eventId, payload });
    return NextResponse.json({ ok: true, simulated: true, result: outcome.result, settled: outcome.settled });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
