import { NextRequest, NextResponse } from "next/server";
import { saveSubmission } from "@/lib/store";
import type { OwnerSubmission } from "@/lib/types";

/**
 * POST /api/register — riceve la candidatura di un ristoratore.
 * La richiesta entra in stato "pending" finché il team non valida la
 * documentazione (certificazione AIC, menu dedicato, attestato corso).
 */
export async function POST(req: NextRequest) {
  let body: Partial<OwnerSubmission>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  const business = body.business;
  const owner = body.owner;
  const proof = body.proof;

  const errors: string[] = [];
  if (!business?.name?.trim()) errors.push("Il nome del locale è obbligatorio.");
  if (!business?.address?.trim()) errors.push("L'indirizzo è obbligatorio.");
  if (!business?.city?.trim()) errors.push("La città è obbligatoria.");
  if (!owner?.fullName?.trim()) errors.push("Il nome del titolare è obbligatorio.");
  if (!owner?.email?.includes("@")) errors.push("Inserisci un'email valida.");
  if (!/^[0-9]{11}$/.test(owner?.vatNumber ?? ""))
    errors.push("La Partita IVA deve avere 11 cifre.");
  if (!proof?.type) errors.push("Seleziona il tipo di documentazione gluten free.");

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 422 });
  }

  const submission: OwnerSubmission = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    status: "pending",
    business: business as OwnerSubmission["business"],
    owner: owner as OwnerSubmission["owner"],
    proof: proof as OwnerSubmission["proof"],
    referral: typeof body.referral === "string" ? body.referral.slice(0, 64) : undefined,
  };

  await saveSubmission(submission);

  return NextResponse.json({
    ok: true,
    id: submission.id,
    message:
      "Richiesta ricevuta! Il nostro team verificherà la documentazione entro 3 giorni lavorativi.",
  });
}
