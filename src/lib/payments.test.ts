import { describe, expect, it } from "vitest";
import { ingestPaymentEvent, RESULT, type ChargeRow, type PaymentStore } from "./payments";
import type { PaymentPayload } from "./pey";

/**
 * An in-memory database with the same guarantees as the real store: each
 * "atomic" method checks its guard and writes in one step.
 */
function fakeDb() {
  const groups = new Map<string, { status: "open" | "collecting" | "settled" }>();
  const members = new Map<string, { group_id: string; paid: boolean; paid_at: string | null }>();
  const charges = new Map<string, ChargeRow>(); // by pey_charge_id
  const events: Array<{ id: string; peyEventId: string | null; type: string; processed: boolean; result: string | null }> = [];

  const store: PaymentStore = {
    async eventProcessed(id) {
      return events.some((e) => e.peyEventId === id && e.processed);
    },
    async recordEvent({ peyEventId, type }) {
      const id = `ev${events.length + 1}`;
      events.push({ id, peyEventId, type, processed: false, result: null });
      return id;
    },
    async finishEvent(id, { processed, result }) {
      const e = events.find((x) => x.id === id)!;
      e.processed = processed;
      e.result = result;
    },
    async findCharge(key) {
      const c = charges.get(key);
      return c ? { ...c } : null;
    },
    async claimCharge(key, { paidAt, transactionId }) {
      const c = charges.get(key);
      if (!c || (c.status !== "pending" && c.status !== "expired")) return null;
      Object.assign(c, { status: "paid", paid_at: paidAt, pey_transaction_id: transactionId });
      return { ...c };
    },
    async markMemberPaid(id, paidAt) {
      const m = members.get(id);
      if (!m || m.paid) return false;
      m.paid = true;
      m.paid_at = paidAt;
      return true;
    },
    async groupStatus(id) {
      return groups.get(id)?.status ?? null;
    },
    async allMembersPaid(groupId) {
      return [...members.values()].filter((m) => m.group_id === groupId).every((m) => m.paid);
    },
    async settleGroup(id) {
      const g = groups.get(id);
      if (!g || g.status !== "collecting") return false;
      g.status = "settled";
      return true;
    },
  };

  /** Rosa paid $300; Diego and Luis owe $100 each. */
  function dinner() {
    groups.set("g1", { status: "collecting" });
    members.set("rosa", { group_id: "g1", paid: true, paid_at: "t0" });
    members.set("diego", { group_id: "g1", paid: false, paid_at: null });
    members.set("luis", { group_id: "g1", paid: false, paid_at: null });
    addCharge("TX_DIEGO", "diego", "push");
    addCharge("QR_LUIS", "luis", "qr");
  }

  function addCharge(key: string, member: string, method: "push" | "qr", status: ChargeRow["status"] = "pending") {
    charges.set(key, {
      id: `c-${key}`,
      group_id: "g1",
      member_id: member,
      pey_charge_id: key,
      reference: `g1:${member}:${charges.size + 1}`,
      amount_cents: 10_000,
      method,
      status,
      qr_string: null,
      codi_id: null,
      pey_transaction_id: null,
      simulated: false,
      created_at: "t0",
      paid_at: null,
      expires_at: null,
    });
  }

  return { store, groups, members, charges, events, dinner, addCharge };
}

const pn = (transactionId: string, amount = 100): PaymentPayload => ({
  type: "codi.pn.payment_received",
  amount,
  transactionId,
  datePaid: 1_790_724_758,
});

const qr = (codiQrId: string, transactionId: string, amount = 100): PaymentPayload => ({
  type: "codi.qr.payment_received",
  amount,
  codiQrId,
  transactionId,
  datePaid: 1_790_724_818,
});

describe("a payment notice from pey", () => {
  it("marks the charge and the person paid", async () => {
    const db = fakeDb();
    db.dinner();
    const out = await ingestPaymentEvent(db.store, { eventId: "msg_1", payload: pn("TX_DIEGO") });

    expect(out.result).toBe(RESULT.PAID);
    expect(db.charges.get("TX_DIEGO")!.status).toBe("paid");
    expect(db.charges.get("TX_DIEGO")!.pey_transaction_id).toBe("TX_DIEGO");
    expect(db.members.get("diego")!.paid).toBe(true);
    expect(db.groups.get("g1")!.status).toBe("collecting"); // Luis still owes
    expect(db.events).toHaveLength(1);
    expect(db.events[0].processed).toBe(true);
  });

  it("records a duplicate notice and does nothing else", async () => {
    const db = fakeDb();
    db.dinner();
    await ingestPaymentEvent(db.store, { eventId: "msg_1", payload: pn("TX_DIEGO") });
    const paidAt = db.members.get("diego")!.paid_at;

    // pey retries with the same webhook-id …
    const again = await ingestPaymentEvent(db.store, { eventId: "msg_1", payload: pn("TX_DIEGO") });
    // … or the same payment arrives under a new id.
    const sameTx = await ingestPaymentEvent(db.store, { eventId: "msg_2", payload: pn("TX_DIEGO") });

    expect(again.result).toBe(RESULT.DUPLICATE);
    expect(sameTx.result).toBe(RESULT.DUPLICATE);
    expect(db.members.get("diego")!.paid_at).toBe(paidAt);
    expect(db.events.map((e) => e.result)).toEqual([RESULT.PAID, RESULT.DUPLICATE, RESULT.DUPLICATE]);
  });

  it("applies a late payment that arrives after the request expired", async () => {
    const db = fakeDb();
    db.dinner();
    db.charges.get("TX_DIEGO")!.status = "expired";

    const out = await ingestPaymentEvent(db.store, { eventId: "msg_late", payload: pn("TX_DIEGO") });

    expect(out.result).toBe(RESULT.PAID_LATE);
    expect(db.charges.get("TX_DIEGO")!.status).toBe("paid");
    expect(db.members.get("diego")!.paid).toBe(true);
  });

  it("flags a person who pays twice for a refund, without changing amounts", async () => {
    const db = fakeDb();
    db.dinner();
    // Diego's first request expired, he asked again, then paid BOTH.
    db.addCharge("TX_DIEGO_2", "diego", "push");
    await ingestPaymentEvent(db.store, { eventId: "msg_a", payload: pn("TX_DIEGO") });
    const out = await ingestPaymentEvent(db.store, { eventId: "msg_b", payload: pn("TX_DIEGO_2") });

    expect(out.result).toContain(RESULT.REFUND);
    expect(db.members.get("diego")!.paid).toBe(true);
    expect(db.charges.get("TX_DIEGO_2")!.amount_cents).toBe(10_000);
    expect(db.groups.get("g1")!.status).toBe("collecting");
  });

  it("flags the same QR paid twice for a refund", async () => {
    const db = fakeDb();
    db.dinner();
    await ingestPaymentEvent(db.store, { eventId: "msg_q1", payload: qr("QR_LUIS", "TX_L1") });
    const out = await ingestPaymentEvent(db.store, { eventId: "msg_q2", payload: qr("QR_LUIS", "TX_L2") });
    expect(out.result).toContain(RESULT.REFUND);
  });

  it("settles the group with the last payment", async () => {
    const db = fakeDb();
    db.dinner();
    const first = await ingestPaymentEvent(db.store, { eventId: "msg_1", payload: pn("TX_DIEGO") });
    const last = await ingestPaymentEvent(db.store, { eventId: "msg_2", payload: qr("QR_LUIS", "TX_L1") });

    expect(first.settled).toBe(false);
    expect(last.settled).toBe(true);
    expect(last.result).toContain(RESULT.SETTLED);
    expect(db.groups.get("g1")!.status).toBe("settled");
  });

  it("never marks someone paid for less than their share", async () => {
    const db = fakeDb();
    db.dinner();
    const out = await ingestPaymentEvent(db.store, { eventId: "msg_s", payload: pn("TX_DIEGO", 99.99) });
    expect(out.result).toBe(RESULT.SHORT);
    expect(db.members.get("diego")!.paid).toBe(false);
    expect(db.charges.get("TX_DIEGO")!.status).toBe("pending");
  });

  it("records notices about charges it does not know, and moves on", async () => {
    const db = fakeDb();
    db.dinner();
    const out = await ingestPaymentEvent(db.store, { eventId: "msg_x", payload: pn("TX_NOBODY") });
    expect(out.result).toBe(RESULT.UNKNOWN_CHARGE);
    expect(db.events[0].processed).toBe(true);
  });

  it("leaves a notice unprocessed when the database fails, so the retry is not a duplicate", async () => {
    const db = fakeDb();
    db.dinner();
    const broken: PaymentStore = {
      ...db.store,
      markMemberPaid: async () => {
        throw new Error("db down");
      },
    };
    await expect(ingestPaymentEvent(broken, { eventId: "msg_1", payload: pn("TX_DIEGO") })).rejects.toThrow("db down");
    expect(db.events[0].processed).toBe(false);
    expect(await db.store.eventProcessed("msg_1")).toBe(false);
  });
});
