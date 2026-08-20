import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';
import {
  collection,
  deleteDoc,
  doc,
  GeoPoint,
  limit,
  onSnapshot,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { FriendshipDocument, UserDocument } from '../types/firestore';
import { FieldNavBar, NavigationTab } from '../components/FieldNavBar';

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
  onNavigate?: (tab: string) => void;
  userCoordinates?: { latitude: number; longitude: number } | null;
}

const RADIUS_KM = 20;
const MAX_EXPLORERS = 100;

const isValidCoordinate = (latitude: unknown, longitude: unknown): boolean =>
  typeof latitude === 'number' &&
  typeof longitude === 'number' &&
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

const calculateHaversineDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const getDeterministicFriendshipId = (uid1: string, uid2: string): string =>
  [uid1, uid2].sort().join('_');

const formatDistance = (distanceKm: number): string => {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${distanceKm.toFixed(1)} km`;
};

const normaliseName = (value: unknown): string => {
  const name = typeof value === 'string' ? value.trim() : '';
  return name ? name.toUpperCase() : 'AGENT';
};

export const SocialScreen: React.FC<Props> = ({
  onNavigate,
  userCoordinates = null,
}) => {
  const insets = useSafeAreaInsets();
  const currentTab: NavigationTab = 'LEADERBOARD';
  const currentUser = auth?.currentUser;
  const currentUserId = currentUser?.uid ?? '';

  const [allUsers, setAllUsers] = useState<
    Array<{ uid: string; name: string; location: GeoPoint | null }>
  >([]);
  const [outgoingFriendships, setOutgoingFriendships] = useState<
    Array<{ docId: string; targetUid: string; status: FriendshipMeta['status'] }>
  >([]);
  const [incomingFriendships, setIncomingFriendships] = useState<
    Array<{ docId: string; targetUid: string; status: FriendshipMeta['status'] }>
  >([]);

  const [loadingExplorers, setLoadingExplorers] = useState(true);
  const [explorerError, setExplorerError] = useState('');
  const [explorerRetryKey, setExplorerRetryKey] = useState(0);

  const [telegramText, setTelegramText] = useState('');
  const [isTransmitting, setIsTransmitting] = useState(false);

  const [friendModalVisible, setFriendModalVisible] = useState(false);
  const [searchAgentTag, setSearchAgentTag] = useState('');
  const [searchError, setSearchError] = useState('');
  const [actionUid, setActionUid] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const friendshipsMap = useMemo<Record<string, FriendshipMeta>>(() => {
    const map: Record<string, FriendshipMeta> = {};

    for (const friendship of outgoingFriendships) {
      map[friendship.targetUid] = {
        docId: friendship.docId,
        status: friendship.status,
        isRequester: true,
      };
    }

    for (const friendship of incomingFriendships) {
      const existing = map[friendship.targetUid];
      if (!existing || existing.status !== 'accepted') {
        map[friendship.targetUid] = {
          docId: friendship.docId,
          status: friendship.status,
          isRequester: false,
        };
      }
    }

    return map;
  }, [incomingFriendships, outgoingFriendships]);

  useEffect(() => {
    if (!db || !currentUserId) {
      setOutgoingFriendships([]);
      setIncomingFriendships([]);
      return;
    }

    const outgoingQuery = query(
      collection(db, 'friendships'),
      where('requesterId', '==', currentUserId),
    );
    const incomingQuery = query(
      collection(db, 'friendships'),
      where('receiverId', '==', currentUserId),
    );

    const unsubOutgoing = onSnapshot(
      outgoingQuery,
      (snapshot) => {
        setOutgoingFriendships(
          snapshot.docs
            .map((docSnap) => {
              const data = docSnap.data() as Partial<FriendshipDocument>;
              if (typeof data.receiverId !== 'string' || typeof data.status !== 'string') {
                return null;
              }
              return {
                docId: docSnap.id,
                targetUid: data.receiverId,
                status: data.status as FriendshipMeta['status'],
              };
            })
            .filter(Boolean) as Array<{
            docId: string;
            targetUid: string;
            status: FriendshipMeta['status'];
          }>,
        );
      },
      () => setOutgoingFriendships([]),
    );

    const unsubIncoming = onSnapshot(
      incomingQuery,
      (snapshot) => {
        setIncomingFriendships(
          snapshot.docs
            .map((docSnap) => {
              const data = docSnap.data() as Partial<FriendshipDocument>;
              if (typeof data.requesterId !== 'string' || typeof data.status !== 'string') {
                return null;
              }
              return {
                docId: docSnap.id,
                targetUid: data.requesterId,
                status: data.status as FriendshipMeta['status'],
              };
            })
            .filter(Boolean) as Array<{
            docId: string;
            targetUid: string;
            status: FriendshipMeta['status'];
          }>,
        );
      },
      () => setIncomingFriendships([]),
    );

    return () => {
      unsubOutgoing();
      unsubIncoming();
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!db || !currentUserId) {
      setAllUsers([]);
      setLoadingExplorers(false);
      return;
    }

    setLoadingExplorers(true);
    setExplorerError('');

    const usersQuery = query(collection(db, 'users'), limit(MAX_EXPLORERS));

    return onSnapshot(
      usersQuery,
      (snapshot) => {
        const users = snapshot.docs
          .filter((docSnap) => docSnap.id !== currentUserId)
          .map((docSnap) => {
            const data = docSnap.data() as UserDocument & {
              location?: GeoPoint | { latitude: number; longitude: number } | null;
            };
            const rawLocation = data.location;
            const rawLatitude =
              rawLocation && typeof rawLocation === 'object' && 'latitude' in rawLocation
                ? Number(rawLocation.latitude)
                : NaN;
            const rawLongitude =
              rawLocation && typeof rawLocation === 'object' && 'longitude' in rawLocation
                ? Number(rawLocation.longitude)
                : NaN;

            return {
              uid: docSnap.id,
              name: normaliseName(data.username),
              location: isValidCoordinate(rawLatitude, rawLongitude)
                ? new GeoPoint(rawLatitude, rawLongitude)
                : null,
            };
          });

        setAllUsers(users);
        setLoadingExplorers(false);
      },
      () => {
        setExplorerError('Unable to scan nearby explorer telemetry.');
        setLoadingExplorers(false);
      },
    );
  }, [currentUserId, explorerRetryKey]);

  const nearbyExplorers = useMemo<NearbyExplorer[]>(() => {
    if (!userCoordinates || !isValidCoordinate(userCoordinates.latitude, userCoordinates.longitude)) {
      return [];
    }

    const parsed: NearbyExplorer[] = [];

    for (const user of allUsers) {
      if (!user.location) continue;

      const distanceKm = calculateHaversineDistanceKm(
        userCoordinates.latitude,
        userCoordinates.longitude,
        user.location.latitude,
        user.location.longitude,
      );

      if (distanceKm <= RADIUS_KM) {
        parsed.push({
          uid: user.uid,
          name: user.name,
          initial: user.name.charAt(0) || 'A',
          distanceKm,
          distanceFormatted: formatDistance(distanceKm),
          friendMeta: friendshipsMap[user.uid],
        });
      }
    }

    return parsed.sort((a, b) => a.distanceKm - b.distanceKm);
  }, [allUsers, friendshipsMap, userCoordinates]);

  const handleSendFriendRequest = async (targetUid: string) => {
    if (!db || !currentUserId || !targetUid || targetUid === currentUserId) {
      if (targetUid === currentUserId) {
        Alert.alert('CANNOT LINK SELF', 'You cannot create a friendship request with your own account.');
      }
      return;
    }

    if (actionUid) return;

    const existingMeta = friendshipsMap[targetUid];

    if (existingMeta) {
      if (existingMeta.status === 'accepted') {
        Alert.alert('LINK ACTIVE', 'You are already linked with this explorer.');
        return;
      }
      if (existingMeta.status === 'pending') {
        Alert.alert('REQUEST ACTIVE', 'A pending link request already exists with this explorer.');
        return;
      }
      if (existingMeta.status === 'blocked') {
        Alert.alert('LINK BLOCKED', 'This explorer cannot currently be linked.');
        return;
      }
    }

    try {
      setActionUid(targetUid);
      const friendshipId = getDeterministicFriendshipId(currentUserId, targetUid);

      await setDoc(
        doc(db, 'friendships', friendshipId),
        {
          friendshipId,
          requesterId: currentUserId,
          receiverId: targetUid,
          status: 'pending',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        } as FriendshipDocument,
        { merge: false },
      );
    } catch {
      Alert.alert('TRANSMISSION ERROR', 'Failed to issue the friend link request.');
    } finally {
      setActionUid(null);
    }
  };

  const handleAcceptFriendRequest = async (friendship: FriendshipMeta) => {
    if (!db || !currentUserId || actionUid) return;

    try {
      setActionUid(friendship.docId);
      await updateDoc(doc(db, 'friendships', friendship.docId), {
        status: 'accepted',
        updatedAt: Timestamp.now(),
      });
    } catch {
      Alert.alert('LINK ERROR', 'Unable to accept the explorer link request.');
    } finally {
      setActionUid(null);
    }
  };

  const handleRemoveFriendship = (friendship: FriendshipMeta, agentName: string) => {
    if (!db || !currentUserId) return;

    Alert.alert(
      friendship.status === 'pending' && friendship.isRequester ? 'CANCEL REQUEST' : 'TERMINATE LINK',
      friendship.status === 'pending' && friendship.isRequester
        ? `Cancel the pending link request to ${agentName}?`
        : `Disconnect telemetry link with ${agentName}?`,
      [
        { text: 'CANCEL', style: 'cancel' },
        {
          text: friendship.status === 'pending' && friendship.isRequester ? 'CANCEL REQUEST' : 'UNLINK',
          style: 'destructive',
          onPress: async () => {
            if (actionUid) return;

            try {
              setActionUid(friendship.docId);
              await deleteDoc(doc(db, 'friendships', friendship.docId));
            } catch {
              Alert.alert('LINK ERROR', 'Unable to update the friendship record.');
            } finally {
              setActionUid(null);
            }
          },
        },
      ],
    );
  };

  const handleSearchAndLinkAgent = async () => {
    if (!db || !currentUserId || isSearching) return;

    const searchTag = searchAgentTag.trim().toLowerCase();
    if (!searchTag) {
      setSearchError('ENTER AN AGENT CALLSIGN');
      return;
    }

    setSearchError('');
    setIsSearching(true);

    try {
      const matchingExplorer = allUsers.find(
        (user) => user.name.toLowerCase() === searchTag,
      );

      if (!matchingExplorer) {
        setSearchError('AGENT CALLSIGN NOT FOUND');
        return;
      }

      if (matchingExplorer.uid === currentUserId) {
        setSearchError('CANNOT LINK SELF CALLSIGN');
        return;
      }

      await handleSendFriendRequest(matchingExplorer.uid);
      setFriendModalVisible(false);
      setSearchAgentTag('');
    } catch {
      setSearchError('TRANSMISSION FAILED');
    } finally {
      setIsSearching(false);
    }
  };

  const handleDispatchTelegram = async () => {
    if (!db || !currentUserId || !telegramText.trim() || isTransmitting) {
      if (!telegramText.trim()) {
        Alert.alert('EMPTY TELEGRAM', 'Enter a message before transmitting the signal.');
      }
      return;
    }

    setIsTransmitting(true);

    try {
      const senderName = normaliseName(
        currentUser?.displayName?.trim() ||
          currentUser?.email?.trim() ||
          'FIELD EXPLORER',
      );
      const message = telegramText.trim().slice(0, 500);

      await setDoc(doc(collection(db, 'messages')), {
        senderId: currentUserId,
        senderName,
        text: message,
        createdAt: Timestamp.now(),
        type: 'GLOBAL_DISPATCH',
      });

      await setDoc(doc(collection(db, 'activity_feed')), {
        userId: currentUserId,
        username: senderName,
        type: 'TELEGRAM_DISPATCH',
        message: `DISPATCHED TELEGRAM: "${message.length > 30 ? `${message.substring(0, 30)}...` : message}"`,
        targetId: 'global',
        createdAt: Timestamp.now(),
      });

      setTelegramText('');
      Alert.alert('SIGNAL TRANSMITTED', 'Telegram broadcast dispatched to the active sector.');
    } catch {
      Alert.alert(
        'TRANSMISSION FAILED',
        'The Telegram could not be dispatched. Check your connection and try again.',
      );
    } finally {
      setIsTransmitting(false);
    }
  };

  return (
    <View
      style={[
        styles.screen,
        {
          paddingLeft: Math.max(insets.left, 12),
          paddingRight: Math.max(insets.right, 12),
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      <View style={styles.splitWrapper}>
        <View style={styles.telegramPanel}>
          <View style={styles.panelHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.panelTitle}>BROADCAST TELEGRAM</Text>
              <Text style={styles.subText}>SECTOR-WIDE DISPATCH CHANNEL</Text>
            </View>
            <SendIcon color="#B08D57" size={18} />
          </View>

          <Text style={styles.description}>
            Broadcast a message to the active sector. Telegrams are public dispatches,
            not private messages.
          </Text>

          <TextInput
            style={styles.telegramInput}
            placeholder="TYPE DISPATCH MESSAGE..."
            placeholderTextColor="#8A7B66"
            multiline
            value={telegramText}
            maxLength={500}
            onChangeText={setTelegramText}
            textAlignVertical="top"
            accessibilityLabel="Telegram message"
          />

          <Text style={styles.charCount}>{telegramText.length}/500</Text>

          <TouchableOpacity
            style={[styles.sendButton, isTransmitting && { opacity: 0.6 }]}
            onPress={handleDispatchTelegram}
            disabled={isTransmitting}
            accessibilityRole="button"
          >
            {isTransmitting ? (
              <>
                <ActivityIndicator size="small" color="#F3ECD8" />
                <Text style={styles.sendButtonText}>TRANSMITTING...</Text>
              </>
            ) : (
              <>
                <SendIcon color="#F3ECD8" size={16} />
                <Text style={styles.sendButtonText}>TRANSMIT SIGNAL</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.telegramInfo}>
            <Text style={styles.infoLabel}>DISPATCH PROTOCOL</Text>
            <Text style={styles.infoText}>
              Messages are stored as GLOBAL_DISPATCH records and mirrored to the activity feed.
            </Text>
          </View>
        </View>

        <View style={styles.friendsPanel}>
          <View style={styles.panelHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.panelTitle, styles.friendsPanelTitle]}>NEARBY AGENTS</Text>
              <Text style={styles.subText}>ACTIVE UNITS WITHIN 20KM</Text>
            </View>

            <TouchableOpacity
              style={styles.iconAddButton}
              onPress={() => {
                setSearchError('');
                setSearchAgentTag('');
                setFriendModalVisible(true);
              }}
              accessibilityLabel="Add friend"
              accessibilityRole="button"
            >
              <UserPlusIcon color="#B08D57" size={16} />
            </TouchableOpacity>
          </View>

          {loadingExplorers ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color="#E8DCC0" />
              <Text style={styles.loadingTextDark}>SCANNING EXPLORER TELEMETRY...</Text>
            </View>
          ) : explorerError ? (
            <View style={styles.loadingBox}>
              <Text style={styles.errorTextDark}>{explorerError}</Text>
              <TouchableOpacity
                style={styles.darkRetryButton}
                onPress={() => {
                  setExplorerError('');
                  setLoadingExplorers(true);
                  setExplorerRetryKey((value) => value + 1);
                }}
              >
                <Text style={styles.darkRetryText}>RECONNECT</Text>
              </TouchableOpacity>
            </View>
          ) : !userCoordinates ? (
            <View style={styles.loadingBox}>
              <Text style={styles.emptyText}>YOUR LOCATION IS UNAVAILABLE</Text>
              <Text style={styles.loadingTextDark}>
                Nearby range cannot be verified without a valid GPS position.
              </Text>
            </View>
          ) : nearbyExplorers.length === 0 ? (
            <View style={styles.loadingBox}>
              <Text style={styles.emptyText}>NO AGENTS DETECTED IN 20KM RADIUS</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.cardsContainer}
              showsVerticalScrollIndicator={false}
              accessibilityLabel="Nearby explorers"
            >
              {nearbyExplorers.map((item) => {
                const friendMeta = item.friendMeta;
                const isPending = friendMeta?.status === 'pending';
                const isAccepted = friendMeta?.status === 'accepted';
                const isIncomingRequest = isPending && !friendMeta?.isRequester;
                const isActing =
                  actionUid === item.uid || actionUid === friendMeta?.docId;

                return (
                  <View key={item.uid} style={styles.explorerCard}>
                    <View style={styles.cardLeft}>
                      <View style={styles.avatarCircle}>
                        <Text style={styles.avatarText}>{item.initial}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.explorerName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={styles.explorerMeta}>
                          RANGE: {item.distanceFormatted}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.cardRight}>
                      {!friendMeta && (
                        <TouchableOpacity
                          style={[styles.friendActionButton, isActing && { opacity: 0.5 }]}
                          onPress={() => handleSendFriendRequest(item.uid)}
                          disabled={isActing}
                          accessibilityLabel={`Send friend request to ${item.name}`}
                        >
                          {isActing ? (
                            <ActivityIndicator size="small" color="#2C3B2E" />
                          ) : (
                            <UserPlusIcon color="#2C3B2E" size={14} />
                          )}
                        </TouchableOpacity>
                      )}

                      {isIncomingRequest && (
                        <>
                          <TouchableOpacity
                            style={[styles.friendActionButton, { backgroundColor: '#4CAF50' }]}
                            onPress={() => handleAcceptFriendRequest(friendMeta)}
                            disabled={isActing}
                            accessibilityLabel={`Accept friend request from ${item.name}`}
                          >
                            <UserCheckIcon color="#FFFFFF" size={12} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.friendActionButton, { backgroundColor: '#A64B2A' }]}
                            onPress={() => handleRemoveFriendship(friendMeta, item.name)}
                            disabled={isActing}
                            accessibilityLabel={`Decline friend request from ${item.name}`}
                          >
                            <UserXIcon color="#FFFFFF" size={12} />
                          </TouchableOpacity>
                        </>
                      )}

                      {isPending && friendMeta?.isRequester && (
                        <TouchableOpacity
                          style={[styles.friendActionButton, { backgroundColor: '#D9B98A' }]}
                          onPress={() => handleRemoveFriendship(friendMeta, item.name)}
                          disabled={isActing}
                          accessibilityLabel={`Cancel pending friend request to ${item.name}`}
                        >
                          <Text style={styles.pendingText}>PENDING</Text>
                        </TouchableOpacity>
                      )}

                      {isAccepted && (
                        <TouchableOpacity
                          style={[styles.friendActionButton, { backgroundColor: '#CBBBA0' }]}
                          onPress={() => handleRemoveFriendship(friendMeta, item.name)}
                          disabled={isActing}
                          accessibilityLabel={`Remove friendship with ${item.name}`}
                        >
                          {isActing ? (
                            <ActivityIndicator size="small" color="#2C3B2E" />
                          ) : (
                            <UserCheckIcon color="#2C3B2E" size={14} />
                          )}
                        </TouchableOpacity>
                      )}

                      {friendMeta?.status === 'declined' && (
                        <Text style={styles.statusText}>DECLINED</Text>
                      )}
                      {friendMeta?.status === 'blocked' && (
                        <Text style={styles.statusText}>BLOCKED</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>

      <FieldNavBar currentTab={currentTab} onNavigate={onNavigate} />

      <Modal
        visible={friendModalVisible}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => {
          if (!isSearching && !actionUid) setFriendModalVisible(false);
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!isSearching && !actionUid) setFriendModalVisible(false);
            }}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>LINK NEW EXPLORER</Text>
                <Text style={styles.modalSub}>
                  Enter an exact explorer callsign to issue a link request.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (!isSearching && !actionUid) setFriendModalVisible(false);
                }}
                disabled={isSearching || !!actionUid}
                style={styles.closeButton}
              >
                <CloseIcon color="#B08D57" size={18} />
              </TouchableOpacity>
            </View>

            {searchError ? <Text style={styles.errorText}>{searchError}</Text> : null}

            <TextInput
              style={styles.tagInput}
              placeholder="AGENT_CALLSIGN"
              placeholderTextColor="#8A7B66"
              autoCapitalize="none"
              autoCorrect={false}
              value={searchAgentTag}
              onChangeText={(text) => {
                setSearchAgentTag(text);
                setSearchError('');
              }}
            />

            <TouchableOpacity
              style={[styles.sendButton, isSearching && { opacity: 0.6 }]}
              onPress={handleSearchAndLinkAgent}
              disabled={isSearching}
            >
              {isSearching ? (
                <>
                  <ActivityIndicator size="small" color="#F3ECD8" />
                  <Text style={styles.sendButtonText}>SEARCHING...</Text>
                </>
              ) : (
                <>
                  <UserPlusIcon color="#F3ECD8" size={16} />
                  <Text style={styles.sendButtonText}>SEND LINK REQUEST</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#1C281E',
  },
  splitWrapper: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  telegramPanel: {
    flex: 0.6,
    minWidth: 0,
    backgroundColor: '#E8DCC0',
    borderRadius: 10,
    padding: 16,
  },
  friendsPanel: {
    flex: 0.4,
    minWidth: 0,
    backgroundColor: '#2C3B2E',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#B08D57',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  panelTitle: {
    color: '#2A2420',
    fontWeight: 'bold',
    fontSize: 14,
    letterSpacing: 1,
  },
  friendsPanelTitle: {
    color: '#E8DCC0',
  },
  subText: {
    color: '#8A7B66',
    fontSize: 9,
    marginTop: 3,
    letterSpacing: 0.5,
  },
  description: {
    color: '#6E6152',
    fontSize: 10,
    lineHeight: 15,
    marginBottom: 14,
    maxWidth: 600,
  },
  telegramInput: {
    flex: 1,
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 6,
    padding: 12,
    color: '#2A2420',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    minHeight: 140,
    textAlignVertical: 'top',
    fontSize: 12,
  },
  charCount: {
    color: '#8A7B66',
    fontSize: 8,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 10,
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
  telegramInfo: {
    borderTopWidth: 1,
    borderColor: '#CBBBA0',
    marginTop: 14,
    paddingTop: 12,
  },
  infoLabel: {
    color: '#A64B2A',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 4,
  },
  infoText: {
    color: '#6E6152',
    fontSize: 9,
    lineHeight: 14,
  },
  iconAddButton: {
    borderWidth: 1,
    borderColor: '#B08D57',
    padding: 6,
    borderRadius: 4,
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#202C22',
  },
  cardsContainer: {
    flex: 1,
    marginTop: 4,
  },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  loadingTextDark: {
    color: '#B08D57',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  errorTextDark: {
    color: '#E8DCC0',
    fontSize: 9,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  emptyText: {
    color: '#B08D57',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
    textAlign: 'center',
  },
  darkRetryButton: {
    backgroundColor: '#A64B2A',
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 40,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  darkRetryText: {
    color: '#F3ECD8',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  explorerCard: {
    backgroundColor: '#E8DCC0',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 52,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  avatarCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#2C3B3E',
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
    gap: 4,
    marginLeft: 4,
  },
  friendActionButton: {
    backgroundColor: '#CBBBA0',
    paddingVertical: 4,
    paddingHorizontal: 8,
    minWidth: 38,
    minHeight: 38,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingText: {
    color: '#2A2420',
    fontSize: 8,
    fontWeight: 'bold',
  },
  statusText: {
    color: '#B08D57',
    fontSize: 8,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 16, 11, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '90%',
    maxWidth: 600,
    backgroundColor: '#E8DCC0',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#B08D57',
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
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
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 15,
  },
  closeButton: {
    minWidth: 40,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#A64B2A',
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 6,
    letterSpacing: 1,
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
    minHeight: 44,
  },
});
