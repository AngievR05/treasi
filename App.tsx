import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';

export default function App() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  return (
    <View style={[styles.container, isLandscape && styles.landscapeBackground]}>
      <Text style={styles.title}>Treasi Scaffolding Complete 🗺️</Text>
      <Text style={styles.subtitle}>
        Orientation: {isLandscape ? "Landscape 🌅" : "Portrait 📱"}
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121214',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  landscapeBackground: {
    backgroundColor: '#1a1a24', // Subtle visual cue when shifting to landscape
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#8b8b93',
    fontSize: 16,
  },
});