// Jest auto-applies manual mocks for node_modules placed in a root-level
// __mocks__ directory. There's no GPS or OS permission in the test environment, so
// tests choose what these return.
module.exports = {
  Accuracy: { High: 4 },
  PermissionStatus: { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
};
