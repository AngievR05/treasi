import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Pressable,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeInLeft,
  FadeInRight,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Path, Circle, Polyline } from 'react-native-svg';
import { FieldNavBar, NavigationTab } from '../components/FieldNavBar';

const StarIcon = ({ color = '#A64B2A', size = 12 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </Svg>
);

const UserPlusIcon = ({ color = '#E8DCC0', size = 16 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <Circle cx="8.5" cy="7" r="4" />
    <Path d="M20 8v6M23 11h-6" />
  </Svg>
);

const CheckIcon = ({ color = '#4CAF50', size = 16 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <Polyline points="20 6 9 17 4 12" />
  </Svg>
);

const SendIcon = ({ color = '#E8DCC0', size = 16 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </Svg>
);

const CloseIcon = ({ color = '#B08D57', size = 18 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M18 6L6 18M6 6l12 12" />
  </Svg>
);

interface ExplorerEntry {
  rank: string;
  name: string;
  points: string;
  isUser?: boolean;
}

interface NearbyExplorer {
  id: string;
  name: string;
  initial: string;
  distance: string;
  isOnline: boolean;
  friendStatus: 'none' | 'pending' | 'friend';
}

interface Props {
  onBack?: () => void;
  onNavigate?: (tab: string) => void;
}

export const LeaderboardScreen: React.FC<Props> = ({ onNavigate }) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Active Navigation State
  const currentTab: NavigationTab = 'LEADERBOARD';

  // Adding Friends
  const [telegramModalVisible, setTelegramModalVisible] = useState(false);
  const [friendModalVisible, setFriendModalVisible] = useState(false);
  const [telegramText, setTelegramText] = useState('');
  const [searchAgentTag, setSearchAgentTag] = useState('');

  // Field Manifest Data
  const [manifest] = useState<ExplorerEntry[]>([
    { rank: '01', name: 'WILDER_WREN', points: '4,860' },
    { rank: '02', name: 'SILENT_ELK', points: '3,920' },
    { rank: '03', name: 'RANGER_JACK', points: '3,110' },
    { rank: '04', name: 'YOU - T-51', points: '2,340', isUser: true },
    { rank: '05', name: 'PINE_MARTEN', points: '1,980' },
    { rank: '06', name: 'DUSTY_MILLER', points: '1,640' },
    { rank: '07', name: 'CREEK_FOX', points: '1,205' },
  ]);

  // Nearby Explorers Data
  const [nearbyExplorers, setNearbyExplorers] = useState<NearbyExplorer[]>([
    { id: '1', name: 'RANGER_JACK', initial: 'R', distance: '200 m', isOnline: true, friendStatus: 'friend' },
    { id: '2', name: 'WILDER_WREN', initial: 'W', distance: '400 m', isOnline: true, friendStatus: 'none' },
    { id: '3', name: 'PINE_MARTEN', initial: 'P', distance: '600 m', isOnline: true, friendStatus: 'pending' },
  ]);

  // Friend Request Toggle
  const handleToggleFriend = (id: string) => {
    setNearbyExplorers((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const nextStatus = item.friendStatus === 'none' ? 'pending' : item.friendStatus === 'pending' ? 'friend' : 'none';
          return { ...item, friendStatus: nextStatus };
        }
        return item;
      })
    );
  };

  // Animated CTA Button Spring
  const buttonScale = useSharedValue(1);
  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.96);
  };
  const handlePressOut = () => {
    buttonScale.value = withSpring(1);
  };

  return (
    <View
      style={[
        styles.splitWrapper,
        {
          paddingLeft: Math.max(insets.left, 12),
          paddingRight: Math.max(insets.right, 12),
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      <Animated.View entering={FadeInLeft.duration(600)} style={styles.leftViewport}>
        <View style={styles.ledgerHeader}>
          <StarIcon color="#A64B2A" size={14} />
          <Text style={styles.header}>FIELD MANIFEST</Text>
          <StarIcon color="#A64B2A" size={14} />
        </View>
        <Text style={styles.subHeader}>EXCAVATION POINTS LEDGER · SHASTA SECTOR</Text>

        <View style={styles.tableHeader}>
          <Text style={[styles.colHeader, { flex: 0.15 }]}>NO.</Text>
          <Text style={[styles.colHeader, { flex: 0.55 }]}>EXPLORER</Text>
          <Text style={[styles.colHeader, { flex: 0.3, textAlign: 'right' }]}>POINTS</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.ledgerList}>
          {manifest.map((item, index) => (
            <Animated.View
              key={item.rank}
              entering={FadeInDown.delay(index * 60).duration(400)}
              style={[styles.rowContainer, item.isUser && styles.rowHighlight]}
            >
              <Text style={[styles.rowText, item.isUser && styles.rowHighlightText, { flex: 0.15 }]}>{item.rank}</Text>
              <Text style={[styles.rowText, item.isUser && styles.rowHighlightText, { flex: 0.55 }]} numberOfLines={1}>
                {item.name}
              </Text>

              {/* Dot Leader Fill */}
              <View style={styles.dotLeaderContainer}>
                <Text style={styles.dotLeader} numberOfLines={1}>
                  ...................................
                </Text>
              </View>

              <Text style={[styles.rowText, item.isUser && styles.rowHighlightText, { flex: 0.3, textAlign: 'right' }]}>
                {item.points}
              </Text>
            </Animated.View>
          ))}
        </ScrollView>
      </Animated.View>

      <Animated.View entering={FadeInRight.duration(600)} style={styles.rightViewport}>
        <View style={styles.rightHeaderRow}>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <StarIcon color="#B08D57" size={10} />
              <Text style={styles.panelTitle}>NEARBY EXPLORERS</Text>
            </View>
            <Text style={styles.subText}>Global & Local Field Units</Text>
          </View>

          {/* Add Friend Manual Search Trigger */}
          <TouchableOpacity style={styles.iconAddButton} onPress={() => setFriendModalVisible(true)}>
            <UserPlusIcon color="#B08D57" size={16} />
          </TouchableOpacity>
        </View>

        {/* Nearby Cards Stream */}
        <ScrollView style={styles.cardsContainer} showsVerticalScrollIndicator={false}>
          {nearbyExplorers.map((item, idx) => (
            <Animated.View key={item.id} entering={FadeInRight.delay(idx * 100).duration(400)} style={styles.explorerCard}>
              <View style={styles.cardLeft}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>{item.initial}</Text>
                </View>
                <View>
                  <Text style={styles.explorerName}>{item.name}</Text>
                  <Text style={styles.explorerMeta}>
                    {item.distance} · {item.isOnline ? 'ONLINE' : 'OFFLINE'}
                  </Text>
                </View>
              </View>

              <View style={styles.cardRight}>
                {/* Online Indicator */}
                {item.isOnline && <View style={styles.onlineDot} />}

                {/* Friend State Action */}
                <TouchableOpacity style={styles.friendActionButton} onPress={() => handleToggleFriend(item.id)}>
                  {item.friendStatus === 'friend' && <CheckIcon color="#4CAF50" size={14} />}
                  {item.friendStatus === 'pending' && <Text style={styles.pendingText}>REQ</Text>}
                  {item.friendStatus === 'none' && <UserPlusIcon color="#2C3B2E" size={14} />}
                </TouchableOpacity>
              </View>
            </Animated.View>
          ))}
        </ScrollView>

        <Animated.View style={[animatedButtonStyle, { marginBottom: 10 }]}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={styles.dispatchButton}
            onPress={() => setTelegramModalVisible(false)}
          >
            <Text style={styles.dispatchText}>DISPATCH TELEGRAM</Text>
          </TouchableOpacity>
        </Animated.View>

        <FieldNavBar currentTab={currentTab} onNavigate={onNavigate} />
      </Animated.View>

      <Modal visible={telegramModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setTelegramModalVisible(false)}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>BROADCAST TELEGRAM</Text>
              <TouchableOpacity onPress={() => setTelegramModalVisible(false)}>
                <CloseIcon color="#B08D57" size={18} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>Send encrypted note to nearby active field agents.</Text>

            <TextInput
              style={styles.telegramInput}
              placeholder="Type dispatch message..."
              placeholderTextColor="#8A7B66"
              multiline
              value={telegramText}
              onChangeText={setTelegramText}
            />

            <TouchableOpacity
              style={styles.sendButton}
              onPress={() => {
                setTelegramText('');
                setTelegramModalVisible(false);
              }}
            >
              <SendIcon color="#F3ECD8" size={16} />
              <Text style={styles.sendButtonText}>TRANSMIT SIGNAL</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={friendModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setFriendModalVisible(false)}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>LINK NEW EXPLORER</Text>
              <TouchableOpacity onPress={() => setFriendModalVisible(false)}>
                <CloseIcon color="#B08D57" size={18} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>Enter agent callsign tag (e.g., AGENT_71)</Text>

            <TextInput
              style={styles.tagInput}
              placeholder="AGENT_CALLSIGN"
              placeholderTextColor="#8A7B66"
              autoCapitalize="characters"
              value={searchAgentTag}
              onChangeText={setSearchAgentTag}
            />

            <TouchableOpacity
              style={styles.sendButton}
              onPress={() => {
                setSearchAgentTag('');
                setFriendModalVisible(false);
              }}
            >
              <UserPlusIcon color="#F3ECD8" size={16} />
              <Text style={styles.sendButtonText}>SEND LINK REQUEST</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  splitWrapper: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#1C281E',
  },
  leftViewport: {
    flex: 0.6,
    backgroundColor: '#E8DCC0',
    padding: 16,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    justifyContent: 'flex-start',
  },
  ledgerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  header: {
    color: '#2A2420',
    fontWeight: 'bold',
    fontSize: 18,
    letterSpacing: 2,
  },
  subHeader: {
    color: '#8A7B66',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 1.5,
    marginTop: 2,
    marginBottom: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderColor: '#2A2420',
    paddingBottom: 6,
    marginBottom: 6,
  },
  colHeader: {
    color: '#2A2420',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  ledgerList: {
    paddingBottom: 10,
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 4,
    marginBottom: 2,
  },
  rowHighlight: {
    backgroundColor: '#D9B98A',
  },
  rowText: {
    color: '#2A2420',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    fontWeight: '600',
  },
  rowHighlightText: {
    color: '#A64B2A',
    fontWeight: 'bold',
  },
  dotLeaderContainer: {
    flex: 0.2,
    overflow: 'hidden',
    alignItems: 'center',
  },
  dotLeader: {
    color: '#B5A88F',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 10,
  },
  rightViewport: {
    flex: 0.4,
    backgroundColor: '#2C3B2E',
    padding: 14,
    borderLeftWidth: 2,
    borderColor: '#B08D57',
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    justifyContent: 'space-between',
  },
  rightHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  panelTitle: {
    color: '#E8DCC0',
    fontWeight: 'bold',
    fontSize: 13,
    letterSpacing: 1,
  },
  subText: {
    color: '#B08D57',
    fontSize: 10,
    marginTop: 2,
  },
  iconAddButton: {
    borderWidth: 1,
    borderColor: '#B08D57',
    padding: 6,
    borderRadius: 4,
    backgroundColor: '#202C22',
  },

  cardsContainer: {
    flex: 1,
    marginVertical: 4,
  },
  explorerCard: {
    backgroundColor: '#E8DCC0',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#2C3B2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#E8DCC0',
    fontWeight: 'bold',
    fontSize: 11,
  },
  explorerName: {
    color: '#2A2420',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: 'bold',
    fontSize: 11,
  },
  explorerMeta: {
    color: '#6E6152',
    fontSize: 8,
    marginTop: 1,
  },
  cardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4CAF50',
  },
  friendActionButton: {
    backgroundColor: '#CBBBA0',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingText: {
    color: '#A64B2A',
    fontSize: 8,
    fontWeight: 'bold',
  },
  dispatchButton: {
    backgroundColor: '#A64B2A',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderStyle: 'dashed',
    paddingVertical: 8,
    borderRadius: 4,
    alignItems: 'center',
  },
  dispatchText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 1.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 16, 11, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '60%',
    backgroundColor: '#E8DCC0',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#B08D57',
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    color: '#2A2420',
    fontWeight: 'bold',
    fontSize: 14,
    letterSpacing: 1,
  },
  modalSub: {
    color: '#6E6152',
    fontSize: 10,
    marginBottom: 12,
  },
  telegramInput: {
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    padding: 10,
    color: '#2A2420',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    height: 70,
    textAlignVertical: 'top',
    fontSize: 12,
    marginBottom: 12,
  },
  tagInput: {
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    padding: 10,
    color: '#2A2420',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    marginBottom: 12,
  },
  sendButton: {
    backgroundColor: '#2C3B2E',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 4,
  },
  sendButtonText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 1,
  },
});