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
} from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { FieldNavBar } from '../components/FieldNavBar';

interface Props {
  onNavigate?: (screen: string) => void;
}

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

  // Sensor state for live coordinates
  const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isInitializingLocation, setIsInitializingLocation] = useState(true);

  // Initial region (Defaulting to Pretoria campus baseline until live GPS fix)
  const [region, setRegion] = useState<Region>({
    latitude: -25.7479,
    longitude: 28.2293,
    latitudeDelta: 0.008,
    longitudeDelta: 0.008,
  });

  // Mock field cache markers
  const [caches] = useState([
    { id: '1', title: 'OLD PROSPECT', latitude: -25.7465, longitude: 28.2280, code: 'A' },
    { id: '2', title: 'BEAR CREEK', latitude: -25.7490, longitude: 28.2250, code: 'B' },
    { id: '3', title: 'PINE RIDGE', latitude: -25.7440, longitude: 28.2310, code: 'C' },
  ]);

  const buttonScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    // Continuous opacity pulse effect for the radar badge
    pulseOpacity.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: 1000 }),
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
          setErrorMsg('Location permissions denied. Reverting to manual positioning.');
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

        // Subscribe to live position stream
        locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 3000,
            distanceInterval: 5,
          },
          (newLocation) => {
            setUserLocation(newLocation);
          }
        );
      } catch (err) {
        setErrorMsg('Error initializing GPS stream.');
        setIsInitializingLocation(false);
      }
    })();

    return () => {
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, []);

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const animatedBadgeStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.95);
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1.0);
  };

  const handleStampLocation = () => {
    const coordsText = userLocation
      ? `Lat: ${userLocation.coords.latitude.toFixed(4)}, Long: ${userLocation.coords.longitude.toFixed(4)}`
      : 'Current GPS telemetry logged.';

    Alert.alert(
      'LOCATION STAMPED',
      `${coordsText}\n\nReady to bury a new field cache here?`,
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
          // Account for iPhone Dynamic Island and landscape notch padding dynamically
          paddingLeft: isLandscape ? Math.max(insets.left, 12) : 0,
          paddingRight: isLandscape ? Math.max(insets.right, 12) : 0,
          paddingTop: isLandscape ? 0 : Math.max(insets.top, 12),
        },
      ]}
    >
      {/* LEFT VIEWPORT: Operational Parchment Canvas (60% Width in Landscape) */}
      <View style={styles.leftViewport}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFillObject}
          initialRegion={region}
          customMapStyle={VINTAGE_MAP_STYLE}
          showsUserLocation={true}
          showsCompass={false}
        >
          {caches.map((cache) => (
            <Marker
              key={cache.id}
              coordinate={{ latitude: cache.latitude, longitude: cache.longitude }}
              title={cache.title}
            >
              <View style={styles.customMarker}>
                <Text style={styles.markerText}>{cache.code}</Text>
              </View>
            </Marker>
          ))}
        </MapView>

        {/* Compass Indicator */}
        <View style={styles.compassOverlay}>
          <Ionicons name="compass-outline" size={16} color="#2A2420" />
          <Text style={styles.compassText}>N</Text>
        </View>

        {/* Live GPS Status Indicator Header */}
        <Animated.View style={[styles.locationBadge, animatedBadgeStyle]}>
          <Ionicons name="location-sharp" size={12} color="#A64B2A" style={{ marginRight: 4 }} />
          <Text style={styles.locationBadgeText}>
            {isInitializingLocation
              ? 'ACQUIRING SATELLITE FIX...'
              : userLocation
              ? 'GPS SIGNAL LOCK'
              : 'STATIC SIGNAL'}
          </Text>
        </Animated.View>

        {isInitializingLocation && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#A64B2A" />
          </View>
        )}
      </View>

      {/* RIGHT VIEWPORT: Command Console (40% Width in Landscape) */}
      <View style={styles.rightViewport}>
        {/* Field Status & User Score Card */}
        <View style={styles.statusCard}>
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
            <Text style={styles.scoreText}>2,340</Text>
            <Text style={styles.ptsText}>PTS</Text>
          </View>
          <Text style={styles.rankText}>RANK: TRAILBLAZER III</Text>
        </View>

        {/* Recent Signals Feed */}
        <View style={styles.signalsContainer}>
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons name="radio-handheld" size={14} color="#B08D57" />
            <Text style={styles.sectionTitle}>RECENT SIGNALS</Text>
          </View>

          <ScrollView
            style={styles.signalsScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            <View style={styles.signalCard}>
              <View style={styles.signalHeader}>
                <View style={styles.authorRow}>
                  <Ionicons name="radio-outline" size={12} color="#A64B2A" style={{ marginRight: 4 }} />
                  <Text style={styles.signalAuthor}>RANGER_JACK</Text>
                </View>
                <Text style={styles.signalTime}>10:26 AM</Text>
              </View>
              <Text style={styles.signalBody}>
                Found something interesting near Old Prospect. Meet you there?
              </Text>
            </View>

            <View style={styles.signalCard}>
              <View style={styles.signalHeader}>
                <View style={styles.authorRow}>
                  <Ionicons name="radio-outline" size={12} color="#A64B2A" style={{ marginRight: 4 }} />
                  <Text style={styles.signalAuthor}>WILDER_WREN</Text>
                </View>
                <Text style={styles.signalTime}>YESTERDAY</Text>
              </View>
              <Text style={styles.signalBody}>
                Dropped a supply cache near Bear Creek. Stay sharp out there.
              </Text>
            </View>
          </ScrollView>
        </View>

        {/* Primary Animated Stamp Action Button */}
        <AnimatedTouchableOpacity
          style={[styles.stampButton, animatedButtonStyle]}
          activeOpacity={0.85}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handleStampLocation}
        >
          <Ionicons name="print-outline" size={16} color="#F3ECD8" style={{ marginRight: 6 }} />
          <Text style={styles.stampButtonText}>STAMP LOCATION</Text>
        </AnimatedTouchableOpacity>

        {/* Decoupled Navigation Component */}
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
  leftViewport: {
    flex: 0.60,
    position: 'relative',
    backgroundColor: '#E8DCC0',
    borderRightWidth: 3,
    borderColor: '#B08D57',
  },
  rightViewport: {
    flex: 0.40,
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
  markerText: {
    color: '#F3ECD8',
    fontSize: 12,
    fontWeight: 'bold',
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
  /* Brass Rivet Detailing */
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
  signalTime: {
    color: '#8C8275',
    fontSize: 9,
  },
  signalBody: {
    color: '#2A2420',
    fontSize: 10,
    lineHeight: 13,
  },

  /* Primary Button */
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
  },
  stampButtonText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 12,
    letterSpacing: 2,
  },
});