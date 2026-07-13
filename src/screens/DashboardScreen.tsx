import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export const DashboardScreen = () => (
  <View style={styles.container}>
    <Text style={styles.text}>Treasi Dashboard Summary</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: 20, color: '#F8FAFC' },
});