import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Alert, AppState, Linking } from 'react-native';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { runTransaction } from 'firebase/firestore';
import { auth as mockAuth } from '../src/config/firebase';
import { HuntScreen } from '../src/screens/HuntScreen';

let mockAuthChange, mockAppStateChange, mockOrientationChange, mockStoredTreasure, mockStoredProfile, mockStoredDiscovery, mockTransaction;
const mockObservers = new Map();
const mockPositions = [], mockHeadings = [], mockShakes = [];
const mockLocationRemove = jest.fn(), mockHeadingRemove = jest.fn(), mockShakeRemove = jest.fn();

jest.mock('../src/config/firebase', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: (_, callback) => { mockAuthChange = callback; callback(mockAuth.currentUser); return jest.fn(); } }));
jest.mock('firebase/firestore', () => ({
  collection: (_, path) => ({ path }),
  doc: (parent, ...parts) => ({ path: parts.length ? parts.join('/') : `${parent.path}/event`, id: parts.at(-1) || 'event' }),
  serverTimestamp: () => 'server-timestamp', runTransaction: jest.fn(),
  onSnapshot: (reference, next, error) => {
    const unsubscribe = jest.fn(); mockObservers.set(reference.path, { next, error, unsubscribe }); return unsubscribe;
  },
}));
jest.mock('expo-location', () => ({
  Accuracy: { High: 4, BestForNavigation: 6 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getForegroundPermissionsAsync: jest.fn(), requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(), getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(), watchPositionAsync: jest.fn(), watchHeadingAsync: jest.fn(),
}));
jest.mock('expo-sensors', () => ({ Accelerometer: {
  getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), isAvailableAsync: jest.fn(),
  setUpdateInterval: jest.fn(), addListener: jest.fn(),
} }));
jest.mock('expo-haptics', () => ({ NotificationFeedbackType: { Success: 'success' }, notificationAsync: jest.fn() }));
jest.mock('expo-screen-orientation', () => ({
  Orientation: { UNKNOWN: 0, PORTRAIT_UP: 1, PORTRAIT_DOWN: 2, LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 },
  getOrientationAsync: jest.fn(),
  addOrientationChangeListener: callback => { mockOrientationChange = callback; return { remove: jest.fn() }; },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 44, bottom: 21, left: 44 }) }));
jest.mock('react-native-svg', () => {
  const { View, Text } = require('react-native');
  return { __esModule: true, default: View, Line: View, Polygon: View, Text };
});

const treasure = (changes = {}) => ({
  treasureId: 'wrong-embedded-id', title: 'Campus cache', creatorId: 'another-explorer', creatorName: 'Angie',
  location: { latitude: -25.89, longitude: 28.18 }, hint: 'Look beside the tree',
  payloadText: 'Secret reward', isArchived: false, ...changes,
});
const profile = (changes = {}) => ({ uid: 'explorer', username: 'EXPLORER', totalPoints: 1000,
  hapticFeedbackEnabled: true, motionSensitivityEnabled: false, ...changes });
const permission = granted => ({ status: granted ? 'granted' : 'denied', granted, canAskAgain: true, expires: 'never' });
const fix = (changes = {}) => ({ coords: { latitude: -25.89, longitude: 28.18, accuracy: 5 }, timestamp: Date.now(), ...changes });
const pending = () => new Promise(() => {});
const snapshot = data => ({ exists: () => data != null, data: () => data, id: 'cache-id' });
const emit = async (target = 'cache-id', cache = treasure(), user = profile(), found = false) => act(() => {
  mockObservers.get(`treasures/${target}`).next(snapshot(cache));
  mockObservers.get(`users/${mockAuth.currentUser.uid}`).next(snapshot(user));
  mockObservers.get(`discoveries/${mockAuth.currentUser.uid}_${target}`).next(snapshot(found ? {} : null));
});
const position = async value => act(() => mockPositions.at(-1).next(value));
const press = label => fireEvent.press(screen.getByLabelText(label));
const mount = async (props = {}, cache = treasure(), user = profile(), found = false) => {
  const result = await render(<HuntScreen treasureId="cache-id" onBack={jest.fn()} {...props} />);
  await emit(props.treasureId || 'cache-id', cache, user, found);
  return result;
};
const stateChange = state => { AppState.currentState = state; mockAppStateChange(state); };

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-10T10:00:00Z'));
  AppState.currentState = 'active';
  mockAuth.currentUser = { uid: 'explorer', displayName: 'EXPLORER' };
  mockObservers.clear(); mockPositions.length = 0; mockHeadings.length = 0; mockShakes.length = 0;
  mockStoredTreasure = treasure(); mockStoredProfile = profile(); mockStoredDiscovery = null;
  mockTransaction = {
    get: jest.fn(async ref => snapshot(ref.path.startsWith('treasures/') ? mockStoredTreasure :
      ref.path.startsWith('users/') ? mockStoredProfile : mockStoredDiscovery)),
    set: jest.fn(), update: jest.fn(),
  };
  runTransaction.mockImplementation(async (_, callback) => callback(mockTransaction));
  Location.getForegroundPermissionsAsync.mockResolvedValue(permission(true));
  Location.requestForegroundPermissionsAsync.mockResolvedValue(permission(true));
  Location.hasServicesEnabledAsync.mockResolvedValue(true);
  Location.getLastKnownPositionAsync.mockResolvedValue(null);
  Location.getCurrentPositionAsync.mockImplementation(pending);
  Location.watchPositionAsync.mockImplementation(async (_, next, error) => {
    mockPositions.push({ next, error }); return { remove: mockLocationRemove };
  });
  Location.watchHeadingAsync.mockImplementation(async (next, error) => {
    mockHeadings.push({ next, error }); return { remove: mockHeadingRemove };
  });
  Accelerometer.getPermissionsAsync.mockResolvedValue(permission(true));
  Accelerometer.requestPermissionsAsync.mockResolvedValue(permission(true));
  Accelerometer.isAvailableAsync.mockResolvedValue(true);
  Accelerometer.addListener.mockImplementation(next => { mockShakes.push(next); return { remove: mockShakeRemove }; });
  Haptics.notificationAsync.mockResolvedValue(undefined);
  ScreenOrientation.getOrientationAsync.mockResolvedValue(ScreenOrientation.Orientation.PORTRAIT_UP);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => { mockAppStateChange = callback; return { remove: jest.fn() }; });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  await cleanup(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks();
});

test('a live accurate in-range fix enables excavation and awards exactly 100 points atomically', async () => {
  const onSuccess = jest.fn(); await mount({ onSuccess }); await position(fix());
  await press('Excavate treasure');
  expect(mockTransaction.get.mock.calls.map(([ref]) => ref.path)).toEqual(['discoveries/explorer_cache-id', 'users/explorer', 'treasures/cache-id']);
  expect(mockTransaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/explorer' }), { totalPoints: 1100, updatedAt: 'server-timestamp' });
  expect(mockTransaction.set).toHaveBeenCalledTimes(2);
  expect(mockTransaction.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'discoveries/explorer_cache-id' }), expect.objectContaining({ hunterId: 'explorer', treasureId: 'cache-id' }));
  expect(screen.getByLabelText('Excavation complete')).toBeDisabled();
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
});

test('a stalled cache lookup does not delay live tracking and cannot overwrite a live distance', async () => {
  let finishCache; Location.getLastKnownPositionAsync.mockImplementation(() => new Promise(resolve => { finishCache = resolve; }));
  await mount(); expect(mockPositions).toHaveLength(1); await position(fix());
  await act(() => finishCache(fix({ coords: { latitude: 0, longitude: 0, accuracy: 5 } })));
  expect(screen.getByLabelText('Excavate treasure')).toBeEnabled();
});

test('cached positions cannot authorise excavation', async () => {
  Location.getLastKnownPositionAsync.mockResolvedValue(fix()); await mount();
  await press('Check excavation readiness'); expect(runTransaction).not.toHaveBeenCalled();
});

test.each([
  ['stale', () => fix({ timestamp: Date.now() - 13_000 })],
  ['future', () => fix({ timestamp: Date.now() + 60_000 })],
  ['invalid timestamp', () => fix({ timestamp: NaN })],
  ['invalid coordinates', () => fix({ coords: { latitude: 91, longitude: 0, accuracy: 5 } })],
  ['poor accuracy', () => fix({ coords: { latitude: -25.89, longitude: 28.18, accuracy: 30 } })],
  ['unknown accuracy', () => fix({ coords: { latitude: -25.89, longitude: 28.18, accuracy: null } })],
  ['out of range', () => fix({ coords: { latitude: -25.88, longitude: 28.18, accuracy: 5 } })],
])('%s GPS cannot record a discovery', async (_, makeFix) => {
  await mount(); await position(makeFix()); await press('Check excavation readiness');
  expect(runTransaction).not.toHaveBeenCalled();
});

test('an expired fix exposes location recovery and a new fix restores excavation', async () => {
  await mount(); await position(fix()); await act(() => jest.advanceTimersByTime(14_000));
  expect(screen.getByLabelText('RETRY LOCATION')).toBeEnabled();
  await press('Check excavation readiness'); expect(runTransaction).not.toHaveBeenCalled();
  await position(fix()); expect(screen.getByLabelText('Excavate treasure')).toBeEnabled();
});

test('does not award points for an owned or archived cache', async () => {
  const result = await mount({}, treasure({ creatorId: 'explorer' })); await position(fix());
  expect(screen.getByLabelText('Own treasure cannot be excavated')).toBeDisabled();
  await emit('cache-id', treasure({ isArchived: true }));
  expect(screen.getByLabelText('Treasure archived')).toBeDisabled();
  expect(runTransaction).not.toHaveBeenCalled(); await result.unmount();
});

test.each([
  ['moved', () => { mockStoredTreasure.location = { latitude: 0, longitude: 0 }; }, 'Target Moved'],
  ['archived', () => { mockStoredTreasure.isArchived = true; }, 'Treasure Archived'],
  ['removed', () => { mockStoredTreasure = null; }, 'Treasure Unavailable'],
  ['became own cache', () => { mockStoredTreasure.creatorId = 'explorer'; }, 'Own Cache'],
  ['invalid coordinates', () => { mockStoredTreasure.location.latitude = NaN; }, 'Treasure Location Invalid'],
  ['invalid points', () => { mockStoredProfile.totalPoints = NaN; }, 'Explorer Profile Error'],
  ['overflowing points', () => { mockStoredProfile.totalPoints = Number.MAX_SAFE_INTEGER; }, 'Explorer Profile Error'],
  ['missing profile', () => { mockStoredProfile = null; }, 'Explorer Profile Error'],
])('the transaction rejects a cache/profile that %s before writing', async (_, change, title) => {
  await mount(); await position(fix()); change(); await press('Excavate treasure');
  expect(mockTransaction.set).not.toHaveBeenCalled(); expect(mockTransaction.update).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith(title, expect.any(String));
});

test('rejects a GPS fix that expires during transaction reads', async () => {
  const get = mockTransaction.get.getMockImplementation();
  mockTransaction.get.mockImplementation(async ref => {
    if (ref.path.startsWith('treasures/')) jest.advanceTimersByTime(13_000);
    return get(ref);
  });
  await mount(); await position(fix()); await press('Excavate treasure');
  expect(mockTransaction.set).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Fresh Location Required', expect.any(String));
});

test('an existing discovery is displayed without awarding duplicate points', async () => {
  await mount(); await position(fix()); mockStoredDiscovery = {};
  await press('Excavate treasure'); expect(mockTransaction.update).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Excavation complete')).toBeDisabled();
});

test('tap and shake cannot start two concurrent excavations', async () => {
  let finish; runTransaction.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await position(fix()); const shake = mockShakes.at(-1);
  await act(() => { shake({ x: 3, y: 0, z: 0 }); shake({ x: 3, y: 0, z: 0 }); });
  expect(runTransaction).toHaveBeenCalledTimes(1);
  await act(() => finish(1100));
});

test('ordinary movement and malformed motion readings do not excavate', async () => {
  await mount(); await position(fix()); const shake = mockShakes.at(-1);
  await act(() => { shake({ x: 0, y: 0, z: 1 }); shake({ x: Infinity, y: 0, z: 0 }); });
  expect(runTransaction).not.toHaveBeenCalled();
});

test('sensitive shake preference is applied and haptics can be disabled', async () => {
  await mount({}, treasure(), profile({ motionSensitivityEnabled: true, hapticFeedbackEnabled: false }));
  await position(fix()); await act(() => mockShakes.at(-1)({ x: 2, y: 0, z: 0 }));
  expect(runTransaction).toHaveBeenCalledTimes(1); expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

test('tap excavation remains available when the motion sensor fails to start', async () => {
  Accelerometer.addListener.mockImplementationOnce(() => { throw new Error('sensor unavailable'); });
  await mount(); await position(fix()); await press('Excavate treasure');
  expect(mockTransaction.update).toHaveBeenCalledTimes(1);
});

test('denied motion permission leaves tap excavation available', async () => {
  Accelerometer.getPermissionsAsync.mockResolvedValue(permission(false));
  await mount(); await position(fix()); await press('Excavate treasure');
  expect(mockTransaction.update).toHaveBeenCalledTimes(1);
});

test('iOS location permission prompts survive inactive/active without restarting the request', async () => {
  Location.getForegroundPermissionsAsync.mockResolvedValue(permission(false));
  let grant; Location.requestForegroundPermissionsAsync.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
  await mount(); expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  await press('ENABLE LOCATION');
  await act(() => { stateChange('inactive'); stateChange('active'); });
  await act(() => grant(permission(true)));
  expect(mockPositions).toHaveLength(1); await position(fix());
  expect(screen.getByLabelText('Excavate treasure')).toBeEnabled();
});

test('backgrounding blocks queued shake callbacks and starts with a new fix after resume', async () => {
  await mount(); await position(fix()); const oldShake = mockShakes.at(-1), oldPosition = mockPositions.at(-1).next;
  await act(() => stateChange('background'));
  await act(() => { oldShake({ x: 3, y: 0, z: 0 }); oldPosition(fix()); });
  expect(runTransaction).not.toHaveBeenCalled(); expect(mockLocationRemove).toHaveBeenCalled();
  await act(() => { stateChange('inactive'); stateChange('active'); });
  expect(screen.queryByLabelText('Excavate treasure')).toBeNull();
  await position(fix()); expect(screen.getByLabelText('Excavate treasure')).toBeEnabled();
});

test('late excavation results cannot unlock a newly selected target', async () => {
  let finish; const onSuccess = jest.fn(); runTransaction.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const result = await mount({ onSuccess }); await position(fix()); await press('Excavate treasure');
  await result.rerender(<HuntScreen treasureId="cache-b" onSuccess={onSuccess} />);
  await emit('cache-b', treasure({ title: 'Second cache' })); await position(fix());
  await act(() => finish(1100));
  expect(onSuccess).not.toHaveBeenCalled(); expect(screen.getByLabelText('Excavate treasure')).toBeEnabled();
});

test('late results after an account change cannot reveal the previous account discovery', async () => {
  let finish; const onSuccess = jest.fn(); runTransaction.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount({ onSuccess }); await position(fix()); await press('Excavate treasure');
  await act(() => { mockAuth.currentUser = { uid: 'other' }; mockAuthChange(mockAuth.currentUser); });
  await emit(); await act(() => finish(1100));
  expect(onSuccess).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Excavation complete')).toBeNull();
});

test('transaction failure leaves excavation available for retry', async () => {
  runTransaction.mockRejectedValueOnce(new Error('unavailable'));
  await mount(); await position(fix()); await press('Excavate treasure');
  expect(Alert.alert).toHaveBeenLastCalledWith('Excavation Failed', expect.any(String));
  expect(screen.getByLabelText('Excavate treasure')).toBeEnabled();
});

test('a failed success callback does not report a saved discovery as failed', async () => {
  await mount({ onSuccess: () => { throw new Error('navigation unavailable'); } });
  await position(fix()); await press('Excavate treasure');
  expect(screen.getByLabelText('Excavation complete')).toBeDisabled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('GPS startup and no-fix timeouts offer recovery instead of an endless spinner', async () => {
  Location.watchPositionAsync.mockImplementationOnce(pending);
  await mount(); await act(() => jest.advanceTimersByTime(10_000));
  expect(screen.getByLabelText('RETRY LOCATION')).toBeEnabled();
});

test('compass registration timeout falls back to bearing and removes a late subscription', async () => {
  let finish; Location.watchHeadingAsync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await act(() => jest.advanceTimersByTime(8_000));
  expect(screen.getByText('COMPASS UNAVAILABLE · USE BEARING')).toBeTruthy();
  await act(() => finish({ remove: mockHeadingRemove })); expect(mockHeadingRemove).toHaveBeenCalled();
});

test('compass uses true north, supports magnetic fallback, and clears stale heading after an error', async () => {
  await mount(); await position(fix());
  await act(() => mockHeadings.at(-1).next({ trueHeading: 90, magHeading: 80, accuracy: 3 }));
  expect(screen.getByText('TRUE NORTH · COMPASS READY')).toBeTruthy();
  await act(() => mockHeadings.at(-1).next({ trueHeading: -1, magHeading: 80, accuracy: 2 }));
  expect(screen.getByText('MAGNETIC NORTH · COMPASS READY')).toBeTruthy();
  await act(() => mockHeadings.at(-1).error('interrupted'));
  expect(screen.getByText('COMPASS INTERRUPTED · USE BEARING')).toBeTruthy();
});

test('malformed treasure text is safe to render and the photo modal supports landscape', async () => {
  await mount({}, treasure({ title: 123, hint: {}, payloadText: {}, imageUrl: 'https://example.com/field.png' }));
  await press('Inspect field photo');
  expect(screen.getByTestId('hunt-photo-modal')).toHaveProp('supportedOrientations', expect.arrayContaining(['landscape-left', 'landscape-right']));
});

test('a missing target and a missing session present recoverable errors', async () => {
  const result = await render(<HuntScreen onBack={jest.fn()} />);
  expect(screen.getByText(/No target ID was supplied/)).toBeTruthy();
  await result.unmount(); mockAuth.currentUser = null;
  await render(<HuntScreen treasureId="cache-id" onBack={jest.fn()} />);
  expect(screen.getByText(/session has expired/)).toBeTruthy();
});

test('iOS headings align with both landscape orientations', async () => {
  ScreenOrientation.getOrientationAsync.mockResolvedValueOnce(ScreenOrientation.Orientation.LANDSCAPE_LEFT);
  await mount(); await position(fix());
  await act(() => mockHeadings.at(-1).next({ trueHeading: 90, magHeading: 80, accuracy: 3 }));
  expect(screen.getByLabelText(/^Treasure compass\./)).toHaveProp('accessibilityLabel', expect.stringContaining('Device heading 0 degrees N.'));
  await act(() => mockOrientationChange({ orientationInfo: { orientation: ScreenOrientation.Orientation.LANDSCAPE_RIGHT } }));
  await act(() => mockHeadings.at(-1).next({ trueHeading: 270, magHeading: 260, accuracy: 3 }));
  expect(screen.getByLabelText(/^Treasure compass\./)).toHaveProp('accessibilityLabel', expect.stringContaining('Device heading 0 degrees N.'));
});

test('new GPS updates remain fresh between the two-second freshness ticks', async () => {
  await mount(); await act(() => jest.advanceTimersByTime(1_500)); await position(fix());
  expect(screen.getByLabelText('Excavate treasure')).toBeEnabled();
});

test('stalled heading updates expire to the numerical bearing fallback', async () => {
  await mount(); await position(fix());
  await act(() => mockHeadings.at(-1).next({ trueHeading: 90, magHeading: 80, accuracy: 3 }));
  await act(() => jest.advanceTimersByTime(8_000));
  expect(screen.getByText('COMPASS UNAVAILABLE · USE BEARING')).toBeTruthy();
});

test('low calibration is identified rather than reported as compass ready', async () => {
  await mount(); await act(() => mockHeadings.at(-1).next({ trueHeading: 90, magHeading: 80, accuracy: 1 }));
  expect(screen.getByText('TRUE NORTH · CALIBRATION LOW')).toBeTruthy();
});

test('backgrounding during transaction reads prevents all discovery writes', async () => {
  const get = mockTransaction.get.getMockImplementation();
  mockTransaction.get.mockImplementation(async ref => {
    if (ref.path.startsWith('treasures/')) stateChange('background');
    return get(ref);
  });
  await mount(); await position(fix()); await press('Excavate treasure');
  expect(mockTransaction.set).not.toHaveBeenCalled(); expect(mockTransaction.update).not.toHaveBeenCalled();
});

test('old location callbacks cannot affect the target after a retry', async () => {
  await mount(); await position(fix()); const old = mockPositions.at(-1);
  await act(() => old.error('interrupted')); await press('RETRY LOCATION');
  await position(fix());
  await act(() => old.next(fix({ coords: { latitude: 0, longitude: 0, accuracy: 5 } })));
  expect(screen.getByLabelText('Excavate treasure')).toBeEnabled();
});

test('terminated Firestore listeners cannot restore old target state after retry', async () => {
  await mount(); const old = mockObservers.get('treasures/cache-id');
  await act(() => old.error(new Error('unavailable'))); await press('Retry Hunt synchronisation');
  await emit(); await position(fix());
  await act(() => old.next(snapshot(treasure({ isArchived: true }))));
  expect(screen.getByLabelText('Excavate treasure')).toBeEnabled();
});
