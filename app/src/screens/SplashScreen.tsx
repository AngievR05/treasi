import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import {
  Accelerometer,
  Magnetometer,
} from 'expo-sensors';

import { onAuthStateChanged } from 'firebase/auth';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Logo from '../../assets/Logo.svg';

import {
  app,
  auth,
} from '../config/firebase';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface Props {
  onFinish?: () => void;
}

type DiagnosticState =
  | 'pending'
  | 'running'
  | 'success'
  | 'warning'
  | 'error';

interface DiagnosticItem {
  id:
    | 'runtime'
    | 'firebase'
    | 'auth'
    | 'storage'
    | 'location'
    | 'magnetometer'
    | 'accelerometer'
    | 'orientation';
  label: string;
  detail: string;
  state: DiagnosticState;
}

interface DiagnosticResult {
  detail: string;
  state:
    | 'success'
    | 'warning'
    | 'error';
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const COLORS = {
  forestDeep: '#1E281F',
  panelBg: '#131D14',
  parchment: '#F3ECD8',
  siennaAccent: '#C56645',
  brassTrim: '#C3A06A',
  mutedGreen: '#9BAE9F',
  success: '#A9C3A5',
  warning: '#E0B979',
  error: '#E18A73',
  borderColor: '#405443',
  progressTrack: '#0F1610',
};

const BOOT_STORAGE_TEST_KEY =
  '@treasi_boot_storage_test';

const MINIMUM_SPLASH_DURATION_MS =
  1100;

const FINAL_STATUS_HOLD_MS =
  350;

const DIAGNOSTIC_TIMEOUT_MS =
  3000;

const INITIAL_DIAGNOSTICS:
  DiagnosticItem[] = [
    {
      id: 'runtime',
      label: 'APP RUNTIME',
      detail: 'WAITING',
      state: 'pending',
    },
    {
      id: 'firebase',
      label: 'FIREBASE CLIENT',
      detail: 'WAITING',
      state: 'pending',
    },
    {
      id: 'auth',
      label: 'AUTH SESSION',
      detail: 'WAITING',
      state: 'pending',
    },
    {
      id: 'storage',
      label: 'LOCAL STORAGE',
      detail: 'WAITING',
      state: 'pending',
    },
    {
      id: 'location',
      label: 'LOCATION SERVICE',
      detail: 'WAITING',
      state: 'pending',
    },
    {
      id: 'magnetometer',
      label: 'MAGNETOMETER',
      detail: 'WAITING',
      state: 'pending',
    },
    {
      id: 'accelerometer',
      label: 'ACCELEROMETER',
      detail: 'WAITING',
      state: 'pending',
    },
    {
      id: 'orientation',
      label: 'FIELD INTERFACE',
      detail: 'WAITING',
      state: 'pending',
    },
  ];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Keeps diagnostic promises from blocking startup indefinitely.
const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  let timeoutId:
    | ReturnType<typeof setTimeout>
    | undefined;

  const timeoutPromise =
    new Promise<T>(
      (_, reject) => {
        timeoutId = setTimeout(
          () => {
            reject(
              new Error(
                'Diagnostic timed out.',
              ),
            );
          },
          timeoutMs,
        );
      },
    );

  try {
    return await Promise.race([
      promise,
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(
        timeoutId,
      );
    }
  }
};

// Converts location permission values into readable field status text.
const formatLocationPermission = (
  status: Location.PermissionStatus,
): string => {
  switch (status) {
    case Location.PermissionStatus.GRANTED:
      return 'PERMISSION GRANTED';

    case Location.PermissionStatus.DENIED:
      return 'PERMISSION DENIED';

    default:
      return 'PERMISSION NOT REQUESTED';
  }
};

// Waits for Firebase Auth to restore the actual persisted session.
const resolveAuthSession =
  (): Promise<DiagnosticResult> =>
    new Promise(
      (resolve) => {
        let resolved = false;

        let unsubscribe =
          (): void => {
            // Assigned immediately after the listener is created.
          };

        const finish = (
          result: DiagnosticResult,
        ): void => {
          if (resolved) {
            return;
          }

          resolved = true;

          unsubscribe();

          resolve(result);
        };

        unsubscribe =
          onAuthStateChanged(
            auth,
            (user) => {
              finish({
                state:
                  'success',
                detail: user
                  ? 'SESSION RESTORED'
                  : 'NO ACTIVE SESSION',
              });
            },
            () => {
              finish({
                state:
                  'warning',
                detail:
                  'SESSION CHECK UNAVAILABLE',
              });
            },
          );
      },
    );

/* -------------------------------------------------------------------------- */
/* Splash screen                                                              */
/* -------------------------------------------------------------------------- */

export const SplashScreen:
  React.FC<Props> = ({
    onFinish,
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

    const isCompact =
      height < 400;

    /* ---------------------------------------------------------------------- */
    /* Animation state                                                        */
    /* ---------------------------------------------------------------------- */

    const progressAnim =
      useRef(
        new Animated.Value(0),
      ).current;

    const pulseAnim =
      useRef(
        new Animated.Value(1),
      ).current;

    const fadeAnim =
      useRef(
        new Animated.Value(1),
      ).current;

    /* ---------------------------------------------------------------------- */
    /* Runtime state                                                          */
    /* ---------------------------------------------------------------------- */

    const [
      diagnostics,
      setDiagnostics,
    ] =
      useState<
        DiagnosticItem[]
      >(
        INITIAL_DIAGNOSTICS,
      );

    const [
      reduceMotionEnabled,
      setReduceMotionEnabled,
    ] =
      useState(false);

    const [
      cursorVisible,
      setCursorVisible,
    ] =
      useState(true);

    const mountedRef =
      useRef(true);

    const finishedRef =
      useRef(false);

    const diagnosticsStartedAtRef =
      useRef(
        Date.now(),
      );

    const initialViewportRef =
      useRef({
        width,
        height,
      });

    /* ---------------------------------------------------------------------- */
    /* Derived diagnostic values                                              */
    /* ---------------------------------------------------------------------- */

    const completedDiagnostics =
      useMemo(
        () =>
          diagnostics.filter(
            (item) =>
              item.state ===
                'success' ||
              item.state ===
                'warning' ||
              item.state ===
                'error',
          ).length,
        [diagnostics],
      );

    const progressPercent =
      Math.round(
        (
          completedDiagnostics /
          diagnostics.length
        ) *
          100,
      );

    const diagnosticsComplete =
      completedDiagnostics ===
      diagnostics.length;

    const warningCount =
      useMemo(
        () =>
          diagnostics.filter(
            (item) =>
              item.state ===
                'warning',
          ).length,
        [diagnostics],
      );

    const errorCount =
      useMemo(
        () =>
          diagnostics.filter(
            (item) =>
              item.state ===
                'error',
          ).length,
        [diagnostics],
      );

    const activeDiagnostic =
      useMemo(
        () =>
          diagnostics.find(
            (item) =>
              item.state ===
              'running',
          ) ??
          diagnostics.find(
            (item) =>
              item.state ===
              'pending',
          ) ??
          diagnostics[
            diagnostics.length -
              1
          ],
        [diagnostics],
      );

    /* ---------------------------------------------------------------------- */
    /* Accessibility preference                                              */
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
          // Animation defaults remain safe when the preference cannot be read.
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
    /* Cursor                                                                 */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        reduceMotionEnabled ||
        diagnosticsComplete
      ) {
        setCursorVisible(
          true,
        );

        return;
      }

      const intervalId =
        setInterval(
          () => {
            setCursorVisible(
              (current) =>
                !current,
            );
          },
          500,
        );

      return () => {
        clearInterval(
          intervalId,
        );
      };
    }, [
      diagnosticsComplete,
      reduceMotionEnabled,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Logo pulse                                                             */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        reduceMotionEnabled
      ) {
        pulseAnim.stopAnimation();

        pulseAnim.setValue(
          1,
        );

        return;
      }

      const animation =
        Animated.loop(
          Animated.sequence([
            Animated.timing(
              pulseAnim,
              {
                toValue:
                  1.035,
                duration:
                  1000,
                easing:
                  Easing.inOut(
                    Easing.ease,
                  ),
                useNativeDriver:
                  true,
              },
            ),

            Animated.timing(
              pulseAnim,
              {
                toValue: 1,
                duration:
                  1000,
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
      pulseAnim,
      reduceMotionEnabled,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Progress animation                                                     */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        reduceMotionEnabled
      ) {
        progressAnim.setValue(
          progressPercent,
        );

        return;
      }

      Animated.timing(
        progressAnim,
        {
          toValue:
            progressPercent,
          duration: 180,
          easing:
            Easing.out(
              Easing.cubic,
            ),
          useNativeDriver:
            false,
        },
      ).start();
    }, [
      progressAnim,
      progressPercent,
      reduceMotionEnabled,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Diagnostic state helpers                                               */
    /* ---------------------------------------------------------------------- */

    const updateDiagnostic =
      useCallback(
        (
          id:
            DiagnosticItem['id'],
          update: Pick<
            DiagnosticItem,
            'detail' | 'state'
          >,
        ): void => {
          if (
            !mountedRef.current
          ) {
            return;
          }

          setDiagnostics(
            (current) =>
              current.map(
                (item) =>
                  item.id === id
                    ? {
                        ...item,
                        ...update,
                      }
                    : item,
              ),
          );
        },
        [],
      );

    const runDiagnostic =
      useCallback(
        async (
          id:
            DiagnosticItem['id'],
          task: () =>
            Promise<DiagnosticResult>,
        ): Promise<void> => {
          updateDiagnostic(
            id,
            {
              state:
                'running',
              detail:
                'CHECKING',
            },
          );

          try {
            const result =
              await withTimeout(
                task(),
                DIAGNOSTIC_TIMEOUT_MS,
              );

            updateDiagnostic(
              id,
              result,
            );
          } catch {
            updateDiagnostic(
              id,
              {
                state:
                  'warning',
                detail:
                  'CHECK UNAVAILABLE',
              },
            );
          }
        },
        [
          updateDiagnostic,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Real boot diagnostics                                                  */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      mountedRef.current =
        true;

      diagnosticsStartedAtRef.current =
        Date.now();

      const {
        width:
          initialWidth,
        height:
          initialHeight,
      } =
        initialViewportRef.current;

      const runChecks =
        async (): Promise<void> => {
          /*
           * Each result is based on the actual current application,
           * device or browser state. No synthetic hardware values
           * are displayed.
           */
          await Promise.all([
            runDiagnostic(
              'runtime',
              async () => ({
                state:
                  'success',
                detail: `${Platform.OS.toUpperCase()} ${Math.round(
                  initialWidth,
                )}×${Math.round(
                  initialHeight,
                )}`,
              }),
            ),

            runDiagnostic(
              'firebase',
              async () => {
                const projectId =
                  app.options
                    .projectId;

                if (
                  !projectId ||
                  auth.app !== app
                ) {
                  return {
                    state:
                      'error',
                    detail:
                      'INITIALISATION FAILED',
                  };
                }

                return {
                  state:
                    'success',
                  detail:
                    'CLIENT INITIALISED',
                };
              },
            ),

            runDiagnostic(
              'auth',
              async () =>
                resolveAuthSession(),
            ),

            runDiagnostic(
              'storage',
              async () => {
                const testValue =
                  `${Date.now()}`;

                await AsyncStorage.setItem(
                  BOOT_STORAGE_TEST_KEY,
                  testValue,
                );

                const storedValue =
                  await AsyncStorage.getItem(
                    BOOT_STORAGE_TEST_KEY,
                  );

                await AsyncStorage.removeItem(
                  BOOT_STORAGE_TEST_KEY,
                );

                if (
                  storedValue !==
                  testValue
                ) {
                  return {
                    state:
                      'warning',
                    detail:
                      'READ / WRITE CHECK FAILED',
                  };
                }

                return {
                  state:
                    'success',
                  detail:
                    'READ / WRITE READY',
                };
              },
            ),

            runDiagnostic(
              'location',
              async () => {
                const [
                  servicesEnabled,
                  permission,
                ] =
                  await Promise.all([
                    Location
                      .hasServicesEnabledAsync(),
                    Location
                      .getForegroundPermissionsAsync(),
                  ]);

                const permissionLabel =
                  formatLocationPermission(
                    permission.status,
                  );

                if (
                  !servicesEnabled
                ) {
                  return {
                    state:
                      'warning',
                    detail: `SERVICES OFF • ${permissionLabel}`,
                  };
                }

                return {
                  state:
                    permission.status ===
                    Location
                      .PermissionStatus
                      .DENIED
                      ? 'warning'
                      : 'success',

                  detail: `SERVICES ON • ${permissionLabel}`,
                };
              },
            ),

            runDiagnostic(
              'magnetometer',
              async () => {
                const available =
                  await Magnetometer.isAvailableAsync();

                return {
                  state:
                    available
                      ? 'success'
                      : 'warning',

                  detail:
                    available
                      ? 'AVAILABLE'
                      : 'UNAVAILABLE ON DEVICE',
                };
              },
            ),

            runDiagnostic(
              'accelerometer',
              async () => {
                const available =
                  await Accelerometer.isAvailableAsync();

                return {
                  state:
                    available
                      ? 'success'
                      : 'warning',

                  detail:
                    available
                      ? 'AVAILABLE'
                      : 'UNAVAILABLE ON DEVICE',
                };
              },
            ),

            runDiagnostic(
              'orientation',
              async () => {
                const landscape =
                  initialWidth >
                  initialHeight;

                return {
                  state:
                    landscape
                      ? 'success'
                      : 'warning',

                  detail:
                    landscape
                      ? 'LANDSCAPE READY'
                      : 'ROTATION REQUIRED',
                };
              },
            ),
          ]);
        };

      void runChecks();

      return () => {
        mountedRef.current =
          false;
      };
    }, [
      runDiagnostic,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Finish                                                                 */
    /* ---------------------------------------------------------------------- */

    const finishSplash =
      useCallback(
        () => {
          if (
            finishedRef.current
          ) {
            return;
          }

          finishedRef.current =
            true;

          pulseAnim.stopAnimation();
          progressAnim.stopAnimation();

          if (
            reduceMotionEnabled
          ) {
            fadeAnim.setValue(
              0,
            );

            onFinish?.();

            return;
          }

          Animated.timing(
            fadeAnim,
            {
              toValue: 0,
              duration: 300,
              easing:
                Easing.out(
                  Easing.quad,
                ),
              useNativeDriver:
                true,
            },
          ).start(
            ({
              finished,
            }) => {
              if (finished) {
                onFinish?.();
              }
            },
          );
        },
        [
          fadeAnim,
          onFinish,
          progressAnim,
          pulseAnim,
          reduceMotionEnabled,
        ],
      );

    useEffect(() => {
      if (
        !diagnosticsComplete ||
        finishedRef.current
      ) {
        return;
      }

      const elapsed =
        Date.now() -
        diagnosticsStartedAtRef.current;

      const remainingMinimum =
        Math.max(
          0,
          MINIMUM_SPLASH_DURATION_MS -
            elapsed,
        );

      const timeoutId =
        setTimeout(
          finishSplash,
          remainingMinimum +
            FINAL_STATUS_HOLD_MS,
        );

      return () => {
        clearTimeout(
          timeoutId,
        );
      };
    }, [
      diagnosticsComplete,
      finishSplash,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Manual continuation                                                    */
    /* ---------------------------------------------------------------------- */

    const handleSkip =
      useCallback(() => {
        finishSplash();
      }, [
        finishSplash,
      ]);

    /* ---------------------------------------------------------------------- */
    /* Styling values                                                         */
    /* ---------------------------------------------------------------------- */

    const progressWidth =
      progressAnim.interpolate({
        inputRange: [
          0,
          100,
        ],
        outputRange: [
          '0%',
          '100%',
        ],
        extrapolate:
          'clamp',
      });

    const logoSize =
      isCompact
        ? 82
        : 108;

    const currentStatusLabel =
      diagnosticsComplete
        ? errorCount > 0
          ? 'STARTUP CHECK COMPLETE WITH ERRORS'
          : warningCount > 0
            ? 'STARTUP CHECK COMPLETE'
            : 'FIELD SYSTEM READY'
        : 'VERIFYING FIELD SYSTEMS';

    const diagnosticSummary =
      diagnosticsComplete
        ? `${diagnostics.length} checks complete. ${warningCount} warnings. ${errorCount} errors.`
        : `${completedDiagnostics} of ${diagnostics.length} startup checks complete.`;

    /* ---------------------------------------------------------------------- */
    /* Render                                                                 */
    /* ---------------------------------------------------------------------- */

    return (
      <Animated.View
        style={[
          styles.container,
          {
            opacity:
              fadeAnim,

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
        {/* ------------------------------------------------------------------ */}
        {/* Brand panel                                                        */}
        {/* ------------------------------------------------------------------ */}

        <View
          style={
            styles.leftPanel
          }
        >
          <Animated.View
            accessibilityRole="image"
            accessibilityLabel="Treasi emblem"
            style={[
              styles.logoWrapper,
              {
                width:
                  logoSize,
                height:
                  logoSize,

                transform: [
                  {
                    scale:
                      pulseAnim,
                  },
                ],
              },
            ]}
          >
            <Logo
              width={
                logoSize
              }
              height={
                logoSize
              }
            />
          </Animated.View>

          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={
              1.6
            }
            style={[
              styles.title,
              isCompact &&
                styles.titleCompact,
            ]}
          >
            T R E A S I
          </Text>

          <Text
            maxFontSizeMultiplier={
              1.6
            }
            style={[
              styles.tagline,
              {
                fontFamily:
                  fontMonospace,
              },
            ]}
          >
            HIDE. EXPLORE. STAY CONNECTED.
          </Text>

          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Treasi startup checks"
            accessibilityValue={{
              min: 0,
              max: 100,
              now:
                progressPercent,
              text:
                diagnosticSummary,
            }}
            style={
              styles.progressSection
            }
          >
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

            <View
              style={
                styles.progressLabels
              }
            >
              <Text
                maxFontSizeMultiplier={
                  1.5
                }
                style={[
                  styles.progressText,
                  {
                    fontFamily:
                      fontMonospace,
                  },
                ]}
              >
                {currentStatusLabel}
              </Text>

              <Text
                maxFontSizeMultiplier={
                  1.5
                }
                style={[
                  styles.progressText,
                  {
                    fontFamily:
                      fontMonospace,
                  },
                ]}
              >
                {progressPercent}%
              </Text>
            </View>
          </View>
        </View>

        {/* ------------------------------------------------------------------ */}
        {/* Diagnostic panel                                                   */}
        {/* ------------------------------------------------------------------ */}

        <View
          style={
            styles.rightPanel
          }
        >
          <View
            style={
              styles.terminalHeader
            }
          >
            <Text
              accessible={
                false
              }
              importantForAccessibility="no"
              style={
                styles.terminalStar
              }
            >
              ★
            </Text>

            <Text
              maxFontSizeMultiplier={
                1.6
              }
              style={[
                styles.terminalTitle,
                {
                  fontFamily:
                    fontMonospace,
                },
              ]}
            >
              FIELD SYSTEM CHECK
            </Text>

            <View
              style={
                styles.headerDivider
              }
            />
          </View>

          <View
            accessibilityLiveRegion="polite"
            accessibilityLabel={
              diagnosticsComplete
                ? diagnosticSummary
                : `${activeDiagnostic.label}. ${activeDiagnostic.detail}.`
            }
            style={
              styles.terminalBody
            }
          >
            {diagnostics.map(
              (diagnostic) => {
                const statusText =
                  diagnostic.state ===
                  'success'
                    ? '[OK]'
                    : diagnostic.state ===
                        'warning'
                      ? '[!!]'
                      : diagnostic.state ===
                          'error'
                        ? '[ER]'
                        : diagnostic.state ===
                            'running'
                          ? '[>>]'
                          : '[--]';

                return (
                  <View
                    key={
                      diagnostic.id
                    }
                    style={
                      styles.logRow
                    }
                  >
                    <Text
                      maxFontSizeMultiplier={
                        1.5
                      }
                      numberOfLines={
                        1
                      }
                      style={[
                        styles.logText,
                        {
                          fontFamily:
                            fontMonospace,
                        },

                        diagnostic.state ===
                          'success' &&
                          styles.logSuccess,

                        diagnostic.state ===
                          'warning' &&
                          styles.logWarning,

                        diagnostic.state ===
                          'error' &&
                          styles.logError,

                        diagnostic.state ===
                          'running' &&
                          styles.logActive,

                        diagnostic.state ===
                          'pending' &&
                          styles.logPending,
                      ]}
                    >
                      {`${statusText} ${diagnostic.label.padEnd(
                        19,
                        '.',
                      )} ${diagnostic.detail}`}
                    </Text>
                  </View>
                );
              },
            )}

            {!diagnosticsComplete && (
              <View
                accessible={
                  false
                }
                importantForAccessibility="no"
                style={
                  styles.cursorRow
                }
              >
                <Text
                  style={[
                    styles.cursorText,
                    {
                      fontFamily:
                        fontMonospace,
                    },
                  ]}
                >
                  {cursorVisible
                    ? '> READING DEVICE STATE_'
                    : '> READING DEVICE STATE '}
                </Text>
              </View>
            )}

            {diagnosticsComplete && (
              <Text
                accessibilityRole="text"
                maxFontSizeMultiplier={
                  1.5
                }
                style={[
                  styles.completeText,
                  {
                    fontFamily:
                      fontMonospace,
                  },
                ]}
              >
                {errorCount >
                0
                  ? '> STARTUP COMPLETE — REVIEW ERRORS'
                  : warningCount >
                      0
                    ? '> STARTUP COMPLETE — FALLBACKS AVAILABLE'
                    : '> ALL FIELD SYSTEMS READY'}
              </Text>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue past startup checks"
            accessibilityHint="Skips the remaining splash screen display and continues into Treasi"
            hitSlop={8}
            onPress={
              handleSkip
            }
            style={({
              pressed,
            }) => [
              styles.skipButton,
              pressed &&
                styles.skipButtonPressed,
            ]}
          >
            <Text
              maxFontSizeMultiplier={
                1.5
              }
              style={[
                styles.skipText,
                {
                  fontFamily:
                    fontMonospace,
                },
              ]}
            >
              {diagnosticsComplete
                ? '[ CONTINUE ]'
                : '[ SKIP CHECKS ]'}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    );
  };

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      flexDirection:
        'row',
      backgroundColor:
        COLORS.forestDeep,
    },

    /* ---------------------------------------------------------------------- */
    /* Left panel                                                             */
    /* ---------------------------------------------------------------------- */

    leftPanel: {
      flex: 0.58,
      justifyContent:
        'center',
      alignItems:
        'center',
      paddingHorizontal:
        16,
      minWidth: 0,
    },

    logoWrapper: {
      justifyContent:
        'center',
      alignItems:
        'center',
      marginBottom: 8,
    },

    title: {
      color:
        COLORS.parchment,
      fontSize: 28,
      lineHeight: 34,
      fontWeight:
        '700',
      letterSpacing: 8,
      textAlign:
        'center',
      marginBottom: 4,
    },

    titleCompact: {
      fontSize: 24,
      lineHeight: 29,
      letterSpacing: 6,
    },

    tagline: {
      color:
        COLORS.brassTrim,
      fontSize: 10,
      lineHeight: 15,
      letterSpacing: 1.8,
      textAlign:
        'center',
      marginBottom: 20,
    },

    progressSection: {
      width: '86%',
      maxWidth: 340,
    },

    progressBarTrack: {
      height: 14,
      justifyContent:
        'center',
      backgroundColor:
        COLORS.progressTrack,
      borderRadius: 7,
      borderWidth: 1,
      borderColor:
        COLORS.brassTrim,
      padding: 2,
      overflow:
        'hidden',
    },

    progressBarFill: {
      height: '100%',
      backgroundColor:
        COLORS.siennaAccent,
      borderRadius: 4,
    },

    progressLabels: {
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'flex-start',
      gap: 12,
      marginTop: 7,
    },

    progressText: {
      flexShrink: 1,
      color:
        COLORS.mutedGreen,
      fontSize: 10,
      lineHeight: 15,
      letterSpacing: 0.8,
      fontWeight:
        '700',
    },

    /* ---------------------------------------------------------------------- */
    /* Right panel                                                            */
    /* ---------------------------------------------------------------------- */

    rightPanel: {
      flex: 0.42,
      minWidth: 0,
      backgroundColor:
        COLORS.panelBg,
      borderRadius: 8,
      borderWidth: 1,
      borderColor:
        COLORS.borderColor,
      padding: 14,
      marginVertical: 4,
      justifyContent:
        'space-between',
    },

    terminalHeader: {
      flexDirection:
        'row',
      alignItems:
        'center',
      minHeight: 24,
      marginBottom: 8,
    },

    terminalStar: {
      color:
        COLORS.siennaAccent,
      fontSize: 13,
      marginRight: 5,
    },

    terminalTitle: {
      flexShrink: 0,
      color:
        COLORS.brassTrim,
      fontSize: 11,
      lineHeight: 16,
      letterSpacing: 1.5,
      fontWeight:
        '700',
    },

    headerDivider: {
      flex: 1,
      height: 1,
      backgroundColor:
        COLORS.borderColor,
      marginLeft: 8,
    },

    terminalBody: {
      flex: 1,
      justifyContent:
        'center',
      minHeight: 0,
    },

    logRow: {
      minHeight: 19,
      justifyContent:
        'center',
    },

    logText: {
      fontSize: 9.5,
      lineHeight: 14,
      letterSpacing: 0.35,
    },

    logSuccess: {
      color:
        COLORS.success,
    },

    logWarning: {
      color:
        COLORS.warning,
    },

    logError: {
      color:
        COLORS.error,
      fontWeight:
        '700',
    },

    logActive: {
      color:
        COLORS.parchment,
      fontWeight:
        '700',
    },

    logPending: {
      color:
        COLORS.mutedGreen,
      opacity: 0.65,
    },

    cursorRow: {
      marginTop: 5,
      minHeight: 18,
      justifyContent:
        'center',
    },

    cursorText: {
      color:
        COLORS.siennaAccent,
      fontSize: 9.5,
      lineHeight: 14,
      letterSpacing: 0.45,
      fontWeight:
        '700',
    },

    completeText: {
      color:
        COLORS.parchment,
      fontSize: 9.5,
      lineHeight: 14,
      letterSpacing: 0.45,
      fontWeight:
        '700',
      marginTop: 5,
    },

    /* ---------------------------------------------------------------------- */
    /* Continue button                                                        */
    /* ---------------------------------------------------------------------- */

    skipButton: {
      alignSelf:
        'flex-end',
      minWidth: 120,
      minHeight: 48,
      justifyContent:
        'center',
      alignItems:
        'center',
      paddingHorizontal:
        12,
      paddingVertical: 8,
      borderRadius: 4,
    },

    skipButtonPressed: {
      backgroundColor:
        'rgba(232, 220, 192, 0.08)',
    },

    skipText: {
      color:
        COLORS.brassTrim,
      fontSize: 9.5,
      lineHeight: 14,
      letterSpacing: 1,
      fontWeight:
        '700',
      textAlign:
        'center',
    },
  });