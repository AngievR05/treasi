import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';

import {
  doc,
  getDoc,
} from 'firebase/firestore';

import { auth, db } from './src/config/firebase';

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
/* Navigation Types                                                           */
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

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const ONBOARDING_STORAGE_KEY =
  '@treasi_onboarding_completed';

const PROTECTED_SCREENS: ScreenState[] = [
  'DASHBOARD',
  'HUNT',
  'LEADERBOARD',
  'SOCIAL',
  'INVENTORY',
  'PROFILE',
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const readLocalOnboardingState =
  async (): Promise<boolean> => {
    try {
      const storedValue =
        await AsyncStorage.getItem(
          ONBOARDING_STORAGE_KEY,
        );

      return storedValue === 'true';
    } catch (error) {
      console.warn(
        '[Treasi] Unable to read onboarding state:',
        error,
      );

      return false;
    }
  };

const hasValidCoordinates = (
  latitude: unknown,
  longitude: unknown,
): latitude is number => {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
};

/* -------------------------------------------------------------------------- */
/* Animated Screen Wrapper                                                    */
/* -------------------------------------------------------------------------- */

interface AnimatedScreenWrapperProps {
  children: React.ReactNode;
  screenKey: ScreenState;
}

const AnimatedScreenWrapper: React.FC<
  AnimatedScreenWrapperProps
> = ({
  children,
  screenKey,
}) => {
  const fadeAnim = useRef(
    new Animated.Value(0),
  ).current;

  const scaleAnim = useRef(
    new Animated.Value(0.985),
  ).current;

  useEffect(() => {
    fadeAnim.stopAnimation();
    scaleAnim.stopAnimation();

    fadeAnim.setValue(0);
    scaleAnim.setValue(0.985);

    const animation = Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(
          Easing.cubic,
        ),
        useNativeDriver: true,
      }),

      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(
          Easing.cubic,
        ),
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    return () => {
      animation.stop();
    };
  }, [
    screenKey,
    fadeAnim,
    scaleAnim,
  ]);

  return (
    <Animated.View
      style={[
        styles.animatedWrapper,
        {
          opacity: fadeAnim,
          transform: [
            {
              scale: scaleAnim,
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
/* Main Navigator                                                             */
/* -------------------------------------------------------------------------- */

const MainNavigator: React.FC = () => {
  const {
    width,
    height,
  } = useWindowDimensions();

  const isLandscape =
    width > height;

  /* ---------------------------------------------------------------------- */
  /* Screen state                                                           */
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

  /* ---------------------------------------------------------------------- */
  /* Authentication listener                                                */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    let mounted = true;

    const unsubscribe =
      onAuthStateChanged(
        auth,
        async (user) => {
          try {
            if (!mounted) {
              return;
            }

            setCurrentUser(
              user ?? null,
            );

            let onboardingComplete =
              false;

            if (user) {
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

                if (!mounted) {
                  return;
                }

                if (
                  userSnapshot.exists()
                ) {
                  const data =
                    userSnapshot.data();

                  onboardingComplete =
                    data
                      ?.hasCompletedOnboarding ===
                    true;
                } else {
                  onboardingComplete =
                    await readLocalOnboardingState();
                }
              } catch (error) {
                console.warn(
                  '[Treasi] Unable to read user profile:',
                  error,
                );

                onboardingComplete =
                  await readLocalOnboardingState();
              }
            } else {
              onboardingComplete =
                await readLocalOnboardingState();
            }

            if (!mounted) {
              return;
            }

            setHasCompletedOnboarding(
              onboardingComplete,
            );
          } catch (error) {
            console.error(
              '[Treasi] Authentication resolver failed:',
              error,
            );

            if (mounted) {
              setCurrentUser(
                null,
              );
            }
          } finally {
            if (mounted) {
              setIsAuthResolved(
                true,
              );
            }
          }
        },
        (error) => {
          console.error(
            '[Treasi] Firebase auth listener failed:',
            error,
          );

          if (mounted) {
            setCurrentUser(null);
            setIsAuthResolved(
              true,
            );
          }
        },
      );

    return () => {
      mounted = false;
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

    if (currentUser) {
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
  /* Protected screen auth guard                                            */
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
      PROTECTED_SCREENS.includes(
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
  /* Navigation                                                             */
  /* ---------------------------------------------------------------------- */

  const handleNavigate = (
    target: string,
    params?: NavigationParams,
  ) => {
    const normalizedTarget =
      String(target ?? '')
        .trim()
        .toUpperCase();

    let targetScreen:
      ScreenState;

    switch (
      normalizedTarget
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

      /*
       * Social aliases.
       *
       * Leaderboard's ADD FRIEND and DISPATCH TELEGRAM
       * buttons can both call:
       *
       * onNavigate('SOCIAL')
       */
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

      case 'SPLASH':
        targetScreen =
          'SPLASH';
        break;

      default:
        console.warn(
          `[Treasi] Unknown route "${target}". Falling back to DASHBOARD.`,
        );

        targetScreen =
          'DASHBOARD';
        break;
    }

    /* ------------------------------------------------------------------ */
    /* Authentication guard                                               */
    /* ------------------------------------------------------------------ */

    if (
      PROTECTED_SCREENS.includes(
        targetScreen,
      ) &&
      !currentUser
    ) {
      setNavigationParams(
        {},
      );

      setCurrentScreen(
        'LOGIN',
      );

      return;
    }

    /* ------------------------------------------------------------------ */
    /* Hunt route                                                         */
    /* ------------------------------------------------------------------ */

    if (
      targetScreen ===
      'HUNT'
    ) {
      const requestedTreasureId =
        typeof params
          ?.treasureId ===
        'string'
          ? params.treasureId
          : undefined;

      const activeTreasureId =
        requestedTreasureId ||
        selectedTreasureId;

      if (
        !activeTreasureId
      ) {
        Alert.alert(
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

    /* ------------------------------------------------------------------ */
    /* Inventory create route                                             */
    /* ------------------------------------------------------------------ */

    if (
      targetScreen ===
      'INVENTORY'
    ) {
      if (
        params?.mode ===
        'create'
      ) {
        setNavigationParams({
          mode: 'create',

          latitude:
            typeof params.latitude ===
            'number'
              ? params.latitude
              : undefined,

          longitude:
            typeof params.longitude ===
            'number'
              ? params.longitude
              : undefined,

          treasureId:
            typeof params.treasureId ===
            'string'
              ? params.treasureId
              : undefined,
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

    /* ------------------------------------------------------------------ */
    /* Social route                                                       */
    /* ------------------------------------------------------------------ */

    if (
      targetScreen ===
      'SOCIAL'
    ) {
      /*
       * Preserve coordinates if a caller provides them.
       * SocialScreen may use these for nearby-agent distance.
       */
      if (
        hasValidCoordinates(
          params?.latitude,
          params?.longitude,
        )
      ) {
        setNavigationParams({
          latitude:
            params?.latitude,
          longitude:
            params?.longitude,
        });
      } else {
        setNavigationParams(
          {},
        );
      }

      setCurrentScreen(
        'SOCIAL',
      );

      return;
    }

    /* ------------------------------------------------------------------ */
    /* Standard navigation                                                */
    /* ------------------------------------------------------------------ */

    setNavigationParams(
      {},
    );

    setCurrentScreen(
      targetScreen,
    );
  };

  /* ---------------------------------------------------------------------- */
  /* Back                                                                  */
  /* ---------------------------------------------------------------------- */

  const handleBackToDashboard =
    () => {
      setNavigationParams(
        {},
      );

      setCurrentScreen(
        'DASHBOARD',
      );
    };

  /* ---------------------------------------------------------------------- */
  /* Logout                                                                */
  /* ---------------------------------------------------------------------- */

  const handleSignOut =
    async () => {
      try {
        await signOut(auth);

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
      } catch (error) {
        console.error(
          '[Treasi] Sign out failed:',
          error,
        );

        Alert.alert(
          'SIGN OUT FAILED',
          'Unable to end the current explorer session. Please try again.',
        );
      }
    };

  /* ---------------------------------------------------------------------- */
  /* Social coordinates                                                    */
  /* ---------------------------------------------------------------------- */

  const socialCoordinates =
    hasValidCoordinates(
      navigationParams.latitude,
      navigationParams.longitude,
    )
      ? {
          latitude:
            navigationParams.latitude,
          longitude:
            navigationParams.longitude as number,
        }
      : null;

  /* ---------------------------------------------------------------------- */
  /* Screen rendering                                                      */
  /* ---------------------------------------------------------------------- */

  const renderActiveScreen =
    () => {
      let screen:
        React.ReactNode;

      switch (
        currentScreen
      ) {
        case 'SPLASH':
          screen = (
            <SplashScreen
              onFinish={() =>
                setIsSplashFinished(
                  true,
                )
              }
            />
          );
          break;

        case 'ONBOARDING':
          screen = (
            <OnboardingScreen
              onComplete={
                async () => {
                  try {
                    await AsyncStorage.setItem(
                      ONBOARDING_STORAGE_KEY,
                      'true',
                    );
                  } catch (
                    error
                  ) {
                    console.warn(
                      '[Treasi] Unable to persist onboarding state:',
                      error,
                    );
                  }

                  setHasCompletedOnboarding(
                    true,
                  );

                  setNavigationParams(
                    {},
                  );

                  /*
                   * Use state from the auth listener rather than
                   * accessing currentUser.displayName or assuming
                   * Firebase has already restored the session.
                   */
                  if (
                    auth.currentUser
                  ) {
                    setCurrentScreen(
                      'DASHBOARD',
                    );
                  } else {
                    setCurrentScreen(
                      'LOGIN',
                    );
                  }
                }
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
                setNavigationParams(
                  {},
                );

                setCurrentScreen(
                  'DASHBOARD',
                );
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
                setNavigationParams(
                  {},
                );

                setCurrentScreen(
                  'DASHBOARD',
                );
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
                navigationParams.treasureId ||
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
          screenKey={
            currentScreen
          }
        >
          {screen}
        </AnimatedScreenWrapper>
      );
    };

  /* ---------------------------------------------------------------------- */
  /* Render                                                                */
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
          style={
            styles.orientationWarning
          }
        >
          <Text
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
/* Root App                                                                   */
/* -------------------------------------------------------------------------- */

const App: React.FC = () => {
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
      padding: 32,
    },

    warningIcon: {
      color:
        '#A64B2A',
      fontSize: 24,
      fontWeight:
        'bold',
      marginBottom: 12,
      letterSpacing: 2,
    },

    warningTitle: {
      color:
        '#E8DCC0',
      fontSize: 18,
      fontWeight:
        'bold',
      letterSpacing: 1.5,
      textAlign:
        'center',
      marginBottom: 8,
    },

    warningSubText: {
      color:
        '#B08D57',
      fontSize: 13,
      textAlign:
        'center',
      maxWidth: 360,
      lineHeight: 18,
    },
  });