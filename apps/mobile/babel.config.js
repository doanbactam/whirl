// babel-preset-expo resolves the react-native-worklets plugin on its own when
// reanimated is installed — adding it here too would register it twice.
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
