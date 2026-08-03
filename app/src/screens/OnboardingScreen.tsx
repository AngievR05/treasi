import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  SafeAreaView,
  Platform,
} from 'react-native';

// --- DESIGN SYSTEM TOKENS (DV300 Spec) ---
const PALETTE = {
  forestDeep: '#2C3B2E',    // Main dark chassis backdrop
  parchment: '#E8DCC0',     // Map & card viewport backdrop
  parchmentLight: '#F3ECD8',// Secondary card panel background
  sienna: '#A64B2A',        // High-priority CTAs & badges
  brass: '#B08D57',         // Borders, rivets, and hardware trim
  inkBlack: '#2A2420',      // High-contrast readable body text
  mutedGreen: '#3D5040',    // Secondary console text
};

interface Props {
  onComplete: () => void;
}

interface OnboardingStep {
  step: string;
  protocolCode: string;
  title: string;
  subtitle: string;
  desc: string;
  badgeIcon: string;
  telemetryStatus: string;
}

const STEPS: OnboardingStep[] = [
  {
    step: '01 / 03',
    protocolCode: 'PROTOCOL_ORIENTATION',
    title: 'ALIGN INSTRUMENT',
    subtitle: 'LANDSCAPE LOCK MANDATORY',
    desc: 'Lock device horizontally into landscape orientation to calibrate analogue dials and unlock field telemetry.',
    badgeIcon: '🧭',
    telemetryStatus: 'GYRO & ACCEL: CALIBRATED',
  },
  {
    step: '02 / 03',
    protocolCode: 'PROTOCOL_TELEMETRY',
    title: 'TRACK TARGETS',
    subtitle: 'GEOSPATIAL VECTORING',
    desc: 'Follow continuous live heading and GPS telemetry to navigate towards hidden field caches scattered across campus.',
    badgeIcon: '📡',
    telemetryStatus: 'GPS & MAGNETOMETER: ONLINE',
  },
  {
    step: '03 / 03',
    protocolCode: 'PROTOCOL_EXCAVATION',
    title: 'EXCAVATE REWARDS',
    subtitle: 'KINETIC SHAKE TRIGGER',
    desc: 'Apply physical kinetic shaking motion when within 5 meters of target coordinates to unearth hidden payloads.',
    badgeIcon: '⛏️',
    telemetryStatus: 'KINETIC TRIGGER: READY',
  },
];

export const OnboardingScreen: React.FC<Props> = ({ onComplete }) => {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);

  // --- TWEENING & ANIMATION STATE ---
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(1 / STEPS.length)).current;

  // Sync progress indicator bar on step change
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: (index + 1) / STEPS.length,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [index]);

  const handleStepTransition = (nextIndex: number) => {
    // 1. Fade & slide out current view
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -20,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // 2. Update step state
      setIndex(nextIndex);
      slideAnim.setValue(20);

      // 3. Fade & slide in new view
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 6,
          tension: 80,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const handleNext = () => {
    if (index < STEPS.length - 1) {
      handleStepTransition(index + 1);
    } else {
      onComplete();
    }
  };

  const current = STEPS[index];
  const isFinalStep = index === STEPS.length - 1;

  // Responsive layout sanity check (Guarantees landscape aspect ratio handling)
  const isLandscape = width > height;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.container, !isLandscape && styles.portraitWarningContainer]}>
        
        {/* ============================================================== */}
        {/* LEFT VIEWPORT (60%): OPERATIONAL CARD & FIELD INSTRUCTIONS      */}
        {/* ============================================================== */}
        <View style={styles.leftViewport}>
          {/* Rivet Accents (Skeuomorphic hardware detail) */}
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
              <Text style={styles.iconText}>{current.badgeIcon}</Text>
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
          {/* Hardware Brass Frame Accent */}
          <View style={styles.consoleCard}>
            <Text style={styles.consoleHeader}>SYSTEM TELEMETRY</Text>
            
            {/* Status Indicator */}
            <View style={styles.telemetryStatusBox}>
              <View style={styles.statusDot} />
              <Text style={styles.telemetryStatusText}>
                {current.telemetryStatus}
              </Text>
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
                <Text style={styles.buttonText}>
                  {isFinalStep ? 'ENTER FIELD ›' : 'NEXT PROTOCOL ›'}
                </Text>
              </TouchableOpacity>

              {!isFinalStep && (
                <TouchableOpacity
                  style={styles.skipButton}
                  onPress={onComplete}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={styles.skipButtonText}>ABORT TUTORIAL [SKIP]</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

      </View>
    </SafeAreaView>
  );
};

// --- STYLESHEET (Skeuomorphic & Responsive Layout) ---
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: PALETTE.forestDeep,
  },
  container: {
    flex: 1,
    flexDirection: 'row', // 60/40 Horizontal Split Layout
  },
  portraitWarningContainer: {
    // Graceful fallback if orientation switch is delayed
    opacity: 0.9,
  },

  // --- LEFT VIEWPORT (60%) ---
  leftViewport: {
    flex: 0.6,
    backgroundColor: PALETTE.parchment,
    padding: 20,
    justifyContent: 'space-between',
    borderRightWidth: 3,
    borderColor: PALETTE.brass,
    position: 'relative',
  },
  headerMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
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
    fontSize: 11,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 2,
    letterSpacing: 1,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
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
    marginBottom: 8,
  },
  iconText: {
    fontSize: 22,
  },
  protocolCodeText: {
    color: PALETTE.sienna,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  titleText: {
    color: PALETTE.inkBlack,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  subtitleText: {
    color: PALETTE.mutedGreen,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  dividerLine: {
    height: 2,
    backgroundColor: PALETTE.brass,
    width: '40%',
    marginBottom: 10,
    opacity: 0.5,
  },
  descText: {
    color: PALETTE.inkBlack,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  footerNoteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderColor: 'rgba(176, 141, 87, 0.4)',
    paddingTop: 6,
  },
  footerNote: {
    color: PALETTE.mutedGreen,
    fontSize: 9,
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  // --- RIVETS (Skeuomorphic Detail) ---
  rivet: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PALETTE.brass,
  },
  rivetTopLeft: { top: 8, left: 8 },
  rivetTopRight: { top: 8, right: 8 },
  rivetBottomLeft: { bottom: 8, left: 8 },
  rivetBottomRight: { bottom: 8, right: 8 },

  // --- RIGHT VIEWPORT (40%) ---
  rightViewport: {
    flex: 0.4,
    backgroundColor: PALETTE.forestDeep,
    padding: 16,
    justifyContent: 'center',
  },
  consoleCard: {
    flex: 1,
    borderWidth: 2,
    borderColor: PALETTE.brass,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    padding: 16,
    borderRadius: 4,
    justifyContent: 'space-between',
  },
  consoleHeader: {
    color: PALETTE.parchment,
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  telemetryStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(44, 59, 46, 0.8)',
    padding: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: PALETTE.brass,
    marginBottom: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4CAF50', // Live telemetry green signal indicator
    marginRight: 8,
  },
  telemetryStatusText: {
    color: PALETTE.parchmentLight,
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  progressTrackerContainer: {
    marginBottom: 12,
  },
  progressLabel: {
    color: PALETTE.brass,
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 4,
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#1E281F',
    borderRadius: 3,
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
    marginVertical: 8,
    gap: 12,
  },
  stepNode: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: PALETTE.brass,
    backgroundColor: 'transparent',
  },
  stepNodeActive: {
    backgroundColor: PALETTE.sienna,
    transform: [{ scale: 1.2 }],
  },
  stepNodeCompleted: {
    backgroundColor: PALETTE.brass,
  },
  actionSection: {
    marginTop: 'auto',
    gap: 8,
  },
  primaryButton: {
    backgroundColor: PALETTE.sienna,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 4,
    alignItems: 'center',
    minHeight: 48, // Accessibility 48dp target minimum
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PALETTE.brass,
  },
  primaryButtonComplete: {
    backgroundColor: '#2E6F40', // Tactical green upon final step unlock
  },
  buttonText: {
    color: PALETTE.parchmentLight,
    fontWeight: 'bold',
    fontSize: 12,
    letterSpacing: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  skipButtonText: {
    color: PALETTE.brass,
    fontSize: 10,
    letterSpacing: 1,
    textDecorationLine: 'underline',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});