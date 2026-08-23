import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';

import { FirebaseError } from 'firebase/app';

import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type WithFieldValue,
} from 'firebase/firestore';

import {
  auth,
  db,
} from '../../config/firebase';

import type {
  UserDocument,
} from '../../types/firestore';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface LoginScreenProps {
  onNavigateSignUp: () => void;

  onLoginSuccess: () => void;
}

type FocusedField =
  | 'email'
  | 'password'
  | null;

type LoginStage =
  | 'idle'
  | 'authenticating'
  | 'profile';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_EMAIL_LENGTH =
  254;

const MAX_PASSWORD_LENGTH =
  128;

const COLOURS = {
  forest950: '#172018',
  forest900: '#1C261D',
  forest800: '#2C3B2E',
  forest700: '#3D503F',

  parchment100: '#F6EFD9',
  parchment200: '#E8DCC0',

  ink900: '#2A2420',
  ink700: '#514A40',

  bronze700: '#5F4B32',
  bronze600: '#6B563A',
  bronze500: '#B08D57',
  bronze400: '#C3A06A',

  rust800: '#71301C',
  rust700: '#7F321B',
  rust600: '#8C3A20',

  success800: '#2F5838',
  success700: '#3E6546',
  success200: '#DDEFD9',

  danger100: '#FFF0EB',
  danger300: '#FFB4A2',

  white: '#FFFFFF',
} as const;

const MONO_FONT =
  Platform.OS === 'ios'
    ? 'Courier'
    : 'monospace';

const MONO_BOLD_FONT =
  Platform.OS === 'ios'
    ? 'Courier-Bold'
    : 'monospace';

/* -------------------------------------------------------------------------- */
/* Error helpers                                                              */
/* -------------------------------------------------------------------------- */

// Converts Firebase Authentication errors into readable sign-in feedback.
const getLoginErrorMessage = (
  error: unknown,
): string => {
  if (
    !(error instanceof FirebaseError)
  ) {
    return 'Sign in could not be completed. Please try again.';
  }

  switch (
    error.code
  ) {
    case 'auth/invalid-email':
      return 'Enter a valid email address.';

    case 'auth/user-disabled':
      return 'This Explorer account has been disabled.';

    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'The email address or passcode is incorrect.';

    case 'auth/network-request-failed':
      return 'A network connection could not be established. Check your connection and try again.';

    case 'auth/too-many-requests':
      return 'Too many unsuccessful attempts were made. Wait a moment before trying again.';

    case 'auth/operation-not-allowed':
      return 'Email and passcode sign in is currently unavailable.';

    case 'auth/internal-error':
      return 'Firebase could not complete the sign-in request. Please try again.';

    default:
      return 'Sign in could not be completed. Please try again.';
  }
};

// Converts Firestore errors into profile-loading feedback.
const getProfileErrorMessage = (
  error: unknown,
): string => {
  if (
    !(error instanceof FirebaseError)
  ) {
    return 'Your account was verified, but Treasi could not load your Explorer profile.';
  }

  switch (
    error.code
  ) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'Your account was verified, but access to your Explorer profile was denied.';

    case 'unavailable':
    case 'firestore/unavailable':
      return 'Your account was verified, but the Treasi database is currently unavailable.';

    case 'deadline-exceeded':
    case 'firestore/deadline-exceeded':
      return 'Your account was verified, but the profile request took too long. Please try again.';

    default:
      return 'Your account was verified, but Treasi could not load your Explorer profile.';
  }
};

// Converts reset errors without exposing whether an account exists.
const getPasswordResetErrorMessage = (
  error: unknown,
): string => {
  if (
    !(error instanceof FirebaseError)
  ) {
    return 'The passcode reset request could not be completed. Please try again.';
  }

  switch (
    error.code
  ) {
    case 'auth/invalid-email':
      return 'Enter a valid email address before requesting a passcode reset.';

    case 'auth/network-request-failed':
      return 'A network connection could not be established. Check your connection and try again.';

    case 'auth/too-many-requests':
      return 'Too many reset requests were made. Wait a moment before trying again.';

    case 'auth/operation-not-allowed':
      return 'Passcode reset is currently unavailable.';

    /*
     * Do not expose whether a specific email address has an account.
     * Firebase email-enumeration protection may suppress this error.
     */
    case 'auth/user-not-found':
      return '';

    default:
      return 'The passcode reset request could not be completed. Please try again.';
  }
};

/* -------------------------------------------------------------------------- */
/* Explorer profile recovery                                                  */
/* -------------------------------------------------------------------------- */

// Creates a safe callsign only when an older Auth account has no profile.
const buildFallbackUsername = (
  email: string,
  displayName: string | null,
): string => {
  const preferredSource =
    displayName?.trim() ||
    email.split('@')[0] ||
    'EXPLORER';

  const normalised =
    preferredSource
      .toUpperCase()
      .replace(
        /[^A-Z0-9_-]/g,
        '_',
      )
      .replace(
        /_+/g,
        '_',
      )
      .replace(
        /^[_-]+|[_-]+$/g,
        '',
      )
      .slice(
        0,
        24,
      );

  if (
    normalised.length >=
    3
  ) {
    return normalised;
  }

  return `EXPLORER_${
    normalised ||
    'USER'
  }`.slice(
    0,
    24,
  );
};

// Restores a missing profile without changing an existing user's preferences.
const ensureExplorerProfile =
  async (
    user: User,
  ): Promise<void> => {
    const userDocumentRef =
      doc(
        db,
        'users',
        user.uid,
      );

    const snapshot =
      await getDoc(
        userDocumentRef,
      );

    /*
     * Existing profiles are deliberately left untouched.
     * Login must never overwrite saved preferences or points.
     */
    if (
      snapshot.exists()
    ) {
      return;
    }

    const authenticatedEmail =
      user.email
        ?.trim()
        .toLowerCase();

    if (
      !authenticatedEmail ||
      !EMAIL_REGEX.test(
        authenticatedEmail,
      )
    ) {
      throw new Error(
        'Authenticated account does not contain a valid email address.',
      );
    }

    const recoveredProfile:
      WithFieldValue<UserDocument> =
      {
        uid:
          user.uid,

        username:
          buildFallbackUsername(
            authenticatedEmail,
            user.displayName,
          ),

        email:
          authenticatedEmail,

        totalPoints:
          0,

        /*
         * Login is reached after Treasi's onboarding flow.
         * This also safely repairs older Auth-only accounts.
         */
        hasCompletedOnboarding:
          true,

        telemetryEnabled:
          false,

        hapticFeedbackEnabled:
          true,

        motionSensitivityEnabled:
          false,

        batteryOptimizerEnabled:
          false,

        nightModeEnabled:
          false,

        skipOnboardingAuthFlow:
          false,

        createdAt:
          serverTimestamp(),

        updatedAt:
          serverTimestamp(),
      };

    await setDoc(
      userDocumentRef,
      recoveredProfile,
    );
  };

/* -------------------------------------------------------------------------- */
/* Login screen                                                               */
/* -------------------------------------------------------------------------- */

export const LoginScreen:
  React.FC<
    LoginScreenProps
  > = ({
    onNavigateSignUp,
    onLoginSuccess,
  }) => {
    const {
      width,
      height,
    } =
      useWindowDimensions();

    const insets =
      useSafeAreaInsets();

    const isLandscape =
      width > height;

    const isCompact =
      height < 430;

    /* ---------------------------------------------------------------------- */
    /* Input refs                                                             */
    /* ---------------------------------------------------------------------- */

    const emailInputRef =
      useRef<TextInput>(
        null,
      );

    const passwordInputRef =
      useRef<TextInput>(
        null,
      );

    const isMountedRef =
      useRef(true);

    /* ---------------------------------------------------------------------- */
    /* Form state                                                             */
    /* ---------------------------------------------------------------------- */

    const [
      email,
      setEmail,
    ] =
      useState('');

    const [
      password,
      setPassword,
    ] =
      useState('');

    const [
      showPassword,
      setShowPassword,
    ] =
      useState(false);

    const [
      focusedField,
      setFocusedField,
    ] =
      useState<FocusedField>(
        null,
      );

    /* ---------------------------------------------------------------------- */
    /* Processing state                                                       */
    /* ---------------------------------------------------------------------- */

    const [
      loginStage,
      setLoginStage,
    ] =
      useState<LoginStage>(
        'idle',
      );

    const [
      isResettingPassword,
      setIsResettingPassword,
    ] =
      useState(false);

    const [
      errorMessage,
      setErrorMessage,
    ] =
      useState<
        string | null
      >(null);

    const [
      successMessage,
      setSuccessMessage,
    ] =
      useState<
        string | null
      >(null);

    const [
      reduceMotionEnabled,
      setReduceMotionEnabled,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* Animation values                                                       */
    /* ---------------------------------------------------------------------- */

    const screenFadeAnim =
      useRef(
        new Animated.Value(
          0,
        ),
      ).current;

    const buttonScaleAnim =
      useRef(
        new Animated.Value(
          1,
        ),
      ).current;

    const feedbackFadeAnim =
      useRef(
        new Animated.Value(
          1,
        ),
      ).current;

    /* ---------------------------------------------------------------------- */
    /* Lifecycle                                                              */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      isMountedRef.current =
        true;

      return () => {
        isMountedRef.current =
          false;
      };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Reduce Motion                                                          */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      let mounted =
        true;

      AccessibilityInfo
        .isReduceMotionEnabled()
        .then(
          (
            enabled,
          ) => {
            if (
              mounted
            ) {
              setReduceMotionEnabled(
                enabled,
              );
            }
          },
        )
        .catch(() => {
          /*
           * Static behaviour remains safe if the accessibility
           * preference cannot be read.
           */
        });

      const subscription =
        AccessibilityInfo
          .addEventListener(
            'reduceMotionChanged',
            setReduceMotionEnabled,
          );

      return () => {
        mounted =
          false;

        subscription.remove();
      };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Entrance animation                                                     */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      screenFadeAnim.stopAnimation();

      if (
        reduceMotionEnabled
      ) {
        screenFadeAnim.setValue(
          1,
        );

        return;
      }

      screenFadeAnim.setValue(
        0,
      );

      const animation =
        Animated.timing(
          screenFadeAnim,
          {
            toValue:
              1,

            duration:
              280,

            easing:
              Easing.out(
                Easing.cubic,
              ),

            useNativeDriver:
              true,
          },
        );

      animation.start();

      return () => {
        animation.stop();
      };
    }, [
      reduceMotionEnabled,
      screenFadeAnim,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Derived state                                                          */
    /* ---------------------------------------------------------------------- */

    const isLoading =
      loginStage !==
      'idle';

    const isBusy =
      isLoading ||
      isResettingPassword;

    const normalisedEmail =
      email
        .trim()
        .toLowerCase();

    const emailValid =
      EMAIL_REGEX.test(
        normalisedEmail,
      ) &&
      normalisedEmail.length <=
        MAX_EMAIL_LENGTH;

    const loadingLabel =
      useMemo(
        () => {
          switch (
            loginStage
          ) {
            case 'authenticating':
              return 'VERIFYING ACCOUNT...';

            case 'profile':
              return 'LOADING FIELD PROFILE...';

            default:
              return 'ENTER THE FIELD';
          }
        },
        [
          loginStage,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Feedback                                                               */
    /* ---------------------------------------------------------------------- */

    const clearFeedback =
      (): void => {
        if (
          errorMessage
        ) {
          setErrorMessage(
            null,
          );
        }

        if (
          successMessage
        ) {
          setSuccessMessage(
            null,
          );
        }

        feedbackFadeAnim.setValue(
          1,
        );
      };

    const animateFeedback =
      (): void => {
        feedbackFadeAnim.stopAnimation();

        if (
          reduceMotionEnabled
        ) {
          feedbackFadeAnim.setValue(
            1,
          );

          return;
        }

        feedbackFadeAnim.setValue(
          0,
        );

        Animated.timing(
          feedbackFadeAnim,
          {
            toValue:
              1,

            duration:
              180,

            easing:
              Easing.out(
                Easing.cubic,
              ),

            useNativeDriver:
              true,
          },
        ).start();
      };

    const displayError =
      (
        message: string,
      ): void => {
        if (
          !isMountedRef.current
        ) {
          return;
        }

        setSuccessMessage(
          null,
        );

        setErrorMessage(
          message,
        );

        animateFeedback();

        AccessibilityInfo
          .announceForAccessibility(
            `Sign in error. ${message}`,
          );
      };

    const displaySuccess =
      (
        message: string,
      ): void => {
        if (
          !isMountedRef.current
        ) {
          return;
        }

        setErrorMessage(
          null,
        );

        setSuccessMessage(
          message,
        );

        animateFeedback();

        AccessibilityInfo
          .announceForAccessibility(
            message,
          );
      };

    /* ---------------------------------------------------------------------- */
    /* Press animation                                                        */
    /* ---------------------------------------------------------------------- */

    const animateButtonScale =
      (
        value: number,
      ): void => {
        buttonScaleAnim.stopAnimation();

        if (
          reduceMotionEnabled
        ) {
          buttonScaleAnim.setValue(
            1,
          );

          return;
        }

        Animated.spring(
          buttonScaleAnim,
          {
            toValue:
              value,

            damping:
              17,

            stiffness:
              230,

            mass:
              0.75,

            useNativeDriver:
              true,
          },
        ).start();
      };

    /* ---------------------------------------------------------------------- */
    /* Input                                                                  */
    /* ---------------------------------------------------------------------- */

    const handleEmailChange =
      (
        value: string,
      ): void => {
        clearFeedback();

        setEmail(
          value,
        );
      };

    const handlePasswordChange =
      (
        value: string,
      ): void => {
        clearFeedback();

        setPassword(
          value,
        );
      };

    /* ---------------------------------------------------------------------- */
    /* Validation                                                             */
    /* ---------------------------------------------------------------------- */

    const validateLogin =
      (): boolean => {
        if (
          !normalisedEmail
        ) {
          displayError(
            'Enter your Explorer email address.',
          );

          emailInputRef.current?.focus();

          return false;
        }

        if (
          !emailValid
        ) {
          displayError(
            'Enter a valid email address.',
          );

          emailInputRef.current?.focus();

          return false;
        }

        if (
          !password
        ) {
          displayError(
            'Enter your passcode.',
          );

          passwordInputRef.current?.focus();

          return false;
        }

        return true;
      };

    /* ---------------------------------------------------------------------- */
    /* Login                                                                  */
    /* ---------------------------------------------------------------------- */

    const handleLogin =
      async (): Promise<void> => {
        if (
          isBusy
        ) {
          return;
        }

        clearFeedback();

        if (
          !validateLogin()
        ) {
          return;
        }

        setLoginStage(
          'authenticating',
        );

        try {
          const credential =
            await signInWithEmailAndPassword(
              auth,
              normalisedEmail,
              password,
            );

          if (
            !isMountedRef.current
          ) {
            return;
          }

          setLoginStage(
            'profile',
          );

          try {
            /*
             * Existing Firestore profiles are read only.
             * No saved settings, points or onboarding fields are
             * overwritten during normal sign-in.
             */
            await ensureExplorerProfile(
              credential.user,
            );
          } catch (
            profileError: unknown
          ) {
            if (__DEV__) {
              console.warn(
                '[Treasi] Explorer profile verification failed:',
                profileError,
              );
            }

            /*
             * Protected screens rely on Firestore profile data.
             * Clean up the Auth session if profile recovery fails.
             */
            try {
              await signOut(
                auth,
              );
            } catch (
              signOutError: unknown
            ) {
              if (__DEV__) {
                console.warn(
                  '[Treasi] Unable to clean up failed login session:',
                  signOutError,
                );
              }
            }

            if (
              isMountedRef.current
            ) {
              setLoginStage(
                'idle',
              );

              displayError(
                getProfileErrorMessage(
                  profileError,
                ),
              );
            }

            return;
          }

          if (
            !isMountedRef.current
          ) {
            return;
          }

          setLoginStage(
            'idle',
          );

          AccessibilityInfo
            .announceForAccessibility(
              'Signed in successfully.',
            );

          /*
           * App.tsx resolves onboarding and performs the final route.
           */
          onLoginSuccess();
        } catch (
          error: unknown
        ) {
          if (
            !isMountedRef.current
          ) {
            return;
          }

          setLoginStage(
            'idle',
          );

          displayError(
            getLoginErrorMessage(
              error,
            ),
          );
        }
      };

    /* ---------------------------------------------------------------------- */
    /* Password reset                                                         */
    /* ---------------------------------------------------------------------- */

    const handlePasswordReset =
      async (): Promise<void> => {
        if (
          isBusy
        ) {
          return;
        }

        clearFeedback();

        if (
          !normalisedEmail
        ) {
          displayError(
            'Enter your email address first, then select Forgot Passcode.',
          );

          emailInputRef.current?.focus();

          return;
        }

        if (
          !emailValid
        ) {
          displayError(
            'Enter a valid email address before requesting a passcode reset.',
          );

          emailInputRef.current?.focus();

          return;
        }

        setIsResettingPassword(
          true,
        );

        try {
          await sendPasswordResetEmail(
            auth,
            normalisedEmail,
          );

          if (
            !isMountedRef.current
          ) {
            return;
          }

          displaySuccess(
            'If an Explorer account exists for that email address, Firebase has sent passcode reset instructions.',
          );
        } catch (
          error: unknown
        ) {
          if (
            !isMountedRef.current
          ) {
            return;
          }

          const message =
            getPasswordResetErrorMessage(
              error,
            );

          /*
           * Treat user-not-found as a generic successful request
           * so the screen does not expose registered addresses.
           */
          if (
            message === ''
          ) {
            displaySuccess(
              'If an Explorer account exists for that email address, Firebase has sent passcode reset instructions.',
            );
          } else {
            displayError(
              message,
            );
          }
        } finally {
          if (
            isMountedRef.current
          ) {
            setIsResettingPassword(
              false,
            );
          }
        }
      };

    /* ---------------------------------------------------------------------- */
    /* Render                                                                 */
    /* ---------------------------------------------------------------------- */

    return (
      <KeyboardAvoidingView
        style={
          styles.fullScreenChassis
        }
        behavior={
          Platform.OS ===
          'ios'
            ? 'padding'
            : undefined
        }
      >
        <Animated.View
          style={[
            styles.animatedScreen,

            {
              opacity:
                screenFadeAnim,
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={[
              styles.scrollContainer,

              {
                paddingLeft:
                  Math.max(
                    insets.left,
                    16,
                  ),

                paddingRight:
                  Math.max(
                    insets.right,
                    16,
                  ),

                paddingTop:
                  Math.max(
                    insets.top,
                    16,
                  ),

                paddingBottom:
                  Math.max(
                    insets.bottom,
                    16,
                  ),
              },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={
              Platform.OS ===
              'ios'
                ? 'interactive'
                : 'on-drag'
            }
            showsVerticalScrollIndicator={
              false
            }
            contentInsetAdjustmentBehavior="automatic"
          >
            <View
              style={[
                styles.layoutSplitWrapper,

                {
                  flexDirection:
                    isLandscape
                      ? 'row'
                      : 'column',
                },
              ]}
            >
              {/* ============================================================ */}
              {/* 60% — SIGN-IN PERMIT                                        */}
              {/* ============================================================ */}

              <View
                style={[
                  styles.parchmentCard,

                  isLandscape
                    ? styles.leftLandscape
                    : styles.fullWidthCard,
                ]}
              >
                <View
                  style={
                    styles.dashedBorderFrame
                  }
                >
                  <View
                    style={
                      styles.ticketHeader
                    }
                  >
                    <Text
                      maxFontSizeMultiplier={
                        1.5
                      }
                      style={
                        styles.ticketHeaderLabel
                      }
                    >
                      ADMIT ONE · FIELD PERMIT
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.5
                      }
                      style={
                        styles.ticketHeaderLabel
                      }
                    >
                      AUTHENTICATED ACCESS
                    </Text>
                  </View>

                  <View
                    style={
                      styles.brandHeader
                    }
                  >
                    <Text
                      accessibilityRole="header"
                      maxFontSizeMultiplier={
                        1.5
                      }
                      style={[
                        styles.brandTitle,

                        isCompact &&
                          styles.brandTitleCompact,
                      ]}
                    >
                      TREASI
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.brandSubtitle
                      }
                    >
                      Hide. Explore. Stay connected.
                    </Text>
                  </View>

                  {/* -------------------------------------------------------- */}
                  {/* Error feedback                                           */}
                  {/* -------------------------------------------------------- */}

                  {errorMessage ? (
                    <Animated.View
                      accessible
                      accessibilityRole="alert"
                      accessibilityLiveRegion="assertive"
                      accessibilityLabel={`Sign in error. ${errorMessage}`}
                      style={[
                        styles.errorBox,

                        {
                          opacity:
                            feedbackFadeAnim,
                        },
                      ]}
                    >
                      <Ionicons
                        accessible={
                          false
                        }
                        importantForAccessibility="no"
                        name="alert-circle-outline"
                        size={21}
                        color={
                          COLOURS.rust700
                        }
                      />

                      <Text
                        maxFontSizeMultiplier={
                          1.7
                        }
                        style={
                          styles.errorText
                        }
                      >
                        {
                          errorMessage
                        }
                      </Text>
                    </Animated.View>
                  ) : null}

                  {/* -------------------------------------------------------- */}
                  {/* Success feedback                                         */}
                  {/* -------------------------------------------------------- */}

                  {successMessage ? (
                    <Animated.View
                      accessible
                      accessibilityRole="alert"
                      accessibilityLiveRegion="polite"
                      accessibilityLabel={
                        successMessage
                      }
                      style={[
                        styles.successBox,

                        {
                          opacity:
                            feedbackFadeAnim,
                        },
                      ]}
                    >
                      <Ionicons
                        accessible={
                          false
                        }
                        importantForAccessibility="no"
                        name="checkmark-circle-outline"
                        size={21}
                        color={
                          COLOURS.success800
                        }
                      />

                      <Text
                        maxFontSizeMultiplier={
                          1.7
                        }
                        style={
                          styles.successText
                        }
                      >
                        {
                          successMessage
                        }
                      </Text>
                    </Animated.View>
                  ) : null}

                  {/* -------------------------------------------------------- */}
                  {/* Credentials                                              */}
                  {/* -------------------------------------------------------- */}

                  <View
                    style={
                      styles.inputStack
                    }
                  >
                    <View
                      style={
                        styles.fieldGroup
                      }
                    >
                      <Text
                        nativeID="login-email-label"
                        style={
                          styles.inputLabel
                        }
                      >
                        EXPLORER EMAIL
                      </Text>

                      <View
                        style={[
                          styles.inputContainer,

                          focusedField ===
                            'email' &&
                            styles.inputContainerFocused,
                        ]}
                      >
                        <Ionicons
                          accessible={
                            false
                          }
                          importantForAccessibility="no"
                          name="mail-outline"
                          size={20}
                          color={
                            COLOURS.ink900
                          }
                        />

                        <TextInput
                          ref={
                            emailInputRef
                          }
                          accessibilityLabelledBy="login-email-label"
                          accessibilityHint="Enter the email address registered to your Treasi account."
                          autoCapitalize="none"
                          autoComplete="email"
                          autoCorrect={
                            false
                          }
                          editable={
                            !isBusy
                          }
                          keyboardType="email-address"
                          maxLength={
                            MAX_EMAIL_LENGTH
                          }
                          onBlur={() =>
                            setFocusedField(
                              null,
                            )
                          }
                          onChangeText={
                            handleEmailChange
                          }
                          onFocus={() =>
                            setFocusedField(
                              'email',
                            )
                          }
                          onSubmitEditing={() =>
                            passwordInputRef
                              .current
                              ?.focus()
                          }
                          placeholder="name@example.com"
                          placeholderTextColor={
                            COLOURS.bronze600
                          }
                          returnKeyType="next"
                          selectionColor={
                            COLOURS.rust700
                          }
                          style={
                            styles.textInput
                          }
                          textContentType="emailAddress"
                          value={
                            email
                          }
                        />
                      </View>
                    </View>

                    <View
                      style={
                        styles.fieldGroup
                      }
                    >
                      <Text
                        nativeID="login-password-label"
                        style={
                          styles.inputLabel
                        }
                      >
                        PASSCODE
                      </Text>

                      <View
                        style={[
                          styles.inputContainer,

                          focusedField ===
                            'password' &&
                            styles.inputContainerFocused,
                        ]}
                      >
                        <Ionicons
                          accessible={
                            false
                          }
                          importantForAccessibility="no"
                          name="lock-closed-outline"
                          size={20}
                          color={
                            COLOURS.ink900
                          }
                        />

                        <TextInput
                          ref={
                            passwordInputRef
                          }
                          accessibilityLabelledBy="login-password-label"
                          accessibilityHint="Enter the passcode for your Treasi account."
                          autoCapitalize="none"
                          autoComplete="current-password"
                          autoCorrect={
                            false
                          }
                          editable={
                            !isBusy
                          }
                          maxLength={
                            MAX_PASSWORD_LENGTH
                          }
                          onBlur={() =>
                            setFocusedField(
                              null,
                            )
                          }
                          onChangeText={
                            handlePasswordChange
                          }
                          onFocus={() =>
                            setFocusedField(
                              'password',
                            )
                          }
                          onSubmitEditing={() => {
                            void handleLogin();
                          }}
                          placeholder="Enter your passcode"
                          placeholderTextColor={
                            COLOURS.bronze600
                          }
                          returnKeyType="done"
                          secureTextEntry={
                            !showPassword
                          }
                          selectionColor={
                            COLOURS.rust700
                          }
                          style={
                            styles.textInput
                          }
                          textContentType="password"
                          value={
                            password
                          }
                        />

                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={
                            showPassword
                              ? 'Hide passcode'
                              : 'Show passcode'
                          }
                          accessibilityHint="Changes whether the passcode is visible on screen."
                          accessibilityState={{
                            expanded:
                              showPassword,

                            disabled:
                              isBusy,
                          }}
                          disabled={
                            isBusy
                          }
                          hitSlop={4}
                          onPress={() =>
                            setShowPassword(
                              (
                                current,
                              ) =>
                                !current,
                            )
                          }
                          style={({
                            pressed,
                          }) => [
                            styles.eyeButton,

                            pressed &&
                              !isBusy &&
                              styles.controlPressed,
                          ]}
                        >
                          <Ionicons
                            accessible={
                              false
                            }
                            importantForAccessibility="no"
                            name={
                              showPassword
                                ? 'eye-off-outline'
                                : 'eye-outline'
                            }
                            size={22}
                            color={
                              COLOURS.ink900
                            }
                          />
                        </Pressable>
                      </View>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Forgot passcode"
                        accessibilityHint="Sends Firebase passcode reset instructions to the email address entered above."
                        accessibilityState={{
                          disabled:
                            isBusy,

                          busy:
                            isResettingPassword,
                        }}
                        disabled={
                          isBusy
                        }
                        hitSlop={4}
                        onPress={() => {
                          void handlePasswordReset();
                        }}
                        style={({
                          pressed,
                        }) => [
                          styles.forgotPasswordButton,

                          pressed &&
                            !isBusy &&
                            styles.controlPressed,
                        ]}
                      >
                        {isResettingPassword ? (
                          <View
                            style={
                              styles.resetLoadingRow
                            }
                          >
                            <ActivityIndicator
                              size="small"
                              color={
                                COLOURS.rust700
                              }
                            />

                            <Text
                              style={
                                styles.forgotPasswordText
                              }
                            >
                              SENDING RESET...
                            </Text>
                          </View>
                        ) : (
                          <Text
                            style={
                              styles.forgotPasswordText
                            }
                          >
                            FORGOT PASSCODE?
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>

                  {/* -------------------------------------------------------- */}
                  {/* Sign-in action                                           */}
                  {/* -------------------------------------------------------- */}

                  <Animated.View
                    style={[
                      styles.fullWidthContainer,

                      {
                        transform: [
                          {
                            scale:
                              buttonScaleAnim,
                          },
                        ],
                      },
                    ]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        isLoading
                          ? loadingLabel
                          : 'Enter the Treasi field'
                      }
                      accessibilityHint="Signs in to Treasi with your email address and passcode."
                      accessibilityState={{
                        disabled:
                          isBusy,

                        busy:
                          isLoading,
                      }}
                      disabled={
                        isBusy
                      }
                      onPress={() => {
                        void handleLogin();
                      }}
                      onPressIn={() =>
                        animateButtonScale(
                          0.98,
                        )
                      }
                      onPressOut={() =>
                        animateButtonScale(
                          1,
                        )
                      }
                      style={({
                        pressed,
                      }) => [
                        styles.primaryButton,

                        pressed &&
                          !isBusy &&
                          styles.primaryButtonPressed,

                        isBusy &&
                          styles.buttonDisabled,
                      ]}
                    >
                      {isLoading ? (
                        <View
                          style={
                            styles.loadingRow
                          }
                        >
                          <ActivityIndicator
                            size="small"
                            color={
                              COLOURS.parchment200
                            }
                          />

                          <Text
                            maxFontSizeMultiplier={
                              1.5
                            }
                            style={
                              styles.buttonText
                            }
                          >
                            {
                              loadingLabel
                            }
                          </Text>
                        </View>
                      ) : (
                        <Text
                          maxFontSizeMultiplier={
                            1.5
                          }
                          style={
                            styles.buttonText
                          }
                        >
                          ENTER THE FIELD
                        </Text>
                      )}
                    </Pressable>
                  </Animated.View>

                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel="Register a new Explorer account"
                    accessibilityHint="Opens the Treasi sign-up screen."
                    accessibilityState={{
                      disabled:
                        isBusy,
                    }}
                    disabled={
                      isBusy
                    }
                    hitSlop={4}
                    onPress={
                      onNavigateSignUp
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.linkContainer,

                      pressed &&
                        !isBusy &&
                        styles.controlPressed,
                    ]}
                  >
                    <Text
                      maxFontSizeMultiplier={
                        1.5
                      }
                      style={
                        styles.linkText
                      }
                    >
                      NEW EXPEDITION? CREATE AN ACCOUNT
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* ============================================================ */}
              {/* 40% — FIELD ACCESS INFORMATION                              */}
              {/* ============================================================ */}

              <View
                style={[
                  styles.consoleCard,

                  isLandscape
                    ? styles.rightLandscape
                    : styles.fullWidthCard,
                ]}
              >
                <Text
                  accessibilityRole="header"
                  maxFontSizeMultiplier={
                    1.5
                  }
                  style={
                    styles.consoleSectionTitle
                  }
                >
                  BEFORE YOU HEAD OUT
                </Text>

                <View
                  style={
                    styles.widgetBox
                  }
                >
                  <Ionicons
                    accessible={
                      false
                    }
                    importantForAccessibility="no"
                    name="phone-landscape-outline"
                    size={25}
                    color={
                      COLOURS.bronze400
                    }
                  />

                  <View
                    style={
                      styles.flexShrinkContainer
                    }
                  >
                    <Text
                      maxFontSizeMultiplier={
                        1.5
                      }
                      style={
                        styles.widgetTitle
                      }
                    >
                      LANDSCAPE INTERFACE
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.widgetSubtitle
                      }
                    >
                      Treasi uses a landscape field interface on supported mobile devices.
                    </Text>
                  </View>
                </View>

                <Text
                  accessibilityRole="header"
                  maxFontSizeMultiplier={
                    1.5
                  }
                  style={[
                    styles.consoleSectionTitle,
                    styles.topMarginSection,
                  ]}
                >
                  ACCOUNT ACCESS
                </Text>

                <View
                  style={
                    styles.infoList
                  }
                >
                  <View
                    style={
                      styles.infoCard
                    }
                  >
                    <View
                      style={
                        styles.infoTitleRow
                      }
                    >
                      <Ionicons
                        accessible={
                          false
                        }
                        importantForAccessibility="no"
                        name="shield-checkmark-outline"
                        size={16}
                        color={
                          COLOURS.bronze400
                        }
                      />

                      <Text
                        style={
                          styles.infoTitle
                        }
                      >
                        FIREBASE AUTHENTICATION
                      </Text>
                    </View>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.infoDescription
                      }
                    >
                      Your email address and passcode are verified by Firebase Authentication.
                    </Text>
                  </View>

                  <View
                    style={
                      styles.infoCard
                    }
                  >
                    <View
                      style={
                        styles.infoTitleRow
                      }
                    >
                      <Ionicons
                        accessible={
                          false
                        }
                        importantForAccessibility="no"
                        name="options-outline"
                        size={16}
                        color={
                          COLOURS.bronze400
                        }
                      />

                      <Text
                        style={
                          styles.infoTitle
                        }
                      >
                        PROFILE PREFERENCES
                      </Text>
                    </View>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.infoDescription
                      }
                    >
                      Signing in reads your existing Explorer profile. It does not reset your haptics, motion, battery or interface preferences.
                    </Text>
                  </View>

                  <View
                    style={
                      styles.infoCard
                    }
                  >
                    <View
                      style={
                        styles.infoTitleRow
                      }
                    >
                      <Ionicons
                        accessible={
                          false
                        }
                        importantForAccessibility="no"
                        name="key-outline"
                        size={16}
                        color={
                          COLOURS.bronze400
                        }
                      />

                      <Text
                        style={
                          styles.infoTitle
                        }
                      >
                        PERSISTENT SESSION
                      </Text>
                    </View>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.infoDescription
                      }
                    >
                      After successful authentication, Treasi restores your Firebase session when the app starts again.
                    </Text>
                  </View>

                  <View
                    style={
                      styles.infoCard
                    }
                  >
                    <View
                      style={
                        styles.infoTitleRow
                      }
                    >
                      <Ionicons
                        accessible={
                          false
                        }
                        importantForAccessibility="no"
                        name="navigate-outline"
                        size={16}
                        color={
                          COLOURS.bronze400
                        }
                      />

                      <Text
                        style={
                          styles.infoTitle
                        }
                      >
                        SENSOR PERMISSIONS
                      </Text>
                    </View>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.infoDescription
                      }
                    >
                      Signing in does not request or change location and motion permissions. Those are handled by the relevant field features.
                    </Text>
                  </View>
                </View>

                <View
                  style={
                    styles.consoleFooter
                  }
                >
                  <Ionicons
                    accessible={
                      false
                    }
                    importantForAccessibility="no"
                    name="lock-closed-outline"
                    size={13}
                    color={
                      COLOURS.bronze400
                    }
                  />

                  <Text
                    maxFontSizeMultiplier={
                      1.4
                    }
                    style={
                      styles.consoleFooterText
                    }
                  >
                    TREASI · SECURE EXPLORER ACCESS
                  </Text>
                </View>
              </View>
            </View>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    );
  };

export default LoginScreen;

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    fullScreenChassis: {
      flex: 1,
      backgroundColor:
        COLOURS.forest900,
    },

    animatedScreen: {
      flex: 1,
    },

    scrollContainer: {
      flexGrow: 1,
      width: '100%',
      justifyContent:
        'center',
      alignItems:
        'center',
    },

    layoutSplitWrapper: {
      width: '100%',
      maxWidth: 1180,
      gap: 16,
      alignItems:
        'stretch',
      justifyContent:
        'center',
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

    /* ---------------------------------------------------------------------- */
    /* Ticket                                                                 */
    /* ---------------------------------------------------------------------- */

    parchmentCard: {
      minWidth: 0,

      backgroundColor:
        COLOURS.parchment200,

      borderRadius: 12,

      borderWidth: 2,

      borderColor:
        COLOURS.bronze600,

      padding: 8,

      shadowColor:
        '#000000',

      shadowOffset: {
        width: 0,
        height: 4,
      },

      shadowOpacity: 0.28,

      shadowRadius: 8,

      elevation: 6,
    },

    dashedBorderFrame: {
      flex: 1,

      width: '100%',

      borderWidth: 2,

      borderColor:
        COLOURS.rust700,

      borderStyle:
        'dashed',

      borderRadius: 8,

      padding: 16,

      justifyContent:
        'center',
    },

    ticketHeader: {
      width: '100%',

      flexDirection:
        'row',

      flexWrap:
        'wrap',

      justifyContent:
        'space-between',

      gap: 8,

      marginBottom: 12,
    },

    ticketHeaderLabel: {
      color:
        COLOURS.bronze700,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 11,

      lineHeight: 16,

      fontWeight:
        '700',

      letterSpacing: 0.75,
    },

    brandHeader: {
      alignItems:
        'center',

      marginBottom: 18,
    },

    brandTitle: {
      color:
        COLOURS.ink900,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 34,

      lineHeight: 41,

      fontWeight:
        '900',

      letterSpacing: 5,

      textAlign:
        'center',
    },

    brandTitleCompact: {
      fontSize: 28,

      lineHeight: 34,
    },

    brandSubtitle: {
      marginTop: 4,

      color:
        COLOURS.ink900,

      fontFamily:
        MONO_FONT,

      fontSize: 14,

      lineHeight: 20,

      fontStyle:
        'italic',

      textAlign:
        'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Feedback                                                               */
    /* ---------------------------------------------------------------------- */

    errorBox: {
      width: '100%',

      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 10,

      marginBottom: 14,

      paddingHorizontal: 12,

      paddingVertical: 10,

      backgroundColor:
        COLOURS.danger100,

      borderColor:
        COLOURS.rust700,

      borderWidth: 2,

      borderRadius: 6,
    },

    errorText: {
      flex: 1,

      color:
        COLOURS.rust800,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 13,

      lineHeight: 19,

      fontWeight:
        '700',
    },

    successBox: {
      width: '100%',

      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 10,

      marginBottom: 14,

      paddingHorizontal: 12,

      paddingVertical: 10,

      backgroundColor:
        COLOURS.success200,

      borderColor:
        COLOURS.success700,

      borderWidth: 2,

      borderRadius: 6,
    },

    successText: {
      flex: 1,

      color:
        COLOURS.success800,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 12,

      lineHeight: 18,

      fontWeight:
        '700',
    },

    /* ---------------------------------------------------------------------- */
    /* Inputs                                                                 */
    /* ---------------------------------------------------------------------- */

    inputStack: {
      width: '100%',

      gap: 14,

      marginBottom: 8,
    },

    fieldGroup: {
      width: '100%',

      gap: 6,
    },

    inputLabel: {
      color:
        COLOURS.ink900,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 13,

      lineHeight: 19,

      fontWeight:
        '800',

      letterSpacing: 0.8,
    },

    inputContainer: {
      width: '100%',

      minHeight: 52,

      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 10,

      paddingLeft: 12,

      paddingRight: 4,

      paddingVertical: 4,

      backgroundColor:
        COLOURS.parchment100,

      borderWidth: 2,

      borderColor:
        COLOURS.bronze600,

      borderRadius: 6,
    },

    inputContainerFocused: {
      borderColor:
        COLOURS.rust700,

      shadowColor:
        COLOURS.rust700,

      shadowOffset: {
        width: 0,
        height: 0,
      },

      shadowOpacity: 0.18,

      shadowRadius: 4,

      elevation: 2,
    },

    textInput: {
      flex: 1,

      minWidth: 0,

      paddingVertical: 9,

      color:
        COLOURS.ink900,

      fontFamily:
        MONO_FONT,

      fontSize: 16,

      lineHeight: 22,
    },

    eyeButton: {
      minWidth: 48,

      minHeight: 48,

      justifyContent:
        'center',

      alignItems:
        'center',

      borderRadius: 6,
    },

    forgotPasswordButton: {
      alignSelf:
        'flex-end',

      minHeight: 48,

      justifyContent:
        'center',

      alignItems:
        'center',

      paddingHorizontal: 8,

      marginTop: -2,

      borderRadius: 5,
    },

    forgotPasswordText: {
      color:
        COLOURS.rust700,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 11,

      lineHeight: 16,

      fontWeight:
        '800',

      letterSpacing: 0.55,

      textDecorationLine:
        'underline',
    },

    resetLoadingRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 8,
    },

    controlPressed: {
      opacity: 0.66,

      backgroundColor:
        'rgba(127, 50, 27, 0.08)',
    },

    /* ---------------------------------------------------------------------- */
    /* Primary action                                                         */
    /* ---------------------------------------------------------------------- */

    primaryButton: {
      minHeight: 52,

      width: '100%',

      alignItems:
        'center',

      justifyContent:
        'center',

      paddingHorizontal: 16,

      paddingVertical: 12,

      backgroundColor:
        COLOURS.rust700,

      borderWidth: 2,

      borderColor:
        COLOURS.ink900,

      borderRadius: 6,
    },

    primaryButtonPressed: {
      backgroundColor:
        COLOURS.rust600,
    },

    buttonDisabled: {
      opacity: 0.62,
    },

    loadingRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'center',

      gap: 10,
    },

    buttonText: {
      color:
        COLOURS.parchment200,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 13,

      lineHeight: 19,

      fontWeight:
        '800',

      letterSpacing: 0.9,

      textAlign:
        'center',
    },

    linkContainer: {
      alignSelf:
        'center',

      minHeight: 48,

      marginTop: 8,

      paddingHorizontal: 12,

      justifyContent:
        'center',

      alignItems:
        'center',

      borderRadius: 6,
    },

    linkText: {
      color:
        COLOURS.ink900,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 12,

      lineHeight: 18,

      fontWeight:
        '800',

      letterSpacing: 0.6,

      textAlign:
        'center',

      textDecorationLine:
        'underline',
    },

    /* ---------------------------------------------------------------------- */
    /* Information panel                                                      */
    /* ---------------------------------------------------------------------- */

    consoleCard: {
      minWidth: 0,

      backgroundColor:
        COLOURS.forest800,

      borderRadius: 12,

      borderWidth: 2,

      borderColor:
        COLOURS.bronze500,

      padding: 16,

      justifyContent:
        'center',

      shadowColor:
        '#000000',

      shadowOffset: {
        width: 0,
        height: 4,
      },

      shadowOpacity: 0.22,

      shadowRadius: 8,

      elevation: 5,
    },

    consoleSectionTitle: {
      marginBottom: 8,

      color:
        COLOURS.bronze400,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 13,

      lineHeight: 19,

      fontWeight:
        '800',

      letterSpacing: 0.9,
    },

    topMarginSection: {
      marginTop: 18,
    },

    widgetBox: {
      minHeight: 68,

      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 12,

      padding: 12,

      backgroundColor:
        COLOURS.forest950,

      borderWidth: 1,

      borderColor:
        COLOURS.bronze500,

      borderRadius: 6,
    },

    widgetTitle: {
      color:
        COLOURS.parchment200,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 13,

      lineHeight: 19,

      fontWeight:
        '800',

      letterSpacing: 0.7,
    },

    widgetSubtitle: {
      marginTop: 2,

      color:
        COLOURS.bronze400,

      fontFamily:
        MONO_FONT,

      fontSize: 11,

      lineHeight: 17,
    },

    infoList: {
      gap: 8,
    },

    infoCard: {
      minHeight: 62,

      justifyContent:
        'center',

      paddingHorizontal: 12,

      paddingVertical: 9,

      backgroundColor:
        COLOURS.forest950,

      borderWidth: 1,

      borderColor:
        COLOURS.forest700,

      borderRadius: 6,
    },

    infoTitleRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 6,

      marginBottom: 3,
    },

    infoTitle: {
      flexShrink: 1,

      color:
        COLOURS.bronze400,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 9.5,

      lineHeight: 14,

      fontWeight:
        '800',

      letterSpacing: 0.65,
    },

    infoDescription: {
      color:
        COLOURS.parchment200,

      fontFamily:
        MONO_FONT,

      fontSize: 10.5,

      lineHeight: 16,
    },

    consoleFooter: {
      minHeight: 32,

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'center',

      gap: 5,

      borderTopWidth: 1,

      borderTopColor:
        'rgba(195, 160, 106, 0.4)',

      marginTop: 16,

      paddingTop: 9,
    },

    consoleFooterText: {
      color:
        COLOURS.bronze400,

      fontFamily:
        MONO_FONT,

      fontSize: 8.5,

      lineHeight: 13,

      letterSpacing: 0.6,

      textAlign:
        'center',
    },
  });