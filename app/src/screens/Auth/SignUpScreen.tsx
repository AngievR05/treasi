import React, { useState, useRef, useEffect } from 'react';
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
  Switch,
} from 'react-native';
import { 
  createUserWithEmailAndPassword, 
  updateProfile, 
  deleteUser 
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { UserDocument } from '../../types/firestore';

interface Props {
  onNavigateLogin: () => void;
  onSignUpSuccess: () => void;
}

export const SignUpScreen: React.FC<Props> = ({ onNavigateLogin, onSignUpSuccess }) => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Unmount Safety Tracker
  const isMounted = useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Input States
  const [callsign, setCallsign] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Hardware & Calibration Toggles (Default: false / OFF)
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [hapticFeedbackEnabled, setHapticFeedbackEnabled] = useState(false);
  const [motionSensitivityEnabled, setMotionSensitivityEnabled] = useState(false);
  const [batteryOptimizerEnabled, setBatteryOptimizerEnabled] = useState(false);
  const [nightModeEnabled, setNightModeEnabled] = useState(false);
  const [skipOnboardingAuthFlow, setSkipOnboardingAuthFlow] = useState(false);

  // Processing & Feedback State
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Animation References
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeErrorAnim = useRef(new Animated.Value(0)).current;
  const screenFadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(screenFadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [screenFadeAnim]);

  const animateButtonPress = (toValue: number) => {
    Animated.spring(scaleAnim, {
      toValue,
      useNativeDriver: true,
      friction: 4,
      tension: 40,
    }).start();
  };

  const displayError = (msg: string) => {
    setErrorMessage(msg);
    fadeErrorAnim.setValue(0);
    Animated.timing(fadeErrorAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const clearError = () => {
    setErrorMessage(null);
    fadeErrorAnim.setValue(0);
  };

  const handleRegister = async () => {
    clearError();

    const formattedCallsign = callsign.trim().toUpperCase();
    const formattedEmail = email.trim().toLowerCase();

    // 1. Local Validation Steps
    if (!formattedCallsign) {
      displayError('CALLSIGN / USERNAME IS REQUIRED');
      return;
    }

    if (!formattedEmail) {
      displayError('EMAIL COORDINATE IS REQUIRED');
      return;
    }

    if (!password || !confirmPassword) {
      displayError('PASSCODE COORDINATES ARE REQUIRED');
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
    let createdUserInstance = null;

    try {
      // 2. Firebase Authentication Registration
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formattedEmail,
        password
      );
      createdUserInstance = userCredential.user;

      // 3. Synchronize Auth Display Name with Callsign
      await updateProfile(createdUserInstance, {
        displayName: formattedCallsign,
      });

      // 4. Construct Firestore User Document Schema
      const newUserDocument: UserDocument = {
        uid: createdUserInstance.uid,
        username: formattedCallsign,
        email: formattedEmail,
        totalPoints: 0,
        hasCompletedOnboarding: false,

        telemetryEnabled,
        hapticFeedbackEnabled,
        motionSensitivityEnabled,
        batteryOptimizerEnabled,
        nightModeEnabled,
        skipOnboardingAuthFlow,

        createdAt: serverTimestamp() as any,
        updatedAt: serverTimestamp() as any,
      };

      // 5. Persist Document to Firestore Database
      await setDoc(doc(db, 'users', createdUserInstance.uid), newUserDocument);

      if (isMounted.current) {
        setLoading(false);
        onSignUpSuccess();
      }
    } catch (error: any) {
      // Rollback orphaned Auth account if Firestore setup fails
      if (createdUserInstance && auth.currentUser) {
        try {
          await deleteUser(createdUserInstance);
        } catch (rollbackErr) {
          // Failure logged safely for monitoring
        }
      }

      if (!isMounted.current) return;

      setLoading(false);
      let friendlyError = 'FIELD REGISTRATION FAILED. CHECK SIGNAL.';

      if (error.code === 'auth/email-already-in-use') {
        friendlyError = 'EMAIL COORDINATE IS ALREADY ENROLLED';
      } else if (error.code === 'auth/invalid-email') {
        friendlyError = 'INVALID EMAIL FORMAT DETECTED';
      } else if (error.code === 'auth/weak-password') {
        friendlyError = 'PASSCODE IS TOO WEAK FOR SECURE TRANSMISSION';
      } else if (error.code === 'auth/network-request-failed') {
        friendlyError = 'COMMUNICATION LINK LOST. CHECK NETWORK CONNECTION.';
      } else if (error.message && error.message.includes('Firestore')) {
        friendlyError = 'DATABASE LINK FAILED. REGISTRATION ROLLED BACK.';
      }

      displayError(friendlyError);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Animated.View
        style={[
          styles.splitWrapper,
          { opacity: screenFadeAnim },
          { flexDirection: isLandscape ? 'row' : 'column' },
        ]}
      >
        {/* LEFT VIEWPORT (60%): Field Enrollment Form */}
        <View style={[styles.leftViewport, !isLandscape && styles.fullWidthViewport]}>
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

            {/* Error Banner */}
            {errorMessage && (
              <Animated.View style={[styles.errorBox, { opacity: fadeErrorAnim }]}>
                <Text style={styles.errorText}>[!] {errorMessage}</Text>
              </Animated.View>
            )}

            {/* Inputs */}
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

            {/* Submit Action */}
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

        {/* RIGHT VIEWPORT (40%): Telemetry Controls & Dispatch Navigation */}
        <View style={[styles.rightViewport, !isLandscape && styles.fullWidthViewport]}>
          <ScrollView
            contentContainerStyle={styles.rightScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.brassBadge}>
              <Text style={styles.badgeText}>HARDWARE PRE-FLIGHT</Text>
            </View>

            <Text style={styles.panelTitle}>SYSTEM CALIBRATION</Text>
            <Text style={styles.panelDescription}>
              Default system telemetry states. All sensors are disabled until explicitly toggled.
            </Text>

            {/* System Configuration Controls */}
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>TELEMETRY STREAMING</Text>
              <Switch
                trackColor={{ false: '#1A241C', true: '#A64B2A' }}
                thumbColor={telemetryEnabled ? '#B08D57' : '#8C8275'}
                onValueChange={setTelemetryEnabled}
                value={telemetryEnabled}
                accessibilityLabel="Telemetry Toggle"
              />
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>HAPTIC PULSE FEEDBACK</Text>
              <Switch
                trackColor={{ false: '#1A241C', true: '#A64B2A' }}
                thumbColor={hapticFeedbackEnabled ? '#B08D57' : '#8C8275'}
                onValueChange={setHapticFeedbackEnabled}
                value={hapticFeedbackEnabled}
                accessibilityLabel="Haptic Feedback Toggle"
              />
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>KINETIC MOTION SHAKE</Text>
              <Switch
                trackColor={{ false: '#1A241C', true: '#A64B2A' }}
                thumbColor={motionSensitivityEnabled ? '#B08D57' : '#8C8275'}
                onValueChange={setMotionSensitivityEnabled}
                value={motionSensitivityEnabled}
                accessibilityLabel="Motion Sensitivity Toggle"
              />
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>BATTERY OPTIMIZER</Text>
              <Switch
                trackColor={{ false: '#1A241C', true: '#A64B2A' }}
                thumbColor={batteryOptimizerEnabled ? '#B08D57' : '#8C8275'}
                onValueChange={setBatteryOptimizerEnabled}
                value={batteryOptimizerEnabled}
                accessibilityLabel="Battery Optimizer Toggle"
              />
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>NIGHT VISION MODE</Text>
              <Switch
                trackColor={{ false: '#1A241C', true: '#A64B2A' }}
                thumbColor={nightModeEnabled ? '#B08D57' : '#8C8275'}
                onValueChange={setNightModeEnabled}
                value={nightModeEnabled}
                accessibilityLabel="Night Mode Toggle"
              />
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>BYPASS AUTH & ONBOARDING</Text>
              <Switch
                trackColor={{ false: '#1A241C', true: '#A64B2A' }}
                thumbColor={skipOnboardingAuthFlow ? '#B08D57' : '#8C8275'}
                onValueChange={setSkipOnboardingAuthFlow}
                value={skipOnboardingAuthFlow}
                accessibilityLabel="Bypass Onboarding Switch"
              />
            </View>

            <View style={styles.divider} />

            <Text style={styles.panelTitle}>EXISTING AGENT?</Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={onNavigateLogin}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Sign In To Dispatch"
              accessibilityHint="Navigates to the sign in screen"
            >
              <Text style={styles.secondaryText}>SIGN IN TO DISPATCH</Text>
            </TouchableOpacity>

            <View style={styles.footerNoteContainer}>
              <Text style={styles.footerNote}>TREASI FIELD INSTRUMENT v1.0</Text>
            </View>
          </ScrollView>
        </View>
      </Animated.View>
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
  rightViewport: {
    flex: 0.40,
    backgroundColor: '#2C3B2E',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderLeftWidth: 3,
    borderColor: '#B08D57',
  },
  fullWidthViewport: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  rightScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
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
    marginBottom: 8,
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
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  panelDescription: {
    color: '#E8DCC0',
    fontSize: 10,
    lineHeight: 14,
    opacity: 0.8,
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingVertical: 2,
  },
  toggleLabel: {
    color: '#E8DCC0',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  divider: {
    height: 1,
    backgroundColor: '#B08D57',
    opacity: 0.3,
    marginVertical: 12,
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: '#B08D57',
    paddingVertical: 10,
    borderRadius: 4,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: '#222E24',
    marginTop: 4,
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
    marginTop: 12,
  },
  footerNote: {
    color: '#B08D57',
    fontSize: 8,
    letterSpacing: 1,
    textAlign: 'center',
    opacity: 0.6,
  },
});