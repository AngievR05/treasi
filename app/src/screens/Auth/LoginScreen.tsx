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
  User as UserIcon, 
  Lock, 
  Compass, 
  MapPin, 
  Activity, 
  RotateCw, 
  Eye, 
  EyeOff, 
  ShieldAlert,
  Moon,
  Zap
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

  // Pre-flight Sensor & System Calibration Toggles (Strictly OFF / false by default)
  const [gpsEnabled, setGpsEnabled] = useState<boolean>(false);
  const [compassEnabled, setCompassEnabled] = useState<boolean>(false);
  const [motionEnabled, setMotionEnabled] = useState<boolean>(false);
  const [nightModeEnabled, setNightModeEnabled] = useState<boolean>(false);

  // Micro-interaction: Tactile Button Press Spring Scale
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

  // Firebase Auth Login & Telemetry Synchronization Pipeline
  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setErrorMessage('Field protocol requires both Explorer ID and Passcode.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // 1. Authenticate credentials via Firebase Auth
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const user = userCredential.user;

      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);

        // 2. Synchronize active Pre-flight Toggles to user profile document
        const telemetryPayload: Partial<UserDocument> = {
          telemetryEnabled: gpsEnabled,
          hapticFeedbackEnabled: compassEnabled,
          motionSensitivityEnabled: motionEnabled,
          nightModeEnabled: nightModeEnabled,
          updatedAt: Timestamp.now(),
        };

        if (userDocSnap.exists()) {
          await updateDoc(userDocRef, telemetryPayload);
        } else {
          // Failsafe: Initialize document if missing
          await setDoc(userDocRef, {
            uid: user.uid,
            username: email.split('@')[0] || 'Explorer',
            email: user.email || email.trim(),
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
      let msg = 'Authentication failed. Please check field credentials.';
      if (error.code === 'auth/invalid-email') {
        msg = 'Invalid Explorer ID format.';
      } else if (
        error.code === 'auth/user-not-found' ||
        error.code === 'auth/wrong-password' ||
        error.code === 'auth/invalid-credential'
      ) {
        msg = 'Unrecognized Explorer credentials. Access denied.';
      } else if (error.code === 'auth/too-many-requests') {
        msg = 'Too many failed attempts. Terminal locked temporarily.';
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

              {/* Diagnostic Banner */}
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
                
                {/* Username / Email Input */}
                <View style={styles.inputContainer}>
                  <UserIcon size={18} color="#2A2420" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="USERNAME / EMAIL"
                    placeholderTextColor="#8C7350"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoCorrect={false}
                    accessible={true}
                    accessibilityLabel="Explorer Email Input"
                    accessibilityHint="Enter your registered email address"
                  />
                </View>

                {/* Password Input */}
                <View style={styles.inputContainer}>
                  <Lock size={18} color="#2A2420" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="PASSWORD"
                    placeholderTextColor="#8C7350"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    accessible={true}
                    accessibilityLabel="Passcode Input"
                    accessibilityHint="Enter your secret security code"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeButton}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
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
              ★ ENABLE SENSORS
            </Text>

            <View style={styles.toggleList}>
              {/* GPS Sensor Toggle */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  <MapPin size={16} color="#B08D57" />
                  <Text style={styles.toggleText}>GPS</Text>
                </View>
                <Switch
                  value={gpsEnabled}
                  onValueChange={setGpsEnabled}
                  trackColor={{ false: '#1A231B', true: '#A64B2A' }}
                  thumbColor={gpsEnabled ? '#E8DCC0' : '#B08D57'}
                  accessible={true}
                  accessibilityRole="switch"
                  accessibilityLabel="Enable GPS Telemetry"
                  style={styles.switchTarget}
                />
              </View>

              {/* Compass / Haptic Sensor Toggle */}
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  <Compass size={16} color="#B08D57" />
                  <Text style={styles.toggleText}>COMPASS</Text>
                </View>
                <Switch
                  value={compassEnabled}
                  onValueChange={setCompassEnabled}
                  trackColor={{ false: '#1A231B', true: '#A64B2A' }}
                  thumbColor={compassEnabled ? '#E8DCC0' : '#B08D57'}
                  accessible={true}
                  accessibilityRole="switch"
                  accessibilityLabel="Enable Compass Sensor"
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
                  trackColor={{ false: '#1A231B', true: '#A64B2A' }}
                  thumbColor={motionEnabled ? '#E8DCC0' : '#B08D57'}
                  accessible={true}
                  accessibilityRole="switch"
                  accessibilityLabel="Enable Motion Sense Accelerometer"
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
                  trackColor={{ false: '#1A231B', true: '#A64B2A' }}
                  thumbColor={nightModeEnabled ? '#E8DCC0' : '#B08D57'}
                  accessible={true}
                  accessibilityRole="switch"
                  accessibilityLabel="Enable Night Mode Interface"
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
    backgroundColor: '#1C261D', // Forest Green Chassis
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