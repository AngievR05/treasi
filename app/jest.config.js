const path = require('path');
const expoModulesCore = path.dirname(require.resolve('expo-modules-core/package.json', {
  paths: [require.resolve('expo/package.json')],
}));

module.exports = {
  preset: 'jest-expo/ios',
  testMatch: ['**/__tests__/**/*.test.js'],
  clearMocks: true,
  testTimeout: 15_000,
  moduleNameMapper: {
    '^expo-modules-core$': require.resolve('expo-modules-core', { paths: [require.resolve('expo/package.json')] }),
    '^expo-modules-core/(.*)$': `${expoModulesCore}/$1`,
  },
};
