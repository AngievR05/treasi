const { geohashForLocation } = require('geofire-common');

function treasureHash(document) {
  const point = document.fields?.location?.geoPointValue;
  if (!point || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) return null;
  return geohashForLocation([point.latitude, point.longitude]);
}

async function backfill({ projectId, token, apply = false, request = fetch }) {
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId || '')) throw new Error('A valid --project ID is required.');
  if (!token) throw new Error('Set GOOGLE_OAUTH_ACCESS_TOKEN to an authorized Google OAuth access token.');
  const prefix = `projects/${projectId}/databases/(default)/documents/treasures/`;
  const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/treasures`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const result = { scanned: 0, unchanged: 0, invalid: 0, needsUpdate: 0, updated: 0, conflicts: 0 };
  let pageToken;
  do {
    const url = new URL(endpoint); url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await request(url.toString(), { headers });
    if (!response.ok) throw new Error(`Treasure listing failed (HTTP ${response.status}).`);
    const page = await response.json();
    for (const document of page.documents ?? []) {
      result.scanned++;
      if (!document.name?.startsWith(prefix) || document.name.slice(prefix.length).includes('/')) throw new Error('Unexpected document path.');
      const geohash = treasureHash(document);
      if (!geohash) { result.invalid++; continue; }
      if (document.fields?.geohash?.stringValue === geohash) { result.unchanged++; continue; }
      result.needsUpdate++;
      if (!apply) continue;
      if (!document.updateTime) throw new Error('Missing update-time precondition.');
      const patch = new URL(`https://firestore.googleapis.com/v1/${document.name}`);
      patch.searchParams.set('updateMask.fieldPaths', 'geohash');
      patch.searchParams.set('currentDocument.updateTime', document.updateTime);
      const saved = await request(patch.toString(), { method: 'PATCH', headers, body: JSON.stringify({ fields: { geohash: { stringValue: geohash } } }) });
      // Never attach an old coordinate hash to a cache moved while migration was running.
      if ([404, 409, 412].includes(saved.status)) { result.conflicts++; continue; }
      if (saved.status === 400) {
        const failure = await saved.json().catch(() => null);
        if (failure?.error?.status === 'FAILED_PRECONDITION') { result.conflicts++; continue; }
      }
      if (!saved.ok) throw new Error(`Geohash update failed (HTTP ${saved.status}).`);
      result.updated++;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return result;
}

if (require.main === module) {
  const args = process.argv.slice(2), index = args.indexOf('--project');
  backfill({ projectId: args[index + 1], token: process.env.GOOGLE_OAUTH_ACCESS_TOKEN, apply: args.includes('--apply') })
    .then(result => process.stdout.write(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'dry-run', ...result }, null, 2) + '\n'))
    .catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
module.exports = { treasureHash, backfill };
