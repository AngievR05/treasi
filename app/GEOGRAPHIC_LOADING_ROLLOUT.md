# Geographic treasure loading rollout

Dashboard and Inventory now subscribe to geohash ranges around the current location, rather than every active treasure. The radius is 20 km. Overlapping results are deduplicated and checked against the exact WGS84 distance. A 100-metre query buffer avoids rebuilding listeners for every small GPS update. Searches crossing a pole cover the entire polar row.

Inventory retains its separate owner query so distant and archived owned caches remain manageable. With no usable coordinates, Dashboard waits for location; Inventory still offers owned records and manual cache creation. Neither screen downloads the whole active collection as a fallback.

## Required before releasing these clients

1. Merge the entries in `../firestore.indexes.json` with the project's existing index configuration. Deploy the `treasures` collection index (`isArchived` ascending, `geohash` ascending) and the existing messages index. `../firebase.json` configures index deployment only; no security rules are supplied or changed. With an authenticated Firebase CLI, deploy indexes from the repository root using `firebase deploy --only firestore:indexes --project YOUR_PROJECT_ID`. Preserve unrelated indexes already used by the project.
2. Backfill existing treasures, including archives, with the script below. **Treasures without a geohash do not participate in nearby queries.** Run and verify the migration before releasing the new clients.
3. Confirm deployed rules allow the new queries and owner-authorized create/edit/restore writes containing `geohash`. All writers must update geohash atomically whenever coordinates change; upgrade older clients or enforce the indexing contract on the backend.
4. Verify both nearby screens against real records before release. Test a nearby cache, a distant cache, an archived owned cache, moving a cache across the radius, and a missing-index or permission error.

## Backfill tool

The script uses the Firestore REST API and an authorized Google OAuth token with appropriate project IAM permissions. It does not use the Firebase public API key or a Firebase user's ID token. No live migration was performed in this workspace.

From `app/`, after authenticating Google Cloud CLI with the intended project operator:

```powershell
$env:GOOGLE_OAUTH_ACCESS_TOKEN = gcloud auth print-access-token
node scripts/backfill-treasure-geohashes.cjs --project YOUR_PROJECT_ID
```

The default is a read-only dry run reporting scanned, unchanged, invalid and missing/incorrect hashes. Review it, then apply:

```powershell
node scripts/backfill-treasure-geohashes.cjs --project YOUR_PROJECT_ID --apply
```

The apply mode patches only `geohash` and uses each document's original update time as a precondition. Caches moved or deleted during migration are counted as conflicts, rather than receiving a hash for old coordinates. The script is idempotent: rerun after resolving conflicts or correcting invalid coordinates, then run the dry run again and confirm `needsUpdate` is zero. Invalid coordinates require separate correction. Tokens remain in the current process environment and are not written to project files.

The migration necessarily scans the collection once as an administrative operation. App clients perform only geographic range reads and the owner's records query. Production credentials, index deployment and device verification remain external release steps.
