import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';

// 1. Define and export the Screen Props interface
export interface LoginScreenProps {
  onNavigateSignUp: () => void;
  onLoginSuccess: () => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onNavigateSignUp, onLoginSuccess }) => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  return (
    <View style={[styles.container, { flexDirection: isLandscape ? 'row' : 'column' }]}>
      {/* Tactical / Vintage Login Form */}
      <View style={styles.formPanel}>
        <Text style={styles.title}>FIELD AUTHENTICATION</Text>
        <Text style={styles.subtitle}>Identify yourself, Explorer.</Text>

        {/* Action Triggers */}
        <TouchableOpacity style={styles.primaryButton} onPress={onLoginSuccess}>
          <Text style={styles.buttonText}>ENTER THE FIELD</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onNavigateSignUp} style={styles.linkContainer}>
          <Text style={styles.linkText}>Need credentials? Register New Explorer</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default LoginScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2C3B2E', // Forest Deep
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  formPanel: {
    width: '80%',
    maxWidth: 500,
    backgroundColor: '#E8DCC0', // Parchment
    padding: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#B08D57', // Brass Trim
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2A2420', // Ink Black
    textAlign: 'center',
    letterSpacing: 1.5,
  },
  subtitle: {
    fontSize: 12,
    color: '#A64B2A', // Sienna Accent
    textAlign: 'center',
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: '#A64B2A',
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonText: {
    color: '#E8DCC0',
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  linkContainer: {
    marginTop: 16,
    alignItems: 'center',
  },
  linkText: {
    color: '#2A2420',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
});