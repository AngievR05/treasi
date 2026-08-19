import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
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

type SettingKey =
  | 'hapticFeedbackEnabled'
  | 'motionSensitivityEnabled'
  | 'batteryOptimizerEnabled'
  | 'nightModeEnabled'
  | 'telemetryEnabled'
  | 'skipOnboardingAuthFlow';

interface SettingConfig {
  key: SettingKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
}

const SETTINGS: SettingConfig[] = [
  {
    key: 'hapticFeedbackEnabled',
    label: 'HAPTIC TRIGGERS',
    icon: 'radio-outline',
    description: 'Enable tactile feedback for supported interactions.',
  },
  {
    key: 'motionSensitivityEnabled',
    label: 'SENSOR SENSITIVITY',
    icon: 'flash-outline',
    description: 'Enable the motion sensitivity preference used by supported sensor interactions.',
  },
  {
    key: 'batteryOptimizerEnabled',
    label: 'BATTERY OPTIMIZE',
    icon: 'battery-charging-outline',
    description: 'Enable the battery optimisation preference used by supported location polling.',
  },
  {
    key: 'nightModeEnabled',
    label: 'NIGHT FIELD MODE',
    icon: 'moon-outline',
    description: 'Enable the saved night-mode preference for supported UI.',
  },
  {
    key: 'telemetryEnabled',
    label: 'TELEMETRY LOGS',
    icon: 'stats-chart-outline',
    description: 'Enable the saved telemetry preference for supported location/sensor features.',
  },
  {
    key: 'skipOnboardingAuthFlow',
    label: 'BYPASS ONBOARDING',
    icon: 'caret-forward-outline',
    description: 'Persist the preference used by the app startup flow to bypass onboarding where supported.',
  },
];

const safeString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback;
};

const sanitiseUsername = (value: string): string => value.trim().replace(/\s+/g, ' ');

const buildHandle = (username: string): string => {
  const clean = username.trim().toLowerCase();
  return clean ? `@${clean.replace(/\s+/g, '_')}` : '@unregistered';
};

const getFriendlyAuthError = (error: unknown, fallback: string): string => {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : '';

  switch (code) {
    case 'auth/network-request-failed':
      return 'Network connection failed. Please check your connection and try again.';
    case 'auth/requires-recent-login':
      return 'Please sign in again before making this profile change.';
    case 'auth/user-disabled':
      return 'This Firebase account has been disabled.';
    default:
      return fallback;
  }
};

const formatMemberSince = (createdAt: unknown): string => {
  if (!createdAt) return 'N/A';

  try {
    const maybeTimestamp = createdAt as {
      toDate?: () => Date;
    };

    const date =
      typeof maybeTimestamp.toDate === 'function'
        ? maybeTimestamp.toDate()
        : createdAt instanceof Date
          ? createdAt
          : new Date(createdAt as string | number);

    if (Number.isNaN(date.getTime())) return 'N/A';

    return `${date.toLocaleString('default', {
      month: 'short',
    }).toUpperCase()} ${date.getFullYear()}`;
  } catch {
    return 'N/A';
  }
};

const calculateBadgeRank = (points: number): string => {
  if (points >= 500) return 'COMMANDER I';
  if (points >= 250) return 'PATHFINDER II';
  if (points >= 100) return 'TRAILBLAZER III';
  return 'RECON SCOUT';
};

const normaliseBoolean = (value: unknown): boolean => value === true;

export const ProfileSettingsScreen: React.FC<ProfileSettingsScreenProps> = ({
  onBack,
  onSignOut,
  onNavigate,
  userData: parentUserData = null,
  isLoadingUserData = false,
  onUpdateUserSettings,
}) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [localUserData, setLocalUserData] = useState<UserDocument | null>(parentUserData);
  const [isLoadingProfile, setIsLoadingProfile] = useState<boolean>(
    isLoadingUserData && !parentUserData,
  );
  const [profileError, setProfileError] = useState<string>('');

  const [isSavingProfile, setIsSavingProfile] = useState<boolean>(false);
  const [isSavingSetting, setIsSavingSetting] = useState<SettingKey | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);

  const [hapticTriggers, setHapticTriggers] = useState(false);
  const [sensorSensitivity, setSensorSensitivity] = useState(false);
  const [batteryOptimize, setBatteryOptimize] = useState(false);
  const [nightFieldMode, setNightFieldMode] = useState(false);
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [skipOnboardingAuthFlow, setSkipOnboardingAuthFlow] = useState(false);

  const [agentName, setAgentName] = useState('');
  const [editingOriginalName, setEditingOriginalName] = useState('');

  const editBtnScale = useRef(new Animated.Value(1)).current;
  const signOutBtnScale = useRef(new Animated.Value(1)).current;

  const currentFirebaseUser = auth.currentUser;
  const currentUid = currentFirebaseUser?.uid ?? localUserData?.uid ?? 'N/A';

  const applyUserDataToLocalState = useCallback((data: UserDocument | null) => {
    setLocalUserData(data);

    if (!data) return;

    const username =
      safeString(data.username) ||
      safeString(auth.currentUser?.displayName) ||
      'UNREGISTERED_AGENT';

    setAgentName(username);
    setHapticTriggers(normaliseBoolean(data.hapticFeedbackEnabled));
    setSensorSensitivity(normaliseBoolean(data.motionSensitivityEnabled));
    setBatteryOptimize(normaliseBoolean(data.batteryOptimizerEnabled));
    setNightFieldMode(normaliseBoolean(data.nightModeEnabled));
    setTelemetryEnabled(normaliseBoolean(data.telemetryEnabled));
    setSkipOnboardingAuthFlow(normaliseBoolean(data.skipOnboardingAuthFlow));
  }, []);

  useEffect(() => {
    applyUserDataToLocalState(parentUserData);
  }, [applyUserDataToLocalState, parentUserData]);

  /*
   * The profile can fetch its own Firestore document so it remains correct even
   * when App.tsx does not pass userData. A real-time listener keeps the profile
   * in sync after excavation points/settings changes elsewhere in the app.
   */
  useEffect(() => {
    const uid = auth.currentUser?.uid;

    if (!db || !uid) {
      setIsLoadingProfile(false);
      if (!parentUserData) {
        setLocalUserData(null);
        setProfileError('No authenticated Firebase user was found.');
      }
      return;
    }

    setIsLoadingProfile(true);
    setProfileError('');

    const userRef = doc(db, 'users', uid);

    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          // Keep any valid parent-provided data while we report the missing document.
          setProfileError(
            'Your Firebase authentication is active, but your profile document could not be found.',
          );
          setIsLoadingProfile(false);
          return;
        }

        applyUserDataToLocalState(snapshot.data() as UserDocument);
        setProfileError('');
        setIsLoadingProfile(false);
      },
      () => {
        setIsLoadingProfile(false);

        // Fall back to a one-time get if the listener fails and parent data is absent.
        if (!localUserData) {
          getDoc(userRef)
            .then((snapshot) => {
              if (snapshot.exists()) {
                applyUserDataToLocalState(snapshot.data() as UserDocument);
                setProfileError('');
              } else {
                setProfileError('Unable to find your Treasi profile document.');
              }
            })
            .catch(() => {
              setProfileError('Unable to load your profile. Please try again.');
            });
        }
      },
    );

    return unsubscribe;
  }, [applyUserDataToLocalState, localUserData, parentUserData]);

  const triggerPressAnimation = useCallback(
    (animValue: Animated.Value, callback?: () => void) => {
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
        callback?.();
      });
    },
    [],
  );

  const persistUserFields = useCallback(
    async (fields: Partial<UserDocument>): Promise<void> => {
      const uid = auth.currentUser?.uid ?? localUserData?.uid;

      if (!uid) {
        throw new Error('No authenticated Firebase user session found.');
      }

      if (onUpdateUserSettings) {
        await onUpdateUserSettings(fields);
      } else {
        if (!db) throw new Error('Firebase database is unavailable.');

        await updateDoc(doc(db, 'users', uid), {
          ...fields,
          updatedAt: serverTimestamp(),
        });
      }

      setLocalUserData((previous) =>
        previous
          ? {
              ...previous,
              ...fields,
            }
          : previous,
      );
    },
    [localUserData?.uid, onUpdateUserSettings],
  );

  const handleToggleChange = useCallback(
    async (
      key: SettingKey,
      value: boolean,
      setter: React.Dispatch<React.SetStateAction<boolean>>,
    ) => {
      if (isSavingSetting) return;

      const previousValue =
        key === 'hapticFeedbackEnabled'
          ? hapticTriggers
          : key === 'motionSensitivityEnabled'
            ? sensorSensitivity
            : key === 'batteryOptimizerEnabled'
              ? batteryOptimize
              : key === 'nightModeEnabled'
                ? nightFieldMode
                : key === 'telemetryEnabled'
                  ? telemetryEnabled
                  : skipOnboardingAuthFlow;

      setter(value);
      setIsSavingSetting(key);
      setProfileError('');

      try {
        await persistUserFields({ [key]: value } as Partial<UserDocument>);
      } catch (error) {
        setter(previousValue);
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to save this preference to Firestore.';
        Alert.alert('CALIBRATION ERROR', message);
      } finally {
        setIsSavingSetting(null);
      }
    },
    [
      batteryOptimize,
      hapticTriggers,
      isSavingSetting,
      nightFieldMode,
      persistUserFields,
      sensorSensitivity,
      skipOnboardingAuthFlow,
      telemetryEnabled,
    ],
  );

  const handleStartEditing = useCallback(() => {
    triggerPressAnimation(editBtnScale, () => {
      setEditingOriginalName(agentName);
      setIsEditing(true);
    });
  }, [agentName, editBtnScale, triggerPressAnimation]);

  const handleCancelEditing = useCallback(() => {
    setAgentName(editingOriginalName);
    setIsEditing(false);
  }, [editingOriginalName]);

  const handleSaveProfile = useCallback(() => {
    triggerPressAnimation(editBtnScale, async () => {
      if (isSavingProfile) return;

      const cleanUsername = sanitiseUsername(agentName);

      if (!cleanUsername) {
        Alert.alert('INVALID CALLSIGN', 'Agent callsign cannot be empty.');
        return;
      }

      if (cleanUsername.length < 2) {
        Alert.alert(
          'INVALID CALLSIGN',
          'Agent callsign must contain at least 2 characters.',
        );
        return;
      }

      const currentUser: User | null = auth.currentUser;

      try {
        setIsSavingProfile(true);
        setProfileError('');

        // Update Firebase Authentication displayName when available.
        if (currentUser && currentUser.displayName !== cleanUsername) {
          await updateProfile(currentUser, {
            displayName: cleanUsername,
          });
        }

        // Keep the Firestore username and Auth display name aligned.
        await persistUserFields({
          username: cleanUsername,
        });

        setAgentName(cleanUsername);
        setEditingOriginalName(cleanUsername);
        setIsEditing(false);
      } catch (error) {
        const friendlyMessage = getFriendlyAuthError(
          error,
          'Failed to update the user profile.',
        );

        setAgentName(editingOriginalName || agentName);
        Alert.alert('PROFILE UPDATE ERROR', friendlyMessage);
      } finally {
        setIsSavingProfile(false);
      }
    });
  }, [
    agentName,
    editBtnScale,
    editingOriginalName,
    isSavingProfile,
    persistUserFields,
    triggerPressAnimation,
  ]);

  const handleLogoutConfirmed = useCallback(() => {
    if (isLoggingOut) return;

    triggerPressAnimation(signOutBtnScale, async () => {
      try {
        setIsLoggingOut(true);

        await signOut(auth);

        // App.tsx remains responsible for changing the global screen state.
        onSignOut();
      } catch (error) {
        Alert.alert(
          'LOGOUT FAILED',
          getFriendlyAuthError(error, 'Could not sign out of the current session.'),
        );
      } finally {
        setIsLoggingOut(false);
      }
    });
  }, [isLoggingOut, onSignOut, signOutBtnScale, triggerPressAnimation]);

  const handleSignOutPress = useCallback(() => {
    if (isLoggingOut) return;

    Alert.alert(
      'TERMINATE SESSION',
      'Are you sure you want to sign out of Treasi?',
      [
        { text: 'CANCEL', style: 'cancel' },
        {
          text: 'LOGOUT',
          style: 'destructive',
          onPress: handleLogoutConfirmed,
        },
      ],
    );
  }, [handleLogoutConfirmed, isLoggingOut]);

  const currentEmail = safeString(
    localUserData?.email,
    auth.currentUser?.email ?? 'N/A',
  );

  const currentUsername =
    safeString(localUserData?.username) ||
    safeString(auth.currentUser?.displayName) ||
    agentName ||
    'UNREGISTERED_AGENT';

  const handle = useMemo(() => buildHandle(currentUsername), [currentUsername]);

  const totalPoints =
    typeof localUserData?.totalPoints === 'number' &&
    Number.isFinite(localUserData.totalPoints)
      ? localUserData.totalPoints
      : 0;

  const rank = calculateBadgeRank(totalPoints);
  const memberSince = formatMemberSince(localUserData?.createdAt);

  const accountStatus = currentFirebaseUser
    ? 'ACTIVE'
    : 'SIGNED OUT';

  const onboardingStatus = localUserData?.hasCompletedOnboarding
    ? 'ACTIVE'
    : 'PENDING';

  const isProfileLoading = isLoadingProfile || (isLoadingUserData && !localUserData);

  const renderSetting = (
    config: SettingConfig,
    value: boolean,
    setter: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    const saving = isSavingSetting === config.key;

    return (
      <View
        key={config.key}
        style={styles.toggleCard}
        accessible
        accessibilityLabel={`${config.label}. ${value ? 'On' : 'Off'}. ${config.description}`}
      >
        <View style={styles.toggleLabelGroup}>
          <Ionicons name={config.icon} size={12} color="#B08D57" />
          <View style={styles.toggleTextGroup}>
            <Text style={styles.toggleText}>{config.label}</Text>
            <Text style={styles.toggleDescription}>{config.description}</Text>
          </View>
        </View>

        {saving ? (
          <ActivityIndicator size="small" color="#A64B2A" />
        ) : (
          <Switch
            trackColor={{ false: '#161E17', true: '#A64B2A' }}
            thumbColor={value ? '#F3ECD8' : '#7A6B58'}
            ios_backgroundColor="#161E17"
            onValueChange={(nextValue) =>
              void handleToggleChange(config.key, nextValue, setter)
            }
            value={value}
            accessible
            accessibilityRole="switch"
            accessibilityLabel={config.label}
            accessibilityState={{ checked: value, disabled: !!isSavingSetting }}
          />
        )}
      </View>
    );
  };

  if (isProfileLoading && !localUserData) {
    return (
      <View style={[styles.safeAreaContainer, styles.centeredLoading]}>
        <ActivityIndicator size="large" color="#B08D57" />
        <Text style={styles.loadingText}>FETCHING AGENT PROFILE...</Text>
      </View>
    );
  }

  if (!localUserData && !currentFirebaseUser) {
    return (
      <View style={[styles.safeAreaContainer, styles.centeredLoading]}>
        <Ionicons name="person-circle-outline" size={52} color="#B08D57" />
        <Text style={styles.loadingText}>NO ACTIVE AGENT SESSION</Text>

        {onBack && (
          <TouchableOpacity
            style={styles.backButtonStandalone}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to Dashboard"
          >
            <Ionicons name="chevron-back-sharp" size={11} color="#B08D57" />
            <Text style={styles.backText}>DASHBOARD</Text>
          </TouchableOpacity>
        )}
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
        <View style={styles.leftViewport}>
          <View style={styles.cardInnerBorder}>
            <View style={styles.cardHeader}>
              <View style={styles.headerTitleGroup}>
                <Ionicons name="document-text-outline" size={13} color="#2A2420" />
                <Text style={styles.headerTitle}> FIELD IDENTITY LOG</Text>
              </View>

              <Text style={styles.headerTag}>
                UID:{' '}
                {currentUid !== 'N/A'
                  ? currentUid.substring(0, 8).toUpperCase()
                  : 'N/A'}
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
                      autoCapitalize="words"
                      autoCorrect={false}
                      editable={!isSavingProfile}
                      accessibilityRole="none"
                      accessibilityLabel="Agent Callsign Input"
                      accessibilityHint="Enter the username that will be displayed across Treasi"
                    />
                    <Text style={styles.editHint}>
                      Use 2 or more characters. Spaces are allowed.
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.agentName} numberOfLines={1}>
                      {currentUsername}
                    </Text>
                    <Text style={styles.handleText} numberOfLines={1}>
                      {handle}
                    </Text>
                  </>
                )}

                <View style={styles.badgeContainer}>
                  <Ionicons
                    name="shield-checkmark"
                    size={10}
                    color="#F3ECD8"
                    style={styles.badgeIcon}
                  />
                  <Text style={styles.badgeText}>{rank}</Text>
                </View>
              </View>
            </View>

            <View style={styles.dashedDivider} />

            {profileError ? (
              <View
                style={styles.profileErrorBox}
                accessible
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                <Ionicons name="warning-outline" size={13} color="#A64B2A" />
                <Text style={styles.profileErrorText}>{profileError}</Text>
              </View>
            ) : null}

            <View style={styles.metaGrid}>
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>MEMBER SINCE</Text>
                <Text style={styles.metaVal}>{memberSince}</Text>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>ACCOUNT STATUS</Text>
                <Text style={styles.metaVal}>{accountStatus}</Text>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>FIELD PERMIT</Text>
                <View style={styles.permitStarRow}>
                  <Ionicons name="star" size={9} color="#2A2420" />
                  <Ionicons name="star" size={9} color="#2A2420" />
                  <Ionicons name="star" size={9} color="#2A2420" />
                  <Text style={styles.metaVal}> {onboardingStatus}</Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>EXP POINTS</Text>
                <Text style={styles.metaVal}>{totalPoints.toLocaleString()} PTS</Text>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>RANK</Text>
                <Text style={styles.metaVal}>{rank}</Text>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>EMAIL</Text>
                <Text
                  style={styles.metaVal}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {currentEmail}
                </Text>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>FIREBASE UID</Text>
                <Text
                  style={styles.metaVal}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {currentUid}
                </Text>
              </View>
            </View>

            {isEditing ? (
              <View style={styles.editActionsRow}>
                <Animated.View
                  style={{ flex: 1, transform: [{ scale: editBtnScale }] }}
                >
                  <TouchableOpacity
                    style={styles.editProfileButton}
                    activeOpacity={0.8}
                    disabled={isSavingProfile}
                    onPress={handleSaveProfile}
                    accessibilityRole="button"
                    accessibilityLabel="Save identity record"
                  >
                    {isSavingProfile ? (
                      <ActivityIndicator size="small" color="#2A2420" />
                    ) : (
                      <>
                        <Ionicons
                          name="checkmark-sharp"
                          size={13}
                          color="#2A2420"
                          style={styles.btnIcon}
                        />
                        <Text style={styles.editProfileText}>SAVE IDENTITY</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </Animated.View>

                <TouchableOpacity
                  style={styles.cancelEditButton}
                  activeOpacity={0.8}
                  disabled={isSavingProfile}
                  onPress={handleCancelEditing}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel identity editing"
                >
                  <Ionicons name="close-outline" size={13} color="#2A2420" />
                  <Text style={styles.editProfileText}>CANCEL</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Animated.View style={{ transform: [{ scale: editBtnScale }] }}>
                <TouchableOpacity
                  style={styles.editProfileButton}
                  activeOpacity={0.8}
                  disabled={isSavingProfile}
                  onPress={handleStartEditing}
                  accessibilityRole="button"
                  accessibilityLabel="Edit identity details"
                  accessibilityHint="Opens the callsign editing form"
                >
                  <Ionicons
                    name="create-outline"
                    size={13}
                    color="#2A2420"
                    style={styles.btnIcon}
                  />
                  <Text style={styles.editProfileText}>EDIT IDENTITY DETAILS</Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          </View>
        </View>

        <View style={styles.rightViewport}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.panelHeaderRow}>
              <Ionicons
                name="hardware-chip-outline"
                size={11}
                color="#A64B2A"
              />
              <Text style={styles.panelTitle}> CALIBRATION ARRAY</Text>
              {(isSavingProfile || !!isSavingSetting) && (
                <ActivityIndicator
                  size="small"
                  color="#A64B2A"
                  style={{ marginLeft: 6 }}
                />
              )}
            </View>

            <View style={styles.panelDivider} />

            {renderSetting(
              SETTINGS[0],
              hapticTriggers,
              setHapticTriggers,
            )}

            {renderSetting(
              SETTINGS[1],
              sensorSensitivity,
              setSensorSensitivity,
            )}

            {renderSetting(
              SETTINGS[2],
              batteryOptimize,
              setBatteryOptimize,
            )}

            {renderSetting(
              SETTINGS[3],
              nightFieldMode,
              setNightFieldMode,
            )}

            {renderSetting(
              SETTINGS[4],
              telemetryEnabled,
              setTelemetryEnabled,
            )}

            {renderSetting(
              SETTINGS[5],
              skipOnboardingAuthFlow,
              setSkipOnboardingAuthFlow,
            )}

            <View style={styles.behaviourNote}>
              <Ionicons
                name="information-circle-outline"
                size={12}
                color="#B08D57"
              />
              <Text style={styles.behaviourNoteText}>
                Preferences are saved to your Firestore profile and remain available
                to supported application features. A setting can only change another
                screen's runtime behaviour when that feature reads the same saved value.
              </Text>
            </View>

            <Animated.View
              style={{
                transform: [{ scale: signOutBtnScale }],
              }}
            >
              <TouchableOpacity
                style={styles.signOutButton}
                activeOpacity={0.8}
                disabled={isLoggingOut}
                onPress={handleSignOutPress}
                accessibilityRole="button"
                accessibilityLabel={
                  isLoggingOut ? 'Logging out' : 'Logout Session'
                }
                accessibilityState={{ disabled: isLoggingOut }}
              >
                {isLoggingOut ? (
                  <>
                    <ActivityIndicator size="small" color="#F3ECD8" />
                    <Text style={styles.signOutText}>ENDING SESSION...</Text>
                  </>
                ) : (
                  <>
                    <Ionicons
                      name="log-out-outline"
                      size={13}
                      color="#F3ECD8"
                    />
                    <Text style={styles.signOutText}>LOGOUT SESSION</Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>

            {onBack && (
              <TouchableOpacity
                style={styles.backButton}
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Back to Dashboard"
              >
                <Ionicons
                  name="chevron-back-sharp"
                  size={11}
                  color="#B08D57"
                />
                <Text style={styles.backText}> DASHBOARD</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

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
    paddingHorizontal: 24,
  },
  loadingText: {
    fontFamily: fontMonospace,
    color: '#E8DCC0',
    fontSize: 11,
    marginTop: 10,
    letterSpacing: 1,
    textAlign: 'center',
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
    minHeight: 0,
  },
  cardInnerBorder: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2A2420',
    padding: 8,
    justifyContent: 'space-between',
    minHeight: 0,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
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
    minWidth: 0,
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
  editHint: {
    color: '#6E6152',
    fontFamily: fontMonospace,
    fontSize: 7,
    marginTop: 2,
  },
  textInput: {
    fontFamily: fontMonospace,
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#2A2420',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 4,
    fontSize: 10,
    color: '#2A2420',
    marginBottom: 2,
    minHeight: 34,
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
  profileErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#A64B2A',
    backgroundColor: '#F3ECD8',
    padding: 6,
    borderRadius: 4,
    marginBottom: 5,
  },
  profileErrorText: {
    flex: 1,
    color: '#A64B2A',
    fontFamily: fontMonospace,
    fontSize: 7.5,
    fontWeight: 'bold',
  },
  metaGrid: {
    marginVertical: 2,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  metaKey: {
    fontFamily: fontMonospace,
    color: '#2A2420',
    fontSize: 8.5,
    fontWeight: '600',
    letterSpacing: 0.5,
    flexShrink: 0,
  },
  metaVal: {
    fontFamily: fontMonospace,
    color: '#2A2420',
    fontSize: 8.5,
    fontWeight: 'bold',
    maxWidth: '58%',
    textAlign: 'right',
  },
  permitStarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editActionsRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 3,
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
    minHeight: 30,
  },
  cancelEditButton: {
    flex: 0.42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#8A7B66',
    backgroundColor: '#D9C8A9',
    paddingVertical: 5,
    borderRadius: 3,
    minHeight: 30,
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
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: 5,
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
    paddingVertical: 3,
    marginBottom: 4,
    minHeight: 44,
  },
  toggleLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  toggleTextGroup: {
    flex: 1,
    marginLeft: 4,
    paddingRight: 6,
  },
  toggleText: {
    fontFamily: fontMonospace,
    color: '#E8DCC0',
    fontSize: 7.5,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  toggleDescription: {
    fontFamily: fontMonospace,
    color: '#B08D57',
    fontSize: 6.5,
    marginTop: 1,
    lineHeight: 9,
  },
  behaviourNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    backgroundColor: '#1E281F',
    borderWidth: 1,
    borderColor: '#3A4B3C',
    padding: 6,
    borderRadius: 4,
    marginTop: 2,
    marginBottom: 4,
  },
  behaviourNoteText: {
    flex: 1,
    fontFamily: fontMonospace,
    color: '#B08D57',
    fontSize: 6.5,
    lineHeight: 9,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A64B2A',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 6,
    borderRadius: 4,
    marginTop: 3,
    minHeight: 36,
    gap: 4,
  },
  signOutText: {
    fontFamily: fontMonospace,
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 8.5,
    letterSpacing: 0.8,
  },
  backButton: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 5,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
    minHeight: 30,
  },
  backText: {
    fontFamily: fontMonospace,
    color: '#B08D57',
    fontSize: 8,
    fontWeight: 'bold',
  },
  backButtonStandalone: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 7,
    paddingHorizontal: 18,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 42,
  },
  navBarContainer: {
    marginTop: 3,
  },
});
