import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TreasureDocument } from '../types/firestore';

interface FieldMapProps {
  mapRef: any;
  region: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  treasures: TreasureDocument[];
  onMarkerPress: (treasure: TreasureDocument) => void;
}

export const FieldMap: React.FC<FieldMapProps> = ({
  region,
  treasures,
  onMarkerPress,
}) => {
  return (
    <View style={styles.webCanvas}>
      <View style={styles.webHeader}>
        <MaterialCommunityIcons name="radar" size={16} color="#A64B2A" />
        <Text style={styles.webHeaderTitle}>WEB RADAR CONSOLE (TACTICAL GRID)</Text>
      </View>
      <Text style={styles.webCoordsText}>
        CENTER: {region.latitude.toFixed(4)} N, {region.longitude.toFixed(4)} E
      </Text>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {treasures.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>NO ACTIVE CACHES DETECTED IN WEB SECTOR</Text>
          </View>
        ) : (
          treasures.map((treasure, index) => (
            <TouchableOpacity
              key={treasure.treasureId || `web-marker-${index}`}
              style={styles.treasureCard}
              activeOpacity={0.8}
              onPress={() => onMarkerPress(treasure)}
              accessible={true}
              accessibilityLabel={`Treasure cache: ${treasure.title}`}
            >
              <View style={styles.iconCircle}>
                <MaterialCommunityIcons name="treasure-chest" size={16} color="#F3ECD8" />
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardTitle}>{treasure.title.toUpperCase()}</Text>
                <Text style={styles.cardSubtitle}>CREATOR: {treasure.creatorName}</Text>
                <Text style={styles.cardCoords}>
                  LAT: {treasure.location.latitude.toFixed(4)} | LONG: {treasure.location.longitude.toFixed(4)}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#B08D57" />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  webCanvas: {
    flex: 1,
    backgroundColor: '#E8DCC0',
    padding: 12,
  },
  webHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  webHeaderTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 1.5,
  },
  webCoordsText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#A64B2A',
    marginBottom: 10,
    letterSpacing: 1,
  },
  scrollContent: {
    gap: 8,
    paddingBottom: 12,
  },
  emptyContainer: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#B08D57',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  emptyText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 1,
  },
  treasureCard: {
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#A64B2A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 1,
  },
  cardSubtitle: {
    fontSize: 9,
    color: '#A64B2A',
    fontWeight: 'bold',
    marginTop: 2,
  },
  cardCoords: {
    fontSize: 8,
    color: '#8C8275',
    fontWeight: 'bold',
    marginTop: 2,
  },
});