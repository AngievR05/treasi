import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  FieldMapHandle,
  FieldMapProps,
} from './FieldMap.types';

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
    const iframeRef =
      useRef<HTMLIFrameElement | null>(
        null,
      );

    const [ready, setReady] =
      useState(false);

    const html = useMemo(
      () => `
<!doctype html>

<html>
<head>
  <meta charset="utf-8" />

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />

  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  />

  <style>
    html,
    body,
    #map {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
    }

    html,
    body {
      overflow: hidden;
      background: #E8DCC0;
      font-family: Arial, sans-serif;
    }

    .leaflet-container {
      background: #E8DCC0;
    }

    .leaflet-tile-pane {
      filter:
        sepia(.22)
        saturate(.72)
        contrast(.95);
    }

    .leaflet-control-zoom a {
      background: #F3ECD8;
      color: #2A2420;
      border-color: #B08D57;
    }

    .leaflet-control-attribution {
      background:
        rgba(243,236,216,.88)
        !important;

      color:
        #2A2420
        !important;

      font-size:
        9px
        !important;
    }

    .leaflet-popup-content-wrapper,
    .leaflet-popup-tip {
      background: #F3ECD8;
      color: #2A2420;
    }

    .treasi-popup {
      font-size: 12px;
      line-height: 1.35;
    }
  </style>
</head>

<body>
  <div id="map"></div>

  <script
    src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  ></script>

  <script>
    (function () {
      const map = L.map(
        'map',
        {
          zoomControl: true,
          attributionControl: true
        }
      ).setView(
        [
          ${initialRegion.latitude},
          ${initialRegion.longitude}
        ],
        13
      );

      L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          maxZoom: 19,
          attribution:
            '&copy; OpenStreetMap contributors'
        }
      ).addTo(map);

      const treasureLayer =
        L.layerGroup().addTo(map);

      let userMarker = null;
      let radiusCircle = null;

      function send(message) {
        try {
          window.parent.postMessage(
            message,
            '*'
          );
        } catch (_) {}
      }

      function escapeHtml(value) {
        return String(
          value || ''
        ).replace(
          /[&<>'"]/g,
          function (character) {
            const chars = {
              '&': '&amp;',
              '<': '&lt;',
              '>': '&gt;',
              "'": '&#39;',
              '"': '&quot;'
            };

            return chars[
              character
            ] || character;
          }
        );
      }

      function updateUser(user) {
        if (
          !user ||
          typeof user.latitude !== 'number' ||
          typeof user.longitude !== 'number'
        ) {
          if (userMarker) {
            map.removeLayer(
              userMarker
            );

            userMarker = null;
          }

          if (radiusCircle) {
            map.removeLayer(
              radiusCircle
            );

            radiusCircle = null;
          }

          return;
        }

        const coords = [
          user.latitude,
          user.longitude
        ];

        if (userMarker) {
          userMarker.setLatLng(
            coords
          );
        } else {
          userMarker =
            L.circleMarker(
              coords,
              {
                radius: 8,
                color: '#F3ECD8',
                weight: 2,
                fillColor: '#2C3B2E',
                fillOpacity: 1
              }
            )
            .addTo(map)
            .bindTooltip(
              'YOUR POSITION'
            );
        }

        if (radiusCircle) {
          radiusCircle.setLatLng(
            coords
          );
        } else {
          radiusCircle =
            L.circle(
              coords,
              {
                radius: 20000,
                color: '#B08D57',
                weight: 1,
                fillColor: '#B08D57',
                fillOpacity: 0.08
              }
            ).addTo(map);
        }
      }

      function updateTreasures(
        treasures
      ) {
        treasureLayer.clearLayers();

        (
          Array.isArray(
            treasures
          )
            ? treasures
            : []
        ).forEach(
          function (treasure) {
            if (
              typeof treasure.latitude !== 'number' ||
              typeof treasure.longitude !== 'number'
            ) {
              return;
            }

            const marker =
              L.circleMarker(
                [
                  treasure.latitude,
                  treasure.longitude
                ],
                {
                  radius: 9,
                  color: '#F3ECD8',
                  weight: 2,
                  fillColor: '#A64B2A',
                  fillOpacity: 1
                }
              ).addTo(
                treasureLayer
              );

            marker.bindPopup(
              '<div class="treasi-popup">' +
              '<strong>' +
              escapeHtml(
                treasure.title ||
                'TREASURE CACHE'
              ) +
              '</strong><br />' +
              'Hidden by ' +
              escapeHtml(
                treasure.creatorName ||
                'Unknown explorer'
              ) +
              '</div>'
            );

            marker.on(
              'click',
              function () {
                send({
                  type:
                    'TREASI_TREASURE_PRESS',

                  treasureId:
                    treasure.id
                });
              }
            );
          }
        );
      }

      window.addEventListener(
        'message',
        function (event) {
          const data =
            event.data || {};

          if (
            data.type ===
            'TREASI_UPDATE_MAP'
          ) {
            updateUser(
              data.user
            );

            updateTreasures(
              data.treasures
            );
          }

          if (
            data.type ===
              'TREASI_SET_VIEW' &&
            typeof data.latitude ===
              'number' &&
            typeof data.longitude ===
              'number'
          ) {
            map.setView(
              [
                data.latitude,
                data.longitude
              ],
              data.zoom || 14,
              {
                animate: true
              }
            );
          }
        }
      );

      setTimeout(
        function () {
          map.invalidateSize();

          send({
            type:
              'TREASI_MAP_READY'
          });
        },
        100
      );
    })();
  </script>
</body>
</html>
      `,
      [
        initialRegion.latitude,
        initialRegion.longitude,
      ],
    );

    const sendToMap = (
      payload: unknown,
    ) => {
      iframeRef.current
        ?.contentWindow
        ?.postMessage(
          payload,
          '*',
        );
    };

    useImperativeHandle(
      ref,
      () => ({
        setView: (
          region,
        ) => {
          sendToMap({
            type:
              'TREASI_SET_VIEW',

            latitude:
              region.latitude,

            longitude:
              region.longitude,

            zoom: 15,
          });
        },
      }),
    );

    useEffect(() => {
      const handleMessage = (
        event: MessageEvent,
      ) => {
        /*
         * Ignore postMessage events that
         * did not originate from our map.
         */
        if (
          event.source !==
          iframeRef.current
            ?.contentWindow
        ) {
          return;
        }

        const data =
          event.data ?? {};

        if (
          data.type ===
          'TREASI_MAP_READY'
        ) {
          setReady(true);
          onReady?.();
        }

        if (
          data.type ===
            'TREASI_TREASURE_PRESS' &&
          typeof data.treasureId ===
            'string'
        ) {
          onTreasurePress(
            data.treasureId,
          );
        }
      };

      window.addEventListener(
        'message',
        handleMessage,
      );

      return () => {
        window.removeEventListener(
          'message',
          handleMessage,
        );
      };
    }, [
      onReady,
      onTreasurePress,
    ]);

    useEffect(() => {
      if (!ready) {
        return;
      }

      sendToMap({
        type:
          'TREASI_UPDATE_MAP',

        user: userLocation,

        treasures,
      });
    }, [
      ready,
      treasures,
      userLocation,
    ]);

    return (
      <View
        style={
          styles.container
        }
      >
        {React.createElement(
          'iframe',
          {
            ref: iframeRef,

            title:
              'Treasi Field Map',

            srcDoc: html,

            style: {
              width: '100%',
              height: '100%',
              border: '0',
              display: 'block',
            },
          },
        )}

        {!ready && (
          <View
            style={
              styles.loading
            }
            pointerEvents="none"
          >
            <ActivityIndicator
              size="small"
              color="#A64B2A"
            />

            <Text
              style={
                styles.loadingText
              }
            >
              LOADING FIELD MAP...
            </Text>
          </View>
        )}
      </View>
    );
  },
);

FieldMap.displayName =
  'FieldMapWeb';

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      width: '100%',
      height: '100%',
      position: 'relative',
      backgroundColor:
        '#E8DCC0',
      overflow: 'hidden',
    },

    loading: {
      ...StyleSheet.absoluteFillObject,

      alignItems:
        'center',

      justifyContent:
        'center',

      gap: 8,

      backgroundColor:
        'rgba(232,220,192,0.82)',
    },

    loadingText: {
      color:
        '#2A2420',

      fontSize: 9,

      fontWeight:
        'bold',

      letterSpacing: 1,
    },
  });

export default FieldMap;