import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  ActivityIndicator,
  StyleSheet,
  View,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  onAuthStateChanged,
  type User,
} from 'firebase/auth';

import {
  doc,
  getDoc,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

import {
  auth,
  db,
} from '../config/firebase';

import type {
  UserDocument,
} from '../types/firestore';

/* -------------------------------------------------------------------------- */
/* Screens                                                                    */
/* -------------------------------------------------------------------------- */

import {
  OnboardingScreen,
} from '../screens/OnboardingScreen';

import LoginScreen from '../screens/Auth/LoginScreen';

import {
  SignUpScreen,
} from '../screens/Auth/SignUpScreen';

import {
  DashboardScreen,
} from '../screens/DashboardScreen';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Keep this key identical everywhere in the app.
 *
 * Your main App.tsx previously used this key, so RootNavigator should
 * not create a second independent onboarding flag.
 */
export const LOCAL_ONBOARDING_KEY =
  '@treasi_onboarding_completed';

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

type NavigationState =
  | 'LOADING'
  | 'ONBOARDING'
  | 'AUTH_LOGIN'
  | 'AUTH_SIGNUP'
  | 'DASHBOARD';

/* -------------------------------------------------------------------------- */
/* Root Navigator                                                             */
/* -------------------------------------------------------------------------- */

export const RootNavigator: React.FC =
  () => {
    const [
      navState,
      setNavState,
    ] =
      useState<NavigationState>(
        'LOADING',
      );

    const [
      currentUser,
      setCurrentUser,
    ] =
      useState<User | null>(
        null,
      );

    /* ---------------------------------------------------------------------- */
    /* Local onboarding state                                                 */
    /* ---------------------------------------------------------------------- */

    const getLocalOnboardingStatus =
      useCallback(
        async (): Promise<boolean> => {
          try {
            const value =
              await AsyncStorage.getItem(
                LOCAL_ONBOARDING_KEY,
              );

            return value ===
              'true';
          } catch (
            error
          ) {
            console.warn(
              '[Treasi Navigation] Unable to read local onboarding state:',
              error,
            );

            return false;
          }
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Firebase auth resolver                                                 */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      let mounted =
        true;

      const unsubscribe =
        onAuthStateChanged(
          auth,

          async (
            user,
          ) => {
            if (!mounted) {
              return;
            }

            setCurrentUser(
              user,
            );

            /* -------------------------------------------------------------- */
            /* Authenticated                                                   */
            /* -------------------------------------------------------------- */

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

                if (
                  !mounted
                ) {
                  return;
                }

                if (
                  !userSnapshot.exists()
                ) {
                  setNavState(
                    'ONBOARDING',
                  );

                  return;
                }

                const userData =
                  userSnapshot.data() as
                    UserDocument;

                /*
                 * Priority 1:
                 * explicit developer/user bypass.
                 */
                if (
                  userData.skipOnboardingAuthFlow ===
                  true
                ) {
                  setNavState(
                    'DASHBOARD',
                  );

                  return;
                }

                /*
                 * Priority 2:
                 * Firestore account onboarding state.
                 */
                if (
                  userData.hasCompletedOnboarding ===
                  true
                ) {
                  setNavState(
                    'DASHBOARD',
                  );
                } else {
                  setNavState(
                    'ONBOARDING',
                  );
                }

                return;
              } catch (
                error
              ) {
                console.error(
                  '[Treasi Navigation] Unable to resolve user document:',
                  error,
                );

                /*
                 * If Firestore temporarily fails, check the local device
                 * state rather than automatically forcing onboarding.
                 */
                const localComplete =
                  await getLocalOnboardingStatus();

                if (
                  !mounted
                ) {
                  return;
                }

                setNavState(
                  localComplete
                    ? 'DASHBOARD'
                    : 'ONBOARDING',
                );

                return;
              }
            }

            /* -------------------------------------------------------------- */
            /* Unauthenticated                                                 */
            /* -------------------------------------------------------------- */

            const localComplete =
              await getLocalOnboardingStatus();

            if (
              !mounted
            ) {
              return;
            }

            setNavState(
              localComplete
                ? 'AUTH_LOGIN'
                : 'ONBOARDING',
            );
          },

          (
            error,
          ) => {
            console.error(
              '[Treasi Navigation] Firebase authentication listener failed:',
              error,
            );

            if (mounted) {
              setCurrentUser(
                null,
              );

              setNavState(
                'AUTH_LOGIN',
              );
            }
          },
        );

      return () => {
        mounted =
          false;

        unsubscribe();
      };
    }, [
      getLocalOnboardingStatus,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Complete onboarding                                                    */
    /* ---------------------------------------------------------------------- */

    const handleOnboardingComplete =
      useCallback(
        async () => {
          try {
            /*
             * Persist onboarding completion on this device.
             */
            await AsyncStorage.setItem(
              LOCAL_ONBOARDING_KEY,
              'true',
            );

            const activeUser =
              auth.currentUser ||
              currentUser;

            /*
             * If there is no authenticated account yet,
             * continue to the login screen.
             */
            if (
              !activeUser
            ) {
              setNavState(
                'AUTH_LOGIN',
              );

              return;
            }

            /*
             * Synchronise the account onboarding flag with Firestore.
             *
             * merge:true means this does not overwrite the rest of
             * the user profile.
             */
            const userDocumentRef =
              doc(
                db,
                'users',
                activeUser.uid,
              );

            await setDoc(
              userDocumentRef,
              {
                hasCompletedOnboarding:
                  true,

                updatedAt:
                  Timestamp.now(),
              },
              {
                merge: true,
              },
            );

            setNavState(
              'DASHBOARD',
            );
          } catch (
            error
          ) {
            console.error(
              '[Treasi Navigation] Unable to complete onboarding:',
              error,
            );

            /*
             * Local onboarding may already have succeeded even if
             * Firestore failed. Do not trap the user in onboarding.
             */
            if (
              auth.currentUser ||
              currentUser
            ) {
              setNavState(
                'DASHBOARD',
              );
            } else {
              setNavState(
                'AUTH_LOGIN',
              );
            }
          }
        },
        [
          currentUser,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Loading                                                               */
    /* ---------------------------------------------------------------------- */

    if (
      navState ===
      'LOADING'
    ) {
      return (
        <View
          style={
            styles.loadingContainer
          }
        >
          <ActivityIndicator
            size="large"
            color="#B08D57"
          />
        </View>
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Screen resolver                                                       */
    /* ---------------------------------------------------------------------- */

    switch (
      navState
    ) {
      case 'ONBOARDING':
        return (
          <OnboardingScreen
            onComplete={
              handleOnboardingComplete
            }
          />
        );

      case 'AUTH_LOGIN':
        return (
          <LoginScreen
            onNavigateSignUp={() =>
              setNavState(
                'AUTH_SIGNUP',
              )
            }
            onLoginSuccess={() =>
              setNavState(
                'DASHBOARD',
              )
            }
          />
        );

      case 'AUTH_SIGNUP':
        return (
          <SignUpScreen
            onNavigateLogin={() =>
              setNavState(
                'AUTH_LOGIN',
              )
            }
            onSignUpSuccess={() =>
              setNavState(
                'DASHBOARD',
              )
            }
          />
        );

      case 'DASHBOARD':
        return (
          <DashboardScreen />
        );

      default:
        return (
          <OnboardingScreen
            onComplete={
              handleOnboardingComplete
            }
          />
        );
    }
  };

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    loadingContainer: {
      flex: 1,

      backgroundColor:
        '#2C3B2E',

      justifyContent:
        'center',

      alignItems:
        'center',
    },
  });

export default RootNavigator;