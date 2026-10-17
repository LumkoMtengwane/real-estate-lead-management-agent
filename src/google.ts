/** Gmail and Calendar over REST with one OAuth refresh token. Error messages never include tokens. */
import { CONFIG } from "./config";
import { fetchJson } from "./http";
import { pickSlots, searchWindow } from "./slots";
import type { Busy, CalendarApi, GmailApi, InboundEmail } from "./types";

const retry = { retries: 3, backoffMs: 1500 };

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const body = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    client_secret: env("GOOGLE_CLIENT_SECRET"),
    refresh_token: env("GOOGLE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });
  const res = await fetchJson<{ access_token: string; expires_in: number }>(
    "https://oauth2.googleapis.com/token",
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body },
    { ...retry, label: "Google token refresh" },
  );
  cached = { token: res.access_token, expires: Date.now() + res.expires_in * 1000 };
  return cached.token;
}

async function google<T>(url: string, label: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const token = await accessToken();
  return fetchJson<T>(
    url,
    {
      method: init.method ?? (init.json ? "POST" : "GET"),
      headers: { authorization: `Bearer ${token}`, ...(init.json ? { "content-type": "application/json" } : {}) },
      body: init.json ? JSON.stringify(init.json) : undefined,
    },
    { ...retry, label },
  );
}

// ---------- Gmail ----------

interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] }
interface GmailMessage {
  id: string; threadId: string; internalDate: string;
  payload: GmailPart & { headers?: { name: string; value: string }[] };
}

const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

/** Prefer text/plain. Fall back to HTML with the tags removed. */
export function extractBody(part: GmailPart): string {
  const find = (p: GmailPart, type: string): string => {
    if (p.mimeType === type && p.body?.data) return decode(p.body.data);
    for (const child of p.parts ?? []) {
      const hit = find(child, type);
      if (hit) return hit;
    }
    return "";
  };
  const plain = find(part, "text/plain");
  if (plain.trim()) return plain.trim();
  return find(part, "text/html").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** "Thandi Nkosi <thandi@example.com>" to name and address. */
export function parseFrom(from: string): { name: string | null; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: from.trim().toLowerCase() };
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** RFC 2047 encoding so non-ASCII subjects survive. */
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

/** Strip anything that could inject extra headers. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export function buildRaw(input: { to: string; subject: string; body: string; inReplyTo: string | null }): string {
  const headers = [
    `To: ${oneLine(input.to)}`,
    `Subject: ${encodeHeader(oneLine(input.subject))}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${oneLine(input.inReplyTo)}`, `References: ${oneLine(input.inReplyTo)}`);
  return b64url(`${headers.join("\r\n")}\r\n\r\n${input.body}`);
}

export function gmailClient(): GmailApi {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  return {
    async listNew() {
      const q = encodeURIComponent(CONFIG.gmailQuery);
      const list = await google<{ messages?: { id: string }[] }>(`${base}/messages?q=${q}&maxResults=25`, "Gmail list");
      const out: InboundEmail[] = [];
      for (const { id } of list.messages ?? []) {
        const m = await google<GmailMessage>(`${base}/messages/${id}?format=full`, "Gmail get");
        const h = (name: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? "";
        const from = parseFrom(h("from"));
        out.push({
          id: m.id, threadId: m.threadId, fromEmail: from.email, fromName: from.name,
          subject: h("subject") || "(no subject)", body: extractBody(m.payload),
          receivedAt: new Date(Number(m.internalDate)).toISOString(), messageIdHeader: h("message-id") || null,
        });
      }
      return out;
    },
    async createDraft({ to, subject, body, threadId, inReplyTo }) {
      const raw = buildRaw({ to, subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, body, inReplyTo });
      const res = await google<{ id: string }>(`${base}/drafts`, "Gmail draft", { json: { message: { raw, threadId } } });
      return res.id;
    },
    async sendOwnerAlert(subject, body) {
      const to = env("OWNER_EMAIL"); // the only address this client ever sends to
      await google(`${base}/messages/send`, "Gmail alert", { json: { raw: buildRaw({ to, subject, body, inReplyTo: null }) } });
    },
  };
}

// ---------- Calendar ----------

export function calendarClient(now: () => Date = () => new Date()): CalendarApi {
  return {
    async proposeSlots() {
      const w = searchWindow(now());
      const res = await google<{ calendars: Record<string, { busy?: Busy[] }> }>(
        "https://www.googleapis.com/calendar/v3/freeBusy", "Calendar free/busy",
        { json: { ...w, timeZone: "Africa/Johannesburg", items: [{ id: "primary" }] } },
      );
      return pickSlots(res.calendars.primary?.busy ?? [], now());
    },
  };
}
