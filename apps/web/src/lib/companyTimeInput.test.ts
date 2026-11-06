import { describe, expect, it } from "vitest";
import { changedInstant, fromCompanyTimeInput, toCompanyTimeInput } from "./companyTimeInput";

const COLOMBO = "Asia/Colombo";
const NEW_YORK = "America/New_York";

describe("toCompanyTimeInput", () => {
  it("shows an instant in the company's timezone, whatever the browser's is", () => {
    expect(toCompanyTimeInput("2026-11-03T03:25:00.000Z", COLOMBO)).toEqual({ date: "2026-11-03", time: "08:55" });
    expect(toCompanyTimeInput("2026-11-03T03:25:00.000Z", NEW_YORK)).toEqual({ date: "2026-11-02", time: "22:25" });
  });

  it("the date can differ from the UTC date", () => {
    expect(toCompanyTimeInput("2026-11-03T20:00:00.000Z", COLOMBO)).toEqual({ date: "2026-11-04", time: "01:30" });
  });

  it("no instant: empty boxes", () => {
    expect(toCompanyTimeInput(null, COLOMBO)).toEqual({ date: "", time: "" });
    expect(toCompanyTimeInput(undefined, COLOMBO)).toEqual({ date: "", time: "" });
  });
});

describe("fromCompanyTimeInput", () => {
  it("reads the boxes as company time", () => {
    expect(fromCompanyTimeInput({ date: "2026-11-03", time: "08:55" }, COLOMBO)).toBe("2026-11-03T03:25:00.000Z");
    expect(fromCompanyTimeInput({ date: "2026-11-03", time: "08:55" }, NEW_YORK)).toBe("2026-11-03T13:55:00.000Z");
  });

  it("nothing until both boxes are filled", () => {
    expect(fromCompanyTimeInput({ date: "2026-11-03", time: "" }, COLOMBO)).toBeNull();
    expect(fromCompanyTimeInput({ date: "", time: "08:55" }, COLOMBO)).toBeNull();
  });

  it("round-trips, apart from the seconds the boxes don't have", () => {
    const input = toCompanyTimeInput("2026-11-03T03:25:41.000Z", COLOMBO);
    expect(fromCompanyTimeInput(input, COLOMBO)).toBe("2026-11-03T03:25:00.000Z");
  });
});

describe("changedInstant", () => {
  const original = { date: "2026-11-03", time: "09:30" };

  it("an untouched field sends nothing, so its seconds aren't lost", () => {
    expect(changedInstant({ ...original }, original, COLOMBO)).toBeNull();
  });

  it("a changed time or date is sent", () => {
    expect(changedInstant({ ...original, time: "08:55" }, original, COLOMBO)).toBe("2026-11-03T03:25:00.000Z");
    expect(changedInstant({ ...original, date: "2026-11-04" }, original, COLOMBO)).toBe("2026-11-04T04:00:00.000Z");
  });

  it("a half-filled field sends nothing", () => {
    expect(changedInstant({ date: "2026-11-03", time: "" }, original, COLOMBO)).toBeNull();
  });
});
