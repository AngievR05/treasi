import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { Keyboard, StyleSheet, TextInput, View } from 'react-native';
import { FormScrollView, FormTextInput, keyboardScrollDelta } from '../src/components/FormScrollView';
import { KeyboardEditingBar } from '../src/components/KeyboardEditingBar';
import { useKeyboardEditing } from '../src/hooks/useKeyboardEditing';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ left: 44, right: 44 }) }));
const nativeModule = require('react-native');
let callbacks, subscriptions;
const viewport = { measureInWindow: jest.fn(), scrollTo: jest.fn() };
const input = { measureInWindow: jest.fn() };
const event = { duration: 250, easing: 'keyboard', endCoordinates: { screenY: 200, height: 190, width: 844, screenX: 0 } };
beforeEach(() => {
  jest.useFakeTimers(); callbacks = new Map(); subscriptions = [];
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  jest.spyOn(Keyboard, 'metrics').mockReturnValue(event.endCoordinates);
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, callback) => {
    const subscription = { remove: jest.fn() }; subscriptions.push(subscription);
    callbacks.set(name, [...(callbacks.get(name) ?? []), callback]); return subscription;
  });
  jest.spyOn(TextInput.State, 'currentlyFocusedInput').mockReturnValue(input);
  jest.spyOn(nativeModule, 'ScrollView', 'get').mockReturnValue(React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => viewport);
    return <View {...props} />;
  }));
  viewport.measureInWindow.mockReset().mockImplementation(callback => callback(44, 60, 756, 140));
  viewport.scrollTo.mockReset(); input.measureInWindow.mockReset().mockImplementation(callback => callback(60, 160, 300, 48));
});
afterEach(async () => { await cleanup(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
const emit = async name => act(() => { for (const callback of callbacks.get(name) ?? []) callback(event); });
const nextFrame = async () => act(() => { jest.advanceTimersByTime(20); });

test.each([
  ['field already visible', 90, 48, 60, 200, 0],
  ['field below a small landscape viewport', 180, 48, 60, 200, 40],
  ['field above the scrolled viewport', 50, 48, 60, 200, -22],
  ['large multiline field aligns to its beginning', 130, 180, 60, 200, 58],
  ['collapsed viewport does not issue a scroll', 130, 48, 60, 60, 0],
])('calculates scroll adjustment for %s', (_name, top, height, viewportTop, bottom, expected) => {
  expect(keyboardScrollDelta(top, height, viewportTop, bottom)).toBe(expected);
});
test('tracks iOS keyboard appearance before animation and restores after hide', async () => {
  const { result } = await renderHook(useKeyboardEditing); expect(result.current).toBe(false);
  await emit('keyboardWillShow'); expect(result.current).toBe(true);
  await emit('keyboardWillHide'); expect(result.current).toBe(false);
});
test('initializes correctly when a keyboard is already open', async () => {
  Keyboard.isVisible.mockReturnValue(true); const { result } = await renderHook(useKeyboardEditing); expect(result.current).toBe(true);
});
test('removes keyboard listeners on unmount', async () => {
  const view = await renderHook(useKeyboardEditing); await view.unmount(); expect(subscriptions.every(subscription => subscription.remove.mock.calls.length === 1)).toBe(true);
});
test('Done typing dismisses the keyboard without submitting or clearing the form', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {}); await render(<KeyboardEditingBar />); await fireEvent.press(screen.getByRole('button', { name: 'Done typing' })); expect(dismiss).toHaveBeenCalledTimes(1);
});
test('scrolls a newly focused field inside the measured landscape viewport', async () => {
  await render(<FormScrollView testID="form"><TextInput /></FormScrollView>);
  await fireEvent(screen.getByTestId('form'), 'focusCapture', {}); await nextFrame();
  expect(viewport.scrollTo).toHaveBeenCalledWith({ y: 20, animated: true });
});
test('remeasures focus after the keyboard and the collapsed-header layout settle', async () => {
  await render(<FormScrollView testID="form"><TextInput /></FormScrollView>);
  await fireEvent(screen.getByTestId('form'), 'focusCapture', {}); await nextFrame(); viewport.scrollTo.mockClear();
  input.measureInWindow.mockImplementation(callback => callback(60, 220, 300, 48));
  await emit('keyboardDidShow'); await nextFrame(); expect(viewport.scrollTo).toHaveBeenCalledWith({ y: 80, animated: true });
});
test('accounts for the current scroll offset and a keyboard covering part of a modal viewport', async () => {
  viewport.measureInWindow.mockImplementation(callback => callback(44, 60, 756, 300));
  await render(<FormScrollView testID="form"><TextInput /></FormScrollView>);
  await fireEvent.scroll(screen.getByTestId('form'), { nativeEvent: { contentOffset: { y: 100 } } });
  await fireEvent(screen.getByTestId('form'), 'focusCapture', {}); await nextFrame(); expect(viewport.scrollTo).toHaveBeenCalledWith({ y: 120, animated: true });
});
test('does not scroll an inactive form when another pane or modal owns focus', async () => {
  await render(<FormScrollView testID="form"><TextInput /></FormScrollView>); await emit('keyboardDidShow'); await nextFrame(); expect(viewport.scrollTo).not.toHaveBeenCalled();
});
test('drops queued measurements after the user changes fields', async () => {
  let measure; input.measureInWindow.mockImplementation(callback => { measure = callback; });
  await render(<FormScrollView testID="form"><TextInput /></FormScrollView>); await fireEvent(screen.getByTestId('form'), 'focusCapture', {}); await nextFrame();
  TextInput.State.currentlyFocusedInput.mockReturnValue({}); await act(() => measure(60, 240, 300, 48)); expect(viewport.scrollTo).not.toHaveBeenCalled();
});
test('drops queued measurements after leaving the form', async () => {
  let measure; input.measureInWindow.mockImplementation(callback => { measure = callback; });
  const view = await render(<FormScrollView testID="form"><TextInput /></FormScrollView>); await fireEvent(screen.getByTestId('form'), 'focusCapture', {}); await nextFrame(); await view.unmount();
  await act(() => measure(60, 240, 300, 48)); expect(viewport.scrollTo).not.toHaveBeenCalled();
});


test('fits a multiline field inside a tiny keyboard viewport and restores its original height afterwards', async () => {
  await render(<FormScrollView testID="form"><FormTextInput accessibilityLabel="Long clue" multiline value="Keep this clue" style={{ minHeight: 96, height: 120 }} /></FormScrollView>);
  await fireEvent(screen.getByTestId('form'), 'layout', { nativeEvent: { layout: { height: 80 } } });
  await emit('keyboardWillShow');
  expect(StyleSheet.flatten(screen.getByLabelText('Long clue').props.style)).toEqual(expect.objectContaining({ height: 56, minHeight: 56, maxHeight: 56 }));
  expect(screen.getByLabelText('Long clue')).toHaveProp('value', 'Keep this clue');
  await emit('keyboardWillHide');
  expect(StyleSheet.flatten(screen.getByLabelText('Long clue').props.style)).toEqual(expect.objectContaining({ height: 120, minHeight: 96 }));
});
