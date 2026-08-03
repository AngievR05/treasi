import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  Alert,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { FieldNavBar, NavigationTab } from '../components/FieldNavBar';

interface Props {
  onNavigate: (screen: string) => void;
}

// Custom map styling matrix array to transform map vectors into vintage parchment tones
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

export const DashboardScreen: React.FC<Props> = ({ onNavigate }) => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Mock initial coordinates (replace with live Expo Location state in Phase 3)
  const [region] = useState({
    latitude: -25.7479,
    longitude: 28.2293,
    latitudeDelta: 0.0122,
    longitudeDelta: 0.0122,
  });

  // Mock markers representing hidden field caches
  const [caches] = useState([
    { id: '1', title: 'OLD PROSPECT', latitude: -25.7465, longitude: 28.2280, code: 'A' },
    { id: '2', title: 'BEAR CREEK', latitude: -25.7490, longitude: 28.2250, code: 'A' },
    { id: '3', title: 'PINE RIDGE', latitude: -25.7440, longitude: 28.2310, code: 'A' },
  ]);

  const handleStampLocation = () => {
    Alert.alert(
      'LOCATION STAMPED',
      'Current GPS coordinates logged to Field Register. Ready to bury a new cache?',
      [
        { text: 'CANCEL', style: 'cancel' },
        { text: 'BURY CACHE', onPress: () => onNavigate('HUNT') },
      ]
    );
  };

  return (
    <View style={[styles.container, { flexDirection: isLandscape ? 'row' : 'column' }]}>
      {/* LEFT VIEWPORT: Operational Map Canvas (60% Width in Landscape) */}
      <View style={styles.leftViewport}>
        <MapView
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

        {/* Vintage Top-Left Compass Overlay Indicator */}
        <View style={styles.compassOverlay}>
          <Text style={styles.compassText}>🧭 N</Text>
        </View>

        {/* You Are Here Indicator Header */}
        <View style={styles.locationBadge}>
          <Text style={styles.locationBadgeText}>YOU ARE HERE</Text>
        </View>
      </View>

      {/* RIGHT VIEWPORT: Command Console (40% Width in Landscape) */}
      <View style={styles.rightViewport}>
        {/* Field Status & User Score Card */}
        <View style={styles.statusCard}>
          <View style={styles.rivetTL} />
          <View style={styles.rivetTR} />
          <View style={styles.rivetBL} />
          <View style={styles.rivetBR} />
          
          <Text style={styles.statusHeader}>★ FIELD STATUS ★</Text>
          <View style={styles.scoreRow}>
            <Text style={styles.scoreText}>2,340</Text>
            <Text style={styles.ptsText}>PTS</Text>
          </View>
          <Text style={styles.rankText}>RANK: TRAILBLAZER III</Text>
        </View>

        {/* Recent Signals Feed */}
        <View style={styles.signalsContainer}>
          <Text style={styles.sectionTitle}>★ RECENT SIGNALS</Text>
          <ScrollView
            style={styles.signalsScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            <View style={styles.signalCard}>
              <View style={styles.signalHeader}>
                <Text style={styles.signalAuthor}>((o)) RANGER_JACK</Text>
                <Text style={styles.signalTime}>10:26 AM</Text>
              </View>
              <Text style={styles.signalBody}>
                Found something interesting near Old Prospect. Meet you there?
              </Text>
            </View>

            <View style={styles.signalCard}>
              <View style={styles.signalHeader}>
                <Text style={styles.signalAuthor}>((o)) WILDER_WREN</Text>
                <Text style={styles.signalTime}>YESTERDAY</Text>
              </View>
              <Text style={styles.signalBody}>
                Dropped a supply cache near Bear Creek. Stay sharp out there.
              </Text>
            </View>
          </ScrollView>
        </View>

        {/* Primary Action Button */}
        <TouchableOpacity
          style={styles.stampButton}
          activeOpacity={0.8}
          onPress={handleStampLocation}
        >
          <Text style={styles.stampButtonText}>STAMP LOCATION</Text>
        </TouchableOpacity>

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
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    position: 'relative',
    borderRadius: 2,
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
  sectionTitle: {
    color: '#B08D57',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 6,
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
    alignItems: 'center',
    marginBottom: 8,
  },
  stampButtonText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 12,
    letterSpacing: 2,
  },
});