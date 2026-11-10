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
  type TextInputInstance,
  useWindowDimensions,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FirebaseError } from 'firebase/app';

import {
  createUserWithEmailAndPassword,
  deleteUser,
  signOut,
  type User,
  updateProfile,
} from 'firebase/auth';

import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  type WithFieldValue,
} from 'firebase/firestore';

import { auth, db } from '../../config/firebase';

import type { UserDocument } from '../../types/firestore';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface Props {
  onNavigateLogin: () => void;
  onSignUpSuccess: () => void;
}

type FocusedField =
  | 'callsign'
  | 'email'
  | 'password'
  | 'confirmPassword'
  | null;

type ValidationTone =
  | 'success'
  | 'pending'
  | 'error';

interface ValidationItem {
  id: string;
  label: string;
  value: string;
  tone: ValidationTone;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

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

  success700: '#3E6546',
  success300: '#BFE3C0',

  warning300: '#E6C580',
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

const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CALLSIGN_REGEX =
  /^[A-Z0-9][A-Z0-9_-]{2,23}$/;

const PASSWORD_HAS_LETTER =
  /[A-Za-z]/;

const PASSWORD_HAS_NUMBER =
  /\d/;

const MIN_PASSWORD_LENGTH =
  8;

const MAX_PASSWORD_LENGTH =
  128;

const MAX_CALLSIGN_LENGTH =
  24;

const MAX_EMAIL_LENGTH =
  254;

/* -------------------------------------------------------------------------- */
/* Error helpers                                                              */
/* -------------------------------------------------------------------------- */

// Converts Firebase errors into readable registration feedback.
const getRegistrationErrorMessage = (
  error: unknown,
): string => {
  if (
    !(error instanceof FirebaseError)
  ) {
    return 'Registration could not be completed. Please try again.';
  }

  switch (error.code) {
    case 'auth/email-already-in-use':
      return 'This email address is already linked to an Explorer account.';

    case 'auth/invalid-email':
      return 'Enter a valid email address.';

    case 'auth/weak-password':
      return 'Choose a stronger passcode before continuing.';

    case 'auth/network-request-failed':
      return 'A network connection could not be established. Check your connection and try again.';

    case 'auth/operation-not-allowed':
      return 'Email and passcode registration is currently unavailable.';

    case 'auth/too-many-requests':
      return 'Too many registration attempts were made. Wait a moment before trying again.';

    case 'permission-denied':
      return 'Treasi could not create your Explorer profile because database access was denied.';

    case 'unavailable':
      return 'Treasi could not reach the database. Check your connection and try again.';

    default:
      return 'Registration could not be completed. Please try again.';
  }
};

/* -------------------------------------------------------------------------- */
/* Account rollback                                                           */
/* -------------------------------------------------------------------------- */

// Removes an incomplete Firebase Auth account when profile creation fails.
const rollbackNewAccount = async (
  user: User,
): Promise<void> => {
  try {
    await deleteUser(user);
    return;
  } catch (deleteError: unknown) {
    if (__DEV__) {
      console.warn(
        '[Treasi] Unable to delete incomplete Auth account:',
        deleteError,
      );
    }
  }

  /*
   * Signing out is the safest fallback if Firebase refuses account deletion.
   * The user is not left inside an incomplete authenticated session.
   */
  try {
    await signOut(auth);
  } catch (signOutError: unknown) {
    if (__DEV__) {
      console.warn(
        '[Treasi] Unable to sign out incomplete Auth session:',
        signOutError,
      );
    }
  }
};

/* -------------------------------------------------------------------------- */
/* Sign-up screen                                                             */
/* -------------------------------------------------------------------------- */

export const SignUpScreen:
  React.FC<Props> = ({
    onNavigateLogin,
    onSignUpSuccess,
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

    const callsignInputRef =
      useRef<TextInputInstance>(
        null,
      );

    const emailInputRef =
      useRef<TextInputInstance>(
        null,
      );

    const passwordInputRef =
      useRef<TextInputInstance>(
        null,
      );

    const confirmPasswordInputRef =
      useRef<TextInputInstance>(
        null,
      );

    const isMountedRef =
      useRef(true);

    /* ---------------------------------------------------------------------- */
    /* Form state                                                             */
    /* ---------------------------------------------------------------------- */

    const [
      callsign,
      setCallsign,
    ] =
      useState('');

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
      confirmPassword,
      setConfirmPassword,
    ] =
      useState('');

    const [
      showPassword,
      setShowPassword,
    ] =
      useState(false);

    const [
      showConfirmPassword,
      setShowConfirmPassword,
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
      isLoading,
      setIsLoading,
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
      reduceMotionEnabled,
      setReduceMotionEnabled,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* Animation state                                                        */
    /* ---------------------------------------------------------------------- */

    const screenFadeAnim =
      useRef(
        new Animated.Value(0),
      ).current;

    const errorFadeAnim =
      useRef(
        new Animated.Value(1),
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
      let mounted = true;

      AccessibilityInfo
        .isReduceMotionEnabled()
        .then(
          (enabled) => {
            if (mounted) {
              setReduceMotionEnabled(
                enabled,
              );
            }
          },
        )
        .catch(() => {
          // Static behaviour remains safe if the preference cannot be read.
        });

      const subscription =
        AccessibilityInfo.addEventListener(
          'reduceMotionChanged',
          setReduceMotionEnabled,
        );

      return () => {
        mounted = false;
        subscription.remove();
      };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Entrance animation                                                     */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
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

      Animated.timing(
        screenFadeAnim,
        {
          toValue: 1,
          duration: 280,
          easing:
            Easing.out(
              Easing.cubic,
            ),
          useNativeDriver:
            true,
        },
      ).start();
    }, [
      reduceMotionEnabled,
      screenFadeAnim,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Normalised input                                                       */
    /* ---------------------------------------------------------------------- */

    const normalisedCallsign =
      callsign
        .trim()
        .toUpperCase();

    const normalisedEmail =
      email
        .trim()
        .toLowerCase();

    /* ---------------------------------------------------------------------- */
    /* Validation                                                             */
    /* ---------------------------------------------------------------------- */

    const callsignValid =
      CALLSIGN_REGEX.test(
        normalisedCallsign,
      );

    const emailValid =
      EMAIL_REGEX.test(
        normalisedEmail,
      ) &&
      normalisedEmail.length <=
        MAX_EMAIL_LENGTH;

    const passwordLengthValid =
      password.length >=
        MIN_PASSWORD_LENGTH &&
      password.length <=
        MAX_PASSWORD_LENGTH;

    const passwordCompositionValid =
      PASSWORD_HAS_LETTER.test(
        password,
      ) &&
      PASSWORD_HAS_NUMBER.test(
        password,
      );

    const passwordsMatch =
      confirmPassword.length >
        0 &&
      password ===
        confirmPassword;

    const formValid =
      callsignValid &&
      emailValid &&
      passwordLengthValid &&
      passwordCompositionValid &&
      passwordsMatch;

    const validationItems =
      useMemo<
        ValidationItem[]
      >(
        () => [
          {
            id: 'callsign',
            label:
              'CALLSIGN FORMAT',
            value:
              callsign.length ===
              0
                ? '3–24 CHARACTERS'
                : callsignValid
                  ? 'READY'
                  : 'CHECK FORMAT',
            tone:
              callsign.length ===
              0
                ? 'pending'
                : callsignValid
                  ? 'success'
                  : 'error',
          },

          {
            id: 'email',
            label:
              'EMAIL FORMAT',
            value:
              email.length ===
              0
                ? 'WAITING'
                : emailValid
                  ? 'READY'
                  : 'CHECK ADDRESS',
            tone:
              email.length ===
              0
                ? 'pending'
                : emailValid
                  ? 'success'
                  : 'error',
          },

          {
            id: 'password-length',
            label:
              'PASSCODE LENGTH',
            value:
              password.length ===
              0
                ? `${MIN_PASSWORD_LENGTH}+ CHARACTERS`
                : passwordLengthValid
                  ? 'READY'
                  : 'TOO SHORT',
            tone:
              password.length ===
              0
                ? 'pending'
                : passwordLengthValid
                  ? 'success'
                  : 'error',
          },

          {
            id: 'password-content',
            label:
              'PASSCODE CONTENT',
            value:
              password.length ===
              0
                ? 'LETTER + NUMBER'
                : passwordCompositionValid
                  ? 'READY'
                  : 'LETTER + NUMBER REQUIRED',
            tone:
              password.length ===
              0
                ? 'pending'
                : passwordCompositionValid
                  ? 'success'
                  : 'error',
          },

          {
            id: 'password-match',
            label:
              'PASSCODE MATCH',
            value:
              confirmPassword.length ===
              0
                ? 'WAITING'
                : passwordsMatch
                  ? 'MATCHED'
                  : 'DOES NOT MATCH',
            tone:
              confirmPassword.length ===
              0
                ? 'pending'
                : passwordsMatch
                  ? 'success'
                  : 'error',
          },

          {
            id: 'callsign-availability',
            label:
              'CALLSIGN AVAILABILITY',
            value:
              'CHECKED ON SUBMIT',
            tone:
              'pending',
          },
        ],
        [
          callsign.length,
          callsignValid,
          confirmPassword.length,
          email.length,
          emailValid,
          password.length,
          passwordCompositionValid,
          passwordLengthValid,
          passwordsMatch,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Error feedback                                                         */
    /* ---------------------------------------------------------------------- */

    const clearError =
      (): void => {
        if (
          !errorMessage
        ) {
          return;
        }

        setErrorMessage(
          null,
        );

        errorFadeAnim.setValue(
          1,
        );
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

        setErrorMessage(
          message,
        );

        AccessibilityInfo.announceForAccessibility(
          message,
        );

        if (
          reduceMotionEnabled
        ) {
          errorFadeAnim.setValue(
            1,
          );

          return;
        }

        errorFadeAnim.setValue(
          0,
        );

        Animated.timing(
          errorFadeAnim,
          {
            toValue: 1,
            duration: 180,
            easing:
              Easing.out(
                Easing.cubic,
              ),
            useNativeDriver:
              true,
          },
        ).start();
      };

    /* ---------------------------------------------------------------------- */
    /* Field validation                                                       */
    /* ---------------------------------------------------------------------- */

    const validateBeforeRegistration =
      (): boolean => {
        if (
          !normalisedCallsign
        ) {
          displayError(
            'Enter an Explorer callsign.',
          );

          callsignInputRef.current?.focus();

          return false;
        }

        if (
          !callsignValid
        ) {
          displayError(
            'Callsigns must contain 3 to 24 letters, numbers, underscores or hyphens, and cannot begin with a symbol.',
          );

          callsignInputRef.current?.focus();

          return false;
        }

        if (
          !normalisedEmail
        ) {
          displayError(
            'Enter your email address.',
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
            'Enter a passcode.',
          );

          passwordInputRef.current?.focus();

          return false;
        }

        if (
          !passwordLengthValid
        ) {
          displayError(
            `Your passcode must contain at least ${MIN_PASSWORD_LENGTH} characters.`,
          );

          passwordInputRef.current?.focus();

          return false;
        }

        if (
          !passwordCompositionValid
        ) {
          displayError(
            'Your passcode must contain at least one letter and one number.',
          );

          passwordInputRef.current?.focus();

          return false;
        }

        if (
          !confirmPassword
        ) {
          displayError(
            'Confirm your passcode.',
          );

          confirmPasswordInputRef.current?.focus();

          return false;
        }

        if (
          !passwordsMatch
        ) {
          displayError(
            'The two passcodes do not match.',
          );

          confirmPasswordInputRef.current?.focus();

          return false;
        }

        return true;
      };

    /* ---------------------------------------------------------------------- */
    /* Registration                                                           */
    /* ---------------------------------------------------------------------- */

    const handleRegister =
      async (): Promise<void> => {
        if (
          isLoading
        ) {
          return;
        }

        clearError();

        if (
          !validateBeforeRegistration()
        ) {
          return;
        }

        /*
         * Sign-up is only exposed while signed out.
         * This guard prevents accidentally replacing an existing session.
         */
        if (
          auth.currentUser
        ) {
          displayError(
            'An Explorer session is already active. Sign out before creating another account.',
          );

          return;
        }

        setIsLoading(
          true,
        );

        let createdUser:
          User | null =
          null;

        let registrationCommitted =
          false;

        try {
          /* ---------------------------------------------------------------- */
          /* 1. Create Firebase Auth account                                  */
          /* ---------------------------------------------------------------- */

          const credential =
            await createUserWithEmailAndPassword(
              auth,
              normalisedEmail,
              password,
            );

          createdUser =
            credential.user;

          /* ---------------------------------------------------------------- */
          /* 2. Best-effort callsign uniqueness check                         */
          /* ---------------------------------------------------------------- */

          /*
           * Firestore profile reads require authentication, so the availability
           * check occurs immediately after Firebase Auth creates the account.
           */
          const callsignQuery =
            query(
              collection(
                db,
                'users',
              ),
              where(
                'username',
                '==',
                normalisedCallsign,
              ),
              limit(1),
            );

          const callsignSnapshot =
            await getDocs(
              callsignQuery,
            );

          if (
            !callsignSnapshot.empty
          ) {
            await rollbackNewAccount(
              createdUser,
            );

            createdUser =
              null;

            if (
              isMountedRef.current
            ) {
              setIsLoading(
                false,
              );

              displayError(
                'That callsign is already in use. Choose another Explorer callsign.',
              );

              callsignInputRef.current?.focus();
            }

            return;
          }

          /* ---------------------------------------------------------------- */
          /* 3. Set Firebase Auth display name                                */
          /* ---------------------------------------------------------------- */

          await updateProfile(
            createdUser,
            {
              displayName:
                normalisedCallsign,
            },
          );

          /* ---------------------------------------------------------------- */
          /* 4. Create Firestore Explorer profile                             */
          /* ---------------------------------------------------------------- */

          /*
           * Sign-up is reached after the Treasi onboarding flow, so the newly
           * created Firestore profile starts with onboarding completed.
           *
           * App.tsx remains responsible for local onboarding persistence and
           * verifies this value again after successful authentication.
           */
          const newUserDocument:
            WithFieldValue<UserDocument> =
            {
              uid:
                createdUser.uid,

              username:
                normalisedCallsign,

              email:
                normalisedEmail,

              totalPoints: 0,

              hasCompletedOnboarding:
                true,

              /*
               * Account preferences start from safe production defaults.
               * Users can change supported preferences in Profile Settings.
               */
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

              /*
               * Development bypass behaviour is permanently disabled.
               */
              skipOnboardingAuthFlow:
                false,

              createdAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp(),
            };

          await setDoc(
            doc(
              db,
              'users',
              createdUser.uid,
            ),
            newUserDocument,
          );

          /*
           * No rollback should occur beyond this point because the account
           * and Firestore profile now form a complete registration.
           */
          registrationCommitted =
            true;

          if (
            !isMountedRef.current
          ) {
            return;
          }

          setIsLoading(
            false,
          );

          AccessibilityInfo.announceForAccessibility(
            'Explorer account created successfully.',
          );

          onSignUpSuccess();
        } catch (
          error: unknown
        ) {
          if (
            createdUser &&
            !registrationCommitted
          ) {
            await rollbackNewAccount(
              createdUser,
            );
          }

          if (
            !isMountedRef.current
          ) {
            return;
          }

          setIsLoading(
            false,
          );

          displayError(
            getRegistrationErrorMessage(
              error,
            ),
          );
        }
      };

    /* ---------------------------------------------------------------------- */
    /* Render helpers                                                         */
    /* ---------------------------------------------------------------------- */

    const renderValidationIndicator =
      (
        item: ValidationItem,
      ): React.ReactNode => {
        const symbol =
          item.tone ===
          'success'
            ? '✓'
            : item.tone ===
                'error'
              ? '!'
              : '·';

        return (
          <View
            key={
              item.id
            }
            accessible
            accessibilityLabel={`${item.label}: ${item.value}`}
            style={
              styles.validationRow
            }
          >
            <View
              accessible={
                false
              }
              importantForAccessibility="no"
              style={[
                styles.validationIndicator,

                item.tone ===
                  'success' &&
                  styles.validationIndicatorSuccess,

                item.tone ===
                  'error' &&
                  styles.validationIndicatorError,

                item.tone ===
                  'pending' &&
                  styles.validationIndicatorPending,
              ]}
            >
              <Text
                style={[
                  styles.validationIndicatorText,

                  item.tone ===
                    'success' &&
                    styles.validationIndicatorTextSuccess,

                  item.tone ===
                    'error' &&
                    styles.validationIndicatorTextError,
                ]}
              >
                {symbol}
              </Text>
            </View>

            <View
              style={
                styles.validationTextWrapper
              }
            >
              <Text
                maxFontSizeMultiplier={
                  1.5
                }
                style={
                  styles.validationLabel
                }
              >
                {
                  item.label
                }
              </Text>

              <Text
                maxFontSizeMultiplier={
                  1.5
                }
                style={[
                  styles.validationValue,

                  item.tone ===
                    'success' &&
                    styles.validationValueSuccess,

                  item.tone ===
                    'error' &&
                    styles.validationValueError,
                ]}
              >
                {
                  item.value
                }
              </Text>
            </View>
          </View>
        );
      };

    /* ---------------------------------------------------------------------- */
    /* Render                                                                 */
    /* ---------------------------------------------------------------------- */

    return (
      <KeyboardAvoidingView
        style={
          styles.container
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
            styles.screenWrapper,
            {
              opacity:
                screenFadeAnim,

              flexDirection:
                isLandscape
                  ? 'row'
                  : 'column',

              paddingLeft:
                Math.max(
                  insets.left,
                  0,
                ),

              paddingRight:
                Math.max(
                  insets.right,
                  0,
                ),

              paddingTop:
                Math.max(
                  insets.top,
                  0,
                ),

              paddingBottom:
                Math.max(
                  insets.bottom,
                  0,
                ),
            },
          ]}
        >
          {/* ---------------------------------------------------------------- */}
          {/* Registration form                                                */}
          {/* ---------------------------------------------------------------- */}

          <View
            style={[
              styles.leftViewport,

              !isLandscape &&
                styles.fullWidthViewport,
            ]}
          >
            <ScrollView
              contentContainerStyle={[
                styles.formScrollContent,

                isCompact &&
                  styles.formScrollContentCompact,
              ]}
              showsVerticalScrollIndicator={
                false
              }
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={
                Platform.OS ===
                'ios'
                  ? 'interactive'
                  : 'on-drag'
              }
              automaticallyAdjustKeyboardInsets={
                Platform.OS ===
                'ios'
              }
            >
              <View
                style={
                  styles.headerBlock
                }
              >
                <Text
                  maxFontSizeMultiplier={
                    1.5
                  }
                  style={
                    styles.permitHeader
                  }
                >
                  ADMIT ONE · EXPLORER PERMIT
                </Text>

                <Text
                  accessibilityRole="header"
                  maxFontSizeMultiplier={
                    1.6
                  }
                  style={
                    styles.title
                  }
                >
                  FIELD ENROLMENT
                </Text>

                <Text
                  maxFontSizeMultiplier={
                    1.7
                  }
                  style={
                    styles.subtitle
                  }
                >
                  CREATE YOUR TREASI EXPLORER ACCOUNT
                </Text>
              </View>

              {errorMessage ? (
                <Animated.View
                  accessible
                  accessibilityRole="alert"
                  accessibilityLiveRegion="assertive"
                  style={[
                    styles.errorBox,
                    {
                      opacity:
                        errorFadeAnim,
                    },
                  ]}
                >
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

              {/* ------------------------------------------------------------ */}
              {/* Callsign                                                     */}
              {/* ------------------------------------------------------------ */}

              <View
                style={
                  styles.fieldGroup
                }
              >
                <Text
                  nativeID="signup-callsign-label"
                  style={
                    styles.inputLabel
                  }
                >
                  CALLSIGN / USERNAME
                </Text>

                <View
                  style={[
                    styles.inputContainer,

                    focusedField ===
                      'callsign' &&
                      styles.inputContainerFocused,
                  ]}
                >
                  <TextInput
                    ref={
                      callsignInputRef
                    }
                    accessibilityLabelledBy="signup-callsign-label"
                    accessibilityHint="Enter 3 to 24 letters, numbers, underscores or hyphens."
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect={
                      false
                    }
                    maxLength={
                      MAX_CALLSIGN_LENGTH
                    }
                    onBlur={() =>
                      setFocusedField(
                        null,
                      )
                    }
                    onChangeText={(
                      value,
                    ) => {
                      clearError();

                      setCallsign(
                        value.toUpperCase(),
                      );
                    }}
                    onFocus={() =>
                      setFocusedField(
                        'callsign',
                      )
                    }
                    onSubmitEditing={() =>
                      emailInputRef.current?.focus()
                    }
                    placeholder="RANGER_JACK"
                    placeholderTextColor="#71685D"
                    returnKeyType="next"
                    selectionColor={
                      COLOURS.rust700
                    }
                    spellCheck={
                      false
                    }
                    style={
                      styles.textInput
                    }
                    value={
                      callsign
                    }
                  />
                </View>

                <Text
                  maxFontSizeMultiplier={
                    1.5
                  }
                  style={
                    styles.inputHelpText
                  }
                >
                  3–24 characters. Letters, numbers, underscores and hyphens only.
                </Text>
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Email                                                        */}
              {/* ------------------------------------------------------------ */}

              <View
                style={
                  styles.fieldGroup
                }
              >
                <Text
                  nativeID="signup-email-label"
                  style={
                    styles.inputLabel
                  }
                >
                  EMAIL ADDRESS
                </Text>

                <View
                  style={[
                    styles.inputContainer,

                    focusedField ===
                      'email' &&
                      styles.inputContainerFocused,
                  ]}
                >
                  <TextInput
                    ref={
                      emailInputRef
                    }
                    accessibilityLabelledBy="signup-email-label"
                    accessibilityHint="Enter the email address you will use to sign in."
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={
                      false
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
                    onChangeText={(
                      value,
                    ) => {
                      clearError();

                      setEmail(
                        value,
                      );
                    }}
                    onFocus={() =>
                      setFocusedField(
                        'email',
                      )
                    }
                    onSubmitEditing={() =>
                      passwordInputRef.current?.focus()
                    }
                    placeholder="you@example.com"
                    placeholderTextColor="#71685D"
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

              {/* ------------------------------------------------------------ */}
              {/* Password                                                     */}
              {/* ------------------------------------------------------------ */}

              <View
                style={
                  styles.fieldGroup
                }
              >
                <Text
                  nativeID="signup-password-label"
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
                  <TextInput
                    ref={
                      passwordInputRef
                    }
                    accessibilityLabelledBy="signup-password-label"
                    accessibilityHint={`Enter at least ${MIN_PASSWORD_LENGTH} characters containing a letter and a number.`}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    autoCorrect={
                      false
                    }
                    maxLength={
                      MAX_PASSWORD_LENGTH
                    }
                    onBlur={() =>
                      setFocusedField(
                        null,
                      )
                    }
                    onChangeText={(
                      value,
                    ) => {
                      clearError();

                      setPassword(
                        value,
                      );
                    }}
                    onFocus={() =>
                      setFocusedField(
                        'password',
                      )
                    }
                    onSubmitEditing={() =>
                      confirmPasswordInputRef.current?.focus()
                    }
                    placeholder="Enter a secure passcode"
                    placeholderTextColor="#71685D"
                    returnKeyType="next"
                    secureTextEntry={
                      !showPassword
                    }
                    selectionColor={
                      COLOURS.rust700
                    }
                    style={
                      styles.textInput
                    }
                    textContentType="newPassword"
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
                    accessibilityState={{
                      expanded:
                        showPassword,
                    }}
                    hitSlop={4}
                    onPress={() =>
                      setShowPassword(
                        (current) =>
                          !current,
                      )
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.visibilityButton,

                      pressed &&
                        styles.controlPressed,
                    ]}
                  >
                    <Text
                      style={
                        styles.visibilityButtonText
                      }
                    >
                      {showPassword
                        ? 'HIDE'
                        : 'SHOW'}
                    </Text>
                  </Pressable>
                </View>

                <Text
                  maxFontSizeMultiplier={
                    1.5
                  }
                  style={
                    styles.inputHelpText
                  }
                >
                  Minimum 8 characters with at least one letter and one number.
                </Text>
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Confirm password                                             */}
              {/* ------------------------------------------------------------ */}

              <View
                style={
                  styles.fieldGroup
                }
              >
                <Text
                  nativeID="signup-confirm-password-label"
                  style={
                    styles.inputLabel
                  }
                >
                  CONFIRM PASSCODE
                </Text>

                <View
                  style={[
                    styles.inputContainer,

                    focusedField ===
                      'confirmPassword' &&
                      styles.inputContainerFocused,
                  ]}
                >
                  <TextInput
                    ref={
                      confirmPasswordInputRef
                    }
                    accessibilityLabelledBy="signup-confirm-password-label"
                    accessibilityHint="Enter the same passcode again."
                    autoCapitalize="none"
                    autoComplete="new-password"
                    autoCorrect={
                      false
                    }
                    maxLength={
                      MAX_PASSWORD_LENGTH
                    }
                    onBlur={() =>
                      setFocusedField(
                        null,
                      )
                    }
                    onChangeText={(
                      value,
                    ) => {
                      clearError();

                      setConfirmPassword(
                        value,
                      );
                    }}
                    onFocus={() =>
                      setFocusedField(
                        'confirmPassword',
                      )
                    }
                    onSubmitEditing={() => {
                      if (
                        formValid &&
                        !isLoading
                      ) {
                        void handleRegister();
                      }
                    }}
                    placeholder="Repeat your passcode"
                    placeholderTextColor="#71685D"
                    returnKeyType="done"
                    secureTextEntry={
                      !showConfirmPassword
                    }
                    selectionColor={
                      COLOURS.rust700
                    }
                    style={
                      styles.textInput
                    }
                    textContentType="newPassword"
                    value={
                      confirmPassword
                    }
                  />

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      showConfirmPassword
                        ? 'Hide confirmed passcode'
                        : 'Show confirmed passcode'
                    }
                    accessibilityState={{
                      expanded:
                        showConfirmPassword,
                    }}
                    hitSlop={4}
                    onPress={() =>
                      setShowConfirmPassword(
                        (current) =>
                          !current,
                      )
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.visibilityButton,

                      pressed &&
                        styles.controlPressed,
                    ]}
                  >
                    <Text
                      style={
                        styles.visibilityButtonText
                      }
                    >
                      {showConfirmPassword
                        ? 'HIDE'
                        : 'SHOW'}
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Register                                                     */}
              {/* ------------------------------------------------------------ */}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isLoading
                    ? 'Creating Explorer account'
                    : 'Create Explorer account'
                }
                accessibilityHint="Creates your Firebase Authentication account and Treasi Explorer profile."
                accessibilityState={{
                  busy:
                    isLoading,
                  disabled:
                    isLoading,
                }}
                disabled={
                  isLoading
                }
                onPress={() => {
                  void handleRegister();
                }}
                style={({
                  pressed,
                }) => [
                  styles.primaryButton,

                  isLoading &&
                    styles.buttonDisabled,

                  pressed &&
                    !isLoading &&
                    styles.primaryButtonPressed,
                ]}
              >
                {isLoading ? (
                  <View
                    style={
                      styles.loadingRow
                    }
                  >
                    <ActivityIndicator
                      color={
                        COLOURS.parchment200
                      }
                      size="small"
                    />

                    <Text
                      style={
                        styles.primaryButtonText
                      }
                    >
                      CREATING EXPLORER...
                    </Text>
                  </View>
                ) : (
                  <Text
                    style={
                      styles.primaryButtonText
                    }
                  >
                    CREATE EXPLORER ACCOUNT
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </View>

          {/* ---------------------------------------------------------------- */}
          {/* Right information panel                                         */}
          {/* ---------------------------------------------------------------- */}

          <View
            style={[
              styles.rightViewport,

              !isLandscape &&
                styles.fullWidthViewport,
            ]}
          >
            <ScrollView
              contentContainerStyle={[
                styles.rightScrollContent,

                isCompact &&
                  styles.rightScrollContentCompact,
              ]}
              showsVerticalScrollIndicator={
                false
              }
              keyboardShouldPersistTaps="handled"
            >
              <View
                style={
                  styles.brassBadge
                }
              >
                <Text
                  style={
                    styles.badgeText
                  }
                >
                  ACCOUNT CHECK
                </Text>
              </View>

              <Text
                accessibilityRole="header"
                style={
                  styles.panelTitle
                }
              >
                ENROLMENT STATUS
              </Text>

              <Text
                maxFontSizeMultiplier={
                  1.7
                }
                style={
                  styles.panelDescription
                }
              >
                Complete the identity fields to create your Firebase Authentication account and Treasi Firestore profile.
              </Text>

              <View
                style={
                  styles.validationList
                }
              >
                {validationItems.map(
                  renderValidationIndicator,
                )}
              </View>

              <View
                style={
                  styles.divider
                }
              />

              <Text
                style={
                  styles.panelTitle
                }
              >
                ACCOUNT DEFAULTS
              </Text>

              <View
                style={
                  styles.infoCard
                }
              >
                <Text
                  style={
                    styles.infoTitle
                  }
                >
                  ONBOARDING
                </Text>

                <Text
                  maxFontSizeMultiplier={
                    1.7
                  }
                  style={
                    styles.infoText
                  }
                >
                  Your new profile is marked as onboarding complete because account registration occurs after the Treasi field introduction.
                </Text>
              </View>

              <View
                style={
                  styles.infoCard
                }
              >
                <Text
                  style={
                    styles.infoTitle
                  }
                >
                  FIELD PREFERENCES
                </Text>

                <Text
                  maxFontSizeMultiplier={
                    1.7
                  }
                  style={
                    styles.infoText
                  }
                >
                  Hardware and interface preferences are stored with safe defaults. Supported preferences can be adjusted later from Profile Settings.
                </Text>
              </View>

              <View
                style={
                  styles.infoCard
                }
              >
                <Text
                  style={
                    styles.infoTitle
                  }
                >
                  LOCATION
                </Text>

                <Text
                  maxFontSizeMultiplier={
                    1.7
                  }
                  style={
                    styles.infoText
                  }
                >
                  Creating an account does not request additional location access. Treasi uses the permission state selected during onboarding and when location-based features are used.
                </Text>
              </View>

              <View
                style={
                  styles.divider
                }
              />

              <Text
                style={
                  styles.panelTitle
                }
              >
                EXISTING EXPLORER?
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign in to existing Explorer account"
                accessibilityHint="Returns to the Treasi sign-in screen."
                disabled={
                  isLoading
                }
                onPress={
                  onNavigateLogin
                }
                style={({
                  pressed,
                }) => [
                  styles.secondaryButton,

                  isLoading &&
                    styles.buttonDisabled,

                  pressed &&
                    !isLoading &&
                    styles.secondaryButtonPressed,
                ]}
              >
                <Text
                  style={
                    styles.secondaryButtonText
                  }
                >
                  SIGN IN TO DISPATCH
                </Text>
              </Pressable>

              <View
                style={
                  styles.footerNoteContainer
                }
              >
                <Text
                  maxFontSizeMultiplier={
                    1.4
                  }
                  style={
                    styles.footerNote
                  }
                >
                  TREASI · EXPLORER ACCOUNT REGISTRATION
                </Text>
              </View>
            </ScrollView>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    );
  };

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        COLOURS.forest800,
    },

    screenWrapper: {
      flex: 1,
      backgroundColor:
        COLOURS.forest800,
    },

    fullWidthViewport: {
      flex: 1,
      width: '100%',
    },

    /* ---------------------------------------------------------------------- */
    /* Left panel                                                             */
    /* ---------------------------------------------------------------------- */

    leftViewport: {
      flex: 0.6,
      minWidth: 0,
      backgroundColor:
        COLOURS.parchment200,
      paddingHorizontal: 24,
      paddingVertical: 14,
    },

    formScrollContent: {
      flexGrow: 1,
      justifyContent:
        'center',
      width: '100%',
      maxWidth: 700,
      alignSelf:
        'center',
      paddingVertical: 8,
    },

    formScrollContentCompact: {
      justifyContent:
        'flex-start',
      paddingVertical: 6,
    },

    headerBlock: {
      marginBottom: 14,
    },

    permitHeader: {
      color:
        COLOURS.bronze600,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11,
      lineHeight: 16,
      fontWeight:
        '700',
      letterSpacing: 1.2,
      marginBottom: 3,
    },

    title: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 24,
      lineHeight: 30,
      fontWeight:
        '800',
      letterSpacing: 1.6,
    },

    subtitle: {
      color:
        COLOURS.rust700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11,
      lineHeight: 17,
      fontWeight:
        '700',
      letterSpacing: 0.8,
      marginTop: 3,
    },

    errorBox: {
      width: '100%',
      flexDirection:
        'row',
      alignItems:
        'center',
      backgroundColor:
        '#FFF0EB',
      borderWidth: 1.5,
      borderLeftWidth: 5,
      borderColor:
        COLOURS.rust700,
      borderRadius: 5,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 14,
    },

    errorText: {
      flex: 1,
      color:
        COLOURS.rust800,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 12,
      lineHeight: 18,
      fontWeight:
        '700',
    },

    fieldGroup: {
      width: '100%',
      gap: 5,
      marginBottom: 11,
    },

    inputLabel: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 12,
      lineHeight: 17,
      fontWeight:
        '800',
      letterSpacing: 0.75,
    },

    inputContainer: {
      width: '100%',
      minHeight: 50,
      flexDirection:
        'row',
      alignItems:
        'center',
      paddingLeft: 12,
      paddingRight: 4,
      paddingVertical: 3,
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
      fontSize: 15,
      lineHeight: 21,
    },

    inputHelpText: {
      color:
        COLOURS.ink700,
      fontSize: 10,
      lineHeight: 15,
      marginTop: 1,
    },

    visibilityButton: {
      minWidth: 52,
      minHeight: 48,
      justifyContent:
        'center',
      alignItems:
        'center',
      borderRadius: 5,
      paddingHorizontal: 7,
    },

    visibilityButtonText: {
      color:
        COLOURS.rust700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
      letterSpacing: 0.6,
    },

    controlPressed: {
      opacity: 0.62,
      backgroundColor:
        'rgba(127, 50, 27, 0.08)',
    },

    primaryButton: {
      minHeight: 52,
      width: '100%',
      alignItems:
        'center',
      justifyContent:
        'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginTop: 6,
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

    primaryButtonText: {
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

    /* ---------------------------------------------------------------------- */
    /* Right panel                                                            */
    /* ---------------------------------------------------------------------- */

    rightViewport: {
      flex: 0.4,
      minWidth: 0,
      backgroundColor:
        COLOURS.forest800,
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderLeftWidth: 3,
      borderLeftColor:
        COLOURS.bronze500,
    },

    rightScrollContent: {
      flexGrow: 1,
      justifyContent:
        'center',
      width: '100%',
      maxWidth: 520,
      alignSelf:
        'center',
      paddingVertical: 6,
    },

    rightScrollContentCompact: {
      justifyContent:
        'flex-start',
    },

    brassBadge: {
      alignSelf:
        'flex-start',
      backgroundColor:
        COLOURS.forest900,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze400,
      borderRadius: 3,
      paddingHorizontal: 9,
      paddingVertical: 5,
      marginBottom: 9,
    },

    badgeText: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
      letterSpacing: 0.9,
    },

    panelTitle: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 14,
      lineHeight: 20,
      fontWeight:
        '800',
      letterSpacing: 1,
      marginBottom: 5,
    },

    panelDescription: {
      color:
        COLOURS.parchment200,
      fontSize: 11,
      lineHeight: 17,
      marginBottom: 12,
    },

    validationList: {
      gap: 6,
    },

    validationRow: {
      minHeight: 43,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 9,
      backgroundColor:
        COLOURS.forest900,
      borderWidth: 1,
      borderColor:
        COLOURS.forest700,
      borderRadius: 5,
      paddingHorizontal: 9,
      paddingVertical: 6,
    },

    validationIndicator: {
      width: 26,
      height: 26,
      borderRadius: 13,
      justifyContent:
        'center',
      alignItems:
        'center',
      flexShrink: 0,
      borderWidth: 1,
    },

    validationIndicatorPending: {
      backgroundColor:
        COLOURS.forest800,
      borderColor:
        COLOURS.bronze400,
    },

    validationIndicatorSuccess: {
      backgroundColor:
        COLOURS.success700,
      borderColor:
        COLOURS.success300,
    },

    validationIndicatorError: {
      backgroundColor:
        COLOURS.rust800,
      borderColor:
        COLOURS.danger300,
    },

    validationIndicatorText: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 13,
      lineHeight: 18,
      fontWeight:
        '800',
    },

    validationIndicatorTextSuccess: {
      color:
        COLOURS.success300,
    },

    validationIndicatorTextError: {
      color:
        COLOURS.danger300,
    },

    validationTextWrapper: {
      flex: 1,
      minWidth: 0,
    },

    validationLabel: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight:
        '700',
      letterSpacing: 0.45,
    },

    validationValue: {
      color:
        COLOURS.parchment200,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '700',
    },

    validationValueSuccess: {
      color:
        COLOURS.success300,
    },

    validationValueError: {
      color:
        COLOURS.danger300,
    },

    divider: {
      height: 1,
      backgroundColor:
        COLOURS.bronze500,
      opacity: 0.5,
      marginVertical: 12,
    },

    infoCard: {
      backgroundColor:
        COLOURS.forest900,
      borderWidth: 1,
      borderColor:
        COLOURS.forest700,
      borderRadius: 5,
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginBottom: 7,
    },

    infoTitle: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '800',
      letterSpacing: 0.7,
      marginBottom: 3,
    },

    infoText: {
      color:
        COLOURS.parchment200,
      fontSize: 10.5,
      lineHeight: 16,
    },

    secondaryButton: {
      minHeight: 48,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        COLOURS.forest900,
      borderWidth: 1.5,
      borderColor:
        COLOURS.bronze400,
      borderRadius: 5,
      paddingHorizontal: 12,
      paddingVertical: 9,
      marginTop: 3,
    },

    secondaryButtonPressed: {
      backgroundColor:
        COLOURS.forest700,
    },

    secondaryButtonText: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11,
      lineHeight: 16,
      fontWeight:
        '800',
      letterSpacing: 0.75,
      textAlign:
        'center',
    },

    footerNoteContainer: {
      borderTopWidth: 1,
      borderTopColor:
        'rgba(195, 160, 106, 0.4)',
      paddingTop: 8,
      marginTop: 12,
    },

    footerNote: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      letterSpacing: 0.65,
      textAlign:
        'center',
    },
  });
