import { describe, expect, it } from "vitest";
import { followUpText, isDue, runFollowUps } from "../src/followup";
import type { LeadRow } from "../src/types";
import { fakeDeps } from "./helpers";

const NOW = new Date("2026-10-16T09:00:00.000Z");
const row = (over: Partial<LeadRow> = {}): LeadRow => ({
  rowNumber: 2, received: "2026-10-13T09:00:00.000Z", status: "New", priority: "Hot", name: "Thandi Nkosi", email: "thandi@example.com",
  summary: "", interest: "buy, Claremont", messageId: "m1", threadId: "t1", subject: "Viewing", hubspotId: "c1", followUps: 0, lastFollowUp: "", ...over,
});

describe("isDue", () => {
  it("is due after 48 hours of silence", () => expect(isDue(row(), NOW.getTime())).toBe(true));
  it("is not due before 48 hours", () => expect(isDue(row({ received: "2026-10-15T09:00:00.000Z" }), NOW.getTime())).toBe(false));
  it("never nudges Cold, Ignored, Escalated or Error rows", () => {
    expect(isDue(row({ priority: "Cold" }), NOW.getTime())).toBe(false);
    for (const status of ["Ignored", "Escalated", "Error"]) expect(isDue(row({ status }), NOW.getTime())).toBe(false);
  });
  it("stops after two nudges and spaces them 48 hours apart", () => {
    expect(isDue(row({ followUps: 2 }), NOW.getTime())).toBe(false);
    expect(isDue(row({ followUps: 1, lastFollowUp: "2026-10-15T09:00:00.000Z" }), NOW.getTime())).toBe(false);
    expect(isDue(row({ followUps: 1, lastFollowUp: "2026-10-13T09:00:00.000Z" }), NOW.getTime())).toBe(true);
  });
});

describe("runFollowUps", () => {
  const withRows = (rows: LeadRow[], status: string | null = "NEW") => {
    const base = fakeDeps();
    base.deps.sheet.readLeads = async () => rows;
    base.deps.hubspot.leadStatus = async () => status;
    base.deps.now = () => NOW;
    return base;
  };

  it("drafts a nudge, records it and alerts the owner", async () => {
    const { deps, calls } = withRows([row()]);
    const s = await runFollowUps(deps, { dryRun: false });
    expect(s.drafted).toBe(1);
    expect(calls.drafts).toHaveLength(1);
    expect(calls.followUps).toEqual([[2, 1, NOW.toISOString()]]);
    expect(calls.alerts).toHaveLength(1);
  });

  it("leaves a lead alone once a human changed its HubSpot status", async () => {
    const { deps, calls } = withRows([row()], "IN_PROGRESS");
    const s = await runFollowUps(deps, { dryRun: false });
    expect(s.skippedHandled).toBe(1);
    expect(calls.drafts).toHaveLength(0);
  });

  it("dry run writes nothing", async () => {
    const { deps, calls } = withRows([row()]);
    await runFollowUps(deps, { dryRun: true });
    expect(calls.drafts).toHaveLength(0);
    expect(calls.followUps).toHaveLength(0);
  });

  it("nudge text uses the first name and never quotes a price", () => {
    const t = followUpText(row());
    expect(t).toContain("Hi Thandi");
    expect(t).not.toMatch(/R\d/);
  });
});
