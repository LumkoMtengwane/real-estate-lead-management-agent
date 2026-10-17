import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRaw, extractBody, gmailClient, parseFrom } from "../src/google";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unraw = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

describe("parseFrom", () => {
  it("splits name and address", () => expect(parseFrom('"Thandi Nkosi" <Thandi@Example.com>')).toEqual({ name: "Thandi Nkosi", email: "thandi@example.com" }));
  it("handles a bare address", () => expect(parseFrom("a@b.co")).toEqual({ name: null, email: "a@b.co" }));
});

describe("extractBody", () => {
  it("prefers text/plain", () => {
    const part = { mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: b64("<p>html</p>") } }, { mimeType: "text/plain", body: { data: b64("plain") } }] };
    expect(extractBody(part)).toBe("plain");
  });
  it("falls back to HTML with tags removed", () => {
    expect(extractBody({ mimeType: "text/html", body: { data: b64("<style>x{}</style><p>Hello <b>there</b></p>") } })).toBe("Hello there");
  });
});

describe("buildRaw", () => {
  it("cannot be used to inject extra headers", () => {
    const raw = unraw(buildRaw({ to: "a@b.co\r\nBcc: evil@x.co", subject: "Hi\r\nBcc: evil@x.co", body: "body", inReplyTo: null }));
    const head = raw.split("\r\n\r\n")[0];
    expect(head.split("\r\n").some((l) => l.startsWith("Bcc:"))).toBe(false);
  });
  it("encodes non-ASCII subjects", () => {
    expect(unraw(buildRaw({ to: "a@b.co", subject: "Grüße", body: "x", inReplyTo: null }))).toContain("=?UTF-8?B?");
  });
});

describe("sendOwnerAlert", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("only ever sends to OWNER_EMAIL", async () => {
    vi.stubEnv("OWNER_EMAIL", "owner@example.com");
    vi.stubEnv("GOOGLE_CLIENT_ID", "x");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "x");
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", "x");
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      sent.push(String(url));
      const raw = JSON.parse(String(init?.body)).raw as string;
      expect(unraw(raw)).toContain("To: owner@example.com");
      return new Response("{}");
    }));
    await gmailClient().sendOwnerAlert("Hot lead", "body");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("/messages/send");
  });
});
