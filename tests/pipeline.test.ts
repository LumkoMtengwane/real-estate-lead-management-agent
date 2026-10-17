import { describe, expect, it } from "vitest";
import { runLeadPipeline } from "../src/pipeline";
import { email, extraction, fakeDeps } from "./helpers";

describe("runLeadPipeline", () => {
  it("does nothing and makes no model call when there is no new mail", async () => {
    const { deps } = fakeDeps({}, []);
    const stats = await runLeadPipeline(deps, { dryRun: false });
    expect(stats.emailsSeen).toBe(0);
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it("skips mail already in the Sheet (safe to re-run)", async () => {
    const { deps } = fakeDeps({ sheet: { ...fakeDeps().deps.sheet, recentMessageIds: async () => new Set(["m1"]) } });
    await runLeadPipeline(deps, { dryRun: false });
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it("hot lead: HubSpot contact, note, viewing task, draft, owner alert and Sheet row", async () => {
    const { deps, calls } = fakeDeps();
    const stats = await runLeadPipeline(deps, { dryRun: false });
    expect(stats.leads).toBe(1);
    expect(calls.upserts).toHaveLength(1);
    expect(calls.notes).toHaveLength(1);
    expect(calls.tasks).toEqual(["Confirm viewing time"]);
    expect(calls.drafts).toHaveLength(1);
    expect(calls.alerts).toHaveLength(1);
    expect(calls.leadRows[0]).toContain("New");
    expect(calls.runRows).toHaveLength(1);
  });

  it("escalation creates a call-back task and an alert, and the Sheet status is Escalated", async () => {
    const x = extraction({ escalate: true, escalateReason: "Deposit complaint", viewingRequested: false, priority: "Warm" });
    const { deps, calls } = fakeDeps({}, [email()], x);
    await runLeadPipeline(deps, { dryRun: false });
    expect(calls.tasks[0]).toContain("Call back today");
    expect(calls.alerts[0]).toContain("NEEDS A HUMAN");
    expect(calls.leadRows[0]).toContain("Escalated");
  });

  it("cold lead with no viewing gets a draft but no task and no alert", async () => {
    const x = extraction({ priority: "Cold", viewingRequested: false });
    const { deps, calls } = fakeDeps({}, [email()], x);
    await runLeadPipeline(deps, { dryRun: false });
    expect(calls.drafts).toHaveLength(1);
    expect(calls.tasks).toHaveLength(0);
    expect(calls.alerts).toHaveLength(0);
  });

  it("warm lead alerts the owner too, with no task when no viewing was asked for", async () => {
    const x = extraction({ priority: "Warm", viewingRequested: false });
    const { deps, calls } = fakeDeps({}, [email()], x);
    await runLeadPipeline(deps, { dryRun: false });
    expect(calls.alerts).toHaveLength(1);
    expect(calls.alerts[0]).toContain("Warm lead");
    expect(calls.tasks).toHaveLength(0);
  });

  it("spam is logged as Ignored and never reaches HubSpot, drafts or alerts", async () => {
    const x = extraction({ isLead: false, draftReply: null, summary: "Advert." });
    const { deps, calls } = fakeDeps({}, [email()], x);
    const stats = await runLeadPipeline(deps, { dryRun: false });
    expect(stats.ignored).toBe(1);
    expect(calls.upserts).toHaveLength(0);
    expect(calls.drafts).toHaveLength(0);
    expect(calls.leadRows[0]).toContain("Ignored");
  });

  it("dry run writes nothing", async () => {
    const { deps, calls } = fakeDeps();
    await runLeadPipeline(deps, { dryRun: true });
    expect(calls.upserts).toHaveLength(0);
    expect(calls.drafts).toHaveLength(0);
    expect(calls.alerts).toHaveLength(0);
    expect(calls.leadRows).toHaveLength(0);
    expect(calls.runRows).toHaveLength(0);
  });

  it("one failing email is recorded and alerted, and the next email still runs", async () => {
    let n = 0;
    const { deps, calls } = fakeDeps({
      extract: async () => { if (n++ === 0) throw new Error("model down"); return { result: extraction(), usage: { tokensIn: 10, tokensOut: 5 } }; },
    }, [email({ id: "a" }), email({ id: "b" })]);
    const stats = await runLeadPipeline(deps, { dryRun: false });
    expect(stats.errors).toHaveLength(1);
    expect(stats.leads).toBe(1);
    expect(calls.leadRows[0]).toContain("Error");
    expect(calls.alerts.some((s) => s.includes("could not process"))).toBe(true);
  });

  it("still drafts replies when the calendar is down", async () => {
    const { deps, calls } = fakeDeps({ calendar: { proposeSlots: async () => { throw new Error("calendar 500"); } } });
    await runLeadPipeline(deps, { dryRun: false });
    expect(calls.drafts).toHaveLength(1);
  });

  it("caps the number of emails handled per run", async () => {
    const many = Array.from({ length: 25 }, (_, i) => email({ id: `m${i}` }));
    const { deps } = fakeDeps({}, many);
    const stats = await runLeadPipeline(deps, { dryRun: true });
    expect(stats.emailsSeen).toBe(10);
  });
});
