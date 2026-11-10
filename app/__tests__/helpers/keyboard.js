import { act } from '@testing-library/react-native';
import { Keyboard } from 'react-native';

export function observeKeyboard() {
  const callbacks = new Map();
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, callback) => {
    const items = callbacks.get(name) ?? new Set(); items.add(callback); callbacks.set(name, items);
    return { remove: () => items.delete(callback) };
  });
  const event = { duration: 250, easing: 'keyboard', endCoordinates: { screenY: 200, height: 190, width: 844, screenX: 0 } };
  return async visible => act(() => {
    for (const callback of [...(callbacks.get(visible ? 'keyboardWillShow' : 'keyboardWillHide') ?? [])]) callback(event);
  });
}
