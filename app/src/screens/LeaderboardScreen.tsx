import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { UserDocument } from '../types/firestore';
import { FieldNavBar, NavigationTab } from '../components/FieldNavBar';

/* -------------------------------------------------------------------------- */
/* Icons                                                                      */
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
    accessibilityLabel="Star"
  >
    <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </Svg>
);

const UserPlusIcon = ({
  color = '#F3ECD8',
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
    accessibilityLabel="Add friend"
  >
    <Path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <Path d="M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
    <Path d="M20 8v6" />
    <Path d="M23 11h-6" />
  </Svg>
);

const SendIcon = ({
  color = '#F3ECD8',
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
    accessibilityLabel="Dispatch Telegram"
  >
    <Path d="M22 2L11 13" />
    <Path d="M22 2l-7 20-4-9-9-4 20-7z" />
  </Svg>
);

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface ExplorerEntry {
  uid: string;
  rank: string;
  name: string;
  points: string;
  isUser: boolean;
}

interface Props {
  onBack?: () => void;
  onNavigate?: (tab: string) => void;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MAX_LEADERBOARD_ENTRIES = 50;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const normaliseName = (value: unknown): string => {
  const name = typeof value === 'string' ? value.trim() : '';

  return name ? name.toUpperCase() : 'AGENT';
};

const formatPoints = (value: unknown): string => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value)
  ) {
    return '0';
  }

  return value.toLocaleString();
};

/* -------------------------------------------------------------------------- */
/* Leaderboard Screen                                                         */
/* -------------------------------------------------------------------------- */

export const LeaderboardScreen: React.FC<Props> = ({
  onNavigate,
}) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const isLandscape = width > height;
  const currentTab: NavigationTab = 'LEADERBOARD';

  const currentUserId = auth?.currentUser?.uid ?? '';

  const [manifest, setManifest] = useState<ExplorerEntry[]>([]);
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [manifestError, setManifestError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  /* ------------------------------------------------------------------------ */
  /* Navigation                                                               */
  /* ------------------------------------------------------------------------ */

  /**
   * All social actions are intentionally routed through SocialScreen.
   *
   * LeaderboardScreen does not own:
   * - friendship state
   * - nearby explorers
   * - Telegram messages
   * - friendship requests
   * - Telegram modals
   *
   * This keeps the leaderboard focused exclusively on rankings.
   */
  const navigateToSocial = () => {
    if (!onNavigate) {
      return;
    }

    onNavigate('SOCIAL');
  };

  const handleAddFriendPress = () => {
    navigateToSocial();
  };

  const handleDispatchTelegramPress = () => {
    navigateToSocial();
  };

  /* ------------------------------------------------------------------------ */
  /* Firestore Leaderboard                                                    */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!db) {
      setManifestError('Database connection unavailable.');
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
        const entries: ExplorerEntry[] = snapshot.docs.map(
          (docSnap, index) => {
            const data = docSnap.data() as UserDocument;

            const isUser = docSnap.id === currentUserId;

            const username = normaliseName(data.username);

            return {
              uid: docSnap.id,
              rank: String(index + 1).padStart(2, '0'),
              name: isUser
                ? `YOU - ${username}`
                : username,
              points: formatPoints(data.totalPoints),
              isUser,
            };
          },
        );

        setManifest(entries);
        setLoadingManifest(false);
      },
      () => {
        setManifestError(
          'Unable to sync the explorer manifest. Please try again.',
        );
        setLoadingManifest(false);
      },
    );

    return unsubscribe;
  }, [currentUserId, retryKey]);

  /* ------------------------------------------------------------------------ */
  /* Render                                                                   */
  /* ------------------------------------------------------------------------ */

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
      <View style={styles.content}>
        {/* ---------------------------------------------------------------- */}
        {/* Header                                                           */}
        {/* ---------------------------------------------------------------- */}

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

        {/* ---------------------------------------------------------------- */}
        {/* Table Header                                                     */}
        {/* ---------------------------------------------------------------- */}

        <View style={styles.tableHeader}>
          <Text
            style={[
              styles.colHeader,
              styles.rankColumn,
            ]}
          >
            NO.
          </Text>

          <Text
            style={[
              styles.colHeader,
              styles.nameColumn,
            ]}
          >
            EXPLORER
          </Text>

          <Text
            style={[
              styles.colHeader,
              styles.pointsColumn,
            ]}
          >
            POINTS
          </Text>
        </View>

        {/* ---------------------------------------------------------------- */}
        {/* Leaderboard                                                      */}
        {/* ---------------------------------------------------------------- */}

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
              style={styles.retryButton}
              onPress={() => {
                setManifestError('');
                setLoadingManifest(true);
                setRetryKey((value) => value + 1);
              }}
              accessibilityRole="button"
              accessibilityLabel="Retry leaderboard sync"
            >
              <Text style={styles.retryText}>
                RETRY
              </Text>
            </TouchableOpacity>
          </View>
        ) : manifest.length === 0 ? (
          <View style={styles.loadingBox}>
            <Text style={styles.emptyText}>
              NO EXPLORERS IN THE MANIFEST
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.leaderboardScroll}
            contentContainerStyle={styles.ledgerList}
            showsVerticalScrollIndicator={false}
            accessibilityLabel="Explorer leaderboard"
          >
            {manifest.map((item) => (
              <View
                key={item.uid}
                style={[
                  styles.rowContainer,
                  item.isUser && styles.rowHighlight,
                ]}
                accessible
                accessibilityLabel={`Rank ${Number(
                  item.rank,
                )}. ${item.name}. ${item.points} points.`}
              >
                <Text
                  style={[
                    styles.rowText,
                    styles.rankColumn,
                    item.isUser &&
                      styles.rowHighlightText,
                  ]}
                >
                  {item.rank}
                </Text>

                <Text
                  style={[
                    styles.rowText,
                    styles.nameColumn,
                    item.isUser &&
                      styles.rowHighlightText,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {item.name}
                </Text>

                <View style={styles.dotLeaderContainer}>
                  <Text
                    style={styles.dotLeader}
                    numberOfLines={1}
                  >
                    ................................
                  </Text>
                </View>

                <Text
                  style={[
                    styles.rowText,
                    styles.pointsColumn,
                    item.isUser &&
                      styles.rowHighlightText,
                  ]}
                >
                  {item.points}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Social Actions                                                   */}
        {/* ---------------------------------------------------------------- */}

        <View
          style={[
            styles.socialActions,
            isLandscape
              ? styles.socialActionsLandscape
              : styles.socialActionsPortrait,
          ]}
        >
          {/* ADD FRIEND */}
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.socialActionButton}
            onPress={handleAddFriendPress}
            accessibilityRole="button"
            accessibilityLabel="Add friend"
            accessibilityHint="Opens the Social screen where you can add friends"
          >
            <UserPlusIcon
              color="#F3ECD8"
              size={16}
            />

            <Text style={styles.socialActionText}>
              ADD FRIEND
            </Text>
          </TouchableOpacity>

          {/* DISPATCH TELEGRAM */}
          <TouchableOpacity
            activeOpacity={0.85}
            style={[
              styles.socialActionButton,
              styles.telegramActionButton,
            ]}
            onPress={handleDispatchTelegramPress}
            accessibilityRole="button"
            accessibilityLabel="Dispatch Telegram"
            accessibilityHint="Opens the Social screen where you can dispatch a Telegram"
          >
            <SendIcon
              color="#F3ECD8"
              size={16}
            />

            <Text style={styles.socialActionText}>
              DISPATCH TELEGRAM
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* Navigation                                                         */}
      {/* ------------------------------------------------------------------ */}

      <FieldNavBar
        currentTab={currentTab}
        onNavigate={onNavigate}
      />
    </View>
  );
};

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#E8DCC0',
  },

  content: {
    flex: 1,
    minHeight: 0,
  },

  /* Header */

  ledgerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 4,
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

  /* Table */

  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
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

  rankColumn: {
    flex: 0.15,
  },

  nameColumn: {
    flex: 0.45,
    minWidth: 0,
  },

  pointsColumn: {
    flex: 0.25,
    textAlign: 'right',
  },

  leaderboardScroll: {
    flex: 1,
    minHeight: 0,
  },

  ledgerList: {
    paddingBottom: 10,
  },

  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 4,
    marginBottom: 2,
    minHeight: 34,
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
    flex: 0.15,
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

  /* Loading / Empty */

  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },

  loadingText: {
    color: '#2A2420',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
    textAlign: 'center',
  },

  errorText: {
    color: '#A64B2A',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 8,
  },

  emptyText: {
    color: '#8A7B66',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
    textAlign: 'center',
  },

  retryButton: {
    backgroundColor: '#A64B2A',
    paddingHorizontal: 18,
    paddingVertical: 9,
    minHeight: 40,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },

  retryText: {
    color: '#F3ECD8',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  },

  /* Social Actions */

  socialActions: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 8,
    paddingBottom: 8,
  },

  socialActionsLandscape: {
    minHeight: 52,
  },

  socialActionsPortrait: {
    minHeight: 52,
  },

  socialActionButton: {
    flex: 1,
    minHeight: 46,
    backgroundColor: '#2C3B2E',
    borderWidth: 1,
    borderColor: '#B08D57',
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 8,
  },

  telegramActionButton: {
    backgroundColor: '#A64B2A',
  },

  socialActionText: {
    color: '#F3ECD8',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
    textAlign: 'center',
  },
});