import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Switch,
  useWindowDimensions,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { 
  Mail, 
  Lock, 
  Compass, 
  MapPin, 
  Activity, 
  RotateCw, 
  Eye, 
  EyeOff, 
  ShieldAlert,
  Moon
} from 'lucide-react-native';

// Firebase Auth & Firestore Engine
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { UserDocument } from '../../types/firestore';

export interface LoginScreenProps {
  onNavigateSignUp: () => void;
  onLoginSuccess: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LoginScreen: React.FC<LoginScreenProps> = ({ 
  onNavigateSignUp, 
  onLoginSuccess 
}) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;

  // Form State
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Pre-flight Sensor & System Calibration Toggles (Default: OFF / false)
  const [gpsEnabled, setGpsEnabled] = useState<boolean>(false);
  const [compassHapticsEnabled, setCompassHapticsEnabled] = useState<boolean>(false);
  const [motionEnabled, setMotionEnabled] = useState<boolean>(false);
  const [nightModeEnabled, setNightModeEnabled] = useState<boolean>(false);

  // Tactile Button Press Spring Scale
  const buttonScale = useSharedValue(1);

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.96, { damping: 12, stiffness: 200 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 12, stiffness: 200 });
  };

  // Error clearing helpers on user typing
  const handleEmailChange = (text: string) => {
    setEmail(text);
    if (errorMessage) setErrorMessage(null);
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    if (errorMessage) setErrorMessage(null);
  };

  // Firebase Auth Login & Telemetry Synchronization Pipeline
  const handleLogin = async () => {
    if (isLoading) return;

    const trimmedEmail = email.trim();

    // 1. Empty email validation
    if (!trimmedEmail) {
      setErrorMessage('Please enter your Explorer Email.');
      return;
    }

    // 2. Email format validation
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid Explorer Email address.');
      return;
    }

    // 3. Empty password validation
    if (!password) {
      setErrorMessage('Please enter your Passcode.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // Authenticate credentials via Firebase Auth
      const userCredential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
      const user = userCredential.user;

      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);

        // Synchronize active Pre-flight Toggles to user profile document
        const telemetryPayload: Partial<UserDocument> = {
          telemetryEnabled: gpsEnabled,
          hapticFeedbackEnabled: compassHapticsEnabled,
          motionSensitivityEnabled: motionEnabled,
          nightModeEnabled: nightModeEnabled,
          updatedAt: Timestamp.now(),
        };

        if (userDocSnap.exists()) {
          await updateDoc(userDocRef, telemetryPayload);
        } else {
          // Failsafe: Initialize user document if missing in Firestore
          await setDoc(userDocRef, {
            uid: user.uid,
            username: trimmedEmail.split('@')[0] || 'Explorer',
            email: user.email || trimmedEmail,
            totalPoints: 0,
            hasCompletedOnboarding: false,
            batteryOptimizerEnabled: false,
            skipOnboardingAuthFlow: false,
            createdAt: Timestamp.now(),
            ...telemetryPayload,
          });
        }
      }

      onLoginSuccess();
    } catch (error: any) {
      let msg = 'Something went wrong while signing in. Please try again.';
      const errorCode = error?.code;

      if (errorCode === 'auth/network-request-failed') {
        msg = 'Unable to connect. Check telemetry signal and retry.';
      } else if (errorCode === 'auth/invalid-email') {
        msg = 'Please enter a valid Explorer Email address.';
      } else if (
        errorCode === 'auth/user-not-found' ||
        errorCode === 'auth/wrong-password' ||
        errorCode === 'auth/invalid-credential'
      ) {
        msg = 'Incorrect Explorer Email or Passcode.';
      } else if (errorCode === 'auth/too-many-requests') {
        msg = 'Too many failed attempts. Terminal locked temporarily. Try again shortly.';
      } else if (
        errorCode === 'auth/unavailable' ||
        errorCode === 'auth/internal-error'
      ) {
        msg = 'Firebase Authentication service offline. Retry in a moment.';
      }
      
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.fullScreenChassis}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContainer,
          {
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
            paddingTop: Math.max(insets.top, 12),
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View 
          style={[
            styles.layoutSplitWrapper, 
            { flexDirection: isLandscape ? 'row' : 'column' }
          ]}
        >
          
          {/* LEFT PANEL (60% Width in Landscape): VINTAGE ADMIT PERMIT TICKET */}
          <Animated.View
            entering={FadeInDown.duration(500)}
            style={[
              styles.parchmentCard, 
              { flex: isLandscape ? 0.6 : 1 }
            ]}
          >
            <View style={styles.dashedBorderFrame}>
              
              {/* Header Metadata */}
              <View style={styles.ticketHeader}>
                <Text style={styles.ticketHeaderLabel}>ADMIT ONE · 1951</Text>
                <Text style={styles.ticketHeaderLabel}>FIELD PERMIT ★★★</Text>
              </View>

              {/* Branding Titles */}
              <View style={styles.brandHeader}>
                <Text style={styles.brandTitle}>TREASI</Text>
                <Text style={styles.brandSubtitle}>Hide. Explore. Stay connected.</Text>
              </View>

              {/* Diagnostic Error Banner */}
              {errorMessage && (
                <View
                  style={styles.errorBox}
                  accessible={true}
                  accessibilityRole="alert"
                  accessibilityLabel={`Error: ${errorMessage}`}
                >
                  <ShieldAlert size={16} color="#A64B2A" />
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              )}

              {/* Form Input Stack */}
              <View style={styles.inputStack}>
                
                {/* Explorer Email Input */}
                <View style={styles.inputContainer}>
                  <Mail size={18} color="#2A2420" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="EXPLORER EMAIL"
                    placeholderTextColor="#8C7350"
                    value={email}
                    onChangeText={handleEmailChange}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoCorrect={false}
                    editable={!isLoading}
                    accessible={true}
                    accessibilityLabel="Explorer Email Input"
                    accessibilityHint="Enter your registered explorer email address"
                  />
                </View>

                {/* Passcode Input */}
                <View style={styles.inputContainer}>
                  <Lock size={18} color="#2A2420" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="PASSCODE"
                    placeholderTextColor="#8C7350"
                    value={password}
                    onChangeText={handlePasswordChange}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    editable={!isLoading}
                    accessible={true}
                    accessibilityLabel="Passcode Input"
                    accessibilityHint="Enter your secret security passcode"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((prev) => !prev)}
                    style={styles.eyeButton}
                    disabled={isLoading}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide passcode' : 'Show passcode'}
                    accessibilityHint="Toggles security passcode text visibility"
                  >
                    {showPassword ? (
                      <EyeOff size={18} color="#2A2420" />
                    ) : (
                      <Eye size={18} color="#2A2420" />
                    )}
                  </TouchableOpacity>
                </View>

              </View>

              {/* Primary Action Button */}
              <Animated.View style={[animatedButtonStyle, styles.fullWidthContainer]}>
                <TouchableOpacity
                  style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
                  onPress={handleLogin}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  disabled={isLoading}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Enter the field button"
                  accessibilityHint="Submits login credentials to authenticate session"
                >
                  {isLoading ? (
                    <ActivityIndicator color="#E8DCC0" />
                  ) : (
                    <Text style={styles.buttonText}>&gt;&gt; ENTER THE FIELD &lt;&lt;</Text>
                  )}
                </TouchableOpacity>
              </Animated.View>

              {/* Registration Link */}
              <TouchableOpacity
                onPress={onNavigateSignUp}
                disabled={isLoading}
                style={styles.linkContainer}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Register New Explorer"
                accessibilityHint="Navigates to the sign up screen"
              >
                <Text style={styles.linkText}>NEW EXPEDITION? SIGN UP HERE</Text>
              </TouchableOpacity>

            </View>
          </Animated.View>

          {/* RIGHT PANEL (40% Width in Landscape): TACTICAL CONTROL & SENSOR CONSOLE */}
          <Animated.View
            entering={FadeInRight.duration(500).delay(100)}
            style={[
              styles.consoleCard, 
              { flex: isLandscape ? 0.4 : 1 }
            ]}
          >
            {/* Guidance Section */}
            <Text style={styles.consoleSectionTitle}>★ BEFORE YOU HEAD OUT</Text>
            
            <View style={styles.widgetBox}>
              <RotateCw size={22} color="#B08D57" style={styles.widgetIcon} />
              <View style={styles.flexShrinkContainer}>
                <Text style={styles.widgetTitle}>ROTATE DEVICE</Text>
                <Text style={styles.widgetSubtitle}>TO BEGIN</Text>
              </View>
            </View>

            {/* Pre-flight Sensor Toggles Section */}
            <Text style={[styles.consoleSectionTitle, styles.topMarginSection]}>
              ★ INITIALIZE TELEMETRY
            </Text>

            <View style={styles.toggleList}>
              {/* GPS Sensor Toggle */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  <MapPin size={16} color="#B08D57" />
                  <Text style={styles.toggleText}>GPS TELEMETRY</Text>
                </View>
                <Switch
                  value={gpsEnabled}
                  onValueChange={setGpsEnabled}
                  disabled={isLoading}
                  trackColor={{ false: '#1A231B', true: '#A64B2A' }}
                  thumbColor={gpsEnabled ? '#E8DCC0' : '#B08D57'}
                  accessible={true}
                  accessibilityRole="switch"
                  accessibilityLabel="Enable GPS Telemetry"
                  accessibilityState={{ checked: gpsEnabled }}
                  style={styles.switchTarget}
                />
              </View>

              {/* Compass Haptics Toggle */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  <Compass size={16} color="#B08D57" />
                  <Text style={styles.toggleText}>COMPASS HAPTICS</Text>
                </View>
                <Switch
                  value={compassHapticsEnabled}
                  onValueChange={setCompassHapticsEnabled}
                  disabled={isLoading}
                  trackColor={{ false: '#1A231B', true: '#A64B2A' }}
                  thumbColor={compassHapticsEnabled ? '#E8DCC0' : '#B08D57'}
                  accessible={true}
                  accessibilityRole="switch"
                  accessibilityLabel="Enable Compass Heading Haptic Pulses"
                  accessibilityState={{ checked: compassHapticsEnabled }}
                  style={styles.switchTarget}
                />
              </View>

              {/* Motion Sense Toggle */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  <Activity size={16} color="#B08D57" />
                  <Text style={styles.toggleText}>MOTION SENSE</Text>
                </View>
                <Switch
                  value={motionEnabled}
                  onValueChange={setMotionEnabled}
                  disabled={isLoading}
                  trackColor={{ false: '#1A231B', true: '#A64B2A' }}
                  thumbColor={motionEnabled ? '#E8DCC0' : '#B08D57'}
                  accessible={true}
                  accessibilityRole="switch"
                  accessibilityLabel="Enable Motion Sense Accelerometer"
                  accessibilityState={{ checked: motionEnabled }}
                  style={styles.switchTarget}
                />
              </View>

              {/* Night Mode Toggle */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  <Moon size={16} color="#B08D57" />
                  <Text style={styles.toggleText}>NIGHT MODE</Text>
                </View>
                <Switch
                  value={nightModeEnabled}
                  onValueChange={setNightModeEnabled}
                  disabled={isLoading}
                  trackColor={{ false: '#1A231B', true: '#A64B2A' }}
                  thumbColor={nightModeEnabled ? '#E8DCC0' : '#B08D57'}
                  accessible={true}
                  accessibilityRole="switch"
                  accessibilityLabel="Enable Night Mode Interface"
                  accessibilityState={{ checked: nightModeEnabled }}
                  style={styles.switchTarget}
                />
              </View>
            </View>
          </Animated.View>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default LoginScreen;

const styles = StyleSheet.create({
  fullScreenChassis: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#1C261D',
  },
  scrollContainer: {
    flexGrow: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  layoutSplitWrapper: {
    width: '100%',
    height: '100%',
    gap: 12,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  fullWidthContainer: {
    width: '100%',
  },
  flexShrinkContainer: {
    flex: 1,
  },

  /* LEFT PANEL: PARCHMENT PERMIT CARD */
  parchmentCard: {
    backgroundColor: '#E8DCC0',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#B08D57',
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
    justifyContent: 'center',
  },
  dashedBorderFrame: {
    borderWidth: 1.5,
    borderColor: '#A64B2A',
    borderStyle: 'dashed',
    borderRadius: 6,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 8,
  },
  ticketHeaderLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 10,
    fontWeight: 'bold',
    color: '#8C7350',
    letterSpacing: 1,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 12,
  },
  brandTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 32,
    fontWeight: '900',
    color: '#2A2420',
    letterSpacing: 6,
  },
  brandSubtitle: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    color: '#2A2420',
    marginTop: 2,
    fontStyle: 'italic',
  },

  /* DIAGNOSTIC ERROR BANNER */
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3ECD8',
    borderColor: '#A64B2A',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
    gap: 8,
    width: '100%',
  },
  errorText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#A64B2A',
    fontSize: 11,
    flex: 1,
  },

  /* INPUT FIELDS */
  inputStack: {
    width: '100%',
    gap: 8,
    marginBottom: 12,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    paddingHorizontal: 10,
    height: 44,
  },
  inputIcon: {
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 12,
    color: '#2A2420',
    letterSpacing: 1,
  },
  eyeButton: {
    padding: 6,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* ACTION BUTTONS */
  primaryButton: {
    backgroundColor: '#A64B2A',
    borderWidth: 1,
    borderColor: '#2A2420',
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    color: '#E8DCC0',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  linkContainer: {
    marginTop: 8,
    padding: 6,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  linkText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#2A2420',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
    textDecorationLine: 'underline',
  },

  /* RIGHT PANEL: CONTROL CONSOLE */
  consoleCard: {
    backgroundColor: '#2C3B2E',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#B08D57',
    padding: 14,
    justifyContent: 'center',
  },
  consoleSectionTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 10,
    color: '#B08D57',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  topMarginSection: {
    marginTop: 12,
  },
  widgetBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C261D',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    padding: 10,
    gap: 10,
  },
  widgetIcon: {
    marginRight: 2,
  },
  widgetTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 11,
    color: '#E8DCC0',
    letterSpacing: 1,
  },
  widgetSubtitle: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 9,
    color: '#B08D57',
    letterSpacing: 1,
  },

  /* TOGGLES */
  toggleList: {
    gap: 6,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1C261D',
    borderWidth: 1,
    borderColor: '#3D503F',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 2,
    minHeight: 44,
  },
  toggleLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 10,
    color: '#E8DCC0',
    letterSpacing: 1,
  },
  switchTarget: {
    transform: Platform.OS === 'ios' ? [{ scaleX: 0.8 }, { scaleY: 0.8 }] : [],
  },
});