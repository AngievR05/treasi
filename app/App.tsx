import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, useWindowDimensions, Animated, Easing, Alert } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from './src/config/firebase';

// Lazy-loaded screen components for optimized performance
const SplashScreen = lazy(() => 
  import('./src/screens/SplashScreen').then((module) => ({ default: module.SplashScreen }))
);
const OnboardingScreen = lazy(() => 
  import('./src/screens/OnboardingScreen').then((module) => ({ default: module.OnboardingScreen }))
);
const LoginScreen = lazy(() => 
  import('./src/screens/Auth/LoginScreen').then((module) => ({ default: module.default }))
);
const SignUpScreen = lazy(() => 
  import('./src/screens/Auth/SignUpScreen').then((module) => ({ default: module.SignUpScreen }))
);
const DashboardScreen = lazy(() => 
  import('./src/screens/DashboardScreen').then((module) => ({ default: module.DashboardScreen }))
);
const HuntScreen = lazy(() => 
  import('./src/screens/HuntScreen').then((module) => ({ default: module.HuntScreen }))
);
const LeaderboardScreen = lazy(() => 
  import('./src/screens/LeaderboardScreen').then((module) => ({ default: module.LeaderboardScreen }))
);
const InventoryScreen = lazy(() => 
  import('./src/screens/InventoryScreen').then((module) => ({ default: module.InventoryScreen }))
);
const ProfileSettingsScreen = lazy(() => 
  import('./src/screens/ProfileSettingsScreen').then((module) => ({ default: module.ProfileSettingsScreen }))
);

export type ScreenState = 
  | 'SPLASH' 
  | 'ONBOARDING' 
  | 'LOGIN' 
  | 'SIGNUP' 
  | 'DASHBOARD' 
  | 'HUNT' 
  | 'LEADERBOARD' 
  | 'INVENTORY' 
  | 'PROFILE';

/**
 * Navigation Parameter Interface
 * Strongly typed parameter structure passed across application screen transitions.
 */
export interface NavigationParams {
  treasureId?: string;
  mode?: 'hunt' | 'create';
  latitude?: number;
  longitude?: number;
}

/**
 * AnimatedScreenWrapper
 * Micro-interaction screen transitions (fade + tactile scale)
 */
interface AnimatedScreenWrapperProps {
  children: React.ReactNode;
  screenKey: string;
}

function AnimatedScreenWrapper({ children, screenKey }: AnimatedScreenWrapperProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.97)).current;

  useEffect(() => {
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.97);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 350,
        easing: Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      }),
    ]).start();
  }, [screenKey, fadeAnim, scaleAnim]);

  return (
    <Animated.View 
      style={[
        styles.animatedWrapper, 
        { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }
      ]}
    >
      {children}
    </Animated.View>
  );
}

function MainNavigator() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Active Navigation & Parameter State
  const [currentScreen, setCurrentScreen] = useState<ScreenState>('SPLASH');
  const [navigationParams, setNavigationParams] = useState<NavigationParams>({});
  const [selectedTreasureId, setSelectedTreasureId] = useState<string | undefined>(undefined);

  // Synchronization & Auth State Flags
  const [isSplashFinished, setIsSplashFinished] = useState<boolean>(false);
  const [isAuthResolved, setIsAuthResolved] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean>(false);
  const [isInitialBootDone, setIsInitialBootDone] = useState<boolean>(false);

  // 1. Listen for Firebase Auth state changes & check Firestore onboarding state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userDocRef);
          if (userSnap.exists()) {
            const data = userSnap.data();
            setHasCompletedOnboarding(data?.hasCompletedOnboarding ?? false);
          } else {
            const localOnboarding = await AsyncStorage.getItem('@treasi_onboarding_completed');
            setHasCompletedOnboarding(localOnboarding === 'true');
          }
        } catch (error) {
          const localOnboarding = await AsyncStorage.getItem('@treasi_onboarding_completed');
          setHasCompletedOnboarding(localOnboarding === 'true');
        }
      } else {
        setCurrentUser(null);
        const localOnboarding = await AsyncStorage.getItem('@treasi_onboarding_completed');
        setHasCompletedOnboarding(localOnboarding === 'true');
      }
      setIsAuthResolved(true);
    });

    return () => unsubscribe();
  }, []);

  // 2. Synchronized Startup Routing Resolver (Waits for both Splash finish and Auth resolution)
  useEffect(() => {
    if (!isInitialBootDone && isSplashFinished && isAuthResolved) {
      setIsInitialBootDone(true);
      if (currentUser) {
        if (hasCompletedOnboarding) {
          setCurrentScreen('DASHBOARD');
        } else {
          setCurrentScreen('ONBOARDING');
        }
      } else {
        if (hasCompletedOnboarding) {
          setCurrentScreen('LOGIN');
        } else {
          setCurrentScreen('ONBOARDING');
        }
      }
    }
  }, [isSplashFinished, isAuthResolved, currentUser, hasCompletedOnboarding, isInitialBootDone]);

  // 3. Dynamic Guard for Mid-session Auth Changes (e.g. Sign out)
  useEffect(() => {
    if (isInitialBootDone) {
      if (!currentUser && ['DASHBOARD', 'HUNT', 'LEADERBOARD', 'INVENTORY', 'PROFILE'].includes(currentScreen)) {
        setCurrentScreen('LOGIN');
      }
    }
  }, [currentUser, isInitialBootDone, currentScreen]);

  /**
   * Central Navigation Controller
   * Handles target mapping, alias translation, parameter preservation,
   * target validation for Hunt mode, and stale parameter isolation.
   */
  const handleNavigate = (target: string, params?: NavigationParams) => {
    const normalizedTarget = (target || '').toUpperCase().trim();

    // Map bottom navigation & system aliases to core ScreenState targets
    let targetScreen: ScreenState;
    if (normalizedTarget === 'MAP' || normalizedTarget === 'DASHBOARD') {
      targetScreen = 'DASHBOARD';
    } else if (normalizedTarget === 'RANKS' || normalizedTarget === 'LEADERBOARD') {
      targetScreen = 'LEADERBOARD';
    } else if (normalizedTarget === 'BAG' || normalizedTarget === 'INVENTORY') {
      targetScreen = 'INVENTORY';
    } else if (normalizedTarget === 'HUNT') {
      targetScreen = 'HUNT';
    } else if (normalizedTarget === 'PROFILE') {
      targetScreen = 'PROFILE';
    } else if (normalizedTarget === 'LOGIN') {
      targetScreen = 'LOGIN';
    } else if (normalizedTarget === 'SIGNUP') {
      targetScreen = 'SIGNUP';
    } else if (normalizedTarget === 'ONBOARDING') {
      targetScreen = 'ONBOARDING';
    } else if (normalizedTarget === 'SPLASH') {
      targetScreen = 'SPLASH';
    } else {
      targetScreen = 'DASHBOARD';
    }

    // HUNT Screen Parameter Guard
    if (targetScreen === 'HUNT') {
      const activeTreasureId = params?.treasureId || selectedTreasureId;
      if (!activeTreasureId) {
        Alert.alert(
          'NO ACTIVE TARGET',
          'Select a treasure from the field map before entering Hunt mode.'
        );
        return;
      }

      // Preserve active target in memory and set screen parameters
      setSelectedTreasureId(activeTreasureId);
      setNavigationParams({
        ...params,
        treasureId: activeTreasureId,
      });
      setCurrentScreen('HUNT');
      return;
    }

    // INVENTORY Screen Parameter Handling
    if (targetScreen === 'INVENTORY') {
      if (params && params.mode === 'create') {
        setNavigationParams({
          mode: 'create',
          latitude: params.latitude,
          longitude: params.longitude,
          treasureId: params.treasureId,
        });
      } else {
        // Clear stale creation/GPS state when accessing standard Inventory view
        setNavigationParams({});
      }
      setCurrentScreen('INVENTORY');
      return;
    }

    // Standard Transitions: Clear route-specific parameters to avoid leakage
    setNavigationParams({});
    setCurrentScreen(targetScreen);
  };

  /**
   * Universal Back Callback
   * Navigates back to Dashboard while resetting temporary screen parameters.
   */
  const handleBackToDashboard = () => {
    setNavigationParams({});
    setCurrentScreen('DASHBOARD');
  };

  const renderActiveScreen = () => {
    const renderWithSuspense = (element: React.ReactNode) => (
      <Suspense 
        fallback={
          <View style={styles.loadingState}>
            <Text style={styles.loadingPrefix}>Loading...</Text>
            <Text style={styles.loadingText}>Please Wait</Text>
          </View>
        }
      >
        <AnimatedScreenWrapper screenKey={currentScreen}>
          {element}
        </AnimatedScreenWrapper>
      </Suspense>
    );

    switch (currentScreen) {
      case 'SPLASH':
        return renderWithSuspense(
          <SplashScreen onFinish={() => setIsSplashFinished(true)} />
        );

      case 'ONBOARDING':
        return renderWithSuspense(
          <OnboardingScreen 
            onComplete={async () => {
              await AsyncStorage.setItem('@treasi_onboarding_completed', 'true');
              setHasCompletedOnboarding(true);
              setNavigationParams({});
              if (auth.currentUser) {
                setCurrentScreen('DASHBOARD');
              } else {
                setCurrentScreen('LOGIN');
              }
            }} 
          />
        );

      case 'LOGIN':
        return renderWithSuspense(
          <LoginScreen 
            onNavigateSignUp={() => {
              setNavigationParams({});
              setCurrentScreen('SIGNUP');
            }} 
            onLoginSuccess={() => {
              setNavigationParams({});
              setCurrentScreen('DASHBOARD');
            }} 
          />
        );

      case 'SIGNUP':
        return renderWithSuspense(
          <SignUpScreen 
            onNavigateLogin={() => {
              setNavigationParams({});
              setCurrentScreen('LOGIN');
            }} 
            onSignUpSuccess={() => {
              setNavigationParams({});
              setCurrentScreen('DASHBOARD');
            }} 
          />
        );

      case 'DASHBOARD':
        return renderWithSuspense(
          <DashboardScreen onNavigate={handleNavigate} />
        );

      case 'HUNT':
        return renderWithSuspense(
          <HuntScreen 
            treasureId={navigationParams.treasureId || selectedTreasureId} 
            onBack={handleBackToDashboard} 
          />
        );

      case 'LEADERBOARD':
        return renderWithSuspense(
          <LeaderboardScreen
            onBack={handleBackToDashboard}
            onNavigate={handleNavigate}
          />
        );

      case 'INVENTORY':
        return renderWithSuspense(
          <InventoryScreen
            initialParams={navigationParams}
            onBack={handleBackToDashboard}
            onNavigate={handleNavigate}
          />
        );

      case 'PROFILE':
        return renderWithSuspense(
          <ProfileSettingsScreen 
            onBack={handleBackToDashboard} 
            onSignOut={async () => {
              await auth.signOut();
              setSelectedTreasureId(undefined);
              setNavigationParams({});
              setCurrentScreen('LOGIN');
            }} 
          />
        );

      default:
        return renderWithSuspense(
          <DashboardScreen onNavigate={handleNavigate} />
        );
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" hidden />
      
      {isLandscape ? (
        renderActiveScreen()
      ) : (
        /* Orientation Safety Net for Landscape Constraint */
        <View style={styles.orientationWarning}>
          <Text style={styles.warningIcon}>[ ! ]</Text>
          <Text style={styles.warningTitle}>TILT INSTRUMENT HORIZONTALLY</Text>
          <Text style={styles.warningSubText}>
            Treasi requires landscape alignment to calibrate hardware sensor telemetry array.
          </Text>
        </View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <MainNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E281F', // Forest Deep Chassis
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  animatedWrapper: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  orientationWarning: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E281F',
    padding: 32,
  },
  warningIcon: {
    color: '#A64B2A', // Sienna Accent
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
    letterSpacing: 2,
  },
  warningTitle: {
    color: '#E8DCC0', // Parchment
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: 8,
  },
  warningSubText: {
    color: '#B08D57', // Brass Trim
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 18,
  },
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E281F',
  },
  loadingPrefix: {
    color: '#B08D57',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  loadingText: {
    color: '#E8DCC0',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1.2,
  },
});