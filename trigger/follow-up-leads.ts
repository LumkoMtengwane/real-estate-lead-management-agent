import { logger, schedules, task } from "@trigger.dev/sdk";
import { runFollowUps } from "../src/followup";
import { alertRunFailure, realDeps } from "../src/runtime";

/** Drafts nudges for quiet leads every day at 09:00 South African time (production only). */
export const followUpLeads = schedules.task({
  id: "follow-up-leads",
  cron: { pattern: "0 9 * * *", timezone: "Africa/Johannesburg", environments: ["PRODUCTION"] },
  maxDuration: 300,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 60000, randomize: true },
  onFailure: async ({ error }) => alertRunFailure("follow-up-leads", error),
  run: async () => runFollowUps(await realDeps(logger), { dryRun: false }),
});

/** Manual trigger for testing. Payload: { "dryRun": true } writes nothing. */
export const followUpLeadsManual = task({
  id: "follow-up-leads-manual",
  maxDuration: 300,
  run: async (payload: { dryRun?: boolean }) => runFollowUps(await realDeps(logger), { dryRun: payload?.dryRun ?? true }),
});
