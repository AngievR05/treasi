import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type {
  FieldMapHandle,
  FieldMapProps,
  FieldMapRegion,
  FieldMapTreasure,
  FieldMapUserLocation,
} from './FieldMap.types';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const FIELD_RADIUS_METRES =
  20_000;

const COLOURS = {
  parchment: '#E8DCC0',
  parchmentLight: '#F3ECD8',
  ink: '#2A2420',
  brass: '#B08D57',
  sienna: '#A64B2A',
  forest: '#2C3B2E',
} as const;

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface PendingView {
  region: FieldMapRegion;
  animated: boolean;
}

interface MapMessage {
  channel?: unknown;
  type?: unknown;
  treasureId?: unknown;
  message?: unknown;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Confirms that values are usable geographic coordinates.
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

// Keeps geographic deltas inside safe map limits.
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

// Sanitises map regions before sending them into the iframe.
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

// Rejects malformed treasure records before crossing the iframe boundary.
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

// Provides a validated user position or null.
const normaliseUserLocation = (
  location:
    FieldMapUserLocation | null,
): FieldMapUserLocation | null => {
  if (
    !location ||
    !isValidCoordinate(
      location.latitude,
      location.longitude,
    )
  ) {
    return null;
  }

  return {
    latitude:
      location.latitude,

    longitude:
      location.longitude,
  };
};

/* -------------------------------------------------------------------------- */
/* Web map                                                                    */
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
      const iframeRef =
        useRef<HTMLIFrameElement | null>(
          null,
        );

      const readyNotifiedRef =
        useRef(false);

      const pendingViewRef =
        useRef<PendingView | null>(
          null,
        );

      /*
       * initialRegion is intentionally captured once.
       * Changing Dashboard region state must not reload the Leaflet iframe.
       */
      const initialRegionRef =
        useRef<FieldMapRegion>(
          normaliseRegion(
            initialRegion,
          ),
        );

      /*
       * Each iframe receives its own private message channel.
       * This prevents unrelated postMessage traffic from controlling the map.
       */
      const channelIdRef =
        useRef(
          `treasi-map-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`,
        );

      const [
        ready,
        setReady,
      ] =
        useState(false);

      const [
        mapError,
        setMapError,
      ] =
        useState<
          string | null
        >(null);

      /* -------------------------------------------------------------------- */
      /* Validated data                                                       */
      /* -------------------------------------------------------------------- */

      const validTreasures =
        useMemo(
          () =>
            treasures
              .filter(
                isRenderableTreasure,
              )
              .map(
                (
                  treasure,
                ) => ({
                  id:
                    treasure.id,

                  title:
                    treasure.title
                      ?.trim() ||
                    'Treasure cache',

                  creatorName:
                    treasure.creatorName
                      ?.trim() ||
                    'Unknown explorer',

                  latitude:
                    treasure.latitude,

                  longitude:
                    treasure.longitude,
                }),
              ),
          [
            treasures,
          ],
        );

      const validUserLocation =
        useMemo(
          () =>
            normaliseUserLocation(
              userLocation,
            ),
          [
            userLocation,
          ],
        );

      /* -------------------------------------------------------------------- */
      /* Embedded Leaflet document                                            */
      /* -------------------------------------------------------------------- */

      const html =
        useMemo(
          () => {
            const safeInitialRegion =
              initialRegionRef.current;

            const channel =
              JSON.stringify(
                channelIdRef.current,
              );

            const region =
              JSON.stringify(
                safeInitialRegion,
              );

            return `
<!doctype html>

<html lang="en">
<head>
  <meta charset="utf-8" />

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0, maximum-scale=1.0"
  />

  <meta
    name="referrer"
    content="no-referrer"
  />

  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
    crossorigin=""
  />
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@6.17.0/dist/maplibre-gl.css" />
  <script type="importmap">
    {
      "imports": {
        "leaflet": "https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.esm.js",
        "maplibre-gl": "https://unpkg.com/maplibre-gl@6.17.0/dist/maplibre-gl.mjs"
      }
    }
  </script>

  <style>
    :root {
      color-scheme: light;
    }

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
      background: ${COLOURS.parchment};
      font-family:
        ui-monospace,
        "SFMono-Regular",
        Consolas,
        "Liberation Mono",
        monospace;
    }

    #map {
      outline: none;
    }

    .leaflet-container {
      background:
        ${COLOURS.parchment};
    }

    .maplibregl-canvas {
      filter:
        sepia(.24)
        saturate(.72)
        contrast(.94)
        brightness(1.02);
    }

    #basemap-status {
      position: absolute;
      z-index: 1000;
      bottom: 56px;
      left: 50%;
      transform: translateX(-50%);
      max-width: calc(100% - 32px);
      padding: 8px 12px;
      background: ${COLOURS.parchmentLight};
      color: ${COLOURS.ink};
      border: 1px solid ${COLOURS.brass};
      border-radius: 5px;
      font-size: 12px;
      text-align: center;
    }

    #retry-basemap {
      color: ${COLOURS.ink};
      background: ${COLOURS.parchmentLight};
      border: 1px solid ${COLOURS.brass};
      border-radius: 3px;
      margin: 6px 0 0;
      padding: 8px;
      font: inherit;
      cursor: pointer;
    }

    .leaflet-control-zoom {
      border:
        1px solid
        ${COLOURS.brass}
        !important;
    }

    .leaflet-control-zoom a {
      background:
        ${COLOURS.parchmentLight};
      color:
        ${COLOURS.ink};
      border-color:
        ${COLOURS.brass};
      min-width: 32px;
      min-height: 32px;
      line-height: 32px;
    }

    .leaflet-control-zoom a:focus-visible {
      outline:
        3px solid
        ${COLOURS.sienna};
      outline-offset:
        2px;
    }

    .leaflet-control-attribution {
      background:
        rgba(
          243,
          236,
          216,
          .92
        )
        !important;

      color:
        ${COLOURS.ink}
        !important;

      font-size:
        9px
        !important;
    }

    .leaflet-control-attribution a {
      color:
        ${COLOURS.forest};
    }

    .leaflet-popup-content-wrapper,
    .leaflet-popup-tip {
      background:
        ${COLOURS.parchmentLight};

      color:
        ${COLOURS.ink};
    }

    .leaflet-popup-content-wrapper {
      border:
        1px solid
        ${COLOURS.brass};

      border-radius:
        5px;
    }

    .treasi-popup {
      min-width: 145px;
      font-size: 12px;
      line-height: 1.45;
    }

    .treasi-popup-title {
      display: block;
      margin-bottom: 3px;
      font-weight: 700;
      color:
        ${COLOURS.ink};
    }

    .treasi-popup-creator {
      color:
        #5F4B32;
    }

    .treasi-marker-host {
      background:
        transparent
        !important;

      border:
        0
        !important;
    }

    .treasi-treasure-marker {
      width: 32px;
      height: 32px;

      display: flex;
      align-items: center;
      justify-content: center;

      border-radius: 50%;

      box-sizing:
        border-box;

      border:
        2px solid
        ${COLOURS.parchmentLight};

      background:
        ${COLOURS.sienna};

      color:
        ${COLOURS.parchmentLight};

      font-size: 16px;
      font-weight: 800;

      box-shadow:
        0 2px 5px
        rgba(
          0,
          0,
          0,
          .28
        );
    }

    .leaflet-marker-icon:focus-visible {
      outline:
        3px solid
        ${COLOURS.ink};

      outline-offset:
        3px;

      border-radius:
        50%;
    }
  </style>
</head>

<body>
  <div
    id="map"
    role="application"
    aria-label="Treasi field map"
  ></div>

  <div id="basemap-status" hidden>
    <div role="status">Background map unavailable. You can still use the cache markers.</div>
    <button id="retry-basemap" type="button">Retry background map</button>
  </div>

  <script>
    (async function () {
      'use strict';

      const CHANNEL =
        ${channel};

      const INITIAL_REGION =
        ${region};

      const FIELD_RADIUS_METRES =
        ${FIELD_RADIUS_METRES};

      function send(
        message
      ) {
        try {
          window.parent.postMessage(
            Object.assign(
              {
                channel:
                  CHANNEL
              },
              message
            ),
            '*'
          );
        } catch (_) {
          // Parent communication is optional during iframe teardown.
        }
      }

      let L;
      try {
        L = await import('leaflet');
      } catch (_) {
        send({
          type:
            'TREASI_MAP_ERROR',

          message:
            'Leaflet could not be loaded.'
        });

        return;
      }

      function isCoordinate(
        latitude,
        longitude
      ) {
        return (
          typeof latitude ===
            'number' &&
          typeof longitude ===
            'number' &&
          Number.isFinite(
            latitude
          ) &&
          Number.isFinite(
            longitude
          ) &&
          latitude >= -90 &&
          latitude <= 90 &&
          longitude >= -180 &&
          longitude <= 180
        );
      }

      function escapeHtml(
        value
      ) {
        return String(
          value == null
            ? ''
            : value
        ).replace(
          /[&<>'"]/g,
          function (
            character
          ) {
            const characters = {
              '&':
                '&amp;',

              '<':
                '&lt;',

              '>':
                '&gt;',

              "'":
                '&#39;',

              '"':
                '&quot;'
            };

            return (
              characters[
                character
              ] ||
              character
            );
          }
        );
      }

      function regionToZoom(
        region
      ) {
        const latitudeDelta =
          Number(
            region.latitudeDelta
          );

        const longitudeDelta =
          Number(
            region.longitudeDelta
          );

        const delta =
          Math.max(
            Number.isFinite(
              latitudeDelta
            )
              ? Math.abs(
                  latitudeDelta
                )
              : 0.08,

            Number.isFinite(
              longitudeDelta
            )
              ? Math.abs(
                  longitudeDelta
                )
              : 0.08,

            0.0005
          );

        const zoom =
          Math.round(
            Math.log2(
              360 /
              delta
            )
          );

        return Math.max(
          2,
          Math.min(
            19,
            zoom
          )
        );
      }

      try {
        const map =
          L.map(
            'map',
            {
              zoomControl:
                true,

              attributionControl:
                true,

              minZoom: 2,
              maxZoom: 19,
              maxBounds: [[-85.051129, -Infinity], [85.051129, Infinity]],
              maxBoundsViscosity: 1,

              keyboard:
                true,

              zoomAnimation:
                true,

              fadeAnimation:
                true,

              markerZoomAnimation:
                true
            }
          );

        map.setView(
          [
            INITIAL_REGION.latitude,
            INITIAL_REGION.longitude
          ],
          regionToZoom(
            INITIAL_REGION
          ),
          {
            animate:
              false
          }
        );

        const basemapStatus = document.getElementById('basemap-status');
        const retryBasemap = document.getElementById('retry-basemap');
        let basemap;
        let basemapAttempt = 0;
        let basemapTimer;

        async function loadBasemap() {
          const attempt = ++basemapAttempt;
          clearTimeout(basemapTimer);
          basemapStatus.hidden = true;
          if (basemap) {
            map.removeLayer(basemap);
            basemap = undefined;
          }

          function showFailure() {
            if (attempt !== basemapAttempt) return;
            clearTimeout(basemapTimer);
            basemapStatus.hidden = false;
          }

          basemapTimer = setTimeout(showFailure, 15000);
          try {
            const { maplibreGL } = await import('https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/dist/leaflet-maplibre-gl.mjs');
            if (attempt !== basemapAttempt) return;
            basemap = maplibreGL({
              style: 'https://tiles.openfreemap.org/styles/liberty',
              attribution: '<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>',
            });
            basemap.addTo(map);
            const vectorMap = basemap.getMaplibreMap();
            vectorMap.on('error', showFailure);
            vectorMap.once('load', () => {
              if (attempt !== basemapAttempt) return;
              clearTimeout(basemapTimer);
              basemapStatus.hidden = true;
            });
          } catch (_) {
            showFailure();
          }
        }

        retryBasemap.addEventListener('click', loadBasemap);
        void loadBasemap();

        const treasureLayer =
          L.layerGroup()
            .addTo(
              map
            );

        let userMarker =
          null;

        let radiusCircle =
          null;

        function removeUserLayers() {
          if (
            userMarker
          ) {
            map.removeLayer(
              userMarker
            );

            userMarker =
              null;
          }

          if (
            radiusCircle
          ) {
            map.removeLayer(
              radiusCircle
            );

            radiusCircle =
              null;
          }
        }

        function updateUser(
          user
        ) {
          if (
            !user ||
            !isCoordinate(
              user.latitude,
              user.longitude
            )
          ) {
            removeUserLayers();

            return;
          }

          const coordinates = [
            user.latitude,
            user.longitude
          ];

          if (
            userMarker
          ) {
            userMarker.setLatLng(
              coordinates
            );
          } else {
            userMarker =
              L.circleMarker(
                coordinates,
                {
                  radius:
                    8,

                  color:
                    '${COLOURS.parchmentLight}',

                  weight:
                    2,

                  fillColor:
                    '${COLOURS.forest}',

                  fillOpacity:
                    1,

                  interactive:
                    false
                }
              ).addTo(
                map
              );
          }

          if (
            radiusCircle
          ) {
            radiusCircle.setLatLng(
              coordinates
            );
          } else {
            radiusCircle =
              L.circle(
                coordinates,
                {
                  radius:
                    FIELD_RADIUS_METRES,

                  color:
                    '${COLOURS.brass}',

                  weight:
                    1,

                  fillColor:
                    '${COLOURS.brass}',

                  fillOpacity:
                    0.08,

                  interactive:
                    false
                }
              ).addTo(
                map
              );
          }
        }

        function updateTreasures(
          items
        ) {
          treasureLayer
            .clearLayers();

          const treasures =
            Array.isArray(
              items
            )
              ? items
              : [];

          treasures.forEach(
            function (
              treasure
            ) {
              if (
                !treasure ||
                typeof treasure.id !==
                  'string' ||
                !treasure.id ||
                !isCoordinate(
                  treasure.latitude,
                  treasure.longitude
                )
              ) {
                return;
              }

              const title =
                String(
                  treasure.title ||
                  'Treasure cache'
                );

              const creator =
                String(
                  treasure.creatorName ||
                  'Unknown explorer'
                );

              const markerIcon =
                L.divIcon({
                  className:
                    'treasi-marker-host',

                  html:
                    '<div class="treasi-treasure-marker" aria-hidden="true">✦</div>',

                  iconSize: [
                    32,
                    32
                  ],

                  iconAnchor: [
                    16,
                    16
                  ],

                  popupAnchor: [
                    0,
                    -18
                  ]
                });

              const marker =
                L.marker(
                  [
                    treasure.latitude,
                    treasure.longitude
                  ],
                  {
                    icon:
                      markerIcon,

                    keyboard:
                      true,

                    title:
                      title,

                    alt:
                      title
                  }
                );

              marker.bindPopup(
                '<div class="treasi-popup">' +
                  '<span class="treasi-popup-title">' +
                    escapeHtml(
                      title
                    ) +
                  '</span>' +
                  '<span class="treasi-popup-creator">' +
                    'Hidden by ' +
                    escapeHtml(
                      creator
                    ) +
                  '</span>' +
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

              marker.addTo(
                treasureLayer
              );
            }
          );
        }

        function setView(
          region,
          animated
        ) {
          if (
            !region ||
            !isCoordinate(
              region.latitude,
              region.longitude
            )
          ) {
            return;
          }

          const coordinates = [
            region.latitude,
            region.longitude
          ];

          const zoom =
            regionToZoom(
              region
            );

          if (
            animated
          ) {
            map.flyTo(
              coordinates,
              zoom,
              {
                animate:
                  true,

                duration:
                  0.45
              }
            );

            return;
          }

          map.setView(
            coordinates,
            zoom,
            {
              animate:
                false
            }
          );
        }

        function handleParentMessage(
          event
        ) {
          const data =
            event.data ||
            {};

          if (
            data.channel !==
            CHANNEL
          ) {
            return;
          }

          switch (
            data.type
          ) {
            case 'TREASI_UPDATE_USER':
              updateUser(
                data.user
              );
              break;

            case 'TREASI_UPDATE_TREASURES':
              updateTreasures(
                data.treasures
              );
              break;

            case 'TREASI_SET_VIEW':
              setView(
                data.region,
                data.animated !==
                  false
              );
              break;

            default:
              break;
          }
        }

        window.addEventListener(
          'message',
          handleParentMessage
        );

        const resizeMap =
          function () {
            map.invalidateSize(
              false
            );
          };

        window.addEventListener(
          'resize',
          resizeMap
        );

        let resizeObserver =
          null;

        if (
          typeof ResizeObserver !==
          'undefined'
        ) {
          resizeObserver =
            new ResizeObserver(
              resizeMap
            );

          resizeObserver.observe(
            document.body
          );
        }

        setTimeout(
          function () {
            map.invalidateSize(
              false
            );

            send({
              type:
                'TREASI_MAP_READY'
            });
          },
          100
        );
      } catch (
        error
      ) {
        send({
          type:
            'TREASI_MAP_ERROR',

          message:
            error &&
            typeof error.message ===
              'string'
              ? error.message
              : 'The field map could not be initialised.'
        });
      }
    })();
  </script>
</body>
</html>
            `;
          },
          [],
        );

      /* -------------------------------------------------------------------- */
      /* Iframe communication                                                 */
      /* -------------------------------------------------------------------- */

      const sendToMap =
        useCallback(
          (
            payload:
              Record<
                string,
                unknown
              >,
          ): void => {
            const frame =
              iframeRef.current
                ?.contentWindow;

            if (!frame) {
              return;
            }

            frame.postMessage(
              {
                channel:
                  channelIdRef.current,

                ...payload,
              },
              '*',
            );
          },
          [],
        );

      /* -------------------------------------------------------------------- */
      /* Public API                                                           */
      /* -------------------------------------------------------------------- */

      useImperativeHandle(
        ref,
        () => ({
          setView: (
            region,
            animated = true,
          ) => {
            const safeRegion =
              normaliseRegion(
                region,
              );

            if (!ready) {
              pendingViewRef.current =
                {
                  region:
                    safeRegion,

                  animated,
                };

              return;
            }

            sendToMap({
              type:
                'TREASI_SET_VIEW',

              region:
                safeRegion,

              animated,
            });
          },
        }),
        [
          ready,
          sendToMap,
        ],
      );

      /* -------------------------------------------------------------------- */
      /* Messages from iframe                                                 */
      /* -------------------------------------------------------------------- */

      useEffect(() => {
        if (
          Platform.OS !==
          'web' ||
          typeof window ===
            'undefined'
        ) {
          return;
        }

        const handleMessage =
          (
            event: MessageEvent,
          ): void => {
            /*
             * Only messages from this exact iframe are accepted.
             */
            if (
              event.source !==
              iframeRef.current
                ?.contentWindow
            ) {
              return;
            }

            const data =
              (
                event.data ??
                {}
              ) as MapMessage;

            if (
              data.channel !==
              channelIdRef.current
            ) {
              return;
            }

            if (
              data.type ===
              'TREASI_MAP_READY'
            ) {
              setMapError(
                null,
              );

              setReady(
                true,
              );

              if (
                !readyNotifiedRef.current
              ) {
                readyNotifiedRef.current =
                  true;

                onReady?.();
              }

              return;
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

              return;
            }

            if (
              data.type ===
              'TREASI_MAP_ERROR'
            ) {
              setMapError(
                typeof data.message ===
                  'string' &&
                data.message.trim()
                  ? data.message
                  : 'The web field map could not be loaded.',
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

      /* -------------------------------------------------------------------- */
      /* Apply pending viewport                                               */
      /* -------------------------------------------------------------------- */

      useEffect(() => {
        if (
          !ready ||
          !pendingViewRef.current
        ) {
          return;
        }

        const pending =
          pendingViewRef.current;

        pendingViewRef.current =
          null;

        sendToMap({
          type:
            'TREASI_SET_VIEW',

          region:
            pending.region,

          animated:
            pending.animated,
        });
      }, [
        ready,
        sendToMap,
      ]);

      /* -------------------------------------------------------------------- */
      /* User position                                                        */
      /* -------------------------------------------------------------------- */

      useEffect(() => {
        if (!ready) {
          return;
        }

        sendToMap({
          type:
            'TREASI_UPDATE_USER',

          user:
            validUserLocation,
        });
      }, [
        ready,
        sendToMap,
        validUserLocation,
      ]);

      /* -------------------------------------------------------------------- */
      /* Treasure markers                                                     */
      /* -------------------------------------------------------------------- */

      useEffect(() => {
        if (!ready) {
          return;
        }

        sendToMap({
          type:
            'TREASI_UPDATE_TREASURES',

          treasures:
            validTreasures,
        });
      }, [
        ready,
        sendToMap,
        validTreasures,
      ]);

      /* -------------------------------------------------------------------- */
      /* Render                                                               */
      /* -------------------------------------------------------------------- */

      return (
        <View
          style={
            styles.container
          }
          accessible={
            false
          }
        >
          {React.createElement(
            'iframe',
            {
              ref:
                iframeRef,

              title:
                'Treasi Field Map',

              'aria-label':
                'Treasi interactive field map showing your position and active treasure caches',

              srcDoc:
                html,

              sandbox:
                'allow-scripts allow-popups allow-popups-to-escape-sandbox',

              referrerPolicy:
                'no-referrer',

              allow:
                "geolocation 'none'; camera 'none'; microphone 'none'",

              tabIndex:
                0,

              style: {
                width:
                  '100%',

                height:
                  '100%',

                border:
                  '0',

                display:
                  'block',

                background:
                  COLOURS.parchment,
              },
            },
          )}

          {!ready &&
          !mapError ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Loading Treasi field map"
              accessibilityLiveRegion="polite"
              style={
                styles.loading
              }
              pointerEvents="none"
            >
              <ActivityIndicator
                size="small"
                color={
                  COLOURS.sienna
                }
              />

              <Text
                maxFontSizeMultiplier={
                  1.5
                }
                style={
                  styles.loadingText
                }
              >
                LOADING FIELD MAP...
              </Text>
            </View>
          ) : null}

          {mapError ? (
            <View
              accessible
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={
                styles.errorOverlay
              }
            >
              <Text
                style={
                  styles.errorTitle
                }
              >
                FIELD MAP OFFLINE
              </Text>

              <Text
                maxFontSizeMultiplier={
                  1.7
                }
                style={
                  styles.errorText
                }
              >
                {mapError}
              </Text>

              <Text
                maxFontSizeMultiplier={
                  1.7
                }
                style={
                  styles.errorHelpText
                }
              >
                Check your internet connection and reload Treasi. Location and treasure data remain separate from map tile loading.
              </Text>
            </View>
          ) : null}
        </View>
      );
    },
  );

FieldMap.displayName =
  'FieldMapWeb';

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

    loading: {
      ...StyleSheet.absoluteFill,

      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 8,

      backgroundColor:
        'rgba(232, 220, 192, 0.88)',
    },

    loadingText: {
      color:
        COLOURS.ink,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '700',
      letterSpacing: 0.8,
    },

    errorOverlay: {
      ...StyleSheet.absoluteFill,

      alignItems:
        'center',
      justifyContent:
        'center',

      paddingHorizontal:
        28,
      paddingVertical:
        20,

      backgroundColor:
        'rgba(232, 220, 192, 0.96)',
    },

    errorTitle: {
      color:
        COLOURS.sienna,
      fontSize: 14,
      lineHeight: 20,
      fontWeight:
        '800',
      letterSpacing: 1,
      textAlign:
        'center',
      marginBottom: 6,
    },

    errorText: {
      color:
        COLOURS.ink,
      fontSize: 11,
      lineHeight: 17,
      fontWeight:
        '700',
      textAlign:
        'center',
      maxWidth: 460,
    },

    errorHelpText: {
      color:
        '#5F4B32',
      fontSize: 10,
      lineHeight: 16,
      textAlign:
        'center',
      maxWidth: 460,
      marginTop: 8,
    },
  });
