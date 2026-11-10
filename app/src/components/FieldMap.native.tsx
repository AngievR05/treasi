import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';

import {
  Platform,
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

import type {
  FieldMapHandle,
  FieldMapProps,
  FieldMapRegion,
  FieldMapTreasure,
} from './FieldMap.types';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const FIELD_RADIUS_METRES = 20_000;

const MAP_ANIMATION_DURATION_MS =
  450;

const COLOURS = {
  parchment: '#E8DCC0',
  parchmentLight: '#F3ECD8',
  ink: '#2A2420',
  brass: '#B08D57',
  sienna: '#A64B2A',
  water: '#A0B2A6',
  landscape: '#D8CBB0',
  pointOfInterest: '#C8BB9C',
} as const;

/*
 * Google map styling is supported where the active native map provider
 * supports custom styling. Apple Maps uses its own muted system style.
 */
const VINTAGE_MAP_STYLE = [
  {
    elementType: 'geometry',
    stylers: [
      {
        color:
          COLOURS.parchment,
      },
    ],
  },
  {
    elementType:
      'labels.text.fill',
    stylers: [
      {
        color:
          COLOURS.ink,
      },
    ],
  },
  {
    elementType:
      'labels.text.stroke',
    stylers: [
      {
        color:
          COLOURS.parchment,
      },
    ],
  },
  {
    featureType:
      'administrative',
    elementType:
      'geometry',
    stylers: [
      {
        color:
          COLOURS.brass,
      },
    ],
  },
  {
    featureType:
      'landscape.natural',
    elementType:
      'geometry',
    stylers: [
      {
        color:
          COLOURS.landscape,
      },
    ],
  },
  {
    featureType:
      'poi',
    elementType:
      'geometry',
    stylers: [
      {
        color:
          COLOURS.pointOfInterest,
      },
    ],
  },
  {
    featureType:
      'road',
    elementType:
      'geometry',
    stylers: [
      {
        color:
          COLOURS.parchmentLight,
      },
    ],
  },
  {
    featureType:
      'road',
    elementType:
      'labels.text.fill',
    stylers: [
      {
        color:
          COLOURS.ink,
      },
    ],
  },
  {
    featureType:
      'water',
    elementType:
      'geometry',
    stylers: [
      {
        color:
          COLOURS.water,
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Confirms that coordinates are safe before passing them to the native map.
const isValidCoordinate = (
  latitude: unknown,
  longitude: unknown,
): boolean =>
  typeof latitude ===
    'number' &&
  typeof longitude ===
    'number' &&
  Number.isFinite(
    latitude,
  ) &&
  Number.isFinite(
    longitude,
  ) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

// Keeps map deltas inside safe geographic limits.
const normaliseDelta = (
  value: number,
  maximum: number,
): number => {
  if (
    !Number.isFinite(
      value,
    )
  ) {
    return 0.08;
  }

  return Math.min(
    maximum,
    Math.max(
      0.0005,
      Math.abs(
        value,
      ),
    ),
  );
};

// Sanitises a region before issuing native map commands.
const normaliseRegion = (
  region: FieldMapRegion,
): FieldMapRegion => ({
  latitude:
    Number.isFinite(
      region.latitude,
    )
      ? Math.min(
          90,
          Math.max(
            -90,
            region.latitude,
          ),
        )
      : 0,

  longitude:
    Number.isFinite(
      region.longitude,
    )
      ? Math.min(
          180,
          Math.max(
            -180,
            region.longitude,
          ),
        )
      : 0,

  latitudeDelta:
    normaliseDelta(
      region.latitudeDelta,
      180,
    ),

  longitudeDelta:
    normaliseDelta(
      region.longitudeDelta,
      360,
    ),
});

// Filters malformed records so a bad Firestore record cannot crash the map.
const isRenderableTreasure = (
  treasure: FieldMapTreasure,
): boolean =>
  typeof treasure.id ===
    'string' &&
  treasure.id.trim()
    .length > 0 &&
  isValidCoordinate(
    treasure.latitude,
    treasure.longitude,
  );

/* -------------------------------------------------------------------------- */
/* Native field map                                                           */
/* -------------------------------------------------------------------------- */

export const FieldMap =
  forwardRef<
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
        useRef<MapView | null>(
          null,
        );

      const hasReportedReadyRef =
        useRef(false);

      /*
       * initialRegion is intentionally captured once.
       * Subsequent movement should happen through setView().
       */
      const initialRegionRef =
        useRef<FieldMapRegion>(
          normaliseRegion(
            initialRegion,
          ),
        );

      /* -------------------------------------------------------------------- */
      /* Valid map data                                                       */
      /* -------------------------------------------------------------------- */

      const validTreasures =
        useMemo(
          () =>
            treasures.filter(
              isRenderableTreasure,
            ),
          [
            treasures,
          ],
        );

      const validUserLocation =
        useMemo(
          () => {
            if (
              !userLocation ||
              !isValidCoordinate(
                userLocation.latitude,
                userLocation.longitude,
              )
            ) {
              return null;
            }

            return {
              latitude:
                userLocation.latitude,

              longitude:
                userLocation.longitude,
            };
          },
          [
            userLocation,
          ],
        );

      /* -------------------------------------------------------------------- */
      /* Public map API                                                       */
      /* -------------------------------------------------------------------- */

      useImperativeHandle(
        ref,
        () => ({
          setView: (
            region,
            animated = true,
          ) => {
            const map =
              mapRef.current;

            if (!map) {
              return;
            }

            const safeRegion =
              normaliseRegion(
                region,
              );

            /*
             * Duration zero provides an immediate move while preserving
             * the same cross-platform API as an animated region change.
             */
            map.animateToRegion(
              safeRegion,
              animated
                ? MAP_ANIMATION_DURATION_MS
                : 0,
            );
          },
        }),
        [],
      );

      /* -------------------------------------------------------------------- */
      /* Ready callback                                                       */
      /* -------------------------------------------------------------------- */

      const handleMapReady =
        useCallback(
          () => {
            if (
              hasReportedReadyRef.current
            ) {
              return;
            }

            hasReportedReadyRef.current =
              true;

            onReady?.();
          },
          [
            onReady,
          ],
        );

      /* -------------------------------------------------------------------- */
      /* Render                                                               */
      /* -------------------------------------------------------------------- */

      return (
        <View
          style={
            styles.container
          }
        >
          <MapView
            ref={
              mapRef
            }
            provider={
              PROVIDER_DEFAULT
            }
            style={
              StyleSheet.absoluteFill
            }
            initialRegion={
              initialRegionRef.current
            }
            mapType={
              Platform.OS ===
              'ios'
                ? 'mutedStandard'
                : 'standard'
            }
            customMapStyle={
              Platform.OS ===
              'android'
                ? VINTAGE_MAP_STYLE
                : undefined
            }
            loadingEnabled
            loadingBackgroundColor={
              COLOURS.parchment
            }
            loadingIndicatorColor={
              COLOURS.sienna
            }
            showsBuildings={
              false
            }
            showsCompass={
              false
            }
            showsIndoorLevelPicker={
              false
            }
            showsIndoors={
              false
            }
            showsMyLocationButton={
              false
            }
            showsPointsOfInterest
            showsScale={
              false
            }
            showsTraffic={
              false
            }
            showsUserLocation={
              Boolean(
                validUserLocation,
              )
            }
            toolbarEnabled={
              false
            }
            pitchEnabled={
              false
            }
            rotateEnabled={
              false
            }
            zoomEnabled
            scrollEnabled
            onMapReady={
              handleMapReady
            }
            accessible
            accessibilityLabel="Treasi field map"
            accessibilityHint="Interactive map showing your position and active treasure caches."
          >
            {validUserLocation ? (
              <Circle
                center={
                  validUserLocation
                }
                radius={
                  FIELD_RADIUS_METRES
                }
                strokeColor={
                  COLOURS.brass
                }
                fillColor="rgba(176, 141, 87, 0.08)"
                strokeWidth={
                  1
                }
              />
            ) : null}

            {validTreasures.map(
              (
                treasure,
              ) => {
                const creator =
                  treasure.creatorName
                    ?.trim() ||
                  'Unknown explorer';

                const title =
                  treasure.title
                    ?.trim() ||
                  'Treasure cache';

                return (
                  <Marker
                    key={
                      treasure.id
                    }
                    identifier={
                      treasure.id
                    }
                    coordinate={{
                      latitude:
                        treasure.latitude,

                      longitude:
                        treasure.longitude,
                    }}
                    title={
                      title
                    }
                    description={`Hidden by ${creator}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${title}. Hidden by ${creator}.`}
                    accessibilityHint="Opens details for this treasure cache."
                    onPress={() =>
                      onTreasurePress(
                        treasure.id,
                      )
                    }
                    anchor={{
                      x: 0.5,
                      y: 0.5,
                    }}
                  >
                    <View
                      accessible={
                        false
                      }
                      importantForAccessibility="no-hide-descendants"
                      style={
                        styles.customMarker
                      }
                    >
                      <MaterialCommunityIcons
                        name="treasure-chest"
                        size={
                          16
                        }
                        color={
                          COLOURS.parchmentLight
                        }
                      />
                    </View>
                  </Marker>
                );
              },
            )}
          </MapView>
        </View>
      );
    },
  );

FieldMap.displayName =
  'FieldMapNative';

export default FieldMap;

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      width:
        '100%',
      height:
        '100%',
      position:
        'relative',
      overflow:
        'hidden',
      backgroundColor:
        COLOURS.parchment,
    },

    customMarker: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor:
        COLOURS.sienna,
      borderWidth: 2,
      borderColor:
        COLOURS.parchmentLight,
      alignItems:
        'center',
      justifyContent:
        'center',

      shadowColor:
        '#000000',

      shadowOffset: {
        width: 0,
        height: 2,
      },

      shadowOpacity:
        0.24,

      shadowRadius:
        3,

      elevation:
        5,
    },
  });
