const { backfill, treasureHash } = require('../scripts/backfill-treasure-geohashes.cjs');
const { geohashForLocation } = require('geofire-common');
const document = (changes = {}) => ({ name: 'projects/treasi-demo/databases/(default)/documents/treasures/cache', fields: { location: { geoPointValue: { latitude: -25.89, longitude: 28.18 } } }, updateTime: '2026-11-10T10:00:00Z', ...changes });
const ok = body => ({ ok: true, json: async () => body });
test('backfill dry-run never writes and reports every document needing an index', async () => {
  const request = jest.fn().mockResolvedValue(ok({ documents: [document()] })); const result = await backfill({ projectId: 'treasi-demo', token: 'test-only-token', request });
  expect(result.needsUpdate).toBe(1); expect(result.updated).toBe(0); expect(request).toHaveBeenCalledTimes(1);
});
test('backfill patches only geohash and conditions the update on the original document version', async () => {
  const request = jest.fn().mockResolvedValueOnce(ok({ documents: [document()] })).mockResolvedValueOnce(ok({}));
  const result = await backfill({ projectId: 'treasi-demo', token: 'test-only-token', apply: true, request });
  expect(result.updated).toBe(1); const [url, options] = request.mock.calls[1];
  expect(new URL(url).searchParams.get('currentDocument.updateTime')).toBe('2026-11-10T10:00:00Z');
  expect(new URL(url).searchParams.get('updateMask.fieldPaths')).toBe('geohash');
  expect(JSON.parse(options.body)).toEqual({ fields: { geohash: { stringValue: geohashForLocation([-25.89, 28.18]) } } });
});
test('backfill skips corrupt coordinates and already indexed documents', async () => {
  expect(treasureHash(document({ fields: {} }))).toBeNull();
  const indexed = document(); indexed.fields.geohash = { stringValue: treasureHash(indexed) };
  const request = jest.fn().mockResolvedValue(ok({ documents: [indexed, document({ fields: {} })] }));
  const result = await backfill({ projectId: 'treasi-demo', token: 'test-only-token', apply: true, request }); expect(result.unchanged).toBe(1); expect(result.invalid).toBe(1); expect(request).toHaveBeenCalledTimes(1);
});
test('backfill skips a cache moved during migration instead of writing a stale hash', async () => {
  const request = jest.fn().mockResolvedValueOnce(ok({ documents: [document()] })).mockResolvedValueOnce({ ok: false, status: 409 });
  const result = await backfill({ projectId: 'treasi-demo', token: 'test-only-token', apply: true, request }); expect(result.conflicts).toBe(1); expect(result.updated).toBe(0);
});
test('backfill follows pagination and refuses missing credentials before any request', async () => {
  const request = jest.fn().mockResolvedValueOnce(ok({ documents: [], nextPageToken: 'next' })).mockResolvedValueOnce(ok({ documents: [] }));
  await backfill({ projectId: 'treasi-demo', token: 'test-only-token', request }); expect(new URL(request.mock.calls[1][0]).searchParams.get('pageToken')).toBe('next');
  await expect(backfill({ projectId: 'treasi-demo', request })).rejects.toThrow('GOOGLE_OAUTH_ACCESS_TOKEN');
});
