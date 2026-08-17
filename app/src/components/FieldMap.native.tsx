import React from 'react';
import { View, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { TreasureDocument } from '../types/firestore';

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

interface FieldMapProps {
  mapRef: React.RefObject<MapView | null>;
  region: Region;
  treasures: TreasureDocument[];
  onMarkerPress: (treasure: TreasureDocument) => void;
}

export const FieldMap: React.FC<FieldMapProps> = ({
  mapRef,
  region,
  treasures,
  onMarkerPress,
}) => {
  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_DEFAULT}
      style={StyleSheet.absoluteFillObject}
      initialRegion={region}
      customMapStyle={VINTAGE_MAP_STYLE}
      showsUserLocation={true}
      showsCompass={false}
      accessibilityLabel="Scavenger Hunt Field Map Canvas"
      accessibilityHint="Displays active user position and nearby hidden field treasures within a 20km radius"
    >
      {treasures.map((treasure, index) => (
        <Marker
          key={treasure.treasureId || `treasure-marker-${index}`}
          coordinate={{
            latitude: treasure.location.latitude,
            longitude: treasure.location.longitude,
          }}
          title={treasure.title}
          description={`Hidden by ${treasure.creatorName}`}
          onPress={() => onMarkerPress(treasure)}
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
  );
};

const styles = StyleSheet.create({
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
});