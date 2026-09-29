import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, View, type StyleProp, type ViewStyle } from 'react-native';

/** True while the software keyboard is on screen (bottom insets are then covered by it). */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/**
 * KeyboardAvoidingView that works under a navigation header and with
 * Android 15 edge-to-edge (where the window no longer resizes for the IME).
 *
 * RN compares the keyboard's screen position with the view's frame, which is
 * relative to its parent; below a header that under-counts the overlap by the
 * header height. Measuring the view's top in the window and passing it as the
 * vertical offset makes the padding exact on both platforms.
 */
export function KeyboardAware({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const probe = useRef<View>(null);
  const [top, setTop] = useState(0);
  const onLayout = useCallback(() => {
    probe.current?.measureInWindow((_x, y) => {
      if (Number.isFinite(y)) setTop((prev) => (Math.abs(prev - y) < 1 ? prev : y));
    });
  }, []);
  return (
    <View ref={probe} style={style} onLayout={onLayout} collapsable={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={top}>
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
