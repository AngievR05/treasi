import React, { useState } from 'react';
import { 
  StyleSheet, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  View, 
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { LandscapeSplitLayout } from '../../components/LandscapeSplitLayout';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) return;
    setLoading(true);
    try {
      // Firebase Auth integration points here via useAuth hooks
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
    >
      <LandscapeSplitLayout
        // Left 60%: Thematic Branding & Skeuomorphic Aesthetic
        leftComponent={
          <View style={styles.brandingWrapper}>
            <Text style={styles.vintageTitle}>TREASI</Text>
            <View style={styles.dividerLine} />
            <Text style={styles.tagline}>"Hide. Explore. Stay connected."</Text>
            <Text style={styles.sensorStatus}>[ SYSTEM STATUS: RADAR OFFLINE ]</Text>
          </View>
        }
        // Right 40%: Ergonomic Tactical Control Console
        rightComponent={
          <View style={styles.formWrapper}>
            <Text style={styles.formTitle}>OPERATOR SIGN-IN</Text>
            
            <TextInput
              style={styles.inputField}
              placeholder="EXPEDITION EMAIL"
              placeholderTextColor="#A69E8A"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <TextInput
              style={styles.inputField}
              placeholder="ACCESS CREDENTIAL (PASSWORD)"
              placeholderTextColor="#A69E8A"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
            />

            <TouchableOpacity 
              style={[styles.stampButton, loading && styles.disabledButton]} 
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#E8DCC0" />
              ) : (
                <Text style={styles.stampButtonText}>STAMP LOCATION & ENTER</Text>
              )}
            </TouchableOpacity>
          </View>
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  brandingWrapper: {
    flex: 1,
    backgroundColor: '#2C3B2E', // Forest Deep Dark Chassis
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  vintageTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', 
    fontSize: 42,
    fontWeight: 'bold',
    color: '#E8DCC0', // Parchment Primary Tone
    letterSpacing: 6,
  },
  dividerLine: {
    width: '60%',
    height: 2,
    backgroundColor: '#B08D57', // Brass Trim Accents
    marginVertical: 16,
  },
  tagline: {
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontSize: 16,
    fontStyle: 'italic',
    color: '#E8DCC0',
    opacity: 0.8,
  },
  sensorStatus: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 11,
    color: '#A64B2A', // Sienna Alert Accent
    marginTop: 32,
    letterSpacing: 2,
  },
  formWrapper: {
    flex: 1,
    backgroundColor: '#F3ECD8', // Secondary Parchment Base Sheet
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  formTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 16,
    fontWeight: '700',
    color: '#2A2420', // Crisp Ink Black
    marginBottom: 20,
    letterSpacing: 2,
    textAlign: 'center',
  },
  inputField: {
    backgroundColor: '#E8DCC0',
    borderWidth: 1,
    borderColor: '#B08D57',
    color: '#2A2420',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 14,
    paddingHorizontal: 12,
    height: 48, // Strict WCAG compliance target size
    marginBottom: 14,
    borderRadius: 4,
  },
  stampButton: {
    backgroundColor: '#A64B2A', // High-priority Sienna CTA Stamp
    height: 50, // Massive clickable baseline ergonomics
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 4,
    marginTop: 10,
    shadowColor: '#2A2420',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  disabledButton: {
    opacity: 0.6,
  },
  stampButtonText: {
    color: '#E8DCC0',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontWeight: 'bold',
    fontSize: 14,
    letterSpacing: 1,
  },
});