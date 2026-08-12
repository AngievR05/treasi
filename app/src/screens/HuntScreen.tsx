import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Magnetometer, Accelerometer } from 'expo-sensors';
import * as Location from 'expo-location';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import Svg, {
  Line,
  Text as SvgText,
  Polygon,
  Path,
} from 'react-native-svg';

// Firebase & Types
import { db, auth } from '../config/firebase';
import { 
  doc, 
  getDoc, 
  addDoc, 
  collection, 
  serverTimestamp, 
  updateDoc, 
  increment 
} from 'firebase/firestore';
import { TreasureDocument } from '../types/firestore';

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
};

interface Props {
  treasureId: string;
  onBack: () => void;
  onSuccess?: () => void;
}

/**
 * Haversine Formula: Computes distance between two coordinates in meters.
 */
function getDistanceInMeters(
  lat1: number, 
  lon1: number, 
  lat2: number, 
  lon2: number
): number {
  const R = 6371000; // Radius of Earth in meters
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

/* SPLIT-FLAP ODOMETER */
const OdometerDigit: React.FC<{ char: string }> = ({ char }) => {
  if (char === ' ') return <View style={{ width: 8 }} />;

  return (
    <View style={styles.odometerBox}>
      <View style={styles.odometerSplitLine} />
      <Text style={styles.odometerText}>{char}</Text>
    </View>
  );
};

const OdometerDisplay: React.FC<{ value: string }> = ({ value }) => {
  return (
    <View style={styles.odometerContainer} accessibilityLabel={`Distance readout: ${value}`}>
      {value.split('').map((ch, index) => (
        <OdometerDigit key={index} char={ch} />
      ))}
    </View>
  );
};

/* BRASS COMPASS DIAL */
const CompassDialView: React.FC<{ headingValue: { value: number }; size?: number }> = ({
  headingValue,
  size = 220,
}) => {
  const animatedNeedleStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${headingValue.value}deg` }],
    };
  });

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
          {/* Degree Ticks */}
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

          {/* Cardinal Directions */}
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

        {/* Rotatable Compass Needle */}
        <Animated.View style={[styles.needleWrapper, animatedNeedleStyle]}>
          <Svg width="20" height={size * 0.65} viewBox="0 0 20 160">
            <Polygon points="10,6 3,80 17,80" fill={COLORS.sienna} />
            <Polygon points="10,154 3,80 17,80" fill="#D8BD8A" />
          </Svg>
        </Animated.View>

        {/* Center Brass Cap */}
        <View style={styles.compassCap} />
      </View>
    </View>
  );
};

/* -------------------------------------------------------------------------- */
/*                                MAIN COMPONENT                              */
/* -------------------------------------------------------------------------- */
export const HuntScreen: React.FC<Props> = ({ treasureId, onBack, onSuccess }) => {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // State Management
  const [treasure, setTreasure] = useState<TreasureDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [distance, setDistance] = useState<number | null>(null);
  const [isExcavated, setIsExcavated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const headingShared = useSharedValue(0);

  // 1. Fetch Treasure Document from Firestore
  useEffect(() => {
    let isMounted = true;
    const fetchTreasure = async () => {
      try {
        const docRef = doc(db, 'treasures', treasureId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists() && isMounted) {
          setTreasure({ treasureId: docSnap.id, ...docSnap.data() } as TreasureDocument);
        } else if (isMounted) {
          Alert.alert('Target Lost', 'This treasure cache no longer exists.');
          onBack();
        }
      } catch (err) {
        Alert.alert('Telemetry Error', 'Failed to acquire target lock.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchTreasure();
    return () => { isMounted = false; };
  }, [treasureId, onBack]);

  // 2. Real GPS Location Subscription & Distance Calculation
  useEffect(() => {
    let locationSub: Location.LocationSubscription | null = null;

    const startLocationTracking = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'GPS sensor permissions required for telemetry.');
        return;
      }

      locationSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 1, // update every 1 meter move
        },
        (loc) => {
          if (treasure?.location) {
            const dist = getDistanceInMeters(
              loc.coords.latitude,
              loc.coords.longitude,
              treasure.location.latitude,
              treasure.location.longitude
            );
            setDistance(dist);
          }
        }
      );
    };

    if (treasure) {
      startLocationTracking();
    }

    return () => {
      if (locationSub) locationSub.remove();
    };
  }, [treasure]);

  // 3. Magnetometer Filtering (Compass)
  useEffect(() => {
    let prevX = 0;
    let prevY = 0;
    const alpha = 0.15;

    Magnetometer.setUpdateInterval(50);

    const subscription = Magnetometer.addListener((data) => {
      const filteredX = alpha * data.x + (1 - alpha) * prevX;
      const filteredY = alpha * data.y + (1 - alpha) * prevY;
      prevX = filteredX;
      prevY = filteredY;

      let angle = Math.atan2(filteredY, filteredX) * (180 / Math.PI);
      if (angle < 0) angle += 360;

      headingShared.value = withSpring(angle, {
        damping: 12,
        stiffness: 90,
      });
    });

    return () => subscription.remove();
  }, [headingShared]);

  // 4. Handle Final Excavation (Firestore Writes)
  const executeExcavation = useCallback(async () => {
    if (isExcavated || isSubmitting || !auth.currentUser || !treasure) return;

    // Radius Enforcement (e.g., must be within 15 meters)
    if (distance !== null && distance > 15) {
      Alert.alert('Out of Range', `You are ${distance}m away. Move within 15m to dig.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const userId = auth.currentUser.uid;
      const userName = auth.currentUser.displayName || 'Anonymous Explorer';

      // Record Discovery
      await addDoc(collection(db, 'discoveries'), {
        treasureId: treasure.treasureId,
        hunterId: userId,
        unlockedAt: serverTimestamp(),
      });

      // Post to Activity Feed
      await addDoc(collection(db, 'activity_feed'), {
        userId: userId,
        username: userName,
        type: 'TREASURE_FOUND',
        message: `Excavated "${treasure.title}"`,
        targetId: treasure.treasureId,
        createdAt: serverTimestamp(),
      });

      // Award Score Points to User Document
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        totalPoints: increment(100),
        updatedAt: serverTimestamp(),
      });

      setIsExcavated(true);
      if (onSuccess) onSuccess();
    } catch (err) {
      Alert.alert('Excavation Failed', 'Could not record excavation signal in Firestore.');
    } finally {
      setIsSubmitting(false);
    }
  }, [isExcavated, isSubmitting, treasure, distance, onSuccess]);

  // 5. Accelerometer Shake Listener
  useEffect(() => {
    Accelerometer.setUpdateInterval(100);

    const accelSubscription = Accelerometer.addListener((data) => {
      const gForce = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z);
      if (gForce > 2.2 && !isExcavated && !isSubmitting) {
        executeExcavation();
      }
    });

    return () => accelSubscription.remove();
  }, [isExcavated, isSubmitting, executeExcavation]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={COLORS.brass} />
        <Text style={styles.loadingText}>Calibrating Sensors...</Text>
      </View>
    );
  }

  const formattedDistance = distance !== null 
    ? String(distance).padStart(3, '0') + ' m'
    : '--- m';

  const isLandscape = windowWidth > windowHeight;

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
        {/* LEFT VIEWPORT: INSTRUMENTS & COMPASS (60%) */}
        <View style={styles.leftViewport}>
          <CompassDialView headingValue={headingShared} size={Math.min(windowHeight * 0.52, 220)} />

          <View style={styles.telemetryGroup}>
            <OdometerDisplay value={formattedDistance} />
            <Text style={styles.targetSubtext}>· · TO TARGET · ·</Text>
          </View>
        </View>

        {/* RIGHT VIEWPORT: CONTROL CONSOLE (40%) */}
        <View style={styles.rightViewport}>
          <View>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.starIconBox}>
                <Svg width="12" height="12" viewBox="0 0 24 24" fill={COLORS.sienna}>
                  <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </Svg>
              </View>
              <Text style={styles.sectionTitle}>CLUE SLATE</Text>
              <View style={styles.headerLine} />
            </View>

            {/* Parchment Clue Card */}
            <View style={styles.clueCard}>
              <Text style={styles.clueTitle}>{treasure?.title || 'Unknown Cache'}</Text>
              <Text style={styles.clueBody}>"{treasure?.hint || 'No clue provided.'}"</Text>
              <Text style={styles.clueAuthor}>— left by {treasure?.creatorName || 'Explorer'}</Text>
            </View>
          </View>

          {/* Action / Alert Slate */}
          <View style={styles.actionContainer}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={executeExcavation}
              disabled={isSubmitting}
              accessible={true}
              accessibilityLabel={isExcavated ? "Excavation Complete" : "Tap or Shake to Excavate"}
              accessibilityHint="Triggers treasure excavation when within radius"
              style={[
                styles.alertCard,
                isExcavated && styles.alertCardSuccess,
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
                    ? 'RECORDING SIGNAL...' 
                    : isExcavated 
                    ? 'EXCAVATION COMPLETE' 
                    : 'DIG SITE DETECTED'}
                </Text>
              </View>

              <Text style={styles.alertSub}>
                {isExcavated 
                  ? `PAYLOAD: ${treasure?.payloadText || 'CACHE UNLOCKED'}` 
                  : 'SHAKE DEVICE OR TAP BOX TO EXCAVATE'}
              </Text>
            </TouchableOpacity>

            {/* Abandon Button */}
            <TouchableOpacity 
              style={styles.abandonButton} 
              onPress={onBack}
              accessible={true}
              accessibilityLabel="Abandon Hunt"
            >
              <Text style={styles.abandonText}>ABANDON HUNT ▸</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.forestDarker,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.parchment,
    fontFamily: 'Courier',
    marginTop: 12,
    fontSize: 12,
    letterSpacing: 1.5,
  },
  splitWrapper: {
    flex: 1,
  },
  leftViewport: {
    flex: 0.6,
    backgroundColor: COLORS.forestDarker,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  rightViewport: {
    flex: 0.4,
    backgroundColor: COLORS.forestDeep,
    padding: 14,
    borderLeftWidth: 2,
    borderColor: COLORS.brass,
    justifyContent: 'space-between',
  },

  /* COMPASS STYLING */
  compassRim: {
    backgroundColor: COLORS.brassDark,
    padding: 10,
    borderWidth: 2,
    borderColor: COLORS.brass,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  compassFace: {
    backgroundColor: COLORS.forestDarker,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(176, 141, 87, 0.3)',
  },
  needleWrapper: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  compassCap: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.brass,
    borderWidth: 1,
    borderColor: COLORS.parchment,
  },

  /* TELEMETRY / ODOMETER */
  telemetryGroup: {
    alignItems: 'center',
    marginTop: 10,
  },
  odometerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  odometerBox: {
    width: 24,
    height: 36,
    backgroundColor: '#161511',
    borderWidth: 1,
    borderColor: COLORS.brass,
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 1.5,
    position: 'relative',
  },
  odometerSplitLine: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  odometerText: {
    color: COLORS.parchment,
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'Courier',
  },
  targetSubtext: {
    color: COLORS.brass,
    fontSize: 9,
    letterSpacing: 2.5,
    fontFamily: 'Courier',
    marginTop: 4,
    fontWeight: '600',
  },

  /* RIGHT PANEL & CLUE SLATE */
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  starIconBox: {
    marginRight: 6,
  },
  sectionTitle: {
    color: COLORS.parchment,
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 2,
    fontFamily: 'Courier',
  },
  headerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.brass,
    opacity: 0.4,
    marginLeft: 8,
  },
  clueCard: {
    backgroundColor: COLORS.parchment2,
    borderRadius: 4,
    padding: 12,
    borderTopWidth: 3,
    borderTopColor: COLORS.brass,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  clueTitle: {
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'Courier',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  clueBody: {
    color: COLORS.ink,
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  clueAuthor: {
    color: COLORS.inkSoft,
    fontSize: 10,
    textAlign: 'right',
    marginTop: 6,
    fontFamily: 'Courier',
  },

  /* ACTION / ALERT CARD */
  actionContainer: {
    marginTop: 'auto',
  },
  alertCard: {
    backgroundColor: COLORS.sienna,
    borderRadius: 4,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.parchment,
    borderStyle: 'dashed',
    marginBottom: 8,
  },
  alertCardSuccess: {
    backgroundColor: COLORS.forestDarker,
    borderColor: COLORS.brass,
    borderStyle: 'solid',
  },
  alertHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  alertTitle: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 10,
    letterSpacing: 1.2,
    marginLeft: 6,
    fontFamily: 'Courier',
  },
  alertSub: {
    color: COLORS.parchment,
    fontSize: 8.5,
    letterSpacing: 0.8,
    fontFamily: 'Courier',
  },
  abandonButton: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  abandonText: {
    color: COLORS.brass,
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    fontFamily: 'Courier',
  },
});