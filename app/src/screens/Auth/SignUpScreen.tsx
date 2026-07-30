import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';

interface Props {
  onNavigateLogin: () => void;
  onSignUpSuccess: () => void;
}

export const SignUpScreen: React.FC<Props> = ({ onNavigateLogin, onSignUpSuccess }) => {
  return (
    <View style={styles.splitWrapper}>
      <View style={styles.leftViewport}>
        <Text style={styles.title}>FIELD ENROLLMENT</Text>
        <TextInput style={styles.input} placeholder="Explorer Callsign" placeholderTextColor="#8C8275" />
        <TextInput style={styles.input} placeholder="Email Coordinate" placeholderTextColor="#8C8275" />
        <TextInput style={styles.input} placeholder="Passcode" secureTextEntry placeholderTextColor="#8C8275" />
        <TouchableOpacity style={styles.submitButton} onPress={onSignUpSuccess}>
          <Text style={styles.buttonText}>REGISTER EXPEDITION</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.rightViewport}>
        <Text style={styles.panelTitle}>EXISTING AGENT?</Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={onNavigateLogin}>
          <Text style={styles.secondaryText}>SIGN IN</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  splitWrapper: { flex: 1, flexDirection: 'row' },
  leftViewport: { flex: 0.60, backgroundColor: '#E8DCC0', padding: 24, justifyContent: 'center' },
  rightViewport: { flex: 0.40, backgroundColor: '#2C3B2E', padding: 24, justifyContent: 'center', borderLeftWidth: 3, borderColor: '#B08D57' },
  title: { color: '#2A2420', fontSize: 20, fontWeight: 'bold', marginBottom: 16, letterSpacing: 2 },
  input: { backgroundColor: '#F3ECD8', borderWidth: 1, borderColor: '#B08D57', padding: 10, borderRadius: 4, marginBottom: 10, color: '#2A2420' },
  submitButton: { backgroundColor: '#A64B2A', padding: 12, borderRadius: 4, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#E8DCC0', fontWeight: 'bold', letterSpacing: 1 },
  panelTitle: { color: '#E8DCC0', fontSize: 14, fontWeight: 'bold', marginBottom: 12 },
  secondaryButton: { borderWidth: 1, borderColor: '#B08D57', padding: 12, borderRadius: 4, alignItems: 'center' },
  secondaryText: { color: '#B08D57', fontWeight: 'bold' },
});