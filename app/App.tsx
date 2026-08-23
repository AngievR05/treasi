import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';

import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

import {
  onAuthStateChanged,
  signOut,
  type User,
} from 'firebase/auth';

import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';

import {
  auth,
  db,
} from './src/config/firebase';

/* -------------------------------------------------------------------------- */
/* Screens                                                                    */
/* -------------------------------------------------------------------------- */

import { SplashScreen } from './src/screens/SplashScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';

import LoginScreen from './src/screens/Auth/LoginScreen';
import { SignUpScreen } from './src/screens/Auth/SignUpScreen';

import { DashboardScreen } from './src/screens/DashboardScreen';
import { HuntScreen } from './src/screens/HuntScreen';
import { LeaderboardScreen } from './src/screens/LeaderboardScreen';
import { SocialScreen } from './src/screens/SocialScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { ProfileSettingsScreen } from './src/screens/ProfileSettingsScreen';

/* -------------------------------------------------------------------------- */
/* Navigation types                                                           */
/* -------------------------------------------------------------------------- */

export type ScreenState =
  | 'SPLASH'
  | 'ONBOARDING'
  | 'LOGIN'
  | 'SIGNUP'
  | 'DASHBOARD'
  | 'HUNT'
  | 'LEADERBOARD'
  | 'SOCIAL'
  | 'INVENTORY'
  | 'PROFILE';

export interface NavigationParams {
  treasureId?: string;
  mode?: 'hunt' | 'create';
  latitude?: number;
  longitude?: number;
  [key: string]: unknown;
}

interface Coordinates {
  latitude: number;
  longitude: number;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

// Final onboarding storage key used by Treasi.
const ONBOARDING_STORAGE_KEY =
  '@treasi_onboarding_completed';

// Earlier builds used this key; it is migrated and removed automatically.
const LEGACY_ONBOARDING_STORAGE_KEY =
  '@treasi_device_onboarding_complete';

const PROTECTED_SCREENS =
  new Set<ScreenState>([
    'DASHBOARD',
    'HUNT',
    'LEADERBOARD',
    'SOCIAL',
    'INVENTORY',
    'PROFILE',
  ]);

/* -------------------------------------------------------------------------- */
/* Development logging                                                        */
/* -------------------------------------------------------------------------- */

// Keeps development diagnostics out of production console output.
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

/* -------------------------------------------------------------------------- */
/* Onboarding persistence                                                     */
/* -------------------------------------------------------------------------- */

// Stores onboarding completion under the final canonical key.
const persistLocalOnboardingCompletion =
  async (): Promise<void> => {
    try {
      await AsyncStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        'true',
      );

      // Remove the obsolete development key.
      await AsyncStorage.removeItem(
        LEGACY_ONBOARDING_STORAGE_KEY,
      );
    } catch (error: unknown) {
      logDevelopmentWarning(
        '[Treasi] Unable to persist local onboarding state:',
        error,
      );
    }
  };

// Reads and migrates onboarding state from earlier app builds.
const readLocalOnboardingState =
  async (): Promise<boolean> => {
    try {
      const values =
        await AsyncStorage.multiGet([
          ONBOARDING_STORAGE_KEY,
          LEGACY_ONBOARDING_STORAGE_KEY,
        ]);

      const onboardingComplete =
        values.some(
          ([, value]) =>
            value === 'true',
        );

      if (onboardingComplete) {
        await persistLocalOnboardingCompletion();
      }

      return onboardingComplete;
    } catch (error: unknown) {
      logDevelopmentWarning(
        '[Treasi] Unable to read local onboarding state:',
        error,
      );

      return false;
    }
  };

// Combines local and Firestore onboarding state.
const resolveOnboardingState =
  async (
    user: User | null,
  ): Promise<boolean> => {
    const localOnboardingComplete =
      await readLocalOnboardingState();

    if (!user) {
      return localOnboardingComplete;
    }

    try {
      const userDocumentRef =
        doc(
          db,
          'users',
          user.uid,
        );

      const userSnapshot =
        await getDoc(
          userDocumentRef,
        );

      /*
       * Firebase Authentication can become active slightly before
       * SignUpScreen finishes creating the Firestore profile.
       */
      if (!userSnapshot.exists()) {
        return localOnboardingComplete;
      }

      const data =
        userSnapshot.data();

      const remoteOnboardingComplete =
        data.hasCompletedOnboarding ===
        true;

      if (remoteOnboardingComplete) {
        /*
         * Keep the device state synchronised with an account that has
         * already completed onboarding.
         */
        if (
          !localOnboardingComplete
        ) {
          await persistLocalOnboardingCompletion();
        }

        return true;
      }

      /*
       * Older accounts could have completed onboarding locally before
       * their Firestore profile stored the new field.
       */
      if (localOnboardingComplete) {
        try {
          await updateDoc(
            userDocumentRef,
            {
              hasCompletedOnboarding:
                true,

              updatedAt:
                serverTimestamp(),
            },
          );
        } catch (
          error: unknown
        ) {
          /*
           * A network problem should not force an already-onboarded
           * user back through the onboarding flow.
           */
          logDevelopmentWarning(
            '[Treasi] Unable to synchronise onboarding state to Firestore:',
            error,
          );
        }

        return true;
      }

      return false;
    } catch (error: unknown) {
      logDevelopmentWarning(
        '[Treasi] Unable to resolve Firestore onboarding state:',
        error,
      );

      /*
       * Local state provides a safe fallback when Firestore is
       * temporarily unavailable.
       */
      return localOnboardingComplete;
    }
  };

// Persists onboarding after the final onboarding step.
const markCurrentUserOnboardingComplete =
  async (): Promise<void> => {
    await persistLocalOnboardingCompletion();

    const user =
      auth.currentUser;

    if (!user) {
      return;
    }

    try {
      const userDocumentRef =
        doc(
          db,
          'users',
          user.uid,
        );

      const userSnapshot =
        await getDoc(
          userDocumentRef,
        );

      /*
       * A user document may not exist yet when onboarding occurs
       * before registration.
       */
      if (!userSnapshot.exists()) {
        return;
      }

      await updateDoc(
        userDocumentRef,
        {
          hasCompletedOnboarding:
            true,

          updatedAt:
            serverTimestamp(),
        },
      );
    } catch (error: unknown) {
      logDevelopmentWarning(
        '[Treasi] Unable to mark onboarding complete in Firestore:',
        error,
      );
    }
  };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Validates coordinates before passing them between screens.
const getValidCoordinates = (
  latitude: unknown,
  longitude: unknown,
): Coordinates | null => {
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
};

// Announces important alerts for screen-reader users.
const announceAndAlert = (
  title: string,
  message: string,
): void => {
  AccessibilityInfo
    .announceForAccessibility(
      `${title}. ${message}`,
    );

  Alert.alert(
    title,
    message,
  );
};

/* -------------------------------------------------------------------------- */
/* Animated screen wrapper                                                    */
/* -------------------------------------------------------------------------- */

interface AnimatedScreenWrapperProps {
  children: React.ReactNode;
  reduceMotionEnabled: boolean;
  screenKey: ScreenState;
}

const AnimatedScreenWrapper:
  React.FC<
    AnimatedScreenWrapperProps
  > = ({
    children,
    reduceMotionEnabled,
    screenKey,
  }) => {
    const fadeAnim =
      useRef(
        new Animated.Value(1),
      ).current;

    const scaleAnim =
      useRef(
        new Animated.Value(1),
      ).current;

    useEffect(() => {
      fadeAnim.stopAnimation();
      scaleAnim.stopAnimation();

      /*
       * Respect the user's Reduce Motion accessibility preference.
       */
      if (
        reduceMotionEnabled
      ) {
        fadeAnim.setValue(1);
        scaleAnim.setValue(1);

        return;
      }

      fadeAnim.setValue(0);
      scaleAnim.setValue(
        0.985,
      );

      const animation =
        Animated.parallel([
          Animated.timing(
            fadeAnim,
            {
              toValue: 1,
              duration: 220,

              easing:
                Easing.out(
                  Easing.cubic,
                ),

              useNativeDriver:
                true,
            },
          ),

          Animated.timing(
            scaleAnim,
            {
              toValue: 1,
              duration: 220,

              easing:
                Easing.out(
                  Easing.cubic,
                ),

              useNativeDriver:
                true,
            },
          ),
        ]);

      animation.start();

      return () => {
        animation.stop();
      };
    }, [
      fadeAnim,
      reduceMotionEnabled,
      scaleAnim,
      screenKey,
    ]);

    return (
      <Animated.View
        style={[
          styles.animatedWrapper,

          {
            opacity:
              fadeAnim,

            transform: [
              {
                scale:
                  scaleAnim,
              },
            ],
          },
        ]}
      >
        {children}
      </Animated.View>
    );
  };

/* -------------------------------------------------------------------------- */
/* Main navigator                                                             */
/* -------------------------------------------------------------------------- */

const MainNavigator:
  React.FC = () => {
    const {
      width,
      height,
    } =
      useWindowDimensions();

    const isLandscape =
      width > height;

    /* ---------------------------------------------------------------------- */
    /* Navigation state                                                       */
    /* ---------------------------------------------------------------------- */

    const [
      currentScreen,
      setCurrentScreen,
    ] =
      useState<ScreenState>(
        'SPLASH',
      );

    const [
      navigationParams,
      setNavigationParams,
    ] =
      useState<NavigationParams>(
        {},
      );

    const [
      selectedTreasureId,
      setSelectedTreasureId,
    ] =
      useState<
        string | undefined
      >(undefined);

    /* ---------------------------------------------------------------------- */
    /* Startup state                                                          */
    /* ---------------------------------------------------------------------- */

    const [
      isSplashFinished,
      setIsSplashFinished,
    ] =
      useState(false);

    const [
      isAuthResolved,
      setIsAuthResolved,
    ] =
      useState(false);

    const [
      currentUser,
      setCurrentUser,
    ] =
      useState<User | null>(
        null,
      );

    const [
      hasCompletedOnboarding,
      setHasCompletedOnboarding,
    ] =
      useState(false);

    const [
      isInitialBootDone,
      setIsInitialBootDone,
    ] =
      useState(false);

    const [
      reduceMotionEnabled,
      setReduceMotionEnabled,
    ] =
      useState(false);

    /*
     * Prevents an older asynchronous auth lookup from overwriting
     * a newer authentication event.
     */
    const authResolutionSequenceRef =
      useRef(0);

    /* ---------------------------------------------------------------------- */
    /* Native landscape lock                                                  */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      /*
       * Browser windows cannot be physically orientation-locked.
       * Native iPhone and Android builds are explicitly locked.
       */
      if (
        Platform.OS ===
        'web'
      ) {
        return;
      }

      ScreenOrientation
        .lockAsync(
          ScreenOrientation
            .OrientationLock
            .LANDSCAPE,
        )
        .catch(
          (
            error: unknown,
          ) => {
            logDevelopmentWarning(
              '[Treasi] Unable to lock the device to landscape:',
              error,
            );
          },
        );
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Reduced motion preference                                              */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      let mounted = true;

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
        .catch(
          (
            error: unknown,
          ) => {
            logDevelopmentWarning(
              '[Treasi] Unable to read reduced-motion preference:',
              error,
            );
          },
        );

      const subscription =
        AccessibilityInfo
          .addEventListener(
            'reduceMotionChanged',
            setReduceMotionEnabled,
          );

      return () => {
        mounted = false;

        subscription.remove();
      };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Authentication listener                                                */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      let mounted = true;

      const unsubscribe =
        onAuthStateChanged(
          auth,

          (user) => {
            const resolutionId =
              ++authResolutionSequenceRef.current;

            setCurrentUser(
              user ?? null,
            );

            setIsAuthResolved(
              false,
            );

            void resolveOnboardingState(
              user ?? null,
            )
              .then(
                (
                  onboardingComplete,
                ) => {
                  if (
                    !mounted ||
                    resolutionId !==
                      authResolutionSequenceRef.current
                  ) {
                    return;
                  }

                  setHasCompletedOnboarding(
                    onboardingComplete,
                  );

                  setIsAuthResolved(
                    true,
                  );
                },
              )
              .catch(
                (
                  error: unknown,
                ) => {
                  if (
                    !mounted ||
                    resolutionId !==
                      authResolutionSequenceRef.current
                  ) {
                    return;
                  }

                  logDevelopmentWarning(
                    '[Treasi] Authentication state resolution failed:',
                    error,
                  );

                  setHasCompletedOnboarding(
                    false,
                  );

                  setIsAuthResolved(
                    true,
                  );
                },
              );
          },

          (error) => {
            if (
              !mounted
            ) {
              return;
            }

            logDevelopmentWarning(
              '[Treasi] Firebase auth listener failed:',
              error,
            );

            setCurrentUser(
              null,
            );

            setHasCompletedOnboarding(
              false,
            );

            setIsAuthResolved(
              true,
            );
          },
        );

      return () => {
        mounted = false;

        authResolutionSequenceRef.current +=
          1;

        unsubscribe();
      };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Initial startup routing                                                */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        isInitialBootDone ||
        !isSplashFinished ||
        !isAuthResolved
      ) {
        return;
      }

      setIsInitialBootDone(
        true,
      );

      setNavigationParams(
        {},
      );

      if (
        currentUser
      ) {
        setCurrentScreen(
          hasCompletedOnboarding
            ? 'DASHBOARD'
            : 'ONBOARDING',
        );

        return;
      }

      setCurrentScreen(
        hasCompletedOnboarding
          ? 'LOGIN'
          : 'ONBOARDING',
      );
    }, [
      currentUser,
      hasCompletedOnboarding,
      isAuthResolved,
      isInitialBootDone,
      isSplashFinished,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Protected-screen authentication guard                                  */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        !isInitialBootDone ||
        !isAuthResolved
      ) {
        return;
      }

      if (
        !currentUser &&
        PROTECTED_SCREENS.has(
          currentScreen,
        )
      ) {
        setNavigationParams(
          {},
        );

        setSelectedTreasureId(
          undefined,
        );

        setCurrentScreen(
          'LOGIN',
        );
      }
    }, [
      currentScreen,
      currentUser,
      isAuthResolved,
      isInitialBootDone,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Successful authentication                                              */
    /* ---------------------------------------------------------------------- */

    const handleAuthenticationSuccess =
      useCallback(
        async (): Promise<void> => {
          const user =
            auth.currentUser;

          if (!user) {
            setCurrentUser(
              null,
            );

            setNavigationParams(
              {},
            );

            setCurrentScreen(
              'LOGIN',
            );

            return;
          }

          /*
           * Re-evaluate onboarding after login/sign-up because the
           * Firestore profile may have just been created.
           */
          const onboardingComplete =
            await resolveOnboardingState(
              user,
            );

          setCurrentUser(
            user,
          );

          setHasCompletedOnboarding(
            onboardingComplete,
          );

          setNavigationParams(
            {},
          );

          setSelectedTreasureId(
            undefined,
          );

          setCurrentScreen(
            onboardingComplete
              ? 'DASHBOARD'
              : 'ONBOARDING',
          );
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Onboarding completion                                                  */
    /* ---------------------------------------------------------------------- */

    const handleOnboardingComplete =
      useCallback(
        async (): Promise<void> => {
          /*
           * This also repairs older accounts whose Firestore profile
           * still says onboarding has not been completed.
           */
          await markCurrentUserOnboardingComplete();

          setHasCompletedOnboarding(
            true,
          );

          setNavigationParams(
            {},
          );

          if (
            auth.currentUser
          ) {
            setCurrentUser(
              auth.currentUser,
            );

            setCurrentScreen(
              'DASHBOARD',
            );

            return;
          }

          setCurrentScreen(
            'LOGIN',
          );
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Navigation                                                             */
    /* ---------------------------------------------------------------------- */

    const handleNavigate =
      useCallback(
        (
          target: string,
          params?: NavigationParams,
        ): void => {
          const normalisedTarget =
            String(
              target ?? '',
            )
              .trim()
              .toUpperCase();

          let targetScreen:
            ScreenState;

          switch (
            normalisedTarget
          ) {
            case 'MAP':
            case 'DASHBOARD':
            case 'HOME':
              targetScreen =
                'DASHBOARD';
              break;

            case 'HUNT':
              targetScreen =
                'HUNT';
              break;

            case 'RANKS':
            case 'RANK':
            case 'LEADERBOARD':
              targetScreen =
                'LEADERBOARD';
              break;

            case 'SOCIAL':
            case 'FRIENDS':
            case 'FRIEND':
            case 'TELEGRAM':
            case 'COMMUNITY':
            case 'COMMS':
              targetScreen =
                'SOCIAL';
              break;

            case 'BAG':
            case 'INVENTORY':
              targetScreen =
                'INVENTORY';
              break;

            case 'PROFILE':
            case 'SETTINGS':
              targetScreen =
                'PROFILE';
              break;

            case 'LOGIN':
              targetScreen =
                'LOGIN';
              break;

            case 'SIGNUP':
            case 'REGISTER':
              targetScreen =
                'SIGNUP';
              break;

            case 'ONBOARDING':
              targetScreen =
                'ONBOARDING';
              break;

            /*
             * Splash is only a startup state. It should not normally
             * be navigated to after boot.
             */
            case 'SPLASH':
              targetScreen =
                auth.currentUser
                  ? 'DASHBOARD'
                  : 'LOGIN';
              break;

            default:
              logDevelopmentWarning(
                `[Treasi] Unknown route "${target}". Falling back to Dashboard.`,
              );

              targetScreen =
                'DASHBOARD';
              break;
          }

          /* ---------------------------------------------------------------- */
          /* Authentication guard                                             */
          /* ---------------------------------------------------------------- */

          if (
            PROTECTED_SCREENS.has(
              targetScreen,
            ) &&
            !auth.currentUser
          ) {
            setNavigationParams(
              {},
            );

            setSelectedTreasureId(
              undefined,
            );

            setCurrentScreen(
              'LOGIN',
            );

            return;
          }

          /* ---------------------------------------------------------------- */
          /* Hunt                                                             */
          /* ---------------------------------------------------------------- */

          if (
            targetScreen ===
            'HUNT'
          ) {
            const requestedTreasureId =
              typeof params
                ?.treasureId ===
                'string' &&
              params.treasureId.trim()
                ? params.treasureId.trim()
                : undefined;

            const activeTreasureId =
              requestedTreasureId ??
              selectedTreasureId;

            if (
              !activeTreasureId
            ) {
              announceAndAlert(
                'NO ACTIVE TARGET',
                'Select a treasure from the field map before entering Hunt mode.',
              );

              return;
            }

            setSelectedTreasureId(
              activeTreasureId,
            );

            setNavigationParams({
              ...params,

              treasureId:
                activeTreasureId,
            });

            setCurrentScreen(
              'HUNT',
            );

            return;
          }

          /* ---------------------------------------------------------------- */
          /* Inventory                                                        */
          /* ---------------------------------------------------------------- */

          if (
            targetScreen ===
            'INVENTORY'
          ) {
            if (
              params?.mode ===
              'create'
            ) {
              const coordinates =
                getValidCoordinates(
                  params.latitude,
                  params.longitude,
                );

              setNavigationParams({
                mode: 'create',

                /*
                 * Coordinates are only forwarded when both values
                 * form a valid geographic pair.
                 */
                ...(coordinates ??
                  {}),
              });
            } else {
              setNavigationParams(
                {},
              );
            }

            setCurrentScreen(
              'INVENTORY',
            );

            return;
          }

          /* ---------------------------------------------------------------- */
          /* Social                                                           */
          /* ---------------------------------------------------------------- */

          if (
            targetScreen ===
            'SOCIAL'
          ) {
            const coordinates =
              getValidCoordinates(
                params?.latitude,
                params?.longitude,
              );

            setNavigationParams(
              coordinates
                ? {
                    ...coordinates,
                  }
                : {},
            );

            setCurrentScreen(
              'SOCIAL',
            );

            return;
          }

          /* ---------------------------------------------------------------- */
          /* Standard route                                                   */
          /* ---------------------------------------------------------------- */

          setNavigationParams(
            {},
          );

          setCurrentScreen(
            targetScreen,
          );
        },
        [
          selectedTreasureId,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Back                                                                   */
    /* ---------------------------------------------------------------------- */

    const handleBackToDashboard =
      useCallback(
        (): void => {
          setNavigationParams(
            {},
          );

          setCurrentScreen(
            auth.currentUser
              ? 'DASHBOARD'
              : 'LOGIN',
          );
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Sign out                                                               */
    /* ---------------------------------------------------------------------- */

    const handleSignOut =
      useCallback(
        async (): Promise<void> => {
          try {
            await signOut(
              auth,
            );

            setCurrentUser(
              null,
            );

            setSelectedTreasureId(
              undefined,
            );

            setNavigationParams(
              {},
            );

            setCurrentScreen(
              'LOGIN',
            );
          } catch (
            error: unknown
          ) {
            logDevelopmentWarning(
              '[Treasi] Sign out failed:',
              error,
            );

            announceAndAlert(
              'SIGN OUT FAILED',
              'Unable to end the current Explorer session. Please try again.',
            );
          }
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Derived route data                                                     */
    /* ---------------------------------------------------------------------- */

    const socialCoordinates =
      useMemo(
        () =>
          getValidCoordinates(
            navigationParams.latitude,
            navigationParams.longitude,
          ),
        [
          navigationParams.latitude,
          navigationParams.longitude,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Active screen                                                          */
    /* ---------------------------------------------------------------------- */

    const renderActiveScreen =
      (): React.ReactNode => {
        let screen:
          React.ReactNode;

        switch (
          currentScreen
        ) {
          case 'SPLASH':
            screen = (
              <SplashScreen
                onFinish={() => {
                  setIsSplashFinished(
                    true,
                  );
                }}
              />
            );
            break;

          case 'ONBOARDING':
            screen = (
              <OnboardingScreen
                onComplete={
                  handleOnboardingComplete
                }
              />
            );
            break;

          case 'LOGIN':
            screen = (
              <LoginScreen
                onNavigateSignUp={() => {
                  setNavigationParams(
                    {},
                  );

                  setCurrentScreen(
                    'SIGNUP',
                  );
                }}
                onLoginSuccess={() => {
                  void handleAuthenticationSuccess();
                }}
              />
            );
            break;

          case 'SIGNUP':
            screen = (
              <SignUpScreen
                onNavigateLogin={() => {
                  setNavigationParams(
                    {},
                  );

                  setCurrentScreen(
                    'LOGIN',
                  );
                }}
                onSignUpSuccess={() => {
                  void handleAuthenticationSuccess();
                }}
              />
            );
            break;

          case 'DASHBOARD':
            screen = (
              <DashboardScreen
                onNavigate={
                  handleNavigate
                }
              />
            );
            break;

          case 'HUNT':
            screen = (
              <HuntScreen
                treasureId={
                  navigationParams
                    .treasureId ??
                  selectedTreasureId
                }
                onBack={
                  handleBackToDashboard
                }
              />
            );
            break;

          case 'LEADERBOARD':
            screen = (
              <LeaderboardScreen
                onBack={
                  handleBackToDashboard
                }
                onNavigate={
                  handleNavigate
                }
              />
            );
            break;

          case 'SOCIAL':
            screen = (
              <SocialScreen
                onNavigate={
                  handleNavigate
                }
                userCoordinates={
                  socialCoordinates
                }
              />
            );
            break;

          case 'INVENTORY':
            screen = (
              <InventoryScreen
                initialParams={
                  navigationParams
                }
                onBack={
                  handleBackToDashboard
                }
                onNavigate={
                  handleNavigate
                }
              />
            );
            break;

          case 'PROFILE':
            screen = (
              <ProfileSettingsScreen
                onBack={
                  handleBackToDashboard
                }
                onSignOut={
                  handleSignOut
                }
                onNavigate={
                  handleNavigate
                }
              />
            );
            break;

          default:
            screen = (
              <DashboardScreen
                onNavigate={
                  handleNavigate
                }
              />
            );
            break;
        }

        return (
          <AnimatedScreenWrapper
            reduceMotionEnabled={
              reduceMotionEnabled
            }
            screenKey={
              currentScreen
            }
          >
            {screen}
          </AnimatedScreenWrapper>
        );
      };

    /* ---------------------------------------------------------------------- */
    /* Render                                                                 */
    /* ---------------------------------------------------------------------- */

    return (
      <View
        style={
          styles.container
        }
      >
        <StatusBar
          style="light"
          hidden
        />

        {isLandscape ? (
          renderActiveScreen()
        ) : (
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            accessibilityLabel="Treasi requires landscape orientation. Rotate your device horizontally to continue."
            style={
              styles.orientationWarning
            }
          >
            <Text
              accessible={
                false
              }
              importantForAccessibility="no"
              style={
                styles.warningIcon
              }
            >
              [ ! ]
            </Text>

            <Text
              style={
                styles.warningTitle
              }
            >
              TILT INSTRUMENT HORIZONTALLY
            </Text>

            <Text
              style={
                styles.warningSubText
              }
            >
              Treasi requires landscape alignment to calibrate the field interface.
            </Text>
          </View>
        )}
      </View>
    );
  };

/* -------------------------------------------------------------------------- */
/* Root app                                                                   */
/* -------------------------------------------------------------------------- */

const App:
  React.FC = () => {
    return (
      <SafeAreaProvider
        initialMetrics={
          initialWindowMetrics
        }
      >
        <MainNavigator />
      </SafeAreaProvider>
    );
  };

export default App;

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#1E281F',
    },

    animatedWrapper: {
      flex: 1,
      width: '100%',
      height: '100%',
    },

    orientationWarning: {
      flex: 1,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        '#1E281F',
      paddingHorizontal: 32,
      paddingVertical: 24,
    },

    /*
     * The lighter rust shade keeps the warning accent readable
     * against Treasi's dark forest background.
     */
    warningIcon: {
      color:
        '#D47756',
      fontSize: 24,
      fontWeight: '700',
      marginBottom: 12,
      letterSpacing: 2,
    },

    warningTitle: {
      color:
        '#F3ECD8',
      fontSize: 18,
      fontWeight: '700',
      letterSpacing: 1.5,
      textAlign: 'center',
      marginBottom: 8,
    },

    warningSubText: {
      color:
        '#B08D57',
      fontSize: 14,
      textAlign: 'center',
      maxWidth: 420,
      lineHeight: 20,
    },
  });