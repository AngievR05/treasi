import React, { useState, useEffect, useCallback } from 'react';
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
  ActivityIndicator,
  Alert,
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
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  doc, 
  setDoc, 
  addDoc, 
  deleteDoc,
  updateDoc,
  where, 
  getDocs, 
  Timestamp,
  GeoPoint
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { UserDocument, FriendshipDocument } from '../types/firestore';
import { FieldNavBar, NavigationTab } from '../components/FieldNavBar';

// Custom SVG Vector Icons (Strictly NO Emojis)
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

const UserCheckIcon = ({ color = '#4CAF50', size = 16 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <Circle cx="8.5" cy="7" r="4" />
    <Polyline points="17 11 19 13 23 9" />
  </Svg>
);

const UserXIcon = ({ color = '#A64B2A', size = 16 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <Circle cx="8.5" cy="7" r="4" />
    <Path d="M18 8l5 5M23 8l-5 5" />
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
  uid: string;
  rank: string;
  name: string;
  points: string;
  isUser: boolean;
}

interface FriendshipMeta {
  docId: string;
  status: 'pending' | 'accepted' | 'declined' | 'blocked';
  isRequester: boolean;
}

interface NearbyExplorer {
  uid: string;
  name: string;
  initial: string;
  distanceKm: number;
  distanceFormatted: string;
  friendMeta?: FriendshipMeta;
}

interface Props {
  onBack?: () => void;
  onNavigate?: (tab: string) => void;
  userCoordinates?: { latitude: number; longitude: number };
}

// 20km Haversine Distance Calculator
const calculateHaversineDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const LeaderboardScreen: React.FC<Props> = ({ 
  onNavigate,
  userCoordinates = { latitude: -25.7479, longitude: 28.2293 } // Default campus base
}) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const currentTab: NavigationTab = 'LEADERBOARD';

  const currentUser = auth?.currentUser;
  const currentUserId = currentUser?.uid || '';

  // Modal & Input State
  const [telegramModalVisible, setTelegramModalVisible] = useState(false);
  const [friendModalVisible, setFriendModalVisible] = useState(false);
  const [telegramText, setTelegramText] = useState('');
  const [searchAgentTag, setSearchAgentTag] = useState('');
  const [searchError, setSearchError] = useState('');

  // Firestore Realtime Collections State
  const [manifest, setManifest] = useState<ExplorerEntry[]>([]);
  const [nearbyExplorers, setNearbyExplorers] = useState<NearbyExplorer[]>([]);
  const [friendshipsMap, setFriendshipsMap] = useState<Record<string, FriendshipMeta>>({});
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [loadingExplorers, setLoadingExplorers] = useState(true);
  const [isTransmitting, setIsTransmitting] = useState(false);

  // Motion Springs
  const buttonScale = useSharedValue(1);
  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const handlePressIn = () => { buttonScale.value = withSpring(0.95); };
  const handlePressOut = () => { buttonScale.value = withSpring(1); };

  /**
   * 1. READ: LISTEN TO GLOBAL LEADERBOARD MANIFEST
   */
  useEffect(() => {
    if (!db) {
      setLoadingManifest(false);
      return;
    }

    const leaderboardQuery = query(
      collection(db, 'users'),
      orderBy('totalPoints', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(leaderboardQuery, (snapshot) => {
      const entries: ExplorerEntry[] = snapshot.docs.map((docSnap, index) => {
        const data = docSnap.data() as UserDocument;
        const isUser = docSnap.id === currentUserId;
        const rankFormatted = String(index + 1).padStart(2, '0');
        const formattedName = isUser 
          ? `YOU - ${data.username?.toUpperCase() || 'EXPLORER'}`
          : (data.username?.toUpperCase() || 'UNKNOWN_AGENT');

        return {
          uid: docSnap.id,
          rank: rankFormatted,
          name: formattedName,
          points: (data.totalPoints || 0).toLocaleString(),
          isUser,
        };
      });

      setManifest(entries);
      setLoadingManifest(false);
    }, (err) => {
      console.error("Leaderboard Snapshot Error:", err);
      setLoadingManifest(false);
    });

    return () => unsubscribe();
  }, [currentUserId]);

  /**
   * 2. READ: LISTEN TO BIDIRECTIONAL FRIENDSHIPS
   */
  useEffect(() => {
    if (!db || !currentUserId) return;

    // Outgoing Requests
    const qOutgoing = query(
      collection(db, 'friendships'),
      where('requesterId', '==', currentUserId)
    );

    // Incoming Requests
    const qIncoming = query(
      collection(db, 'friendships'),
      where('receiverId', '==', currentUserId)
    );

    const activeMap: Record<string, FriendshipMeta> = {};

    const unsubOutgoing = onSnapshot(qOutgoing, (snap) => {
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as FriendshipDocument;
        activeMap[data.receiverId] = {
          docId: docSnap.id,
          status: data.status,
          isRequester: true,
        };
      });
      setFriendshipsMap({ ...activeMap });
    });

    const unsubIncoming = onSnapshot(qIncoming, (snap) => {
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as FriendshipDocument;
        activeMap[data.requesterId] = {
          docId: docSnap.id,
          status: data.status,
          isRequester: false,
        };
      });
      setFriendshipsMap({ ...activeMap });
    });

    return () => {
      unsubOutgoing();
      unsubIncoming();
    };
  }, [currentUserId]);

  /**
   * 3. READ & FILTER: NEARBY EXPLORERS (STRICT 20KM RADIUS FILTER)
   */
  useEffect(() => {
    if (!db || !currentUserId) {
      setLoadingExplorers(false);
      return;
    }

    const usersQuery = query(collection(db, 'users'), limit(100));

    const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
      const filteredList: NearbyExplorer[] = [];

      snapshot.docs.forEach((docSnap) => {
        if (docSnap.id === currentUserId) return; // Exclude self

        const data = docSnap.data() as any;
        const rawName = data.username?.toUpperCase() || 'AGENT';
        
        // Extract or fallback location coordinates
        const targetLat = data.location?.latitude ?? (userCoordinates.latitude + (Math.random() * 0.1 - 0.05));
        const targetLon = data.location?.longitude ?? (userCoordinates.longitude + (Math.random() * 0.1 - 0.05));

        const distKm = calculateHaversineDistanceKm(
          userCoordinates.latitude,
          userCoordinates.longitude,
          targetLat,
          targetLon
        );

        // STRICT 20KM PROXIMITY RULE
        if (distKm <= 20.0) {
          filteredList.push({
            uid: docSnap.id,
            name: rawName,
            initial: rawName.charAt(0) || 'A',
            distanceKm: distKm,
            distanceFormatted: distKm < 1 ? `${Math.round(distKm * 1000)} m` : `${distKm.toFixed(1)} km`,
            friendMeta: friendshipsMap[docSnap.id],
          });
        }
      });

      // Sort by closest proximity
      filteredList.sort((a, b) => a.distanceKm - b.distanceKm);

      setNearbyExplorers(filteredList);
      setLoadingExplorers(false);
    }, (err) => {
      console.error("Explorers Snapshot Error:", err);
      setLoadingExplorers(false);
    });

    return () => unsubscribe();
  }, [currentUserId, userCoordinates, friendshipsMap]);

  /**
   * CREATE: SEND FRIEND LINK REQUEST
   */
  const handleSendFriendRequest = async (targetUid: string) => {
    if (!db || !currentUserId) return;

    try {
      const friendshipId = `${currentUserId}_${targetUid}`;
      await setDoc(doc(db, 'friendships', friendshipId), {
        friendshipId,
        requesterId: currentUserId,
        receiverId: targetUid,
        status: 'pending',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      } as FriendshipDocument);
    } catch (err) {
      console.error("Error creating friendship request:", err);
    }
  };

  /**
   * UPDATE: ACCEPT FRIEND LINK REQUEST
   */
  const handleAcceptFriendRequest = async (docId: string) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'friendships', docId), {
        status: 'accepted',
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      console.error("Error accepting friendship:", err);
    }
  };

  /**
   * DELETE: CANCEL OR UNLINK FRIENDSHIP
   */
  const handleRemoveFriendship = async (docId: string, agentName: string) => {
    if (!db) return;

    Alert.alert(
      "TERMINATE LINK",
      `Are you sure you want to disconnect telemetry link with ${agentName}?`,
      [
        { text: "CANCEL", style: "cancel" },
        {
          text: "UNLINK",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'friendships', docId));
            } catch (err) {
              console.error("Error deleting friendship:", err);
            }
          },
        },
      ]
    );
  };

  /**
   * SEARCH & LINK AGENT CALLSIGN
   */
  const handleSearchAndLinkAgent = async () => {
    if (!db || !searchAgentTag.trim() || !currentUserId) return;
    setSearchError('');

    try {
      const searchTag = searchAgentTag.trim().toLowerCase();
      const q = query(collection(db, 'users'), where('username', '==', searchTag));
      const querySnap = await getDocs(q);

      if (querySnap.empty) {
        setSearchError('AGENT CALLSIGN NOT FOUND IN SECTOR');
        return;
      }

      const targetDoc = querySnap.docs[0];
      const targetUid = targetDoc.id;

      if (targetUid === currentUserId) {
        setSearchError('CANNOT LINK SELF CALLSIGN');
        return;
      }

      await handleSendFriendRequest(targetUid);
      setSearchAgentTag('');
      setFriendModalVisible(false);
    } catch (err) {
      console.error("Error searching agent:", err);
      setSearchError('TRANSMISSION FAILED');
    }
  };

  /**
   * DISPATCH TELEGRAM SIGNAL
   */
  const handleDispatchTelegram = async () => {
    if (!db || !telegramText.trim() || !currentUserId || isTransmitting) return;
    setIsTransmitting(true);

    try {
      const senderName = currentUser?.displayName || 'FIELD_EXPLORER';

      // 1. Write to Message Collection
      await addDoc(collection(db, 'messages'), {
        senderId: currentUserId,
        senderName,
        text: telegramText.trim(),
        createdAt: Timestamp.now(),
      });

      // 2. Log in Activity Feed
      await addDoc(collection(db, 'activity_feed'), {
        userId: currentUserId,
        username: senderName,
        type: 'TREASURE_HIDDEN',
        message: `DISPATCHED TELEGRAM: "${telegramText.trim().substring(0, 30)}..."`,
        targetId: 'global',
        createdAt: Timestamp.now(),
      });

      setTelegramText('');
      setIsTransmitting(false);
      setTelegramModalVisible(false);
    } catch (err) {
      console.error("Error dispatching telegram:", err);
      setIsTransmitting(false);
    }
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
      {/* LEFT VIEWPORT (60%): FIELD MANIFEST */}
      <Animated.View entering={FadeInLeft.duration(500)} style={styles.leftViewport}>
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

        {loadingManifest ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#2A2420" />
            <Text style={styles.loadingText}>SYNCING MANIFEST DATA...</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.ledgerList}>
            {manifest.map((item, index) => (
              <Animated.View
                key={item.uid}
                entering={FadeInDown.delay(index * 30).duration(250)}
                style={[styles.rowContainer, item.isUser && styles.rowHighlight]}
              >
                <Text style={[styles.rowText, item.isUser && styles.rowHighlightText, { flex: 0.15 }]}>
                  {item.rank}
                </Text>
                <Text style={[styles.rowText, item.isUser && styles.rowHighlightText, { flex: 0.55 }]} numberOfLines={1}>
                  {item.name}
                </Text>

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
        )}
      </Animated.View>

      {/* RIGHT VIEWPORT (40%): NEARBY EXPLORERS & CONTROL CONSOLE */}
      <Animated.View entering={FadeInRight.duration(500)} style={styles.rightViewport}>
        <View style={styles.rightHeaderRow}>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <StarIcon color="#B08D57" size={10} />
              <Text style={styles.panelTitle}>NEARBY AGENTS</Text>
            </View>
            <Text style={styles.subText}>Active Units Within 20km Radius</Text>
          </View>

          <TouchableOpacity 
            style={styles.iconAddButton} 
            onPress={() => setFriendModalVisible(true)}
            accessibilityLabel="Link New Explorer Callsign"
            accessibilityRole="button"
          >
            <UserPlusIcon color="#B08D57" size={16} />
          </TouchableOpacity>
        </View>

        {/* Nearby Cards Stream */}
        {loadingExplorers ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#E8DCC0" />
          </View>
        ) : nearbyExplorers.length === 0 ? (
          <View style={styles.loadingBox}>
            <Text style={styles.emptyText}>NO AGENTS DETECTED IN 20KM RADIUS</Text>
          </View>
        ) : (
          <ScrollView style={styles.cardsContainer} showsVerticalScrollIndicator={false}>
            {nearbyExplorers.map((item, idx) => {
              const friendMeta = item.friendMeta;
              const isPending = friendMeta?.status === 'pending';
              const isAccepted = friendMeta?.status === 'accepted';
              const isIncomingRequest = isPending && !friendMeta?.isRequester;

              return (
                <Animated.View key={item.uid} entering={FadeInRight.delay(idx * 50).duration(250)} style={styles.explorerCard}>
                  <View style={styles.cardLeft}>
                    <View style={styles.avatarCircle}>
                      <Text style={styles.avatarText}>{item.initial}</Text>
                    </View>
                    <View>
                      <Text style={styles.explorerName}>{item.name}</Text>
                      <Text style={styles.explorerMeta}>RANGE: {item.distanceFormatted}</Text>
                    </View>
                  </View>

                  <View style={styles.cardRight}>
                    <View style={styles.onlineDot} />

                    {/* Friend Action States */}
                    {!friendMeta && (
                      <TouchableOpacity 
                        style={styles.friendActionButton} 
                        onPress={() => handleSendFriendRequest(item.uid)}
                        accessibilityLabel={`Send link request to ${item.name}`}
                      >
                        <UserPlusIcon color="#2C3B2E" size={14} />
                      </TouchableOpacity>
                    )}

                    {isIncomingRequest && (
                      <View style={{ flexDirection: 'row', gap: 4 }}>
                        <TouchableOpacity 
                          style={[styles.friendActionButton, { backgroundColor: '#4CAF50' }]} 
                          onPress={() => handleAcceptFriendRequest(friendMeta.docId)}
                        >
                          <UserCheckIcon color="#FFFFFF" size={12} />
                        </TouchableOpacity>
                        <TouchableOpacity 
                          style={[styles.friendActionButton, { backgroundColor: '#A64B2A' }]} 
                          onPress={() => handleRemoveFriendship(friendMeta.docId, item.name)}
                        >
                          <UserXIcon color="#FFFFFF" size={12} />
                        </TouchableOpacity>
                      </View>
                    )}

                    {isPending && friendMeta?.isRequester && (
                      <TouchableOpacity 
                        style={[styles.friendActionButton, { backgroundColor: '#D9B98A' }]} 
                        onPress={() => handleRemoveFriendship(friendMeta.docId, item.name)}
                      >
                        <Text style={styles.pendingText}>PENDING</Text>
                      </TouchableOpacity>
                    )}

                    {isAccepted && (
                      <TouchableOpacity 
                        style={[styles.friendActionButton, { backgroundColor: '#CBBBA0' }]} 
                        onPress={() => handleRemoveFriendship(friendMeta.docId, item.name)}
                      >
                        <UserCheckIcon color="#2C3B2E" size={14} />
                      </TouchableOpacity>
                    )}
                  </View>
                </Animated.View>
              );
            })}
          </ScrollView>
        )}

        {/* Telegram Dispatch Trigger */}
        <Animated.View style={[animatedButtonStyle, { marginBottom: 6 }]}>
          <TouchableOpacity
            activeOpacity={0.88}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={styles.dispatchButton}
            onPress={() => setTelegramModalVisible(true)}
            accessibilityLabel="Dispatch Telegram Signal"
          >
            <Text style={styles.dispatchText}>DISPATCH TELEGRAM</Text>
          </TouchableOpacity>
        </Animated.View>

        <FieldNavBar currentTab={currentTab} onNavigate={onNavigate} />
      </Animated.View>

      {/* MODAL 1: DISPATCH TELEGRAM */}
      <Modal visible={telegramModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setTelegramModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>BROADCAST TELEGRAM</Text>
              <TouchableOpacity onPress={() => setTelegramModalVisible(false)}>
                <CloseIcon color="#B08D57" size={18} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>Send encrypted signal note to active sector agents.</Text>

            <TextInput
              style={styles.telegramInput}
              placeholder="Type dispatch message..."
              placeholderTextColor="#8A7B66"
              multiline
              value={telegramText}
              onChangeText={setTelegramText}
            />

            <TouchableOpacity
              style={[styles.sendButton, isTransmitting && { opacity: 0.6 }]}
              onPress={handleDispatchTelegram}
              disabled={isTransmitting}
            >
              {isTransmitting ? (
                <ActivityIndicator size="small" color="#F3ECD8" />
              ) : (
                <>
                  <SendIcon color="#F3ECD8" size={16} />
                  <Text style={styles.sendButtonText}>TRANSMIT SIGNAL</Text>
                </>
              )}
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* MODAL 2: LINK NEW EXPLORER */}
      <Modal visible={friendModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setFriendModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>LINK NEW EXPLORER</Text>
              <TouchableOpacity onPress={() => setFriendModalVisible(false)}>
                <CloseIcon color="#B08D57" size={18} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>Enter agent callsign tag (e.g., wilder_wren)</Text>

            {searchError ? <Text style={styles.errorText}>{searchError}</Text> : null}

            <TextInput
              style={styles.tagInput}
              placeholder="AGENT_CALLSIGN"
              placeholderTextColor="#8A7B66"
              autoCapitalize="none"
              value={searchAgentTag}
              onChangeText={(txt) => {
                setSearchAgentTag(txt);
                setSearchError('');
              }}
            />

            <TouchableOpacity style={styles.sendButton} onPress={handleSearchAndLinkAgent}>
              <UserPlusIcon color="#F3ECD8" size={16} />
              <Text style={styles.sendButtonText}>SEND LINK REQUEST</Text>
            </TouchableOpacity>
          </Pressable>
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
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#2A2420',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  emptyText: {
    color: '#B08D57',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
    textAlign: 'center',
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
    fontSize: 9,
    marginTop: 2,
  },
  iconAddButton: {
    borderWidth: 1,
    borderColor: '#B08D57',
    padding: 6,
    borderRadius: 4,
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingVertical: 4,
    paddingHorizontal: 8,
    minWidth: 32,
    minHeight: 32,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingText: {
    color: '#2A2420',
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
    minHeight: 40,
    justifyContent: 'center',
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
  errorText: {
    color: '#A64B2A',
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 6,
    letterSpacing: 1,
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
    minHeight: 44,
  },
  sendButtonText: {
    color: '#F3ECD8',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 1,
  },
});