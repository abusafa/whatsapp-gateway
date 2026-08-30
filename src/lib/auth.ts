import crypto from "node:crypto";
import { NextResponse } from "next/server";

/**
 * When GATEWAY_API_KEY is set, every /api route requires it via the
 * "x-api-key" header, an "Authorization: Bearer <key>" header, or an
 * "api_key" query parameter. When unset, the gateway is open (local dev).
 */
export function checkAuth(request: Request): boolean {
  const expected = process.env.GATEWAY_API_KEY;
  if (!expected) return true;

  const provided =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("api_key") ??
    "";

  if (!provided) return false;

  // Compare hashes so timing does not leak how much of the key matched.
  const providedHash = crypto.createHash("sha256").update(provided).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
}

export function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Unauthorized — send the API key in the 'x-api-key' header." },
    { status: 401 },
  );
}
