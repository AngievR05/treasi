import React, { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, TextInput, type ScrollViewProps, type ScrollViewInstance, type TextInputInstance, type TextInputProps } from 'react-native';
import { useKeyboardEditing } from '../hooks/useKeyboardEditing';

const InputHeightContext = createContext<number | null>(null);

// Keep multiline text and its internal caret scroller inside the visible area
// even on an iPhone whose landscape keyboard leaves less than one field's height.
export const FormTextInput = forwardRef<TextInputInstance, TextInputProps>((props, ref) => {
  const availableHeight = useContext(InputHeightContext);
  const baseStyle = StyleSheet.flatten(props.style);
  const maxHeight = availableHeight == null ? null : Math.min(availableHeight,
    typeof baseStyle?.maxHeight === 'number' ? baseStyle.maxHeight : availableHeight);
  const fitStyle = props.multiline && maxHeight != null ? {
    minHeight: Math.min(typeof baseStyle?.minHeight === 'number' ? baseStyle.minHeight : 44, maxHeight),
    maxHeight,
    ...(typeof baseStyle?.height === 'number' ? { height: Math.min(baseStyle.height, maxHeight) } : {}),
  } : null;
  return <TextInput {...props} ref={ref} style={[props.style, fitStyle]} />;
});

// Measure the actual viewport, since landscape split panes and modal cards can
// be shorter than the screen even after KeyboardAvoidingView resizes them.
export function keyboardScrollDelta(inputTop: number, inputHeight: number, viewportTop: number, viewportBottom: number) {
  const top = viewportTop + 12;
  const bottom = viewportBottom - 12;
  if (bottom <= top) return 0;
  if (inputHeight > bottom - top || inputTop < top) return inputTop - top;
  return Math.max(0, inputTop + inputHeight - bottom);
}

export function FormScrollView({ children, onFocusCapture, onBlurCapture, onLayout, onContentSizeChange, onScroll, ...props }: ScrollViewProps) {
  const keyboardVisible = useKeyboardEditing();
  const [viewportHeight, setViewportHeight] = useState(0);
  const scroll = useRef<ScrollViewInstance>(null);
  const focused = useRef(false);
  const offset = useRef(0);
  const frame = useRef<number | null>(null);
  const mounted = useRef(true);
  const revealInput = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const input = TextInput.State.currentlyFocusedInput();
      const viewport = scroll.current;
      if (!focused.current || !input || !viewport || !mounted.current) return;
      viewport.measureInWindow((_x, top, _width, height) => {
        if (!mounted.current || !focused.current || TextInput.State.currentlyFocusedInput() !== input) return;
        input.measureInWindow((_inputX, inputTop, _inputWidth, inputHeight) => {
          if (!mounted.current || !focused.current || TextInput.State.currentlyFocusedInput() !== input || scroll.current !== viewport) return;
          const bottom = Math.min(top + height, Keyboard.metrics()?.screenY ?? top + height);
          const delta = keyboardScrollDelta(inputTop, inputHeight, top, bottom);
          if (Math.abs(delta) > 1) viewport.scrollTo({ y: Math.max(0, offset.current + delta), animated: true });
        });
      });
    });
  }, []);
  useEffect(() => {
    mounted.current = true;
    const show = Keyboard.addListener('keyboardDidShow', revealInput);
    const resize = Keyboard.addListener('keyboardDidChangeFrame', revealInput);
    return () => {
      mounted.current = false;
      show.remove(); resize.remove();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [revealInput]);
  return <ScrollView {...props} ref={scroll}
    keyboardShouldPersistTaps={props.keyboardShouldPersistTaps ?? 'handled'}
    keyboardDismissMode={props.keyboardDismissMode ?? 'on-drag'}
    automaticallyAdjustKeyboardInsets={false}
    scrollEventThrottle={16}
    onFocusCapture={event => { focused.current = true; onFocusCapture?.(event); revealInput(); }}
    onBlurCapture={event => { focused.current = false; onBlurCapture?.(event); }}
    onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; onScroll?.(event); }}
    onLayout={event => { setViewportHeight(event.nativeEvent.layout.height); onLayout?.(event); revealInput(); }}
    onContentSizeChange={(width, height) => { onContentSizeChange?.(width, height); revealInput(); }}
  >
    <InputHeightContext.Provider value={keyboardVisible && viewportHeight > 0 ? Math.max(44, viewportHeight - 24) : null}>
      {children}
    </InputHeightContext.Provider>
  </ScrollView>;
}
