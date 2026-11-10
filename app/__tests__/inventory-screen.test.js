import { observeKeyboard } from './helpers/keyboard';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Alert, Keyboard, Linking } from 'react-native';
import { auth as mockAuth } from '../src/config/firebase';
import { runTransaction } from 'firebase/firestore';
import { useDashboardLocation } from '../src/hooks/useDashboardLocation';
import { InventoryScreen } from '../src/screens/InventoryScreen';

let mockAuthChange, mockBatch, mockTransaction, mockStoredCache, mockNextId;
const mockObservers = new Map();
const mockPressHandlers = new Map();
const nativeModule = require('react-native');
const RealPressable = nativeModule.Pressable;
jest.mock('../src/config/firebase', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: (_, callback) => { mockAuthChange = callback; callback(mockAuth.currentUser); return jest.fn(); } }));
jest.mock('firebase/firestore', () => ({
  collection: (_, path) => ({ path }),
  doc: (parent, ...parts) => {
    const id = parts.at(-1) || `new-${++mockNextId}`;
    return { path: parts.length ? parts.join('/') : `${parent.path}/${id}`, id };
  },
  where: (field, _, value) => ({ field, value }),
  query: (reference, filter) => ({ ...reference, key: `${reference.path}:${filter.field}` }),
  GeoPoint: class { constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; } },
  serverTimestamp: () => 'server-timestamp', writeBatch: () => mockBatch, runTransaction: jest.fn(),
  onSnapshot: (reference, next, error) => {
    const unsubscribe = jest.fn(); mockObservers.set(reference.key || reference.path, { next, error, unsubscribe }); return unsubscribe;
  },
}));
jest.mock('../src/hooks/useDashboardLocation', () => ({
  ...jest.requireActual('../src/hooks/useDashboardLocation'), useDashboardLocation: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, left: 44, right: 44, bottom: 21 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const cache = (changes = {}) => ({
  treasureId: 'wrong-embedded-id', title: 'OWN CACHE', creatorId: 'explorer', creatorName: 'EXPLORER',
  hint: 'Beside the tree', payloadText: 'Secret reward', location: { latitude: -25.89, longitude: 28.18 },
  isArchived: false, ...changes,
});
const snapshot = data => ({ exists: () => data != null, data: () => data });
const querySnapshot = entries => {
  const docs = entries.map(([id, data]) => ({ id, data: () => data }));
  return { docs, forEach: callback => docs.forEach(callback) };
};
const emit = async (entries = [['own-id', cache()]], found = []) => act(() => {
  mockObservers.get(`users/${mockAuth.currentUser.uid}`).next(snapshot({ uid: mockAuth.currentUser.uid, username: 'EXPLORER' }));
  mockObservers.get('treasures:isArchived').next(querySnapshot(entries.filter(([, data]) => !data.isArchived)));
  mockObservers.get('treasures:creatorId').next(querySnapshot(entries.filter(([, data]) => data.creatorId === mockAuth.currentUser.uid)));
  mockObservers.get('discoveries:hunterId').next(querySnapshot(found.map(id => [`found-${id}`, { treasureId: id }])));
});
const mount = async (props = {}, entries, found) => {
  const result = await render(<InventoryScreen onBack={jest.fn()} onNavigate={jest.fn()} {...props} />);
  await emit(entries, found); return result;
};
const button = label => screen.getAllByRole('button', { name: label })[0];
const press = label => fireEvent.press(button(label));
const pressHandler = label => {
  const handler = mockPressHandlers.get(label);
  if (!handler) throw new Error(`No press handler for ${label}`);
  return handler;
};
const change = (label, value) => fireEvent.changeText(screen.getByLabelText(label), value);
const openCreate = async () => press('Bury a new cache');
const fillCreate = async (values = {}) => {
  await change('Cache title', values.title ?? 'New cache');
  await change('Cache clue', values.hint ?? 'A clue');
  await change('Secret payload', values.payload ?? 'A reward');
  await change('Cache latitude', values.latitude ?? '-25.890000');
  await change('Cache longitude', values.longitude ?? '28.180000');
};

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-10T10:00:00Z'));
  mockAuth.currentUser = { uid: 'explorer', displayName: 'EXPLORER', email: 'explorer@example.com' };
  mockObservers.clear(); mockNextId = 0; mockStoredCache = cache();
  mockPressHandlers.clear();
  // Preserve native Pressable behaviour while retaining queued callbacks for race-condition tests.
  jest.spyOn(nativeModule, 'Pressable', 'get').mockReturnValue(props => {
    mockPressHandlers.set(props.accessibilityLabel, props.onPress);
    return <RealPressable {...props} />;
  });
  mockBatch = { set: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
  mockTransaction = { get: jest.fn(async () => snapshot(mockStoredCache)), update: jest.fn(), set: jest.fn(), delete: jest.fn() };
  runTransaction.mockReset().mockImplementation(async (_, callback) => callback(mockTransaction));
  useDashboardLocation.mockReturnValue({
    userLocation: { coords: { latitude: -25.89, longitude: 28.18, accuracy: 8 }, timestamp: Date.now() },
    locationFixSource: 'live', isInitialisingLocation: false, locationError: null,
    locationPermissionStatus: 'granted', canAskLocationAgain: true, locationServicesEnabled: true,
    startLocationService: jest.fn(),
  });
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => { await cleanup(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('loads nearby active caches and keeps distant owned archives manageable', async () => {
  await mount({}, [
    ['own-id', cache()],
    ['nearby', cache({ title: 'NEARBY', creatorId: 'other' })],
    ['distant', cache({ title: 'DISTANT', creatorId: 'other', location: { latitude: 0, longitude: 0 } })],
    ['archive', cache({ title: 'OWN ARCHIVE', isArchived: true, location: { latitude: 0, longitude: 0 } })],
  ]);
  expect(screen.getByRole('button', { name: /^NEARBY\. FIELD TARGET/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^OWN ARCHIVE\. MY ARCHIVED CACHE/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^DISTANT\./ })).toBeNull();
});

test('creates a cache and its activity atomically, then selects the committed record', async () => {
  await mount(); await openCreate(); await fillCreate(); await press('Seal and bury cache');
  expect(mockBatch.commit).toHaveBeenCalledTimes(1); expect(mockBatch.set).toHaveBeenCalledTimes(2);
  const [reference, data] = mockBatch.set.mock.calls[0];
  expect(data).toEqual(expect.objectContaining({ treasureId: reference.id, creatorId: 'explorer', title: 'NEW CACHE', hint: 'A clue', payloadText: 'A reward', isArchived: false,
    location: { latitude: -25.89, longitude: 28.18 } }));
  expect(mockBatch.set.mock.calls[1][1]).toEqual(expect.objectContaining({ type: 'TREASURE_HIDDEN', targetId: reference.id }));
  expect(screen.getByLabelText('Edit NEW CACHE')).toBeTruthy();
});

test.each([
  ['missing title', { title: '' }], ['short title', { title: 'ab' }],
  ['uppercase title expansion', { title: 'ß'.repeat(41) }],
  ['invalid latitude', { latitude: '91' }], ['invalid longitude', { longitude: '-181' }],
  ['hexadecimal latitude', { latitude: '0x10' }], ['blank latitude', { latitude: '' }],
  ['oversized clue', { hint: 'x'.repeat(501) }], ['oversized payload', { payload: 'x'.repeat(1001) }],
])('rejects %s without writing a cache', async (_, values) => {
  await mount(); await openCreate(); await fillCreate(values); await press('Seal and bury cache');
  expect(mockBatch.commit).not.toHaveBeenCalled();
});

test('accepts decimal commas from an iOS coordinate keyboard', async () => {
  await mount(); await openCreate(); await fillCreate({ latitude: '-25,89', longitude: '28,18' });
  await press('Seal and bury cache');
  expect(mockBatch.set.mock.calls[0][1].location).toEqual({ latitude: -25.89, longitude: 28.18 });
});

test('a failed creation preserves the draft and permits retry', async () => {
  mockBatch.commit.mockRejectedValueOnce(new Error('unavailable'));
  await mount(); await openCreate(); await fillCreate(); await press('Seal and bury cache');
  expect(screen.getByLabelText('Cache title')).toHaveProp('value', 'New cache');
  expect(screen.getByLabelText('Seal and bury cache')).toBeEnabled();
  await press('Seal and bury cache'); expect(mockBatch.commit).toHaveBeenCalledTimes(2);
});

test('a second tap cannot create a duplicate cache while a save is pending', async () => {
  let finish; mockBatch.commit.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await openCreate(); await fillCreate();
  const handler = pressHandler('Seal and bury cache');
  await act(() => { handler(); handler(); });
  expect(mockBatch.commit).toHaveBeenCalledTimes(1); await act(() => finish());
});

test('Dashboard-stamped coordinates remain intact when GPS has a different position', async () => {
  await mount({ initialParams: { mode: 'create', latitude: -26, longitude: 29 } });
  expect(screen.getByLabelText('Cache latitude')).toHaveProp('value', '-26.000000');
  expect(screen.getByLabelText('Cache longitude')).toHaveProp('value', '29.000000');
});

test('live GPS updates do not overwrite coordinates the user typed manually', async () => {
  const result = await mount(); await openCreate(); await change('Cache latitude', '-26'); await change('Cache longitude', '29');
  const gps = useDashboardLocation();
  useDashboardLocation.mockReturnValue({ ...gps, userLocation: { ...gps.userLocation, coords: { latitude: 0, longitude: 0, accuracy: 5 } } });
  await result.rerender(<InventoryScreen onBack={jest.fn()} />);
  expect(screen.getByLabelText('Cache latitude')).toHaveProp('value', '-26');
  expect(screen.getByLabelText('Cache longitude')).toHaveProp('value', '29');
});

test('manual entry remains available when GPS permission is denied', async () => {
  useDashboardLocation.mockReturnValue({ ...useDashboardLocation(), userLocation: null, locationFixSource: 'none', locationPermissionStatus: 'denied', locationError: 'Location denied' });
  await mount(); await openCreate();
  expect(screen.getByLabelText('Use current position for cache')).toBeDisabled();
  await fillCreate(); await press('Seal and bury cache'); expect(mockBatch.commit).toHaveBeenCalledTimes(1);
});

test('cached or stale positions cannot be stamped as the current position', async () => {
  const gps = useDashboardLocation();
  useDashboardLocation.mockReturnValue({ ...gps, locationFixSource: 'cached' });
  const result = await mount(); await openCreate();
  expect(screen.getByLabelText('Use current position for cache')).toBeDisabled();
  useDashboardLocation.mockReturnValue({ ...gps, userLocation: { ...gps.userLocation, timestamp: Date.now() - 121_000 } });
  await result.rerender(<InventoryScreen onBack={jest.fn()} />);
  expect(screen.getByLabelText('Use current position for cache')).toBeDisabled();
});

test('edits title, clue, reward and coordinates in an owner-checked transaction', async () => {
  await mount(); await press('Edit OWN CACHE');
  await change('Edit cache title', 'Updated cache'); await change('Edit cache clue', 'New clue');
  await change('Edit secret payload', 'New reward'); await change('Edit cache latitude', '-26'); await change('Edit cache longitude', '29');
  await press('Save cache changes');
  expect(mockTransaction.get).toHaveBeenCalledWith(expect.objectContaining({ path: 'treasures/own-id' }));
  expect(mockTransaction.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'UPDATED CACHE', hint: 'New clue', payloadText: 'New reward', location: { latitude: -26, longitude: 29 } }));
  expect(screen.getByLabelText('Edit UPDATED CACHE')).toBeTruthy();
});

test('a failed edit keeps the edited values available for retry', async () => {
  runTransaction.mockRejectedValueOnce(new Error('unavailable'));
  await mount(); await press('Edit OWN CACHE'); await change('Edit cache title', 'Edited draft'); await press('Save cache changes');
  expect(screen.getByLabelText('Edit cache title')).toHaveProp('value', 'Edited draft');
  expect(screen.getByLabelText('Save cache changes')).toBeEnabled();
});

test('realtime updates preserve an unfinished edit draft', async () => {
  await mount(); await press('Edit OWN CACHE'); await change('Edit cache title', 'Edited draft');
  await emit([['own-id', cache({ hint: 'Updated remotely' })]]);
  expect(screen.getByLabelText('Edit cache title')).toHaveProp('value', 'Edited draft');
});

test('archives a cache and its activity atomically, retaining it for restore', async () => {
  await mount(); await press('Archive OWN CACHE');
  expect(screen.getByTestId('inventory-confirmation-modal')).toHaveProp('supportedOrientations', expect.arrayContaining(['landscape-left', 'landscape-right']));
  await press('ARCHIVE CACHE');
  expect(mockTransaction.update).toHaveBeenCalledWith(expect.anything(), { isArchived: true, updatedAt: 'server-timestamp' });
  expect(mockTransaction.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'TREASURE_ARCHIVED', targetId: 'own-id' }));
  expect(screen.getByLabelText('Restore OWN CACHE')).toBeTruthy();
});

test('restores an archived owner cache', async () => {
  mockStoredCache = cache({ isArchived: true }); await mount({}, [['own-id', mockStoredCache]]);
  await press('Restore OWN CACHE'); await press('RESTORE CACHE');
  expect(mockTransaction.update).toHaveBeenCalledWith(expect.anything(), { isArchived: false, updatedAt: 'server-timestamp' });
  expect(screen.getByLabelText('Archive OWN CACHE')).toBeTruthy();
});

test('permanently deletes an archived cache without deleting anyone else’s discovery history', async () => {
  mockStoredCache = cache({ isArchived: true }); await mount({}, [['own-id', mockStoredCache]]);
  await press('Permanently delete OWN CACHE'); await press('DELETE CACHE');
  expect(mockTransaction.delete).toHaveBeenCalledTimes(1);
  expect(mockTransaction.delete).toHaveBeenCalledWith(expect.objectContaining({ path: 'treasures/own-id' }));
  expect(screen.queryByLabelText('Edit OWN CACHE')).toBeNull();
});

test('a cache restored by another client cannot be deleted through a stale archive confirmation', async () => {
  await mount({}, [['own-id', cache({ isArchived: true })]]);
  mockStoredCache = cache({ isArchived: false });
  await press('Permanently delete OWN CACHE'); await press('DELETE CACHE');
  expect(mockTransaction.delete).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Deletion Error', 'Archive this cache before permanently deleting it.');
});

test.each(['archive', 'restore', 'delete'])('rechecks ownership inside the %s transaction', async action => {
  const archived = action !== 'archive';
  await mount({}, [['own-id', cache({ isArchived: archived })]]);
  mockStoredCache = cache({ creatorId: 'other', isArchived: archived });
  await press(action === 'archive' ? 'Archive OWN CACHE' : action === 'restore' ? 'Restore OWN CACHE' : 'Permanently delete OWN CACHE');
  await press(action === 'archive' ? 'ARCHIVE CACHE' : action === 'restore' ? 'RESTORE CACHE' : 'DELETE CACHE');
  expect(mockTransaction.update).not.toHaveBeenCalled(); expect(mockTransaction.delete).not.toHaveBeenCalled();
});

test('a confirmation cannot silently move to another cache when the original record disappears', async () => {
  await mount({}, [['own-id', cache()], ['second', cache({ title: 'SECOND CACHE' })]]);
  await press('Archive OWN CACHE');
  const confirm = pressHandler('ARCHIVE CACHE');
  await emit([['second', cache({ title: 'SECOND CACHE' })]]);
  await act(() => confirm()); expect(runTransaction).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Archive SECOND CACHE')).toBeTruthy();
});

test('a cancelled confirmation never writes', async () => {
  await mount(); await press('Archive OWN CACHE'); await press('Cancel');
  expect(runTransaction).not.toHaveBeenCalled();
});

test('one confirmation cannot start duplicate transactions', async () => {
  let finish; runTransaction.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await press('Archive OWN CACHE');
  const confirm = pressHandler('ARCHIVE CACHE');
  await act(() => { confirm(); confirm(); });
  expect(runTransaction).toHaveBeenCalledTimes(1); await act(() => finish(cache({ isArchived: true })));
});

test('failed archive transactions preserve the cache for retry', async () => {
  runTransaction.mockRejectedValueOnce(new Error('unavailable'));
  await mount(); await press('Archive OWN CACHE'); await press('ARCHIVE CACHE');
  expect(screen.getByLabelText('Archive OWN CACHE')).toBeEnabled();
});

test('foreign caches only reveal rewards after discovery verification', async () => {
  const foreign = cache({ title: 'FIELD CACHE', creatorId: 'other' });
  await mount({}, [['field', foreign]]);
  expect(screen.queryByText('Secret reward')).toBeNull();
  await emit([['field', foreign]], ['field']); expect(screen.getByText('Secret reward')).toBeTruthy();
  await act(() => mockObservers.get('discoveries:hunterId').error(new Error('unavailable')));
  expect(screen.queryByText('Secret reward')).toBeNull();
});

test('foreign caches navigate to Hunt using the canonical document ID', async () => {
  const navigate = jest.fn(); await mount({ onNavigate: navigate }, [['field-id', cache({ title: 'FIELD CACHE', creatorId: 'other' })]]);
  await press('Track FIELD CACHE in Hunt');
  expect(navigate).toHaveBeenCalledWith('HUNT', expect.objectContaining({ treasureId: 'field-id', mode: 'hunt' }));
});

test('malformed text is safe in detail and edit views, while malformed coordinates are filtered out', async () => {
  await mount({}, [['own-id', cache({ hint: {}, payloadText: {}, creatorName: {} })], ['invalid', cache({ location: { latitude: NaN, longitude: 0 } })]]);
  await press('Edit OWN CACHE'); expect(screen.getByLabelText('Edit cache clue')).toHaveProp('value', '');
  expect(screen.getByLabelText('Edit secret payload')).toHaveProp('value', '');
});

test('retrying subscriptions ignores callbacks from old listeners', async () => {
  await mount(); const old = mockObservers.get('treasures:isArchived');
  await act(() => old.error(new Error('unavailable'))); await press('Retry cache synchronisation');
  expect(old.unsubscribe).toHaveBeenCalledTimes(1); await emit();
  await act(() => old.next(querySnapshot([['foreign', cache({ title: 'STALE RECORD', creatorId: 'other' })]])));
  expect(screen.queryByRole('button', { name: /^STALE RECORD\./ })).toBeNull();
});

test('an account switch clears drafts and prevents an old create result from entering the new inventory', async () => {
  let finish; mockBatch.commit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await openCreate(); await fillCreate(); await press('Seal and bury cache');
  await act(() => { mockAuth.currentUser = { uid: 'other' }; mockAuthChange(mockAuth.currentUser); });
  await emit([]); await act(() => finish()); await openCreate();
  expect(screen.getByLabelText('Cache title')).toHaveProp('value', '');
  expect(screen.getByLabelText('Secret payload')).toHaveProp('value', '');
});

test('a stale confirmation cannot modify a different authenticated account', async () => {
  await mount(); await press('Archive OWN CACHE'); const confirm = pressHandler('ARCHIVE CACHE');
  await act(() => { mockAuth.currentUser = { uid: 'other' }; mockAuthChange(mockAuth.currentUser); });
  await act(() => confirm()); expect(runTransaction).not.toHaveBeenCalled();
});

test('a queued confirmation cannot write after Inventory unmounts', async () => {
  const result = await mount(); await press('Archive OWN CACHE'); const confirm = pressHandler('ARCHIVE CACHE');
  await result.unmount(); await act(() => confirm()); expect(runTransaction).not.toHaveBeenCalled();
});

test('edit transactions reject a cache that no longer belongs to the current user', async () => {
  await mount(); await press('Edit OWN CACHE'); await change('Edit cache title', 'Updated title');
  mockStoredCache = cache({ creatorId: 'other' }); await press('Save cache changes');
  expect(mockTransaction.update).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Edit cache title')).toHaveProp('value', 'Updated title');
});

test('a missing cache is reported without attempting an archive write', async () => {
  await mount(); await press('Archive OWN CACHE'); mockStoredCache = null; await press('ARCHIVE CACHE');
  expect(mockTransaction.update).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Archive Error', expect.stringContaining('no longer exists'));
});

test('Use Current Position explicitly replaces manual coordinates with the latest GPS fix', async () => {
  await mount(); await openCreate(); await fillCreate({ latitude: '-26', longitude: '29' });
  await press('Use current position for cache');
  expect(screen.getByLabelText('Cache latitude')).toHaveProp('value', '-25.890000');
  expect(screen.getByLabelText('Cache longitude')).toHaveProp('value', '28.180000');
});

test('a queued position-stamp action rejects a fix that has since expired', async () => {
  await mount(); await openCreate(); await fillCreate({ latitude: '-26', longitude: '29' });
  const stamp = pressHandler('Use current position for cache');
  await act(() => jest.advanceTimersByTime(121_000)); await act(() => stamp());
  expect(screen.getByLabelText('Cache latitude')).toHaveProp('value', '-26');
  expect(Alert.alert).toHaveBeenLastCalledWith('Position Unavailable', expect.any(String));
});

test('an account change during transaction reads prevents all writes', async () => {
  mockTransaction.get.mockImplementation(async () => {
    mockAuth.currentUser = { uid: 'other' }; mockAuthChange(mockAuth.currentUser); return snapshot(cache());
  });
  await mount(); await press('Archive OWN CACHE'); await press('ARCHIVE CACHE');
  expect(mockTransaction.update).not.toHaveBeenCalled(); expect(mockTransaction.set).not.toHaveBeenCalled();
});

test('keyboard editing gives the create form room and restores Inventory without losing the draft', async () => {
  const keyboard = observeKeyboard(); await mount(); await openCreate(); await change('Cache title', 'Visible draft');
  await keyboard(true);
  expect(screen.getByLabelText('Cache title')).toHaveProp('value', 'Visible draft');
  expect(screen.queryByText('FIELD CACHE INVENTORY')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Return to field map' })).toBeNull();
  await press('Done typing'); expect(Keyboard.dismiss).toHaveBeenCalledTimes(1); await keyboard(false);
  expect(screen.getByText('FIELD CACHE INVENTORY')).toBeTruthy();
  expect(screen.getByLabelText('Cache title')).toHaveProp('value', 'Visible draft');
});
test('keyboard editing keeps the edit fields mounted while hiding the cache browser', async () => {
  const keyboard = observeKeyboard(); await mount(); await press('Edit OWN CACHE'); await change('Edit cache title', 'Edit in progress');
  await keyboard(true); expect(screen.getByLabelText('Edit cache title')).toHaveProp('value', 'Edit in progress');
  expect(screen.queryByRole('button', { name: 'Bury a new cache' })).toBeNull(); await keyboard(false);
  expect(screen.getByLabelText('Edit cache title')).toHaveProp('value', 'Edit in progress');
});
