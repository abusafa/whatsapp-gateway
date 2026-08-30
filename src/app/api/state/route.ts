import { NextResponse } from "next/server";
import { checkAuth, unauthorized } from "@/lib/auth";
import { ensureStarted, getState } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!checkAuth(request)) return unauthorized();
  await ensureStarted();
  const json = JSON.stringify(getState(), null, 2);

  // Browsers get a theme-aware viewer; API clients keep getting raw JSON.
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return new Response(renderJsonPage(json), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new NextResponse(json, {
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Escapes, then lightly syntax-highlights the JSON for the browser view. */
function highlight(json: string): string {
  return escapeHtml(json).replace(
    /(&quot;(?:[^&]|&(?!quot;))*&quot;)(\s*:)|(&quot;(?:[^&]|&(?!quot;))*&quot;)|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b/g,
    (match, key, colon, str, num, bool) => {
      if (key) return `<span class="j-key">${key}</span>${colon}`;
      if (str) return `<span class="j-str">${str}</span>`;
      if (num) return `<span class="j-num">${num}</span>`;
      return `<span class="j-bool">${bool}</span>`;
    },
  );
}

function renderJsonPage(json: string): string {
  const body = highlight(json);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Gateway state — JSON</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 24px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px; line-height: 1.6;
    background: #fafafa; color: #27272a;
  }
  pre { margin: 0 auto; max-width: 720px; white-space: pre-wrap; word-break: break-word; }
  .j-key { color: #0369a1; }
  .j-str { color: #047857; }
  .j-num, .j-bool { color: #b45309; }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: #e4e4e7; }
    .j-key { color: #7dd3fc; }
    .j-str { color: #6ee7b7; }
    .j-num, .j-bool { color: #fcd34d; }
  }
</style>
</head>
<body><pre>${body}</pre></body>
</html>`;
}
