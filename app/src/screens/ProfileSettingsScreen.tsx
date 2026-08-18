import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ScrollView,
  Platform,
  Animated,
  Easing,
  useWindowDimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { signOut, updateProfile } from 'firebase/auth';
import { db, auth } from '../config/firebase';
import { FieldNavBar, NavigationTab } from '../components/FieldNavBar';
import { UserDocument } from '../types/firestore';

interface ProfileSettingsScreenProps {
  onBack?: () => void;
  onSignOut: () => void;
  onNavigate?: (tab: NavigationTab) => void;
  userData?: UserDocument | null;
  isLoadingUserData?: boolean;
  onUpdateUserSettings?: (updatedFields: Partial<UserDocument>) => Promise<void>;
}

export const ProfileSettingsScreen: React.FC<ProfileSettingsScreenProps> = ({
  onBack,
  onSignOut,
  onNavigate,
  userData,
  isLoadingUserData = false,
  onUpdateUserSettings,
}) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Operational States
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);

  // Calibration Array Toggles - Strictly Synced from User Document (Default: OFF / false)
  const [hapticTriggers, setHapticTriggers] = useState<boolean>(false);
  const [sensorSensitivity, setSensorSensitivity] = useState<boolean>(false);
  const [batteryOptimize, setBatteryOptimize] = useState<boolean>(false);
  const [nightFieldMode, setNightFieldMode] = useState<boolean>(false);
  const [telemetryEnabled, setTelemetryEnabled] = useState<boolean>(false);
  const [skipOnboardingAuthFlow, setSkipOnboardingAuthFlow] = useState<boolean>(false);

  // Identity Editing State
  const [agentName, setAgentName] = useState<string>('');
  const [handle, setHandle] = useState<string>('');

  // Micro-interaction Tactile Animation References
  const editBtnScale = useRef(new Animated.Value(1)).current;
  const signOutBtnScale = useRef(new Animated.Value(1)).current;

  // Dynamic state synchronization directly from authenticated user profile source
  useEffect(() => {
    if (userData) {
      setHapticTriggers(userData.hapticFeedbackEnabled ?? false);
      setSensorSensitivity(userData.motionSensitivityEnabled ?? false);
      setBatteryOptimize(userData.batteryOptimizerEnabled ?? false);
      setNightFieldMode(userData.nightModeEnabled ?? false);
      setTelemetryEnabled(userData.telemetryEnabled ?? false);
      setSkipOnboardingAuthFlow(userData.skipOnboardingAuthFlow ?? false);

      const activeName = userData.username || auth.currentUser?.displayName || 'UNREGISTERED_AGENT';
      setAgentName(activeName);
      setHandle(`@${activeName.toLowerCase().replace(/\s+/g, '_')}`);
    }
  }, [userData]);

  // Tactile Spring & Bounce Animation Trigger
  const triggerPressAnimation = (animValue: Animated.Value, callback?: () => void) => {
    Animated.sequence([
      Animated.timing(animValue, {
        toValue: 0.94,
        duration: 80,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(animValue, {
        toValue: 1,
        friction: 4,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (callback) callback();
    });
  };

  /**
   * Unified Firestore Settings Mutation
   * Executes parent callback or directly updates current user document in Firestore
   */
  const persistUserFields = useCallback(
    async (fields: Partial<UserDocument>) => {
      try {
        setIsSaving(true);
        if (onUpdateUserSettings) {
          await onUpdateUserSettings(fields);
        } else {
          const currentUid = userData?.uid || auth.currentUser?.uid;
          if (!currentUid) {
            throw new Error('No authenticated Firebase user session found.');
          }
          const userRef = doc(db, 'users', currentUid);
          await updateDoc(userRef, {
            ...fields,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error: any) {
        console.error('[SETTINGS PERSISTENCE ERROR]', error);
        Alert.alert(
          'CALIBRATION ERROR',
          error?.message || 'Failed to synchronize telemetry settings with Firestore.'
        );
      } finally {
        setIsSaving(false);
      }
    },
    [onUpdateUserSettings, userData?.uid]
  );

  /**
   * Real-time Switch Toggle Handler with Immediate Persistence & Optimistic UI
   */
  const handleToggleChange = async (
    key: keyof UserDocument,
    value: boolean,
    setter: (val: boolean) => void
  ) => {
    setter(value);
    try {
      await persistUserFields({ [key]: value });
    } catch {
      setter(!value);
    }
  };

  /**
   * Identity Record Persistence Handler
   */
  const handleSaveProfile = () => {
    triggerPressAnimation(editBtnScale, async () => {
      const cleanUsername = agentName.trim();
      if (cleanUsername.length === 0) {
        Alert.alert('INVALID CALLSIGN', 'Agent callsign cannot be empty.');
        return;
      }

      try {
        setIsSaving(true);
        // Sync Firebase Auth profile display name if user is authenticated
        if (auth.currentUser) {
          await updateProfile(auth.currentUser, { displayName: cleanUsername });
        }
        await persistUserFields({ username: cleanUsername });
        setHandle(`@${cleanUsername.toLowerCase().replace(/\s+/g, '_')}`);
        setIsEditing(false);
      } catch (error: any) {
        Alert.alert('PROFILE UPDATE ERROR', error.message || 'Failed to update user profile.');
      } finally {
        setIsSaving(false);
      }
    });
  };

  const handleStartEditing = () => {
    triggerPressAnimation(editBtnScale, () => {
      setIsEditing(true);
    });
  };

  /**
   * Firebase Authentication Logout Process
   */
  const handleSignOutPress = () => {
    if (isLoggingOut) return;

    Alert.alert(
      'TERMINATE SESSION',
      'Are you sure you want to sign out of Treasi?',
      [
        { text: 'CANCEL', style: 'cancel' },
        {
          text: 'LOGOUT',
          style: 'destructive',
          onPress: () => {
            triggerPressAnimation(signOutBtnScale, async () => {
              try {
                setIsLoggingOut(true);
                await signOut(auth);
                onSignOut();
              } catch (error: any) {
                console.error('[SIGNOUT ERROR]', error);
                Alert.alert('LOGOUT FAILED', error.message || 'Could not sign out user.');
              } finally {
                setIsLoggingOut(false);
              }
            });
          },
        },
      ]
    );
  };

  // Live Firestore Metadata Formatting
  const formatMemberSince = (): string => {
    if (!userData?.createdAt) return 'N/A';
    try {
      const date =
        typeof userData.createdAt.toDate === 'function'
          ? userData.createdAt.toDate()
          : new Date(userData.createdAt as any);
      if (isNaN(date.getTime())) return 'N/A';
      const month = date.toLocaleString('default', { month: 'short' }).toUpperCase();
      const year = date.getFullYear();
      return `${month} ${year}`;
    } catch {
      return 'N/A';
    }
  };

  const calculateBadgeRank = (points: number = 0): string => {
    if (points >= 500) return 'COMMANDER I';
    if (points >= 250) return 'PATHFINDER II';
    if (points >= 100) return 'TRAILBLAZER III';
    return 'RECON SCOUT';
  };

  const currentEmail = userData?.email || auth.currentUser?.email || 'N/A';
  const currentUid = userData?.uid || auth.currentUser?.uid || 'N/A';

  // Loading state guard preventing rendering of unauthenticated or fake profile views
  if (isLoadingUserData && !userData) {
    return (
      <View style={[styles.safeAreaContainer, styles.centeredLoading]}>
        <ActivityIndicator size="large" color="#B08D57" />
        <Text style={styles.loadingText}>FETCHING AGENT PROFILE...</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.safeAreaContainer,
        {
          paddingLeft: Math.max(insets.left, 12),
          paddingRight: Math.max(insets.right, 12),
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      <View style={[styles.splitWrapper, !isLandscape && styles.portraitWrapper]}>
        {/* LEFT VIEWPORT: FIELD IDENTITY LOG CARD */}
        <View style={styles.leftViewport}>
          <View style={styles.cardInnerBorder}>
            <View style={styles.cardHeader}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="document-text-outline" size={13} color="#2A2420" />
                <Text style={styles.headerTitle}> FIELD IDENTITY LOG</Text>
              </View>
              <Text style={styles.headerTag}>
                UID: {currentUid !== 'N/A' ? currentUid.substring(0, 6).toUpperCase() : 'N/A'}
              </Text>
            </View>

            <View style={styles.identityRow}>
              <View style={styles.avatarBox}>
                <Ionicons name="person" size={32} color="#E8DCC0" />
              </View>
              <View style={styles.identityDetails}>
                {isEditing ? (
                  <View style={styles.editInputGroup}>
                    <TextInput
                      style={styles.textInput}
                      value={agentName}
                      onChangeText={setAgentName}
                      placeholder="AGENT CALLSIGN"
                      placeholderTextColor="#8C7A6B"
                      autoCapitalize="characters"
                      accessible={true}
                      accessibilityLabel="Agent Callsign Input"
                    />
                  </View>
                ) : (
                  <>
                    <Text style={styles.agentName} numberOfLines={1}>
                      {agentName || 'UNREGISTERED_AGENT'}
                    </Text>
                    <Text style={styles.handleText} numberOfLines={1}>
                      {handle || '@unregistered'}
                    </Text>
                  </>
                )}
                <View style={styles.badgeContainer}>
                  <Ionicons name="shield-checkmark" size={10} color="#F3ECD8" style={styles.badgeIcon} />
                  <Text style={styles.badgeText}>
                    {calculateBadgeRank(userData?.totalPoints ?? 0)}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.dashedDivider} />

            <View style={styles.metaGrid}>
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>MEMBER SINCE</Text>
                <Text style={styles.metaVal}>{formatMemberSince()}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>FIELD PERMIT</Text>
                <View style={styles.permitStarRow}>
                  <Ionicons name="star" size={9} color="#2A2420" />
                  <Ionicons name="star" size={9} color="#2A2420" />
                  <Ionicons name="star" size={9} color="#2A2420" />
                  <Text style={styles.metaVal}>
                    {' '}
                    {userData?.hasCompletedOnboarding ? 'ACTIVE' : 'PENDING'}
                  </Text>
                </View>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>EXP POINTS</Text>
                <Text style={styles.metaVal}>{userData?.totalPoints ?? 0} PTS</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>EMAIL</Text>
                <Text style={styles.metaVal} numberOfLines={1}>
                  {currentEmail}
                </Text>
              </View>
            </View>

            <Animated.View style={{ transform: [{ scale: editBtnScale }] }}>
              <TouchableOpacity
                style={styles.editProfileButton}
                activeOpacity={0.8}
                disabled={isSaving}
                onPress={isEditing ? handleSaveProfile : handleStartEditing}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={isEditing ? 'Save identity record' : 'Edit identity details'}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#2A2420" />
                ) : (
                  <>
                    <Ionicons
                      name={isEditing ? 'checkmark-sharp' : 'create-outline'}
                      size={13}
                      color="#2A2420"
                      style={styles.btnIcon}
                    />
                    <Text style={styles.editProfileText}>
                      {isEditing ? 'SAVE IDENTITY RECORD' : 'EDIT IDENTITY DETAILS'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

        {/* RIGHT VIEWPORT: SYSTEM CALIBRATION CONSOLE */}
        <View style={styles.rightViewport}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.panelHeaderRow}>
              <Ionicons name="hardware-chip-outline" size={11} color="#A64B2A" />
              <Text style={styles.panelTitle}> CALIBRATION ARRAY</Text>
              {isSaving && <ActivityIndicator size="small" color="#A64B2A" style={{ marginLeft: 6 }} />}
            </View>
            <View style={styles.panelDivider} />

            {/* TOGGLE 1: HAPTIC TRIGGERS */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelGroup}>
                <Ionicons name="radio-outline" size={12} color="#B08D57" />
                <Text style={styles.toggleText}>HAPTIC TRIGGERS</Text>
              </View>
              <Switch
                trackColor={{ false: '#161E17', true: '#A64B2A' }}
                thumbColor={hapticTriggers ? '#F3ECD8' : '#7A6B58'}
                ios_backgroundColor="#161E17"
                onValueChange={(val) =>
                  handleToggleChange('hapticFeedbackEnabled', val, setHapticTriggers)
                }
                value={hapticTriggers}
                accessible={true}
                accessibilityRole="switch"
                accessibilityLabel="Haptic Triggers Toggle"
                accessibilityState={{ checked: hapticTriggers }}
              />
            </View>

            {/* TOGGLE 2: SENSOR SENSITIVITY */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelGroup}>
                <Ionicons name="flash-outline" size={12} color="#B08D57" />
                <Text style={styles.toggleText}>SENSOR SENSITIVITY</Text>
              </View>
              <Switch
                trackColor={{ false: '#161E17', true: '#A64B2A' }}
                thumbColor={sensorSensitivity ? '#F3ECD8' : '#7A6B58'}
                ios_backgroundColor="#161E17"
                onValueChange={(val) =>
                  handleToggleChange('motionSensitivityEnabled', val, setSensorSensitivity)
                }
                value={sensorSensitivity}
                accessible={true}
                accessibilityRole="switch"
                accessibilityLabel="Sensor Sensitivity Toggle"
                accessibilityState={{ checked: sensorSensitivity }}
              />
            </View>

            {/* TOGGLE 3: BATTERY OPTIMIZE */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelGroup}>
                <Ionicons name="battery-charging-outline" size={12} color="#B08D57" />
                <Text style={styles.toggleText}>BATTERY OPTIMIZE</Text>
              </View>
              <Switch
                trackColor={{ false: '#161E17', true: '#A64B2A' }}
                thumbColor={batteryOptimize ? '#F3ECD8' : '#7A6B58'}
                ios_backgroundColor="#161E17"
                onValueChange={(val) =>
                  handleToggleChange('batteryOptimizerEnabled', val, setBatteryOptimize)
                }
                value={batteryOptimize}
                accessible={true}
                accessibilityRole="switch"
                accessibilityLabel="Battery Optimize Toggle"
                accessibilityState={{ checked: batteryOptimize }}
              />
            </View>

            {/* TOGGLE 4: NIGHT FIELD MODE */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelGroup}>
                <Ionicons name="moon-outline" size={12} color="#B08D57" />
                <Text style={styles.toggleText}>NIGHT FIELD MODE</Text>
              </View>
              <Switch
                trackColor={{ false: '#161E17', true: '#A64B2A' }}
                thumbColor={nightFieldMode ? '#F3ECD8' : '#7A6B58'}
                ios_backgroundColor="#161E17"
                onValueChange={(val) =>
                  handleToggleChange('nightModeEnabled', val, setNightFieldMode)
                }
                value={nightFieldMode}
                accessible={true}
                accessibilityRole="switch"
                accessibilityLabel="Night Field Mode Toggle"
                accessibilityState={{ checked: nightFieldMode }}
              />
            </View>

            {/* TOGGLE 5: TELEMETRY LOGS */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelGroup}>
                <Ionicons name="stats-chart-outline" size={12} color="#B08D57" />
                <Text style={styles.toggleText}>TELEMETRY LOGS</Text>
              </View>
              <Switch
                trackColor={{ false: '#161E17', true: '#A64B2A' }}
                thumbColor={telemetryEnabled ? '#F3ECD8' : '#7A6B58'}
                ios_backgroundColor="#161E17"
                onValueChange={(val) =>
                  handleToggleChange('telemetryEnabled', val, setTelemetryEnabled)
                }
                value={telemetryEnabled}
                accessible={true}
                accessibilityRole="switch"
                accessibilityLabel="Telemetry Logging Toggle"
                accessibilityState={{ checked: telemetryEnabled }}
              />
            </View>

            {/* TOGGLE 6: BYPASS ONBOARDING FLOW */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelGroup}>
                <Ionicons name="caret-forward-outline" size={12} color="#B08D57" />
                <Text style={styles.toggleText}>BYPASS ONBOARDING</Text>
              </View>
              <Switch
                trackColor={{ false: '#161E17', true: '#A64B2A' }}
                thumbColor={skipOnboardingAuthFlow ? '#F3ECD8' : '#7A6B58'}
                ios_backgroundColor="#161E17"
                onValueChange={(val) =>
                  handleToggleChange('skipOnboardingAuthFlow', val, setSkipOnboardingAuthFlow)
                }
                value={skipOnboardingAuthFlow}
                accessible={true}
                accessibilityRole="switch"
                accessibilityLabel="Bypass Onboarding Flow Toggle"
                accessibilityState={{ checked: skipOnboardingAuthFlow }}
              />
            </View>

            {/* LOGOUT SESSION BUTTON */}
            <Animated.View style={{ transform: [{ scale: signOutBtnScale }] }}>
              <TouchableOpacity
                style={styles.signOutButton}
                activeOpacity={0.8}
                disabled={isLoggingOut}
                onPress={handleSignOutPress}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Logout Session"
              >
                {isLoggingOut ? (
                  <ActivityIndicator size="small" color="#F3ECD8" />
                ) : (
                  <>
                    <Ionicons name="log-out-outline" size={13} color="#F3ECD8" />
                    <Text style={styles.signOutText}>LOGOUT SESSION</Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>

            {onBack && (
              <TouchableOpacity
                style={styles.backButton}
                onPress={onBack}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Back to Dashboard"
              >
                <Ionicons name="chevron-back-sharp" size={11} color="#B08D57" />
                <Text style={styles.backText}> DASHBOARD</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Integrated Field Navigation Bar */}
          <View style={styles.navBarContainer}>
            <FieldNavBar
              currentTab="PROFILE"
              onNavigate={(tab) => onNavigate?.(tab as NavigationTab)}
            />
          </View>
        </View>
      </View>
    </View>
  );
};

const fontMonospace = Platform.OS === 'ios' ? 'Courier' : 'monospace';

const styles = StyleSheet.create({
  safeAreaContainer: {
    flex: 1,
    backgroundColor: '#1E281F',
  },
  centeredLoading: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: fontMonospace,
    color: '#E8DCC0',
    fontSize: 11,
    marginTop: 10,
    letterSpacing: 1,
  },
  splitWrapper: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#B08D57',
  },
  portraitWrapper: {
    flexDirection: 'column',
  },
  leftViewport: {
    flex: 0.58,
    backgroundColor: '#E8DCC0',
    padding: 8,
  },
  cardInnerBorder: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2A2420',
    padding: 8,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: fontMonospace,
    color: '#2A2420',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 1.1,
  },
  headerTag: {
    fontFamily: fontMonospace,
    color: '#2A2420',
    fontSize: 9.5,
    fontWeight: '700',
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  avatarBox: {
    width: 44,
    height: 44,
    backgroundColor: '#2C3B2E',
    borderWidth: 2,
    borderColor: '#B08D57',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  identityDetails: {
    flex: 1,
  },
  agentName: {
    fontFamily: fontMonospace,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 0.8,
  },
  handleText: {
    fontFamily: fontMonospace,
    fontSize: 9.5,
    color: '#5C5248',
    marginBottom: 3,
  },
  editInputGroup: {
    marginBottom: 2,
  },
  textInput: {
    fontFamily: fontMonospace,
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#2A2420',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    fontSize: 10,
    color: '#2A2420',
    marginBottom: 2,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#A64B2A',
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 6,
  },
  badgeIcon: {
    marginRight: 3,
  },
  badgeText: {
    fontFamily: fontMonospace,
    color: '#F3ECD8',
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 0.7,
  },
  dashedDivider: {
    borderStyle: 'dashed',
    borderBottomWidth: 1,
    borderColor: '#2A2420',
    marginVertical: 4,
    opacity: 0.4,
  },
  metaGrid: {
    marginVertical: 2,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2.5,
  },
  metaKey: {
    fontFamily: fontMonospace,
    color: '#2A2420',
    fontSize: 8.5,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  metaVal: {
    fontFamily: fontMonospace,
    color: '#2A2420',
    fontSize: 8.5,
    fontWeight: 'bold',
    maxWidth: '55%',
  },
  permitStarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editProfileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A2420',
    backgroundColor: '#F3ECD8',
    paddingVertical: 5,
    borderRadius: 3,
    marginTop: 2,
    minHeight: 28,
  },
  btnIcon: {
    marginRight: 4,
  },
  editProfileText: {
    fontFamily: fontMonospace,
    fontSize: 8,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 0.8,
  },
  rightViewport: {
    flex: 0.42,
    backgroundColor: '#2C3B2E',
    borderLeftWidth: 2,
    borderColor: '#B08D57',
    padding: 6,
    justifyContent: 'space-between',
  },
  scrollContent: {
    paddingBottom: 4,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  panelTitle: {
    fontFamily: fontMonospace,
    color: '#E8DCC0',
    fontWeight: 'bold',
    fontSize: 10,
    letterSpacing: 0.8,
  },
  panelDivider: {
    height: 1,
    backgroundColor: '#B08D57',
    opacity: 0.4,
    marginVertical: 4,
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E281F',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginBottom: 4,
    minHeight: 28,
  },
  toggleLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleText: {
    fontFamily: fontMonospace,
    color: '#E8DCC0',
    fontSize: 7.5,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A64B2A',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 5,
    borderRadius: 4,
    marginTop: 3,
    minHeight: 30,
  },
  signOutText: {
    fontFamily: fontMonospace,
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 8.5,
    letterSpacing: 0.8,
    marginLeft: 4,
  },
  backButton: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 4,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
    minHeight: 24,
  },
  backText: {
    fontFamily: fontMonospace,
    color: '#B08D57',
    fontSize: 8,
    fontWeight: 'bold',
  },
  navBarContainer: {
    marginTop: 3,
  },
});