"use client";

import { LogoMark, Wordmark } from "@/components/Logo";
import { Logo3D } from "@/components/Logo3D";
import { PressLink } from "@/components/Press";
import { Reveal } from "@/components/Reveal";
import { CountUp, Magnetic, TiltCard, ScrollProgress } from "@/components/LandingMotion";
import { useLocale } from "@/components/Locale";
import { formatCents } from "@/lib/netting";
import { equalShares } from "@/lib/split";
import { useLiveBills } from "@/lib/useLiveBills";

/** The example on the page: a $2,500 dinner for six, split by the same code the app runs. */
const SAMPLE_BILL = 250_000;
const SAMPLE_PEOPLE = 6;

/**
 * The landing: what Cuadra does, in the order it happens at the table.
 * Every number on it comes from the same split code the app uses.
 */
export default function Landing() {
  const { t } = useLocale();
  const live = useLiveBills();
  const shares = [...equalShares(SAMPLE_BILL, Array.from({ length: SAMPLE_PEOPLE }, (_, i) => `p${i}`)).values()];
  // Rosa paid; four of the other five already paid their share by CoDi.
  const collected = shares.slice(1, 5).reduce((a, c) => a + c, 0);
  const owedTotal = SAMPLE_BILL - shares[0];
  const offlineNote =
    live === "offline" ? (
      <span className="lp-status" role="status">
        {t(
          "Bills are offline right now — their database cannot be reached. Try again in a moment.",
          "Las cuentas están fuera de línea ahora — no se puede llegar a su base de datos. Intenta de nuevo en un momento.",
        )}
      </span>
    ) : null;

  return (
    <main className="landing">
      <ScrollProgress />
      <nav className="lp-top" aria-label="Cuadra">
        <LogoMark size={38} badge />
        <Wordmark width={120} />
      </nav>

      <header className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-kicker">{t("Split the bill · paid with CoDi", "Divide la cuenta · se paga con CoDi")}</span>
          <h1 aria-label={t("Everyone pays their part. No screenshots.", "Cada quien paga su parte. Sin comprobantes.")}>
            <Words text={t("Everyone pays their part.", "Cada quien paga su parte.")} />{" "}
            <span className="lp-accent">
              <Words text={t("No screenshots.", "Sin comprobantes.")} offset={4} />
            </span>
          </h1>
          <p className="lp-lead">
            {t(
              "One person pays the dinner and shows a QR. Everyone scans it, sees their share, and pays it from their bank app with CoDi. One screen shows who already paid and how much is missing — confirmed by the server, not by a photo of a transfer.",
              "Una persona paga la cena y enseña un QR. Todos lo escanean, ven su parte y la pagan desde la app de su banco con CoDi. Una sola pantalla muestra quién ya pagó y cuánto falta — confirmado por el servidor, no por la foto de una transferencia.",
            )}
          </p>
          <div className="lp-cta">
            <Magnetic>
              <PressLink href="/nuevo" className="btn btn-dark lp-cta-main">
                {t("Split a bill", "Dividir una cuenta")}
                <CtaArrow />
              </PressLink>
            </Magnetic>
          </div>
          {offlineNote}
        </div>
        <div className="lp-hero-mark">
          <Logo3D alt={t("Cuadra logo: an eye inside a network of connections", "Logo de Cuadra: un ojo dentro de una red de conexiones")} />
        </div>
      </header>

      <Reveal>
        <section className="lp-flow" aria-label={t("How it works at the table", "Cómo funciona en la mesa")}>
          <FlowStep
            n={1}
            motion="scan"
            title={t("Scan the QR", "Escanean el QR")}
            body={t("Whoever paid opens the bill. Everyone else scans in and sees who they are and what they owe.", "Quien pagó abre la cuenta. Los demás escanean y ven quiénes son y cuánto deben.")}
            icon={<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2v2h-2zM18 14h2v2h-2z" />}
          />
          <FlowStep
            n={2}
            motion="split"
            title={t("Pick the split", "Eligen cómo dividir")}
            body={t("Equal parts to the cent, amounts the payer sets, or each person enters their own.", "Partes iguales al centavo, montos que pone quien pagó, o cada quien escribe lo suyo.")}
            icon={<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8" />}
          />
          <FlowStep
            n={3}
            motion="check"
            title={t("Each one pays with CoDi", "Cada quien paga con CoDi")}
            body={t("A payment request lands in each person's bank app, or they scan a CoDi QR. When the bank confirms, their name turns green on every phone.", "A cada quien le llega una solicitud de cobro a la app de su banco, o escanea un QR CoDi. Cuando el banco confirma, su nombre se pone en verde en todos los teléfonos.")}
            icon={<path d="M4 12.5l5 5L20 6.5" />}
          />
        </section>
      </Reveal>

      <Reveal>
        <section className="lp-dollars" aria-labelledby="lp-board-title">
          <div className="lp-dollars-copy">
            <span className="lp-kicker">{t("One screen for the whole table", "Una pantalla para toda la mesa")}</span>
            <h2 id="lp-board-title">{t("Who paid, and how much is missing", "Quién pagó y cuánto falta")}</h2>
            <ul className="lp-points">
              <Point icon={<path d="M4 12.5l5 5L20 6.5" />}>
                <strong>{t("Confirmed by the server.", "Confirmado por el servidor.")}</strong>{" "}
                {t("A share counts as paid only when pey notifies our server, with a signed message. The browser can never mark anyone paid.", "Una parte cuenta como pagada solo cuando pey avisa a nuestro servidor, con un mensaje firmado. El navegador nunca puede marcar a nadie como pagado.")}
              </Point>
              <Point icon={<path d="M4 7h16M4 12h10M4 17h6" />}>
                <strong>{t("Never charged twice.", "Nunca se cobra dos veces.")}</strong>{" "}
                {t("A repeated notice is recorded and ignored. A second payment from the same person is flagged for a refund.", "Un aviso repetido se registra y se ignora. Un segundo pago de la misma persona se marca para devolución.")}
              </Point>
              <Point icon={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}>
                <strong>{t("Late is still paid.", "Tarde también cuenta.")}</strong>{" "}
                {t("If a payment arrives after its request expired, it is applied anyway — nobody is asked to pay again.", "Si un pago llega después de que venció la solicitud, se aplica igual — nadie tiene que pagar otra vez.")}
              </Point>
            </ul>
          </div>

          <div className="lp-fx-card" aria-live="polite">
            <span className="label">{t("A $2,500 DINNER FOR SIX", "UNA CENA DE $2,500 ENTRE SEIS")}</span>
            <div className="lp-fx-row">
              <CountUp className="lp-fx-big" to={collected} format={(v) => formatCents(Math.round(v))} />
              <span className="lp-fx-unit">MXN</span>
            </div>
            <span className="lp-fx-rate">
              {t(`collected of ${formatCents(owedTotal)} · 1 person left`, `cobrados de ${formatCents(owedTotal)} · falta 1 persona`)}
            </span>
            <div className="bento-meter" aria-hidden="true">
              <span className="on" /><span className="on" /><span className="on" /><span className="on" /><span />
            </div>
            <span className="lp-chip">{t(`${formatCents(shares[1])} each`, `${formatCents(shares[1])} c/u`)}</span>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="lp-bento" aria-labelledby="lp-bento-title">
          <header className="lp-bento-head">
            <span className="lp-kicker">{t("How it holds together", "Cómo se sostiene")}</span>
            <h2 id="lp-bento-title">{t("A confirmed payment, a verifiable action", "Un pago confirmado, una acción verificable")}</h2>
          </header>

          <TiltCard className="bento bento-codi" max={4}>
            <BentoIcon><><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" /></></BentoIcon>
            <span className="bento-by">CoDi · pey</span>
            <h3>{t("A request straight to the bank app", "Un cobro directo a la app del banco")}</h3>
            <p>
              {t(
                "Type your 10-digit number and a CoDi payment request arrives in your bank app for exactly your share. No card, no account number, no transfer to copy by hand.",
                "Escribe tu número a 10 dígitos y te llega a la app de tu banco una solicitud de cobro CoDi por exactamente tu parte. Sin tarjeta, sin CLABE, sin transferencia que copiar a mano.",
              )}
            </p>
          </TiltCard>

          <TiltCard className="bento bento-qr" max={4}>
            <BentoIcon><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2z" /></BentoIcon>
            <span className="bento-by">CoDi QR</span>
            <h3>{t("Or scan a QR", "O escanea un QR")}</h3>
            <p>{t("Prefer not to share your number? Each share also comes as a CoDi QR for its exact amount.", "¿Prefieres no dar tu número? Cada parte también sale como un QR CoDi por su monto exacto.")}</p>
          </TiltCard>

          <TiltCard className="bento bento-webhook" max={4}>
            <BentoIcon><path d="M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7z" /></BentoIcon>
            <span className="bento-by">{t("Signed webhooks", "Webhooks firmados")}</span>
            <h3>{t("Only the server says “paid”", "Solo el servidor dice “pagado”")}</h3>
            <p>{t("Every notice from pey is checked against its signature and stored before anything changes.", "Cada aviso de pey se verifica con su firma y se guarda antes de cambiar nada.")}</p>
          </TiltCard>

          <TiltCard className="bento bento-events" max={4}>
            <BentoIcon><path d="M3 12h4l3-8 4 16 3-8h4" /></BentoIcon>
            <span className="bento-by">{t("Payment events", "Eventos de pago")}</span>
            <h3>{t("Every notice, on the record", "Cada aviso, registrado")}</h3>
            <p>{t("The admin sees each notice that arrived — including the repeated ones that were ignored.", "Quien administra ve cada aviso que llegó — incluidos los repetidos que se ignoraron.")}</p>
          </TiltCard>
        </section>
      </Reveal>

      <Reveal>
        <section className="lp-final">
          <LogoMark size={64} className="lp-final-mark" />
          <h2>{t("Is the bill already here?", "¿Ya llegó la cuenta?")}</h2>
          <p>{t("Open it, show the QR, and let everyone pay their part.", "Ábrela, enseña el QR y que cada quien pague su parte.")}</p>
          <Magnetic>
            <PressLink href="/nuevo" className="btn lp-final-cta">
              {t("Split a bill", "Dividir una cuenta")}
            </PressLink>
          </Magnetic>
          {offlineNote}
        </section>
      </Reveal>

      <footer className="lp-foot2">
        <div className="lp-foot2-brand">
          <LogoMark size={26} />
          <Wordmark width={84} />
        </div>
        <p>
          {t(
            "Payments in Mexican pesos with CoDi, through pey. Built on the bill-splitting engine of Squash, an earlier project by the team.",
            "Pagos en pesos mexicanos con CoDi, a través de pey. Basado en el motor de división de cuentas de Squash, proyecto previo del equipo.",
          )}
        </p>
        <span className="lp-muted">Cuadra · Hackathon Cursor 2026</span>
      </footer>
    </main>
  );
}

function FlowStep({
  n,
  title,
  body,
  icon,
  motion,
}: {
  n: number;
  title: string;
  body: string;
  icon: React.ReactNode;
  motion: "scan" | "split" | "check";
}) {
  return (
    <TiltCard className={`lp-step step-${motion}`}>
      <div className="lp-step-top">
        <span className="lp-step-icon" aria-hidden="true">
          {motion === "scan" && <i className="scan-line" />}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {icon}
          </svg>
        </span>
        <span className="lp-step-n">0{n}</span>
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
    </TiltCard>
  );
}

function Point({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li>
      <span className="lp-point-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </span>
      <span>{children}</span>
    </li>
  );
}

function BentoIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="bento-icon" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

/** A line that rises in word by word — CSS, so the words rest visible. */
function Words({ text, offset = 0 }: { text: string; offset?: number }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span key={`${w}-${i}`} className="word" aria-hidden="true" style={{ animationDelay: `${(offset + i) * 70}ms` }}>
          {w}
          {i < text.split(" ").length - 1 ? "\u00a0" : ""}
        </span>
      ))}
    </>
  );
}

function CtaArrow() {
  return (
    <svg className="cta-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
