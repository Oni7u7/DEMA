"use client";

import QRCode from "qrcode";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/components/Locale";
import { PressButton } from "@/components/Press";
import { explain, fetchWithin } from "@/lib/http";
import { formatCents } from "@/lib/netting";

/**
 * Paying a share, and watching the table get paid.
 *
 * The rule every piece here follows: the browser NEVER decides that someone
 * paid. It asks the server for a CoDi charge, then waits for the database to
 * say so — which only happens when pey's signed webhook reaches the server.
 */

export interface Charge {
  id: string;
  member_id: string;
  pey_charge_id: string;
  amount_cents: number;
  method: "push" | "qr";
  status: "pending" | "paid" | "expired" | "failed" | "refunded";
  qr_string: string | null;
  codi_id: string | null;
  pey_transaction_id: string | null;
  simulated: boolean;
  created_at: string;
  paid_at: string | null;
  expires_at: string | null;
}

export interface PayMember {
  id: string;
  name: string;
  share_cents: number | null;
  paid: boolean;
  paid_at: string | null;
}

type Act = (action: string, extra?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

/** A clock that ticks once a second, for countdowns. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const PHONE_KEY = "cuadra:phone";
function loadPhone(): string {
  try {
    return localStorage.getItem(PHONE_KEY) ?? "";
  } catch {
    return "";
  }
}
function savePhone(p: string) {
  try {
    localStorage.setItem(PHONE_KEY, p);
  } catch {
    // Remembered for this visit only.
  }
}

function digits(s: string) {
  return s.replace(/\D/g, "");
}

function isLive(c: Charge, now: number) {
  return c.status === "pending" && (!c.expires_at || new Date(c.expires_at).getTime() > now);
}

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The yellow "SIMULADO" tag: PEY_MOCK is on, no real money moves. */
export function SimTag() {
  return <span className="demo-tag inline">SIMULADO</span>;
}

// ── the participant's payment ───────────────────────────────────────────────

export function PayPanel({
  me,
  charges,
  busy,
  act,
  onRefresh,
}: {
  me: PayMember;
  /** This member's charges, newest first. */
  charges: Charge[];
  busy: string | null;
  act: Act;
  onRefresh: () => Promise<void> | void;
}) {
  const { t } = useLocale();
  const now = useNow();
  const [phone, setPhone] = useState("");
  const [showPhoneForm, setShowPhoneForm] = useState(false);
  useEffect(() => setPhone(loadPhone()), []);

  const amount = me.share_cents ?? 0;
  const paidCharge = charges.find((c) => c.status === "paid");
  const latest = charges[0];
  const live = latest && isLive(latest, now) ? latest : null;
  const phoneOk = digits(phone).length === 10;

  const payPush = async (resend = false) => {
    if (!phoneOk) return;
    savePhone(digits(phone));
    const res = await act("pay", { phone: digits(phone), method: "push", resend });
    if (res) setShowPhoneForm(false);
  };
  const payQr = () => act("pay", { method: "qr" });

  // Paid — only because the database says so.
  if (me.paid) {
    return (
      <section className="pay-card pay-done" role="status" aria-live="polite">
        <div className="pay-done-row">
          <span className="pay-check" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path className="draw-check" d="M4 12.5l5 5L20 6.5" />
            </svg>
          </span>
          <div>
            <strong>{t(`You paid ${formatCents(amount)}`, `Pagaste ${formatCents(amount)}`)}</strong>
            <span>{t("Confirmed by the server", "Confirmado por el servidor")}</span>
          </div>
          {paidCharge?.simulated && <SimTag />}
        </div>
        {paidCharge && (
          <dl className="pay-facts">
            <div>
              <dt>{t("pey folio", "Folio de pey")}</dt>
              <dd className="mono">{paidCharge.pey_transaction_id ?? paidCharge.pey_charge_id}</dd>
            </div>
            {paidCharge.codi_id && (
              <div>
                <dt>{t("CoDi folio", "Folio CoDi")}</dt>
                <dd className="mono">{paidCharge.codi_id}</dd>
              </div>
            )}
            {paidCharge.paid_at && (
              <div>
                <dt>{t("Paid at", "Pagado a las")}</dt>
                <dd>{new Date(paidCharge.paid_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</dd>
              </div>
            )}
          </dl>
        )}
        {paidCharge?.simulated && <SimControls charge={paidCharge} after onDone={onRefresh} />}
      </section>
    );
  }

  const phoneForm = (
    <form
      className="pay-form"
      onSubmit={(e) => {
        e.preventDefault();
        void payPush(Boolean(live && live.method === "push"));
      }}
    >
      <label className="field">
        <span className="label">{t("YOUR MOBILE NUMBER", "TU CELULAR")}</span>
        <input
          className="text-input"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="55 1234 5678"
          aria-invalid={phone !== "" && !phoneOk}
          aria-describedby="phone-help"
        />
        <span id="phone-help" className="field-help">
          {phone !== "" && !phoneOk
            ? t("It has to be 10 digits.", "Tienen que ser 10 dígitos.")
            : t("The number your bank app uses for CoDi. The request arrives there.", "El número que usa la app de tu banco para CoDi. Ahí te llega la solicitud.")}
        </span>
      </label>
      <PressButton type="submit" className="btn btn-settle" disabled={!phoneOk || busy !== null} aria-busy={busy === "pay"}>
        {busy === "pay" ? <Busy>{t("Sending the request…", "Enviando la solicitud…")}</Busy> : t("Pay my part with CoDi", "Pagar mi parte con CoDi")}
      </PressButton>
    </form>
  );

  // Nothing asked yet — or the last request ran out.
  if (!live) {
    const expired = Boolean(latest);
    return (
      <section className="pay-card" aria-live="polite">
        <span className="label">{t("YOUR PART", "TU PARTE")}</span>
        <div className="pay-amount">
          {formatCents(amount)} <span>MXN</span>
        </div>
        {expired && (
          <p className="pay-warn" role="status">
            <strong>{t("The request expired.", "La solicitud venció.")}</strong>{" "}
            {t(
              "If you already paid, do not pay again: it will be applied when the confirmation arrives.",
              "Si ya pagaste, no pagues de nuevo: se aplicará cuando llegue la confirmación.",
            )}
          </p>
        )}
        {phoneForm}
        <button type="button" className="link-button pay-alt" disabled={busy !== null} onClick={() => void payQr()}>
          {t("I'd rather scan a QR", "Prefiero escanear un QR")}
        </button>
      </section>
    );
  }

  const left = live.expires_at ? new Date(live.expires_at).getTime() - now : null;

  // A QR for the exact amount.
  if (live.method === "qr") {
    return (
      <section className="pay-card" aria-live="polite">
        <div className="pay-head">
          <span className="label">{t("SCAN WITH YOUR BANK APP", "ESCANEA CON LA APP DE TU BANCO")}</span>
          {live.simulated && <SimTag />}
        </div>
        <CodiQr value={live.qr_string ?? ""} amount={amount} />
        <p className="pay-sub">
          {t(`CoDi QR for ${formatCents(amount)} MXN.`, `QR CoDi por ${formatCents(amount)} MXN.`)}{" "}
          {left !== null && <span className="countdown">{t(`Expires in ${mmss(left)}`, `Vence en ${mmss(left)}`)}</span>}
        </p>
        <p className="room-note">
          {t("Your name turns green on every phone the moment the bank confirms.", "Tu nombre se pone en verde en todos los teléfonos en cuanto el banco confirme.")}
        </p>
        {live.simulated && <SimControls charge={live} onDone={onRefresh} />}
        {showPhoneForm ? (
          phoneForm
        ) : (
          <button type="button" className="link-button pay-alt" onClick={() => setShowPhoneForm(true)}>
            {t("Send the request to my phone instead", "Mejor mándame la solicitud al celular")}
          </button>
        )}
      </section>
    );
  }

  // A push request is waiting in the bank app.
  return (
    <section className="pay-card" aria-live="polite">
      <div className="pay-head">
        <span className="label">{t("CHECK YOUR BANK APP", "REVISA LA APP DE TU BANCO")}</span>
        {live.simulated && <SimTag />}
      </div>
      <div className="pay-amount">
        {formatCents(amount)} <span>MXN</span>
      </div>
      <ol className="pay-steps">
        <li>{t("Open your bank's app on this phone.", "Abre la app de tu banco en este celular.")}</li>
        <li>{t("Look for the CoDi payment request (it may come as a notification).", "Busca la solicitud de cobro CoDi (puede llegar como notificación).")}</li>
        <li>{t(`Accept it for ${formatCents(amount)}.`, `Acéptala por ${formatCents(amount)}.`)}</li>
      </ol>
      <div className="pay-wait">
        <span className="spinner" aria-hidden="true" />
        <span>
          {t("Waiting for the bank's confirmation…", "Esperando la confirmación del banco…")}
          {left !== null && <span className="countdown"> {t(`Expires in ${mmss(left)}`, `Vence en ${mmss(left)}`)}</span>}
        </span>
      </div>
      {live.simulated && <SimControls charge={live} onDone={onRefresh} />}
      <div className="pay-actions">
        <PressButton
          type="button"
          className="btn btn-ghost"
          disabled={busy !== null || !phoneOk}
          onClick={() => void payPush(true)}
        >
          {busy === "pay" ? <Busy>{t("Sending…", "Enviando…")}</Busy> : t("Resend request", "Reenviar solicitud")}
        </PressButton>
        <PressButton type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void payQr()}>
          {t("Scan a QR", "Escanear QR")}
        </PressButton>
      </div>
    </section>
  );
}

function Busy({ children }: { children: React.ReactNode }) {
  return (
    <span className="busy">
      <span className="spinner" aria-hidden="true" />
      {children}
    </span>
  );
}

/** The CoDi QR, drawn here from pey's qrString (pey recommends client-side). */
function CodiQr({ value, amount }: { value: string; amount: number }) {
  const { t } = useLocale();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    QRCode.toDataURL(value, { margin: 1, width: 440, errorCorrectionLevel: "M", color: { dark: "#1b2430", light: "#ffffff" } })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [value]);
  return (
    <div className="pay-qr">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- generated data URL
        <img src={src} width={220} height={220} alt={t(`CoDi QR to pay ${formatCents(amount)}`, `QR CoDi para pagar ${formatCents(amount)}`)} />
      ) : (
        <span className="invite-qr-empty">{t("Making the QR…", "Generando el QR…")}</span>
      )}
    </div>
  );
}

/**
 * PEY_MOCK only. Plays pey's part: sends the notice the real webhook would
 * get, through the same server code. "Repeat" and "second payment" exist to
 * show that a duplicate is ignored and a double payment is flagged.
 */
function SimControls({ charge, after = false, onDone }: { charge: Charge; after?: boolean; onDone: () => Promise<void> | void }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const send = useCallback(
    async (kind: "pay" | "repeat" | "second") => {
      setBusy(kind);
      setNote(null);
      try {
        const res = await fetchWithin(
          "/api/dev/simulate-payment",
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chargeId: charge.id, kind }) },
          20_000,
        );
        const data = (await res.json().catch(() => ({}))) as { result?: string; error?: string };
        setNote(res.ok ? `${t("Server", "Servidor")}: ${data.result}` : explain(new Error(data.error ?? `Error ${res.status}`), t));
        await onDone();
      } catch (e) {
        setNote(explain(e, t));
      } finally {
        setBusy(null);
      }
    },
    [charge.id, onDone, t],
  );

  return (
    <div className="sim-box">
      <span className="sim-title">
        <SimTag /> {t("Play pey's part", "Hacer de pey")}
      </span>
      <div className="sim-actions">
        {!after && (
          <button type="button" className="btn btn-ghost btn-inline" disabled={busy !== null} onClick={() => void send("pay")}>
            {busy === "pay" ? "…" : t("Simulate payment", "Simular pago")}
          </button>
        )}
        {after && (
          <>
            <button type="button" className="btn btn-ghost btn-inline" disabled={busy !== null} onClick={() => void send("repeat")}>
              {busy === "repeat" ? "…" : t("Repeat the notice", "Repetir el aviso")}
            </button>
            {charge.method === "qr" && (
              <button type="button" className="btn btn-ghost btn-inline" disabled={busy !== null} onClick={() => void send("second")}>
                {busy === "second" ? "…" : t("Scan the QR again", "Pagar el QR otra vez")}
              </button>
            )}
          </>
        )}
      </div>
      {note && (
        <p className="sim-note" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

// ── the table, for everyone (and the big screen) ────────────────────────────

export function TableBoard({
  totalOwed,
  collected,
  missing,
  settled,
  big = false,
}: {
  totalOwed: number;
  collected: number;
  missing: number;
  settled: boolean;
  big?: boolean;
}) {
  const { t } = useLocale();
  const reduce = useReducedMotion();
  const pct = totalOwed > 0 ? Math.min(1, collected / totalOwed) : 1;
  return (
    <section className={big ? "board board-big" : "board"} aria-live="polite">
      <div className="board-line">
        <span className="board-amount">
          {formatCents(collected)} <span>{t(`of ${formatCents(totalOwed)}`, `de ${formatCents(totalOwed)}`)}</span>
        </span>
        <span className={settled ? "board-left done" : "board-left"}>
          {settled
            ? t("Nobody owes anything", "Nadie debe nada")
            : missing === 1
              ? t("1 person left", "falta 1 persona")
              : t(`${missing} people left`, `faltan ${missing} personas`)}
        </span>
      </div>
      <div className="board-bar" role="progressbar" aria-valuemin={0} aria-valuemax={totalOwed} aria-valuenow={collected} aria-label={t("Collected", "Cobrado")}>
        <motion.i
          initial={false}
          animate={{ scaleX: pct }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 140, damping: 22 }}
        />
      </div>
      <AnimatePresence>
        {settled && (
          <motion.div
            className="board-settled"
            initial={reduce ? false : { opacity: 0, scale: 0.8, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            role="status"
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path className="draw-check" d="M4 12.5l5 5L20 6.5" />
            </svg>
            {t("Bill settled", "Cuenta saldada")}
            {!reduce && <Confetti />}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** A small burst, once. Pure CSS, skipped entirely under reduced motion. */
function Confetti() {
  return (
    <span className="confetti" aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => (
        <i key={i} style={{ "--i": i } as React.CSSProperties} />
      ))}
    </span>
  );
}

// ── payment events, for the admin ───────────────────────────────────────────

export interface EventRow {
  id: string;
  received_at: string;
  pey_event_id: string | null;
  type: string;
  processed: boolean;
  result: string | null;
  transactionId?: string | null;
  amount?: string | null;
}

/**
 * Every notice pey sent for this bill, duplicates included — the evidence
 * that each payment was confirmed on the server and none counted twice.
 */
export function PaymentEvents({ load, version }: { load: () => Promise<EventRow[] | null>; version: string }) {
  const { t } = useLocale();
  const [events, setEvents] = useState<EventRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    void load().then((rows) => {
      if (alive && rows) setEvents(rows);
    });
    return () => {
      alive = false;
    };
    // `version` changes whenever a charge or a member changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const tone = (r: string | null) =>
    !r ? "" : /devoluci|revis|menor/.test(r) ? "ev-warn" : /duplicado|ignorado/.test(r) ? "ev-dup" : /pagado/.test(r) ? "ev-ok" : "";

  return (
    <section className="events" aria-label={t("Payment events", "Eventos de pago")}>
      <span className="label">{t("PAYMENT EVENTS · SERVER", "EVENTOS DE PAGO · SERVIDOR")}</span>
      {events === null ? (
        <p className="room-note">{t("Loading…", "Cargando…")}</p>
      ) : events.length === 0 ? (
        <p className="room-note">{t("No notice from pey yet.", "Todavía no llega ningún aviso de pey.")}</p>
      ) : (
        <ul className="card events-list">
          {events.map((e) => (
            <li key={e.id} className={`event ${tone(e.result)}`}>
              <span className="event-time mono">
                {new Date(e.received_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span className="event-body">
                <span className="event-result">{e.result ?? (e.processed ? "—" : t("processing", "procesando"))}</span>
                <span className="event-meta mono">
                  {e.type.replace("codi.", "").replace(".payment_received", "")}
                  {e.amount ? ` · $${e.amount}` : ""}
                  {e.transactionId ? ` · ${e.transactionId}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
