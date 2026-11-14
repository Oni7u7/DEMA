import { NextResponse } from "next/server";
import { supabasePaymentStore } from "@/lib/paymentStore";
import { ingestPaymentEvent } from "@/lib/payments";
import { verifyWebhook, WebhookRejected } from "@/lib/pey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/pey — where pey says a CoDi payment arrived.
 *
 * Register THIS route, on the production domain, in pey's portal
 * (Desarrollador → engrane de la API key). The order matters:
 *   1. Read the body RAW — the signature is over the exact bytes.
 *   2. Verify it (Standard Webhooks, PEY_WEBHOOK_SECRET). Unsigned → 401.
 *   3. Record the notice, then apply it (payments.ts).
 *   4. 2xx as soon as that is stored, so pey does not retry forever. Only a
 *      database failure answers 5xx — then pey's retry is what we want.
 */
export async function POST(request: Request) {
  const raw = await request.text();

  let event;
  try {
    event = verifyWebhook(raw, request.headers);
  } catch (e) {
    if (e instanceof WebhookRejected) {
      return NextResponse.json({ error: "Webhook no verificado" }, { status: 401 });
    }
    throw e;
  }

  try {
    const outcome = await ingestPaymentEvent(supabasePaymentStore(), event);
    return NextResponse.json({ ok: true, result: outcome.result });
  } catch {
    return NextResponse.json({ error: "No se pudo registrar el aviso" }, { status: 500 });
  }
}
