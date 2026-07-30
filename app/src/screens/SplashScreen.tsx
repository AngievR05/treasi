import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Platform,
  useWindowDimensions,
  Easing,
} from 'react-native';

// Standard SVG import (requires react-native-svg & react-native-svg-transformer)
import Logo from '../../assets/Logo.svg';

interface Props {
  onFinish?: () => void;
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

export const SplashScreen: React.FC<Props> = ({ onFinish }) => {
  const { width, height } = useWindowDimensions();
  
  // Animation References
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Readout & Micro-interaction States
  const [percent, setPercent] = useState<number>(0);
  const [visibleLogIndex, setVisibleLogIndex] = useState<number>(0);
  const [cursorVisible, setCursorVisible] = useState<boolean>(true);

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

  // 3. Extended diagnostic boot sequence (~9.6s timeline)
  useEffect(() => {
    const animation = Animated.timing(progressAnim, {
      toValue: 100,
      duration: 9600, // Slowed down to ~1.2s per telemetry entry
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
      // 1.2s atmospheric pause after reaching 100% so user can inspect final status
      setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 800,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start(() => {
          if (onFinish) onFinish();
        });
      }, 1200);
    });

    return () => {
      progressAnim.removeListener(listenerId);
    };
  }, [fadeAnim, onFinish, progressAnim]);

  // Interpolate numerical progress into percentage string for flex width
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  const fontMonospace = Platform.OS === 'ios' ? 'Courier' : 'monospace';

  return (
    <Animated.View style={[styles.container, { width, height, opacity: fadeAnim }]}>
      {/* ================= LEFT PANEL: Branding & Dynamic Odometer (60%) ================= */}
      <View style={styles.leftPanel}>
        {/* Animated Pulsing SVG Logo */}
        <Animated.View style={[styles.logoWrapper, { transform: [{ scale: pulseAnim }] }]}>
          <Logo width={120} height={120} />
        </Animated.View>

        {/* Brand Identity & Tagline */}
        <Text style={styles.title}>T R E A S I</Text>
        <Text style={[styles.tagline, { fontFamily: fontMonospace }]}>
          HIDE. EXPLORE. STAY CONNECTED.
        </Text>

        {/* Telemetry Progress Bar Container */}
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
          <Text style={styles.terminalStar}>★ </Text>
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

          {/* Active Terminal Blinking Prompt */}
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
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: COLORS.forestDeep,
    padding: 16,
  },

  /* Left Panel Layout */
  leftPanel: {
    flex: 0.58,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  logoWrapper: {
    width: 130,
    height: 130,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: COLORS.parchment,
    fontSize: 30,
    fontWeight: 'bold',
    letterSpacing: 9,
    marginBottom: 4,
  },
  tagline: {
    color: COLORS.brassTrim,
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 24,
    opacity: 0.9,
  },
  progressSection: {
    width: '85%',
    maxWidth: 320,
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
    marginTop: 8,
  },
  progressText: {
    color: COLORS.mutedGreen,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '600',
  },

  /* Right Panel Terminal */
  rightPanel: {
    flex: 0.42,
    backgroundColor: COLORS.panelBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.borderColor,
    padding: 16,
    marginVertical: 4,
  },
  terminalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  terminalStar: {
    color: COLORS.siennaAccent,
    fontSize: 12,
  },
  terminalTitle: {
    color: COLORS.brassTrim,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: 'bold',
  },
  headerDivider: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.borderColor,
    marginLeft: 10,
  },
  terminalBody: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  logRow: {
    marginVertical: 2.5,
  },
  logText: {
    fontSize: 9.5,
    letterSpacing: 0.8,
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