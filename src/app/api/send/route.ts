import { NextResponse } from "next/server";
import { checkAuth, unauthorized } from "@/lib/auth";
import { GatewayError, sendText } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!checkAuth(request)) return unauthorized();
  let body: { to?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const to = body.to?.trim();
  const message = body.message?.trim();
  if (!to || !message) {
    return NextResponse.json(
      { error: "Both 'to' (phone number with country code, or JID) and 'message' are required." },
      { status: 400 },
    );
  }

  try {
    const result = await sendText(to, message);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const status = err instanceof GatewayError ? 400 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send message." },
      { status },
    );
  }
}
