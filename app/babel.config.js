module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Must always be listed LAST in the plugins array
      'react-native-reanimated/plugin',
    ],
  };
};