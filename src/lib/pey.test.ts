import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Webhook } from "standardwebhooks";
import { createCharge, verifyWebhook, WebhookRejected } from "./pey";

// A throwaway secret in the whsec_ format, made up for this test only.
const SECRET = `whsec_${Buffer.from("cuadra-test-secret-0123456789abcd").toString("base64")}`;
const BODY = JSON.stringify({ type: "codi.pn.payment_received", amount: 100, transactionId: "01TEST" });

function signed(body: string, id = "msg_test") {
  const ts = new Date();
  const signature = new Webhook(SECRET).sign(id, ts, body);
  return { "webhook-id": id, "webhook-timestamp": String(Math.floor(ts.getTime() / 1000)), "webhook-signature": signature };
}

describe("verifyWebhook", () => {
  beforeEach(() => {
    process.env.PEY_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.PEY_WEBHOOK_SECRET;
  });

  it("accepts a notice signed with the secret, and hands back its webhook-id", () => {
    const out = verifyWebhook(BODY, new Headers(signed(BODY)));
    expect(out.eventId).toBe("msg_test");
    expect(out.payload.transactionId).toBe("01TEST");
  });

  it("rejects a body changed after signing", () => {
    const headers = signed(BODY);
    expect(() => verifyWebhook(BODY.replace("100", "1"), headers)).toThrow(WebhookRejected);
  });

  it("rejects an unsigned notice and one without a configured secret", () => {
    expect(() => verifyWebhook(BODY, {})).toThrow(WebhookRejected);
    delete process.env.PEY_WEBHOOK_SECRET;
    expect(() => verifyWebhook(BODY, signed(BODY))).toThrow(WebhookRejected);
  });
});

describe("createCharge in PEY_MOCK", () => {
  beforeEach(() => {
    process.env.PEY_MOCK = "1";
  });
  afterEach(() => {
    delete process.env.PEY_MOCK;
  });

  it("never calls pey and says it is simulated", async () => {
    const push = await createCharge({ amountCents: 41_667, concept: "Cena", reference: "g:m:1", phone: "5512345678" });
    const qr = await createCharge({ amountCents: 41_667, concept: "Cena", reference: "g:m:2" });
    expect(push.simulated).toBe(true);
    expect(push.method).toBe("push");
    expect(qr.method).toBe("qr");
    expect(qr.qrString).toContain("SIMULADO");
  });
});
