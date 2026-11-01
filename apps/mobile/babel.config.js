// Metro picks up babel-preset-expo automatically without this file, but
// jest-expo's Jest transform (babel-jest, not Metro) needs an explicit
// babel.config.js to find it.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
