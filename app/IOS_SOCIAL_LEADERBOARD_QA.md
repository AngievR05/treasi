# Social and Leaderboard verification on iOS

Run `npm test` and `npm run typecheck` from `app/`. The automated tests use the iOS preset with mocked Firebase and GPS; they do not validate deployed Firebase rules.

## Backend setup

The latest-40 global dispatch query requires the `messages` composite index defined in `../firestore.indexes.json`: `type` ascending, `createdAt` descending, collection scope. Merge this definition into the Firebase project's existing index configuration and deploy it before release. No production index or rules were deployed by this change. Existing global messages need a valid `createdAt` timestamp to participate in this query.

Verify that authenticated accounts can read the directory, leaderboard, their profile, and relevant friendships, and that transactions can read both existing and absent friendship documents. Rules must enforce friendship participants and allowed status transitions, public message ownership, telemetry preferences, and atomic activity writes. Client checks alone do not enforce these permissions.

## Physical iPhone checks

- Check portrait, both landscape directions, larger text, safe areas, keyboard avoidance, and scrolling to every action. Use VoiceOver to reach nearby/request/link actions, retry buttons, callsign input, and modal controls.
- Verify the top 50, podium, own rank, points updates, equal scores, empty manifest, missing profile, and offline/reconnect states. Rankings use sequential positions; equal scores preserve Firestore’s document ID tie order, including the top-50 cutoff.
- Open Social from both Leaderboard actions and return through navigation.
- With two test accounts, send, accept, decline, resend, cancel and unlink. Repeat taps during slow requests. Change the same friendship from another device while a confirmation is open; the old action must fail safely.
- Search exact callsigns, including self, missing callsigns, duplicate names, and a callsign outside the 100-profile nearby directory. The directory is capped; search runs directly against Firestore.
- Send a Telegram. Verify one message and one activity record, newest-first ordering with more than 40 messages, draft retention after a rejected write, and no duplicate writes during repeated taps.
- Test location denied, permanently denied, services off, slow GPS, background/resume, and permission-prompt dismissal. Social requires a fresh live fix for nearby distance and publication; a Dashboard coordinate prop does not verify freshness.
- Test telemetry on/off from another device during location publication. Transactions must recheck the saved preference; disabled sharing clears a saved position. Verify retry after a failed location write.
- Switch accounts or leave during requests, search, publication, and Telegram sends. Old callbacks must not update the new account, clear its drafts, show old success alerts, or execute an old confirmation.
- Test Firestore offline operation. Friendship and location transactions require connectivity; Telegram batches can remain pending offline until Firebase confirms them.

Nearby positions reflect saved profile locations; the current schema has no independent location timestamp, so another Explorer's displayed position may be old. This change does not claim real-time presence tracking.
