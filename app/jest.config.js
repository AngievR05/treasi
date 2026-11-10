const path = require('path');
const expoModulesCore = path.dirname(require.resolve('expo-modules-core/package.json', {
  paths: [require.resolve('expo/package.json')],
}));

module.exports = {
  preset: 'jest-expo/ios',
  testMatch: ['**/__tests__/**/*.test.js'],
  clearMocks: true,
  // The first iOS render loads native mocks lazily, which can be slow on Windows.
  testTimeout: 30_000,
  moduleNameMapper: {
    '^expo-modules-core$': require.resolve('expo-modules-core', { paths: [require.resolve('expo/package.json')] }),
    '^expo-modules-core/(.*)$': `${expoModulesCore}/$1`,
  },
};
