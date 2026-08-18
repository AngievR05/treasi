import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { UserDocument } from '../types/firestore';

import OnboardingScreen from '../screens/OnboardingScreen';
import LoginScreen from '../screens/Auth/LoginScreen';
import { SignUpScreen } from '../screens/Auth/SignUpScreen';
import { DashboardScreen } from '../screens/DashboardScreen';

export const LOCAL_ONBOARDING_KEY = '@treasi_device_onboarding_complete';

type NavigationState = 
  | 'LOADING'
  | 'ONBOARDING'
  | 'AUTH_LOGIN'
  | 'AUTH_SIGNUP'
  | 'DASHBOARD';

export const RootNavigator: React.FC = () => {
  const [navState, setNavState] = useState<NavigationState>('LOADING');
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userDocRef);

          if (userSnap.exists()) {
            const userData = userSnap.data() as UserDocument;
            
            // Priority 1: Persistent Bypass Toggle (Default: false)
            if (userData.skipOnboardingAuthFlow) {
              setNavState('DASHBOARD');
              return;
            }

            // Priority 2: Account Onboarding Status
            if (!userData.hasCompletedOnboarding) {
              setNavState('ONBOARDING');
            } else {
              setNavState('DASHBOARD');
            }
          } else {
            setNavState('ONBOARDING');
          }
        } catch (error) {
          setNavState('ONBOARDING');
        }
      } else {
        // Unauthenticated User: Check Device Persistence
        const localStatus = await AsyncStorage.getItem(LOCAL_ONBOARDING_KEY);
        if (localStatus === 'true') {
          setNavState('AUTH_LOGIN');
        } else {
          setNavState('ONBOARDING');
        }
      }
    });

    return () => unsubscribe();
  }, []);

  const handleOnboardingComplete = async () => {
    try {
      await AsyncStorage.setItem(LOCAL_ONBOARDING_KEY, 'true');
      if (currentUser) {
        // Sync with Firestore
        const userDocRef = doc(db, 'users', currentUser.uid);
        await getDoc(userDocRef); // verify existence or write
        setNavState('DASHBOARD');
      } else {
        setNavState('AUTH_LOGIN');
      }
    } catch (e) {
      setNavState('AUTH_LOGIN');
    }
  };

  if (navState === 'LOADING') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#B08D57" />
      </View>
    );
  }

  switch (navState) {
    case 'ONBOARDING':
      return <OnboardingScreen onComplete={handleOnboardingComplete} />;
    case 'AUTH_LOGIN':
      return (
        <LoginScreen 
          onNavigateSignUp={() => setNavState('AUTH_SIGNUP')}
          onLoginSuccess={() => setNavState('DASHBOARD')}
        />
      );
    case 'AUTH_SIGNUP':
      return (
        <SignUpScreen 
          onNavigateLogin={() => setNavState('AUTH_LOGIN')}
          onSignUpSuccess={() => setNavState('DASHBOARD')}
        />
      );
    case 'DASHBOARD':
      return <DashboardScreen />;
    default:
      return <OnboardingScreen onComplete={handleOnboardingComplete} />;
  }
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#2C3B2E',
    justifyContent: 'center',
    alignItems: 'center',
  },
});