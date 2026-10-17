/** Everything you might want to tune lives here. */

export const CONFIG = {
  model: "claude-haiku-5-5",
  /** Fictional agency used in the demo. Replace for a real client. */
  agencyName: "Harbour View Realty",
  agentName: "the Harbour View team",
  /** Only unread-ish recent inbox mail from other people is considered. */
  gmailQuery: "in:inbox newer_than:2d -from:me",
  /** Safety cap per poll, so a flood of mail cannot run up cost. */
  maxEmailsPerRun: 10,
  /** Longest email body sent to the model, in characters. */
  maxBodyChars: 4000,
  /** Viewing slots offered in a draft. Times are South African time (UTC+2, no daylight saving). */
  slots: {
    count: 3,
    utcOffsetHours: 2,
    starts: ["09:00", "11:00", "14:00", "15:30"],
    durationMinutes: 45,
    searchDays: 7,
  },
  /** Leads at these priorities email the owner. Escalations always do. Cold leads get a draft and a CRM record only. */
  alertPriorities: ["Hot", "Warm"] as readonly string[],
  followUp: {
    /** Hours of silence before the first nudge and between nudges. */
    afterHours: 48,
    maxPerLead: 2,
    priorities: ["Hot", "Warm"],
  },
} as const;

export const PRIORITIES = ["Hot", "Warm", "Cold"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const INTENTS = ["buy", "rent", "sell", "viewing", "question", "other"] as const;
export type Intent = (typeof INTENTS)[number];
