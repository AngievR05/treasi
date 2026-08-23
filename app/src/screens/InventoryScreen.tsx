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
  AppState,
  type AppStateStatus,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as Location from 'expo-location';

import { Ionicons } from '@expo/vector-icons';

import {
  collection,
  doc,
  GeoPoint,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { auth, db } from '../config/firebase';

import type {
  TreasureDocument,
  UserDocument,
} from '../types/firestore';

import {
  FieldNavBar,
  type NavigationTab,
} from '../components/FieldNavBar';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type IconType =
  | 'map-pin'
  | 'target'
  | 'compass'
  | 'trophy'
  | 'book';

export interface DisplayItem {
  id: string;
  dbRef: string;
  title: string;
  category: 'cache';
  iconType: IconType;
  coordinates: string;
  rawLat: number;
  rawLng: number;
  distanceKm: number;
  status: string;
  hint?: string;
  payloadText?: string;
  creatorId: string;
  creatorName?: string;
  createdAt?: unknown;
  imageUrl?: string;
  isDiscovered: boolean;
}

export interface NavigationParams {
  treasureId?: string;
  mode?: 'hunt' | 'create';
  latitude?: number;
  longitude?: number;
  [key: string]: unknown;
}

interface InventoryScreenProps {
  onBack: () => void;

  onNavigate?: (
    screen: string,
    params?: NavigationParams,
  ) => void;

  initialParams?: NavigationParams;
}

interface Coordinates {
  latitude: number;
  longitude: number;
}

type InventoryLocationStatus =
  | 'CHECKING'
  | 'READY'
  | 'PERMISSION_REQUIRED'
  | 'DENIED'
  | 'SERVICES_OFF'
  | 'ERROR';

type LocationSource =
  | 'none'
  | 'stamped'
  | 'live'
  | 'last-known';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const INVENTORY_RADIUS_KM = 20;

const MIN_TITLE_LENGTH = 3;
const MAX_TITLE_LENGTH = 80;
const MAX_HINT_LENGTH = 500;
const MAX_PAYLOAD_LENGTH = 1000;

const LOCATION_UPDATE_INTERVAL_MS =
  10_000;

const LOCATION_UPDATE_DISTANCE_M =
  10;

const MIN_TOUCH_TARGET = 48;

const FIRESTORE_SAFE_BATCH_SIZE =
  450;

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

// Announces important feedback to assistive technologies.
const announce = (
  message: string,
): void => {
  AccessibilityInfo.announceForAccessibility(
    message,
  );
};

// Shows feedback visually and to screen readers.
const showAccessibleAlert = (
  title: string,
  message: string,
): void => {
  announce(
    `${title}. ${message}`,
  );

  Alert.alert(
    title,
    message,
  );
};

// Validates coordinates before distance or Firestore operations.
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

// Calculates straight-line geographic distance.
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
      (latitudeA *
        Math.PI) /
        180,
    ) *
      Math.cos(
        (latitudeB *
          Math.PI) /
          180,
      ) *
      Math.sin(
        longitudeDifference /
          2,
      ) **
        2;

  return (
    earthRadiusKm *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a),
    )
  );
};

// Parses a manually entered coordinate.
const parseCoordinate = (
  value: string,
): number | null => {
  const trimmed =
    value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed =
    Number(trimmed);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
};

// Provides a safe visible Explorer name.
const getSafeCreatorName = (
  value?: string,
): string => {
  const trimmed =
    value?.trim();

  return (
    trimmed ||
    'EXPLORER'
  );
};

// Converts Firestore errors into useful messages.
const getFriendlyFirestoreError = (
  error: unknown,
  fallback: string,
): string => {
  const code =
    typeof error ===
      'object' &&
    error !== null &&
    'code' in error
      ? String(
          (
            error as {
              code?: unknown;
            }
          ).code ??
            '',
        )
      : '';

  if (
    code.includes(
      'permission-denied',
    )
  ) {
    return 'You do not have permission to perform this field operation.';
  }

  if (
    code.includes(
      'unavailable',
    ) ||
    code.includes(
      'network',
    )
  ) {
    return 'The field network is unavailable. Check your connection and try again.';
  }

  return fallback;
};

// Formats coordinates without displaying duplicate minus signs.
const formatCoordinates = (
  latitude: number,
  longitude: number,
): string =>
  `${Math.abs(
    latitude,
  ).toFixed(4)}° ${
    latitude >= 0
      ? 'N'
      : 'S'
  } / ${Math.abs(
    longitude,
  ).toFixed(4)}° ${
    longitude >= 0
      ? 'E'
      : 'W'
  }`;

// Uses Expo icons to avoid Lucide web typing problems.
const ItemIcon:
  React.FC<{
    type: IconType;
    size?: number;
    colour?: string;
  }> = ({
    type,
    size = 22,
    colour =
      COLOURS.rust700,
  }) => {
    switch (type) {
      case 'map-pin':
        return (
          <Ionicons
            name="location-outline"
            size={size}
            color={colour}
          />
        );

      case 'target':
        return (
          <Ionicons
            name="locate-outline"
            size={size}
            color={colour}
          />
        );

      case 'compass':
        return (
          <Ionicons
            name="compass-outline"
            size={size}
            color={colour}
          />
        );

      case 'trophy':
        return (
          <Ionicons
            name="trophy-outline"
            size={size}
            color={colour}
          />
        );

      case 'book':
        return (
          <Ionicons
            name="book-outline"
            size={size}
            color={colour}
          />
        );

      default:
        return (
          <Ionicons
            name="cube-outline"
            size={size}
            color={colour}
          />
        );
    }
  };

/* -------------------------------------------------------------------------- */
/* Inventory                                                                  */
/* -------------------------------------------------------------------------- */

export const InventoryScreen:
  React.FC<
    InventoryScreenProps
  > = ({
    onBack,
    onNavigate,
    initialParams,
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

    const currentTab:
      NavigationTab =
      'INVENTORY';

    const currentUser =
      auth.currentUser;

    const currentUserId =
      currentUser?.uid ??
      null;

    /* ---------------------------------------------------------------------- */
    /* Initial stamped coordinates                                            */
    /* ---------------------------------------------------------------------- */

    const initialCoordinates =
      useMemo<
        Coordinates | null
      >(
        () => {
          if (
            !isValidCoordinate(
              initialParams
                ?.latitude,
              initialParams
                ?.longitude,
            )
          ) {
            return null;
          }

          return {
            latitude:
              initialParams
                ?.latitude as number,

            longitude:
              initialParams
                ?.longitude as number,
          };
        },
        [
          initialParams
            ?.latitude,
          initialParams
            ?.longitude,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Refs                                                                   */
    /* ---------------------------------------------------------------------- */

    const isMountedRef =
      useRef(true);

    const locationSubscriptionRef =
      useRef<
        Location.LocationSubscription | null
      >(null);

    const locationRequestSequenceRef =
      useRef(0);

    const coordinateInputsTouchedRef =
      useRef(
        Boolean(
          initialCoordinates,
        ),
      );

    const userCoordsRef =
      useRef<
        Coordinates | null
      >(
        initialCoordinates,
      );

    const locationSourceRef =
      useRef<LocationSource>(
        initialCoordinates
          ? 'stamped'
          : 'none',
      );

    /* ---------------------------------------------------------------------- */
    /* Profile                                                                */
    /* ---------------------------------------------------------------------- */

    const [
      currentProfile,
      setCurrentProfile,
    ] =
      useState<
        UserDocument | null
      >(null);

    const [
      profileError,
      setProfileError,
    ] =
      useState<
        string | null
      >(null);

    /* ---------------------------------------------------------------------- */
    /* Location                                                               */
    /* ---------------------------------------------------------------------- */

    const [
      userCoords,
      setUserCoords,
    ] =
      useState<
        Coordinates | null
      >(
        initialCoordinates,
      );

    const [
      locationSource,
      setLocationSource,
    ] =
      useState<LocationSource>(
        initialCoordinates
          ? 'stamped'
          : 'none',
      );

    const [
      locationStatus,
      setLocationStatus,
    ] =
      useState<InventoryLocationStatus>(
        initialCoordinates
          ? 'READY'
          : 'CHECKING',
      );

    const [
      locationPermissionStatus,
      setLocationPermissionStatus,
    ] =
      useState<
        Location.PermissionStatus | null
      >(null);

    const [
      canAskLocationAgain,
      setCanAskLocationAgain,
    ] =
      useState(true);

    const [
      locationServicesEnabled,
      setLocationServicesEnabled,
    ] =
      useState<
        boolean | null
      >(null);

    const [
      locationError,
      setLocationError,
    ] =
      useState<
        string | null
      >(null);

    const [
      isRefreshingLocation,
      setIsRefreshingLocation,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* Inventory data                                                         */
    /* ---------------------------------------------------------------------- */

    const [
      firestoreTreasures,
      setFirestoreTreasures,
    ] =
      useState<
        Array<{
          id: string;
          data: TreasureDocument;
        }>
      >([]);

    const [
      discoveredTreasureIds,
      setDiscoveredTreasureIds,
    ] =
      useState<
        Set<string>
      >(
        () =>
          new Set(),
      );

    const [
      selectedId,
      setSelectedId,
    ] =
      useState<
        string | null
      >(null);

    const [
      isLoading,
      setIsLoading,
    ] =
      useState(true);

    const [
      firestoreError,
      setFirestoreError,
    ] =
      useState<
        string | null
      >(null);

    const [
      discoveryError,
      setDiscoveryError,
    ] =
      useState<
        string | null
      >(null);

    const [
      retryKey,
      setRetryKey,
    ] =
      useState(0);

    /* ---------------------------------------------------------------------- */
    /* Create / edit state                                                    */
    /* ---------------------------------------------------------------------- */

    const [
      isSubmitting,
      setIsSubmitting,
    ] =
      useState(false);

    const [
      isBurying,
      setIsBurying,
    ] =
      useState(
        initialParams
          ?.mode ===
          'create',
      );

    const [
      fieldErrors,
      setFieldErrors,
    ] =
      useState<
        Record<
          string,
          string
        >
      >({});

    const [
      newTitle,
      setNewTitle,
    ] =
      useState('');

    const [
      newHint,
      setNewHint,
    ] =
      useState('');

    const [
      newPayload,
      setNewPayload,
    ] =
      useState('');

    const [
      newLat,
      setNewLat,
    ] =
      useState(
        initialCoordinates
          ? initialCoordinates
              .latitude
              .toFixed(6)
          : '',
      );

    const [
      newLng,
      setNewLng,
    ] =
      useState(
        initialCoordinates
          ? initialCoordinates
              .longitude
              .toFixed(6)
          : '',
      );

    const [
      isEditing,
      setIsEditing,
    ] =
      useState(false);

    const [
      editTitle,
      setEditTitle,
    ] =
      useState('');

    const [
      editHint,
      setEditHint,
    ] =
      useState('');

    const [
      editPayload,
      setEditPayload,
    ] =
      useState('');

    /* ---------------------------------------------------------------------- */
    /* Lifecycle                                                              */
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
          // The watcher may already be removed.
        }

        locationSubscriptionRef.current =
          null;
      };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Apply Dashboard stamp                                                  */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        initialParams?.mode !==
        'create'
      ) {
        return;
      }

      setIsBurying(
        true,
      );

      setIsEditing(
        false,
      );

      setSelectedId(
        null,
      );

      setFieldErrors(
        {},
      );

      if (
        !initialCoordinates
      ) {
        return;
      }

      coordinateInputsTouchedRef.current =
        true;

      userCoordsRef.current =
        initialCoordinates;

      locationSourceRef.current =
        'stamped';

      setUserCoords(
        initialCoordinates,
      );

      setLocationSource(
        'stamped',
      );

      setLocationStatus(
        'READY',
      );

      setNewLat(
        initialCoordinates
          .latitude
          .toFixed(6),
      );

      setNewLng(
        initialCoordinates
          .longitude
          .toFixed(6),
      );
    }, [
      initialCoordinates,
      initialParams?.mode,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Current profile                                                        */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        !currentUserId
      ) {
        setCurrentProfile(
          null,
        );

        setProfileError(
          'EXPLORER SESSION REQUIRED',
        );

        return;
      }

      setProfileError(
        null,
      );

      const unsubscribe =
        onSnapshot(
          doc(
            db,
            'users',
            currentUserId,
          ),

          (
            snapshot,
          ) => {
            if (
              snapshot.exists()
            ) {
              setCurrentProfile(
                snapshot.data() as
                  UserDocument,
              );

              setProfileError(
                null,
              );

              return;
            }

            setCurrentProfile(
              null,
            );

            setProfileError(
              'EXPLORER PROFILE NOT FOUND',
            );
          },

          (
            error,
          ) => {
            if (__DEV__) {
              console.warn(
                '[Treasi Inventory] Profile subscription failed:',
                error,
              );
            }

            setProfileError(
              'EXPLORER PROFILE SYNC OFFLINE',
            );
          },
        );

      return unsubscribe;
    }, [
      currentUserId,
      retryKey,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Location helpers                                                       */
    /* ---------------------------------------------------------------------- */

    const stopLocationSubscription =
      useCallback(
        (): void => {
          try {
            locationSubscriptionRef.current?.remove();
          } catch {
            // The watcher may already be removed.
          }

          locationSubscriptionRef.current =
            null;
        },
        [],
      );

    const applyCoordinates =
      useCallback(
        (
          coordinates:
            Coordinates,
          source:
            LocationSource,
        ): void => {
          if (
            !isValidCoordinate(
              coordinates.latitude,
              coordinates.longitude,
            )
          ) {
            return;
          }

          userCoordsRef.current =
            coordinates;

          locationSourceRef.current =
            source;

          setUserCoords(
            coordinates,
          );

          setLocationSource(
            source,
          );
        },
        [],
      );

    const applyLiveLocation =
      useCallback(
        (
          location:
            Location.LocationObject,
        ): void => {
          if (
            !isMountedRef.current
          ) {
            return;
          }

          const coordinates = {
            latitude:
              location.coords
                .latitude,

            longitude:
              location.coords
                .longitude,
          };

          if (
            !isValidCoordinate(
              coordinates.latitude,
              coordinates.longitude,
            )
          ) {
            return;
          }

          applyCoordinates(
            coordinates,
            'live',
          );

          setLocationStatus(
            'READY',
          );

          setLocationError(
            null,
          );

          if (
            !coordinateInputsTouchedRef.current
          ) {
            setNewLat(
              coordinates.latitude.toFixed(
                6,
              ),
            );

            setNewLng(
              coordinates.longitude.toFixed(
                6,
              ),
            );
          }
        },
        [
          applyCoordinates,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Location service                                                       */
    /* ---------------------------------------------------------------------- */

    const startLocationService =
      useCallback(
        async (
          requestPermission:
            boolean,
        ): Promise<void> => {
          const requestSequence =
            ++locationRequestSequenceRef.current;

          stopLocationSubscription();

          if (
            !isMountedRef.current
          ) {
            return;
          }

          setIsRefreshingLocation(
            true,
          );

          setLocationStatus(
            'CHECKING',
          );

          setLocationError(
            null,
          );

          try {
            let permission =
              await Location
                .getForegroundPermissionsAsync();

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
             * Do not reopen the system prompt automatically.
             * Permission is requested only after an explicit press.
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
                await Location
                  .requestForegroundPermissionsAsync();

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
              if (
                userCoordsRef.current
              ) {
                if (
                  locationSourceRef.current !==
                  'stamped'
                ) {
                  locationSourceRef.current =
                    'last-known';

                  setLocationSource(
                    'last-known',
                  );
                }
              }

              setLocationStatus(
                permission.status ===
                  Location
                    .PermissionStatus
                    .UNDETERMINED
                  ? 'PERMISSION_REQUIRED'
                  : 'DENIED',
              );

              setLocationError(
                permission.status ===
                  Location
                    .PermissionStatus
                    .UNDETERMINED
                  ? 'LOCATION ACCESS IS NOT ENABLED. MANUAL COORDINATES REMAIN AVAILABLE.'
                  : 'LOCATION ACCESS IS DENIED. MANUAL COORDINATES REMAIN AVAILABLE.',
              );

              return;
            }

            const servicesEnabled =
              await Location
                .hasServicesEnabledAsync();

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
              if (
                userCoordsRef.current &&
                locationSourceRef.current !==
                  'stamped'
              ) {
                locationSourceRef.current =
                  'last-known';

                setLocationSource(
                  'last-known',
                );
              }

              setLocationStatus(
                'SERVICES_OFF',
              );

              setLocationError(
                'DEVICE LOCATION SERVICES ARE SWITCHED OFF. MANUAL COORDINATES REMAIN AVAILABLE.',
              );

              return;
            }

            try {
              const position =
                await Location
                  .getCurrentPositionAsync(
                    {
                      accuracy:
                        Location
                          .Accuracy
                          .Balanced,
                    },
                  );

              if (
                requestSequence ===
                  locationRequestSequenceRef.current
              ) {
                applyLiveLocation(
                  position,
                );
              }
            } catch (
              error: unknown
            ) {
              if (__DEV__) {
                console.warn(
                  '[Treasi Inventory] Current location unavailable:',
                  error,
                );
              }
            }

            if (
              requestSequence !==
                locationRequestSequenceRef.current ||
              !isMountedRef.current
            ) {
              return;
            }

            const subscription =
              await Location
                .watchPositionAsync(
                  {
                    accuracy:
                      Location
                        .Accuracy
                        .Balanced,

                    timeInterval:
                      LOCATION_UPDATE_INTERVAL_MS,

                    distanceInterval:
                      LOCATION_UPDATE_DISTANCE_M,
                  },

                  applyLiveLocation,

                  (
                    message,
                  ) => {
                    if (
                      !isMountedRef.current
                    ) {
                      return;
                    }

                    if (__DEV__) {
                      console.warn(
                        '[Treasi Inventory] Location watcher error:',
                        message,
                      );
                    }

                    setLocationStatus(
                      'ERROR',
                    );

                    setLocationError(
                      'LIVE LOCATION UPDATES WERE INTERRUPTED. RETRY LOCATION OR ENTER COORDINATES MANUALLY.',
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

            if (
              !userCoordsRef.current
            ) {
              setLocationStatus(
                'CHECKING',
              );
            }
          } catch (
            error: unknown
          ) {
            if (__DEV__) {
              console.warn(
                '[Treasi Inventory] Location service failed:',
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

            setLocationStatus(
              'ERROR',
            );

            setLocationError(
              Platform.OS ===
                'web'
                ? 'BROWSER LOCATION IS UNAVAILABLE. USE LOCALHOST OR HTTPS, OR ENTER COORDINATES MANUALLY.'
                : 'DEVICE LOCATION IS UNAVAILABLE. ENTER COORDINATES MANUALLY OR RETRY.',
            );
          } finally {
            if (
              requestSequence ===
                locationRequestSequenceRef.current &&
              isMountedRef.current
            ) {
              setIsRefreshingLocation(
                false,
              );
            }
          }
        },
        [
          applyLiveLocation,
          stopLocationSubscription,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Location lifecycle                                                     */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      /*
       * Existing permission may be used immediately.
       * A new permission prompt is never opened automatically.
       */
      void startLocationService(
        false,
      );

      const handleAppStateChange =
        (
          state:
            AppStateStatus,
        ): void => {
          if (
            state ===
            'active'
          ) {
            void startLocationService(
              false,
            );

            return;
          }

          locationRequestSequenceRef.current +=
            1;

          stopLocationSubscription();
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

        stopLocationSubscription();
      };
    }, [
      startLocationService,
      stopLocationSubscription,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Location recovery                                                      */
    /* ---------------------------------------------------------------------- */

    const handleLocationRecovery =
      useCallback(
        async (): Promise<void> => {
          if (
            isRefreshingLocation
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
              if (__DEV__) {
                console.warn(
                  '[Treasi Inventory] Unable to open settings:',
                  error,
                );
              }

              showAccessibleAlert(
                'Settings Unavailable',
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
            showAccessibleAlert(
              'Browser Location Blocked',
              'Allow location for this site in your browser settings, then return to Treasi and retry the position check.',
            );

            return;
          }

          await startLocationService(
            true,
          );
        },
        [
          canAskLocationAgain,
          isRefreshingLocation,
          locationPermissionStatus,
          locationServicesEnabled,
          startLocationService,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Active treasure subscription                                           */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        !currentUserId
      ) {
        setFirestoreTreasures(
          [],
        );

        setIsLoading(
          false,
        );

        setFirestoreError(
          'EXPLORER SESSION REQUIRED',
        );

        return;
      }

      setIsLoading(
        true,
      );

      setFirestoreError(
        null,
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

      const unsubscribe =
        onSnapshot(
          treasuresQuery,

          (
            snapshot,
          ) => {
            const records =
              snapshot.docs
                .map(
                  (
                    snapshotDocument,
                  ) => {
                    const data =
                      snapshotDocument.data() as
                        Partial<TreasureDocument>;

                    return {
                      id:
                        snapshotDocument.id,

                      data: {
                        ...data,

                        treasureId:
                          data.treasureId ||
                          snapshotDocument.id,
                      } as TreasureDocument,
                    };
                  },
                )
                .filter(
                  ({
                    data,
                  }) =>
                    Boolean(
                      data.location &&
                        isValidCoordinate(
                          data.location
                            .latitude,
                          data.location
                            .longitude,
                        ) &&
                        typeof data.creatorId ===
                          'string' &&
                        typeof data.title ===
                          'string',
                    ),
                );

            setFirestoreTreasures(
              records,
            );

            setFirestoreError(
              null,
            );

            setIsLoading(
              false,
            );
          },

          (
            error,
          ) => {
            setIsLoading(
              false,
            );

            setFirestoreError(
              getFriendlyFirestoreError(
                error,
                'FAILED TO SYNCHRONISE FIELD CACHE DATA.',
              ),
            );
          },
        );

      return unsubscribe;
    }, [
      currentUserId,
      retryKey,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Current Explorer discoveries                                           */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        !currentUserId
      ) {
        setDiscoveredTreasureIds(
          new Set(),
        );

        setDiscoveryError(
          null,
        );

        return;
      }

      setDiscoveryError(
        null,
      );

      const discoveriesQuery =
        query(
          collection(
            db,
            'discoveries',
          ),

          where(
            'hunterId',
            '==',
            currentUserId,
          ),
        );

      const unsubscribe =
        onSnapshot(
          discoveriesQuery,

          (
            snapshot,
          ) => {
            const treasureIds =
              new Set<string>();

            snapshot.forEach(
              (
                snapshotDocument,
              ) => {
                const treasureId =
                  snapshotDocument.data()
                    .treasureId;

                if (
                  typeof treasureId ===
                    'string' &&
                  treasureId
                ) {
                  treasureIds.add(
                    treasureId,
                  );
                }
              },
            );

            setDiscoveredTreasureIds(
              treasureIds,
            );

            setDiscoveryError(
              null,
            );
          },

          (
            error,
          ) => {
            if (__DEV__) {
              console.warn(
                '[Treasi Inventory] Discovery subscription failed:',
                error,
              );
            }

            /*
             * Fail closed: payloads remain locked if discovery
             * verification cannot be synchronised.
             */
            setDiscoveredTreasureIds(
              new Set(),
            );

            setDiscoveryError(
              'DISCOVERY VERIFICATION SYNC OFFLINE',
            );
          },
        );

      return unsubscribe;
    }, [
      currentUserId,
      retryKey,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Nearby caches                                                          */
    /* ---------------------------------------------------------------------- */

    const nearbyCaches =
      useMemo<
        DisplayItem[]
      >(
        () => {
          if (
            !userCoords
          ) {
            return [];
          }

          return firestoreTreasures
            .map(
              ({
                id,
                data,
              }) => {
                const cacheLat =
                  data.location
                    .latitude;

                const cacheLng =
                  data.location
                    .longitude;

                const distanceKm =
                  calculateHaversineDistance(
                    userCoords.latitude,
                    userCoords.longitude,
                    cacheLat,
                    cacheLng,
                  );

                const isOwner =
                  data.creatorId ===
                  currentUserId;

                const isDiscovered =
                  discoveredTreasureIds.has(
                    id,
                  );

                const iconType: IconType =
                  isOwner
                    ? 'target'
                    : isDiscovered
                      ? 'trophy'
                      : 'map-pin';

                return {
                  id,

                  dbRef:
                    `CX-${id
                      .substring(
                        0,
                        6,
                      )
                      .toUpperCase()}`,

                  title:
                    data.title
                      ?.trim() ||
                    'UNNAMED CACHE',

                  category:
                    'cache' as const,

                  iconType,

                  coordinates:
                    formatCoordinates(
                      cacheLat,
                      cacheLng,
                    ),

                  rawLat:
                    cacheLat,

                  rawLng:
                    cacheLng,

                  distanceKm:
                    Number(
                      distanceKm.toFixed(
                        2,
                      ),
                    ),

                  status:
                    isOwner
                      ? 'MY PLANTED CACHE'
                      : isDiscovered
                        ? 'EXCAVATED'
                        : 'FIELD TARGET',

                  hint:
                    data.hint,

                  payloadText:
                    data.payloadText,

                  creatorId:
                    data.creatorId,

                  creatorName:
                    data.creatorName,

                  createdAt:
                    data.createdAt,

                  imageUrl:
                    data.imageUrl,

                  isDiscovered,
                };
              },
            )
            .filter(
              (
                item,
              ) =>
                item.distanceKm <=
                INVENTORY_RADIUS_KM,
            )
            .sort(
              (
                itemA,
                itemB,
              ) =>
                itemA.distanceKm -
                itemB.distanceKm,
            );
        },
        [
          currentUserId,
          discoveredTreasureIds,
          firestoreTreasures,
          userCoords,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Selection                                                              */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        isBurying
      ) {
        return;
      }

      if (
        selectedId &&
        nearbyCaches.some(
          (
            item,
          ) =>
            item.id ===
            selectedId,
        )
      ) {
        return;
      }

      setSelectedId(
        nearbyCaches[0]?.id ??
          null,
      );

      setIsEditing(
        false,
      );
    }, [
      isBurying,
      nearbyCaches,
      selectedId,
    ]);

    const selectedItem =
      useMemo(
        () =>
          nearbyCaches.find(
            (
              item,
            ) =>
              item.id ===
              selectedId,
          ) ??
          null,
        [
          nearbyCaches,
          selectedId,
        ],
      );

    const canRevealSelectedPayload =
      Boolean(
        selectedItem &&
          (
            selectedItem.creatorId ===
              currentUserId ||
            selectedItem.isDiscovered
          ),
      );

    /* ---------------------------------------------------------------------- */
    /* Form helpers                                                           */
    /* ---------------------------------------------------------------------- */

    const resetCreateForm =
      useCallback(
        (): void => {
          setNewTitle('');
          setNewHint('');
          setNewPayload('');
          setFieldErrors({});

          if (
            userCoords
          ) {
            setNewLat(
              userCoords
                .latitude
                .toFixed(6),
            );

            setNewLng(
              userCoords
                .longitude
                .toFixed(6),
            );

            coordinateInputsTouchedRef.current =
              false;

            return;
          }

          setNewLat('');
          setNewLng('');

          coordinateInputsTouchedRef.current =
            false;
        },
        [
          userCoords,
        ],
      );

    const openCreateMode =
      (): void => {
        setIsBurying(
          true,
        );

        setIsEditing(
          false,
        );

        setSelectedId(
          null,
        );

        setFieldErrors(
          {},
        );

        if (
          userCoords &&
          !newLat &&
          !newLng
        ) {
          setNewLat(
            userCoords
              .latitude
              .toFixed(6),
          );

          setNewLng(
            userCoords
              .longitude
              .toFixed(6),
          );

          coordinateInputsTouchedRef.current =
            false;
        }
      };

    const closeCreateMode =
      (): void => {
        setIsBurying(
          false,
        );

        setIsEditing(
          false,
        );

        resetCreateForm();
      };

    const useCurrentPosition =
      (): void => {
        if (
          !userCoords
        ) {
          showAccessibleAlert(
            'Position Unavailable',
            'Treasi does not currently have a valid position to stamp into this cache.',
          );

          return;
        }

        coordinateInputsTouchedRef.current =
          true;

        setNewLat(
          userCoords
            .latitude
            .toFixed(6),
        );

        setNewLng(
          userCoords
            .longitude
            .toFixed(6),
        );

        setFieldErrors(
          (
            current,
          ) => ({
            ...current,
            latitude: '',
            longitude: '',
          }),
        );

        announce(
          'Current position stamped into the cache form.',
        );
      };

    /* ---------------------------------------------------------------------- */
    /* Validation                                                             */
    /* ---------------------------------------------------------------------- */

    const validateCreateForm =
      (): boolean => {
        const errors:
          Record<
            string,
            string
          > = {};

        const title =
          newTitle.trim();

        const hint =
          newHint.trim();

        const payload =
          newPayload.trim();

        const latitude =
          parseCoordinate(
            newLat,
          );

        const longitude =
          parseCoordinate(
            newLng,
          );

        if (!title) {
          errors.title =
            'CACHE TITLE IS REQUIRED.';
        } else if (
          title.length <
          MIN_TITLE_LENGTH
        ) {
          errors.title =
            `CACHE TITLE MUST BE AT LEAST ${MIN_TITLE_LENGTH} CHARACTERS.`;
        } else if (
          title.length >
          MAX_TITLE_LENGTH
        ) {
          errors.title =
            `CACHE TITLE MUST NOT EXCEED ${MAX_TITLE_LENGTH} CHARACTERS.`;
        }

        if (
          hint.length >
          MAX_HINT_LENGTH
        ) {
          errors.hint =
            `CLUE MUST NOT EXCEED ${MAX_HINT_LENGTH} CHARACTERS.`;
        }

        if (
          payload.length >
          MAX_PAYLOAD_LENGTH
        ) {
          errors.payload =
            `PAYLOAD MUST NOT EXCEED ${MAX_PAYLOAD_LENGTH} CHARACTERS.`;
        }

        if (
          latitude === null ||
          latitude < -90 ||
          latitude > 90
        ) {
          errors.latitude =
            'LATITUDE MUST BE BETWEEN -90 AND 90.';
        }

        if (
          longitude === null ||
          longitude < -180 ||
          longitude > 180
        ) {
          errors.longitude =
            'LONGITUDE MUST BE BETWEEN -180 AND 180.';
        }

        setFieldErrors(
          errors,
        );

        const firstError =
          Object.values(
            errors,
          )[0];

        if (
          firstError
        ) {
          announce(
            firstError,
          );
        }

        return (
          Object.keys(
            errors,
          ).length === 0
        );
      };

    const validateEditForm =
      (): boolean => {
        const title =
          editTitle.trim();

        if (!title) {
          showAccessibleAlert(
            'Validation Error',
            'Cache title is required.',
          );

          return false;
        }

        if (
          title.length <
          MIN_TITLE_LENGTH
        ) {
          showAccessibleAlert(
            'Validation Error',
            `Cache title must be at least ${MIN_TITLE_LENGTH} characters.`,
          );

          return false;
        }

        if (
          title.length >
          MAX_TITLE_LENGTH
        ) {
          showAccessibleAlert(
            'Validation Error',
            `Cache title must not exceed ${MAX_TITLE_LENGTH} characters.`,
          );

          return false;
        }

        if (
          editHint
            .trim()
            .length >
          MAX_HINT_LENGTH
        ) {
          showAccessibleAlert(
            'Validation Error',
            `Cache clue must not exceed ${MAX_HINT_LENGTH} characters.`,
          );

          return false;
        }

        if (
          editPayload
            .trim()
            .length >
          MAX_PAYLOAD_LENGTH
        ) {
          showAccessibleAlert(
            'Validation Error',
            `Cache payload must not exceed ${MAX_PAYLOAD_LENGTH} characters.`,
          );

          return false;
        }

        return true;
      };

    /* ---------------------------------------------------------------------- */
    /* Create cache                                                           */
    /* ---------------------------------------------------------------------- */

    const handleBuryCache =
      async (): Promise<void> => {
        const user =
          auth.currentUser;

        if (!user) {
          showAccessibleAlert(
            'Authentication Required',
            'No active Explorer session was found.',
          );

          return;
        }

        if (
          isSubmitting ||
          !validateCreateForm()
        ) {
          return;
        }

        const latitude =
          parseCoordinate(
            newLat,
          );

        const longitude =
          parseCoordinate(
            newLng,
          );

        if (
          latitude === null ||
          longitude === null
        ) {
          return;
        }

        const title =
          newTitle
            .trim()
            .toUpperCase();

        /*
         * Empty optional values stay empty.
         * Treasi does not insert fake placeholder content into Firestore.
         */
        const hint =
          newHint.trim();

        const payloadText =
          newPayload.trim();

        const creatorName =
          getSafeCreatorName(
            currentProfile
              ?.username ||
              user.displayName ||
              user.email
                ?.split(
                  '@',
                )[0],
          ).slice(
            0,
            100,
          );

        setIsSubmitting(
          true,
        );

        try {
          const treasureReference =
            doc(
              collection(
                db,
                'treasures',
              ),
            );

          const activityReference =
            doc(
              collection(
                db,
                'activity_feed',
              ),
            );

          const batch =
            writeBatch(
              db,
            );

          batch.set(
            treasureReference,
            {
              treasureId:
                treasureReference.id,

              creatorId:
                user.uid,

              creatorName,

              title,

              hint,

              payloadText,

              location:
                new GeoPoint(
                  latitude,
                  longitude,
                ),

              isArchived:
                false,

              createdAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp(),
            },
          );

          batch.set(
            activityReference,
            {
              activityId:
                activityReference.id,

              userId:
                user.uid,

              username:
                creatorName,

              type:
                'TREASURE_HIDDEN',

              message:
                `PLANTED CACHE: ${title}`,

              targetId:
                treasureReference.id,

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

          setIsBurying(
            false,
          );

          setIsEditing(
            false,
          );

          setSelectedId(
            treasureReference.id,
          );

          resetCreateForm();

          showAccessibleAlert(
            'Cache Anchored',
            `${title} has been sealed into the field network.`,
          );
        } catch (
          error: unknown
        ) {
          showAccessibleAlert(
            'Creation Error',
            getFriendlyFirestoreError(
              error,
              'Treasi could not create the cache record.',
            ),
          );
        } finally {
          if (
            isMountedRef.current
          ) {
            setIsSubmitting(
              false,
            );
          }
        }
      };

    /* ---------------------------------------------------------------------- */
    /* Edit cache                                                             */
    /* ---------------------------------------------------------------------- */

    const beginEditing =
      (): void => {
        if (
          !selectedItem
        ) {
          return;
        }

        if (
          selectedItem.creatorId !==
          currentUserId
        ) {
          showAccessibleAlert(
            'Permission Error',
            'Only the cache creator can edit this record.',
          );

          return;
        }

        setEditTitle(
          selectedItem.title,
        );

        setEditHint(
          selectedItem.hint ??
            '',
        );

        setEditPayload(
          selectedItem.payloadText ??
            '',
        );

        setIsEditing(
          true,
        );
      };

    const handleUpdateCache =
      async (): Promise<void> => {
        if (
          !selectedItem ||
          !currentUserId ||
          isSubmitting
        ) {
          return;
        }

        if (
          selectedItem.creatorId !==
          currentUserId
        ) {
          showAccessibleAlert(
            'Permission Error',
            'Only the cache creator can edit this record.',
          );

          return;
        }

        if (
          !validateEditForm()
        ) {
          return;
        }

        setIsSubmitting(
          true,
        );

        try {
          await updateDoc(
            doc(
              db,
              'treasures',
              selectedItem.id,
            ),
            {
              title:
                editTitle
                  .trim()
                  .toUpperCase(),

              hint:
                editHint.trim(),

              payloadText:
                editPayload.trim(),

              updatedAt:
                serverTimestamp(),
            },
          );

          if (
            !isMountedRef.current
          ) {
            return;
          }

          setIsEditing(
            false,
          );

          showAccessibleAlert(
            'Record Updated',
            'Cache metadata has been updated successfully.',
          );
        } catch (
          error: unknown
        ) {
          showAccessibleAlert(
            'Update Error',
            getFriendlyFirestoreError(
              error,
              'Treasi could not save the cache changes.',
            ),
          );
        } finally {
          if (
            isMountedRef.current
          ) {
            setIsSubmitting(
              false,
            );
          }
        }
      };

    /* ---------------------------------------------------------------------- */
    /* Archive cache                                                          */
    /* ---------------------------------------------------------------------- */

    const handleArchiveCache =
      (): void => {
        if (
          !selectedItem ||
          !currentUserId ||
          isSubmitting
        ) {
          return;
        }

        if (
          selectedItem.creatorId !==
          currentUserId
        ) {
          showAccessibleAlert(
            'Permission Error',
            'Only the cache creator can archive this record.',
          );

          return;
        }

        Alert.alert(
          'Archive Cache',
          `Deactivate “${selectedItem.title}” from active maps and Inventory?`,
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

              onPress: () => {
                const item =
                  selectedItem;

                const user =
                  auth.currentUser;

                if (
                  !item ||
                  !user ||
                  isSubmitting
                ) {
                  return;
                }

                setIsSubmitting(
                  true,
                );

                const creatorName =
                  getSafeCreatorName(
                    currentProfile
                      ?.username ||
                      user.displayName ||
                      item.creatorName ||
                      user.email
                        ?.split(
                          '@',
                        )[0],
                  ).slice(
                    0,
                    100,
                  );

                const treasureReference =
                  doc(
                    db,
                    'treasures',
                    item.id,
                  );

                const activityReference =
                  doc(
                    collection(
                      db,
                      'activity_feed',
                    ),
                  );

                const batch =
                  writeBatch(
                    db,
                  );

                batch.update(
                  treasureReference,
                  {
                    isArchived:
                      true,

                    updatedAt:
                      serverTimestamp(),
                  },
                );

                batch.set(
                  activityReference,
                  {
                    activityId:
                      activityReference.id,

                    userId:
                      user.uid,

                    username:
                      creatorName,

                    type:
                      'TREASURE_ARCHIVED',

                    message:
                      `ARCHIVED CACHE: ${item.title}`,

                    targetId:
                      item.id,

                    createdAt:
                      serverTimestamp(),
                  },
                );

                batch
                  .commit()
                  .then(() => {
                    if (
                      !isMountedRef.current
                    ) {
                      return;
                    }

                    setSelectedId(
                      null,
                    );

                    setIsEditing(
                      false,
                    );

                    showAccessibleAlert(
                      'Cache Archived',
                      'The cache is hidden from active field lists while its discovery history remains available.',
                    );
                  })
                  .catch(
                    (
                      error:
                        unknown,
                    ) => {
                      showAccessibleAlert(
                        'Archive Error',
                        getFriendlyFirestoreError(
                          error,
                          'Treasi could not archive this cache.',
                        ),
                      );
                    },
                  )
                  .finally(
                    () => {
                      if (
                        isMountedRef.current
                      ) {
                        setIsSubmitting(
                          false,
                        );
                      }
                    },
                  );
              },
            },
          ],
        );
      };

    /* ---------------------------------------------------------------------- */
    /* Permanent deletion                                                     */
    /* ---------------------------------------------------------------------- */

    const handleDeleteCache =
      (): void => {
        if (
          !selectedItem ||
          !currentUserId ||
          isSubmitting
        ) {
          return;
        }

        if (
          selectedItem.creatorId !==
          currentUserId
        ) {
          showAccessibleAlert(
            'Permission Error',
            'Only the cache creator can permanently delete this record.',
          );

          return;
        }

        Alert.alert(
          'Permanent Deletion',
          `Permanently delete “${selectedItem.title}”? This cannot be undone. Related discovery records will also be removed.`,
          [
            {
              text:
                'CANCEL',
              style:
                'cancel',
            },
            {
              text:
                'DELETE PERMANENTLY',
              style:
                'destructive',

              onPress: () => {
                const item =
                  selectedItem;

                if (
                  !item ||
                  isSubmitting
                ) {
                  return;
                }

                setIsSubmitting(
                  true,
                );

                const executeDeletion =
                  async (): Promise<void> => {
                    try {
                      const discoverySnapshot =
                        await getDocs(
                          query(
                            collection(
                              db,
                              'discoveries',
                            ),

                            where(
                              'treasureId',
                              '==',
                              item.id,
                            ),
                          ),
                        );

                      /*
                       * Keep the normal case atomic.
                       * Extremely large histories are split below Firestore's
                       * 500-write batch limit, with the treasure deleted last.
                       */
                      if (
                        discoverySnapshot
                          .docs
                          .length <
                        FIRESTORE_SAFE_BATCH_SIZE
                      ) {
                        const batch =
                          writeBatch(
                            db,
                          );

                        discoverySnapshot
                          .docs
                          .forEach(
                            (
                              discovery,
                            ) => {
                              batch.delete(
                                discovery.ref,
                              );
                            },
                          );

                        batch.delete(
                          doc(
                            db,
                            'treasures',
                            item.id,
                          ),
                        );

                        await batch.commit();
                      } else {
                        for (
                          let start = 0;
                          start <
                          discoverySnapshot
                            .docs
                            .length;
                          start +=
                            FIRESTORE_SAFE_BATCH_SIZE
                        ) {
                          const batch =
                            writeBatch(
                              db,
                            );

                          discoverySnapshot
                            .docs
                            .slice(
                              start,
                              start +
                                FIRESTORE_SAFE_BATCH_SIZE,
                            )
                            .forEach(
                              (
                                discovery,
                              ) => {
                                batch.delete(
                                  discovery.ref,
                                );
                              },
                            );

                          await batch.commit();
                        }

                        const treasureBatch =
                          writeBatch(
                            db,
                          );

                        treasureBatch.delete(
                          doc(
                            db,
                            'treasures',
                            item.id,
                          ),
                        );

                        await treasureBatch.commit();
                      }

                      if (
                        !isMountedRef.current
                      ) {
                        return;
                      }

                      setSelectedId(
                        null,
                      );

                      setIsEditing(
                        false,
                      );

                      showAccessibleAlert(
                        'Record Deleted',
                        'The cache and its related discovery records were permanently removed. Historical activity signals remain in the field log.',
                      );
                    } catch (
                      error:
                        unknown
                    ) {
                      showAccessibleAlert(
                        'Deletion Failure',
                        getFriendlyFirestoreError(
                          error,
                          'Treasi could not permanently delete this cache.',
                        ),
                      );
                    } finally {
                      if (
                        isMountedRef.current
                      ) {
                        setIsSubmitting(
                          false,
                        );
                      }
                    }
                  };

                void executeDeletion();
              },
            },
          ],
        );
      };

    /* ---------------------------------------------------------------------- */
    /* Hunt navigation                                                        */
    /* ---------------------------------------------------------------------- */

    const handleTrackSelectedCache =
      (): void => {
        if (
          !selectedItem ||
          !onNavigate
        ) {
          return;
        }

        if (
          selectedItem.creatorId ===
          currentUserId
        ) {
          showAccessibleAlert(
            'Own Cache',
            'Your own planted cache cannot be used as a discovery target.',
          );

          return;
        }

        onNavigate(
          'HUNT',
          {
            treasureId:
              selectedItem.id,

            mode:
              'hunt',

            latitude:
              selectedItem.rawLat,

            longitude:
              selectedItem.rawLng,
          },
        );
      };

    /* ---------------------------------------------------------------------- */
    /* Retry                                                                  */
    /* ---------------------------------------------------------------------- */

    const handleRetryData =
      (): void => {
        setFirestoreError(
          null,
        );

        setDiscoveryError(
          null,
        );

        setProfileError(
          null,
        );

        setIsLoading(
          true,
        );

        setRetryKey(
          (
            current,
          ) =>
            current + 1,
        );

        announce(
          'Retrying Inventory synchronisation.',
        );
      };

    /* ---------------------------------------------------------------------- */
    /* Location labels                                                        */
    /* ---------------------------------------------------------------------- */

    const locationStatusText =
      useMemo(
        () => {
          switch (
            locationStatus
          ) {
            case 'CHECKING':
              return 'CHECKING POSITION';

            case 'READY':
              switch (
                locationSource
              ) {
                case 'live':
                  return 'CURRENT POSITION READY';

                case 'stamped':
                  return 'STAMPED MAP POSITION READY';

                case 'last-known':
                  return 'LAST KNOWN POSITION';

                default:
                  return userCoords
                    ? 'POSITION READY'
                    : 'POSITION UNAVAILABLE';
              }

            case 'PERMISSION_REQUIRED':
              return 'LOCATION ACCESS NOT ENABLED';

            case 'DENIED':
              return 'LOCATION ACCESS DENIED';

            case 'SERVICES_OFF':
              return 'LOCATION SERVICES OFF';

            default:
              return 'LOCATION UNAVAILABLE';
          }
        },
        [
          locationSource,
          locationStatus,
          userCoords,
        ],
      );

    const locationActionLabel =
      useMemo(
        () => {
          if (
            isRefreshingLocation ||
            locationStatus ===
              'CHECKING'
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
            locationStatus ===
              'PERMISSION_REQUIRED' ||
            locationStatus ===
              'DENIED'
          ) {
            return 'ENABLE LOCATION';
          }

          return 'REFRESH POSITION';
        },
        [
          canAskLocationAgain,
          isRefreshingLocation,
          locationPermissionStatus,
          locationServicesEnabled,
          locationStatus,
        ],
      );

    const syncWarningText =
      useMemo(
        () =>
          [
            profileError,
            discoveryError,
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
          discoveryError,
          profileError,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Render helpers                                                         */
    /* ---------------------------------------------------------------------- */

    const renderErrorState =
      (): React.ReactNode => (
        <View
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={
            styles.stateContainer
          }
        >
          <Ionicons
            name="warning-outline"
            size={30}
            color={
              COLOURS.rust700
            }
          />

          <Text
            style={
              styles.stateTitle
            }
          >
            FIELD CACHE SYNC FAILED
          </Text>

          <Text
            style={
              styles.stateText
            }
          >
            {
              firestoreError
            }
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry cache synchronisation"
            onPress={
              handleRetryData
            }
            style={({
              pressed,
            }) => [
              styles.stateActionButton,

              pressed &&
                styles.primaryPressed,
            ]}
          >
            <Text
              style={
                styles.stateActionText
              }
            >
              RETRY FIELD LINK
            </Text>
          </Pressable>
        </View>
      );

    const renderLocationUnavailable =
      (): React.ReactNode => (
        <View
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={
            styles.stateContainer
          }
        >
          <Ionicons
            name="navigate-outline"
            size={30}
            color={
              COLOURS.rust700
            }
          />

          <Text
            style={
              styles.stateTitle
            }
          >
            POSITION REQUIRED
          </Text>

          <Text
            style={
              styles.stateText
            }
          >
            {locationError ||
              'Treasi needs a valid position before it can calculate the 20 km Inventory radius.'}
          </Text>

          <Text
            style={
              styles.stateHint
            }
          >
            You can still bury a cache by entering valid coordinates manually.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              locationActionLabel
            }
            accessibilityState={{
              disabled:
                isRefreshingLocation,
              busy:
                isRefreshingLocation,
            }}
            disabled={
              isRefreshingLocation
            }
            onPress={() => {
              void handleLocationRecovery();
            }}
            style={({
              pressed,
            }) => [
              styles.stateActionButton,

              isRefreshingLocation &&
                styles.disabledButton,

              pressed &&
                !isRefreshingLocation &&
                styles.primaryPressed,
            ]}
          >
            {isRefreshingLocation ? (
              <ActivityIndicator
                size="small"
                color={
                  COLOURS.parchment100
                }
              />
            ) : (
              <Ionicons
                name="locate-outline"
                size={17}
                color={
                  COLOURS.parchment100
                }
              />
            )}

            <Text
              style={
                styles.stateActionText
              }
            >
              {
                locationActionLabel
              }
            </Text>
          </Pressable>
        </View>
      );

    /* ---------------------------------------------------------------------- */
    /* Render                                                                 */
    /* ---------------------------------------------------------------------- */

    return (
      <KeyboardAvoidingView
        style={
          styles.screen
        }
        behavior={
          Platform.OS ===
          'ios'
            ? 'padding'
            : undefined
        }
      >
        <View
          style={[
            styles.splitWrapper,

            {
              flexDirection:
                isLandscape
                  ? 'row'
                  : 'column',

              paddingLeft:
                Math.max(
                  insets.left,
                  12,
                ),

              paddingRight:
                Math.max(
                  insets.right,
                  12,
                ),

              paddingTop:
                Math.max(
                  insets.top,
                  10,
                ),

              paddingBottom:
                Math.max(
                  insets.bottom,
                  10,
                ),
            },
          ]}
        >
          {/* ================================================================ */}
          {/* 60% — CACHE WORKSPACE                                            */}
          {/* ================================================================ */}

          <View
            style={[
              styles.leftViewport,

              isLandscape
                ? styles.leftViewportLandscape
                : styles.leftViewportPortrait,
            ]}
          >
            <View
              style={
                styles.workspaceHeader
              }
            >
              <View
                style={
                  styles.workspaceHeading
                }
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="cube-outline"
                  size={20}
                  color={
                    COLOURS.rust700
                  }
                />

                <View
                  style={
                    styles.headerTextGroup
                  }
                >
                  <Text
                    accessibilityRole="header"
                    maxFontSizeMultiplier={
                      1.6
                    }
                    style={
                      styles.workspaceTitle
                    }
                  >
                    FIELD CACHE INVENTORY
                  </Text>

                  <Text
                    maxFontSizeMultiplier={
                      1.5
                    }
                    style={
                      styles.workspaceSubtitle
                    }
                  >
                    ACTIVE CACHES WITHIN{' '}
                    {
                      INVENTORY_RADIUS_KM
                    }
                    KM OF THE RANGE ORIGIN
                  </Text>
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isBurying
                    ? 'Cancel new cache creation'
                    : 'Bury a new cache'
                }
                accessibilityHint={
                  isBurying
                    ? 'Returns to the active cache list.'
                    : 'Opens the cache creation form.'
                }
                onPress={
                  isBurying
                    ? closeCreateMode
                    : openCreateMode
                }
                style={({
                  pressed,
                }) => [
                  styles.buryToggleButton,

                  pressed &&
                    styles.darkPressed,
                ]}
              >
                <Ionicons
                  name={
                    isBurying
                      ? 'chevron-back'
                      : 'add'
                  }
                  size={18}
                  color={
                    COLOURS.parchment100
                  }
                />

                <Text
                  style={
                    styles.buryToggleText
                  }
                >
                  {isBurying
                    ? 'CANCEL'
                    : 'BURY NEW CACHE'}
                </Text>
              </Pressable>
            </View>

            {/* -------------------------------------------------------------- */}
            {/* Position                                                       */}
            {/* -------------------------------------------------------------- */}

            <View
              accessible
              accessibilityLabel={`${locationStatusText}. ${
                locationError ??
                ''
              }`}
              style={
                styles.positionBar
              }
            >
              <View
                accessible={
                  false
                }
                importantForAccessibility="no-hide-descendants"
                style={
                  styles.positionIdentity
                }
              >
                <Ionicons
                  name="navigate-outline"
                  size={17}
                  color={
                    locationStatus ===
                    'READY'
                      ? COLOURS.success700
                      : COLOURS.rust700
                  }
                />

                <View
                  style={
                    styles.positionTextGroup
                  }
                >
                  <Text
                    style={
                      styles.positionStatusText
                    }
                  >
                    {
                      locationStatusText
                    }
                  </Text>

                  {userCoords ? (
                    <Text
                      numberOfLines={1}
                      style={
                        styles.positionCoordinatesText
                      }
                    >
                      {formatCoordinates(
                        userCoords.latitude,
                        userCoords.longitude,
                      )}
                    </Text>
                  ) : null}
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  locationActionLabel
                }
                accessibilityHint="Checks or restores the position used for the Inventory radius."
                accessibilityState={{
                  disabled:
                    isRefreshingLocation,
                  busy:
                    isRefreshingLocation,
                }}
                disabled={
                  isRefreshingLocation
                }
                onPress={() => {
                  void handleLocationRecovery();
                }}
                style={({
                  pressed,
                }) => [
                  styles.positionActionButton,

                  isRefreshingLocation &&
                    styles.disabledButton,

                  pressed &&
                    !isRefreshingLocation &&
                    styles.lightPressed,
                ]}
              >
                {isRefreshingLocation ? (
                  <ActivityIndicator
                    size="small"
                    color={
                      COLOURS.ink900
                    }
                  />
                ) : (
                  <Ionicons
                    name="locate-outline"
                    size={16}
                    color={
                      COLOURS.ink900
                    }
                  />
                )}

                <Text
                  style={
                    styles.positionActionText
                  }
                >
                  {
                    locationActionLabel
                  }
                </Text>
              </Pressable>
            </View>

            {/* -------------------------------------------------------------- */}
            {/* Create cache                                                   */}
            {/* -------------------------------------------------------------- */}

            {isBurying ? (
              <ScrollView
                style={
                  styles.formContainer
                }
                contentContainerStyle={
                  styles.formContentContainer
                }
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={
                  false
                }
              >
                <Text
                  accessibilityRole="header"
                  style={
                    styles.formTitle
                  }
                >
                  FABRICATE & BURY NEW CACHE
                </Text>

                <Text
                  maxFontSizeMultiplier={
                    1.7
                  }
                  style={
                    styles.formDescription
                  }
                >
                  Create a live cache using real coordinates. Optional fields stay empty rather than storing mock placeholder content.
                </Text>

                <Text
                  style={
                    styles.label
                  }
                >
                  CACHE TITLE / DESIGNATION
                </Text>

                <TextInput
                  accessibilityLabel="Cache title"
                  accessibilityHint="Enter a title between three and eighty characters."
                  autoCapitalize="characters"
                  autoCorrect={
                    false
                  }
                  editable={
                    !isSubmitting
                  }
                  maxLength={
                    MAX_TITLE_LENGTH
                  }
                  placeholder="e.g. QUADRANGLE CLOCKTOWER"
                  placeholderTextColor={
                    COLOURS.bronze700
                  }
                  selectionColor={
                    COLOURS.rust700
                  }
                  value={
                    newTitle
                  }
                  onChangeText={(
                    value,
                  ) => {
                    setNewTitle(
                      value,
                    );

                    if (
                      fieldErrors.title
                    ) {
                      setFieldErrors(
                        (
                          current,
                        ) => ({
                          ...current,
                          title: '',
                        }),
                      );
                    }
                  }}
                  style={[
                    styles.input,

                    fieldErrors.title &&
                      styles.inputError,
                  ]}
                />

                {fieldErrors.title ? (
                  <Text
                    accessibilityLiveRegion="assertive"
                    style={
                      styles.errorText
                    }
                  >
                    {
                      fieldErrors.title
                    }
                  </Text>
                ) : null}

                <Text
                  style={
                    styles.label
                  }
                >
                  CLUE / RIDDLE HINT
                </Text>

                <TextInput
                  accessibilityLabel="Cache clue or riddle hint"
                  editable={
                    !isSubmitting
                  }
                  maxLength={
                    MAX_HINT_LENGTH
                  }
                  multiline
                  numberOfLines={3}
                  placeholder="Enter an optional clue..."
                  placeholderTextColor={
                    COLOURS.bronze700
                  }
                  selectionColor={
                    COLOURS.rust700
                  }
                  textAlignVertical="top"
                  value={
                    newHint
                  }
                  onChangeText={
                    setNewHint
                  }
                  style={[
                    styles.input,
                    styles.textArea,
                  ]}
                />

                <Text
                  style={
                    styles.characterHelp
                  }
                >
                  {
                    newHint.length
                  }
                  /
                  {
                    MAX_HINT_LENGTH
                  }
                </Text>

                <Text
                  style={
                    styles.label
                  }
                >
                  SECRET PAYLOAD CONTENT
                </Text>

                <TextInput
                  accessibilityLabel="Secret payload content"
                  accessibilityHint="This content is revealed in the normal interface after an Explorer excavates the cache."
                  editable={
                    !isSubmitting
                  }
                  maxLength={
                    MAX_PAYLOAD_LENGTH
                  }
                  multiline
                  numberOfLines={3}
                  placeholder="Optional message revealed after excavation..."
                  placeholderTextColor={
                    COLOURS.bronze700
                  }
                  selectionColor={
                    COLOURS.rust700
                  }
                  textAlignVertical="top"
                  value={
                    newPayload
                  }
                  onChangeText={
                    setNewPayload
                  }
                  style={[
                    styles.input,
                    styles.textArea,
                  ]}
                />

                <Text
                  style={
                    styles.characterHelp
                  }
                >
                  {
                    newPayload.length
                  }
                  /
                  {
                    MAX_PAYLOAD_LENGTH
                  }
                </Text>

                <View
                  style={
                    styles.coordinateHeader
                  }
                >
                  <Text
                    style={
                      styles.labelInline
                    }
                  >
                    CACHE LOCATION
                  </Text>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Use current position for cache"
                    accessibilityState={{
                      disabled:
                        !userCoords ||
                        isSubmitting,
                    }}
                    disabled={
                      !userCoords ||
                      isSubmitting
                    }
                    onPress={
                      useCurrentPosition
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.usePositionButton,

                      (
                        !userCoords ||
                        isSubmitting
                      ) &&
                        styles.disabledButton,

                      pressed &&
                        userCoords &&
                        !isSubmitting &&
                        styles.lightPressed,
                    ]}
                  >
                    <Ionicons
                      name="locate-outline"
                      size={16}
                      color={
                        COLOURS.ink900
                      }
                    />

                    <Text
                      style={
                        styles.usePositionText
                      }
                    >
                      USE POSITION
                    </Text>
                  </Pressable>
                </View>

                <View
                  style={
                    styles.coordsRow
                  }
                >
                  <View
                    style={
                      styles.coordinateField
                    }
                  >
                    <Text
                      style={
                        styles.coordinateLabel
                      }
                    >
                      LATITUDE
                    </Text>

                    <TextInput
                      accessibilityLabel="Cache latitude"
                      accessibilityHint="Enter a latitude between minus ninety and ninety degrees."
                      editable={
                        !isSubmitting
                      }
                      keyboardType="numbers-and-punctuation"
                      placeholder="-25.000000"
                      placeholderTextColor={
                        COLOURS.bronze700
                      }
                      selectionColor={
                        COLOURS.rust700
                      }
                      value={
                        newLat
                      }
                      onChangeText={(
                        value,
                      ) => {
                        coordinateInputsTouchedRef.current =
                          true;

                        setNewLat(
                          value,
                        );

                        if (
                          fieldErrors.latitude
                        ) {
                          setFieldErrors(
                            (
                              current,
                            ) => ({
                              ...current,
                              latitude: '',
                            }),
                          );
                        }
                      }}
                      style={[
                        styles.input,

                        fieldErrors.latitude &&
                          styles.inputError,
                      ]}
                    />

                    {fieldErrors.latitude ? (
                      <Text
                        accessibilityLiveRegion="assertive"
                        style={
                          styles.errorText
                        }
                      >
                        {
                          fieldErrors.latitude
                        }
                      </Text>
                    ) : null}
                  </View>

                  <View
                    style={
                      styles.coordinateField
                    }
                  >
                    <Text
                      style={
                        styles.coordinateLabel
                      }
                    >
                      LONGITUDE
                    </Text>

                    <TextInput
                      accessibilityLabel="Cache longitude"
                      accessibilityHint="Enter a longitude between minus one hundred and eighty and one hundred and eighty degrees."
                      editable={
                        !isSubmitting
                      }
                      keyboardType="numbers-and-punctuation"
                      placeholder="28.000000"
                      placeholderTextColor={
                        COLOURS.bronze700
                      }
                      selectionColor={
                        COLOURS.rust700
                      }
                      value={
                        newLng
                      }
                      onChangeText={(
                        value,
                      ) => {
                        coordinateInputsTouchedRef.current =
                          true;

                        setNewLng(
                          value,
                        );

                        if (
                          fieldErrors.longitude
                        ) {
                          setFieldErrors(
                            (
                              current,
                            ) => ({
                              ...current,
                              longitude: '',
                            }),
                          );
                        }
                      }}
                      style={[
                        styles.input,

                        fieldErrors.longitude &&
                          styles.inputError,
                      ]}
                    />

                    {fieldErrors.longitude ? (
                      <Text
                        accessibilityLiveRegion="assertive"
                        style={
                          styles.errorText
                        }
                      >
                        {
                          fieldErrors.longitude
                        }
                      </Text>
                    ) : null}
                  </View>
                </View>

                <Text
                  maxFontSizeMultiplier={
                    1.7
                  }
                  style={
                    styles.coordinateHelp
                  }
                >
                  Manual coordinates remain available when GPS permission or device location services are unavailable.
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    isSubmitting
                      ? 'Burying cache'
                      : 'Seal and bury cache'
                  }
                  accessibilityHint="Creates the treasure and its field activity record together."
                  accessibilityState={{
                    disabled:
                      isSubmitting,
                    busy:
                      isSubmitting,
                  }}
                  disabled={
                    isSubmitting
                  }
                  onPress={() => {
                    void handleBuryCache();
                  }}
                  style={({
                    pressed,
                  }) => [
                    styles.sealAndBuryButton,

                    isSubmitting &&
                      styles.disabledButton,

                    pressed &&
                      !isSubmitting &&
                      styles.primaryPressed,
                  ]}
                >
                  {isSubmitting ? (
                    <ActivityIndicator
                      size="small"
                      color={
                        COLOURS.parchment100
                      }
                    />
                  ) : (
                    <Ionicons
                      name="cube-outline"
                      size={19}
                      color={
                        COLOURS.parchment100
                      }
                    />
                  )}

                  <Text
                    style={
                      styles.sealAndBuryText
                    }
                  >
                    {isSubmitting
                      ? 'SEALING CACHE...'
                      : 'SEAL & BURY CACHE'}
                  </Text>
                </Pressable>
              </ScrollView>
            ) : firestoreError ? (
              renderErrorState()
            ) : isLoading ? (
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="Scanning active field caches"
                style={
                  styles.loadingContainer
                }
              >
                <ActivityIndicator
                  size="large"
                  color={
                    COLOURS.rust700
                  }
                />

                <Text
                  style={
                    styles.loadingText
                  }
                >
                  SCANNING RADIAL FIELD…
                </Text>
              </View>
            ) : !userCoords ? (
              renderLocationUnavailable()
            ) : (
              <ScrollView
                accessibilityLabel={`Active caches within ${INVENTORY_RADIUS_KM} kilometres`}
                contentContainerStyle={
                  styles.gridContainer
                }
                showsVerticalScrollIndicator={
                  false
                }
              >
                {nearbyCaches.length ===
                0 ? (
                  <View
                    accessible
                    accessibilityLabel={`No active caches were found within ${INVENTORY_RADIUS_KM} kilometres.`}
                    style={
                      styles.emptyState
                    }
                  >
                    <Ionicons
                      name="radio-outline"
                      size={32}
                      color={
                        COLOURS.ink700
                      }
                    />

                    <Text
                      style={
                        styles.emptyTitle
                      }
                    >
                      NO ACTIVE CACHES DETECTED
                    </Text>

                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={
                        styles.emptyText
                      }
                    >
                      There are no active caches within{' '}
                      {
                        INVENTORY_RADIUS_KM
                      }
                      km of the current range origin.
                    </Text>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Bury a new cache"
                      onPress={
                        openCreateMode
                      }
                      style={({
                        pressed,
                      }) => [
                        styles.emptyCreateButton,

                        pressed &&
                          styles.primaryPressed,
                      ]}
                    >
                      <Ionicons
                        name="add"
                        size={18}
                        color={
                          COLOURS.parchment100
                        }
                      />

                      <Text
                        style={
                          styles.emptyCreateText
                        }
                      >
                        BURY NEW CACHE
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <View
                    style={
                      styles.grid
                    }
                  >
                    {nearbyCaches.map(
                      (
                        item,
                      ) => {
                        const isSelected =
                          selectedItem
                            ?.id ===
                          item.id;

                        const isOwner =
                          item.creatorId ===
                          currentUserId;

                        return (
                          <Pressable
                            key={
                              item.id
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`${item.title}. ${item.distanceKm} kilometres away. ${
                              isOwner
                                ? 'Planted by you.'
                                : item.isDiscovered
                                  ? 'Previously excavated.'
                                  : `Created by ${getSafeCreatorName(
                                      item.creatorName,
                                    )}.`
                            }`}
                            accessibilityHint="Selects this cache to inspect its field record."
                            accessibilityState={{
                              selected:
                                isSelected,
                            }}
                            onPress={() => {
                              setSelectedId(
                                item.id,
                              );

                              setIsEditing(
                                false,
                              );
                            }}
                            style={({
                              pressed,
                            }) => [
                              styles.itemCard,

                              isSelected &&
                                styles.itemCardSelected,

                              isOwner &&
                                styles.itemCardOwner,

                              item.isDiscovered &&
                                !isOwner &&
                                styles.itemCardDiscovered,

                              pressed &&
                                styles.cardPressed,
                            ]}
                          >
                            <View
                              accessible={
                                false
                              }
                              importantForAccessibility="no-hide-descendants"
                              style={
                                styles.cardHeaderRow
                              }
                            >
                              <ItemIcon
                                type={
                                  item.iconType
                                }
                                size={20}
                                colour={
                                  isSelected
                                    ? COLOURS.rust700
                                    : COLOURS.ink900
                                }
                              />

                              <View
                                style={
                                  styles.distanceBadge
                                }
                              >
                                <Ionicons
                                  name="navigate-outline"
                                  size={12}
                                  color={
                                    COLOURS.ink900
                                  }
                                />

                                <Text
                                  style={
                                    styles.distanceBadgeText
                                  }
                                >
                                  {
                                    item.distanceKm
                                  }{' '}
                                  KM
                                </Text>
                              </View>
                            </View>

                            <Text
                              maxFontSizeMultiplier={
                                1.6
                              }
                              numberOfLines={2}
                              style={
                                styles.itemText
                              }
                            >
                              {
                                item.title
                              }
                            </Text>

                            <Text
                              maxFontSizeMultiplier={
                                1.5
                              }
                              numberOfLines={1}
                              style={
                                styles.itemSubtext
                              }
                            >
                              {
                                item.status
                              }
                            </Text>
                          </Pressable>
                        );
                      },
                    )}
                  </View>
                )}
              </ScrollView>
            )}
          </View>

          {/* ================================================================ */}
          {/* 40% — INSPECTION CONSOLE                                        */}
          {/* ================================================================ */}

          <View
            style={[
              styles.rightViewport,

              isLandscape
                ? styles.rightViewportLandscape
                : styles.rightViewportPortrait,
            ]}
          >
            <View
              style={
                styles.consoleHeader
              }
            >
              <View
                style={
                  styles.consoleHeading
                }
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="scan-outline"
                  size={18}
                  color={
                    COLOURS.bronze400
                  }
                />

                <View
                  style={
                    styles.headerTextGroup
                  }
                >
                  <Text
                    accessibilityRole="header"
                    style={
                      styles.consoleTitle
                    }
                  >
                    INSPECTION TELEMETRY
                  </Text>

                  <Text
                    style={
                      styles.consoleSubtitle
                    }
                  >
                    SELECTED CACHE FIELD RECORD
                  </Text>
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Return to field map"
                accessibilityHint="Leaves Inventory and returns to the previous field view."
                onPress={
                  onBack
                }
                style={({
                  pressed,
                }) => [
                  styles.backButton,

                  pressed &&
                    styles.darkPressed,
                ]}
              >
                <Ionicons
                  name="arrow-back"
                  size={18}
                  color={
                    COLOURS.bronze400
                  }
                />
              </Pressable>
            </View>

            {syncWarningText ? (
              <View
                accessible
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={
                  styles.syncWarningCard
                }
              >
                <Ionicons
                  name="cloud-offline-outline"
                  size={16}
                  color={
                    COLOURS.danger300
                  }
                />

                <Text
                  style={
                    styles.syncWarningText
                  }
                >
                  {
                    syncWarningText
                  }
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry Inventory data synchronisation"
                  onPress={
                    handleRetryData
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.syncRetryButton,

                    pressed &&
                      styles.darkPressed,
                  ]}
                >
                  <Text
                    style={
                      styles.syncRetryText
                    }
                  >
                    RETRY
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <View
              style={
                styles.consoleBody
              }
            >
              {isBurying ? (
                <View
                  accessible
                  accessibilityLabel="Cache creation mode is active. Complete the form in the left workspace."
                  style={
                    styles.consoleState
                  }
                >
                  <Ionicons
                    name="cube-outline"
                    size={34}
                    color={
                      COLOURS.bronze400
                    }
                  />

                  <Text
                    style={
                      styles.consoleStateTitle
                    }
                  >
                    CACHE FABRICATION ACTIVE
                  </Text>

                  <Text
                    maxFontSizeMultiplier={
                      1.7
                    }
                    style={
                      styles.consoleStateText
                    }
                  >
                    Complete the cache record in the 60% field workspace. Coordinates may come from GPS or manual entry.
                  </Text>
                </View>
              ) : selectedItem ? (
                isEditing ? (
                  <ScrollView
                    style={
                      styles.editScroll
                    }
                    contentContainerStyle={
                      styles.editScrollContent
                    }
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={
                      false
                    }
                  >
                    <Text
                      accessibilityRole="header"
                      style={
                        styles.editHeader
                      }
                    >
                      EDIT CACHE RECORD
                    </Text>

                    <Text
                      style={
                        styles.darkLabel
                      }
                    >
                      TITLE
                    </Text>

                    <TextInput
                      accessibilityLabel="Edit cache title"
                      autoCapitalize="characters"
                      autoCorrect={
                        false
                      }
                      editable={
                        !isSubmitting
                      }
                      maxLength={
                        MAX_TITLE_LENGTH
                      }
                      selectionColor={
                        COLOURS.bronze400
                      }
                      value={
                        editTitle
                      }
                      onChangeText={
                        setEditTitle
                      }
                      style={
                        styles.editInput
                      }
                    />

                    <Text
                      style={
                        styles.darkLabel
                      }
                    >
                      HINT / CLUE
                    </Text>

                    <TextInput
                      accessibilityLabel="Edit cache clue"
                      editable={
                        !isSubmitting
                      }
                      maxLength={
                        MAX_HINT_LENGTH
                      }
                      multiline
                      selectionColor={
                        COLOURS.bronze400
                      }
                      textAlignVertical="top"
                      value={
                        editHint
                      }
                      onChangeText={
                        setEditHint
                      }
                      style={[
                        styles.editInput,
                        styles.editTextArea,
                      ]}
                    />

                    <Text
                      style={
                        styles.darkLabel
                      }
                    >
                      SECRET PAYLOAD
                    </Text>

                    <TextInput
                      accessibilityLabel="Edit cache secret payload"
                      editable={
                        !isSubmitting
                      }
                      maxLength={
                        MAX_PAYLOAD_LENGTH
                      }
                      multiline
                      selectionColor={
                        COLOURS.bronze400
                      }
                      textAlignVertical="top"
                      value={
                        editPayload
                      }
                      onChangeText={
                        setEditPayload
                      }
                      style={[
                        styles.editInput,
                        styles.editTextArea,
                      ]}
                    />

                    <View
                      style={
                        styles.editActions
                      }
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Save cache changes"
                        accessibilityState={{
                          disabled:
                            isSubmitting,
                          busy:
                            isSubmitting,
                        }}
                        disabled={
                          isSubmitting
                        }
                        onPress={() => {
                          void handleUpdateCache();
                        }}
                        style={({
                          pressed,
                        }) => [
                          styles.editActionButton,
                          styles.saveButton,

                          isSubmitting &&
                            styles.disabledButton,

                          pressed &&
                            !isSubmitting &&
                            styles.primaryPressed,
                        ]}
                      >
                        {isSubmitting ? (
                          <ActivityIndicator
                            size="small"
                            color={
                              COLOURS.parchment100
                            }
                          />
                        ) : (
                          <Ionicons
                            name="save-outline"
                            size={17}
                            color={
                              COLOURS.parchment100
                            }
                          />
                        )}

                        <Text
                          style={
                            styles.editActionText
                          }
                        >
                          SAVE
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel cache editing"
                        accessibilityState={{
                          disabled:
                            isSubmitting,
                        }}
                        disabled={
                          isSubmitting
                        }
                        onPress={() =>
                          setIsEditing(
                            false,
                          )
                        }
                        style={({
                          pressed,
                        }) => [
                          styles.editActionButton,
                          styles.cancelButton,

                          isSubmitting &&
                            styles.disabledButton,

                          pressed &&
                            !isSubmitting &&
                            styles.darkPressed,
                        ]}
                      >
                        <Ionicons
                          name="close-outline"
                          size={18}
                          color={
                            COLOURS.parchment100
                          }
                        />

                        <Text
                          style={
                            styles.editActionText
                          }
                        >
                          CANCEL
                        </Text>
                      </Pressable>
                    </View>
                  </ScrollView>
                ) : (
                  <ScrollView
                    key={
                      selectedItem.id
                    }
                    style={
                      styles.detailsScroll
                    }
                    contentContainerStyle={
                      styles.detailsBody
                    }
                    showsVerticalScrollIndicator={
                      false
                    }
                  >
                    <View
                      accessible={
                        false
                      }
                      importantForAccessibility="no-hide-descendants"
                      style={
                        styles.cacheIdentityBlock
                      }
                    >
                      <View
                        style={
                          styles.iconCircle
                        }
                      >
                        <ItemIcon
                          type={
                            selectedItem.iconType
                          }
                          size={24}
                          colour={
                            COLOURS.parchment100
                          }
                        />
                      </View>

                      <View
                        style={
                          styles.cacheIdentityText
                        }
                      >
                        <Text
                          numberOfLines={2}
                          style={
                            styles.itemHeaderTitle
                          }
                        >
                          {
                            selectedItem.title
                          }
                        </Text>

                        <Text
                          style={
                            styles.itemReference
                          }
                        >
                          {
                            selectedItem.dbRef
                          }
                        </Text>
                      </View>
                    </View>

                    <View
                      accessible
                      accessibilityLabel={`${selectedItem.title}. ${selectedItem.distanceKm} kilometres away. ${selectedItem.status}. Created by ${getSafeCreatorName(
                        selectedItem.creatorName,
                      )}.`}
                      style={
                        styles.metadataCard
                      }
                    >
                      <View
                        style={
                          styles.metaRow
                        }
                      >
                        <Text
                          style={
                            styles.metaLabel
                          }
                        >
                          RADIAL DISTANCE
                        </Text>

                        <Text
                          style={
                            styles.metaValue
                          }
                        >
                          {
                            selectedItem.distanceKm
                          }{' '}
                          KM
                        </Text>
                      </View>

                      <View
                        style={
                          styles.metaRow
                        }
                      >
                        <Text
                          style={
                            styles.metaLabel
                          }
                        >
                          COORDINATES
                        </Text>

                        <Text
                          style={
                            styles.metaValue
                          }
                        >
                          {
                            selectedItem.coordinates
                          }
                        </Text>
                      </View>

                      <View
                        style={
                          styles.metaRow
                        }
                      >
                        <Text
                          style={
                            styles.metaLabel
                          }
                        >
                          CREATOR
                        </Text>

                        <Text
                          style={
                            styles.metaValue
                          }
                        >
                          {getSafeCreatorName(
                            selectedItem.creatorName,
                          )}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.metaRow,
                          styles.metaRowLast,
                        ]}
                      >
                        <Text
                          style={
                            styles.metaLabel
                          }
                        >
                          STATUS
                        </Text>

                        <Text
                          style={[
                            styles.metaValue,

                            selectedItem.isDiscovered &&
                              styles.metaValueSuccess,
                          ]}
                        >
                          {
                            selectedItem.status
                          }
                        </Text>
                      </View>
                    </View>

                    <View
                      style={
                        styles.recordBox
                      }
                    >
                      <Text
                        style={
                          styles.recordLabel
                        }
                      >
                        CLUE RECORD
                      </Text>

                      {selectedItem.hint
                        ?.trim() ? (
                        <Text
                          maxFontSizeMultiplier={
                            1.8
                          }
                          style={
                            styles.recordText
                          }
                        >
                          “
                          {
                            selectedItem.hint
                          }
                          ”
                        </Text>
                      ) : (
                        <Text
                          style={
                            styles.recordMutedText
                          }
                        >
                          NO CLUE RECORDED
                        </Text>
                      )}
                    </View>

                    {/* ------------------------------------------------------ */}
                    {/* Payload visibility                                    */}
                    {/* ------------------------------------------------------ */}

                    <View
                      accessible
                      accessibilityLabel={
                        canRevealSelectedPayload
                          ? selectedItem
                              .payloadText
                              ?.trim()
                            ? 'Secret payload unlocked and visible.'
                            : 'This cache has no secret payload text.'
                          : 'Secret payload locked until this cache is excavated.'
                      }
                      style={[
                        styles.recordBox,
                        styles.payloadBox,

                        !canRevealSelectedPayload &&
                          styles.lockedPayloadBox,
                      ]}
                    >
                      <View
                        accessible={
                          false
                        }
                        importantForAccessibility="no-hide-descendants"
                        style={
                          styles.payloadHeader
                        }
                      >
                        <Text
                          style={
                            styles.recordLabel
                          }
                        >
                          {selectedItem.creatorId ===
                          currentUserId
                            ? 'OWNER PAYLOAD RECORD'
                            : canRevealSelectedPayload
                              ? 'UNLOCKED PAYLOAD'
                              : 'SECRET PAYLOAD'}
                        </Text>

                        <Ionicons
                          name={
                            canRevealSelectedPayload
                              ? 'lock-open-outline'
                              : 'lock-closed-outline'
                          }
                          size={16}
                          color={
                            canRevealSelectedPayload
                              ? COLOURS.success300
                              : COLOURS.warning300
                          }
                        />
                      </View>

                      {canRevealSelectedPayload ? (
                        <Text
                          maxFontSizeMultiplier={
                            1.8
                          }
                          style={
                            selectedItem
                              .payloadText
                              ?.trim()
                              ? styles.recordText
                              : styles.recordMutedText
                          }
                        >
                          {selectedItem
                            .payloadText
                            ?.trim() ||
                            'NO PAYLOAD TEXT RECORDED'}
                        </Text>
                      ) : (
                        <Text
                          maxFontSizeMultiplier={
                            1.7
                          }
                          style={
                            styles.lockedPayloadText
                          }
                        >
                          EXCAVATE THIS CACHE IN HUNT MODE TO REVEAL ITS SECRET PAYLOAD.
                        </Text>
                      )}
                    </View>
                  </ScrollView>
                )
              ) : (
                <View
                  accessible
                  accessibilityLabel="No active cache is selected for inspection."
                  style={
                    styles.consoleState
                  }
                >
                  <Ionicons
                    name="scan-outline"
                    size={34}
                    color={
                      COLOURS.bronze400
                    }
                  />

                  <Text
                    style={
                      styles.consoleStateTitle
                    }
                  >
                    NO CACHE SELECTED
                  </Text>

                  <Text
                    maxFontSizeMultiplier={
                      1.7
                    }
                    style={
                      styles.consoleStateText
                    }
                  >
                    Select an active cache in the field workspace to inspect its record.
                  </Text>
                </View>
              )}
            </View>

            {/* -------------------------------------------------------------- */}
            {/* Owner / Hunt actions                                           */}
            {/* -------------------------------------------------------------- */}

            {selectedItem &&
            !isEditing &&
            !isBurying ? (
              selectedItem.creatorId ===
              currentUserId ? (
                <View
                  style={
                    styles.creatorActions
                  }
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${selectedItem.title}`}
                    accessibilityHint="Opens the editable cache metadata."
                    accessibilityState={{
                      disabled:
                        isSubmitting,
                    }}
                    disabled={
                      isSubmitting
                    }
                    onPress={
                      beginEditing
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.creatorActionButton,
                      styles.editButton,

                      isSubmitting &&
                        styles.disabledButton,

                      pressed &&
                        !isSubmitting &&
                        styles.darkPressed,
                    ]}
                  >
                    <Ionicons
                      name="create-outline"
                      size={17}
                      color={
                        COLOURS.parchment100
                      }
                    />

                    <Text
                      style={
                        styles.creatorActionText
                      }
                    >
                      EDIT
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Archive ${selectedItem.title}`}
                    accessibilityHint="Removes this cache from active field lists while retaining discovery history."
                    accessibilityState={{
                      disabled:
                        isSubmitting,
                    }}
                    disabled={
                      isSubmitting
                    }
                    onPress={
                      handleArchiveCache
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.creatorActionButton,
                      styles.archiveButton,

                      isSubmitting &&
                        styles.disabledButton,

                      pressed &&
                        !isSubmitting &&
                        styles.darkPressed,
                    ]}
                  >
                    <Ionicons
                      name="archive-outline"
                      size={17}
                      color={
                        COLOURS.parchment100
                      }
                    />

                    <Text
                      style={
                        styles.creatorActionText
                      }
                    >
                      ARCHIVE
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Permanently delete ${selectedItem.title}`}
                    accessibilityHint="Permanently deletes this cache after confirmation."
                    accessibilityState={{
                      disabled:
                        isSubmitting,
                    }}
                    disabled={
                      isSubmitting
                    }
                    onPress={
                      handleDeleteCache
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.creatorActionButton,
                      styles.deleteButton,

                      isSubmitting &&
                        styles.disabledButton,

                      pressed &&
                        !isSubmitting &&
                        styles.primaryPressed,
                    ]}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={17}
                      color={
                        COLOURS.parchment100
                      }
                    />

                    <Text
                      style={
                        styles.creatorActionText
                      }
                    >
                      DELETE
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Track ${selectedItem.title} in Hunt`}
                  accessibilityHint="Opens Hunt mode with this cache selected."
                  accessibilityState={{
                    disabled:
                      !onNavigate ||
                      isSubmitting,
                  }}
                  disabled={
                    !onNavigate ||
                    isSubmitting
                  }
                  onPress={
                    handleTrackSelectedCache
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.trackButton,

                    (
                      !onNavigate ||
                      isSubmitting
                    ) &&
                      styles.disabledButton,

                    pressed &&
                      Boolean(
                        onNavigate,
                      ) &&
                      !isSubmitting &&
                      styles.primaryPressed,
                  ]}
                >
                  <Ionicons
                    name="compass-outline"
                    size={18}
                    color={
                      COLOURS.parchment100
                    }
                  />

                  <Text
                    style={
                      styles.trackButtonText
                    }
                  >
                    {selectedItem.isDiscovered
                      ? 'OPEN HUNT RECORD'
                      : 'TRACK IN HUNT'}
                  </Text>
                </Pressable>
              )
            ) : null}

            <FieldNavBar
              currentTab={
                currentTab
              }
              onNavigate={(
                screen,
              ) =>
                onNavigate?.(
                  screen,
                )
              }
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  };

export default InventoryScreen;

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor:
        COLOURS.forest800,
    },

    splitWrapper: {
      flex: 1,
      minHeight: 0,
      gap: 12,
    },

    headerTextGroup: {
      flex: 1,
      minWidth: 0,
    },

    disabledButton: {
      opacity: 0.48,
    },

    /* ---------------------------------------------------------------------- */
    /* 60% workspace                                                         */
    /* ---------------------------------------------------------------------- */

    leftViewport: {
      minWidth: 0,
      minHeight: 0,
      padding: 14,
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 7,
    },

    leftViewportLandscape: {
      flex: 0.6,
    },

    leftViewportPortrait: {
      flex: 1,
      width: '100%',
    },

    workspaceHeader: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 10,
      paddingBottom: 9,
      borderBottomWidth: 1,
      borderBottomColor:
        COLOURS.bronze600,
    },

    workspaceHeading: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },

    workspaceTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 15,
      lineHeight: 21,
      fontWeight: '800',
      letterSpacing: 1,
    },

    workspaceSubtitle: {
      marginTop: 2,
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '700',
      letterSpacing: 0.55,
    },

    buryToggleButton: {
      minHeight:
        MIN_TOUCH_TARGET,
      minWidth: 132,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.rust800,
      borderRadius: 5,
    },

    buryToggleText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight: '800',
      letterSpacing: 0.55,
      textAlign: 'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Position                                                              */
    /* ---------------------------------------------------------------------- */

    positionBar: {
      minHeight: 58,
      marginTop: 9,
      marginBottom: 9,
      paddingHorizontal: 9,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 8,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    positionIdentity: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },

    positionTextGroup: {
      flex: 1,
      minWidth: 0,
    },

    positionStatusText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight: '800',
      letterSpacing: 0.4,
    },

    positionCoordinatesText: {
      marginTop: 1,
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_FONT,
      fontSize: 8.5,
      lineHeight: 12,
    },

    positionActionButton: {
      minHeight:
        MIN_TOUCH_TARGET,
      minWidth: 112,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 5,
      paddingHorizontal: 8,
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 4,
    },

    positionActionText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight: '800',
      textAlign: 'center',
    },

    /* ---------------------------------------------------------------------- */
    /* States                                                                */
    /* ---------------------------------------------------------------------- */

    loadingContainer: {
      flex: 1,
      justifyContent:
        'center',
      alignItems:
        'center',
      gap: 10,
      padding: 24,
    },

    loadingText: {
      color:
        COLOURS.rust700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10.5,
      lineHeight: 16,
      fontWeight: '800',
      letterSpacing: 0.8,
      textAlign: 'center',
    },

    stateContainer: {
      flex: 1,
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 9,
      paddingHorizontal: 24,
      paddingVertical: 20,
    },

    stateTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '800',
      letterSpacing: 0.7,
      textAlign: 'center',
    },

    stateText: {
      maxWidth: 520,
      color:
        COLOURS.ink700,
      fontSize: 11.5,
      lineHeight: 18,
      textAlign: 'center',
    },

    stateHint: {
      maxWidth: 520,
      color:
        COLOURS.rust700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight: '700',
      textAlign: 'center',
    },

    stateActionButton: {
      minHeight:
        MIN_TOUCH_TARGET,
      minWidth: 170,
      marginTop: 4,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 7,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.rust800,
      borderRadius: 5,
    },

    stateActionText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight: '800',
      letterSpacing: 0.6,
    },

    emptyState: {
      width: '100%',
      minHeight: 220,
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 8,
      padding: 26,
    },

    emptyTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '800',
      letterSpacing: 0.7,
      textAlign: 'center',
    },

    emptyText: {
      maxWidth: 480,
      color:
        COLOURS.ink700,
      fontSize: 11,
      lineHeight: 17,
      textAlign: 'center',
    },

    emptyCreateButton: {
      minHeight:
        MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 6,
      marginTop: 4,
      paddingHorizontal: 14,
      paddingVertical: 9,
      backgroundColor:
        COLOURS.rust700,
      borderRadius: 5,
    },

    emptyCreateText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight: '800',
    },

    /* ---------------------------------------------------------------------- */
    /* Cache grid                                                            */
    /* ---------------------------------------------------------------------- */

    gridContainer: {
      flexGrow: 1,
      paddingBottom: 20,
    },

    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      alignItems:
        'flex-start',
    },

    itemCard: {
      width: 154,
      minHeight: 116,
      justifyContent:
        'space-between',
      padding: 10,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 6,
    },

    itemCardSelected: {
      backgroundColor:
        '#DDCDAA',
      borderWidth: 2,
      borderColor:
        COLOURS.rust700,
    },

    itemCardOwner: {
      borderLeftWidth: 5,
      borderLeftColor:
        COLOURS.forest800,
    },

    itemCardDiscovered: {
      borderBottomWidth: 3,
      borderBottomColor:
        COLOURS.success700,
    },

    cardPressed: {
      opacity: 0.76,
    },

    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 6,
    },

    distanceBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 4,
      backgroundColor:
        COLOURS.parchment200,
      borderRadius: 4,
    },

    distanceBadgeText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 12,
      fontWeight: '800',
    },

    itemText: {
      marginVertical: 6,
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '800',
    },

    itemSubtext: {
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 12,
      fontWeight: '700',
      letterSpacing: 0.35,
    },

    /* ---------------------------------------------------------------------- */
    /* Create form                                                           */
    /* ---------------------------------------------------------------------- */

    formContainer: {
      flex: 1,
      minHeight: 0,
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 6,
    },

    formContentContainer: {
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 24,
    },

    formTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '800',
      letterSpacing: 0.7,
    },

    formDescription: {
      marginTop: 4,
      marginBottom: 4,
      color:
        COLOURS.ink700,
      fontSize: 10.5,
      lineHeight: 16,
    },

    label: {
      marginTop: 11,
      marginBottom: 5,
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight: '800',
      letterSpacing: 0.5,
    },

    labelInline: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight: '800',
      letterSpacing: 0.5,
    },

    input: {
      minHeight:
        MIN_TOUCH_TARGET,
      paddingHorizontal: 10,
      paddingVertical: 9,
      color:
        COLOURS.ink900,
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 1.5,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
      fontFamily:
        MONO_FONT,
      fontSize: 13,
      lineHeight: 19,
    },

    inputError: {
      borderWidth: 2,
      borderColor:
        COLOURS.rust700,
    },

    textArea: {
      minHeight: 82,
      maxHeight: 130,
    },

    errorText: {
      marginTop: 4,
      color:
        COLOURS.rust800,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 14,
      fontWeight: '700',
    },

    characterHelp: {
      alignSelf:
        'flex-end',
      marginTop: 3,
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_FONT,
      fontSize: 8,
      lineHeight: 12,
    },

    coordinateHeader: {
      minHeight: 48,
      marginTop: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 8,
    },

    usePositionButton: {
      minHeight:
        MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 5,
      paddingHorizontal: 9,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 4,
    },

    usePositionText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '800',
    },

    coordsRow: {
      flexDirection: 'row',
      gap: 10,
    },

    coordinateField: {
      flex: 1,
      minWidth: 0,
    },

    coordinateLabel: {
      marginBottom: 4,
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '800',
    },

    coordinateHelp: {
      marginTop: 8,
      color:
        COLOURS.ink700,
      fontSize: 10,
      lineHeight: 15,
    },

    sealAndBuryButton: {
      minHeight: 52,
      marginTop: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 7,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.rust800,
      borderRadius: 5,
    },

    sealAndBuryText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10.5,
      lineHeight: 15,
      fontWeight: '800',
      letterSpacing: 0.7,
    },

    /* ---------------------------------------------------------------------- */
    /* 40% console                                                           */
    /* ---------------------------------------------------------------------- */

    rightViewport: {
      minWidth: 0,
      minHeight: 0,
      padding: 12,
      backgroundColor:
        COLOURS.forest800,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze500,
      borderRadius: 7,
    },

    rightViewportLandscape: {
      flex: 0.4,
    },

    rightViewportPortrait: {
      flex: 1,
      width: '100%',
    },

    consoleHeader: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 8,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor:
        COLOURS.bronze500,
    },

    consoleHeading: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },

    consoleTitle: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11.5,
      lineHeight: 17,
      fontWeight: '800',
      letterSpacing: 0.7,
    },

    consoleSubtitle: {
      marginTop: 1,
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 7.5,
      lineHeight: 11,
      fontWeight: '700',
      letterSpacing: 0.45,
    },

    backButton: {
      width:
        MIN_TOUCH_TARGET,
      height:
        MIN_TOUCH_TARGET,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze500,
      borderRadius: 24,
    },

    syncWarningCard: {
      minHeight: 52,
      marginTop: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.danger300,
      borderRadius: 5,
    },

    syncWarningText: {
      flex: 1,
      minWidth: 0,
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight: '700',
    },

    syncRetryButton: {
      minWidth: 62,
      minHeight:
        MIN_TOUCH_TARGET,
      justifyContent:
        'center',
      alignItems:
        'center',
      paddingHorizontal: 6,
      borderWidth: 1,
      borderColor:
        COLOURS.parchment100,
      borderRadius: 4,
    },

    syncRetryText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight: '800',
    },

    consoleBody: {
      flex: 1,
      minHeight: 0,
      marginVertical: 8,
    },

    consoleState: {
      flex: 1,
      justifyContent:
        'center',
      alignItems:
        'center',
      gap: 8,
      paddingHorizontal: 18,
      paddingVertical: 18,
    },

    consoleStateTitle: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11,
      lineHeight: 16,
      fontWeight: '800',
      letterSpacing: 0.6,
      textAlign: 'center',
    },

    consoleStateText: {
      color:
        COLOURS.bronze400,
      fontSize: 10,
      lineHeight: 15,
      textAlign: 'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Cache details                                                         */
    /* ---------------------------------------------------------------------- */

    detailsScroll: {
      flex: 1,
      minHeight: 0,
    },

    detailsBody: {
      paddingBottom: 10,
    },

    cacheIdentityBlock: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      marginBottom: 9,
    },

    iconCircle: {
      width: 48,
      height: 48,
      flexShrink: 0,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze400,
      borderRadius: 24,
    },

    cacheIdentityText: {
      flex: 1,
      minWidth: 0,
    },

    itemHeaderTitle: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
      letterSpacing: 0.4,
    },

    itemReference: {
      marginTop: 2,
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 12,
      fontWeight: '700',
      letterSpacing: 0.45,
    },

    metadataCard: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.forest700,
      borderRadius: 5,
    },

    metaRow: {
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 8,
      paddingVertical: 5,
      borderBottomWidth: 1,
      borderBottomColor:
        COLOURS.forest700,
    },

    metaRowLast: {
      borderBottomWidth: 0,
    },

    metaLabel: {
      flexShrink: 0,
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '800',
      letterSpacing: 0.35,
    },

    metaValue: {
      flex: 1,
      minWidth: 0,
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      textAlign: 'right',
    },

    metaValueSuccess: {
      color:
        COLOURS.success300,
      fontFamily:
        MONO_BOLD_FONT,
      fontWeight: '800',
    },

    recordBox: {
      marginTop: 8,
      padding: 9,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze500,
      borderRadius: 5,
    },

    payloadBox: {
      marginBottom: 2,
    },

    lockedPayloadBox: {
      borderColor:
        COLOURS.warning300,
      borderStyle: 'dashed',
    },

    payloadHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      gap: 8,
      marginBottom: 4,
    },

    recordLabel: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '800',
      letterSpacing: 0.45,
    },

    recordText: {
      color:
        COLOURS.parchment100,
      fontSize: 10.5,
      lineHeight: 16,
    },

    recordMutedText: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontStyle: 'italic',
    },

    lockedPayloadText: {
      color:
        COLOURS.warning300,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '700',
    },

    /* ---------------------------------------------------------------------- */
    /* Editing                                                               */
    /* ---------------------------------------------------------------------- */

    editScroll: {
      flex: 1,
      minHeight: 0,
    },

    editScrollContent: {
      paddingBottom: 10,
    },

    editHeader: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11.5,
      lineHeight: 17,
      fontWeight: '800',
      letterSpacing: 0.6,
      marginBottom: 8,
    },

    darkLabel: {
      marginTop: 7,
      marginBottom: 4,
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '800',
      letterSpacing: 0.4,
    },

    editInput: {
      minHeight:
        MIN_TOUCH_TARGET,
      paddingHorizontal: 9,
      paddingVertical: 8,
      color:
        COLOURS.parchment100,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1.5,
      borderColor:
        COLOURS.bronze500,
      borderRadius: 5,
      fontFamily:
        MONO_FONT,
      fontSize: 12,
      lineHeight: 18,
    },

    editTextArea: {
      minHeight: 78,
      maxHeight: 120,
    },

    editActions: {
      flexDirection: 'row',
      gap: 7,
      marginTop: 10,
    },

    editActionButton: {
      flex: 1,
      minHeight:
        MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 8,
      borderRadius: 5,
    },

    saveButton: {
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.rust800,
    },

    cancelButton: {
      backgroundColor:
        COLOURS.forest700,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze500,
    },

    editActionText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight: '800',
    },

    /* ---------------------------------------------------------------------- */
    /* Action controls                                                       */
    /* ---------------------------------------------------------------------- */

    creatorActions: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: 8,
    },

    creatorActionButton: {
      flex: 1,
      minHeight:
        MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 5,
      paddingHorizontal: 6,
      paddingVertical: 8,
      borderRadius: 5,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze500,
    },

    editButton: {
      backgroundColor:
        COLOURS.forest700,
    },

    archiveButton: {
      backgroundColor:
        '#5B4A2D',
    },

    deleteButton: {
      backgroundColor:
        COLOURS.rust700,
      borderColor:
        COLOURS.rust800,
    },

    creatorActionText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight: '800',
    },

    trackButton: {
      minHeight: 50,
      marginBottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'center',
      gap: 7,
      paddingHorizontal: 10,
      paddingVertical: 9,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.rust800,
      borderRadius: 5,
    },

    trackButtonText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight: '800',
      letterSpacing: 0.55,
    },

    /* ---------------------------------------------------------------------- */
    /* Press states                                                          */
    /* ---------------------------------------------------------------------- */

    darkPressed: {
      opacity: 0.78,
    },

    primaryPressed: {
      opacity: 0.84,
      backgroundColor:
        COLOURS.rust600,
    },

    lightPressed: {
      opacity: 0.7,
    },
  });