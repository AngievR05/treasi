import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  Alert,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  FadeInDown,
} from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  doc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';

import { auth, db } from '../config/firebase';
import { FieldNavBar } from '../components/FieldNavBar';
import {
  UserDocument,
  TreasureDocument,
  ActivityFeedDocument,
} from '../types/firestore';

interface Props {
  onNavigate?: (screen: string) => void;
}

// Custom Vintage Map Styling Matrix (Sepia & Forest Palette)
const VINTAGE_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#E8DCC0' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#2A2420' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#E8DCC0' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#B08D57' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#D8CBB0' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#C8BB9C' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#F3ECD8' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#2A2420' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#A0B2A6' }] },
];

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

export const DashboardScreen: React.FC<Props> = ({ onNavigate }) => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);

  // Firebase singleton instances
  const currentUser = auth.currentUser;

  // Real-time Firestore State
  const [userData, setUserData] = useState<UserDocument | null>(null);
  const [activeTreasures, setActiveTreasures] = useState<TreasureDocument[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityFeedDocument[]>([]);
  const [isLoadingFeed, setIsLoadingFeed] = useState(true);

  // Location & Hardware Telemetry State
  const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
  const [isInitializingLocation, setIsInitializingLocation] = useState(true);
  const [region, setRegion] = useState<Region>({
    latitude: -25.7479,
    longitude: 28.2293,
    latitudeDelta: 0.008,
    longitudeDelta: 0.008,
  });

  // Reanimated Shared Values
  const buttonScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(1);

  // 1. Dynamic Rank Calculation Helper
  const getRankTitle = (points: number = 0): string => {
    if (points >= 3000) return 'RANK: MASTER EXPLORER';
    if (points >= 1500) return 'RANK: TRAILBLAZER III';
    if (points >= 500) return 'RANK: PATHFINDER II';
    return 'RANK: NOVICE SCOUT I';
  };

  // 2. Real-time Firestore Subscriptions
  useEffect(() => {
    if (!currentUser) return;

    // A. User Profile Subscription (Score & Rank)
    const userDocRef = doc(db, 'users', currentUser.uid);
    const unsubscribeUser = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        setUserData(snapshot.data() as UserDocument);
      }
    });

    // B. Active Field Treasures Subscription (Non-archived)
    const treasuresQuery = query(
      collection(db, 'treasures'),
      where('isArchived', '==', false)
    );
    const unsubscribeTreasures = onSnapshot(treasuresQuery, (snapshot) => {
      const treasures: TreasureDocument[] = [];
      snapshot.forEach((docSnap) => {
        treasures.push(docSnap.data() as TreasureDocument);
      });
      setActiveTreasures(treasures);
    });

    // C. Activity Feed Subscription (Recent 10 Field Signals)
    const activityQuery = query(
      collection(db, 'activity_feed'),
      orderBy('createdAt', 'desc'),
      limit(10)
    );
    const unsubscribeActivity = onSnapshot(activityQuery, (snapshot) => {
      const activities: ActivityFeedDocument[] = [];
      snapshot.forEach((docSnap) => {
        activities.push(docSnap.data() as ActivityFeedDocument);
      });
      setActivityFeed(activities);
      setIsLoadingFeed(false);
    }, () => {
      setIsLoadingFeed(false);
    });

    return () => {
      unsubscribeUser();
      unsubscribeTreasures();
      unsubscribeActivity();
    };
  }, [currentUser, db]);

  // 3. Location Telemetry Lifecycle
  useEffect(() => {
    // Pulse animation for radar status badge
    pulseOpacity.value = withRepeat(
      withSequence(
        withTiming(0.3, { duration: 1000 }),
        withTiming(1.0, { duration: 1000 })
      ),
      -1,
      true
    );

    let locationSubscription: Location.LocationSubscription | null = null;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'GPS PERMISSION REQUIRED',
            'Treasi requires GPS telemetry to map caches near your vicinity.'
          );
          setIsInitializingLocation(false);
          return;
        }

        const initialPosition = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        setUserLocation(initialPosition);
        const newRegion = {
          latitude: initialPosition.coords.latitude,
          longitude: initialPosition.coords.longitude,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        };
        setRegion(newRegion);
        mapRef.current?.animateToRegion(newRegion, 1200);
        setIsInitializingLocation(false);

        // Continuous GPS Position Stream
        locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 4000,
            distanceInterval: 5,
          },
          (newLocation) => {
            setUserLocation(newLocation);
          }
        );
      } catch (err) {
        setIsInitializingLocation(false);
      }
    })();

    return () => {
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, []);

  // Animated Component Styles
  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const animatedBadgeStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.94);
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1.0);
  };

  const handleStampLocation = () => {
    if (!userLocation) {
      Alert.alert('TELEMETRY OFFLINE', 'Acquiring satellite fix. Standby...');
      return;
    }

    const { latitude, longitude } = userLocation.coords;
    Alert.alert(
      'LOCATION STAMPED',
      `LAT: ${latitude.toFixed(4)}\nLONG: ${longitude.toFixed(4)}\n\nBury a new treasure cache at these coordinates?`,
      [
        { text: 'CANCEL', style: 'cancel' },
        { text: 'BURY CACHE', onPress: () => onNavigate?.('HUNT') },
      ]
    );
  };

  return (
    <View
      style={[
        styles.container,
        {
          flexDirection: isLandscape ? 'row' : 'column',
          // Edge-to-edge landscape support handling for iPhone Dynamic Island & notch
          paddingLeft: isLandscape ? Math.max(insets.left, 12) : 0,
          paddingRight: isLandscape ? Math.max(insets.right, 12) : 0,
          paddingTop: isLandscape ? 0 : Math.max(insets.top, 12),
          paddingBottom: isLandscape ? 0 : Math.max(insets.bottom, 6),
        },
      ]}
    >
      {/* LEFT VIEWPORT: Operational Parchment Canvas (60% Width in Landscape) */}
      <View style={isLandscape ? styles.leftViewportLandscape : styles.leftViewportPortrait}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFillObject}
          initialRegion={region}
          customMapStyle={VINTAGE_MAP_STYLE}
          showsUserLocation={true}
          showsCompass={false}
          accessibilityLabel="Scavenger Hunt Map Canvas"
          accessibilityHint="Displays your real-time position and nearby hidden field treasures"
        >
          {activeTreasures.map((treasure) => (
            <Marker
              key={treasure.treasureId}
              coordinate={{
                latitude: treasure.location.latitude,
                longitude: treasure.location.longitude,
              }}
              title={treasure.title}
              description={`Hidden by ${treasure.creatorName}`}
            >
              <View
                style={styles.customMarker}
                accessible={true}
                accessibilityLabel={`Treasure marker: ${treasure.title}`}
              >
                <MaterialCommunityIcons name="treasure-chest" size={14} color="#F3ECD8" />
              </View>
            </Marker>
          ))}
        </MapView>

        {/* Compass Dial Indicator Overlay */}
        <View style={styles.compassOverlay} aria-hidden={true}>
          <Ionicons name="compass-outline" size={16} color="#2A2420" />
          <Text style={styles.compassText}>N</Text>
        </View>

        {/* Live Satellite Lock Badge */}
        <Animated.View style={[styles.locationBadge, animatedBadgeStyle]}>
          <Ionicons name="radio-sharp" size={12} color="#A64B2A" style={{ marginRight: 4 }} />
          <Text style={styles.locationBadgeText}>
            {isInitializingLocation
              ? 'ACQUIRING SATELLITE FIX...'
              : userLocation
              ? 'GPS SIGNAL LOCK'
              : 'TELEMETRY OFFLINE'}
          </Text>
        </Animated.View>

        {isInitializingLocation && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#A64B2A" />
          </View>
        )}
      </View>

      {/* RIGHT VIEWPORT: Command Console (40% Width in Landscape) */}
      <View style={isLandscape ? styles.rightViewportLandscape : styles.rightViewportPortrait}>
        {/* User Stats & Score Card */}
        <View
          style={styles.statusCard}
          accessible={true}
          accessibilityRole="header"
          accessibilityLabel={`Field Status: Total score ${userData?.totalPoints ?? 0} points, Rank ${getRankTitle(userData?.totalPoints)}`}
        >
          {/* Decorative Brass Rivets */}
          <View style={styles.rivetTL} />
          <View style={styles.rivetTR} />
          <View style={styles.rivetBL} />
          <View style={styles.rivetBR} />

          <View style={styles.statusHeaderRow}>
            <MaterialCommunityIcons name="star-four-points" size={12} color="#B08D57" />
            <Text style={styles.statusHeader}>FIELD STATUS</Text>
            <MaterialCommunityIcons name="star-four-points" size={12} color="#B08D57" />
          </View>

          <View style={styles.scoreRow}>
            <Text style={styles.scoreText}>
              {(userData?.totalPoints ?? 0).toLocaleString()}
            </Text>
            <Text style={styles.ptsText}>PTS</Text>
          </View>
          <Text style={styles.rankText}>{getRankTitle(userData?.totalPoints)}</Text>
        </View>

        {/* Real-time Field Signals Stream */}
        <View style={styles.signalsContainer}>
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons name="radio-handheld" size={14} color="#B08D57" />
            <Text style={styles.sectionTitle}>RECENT SIGNALS</Text>
          </View>

          {isLoadingFeed ? (
            <ActivityIndicator size="small" color="#B08D57" style={{ marginTop: 12 }} />
          ) : activityFeed.length === 0 ? (
            <View style={styles.emptyFeedBox}>
              <Text style={styles.emptyFeedText}>NO FIELD SIGNALS DETECTED</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.signalsScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {activityFeed.map((item, index) => (
                <Animated.View
                  key={item.activityId || index.toString()}
                  entering={FadeInDown.delay(index * 100).duration(400)}
                  style={styles.signalCard}
                  accessible={true}
                  accessibilityLabel={`Signal from ${item.username}: ${item.message}`}
                >
                  <View style={styles.signalHeader}>
                    <View style={styles.authorRow}>
                      <Ionicons name="radio-outline" size={12} color="#A64B2A" style={{ marginRight: 4 }} />
                      <Text style={styles.signalAuthor}>{item.username.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.signalTypeTag}>{item.type.replace('_', ' ')}</Text>
                  </View>
                  <Text style={styles.signalBody}>{item.message}</Text>
                </Animated.View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Primary Action Button: Stamp Location */}
        <AnimatedTouchableOpacity
          style={[styles.stampButton, animatedButtonStyle]}
          activeOpacity={0.85}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handleStampLocation}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Stamp Current Location"
          accessibilityHint="Triggers GPS coordinate logging to plant or record a field cache"
        >
          <Ionicons name="print-outline" size={16} color="#F3ECD8" style={{ marginRight: 6 }} />
          <Text style={styles.stampButtonText}>STAMP LOCATION</Text>
        </AnimatedTouchableOpacity>

        {/* Navigation Bar */}
        <FieldNavBar currentTab="MAP" onNavigate={onNavigate} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2C3B2E',
  },
  leftViewportLandscape: {
    flex: 0.60,
    position: 'relative',
    backgroundColor: '#E8DCC0',
    borderRightWidth: 3,
    borderColor: '#B08D57',
  },
  leftViewportPortrait: {
    height: '45%',
    position: 'relative',
    backgroundColor: '#E8DCC0',
    borderBottomWidth: 3,
    borderColor: '#B08D57',
  },
  rightViewportLandscape: {
    flex: 0.40,
    backgroundColor: '#2C3B2E',
    padding: 12,
    justifyContent: 'space-between',
  },
  rightViewportPortrait: {
    flex: 1,
    backgroundColor: '#2C3B2E',
    padding: 12,
    justifyContent: 'space-between',
  },
  loadingContainer: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    backgroundColor: '#E8DCC0',
    padding: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#B08D57',
  },
  /* Map Overlays */
  compassOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: '#E8DCC0',
    borderWidth: 1,
    borderColor: '#2A2420',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  compassText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2A2420',
  },
  locationBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 1,
  },
  customMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#A64B2A',
    borderWidth: 2,
    borderColor: '#F3ECD8',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
  },

  /* Field Status Card */
  statusCard: {
    backgroundColor: '#E8DCC0',
    borderWidth: 2,
    borderColor: '#B08D57',
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    position: 'relative',
    borderRadius: 2,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusHeader: {
    color: '#2A2420',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginVertical: 2,
  },
  scoreText: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#A64B2A',
    letterSpacing: 1,
  },
  ptsText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#A64B2A',
    marginLeft: 4,
  },
  rankText: {
    color: '#2A2420',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  /* Brass Rivets */
  rivetTL: { position: 'absolute', top: 3, left: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: '#B08D57' },
  rivetTR: { position: 'absolute', top: 3, right: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: '#B08D57' },
  rivetBL: { position: 'absolute', bottom: 3, left: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: '#B08D57' },
  rivetBR: { position: 'absolute', bottom: 3, right: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: '#B08D57' },

  /* Signals Feed */
  signalsContainer: {
    flex: 1,
    marginVertical: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  sectionTitle: {
    color: '#B08D57',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  signalsScroll: {
    flex: 1,
  },
  emptyFeedBox: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#B08D57',
    borderStyle: 'dashed',
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 6,
  },
  emptyFeedText: {
    color: '#E8DCC0',
    fontSize: 9,
    letterSpacing: 1,
  },
  signalCard: {
    backgroundColor: '#F3ECD8',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#B08D57',
    padding: 8,
  },
  signalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signalAuthor: {
    color: '#A64B2A',
    fontWeight: 'bold',
    fontSize: 10,
  },
  signalTypeTag: {
    color: '#8C8275',
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  signalBody: {
    color: '#2A2420',
    fontSize: 10,
    lineHeight: 13,
  },

  /* Stamp Button */
  stampButton: {
    backgroundColor: '#A64B2A',
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#B08D57',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    minHeight: 48, // Standard touch-target size requirement
  },
  stampButtonText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 12,
    letterSpacing: 2,
  },
});