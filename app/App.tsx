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
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Path,
  Polyline,
} from 'react-native-svg';

import {
  collection,
  deleteDoc,
  doc,
  GeoPoint,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

import { auth, db } from './src/config/firebase';
import {
  UserDocument,
  FriendshipDocument,
} from './src/types/firestore';
import {
  FieldNavBar,
  NavigationTab,
} from './src/components/FieldNavBar';

/* -------------------------------------------------------------------------- */
/*                                   ICONS                                    */
/* -------------------------------------------------------------------------- */

const StarIcon = ({
  color = '#A64B2A',
  size = 12,
}: {
  color?: string;
  size?: number;
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={color}
  >
    <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </Svg>
);

const UserPlusIcon = ({
  color = '#E8DCC0',
  size = 16,
}: {
  color?: string;
  size?: number;
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <Path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <Circle cx="8.5" cy="7" r="4" />
    <Path d="M20 8v6M23 11h-6" />
  </Svg>
);

const UserCheckIcon = ({
  color = '#4CAF50',
  size = 16,
}: {
  color?: string;
  size?: number;
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <Path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <Circle cx="8.5" cy="7" r="4" />
    <Polyline points="17 11 19 13 23 9" />
  </Svg>
);

const UserXIcon = ({
  color = '#A64B2A',
  size = 16,
}: {
  color?: string;
  size?: number;
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <Path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <Circle cx="8.5" cy="7" r="4" />
    <Path d="M18 8l5 5M23 8l-5 5" />
  </Svg>
);

const SendIcon = ({
  color = '#E8DCC0',
  size = 16,
}: {
  color?: string;
  size?: number;
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <Path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </Svg>
);

const CloseIcon = ({
  color = '#B08D57',
  size = 18,
}: {
  color?: string;
  size?: number;
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <Path d="M18 6L6 18M6 6l12 12" />
  </Svg>
);

/* -------------------------------------------------------------------------- */
/*                                   TYPES                                    */
/* -------------------------------------------------------------------------- */

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
  hasValidLocation: boolean;
  friendMeta?: FriendshipMeta;
}

interface Props {
  onBack?: () => void;
  onNavigate?: (tab: string) => void;
  userCoordinates?: {
    latitude: number;
    longitude: number;
  } | null;
}

interface LocalUser {
  uid: string;
  name: string;
  email: string;
}

/* -------------------------------------------------------------------------- */
/*                                CONSTANTS                                   */
/* -------------------------------------------------------------------------- */

const RADIUS_KM = 20;
const MAX_LEADERBOARD_ENTRIES = 50;
const MAX_EXPLORERS = 100;
const MAX_TELEGRAM_LENGTH = 500;

/* -------------------------------------------------------------------------- */
/*                                UTILITIES                                   */
/* -------------------------------------------------------------------------- */

const isValidCoordinate = (
  latitude: unknown,
  longitude: unknown,
): boolean => {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
};

const calculateHaversineDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const earthRadiusKm = 6371;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return (
    earthRadiusKm *
    (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
  );
};

const getDeterministicFriendshipId = (
  uid1: string,
  uid2: string,
): string => {
  return [uid1, uid2].sort().join('_');
};

const formatDistance = (distanceKm: number | null): string => {
  if (
    distanceKm === null ||
    !Number.isFinite(distanceKm)
  ) {
    return 'NO SIGNAL';
  }

  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`;
  }

  return `${distanceKm.toFixed(1)} km`;
};

const normaliseName = (value: unknown): string => {
  if (typeof value !== 'string') {
    return 'AGENT';
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return 'AGENT';
  }

  return trimmed.toUpperCase();
};

/**
 * IMPORTANT:
 * This helper prevents the exact class of crash caused by attempting
 * to read `.displayName` from an undefined Firebase user.
 */
const getSafeAuthUser = (): LocalUser | null => {
  try {
    const firebaseUser = auth?.currentUser;

    if (!firebaseUser) {
      return null;
    }

    const uid =
      typeof firebaseUser.uid === 'string'
        ? firebaseUser.uid
        : '';

    if (!uid) {
      return null;
    }

    const displayName =
      typeof firebaseUser.displayName === 'string'
        ? firebaseUser.displayName.trim()
        : '';

    const email =
      typeof firebaseUser.email === 'string'
        ? firebaseUser.email.trim()
        : '';

    return {
      uid,
      name: normaliseName(
        displayName ||
          email ||
          'FIELD EXPLORER',
      ),
      email,
    };
  } catch {
    return null;
  }
};

const getLocationFromUserData = (
  data: UserDocument & {
    location?:
      | GeoPoint
      | {
          latitude: number;
          longitude: number;
        }
      | null;
  },
): GeoPoint | null => {
  const rawLocation = data.location;

  if (!rawLocation) {
    return null;
  }

  let latitude: number;
  let longitude: number;

  if (rawLocation instanceof GeoPoint) {
    latitude = rawLocation.latitude;
    longitude = rawLocation.longitude;
  } else {
    latitude = Number(rawLocation.latitude);
    longitude = Number(rawLocation.longitude);
  }

  if (!isValidCoordinate(latitude, longitude)) {
    return null;
  }

  return new GeoPoint(latitude, longitude);
};

/* -------------------------------------------------------------------------- */
/*                            MAIN SCREEN                                     */
/* -------------------------------------------------------------------------- */

export const LeaderboardScreen: React.FC<Props> = ({
  onNavigate,
  userCoordinates = null,
}) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const isLandscape = width > height;
  const currentTab: NavigationTab = 'LEADERBOARD';

  /*
   * Do NOT directly assume auth.currentUser exists.
   *
   * The previous implementation did:
   *
   * currentUser?.displayName
   *
   * which protects against currentUser being null, but this component
   * can still be mounted while Firebase auth is initialising.
   */
  const currentUser = useMemo(
    () => getSafeAuthUser(),
    [],
  );

  const currentUserId = currentUser?.uid ?? '';

  /* ---------------------------------------------------------------------- */
  /*                                STATE                                   */
  /* ---------------------------------------------------------------------- */

  const [manifest, setManifest] =
    useState<ExplorerEntry[]>([]);

  const [allUsers, setAllUsers] = useState<
    Array<{
      uid: string;
      name: string;
      location: GeoPoint | null;
    }>
  >([]);

  const [outgoingFriendships, setOutgoingFriendships] =
    useState<
      Array<{
        docId: string;
        targetUid: string;
        status: FriendshipMeta['status'];
      }>
    >([]);

  const [incomingFriendships, setIncomingFriendships] =
    useState<
      Array<{
        docId: string;
        targetUid: string;
        status: FriendshipMeta['status'];
      }>
    >([]);

  const [loadingManifest, setLoadingManifest] =
    useState(true);

  const [manifestError, setManifestError] =
    useState('');

  const [loadingExplorers, setLoadingExplorers] =
    useState(true);

  const [explorerError, setExplorerError] =
    useState('');

  const [telegramModalVisible, setTelegramModalVisible] =
    useState(false);

  const [friendModalVisible, setFriendModalVisible] =
    useState(false);

  const [telegramText, setTelegramText] =
    useState('');

  const [searchAgentTag, setSearchAgentTag] =
    useState('');

  const [searchError, setSearchError] =
    useState('');

  const [actionUid, setActionUid] =
    useState<string | null>(null);

  const [isTransmitting, setIsTransmitting] =
    useState(false);

  const [isSearching, setIsSearching] =
    useState(false);

  const [manifestRetryKey, setManifestRetryKey] =
    useState(0);

  const [explorerRetryKey, setExplorerRetryKey] =
    useState(0);

  /* ---------------------------------------------------------------------- */
  /*                         FRIENDSHIP MAP                                 */
  /* ---------------------------------------------------------------------- */

  const friendshipsMap = useMemo<
    Record<string, FriendshipMeta>
  >(() => {
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

      /*
       * An accepted relationship should always win over a stale
       * pending/declined representation.
       */
      if (
        !existing ||
        friendship.status === 'accepted'
      ) {
        map[friendship.targetUid] = {
          docId: friendship.docId,
          status: friendship.status,
          isRequester: false,
        };
      }
    }

    return map;
  }, [
    incomingFriendships,
    outgoingFriendships,
  ]);

  /* ---------------------------------------------------------------------- */
  /*                         LEADERBOARD                                    */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!db) {
      setManifestError(
        'Database connection unavailable.',
      );
      setLoadingManifest(false);
      return;
    }

    setLoadingManifest(true);
    setManifestError('');

    const leaderboardQuery = query(
      collection(db, 'users'),
      orderBy('totalPoints', 'desc'),
      limit(MAX_LEADERBOARD_ENTRIES),
    );

    const unsubscribe = onSnapshot(
      leaderboardQuery,
      (snapshot) => {
        try {
          const entries: ExplorerEntry[] =
            snapshot.docs.map((docSnap, index) => {
              const data =
                docSnap.data() as Partial<UserDocument>;

              const uid = docSnap.id;

              const isUser =
                uid === currentUserId;

              const username = normaliseName(
                data.username,
              );

              const totalPoints =
                typeof data.totalPoints === 'number' &&
                Number.isFinite(data.totalPoints)
                  ? data.totalPoints
                  : 0;

              return {
                uid,
                rank: String(index + 1).padStart(2, '0'),
                name: isUser
                  ? `YOU - ${username}`
                  : username,
                points: totalPoints.toLocaleString(),
                isUser,
              };
            });

          setManifest(entries);
          setLoadingManifest(false);
        } catch {
          setManifestError(
            'Unable to process explorer manifest data.',
          );
          setLoadingManifest(false);
        }
      },
      () => {
        setManifestError(
          'Unable to sync the explorer manifest. Please try again.',
        );
        setLoadingManifest(false);
      },
    );

    return unsubscribe;
  }, [
    currentUserId,
    manifestRetryKey,
  ]);

  /* ---------------------------------------------------------------------- */
  /*                         FRIENDSHIPS                                    */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!db || !currentUserId) {
      setOutgoingFriendships([]);
      setIncomingFriendships([]);
      return;
    }

    const outgoingQuery = query(
      collection(db, 'friendships'),
      where(
        'requesterId',
        '==',
        currentUserId,
      ),
    );

    const incomingQuery = query(
      collection(db, 'friendships'),
      where(
        'receiverId',
        '==',
        currentUserId,
      ),
    );

    const unsubOutgoing = onSnapshot(
      outgoingQuery,
      (snapshot) => {
        const friendships = snapshot.docs
          .map((docSnap) => {
            const data =
              docSnap.data() as Partial<FriendshipDocument>;

            if (
              typeof data.receiverId !== 'string' ||
              typeof data.status !== 'string'
            ) {
              return null;
            }

            return {
              docId: docSnap.id,
              targetUid: data.receiverId,
              status:
                data.status as FriendshipMeta['status'],
            };
          })
          .filter(
            (
              item,
            ): item is {
              docId: string;
              targetUid: string;
              status: FriendshipMeta['status'];
            } => item !== null,
          );

        setOutgoingFriendships(friendships);
      },
      () => {
        setOutgoingFriendships([]);
      },
    );

    const unsubIncoming = onSnapshot(
      incomingQuery,
      (snapshot) => {
        const friendships = snapshot.docs
          .map((docSnap) => {
            const data =
              docSnap.data() as Partial<FriendshipDocument>;

            if (
              typeof data.requesterId !== 'string' ||
              typeof data.status !== 'string'
            ) {
              return null;
            }

            return {
              docId: docSnap.id,
              targetUid: data.requesterId,
              status:
                data.status as FriendshipMeta['status'],
            };
          })
          .filter(
            (
              item,
            ): item is {
              docId: string;
              targetUid: string;
              status: FriendshipMeta['status'];
            } => item !== null,
          );

        setIncomingFriendships(friendships);
      },
      () => {
        setIncomingFriendships([]);
      },
    );

    return () => {
      unsubOutgoing();
      unsubIncoming();
    };
  }, [currentUserId]);

  /* ---------------------------------------------------------------------- */
  /*                         USER TELEMETRY                                 */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!db || !currentUserId) {
      setAllUsers([]);
      setLoadingExplorers(false);
      return;
    }

    setLoadingExplorers(true);
    setExplorerError('');

    const usersQuery = query(
      collection(db, 'users'),
      limit(MAX_EXPLORERS),
    );

    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        try {
          const users = snapshot.docs
            .filter(
              (docSnap) =>
                docSnap.id !== currentUserId,
            )
            .map((docSnap) => {
              const data =
                docSnap.data() as UserDocument & {
                  location?:
                    | GeoPoint
                    | {
                        latitude: number;
                        longitude: number;
                      }
                    | null;
                };

              return {
                uid: docSnap.id,
                name: normaliseName(
                  data.username,
                ),
                location:
                  getLocationFromUserData(data),
              };
            });

          setAllUsers(users);
          setLoadingExplorers(false);
        } catch {
          setExplorerError(
            'Unable to process explorer telemetry.',
          );
          setLoadingExplorers(false);
        }
      },
      () => {
        setExplorerError(
          'Unable to scan nearby explorer telemetry.',
        );
        setLoadingExplorers(false);
      },
    );

    return unsubscribe;
  }, [
    currentUserId,
    explorerRetryKey,
  ]);

  /* ---------------------------------------------------------------------- */
  /*                         NEARBY EXPLORERS                               */
  /* ---------------------------------------------------------------------- */

  const nearbyExplorers =
    useMemo<NearbyExplorer[]>(() => {
      if (
        !userCoordinates ||
        !isValidCoordinate(
          userCoordinates.latitude,
          userCoordinates.longitude,
        )
      ) {
        return [];
      }

      const explorers: NearbyExplorer[] = [];

      for (const user of allUsers) {
        if (!user.location) {
          continue;
        }

        const latitude =
          user.location.latitude;

        const longitude =
          user.location.longitude;

        if (
          !isValidCoordinate(
            latitude,
            longitude,
          )
        ) {
          continue;
        }

        const distanceKm =
          calculateHaversineDistanceKm(
            userCoordinates.latitude,
            userCoordinates.longitude,
            latitude,
            longitude,
          );

        if (
          !Number.isFinite(distanceKm) ||
          distanceKm > RADIUS_KM
        ) {
          continue;
        }

        explorers.push({
          uid: user.uid,
          name: user.name,
          initial:
            user.name.charAt(0) || 'A',
          distanceKm,
          distanceFormatted:
            formatDistance(distanceKm),
          hasValidLocation: true,
          friendMeta:
            friendshipsMap[user.uid],
        });
      }

      explorers.sort(
        (a, b) =>
          a.distanceKm - b.distanceKm,
      );

      return explorers;
    }, [
      allUsers,
      friendshipsMap,
      userCoordinates,
    ]);

  /* ---------------------------------------------------------------------- */
  /*                            SEARCH                                      */
  /* ---------------------------------------------------------------------- */

  const filteredExplorers =
    useMemo(() => {
      const search =
        searchAgentTag
          .trim()
          .toLowerCase();

      if (!search) {
        return nearbyExplorers;
      }

      return nearbyExplorers.filter(
        (explorer) =>
          explorer.name
            .toLowerCase()
            .includes(search),
      );
    }, [
      nearbyExplorers,
      searchAgentTag,
    ]);

  /* ---------------------------------------------------------------------- */
  /*                         FRIEND REQUEST                                 */
  /* ---------------------------------------------------------------------- */

  const handleSendFriendRequest = async (
    targetUid: string,
  ) => {
    if (
      !db ||
      !currentUserId ||
      !targetUid
    ) {
      return;
    }

    if (targetUid === currentUserId) {
      Alert.alert(
        'CANNOT LINK SELF',
        'You cannot create a friendship request with your own account.',
      );
      return;
    }

    if (actionUid) {
      return;
    }

    const existingMeta =
      friendshipsMap[targetUid];

    if (existingMeta) {
      switch (existingMeta.status) {
        case 'accepted':
          Alert.alert(
            'LINK ACTIVE',
            'You are already linked with this explorer.',
          );
          return;

        case 'pending':
          Alert.alert(
            'REQUEST ACTIVE',
            'A pending link request already exists with this explorer.',
          );
          return;

        case 'blocked':
          Alert.alert(
            'LINK BLOCKED',
            'This explorer cannot currently be linked.',
          );
          return;

        default:
          break;
      }
    }

    try {
      setActionUid(targetUid);

      const friendshipId =
        getDeterministicFriendshipId(
          currentUserId,
          targetUid,
        );

      const now = Timestamp.now();

      await setDoc(
        doc(
          db,
          'friendships',
          friendshipId,
        ),
        {
          friendshipId,
          requesterId: currentUserId,
          receiverId: targetUid,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        },
      );
    } catch {
      Alert.alert(
        'TRANSMISSION ERROR',
        'Failed to issue the friend link request.',
      );
    } finally {
      setActionUid(null);
    }
  };

  /* ---------------------------------------------------------------------- */
  /*                         ACCEPT REQUEST                                 */
  /* ---------------------------------------------------------------------- */

  const handleAcceptFriendRequest =
    async (
      friendship: FriendshipMeta,
    ) => {
      if (
        !db ||
        !currentUserId ||
        actionUid
      ) {
        return;
      }

      try {
        setActionUid(
          friendship.docId,
        );

        await updateDoc(
          doc(
            db,
            'friendships',
            friendship.docId,
          ),
          {
            status: 'accepted',
            updatedAt: Timestamp.now(),
          },
        );
      } catch {
        Alert.alert(
          'LINK ERROR',
          'Unable to accept the explorer link request.',
        );
      } finally {
        setActionUid(null);
      }
    };

  /* ---------------------------------------------------------------------- */
  /*                         REMOVE FRIENDSHIP                              */
  /* ---------------------------------------------------------------------- */

  const handleRemoveFriendship = (
    friendship: FriendshipMeta,
    agentName: string,
  ) => {
    if (
      !db ||
      !currentUserId
    ) {
      return;
    }

    const isOutgoingPending =
      friendship.status === 'pending' &&
      friendship.isRequester;

    Alert.alert(
      isOutgoingPending
        ? 'CANCEL REQUEST'
        : 'TERMINATE LINK',
      isOutgoingPending
        ? `Cancel the pending link request to ${agentName}?`
        : `Disconnect telemetry link with ${agentName}?`,
      [
        {
          text: 'CANCEL',
          style: 'cancel',
        },
        {
          text: isOutgoingPending
            ? 'CANCEL REQUEST'
            : 'UNLINK',
          style: 'destructive',
          onPress: async () => {
            if (actionUid) {
              return;
            }

            try {
              setActionUid(
                friendship.docId,
              );

              await deleteDoc(
                doc(
                  db,
                  'friendships',
                  friendship.docId,
                ),
              );
            } catch {
              Alert.alert(
                'LINK ERROR',
                'Unable to update the friendship record.',
              );
            } finally {
              setActionUid(null);
            }
          },
        },
      ],
    );
  };

  /* ---------------------------------------------------------------------- */
  /*                         SEARCH + LINK                                  */
  /* ---------------------------------------------------------------------- */

  const handleSearchAndLinkAgent =
    async () => {
      if (
        !db ||
        !currentUserId ||
        isSearching
      ) {
        return;
      }

      const searchTag =
        searchAgentTag
          .trim()
          .toLowerCase();

      if (!searchTag) {
        setSearchError(
          'ENTER AN AGENT CALLSIGN',
        );
        return;
      }

      setSearchError('');
      setIsSearching(true);

      try {
        const matchingExplorer =
          allUsers.find(
            (user) =>
              user.name
                .toLowerCase() ===
              searchTag,
          );

        if (!matchingExplorer) {
          setSearchError(
            'AGENT CALLSIGN NOT FOUND',
          );
          return;
        }

        if (
          matchingExplorer.uid ===
          currentUserId
        ) {
          setSearchError(
            'CANNOT LINK SELF CALLSIGN',
          );
          return;
        }

        await handleSendFriendRequest(
          matchingExplorer.uid,
        );

        setFriendModalVisible(false);
        setSearchAgentTag('');
        setSearchError('');
      } catch {
        setSearchError(
          'TRANSMISSION FAILED',
        );
      } finally {
        setIsSearching(false);
      }
    };

  /* ---------------------------------------------------------------------- */
  /*                            TELEGRAM                                    */
  /* ---------------------------------------------------------------------- */

  const handleDispatchTelegram =
    async () => {
      if (
        !db ||
        !currentUserId ||
        isTransmitting
      ) {
        return;
      }

      const trimmedMessage =
        telegramText.trim();

      if (!trimmedMessage) {
        Alert.alert(
          'EMPTY TELEGRAM',
          'Enter a message before transmitting the signal.',
        );
        return;
      }

      setIsTransmitting(true);

      try {
        /*
         * NEVER directly access:
         *
         * currentUser.displayName
         *
         * because authentication may not have completed.
         */
        const senderName =
          currentUser?.name ||
          'FIELD EXPLORER';

        const message =
          trimmedMessage.slice(
            0,
            MAX_TELEGRAM_LENGTH,
          );

        const messageRef =
          doc(collection(
            db,
            'messages',
          ));

        const activityRef =
          doc(collection(
            db,
            'activity_feed',
          ));

        const now =
          Timestamp.now();

        await setDoc(
          messageRef,
          {
            senderId:
              currentUserId,
            senderName,
            text: message,
            createdAt: now,
            type: 'GLOBAL_DISPATCH',
          },
        );

        await setDoc(
          activityRef,
          {
            userId:
              currentUserId,
            username:
              senderName,
            type:
              'TELEGRAM_DISPATCH',
            message:
              `DISPATCHED TELEGRAM: "${
                message.length > 30
                  ? `${message.substring(
                      0,
                      30,
                    )}...`
                  : message
              }"`,
            targetId: 'global',
            createdAt: now,
          },
        );

        setTelegramText('');
        setTelegramModalVisible(
          false,
        );

        Alert.alert(
          'SIGNAL TRANSMITTED',
          'Telegram broadcast dispatched to the active sector.',
        );
      } catch {
        Alert.alert(
          'TRANSMISSION FAILED',
          'The Telegram could not be dispatched. Check your connection and try again.',
        );
      } finally {
        setIsTransmitting(false);
      }
    };

  /* ---------------------------------------------------------------------- */
  /*                               RENDER                                   */
  /* ---------------------------------------------------------------------- */

  return (
    <View
      style={[
        styles.splitWrapper,
        {
          paddingLeft:
            Math.max(
              insets.left,
              12,
            ),
          paddingRight:
            Math.max(
              insets.right,
              12,
            ),
          paddingTop:
            Math.max(
              insets.top,
              8,
            ),
          paddingBottom:
            Math.max(
              insets.bottom,
              8,
            ),
        },
      ]}
    >
      {/* ================================================================== */}
      {/* LEFT: LEADERBOARD                                                  */}
      {/* ================================================================== */}

      <View style={styles.leftViewport}>
        <View style={styles.ledgerHeader}>
          <StarIcon
            color="#A64B2A"
            size={14}
          />

          <Text style={styles.header}>
            FIELD MANIFEST
          </Text>

          <StarIcon
            color="#A64B2A"
            size={14}
          />
        </View>

        <Text style={styles.subHeader}>
          EXCAVATION POINTS LEDGER · SHASTA SECTOR
        </Text>

        <View style={styles.tableHeader}>
          <Text
            style={[
              styles.colHeader,
              { flex: 0.15 },
            ]}
          >
            NO.
          </Text>

          <Text
            style={[
              styles.colHeader,
              { flex: 0.55 },
            ]}
          >
            EXPLORER
          </Text>

          <Text
            style={[
              styles.colHeader,
              {
                flex: 0.3,
                textAlign: 'right',
              },
            ]}
          >
            POINTS
          </Text>
        </View>

        {loadingManifest ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator
              size="small"
              color="#2A2420"
            />

            <Text style={styles.loadingText}>
              SYNCING MANIFEST DATA...
            </Text>
          </View>
        ) : manifestError ? (
          <View style={styles.loadingBox}>
            <Text style={styles.errorText}>
              {manifestError}
            </Text>

            <TouchableOpacity
              style={
                styles.inlineRetryButton
              }
              onPress={() => {
                setManifestError('');
                setLoadingManifest(true);
                setManifestRetryKey(
                  (value) =>
                    value + 1,
                );
              }}
              accessibilityRole="button"
              accessibilityLabel="Retry leaderboard sync"
            >
              <Text
                style={
                  styles.inlineRetryText
                }
              >
                RETRY
              </Text>
            </TouchableOpacity>
          </View>
        ) : manifest.length === 0 ? (
          <View style={styles.loadingBox}>
            <Text
              style={styles.emptyText}
            >
              NO EXPLORERS IN THE MANIFEST
            </Text>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={
              false
            }
            contentContainerStyle={
              styles.ledgerList
            }
            accessibilityLabel="Explorer leaderboard"
          >
            {manifest.map((item) => (
              <View
                key={item.uid}
                style={[
                  styles.rowContainer,
                  item.isUser &&
                    styles.rowHighlight,
                ]}
                accessible
                accessibilityLabel={`Rank ${Number(
                  item.rank,
                )}. ${item.name}. ${
                  item.points
                } points.`}
              >
                <Text
                  style={[
                    styles.rowText,
                    item.isUser &&
                      styles.rowHighlightText,
                    {
                      flex: 0.15,
                    },
                  ]}
                >
                  {item.rank}
                </Text>

                <Text
                  style={[
                    styles.rowText,
                    item.isUser &&
                      styles.rowHighlightText,
                    {
                      flex: 0.55,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>

                <View
                  style={
                    styles.dotLeaderContainer
                  }
                >
                  <Text
                    style={
                      styles.dotLeader
                    }
                    numberOfLines={1}
                  >
                    ...................................
                  </Text>
                </View>

                <Text
                  style={[
                    styles.rowText,
                    item.isUser &&
                      styles.rowHighlightText,
                    {
                      flex: 0.3,
                      textAlign:
                        'right',
                    },
                  ]}
                >
                  {item.points}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* ================================================================== */}
      {/* RIGHT: NEARBY AGENTS                                               */}
      {/* ================================================================== */}

      <View style={styles.rightViewport}>
        <View style={styles.rightHeaderRow}>
          <View style={{ flex: 1 }}>
            <View
              style={
                styles.panelTitleRow
              }
            >
              <StarIcon
                color="#B08D57"
                size={10}
              />

              <Text
                style={
                  styles.panelTitle
                }
              >
                NEARBY AGENTS
              </Text>
            </View>

            <Text style={styles.subText}>
              Active Units Within 20km Radius
            </Text>
          </View>

          <TouchableOpacity
            style={
              styles.iconAddButton
            }
            onPress={() => {
              setSearchError('');
              setSearchAgentTag('');
              setFriendModalVisible(
                true,
              );
            }}
            accessibilityLabel="Link new explorer callsign"
            accessibilityHint="Opens the explorer linking form"
            accessibilityRole="button"
          >
            <UserPlusIcon
              color="#B08D57"
              size={16}
            />
          </TouchableOpacity>
        </View>

        {loadingExplorers ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator
              size="small"
              color="#E8DCC0"
            />

            <Text
              style={
                styles.loadingTextDark
              }
            >
              SCANNING EXPLORER TELEMETRY...
            </Text>
          </View>
        ) : explorerError ? (
          <View style={styles.loadingBox}>
            <Text
              style={
                styles.errorTextDark
              }
            >
              {explorerError}
            </Text>

            <TouchableOpacity
              style={
                styles.darkRetryButton
              }
              onPress={() => {
                setExplorerError('');
                setLoadingExplorers(true);
                setExplorerRetryKey(
                  (value) =>
                    value + 1,
                );
              }}
              accessibilityRole="button"
              accessibilityLabel="Retry nearby explorer scan"
            >
              <Text
                style={
                  styles.darkRetryText
                }
              >
                RECONNECT
              </Text>
            </TouchableOpacity>
          </View>
        ) : !userCoordinates ? (
          <View style={styles.loadingBox}>
            <Text
              style={styles.emptyText}
            >
              YOUR LOCATION IS UNAVAILABLE
            </Text>

            <Text
              style={
                styles.loadingTextDark
              }
            >
              Nearby range cannot be verified without a valid GPS position.
            </Text>
          </View>
        ) : filteredExplorers.length ===
          0 ? (
          <View style={styles.loadingBox}>
            <Text
              style={styles.emptyText}
            >
              {searchAgentTag.trim()
                ? 'NO MATCHING AGENTS IN 20KM RADIUS'
                : 'NO AGENTS DETECTED IN 20KM RADIUS'}
            </Text>
          </View>
        ) : (
          <ScrollView
            style={
              styles.cardsContainer
            }
            showsVerticalScrollIndicator={
              false
            }
            accessibilityLabel="Nearby explorers"
          >
            {filteredExplorers.map(
              (item) => {
                const friendMeta =
                  item.friendMeta;

                const isPending =
                  friendMeta?.status ===
                  'pending';

                const isAccepted =
                  friendMeta?.status ===
                  'accepted';

                const isIncomingRequest =
                  isPending &&
                  !friendMeta
                    ?.isRequester;

                const isActing =
                  actionUid ===
                    item.uid ||
                  actionUid ===
                    friendMeta?.docId;

                return (
                  <View
                    key={item.uid}
                    style={
                      styles.explorerCard
                    }
                    accessible
                    accessibilityLabel={`${item.name}. Range ${item.distanceFormatted}. ${
                      isAccepted
                        ? 'Friends'
                        : isIncomingRequest
                          ? 'Friend request received'
                          : isPending
                            ? 'Friend request pending'
                            : 'Not linked'
                    }`}
                  >
                    <View
                      style={
                        styles.cardLeft
                      }
                    >
                      <View
                        style={
                          styles.avatarCircle
                        }
                      >
                        <Text
                          style={
                            styles.avatarText
                          }
                        >
                          {item.initial}
                        </Text>
                      </View>

                      <View
                        style={{
                          flex: 1,
                        }}
                      >
                        <Text
                          style={
                            styles.explorerName
                          }
                          numberOfLines={
                            1
                          }
                        >
                          {item.name}
                        </Text>

                        <Text
                          style={
                            styles.explorerMeta
                          }
                        >
                          RANGE:{' '}
                          {
                            item.distanceFormatted
                          }
                        </Text>
                      </View>
                    </View>

                    <View
                      style={
                        styles.cardRight
                      }
                    >
                      <View
                        style={
                          styles.onlineDot
                        }
                      />

                      {!friendMeta && (
                        <TouchableOpacity
                          style={[
                            styles.friendActionButton,
                            isActing &&
                              styles.disabledButton,
                          ]}
                          onPress={() =>
                            handleSendFriendRequest(
                              item.uid,
                            )
                          }
                          disabled={
                            isActing
                          }
                          accessibilityLabel={`Send link request to ${item.name}`}
                          accessibilityRole="button"
                        >
                          {isActing ? (
                            <ActivityIndicator
                              size="small"
                              color="#2C3B2E"
                            />
                          ) : (
                            <UserPlusIcon
                              color="#2C3B2E"
                              size={14}
                            />
                          )}
                        </TouchableOpacity>
                      )}

                      {isIncomingRequest && (
                        <View
                          style={
                            styles.actionGroup
                          }
                        >
                          <TouchableOpacity
                            style={[
                              styles.friendActionButton,
                              {
                                backgroundColor:
                                  '#4CAF50',
                              },
                            ]}
                            onPress={() =>
                              handleAcceptFriendRequest(
                                friendMeta,
                              )
                            }
                            disabled={
                              isActing
                            }
                            accessibilityLabel={`Accept friend request from ${item.name}`}
                            accessibilityRole="button"
                          >
                            {isActing ? (
                              <ActivityIndicator
                                size="small"
                                color="#FFFFFF"
                              />
                            ) : (
                              <UserCheckIcon
                                color="#FFFFFF"
                                size={12}
                              />
                            )}
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[
                              styles.friendActionButton,
                              {
                                backgroundColor:
                                  '#A64B2A',
                              },
                            ]}
                            onPress={() =>
                              handleRemoveFriendship(
                                friendMeta,
                                item.name,
                              )
                            }
                            disabled={
                              isActing
                            }
                            accessibilityLabel={`Decline friend request from ${item.name}`}
                            accessibilityRole="button"
                          >
                            <UserXIcon
                              color="#FFFFFF"
                              size={12}
                            />
                          </TouchableOpacity>
                        </View>
                      )}

                      {isPending &&
                        friendMeta?.isRequester && (
                          <TouchableOpacity
                            style={[
                              styles.friendActionButton,
                              {
                                backgroundColor:
                                  '#D9B98A',
                              },
                              isActing &&
                                styles.disabledButton,
                            ]}
                            onPress={() =>
                              handleRemoveFriendship(
                                friendMeta,
                                item.name,
                              )
                            }
                            disabled={
                              isActing
                            }
                            accessibilityLabel={`Cancel pending friend request to ${item.name}`}
                            accessibilityRole="button"
                          >
                            {isActing ? (
                              <ActivityIndicator
                                size="small"
                                color="#2A2420"
                              />
                            ) : (
                              <Text
                                style={
                                  styles.pendingText
                                }
                              >
                                PENDING
                              </Text>
                            )}
                          </TouchableOpacity>
                        )}

                      {isAccepted && (
                        <TouchableOpacity
                          style={[
                            styles.friendActionButton,
                            {
                              backgroundColor:
                                '#CBBBA0',
                            },
                            isActing &&
                              styles.disabledButton,
                          ]}
                          onPress={() =>
                            handleRemoveFriendship(
                              friendMeta,
                              item.name,
                            )
                          }
                          disabled={
                            isActing
                          }
                          accessibilityLabel={`Remove friendship with ${item.name}`}
                          accessibilityRole="button"
                        >
                          {isActing ? (
                            <ActivityIndicator
                              size="small"
                              color="#2C3B2E"
                            />
                          ) : (
                            <UserCheckIcon
                              color="#2C3B2E"
                              size={14}
                            />
                          )}
                        </TouchableOpacity>
                      )}

                      {friendMeta?.status ===
                        'declined' && (
                        <Text
                          style={
                            styles.statusText
                          }
                        >
                          DECLINED
                        </Text>
                      )}

                      {friendMeta?.status ===
                        'blocked' && (
                        <Text
                          style={
                            styles.statusText
                          }
                        >
                          BLOCKED
                        </Text>
                      )}
                    </View>
                  </View>
                );
              },
            )}
          </ScrollView>
        )}

        {/* ================================================================= */}
        {/* TELEGRAM BUTTON                                                   */}
        {/* ================================================================= */}

        <View
          style={{
            marginBottom: 6,
          }}
        >
          <TouchableOpacity
            activeOpacity={0.88}
            style={
              styles.dispatchButton
            }
            onPress={() => {
              setTelegramText('');
              setTelegramModalVisible(
                true,
              );
            }}
            accessibilityLabel="Dispatch Telegram signal"
            accessibilityHint="Opens the broadcast message composer"
            accessibilityRole="button"
          >
            <Text
              style={
                styles.dispatchText
              }
            >
              DISPATCH TELEGRAM
            </Text>
          </TouchableOpacity>
        </View>

        <FieldNavBar
          currentTab={currentTab}
          onNavigate={onNavigate}
        />
      </View>

      {/* ================================================================== */}
      {/* TELEGRAM MODAL                                                     */}
      {/* ================================================================== */}

      <Modal
        visible={
          telegramModalVisible
        }
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => {
          if (!isTransmitting) {
            setTelegramModalVisible(
              false,
            );
          }
        }}
      >
        <KeyboardAvoidingView
          style={
            styles.modalOverlay
          }
          behavior={
            Platform.OS === 'ios'
              ? 'padding'
              : undefined
          }
        >
          <Pressable
            style={
              StyleSheet.absoluteFill
            }
            onPress={() => {
              if (!isTransmitting) {
                setTelegramModalVisible(
                  false,
                );
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Close Telegram dialog"
          />

          <View
            style={[
              styles.modalCard,
              !isLandscape &&
                styles.modalCardPortrait,
            ]}
            onStartShouldSetResponder={() =>
              true
            }
          >
            <View
              style={
                styles.modalHeader
              }
            >
              <View
                style={{
                  flex: 1,
                }}
              >
                <Text
                  style={
                    styles.modalTitle
                  }
                >
                  BROADCAST TELEGRAM
                </Text>

                <Text
                  style={
                    styles.modalSub
                  }
                >
                  Sector-wide dispatch. This feature is a broadcast signal, not a private chat.
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => {
                  if (
                    !isTransmitting
                  ) {
                    setTelegramModalVisible(
                      false,
                    );
                  }
                }}
                disabled={
                  isTransmitting
                }
                accessibilityLabel="Close Telegram dialog"
                accessibilityRole="button"
                style={
                  styles.closeButton
                }
              >
                <CloseIcon
                  color="#B08D57"
                  size={18}
                />
              </TouchableOpacity>
            </View>

            <TextInput
              style={
                styles.telegramInput
              }
              placeholder="Type dispatch message..."
              placeholderTextColor="#8A7B66"
              multiline
              value={telegramText}
              maxLength={
                MAX_TELEGRAM_LENGTH
              }
              onChangeText={
                setTelegramText
              }
              accessibilityLabel="Telegram message"
              accessibilityHint="Enter the broadcast message you want to dispatch"
            />

            <Text
              style={
                styles.charCount
              }
            >
              {telegramText.length}/
              {MAX_TELEGRAM_LENGTH}
            </Text>

            <TouchableOpacity
              style={[
                styles.sendButton,
                isTransmitting &&
                  styles.disabledButton,
              ]}
              onPress={
                handleDispatchTelegram
              }
              disabled={
                isTransmitting
              }
              accessibilityLabel={
                isTransmitting
                  ? 'Transmitting Telegram'
                  : 'Transmit Telegram'
              }
              accessibilityRole="button"
            >
              {isTransmitting ? (
                <>
                  <ActivityIndicator
                    size="small"
                    color="#F3ECD8"
                  />

                  <Text
                    style={
                      styles.sendButtonText
                    }
                  >
                    TRANSMITTING...
                  </Text>
                </>
              ) : (
                <>
                  <SendIcon
                    color="#F3ECD8"
                    size={16}
                  />

                  <Text
                    style={
                      styles.sendButtonText
                    }
                  >
                    TRANSMIT SIGNAL
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ================================================================== */}
      {/* LINK EXPLORER MODAL                                                */}
      {/* ================================================================== */}

      <Modal
        visible={
          friendModalVisible
        }
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => {
          if (
            !isSearching &&
            !actionUid
          ) {
            setFriendModalVisible(
              false,
            );
          }
        }}
      >
        <KeyboardAvoidingView
          style={
            styles.modalOverlay
          }
          behavior={
            Platform.OS === 'ios'
              ? 'padding'
              : undefined
          }
        >
          <Pressable
            style={
              StyleSheet.absoluteFill
            }
            onPress={() => {
              if (
                !isSearching &&
                !actionUid
              ) {
                setFriendModalVisible(
                  false,
                );
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Close explorer linking dialog"
          />

          <View
            style={[
              styles.modalCard,
              !isLandscape &&
                styles.modalCardPortrait,
            ]}
            onStartShouldSetResponder={() =>
              true
            }
          >
            <View
              style={
                styles.modalHeader
              }
            >
              <View
                style={{
                  flex: 1,
                }}
              >
                <Text
                  style={
                    styles.modalTitle
                  }
                >
                  LINK NEW EXPLORER
                </Text>

                <Text
                  style={
                    styles.modalSub
                  }
                >
                  Enter an exact explorer callsign to issue a link request.
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => {
                  if (
                    !isSearching &&
                    !actionUid
                  ) {
                    setFriendModalVisible(
                      false,
                    );
                  }
                }}
                disabled={
                  isSearching ||
                  !!actionUid
                }
                accessibilityLabel="Close explorer linking dialog"
                accessibilityRole="button"
                style={
                  styles.closeButton
                }
              >
                <CloseIcon
                  color="#B08D57"
                  size={18}
                />
              </TouchableOpacity>
            </View>

            {searchError ? (
              <Text
                style={
                  styles.errorText
                }
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
              >
                {searchError}
              </Text>
            ) : null}

            <TextInput
              style={
                styles.tagInput
              }
              placeholder="AGENT_CALLSIGN"
              placeholderTextColor="#8A7B66"
              autoCapitalize="none"
              autoCorrect={false}
              value={searchAgentTag}
              onChangeText={(text) => {
                setSearchAgentTag(
                  text,
                );
                setSearchError('');
              }}
              accessibilityLabel="Explorer callsign"
              accessibilityHint="Enter the exact username of the explorer you want to link"
            />

            <TouchableOpacity
              style={[
                styles.sendButton,
                isSearching &&
                  styles.disabledButton,
              ]}
              onPress={
                handleSearchAndLinkAgent
              }
              disabled={
                isSearching
              }
              accessibilityLabel={
                isSearching
                  ? 'Searching for explorer'
                  : 'Send link request'
              }
              accessibilityRole="button"
            >
              {isSearching ? (
                <>
                  <ActivityIndicator
                    size="small"
                    color="#F3ECD8"
                  />

                  <Text
                    style={
                      styles.sendButtonText
                    }
                  >
                    SEARCHING...
                  </Text>
                </>
              ) : (
                <>
                  <UserPlusIcon
                    color="#F3ECD8"
                    size={16}
                  />

                  <Text
                    style={
                      styles.sendButtonText
                    }
                  >
                    SEND LINK REQUEST
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

/* -------------------------------------------------------------------------- */
/*                                   STYLES                                  */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  splitWrapper: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#1C281E',
  },

  leftViewport: {
    flex: 0.6,
    minWidth: 0,
    backgroundColor: '#E8DCC0',
    padding: 16,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
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
    paddingHorizontal: 16,
  },

  loadingText: {
    color: '#2A2420',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
    textAlign: 'center',
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

  inlineRetryButton: {
    backgroundColor: '#A64B2A',
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 40,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },

  inlineRetryText: {
    color: '#F3ECD8',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
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

  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 4,
    marginBottom: 2,
  },

  rowHighlight: {
    backgroundColor: '#D9B98A',
  },

  rowText: {
    color: '#2A2420',
    fontFamily:
      Platform.OS === 'ios'
        ? 'Courier'
        : 'monospace',
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
    fontFamily:
      Platform.OS === 'ios'
        ? 'Courier'
        : 'monospace',
    fontSize: 10,
  },

  rightViewport: {
    flex: 0.4,
    minWidth: 0,
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

  panelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    minWidth: 40,
    minHeight: 40,
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
    fontFamily:
      Platform.OS === 'ios'
        ? 'Courier'
        : 'monospace',
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
    marginLeft: 4,
  },

  actionGroup: {
    flexDirection: 'row',
    gap: 4,
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
    minWidth: 38,
    minHeight: 38,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },

  disabledButton: {
    opacity: 0.55,
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

  dispatchButton: {
    backgroundColor: '#A64B2A',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderStyle: 'dashed',
    paddingVertical: 8,
    borderRadius: 4,
    alignItems: 'center',
    minHeight: 44,
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
    backgroundColor:
      'rgba(10, 16, 11, 0.82)',
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
    maxHeight: '90%',
  },

  modalCardPortrait: {
    width: '90%',
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

  telegramInput: {
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    padding: 10,
    color: '#2A2420',
    fontFamily:
      Platform.OS === 'ios'
        ? 'Courier'
        : 'monospace',
    minHeight: 90,
    textAlignVertical: 'top',
    fontSize: 12,
    marginBottom: 4,
  },

  charCount: {
    color: '#8A7B66',
    fontSize: 8,
    textAlign: 'right',
    marginBottom: 10,
  },

  tagInput: {
    backgroundColor: '#F3ECD8',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    padding: 10,
    color: '#2A2420',
    fontFamily:
      Platform.OS === 'ios'
        ? 'Courier'
        : 'monospace',
    fontSize: 12,
    marginBottom: 12,
    minHeight: 44,
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

export default LeaderboardScreen;