import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react-native";
import { elapsedMinutes, useElapsedMinutes } from "./siteVisits";

const SINCE = "2026-11-03T05:00:00.000Z";
const at = (minutes: number, seconds = 0) => new Date(SINCE).getTime() + minutes * 60_000 + seconds * 1000;

describe("elapsedMinutes", () => {
  it("counts whole minutes, rounding down", () => {
    expect(elapsedMinutes(SINCE, at(0))).toBe(0);
    expect(elapsedMinutes(SINCE, at(0, 59))).toBe(0);
    expect(elapsedMinutes(SINCE, at(1))).toBe(1);
    expect(elapsedMinutes(SINCE, at(65, 30))).toBe(65);
  });

  it("is never negative, if the phone's clock is behind the server's", () => {
    expect(elapsedMinutes(SINCE, at(-5))).toBe(0);
  });
});

describe("useElapsedMinutes", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: at(10) });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps counting while it's showing, and stops when it isn't", async () => {
    const clearIntervalSpy = jest.spyOn(globalThis, "clearInterval");
    const { result, unmount } = await renderHook(() => useElapsedMinutes(SINCE));
    expect(result.current).toBe(10);

    await act(async () => {
      jest.advanceTimersByTime(5 * 60_000);
    });
    expect(result.current).toBe(15);

    await unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
