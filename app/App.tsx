import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, useWindowDimensions, Animated } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './src/config/firebase';

// Screen Imports
import { SplashScreen } from './src/screens/SplashScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import LoginScreen from './src/screens/Auth/LoginScreen';
import { SignUpScreen } from './src/screens/Auth/SignUpScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { HuntScreen } from './src/screens/HuntScreen';
import { LeaderboardScreen } from './src/screens/LeaderboardScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { ProfileSettingsScreen } from './src/screens/ProfileSettingsScreen';

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

function AppNavigator() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const insets = useSafeAreaInsets();

  // Active Navigation State
  const [currentScreen, setCurrentScreen] = useState<ScreenState>('SPLASH');
  
  // Firebase Auth State Tracker
  const [user, setUser] = useState<User | null>(null);
  const [authInitialized, setAuthInitialized] = useState<boolean>(false);
  const [splashMinTimePassed, setSplashMinTimePassed] = useState<boolean>(false);

  // Screen Transition Animation Value
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // 1. Minimum Splash Screen Diagnostic Sequence Timer (2 Seconds)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSplashMinTimePassed(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // 2. Background Firebase Auth State Initialization
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthInitialized(true);
    });
    return () => unsubscribe();
  }, []);

  // 3. Handshake Logic: Route user once minimum splash timer AND auth initialization complete
  useEffect(() => {
    if (splashMinTimePassed && authInitialized && currentScreen === 'SPLASH') {
      if (user) {
        setCurrentScreen('DASHBOARD');
      } else {
        setCurrentScreen('ONBOARDING');
      }
    }
  }, [splashMinTimePassed, authInitialized, user, currentScreen]);

  // Animated Screen Navigation Handler
  const navigateTo = (target: ScreenState) => {
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 0.1,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
    setCurrentScreen(target);
  };

  const renderActiveScreen = () => {
    switch (currentScreen) {
      case 'SPLASH':
        return <SplashScreen />;
      case 'ONBOARDING':
        return <OnboardingScreen onComplete={() => navigateTo('LOGIN')} />;
      case 'LOGIN':
        return (
          <LoginScreen 
            onNavigateSignUp={() => navigateTo('SIGNUP')} 
            onLoginSuccess={() => navigateTo('DASHBOARD')} 
          />
        );
      case 'SIGNUP':
        return (
          <SignUpScreen 
            onNavigateLogin={() => navigateTo('LOGIN')} 
            onSignUpSuccess={() => navigateTo('DASHBOARD')} 
          />
        );
      case 'DASHBOARD':
        return <DashboardScreen onNavigate={(target) => navigateTo(target as ScreenState)} />;
      case 'HUNT':
        return <HuntScreen onBack={() => navigateTo('DASHBOARD')} />;
      case 'LEADERBOARD':
        return <LeaderboardScreen onBack={() => navigateTo('DASHBOARD')} />;
      case 'INVENTORY':
        return <InventoryScreen onBack={() => navigateTo('DASHBOARD')} />;
      case 'PROFILE':
        return (
          <ProfileSettingsScreen 
            onBack={() => navigateTo('DASHBOARD')} 
            onSignOut={() => navigateTo('LOGIN')} 
          />
        );
      default:
        return <DashboardScreen onNavigate={(target) => navigateTo(target as ScreenState)} />;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" hidden />
      
      {isLandscape ? (
        <Animated.View 
          style={[
            styles.safeAreaContainer, 
            { 
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              paddingLeft: insets.left,
              paddingRight: insets.right,
              opacity: fadeAnim 
            }
          ]}
        >
          {renderActiveScreen()}
        </Animated.View>
      ) : (
        /* Landscape constraint safety warning */
        <View style={styles.orientationWarning}>
          <Text style={styles.warningTitle}>TILT INSTRUMENT HORIZONTALLY</Text>
          <Text style={styles.warningSubText}>
            Treasi requires landscape alignment to calibrate sensor array.
          </Text>
        </View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2C3B2E', // Forest Deep
  },
  safeAreaContainer: {
    flex: 1,
    backgroundColor: '#2C3B2E',
  },
  orientationWarning: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2C3B2E',
    padding: 32,
  },
  warningTitle: {
    color: '#E8DCC0', // Parchment
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 8,
  },
  warningSubText: {
    color: '#B08D57', // Brass Trim
    fontSize: 12,
    textAlign: 'center',
  },
});