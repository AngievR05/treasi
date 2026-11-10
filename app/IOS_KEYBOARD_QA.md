# Keyboard visibility checks

The app is locked to landscape, where the keyboard can leave very little usable height. While typing, Inventory collapses its fixed header and GPS bar, hides the other pane, and gives the active form the available width. Profile, Social, Login, and Sign Up use the same focused-form layout. A Done button dismisses the keyboard without saving, cancelling, or clearing a draft.

Form scrolling measures the actual visible pane or modal after keyboard/layout changes, scrolls the focused field into view, and ignores stale measurements after focus changes or unmounting. Inventory and Telegram multiline fields shrink to fit a short viewport while retaining their internal text scrolling. The original layout and input sizes return when the keyboard closes.

Verify on a physical iPhone before release, especially a small iPhone in both landscape directions:

- Inventory create: type in the title, clue, reward, latitude and longitude, including decimal keyboards. The focused input and typed text must be visible. Done must restore both panes and retain every value.
- Inventory edit: repeat for all edit fields. Switch fields with the keyboard already open, paste a long clue or reward, move the caret, and scroll within long text. Edit fields must stay mounted and retain selection/drafts during layout changes.
- Profile: edit the callsign and dismiss/reopen the keyboard. Open account deletion and focus its password field. VoiceOver must reach the modal's Done button and confirmation controls.
- Social: type a long Telegram, switch between editing and browsing, and verify the draft remains. Open callsign search and check its input, submit button, close button and Done button.
- Login and Sign Up: test email, callsign, passwords, password visibility, Next/Return navigation, and external keyboards. Informational panels must return after dismissal.
- Test larger text, predictive text, emoji keyboards, dictation, hardware keyboards, iPad floating/split keyboards, and keyboard resizing. Check both typing and manual scrolling.
- Test navigating away with a keyboard open and account changes during editing. No old field should cause a different form to scroll.

Automated tests exercise keyboard state, measured scroll adjustment, short multiline input sizing, draft retention, restoring panes, and accessible dismissal. An iOS JavaScript production export checks compilation; it does not replace native device testing.
