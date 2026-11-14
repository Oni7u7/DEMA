import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CURRENCY, type Currency } from "./money";
import { checkShares, equalShares, transfersToPayer, type SplitMode } from "./split";
import { serverClient } from "./supabase";

/**
 * A group splitting one bill — server side only.
 *
 * The rules this file enforces, because nothing else can:
 *
 *  - Only the admin changes how the bill is split.
 *  - Nobody acts on someone else's behalf. Every write that acts as a person
 *    must present that person's secret, which only their phone holds.
 *  - The split is frozen before anyone pays. Once the admin turns collection
 *    on, each person is charged exactly their share; changing a share after
 *    that would mean people agreed to one number and paid another.
 *  - A person is "paid" only when pey says so to the server. The browser never
 *    marks anyone paid.
 */

export type GroupStatus = "open" | "collecting" | "settled";

export interface GroupRow {
  id: string;
  name: string;
  total_cents: number;
  payer_id: string;
  split_mode: SplitMode;
  status: GroupStatus;
  currency: Currency;
  created_at: string;
}

export interface MemberRow {
  id: string;
  group_id: string;
  name: string;
  is_admin: boolean;
  share_cents: number | null;
  /** Join order. Unique per group, so two people racing for a seat cannot collide. */
  seat: number;
  /** 10 digits, for the CoDi push request. */
  phone: string | null;
  /** Set only by the server, when pey confirms the payment. */
  paid: boolean;
  paid_at: string | null;
  joined_at: string;
}

/** The most people one bill can hold. */
export const MAX_SEATS = 20;

export class GroupError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/**
 * Code sent to the browser when the database cannot be reached at all (DNS
 * gone, project paused, network down). The client turns it into a message
 * a person can act on instead of a raw "TypeError: fetch failed".
 */
export const DB_OFFLINE = "db_offline";

export function isDbUnreachable(e: unknown): boolean {
  const text = `${(e as Error)?.message ?? ""} ${String((e as { cause?: unknown })?.cause ?? "")}`;
  return /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo|Supabase server access is not configured/i.test(text);
}

/**
 * Can live bills be served right now? One cheap read with a short deadline,
 * so the screens can say "offline" before anyone fills in a form, instead of
 * after they press the button.
 */
export async function liveBillsReachable(): Promise<boolean> {
  // The client's own retries (1 s, 2 s, 4 s) made an unreachable database take
  // ~7 s to report. Ask without them, and give one quick second chance so a
  // single network blip does not switch the light to "offline".
  if (await readOnce()) return true;
  await new Promise((resolve) => setTimeout(resolve, 800));
  return readOnce();
}

async function readOnce(): Promise<boolean> {
  try {
    const { error } = await serverClient()
      .from("groups")
      .select("id")
      .limit(1)
      .retry(false)
      .abortSignal(AbortSignal.timeout(4_000));
    // A read that hit its deadline counts as unreachable too.
    return !(error && (isDbUnreachable(error) || /abort|timeout/i.test(error.message ?? "")));
  } catch {
    return false;
  }
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l to misread

function randomId(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cleanName(input: unknown, max: number): string {
  const name = String(input ?? "").trim().replace(/\s+/g, " ");
  if (name.length === 0) throw new GroupError("Falta el nombre");
  if (name.length > max) throw new GroupError(`El nombre puede tener máximo ${max} caracteres`);
  return name;
}

/**
 * Store a member's secret, surviving a flaky database gateway.
 *
 * Seen in production: the insert answered 504 while the member row had
 * already been written, leaving a person at the table with no way to prove
 * who they are. So: retry, treat "already there" as success (a 504 can hide
 * a commit), and if it still fails, remove the member so nobody is left
 * holding a session that can never work.
 */
async function storeSecret(memberId: string, secret: string, rollback: () => Promise<void>) {
  const db = serverClient();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await db
      .from("member_secrets")
      .insert({ member_id: memberId, secret_hash: hashSecret(secret) });
    if (!error || error.code === "23505") return;
    await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
  }
  await rollback();
  throw new GroupError("La mesa está ocupada — intenta de nuevo en un momento", 503);
}

// ── reads ────────────────────────────────────────────────────────────────

export async function getGroup(groupId: string): Promise<{ group: GroupRow; members: MemberRow[] }> {
  const db = serverClient();
  const { data: group, error } = await db.from("groups").select("*").eq("id", groupId).maybeSingle();
  if (error) throw new GroupError(error.message, 502);
  if (!group) throw new GroupError("Esa cuenta no existe", 404);

  const { data: members, error: mErr } = await db
    .from("members")
    .select("*")
    .eq("group_id", groupId)
    .order("seat");
  if (mErr) throw new GroupError(mErr.message, 502);

  return { group: group as GroupRow, members: (members ?? []) as MemberRow[] };
}

/** Prove the caller is the member they claim to be. */
export async function authenticate(groupId: string, memberId: string, secret: string): Promise<MemberRow> {
  if (!memberId || !secret) throw new GroupError("Primero entra a esta cuenta", 401);

  const db = serverClient();
  const { data: row } = await db
    .from("member_secrets")
    .select("secret_hash")
    .eq("member_id", memberId)
    .maybeSingle();

  if (!row || !safeEqual(row.secret_hash as string, hashSecret(secret))) {
    throw new GroupError("Esta sesión no es válida para esta cuenta", 401);
  }

  const { data: member } = await db.from("members").select("*").eq("id", memberId).maybeSingle();
  if (!member || (member as MemberRow).group_id !== groupId) {
    throw new GroupError("No estás en esta cuenta", 403);
  }
  return member as MemberRow;
}

export async function authenticateAdmin(groupId: string, memberId: string, secret: string) {
  const member = await authenticate(groupId, memberId, secret);
  if (!member.is_admin) throw new GroupError("Solo quien administra la cuenta puede hacer eso", 403);
  return member;
}

function assertOpen(group: GroupRow) {
  if (group.status === "settled") throw new GroupError("Esta cuenta ya está saldada", 409);
  if (group.status === "collecting") {
    throw new GroupError("Los cobros ya están activos — no se puede cambiar el reparto", 409);
  }
}

// ── writes ───────────────────────────────────────────────────────────────

/** Give every member an equal share, in join order. */
async function applyEqualSplit(group: GroupRow, members: MemberRow[]) {
  const db = serverClient();
  const shares = equalShares(group.total_cents, members.map((m) => m.id));
  for (const m of members) {
    const { error } = await db.from("members").update({ share_cents: shares.get(m.id) ?? 0 }).eq("id", m.id);
    if (error) throw new GroupError(error.message, 502);
  }
}

export async function createGroup(input: { adminName?: unknown; groupName?: unknown; totalCents?: unknown }) {
  const adminName = cleanName(input.adminName, 40);
  const groupName = cleanName(input.groupName, 60);
  const total = input.totalCents;
  if (!Number.isInteger(total) || (total as number) < 1 || (total as number) > 10_000_000) {
    throw new GroupError("El total debe estar entre $0.01 y $100,000.00 MXN");
  }

  const db = serverClient();
  const groupId = randomId(8);
  const memberId = randomId(12);
  const secret = randomBytes(32).toString("hex");

  const { error: gErr } = await db.from("groups").insert({
    id: groupId,
    name: groupName,
    total_cents: total,
    currency: CURRENCY,
    payer_id: memberId,
    split_mode: "equal",
    status: "open",
  });
  if (gErr) throw new GroupError(gErr.message, 502);

  const { error: mErr } = await db.from("members").insert({
    id: memberId,
    group_id: groupId,
    name: adminName,
    is_admin: true,
    share_cents: total, // alone at the table, for now
    seat: 0,
  });
  if (mErr) throw new GroupError(mErr.message, 502);

  await storeSecret(memberId, secret, async () => {
    await db.from("members").delete().eq("id", memberId);
    await db.from("groups").delete().eq("id", groupId);
  });

  return { groupId, memberId, secret };
}

export async function joinGroup(groupId: string, rawName: unknown) {
  const name = cleanName(rawName, 40);
  const db = serverClient();

  // Two people can scan the same QR at the same moment and race for a seat.
  // The unique (group_id, seat) constraint catches it; try again.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { group, members } = await getGroup(groupId);
    assertOpen(group);

    if (members.length >= MAX_SEATS) {
      throw new GroupError(`Esta cuenta ya está llena — caben ${MAX_SEATS} personas`, 409);
    }

    const taken = new Set(members.map((m) => m.seat));
    let seat = 0;
    while (taken.has(seat)) seat++;

    const memberId = randomId(12);
    const secret = randomBytes(32).toString("hex");

    const { error } = await db.from("members").insert({
      id: memberId,
      group_id: groupId,
      name,
      is_admin: false,
      share_cents: null,
      seat,
    });

    if (error) {
      if (error.code === "23505") continue; // someone took that seat first
      throw new GroupError(error.message, 502);
    }

    await storeSecret(memberId, secret, async () => {
      await db.from("members").delete().eq("id", memberId);
    });

    // In an equal split a new arrival changes everyone's share.
    if (group.split_mode === "equal") {
      const fresh = await getGroup(groupId);
      await applyEqualSplit(fresh.group, fresh.members);
    }

    return { memberId, secret };
  }

  throw new GroupError("Entraron muchas personas a la vez — intenta de nuevo", 503);
}

export async function setSplitMode(groupId: string, memberId: string, secret: string, mode: unknown) {
  await authenticateAdmin(groupId, memberId, secret);
  if (mode !== "equal" && mode !== "custom" && mode !== "own") {
    throw new GroupError("Modo de reparto desconocido");
  }

  const { group, members } = await getGroup(groupId);
  assertOpen(group);

  const db = serverClient();
  const { error } = await db.from("groups").update({ split_mode: mode }).eq("id", groupId);
  if (error) throw new GroupError(error.message, 502);

  if (mode === "equal") {
    await applyEqualSplit({ ...group, split_mode: mode }, members);
  } else if (mode === "own") {
    // Everyone types what they had. Start from a clean slate.
    const { error: e } = await db.from("members").update({ share_cents: null }).eq("group_id", groupId);
    if (e) throw new GroupError(e.message, 502);
  }
  // custom keeps the current numbers as a starting point for the admin.
}

/** The admin sets one person's share (custom mode). */
export async function setShareByAdmin(
  groupId: string,
  memberId: string,
  secret: string,
  targetId: unknown,
  cents: unknown,
) {
  await authenticateAdmin(groupId, memberId, secret);
  const { group, members } = await getGroup(groupId);
  assertOpen(group);
  if (group.split_mode !== "custom") throw new GroupError("Primero cambia a montos por persona");

  const target = members.find((m) => m.id === targetId);
  if (!target) throw new GroupError("Esa persona no está en esta cuenta", 404);
  if (!Number.isInteger(cents) || (cents as number) < 0 || (cents as number) > group.total_cents) {
    throw new GroupError("Una parte debe estar entre $0.00 y el total de la cuenta");
  }

  const { error } = await serverClient().from("members").update({ share_cents: cents }).eq("id", target.id);
  if (error) throw new GroupError(error.message, 502);
}

/** A member enters what they had (own mode). */
export async function setOwnShare(groupId: string, memberId: string, secret: string, cents: unknown) {
  const me = await authenticate(groupId, memberId, secret);
  const { group } = await getGroup(groupId);
  assertOpen(group);
  if (group.split_mode !== "own") throw new GroupError("El admin no ha pedido que cada quien escriba lo suyo");
  if (!Number.isInteger(cents) || (cents as number) < 0 || (cents as number) > group.total_cents) {
    throw new GroupError("Escribe un monto entre $0.00 y el total de la cuenta");
  }

  const { error } = await serverClient().from("members").update({ share_cents: cents }).eq("id", me.id);
  if (error) throw new GroupError(error.message, 502);
}

/**
 * Freeze the split and start collecting.
 *
 * From here the amounts are fixed. The person who paid the bill, and anyone
 * whose share is zero, owe nothing — they count as paid from the start.
 */
export async function startCollecting(groupId: string, memberId: string, secret: string) {
  await authenticateAdmin(groupId, memberId, secret);
  const { group, members } = await getGroup(groupId);
  assertOpen(group);

  if (members.length < 2) throw new GroupError("Invita al menos a una persona antes de activar los cobros");

  const check = checkShares(group.total_cents, members);
  if (!check.complete) throw new GroupError("Todavía falta decidir la parte de alguien");
  if (!check.balanced) {
    const off = (Math.abs(check.gap) / 100).toFixed(2);
    throw new GroupError(
      check.gap > 0 ? `A las partes les faltan $${off} para llegar al total` : `Las partes se pasan del total por $${off}`,
    );
  }

  const owed = transfersToPayer(group.payer_id, members);
  if (!owed.length) throw new GroupError("Nadie debe nada — no hay nada que cobrar");

  const db = serverClient();
  const debtors = new Set(owed.map((t) => t.from));
  const now = new Date().toISOString();
  for (const m of members) {
    const settled = !debtors.has(m.id);
    const { error } = await db
      .from("members")
      .update({ paid: settled, paid_at: settled ? now : null })
      .eq("id", m.id);
    if (error) throw new GroupError(error.message, 502);
  }

  const { error } = await db.from("groups").update({ status: "collecting" }).eq("id", groupId);
  if (error) throw new GroupError(error.message, 502);
}

/** Let the split change again. Only while nobody has actually paid. */
export async function reopenGroup(groupId: string, memberId: string, secret: string) {
  await authenticateAdmin(groupId, memberId, secret);
  const { group } = await getGroup(groupId);
  if (group.status === "settled") throw new GroupError("Esta cuenta ya está saldada", 409);
  if (group.status === "open") return;

  const db = serverClient();
  const { error } = await db.from("groups").update({ status: "open" }).eq("id", groupId);
  if (error) throw new GroupError(error.message, 502);

  const { error: e } = await db.from("members").update({ paid: false, paid_at: null }).eq("group_id", groupId);
  if (e) throw new GroupError(e.message, 502);
}

/**
 * Hand a seat back to someone who lost it.
 *
 * A seat lives in one browser. Switch phones, scan the QR with a different
 * app, clear the browser — and the person is still at the table with a share
 * to pay, but nothing on their phone says it is them. The admin, who can see
 * everyone, issues that seat a fresh secret; the old one stops working. The
 * secret travels in the fragment of a link (never sent to a server) that the
 * admin shows as a QR.
 */
export async function reissueSeat(groupId: string, adminId: string, adminSecret: string, targetId: unknown) {
  await authenticateAdmin(groupId, adminId, adminSecret);
  const { group, members } = await getGroup(groupId);
  if (group.status === "settled") throw new GroupError("Esta cuenta ya está saldada", 409);

  const target = members.find((m) => m.id === targetId);
  if (!target) throw new GroupError("Esa persona no está en esta cuenta", 404);
  if (target.is_admin) throw new GroupError("Ese es tu propio lugar", 400);

  const secret = randomBytes(32).toString("hex");
  const { error } = await serverClient()
    .from("member_secrets")
    .upsert({ member_id: target.id, secret_hash: hashSecret(secret) }, { onConflict: "member_id" });
  if (error) throw new GroupError(error.message, 502);

  return { memberId: target.id, secret, name: target.name };
}

/** Take someone off the table — a duplicate, or a join by mistake. */
export async function removeMember(groupId: string, adminId: string, adminSecret: string, targetId: unknown) {
  await authenticateAdmin(groupId, adminId, adminSecret);
  const { group, members } = await getGroup(groupId);
  assertOpen(group);

  const target = members.find((m) => m.id === targetId);
  if (!target) throw new GroupError("Esa persona no está en esta cuenta", 404);
  if (target.is_admin || target.id === group.payer_id) throw new GroupError("Quien pagó se queda en la mesa", 400);

  const db = serverClient();
  await db.from("member_secrets").delete().eq("member_id", target.id);
  const { error } = await db.from("members").delete().eq("id", target.id);
  if (error) throw new GroupError(error.message, 502);

  // In an equal split, one fewer person changes everyone's share.
  if (group.split_mode === "equal") {
    const fresh = await getGroup(groupId);
    await applyEqualSplit(fresh.group, fresh.members);
  }
}
