import { vi } from "vitest";
import type { Deps, Extraction, InboundEmail, LeadRow } from "../src/types";

export const email = (over: Partial<InboundEmail> = {}): InboundEmail => ({
  id: "m1", threadId: "t1", fromEmail: "thandi@example.com", fromName: "Thandi Nkosi", subject: "Viewing",
  body: "Can I view HV-102?", receivedAt: "2026-10-16T08:00:00.000Z", messageIdHeader: "<abc@mail>", ...over,
});

export const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  isLead: true, intent: "buy", name: "Thandi Nkosi", phone: null, budget: "R5m", area: "Claremont", bedrooms: "3", timeline: "November",
  viewingRequested: true, preferredTimes: "Thursday", priority: "Hot", escalate: false, escalateReason: null,
  summary: "Pre-approved buyer wants a viewing.", draftReply: "Hi Thandi, ...", ...over,
});

/** Fake services that record every call. */
export function fakeDeps(over: Partial<Deps> = {}, emails: InboundEmail[] = [email()], x: Extraction = extraction()) {
  const calls = {
    drafts: [] as unknown[], alerts: [] as string[], notes: [] as string[], tasks: [] as string[], upserts: [] as unknown[],
    leadRows: [] as (string | number)[][], runRows: [] as (string | number)[][], followUps: [] as unknown[],
  };
  const deps: Deps = {
    gmail: {
      listNew: async () => emails,
      createDraft: async (d) => { calls.drafts.push(d); return "d1"; },
      sendOwnerAlert: async (s) => { calls.alerts.push(s); },
    },
    hubspot: {
      upsertContact: async (i) => { calls.upserts.push(i); return { id: "c1", url: "https://hs/c1" }; },
      addNote: async (_id, b) => { calls.notes.push(b); },
      addTask: async (_id, s) => { calls.tasks.push(s); },
      leadStatus: async () => "NEW",
    },
    calendar: { proposeSlots: async () => [{ startIso: "2026-10-20T07:00:00.000Z", label: "Tuesday 20 October at 09:00" }] },
    sheet: {
      recentMessageIds: async () => new Set<string>(),
      appendLead: async (r) => { calls.leadRows.push(r); },
      appendRun: async (r) => { calls.runRows.push(r); },
      readLeads: async () => [] as LeadRow[],
      recordFollowUp: async (n, c, w) => { calls.followUps.push([n, c, w]); },
    },
    extract: vi.fn(async () => ({ result: x, usage: { tokensIn: 1000, tokensOut: 300 } })),
    now: () => new Date("2026-10-16T09:00:00.000Z"),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    ...over,
  };
  return { deps, calls };
}
