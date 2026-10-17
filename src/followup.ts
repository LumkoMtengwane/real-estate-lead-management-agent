/**
 * Daily follow-up sweep. A plain rule, no model call: open Hot or Warm leads that nobody has worked get a
 * nudge DRAFT (never sent) after 48 hours, at most twice. A lead stops being nudged as soon as a human
 * changes its Lead Status in HubSpot away from NEW.
 */
import { CONFIG } from "./config";
import type { Deps, LeadRow } from "./types";

const HOUR = 3_600_000;

export function isDue(row: LeadRow, nowMs: number): boolean {
  if (!["New"].includes(row.status)) return false;
  if (!(CONFIG.followUp.priorities as readonly string[]).includes(row.priority)) return false;
  if (row.followUps >= CONFIG.followUp.maxPerLead) return false;
  const last = Date.parse(row.lastFollowUp) || Date.parse(row.received);
  return Number.isFinite(last) && nowMs - last >= CONFIG.followUp.afterHours * HOUR;
}

export const followUpText = (row: LeadRow) => {
  const first = row.name.trim().split(/\s+/)[0] || "there";
  const topic = row.interest ? ` about ${row.interest}` : "";
  return `Hi ${first},\n\nJust following up on your enquiry${topic}. Are you still interested? If so, reply with a time that suits you and we will arrange it.\n\nKind regards,\n${CONFIG.agentName}`;
};

export interface FollowUpStats { checked: number; drafted: number; skippedHandled: number; errors: string[] }

export async function runFollowUps(deps: Pick<Deps, "gmail" | "hubspot" | "sheet" | "now" | "log">, opts: { dryRun: boolean }): Promise<FollowUpStats> {
  const { gmail, hubspot, sheet, log } = deps;
  const stats: FollowUpStats = { checked: 0, drafted: 0, skippedHandled: 0, errors: [] };
  const nowMs = deps.now().getTime();
  const due = (await sheet.readLeads()).filter((r) => isDue(r, nowMs));
  stats.checked = due.length;

  for (const row of due) {
    try {
      const status = row.hubspotId ? await hubspot.leadStatus(row.hubspotId) : null;
      if (status && status !== "NEW") {
        stats.skippedHandled++; // a human has picked this lead up
        continue;
      }
      if (opts.dryRun) { log.info("Dry run: would draft follow-up", { row: row.rowNumber }); continue; }
      await gmail.createDraft({ to: row.email, subject: row.subject, body: followUpText(row), threadId: row.threadId, inReplyTo: null });
      await sheet.recordFollowUp(row.rowNumber, row.followUps + 1, deps.now().toISOString());
      stats.drafted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("Follow-up failed", { row: row.rowNumber, error: msg });
      stats.errors.push(`row ${row.rowNumber}: ${msg}`);
    }
  }
  if (stats.drafted && !opts.dryRun) {
    await gmail.sendOwnerAlert(`[${CONFIG.agencyName}] ${stats.drafted} follow-up draft(s) waiting`, `${stats.drafted} lead(s) have had no reply for ${CONFIG.followUp.afterHours} hours. Drafts are in Gmail Drafts. Review and send.`);
  }
  return stats;
}
