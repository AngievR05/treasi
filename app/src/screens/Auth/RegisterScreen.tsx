import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { LandscapeSplitLayout } from '../../components/LandscapeSplitLayout';
import { signUpUser } from '../../config/firebase';

export const RegisterScreen = ({ navigation }: any) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!username || !email || !password) {
      Alert.alert('Field Error', 'Please complete all explorer credentials.');
      return;
    }

    setLoading(true);
    try {
      await signUpUser(email, password, username);
    } catch (error: any) {
      Alert.alert('Registration Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  const leftPanelContent = (
    <View style={styles.brandingContainer}>
      <Text style={styles.badgeText}>★ ENLIST EXPLORER ★</Text>
      <Text style={styles.titleText}>TREASI</Text>
      <Text style={styles.taglineText}>Hide. Explore. Stay connected.</Text>
    </View>
  );

  const rightPanelContent = (
    <View style={styles.formContainer}>
      <Text style={styles.sectionHeader}>NEW RECRUIT DOSSIER</Text>
      
      <TextInput
        style={styles.input}
        placeholder="EXPLORER CALLSIGN (USERNAME)"
        placeholderTextColor="#B08D57"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />

      <TextInput
        style={styles.input}
        placeholder="EMAIL ADDRESS"
        placeholderTextColor="#B08D57"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TextInput
        style={styles.input}
        placeholder="PASSPHRASE"
        placeholderTextColor="#B08D57"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity 
        style={[styles.button, loading && styles.buttonDisabled]} 
        onPress={handleRegister}
        disabled={loading}
      >
        <Text style={styles.buttonText}>{loading ? 'STAMPING PASSPORT...' : 'SEAL & JOIN FIELD'}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('Login')}>
        <Text style={styles.switchText}>Already registered? Enter the field</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <LandscapeSplitLayout
      leftPanel={leftPanelContent}
      rightPanel={rightPanelContent}
    />
  );
};

const styles = StyleSheet.create({
  brandingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2C3B2E', // Forest Deep
    padding: 20,
  },
  badgeText: {
    color: '#B08D57',
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 8,
  },
  titleText: {
    color: '#E8DCC0',
    fontSize: 36,
    fontWeight: 'bold',
    letterSpacing: 4,
  },
  taglineText: {
    color: '#E8DCC0',
    fontSize: 14,
    fontStyle: 'italic',
    marginTop: 6,
  },
  formContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#E8DCC0', // Parchment
  },
  sectionHeader: {
    color: '#2A2420',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#F3ECD8',
    borderColor: '#B08D57',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#2A2420',
    marginBottom: 12,
    fontSize: 13,
  },
  button: {
    backgroundColor: '#A64B2A', // Sienna Accent
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#E8DCC0',
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  switchText: {
    color: '#A64B2A',
    textAlign: 'center',
    marginTop: 14,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
});