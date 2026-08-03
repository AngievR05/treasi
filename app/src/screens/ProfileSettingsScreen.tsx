import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  onBack: () => void;
  onSignOut: () => void;
}

export const ProfileSettingsScreen: React.FC<Props> = ({ onBack, onSignOut }) => {
  return (
    <View style={styles.splitWrapper}>
      <View style={styles.leftViewport}>
        <Text style={styles.header}>FIELD IDENTITY CARD</Text>
        <Text style={styles.field}>AGENT: A. FINCH</Text>
        <Text style={styles.field}>PERMIT: #892-Z</Text>
        <Text style={styles.field}>STATUS: ACTIVE EXPLORER</Text>
      </View>
      <View style={styles.rightViewport}>
        <Text style={styles.panelTitle}>CALIBRATION</Text>
        <TouchableOpacity style={styles.signOutButton} onPress={onSignOut}>
          <Text style={styles.signOutText}>LOGOUT SESSION</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  splitWrapper: { flex: 1, flexDirection: 'row' },
  leftViewport: { flex: 0.60, backgroundColor: '#E8DCC0', padding: 20, justifyContent: 'center' },
  rightViewport: { flex: 0.40, backgroundColor: '#2C3B2E', padding: 20, borderLeftWidth: 3, borderColor: '#B08D57', justifyContent: 'space-between' },
  header: { color: '#2A2420', fontWeight: 'bold', fontSize: 16, marginBottom: 12 },
  field: { color: '#2A2420', fontSize: 12, marginBottom: 6, letterSpacing: 1 },
  panelTitle: { color: '#E8DCC0', fontWeight: 'bold', fontSize: 16 },
  signOutButton: { backgroundColor: '#A64B2A', padding: 10, borderRadius: 4, alignItems: 'center' },
  signOutText: { color: '#E8DCC0', fontWeight: 'bold', fontSize: 10 },
  backButton: { borderWidth: 1, borderColor: '#B08D57', padding: 10, borderRadius: 4, alignItems: 'center' },
  backText: { color: '#B08D57', fontWeight: 'bold' },
});