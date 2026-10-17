/** Google Sheet audit log through a service account. The Sheet must be shared with the service account email. */
import { auth as googleAuth, sheets as sheetsApi, type sheets_v4 } from "@googleapis/sheets";
import type { LeadRow, SheetApi } from "./types";

export const LEADS_TAB = "Leads";
export const RUNS_TAB = "Runs";
export const LEADS_HEADER = ["Received", "Status", "Priority", "Name", "Email", "Intent", "Interest", "Viewing", "Escalated",
  "Summary", "HubSpot", "Gmail message ID", "Thread ID", "Subject", "HubSpot ID", "Follow-ups", "Last follow-up"];
export const RUNS_HEADER = ["Date", "Emails seen", "Leads", "Ignored", "Errors", "Tokens in", "Tokens out", "Est. cost (USD)", "Seconds", "Notes"];
const COL = Object.fromEntries(LEADS_HEADER.map((h, i) => [h, i])) as Record<string, number>;

const HEADER_BG = "#1f3a5f";
const PRIORITY_COLOURS: Record<string, string> = { Hot: "#f4cccc", Warm: "#fff2cc", Cold: "#d9ead3" };

const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 };
};

export function connect(): sheets_v4.Sheets {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 is not set");
  const credentials = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  const auth = new googleAuth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return sheetsApi({ version: "v4", auth });
}

const colLetter = (i: number) => String.fromCharCode(65 + i); // up to column Z, enough for 17 columns

/** Create the tabs and style them the first time. Safe to call every run. */
export async function ensureSetup(api: sheets_v4.Sheets, spreadsheetId: string): Promise<void> {
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" });
  const tabs = new Map((meta.data.sheets ?? []).map((s) => [s.properties?.title ?? "", s.properties?.sheetId ?? 0]));

  if (!tabs.has(LEADS_TAB) && tabs.has("Sheet1")) {
    const first = await api.spreadsheets.values.get({ spreadsheetId, range: "Sheet1!A1:Z5" });
    if (!first.data.values?.length) {
      const sheetId = tabs.get("Sheet1")!;
      await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId, title: LEADS_TAB }, fields: "title" } }] } });
      tabs.delete("Sheet1");
      tabs.set(LEADS_TAB, sheetId);
    }
  }
  const adds = [LEADS_TAB, RUNS_TAB].filter((t) => !tabs.has(t)).map((title) => ({ addSheet: { properties: { title } } }));
  if (adds.length) {
    const res = await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: adds } });
    for (const r of res.data.replies ?? []) {
      const p = r.addSheet?.properties;
      if (p?.title) tabs.set(p.title, p.sheetId ?? 0);
    }
  }
  for (const [tab, header] of [[LEADS_TAB, LEADS_HEADER], [RUNS_TAB, RUNS_HEADER]] as const) {
    const got = await api.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:A1` });
    if (got.data.values?.[0]?.[0]) continue;
    await api.spreadsheets.values.update({ spreadsheetId, range: `${tab}!A1`, valueInputOption: "RAW", requestBody: { values: [header as unknown as string[]] } });
    const sheetId = tabs.get(tab)!;
    const grid = { sheetId, startColumnIndex: 0, endColumnIndex: header.length };
    const requests: sheets_v4.Schema$Request[] = [
      { repeatCell: { range: { ...grid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: rgb(HEADER_BG), textFormat: { bold: true, foregroundColor: rgb("#ffffff") } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    ];
    if (tab === LEADS_TAB) {
      // Internal columns (message/thread/subject/HubSpot id, follow-up counters) are grouped away from the owner's view.
      requests.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: COL["Gmail message ID"], endIndex: header.length }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } });
    }
    await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }
  await applyPriorityRules(api, spreadsheetId, tabs.get(LEADS_TAB)!);
}

/**
 * Colour the whole row by its Priority cell. Runs every time but only writes when the rules are missing or
 * out of date, so an older Sheet (cell-only colours) is upgraded without touching its data.
 */
async function applyPriorityRules(api: sheets_v4.Sheets, spreadsheetId: string, sheetId: number): Promise<void> {
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId),conditionalFormats)" });
  const existing = meta.data.sheets?.find((s) => s.properties?.sheetId === sheetId)?.conditionalFormats ?? [];
  const wanted = Object.keys(PRIORITY_COLOURS).length;
  if (existing.length === wanted && existing.every((r) => r.booleanRule?.condition?.type === "CUSTOM_FORMULA")) return;
  const rows = { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: LEADS_HEADER.length };
  const col = colLetter(COL.Priority);
  const requests: sheets_v4.Schema$Request[] = [
    ...existing.map(() => ({ deleteConditionalFormatRule: { sheetId, index: 0 } })),
    ...Object.entries(PRIORITY_COLOURS).map(([name, hex]): sheets_v4.Schema$Request => ({
      addConditionalFormatRule: { index: 0, rule: { ranges: [rows], booleanRule: {
        condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: `=$${col}2="${name}"` }] },
        format: { backgroundColor: rgb(hex) } } } },
    })),
  ];
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

async function append(api: sheets_v4.Sheets, spreadsheetId: string, tab: string, row: (string | number)[]) {
  // RAW stores text as text (a "=..." email can never run as a formula). OVERWRITE keeps formatting ranges in place.
  await api.spreadsheets.values.append({ spreadsheetId, range: `${tab}!A1`, valueInputOption: "RAW", insertDataOption: "OVERWRITE", requestBody: { values: [row] } });
}

export function sheetClient(api: sheets_v4.Sheets, spreadsheetId: string): SheetApi {
  const readAll = async () => ((await api.spreadsheets.values.get({ spreadsheetId, range: `${LEADS_TAB}!A2:${colLetter(LEADS_HEADER.length - 1)}` })).data.values ?? []) as string[][];
  return {
    async recentMessageIds() {
      const rows = await readAll();
      return new Set(rows.map((r) => r[COL["Gmail message ID"]] ?? "").filter(Boolean));
    },
    appendLead: (row) => append(api, spreadsheetId, LEADS_TAB, row),
    appendRun: (row) => append(api, spreadsheetId, RUNS_TAB, row),
    async readLeads(): Promise<LeadRow[]> {
      const rows = await readAll();
      return rows.map((r, i) => {
        const c = (name: string) => r[COL[name]] ?? "";
        return {
          rowNumber: i + 2, received: c("Received"), status: c("Status"), priority: c("Priority"), name: c("Name"), email: c("Email"),
          summary: c("Summary"), interest: c("Interest"), messageId: c("Gmail message ID"), threadId: c("Thread ID"), subject: c("Subject"),
          hubspotId: c("HubSpot ID"), followUps: Number(c("Follow-ups")) || 0, lastFollowUp: c("Last follow-up"),
        };
      });
    },
    async recordFollowUp(rowNumber, count, whenIso) {
      const from = colLetter(COL["Follow-ups"]);
      const to = colLetter(COL["Last follow-up"]);
      await api.spreadsheets.values.update({ spreadsheetId, range: `${LEADS_TAB}!${from}${rowNumber}:${to}${rowNumber}`, valueInputOption: "RAW", requestBody: { values: [[count, whenIso]] } });
    },
  };
}

/** Column order for appendLead, kept next to the header so they cannot drift apart. */
export function leadRow(v: Record<string, string | number>): (string | number)[] {
  return LEADS_HEADER.map((h) => v[h] ?? "");
}
