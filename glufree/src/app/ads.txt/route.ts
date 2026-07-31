import { NextResponse } from "next/server";

/**
 * ads.txt richiesto da AdSense per autorizzare la vendita degli spazi.
 * Generato dinamicamente dall'ID publisher configurato; 404 se assente.
 */
export function GET() {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  if (!client || !client.startsWith("ca-pub-")) {
    return new NextResponse("", { status: 404 });
  }
  const pubId = client.replace(/^ca-/, ""); // ca-pub-… → pub-…
  const body = `google.com, ${pubId}, DIRECT, f08c47fec0942fa0\n`;
  return new NextResponse(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
