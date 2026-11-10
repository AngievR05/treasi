import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { LoginScreen } from '../src/screens/Auth/LoginScreen';
import { SignUpScreen } from '../src/screens/Auth/SignUpScreen';
import { observeKeyboard } from './helpers/keyboard';

jest.mock('../src/config/firebase', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ left: 44, right: 44, top: 0, bottom: 21 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
beforeEach(() => { jest.useFakeTimers(); jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true); });
afterEach(async () => { await cleanup(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('Login preserves email and passcode while the typing layout opens and closes', async () => {
  const keyboard = observeKeyboard(); await render(<LoginScreen onNavigateSignUp={jest.fn()} onLoginSuccess={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText('Explorer email'), 'explorer@example.com');
  await fireEvent.changeText(screen.getByLabelText('Passcode'), 'Keep-secret123');
  await keyboard(true); expect(screen.getByLabelText('Passcode')).toHaveProp('value', 'Keep-secret123');
  expect(screen.queryByText('BEFORE YOU HEAD OUT')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Done typing' })); await keyboard(false);
  expect(screen.getByText('BEFORE YOU HEAD OUT')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Create a new Explorer account' })).toBeTruthy();
  expect(screen.getByLabelText('Explorer email')).toHaveProp('value', 'explorer@example.com');
  expect(screen.getByLabelText('Passcode')).toHaveProp('value', 'Keep-secret123');
});
test('Sign Up keeps every field intact when it expands above the landscape keyboard', async () => {
  const keyboard = observeKeyboard(); await render(<SignUpScreen onNavigateLogin={jest.fn()} onSignUpSuccess={jest.fn()} />);
  const fields = { 'Explorer callsign': 'RANGER', 'Explorer email': 'ranger@example.com', Passcode: 'Secret123', 'Confirm passcode': 'Secret123' };
  for (const [label, value] of Object.entries(fields)) await fireEvent.changeText(screen.getByLabelText(label), value);
  await keyboard(true);
  expect(screen.queryByRole('button', { name: 'Sign in to existing Explorer account' })).toBeNull();
  for (const [label, value] of Object.entries(fields)) expect(screen.getByLabelText(label)).toHaveProp('value', value);
  await fireEvent.press(screen.getByRole('button', { name: 'Done typing' })); await keyboard(false);
  expect(screen.getByRole('button', { name: 'Sign in to existing Explorer account' })).toBeTruthy();
  for (const [label, value] of Object.entries(fields)) expect(screen.getByLabelText(label)).toHaveProp('value', value);
});
