import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';

interface Props {
  onNavigateLogin: () => void;
  onSignUpSuccess: () => void;
}

export const SignUpScreen: React.FC<Props> = ({ onNavigateLogin, onSignUpSuccess }) => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Authentication state
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Functional Sensor State Toggles
  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [compassEnabled, setCompassEnabled] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(true);

  // Firebase Auth + Firestore User Profile Registration
  const handleRegister = async () => {
    if (!username.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Field Error', 'Please complete all field permit coordinates (Username, Email, and Password).');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Passcode Security', 'Passcode must be at least 6 characters long.');
      return;
    }

    setLoading(true);

    try {
      // 1. Create user in Firebase Authentication
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const user = userCredential.user;

      // 2. Set Firebase Auth Display Name
      await updateProfile(user, {
        displayName: username.trim(),
      });

      // 3. Persist Explorer Profile in Cloud Firestore Schema
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        username: username.trim(),
        email: email.trim().toLowerCase(),
        totalPoints: 0, // Initial Explorer score
        createdAt: serverTimestamp(),
        preferences: {
          gpsEnabled,
          compassEnabled,
          motionEnabled,
        },
      });

      // 4. Trigger navigation callback to Dashboard
      onSignUpSuccess();
    } catch (error: any) {
      console.error('Registration Error:', error);
      let errorMessage = 'Could not register field agent.';
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'An agent is already registered under this email coordinate.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address format.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Passcode is too weak. Use a stronger passphrase.';
      }
      Alert.alert('Registration Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { flexDirection: isLandscape ? 'row' : 'column' }]}>
      {/* LEFT VIEWPORT (60%): Field Permit Card */}
      <View style={[styles.leftViewport, isLandscape ? { flex: 0.6 } : { flex: 1 }]}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.parchmentCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.headerTag}>ADMIT ONE · 1951</Text>
              <Text style={styles.headerTag}>FIELD PERMIT ★★★</Text>
            </View>

            <Text style={styles.brandTitle}>T R E A S I</Text>
            <Text style={styles.tagline}>Hide. Explore. Stay connected.</Text>

            {/* Input 1: Callsign / Username */}
            <View style={styles.inputContainer}>
              <Text style={styles.inputIcon}>👤</Text>
              <TextInput
                style={styles.input}
                placeholder="Explorer Callsign"
                placeholderTextColor="#8C8275"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="words"
              />
            </View>

            {/* Input 2: Email Coordinate */}
            <View style={styles.inputContainer}>
              <Text style={styles.inputIcon}>✉️</Text>
              <TextInput
                style={styles.input}
                placeholder="Email Coordinate"
                placeholderTextColor="#8C8275"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            {/* Input 3: Passcode */}
            <View style={styles.inputContainer}>
              <Text style={styles.inputIcon}>🔒</Text>
              <TextInput
                style={styles.input}
                placeholder="Passcode"
                placeholderTextColor="#8C8275"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            {/* Action CTA */}
            <TouchableOpacity
              style={[styles.submitButton, loading && styles.disabledButton]}
              onPress={handleRegister}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#E8DCC0" />
              ) : (
                <Text style={styles.buttonText}>&gt;&gt; REGISTER EXPEDITION &lt;&lt;</Text>
              )}
            </TouchableOpacity>

            {/* Existing User Navigation */}
            <TouchableOpacity style={styles.toggleLink} onPress={onNavigateLogin}>
              <Text style={styles.toggleText}>EXISTING AGENT? SIGN IN HERE</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      {/* RIGHT VIEWPORT (40%): Hardware & Sensor Telemetry Panel */}
      <View style={[styles.rightViewport, isLandscape ? { flex: 0.4 } : { flex: 0.8 }]}>
        <Text style={styles.panelSectionHeader}>★ BEFORE YOU HEAD OUT</Text>

        {/* Orientation Box */}
        <View style={styles.orientationBox}>
          <Text style={styles.rotaryIcon}>🔄</Text>
          <View>
            <Text style={styles.rotaryTitle}>ROTATE DEVICE</Text>
            <Text style={styles.rotarySubtitle}>TO BEGIN</Text>
          </View>
        </View>

        <Text style={styles.panelSectionHeader}>★ ENABLE SENSORS</Text>

        {/* Sensor Toggle 1: GPS */}
        <View style={styles.sensorRow}>
          <View style={styles.sensorLabelGroup}>
            <Text style={styles.sensorIcon}>🎯</Text>
            <Text style={styles.sensorLabel}>GPS</Text>
          </View>
          <Switch
            value={gpsEnabled}
            onValueChange={setGpsEnabled}
            trackColor={{ false: '#1E281F', true: '#B08D57' }}
            thumbColor={gpsEnabled ? '#E8DCC0' : '#8C8275'}
          />
        </View>

        {/* Sensor Toggle 2: Compass */}
        <View style={styles.sensorRow}>
          <View style={styles.sensorLabelGroup}>
            <Text style={styles.sensorIcon}>🧩</Text>
            <Text style={styles.sensorLabel}>COMPASS</Text>
          </View>
          <Switch
            value={compassEnabled}
            onValueChange={setCompassEnabled}
            trackColor={{ false: '#1E281F', true: '#B08D57' }}
            thumbColor={compassEnabled ? '#E8DCC0' : '#8C8275'}
          />
        </View>

        {/* Sensor Toggle 3: Motion Sense */}
        <View style={styles.sensorRow}>
          <View style={styles.sensorLabelGroup}>
            <Text style={styles.sensorIcon}>🚀</Text>
            <Text style={styles.sensorLabel}>MOTION SENSE</Text>
          </View>
          <Switch
            value={motionEnabled}
            onValueChange={setMotionEnabled}
            trackColor={{ false: '#1E281F', true: '#B08D57' }}
            thumbColor={motionEnabled ? '#E8DCC0' : '#8C8275'}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2C3B2E',
  },
  leftViewport: {
    backgroundColor: '#1E281F',
    padding: 12,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  parchmentCard: {
    backgroundColor: '#E8DCC0',
    padding: 20,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#A64B2A',
    borderStyle: 'dashed',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerTag: {
    fontFamily: 'Courier',
    fontSize: 10,
    fontWeight: 'bold',
    color: '#8C8275',
    letterSpacing: 1,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#2A2420',
    textAlign: 'center',
    letterSpacing: 6,
    fontFamily: 'Courier',
    marginTop: 4,
  },
  tagline: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#2A2420',
    textAlign: 'center',
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  inputIcon: {
    marginRight: 8,
    fontSize: 14,
  },
  input: {
    flex: 1,
    height: 40,
    color: '#2A2420',
    fontFamily: 'Courier',
    fontSize: 13,
  },
  submitButton: {
    backgroundColor: '#A64B2A',
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2A2420',
  },
  disabledButton: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#E8DCC0',
    fontWeight: 'bold',
    fontFamily: 'Courier',
    fontSize: 13,
    letterSpacing: 1,
  },
  toggleLink: {
    marginTop: 12,
    alignItems: 'center',
  },
  toggleText: {
    color: '#2A2420',
    fontSize: 11,
    fontFamily: 'Courier',
    fontWeight: 'bold',
    textDecorationLine: 'underline',
  },
  rightViewport: {
    backgroundColor: '#2C3B2E',
    padding: 20,
    justifyContent: 'center',
    borderLeftWidth: 3,
    borderColor: '#B08D57',
  },
  panelSectionHeader: {
    color: '#B08D57',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 10,
    marginTop: 8,
    fontFamily: 'Courier',
  },
  orientationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 6,
    padding: 10,
    backgroundColor: '#1E281F',
    marginBottom: 16,
  },
  rotaryIcon: {
    fontSize: 22,
    marginRight: 12,
  },
  rotaryTitle: {
    color: '#E8DCC0',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'Courier',
  },
  rotarySubtitle: {
    color: '#B08D57',
    fontSize: 10,
    fontFamily: 'Courier',
  },
  sensorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1E281F',
    marginBottom: 8,
  },
  sensorLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sensorIcon: {
    marginRight: 8,
    fontSize: 14,
  },
  sensorLabel: {
    color: '#E8DCC0',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'Courier',
  },
});