import { NextRequest, NextResponse } from "next/server";
import { approveSubmission, listSubmissions } from "@/lib/store";

/**
 * Endpoint admin minimale, protetto da chiave condivisa (GLUFREE_ADMIN_KEY).
 * GET  /api/admin/approve            → elenco richieste in attesa
 * POST /api/admin/approve {id}       → approva e pubblica il locale in mappa
 */
function authorized(req: NextRequest): boolean {
  const key = process.env.GLUFREE_ADMIN_KEY;
  if (!key) return false;
  return req.headers.get("x-admin-key") === key;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const submissions = await listSubmissions();
  return NextResponse.json({ submissions });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const { id } = (await req.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: "id mancante" }, { status: 400 });

  const place = await approveSubmission(id);
  if (!place) {
    return NextResponse.json({ error: "Richiesta non trovata o già approvata" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, place });
}
