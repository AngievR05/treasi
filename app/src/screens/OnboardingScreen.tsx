import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  type AppStateStatus,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import * as Location from 'expo-location';

import {
  Accelerometer,
  Magnetometer,
} from 'expo-sensors';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Svg, {
  Circle,
  Line,
  Path,
  Polygon,
} from 'react-native-svg';

/* -------------------------------------------------------------------------- */
/* Theme                                                                      */
/* -------------------------------------------------------------------------- */

const PALETTE = {
  forestDeep: '#2C3B2E',
  forestSurface: '#1E2920',
  parchment: '#E8DCC0',
  parchmentLight: '#F3ECD8',
  sienna: '#A64B2A',
  siennaAccessible: '#B85A38',
  brass: '#B08D57',
  brassAccessible: '#C3A06A',
  inkBlack: '#2A2420',
  mutedGreen: '#3D5040',
  signalGreen: '#5E8B62',
  signalGreenLight: '#A9C3A5',
  warning: '#B46B36',
  warningLight: '#E0B979',
  alertRed: '#8B2E24',
  alertLight: '#E18A73',
};

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface Props {
  onComplete: () => void | Promise<void>;
}

interface IconProps {
  colour?: string;
  size?: number;
}

interface OnboardingStep {
  step: string;
  protocolCode: string;
  title: string;
  subtitle: string;
  description: string;
  IconComponent: React.FC<IconProps>;
}

type CapabilityState =
  | 'checking'
  | 'available'
  | 'unavailable'
  | 'unknown';

type LocationPermissionState =
  | 'checking'
  | 'granted'
  | 'denied'
  | 'undetermined'
  | 'unknown';

type StatusTone =
  | 'success'
  | 'warning'
  | 'error'
  | 'neutral';

interface StatusLine {
  id: string;
  label: string;
  value: string;
  tone: StatusTone;
}

/* -------------------------------------------------------------------------- */
/* Icons                                                                      */
/* -------------------------------------------------------------------------- */

const CompassIcon: React.FC<IconProps> = ({
  colour = PALETTE.sienna,
  size = 24,
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={colour}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    accessibilityElementsHidden
    importantForAccessibility="no"
  >
    <Circle
      cx="12"
      cy="12"
      r="10"
    />

    <Polygon
      points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"
      fill={colour}
      opacity="0.28"
    />

    <Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </Svg>
);

const TelemetryIcon: React.FC<IconProps> = ({
  colour = PALETTE.sienna,
  size = 24,
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={colour}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    accessibilityElementsHidden
    importantForAccessibility="no"
  >
    <Circle
      cx="12"
      cy="12"
      r="9"
    />

    <Circle
      cx="12"
      cy="12"
      r="5"
    />

    <Circle
      cx="12"
      cy="12"
      r="1.5"
      fill={colour}
    />

    <Line
      x1="12"
      y1="3"
      x2="12"
      y2="12"
    />

    <Line
      x1="12"
      y1="12"
      x2="21"
      y2="12"
    />
  </Svg>
);

const ExcavationIcon: React.FC<IconProps> = ({
  colour = PALETTE.sienna,
  size = 24,
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={colour}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    accessibilityElementsHidden
    importantForAccessibility="no"
  >
    <Path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </Svg>
);

const RotateDeviceIcon: React.FC<IconProps> = ({
  colour = PALETTE.parchment,
  size = 32,
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={colour}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    accessibilityElementsHidden
    importantForAccessibility="no"
  >
    <Path d="M1 4v6h6" />
    <Path d="M23 20v-6h-6" />
    <Path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
  </Svg>
);

const ChevronLeftIcon: React.FC<IconProps> = ({
  colour = PALETTE.parchment,
  size = 20,
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={colour}
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    accessibilityElementsHidden
    importantForAccessibility="no"
  >
    <Path d="M15 18l-6-6 6-6" />
  </Svg>
);

const ChevronRightIcon: React.FC<IconProps> = ({
  colour = PALETTE.parchment,
  size = 20,
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={colour}
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    accessibilityElementsHidden
    importantForAccessibility="no"
  >
    <Path d="M9 18l6-6-6-6" />
  </Svg>
);

const CheckIcon: React.FC<IconProps> = ({
  colour = PALETTE.parchment,
  size = 20,
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={colour}
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    accessibilityElementsHidden
    importantForAccessibility="no"
  >
    <Path d="M20 6L9 17l-5-5" />
  </Svg>
);

/* -------------------------------------------------------------------------- */
/* Onboarding content                                                         */
/* -------------------------------------------------------------------------- */

const STEPS: OnboardingStep[] = [
  {
    step: '01 / 03',
    protocolCode: 'PROTOCOL_ORIENTATION',
    title: 'ALIGN INSTRUMENT',
    subtitle: 'LANDSCAPE FIELD INTERFACE',
    description:
      'Treasi is designed for landscape use. Hold your device horizontally so the map, compass and field controls remain visible together.',
    IconComponent: CompassIcon,
  },
  {
    step: '02 / 03',
    protocolCode: 'PROTOCOL_TELEMETRY',
    title: 'TRACK TARGETS',
    subtitle: 'LOCATION & HEADING',
    description:
      'Treasi uses foreground location to calculate your distance from hidden treasures. On supported devices, the magnetometer also provides directional heading data.',
    IconComponent: TelemetryIcon,
  },
  {
    step: '03 / 03',
    protocolCode: 'PROTOCOL_EXCAVATION',
    title: 'EXCAVATE REWARDS',
    subtitle: 'MOTION & ACCESSIBLE INPUT',
    description:
      'When you reach a treasure location, supported mobile devices can use a physical shake to excavate it. An accessible tap interaction remains available when motion input is unsuitable.',
    IconComponent: ExcavationIcon,
  },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Converts Expo permission status into local UI state.
const normalisePermissionStatus = (
  status: Location.PermissionStatus,
): LocationPermissionState => {
  switch (status) {
    case Location.PermissionStatus.GRANTED:
      return 'granted';

    case Location.PermissionStatus.DENIED:
      return 'denied';

    case Location.PermissionStatus.UNDETERMINED:
      return 'undetermined';

    default:
      return 'unknown';
  }
};

// Provides readable capability text without inventing hardware values.
const getCapabilityLabel = (
  state: CapabilityState,
): string => {
  switch (state) {
    case 'checking':
      return 'CHECKING';

    case 'available':
      return 'AVAILABLE';

    case 'unavailable':
      return 'UNAVAILABLE';

    default:
      return 'STATUS UNKNOWN';
  }
};

const getPermissionLabel = (
  state: LocationPermissionState,
): string => {
  switch (state) {
    case 'checking':
      return 'CHECKING';

    case 'granted':
      return 'GRANTED';

    case 'denied':
      return 'DENIED';

    case 'undetermined':
      return 'NOT YET REQUESTED';

    default:
      return 'STATUS UNKNOWN';
  }
};

/* -------------------------------------------------------------------------- */
/* Onboarding screen                                                          */
/* -------------------------------------------------------------------------- */

export const OnboardingScreen:
  React.FC<Props> = ({
    onComplete,
  }) => {
    const {
      width,
      height,
    } =
      useWindowDimensions();

    const insets =
      useSafeAreaInsets();

    const fontMonospace =
      Platform.OS === 'ios'
        ? 'Courier'
        : 'monospace';

    const isLandscape =
      width > height;

    const isCompact =
      height < 390;

    /* ---------------------------------------------------------------------- */
    /* Screen state                                                           */
    /* ---------------------------------------------------------------------- */

    const [
      index,
      setIndex,
    ] =
      useState(0);

    const [
      showPermissionModal,
      setShowPermissionModal,
    ] =
      useState(false);

    const [
      locationPermission,
      setLocationPermission,
    ] =
      useState<LocationPermissionState>(
        'checking',
      );

    const [
      locationServicesEnabled,
      setLocationServicesEnabled,
    ] =
      useState<boolean | null>(
        null,
      );

    const [
      canAskLocationAgain,
      setCanAskLocationAgain,
    ] =
      useState(true);

    const [
      magnetometerState,
      setMagnetometerState,
    ] =
      useState<CapabilityState>(
        'checking',
      );

    const [
      accelerometerState,
      setAccelerometerState,
    ] =
      useState<CapabilityState>(
        'checking',
      );

    const [
      isRefreshingCapabilities,
      setIsRefreshingCapabilities,
    ] =
      useState(false);

    const [
      isRequestingPermission,
      setIsRequestingPermission,
    ] =
      useState(false);

    const [
      isCompleting,
      setIsCompleting,
    ] =
      useState(false);

    const [
      isAnimating,
      setIsAnimating,
    ] =
      useState(false);

    const [
      errorMessage,
      setErrorMessage,
    ] =
      useState<string | null>(
        null,
      );

    const [
      reduceMotionEnabled,
      setReduceMotionEnabled,
    ] =
      useState(false);

    /* ---------------------------------------------------------------------- */
    /* Animation values                                                       */
    /* ---------------------------------------------------------------------- */

    const fadeAnim =
      useRef(
        new Animated.Value(1),
      ).current;

    const slideAnim =
      useRef(
        new Animated.Value(0),
      ).current;

    const progressAnim =
      useRef(
        new Animated.Value(
          1 / STEPS.length,
        ),
      ).current;

    const statusPulseAnim =
      useRef(
        new Animated.Value(1),
      ).current;

    const mountedRef =
      useRef(true);

    /* ---------------------------------------------------------------------- */
    /* Reduced-motion preference                                              */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      let mounted = true;

      AccessibilityInfo
        .isReduceMotionEnabled()
        .then(
          (enabled) => {
            if (mounted) {
              setReduceMotionEnabled(
                enabled,
              );
            }
          },
        )
        .catch(() => {
          // Static UI remains accessible if this preference cannot be read.
        });

      const subscription =
        AccessibilityInfo.addEventListener(
          'reduceMotionChanged',
          setReduceMotionEnabled,
        );

      return () => {
        mounted = false;
        subscription.remove();
      };
    }, []);

    /* ---------------------------------------------------------------------- */
    /* Real device capability checks                                          */
    /* ---------------------------------------------------------------------- */

    const refreshCapabilities =
      useCallback(
        async (): Promise<void> => {
          if (
            !mountedRef.current
          ) {
            return;
          }

          setIsRefreshingCapabilities(
            true,
          );

          const [
            permissionResult,
            servicesResult,
            magnetometerResult,
            accelerometerResult,
          ] =
            await Promise.allSettled([
              Location.getForegroundPermissionsAsync(),
              Location.hasServicesEnabledAsync(),
              Magnetometer.isAvailableAsync(),
              Accelerometer.isAvailableAsync(),
            ]);

          if (
            !mountedRef.current
          ) {
            return;
          }

          if (
            permissionResult.status ===
            'fulfilled'
          ) {
            setLocationPermission(
              normalisePermissionStatus(
                permissionResult.value
                  .status,
              ),
            );

            setCanAskLocationAgain(
              permissionResult.value
                .canAskAgain,
            );
          } else {
            setLocationPermission(
              'unknown',
            );
          }

          if (
            servicesResult.status ===
            'fulfilled'
          ) {
            setLocationServicesEnabled(
              servicesResult.value,
            );
          } else {
            setLocationServicesEnabled(
              null,
            );
          }

          if (
            magnetometerResult.status ===
            'fulfilled'
          ) {
            setMagnetometerState(
              magnetometerResult.value
                ? 'available'
                : 'unavailable',
            );
          } else {
            setMagnetometerState(
              'unknown',
            );
          }

          if (
            accelerometerResult.status ===
            'fulfilled'
          ) {
            setAccelerometerState(
              accelerometerResult.value
                ? 'available'
                : 'unavailable',
            );
          } else {
            setAccelerometerState(
              'unknown',
            );
          }

          setIsRefreshingCapabilities(
            false,
          );
        },
        [],
      );

    useEffect(() => {
      mountedRef.current =
        true;

      void refreshCapabilities();

      const subscription =
        AppState.addEventListener(
          'change',
          (
            nextState: AppStateStatus,
          ) => {
            if (
              nextState ===
              'active'
            ) {
              void refreshCapabilities();
            }
          },
        );

      return () => {
        mountedRef.current =
          false;

        subscription.remove();
      };
    }, [
      refreshCapabilities,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Status pulse                                                           */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        reduceMotionEnabled
      ) {
        statusPulseAnim.stopAnimation();

        statusPulseAnim.setValue(
          1,
        );

        return;
      }

      const animation =
        Animated.loop(
          Animated.sequence([
            Animated.timing(
              statusPulseAnim,
              {
                toValue: 0.45,
                duration: 850,
                easing:
                  Easing.inOut(
                    Easing.ease,
                  ),
                useNativeDriver:
                  true,
              },
            ),

            Animated.timing(
              statusPulseAnim,
              {
                toValue: 1,
                duration: 850,
                easing:
                  Easing.inOut(
                    Easing.ease,
                  ),
                useNativeDriver:
                  true,
              },
            ),
          ]),
        );

      animation.start();

      return () => {
        animation.stop();
      };
    }, [
      reduceMotionEnabled,
      statusPulseAnim,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Progress animation                                                     */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      const target =
        (index + 1) /
        STEPS.length;

      if (
        reduceMotionEnabled
      ) {
        progressAnim.setValue(
          target,
        );

        return;
      }

      Animated.timing(
        progressAnim,
        {
          toValue: target,
          duration: 250,
          easing:
            Easing.out(
              Easing.cubic,
            ),
          useNativeDriver:
            false,
        },
      ).start();
    }, [
      index,
      progressAnim,
      reduceMotionEnabled,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Screen-reader announcements                                            */
    /* ---------------------------------------------------------------------- */

    const announceStep =
      useCallback(
        (
          stepIndex: number,
        ): void => {
          const step =
            STEPS[
              stepIndex
            ];

          AccessibilityInfo.announceForAccessibility(
            `Step ${
              stepIndex + 1
            } of ${
              STEPS.length
            }. ${
              step.title
            }. ${
              step.description
            }`,
          );
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Step transitions                                                       */
    /* ---------------------------------------------------------------------- */

    const handleStepTransition =
      useCallback(
        (
          nextIndex: number,
        ): void => {
          if (
            nextIndex ===
              index ||
            isAnimating ||
            isCompleting ||
            nextIndex < 0 ||
            nextIndex >=
              STEPS.length
          ) {
            return;
          }

          setErrorMessage(
            null,
          );

          if (
            reduceMotionEnabled
          ) {
            setIndex(
              nextIndex,
            );

            announceStep(
              nextIndex,
            );

            return;
          }

          setIsAnimating(
            true,
          );

          const direction =
            nextIndex >
            index
              ? -1
              : 1;

          Animated.parallel([
            Animated.timing(
              fadeAnim,
              {
                toValue: 0,
                duration: 140,
                easing:
                  Easing.out(
                    Easing.quad,
                  ),
                useNativeDriver:
                  true,
              },
            ),

            Animated.timing(
              slideAnim,
              {
                toValue:
                  direction *
                  18,
                duration: 140,
                easing:
                  Easing.out(
                    Easing.quad,
                  ),
                useNativeDriver:
                  true,
              },
            ),
          ]).start(
            ({
              finished,
            }) => {
              if (!finished) {
                setIsAnimating(
                  false,
                );

                return;
              }

              setIndex(
                nextIndex,
              );

              announceStep(
                nextIndex,
              );

              slideAnim.setValue(
                -direction *
                  18,
              );

              Animated.parallel([
                Animated.timing(
                  fadeAnim,
                  {
                    toValue:
                      1,
                    duration:
                      180,
                    easing:
                      Easing.out(
                        Easing.cubic,
                      ),
                    useNativeDriver:
                      true,
                  },
                ),

                Animated.spring(
                  slideAnim,
                  {
                    toValue: 0,
                    damping: 18,
                    stiffness:
                      180,
                    mass: 0.8,
                    useNativeDriver:
                      true,
                  },
                ),
              ]).start(
                () => {
                  setIsAnimating(
                    false,
                  );
                },
              );
            },
          );
        },
        [
          announceStep,
          fadeAnim,
          index,
          isAnimating,
          isCompleting,
          reduceMotionEnabled,
          slideAnim,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Location permission                                                    */
    /* ---------------------------------------------------------------------- */

    const requestLocationPermission =
      useCallback(
        async (): Promise<void> => {
          if (
            isRequestingPermission
          ) {
            return;
          }

          setShowPermissionModal(
            false,
          );

          setIsRequestingPermission(
            true,
          );

          setErrorMessage(
            null,
          );

          try {
            const result =
              await Location.requestForegroundPermissionsAsync();

            if (
              !mountedRef.current
            ) {
              return;
            }

            setLocationPermission(
              normalisePermissionStatus(
                result.status,
              ),
            );

            setCanAskLocationAgain(
              result.canAskAgain,
            );

            try {
              const servicesEnabled =
                await Location.hasServicesEnabledAsync();

              if (
                mountedRef.current
              ) {
                setLocationServicesEnabled(
                  servicesEnabled,
                );
              }
            } catch {
              if (
                mountedRef.current
              ) {
                setLocationServicesEnabled(
                  null,
                );
              }
            }

            if (
              result.status ===
              Location
                .PermissionStatus
                .GRANTED
            ) {
              AccessibilityInfo.announceForAccessibility(
                'Location access granted.',
              );
            } else {
              AccessibilityInfo.announceForAccessibility(
                'Location access was not granted. You can continue and enable it later.',
              );
            }
          } catch {
            if (
              mountedRef.current
            ) {
              setLocationPermission(
                'unknown',
              );

              setErrorMessage(
                'Location permission could not be checked. You can continue and retry later.',
              );
            }
          } finally {
            if (
              mountedRef.current
            ) {
              setIsRequestingPermission(
                false,
              );
            }
          }
        },
        [
          isRequestingPermission,
        ],
      );

    const handleLocationAction =
      useCallback(
        async (): Promise<void> => {
          setErrorMessage(
            null,
          );

          if (
            locationPermission ===
              'denied' &&
            !canAskLocationAgain
          ) {
            if (
              Platform.OS ===
              'web'
            ) {
              setErrorMessage(
                'Location access is blocked by the browser. Update this site’s location permission, then select Refresh Status.',
              );

              return;
            }

            try {
              await Linking.openSettings();
            } catch {
              setErrorMessage(
                'Device settings could not be opened. Enable location permission manually in your device settings.',
              );
            }

            return;
          }

          if (
            locationPermission ===
            'granted'
          ) {
            await refreshCapabilities();

            return;
          }

          setShowPermissionModal(
            true,
          );
        },
        [
          canAskLocationAgain,
          locationPermission,
          refreshCapabilities,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Completion                                                             */
    /* ---------------------------------------------------------------------- */

    const finalizeCompletion =
      useCallback(
        async (): Promise<void> => {
          if (
            isCompleting
          ) {
            return;
          }

          setIsCompleting(
            true,
          );

          setErrorMessage(
            null,
          );

          try {
            /*
             * App.tsx owns local and Firestore persistence.
             * This screen only reports successful onboarding completion.
             */
            await onComplete();
          } catch {
            if (
              mountedRef.current
            ) {
              setErrorMessage(
                'Treasi could not save your onboarding state. Select Complete to retry.',
              );

              setIsCompleting(
                false,
              );

              AccessibilityInfo.announceForAccessibility(
                'Onboarding could not be saved. Please try again.',
              );
            }
          }
        },
        [
          isCompleting,
          onComplete,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Navigation actions                                                     */
    /* ---------------------------------------------------------------------- */

    const handleNext =
      useCallback(() => {
        if (
          isAnimating ||
          isCompleting
        ) {
          return;
        }

        if (
          index <
          STEPS.length -
            1
        ) {
          handleStepTransition(
            index + 1,
          );

          return;
        }

        void finalizeCompletion();
      }, [
        finalizeCompletion,
        handleStepTransition,
        index,
        isAnimating,
        isCompleting,
      ]);

    const handleBack =
      useCallback(() => {
        if (
          index === 0 ||
          isAnimating ||
          isCompleting
        ) {
          return;
        }

        handleStepTransition(
          index - 1,
        );
      }, [
        handleStepTransition,
        index,
        isAnimating,
        isCompleting,
      ]);

    /* ---------------------------------------------------------------------- */
    /* Derived UI data                                                        */
    /* ---------------------------------------------------------------------- */

    const current =
      STEPS[index];

    const StepIcon =
      current.IconComponent;

    const isFinalStep =
      index ===
      STEPS.length - 1;

    const isBusy =
      isAnimating ||
      isCompleting ||
      isRequestingPermission;

    const locationServicesLabel =
      locationServicesEnabled ===
      true
        ? 'ON'
        : locationServicesEnabled ===
            false
          ? 'OFF'
          : 'STATUS UNKNOWN';

    const statusLines =
      useMemo<
        StatusLine[]
      >(() => {
        if (
          index === 0
        ) {
          return [
            {
              id: 'orientation',
              label:
                'VIEWPORT',
              value:
                isLandscape
                  ? 'LANDSCAPE ACTIVE'
                  : 'ROTATION REQUIRED',
              tone:
                isLandscape
                  ? 'success'
                  : 'warning',
            },
          ];
        }

        if (
          index === 1
        ) {
          return [
            {
              id: 'location-services',
              label:
                'LOCATION SERVICES',
              value:
                locationServicesLabel,
              tone:
                locationServicesEnabled ===
                true
                  ? 'success'
                  : locationServicesEnabled ===
                      false
                    ? 'warning'
                    : 'neutral',
            },
            {
              id: 'location-permission',
              label:
                'LOCATION ACCESS',
              value:
                getPermissionLabel(
                  locationPermission,
                ),
              tone:
                locationPermission ===
                'granted'
                  ? 'success'
                  : locationPermission ===
                      'denied'
                    ? 'warning'
                    : 'neutral',
            },
            {
              id: 'magnetometer',
              label:
                'MAGNETOMETER',
              value:
                getCapabilityLabel(
                  magnetometerState,
                ),
              tone:
                magnetometerState ===
                'available'
                  ? 'success'
                  : magnetometerState ===
                      'unavailable'
                    ? 'warning'
                    : 'neutral',
            },
          ];
        }

        return [
          {
            id: 'accelerometer',
            label:
              'ACCELEROMETER',
            value:
              getCapabilityLabel(
                accelerometerState,
              ),
            tone:
              accelerometerState ===
              'available'
                ? 'success'
                : accelerometerState ===
                    'unavailable'
                  ? 'warning'
                  : 'neutral',
          },
          {
            id: 'accessible-input',
            label:
              'ACCESSIBLE INPUT',
            value:
              'TAP FALLBACK SUPPORTED',
            tone:
              'success',
          },
        ];
      }, [
        accelerometerState,
        index,
        isLandscape,
        locationPermission,
        locationServicesEnabled,
        locationServicesLabel,
        magnetometerState,
      ]);

    const permissionActionLabel =
      useMemo(
        () => {
          if (
            isRefreshingCapabilities
          ) {
            return 'REFRESHING STATUS';
          }

          if (
            locationPermission ===
            'granted'
          ) {
            return 'REFRESH STATUS';
          }

          if (
            locationPermission ===
              'denied' &&
            !canAskLocationAgain
          ) {
            return Platform.OS ===
              'web'
              ? 'REFRESH STATUS'
              : 'OPEN DEVICE SETTINGS';
          }

          return 'ENABLE LOCATION';
        },
        [
          canAskLocationAgain,
          isRefreshingCapabilities,
          locationPermission,
        ],
      );

    const locationGuidance =
      useMemo(
        () => {
          if (
            locationPermission ===
            'granted' &&
            locationServicesEnabled ===
              true
          ) {
            return 'Location is ready for distance calculations.';
          }

          if (
            locationPermission ===
            'granted' &&
            locationServicesEnabled ===
              false
          ) {
            return 'Permission is granted, but device location services are currently switched off.';
          }

          if (
            locationPermission ===
              'denied' &&
            !canAskLocationAgain
          ) {
            return Platform.OS ===
              'web'
              ? 'Location is blocked in your browser site settings. You can continue onboarding and enable it later.'
              : 'Location is blocked at system level. You can continue onboarding and enable it later in device settings.';
          }

          if (
            locationPermission ===
            'denied'
          ) {
            return 'Location access is currently denied. You can continue onboarding and retry later.';
          }

          if (
            locationPermission ===
            'undetermined'
          ) {
            return 'Treasi has not requested your foreground location permission yet.';
          }

          return 'Treasi will only request foreground location when you choose to enable it.';
        },
        [
          canAskLocationAgain,
          locationPermission,
          locationServicesEnabled,
        ],
      );

    const progressWidth =
      progressAnim.interpolate({
        inputRange: [
          0,
          1,
        ],
        outputRange: [
          '0%',
          '100%',
        ],
        extrapolate:
          'clamp',
      });

    /* ---------------------------------------------------------------------- */
    /* Render                                                                 */
    /* ---------------------------------------------------------------------- */

    return (
      <View
        style={[
          styles.mainWrapper,
          {
            paddingLeft:
              Math.max(
                insets.left,
                16,
              ),

            paddingRight:
              Math.max(
                insets.right,
                16,
              ),

            paddingTop:
              Math.max(
                insets.top,
                10,
              ),

            paddingBottom:
              Math.max(
                insets.bottom,
                10,
              ),
          },
        ]}
      >
        {!isLandscape ? (
          <View
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            accessibilityLabel="Landscape orientation required. Rotate your device horizontally to continue."
            style={
              styles.portraitWarningOverlay
            }
          >
            <RotateDeviceIcon
              colour={
                PALETTE.parchment
              }
              size={40}
            />

            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={
                1.6
              }
              style={[
                styles.portraitWarningTitle,
                {
                  fontFamily:
                    fontMonospace,
                },
              ]}
            >
              ORIENTATION REQUIRED
            </Text>

            <Text
              maxFontSizeMultiplier={
                1.8
              }
              style={[
                styles.portraitWarningDesc,
                {
                  fontFamily:
                    fontMonospace,
                },
              ]}
            >
              ROTATE YOUR DEVICE HORIZONTALLY TO USE THE TREASI FIELD INTERFACE.
            </Text>
          </View>
        ) : (
          <View
            style={
              styles.container
            }
          >
            {/* ---------------------------------------------------------------- */}
            {/* Left field manual panel                                          */}
            {/* ---------------------------------------------------------------- */}

            <View
              style={
                styles.leftViewport
              }
            >
              <View
                accessible={
                  false
                }
                importantForAccessibility="no"
                style={[
                  styles.rivet,
                  styles.rivetTopLeft,
                ]}
              />

              <View
                accessible={
                  false
                }
                importantForAccessibility="no"
                style={[
                  styles.rivet,
                  styles.rivetTopRight,
                ]}
              />

              <View
                accessible={
                  false
                }
                importantForAccessibility="no"
                style={[
                  styles.rivet,
                  styles.rivetBottomLeft,
                ]}
              />

              <View
                accessible={
                  false
                }
                importantForAccessibility="no"
                style={[
                  styles.rivet,
                  styles.rivetBottomRight,
                ]}
              />

              <View
                style={
                  styles.headerMetaRow
                }
              >
                <Text
                  maxFontSizeMultiplier={
                    1.5
                  }
                  style={[
                    styles.metaDocCode,
                    {
                      fontFamily:
                        fontMonospace,
                    },
                  ]}
                >
                  TREASI FIELD MANUAL
                </Text>

                <Text
                  accessibilityLabel={`Step ${
                    index + 1
                  } of ${
                    STEPS.length
                  }`}
                  maxFontSizeMultiplier={
                    1.5
                  }
                  style={[
                    styles.metaStepBadge,
                    {
                      fontFamily:
                        fontMonospace,
                    },
                  ]}
                >
                  {
                    current.step
                  }
                </Text>
              </View>

              <Animated.View
                accessible
                accessibilityRole="text"
                accessibilityLabel={`${current.title}. ${current.subtitle}. ${current.description}`}
                style={[
                  styles.contentContainer,

                  isCompact &&
                    styles.contentContainerCompact,

                  {
                    opacity:
                      fadeAnim,

                    transform: [
                      {
                        translateY:
                          slideAnim,
                      },
                    ],
                  },
                ]}
              >
                <View
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  style={[
                    styles.iconWrapper,
                    isCompact &&
                      styles.iconWrapperCompact,
                  ]}
                >
                  <StepIcon
                    colour={
                      PALETTE.sienna
                    }
                    size={
                      isCompact
                        ? 24
                        : 28
                    }
                  />
                </View>

                <Text
                  maxFontSizeMultiplier={
                    1.5
                  }
                  style={[
                    styles.protocolCodeText,
                    {
                      fontFamily:
                        fontMonospace,
                    },
                  ]}
                >
                  {
                    current.protocolCode
                  }
                </Text>

                <Text
                  accessibilityRole="header"
                  maxFontSizeMultiplier={
                    1.6
                  }
                  style={[
                    styles.titleText,
                    isCompact &&
                      styles.titleTextCompact,
                    {
                      fontFamily:
                        fontMonospace,
                    },
                  ]}
                >
                  {
                    current.title
                  }
                </Text>

                <Text
                  maxFontSizeMultiplier={
                    1.6
                  }
                  style={[
                    styles.subtitleText,
                    {
                      fontFamily:
                        fontMonospace,
                    },
                  ]}
                >
                  [
                  {' '}
                  {
                    current.subtitle
                  }
                  {' '}
                  ]
                </Text>

                <View
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  style={
                    styles.dividerLine
                  }
                />

                <Text
                  maxFontSizeMultiplier={
                    1.8
                  }
                  style={[
                    styles.descText,
                    isCompact &&
                      styles.descTextCompact,
                    {
                      fontFamily:
                        fontMonospace,
                    },
                  ]}
                >
                  {
                    current.description
                  }
                </Text>
              </Animated.View>

              {errorMessage ? (
                <View
                  accessible
                  accessibilityRole="alert"
                  accessibilityLiveRegion="assertive"
                  style={
                    styles.errorContainer
                  }
                >
                  <Text
                    maxFontSizeMultiplier={
                      1.7
                    }
                    style={[
                      styles.errorText,
                      {
                        fontFamily:
                          fontMonospace,
                      },
                    ]}
                  >
                    {
                      errorMessage
                    }
                  </Text>
                </View>
              ) : null}

              <View
                style={
                  styles.footerNoteRow
                }
              >
                <Text
                  maxFontSizeMultiplier={
                    1.4
                  }
                  style={[
                    styles.footerNote,
                    {
                      fontFamily:
                        fontMonospace,
                    },
                  ]}
                >
                  FIELD PROTOCOL
                </Text>

                <Text
                  maxFontSizeMultiplier={
                    1.4
                  }
                  style={[
                    styles.footerNote,
                    {
                      fontFamily:
                        fontMonospace,
                    },
                  ]}
                >
                  ACCESSIBLE SYSTEM
                </Text>
              </View>
            </View>

            {/* ---------------------------------------------------------------- */}
            {/* Right telemetry panel                                           */}
            {/* ---------------------------------------------------------------- */}

            <View
              style={
                styles.rightViewport
              }
            >
              <View
                style={
                  styles.consoleCard
                }
              >
                <Text
                  accessibilityRole="header"
                  maxFontSizeMultiplier={
                    1.6
                  }
                  style={[
                    styles.consoleHeader,
                    {
                      fontFamily:
                        fontMonospace,
                    },
                  ]}
                >
                  DEVICE STATUS
                </Text>

                <View
                  accessibilityLiveRegion="polite"
                  style={
                    styles.statusList
                  }
                >
                  {statusLines.map(
                    (status) => (
                      <View
                        key={
                          status.id
                        }
                        accessible
                        accessibilityLabel={`${status.label}: ${status.value}`}
                        style={
                          styles.telemetryStatusBox
                        }
                      >
                        <Animated.View
                          accessible={
                            false
                          }
                          importantForAccessibility="no"
                          style={[
                            styles.statusDot,

                            status.tone ===
                              'success' &&
                              styles.statusDotSuccess,

                            status.tone ===
                              'warning' &&
                              styles.statusDotWarning,

                            status.tone ===
                              'error' &&
                              styles.statusDotError,

                            status.tone ===
                              'neutral' &&
                              styles.statusDotNeutral,

                            {
                              opacity:
                                statusPulseAnim,
                            },
                          ]}
                        />

                        <View
                          style={
                            styles.statusTextContainer
                          }
                        >
                          <Text
                            maxFontSizeMultiplier={
                              1.5
                            }
                            style={[
                              styles.statusLabel,
                              {
                                fontFamily:
                                  fontMonospace,
                              },
                            ]}
                          >
                            {
                              status.label
                            }
                          </Text>

                          <Text
                            maxFontSizeMultiplier={
                              1.5
                            }
                            numberOfLines={
                              2
                            }
                            style={[
                              styles.telemetryStatusText,
                              {
                                fontFamily:
                                  fontMonospace,
                              },
                            ]}
                          >
                            {
                              status.value
                            }
                          </Text>
                        </View>
                      </View>
                    ),
                  )}
                </View>

                {index ===
                  1 && (
                  <View>
                    <Text
                      maxFontSizeMultiplier={
                        1.7
                      }
                      style={[
                        styles.locationGuidance,
                        {
                          fontFamily:
                            fontMonospace,
                        },
                      ]}
                    >
                      {
                        locationGuidance
                      }
                    </Text>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        permissionActionLabel
                      }
                      accessibilityHint={
                        locationPermission ===
                          'granted'
                          ? 'Checks the latest device location permission and sensor status.'
                          : 'Allows you to manage foreground location access for Treasi.'
                      }
                      accessibilityState={{
                        disabled:
                          isRefreshingCapabilities ||
                          isRequestingPermission,
                        busy:
                          isRefreshingCapabilities ||
                          isRequestingPermission,
                      }}
                      disabled={
                        isRefreshingCapabilities ||
                        isRequestingPermission
                      }
                      hitSlop={6}
                      onPress={() => {
                        void handleLocationAction();
                      }}
                      style={({
                        pressed,
                      }) => [
                        styles.permissionActionButton,
                        pressed &&
                          styles.buttonPressed,
                      ]}
                    >
                      {isRefreshingCapabilities ||
                      isRequestingPermission ? (
                        <ActivityIndicator
                          size="small"
                          color={
                            PALETTE.parchment
                          }
                        />
                      ) : (
                        <Text
                          maxFontSizeMultiplier={
                            1.5
                          }
                          style={[
                            styles.permissionActionButtonText,
                            {
                              fontFamily:
                                fontMonospace,
                            },
                          ]}
                        >
                          {
                            permissionActionLabel
                          }
                        </Text>
                      )}
                    </Pressable>
                  </View>
                )}

                {/* ------------------------------------------------------------ */}
                {/* Progress                                                     */}
                {/* ------------------------------------------------------------ */}

                <View
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel="Onboarding progress"
                  accessibilityValue={{
                    min: 1,
                    max:
                      STEPS.length,
                    now:
                      index + 1,
                    text: `Step ${
                      index + 1
                    } of ${
                      STEPS.length
                    }`,
                  }}
                  style={
                    styles.progressTrackerContainer
                  }
                >
                  <Text
                    maxFontSizeMultiplier={
                      1.5
                    }
                    style={[
                      styles.progressLabel,
                      {
                        fontFamily:
                          fontMonospace,
                      },
                    ]}
                  >
                    PROTOCOL PROGRESS — STEP{' '}
                    {index + 1} OF{' '}
                    {
                      STEPS.length
                    }
                  </Text>

                  <View
                    style={
                      styles.progressBarTrack
                    }
                  >
                    <Animated.View
                      style={[
                        styles.progressBarFill,
                        {
                          width:
                            progressWidth,
                        },
                      ]}
                    />
                  </View>
                </View>

                {/* ------------------------------------------------------------ */}
                {/* Step navigation                                              */}
                {/* ------------------------------------------------------------ */}

                <View
                  accessibilityRole="tablist"
                  style={
                    styles.nodeRow
                  }
                >
                  {STEPS.map(
                    (
                      _,
                      stepIndex,
                    ) => {
                      const selected =
                        stepIndex ===
                        index;

                      const completed =
                        stepIndex <
                        index;

                      return (
                        <Pressable
                          key={
                            stepIndex
                          }
                          accessibilityRole="tab"
                          accessibilityLabel={`Step ${
                            stepIndex +
                            1
                          } of ${
                            STEPS.length
                          }`}
                          accessibilityState={{
                            selected,
                            disabled:
                              isBusy,
                          }}
                          disabled={
                            isBusy
                          }
                          hitSlop={4}
                          onPress={() =>
                            handleStepTransition(
                              stepIndex,
                            )
                          }
                          style={({
                            pressed,
                          }) => [
                            styles.stepNode,

                            selected &&
                              styles.stepNodeActive,

                            completed &&
                              styles.stepNodeCompleted,

                            pressed &&
                              !isBusy &&
                              styles.buttonPressed,
                          ]}
                        >
                          <Text
                            maxFontSizeMultiplier={
                              1.4
                            }
                            style={[
                              styles.stepNodeText,

                              selected &&
                                styles.stepNodeTextActive,

                              completed &&
                                styles.stepNodeTextCompleted,

                              {
                                fontFamily:
                                  fontMonospace,
                              },
                            ]}
                          >
                            {completed
                              ? '✓'
                              : `0${
                                  stepIndex +
                                  1
                                }`}
                          </Text>
                        </Pressable>
                      );
                    },
                  )}
                </View>

                {/* ------------------------------------------------------------ */}
                {/* Main navigation controls                                     */}
                {/* ------------------------------------------------------------ */}

                <View
                  style={
                    styles.controlButtonsRow
                  }
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Previous onboarding step"
                    accessibilityState={{
                      disabled:
                        index ===
                          0 ||
                        isBusy,
                    }}
                    disabled={
                      index ===
                        0 ||
                      isBusy
                    }
                    hitSlop={4}
                    onPress={
                      handleBack
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.navButton,
                      styles.backButton,

                      (index ===
                        0 ||
                        isBusy) &&
                        styles.buttonDisabled,

                      pressed &&
                        index >
                          0 &&
                        !isBusy &&
                        styles.buttonPressed,
                    ]}
                  >
                    <ChevronLeftIcon
                      colour={
                        index ===
                        0
                          ? PALETTE.brass
                          : PALETTE.parchment
                      }
                      size={18}
                    />

                    <Text
                      maxFontSizeMultiplier={
                        1.5
                      }
                      style={[
                        styles.navButtonText,

                        index ===
                          0 &&
                          styles.navButtonTextDisabled,

                        {
                          fontFamily:
                            fontMonospace,
                        },
                      ]}
                    >
                      BACK
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      isFinalStep
                        ? 'Complete onboarding'
                        : 'Next onboarding step'
                    }
                    accessibilityState={{
                      disabled:
                        isBusy,
                      busy:
                        isCompleting,
                    }}
                    disabled={
                      isBusy
                    }
                    hitSlop={4}
                    onPress={
                      handleNext
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.navButton,
                      styles.nextButton,

                      isFinalStep &&
                        styles.completeButton,

                      isBusy &&
                        styles.buttonDisabled,

                      pressed &&
                        !isBusy &&
                        styles.buttonPressed,
                    ]}
                  >
                    {isCompleting ? (
                      <ActivityIndicator
                        size="small"
                        color={
                          PALETTE.parchment
                        }
                      />
                    ) : (
                      <>
                        <Text
                          maxFontSizeMultiplier={
                            1.5
                          }
                          style={[
                            styles.nextButtonText,
                            {
                              fontFamily:
                                fontMonospace,
                            },
                          ]}
                        >
                          {isFinalStep
                            ? 'COMPLETE'
                            : 'NEXT'}
                        </Text>

                        {isFinalStep ? (
                          <CheckIcon
                            colour={
                              PALETTE.parchment
                            }
                            size={18}
                          />
                        ) : (
                          <ChevronRightIcon
                            colour={
                              PALETTE.parchment
                            }
                            size={18}
                          />
                        )}
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Location permission explanation                                   */}
        {/* ------------------------------------------------------------------ */}

        <Modal
          visible={
            showPermissionModal
          }
          transparent
          animationType={
            reduceMotionEnabled
              ? 'none'
              : 'fade'
          }
          onRequestClose={() =>
            setShowPermissionModal(
              false,
            )
          }
        >
          <View
            style={
              styles.modalOverlay
            }
          >
            <View
              accessible
              accessibilityViewIsModal
              accessibilityRole="alert"
              accessibilityLabel="Location permission explanation"
              onAccessibilityEscape={() =>
                setShowPermissionModal(
                  false,
                )
              }
              style={
                styles.modalCard
              }
            >
              <View
                accessible={
                  false
                }
                importantForAccessibility="no"
                style={
                  styles.modalIconWrapper
                }
              >
                <TelemetryIcon
                  colour={
                    PALETTE.sienna
                  }
                  size={32}
                />
              </View>

              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={
                  1.6
                }
                style={[
                  styles.modalTitle,
                  {
                    fontFamily:
                      fontMonospace,
                  },
                ]}
              >
                ENABLE LOCATION?
              </Text>

              <Text
                maxFontSizeMultiplier={
                  1.5
                }
                style={[
                  styles.modalSubtitle,
                  {
                    fontFamily:
                      fontMonospace,
                  },
                ]}
              >
                [
                {' '}
                FOREGROUND LOCATION
                {' '}
                ]
              </Text>

              <View
                accessible={
                  false
                }
                importantForAccessibility="no"
                style={
                  styles.modalDivider
                }
              />

              <Text
                maxFontSizeMultiplier={
                  1.8
                }
                style={[
                  styles.modalDescription,
                  {
                    fontFamily:
                      fontMonospace,
                  },
                ]}
              >
                Treasi uses your foreground location while you are using the app to calculate your distance from hidden treasures and determine when you have reached an excavation area.
              </Text>

              <Text
                maxFontSizeMultiplier={
                  1.8
                }
                style={[
                  styles.modalPrivacyNote,
                  {
                    fontFamily:
                      fontMonospace,
                  },
                ]}
              >
                You can continue without granting access now. Location-dependent hunting features will require permission when you use them.
              </Text>

              <View
                style={
                  styles.modalActionsRow
                }
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Not now"
                  accessibilityHint="Closes this explanation without requesting location permission."
                  disabled={
                    isRequestingPermission
                  }
                  onPress={() =>
                    setShowPermissionModal(
                      false,
                    )
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.modalCancelButton,

                    pressed &&
                      styles.modalLightButtonPressed,
                  ]}
                >
                  <Text
                    maxFontSizeMultiplier={
                      1.5
                    }
                    style={[
                      styles.modalCancelButtonText,
                      {
                        fontFamily:
                          fontMonospace,
                      },
                    ]}
                  >
                    NOT NOW
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Enable foreground location"
                  accessibilityHint="Requests foreground location permission from your device or browser."
                  accessibilityState={{
                    busy:
                      isRequestingPermission,
                    disabled:
                      isRequestingPermission,
                  }}
                  disabled={
                    isRequestingPermission
                  }
                  onPress={() => {
                    void requestLocationPermission();
                  }}
                  style={({
                    pressed,
                  }) => [
                    styles.modalGrantButton,

                    isRequestingPermission &&
                      styles.buttonDisabled,

                    pressed &&
                      !isRequestingPermission &&
                      styles.buttonPressed,
                  ]}
                >
                  {isRequestingPermission ? (
                    <ActivityIndicator
                      size="small"
                      color={
                        PALETTE.parchment
                      }
                    />
                  ) : (
                    <Text
                      maxFontSizeMultiplier={
                        1.5
                      }
                      style={[
                        styles.modalGrantButtonText,
                        {
                          fontFamily:
                            fontMonospace,
                        },
                      ]}
                    >
                      ENABLE LOCATION
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  };

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    mainWrapper: {
      flex: 1,
      backgroundColor:
        PALETTE.forestDeep,
    },

    container: {
      flex: 1,
      flexDirection:
        'row',
      gap: 12,
    },

    /* ---------------------------------------------------------------------- */
    /* Portrait safeguard                                                     */
    /* ---------------------------------------------------------------------- */

    portraitWarningOverlay: {
      flex: 1,
      backgroundColor:
        PALETTE.forestDeep,
      justifyContent:
        'center',
      alignItems:
        'center',
      padding: 24,
    },

    portraitWarningTitle: {
      fontWeight:
        '700',
      fontSize: 17,
      lineHeight: 23,
      color:
        PALETTE.alertLight,
      marginTop: 16,
      marginBottom: 8,
      textAlign:
        'center',
      letterSpacing: 1.3,
    },

    portraitWarningDesc: {
      fontSize: 12,
      lineHeight: 19,
      color:
        PALETTE.parchment,
      textAlign:
        'center',
      letterSpacing: 0.7,
      maxWidth: 440,
    },

    /* ---------------------------------------------------------------------- */
    /* Left viewport                                                          */
    /* ---------------------------------------------------------------------- */

    leftViewport: {
      flex: 0.6,
      minWidth: 0,
      backgroundColor:
        PALETTE.parchment,
      borderRadius: 7,
      borderWidth: 2,
      borderColor:
        PALETTE.brass,
      padding: 16,
      justifyContent:
        'space-between',
      position:
        'relative',
    },

    rivet: {
      position:
        'absolute',
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor:
        PALETTE.brass,
      borderWidth: 1,
      borderColor:
        PALETTE.inkBlack,
    },

    rivetTopLeft: {
      top: 6,
      left: 6,
    },

    rivetTopRight: {
      top: 6,
      right: 6,
    },

    rivetBottomLeft: {
      bottom: 6,
      left: 6,
    },

    rivetBottomRight: {
      bottom: 6,
      right: 6,
    },

    headerMetaRow: {
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'center',
      borderBottomWidth:
        1,
      borderBottomColor:
        PALETTE.brass,
      paddingBottom: 8,
      minHeight: 26,
    },

    metaDocCode: {
      flexShrink: 1,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '700',
      color:
        PALETTE.inkBlack,
      letterSpacing: 0.8,
    },

    metaStepBadge: {
      fontSize: 11,
      lineHeight: 16,
      fontWeight:
        '700',
      color:
        PALETTE.sienna,
      letterSpacing: 1,
      marginLeft: 12,
    },

    contentContainer: {
      flex: 1,
      justifyContent:
        'center',
      alignItems:
        'flex-start',
      paddingVertical: 8,
    },

    contentContainerCompact: {
      paddingVertical: 3,
    },

    iconWrapper: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor:
        PALETTE.parchmentLight,
      borderWidth: 1.5,
      borderColor:
        PALETTE.sienna,
      justifyContent:
        'center',
      alignItems:
        'center',
      marginBottom: 9,
    },

    iconWrapperCompact: {
      width: 40,
      height: 40,
      borderRadius: 20,
      marginBottom: 5,
    },

    protocolCodeText: {
      fontSize: 10,
      lineHeight: 15,
      color:
        PALETTE.sienna,
      fontWeight:
        '700',
      letterSpacing: 0.9,
      marginBottom: 2,
    },

    titleText: {
      fontSize: 19,
      lineHeight: 24,
      fontWeight:
        '700',
      color:
        PALETTE.inkBlack,
      letterSpacing: 1,
    },

    titleTextCompact: {
      fontSize: 16,
      lineHeight: 21,
    },

    subtitleText: {
      fontSize: 10,
      lineHeight: 15,
      color:
        PALETTE.mutedGreen,
      letterSpacing: 0.6,
      marginTop: 2,
      marginBottom: 6,
    },

    dividerLine: {
      width: '100%',
      height: 1,
      backgroundColor:
        PALETTE.brass,
      marginVertical: 7,
      opacity: 0.65,
    },

    descText: {
      fontSize: 12,
      lineHeight: 19,
      color:
        PALETTE.inkBlack,
      letterSpacing: 0.25,
      maxWidth: 620,
    },

    descTextCompact: {
      fontSize: 11,
      lineHeight: 16,
    },

    footerNoteRow: {
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'center',
      borderTopWidth: 1,
      borderTopColor:
        PALETTE.brass,
      paddingTop: 6,
      gap: 12,
    },

    footerNote: {
      flexShrink: 1,
      fontSize: 8.5,
      lineHeight: 13,
      color:
        PALETTE.mutedGreen,
      fontWeight:
        '700',
      letterSpacing: 0.6,
    },

    errorContainer: {
      backgroundColor:
        PALETTE.alertRed,
      borderRadius: 4,
      borderWidth: 1,
      borderColor:
        PALETTE.alertLight,
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginVertical: 6,
    },

    errorText: {
      fontSize: 10,
      lineHeight: 15,
      color:
        PALETTE.parchmentLight,
      fontWeight:
        '700',
      textAlign:
        'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Right viewport                                                         */
    /* ---------------------------------------------------------------------- */

    rightViewport: {
      flex: 0.4,
      minWidth: 0,
    },

    consoleCard: {
      flex: 1,
      minWidth: 0,
      backgroundColor:
        PALETTE.forestDeep,
      borderRadius: 7,
      borderWidth: 2,
      borderColor:
        PALETTE.brass,
      padding: 13,
      justifyContent:
        'space-between',
    },

    consoleHeader: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight:
        '700',
      color:
        PALETTE.parchmentLight,
      letterSpacing: 1,
      borderBottomWidth: 1,
      borderBottomColor:
        PALETTE.brass,
      paddingBottom: 6,
    },

    statusList: {
      gap: 5,
    },

    telemetryStatusBox: {
      flexDirection:
        'row',
      alignItems:
        'center',
      backgroundColor:
        PALETTE.forestSurface,
      borderRadius: 4,
      borderWidth: 1,
      borderColor:
        PALETTE.brass,
      paddingHorizontal: 9,
      paddingVertical: 6,
      minHeight: 42,
    },

    statusDot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      marginRight: 9,
      flexShrink: 0,
    },

    statusDotSuccess: {
      backgroundColor:
        PALETTE.signalGreenLight,
    },

    statusDotWarning: {
      backgroundColor:
        PALETTE.warningLight,
    },

    statusDotError: {
      backgroundColor:
        PALETTE.alertLight,
    },

    statusDotNeutral: {
      backgroundColor:
        PALETTE.brassAccessible,
    },

    statusTextContainer: {
      flex: 1,
      minWidth: 0,
    },

    statusLabel: {
      color:
        PALETTE.brassAccessible,
      fontSize: 8.5,
      lineHeight: 12,
      fontWeight:
        '700',
      letterSpacing: 0.5,
    },

    telemetryStatusText: {
      color:
        PALETTE.parchmentLight,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '700',
      letterSpacing: 0.35,
    },

    locationGuidance: {
      color:
        PALETTE.parchment,
      fontSize: 9.5,
      lineHeight: 14,
      marginBottom: 6,
    },

    permissionActionButton: {
      minHeight: 48,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        PALETTE.siennaAccessible,
      borderRadius: 4,
      borderWidth: 1,
      borderColor:
        PALETTE.brassAccessible,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },

    permissionActionButtonText: {
      color:
        PALETTE.parchmentLight,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '700',
      letterSpacing: 0.65,
      textAlign:
        'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Progress                                                               */
    /* ---------------------------------------------------------------------- */

    progressTrackerContainer: {
      marginVertical: 3,
    },

    progressLabel: {
      color:
        PALETTE.brassAccessible,
      fontSize: 9,
      lineHeight: 14,
      fontWeight:
        '700',
      letterSpacing: 0.55,
      marginBottom: 5,
    },

    progressBarTrack: {
      height: 8,
      backgroundColor:
        PALETTE.forestSurface,
      borderRadius: 4,
      overflow:
        'hidden',
      borderWidth: 1,
      borderColor:
        PALETTE.brassAccessible,
    },

    progressBarFill: {
      height: '100%',
      backgroundColor:
        PALETTE.siennaAccessible,
    },

    /* ---------------------------------------------------------------------- */
    /* Step nodes                                                             */
    /* ---------------------------------------------------------------------- */

    nodeRow: {
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      gap: 8,
      marginVertical: 3,
    },

    stepNode: {
      flex: 1,
      minWidth: 48,
      minHeight: 48,
      borderRadius: 24,
      backgroundColor:
        PALETTE.forestSurface,
      borderWidth: 1.5,
      borderColor:
        PALETTE.brassAccessible,
      justifyContent:
        'center',
      alignItems:
        'center',
    },

    stepNodeActive: {
      backgroundColor:
        PALETTE.siennaAccessible,
      borderColor:
        PALETTE.parchmentLight,
    },

    stepNodeCompleted: {
      backgroundColor:
        PALETTE.mutedGreen,
      borderColor:
        PALETTE.signalGreenLight,
    },

    stepNodeText: {
      color:
        PALETTE.brassAccessible,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '700',
    },

    stepNodeTextActive: {
      color:
        PALETTE.parchmentLight,
    },

    stepNodeTextCompleted: {
      color:
        PALETTE.parchmentLight,
    },

    /* ---------------------------------------------------------------------- */
    /* Navigation buttons                                                     */
    /* ---------------------------------------------------------------------- */

    controlButtonsRow: {
      flexDirection:
        'row',
      gap: 8,
      marginTop: 3,
    },

    navButton: {
      flex: 1,
      flexDirection:
        'row',
      minHeight: 48,
      borderRadius: 4,
      borderWidth: 1.5,
      justifyContent:
        'center',
      alignItems:
        'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 7,
    },

    backButton: {
      backgroundColor:
        PALETTE.forestSurface,
      borderColor:
        PALETTE.brassAccessible,
    },

    nextButton: {
      backgroundColor:
        PALETTE.siennaAccessible,
      borderColor:
        PALETTE.brassAccessible,
    },

    completeButton: {
      backgroundColor:
        PALETTE.mutedGreen,
      borderColor:
        PALETTE.signalGreenLight,
    },

    buttonDisabled: {
      opacity: 0.45,
    },

    buttonPressed: {
      opacity: 0.78,
      transform: [
        {
          scale: 0.985,
        },
      ],
    },

    navButtonText: {
      color:
        PALETTE.parchmentLight,
      fontSize: 11,
      lineHeight: 16,
      fontWeight:
        '700',
      letterSpacing: 0.7,
    },

    navButtonTextDisabled: {
      color:
        PALETTE.brassAccessible,
    },

    nextButtonText: {
      color:
        PALETTE.parchmentLight,
      fontSize: 11,
      lineHeight: 16,
      fontWeight:
        '700',
      letterSpacing: 0.7,
    },

    /* ---------------------------------------------------------------------- */
    /* Permission modal                                                       */
    /* ---------------------------------------------------------------------- */

    modalOverlay: {
      flex: 1,
      backgroundColor:
        'rgba(24, 29, 24, 0.92)',
      justifyContent:
        'center',
      alignItems:
        'center',
      padding: 24,
    },

    modalCard: {
      width: '100%',
      maxWidth: 520,
      backgroundColor:
        PALETTE.parchment,
      borderRadius: 8,
      borderWidth: 2,
      borderColor:
        PALETTE.brass,
      padding: 20,
      alignItems:
        'center',
    },

    modalIconWrapper: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor:
        PALETTE.parchmentLight,
      borderWidth: 1.5,
      borderColor:
        PALETTE.sienna,
      justifyContent:
        'center',
      alignItems:
        'center',
      marginBottom: 10,
    },

    modalTitle: {
      color:
        PALETTE.inkBlack,
      fontSize: 15,
      lineHeight: 21,
      fontWeight:
        '700',
      letterSpacing: 0.9,
      textAlign:
        'center',
    },

    modalSubtitle: {
      color:
        PALETTE.sienna,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '700',
      letterSpacing: 0.7,
      marginTop: 2,
      marginBottom: 7,
      textAlign:
        'center',
    },

    modalDivider: {
      width: '100%',
      height: 1,
      backgroundColor:
        PALETTE.brass,
      marginVertical: 9,
      opacity: 0.7,
    },

    modalDescription: {
      color:
        PALETTE.inkBlack,
      fontSize: 11,
      lineHeight: 17,
      textAlign:
        'center',
      marginBottom: 10,
    },

    modalPrivacyNote: {
      color:
        PALETTE.mutedGreen,
      fontSize: 10,
      lineHeight: 16,
      textAlign:
        'center',
      marginBottom: 16,
    },

    modalActionsRow: {
      flexDirection:
        'row',
      gap: 12,
      width: '100%',
    },

    modalCancelButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor:
        PALETTE.brass,
      backgroundColor:
        PALETTE.parchmentLight,
      justifyContent:
        'center',
      alignItems:
        'center',
      paddingHorizontal: 10,
    },

    modalCancelButtonText: {
      color:
        PALETTE.inkBlack,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '700',
      letterSpacing: 0.55,
      textAlign:
        'center',
    },

    modalGrantButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor:
        PALETTE.brassAccessible,
      backgroundColor:
        PALETTE.siennaAccessible,
      justifyContent:
        'center',
      alignItems:
        'center',
      paddingHorizontal: 10,
    },

    modalGrantButtonText: {
      color:
        PALETTE.parchmentLight,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '700',
      letterSpacing: 0.55,
      textAlign:
        'center',
    },

    modalLightButtonPressed: {
      backgroundColor:
        '#DDD1B6',
    },
  });