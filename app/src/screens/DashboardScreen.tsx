import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  Alert,
  ActivityIndicator,
  Platform,
  Modal,
  Image,
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
  updateDoc,
  Timestamp,
} from 'firebase/firestore';

import { auth, db } from '../config/firebase';
import { FieldNavBar } from '../components/FieldNavBar';
import {
  UserDocument,
  TreasureDocument,
  ActivityFeedDocument,
} from '../types/firestore';

export interface NavigationParams {
  treasureId?: string;
  mode?: 'hunt' | 'create';
  latitude?: number;
  longitude?: number;
  [key: string]: any;
}

interface Props {
  onNavigate?: (screen: string, params?: NavigationParams) => void;
}

// Vintage Map Styling Matrix (Sepia & Forest Palette)
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

/**
 * Calculates Haversine distance between two coordinates in kilometers.
 */
const calculateHaversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Formats distances human-readably (meters if < 1km, kilometers otherwise).
 */
const formatDistanceText = (distKm: number): string => {
  if (distKm < 1) {
    return `${Math.round(distKm * 1000)} M AWAY`;
  }
  return `${distKm.toFixed(2)} KM AWAY`;
};

/**
 * Formats Firestore timestamps to relative time strings.
 */
const formatRelativeTime = (timestamp?: Timestamp): string => {
  if (!timestamp) return 'JUST NOW';
  const now = Date.now();
  const millis = typeof timestamp.toMillis === 'function' ? timestamp.toMillis() : Date.now();
  const diffInSeconds = Math.floor((now - millis) / 1000);

  if (diffInSeconds < 60) return 'JUST NOW';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}M AGO`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}H AGO`;
  return `${Math.floor(diffInSeconds / 86400)}D AGO`;
};

/**
 * Validates coordinate integrity to prevent MapView rendering crashes.
 */
const isValidCoordinate = (lat?: number, lng?: number): boolean => {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
};

export const DashboardScreen: React.FC<Props> = ({ onNavigate }) => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);

  const isNavigatingRef = useRef(false);
  const hasInitialCenteredRef = useRef(false);
  const currentUser = auth.currentUser;

  // Firestore & Application State
  const [userData, setUserData] = useState<UserDocument | null>(null);
  const [allRawTreasures, setAllRawTreasures] = useState<TreasureDocument[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityFeedDocument[]>([]);
  const [isLoadingFeed, setIsLoadingFeed] = useState(true);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  // GPS Telemetry State
  const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
  const [isInitializingLocation, setIsInitializingLocation] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);

  // Selected Treasure Modal Overlay State
  const [selectedTreasure, setSelectedTreasure] = useState<TreasureDocument | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  // Region State
  const [region, setRegion] = useState<Region>({
    latitude: -25.7479,
    longitude: 28.2293,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  });

  // Reanimated Shared Values
  const buttonScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(1);

  // Rank Title Calculation Matrix
  const getRankTitle = (points: number = 0): string => {
    if (points >= 3000) return 'RANK: MASTER EXPLORER';
    if (points >= 1500) return 'RANK: TRAILBLAZER III';
    if (points >= 500) return 'RANK: PATHFINDER II';
    return 'RANK: NOVICE SCOUT I';
  };

  // Safe Navigation Wrapper preventing fast double taps
  const safeNavigate = useCallback(
    (screen: string, params?: NavigationParams) => {
      if (isNavigatingRef.current) return;
      isNavigatingRef.current = true;
      onNavigate?.(screen, params);

      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 600);
    },
    [onNavigate]
  );

  // Firestore Real-Time Subscriptions
  useEffect(() => {
    if (!currentUser) return;
    setFirestoreError(null);

    // 1. User Document Listener
    const userDocRef = doc(db, 'users', currentUser.uid);
    const unsubscribeUser = onSnapshot(
      userDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setUserData(snapshot.data() as UserDocument);
        }
      },
      () => setFirestoreError('USER PROFILE TELEMETRY OFFLINE')
    );

    // 2. Unarchived Treasures Query
    const treasuresQuery = query(
      collection(db, 'treasures'),
      where('isArchived', '==', false)
    );
    const unsubscribeTreasures = onSnapshot(
      treasuresQuery,
      (snapshot) => {
        const treasures: TreasureDocument[] = [];
        snapshot.forEach((docSnap) => {
          const rawData = docSnap.data() as TreasureDocument;
          if (
            rawData &&
            rawData.location &&
            isValidCoordinate(rawData.location.latitude, rawData.location.longitude)
          ) {
            treasures.push({
              ...rawData,
              treasureId: rawData.treasureId || docSnap.id,
            });
          }
        });
        setAllRawTreasures(treasures);
      },
      () => setFirestoreError('TREASURE CACHE FIELD SYNC FAILED')
    );

    // 3. Activity Feed Listener
    const activityQuery = query(
      collection(db, 'activity_feed'),
      orderBy('createdAt', 'desc'),
      limit(10)
    );
    const unsubscribeActivity = onSnapshot(
      activityQuery,
      (snapshot) => {
        const activities: ActivityFeedDocument[] = [];
        snapshot.forEach((docSnap) => {
          const rawData = docSnap.data() as ActivityFeedDocument;
          activities.push({
            ...rawData,
            activityId: rawData.activityId || docSnap.id,
          });
        });
        setActivityFeed(activities);
        setIsLoadingFeed(false);
      },
      () => {
        setIsLoadingFeed(false);
        setFirestoreError('FIELD SIGNALS FEED OFFLINE');
      }
    );

    return () => {
      unsubscribeUser();
      unsubscribeTreasures();
      unsubscribeActivity();
    };
  }, [currentUser]);

  // Location Service Initialization & Watching
  const initializeLocationService = useCallback(async () => {
    setIsInitializingLocation(true);
    setLocationError(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('GPS PERMISSION DENIED. ENABLE LOCATION IN SYSTEM SETTINGS.');
        setIsInitializingLocation(false);
        return null;
      }

      // Initial Position Fix
      const initialPosition = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }).catch(() => null);

      if (initialPosition) {
        setUserLocation(initialPosition);
        const newRegion = {
          latitude: initialPosition.coords.latitude,
          longitude: initialPosition.coords.longitude,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        };
        setRegion(newRegion);

        if (!hasInitialCenteredRef.current) {
          hasInitialCenteredRef.current = true;
          if (Platform.OS !== 'web' && mapRef.current) {
            mapRef.current.animateToRegion(newRegion, 1200);
          }
        }
      } else {
        setLocationError('SATELLITE FIX TIMEOUT. RETRYING POSITIONAL TELEMETRY...');
      }

      // Continuous Positional Watcher
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,
          distanceInterval: 15,
        },
        (newLocation) => {
          setUserLocation(newLocation);
          setLocationError(null);
        }
      );

      setIsInitializingLocation(false);
      return subscription;
    } catch {
      setLocationError('HARDWARE GPS TELEMETRY UNAVAILABLE');
      setIsInitializingLocation(false);
      return null;
    }
  }, []);

  // Set up Pulse Animation & GPS Watcher
  useEffect(() => {
    pulseOpacity.value = withRepeat(
      withSequence(
        withTiming(0.3, { duration: 1000 }),
        withTiming(1.0, { duration: 1000 })
      ),
      -1,
      true
    );

    let activeSubscription: Location.LocationSubscription | null = null;
    initializeLocationService().then((sub) => {
      activeSubscription = sub;
    });

    return () => {
      if (activeSubscription) {
        activeSubscription.remove();
      }
    };
  }, [initializeLocationService, pulseOpacity]);

  // Filter Active Treasures within 20 KM Range
  const nearbyTreasures = useMemo(() => {
    if (!userLocation) return allRawTreasures;
    const userLat = userLocation.coords.latitude;
    const userLon = userLocation.coords.longitude;

    return allRawTreasures.filter((treasure) => {
      if (!treasure.location || !isValidCoordinate(treasure.location.latitude, treasure.location.longitude)) {
        return false;
      }
      const distanceKm = calculateHaversineDistance(
        userLat,
        userLon,
        treasure.location.latitude,
        treasure.location.longitude
      );
      return distanceKm <= 20;
    });
  }, [userLocation, allRawTreasures]);

  // Animated Styles
  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const animatedBadgeStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  // Recenter Map Camera on User Location
  const handleRecenterMap = () => {
    if (!userLocation) {
      Alert.alert('GPS UNFIXED', 'Waiting for satellite position lock.');
      return;
    }
    const targetRegion = {
      latitude: userLocation.coords.latitude,
      longitude: userLocation.coords.longitude,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    };
    setRegion(targetRegion);
    if (Platform.OS !== 'web' && mapRef.current) {
      mapRef.current.animateToRegion(targetRegion, 1000);
    }
  };

  // Stamp Location Action with GPS Lock & Accuracy Safeguards
  const handleStampLocation = () => {
    if (isNavigatingRef.current) return;

    if (!userLocation) {
      Alert.alert(
        'TELEMETRY OFFLINE',
        'Cannot stamp location without an active GPS lock. Verify location services and retry.'
      );
      return;
    }

    const { latitude, longitude, accuracy } = userLocation.coords;

    if (accuracy && accuracy > 100) {
      Alert.alert(
        'POOR GPS ACCURACY',
        `Current GPS fix uncertainty is ±${Math.round(accuracy)}m. Do you wish to stamp these coordinates anyway?`,
        [
          { text: 'CANCEL', style: 'cancel' },
          {
            text: 'STAMP ANYWAY',
            onPress: () =>
              safeNavigate('INVENTORY', {
                mode: 'create',
                latitude: Number(latitude.toFixed(6)),
                longitude: Number(longitude.toFixed(6)),
              }),
          },
        ]
      );
      return;
    }

    safeNavigate('INVENTORY', {
      mode: 'create',
      latitude: Number(latitude.toFixed(6)),
      longitude: Number(longitude.toFixed(6)),
    });
  };

  // Marker Selection Handler
  const handleMarkerPress = (treasure: TreasureDocument) => {
    setSelectedTreasure(treasure);
  };

  // Archive Cache Action
  const handleArchiveTreasure = async (treasureId: string) => {
    if (!treasureId) return;
    setIsArchiving(true);
    try {
      const treasureRef = doc(db, 'treasures', treasureId);
      await updateDoc(treasureRef, { isArchived: true });
      setSelectedTreasure(null);
      Alert.alert('CACHE ARCHIVED', 'The treasure cache has been deactivated from the field map.');
    } catch (error: any) {
      Alert.alert('ACTION FAILED', error.message || 'Unable to update cache status.');
    } finally {
      setIsArchiving(false);
    }
  };

  const getDisplayUsername = (item: ActivityFeedDocument): string => {
    if (item.userId === currentUser?.uid) {
      return (userData?.username || currentUser?.displayName || 'YOU').toUpperCase();
    }
    return (item.username || 'FIELD EXPLORER').toUpperCase();
  };

  // OpenStreetMap Web Frame Embed URL
  const webOsmUrl = useMemo(() => {
    const lat = region.latitude;
    const lon = region.longitude;
    const bbox = `${lon - 0.03},${lat - 0.03},${lon + 0.03},${lat + 0.03}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
  }, [region]);

  const selectedDistance = useMemo(() => {
    if (!selectedTreasure || !userLocation) return null;
    return calculateHaversineDistance(
      userLocation.coords.latitude,
      userLocation.coords.longitude,
      selectedTreasure.location.latitude,
      selectedTreasure.location.longitude
    );
  }, [selectedTreasure, userLocation]);

  const isSelectedTreasureCreator = selectedTreasure?.creatorId === currentUser?.uid;

  return (
    <View
      style={[
        styles.container,
        {
          flexDirection: isLandscape ? 'row' : 'column',
          paddingLeft: isLandscape ? Math.max(insets.left, 12) : 0,
          paddingRight: isLandscape ? Math.max(insets.right, 12) : 0,
          paddingTop: isLandscape ? 0 : Math.max(insets.top, 12),
          paddingBottom: isLandscape ? 0 : Math.max(insets.bottom, 6),
        },
      ]}
    >
      {/* LEFT VIEWPORT: Operational Map Canvas */}
      <View style={isLandscape ? styles.leftViewportLandscape : styles.leftViewportPortrait}>
        {Platform.OS === 'web' ? (
          <View style={styles.webMapContainer}>
            <iframe
              title="Treasi Field Map"
              src={webOsmUrl}
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          </View>
        ) : (
          <MapView
            ref={mapRef}
            provider={PROVIDER_DEFAULT}
            style={StyleSheet.absoluteFillObject}
            initialRegion={region}
            customMapStyle={VINTAGE_MAP_STYLE}
            showsUserLocation={true}
            showsCompass={false}
            onMapReady={() => setIsMapReady(true)}
            accessibilityLabel="Scavenger Hunt Field Map Canvas"
          >
            {nearbyTreasures.map((treasure, index) => (
              <Marker
                key={treasure.treasureId || `treasure-marker-${index}`}
                coordinate={{
                  latitude: treasure.location.latitude,
                  longitude: treasure.location.longitude,
                }}
                title={treasure.title}
                description={`Hidden by ${treasure.creatorName}`}
                onPress={() => handleMarkerPress(treasure)}
              >
                <View style={styles.customMarker}>
                  <MaterialCommunityIcons name="treasure-chest" size={14} color="#F3ECD8" />
                </View>
              </Marker>
            ))}
          </MapView>
        )}

        {/* Compass Banner */}
        <View style={styles.compassOverlay} aria-hidden={true}>
          <Ionicons name="compass-outline" size={16} color="#2A2420" />
          <Text style={styles.compassText}>N</Text>
        </View>

        {/* Range Lock Badge */}
        <View style={styles.radiusBadge} aria-hidden={true}>
          <MaterialCommunityIcons name="radar" size={12} color="#2A2420" style={{ marginRight: 4 }} />
          <Text style={styles.radiusBadgeText}>20KM RANGE LOCK ({nearbyTreasures.length})</Text>
        </View>

        {/* Recenter Map Button */}
        <TouchableOpacity
          style={styles.recenterButton}
          onPress={handleRecenterMap}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Recenter map on current GPS location"
        >
          <Ionicons name="locate-sharp" size={16} color="#2A2420" />
        </TouchableOpacity>

        {/* Live Location Telemetry Badge */}
        <Animated.View style={[styles.locationBadge, animatedBadgeStyle]}>
          <Ionicons
            name="radio-sharp"
            size={12}
            color={
              userLocation?.coords?.accuracy && userLocation.coords.accuracy > 100
                ? '#B08D57'
                : '#A64B2A'
            }
            style={{ marginRight: 4 }}
          />
          <Text style={styles.locationBadgeText}>
            {isInitializingLocation
              ? 'ACQUIRING SATELLITE FIX...'
              : userLocation
              ? userLocation.coords.accuracy && userLocation.coords.accuracy > 100
                ? `WEAK FIX (±${Math.round(userLocation.coords.accuracy)}M)`
                : 'GPS SIGNAL LOCK'
              : 'TELEMETRY OFFLINE'}
          </Text>
        </Animated.View>

        {/* GPS Error Banner */}
        {locationError && (
          <View style={styles.mapErrorBanner}>
            <Ionicons name="warning-outline" size={14} color="#F3ECD8" style={{ marginRight: 6 }} />
            <Text style={styles.mapErrorText}>{locationError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={initializeLocationService}>
              <Text style={styles.retryButtonText}>RETRY</Text>
            </TouchableOpacity>
          </View>
        )}

        {(isInitializingLocation || !isMapReady) && Platform.OS !== 'web' && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#A64B2A" />
          </View>
        )}
      </View>

      {/* RIGHT VIEWPORT: Command Console */}
      <View style={isLandscape ? styles.rightViewportLandscape : styles.rightViewportPortrait}>
        {firestoreError && (
          <View style={styles.firestoreErrorCard}>
            <Ionicons name="cloud-offline-outline" size={12} color="#F3ECD8" style={{ marginRight: 4 }} />
            <Text style={styles.firestoreErrorText}>{firestoreError}</Text>
          </View>
        )}

        {/* User Stats Card */}
        <View style={styles.statusCard}>
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

        {/* Field Signals Stream */}
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
                  key={item.activityId || `activity-signal-${index}`}
                  entering={FadeInDown.delay(index * 100).duration(400)}
                  style={styles.signalCard}
                >
                  <View style={styles.signalHeader}>
                    <View style={styles.authorRow}>
                      <Ionicons name="radio-outline" size={12} color="#A64B2A" style={{ marginRight: 4 }} />
                      <Text style={styles.signalAuthor}>{getDisplayUsername(item)}</Text>
                    </View>
                    <Text style={styles.signalTimeTag}>{formatRelativeTime(item.createdAt)}</Text>
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
          onPressIn={() => (buttonScale.value = withSpring(0.94))}
          onPressOut={() => (buttonScale.value = withSpring(1.0))}
          onPress={handleStampLocation}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="Stamp Current Location"
        >
          <Ionicons name="print-outline" size={16} color="#F3ECD8" style={{ marginRight: 6 }} />
          <Text style={styles.stampButtonText}>STAMP LOCATION</Text>
        </AnimatedTouchableOpacity>

        {/* Navigation Bar */}
        <FieldNavBar currentTab="MAP" onNavigate={onNavigate} />
      </View>

      {/* TREASURE DETAILS MODAL */}
      <Modal
        visible={!!selectedTreasure}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectedTreasure(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <MaterialCommunityIcons name="treasure-chest" size={20} color="#A64B2A" />
              <Text style={styles.modalTitle}>
                {selectedTreasure?.title?.toUpperCase() || 'TREASURE CACHE'}
              </Text>
              <TouchableOpacity
                onPress={() => setSelectedTreasure(null)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Close treasure modal"
              >
                <Ionicons name="close-sharp" size={20} color="#2A2420" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalDivider} />

            <ScrollView style={styles.modalScrollBody}>
              <View style={styles.modalMetaRow}>
                <Ionicons name="person-outline" size={12} color="#B08D57" />
                <Text style={styles.modalMetaLabel}>CREATOR:</Text>
                <Text style={styles.modalMetaValue}>
                  {selectedTreasure?.creatorName || 'UNKNOWN EXPLORER'}
                </Text>
              </View>

              <View style={styles.modalMetaRow}>
                <Ionicons name="navigate-outline" size={12} color="#B08D57" />
                <Text style={styles.modalMetaLabel}>DISTANCE:</Text>
                <Text style={styles.modalMetaValue}>
                  {selectedDistance !== null
                    ? formatDistanceText(selectedDistance)
                    : 'CALCULATING...'}
                </Text>
              </View>

              {selectedTreasure?.location && (
                <View style={styles.modalMetaRow}>
                  <Ionicons name="location-outline" size={12} color="#B08D57" />
                  <Text style={styles.modalMetaLabel}>COORDINATES:</Text>
                  <Text style={styles.modalMetaValue}>
                    {`${selectedTreasure.location.latitude.toFixed(
                      4
                    )}, ${selectedTreasure.location.longitude.toFixed(4)}`}
                  </Text>
                </View>
              )}

              {selectedTreasure?.hint ? (
                <View style={styles.modalHintBox}>
                  <Text style={styles.modalHintTitle}>CACHE HINT:</Text>
                  <Text style={styles.modalHintText}>{selectedTreasure.hint}</Text>
                </View>
              ) : null}

              {selectedTreasure?.imageUrl ? (
                <Image
                  source={{ uri: selectedTreasure.imageUrl }}
                  style={styles.modalTreasureImage}
                  resizeMode="cover"
                />
              ) : null}
            </ScrollView>

            <View style={styles.modalActionsRow}>
              {isSelectedTreasureCreator ? (
                <TouchableOpacity
                  style={[styles.modalActionButton, styles.modalArchiveButton]}
                  disabled={isArchiving}
                  onPress={() => {
                    Alert.alert(
                      'CONFIRM ARCHIVE',
                      'Deactivate this treasure cache from the field map?',
                      [
                        { text: 'CANCEL', style: 'cancel' },
                        {
                          text: 'ARCHIVE',
                          style: 'destructive',
                          onPress: () => handleArchiveTreasure(selectedTreasure!.treasureId),
                        },
                      ]
                    );
                  }}
                >
                  {isArchiving ? (
                    <ActivityIndicator size="small" color="#F3ECD8" />
                  ) : (
                    <>
                      <Ionicons name="archive-outline" size={14} color="#F3ECD8" style={{ marginRight: 4 }} />
                      <Text style={styles.modalButtonText}>ARCHIVE CACHE</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.modalActionButton, styles.modalTrackButton]}
                  onPress={() => {
                    const target = selectedTreasure;
                    setSelectedTreasure(null);
                    if (target) {
                      safeNavigate('HUNT', {
                        treasureId: target.treasureId,
                        mode: 'hunt',
                        latitude: target.location.latitude,
                        longitude: target.location.longitude,
                      });
                    }
                  }}
                >
                  <Ionicons name="compass-outline" size={14} color="#F3ECD8" style={{ marginRight: 4 }} />
                  <Text style={styles.modalButtonText}>TRACK IN HUNT</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.modalActionButton, styles.modalCloseButton]}
                onPress={() => setSelectedTreasure(null)}
              >
                <Text style={styles.modalCloseButtonText}>DISMISS</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2C3B2E',
  },
  leftViewportLandscape: {
    flex: 0.6,
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
    flex: 0.4,
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
  webMapContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#E8DCC0',
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
  radiusBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: '#E8DCC0',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  radiusBadgeText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 1,
  },
  recenterButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: '#E8DCC0',
    borderWidth: 1,
    borderColor: '#B08D57',
    padding: 8,
    borderRadius: 20,
    elevation: 3,
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
  mapErrorBanner: {
    position: 'absolute',
    top: 45,
    alignSelf: 'center',
    backgroundColor: '#A64B2A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '90%',
  },
  mapErrorText: {
    color: '#F3ECD8',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  retryButton: {
    backgroundColor: '#F3ECD8',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
    marginLeft: 8,
  },
  retryButtonText: {
    color: '#2A2420',
    fontSize: 8,
    fontWeight: 'bold',
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
  },
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
  firestoreErrorCard: {
    backgroundColor: '#A64B2A',
    padding: 4,
    borderRadius: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  firestoreErrorText: {
    color: '#F3ECD8',
    fontSize: 8,
    fontWeight: 'bold',
  },
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
  signalTimeTag: {
    color: '#8C8275',
    fontSize: 8,
    fontWeight: 'bold',
  },
  signalBody: {
    color: '#2A2420',
    fontSize: 10,
    lineHeight: 13,
  },
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
    minHeight: 48,
  },
  stampButtonText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 12,
    letterSpacing: 2,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#F3ECD8',
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#B08D57',
    padding: 16,
    maxHeight: '85%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  modalTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 1,
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#B08D57',
    marginVertical: 10,
  },
  modalScrollBody: {
    marginBottom: 12,
  },
  modalMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  modalMetaLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#8C8275',
  },
  modalMetaValue: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#2A2420',
  },
  modalHintBox: {
    backgroundColor: '#E8DCC0',
    borderWidth: 1,
    borderColor: '#B08D57',
    padding: 8,
    borderRadius: 4,
    marginTop: 8,
  },
  modalHintTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#A64B2A',
    marginBottom: 2,
  },
  modalHintText: {
    fontSize: 11,
    color: '#2A2420',
    lineHeight: 15,
  },
  modalTreasureImage: {
    width: '100%',
    height: 140,
    borderRadius: 4,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#B08D57',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  modalActionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTrackButton: {
    backgroundColor: '#2C3B2E',
  },
  modalArchiveButton: {
    backgroundColor: '#A64B2A',
  },
  modalCloseButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#B08D57',
    flex: 0.5,
  },
  modalButtonText: {
    color: '#F3ECD8',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  modalCloseButtonText: {
    color: '#2A2420',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});