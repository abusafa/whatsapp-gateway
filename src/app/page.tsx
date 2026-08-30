"use client";

import { useCallback, useEffect, useState } from "react";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

type ReceivedMessage = {
  id: string;
  chat: string;
  sender: string;
  pushName: string;
  text: string;
  timestamp: number;
  isGroup: boolean;
  fromMe: boolean;
};

type WaState = {
  status: ConnectionStatus;
  qr: string | null;
  pairingCode: string | null;
  user: { jid: string; name: string } | null;
  error: string | null;
  messages: ReceivedMessage[];
};

const STATUS_META: Record<ConnectionStatus, { label: string; dot: string; badge: string }> = {
  connected: {
    label: "Connected",
    dot: "bg-emerald-500",
    badge:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
  },
  connecting: {
    label: "Connecting…",
    dot: "bg-amber-500 animate-pulse",
    badge:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
  },
  disconnected: {
    label: "Disconnected",
    dot: "bg-zinc-400",
    badge:
      "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  },
};

const CARD =
  "rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const INPUT =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-700 dark:bg-zinc-950/60 dark:focus:ring-emerald-900/40";

export default function Home() {
  const [state, setState] = useState<WaState | null>(null);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [gwKey, setGwKey] = useState("");
  const [needsKey, setNeedsKey] = useState(false);

  function authHeaders(json = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) headers["Content-Type"] = "application/json";
    if (gwKey) headers["x-api-key"] = gwKey;
    return headers;
  }

  async function fetchState() {
    const res = await fetch("/api/state", {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (res.status === 401) setNeedsKey(true);
    return res;
  }

  const refresh = useCallback(async () => {
    try {
      const res = await fetchState();
      if (res.ok) setState(await res.json());
    } catch {
      // Transient network error — the next poll will catch up.
    }
  }, [gwKey]);

  useEffect(() => {
    setGwKey(localStorage.getItem("gateway_key") ?? "");
  }, []);

  // Poll only while unlocked — a locked gateway stays quiet instead of
  // hammering the API with 401s.
  useEffect(() => {
    if (needsKey) return;
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [refresh, needsKey]);

  function saveKey(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem("gateway_key", gwKey);
    setNeedsKey(false);
    refresh();
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ to, message }),
      });
      const data = await res.json();
      if (res.status === 401) {
        setNeedsKey(true);
        throw new Error("Unauthorized — API key required.");
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to send.");
      setFeedback({ kind: "ok", text: `Message sent to ${to}.` });
      setMessage("");
    } catch (err) {
      setFeedback({ kind: "error", text: err instanceof Error ? err.message : "Failed to send." });
    } finally {
      setSending(false);
    }
  }

  async function handlePair(e: React.FormEvent) {
    e.preventDefault();
    setPairing(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (res.status === 401) {
        setNeedsKey(true);
        throw new Error("Unauthorized — API key required.");
      }
      if (!res.ok) throw new Error(data.error ?? "Pairing failed.");
      await refresh();
    } catch (err) {
      setFeedback({ kind: "error", text: err instanceof Error ? err.message : "Pairing failed." });
    } finally {
      setPairing(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/logout", { method: "POST", headers: authHeaders() });
      if (res.status === 401) {
        setNeedsKey(true);
        throw new Error("Unauthorized — API key required.");
      }
      if (!res.ok) throw new Error("Logout failed.");
      setFeedback({ kind: "ok", text: "Session unlinked. Scan the QR to connect again." });
      await refresh();
    } catch (err) {
      setFeedback({ kind: "error", text: err instanceof Error ? err.message : "Logout failed." });
    } finally {
      setLoggingOut(false);
    }
  }

  const status = state?.status ?? "disconnected";
  const meta = STATUS_META[status];
  const needsLinking = status !== "connected";

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            WhatsApp Gateway
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Powered by Baileys · send &amp; receive via HTTP
          </p>
        </div>
        {needsKey ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-600 dark:border-red-900 dark:bg-red-950/60 dark:text-red-400">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            🔒 Locked — API key needed
          </span>
        ) : (
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${meta.badge}`}
          >
            <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
        )}
      </header>

      {needsKey && (
        <section className={`${CARD} mb-4 p-5`}>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            🔒 API key required
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            This gateway is protected with a <code>GATEWAY_API_KEY</code> secret. Enter it once —
            it stays in this browser.
          </p>
          <form onSubmit={saveKey} className="mt-3 flex gap-2">
            <input
              type="password"
              value={gwKey}
              onChange={(e) => setGwKey(e.target.value)}
              placeholder="API key"
              className={INPUT}
              required
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              Unlock
            </button>
          </form>
        </section>
      )}

      {state?.error && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
          {state.error}
        </p>
      )}

      {!state && (
        <div className={`${CARD} p-8 text-center text-sm text-zinc-500 dark:text-zinc-400`}>
          Loading gateway state…
        </div>
      )}

      {state && needsLinking && (
        <section className={`${CARD} p-6`}>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Link a device</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Open WhatsApp on your phone → <strong>Settings</strong> → <strong>Linked devices</strong>{" "}
            → <strong>Link a device</strong>.
          </p>

          {state.qr && (
            <div className="mt-6 flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.qr}
                alt="WhatsApp QR code"
                className="h-72 w-72 rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-700"
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                QR refreshes automatically — no need to reload the page.
              </p>
            </div>
          )}

          {state.pairingCode ? (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center dark:border-emerald-800 dark:bg-emerald-950/60">
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                Enter this code on your phone under <strong>Link with phone number</strong>:
              </p>
              <p className="mt-2 font-mono text-3xl font-bold tracking-[0.3em] text-emerald-700 dark:text-emerald-300">
                {state.pairingCode}
              </p>
            </div>
          ) : (
            !state.qr && (
              <p className="mt-6 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                Waiting for the QR code…
              </p>
            )
          )}

          {!state.pairingCode && (
            <form onSubmit={handlePair} className="mt-6 border-t border-zinc-100 pt-5 dark:border-zinc-800">
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Or link with your phone number
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="254712345678"
                  className={INPUT}
                  required
                />
                <button
                  type="submit"
                  disabled={pairing}
                  className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {pairing ? "Requesting…" : "Get code"}
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                Include the country code, without “+” or leading zeros.
              </p>
            </form>
          )}
        </section>
      )}

      {state && status === "connected" && (
        <>
          <section className={`${CARD} mb-4 flex items-center justify-between p-5`}>
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {state.user?.name || "WhatsApp session"}
              </p>
              <p className="mt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {state.user?.jid}
              </p>
            </div>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </section>

          <section className={`${CARD} mb-4 p-5`}>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Send a message
            </h2>
            <form onSubmit={handleSend} className="mt-3 space-y-3">
              <input
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="To: 254712345678 or 123456-789012@g.us"
                className={INPUT}
                required
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Message text…"
                rows={3}
                className={`${INPUT} resize-none`}
                required
              />
              <button
                type="submit"
                disabled={sending}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </form>

            {feedback && (
              <p
                className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                  feedback.kind === "ok"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400"
                }`}
              >
                {feedback.text}
              </p>
            )}
          </section>

          <section className={`${CARD} p-5`}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Inbox</h2>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                last {state.messages.length} messages
              </span>
            </div>
            {state.messages.length === 0 ? (
              <p className="mt-4 rounded-lg bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-400 dark:bg-zinc-800/60 dark:text-zinc-500">
                No messages yet — text this number from WhatsApp and it will appear here.
              </p>
            ) : (
              <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
                {state.messages.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {m.pushName || m.sender}
                        {m.fromMe && (
                          <span className="ml-1.5 rounded bg-zinc-200 px-1 py-0.5 text-[10px] uppercase text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                            me
                          </span>
                        )}
                        {m.isGroup && (
                          <span className="ml-1.5 rounded bg-sky-100 px-1 py-0.5 text-[10px] uppercase text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                            group
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
                        {new Date(m.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-100">{m.text}</p>
                    <p className="mt-1 truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                      {m.chat}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <footer className="mt-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Unofficial WhatsApp integration — use responsibly, don’t spam.
      </footer>
    </main>
  );
}
