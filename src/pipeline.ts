/**
 * The lead job. No Trigger.dev imports, so it runs locally and in tests. All services are injected.
 * New mail: qualify, log to HubSpot, save a reply DRAFT, alert the owner on hot or escalated leads.
 * Nothing is ever sent to a customer.
 */
import { estimateCostUsd } from "./claude";
import { CONFIG } from "./config";
import { leadRow } from "./sheets";
import type { Deps, Extraction, InboundEmail, Slot } from "./types";

export interface RunStats {
  emailsSeen: number; leads: number; ignored: number; errors: string[];
  tokensIn: number; tokensOut: number; estCostUsd: number; seconds: number;
}

const interestOf = (x: Extraction) => [x.intent, x.area, x.bedrooms ? `${x.bedrooms} bed` : null].filter(Boolean).join(", ");

export function alertText(email: InboundEmail, x: Extraction, contactUrl: string): { subject: string; body: string } {
  const why = x.escalate ? `NEEDS A HUMAN: ${x.escalateReason ?? "escalated"}` : `${x.priority} lead`;
  return {
    subject: `[${CONFIG.agencyName}] ${why}: ${x.name ?? email.fromEmail}`,
    body: [
      x.summary, "", `From: ${email.fromName ?? ""} <${email.fromEmail}>`, `Subject: ${email.subject}`,
      x.viewingRequested ? `Viewing requested: ${x.preferredTimes ?? "no times given"}` : "",
      `CRM: ${contactUrl}`, "A reply draft is waiting in Gmail Drafts. Review it, then send.",
    ].filter((l) => l !== "").join("\n"),
  };
}

export async function runLeadPipeline(deps: Deps, opts: { dryRun: boolean }): Promise<RunStats> {
  const { gmail, hubspot, calendar, sheet, log } = deps;
  const started = deps.now().getTime();
  const stats: RunStats = { emailsSeen: 0, leads: 0, ignored: 0, errors: [], tokensIn: 0, tokensOut: 0, estCostUsd: 0, seconds: 0 };

  const known = await sheet.recentMessageIds();
  const fresh = (await gmail.listNew()).filter((e) => !known.has(e.id)).slice(0, CONFIG.maxEmailsPerRun);
  stats.emailsSeen = fresh.length;
  if (!fresh.length) {
    log.info("No new mail");
    return stats; // no model call, no calendar call
  }

  let slots: Slot[] = [];
  try {
    slots = await calendar.proposeSlots();
  } catch (err) {
    log.warn("Calendar unavailable, drafts will not offer times", { error: err instanceof Error ? err.message : String(err) });
  }

  for (const email of fresh) {
    const base = { Received: email.receivedAt, Email: email.fromEmail, "Gmail message ID": email.id, "Thread ID": email.threadId, Subject: email.subject };
    try {
      const { result: x, usage } = await deps.extract(email, slots);
      stats.tokensIn += usage.tokensIn;
      stats.tokensOut += usage.tokensOut;

      if (!x.isLead) {
        stats.ignored++;
        log.info("Ignored (not a lead)", { id: email.id });
        if (!opts.dryRun) await sheet.appendLead(leadRow({ ...base, Status: "Ignored", Name: email.fromName ?? "", Summary: x.summary }));
        continue;
      }
      stats.leads++;
      log.info("Lead", { id: email.id, priority: x.priority, escalate: x.escalate, viewing: x.viewingRequested });
      if (opts.dryRun) {
        log.info("Dry run: would write HubSpot, draft and alert", { summary: x.summary, draft: x.draftReply });
        continue;
      }

      const contact = await hubspot.upsertContact({
        email: email.fromEmail, name: x.name ?? email.fromName, phone: x.phone, priority: x.priority, interest: interestOf(x), budget: x.budget,
      });
      await hubspot.addNote(contact.id, [
        `AI summary: ${x.summary}`, `Intent: ${x.intent}. Priority: ${x.priority}.`,
        x.budget ? `Budget: ${x.budget}` : "", x.timeline ? `Timeline: ${x.timeline}` : "",
        x.viewingRequested ? `Viewing requested: ${x.preferredTimes ?? "no times given"}` : "", `Original subject: ${email.subject}`,
      ].filter(Boolean).join("\n"));
      if (x.escalate || x.viewingRequested) {
        await hubspot.addTask(
          contact.id,
          x.escalate ? `Call back today: ${x.escalateReason ?? "needs a human"}` : "Confirm viewing time",
          x.summary, x.escalate ? "Hot" : x.priority,
        );
      }
      if (x.draftReply) {
        await gmail.createDraft({ to: email.fromEmail, subject: email.subject, body: x.draftReply, threadId: email.threadId, inReplyTo: email.messageIdHeader });
      }
      if (x.escalate || CONFIG.alertPriorities.includes(x.priority)) {
        const a = alertText(email, x, contact.url);
        await gmail.sendOwnerAlert(a.subject, a.body);
      }
      await sheet.appendLead(leadRow({
        ...base, Status: x.escalate ? "Escalated" : "New", Priority: x.priority, Name: x.name ?? email.fromName ?? "", Intent: x.intent,
        Interest: interestOf(x), Viewing: x.viewingRequested ? "Yes" : "", Escalated: x.escalate ? "Yes" : "", Summary: x.summary,
        HubSpot: contact.url, "HubSpot ID": contact.id,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("Lead failed", { id: email.id, error: msg });
      stats.errors.push(`${email.id}: ${msg}`);
      if (opts.dryRun) continue;
      // Record it so the same mail is not retried (and billed) every poll. A human handles it.
      try {
        await sheet.appendLead(leadRow({ ...base, Status: "Error", Summary: msg.slice(0, 200) }));
        await gmail.sendOwnerAlert(`[${CONFIG.agencyName}] Lead agent could not process an email`, `From: ${email.fromEmail}\nSubject: ${email.subject}\nError: ${msg}\nPlease handle this one manually.`);
      } catch (inner) {
        log.error("Could not record failure", { error: inner instanceof Error ? inner.message : String(inner) });
      }
    }
  }

  stats.estCostUsd = estimateCostUsd(stats.tokensIn, stats.tokensOut);
  stats.seconds = Math.round((deps.now().getTime() - started) / 1000);
  if (!opts.dryRun) {
    await sheet.appendRun([deps.now().toISOString(), stats.emailsSeen, stats.leads, stats.ignored, stats.errors.length, stats.tokensIn,
      stats.tokensOut, Number(stats.estCostUsd.toFixed(5)), stats.seconds, stats.errors.join(" | ").slice(0, 300)]);
  }
  return stats;
}
