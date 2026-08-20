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
  Image,
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
import { Accelerometer, Magnetometer } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Line,
  Path,
  Polygon,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import { auth, db } from '../config/firebase';
import type { TreasureDocument, UserDocument } from '../types/firestore';

const DISCOVERY_RADIUS_METRES = 5;
const MAX_ACCEPTABLE_GPS_ACCURACY_METRES = 20;
const SHAKE_COOLDOWN_MS = 2_000;
const DEFAULT_SHAKE_THRESHOLD = 2.4;
const SENSITIVE_SHAKE_THRESHOLD = 2.0;
const SENSOR_UPDATE_INTERVAL_MS = 75;

const COLORS = {
  forestDeep: '#2C3B2E',
  forestDarker: '#151C16',
  parchment: '#F4E8CA',
  parchment2: '#FFF8E8',
  sienna: '#8A3D24',
  brass: '#D8B875',
  brassDark: '#6C542C',
  ink: '#211C18',
  inkSoft: '#514A40',
  white: '#FFFFFF',
  warning: '#FFD166',
  danger: '#FFB4A2',
  success: '#BFE3C0',
  disabled: '#4F5750',
  disabledBorder: '#9AA09B',
  overlay: 'rgba(0, 0, 0, 0.88)',
} as const;

const MONO_FONT = Platform.select({
  ios: 'Courier',
  android: 'monospace',
  default: 'monospace',
});

type GpsStatus =
  | 'INITIALIZING'
  | 'OK'
  | 'DENIED'
  | 'UNAVAILABLE'
  | 'LOW_ACCURACY'
  | 'ERROR';

interface NavigationLike {
  canGoBack: () => boolean;
  goBack: () => void;
}

interface HuntScreenProps {
  route?: { params?: { treasureId?: string } };
  treasureId?: string;
  onBack?: () => void;
  onSuccess?: () => void;
  navigation?: NavigationLike;
}

interface LatLng {
  latitude: number;
  longitude: number;
}

function getDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusMetres = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMetres * c;
}

function getBearingInDegrees(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): number {
  const fromLatRad = (fromLat * Math.PI) / 180;
  const toLatRad = (toLat * Math.PI) / 180;
  const dLonRad = ((toLon - fromLon) * Math.PI) / 180;

  const y = Math.sin(dLonRad) * Math.cos(toLatRad);
  const x =
    Math.cos(fromLatRad) * Math.sin(toLatRad) -
    Math.sin(fromLatRad) * Math.cos(toLatRad) * Math.cos(dLonRad);

  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

function normaliseDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function shortestAngleDelta(fromDegrees: number, toDegrees: number): number {
  return ((toDegrees - fromDegrees + 540) % 360) - 180;
}

function getCardinalDirection(degrees: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(normaliseDegrees(degrees) / 45) % directions.length;
  return directions[index];
}

function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}

function showAccessibleAlert(title: string, message: string): void {
  announce(`${title}. ${message}`);
  Alert.alert(title, message);
}

const OdometerDigit: React.FC<{ char: string }> = ({ char }) => {
  if (char === ' ') {
    return <View style={styles.odometerSpacer} />;
  }

  return (
    <View
      style={styles.odometerBox}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.odometerSplitLine} />
      <Text style={styles.odometerText}>{char}</Text>
    </View>
  );
};

const OdometerDisplay: React.FC<{ value: string }> = ({ value }) => (
  <View
    style={styles.odometerContainer}
    accessible
    accessibilityRole="text"
    accessibilityLabel={`Distance to target: ${value}`}
  >
    {value.split('').map((char, index) => (
      <OdometerDigit key={`${char}-${index}`} char={char} />
    ))}
  </View>
);

interface CompassDialProps {
  targetRotation: SharedValue<number>;
  size?: number;
  hasTargetBearing: boolean;
  accessibilityLabel: string;
}

const CompassDialView: React.FC<CompassDialProps> = ({
  targetRotation,
  size = 220,
  hasTargetBearing,
  accessibilityLabel,
}) => {
  const animatedTargetNeedleStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${targetRotation.value}deg` }],
  }));

  const directions = [
    { label: 'N', angle: 0 },
    { label: 'E', angle: 90 },
    { label: 'S', angle: 180 },
    { label: 'W', angle: 270 },
  ];

  const innerSize = size - 24;

  return (
    <View
      style={[
        styles.compassRim,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <View
        style={[
          styles.compassFace,
          {
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
          },
        ]}
        importantForAccessibility="no-hide-descendants"
      >
        <Svg viewBox="0 0 200 200" style={StyleSheet.absoluteFill}>
          {Array.from({ length: 72 }).map((_, index) => {
            const angleRad = (index * 5 * Math.PI) / 180;
            const isMajor = index % 6 === 0;
            const innerRadius = isMajor ? 78 : 84;
            const outerRadius = 90;

            return (
              <Line
                key={index}
                x1={100 + innerRadius * Math.sin(angleRad)}
                y1={100 - innerRadius * Math.cos(angleRad)}
                x2={100 + outerRadius * Math.sin(angleRad)}
                y2={100 - outerRadius * Math.cos(angleRad)}
                stroke={COLORS.brass}
                strokeWidth={isMajor ? 1.5 : 0.7}
                opacity={isMajor ? 0.95 : 0.55}
              />
            );
          })}

          {directions.map((direction) => {
            const angleRad = (direction.angle * Math.PI) / 180;
            return (
              <SvgText
                key={direction.label}
                x={100 + 62 * Math.sin(angleRad)}
                y={100 - 62 * Math.cos(angleRad) + 5}
                textAnchor="middle"
                fill={COLORS.parchment}
                fontSize="15"
                fontWeight="bold"
                fontFamily="Courier"
              >
                {direction.label}
              </SvgText>
            );
          })}
        </Svg>

        <Animated.View
          style={[
            styles.targetNeedleWrapper,
            { opacity: hasTargetBearing ? 1 : 0.28 },
            animatedTargetNeedleStyle,
          ]}
        >
          <Svg width="24" height={size * 0.64} viewBox="0 0 24 160">
            <Polygon points="12,4 4,82 20,82" fill={COLORS.sienna} />
            <Polygon points="12,156 7,82 17,82" fill={COLORS.parchment} opacity={0.7} />
          </Svg>
        </Animated.View>

        <View style={styles.compassCap} />
      </View>
    </View>
  );
};

export const HuntScreen: React.FC<HuntScreenProps> = ({
  route,
  treasureId,
  onBack,
  onSuccess,
  navigation,
}) => {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const targetTreasureId = treasureId ?? route?.params?.treasureId;

  const [treasure, setTreasure] = useState<TreasureDocument | null>(null);
  const [userProfile, setUserProfile] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const [distance, setDistance] = useState<number | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('INITIALIZING');
  const [targetBearing, setTargetBearing] = useState<number | null>(null);
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);

  const [isExcavated, setIsExcavated] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [compassAvailable, setCompassAvailable] = useState<boolean | null>(null);
  const [accelerometerAvailable, setAccelerometerAvailable] = useState<boolean | null>(null);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);

  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

  const isMountedRef = useRef(true);
  const lastShakeTimeRef = useRef(0);
  const targetBearingRef = useRef<number | null>(null);
  const continuousTargetRotationRef = useRef(0);
  const lastHeadingAnnouncementUpdateRef = useRef(0);

  const targetRotationShared = useSharedValue(0);

  const handleBackNavigation = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }

    if (navigation?.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation, onBack]);

  const setTargetNeedleAngle = useCallback(
    (relativeAngleDegrees: number) => {
      const currentContinuous = continuousTargetRotationRef.current;
      const currentNormalised = normaliseDegrees(currentContinuous);
      const nextNormalised = normaliseDegrees(relativeAngleDegrees);
      const nextContinuous =
        currentContinuous + shortestAngleDelta(currentNormalised, nextNormalised);

      continuousTargetRotationRef.current = nextContinuous;

      if (reduceMotionEnabled) {
        targetRotationShared.value = nextContinuous;
      } else {
        targetRotationShared.value = withSpring(nextContinuous, {
          damping: 18,
          stiffness: 110,
          mass: 0.75,
        });
      }
    },
    [reduceMotionEnabled, targetRotationShared],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let accessibilitySubscription: { remove: () => void } | undefined;

    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (isMountedRef.current) {
        setReduceMotionEnabled(enabled);
      }
    });

    accessibilitySubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        if (isMountedRef.current) {
          setReduceMotionEnabled(enabled);
        }
      },
    );

    return () => {
      accessibilitySubscription?.remove();
    };
  }, []);

  // 1. Load the authenticated explorer, target treasure, and prior discovery state.
  useEffect(() => {
    if (!targetTreasureId) {
      setLoading(false);
      setFatalError('Treasure target unavailable. No target ID was specified.');
      return;
    }

    let cancelled = false;

    const fetchInitialData = async (): Promise<void> => {
      setLoading(true);
      setFatalError(null);

      try {
        const currentUser = auth.currentUser;

        if (!currentUser) {
          if (!cancelled) {
            setFatalError('Your session has expired. Sign in again before starting a hunt.');
          }
          return;
        }

        const userRef = doc(db, 'users', currentUser.uid);
        const treasureRef = doc(db, 'treasures', targetTreasureId);
        const discoveryRef = doc(
          db,
          'discoveries',
          `${currentUser.uid}_${targetTreasureId}`,
        );

        const [userSnapshot, treasureSnapshot, discoverySnapshot] = await Promise.all([
          getDoc(userRef),
          getDoc(treasureRef),
          getDoc(discoveryRef),
        ]);

        if (cancelled) return;

        if (userSnapshot.exists()) {
          setUserProfile(userSnapshot.data() as UserDocument);
        }

        if (!treasureSnapshot.exists()) {
          setFatalError('This treasure cache no longer exists or is unavailable.');
          return;
        }

        const treasureData = {
          treasureId: treasureSnapshot.id,
          ...treasureSnapshot.data(),
        } as TreasureDocument;

        setTreasure(treasureData);
        setIsArchived(Boolean(treasureData.isArchived));
        setIsExcavated(discoverySnapshot.exists());
      } catch (error: unknown) {
        console.error('[Treasi] Failed to initialise hunt:', error);
        if (!cancelled) {
          setFatalError('Treasi could not synchronise this hunt. Check your connection and try again.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchInitialData();

    return () => {
      cancelled = true;
    };
  }, [targetTreasureId]);

  // 2. Stream location updates and calculate an accurate distance and bearing to the target.
  useEffect(() => {
    if (!treasure?.location || isArchived) {
      return;
    }

    let cancelled = false;
    let locationSubscription: Location.LocationSubscription | null = null;

    const startLocationTracking = async (): Promise<void> => {
      setGpsStatus('INITIALIZING');

      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (cancelled) return;

        if (permission.status !== 'granted') {
          setGpsStatus('DENIED');
          announce('GPS permission denied. Location access is required to verify a treasure excavation.');
          return;
        }

        const servicesEnabled = await Location.hasServicesEnabledAsync();

        if (cancelled) return;

        if (!servicesEnabled) {
          setGpsStatus('UNAVAILABLE');
          announce('Location services are disabled. Enable location services to continue the hunt.');
          return;
        }

        locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1_000,
            distanceInterval: 1,
          },
          (location) => {
            if (cancelled || !isMountedRef.current || !treasure.location) return;

            const current: LatLng = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            };
            const accuracy = location.coords.accuracy ?? Number.POSITIVE_INFINITY;
            setGpsAccuracy(Number.isFinite(accuracy) ? accuracy : null);

            if (!Number.isFinite(accuracy)) {
              setGpsStatus('LOW_ACCURACY');
            } else if (accuracy > MAX_ACCEPTABLE_GPS_ACCURACY_METRES) {
              setGpsStatus('LOW_ACCURACY');
            } else {
              setGpsStatus('OK');
            }

            const nextDistance = getDistanceInMeters(
              current.latitude,
              current.longitude,
              treasure.location.latitude,
              treasure.location.longitude,
            );

            const nextBearing = getBearingInDegrees(
              current.latitude,
              current.longitude,
              treasure.location.latitude,
              treasure.location.longitude,
            );

            setDistance(nextDistance);
            setTargetBearing(nextBearing);
            targetBearingRef.current = nextBearing;
          },
        );
      } catch (error: unknown) {
        console.error('[Treasi] Location tracking failed:', error);
        if (!cancelled && isMountedRef.current) {
          setGpsStatus('ERROR');
          announce('Treasi could not start location tracking.');
        }
      }
    };

    void startLocationTracking();

    return () => {
      cancelled = true;
      locationSubscription?.remove();
    };
  }, [isArchived, treasure]);

  // 3. Magnetometer stream. The target needle points toward the treasure relative to the device.
  useEffect(() => {
    let cancelled = false;
    let subscription: ReturnType<typeof Magnetometer.addListener> | null = null;
    let previousX = 0;
    let previousY = 0;
    const smoothingAlpha = 0.18;

    const initialiseCompass = async (): Promise<void> => {
      try {
        const available = await Magnetometer.isAvailableAsync();

        if (cancelled || !isMountedRef.current) return;

        setCompassAvailable(available);
        if (!available) return;

        Magnetometer.setUpdateInterval(SENSOR_UPDATE_INTERVAL_MS);

        subscription = Magnetometer.addListener((data) => {
          if (cancelled || !isMountedRef.current) return;
          if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;

          const filteredX = smoothingAlpha * data.x + (1 - smoothingAlpha) * previousX;
          const filteredY = smoothingAlpha * data.y + (1 - smoothingAlpha) * previousY;
          previousX = filteredX;
          previousY = filteredY;

          // Treasi is landscape-first. The +90° offset aligns the magnetometer plane
          // with the landscape dashboard used throughout the experience.
          const rawHeading = Math.atan2(filteredY, filteredX) * (180 / Math.PI);
          const landscapeOffset = isLandscape ? 90 : 0;
          const heading = normaliseDegrees(rawHeading + landscapeOffset);

          const now = Date.now();
          if (now - lastHeadingAnnouncementUpdateRef.current >= 500) {
            lastHeadingAnnouncementUpdateRef.current = now;
            setDeviceHeading(heading);
          }

          const bearing = targetBearingRef.current;
          if (bearing !== null) {
            setTargetNeedleAngle(normaliseDegrees(bearing - heading));
          }
        });
      } catch (error: unknown) {
        console.error('[Treasi] Magnetometer unavailable:', error);
        if (!cancelled && isMountedRef.current) {
          setCompassAvailable(false);
        }
      }
    };

    void initialiseCompass();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [isLandscape, setTargetNeedleAngle]);

  // 4. Check accelerometer availability once. The actual shake listener is only active
  // when excavation is permitted, which reduces unnecessary battery usage.
  useEffect(() => {
    let cancelled = false;

    void Accelerometer.isAvailableAsync()
      .then((available) => {
        if (!cancelled && isMountedRef.current) {
          setAccelerometerAvailable(available);
        }
      })
      .catch((error: unknown) => {
        console.error('[Treasi] Accelerometer availability check failed:', error);
        if (!cancelled && isMountedRef.current) {
          setAccelerometerAvailable(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const canExcavate =
    !isArchived &&
    !isExcavated &&
    !isSubmitting &&
    gpsStatus === 'OK' &&
    distance !== null &&
    distance <= DISCOVERY_RADIUS_METRES;

  const excavationStatusText = useMemo(() => {
    if (isArchived) {
      return 'This treasure has been archived and can no longer be excavated.';
    }

    if (isExcavated) {
      return 'Excavation recorded. The treasure payload is unlocked.';
    }

    if (isSubmitting) {
      return 'Transmitting your excavation to the field log.';
    }

    if (gpsStatus === 'INITIALIZING') {
      return 'Acquiring a precise GPS position.';
    }

    if (gpsStatus === 'DENIED') {
      return 'GPS permission is required before excavation.';
    }

    if (gpsStatus === 'UNAVAILABLE') {
      return 'Location services are disabled.';
    }

    if (gpsStatus === 'ERROR') {
      return 'Location tracking is currently unavailable.';
    }

    if (gpsStatus === 'LOW_ACCURACY') {
      const accuracyText = gpsAccuracy !== null ? ` Current accuracy is approximately ${Math.round(gpsAccuracy)} metres.` : '';
      return `GPS accuracy is not precise enough to dig.${accuracyText}`;
    }

    if (distance === null) {
      return 'Waiting for your distance to the target.';
    }

    if (distance > DISCOVERY_RADIUS_METRES) {
      return `Target is ${Math.round(distance)} metres away. Move within ${DISCOVERY_RADIUS_METRES} metres to excavate.`;
    }

    return accelerometerAvailable === false
      ? 'Dig site detected. Tap the excavation control to unlock the treasure.'
      : 'Dig site detected. Shake the device or tap the excavation control to unlock the treasure.';
  }, [
    accelerometerAvailable,
    distance,
    gpsAccuracy,
    gpsStatus,
    isArchived,
    isExcavated,
    isSubmitting,
  ]);

  // 5. Atomic excavation transaction. The points total is read and updated inside the
  // transaction so concurrent discoveries cannot overwrite each other.
  const executeExcavation = useCallback(async (): Promise<void> => {
    if (isSubmitting || isArchived || isExcavated) return;

    const currentUser = auth.currentUser;

    if (!currentUser) {
      showAccessibleAlert('Session Expired', 'Sign in again before recording this discovery.');
      return;
    }

    if (!treasure || !targetTreasureId) {
      showAccessibleAlert('Target Unavailable', 'Treasi cannot verify the current treasure target.');
      return;
    }

    if (gpsStatus === 'DENIED') {
      showAccessibleAlert('GPS Permission Required', 'Allow location access before excavating this treasure.');
      return;
    }

    if (gpsStatus === 'UNAVAILABLE') {
      showAccessibleAlert('Location Services Disabled', 'Enable location services before excavating this treasure.');
      return;
    }

    if (gpsStatus === 'ERROR' || gpsStatus === 'INITIALIZING') {
      showAccessibleAlert('GPS Not Ready', 'Wait for Treasi to acquire a verified location before digging.');
      return;
    }

    if (gpsStatus === 'LOW_ACCURACY') {
      showAccessibleAlert(
        'GPS Signal Weak',
        `Wait until location accuracy improves to within ${MAX_ACCEPTABLE_GPS_ACCURACY_METRES} metres before digging.`,
      );
      return;
    }

    if (distance === null) {
      showAccessibleAlert('Distance Unavailable', 'Treasi is still calculating your distance to the target.');
      return;
    }

    if (distance > DISCOVERY_RADIUS_METRES) {
      showAccessibleAlert(
        'Out of Range',
        `Target is ${Math.round(distance)} metres away. Move within ${DISCOVERY_RADIUS_METRES} metres to dig.`,
      );
      return;
    }

    setIsSubmitting(true);
    announce('Excavation started. Transmitting discovery.');

    try {
      const userId = currentUser.uid;
      const userName = currentUser.displayName || userProfile?.username || 'Explorer';
      const discoveryRef = doc(db, 'discoveries', `${userId}_${targetTreasureId}`);
      const userRef = doc(db, 'users', userId);
      const activityRef = doc(collection(db, 'activity_feed'));

      const updatedPoints = await runTransaction(db, async (transaction) => {
        // Firestore transactions require all reads before writes.
        const discoverySnapshot = await transaction.get(discoveryRef);
        const userSnapshot = await transaction.get(userRef);

        if (discoverySnapshot.exists()) {
          throw new Error('ALREADY_EXCAVATED');
        }

        const currentPoints = userSnapshot.exists()
          ? Number(userSnapshot.data().totalPoints ?? 0)
          : 0;
        const nextPoints = currentPoints + 100;

        transaction.set(discoveryRef, {
          discoveryId: `${userId}_${targetTreasureId}`,
          treasureId: targetTreasureId,
          hunterId: userId,
          unlockedAt: serverTimestamp(),
        });

        if (userSnapshot.exists()) {
          transaction.update(userRef, {
            totalPoints: nextPoints,
            updatedAt: serverTimestamp(),
          });
        } else {
          transaction.set(userRef, {
            uid: userId,
            username: userName,
            email: currentUser.email ?? '',
            totalPoints: nextPoints,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        transaction.set(activityRef, {
          userId,
          username: userName,
          type: 'TREASURE_FOUND',
          message: `Excavated "${treasure.title}"`,
          targetId: targetTreasureId,
          createdAt: serverTimestamp(),
        });

        return nextPoints;
      });

      if (!isMountedRef.current) return;

      setUserProfile((previous) =>
        previous
          ? ({ ...previous, totalPoints: updatedPoints } as UserDocument)
          : previous,
      );
      setIsExcavated(true);

      if (userProfile?.hapticFeedbackEnabled !== false) {
        try {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (hapticError: unknown) {
          console.warn('[Treasi] Success haptic unavailable:', hapticError);
        }
      }

      announce(`Excavation complete. 100 points awarded. ${treasure.payloadText ?? 'Treasure unlocked.'}`);
      onSuccess?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';

      if (message === 'ALREADY_EXCAVATED') {
        if (isMountedRef.current) {
          setIsExcavated(true);
        }
        showAccessibleAlert('Already Excavated', 'This treasure discovery is already recorded for your account.');
      } else {
        console.error('[Treasi] Excavation transaction failed:', error);
        showAccessibleAlert('Excavation Failed', 'Treasi could not save this discovery. Check your connection and try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, [
    distance,
    gpsStatus,
    isArchived,
    isExcavated,
    isSubmitting,
    onSuccess,
    targetTreasureId,
    treasure,
    userProfile,
  ]);

  // 6. Kinetic excavation listener. It only runs when the user is actually eligible to dig.
  useEffect(() => {
    if (!canExcavate || accelerometerAvailable !== true) {
      return;
    }

    Accelerometer.setUpdateInterval(100);

    const shakeThreshold = userProfile?.motionSensitivityEnabled
      ? SENSITIVE_SHAKE_THRESHOLD
      : DEFAULT_SHAKE_THRESHOLD;

    const subscription = Accelerometer.addListener((data) => {
      if (!isMountedRef.current) return;

      const gForce = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
      const now = Date.now();

      if (
        gForce > shakeThreshold &&
        now - lastShakeTimeRef.current > SHAKE_COOLDOWN_MS
      ) {
        lastShakeTimeRef.current = now;
        void executeExcavation();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [
    accelerometerAvailable,
    canExcavate,
    executeExcavation,
    userProfile?.motionSensitivityEnabled,
  ]);

  const formattedDistance =
    distance !== null ? `${String(Math.round(distance)).padStart(3, '0')} m` : '--- m';

  const targetDirectionText = useMemo(() => {
    if (targetBearing === null) return 'Target bearing unavailable';
    return `${Math.round(targetBearing)} degrees ${getCardinalDirection(targetBearing)}`;
  }, [targetBearing]);

  const compassAccessibilityLabel = useMemo(() => {
    const headingText =
      deviceHeading === null
        ? 'Device heading unavailable.'
        : `Device heading ${Math.round(deviceHeading)} degrees ${getCardinalDirection(deviceHeading)}.`;

    const bearingText =
      targetBearing === null
        ? 'Target bearing unavailable.'
        : `Target bearing ${Math.round(targetBearing)} degrees ${getCardinalDirection(targetBearing)}.`;

    return `Treasure direction compass. ${headingText} ${bearingText} Distance ${formattedDistance}.`;
  }, [deviceHeading, formattedDistance, targetBearing]);

  const compassSize = Math.max(
    176,
    Math.min(
      isLandscape ? windowHeight * 0.52 : windowWidth * 0.58,
      260,
    ),
  );

  const terminalActionDisabled = isSubmitting || isExcavated || isArchived;

  if (loading) {
    return (
      <View
        style={[
          styles.container,
          styles.centerContent,
          {
            paddingTop: Math.max(insets.top, 20),
            paddingBottom: Math.max(insets.bottom, 20),
            paddingLeft: Math.max(insets.left, 20),
            paddingRight: Math.max(insets.right, 20),
          },
        ]}
        accessible
        accessibilityLabel="Loading hunt. Calibrating telemetry sensors."
      >
        <ActivityIndicator size="large" color={COLORS.brass} />
        <Text style={styles.loadingText}>CALIBRATING TELEMETRY SENSORS…</Text>
      </View>
    );
  }

  if (fatalError || !targetTreasureId) {
    return (
      <View
        style={[
          styles.container,
          styles.centerContent,
          {
            paddingTop: Math.max(insets.top, 20),
            paddingBottom: Math.max(insets.bottom, 20),
            paddingLeft: Math.max(insets.left, 20),
            paddingRight: Math.max(insets.right, 20),
          },
        ]}
      >
        <Text style={styles.errorTitle} accessibilityRole="header">
          TELEMETRY ERROR
        </Text>
        <Text
          style={styles.errorSub}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {fatalError ?? 'Treasure target unavailable.'}
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.primaryTextButton,
            pressed && styles.pressedControl,
          ]}
          onPress={handleBackNavigation}
          accessibilityRole="button"
          accessibilityLabel="Return to dashboard"
          accessibilityHint="Leaves the hunt screen"
          hitSlop={8}
        >
          <Text style={styles.primaryTextButtonText}>RETURN TO DASHBOARD</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: Math.max(insets.left, 8),
          paddingRight: Math.max(insets.right, 8),
        },
      ]}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            minHeight: Math.max(0, windowHeight - insets.top - insets.bottom),
          },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View
          style={[
            styles.splitWrapper,
            { flexDirection: isLandscape ? 'row' : 'column' },
          ]}
        >
          <View
            style={[
              styles.leftViewport,
              isLandscape ? styles.leftViewportLandscape : styles.leftViewportPortrait,
            ]}
          >
            {compassAvailable === null ? (
              <View
                style={[
                  styles.sensorFallbackBox,
                  { width: compassSize, height: compassSize, borderRadius: compassSize / 2 },
                ]}
                accessible
                accessibilityLabel="Checking compass sensor"
              >
                <ActivityIndicator color={COLORS.brass} />
                <Text style={styles.fallbackText}>CHECKING COMPASS…</Text>
              </View>
            ) : compassAvailable ? (
              <CompassDialView
                targetRotation={targetRotationShared}
                size={compassSize}
                hasTargetBearing={targetBearing !== null}
                accessibilityLabel={compassAccessibilityLabel}
              />
            ) : (
              <View
                style={[
                  styles.sensorFallbackBox,
                  { width: compassSize, height: compassSize, borderRadius: compassSize / 2 },
                ]}
                accessible
                accessibilityRole="alert"
                accessibilityLabel="Compass hardware unavailable. Use the distance readout to approach the target."
              >
                <Text style={styles.fallbackText}>COMPASS HARDWARE UNAVAILABLE</Text>
              </View>
            )}

            <View style={styles.telemetryGroup}>
              <OdometerDisplay value={formattedDistance} />
              <Text style={styles.targetSubtext}>TO TARGET · {DISCOVERY_RADIUS_METRES}M DIG RADIUS</Text>
              <Text style={styles.bearingText}>{targetDirectionText}</Text>

              <View
                style={styles.gpsStatusArea}
                accessible
                accessibilityRole="text"
                accessibilityLiveRegion="polite"
                accessibilityLabel={excavationStatusText}
              >
                {gpsStatus === 'INITIALIZING' ? (
                  <Text style={styles.statusText}>ACQUIRING GPS POSITION…</Text>
                ) : null}
                {gpsStatus === 'LOW_ACCURACY' ? (
                  <Text style={styles.warningText}>
                    GPS ACCURACY {gpsAccuracy !== null ? `±${Math.round(gpsAccuracy)}M` : 'LOW'} · WAIT TO DIG
                  </Text>
                ) : null}
                {gpsStatus === 'DENIED' ? (
                  <Text style={styles.dangerText}>GPS PERMISSION DENIED</Text>
                ) : null}
                {gpsStatus === 'UNAVAILABLE' ? (
                  <Text style={styles.dangerText}>LOCATION SERVICES DISABLED</Text>
                ) : null}
                {gpsStatus === 'ERROR' ? (
                  <Text style={styles.dangerText}>GPS TRACKING ERROR</Text>
                ) : null}
                {gpsStatus === 'OK' && distance !== null ? (
                  <Text style={canExcavate ? styles.successText : styles.statusText}>
                    {canExcavate ? 'DIG RANGE VERIFIED' : 'APPROACH TARGET'}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          <View
            style={[
              styles.rightViewport,
              isLandscape ? styles.rightViewportLandscape : styles.rightViewportPortrait,
            ]}
          >
            <View style={styles.clueSection}>
              <View style={styles.sectionHeaderRow}>
                <View
                  style={styles.starIconBox}
                  importantForAccessibility="no-hide-descendants"
                >
                  <Svg width="14" height="14" viewBox="0 0 24 24" fill={COLORS.sienna}>
                    <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </Svg>
                </View>
                <Text style={styles.sectionTitle} accessibilityRole="header">
                  CLUE SLATE
                </Text>
                <View style={styles.headerLine} />
              </View>

              <View style={styles.clueCard}>
                <Text style={styles.clueTitle}>{treasure?.title || 'UNKNOWN CACHE'}</Text>
                <Text style={styles.clueBody}>“{treasure?.hint || 'No clue provided.'}”</Text>
                <Text style={styles.clueAuthor}>
                  — left by {treasure?.creatorName || 'Explorer'}
                </Text>

                {treasure?.imageUrl ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.evidenceButton,
                      pressed && styles.pressedLightControl,
                    ]}
                    onPress={() => {
                      setImageLoadFailed(false);
                      setImageModalVisible(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Inspect field photo"
                    accessibilityHint="Opens the treasure's photo evidence in a larger view"
                    hitSlop={6}
                  >
                    <View importantForAccessibility="no-hide-descendants">
                      <Svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={COLORS.ink}
                        strokeWidth="2"
                      >
                        <Rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <Circle cx="8.5" cy="8.5" r="1.5" />
                        <Polygon points="21 15 16 10 5 21" />
                      </Svg>
                    </View>
                    <Text style={styles.evidenceText}>INSPECT FIELD PHOTO</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={styles.actionContainer}>
              <Pressable
                onPress={() => void executeExcavation()}
                disabled={terminalActionDisabled}
                accessibilityRole="button"
                accessibilityLabel={
                  isArchived
                    ? 'Cache archived'
                    : isExcavated
                      ? 'Excavation complete'
                      : isSubmitting
                        ? 'Excavation transmitting'
                        : canExcavate
                          ? 'Excavate treasure'
                          : 'Check excavation readiness'
                }
                accessibilityHint={excavationStatusText}
                accessibilityState={{
                  disabled: terminalActionDisabled,
                  busy: isSubmitting,
                }}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.alertCard,
                  isExcavated && styles.alertCardSuccess,
                  isArchived && styles.alertCardDisabled,
                  pressed && !terminalActionDisabled && styles.pressedControl,
                ]}
              >
                <View style={styles.alertHeaderRow}>
                  <View importantForAccessibility="no-hide-descendants">
                    <Svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={COLORS.white}
                      strokeWidth="2"
                    >
                      <Path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <Line x1="12" y1="9" x2="12" y2="13" />
                      <Line x1="12" y1="17" x2="12.01" y2="17" />
                    </Svg>
                  </View>
                  <Text style={styles.alertTitle}>
                    {isSubmitting
                      ? 'TRANSMITTING SIGNAL…'
                      : isArchived
                        ? 'CACHE ARCHIVED'
                        : isExcavated
                          ? 'EXCAVATION COMPLETE'
                          : canExcavate
                            ? 'DIG SITE DETECTED'
                            : 'APPROACH TARGET'}
                  </Text>
                </View>

                <Text style={styles.alertSub} accessibilityLiveRegion="polite">
                  {isExcavated
                    ? `PAYLOAD: ${treasure?.payloadText || 'CACHE UNLOCKED (+100 PTS)'}`
                    : excavationStatusText}
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.abandonButton,
                  pressed && styles.pressedControl,
                ]}
                onPress={handleBackNavigation}
                accessibilityRole="button"
                accessibilityLabel="Abandon hunt"
                accessibilityHint="Returns to the previous screen without recording a discovery"
                hitSlop={8}
              >
                <Text style={styles.abandonText}>ABANDON HUNT ▸</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      {treasure?.imageUrl ? (
        <Modal
          visible={imageModalVisible}
          transparent
          animationType={reduceMotionEnabled ? 'none' : 'fade'}
          onRequestClose={() => setImageModalVisible(false)}
          statusBarTranslucent
        >
          <View
            style={styles.modalOverlay}
            accessibilityViewIsModal
            accessibilityLabel="Field photo viewer"
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle} accessibilityRole="header">
                FIELD PHOTO
              </Text>

              {imageLoadFailed ? (
                <View
                  style={styles.imageFallback}
                  accessible
                  accessibilityRole="alert"
                  accessibilityLabel="Field photo could not be loaded"
                >
                  <Text style={styles.imageFallbackText}>PHOTO UNAVAILABLE</Text>
                </View>
              ) : (
                <Image
                  source={{ uri: treasure.imageUrl }}
                  style={styles.fullEvidenceImage}
                  resizeMode="contain"
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={`Field photo for ${treasure.title || 'this treasure'}`}
                  onError={() => setImageLoadFailed(true)}
                />
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.primaryTextButton,
                  pressed && styles.pressedControl,
                ]}
                onPress={() => setImageModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close field photo"
                hitSlop={8}
              >
                <Text style={styles.primaryTextButtonText}>CLOSE PHOTO</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
};

export default HuntScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.forestDarker,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.parchment,
    fontFamily: MONO_FONT,
    marginTop: 14,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  errorTitle: {
    color: COLORS.danger,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    fontSize: 18,
    lineHeight: 24,
    marginBottom: 10,
    textAlign: 'center',
  },
  errorSub: {
    color: COLORS.parchment,
    fontFamily: MONO_FONT,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 20,
    maxWidth: 520,
  },
  splitWrapper: {
    flexGrow: 1,
    width: '100%',
  },
  leftViewport: {
    backgroundColor: COLORS.forestDarker,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  leftViewportLandscape: {
    flex: 0.58,
  },
  leftViewportPortrait: {
    width: '100%',
    minHeight: 360,
  },
  rightViewport: {
    backgroundColor: COLORS.forestDeep,
    padding: 16,
    justifyContent: 'space-between',
  },
  rightViewportLandscape: {
    flex: 0.42,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.brass,
  },
  rightViewportPortrait: {
    width: '100%',
    borderTopWidth: 2,
    borderTopColor: COLORS.brass,
  },
  compassRim: {
    backgroundColor: COLORS.brassDark,
    padding: 10,
    borderWidth: 2,
    borderColor: COLORS.brass,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  compassFace: {
    backgroundColor: COLORS.forestDarker,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(216, 184, 117, 0.45)',
    overflow: 'hidden',
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
    backgroundColor: COLORS.brass,
    borderWidth: 2,
    borderColor: COLORS.parchment,
  },
  telemetryGroup: {
    alignItems: 'center',
    marginTop: 14,
    width: '100%',
  },
  odometerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  odometerSpacer: {
    width: 8,
  },
  odometerBox: {
    width: 28,
    height: 40,
    backgroundColor: '#11130F',
    borderWidth: 1,
    borderColor: COLORS.brass,
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
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  odometerText: {
    color: COLORS.parchment,
    fontSize: 19,
    fontWeight: '800',
    fontFamily: MONO_FONT,
  },
  targetSubtext: {
    color: COLORS.brass,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 1.3,
    fontFamily: MONO_FONT,
    marginTop: 8,
    fontWeight: '700',
    textAlign: 'center',
  },
  bearingText: {
    color: COLORS.parchment,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: MONO_FONT,
    marginTop: 4,
    textAlign: 'center',
  },
  gpsStatusArea: {
    minHeight: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
    paddingHorizontal: 8,
  },
  statusText: {
    color: COLORS.parchment,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: MONO_FONT,
    textAlign: 'center',
  },
  warningText: {
    color: COLORS.warning,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: MONO_FONT,
    fontWeight: '700',
    textAlign: 'center',
  },
  dangerText: {
    color: COLORS.danger,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    textAlign: 'center',
  },
  successText: {
    color: COLORS.success,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    textAlign: 'center',
  },
  sensorFallbackBox: {
    borderWidth: 2,
    borderColor: COLORS.brass,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.forestDeep,
    padding: 18,
  },
  fallbackText: {
    color: COLORS.parchment,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: MONO_FONT,
    textAlign: 'center',
    marginTop: 10,
    fontWeight: '700',
  },
  clueSection: {
    flexGrow: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  starIconBox: {
    marginRight: 8,
  },
  sectionTitle: {
    color: COLORS.parchment,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: 1.6,
    fontFamily: MONO_FONT,
  },
  headerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.brass,
    opacity: 0.55,
    marginLeft: 10,
  },
  clueCard: {
    backgroundColor: COLORS.parchment2,
    borderRadius: 7,
    padding: 16,
    borderTopWidth: 4,
    borderTopColor: COLORS.brass,
  },
  clueTitle: {
    color: COLORS.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    fontFamily: MONO_FONT,
    marginBottom: 7,
    textTransform: 'uppercase',
  },
  clueBody: {
    color: COLORS.ink,
    fontSize: 15,
    lineHeight: 22,
    fontStyle: 'italic',
  },
  clueAuthor: {
    color: COLORS.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
    marginTop: 9,
    fontFamily: MONO_FONT,
  },
  evidenceButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderColor: 'rgba(33, 28, 24, 0.22)',
  },
  evidenceText: {
    color: COLORS.ink,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
    fontFamily: MONO_FONT,
    marginLeft: 8,
    letterSpacing: 0.8,
  },
  actionContainer: {
    marginTop: 16,
  },
  alertCard: {
    minHeight: 86,
    backgroundColor: COLORS.sienna,
    borderRadius: 7,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 2,
    borderColor: COLORS.parchment,
    borderStyle: 'dashed',
    marginBottom: 10,
    justifyContent: 'center',
  },
  alertCardSuccess: {
    backgroundColor: COLORS.forestDarker,
    borderColor: COLORS.success,
    borderStyle: 'solid',
  },
  alertCardDisabled: {
    backgroundColor: COLORS.disabled,
    borderColor: COLORS.disabledBorder,
    borderStyle: 'solid',
  },
  alertHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  alertTitle: {
    flexShrink: 1,
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 1,
    marginLeft: 8,
    fontFamily: MONO_FONT,
  },
  alertSub: {
    color: COLORS.parchment,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0.35,
    fontFamily: MONO_FONT,
  },
  abandonButton: {
    alignSelf: 'flex-end',
    minHeight: 48,
    minWidth: 48,
    paddingVertical: 10,
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  abandonText: {
    color: COLORS.brass,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: MONO_FONT,
  },
  primaryTextButton: {
    minHeight: 50,
    minWidth: 180,
    backgroundColor: COLORS.sienna,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: COLORS.parchment,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryTextButtonText: {
    color: COLORS.white,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: 1,
    textAlign: 'center',
  },
  pressedControl: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },
  pressedLightControl: {
    opacity: 0.65,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.forestDeep,
    padding: 16,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: COLORS.brass,
    alignItems: 'center',
    maxWidth: 560,
    width: '100%',
    maxHeight: '90%',
  },
  modalTitle: {
    alignSelf: 'flex-start',
    color: COLORS.parchment,
    fontFamily: MONO_FONT,
    fontWeight: '800',
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  fullEvidenceImage: {
    width: '100%',
    height: 320,
    borderRadius: 6,
    marginBottom: 16,
    backgroundColor: COLORS.forestDarker,
  },
  imageFallback: {
    width: '100%',
    height: 220,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.brass,
    backgroundColor: COLORS.forestDarker,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    padding: 20,
  },
  imageFallbackText: {
    color: COLORS.danger,
    fontFamily: MONO_FONT,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
});
