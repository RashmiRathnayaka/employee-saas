// Jest auto-applies manual mocks for node_modules placed in a root-level
// __mocks__ directory. The real icon components load their font through
// expo-asset's native asset registry, which doesn't exist under Jest
// ("Module ... is missing from the asset registry"). This renders the
// icon's name as plain text instead, so tests can still assert which icon
// is shown (testID "icon-<name>").
const React = require("react");
const { Text } = require("react-native");

function createIconSet() {
  function Icon({ name, testID }) {
    return React.createElement(Text, { testID: testID ?? `icon-${name}` }, name);
  }
  Icon.glyphMap = {};
  return Icon;
}

module.exports = {
  Ionicons: createIconSet(),
  MaterialIcons: createIconSet(),
  MaterialCommunityIcons: createIconSet(),
  FontAwesome: createIconSet(),
};
