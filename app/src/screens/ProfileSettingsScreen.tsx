import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ScrollView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FieldNavBar, NavigationTab } from '../components/FieldNavBar';

interface ProfileData {
  agentName: string;
  handle: string;
  badge: string;
  memberSince: string;
  permitStatus: string;
  cachesFound: number;
  sector: string;
}

interface Props {
  onBack?: () => void;
  onSignOut: () => void;
  onNavigate?: (tab: NavigationTab) => void;
  profileData?: ProfileData;
}

export const ProfileSettingsScreen: React.FC<Props> = ({
  onBack,
  onSignOut,
  onNavigate,
  profileData = {
    agentName: 'A. FINCH',
    handle: '@ranger_finch',
    badge: 'TRAILBLAZER III',
    memberSince: 'MAR 1951',
    permitStatus: 'ACTIVE',
    cachesFound: 128,
    sector: 'SHASTA NF',
  },
}) => {
  const insets = useSafeAreaInsets();

  // Calibration Array Toggles - Strictly Default OFF (false)
  const [hapticTriggers, setHapticTriggers] = useState(false);
  const [sensorSensitivity, setSensorSensitivity] = useState(false);
  const [batteryOptimize, setBatteryOptimize] = useState(false);
  const [nightFieldMode, setNightFieldMode] = useState(false);

  // Profile Editing State
  const [isEditing, setIsEditing] = useState(false);
  const [agentName, setAgentName] = useState(profileData.agentName);
  const [handle, setHandle] = useState(profileData.handle);

  const handleSaveProfile = () => {
    setIsEditing(false);
    // TODO: Write updated agentName and handle to Firebase Firestore 'users' collection
  };

  return (
    <View
      style={[
        styles.safeAreaContainer,
        {
          paddingLeft: Math.max(insets.left, 16),
          paddingRight: Math.max(insets.right, 16),
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      <View style={styles.splitWrapper}>
        {/* LEFT VIEWPORT: FIELD IDENTITY CARD (60%) */}
        <View style={styles.leftViewport}>
          <View style={styles.cardInnerBorder}>
            <View style={styles.cardHeader}>
              <Text style={styles.headerTitle}>FIELD IDENTITY LOG</Text>
              <Text style={styles.headerTag}>T-51</Text>
            </View>

            {/* IDENTITY MAIN ROW */}
            <View style={styles.identityRow}>
              <View style={styles.avatarBox}>
                <Ionicons name="person" size={36} color="#E8DCC0" />
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
                    />
                    <TextInput
                      style={[styles.textInput, styles.handleInput]}
                      value={handle}
                      onChangeText={setHandle}
                      placeholder="@handle"
                      placeholderTextColor="#8C7A6B"
                      autoCapitalize="none"
                    />
                  </View>
                ) : (
                  <>
                    <Text style={styles.agentName}>{agentName}</Text>
                    <Text style={styles.handleText}>{handle}</Text>
                  </>
                )}

                <View style={styles.badgeContainer}>
                  <Text style={styles.badgeText}>{profileData.badge}</Text>
                </View>
              </View>
            </View>

            <View style={styles.dashedDivider} />

            {/* METADATA FIELD LOG */}
            <View style={styles.metaGrid}>
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>MEMBER SINCE</Text>
                <Text style={styles.metaVal}>{profileData.memberSince}</Text>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>FIELD PERMIT</Text>
                <View style={styles.permitStarRow}>
                  <Ionicons name="star" size={9} color="#2A2420" />
                  <Ionicons name="star" size={9} color="#2A2420" />
                  <Ionicons name="star" size={9} color="#2A2420" />
                  <Text style={styles.metaVal}> {profileData.permitStatus}</Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>CACHES FOUND</Text>
                <Text style={styles.metaVal}>{profileData.cachesFound}</Text>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>SECTOR</Text>
                <Text style={styles.metaVal}>{profileData.sector}</Text>
              </View>
            </View>

            {/* EDIT PROFILE ACTION BUTTON */}
            <TouchableOpacity
              style={styles.editProfileButton}
              activeOpacity={0.8}
              onPress={isEditing ? handleSaveProfile : () => setIsEditing(true)}
            >
              <Ionicons
                name={isEditing ? 'checkmark-sharp' : 'create-outline'}
                size={12}
                color="#2A2420"
                style={styles.btnIcon}
              />
              <Text style={styles.editProfileText}>
                {isEditing ? 'SAVE IDENTITY RECORD' : 'EDIT IDENTITY DETAILS'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* RIGHT VIEWPORT: CALIBRATION ARRAY & SYSTEM CONTROLS (40%) */}
        <View style={styles.rightViewport}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* PANEL HEADER */}
            <View style={styles.panelHeaderRow}>
              <Ionicons name="star" size={10} color="#A64B2A" />
              <Text style={styles.panelTitle}> CALIBRATION ARRAY</Text>
            </View>
            <View style={styles.panelDivider} />

            {/* TOGGLE 1: HAPTIC TRIGGERS */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelGroup}>
                <Ionicons name="hardware-chip-outline" size={14} color="#B08D57" />
                <Text style={styles.toggleText}>HAPTIC TRIGGERS</Text>
              </View>
              <Switch
                trackColor={{ false: '#161E17', true: '#A64B2A' }}
                thumbColor={hapticTriggers ? '#F3ECD8' : '#7A6B58'}
                ios_backgroundColor="#161E17"
                onValueChange={setHapticTriggers}
                value={hapticTriggers}
              />
            </View>

            {/* TOGGLE 2: SENSOR SENSITIVITY */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelGroup}>
                <Ionicons name="flash-outline" size={14} color="#B08D57" />
                <Text style={styles.toggleText}>SENSOR SENSITIVITY</Text>
              </View>
              <Switch
                trackColor={{ false: '#161E17', true: '#A64B2A' }}
                thumbColor={sensorSensitivity ? '#F3ECD8' : '#7A6B58'}
                ios_backgroundColor="#161E17"
                onValueChange={setSensorSensitivity}
                value={sensorSensitivity}
              />
            </View>

            {/* TOGGLE 3: BATTERY OPTIMIZE */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelGroup}>
                <Ionicons name="battery-charging-outline" size={14} color="#B08D57" />
                <Text style={styles.toggleText}>BATTERY OPTIMIZE</Text>
              </View>
              <Switch
                trackColor={{ false: '#161E17', true: '#A64B2A' }}
                thumbColor={batteryOptimize ? '#F3ECD8' : '#7A6B58'}
                ios_backgroundColor="#161E17"
                onValueChange={setBatteryOptimize}
                value={batteryOptimize}
              />
            </View>

            {/* TOGGLE 4: NIGHT FIELD MODE */}
            <View style={styles.toggleCard}>
              <View style={styles.toggleLabelGroup}>
                <Ionicons name="moon-outline" size={14} color="#B08D57" />
                <Text style={styles.toggleText}>NIGHT FIELD MODE</Text>
              </View>
              <Switch
                trackColor={{ false: '#161E17', true: '#A64B2A' }}
                thumbColor={nightFieldMode ? '#F3ECD8' : '#7A6B58'}
                ios_backgroundColor="#161E17"
                onValueChange={setNightFieldMode}
                value={nightFieldMode}
              />
            </View>

            {/* LOGOUT SESSION BUTTON */}
            <TouchableOpacity
              style={styles.signOutButton}
              activeOpacity={0.8}
              onPress={onSignOut}
            >
              <Ionicons name="log-out-outline" size={14} color="#F3ECD8" />
              <Text style={styles.signOutText}>LOGOUT SESSION</Text>
            </TouchableOpacity>

            {onBack && (
              <TouchableOpacity style={styles.backButton} onPress={onBack}>
                <Text style={styles.backText}>‹ BACK TO DASHBOARD</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* EMBEDDED FIELD NAVIGATION BAR */}
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
  splitWrapper: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#B08D57',
  },
  /* LEFT VIEWPORT (PARCHMENT CARD) */
  leftViewport: {
    flex: 0.58,
    backgroundColor: '#E8DCC0',
    padding: 12,
  },
  cardInnerBorder: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2A2420',
    padding: 12,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: fontMonospace,
    color: '#2A2420',
    fontWeight: 'bold',
    fontSize: 13,
    letterSpacing: 1.5,
  },
  headerTag: {
    fontFamily: fontMonospace,
    color: '#2A2420',
    fontSize: 11,
    fontWeight: '600',
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  avatarBox: {
    width: 58,
    height: 58,
    backgroundColor: '#2C3B2E',
    borderWidth: 2,
    borderColor: '#B08D57',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  identityDetails: {
    flex: 1,
  },
  agentName: {
    fontFamily: fontMonospace,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 1,
  },
  handleText: {
    fontFamily: fontMonospace,
    fontSize: 11,
    color: '#5C5248',
    marginBottom: 6,
  },
  editInputGroup: {
    marginBottom: 4,
  },
  textInput: {
    fontFamily: fontMonospace,
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#2A2420',
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 12,
    color: '#2A2420',
    marginBottom: 4,
  },
  handleInput: {
    fontSize: 10,
  },
  badgeContainer: {
    alignSelf: 'flex-start',
    backgroundColor: '#A64B2A',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  badgeText: {
    fontFamily: fontMonospace,
    color: '#F3ECD8',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  dashedDivider: {
    borderStyle: 'dashed',
    borderBottomWidth: 1,
    borderColor: '#2A2420',
    marginVertical: 6,
    opacity: 0.6,
  },
  metaGrid: {
    marginVertical: 4,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  metaKey: {
    fontFamily: fontMonospace,
    color: '#2A2420',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  metaVal: {
    fontFamily: fontMonospace,
    color: '#2A2420',
    fontSize: 10,
    fontWeight: 'bold',
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
    paddingVertical: 6,
    borderRadius: 3,
    marginTop: 4,
  },
  btnIcon: {
    marginRight: 4,
  },
  editProfileText: {
    fontFamily: fontMonospace,
    fontSize: 9,
    fontWeight: 'bold',
    color: '#2A2420',
    letterSpacing: 1,
  },

  /* RIGHT VIEWPORT (DARK CONSOLE) */
  rightViewport: {
    flex: 0.42,
    backgroundColor: '#2C3B2E',
    borderLeftWidth: 2,
    borderColor: '#B08D57',
    padding: 10,
    justifyContent: 'space-between',
  },
  scrollContent: {
    paddingBottom: 8,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  panelTitle: {
    fontFamily: fontMonospace,
    color: '#E8DCC0',
    fontWeight: 'bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  panelDivider: {
    height: 1,
    backgroundColor: '#B08D57',
    opacity: 0.4,
    marginVertical: 6,
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E281F',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
  },
  toggleLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleText: {
    fontFamily: fontMonospace,
    color: '#E8DCC0',
    fontSize: 8.5,
    fontWeight: 'bold',
    letterSpacing: 0.8,
    marginLeft: 6,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A64B2A',
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  signOutText: {
    fontFamily: fontMonospace,
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 10,
    letterSpacing: 1,
    marginLeft: 6,
  },
  backButton: {
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 6,
  },
  backText: {
    fontFamily: fontMonospace,
    color: '#B08D57',
    fontSize: 9,
    fontWeight: 'bold',
  },
  navBarContainer: {
    marginTop: 6,
  },
});