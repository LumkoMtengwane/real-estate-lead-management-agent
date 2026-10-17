/** Wires the real services into Deps. Used by the Trigger.dev tasks and the local runner. */
import { extractLead } from "./claude";
import { calendarClient, gmailClient } from "./google";
import { hubspotClient } from "./hubspot";
import { connect, ensureSetup, sheetClient } from "./sheets";
import type { Deps, Logger } from "./types";

/**
 * Free stand-in for a dashboard alert: email the owner when a whole run fails after its retries.
 * Never throws (if Gmail is the broken part, there is nothing more to do). The error text carries no secrets.
 */
export async function alertRunFailure(taskId: string, error: unknown): Promise<void> {
  try {
    const message = error instanceof Error ? error.message : String(error);
    await gmailClient().sendOwnerAlert(
      `[Lead agent] Task ${taskId} failed`,
      `The task "${taskId}" failed after its retries.\n\nError: ${message.slice(0, 300)}\n\nManual fallback: check Gmail for new enquiries and the Trigger.dev dashboard for the failed run.`,
    );
  } catch {
    /* nothing more we can do */
  }
}

export async function realDeps(log: Logger): Promise<Deps> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set");
  const api = connect();
  await ensureSetup(api, spreadsheetId);
  return {
    gmail: gmailClient(),
    hubspot: hubspotClient(),
    calendar: calendarClient(),
    sheet: sheetClient(api, spreadsheetId),
    extract: extractLead,
    now: () => new Date(),
    log,
  };
}
