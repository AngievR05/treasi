import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Animated, { FadeInLeft, FadeInRight, Layout } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

interface ProfileSettingsScreenProps {
  onBack: () => void;
  onSignOut: () => void;
  onViewOnboarding: () => void;
}

export const ProfileSettingsScreen: React.FC<ProfileSettingsScreenProps> = ({
  onBack,
  onSignOut,
  onViewOnboarding,
}) => {
  const insets = useSafeAreaInsets();

  // User Data State
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);

  // Field Identity Fields
  const [username, setUsername] = useState<string>('A. FINCH');
  const [handle, setHandle] = useState<string>('ranger_finch');
  const [sector, setSector] = useState<string>('SHASTA NF');
  const [rank, setRank] = useState<string>('TRAILBLAZER III');
  const [cachesFound, setCachesFound] = useState<number>(0);
  const [memberSince, setMemberSince] = useState<string>('AUG 2026');

  // Calibration Toggles (Default OFF)
  const [hapticTriggers, setHapticTriggers] = useState<boolean>(false);
  const [sensorSensitivity, setSensorSensitivity] = useState<boolean>(false);
  const [batteryOptimize, setBatteryOptimize] = useState<boolean>(false);
  const [nightFieldMode, setNightFieldMode] = useState<boolean>(false);

  // Sync with Firestore in real-time
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setLoading(false);
      return;
    }

    const userDocRef = doc(db, 'users', currentUser.uid);
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.username) setUsername(data.username);
          if (data.handle) setHandle(data.handle);
          if (data.sector) setSector(data.sector);
          if (data.rank) setRank(data.rank);
          if (data.cachesFound !== undefined) setCachesFound(data.cachesFound);
          if (data.createdAt) {
            const dateObj = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
            const month = dateObj.toLocaleString('en-US', { month: 'short' }).toUpperCase();
            const year = dateObj.getFullYear();
            setMemberSince(`${month} ${year}`);
          }
          if (data.settings) {
            setHapticTriggers(!!data.settings.hapticTriggers);
            setSensorSensitivity(!!data.settings.sensorSensitivity);
            setBatteryOptimize(!!data.settings.batteryOptimize);
            setNightFieldMode(!!data.settings.nightFieldMode);
          }
        }
        setLoading(false);
      },
      (error) => {
        console.error('Firestore snapshot error:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Save profile updates to Firestore
  const handleSaveProfile = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    setSaving(true);
    try {
      const userDocRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userDocRef, {
        username: username.toUpperCase(),
        handle: handle.toLowerCase(),
        sector: sector.toUpperCase(),
      });
      if (hapticTriggers) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setIsEditing(false);
    } catch (err) {
      Alert.alert('Save Failed', 'Could not update field identity log to Firestore.');
    } finally {
      setSaving(false);
    }
  };

  // Toggle handlers with haptic feedback
  const toggleSetting = async (
    key: 'hapticTriggers' | 'sensorSensitivity' | 'batteryOptimize' | 'nightFieldMode',
    currentVal: boolean,
    setter: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    const newVal = !currentVal;
    setter(newVal);

    if (hapticTriggers) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        const userDocRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userDocRef, {
          [`settings.${key}`]: newVal,
        });
      } catch (err) {
        console.warn('Failed to persist setting update:', err);
      }
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#B08D57" />
        <Text style={styles.loadingText}>CALIBRATING FIELD IDENTITY...</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.outerChassis,
        {
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: Math.max(insets.bottom, 8),
          paddingLeft: Math.max(insets.left, 12),
          paddingRight: Math.max(insets.right, 12),
        },
      ]}
    >
      <View style={styles.splitWrapper}>
        {/* LEFT VIEWPORT: 60% FIELD IDENTITY CARD */}
        <Animated.View entering={FadeInLeft.duration(400)} style={styles.leftViewport}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.headerTitle}>FIELD IDENTITY LOG</Text>
            <Text style={styles.headerId}>T-51</Text>
          </View>

          <View style={styles.identityBody}>
            <View style={styles.avatarBox}>
              <Ionicons name="person" size={42} color="#E8DCC0" />
            </View>

            <View style={styles.identityDetails}>
              {isEditing ? (
                <>
                  <TextInput
                    style={styles.editInput}
                    value={username}
                    onChangeText={setUsername}
                    placeholder="AGENT NAME"
                    placeholderTextColor="#7A6E5D"
                    autoCapitalize="characters"
                  />
                  <TextInput
                    style={styles.editInputHandle}
                    value={handle}
                    onChangeText={setHandle}
                    placeholder="handle"
                    placeholderTextColor="#7A6E5D"
                    autoCapitalize="none"
                  />
                </>
              ) : (
                <>
                  <Text style={styles.agentName}>{username}</Text>
                  <Text style={styles.agentHandle}>@{handle}</Text>
                </>
              )}
              <View style={styles.badgeContainer}>
                <Text style={styles.badgeText}>{rank}</Text>
              </View>
            </View>
          </View>

          <View style={styles.dividerLine} />

          {/* METRICS TABLE */}
          <View style={styles.specsContainer}>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>MEMBER SINCE</Text>
              <Text style={styles.specValue}>{memberSince}</Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>FIELD PERMIT</Text>
              <View style={styles.permitStatus}>
                <Ionicons name="star" size={10} color="#2A2420" />
                <Ionicons name="star" size={10} color="#2A2420" />
                <Ionicons name="star" size={10} color="#2A2420" />
                <Text style={styles.specValueBold}> ACTIVE</Text>
              </View>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>CACHES FOUND</Text>
              <Text style={styles.specValue}>{cachesFound}</Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>SECTOR</Text>
              {isEditing ? (
                <TextInput
                  style={styles.editInputSector}
                  value={sector}
                  onChangeText={setSector}
                  autoCapitalize="characters"
                />
              ) : (
                <Text style={styles.specValue}>{sector}</Text>
              )}
            </View>
          </View>

          {/* EDIT & SAVE CONTROLS */}
          <View style={styles.identityActionRow}>
            {isEditing ? (
              <TouchableOpacity
                style={[styles.actionButton, styles.saveButton]}
                onPress={handleSaveProfile}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#E8DCC0" size="small" />
                ) : (
                  <>
                    <Feather name="check" size={14} color="#E8DCC0" />
                    <Text style={styles.saveBtnText}> SAVE LOG</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.actionButton, styles.editButton]}
                onPress={() => setIsEditing(true)}
              >
                <Feather name="edit-2" size={12} color="#2A2420" />
                <Text style={styles.editBtnText}> EDIT PERMIT DATA</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>

        {/* RIGHT VIEWPORT: 40% CALIBRATION ARRAY */}
        <Animated.View entering={FadeInRight.duration(400)} style={styles.rightViewport}>
          <Text style={styles.panelTitle}>CALIBRATION ARRAY</Text>

          <View style={styles.togglesList}>
            {/* TOGGLE 1 */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelRow}>
                <Feather name="smartphone" size={14} color="#B08D57" />
                <Text style={styles.toggleText}> HAPTIC TRIGGERS</Text>
              </View>
              <Switch
                trackColor={{ false: '#1C261E', true: '#B08D57' }}
                thumbColor={hapticTriggers ? '#E8DCC0' : '#4F5D51'}
                onValueChange={() =>
                  toggleSetting('hapticTriggers', hapticTriggers, setHapticTriggers)
                }
                value={hapticTriggers}
              />
            </View>

            {/* TOGGLE 2 */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelRow}>
                <Feather name="zap" size={14} color="#B08D57" />
                <Text style={styles.toggleText}> SENSOR SENSITIVITY</Text>
              </View>
              <Switch
                trackColor={{ false: '#1C261E', true: '#B08D57' }}
                thumbColor={sensorSensitivity ? '#E8DCC0' : '#4F5D51'}
                onValueChange={() =>
                  toggleSetting(
                    'sensorSensitivity',
                    sensorSensitivity,
                    setSensorSensitivity
                  )
                }
                value={sensorSensitivity}
              />
            </View>

            {/* TOGGLE 3 */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelRow}>
                <Feather name="battery-charging" size={14} color="#B08D57" />
                <Text style={styles.toggleText}> BATTERY OPTIMIZE</Text>
              </View>
              <Switch
                trackColor={{ false: '#1C261E', true: '#B08D57' }}
                thumbColor={batteryOptimize ? '#E8DCC0' : '#4F5D51'}
                onValueChange={() =>
                  toggleSetting('batteryOptimize', batteryOptimize, setBatteryOptimize)
                }
                value={batteryOptimize}
              />
            </View>

            {/* TOGGLE 4 */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelRow}>
                <Feather name="moon" size={14} color="#B08D57" />
                <Text style={styles.toggleText}> NIGHT FIELD MODE</Text>
              </View>
              <Switch
                trackColor={{ false: '#1C261E', true: '#B08D57' }}
                thumbColor={nightFieldMode ? '#E8DCC0' : '#4F5D51'}
                onValueChange={() =>
                  toggleSetting('nightFieldMode', nightFieldMode, setNightFieldMode)
                }
                value={nightFieldMode}
              />
            </View>
          </View>

          {/* ACTION BUTTONS */}
          <View style={styles.rightActionStack}>
            <TouchableOpacity style={styles.briefingButton} onPress={onViewOnboarding}>
              <Ionicons name="book-outline" size={14} color="#E8DCC0" />
              <Text style={styles.briefingText}> REVIEW FIELD BRIEFING</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.signOutButton} onPress={onSignOut}>
              <Feather name="log-out" size={14} color="#E8DCC0" />
              <Text style={styles.signOutText}> LOGOUT SESSION</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.backButton} onPress={onBack}>
              <Ionicons name="chevron-back" size={14} color="#B08D57" />
              <Text style={styles.backText}> BACK TO FIELD</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerChassis: { flex: 1, backgroundColor: '#1A241C' },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1A241C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#B08D57',
    fontWeight: 'bold',
    marginTop: 12,
    letterSpacing: 1.5,
    fontSize: 12,
  },
  splitWrapper: { flex: 1, flexDirection: 'row', borderRadius: 8, overflow: 'hidden' },

  /* LEFT VIEWPORT (60%) */
  leftViewport: {
    flex: 0.6,
    backgroundColor: '#E8DCC0',
    padding: 16,
    justifyContent: 'space-between',
    borderRightWidth: 3,
    borderColor: '#B08D57',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#2A2420',
    fontWeight: 'bold',
    fontSize: 15,
    letterSpacing: 1.2,
  },
  headerId: { color: '#7A6E5D', fontWeight: 'bold', fontSize: 13 },
  identityBody: { flexDirection: 'row', marginTop: 10, alignItems: 'center' },
  avatarBox: {
    width: 64,
    height: 64,
    backgroundColor: '#2C3B2E',
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#B08D57',
    justifyContent: 'center',
    alignItems: 'center',
  },
  identityDetails: { marginLeft: 16, flex: 1 },
  agentName: { color: '#2A2420', fontSize: 20, fontWeight: 'bold', letterSpacing: 1 },
  agentHandle: { color: '#7A6E5D', fontSize: 12, marginBottom: 6 },
  badgeContainer: {
    backgroundColor: '#A64B2A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 3,
    alignSelf: 'flex-start',
  },
  badgeText: { color: '#E8DCC0', fontWeight: 'bold', fontSize: 10, letterSpacing: 1 },
  dividerLine: {
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#B08D57',
    marginVertical: 10,
  },
  specsContainer: { marginVertical: 4 },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 3,
  },
  specLabel: { color: '#7A6E5D', fontSize: 11, fontWeight: 'bold', letterSpacing: 1 },
  specValue: { color: '#2A2420', fontSize: 12, fontWeight: 'bold' },
  specValueBold: { color: '#2A2420', fontSize: 11, fontWeight: 'bold' },
  permitStatus: { flexDirection: 'row', alignItems: 'center' },
  identityActionRow: { alignItems: 'flex-end', marginTop: 6 },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  editButton: { borderWidth: 1, borderColor: '#2A2420' },
  editBtnText: { color: '#2A2420', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  saveButton: { backgroundColor: '#2C3B2E' },
  saveBtnText: { color: '#E8DCC0', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  editInput: {
    borderBottomWidth: 1,
    borderColor: '#A64B2A',
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2A2420',
    paddingVertical: 2,
  },
  editInputHandle: {
    borderBottomWidth: 1,
    borderColor: '#A64B2A',
    fontSize: 12,
    color: '#7A6E5D',
    paddingVertical: 2,
  },
  editInputSector: {
    borderBottomWidth: 1,
    borderColor: '#A64B2A',
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2A2420',
    minWidth: 90,
    textAlign: 'right',
  },

  /* RIGHT VIEWPORT (40%) */
  rightViewport: {
    flex: 0.4,
    backgroundColor: '#2C3B2E',
    padding: 16,
    justifyContent: 'space-between',
  },
  panelTitle: {
    color: '#E8DCC0',
    fontWeight: 'bold',
    fontSize: 14,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  togglesList: { flex: 1, justifyContent: 'center' },
  toggleCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E2920',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginVertical: 4,
  },
  toggleLabelRow: { flexDirection: 'row', alignItems: 'center' },
  toggleText: { color: '#E8DCC0', fontSize: 9, fontWeight: 'bold', letterSpacing: 0.8 },
  rightActionStack: { marginTop: 8, gap: 6 },
  briefingButton: {
    backgroundColor: '#B08D57',
    paddingVertical: 8,
    borderRadius: 4,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  briefingText: { color: '#1A241C', fontWeight: 'bold', fontSize: 10, letterSpacing: 1 },
  signOutButton: {
    backgroundColor: '#A64B2A',
    paddingVertical: 8,
    borderRadius: 4,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  signOutText: { color: '#E8DCC0', fontWeight: 'bold', fontSize: 10, letterSpacing: 1 },
  backButton: {
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  backText: { color: '#B08D57', fontWeight: 'bold', fontSize: 10, letterSpacing: 1 },
});