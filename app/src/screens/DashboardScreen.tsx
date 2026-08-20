import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import * as Location from 'expo-location';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

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
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

import { auth, db } from '../config/firebase';

import { FieldNavBar } from '../components/FieldNavBar';

import FieldMap from '../components/FieldMap';

import type {
  FieldMapHandle,
  FieldMapRegion,
  FieldMapTreasure,
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

interface RemovableSubscription {
  remove: () => void;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_REGION: FieldMapRegion = {
  latitude: -25.7479,
  longitude: 28.2293,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

const RECENTER_REGION_DELTA = 0.04;

const MAX_TREASURE_DISTANCE_KM = 20;

const MAX_ACTIVITY_ITEMS = 10;

const GPS_ACCURACY_WARNING_METERS = 100;

const NAVIGATION_LOCK_MS = 600;

/* -------------------------------------------------------------------------- */
/* Animated components                                                        */
/* -------------------------------------------------------------------------- */

const AnimatedTouchableOpacity =
  Animated.createAnimatedComponent(
    TouchableOpacity,
  );

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const isValidCoordinate = (
  latitude: unknown,
  longitude: unknown,
): boolean => {
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

const calculateHaversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const earthRadiusKm = 6371;

  const dLat =
    ((lat2 - lat1) * Math.PI) /
    180;

  const dLon =
    ((lon2 - lon1) * Math.PI) /
    180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(
      (lat1 * Math.PI) / 180,
    ) *
      Math.cos(
        (lat2 * Math.PI) / 180,
      ) *
      Math.sin(dLon / 2) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a),
    );

  return earthRadiusKm * c;
};

const formatDistanceText = (
  distanceKm: number,
): string => {
  if (
    !Number.isFinite(distanceKm)
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

const normaliseUsername = (
  value: unknown,
  fallback = 'FIELD EXPLORER',
): string => {
  if (
    typeof value !== 'string'
  ) {
    return fallback;
  }

  const trimmed = value.trim();

  return trimmed
    ? trimmed.toUpperCase()
    : fallback;
};

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

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export const DashboardScreen: React.FC<
  Props
> = ({
  onNavigate,
}) => {
  const {
    width,
    height,
  } = useWindowDimensions();

  const isLandscape =
    width > height;

  const insets =
    useSafeAreaInsets();

  /* ---------------------------------------------------------------------- */
  /* Refs                                                                  */
  /* ---------------------------------------------------------------------- */

  const mapRef =
    useRef<FieldMapHandle | null>(
      null,
    );

  const locationSubscriptionRef =
    useRef<RemovableSubscription | null>(
      null,
    );

  const isMountedRef =
    useRef(true);

  const isNavigatingRef =
    useRef(false);

  const hasInitialCenteredRef =
    useRef(false);

  /* ---------------------------------------------------------------------- */
  /* Auth                                                                  */
  /* ---------------------------------------------------------------------- */

  const currentUser =
    auth.currentUser;

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
    allRawTreasures,
    setAllRawTreasures,
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
    isLoadingFeed,
    setIsLoadingFeed,
  ] =
    useState(true);

  const [
    firestoreError,
    setFirestoreError,
  ] =
    useState<string | null>(
      null,
    );

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
    isInitializingLocation,
    setIsInitializingLocation,
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
    isMapReady,
    setIsMapReady,
  ] =
    useState(false);

  /* ---------------------------------------------------------------------- */
  /* Map state                                                             */
  /* ---------------------------------------------------------------------- */

  const [
    region,
    setRegion,
  ] =
    useState<FieldMapRegion>(
      DEFAULT_REGION,
    );

  /* ---------------------------------------------------------------------- */
  /* Treasure modal state                                                  */
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
  /* Animation state                                                       */
  /* ---------------------------------------------------------------------- */

  const buttonScale =
    useSharedValue(1);

  const pulseOpacity =
    useSharedValue(1);

  const animatedButtonStyle =
    useAnimatedStyle(() => ({
      transform: [
        {
          scale:
            buttonScale.value,
        },
      ],
    }));

  const animatedBadgeStyle =
    useAnimatedStyle(() => ({
      opacity:
        pulseOpacity.value,
    }));

  /* ---------------------------------------------------------------------- */
  /* Component lifecycle                                                   */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    isMountedRef.current =
      true;

    return () => {
      isMountedRef.current =
        false;

      locationSubscriptionRef.current?.remove();

      locationSubscriptionRef.current =
        null;
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Navigation                                                            */
  /* ---------------------------------------------------------------------- */

  const safeNavigate =
    useCallback(
      (
        screen: string,
        params?: NavigationParams,
      ) => {
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

        setTimeout(() => {
          isNavigatingRef.current =
            false;
        }, NAVIGATION_LOCK_MS);
      },
      [onNavigate],
    );

  /* ---------------------------------------------------------------------- */
  /* Firestore subscriptions                                               */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!currentUser?.uid) {
      setUserData(null);
      setAllRawTreasures([]);
      setActivityFeed([]);
      setIsLoadingFeed(false);

      return;
    }

    setFirestoreError(null);
    setIsLoadingFeed(true);

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
          if (
            snapshot.exists()
          ) {
            setUserData(
              snapshot.data() as UserDocument,
            );
          } else {
            setUserData(null);
          }
        },
        (error) => {
          console.error(
            '[Treasi Dashboard] User subscription failed:',
            error,
          );

          setFirestoreError(
            'USER PROFILE TELEMETRY OFFLINE',
          );
        },
      );

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
          const treasures:
            TreasureDocument[] =
            [];

          snapshot.forEach(
            (documentSnapshot) => {
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

              treasures.push({
                ...data,

                treasureId:
                  data.treasureId ||
                  documentSnapshot.id,
              });
            },
          );

          setAllRawTreasures(
            treasures,
          );
        },
        (error) => {
          console.error(
            '[Treasi Dashboard] Treasure subscription failed:',
            error,
          );

          setFirestoreError(
            'TREASURE CACHE FIELD SYNC FAILED',
          );
        },
      );

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
            (documentSnapshot) => {
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

          setIsLoadingFeed(
            false,
          );
        },
        (error) => {
          console.error(
            '[Treasi Dashboard] Activity subscription failed:',
            error,
          );

          setActivityFeed([]);

          setIsLoadingFeed(
            false,
          );

          setFirestoreError(
            'FIELD SIGNALS FEED OFFLINE',
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
  /* Location helpers                                                      */
  /* ---------------------------------------------------------------------- */

  const applyLocation =
    useCallback(
      (
        location:
          Location.LocationObject,
      ) => {
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

        setLocationError(
          null,
        );

        setIsInitializingLocation(
          false,
        );
      },
      [],
    );

  /* ---------------------------------------------------------------------- */
  /* Location service                                                      */
  /* ---------------------------------------------------------------------- */

  const initializeLocationService =
    useCallback(
      async (): Promise<RemovableSubscription | null> => {
        if (
          !isMountedRef.current
        ) {
          return null;
        }

        setIsInitializingLocation(
          true,
        );

        setLocationError(
          null,
        );

        try {
          /* ---------------------------------------------------------------- */
          /* Web / localhost                                                   */
          /* ---------------------------------------------------------------- */

          if (
            Platform.OS ===
            'web'
          ) {
            if (
              typeof window ===
                'undefined' ||
              typeof navigator ===
                'undefined'
            ) {
              setLocationError(
                'BROWSER LOCATION ENVIRONMENT IS UNAVAILABLE.',
              );

              setIsInitializingLocation(
                false,
              );

              return null;
            }

            if (
              !window
                .isSecureContext
            ) {
              setLocationError(
                'BROWSER LOCATION REQUIRES HTTPS OR LOCALHOST.',
              );

              setIsInitializingLocation(
                false,
              );

              return null;
            }

            if (
              !navigator.geolocation
            ) {
              setLocationError(
                'BROWSER GPS IS NOT AVAILABLE ON THIS DEVICE.',
              );

              setIsInitializingLocation(
                false,
              );

              return null;
            }

            const applyBrowserPosition =
              (
                position:
                  GeolocationPosition,
              ) => {
                if (
                  !isMountedRef.current
                ) {
                  return;
                }

                const {
                  latitude,
                  longitude,
                  accuracy,
                  altitude,
                  altitudeAccuracy,
                  heading,
                  speed,
                } =
                  position.coords;

                if (
                  !isValidCoordinate(
                    latitude,
                    longitude,
                  )
                ) {
                  setLocationError(
                    'BROWSER RETURNED INVALID LOCATION TELEMETRY.',
                  );

                  setIsInitializingLocation(
                    false,
                  );

                  return;
                }

                const browserLocation: Location.LocationObject =
                  {
                    coords: {
                      latitude,
                      longitude,

                      accuracy:
                        typeof accuracy ===
                        'number'
                          ? accuracy
                          : null,

                      altitude:
                        typeof altitude ===
                        'number'
                          ? altitude
                          : null,

                      altitudeAccuracy:
                        typeof altitudeAccuracy ===
                        'number'
                          ? altitudeAccuracy
                          : null,

                      heading:
                        typeof heading ===
                        'number'
                          ? heading
                          : null,

                      speed:
                        typeof speed ===
                        'number'
                          ? speed
                          : null,
                    },

                    timestamp:
                      position.timestamp ||
                      Date.now(),
                  };

                applyLocation(
                  browserLocation,
                );
              };

            const handleBrowserError =
              (
                error:
                  GeolocationPositionError,
              ) => {
                if (
                  !isMountedRef.current
                ) {
                  return;
                }

                setIsInitializingLocation(
                  false,
                );

                switch (
                  error.code
                ) {
                  case 1:
                    setLocationError(
                      'GPS PERMISSION DENIED. ENABLE LOCATION FOR LOCALHOST IN YOUR BROWSER.',
                    );
                    break;

                  case 2:
                    setLocationError(
                      'BROWSER GPS POSITION UNAVAILABLE.',
                    );
                    break;

                  case 3:
                    setLocationError(
                      'BROWSER GPS FIX TIMED OUT. RETRY POSITIONAL TELEMETRY.',
                    );
                    break;

                  default:
                    setLocationError(
                      'BROWSER GPS TELEMETRY UNAVAILABLE.',
                    );
                }
              };

            navigator.geolocation.getCurrentPosition(
              applyBrowserPosition,
              handleBrowserError,
              {
                enableHighAccuracy:
                  true,

                timeout: 15000,

                maximumAge:
                  10000,
              },
            );

            const watchId =
              navigator.geolocation.watchPosition(
                applyBrowserPosition,
                handleBrowserError,
                {
                  enableHighAccuracy:
                    true,

                  timeout:
                    20000,

                  maximumAge:
                    10000,
                },
              );

            return {
              remove: () => {
                navigator.geolocation.clearWatch(
                  watchId,
                );
              },
            };
          }

          /* ---------------------------------------------------------------- */
          /* Android / iOS                                                     */
          /* ---------------------------------------------------------------- */

          const permission =
            await Location.requestForegroundPermissionsAsync();

          if (
            !isMountedRef.current
          ) {
            return null;
          }

          if (
            permission.status !==
            'granted'
          ) {
            setLocationError(
              'GPS PERMISSION DENIED. ENABLE LOCATION IN SYSTEM SETTINGS.',
            );

            setIsInitializingLocation(
              false,
            );

            return null;
          }

          /*
           * A last known position gives us
           * a fast initial map location when
           * available.
           */
          try {
            const lastKnownPosition =
              await Location.getLastKnownPositionAsync();

            if (
              lastKnownPosition &&
              isValidCoordinate(
                lastKnownPosition
                  .coords.latitude,
                lastKnownPosition
                  .coords.longitude,
              )
            ) {
              applyLocation(
                lastKnownPosition,
              );
            }
          } catch {
            // Last known position is optional.
          }

          /*
           * Obtain a fresh fix.
           */
          try {
            const initialPosition =
              await Location.getCurrentPositionAsync(
                {
                  accuracy:
                    Location.Accuracy
                      .Balanced,
                },
              );

            if (
              initialPosition
            ) {
              applyLocation(
                initialPosition,
              );
            }
          } catch (
            error
          ) {
            console.warn(
              '[Treasi Dashboard] Initial GPS fix unavailable:',
              error,
            );
          }

          if (
            !isMountedRef.current
          ) {
            return null;
          }

          const subscription =
            await Location.watchPositionAsync(
              {
                accuracy:
                  Location.Accuracy
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
                );
              },
            );

          if (
            !userLocation &&
            isMountedRef.current
          ) {
            setIsInitializingLocation(
              false,
            );
          }

          return subscription;
        } catch (
          error
        ) {
          console.error(
            '[Treasi Dashboard] Location service failed:',
            error,
          );

          if (
            isMountedRef.current
          ) {
            setLocationError(
              Platform.OS ===
                'web'
                ? 'BROWSER GPS TELEMETRY UNAVAILABLE.'
                : 'HARDWARE GPS TELEMETRY UNAVAILABLE.',
            );

            setIsInitializingLocation(
              false,
            );
          }

          return null;
        }
      },
      [
        applyLocation,
        userLocation,
      ],
    );

  /* ---------------------------------------------------------------------- */
  /* Restart GPS service                                                   */
  /* ---------------------------------------------------------------------- */

  const startLocationService =
    useCallback(
      async () => {
        try {
          locationSubscriptionRef.current?.remove();
        } catch {
          // No-op.
        }

        locationSubscriptionRef.current =
          null;

        hasInitialCenteredRef.current =
          false;

        const subscription =
          await initializeLocationService();

        if (
          !isMountedRef.current
        ) {
          subscription?.remove();

          return;
        }

        locationSubscriptionRef.current =
          subscription;
      },
      [
        initializeLocationService,
      ],
    );

  /* ---------------------------------------------------------------------- */
  /* Start GPS once                                                        */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    void startLocationService();

    return () => {
      try {
        locationSubscriptionRef.current?.remove();
      } catch {
        // No-op.
      }

      locationSubscriptionRef.current =
        null;
    };
  }, [
    startLocationService,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Pulse animation                                                       */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    pulseOpacity.value =
      withRepeat(
        withSequence(
          withTiming(
            0.35,
            {
              duration:
                1000,
            },
          ),

          withTiming(
            1,
            {
              duration:
                1000,
            },
          ),
        ),

        -1,

        true,
      );
  }, [
    pulseOpacity,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Initial map centring                                                  */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (
      !isMapReady ||
      !userLocation ||
      hasInitialCenteredRef.current
    ) {
      return;
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
      return;
    }

    const initialUserRegion: FieldMapRegion =
      {
        latitude,
        longitude,

        latitudeDelta:
          0.08,

        longitudeDelta:
          0.08,
      };

    setRegion(
      initialUserRegion,
    );

    mapRef.current?.setView(
      initialUserRegion,
      false,
    );

    hasInitialCenteredRef.current =
      true;
  }, [
    isMapReady,
    userLocation,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Nearby treasures                                                      */
  /* ---------------------------------------------------------------------- */

  const nearbyTreasures =
    useMemo(() => {
      /*
       * Preserve your existing behaviour:
       * if location is not available yet,
       * show valid active caches instead
       * of returning an empty map.
       */
      if (!userLocation) {
        return allRawTreasures;
      }

      const userLatitude =
        userLocation.coords
          .latitude;

      const userLongitude =
        userLocation.coords
          .longitude;

      if (
        !isValidCoordinate(
          userLatitude,
          userLongitude,
        )
      ) {
        return allRawTreasures;
      }

      return allRawTreasures.filter(
        (treasure) => {
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
    }, [
      allRawTreasures,
      userLocation,
    ]);

  /* ---------------------------------------------------------------------- */
  /* Convert Firestore treasures to FieldMap model                         */
  /* ---------------------------------------------------------------------- */

  const mapTreasures =
    useMemo<
      FieldMapTreasure[]
    >(() => {
      return nearbyTreasures
        .filter(
          (treasure) =>
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
          (treasure) => ({
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
        );
    }, [
      nearbyTreasures,
    ]);

  /* ---------------------------------------------------------------------- */
  /* User map model                                                        */
  /* ---------------------------------------------------------------------- */

  const mapUserLocation =
    useMemo(() => {
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
    }, [
      userLocation,
    ]);

  /* ---------------------------------------------------------------------- */
  /* Map ready                                                             */
  /* ---------------------------------------------------------------------- */

  const handleMapReady =
    useCallback(() => {
      setIsMapReady(true);
    }, []);

  /* ---------------------------------------------------------------------- */
  /* Treasure marker selection                                             */
  /* ---------------------------------------------------------------------- */

  const handleTreasureMarkerPress =
    useCallback(
      (
        treasureId: string,
      ) => {
        const treasure =
          allRawTreasures.find(
            (item) =>
              item.treasureId ===
              treasureId,
          );

        if (!treasure) {
          return;
        }

        setSelectedTreasure(
          treasure,
        );
      },
      [
        allRawTreasures,
      ],
    );

  /* ---------------------------------------------------------------------- */
  /* Recenter map                                                          */
  /* ---------------------------------------------------------------------- */

  const handleRecenterMap =
    useCallback(() => {
      if (!userLocation) {
        Alert.alert(
          'GPS UNFIXED',
          Platform.OS === 'web'
            ? 'Waiting for browser location lock.'
            : 'Waiting for satellite position lock.',
        );

        return;
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
        Alert.alert(
          'INVALID POSITION',
          'The current location fix could not be validated.',
        );

        return;
      }

      const targetRegion:
        FieldMapRegion = {
          latitude,
          longitude,

          latitudeDelta:
            RECENTER_REGION_DELTA,

          longitudeDelta:
            RECENTER_REGION_DELTA,
        };

      setRegion(
        targetRegion,
      );

      mapRef.current?.setView(
        targetRegion,
        true,
      );
    }, [
      userLocation,
    ]);

  /* ---------------------------------------------------------------------- */
  /* Stamp location                                                        */
  /* ---------------------------------------------------------------------- */

  const handleStampLocation =
    useCallback(() => {
      if (
        isNavigatingRef.current
      ) {
        return;
      }

      if (!userLocation) {
        Alert.alert(
          'TELEMETRY OFFLINE',
          Platform.OS === 'web'
            ? 'Cannot stamp location without browser location access. Allow location permission and retry.'
            : 'Cannot stamp location without an active GPS lock. Verify location services and retry.',
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
        Alert.alert(
          'INVALID GPS FIX',
          'The current position is invalid and cannot be stamped.',
        );

        return;
      }

      const navigateToCreate =
        () => {
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
        accuracy >
          GPS_ACCURACY_WARNING_METERS
      ) {
        Alert.alert(
          'POOR GPS ACCURACY',

          `Current GPS fix uncertainty is ±${Math.round(
            accuracy,
          )}m. Do you wish to stamp these coordinates anyway?`,

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
    }, [
      safeNavigate,
      userLocation,
    ]);

  /* ---------------------------------------------------------------------- */
  /* Archive treasure                                                      */
  /* ---------------------------------------------------------------------- */

  const handleArchiveTreasure =
    useCallback(
      async (
        treasureId?: string,
      ) => {
        if (
          !treasureId ||
          isArchiving
        ) {
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

          await updateDoc(
            treasureReference,
            {
              isArchived:
                true,
            },
          );

          setSelectedTreasure(
            null,
          );

          Alert.alert(
            'CACHE ARCHIVED',
            'The treasure cache has been deactivated from the field map.',
          );
        } catch (
          error
        ) {
          console.error(
            '[Treasi Dashboard] Archive failed:',
            error,
          );

          Alert.alert(
            'ACTION FAILED',

            error instanceof
            Error
              ? error.message
              : 'Unable to update cache status.',
          );
        } finally {
          setIsArchiving(
            false,
          );
        }
      },
      [
        isArchiving,
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
            userData
              ?.username ||
              currentUser
                ?.displayName ||
              currentUser?.email,
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
  /* Selected distance                                                     */
  /* ---------------------------------------------------------------------- */

  const selectedDistance =
    useMemo(() => {
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
    }, [
      selectedTreasure,
      userLocation,
    ]);

  const isSelectedTreasureCreator =
    Boolean(
      selectedTreasure &&
        currentUser?.uid &&
        selectedTreasure.creatorId ===
          currentUser.uid,
    );

  /* ---------------------------------------------------------------------- */
  /* Accuracy text                                                         */
  /* ---------------------------------------------------------------------- */

  const locationStatusText =
    useMemo(() => {
      if (
        isInitializingLocation
      ) {
        return Platform.OS ===
          'web'
          ? 'ACQUIRING BROWSER POSITION...'
          : 'ACQUIRING SATELLITE FIX...';
      }

      if (!userLocation) {
        return 'TELEMETRY OFFLINE';
      }

      const accuracy =
        userLocation.coords
          .accuracy;

      if (
        typeof accuracy ===
          'number' &&
        accuracy >
          GPS_ACCURACY_WARNING_METERS
      ) {
        return `WEAK FIX (±${Math.round(
          accuracy,
        )}M)`;
      }

      return Platform.OS ===
        'web'
        ? 'BROWSER LOCATION LOCK'
        : 'GPS SIGNAL LOCK';
    }, [
      isInitializingLocation,
      userLocation,
    ]);

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
              ? 0
              : Math.max(
                  insets.top,
                  12,
                ),

          paddingBottom:
            isLandscape
              ? 0
              : Math.max(
                  insets.bottom,
                  6,
                ),
        },
      ]}
    >
      {/* ================================================================ */}
      {/* FIELD MAP                                                        */}
      {/* ================================================================ */}

      <View
        style={
          isLandscape
            ? styles.leftViewportLandscape
            : styles.leftViewportPortrait
        }
      >
        <FieldMap
          ref={mapRef}
          initialRegion={
            region
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

        {/* Compass */}

        <View
          style={
            styles.compassOverlay
          }
          accessible={false}
        >
          <Ionicons
            name="compass-outline"
            size={16}
            color="#2A2420"
          />

          <Text
            style={
              styles.compassText
            }
          >
            N
          </Text>
        </View>

        {/* Radius indicator */}

        <View
          style={
            styles.radiusBadge
          }
          accessible={false}
        >
          <MaterialCommunityIcons
            name="radar"
            size={12}
            color="#2A2420"
            style={{
              marginRight: 4,
            }}
          />

          <Text
            style={
              styles.radiusBadgeText
            }
          >
            {userLocation
              ? `20KM RANGE LOCK (${nearbyTreasures.length})`
              : `CACHE FIELD (${nearbyTreasures.length})`}
          </Text>
        </View>

        {/* Recenter */}

        <TouchableOpacity
          style={
            styles.recenterButton
          }
          onPress={
            handleRecenterMap
          }
          accessible
          accessibilityRole="button"
          accessibilityLabel="Recenter map on current location"
        >
          <Ionicons
            name="locate-sharp"
            size={16}
            color="#2A2420"
          />
        </TouchableOpacity>

        {/* Location status */}

        <Animated.View
          style={[
            styles.locationBadge,
            animatedBadgeStyle,
          ]}
        >
          <Ionicons
            name="radio-sharp"
            size={12}
            color={
              userLocation
                ?.coords
                ?.accuracy &&
              userLocation.coords
                .accuracy >
                GPS_ACCURACY_WARNING_METERS
                ? '#B08D57'
                : '#A64B2A'
            }
            style={{
              marginRight: 4,
            }}
          />

          <Text
            style={
              styles.locationBadgeText
            }
          >
            {
              locationStatusText
            }
          </Text>
        </Animated.View>

        {/* Location error */}

        {locationError ? (
          <View
            style={
              styles.mapErrorBanner
            }
          >
            <Ionicons
              name="warning-outline"
              size={14}
              color="#F3ECD8"
              style={{
                marginRight: 6,
              }}
            />

            <Text
              style={
                styles.mapErrorText
              }
            >
              {locationError}
            </Text>

            <TouchableOpacity
              style={
                styles.retryButton
              }
              onPress={() => {
                void startLocationService();
              }}
            >
              <Text
                style={
                  styles.retryButtonText
                }
              >
                RETRY
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Initial loader */}

        {(
          isInitializingLocation ||
          !isMapReady
        ) && (
          <View
            style={
              styles.loadingContainer
            }
            pointerEvents="none"
          >
            <ActivityIndicator
              size="small"
              color="#A64B2A"
            />
          </View>
        )}
      </View>

      {/* ================================================================ */}
      {/* COMMAND CONSOLE                                                  */}
      {/* ================================================================ */}

      <View
        style={
          isLandscape
            ? styles.rightViewportLandscape
            : styles.rightViewportPortrait
        }
      >
        {/* Firestore error */}

        {firestoreError ? (
          <View
            style={
              styles.firestoreErrorCard
            }
          >
            <Ionicons
              name="cloud-offline-outline"
              size={12}
              color="#F3ECD8"
              style={{
                marginRight: 4,
              }}
            />

            <Text
              style={
                styles.firestoreErrorText
              }
            >
              {firestoreError}
            </Text>
          </View>
        ) : null}

        {/* Field status */}

        <View
          style={
            styles.statusCard
          }
        >
          <View
            style={
              styles.statusHeaderRow
            }
          >
            <MaterialCommunityIcons
              name="star-four-points"
              size={12}
              color="#B08D57"
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
              size={12}
              color="#B08D57"
            />
          </View>

          <View
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
                userData
                  ?.totalPoints ??
                0
              ).toLocaleString()}
            </Text>

            <Text
              style={
                styles.ptsText
              }
            >
              PTS
            </Text>
          </View>

          <Text
            style={
              styles.rankText
            }
          >
            {getRankTitle(
              userData
                ?.totalPoints ??
                0,
            )}
          </Text>
        </View>

        {/* Recent activity */}

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
              name="radio-handheld"
              size={14}
              color="#B08D57"
            />

            <Text
              style={
                styles.sectionTitle
              }
            >
              RECENT SIGNALS
            </Text>
          </View>

          {isLoadingFeed ? (
            <ActivityIndicator
              size="small"
              color="#B08D57"
              style={{
                marginTop: 12,
              }}
            />
          ) : activityFeed.length ===
            0 ? (
            <View
              style={
                styles.emptyFeedBox
              }
            >
              <Text
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
              showsVerticalScrollIndicator={
                false
              }
              contentContainerStyle={{
                gap: 8,
              }}
            >
              {activityFeed.map(
                (
                  item,
                  index,
                ) => (
                  <Animated.View
                    key={
                      item.activityId ||
                      `activity-${index}`
                    }
                    entering={FadeInDown.delay(
                      Math.min(
                        index * 80,
                        400,
                      ),
                    ).duration(
                      350,
                    )}
                    style={
                      styles.signalCard
                    }
                  >
                    <View
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
                          size={12}
                          color="#A64B2A"
                          style={{
                            marginRight: 4,
                          }}
                        />

                        <Text
                          style={
                            styles.signalAuthor
                          }
                        >
                          {getDisplayUsername(
                            item,
                          )}
                        </Text>
                      </View>

                      <Text
                        style={
                          styles.signalTimeTag
                        }
                      >
                        {formatRelativeTime(
                          item.createdAt,
                        )}
                      </Text>
                    </View>

                    <Text
                      style={
                        styles.signalBody
                      }
                    >
                      {item.message ||
                        'FIELD SIGNAL RECEIVED'}
                    </Text>
                  </Animated.View>
                ),
              )}
            </ScrollView>
          )}
        </View>

        {/* Stamp location */}

        <AnimatedTouchableOpacity
          style={[
            styles.stampButton,
            animatedButtonStyle,
          ]}
          activeOpacity={
            0.85
          }
          onPressIn={() => {
            buttonScale.value =
              withSpring(
                0.94,
              );
          }}
          onPressOut={() => {
            buttonScale.value =
              withSpring(
                1,
              );
          }}
          onPress={
            handleStampLocation
          }
          accessible
          accessibilityRole="button"
          accessibilityLabel="Stamp Current Location"
        >
          <Ionicons
            name="print-outline"
            size={16}
            color="#F3ECD8"
            style={{
              marginRight: 6,
            }}
          />

          <Text
            style={
              styles.stampButtonText
            }
          >
            STAMP LOCATION
          </Text>
        </AnimatedTouchableOpacity>

        <FieldNavBar
          currentTab="MAP"
          onNavigate={
            onNavigate
          }
        />
      </View>

      {/* ================================================================ */}
      {/* TREASURE DETAILS                                                 */}
      {/* ================================================================ */}

      <Modal
        visible={
          Boolean(
            selectedTreasure,
          )
        }
        transparent
        animationType="fade"
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
                name="treasure-chest"
                size={20}
                color="#A64B2A"
              />

              <Text
                style={
                  styles.modalTitle
                }
                numberOfLines={
                  2
                }
              >
                {normaliseUsername(
                  selectedTreasure
                    ?.title,
                  'TREASURE CACHE',
                )}
              </Text>

              <TouchableOpacity
                onPress={() =>
                  setSelectedTreasure(
                    null,
                  )
                }
                accessible
                accessibilityRole="button"
                accessibilityLabel="Close treasure details"
              >
                <Ionicons
                  name="close-sharp"
                  size={20}
                  color="#2A2420"
                />
              </TouchableOpacity>
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
                  name="person-outline"
                  size={12}
                  color="#B08D57"
                />

                <Text
                  style={
                    styles.modalMetaLabel
                  }
                >
                  CREATOR:
                </Text>

                <Text
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
                  name="navigate-outline"
                  size={12}
                  color="#B08D57"
                />

                <Text
                  style={
                    styles.modalMetaLabel
                  }
                >
                  DISTANCE:
                </Text>

                <Text
                  style={
                    styles.modalMetaValue
                  }
                >
                  {selectedDistance !==
                  null
                    ? formatDistanceText(
                        selectedDistance,
                      )
                    : 'LOCATION FIX REQUIRED'}
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
                    name="location-outline"
                    size={12}
                    color="#B08D57"
                  />

                  <Text
                    style={
                      styles.modalMetaLabel
                    }
                  >
                    COORDINATES:
                  </Text>

                  <Text
                    style={
                      styles.modalMetaValue
                    }
                  >
                    {`${selectedTreasure.location.latitude.toFixed(
                      4,
                    )}, ${selectedTreasure.location.longitude.toFixed(
                      4,
                    )}`}
                  </Text>
                </View>
              ) : null}

              {selectedTreasure
                ?.hint ? (
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
                    CACHE HINT:
                  </Text>

                  <Text
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
                ?.imageUrl ? (
                <Image
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
                <TouchableOpacity
                  style={[
                    styles.modalActionButton,
                    styles.modalArchiveButton,

                    isArchiving && {
                      opacity:
                        0.6,
                    },
                  ]}
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

                    Alert.alert(
                      'CONFIRM ARCHIVE',
                      'Deactivate this treasure cache from the field map?',
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
                >
                  {isArchiving ? (
                    <ActivityIndicator
                      size="small"
                      color="#F3ECD8"
                    />
                  ) : (
                    <>
                      <Ionicons
                        name="archive-outline"
                        size={14}
                        color="#F3ECD8"
                        style={{
                          marginRight: 4,
                        }}
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
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.modalActionButton,
                    styles.modalTrackButton,
                  ]}
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
                >
                  <Ionicons
                    name="compass-outline"
                    size={14}
                    color="#F3ECD8"
                    style={{
                      marginRight: 4,
                    }}
                  />

                  <Text
                    style={
                      styles.modalButtonText
                    }
                  >
                    TRACK IN HUNT
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.modalActionButton,
                  styles.modalCloseButton,
                ]}
                onPress={() =>
                  setSelectedTreasure(
                    null,
                  )
                }
              >
                <Text
                  style={
                    styles.modalCloseButtonText
                  }
                >
                  DISMISS
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    container: {
      flex: 1,

      backgroundColor:
        '#2C3B2E',
    },

    /* -------------------------------------------------------------------- */
    /* Layout                                                               */
    /* -------------------------------------------------------------------- */

    leftViewportLandscape: {
      flex: 0.6,

      position:
        'relative',

      backgroundColor:
        '#E8DCC0',

      borderRightWidth:
        3,

      borderColor:
        '#B08D57',

      overflow:
        'hidden',
    },

    leftViewportPortrait: {
      height:
        '45%',

      position:
        'relative',

      backgroundColor:
        '#E8DCC0',

      borderBottomWidth:
        3,

      borderColor:
        '#B08D57',

      overflow:
        'hidden',
    },

    rightViewportLandscape: {
      flex: 0.4,

      backgroundColor:
        '#2C3B2E',

      padding: 12,

      justifyContent:
        'space-between',

      minWidth: 0,
    },

    rightViewportPortrait: {
      flex: 1,

      backgroundColor:
        '#2C3B2E',

      padding: 12,

      justifyContent:
        'space-between',

      minHeight: 0,
    },

    /* -------------------------------------------------------------------- */
    /* Map overlays                                                         */
    /* -------------------------------------------------------------------- */

    loadingContainer: {
      position:
        'absolute',

      bottom: 16,

      right: 16,

      backgroundColor:
        '#E8DCC0',

      padding: 6,

      borderRadius: 20,

      borderWidth: 1,

      borderColor:
        '#B08D57',
    },

    compassOverlay: {
      position:
        'absolute',

      top: 12,

      left: 12,

      backgroundColor:
        '#E8DCC0',

      borderWidth: 1,

      borderColor:
        '#2A2420',

      borderRadius: 20,

      paddingHorizontal:
        8,

      paddingVertical:
        4,

      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 4,
    },

    compassText: {
      fontSize: 12,

      fontWeight:
        'bold',

      color:
        '#2A2420',
    },

    radiusBadge: {
      position:
        'absolute',

      bottom: 12,

      left: 12,

      backgroundColor:
        '#E8DCC0',

      borderWidth: 1,

      borderColor:
        '#B08D57',

      paddingHorizontal:
        8,

      paddingVertical:
        4,

      borderRadius: 2,

      flexDirection:
        'row',

      alignItems:
        'center',
    },

    radiusBadgeText: {
      fontSize: 9,

      fontWeight:
        'bold',

      color:
        '#2A2420',

      letterSpacing: 1,
    },

    recenterButton: {
      position:
        'absolute',

      bottom: 12,

      right: 12,

      backgroundColor:
        '#E8DCC0',

      borderWidth: 1,

      borderColor:
        '#B08D57',

      padding: 8,

      borderRadius: 20,

      elevation: 3,

      shadowColor:
        '#000',

      shadowOpacity:
        0.15,

      shadowRadius: 3,

      shadowOffset: {
        width: 0,
        height: 2,
      },
    },

    locationBadge: {
      position:
        'absolute',

      top: 12,

      alignSelf:
        'center',

      backgroundColor:
        '#F3ECD8',

      borderWidth: 1,

      borderColor:
        '#B08D57',

      paddingHorizontal:
        10,

      paddingVertical:
        3,

      borderRadius: 2,

      flexDirection:
        'row',

      alignItems:
        'center',

      maxWidth:
        '70%',
    },

    locationBadgeText: {
      fontSize: 10,

      fontWeight:
        'bold',

      color:
        '#2A2420',

      letterSpacing: 1,

      flexShrink: 1,
    },

    mapErrorBanner: {
      position:
        'absolute',

      top: 45,

      alignSelf:
        'center',

      backgroundColor:
        '#A64B2A',

      paddingHorizontal:
        10,

      paddingVertical:
        6,

      borderRadius: 4,

      flexDirection:
        'row',

      alignItems:
        'center',

      maxWidth:
        '92%',
    },

    mapErrorText: {
      color:
        '#F3ECD8',

      fontSize: 9,

      fontWeight:
        'bold',

      letterSpacing:
        0.5,

      flex: 1,

      flexShrink: 1,
    },

    retryButton: {
      backgroundColor:
        '#F3ECD8',

      paddingHorizontal:
        7,

      paddingVertical:
        4,

      borderRadius: 2,

      marginLeft: 8,
    },

    retryButtonText: {
      color:
        '#2A2420',

      fontSize: 8,

      fontWeight:
        'bold',
    },

    /* -------------------------------------------------------------------- */
    /* Status panel                                                         */
    /* -------------------------------------------------------------------- */

    statusCard: {
      backgroundColor:
        '#E8DCC0',

      borderWidth: 2,

      borderColor:
        '#B08D57',

      paddingVertical: 8,

      paddingHorizontal:
        12,

      alignItems:
        'center',

      position:
        'relative',

      borderRadius: 2,
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
        '#2A2420',

      fontSize: 11,

      fontWeight:
        'bold',

      letterSpacing:
        1.5,
    },

    scoreRow: {
      flexDirection:
        'row',

      alignItems:
        'baseline',

      marginVertical: 2,
    },

    scoreText: {
      fontSize: 26,

      fontWeight:
        'bold',

      color:
        '#A64B2A',

      letterSpacing: 1,
    },

    ptsText: {
      fontSize: 12,

      fontWeight:
        'bold',

      color:
        '#A64B2A',

      marginLeft: 4,
    },

    rankText: {
      color:
        '#2A2420',

      fontSize: 9,

      fontWeight:
        'bold',

      letterSpacing: 1,
    },

    /* -------------------------------------------------------------------- */
    /* Firestore error                                                      */
    /* -------------------------------------------------------------------- */

    firestoreErrorCard: {
      backgroundColor:
        '#A64B2A',

      padding: 5,

      borderRadius: 2,

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'center',

      marginBottom: 4,
    },

    firestoreErrorText: {
      color:
        '#F3ECD8',

      fontSize: 8,

      fontWeight:
        'bold',

      flexShrink: 1,
    },

    /* -------------------------------------------------------------------- */
    /* Activity feed                                                        */
    /* -------------------------------------------------------------------- */

    signalsContainer: {
      flex: 1,

      marginVertical: 8,

      minHeight: 0,
    },

    sectionHeaderRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 4,

      marginBottom: 6,
    },

    sectionTitle: {
      color:
        '#B08D57',

      fontSize: 10,

      fontWeight:
        'bold',

      letterSpacing:
        1.5,
    },

    signalsScroll: {
      flex: 1,
    },

    emptyFeedBox: {
      padding: 12,

      borderWidth: 1,

      borderColor:
        '#B08D57',

      borderStyle:
        'dashed',

      borderRadius: 4,

      alignItems:
        'center',

      marginTop: 6,
    },

    emptyFeedText: {
      color:
        '#E8DCC0',

      fontSize: 9,

      letterSpacing: 1,

      textAlign:
        'center',
    },

    signalCard: {
      backgroundColor:
        '#F3ECD8',

      borderRadius: 4,

      borderWidth: 1,

      borderColor:
        '#B08D57',

      padding: 8,
    },

    signalHeader: {
      flexDirection:
        'row',

      justifyContent:
        'space-between',

      alignItems:
        'center',

      marginBottom: 4,

      gap: 8,
    },

    authorRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      flex: 1,

      minWidth: 0,
    },

    signalAuthor: {
      color:
        '#A64B2A',

      fontWeight:
        'bold',

      fontSize: 10,

      flexShrink: 1,
    },

    signalTimeTag: {
      color:
        '#8C8275',

      fontSize: 8,

      fontWeight:
        'bold',
    },

    signalBody: {
      color:
        '#2A2420',

      fontSize: 10,

      lineHeight: 13,
    },

    /* -------------------------------------------------------------------- */
    /* Stamp button                                                         */
    /* -------------------------------------------------------------------- */

    stampButton: {
      backgroundColor:
        '#A64B2A',

      paddingVertical: 10,

      borderRadius: 4,

      borderWidth: 1,

      borderColor:
        '#B08D57',

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'center',

      marginBottom: 8,

      minHeight: 48,
    },

    stampButtonText: {
      color:
        '#F3ECD8',

      fontWeight:
        'bold',

      fontSize: 12,

      letterSpacing: 2,
    },

    /* -------------------------------------------------------------------- */
    /* Modal                                                                */
    /* -------------------------------------------------------------------- */

    modalOverlay: {
      flex: 1,

      backgroundColor:
        'rgba(0, 0, 0, 0.65)',

      justifyContent:
        'center',

      alignItems:
        'center',

      padding: 16,
    },

    modalCard: {
      width:
        '100%',

      maxWidth: 420,

      backgroundColor:
        '#F3ECD8',

      borderRadius: 6,

      borderWidth: 2,

      borderColor:
        '#B08D57',

      padding: 16,

      maxHeight:
        '85%',
    },

    modalHeaderRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'space-between',

      gap: 8,
    },

    modalTitle: {
      flex: 1,

      fontSize: 14,

      fontWeight:
        'bold',

      color:
        '#2A2420',

      letterSpacing: 1,
    },

    modalDivider: {
      height: 1,

      backgroundColor:
        '#B08D57',

      marginVertical: 10,
    },

    modalScrollBody: {
      marginBottom: 12,
    },

    modalMetaRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 6,

      marginBottom: 6,

      flexWrap:
        'wrap',
    },

    modalMetaLabel: {
      fontSize: 10,

      fontWeight:
        'bold',

      color:
        '#8C8275',
    },

    modalMetaValue: {
      fontSize: 10,

      fontWeight:
        'bold',

      color:
        '#2A2420',

      flexShrink: 1,
    },

    modalHintBox: {
      backgroundColor:
        '#E8DCC0',

      borderWidth: 1,

      borderColor:
        '#B08D57',

      padding: 8,

      borderRadius: 4,

      marginTop: 8,
    },

    modalHintTitle: {
      fontSize: 9,

      fontWeight:
        'bold',

      color:
        '#A64B2A',

      marginBottom: 2,
    },

    modalHintText: {
      fontSize: 11,

      color:
        '#2A2420',

      lineHeight: 15,
    },

    modalTreasureImage: {
      width:
        '100%',

      height: 140,

      borderRadius: 4,

      marginTop: 10,

      borderWidth: 1,

      borderColor:
        '#B08D57',
    },

    modalActionsRow: {
      flexDirection:
        'row',

      gap: 8,

      justifyContent:
        'flex-end',
    },

    modalActionButton: {
      flex: 1,

      paddingVertical: 10,

      borderRadius: 4,

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'center',

      minHeight: 42,
    },

    modalTrackButton: {
      backgroundColor:
        '#2C3B2E',
    },

    modalArchiveButton: {
      backgroundColor:
        '#A64B2A',
    },

    modalCloseButton: {
      backgroundColor:
        'transparent',

      borderWidth: 1,

      borderColor:
        '#B08D57',

      flex: 0.5,
    },

    modalButtonText: {
      color:
        '#F3ECD8',

      fontSize: 10,

      fontWeight:
        'bold',

      letterSpacing: 1,

      textAlign:
        'center',
    },

    modalCloseButtonText: {
      color:
        '#2A2420',

      fontSize: 10,

      fontWeight:
        'bold',

      letterSpacing: 1,

      textAlign:
        'center',
    },
  });

export default DashboardScreen;