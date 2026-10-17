/** Pure viewing-slot logic. South African time is a fixed UTC+2 offset, so no timezone library is needed. */
import { CONFIG } from "./config";
import type { Busy, Slot } from "./types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type SlotCfg = { count: number; utcOffsetHours: number; starts: readonly string[]; durationMinutes: number; searchDays: number };

/** A Date whose UTC fields show local (SAST) wall-clock time. */
const toLocal = (d: Date, offset: number) => new Date(d.getTime() + offset * 3_600_000);

export function formatSlot(startUtc: Date, offset: number): string {
  const l = toLocal(startUtc, offset);
  const hh = String(l.getUTCHours()).padStart(2, "0");
  const mm = String(l.getUTCMinutes()).padStart(2, "0");
  return `${DAYS[l.getUTCDay()]} ${l.getUTCDate()} ${MONTHS[l.getUTCMonth()]} at ${hh}:${mm}`;
}

/** Window to ask Google free/busy about. */
export function searchWindow(now: Date, cfg: SlotCfg = CONFIG.slots) {
  return { timeMin: now.toISOString(), timeMax: new Date(now.getTime() + (cfg.searchDays + 1) * 86_400_000).toISOString() };
}

/**
 * Up to `count` free slots on different weekdays, starting tomorrow (local time).
 * One slot per day keeps the offer varied. Slots that overlap a busy block are skipped.
 */
export function pickSlots(busy: Busy[], now: Date, cfg: SlotCfg = CONFIG.slots): Slot[] {
  const blocks = busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const);
  const localNow = toLocal(now, cfg.utcOffsetHours);
  const out: Slot[] = [];
  for (let d = 1; d <= cfg.searchDays && out.length < cfg.count; d++) {
    const day = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + d));
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    for (const start of cfg.starts) {
      const [h, m] = start.split(":").map(Number);
      const startUtc = new Date(day.getTime() + (h - cfg.utcOffsetHours) * 3_600_000 + m * 60_000);
      const endMs = startUtc.getTime() + cfg.durationMinutes * 60_000;
      if (blocks.some(([bs, be]) => startUtc.getTime() < be && endMs > bs)) continue;
      out.push({ startIso: startUtc.toISOString(), label: formatSlot(startUtc, cfg.utcOffsetHours) });
      break;
    }
  }
  return out;
}
