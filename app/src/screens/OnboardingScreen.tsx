import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  AccessibilityInfo,
  Modal,
  AppState,
  AppStateStatus,
  ActivityIndicator,
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

const ChevronLeftIcon: React.FC<{ color?: string; size?: number }> = ({
  color = PALETTE.parchment,
  size = 20,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M15 18l-6-6 6-6" />
  </Svg>
);

const ChevronRightIcon: React.FC<{ color?: string; size?: number }> = ({
  color = PALETTE.parchment,
  size = 20,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M9 18l6-6-6-6" />
  </Svg>
);

const CheckIcon: React.FC<{ color?: string; size?: number }> = ({
  color = PALETTE.signalGreen,
  size = 20,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M20 6L9 17l-5-5" />
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

type LocationPermissionState = 'undetermined' | 'granted' | 'denied';

export const OnboardingScreen: React.FC<Props> = ({ onComplete }) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [index, setIndex] = useState(0);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [permissionState, setPermissionState] = useState<LocationPermissionState>('undetermined');
  const [isCompleting, setIsCompleting] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(1 / STEPS.length)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const isLandscape = width > height;

  const checkLocationPermission = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        setPermissionState('granted');
      } else if (status === 'denied') {
        setPermissionState('denied');
      } else {
        setPermissionState('undetermined');
      }
    } catch {
      setPermissionState('undetermined');
    }
  }, []);

  useEffect(() => {
    checkLocationPermission();

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        checkLocationPermission();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [checkLocationPermission]);

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

  const handleStepTransition = (nextIndex: number) => {
    if (nextIndex === index || isAnimating || nextIndex < 0 || nextIndex >= STEPS.length) return;
    setIsAnimating(true);

    const direction = nextIndex > index ? -1 : 1;

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: direction * 20,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIndex(nextIndex);
      announceStepToScreenReader(nextIndex);
      slideAnim.setValue(-direction * 20);

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
      ]).start(() => {
        setIsAnimating(false);
      });
    });
  };

  const requestLocationPermission = async () => {
    setShowPermissionModal(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        setPermissionState('granted');
      } else {
        setPermissionState('denied');
      }
    } catch {
      setPermissionState('denied');
    }
  };

  const finalizeCompletion = async () => {
    if (isCompleting) return;
    setIsCompleting(true);
    setErrorMessage(null);

    try {
      await AsyncStorage.setItem('@treasi_device_onboarding_complete', 'true');

      if (auth.currentUser) {
        const userRef = doc(db, 'users', auth.currentUser.uid);
        await updateDoc(userRef, {
          hasCompletedOnboarding: true,
        });
      }

      onComplete();
    } catch {
      setErrorMessage('Failed to persist protocol state. Tap to retry.');
      setIsCompleting(false);
    }
  };

  const handleNext = () => {
    if (isAnimating || isCompleting) return;

    const nextIdx = index + 1;
    if (nextIdx < STEPS.length) {
      if (STEPS[nextIdx].requiresLocationPermission && permissionState !== 'granted') {
        setShowPermissionModal(true);
      } else {
        handleStepTransition(nextIdx);
      }
    } else {
      finalizeCompletion();
    }
  };

  const handleBack = () => {
    if (isAnimating || isCompleting || index === 0) return;
    handleStepTransition(index - 1);
  };

  const current = STEPS[index];
  const isFinalStep = index === STEPS.length - 1;
  const StepIcon = current.IconComponent;

  const getDisplayedTelemetryStatus = () => {
    if (index === 1) {
      if (permissionState === 'granted') return 'GPS & MAGNETOMETER: ONLINE';
      if (permissionState === 'denied') return 'GPS & MAGNETOMETER: ACCESS_DENIED';
      return 'GPS & MAGNETOMETER: PENDING_AUTH';
    }
    return current.telemetryStatus;
  };

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
          {/* LEFT VIEWPORT (60% width) */}
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
                <StepIcon color={PALETTE.sienna} size={28} />
              </View>

              <Text style={styles.protocolCodeText}>{current.protocolCode}</Text>
              <Text style={styles.titleText}>{current.title}</Text>
              <Text style={styles.subtitleText}>[ {current.subtitle} ]</Text>

              <View style={styles.dividerLine} />

              <Text style={styles.descText}>{current.desc}</Text>
            </Animated.View>

            {errorMessage ? (
              <TouchableOpacity
                style={styles.errorContainer}
                onPress={finalizeCompletion}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={errorMessage}
              >
                <Text style={styles.errorText}>{errorMessage}</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.footerNoteRow}>
              <Text style={styles.footerNote}>TREASI FIELD PROTOCOL</Text>
              <Text style={styles.footerNote}>SECURE SPECIFICATION</Text>
            </View>
          </View>

          {/* RIGHT VIEWPORT (40% width) */}
          <View style={styles.rightViewport}>
            <View style={styles.consoleCard}>
              <Text style={styles.consoleHeader} accessibilityRole="header">
                SYSTEM TELEMETRY
              </Text>

              <View
                style={styles.telemetryStatusBox}
                accessible={true}
                accessibilityLabel={`System Status: ${getDisplayedTelemetryStatus()}`}
              >
                <Animated.View
                  style={[
                    styles.statusDot,
                    { opacity: pulseAnim },
                    permissionState === 'denied' && index === 1
                      ? styles.statusDotAlert
                      : permissionState === 'granted' && index === 1
                      ? styles.statusDotOnline
                      : null,
                  ]}
                />
                <Text style={styles.telemetryStatusText}>{getDisplayedTelemetryStatus()}</Text>
              </View>

              {index === 1 && permissionState !== 'granted' ? (
                <TouchableOpacity
                  style={styles.permissionActionBtn}
                  onPress={() => setShowPermissionModal(true)}
                  activeOpacity={0.8}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Enable Location Access"
                  accessibilityHint="Opens permission dialog to grant geospatial telemetry access"
                >
                  <Text style={styles.permissionActionBtnText}>
                    {permissionState === 'denied' ? 'RETRY LOCATION ACCESS' : 'GRANT LOCATION ACCESS'}
                  </Text>
                </TouchableOpacity>
              ) : null}

              {/* Progress Tracker */}
              <View
                style={styles.progressTrackerContainer}
                accessible={true}
                accessibilityLabel={`Onboarding Progress: Step ${index + 1} of ${STEPS.length}`}
              >
                <Text style={styles.progressLabel}>
                  PROTOCOL PROGRESS — STEP {index + 1} OF {STEPS.length}
                </Text>
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

              {/* Step Navigation Nodes */}
              <View style={styles.nodeRow}>
                {STEPS.map((_, i) => (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.7}
                    onPress={() => handleStepTransition(i)}
                    disabled={isAnimating || isCompleting}
                    style={[
                      styles.stepNode,
                      i === index && styles.stepNodeActive,
                      i < index && styles.stepNodeCompleted,
                    ]}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityState={{ selected: i === index }}
                    accessibilityLabel={`Navigate directly to step ${i + 1}`}
                  >
                    <Text
                      style={[
                        styles.stepNodeText,
                        i === index && styles.stepNodeTextActive,
                        i < index && styles.stepNodeTextCompleted,
                      ]}
                    >
                      {i < index ? '✓' : `0${i + 1}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Action Buttons Row */}
              <View style={styles.controlButtonsRow}>
                <TouchableOpacity
                  style={[styles.navBtn, styles.backBtn, index === 0 && styles.navBtnDisabled]}
                  onPress={handleBack}
                  disabled={index === 0 || isAnimating || isCompleting}
                  activeOpacity={0.8}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Previous onboarding step"
                  accessibilityState={{ disabled: index === 0 }}
                >
                  <ChevronLeftIcon color={index === 0 ? PALETTE.brass : PALETTE.parchment} size={18} />
                  <Text style={[styles.navBtnText, index === 0 && styles.navBtnTextDisabled]}>
                    BACK
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.navBtn,
                    styles.nextBtn,
                    isFinalStep && styles.completeBtn,
                    (isAnimating || isCompleting) && styles.navBtnDisabled,
                  ]}
                  onPress={handleNext}
                  disabled={isAnimating || isCompleting}
                  activeOpacity={0.8}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={isFinalStep ? 'Complete onboarding protocol' : 'Next onboarding step'}
                >
                  {isCompleting ? (
                    <ActivityIndicator size="small" color={PALETTE.parchment} />
                  ) : (
                    <>
                      <Text style={styles.nextBtnText}>
                        {isFinalStep ? 'COMPLETE' : 'NEXT'}
                      </Text>
                      {isFinalStep ? (
                        <CheckIcon color={PALETTE.parchment} size={18} />
                      ) : (
                        <ChevronRightIcon color={PALETTE.parchment} size={18} />
                      )}
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Location Permission Modal */}
      <Modal
        visible={showPermissionModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPermissionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={styles.modalCard}
            accessible={true}
            accessibilityRole="alert"
            accessibilityLabel="Location permission explanation"
          >
            <View style={styles.modalIconWrapper}>
              <TelemetryIcon color={PALETTE.sienna} size={32} />
            </View>

            <Text style={styles.modalTitle}>GEOSPATIAL PERMISSION REQUIRED</Text>
            <Text style={styles.modalSubTitle}>[ GEOLOCATION_AUTH_REQUEST ]</Text>

            <View style={styles.modalDivider} />

            <Text style={styles.modalDesc}>
              Treasi requires real-time device GPS coordinates and magnetometer heading telemetry to
              locate nearby digital treasures, calculate live compass bearings, and enable kinetic excavation.
            </Text>

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowPermissionModal(false);
                  handleStepTransition(index + 1);
                }}
                activeOpacity={0.8}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Continue without granting location permission"
              >
                <Text style={styles.modalCancelBtnText}>SKIP FOR NOW</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalGrantBtn}
                onPress={requestLocationPermission}
                activeOpacity={0.8}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Grant Location Permission"
              >
                <Text style={styles.modalGrantBtnText}>ENABLE LOCATION</Text>
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
    gap: 12,
  },
  portraitWarningOverlay: {
    flex: 1,
    backgroundColor: PALETTE.forestDeep,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  portraitWarningTitle: {
    fontFamily: 'Courier',
    fontWeight: 'bold',
    fontSize: 16,
    color: PALETTE.sienna,
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 1.5,
  },
  portraitWarningDesc: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: PALETTE.parchment,
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: 0.8,
  },
  leftViewport: {
    flex: 0.6,
    backgroundColor: PALETTE.parchment,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: PALETTE.brass,
    padding: 16,
    justifyContent: 'space-between',
    position: 'relative',
  },
  rivet: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PALETTE.brass,
    borderWidth: 1,
    borderColor: PALETTE.inkBlack,
  },
  rivetTopLeft: { top: 6, left: 6 },
  rivetTopRight: { top: 6, right: 6 },
  rivetBottomLeft: { bottom: 6, left: 6 },
  rivetBottomRight: { bottom: 6, right: 6 },

  headerMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.brass,
    paddingBottom: 8,
  },
  metaDocCode: {
    fontFamily: 'Courier',
    fontSize: 10,
    fontWeight: 'bold',
    color: PALETTE.inkBlack,
    letterSpacing: 1,
  },
  metaStepBadge: {
    fontFamily: 'Courier',
    fontSize: 11,
    fontWeight: 'bold',
    color: PALETTE.sienna,
    letterSpacing: 1,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingVertical: 8,
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PALETTE.parchmentLight,
    borderWidth: 1.5,
    borderColor: PALETTE.sienna,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  protocolCodeText: {
    fontFamily: 'Courier',
    fontSize: 10,
    color: PALETTE.sienna,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 2,
  },
  titleText: {
    fontFamily: 'Courier',
    fontSize: 18,
    fontWeight: 'bold',
    color: PALETTE.inkBlack,
    letterSpacing: 1.2,
  },
  subtitleText: {
    fontFamily: 'Courier',
    fontSize: 10,
    color: PALETTE.mutedGreen,
    letterSpacing: 0.8,
    marginTop: 2,
    marginBottom: 8,
  },
  dividerLine: {
    width: '100%',
    height: 1,
    backgroundColor: PALETTE.brass,
    marginVertical: 8,
    opacity: 0.5,
  },
  descText: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: PALETTE.inkBlack,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
  footerNoteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: PALETTE.brass,
    paddingTop: 6,
  },
  footerNote: {
    fontFamily: 'Courier',
    fontSize: 8,
    color: PALETTE.brass,
    letterSpacing: 0.8,
  },
  errorContainer: {
    backgroundColor: PALETTE.alertRed,
    padding: 8,
    borderRadius: 4,
    marginVertical: 6,
  },
  errorText: {
    fontFamily: 'Courier',
    fontSize: 10,
    color: PALETTE.parchment,
    textAlign: 'center',
  },
  rightViewport: {
    flex: 0.4,
  },
  consoleCard: {
    flex: 1,
    backgroundColor: PALETTE.forestDeep,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: PALETTE.brass,
    padding: 14,
    justifyContent: 'space-between',
  },
  consoleHeader: {
    fontFamily: 'Courier',
    fontSize: 12,
    fontWeight: 'bold',
    color: PALETTE.parchment,
    letterSpacing: 1.2,
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.brass,
    paddingBottom: 6,
  },
  telemetryStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E2920',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: PALETTE.brass,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginVertical: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PALETTE.brass,
    marginRight: 8,
  },
  statusDotOnline: {
    backgroundColor: PALETTE.signalGreen,
  },
  statusDotAlert: {
    backgroundColor: PALETTE.alertRed,
  },
  telemetryStatusText: {
    fontFamily: 'Courier',
    fontSize: 9,
    fontWeight: 'bold',
    color: PALETTE.parchment,
    flexShrink: 1,
    letterSpacing: 0.6,
  },
  permissionActionBtn: {
    backgroundColor: PALETTE.sienna,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PALETTE.brass,
    minHeight: 36,
    justifyContent: 'center',
  },
  permissionActionBtnText: {
    fontFamily: 'Courier',
    fontSize: 9,
    fontWeight: 'bold',
    color: PALETTE.parchment,
    letterSpacing: 0.8,
  },
  progressTrackerContainer: {
    marginVertical: 4,
  },
  progressLabel: {
    fontFamily: 'Courier',
    fontSize: 9,
    color: PALETTE.brass,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#1E2920',
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
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  stepNode: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E2920',
    borderWidth: 1.5,
    borderColor: PALETTE.brass,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 36,
    minHeight: 36,
  },
  stepNodeActive: {
    backgroundColor: PALETTE.sienna,
    borderColor: PALETTE.parchment,
  },
  stepNodeCompleted: {
    backgroundColor: PALETTE.mutedGreen,
    borderColor: PALETTE.signalGreen,
  },
  stepNodeText: {
    fontFamily: 'Courier',
    fontSize: 10,
    fontWeight: 'bold',
    color: PALETTE.brass,
  },
  stepNodeTextActive: {
    color: PALETTE.parchment,
  },
  stepNodeTextCompleted: {
    color: PALETTE.signalGreen,
  },
  controlButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  navBtn: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 44,
    borderRadius: 4,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  backBtn: {
    backgroundColor: '#1E2920',
    borderColor: PALETTE.brass,
  },
  nextBtn: {
    backgroundColor: PALETTE.sienna,
    borderColor: PALETTE.brass,
  },
  completeBtn: {
    backgroundColor: PALETTE.mutedGreen,
    borderColor: PALETTE.signalGreen,
  },
  navBtnDisabled: {
    opacity: 0.4,
  },
  navBtnText: {
    fontFamily: 'Courier',
    fontSize: 11,
    fontWeight: 'bold',
    color: PALETTE.parchment,
    letterSpacing: 0.8,
  },
  navBtnTextDisabled: {
    color: PALETTE.brass,
  },
  nextBtnText: {
    fontFamily: 'Courier',
    fontSize: 11,
    fontWeight: 'bold',
    color: PALETTE.parchment,
    letterSpacing: 0.8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(42, 36, 32, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: PALETTE.parchment,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: PALETTE.brass,
    padding: 20,
    alignItems: 'center',
  },
  modalIconWrapper: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: PALETTE.parchmentLight,
    borderWidth: 1.5,
    borderColor: PALETTE.sienna,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  modalTitle: {
    fontFamily: 'Courier',
    fontSize: 14,
    fontWeight: 'bold',
    color: PALETTE.inkBlack,
    letterSpacing: 1,
    textAlign: 'center',
  },
  modalSubTitle: {
    fontFamily: 'Courier',
    fontSize: 10,
    color: PALETTE.sienna,
    letterSpacing: 0.8,
    marginTop: 2,
    marginBottom: 8,
  },
  modalDivider: {
    width: '100%',
    height: 1,
    backgroundColor: PALETTE.brass,
    marginVertical: 10,
    opacity: 0.6,
  },
  modalDesc: {
    fontFamily: 'Courier',
    fontSize: 11,
    color: PALETTE.inkBlack,
    lineHeight: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalCancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: PALETTE.brass,
    backgroundColor: PALETTE.parchmentLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    fontFamily: 'Courier',
    fontSize: 10,
    fontWeight: 'bold',
    color: PALETTE.inkBlack,
    letterSpacing: 0.6,
  },
  modalGrantBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: PALETTE.brass,
    backgroundColor: PALETTE.sienna,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalGrantBtnText: {
    fontFamily: 'Courier',
    fontSize: 10,
    fontWeight: 'bold',
    color: PALETTE.parchment,
    letterSpacing: 0.6,
  },
});