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
  Animated,
  AppState,
  type AppStateStatus,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import * as Location from 'expo-location';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Ionicons,
  MaterialCommunityIcons,
} from '@expo/vector-icons';

import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';

import { auth, db } from '../config/firebase';

import { FieldNavBar } from '../components/FieldNavBar';

import FieldMap from '../components/FieldMap';

import type {
  FieldMapHandle,
  FieldMapRegion,
  FieldMapTreasure,
  FieldMapUserLocation,
} from '../components/FieldMap.types';

import type {
  ActivityFeedDocument,
  TreasureDocument,
  UserDocument,
} from '../types/firestore';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface NavigationParams {
  treasureId?: string;
  mode?: 'hunt' | 'create';
  latitude?: number;
  longitude?: number;
  [key: string]: unknown;
}

interface Props {
  onNavigate?: (
    screen: string,
    params?: NavigationParams,
  ) => void;
}

type LocationFixSource =
  | 'none'
  | 'cached'
  | 'live';

interface FirestoreSyncErrors {
  profile: string | null;
  treasures: string | null;
  activity: string | null;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * This is only a neutral startup viewport.
 * It is never treated as the Explorer's real position.
 */
const FALLBACK_REGION: FieldMapRegion = {
  latitude: 0,
  longitude: 0,
  latitudeDelta: 120,
  longitudeDelta: 120,
};

const USER_REGION_DELTA = 0.04;

const TREASURE_REGION_DELTA = 0.08;

const MAX_TREASURE_DISTANCE_KM = 20;

const FIELD_RADIUS_METRES = 20_000;

const MAX_ACTIVITY_ITEMS = 10;

const GPS_ACCURACY_WARNING_METRES = 100;

const MAX_STAMP_LOCATION_AGE_MS =
  2 * 60 * 1000;

const NAVIGATION_LOCK_MS = 600;

const LOCATION_LAST_KNOWN_MAX_AGE_MS =
  60 * 1000;

const LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METRES =
  500;

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

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Keeps development diagnostics out of the production console.
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

// Validates geographic coordinates before they reach map or navigation logic.
const isValidCoordinate = (
  latitude: unknown,
  longitude: unknown,
): boolean =>
  typeof latitude === 'number' &&
  typeof longitude === 'number' &&
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

// Calculates real straight-line distance between two geographic positions.
const calculateHaversineDistance = (
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number => {
  const earthRadiusKm = 6371;

  const latitudeDifference =
    ((latitudeB - latitudeA) *
      Math.PI) /
    180;

  const longitudeDifference =
    ((longitudeB - longitudeA) *
      Math.PI) /
    180;

  const a =
    Math.sin(
      latitudeDifference / 2,
    ) **
      2 +
    Math.cos(
      (latitudeA * Math.PI) /
        180,
    ) *
      Math.cos(
        (latitudeB * Math.PI) /
          180,
      ) *
      Math.sin(
        longitudeDifference /
          2,
      ) **
        2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a),
    );

  return earthRadiusKm * c;
};

// Formats map distances using metres for nearby treasures.
const formatDistanceText = (
  distanceKm: number,
): string => {
  if (
    !Number.isFinite(
      distanceKm,
    )
  ) {
    return 'DISTANCE UNKNOWN';
  }

  if (distanceKm < 1) {
    return `${Math.round(
      distanceKm * 1000,
    )} M AWAY`;
  }

  return `${distanceKm.toFixed(
    2,
  )} KM AWAY`;
};

// Formats Firestore timestamps into short relative labels.
const formatRelativeTime = (
  timestamp?: Timestamp | null,
): string => {
  if (!timestamp) {
    return 'JUST NOW';
  }

  try {
    const milliseconds =
      timestamp.toMillis();

    const differenceSeconds =
      Math.max(
        0,
        Math.floor(
          (Date.now() -
            milliseconds) /
            1000,
        ),
      );

    if (
      differenceSeconds < 60
    ) {
      return 'JUST NOW';
    }

    if (
      differenceSeconds < 3600
    ) {
      return `${Math.floor(
        differenceSeconds / 60,
      )}M AGO`;
    }

    if (
      differenceSeconds < 86400
    ) {
      return `${Math.floor(
        differenceSeconds / 3600,
      )}H AGO`;
    }

    return `${Math.floor(
      differenceSeconds / 86400,
    )}D AGO`;
  } catch {
    return 'RECENT';
  }
};

// Normalises account names for the field interface.
const normaliseUsername = (
  value: unknown,
  fallback = 'FIELD EXPLORER',
): string => {
  if (
    typeof value !== 'string'
  ) {
    return fallback;
  }

  const trimmed =
    value.trim();

  return trimmed
    ? trimmed.toUpperCase()
    : fallback;
};

// Converts score values into the current Treasi rank labels.
const getRankTitle = (
  points = 0,
): string => {
  if (points >= 3000) {
    return 'RANK: MASTER EXPLORER';
  }

  if (points >= 1500) {
    return 'RANK: TRAILBLAZER III';
  }

  if (points >= 500) {
    return 'RANK: PATHFINDER II';
  }

  return 'RANK: NOVICE SCOUT I';
};

// Announces alerts so VoiceOver and TalkBack receive the same feedback.
const announceAlert = (
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
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export const DashboardScreen:
  React.FC<Props> = ({
    onNavigate,
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

    /* ---------------------------------------------------------------------- */
    /* Authentication                                                        */
    /* ---------------------------------------------------------------------- */

    const currentUser =
      auth.currentUser;

    /* ---------------------------------------------------------------------- */
    /* Refs                                                                  */
    /* ---------------------------------------------------------------------- */

    const mapRef =
      useRef<FieldMapHandle | null>(
        null,
      );

    const locationSubscriptionRef =
      useRef<Location.LocationSubscription | null>(
        null,
      );

    const locationRequestSequenceRef =
      useRef(0);

    const isMountedRef =
      useRef(true);

    const isNavigatingRef =
      useRef(false);

    const navigationUnlockTimeoutRef =
      useRef<ReturnType<
        typeof setTimeout
      > | null>(null);

    const hasCentredOnUserRef =
      useRef(false);

    const hasCentredOnTreasureRef =
      useRef(false);

    /* ---------------------------------------------------------------------- */
    /* Firestore state                                                       */
    /* ---------------------------------------------------------------------- */

    const [
      userData,
      setUserData,
    ] =
      useState<UserDocument | null>(
        null,
      );

    const [
      allTreasures,
      setAllTreasures,
    ] =
      useState<TreasureDocument[]>(
        [],
      );

    const [
      activityFeed,
      setActivityFeed,
    ] =
      useState<
        ActivityFeedDocument[]
      >([]);

    const [
      isLoadingActivity,
      setIsLoadingActivity,
    ] =
      useState(true);

    const [
      firestoreErrors,
      setFirestoreErrors,
    ] =
      useState<FirestoreSyncErrors>({
        profile: null,
        treasures: null,
        activity: null,
      });

    /* ---------------------------------------------------------------------- */
    /* Location state                                                        */
    /* ---------------------------------------------------------------------- */

    const [
      userLocation,
      setUserLocation,
    ] =
      useState<Location.LocationObject | null>(
        null,
      );

    const [
      locationFixSource,
      setLocationFixSource,
    ] =
      useState<LocationFixSource>(
        'none',
      );

    const [
      isInitialisingLocation,
      setIsInitialisingLocation,
    ] =
      useState(true);

    const [
      locationError,
      setLocationError,
    ] =
      useState<string | null>(
        null,
      );

    const [
      locationPermissionStatus,
      setLocationPermissionStatus,
    ] =
      useState<Location.PermissionStatus | null>(
        null,
      );

    const [
      canAskLocationAgain,
      setCanAskLocationAgain,
    ] =
      useState(true);

    const [
      locationServicesEnabled,
      setLocationServicesEnabled,
    ] =
      useState<boolean | null>(
        null,
      );

    /* ---------------------------------------------------------------------- */
    /* Map state                                                             */
    /* ---------------------------------------------------------------------- */

    const [
      isMapReady,
      setIsMapReady,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* Treasure details                                                      */
    /* ---------------------------------------------------------------------- */

    const [
      selectedTreasure,
      setSelectedTreasure,
    ] =
      useState<TreasureDocument | null>(
        null,
      );

    const [
      isArchiving,
      setIsArchiving,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* Accessibility and animation                                           */
    /* ---------------------------------------------------------------------- */

    const [
      reduceMotionEnabled,
      setReduceMotionEnabled,
    ] =
      useState(false);

    const stampButtonScale =
      useRef(
        new Animated.Value(1),
      ).current;

    const locationPulseOpacity =
      useRef(
        new Animated.Value(1),
      ).current;

    /* ---------------------------------------------------------------------- */
    /* Lifecycle                                                             */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      isMountedRef.current =
        true;

      return () => {
        isMountedRef.current =
          false;

        locationRequestSequenceRef.current +=
          1;

        try {
          locationSubscriptionRef.current?.remove();
        } catch {
          // Subscription may already have been removed.
        }

        locationSubscriptionRef.current =
          null;

        if (
          navigationUnlockTimeoutRef.current
        ) {
          clearTimeout(
            navigationUnlockTimeoutRef.current,
          );

          navigationUnlockTimeoutRef.current =
            null;
        }
      };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Reduce Motion                                                         */
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
          // Static behaviour remains safe when the preference is unavailable.
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
    /* Location indicator animation                                          */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      locationPulseOpacity.stopAnimation();

      if (
        reduceMotionEnabled ||
        locationFixSource !==
          'live'
      ) {
        locationPulseOpacity.setValue(
          1,
        );

        return;
      }

      const animation =
        Animated.loop(
          Animated.sequence([
            Animated.timing(
              locationPulseOpacity,
              {
                toValue: 0.55,
                duration: 950,
                useNativeDriver:
                  true,
              },
            ),

            Animated.timing(
              locationPulseOpacity,
              {
                toValue: 1,
                duration: 950,
                useNativeDriver:
                  true,
              },
            ),
          ]),
        );

      animation.start();

      return () => {
        animation.stop();
      };
    }, [
      locationFixSource,
      locationPulseOpacity,
      reduceMotionEnabled,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Navigation                                                            */
    /* ---------------------------------------------------------------------- */

    const safeNavigate =
      useCallback(
        (
          screen: string,
          params?: NavigationParams,
        ): void => {
          if (
            isNavigatingRef.current
          ) {
            return;
          }

          isNavigatingRef.current =
            true;

          onNavigate?.(
            screen,
            params,
          );

          if (
            navigationUnlockTimeoutRef.current
          ) {
            clearTimeout(
              navigationUnlockTimeoutRef.current,
            );
          }

          navigationUnlockTimeoutRef.current =
            setTimeout(
              () => {
                isNavigatingRef.current =
                  false;

                navigationUnlockTimeoutRef.current =
                  null;
              },
              NAVIGATION_LOCK_MS,
            );
        },
        [
          onNavigate,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Firestore subscriptions                                               */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        !currentUser?.uid
      ) {
        setUserData(
          null,
        );

        setAllTreasures(
          [],
        );

        setActivityFeed(
          [],
        );

        setIsLoadingActivity(
          false,
        );

        return;
      }

      setIsLoadingActivity(
        true,
      );

      setFirestoreErrors({
        profile: null,
        treasures: null,
        activity: null,
      });

      /* -------------------------------------------------------------------- */
      /* Explorer profile                                                     */
      /* -------------------------------------------------------------------- */

      const userDocumentRef =
        doc(
          db,
          'users',
          currentUser.uid,
        );

      const unsubscribeUser =
        onSnapshot(
          userDocumentRef,

          (snapshot) => {
            setFirestoreErrors(
              (current) => ({
                ...current,
                profile: null,
              }),
            );

            if (
              snapshot.exists()
            ) {
              setUserData(
                snapshot.data() as
                  UserDocument,
              );
            } else {
              setUserData(
                null,
              );

              setFirestoreErrors(
                (current) => ({
                  ...current,
                  profile:
                    'EXPLORER PROFILE NOT FOUND',
                }),
              );
            }
          },

          (error) => {
            logDevelopmentWarning(
              '[Treasi Dashboard] User subscription failed:',
              error,
            );

            setFirestoreErrors(
              (current) => ({
                ...current,
                profile:
                  'EXPLORER PROFILE SYNC OFFLINE',
              }),
            );
          },
        );

      /* -------------------------------------------------------------------- */
      /* Active treasures                                                     */
      /* -------------------------------------------------------------------- */

      const treasuresQuery =
        query(
          collection(
            db,
            'treasures',
          ),
          where(
            'isArchived',
            '==',
            false,
          ),
        );

      const unsubscribeTreasures =
        onSnapshot(
          treasuresQuery,

          (snapshot) => {
            const validTreasures:
              TreasureDocument[] =
              [];

            snapshot.forEach(
              (
                documentSnapshot,
              ) => {
                const data =
                  documentSnapshot.data() as
                    TreasureDocument;

                if (
                  !data?.location ||
                  !isValidCoordinate(
                    data.location
                      .latitude,
                    data.location
                      .longitude,
                  )
                ) {
                  return;
                }

                validTreasures.push({
                  ...data,

                  treasureId:
                    data.treasureId ||
                    documentSnapshot.id,
                });
              },
            );

            setAllTreasures(
              validTreasures,
            );

            setFirestoreErrors(
              (current) => ({
                ...current,
                treasures:
                  null,
              }),
            );
          },

          (error) => {
            logDevelopmentWarning(
              '[Treasi Dashboard] Treasure subscription failed:',
              error,
            );

            setFirestoreErrors(
              (current) => ({
                ...current,
                treasures:
                  'TREASURE FIELD SYNC OFFLINE',
              }),
            );
          },
        );

      /* -------------------------------------------------------------------- */
      /* Activity feed                                                        */
      /* -------------------------------------------------------------------- */

      const activityQuery =
        query(
          collection(
            db,
            'activity_feed',
          ),
          orderBy(
            'createdAt',
            'desc',
          ),
          limit(
            MAX_ACTIVITY_ITEMS,
          ),
        );

      const unsubscribeActivity =
        onSnapshot(
          activityQuery,

          (snapshot) => {
            const activities:
              ActivityFeedDocument[] =
              [];

            snapshot.forEach(
              (
                documentSnapshot,
              ) => {
                const data =
                  documentSnapshot.data() as
                    ActivityFeedDocument;

                activities.push({
                  ...data,

                  activityId:
                    data.activityId ||
                    documentSnapshot.id,
                });
              },
            );

            setActivityFeed(
              activities,
            );

            setIsLoadingActivity(
              false,
            );

            setFirestoreErrors(
              (current) => ({
                ...current,
                activity: null,
              }),
            );
          },

          (error) => {
            logDevelopmentWarning(
              '[Treasi Dashboard] Activity subscription failed:',
              error,
            );

            setActivityFeed(
              [],
            );

            setIsLoadingActivity(
              false,
            );

            setFirestoreErrors(
              (current) => ({
                ...current,
                activity:
                  'FIELD SIGNAL FEED OFFLINE',
              }),
            );
          },
        );

      return () => {
        unsubscribeUser();
        unsubscribeTreasures();
        unsubscribeActivity();
      };
    }, [
      currentUser?.uid,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Location subscription helpers                                         */
    /* ---------------------------------------------------------------------- */

    const removeLocationSubscription =
      useCallback(
        (): void => {
          try {
            locationSubscriptionRef.current?.remove();
          } catch {
            // Subscription may already be removed.
          }

          locationSubscriptionRef.current =
            null;
        },
        [],
      );

    const applyLocation =
      useCallback(
        (
          location:
            Location.LocationObject,
          source:
            LocationFixSource,
        ): void => {
          if (
            !isMountedRef.current
          ) {
            return;
          }

          const {
            latitude,
            longitude,
          } =
            location.coords;

          if (
            !isValidCoordinate(
              latitude,
              longitude,
            )
          ) {
            return;
          }

          setUserLocation(
            location,
          );

          setLocationFixSource(
            source,
          );

          setLocationError(
            null,
          );
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Location service                                                      */
    /* ---------------------------------------------------------------------- */

    const startLocationService =
      useCallback(
        async (
          requestPermission:
            boolean,
        ): Promise<void> => {
          const requestSequence =
            ++locationRequestSequenceRef.current;

          removeLocationSubscription();

          if (
            !isMountedRef.current
          ) {
            return;
          }

          setIsInitialisingLocation(
            true,
          );

          setLocationError(
            null,
          );

          try {
            /*
             * Browser location requires localhost or another secure context.
             */
            if (
              Platform.OS ===
                'web' &&
              typeof window !==
                'undefined' &&
              !window.isSecureContext
            ) {
              setUserLocation(
                null,
              );

              setLocationFixSource(
                'none',
              );

              setLocationError(
                'LOCATION REQUIRES HTTPS OR LOCALHOST IN YOUR BROWSER.',
              );

              setIsInitialisingLocation(
                false,
              );

              return;
            }

            /* ---------------------------------------------------------------- */
            /* Permission state                                                 */
            /* ---------------------------------------------------------------- */

            let permission =
              await Location.getForegroundPermissionsAsync();

            if (
              requestSequence !==
                locationRequestSequenceRef.current ||
              !isMountedRef.current
            ) {
              return;
            }

            setLocationPermissionStatus(
              permission.status,
            );

            setCanAskLocationAgain(
              permission.canAskAgain,
            );

            /*
             * Do not automatically re-prompt after onboarding.
             * A system prompt is only triggered after an explicit user action.
             */
            if (
              permission.status !==
                Location
                  .PermissionStatus
                  .GRANTED &&
              requestPermission &&
              permission.canAskAgain
            ) {
              permission =
                await Location.requestForegroundPermissionsAsync();

              if (
                requestSequence !==
                  locationRequestSequenceRef.current ||
                !isMountedRef.current
              ) {
                return;
              }

              setLocationPermissionStatus(
                permission.status,
              );

              setCanAskLocationAgain(
                permission.canAskAgain,
              );
            }

            if (
              permission.status !==
              Location
                .PermissionStatus
                .GRANTED
            ) {
              setUserLocation(
                null,
              );

              setLocationFixSource(
                'none',
              );

              setLocationError(
                permission.status ===
                  Location
                    .PermissionStatus
                    .DENIED
                  ? 'LOCATION ACCESS IS DENIED. ENABLE IT TO USE NEARBY CACHES AND LOCATION STAMPING.'
                  : 'LOCATION ACCESS IS NOT ENABLED. SELECT ENABLE LOCATION TO USE NEARBY FEATURES.',
              );

              setIsInitialisingLocation(
                false,
              );

              return;
            }

            /* ---------------------------------------------------------------- */
            /* Device location services                                         */
            /* ---------------------------------------------------------------- */

            const servicesEnabled =
              await Location.hasServicesEnabledAsync();

            if (
              requestSequence !==
                locationRequestSequenceRef.current ||
              !isMountedRef.current
            ) {
              return;
            }

            setLocationServicesEnabled(
              servicesEnabled,
            );

            if (
              !servicesEnabled
            ) {
              setUserLocation(
                null,
              );

              setLocationFixSource(
                'none',
              );

              setLocationError(
                'DEVICE LOCATION SERVICES ARE SWITCHED OFF.',
              );

              setIsInitialisingLocation(
                false,
              );

              return;
            }

            /* ---------------------------------------------------------------- */
            /* Fast cached position                                             */
            /* ---------------------------------------------------------------- */

            try {
              const cachedPosition =
                await Location.getLastKnownPositionAsync(
                  {
                    maxAge:
                      LOCATION_LAST_KNOWN_MAX_AGE_MS,

                    requiredAccuracy:
                      LOCATION_LAST_KNOWN_REQUIRED_ACCURACY_METRES,
                  },
                );

              if (
                requestSequence ===
                  locationRequestSequenceRef.current &&
                cachedPosition &&
                isValidCoordinate(
                  cachedPosition.coords
                    .latitude,
                  cachedPosition.coords
                    .longitude,
                )
              ) {
                applyLocation(
                  cachedPosition,
                  'cached',
                );
              }
            } catch (
              error: unknown
            ) {
              logDevelopmentWarning(
                '[Treasi Dashboard] Cached location unavailable:',
                error,
              );
            }

            /* ---------------------------------------------------------------- */
            /* Current position                                                 */
            /* ---------------------------------------------------------------- */

            try {
              const currentPosition =
                await Location.getCurrentPositionAsync(
                  {
                    accuracy:
                      Location
                        .Accuracy
                        .Balanced,
                  },
                );

              if (
                requestSequence ===
                  locationRequestSequenceRef.current &&
                currentPosition &&
                isValidCoordinate(
                  currentPosition.coords
                    .latitude,
                  currentPosition.coords
                    .longitude,
                )
              ) {
                applyLocation(
                  currentPosition,
                  'live',
                );
              }
            } catch (
              error: unknown
            ) {
              logDevelopmentWarning(
                '[Treasi Dashboard] Current location fix unavailable:',
                error,
              );
            }

            if (
              requestSequence !==
                locationRequestSequenceRef.current ||
              !isMountedRef.current
            ) {
              return;
            }

            /* ---------------------------------------------------------------- */
            /* Foreground location watcher                                      */
            /* ---------------------------------------------------------------- */

            const subscription =
              await Location.watchPositionAsync(
                {
                  accuracy:
                    Location
                      .Accuracy
                      .Balanced,

                  timeInterval:
                    5000,

                  distanceInterval:
                    15,
                },

                (
                  newLocation,
                ) => {
                  applyLocation(
                    newLocation,
                    'live',
                  );
                },

                (
                  message,
                ) => {
                  if (
                    !isMountedRef.current
                  ) {
                    return;
                  }

                  logDevelopmentWarning(
                    '[Treasi Dashboard] Location watcher reported an error:',
                    message,
                  );

                  setLocationError(
                    'LIVE LOCATION UPDATES WERE INTERRUPTED. RETRY LOCATION.',
                  );
                },
              );

            if (
              requestSequence !==
                locationRequestSequenceRef.current ||
              !isMountedRef.current
            ) {
              subscription.remove();

              return;
            }

            locationSubscriptionRef.current =
              subscription;

            setIsInitialisingLocation(
              false,
            );
          } catch (
            error: unknown
          ) {
            logDevelopmentWarning(
              '[Treasi Dashboard] Location service failed:',
              error,
            );

            if (
              requestSequence !==
                locationRequestSequenceRef.current ||
              !isMountedRef.current
            ) {
              return;
            }

            setLocationError(
              Platform.OS ===
                'web'
                ? 'BROWSER LOCATION COULD NOT BE STARTED.'
                : 'DEVICE LOCATION COULD NOT BE STARTED.',
            );

            setIsInitialisingLocation(
              false,
            );
          }
        },
        [
          applyLocation,
          removeLocationSubscription,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Location lifecycle                                                    */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      /*
       * The first check never triggers a new permission prompt.
       * Permission was already explained during onboarding.
       */
      void startLocationService(
        false,
      );

      const handleAppStateChange =
        (
          nextState:
            AppStateStatus,
        ): void => {
          if (
            nextState ===
            'active'
          ) {
            void startLocationService(
              false,
            );

            return;
          }

          locationRequestSequenceRef.current +=
            1;

          removeLocationSubscription();
        };

      const subscription =
        AppState.addEventListener(
          'change',
          handleAppStateChange,
        );

      return () => {
        subscription.remove();

        locationRequestSequenceRef.current +=
          1;

        removeLocationSubscription();
      };
    }, [
      removeLocationSubscription,
      startLocationService,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Location recovery                                                     */
    /* ---------------------------------------------------------------------- */

    const handleLocationRecovery =
      useCallback(
        async (): Promise<void> => {
          if (
            isInitialisingLocation
          ) {
            return;
          }

          if (
            Platform.OS !==
              'web' &&
            (
              locationServicesEnabled ===
                false ||
              (
                locationPermissionStatus ===
                  Location
                    .PermissionStatus
                    .DENIED &&
                !canAskLocationAgain
              )
            )
          ) {
            try {
              await Linking.openSettings();
            } catch (
              error: unknown
            ) {
              logDevelopmentWarning(
                '[Treasi Dashboard] Unable to open device settings:',
                error,
              );

              announceAlert(
                'SETTINGS UNAVAILABLE',
                'Open your device settings manually and enable foreground location access for Treasi.',
              );
            }

            return;
          }

          if (
            Platform.OS ===
              'web' &&
            locationPermissionStatus ===
              Location
                .PermissionStatus
                .DENIED &&
            !canAskLocationAgain
          ) {
            announceAlert(
              'BROWSER LOCATION BLOCKED',
              'Allow location for this site in your browser settings, then return to Treasi and select Retry Location.',
            );

            return;
          }

          await startLocationService(
            true,
          );
        },
        [
          canAskLocationAgain,
          isInitialisingLocation,
          locationPermissionStatus,
          locationServicesEnabled,
          startLocationService,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Nearby treasures                                                      */
    /* ---------------------------------------------------------------------- */

    const nearbyTreasures =
      useMemo(
        () => {
          /*
           * Without a real location, show the real active cache collection
           * rather than inventing proximity.
           */
          if (!userLocation) {
            return allTreasures;
          }

          const {
            latitude:
              userLatitude,
            longitude:
              userLongitude,
          } =
            userLocation.coords;

          if (
            !isValidCoordinate(
              userLatitude,
              userLongitude,
            )
          ) {
            return allTreasures;
          }

          return allTreasures.filter(
            (
              treasure,
            ) => {
              if (
                !treasure.location ||
                !isValidCoordinate(
                  treasure.location
                    .latitude,
                  treasure.location
                    .longitude,
                )
              ) {
                return false;
              }

              const distanceKm =
                calculateHaversineDistance(
                  userLatitude,
                  userLongitude,
                  treasure.location
                    .latitude,
                  treasure.location
                    .longitude,
                );

              return (
                distanceKm <=
                MAX_TREASURE_DISTANCE_KM
              );
            },
          );
        },
        [
          allTreasures,
          userLocation,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* FieldMap data                                                         */
    /* ---------------------------------------------------------------------- */

    const mapTreasures =
      useMemo<
        FieldMapTreasure[]
      >(
        () =>
          nearbyTreasures
            .filter(
              (
                treasure,
              ) =>
                Boolean(
                  treasure.treasureId,
                ) &&
                Boolean(
                  treasure.location,
                ) &&
                isValidCoordinate(
                  treasure.location
                    .latitude,
                  treasure.location
                    .longitude,
                ),
            )
            .map(
              (
                treasure,
              ) => ({
                id:
                  treasure.treasureId,

                title:
                  treasure.title ||
                  'TREASURE CACHE',

                creatorName:
                  treasure.creatorName,

                latitude:
                  treasure.location
                    .latitude,

                longitude:
                  treasure.location
                    .longitude,
              }),
            ),
        [
          nearbyTreasures,
        ],
      );

    const mapUserLocation =
      useMemo<FieldMapUserLocation | null>(
        () => {
          if (!userLocation) {
            return null;
          }

          const {
            latitude,
            longitude,
          } =
            userLocation.coords;

          if (
            !isValidCoordinate(
              latitude,
              longitude,
            )
          ) {
            return null;
          }

          return {
            latitude,
            longitude,
          };
        },
        [
          userLocation,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Map ready                                                             */
    /* ---------------------------------------------------------------------- */

    const handleMapReady =
      useCallback(
        (): void => {
          setIsMapReady(
            true,
          );
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Initial map positioning                                               */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        !isMapReady
      ) {
        return;
      }

      /*
       * A real user location always takes priority once it becomes available.
       */
      if (
        mapUserLocation &&
        !hasCentredOnUserRef.current
      ) {
        const userRegion:
          FieldMapRegion = {
            latitude:
              mapUserLocation.latitude,

            longitude:
              mapUserLocation.longitude,

            latitudeDelta:
              USER_REGION_DELTA,

            longitudeDelta:
              USER_REGION_DELTA,
          };

        mapRef.current?.setView(
          userRegion,
          false,
        );

        hasCentredOnUserRef.current =
          true;

        return;
      }

      /*
       * If location is unavailable, centre on a real treasure rather than
       * pretending a fallback coordinate represents the Explorer.
       */
      if (
        !mapUserLocation &&
        mapTreasures.length >
          0 &&
        !hasCentredOnTreasureRef.current
      ) {
        const firstTreasure =
          mapTreasures[0];

        const treasureRegion:
          FieldMapRegion = {
            latitude:
              firstTreasure.latitude,

            longitude:
              firstTreasure.longitude,

            latitudeDelta:
              TREASURE_REGION_DELTA,

            longitudeDelta:
              TREASURE_REGION_DELTA,
          };

        mapRef.current?.setView(
          treasureRegion,
          false,
        );

        hasCentredOnTreasureRef.current =
          true;
      }
    }, [
      isMapReady,
      mapTreasures,
      mapUserLocation,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Treasure marker selection                                             */
    /* ---------------------------------------------------------------------- */

    const handleTreasureMarkerPress =
      useCallback(
        (
          treasureId: string,
        ): void => {
          const treasure =
            allTreasures.find(
              (
                item,
              ) =>
                item.treasureId ===
                treasureId,
            );

          if (!treasure) {
            return;
          }

          setSelectedTreasure(
            treasure,
          );

          AccessibilityInfo
            .announceForAccessibility(
              `${treasure.title}. Treasure details opened.`,
            );
        },
        [
          allTreasures,
        ],
      );

    /*
     * Close the details if another client archives or removes the selected
     * treasure while the modal is open.
     */
    useEffect(() => {
      if (
        !selectedTreasure
      ) {
        return;
      }

      const stillAvailable =
        allTreasures.some(
          (
            treasure,
          ) =>
            treasure.treasureId ===
            selectedTreasure.treasureId,
        );

      if (
        !stillAvailable
      ) {
        setSelectedTreasure(
          null,
        );
      }
    }, [
      allTreasures,
      selectedTreasure,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Recentre map                                                          */
    /* ---------------------------------------------------------------------- */

    const handleRecenterMap =
      useCallback(
        (): void => {
          if (
            !mapUserLocation
          ) {
            announceAlert(
              'LOCATION UNAVAILABLE',
              'A current location is required before the map can centre on your position.',
            );

            return;
          }

          const targetRegion:
            FieldMapRegion = {
              latitude:
                mapUserLocation.latitude,

              longitude:
                mapUserLocation.longitude,

              latitudeDelta:
                USER_REGION_DELTA,

              longitudeDelta:
                USER_REGION_DELTA,
            };

          mapRef.current?.setView(
            targetRegion,
            !reduceMotionEnabled,
          );
        },
        [
          mapUserLocation,
          reduceMotionEnabled,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Location stamping                                                     */
    /* ---------------------------------------------------------------------- */

    const canStampLocation =
      Boolean(
        userLocation &&
          mapUserLocation &&
          locationFixSource ===
            'live' &&
          !isInitialisingLocation,
      );

    const handleStampLocation =
      useCallback(
        (): void => {
          if (
            isNavigatingRef.current
          ) {
            return;
          }

          if (
            !userLocation ||
            !mapUserLocation ||
            locationFixSource !==
              'live'
          ) {
            announceAlert(
              'CURRENT LOCATION REQUIRED',
              'Wait for a live location fix before stamping a new treasure position.',
            );

            return;
          }

          const {
            latitude,
            longitude,
            accuracy,
          } =
            userLocation.coords;

          if (
            !isValidCoordinate(
              latitude,
              longitude,
            )
          ) {
            announceAlert(
              'INVALID LOCATION',
              'The current coordinates could not be validated.',
            );

            return;
          }

          const locationAge =
            Math.max(
              0,
              Date.now() -
                userLocation.timestamp,
            );

          if (
            locationAge >
            MAX_STAMP_LOCATION_AGE_MS
          ) {
            announceAlert(
              'LOCATION TOO OLD',
              'Treasi needs a newer location fix before creating a treasure. Retry location and wait for an updated position.',
            );

            return;
          }

          const navigateToCreate =
            (): void => {
              safeNavigate(
                'INVENTORY',
                {
                  mode:
                    'create',

                  latitude:
                    Number(
                      latitude.toFixed(
                        6,
                      ),
                    ),

                  longitude:
                    Number(
                      longitude.toFixed(
                        6,
                      ),
                    ),
                },
              );
            };

          if (
            typeof accuracy ===
              'number' &&
            Number.isFinite(
              accuracy,
            ) &&
            accuracy >
              GPS_ACCURACY_WARNING_METRES
          ) {
            AccessibilityInfo
              .announceForAccessibility(
                `Location accuracy is approximately plus or minus ${Math.round(
                  accuracy,
                )} metres.`,
              );

            Alert.alert(
              'LOW LOCATION ACCURACY',
              `The current location accuracy is approximately ±${Math.round(
                accuracy,
              )} m. Create the treasure at this position anyway?`,
              [
                {
                  text:
                    'CANCEL',
                  style:
                    'cancel',
                },
                {
                  text:
                    'STAMP ANYWAY',
                  onPress:
                    navigateToCreate,
                },
              ],
            );

            return;
          }

          navigateToCreate();
        },
        [
          locationFixSource,
          mapUserLocation,
          safeNavigate,
          userLocation,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Archive treasure                                                      */
    /* ---------------------------------------------------------------------- */

    const handleArchiveTreasure =
      useCallback(
        async (
          treasureId: string,
        ): Promise<void> => {
          if (
            !currentUser ||
            !treasureId ||
            isArchiving
          ) {
            return;
          }

          const treasure =
            allTreasures.find(
              (
                item,
              ) =>
                item.treasureId ===
                treasureId,
            );

          if (
            !treasure ||
            treasure.creatorId !==
              currentUser.uid
          ) {
            announceAlert(
              'ACTION NOT ALLOWED',
              'Only the Explorer who created this treasure can archive it.',
            );

            return;
          }

          setIsArchiving(
            true,
          );

          try {
            const treasureReference =
              doc(
                db,
                'treasures',
                treasureId,
              );

            const activityReference =
              doc(
                collection(
                  db,
                  'activity_feed',
                ),
              );

            const username =
              (
                userData?.username ||
                currentUser.displayName ||
                currentUser.email
                  ?.split('@')[0] ||
                'EXPLORER'
              )
                .trim()
                .slice(
                  0,
                  100,
                );

            const safeUsername =
              username ||
              'EXPLORER';

            const treasureTitle =
              (
                treasure.title ||
                'TREASURE CACHE'
              )
                .trim()
                .slice(
                  0,
                  80,
                );

            const batch =
              writeBatch(
                db,
              );

            /*
             * updatedAt is included so the write remains consistent with the
             * hardened treasure rules and the rest of the CRUD workflow.
             */
            batch.update(
              treasureReference,
              {
                isArchived:
                  true,

                updatedAt:
                  serverTimestamp(),
              },
            );

            /*
             * Record the real archive event atomically with the treasure update.
             */
            batch.set(
              activityReference,
              {
                userId:
                  currentUser.uid,

                username:
                  safeUsername,

                type:
                  'TREASURE_ARCHIVED',

                message:
                  `ARCHIVED CACHE: ${treasureTitle}`,

                targetId:
                  treasureId,

                createdAt:
                  serverTimestamp(),
              },
            );

            await batch.commit();

            if (
              !isMountedRef.current
            ) {
              return;
            }

            setSelectedTreasure(
              null,
            );

            AccessibilityInfo
              .announceForAccessibility(
                'Treasure cache archived successfully.',
              );

            Alert.alert(
              'CACHE ARCHIVED',
              'The treasure has been removed from the active field map.',
            );
          } catch (
            error: unknown
          ) {
            logDevelopmentWarning(
              '[Treasi Dashboard] Archive failed:',
              error,
            );

            if (
              isMountedRef.current
            ) {
              announceAlert(
                'ARCHIVE FAILED',
                'Treasi could not archive this treasure. Check your connection and try again.',
              );
            }
          } finally {
            if (
              isMountedRef.current
            ) {
              setIsArchiving(
                false,
              );
            }
          }
        },
        [
          allTreasures,
          currentUser,
          isArchiving,
          userData?.username,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Activity display name                                                 */
    /* ---------------------------------------------------------------------- */

    const getDisplayUsername =
      useCallback(
        (
          item:
            ActivityFeedDocument,
        ): string => {
          if (
            item.userId ===
            currentUser?.uid
          ) {
            return normaliseUsername(
              userData?.username ||
                currentUser
                  ?.displayName ||
                currentUser?.email
                  ?.split('@')[0],
              'YOU',
            );
          }

          return normaliseUsername(
            item.username,
          );
        },
        [
          currentUser?.displayName,
          currentUser?.email,
          currentUser?.uid,
          userData?.username,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Selected treasure distance                                            */
    /* ---------------------------------------------------------------------- */

    const selectedDistance =
      useMemo(
        () => {
          if (
            !selectedTreasure ||
            !userLocation ||
            !selectedTreasure.location
          ) {
            return null;
          }

          const {
            latitude:
              userLatitude,
            longitude:
              userLongitude,
          } =
            userLocation.coords;

          const {
            latitude:
              treasureLatitude,
            longitude:
              treasureLongitude,
          } =
            selectedTreasure.location;

          if (
            !isValidCoordinate(
              userLatitude,
              userLongitude,
            ) ||
            !isValidCoordinate(
              treasureLatitude,
              treasureLongitude,
            )
          ) {
            return null;
          }

          return calculateHaversineDistance(
            userLatitude,
            userLongitude,
            treasureLatitude,
            treasureLongitude,
          );
        },
        [
          selectedTreasure,
          userLocation,
        ],
      );

    const isSelectedTreasureCreator =
      Boolean(
        selectedTreasure &&
          currentUser?.uid &&
          selectedTreasure.creatorId ===
            currentUser.uid,
      );

    /* ---------------------------------------------------------------------- */
    /* Firestore status                                                      */
    /* ---------------------------------------------------------------------- */

    const firestoreErrorText =
      useMemo(
        () =>
          [
            firestoreErrors.profile,
            firestoreErrors.treasures,
            firestoreErrors.activity,
          ]
            .filter(
              (
                value,
              ): value is string =>
                Boolean(
                  value,
                ),
            )
            .join(
              ' · ',
            ),
        [
          firestoreErrors,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Location status                                                       */
    /* ---------------------------------------------------------------------- */

    const locationStatusText =
      useMemo(
        () => {
          if (
            isInitialisingLocation
          ) {
            return 'CHECKING LOCATION...';
          }

          if (
            locationServicesEnabled ===
            false
          ) {
            return 'LOCATION SERVICES OFF';
          }

          if (
            locationPermissionStatus &&
            locationPermissionStatus !==
              Location
                .PermissionStatus
                .GRANTED
          ) {
            return 'LOCATION ACCESS REQUIRED';
          }

          if (
            !userLocation
          ) {
            return 'LOCATION UNAVAILABLE';
          }

          if (
            locationFixSource ===
            'cached'
          ) {
            return 'CACHED POSITION · WAITING FOR CURRENT FIX';
          }

          const accuracy =
            userLocation.coords
              .accuracy;

          if (
            typeof accuracy ===
              'number' &&
            Number.isFinite(
              accuracy,
            )
          ) {
            return `LOCATION ±${Math.round(
              accuracy,
            )} M`;
          }

          return 'LOCATION READY';
        },
        [
          isInitialisingLocation,
          locationFixSource,
          locationPermissionStatus,
          locationServicesEnabled,
          userLocation,
        ],
      );

    const locationActionLabel =
      useMemo(
        () => {
          if (
            isInitialisingLocation
          ) {
            return 'CHECKING';
          }

          if (
            Platform.OS !==
              'web' &&
            (
              locationServicesEnabled ===
                false ||
              (
                locationPermissionStatus ===
                  Location
                    .PermissionStatus
                    .DENIED &&
                !canAskLocationAgain
              )
            )
          ) {
            return 'OPEN SETTINGS';
          }

          if (
            locationPermissionStatus !==
            Location
              .PermissionStatus
              .GRANTED
          ) {
            return 'ENABLE LOCATION';
          }

          return 'RETRY LOCATION';
        },
        [
          canAskLocationAgain,
          isInitialisingLocation,
          locationPermissionStatus,
          locationServicesEnabled,
        ],
      );

    const nearbyRangeText =
      userLocation
        ? `${nearbyTreasures.length} ACTIVE ${
            nearbyTreasures.length ===
            1
              ? 'CACHE'
              : 'CACHES'
          } WITHIN ${MAX_TREASURE_DISTANCE_KM} KM`
        : `${nearbyTreasures.length} ACTIVE ${
            nearbyTreasures.length ===
            1
              ? 'CACHE'
              : 'CACHES'
          } · LOCATION NOT APPLIED`;

    /* ---------------------------------------------------------------------- */
    /* Stamp animation                                                       */
    /* ---------------------------------------------------------------------- */

    const handleStampPressIn =
      (): void => {
        if (
          reduceMotionEnabled ||
          !canStampLocation
        ) {
          return;
        }

        Animated.spring(
          stampButtonScale,
          {
            toValue: 0.97,
            damping: 18,
            stiffness: 220,
            mass: 0.75,
            useNativeDriver:
              true,
          },
        ).start();
      };

    const handleStampPressOut =
      (): void => {
        if (
          reduceMotionEnabled
        ) {
          stampButtonScale.setValue(
            1,
          );

          return;
        }

        Animated.spring(
          stampButtonScale,
          {
            toValue: 1,
            damping: 18,
            stiffness: 220,
            mass: 0.75,
            useNativeDriver:
              true,
          },
        ).start();
      };

    /* ---------------------------------------------------------------------- */
    /* Render                                                                */
    /* ---------------------------------------------------------------------- */

    return (
      <View
        style={[
          styles.container,
          {
            flexDirection:
              isLandscape
                ? 'row'
                : 'column',

            paddingLeft:
              isLandscape
                ? Math.max(
                    insets.left,
                    12,
                  )
                : 0,

            paddingRight:
              isLandscape
                ? Math.max(
                    insets.right,
                    12,
                  )
                : 0,

            paddingTop:
              isLandscape
                ? Math.max(
                    insets.top,
                    0,
                  )
                : Math.max(
                    insets.top,
                    12,
                  ),

            paddingBottom:
              isLandscape
                ? Math.max(
                    insets.bottom,
                    0,
                  )
                : Math.max(
                    insets.bottom,
                    6,
                  ),
          },
        ]}
      >
        {/* ------------------------------------------------------------------ */}
        {/* Field map                                                          */}
        {/* ------------------------------------------------------------------ */}

        <View
          style={
            isLandscape
              ? styles.leftViewportLandscape
              : styles.leftViewportPortrait
          }
        >
          <FieldMap
            ref={
              mapRef
            }
            initialRegion={
              FALLBACK_REGION
            }
            userLocation={
              mapUserLocation
            }
            treasures={
              mapTreasures
            }
            onTreasurePress={
              handleTreasureMarkerPress
            }
            onReady={
              handleMapReady
            }
          />

          {/* --------------------------------------------------------------- */}
          {/* North indicator                                                  */}
          {/* --------------------------------------------------------------- */}

          <View
            accessible={
              false
            }
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={
              styles.compassOverlay
            }
          >
            <Ionicons
              name="compass-outline"
              size={18}
              color={
                COLOURS.ink900
              }
            />

            <Text
              style={
                styles.compassText
              }
            >
              N
            </Text>
          </View>

          {/* --------------------------------------------------------------- */}
          {/* Range indicator                                                  */}
          {/* --------------------------------------------------------------- */}

          <View
            accessible
            accessibilityLabel={
              userLocation
                ? `${nearbyTreasures.length} active treasure caches within ${MAX_TREASURE_DISTANCE_KM} kilometres.`
                : `${nearbyTreasures.length} active treasure caches available. A location fix is required before Treasi can calculate nearby distance.`
            }
            style={
              styles.radiusBadge
            }
          >
            <MaterialCommunityIcons
              accessible={
                false
              }
              importantForAccessibility="no"
              name="radar"
              size={15}
              color={
                COLOURS.ink900
              }
            />

            <Text
              maxFontSizeMultiplier={
                1.5
              }
              numberOfLines={
                2
              }
              style={
                styles.radiusBadgeText
              }
            >
              {
                nearbyRangeText
              }
            </Text>
          </View>

          {/* --------------------------------------------------------------- */}
          {/* Recentre                                                        */}
          {/* --------------------------------------------------------------- */}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Recentre map on my location"
            accessibilityHint="Moves the field map back to your current position."
            accessibilityState={{
              disabled:
                !mapUserLocation,
            }}
            disabled={
              !mapUserLocation
            }
            hitSlop={4}
            onPress={
              handleRecenterMap
            }
            style={({
              pressed,
            }) => [
              styles.recenterButton,

              !mapUserLocation &&
                styles.mapControlDisabled,

              pressed &&
                mapUserLocation &&
                styles.mapControlPressed,
            ]}
          >
            <Ionicons
              name="locate-sharp"
              size={20}
              color={
                COLOURS.ink900
              }
            />
          </Pressable>

          {/* --------------------------------------------------------------- */}
          {/* Live location status                                             */}
          {/* --------------------------------------------------------------- */}

          <Animated.View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={`Location status. ${locationStatusText}`}
            style={[
              styles.locationBadge,
              {
                opacity:
                  locationPulseOpacity,
              },
            ]}
          >
            <Ionicons
              accessible={
                false
              }
              importantForAccessibility="no"
              name="radio-sharp"
              size={14}
              color={
                locationFixSource ===
                'live'
                  ? COLOURS.rust700
                  : COLOURS.bronze700
              }
            />

            <Text
              maxFontSizeMultiplier={
                1.5
              }
              numberOfLines={
                2
              }
              style={
                styles.locationBadgeText
              }
            >
              {
                locationStatusText
              }
            </Text>
          </Animated.View>

          {/* --------------------------------------------------------------- */}
          {/* Location recovery                                                */}
          {/* --------------------------------------------------------------- */}

          {locationError ? (
            <View
              accessible
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={
                styles.mapErrorBanner
              }
            >
              <Ionicons
                accessible={
                  false
                }
                importantForAccessibility="no"
                name="warning-outline"
                size={18}
                color={
                  COLOURS.parchment100
                }
              />

              <Text
                maxFontSizeMultiplier={
                  1.6
                }
                style={
                  styles.mapErrorText
                }
              >
                {
                  locationError
                }
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  locationActionLabel
                }
                accessibilityHint="Attempts to restore location access for Treasi."
                accessibilityState={{
                  disabled:
                    isInitialisingLocation,
                  busy:
                    isInitialisingLocation,
                }}
                disabled={
                  isInitialisingLocation
                }
                onPress={() => {
                  void handleLocationRecovery();
                }}
                style={({
                  pressed,
                }) => [
                  styles.retryButton,

                  pressed &&
                    !isInitialisingLocation &&
                    styles.retryButtonPressed,
                ]}
              >
                {isInitialisingLocation ? (
                  <ActivityIndicator
                    size="small"
                    color={
                      COLOURS.ink900
                    }
                  />
                ) : (
                  <Text
                    style={
                      styles.retryButtonText
                    }
                  >
                    {
                      locationActionLabel
                    }
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}

          {/* --------------------------------------------------------------- */}
          {/* Startup status                                                   */}
          {/* --------------------------------------------------------------- */}

          {(
            isInitialisingLocation ||
            !isMapReady
          ) ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLiveRegion="polite"
              accessibilityLabel={
                !isMapReady
                  ? 'Loading field map.'
                  : 'Checking current location.'
              }
              pointerEvents="none"
              style={
                styles.loadingContainer
              }
            >
              <ActivityIndicator
                size="small"
                color={
                  COLOURS.rust700
                }
              />

              <Text
                style={
                  styles.loadingText
                }
              >
                {!isMapReady
                  ? 'MAP'
                  : 'LOCATION'}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ------------------------------------------------------------------ */}
        {/* Command console                                                    */}
        {/* ------------------------------------------------------------------ */}

        <View
          style={
            isLandscape
              ? styles.rightViewportLandscape
              : styles.rightViewportPortrait
          }
        >
          {/* --------------------------------------------------------------- */}
          {/* Firestore errors                                                 */}
          {/* --------------------------------------------------------------- */}

          {firestoreErrorText ? (
            <View
              accessible
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={
                styles.firestoreErrorCard
              }
            >
              <Ionicons
                accessible={
                  false
                }
                importantForAccessibility="no"
                name="cloud-offline-outline"
                size={16}
                color={
                  COLOURS.parchment100
                }
              />

              <Text
                maxFontSizeMultiplier={
                  1.6
                }
                style={
                  styles.firestoreErrorText
                }
              >
                {
                  firestoreErrorText
                }
              </Text>
            </View>
          ) : null}

          {/* --------------------------------------------------------------- */}
          {/* Explorer score                                                   */}
          {/* --------------------------------------------------------------- */}

          <View
            accessible
            accessibilityLabel={`${(
              userData?.totalPoints ??
              0
            ).toLocaleString()} points. ${getRankTitle(
              userData?.totalPoints ??
                0,
            ).replace(
              'RANK: ',
              '',
            )}.`}
            style={
              styles.statusCard
            }
          >
            <View
              accessible={
                false
              }
              importantForAccessibility="no-hide-descendants"
              style={
                styles.statusHeaderRow
              }
            >
              <MaterialCommunityIcons
                name="star-four-points"
                size={13}
                color={
                  COLOURS.bronze700
                }
              />

              <Text
                style={
                  styles.statusHeader
                }
              >
                FIELD STATUS
              </Text>

              <MaterialCommunityIcons
                name="star-four-points"
                size={13}
                color={
                  COLOURS.bronze700
                }
              />
            </View>

            <View
              accessible={
                false
              }
              importantForAccessibility="no-hide-descendants"
              style={
                styles.scoreRow
              }
            >
              <Text
                style={
                  styles.scoreText
                }
              >
                {(
                  userData?.totalPoints ??
                  0
                ).toLocaleString()}
              </Text>

              <Text
                style={
                  styles.pointsText
                }
              >
                PTS
              </Text>
            </View>

            <Text
              accessible={
                false
              }
              importantForAccessibility="no"
              maxFontSizeMultiplier={
                1.5
              }
              style={
                styles.rankText
              }
            >
              {getRankTitle(
                userData?.totalPoints ??
                  0,
              )}
            </Text>
          </View>

          {/* --------------------------------------------------------------- */}
          {/* Recent activity                                                  */}
          {/* --------------------------------------------------------------- */}

          <View
            style={
              styles.signalsContainer
            }
          >
            <View
              style={
                styles.sectionHeaderRow
              }
            >
              <MaterialCommunityIcons
                accessible={
                  false
                }
                importantForAccessibility="no"
                name="radio-handheld"
                size={16}
                color={
                  COLOURS.bronze400
                }
              />

              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={
                  1.5
                }
                style={
                  styles.sectionTitle
                }
              >
                RECENT SIGNALS
              </Text>
            </View>

            {isLoadingActivity ? (
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="Loading recent field signals"
                style={
                  styles.feedLoading
                }
              >
                <ActivityIndicator
                  size="small"
                  color={
                    COLOURS.bronze400
                  }
                />
              </View>
            ) : activityFeed.length ===
              0 ? (
              <View
                accessible
                accessibilityLabel="No recent field signals."
                style={
                  styles.emptyFeedBox
                }
              >
                <Text
                  maxFontSizeMultiplier={
                    1.5
                  }
                  style={
                    styles.emptyFeedText
                  }
                >
                  NO FIELD SIGNALS DETECTED
                </Text>
              </View>
            ) : (
              <ScrollView
                style={
                  styles.signalsScroll
                }
                contentContainerStyle={
                  styles.signalsScrollContent
                }
                showsVerticalScrollIndicator={
                  false
                }
              >
                {activityFeed.map(
                  (
                    item,
                    index,
                  ) => {
                    const username =
                      getDisplayUsername(
                        item,
                      );

                    const relativeTime =
                      formatRelativeTime(
                        item.createdAt,
                      );

                    const message =
                      item.message?.trim() ||
                      'FIELD SIGNAL RECEIVED';

                    return (
                      <View
                        key={
                          item.activityId ||
                          `activity-${index}`
                        }
                        accessible
                        accessibilityLabel={`${username}. ${message}. ${relativeTime}.`}
                        style={
                          styles.signalCard
                        }
                      >
                        <View
                          accessible={
                            false
                          }
                          importantForAccessibility="no-hide-descendants"
                          style={
                            styles.signalHeader
                          }
                        >
                          <View
                            style={
                              styles.authorRow
                            }
                          >
                            <Ionicons
                              name="radio-outline"
                              size={14}
                              color={
                                COLOURS.rust700
                              }
                            />

                            <Text
                              numberOfLines={
                                1
                              }
                              style={
                                styles.signalAuthor
                              }
                            >
                              {
                                username
                              }
                            </Text>
                          </View>

                          <Text
                            style={
                              styles.signalTimeTag
                            }
                          >
                            {
                              relativeTime
                            }
                          </Text>
                        </View>

                        <Text
                          accessible={
                            false
                          }
                          importantForAccessibility="no"
                          maxFontSizeMultiplier={
                            1.7
                          }
                          style={
                            styles.signalBody
                          }
                        >
                          {
                            message
                          }
                        </Text>
                      </View>
                    );
                  },
                )}
              </ScrollView>
            )}
          </View>

          {/* --------------------------------------------------------------- */}
          {/* Stamp current location                                           */}
          {/* --------------------------------------------------------------- */}

          <Animated.View
            style={{
              transform: [
                {
                  scale:
                    stampButtonScale,
                },
              ],
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stamp current location"
              accessibilityHint={
                canStampLocation
                  ? 'Uses your current live position to start creating a new treasure.'
                  : 'A current live location fix is required before a treasure position can be stamped.'
              }
              accessibilityState={{
                disabled:
                  !canStampLocation,
              }}
              disabled={
                !canStampLocation
              }
              onPressIn={
                handleStampPressIn
              }
              onPressOut={
                handleStampPressOut
              }
              onPress={
                handleStampLocation
              }
              style={({
                pressed,
              }) => [
                styles.stampButton,

                !canStampLocation &&
                  styles.stampButtonDisabled,

                pressed &&
                  canStampLocation &&
                  styles.stampButtonPressed,
              ]}
            >
              <Ionicons
                accessible={
                  false
                }
                importantForAccessibility="no"
                name="location-outline"
                size={19}
                color={
                  COLOURS.parchment100
                }
              />

              <Text
                maxFontSizeMultiplier={
                  1.5
                }
                style={
                  styles.stampButtonText
                }
              >
                STAMP LOCATION
              </Text>
            </Pressable>
          </Animated.View>

          <FieldNavBar
            currentTab="MAP"
            onNavigate={
              onNavigate
            }
          />
        </View>

        {/* ------------------------------------------------------------------ */}
        {/* Treasure details                                                   */}
        {/* ------------------------------------------------------------------ */}

        <Modal
          visible={
            Boolean(
              selectedTreasure,
            )
          }
          transparent
          animationType={
            reduceMotionEnabled
              ? 'none'
              : 'fade'
          }
          onRequestClose={() =>
            setSelectedTreasure(
              null,
            )
          }
        >
          <View
            style={
              styles.modalOverlay
            }
          >
            <View
              accessible
              accessibilityViewIsModal
              onAccessibilityEscape={() =>
                setSelectedTreasure(
                  null,
                )
              }
              style={
                styles.modalCard
              }
            >
              <View
                style={
                  styles.modalHeaderRow
                }
              >
                <MaterialCommunityIcons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="treasure-chest"
                  size={22}
                  color={
                    COLOURS.rust700
                  }
                />

                <Text
                  accessibilityRole="header"
                  maxFontSizeMultiplier={
                    1.6
                  }
                  numberOfLines={
                    2
                  }
                  style={
                    styles.modalTitle
                  }
                >
                  {normaliseUsername(
                    selectedTreasure
                      ?.title,
                    'TREASURE CACHE',
                  )}
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close treasure details"
                  hitSlop={4}
                  onPress={() =>
                    setSelectedTreasure(
                      null,
                    )
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.modalCloseIconButton,

                    pressed &&
                      styles.modalLightButtonPressed,
                  ]}
                >
                  <Ionicons
                    name="close-sharp"
                    size={22}
                    color={
                      COLOURS.ink900
                    }
                  />
                </Pressable>
              </View>

              <View
                style={
                  styles.modalDivider
                }
              />

              <ScrollView
                style={
                  styles.modalScrollBody
                }
                contentContainerStyle={
                  styles.modalScrollContent
                }
                showsVerticalScrollIndicator={
                  false
                }
              >
                <View
                  style={
                    styles.modalMetaRow
                  }
                >
                  <Ionicons
                    accessible={
                      false
                    }
                    importantForAccessibility="no"
                    name="person-outline"
                    size={15}
                    color={
                      COLOURS.bronze700
                    }
                  />

                  <Text
                    style={
                      styles.modalMetaLabel
                    }
                  >
                    CREATOR:
                  </Text>

                  <Text
                    maxFontSizeMultiplier={
                      1.6
                    }
                    style={
                      styles.modalMetaValue
                    }
                  >
                    {selectedTreasure
                      ?.creatorName ||
                      'UNKNOWN EXPLORER'}
                  </Text>
                </View>

                <View
                  style={
                    styles.modalMetaRow
                  }
                >
                  <Ionicons
                    accessible={
                      false
                    }
                    importantForAccessibility="no"
                    name="navigate-outline"
                    size={15}
                    color={
                      COLOURS.bronze700
                    }
                  />

                  <Text
                    style={
                      styles.modalMetaLabel
                    }
                  >
                    DISTANCE:
                  </Text>

                  <Text
                    maxFontSizeMultiplier={
                      1.6
                    }
                    style={
                      styles.modalMetaValue
                    }
                  >
                    {selectedDistance !==
                    null
                      ? formatDistanceText(
                          selectedDistance,
                        )
                      : 'CURRENT LOCATION REQUIRED'}
                  </Text>
                </View>

                {selectedTreasure
                  ?.location &&
                isValidCoordinate(
                  selectedTreasure
                    .location
                    .latitude,
                  selectedTreasure
                    .location
                    .longitude,
                ) ? (
                  <View
                    style={
                      styles.modalMetaRow
                    }
                  >
                    <Ionicons
                      accessible={
                        false
                      }
                      importantForAccessibility="no"
                      name="location-outline"
                      size={15}
                      color={
                        COLOURS.bronze700
                      }
                    />

                    <Text
                      style={
                        styles.modalMetaLabel
                      }
                    >
                      COORDINATES:
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.6
                      }
                      style={
                        styles.modalMetaValue
                      }
                    >
                      {`${selectedTreasure.location.latitude.toFixed(
                        5,
                      )}, ${selectedTreasure.location.longitude.toFixed(
                        5,
                      )}`}
                    </Text>
                  </View>
                ) : null}

                {selectedTreasure
                  ?.hint?.trim() ? (
                  <View
                    style={
                      styles.modalHintBox
                    }
                  >
                    <Text
                      style={
                        styles.modalHintTitle
                      }
                    >
                      CACHE HINT
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.8
                      }
                      style={
                        styles.modalHintText
                      }
                    >
                      {
                        selectedTreasure.hint
                      }
                    </Text>
                  </View>
                ) : null}

                {selectedTreasure
                  ?.imageUrl?.trim() ? (
                  <Image
                    accessibilityLabel={`${selectedTreasure.title || 'Treasure'} cache image`}
                    source={{
                      uri:
                        selectedTreasure.imageUrl,
                    }}
                    style={
                      styles.modalTreasureImage
                    }
                    resizeMode="cover"
                  />
                ) : null}
              </ScrollView>

              <View
                style={
                  styles.modalActionsRow
                }
              >
                {isSelectedTreasureCreator ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      isArchiving
                        ? 'Archiving treasure'
                        : 'Archive treasure'
                    }
                    accessibilityHint="Removes this treasure from the active field map without deleting its discovery history."
                    accessibilityState={{
                      disabled:
                        isArchiving,
                      busy:
                        isArchiving,
                    }}
                    disabled={
                      isArchiving
                    }
                    onPress={() => {
                      const treasureId =
                        selectedTreasure
                          ?.treasureId;

                      if (
                        !treasureId
                      ) {
                        return;
                      }

                      AccessibilityInfo
                        .announceForAccessibility(
                          'Archive confirmation.',
                        );

                      Alert.alert(
                        'ARCHIVE TREASURE',
                        'Remove this treasure from the active field map? Existing discovery history will be preserved.',
                        [
                          {
                            text:
                              'CANCEL',
                            style:
                              'cancel',
                          },

                          {
                            text:
                              'ARCHIVE',
                            style:
                              'destructive',

                            onPress:
                              () => {
                                void handleArchiveTreasure(
                                  treasureId,
                                );
                              },
                          },
                        ],
                      );
                    }}
                    style={({
                      pressed,
                    }) => [
                      styles.modalActionButton,
                      styles.modalArchiveButton,

                      isArchiving &&
                        styles.modalButtonDisabled,

                      pressed &&
                        !isArchiving &&
                        styles.modalDarkButtonPressed,
                    ]}
                  >
                    {isArchiving ? (
                      <ActivityIndicator
                        size="small"
                        color={
                          COLOURS.parchment100
                        }
                      />
                    ) : (
                      <>
                        <Ionicons
                          accessible={
                            false
                          }
                          importantForAccessibility="no"
                          name="archive-outline"
                          size={17}
                          color={
                            COLOURS.parchment100
                          }
                        />

                        <Text
                          style={
                            styles.modalButtonText
                          }
                        >
                          ARCHIVE CACHE
                        </Text>
                      </>
                    )}
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Track treasure in Hunt"
                    accessibilityHint="Opens the Hunt screen with this treasure selected."
                    onPress={() => {
                      const target =
                        selectedTreasure;

                      if (
                        !target ||
                        !target.treasureId ||
                        !target.location
                      ) {
                        return;
                      }

                      setSelectedTreasure(
                        null,
                      );

                      safeNavigate(
                        'HUNT',
                        {
                          treasureId:
                            target.treasureId,

                          mode:
                            'hunt',

                          latitude:
                            target.location
                              .latitude,

                          longitude:
                            target.location
                              .longitude,
                        },
                      );
                    }}
                    style={({
                      pressed,
                    }) => [
                      styles.modalActionButton,
                      styles.modalTrackButton,

                      pressed &&
                        styles.modalDarkButtonPressed,
                    ]}
                  >
                    <Ionicons
                      accessible={
                        false
                      }
                      importantForAccessibility="no"
                      name="compass-outline"
                      size={17}
                      color={
                        COLOURS.parchment100
                      }
                    />

                    <Text
                      style={
                        styles.modalButtonText
                      }
                    >
                      TRACK IN HUNT
                    </Text>
                  </Pressable>
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss treasure details"
                  onPress={() =>
                    setSelectedTreasure(
                      null,
                    )
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.modalActionButton,
                    styles.modalDismissButton,

                    pressed &&
                      styles.modalLightButtonPressed,
                  ]}
                >
                  <Text
                    style={
                      styles.modalDismissButtonText
                    }
                  >
                    DISMISS
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  };

export default DashboardScreen;

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

    /* ---------------------------------------------------------------------- */
    /* Layout                                                                */
    /* ---------------------------------------------------------------------- */

    leftViewportLandscape: {
      flex: 0.6,
      position:
        'relative',
      backgroundColor:
        COLOURS.parchment200,
      borderRightWidth: 3,
      borderRightColor:
        COLOURS.bronze500,
      overflow:
        'hidden',
    },

    leftViewportPortrait: {
      height: '45%',
      position:
        'relative',
      backgroundColor:
        COLOURS.parchment200,
      borderBottomWidth: 3,
      borderBottomColor:
        COLOURS.bronze500,
      overflow:
        'hidden',
    },

    rightViewportLandscape: {
      flex: 0.4,
      minWidth: 0,
      backgroundColor:
        COLOURS.forest800,
      padding: 12,
      justifyContent:
        'space-between',
    },

    rightViewportPortrait: {
      flex: 1,
      minHeight: 0,
      backgroundColor:
        COLOURS.forest800,
      padding: 12,
      justifyContent:
        'space-between',
    },

    /* ---------------------------------------------------------------------- */
    /* Map overlays                                                          */
    /* ---------------------------------------------------------------------- */

    loadingContainer: {
      position:
        'absolute',
      bottom: 70,
      right: 14,
      minWidth: 48,
      minHeight: 48,
      paddingHorizontal: 8,
      paddingVertical: 6,
      alignItems:
        'center',
      justifyContent:
        'center',
      backgroundColor:
        COLOURS.parchment100,
      borderRadius: 24,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
    },

    loadingText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 7.5,
      lineHeight: 11,
      marginTop: 2,
    },

    compassOverlay: {
      position:
        'absolute',
      top: 12,
      left: 12,
      minHeight: 38,
      paddingHorizontal: 10,
      paddingVertical: 5,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 5,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1,
      borderColor:
        COLOURS.ink900,
      borderRadius: 20,
    },

    compassText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 13,
      lineHeight: 18,
      fontWeight:
        '800',
    },

    radiusBadge: {
      position:
        'absolute',
      bottom: 12,
      left: 12,
      maxWidth: '66%',
      minHeight: 40,
      paddingHorizontal: 9,
      paddingVertical: 6,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 6,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 4,
    },

    radiusBadgeText: {
      flexShrink: 1,
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight:
        '800',
      letterSpacing: 0.45,
    },

    recenterButton: {
      position:
        'absolute',
      bottom: 12,
      right: 12,
      width: 48,
      height: 48,
      alignItems:
        'center',
      justifyContent:
        'center',
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1.5,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 24,

      shadowColor:
        '#000000',

      shadowOpacity: 0.18,

      shadowRadius: 4,

      shadowOffset: {
        width: 0,
        height: 2,
      },

      elevation: 4,
    },

    mapControlDisabled: {
      opacity: 0.48,
    },

    mapControlPressed: {
      backgroundColor:
        COLOURS.parchment200,
      transform: [
        {
          scale: 0.97,
        },
      ],
    },

    locationBadge: {
      position:
        'absolute',
      top: 12,
      alignSelf:
        'center',
      maxWidth: '66%',
      minHeight: 38,
      paddingHorizontal: 10,
      paddingVertical: 6,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 6,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 4,
    },

    locationBadgeText: {
      flexShrink: 1,
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '800',
      letterSpacing: 0.45,
      textAlign:
        'center',
    },

    mapErrorBanner: {
      position:
        'absolute',
      top: 58,
      left: 12,
      right: 12,
      minHeight: 56,
      paddingHorizontal: 10,
      paddingVertical: 7,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 8,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.parchment100,
      borderRadius: 5,
    },

    mapErrorText: {
      flex: 1,
      minWidth: 0,
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '700',
      letterSpacing: 0.25,
    },

    retryButton: {
      minWidth: 94,
      minHeight: 48,
      paddingHorizontal: 10,
      paddingVertical: 7,
      alignItems:
        'center',
      justifyContent:
        'center',
      backgroundColor:
        COLOURS.parchment100,
      borderRadius: 4,
      flexShrink: 0,
    },

    retryButtonPressed: {
      backgroundColor:
        COLOURS.parchment200,
    },

    retryButtonText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight:
        '800',
      letterSpacing: 0.4,
      textAlign:
        'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Firestore errors                                                      */
    /* ---------------------------------------------------------------------- */

    firestoreErrorCard: {
      minHeight: 38,
      paddingHorizontal: 9,
      paddingVertical: 6,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 6,
      marginBottom: 6,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.danger300,
      borderRadius: 4,
    },

    firestoreErrorText: {
      flex: 1,
      flexShrink: 1,
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '700',
    },

    /* ---------------------------------------------------------------------- */
    /* Status card                                                           */
    /* ---------------------------------------------------------------------- */

    statusCard: {
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 4,
      paddingVertical: 8,
      paddingHorizontal: 12,
      alignItems:
        'center',
    },

    statusHeaderRow: {
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 6,
    },

    statusHeader: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11,
      lineHeight: 16,
      fontWeight:
        '800',
      letterSpacing: 1,
    },

    scoreRow: {
      flexDirection:
        'row',
      alignItems:
        'baseline',
      marginVertical: 2,
    },

    scoreText: {
      color:
        COLOURS.rust700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 27,
      lineHeight: 32,
      fontWeight:
        '900',
      letterSpacing: 0.7,
    },

    pointsText: {
      color:
        COLOURS.rust700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 12,
      lineHeight: 18,
      fontWeight:
        '800',
      marginLeft: 5,
    },

    rankText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '800',
      letterSpacing: 0.55,
      textAlign:
        'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Activity feed                                                         */
    /* ---------------------------------------------------------------------- */

    signalsContainer: {
      flex: 1,
      minHeight: 0,
      marginVertical: 8,
    },

    sectionHeaderRow: {
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 6,
      marginBottom: 7,
    },

    sectionTitle: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11,
      lineHeight: 16,
      fontWeight:
        '800',
      letterSpacing: 1,
    },

    feedLoading: {
      paddingVertical: 16,
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    signalsScroll: {
      flex: 1,
    },

    signalsScrollContent: {
      gap: 8,
      paddingBottom: 2,
    },

    emptyFeedBox: {
      marginTop: 6,
      padding: 12,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze400,
      borderStyle:
        'dashed',
      borderRadius: 4,
      alignItems:
        'center',
    },

    emptyFeedText: {
      color:
        COLOURS.parchment200,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      letterSpacing: 0.6,
      textAlign:
        'center',
    },

    signalCard: {
      backgroundColor:
        COLOURS.parchment100,
      borderRadius: 5,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      paddingHorizontal: 9,
      paddingVertical: 8,
    },

    signalHeader: {
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'center',
      gap: 8,
      marginBottom: 4,
    },

    authorRow: {
      flex: 1,
      minWidth: 0,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 5,
    },

    signalAuthor: {
      flexShrink: 1,
      color:
        COLOURS.rust700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10.5,
      lineHeight: 15,
      fontWeight:
        '800',
    },

    signalTimeTag: {
      flexShrink: 0,
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight:
        '700',
    },

    signalBody: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_FONT,
      fontSize: 10.5,
      lineHeight: 16,
    },

    /* ---------------------------------------------------------------------- */
    /* Stamp button                                                          */
    /* ---------------------------------------------------------------------- */

    stampButton: {
      minHeight: 50,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 7,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1.5,
      borderColor:
        COLOURS.bronze400,
      borderRadius: 5,
    },

    stampButtonDisabled: {
      opacity: 0.48,
    },

    stampButtonPressed: {
      backgroundColor:
        COLOURS.rust600,
    },

    stampButtonText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 12,
      lineHeight: 17,
      fontWeight:
        '800',
      letterSpacing: 1.2,
    },

    /* ---------------------------------------------------------------------- */
    /* Treasure modal                                                        */
    /* ---------------------------------------------------------------------- */

    modalOverlay: {
      flex: 1,
      alignItems:
        'center',
      justifyContent:
        'center',
      padding: 16,
      backgroundColor:
        'rgba(17, 24, 18, 0.82)',
    },

    modalCard: {
      width: '100%',
      maxWidth: 470,
      maxHeight: '88%',
      padding: 16,
      backgroundColor:
        COLOURS.parchment100,
      borderRadius: 8,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze600,
    },

    modalHeaderRow: {
      minHeight: 48,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'space-between',
      gap: 9,
    },

    modalTitle: {
      flex: 1,
      minWidth: 0,
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 15,
      lineHeight: 21,
      fontWeight:
        '800',
      letterSpacing: 0.65,
    },

    modalCloseIconButton: {
      width: 48,
      height: 48,
      alignItems:
        'center',
      justifyContent:
        'center',
      borderRadius: 24,
    },

    modalDivider: {
      height: 1,
      marginVertical: 9,
      backgroundColor:
        COLOURS.bronze500,
    },

    modalScrollBody: {
      marginBottom: 12,
    },

    modalScrollContent: {
      paddingBottom: 2,
    },

    modalMetaRow: {
      minHeight: 30,
      flexDirection:
        'row',
      alignItems:
        'center',
      flexWrap:
        'wrap',
      gap: 6,
      marginBottom: 6,
    },

    modalMetaLabel: {
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
    },

    modalMetaValue: {
      flexShrink: 1,
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10.5,
      lineHeight: 16,
      fontWeight:
        '700',
    },

    modalHintBox: {
      marginTop: 8,
      padding: 10,
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    modalHintTitle: {
      marginBottom: 3,
      color:
        COLOURS.rust700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
      letterSpacing: 0.5,
    },

    modalHintText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_FONT,
      fontSize: 11.5,
      lineHeight: 18,
    },

    modalTreasureImage: {
      width: '100%',
      height: 160,
      marginTop: 10,
      borderRadius: 5,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      backgroundColor:
        COLOURS.parchment200,
    },

    modalActionsRow: {
      flexDirection:
        'row',
      justifyContent:
        'flex-end',
      gap: 8,
    },

    modalActionButton: {
      flex: 1,
      minHeight: 48,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 9,
      borderRadius: 5,
    },

    modalTrackButton: {
      backgroundColor:
        COLOURS.forest800,
      borderWidth: 1,
      borderColor:
        COLOURS.forest950,
    },

    modalArchiveButton: {
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.rust800,
    },

    modalDismissButton: {
      flex: 0.6,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1.5,
      borderColor:
        COLOURS.bronze600,
    },

    modalButtonDisabled: {
      opacity: 0.55,
    },

    modalDarkButtonPressed: {
      opacity: 0.82,
      transform: [
        {
          scale: 0.985,
        },
      ],
    },

    modalLightButtonPressed: {
      backgroundColor:
        COLOURS.parchment200,
    },

    modalButtonText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10.5,
      lineHeight: 15,
      fontWeight:
        '800',
      letterSpacing: 0.65,
      textAlign:
        'center',
    },

    modalDismissButtonText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10.5,
      lineHeight: 15,
      fontWeight:
        '800',
      letterSpacing: 0.65,
      textAlign:
        'center',
    },
  });