/** HubSpot CRM over REST with a private app token (free CRM). */
import { fetchJson } from "./http";
import type { Contact, HubspotApi } from "./types";

const BASE = "https://api.hubapi.com";
const retry = { retries: 3, backoffMs: 1500 };

// HubSpot-defined association type ids: note to contact, task to contact.
const NOTE_TO_CONTACT = 202;
const TASK_TO_CONTACT = 204;

/** Custom contact properties the agent writes. Created once by scripts/setup-hubspot.ts. */
export const CUSTOM_PROPERTIES = [
  { name: "lead_priority", label: "Lead priority", description: "Hot, Warm or Cold, set by the lead agent" },
  { name: "property_interest", label: "Property interest", description: "What the lead asked about" },
  { name: "lead_budget", label: "Lead budget", description: "Budget stated by the lead" },
] as const;

async function hs<T>(path: string, label: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) throw new Error("HUBSPOT_TOKEN is not set");
  return fetchJson<T>(
    `${BASE}${path}`,
    {
      method: init.method ?? (init.json ? "POST" : "GET"),
      headers: { authorization: `Bearer ${token}`, ...(init.json ? { "content-type": "application/json" } : {}) },
      body: init.json ? JSON.stringify(init.json) : undefined,
    },
    { ...retry, label },
  );
}

export const splitName = (name: string | null) => {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstname: parts[0] ?? "", lastname: parts.slice(1).join(" ") };
};

export function hubspotClient(portalId = process.env.HUBSPOT_PORTAL_ID): HubspotApi {
  const contactUrl = (id: string) => (portalId ? `https://app.hubspot.com/contacts/${portalId}/record/0-1/${id}` : `contact ${id}`);
  const associate = (typeId: number, contactId: string) => [
    { to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }] },
  ];
  return {
    async upsertContact({ email, name, phone, priority, interest, budget }): Promise<Contact> {
      const found = await hs<{ results: { id: string }[] }>("/crm/v3/objects/contacts/search", "HubSpot contact search", {
        json: { filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }], limit: 1 },
      });
      const { firstname, lastname } = splitName(name);
      // Only send what we know, so an empty value never overwrites something a human typed in.
      const properties: Record<string, string> = { email, lead_priority: priority, property_interest: interest };
      if (firstname) properties.firstname = firstname;
      if (lastname) properties.lastname = lastname;
      if (phone) properties.phone = phone;
      if (budget) properties.lead_budget = budget;
      const existing = found.results[0];
      if (existing) {
        await hs(`/crm/v3/objects/contacts/${existing.id}`, "HubSpot contact update", { method: "PATCH", json: { properties } });
        return { id: existing.id, url: contactUrl(existing.id) };
      }
      properties.hs_lead_status = "NEW";
      const created = await hs<{ id: string }>("/crm/v3/objects/contacts", "HubSpot contact create", { json: { properties } });
      return { id: created.id, url: contactUrl(created.id) };
    },
    async addNote(contactId, body) {
      await hs("/crm/v3/objects/notes", "HubSpot note", {
        json: { properties: { hs_note_body: body, hs_timestamp: new Date().toISOString() }, associations: associate(NOTE_TO_CONTACT, contactId) },
      });
    },
    async addTask(contactId, subject, body, priority) {
      await hs("/crm/v3/objects/tasks", "HubSpot task", {
        json: {
          properties: {
            hs_task_subject: subject, hs_task_body: body, hs_task_status: "NOT_STARTED",
            hs_task_priority: priority === "Hot" ? "HIGH" : "MEDIUM", hs_timestamp: new Date().toISOString(),
          },
          associations: associate(TASK_TO_CONTACT, contactId),
        },
      });
    },
    async leadStatus(contactId) {
      const res = await hs<{ properties: { hs_lead_status?: string | null } }>(
        `/crm/v3/objects/contacts/${contactId}?properties=hs_lead_status`, "HubSpot lead status",
      );
      return res.properties.hs_lead_status ?? null;
    },
  };
}

/** Create the custom properties. Safe to re-run: "already exists" (409) is fine. */
export async function ensureProperties(): Promise<string[]> {
  const created: string[] = [];
  for (const p of CUSTOM_PROPERTIES) {
    try {
      await hs("/crm/v3/properties/contacts", `HubSpot property ${p.name}`, {
        json: { name: p.name, label: p.label, description: p.description, groupName: "contactinformation", type: "string", fieldType: "text" },
      });
      created.push(p.name);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("409"))) throw err;
    }
  }
  return created;
}
