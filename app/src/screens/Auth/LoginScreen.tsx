import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { FirebaseError } from 'firebase/app';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  Activity,
  Compass,
  Eye,
  EyeOff,
  Lock,
  Mail,
  MapPin,
  Moon,
  RotateCw,
  ShieldAlert,
} from 'lucide-react-native';

import { auth, db } from '../../config/firebase';
import type { UserDocument } from '../../types/firestore';

export interface LoginScreenProps {
  onNavigateSignUp: () => void;
  onLoginSuccess: () => void;
}

type FocusedField = 'email' | 'password' | null;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COLOURS = {
  forest950: '#172018',
  forest900: '#1C261D',
  forest800: '#2C3B2E',
  forest700: '#3D503F',
  parchment100: '#F6EFD9',
  parchment200: '#E8DCC0',
  ink900: '#2A2420',
  bronze600: '#6B563A',
  bronze500: '#B08D57',
  rust700: '#7F321B',
  rust600: '#8C3A20',
  white: '#FFFFFF',
} as const;

const getLoginErrorMessage = (error: unknown): string => {
  if (!(error instanceof FirebaseError)) {
    return 'Sign in could not be completed. Please try again.';
  }

  switch (error.code) {
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support for help.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'The email or passcode is incorrect.';
    case 'auth/network-request-failed':
      return 'A network connection could not be established. Check your connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many unsuccessful attempts. Wait a moment before trying again.';
    case 'auth/operation-not-allowed':
      return 'Email and passcode sign in is currently unavailable.';
    default:
      return 'Sign in could not be completed. Please try again.';
  }
};

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onNavigateSignUp,
  onLoginSuccess,
}) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;

  const passwordInputRef = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<FocusedField>(null);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [compassHapticsEnabled, setCompassHapticsEnabled] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [nightModeEnabled, setNightModeEnabled] = useState(false);

  const buttonScale = useSharedValue(1);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) {
        setReduceMotionEnabled(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotionEnabled,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const announceError = (message: string) => {
    setErrorMessage(message);
    AccessibilityInfo.announceForAccessibility(`Sign in error. ${message}`);
  };

  const clearError = () => {
    if (errorMessage) {
      setErrorMessage(null);
    }
  };

  const handlePressIn = () => {
    if (!reduceMotionEnabled) {
      buttonScale.value = withSpring(0.97, {
        damping: 16,
        stiffness: 220,
      });
    }
  };

  const handlePressOut = () => {
    if (!reduceMotionEnabled) {
      buttonScale.value = withSpring(1, {
        damping: 16,
        stiffness: 220,
      });
    }
  };

  const handleEmailChange = (text: string) => {
    setEmail(text);
    clearError();
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    clearError();
  };

  const syncExplorerPreferences = async (
    uid: string,
    authenticatedEmail: string | null,
    displayName: string | null,
  ) => {
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);
    const now = Timestamp.now();

    const preferences: Pick<
      UserDocument,
      | 'telemetryEnabled'
      | 'hapticFeedbackEnabled'
      | 'motionSensitivityEnabled'
      | 'nightModeEnabled'
      | 'updatedAt'
    > = {
      telemetryEnabled: gpsEnabled,
      hapticFeedbackEnabled: compassHapticsEnabled,
      motionSensitivityEnabled: motionEnabled,
      nightModeEnabled,
      updatedAt: now,
    };

    if (userDocSnap.exists()) {
      await setDoc(userDocRef, preferences, { merge: true });
      return;
    }

    const safeEmail = authenticatedEmail ?? email.trim().toLowerCase();
    const fallbackUsername = safeEmail.split('@')[0] || 'Explorer';

    const newUserDocument: UserDocument = {
      uid,
      username: displayName?.trim() || fallbackUsername,
      email: safeEmail,
      totalPoints: 0,
      hasCompletedOnboarding: false,
      telemetryEnabled: gpsEnabled,
      hapticFeedbackEnabled: compassHapticsEnabled,
      motionSensitivityEnabled: motionEnabled,
      batteryOptimizerEnabled: false,
      nightModeEnabled,
      skipOnboardingAuthFlow: false,
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(userDocRef, newUserDocument);
  };

  const handleLogin = async () => {
    if (isLoading) return;

    const normalisedEmail = email.trim().toLowerCase();

    if (!normalisedEmail) {
      announceError('Enter your Explorer email.');
      return;
    }

    if (!EMAIL_REGEX.test(normalisedEmail)) {
      announceError('Enter a valid email address.');
      return;
    }

    if (!password) {
      announceError('Enter your passcode.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        normalisedEmail,
        password,
      );

      try {
        await syncExplorerPreferences(
          userCredential.user.uid,
          userCredential.user.email,
          userCredential.user.displayName,
        );
      } catch (profileError: unknown) {
        console.error('[Treasi] Explorer profile synchronisation failed:', profileError);

        try {
          await signOut(auth);
        } catch (signOutError: unknown) {
          console.error('[Treasi] Cleanup sign out failed:', signOutError);
        }

        announceError(
          'Your account was verified, but Treasi could not load your field profile. Please try again.',
        );
        return;
      }

      onLoginSuccess();
    } catch (error: unknown) {
      announceError(getLoginErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const renderDecorativeIcon = (icon: React.ReactNode) => (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={styles.iconWrapper}
    >
      {icon}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.fullScreenChassis}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContainer,
          {
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View
          style={[
            styles.layoutSplitWrapper,
            { flexDirection: isLandscape ? 'row' : 'column' },
          ]}
        >
          <Animated.View
            entering={
              reduceMotionEnabled ? undefined : FadeInDown.duration(350)
            }
            style={[
              styles.parchmentCard,
              isLandscape ? styles.leftLandscape : styles.fullWidthCard,
            ]}
          >
            <View style={styles.dashedBorderFrame}>
              <View style={styles.ticketHeader}>
                <Text style={styles.ticketHeaderLabel}>ADMIT ONE · 1951</Text>
                <Text style={styles.ticketHeaderLabel}>FIELD PERMIT ★★★</Text>
              </View>

              <View style={styles.brandHeader}>
                <Text accessibilityRole="header" style={styles.brandTitle}>
                  TREASI
                </Text>
                <Text style={styles.brandSubtitle}>
                  Hide. Explore. Stay connected.
                </Text>
              </View>

              {errorMessage ? (
                <View
                  style={styles.errorBox}
                  accessible
                  accessibilityRole="alert"
                  accessibilityLiveRegion="assertive"
                  accessibilityLabel={`Sign in error. ${errorMessage}`}
                >
                  {renderDecorativeIcon(
                    <ShieldAlert
                      size={20}
                      stroke={COLOURS.rust700}
                      strokeWidth={2.25}
                    />,
                  )}
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : null}

              <View style={styles.inputStack}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.inputLabel}>EXPLORER EMAIL</Text>
                  <View
                    style={[
                      styles.inputContainer,
                      focusedField === 'email' && styles.inputContainerFocused,
                    ]}
                  >
                    {renderDecorativeIcon(
                      <Mail
                        size={20}
                        stroke={COLOURS.ink900}
                        strokeWidth={2.1}
                      />,
                    )}
                    <TextInput
                      style={styles.textInput}
                      placeholder="name@example.com"
                      placeholderTextColor={COLOURS.bronze600}
                      value={email}
                      onChangeText={handleEmailChange}
                      onFocus={() => setFocusedField('email')}
                      onBlur={() => setFocusedField(null)}
                      onSubmitEditing={() => passwordInputRef.current?.focus()}
                      autoCapitalize="none"
                      autoComplete="email"
                      keyboardType="email-address"
                      textContentType="emailAddress"
                      autoCorrect={false}
                      editable={!isLoading}
                      returnKeyType="next"
                      accessibilityLabel="Explorer email"
                      accessibilityHint="Enter the email address registered to your Treasi account."
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.inputLabel}>PASSCODE</Text>
                  <View
                    style={[
                      styles.inputContainer,
                      focusedField === 'password' && styles.inputContainerFocused,
                    ]}
                  >
                    {renderDecorativeIcon(
                      <Lock
                        size={20}
                        stroke={COLOURS.ink900}
                        strokeWidth={2.1}
                      />,
                    )}
                    <TextInput
                      ref={passwordInputRef}
                      style={styles.textInput}
                      placeholder="Enter your passcode"
                      placeholderTextColor={COLOURS.bronze600}
                      value={password}
                      onChangeText={handlePasswordChange}
                      onFocus={() => setFocusedField('password')}
                      onBlur={() => setFocusedField(null)}
                      onSubmitEditing={handleLogin}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoComplete="current-password"
                      textContentType="password"
                      autoCorrect={false}
                      editable={!isLoading}
                      returnKeyType="done"
                      accessibilityLabel="Passcode"
                      accessibilityHint="Enter the password for your Treasi account."
                    />

                    <Pressable
                      onPress={() => setShowPassword((current) => !current)}
                      disabled={isLoading}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.eyeButton,
                        pressed && styles.controlPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={
                        showPassword ? 'Hide passcode' : 'Show passcode'
                      }
                      accessibilityHint="Changes whether the passcode is visible on screen."
                      accessibilityState={{ disabled: isLoading }}
                    >
                      {showPassword ? (
                        <EyeOff
                          size={21}
                          stroke={COLOURS.ink900}
                          strokeWidth={2.1}
                        />
                      ) : (
                        <Eye
                          size={21}
                          stroke={COLOURS.ink900}
                          strokeWidth={2.1}
                        />
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>

              <Animated.View
                style={[animatedButtonStyle, styles.fullWidthContainer]}
              >
                <Pressable
                  onPress={handleLogin}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  disabled={isLoading}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && !isLoading && styles.primaryButtonPressed,
                    isLoading && styles.buttonDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={isLoading ? 'Signing in' : 'Enter the field'}
                  accessibilityHint="Signs in to Treasi with your email and passcode."
                  accessibilityState={{
                    disabled: isLoading,
                    busy: isLoading,
                  }}
                >
                  {isLoading ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator
                        size="small"
                        color={COLOURS.parchment200}
                      />
                      <Text style={styles.buttonText}>SIGNING IN…</Text>
                    </View>
                  ) : (
                    <Text style={styles.buttonText}>
                      &gt;&gt; ENTER THE FIELD &lt;&lt;
                    </Text>
                  )}
                </Pressable>
              </Animated.View>

              <Pressable
                onPress={onNavigateSignUp}
                disabled={isLoading}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.linkContainer,
                  pressed && styles.controlPressed,
                ]}
                accessibilityRole="link"
                accessibilityLabel="Register a new Explorer account"
                accessibilityHint="Opens the Treasi sign up screen."
                accessibilityState={{ disabled: isLoading }}
              >
                <Text style={styles.linkText}>
                  NEW EXPEDITION? SIGN UP HERE
                </Text>
              </Pressable>
            </View>
          </Animated.View>

          <Animated.View
            entering={
              reduceMotionEnabled
                ? undefined
                : FadeInRight.duration(350).delay(80)
            }
            style={[
              styles.consoleCard,
              isLandscape ? styles.rightLandscape : styles.fullWidthCard,
            ]}
          >
            <Text accessibilityRole="header" style={styles.consoleSectionTitle}>
              ★ BEFORE YOU HEAD OUT
            </Text>

            <View style={styles.widgetBox}>
              {renderDecorativeIcon(
                <RotateCw
                  size={24}
                  stroke={COLOURS.bronze500}
                  strokeWidth={2.15}
                />,
              )}
              <View style={styles.flexShrinkContainer}>
                <Text style={styles.widgetTitle}>ROTATE DEVICE</Text>
                <Text style={styles.widgetSubtitle}>
                  Landscape mode is required for the field interface.
                </Text>
              </View>
            </View>

            <Text
              accessibilityRole="header"
              style={[styles.consoleSectionTitle, styles.topMarginSection]}
            >
              ★ INITIALISE TELEMETRY
            </Text>

            <View style={styles.toggleList}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  {renderDecorativeIcon(
                    <MapPin
                      size={18}
                      stroke={COLOURS.bronze500}
                      strokeWidth={2.1}
                    />,
                  )}
                  <View style={styles.toggleTextGroup}>
                    <Text style={styles.toggleText}>GPS TELEMETRY</Text>
                    <Text style={styles.toggleDescription}>
                      Save GPS as your preferred field sensor.
                    </Text>
                  </View>
                </View>
                <Switch
                  value={gpsEnabled}
                  onValueChange={setGpsEnabled}
                  disabled={isLoading}
                  trackColor={{
                    false: COLOURS.forest700,
                    true: COLOURS.rust600,
                  }}
                  thumbColor={COLOURS.parchment100}
                  ios_backgroundColor={COLOURS.forest700}
                  accessibilityLabel="GPS telemetry preference"
                  accessibilityHint="Turns your saved GPS preference on or off."
                  accessibilityState={{
                    checked: gpsEnabled,
                    disabled: isLoading,
                  }}
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  {renderDecorativeIcon(
                    <Compass
                      size={18}
                      stroke={COLOURS.bronze500}
                      strokeWidth={2.1}
                    />,
                  )}
                  <View style={styles.toggleTextGroup}>
                    <Text style={styles.toggleText}>COMPASS HAPTICS</Text>
                    <Text style={styles.toggleDescription}>
                      Save directional haptic feedback as a preference.
                    </Text>
                  </View>
                </View>
                <Switch
                  value={compassHapticsEnabled}
                  onValueChange={setCompassHapticsEnabled}
                  disabled={isLoading}
                  trackColor={{
                    false: COLOURS.forest700,
                    true: COLOURS.rust600,
                  }}
                  thumbColor={COLOURS.parchment100}
                  ios_backgroundColor={COLOURS.forest700}
                  accessibilityLabel="Compass haptics preference"
                  accessibilityHint="Turns your saved compass haptics preference on or off."
                  accessibilityState={{
                    checked: compassHapticsEnabled,
                    disabled: isLoading,
                  }}
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  {renderDecorativeIcon(
                    <Activity
                      size={18}
                      stroke={COLOURS.bronze500}
                      strokeWidth={2.1}
                    />,
                  )}
                  <View style={styles.toggleTextGroup}>
                    <Text style={styles.toggleText}>MOTION SENSE</Text>
                    <Text style={styles.toggleDescription}>
                      Save accelerometer interaction as a preference.
                    </Text>
                  </View>
                </View>
                <Switch
                  value={motionEnabled}
                  onValueChange={setMotionEnabled}
                  disabled={isLoading}
                  trackColor={{
                    false: COLOURS.forest700,
                    true: COLOURS.rust600,
                  }}
                  thumbColor={COLOURS.parchment100}
                  ios_backgroundColor={COLOURS.forest700}
                  accessibilityLabel="Motion sense preference"
                  accessibilityHint="Turns your saved motion sensor preference on or off."
                  accessibilityState={{
                    checked: motionEnabled,
                    disabled: isLoading,
                  }}
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelGroup}>
                  {renderDecorativeIcon(
                    <Moon
                      size={18}
                      stroke={COLOURS.bronze500}
                      strokeWidth={2.1}
                    />,
                  )}
                  <View style={styles.toggleTextGroup}>
                    <Text style={styles.toggleText}>NIGHT MODE</Text>
                    <Text style={styles.toggleDescription}>
                      Save the darker field interface as a preference.
                    </Text>
                  </View>
                </View>
                <Switch
                  value={nightModeEnabled}
                  onValueChange={setNightModeEnabled}
                  disabled={isLoading}
                  trackColor={{
                    false: COLOURS.forest700,
                    true: COLOURS.rust600,
                  }}
                  thumbColor={COLOURS.parchment100}
                  ios_backgroundColor={COLOURS.forest700}
                  accessibilityLabel="Night mode preference"
                  accessibilityHint="Turns your saved night mode preference on or off."
                  accessibilityState={{
                    checked: nightModeEnabled,
                    disabled: isLoading,
                  }}
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
    backgroundColor: COLOURS.forest900,
  },
  scrollContainer: {
    flexGrow: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  layoutSplitWrapper: {
    width: '100%',
    maxWidth: 1180,
    gap: 16,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  leftLandscape: {
    flex: 0.6,
  },
  rightLandscape: {
    flex: 0.4,
  },
  fullWidthCard: {
    width: '100%',
  },
  fullWidthContainer: {
    width: '100%',
  },
  flexShrinkContainer: {
    flex: 1,
    minWidth: 0,
  },
  iconWrapper: {
    flexShrink: 0,
  },

  parchmentCard: {
    backgroundColor: COLOURS.parchment200,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLOURS.bronze600,
    padding: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 6,
  },
  dashedBorderFrame: {
    flex: 1,
    width: '100%',
    borderWidth: 2,
    borderColor: COLOURS.rust700,
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 16,
    justifyContent: 'center',
  },
  ticketHeader: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  ticketHeaderLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: COLOURS.bronze600,
    letterSpacing: 0.8,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 18,
  },
  brandTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 34,
    fontWeight: '900',
    color: COLOURS.ink900,
    letterSpacing: 5,
    textAlign: 'center',
  },
  brandSubtitle: {
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 14,
    lineHeight: 20,
    color: COLOURS.ink900,
    fontStyle: 'italic',
    textAlign: 'center',
  },

  errorBox: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLOURS.parchment100,
    borderColor: COLOURS.rust700,
    borderWidth: 2,
    borderRadius: 6,
  },
  errorText: {
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    color: COLOURS.rust700,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },

  inputStack: {
    width: '100%',
    gap: 14,
    marginBottom: 18,
  },
  fieldGroup: {
    width: '100%',
    gap: 6,
  },
  inputLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    color: COLOURS.ink900,
  },
  inputContainer: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    backgroundColor: COLOURS.parchment100,
    borderWidth: 2,
    borderColor: COLOURS.bronze600,
    borderRadius: 6,
  },
  inputContainerFocused: {
    borderColor: COLOURS.rust700,
    shadowColor: COLOURS.rust700,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  textInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 16,
    lineHeight: 22,
    color: COLOURS.ink900,
  },
  eyeButton: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  controlPressed: {
    opacity: 0.68,
  },

  primaryButton: {
    minHeight: 52,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLOURS.rust700,
    borderWidth: 2,
    borderColor: COLOURS.ink900,
    borderRadius: 6,
  },
  primaryButtonPressed: {
    backgroundColor: COLOURS.rust600,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    color: COLOURS.parchment200,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
  },
  linkContainer: {
    alignSelf: 'center',
    minHeight: 48,
    marginTop: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  linkText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    color: COLOURS.ink900,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
    letterSpacing: 0.7,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },

  consoleCard: {
    backgroundColor: COLOURS.forest800,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLOURS.bronze500,
    padding: 16,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 5,
  },
  consoleSectionTitle: {
    marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
    color: COLOURS.bronze500,
    letterSpacing: 1,
  },
  topMarginSection: {
    marginTop: 18,
  },
  widgetBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    padding: 12,
    backgroundColor: COLOURS.forest950,
    borderWidth: 1,
    borderColor: COLOURS.bronze500,
    borderRadius: 6,
  },
  widgetTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    color: COLOURS.parchment200,
    letterSpacing: 0.8,
  },
  widgetSubtitle: {
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
    color: COLOURS.bronze500,
  },

  toggleList: {
    gap: 8,
  },
  toggleRow: {
    minHeight: 60,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLOURS.forest950,
    borderWidth: 1,
    borderColor: COLOURS.forest700,
    borderRadius: 6,
  },
  toggleLabelGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toggleTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  toggleText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier-Bold' : 'monospace',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
    color: COLOURS.parchment200,
    letterSpacing: 0.6,
  },
  toggleDescription: {
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    lineHeight: 16,
    color: COLOURS.bronze500,
  },
});
