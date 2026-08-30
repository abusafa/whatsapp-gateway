# WhatsApp Gateway

A WhatsApp gateway built with [Next.js](https://nextjs.org) and [Baileys](https://github.com/whiskeysockets/Baileys) — link your WhatsApp account, then send and receive messages over plain HTTP.

## What it does

- **Link a device** two ways: scan a QR code, or request a phone-number pairing code — both from the built-in dashboard.
- **Send messages** via `POST /api/send` to any phone number or group JID.
- **Receive messages** — incoming texts are captured live and shown in the dashboard inbox (and readable via `GET /api/state`).
- **Session persistence** — credentials are stored in `.wa-session/`, so the gateway stays linked across restarts until you log out.
- **Auto-reconnect** — dropped connections retry automatically; a revoked session wipes itself and shows a fresh QR.

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
```

1. Open the dashboard and link your phone (QR scan, or enter your number to get a pairing code).
2. Send/receive from the dashboard, or call the HTTP API:

```bash
# Send a text message (phone number with country code, or a group JID)
curl -X POST http://localhost:3000/api/send \
  -H "Content-Type: application/json" \
  -d '{"to": "254712345678", "message": "Hello from the gateway!"}'

# Groups work too — use the group JID
curl -X POST http://localhost:3000/api/send \
  -H "Content-Type: application/json" \
  -d '{"to": "123456789-987654321@g.us", "message": "Hello group!"}'

# Current status + last 25 received messages
curl http://localhost:3000/api/state
```

## HTTP API

All routes require the `GATEWAY_API_KEY` secret (if set) via the `x-api-key` header, an `Authorization: Bearer <key>` header, or an `api_key` query parameter.

| Method | Route          | Body                        | Returns                                              |
| ------ | -------------- | --------------------------- | ---------------------------------------------------- |
| GET    | `/api/state`   | —                           | Connection status, QR, pairing code, user, inbox     |
| POST   | `/api/send`    | see below                   | `{ ok, to, id }`                                     |
| POST   | `/api/pair`    | `{ phone }` (country code)  | `{ ok, code }` — enter the code in WhatsApp          |
| POST   | `/api/logout`  | —                           | Unlinks the session and clears stored credentials    |

### Sending

**Text** (WhatsApp formatting works: `*bold*`, `_italic_`, `~strike~`, triple-backtick monospace):

```bash
curl -X POST http://localhost:3000/api/send \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"to": "254712345678", "message": "*Hello* from the gateway!"}'
```

**Media via URL** — `type` is `image` (default), `video`, `audio`, `document`, or `sticker`:

```bash
curl -X POST http://localhost:3000/api/send \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"to": "254712345678", "type": "image", "url": "https://example.com/photo.jpg", "caption": "Hello"}'

curl -X POST http://localhost:3000/api/send \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"to": "254712345678", "type": "document", "url": "https://example.com/report.pdf", "fileName": "Report.pdf"}'
```

**Media via base64:**

```bash
-d '{"to": "254712345678", "type": "audio", "base64": "<...>", "mimetype": "audio/ogg", "ptt": true}'
```

**Media via file upload** (`type` is guessed from the file's mimetype):

```bash
curl -X POST http://localhost:3000/api/send \
  -H "x-api-key: $KEY" \
  -F to=254712345678 -F caption=Invoice -F file=@invoice.pdf
```

Extra JSON options: `fileName` (documents), `mimetype`, `ptt` (send audio as a voice note).

## How it works

Baileys needs a **long-lived WebSocket**, which means a long-running Node process — this works with `next dev` / `next start` / Docker / a VPS, but **not** on serverless platforms like Vercel.

- `src/lib/whatsapp.ts` — the connection manager. A single Baileys socket lives on `globalThis` (so Next.js dev-mode module reloads don't kill it), handles QR/pairing events, reconnects on close, buffers the last 100 inbound messages, and exposes `sendText` / `requestPairingCode` / `logout`.
- `src/app/api/*/route.ts` — thin HTTP wrappers around the manager.
- `src/app/page.tsx` — the dashboard; polls `/api/state` every 2.5 s and renders the QR, pairing code, send form, and inbox.

`markOnlineOnConnect: false` keeps the gateway "offline" so your phone continues to receive notifications normally.

## Caveats

- Baileys is an **unofficial** library that reverse-engineers WhatsApp Web. It can break when WhatsApp changes its protocol, and automated accounts can get banned — use it for personal/authorized integrations, not spam.
- `.wa-session/` holds your linked-device credentials. It's git-ignored; treat it like a password.
- The inbox is in-memory only (last 100 messages) — it resets on restart. Persist to a database if you need durability.
