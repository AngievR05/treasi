import { act, cleanup, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { isFreshLocation, useDashboardLocation } from '../src/hooks/useDashboardLocation';

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(), requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(), getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(), watchPositionAsync: jest.fn(),
}));

const permission = (granted, canAskAgain = true) => ({
  granted, canAskAgain, status: granted ? 'granted' : 'denied', expires: 'never',
});
const position = (offset = 0) => ({
  coords: { latitude: -25.89, longitude: 28.18, accuracy: 8 }, timestamp: Date.now() + offset,
});
const pending = () => new Promise(() => {});
let appStateChange, updates, watcherError, remove;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-10T10:00:00Z'));
  remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => {
    appStateChange = callback;
    return { remove: jest.fn() };
  });
  Location.getForegroundPermissionsAsync.mockResolvedValue(permission(true));
  Location.hasServicesEnabledAsync.mockResolvedValue(true);
  Location.getLastKnownPositionAsync.mockResolvedValue(null);
  Location.getCurrentPositionAsync.mockImplementation(pending);
  Location.watchPositionAsync.mockImplementation(async (_, onUpdate, onError) => {
    updates = onUpdate;
    watcherError = onError;
    return { remove };
  });
});

afterEach(async () => {
  await cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('starts tracking without waiting for a stalled one-shot GPS request', async () => {
  const { result } = await renderHook(useDashboardLocation);
  expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
  await act(() => updates(position()));
  expect(result.current.locationFixSource).toBe('live');
  expect(result.current.isInitialisingLocation).toBe(false);
  expect(result.current.locationError).toBeNull();
});

test('offers recovery after GPS times out and recovers on a later valid update', async () => {
  const { result } = await renderHook(useDashboardLocation);
  await act(() => jest.advanceTimersByTime(15_000));
  expect(result.current.isInitialisingLocation).toBe(false);
  expect(result.current.locationError).toContain('NO CURRENT GPS FIX');
  await act(() => updates(position()));
  expect(result.current.locationError).toBeNull();
  expect(result.current.locationFixSource).toBe('live');
});

test('does not prompt automatically and keeps the iOS permission prompt alive across inactive/active', async () => {
  Location.getForegroundPermissionsAsync.mockResolvedValue(permission(false));
  let resolvePermission;
  Location.requestForegroundPermissionsAsync.mockImplementation(() => new Promise(resolve => { resolvePermission = resolve; }));
  const { result } = await renderHook(useDashboardLocation);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  let request;
  await act(() => { request = result.current.startLocationService(true); });
  await act(() => { appStateChange('inactive'); appStateChange('active'); });
  await act(async () => { resolvePermission(permission(true)); await request; });
  expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
  await act(() => updates(position()));
  expect(result.current.locationFixSource).toBe('live');
});

test('stops in the background and restarts after returning through inactive', async () => {
  const { result } = await renderHook(useDashboardLocation);
  await act(() => updates(position()));
  const oldUpdate = updates;
  await act(() => appStateChange('background'));
  expect(remove).toHaveBeenCalledTimes(1);
  expect(result.current.locationFixSource).toBe('cached');
  await act(() => oldUpdate(position()));
  expect(result.current.locationFixSource).toBe('cached');
  await act(() => { appStateChange('inactive'); appStateChange('active'); });
  expect(Location.watchPositionAsync).toHaveBeenCalledTimes(2);
  await act(() => updates(position()));
  expect(result.current.locationFixSource).toBe('live');
});

test('ignores callbacks from an earlier request, including its error callback', async () => {
  const { result } = await renderHook(useDashboardLocation);
  const oldUpdate = updates, oldError = watcherError;
  await act(() => result.current.startLocationService(false));
  await act(() => updates(position()));
  await act(() => { oldUpdate({ ...position(), coords: { latitude: 1, longitude: 1 } }); oldError('stale error'); });
  expect(result.current.userLocation.coords.latitude).toBe(-25.89);
  expect(result.current.locationError).toBeNull();
});

test('a late cached result cannot downgrade a live location', async () => {
  let resolveCache;
  Location.getLastKnownPositionAsync.mockImplementation(() => new Promise(resolve => { resolveCache = resolve; }));
  const { result } = await renderHook(useDashboardLocation);
  await act(() => updates(position()));
  await act(() => resolveCache(position(-30_000)));
  expect(result.current.locationFixSource).toBe('live');
});

test('rejects malformed timestamps and older one-shot results', async () => {
  let resolvePosition;
  Location.getCurrentPositionAsync.mockImplementation(() => new Promise(resolve => { resolvePosition = resolve; }));
  const { result } = await renderHook(useDashboardLocation);
  await act(() => updates({ ...position(), timestamp: NaN }));
  expect(result.current.userLocation).toBeNull();
  await act(() => updates(position()));
  const newest = result.current.userLocation;
  await act(() => resolvePosition(position(-1_000)));
  expect(result.current.userLocation).toBe(newest);
});

test('expires a live fix when the GPS stops updating', async () => {
  const { result } = await renderHook(useDashboardLocation);
  await act(() => updates(position()));
  await act(() => jest.advanceTimersByTime(135_000));
  expect(result.current.locationFixSource).toBe('cached');
  expect(result.current.locationError).toContain('OUT OF DATE');
});

test('cleans up a subscription that finishes registering after unmount', async () => {
  let finishRegistration;
  Location.watchPositionAsync.mockImplementation(() => new Promise(resolve => { finishRegistration = resolve; }));
  const { unmount } = await renderHook(useDashboardLocation);
  await unmount();
  await act(() => finishRegistration({ remove }));
  expect(remove).toHaveBeenCalledTimes(1);
});

test('location services off clears the fix and gives iOS recovery guidance', async () => {
  Location.hasServicesEnabledAsync.mockResolvedValue(false);
  const { result } = await renderHook(useDashboardLocation);
  expect(result.current.locationError).toContain('PRIVACY & SECURITY');
  expect(result.current.userLocation).toBeNull();
  expect(result.current.isInitialisingLocation).toBe(false);
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
});

test('removes a watcher that registers after its timeout and leaves location retryable', async () => {
  let finishRegistration;
  Location.watchPositionAsync.mockImplementation(() => new Promise(resolve => { finishRegistration = resolve; }));
  const { result } = await renderHook(useDashboardLocation);
  await act(() => jest.advanceTimersByTime(10_000));
  expect(result.current.isInitialisingLocation).toBe(false);
  expect(result.current.locationError).toContain('COULD NOT BE STARTED');
  await act(() => finishRegistration({ remove }));
  expect(remove).toHaveBeenCalledTimes(1);
});

test('an interrupted iOS watcher invalidates a live fix and can recover', async () => {
  const { result } = await renderHook(useDashboardLocation);
  await act(() => updates(position()));
  await act(() => watcherError('interrupted'));
  expect(result.current.locationFixSource).toBe('cached');
  expect(result.current.locationError).toContain('INTERRUPTED');
  await act(() => updates(position()));
  expect(result.current.locationFixSource).toBe('live');
  expect(result.current.locationError).toBeNull();
});

test('freshness rejects invalid coordinates, future timestamps, and stale fixes', () => {
  expect(isFreshLocation(position())).toBe(true);
  expect(isFreshLocation(position(-120_001))).toBe(false);
  expect(isFreshLocation(position(60_000))).toBe(false);
  expect(isFreshLocation({ ...position(), coords: { latitude: 95, longitude: 0 } })).toBe(false);
});
