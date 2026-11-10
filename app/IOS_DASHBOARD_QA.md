# Dashboard verification on iOS

Run `npm test` for the iOS regression suite and `npm run typecheck` for TypeScript validation.
The automated tests mock native location, Apple Maps, authentication and Firestore; they do not validate a real device or deployed Firebase rules.

Before release, use an SDK 58-compatible iPhone build and verify:

- Sign in, open Dashboard, and confirm points, active caches and recent signals match Firestore.
- Deny location, then enable it through the recovery button and iOS Settings. Return to Dashboard and confirm tracking resumes.
- Try Precise Location both on and off. Approximate fixes should require confirmation before stamping.
- Background the app and return. Old coordinates must not enable stamping until live updates resume.
- Move outdoors after a GPS timeout and confirm the map, recenter button and Stamp action recover.
- Open a cache in both landscape orientations. Confirm the modal stays usable and its Close, Hunt and Dismiss controls work with VoiceOver.
- Edit or archive the selected cache from another client. Its details should refresh or close.
- Archive your own cache and confirm one archive activity is written. Other explorers' caches should offer Hunt instead.
- Disconnect and reconnect the network. Check cached data, sync recovery and archive failure/pending behaviour.
- On a small iPhone and with larger text, scroll the console and confirm Stamp and navigation stay reachable.
