# Hunt verification on iOS

Run `npm test` and `npm run typecheck` from `app/`.
Hunt's regression suite uses the iOS Jest preset with mocked GPS, heading, motion, haptics, authentication and Firestore transactions.

Verify on a physical iPhone with an SDK 58-compatible build before release:

- Select another explorer's active cache and check target title, hint, image, distance and bearing.
- Hold the phone in each landscape orientation. Point the top edge of the displayed compass north and compare the heading with a trusted compass. Verify portrait and upside-down behaviour where the device allows it.
- Enable location from Hunt. The iOS permission sheet must not cancel the request. Deny permission, then restore it in Settings and return.
- Try Precise Location on and off. Excavation requires a live fix no older than 12 seconds, horizontal accuracy of 15 metres or better, and a reported distance within 5 metres.
- Stand still until the GPS fix expires, then use Retry Location. Test poor reception outdoors and indoors; an acquisition timeout must expose recovery.
- Interrupt GPS or heading updates. The compass must offer a numerical bearing fallback, and stale GPS must not allow excavation.
- Excavate using the tap control. Confirm one discovery, one 100-point increase and one activity event. Reopen the cache and confirm it cannot award points again.
- Try shake excavation with ordinary movement, deliberate shaking and the sensitivity preference on/off. Tap must remain usable when motion permission or hardware is unavailable.
- Toggle haptic feedback in Settings and verify success feedback respects it.
- Move or archive the cache from another client during excavation. Confirm an out-of-range, archived or missing cache cannot award points.
- Background Hunt and resume. No queued shake should excavate in the background, and a new live fix is required on return.
- Switch targets or accounts while an operation is pending. An old result must not unlock the new target or change the new account's displayed score.
- Test failed transactions and reconnecting. Confirm failures offer retry without revealing an unrecorded reward.
- Open the photo viewer in both landscape orientations and with VoiceOver. Check its close controls and image-error fallback.

These checks also depend on the deployed Firebase rules. Proximity verification remains client-side; preventing deliberately modified clients from faking discoveries requires trusted backend validation.

The iOS orientation correction follows Core Location's [portrait heading reference](https://developer.apple.com/documentation/corelocation/cllocationmanager/headingorientation) and UIKit's [interface orientation definitions](https://developer.apple.com/documentation/uikit/uiinterfaceorientation).
