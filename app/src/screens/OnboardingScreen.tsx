import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line, Polygon } from 'react-native-svg';

// --- DESIGN SYSTEM TOKENS (DV300 Spec) ---
const PALETTE = {
  forestDeep: '#2C3B2E',     // Main dark chassis backdrop
  parchment: '#E8DCC0',      // Map & card viewport backdrop
  parchmentLight: '#F3ECD8', // Secondary card panel background
  sienna: '#A64B2A',         // High-priority CTAs & badges
  brass: '#B08D57',          // Borders, rivets, and hardware trim
  inkBlack: '#2A2420',       // High-contrast readable body text
  mutedGreen: '#3D5040',     // Secondary console text
  signalGreen: '#4CAF50',    // Live telemetry signal
};

// --- NATIVE SVG VECTOR ICONS (No Emojis Rule) ---
const CompassIcon: React.FC<{ color?: string; size?: number }> = ({ 
  color = PALETTE.sienna, 
  size = 24 
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="12" cy="12" r="10" />
    <Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill={color} opacity="0.3" />
    <Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </Svg>
);

const TelemetryIcon: React.FC<{ color?: string; size?: number }> = ({ 
  color = PALETTE.sienna, 
  size = 24 
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="12" cy="12" r="9" />
    <Circle cx="12" cy="12" r="5" />
    <Circle cx="12" cy="12" r="1.5" fill={color} />
    <Line x1="12" y1="3" x2="12" y2="12" />
    <Line x1="12" y1="12" x2="21" y2="12" />
  </Svg>
);

const ExcavationIcon: React.FC<{ color?: string; size?: number }> = ({ 
  color = PALETTE.sienna, 
  size = 24 
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </Svg>
);

interface Props {
  onComplete: () => void;
}

interface OnboardingStep {
  step: string;
  protocolCode: string;
  title: string;
  subtitle: string;
  desc: string;
  IconComponent: React.FC<{ color?: string; size?: number }>;
  telemetryStatus: string;
}

const STEPS: OnboardingStep[] = [
  {
    step: '01 / 03',
    protocolCode: 'PROTOCOL_ORIENTATION',
    title: 'ALIGN INSTRUMENT',
    subtitle: 'LANDSCAPE LOCK MANDATORY',
    desc: 'Lock device horizontally into landscape orientation to calibrate analogue dials and unlock field telemetry.',
    IconComponent: CompassIcon,
    telemetryStatus: 'GYRO & ACCEL: CALIBRATED',
  },
  {
    step: '02 / 03',
    protocolCode: 'PROTOCOL_TELEMETRY',
    title: 'TRACK TARGETS',
    subtitle: 'GEOSPATIAL VECTORING',
    desc: 'Follow continuous live heading and GPS telemetry to navigate towards hidden field caches scattered across campus.',
    IconComponent: TelemetryIcon,
    telemetryStatus: 'GPS & MAGNETOMETER: ONLINE',
  },
  {
    step: '03 / 03',
    protocolCode: 'PROTOCOL_EXCAVATION',
    title: 'EXCAVATE REWARDS',
    subtitle: 'KINETIC SHAKE TRIGGER',
    desc: 'Apply physical kinetic shaking motion when within 5 meters of target coordinates to unearth hidden payloads.',
    IconComponent: ExcavationIcon,
    telemetryStatus: 'KINETIC TRIGGER: READY',
  },
];

export const OnboardingScreen: React.FC<Props> = ({ onComplete }) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);

  // --- ANIMATION REFS ---
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(1 / STEPS.length)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulsing Live Telemetry LED animation loop
  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [pulseAnim]);

  // Sync progress bar
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: (index + 1) / STEPS.length,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [index, progressAnim]);

  const handleStepTransition = (nextIndex: number) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -15,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIndex(nextIndex);
      slideAnim.setValue(15);

      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 7,
          tension: 70,
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
  const StepIcon = current.IconComponent;
  const isLandscape = width > height;

  return (
    <View style={[
      styles.mainWrapper,
      {
        paddingLeft: Math.max(insets.left, 16),
        paddingRight: Math.max(insets.right, 16),
        paddingTop: Math.max(insets.top, 12),
        paddingBottom: Math.max(insets.bottom, 12),
      }
    ]}>
      <View style={[styles.container, !isLandscape && styles.portraitWarningContainer]}>
        
        {/* ============================================================== */}
        {/* LEFT VIEWPORT (60%): OPERATIONAL CARD & FIELD INSTRUCTIONS     */}
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
              <StepIcon color={PALETTE.sienna} size={24} />
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
        {/* RIGHT VIEWPORT (40%): TACTICAL CONTROL & TELEMETRY CONSOLE     */}
        {/* ============================================================== */}
        <View style={styles.rightViewport}>
          <View style={styles.consoleCard}>
            <Text style={styles.consoleHeader}>SYSTEM TELEMETRY</Text>
            
            {/* Pulsing Status LED Indicator */}
            <View style={styles.telemetryStatusBox}>
              <Animated.View style={[styles.statusDot, { opacity: pulseAnim }]} />
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
    </View>
  );
};

// --- STYLESHEET ---
const styles = StyleSheet.create({
  mainWrapper: {
    flex: 1,
    backgroundColor: PALETTE.forestDeep,
  },
  container: {
    flex: 1,
    flexDirection: 'row', // 60/40 Split
  },
  portraitWarningContainer: {
    opacity: 0.95,
  },

  // --- LEFT VIEWPORT (60%) ---
  leftViewport: {
    flex: 0.6,
    backgroundColor: PALETTE.parchment,
    padding: 16,
    justifyContent: 'space-between',
    borderRightWidth: 3,
    borderColor: PALETTE.brass,
    borderRadius: 4,
    position: 'relative',
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
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: PALETTE.parchmentLight,
    borderWidth: 1.5,
    borderColor: PALETTE.brass,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
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
    lineHeight: 17,
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
    fontSize: 8,
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  // --- RIVETS ---
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
    padding: 12,
    borderRadius: 4,
    justifyContent: 'space-between',
  },
  consoleHeader: {
    color: PALETTE.parchment,
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  telemetryStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(44, 59, 46, 0.9)',
    padding: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: PALETTE.brass,
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PALETTE.signalGreen,
    marginRight: 8,
  },
  telemetryStatusText: {
    color: PALETTE.parchmentLight,
    fontSize: 8.5,
    fontWeight: 'bold',
    letterSpacing: 0.8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  progressTrackerContainer: {
    marginBottom: 8,
  },
  progressLabel: {
    color: PALETTE.brass,
    fontSize: 8.5,
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
    marginVertical: 4,
    gap: 10,
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
    transform: [{ scale: 1.25 }],
  },
  stepNodeCompleted: {
    backgroundColor: PALETTE.brass,
  },
  actionSection: {
    marginTop: 'auto',
    gap: 6,
  },
  primaryButton: {
    backgroundColor: PALETTE.sienna,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 4,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PALETTE.brass,
  },
  primaryButtonComplete: {
    backgroundColor: '#2E6F40',
  },
  buttonText: {
    color: PALETTE.parchmentLight,
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  skipButtonText: {
    color: PALETTE.brass,
    fontSize: 9,
    letterSpacing: 1,
    textDecorationLine: 'underline',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});

export default OnboardingScreen;