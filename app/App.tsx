import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

// Screen Imports
const SplashScreen = React.lazy(() => import('./src/screens/SplashScreen').then((module) => ({ default: module.SplashScreen })));
const OnboardingScreen = React.lazy(() => import('./src/screens/OnboardingScreen').then((module) => ({ default: module.OnboardingScreen })));
const LoginScreen = React.lazy(() => import('./src/screens/Auth/LoginScreen').then((module) => ({ default: module.default })));
const SignUpScreen = React.lazy(() => import('./src/screens/Auth/SignUpScreen').then((module) => ({ default: module.SignUpScreen })));
const DashboardScreen = React.lazy(() => import('./src/screens/DashboardScreen').then((module) => ({ default: module.DashboardScreen })));
const HuntScreen = React.lazy(() => import('./src/screens/HuntScreen').then((module) => ({ default: module.HuntScreen })));
const LeaderboardScreen = React.lazy(() => import('./src/screens/LeaderboardScreen').then((module) => ({ default: module.LeaderboardScreen })));
const InventoryScreen = React.lazy(() => import('./src/screens/InventoryScreen').then((module) => ({ default: module.InventoryScreen })));
const ProfileSettingsScreen = React.lazy(() => import('./src/screens/ProfileSettingsScreen').then((module) => ({ default: module.ProfileSettingsScreen })));

type ScreenState = 
  | 'SPLASH' 
  | 'ONBOARDING' 
  | 'LOGIN' 
  | 'SIGNUP' 
  | 'DASHBOARD' 
  | 'HUNT' 
  | 'LEADERBOARD' 
  | 'INVENTORY' 
  | 'PROFILE';

function MainNavigator() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;
  const horizontalEdgePadding = Math.min(insets.left, 6);
  const horizontalEdgePaddingRight = Math.min(insets.right, 6);

  // Active Navigation State
  const [currentScreen, setCurrentScreen] = useState<ScreenState>('SPLASH');

  // Flow controls - Toggles are OFF by default per specification.
  // Enforces Onboarding and Auth on launch.
  const [skipOnboardingToggle] = useState<boolean>(false);
  const [bypassAuthToggle] = useState<boolean>(false);

  // Splash Screen Timeout Logic
  useEffect(() => {
    if (currentScreen === 'SPLASH') {
      const timer = setTimeout(() => {
        if (!skipOnboardingToggle) {
          setCurrentScreen('ONBOARDING');
        } else if (!bypassAuthToggle) {
          setCurrentScreen('LOGIN');
        } else {
          setCurrentScreen('DASHBOARD');
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [currentScreen, skipOnboardingToggle, bypassAuthToggle]);

  const renderActiveScreen = () => {
    const renderWithSuspense = (element: React.ReactNode) => (
      <React.Suspense fallback={<View style={styles.loadingState}><Text style={styles.loadingText}>LOADING...</Text></View>}>
        {element}
      </React.Suspense>
    );

    switch (currentScreen) {
      case 'SPLASH':
        return renderWithSuspense(<SplashScreen />);
      case 'ONBOARDING':
        return renderWithSuspense(<OnboardingScreen onComplete={() => setCurrentScreen('LOGIN')} />);
      case 'LOGIN':
        return renderWithSuspense(
          <LoginScreen 
            onNavigateSignUp={() => setCurrentScreen('SIGNUP')} 
            onLoginSuccess={() => setCurrentScreen('DASHBOARD')} 
          />
        );
      case 'SIGNUP':
        return renderWithSuspense(
          <SignUpScreen 
            onNavigateLogin={() => setCurrentScreen('LOGIN')} 
            onSignUpSuccess={() => setCurrentScreen('DASHBOARD')} 
          />
        );
      case 'DASHBOARD':
        return renderWithSuspense(<DashboardScreen onNavigate={(target) => setCurrentScreen(target as ScreenState)} />);
      case 'HUNT':
        return renderWithSuspense(<HuntScreen onBack={() => setCurrentScreen('DASHBOARD')} />);
      case 'LEADERBOARD':
        return renderWithSuspense(<LeaderboardScreen onBack={() => setCurrentScreen('DASHBOARD')} />);
      case 'INVENTORY':
        return renderWithSuspense(
          <InventoryScreen
            onBack={() => setCurrentScreen('DASHBOARD')}
            onNavigate={(target) => setCurrentScreen(target as ScreenState)}
          />
        );
      case 'PROFILE':
        return renderWithSuspense(
          <ProfileSettingsScreen 
            onBack={() => setCurrentScreen('DASHBOARD')} 
            onSignOut={() => setCurrentScreen('LOGIN')} 
          />
        );
      default:
        return renderWithSuspense(<DashboardScreen onNavigate={(target) => setCurrentScreen(target as ScreenState)} />);
    }
  };

  return (
    <View 
      style={[
        styles.container, 
        { 
          // Keep a minimal edge buffer while letting content fill the screen
          paddingLeft: horizontalEdgePadding,
          paddingRight: horizontalEdgePaddingRight,
          paddingTop: 0,
          paddingBottom: 0,
        }
      ]}
    >
      <StatusBar style="light" hidden />
      
      {isLandscape ? (
        renderActiveScreen()
      ) : (
        /* Accessibility safety net for landscape constraint */
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
      <MainNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2C3B2E', // Forest Deep Chassis
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
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2C3B2E',
  },
  loadingText: {
    color: '#E8DCC0',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1.2,
  },
});