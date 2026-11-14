import type { ChargeRow, PaymentStore } from "./payments";
import { serverClient } from "./supabase";

/**
 * The real PaymentStore, on Supabase. Each "atomic" method is ONE SQL
 * statement with its guard in the WHERE clause, so concurrent deliveries of
 * the same notice cannot both win.
 */
export function supabasePaymentStore(): PaymentStore {
  const db = serverClient();

  const must = <T>(r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };

  return {
    async eventProcessed(peyEventId) {
      const rows = must(
        await db.from("webhook_events").select("id").eq("pey_event_id", peyEventId).eq("processed", true).limit(1),
      );
      return (rows ?? []).length > 0;
    },

    async recordEvent({ peyEventId, type, payload, groupId }) {
      const row = must(
        await db
          .from("webhook_events")
          .insert({ pey_event_id: peyEventId, type, payload, group_id: groupId, processed: false })
          .select("id")
          .single(),
      );
      return (row as { id: string }).id;
    },

    async finishEvent(id, { processed, result }) {
      must(await db.from("webhook_events").update({ processed, result }).eq("id", id));
    },

    async findCharge(peyChargeId) {
      const row = must(await db.from("charges").select("*").eq("pey_charge_id", peyChargeId).maybeSingle());
      return (row as ChargeRow | null) ?? null;
    },

    async claimCharge(peyChargeId, { paidAt, transactionId }) {
      // UPDATE charges SET status='paid', paid_at=…
      //  WHERE pey_charge_id=$1 AND status IN ('pending','expired') RETURNING *
      const rows = must(
        await db
          .from("charges")
          .update({ status: "paid", paid_at: paidAt, pey_transaction_id: transactionId })
          .eq("pey_charge_id", peyChargeId)
          .in("status", ["pending", "expired"])
          .select("*"),
      );
      return ((rows ?? []) as ChargeRow[])[0] ?? null;
    },

    async markMemberPaid(memberId, paidAt) {
      const rows = must(
        await db.from("members").update({ paid: true, paid_at: paidAt }).eq("id", memberId).eq("paid", false).select("id"),
      );
      return (rows ?? []).length > 0;
    },

    async groupStatus(groupId) {
      const row = must(await db.from("groups").select("status").eq("id", groupId).maybeSingle());
      return ((row as { status?: "open" | "collecting" | "settled" } | null)?.status ?? null);
    },

    async allMembersPaid(groupId) {
      const rows = must(await db.from("members").select("id").eq("group_id", groupId).eq("paid", false).limit(1));
      return (rows ?? []).length === 0;
    },

    async settleGroup(groupId) {
      const rows = must(
        await db.from("groups").update({ status: "settled" }).eq("id", groupId).eq("status", "collecting").select("id"),
      );
      return (rows ?? []).length > 0;
    },
  };
}
