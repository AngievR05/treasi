import React from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function KeyboardEditingBar({ title = 'EDITING' }: { title?: string }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.bar, { paddingLeft: Math.max(16, insets.left), paddingRight: Math.max(16, insets.right) }]}>
    <Text numberOfLines={1} style={styles.title}>{title}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Done typing" onPress={Keyboard.dismiss} style={styles.done}>
      <Text style={styles.doneText}>DONE</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, backgroundColor: '#172018', flexShrink: 0 },
  title: { color: '#E8DCC0', fontSize: 12, flex: 1, marginRight: 12 },
  done: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: '#F6EFD9', fontWeight: '700', fontSize: 14 },
});
