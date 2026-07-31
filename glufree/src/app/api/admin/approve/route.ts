import { NextRequest, NextResponse } from "next/server";
import { approveSubmission, listSubmissions, setFeatured } from "@/lib/store";

/**
 * Endpoint admin minimale, protetto da chiave condivisa (GLUFREE_ADMIN_KEY).
 * GET   /api/admin/approve                     → elenco richieste
 * POST  /api/admin/approve {id, featured?}     → approva e pubblica il locale
 * PATCH /api/admin/approve {placeId, featured} → attiva/disattiva "In evidenza"
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
  const { id, featured } = (await req.json()) as { id?: string; featured?: boolean };
  if (!id) return NextResponse.json({ error: "id mancante" }, { status: 400 });

  const place = await approveSubmission(id, Boolean(featured));
  if (!place) {
    return NextResponse.json({ error: "Richiesta non trovata o già approvata" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, place });
}

export async function PATCH(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const { placeId, featured } = (await req.json()) as { placeId?: string; featured?: boolean };
  if (!placeId) return NextResponse.json({ error: "placeId mancante" }, { status: 400 });

  const place = await setFeatured(placeId, Boolean(featured));
  if (!place) {
    return NextResponse.json(
      { error: "Locale non trovato o non verificato" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, place });
}
