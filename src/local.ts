/**
 * Run from your own machine, without Trigger.dev. Reads keys from .env.
 *   npm run local -- --samples      model only: qualify data/sample-emails.json, print results. Needs ANTHROPIC_API_KEY only.
 *   npm run local                   dry run: read real Gmail and qualify, write nothing
 *   npm run local -- --live         the same, and write to HubSpot, Gmail drafts, the Sheet and alerts
 *   npm run local -- --followups    dry run of the follow-up sweep (add --live to write drafts)
 */
import { readFileSync } from "node:fs";
import { estimateCostUsd, extractLead } from "./claude";
import { runFollowUps } from "./followup";
import { pickSlots } from "./slots";
import { runLeadPipeline } from "./pipeline";
import { realDeps } from "./runtime";
import type { InboundEmail, Logger } from "./types";

const print = (level: string) => (message: string, data?: Record<string, unknown>) =>
  console.log(`${new Date().toISOString().slice(11, 19)} ${level} ${message}${data ? ` ${JSON.stringify(data)}` : ""}`);
const log: Logger = { info: print("INFO"), warn: print("WARN"), error: print("ERROR") };

const arg = (name: string) => process.argv.includes(name);

async function samples() {
  const list = JSON.parse(readFileSync(new URL("../data/sample-emails.json", import.meta.url), "utf8")) as
    { label: string; fromName: string; subject: string; body: string }[];
  const slots = pickSlots([], new Date());
  let tin = 0, tout = 0;
  for (const s of list) {
    const email: InboundEmail = {
      id: s.label, threadId: s.label, fromEmail: "sample@example.com", fromName: s.fromName, subject: s.subject,
      body: s.body, receivedAt: new Date().toISOString(), messageIdHeader: null,
    };
    const { result, usage } = await extractLead(email, slots);
    tin += usage.tokensIn; tout += usage.tokensOut;
    console.log(`\n=== ${s.label} ===`);
    console.log(JSON.stringify(result, null, 2));
  }
  console.log(`\nTokens in ${tin}, out ${tout}, est. cost $${estimateCostUsd(tin, tout).toFixed(5)} for ${list.length} emails`);
}

async function main() {
  if (arg("--samples")) return samples();
  const live = arg("--live");
  console.log(live ? "LIVE run: writes to HubSpot, Gmail drafts, the Sheet." : "DRY run: nothing is written.");
  const deps = await realDeps(log);
  const stats = arg("--followups") ? await runFollowUps(deps, { dryRun: !live }) : await runLeadPipeline(deps, { dryRun: !live });
  console.log("Done.", stats);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
