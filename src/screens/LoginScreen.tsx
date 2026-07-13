import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useOrientation } from '../hooks/useOrientation';

export const LoginScreen = () => {
  const { isLandscape } = useOrientation();

  return (
    <View style={[styles.container, isLandscape && styles.containerLandscape]}>
      <Text style={styles.title}>Treasi</Text>
      <Text style={styles.subtitle}>
        {isLandscape ? "Landscape Mode Detected — Side Layout Enabled" : "Hide. Explore. Stay connected."}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', padding: 20 },
  containerLandscape: { backgroundColor: '#1E293B' }, // Visual indicator for layout switches
  title: { fontSize: 32, fontWeight: 'bold', color: '#F8FAFC', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#94A3B8' },
});