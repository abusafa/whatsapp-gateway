import { NextResponse } from "next/server";
import { checkAuth, unauthorized } from "@/lib/auth";
import { logout } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!checkAuth(request)) return unauthorized();
  try {
    await logout();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Logout failed." },
      { status: 500 },
    );
  }
}
