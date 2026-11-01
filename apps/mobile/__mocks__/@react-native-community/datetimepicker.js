// Manual mock for the native date picker. Covers both APIs DateField.tsx
// uses: the inline <DateTimePicker> component (iOS) renders a pressable
// "Confirm date" stand-in that fires onValueChange when pressed; the
// imperative DateTimePickerAndroid.open() (Android) fires its onValueChange
// synchronously, with no element rendered at all - mirroring the real
// module's "no element in the React tree" shape, which is the whole point
// of using it. Both read whatever ISO date the test last put on globalThis
// (rather than a module-local variable read back via jest.requireMock,
// which risks the test and the component resolving to different cached
// instances of this mock module).
const React = require("react");
const { Pressable, Text } = require("react-native");

function pickedDateIso() {
  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  return globalThis.__TEST_NEXT_PICKED_DATE__ || todayLocal;
}

function MockDateTimePicker({ onValueChange }) {
  return React.createElement(
    Pressable,
    {
      testID: "mock-date-time-picker",
      onPress: () => {
        onValueChange({ nativeEvent: { timestamp: 0, utcOffset: 0 } }, new Date(`${pickedDateIso()}T00:00:00`));
      },
    },
    React.createElement(Text, null, "Confirm date"),
  );
}

const DateTimePickerAndroid = {
  open: jest.fn((options) => {
    options?.onValueChange?.(
      { nativeEvent: { timestamp: 0, utcOffset: 0 } },
      new Date(`${pickedDateIso()}T00:00:00`),
    );
  }),
  dismiss: jest.fn(() => Promise.resolve(true)),
};

module.exports = MockDateTimePicker;
module.exports.default = MockDateTimePicker;
module.exports.DateTimePickerAndroid = DateTimePickerAndroid;
