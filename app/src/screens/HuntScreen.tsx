import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Magnetometer, Accelerometer } from 'expo-sensors';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  SharedValue,
} from 'react-native-reanimated';
import Svg, {
  Line,
  Text as SvgText,
  Polygon,
  Path,
  Circle,
  Rect,
} from 'react-native-svg';

import { db, auth } from '../config/firebase';
import {
  doc,
  getDoc,
  collection,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore';
import { TreasureDocument, UserDocument } from '../types/firestore';

// System Constants
const DISCOVERY_RADIUS_METRES = 5;
const MAX_ACCEPTABLE_GPS_ACCURACY_METRES = 20;

const COLORS = {
  forestDeep: '#2C3B2E',
  forestDarker: '#1C2419',
  parchment: '#E8DCC0',
  parchment2: '#F3ECD8',
  sienna: '#A64B2A',
  brass: '#B08D57',
  brassDark: '#6F5326',
  ink: '#2A2420',
  inkSoft: '#5F5748',
  white: '#FFFFFF',
  warning: '#D97706',
};

interface Props {
  route?: { params?: { treasureId?: string } };
  treasureId?: string;
  onBack?: () => void;
  onSuccess?: () => void;
  navigation?: any;
}

function getDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

const OdometerDigit: React.FC<{ char: string }> = ({ char }) => {
  if (char === ' ') return <View style={{ width: 8 }} />;
  return (
    <View style={styles.odometerBox}>
      <View style={styles.odometerSplitLine} />
      <Text style={styles.odometerText}>{char}</Text>
    </View>
  );
};

const OdometerDisplay: React.FC<{ value: string }> = ({ value }) => (
  <View style={styles.odometerContainer} accessibilityLabel={`Distance readout: ${value}`}>
    {value.split('').map((ch, index) => (
      <OdometerDigit key={index} char={ch} />
    ))}
  </View>
);

const CompassDialView: React.FC<{ headingValue: SharedValue<number>; size?: number }> = ({
  headingValue,
  size = 220,
}) => {
  const animatedNeedleStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${headingValue.value}deg` }],
  }));

  const dirs = [
    { label: 'N', angle: 0 },
    { label: 'E', angle: 90 },
    { label: 'S', angle: 180 },
    { label: 'W', angle: 270 },
  ];

  return (
    <View style={[styles.compassRim, { width: size, height: size, borderRadius: size / 2 }]}>
      <View style={[styles.compassFace, { width: size - 24, height: size - 24, borderRadius: (size - 24) / 2 }]}>
        <Svg viewBox="0 0 200 200" style={StyleSheet.absoluteFill}>
          {Array.from({ length: 72 }).map((_, i) => {
            const angleRad = (i * 5 * Math.PI) / 180;
            const isMajor = i % 6 === 0;
            const r1 = isMajor ? 78 : 84;
            const r2 = 90;
            return (
              <Line
                key={i}
                x1={100 + r1 * Math.sin(angleRad)}
                y1={100 - r1 * Math.cos(angleRad)}
                x2={100 + r2 * Math.sin(angleRad)}
                y2={100 - r2 * Math.cos(angleRad)}
                stroke={COLORS.brass}
                strokeWidth={isMajor ? 1.5 : 0.7}
                opacity={isMajor ? 0.9 : 0.5}
              />
            );
          })}
          {dirs.map((d) => {
            const angleRad = (d.angle * Math.PI) / 180;
            return (
              <SvgText
                key={d.label}
                x={100 + 62 * Math.sin(angleRad)}
                y={100 - 62 * Math.cos(angleRad) + 5}
                textAnchor="middle"
                fill={COLORS.parchment}
                fontSize="15"
                fontWeight="bold"
                fontFamily="Courier"
              >
                {d.label}
              </SvgText>
            );
          })}
        </Svg>
        <Animated.View style={[styles.needleWrapper, animatedNeedleStyle]}>
          <Svg width="20" height={size * 0.65} viewBox="0 0 20 160">
            <Polygon points="10,6 3,80 17,80" fill={COLORS.sienna} />
            <Polygon points="10,154 3,80 17,80" fill="#D8BD8A" />
          </Svg>
        </Animated.View>
        <View style={styles.compassCap} />
      </View>
    </View>
  );
};

export const HuntScreen: React.FC<Props> = ({
  route,
  treasureId,
  onBack,
  onSuccess,
  navigation,
}) => {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const targetTreasureId = treasureId || route?.params?.treasureId;

  // State Declarations
  const [treasure, setTreasure] = useState<TreasureDocument | null>(null);
  const [userProfile, setUserProfile] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [distance, setDistance] = useState<number | null>(null);
  const [isExcavated, setIsExcavated] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imageModalVisible, setImageModalVisible] = useState(false);

  // Hardware Status Flags
  const [compassAvailable, setCompassAvailable] = useState(true);
  const [accelAvailable, setAccelAvailable] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<'OK' | 'DENIED' | 'UNAVAILABLE' | 'LOW_ACCURACY'>('OK');
  const [gpsAccuracyMsg, setGpsAccuracyMsg] = useState<string | null>(null);

  const headingShared = useSharedValue(0);
  const isMountedRef = useRef(true);
  const lastShakeTime = useRef(0);

  const handleBackNavigation = useCallback(() => {
    if (onBack) {
      onBack();
    } else if (navigation && navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [onBack, navigation]);

  // 1. Initial Target Validation & User Profile Sync
  useEffect(() => {
    isMountedRef.current = true;

    if (!targetTreasureId) {
      setLoading(false);
      return;
    }

    const fetchInitialData = async () => {
      try {
        if (!auth.currentUser) return;
        const currentUserId = auth.currentUser.uid;

        // Fetch User Settings (Haptics & Sensitivity configuration)
        const userSnap = await getDoc(doc(db, 'users', currentUserId));
        if (userSnap.exists() && isMountedRef.current) {
          setUserProfile(userSnap.data() as UserDocument);
        }

        // Fetch Target Treasure Document
        const docRef = doc(db, 'treasures', targetTreasureId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          Alert.alert('Target Lost', 'This treasure cache no longer exists in Firestore.');
          handleBackNavigation();
          return;
        }

        const treasureData = { treasureId: docSnap.id, ...docSnap.data() } as TreasureDocument;

        if (treasureData.isArchived) {
          setIsArchived(true);
        }

        // Check prior discovery via atomic doc ID convention
        const discoveryRef = doc(db, 'discoveries', `${currentUserId}_${targetTreasureId}`);
        const discoverySnap = await getDoc(discoveryRef);

        if (isMountedRef.current) {
          setTreasure(treasureData);
          if (discoverySnap.exists()) {
            setIsExcavated(true);
          }
        }
      } catch (err) {
        Alert.alert('Telemetry Error', 'Failed to synchronize with target field markers.');
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    };

    fetchInitialData();

    return () => {
      isMountedRef.current = false;
    };
  }, [targetTreasureId, handleBackNavigation]);

  // 2. GPS Location Stream with Accuracy Inspection
  useEffect(() => {
    let locationSub: Location.LocationSubscription | null = null;

    const startLocationTracking = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (isMountedRef.current) setGpsStatus('DENIED');
          return;
        }

        const isServicesEnabled = await Location.hasServicesEnabledAsync();
        if (!isServicesEnabled) {
          if (isMountedRef.current) setGpsStatus('UNAVAILABLE');
          return;
        }

        locationSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 1,
          },
          (loc) => {
            if (!isMountedRef.current || !treasure?.location) return;

            const accuracy = loc.coords.accuracy ?? 999;
            if (accuracy > MAX_ACCEPTABLE_GPS_ACCURACY_METRES) {
              setGpsStatus('LOW_ACCURACY');
              setGpsAccuracyMsg(`GPS accuracy ±${Math.round(accuracy)}m (Too low for dig)`);
            } else {
              setGpsStatus('OK');
              setGpsAccuracyMsg(null);
            }

            const dist = getDistanceInMeters(
              loc.coords.latitude,
              loc.coords.longitude,
              treasure.location.latitude,
              treasure.location.longitude
            );
            setDistance(dist);
          }
        );
      } catch {
        if (isMountedRef.current) setGpsStatus('UNAVAILABLE');
      }
    };

    if (treasure && !isArchived) startLocationTracking();

    return () => {
      if (locationSub) locationSub.remove();
    };
  }, [treasure, isArchived]);

  // 3. Magnetometer Sensor with Landscape Math Offset
  const isLandscape = windowWidth > windowHeight;
  useEffect(() => {
    let subscription: ReturnType<typeof Magnetometer.addListener> | null = null;
    let prevX = 0;
    let prevY = 0;
    const alpha = 0.15;

    const initCompass = async () => {
      const isAvailable = await Magnetometer.isAvailableAsync();
      if (!isAvailable) {
        if (isMountedRef.current) setCompassAvailable(false);
        return;
      }

      Magnetometer.setUpdateInterval(50);
      subscription = Magnetometer.addListener((data) => {
        if (!data || data.x === null || data.y === null) return;

        const filteredX = alpha * data.x + (1 - alpha) * prevX;
        const filteredY = alpha * data.y + (1 - alpha) * prevY;
        prevX = filteredX;
        prevY = filteredY;

        // Landscape Mathematics: Compensate orientation shift (+90deg in landscape)
        let angle = Math.atan2(filteredY, filteredX) * (180 / Math.PI);
        const rotationOffset = isLandscape ? 90 : 0;
        angle = (angle + rotationOffset + 360) % 360;

        headingShared.value = withSpring(angle, {
          damping: 14,
          stiffness: 90,
        });
      });
    };

    initCompass();

    return () => {
      if (subscription) subscription.remove();
    };
  }, [headingShared, isLandscape]);

  // 4. Atomic Excavation Engine (Firestore Transaction + Deterministic Doc ID)
  const executeExcavation = useCallback(async () => {
    if (isExcavated || isArchived || isSubmitting || !auth.currentUser || !treasure || !targetTreasureId) return;

    if (isArchived) {
      Alert.alert('Archived Cache', 'This treasure has been archived and cannot be excavated.');
      return;
    }

    if (distance !== null && distance > DISCOVERY_RADIUS_METRES) {
      Alert.alert(
        'Out of Range',
        `Target is ${distance} meters away. Advance within ${DISCOVERY_RADIUS_METRES} meters to dig.`
      );
      return;
    }

    if (gpsStatus === 'DENIED' || gpsStatus === 'UNAVAILABLE') {
      Alert.alert('GPS Error', 'Location services must be enabled and active to verify excavation.');
      return;
    }

    if (gpsStatus === 'LOW_ACCURACY') {
      Alert.alert('GPS Signal Weak', 'Wait for GPS precision to improve under 20m before digging.');
      return;
    }

    setIsSubmitting(true);
    try {
      const userId = auth.currentUser.uid;
      const userName = auth.currentUser.displayName || userProfile?.username || 'Anonymous Explorer';

      const discoveryRef = doc(db, 'discoveries', `${userId}_${targetTreasureId}`);
      const userRef = doc(db, 'users', userId);
      const activityRef = doc(collection(db, 'activity_feed'));

      await runTransaction(db, async (transaction) => {
        const discDoc = await transaction.get(discoveryRef);
        if (discDoc.exists()) {
          throw new Error('ALREADY_EXCAVATED');
        }

        // Write deterministic discovery record
        transaction.set(discoveryRef, {
          discoveryId: `${userId}_${targetTreasureId}`,
          treasureId: targetTreasureId,
          hunterId: userId,
          unlockedAt: serverTimestamp(),
        });

        // Award points atomically
        transaction.update(userRef, {
          totalPoints: (userProfile?.totalPoints || 0) + 100,
          updatedAt: serverTimestamp(),
        });

        // Publish to activity feed
        transaction.set(activityRef, {
          userId,
          username: userName,
          type: 'TREASURE_FOUND',
          message: `Excavated "${treasure.title}"`,
          targetId: targetTreasureId,
          createdAt: serverTimestamp(),
        });
      });

      // Conditional Haptic Feedback check based on stored user profile preference (default true if not set)
      if (userProfile?.hapticFeedbackEnabled !== false) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setIsExcavated(true);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      if (err?.message === 'ALREADY_EXCAVATED') {
        setIsExcavated(true);
        Alert.alert('Already Excavated', 'You have already recorded this treasure discovery.');
      } else {
        Alert.alert('Excavation Failed', 'Could not transmit excavation signal to Firestore.');
      }
    } finally {
      if (isMountedRef.current) setIsSubmitting(false);
    }
  }, [isExcavated, isArchived, isSubmitting, treasure, targetTreasureId, distance, gpsStatus, userProfile, onSuccess]);

  // 5. Accelerometer Kinetic Shake Listener
  useEffect(() => {
    let accelSub: ReturnType<typeof Accelerometer.addListener> | null = null;

    const initAccel = async () => {
      const isAvailable = await Accelerometer.isAvailableAsync();
      if (!isAvailable) {
        if (isMountedRef.current) setAccelAvailable(false);
        return;
      }

      Accelerometer.setUpdateInterval(100);

      // Adjust threshold based on user profile motion sensitivity toggle
      const shakeThreshold = userProfile?.motionSensitivityEnabled ? 2.0 : 2.4;

      accelSub = Accelerometer.addListener((data) => {
        if (!data) return;
        const gForce = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z);
        const now = Date.now();

        if (gForce > shakeThreshold && now - lastShakeTime.current > 2000 && !isExcavated && !isArchived && !isSubmitting) {
          lastShakeTime.current = now;
          executeExcavation();
        }
      });
    };

    initAccel();

    return () => {
      if (accelSub) accelSub.remove();
    };
  }, [isExcavated, isArchived, isSubmitting, userProfile, executeExcavation]);

  // Render Missing Parameter Fallback Screen
  if (!targetTreasureId) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Text style={styles.errorTitle}>TELEMETRY ERROR: INVALID TARGET</Text>
        <Text style={styles.errorSub}>Treasure target unavailable. No target ID was specified.</Text>
        <TouchableOpacity
          style={styles.closeModalButton}
          onPress={handleBackNavigation}
          accessibilityRole="button"
          accessibilityLabel="Return to Dashboard"
        >
          <Text style={styles.closeModalText}>RETURN TO DASHBOARD</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={COLORS.brass} />
        <Text style={styles.loadingText}>CALIBRATING TELEMETRY SENSORS...</Text>
      </View>
    );
  }

  const formattedDistance =
    distance !== null ? String(distance).padStart(3, '0') + ' m' : '--- m';

  return (
    <View
      style={[
        styles.container,
        {
          paddingLeft: insets.left > 0 ? insets.left : 12,
          paddingRight: insets.right > 0 ? insets.right : 12,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <View style={[styles.splitWrapper, { flexDirection: isLandscape ? 'row' : 'column' }]}>
        {/* LEFT VIEWPORT: INSTRUMENTS & COMPASS DIAL (60%) */}
        <View style={styles.leftViewport}>
          {compassAvailable ? (
            <CompassDialView
              headingValue={headingShared}
              size={Math.min(windowHeight * (isLandscape ? 0.52 : 0.35), 220)}
            />
          ) : (
            <View style={styles.sensorFallbackBox}>
              <Text style={styles.fallbackText}>COMPASS HARDWARE UNAVAILABLE</Text>
            </View>
          )}

          <View style={styles.telemetryGroup}>
            <OdometerDisplay value={formattedDistance} />
            <Text style={styles.targetSubtext}>· · TO TARGET (5m DIG RADIUS) · ·</Text>
            {gpsAccuracyMsg && <Text style={styles.gpsWarningText}>{gpsAccuracyMsg}</Text>}
            {gpsStatus === 'DENIED' && (
              <Text style={styles.gpsWarningText}>GPS PERMISSION DENIED</Text>
            )}
            {gpsStatus === 'UNAVAILABLE' && (
              <Text style={styles.gpsWarningText}>LOCATION SERVICES DISABLED</Text>
            )}
          </View>
        </View>

        {/* RIGHT VIEWPORT: CONTROL CONSOLE (40%) */}
        <View style={styles.rightViewport}>
          <View style={{ flex: 1 }}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.starIconBox}>
                <Svg width="12" height="12" viewBox="0 0 24 24" fill={COLORS.sienna}>
                  <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </Svg>
              </View>
              <Text style={styles.sectionTitle}>CLUE SLATE</Text>
              <View style={styles.headerLine} />
            </View>

            <View style={styles.clueCard}>
              <Text style={styles.clueTitle}>{treasure?.title || 'UNKNOWN CACHE'}</Text>
              <Text style={styles.clueBody}>"{treasure?.hint || 'No clue provided.'}"</Text>
              <Text style={styles.clueAuthor}>— left by {treasure?.creatorName || 'Explorer'}</Text>

              {treasure?.imageUrl ? (
                <TouchableOpacity
                  style={styles.evidenceButton}
                  onPress={() => setImageModalVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Inspect Photo Evidence"
                >
                  <Svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.brass} strokeWidth="2">
                    <Rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <Circle cx="8.5" cy="8.5" r="1.5" />
                    <Polygon points="21 15 16 10 5 21" />
                  </Svg>
                  <Text style={styles.evidenceText}>INSPECT FIELD PHOTO</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Action Console */}
          <View style={styles.actionContainer}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={executeExcavation}
              disabled={isSubmitting || isExcavated || isArchived}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={
                isArchived
                  ? 'Cache Archived'
                  : isExcavated
                  ? 'Excavation Complete'
                  : 'Tap or Shake Device to Excavate'
              }
              style={[
                styles.alertCard,
                isExcavated && styles.alertCardSuccess,
                isArchived && styles.alertCardDisabled,
              ]}
            >
              <View style={styles.alertHeaderRow}>
                <Svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.white} strokeWidth="2">
                  <Path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <Line x1="12" y1="9" x2="12" y2="13" />
                  <Line x1="12" y1="17" x2="12.01" y2="17" />
                </Svg>
                <Text style={styles.alertTitle}>
                  {isSubmitting
                    ? 'TRANSMITTING SIGNAL...'
                    : isArchived
                    ? 'CACHE ARCHIVED'
                    : isExcavated
                    ? 'EXCAVATION COMPLETE'
                    : 'DIG SITE DETECTED'}
                </Text>
              </View>

              <Text style={styles.alertSub}>
                {isArchived
                  ? 'THIS TREASURE IS NO LONGER ACTIVE'
                  : isExcavated
                  ? `PAYLOAD: ${treasure?.payloadText || 'CACHE UNLOCKED (+100 PTS)'}`
                  : accelAvailable
                  ? 'SHAKE DEVICE OR TAP BOX TO EXCAVATE (WITHIN 5M)'
                  : 'TAP BOX TO EXCAVATE (WITHIN 5M)'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.abandonButton}
              onPress={handleBackNavigation}
              accessibilityRole="button"
              accessibilityLabel="Abandon Hunt and Return"
            >
              <Text style={styles.abandonText}>ABANDON HUNT ▸</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Field Photo Evidence Modal */}
      {treasure?.imageUrl ? (
        <Modal
          visible={imageModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setImageModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Image source={{ uri: treasure.imageUrl }} style={styles.fullEvidenceImage} resizeMode="cover" />
              <TouchableOpacity
                style={styles.closeModalButton}
                onPress={() => setImageModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close Evidence Modal"
              >
                <Text style={styles.closeModalText}>CLOSE EVIDENCE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.forestDarker },
  centerContent: { justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { color: COLORS.parchment, fontFamily: 'Courier', marginTop: 12, fontSize: 11, letterSpacing: 1.5 },
  errorTitle: { color: COLORS.sienna, fontFamily: 'Courier', fontWeight: 'bold', fontSize: 14, marginBottom: 8 },
  errorSub: { color: COLORS.parchment, fontFamily: 'Courier', fontSize: 11, textAlign: 'center', marginBottom: 16 },
  splitWrapper: { flex: 1 },
  leftViewport: { flex: 0.6, backgroundColor: COLORS.forestDarker, justifyContent: 'center', alignItems: 'center', padding: 12 },
  rightViewport: { flex: 0.4, backgroundColor: COLORS.forestDeep, padding: 14, borderLeftWidth: 2, borderColor: COLORS.brass, justifyContent: 'space-between' },
  compassRim: { backgroundColor: COLORS.brassDark, padding: 10, borderWidth: 2, borderColor: COLORS.brass, justifyContent: 'center', alignItems: 'center', elevation: 8 },
  compassFace: { backgroundColor: COLORS.forestDarker, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(176, 141, 87, 0.3)' },
  needleWrapper: { position: 'absolute', justifyContent: 'center', alignItems: 'center' },
  compassCap: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: COLORS.brass, borderWidth: 1, borderColor: COLORS.parchment },
  telemetryGroup: { alignItems: 'center', marginTop: 10 },
  odometerContainer: { flexDirection: 'row', alignItems: 'center' },
  odometerBox: { width: 24, height: 34, backgroundColor: '#161511', borderWidth: 1, borderColor: COLORS.brass, borderRadius: 3, justifyContent: 'center', alignItems: 'center', marginHorizontal: 1.5 },
  odometerSplitLine: { position: 'absolute', top: '50%', left: 0, right: 0, height: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  odometerText: { color: COLORS.parchment, fontSize: 16, fontWeight: 'bold', fontFamily: 'Courier' },
  targetSubtext: { color: COLORS.brass, fontSize: 9, letterSpacing: 2, fontFamily: 'Courier', marginTop: 4, fontWeight: '600' },
  gpsWarningText: { color: COLORS.warning, fontSize: 8.5, fontFamily: 'Courier', marginTop: 2 },
  sensorFallbackBox: { width: 200, height: 200, borderRadius: 100, borderWidth: 1, borderColor: COLORS.brass, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.forestDeep },
  fallbackText: { color: COLORS.parchment, fontSize: 9, fontFamily: 'Courier', textAlign: 'center', paddingHorizontal: 10 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  starIconBox: { marginRight: 6 },
  sectionTitle: { color: COLORS.parchment, fontSize: 11, fontWeight: 'bold', letterSpacing: 2, fontFamily: 'Courier' },
  headerLine: { flex: 1, height: 1, backgroundColor: COLORS.brass, opacity: 0.4, marginLeft: 8 },
  clueCard: { backgroundColor: COLORS.parchment2, borderRadius: 4, padding: 12, borderTopWidth: 3, borderTopColor: COLORS.brass },
  clueTitle: { color: COLORS.ink, fontSize: 12, fontWeight: 'bold', fontFamily: 'Courier', marginBottom: 4, textTransform: 'uppercase' },
  clueBody: { color: COLORS.ink, fontSize: 12, fontStyle: 'italic', lineHeight: 16 },
  clueAuthor: { color: COLORS.inkSoft, fontSize: 10, textAlign: 'right', marginTop: 6, fontFamily: 'Courier' },
  evidenceButton: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderColor: 'rgba(42, 36, 32, 0.15)' },
  evidenceText: { color: COLORS.ink, fontSize: 9, fontWeight: 'bold', fontFamily: 'Courier', marginLeft: 6, letterSpacing: 1 },
  actionContainer: { marginTop: 10 },
  alertCard: { backgroundColor: COLORS.sienna, borderRadius: 4, padding: 10, borderWidth: 1, borderColor: COLORS.parchment, borderStyle: 'dashed', marginBottom: 6 },
  alertCardSuccess: { backgroundColor: COLORS.forestDarker, borderColor: COLORS.brass, borderStyle: 'solid' },
  alertCardDisabled: { backgroundColor: '#4A4A4A', borderColor: '#777777', borderStyle: 'solid' },
  alertHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  alertTitle: { color: COLORS.white, fontWeight: 'bold', fontSize: 10, letterSpacing: 1.2, marginLeft: 6, fontFamily: 'Courier' },
  alertSub: { color: COLORS.parchment, fontSize: 8.5, letterSpacing: 0.8, fontFamily: 'Courier' },
  abandonButton: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 6 },
  abandonText: { color: COLORS.brass, fontSize: 10, fontWeight: 'bold', letterSpacing: 1.5, fontFamily: 'Courier' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.forestDeep, padding: 12, borderRadius: 6, borderWidth: 2, borderColor: COLORS.brass, alignItems: 'center', maxWidth: 400, width: '100%' },
  fullEvidenceImage: { width: '100%', height: 200, borderRadius: 4, marginBottom: 12 },
  closeModalButton: { backgroundColor: COLORS.sienna, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 4 },
  closeModalText: { color: COLORS.white, fontFamily: 'Courier', fontWeight: 'bold', fontSize: 10, letterSpacing: 1.5 },
});