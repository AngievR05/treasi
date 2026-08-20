import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
} from 'react';

import {
  StyleSheet,
  View,
} from 'react-native';

import MapView, {
  Circle,
  Marker,
  PROVIDER_DEFAULT,
} from 'react-native-maps';

import {
  MaterialCommunityIcons,
} from '@expo/vector-icons';

import {
  FieldMapHandle,
  FieldMapProps,
} from './FieldMap.types';

const VINTAGE_MAP_STYLE = [
  {
    elementType: 'geometry',
    stylers: [{ color: '#E8DCC0' }],
  },
  {
    elementType: 'labels.text.fill',
    stylers: [{ color: '#2A2420' }],
  },
  {
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#E8DCC0' }],
  },
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ color: '#B08D57' }],
  },
  {
    featureType: 'landscape.natural',
    elementType: 'geometry',
    stylers: [{ color: '#D8CBB0' }],
  },
  {
    featureType: 'poi',
    elementType: 'geometry',
    stylers: [{ color: '#C8BB9C' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#F3ECD8' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#2A2420' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#A0B2A6' }],
  },
];

export const FieldMap = forwardRef<
  FieldMapHandle,
  FieldMapProps
>(
  (
    {
      initialRegion,
      userLocation,
      treasures,
      onTreasurePress,
      onReady,
    },
    ref,
  ) => {
    const mapRef =
      useRef<MapView | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        setView: (
          region,
          animated = true,
        ) => {
          if (!mapRef.current) {
            return;
          }

          if (animated) {
            mapRef.current.animateToRegion(
              region,
              1000,
            );
          }
        },
      }),
      [],
    );

    return (
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={
          StyleSheet.absoluteFillObject
        }
        initialRegion={initialRegion}
        customMapStyle={
          VINTAGE_MAP_STYLE
        }
        showsUserLocation
        showsCompass={false}
        onMapReady={onReady}
        accessibilityLabel="Treasi field map"
      >
        {userLocation ? (
          <Circle
            center={{
              latitude:
                userLocation.latitude,
              longitude:
                userLocation.longitude,
            }}
            radius={20000}
            strokeColor="#B08D57"
            fillColor="rgba(176, 141, 87, 0.08)"
            strokeWidth={1}
          />
        ) : null}

        {treasures.map(
          (treasure) => (
            <Marker
              key={treasure.id}
              coordinate={{
                latitude:
                  treasure.latitude,
                longitude:
                  treasure.longitude,
              }}
              title={
                treasure.title
              }
              description={`Hidden by ${
                treasure.creatorName ||
                'Unknown explorer'
              }`}
              onPress={() =>
                onTreasurePress(
                  treasure.id,
                )
              }
            >
              <View
                style={
                  styles.customMarker
                }
              >
                <MaterialCommunityIcons
                  name="treasure-chest"
                  size={14}
                  color="#F3ECD8"
                />
              </View>
            </Marker>
          ),
        )}
      </MapView>
    );
  },
);

FieldMap.displayName =
  'FieldMapNative';

const styles =
  StyleSheet.create({
    customMarker: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor:
        '#A64B2A',
      borderWidth: 2,
      borderColor:
        '#F3ECD8',
      alignItems:
        'center',
      justifyContent:
        'center',
      elevation: 4,
    },
  });

export default FieldMap;