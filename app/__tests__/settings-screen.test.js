import { observeKeyboard } from './helpers/keyboard';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Alert, AppState, Linking } from 'react-native';
import { auth as mockAuth } from '../src/config/firebase';
import { getDocs, updateDoc } from 'firebase/firestore';
import { reload, sendEmailVerification, sendPasswordResetEmail, signOut, updateProfile } from 'firebase/auth';
import { ProfileSettingsScreen } from '../src/screens/ProfileSettingsScreen';

let mockAuthChange, mockAppStateChange, mockBatch;
const mockObservers = new Map();
jest.mock('../src/config/firebase', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_, callback) => { mockAuthChange = callback; callback(mockAuth.currentUser); return jest.fn(); },
  reload: jest.fn(), sendEmailVerification: jest.fn(), sendPasswordResetEmail: jest.fn(),
  signOut: jest.fn(), updateProfile: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  collection: (_, path) => ({ path }),
  doc: (parent, ...parts) => ({ path: parts.length ? parts.join('/') : `${parent.path}/event`, id: parts.at(-1) || 'event' }),
  query: reference => reference, where: jest.fn(), limit: jest.fn(),
  deleteField: () => 'delete-field', serverTimestamp: () => 'server-timestamp',
  getDocs: jest.fn(), updateDoc: jest.fn(), writeBatch: () => mockBatch,
  onSnapshot: (reference, next, error) => {
    const unsubscribe = jest.fn();
    mockObservers.set(reference.path, { next, error, unsubscribe });
    return unsubscribe;
  },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, left: 44, right: 44, bottom: 21 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../src/screens/OnboardingScreen', () => ({ OnboardingScreen: () => null }));

const profile = (changes = {}) => ({
  uid: 'explorer', username: 'EXPLORER', email: 'explorer@example.com', totalPoints: 750,
  hapticFeedbackEnabled: true, motionSensitivityEnabled: false, batteryOptimizerEnabled: false,
  nightModeEnabled: false, telemetryEnabled: false, hasCompletedOnboarding: true,
  createdAt: { toDate: () => new Date('2026-01-01') }, ...changes,
});
const emit = async (changes = {}) => act(() => mockObservers.get('users/explorer').next({ exists: () => true, data: () => profile(changes) }));
const press = label => fireEvent.press(screen.getByLabelText(label));
const preferenceSwitch = label => screen.getByRole('switch', { name: label });
const toggle = label => fireEvent.press(preferenceSwitch(label));
const mount = async (props = {}, changes = {}) => {
  const result = await render(<ProfileSettingsScreen onSignOut={jest.fn()} {...props} />);
  await emit(changes);
  return result;
};
const confirmAlert = async () => act(() => Alert.alert.mock.calls.at(-1)[2][1].onPress());

beforeEach(() => {
  jest.useFakeTimers();
  mockObservers.clear();
  mockAuth.currentUser = { uid: 'explorer', displayName: 'EXPLORER', email: 'explorer@example.com', emailVerified: false };
  mockBatch = { update: jest.fn(), set: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
  updateDoc.mockResolvedValue(undefined);
  getDocs.mockResolvedValue({ docs: [] });
  updateProfile.mockImplementation(async (user, fields) => Object.assign(user, fields));
  sendEmailVerification.mockResolvedValue(undefined);
  sendPasswordResetEmail.mockResolvedValue(undefined);
  reload.mockResolvedValue(undefined);
  signOut.mockResolvedValue(undefined);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => {
    mockAppStateChange = callback; return { remove: jest.fn() };
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  await cleanup(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks();
});

test('loads all five preferences as individually accessible iOS switches', async () => {
  await mount();
  expect(screen.getAllByRole('switch')).toHaveLength(5);
  expect(preferenceSwitch('HAPTIC FEEDBACK')).toBeChecked();
  expect(preferenceSwitch('LOCATION SHARING')).not.toBeChecked();
});

test.each([
  ['HAPTIC FEEDBACK', false, 'hapticFeedbackEnabled'],
  ['SENSITIVE SHAKE DETECTION', true, 'motionSensitivityEnabled'],
  ['BATTERY SAVER PREFERENCE', true, 'batteryOptimizerEnabled'],
  ['LOCATION SHARING', true, 'telemetryEnabled'],
])('persists %s to the authenticated profile', async (label, value, field) => {
  await mount(); await toggle(label);
  expect(updateDoc).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/explorer' }), {
    [field]: value, updatedAt: 'server-timestamp',
  });
  expect(preferenceSwitch(label)).toHaveProp('accessibilityState', expect.objectContaining({ checked: value }));
});

test('Night Field changes the palette and rolls back when saving fails', async () => {
  await mount();
  expect(screen.getByTestId('settings-panel')).toHaveStyle({ backgroundColor: '#E8DCC0' });
  await toggle('NIGHT FIELD PREFERENCE');
  expect(screen.getByTestId('settings-panel')).toHaveStyle({ backgroundColor: '#1C261D' });
  updateDoc.mockRejectedValueOnce(new Error('network unavailable'));
  await toggle('NIGHT FIELD PREFERENCE');
  expect(preferenceSwitch('NIGHT FIELD PREFERENCE')).toBeChecked();
  expect(screen.getByTestId('settings-panel')).toHaveStyle({ backgroundColor: '#1C261D' });
  expect(Alert.alert).toHaveBeenLastCalledWith('Preference Error', 'network unavailable', undefined);
});

test('a failed toggle restores its previous value', async () => {
  await mount(); updateDoc.mockRejectedValueOnce(new Error('permission denied'));
  await toggle('HAPTIC FEEDBACK');
  expect(preferenceSwitch('HAPTIC FEEDBACK')).toBeChecked();
});

test('turning sharing off atomically clears the saved coordinates', async () => {
  await mount({}, { telemetryEnabled: true, location: { latitude: 1, longitude: 2 } });
  await toggle('LOCATION SHARING');
  expect(updateDoc).toHaveBeenCalledWith(expect.anything(), {
    telemetryEnabled: false, location: 'delete-field', updatedAt: 'server-timestamp',
  });
});

test('clears shared location even when the sharing preference is already off', async () => {
  await mount({}, { telemetryEnabled: false, location: { latitude: 1, longitude: 2 } });
  await press('Stop location sharing and clear saved position');
  expect(updateDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ telemetryEnabled: false, location: 'delete-field' }));
});

test('serialises competing preference mutations and does not overwrite optimistic state with an old snapshot', async () => {
  let finish;
  updateDoc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  await press('Restore default Treasi preferences');
  const confirm = Alert.alert.mock.calls.at(-1)[2][1].onPress;
  await toggle('HAPTIC FEEDBACK');
  expect(preferenceSwitch('HAPTIC FEEDBACK')).toBeBusy();
  expect(preferenceSwitch('HAPTIC FEEDBACK')).toBeDisabled();
  await emit({ hapticFeedbackEnabled: true });
  expect(screen.getByLabelText('Restore default Treasi preferences')).toBeDisabled();
  await act(() => confirm());
  expect(updateDoc).toHaveBeenCalledTimes(1);
  await act(() => finish());
  expect(preferenceSwitch('HAPTIC FEEDBACK')).not.toBeChecked();
  expect(preferenceSwitch('HAPTIC FEEDBACK')).toBeEnabled();
});

test('restores defaults only after confirmation and clears location sharing', async () => {
  await mount({}, { nightModeEnabled: true, motionSensitivityEnabled: true, telemetryEnabled: true });
  await press('Restore default Treasi preferences');
  expect(updateDoc).not.toHaveBeenCalled();
  await confirmAlert();
  expect(updateDoc).toHaveBeenCalledTimes(1);
  expect(updateDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    hapticFeedbackEnabled: true, motionSensitivityEnabled: false, nightModeEnabled: false,
    batteryOptimizerEnabled: false, telemetryEnabled: false, location: 'delete-field',
  }));
  expect(preferenceSwitch('NIGHT FIELD PREFERENCE')).not.toBeChecked();
});

test('live profile events preserve an unfinished callsign draft', async () => {
  await mount(); await press('Edit Explorer identity');
  await fireEvent.changeText(screen.getByLabelText('Explorer callsign'), 'NEW_DRAFT');
  await emit({ totalPoints: 1000 });
  expect(screen.getByLabelText('Explorer callsign')).toHaveProp('value', 'NEW_DRAFT');
});

test('validates callsigns before calling Firebase', async () => {
  await mount(); await press('Edit Explorer identity');
  await fireEvent.changeText(screen.getByLabelText('Explorer callsign'), 'a!');
  await press('Save Explorer callsign');
  expect(getDocs).not.toHaveBeenCalled();
  expect(screen.getByText(/Use 3–24 characters/)).toBeTruthy();
});

test('rejects a duplicate callsign without updating Auth or Firestore', async () => {
  getDocs.mockResolvedValueOnce({ docs: [{ id: 'other' }] });
  await mount(); await press('Edit Explorer identity');
  await fireEvent.changeText(screen.getByLabelText('Explorer callsign'), 'NEW_NAME');
  await press('Save Explorer callsign');
  expect(updateProfile).not.toHaveBeenCalled();
  expect(screen.getByText('That Explorer callsign is already in use.')).toBeTruthy();
});

test('saves the callsign and profile activity with an atomic Firestore batch', async () => {
  await mount(); await press('Edit Explorer identity');
  await fireEvent.changeText(screen.getByLabelText('Explorer callsign'), 'new_name');
  await press('Save Explorer callsign');
  expect(updateProfile).toHaveBeenCalledWith(mockAuth.currentUser, { displayName: 'NEW_NAME' });
  expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/explorer' }), expect.objectContaining({ username: 'NEW_NAME' }));
  expect(mockBatch.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'PROFILE_UPDATED', username: 'NEW_NAME' }));
  expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Save Explorer callsign')).toBeNull();
});

test('restores the Auth name if the Firestore identity write fails', async () => {
  mockBatch.commit.mockRejectedValueOnce(new Error('batch failed'));
  await mount(); await press('Edit Explorer identity');
  await fireEvent.changeText(screen.getByLabelText('Explorer callsign'), 'NEW_NAME');
  await press('Save Explorer callsign');
  expect(updateProfile).toHaveBeenLastCalledWith(mockAuth.currentUser, { displayName: 'EXPLORER' });
  expect(screen.getByText('batch failed')).toBeTruthy();
});

test('sends verification and password reset for the current authenticated account', async () => {
  await mount(); await press('Send email verification');
  expect(sendEmailVerification).toHaveBeenCalledTimes(1);
  await press('Send password reset email');
  expect(sendPasswordResetEmail).toHaveBeenCalledWith(mockAuth, 'explorer@example.com');
});

test('refreshes email verification after returning from the background', async () => {
  await mount();
  reload.mockImplementationOnce(async user => { user.emailVerified = true; });
  await act(() => { mockAppStateChange('background'); mockAppStateChange('inactive'); mockAppStateChange('active'); });
  expect(reload).toHaveBeenCalledTimes(1);
  await emit();
  expect(screen.getByLabelText('Account email is verified.')).toBeTruthy();
});

test('opens the native iOS settings page', async () => {
  await mount(); await press('Open system settings');
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
});

test('retries the profile listener and ignores callbacks from the terminated listener', async () => {
  await mount(); const old = mockObservers.get('users/explorer');
  await act(() => old.error(new Error('sync unavailable')));
  await press('Retry profile synchronisation');
  expect(old.unsubscribe).toHaveBeenCalledTimes(1);
  await emit({ username: 'CURRENT' });
  await act(() => old.next({ exists: () => true, data: () => profile({ username: 'STALE' }) }));
  expect(screen.queryByText('STALE')).toBeNull();
});

test('signs out once after confirmation and calls the parent', async () => {
  const onSignOut = jest.fn();
  let finish;
  signOut.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount({ onSignOut }); await press('Sign out');
  const confirm = Alert.alert.mock.calls.at(-1)[2][1].onPress;
  await act(() => { confirm(); confirm(); });
  expect(signOut).toHaveBeenCalledTimes(1);
  await act(() => finish());
  expect(onSignOut).toHaveBeenCalledTimes(1);
});

test('an old sign-out confirmation cannot end a newer account session', async () => {
  await mount(); await press('Sign out');
  const confirm = Alert.alert.mock.calls.at(-1)[2][1].onPress;
  await act(() => { mockAuth.currentUser = { uid: 'other' }; mockAuthChange(mockAuth.currentUser); });
  await act(() => confirm());
  expect(signOut).not.toHaveBeenCalled();
});

test('onboarding review supports landscape and closes without changing completion data', async () => {
  await mount(); await press('Review onboarding');
  expect(screen.getByTestId('settings-onboarding-modal')).toHaveProp('supportedOrientations', expect.arrayContaining(['landscape-left', 'landscape-right']));
  await press('Close onboarding review');
  expect(updateDoc).not.toHaveBeenCalled();
});

test('keeps permanent deletion unavailable without a backend handler', async () => {
  await mount(); await press('Delete Treasi account');
  expect(screen.getByTestId('settings-delete-modal')).toHaveProp('supportedOrientations', expect.arrayContaining(['landscape-left', 'landscape-right']));
  expect(screen.getByLabelText('Secure account deletion unavailable')).toBeDisabled();
  await press('Cancel account deletion');
  expect(signOut).not.toHaveBeenCalled();
});

test('requires DELETE and invokes the configured deletion handler once', async () => {
  const onDeleteAccount = jest.fn().mockResolvedValue(undefined), onSignOut = jest.fn();
  await mount({ onDeleteAccount, onSignOut }); await press('Delete Treasi account');
  expect(screen.getByLabelText('Permanently delete account')).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Delete account confirmation'), 'DELETE');
  await press('Permanently delete account');
  expect(onDeleteAccount).toHaveBeenCalledTimes(1);
  expect(onSignOut).toHaveBeenCalledTimes(1);
});

test('clears old profile data and discards the completion of an earlier account save', async () => {
  let finish;
  updateDoc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await toggle('NIGHT FIELD PREFERENCE');
  await act(() => { mockAuth.currentUser = null; mockAuthChange(null); });
  await act(() => finish());
  expect(screen.getByText('NO ACTIVE EXPLORER SESSION')).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
});

test('verification failure leaves the action available for retry', async () => {
  sendEmailVerification.mockRejectedValueOnce(new Error('verification unavailable'));
  await mount(); await press('Send email verification');
  expect(Alert.alert).toHaveBeenLastCalledWith('Verification Failed', 'verification unavailable', undefined);
  expect(screen.getByLabelText('Send email verification')).toBeEnabled();
  await press('Send email verification');
  expect(sendEmailVerification).toHaveBeenCalledTimes(2);
});

test('sign-out failure retains the account and permits retry', async () => {
  const onSignOut = jest.fn();
  signOut.mockRejectedValueOnce(new Error('sign-out unavailable'));
  await mount({ onSignOut }); await press('Sign out'); await confirmAlert();
  expect(onSignOut).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Sign out')).toBeEnabled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Sign Out Failed', 'sign-out unavailable', undefined);
});

test('failed secure deletion retains the confirmation and never signs out', async () => {
  const onDeleteAccount = jest.fn().mockRejectedValue(new Error('deletion unavailable')), onSignOut = jest.fn();
  await mount({ onDeleteAccount, onSignOut }); await press('Delete Treasi account');
  await fireEvent.changeText(screen.getByLabelText('Delete account confirmation'), 'DELETE');
  await press('Permanently delete account');
  expect(onSignOut).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Permanently delete account')).toBeEnabled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Account Deletion Failed', 'deletion unavailable', undefined);
});

test('a previous sign-out confirmation is invalid after signing back into the same account', async () => {
  await mount(); await press('Sign out');
  const confirm = Alert.alert.mock.calls.at(-1)[2][1].onPress;
  await act(() => { mockAuth.currentUser = null; mockAuthChange(null); });
  await act(() => { mockAuth.currentUser = { uid: 'explorer', email: 'explorer@example.com' }; mockAuthChange(mockAuth.currentUser); });
  await act(() => confirm());
  expect(signOut).not.toHaveBeenCalled();
});

test('successful secure deletion redirects after the backend clears Firebase Auth', async () => {
  const onSignOut = jest.fn();
  const onDeleteAccount = jest.fn(async () => {
    mockAuth.currentUser = null;
    mockAuthChange(null);
  });
  await mount({ onDeleteAccount, onSignOut }); await press('Delete Treasi account');
  await fireEvent.changeText(screen.getByLabelText('Delete account confirmation'), 'DELETE');
  await press('Permanently delete account');
  expect(onSignOut).toHaveBeenCalledTimes(1);
});

test('a completed old sign-out does not redirect a newer authenticated session', async () => {
  const onSignOut = jest.fn(); let finish;
  signOut.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount({ onSignOut }); await press('Sign out'); await confirmAlert();
  await act(() => { mockAuth.currentUser = { uid: 'other' }; mockAuthChange(mockAuth.currentUser); });
  await act(() => finish());
  expect(onSignOut).not.toHaveBeenCalled();
});

test('keyboard editing keeps the callsign draft visible and temporarily hides the settings pane', async () => {
  const keyboard = observeKeyboard(); await mount(); await press('Edit Explorer identity');
  await fireEvent.changeText(screen.getByLabelText('Explorer callsign'), 'VISIBLE_DRAFT'); await keyboard(true);
  expect(screen.getByLabelText('Explorer callsign')).toHaveProp('value', 'VISIBLE_DRAFT');
  expect(screen.queryByRole('switch', { name: 'HAPTIC FEEDBACK' })).toBeNull();
  await press('Done typing'); await keyboard(false);
  expect(screen.getByRole('switch', { name: 'HAPTIC FEEDBACK' })).toBeTruthy();
  expect(screen.getByLabelText('Explorer callsign')).toHaveProp('value', 'VISIBLE_DRAFT');
});
