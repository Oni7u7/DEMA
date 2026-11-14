import { describe, expect, it } from "vitest";
import { cleanPhone, requestPaymentWith, type CollectDeps } from "./collect";
import type { ChargeRow } from "./payments";

const NOW = new Date("2026-11-14T20:00:00Z");

function setup(overrides: { status?: "open" | "collecting" | "settled"; paid?: boolean } = {}) {
  const charges: ChargeRow[] = [];
  let created = 0;
  const deps: CollectDeps = {
    async load() {
      return {
        group: { id: "g1", name: "Cena", status: overrides.status ?? "collecting", payer_id: "rosa" },
        member: { id: "diego", name: "Diego", share_cents: 41_667, paid: overrides.paid ?? false },
      };
    },
    async chargesOf() {
      return charges.map((c) => ({ ...c }));
    },
    async expire(id) {
      const c = charges.find((x) => x.id === id);
      if (c && c.status === "pending") c.status = "expired";
    },
    async savePhone() {},
    async createCharge({ phone }) {
      created++;
      return {
        method: phone ? "push" : "qr",
        peyChargeId: `PEY${created}`,
        qrString: phone ? null : "{}",
        codiId: null,
        expiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
        simulated: true,
      };
    },
    async insertCharge(row) {
      const c: ChargeRow = { ...row, id: `c${charges.length + 1}`, status: "pending", created_at: NOW.toISOString(), paid_at: null, pey_transaction_id: null };
      charges.unshift(c);
      return c;
    },
    now: () => NOW,
  };
  return { deps, charges, created: () => created };
}

describe("requestPayment", () => {
  it("does not create a second charge while one is still live", async () => {
    const t = setup();
    const first = await requestPaymentWith(t.deps, { phone: "5512345678" });
    const again = await requestPaymentWith(t.deps, { phone: "5512345678" });

    expect(first.reused).toBe(false);
    expect(again.reused).toBe(true);
    expect(again.charge.id).toBe(first.charge.id);
    expect(t.created()).toBe(1);
    expect(t.charges).toHaveLength(1);
  });

  it("charges exactly the share, with a unique reference", async () => {
    const t = setup();
    const { charge } = await requestPaymentWith(t.deps, { method: "qr" });
    expect(charge.amount_cents).toBe(41_667);
    expect(charge.reference).toBe("g1:diego:1");
    expect(charge.method).toBe("qr");
  });

  it("makes a new request once the old one has expired, and marks the old one expired", async () => {
    const t = setup();
    const first = await requestPaymentWith(t.deps, { phone: "5512345678" });
    t.charges[0].expires_at = new Date(NOW.getTime() - 1).toISOString();

    const next = await requestPaymentWith(t.deps, { phone: "5512345678" });
    expect(next.reused).toBe(false);
    expect(t.charges.find((c) => c.id === first.charge.id)!.status).toBe("expired");
    expect(next.charge.reference).toBe("g1:diego:2");
  });

  it("replaces a live push request only when asked to resend", async () => {
    const t = setup();
    const first = await requestPaymentWith(t.deps, { phone: "5512345678" });
    const resent = await requestPaymentWith(t.deps, { phone: "5512345678", resend: true });
    expect(resent.reused).toBe(false);
    expect(t.charges.find((c) => c.id === first.charge.id)!.status).toBe("expired");
  });

  it("refuses before collecting starts, after the person paid, and without a valid phone for push", async () => {
    await expect(requestPaymentWith(setup({ status: "open" }).deps, {})).rejects.toThrow(/no están activos/);
    await expect(requestPaymentWith(setup({ paid: true }).deps, {})).rejects.toThrow(/Ya pagaste/);
    await expect(requestPaymentWith(setup().deps, { method: "push" })).rejects.toThrow(/celular/);
    await expect(requestPaymentWith(setup().deps, { phone: "12345" })).rejects.toThrow(/10 dígitos/);
  });
});

describe("cleanPhone", () => {
  it("accepts 10 digits written any common way", () => {
    expect(cleanPhone("55 1234 5678")).toBe("5512345678");
    expect(cleanPhone("+52 55-1234-5678")).toBe("5512345678");
    expect(cleanPhone("")).toBeNull();
  });
});
