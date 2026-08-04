import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  Platform,
  Switch,
  Easing,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

// --- DESIGN SYSTEM TOKENS (DV300 Spec) ---
const PALETTE = {
  forestDeep: '#2C3B2E',     // Main dark chassis backdrop
  parchment: '#E8DCC0',      // Map & card viewport backdrop
  parchmentLight: '#F3ECD8', // Secondary card panel background
  sienna: '#A64B2A',         // High-priority CTAs & badges
  brass: '#B08D57',          // Borders, rivets, and hardware trim
  inkBlack: '#2A2420',       // High-contrast readable body text
  mutedGreen: '#3D5040',     // Secondary console text
  activeGreen: '#4CAF50',    // Telemetry active indicator
};

interface Props {
  onComplete: (telemetryEnabled: boolean, skipForever: boolean) => void;
}

interface OnboardingStep {
  step: string;
  protocolCode: string;
  title: string;
  subtitle: string;
  desc: string;
  iconName: keyof typeof MaterialCommunityIcons.glyphMap;
  telemetryStatus: string;
}

const STEPS: OnboardingStep[] = [
  {
    step: '01 / 03',
    protocolCode: 'PROTOCOL_ORIENTATION',
    title: 'ALIGN INSTRUMENT',
    subtitle: 'LANDSCAPE LOCK MANDATORY',
    desc: 'Lock device horizontally into landscape orientation to calibrate analogue dials and unlock field telemetry.',
    iconName: 'compass-rose',
    telemetryStatus: 'GYRO & ACCEL: CALIBRATED',
  },
  {
    step: '02 / 03',
    protocolCode: 'PROTOCOL_TELEMETRY',
    title: 'TRACK TARGETS',
    subtitle: 'GEOSPATIAL VECTORING',
    desc: 'Follow continuous live heading and GPS telemetry to navigate towards hidden field caches scattered across campus.',
    iconName: 'radar',
    telemetryStatus: 'GPS & MAGNETOMETER: ONLINE',
  },
  {
    step: '03 / 03',
    protocolCode: 'PROTOCOL_EXCAVATION',
    title: 'EXCAVATE REWARDS',
    subtitle: 'KINETIC SHAKE TRIGGER',
    desc: 'Apply physical kinetic shaking motion when within 5 meters of target coordinates to unearth hidden payloads.',
    iconName: 'shovel',
    telemetryStatus: 'KINETIC TRIGGER: READY',
  },
];

export const OnboardingScreen: React.FC<Props> = ({ onComplete }) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);

  // --- TOGGLE STATES (All default to OFF per spec) ---
  const [telemetryAuthorized, setTelemetryAuthorized] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // --- ANIMATION REFS ---
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(1 / STEPS.length)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const buttonScaleAnim = useRef(new Animated.Value(1)).current;

  // Continuous status indicator pulse animation
  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [pulseAnim]);

  // Sync progress bar animation on step change
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: (index + 1) / STEPS.length,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [index]);

  // Request native hardware permissions when telemetry toggle is flipped
  const handleToggleTelemetry = async (value: boolean) => {
    if (value) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        setTelemetryAuthorized(true);
      } else {
        setTelemetryAuthorized(false);
        Alert.alert(
          'TELEMETRY DENIED',
          'Hardware GPS permissions are required to active live target vectoring.'
        );
      }
    } else {
      setTelemetryAuthorized(false);
    }
  };

  const handleStepTransition = (nextIndex: number) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -15,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIndex(nextIndex);
      slideAnim.setValue(15);

      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 7,
          tension: 90,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const finalizeOnboarding = async () => {
    try {
      await AsyncStorage.setItem('@treasi_onboarding_completed', 'true');
      if (dontShowAgain) {
        await AsyncStorage.setItem('@treasi_skip_onboarding_forever', 'true');
      } else {
        await AsyncStorage.setItem('@treasi_skip_onboarding_forever', 'false');
      }
    } catch (e) {
      console.warn('Failed to save onboarding state locally', e);
    }
    onComplete(telemetryAuthorized, dontShowAgain);
  };

  const handleNext = () => {
    Animated.sequence([
      Animated.timing(buttonScaleAnim, {
        toValue: 0.94,
        duration: 70,
        useNativeDriver: true,
      }),
      Animated.spring(buttonScaleAnim, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
    ]).start();

    if (index < STEPS.length - 1) {
      handleStepTransition(index + 1);
    } else {
      finalizeOnboarding();
    }
  };

  const current = STEPS[index];
  const isFinalStep = index === STEPS.length - 1;
  const isLandscape = width > height;

  // Dynamic padding accounting for Dynamic Island & iPhone hardware notches in landscape
  const safeLandscapeStyle = {
    paddingLeft: Math.max(insets.left, insets.top, 16),
    paddingRight: Math.max(insets.right, 16),
    paddingTop: Math.max(insets.top, 12),
    paddingBottom: Math.max(insets.bottom, 12),
  };

  return (
    <View style={[styles.mainChassis, safeLandscapeStyle]}>
      <View style={[styles.container, !isLandscape && styles.portraitWarningContainer]}>

        {/* ============================================================== */}
        {/* LEFT VIEWPORT (60%): OPERATIONAL CARD & FIELD INSTRUCTIONS      */}
        {/* ============================================================== */}
        <View style={styles.leftViewport}>
          {/* Rivet Hardware Accents */}
          <View style={[styles.rivet, styles.rivetTopLeft]} />
          <View style={[styles.rivet, styles.rivetTopRight]} />
          <View style={[styles.rivet, styles.rivetBottomLeft]} />
          <View style={[styles.rivet, styles.rivetBottomRight]} />

          <View style={styles.headerMetaRow}>
            <Text style={styles.metaDocCode}>FIELD_MANUAL // REV_1962</Text>
            <Text style={styles.metaStepBadge}>{current.step}</Text>
          </View>

          <Animated.View
            style={[
              styles.contentContainer,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <View style={styles.iconWrapper}>
              <MaterialCommunityIcons
                name={current.iconName}
                size={26}
                color={PALETTE.sienna}
              />
            </View>

            <Text style={styles.protocolCodeText}>{current.protocolCode}</Text>
            <Text style={styles.titleText}>{current.title}</Text>
            <Text style={styles.subtitleText}>[ {current.subtitle} ]</Text>

            <View style={styles.dividerLine} />

            <Text style={styles.descText}>{current.desc}</Text>
          </Animated.View>

          <View style={styles.footerNoteRow}>
            <Text style={styles.footerNote}>TREASI FIELD PROTOCOL</Text>
            <Text style={styles.footerNote}>SECURE SPECIFICATION</Text>
          </View>
        </View>

        {/* ============================================================== */}
        {/* RIGHT VIEWPORT (40%): TACTICAL CONTROL & TELEMETRY CONSOLE      */}
        {/* ============================================================== */}
        <View style={styles.rightViewport}>
          <View style={styles.consoleCard}>
            <Text style={styles.consoleHeader}>SYSTEM TELEMETRY</Text>

            {/* Status Indicator with Animated Pulse */}
            <View style={styles.telemetryStatusBox}>
              <Animated.View
                style={[
                  styles.statusDot,
                  {
                    opacity: pulseAnim,
                    backgroundColor: telemetryAuthorized
                      ? PALETTE.activeGreen
                      : PALETTE.sienna,
                  },
                ]}
              />
              <Text style={styles.telemetryStatusText}>
                {telemetryAuthorized ? current.telemetryStatus : 'TELEMETRY: STANDBY'}
              </Text>
            </View>

            {/* Tactical Telemetry Toggle (Defaults to OFF) */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextContainer}>
                <Text style={styles.toggleLabel}>SENSOR FEED</Text>
                <Text style={styles.toggleSublabel}>GPS / GYRO STREAM</Text>
              </View>
              <Switch
                trackColor={{ false: '#1E281F', true: PALETTE.sienna }}
                thumbColor={telemetryAuthorized ? PALETTE.brass : '#555'}
                ios_backgroundColor="#1E281F"
                onValueChange={handleToggleTelemetry}
                value={telemetryAuthorized}
              />
            </View>

            {/* Bypass/Skip Onboarding Future Toggle (Defaults to OFF) */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextContainer}>
                <Text style={styles.toggleLabel}>BYPASS TUTORIAL</Text>
                <Text style={styles.toggleSublabel}>DO NOT SHOW AGAIN</Text>
              </View>
              <Switch
                trackColor={{ false: '#1E281F', true: PALETTE.sienna }}
                thumbColor={dontShowAgain ? PALETTE.brass : '#555'}
                ios_backgroundColor="#1E281F"
                onValueChange={(val) => setDontShowAgain(val)}
                value={dontShowAgain}
              />
            </View>

            {/* Step Progress Tracker Bar */}
            <View style={styles.progressTrackerContainer}>
              <Text style={styles.progressLabel}>PROTOCOL PROGRESS</Text>
              <View style={styles.progressBarTrack}>
                <Animated.View
                  style={[
                    styles.progressBarFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>
            </View>

            {/* Interactive Step Nodes */}
            <View style={styles.nodeRow}>
              {STEPS.map((_, i) => (
                <TouchableOpacity
                  key={i}
                  activeOpacity={0.7}
                  onPress={() => handleStepTransition(i)}
                  style={[
                    styles.stepNode,
                    i === index && styles.stepNodeActive,
                    i < index && styles.stepNodeCompleted,
                  ]}
                  accessibilityLabel={`Jump to protocol step ${i + 1}`}
                />
              ))}
            </View>

            {/* Action Buttons */}
            <View style={styles.actionSection}>
              <Animated.View style={{ transform: [{ scale: buttonScaleAnim }] }}>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    isFinalStep && styles.primaryButtonComplete,
                  ]}
                  activeOpacity={0.8}
                  onPress={handleNext}
                  accessibilityRole="button"
                  accessibilityLabel={isFinalStep ? 'Enter Field' : 'Next Protocol'}
                >
                  <View style={styles.buttonContentRow}>
                    <Text style={styles.buttonText}>
                      {isFinalStep ? 'ENTER FIELD' : 'NEXT PROTOCOL'}
                    </Text>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={18}
                      color={PALETTE.parchmentLight}
                    />
                  </View>
                </TouchableOpacity>
              </Animated.View>

              {!isFinalStep && (
                <TouchableOpacity
                  style={styles.skipButton}
                  onPress={finalizeOnboarding}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={styles.skipButtonText}>ABORT TUTORIAL [SKIP]</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

      </View>
    </View>
  );
};

// --- STYLESHEET (Skeuomorphic & Dynamic Landscape Layout) ---
const styles = StyleSheet.create({
  mainChassis: {
    flex: 1,
    backgroundColor: PALETTE.forestDeep,
  },
  container: {
    flex: 1,
    flexDirection: 'row', // 60/40 Horizontal Split Layout
  },
  portraitWarningContainer: {
    opacity: 0.9,
  },

  // --- LEFT VIEWPORT (60%) ---
  leftViewport: {
    flex: 0.6,
    backgroundColor: PALETTE.parchment,
    padding: 16,
    justifyContent: 'space-between',
    borderRightWidth: 3,
    borderColor: PALETTE.brass,
    position: 'relative',
    borderRadius: 4,
  },
  headerMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  metaDocCode: {
    color: PALETTE.mutedGreen,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  metaStepBadge: {
    backgroundColor: PALETTE.sienna,
    color: PALETTE.parchmentLight,
    fontWeight: 'bold',
    fontSize: 10,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 2,
    letterSpacing: 1,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PALETTE.parchmentLight,
    borderWidth: 1.5,
    borderColor: PALETTE.brass,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  protocolCodeText: {
    color: PALETTE.sienna,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  titleText: {
    color: PALETTE.inkBlack,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  subtitleText: {
    color: PALETTE.mutedGreen,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  dividerLine: {
    height: 2,
    backgroundColor: PALETTE.brass,
    width: '40%',
    marginBottom: 8,
    opacity: 0.5,
  },
  descText: {
    color: PALETTE.inkBlack,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  footerNoteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderColor: 'rgba(176, 141, 87, 0.4)',
    paddingTop: 4,
  },
  footerNote: {
    color: PALETTE.mutedGreen,
    fontSize: 8,
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  // --- HARDWARE RIVETS ---
  rivet: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PALETTE.brass,
  },
  rivetTopLeft: { top: 6, left: 6 },
  rivetTopRight: { top: 6, right: 6 },
  rivetBottomLeft: { bottom: 6, left: 6 },
  rivetBottomRight: { bottom: 6, right: 6 },

  // --- RIGHT VIEWPORT (40%) ---
  rightViewport: {
    flex: 0.4,
    backgroundColor: PALETTE.forestDeep,
    paddingLeft: 12,
    justifyContent: 'center',
  },
  consoleCard: {
    flex: 1,
    borderWidth: 2,
    borderColor: PALETTE.brass,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    padding: 10,
    borderRadius: 4,
    justifyContent: 'space-between',
  },
  consoleHeader: {
    color: PALETTE.parchment,
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  telemetryStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(44, 59, 46, 0.8)',
    padding: 5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: PALETTE.brass,
    marginBottom: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  telemetryStatusText: {
    color: PALETTE.parchmentLight,
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  // --- TOGGLE ROWS ---
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(176, 141, 87, 0.3)',
    marginBottom: 4,
  },
  toggleTextContainer: {
    flex: 1,
  },
  toggleLabel: {
    color: PALETTE.parchment,
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  toggleSublabel: {
    color: PALETTE.brass,
    fontSize: 7,
    letterSpacing: 0.5,
  },

  progressTrackerContainer: {
    marginBottom: 4,
  },
  progressLabel: {
    color: PALETTE.brass,
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 2,
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: '#1E281F',
    borderRadius: 2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PALETTE.brass,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: PALETTE.sienna,
  },
  nodeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 2,
    gap: 8,
  },
  stepNode: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: PALETTE.brass,
    backgroundColor: 'transparent',
  },
  stepNodeActive: {
    backgroundColor: PALETTE.sienna,
    transform: [{ scale: 1.25 }],
  },
  stepNodeCompleted: {
    backgroundColor: PALETTE.brass,
  },
  actionSection: {
    marginTop: 'auto',
    gap: 4,
  },
  primaryButton: {
    backgroundColor: PALETTE.sienna,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 4,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PALETTE.brass,
  },
  primaryButtonComplete: {
    backgroundColor: '#2E6F40',
  },
  buttonContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  buttonText: {
    color: PALETTE.parchmentLight,
    fontWeight: 'bold',
    fontSize: 10,
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  skipButtonText: {
    color: PALETTE.brass,
    fontSize: 8,
    letterSpacing: 1,
    textDecorationLine: 'underline',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});