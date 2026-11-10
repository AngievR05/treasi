# Settings verification on iOS

Run `npm test` and `npm run typecheck` from `app/`.
The iOS test preset exercises the screen with mocked Firebase, native settings and accessibility APIs.

Before release, check the following on an iPhone with an SDK 58-compatible build:

- Change each preference, leave Settings, reopen it and restart the app. Confirm the values persist.
- Enable Night Field and confirm text, buttons, switches and error messages remain readable. Restore defaults and confirm the normal palette returns.
- Enable Battery Saver, return to Dashboard and confirm location updates remain usable. Hunt continues using its existing accuracy settings.
- Enable location sharing in Social, then switch it off in Settings. Confirm the saved profile position is removed. Repeat with Clear Saved Position and Restore Defaults.
- Edit a callsign while new profile data arrives. The unfinished edit must remain intact. Test invalid names, existing names and a successful save.
- Test failed saves without a network connection and after reconnecting. Firestore writes can remain pending while offline; they should not be reported as successful prematurely.
- Send verification, follow the link, and return to the app. Confirm verification refreshes. Check password-reset delivery separately.
- Open system Settings and return. Confirm the screen refreshes and remains usable.
- Test sign-out confirmation, cancellation and failure recovery.
- Review onboarding in both landscape orientations and close it without resetting onboarding completion.
- Use VoiceOver to reach each switch, privacy action, identity input and modal button.
- Check the deletion sheet with the landscape keyboard and larger text. In the current app, deletion remains unavailable because no secure backend deletion handler is configured in `App.tsx`.

Callsign availability uses the existing best-effort Firestore query. Strict uniqueness across simultaneous clients requires an atomic reservation design shared with registration.
