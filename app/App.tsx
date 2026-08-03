import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

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

export default function App() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Active Navigation State
  const [currentScreen, setCurrentScreen] = useState<ScreenState>('SPLASH');

  // Splash Screen Timeout Preview
  useEffect(() => {
    if (currentScreen === 'SPLASH') {
      const timer = setTimeout(() => setCurrentScreen('ONBOARDING'), 2000);
      return () => clearTimeout(timer);
    }
  }, [currentScreen]);

  const renderActiveScreen = () => {
    switch (currentScreen) {
      case 'SPLASH':
        return <SplashScreen />;
      case 'ONBOARDING':
        return <OnboardingScreen onComplete={() => setCurrentScreen('LOGIN')} />;
      case 'LOGIN':
        return (
          <LoginScreen 
            onNavigateSignUp={() => setCurrentScreen('SIGNUP')} 
            onLoginSuccess={() => setCurrentScreen('DASHBOARD')} 
          />
        );
      case 'SIGNUP':
        return (
          <SignUpScreen 
            onNavigateLogin={() => setCurrentScreen('LOGIN')} 
            onSignUpSuccess={() => setCurrentScreen('DASHBOARD')} 
          />
        );
      case 'DASHBOARD':
        return <DashboardScreen onNavigate={(target) => setCurrentScreen(target as ScreenState)} />;
      case 'HUNT':
        return <HuntScreen onBack={() => setCurrentScreen('DASHBOARD')} />;
      case 'LEADERBOARD':
        return <LeaderboardScreen onBack={() => setCurrentScreen('DASHBOARD')} />;
      case 'INVENTORY':
        return <InventoryScreen onBack={() => setCurrentScreen('DASHBOARD')} />;
      case 'PROFILE':
        return (
          <ProfileSettingsScreen 
            onBack={() => setCurrentScreen('DASHBOARD')} 
            onSignOut={() => setCurrentScreen('LOGIN')} 
          />
        );
      default:
        return <DashboardScreen onNavigate={(target) => setCurrentScreen(target as ScreenState)} />;
    }
  };

  return (
    <View style={styles.container}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2C3B2E', // Forest Deep
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