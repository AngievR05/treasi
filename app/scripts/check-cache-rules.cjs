// Run only against a local Firestore emulator loaded with firestore.rules.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const {
  getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDocFromServer,
  writeBatch, GeoPoint, serverTimestamp, terminate,
} = require('firebase/firestore');
const { geohashForLocation } = require('geofire-common');

const projectId = 'demo-treasi-cache';
const port = Number(process.env.TREASI_EMULATOR_PORT || 8189);
const contexts = [];

function client(userId) {
  const app = initializeApp({ projectId }, userId || 'signed-out');
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', port,
    userId ? { mockUserToken: { sub: userId } } : {});
  contexts.push({ app, db });
  return db;
}

const creatorId = 'cache-rules-owner';
const location = new GeoPoint(12.25, 34.5);
const geohash = geohashForLocation([location.latitude, location.longitude]);
const denied = { code: 'permission-denied' };

function cacheData(treasureId, overrides = {}) {
  return {
    treasureId, creatorId, creatorName: 'Test Explorer', title: 'RULES TEST CACHE',
    hint: '', payloadText: '', location, isArchived: false, geohash,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides,
  };
}

async function main() {
  const owner = client(creatorId);
  const other = client('cache-rules-other-user');
  const signedOut = client();
  const id = randomUUID();
  const cache = doc(owner, 'treasures', id);
  const activity = doc(owner, 'activity_feed', id);
  const batch = writeBatch(owner);
  batch.set(cache, cacheData(id));
  batch.set(activity, {
    activityId: id, userId: creatorId, username: 'Test Explorer',
    type: 'TREASURE_HIDDEN', message: 'PLANTED CACHE: RULES TEST CACHE',
    targetId: id, createdAt: serverTimestamp(),
  });
  await batch.commit();
  assert.equal((await getDocFromServer(cache)).data().geohash, geohash);
  assert.equal((await getDocFromServer(activity)).data().targetId, id);

  await updateDoc(cache, { title: 'EDITED CACHE', location, geohash, updatedAt: serverTimestamp() });
  await assert.rejects(updateDoc(cache, { geohash: '0000000000' }), denied);
  await assert.rejects(updateDoc(cache, { location: new GeoPoint(0, 0) }), denied);
  await assert.rejects(updateDoc(doc(other, 'treasures', id), { title: 'OTHER EDIT' }), denied);

  const legacyId = randomUUID();
  const legacy = doc(owner, 'treasures', legacyId);
  const { geohash: _unused, ...legacyData } = cacheData(legacyId);
  await setDoc(legacy, legacyData);
  await updateDoc(legacy, { isArchived: true, updatedAt: serverTimestamp() });
  await updateDoc(legacy, { isArchived: false, geohash, updatedAt: serverTimestamp() });
  assert.equal((await getDocFromServer(legacy)).data().geohash, geohash);

  for (const [db, overrides] of [[owner, { geohash: 'not-a-hash' }], [other, {}], [signedOut, {}]]) {
    const rejectedId = randomUUID();
    await assert.rejects(setDoc(doc(db, 'treasures', rejectedId), cacheData(rejectedId, overrides)), denied);
  }
  console.log('Cache rules passed: atomic create, edit, legacy restore, and permission checks.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => Promise.all(contexts.map(async ({ app, db }) => {
  await terminate(db);
  await deleteApp(app);
})));
