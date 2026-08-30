import fs from "node:fs";
import path from "node:path";
import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
} from "baileys";
import type { WAMessage, WASocket } from "baileys";
import pino from "pino";
import QRCode from "qrcode";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type ReceivedMessage = {
  id: string;
  chat: string;
  sender: string;
  pushName: string;
  text: string;
  timestamp: number;
  isGroup: boolean;
  fromMe: boolean;
};

export type WaState = {
  status: ConnectionStatus;
  /** QR code as a data URL, present while a device can be linked by scanning. */
  qr: string | null;
  pairingCode: string | null;
  user: { jid: string; name: string } | null;
  error: string | null;
  messages: ReceivedMessage[];
};

export class GatewayError extends Error {}

type WaRuntime = {
  sock: WASocket | null;
  status: ConnectionStatus;
  qr: string | null;
  pairingCode: string | null;
  user: WaState["user"];
  error: string | null;
  messages: ReceivedMessage[];
  starting: Promise<void> | null;
  reconnectTimer: NodeJS.Timeout | null;
};

const AUTH_DIR = path.join(process.cwd(), ".wa-session");
const MESSAGE_LIMIT = 100;
const RECONNECT_DELAY_MS = 3_000;

const logger = pino({ level: "error" });

// One process-wide runtime, kept on globalThis so Next.js dev-mode module
// reloads don't tear down the live WhatsApp socket.
const globalRef = globalThis as unknown as { __waRuntime?: WaRuntime };

function runtime(): WaRuntime {
  if (!globalRef.__waRuntime) {
    globalRef.__waRuntime = {
      sock: null,
      status: "disconnected",
      qr: null,
      pairingCode: null,
      user: null,
      error: null,
      messages: [],
      starting: null,
      reconnectTimer: null,
    };
  }
  return globalRef.__waRuntime;
}

/** Lazily boots the socket on the first API request. */
export function ensureStarted(): Promise<void> {
  const rt = runtime();
  if (rt.status === "connected" || rt.starting || rt.reconnectTimer) {
    return Promise.resolve();
  }
  return startWhatsApp();
}

export function startWhatsApp(): Promise<void> {
  const rt = runtime();
  if (rt.starting) return rt.starting;
  rt.starting = doStart()
    .catch((err: unknown) => {
      rt.status = "disconnected";
      rt.error = err instanceof Error ? err.message : "Failed to start WhatsApp socket";
    })
    .finally(() => {
      rt.starting = null;
    });
  return rt.starting;
}

async function doStart(): Promise<void> {
  const rt = runtime();
  rt.status = "connecting";
  rt.error = null;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    // A desktop browser identity supports both QR scanning and pairing codes.
    browser: Browsers.ubuntu("Chrome"),
    logger,
    // Stay "offline" so notifications keep flowing to the linked phone.
    markOnlineOnConnect: false,
    syncFullHistory: false,
    getMessage: async () => undefined,
  });

  rt.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    // Ignore events from a socket that is no longer the active one (post-logout).
    if (rt.sock !== sock) return;
    void onConnectionUpdate(rt, sock, update);
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (rt.sock !== sock || type !== "notify") return;
    for (const msg of messages) ingestMessage(rt, msg);
  });
}

async function onConnectionUpdate(
  rt: WaRuntime,
  sock: WASocket,
  update: { connection?: string; lastDisconnect?: { error?: unknown }; qr?: string },
): Promise<void> {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    try {
      rt.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      rt.pairingCode = null;
    } catch {
      rt.error = "Failed to render QR code";
    }
  }

  if (connection === "open") {
    rt.status = "connected";
    rt.qr = null;
    rt.pairingCode = null;
    rt.error = null;
    rt.user = sock.user
      ? {
          jid: jidOf(sock.user.id),
          name: sock.user.name ?? sock.user.verifiedName ?? "",
        }
      : null;
  }

  if (connection === "close") {
    const code = (
      lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
    )?.output?.statusCode;

    if (code === DisconnectReason.loggedOut) {
      // Session revoked on the phone: wipe credentials and surface a fresh QR.
      clearSession();
      rt.sock = null;
      rt.status = "disconnected";
      rt.qr = null;
      rt.pairingCode = null;
      rt.user = null;
      rt.messages = [];
      rt.error = null;
      scheduleReconnect(0);
    } else {
      rt.status = "connecting";
      rt.error =
        code === undefined
          ? "Connection lost — reconnecting…"
          : `Connection lost (code ${code}) — reconnecting…`;
      scheduleReconnect(RECONNECT_DELAY_MS);
    }
  }
}

function ingestMessage(rt: WaRuntime, msg: WAMessage): void {
  const chat = msg.key.remoteJid;
  if (!chat || chat === "status@broadcast" || chat === "status@jid") return;
  const text = extractText(msg);
  if (!text) return;

  rt.messages.unshift({
    id: msg.key.id ?? crypto.randomUUID(),
    chat: jidOf(chat),
    sender: jidOf(msg.key.participant ?? chat),
    pushName: msg.pushName ?? "",
    text,
    timestamp: Number(msg.messageTimestamp) * 1000,
    isGroup: chat.endsWith("@g.us"),
    fromMe: msg.key.fromMe === true,
  });

  if (rt.messages.length > MESSAGE_LIMIT) rt.messages.length = MESSAGE_LIMIT;
}

function extractText(msg: WAMessage): string {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    ""
  ).trim();
}

export async function sendText(to: string, text: string): Promise<{ to: string; id?: string }> {
  const rt = runtime();
  const sock = rt.sock;
  if (rt.status !== "connected" || !sock) {
    throw new GatewayError("WhatsApp is not connected. Link a device first.");
  }
  const jid = toJid(to);
  const result = await sock.sendMessage(jid, { text });
  return { to: jid, id: result?.key.id ?? undefined };
}

export type MediaType = "image" | "video" | "audio" | "document" | "sticker";

export type MediaSendOptions = {
  to: string;
  type: MediaType;
  /** Public URL Baileys should fetch the media from. */
  url?: string;
  /** Base64-encoded media content. */
  base64?: string;
  /** Raw upload (multipart) or already-decoded bytes. */
  buffer?: Buffer;
  fileName?: string;
  mimetype?: string;
  caption?: string;
  /** Send audio as a push-to-talk voice note. */
  ptt?: boolean;
};

export async function sendMedia(opts: MediaSendOptions): Promise<{ to: string; id?: string }> {
  const rt = runtime();
  const sock = rt.sock;
  if (rt.status !== "connected" || !sock) {
    throw new GatewayError("WhatsApp is not connected. Link a device first.");
  }
  const jid = toJid(opts.to);

  if (!opts.url && !opts.base64 && !opts.buffer) {
    throw new GatewayError("Provide the media via 'url', 'base64', or a 'file' upload.");
  }

  // WhatsApp Web rejects empty files.
  if (opts.buffer && opts.buffer.length === 0) {
    throw new GatewayError("The uploaded file is empty.");
  }

  // Baileys accepts either a URL object or a raw Buffer for media content.
  const source: { url: string } | Buffer = opts.buffer
    ? opts.buffer
    : ({ url: opts.url! } as const);

  const caption = opts.caption?.trim() || undefined;

  let message: Record<string, unknown>;
  switch (opts.type) {
    case "sticker":
      message = { sticker: source };
      break;
    case "audio":
      message = {
        audio: source,
        ptt: opts.ptt === true,
        mimetype: opts.mimetype || "audio/mpeg",
      };
      break;
    case "document":
      message = {
        document: source,
        fileName: opts.fileName || "file",
        mimetype: opts.mimetype || "application/octet-stream",
        caption,
      };
      break;
    case "video":
      message = { video: source, caption, mimetype: opts.mimetype || undefined };
      break;
    case "image":
    default:
      message = { image: source, caption, mimetype: opts.mimetype || undefined };
  }

  const result = await sock.sendMessage(
    jid,
    message as unknown as Parameters<WASocket["sendMessage"]>[1],
  );
  return { to: jid, id: result?.key.id ?? undefined };
}

/** Accepts "254712345678" or any full JID such as "123-456@g.us". */
export function toJid(to: string): string {
  const value = to.trim();
  if (value.includes("@")) return value;
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    throw new GatewayError(
      "Invalid destination — use a phone number with country code, or a full JID.",
    );
  }
  return `${digits}@s.whatsapp.net`;
}

export async function requestPairingCode(phoneNumber: string): Promise<string> {
  const rt = runtime();
  if (rt.status === "connected") {
    throw new GatewayError("Already connected — log out first to link a different device.");
  }
  if (rt.pairingCode) return rt.pairingCode;

  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.length < 8) {
    throw new GatewayError("Provide the full phone number, including country code.");
  }

  await startWhatsApp();
  const sock = rt.sock;
  if (!sock) throw new GatewayError("WhatsApp socket is not running.");

  const raw = await withTimeout(
    sock.requestPairingCode(digits),
    45_000,
    "Timed out requesting a pairing code — try again.",
  );
  rt.pairingCode = formatPairingCode(raw);
  return rt.pairingCode;
}

export async function logout(): Promise<void> {
  const rt = runtime();
  const sock = rt.sock;
  rt.sock = null;
  rt.status = "disconnected";
  rt.qr = null;
  rt.pairingCode = null;
  rt.user = null;
  rt.messages = [];
  rt.error = null;
  clearSession();
  try {
    await sock?.logout();
  } catch {
    // Socket may already be closed; unlinking on the server side is enough.
  }
  await startWhatsApp();
}

export function getState(): WaState {
  const rt = runtime();
  return {
    status: rt.status,
    qr: rt.qr,
    pairingCode: rt.pairingCode,
    user: rt.user,
    error: rt.error,
    messages: rt.messages.slice(0, 25),
  };
}

function scheduleReconnect(delayMs: number): void {
  const rt = runtime();
  if (rt.reconnectTimer) clearTimeout(rt.reconnectTimer);
  rt.reconnectTimer = setTimeout(() => {
    rt.reconnectTimer = null;
    void startWhatsApp();
  }, delayMs);
  rt.reconnectTimer.unref?.();
}

function clearSession(): void {
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
}

/** Strips the ":device" suffix WhatsApp appends to own-device JIDs. */
function jidOf(jid?: string | null): string {
  if (!jid) return "";
  const at = jid.indexOf("@");
  if (at === -1) return jid;
  return `${jid.slice(0, at).split(":")[0]}${jid.slice(at)}`;
}

function formatPairingCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GatewayError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
