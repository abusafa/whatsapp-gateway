# WhatsApp Gateway

A self-hosted WhatsApp gateway built with [Next.js](https://nextjs.org) and [Baileys](https://github.com/whiskeysockets/Baileys). Link your WhatsApp account once, then send and receive messages over plain HTTP — text, photos, videos, voice notes, documents, and stickers — from any application, script, or automation platform (n8n, Make, Zoho, custom backends…).

**Live deployment (this repo):** https://whatsapp-gateway.sa-apps.com — deployed on [Coolify](https://coolify.io) at server `135.181.243.9`.

➡️ **Using the deployed version?** Jump to [Deployed production instance](#deployed-production-instance).

---

## Table of contents

1. [Features](#features)
2. [How it works](#how-it-works)
3. [Quick start (local)](#quick-start-local)
4. [Linking your phone](#linking-your-phone)
5. [Authentication](#authentication)
6. [API reference](#api-reference)
   - [GET /api/state](#get-apistate)
   - [POST /api/send — text](#post-apisend--text)
   - [POST /api/send — media](#post-apisend--media)
   - [POST /api/pair](#post-apipair)
   - [POST /api/logout](#post-apilogout)
7. [The dashboard](#the-dashboard)
8. [Receiving messages](#receiving-messages)
9. [Deployment](#deployment)
   - [Docker](#docker)
   - [Coolify](#coolify)
   - [Plain VPS (pm2)](#plain-vps-pm2)
10. [Configuration](#configuration)
11. [Troubleshooting](#troubleshooting)
12. [Security notes](#security-notes)
13. [Limitations & known caveats](#limitations--known-caveats)
14. [Project structure](#project-structure)

---

## Features

- **Link via QR** or **phone-number pairing code** — both from the built-in dashboard
- **Send text** with WhatsApp formatting (`*bold*`, `_italic_`, `~strike~`, ```` ```monospace``` ````)
- **Send media**: images, videos, audio/voice notes, documents (any file type), stickers
- **Three delivery methods for media**: public URL, base64, or direct file upload
- **Send to individuals or groups** (any WhatsApp JID)
- **Receive messages** — visible in the dashboard inbox and via the API
- **Session persistence** — stays linked across restarts (credentials in `.wa-session/`)
- **Auto-reconnect** — dropped connections retry automatically; revoked sessions wipe themselves and show a fresh QR
- **API-key protection** — every route gated by a shared secret when `GATEWAY_API_KEY` is set
- **Production-ready Docker image** with a persistent session volume

## How it works

```
Your app ──HTTP──▶ Next.js API routes ──▶ Baileys socket ──WebSocket──▶ WhatsApp servers
                                                                        │
Your inbox ◀── /api/state poll ◀── message event listener ◀──────────────┘
```

Baileys holds a **long-lived WebSocket** to WhatsApp's servers and speaks the same protocol as WhatsApp Web. This means the gateway must run on a **long-running Node process with a persistent filesystem** — a VPS, Docker, Coolify, Railway, Fly.io, Render — **not** on serverless (Vercel functions, AWS Lambda).

The connection manager lives in `src/lib/whatsapp.ts` as a singleton stored on `globalThis`, so Next.js dev-mode hot reloads don't tear the socket down.

## Quick start (local)

```bash
git clone https://github.com/abusafa/whatsapp-gateway.git
cd whatsapp-gateway
npm install
npm run dev          # http://localhost:3000
```

Then [link your phone](#linking-your-phone). For a protected local run:

```bash
GATEWAY_API_KEY=my-secret npm run dev
```

## Linking your phone

Open the dashboard and choose either method:

**QR (recommended):**
1. WhatsApp on your phone → **Settings** → **Linked devices** → **Link a device**
2. Scan the QR shown on the dashboard
3. Status flips to **Connected**; credentials are saved to `.wa-session/`

**Pairing code:**
1. Enter your phone number (with country code, no `+`, no leading zeros) under "Or link with your phone number"
2. Click **Get code** — an 8-character code appears (e.g. `ABCD-1234`)
3. WhatsApp → **Linked devices** → **Link to the phone number itself** → enter the code

The gateway announces itself as "offline" (`markOnlineOnConnect: false`), so your phone keeps receiving notifications normally. One WhatsApp account can be linked to up to 4 companion devices; the gateway occupies one slot.

## Authentication

When the `GATEWAY_API_KEY` environment variable is **set**, every `/api/*` route requires it. Three ways to pass it:

```bash
-H "x-api-key: MY_SECRET"                # recommended
-H "Authorization: Bearer MY_SECRET"
"...?api_key=MY_SECRET"                  # handy for quick browser testing
```

Wrong or missing key → `401 {"error":"Unauthorized — send the API key in the 'x-api-key' header."}`

When the variable is **unset** (default in dev), the gateway is open — fine for `localhost`, never for a public URL.

The dashboard knows about this too: on a 401 it shows a 🔒 **Locked** card where you paste the key once; it's stored in `localStorage` and attached automatically afterwards.

## API reference

Base URL (local): `http://localhost:3000` · (production): `https://whatsapp-gateway.sa-apps.com`

Errors always come back as `{"error": "…"}` with a `400` (bad request / not connected) or `401` (bad key).

### GET /api/state

Current gateway state plus the last 25 received messages.

```bash
curl -H "x-api-key: $KEY" http://localhost:3000/api/state
```

```json
{
  "status": "connected",              // "disconnected" | "connecting" | "connected"
  "qr": null,                         // PNG data-URL while waiting for a scan
  "pairingCode": null,                // "ABCD-1234" while a pairing code is pending
  "user": { "jid": "254712345678@s.whatsapp.net", "name": "Your Name" },
  "error": null,                      // e.g. "Connection lost (code 428) — reconnecting…"
  "messages": [
    {
      "id": "3EB0B430B6F8...",
      "chat": "254712345679@s.whatsapp.net",  // or "123-456@g.us" for groups
      "sender": "254712345679@s.whatsapp.net",
      "pushName": "Alice",
      "text": "hello!",
      "timestamp": 1725000000000,
      "isGroup": false,
      "fromMe": false
    }
  ]
}
```

Opening this URL in a **browser** returns a dark/light themed JSON viewer instead of raw JSON (detected via the `Accept: text/html` header) — API clients are unaffected.

### POST /api/send — text

```bash
curl -X POST http://localhost:3000/api/send \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"to": "254712345678", "message": "*Hello* from the gateway!"}'
```

| Field     | Type   | Required | Notes                                                                 |
| --------- | ------ | -------- | --------------------------------------------------------------------- |
| `to`      | string | ✅       | Phone number with country code (`254712345678`) or a full JID (`123456-789012@g.us` for groups) |
| `message` | string | ✅       | Text content; WhatsApp formatting applies (`*bold*`, `_italic_`, `~strike~`, ```` ```code``` ````) |

Success → `{"ok": true, "to": "254712345678@s.whatsapp.net", "id": "3EB0..."}`

### POST /api/send — media

`type` is one of `image` (default), `video`, `audio`, `document`, `sticker`. Provide the content by **URL**, **base64**, or **multipart upload**.

**From a URL** (must be publicly reachable — the server fetches it):

```bash
curl -X POST http://localhost:3000/api/send \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"to": "254712345678", "type": "image", "url": "https://example.com/photo.jpg", "caption": "Hello!"}'
```

**From base64** (for private files your system already has in memory):

```bash
curl -X POST http://localhost:3000/api/send \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"to": "254712345678", "type": "document", "base64": "JVBERi0xLjcK...", "fileName": "Invoice.pdf", "mimetype": "application/pdf"}'
```

**By direct upload** — `type` is guessed from the file's mimetype (a `.webp` becomes a sticker):

```bash
curl -X POST http://localhost:3000/api/send \
  -H "x-api-key: $KEY" \
  -F to=254712345678 -F caption="Monthly report" -F file=@report.pdf
```

| Field      | Applies to            | Notes                                                        |
| ---------- | --------------------- | ------------------------------------------------------------ |
| `type`     | all                   | `image` \| `video` \| `audio` \| `document` \| `sticker`      |
| `url` / `base64` / `file` | all    | Exactly one source is required                               |
| `caption`  | image, video, document | Text under the media; WhatsApp formatting works here too     |
| `fileName` | document              | Display name, e.g. `Invoice.pdf` (default `file`)            |
| `mimetype` | all                   | Usually auto-detected; set explicitly for audio              |
| `ptt`      | audio                 | `true` sends as a push-to-talk voice note (use `audio/ogg; codecs=opus`) |

### POST /api/pair

Request a phone-number pairing code (alternative to QR). Only works while not connected.

```bash
curl -X POST http://localhost:3000/api/pair \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"phone": "254712345678"}'
```

→ `{"ok": true, "code": "ABCD-1234"}`

### POST /api/logout

Unlinks the session from the phone, wipes `.wa-session/`, and reboots the socket so a fresh QR appears.

```bash
curl -X POST http://localhost:3000/api/logout -H "x-api-key: $KEY"
```

## The dashboard

The single page at `/` is a control panel:

- **Status badge** — Connected / Connecting… / Disconnected / 🔒 Locked
- **Link card** — live QR (auto-refreshes on each rotation, ~20s, no reload needed) + pairing-code form
- **Send form** — quick text sends to any number/JID
- **Inbox** — last 25 received messages with sender, text, time, and `me` / `group` tags (refreshes every 2.5 s)
- **Logout** — unlink button

It's a convenience layer only — everything it does is available over HTTP.

## Receiving messages

Incoming text messages (including image/video/document **captions**) are captured by the Baileys `messages.upsert` event and buffered in memory (last 100). Read them via:

- **Dashboard inbox**, refreshed every 2.5 s
- **`GET /api/state`** → `messages` array (last 25)

Properties per message: `id`, `chat` (JID to reply to), `sender`, `pushName` (profile name), `text`, `timestamp` (ms), `isGroup`, `fromMe`.

Current limitations: **in-memory only** (resets on restart), **poll-based** (no push/webhook yet), **text-only** (binary media isn't downloaded — captions are). A webhook + database persistence is the natural next step.

## Deployed production instance

A live instance of this gateway runs on Coolify. All details below.

| Setting            | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| **Base URL**       | `https://whatsapp-gateway.sa-apps.com`                       |
| **Server**         | `135.181.243.9` (Hetzner, Coolify name `metal-135.181.243.9`) |
| **Coolify project**| `whatsapp-gateway` (UUID `dfpyrnrk6nc9q0roxerwquyb`)          |
| **Coolify app**    | UUID `sq2fa3m1w3ynyaszvb5gikxp`, environment `production`     |
| **Source**         | this GitHub repo, `main` branch, Dockerfile build pack        |
| **API key**        | `GATEWAY_API_KEY` env var — set in Coolify (⚠️ never commit it; the repo is public) |

### Using it

1. Open https://whatsapp-gateway.sa-apps.com and enter the API key (find it in Coolify → project `whatsapp-gateway` → app → **Environment**) in the 🔒 unlock card. It's stored in your browser afterwards.
2. Scan the QR with your phone to link the session. The instance keeps its own session — it is **not** shared with any local dev instance.
3. Call the API:

```bash
BASE=https://whatsapp-gateway.sa-apps.com
KEY=<your GATEWAY_API_KEY from Coolify>

# status + received messages
curl -H "x-api-key: $KEY" $BASE/api/state

# text
curl -X POST $BASE/api/send -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"to":"254712345678","message":"*Hello* from production"}'

# photo by URL
curl -X POST $BASE/api/send -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"to":"254712345678","type":"image","url":"https://example.com/photo.jpg","caption":"Hi"}'

# file upload
curl -X POST $BASE/api/send -H "x-api-key: $KEY" \
  -F to=254712345678 -F file=@report.pdf
```

The domain works because `*.sa-apps.com` wildcard DNS points at `135.181.243.9`, where Coolify's proxy (Traefik/Caddy) terminates TLS with an auto-issued certificate and routes to the container.

### Managing it

All management happens in the Coolify dashboard (or via the Coolify API at `https://app.coolify.io/api/v1`):

| Task | How |
| --- | --- |
| **Update to latest code** | Push to `main`, then Coolify → app → **Redeploy** (or `POST /api/v1/applications/sq2fa3m1w3ynyaszvb5gikxp/start`) |
| **Restart** | App → **Restart** (keeps the session) |
| **Change the API key** | App → **Environment** → edit `GATEWAY_API_KEY` → **Restart** |
| **Unlink the session** | `POST /api/logout` on the gateway, or delete `WhatsApp Web` under WhatsApp → Linked devices on the phone |
| **View logs** | App → **Logs** (connection errors show here; the app itself logs quietly) |
| **Rotate/re-issue the TLS cert** | Automatic via the proxy |

### Recommended: persistent session volume

The session currently lives inside the container filesystem. **A redeploy/rebuild wipes it**, and you'd have to scan the QR again. Fix once in Coolify:

> App → **Storage** → **Add volume**: mount path `/app/.wa-session` → Save → Redeploy → re-scan the QR one last time.

After that, the linked session survives every restart and redeploy.

### Status checklist

- ✅ HTTPS via auto-issued certificate
- ✅ API-key protection on all routes (`401` without the key)
- ✅ Auto-restart (container `restart` policy + in-app reconnect loop)
- ✅ Deployed automatically from `main` via Dockerfile
- ⚠️ Session volume — add it (see above) so redeploys keep the WhatsApp session
- ⚠️ Inbox is in-memory — messages received before a restart are not preserved

## Deployment

Requires: a long-running Node process and persistent storage for `.wa-session/`. **Not compatible with serverless** (Vercel, Lambda).

### Docker

```bash
docker build -t whatsapp-gateway .
docker run -d --name wa-gateway \
  -p 3000:3000 \
  -e GATEWAY_API_KEY=change-me \
  -v wa-session:/app/.wa-session \
  --restart unless-stopped \
  whatsapp-gateway
```

The image is a multi-stage build (Node 22 alpine, Next.js `output: "standalone"`, non-root user). The `wa-session` volume keeps the linked session across container recreation.

### Coolify

This repo is deployed on Coolify (project `whatsapp-gateway`, app UUID `sq2fa3m1w3ynyaszvb5gikxp`, server `135.181.243.9`):

- **Build pack:** Dockerfile (from the public GitHub repo, `main` branch)
- **Domain:** `https://whatsapp-gateway.sa-apps.com`
- **Environment variable:** `GATEWAY_API_KEY` (set via **Environment** in the app settings)
- **Recommended:** add a persistent volume under **Storage** → mount at `/app/.wa-session` so redeploys don't unlink the session. Until then, a container rebuild requires re-scanning the QR.

Redeploys happen automatically on push to `main` (if webhook is configured) or via **Deploy** in the Coolify UI / `POST /api/v1/applications/{uuid}/start` on the Coolify API.

### Plain VPS (pm2)

```bash
git clone https://github.com/abusafa/whatsapp-gateway.git && cd whatsapp-gateway
npm ci && npm run build
GATEWAY_API_KEY=change-me pm2 start npm --name wa-gateway -- start
pm2 save && pm2 startup     # survive reboots
```

Put nginx/Caddy in front for TLS, and don't expose it without the API key.

## Configuration

| Variable           | Default | Purpose                                                          |
| ------------------ | ------- | ---------------------------------------------------------------- |
| `GATEWAY_API_KEY`  | *(unset — open)* | Shared secret required on all API routes                  |
| `PORT`             | `3000`  | HTTP port (Docker image sets it; standalone server honors it)     |

Session credentials always live in `.wa-session/` relative to the app root (`/app/.wa-session` in Docker). It is git-ignored and Docker-ignored — treat it like a password.

## Troubleshooting

| Symptom | Cause & fix |
| --- | --- |
| `401 Unauthorized` on every call | API key missing/wrong. Production key is set in Coolify → app → Environment. Dashboard: enter it in the 🔒 card. |
| `"WhatsApp is not connected"` from /api/send | Session isn't linked (or died). Open dashboard → scan QR. |
| Status stuck on **Connecting…** | Server can't reach WhatsApp (firewall) or transient handshake failure — it retries every 3 s automatically. |
| QR disappears / changes constantly | QRs rotate every ~20 s; the dashboard refreshes automatically — just scan the current one. |
| `"Connection lost (code 515)"` | Normal after pairing-code linking; the gateway restarts itself and connects. |
| Logged out unexpectedly (code 401 event) | Session revoked from the phone (Linked devices) or by WhatsApp. The gateway wipes itself — scan again. |
| Media by URL fails to deliver | The URL wasn't reachable from the server. Test it from the server, or switch to upload/base64. |
| Voice note shows as music file | Set `"mimetype": "audio/ogg; codecs=opus"` and `"ptt": true`. |
| Session lost after redeploy | No persistent volume mounted on `/app/.wa-session` — add it in Coolify Storage. |
| Received messages vanished after restart | The inbox is in-memory by design. |

## Security notes

- **Always** set `GATEWAY_API_KEY` on anything reachable beyond localhost — without it, anyone can send messages as you, read your inbox, or unlink the session.
- `.wa-session/` contains full login credentials for the linked session. Never commit, share, or copy it around.
- The gateway is an **unofficial** integration (reverse-engineered WhatsApp Web protocol). Automated/mass messaging can get the linked number **banned** by WhatsApp — use it for personal or authorized business notifications, not spam.
- Baileys occasionally breaks when WhatsApp changes its protocol; pin the `baileys` version and update deliberately.

## Limitations & known caveats

- Text + media sending only — no buttons/lists/reactions/polls over the API yet (Baileys supports most of these).
- Received media (photos/voice) are not downloaded; only their captions are captured.
- Inbox is memory-only (last 100; API returns last 25).
- Single session per deployment (one phone number per gateway instance).
- Polling-based receiving; no webhook yet.

## Project structure

```
src/
├── lib/
│   ├── whatsapp.ts        # Baileys connection manager: QR, pairing, reconnect,
│   │                      #   sendText/sendMedia, inbox buffer, logout  (singleton on globalThis)
│   └── auth.ts            # GATEWAY_API_KEY check (x-api-key / Bearer / ?api_key=)
├── app/
│   ├── page.tsx           # Dashboard (client component, polls /api/state)
│   ├── layout.tsx
│   └── api/
│       ├── state/route.ts # GET  — status + QR + inbox (+ themed JSON viewer for browsers)
│       ├── send/route.ts  # POST — text & media (JSON and multipart)
│       ├── pair/route.ts  # POST — phone-number pairing code
│       └── logout/route.ts# POST — unlink session
Dockerfile                # multi-stage, node:22-alpine, standalone output, non-root
```

**Stack:** Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS 4 · Baileys 7 · pino · qrcode
