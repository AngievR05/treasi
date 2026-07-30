import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  onFinish?: () => void;
}

export const SplashScreen: React.FC<Props> = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>TREASI</Text>
      <Text style={styles.tagline}>Hide. Explore. Stay connected.</Text>
      <View style={styles.progressBar}>
        <View style={styles.progressFill} />
      </View>
      <Text style={styles.status}>Calibrating Field Sensors...</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#2C3B2E', justifyContent: 'center', alignItems: 'center' },
  title: { color: '#E8DCC0', fontSize: 36, fontWeight: 'bold', letterSpacing: 6 },
  tagline: { color: '#B08D57', fontSize: 14, fontStyle: 'italic', marginTop: 4, marginBottom: 24 },
  progressBar: { width: 220, height: 6, backgroundColor: '#1A241B', borderRadius: 3, overflow: 'hidden' },
  progressFill: { width: '65%', height: '100%', backgroundColor: '#A64B2A' },
  status: { color: '#E8DCC0', fontSize: 10, marginTop: 10, letterSpacing: 1 },
});