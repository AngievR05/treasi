module.exports = function (api) {
  api.cache(true);
  return {
    // Expo configures the Reanimated/Worklets Babel plugin automatically.
    presets: ['babel-preset-expo'],
  };
};
