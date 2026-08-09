import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Platform,
  useWindowDimensions,
  Easing,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Logo from '../../assets/Logo.svg';

interface Props {
  onFinish?: () => void;
}

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

const COLORS = {
  forestDeep: '#1E2B20',
  panelBg: '#131D14',
  parchment: '#E8DCC0',
  siennaAccent: '#A64B2A',
  brassTrim: '#B08D57',
  mutedGreen: '#7C9082',
  borderColor: '#2F4032',
};

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

  const fontMonospace = Platform.OS === 'ios' ? 'Courier' : 'monospace';

  // 1. Blinking terminal cursor micro-interaction (500ms cycle)
  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, 500);
    return () => clearInterval(cursorInterval);
  }, []);

  // 2. Logo breathing pulse animation (2.4s total breathing loop)
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

  // 3. Extended diagnostic boot sequence timeline
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const animation = Animated.timing(progressAnim, {
      toValue: 100,
      duration: 8000,
      easing: Easing.linear,
      useNativeDriver: false, // Required for progress bar width interpolation
    });

    const listenerId = progressAnim.addListener(({ value }) => {
      const currentPercent = Math.min(100, Math.floor(value));
      setPercent(currentPercent);

      // Dynamically calculate current visible diagnostic log line
      const activeStep = Math.floor((currentPercent / 100) * BOOT_DIAGNOSTICS.length);
      setVisibleLogIndex(Math.min(BOOT_DIAGNOSTICS.length - 1, activeStep));
    });

    animation.start(() => {
      // Atmospheric pause after reaching 100% so user can inspect final status
      timeoutId = setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 800,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start(() => {
          if (onFinish) onFinish();
        });
      }, 1000);
    });

    return () => {
      progressAnim.removeListener(listenerId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [fadeAnim, onFinish, progressAnim]);

  // Manual skip function for accessibility or quick developer testing
  const handleSkip = () => {
    progressAnim.stopAnimation();
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      if (onFinish) onFinish();
    });
  };

  // Interpolate numerical progress into percentage string for flex width
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          width,
          height,
          opacity: fadeAnim,
          paddingLeft: Math.max(insets.left, 16),
          paddingRight: Math.max(insets.right, 16),
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
      accessible={true}
      accessibilityLabel="Treasi initialization screen"
    >
      {/* LEFT PANEL: Branding & Visual Telemetry */}
      <View style={styles.leftPanel}>
        {/* Animated SVG Logo */}
        <Animated.View
          style={[styles.logoWrapper, { transform: [{ scale: pulseAnim }] }]}
          accessible={true}
          accessibilityRole="image"
          accessibilityLabel="Treasi mountain emblem logo"
        >
          <Logo width={110} height={110} />
        </Animated.View>

        {/* Brand Identity & Tagline */}
        <Text style={styles.title} accessibilityRole="header">
          T R E A S I
        </Text>
        <Text style={[styles.tagline, { fontFamily: fontMonospace }]}>
          HIDE. EXPLORE. STAY CONNECTED.
        </Text>

        {/* Telemetry Progress Bar Container */}
        <View
          style={styles.progressSection}
          accessible={true}
          accessibilityRole="progressbar"
          accessibilityLabel="System boot progress"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
        >
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

      {/* RIGHT PANEL: Tactical Terminal Readout */}
      <View style={styles.rightPanel}>
        <View style={styles.terminalHeader}>
          <Text style={styles.terminalStar} accessible={false} importantForAccessibility="no">
            ★{' '}
          </Text>
          <Text style={[styles.terminalTitle, { fontFamily: fontMonospace }]}>
            FIELD DIAGNOSTICS
          </Text>
          <View style={styles.headerDivider} />
        </View>

        <View
          style={styles.terminalBody}
          accessible={true}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Diagnostic Status: ${BOOT_DIAGNOSTICS[visibleLogIndex] || ''}`}
        >
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

          {/* Active Terminal Blinking Prompt */}
          {percent < 100 && (
            <View style={styles.cursorRow} accessible={false} importantForAccessibility="no">
              <Text style={[styles.logText, styles.cursorText, { fontFamily: fontMonospace }]}>
                {cursorVisible ? '> POLLING_SENSORS...' : '> '}
              </Text>
            </View>
          )}
        </View>

        {/* Accessibility Fast Bypass Trigger */}
        <TouchableOpacity
          style={styles.skipButton}
          onPress={handleSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip initialization sequence"
          accessibilityHint="Bypasses the diagnostic boot sequence and proceeds immediately"
        >
          <Text style={[styles.skipText, { fontFamily: fontMonospace }]}>
            [ SKIP DIAGNOSTICS ]
          </Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: COLORS.forestDeep,
  },
  leftPanel: {
    flex: 0.58,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  logoWrapper: {
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: COLORS.parchment,
    fontSize: 28,
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
    maxWidth: 300,
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
    fontSize: 9.5,
    letterSpacing: 1.2,
    fontWeight: '600',
  },
  rightPanel: {
    flex: 0.42,
    backgroundColor: COLORS.panelBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    padding: 14,
    marginVertical: 4,
    justifyContent: 'space-between',
  },
  terminalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  terminalStar: {
    color: COLORS.siennaAccent,
    fontSize: 12,
  },
  terminalTitle: {
    color: COLORS.brassTrim,
    fontSize: 10.5,
    letterSpacing: 2,
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
    marginVertical: 2,
  },
  logText: {
    fontSize: 9,
    letterSpacing: 0.7,
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
  skipButton: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 6,
  },
  skipText: {
    color: COLORS.brassTrim,
    fontSize: 8.5,
    letterSpacing: 1,
    opacity: 0.6,
  },
});