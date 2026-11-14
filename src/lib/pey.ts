import { randomBytes } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { centsToPesos, pesosToCents } from "./money";

/**
 * pey — CoDi charges. SERVER ONLY: it holds the API key.
 *
 * Everything here follows docs/pey-api.md, which is built from pey's own
 * OpenAPI and webhook pages. Anything those pages do not say is marked
 * TODO(pey-docs) rather than guessed.
 *
 * Amounts: the app works in whole centavos; pey takes and returns pesos as a
 * decimal number. The conversion happens here and nowhere else.
 */

if (typeof window !== "undefined") {
  throw new Error("pey.ts must never run in the browser");
}

export type ChargeMethod = "push" | "qr";

/** PEY_MOCK=1: no call ever reaches pey. Every screen says "SIMULADO". */
export function isMock(): boolean {
  return process.env.PEY_MOCK === "1";
}

/** How long a request stays payable. pey's minimum for both is 360 s. */
export const CHARGE_TTL_SECONDS = 600;

export class PeyError extends Error {
  constructor(
    message: string,
    public status = 502,
    /** pey's error.type, e.g. INVALID_PARAMETER. */
    public type?: string,
  ) {
    super(message);
  }
}

function config() {
  const key = process.env.PEY_API_KEY;
  const url = (process.env.PEY_API_URL ?? "").replace(/\/+$/, "");
  if (!key || !url) throw new PeyError("pey no está configurado en este servidor", 503);
  return { key, url };
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { key, url } = config();
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new PeyError(`No se pudo contactar a pey: ${(e as Error).message}`, 502);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // pey always answers JSON per its docs; a non-JSON body is an outage page.
  }

  if (!res.ok) {
    // Error format, every endpoint: { error: { message, type, requestId } }
    const err = (data as { error?: { message?: string; type?: string; requestId?: string } } | null)?.error;
    const msg = err?.message ?? `HTTP ${res.status}`;
    throw new PeyError(
      `pey rechazó la solicitud: ${msg}${err?.requestId ? ` (requestId ${err.requestId})` : ""}`,
      res.status >= 500 ? 502 : 400,
      err?.type,
    );
  }
  return data as T;
}

// ── create ──────────────────────────────────────────────────────────────────

export interface CreatedCharge {
  method: ChargeMethod;
  /** push: transactionId (ULID). qr: the IDC Banxico assigns to the QR. */
  peyChargeId: string;
  /** qr only: the string to encode into the QR image. */
  qrString: string | null;
  /** push only: CoDi folio from Banxico, 20 digits. */
  codiId: string | null;
  expiresAt: string;
  simulated: boolean;
}

/**
 * Create the CoDi charge for one share.
 *
 * With a phone: a push request to the payer's bank app (POST /codi/pn).
 * Without: a QR for the exact amount (POST /codi/qr).
 */
export async function createCharge(input: {
  amountCents: number;
  concept: string;
  /** groupId:memberId:n — ours, travels in metadata and comes back in the webhook. */
  reference: string;
  phone?: string | null;
}): Promise<CreatedCharge> {
  const method: ChargeMethod = input.phone ? "push" : "qr";
  if (input.phone && !/^[0-9]{10}$/.test(input.phone)) {
    throw new PeyError("El celular debe tener 10 dígitos", 400, "INVALID_PARAMETER");
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PeyError("El monto debe ser mayor a cero", 400, "INVALID_AMOUNT");
  }
  // pey: PN amount must be > 0 and ≤ 1,000,000 MXN.
  if (method === "push" && input.amountCents > 100_000_000) {
    throw new PeyError("Un cobro por notificación puede ser de máximo $1,000,000.00 MXN", 400, "INVALID_AMOUNT");
  }

  const expiresAt = new Date(Date.now() + CHARGE_TTL_SECONDS * 1000).toISOString();
  // TODO(pey-docs): the docs give no maximum length for `concept`; keep it short.
  const concept = input.concept.slice(0, 40);

  if (isMock()) {
    const fake = `SIM${randomBytes(10).toString("hex").toUpperCase()}`;
    return {
      method,
      peyChargeId: fake,
      qrString: method === "qr" ? JSON.stringify({ SIMULADO: true, IDC: fake, monto: centsToPesos(input.amountCents) }) : null,
      codiId: method === "push" ? String(Date.now()).padStart(20, "0") : null,
      expiresAt,
      simulated: true,
    };
  }

  const common = {
    amount: centsToPesos(input.amountCents),
    concept,
    expiration: CHARGE_TTL_SECONDS,
    metadata: { reference: input.reference },
  };

  if (method === "push") {
    const res = await call<{ transactionId?: string; codiId?: string }>("POST", "/codi/pn", {
      ...common,
      phoneNumber: input.phone,
    });
    if (!res?.transactionId) throw new PeyError("pey no devolvió transactionId", 502);
    return { method, peyChargeId: res.transactionId, qrString: null, codiId: res.codiId ?? null, expiresAt, simulated: false };
  }

  const res = await call<{ id?: string; qrString?: string }>("POST", "/codi/qr", common);
  if (!res?.id || !res.qrString) throw new PeyError("pey no devolvió el QR", 502);
  return { method, peyChargeId: res.id, qrString: res.qrString, codiId: null, expiresAt, simulated: false };
}

// ── read ────────────────────────────────────────────────────────────────────

export interface ChargeState {
  /** pey only documents PENDING and PAID. */
  status: "PENDING" | "PAID";
  /** The pey transaction that paid it, once paid. */
  transactionId: string | null;
  /** What was paid, in centavos — the base amount, without tip or fee. */
  paidCents: number | null;
  paidAt: string | null;
}

interface PeyTransaction {
  id: string;
  status: "PENDING" | "PAID";
  amount?: number;
  amountBreakdown?: { base?: number; tip?: number; fee?: number };
  datePaid?: number;
}

function toState(tx: PeyTransaction | undefined): ChargeState {
  if (!tx) return { status: "PENDING", transactionId: null, paidCents: null, paidAt: null };
  const base = tx.amountBreakdown?.base ?? tx.amount;
  return {
    status: tx.status,
    transactionId: tx.status === "PAID" ? tx.id : null,
    paidCents: tx.status === "PAID" && typeof base === "number" ? pesosToCents(base) : null,
    paidAt: tx.datePaid ? new Date(tx.datePaid * 1000).toISOString() : null,
  };
}

/**
 * The real state of a charge, asked of pey.
 *   push → GET /transaction/{transactionId}
 *   qr   → GET /transaction/codi/qr/{IDC} (a QR is not a transaction)
 */
export async function getCharge(peyChargeId: string, method: ChargeMethod): Promise<ChargeState> {
  if (isMock()) throw new PeyError("En modo simulado no hay a quién preguntarle a pey", 409);
  const id = encodeURIComponent(peyChargeId);
  if (method === "push") {
    return toState(await call<PeyTransaction>("GET", `/transaction/${id}`));
  }
  const page = await call<{ items?: PeyTransaction[] }>("GET", `/transaction/codi/qr/${id}`);
  return toState(page?.items?.find((t) => t.status === "PAID") ?? page?.items?.[0]);
}

// ── webhooks ────────────────────────────────────────────────────────────────

/** The two events Cuadra acts on (docs/pey-api.md → Webhooks). */
export type PaymentEventType = "codi.pn.payment_received" | "codi.qr.payment_received";

export interface PaymentPayload {
  type: PaymentEventType | string;
  /** Pesos. TODO(pey-docs): not stated whether this includes the payer's fee. */
  amount?: number;
  transactionId?: string;
  /** qr only: the IDC of the QR that was paid. */
  codiQrId?: string;
  datePaid?: number;
  concept?: string;
  numRef?: string;
  metadata?: { externalMetadata?: Record<string, string>; trackingKey?: string } & Record<string, unknown>;
}

export class WebhookRejected extends Error {}

function headerBag(headers: Headers | Record<string, string | undefined>): Record<string, string> {
  const get = (k: string) => (headers instanceof Headers ? headers.get(k) : headers[k]) ?? "";
  return {
    "webhook-id": get("webhook-id"),
    "webhook-timestamp": get("webhook-timestamp"),
    "webhook-signature": get("webhook-signature"),
  };
}

/**
 * Prove a webhook came from pey. pey signs every request with Standard
 * Webhooks; this uses the official library over the RAW body, as pey's own
 * example does. Throws WebhookRejected if anything does not check out.
 */
export function verifyWebhook(
  rawBody: string,
  headers: Headers | Record<string, string | undefined>,
): { eventId: string; payload: PaymentPayload } {
  const secret = process.env.PEY_WEBHOOK_SECRET;
  if (!secret) throw new WebhookRejected("PEY_WEBHOOK_SECRET no está configurado");
  const bag = headerBag(headers);
  try {
    // verify() checks the signature and that the timestamp is recent.
    // TODO(pey-docs): pey does not state its retry window; the library's
    // default timestamp tolerance applies.
    const payload = new Webhook(secret).verify(rawBody, bag) as PaymentPayload;
    return { eventId: bag["webhook-id"], payload };
  } catch (e) {
    throw new WebhookRejected(`Firma inválida: ${(e as Error).message}`);
  }
}
