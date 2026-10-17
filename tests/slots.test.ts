import { describe, expect, it } from "vitest";
import { formatSlot, pickSlots } from "../src/slots";

// Friday 16 October 2026, 09:00 SAST
const FRI = new Date("2026-10-16T07:00:00.000Z");

describe("pickSlots", () => {
  it("returns three weekday slots on different days, none on the weekend, starting tomorrow or later", () => {
    const slots = pickSlots([], FRI);
    expect(slots.map((s) => s.label)).toEqual([
      "Monday 19 October at 09:00", "Tuesday 20 October at 09:00", "Wednesday 21 October at 09:00",
    ]);
  });

  it("moves to the next free start when a time is busy", () => {
    // Monday 19 October 09:00 to 10:00 SAST is busy (07:00 to 08:00 UTC)
    const slots = pickSlots([{ start: "2026-10-19T07:00:00Z", end: "2026-10-19T08:00:00Z" }], FRI);
    expect(slots[0].label).toBe("Monday 19 October at 11:00");
  });

  it("skips a whole day when every start is busy", () => {
    const slots = pickSlots([{ start: "2026-10-19T00:00:00Z", end: "2026-10-19T23:59:00Z" }], FRI);
    expect(slots[0].label).toBe("Tuesday 20 October at 09:00");
  });

  it("returns fewer slots when the diary is full", () => {
    const slots = pickSlots([{ start: "2026-10-16T00:00:00Z", end: "2026-11-30T00:00:00Z" }], FRI);
    expect(slots).toEqual([]);
  });
});

describe("formatSlot", () => {
  it("shows South African local time", () => {
    expect(formatSlot(new Date("2026-10-20T12:30:00.000Z"), 2)).toBe("Tuesday 20 October at 14:30");
  });
});
