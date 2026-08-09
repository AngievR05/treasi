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
  User, 
  Lock, 
  Compass, 
  MapPin, 
  Activity, 
  RotateCw, 
  Eye, 
  EyeOff, 
  ShieldAlert 
} from 'lucide-react-native';

// Firebase Engine Integration
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';

export interface LoginScreenProps {
  onNavigateSignUp: () => void;
  onLoginSuccess: () => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onNavigateSignUp, onLoginSuccess }) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;

  // Form State
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // System & Calibration Toggles (Strictly OFF / false by default per specifications)
  const [gpsEnabled, setGpsEnabled] = useState<boolean>(false);
  const [compassEnabled, setCompassEnabled] = useState<boolean>(false);
  const [motionEnabled, setMotionEnabled] = useState<boolean>(false);

  // Button Spring Animation Scale
  const buttonScale = useSharedValue(1);

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.96);
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1);
  };

  // Firebase Auth Login Handler
  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setErrorMessage('Field protocol requires both Explorer ID and Passcode.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // 1. Authenticate with Firebase Auth
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const user = userCredential.user;

      // 2. Telemetry Sync with Firestore users collection
      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        await updateDoc(userDocRef, {
          telemetryEnabled: gpsEnabled,
          motionSensitivityEnabled: motionEnabled,
          updatedAt: Timestamp.now(),
        }).catch(() => {
          // Soft-fail non-blocking telemetry sync error
        });
      }

      onLoginSuccess();
    } catch (error: any) {
      let msg = 'Authentication failed. Please check credentials.';
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
      style={styles.keyboardContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          {
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.layoutWrapper, { flexDirection: isLandscape ? 'row' : 'column' }]}>
          
          {/* LEFT 60% PANEL: TACTILE VINTAGE ADMIT PERMIT TICKET */}
          <Animated.View
            entering={FadeInDown.duration(600)}
            style={[styles.parchmentCard, { flex: isLandscape ? 0.6 : 1 }]}
          >
            <View style={styles.dashedBorder}>
              {/* Ticket Header Metadata */}
              <View style={styles.ticketHeader}>
                <Text style={styles.ticketHeaderLabel}>ADMIT ONE · 1951</Text>
                <Text style={styles.ticketHeaderLabel}>FIELD PERMIT ★★★</Text>
              </View>

              {/* Title & Tagline */}
              <View style={styles.brandHeader}>
                <Text style={styles.brandTitle}>TREASI</Text>
                <Text style={styles.brandSubtitle}>Hide. Explore. Stay connected.</Text>
              </View>

              {/* Error Banner */}
              {errorMessage && (
                <View
                  style={styles.errorBox}
                  accessible={true}
                  accessibilityRole="alert"
                  accessibilityLabel={errorMessage}
                >
                  <ShieldAlert size={16} color="#A64B2A" />
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              )}

              {/* Credentials Form Inputs */}
              <View style={styles.inputStack}>
                {/* Email / Explorer ID Input */}
                <View style={styles.inputContainer}>
                  <User size={18} color="#2A2420" style={styles.inputIcon} />
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
                    accessibilityHint="Enter registered email address"
                  />
                </View>

                {/* Passcode Input */}
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
                    accessibilityHint="Enter field authorization code"
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
              <Animated.View style={[animatedButtonStyle, { width: '100%' }]}>
                <TouchableOpacity
                  style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
                  onPress={handleLogin}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  disabled={isLoading}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Enter the field button"
                  accessibilityHint="Submits login credentials to authorize access"
                >
                  {isLoading ? (
                    <ActivityIndicator color="#E8DCC0" />
                  ) : (
                    <Text style={styles.buttonText}>&gt;&gt; ENTER THE FIELD &lt;&lt;</Text>
                  )}
                </TouchableOpacity>
              </Animated.View>

              {/* Switch to Register */}
              <TouchableOpacity
                onPress={onNavigateSignUp}
                style={styles.linkContainer}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Register New Explorer"
                accessibilityHint="Navigates to the signup screen"
              >
                <Text style={styles.linkText}>NEW EXPEDITION? SIGN UP HERE</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* RIGHT 40% PANEL: TACTICAL CONTROL & SENSOR CONSOLE */}
          <Animated.View
            entering={FadeInRight.duration(600).delay(150)}
            style={[styles.consoleCard, { flex: isLandscape ? 0.4 : 1 }]}
          >
            {/* Console Section 1 */}
            <Text style={styles.consoleSectionTitle}>★ BEFORE YOU HEAD OUT</Text>
            
            <View style={styles.widgetBox}>
              <RotateCw size={22} color="#B08D57" style={styles.widgetIcon} />
              <View>
                <Text style={styles.widgetTitle}>ROTATE DEVICE</Text>
                <Text style={styles.widgetSubtitle}>TO BEGIN</Text>
              </View>
            </View>

            {/* Console Section 2: Sensor Pre-flight Toggles */}
            <Text style={[styles.consoleSectionTitle, { marginTop: 16 }]}>
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
                  accessibilityLabel="Enable GPS telemetry"
                  style={styles.switchTarget}
                />
              </View>

              {/* Compass Sensor Toggle */}
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
                  accessibilityLabel="Enable Compass sensor"
                  style={styles.switchTarget}
                />
              </View>

              {/* Motion Sensor Toggle */}
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
                  accessibilityLabel="Enable Motion sensor"
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
  keyboardContainer: {
    flex: 1,
    backgroundColor: '#1C261D', // Dark Forest Green Chassis
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  layoutWrapper: {
    width: '100%',
    maxWidth: 900,
    gap: 12,
    alignItems: 'stretch',
  },

  /* Parchment Left Panel Styles */
  parchmentCard: {
    backgroundColor: '#E8DCC0',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#B08D57',
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  dashedBorder: {
    borderWidth: 1.5,
    borderColor: '#A64B2A',
    borderStyle: 'dashed',
    borderRadius: 6,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 12,
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
    marginBottom: 16,
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
    fontSize: 12,
    color: '#2A2420',
    marginTop: 4,
    fontStyle: 'italic',
  },

  /* Error Banner */
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3ECD8',
    borderColor: '#A64B2A',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 12,
    gap: 8,
    width: '100%',
  },
  errorText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#A64B2A',
    fontSize: 11,
    flex: 1,
  },

  /* Form Inputs */
  inputStack: {
    width: '100%',
    gap: 10,
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    paddingHorizontal: 12,
    height: 44,
  },
  inputIcon: {
    marginRight: 10,
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
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Buttons */
  primaryButton: {
    backgroundColor: '#A64B2A',
    borderWidth: 1,
    borderColor: '#2A2420',
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48, // Ensures WCAG compliant target size
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    color: '#E8DCC0',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  linkContainer: {
    marginTop: 12,
    padding: 8,
    minHeight: 48, // Minimum touch target size
    justifyContent: 'center',
  },
  linkText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#2A2420',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
    textDecorationLine: 'underline',
  },

  /* Right Console Panel Styles */
  consoleCard: {
    backgroundColor: '#2C3B2E',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#B08D57',
    padding: 16,
    justifyContent: 'center',
  },
  consoleSectionTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 10,
    color: '#B08D57',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  widgetBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C261D',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    padding: 12,
    gap: 12,
  },
  widgetIcon: {
    marginRight: 4,
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

  /* Toggles */
  toggleList: {
    gap: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1C261D',
    borderWidth: 1,
    borderColor: '#3D503F',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    minHeight: 48,
  },
  toggleLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toggleText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 11,
    color: '#E8DCC0',
    letterSpacing: 1,
  },
  switchTarget: {
    transform: Platform.OS === 'ios' ? [{ scaleX: 0.8 }, { scaleY: 0.8 }] : [],
  },
});