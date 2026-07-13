import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export const OnboardingScreen = () => (
  <View style={styles.container}>
    <Text style={styles.text}>Onboarding Hub</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: 20, color: '#F8FAFC' },
});