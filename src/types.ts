import type { Intent, Priority } from "./config";

export interface InboundEmail {
  id: string;
  threadId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  body: string;
  receivedAt: string; // ISO
  messageIdHeader: string | null;
}

export interface Extraction {
  isLead: boolean;
  intent: Intent;
  name: string | null;
  phone: string | null;
  budget: string | null;
  area: string | null;
  bedrooms: string | null;
  timeline: string | null;
  viewingRequested: boolean;
  preferredTimes: string | null;
  priority: Priority;
  escalate: boolean;
  escalateReason: string | null;
  summary: string;
  draftReply: string | null;
}

export interface Usage { tokensIn: number; tokensOut: number }

export interface Slot { startIso: string; label: string }
export interface Busy { start: string; end: string }

export interface Contact { id: string; url: string }

export interface LeadRow {
  rowNumber: number; // 1-based sheet row
  received: string;
  status: string;
  priority: string;
  name: string;
  email: string;
  summary: string;
  interest: string;
  messageId: string;
  threadId: string;
  subject: string;
  hubspotId: string;
  followUps: number;
  lastFollowUp: string;
}

export interface Logger {
  info: (m: string, d?: Record<string, unknown>) => void;
  warn: (m: string, d?: Record<string, unknown>) => void;
  error: (m: string, d?: Record<string, unknown>) => void;
}

export interface GmailApi {
  listNew(): Promise<InboundEmail[]>;
  createDraft(input: { to: string; subject: string; body: string; threadId: string; inReplyTo: string | null }): Promise<string>;
  /** Sends to OWNER_EMAIL only. Customers never receive mail from code. */
  sendOwnerAlert(subject: string, body: string): Promise<void>;
}

export interface HubspotApi {
  upsertContact(input: { email: string; name: string | null; phone: string | null; priority: Priority; interest: string; budget: string | null }): Promise<Contact>;
  addNote(contactId: string, body: string): Promise<void>;
  addTask(contactId: string, subject: string, body: string, priority: Priority): Promise<void>;
  /** hs_lead_status of the contact ("NEW" while nobody has worked it). */
  leadStatus(contactId: string): Promise<string | null>;
}

export interface CalendarApi { proposeSlots(): Promise<Slot[]> }

export interface SheetApi {
  recentMessageIds(): Promise<Set<string>>;
  appendLead(row: (string | number)[]): Promise<void>;
  appendRun(row: (string | number)[]): Promise<void>;
  readLeads(): Promise<LeadRow[]>;
  recordFollowUp(rowNumber: number, count: number, whenIso: string): Promise<void>;
}

export interface Deps {
  gmail: GmailApi;
  hubspot: HubspotApi;
  calendar: CalendarApi;
  sheet: SheetApi;
  extract: (email: InboundEmail, slots: Slot[]) => Promise<{ result: Extraction; usage: Usage }>;
  now: () => Date;
  log: Logger;
}
