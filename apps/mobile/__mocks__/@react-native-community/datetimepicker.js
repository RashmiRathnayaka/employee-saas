// Manual mock for the native date picker: renders a pressable "Confirm
// date" stand-in instead of opening a real OS dialog, firing onChange with
// whatever ISO date the test last put on globalThis. Using globalThis
// (rather than a module-local variable read back via jest.requireMock)
// sidesteps any risk of the test and the component resolving to different
// cached instances of this mock module.
const React = require("react");
const { Pressable, Text } = require("react-native");

function MockDateTimePicker({ onChange }) {
  return React.createElement(
    Pressable,
    {
      testID: "mock-date-time-picker",
      onPress: () => {
        const iso = globalThis.__TEST_NEXT_PICKED_DATE__ || new Date().toISOString().slice(0, 10);
        onChange({ type: "set" }, new Date(`${iso}T00:00:00`));
      },
    },
    React.createElement(Text, null, "Confirm date"),
  );
}

module.exports = MockDateTimePicker;
module.exports.default = MockDateTimePicker;
