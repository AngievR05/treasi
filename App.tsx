import React from 'react';
import { StyleSheet, View, ActivityIndicator, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useAuth } from './src/hooks/useAuth';

export default function App() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const { loading } = useAuth();

  // Show an interactive loading state on boot while validating persistent session states
  if (loading) {
    return (
      <View style={[styles.loadingContainer, isLandscape && styles.landscapeBackground]}>
        <ActivityIndicator size="large" color="#38E54D" />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.appContainer}>
      <RootNavigator />
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: '#121214',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#121214',
    alignItems: 'center',
    justifyContent: 'center',
  },
  landscapeBackground: {
    backgroundColor: '#1a1a24', // Subtle visual adaptation for landscape boot screens
  },
});