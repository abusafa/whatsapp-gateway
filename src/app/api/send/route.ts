import { NextResponse } from "next/server";
import { checkAuth, unauthorized } from "@/lib/auth";
import { GatewayError, MediaType, sendMedia, sendText } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

const MEDIA_TYPES = new Set<MediaType>(["image", "video", "audio", "document", "sticker"]);

function guessType(mimetype: string): MediaType {
  if (mimetype.startsWith("image/")) return mimetype === "image/webp" ? "sticker" : "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "document";
}

function str(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function POST(request: Request) {
  if (!checkAuth(request)) return unauthorized();
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const to = str(form.get("to"));
      if (!to) throw new GatewayError("'to' is required.");

      const file = form.get("file");
      if (!(file instanceof File)) throw new GatewayError("Attach the media in the 'file' field.");

      const typeField = str(form.get("type")) as MediaType | undefined;
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await sendMedia({
        to,
        type: typeField && MEDIA_TYPES.has(typeField) ? typeField : guessType(file.type),
        buffer,
        fileName: str(form.get("fileName")) ?? file.name,
        mimetype: str(form.get("mimetype")) ?? file.type,
        caption: str(form.get("caption")),
        ptt: str(form.get("ptt")) === "true",
      });
      return NextResponse.json({ ok: true, ...result });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const to = typeof body.to === "string" ? body.to.trim() : "";
    if (!to) {
      return NextResponse.json(
        { error: "'to' (phone number with country code, or JID) is required." },
        { status: 400 },
      );
    }

    // Plain text message: { to, message }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const isMedia =
      typeof body.type === "string" ||
      typeof body.url === "string" ||
      typeof body.base64 === "string";

    if (message && !isMedia) {
      const result = await sendText(to, message);
      return NextResponse.json({ ok: true, ...result });
    }

    if (!message && !isMedia) {
      return NextResponse.json(
        { error: "Provide 'message' (text) or media ('type' + 'url'/'base64')." },
        { status: 400 },
      );
    }

    const type = (
      typeof body.type === "string" && MEDIA_TYPES.has(body.type as MediaType)
        ? body.type
        : "image"
    ) as MediaType;
    const url = typeof body.url === "string" ? body.url.trim() : undefined;
    const base64 = typeof body.base64 === "string" ? body.base64 : undefined;
    if (!url && !base64) {
      throw new GatewayError("Provide the media via 'url' or 'base64'.");
    }

    const result = await sendMedia({
      to,
      type,
      url,
      base64,
      caption: typeof body.caption === "string" ? body.caption : undefined,
      fileName: typeof body.fileName === "string" ? body.fileName : undefined,
      mimetype: typeof body.mimetype === "string" ? body.mimetype : undefined,
      ptt: body.ptt === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const status = err instanceof GatewayError ? 400 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send message." },
      { status },
    );
  }
}
