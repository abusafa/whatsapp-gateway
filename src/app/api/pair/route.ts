import { NextResponse } from "next/server";
import { checkAuth, unauthorized } from "@/lib/auth";
import { GatewayError, requestPairingCode } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!checkAuth(request)) return unauthorized();
  let body: { phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const phone = body.phone?.trim();
  if (!phone) {
    return NextResponse.json(
      { error: "'phone' (with country code) is required." },
      { status: 400 },
    );
  }

  try {
    const code = await requestPairingCode(phone);
    return NextResponse.json({ ok: true, code });
  } catch (err) {
    const status = err instanceof GatewayError ? 400 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to request pairing code." },
      { status },
    );
  }
}
