import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  type AlertButton,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Modal,
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

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';

import {
  onAuthStateChanged,
  collection,
  deleteField,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import {
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';

import { FirebaseError } from 'firebase/app';

import {
  auth,
  db,
} from '../config/firebase';

import {
  FieldNavBar,
  type NavigationTab,
} from '../components/FieldNavBar';

import { OnboardingScreen } from './OnboardingScreen';

import type {
  UserDocument,
} from '../types/firestore';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface ProfileSettingsScreenProps {
  onBack?: () => void;

  onSignOut: () => void;

  onNavigate?: (
    screen: string,
  ) => void;

  userData?: UserDocument | null;

  isLoadingUserData?: boolean;

  onUpdateUserSettings?: (
    updatedFields: Partial<UserDocument>,
  ) => Promise<void>;

  /*
   * Account deletion needs secure server-side cleanup because Firestore,
   * Authentication and retained account records cannot be deleted atomically
   * from this client.
   */
  onDeleteAccount?: () => Promise<void>;
}

type SettingKey =
  | 'hapticFeedbackEnabled'
  | 'motionSensitivityEnabled'
  | 'batteryOptimizerEnabled'
  | 'nightModeEnabled'
  | 'telemetryEnabled';

interface SettingConfig {
  key: SettingKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const CALLSIGN_REGEX =
  /^[A-Z0-9][A-Z0-9_-]{2,23}$/;

const MAX_CALLSIGN_LENGTH = 24;

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

  overlay:
    'rgba(10, 16, 11, 0.88)',
} as const;

const MONO_FONT =
  Platform.OS === 'ios'
    ? 'Courier'
    : 'monospace';

const MONO_BOLD_FONT =
  Platform.OS === 'ios'
    ? 'Courier-Bold'
    : 'monospace';

const SETTINGS:
  SettingConfig[] = [
  {
    key:
      'hapticFeedbackEnabled',

    label:
      'HAPTIC FEEDBACK',

    icon:
      'phone-portrait-outline',

    description:
      'Use tactile confirmation for supported field interactions and successful excavations.',
  },

  {
    key:
      'motionSensitivityEnabled',

    label:
      'SENSITIVE SHAKE DETECTION',

    icon:
      'pulse-outline',

    description:
      'Use the more sensitive motion threshold when shake excavation is available.',
  },

  {
    key:
      'telemetryEnabled',

    label:
      'LOCATION SHARING',

    icon:
      'location-outline',

    description:
      'Allow supported social features to publish your latest shared position to your Explorer profile.',
  },

  {
    key:
      'batteryOptimizerEnabled',

    label:
      'BATTERY SAVER PREFERENCE',

    icon:
      'battery-half-outline',

    description:
      'Save the reduced-power preference for location and sensor features that support battery optimisation.',
  },

  {
    key:
      'nightModeEnabled',

    label:
      'NIGHT FIELD PREFERENCE',

    icon:
      'moon-outline',

    description:
      'Save your night-interface preference for screens that support alternate field presentation.',
  },
];

const DEFAULT_SETTINGS:
  Pick<
    UserDocument,
    | 'hapticFeedbackEnabled'
    | 'motionSensitivityEnabled'
    | 'batteryOptimizerEnabled'
    | 'nightModeEnabled'
    | 'telemetryEnabled'
    | 'skipOnboardingAuthFlow'
  > = {
    hapticFeedbackEnabled:
      true,

    motionSensitivityEnabled:
      false,

    batteryOptimizerEnabled:
      false,

    nightModeEnabled:
      false,

    telemetryEnabled:
      false,

    skipOnboardingAuthFlow:
      false,
  };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Keeps development diagnostics out of production output.
const logDevelopmentWarning = (
  message: string,
  error?: unknown,
): void => {
  if (__DEV__) {
    console.warn(
      message,
      error ?? '',
    );
  }
};

// Announces important feedback to screen readers.
const announce = (
  message: string,
): void => {
  AccessibilityInfo
    .announceForAccessibility(
      message,
    );
};

// Shows matching visual and accessibility feedback.
const showAccessibleAlert = (
  title: string,
  message: string,
): void => {
  announce(
    `${title}. ${message}`,
  );

  Alert.alert(
    title,
    message,
  );
};

// Safely converts unknown data into visible text.
const safeString = (
  value: unknown,
  fallback = '',
): string =>
  typeof value ===
    'string'
    ? value
    : fallback;

// Converts callsigns to the same format used during registration.
const normaliseCallsign = (
  value: string,
): string =>
  value
    .trim()
    .toUpperCase();

// Builds a readable profile handle.
const buildHandle = (
  username: string,
): string => {
  const clean =
    username
      .trim()
      .toLowerCase();

  return clean
    ? `@${clean.replace(
        /[^a-z0-9_-]/g,
        '_',
      )}`
    : '@unregistered';
};

// Formats the account creation timestamp using British English.
const formatMemberSince = (
  createdAt: unknown,
): string => {
  if (!createdAt) {
    return 'N/A';
  }

  try {
    const possibleTimestamp =
      createdAt as {
        toDate?: () => Date;
      };

    const date =
      typeof possibleTimestamp
        .toDate ===
        'function'
        ? possibleTimestamp
            .toDate()
        : createdAt instanceof
            Date
          ? createdAt
          : new Date(
              createdAt as
                string | number,
            );

    if (
      Number.isNaN(
        date.getTime(),
      )
    ) {
      return 'N/A';
    }

    return date
      .toLocaleDateString(
        'en-GB',
        {
          month:
            'short',

          year:
            'numeric',
        },
      )
      .toUpperCase();
  } catch {
    return 'N/A';
  }
};

// Uses the same rank thresholds as Dashboard and Leaderboard.
const calculateRank = (
  points: number,
): string => {
  if (
    points >=
    3000
  ) {
    return 'MASTER EXPLORER';
  }

  if (
    points >=
    1500
  ) {
    return 'TRAILBLAZER III';
  }

  if (
    points >=
    500
  ) {
    return 'PATHFINDER II';
  }

  return 'NOVICE SCOUT I';
};

// Normalises malformed preference values.
const normaliseBoolean = (
  value: unknown,
): boolean =>
  value === true;

// Converts Firebase errors into user-facing messages.
const getFriendlyError = (
  error: unknown,
  fallback: string,
): string => {
  if (
    error instanceof
    FirebaseError
  ) {
    switch (
      error.code
    ) {
      case 'auth/network-request-failed':
        return 'The network connection failed. Check your connection and try again.';

      case 'auth/requires-recent-login':
        return 'Firebase requires a recent sign-in before this security action can continue.';

      case 'auth/too-many-requests':
        return 'Too many requests were made. Wait a moment before trying again.';

      case 'auth/user-disabled':
        return 'This Firebase account has been disabled.';

      case 'auth/invalid-email':
        return 'The account email address is invalid.';

      case 'permission-denied':
      case 'firestore/permission-denied':
        return 'Treasi does not have permission to make this profile change.';

      case 'unavailable':
      case 'firestore/unavailable':
        return 'The field network is temporarily unavailable. Try again when your connection is restored.';

      default:
        break;
    }
  }

  if (
    error instanceof
    Error &&
    error.message
  ) {
    return error.message;
  }

  return fallback;
};

/* -------------------------------------------------------------------------- */
/* Profile Settings Screen                                                    */
/* -------------------------------------------------------------------------- */

export const ProfileSettingsScreen:
  React.FC<
    ProfileSettingsScreenProps
  > = ({
    onBack,
    onSignOut,
    onNavigate,
    userData:
      parentUserData =
        null,
    isLoadingUserData =
      false,
    onUpdateUserSettings,
    onDeleteAccount,
  }) => {
    const insets =
      useSafeAreaInsets();

    const {
      width,
      height,
    } =
      useWindowDimensions();

    const isLandscape =
      width > height;

    const currentTab:
      NavigationTab =
      'PROFILE';

    const currentFirebaseUser =
      auth.currentUser;

    const currentUid =
      currentFirebaseUser
        ?.uid ??
      parentUserData
        ?.uid ??
      '';

    const isMountedRef =
      useRef(true);

    /* ---------------------------------------------------------------------- */
    /* Profile state                                                          */
    /* ---------------------------------------------------------------------- */

    const [
      localUserData,
      setLocalUserData,
    ] =
      useState<
        UserDocument | null
      >(
        parentUserData,
      );

    const [
      isLoadingProfile,
      setIsLoadingProfile,
    ] =
      useState(
        isLoadingUserData &&
          !parentUserData,
      );

    const [
      profileError,
      setProfileError,
    ] =
      useState<
        string | null
      >(null);

    const [
      retryKey,
      setRetryKey,
    ] =
      useState(0);

    const [
      authRefreshKey,
      setAuthRefreshKey,
    ] =
      useState(0);

    /* ---------------------------------------------------------------------- */
    /* Settings state                                                         */
    /* ---------------------------------------------------------------------- */

    const [
      hapticFeedbackEnabled,
      setHapticFeedbackEnabled,
    ] =
      useState(true);

    const [
      motionSensitivityEnabled,
      setMotionSensitivityEnabled,
    ] =
      useState(false);

    const [
      batteryOptimizerEnabled,
      setBatteryOptimizerEnabled,
    ] =
      useState(false);

    const [
      nightModeEnabled,
      setNightModeEnabled,
    ] =
      useState(false);

    const [
      telemetryEnabled,
      setTelemetryEnabled,
    ] =
      useState(false);

    const [
      isSavingSetting,
      setIsSavingSetting,
    ] =
      useState<
        SettingKey | null
      >(null);

    const [
      isResettingPreferences,
      setIsResettingPreferences,
    ] =
      useState(false);

    const [
      isClearingLocation,
      setIsClearingLocation,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* Identity state                                                         */
    /* ---------------------------------------------------------------------- */

    const [
      isEditingIdentity,
      setIsEditingIdentity,
    ] =
      useState(false);

    const [
      callsign,
      setCallsign,
    ] =
      useState('');

    const [
      originalCallsign,
      setOriginalCallsign,
    ] =
      useState('');

    const [
      callsignError,
      setCallsignError,
    ] =
      useState<
        string | null
      >(null);

    const [
      isSavingIdentity,
      setIsSavingIdentity,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* Account actions                                                        */
    /* ---------------------------------------------------------------------- */

    const [
      isSigningOut,
      setIsSigningOut,
    ] =
      useState(false);

    const [
      isSendingVerification,
      setIsSendingVerification,
    ] =
      useState(false);

    const [
      isSendingPasswordReset,
      setIsSendingPasswordReset,
    ] =
      useState(false);

    const [
      verificationSent,
      setVerificationSent,
    ] =
      useState(false);

    const [
      deleteModalVisible,
      setDeleteModalVisible,
    ] =
      useState(false);

    const [
      deleteConfirmation,
      setDeleteConfirmation,
    ] =
      useState('');

    const [
      isDeletingAccount,
      setIsDeletingAccount,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* Onboarding / accessibility                                             */
    /* ---------------------------------------------------------------------- */

    const [
      onboardingVisible,
      setOnboardingVisible,
    ] =
      useState(false);

    const [
      reduceMotionEnabled,
      setReduceMotionEnabled,
    ] =
      useState(false);

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
    /* Reduced Motion                                                         */
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
          // The settings screen remains usable if this preference is unavailable.
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
    /* Apply profile state                                                    */
    /* ---------------------------------------------------------------------- */

    const applyProfileData =
      useCallback(
        (
          data:
            UserDocument,
        ): void => {
          setLocalUserData(
            data,
          );

          const username =
            safeString(
              data.username,
            ) ||
            safeString(
              auth.currentUser
                ?.displayName,
            ) ||
            'EXPLORER';

          setCallsign(
            username,
          );

          setOriginalCallsign(
            username,
          );

          setHapticFeedbackEnabled(
            data.hapticFeedbackEnabled !==
              false,
          );

          setMotionSensitivityEnabled(
            normaliseBoolean(
              data.motionSensitivityEnabled,
            ),
          );

          setBatteryOptimizerEnabled(
            normaliseBoolean(
              data.batteryOptimizerEnabled,
            ),
          );

          setNightModeEnabled(
            normaliseBoolean(
              data.nightModeEnabled,
            ),
          );

          setTelemetryEnabled(
            normaliseBoolean(
              data.telemetryEnabled,
            ),
          );
        },
        [],
      );

    useEffect(() => {
      if (
        parentUserData
      ) {
        applyProfileData(
          parentUserData,
        );
      }
    }, [
      applyProfileData,
      parentUserData,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Live profile subscription                                              */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      const user =
        auth.currentUser;

      if (!user) {
        setIsLoadingProfile(
          false,
        );

        if (
          !parentUserData
        ) {
          setLocalUserData(
            null,
          );

          setProfileError(
            'No authenticated Explorer session was found.',
          );
        }

        return;
      }

      setIsLoadingProfile(
        true,
      );

      setProfileError(
        null,
      );

      const userReference =
        doc(
          db,
          'users',
          user.uid,
        );

      const unsubscribe =
        onSnapshot(
          userReference,

          (
            snapshot,
          ) => {
            if (
              !snapshot.exists()
            ) {
              setProfileError(
                'Your Firebase sign-in is active, but the Treasi profile document could not be found.',
              );

              setIsLoadingProfile(
                false,
              );

              return;
            }

            applyProfileData(
              snapshot.data() as
                UserDocument,
            );

            setProfileError(
              null,
            );

            setIsLoadingProfile(
              false,
            );
          },

          (
            error,
          ) => {
            logDevelopmentWarning(
              '[Treasi Profile] Profile subscription failed:',
              error,
            );

            setProfileError(
              getFriendlyError(
                error,
                'Treasi could not synchronise your Explorer profile.',
              ),
            );

            setIsLoadingProfile(
              false,
            );
          },
        );

      return unsubscribe;
    }, [
      applyProfileData,
      parentUserData,
      retryKey,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Generic preference persistence                                         */
    /* ---------------------------------------------------------------------- */

    const persistUserFields =
      useCallback(
        async (
          fields:
            Partial<UserDocument>,
        ): Promise<void> => {
          const uid =
            auth.currentUser
              ?.uid ??
            localUserData
              ?.uid;

          if (!uid) {
            throw new Error(
              'No authenticated Explorer session was found.',
            );
          }

          if (
            onUpdateUserSettings
          ) {
            await onUpdateUserSettings(
              fields,
            );
          } else {
            await updateDoc(
              doc(
                db,
                'users',
                uid,
              ),
              {
                ...fields,

                updatedAt:
                  serverTimestamp(),
              },
            );
          }

          setLocalUserData(
            (
              previous,
            ) =>
              previous
                ? {
                    ...previous,
                    ...fields,
                  }
                : previous,
          );
        },
        [
          localUserData
            ?.uid,
          onUpdateUserSettings,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Setting state helper                                                   */
    /* ---------------------------------------------------------------------- */

    const getSettingValue =
      useCallback(
        (
          key:
            SettingKey,
        ): boolean => {
          switch (key) {
            case 'hapticFeedbackEnabled':
              return hapticFeedbackEnabled;

            case 'motionSensitivityEnabled':
              return motionSensitivityEnabled;

            case 'batteryOptimizerEnabled':
              return batteryOptimizerEnabled;

            case 'nightModeEnabled':
              return nightModeEnabled;

            case 'telemetryEnabled':
              return telemetryEnabled;

            default:
              return false;
          }
        },
        [
          batteryOptimizerEnabled,
          hapticFeedbackEnabled,
          motionSensitivityEnabled,
          nightModeEnabled,
          telemetryEnabled,
        ],
      );

    const setSettingValue =
      useCallback(
        (
          key:
            SettingKey,
          value:
            boolean,
        ): void => {
          switch (key) {
            case 'hapticFeedbackEnabled':
              setHapticFeedbackEnabled(
                value,
              );
              break;

            case 'motionSensitivityEnabled':
              setMotionSensitivityEnabled(
                value,
              );
              break;

            case 'batteryOptimizerEnabled':
              setBatteryOptimizerEnabled(
                value,
              );
              break;

            case 'nightModeEnabled':
              setNightModeEnabled(
                value,
              );
              break;

            case 'telemetryEnabled':
              setTelemetryEnabled(
                value,
              );
              break;

            default:
              break;
          }
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Toggle preference                                                      */
    /* ---------------------------------------------------------------------- */

    const handleToggleChange =
      useCallback(
        async (
          key:
            SettingKey,
          nextValue:
            boolean,
        ): Promise<void> => {
          if (
            isSavingSetting
          ) {
            return;
          }

          const previousValue =
            getSettingValue(
              key,
            );

          setSettingValue(
            key,
            nextValue,
          );

          setIsSavingSetting(
            key,
          );

          try {
            /*
             * Disabling location sharing also deletes the previously stored
             * shared position immediately instead of leaving stale telemetry.
             */
            if (
              key ===
                'telemetryEnabled' &&
              !nextValue
            ) {
              const uid =
                auth.currentUser
                  ?.uid;

              if (!uid) {
                throw new Error(
                  'No authenticated Explorer session was found.',
                );
              }

              await updateDoc(
                doc(
                  db,
                  'users',
                  uid,
                ),
                {
                  telemetryEnabled:
                    false,

                  location:
                    deleteField(),

                  updatedAt:
                    serverTimestamp(),
                },
              );

              setLocalUserData(
                (
                  previous,
                ) =>
                  previous
                    ? {
                        ...previous,

                        telemetryEnabled:
                          false,

                        location:
                          null,
                      }
                    : previous,
              );

              return;
            }

            await persistUserFields(
              {
                [key]:
                  nextValue,
              } as
                Partial<UserDocument>,
            );
          } catch (
            error: unknown
          ) {
            setSettingValue(
              key,
              previousValue,
            );

            showAccessibleAlert(
              'Preference Error',
              getFriendlyError(
                error,
                'Treasi could not save this preference.',
              ),
            );
          } finally {
            if (
              isMountedRef.current
            ) {
              setIsSavingSetting(
                null,
              );
            }
          }
        },
        [
          getSettingValue,
          isSavingSetting,
          persistUserFields,
          setSettingValue,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Clear shared location                                                  */
    /* ---------------------------------------------------------------------- */

    const handleClearSharedLocation =
      useCallback(
        async (): Promise<void> => {
          const user =
            auth.currentUser;

          if (
            !user ||
            isClearingLocation
          ) {
            return;
          }

          setIsClearingLocation(
            true,
          );

          try {
            await updateDoc(
              doc(
                db,
                'users',
                user.uid,
              ),
              {
                telemetryEnabled:
                  false,

                location:
                  deleteField(),

                updatedAt:
                  serverTimestamp(),
              },
            );

            setTelemetryEnabled(
              false,
            );

            setLocalUserData(
              (
                previous,
              ) =>
                previous
                  ? {
                      ...previous,

                      telemetryEnabled:
                        false,

                      location:
                        null,
                    }
                  : previous,
            );

            showAccessibleAlert(
              'Location Sharing Cleared',
              'Your saved shared position was removed and Location Sharing was switched off.',
            );
          } catch (
            error: unknown
          ) {
            showAccessibleAlert(
              'Location Error',
              getFriendlyError(
                error,
                'Treasi could not clear your shared position.',
              ),
            );
          } finally {
            if (
              isMountedRef.current
            ) {
              setIsClearingLocation(
                false,
              );
            }
          }
        },
        [
          isClearingLocation,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Reset preferences                                                      */
    /* ---------------------------------------------------------------------- */

    const executePreferenceReset =
      useCallback(
        async (): Promise<void> => {
          const user =
            auth.currentUser;

          if (
            !user ||
            isResettingPreferences
          ) {
            return;
          }

          setIsResettingPreferences(
            true,
          );

          try {
            await updateDoc(
              doc(
                db,
                'users',
                user.uid,
              ),
              {
                ...DEFAULT_SETTINGS,

                location:
                  deleteField(),

                updatedAt:
                  serverTimestamp(),
              },
            );

            setHapticFeedbackEnabled(
              true,
            );

            setMotionSensitivityEnabled(
              false,
            );

            setBatteryOptimizerEnabled(
              false,
            );

            setNightModeEnabled(
              false,
            );

            setTelemetryEnabled(
              false,
            );

            setLocalUserData(
              (
                previous,
              ) =>
                previous
                  ? {
                      ...previous,

                      ...DEFAULT_SETTINGS,

                      location:
                        null,
                    }
                  : previous,
            );

            showAccessibleAlert(
              'Preferences Restored',
              'Treasi preferences were restored to their default values. Stored location sharing was also cleared.',
            );
          } catch (
            error: unknown
          ) {
            showAccessibleAlert(
              'Reset Failed',
              getFriendlyError(
                error,
                'Treasi could not restore your default preferences.',
              ),
            );
          } finally {
            if (
              isMountedRef.current
            ) {
              setIsResettingPreferences(
                false,
              );
            }
          }
        },
        [
          isResettingPreferences,
        ],
      );

    const handleResetPreferences =
      useCallback(
        (): void => {
          if (
            isResettingPreferences
          ) {
            return;
          }

          Alert.alert(
            'RESET FIELD PREFERENCES',
            'Restore feedback, motion, battery, display and location-sharing preferences to their Treasi defaults?',
            [
              {
                text:
                  'CANCEL',

                style:
                  'cancel',
              },

              {
                text:
                  'RESET',

                style:
                  'destructive',

                onPress: () => {
                  void executePreferenceReset();
                },
              },
            ],
          );
        },
        [
          executePreferenceReset,
          isResettingPreferences,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Edit identity                                                          */
    /* ---------------------------------------------------------------------- */

    const handleStartEditingIdentity =
      useCallback(
        (): void => {
          const currentName =
            safeString(
              localUserData
                ?.username,
            ) ||
            safeString(
              auth.currentUser
                ?.displayName,
            ) ||
            'EXPLORER';

          setOriginalCallsign(
            currentName,
          );

          setCallsign(
            currentName,
          );

          setCallsignError(
            null,
          );

          setIsEditingIdentity(
            true,
          );
        },
        [
          localUserData
            ?.username,
        ],
      );

    const handleCancelIdentityEdit =
      useCallback(
        (): void => {
          setCallsign(
            originalCallsign,
          );

          setCallsignError(
            null,
          );

          setIsEditingIdentity(
            false,
          );
        },
        [
          originalCallsign,
        ],
      );

    const handleSaveIdentity =
      useCallback(
        async (): Promise<void> => {
          const user:
            User | null =
            auth.currentUser;

          if (
            !user ||
            isSavingIdentity
          ) {
            return;
          }

          const nextCallsign =
            normaliseCallsign(
              callsign,
            );

          if (
            !CALLSIGN_REGEX.test(
              nextCallsign,
            )
          ) {
            const message =
              'Use 3–24 characters. The first character must be a letter or number; only letters, numbers, underscores and hyphens are allowed.';

            setCallsignError(
              message,
            );

            announce(
              `Invalid callsign. ${message}`,
            );

            return;
          }

          if (
            nextCallsign ===
            normaliseCallsign(
              originalCallsign,
            )
          ) {
            setCallsign(
              nextCallsign,
            );

            setCallsignError(
              null,
            );

            setIsEditingIdentity(
              false,
            );

            return;
          }

          setIsSavingIdentity(
            true,
          );

          setCallsignError(
            null,
          );

          const previousAuthName =
            user.displayName;

          try {
            /*
             * The current schema does not provide an atomic callsign
             * reservation collection, so this is a best-effort duplicate
             * check rather than a strict uniqueness guarantee.
             */
            const duplicateQuery =
              query(
                collection(
                  db,
                  'users',
                ),

                where(
                  'username',
                  '==',
                  nextCallsign,
                ),

                limit(2),
              );

            const duplicateSnapshot =
              await getDocs(
                duplicateQuery,
              );

            const duplicateExists =
              duplicateSnapshot
                .docs
                .some(
                  (
                    snapshotDocument,
                  ) =>
                    snapshotDocument.id !==
                    user.uid,
                );

            if (
              duplicateExists
            ) {
              setCallsignError(
                'That Explorer callsign is already in use.',
              );

              announce(
                'That Explorer callsign is already in use.',
              );

              return;
            }

            await updateProfile(
              user,
              {
                displayName:
                  nextCallsign,
              },
            );

            try {
              const userReference =
                doc(
                  db,
                  'users',
                  user.uid,
                );

              const activityReference =
                doc(
                  collection(
                    db,
                    'activity_feed',
                  ),
                );

              const batch =
                writeBatch(
                  db,
                );

              batch.update(
                userReference,
                {
                  username:
                    nextCallsign,

                  updatedAt:
                    serverTimestamp(),
                },
              );

              batch.set(
                activityReference,
                {
                  activityId:
                    activityReference.id,

                  userId:
                    user.uid,

                  username:
                    nextCallsign,

                  type:
                    'PROFILE_UPDATED',

                  message:
                    'UPDATED EXPLORER CALLSIGN',

                  targetId:
                    user.uid,

                  createdAt:
                    serverTimestamp(),
                },
              );

              await batch.commit();
            } catch (
              firestoreError:
                unknown
            ) {
              /*
               * Roll back the Auth display name when Firestore could not
               * complete the corresponding identity update.
               */
              try {
                await updateProfile(
                  user,
                  {
                    displayName:
                      previousAuthName,
                  },
                );
              } catch (
                rollbackError:
                  unknown
              ) {
                logDevelopmentWarning(
                  '[Treasi Profile] Auth display-name rollback failed:',
                  rollbackError,
                );
              }

              throw firestoreError;
            }

            if (
              !isMountedRef.current
            ) {
              return;
            }

            setCallsign(
              nextCallsign,
            );

            setOriginalCallsign(
              nextCallsign,
            );

            setLocalUserData(
              (
                previous,
              ) =>
                previous
                  ? {
                      ...previous,

                      username:
                        nextCallsign,
                    }
                  : previous,
            );

            setIsEditingIdentity(
              false,
            );

            announce(
              `Explorer callsign updated to ${nextCallsign}.`,
            );
          } catch (
            error: unknown
          ) {
            const message =
              getFriendlyError(
                error,
                'Treasi could not update your Explorer identity.',
              );

            setCallsignError(
              message,
            );

            announce(
              `Profile update failed. ${message}`,
            );
          } finally {
            if (
              isMountedRef.current
            ) {
              setIsSavingIdentity(
                false,
              );
            }
          }
        },
        [
          callsign,
          isSavingIdentity,
          originalCallsign,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Verification email                                                     */
    /* ---------------------------------------------------------------------- */

    const handleSendVerification =
      useCallback(
        async (): Promise<void> => {
          const user =
            auth.currentUser;

          if (
            !user ||
            user.emailVerified ||
            isSendingVerification
          ) {
            return;
          }

          setIsSendingVerification(
            true,
          );

          try {
            await sendEmailVerification(
              user,
            );

            if (
              !isMountedRef.current
            ) {
              return;
            }

            setVerificationSent(
              true,
            );

            showAccessibleAlert(
              'Verification Sent',
              'Firebase sent a verification link to your account email address.',
            );
          } catch (
            error: unknown
          ) {
            showAccessibleAlert(
              'Verification Failed',
              getFriendlyError(
                error,
                'Treasi could not send the verification email.',
              ),
            );
          } finally {
            if (
              isMountedRef.current
            ) {
              setIsSendingVerification(
                false,
              );
            }
          }
        },
        [
          isSendingVerification,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Password reset                                                         */
    /* ---------------------------------------------------------------------- */

    const handlePasswordReset =
      useCallback(
        async (): Promise<void> => {
          const email =
            auth.currentUser
              ?.email ??
            localUserData
              ?.email;

          if (
            !email ||
            isSendingPasswordReset
          ) {
            return;
          }

          setIsSendingPasswordReset(
            true,
          );

          try {
            await sendPasswordResetEmail(
              auth,
              email,
            );

            showAccessibleAlert(
              'Reset Email Sent',
              'Firebase sent password-reset instructions to your account email address.',
            );
          } catch (
            error: unknown
          ) {
            showAccessibleAlert(
              'Password Reset Failed',
              getFriendlyError(
                error,
                'Treasi could not send the password-reset email.',
              ),
            );
          } finally {
            if (
              isMountedRef.current
            ) {
              setIsSendingPasswordReset(
                false,
              );
            }
          }
        },
        [
          isSendingPasswordReset,
          localUserData
            ?.email,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Refresh account                                                        */
    /* ---------------------------------------------------------------------- */

    const handleRefreshProfile =
      useCallback(
        async (): Promise<void> => {
          setProfileError(
            null,
          );

          setIsLoadingProfile(
            true,
          );

          try {
            const user =
              auth.currentUser;

            if (user) {
              await reload(
                user,
              );

              setAuthRefreshKey(
                (
                  current,
                ) =>
                  current + 1,
              );
            }

            setRetryKey(
              (
                current,
              ) =>
                current + 1,
            );

            announce(
              'Explorer profile refresh started.',
            );
          } catch (
            error: unknown
          ) {
            setIsLoadingProfile(
              false,
            );

            showAccessibleAlert(
              'Refresh Failed',
              getFriendlyError(
                error,
                'Treasi could not refresh the account status.',
              ),
            );
          }
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* System settings                                                        */
    /* ---------------------------------------------------------------------- */

    const handleOpenSystemSettings =
      useCallback(
        async (): Promise<void> => {
          if (
            Platform.OS ===
            'web'
          ) {
            showAccessibleAlert(
              'Browser Settings',
              'Use your browser site settings to manage location, permissions and accessibility preferences for Treasi.',
            );

            return;
          }

          try {
            await Linking
              .openSettings();
          } catch (
            error: unknown
          ) {
            logDevelopmentWarning(
              '[Treasi Profile] Unable to open system settings:',
              error,
            );

            showAccessibleAlert(
              'Settings Unavailable',
              'Open your device settings manually to change Treasi permissions.',
            );
          }
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Sign out                                                               */
    /* ---------------------------------------------------------------------- */

    const executeSignOut =
      useCallback(
        async (): Promise<void> => {
          if (
            isSigningOut
          ) {
            return;
          }

          setIsSigningOut(
            true,
          );

          try {
            await signOut(
              auth,
            );

            onSignOut();
          } catch (
            error: unknown
          ) {
            showAccessibleAlert(
              'Sign Out Failed',
              getFriendlyError(
                error,
                'Treasi could not end the current Explorer session.',
              ),
            );
          } finally {
            if (
              isMountedRef.current
            ) {
              setIsSigningOut(
                false,
              );
            }
          }
        },
        [
          isSigningOut,
          onSignOut,
        ],
      );

    const handleSignOut =
      useCallback(
        (): void => {
          if (
            isSigningOut
          ) {
            return;
          }

          Alert.alert(
            'END EXPLORER SESSION',
            'Sign out of Treasi on this device?',
            [
              {
                text:
                  'CANCEL',

                style:
                  'cancel',
              },

              {
                text:
                  'SIGN OUT',

                style:
                  'destructive',

                onPress: () => {
                  void executeSignOut();
                },
              },
            ],
          );
        },
        [
          executeSignOut,
          isSigningOut,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Delete account                                                         */
    /* ---------------------------------------------------------------------- */

    const handleOpenDeleteAccount =
      useCallback(
        (): void => {
          setDeleteConfirmation(
            '',
          );

          setDeleteModalVisible(
            true,
          );
        },
        [],
      );

    const handleConfirmDeleteAccount =
      useCallback(
        async (): Promise<void> => {
          if (
            deleteConfirmation
              .trim()
              .toUpperCase() !==
            'DELETE'
          ) {
            return;
          }

          /*
           * Do not delete Firebase Auth alone. Doing so would leave the
           * Firestore profile and email behind because the current rules
           * intentionally prohibit client deletion of user documents.
           */
          if (
            !onDeleteAccount
          ) {
            showAccessibleAlert(
              'Secure Deletion Not Configured',
              'Treasi will not delete only your Firebase sign-in while leaving your profile data behind. A secure server-side account deletion handler must be configured before this operation can be enabled.',
            );

            return;
          }

          if (
            isDeletingAccount
          ) {
            return;
          }

          setIsDeletingAccount(
            true,
          );

          try {
            await onDeleteAccount();

            if (
              !isMountedRef.current
            ) {
              return;
            }

            setDeleteModalVisible(
              false,
            );

            setDeleteConfirmation(
              '',
            );

            /*
             * The parent navigator may safely redirect after the secure
             * deletion handler has removed the account.
             */
            onSignOut();
          } catch (
            error: unknown
          ) {
            showAccessibleAlert(
              'Account Deletion Failed',
              getFriendlyError(
                error,
                'Treasi could not securely delete the account.',
              ),
            );
          } finally {
            if (
              isMountedRef.current
            ) {
              setIsDeletingAccount(
                false,
              );
            }
          }
        },
        [
          deleteConfirmation,
          isDeletingAccount,
          onDeleteAccount,
          onSignOut,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Derived profile information                                            */
    /* ---------------------------------------------------------------------- */

    const currentUsername =
      safeString(
        localUserData
          ?.username,
      ) ||
      safeString(
        currentFirebaseUser
          ?.displayName,
      ) ||
      'EXPLORER';

    const currentEmail =
      safeString(
        localUserData
          ?.email,
        currentFirebaseUser
          ?.email ??
          'N/A',
      );

    const handle =
      useMemo(
        () =>
          buildHandle(
            currentUsername,
          ),
        [
          currentUsername,
        ],
      );

    const totalPoints =
      typeof localUserData
        ?.totalPoints ===
        'number' &&
      Number.isFinite(
        localUserData
          .totalPoints,
      )
        ? Math.max(
            0,
            Math.floor(
              localUserData
                .totalPoints,
            ),
          )
        : 0;

    const rank =
      calculateRank(
        totalPoints,
      );

    const memberSince =
      formatMemberSince(
        localUserData
          ?.createdAt,
      );

    /*
     * authRefreshKey intentionally participates so a Firebase reload causes
     * this value to be re-read even though the User object identity is stable.
     */
    const emailVerified =
      useMemo(
        () =>
          auth.currentUser
            ?.emailVerified ===
          true,
        [
          authRefreshKey,
          currentFirebaseUser
            ?.uid,
        ],
      );

    const onboardingComplete =
      localUserData
        ?.hasCompletedOnboarding ===
      true;

    const hasSharedLocation =
      Boolean(
        localUserData
          ?.location,
      );

    const isProfileLoading =
      isLoadingProfile ||
      (
        isLoadingUserData &&
        !localUserData
      );

    /* ---------------------------------------------------------------------- */
    /* Setting renderer                                                       */
    /* ---------------------------------------------------------------------- */

    const renderSetting =
      (
        config:
          SettingConfig,
      ): React.ReactNode => {
        const value =
          getSettingValue(
            config.key,
          );

        const saving =
          isSavingSetting ===
          config.key;

        return (
          <View
            key={
              config.key
            }
            accessible
            accessibilityLabel={`${config.label}. ${
              value
                ? 'On'
                : 'Off'
            }. ${config.description}`}
            style={
              styles.settingCard
            }
          >
            <View
              accessible={
                false
              }
              importantForAccessibility="no-hide-descendants"
              style={
                styles.settingIdentity
              }
            >
              <View
                style={
                  styles.settingIcon
                }
              >
                <Ionicons
                  name={
                    config.icon
                  }
                  size={18}
                  color={
                    COLOURS.rust700
                  }
                />
              </View>

              <View
                style={
                  styles.settingTextGroup
                }
              >
                <Text
                  style={
                    styles.settingLabel
                  }
                >
                  {
                    config.label
                  }
                </Text>

                <Text
                  maxFontSizeMultiplier={
                    1.7
                  }
                  style={
                    styles.settingDescription
                  }
                >
                  {
                    config.description
                  }
                </Text>
              </View>
            </View>

            <View
              style={
                styles.settingControl
              }
            >
              {saving ? (
                <ActivityIndicator
                  size="small"
                  color={
                    COLOURS.rust700
                  }
                />
              ) : (
                <Switch
                  accessibilityLabel={
                    config.label
                  }
                  accessibilityRole="switch"
                  accessibilityState={{
                    checked:
                      value,

                    disabled:
                      Boolean(
                        isSavingSetting,
                      ),
                  }}
                  disabled={
                    Boolean(
                      isSavingSetting,
                    )
                  }
                  ios_backgroundColor={
                    COLOURS.bronze600
                  }
                  thumbColor={
                    value
                      ? COLOURS.parchment100
                      : '#7A6B58'
                  }
                  trackColor={{
                    false:
                      '#B7A98C',

                    true:
                      COLOURS.rust700,
                  }}
                  value={
                    value
                  }
                  onValueChange={(
                    nextValue,
                  ) => {
                    void handleToggleChange(
                      config.key,
                      nextValue,
                    );
                  }}
                />
              )}
            </View>
          </View>
        );
      };

    /* ---------------------------------------------------------------------- */
    /* Loading / missing session                                              */
    /* ---------------------------------------------------------------------- */

    if (
      isProfileLoading &&
      !localUserData
    ) {
      return (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading Explorer profile"
          style={[
            styles.screen,
            styles.centeredState,
          ]}
        >
          <ActivityIndicator
            size="large"
            color={
              COLOURS.bronze400
            }
          />

          <Text
            style={
              styles.loadingText
            }
          >
            FETCHING EXPLORER PROFILE…
          </Text>
        </View>
      );
    }

    if (
      !localUserData &&
      !currentFirebaseUser
    ) {
      return (
        <View
          style={[
            styles.screen,
            styles.centeredState,
          ]}
        >
          <Ionicons
            name="person-circle-outline"
            size={52}
            color={
              COLOURS.bronze400
            }
          />

          <Text
            accessibilityRole="header"
            style={
              styles.loadingText
            }
          >
            NO ACTIVE EXPLORER SESSION
          </Text>

          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Return to Dashboard"
              onPress={
                onBack
              }
              style={({
                pressed,
              }) => [
                styles.standaloneBackButton,

                pressed &&
                  styles.darkPressed,
              ]}
            >
              <Ionicons
                name="arrow-back"
                size={17}
                color={
                  COLOURS.parchment100
                }
              />

              <Text
                style={
                  styles.standaloneBackText
                }
              >
                RETURN
              </Text>
            </Pressable>
          ) : null}
        </View>
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Render                                                                 */
    /* ---------------------------------------------------------------------- */

    return (
      <KeyboardAvoidingView
        style={
          styles.screen
        }
        behavior={
          Platform.OS ===
          'ios'
            ? 'padding'
            : undefined
        }
      >
        <View
          style={[
            styles.splitWrapper,

            {
              flexDirection:
                isLandscape
                  ? 'row'
                  : 'column',

              paddingLeft:
                Math.max(
                  insets.left,
                  12,
                ),

              paddingRight:
                Math.max(
                  insets.right,
                  12,
                ),

              paddingTop:
                Math.max(
                  insets.top,
                  10,
                ),

              paddingBottom:
                Math.max(
                  insets.bottom,
                  10,
                ),
            },
          ]}
        >
          {/* ================================================================ */}
          {/* 60% — SETTINGS                                                  */}
          {/* ================================================================ */}

          <View
            style={[
              styles.settingsPanel,

              isLandscape
                ? styles.settingsPanelLandscape
                : styles.panelPortrait,
            ]}
          >
            <View
              style={
                styles.settingsHeader
              }
            >
              <View
                style={
                  styles.headerIdentity
                }
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="options-outline"
                  size={20}
                  color={
                    COLOURS.rust700
                  }
                />

                <View
                  style={
                    styles.headerTextGroup
                  }
                >
                  <Text
                    accessibilityRole="header"
                    maxFontSizeMultiplier={
                      1.6
                    }
                    style={
                      styles.settingsTitle
                    }
                  >
                    FIELD SETTINGS
                  </Text>

                  <Text
                    maxFontSizeMultiplier={
                      1.5
                    }
                    style={
                      styles.settingsSubtitle
                    }
                  >
                    FEEDBACK · PRIVACY · GUIDANCE · ACCOUNT
                  </Text>
                </View>
              </View>

              {isSavingSetting ||
              isSavingIdentity ||
              isResettingPreferences ? (
                <ActivityIndicator
                  size="small"
                  color={
                    COLOURS.rust700
                  }
                />
              ) : null}
            </View>

            {profileError ? (
              <View
                accessible
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={
                  styles.profileErrorCard
                }
              >
                <Ionicons
                  name="warning-outline"
                  size={18}
                  color={
                    COLOURS.rust800
                  }
                />

                <Text
                  maxFontSizeMultiplier={
                    1.7
                  }
                  style={
                    styles.profileErrorText
                  }
                >
                  {
                    profileError
                  }
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry profile synchronisation"
                  onPress={() => {
                    void handleRefreshProfile();
                  }}
                  style={({
                    pressed,
                  }) => [
                    styles.errorRetryButton,

                    pressed &&
                      styles.lightPressed,
                  ]}
                >
                  <Text
                    style={
                      styles.errorRetryText
                    }
                  >
                    RETRY
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <ScrollView
              style={
                styles.settingsScroll
              }
              contentContainerStyle={
                styles.settingsScrollContent
              }
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={
                false
              }
            >
              {/* ------------------------------------------------------------ */}
              {/* Feedback                                                     */}
              {/* ------------------------------------------------------------ */}

              <View
                style={
                  styles.sectionHeader
                }
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="pulse-outline"
                  size={16}
                  color={
                    COLOURS.rust700
                  }
                />

                <Text
                  accessibilityRole="header"
                  style={
                    styles.sectionTitle
                  }
                >
                  FIELD FEEDBACK
                </Text>
              </View>

              {renderSetting(
                SETTINGS[0],
              )}

              {renderSetting(
                SETTINGS[1],
              )}

              {/* ------------------------------------------------------------ */}
              {/* Privacy                                                      */}
              {/* ------------------------------------------------------------ */}

              <View
                style={[
                  styles.sectionHeader,
                  styles.sectionSpacing,
                ]}
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="shield-checkmark-outline"
                  size={16}
                  color={
                    COLOURS.rust700
                  }
                />

                <Text
                  accessibilityRole="header"
                  style={
                    styles.sectionTitle
                  }
                >
                  POSITION & PRIVACY
                </Text>
              </View>

              {renderSetting(
                SETTINGS[2],
              )}

              <View
                accessible
                accessibilityLabel={`Saved shared position: ${
                  hasSharedLocation
                    ? 'present'
                    : 'none'
                }.`}
                style={
                  styles.statusStrip
                }
              >
                <View
                  accessible={
                    false
                  }
                  importantForAccessibility="no-hide-descendants"
                  style={
                    styles.statusStripIdentity
                  }
                >
                  <Ionicons
                    name={
                      hasSharedLocation
                        ? 'location'
                        : 'location-outline'
                    }
                    size={16}
                    color={
                      hasSharedLocation
                        ? COLOURS.success700
                        : COLOURS.bronze700
                    }
                  />

                  <View
                    style={
                      styles.statusStripTextGroup
                    }
                  >
                    <Text
                      style={
                        styles.statusStripTitle
                      }
                    >
                      SAVED SHARED POSITION
                    </Text>

                    <Text
                      style={
                        styles.statusStripValue
                      }
                    >
                      {hasSharedLocation
                        ? 'POSITION STORED'
                        : 'NO POSITION STORED'}
                    </Text>
                  </View>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Stop location sharing and clear saved position"
                  accessibilityHint="Turns Location Sharing off and removes the stored position from your Firestore profile."
                  accessibilityState={{
                    disabled:
                      isClearingLocation ||
                      (
                        !hasSharedLocation &&
                        !telemetryEnabled
                      ),

                    busy:
                      isClearingLocation,
                  }}
                  disabled={
                    isClearingLocation ||
                    (
                      !hasSharedLocation &&
                      !telemetryEnabled
                    )
                  }
                  onPress={() => {
                    void handleClearSharedLocation();
                  }}
                  style={({
                    pressed,
                  }) => [
                    styles.compactActionButton,

                    (
                      isClearingLocation ||
                      (
                        !hasSharedLocation &&
                        !telemetryEnabled
                      )
                    ) &&
                      styles.disabledButton,

                    pressed &&
                      !isClearingLocation &&
                      styles.lightPressed,
                  ]}
                >
                  {isClearingLocation ? (
                    <ActivityIndicator
                      size="small"
                      color={
                        COLOURS.ink900
                      }
                    />
                  ) : (
                    <>
                      <Ionicons
                        name="trash-bin-outline"
                        size={16}
                        color={
                          COLOURS.ink900
                        }
                      />

                      <Text
                        style={
                          styles.compactActionText
                        }
                      >
                        CLEAR
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>

              <View
                style={
                  styles.informationCard
                }
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="information-circle-outline"
                  size={17}
                  color={
                    COLOURS.bronze700
                  }
                />

                <Text
                  maxFontSizeMultiplier={
                    1.7
                  }
                  style={
                    styles.informationText
                  }
                >
                  Social may calculate nearby range locally even when sharing is off. Your position is only written to your profile when Location Sharing is enabled.
                </Text>
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Power and display                                            */}
              {/* ------------------------------------------------------------ */}

              <View
                style={[
                  styles.sectionHeader,
                  styles.sectionSpacing,
                ]}
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="contrast-outline"
                  size={16}
                  color={
                    COLOURS.rust700
                  }
                />

                <Text
                  accessibilityRole="header"
                  style={
                    styles.sectionTitle
                  }
                >
                  POWER & DISPLAY
                </Text>
              </View>

              {renderSetting(
                SETTINGS[3],
              )}

              {renderSetting(
                SETTINGS[4],
              )}

              <View
                accessible
                accessibilityLabel={`System Reduce Motion is ${
                  reduceMotionEnabled
                    ? 'enabled'
                    : 'disabled'
                }.`}
                style={
                  styles.systemStatusCard
                }
              >
                <View
                  accessible={
                    false
                  }
                  importantForAccessibility="no-hide-descendants"
                  style={
                    styles.settingIdentity
                  }
                >
                  <View
                    style={
                      styles.settingIcon
                    }
                  >
                    <Ionicons
                      name="accessibility-outline"
                      size={18}
                      color={
                        COLOURS.rust700
                      }
                    />
                  </View>

                  <View
                    style={
                      styles.settingTextGroup
                    }
                  >
                    <Text
                      style={
                        styles.settingLabel
                      }
                    >
                      SYSTEM REDUCE MOTION
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.settingDescription
                      }
                    >
                      Treasi reads the operating system preference on supported screens rather than overriding it here.
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.systemBadge,

                    reduceMotionEnabled
                      ? styles.systemBadgeOn
                      : styles.systemBadgeOff,
                  ]}
                >
                  <Text
                    style={
                      styles.systemBadgeText
                    }
                  >
                    {reduceMotionEnabled
                      ? 'ON'
                      : 'OFF'}
                  </Text>
                </View>
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Guidance                                                     */}
              {/* ------------------------------------------------------------ */}

              <View
                style={[
                  styles.sectionHeader,
                  styles.sectionSpacing,
                ]}
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="map-outline"
                  size={16}
                  color={
                    COLOURS.rust700
                  }
                />

                <Text
                  accessibilityRole="header"
                  style={
                    styles.sectionTitle
                  }
                >
                  GUIDANCE & DEVICE
                </Text>
              </View>

              <View
                style={
                  styles.actionGrid
                }
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Review onboarding"
                  accessibilityHint="Opens the Treasi onboarding guide without changing your completion status."
                  onPress={() =>
                    setOnboardingVisible(
                      true,
                    )
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.actionCard,

                    pressed &&
                      styles.lightPressed,
                  ]}
                >
                  <Ionicons
                    name="book-outline"
                    size={21}
                    color={
                      COLOURS.rust700
                    }
                  />

                  <View
                    style={
                      styles.actionCardTextGroup
                    }
                  >
                    <Text
                      style={
                        styles.actionCardTitle
                      }
                    >
                      REVIEW ONBOARDING
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.actionCardDescription
                      }
                    >
                      Revisit Treasi orientation, location and sensor guidance.
                    </Text>
                  </View>

                  <Ionicons
                    name="chevron-forward"
                    size={17}
                    color={
                      COLOURS.bronze700
                    }
                  />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open system settings"
                  accessibilityHint="Opens device settings for Treasi permissions when supported."
                  onPress={() => {
                    void handleOpenSystemSettings();
                  }}
                  style={({
                    pressed,
                  }) => [
                    styles.actionCard,

                    pressed &&
                      styles.lightPressed,
                  ]}
                >
                  <Ionicons
                    name="settings-outline"
                    size={21}
                    color={
                      COLOURS.rust700
                    }
                  />

                  <View
                    style={
                      styles.actionCardTextGroup
                    }
                  >
                    <Text
                      style={
                        styles.actionCardTitle
                      }
                    >
                      SYSTEM PERMISSIONS
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.actionCardDescription
                      }
                    >
                      Manage location and application permissions at operating-system level.
                    </Text>
                  </View>

                  <Ionicons
                    name="open-outline"
                    size={17}
                    color={
                      COLOURS.bronze700
                    }
                  />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Refresh Explorer profile"
                  accessibilityHint="Reloads Firebase Authentication status and the Firestore profile."
                  accessibilityState={{
                    busy:
                      isLoadingProfile,
                  }}
                  onPress={() => {
                    void handleRefreshProfile();
                  }}
                  style={({
                    pressed,
                  }) => [
                    styles.actionCard,

                    pressed &&
                      styles.lightPressed,
                  ]}
                >
                  {isLoadingProfile ? (
                    <ActivityIndicator
                      size="small"
                      color={
                        COLOURS.rust700
                      }
                    />
                  ) : (
                    <Ionicons
                      name="refresh-outline"
                      size={21}
                      color={
                        COLOURS.rust700
                      }
                    />
                  )}

                  <View
                    style={
                      styles.actionCardTextGroup
                    }
                  >
                    <Text
                      style={
                        styles.actionCardTitle
                      }
                    >
                      REFRESH FIELD RECORD
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.actionCardDescription
                      }
                    >
                      Recheck profile data, email verification and account state.
                    </Text>
                  </View>

                  <Ionicons
                    name="chevron-forward"
                    size={17}
                    color={
                      COLOURS.bronze700
                    }
                  />
                </Pressable>
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Security                                                     */}
              {/* ------------------------------------------------------------ */}

              <View
                style={[
                  styles.sectionHeader,
                  styles.sectionSpacing,
                ]}
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="key-outline"
                  size={16}
                  color={
                    COLOURS.rust700
                  }
                />

                <Text
                  accessibilityRole="header"
                  style={
                    styles.sectionTitle
                  }
                >
                  ACCOUNT SECURITY
                </Text>
              </View>

              <View
                style={
                  styles.actionGrid
                }
              >
                {!emailVerified ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send email verification"
                    accessibilityHint="Sends a Firebase verification link to your account email."
                    accessibilityState={{
                      disabled:
                        isSendingVerification,

                      busy:
                        isSendingVerification,
                    }}
                    disabled={
                      isSendingVerification
                    }
                    onPress={() => {
                      void handleSendVerification();
                    }}
                    style={({
                      pressed,
                    }) => [
                      styles.actionCard,

                      isSendingVerification &&
                        styles.disabledButton,

                      pressed &&
                        !isSendingVerification &&
                        styles.lightPressed,
                    ]}
                  >
                    {isSendingVerification ? (
                      <ActivityIndicator
                        size="small"
                        color={
                          COLOURS.rust700
                        }
                      />
                    ) : (
                      <Ionicons
                        name="mail-unread-outline"
                        size={21}
                        color={
                          COLOURS.rust700
                        }
                      />
                    )}

                    <View
                      style={
                        styles.actionCardTextGroup
                      }
                    >
                      <Text
                        style={
                          styles.actionCardTitle
                        }
                      >
                        {verificationSent
                          ? 'VERIFICATION SENT'
                          : 'VERIFY EMAIL'}
                      </Text>

                      <Text
                        maxFontSizeMultiplier={
                          1.7
                        }
                        style={
                          styles.actionCardDescription
                        }
                      >
                        Send a Firebase verification link to {currentEmail}.
                      </Text>
                    </View>

                    <Ionicons
                      name="chevron-forward"
                      size={17}
                      color={
                        COLOURS.bronze700
                      }
                    />
                  </Pressable>
                ) : (
                  <View
                    accessible
                    accessibilityLabel="Account email is verified."
                    style={[
                      styles.actionCard,
                      styles.verifiedCard,
                    ]}
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={21}
                      color={
                        COLOURS.success700
                      }
                    />

                    <View
                      style={
                        styles.actionCardTextGroup
                      }
                    >
                      <Text
                        style={[
                          styles.actionCardTitle,
                          styles.verifiedText,
                        ]}
                      >
                        EMAIL VERIFIED
                      </Text>

                      <Text
                        style={
                          styles.actionCardDescription
                        }
                      >
                        Firebase has verified this account email.
                      </Text>
                    </View>
                  </View>
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send password reset email"
                  accessibilityHint="Sends Firebase password-reset instructions to your account email."
                  accessibilityState={{
                    disabled:
                      isSendingPasswordReset,

                    busy:
                      isSendingPasswordReset,
                  }}
                  disabled={
                    isSendingPasswordReset
                  }
                  onPress={() => {
                    void handlePasswordReset();
                  }}
                  style={({
                    pressed,
                  }) => [
                    styles.actionCard,

                    isSendingPasswordReset &&
                      styles.disabledButton,

                    pressed &&
                      !isSendingPasswordReset &&
                      styles.lightPressed,
                  ]}
                >
                  {isSendingPasswordReset ? (
                    <ActivityIndicator
                      size="small"
                      color={
                        COLOURS.rust700
                      }
                    />
                  ) : (
                    <Ionicons
                      name="key-outline"
                      size={21}
                      color={
                        COLOURS.rust700
                      }
                    />
                  )}

                  <View
                    style={
                      styles.actionCardTextGroup
                    }
                  >
                    <Text
                      style={
                        styles.actionCardTitle
                      }
                    >
                      RESET PASSWORD
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.actionCardDescription
                      }
                    >
                      Email secure Firebase password-reset instructions.
                    </Text>
                  </View>

                  <Ionicons
                    name="chevron-forward"
                    size={17}
                    color={
                      COLOURS.bronze700
                    }
                  />
                </Pressable>
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Reset                                                        */}
              {/* ------------------------------------------------------------ */}

              <View
                style={[
                  styles.sectionHeader,
                  styles.sectionSpacing,
                ]}
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="refresh-circle-outline"
                  size={16}
                  color={
                    COLOURS.rust700
                  }
                />

                <Text
                  accessibilityRole="header"
                  style={
                    styles.sectionTitle
                  }
                >
                  RESTORE
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Restore default Treasi preferences"
                accessibilityHint="Resets saved feedback, motion, battery, display and location-sharing preferences."
                accessibilityState={{
                  disabled:
                    isResettingPreferences,

                  busy:
                    isResettingPreferences,
                }}
                disabled={
                  isResettingPreferences
                }
                onPress={
                  handleResetPreferences
                }
                style={({
                  pressed,
                }) => [
                  styles.resetButton,

                  isResettingPreferences &&
                    styles.disabledButton,

                  pressed &&
                    !isResettingPreferences &&
                    styles.lightPressed,
                ]}
              >
                {isResettingPreferences ? (
                  <ActivityIndicator
                    size="small"
                    color={
                      COLOURS.ink900
                    }
                  />
                ) : (
                  <Ionicons
                    name="refresh-outline"
                    size={18}
                    color={
                      COLOURS.ink900
                    }
                  />
                )}

                <View
                  style={
                    styles.resetButtonTextGroup
                  }
                >
                  <Text
                    style={
                      styles.resetButtonTitle
                    }
                  >
                    RESTORE DEFAULT PREFERENCES
                  </Text>

                  <Text
                    maxFontSizeMultiplier={
                      1.7
                    }
                    style={
                      styles.resetButtonDescription
                    }
                  >
                    Haptics return on; motion sensitivity, battery preference, night preference and location sharing return off.
                  </Text>
                </View>
              </Pressable>

              {/* ------------------------------------------------------------ */}
              {/* Danger zone                                                  */}
              {/* ------------------------------------------------------------ */}

              <View
                style={[
                  styles.sectionHeader,
                  styles.sectionSpacing,
                ]}
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="warning-outline"
                  size={16}
                  color={
                    COLOURS.rust800
                  }
                />

                <Text
                  accessibilityRole="header"
                  style={[
                    styles.sectionTitle,
                    styles.dangerSectionTitle,
                  ]}
                >
                  ACCOUNT CONTROL
                </Text>
              </View>

              <View
                style={
                  styles.dangerZone
                }
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sign out"
                  accessibilityHint="Ends the current Treasi session without deleting account data."
                  accessibilityState={{
                    disabled:
                      isSigningOut,

                    busy:
                      isSigningOut,
                  }}
                  disabled={
                    isSigningOut
                  }
                  onPress={
                    handleSignOut
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.signOutButton,

                    isSigningOut &&
                      styles.disabledButton,

                    pressed &&
                      !isSigningOut &&
                      styles.darkPressed,
                  ]}
                >
                  {isSigningOut ? (
                    <ActivityIndicator
                      size="small"
                      color={
                        COLOURS.parchment100
                      }
                    />
                  ) : (
                    <Ionicons
                      name="log-out-outline"
                      size={18}
                      color={
                        COLOURS.parchment100
                      }
                    />
                  )}

                  <Text
                    style={
                      styles.signOutText
                    }
                  >
                    {isSigningOut
                      ? 'ENDING SESSION...'
                      : 'SIGN OUT'}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete Treasi account"
                  accessibilityHint="Opens the permanent account deletion confirmation."
                  onPress={
                    handleOpenDeleteAccount
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.deleteAccountButton,

                    pressed &&
                      styles.dangerPressed,
                  ]}
                >
                  <Ionicons
                    name="trash-outline"
                    size={18}
                    color={
                      COLOURS.rust800
                    }
                  />

                  <View
                    style={
                      styles.deleteButtonTextGroup
                    }
                  >
                    <Text
                      style={
                        styles.deleteAccountTitle
                      }
                    >
                      DELETE ACCOUNT
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.deleteAccountDescription
                      }
                    >
                      Permanent deletion requires secure Firestore and Firebase Authentication cleanup.
                    </Text>
                  </View>
                </Pressable>
              </View>
            </ScrollView>
          </View>

          {/* ================================================================ */}
          {/* 40% — PROFILE                                                   */}
          {/* ================================================================ */}

          <View
            style={[
              styles.profilePanel,

              isLandscape
                ? styles.profilePanelLandscape
                : styles.panelPortrait,
            ]}
          >
            <ScrollView
              style={
                styles.profileScroll
              }
              contentContainerStyle={
                styles.profileScrollContent
              }
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={
                false
              }
            >
              <View
                style={
                  styles.profileHeader
                }
              >
                <View
                  style={
                    styles.profileHeaderIdentity
                  }
                >
                  <Ionicons
                    accessible={
                      false
                    }
                    importantForAccessibility="no"
                    name="person-circle-outline"
                    size={19}
                    color={
                      COLOURS.bronze400
                    }
                  />

                  <View
                    style={
                      styles.headerTextGroup
                    }
                  >
                    <Text
                      accessibilityRole="header"
                      style={
                        styles.profileTitle
                      }
                    >
                      FIELD IDENTITY
                    </Text>

                    <Text
                      style={
                        styles.profileSubtitle
                      }
                    >
                      EXPLORER ACCOUNT RECORD
                    </Text>
                  </View>
                </View>

                {onBack ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Return to Dashboard"
                    onPress={
                      onBack
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.backButton,

                      pressed &&
                        styles.darkPressed,
                    ]}
                  >
                    <Ionicons
                      name="arrow-back"
                      size={18}
                      color={
                        COLOURS.bronze400
                      }
                    />
                  </Pressable>
                ) : null}
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Identity card                                                */}
              {/* ------------------------------------------------------------ */}

              <View
                style={
                  styles.identityCard
                }
              >
                <View
                  style={
                    styles.identityTopRow
                  }
                >
                  <View
                    accessible={
                      false
                    }
                    importantForAccessibility="no-hide-descendants"
                    style={
                      styles.avatar
                    }
                  >
                    <Ionicons
                      name="person"
                      size={31}
                      color={
                        COLOURS.parchment100
                      }
                    />
                  </View>

                  <View
                    style={
                      styles.identityMain
                    }
                  >
                    {isEditingIdentity ? (
                      <>
                        <Text
                          style={
                            styles.identityInputLabel
                          }
                        >
                          EXPLORER CALLSIGN
                        </Text>

                        <TextInput
                          accessibilityLabel="Explorer callsign"
                          accessibilityHint="Use three to twenty-four letters, numbers, underscores or hyphens."
                          autoCapitalize="characters"
                          autoCorrect={
                            false
                          }
                          editable={
                            !isSavingIdentity
                          }
                          maxLength={
                            MAX_CALLSIGN_LENGTH
                          }
                          placeholder="EXPLORER_CALLSIGN"
                          placeholderTextColor={
                            COLOURS.bronze700
                          }
                          selectionColor={
                            COLOURS.rust700
                          }
                          value={
                            callsign
                          }
                          onChangeText={(
                            value,
                          ) => {
                            setCallsign(
                              value.toUpperCase(),
                            );

                            setCallsignError(
                              null,
                            );
                          }}
                          style={[
                            styles.identityInput,

                            callsignError &&
                              styles.identityInputError,
                          ]}
                        />

                        {callsignError ? (
                          <Text
                            accessibilityRole="alert"
                            accessibilityLiveRegion="assertive"
                            style={
                              styles.callsignErrorText
                            }
                          >
                            {
                              callsignError
                            }
                          </Text>
                        ) : (
                          <Text
                            maxFontSizeMultiplier={
                              1.6
                            }
                            style={
                              styles.identityInputHelp
                            }
                          >
                            3–24 characters · A–Z · 0–9 · _ · -
                          </Text>
                        )}
                      </>
                    ) : (
                      <>
                        <Text
                          numberOfLines={
                            1
                          }
                          style={
                            styles.profileName
                          }
                        >
                          {
                            currentUsername
                          }
                        </Text>

                        <Text
                          numberOfLines={
                            1
                          }
                          style={
                            styles.profileHandle
                          }
                        >
                          {
                            handle
                          }
                        </Text>
                      </>
                    )}

                    <View
                      accessible
                      accessibilityLabel={`Explorer rank ${rank}`}
                      style={
                        styles.rankBadge
                      }
                    >
                      <Ionicons
                        accessible={
                          false
                        }
                        importantForAccessibility="no"
                        name="shield-checkmark"
                        size={13}
                        color={
                          COLOURS.parchment100
                        }
                      />

                      <Text
                        style={
                          styles.rankBadgeText
                        }
                      >
                        {
                          rank
                        }
                      </Text>
                    </View>
                  </View>
                </View>

                {isEditingIdentity ? (
                  <View
                    style={
                      styles.identityEditActions
                    }
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Save Explorer callsign"
                      accessibilityState={{
                        disabled:
                          isSavingIdentity,

                        busy:
                          isSavingIdentity,
                      }}
                      disabled={
                        isSavingIdentity
                      }
                      onPress={() => {
                        void handleSaveIdentity();
                      }}
                      style={({
                        pressed,
                      }) => [
                        styles.identitySaveButton,

                        isSavingIdentity &&
                          styles.disabledButton,

                        pressed &&
                          !isSavingIdentity &&
                          styles.primaryPressed,
                      ]}
                    >
                      {isSavingIdentity ? (
                        <ActivityIndicator
                          size="small"
                          color={
                            COLOURS.parchment100
                          }
                        />
                      ) : (
                        <Ionicons
                          name="checkmark"
                          size={17}
                          color={
                            COLOURS.parchment100
                          }
                        />
                      )}

                      <Text
                        style={
                          styles.identitySaveText
                        }
                      >
                        SAVE
                      </Text>
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Cancel callsign editing"
                      accessibilityState={{
                        disabled:
                          isSavingIdentity,
                      }}
                      disabled={
                        isSavingIdentity
                      }
                      onPress={
                        handleCancelIdentityEdit
                      }
                      style={({
                        pressed,
                      }) => [
                        styles.identityCancelButton,

                        isSavingIdentity &&
                          styles.disabledButton,

                        pressed &&
                          !isSavingIdentity &&
                          styles.lightPressed,
                      ]}
                    >
                      <Text
                        style={
                          styles.identityCancelText
                        }
                      >
                        CANCEL
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Edit Explorer identity"
                    accessibilityHint="Lets you change your Treasi callsign."
                    onPress={
                      handleStartEditingIdentity
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.identityEditButton,

                      pressed &&
                        styles.lightPressed,
                    ]}
                  >
                    <Ionicons
                      name="create-outline"
                      size={16}
                      color={
                        COLOURS.ink900
                      }
                    />

                    <Text
                      style={
                        styles.identityEditText
                      }
                    >
                      EDIT CALLSIGN
                    </Text>
                  </Pressable>
                )}
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Explorer points                                              */}
              {/* ------------------------------------------------------------ */}

              <View
                accessible
                accessibilityLabel={`${totalPoints.toLocaleString(
                  'en-GB',
                )} Explorer points. Rank ${rank}.`}
                style={
                  styles.pointsCard
                }
              >
                <Text
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  style={
                    styles.pointsValue
                  }
                >
                  {totalPoints.toLocaleString(
                    'en-GB',
                  )}
                </Text>

                <Text
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  style={
                    styles.pointsLabel
                  }
                >
                  EXPLORER POINTS
                </Text>
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Account record                                               */}
              {/* ------------------------------------------------------------ */}

              <View
                style={
                  styles.profileSectionHeader
                }
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="document-text-outline"
                  size={15}
                  color={
                    COLOURS.bronze400
                  }
                />

                <Text
                  accessibilityRole="header"
                  style={
                    styles.profileSectionTitle
                  }
                >
                  ACCOUNT RECORD
                </Text>
              </View>

              <View
                style={
                  styles.recordCard
                }
              >
                <View
                  style={
                    styles.recordRow
                  }
                >
                  <Text
                    style={
                      styles.recordKey
                    }
                  >
                    MEMBER SINCE
                  </Text>

                  <Text
                    style={
                      styles.recordValue
                    }
                  >
                    {
                      memberSince
                    }
                  </Text>
                </View>

                <View
                  style={
                    styles.recordRow
                  }
                >
                  <Text
                    style={
                      styles.recordKey
                    }
                  >
                    AUTH STATUS
                  </Text>

                  <Text
                    style={[
                      styles.recordValue,

                      styles.recordValueSuccess,
                    ]}
                  >
                    ACTIVE
                  </Text>
                </View>

                <View
                  style={
                    styles.recordRow
                  }
                >
                  <Text
                    style={
                      styles.recordKey
                    }
                  >
                    EMAIL
                  </Text>

                  <Text
                    numberOfLines={
                      1
                    }
                    ellipsizeMode="middle"
                    style={
                      styles.recordValue
                    }
                  >
                    {
                      currentEmail
                    }
                  </Text>
                </View>

                <View
                  style={
                    styles.recordRow
                  }
                >
                  <Text
                    style={
                      styles.recordKey
                    }
                  >
                    EMAIL VERIFIED
                  </Text>

                  <Text
                    style={[
                      styles.recordValue,

                      emailVerified
                        ? styles.recordValueSuccess
                        : styles.recordValueWarning,
                    ]}
                  >
                    {emailVerified
                      ? 'YES'
                      : 'NO'}
                  </Text>
                </View>

                <View
                  style={
                    styles.recordRow
                  }
                >
                  <Text
                    style={
                      styles.recordKey
                    }
                  >
                    ONBOARDING
                  </Text>

                  <Text
                    style={[
                      styles.recordValue,

                      onboardingComplete
                        ? styles.recordValueSuccess
                        : styles.recordValueWarning,
                    ]}
                  >
                    {onboardingComplete
                      ? 'COMPLETE'
                      : 'PENDING'}
                  </Text>
                </View>

                <View
                  style={
                    styles.recordRow
                  }
                >
                  <Text
                    style={
                      styles.recordKey
                    }
                  >
                    LOCATION SHARE
                  </Text>

                  <Text
                    style={[
                      styles.recordValue,

                      telemetryEnabled
                        ? styles.recordValueSuccess
                        : styles.recordValueMuted,
                    ]}
                  >
                    {telemetryEnabled
                      ? 'ON'
                      : 'OFF'}
                  </Text>
                </View>

                <View
                  style={[
                    styles.recordRow,
                    styles.recordRowLast,
                  ]}
                >
                  <Text
                    style={
                      styles.recordKey
                    }
                  >
                    FIREBASE UID
                  </Text>

                  <Text
                    numberOfLines={
                      1
                    }
                    ellipsizeMode="middle"
                    style={
                      styles.recordValue
                    }
                  >
                    {currentUid ||
                      'N/A'}
                  </Text>
                </View>
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Field status                                                 */}
              {/* ------------------------------------------------------------ */}

              <View
                style={
                  styles.profileSectionHeader
                }
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="checkmark-done-circle-outline"
                  size={15}
                  color={
                    COLOURS.bronze400
                  }
                />

                <Text
                  accessibilityRole="header"
                  style={
                    styles.profileSectionTitle
                  }
                >
                  FIELD STATUS
                </Text>
              </View>

              <View
                style={
                  styles.statusGrid
                }
              >
                <View
                  accessible
                  accessibilityLabel={`Haptic feedback ${
                    hapticFeedbackEnabled
                      ? 'enabled'
                      : 'disabled'
                  }`}
                  style={
                    styles.profileStatusCard
                  }
                >
                  <Ionicons
                    name="phone-portrait-outline"
                    size={18}
                    color={
                      hapticFeedbackEnabled
                        ? COLOURS.success300
                        : COLOURS.bronze400
                    }
                  />

                  <Text
                    style={
                      styles.profileStatusLabel
                    }
                  >
                    HAPTICS
                  </Text>

                  <Text
                    style={
                      styles.profileStatusValue
                    }
                  >
                    {hapticFeedbackEnabled
                      ? 'ON'
                      : 'OFF'}
                  </Text>
                </View>

                <View
                  accessible
                  accessibilityLabel={`Motion sensitivity ${
                    motionSensitivityEnabled
                      ? 'sensitive'
                      : 'standard'
                  }`}
                  style={
                    styles.profileStatusCard
                  }
                >
                  <Ionicons
                    name="pulse-outline"
                    size={18}
                    color={
                      COLOURS.bronze400
                    }
                  />

                  <Text
                    style={
                      styles.profileStatusLabel
                    }
                  >
                    MOTION
                  </Text>

                  <Text
                    style={
                      styles.profileStatusValue
                    }
                  >
                    {motionSensitivityEnabled
                      ? 'SENSITIVE'
                      : 'STANDARD'}
                  </Text>
                </View>
              </View>

              <View
                style={
                  styles.profileNote
                }
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="information-circle-outline"
                  size={16}
                  color={
                    COLOURS.bronze400
                  }
                />

                <Text
                  maxFontSizeMultiplier={
                    1.7
                  }
                  style={
                    styles.profileNoteText
                  }
                >
                  Treasi only claims settings that are actually stored in the current profile schema. Unsupported preferences are not presented as fake working controls.
                </Text>
              </View>
            </ScrollView>

            <FieldNavBar
              currentTab={
                currentTab
              }
              onNavigate={(
                tab,
              ) =>
                onNavigate?.(
                  tab,
                )
              }
            />
          </View>
        </View>

        {/* ================================================================== */}
        {/* Onboarding review                                                  */}
        {/* ================================================================== */}

        <Modal
          visible={
            onboardingVisible
          }
          animationType={
            reduceMotionEnabled
              ? 'none'
              : 'fade'
          }
          presentationStyle="fullScreen"
          onRequestClose={() =>
            setOnboardingVisible(
              false,
            )
          }
        >
          <View
            style={
              styles.onboardingModal
            }
          >
            <OnboardingScreen
              onComplete={() => {
                setOnboardingVisible(
                  false,
                );

                announce(
                  'Onboarding review closed.',
                );
              }}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close onboarding review"
              accessibilityHint="Returns to Profile Settings without changing your onboarding status."
              onPress={() =>
                setOnboardingVisible(
                  false,
                )
              }
              style={({
                pressed,
              }) => [
                styles.onboardingCloseButton,

                {
                  top:
                    Math.max(
                      insets.top,
                      12,
                    ),

                  right:
                    Math.max(
                      insets.right,
                      12,
                    ),
                },

                pressed &&
                  styles.darkPressed,
              ]}
            >
              <Ionicons
                name="close"
                size={22}
                color={
                  COLOURS.parchment100
                }
              />

              <Text
                style={
                  styles.onboardingCloseText
                }
              >
                CLOSE
              </Text>
            </Pressable>
          </View>
        </Modal>

        {/* ================================================================== */}
        {/* Delete account confirmation                                        */}
        {/* ================================================================== */}

        <Modal
          visible={
            deleteModalVisible
          }
          transparent
          statusBarTranslucent
          animationType={
            reduceMotionEnabled
              ? 'none'
              : 'fade'
          }
          onRequestClose={() => {
            if (
              !isDeletingAccount
            ) {
              setDeleteModalVisible(
                false,
              );
            }
          }}
        >
          <KeyboardAvoidingView
            style={
              styles.deleteModalOverlay
            }
            behavior={
              Platform.OS ===
              'ios'
                ? 'padding'
                : undefined
            }
          >
            <View
              accessible
              accessibilityViewIsModal
              accessibilityLabel="Delete Treasi account confirmation"
              onAccessibilityEscape={() => {
                if (
                  !isDeletingAccount
                ) {
                  setDeleteModalVisible(
                    false,
                  );
                }
              }}
              style={
                styles.deleteModalCard
              }
            >
              <View
                style={
                  styles.deleteModalIcon
                }
              >
                <Ionicons
                  name="warning-outline"
                  size={30}
                  color={
                    COLOURS.danger300
                  }
                />
              </View>

              <Text
                accessibilityRole="header"
                style={
                  styles.deleteModalTitle
                }
              >
                PERMANENT ACCOUNT DELETION
              </Text>

              <Text
                maxFontSizeMultiplier={
                  1.8
                }
                style={
                  styles.deleteModalDescription
                }
              >
                Account deletion must remove Firebase Authentication and personal Firestore account data together. Treasi will not delete only your login and leave the profile behind.
              </Text>

              {!onDeleteAccount ? (
                <View
                  accessible
                  accessibilityRole="alert"
                  style={
                    styles.deleteUnavailableCard
                  }
                >
                  <Ionicons
                    name="lock-closed-outline"
                    size={18}
                    color={
                      COLOURS.warning300
                    }
                  />

                  <Text
                    maxFontSizeMultiplier={
                      1.7
                    }
                    style={
                      styles.deleteUnavailableText
                    }
                  >
                    SECURE DELETION IS NOT YET CONFIGURED. THE CURRENT FIRESTORE RULES BLOCK CLIENT DELETION OF USER PROFILE RECORDS, SO NO PARTIAL DELETION WILL BE ATTEMPTED.
                  </Text>
                </View>
              ) : (
                <>
                  <Text
                    style={
                      styles.deleteConfirmationLabel
                    }
                  >
                    TYPE DELETE TO CONFIRM
                  </Text>

                  <TextInput
                    accessibilityLabel="Delete account confirmation"
                    accessibilityHint="Type the word DELETE to enable permanent account deletion."
                    autoCapitalize="characters"
                    autoCorrect={
                      false
                    }
                    editable={
                      !isDeletingAccount
                    }
                    maxLength={6}
                    placeholder="DELETE"
                    placeholderTextColor={
                      COLOURS.bronze700
                    }
                    selectionColor={
                      COLOURS.danger300
                    }
                    value={
                      deleteConfirmation
                    }
                    onChangeText={(
                      value,
                    ) =>
                      setDeleteConfirmation(
                        value.toUpperCase(),
                      )
                    }
                    style={
                      styles.deleteConfirmationInput
                    }
                  />
                </>
              )}

              <View
                style={
                  styles.deleteModalActions
                }
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel account deletion"
                  accessibilityState={{
                    disabled:
                      isDeletingAccount,
                  }}
                  disabled={
                    isDeletingAccount
                  }
                  onPress={() => {
                    setDeleteModalVisible(
                      false,
                    );

                    setDeleteConfirmation(
                      '',
                    );
                  }}
                  style={({
                    pressed,
                  }) => [
                    styles.deleteCancelButton,

                    isDeletingAccount &&
                      styles.disabledButton,

                    pressed &&
                      !isDeletingAccount &&
                      styles.lightPressed,
                  ]}
                >
                  <Text
                    style={
                      styles.deleteCancelText
                    }
                  >
                    CANCEL
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    onDeleteAccount
                      ? 'Permanently delete account'
                      : 'Secure account deletion unavailable'
                  }
                  accessibilityState={{
                    disabled:
                      !onDeleteAccount ||
                      deleteConfirmation
                        .trim()
                        .toUpperCase() !==
                        'DELETE' ||
                      isDeletingAccount,

                    busy:
                      isDeletingAccount,
                  }}
                  disabled={
                    !onDeleteAccount ||
                    deleteConfirmation
                      .trim()
                      .toUpperCase() !==
                      'DELETE' ||
                    isDeletingAccount
                  }
                  onPress={() => {
                    void handleConfirmDeleteAccount();
                  }}
                  style={({
                    pressed,
                  }) => [
                    styles.deleteConfirmButton,

                    (
                      !onDeleteAccount ||
                      deleteConfirmation
                        .trim()
                        .toUpperCase() !==
                        'DELETE' ||
                      isDeletingAccount
                    ) &&
                      styles.disabledButton,

                    pressed &&
                      Boolean(
                        onDeleteAccount,
                      ) &&
                      !isDeletingAccount &&
                      styles.dangerPressed,
                  ]}
                >
                  {isDeletingAccount ? (
                    <ActivityIndicator
                      size="small"
                      color={
                        COLOURS.parchment100
                      }
                    />
                  ) : (
                    <Ionicons
                      name="trash-outline"
                      size={17}
                      color={
                        COLOURS.parchment100
                      }
                    />
                  )}

                  <Text
                    style={
                      styles.deleteConfirmText
                    }
                  >
                    {onDeleteAccount
                      ? 'DELETE ACCOUNT'
                      : 'UNAVAILABLE'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </KeyboardAvoidingView>
    );
  };

export default ProfileSettingsScreen;

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor:
        COLOURS.forest800,
    },

    centeredState: {
      justifyContent:
        'center',
      alignItems:
        'center',
      paddingHorizontal: 24,
    },

    loadingText: {
      marginTop: 10,
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '800',
      letterSpacing: 0.8,
      textAlign: 'center',
    },

    standaloneBackButton: {
      minHeight: 48,
      marginTop: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 6,
      paddingHorizontal: 18,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze400,
      borderRadius: 5,
    },

    standaloneBackText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      fontWeight: '800',
    },

    splitWrapper: {
      flex: 1,
      minHeight: 0,
      gap: 12,
    },

    panelPortrait: {
      width: '100%',
    },

    headerIdentity: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },

    headerTextGroup: {
      flex: 1,
      minWidth: 0,
    },

    disabledButton: {
      opacity: 0.45,
    },

    /* ---------------------------------------------------------------------- */
    /* 60% Settings panel                                                    */
    /* ---------------------------------------------------------------------- */

    settingsPanel: {
      minWidth: 0,
      minHeight: 0,
      padding: 14,
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 7,
    },

    settingsPanelLandscape: {
      flex: 0.6,
    },

    settingsHeader: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 10,
      paddingBottom: 9,
      borderBottomWidth: 1,
      borderBottomColor:
        COLOURS.bronze600,
    },

    settingsTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '800',
      letterSpacing: 1.1,
    },

    settingsSubtitle: {
      marginTop: 2,
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '700',
      letterSpacing: 0.55,
    },

    settingsScroll: {
      flex: 1,
      minHeight: 0,
    },

    settingsScrollContent: {
      paddingTop: 8,
      paddingBottom: 18,
    },

    profileErrorCard: {
      minHeight: 52,
      marginTop: 8,
      paddingHorizontal: 9,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor:
        '#F1D3C9',
      borderWidth: 1,
      borderColor:
        COLOURS.rust700,
      borderRadius: 5,
    },

    profileErrorText: {
      flex: 1,
      minWidth: 0,
      color:
        COLOURS.rust800,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 14,
      fontWeight: '700',
    },

    errorRetryButton: {
      minWidth: 64,
      minHeight: 48,
      justifyContent:
        'center',
      alignItems:
        'center',
      borderWidth: 1,
      borderColor:
        COLOURS.rust700,
      borderRadius: 4,
    },

    errorRetryText: {
      color:
        COLOURS.rust800,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '800',
    },

    sectionHeader: {
      minHeight: 28,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    },

    sectionSpacing: {
      marginTop: 15,
    },

    sectionTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10.5,
      lineHeight: 16,
      fontWeight: '800',
      letterSpacing: 0.7,
    },

    dangerSectionTitle: {
      color:
        COLOURS.rust800,
    },

    /* ---------------------------------------------------------------------- */
    /* Toggle settings                                                       */
    /* ---------------------------------------------------------------------- */

    settingCard: {
      minHeight: 68,
      marginBottom: 7,
      paddingHorizontal: 10,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 9,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    systemStatusCard: {
      minHeight: 68,
      marginBottom: 7,
      paddingHorizontal: 10,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 9,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    settingIdentity: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },

    settingIcon: {
      width: 38,
      height: 38,
      flexShrink: 0,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        '#E3D5B8',
      borderRadius: 19,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
    },

    settingTextGroup: {
      flex: 1,
      minWidth: 0,
    },

    settingLabel: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight: '800',
      letterSpacing: 0.4,
    },

    settingDescription: {
      marginTop: 2,
      color:
        COLOURS.ink700,
      fontSize: 9.5,
      lineHeight: 14,
    },

    settingControl: {
      width: 52,
      minHeight: 48,
      flexShrink: 0,
      justifyContent:
        'center',
      alignItems:
        'center',
    },

    systemBadge: {
      minWidth: 52,
      minHeight: 34,
      justifyContent:
        'center',
      alignItems:
        'center',
      paddingHorizontal: 8,
      borderRadius: 4,
    },

    systemBadgeOn: {
      backgroundColor:
        '#DCE8D8',
      borderWidth: 1,
      borderColor:
        COLOURS.success700,
    },

    systemBadgeOff: {
      backgroundColor:
        '#DED4BF',
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
    },

    systemBadgeText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight: '800',
    },

    /* ---------------------------------------------------------------------- */
    /* Privacy status                                                        */
    /* ---------------------------------------------------------------------- */

    statusStrip: {
      minHeight: 62,
      marginTop: 1,
      padding: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 8,
      backgroundColor:
        '#E4D6B9',
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    statusStripIdentity: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },

    statusStripTextGroup: {
      flex: 1,
      minWidth: 0,
    },

    statusStripTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight: '800',
    },

    statusStripValue: {
      marginTop: 1,
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight: '700',
    },

    compactActionButton: {
      minWidth: 76,
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 4,
      paddingHorizontal: 8,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 4,
    },

    compactActionText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight: '800',
    },

    informationCard: {
      marginTop: 7,
      padding: 9,
      flexDirection: 'row',
      alignItems:
        'flex-start',
      gap: 7,
      backgroundColor:
        '#E3D5B8',
      borderWidth: 1,
      borderColor:
        '#C2AD82',
      borderRadius: 5,
    },

    informationText: {
      flex: 1,
      minWidth: 0,
      color:
        COLOURS.ink700,
      fontSize: 9.5,
      lineHeight: 14,
    },

    /* ---------------------------------------------------------------------- */
    /* Action cards                                                          */
    /* ---------------------------------------------------------------------- */

    actionGrid: {
      gap: 7,
    },

    actionCard: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    actionCardTextGroup: {
      flex: 1,
      minWidth: 0,
    },

    actionCardTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight: '800',
      letterSpacing: 0.35,
    },

    actionCardDescription: {
      marginTop: 2,
      color:
        COLOURS.ink700,
      fontSize: 9,
      lineHeight: 14,
    },

    verifiedCard: {
      borderColor:
        COLOURS.success700,
      backgroundColor:
        '#E2E9D9',
    },

    verifiedText: {
      color:
        COLOURS.success700,
    },

    /* ---------------------------------------------------------------------- */
    /* Reset                                                                 */
    /* ---------------------------------------------------------------------- */

    resetButton: {
      minHeight: 68,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor:
        '#E2D2B1',
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    resetButtonTextGroup: {
      flex: 1,
      minWidth: 0,
    },

    resetButtonTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight: '800',
    },

    resetButtonDescription: {
      marginTop: 2,
      color:
        COLOURS.ink700,
      fontSize: 9,
      lineHeight: 14,
    },

    /* ---------------------------------------------------------------------- */
    /* Danger zone                                                           */
    /* ---------------------------------------------------------------------- */

    dangerZone: {
      padding: 9,
      backgroundColor:
        '#E2CBBE',
      borderWidth: 1,
      borderColor:
        COLOURS.rust700,
      borderRadius: 5,
      gap: 7,
    },

    signOutButton: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 7,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor:
        COLOURS.forest800,
      borderWidth: 1,
      borderColor:
        COLOURS.forest950,
      borderRadius: 5,
    },

    signOutText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight: '800',
      letterSpacing: 0.5,
    },

    deleteAccountButton: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor:
        '#F0D4CA',
      borderWidth: 1,
      borderColor:
        COLOURS.rust700,
      borderRadius: 5,
    },

    deleteButtonTextGroup: {
      flex: 1,
      minWidth: 0,
    },

    deleteAccountTitle: {
      color:
        COLOURS.rust800,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight: '800',
    },

    deleteAccountDescription: {
      marginTop: 2,
      color:
        COLOURS.ink700,
      fontSize: 9,
      lineHeight: 14,
    },

    /* ---------------------------------------------------------------------- */
    /* 40% profile panel                                                     */
    /* ---------------------------------------------------------------------- */

    profilePanel: {
      minWidth: 0,
      minHeight: 0,
      padding: 12,
      backgroundColor:
        COLOURS.forest800,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze500,
      borderRadius: 7,
    },

    profilePanelLandscape: {
      flex: 0.4,
    },

    profileScroll: {
      flex: 1,
      minHeight: 0,
      marginBottom: 8,
    },

    profileScrollContent: {
      paddingBottom: 8,
    },

    profileHeader: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 8,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor:
        COLOURS.bronze500,
    },

    profileHeaderIdentity: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },

    profileTitle: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '800',
      letterSpacing: 0.75,
    },

    profileSubtitle: {
      marginTop: 1,
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 7.5,
      lineHeight: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
    },

    backButton: {
      width: 48,
      height: 48,
      flexShrink: 0,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze500,
      borderRadius: 24,
    },

    /* ---------------------------------------------------------------------- */
    /* Identity                                                              */
    /* ---------------------------------------------------------------------- */

    identityCard: {
      marginTop: 10,
      padding: 11,
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 6,
    },

    identityTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },

    avatar: {
      width: 54,
      height: 54,
      flexShrink: 0,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        COLOURS.forest800,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 27,
    },

    identityMain: {
      flex: 1,
      minWidth: 0,
    },

    profileName: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '800',
      letterSpacing: 0.45,
    },

    profileHandle: {
      marginTop: 1,
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_FONT,
      fontSize: 9,
      lineHeight: 13,
    },

    rankBadge: {
      alignSelf:
        'flex-start',
      minHeight: 26,
      marginTop: 5,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 7,
      paddingVertical: 4,
      backgroundColor:
        COLOURS.rust700,
      borderRadius: 13,
    },

    rankBadgeText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 7.5,
      lineHeight: 11,
      fontWeight: '800',
      letterSpacing: 0.35,
    },

    identityInputLabel: {
      marginBottom: 4,
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '800',
    },

    identityInput: {
      minHeight: 48,
      paddingHorizontal: 9,
      paddingVertical: 8,
      color:
        COLOURS.ink900,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1.5,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
      fontFamily:
        MONO_FONT,
      fontSize: 12,
      lineHeight: 18,
    },

    identityInputError: {
      borderWidth: 2,
      borderColor:
        COLOURS.rust700,
    },

    identityInputHelp: {
      marginTop: 3,
      color:
        COLOURS.bronze700,
      fontSize: 8,
      lineHeight: 12,
    },

    callsignErrorText: {
      marginTop: 3,
      color:
        COLOURS.rust800,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight: '700',
    },

    identityEditButton: {
      minHeight: 48,
      marginTop: 9,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 6,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor:
        COLOURS.ink900,
      borderRadius: 5,
    },

    identityEditText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '800',
      letterSpacing: 0.35,
    },

    identityEditActions: {
      marginTop: 9,
      flexDirection: 'row',
      gap: 7,
    },

    identitySaveButton: {
      flex: 1,
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 5,
      backgroundColor:
        COLOURS.rust700,
      borderRadius: 5,
    },

    identitySaveText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      fontWeight: '800',
    },

    identityCancelButton: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent:
        'center',
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    identityCancelText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      fontWeight: '800',
    },

    /* ---------------------------------------------------------------------- */
    /* Points                                                                */
    /* ---------------------------------------------------------------------- */

    pointsCard: {
      marginTop: 8,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent:
        'center',
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze500,
      borderRadius: 5,
    },

    pointsValue: {
      color:
        COLOURS.success300,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 26,
      lineHeight: 31,
      fontWeight: '900',
    },

    pointsLabel: {
      marginTop: 1,
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight: '800',
      letterSpacing: 0.6,
    },

    /* ---------------------------------------------------------------------- */
    /* Profile record                                                        */
    /* ---------------------------------------------------------------------- */

    profileSectionHeader: {
      minHeight: 27,
      marginTop: 13,
      marginBottom: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },

    profileSectionTitle: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight: '800',
      letterSpacing: 0.55,
    },

    recordCard: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.forest700,
      borderRadius: 5,
    },

    recordRow: {
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 8,
      paddingVertical: 5,
      borderBottomWidth: 1,
      borderBottomColor:
        COLOURS.forest700,
    },

    recordRowLast: {
      borderBottomWidth: 0,
    },

    recordKey: {
      flexShrink: 0,
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight: '800',
      letterSpacing: 0.3,
    },

    recordValue: {
      flex: 1,
      minWidth: 0,
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      textAlign: 'right',
    },

    recordValueSuccess: {
      color:
        COLOURS.success300,
      fontFamily:
        MONO_BOLD_FONT,
      fontWeight: '800',
    },

    recordValueWarning: {
      color:
        COLOURS.warning300,
      fontFamily:
        MONO_BOLD_FONT,
      fontWeight: '800',
    },

    recordValueMuted: {
      color:
        COLOURS.bronze400,
    },

    /* ---------------------------------------------------------------------- */
    /* Status cards                                                          */
    /* ---------------------------------------------------------------------- */

    statusGrid: {
      flexDirection: 'row',
      gap: 7,
    },

    profileStatusCard: {
      flex: 1,
      minHeight: 72,
      justifyContent:
        'center',
      alignItems:
        'center',
      gap: 3,
      padding: 7,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.forest700,
      borderRadius: 5,
    },

    profileStatusLabel: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 7.5,
      lineHeight: 11,
      fontWeight: '800',
    },

    profileStatusValue: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '800',
    },

    profileNote: {
      marginTop: 9,
      padding: 8,
      flexDirection: 'row',
      alignItems:
        'flex-start',
      gap: 6,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.forest700,
      borderRadius: 5,
    },

    profileNoteText: {
      flex: 1,
      minWidth: 0,
      color:
        COLOURS.bronze400,
      fontSize: 8.5,
      lineHeight: 13,
    },

    /* ---------------------------------------------------------------------- */
    /* Onboarding modal                                                      */
    /* ---------------------------------------------------------------------- */

    onboardingModal: {
      flex: 1,
      backgroundColor:
        COLOURS.forest950,
    },

    onboardingCloseButton: {
      position: 'absolute',
      zIndex: 100,
      minWidth: 92,
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 5,
      paddingHorizontal: 10,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze400,
      borderRadius: 5,
    },

    onboardingCloseText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '800',
    },

    /* ---------------------------------------------------------------------- */
    /* Delete modal                                                          */
    /* ---------------------------------------------------------------------- */

    deleteModalOverlay: {
      flex: 1,
      justifyContent:
        'center',
      alignItems:
        'center',
      padding: 20,
      backgroundColor:
        COLOURS.overlay,
    },

    deleteModalCard: {
      width: '92%',
      maxWidth: 580,
      padding: 18,
      backgroundColor:
        COLOURS.forest800,
      borderWidth: 2,
      borderColor:
        COLOURS.rust700,
      borderRadius: 8,
    },

    deleteModalIcon: {
      width: 58,
      height: 58,
      alignSelf: 'center',
      justifyContent:
        'center',
      alignItems:
        'center',
      marginBottom: 10,
      backgroundColor:
        COLOURS.rust800,
      borderRadius: 29,
    },

    deleteModalTitle: {
      color:
        COLOURS.danger300,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '800',
      letterSpacing: 0.8,
      textAlign: 'center',
    },

    deleteModalDescription: {
      marginTop: 8,
      color:
        COLOURS.parchment100,
      fontSize: 10.5,
      lineHeight: 17,
      textAlign: 'center',
    },

    deleteUnavailableCard: {
      marginTop: 12,
      padding: 10,
      flexDirection: 'row',
      alignItems:
        'flex-start',
      gap: 8,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.warning300,
      borderRadius: 5,
    },

    deleteUnavailableText: {
      flex: 1,
      minWidth: 0,
      color:
        COLOURS.warning300,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '700',
    },

    deleteConfirmationLabel: {
      marginTop: 14,
      marginBottom: 5,
      color:
        COLOURS.danger300,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight: '800',
      letterSpacing: 0.5,
    },

    deleteConfirmationInput: {
      minHeight: 50,
      paddingHorizontal: 10,
      paddingVertical: 9,
      color:
        COLOURS.parchment100,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1.5,
      borderColor:
        COLOURS.rust700,
      borderRadius: 5,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 13,
      lineHeight: 19,
      letterSpacing: 1,
      textAlign: 'center',
    },

    deleteModalActions: {
      marginTop: 14,
      flexDirection: 'row',
      gap: 8,
    },

    deleteCancelButton: {
      flex: 1,
      minHeight: 50,
      justifyContent:
        'center',
      alignItems:
        'center',
      borderWidth: 1,
      borderColor:
        COLOURS.bronze400,
      borderRadius: 5,
    },

    deleteCancelText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      fontWeight: '800',
    },

    deleteConfirmButton: {
      flex: 1.2,
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 6,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.danger300,
      borderRadius: 5,
    },

    deleteConfirmText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight: '800',
    },

    /* ---------------------------------------------------------------------- */
    /* Press states                                                          */
    /* ---------------------------------------------------------------------- */

    lightPressed: {
      opacity: 0.7,
    },

    darkPressed: {
      opacity: 0.76,
    },

    primaryPressed: {
      opacity: 0.82,
      backgroundColor:
        COLOURS.rust600,
    },

    dangerPressed: {
      opacity: 0.74,
    },
  });
