import { logger, schedules, task } from "@trigger.dev/sdk";
import { runLeadPipeline } from "../src/pipeline";
import { alertRunFailure, realDeps } from "../src/runtime";

/** Checks the inbox every 10 minutes (production only). A poll with no new mail makes no model call. */
export const pollLeads = schedules.task({
  id: "poll-leads",
  cron: { pattern: "*/10 * * * *", timezone: "Africa/Johannesburg", environments: ["PRODUCTION"] },
  maxDuration: 300,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 60000, randomize: true },
  onFailure: async ({ error }) => alertRunFailure("poll-leads", error),
  run: async () => runLeadPipeline(await realDeps(logger), { dryRun: false }),
});

/** Manual trigger for testing. Payload: { "dryRun": true } qualifies new mail but writes nothing. */
export const pollLeadsManual = task({
  id: "poll-leads-manual",
  maxDuration: 300,
  run: async (payload: { dryRun?: boolean }) => runLeadPipeline(await realDeps(logger), { dryRun: payload?.dryRun ?? true }),
});
