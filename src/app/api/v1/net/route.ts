import { NextResponse } from "next/server";
import { expandExpenses, net, type Obligation } from "@/lib/netting";
import { validateExpenses } from "@/lib/validateExpenses";

export const runtime = "nodejs";

/**
 * POST /api/v1/net — the netting engine, free.
 *
 * Accepts either raw obligations or expenses to expand first:
 *   { "obligations": [{ "from": "a", "to": "b", "cents": 1000 }] }
 *   { "expenses":    [{ "id", "label", "payer", "cents", "among": [...] }] }
 *
 * Answers with the minimum set of transfers that settles everyone.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const payload = body as { obligations?: Obligation[]; expenses?: unknown };

  let obligations: Obligation[];
  try {
    if (payload.expenses !== undefined) {
      const checked = validateExpenses(payload.expenses);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      obligations = expandExpenses(checked.expenses);
    } else if (Array.isArray(payload.obligations)) {
      obligations = payload.obligations;
    } else {
      return NextResponse.json({ error: "Provide either `obligations` or `expenses`" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  try {
    const result = net(obligations);
    return NextResponse.json({
      balances: result.balances,
      grossEdges: result.grossEdges,
      transfers: result.transfers,
      optimal: result.optimal,
      compression: result.compression,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
