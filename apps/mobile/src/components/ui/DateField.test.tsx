import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Platform } from "react-native";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { DateField } from "./DateField";

describe("DateField on Android", () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Platform.OS = "android";
    (DateTimePickerAndroid.open as jest.Mock).mockClear();
    delete (globalThis as Record<string, unknown>).__TEST_NEXT_PICKED_DATE__;
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it("opens the imperative native picker instead of rendering an inline dialog", async () => {
    const onChange = jest.fn();
    await render(<DateField label="Start date" value="" onChange={onChange} />);

    (globalThis as Record<string, unknown>).__TEST_NEXT_PICKED_DATE__ = "2026-12-15";
    await fireEvent.press(screen.getByLabelText("Start date"));

    expect(DateTimePickerAndroid.open).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-12-15");
    // No element should ever be mounted for Android - that's the whole
    // point of the fix: a parent re-render has nothing to remount, because
    // nothing from this picker lives in the React tree once it's open.
    expect(screen.queryByTestId("mock-date-time-picker")).toBeNull();
  });

  it("passes the current value and minimumDate through to the native call", async () => {
    const onChange = jest.fn();
    const minimumDate = new Date("2026-10-01T00:00:00");
    await render(<DateField label="Start date" value="2026-11-20" onChange={onChange} minimumDate={minimumDate} />);

    await fireEvent.press(screen.getByLabelText("Start date"));

    expect(DateTimePickerAndroid.open).toHaveBeenCalledWith(
      expect.objectContaining({
        value: new Date("2026-11-20T00:00:00"),
        mode: "date",
        minimumDate,
      }),
    );
  });
});
