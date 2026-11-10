import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Alert, Linking } from 'react-native';
import { DashboardScreen } from '../src/screens/DashboardScreen';
import { useDashboardLocation } from '../src/hooks/useDashboardLocation';
import { auth as mockAuth } from '../src/config/firebase';

let mockAuthChange;
let mockMapProps;
const mockSetView = jest.fn();
const mockObservers = new Map();
let mockBatch;

jest.mock('../src/config/firebase', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: (_, callback) => {
  mockAuthChange = callback;
  callback(mockAuth.currentUser);
  return jest.fn();
} }));
jest.mock('firebase/firestore', () => ({
  collection: (_, path) => ({ path }),
  doc: (parent, ...parts) => ({ path: parts.length ? parts.join('/') : `${parent.path}/event` }),
  query: reference => reference, where: jest.fn(), orderBy: jest.fn(), limit: jest.fn(),
  serverTimestamp: () => 'server-timestamp', writeBatch: () => mockBatch,
  onSnapshot: (reference, next, error) => {
    const unsubscribe = jest.fn();
    mockObservers.set(reference.path, { next, error, unsubscribe });
    return unsubscribe;
  },
}));
jest.mock('../src/hooks/useDashboardLocation', () => ({
  ...jest.requireActual('../src/hooks/useDashboardLocation'), useDashboardLocation: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 44, bottom: 21, left: 44 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('../src/components/FieldMap', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: React.forwardRef((props, ref) => {
    mockMapProps = props;
    React.useImperativeHandle(ref, () => ({ setView: mockSetView }));
    React.useEffect(() => { props.onReady?.(); }, [props.onReady]);
    return <View testID="field-map" />;
  }) };
});

const treasure = (changes = {}) => ({
  treasureId: 'incorrect-embedded-id', creatorId: 'another-explorer', creatorName: 'Angie',
  title: 'Campus cache', hint: 'Look by the tree', isArchived: false,
  location: { latitude: -25.89, longitude: 28.18 }, ...changes,
});
const emitTreasures = async (entries = [['cache-id', treasure()]]) => act(() => {
  mockObservers.get('treasures').next({ forEach: callback => entries.forEach(([id, data]) => callback({ id, data: () => data })) });
});
const emitProfile = async data => act(() => mockObservers.get('users/explorer').next({ exists: () => true, data: () => data }));
const press = label => fireEvent.press(screen.getByLabelText(label));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-10T10:00:00Z'));
  mockObservers.clear();
  mockAuth.currentUser = { uid: 'explorer', displayName: 'Explorer', email: 'explorer@example.com' };
  mockBatch = { update: jest.fn(), set: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
  useDashboardLocation.mockReturnValue({
    userLocation: { coords: { latitude: -25.89, longitude: 28.18, accuracy: 8 }, timestamp: Date.now() },
    locationFixSource: 'live', isInitialisingLocation: false, locationError: null,
    locationPermissionStatus: 'granted', canAskLocationAgain: true, locationServicesEnabled: true,
    startLocationService: jest.fn(),
  });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  await cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('renders only valid nearby caches and uses the document path as the target ID', async () => {
  await render(<DashboardScreen onNavigate={jest.fn()} />);
  await emitTreasures([
    ['cache-id', treasure()],
    ['invalid', treasure({ location: { latitude: NaN, longitude: 0 } })],
    ['distant', treasure({ location: { latitude: 0, longitude: 0 } })],
  ]);
  expect(mockMapProps.treasures).toEqual([expect.objectContaining({ id: 'cache-id', title: 'Campus cache' })]);
  expect(mockSetView).toHaveBeenCalledWith(expect.objectContaining({ latitude: -25.89, longitude: 28.18 }), false);
});

test('updates open treasure details after an edit and navigates to the latest target', async () => {
  const navigate = jest.fn();
  await render(<DashboardScreen onNavigate={navigate} />);
  await emitTreasures();
  await act(() => mockMapProps.onTreasurePress('cache-id'));
  expect(screen.getByText('CAMPUS CACHE')).toBeTruthy();
  expect(screen.getByTestId('dashboard-treasure-modal').props.supportedOrientations).toEqual(expect.arrayContaining(['landscape-left', 'landscape-right']));
  expect(screen.queryByLabelText('Archive treasure')).toBeNull();
  await emitTreasures([['cache-id', treasure({ title: 'Updated cache', hint: 'Updated clue' })]]);
  expect(screen.getByText('UPDATED CACHE')).toBeTruthy();
  expect(screen.getByText('Updated clue')).toBeTruthy();
  await press('Track treasure in Hunt');
  expect(navigate).toHaveBeenCalledWith('HUNT', expect.objectContaining({ treasureId: 'cache-id', mode: 'hunt' }));
});

test('closes the detail sheet when another explorer removes the cache', async () => {
  await render(<DashboardScreen onNavigate={jest.fn()} />);
  await emitTreasures();
  await act(() => mockMapProps.onTreasurePress('cache-id'));
  await emitTreasures([]);
  expect(screen.queryByLabelText('Track treasure in Hunt')).toBeNull();
});

test('handles malformed Firestore text and scores without crashing', async () => {
  await render(<DashboardScreen onNavigate={jest.fn()} />);
  await emitProfile({ username: { invalid: true }, totalPoints: Infinity });
  await emitTreasures([['cache-id', treasure({ title: 123, hint: {}, imageUrl: 999, creatorName: [] })]]);
  await act(() => mockObservers.get('activity_feed').next({ forEach: callback => callback({
    id: 'activity', data: () => ({ username: {}, message: {}, createdAt: {} }),
  }) }));
  await act(() => mockMapProps.onTreasurePress('cache-id'));
  expect(screen.getByText('TREASURE CACHE')).toBeTruthy();
  expect(screen.getByText('UNKNOWN EXPLORER')).toBeTruthy();
});

test('stamps a current position and throttles rapid navigation', async () => {
  const navigate = jest.fn();
  await render(<DashboardScreen onNavigate={navigate} />);
  await press('Stamp current location');
  expect(navigate).toHaveBeenCalledWith('INVENTORY', { mode: 'create', latitude: -25.89, longitude: 28.18 });
  await press('Explorer leaderboard');
  expect(navigate).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTime(600));
  await press('Explorer leaderboard');
  expect(navigate).toHaveBeenLastCalledWith('LEADERBOARD', undefined);
});

test('prevents stamping cached, interrupted or stale positions', async () => {
  const navigate = jest.fn();
  const location = useDashboardLocation();
  useDashboardLocation.mockReturnValue({ ...location, locationFixSource: 'cached' });
  const result = await render(<DashboardScreen onNavigate={navigate} />);
  expect(screen.getByLabelText('Stamp current location')).toBeDisabled();
  useDashboardLocation.mockReturnValue({ ...location, userLocation: { ...location.userLocation, timestamp: Date.now() - 121_000 } });
  await result.rerender(<DashboardScreen onNavigate={navigate} />);
  expect(screen.getByLabelText('Stamp current location')).toBeDisabled();
  useDashboardLocation.mockReturnValue({ ...location, locationError: 'Updates interrupted' });
  await result.rerender(<DashboardScreen onNavigate={navigate} />);
  expect(screen.getByLabelText('Stamp current location')).toBeDisabled();
  expect(navigate).not.toHaveBeenCalled();
});

test('requires iOS low-accuracy confirmation and rejects a fix that expires while the alert is open', async () => {
  const navigate = jest.fn();
  const location = useDashboardLocation();
  useDashboardLocation.mockReturnValue({ ...location,
    userLocation: { ...location.userLocation, coords: { ...location.userLocation.coords, accuracy: 500 } } });
  await render(<DashboardScreen onNavigate={navigate} />);
  await press('Stamp current location');
  expect(navigate).not.toHaveBeenCalled();
  const buttons = Alert.alert.mock.calls.at(-1)[2];
  expect(buttons[0].style).toBe('cancel');
  await act(() => jest.advanceTimersByTime(121_000));
  await act(() => buttons[1].onPress());
  expect(navigate).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('LOCATION TOO OLD', expect.any(String), undefined);
});

test('archives an owned cache and activity atomically, once even on duplicate confirmation', async () => {
  let finishCommit;
  mockBatch.commit.mockImplementation(() => new Promise(resolve => { finishCommit = resolve; }));
  await render(<DashboardScreen onNavigate={jest.fn()} />);
  await emitTreasures([['cache-id', treasure({ creatorId: 'explorer' })]]);
  await act(() => mockMapProps.onTreasurePress('cache-id'));
  await press('Archive treasure');
  const confirm = Alert.alert.mock.calls.at(-1)[2][1].onPress;
  await act(() => { confirm(); confirm(); });
  expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  expect(mockBatch.update).toHaveBeenCalledWith({ path: 'treasures/cache-id' }, { isArchived: true, updatedAt: 'server-timestamp' });
  expect(mockBatch.set).toHaveBeenCalledWith({ path: 'activity_feed/event' }, expect.objectContaining({ type: 'TREASURE_ARCHIVED', targetId: 'cache-id', userId: 'explorer' }));
  await act(() => finishCommit());
  expect(mockMapProps.treasures).toEqual([]);
});

test('rejects location confirmation after backgrounding invalidates the fix', async () => {
  const navigate = jest.fn();
  const location = useDashboardLocation();
  useDashboardLocation.mockReturnValue({ ...location,
    userLocation: { ...location.userLocation, coords: { ...location.userLocation.coords, accuracy: 500 } } });
  const result = await render(<DashboardScreen onNavigate={navigate} />);
  await press('Stamp current location');
  const confirm = Alert.alert.mock.calls.at(-1)[2][1].onPress;
  useDashboardLocation.mockReturnValue({ ...location, locationFixSource: 'cached' });
  await result.rerender(<DashboardScreen onNavigate={navigate} />);
  await act(() => confirm());
  expect(navigate).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('CURRENT LOCATION REQUIRED', expect.any(String), undefined);
});

test('does not archive after the account signs out while confirmation is open', async () => {
  await render(<DashboardScreen onNavigate={jest.fn()} />);
  await emitTreasures([['cache-id', treasure({ creatorId: 'explorer' })]]);
  await act(() => mockMapProps.onTreasurePress('cache-id'));
  await press('Archive treasure');
  const confirm = Alert.alert.mock.calls.at(-1)[2][1].onPress;
  await act(() => { mockAuth.currentUser = null; mockAuthChange(null); });
  await act(() => confirm());
  expect(mockBatch.commit).not.toHaveBeenCalled();
});

test('keeps a failed archive available for retry', async () => {
  mockBatch.commit.mockRejectedValue(new Error('permission-denied'));
  await render(<DashboardScreen onNavigate={jest.fn()} />);
  await emitTreasures([['cache-id', treasure({ creatorId: 'explorer' })]]);
  await act(() => mockMapProps.onTreasurePress('cache-id'));
  await press('Archive treasure');
  await act(() => Alert.alert.mock.calls.at(-1)[2][1].onPress());
  expect(Alert.alert).toHaveBeenLastCalledWith('ARCHIVE FAILED', expect.any(String), undefined);
  expect(screen.getByLabelText('Archive treasure')).toBeEnabled();
  expect(mockMapProps.treasures).toHaveLength(1);
});

test('retries terminated Firestore subscriptions and ignores callbacks from old listeners', async () => {
  await render(<DashboardScreen onNavigate={jest.fn()} />);
  const oldObserver = mockObservers.get('treasures');
  await act(() => oldObserver.error(new Error('unavailable')));
  await press('Retry field sync');
  expect(oldObserver.unsubscribe).toHaveBeenCalledTimes(1);
  await emitTreasures();
  await act(() => oldObserver.next({ forEach: () => {} }));
  expect(mockMapProps.treasures).toHaveLength(1);
});

test('opens iOS app settings when location permission cannot be requested again', async () => {
  useDashboardLocation.mockReturnValue({ ...useDashboardLocation(),
    userLocation: null, locationFixSource: 'none', locationPermissionStatus: 'denied',
    canAskLocationAgain: false, locationError: 'Location permission denied' });
  await render(<DashboardScreen onNavigate={jest.fn()} />);
  await press('OPEN SETTINGS');
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
});

test('clears prior account data and closes details when the authenticated account changes', async () => {
  await render(<DashboardScreen onNavigate={jest.fn()} />);
  await emitTreasures();
  await act(() => mockMapProps.onTreasurePress('cache-id'));
  const oldObserver = mockObservers.get('treasures');
  await act(() => { mockAuth.currentUser = { uid: 'other' }; mockAuthChange(mockAuth.currentUser); });
  expect(mockMapProps.treasures).toEqual([]);
  expect(screen.queryByLabelText('Track treasure in Hunt')).toBeNull();
  expect(oldObserver.unsubscribe).toHaveBeenCalledTimes(1);
});
