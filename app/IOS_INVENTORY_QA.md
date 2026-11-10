# Inventory verification on iOS

Run `npm test` and `npm run typecheck` from `app/`.
Inventory's tests use the iOS preset and mocked Firebase and location state. The shared foreground GPS flow has its own permission, background/resume and timeout tests.

Before release, verify these paths on an iPhone with an SDK 58-compatible build:

- Open Inventory from Dashboard's Stamp action. Its coordinates should remain in the create form until deliberately replaced.
- Create a cache using current GPS and using manual coordinates. Test southern/western coordinates and decimal separators from the device keyboard.
- Change coordinate fields manually, then wait for GPS updates. Typed values must remain unchanged.
- Deny location and confirm manual creation and owned-cache management remain available. Current-position stamping requires a fresh live fix.
- Confirm a successful creation writes one treasure and one activity event, then selects the new cache. Tap repeatedly during a slow save to check duplicate prevention.
- Edit title, clue, reward and location. Confirm ownership is rechecked and failed saves retain the draft.
- Receive a live cache update while editing. Confirm it does not overwrite the draft.
- Archive and restore an owned cache. Check its visibility in Dashboard and other clients.
- Delete an archived cache after confirmation. Confirm unrelated discovery/activity history remains. A cache restored by another client must require archiving again before deletion.
- Open a confirmation, then remove the selected cache from another client. It must not silently change to a different cache.
- Confirm another explorer's reward stays hidden until discovery verification succeeds, and hides again if discovery verification fails.
- Switch accounts or leave the screen during a pending operation. Old results must not populate a new account's Inventory or erase its drafts.
- Test disconnected and reconnected states. Firestore writes can remain pending while offline; do not treat them as committed until the backend confirms them.
- Test VoiceOver access to location recovery, sync retry, all form inputs, confirmation buttons and the landscape modal.
- Test both landscape directions, larger text and the iOS keyboard. All save/cancel controls must remain reachable.

Deployed Firestore rules still determine which reads and mutations are allowed. These tests do not modify or validate production rules.
