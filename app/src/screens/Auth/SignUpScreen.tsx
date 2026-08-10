import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  useWindowDimensions,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { UserDocument } from '../../types/firestore';

interface Props {
  onNavigateLogin: () => void;
  onSignUpSuccess: () => void;
}

export const SignUpScreen: React.FC<Props> = ({ onNavigateLogin, onSignUpSuccess }) => {
  const { width, height } = useWindowDimensions();

  // Form State
  const [callsign, setCallsign] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI & Feedback State
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Animation Refs
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeErrorAnim = useRef(new Animated.Value(0)).current;

  // Micro-interaction: Button Press Spring Tween
  const animateButtonPress = (toValue: number) => {
    Animated.spring(scaleAnim, {
      toValue,
      useNativeDriver: true,
      friction: 4,
    }).start();
  };

  // Micro-interaction: Smooth Error Banner Fade
  const displayError = (msg: string) => {
    setErrorMessage(msg);
    Animated.timing(fadeErrorAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  };

  const clearError = () => {
    setErrorMessage(null);
    fadeErrorAnim.setValue(0);
  };

  // Firebase Registration Pipeline
  const handleRegister = async () => {
    clearError();

    // Validation checks
    if (!callsign.trim() || !email.trim() || !password || !confirmPassword) {
      displayError('ALL FIELD COORDINATES ARE REQUIRED');
      return;
    }

    if (password !== confirmPassword) {
      displayError('PASSCODES DO NOT MATCH');
      return;
    }

    if (password.length < 6) {
      displayError('PASSCODE MUST BE AT LEAST 6 CHARACTERS');
      return;
    }

    setLoading(true);

    try {
      // 1. Create Authentication Account
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const user = userCredential.user;

      // 2. Prepare UserDocument matching src/types/firestore.ts (All toggles default OFF / false)
      const newUserDocument: UserDocument = {
        uid: user.uid,
        username: callsign.trim(),
        email: email.trim().toLowerCase(),
        totalPoints: 0,
        hasCompletedOnboarding: false,

        // System & Calibration Toggles (Default: false / OFF)
        telemetryEnabled: false,
        hapticFeedbackEnabled: false,
        motionSensitivityEnabled: false,
        batteryOptimizerEnabled: false,
        nightModeEnabled: false,

        // Persistent bypass toggle (Default: false / OFF)
        skipOnboardingAuthFlow: false,

        createdAt: serverTimestamp() as any,
        updatedAt: serverTimestamp() as any,
      };

      // 3. Write Document to Firestore 'users' collection
      await setDoc(doc(db, 'users', user.uid), newUserDocument);

      setLoading(false);
      onSignUpSuccess();
    } catch (error: any) {
      setLoading(false);
      let friendlyError = 'FIELD REGISTRATION FAILED. CHECK SIGNAL.';

      if (error.code === 'auth/email-already-in-use') {
        friendlyError = 'EMAIL COORDINATE IS ALREADY ENROLLED';
      } else if (error.code === 'auth/invalid-email') {
        friendlyError = 'INVALID EMAIL FORMAT DETECTED';
      } else if (error.code === 'auth/weak-password') {
        friendlyError = 'PASSCODE IS TOO WEAK FOR SECURE FIELD TRANSMISSION';
      }

      displayError(friendlyError);
    }
  };

  const isLandscape = width > height;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.splitWrapper, { flexDirection: isLandscape ? 'row' : 'column' }]}>
        
        {/* LEFT VIEWPORT (60%): Field Enrollment Form */}
        <View style={styles.leftViewport}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.headerBlock}>
              <Text style={styles.permitHeader}>ADMIT ONE · FIELD PERMIT</Text>
              <Text style={styles.title}>FIELD ENROLLMENT</Text>
              <Text style={styles.subtitle}>ESTABLISH YOUR EXPLORER IDENTITY</Text>
            </View>

            {/* Animated Error Banner */}
            {errorMessage && (
              <Animated.View style={[styles.errorBox, { opacity: fadeErrorAnim }]}>
                <Text style={styles.errorText}>[!] {errorMessage}</Text>
              </Animated.View>
            )}

            {/* Input Form Fields */}
            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>CALLSIGN / USERNAME</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. RANGER_JACK"
                placeholderTextColor="#8C8275"
                value={callsign}
                onChangeText={setCallsign}
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel="Explorer Callsign Input"
                accessibilityHint="Enter your unique explorer display name"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>EMAIL COORDINATE</Text>
              <TextInput
                style={styles.input}
                placeholder="agent@treasi.io"
                placeholderTextColor="#8C8275"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Email Coordinate Input"
                accessibilityHint="Enter your registered email address"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>PASSCODE</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="#8C8275"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                accessibilityLabel="Passcode Input"
                accessibilityHint="Enter a secure passcode of at least six characters"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>CONFIRM PASSCODE</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="#8C8275"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                accessibilityLabel="Confirm Passcode Input"
                accessibilityHint="Re-enter your passcode to confirm"
              />
            </View>

            {/* Submit CTA Button with Scale Tween */}
            <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
              <TouchableOpacity
                style={[styles.submitButton, loading && styles.buttonDisabled]}
                onPress={handleRegister}
                onPressIn={() => animateButtonPress(0.97)}
                onPressOut={() => animateButtonPress(1)}
                disabled={loading}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Register Expedition"
                accessibilityHint="Submits your registration data to start your expedition"
              >
                {loading ? (
                  <ActivityIndicator color="#E8DCC0" size="small" />
                ) : (
                  <Text style={styles.buttonText}>&gt;&gt; REGISTER EXPEDITION &lt;&lt;</Text>
                )}
              </TouchableOpacity>
            </Animated.View>
          </ScrollView>
        </View>

        {/* RIGHT VIEWPORT (40%): Secondary Action & Control Panel */}
        <View style={styles.rightViewport}>
          <View style={styles.rightContent}>
            <View style={styles.brassBadge}>
              <Text style={styles.badgeText}>COMMUNICATION LINK</Text>
            </View>

            <Text style={styles.panelTitle}>EXISTING AGENT?</Text>
            <Text style={styles.panelDescription}>
              If you already hold active clearance credentials, return to the dispatch desk to authenticate.
            </Text>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={onNavigateLogin}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Sign In"
              accessibilityHint="Navigates to the sign in screen"
            >
              <Text style={styles.secondaryText}>SIGN IN TO DISPATCH</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footerNoteContainer}>
            <Text style={styles.footerNote}>TREASI FIELD INSTRUMENT v1.0</Text>
          </View>
        </View>

      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2C3B2E',
  },
  splitWrapper: {
    flex: 1,
  },
  leftViewport: {
    flex: 0.60,
    backgroundColor: '#E8DCC0',
    paddingHorizontal: 24,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  rightViewport: {
    flex: 0.40,
    backgroundColor: '#2C3B2E',
    padding: 24,
    justifyContent: 'space-between',
    borderLeftWidth: 3,
    borderColor: '#B08D57',
  },
  rightContent: {
    justifyContent: 'center',
    flex: 1,
  },
  headerBlock: {
    marginBottom: 10,
  },
  permitHeader: {
    color: '#8C8275',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  title: {
    color: '#2A2420',
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  subtitle: {
    color: '#A64B2A',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 2,
  },
  formGroup: {
    marginBottom: 8,
  },
  inputLabel: {
    color: '#2A2420',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 3,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  input: {
    backgroundColor: '#F3ECD8',
    borderWidth: 1.5,
    borderColor: '#B08D57',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    color: '#2A2420',
    fontSize: 13,
    minHeight: 44,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  submitButton: {
    backgroundColor: '#A64B2A',
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 10,
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A2420',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#E8DCC0',
    fontWeight: 'bold',
    fontSize: 12,
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  errorBox: {
    backgroundColor: '#2A2420',
    borderLeftWidth: 4,
    borderLeftColor: '#A64B2A',
    padding: 8,
    marginBottom: 10,
    borderRadius: 2,
  },
  errorText: {
    color: '#E8DCC0',
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  brassBadge: {
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: 12,
    borderRadius: 2,
    backgroundColor: '#222E24',
  },
  badgeText: {
    color: '#B08D57',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  panelTitle: {
    color: '#E8DCC0',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  panelDescription: {
    color: '#E8DCC0',
    fontSize: 11,
    lineHeight: 16,
    opacity: 0.8,
    marginBottom: 20,
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: '#B08D57',
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: '#222E24',
  },
  secondaryText: {
    color: '#B08D57',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  footerNoteContainer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(176, 141, 87, 0.3)',
    paddingTop: 8,
  },
  footerNote: {
    color: '#B08D57',
    fontSize: 8,
    letterSpacing: 1,
    textAlign: 'center',
    opacity: 0.6,
  },
});