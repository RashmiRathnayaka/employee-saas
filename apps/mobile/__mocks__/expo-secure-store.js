// Jest auto-applies manual mocks for node_modules placed in a root-level
// __mocks__ directory - no native keychain/keystore exists in the test
// environment, so this swaps in an in-memory Map.
const store = new Map();

module.exports = {
  getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
  setItemAsync: jest.fn(async (key, value) => {
    store.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key) => {
    store.delete(key);
  }),
  __reset: () => store.clear(),
};
