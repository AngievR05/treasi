import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Alert, Linking } from 'react-native';
import { auth as mockAuth } from '../src/config/firebase';
import { getDocs, runTransaction } from 'firebase/firestore';
import { useDashboardLocation } from '../src/hooks/useDashboardLocation';
import { LeaderboardScreen } from '../src/screens/LeaderboardScreen';
import { SocialScreen } from '../src/screens/SocialScreen';

let mockAuthChange, mockBatch, mockTransaction, mockNextId;
const mockObservers = new Map(), mockStore = new Map(), mockPressHandlers = new Map();
const nativeModule = require('react-native'), RealPressable = nativeModule.Pressable;
jest.mock('../src/config/firebase', () => ({ auth: { currentUser: null }, db: {} }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: (_, callback) => { mockAuthChange = callback; callback(mockAuth.currentUser); return jest.fn(); } }));
jest.mock('firebase/firestore', () => ({
  collection: (_, path) => ({ path }),
  doc: (parent, ...parts) => { const id = parts.at(-1) || `new-${++mockNextId}`; return { path: parts.length ? parts.join('/') : `${parent.path}/${id}`, id }; },
  where: (field, _, value) => ({ field, value, kind: 'where' }),
  orderBy: (field, direction) => ({ field, direction, kind: 'orderBy' }), limit: value => ({ kind: 'limit', value }),
  query: (reference, ...filters) => ({ ...reference, filters, key: `${reference.path}:${filters.filter(f => f.field).map(f => f.field).join(',')}` }),
  GeoPoint: class { constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; } },
  serverTimestamp: () => 'server-timestamp', deleteField: () => 'delete-field',
  writeBatch: () => mockBatch, runTransaction: jest.fn(), getDocs: jest.fn(),
  onSnapshot: (reference, next, error) => { const unsubscribe = jest.fn(); mockObservers.set(reference.key || reference.path, { reference, next, error, unsubscribe }); return unsubscribe; },
}));
jest.mock('../src/hooks/useDashboardLocation', () => ({ ...jest.requireActual('../src/hooks/useDashboardLocation'), useDashboardLocation: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, left: 44, right: 44, bottom: 21 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
const snap = data => ({ exists: () => data != null, data: () => data });
const docs = entries => ({ docs: entries.map(([id, data]) => ({ id, data: () => data })) });
const observer = key => { const found = mockObservers.get(key); if (!found) throw new Error(`Missing listener ${key}`); return found; };
const emit = (key, data) => act(() => observer(key).next(data));
const press = label => fireEvent.press(screen.getAllByRole('button', { name: label })[0]);
const change = (label, text) => fireEvent.changeText(screen.getByLabelText(label), text);
const friend = (status = 'pending', requesterId = 'other', receiverId = 'me') => ({ friendshipId: 'me_other', requesterId, receiverId, status });
const profile = (changes = {}) => ({ username: 'ME', totalPoints: 100, telemetryEnabled: false, ...changes });
const directory = () => [['other', { username: 'OTHER', telemetryEnabled: true, location: { latitude: -25.89, longitude: 28.18 } }]];
async function mountSocial(props = {}, outgoing = [], incoming = []) {
  const result = await render(<SocialScreen onNavigate={jest.fn()} {...props} />);
  await emit('users/me', snap(profile())); await emit('users:', docs(directory()));
  await emit('friendships:requesterId', docs(outgoing)); await emit('friendships:receiverId', docs(incoming));
  await emit('messages:type,createdAt', docs([])); return result;
}
async function mountLeaderboard(entries = [['other', { username: 'OTHER', totalPoints: 200 }], ['me', profile()]], props = {}) {
  const result = await render(<LeaderboardScreen onNavigate={jest.fn()} {...props} />);
  await emit('users:totalPoints', docs(entries)); await emit('users/me', snap(profile())); return result;
}
async function switchAccount(uid = 'new-account') { await act(() => { mockAuth.currentUser = uid ? { uid, displayName: 'NEW ACCOUNT' } : null; mockAuthChange(mockAuth.currentUser); }); }
function destructiveConfirmation() { return Alert.alert.mock.calls.at(-1)[2].find(button => button.style === 'destructive').onPress; }

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-10T10:00:00Z'));
  mockAuth.currentUser = { uid: 'me', displayName: 'ME', email: 'me@example.com' };
  mockObservers.clear(); mockStore.clear(); mockPressHandlers.clear(); mockNextId = 0;
  mockStore.set('users/me', profile()); mockStore.set('users/other', { username: 'OTHER' });
  mockBatch = { set: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
  mockTransaction = { get: jest.fn(async ref => snap(mockStore.get(ref.path))), set: jest.fn(), update: jest.fn(), delete: jest.fn() };
  runTransaction.mockReset().mockImplementation(async (_, callback) => callback(mockTransaction));
  getDocs.mockReset().mockResolvedValue(docs([['other', { username: 'OTHER' }]]));
  useDashboardLocation.mockReturnValue({ userLocation: { coords: { latitude: -25.89, longitude: 28.18 }, timestamp: Date.now() }, locationFixSource: 'live', isInitialisingLocation: false, locationError: null, locationPermissionStatus: 'granted', canAskLocationAgain: true, locationServicesEnabled: true, startLocationService: jest.fn() });
  jest.spyOn(nativeModule, 'Pressable', 'get').mockReturnValue(props => { mockPressHandlers.set(props.accessibilityLabel, props.onPress); return <RealPressable {...props} />; });
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => { await cleanup(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('Leaderboard uses a descending top-50 query and displays the current user rank', async () => {
  await mountLeaderboard();
  expect(observer('users:totalPoints').reference.filters).toEqual([{ field: 'totalPoints', direction: 'desc', kind: 'orderBy' }, { kind: 'limit', value: 50 }]);
  expect(screen.getByLabelText(/Rank 2\. You, ME/)).toBeTruthy();
});
test('Leaderboard safely normalizes malformed profiles and orders by usable points', async () => {
  await mountLeaderboard([['broken', { username: {}, totalPoints: Infinity }], ['me', { username: 'ME', totalPoints: 100 }]]);
  expect(screen.getByLabelText(/Rank 1\. You, ME/)).toBeTruthy(); expect(screen.getByLabelText(/Rank 2\. EXPLORER/)).toBeTruthy();
});
test('Leaderboard preserves Firestore tie order at equal scores', async () => {
  await mountLeaderboard([['z', { username: 'ZED', totalPoints: 100 }], ['a', { username: 'ALPHA', totalPoints: 100 }]]);
  expect(screen.getByLabelText(/Rank 1\. ZED/)).toBeTruthy();
});
test('Leaderboard reports outside the top 50 only when a full manifest exists', async () => {
  await mountLeaderboard(Array.from({ length: 50 }, (_, i) => [`id-${i}`, { username: `USER ${i}`, totalPoints: 200 }]));
  expect(screen.getByLabelText(/Leaderboard position OUTSIDE TOP 50/)).toBeTruthy();
});
test('Leaderboard reports an unavailable rank when its initial listener fails', async () => {
  await render(<LeaderboardScreen />); await act(() => observer('users:totalPoints').error(new Error('offline')));
  await emit('users/me', snap(profile())); expect(screen.getByLabelText(/Leaderboard position UNAVAILABLE/)).toBeTruthy();
});
test('Leaderboard retry replaces listeners and ignores obsolete callbacks', async () => {
  await mountLeaderboard(); const old = observer('users:totalPoints'); await act(() => old.error(new Error('offline')));
  await press('Retry leaderboard synchronisation'); expect(old.unsubscribe).toHaveBeenCalledTimes(1);
  await act(() => old.next(docs([['old', { username: 'OBSOLETE', totalPoints: 1 }]])));
  expect(screen.queryByLabelText(/Rank .*OBSOLETE/)).toBeNull();
});
test('Leaderboard resets on account changes and rejects old account snapshots', async () => {
  await mountLeaderboard(); const old = observer('users/me'); await switchAccount();
  await act(() => old.next(snap({ username: 'OLD PRIVATE PROFILE', totalPoints: 2000 })));
  expect(screen.queryByText('OLD PRIVATE PROFILE')).toBeNull(); expect(old.unsubscribe).toHaveBeenCalledTimes(1);
});
test('Leaderboard signs out without retaining a previous manifest', async () => {
  await mountLeaderboard(); await switchAccount(null); expect(screen.queryByLabelText(/Rank 1\. OTHER/)).toBeNull();
  expect(screen.getAllByText(/EXPLORER SESSION REQUIRED/).length).toBeGreaterThan(0);
});
test.each(['Add friend', 'Dispatch Telegram'])('Leaderboard %s navigates to Social', async label => {
  const onNavigate = jest.fn(); await mountLeaderboard(undefined, { onNavigate }); await press(label); expect(onNavigate).toHaveBeenCalledWith('SOCIAL');
});
test('Leaderboard returns through onBack when supplied', async () => {
  const onBack = jest.fn(); await mountLeaderboard(undefined, { onBack }); await press('Return to field map'); expect(onBack).toHaveBeenCalledTimes(1);
});

test('Social queries the newest 40 global dispatches before applying the limit', async () => {
  await mountSocial(); expect(observer('messages:type,createdAt').reference.filters).toEqual([{ field: 'type', value: 'GLOBAL_DISPATCH', kind: 'where' }, { field: 'createdAt', direction: 'desc', kind: 'orderBy' }, { kind: 'limit', value: 40 }]);
});
test('Social filters invalid, private-location, and distant directory entries', async () => {
  await mountSocial(); await emit('users:', docs([...directory(), ['private', { username: 'PRIVATE', telemetryEnabled: false, location: { latitude: -25.89, longitude: 28.18 } }], ['invalid', { username: 'INVALID', telemetryEnabled: true, location: { latitude: null, longitude: '' } }], ['far', { username: 'FAR', telemetryEnabled: true, location: { latitude: 0, longitude: 0 } }]]));
  expect(screen.getByRole('button', { name: 'Send friend request to OTHER' })).toBeTruthy();
  for (const name of ['PRIVATE', 'INVALID', 'FAR']) expect(screen.queryByRole('button', { name: `Send friend request to ${name}` })).toBeNull();
});
test('Social discards relationship documents belonging to other accounts', async () => {
  await mountSocial({}, [], [['invalid', friend('pending', 'other', 'stranger')]]);
  expect(screen.queryByRole('button', { name: 'Accept request from OTHER' })).toBeNull();
});
test('Social sends one atomic friendship and activity transaction and updates the UI', async () => {
  await mountSocial(); await press('Send friend request to OTHER');
  expect(mockTransaction.set).toHaveBeenCalledTimes(2);
  expect(mockTransaction.set.mock.calls[0]).toEqual([expect.objectContaining({ path: 'friendships/me_other' }), expect.objectContaining({ requesterId: 'me', receiverId: 'other', status: 'pending' })]);
  expect(screen.getByRole('button', { name: 'Cancel pending friend request to OTHER' })).toBeTruthy();
});
test.each(['pending', 'accepted', 'blocked'])('Social rechecks server state before overwriting a %s relationship', async status => {
  mockStore.set('friendships/me_other', friend(status)); await mountSocial(); await press('Send friend request to OTHER');
  expect(mockTransaction.set).not.toHaveBeenCalled(); expect(Alert.alert).toHaveBeenCalledWith(expect.any(String), expect.any(String));
});
test('Social resends a declined legacy link atomically with its deletion', async () => {
  mockStore.set('friendships/legacy', friend('declined')); await mountSocial({}, [], [['legacy', friend('declined')]]);
  await press('Retry friend request to OTHER'); expect(mockTransaction.delete).toHaveBeenCalledWith(expect.objectContaining({ path: 'friendships/legacy' })); expect(mockTransaction.set).toHaveBeenCalledTimes(2);
});
test('Social prevents repeated request callbacks while a transaction is pending', async () => {
  let finish; runTransaction.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mountSocial(); const handler = mockPressHandlers.get('Send friend request to OTHER'); await act(() => { handler(); handler(); });
  expect(runTransaction).toHaveBeenCalledTimes(1); await act(() => finish());
});
test('Social accepts an incoming request and writes its activity atomically', async () => {
  mockStore.set('friendships/me_other', friend()); await mountSocial({}, [], [['me_other', friend()]]); await press('Accept request from OTHER');
  expect(mockTransaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'friendships/me_other' }), expect.objectContaining({ status: 'accepted' }));
  expect(mockTransaction.set).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringMatching(/^activity_feed\//) }), expect.objectContaining({ type: 'FRIEND_ACCEPTED' }));
  expect(screen.queryByRole('button', { name: 'Accept request from OTHER' })).toBeNull();
});
test('Social declines an incoming request without inventing activity', async () => {
  mockStore.set('friendships/me_other', friend()); await mountSocial({}, [], [['me_other', friend()]]); await press('Decline request from OTHER');
  expect(mockTransaction.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'declined' })); expect(mockTransaction.set).not.toHaveBeenCalled();
});
test.each(['accepted', 'blocked'])('Social rejects a stale accept action when server status is %s', async status => {
  mockStore.set('friendships/me_other', friend(status)); await mountSocial({}, [], [['me_other', friend()]]); await press('Accept request from OTHER'); expect(mockTransaction.update).not.toHaveBeenCalled();
});
test('Social rejects a friendship mutation if server participants changed', async () => {
  mockStore.set('friendships/me_other', friend('pending', 'stranger', 'other')); await mountSocial({}, [], [['me_other', friend()]]); await press('Accept request from OTHER'); expect(mockTransaction.update).not.toHaveBeenCalled();
});
test('Social removes an accepted friendship after confirmation', async () => {
  mockStore.set('friendships/me_other', friend('accepted')); await mountSocial({}, [], [['me_other', friend('accepted')]]);
  await press('Remove friendship with OTHER'); expect(mockTransaction.delete).not.toHaveBeenCalled(); await act(() => destructiveConfirmation()()); expect(mockTransaction.delete).toHaveBeenCalledTimes(1);
});
test('Social does not remove an accepted link through an old cancellation confirmation', async () => {
  mockStore.set('friendships/me_other', friend('pending', 'me', 'other')); await mountSocial({}, [['me_other', friend('pending', 'me', 'other')]]);
  await press('Cancel pending friend request to OTHER'); const confirm = destructiveConfirmation(); mockStore.set('friendships/me_other', friend('accepted', 'me', 'other')); await act(() => confirm()); expect(mockTransaction.delete).not.toHaveBeenCalled();
});
test('Social ignores a removal confirmation after switching accounts', async () => {
  await mountSocial({}, [], [['me_other', friend('accepted')]]); await press('Remove friendship with OTHER'); const confirm = destructiveConfirmation(); await switchAccount(); await act(() => confirm()); expect(runTransaction).not.toHaveBeenCalled();
});
test('Social ignores a removal confirmation after leaving the screen', async () => {
  const view = await mountSocial({}, [], [['me_other', friend('accepted')]]); await press('Remove friendship with OTHER'); const confirm = destructiveConfirmation(); await view.unmount(); await act(() => confirm()); expect(runTransaction).not.toHaveBeenCalled();
});
test('Social sends a telegram and its activity in one batch', async () => {
  await mountSocial(); await change('Telegram broadcast message', '  Hello Explorers  '); await press('Transmit Telegram');
  expect(mockBatch.set).toHaveBeenCalledTimes(2); expect(mockBatch.set.mock.calls[0][1]).toEqual(expect.objectContaining({ senderId: 'me', text: 'Hello Explorers', type: 'GLOBAL_DISPATCH' })); expect(screen.getByLabelText('Telegram broadcast message').props.value).toBe('');
});
test('Social retains a failed telegram draft for retry', async () => {
  mockBatch.commit.mockRejectedValueOnce(new Error('offline')); await mountSocial(); await change('Telegram broadcast message', 'Retain this'); await press('Transmit Telegram'); expect(screen.getByLabelText('Telegram broadcast message').props.value).toBe('Retain this'); await press('Transmit Telegram'); expect(mockBatch.commit).toHaveBeenCalledTimes(2);
});
test('Social prevents duplicate telegrams from queued callbacks', async () => {
  let finish; mockBatch.commit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await mountSocial(); await change('Telegram broadcast message', 'One only'); const send = mockPressHandlers.get('Transmit Telegram'); await act(() => { send(); send(); }); expect(mockBatch.commit).toHaveBeenCalledTimes(1); await act(() => finish());
});
test('Social ignores late telegram results and resets private drafts on account change', async () => {
  let finish; mockBatch.commit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await mountSocial(); await change('Telegram broadcast message', 'Old account'); await press('Transmit Telegram'); await switchAccount(); await change('Telegram broadcast message', 'New account'); await act(() => finish()); expect(screen.getByLabelText('Telegram broadcast message').props.value).toBe('New account'); expect(Alert.alert).not.toHaveBeenCalledWith('Signal Transmitted', expect.anything());
});
test('Social safely renders malformed message timestamps and ignores invalid text', async () => {
  await mountSocial(); await emit('messages:type,createdAt', docs([['broken', { senderId: 'other', senderName: {}, text: 'Valid message', createdAt: { toMillis: () => { throw new Error('bad'); } } }], ['invalid', { senderId: 'other', text: {} }]])); expect(screen.getByText('Valid message')).toBeTruthy();
});
test('Social retries failed subscriptions without accepting obsolete results', async () => {
  await mountSocial(); const old = observer('messages:type,createdAt'); await act(() => old.error(new Error('offline'))); await press('Retry Telegram synchronisation'); expect(old.unsubscribe).toHaveBeenCalledTimes(1); await act(() => old.next(docs([['late', { senderId: 'other', text: 'Late obsolete message' }]]))); expect(screen.queryByText('Late obsolete message')).toBeNull();
});

test('Social callsign search normalizes input and sends to the exact matched account', async () => {
  await mountSocial(); await press('Link a new Explorer'); await change('Explorer callsign', ' other '); await press('Send Explorer link request'); expect(getDocs).toHaveBeenCalledWith(expect.objectContaining({ filters: expect.arrayContaining([{ field: 'username', kind: 'where', value: 'OTHER' }]) })); expect(mockTransaction.set).toHaveBeenCalledTimes(2);
});
test('Social callsign search rejects ambiguous names', async () => {
  getDocs.mockResolvedValueOnce(docs([['other', { username: 'OTHER' }], ['another', { username: 'OTHER' }]])); await mountSocial(); await press('Link a new Explorer'); await change('Explorer callsign', 'OTHER'); await press('Send Explorer link request'); expect(screen.getByText('MULTIPLE EXPLORERS USE THIS CALLSIGN')).toBeTruthy(); expect(runTransaction).not.toHaveBeenCalled();
});
test('Social ignores a search response after the account changes', async () => {
  let finish; getDocs.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await mountSocial(); await press('Link a new Explorer'); await change('Explorer callsign', 'OTHER'); await press('Send Explorer link request'); await switchAccount(); await act(() => finish(docs([['other', { username: 'OTHER' }]]))); expect(runTransaction).not.toHaveBeenCalled();
});
test('Social uses only fresh live coordinates and ignores an unverified Dashboard coordinate prop', async () => {
  useDashboardLocation.mockReturnValue({ ...useDashboardLocation(), userLocation: null, locationFixSource: 'none', locationPermissionStatus: 'denied' }); await mountSocial({ userCoordinates: { latitude: -25.89, longitude: 28.18 } }); expect(screen.queryByRole('button', { name: 'Send friend request to OTHER' })).toBeNull();
});
test('Social rechecks telemetry before publishing and clears a newly disabled location', async () => {
  await mountSocial(); mockStore.set('users/me', profile({ telemetryEnabled: false, location: { latitude: 0, longitude: 0 } })); await emit('users/me', snap(profile({ telemetryEnabled: true }))); expect(mockTransaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/me' }), expect.objectContaining({ location: 'delete-field' }));
});
test('Social publishes fresh location when sharing remains enabled', async () => {
  await mountSocial(); mockStore.set('users/me', profile({ telemetryEnabled: true })); await emit('users/me', snap(profile({ telemetryEnabled: true }))); expect(mockTransaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/me' }), expect.objectContaining({ location: expect.objectContaining({ latitude: -25.89, longitude: 28.18 }) }));
});
test('Social never publishes a stale GPS fix', async () => {
  useDashboardLocation.mockReturnValue({ ...useDashboardLocation(), userLocation: { coords: { latitude: -25.89, longitude: 28.18 }, timestamp: Date.now() - 121000 } }); await mountSocial(); await emit('users/me', snap(profile({ telemetryEnabled: true }))); expect(runTransaction).not.toHaveBeenCalled();
});
test('Social opens iOS Settings when location permission cannot be requested again', async () => {
  useDashboardLocation.mockReturnValue({ ...useDashboardLocation(), userLocation: null, locationPermissionStatus: 'denied', canAskLocationAgain: false }); await mountSocial(); await press('OPEN SETTINGS'); expect(Linking.openSettings).toHaveBeenCalledTimes(1);
});

test('Social reports a missing callsign and allows a failed search to be retried', async () => {
  getDocs.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(docs([])); await mountSocial(); await press('Link a new Explorer'); await change('Explorer callsign', 'UNKNOWN'); await press('Send Explorer link request'); expect(screen.getByText('CALLSIGN SEARCH FAILED')).toBeTruthy(); await press('Send Explorer link request'); expect(screen.getByText('EXPLORER CALLSIGN NOT FOUND')).toBeTruthy(); expect(runTransaction).not.toHaveBeenCalled();
});
test('Social prevents repeated callsign lookups while a lookup is pending', async () => {
  let finish; getDocs.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await mountSocial(); await press('Link a new Explorer'); await change('Explorer callsign', 'OTHER'); const search = mockPressHandlers.get('Send Explorer link request'); await act(() => { search(); search(); }); expect(getDocs).toHaveBeenCalledTimes(1); await act(() => finish(docs([])));
});
test('Social rejects linking an Explorer deleted after appearing in the directory', async () => {
  mockStore.delete('users/other'); await mountSocial(); await press('Send friend request to OTHER'); expect(mockTransaction.set).not.toHaveBeenCalled();
});
test('Social prevents transaction writes when the authenticated account changes during its read', async () => {
  let finish; mockTransaction.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await mountSocial({}, [], [['me_other', friend()]]); await press('Accept request from OTHER'); await switchAccount(); await act(() => finish(snap(friend()))); expect(mockTransaction.update).not.toHaveBeenCalled(); expect(mockTransaction.set).not.toHaveBeenCalled();
});
test('Social retains a failed request and lets the user retry', async () => {
  runTransaction.mockRejectedValueOnce(new Error('offline')); await mountSocial(); await press('Send friend request to OTHER'); expect(screen.getByRole('button', { name: 'Send friend request to OTHER' })).toBeTruthy(); await press('Send friend request to OTHER'); expect(mockTransaction.set).toHaveBeenCalledTimes(2);
});
test('Social refreshes GPS only after an explicit enable action when permission is undetermined', async () => {
  const startLocationService = jest.fn(); useDashboardLocation.mockReturnValue({ ...useDashboardLocation(), userLocation: null, locationPermissionStatus: 'undetermined', startLocationService }); await mountSocial(); await press('ENABLE LOCATION'); expect(startLocationService).toHaveBeenCalledWith(true);
});
test('Social retries failed location publication through network retry', async () => {
  await mountSocial(); mockStore.set('users/me', profile({ telemetryEnabled: true })); runTransaction.mockRejectedValueOnce(new Error('offline')); await emit('users/me', snap(profile({ telemetryEnabled: true }))); expect(screen.getByText('LOCATION SHARING SYNC FAILED')).toBeTruthy(); await press('Retry Explorer network synchronisation'); expect(mockTransaction.update).toHaveBeenCalledTimes(1);
});
test('Social reports a missing feed index without falsely claiming a connection failure', async () => {
  await mountSocial(); await act(() => observer('messages:type,createdAt').error({ code: 'failed-precondition' })); expect(screen.getByText('TELEGRAM FEED INDEX REQUIRED')).toBeTruthy();
});
test('Leaderboard shows an empty state for an empty manifest and a missing-profile error', async () => {
  await mountLeaderboard([]); await emit('users/me', snap(null)); expect(screen.getByLabelText('No Explorers are currently available in the leaderboard.')).toBeTruthy(); expect(screen.getAllByText(/EXPLORER PROFILE NOT FOUND/).length).toBeGreaterThan(0);
});
