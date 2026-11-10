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

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';

import { Accelerometer } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as ScreenOrientation from 'expo-screen-orientation';
import { onAuthStateChanged } from 'firebase/auth';
import { readDashboardProfile, readDashboardTreasure } from '../utils/dashboardData';
import { HUNT_LOCATION_MAX_AGE_MS, isFreshHuntFix, withHuntTimeout } from '../utils/huntValidation';

import Svg, {
  Line,
  Polygon,
  Text as SvgText,
} from 'react-native-svg';

import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import {
  auth,
  db,
} from '../config/firebase';

import type {
  TreasureDocument,
  UserDocument,
} from '../types/firestore';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const DISCOVERY_RADIUS_METRES =
  5;

/*
 * GPS uncertainty must be reasonably small before a discovery can be
 * recorded. This is intentionally larger than the five-metre dig radius
 * because consumer GPS rarely guarantees five-metre accuracy.
 */
const MAX_ACCEPTABLE_GPS_ACCURACY_METRES =
  15;

const MAX_LOCATION_AGE_MS =
  HUNT_LOCATION_MAX_AGE_MS;

const CACHED_LOCATION_MAX_AGE_MS =
  30_000;

const CACHED_LOCATION_REQUIRED_ACCURACY_METRES =
  100;

const LOCATION_ACQUISITION_TIMEOUT_MS =
  20_000;

const LOCATION_UPDATE_INTERVAL_MS =
  1_000;

const LOCATION_DISTANCE_INTERVAL_METRES =
  1;

const LOCATION_FRESHNESS_TICK_MS =
  2_000;

const SHAKE_COOLDOWN_MS =
  2_000;

/*
 * Shake strength is measured as acceleration away from normal 1 g gravity.
 * This reduces accidental excavation from ordinary walking or device tilt.
 */
const DEFAULT_SHAKE_IMPULSE_THRESHOLD =
  1.25;

const SENSITIVE_SHAKE_IMPULSE_THRESHOLD =
  0.85;

/*
 * Android 12 limits ordinary sensor sampling to 200 ms unless the app has
 * HIGH_SAMPLING_RATE_SENSORS, so Hunt stays at the standard-safe interval.
 */
const ACCELEROMETER_UPDATE_INTERVAL_MS =
  200;

const HEADING_STATE_UPDATE_INTERVAL_MS =
  250;

const MIN_TOUCH_TARGET =
  48;

const COLOURS = {
  forest950: '#151C16',
  forest900: '#1C261D',
  forest800: '#2C3B2E',
  forest700: '#3D503F',

  parchment100: '#FFF8E8',
  parchment200: '#F4E8CA',

  ink900: '#211C18',
  ink700: '#514A40',

  rust800: '#71301C',
  rust700: '#8A3D24',
  rust600: '#9B4A2C',

  brass700: '#6C542C',
  brass600: '#8D713F',
  brass500: '#B08D57',
  brass400: '#D8B875',

  success700: '#3E6546',
  success300: '#BFE3C0',

  warning300: '#FFD166',
  danger300: '#FFB4A2',

  disabled: '#4F5750',
  disabledBorder: '#9AA09B',

  white: '#FFFFFF',

  overlay:
    'rgba(0, 0, 0, 0.88)',
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
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type GpsStatus =
  | 'INITIALISING'
  | 'PERMISSION_REQUIRED'
  | 'DENIED'
  | 'PRECISION_REQUIRED'
  | 'SERVICES_OFF'
  | 'OK'
  | 'LOW_ACCURACY'
  | 'MOCKED_LOCATION'
  | 'ERROR';

type LocationFixSource =
  | 'none'
  | 'cached'
  | 'live';

type CompassStatus =
  | 'CHECKING'
  | 'READY'
  | 'LOW_ACCURACY'
  | 'UNAVAILABLE'
  | 'ERROR';

type HeadingReference =
  | 'true'
  | 'magnetic'
  | null;

type SensorPermissionState =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'undetermined';

interface NavigationLike {
  canGoBack: () => boolean;

  goBack: () => void;
}

interface HuntScreenProps {
  route?: {
    params?: {
      treasureId?: string;
    };
  };

  treasureId?: string;

  onBack?: () => void;

  onSuccess?: () => void;

  navigation?: NavigationLike;
}

interface LatLng {
  latitude: number;

  longitude: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Keeps diagnostics out of production logs.
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

// Validates coordinates before navigation calculations.
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

// Validates a horizontal accuracy measurement.
const isValidAccuracy = (
  accuracy: unknown,
): accuracy is number =>
  typeof accuracy ===
    'number' &&
  Number.isFinite(
    accuracy,
  ) &&
  accuracy >= 0;

// Calculates straight-line geographic distance.
const getDistanceInMetres = (
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number => {
  const earthRadiusMetres =
    6_371_000;

  const latitudeDifference =
    ((latitudeB -
      latitudeA) *
      Math.PI) /
    180;

  const longitudeDifference =
    ((longitudeB -
      longitudeA) *
      Math.PI) /
    180;

  const latitudeARadians =
    (latitudeA *
      Math.PI) /
    180;

  const latitudeBRadians =
    (latitudeB *
      Math.PI) /
    180;

  const haversine =
    Math.sin(
      latitudeDifference /
        2,
    ) **
      2 +
    Math.cos(
      latitudeARadians,
    ) *
      Math.cos(
        latitudeBRadians,
      ) *
      Math.sin(
        longitudeDifference /
          2,
      ) **
        2;

  const angularDistance =
    2 *
    Math.atan2(
      Math.sqrt(
        Math.min(1, Math.max(0, haversine)),
      ),
      Math.sqrt(
        Math.max(0, 1 - haversine),
      ),
    );

  return (
    earthRadiusMetres *
    angularDistance
  );
};

// Calculates true bearing from the Explorer to the cache.
const getBearingInDegrees = (
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number => {
  const fromLatitudeRadians =
    (fromLatitude *
      Math.PI) /
    180;

  const toLatitudeRadians =
    (toLatitude *
      Math.PI) /
    180;

  const longitudeDifferenceRadians =
    ((toLongitude -
      fromLongitude) *
      Math.PI) /
    180;

  const y =
    Math.sin(
      longitudeDifferenceRadians,
    ) *
    Math.cos(
      toLatitudeRadians,
    );

  const x =
    Math.cos(
      fromLatitudeRadians,
    ) *
      Math.sin(
        toLatitudeRadians,
      ) -
    Math.sin(
      fromLatitudeRadians,
    ) *
      Math.cos(
        toLatitudeRadians,
      ) *
      Math.cos(
        longitudeDifferenceRadians,
      );

  return normaliseDegrees(
    Math.atan2(
      y,
      x,
    ) *
      (180 /
        Math.PI),
  );
};

// Keeps angles between zero and 360 degrees.
const normaliseDegrees = (
  degrees: number,
): number =>
  ((degrees % 360) +
    360) %
  360;

// Finds the shortest path between two compass angles.
const shortestAngleDelta = (
  fromDegrees: number,
  toDegrees: number,
): number =>
  ((
    toDegrees -
    fromDegrees +
    540
  ) %
    360) -
  180;

// Converts a bearing to a cardinal label.
const getCardinalDirection = (
  degrees: number,
): string => {
  const directions = [
    'N',
    'NE',
    'E',
    'SE',
    'S',
    'SW',
    'W',
    'NW',
  ];

  const index =
    Math.round(
      normaliseDegrees(
        degrees,
      ) /
        45,
    ) %
    directions.length;

  return directions[index];
};

// Formats distance without producing very long metre values.
const formatDistance = (
  distanceMetres:
    number | null,
): string => {
  if (
    distanceMetres ===
    null
  ) {
    return '--- m';
  }

  if (
    distanceMetres <
    1_000
  ) {
    return `${String(
      Math.max(
        0,
        Math.round(
          distanceMetres,
        ),
      ),
    ).padStart(
      3,
      '0',
    )} m`;
  }

  const kilometres =
    distanceMetres /
    1_000;

  if (
    kilometres <
    10
  ) {
    return `${kilometres.toFixed(
      1,
    )} km`;
  }

  return `${Math.round(
    kilometres,
  )} km`;
};

// Finds whether the platform granted precise rather than approximate location.
const getPreciseLocationPermission = (
  permission:
    Location.LocationPermissionResponse,
): boolean | null => {
  if (
    permission.status !==
    Location
      .PermissionStatus
      .GRANTED
  ) {
    return null;
  }

  if (
    Platform.OS ===
    'ios'
  ) {
    // Expo's iOS permission response does not expose location accuracy.
    return null;
  }

  if (
    Platform.OS ===
    'android'
  ) {
    const accuracy =
      permission.android
        ?.accuracy;

    if (
      accuracy ===
      'fine'
    ) {
      return true;
    }

    if (
      accuracy ===
      'coarse'
    ) {
      return false;
    }
  }

  /*
   * Browser implementations do not expose fine/coarse permission details.
   * Hunt instead evaluates the accuracy supplied with each live fix.
   */
  return null;
};

// Announces important state changes.
const announce = (
  message: string,
): void => {
  AccessibilityInfo
    .announceForAccessibility(
      message,
    );
};

// Keeps alerts and screen-reader announcements aligned.
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

/* -------------------------------------------------------------------------- */
/* Odometer                                                                   */
/* -------------------------------------------------------------------------- */

interface OdometerDigitProps {
  character: string;
}

const OdometerDigit:
  React.FC<
    OdometerDigitProps
  > = ({
    character,
  }) => {
    if (
      character === ' '
    ) {
      return (
        <View
          style={
            styles.odometerSpacer
          }
        />
      );
    }

    return (
      <View
        accessible={
          false
        }
        importantForAccessibility="no-hide-descendants"
        style={
          styles.odometerBox
        }
      >
        <View
          style={
            styles.odometerSplitLine
          }
        />

        <Text
          style={
            styles.odometerText
          }
        >
          {
            character
          }
        </Text>
      </View>
    );
  };

interface OdometerDisplayProps {
  value: string;

  accessibilityValue: string;
}

const OdometerDisplay:
  React.FC<
    OdometerDisplayProps
  > = ({
    value,
    accessibilityValue,
  }) => (
    <View
      accessible
      accessibilityLabel={`Distance to target: ${accessibilityValue}`}
      style={
        styles.odometerContainer
      }
    >
      {value
        .split('')
        .map(
          (
            character,
            index,
          ) => (
            <OdometerDigit
              key={`${character}-${index}`}
              character={
                character
              }
            />
          ),
        )}
    </View>
  );

/* -------------------------------------------------------------------------- */
/* Compass                                                                    */
/* -------------------------------------------------------------------------- */

interface CompassDialProps {
  cardRotation:
    Animated.Value;

  targetRotation:
    Animated.Value;

  size?: number;

  hasTargetBearing:
    boolean;

  accessibilityLabel:
    string;
}

const CompassDial:
  React.FC<
    CompassDialProps
  > = ({
    cardRotation,
    targetRotation,
    size = 220,
    hasTargetBearing,
    accessibilityLabel,
  }) => {
    const directions = [
      {
        label: 'N',
        angle: 0,
      },
      {
        label: 'E',
        angle: 90,
      },
      {
        label: 'S',
        angle: 180,
      },
      {
        label: 'W',
        angle: 270,
      },
    ];

    const innerSize =
      size -
      24;

    const cardRotationStyle =
      cardRotation.interpolate({
        inputRange: [
          0,
          360,
        ],

        outputRange: [
          '0deg',
          '360deg',
        ],

        extrapolate:
          'extend',
      });

    const needleRotationStyle =
      targetRotation.interpolate({
        inputRange: [
          0,
          360,
        ],

        outputRange: [
          '0deg',
          '360deg',
        ],

        extrapolate:
          'extend',
      });

    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={
          accessibilityLabel
        }
        style={[
          styles.compassRim,

          {
            width:
              size,

            height:
              size,

            borderRadius:
              size /
              2,
          },
        ]}
      >
        <View
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.compassFace,

            {
              width:
                innerSize,

              height:
                innerSize,

              borderRadius:
                innerSize /
                2,
            },
          ]}
        >
          {/*
           * SVG remains inside an ordinary Animated.View so react-native-svg
           * never receives StyleSheet.absoluteFill directly on web.
           */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.compassSvgLayer,

              {
                transform: [
                  {
                    rotate:
                      cardRotationStyle,
                  },
                ],
              },
            ]}
          >
            <Svg
              width="100%"
              height="100%"
              viewBox="0 0 200 200"
            >
              {Array.from({
                length: 72,
              }).map(
                (
                  _,
                  index,
                ) => {
                  const angleRadians =
                    (index *
                      5 *
                      Math.PI) /
                    180;

                  const isMajor =
                    index % 6 ===
                    0;

                  const innerRadius =
                    isMajor
                      ? 78
                      : 84;

                  const outerRadius =
                    90;

                  return (
                    <Line
                      key={
                        index
                      }
                      x1={
                        100 +
                        innerRadius *
                          Math.sin(
                            angleRadians,
                          )
                      }
                      y1={
                        100 -
                        innerRadius *
                          Math.cos(
                            angleRadians,
                          )
                      }
                      x2={
                        100 +
                        outerRadius *
                          Math.sin(
                            angleRadians,
                          )
                      }
                      y2={
                        100 -
                        outerRadius *
                          Math.cos(
                            angleRadians,
                          )
                      }
                      stroke={
                        COLOURS.brass400
                      }
                      strokeWidth={
                        isMajor
                          ? 1.5
                          : 0.7
                      }
                      opacity={
                        isMajor
                          ? 0.95
                          : 0.55
                      }
                    />
                  );
                },
              )}

              {directions.map(
                (
                  direction,
                ) => {
                  const angleRadians =
                    (direction.angle *
                      Math.PI) /
                    180;

                  return (
                    <SvgText
                      key={
                        direction.label
                      }
                      x={
                        100 +
                        62 *
                          Math.sin(
                            angleRadians,
                          )
                      }
                      y={
                        100 -
                        62 *
                          Math.cos(
                            angleRadians,
                          ) +
                        5
                      }
                      textAnchor="middle"
                      fill={
                        COLOURS.parchment200
                      }
                      fontSize="15"
                      fontWeight="bold"
                      fontFamily="Courier"
                    >
                      {
                        direction.label
                      }
                    </SvgText>
                  );
                },
              )}
            </Svg>
          </Animated.View>

          {/* The rust needle points towards the selected treasure. */}
          <Animated.View
            style={[
              styles.targetNeedleWrapper,

              {
                opacity:
                  hasTargetBearing
                    ? 1
                    : 0.25,

                transform: [
                  {
                    rotate:
                      needleRotationStyle,
                  },
                ],
              },
            ]}
          >
            <Svg
              width={24}
              height={
                size *
                0.64
              }
              viewBox="0 0 24 160"
            >
              <Polygon
                points="12,4 4,82 20,82"
                fill={
                  COLOURS.rust700
                }
              />

              <Polygon
                points="12,156 7,82 17,82"
                fill={
                  COLOURS.parchment200
                }
                opacity={0.72}
              />
            </Svg>
          </Animated.View>

          <View
            style={
              styles.compassCap
            }
          />
        </View>
      </View>
    );
  };

/* -------------------------------------------------------------------------- */
/* Hunt screen                                                                */
/* -------------------------------------------------------------------------- */

export const HuntScreen:
  React.FC<
    HuntScreenProps
  > = ({
    route,
    treasureId,
    onBack,
    onSuccess,
    navigation,
  }) => {
    const insets =
      useSafeAreaInsets();

    const {
      width:
        windowWidth,
      height:
        windowHeight,
    } =
      useWindowDimensions();

    const isLandscape =
      windowWidth >
      windowHeight;
    const [interfaceOrientation, setInterfaceOrientation] = useState<ScreenOrientation.Orientation | null>(null);
    useEffect(() => {
      if (Platform.OS !== 'ios') return;
      let active = true;
      let receivedEvent = false;
      const subscription = ScreenOrientation.addOrientationChangeListener(event => {
        receivedEvent = true;
        if (active) setInterfaceOrientation(event.orientationInfo.orientation);
      });
      void ScreenOrientation.getOrientationAsync().then(orientation => {
        if (active && !receivedEvent) setInterfaceOrientation(orientation);
      }).catch(() => {});
      return () => { active = false; subscription.remove(); };
    }, []);
    // Expo's iOS CLLocationManager leaves headings relative to the portrait top edge.
    // UIInterfaceOrientation landscape-left has the camera on the right; the screen's top is -90°.
    const headingOrientationOffset = Platform.OS !== 'ios' ? 0
      : interfaceOrientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ? -90
        : interfaceOrientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT ? 90
          : interfaceOrientation === ScreenOrientation.Orientation.PORTRAIT_DOWN ? 180 : 0;

    const targetTreasureId =
      useMemo(
        () => {
          const value =
            treasureId ??
            route?.params
              ?.treasureId;

          return typeof value ===
            'string' &&
            value.trim()
            ? value.trim()
            : undefined;
        },
        [
          route?.params
            ?.treasureId,
          treasureId,
        ],
      );

    const [currentUser, setCurrentUser] = useState(auth.currentUser);
    useEffect(() => onAuthStateChanged(auth, setCurrentUser), []);

    const currentUserId =
      currentUser?.uid ??
      null;
    const huntContextRef = useRef({ userId: currentUserId, targetId: targetTreasureId });
    if (huntContextRef.current.userId !== currentUserId || huntContextRef.current.targetId !== targetTreasureId) {
      huntContextRef.current = { userId: currentUserId, targetId: targetTreasureId };
    }
    const currentHuntContext = huntContextRef.current;

    /* ---------------------------------------------------------------------- */
    /* Firestore state                                                        */
    /* ---------------------------------------------------------------------- */

    const [
      treasure,
      setTreasure,
    ] =
      useState<TreasureDocument | null>(
        null,
      );

    const [
      userProfile,
      setUserProfile,
    ] =
      useState<UserDocument | null>(
        null,
      );

    const [
      isExcavated,
      setIsExcavated,
    ] =
      useState(false);

    const [
      treasureLoading,
      setTreasureLoading,
    ] =
      useState(true);

    const [
      profileLoading,
      setProfileLoading,
    ] =
      useState(true);

    const [
      discoveryLoading,
      setDiscoveryLoading,
    ] =
      useState(true);

    const [
      treasureError,
      setTreasureError,
    ] =
      useState<string | null>(
        null,
      );

    const [
      profileError,
      setProfileError,
    ] =
      useState<string | null>(
        null,
      );

    const [
      discoveryError,
      setDiscoveryError,
    ] =
      useState<string | null>(
        null,
      );

    const [
      firestoreRetryKey,
      setFirestoreRetryKey,
    ] =
      useState(0);

    /* ---------------------------------------------------------------------- */
    /* Location state                                                         */
    /* ---------------------------------------------------------------------- */

    const [
      distance,
      setDistance,
    ] =
      useState<number | null>(
        null,
      );

    const [
      targetBearing,
      setTargetBearing,
    ] =
      useState<number | null>(
        null,
      );

    const [
      gpsAccuracy,
      setGpsAccuracy,
    ] =
      useState<number | null>(
        null,
      );

    const [
      gpsStatus,
      setGpsStatus,
    ] =
      useState<GpsStatus>(
        'INITIALISING',
      );

    const [
      locationFixSource,
      setLocationFixSource,
    ] =
      useState<LocationFixSource>(
        'none',
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
      preciseLocationGranted,
      setPreciseLocationGranted,
    ] =
      useState<boolean | null>(
        null,
      );

    const [
      locationServicesEnabled,
      setLocationServicesEnabled,
    ] =
      useState<boolean | null>(
        null,
      );

    const [
      locationErrorMessage,
      setLocationErrorMessage,
    ] =
      useState<string | null>(
        null,
      );

    const [
      latestLocationTimestamp,
      setLatestLocationTimestamp,
    ] =
      useState<number | null>(
        null,
      );

    const [
      isRefreshingLocation,
      setIsRefreshingLocation,
    ] =
      useState(false);

    const [
      isMockedLocation,
      setIsMockedLocation,
    ] =
      useState(false);

    const [
      freshnessClock,
      setFreshnessClock,
    ] =
      useState(
        Date.now(),
      );

    /* ---------------------------------------------------------------------- */
    /* Compass state                                                          */
    /* ---------------------------------------------------------------------- */

    const [
      compassStatus,
      setCompassStatus,
    ] =
      useState<CompassStatus>(
        Platform.OS ===
          'web'
          ? 'UNAVAILABLE'
          : 'CHECKING',
      );

    const [
      deviceHeading,
      setDeviceHeading,
    ] =
      useState<number | null>(
        null,
      );

    const [
      headingAccuracy,
      setHeadingAccuracy,
    ] =
      useState<number | null>(
        null,
      );

    const [
      headingReference,
      setHeadingReference,
    ] =
      useState<HeadingReference>(
        null,
      );

    /* ---------------------------------------------------------------------- */
    /* Motion state                                                           */
    /* ---------------------------------------------------------------------- */

    const [
      accelerometerAvailable,
      setAccelerometerAvailable,
    ] =
      useState<boolean | null>(
        null,
      );

    const [
      motionPermissionStatus,
      setMotionPermissionStatus,
    ] =
      useState<SensorPermissionState>(
        'unknown',
      );

    const [
      isRequestingMotionPermission,
      setIsRequestingMotionPermission,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* Excavation state                                                       */
    /* ---------------------------------------------------------------------- */

    const [
      isSubmitting,
      setIsSubmitting,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* Accessibility                                                          */
    /* ---------------------------------------------------------------------- */

    const [
      reduceMotionEnabled,
      setReduceMotionEnabled,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* App state                                                              */
    /* ---------------------------------------------------------------------- */

    const [
      appIsActive,
      setAppIsActive,
    ] =
      useState(
        AppState.currentState !== 'background',
      );
    const [interactionIsActive, setInteractionIsActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
    const interactionActiveRef = useRef(interactionIsActive);
    const motionRequestRef = useRef(false);

    /* ---------------------------------------------------------------------- */
    /* Image modal                                                            */
    /* ---------------------------------------------------------------------- */

    const [
      imageModalVisible,
      setImageModalVisible,
    ] =
      useState(false);

    const [
      imageLoadFailed,
      setImageLoadFailed,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* Refs                                                                   */
    /* ---------------------------------------------------------------------- */

    const isMountedRef =
      useRef(true);

    const locationSubscriptionRef =
      useRef<Location.LocationSubscription | null>(
        null,
      );

    const headingSubscriptionRef =
      useRef<Location.LocationSubscription | null>(
        null,
      );

    const locationRequestSequenceRef =
      useRef(0);

    const headingRequestSequenceRef =
      useRef(0);
    const headingWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [headingRetryKey, setHeadingRetryKey] = useState(0);

    const locationWatchdogRef =
      useRef<ReturnType<typeof setTimeout> | null>(
        null,
      );

    const latestLiveLocationRef =
      useRef<Location.LocationObject | null>(
        null,
      );

    const preciseLocationGrantedRef =
      useRef<boolean | null>(
        null,
      );

    const targetBearingRef =
      useRef<number | null>(
        null,
      );

    const latestHeadingRef =
      useRef<number | null>(
        null,
      );

    const lastHeadingStateUpdateRef =
      useRef(0);

    const lastShakeTimeRef =
      useRef(0);

    const excavationLockRef =
      useRef(false);

    const continuousTargetRotationRef =
      useRef(0);

    const continuousCardRotationRef =
      useRef(0);

    const targetRotationAnim =
      useRef(
        new Animated.Value(
          0,
        ),
      ).current;

    const compassCardRotationAnim =
      useRef(
        new Animated.Value(
          0,
        ),
      ).current;

    /* ---------------------------------------------------------------------- */
    /* Derived treasure state                                                 */
    /* ---------------------------------------------------------------------- */

    const targetLocation =
      useMemo<
        LatLng | null
      >(
        () => {
          if (
            !treasure
              ?.location ||
            !isValidCoordinate(
              treasure.location
                .latitude,
              treasure.location
                .longitude,
            )
          ) {
            return null;
          }

          return {
            latitude:
              treasure.location
                .latitude,

            longitude:
              treasure.location
                .longitude,
          };
        },
        [
          treasure?.location?.latitude,
          treasure?.location?.longitude,
        ],
      );

    const isArchived =
      treasure
        ?.isArchived ===
      true;

    const isOwnTreasure =
      Boolean(
        currentUserId &&
          treasure?.creatorId ===
            currentUserId,
      );

    const isLoading =
      treasureLoading ||
      profileLoading ||
      discoveryLoading;

    const blockingError =
      useMemo(
        () => {
          if (
            !targetTreasureId
          ) {
            return 'Treasure target unavailable. No target ID was supplied.';
          }

          if (
            !currentUserId
          ) {
            return 'Your Explorer session has expired. Sign in again before starting a hunt.';
          }

          return (
            treasureError ||
            profileError ||
            discoveryError
          );
        },
        [
          currentUserId,
          discoveryError,
          profileError,
          targetTreasureId,
          treasureError,
        ],
      );

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

        headingRequestSequenceRef.current +=
          1;

        try { locationSubscriptionRef.current?.remove(); } catch {}
        try { headingSubscriptionRef.current?.remove(); } catch {}

        locationSubscriptionRef.current =
          null;

        headingSubscriptionRef.current =
          null;

        if (
          locationWatchdogRef.current
        ) {
          clearTimeout(
            locationWatchdogRef.current,
          );

          locationWatchdogRef.current =
            null;
        }
        if (headingWatchdogRef.current) clearTimeout(headingWatchdogRef.current);

        targetRotationAnim.stopAnimation();
        compassCardRotationAnim.stopAnimation();
      };
    }, [
      compassCardRotationAnim,
      targetRotationAnim,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Target reset                                                           */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      setTreasure(null);
      setUserProfile(null);
      setIsExcavated(false);
      setIsSubmitting(false);
      setImageModalVisible(false);
      setImageLoadFailed(false);
      setIsRefreshingLocation(false);
      setTreasureError(null);
      setProfileError(null);
      setDiscoveryError(null);
      setTreasureLoading(Boolean(targetTreasureId && currentUserId));
      setProfileLoading(Boolean(targetTreasureId && currentUserId));
      setDiscoveryLoading(Boolean(targetTreasureId && currentUserId));
      latestLiveLocationRef.current =
        null;

      targetBearingRef.current =
        null;

      latestHeadingRef.current =
        null;

      preciseLocationGrantedRef.current =
        null;

      excavationLockRef.current =
        false;

      continuousTargetRotationRef.current =
        0;

      continuousCardRotationRef.current =
        0;

      targetRotationAnim.setValue(
        0,
      );

      compassCardRotationAnim.setValue(
        0,
      );

      setDistance(
        null,
      );

      setTargetBearing(
        null,
      );

      setGpsAccuracy(
        null,
      );

      setGpsStatus(
        'INITIALISING',
      );

      setLocationFixSource(
        'none',
      );

      setLatestLocationTimestamp(
        null,
      );

      setLocationErrorMessage(
        null,
      );

      setIsMockedLocation(
        false,
      );

      setDeviceHeading(
        null,
      );

      setHeadingAccuracy(
        null,
      );

      setHeadingReference(
        null,
      );

      setCompassStatus(
        Platform.OS ===
          'web'
          ? 'UNAVAILABLE'
          : 'CHECKING',
      );
    }, [
      compassCardRotationAnim,
      targetRotationAnim,
      targetTreasureId,
      currentUserId,
    ]);

    /* ---------------------------------------------------------------------- */
    /* App state                                                              */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      const subscription =
        AppState.addEventListener(
          'change',
          (
            nextState:
              AppStateStatus,
          ) => {
            interactionActiveRef.current = nextState === 'active';
            setInteractionIsActive(nextState === 'active');
            // iOS permission sheets are inactive, rather than backgrounded.
            // Keep permission requests alive while suspending excavation input.
            if (nextState === 'background') {
              latestLiveLocationRef.current = null;
              locationRequestSequenceRef.current += 1;
              headingRequestSequenceRef.current += 1;
              setAppIsActive(false);
              setLatestLocationTimestamp(null);
            } else if (nextState === 'active') setAppIsActive(true);
          },
        );

      return () => {
        subscription.remove();
      };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Location freshness clock                                               */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      const interval =
        setInterval(
          () => {
            setFreshnessClock(
              Date.now(),
            );
          },
          LOCATION_FRESHNESS_TICK_MS,
        );

      return () => {
        clearInterval(
          interval,
        );
      };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Reduce Motion                                                          */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      let mounted =
        true;

      AccessibilityInfo
        .isReduceMotionEnabled()
        .then(
          (
            enabled,
          ) => {
            if (
              mounted
            ) {
              setReduceMotionEnabled(
                enabled,
              );
            }
          },
        )
        .catch(() => {
          // Static behaviour remains usable if the preference is unavailable.
        });

      const subscription =
        AccessibilityInfo.addEventListener(
          'reduceMotionChanged',
          setReduceMotionEnabled,
        );

      return () => {
        mounted =
          false;

        subscription.remove();
      };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Back navigation                                                        */
    /* ---------------------------------------------------------------------- */

    const handleBackNavigation =
      useCallback(
        (): void => {
          if (
            onBack
          ) {
            onBack();

            return;
          }

          if (
            navigation
              ?.canGoBack()
          ) {
            navigation.goBack();
          }
        },
        [
          navigation,
          onBack,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Firestore subscriptions                                                */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      let active = true;
      if (
        !targetTreasureId ||
        !currentUserId
      ) {
        setTreasureLoading(
          false,
        );

        setProfileLoading(
          false,
        );

        setDiscoveryLoading(
          false,
        );

        return;
      }

      setTreasureLoading(
        true,
      );

      setProfileLoading(
        true,
      );

      setDiscoveryLoading(
        true,
      );

      setTreasureError(
        null,
      );

      setProfileError(
        null,
      );

      setDiscoveryError(
        null,
      );

      const treasureReference =
        doc(
          db,
          'treasures',
          targetTreasureId,
        );

      const userReference =
        doc(
          db,
          'users',
          currentUserId,
        );

      const discoveryReference =
        doc(
          db,
          'discoveries',
          `${currentUserId}_${targetTreasureId}`,
        );

      const unsubscribeTreasure =
        onSnapshot(
          treasureReference,

          (
            snapshot,
          ) => {
            if (!active || huntContextRef.current !== currentHuntContext) return;
            setTreasureLoading(
              false,
            );

            if (
              !snapshot.exists()
            ) {
              setTreasure(
                null,
              );

              setTreasureError(
                'This treasure cache no longer exists or is unavailable.',
              );

              return;
            }

            const nextTreasure = readDashboardTreasure(targetTreasureId, snapshot.data());
            if (!nextTreasure) {
              setTreasure(null);
              setTreasureError('The selected treasure contains invalid field coordinates.');
              return;
            }

            setTreasure(
              nextTreasure,
            );

            setTreasureError(
              null,
            );
          },

          (
            error,
          ) => {
            if (!active || huntContextRef.current !== currentHuntContext) return;
            logDevelopmentWarning(
              '[Treasi Hunt] Treasure subscription failed:',
              error,
            );

            setTreasureLoading(
              false,
            );

            setTreasureError(
              'Treasi could not synchronise the selected treasure. Check your connection and try again.',
            );
          },
        );

      const unsubscribeProfile =
        onSnapshot(
          userReference,

          (
            snapshot,
          ) => {
            if (!active || huntContextRef.current !== currentHuntContext) return;
            setProfileLoading(
              false,
            );

            if (
              !snapshot.exists()
            ) {
              setUserProfile(
                null,
              );

              setProfileError(
                'Your Explorer profile is unavailable. Sign out and sign in again before continuing.',
              );

              return;
            }

            setUserProfile(
              readDashboardProfile(snapshot.data()),
            );

            setProfileError(
              null,
            );
          },

          (
            error,
          ) => {
            if (!active || huntContextRef.current !== currentHuntContext) return;
            logDevelopmentWarning(
              '[Treasi Hunt] Profile subscription failed:',
              error,
            );

            setProfileLoading(
              false,
            );

            setProfileError(
              'Treasi could not synchronise your Explorer profile.',
            );
          },
        );

      const unsubscribeDiscovery =
        onSnapshot(
          discoveryReference,

          (
            snapshot,
          ) => {
            if (!active || huntContextRef.current !== currentHuntContext) return;
            setDiscoveryLoading(
              false,
            );

            setIsExcavated(
              snapshot.exists(),
            );

            setDiscoveryError(
              null,
            );
          },

          (
            error,
          ) => {
            if (!active || huntContextRef.current !== currentHuntContext) return;
            logDevelopmentWarning(
              '[Treasi Hunt] Discovery subscription failed:',
              error,
            );

            /*
             * Fail closed. A discovery cannot be awarded while existing
             * discovery history cannot be verified.
             */
            setIsExcavated(
              false,
            );

            setDiscoveryLoading(
              false,
            );

            setDiscoveryError(
              'Treasi could not verify your discovery history for this treasure.',
            );
          },
        );

      return () => {
        active = false;
        unsubscribeTreasure();
        unsubscribeProfile();
        unsubscribeDiscovery();
      };
    }, [
      currentUserId,
      currentHuntContext,
      firestoreRetryKey,
      targetTreasureId,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Retry Firestore                                                        */
    /* ---------------------------------------------------------------------- */

    const handleRetryFirestore =
      useCallback(
        (): void => {
          setTreasureError(
            null,
          );

          setProfileError(
            null,
          );

          setDiscoveryError(
            null,
          );

          setTreasureLoading(
            true,
          );

          setProfileLoading(
            true,
          );

          setDiscoveryLoading(
            true,
          );

          setFirestoreRetryKey(
            (
              current,
            ) =>
              current +
              1,
          );

          announce(
            'Retrying Hunt synchronisation.',
          );
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Animation helpers                                                      */
    /* ---------------------------------------------------------------------- */

    const animateContinuousAngle =
      useCallback(
        (
          animation:
            Animated.Value,
          currentContinuous:
            number,
          desiredDegrees:
            number,
        ): number => {
          const nextContinuous =
            currentContinuous +
            shortestAngleDelta(
              normaliseDegrees(
                currentContinuous,
              ),
              normaliseDegrees(
                desiredDegrees,
              ),
            );

          animation.stopAnimation();

          if (
            reduceMotionEnabled
          ) {
            animation.setValue(
              nextContinuous,
            );

            return nextContinuous;
          }

          Animated.spring(
            animation,
            {
              toValue:
                nextContinuous,

              damping: 18,
              stiffness: 110,
              mass: 0.75,

              useNativeDriver:
                true,
            },
          ).start();

          return nextContinuous;
        },
        [
          reduceMotionEnabled,
        ],
      );

    // Updates both the rotating compass card and target needle.
    const applyHeadingToCompass =
      useCallback(
        (
          headingDegrees:
            number,
          bearingDegrees:
            number | null,
        ): void => {
          continuousCardRotationRef.current =
            animateContinuousAngle(
              compassCardRotationAnim,
              continuousCardRotationRef.current,
              -headingDegrees,
            );

          if (
            bearingDegrees ===
            null
          ) {
            return;
          }

          continuousTargetRotationRef.current =
            animateContinuousAngle(
              targetRotationAnim,
              continuousTargetRotationRef.current,
              bearingDegrees -
                headingDegrees,
            );
        },
        [
          animateContinuousAngle,
          compassCardRotationAnim,
          targetRotationAnim,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Subscription cleanup                                                   */
    /* ---------------------------------------------------------------------- */

    const clearLocationWatchdog =
      useCallback(
        (): void => {
          if (
            locationWatchdogRef.current
          ) {
            clearTimeout(
              locationWatchdogRef.current,
            );

            locationWatchdogRef.current =
              null;
          }
        },
        [],
      );

    const removeLocationSubscription =
      useCallback(
        (): void => {
          try {
            locationSubscriptionRef.current?.remove();
          } catch {
            // The watcher may already be removed.
          }

          locationSubscriptionRef.current =
            null;

          clearLocationWatchdog();
        },
        [
          clearLocationWatchdog,
        ],
      );

    const removeHeadingSubscription =
      useCallback(
        (): void => {
          if (headingWatchdogRef.current) clearTimeout(headingWatchdogRef.current);
          headingWatchdogRef.current = null;
          try {
            headingSubscriptionRef.current?.remove();
          } catch {
            // The heading watcher may already be removed.
          }

          headingSubscriptionRef.current =
            null;
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Location application                                                   */
    /* ---------------------------------------------------------------------- */

    const applyLocation =
      useCallback(
        (
          location:
            Location.LocationObject,
          source:
            LocationFixSource,
        ): void => {
          if (
            !isMountedRef.current ||
            !targetLocation
          ) {
            return;
          }

          if (source === 'cached' && latestLiveLocationRef.current) return;
          if (!Number.isFinite(location.timestamp) || location.timestamp > Date.now() + 1_000 ||
              (source === 'live' && !isFreshHuntFix(location))) return;

          const {
            latitude,
            longitude,
            accuracy,
          } =
            location.coords;

          if (
            !isValidCoordinate(
              latitude,
              longitude,
            )
          ) {
            if (
              source ===
              'live'
            ) {
              setGpsStatus(
                'ERROR',
              );

              setLocationErrorMessage(
                'The device returned invalid geographic coordinates.',
              );
            }

            return;
          }

          /*
           * Ignore an older live fix if a newer one has already arrived from
           * the foreground watcher.
           */
          if (
            source ===
              'live' &&
            latestLiveLocationRef.current &&
            location.timestamp <
              latestLiveLocationRef.current
                .timestamp
          ) {
            return;
          }

          const nextAccuracy =
            isValidAccuracy(
              accuracy,
            )
              ? accuracy
              : null;

          const nextDistance =
            getDistanceInMetres(
              latitude,
              longitude,
              targetLocation.latitude,
              targetLocation.longitude,
            );

          const nextBearing =
            getBearingInDegrees(
              latitude,
              longitude,
              targetLocation.latitude,
              targetLocation.longitude,
            );

          setDistance(
            nextDistance,
          );

          setTargetBearing(
            nextBearing,
          );

          targetBearingRef.current =
            nextBearing;

          setGpsAccuracy(
            nextAccuracy,
          );

          if (
            latestHeadingRef.current !==
            null
          ) {
            applyHeadingToCompass(
              latestHeadingRef.current,
              nextBearing,
            );
          }

          if (
            source ===
            'cached'
          ) {
            /*
             * Cached coordinates are useful for orientation but may never
             * authorise excavation.
             */
            if (
              latestLiveLocationRef.current ===
              null
            ) {
              setLocationFixSource(
                'cached',
              );
            }

            return;
          }

          latestLiveLocationRef.current =
            location;

          setLatestLocationTimestamp(
            location.timestamp,
          );

          setLocationFixSource(
            'live',
          );

          setLocationErrorMessage(
            null,
          );

          clearLocationWatchdog();

          const mocked =
            Platform.OS ===
              'android' &&
            location.mocked ===
              true;

          setIsMockedLocation(
            mocked,
          );

          if (
            mocked
          ) {
            setGpsStatus(
              'MOCKED_LOCATION',
            );

            return;
          }

          if (
            preciseLocationGrantedRef.current ===
            false
          ) {
            setGpsStatus(
              'PRECISION_REQUIRED',
            );

            return;
          }

          if (
            nextAccuracy ===
              null ||
            nextAccuracy >
              MAX_ACCEPTABLE_GPS_ACCURACY_METRES
          ) {
            setGpsStatus(
              'LOW_ACCURACY',
            );

            return;
          }

          setGpsStatus(
            'OK',
          );
        },
        [
          applyHeadingToCompass,
          clearLocationWatchdog,
          targetLocation,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Location tracking                                                      */
    /* ---------------------------------------------------------------------- */

    const startLocationTracking =
      useCallback(
        async (
          requestPermission:
            boolean,
        ): Promise<void> => {
          if (
            !targetLocation ||
            isArchived ||
            isExcavated
          ) {
            removeLocationSubscription();

            return;
          }

          const requestSequence =
            ++locationRequestSequenceRef.current;

          removeLocationSubscription();

          latestLiveLocationRef.current =
            null;

          setLatestLocationTimestamp(
            null,
          );

          setLocationFixSource(
            'none',
          );

          setGpsStatus(
            'INITIALISING',
          );

          setLocationErrorMessage(
            null,
          );

          setIsMockedLocation(
            false,
          );

          setIsRefreshingLocation(
            true,
          );

          try {
            let permission =
              await withHuntTimeout(Location.getForegroundPermissionsAsync(), 8_000);

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
              const nextStatus =
                permission.status ===
                  Location
                    .PermissionStatus
                    .UNDETERMINED
                  ? 'PERMISSION_REQUIRED'
                  : 'DENIED';

              setPreciseLocationGranted(
                null,
              );

              preciseLocationGrantedRef.current =
                null;

              setGpsStatus(
                nextStatus,
              );

              setGpsAccuracy(
                null,
              );

              setLocationErrorMessage(
                nextStatus ===
                  'PERMISSION_REQUIRED'
                  ? 'Foreground location access has not been enabled for Hunt.'
                  : 'Foreground location access is denied for Treasi.',
              );

              return;
            }

            const precisePermission =
              getPreciseLocationPermission(
                permission,
              );

            preciseLocationGrantedRef.current =
              precisePermission;

            setPreciseLocationGranted(
              precisePermission,
            );

            const servicesEnabled =
              await withHuntTimeout(Location.hasServicesEnabledAsync(), 8_000);

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
              setGpsStatus(
                'SERVICES_OFF',
              );

              setLocationErrorMessage(
                'Device location services are switched off.',
              );

              return;
            }

            void withHuntTimeout(Location.getLastKnownPositionAsync({
              maxAge: CACHED_LOCATION_MAX_AGE_MS,
              requiredAccuracy: CACHED_LOCATION_REQUIRED_ACCURACY_METRES,
            }), 2_000).then(cachedPosition => {
              if (cachedPosition && isMountedRef.current && requestSequence === locationRequestSequenceRef.current) {
                applyLocation(cachedPosition, 'cached');
              }
            }).catch(() => {});

            const locationOptions:
              Location.LocationOptions =
              {
                accuracy:
                  Platform.OS ===
                    'web'
                    ? Location
                        .Accuracy
                        .High
                    : Location
                        .Accuracy
                        .BestForNavigation,

                distanceInterval:
                  LOCATION_DISTANCE_INTERVAL_METRES,

                /*
                 * timeInterval is Android-only and ignored by iOS/web.
                 */
                timeInterval:
                  LOCATION_UPDATE_INTERVAL_MS,

                /*
                 * Do not trigger Android's improved-accuracy prompt while
                 * entering Hunt automatically. Recovery is user initiated.
                 */
                mayShowUserSettingsDialog:
                  requestPermission,
              };

            let registrationExpired = false;
            const registration = Location.watchPositionAsync(
                  locationOptions,

                  (
                    location,
                  ) => {
                    if (!isMountedRef.current || requestSequence !== locationRequestSequenceRef.current) return;
                    applyLocation(
                      location,
                      'live',
                    );
                  },

                  (
                    message,
                  ) => {
                    if (
                      !isMountedRef.current ||
                      requestSequence !==
                        locationRequestSequenceRef.current
                    ) {
                      return;
                    }

                    logDevelopmentWarning(
                      '[Treasi Hunt] Location watcher error:',
                      message,
                    );

                    latestLiveLocationRef.current =
                      null;

                    setLatestLocationTimestamp(
                      null,
                    );

                    setGpsStatus(
                      'ERROR',
                    );

                    setLocationErrorMessage(
                      'Live location updates were interrupted.',
                    );
                  },
                ).then(subscription => {
                  if (registrationExpired || !isMountedRef.current || requestSequence !== locationRequestSequenceRef.current) subscription.remove();
                  return subscription;
                });
            let subscription: Location.LocationSubscription;
            try {
              subscription = await withHuntTimeout(registration, 10_000);
            } catch (error) {
              registrationExpired = true;
              throw error;
            }


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

            /*
             * A one-shot high-accuracy request runs alongside the watcher.
             * Hunt does not block waiting for it because some indoor GPS fixes
             * take a long time.
             */
            void Location
              .getCurrentPositionAsync(
                {
                  accuracy:
                    Platform.OS ===
                      'web'
                      ? Location
                          .Accuracy
                          .High
                      : Location
                          .Accuracy
                          .BestForNavigation,

                  mayShowUserSettingsDialog:
                    requestPermission,
                },
              )
              .then(
                (
                  currentPosition,
                ) => {
                  if (
                    requestSequence ===
                      locationRequestSequenceRef.current &&
                    isMountedRef.current
                  ) {
                    applyLocation(
                      currentPosition,
                      'live',
                    );
                  }
                },
              )
              .catch(
                (
                  error:
                    unknown,
                ) => {
                  logDevelopmentWarning(
                    '[Treasi Hunt] One-shot location fix unavailable:',
                    error,
                  );
                },
              );

            clearLocationWatchdog();

            locationWatchdogRef.current =
              setTimeout(
                () => {
                  if (
                    !isMountedRef.current ||
                    requestSequence !==
                      locationRequestSequenceRef.current ||
                    latestLiveLocationRef.current
                  ) {
                    return;
                  }

                  setGpsStatus(
                    'ERROR',
                  );

                  setLocationErrorMessage(
                    'Treasi has not received a fresh live position. Move to an area with a clearer view of the sky, then retry.',
                  );
                },
                LOCATION_ACQUISITION_TIMEOUT_MS,
              );
          } catch (
            error: unknown
          ) {
            logDevelopmentWarning(
              '[Treasi Hunt] Location tracking failed:',
              error,
            );

            if (
              requestSequence !==
                locationRequestSequenceRef.current ||
              !isMountedRef.current
            ) {
              return;
            }

            latestLiveLocationRef.current =
              null;

            setLatestLocationTimestamp(
              null,
            );

            locationRequestSequenceRef.current += 1;
            removeLocationSubscription();
            setIsRefreshingLocation(false);
            setGpsStatus(
              'ERROR',
            );

            setLocationErrorMessage(
              Platform.OS ===
                'web'
                ? 'Browser location is unavailable. Hunt requires HTTPS or localhost and browser location permission.'
                : 'Treasi could not start device location tracking.',
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
          applyLocation,
          clearLocationWatchdog,
          currentHuntContext,
          isArchived,
          isExcavated,
          removeLocationSubscription,
          targetLocation,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Location lifecycle                                                     */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        !appIsActive ||
        !targetLocation ||
        isArchived ||
        isExcavated
      ) {
        locationRequestSequenceRef.current +=
          1;

        removeLocationSubscription();

        latestLiveLocationRef.current =
          null;

        setLatestLocationTimestamp(
          null,
        );

        return;
      }

      /*
       * Existing permission is used immediately.
       * A new system permission prompt requires an explicit button press.
       */
      void startLocationTracking(
        false,
      );

      return () => {
        locationRequestSequenceRef.current +=
          1;

        removeLocationSubscription();
      };
    }, [
      appIsActive,
      isArchived,
      isExcavated,
      removeLocationSubscription,
      startLocationTracking,
      targetLocation,
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
          setHeadingRetryKey(value => value + 1);

          const deniedPermanently =
            locationPermissionStatus ===
              Location
                .PermissionStatus
                .DENIED &&
            !canAskLocationAgain;

          const needsSystemSettings =
            preciseLocationGranted ===
              false ||
            locationServicesEnabled ===
              false ||
            deniedPermanently;

          if (
            Platform.OS !==
              'web' &&
            needsSystemSettings
          ) {
            try {
              await Linking
                .openSettings();
            } catch (
              error: unknown
            ) {
              logDevelopmentWarning(
                '[Treasi Hunt] Unable to open settings:',
                error,
              );

              showAccessibleAlert(
                'Settings Unavailable',
                'Open your device settings manually and enable precise foreground location access for Treasi.',
              );
            }

            return;
          }

          if (
            Platform.OS ===
              'web' &&
            deniedPermanently
          ) {
            showAccessibleAlert(
              'Browser Location Blocked',
              'Allow location for this site in your browser settings, then return to Treasi and retry.',
            );

            return;
          }

          /*
           * Android can explicitly request improved network/GPS accuracy after
           * the Explorer presses the recovery action.
           */
          if (
            Platform.OS ===
              'android' &&
            gpsStatus ===
              'LOW_ACCURACY'
          ) {
            try {
              await Location
                .enableNetworkProviderAsync();
            } catch (
              error: unknown
            ) {
              logDevelopmentWarning(
                '[Treasi Hunt] Improved Android location mode was not enabled:',
                error,
              );
            }

            await startLocationTracking(
              false,
            );

            return;
          }

          await startLocationTracking(
            true,
          );
        },
        [
          canAskLocationAgain,
          gpsStatus,
          isRefreshingLocation,
          locationPermissionStatus,
          locationServicesEnabled,
          preciseLocationGranted,
          startLocationTracking,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Native heading tracking                                                */
    /* ---------------------------------------------------------------------- */

    const startHeadingTracking =
      useCallback(
        async (): Promise<void> => {
          if (
            Platform.OS ===
              'web'
          ) {
            setCompassStatus(
              'UNAVAILABLE',
            );

            return;
          }

          const requestSequence =
            ++headingRequestSequenceRef.current;

          removeHeadingSubscription();

          setCompassStatus(
            'CHECKING',
          );
          headingWatchdogRef.current = setTimeout(() => {
            if (isMountedRef.current && requestSequence === headingRequestSequenceRef.current) setCompassStatus('UNAVAILABLE');
          }, 8_000);

          try {
            let registrationExpired = false;
            const registration = Location.watchHeadingAsync(
                  (
                    heading,
                  ) => {
                    if (
                      !isMountedRef.current ||
                      requestSequence !==
                        headingRequestSequenceRef.current
                    ) {
                      return;
                    }

                    const useTrueHeading =
                      Number.isFinite(
                        heading.trueHeading,
                      ) &&
                      heading.trueHeading >=
                        0;

                    const selectedHeading =
                      useTrueHeading
                        ? heading.trueHeading
                        : heading.magHeading;

                    if (
                      !Number.isFinite(
                        selectedHeading,
                      ) || selectedHeading < 0 || selectedHeading > 360
                    ) {
                      return;
                    }

                    const normalisedHeading =
                      normaliseDegrees(
                        selectedHeading + headingOrientationOffset,
                      );

                    latestHeadingRef.current =
                      normalisedHeading;
                    if (headingWatchdogRef.current) clearTimeout(headingWatchdogRef.current);
                    headingWatchdogRef.current = setTimeout(() => {
                      if (!isMountedRef.current || requestSequence !== headingRequestSequenceRef.current) return;
                      latestHeadingRef.current = null;
                      setDeviceHeading(null);
                      setHeadingReference(null);
                      setCompassStatus('UNAVAILABLE');
                      applyHeadingToCompass(0, targetBearingRef.current);
                    }, 8_000);

                    setHeadingReference(
                      useTrueHeading
                        ? 'true'
                        : 'magnetic',
                    );

                    setHeadingAccuracy(
                      heading.accuracy,
                    );

                    setCompassStatus(
                      !Number.isFinite(heading.accuracy) || heading.accuracy < 2 || heading.accuracy > 3
                        ? 'LOW_ACCURACY'
                        : 'READY',
                    );

                    const now =
                      Date.now();

                    if (
                      now -
                        lastHeadingStateUpdateRef.current >=
                      HEADING_STATE_UPDATE_INTERVAL_MS
                    ) {
                      lastHeadingStateUpdateRef.current =
                        now;

                      setDeviceHeading(
                        normalisedHeading,
                      );
                    }

                    applyHeadingToCompass(
                      normalisedHeading,
                      targetBearingRef.current,
                    );
                  },

                  (
                    message,
                  ) => {
                    if (
                      !isMountedRef.current ||
                      requestSequence !==
                        headingRequestSequenceRef.current
                    ) {
                      return;
                    }

                    logDevelopmentWarning(
                      '[Treasi Hunt] Heading watcher error:',
                      message,
                    );

                    setCompassStatus(
                      'ERROR',
                    );
                    latestHeadingRef.current = null;
                    setDeviceHeading(null);
                    setHeadingReference(null);
                    applyHeadingToCompass(0, targetBearingRef.current);
                  },
                ).then(subscription => {
                  if (registrationExpired || !isMountedRef.current || requestSequence !== headingRequestSequenceRef.current) subscription.remove();
                  return subscription;
                });
            let subscription: Location.LocationSubscription;
            try { subscription = await withHuntTimeout(registration, 8_000); }
            catch (error) { registrationExpired = true; throw error; }


            if (
              !isMountedRef.current ||
              requestSequence !==
                headingRequestSequenceRef.current
            ) {
              subscription.remove();

              return;
            }

            headingSubscriptionRef.current =
              subscription;
          } catch (
            error: unknown
          ) {
            logDevelopmentWarning(
              '[Treasi Hunt] Compass heading unavailable:',
              error,
            );

            if (
              isMountedRef.current &&
              requestSequence ===
                headingRequestSequenceRef.current
            ) {
              setCompassStatus(
                'UNAVAILABLE',
              );
              headingRequestSequenceRef.current += 1;
              removeHeadingSubscription();
              latestHeadingRef.current = null;
              setDeviceHeading(null);
              setHeadingReference(null);
              applyHeadingToCompass(0, targetBearingRef.current);
            }
          }
        },
        [
          applyHeadingToCompass,
          currentHuntContext,
          headingOrientationOffset,
          removeHeadingSubscription,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Heading lifecycle                                                      */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (Platform.OS === 'ios' && (interfaceOrientation === null || interfaceOrientation === ScreenOrientation.Orientation.UNKNOWN)) {
        headingRequestSequenceRef.current += 1;
        removeHeadingSubscription();
        latestHeadingRef.current = null;
        setDeviceHeading(null);
        setCompassStatus('UNAVAILABLE');
        return;
      }
      if (
        Platform.OS ===
          'web'
      ) {
        setCompassStatus(
          'UNAVAILABLE',
        );

        return;
      }

      if (
        !appIsActive ||
        !targetLocation ||
        isArchived ||
        isExcavated ||
        locationPermissionStatus !==
          Location
            .PermissionStatus
            .GRANTED
      ) {
        headingRequestSequenceRef.current +=
          1;

        removeHeadingSubscription();

        return;
      }

      void startHeadingTracking();

      return () => {
        headingRequestSequenceRef.current +=
          1;

        removeHeadingSubscription();
      };
    }, [
      appIsActive,
      isArchived,
      isExcavated,
      locationPermissionStatus,
      removeHeadingSubscription,
      startHeadingTracking,
      targetLocation,
      headingRetryKey,
      interfaceOrientation,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Target bearing changes                                                 */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        latestHeadingRef.current !==
          null
      ) {
        applyHeadingToCompass(
          latestHeadingRef.current,
          targetBearing,
        );
      }
    }, [
      applyHeadingToCompass,
      targetBearing,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Accelerometer availability                                             */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      let cancelled =
        false;

      const initialiseMotion =
        async (): Promise<void> => {
          try {
            const permission =
              await Accelerometer
                .getPermissionsAsync();

            if (
              cancelled ||
              !isMountedRef.current
            ) {
              return;
            }

            const status =
              permission.status as
                SensorPermissionState;

            setMotionPermissionStatus(
              status,
            );

            if (
              permission.status !==
              'granted'
            ) {
              setAccelerometerAvailable(
                false,
              );

              return;
            }

            const available =
              await Accelerometer
                .isAvailableAsync();

            if (
              !cancelled &&
              isMountedRef.current
            ) {
              setAccelerometerAvailable(
                available,
              );
            }
          } catch (
            error: unknown
          ) {
            logDevelopmentWarning(
              '[Treasi Hunt] Accelerometer check failed:',
              error,
            );

            if (
              !cancelled &&
              isMountedRef.current
            ) {
              setAccelerometerAvailable(
                false,
              );

              setMotionPermissionStatus(
                'unknown',
              );
            }
          }
        };

      void initialiseMotion();

      return () => {
        cancelled =
          true;
      };
    }, [appIsActive]);

    /* ---------------------------------------------------------------------- */
    /* Enable optional shake control                                          */
    /* ---------------------------------------------------------------------- */

    const handleEnableShake =
      useCallback(
        async (): Promise<void> => {
          if (
            isRequestingMotionPermission || motionRequestRef.current
          ) {
            return;
          }

          setIsRequestingMotionPermission(
            true,
          );
          motionRequestRef.current = true;

          try {
            const permission =
              await Accelerometer
                .requestPermissionsAsync();
            if (!isMountedRef.current) return;

            const status =
              permission.status as
                SensorPermissionState;

            setMotionPermissionStatus(
              status,
            );

            if (
              permission.status !==
              'granted'
            ) {
              setAccelerometerAvailable(
                false,
              );

              showAccessibleAlert(
                'Motion Access Unavailable',
                'Shake excavation remains optional. You can still use the on-screen excavation control.',
              );

              return;
            }

            const available =
              await Accelerometer
                .isAvailableAsync();
            if (!isMountedRef.current) return;

            setAccelerometerAvailable(
              available,
            );

            if (
              available
            ) {
              announce(
                'Shake excavation enabled.',
              );
            } else {
              showAccessibleAlert(
                'Motion Sensor Unavailable',
                'This device does not provide usable accelerometer data. Use the on-screen excavation control instead.',
              );
            }
          } catch (
            error: unknown
          ) {
            if (!isMountedRef.current) return;
            logDevelopmentWarning(
              '[Treasi Hunt] Motion permission request failed:',
              error,
            );

            showAccessibleAlert(
              'Motion Access Unavailable',
              'Shake excavation could not be enabled. The on-screen excavation control still works.',
            );
          } finally {
            motionRequestRef.current = false;
            if (
              isMountedRef.current
            ) {
              setIsRequestingMotionPermission(
                false,
              );
            }
          }
        },
        [
          isRequestingMotionPermission,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Fresh fix state                                                        */
    /* ---------------------------------------------------------------------- */

    const isLiveFixFresh =
      locationFixSource ===
        'live' &&
      latestLocationTimestamp !==
        null &&
      Number.isFinite(latestLocationTimestamp) &&
      latestLocationTimestamp <= Date.now() + 1_000 &&
      Math.max(freshnessClock, Date.now()) -
        latestLocationTimestamp <=
        MAX_LOCATION_AGE_MS;

    /* ---------------------------------------------------------------------- */
    /* Excavation eligibility                                                 */
    /* ---------------------------------------------------------------------- */

    const canExcavate =
      interactionIsActive && !isLoading && !blockingError &&
      !isOwnTreasure &&
      !isArchived &&
      !isExcavated &&
      !isSubmitting &&
      !excavationLockRef.current &&
      !isMockedLocation &&
      gpsStatus ===
        'OK' &&
      isLiveFixFresh &&
      distance !==
        null &&
      distance <=
        DISCOVERY_RADIUS_METRES;

    const excavationStatusText =
      useMemo(
        () => {
          if (
            isExcavated
          ) {
            return isArchived
              ? 'This discovery is recorded and the cache has since been archived.'
              : 'Excavation recorded. The secret payload is unlocked.';
          }

          if (
            isArchived
          ) {
            return 'This treasure has been archived and can no longer be excavated.';
          }

          if (
            isOwnTreasure
          ) {
            return 'You created this treasure. Explorers cannot award themselves discovery points for their own cache.';
          }

          if (
            isSubmitting
          ) {
            return 'Transmitting your verified excavation to the field log.';
          }

          if (
            locationFixSource ===
              'cached' &&
            gpsStatus ===
              'INITIALISING'
          ) {
            return 'A recent cached position is displayed while Treasi waits for a fresh live GPS fix.';
          }

          switch (
            gpsStatus
          ) {
            case 'INITIALISING':
              return 'Acquiring a fresh high-accuracy location.';

            case 'PERMISSION_REQUIRED':
              return 'Foreground location access is required before Treasi can verify an excavation.';

            case 'DENIED':
              return 'Location access is currently denied.';

            case 'PRECISION_REQUIRED':
              return Platform.OS ===
                'ios'
                ? 'Precise Location is disabled. Enable Precise Location for Treasi in iOS Settings before excavating.'
                : 'Treasi currently has approximate location access. Enable precise location permission before excavating.';

            case 'SERVICES_OFF':
              return 'Device location services are switched off.';

            case 'MOCKED_LOCATION':
              return 'Android reported a simulated location. Simulated locations cannot verify a discovery.';

            case 'ERROR':
              return (
                locationErrorMessage ||
                'Live location tracking is unavailable.'
              );

            case 'LOW_ACCURACY': {
              const accuracyText =
                gpsAccuracy !==
                null
                  ? ` Current horizontal accuracy is approximately ${Math.round(
                      gpsAccuracy,
                    )} metres.`
                  : '';

              return `The current location is not precise enough for excavation.${accuracyText}`;
            }

            case 'OK':
            default:
              break;
          }

          if (
            !isLiveFixFresh
          ) {
            return 'The last live position is too old. Wait for a fresh GPS update before excavating.';
          }

          if (
            distance ===
            null
          ) {
            return 'Waiting for Treasi to calculate the target distance.';
          }

          if (
            distance >
            DISCOVERY_RADIUS_METRES
          ) {
            return `Target is approximately ${Math.round(
              distance,
            )} metres away. Move within ${DISCOVERY_RADIUS_METRES} metres to excavate.`;
          }

          if (
            accelerometerAvailable ===
            true &&
            motionPermissionStatus ===
              'granted'
          ) {
            return 'Dig site verified. Shake the device or tap the excavation control to unlock the treasure.';
          }

          return 'Dig site verified. Tap the excavation control to unlock the treasure.';
        },
        [
          accelerometerAvailable,
          distance,
          gpsAccuracy,
          gpsStatus,
          isArchived,
          isExcavated,
          isLiveFixFresh,
          isOwnTreasure,
          isSubmitting,
          locationErrorMessage,
          locationFixSource,
          motionPermissionStatus,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Excavation transaction                                                 */
    /* ---------------------------------------------------------------------- */

    const executeExcavation =
      useCallback(
        async (): Promise<void> => {
          const operationContext = currentHuntContext;
          const isCurrentOperation = () => isMountedRef.current && huntContextRef.current === operationContext && auth.currentUser?.uid === operationContext.userId;
          if (!isCurrentOperation() || !interactionActiveRef.current || isLoading || blockingError) return;
          /*
           * The ref closes the short gap before React commits isSubmitting,
           * preventing a shake and tap from starting two transactions.
           */
          if (
            excavationLockRef.current ||
            isSubmitting ||
            isArchived ||
            isExcavated
          ) {
            return;
          }

          const user =
            auth.currentUser;

          if (!user) {
            showAccessibleAlert(
              'Session Expired',
              'Sign in again before recording this discovery.',
            );

            return;
          }

          if (
            !treasure ||
            !targetTreasureId ||
            !targetLocation
          ) {
            showAccessibleAlert(
              'Target Unavailable',
              'Treasi cannot verify the current treasure target.',
            );

            return;
          }

          if (
            treasure.creatorId ===
            user.uid
          ) {
            showAccessibleAlert(
              'Own Cache',
              'You cannot award yourself discovery points for a treasure you created.',
            );

            return;
          }

          if (
            gpsStatus ===
            'PERMISSION_REQUIRED' ||
            gpsStatus ===
            'DENIED'
          ) {
            showAccessibleAlert(
              'Location Permission Required',
              'Enable foreground location access before excavating this treasure.',
            );

            return;
          }

          if (
            gpsStatus ===
            'PRECISION_REQUIRED'
          ) {
            showAccessibleAlert(
              'Precise Location Required',
              'Treasi needs precise location access to verify a five-metre excavation radius.',
            );

            return;
          }

          if (
            gpsStatus ===
            'SERVICES_OFF'
          ) {
            showAccessibleAlert(
              'Location Services Off',
              'Enable device location services before excavating this treasure.',
            );

            return;
          }

          if (
            gpsStatus ===
            'MOCKED_LOCATION' ||
            isMockedLocation
          ) {
            showAccessibleAlert(
              'Simulated Location Detected',
              'Simulated Android locations cannot be used to record a discovery.',
            );

            return;
          }

          if (
            gpsStatus ===
              'LOW_ACCURACY' ||
            gpsStatus ===
              'ERROR' ||
            gpsStatus ===
              'INITIALISING'
          ) {
            showAccessibleAlert(
              'Location Not Ready',
              excavationStatusText,
            );

            return;
          }

          if (
            !isLiveFixFresh
          ) {
            showAccessibleAlert(
              'Fresh Location Required',
              'Wait for Treasi to receive a newer live GPS position before excavating.',
            );

            return;
          }

          const currentLocation =
            latestLiveLocationRef.current;

          if (
            !currentLocation
          ) {
            showAccessibleAlert(
              'Current Location Required',
              'A cached position cannot verify a discovery. Wait for a live location fix.',
            );

            return;
          }

          const locationAge =
            Math.max(
              0,
              Date.now() -
                currentLocation.timestamp,
            );

          if (
            !isFreshHuntFix(currentLocation) ||
            locationAge > MAX_LOCATION_AGE_MS
          ) {
            showAccessibleAlert(
              'Location Too Old',
              'Wait for Treasi to receive a newer live location fix before excavating.',
            );

            return;
          }

          if (
            Platform.OS ===
              'android' &&
            currentLocation.mocked ===
              true
          ) {
            showAccessibleAlert(
              'Simulated Location Detected',
              'This location cannot be used to verify a real-world discovery.',
            );

            return;
          }

          const {
            latitude,
            longitude,
            accuracy,
          } =
            currentLocation.coords;

          if (
            !isValidCoordinate(
              latitude,
              longitude,
            )
          ) {
            showAccessibleAlert(
              'Invalid Location',
              'The current coordinates could not be validated.',
            );

            return;
          }

          if (
            !isValidAccuracy(
              accuracy,
            ) ||
            accuracy >
              MAX_ACCEPTABLE_GPS_ACCURACY_METRES
          ) {
            showAccessibleAlert(
              'Location Accuracy Too Low',
              `Wait until horizontal accuracy improves to within ${MAX_ACCEPTABLE_GPS_ACCURACY_METRES} metres before excavating.`,
            );

            return;
          }

          const verifiedDistance =
            getDistanceInMetres(
              latitude,
              longitude,
              targetLocation.latitude,
              targetLocation.longitude,
            );

          if (
            verifiedDistance >
            DISCOVERY_RADIUS_METRES
          ) {
            showAccessibleAlert(
              'Out of Range',
              `The target is approximately ${Math.round(
                verifiedDistance,
              )} metres away. Move within ${DISCOVERY_RADIUS_METRES} metres to excavate.`,
            );

            return;
          }

          excavationLockRef.current =
            true;

          setIsSubmitting(
            true,
          );

          announce(
            'Excavation started. Transmitting discovery.',
          );

          try {
            const userId =
              user.uid;

            const discoveryId =
              `${userId}_${targetTreasureId}`;

            const discoveryReference =
              doc(
                db,
                'discoveries',
                discoveryId,
              );

            const userReference =
              doc(
                db,
                'users',
                userId,
              );

            const treasureReference =
              doc(
                db,
                'treasures',
                targetTreasureId,
              );

            const activityReference =
              doc(
                collection(
                  db,
                  'activity_feed',
                ),
              );

            const updatedPoints =
              await runTransaction(
                db,

                async (
                  transaction,
                ) => {
                  /*
                   * Firestore requires transaction reads before writes.
                   * Re-reading the treasure also blocks concurrent archiving.
                   */
                  const discoverySnapshot =
                    await transaction.get(
                      discoveryReference,
                    );

                  const userSnapshot =
                    await transaction.get(
                      userReference,
                    );

                  const treasureSnapshot =
                    await transaction.get(
                      treasureReference,
                    );
                  if (!isCurrentOperation() || !interactionActiveRef.current) throw new Error('HUNT_CANCELLED');

                  if (
                    discoverySnapshot.exists()
                  ) {
                    throw new Error(
                      'ALREADY_EXCAVATED',
                    );
                  }

                  if (
                    !userSnapshot.exists()
                  ) {
                    throw new Error(
                      'PROFILE_MISSING',
                    );
                  }

                  if (
                    !treasureSnapshot.exists()
                  ) {
                    throw new Error(
                      'TREASURE_MISSING',
                    );
                  }

                  const liveTreasure =
                    treasureSnapshot.data() as
                      TreasureDocument;

                  if (
                    liveTreasure.isArchived
                  ) {
                    throw new Error(
                      'TREASURE_ARCHIVED',
                    );
                  }

                  if (
                    liveTreasure.creatorId ===
                    userId
                  ) {
                    throw new Error(
                      'OWN_TREASURE',
                    );
                  }

                  if (
                    !liveTreasure
                      .location ||
                    !isValidCoordinate(
                      liveTreasure
                        .location
                        .latitude,
                      liveTreasure
                        .location
                        .longitude,
                    )
                  ) {
                    throw new Error(
                      'TREASURE_LOCATION_INVALID',
                    );
                  }

                  const currentPoints =
                    userSnapshot.data()
                      .totalPoints;

                  if (
                    typeof currentPoints !==
                      'number' ||
                    !Number.isSafeInteger(
                      currentPoints,
                    ) ||
                    currentPoints <
                      0
                  ) {
                    throw new Error(
                      'INVALID_PROFILE_POINTS',
                    );
                  }

                  const nextPoints =
                    currentPoints +
                    100;
                  if (!Number.isSafeInteger(nextPoints)) throw new Error('INVALID_PROFILE_POINTS');
                  const liveFix = latestLiveLocationRef.current;
                  if (!liveFix || !isFreshHuntFix(liveFix) || !isValidAccuracy(liveFix.coords.accuracy) ||
                      liveFix.coords.accuracy > MAX_ACCEPTABLE_GPS_ACCURACY_METRES ||
                      !isValidCoordinate(liveFix.coords.latitude, liveFix.coords.longitude) ||
                      (Platform.OS === 'android' && liveFix.mocked === true)) throw new Error('FRESH_LOCATION_REQUIRED');
                  if (getDistanceInMetres(liveFix.coords.latitude, liveFix.coords.longitude,
                    liveTreasure.location.latitude, liveTreasure.location.longitude) > DISCOVERY_RADIUS_METRES) {
                    throw new Error('TARGET_OUT_OF_RANGE');
                  }

                  const usernameSource =
                    String(
                      userSnapshot.data()
                        .username ||
                        user.displayName ||
                        'Explorer',
                    )
                      .trim()
                      .slice(
                        0,
                        100,
                      );

                  const username =
                    usernameSource ||
                    'Explorer';

                  const title =
                    String(
                      liveTreasure.title ||
                        'Treasure cache',
                    )
                      .trim()
                      .slice(
                        0,
                        80,
                      );

                  transaction.set(
                    discoveryReference,
                    {
                      discoveryId,

                      treasureId:
                        targetTreasureId,

                      hunterId:
                        userId,

                      unlockedAt:
                        serverTimestamp(),
                    },
                  );

                  transaction.update(
                    userReference,
                    {
                      totalPoints:
                        nextPoints,

                      updatedAt:
                        serverTimestamp(),
                    },
                  );

                  transaction.set(
                    activityReference,
                    {
                      activityId:
                        activityReference.id,

                      userId,

                      username,

                      type:
                        'TREASURE_FOUND',

                      message:
                        `Excavated "${title}"`,

                      targetId:
                        targetTreasureId,

                      createdAt:
                        serverTimestamp(),
                    },
                  );

                  return nextPoints;
                },
              );

            if (
              !isCurrentOperation()
            ) {
              return;
            }

            setUserProfile(
              (
                previous,
              ) =>
                previous
                  ? {
                      ...previous,

                      totalPoints:
                        updatedPoints,
                    }
                  : previous,
            );

            setIsExcavated(
              true,
            );

            removeLocationSubscription();
            removeHeadingSubscription();

            if (
              Platform.OS !==
                'web' &&
              userProfile
                ?.hapticFeedbackEnabled !==
                false
            ) {
              try {
                await Haptics
                  .notificationAsync(
                    Haptics
                      .NotificationFeedbackType
                      .Success,
                  );
              } catch (
                error: unknown
              ) {
                logDevelopmentWarning(
                  '[Treasi Hunt] Success haptic unavailable:',
                  error,
                );
              }
            }

            if (!isCurrentOperation()) return;
            announce(
              `Excavation complete. 100 points awarded. ${
                treasure.payloadText
                  ?.trim() ||
                'Treasure unlocked.'
              }`,
            );

            if (isCurrentOperation()) {
              try { onSuccess?.(); } catch (error) {
                logDevelopmentWarning('[Treasi Hunt] Discovery saved, but the success callback failed:', error);
              }
            }
          } catch (
            error: unknown
          ) {
            if (!isCurrentOperation()) return;
            const message =
              error instanceof
                Error
                ? error.message
                : '';

            switch (
              message
            ) {
              case 'HUNT_CANCELLED':
                break;
              case 'FRESH_LOCATION_REQUIRED':
                showAccessibleAlert('Fresh Location Required', 'Your GPS fix changed or expired before the discovery could be recorded. Retry with a fresh position.');
                break;
              case 'TARGET_OUT_OF_RANGE':
                showAccessibleAlert('Target Moved', 'The cache location changed or you moved out of range. Follow the updated target and try again.');
                break;
              case 'ALREADY_EXCAVATED':
                if (
                  isMountedRef.current
                ) {
                  setIsExcavated(
                    true,
                  );
                }

                showAccessibleAlert(
                  'Already Excavated',
                  'This treasure discovery is already recorded for your account.',
                );

                break;

              case 'PROFILE_MISSING':
              case 'INVALID_PROFILE_POINTS':
                showAccessibleAlert(
                  'Explorer Profile Error',
                  'Your Explorer profile could not be verified. Sign out and sign in again before continuing.',
                );

                break;

              case 'TREASURE_MISSING':
                showAccessibleAlert(
                  'Treasure Unavailable',
                  'This treasure no longer exists.',
                );

                break;

              case 'TREASURE_LOCATION_INVALID':
                showAccessibleAlert(
                  'Treasure Location Invalid',
                  'This cache no longer contains valid field coordinates.',
                );

                break;

              case 'TREASURE_ARCHIVED':
                if (
                  isMountedRef.current
                ) {
                  setTreasure(
                    (
                      previous,
                    ) =>
                      previous
                        ? {
                            ...previous,

                            isArchived:
                              true,
                          }
                        : previous,
                  );
                }

                showAccessibleAlert(
                  'Treasure Archived',
                  'This treasure was archived before the excavation could be recorded.',
                );

                break;

              case 'OWN_TREASURE':
                showAccessibleAlert(
                  'Own Cache',
                  'You cannot award yourself discovery points for a treasure you created.',
                );

                break;

              default:
                logDevelopmentWarning(
                  '[Treasi Hunt] Excavation transaction failed:',
                  error,
                );

                showAccessibleAlert(
                  'Excavation Failed',
                  'Treasi could not save this discovery. Check your connection and try again.',
                );
            }
          } finally {
            if (huntContextRef.current === operationContext) excavationLockRef.current = false;

            if (
              isCurrentOperation()
            ) {
              setIsSubmitting(
                false,
              );
            }
          }
        },
        [
          excavationStatusText,
          currentHuntContext,
          isLoading,
          blockingError,
          gpsStatus,
          isArchived,
          isExcavated,
          isLiveFixFresh,
          isMockedLocation,
          isSubmitting,
          onSuccess,
          removeHeadingSubscription,
          removeLocationSubscription,
          targetLocation,
          targetTreasureId,
          treasure,
          userProfile
            ?.hapticFeedbackEnabled,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Shake excavation                                                       */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        !canExcavate ||
        accelerometerAvailable !==
          true ||
        motionPermissionStatus !==
          'granted'
      ) {
        return;
      }

      let subscription: { remove: () => void };
      try {
      Accelerometer
        .setUpdateInterval(
          ACCELEROMETER_UPDATE_INTERVAL_MS,
        );

      const shakeThreshold =
        userProfile
          ?.motionSensitivityEnabled
          ? SENSITIVE_SHAKE_IMPULSE_THRESHOLD
          : DEFAULT_SHAKE_IMPULSE_THRESHOLD;

      subscription = Accelerometer.addListener(
          (
            data,
          ) => {
            if (
              !isMountedRef.current || !interactionActiveRef.current ||
              excavationLockRef.current
            ) {
              return;
            }

            const magnitude =
              Math.sqrt(
                data.x **
                  2 +
                  data.y **
                    2 +
                  data.z **
                    2,
              );

            /*
             * Normal gravity is roughly 1 g. We react to acceleration away
             * from that baseline instead of the raw magnitude.
             */
            if (!Number.isFinite(magnitude)) return;
            const shakeImpulse =
              Math.abs(
                magnitude -
                  1,
              );

            const now =
              Date.now();

            if (
              shakeImpulse >=
                shakeThreshold &&
              now -
                lastShakeTimeRef.current >=
                SHAKE_COOLDOWN_MS
            ) {
              lastShakeTimeRef.current =
                now;

              void executeExcavation();
            }
          },
        );

      } catch (error) {
        logDevelopmentWarning('[Treasi Hunt] Shake sensor unavailable:', error);
        setAccelerometerAvailable(false);
        return;
      }
      return () => {
        try { subscription.remove(); } catch {}
      };
    }, [
      accelerometerAvailable,
      canExcavate,
      executeExcavation,
      motionPermissionStatus,
      userProfile
        ?.motionSensitivityEnabled,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Display values                                                         */
    /* ---------------------------------------------------------------------- */

    const formattedDistance =
      formatDistance(
        distance,
      );

    const accessibleDistance =
      distance !==
      null
        ? distance <
          1_000
          ? `${Math.round(
              distance,
            )} metres`
          : `${(
              distance /
              1_000
            ).toFixed(
              1,
            )} kilometres`
        : 'unavailable';

    const targetDirectionText =
      useMemo(
        () => {
          if (
            targetBearing ===
            null
          ) {
            return 'TARGET BEARING UNAVAILABLE';
          }

          return `${Math.round(
            targetBearing,
          )}° ${getCardinalDirection(
            targetBearing,
          )}`;
        },
        [
          targetBearing,
        ],
      );

    const compassReferenceText =
      headingReference ===
        'true'
        ? 'TRUE NORTH'
        : headingReference ===
            'magnetic'
          ? 'MAGNETIC NORTH'
          : 'NORTH REFERENCE UNAVAILABLE';

    const compassAccessibilityLabel =
      useMemo(
        () => {
          const headingText =
            deviceHeading ===
            null
              ? 'Device heading unavailable.'
              : `Device heading ${Math.round(
                  deviceHeading,
                )} degrees ${getCardinalDirection(
                  deviceHeading,
                )}.`;

          const bearingText =
            targetBearing ===
            null
              ? 'Target bearing unavailable.'
              : `Target bearing ${Math.round(
                  targetBearing,
                )} degrees ${getCardinalDirection(
                  targetBearing,
                )}.`;

          return `Treasure compass. ${headingText} ${bearingText} Distance ${accessibleDistance}.`;
        },
        [
          accessibleDistance,
          deviceHeading,
          targetBearing,
        ],
      );

    const compassSize =
      Math.max(
        174,
        Math.min(
          isLandscape
            ? windowHeight *
                0.48
            : windowWidth *
                0.58,
          255,
        ),
      );

    const locationRecoveryVisible =
      !isArchived &&
      !isExcavated &&
      (
        (locationFixSource === 'live' && !isLiveFixFresh) ||
        gpsStatus ===
          'PERMISSION_REQUIRED' ||
        gpsStatus ===
          'DENIED' ||
        gpsStatus ===
          'PRECISION_REQUIRED' ||
        gpsStatus ===
          'SERVICES_OFF' ||
        gpsStatus ===
          'LOW_ACCURACY' ||
        gpsStatus ===
          'ERROR'
      );

    const locationActionLabel =
      useMemo(
        () => {
          if (
            isRefreshingLocation
          ) {
            return 'CHECKING LOCATION';
          }

          if (
            preciseLocationGranted ===
              false
          ) {
            return 'OPEN LOCATION SETTINGS';
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
            gpsStatus ===
              'PERMISSION_REQUIRED' ||
            gpsStatus ===
              'DENIED'
          ) {
            return 'ENABLE LOCATION';
          }

          if (
            Platform.OS ===
              'android' &&
            gpsStatus ===
              'LOW_ACCURACY'
          ) {
            return 'IMPROVE ACCURACY';
          }

          return 'RETRY LOCATION';
        },
        [
          canAskLocationAgain,
          gpsStatus,
          isRefreshingLocation,
          locationPermissionStatus,
          locationServicesEnabled,
          preciseLocationGranted,
        ],
      );

    const locationPrimaryStatus =
      useMemo(
        () => {
          if (
            isExcavated
          ) {
            return 'DISCOVERY RECORDED';
          }

          if (
            isArchived
          ) {
            return 'CACHE ARCHIVED';
          }

          if (
            locationFixSource ===
              'cached' &&
            gpsStatus ===
              'INITIALISING'
          ) {
            return 'CACHED FIX · WAITING FOR LIVE GPS';
          }

          switch (
            gpsStatus
          ) {
            case 'INITIALISING':
              return 'ACQUIRING LIVE GPS';

            case 'PERMISSION_REQUIRED':
              return 'LOCATION ACCESS REQUIRED';

            case 'DENIED':
              return 'LOCATION ACCESS DENIED';

            case 'PRECISION_REQUIRED':
              return 'PRECISE LOCATION REQUIRED';

            case 'SERVICES_OFF':
              return 'LOCATION SERVICES OFF';

            case 'LOW_ACCURACY':
              return gpsAccuracy !==
                null
                ? `GPS ACCURACY ±${Math.round(
                    gpsAccuracy,
                  )}M`
                : 'GPS ACCURACY LOW';

            case 'MOCKED_LOCATION':
              return 'SIMULATED LOCATION BLOCKED';

            case 'ERROR':
              return 'LOCATION TRACKING ERROR';

            case 'OK':
            default:
              if (
                !isLiveFixFresh
              ) {
                return 'WAITING FOR FRESH GPS';
              }

              if (
                gpsAccuracy !==
                null
              ) {
                return `LIVE GPS ±${Math.round(
                  gpsAccuracy,
                )}M`;
              }

              return 'LIVE GPS READY';
          }
        },
        [
          gpsAccuracy,
          gpsStatus,
          isArchived,
          isExcavated,
          isLiveFixFresh,
          locationFixSource,
        ],
      );

    const compassStatusText =
      useMemo(
        () => {
          switch (
            compassStatus
          ) {
            case 'READY':
              return `${compassReferenceText} · COMPASS READY`;

            case 'LOW_ACCURACY':
              return `${compassReferenceText} · CALIBRATION LOW`;

            case 'ERROR':
              return 'COMPASS INTERRUPTED · USE BEARING';

            case 'UNAVAILABLE':
              return 'COMPASS UNAVAILABLE · USE BEARING';

            case 'CHECKING':
            default:
              return 'CHECKING COMPASS';
          }
        },
        [
          compassReferenceText,
          compassStatus,
        ],
      );

    const terminalActionDisabled =
      isSubmitting ||
      isExcavated ||
      isArchived ||
      isOwnTreasure;

    const shouldOfferMotionPermission =
      canExcavate &&
      motionPermissionStatus !==
        'granted';

    /* ---------------------------------------------------------------------- */
    /* Loading                                                                */
    /* ---------------------------------------------------------------------- */

    if (
      isLoading &&
      !blockingError
    ) {
      return (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading Hunt and synchronising field data."
          style={[
            styles.container,
            styles.centerContent,

            {
              paddingTop:
                Math.max(
                  insets.top,
                  20,
                ),

              paddingBottom:
                Math.max(
                  insets.bottom,
                  20,
                ),

              paddingLeft:
                Math.max(
                  insets.left,
                  20,
                ),

              paddingRight:
                Math.max(
                  insets.right,
                  20,
                ),
            },
          ]}
        >
          <ActivityIndicator
            size="large"
            color={
              COLOURS.brass400
            }
          />

          <Text
            maxFontSizeMultiplier={1.6}
            style={
              styles.loadingText
            }
          >
            SYNCHRONISING HUNT DATA…
          </Text>
        </View>
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Fatal / sync state                                                     */
    /* ---------------------------------------------------------------------- */

    if (
      blockingError ||
      !targetTreasureId ||
      !treasure
    ) {
      return (
        <View
          style={[
            styles.container,
            styles.centerContent,

            {
              paddingTop:
                Math.max(
                  insets.top,
                  20,
                ),

              paddingBottom:
                Math.max(
                  insets.bottom,
                  20,
                ),

              paddingLeft:
                Math.max(
                  insets.left,
                  20,
                ),

              paddingRight:
                Math.max(
                  insets.right,
                  20,
                ),
            },
          ]}
        >
          <Ionicons
            accessible={false}
            importantForAccessibility="no"
            name="warning-outline"
            size={36}
            color={
              COLOURS.danger300
            }
          />

          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.6}
            style={
              styles.errorTitle
            }
          >
            HUNT UNAVAILABLE
          </Text>

          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            maxFontSizeMultiplier={1.8}
            style={
              styles.errorSub
            }
          >
            {blockingError ??
              'Treasure target unavailable.'}
          </Text>

          {targetTreasureId &&
          currentUserId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry Hunt synchronisation"
              onPress={
                handleRetryFirestore
              }
              style={({
                pressed,
              }) => [
                styles.primaryTextButton,

                pressed &&
                  styles.pressedControl,
              ]}
            >
              <Ionicons
                name="refresh-outline"
                size={18}
                color={
                  COLOURS.white
                }
              />

              <Text
                style={
                  styles.primaryTextButtonText
                }
              >
                RETRY FIELD LINK
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to Dashboard"
            onPress={
              handleBackNavigation
            }
            style={({
              pressed,
            }) => [
              styles.secondaryTextButton,

              pressed &&
                styles.pressedControl,
            ]}
          >
            <Ionicons
              name="arrow-back"
              size={18}
              color={
                COLOURS.parchment200
              }
            />

            <Text
              style={
                styles.secondaryTextButtonText
              }
            >
              RETURN TO DASHBOARD
            </Text>
          </Pressable>
        </View>
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Main Hunt interface                                                    */
    /* ---------------------------------------------------------------------- */

    return (
      <View
        style={[
          styles.container,

          {
            paddingTop:
              Math.max(
                insets.top,
                8,
              ),

            paddingBottom:
              Math.max(
                insets.bottom,
                8,
              ),

            paddingLeft:
              Math.max(
                insets.left,
                8,
              ),

            paddingRight:
              Math.max(
                insets.right,
                8,
              ),
          },
        ]}
      >
        <ScrollView
          style={
            styles.scrollView
          }
          contentContainerStyle={[
            styles.scrollContent,

            {
              minHeight:
                Math.max(
                  0,
                  windowHeight -
                    insets.top -
                    insets.bottom -
                    16,
                ),
            },
          ]}
          showsVerticalScrollIndicator={
            false
          }
          bounces={false}
        >
          <View
            style={[
              styles.splitWrapper,

              {
                flexDirection:
                  isLandscape
                    ? 'row'
                    : 'column',
              },
            ]}
          >
            {/* ============================================================= */}
            {/* 60% — NAVIGATION INSTRUMENT                                  */}
            {/* ============================================================= */}

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
                  styles.instrumentHeader
                }
              >
                <View
                  style={
                    styles.instrumentHeaderIdentity
                  }
                >
                  <Ionicons
                    accessible={false}
                    importantForAccessibility="no"
                    name="compass-outline"
                    size={18}
                    color={
                      COLOURS.brass400
                    }
                  />

                  <View
                    style={
                      styles.instrumentHeaderText
                    }
                  >
                    <Text
                      accessibilityRole="header"
                      style={
                        styles.instrumentTitle
                      }
                    >
                      TARGET NAVIGATION
                    </Text>

                    <Text
                      style={
                        styles.instrumentSubtitle
                      }
                    >
                      LIVE POSITION · BEARING · DIG RANGE
                    </Text>
                  </View>
                </View>

                <View
                  accessible
                  accessibilityLabel={
                    locationPrimaryStatus
                  }
                  style={[
                    styles.liveStatusBadge,

                    gpsStatus ===
                      'OK' &&
                    isLiveFixFresh
                      ? styles.liveStatusBadgeReady
                      : styles.liveStatusBadgeWaiting,
                  ]}
                >
                  <View
                    style={[
                      styles.liveStatusDot,

                      gpsStatus ===
                        'OK' &&
                      isLiveFixFresh
                        ? styles.liveStatusDotReady
                        : styles.liveStatusDotWaiting,
                    ]}
                  />

                  <Text
                    numberOfLines={1}
                    style={
                      styles.liveStatusBadgeText
                    }
                  >
                    {gpsStatus ===
                      'OK' &&
                    isLiveFixFresh
                      ? 'LIVE'
                      : 'WAIT'}
                  </Text>
                </View>
              </View>

              <View
                style={
                  styles.compassArea
                }
              >
                {Platform.OS !==
                  'web' &&
                compassStatus ===
                  'CHECKING' ? (
                  <View
                    accessible
                    accessibilityLabel="Checking native compass heading."
                    style={[
                      styles.sensorFallbackBox,

                      {
                        width:
                          compassSize,

                        height:
                          compassSize,

                        borderRadius:
                          compassSize /
                          2,
                      },
                    ]}
                  >
                    <ActivityIndicator
                      color={
                        COLOURS.brass400
                      }
                    />

                    <Text
                      style={
                        styles.fallbackText
                      }
                    >
                      CHECKING COMPASS…
                    </Text>
                  </View>
                ) : Platform.OS !==
                    'web' &&
                  (
                    compassStatus ===
                      'READY' ||
                    compassStatus ===
                      'LOW_ACCURACY'
                  ) &&
                  deviceHeading !==
                    null ? (
                  <CompassDial
                    cardRotation={
                      compassCardRotationAnim
                    }
                    targetRotation={
                      targetRotationAnim
                    }
                    size={
                      compassSize
                    }
                    hasTargetBearing={
                      targetBearing !==
                      null
                    }
                    accessibilityLabel={
                      compassAccessibilityLabel
                    }
                  />
                ) : (
                  <View
                    accessible
                    accessibilityRole="alert"
                    accessibilityLabel="Compass heading is unavailable. Use the numerical target bearing and distance."
                    style={[
                      styles.sensorFallbackBox,

                      {
                        width:
                          compassSize,

                        height:
                          compassSize,

                        borderRadius:
                          compassSize /
                          2,
                      },
                    ]}
                  >
                    <Ionicons
                      name="compass-outline"
                      size={34}
                      color={
                        COLOURS.brass400
                      }
                    />

                    <Text
                      style={
                        styles.fallbackText
                      }
                    >
                      COMPASS UNAVAILABLE
                    </Text>

                    <Text
                      style={
                        styles.fallbackSubtext
                      }
                    >
                      USE BEARING + DISTANCE
                    </Text>
                  </View>
                )}

                <Text
                  accessible
                  accessibilityLabel={
                    compassStatusText
                  }
                  style={[
                    styles.compassStatusText,

                    compassStatus ===
                      'LOW_ACCURACY' &&
                      styles.warningText,
                  ]}
                >
                  {
                    compassStatusText
                  }
                </Text>

                {headingAccuracy !==
                  null &&
                compassStatus !==
                  'UNAVAILABLE' ? (
                  <Text
                    style={
                      styles.headingAccuracyText
                    }
                  >
                    CALIBRATION LEVEL{' '}
                    {
                      headingAccuracy
                    }
                    /3
                  </Text>
                ) : null}
              </View>

              <View
                style={
                  styles.telemetryGroup
                }
              >
                <OdometerDisplay
                  value={
                    formattedDistance
                  }
                  accessibilityValue={
                    accessibleDistance
                  }
                />

                <Text
                  maxFontSizeMultiplier={1.5}
                  style={
                    styles.targetSubtext
                  }
                >
                  TO TARGET ·{' '}
                  {
                    DISCOVERY_RADIUS_METRES
                  }
                  M DIG RADIUS
                </Text>

                <Text
                  maxFontSizeMultiplier={1.5}
                  style={
                    styles.bearingText
                  }
                >
                  {
                    targetDirectionText
                  }
                </Text>

                <View
                  accessible
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={`${locationPrimaryStatus}. ${excavationStatusText}`}
                  style={
                    styles.gpsStatusArea
                  }
                >
                  {gpsStatus ===
                    'OK' &&
                  isLiveFixFresh ? (
                    <Ionicons
                      accessible={false}
                      importantForAccessibility="no"
                      name="navigate-circle"
                      size={17}
                      color={
                        canExcavate
                          ? COLOURS.success300
                          : COLOURS.brass400
                      }
                    />
                  ) : (
                    <Ionicons
                      accessible={false}
                      importantForAccessibility="no"
                      name={
                        gpsStatus ===
                          'PRECISION_REQUIRED' ||
                        gpsStatus ===
                          'DENIED' ||
                        gpsStatus ===
                          'SERVICES_OFF' ||
                        gpsStatus ===
                          'MOCKED_LOCATION'
                          ? 'warning-outline'
                          : 'navigate-circle-outline'
                      }
                      size={17}
                      color={
                        gpsStatus ===
                          'DENIED' ||
                        gpsStatus ===
                          'SERVICES_OFF' ||
                        gpsStatus ===
                          'MOCKED_LOCATION'
                          ? COLOURS.danger300
                          : COLOURS.warning300
                      }
                    />
                  )}

                  <Text
                    style={
                      canExcavate
                        ? styles.successText
                        : (
                            gpsStatus ===
                              'DENIED' ||
                            gpsStatus ===
                              'SERVICES_OFF' ||
                            gpsStatus ===
                              'MOCKED_LOCATION'
                          )
                          ? styles.dangerText
                          : (
                              gpsStatus ===
                                'LOW_ACCURACY' ||
                              gpsStatus ===
                                'PRECISION_REQUIRED'
                            )
                            ? styles.warningText
                            : styles.statusText
                    }
                  >
                    {
                      locationPrimaryStatus
                    }
                  </Text>
                </View>

                <Text
                  maxFontSizeMultiplier={1.7}
                  style={
                    styles.locationExplanation
                  }
                >
                  {
                    excavationStatusText
                  }
                </Text>

                {locationRecoveryVisible ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      locationActionLabel
                    }
                    accessibilityHint="Restores the precise foreground location required to verify Hunt discoveries."
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
                      styles.locationActionButton,

                      isRefreshingLocation &&
                        styles.disabledControl,

                      pressed &&
                        !isRefreshingLocation &&
                        styles.pressedControl,
                    ]}
                  >
                    {isRefreshingLocation ? (
                      <ActivityIndicator
                        size="small"
                        color={
                          COLOURS.white
                        }
                      />
                    ) : (
                      <Ionicons
                        name={
                          locationActionLabel.includes(
                            'SETTINGS',
                          )
                            ? 'settings-outline'
                            : 'locate-outline'
                        }
                        size={18}
                        color={
                          COLOURS.white
                        }
                      />
                    )}

                    <Text
                      style={
                        styles.locationActionButtonText
                      }
                    >
                      {
                        locationActionLabel
                      }
                    </Text>
                  </Pressable>
                ) : null}

                {isOwnTreasure ? (
                  <View
                    accessible
                    accessibilityRole="alert"
                    style={
                      styles.ownCacheNotice
                    }
                  >
                    <Ionicons
                      name="shield-outline"
                      size={16}
                      color={
                        COLOURS.warning300
                      }
                    />

                    <Text
                      style={
                        styles.ownCacheNoticeText
                      }
                    >
                      YOUR OWN CACHE · NO DISCOVERY REWARD
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* ============================================================= */}
            {/* 40% — CLUE / EXCAVATION CONSOLE                              */}
            {/* ============================================================= */}

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
                    styles.consoleHeaderIdentity
                  }
                >
                  <Ionicons
                    accessible={false}
                    importantForAccessibility="no"
                    name="document-text-outline"
                    size={18}
                    color={
                      COLOURS.brass400
                    }
                  />

                  <View
                    style={
                      styles.consoleHeaderText
                    }
                  >
                    <Text
                      accessibilityRole="header"
                      style={
                        styles.consoleTitle
                      }
                    >
                      CLUE SLATE
                    </Text>

                    <Text
                      style={
                        styles.consoleSubtitle
                      }
                    >
                      CACHE INTELLIGENCE · EXTRACTION CONTROL
                    </Text>
                  </View>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Abandon Hunt and return to Dashboard"
                  accessibilityHint="Leaves Hunt without recording a new discovery."
                  onPress={
                    handleBackNavigation
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.backButton,

                    pressed &&
                      styles.pressedControl,
                  ]}
                >
                  <Ionicons
                    name="arrow-back"
                    size={18}
                    color={
                      COLOURS.brass400
                    }
                  />
                </Pressable>
              </View>

              <ScrollView
                style={
                  styles.consoleScroll
                }
                contentContainerStyle={
                  styles.consoleScrollContent
                }
                showsVerticalScrollIndicator={
                  false
                }
              >
                <View
                  accessible
                  accessibilityLabel={`${treasure.title || 'Treasure cache'}. Hint: ${
                    treasure.hint ||
                    'No clue provided.'
                  }. Hidden by ${
                    treasure.creatorName ||
                    'Explorer'
                  }.`}
                  style={
                    styles.clueCard
                  }
                >
                  <View
                    accessible={false}
                    importantForAccessibility="no-hide-descendants"
                    style={
                      styles.clueCardHeader
                    }
                  >
                    <View
                      style={
                        styles.clueIconCircle
                      }
                    >
                      <Ionicons
                        name="star"
                        size={16}
                        color={
                          COLOURS.parchment100
                        }
                      />
                    </View>

                    <View
                      style={
                        styles.clueTitleGroup
                      }
                    >
                      <Text
                        maxFontSizeMultiplier={1.6}
                        style={
                          styles.clueTitle
                        }
                      >
                        {treasure.title ||
                          'UNKNOWN CACHE'}
                      </Text>

                      <Text
                        style={
                          styles.clueReference
                        }
                      >
                        CACHE{' '}
                        {targetTreasureId
                          .substring(
                            0,
                            8,
                          )
                          .toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={
                      styles.clueDivider
                    }
                  />

                  <Text
                    accessible={false}
                    importantForAccessibility="no"
                    maxFontSizeMultiplier={1.8}
                    style={
                      styles.clueBody
                    }
                  >
                    “
                    {treasure.hint ||
                      'No clue provided.'}
                    ”
                  </Text>

                  <Text
                    accessible={false}
                    importantForAccessibility="no"
                    maxFontSizeMultiplier={1.6}
                    style={
                      styles.clueAuthor
                    }
                  >
                    — left by{' '}
                    {treasure.creatorName ||
                      'Explorer'}
                  </Text>

                  {treasure.imageUrl
                    ?.trim() ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Inspect field photo"
                      accessibilityHint="Opens this treasure's field photo in a larger view."
                      onPress={() => {
                        setImageLoadFailed(
                          false,
                        );

                        setImageModalVisible(
                          true,
                        );
                      }}
                      style={({
                        pressed,
                      }) => [
                        styles.evidenceButton,

                        pressed &&
                          styles.pressedLightControl,
                      ]}
                    >
                      <Ionicons
                        name="image-outline"
                        size={19}
                        color={
                          COLOURS.ink900
                        }
                      />

                      <Text
                        maxFontSizeMultiplier={1.5}
                        style={
                          styles.evidenceText
                        }
                      >
                        INSPECT FIELD PHOTO
                      </Text>

                      <Ionicons
                        name="expand-outline"
                        size={17}
                        color={
                          COLOURS.ink700
                        }
                      />
                    </Pressable>
                  ) : null}
                </View>

                {/* ---------------------------------------------------------- */}
                {/* Hunt diagnostics                                           */}
                {/* ---------------------------------------------------------- */}

                <View
                  style={
                    styles.diagnosticsCard
                  }
                >
                  <Text
                    accessibilityRole="header"
                    style={
                      styles.diagnosticsTitle
                    }
                  >
                    HUNT READINESS
                  </Text>

                  <View
                    style={
                      styles.diagnosticRow
                    }
                  >
                    <Text
                      style={
                        styles.diagnosticLabel
                      }
                    >
                      POSITION SOURCE
                    </Text>

                    <Text
                      style={
                        styles.diagnosticValue
                      }
                    >
                      {
                        locationFixSource.toUpperCase()
                      }
                    </Text>
                  </View>

                  <View
                    style={
                      styles.diagnosticRow
                    }
                  >
                    <Text
                      style={
                        styles.diagnosticLabel
                      }
                    >
                      GPS ACCURACY
                    </Text>

                    <Text
                      style={[
                        styles.diagnosticValue,

                        gpsStatus ===
                          'OK' &&
                          styles.diagnosticValueSuccess,
                      ]}
                    >
                      {gpsAccuracy !==
                      null
                        ? `±${Math.round(
                            gpsAccuracy,
                          )} M`
                        : 'WAITING'}
                    </Text>
                  </View>

                  <View
                    style={
                      styles.diagnosticRow
                    }
                  >
                    <Text
                      style={
                        styles.diagnosticLabel
                      }
                    >
                      PRECISE ACCESS
                    </Text>

                    <Text
                      style={[
                        styles.diagnosticValue,

                        preciseLocationGranted ===
                          true &&
                          styles.diagnosticValueSuccess,

                        preciseLocationGranted ===
                          false &&
                          styles.diagnosticValueWarning,
                      ]}
                    >
                      {preciseLocationGranted ===
                      null
                        ? Platform.OS ===
                          'web'
                          ? 'BROWSER'
                          : 'CHECKING'
                        : preciseLocationGranted
                          ? 'YES'
                          : 'NO'}
                    </Text>
                  </View>

                  <View
                    style={
                      styles.diagnosticRow
                    }
                  >
                    <Text
                      style={
                        styles.diagnosticLabel
                      }
                    >
                      COMPASS
                    </Text>

                    <Text
                      style={[
                        styles.diagnosticValue,

                        compassStatus ===
                          'READY' &&
                          styles.diagnosticValueSuccess,

                        compassStatus ===
                          'LOW_ACCURACY' &&
                          styles.diagnosticValueWarning,
                      ]}
                    >
                      {
                        compassStatus
                      }
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.diagnosticRow,
                      styles.diagnosticRowLast,
                    ]}
                  >
                    <Text
                      style={
                        styles.diagnosticLabel
                      }
                    >
                      SHAKE CONTROL
                    </Text>

                    <Text
                      style={[
                        styles.diagnosticValue,

                        accelerometerAvailable ===
                          true &&
                        motionPermissionStatus ===
                          'granted' &&
                          styles.diagnosticValueSuccess,
                      ]}
                    >
                      {accelerometerAvailable ===
                        true &&
                      motionPermissionStatus ===
                        'granted'
                        ? 'READY'
                        : 'TAP AVAILABLE'}
                    </Text>
                  </View>
                </View>

                {/* ---------------------------------------------------------- */}
                {/* Excavation                                                 */}
                {/* ---------------------------------------------------------- */}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    isExcavated
                      ? 'Excavation complete'
                      : isArchived
                        ? 'Treasure archived'
                        : isOwnTreasure
                          ? 'Own treasure cannot be excavated'
                          : isSubmitting
                            ? 'Excavation transmitting'
                            : canExcavate
                              ? 'Excavate treasure'
                              : 'Check excavation readiness'
                  }
                  accessibilityHint={
                    excavationStatusText
                  }
                  accessibilityState={{
                    disabled:
                      terminalActionDisabled,

                    busy:
                      isSubmitting,
                  }}
                  disabled={
                    terminalActionDisabled
                  }
                  onPress={() => {
                    void executeExcavation();
                  }}
                  style={({
                    pressed,
                  }) => [
                    styles.excavationCard,

                    canExcavate &&
                      styles.excavationCardReady,

                    isExcavated &&
                      styles.excavationCardSuccess,

                    (
                      isArchived ||
                      isOwnTreasure
                    ) &&
                      styles.excavationCardDisabled,

                    pressed &&
                      !terminalActionDisabled &&
                      styles.pressedControl,
                  ]}
                >
                  <View
                    accessible={false}
                    importantForAccessibility="no-hide-descendants"
                    style={
                      styles.excavationHeader
                    }
                  >
                    {isSubmitting ? (
                      <ActivityIndicator
                        size="small"
                        color={
                          COLOURS.white
                        }
                      />
                    ) : (
                      <Ionicons
                        name={
                          isExcavated
                            ? 'checkmark-circle-outline'
                            : canExcavate
                              ? 'earth-outline'
                              : isArchived
                                ? 'archive-outline'
                                : isOwnTreasure
                                  ? 'shield-outline'
                                  : 'navigate-outline'
                        }
                        size={21}
                        color={
                          COLOURS.white
                        }
                      />
                    )}

                    <Text
                      style={
                        styles.excavationTitle
                      }
                    >
                      {isSubmitting
                        ? 'TRANSMITTING SIGNAL…'
                        : isExcavated
                          ? 'EXCAVATION COMPLETE'
                          : isArchived
                            ? 'CACHE ARCHIVED'
                            : isOwnTreasure
                              ? 'YOUR OWN CACHE'
                              : canExcavate
                                ? 'DIG SITE VERIFIED'
                                : 'APPROACH TARGET'}
                    </Text>
                  </View>

                  <Text
                    accessibilityLiveRegion="polite"
                    maxFontSizeMultiplier={1.7}
                    style={
                      styles.excavationDescription
                    }
                  >
                    {isExcavated
                      ? `PAYLOAD: ${
                          treasure.payloadText
                            ?.trim() ||
                          'CACHE UNLOCKED (+100 PTS)'
                        }`
                      : excavationStatusText}
                  </Text>

                  {canExcavate &&
                  !isSubmitting ? (
                    <View
                      accessible={false}
                      importantForAccessibility="no-hide-descendants"
                      style={
                        styles.readyPrompt
                      }
                    >
                      <View
                        style={
                          styles.readyPromptLine
                        }
                      />

                      <Text
                        style={
                          styles.readyPromptText
                        }
                      >
                        TAP TO EXCAVATE
                      </Text>

                      <View
                        style={
                          styles.readyPromptLine
                        }
                      />
                    </View>
                  ) : null}
                </Pressable>

                {shouldOfferMotionPermission ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Enable optional shake excavation"
                    accessibilityHint="Requests motion sensor permission. The normal tap excavation control works without it."
                    accessibilityState={{
                      disabled:
                        isRequestingMotionPermission,

                      busy:
                        isRequestingMotionPermission,
                    }}
                    disabled={
                      isRequestingMotionPermission
                    }
                    onPress={() => {
                      void handleEnableShake();
                    }}
                    style={({
                      pressed,
                    }) => [
                      styles.motionPermissionButton,

                      isRequestingMotionPermission &&
                        styles.disabledControl,

                      pressed &&
                        !isRequestingMotionPermission &&
                        styles.pressedLightControl,
                    ]}
                  >
                    {isRequestingMotionPermission ? (
                      <ActivityIndicator
                        size="small"
                        color={
                          COLOURS.ink900
                        }
                      />
                    ) : (
                      <Ionicons
                        name="phone-portrait-outline"
                        size={17}
                        color={
                          COLOURS.ink900
                        }
                      />
                    )}

                    <View
                      style={
                        styles.motionPermissionTextGroup
                      }
                    >
                      <Text
                        style={
                          styles.motionPermissionTitle
                        }
                      >
                        ENABLE OPTIONAL SHAKE CONTROL
                      </Text>

                      <Text
                        style={
                          styles.motionPermissionDescription
                        }
                      >
                        Tap excavation always remains available.
                      </Text>
                    </View>
                  </Pressable>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Abandon Hunt"
                  accessibilityHint="Returns to the Dashboard without recording a new discovery."
                  onPress={
                    handleBackNavigation
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.abandonButton,

                    pressed &&
                      styles.pressedControl,
                  ]}
                >
                  <Ionicons
                    name="arrow-back-outline"
                    size={17}
                    color={
                      COLOURS.brass400
                    }
                  />

                  <Text
                    style={
                      styles.abandonText
                    }
                  >
                    ABANDON HUNT
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </ScrollView>

        {/* ------------------------------------------------------------------ */}
        {/* Field photo modal                                                  */}
        {/* ------------------------------------------------------------------ */}

        {treasure.imageUrl
          ?.trim() ? (
          <Modal
            testID="hunt-photo-modal"
            supportedOrientations={['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right']}
            visible={
              imageModalVisible
            }
            transparent
            animationType={
              reduceMotionEnabled
                ? 'none'
                : 'fade'
            }
            statusBarTranslucent
            onRequestClose={() =>
              setImageModalVisible(
                false,
              )
            }
          >
            <View
              style={
                styles.modalOverlay
              }
            >
              <View
                accessibilityViewIsModal
                accessibilityLabel="Field photo viewer"
                onAccessibilityEscape={() =>
                  setImageModalVisible(
                    false,
                  )
                }
                style={
                  styles.modalContent
                }
              >
                <View
                  style={
                    styles.modalHeader
                  }
                >
                  <View
                    style={
                      styles.modalHeaderIdentity
                    }
                  >
                    <Ionicons
                      name="image-outline"
                      size={19}
                      color={
                        COLOURS.brass400
                      }
                    />

                    <Text
                      accessibilityRole="header"
                      maxFontSizeMultiplier={1.6}
                      style={
                        styles.modalTitle
                      }
                    >
                      FIELD PHOTO
                    </Text>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close field photo"
                    onPress={() =>
                      setImageModalVisible(
                        false,
                      )
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.modalCloseIconButton,

                      pressed &&
                        styles.pressedControl,
                    ]}
                  >
                    <Ionicons
                      name="close"
                      size={22}
                      color={
                        COLOURS.parchment200
                      }
                    />
                  </Pressable>
                </View>

                {imageLoadFailed ? (
                  <View
                    accessible
                    accessibilityRole="alert"
                    accessibilityLabel="Field photo could not be loaded."
                    style={
                      styles.imageFallback
                    }
                  >
                    <Ionicons
                      name="image-outline"
                      size={34}
                      color={
                        COLOURS.danger300
                      }
                    />

                    <Text
                      style={
                        styles.imageFallbackText
                      }
                    >
                      PHOTO UNAVAILABLE
                    </Text>
                  </View>
                ) : (
                  <Image
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={`Field photo for ${
                      treasure.title ||
                      'this treasure'
                    }`}
                    source={{
                      uri:
                        treasure.imageUrl,
                    }}
                    resizeMode="contain"
                    onError={() =>
                      setImageLoadFailed(
                        true,
                      )
                    }
                    style={
                      styles.fullEvidenceImage
                    }
                  />
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close field photo"
                  onPress={() =>
                    setImageModalVisible(
                      false,
                    )
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.primaryTextButton,

                    pressed &&
                      styles.pressedControl,
                  ]}
                >
                  <Ionicons
                    name="close-outline"
                    size={18}
                    color={
                      COLOURS.white
                    }
                  />

                  <Text
                    style={
                      styles.primaryTextButtonText
                    }
                  >
                    CLOSE PHOTO
                  </Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        ) : null}
      </View>
    );
  };

export default HuntScreen;

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    container: {
      flex: 1,

      backgroundColor:
        COLOURS.forest950,
    },

    centerContent: {
      justifyContent:
        'center',

      alignItems:
        'center',

      gap: 10,
    },

    scrollView: {
      flex: 1,
    },

    scrollContent: {
      flexGrow: 1,
    },

    loadingText: {
      marginTop: 5,

      color:
        COLOURS.parchment200,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 13,

      lineHeight: 19,

      fontWeight: '800',

      letterSpacing: 0.9,

      textAlign: 'center',
    },

    errorTitle: {
      color:
        COLOURS.danger300,

      fontFamily:
        MONO_BOLD_FONT,

      fontWeight: '800',

      fontSize: 18,

      lineHeight: 24,

      marginTop: 4,

      textAlign: 'center',
    },

    errorSub: {
      color:
        COLOURS.parchment200,

      fontFamily:
        MONO_FONT,

      fontSize: 13,

      lineHeight: 20,

      textAlign: 'center',

      marginBottom: 8,

      maxWidth: 560,
    },

    /* ---------------------------------------------------------------------- */
    /* 60 / 40 layout                                                        */
    /* ---------------------------------------------------------------------- */

    splitWrapper: {
      flexGrow: 1,

      width: '100%',

      gap: 12,
    },

    leftViewport: {
      minWidth: 0,

      minHeight: 0,

      backgroundColor:
        COLOURS.forest950,

      borderWidth: 2,

      borderColor:
        COLOURS.brass500,

      borderRadius: 7,

      padding: 14,
    },

    leftViewportLandscape: {
      flex: 0.6,
    },

    leftViewportPortrait: {
      width: '100%',

      minHeight: 480,
    },

    rightViewport: {
      minWidth: 0,

      minHeight: 0,

      backgroundColor:
        COLOURS.forest800,

      borderWidth: 2,

      borderColor:
        COLOURS.brass500,

      borderRadius: 7,

      padding: 12,
    },

    rightViewportLandscape: {
      flex: 0.4,
    },

    rightViewportPortrait: {
      width: '100%',

      minHeight: 520,
    },

    /* ---------------------------------------------------------------------- */
    /* Instrument header                                                     */
    /* ---------------------------------------------------------------------- */

    instrumentHeader: {
      minHeight: 48,

      flexDirection: 'row',

      alignItems: 'center',

      justifyContent:
        'space-between',

      gap: 8,

      paddingBottom: 8,

      borderBottomWidth: 1,

      borderBottomColor:
        COLOURS.brass600,
    },

    instrumentHeaderIdentity: {
      flex: 1,

      minWidth: 0,

      flexDirection: 'row',

      alignItems: 'center',

      gap: 7,
    },

    instrumentHeaderText: {
      flex: 1,

      minWidth: 0,
    },

    instrumentTitle: {
      color:
        COLOURS.parchment200,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 12,

      lineHeight: 18,

      fontWeight: '800',

      letterSpacing: 0.8,
    },

    instrumentSubtitle: {
      marginTop: 1,

      color:
        COLOURS.brass400,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 7.5,

      lineHeight: 11,

      fontWeight: '700',

      letterSpacing: 0.45,
    },

    liveStatusBadge: {
      minWidth: 58,

      minHeight: 32,

      flexDirection: 'row',

      alignItems: 'center',

      justifyContent: 'center',

      gap: 5,

      paddingHorizontal: 8,

      borderWidth: 1,

      borderRadius: 16,
    },

    liveStatusBadgeReady: {
      backgroundColor:
        '#243C2A',

      borderColor:
        COLOURS.success300,
    },

    liveStatusBadgeWaiting: {
      backgroundColor:
        COLOURS.forest900,

      borderColor:
        COLOURS.brass600,
    },

    liveStatusDot: {
      width: 7,

      height: 7,

      borderRadius: 3.5,
    },

    liveStatusDotReady: {
      backgroundColor:
        COLOURS.success300,
    },

    liveStatusDotWaiting: {
      backgroundColor:
        COLOURS.warning300,
    },

    liveStatusBadgeText: {
      color:
        COLOURS.parchment200,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 8,

      lineHeight: 12,

      fontWeight: '800',
    },

    /* ---------------------------------------------------------------------- */
    /* Compass                                                               */
    /* ---------------------------------------------------------------------- */

    compassArea: {
      alignItems: 'center',

      justifyContent: 'center',

      marginTop: 12,
    },

    compassRim: {
      backgroundColor:
        COLOURS.brass700,

      padding: 10,

      borderWidth: 2,

      borderColor:
        COLOURS.brass400,

      justifyContent: 'center',

      alignItems: 'center',

      elevation: 8,

      shadowColor:
        '#000000',

      shadowOffset: {
        width: 0,

        height: 5,
      },

      shadowOpacity: 0.35,

      shadowRadius: 8,
    },

    compassFace: {
      position: 'relative',

      backgroundColor:
        COLOURS.forest950,

      justifyContent: 'center',

      alignItems: 'center',

      borderWidth: 1,

      borderColor:
        'rgba(216, 184, 117, 0.45)',

      overflow: 'hidden',
    },

    compassSvgLayer: {
      position: 'absolute',

      top: 0,

      right: 0,

      bottom: 0,

      left: 0,
    },

    targetNeedleWrapper: {
      position: 'absolute',

      justifyContent: 'center',

      alignItems: 'center',
    },

    compassCap: {
      position: 'absolute',

      width: 16,

      height: 16,

      borderRadius: 8,

      backgroundColor:
        COLOURS.brass400,

      borderWidth: 2,

      borderColor:
        COLOURS.parchment200,
    },

    sensorFallbackBox: {
      borderWidth: 2,

      borderColor:
        COLOURS.brass400,

      justifyContent: 'center',

      alignItems: 'center',

      backgroundColor:
        COLOURS.forest800,

      padding: 18,
    },

    fallbackText: {
      color:
        COLOURS.parchment200,

      fontSize: 12,

      lineHeight: 18,

      fontFamily:
        MONO_BOLD_FONT,

      textAlign: 'center',

      marginTop: 9,

      fontWeight: '800',
    },

    fallbackSubtext: {
      color:
        COLOURS.brass400,

      fontSize: 9,

      lineHeight: 14,

      fontFamily:
        MONO_BOLD_FONT,

      textAlign: 'center',

      marginTop: 5,

      fontWeight: '700',

      letterSpacing: 0.6,
    },

    compassStatusText: {
      marginTop: 8,

      color:
        COLOURS.brass400,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 8.5,

      lineHeight: 13,

      fontWeight: '700',

      letterSpacing: 0.4,

      textAlign: 'center',
    },

    headingAccuracyText: {
      marginTop: 2,

      color:
        COLOURS.brass500,

      fontFamily:
        MONO_FONT,

      fontSize: 7.5,

      lineHeight: 11,

      textAlign: 'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Telemetry                                                             */
    /* ---------------------------------------------------------------------- */

    telemetryGroup: {
      alignItems: 'center',

      width: '100%',

      marginTop: 11,
    },

    odometerContainer: {
      flexDirection: 'row',

      flexWrap: 'wrap',

      alignItems: 'center',

      justifyContent: 'center',
    },

    odometerSpacer: {
      width: 8,
    },

    odometerBox: {
      minWidth: 27,

      height: 40,

      paddingHorizontal: 4,

      backgroundColor:
        '#11130F',

      borderWidth: 1,

      borderColor:
        COLOURS.brass400,

      borderRadius: 4,

      justifyContent: 'center',

      alignItems: 'center',

      marginHorizontal: 2,
    },

    odometerSplitLine: {
      position: 'absolute',

      top: '50%',

      left: 0,

      right: 0,

      height: 1,

      backgroundColor:
        'rgba(0, 0, 0, 0.75)',
    },

    odometerText: {
      color:
        COLOURS.parchment200,

      fontSize: 18,

      lineHeight: 24,

      fontWeight: '800',

      fontFamily:
        MONO_BOLD_FONT,
    },

    targetSubtext: {
      color:
        COLOURS.brass400,

      fontSize: 10,

      lineHeight: 15,

      letterSpacing: 0.8,

      fontFamily:
        MONO_BOLD_FONT,

      marginTop: 7,

      fontWeight: '700',

      textAlign: 'center',
    },

    bearingText: {
      color:
        COLOURS.parchment200,

      fontSize: 11,

      lineHeight: 16,

      fontFamily:
        MONO_BOLD_FONT,

      marginTop: 3,

      textAlign: 'center',
    },

    gpsStatusArea: {
      minHeight: 34,

      marginTop: 7,

      flexDirection: 'row',

      alignItems: 'center',

      justifyContent: 'center',

      gap: 6,

      paddingHorizontal: 9,

      paddingVertical: 5,

      borderWidth: 1,

      borderColor:
        COLOURS.forest700,

      borderRadius: 5,

      backgroundColor:
        COLOURS.forest900,
    },

    statusText: {
      flexShrink: 1,

      color:
        COLOURS.parchment200,

      fontSize: 9.5,

      lineHeight: 14,

      fontFamily:
        MONO_BOLD_FONT,

      textAlign: 'center',

      fontWeight: '700',
    },

    warningText: {
      flexShrink: 1,

      color:
        COLOURS.warning300,

      fontSize: 9.5,

      lineHeight: 14,

      fontFamily:
        MONO_BOLD_FONT,

      fontWeight: '800',

      textAlign: 'center',
    },

    dangerText: {
      flexShrink: 1,

      color:
        COLOURS.danger300,

      fontSize: 9.5,

      lineHeight: 14,

      fontFamily:
        MONO_BOLD_FONT,

      fontWeight: '800',

      textAlign: 'center',
    },

    successText: {
      flexShrink: 1,

      color:
        COLOURS.success300,

      fontSize: 9.5,

      lineHeight: 14,

      fontFamily:
        MONO_BOLD_FONT,

      fontWeight: '800',

      textAlign: 'center',
    },

    locationExplanation: {
      maxWidth: 520,

      marginTop: 5,

      color:
        COLOURS.brass400,

      fontSize: 9,

      lineHeight: 14,

      textAlign: 'center',
    },

    locationActionButton: {
      minHeight:
        MIN_TOUCH_TARGET,

      minWidth: 190,

      marginTop: 9,

      paddingHorizontal: 14,

      paddingVertical: 9,

      flexDirection: 'row',

      justifyContent: 'center',

      alignItems: 'center',

      gap: 7,

      backgroundColor:
        COLOURS.rust700,

      borderWidth: 1,

      borderColor:
        COLOURS.parchment200,

      borderRadius: 5,
    },

    locationActionButtonText: {
      color:
        COLOURS.white,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 9,

      lineHeight: 14,

      fontWeight: '800',

      letterSpacing: 0.55,

      textAlign: 'center',
    },

    ownCacheNotice: {
      minHeight: 38,

      marginTop: 8,

      flexDirection: 'row',

      alignItems: 'center',

      justifyContent: 'center',

      gap: 6,

      paddingHorizontal: 9,

      borderWidth: 1,

      borderColor:
        COLOURS.warning300,

      borderRadius: 5,
    },

    ownCacheNoticeText: {
      color:
        COLOURS.warning300,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 8.5,

      lineHeight: 13,

      fontWeight: '800',

      textAlign: 'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Right console                                                         */
    /* ---------------------------------------------------------------------- */

    consoleHeader: {
      minHeight: 50,

      flexDirection: 'row',

      alignItems: 'center',

      justifyContent: 'space-between',

      gap: 8,

      paddingBottom: 8,

      borderBottomWidth: 1,

      borderBottomColor:
        COLOURS.brass500,
    },

    consoleHeaderIdentity: {
      flex: 1,

      minWidth: 0,

      flexDirection: 'row',

      alignItems: 'center',

      gap: 7,
    },

    consoleHeaderText: {
      flex: 1,

      minWidth: 0,
    },

    consoleTitle: {
      color:
        COLOURS.parchment200,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 12,

      lineHeight: 18,

      fontWeight: '800',

      letterSpacing: 0.8,
    },

    consoleSubtitle: {
      marginTop: 1,

      color:
        COLOURS.brass400,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 7.5,

      lineHeight: 11,

      fontWeight: '700',

      letterSpacing: 0.4,
    },

    backButton: {
      width:
        MIN_TOUCH_TARGET,

      height:
        MIN_TOUCH_TARGET,

      justifyContent: 'center',

      alignItems: 'center',

      backgroundColor:
        COLOURS.forest950,

      borderWidth: 1,

      borderColor:
        COLOURS.brass500,

      borderRadius: 24,
    },

    consoleScroll: {
      flex: 1,

      minHeight: 0,
    },

    consoleScrollContent: {
      paddingTop: 10,

      paddingBottom: 8,
    },

    /* ---------------------------------------------------------------------- */
    /* Clue                                                                  */
    /* ---------------------------------------------------------------------- */

    clueCard: {
      backgroundColor:
        COLOURS.parchment100,

      borderRadius: 6,

      padding: 13,

      borderTopWidth: 4,

      borderTopColor:
        COLOURS.brass500,

      borderWidth: 1,

      borderColor:
        COLOURS.brass600,
    },

    clueCardHeader: {
      flexDirection: 'row',

      alignItems: 'center',

      gap: 8,
    },

    clueIconCircle: {
      width: 38,

      height: 38,

      flexShrink: 0,

      justifyContent: 'center',

      alignItems: 'center',

      backgroundColor:
        COLOURS.rust700,

      borderRadius: 19,
    },

    clueTitleGroup: {
      flex: 1,

      minWidth: 0,
    },

    clueTitle: {
      color:
        COLOURS.ink900,

      fontSize: 14,

      lineHeight: 20,

      fontWeight: '800',

      fontFamily:
        MONO_BOLD_FONT,

      textTransform:
        'uppercase',
    },

    clueReference: {
      marginTop: 1,

      color:
        COLOURS.brass700,

      fontSize: 8,

      lineHeight: 12,

      fontFamily:
        MONO_BOLD_FONT,

      letterSpacing: 0.45,
    },

    clueDivider: {
      height: 1,

      marginVertical: 9,

      backgroundColor:
        'rgba(33, 28, 24, 0.18)',
    },

    clueBody: {
      color:
        COLOURS.ink900,

      fontSize: 13,

      lineHeight: 20,

      fontStyle: 'italic',
    },

    clueAuthor: {
      color:
        COLOURS.ink700,

      fontSize: 10.5,

      lineHeight: 16,

      textAlign: 'right',

      marginTop: 8,

      fontFamily:
        MONO_FONT,
    },

    evidenceButton: {
      minHeight:
        MIN_TOUCH_TARGET,

      flexDirection: 'row',

      alignItems: 'center',

      gap: 7,

      marginTop: 11,

      paddingHorizontal: 4,

      paddingTop: 9,

      borderTopWidth: 1,

      borderColor:
        'rgba(33, 28, 24, 0.22)',
    },

    evidenceText: {
      flex: 1,

      color:
        COLOURS.ink900,

      fontSize: 9.5,

      lineHeight: 14,

      fontWeight: '800',

      fontFamily:
        MONO_BOLD_FONT,

      letterSpacing: 0.45,
    },

    /* ---------------------------------------------------------------------- */
    /* Diagnostics                                                           */
    /* ---------------------------------------------------------------------- */

    diagnosticsCard: {
      marginTop: 9,

      paddingHorizontal: 9,

      paddingVertical: 7,

      backgroundColor:
        COLOURS.forest950,

      borderWidth: 1,

      borderColor:
        COLOURS.forest700,

      borderRadius: 5,
    },

    diagnosticsTitle: {
      marginBottom: 4,

      color:
        COLOURS.brass400,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 8.5,

      lineHeight: 13,

      fontWeight: '800',

      letterSpacing: 0.45,
    },

    diagnosticRow: {
      minHeight: 31,

      flexDirection: 'row',

      alignItems: 'center',

      justifyContent: 'space-between',

      gap: 7,

      paddingVertical: 4,

      borderBottomWidth: 1,

      borderBottomColor:
        COLOURS.forest700,
    },

    diagnosticRowLast: {
      borderBottomWidth: 0,
    },

    diagnosticLabel: {
      flexShrink: 0,

      color:
        COLOURS.brass400,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 7.5,

      lineHeight: 11,

      fontWeight: '700',
    },

    diagnosticValue: {
      flex: 1,

      color:
        COLOURS.parchment200,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 8,

      lineHeight: 12,

      fontWeight: '800',

      textAlign: 'right',
    },

    diagnosticValueSuccess: {
      color:
        COLOURS.success300,
    },

    diagnosticValueWarning: {
      color:
        COLOURS.warning300,
    },

    /* ---------------------------------------------------------------------- */
    /* Excavation                                                            */
    /* ---------------------------------------------------------------------- */

    excavationCard: {
      minHeight: 110,

      marginTop: 10,

      backgroundColor:
        COLOURS.rust700,

      borderRadius: 6,

      paddingHorizontal: 13,

      paddingVertical: 12,

      borderWidth: 2,

      borderColor:
        COLOURS.parchment200,

      borderStyle: 'dashed',

      justifyContent: 'center',
    },

    excavationCardReady: {
      backgroundColor:
        COLOURS.rust600,

      borderStyle: 'solid',

      borderColor:
        COLOURS.warning300,
    },

    excavationCardSuccess: {
      backgroundColor:
        COLOURS.success700,

      borderColor:
        COLOURS.success300,

      borderStyle: 'solid',
    },

    excavationCardDisabled: {
      backgroundColor:
        COLOURS.disabled,

      borderColor:
        COLOURS.disabledBorder,

      borderStyle: 'solid',
    },

    excavationHeader: {
      flexDirection: 'row',

      alignItems: 'center',

      gap: 7,

      marginBottom: 6,
    },

    excavationTitle: {
      flex: 1,

      color:
        COLOURS.white,

      fontWeight: '800',

      fontSize: 12,

      lineHeight: 18,

      letterSpacing: 0.65,

      fontFamily:
        MONO_BOLD_FONT,
    },

    excavationDescription: {
      color:
        COLOURS.parchment100,

      fontSize: 10.5,

      lineHeight: 16,

      fontFamily:
        MONO_FONT,
    },

    readyPrompt: {
      marginTop: 9,

      flexDirection: 'row',

      alignItems: 'center',

      gap: 7,
    },

    readyPromptLine: {
      flex: 1,

      height: 1,

      backgroundColor:
        'rgba(255, 255, 255, 0.48)',
    },

    readyPromptText: {
      color:
        COLOURS.white,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 8.5,

      lineHeight: 13,

      fontWeight: '800',

      letterSpacing: 0.6,
    },

    motionPermissionButton: {
      minHeight:
        MIN_TOUCH_TARGET,

      marginTop: 8,

      flexDirection: 'row',

      alignItems: 'center',

      gap: 7,

      paddingHorizontal: 10,

      paddingVertical: 7,

      backgroundColor:
        COLOURS.parchment200,

      borderWidth: 1,

      borderColor:
        COLOURS.brass600,

      borderRadius: 5,
    },

    motionPermissionTextGroup: {
      flex: 1,

      minWidth: 0,
    },

    motionPermissionTitle: {
      color:
        COLOURS.ink900,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 8.5,

      lineHeight: 13,

      fontWeight: '800',
    },

    motionPermissionDescription: {
      marginTop: 1,

      color:
        COLOURS.ink700,

      fontSize: 8,

      lineHeight: 12,
    },

    abandonButton: {
      minHeight:
        MIN_TOUCH_TARGET,

      marginTop: 8,

      flexDirection: 'row',

      alignItems: 'center',

      justifyContent: 'center',

      gap: 6,

      paddingHorizontal: 10,

      borderWidth: 1,

      borderColor:
        COLOURS.brass600,

      borderRadius: 5,
    },

    abandonText: {
      color:
        COLOURS.brass400,

      fontSize: 9,

      lineHeight: 14,

      fontWeight: '800',

      letterSpacing: 0.55,

      fontFamily:
        MONO_BOLD_FONT,
    },

    /* ---------------------------------------------------------------------- */
    /* General controls                                                      */
    /* ---------------------------------------------------------------------- */

    primaryTextButton: {
      minHeight: 50,

      minWidth: 190,

      flexDirection: 'row',

      gap: 7,

      backgroundColor:
        COLOURS.rust700,

      paddingVertical: 11,

      paddingHorizontal: 16,

      borderRadius: 6,

      borderWidth: 1,

      borderColor:
        COLOURS.parchment200,

      justifyContent: 'center',

      alignItems: 'center',
    },

    primaryTextButtonText: {
      color:
        COLOURS.white,

      fontFamily:
        MONO_BOLD_FONT,

      fontWeight: '800',

      fontSize: 10,

      lineHeight: 15,

      letterSpacing: 0.6,

      textAlign: 'center',
    },

    secondaryTextButton: {
      minHeight: 50,

      minWidth: 190,

      marginTop: 2,

      flexDirection: 'row',

      gap: 7,

      paddingVertical: 11,

      paddingHorizontal: 16,

      borderRadius: 6,

      borderWidth: 1,

      borderColor:
        COLOURS.brass500,

      justifyContent: 'center',

      alignItems: 'center',
    },

    secondaryTextButtonText: {
      color:
        COLOURS.parchment200,

      fontFamily:
        MONO_BOLD_FONT,

      fontWeight: '800',

      fontSize: 10,

      lineHeight: 15,

      letterSpacing: 0.6,

      textAlign: 'center',
    },

    disabledControl: {
      opacity: 0.48,
    },

    pressedControl: {
      opacity: 0.78,

      transform: [
        {
          scale: 0.985,
        },
      ],
    },

    pressedLightControl: {
      opacity: 0.66,
    },

    /* ---------------------------------------------------------------------- */
    /* Photo modal                                                           */
    /* ---------------------------------------------------------------------- */

    modalOverlay: {
      flex: 1,

      backgroundColor:
        COLOURS.overlay,

      justifyContent: 'center',

      alignItems: 'center',

      padding: 20,
    },

    modalContent: {
      width: '100%',

      maxWidth: 600,

      maxHeight: '92%',

      padding: 15,

      backgroundColor:
        COLOURS.forest800,

      borderRadius: 8,

      borderWidth: 2,

      borderColor:
        COLOURS.brass500,
    },

    modalHeader: {
      minHeight:
        MIN_TOUCH_TARGET,

      flexDirection: 'row',

      alignItems: 'center',

      justifyContent: 'space-between',

      gap: 8,

      marginBottom: 10,
    },

    modalHeaderIdentity: {
      flex: 1,

      minWidth: 0,

      flexDirection: 'row',

      alignItems: 'center',

      gap: 7,
    },

    modalTitle: {
      color:
        COLOURS.parchment200,

      fontFamily:
        MONO_BOLD_FONT,

      fontWeight: '800',

      fontSize: 14,

      lineHeight: 20,

      letterSpacing: 0.7,
    },

    modalCloseIconButton: {
      width:
        MIN_TOUCH_TARGET,

      height:
        MIN_TOUCH_TARGET,

      justifyContent: 'center',

      alignItems: 'center',

      borderWidth: 1,

      borderColor:
        COLOURS.brass500,

      borderRadius: 24,
    },

    fullEvidenceImage: {
      width: '100%',

      height: 320,

      borderRadius: 6,

      marginBottom: 14,

      backgroundColor:
        COLOURS.forest950,
    },

    imageFallback: {
      width: '100%',

      height: 220,

      borderRadius: 6,

      borderWidth: 1,

      borderColor:
        COLOURS.brass500,

      backgroundColor:
        COLOURS.forest950,

      justifyContent: 'center',

      alignItems: 'center',

      gap: 8,

      marginBottom: 14,

      padding: 20,
    },

    imageFallbackText: {
      color:
        COLOURS.danger300,

      fontFamily:
        MONO_BOLD_FONT,

      fontSize: 12,

      lineHeight: 18,

      fontWeight: '800',

      textAlign: 'center',
    },
  });
