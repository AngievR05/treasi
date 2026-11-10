import { getDistanceInKilometres } from '../utils/huntNavigation';
import { useNearbyTreasures } from '../hooks/useNearbyTreasures';
import { geohashForLocation } from 'geofire-common';
import { useKeyboardEditing } from '../hooks/useKeyboardEditing';
import { KeyboardEditingBar } from '../components/KeyboardEditingBar';
import { FormScrollView, FormTextInput } from '../components/FormScrollView';
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
  KeyboardAvoidingView,
  Linking,
  Modal,
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
import { onAuthStateChanged } from 'firebase/auth';
import { isFreshLocation, useDashboardLocation } from '../hooks/useDashboardLocation';
import { readDashboardProfile, readDashboardTreasure } from '../utils/dashboardData';

import { Ionicons } from '@expo/vector-icons';

import {
  collection,
  doc,
  GeoPoint,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';

import {
  auth,
  db,
} from '../config/firebase';

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
  | 'book'
  | 'archive';

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

  isArchived: boolean;
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

interface TreasureRecord {
  id: string;

  data: TreasureDocument;
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

type ConfirmationAction =
  | 'archive'
  | 'restore'
  | 'delete'
  | null;

type CrudOperation =
  | 'create'
  | 'update'
  | 'archive'
  | 'restore'
  | 'delete'
  | null;

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const INVENTORY_RADIUS_KM =
  20;

const MIN_TITLE_LENGTH =
  3;

const MAX_TITLE_LENGTH =
  80;

const MAX_HINT_LENGTH =
  500;

const MAX_PAYLOAD_LENGTH =
  1000;

const MIN_TOUCH_TARGET =
  48;

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

  warning700: '#7A602F',
  warning300: '#E6C580',

  danger300: '#FFB4A2',

  overlay: 'rgba(0, 0, 0, 0.82)',
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

// Announces important feedback for screen-reader users.
const announce = (
  message: string,
): void => {
  AccessibilityInfo
    .announceForAccessibility(
      message,
    );
};

// Shows ordinary feedback visually and through accessibility services.
const showAccessibleAlert = (
  title: string,
  message: string,
): void => {
  announce(
    `${title}. ${message}`,
  );

  if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
};

// Keeps development diagnostics out of production logs.
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

// Validates geographic coordinates.
const isValidCoordinate = (
  latitude: unknown,
  longitude: unknown,
): boolean =>
  typeof latitude ===
    'number' &&
  typeof longitude ===
    'number' &&
  Number.isFinite(
    latitude,
  ) &&
  Number.isFinite(
    longitude,
  ) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

// Calculates straight-line geographic distance.


// Parses coordinates entered manually.
const parseCoordinate = (
  value: string,
): number | null => {
  const trimmed =
    value.trim().replace(',', '.');

  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return null;
  }

  const parsed =
    Number(
      trimmed,
    );

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
};

// Provides a safe display name for activity records.
const getSafeCreatorName = (
  value?: unknown,
): string => {
  const trimmed =
    typeof value === 'string' ? value.trim() : '';

  return (
    trimmed ||
    'EXPLORER'
  );
};

// Converts Firestore failures into appropriate interface messages.
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

  const message =
    error instanceof Error
      ? error.message
      : '';

  switch (message) {
    case 'TREASURE_NOT_FOUND':
      return 'This cache no longer exists. Refresh Inventory and try again.';

    case 'NOT_CACHE_OWNER':
      return 'Only the cache creator can change this record.';

    case 'ALREADY_ARCHIVED':
      return 'This cache has already been archived.';

    case 'ARCHIVE_BEFORE_DELETE':
      return 'Archive this cache before permanently deleting it.';

    case 'NOT_ARCHIVED':
      return 'This cache is already active.';

    default:
      break;
  }

  if (
    code.includes(
      'permission-denied',
    )
  ) {
    return 'You do not have permission to perform this cache operation.';
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

// Formats coordinates for display.
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

// Converts a Firestore snapshot record into a validated treasure record.
const buildTreasureRecord = (
  id: string,
  data:
    Partial<TreasureDocument>,
): TreasureRecord | null => {
  const treasure = readDashboardTreasure(id, data as Record<string, unknown>);
  return treasure && treasure.creatorId ? { id, data: treasure } : null;
};

// Uses Expo vector icons consistently across native and web.
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

      case 'archive':
        return (
          <Ionicons
            name="archive-outline"
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
    const keyboardVisible = useKeyboardEditing();

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

    const [currentUser, setCurrentUser] = useState(auth.currentUser);
    useEffect(() => onAuthStateChanged(auth, setCurrentUser), []);

    const currentUserId =
      currentUser?.uid ??
      null;
    const accountRef = useRef({ uid: currentUserId });
    if (accountRef.current.uid !== currentUserId) accountRef.current = { uid: currentUserId };
    const currentAccount = accountRef.current;
    const crudLockRef = useRef<symbol | null>(null);
    const selectedIdRef = useRef<string | null>(null);
    const confirmationTargetRef = useRef<{ id: string; account: object } | null>(null);
    const beginCrud = useCallback((targetId?: string) => {
      if (!isMountedRef.current) return null;
      if (!auth.currentUser) {
        showAccessibleAlert('Authentication Required', 'Sign in again before changing Inventory.');
        return null;
      }
      if (auth.currentUser.uid !== currentAccount.uid ||
          accountRef.current !== currentAccount || crudLockRef.current ||
          (targetId && selectedIdRef.current !== targetId)) return null;
      const token = Symbol('inventory-write');
      crudLockRef.current = token;
      return {
        isCurrent: () => isMountedRef.current && accountRef.current === currentAccount && auth.currentUser?.uid === currentAccount.uid,
        release: () => { if (crudLockRef.current === token) crudLockRef.current = null; },
      };
    }, [currentAccount]);

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

    const coordinateInputsTouchedRef =
      useRef(
        Boolean(
          initialCoordinates,
        ),
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

    const gps = useDashboardLocation();
    const latestGpsRef = useRef(gps);
    latestGpsRef.current = gps;
    const { locationPermissionStatus, canAskLocationAgain, locationServicesEnabled,
      locationError, startLocationService } = gps;
    const isRefreshingLocation = gps.isInitialisingLocation;
    const locationStatus: InventoryLocationStatus = gps.isInitialisingLocation ? 'CHECKING'
      : locationServicesEnabled === false ? 'SERVICES_OFF'
        : locationPermissionStatus === Location.PermissionStatus.DENIED ? 'DENIED'
          : locationPermissionStatus !== Location.PermissionStatus.GRANTED ? 'PERMISSION_REQUIRED'
            : locationError ? 'ERROR' : userCoords ? 'READY' : 'CHECKING';
    const canUseCurrentPosition = Boolean(gps.userLocation && gps.locationFixSource === 'live' &&
      !gps.locationError && !gps.isInitialisingLocation && isFreshLocation(gps.userLocation));
    useEffect(() => {
      if (!gps.userLocation) return;
      const coordinates = { latitude: gps.userLocation.coords.latitude, longitude: gps.userLocation.coords.longitude };
      const source = gps.locationFixSource === 'live' ? 'live' : 'last-known';
      setUserCoords(coordinates);
      setLocationSource(source);
      if (!coordinateInputsTouchedRef.current && source === 'live') {
        setNewLat(coordinates.latitude.toFixed(6));
        setNewLng(coordinates.longitude.toFixed(6));
      }
    }, [gps.userLocation, gps.locationFixSource]);

    /* ---------------------------------------------------------------------- */
    /* Read state                                                             */
    /* ---------------------------------------------------------------------- */

    const [
      activeTreasureRecords,
      setActiveTreasureRecords,
    ] =
      useState<
        TreasureRecord[]
      >([]);

    const [
      ownerTreasureRecords,
      setOwnerTreasureRecords,
    ] =
      useState<
        TreasureRecord[]
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
      activeTreasuresLoading,
      setActiveTreasuresLoading,
    ] =
      useState(true);

    const [
      ownerTreasuresLoading,
      setOwnerTreasuresLoading,
    ] =
      useState(true);

    const [
      activeTreasuresError,
      setActiveTreasuresError,
    ] =
      useState<
        string | null
      >(null);

    const [
      ownerTreasuresError,
      setOwnerTreasuresError,
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
    /* Selection                                                              */
    /* ---------------------------------------------------------------------- */

    const [
      selectedId,
      setSelectedId,
    ] =
      useState<
        string | null
      >(null);

    /* ---------------------------------------------------------------------- */
    /* Create state                                                           */
    /* ---------------------------------------------------------------------- */

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
      fieldErrors,
      setFieldErrors,
    ] =
      useState<
        Record<
          string,
          string
        >
      >({});

    /* ---------------------------------------------------------------------- */
    /* Update state                                                           */
    /* ---------------------------------------------------------------------- */

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

    const [
      editLat,
      setEditLat,
    ] =
      useState('');

    const [
      editLng,
      setEditLng,
    ] =
      useState('');

    const [
      editErrors,
      setEditErrors,
    ] =
      useState<
        Record<
          string,
          string
        >
      >({});

    /* ---------------------------------------------------------------------- */
    /* CRUD operation state                                                   */
    /* ---------------------------------------------------------------------- */

    const [
      crudOperation,
      setCrudOperation,
    ] =
      useState<CrudOperation>(
        null,
      );

    const [
      confirmationAction,
      setConfirmationAction,
    ] =
      useState<ConfirmationAction>(
        null,
      );

    const isSubmitting =
      crudOperation !==
      null;

    const previousAccountRef = useRef(currentAccount);
    useEffect(() => {
      if (previousAccountRef.current === currentAccount) return;
      previousAccountRef.current = currentAccount;
      crudLockRef.current = null;
      confirmationTargetRef.current = null;
      setCurrentProfile(null); setProfileError(null);
      setActiveTreasureRecords([]); setOwnerTreasureRecords([]); setDiscoveredTreasureIds(new Set());
      setSelectedId(null); setIsEditing(false); setIsBurying(false); setCrudOperation(null); setConfirmationAction(null);
      setNewTitle(''); setNewHint(''); setNewPayload(''); setNewLat(''); setNewLng(''); setFieldErrors({});
      setEditTitle(''); setEditHint(''); setEditPayload(''); setEditLat(''); setEditLng(''); setEditErrors({});
      coordinateInputsTouchedRef.current = false;
    }, [currentAccount]);

    /* ---------------------------------------------------------------------- */
    /* Lifecycle                                                              */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      isMountedRef.current =
        true;

      return () => {
        isMountedRef.current =
          false;

      };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Apply Dashboard stamp                                                  */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        initialParams?.mode !==
        'create' || crudLockRef.current
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

      setUserCoords(
        initialCoordinates,
      );

      setLocationSource(
        'stamped',
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
    /* Profile read                                                           */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      let active = true;
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
            if (!active || accountRef.current !== currentAccount) return;
            if (
              snapshot.exists()
            ) {
              setCurrentProfile(
                readDashboardProfile(snapshot.data()),
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
            if (!active || accountRef.current !== currentAccount) return;
            logDevelopmentWarning(
              '[Treasi Inventory] Profile subscription failed:',
              error,
            );

            setProfileError(
              'EXPLORER PROFILE SYNC OFFLINE',
            );
          },
        );

      return () => { active = false; unsubscribe(); };
    }, [
      currentUserId,
      currentAccount,
      retryKey,
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
              await Linking
                .openSettings();
            } catch (
              error: unknown
            ) {
              logDevelopmentWarning(
                '[Treasi Inventory] Unable to open settings:',
                error,
              );

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
              'Allow location for this site in your browser settings, then return to Treasi and retry.',
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
    /* READ: active treasures                                                 */
    /* ---------------------------------------------------------------------- */

    const nearbyQuery = useNearbyTreasures(currentUserId, userCoords, INVENTORY_RADIUS_KM, retryKey);
    useEffect(() => {
      setActiveTreasureRecords(nearbyQuery.items.map(item => buildTreasureRecord(item.treasureId, item)!).filter(Boolean));
      setActiveTreasuresLoading(nearbyQuery.loading);
      setActiveTreasuresError(nearbyQuery.error);
    }, [nearbyQuery.items, nearbyQuery.loading, nearbyQuery.error]);


    /* ---------------------------------------------------------------------- */
    /* READ: all treasures owned by the current Explorer                      */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      let active = true;
      if (
        !currentUserId
      ) {
        setOwnerTreasureRecords(
          [],
        );

        setOwnerTreasuresLoading(
          false,
        );

        setOwnerTreasuresError(
          null,
        );

        return;
      }

      setOwnerTreasuresLoading(
        true,
      );

      setOwnerTreasuresError(
        null,
      );

      /*
       * This query includes archived owner records. A single-field creatorId
       * query avoids requiring an additional compound Firestore index.
       */
      const ownerQuery =
        query(
          collection(
            db,
            'treasures',
          ),

          where(
            'creatorId',
            '==',
            currentUserId,
          ),
        );

      const unsubscribe =
        onSnapshot(
          ownerQuery,

          (
            snapshot,
          ) => {
            if (!active || accountRef.current !== currentAccount) return;
            const records =
              snapshot.docs
                .map(
                  (
                    snapshotDocument,
                  ) =>
                    buildTreasureRecord(
                      snapshotDocument.id,
                      snapshotDocument.data() as
                        Partial<TreasureDocument>,
                    ),
                )
                .filter(
                  (
                    record,
                  ): record is TreasureRecord =>
                    record !==
                    null,
                );

            setOwnerTreasureRecords(
              records,
            );

            setOwnerTreasuresError(
              null,
            );

            setOwnerTreasuresLoading(
              false,
            );
          },

          (
            error,
          ) => {
            if (!active || accountRef.current !== currentAccount) return;
            logDevelopmentWarning(
              '[Treasi Inventory] Owner treasure subscription failed:',
              error,
            );

            setOwnerTreasuresLoading(
              false,
            );

            setOwnerTreasuresError(
              getFriendlyFirestoreError(
                error,
                'YOUR OWN CACHE RECORDS COULD NOT BE SYNCHRONISED.',
              ),
            );
          },
        );

      return () => { active = false; unsubscribe(); };
    }, [
      currentUserId,
      currentAccount,
      retryKey,
    ]);

    /* ---------------------------------------------------------------------- */
    /* READ: discoveries                                                      */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      let active = true;
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
            if (!active || accountRef.current !== currentAccount) return;
            const treasureIds =
              new Set<string>();

            snapshot.forEach(
              (
                snapshotDocument,
              ) => {
            if (!active || accountRef.current !== currentAccount) return;
                const treasureId =
                  snapshotDocument
                    .data()
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
            if (!active || accountRef.current !== currentAccount) return;
            logDevelopmentWarning(
              '[Treasi Inventory] Discovery subscription failed:',
              error,
            );

            /*
             * Payloads fail closed when discovery verification is unavailable.
             */
            setDiscoveredTreasureIds(
              new Set(),
            );

            setDiscoveryError(
              'DISCOVERY VERIFICATION SYNC OFFLINE',
            );
          },
        );

      return () => { active = false; unsubscribe(); };
    }, [
      currentUserId,
      currentAccount,
      retryKey,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Merge active + owner records                                           */
    /* ---------------------------------------------------------------------- */

    const mergedTreasureRecords =
      useMemo<
        TreasureRecord[]
      >(
        () => {
          const records =
            new Map<
              string,
              TreasureRecord
            >();

          activeTreasureRecords
            .forEach(
              (
                record,
              ) => {
                records.set(
                  record.id,
                  record,
                );
              },
            );

          /*
           * Owner records overwrite matching active records so archive changes
           * immediately remain available in the management interface.
           */
          ownerTreasureRecords
            .forEach(
              (
                record,
              ) => {
                records.set(
                  record.id,
                  record,
                );
              },
            );

          return Array.from(
            records.values(),
          );
        },
        [
          activeTreasureRecords,
          ownerTreasureRecords,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Nearby + owned inventory                                               */
    /* ---------------------------------------------------------------------- */

    const inventoryItems =
      useMemo<
        DisplayItem[]
      >(
        () => {
          return mergedTreasureRecords
            .map(
              (
                record,
              ):
                DisplayItem | null => {
                const {
                  id,
                  data,
                } =
                  record;

                const cacheLat =
                  data.location
                    .latitude;

                const cacheLng =
                  data.location
                    .longitude;

                const isOwner =
                  data.creatorId ===
                  currentUserId;

                const isArchived =
                  data.isArchived ===
                  true;

                /*
                 * Other Explorers' archived caches must never appear in the
                 * active Inventory. Owner archives remain visible for CRUD.
                 */
                if (
                  isArchived &&
                  !isOwner
                ) {
                  return null;
                }

                const distanceKm =
                  userCoords
                    ? getDistanceInKilometres(
                        userCoords.latitude,
                        userCoords.longitude,
                        cacheLat,
                        cacheLng,
                      )
                    : Number.POSITIVE_INFINITY;

                /*
                 * Normal field caches are radius-limited. All owner records
                 * remain manageable even when the creator has travelled away.
                 */
                if (
                  !isOwner &&
                  (
                    !userCoords ||
                    distanceKm >
                      INVENTORY_RADIUS_KM
                  )
                ) {
                  return null;
                }

                const isDiscovered =
                  discoveredTreasureIds.has(
                    id,
                  );

                let iconType:
                  IconType =
                  'map-pin';

                let status =
                  'FIELD TARGET';

                if (
                  isOwner &&
                  isArchived
                ) {
                  iconType =
                    'archive';

                  status =
                    'MY ARCHIVED CACHE';
                } else if (
                  isOwner
                ) {
                  iconType =
                    'target';

                  status =
                    'MY PLANTED CACHE';
                } else if (
                  isDiscovered
                ) {
                  iconType =
                    'trophy';

                  status =
                    'EXCAVATED';
                }

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
                    'cache',

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
                    Number.isFinite(
                      distanceKm,
                    )
                      ? Number(
                          distanceKm.toFixed(
                            2,
                          ),
                        )
                      : -1,

                  status,

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

                  isArchived,
                };
              },
            )
            .filter(
              (
                item,
              ): item is DisplayItem =>
                item !==
                null,
            )
            .sort(
              (
                itemA,
                itemB,
              ) => {
                /*
                 * Active caches appear before archived management records.
                 */
                if (
                  itemA.isArchived !==
                  itemB.isArchived
                ) {
                  return itemA.isArchived
                    ? 1
                    : -1;
                }

                if (
                  itemA.distanceKm <
                    0 &&
                  itemB.distanceKm >=
                    0
                ) {
                  return 1;
                }

                if (
                  itemB.distanceKm <
                    0 &&
                  itemA.distanceKm >=
                    0
                ) {
                  return -1;
                }

                return (
                  itemA.distanceKm -
                  itemB.distanceKm
                );
              },
            );
        },
        [
          currentUserId,
          discoveredTreasureIds,
          mergedTreasureRecords,
          userCoords,
        ],
      );

    const isLoading =
      activeTreasuresLoading ||
      ownerTreasuresLoading;

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
        inventoryItems.some(
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
        inventoryItems[0]
          ?.id ??
          null,
      );

      setIsEditing(
        false,
      );
    }, [
      inventoryItems,
      isBurying,
      selectedId,
    ]);

    selectedIdRef.current = selectedId;

    const selectedItem =
      useMemo(
        () =>
          inventoryItems
            .find(
              (
                item,
              ) =>
                item.id ===
                selectedId,
            ) ??
          null,
        [
          inventoryItems,
          selectedId,
        ],
      );

    const requestConfirmation = useCallback((action: ConfirmationAction) => {
      if (!selectedItem || selectedItem.creatorId !== currentUserId || crudLockRef.current) return;
      confirmationTargetRef.current = { id: selectedItem.id, account: currentAccount };
      setConfirmationAction(action);
    }, [selectedItem, currentAccount, currentUserId]);
    useEffect(() => {
      if (confirmationTargetRef.current?.id !== selectedId || confirmationTargetRef.current?.account !== currentAccount) {
        setConfirmationAction(null);
      }
    }, [selectedId, currentAccount]);

    const applyCommittedRecord = useCallback((id: string, data: TreasureDocument | null) => {
      const update = (records: TreasureRecord[], include: boolean) => {
        if (!data || !include) return records.filter(record => record.id !== id);
        const record = buildTreasureRecord(id, data);
        if (!record) return records;
        return [...records.filter(previous => previous.id !== id), record];
      };
      setOwnerTreasureRecords(records => update(records, data?.creatorId === currentUserId));
      setActiveTreasureRecords(records => update(records, Boolean(data && !data.isArchived)));
    }, [currentUserId]);

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
    /* Create helpers                                                         */
    /* ---------------------------------------------------------------------- */

    const resetCreateForm =
      useCallback(
        (): void => {
          setNewTitle('');
          setNewHint('');
          setNewPayload('');

          setFieldErrors(
            {},
          );

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
          } else {
            setNewLat('');
            setNewLng('');
          }

          coordinateInputsTouchedRef.current =
            false;
        },
        [
          userCoords,
        ],
      );

    const openCreateMode =
      useCallback(
        (): void => {
          if (crudLockRef.current) return;
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
        },
        [
          newLat,
          newLng,
          userCoords,
        ],
      );

    const closeCreateMode =
      useCallback(
        (): void => {
          if (
            isSubmitting || crudLockRef.current
          ) {
            return;
          }

          setIsBurying(
            false,
          );

          setIsEditing(
            false,
          );

          resetCreateForm();
        },
        [
          isSubmitting,
          resetCreateForm,
        ],
      );

    const useCurrentPosition =
      useCallback(
        (): void => {
          const liveGps = latestGpsRef.current;
          const livePosition = liveGps.userLocation;
          const coordinates = livePosition?.coords;
          if (
            !livePosition || !coordinates || liveGps.locationFixSource !== 'live' ||
            liveGps.locationError || liveGps.isInitialisingLocation || !isFreshLocation(livePosition)
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
            coordinates
              .latitude
              .toFixed(6),
          );

          setNewLng(
            coordinates
              .longitude
              .toFixed(6),
          );

          setFieldErrors(
            (
              current,
            ) => ({
              ...current,

              latitude:
                '',

              longitude:
                '',
            }),
          );

          announce(
            'Current position stamped into the cache form.',
          );
        },
        [
          userCoords,
          canUseCurrentPosition,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Create validation                                                      */
    /* ---------------------------------------------------------------------- */

    const validateCreateForm =
      useCallback(
        (): boolean => {
          const errors:
            Record<
              string,
              string
            > = {};

          const title =
            newTitle.trim().toUpperCase();

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
            latitude ===
              null ||
            latitude < -90 ||
            latitude > 90
          ) {
            errors.latitude =
              'LATITUDE MUST BE BETWEEN -90 AND 90.';
          }

          if (
            longitude ===
              null ||
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
            ).length ===
            0
          );
        },
        [
          newHint,
          newLat,
          newLng,
          newPayload,
          newTitle,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* CREATE                                                                 */
    /* ---------------------------------------------------------------------- */

    const handleBuryCache =
      useCallback(
        async (): Promise<void> => {
          const operation = beginCrud();
          if (!operation) return;
          try {
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
              latitude ===
              null ||
              longitude ===
              null
            ) {
              return;
            }

            const title =
              newTitle
                .trim()
                .toUpperCase();

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

            setCrudOperation(
              'create',
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

              /*
               * Treasure creation and its activity signal succeed or fail
               * together so the field feed never reports a missing cache.
               */
              const batch =
                writeBatch(
                  db,
                );

              const createdData = {
                geohash: geohashForLocation([latitude, longitude]),
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
              };
              batch.set(
                treasureReference,
                createdData,
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
                !operation.isCurrent()
              ) {
                return;
              }
              applyCommittedRecord(treasureReference.id, createdData as unknown as TreasureDocument);

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
              if (!operation.isCurrent()) return;
              logDevelopmentWarning(
                '[Treasi Inventory] Cache creation failed:',
                error,
              );

              showAccessibleAlert(
                'Creation Error',
                getFriendlyFirestoreError(
                  error,
                  'Treasi could not create the cache record.',
                ),
              );
            } finally {
              if (
                operation.isCurrent()
              ) {
                setCrudOperation(
                  null,
                );
              }
            }

          } finally { operation.release(); }
        },
        [
          applyCommittedRecord,
          beginCrud,
          currentProfile
            ?.username,
          isSubmitting,
          newHint,
          newLat,
          newLng,
          newPayload,
          newTitle,
          resetCreateForm,
          validateCreateForm,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Edit helpers                                                           */
    /* ---------------------------------------------------------------------- */

    const beginEditing =
      useCallback(
        (): void => {
          if (crudLockRef.current) return;
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

          setEditLat(
            selectedItem.rawLat
              .toFixed(6),
          );

          setEditLng(
            selectedItem.rawLng
              .toFixed(6),
          );

          setEditErrors(
            {},
          );

          setIsEditing(
            true,
          );
        },
        [
          currentUserId,
          selectedItem,
        ],
      );

    const useCurrentPositionForEdit =
      useCallback(
        (): void => {
          const liveGps = latestGpsRef.current;
          const livePosition = liveGps.userLocation;
          const coordinates = livePosition?.coords;
          if (
            !livePosition || !coordinates || liveGps.locationFixSource !== 'live' ||
            liveGps.locationError || liveGps.isInitialisingLocation || !isFreshLocation(livePosition)
          ) {
            showAccessibleAlert(
              'Position Unavailable',
              'Treasi does not currently have a valid position to use for this cache.',
            );

            return;
          }

          setEditLat(
            coordinates
              .latitude
              .toFixed(6),
          );

          setEditLng(
            coordinates
              .longitude
              .toFixed(6),
          );

          setEditErrors(
            (
              current,
            ) => ({
              ...current,

              latitude:
                '',

              longitude:
                '',
            }),
          );

          announce(
            'Current position applied to the cache edit form.',
          );
        },
        [
          userCoords,
          canUseCurrentPosition,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Update validation                                                      */
    /* ---------------------------------------------------------------------- */

    const validateEditForm =
      useCallback(
        (): boolean => {
          const errors:
            Record<
              string,
              string
            > = {};

          const title =
            editTitle.trim().toUpperCase();

          const hint =
            editHint.trim();

          const payload =
            editPayload.trim();

          const latitude =
            parseCoordinate(
              editLat,
            );

          const longitude =
            parseCoordinate(
              editLng,
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
            latitude ===
              null ||
            latitude < -90 ||
            latitude > 90
          ) {
            errors.latitude =
              'LATITUDE MUST BE BETWEEN -90 AND 90.';
          }

          if (
            longitude ===
              null ||
            longitude < -180 ||
            longitude > 180
          ) {
            errors.longitude =
              'LONGITUDE MUST BE BETWEEN -180 AND 180.';
          }

          setEditErrors(
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
            ).length ===
            0
          );
        },
        [
          editHint,
          editLat,
          editLng,
          editPayload,
          editTitle,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* UPDATE                                                                 */
    /* ---------------------------------------------------------------------- */

    const handleUpdateCache =
      useCallback(
        async (): Promise<void> => {
          const operation = beginCrud(selectedItem?.id);
          if (!operation) return;
          try {
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

            const latitude =
              parseCoordinate(
                editLat,
              );

            const longitude =
              parseCoordinate(
                editLng,
              );

            if (
              latitude ===
              null ||
              longitude ===
              null
            ) {
              return;
            }

            setCrudOperation(
              'update',
            );

            try {
              const treasureReference =
                doc(
                  db,
                  'treasures',
                  selectedItem.id,
                );

              /*
               * Re-reading inside the transaction ensures that ownership still
               * matches the signed-in Explorer when the update is committed.
               */
              const committedRecord = await runTransaction(
                db,

                async (
                  transaction,
                ) => {
                  const snapshot =
                    await transaction.get(
                      treasureReference,
                    );
                  if (!operation.isCurrent()) throw new Error('INVENTORY_OPERATION_CANCELLED');

                  if (
                    !snapshot.exists()
                  ) {
                    throw new Error(
                      'TREASURE_NOT_FOUND',
                    );
                  }

                  const liveTreasure =
                    snapshot.data() as
                    TreasureDocument;

                  if (
                    liveTreasure.creatorId !==
                    currentUserId
                  ) {
                    throw new Error(
                      'NOT_CACHE_OWNER',
                    );
                  }

                  transaction.update(
                    treasureReference,
                    {
                      title:
                        editTitle
                          .trim()
                          .toUpperCase(),

                      hint:
                        editHint.trim(),

                      payloadText:
                        editPayload.trim(),

                      geohash: geohashForLocation([latitude, longitude]),
                      location:
                        new GeoPoint(
                          latitude,
                          longitude,
                        ),

                      updatedAt:
                        serverTimestamp(),
                    },
                  );

                  return { ...liveTreasure, geohash: geohashForLocation([latitude, longitude]), title: editTitle.trim().toUpperCase(), hint: editHint.trim(), payloadText: editPayload.trim(), location: new GeoPoint(latitude, longitude) };
                },
              );

              if (
                !operation.isCurrent()
              ) {
                return;
              }
              applyCommittedRecord(selectedItem.id, committedRecord);

              setIsEditing(
                false,
              );

              setEditErrors(
                {},
              );

              showAccessibleAlert(
                'Record Updated',
                'Cache title, clue, payload and location have been updated.',
              );
            } catch (
            error: unknown
            ) {
              if (!operation.isCurrent()) return;
              logDevelopmentWarning(
                '[Treasi Inventory] Cache update failed:',
                error,
              );

              showAccessibleAlert(
                'Update Error',
                getFriendlyFirestoreError(
                  error,
                  'Treasi could not save the cache changes.',
                ),
              );
            } finally {
              if (
                operation.isCurrent()
              ) {
                setCrudOperation(
                  null,
                );
              }
            }

          } finally { operation.release(); }
        },
        [
          applyCommittedRecord,
          beginCrud,
          currentUserId,
          editHint,
          editLat,
          editLng,
          editPayload,
          editTitle,
          isSubmitting,
          selectedItem,
          validateEditForm,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Archive                                                                */
    /* ---------------------------------------------------------------------- */

    const executeArchiveCache =
      useCallback(
        async (): Promise<void> => {
          const operation = beginCrud(selectedItem?.id);
          if (!operation) return;
          try {
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

            setConfirmationAction(
              null,
            );

            setCrudOperation(
              'archive',
            );

            try {
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

              const committedRecord = await runTransaction(
                db,

                async (
                  transaction,
                ) => {
                  const snapshot =
                    await transaction.get(
                      treasureReference,
                    );
                  if (!operation.isCurrent()) throw new Error('INVENTORY_OPERATION_CANCELLED');

                  if (
                    !snapshot.exists()
                  ) {
                    throw new Error(
                      'TREASURE_NOT_FOUND',
                    );
                  }

                  const liveTreasure =
                    snapshot.data() as
                    TreasureDocument;

                  if (
                    liveTreasure.creatorId !==
                    user.uid
                  ) {
                    throw new Error(
                      'NOT_CACHE_OWNER',
                    );
                  }

                  if (
                    liveTreasure.isArchived
                  ) {
                    throw new Error(
                      'ALREADY_ARCHIVED',
                    );
                  }

                  transaction.update(
                    treasureReference,
                    {
                      isArchived:
                        true,

                      updatedAt:
                        serverTimestamp(),
                    },
                  );

                  transaction.set(
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

                  return { ...liveTreasure, isArchived: true };
                },
              );

              if (
                !operation.isCurrent()
              ) {
                return;
              }
              applyCommittedRecord(item.id, committedRecord);

              setIsEditing(
                false,
              );

              showAccessibleAlert(
                'Cache Archived',
                'The cache has been removed from active field lists. It remains available in your Inventory for restore or deletion.',
              );
            } catch (
            error: unknown
            ) {
              if (!operation.isCurrent()) return;
              logDevelopmentWarning(
                '[Treasi Inventory] Cache archive failed:',
                error,
              );

              showAccessibleAlert(
                'Archive Error',
                getFriendlyFirestoreError(
                  error,
                  'Treasi could not archive this cache.',
                ),
              );
            } finally {
              if (
                operation.isCurrent()
              ) {
                setCrudOperation(
                  null,
                );
              }
            }

          } finally { operation.release(); }
        },
        [
          applyCommittedRecord,
          beginCrud,
          currentProfile
            ?.username,
          isSubmitting,
          selectedItem,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Restore                                                                */
    /* ---------------------------------------------------------------------- */

    const executeRestoreCache =
      useCallback(
        async (): Promise<void> => {
          const operation = beginCrud(selectedItem?.id);
          if (!operation) return;
          try {
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

            setConfirmationAction(
              null,
            );

            setCrudOperation(
              'restore',
            );

            try {
              const treasureReference =
                doc(
                  db,
                  'treasures',
                  item.id,
                );

              const committedRecord = await runTransaction(
                db,

                async (
                  transaction,
                ) => {
                  const snapshot =
                    await transaction.get(
                      treasureReference,
                    );
                  if (!operation.isCurrent()) throw new Error('INVENTORY_OPERATION_CANCELLED');

                  if (
                    !snapshot.exists()
                  ) {
                    throw new Error(
                      'TREASURE_NOT_FOUND',
                    );
                  }

                  const liveTreasure =
                    snapshot.data() as
                    TreasureDocument;

                  if (
                    liveTreasure.creatorId !==
                    user.uid
                  ) {
                    throw new Error(
                      'NOT_CACHE_OWNER',
                    );
                  }

                  if (
                    !liveTreasure.isArchived
                  ) {
                    throw new Error(
                      'NOT_ARCHIVED',
                    );
                  }

                  transaction.update(
                    treasureReference,
                    {
                      geohash: geohashForLocation([liveTreasure.location.latitude, liveTreasure.location.longitude]),
                      isArchived:
                        false,

                      updatedAt:
                        serverTimestamp(),
                    },
                  );

                  return { ...liveTreasure, geohash: geohashForLocation([liveTreasure.location.latitude, liveTreasure.location.longitude]), isArchived: false };
                },
              );

              if (
                !operation.isCurrent()
              ) {
                return;
              }
              applyCommittedRecord(item.id, committedRecord);

              showAccessibleAlert(
                'Cache Restored',
                'The cache is active again and may appear on field maps and hunting lists.',
              );
            } catch (
            error: unknown
            ) {
              if (!operation.isCurrent()) return;
              logDevelopmentWarning(
                '[Treasi Inventory] Cache restore failed:',
                error,
              );

              showAccessibleAlert(
                'Restore Error',
                getFriendlyFirestoreError(
                  error,
                  'Treasi could not restore this cache.',
                ),
              );
            } finally {
              if (
                operation.isCurrent()
              ) {
                setCrudOperation(
                  null,
                );
              }
            }

          } finally { operation.release(); }
        },
        [
          applyCommittedRecord,
          beginCrud,
          isSubmitting,
          selectedItem,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* DELETE                                                                 */
    /* ---------------------------------------------------------------------- */

    const executeDeleteCache =
      useCallback(
        async (): Promise<void> => {
          const operation = beginCrud(selectedItem?.id);
          if (!operation) return;
          try {
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

            setConfirmationAction(
              null,
            );

            setCrudOperation(
              'delete',
            );

            try {
              const treasureReference =
                doc(
                  db,
                  'treasures',
                  item.id,
                );

              /*
               * Discoveries are intentionally not cascade-deleted here.
               *
               * Current Firestore rules only allow a discovery document to be
               * deleted by that discovery's hunter. A treasure owner cannot
               * delete discovery records created by other Explorers.
               */
              await runTransaction(
                db,

                async (
                  transaction,
                ) => {
                  const snapshot =
                    await transaction.get(
                      treasureReference,
                    );
                  if (!operation.isCurrent()) throw new Error('INVENTORY_OPERATION_CANCELLED');

                  if (
                    !snapshot.exists()
                  ) {
                    throw new Error(
                      'TREASURE_NOT_FOUND',
                    );
                  }

                  const liveTreasure =
                    snapshot.data() as
                    TreasureDocument;

                  if (
                    liveTreasure.creatorId !==
                    user.uid
                  ) {
                    throw new Error(
                      'NOT_CACHE_OWNER',
                    );
                  }

                  if (!liveTreasure.isArchived) throw new Error('ARCHIVE_BEFORE_DELETE');
                  transaction.delete(
                    treasureReference,
                  );
                },
              );

              if (
                !operation.isCurrent()
              ) {
                return;
              }
              applyCommittedRecord(item.id, null);

              setSelectedId(
                null,
              );

              setIsEditing(
                false,
              );

              showAccessibleAlert(
                'Cache Deleted',
                'The treasure record was permanently deleted. Existing discovery and activity history is retained.',
              );
            } catch (
            error: unknown
            ) {
              if (!operation.isCurrent()) return;
              logDevelopmentWarning(
                '[Treasi Inventory] Cache deletion failed:',
                error,
              );

              showAccessibleAlert(
                'Deletion Error',
                getFriendlyFirestoreError(
                  error,
                  'Treasi could not permanently delete this cache.',
                ),
              );
            } finally {
              if (
                operation.isCurrent()
              ) {
                setCrudOperation(
                  null,
                );
              }
            }

          } finally { operation.release(); }
        },
        [
          applyCommittedRecord,
          beginCrud,
          isSubmitting,
          selectedItem,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Confirmation                                                           */
    /* ---------------------------------------------------------------------- */

    const confirmationContent =
      useMemo(
        () => {
          if (
            !selectedItem ||
            !confirmationAction
          ) {
            return null;
          }

          switch (
            confirmationAction
          ) {
            case 'archive':
              return {
                icon:
                  'archive-outline' as const,

                title:
                  'ARCHIVE CACHE',

                message:
                  `Archive “${selectedItem.title}”? It will disappear from active maps and Hunt targets but remain available in your Inventory.`,

                actionLabel:
                  'ARCHIVE CACHE',
              };

            case 'restore':
              return {
                icon:
                  'refresh-circle-outline' as const,

                title:
                  'RESTORE CACHE',

                message:
                  `Restore “${selectedItem.title}” to the active field network?`,

                actionLabel:
                  'RESTORE CACHE',
              };

            case 'delete':
              return {
                icon:
                  'trash-outline' as const,

                title:
                  'DELETE PERMANENTLY',

                message:
                  `Permanently delete “${selectedItem.title}”? The treasure document cannot be restored. Existing discovery and activity history will remain.`,

                actionLabel:
                  'DELETE CACHE',
              };

            default:
              return null;
          }
        },
        [
          confirmationAction,
          selectedItem,
        ],
      );

    const handleConfirmAction =
      useCallback(
        (): void => {
          if (!selectedItem || confirmationTargetRef.current?.id !== selectedItem.id ||
              selectedIdRef.current !== selectedItem.id || confirmationTargetRef.current?.account !== currentAccount) return;
          switch (
            confirmationAction
          ) {
            case 'archive':
              void executeArchiveCache();
              break;

            case 'restore':
              void executeRestoreCache();
              break;

            case 'delete':
              void executeDeleteCache();
              break;

            default:
              break;
          }
        },
        [
          confirmationAction,
          selectedItem,
          currentAccount,
          executeArchiveCache,
          executeDeleteCache,
          executeRestoreCache,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Hunt navigation                                                        */
    /* ---------------------------------------------------------------------- */

    const handleTrackSelectedCache =
      useCallback(
        (): void => {
          if (!isMountedRef.current || accountRef.current !== currentAccount ||
              auth.currentUser?.uid !== currentUserId || crudLockRef.current) return;
          if (
            !selectedItem ||
            !onNavigate
          ) {
            return;
          }

          if (
            selectedItem.isArchived
          ) {
            showAccessibleAlert(
              'Archived Cache',
              'Restore this cache before using it as an active Hunt target.',
            );

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
        },
        [
          currentAccount,
          currentUserId,
          onNavigate,
          selectedItem,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Retry reads                                                            */
    /* ---------------------------------------------------------------------- */

    const handleRetryData =
      useCallback(
        (): void => {
          setActiveTreasuresError(
            null,
          );

          setOwnerTreasuresError(
            null,
          );

          setDiscoveryError(
            null,
          );

          setProfileError(
            null,
          );

          setActiveTreasuresLoading(
            true,
          );

          setOwnerTreasuresLoading(
            true,
          );

          setRetryKey(
            (
              current,
            ) =>
              current +
              1,
          );

          announce(
            'Retrying Inventory synchronisation.',
          );
        },
        [],
      );

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

            case 'ERROR':
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

    const syncWarningText = useMemo(() =>
      [activeTreasuresError, ownerTreasuresError, profileError, discoveryError].filter(Boolean).join(' · '),
      [activeTreasuresError, ownerTreasuresError, profileError, discoveryError]);

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
        {keyboardVisible && <KeyboardEditingBar title="CACHE DETAILS" />}

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

              paddingBottom: keyboardVisible ? 4 : Math.max(insets.bottom, 10),
            },
          ]}
        >
          {/* ================================================================ */}
          {/* 60% — CACHE WORKSPACE                                            */}
          {/* ================================================================ */}

          <View
            style={[[
              styles.leftViewport,

              isLandscape
                ? styles.leftViewportLandscape
                : styles.leftViewportPortrait,
            ], keyboardVisible && { flex: 1 }, keyboardVisible && isEditing && { display: 'none' }]}
          >
            <View
              style={[styles.workspaceHeader, keyboardVisible && { display: 'none' }]}
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
                    NEARBY ACTIVE CACHES + YOUR OWN CACHE RECORDS
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
                accessibilityState={{
                  disabled:
                    isSubmitting,
                }}
                disabled={
                  isSubmitting
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

                  isSubmitting &&
                    styles.disabledButton,

                  pressed &&
                    !isSubmitting &&
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
              accessibilityLabel={`${locationStatusText}. ${
                locationError ??
                ''
              }`}
              style={[styles.positionBar, keyboardVisible && { display: 'none' }]}
            >
              <View
                accessible
                accessibilityLabel={`${locationStatusText}. ${locationError ?? ''}`}
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
            {/* CREATE FORM                                                    */}
            {/* -------------------------------------------------------------- */}

            {isBurying ? (
              <FormScrollView
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
                  style={
                    styles.formDescription
                  }
                >
                  Create a live Firestore treasure record. Optional fields stay empty rather than storing placeholder content.
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

                    setFieldErrors(
                      (
                        current,
                      ) => ({
                        ...current,

                        title:
                          '',
                      }),
                    );
                  }}
                  style={[
                    styles.input,

                    Boolean(
                      fieldErrors.title,
                    ) &&
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

                <FormTextInput
                  accessibilityLabel="Cache clue"
                  editable={
                    !isSubmitting
                  }
                  maxLength={
                    MAX_HINT_LENGTH
                  }
                  multiline
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
                  onChangeText={(
                    value,
                  ) => {
                    setNewHint(
                      value,
                    );

                    setFieldErrors(
                      (
                        current,
                      ) => ({
                        ...current,

                        hint:
                          '',
                      }),
                    );
                  }}
                  style={[
                    styles.input,
                    styles.textArea,

                    Boolean(
                      fieldErrors.hint,
                    ) &&
                      styles.inputError,
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

                {fieldErrors.hint ? (
                  <Text
                    style={
                      styles.errorText
                    }
                  >
                    {
                      fieldErrors.hint
                    }
                  </Text>
                ) : null}

                <Text
                  style={
                    styles.label
                  }
                >
                  SECRET PAYLOAD CONTENT
                </Text>

                <FormTextInput
                  accessibilityLabel="Secret payload"
                  editable={
                    !isSubmitting
                  }
                  maxLength={
                    MAX_PAYLOAD_LENGTH
                  }
                  multiline
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
                  onChangeText={(
                    value,
                  ) => {
                    setNewPayload(
                      value,
                    );

                    setFieldErrors(
                      (
                        current,
                      ) => ({
                        ...current,

                        payload:
                          '',
                      }),
                    );
                  }}
                  style={[
                    styles.input,
                    styles.textArea,

                    Boolean(
                      fieldErrors.payload,
                    ) &&
                      styles.inputError,
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

                {fieldErrors.payload ? (
                  <Text
                    style={
                      styles.errorText
                    }
                  >
                    {
                      fieldErrors.payload
                    }
                  </Text>
                ) : null}

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
                        !canUseCurrentPosition ||
                        isSubmitting,
                    }}
                    disabled={
                      !canUseCurrentPosition ||
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
                        !canUseCurrentPosition ||
                        isSubmitting
                      ) &&
                        styles.disabledButton,

                      pressed &&
                        Boolean(
                          userCoords,
                        ) &&
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
                      editable={
                        !isSubmitting
                      }
                      keyboardType={
                        Platform.OS ===
                        'ios'
                          ? 'numbers-and-punctuation'
                          : 'default'
                      }
                      autoCorrect={
                        false
                      }
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

                        setFieldErrors(
                          (
                            current,
                          ) => ({
                            ...current,

                            latitude:
                              '',
                          }),
                        );
                      }}
                      style={[
                        styles.input,

                        Boolean(
                          fieldErrors.latitude,
                        ) &&
                          styles.inputError,
                      ]}
                    />

                    {fieldErrors.latitude ? (
                      <Text
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
                      editable={
                        !isSubmitting
                      }
                      keyboardType={
                        Platform.OS ===
                        'ios'
                          ? 'numbers-and-punctuation'
                          : 'default'
                      }
                      autoCorrect={
                        false
                      }
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

                        setFieldErrors(
                          (
                            current,
                          ) => ({
                            ...current,

                            longitude:
                              '',
                          }),
                        );
                      }}
                      style={[
                        styles.input,

                        Boolean(
                          fieldErrors.longitude,
                        ) &&
                          styles.inputError,
                      ]}
                    />

                    {fieldErrors.longitude ? (
                      <Text
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
                  style={
                    styles.coordinateHelp
                  }
                >
                  Manual coordinates remain available when GPS access is unavailable.
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Seal and bury cache"
                  accessibilityState={{
                    disabled:
                      isSubmitting,

                    busy:
                      crudOperation ===
                      'create',
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
                  {crudOperation ===
                  'create' ? (
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
                    {crudOperation ===
                    'create'
                      ? 'SEALING CACHE...'
                      : 'SEAL & BURY CACHE'}
                  </Text>
                </Pressable>
              </FormScrollView>
            ) : activeTreasuresError && inventoryItems.length === 0 ? (
              <View
                accessibilityRole="alert"
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
                    activeTreasuresError
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
            ) : isLoading && inventoryItems.length === 0 ? (
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="Loading cache records"
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
                  SYNCHRONISING CACHE RECORDS…
                </Text>
              </View>
            ) : (
              <ScrollView
                contentContainerStyle={
                  styles.gridContainer
                }
                showsVerticalScrollIndicator={
                  false
                }
              >
                {inventoryItems.length ===
                0 ? (
                  <View
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
                      NO CACHE RECORDS DETECTED
                    </Text>

                    <Text
                      style={
                        styles.emptyText
                      }
                    >
                      No active caches are within{' '}
                      {
                        INVENTORY_RADIUS_KM
                      }
                      km and you do not currently own any cache records.
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
                    {inventoryItems.map(
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
                            accessibilityLabel={`${item.title}. ${item.status}. ${
                              item.distanceKm >=
                              0
                                ? `${item.distanceKm} kilometres away.`
                                : ''
                            }`}
                            accessibilityState={{
                              selected:
                                isSelected,
                            }}
                            disabled={isSubmitting}
                            onPress={() => {
                              if (crudLockRef.current) return;
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

                              item.isArchived &&
                                styles.itemCardArchived,

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
                                  item.isArchived
                                    ? COLOURS.warning700
                                    : isSelected
                                      ? COLOURS.rust700
                                      : COLOURS.ink900
                                }
                              />

                              {item.distanceKm >=
                              0 ? (
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
                              ) : null}
                            </View>

                            <Text
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
                              numberOfLines={1}
                              style={[
                                styles.itemSubtext,

                                item.isArchived &&
                                  styles.itemSubtextArchived,
                              ]}
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
          {/* 40% — INSPECTION / CRUD CONSOLE                                 */}
          {/* ================================================================ */}

          <View
            style={[[
              styles.rightViewport,

              isLandscape
                ? styles.rightViewportLandscape
                : styles.rightViewportPortrait,
            ], keyboardVisible && { flex: 1 }, keyboardVisible && isBurying && { display: 'none' }]}
          >
            <View
              style={[styles.consoleHeader, keyboardVisible && { display: 'none' }]}
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
                    CACHE RECORD CONTROL
                  </Text>

                  <Text
                    style={
                      styles.consoleSubtitle
                    }
                  >
                    CREATE · READ · UPDATE · DELETE
                  </Text>
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Return to field map"
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
                accessibilityRole="alert"
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
                  accessibilityLabel="Retry Inventory synchronisation"
                  onPress={
                    handleRetryData
                  }
                  style={
                    styles.syncRetryButton
                  }
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
                  style={
                    styles.consoleState
                  }
                >
                  <Ionicons
                    name="add-circle-outline"
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
                    CREATE MODE ACTIVE
                  </Text>

                  <Text
                    style={
                      styles.consoleStateText
                    }
                  >
                    Complete the treasure record in the 60% workspace. The treasure and its field activity will be committed together.
                  </Text>
                </View>
              ) : selectedItem ? (
                isEditing ? (
                  <FormScrollView
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
                      UPDATE CACHE RECORD
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
                      onChangeText={(
                        value,
                      ) => {
                        setEditTitle(
                          value,
                        );

                        setEditErrors(
                          (
                            current,
                          ) => ({
                            ...current,

                            title:
                              '',
                          }),
                        );
                      }}
                      style={[
                        styles.editInput,

                        Boolean(
                          editErrors.title,
                        ) &&
                          styles.editInputError,
                      ]}
                    />

                    {editErrors.title ? (
                      <Text
                        style={
                          styles.darkErrorText
                        }
                      >
                        {
                          editErrors.title
                        }
                      </Text>
                    ) : null}

                    <Text
                      style={
                        styles.darkLabel
                      }
                    >
                      HINT / CLUE
                    </Text>

                    <FormTextInput
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

                    <FormTextInput
                      accessibilityLabel="Edit secret payload"
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
                        styles.editCoordinateHeader
                      }
                    >
                      <Text
                        style={
                          styles.darkLabelInline
                        }
                      >
                        LOCATION
                      </Text>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Use current position for edited cache"
                        accessibilityState={{
                          disabled:
                            !canUseCurrentPosition ||
                            isSubmitting,
                        }}
                        disabled={
                          !canUseCurrentPosition ||
                          isSubmitting
                        }
                        onPress={
                          useCurrentPositionForEdit
                        }
                        style={({
                          pressed,
                        }) => [
                          styles.editUsePositionButton,

                          (
                            !canUseCurrentPosition ||
                            isSubmitting
                          ) &&
                            styles.disabledButton,

                          pressed &&
                            Boolean(
                              userCoords,
                            ) &&
                            !isSubmitting &&
                            styles.darkPressed,
                        ]}
                      >
                        <Ionicons
                          name="locate-outline"
                          size={15}
                          color={
                            COLOURS.parchment100
                          }
                        />

                        <Text
                          style={
                            styles.editUsePositionText
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
                            styles.darkCoordinateLabel
                          }
                        >
                          LATITUDE
                        </Text>

                        <TextInput
                          accessibilityLabel="Edit cache latitude"
                          editable={
                            !isSubmitting
                          }
                          keyboardType={
                            Platform.OS ===
                            'ios'
                              ? 'numbers-and-punctuation'
                              : 'default'
                          }
                          autoCorrect={
                            false
                          }
                          selectionColor={
                            COLOURS.bronze400
                          }
                          value={
                            editLat
                          }
                          onChangeText={(
                            value,
                          ) => {
                            setEditLat(
                              value,
                            );

                            setEditErrors(
                              (
                                current,
                              ) => ({
                                ...current,

                                latitude:
                                  '',
                              }),
                            );
                          }}
                          style={[
                            styles.editInput,

                            Boolean(
                              editErrors.latitude,
                            ) &&
                              styles.editInputError,
                          ]}
                        />

                        {editErrors.latitude ? (
                          <Text
                            style={
                              styles.darkErrorText
                            }
                          >
                            {
                              editErrors.latitude
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
                            styles.darkCoordinateLabel
                          }
                        >
                          LONGITUDE
                        </Text>

                        <TextInput
                          accessibilityLabel="Edit cache longitude"
                          editable={
                            !isSubmitting
                          }
                          keyboardType={
                            Platform.OS ===
                            'ios'
                              ? 'numbers-and-punctuation'
                              : 'default'
                          }
                          autoCorrect={
                            false
                          }
                          selectionColor={
                            COLOURS.bronze400
                          }
                          value={
                            editLng
                          }
                          onChangeText={(
                            value,
                          ) => {
                            setEditLng(
                              value,
                            );

                            setEditErrors(
                              (
                                current,
                              ) => ({
                                ...current,

                                longitude:
                                  '',
                              }),
                            );
                          }}
                          style={[
                            styles.editInput,

                            Boolean(
                              editErrors.longitude,
                            ) &&
                              styles.editInputError,
                          ]}
                        />

                        {editErrors.longitude ? (
                          <Text
                            style={
                              styles.darkErrorText
                            }
                          >
                            {
                              editErrors.longitude
                            }
                          </Text>
                        ) : null}
                      </View>
                    </View>

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
                            crudOperation ===
                            'update',
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
                        {crudOperation ===
                        'update' ? (
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
                        accessibilityLabel="Cancel editing"
                        disabled={
                          isSubmitting
                        }
                        onPress={() => {
                          setIsEditing(
                            false,
                          );

                          setEditErrors(
                            {},
                          );
                        }}
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
                  </FormScrollView>
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
                      style={
                        styles.cacheIdentityBlock
                      }
                    >
                      <View
                        style={[
                          styles.iconCircle,

                          selectedItem.isArchived &&
                            styles.iconCircleArchived,
                        ]}
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
                          {selectedItem.distanceKm >=
                          0
                            ? `${selectedItem.distanceKm} KM`
                            : 'POSITION REQUIRED'}
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

                            selectedItem.isArchived &&
                              styles.metaValueArchived,
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

                      <Text
                        style={
                          selectedItem.hint
                            ?.trim()
                            ? styles.recordText
                            : styles.recordMutedText
                        }
                      >
                        {selectedItem.hint
                          ?.trim()
                          ? `“${selectedItem.hint}”`
                          : 'NO CLUE RECORDED'}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.recordBox,

                        !canRevealSelectedPayload &&
                          styles.lockedPayloadBox,
                      ]}
                    >
                      <View
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
                          style={
                            selectedItem.payloadText
                              ?.trim()
                              ? styles.recordText
                              : styles.recordMutedText
                          }
                        >
                          {selectedItem.payloadText
                            ?.trim() ||
                            'NO PAYLOAD TEXT RECORDED'}
                        </Text>
                      ) : (
                        <Text
                          style={
                            styles.lockedPayloadText
                          }
                        >
                          EXCAVATE THIS CACHE IN HUNT MODE TO REVEAL ITS SECRET PAYLOAD.
                        </Text>
                      )}
                    </View>

                    {selectedItem.isArchived ? (
                      <View
                        style={
                          styles.archivedNotice
                        }
                      >
                        <Ionicons
                          name="archive-outline"
                          size={16}
                          color={
                            COLOURS.warning300
                          }
                        />

                        <Text
                          style={
                            styles.archivedNoticeText
                          }
                        >
                          ARCHIVED RECORD · HIDDEN FROM ACTIVE FIELD VIEWS
                        </Text>
                      </View>
                    ) : null}
                  </ScrollView>
                )
              ) : (
                <View
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
                    style={
                      styles.consoleStateText
                    }
                  >
                    Select a cache record in the field workspace to inspect or manage it.
                  </Text>
                </View>
              )}
            </View>

            {/* -------------------------------------------------------------- */}
            {/* CRUD ACTIONS                                                   */}
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

                  {selectedItem.isArchived ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Restore ${selectedItem.title}`}
                        disabled={
                          isSubmitting
                        }
                        onPress={() =>
                          requestConfirmation('restore')
                        }
                        style={({
                          pressed,
                        }) => [
                          styles.creatorActionButton,
                          styles.restoreButton,

                          isSubmitting &&
                            styles.disabledButton,

                          pressed &&
                            !isSubmitting &&
                            styles.darkPressed,
                        ]}
                      >
                        <Ionicons
                          name="refresh-outline"
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
                          RESTORE
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Permanently delete ${selectedItem.title}`}
                        disabled={
                          isSubmitting
                        }
                        onPress={() =>
                          requestConfirmation('delete')
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
                    </>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Archive ${selectedItem.title}`}
                      disabled={
                        isSubmitting
                      }
                      onPress={() =>
                        requestConfirmation('archive')
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
                  )}
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Track ${selectedItem.title} in Hunt`}
                  accessibilityState={{
                    disabled:
                      !onNavigate ||
                      isSubmitting ||
                      selectedItem.isArchived,
                  }}
                  disabled={
                    !onNavigate ||
                    isSubmitting ||
                    selectedItem.isArchived
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
                      isSubmitting ||
                      selectedItem.isArchived
                    ) &&
                      styles.disabledButton,

                    pressed &&
                      Boolean(
                        onNavigate,
                      ) &&
                      !isSubmitting &&
                      !selectedItem.isArchived &&
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

            {!keyboardVisible && (<FieldNavBar
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
            />)}
          </View>
        </View>

        {/* ================================================================== */}
        {/* Cross-platform confirmation modal                                  */}
        {/* ================================================================== */}

        <Modal
          testID="inventory-confirmation-modal"
          supportedOrientations={['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right']}
          transparent
          visible={
            Boolean(
              confirmationContent,
            )
          }
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => {
            if (
              !isSubmitting
            ) {
              setConfirmationAction(
                null,
              );
            }
          }}
        >
          <View
            style={
              styles.modalOverlay
            }
          >
            <View
              accessibilityViewIsModal
              accessibilityLabel={
                confirmationContent
                  ?.title ??
                'Cache confirmation'
              }
              onAccessibilityEscape={() => {
                if (
                  !isSubmitting
                ) {
                  setConfirmationAction(
                    null,
                  );
                }
              }}
              style={
                styles.confirmationCard
              }
            >
              {confirmationContent ? (
                <>
                  <View
                    style={
                      styles.confirmationIcon
                    }
                  >
                    <Ionicons
                      name={
                        confirmationContent.icon
                      }
                      size={28}
                      color={
                        confirmationAction ===
                        'delete'
                          ? COLOURS.danger300
                          : COLOURS.warning300
                      }
                    />
                  </View>

                  <Text
                    accessibilityRole="header"
                    style={
                      styles.confirmationTitle
                    }
                  >
                    {
                      confirmationContent.title
                    }
                  </Text>

                  <Text
                    style={
                      styles.confirmationMessage
                    }
                  >
                    {
                      confirmationContent.message
                    }
                  </Text>

                  <View
                    style={
                      styles.confirmationActions
                    }
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Cancel"
                      disabled={
                        isSubmitting
                      }
                      onPress={() =>
                        setConfirmationAction(
                          null,
                        )
                      }
                      style={({
                        pressed,
                      }) => [
                        styles.confirmationButton,
                        styles.confirmationCancelButton,

                        isSubmitting &&
                          styles.disabledButton,

                        pressed &&
                          !isSubmitting &&
                          styles.darkPressed,
                      ]}
                    >
                      <Text
                        style={
                          styles.confirmationButtonText
                        }
                      >
                        CANCEL
                      </Text>
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        confirmationContent.actionLabel
                      }
                      disabled={
                        isSubmitting
                      }
                      onPress={
                        handleConfirmAction
                      }
                      style={({
                        pressed,
                      }) => [
                        styles.confirmationButton,

                        confirmationAction ===
                          'delete'
                          ? styles.confirmationDeleteButton
                          : styles.confirmationConfirmButton,

                        isSubmitting &&
                          styles.disabledButton,

                        pressed &&
                          !isSubmitting &&
                          styles.primaryPressed,
                      ]}
                    >
                      <Text
                        style={
                          styles.confirmationButtonText
                        }
                      >
                        {
                          confirmationContent.actionLabel
                        }
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
            </View>
          </View>
        </Modal>
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
    /* 60% workspace                                                          */
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
    /* Position                                                               */
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
    /* Loading / empty states                                                 */
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

    stateActionButton: {
      minHeight:
        MIN_TOUCH_TARGET,

      minWidth: 170,

      marginTop: 4,

      justifyContent:
        'center',

      alignItems:
        'center',

      paddingHorizontal: 12,

      backgroundColor:
        COLOURS.rust700,

      borderRadius: 5,
    },

    stateActionText: {
      color:
        COLOURS.parchment100,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 9.5,

      fontWeight: '800',
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

      fontWeight: '800',

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

      fontWeight: '800',
    },

    /* ---------------------------------------------------------------------- */
    /* Grid                                                                   */
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

    itemCardArchived: {
      backgroundColor:
        '#D2C6A8',

      borderStyle: 'dashed',

      borderColor:
        COLOURS.warning700,
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

      fontWeight: '700',

      letterSpacing: 0.35,
    },

    itemSubtextArchived: {
      color:
        COLOURS.warning700,
    },

    /* ---------------------------------------------------------------------- */
    /* Create form                                                            */
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

      fontWeight: '800',

      letterSpacing: 0.7,
    },

    formDescription: {
      marginTop: 4,

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

      fontWeight: '800',

      letterSpacing: 0.5,
    },

    labelInline: {
      color:
        COLOURS.ink900,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 9.5,

      fontWeight: '800',
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

      fontWeight: '800',

      letterSpacing: 0.7,
    },

    /* ---------------------------------------------------------------------- */
    /* 40% console                                                            */
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

      padding: 18,
    },

    consoleStateTitle: {
      color:
        COLOURS.parchment100,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 11,

      fontWeight: '800',

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
    /* Details                                                                */
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

    iconCircleArchived: {
      borderColor:
        COLOURS.warning300,
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
    },

    itemReference: {
      marginTop: 2,

      color:
        COLOURS.bronze400,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 8.5,

      fontWeight: '700',
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
      color:
        COLOURS.bronze400,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 8.5,

      fontWeight: '800',
    },

    metaValue: {
      flex: 1,

      minWidth: 0,

      color:
        COLOURS.parchment100,

      fontFamily:
        MONO_FONT,

      fontSize: 9.5,

      textAlign: 'right',
    },

    metaValueSuccess: {
      color:
        COLOURS.success300,

      fontFamily:
        MONO_BOLD_FONT,
    },

    metaValueArchived: {
      color:
        COLOURS.warning300,

      fontFamily:
        MONO_BOLD_FONT,
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

      fontWeight: '800',
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

      fontStyle: 'italic',
    },

    lockedPayloadBox: {
      borderColor:
        COLOURS.warning300,

      borderStyle: 'dashed',
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

    archivedNotice: {
      minHeight: 42,

      marginTop: 8,

      paddingHorizontal: 8,

      flexDirection: 'row',

      alignItems: 'center',

      justifyContent:
        'center',

      gap: 6,

      borderWidth: 1,

      borderColor:
        COLOURS.warning300,

      borderRadius: 5,
    },

    archivedNoticeText: {
      flex: 1,

      color:
        COLOURS.warning300,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 8,

      lineHeight: 12,

      fontWeight: '800',

      textAlign: 'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Editing                                                                */
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

      fontWeight: '800',

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

      fontWeight: '800',
    },

    darkLabelInline: {
      color:
        COLOURS.bronze400,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 8.5,

      fontWeight: '800',
    },

    darkCoordinateLabel: {
      marginBottom: 4,

      color:
        COLOURS.bronze400,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 7.5,

      fontWeight: '800',
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

    editInputError: {
      borderColor:
        COLOURS.danger300,

      borderWidth: 2,
    },

    editTextArea: {
      minHeight: 78,

      maxHeight: 120,
    },

    darkErrorText: {
      marginTop: 3,

      color:
        COLOURS.danger300,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 7.5,

      lineHeight: 11,
    },

    editCoordinateHeader: {
      minHeight: 48,

      marginTop: 6,

      flexDirection: 'row',

      alignItems: 'center',

      justifyContent:
        'space-between',

      gap: 6,
    },

    editUsePositionButton: {
      minHeight:
        MIN_TOUCH_TARGET,

      paddingHorizontal: 8,

      flexDirection: 'row',

      alignItems: 'center',

      justifyContent:
        'center',

      gap: 5,

      borderWidth: 1,

      borderColor:
        COLOURS.bronze500,

      borderRadius: 4,
    },

    editUsePositionText: {
      color:
        COLOURS.parchment100,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 7.5,

      fontWeight: '800',
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

      fontWeight: '800',
    },

    /* ---------------------------------------------------------------------- */
    /* CRUD actions                                                           */
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

      paddingHorizontal: 5,

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

    restoreButton: {
      backgroundColor:
        COLOURS.success700,
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

      fontSize: 8,

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

      fontWeight: '800',
    },

    /* ---------------------------------------------------------------------- */
    /* Confirmation modal                                                     */
    /* ---------------------------------------------------------------------- */

    modalOverlay: {
      flex: 1,

      justifyContent:
        'center',

      alignItems:
        'center',

      padding: 20,

      backgroundColor:
        COLOURS.overlay,
    },

    confirmationCard: {
      width: '100%',

      maxWidth: 480,

      padding: 18,

      alignItems: 'center',

      backgroundColor:
        COLOURS.forest800,

      borderWidth: 2,

      borderColor:
        COLOURS.bronze500,

      borderRadius: 8,
    },

    confirmationIcon: {
      width: 52,

      height: 52,

      justifyContent:
        'center',

      alignItems:
        'center',

      backgroundColor:
        COLOURS.forest950,

      borderWidth: 1,

      borderColor:
        COLOURS.bronze500,

      borderRadius: 26,

      marginBottom: 10,
    },

    confirmationTitle: {
      color:
        COLOURS.parchment100,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 14,

      lineHeight: 20,

      fontWeight: '800',

      textAlign: 'center',
    },

    confirmationMessage: {
      marginTop: 8,

      color:
        COLOURS.bronze400,

      fontSize: 11,

      lineHeight: 17,

      textAlign: 'center',
    },

    confirmationActions: {
      width: '100%',

      flexDirection: 'row',

      gap: 8,

      marginTop: 16,
    },

    confirmationButton: {
      flex: 1,

      minHeight:
        MIN_TOUCH_TARGET,

      justifyContent:
        'center',

      alignItems:
        'center',

      paddingHorizontal: 8,

      borderWidth: 1,

      borderRadius: 5,
    },

    confirmationCancelButton: {
      backgroundColor:
        COLOURS.forest700,

      borderColor:
        COLOURS.bronze500,
    },

    confirmationConfirmButton: {
      backgroundColor:
        COLOURS.warning700,

      borderColor:
        COLOURS.warning300,
    },

    confirmationDeleteButton: {
      backgroundColor:
        COLOURS.rust700,

      borderColor:
        COLOURS.danger300,
    },

    confirmationButtonText: {
      color:
        COLOURS.parchment100,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 9,

      fontWeight: '800',

      textAlign: 'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Press states                                                           */
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
