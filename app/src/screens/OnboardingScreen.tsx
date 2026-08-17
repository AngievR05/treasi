import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  Platform,
  AccessibilityInfo,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line, Polygon } from 'react-native-svg';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

const PALETTE = {
  forestDeep: '#2C3B2E',
  parchment: '#E8DCC0',
  parchmentLight: '#F3ECD8',
  sienna: '#A64B2A',
  brass: '#B08D57',
  inkBlack: '#2A2420',
  mutedGreen: '#3D5040',
  signalGreen: '#4CAF50',
  alertRed: '#8B0000',
};

const CompassIcon: React.FC<{ color?: string; size?: number }> = ({
  color = PALETTE.sienna,
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="12" cy="12" r="10" />
    <Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill={color} opacity="0.3" />
    <Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </Svg>
);

const TelemetryIcon: React.FC<{ color?: string; size?: number }> = ({
  color = PALETTE.sienna,
  size = 24,
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
  size = 24,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </Svg>
);

const RotateDeviceIcon: React.FC<{ color?: string; size?: number }> = ({
  color = PALETTE.parchment,
  size = 32,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M1 4v6h6" />
    <Path d="M23 20v-6h-6" />
    <Path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
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
  requiresLocationPermission?: boolean;
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
    telemetryStatus: 'GPS & MAGNETOMETER: PENDING_AUTH',
    requiresLocationPermission: true,
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
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(1 / STEPS.length)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const btnScaleAnim = useRef(new Animated.Value(1)).current;

  const isLandscape = width > height;

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

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: (index + 1) / STEPS.length,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [index, progressAnim]);

  const announceStepToScreenReader = (stepIndex: number) => {
    const currentStep = STEPS[stepIndex];
    AccessibilityInfo.announceForAccessibility(
      `Protocol step ${stepIndex + 1} of ${STEPS.length}: ${currentStep.title}. ${currentStep.desc}`
    );
  };

  const finalizeCompletion = async () => {
    try {
      await AsyncStorage.setItem('@treasi_device_onboarding_complete', 'true');
      if (auth.currentUser) {
        const userRef = doc(db, 'users', auth.currentUser.uid);
        await updateDoc(userRef, {
          hasCompletedOnboarding: true,
        });
      }
    } catch (error) {
      // Graceful fallback
    } finally {
      onComplete();
    }
  };

  const handleStepTransition = (nextIndex: number) => {
    if (nextIndex === index) return;

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
      announceStepToScreenReader(nextIndex);
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

  const requestLocationPermission = async () => {
    setShowPermissionModal(false);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      setLocationGranted(true);
    }
    handleStepTransition(index + 1);
  };

  const handleNext = () => {
    const nextIdx = index + 1;
    if (nextIdx < STEPS.length) {
      if (STEPS[nextIdx].requiresLocationPermission && !locationGranted) {
        setShowPermissionModal(true);
      } else {
        handleStepTransition(nextIdx);
      }
    } else {
      finalizeCompletion();
    }
  };

  const current = STEPS[index];
  const isFinalStep = index === STEPS.length - 1;
  const StepIcon = current.IconComponent;

  return (
    <View
      style={[
        styles.mainWrapper,
        {
          paddingLeft: Math.max(insets.left, 16),
          paddingRight: Math.max(insets.right, 16),
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      {!isLandscape ? (
        <View style={styles.portraitWarningOverlay} accessibilityRole="header">
          <RotateDeviceIcon color={PALETTE.parchment} size={40} />
          <Text style={styles.portraitWarningTitle}>ORIENTATION LOCK REQUIRED</Text>
          <Text style={styles.portraitWarningDesc}>
            ROTATE DEVICE HORIZONTALLY TO ENGAGE TREASI FIELD TELEMETRY
          </Text>
        </View>
      ) : (
        <View style={styles.container}>
          <View style={styles.leftViewport} importantForAccessibility="no-hide-descendants">
            <View style={[styles.rivet, styles.rivetTopLeft]} />
            <View style={[styles.rivet, styles.rivetTopRight]} />
            <View style={[styles.rivet, styles.rivetBottomLeft]} />
            <View style={[styles.rivet, styles.rivetBottomRight]} />

            <View style={styles.headerMetaRow}>
              <Text style={styles.metaDocCode}>FIELD_MANUAL // REV_1962</Text>
              <Text style={styles.metaStepBadge} accessibilityLabel={`Step ${current.step}`}>
                {current.step}
              </Text>
            </View>

            <Animated.View
              style={[
                styles.contentContainer,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }],
                },
              ]}
              accessible={true}
              accessibilityRole="text"
              accessibilityLabel={`${current.title}. ${current.subtitle}. ${current.desc}`}
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

          <View style={styles.rightViewport}>
            <View style={styles.consoleCard}>
              <Text style={styles.consoleHeader} accessibilityRole="header">
                SYSTEM TELEMETRY
              </Text>

              <View
                style={styles.telemetryStatusBox}
                accessible={true}
                accessibilityLabel={`System Status: ${
                  locationGranted && index === 1
                    ? 'GPS & MAGNETOMETER: ONLINE'
                    : current.telemetryStatus
                }`}
              >
                <Animated.View style={[styles.statusDot, { opacity: pulseAnim }]} />
                <Text style={styles.telemetryStatusText}>
                  {locationGranted && index === 1
                    ? 'GPS & MAGNETOMETER: ONLINE'
                    : current.telemetryStatus}
                </Text>
              </View>

              <View
                style={styles.progressTrackerContainer}
                accessible={true}
                accessibilityLabel={`Onboarding Progress: Step ${index + 1} of ${STEPS.length}`}
              >
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
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityState={{ selected: i === index }}
                    accessibilityLabel={`Navigate to step ${i + 1}`}
                  />
                ))}
              </View>

              <View style={styles.actionSection}>
                <Animated.View style={{ transform: [{ scale: btnScaleAnim }] }}>
                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      isFinalStep && styles.primaryButtonComplete,
                    ]}
                    activeOpacity={0.9}
                    onPress={handleNext}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={isFinalStep ? 'Enter Field' : 'Next Protocol Step'}
                  >
                    <Text style={styles.buttonText}>
                      {isFinalStep ? 'ENTER FIELD ›' : 'NEXT PROTOCOL ›'}
                    </Text>
                  </TouchableOpacity>
                </Animated.View>

                {!isFinalStep && (
                  <TouchableOpacity
                    style={styles.skipButton}
                    onPress={finalizeCompletion}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Abort Tutorial and Skip"
                  >
                    <Text style={styles.skipButtonText}>ABORT TUTORIAL [SKIP]</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Contextual Permission Modal */}
      <Modal visible={showPermissionModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>LOCATION PERMISSION REQUIRED</Text>
            <Text style={styles.modalDesc}>
              Treasi requires geospatial positioning to pinpoint hidden caches relative to your physical location.
            </Text>
            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowPermissionModal(false);
                  handleStepTransition(index + 1);
                }}
              >
                <Text style={styles.modalCancelText}>SKIP PERMISSION</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalGrantBtn} onPress={requestLocationPermission}>
                <Text style={styles.modalGrantText}>ALLOW ACCESS</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  mainWrapper: {
    flex: 1,
    backgroundColor: PALETTE.forestDeep,
  },
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  portraitWarningOverlay: {
    flex: 1,
    backgroundColor: PALETTE.forestDeep,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    borderWidth: 2,
    borderColor: PALETTE.brass,
    borderRadius: 8,
  },
  portraitWarningTitle: {
    color: PALETTE.parchment,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 16,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  portraitWarningDesc: {
    color: PALETTE.brass,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: 1,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBox: {
    backgroundColor: PALETTE.forestDeep,
    borderWidth: 2,
    borderColor: PALETTE.brass,
    borderRadius: 6,
    padding: 20,
    maxWidth: 400,
    width: '100%',
  },
  modalTitle: {
    color: PALETTE.parchment,
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 10,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  modalDesc: {
    color: PALETTE.parchmentLight,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: PALETTE.brass,
    borderRadius: 4,
    alignItems: 'center',
  },
  modalCancelText: {
    color: PALETTE.brass,
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  modalGrantBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: PALETTE.sienna,
    borderRadius: 4,
    alignItems: 'center',
  },
  modalGrantText: {
    color: PALETTE.parchmentLight,
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});

export default OnboardingScreen;