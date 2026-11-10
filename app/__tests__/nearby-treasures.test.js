import { nearbyTreasureBounds } from '../src/utils/treasureGeo';
import { act, cleanup, renderHook } from '@testing-library/react-native';
import { Geodesic } from 'geographiclib-geodesic';
import { geohashForLocation, geohashQueryBounds } from 'geofire-common';
import { useNearbyTreasures } from '../src/hooks/useNearbyTreasures';

const mockListeners = [];
jest.mock('../src/config/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: (_, path) => ({ path }), where: (field, operator, value) => ({ field, operator, value }),
  orderBy: field => ({ orderBy: field }), startAt: value => ({ startAt: value }), endAt: value => ({ endAt: value }),
  query: (reference, ...constraints) => ({ ...reference, constraints }),
  onSnapshot: (query, next, error) => { const remove = jest.fn(); mockListeners.push({ query, next, error, remove }); return remove; },
}));
const center = { latitude: -25.89, longitude: 28.18 };
const cache = (id, position = center, changes = {}) => [id, { creatorId: 'other', title: id, location: position, isArchived: false, ...changes }];
const snapshot = entries => ({ forEach: callback => entries.forEach(([id, data]) => callback({ id, data: () => data })) });
beforeEach(() => { mockListeners.length = 0; });
afterEach(cleanup);

test('uses geographic bounds and archive filtering in every server query', async () => {
  await renderHook(() => useNearbyTreasures('me', center, 20));
  expect(mockListeners.length).toBeGreaterThan(1);
  for (const { query } of mockListeners) expect(query).toEqual({ path: 'treasures', constraints: [
    { field: 'isArchived', operator: '==', value: false }, { orderBy: 'geohash' }, { startAt: expect.any(String) }, { endAt: expect.any(String) },
  ] });
});
test('merges overlaps without duplicates and filters false positives precisely', async () => {
  const { result } = await renderHook(() => useNearbyTreasures('me', center, 20));
  await act(() => mockListeners.forEach(listener => listener.next(snapshot([cache('near'), cache('far', { latitude: 0, longitude: 0 }), cache('archived', center, { isArchived: true }), cache('invalid', { latitude: NaN, longitude: 0 })]))));
  expect(result.current.items.map(item => item.treasureId)).toEqual(['near']); expect(result.current.loading).toBe(false);
});
test('removing an overlapping document from one range keeps its other copy until it also disappears', async () => {
  const { result } = await renderHook(() => useNearbyTreasures('me', center, 20));
  await act(() => { mockListeners[0].next(snapshot([cache('near')])); mockListeners[1].next(snapshot([cache('near')])); });
  await act(() => mockListeners[0].next(snapshot([]))); expect(result.current.items).toHaveLength(1);
  await act(() => mockListeners[1].next(snapshot([]))); expect(result.current.items).toHaveLength(0);
});
test('small GPS movements reuse listeners; a movement beyond the buffer replaces them', async () => {
  const { rerender, result } = await renderHook(({ point }) => useNearbyTreasures('me', point, 20), { initialProps: { point: center } });
  const count = mockListeners.length; const old = [...mockListeners];
  const shifted = metres => { const point = Geodesic.WGS84.Direct(center.latitude, center.longitude, 90, metres); return { latitude: point.lat2, longitude: point.lon2 }; };
  await rerender({ point: shifted(90) }); expect(mockListeners).toHaveLength(count);
  await rerender({ point: shifted(120) }); expect(mockListeners.length).toBeGreaterThan(count); expect(old.every(listener => listener.remove.mock.calls.length === 1)).toBe(true);
  await act(() => old.forEach(listener => listener.next(snapshot([cache('obsolete')])))); expect(result.current.items).toHaveLength(0);
});
test('does not download the collection without a valid location or signed-in account', async () => {
  const { rerender } = await renderHook(({ uid, point }) => useNearbyTreasures(uid, point, 20), { initialProps: { uid: 'me', point: null } });
  expect(mockListeners).toHaveLength(0); await rerender({ uid: null, point: center }); expect(mockListeners).toHaveLength(0);
});
test('clears an old account and ignores callbacks after switching accounts', async () => {
  const { result, rerender } = await renderHook(({ uid }) => useNearbyTreasures(uid, center, 20), { initialProps: { uid: 'me' } });
  const old = [...mockListeners]; await act(() => old[0].next(snapshot([cache('old-account')]))); expect(result.current.items).toHaveLength(1);
  await rerender({ uid: 'other-account' }); await act(() => old[0].next(snapshot([cache('late')]))); expect(result.current.items).toHaveLength(0);
});
test('reports partial failures and retries subscriptions without accepting disposed callbacks', async () => {
  const { result, rerender } = await renderHook(({ retry }) => useNearbyTreasures('me', center, 20, retry), { initialProps: { retry: 0 } });
  await act(() => mockListeners.forEach(listener => listener.error(new Error('index missing')))); expect(result.current.error).toMatch(/INCOMPLETE/); expect(result.current.loading).toBe(false);
  const old = [...mockListeners]; await rerender({ retry: 1 }); expect(result.current.error).toBeNull(); expect(old.every(listener => listener.remove.mock.calls.length === 1)).toBe(true);
});
test.each([[0, 179.99], [89.9, 0], [-25.89, 28.18]])('geohash bounds cover a full search circle near %s, %s', (latitude, longitude) => {
  const bounds = nearbyTreasureBounds(latitude, longitude, 20100);
  for (let bearing = 0; bearing < 360; bearing += 10) {
    const point = Geodesic.WGS84.Direct(latitude, longitude, bearing, 20000);
    const hash = geohashForLocation([point.lat2, point.lon2]); expect(bounds.some(([lower, upper]) => hash >= lower && hash <= upper)).toBe(true);
  }
});
