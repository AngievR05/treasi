import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Platform,
  useWindowDimensions,
  Easing,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';

// SVG Logo Component Import
import Logo from '../../assets/Logo.svg';

export type NavigationTarget = 'Onboarding' | 'Auth' | 'Dashboard';

interface Props {
  onFinish?: (target: NavigationTarget) => void;
}

// Tactical field instrument diagnostic sequence
const BOOT_DIAGNOSTICS = [
  'INIT HARDWARE BUS.......... OK',
  'GPS SATELLITE LOCK......... OK [12 SATS]',
  'MAGNETOMETER CALIB......... OK [360° MAG_N]',
  'ACCELEROMETER SENSITIVITY... OK [0.02G THRESHOLD]',
  'BAROMETER ALTITUDE CHECK.... OK [240m METRIC]',
  'FIELD ENCRYPTION KEYS...... OK [AES-256]',
  'FIREBASE MESH SYNC......... CONNECTED',
  'TREASI FIELD PROTOCOL...... READY',
];

// Clean Vector Star Icon replacing all Emojis
const StarIcon: React.FC<{ size?: number; color?: string }> = ({
  size = 12,
  color = '#A64B2A',
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M12 1.7L15.3 8.4L22.7 9.5L17.3 14.7L18.6 22.1L12 18.6L5.4 22.1L6.7 14.7L1.3 9.5L8.7 8.4L12 1.7Z" />
  </Svg>
);

export const SplashScreen: React.FC<Props> = ({ onFinish }) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Animation References
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Readout & Micro-interaction States
  const [percent, setPercent] = useState<number>(0);
  const [visibleLogIndex, setVisibleLogIndex] = useState<number>(0);
  const [cursorVisible, setCursorVisible] = useState<boolean>(true);
  const [nextTarget, setNextTarget] = useState<NavigationTarget>('Onboarding');

  // 1. Determine destination screen based on strict bypass persistence toggles
  useEffect(() => {
    const evaluateRouteTarget = async () => {
      try {
        const skipOnboarding = await AsyncStorage.getItem('@treasi_skip_onboarding');
        const rememberSession = await AsyncStorage.getItem('@treasi_remember_session');

        // Defaults to always showing Onboarding -> Auth unless explicit user toggle is ON
        if (skipOnboarding === 'true' && rememberSession === 'true') {
          setNextTarget('Dashboard');
        } else if (skipOnboarding === 'true') {
          setNextTarget('Auth');
        } else {
          setNextTarget('Onboarding');
        }
      } catch {
        setNextTarget('Onboarding');
      }
    };

    evaluateRouteTarget();
  }, []);

  // 2. Terminal cursor micro-interaction pulse (500ms cycle)
  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, 500);
    return () => clearInterval(cursorInterval);
  }, []);

  // 3. Logo breathing animation (2.4s loop)
  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    return () => pulseLoop.stop();
  }, [pulseAnim]);

  // 4. Boot timeline sequence & telemetry progress
  useEffect(() => {
    const animation = Animated.timing(progressAnim, {
      toValue: 100,
      duration: 7200,
      easing: Easing.linear,
      useNativeDriver: false,
    });

    const listenerId = progressAnim.addListener(({ value }) => {
      const currentPercent = Math.min(100, Math.floor(value));
      setPercent(currentPercent);

      const activeStep = Math.floor((currentPercent / 100) * BOOT_DIAGNOSTICS.length);
      setVisibleLogIndex(Math.min(BOOT_DIAGNOSTICS.length - 1, activeStep));
    });

    animation.start(() => {
      setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start(() => {
          if (onFinish) onFinish(nextTarget);
        });
      }, 800);
    });

    return () => {
      progressAnim.removeListener(listenerId);
    };
  }, [fadeAnim, nextTarget, onFinish, progressAnim]);

  // Tap-to-fast-forward diagnostic sequence micro-interaction
  const handleFastBoot = () => {
    if (percent < 100) {
      progressAnim.setValue(100);
    }
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  const fontMonospace = Platform.OS === 'ios' ? 'Courier' : 'monospace';

  return (
    <Pressable onPress={handleFastBoot} style={styles.outerWrapper}>
      <Animated.View
        style={[
          styles.container,
          {
            width,
            height,
            opacity: fadeAnim,
            // Seamless Dynamic Island & Notch blending
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: Math.max(insets.bottom, 16),
            paddingLeft: Math.max(insets.left, 20),
            paddingRight: Math.max(insets.right, 20),
          },
        ]}
      >
        {/* ================= LEFT PANEL: Branding & Odometer (60%) ================= */}
        <View style={styles.leftPanel}>
          <Animated.View style={[styles.logoWrapper, { transform: [{ scale: pulseAnim }] }]}>
            <Logo width={110} height={110} />
          </Animated.View>

          <Text style={styles.title}>T R E A S I</Text>
          <Text style={[styles.tagline, { fontFamily: fontMonospace }]}>
            HIDE. EXPLORE. STAY CONNECTED.
          </Text>

          <View style={styles.progressSection}>
            <View style={styles.progressBarTrack}>
              <Animated.View style={[styles.progressBarFill, { width: progressWidth }]} />
            </View>

            <View style={styles.progressLabels}>
              <Text style={[styles.progressText, { fontFamily: fontMonospace }]}>
                {percent < 100 ? 'CALIBRATING_HARDWARE' : 'SYSTEM_ONLINE'}
              </Text>
              <Text style={[styles.progressText, { fontFamily: fontMonospace }]}>
                {percent}%
              </Text>
            </View>
          </View>
        </View>

        {/* ================= RIGHT PANEL: Tactical Terminal Console (40%) ================= */}
        <View style={styles.rightPanel}>
          <View style={styles.terminalHeader}>
            <View style={styles.starMargin}>
              <StarIcon size={11} color={COLORS.siennaAccent} />
            </View>
            <Text style={[styles.terminalTitle, { fontFamily: fontMonospace }]}>
              FIELD DIAGNOSTICS
            </Text>
            <View style={styles.headerDivider} />
          </View>

          <View style={styles.terminalBody}>
            {BOOT_DIAGNOSTICS.map((log, idx) => {
              if (idx > visibleLogIndex) return null;
              const isCompleted = idx < visibleLogIndex || percent === 100;

              return (
                <View key={idx} style={styles.logRow}>
                  <Text
                    style={[
                      styles.logText,
                      { fontFamily: fontMonospace },
                      isCompleted ? styles.logDone : styles.logActive,
                    ]}
                  >
                    {`> ${log}`}
                  </Text>
                </View>
              );
            })}

            {percent < 100 && (
              <View style={styles.cursorRow}>
                <Text style={[styles.logText, styles.cursorText, { fontFamily: fontMonospace }]}>
                  {cursorVisible ? '> POLLING_SENSORS...' : '> '}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
};

// ================= THEME COLOR TOKENS =================
const COLORS = {
  forestDeep: '#1E2B20',
  panelBg: '#131D14',
  parchment: '#E8DCC0',
  siennaAccent: '#A64B2A',
  brassTrim: '#B08D57',
  mutedGreen: '#7C9082',
  borderColor: '#2F4032',
};

const styles = StyleSheet.create({
  outerWrapper: {
    flex: 1,
    backgroundColor: COLORS.forestDeep, // Edge-to-edge notch blending
  },
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: COLORS.forestDeep,
  },

  /* Left Panel Layout (60% proportional flex) */
  leftPanel: {
    flex: 0.6,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  logoWrapper: {
    width: 110,
    height: 110,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: COLORS.parchment,
    fontSize: 26,
    fontWeight: 'bold',
    letterSpacing: 8,
    marginBottom: 4,
  },
  tagline: {
    color: COLORS.brassTrim,
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 20,
    opacity: 0.9,
  },
  progressSection: {
    width: '85%',
    maxWidth: 280,
  },
  progressBarTrack: {
    height: 12,
    backgroundColor: '#0F1610',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.brassTrim,
    padding: 1.5,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.siennaAccent,
    borderRadius: 4,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  progressText: {
    color: COLORS.mutedGreen,
    fontSize: 9,
    letterSpacing: 1.2,
    fontWeight: '600',
  },

  /* Right Panel Terminal (40% proportional flex) */
  rightPanel: {
    flex: 0.4,
    backgroundColor: COLORS.panelBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    padding: 12,
    marginVertical: 4,
  },
  terminalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  starMargin: {
    marginRight: 6,
  },
  terminalTitle: {
    color: COLORS.brassTrim,
    fontSize: 10,
    letterSpacing: 1.8,
    fontWeight: 'bold',
  },
  headerDivider: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.borderColor,
    marginLeft: 8,
  },
  terminalBody: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  logRow: {
    marginVertical: 1.5,
  },
  logText: {
    fontSize: 8.5,
    letterSpacing: 0.6,
  },
  logDone: {
    color: COLORS.mutedGreen,
  },
  logActive: {
    color: COLORS.parchment,
    fontWeight: 'bold',
  },
  cursorRow: {
    marginTop: 4,
  },
  cursorText: {
    color: COLORS.siennaAccent,
  },
});