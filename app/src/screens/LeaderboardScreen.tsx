import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Ionicons,
  MaterialCommunityIcons,
} from '@expo/vector-icons';

import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';

import {
  auth,
  db,
} from '../config/firebase';

import {
  FieldNavBar,
  type NavigationTab,
} from '../components/FieldNavBar';

import type {
  UserDocument,
} from '../types/firestore';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface ExplorerEntry {
  uid: string;
  rank: number;
  username: string;
  points: number;
  isCurrentUser: boolean;
}

interface Props {
  onBack?: () => void;

  onNavigate?: (
    tab: string,
  ) => void;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MAX_LEADERBOARD_ENTRIES =
  50;

const COLOURS = {
  forest950: '#172018',
  forest900: '#1C261D',
  forest800: '#2C3B2E',
  forest700: '#3D503F',

  parchment100: '#F6EFD9',
  parchment200: '#E8DCC0',

  ink900: '#2A2420',
  ink700: '#514A40',

  bronze700: '#5F4B32',
  bronze600: '#6B563A',
  bronze500: '#B08D57',
  bronze400: '#C3A06A',

  rust800: '#71301C',
  rust700: '#7F321B',
  rust600: '#8C3A20',

  success700: '#3E6546',
  success300: '#BFE3C0',

  warning300: '#E6C580',
  danger300: '#FFB4A2',
} as const;

const MONO_FONT =
  Platform.OS === 'ios'
    ? 'Courier'
    : 'monospace';

const MONO_BOLD_FONT =
  Platform.OS === 'ios'
    ? 'Courier-Bold'
    : 'monospace';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Keeps development diagnostics out of production console output.
const logDevelopmentWarning = (
  message: string,
  error?: unknown,
): void => {
  if (__DEV__) {
    console.warn(
      message,
      error ?? '',
    );
  }
};

// Safely converts an Explorer name into the field-interface format.
const normaliseUsername = (
  value: unknown,
  fallback =
    'EXPLORER',
): string => {
  if (
    typeof value !==
    'string'
  ) {
    return fallback;
  }

  const trimmed =
    value.trim();

  return trimmed
    ? trimmed.toUpperCase()
    : fallback;
};

// Protects the leaderboard from malformed point values.
const normalisePoints = (
  value: unknown,
): number => {
  if (
    typeof value !==
      'number' ||
    !Number.isFinite(
      value,
    ) ||
    value < 0
  ) {
    return 0;
  }

  return Math.floor(
    value,
  );
};

// Formats points consistently across the field interface.
const formatPoints = (
  points: number,
): string =>
  points.toLocaleString();

// Uses the same rank thresholds as Dashboard.
const getRankTitle = (
  points: number,
): string => {
  if (
    points >=
    3000
  ) {
    return 'MASTER EXPLORER';
  }

  if (
    points >=
    1500
  ) {
    return 'TRAILBLAZER III';
  }

  if (
    points >=
    500
  ) {
    return 'PATHFINDER II';
  }

  return 'NOVICE SCOUT I';
};

// Provides readable podium labels without inventing additional ranks.
const getPodiumLabel = (
  rank: number,
): string => {
  switch (rank) {
    case 1:
      return 'FIRST';

    case 2:
      return 'SECOND';

    case 3:
      return 'THIRD';

    default:
      return `#${rank}`;
  }
};

/* -------------------------------------------------------------------------- */
/* Leaderboard                                                               */
/* -------------------------------------------------------------------------- */

export const LeaderboardScreen:
  React.FC<Props> = ({
    onBack,
    onNavigate,
  }) => {
    const {
      width,
      height,
    } =
      useWindowDimensions();

    const insets =
      useSafeAreaInsets();

    const isLandscape =
      width > height;

    const currentTab:
      NavigationTab =
      'LEADERBOARD';

    const currentUser =
      auth.currentUser;

    const currentUserId =
      currentUser?.uid ??
      '';

    /* ---------------------------------------------------------------------- */
    /* Firestore state                                                       */
    /* ---------------------------------------------------------------------- */

    const [
      manifest,
      setManifest,
    ] =
      useState<
        ExplorerEntry[]
      >([]);

    const [
      currentUserProfile,
      setCurrentUserProfile,
    ] =
      useState<UserDocument | null>(
        null,
      );

    const [
      loadingManifest,
      setLoadingManifest,
    ] =
      useState(true);

    const [
      loadingProfile,
      setLoadingProfile,
    ] =
      useState(true);

    const [
      manifestError,
      setManifestError,
    ] =
      useState<
        string | null
      >(null);

    const [
      profileError,
      setProfileError,
    ] =
      useState<
        string | null
      >(null);

    const [
      retryKey,
      setRetryKey,
    ] =
      useState(0);

    /* ---------------------------------------------------------------------- */
    /* Firestore subscriptions                                               */
    /* ---------------------------------------------------------------------- */

    useEffect(() => {
      if (
        !currentUserId
      ) {
        setManifest(
          [],
        );

        setCurrentUserProfile(
          null,
        );

        setLoadingManifest(
          false,
        );

        setLoadingProfile(
          false,
        );

        setManifestError(
          'EXPLORER SESSION REQUIRED',
        );

        setProfileError(
          'PROFILE UNAVAILABLE',
        );

        return;
      }

      setLoadingManifest(
        true,
      );

      setLoadingProfile(
        true,
      );

      setManifestError(
        null,
      );

      setProfileError(
        null,
      );

      /* -------------------------------------------------------------------- */
      /* Top explorers                                                        */
      /* -------------------------------------------------------------------- */

      const leaderboardQuery =
        query(
          collection(
            db,
            'users',
          ),

          orderBy(
            'totalPoints',
            'desc',
          ),

          limit(
            MAX_LEADERBOARD_ENTRIES,
          ),
        );

      const unsubscribeLeaderboard =
        onSnapshot(
          leaderboardQuery,

          (
            snapshot,
          ) => {
            const entries:
              ExplorerEntry[] =
              snapshot.docs.map(
                (
                  documentSnapshot,
                  index,
                ) => {
                  const data =
                    documentSnapshot.data() as
                      UserDocument;

                  return {
                    uid:
                      documentSnapshot.id,

                    rank:
                      index + 1,

                    username:
                      normaliseUsername(
                        data.username,
                      ),

                    points:
                      normalisePoints(
                        data.totalPoints,
                      ),

                    isCurrentUser:
                      documentSnapshot.id ===
                      currentUserId,
                  };
                },
              );

            setManifest(
              entries,
            );

            setManifestError(
              null,
            );

            setLoadingManifest(
              false,
            );
          },

          (
            error,
          ) => {
            logDevelopmentWarning(
              '[Treasi Leaderboard] Manifest subscription failed:',
              error,
            );

            /*
             * Existing data remains visible if the live listener temporarily
             * fails instead of replacing the screen with mock information.
             */
            setManifestError(
              'EXPLORER MANIFEST SYNC OFFLINE',
            );

            setLoadingManifest(
              false,
            );
          },
        );

      /* -------------------------------------------------------------------- */
      /* Current Explorer profile                                             */
      /* -------------------------------------------------------------------- */

      const userReference =
        doc(
          db,
          'users',
          currentUserId,
        );

      const unsubscribeProfile =
        onSnapshot(
          userReference,

          (
            snapshot,
          ) => {
            if (
              snapshot.exists()
            ) {
              setCurrentUserProfile(
                snapshot.data() as
                  UserDocument,
              );

              setProfileError(
                null,
              );
            } else {
              setCurrentUserProfile(
                null,
              );

              setProfileError(
                'EXPLORER PROFILE NOT FOUND',
              );
            }

            setLoadingProfile(
              false,
            );
          },

          (
            error,
          ) => {
            logDevelopmentWarning(
              '[Treasi Leaderboard] Profile subscription failed:',
              error,
            );

            setProfileError(
              'EXPLORER PROFILE SYNC OFFLINE',
            );

            setLoadingProfile(
              false,
            );
          },
        );

      return () => {
        unsubscribeLeaderboard();
        unsubscribeProfile();
      };
    }, [
      currentUserId,
      retryKey,
    ]);

    /* ---------------------------------------------------------------------- */
    /* Derived leaderboard data                                              */
    /* ---------------------------------------------------------------------- */

    const topThree =
      useMemo(
        () =>
          manifest.slice(
            0,
            3,
          ),
        [
          manifest,
        ],
      );

    const currentManifestEntry =
      useMemo(
        () =>
          manifest.find(
            (
              entry,
            ) =>
              entry.uid ===
              currentUserId,
          ) ??
          null,
        [
          currentUserId,
          manifest,
        ],
      );

    const currentPoints =
      normalisePoints(
        currentUserProfile
          ?.totalPoints ??
          currentManifestEntry
            ?.points ??
          0,
      );

    const currentUsername =
      normaliseUsername(
        currentUserProfile
          ?.username ??
          currentManifestEntry
            ?.username ??
          currentUser
            ?.displayName ??
          currentUser
            ?.email
            ?.split('@')[0],
        'EXPLORER',
      );

    const currentRankText =
      useMemo(
        () => {
          if (
            loadingManifest
          ) {
            return 'CHECKING';
          }

          if (
            currentManifestEntry
          ) {
            return `#${currentManifestEntry.rank}`;
          }

          if (
            manifest.length >=
            MAX_LEADERBOARD_ENTRIES
          ) {
            return `OUTSIDE TOP ${MAX_LEADERBOARD_ENTRIES}`;
          }

          return 'NOT RANKED';
        },
        [
          currentManifestEntry,
          loadingManifest,
          manifest.length,
        ],
      );

    const syncErrorText =
      useMemo(
        () =>
          [
            manifestError,
            profileError,
          ]
            .filter(
              (
                value,
              ): value is string =>
                Boolean(
                  value,
                ),
            )
            .join(
              ' · ',
            ),
        [
          manifestError,
          profileError,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Navigation                                                            */
    /* ---------------------------------------------------------------------- */

    const navigateToSocial =
      useCallback(
        (): void => {
          onNavigate?.(
            'SOCIAL',
          );
        },
        [
          onNavigate,
        ],
      );

    const handleReturnToMap =
      useCallback(
        (): void => {
          if (onBack) {
            onBack();
            return;
          }

          onNavigate?.(
            'MAP',
          );
        },
        [
          onBack,
          onNavigate,
        ],
      );

    /* ---------------------------------------------------------------------- */
    /* Retry                                                                 */
    /* ---------------------------------------------------------------------- */

    const handleRetry =
      useCallback(
        (): void => {
          setManifestError(
            null,
          );

          setProfileError(
            null,
          );

          setLoadingManifest(
            true,
          );

          setLoadingProfile(
            true,
          );

          setRetryKey(
            (
              current,
            ) =>
              current + 1,
          );

          AccessibilityInfo
            .announceForAccessibility(
              'Retrying Explorer manifest synchronisation.',
            );
        },
        [],
      );

    /* ---------------------------------------------------------------------- */
    /* Render                                                                */
    /* ---------------------------------------------------------------------- */

    return (
      <View
        style={[
          styles.screen,
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
                10,
              ),

            paddingBottom:
              Math.max(
                insets.bottom,
                10,
              ),
          },
        ]}
      >
        <View
          style={[
            styles.layout,

            {
              flexDirection:
                isLandscape
                  ? 'row'
                  : 'column',
            },
          ]}
        >
          {/* ================================================================ */}
          {/* 60% — EXPLORER MANIFEST                                         */}
          {/* ================================================================ */}

          <View
            style={[
              styles.manifestPanel,

              isLandscape
                ? styles.manifestPanelLandscape
                : styles.panelPortrait,
            ]}
          >
            {/* -------------------------------------------------------------- */}
            {/* Header                                                         */}
            {/* -------------------------------------------------------------- */}

            <View
              style={
                styles.manifestHeader
              }
            >
              <View
                style={
                  styles.manifestTitleRow
                }
              >
                <MaterialCommunityIcons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="star-four-points"
                  size={16}
                  color={
                    COLOURS.rust700
                  }
                />

                <Text
                  accessibilityRole="header"
                  maxFontSizeMultiplier={
                    1.6
                  }
                  style={
                    styles.manifestTitle
                  }
                >
                  FIELD MANIFEST
                </Text>

                <MaterialCommunityIcons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="star-four-points"
                  size={16}
                  color={
                    COLOURS.rust700
                  }
                />
              </View>

              <Text
                maxFontSizeMultiplier={
                  1.5
                }
                style={
                  styles.manifestSubtitle
                }
              >
                EXPLORER POINTS LEDGER · TOP{' '}
                {
                  MAX_LEADERBOARD_ENTRIES
                }
              </Text>
            </View>

            {/* -------------------------------------------------------------- */}
            {/* Sync warning                                                   */}
            {/* -------------------------------------------------------------- */}

            {manifestError ? (
              <View
                accessible
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={
                  styles.syncWarning
                }
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="cloud-offline-outline"
                  size={17}
                  color={
                    COLOURS.parchment100
                  }
                />

                <Text
                  maxFontSizeMultiplier={
                    1.6
                  }
                  style={
                    styles.syncWarningText
                  }
                >
                  {
                    manifestError
                  }
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry leaderboard synchronisation"
                  hitSlop={4}
                  onPress={
                    handleRetry
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.smallRetryButton,

                    pressed &&
                      styles.darkButtonPressed,
                  ]}
                >
                  <Text
                    style={
                      styles.smallRetryText
                    }
                  >
                    RETRY
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* -------------------------------------------------------------- */}
            {/* Table header                                                   */}
            {/* -------------------------------------------------------------- */}

            <View
              accessible={
                false
              }
              importantForAccessibility="no-hide-descendants"
              style={
                styles.tableHeader
              }
            >
              <Text
                style={[
                  styles.columnHeader,
                  styles.rankColumn,
                ]}
              >
                NO.
              </Text>

              <Text
                style={[
                  styles.columnHeader,
                  styles.nameColumn,
                ]}
              >
                EXPLORER
              </Text>

              <Text
                style={[
                  styles.columnHeader,
                  styles.pointsColumn,
                ]}
              >
                POINTS
              </Text>
            </View>

            {/* -------------------------------------------------------------- */}
            {/* Manifest                                                       */}
            {/* -------------------------------------------------------------- */}

            {loadingManifest &&
            manifest.length ===
              0 ? (
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="Loading Explorer leaderboard"
                style={
                  styles.loadingBox
                }
              >
                <ActivityIndicator
                  size="small"
                  color={
                    COLOURS.rust700
                  }
                />

                <Text
                  style={
                    styles.loadingText
                  }
                >
                  SYNCHRONISING MANIFEST…
                </Text>
              </View>
            ) : manifest.length ===
              0 ? (
              <View
                accessible
                accessibilityLabel="No Explorers are currently available in the leaderboard."
                style={
                  styles.loadingBox
                }
              >
                <MaterialCommunityIcons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="account-search-outline"
                  size={28}
                  color={
                    COLOURS.bronze700
                  }
                />

                <Text
                  style={
                    styles.emptyText
                  }
                >
                  NO EXPLORERS IN THE MANIFEST
                </Text>

                {manifestError ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry leaderboard synchronisation"
                    onPress={
                      handleRetry
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.retryButton,

                      pressed &&
                        styles.primaryButtonPressed,
                    ]}
                  >
                    <Text
                      style={
                        styles.retryButtonText
                      }
                    >
                      RETRY MANIFEST
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <ScrollView
                accessibilityLabel="Explorer leaderboard"
                style={
                  styles.leaderboardScroll
                }
                contentContainerStyle={
                  styles.ledgerList
                }
                showsVerticalScrollIndicator={
                  false
                }
              >
                {manifest.map(
                  (
                    entry,
                  ) => (
                    <View
                      key={
                        entry.uid
                      }
                      accessible
                      accessibilityLabel={`Rank ${entry.rank}. ${
                        entry.isCurrentUser
                          ? 'You, '
                          : ''
                      }${entry.username}. ${formatPoints(
                        entry.points,
                      )} points.`}
                      style={[
                        styles.rowContainer,

                        entry.isCurrentUser &&
                          styles.currentUserRow,
                      ]}
                    >
                      <View
                        accessible={
                          false
                        }
                        importantForAccessibility="no-hide-descendants"
                        style={
                          styles.rankColumn
                        }
                      >
                        <View
                          style={[
                            styles.rankBadge,

                            entry.rank ===
                              1 &&
                              styles.rankBadgeFirst,

                            entry.rank ===
                              2 &&
                              styles.rankBadgeSecond,

                            entry.rank ===
                              3 &&
                              styles.rankBadgeThird,

                            entry.isCurrentUser &&
                              styles.currentUserRankBadge,
                          ]}
                        >
                          <Text
                            style={[
                              styles.rankText,

                              entry.isCurrentUser &&
                                styles.currentUserRankText,
                            ]}
                          >
                            {String(
                              entry.rank,
                            ).padStart(
                              2,
                              '0',
                            )}
                          </Text>
                        </View>
                      </View>

                      <View
                        accessible={
                          false
                        }
                        importantForAccessibility="no-hide-descendants"
                        style={
                          styles.nameColumn
                        }
                      >
                        <Text
                          numberOfLines={
                            1
                          }
                          ellipsizeMode="tail"
                          style={[
                            styles.explorerName,

                            entry.isCurrentUser &&
                              styles.currentUserText,
                          ]}
                        >
                          {entry.isCurrentUser
                            ? `YOU · ${entry.username}`
                            : entry.username}
                        </Text>

                        <Text
                          style={
                            styles.explorerRankTitle
                          }
                        >
                          {getRankTitle(
                            entry.points,
                          )}
                        </Text>
                      </View>

                      <Text
                        accessible={
                          false
                        }
                        importantForAccessibility="no"
                        style={[
                          styles.pointsValue,
                          styles.pointsColumn,

                          entry.isCurrentUser &&
                            styles.currentUserText,
                        ]}
                      >
                        {formatPoints(
                          entry.points,
                        )}
                      </Text>
                    </View>
                  ),
                )}
              </ScrollView>
            )}

            {/* -------------------------------------------------------------- */}
            {/* Ledger note                                                    */}
            {/* -------------------------------------------------------------- */}

            <View
              style={
                styles.manifestFooter
              }
            >
              <Text
                maxFontSizeMultiplier={
                  1.5
                }
                style={
                  styles.manifestFooterText
                }
              >
                RANKINGS USE CURRENT FIRESTORE TOTAL POINTS
              </Text>

              <Text
                maxFontSizeMultiplier={
                  1.5
                }
                style={
                  styles.manifestFooterCount
                }
              >
                {
                  manifest.length
                }
                /
                {
                  MAX_LEADERBOARD_ENTRIES
                }
              </Text>
            </View>
          </View>

          {/* ================================================================ */}
          {/* 40% — COMMAND CONSOLE                                           */}
          {/* ================================================================ */}

          <View
            style={[
              styles.commandPanel,

              isLandscape
                ? styles.commandPanelLandscape
                : styles.panelPortrait,
            ]}
          >
            <ScrollView
              style={
                styles.commandScroll
              }
              contentContainerStyle={
                styles.commandScrollContent
              }
              showsVerticalScrollIndicator={
                false
              }
            >
              {/* ------------------------------------------------------------ */}
              {/* Current Explorer                                             */}
              {/* ------------------------------------------------------------ */}

              <View
                style={
                  styles.sectionHeaderRow
                }
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="person-circle-outline"
                  size={17}
                  color={
                    COLOURS.bronze400
                  }
                />

                <Text
                  accessibilityRole="header"
                  style={
                    styles.sectionTitle
                  }
                >
                  YOUR FIELD RECORD
                </Text>
              </View>

              {loadingProfile ? (
                <View
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel="Loading your Explorer field record"
                  style={
                    styles.profileLoadingCard
                  }
                >
                  <ActivityIndicator
                    size="small"
                    color={
                      COLOURS.bronze400
                    }
                  />

                  <Text
                    style={
                      styles.profileLoadingText
                    }
                  >
                    CHECKING RECORD…
                  </Text>
                </View>
              ) : (
                <View
                  accessible
                  accessibilityLabel={`${currentUsername}. ${formatPoints(
                    currentPoints,
                  )} points. ${getRankTitle(
                    currentPoints,
                  )}. Leaderboard position ${currentRankText}.`}
                  style={
                    styles.currentRecordCard
                  }
                >
                  <View
                    accessible={
                      false
                    }
                    importantForAccessibility="no-hide-descendants"
                    style={
                      styles.currentRecordTopRow
                    }
                  >
                    <View
                      style={
                        styles.currentRecordIdentity
                      }
                    >
                      <Text
                        numberOfLines={
                          1
                        }
                        style={
                          styles.currentUsername
                        }
                      >
                        {
                          currentUsername
                        }
                      </Text>

                      <Text
                        style={
                          styles.currentRankTitle
                        }
                      >
                        {getRankTitle(
                          currentPoints,
                        )}
                      </Text>
                    </View>

                    <View
                      style={
                        styles.currentPositionBadge
                      }
                    >
                      <Text
                        style={
                          styles.currentPositionLabel
                        }
                      >
                        POSITION
                      </Text>

                      <Text
                        numberOfLines={
                          2
                        }
                        style={
                          styles.currentPositionValue
                        }
                      >
                        {
                          currentRankText
                        }
                      </Text>
                    </View>
                  </View>

                  <View
                    accessible={
                      false
                    }
                    importantForAccessibility="no-hide-descendants"
                    style={
                      styles.currentPointsRow
                    }
                  >
                    <Text
                      style={
                        styles.currentPointsValue
                      }
                    >
                      {formatPoints(
                        currentPoints,
                      )}
                    </Text>

                    <Text
                      style={
                        styles.currentPointsLabel
                      }
                    >
                      PTS
                    </Text>
                  </View>

                  {profileError ? (
                    <Text
                      accessibilityRole="alert"
                      style={
                        styles.profileErrorText
                      }
                    >
                      {
                        profileError
                      }
                    </Text>
                  ) : null}
                </View>
              )}

              {/* ------------------------------------------------------------ */}
              {/* Podium                                                       */}
              {/* ------------------------------------------------------------ */}

              <View
                style={[
                  styles.sectionHeaderRow,
                  styles.sectionSpacing,
                ]}
              >
                <MaterialCommunityIcons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="podium"
                  size={17}
                  color={
                    COLOURS.bronze400
                  }
                />

                <Text
                  accessibilityRole="header"
                  style={
                    styles.sectionTitle
                  }
                >
                  LEADING EXPLORERS
                </Text>
              </View>

              <View
                style={
                  styles.podiumList
                }
              >
                {topThree.length >
                0 ? (
                  topThree.map(
                    (
                      entry,
                    ) => (
                      <View
                        key={
                          entry.uid
                        }
                        accessible
                        accessibilityLabel={`${getPodiumLabel(
                          entry.rank,
                        )} place. ${entry.username}. ${formatPoints(
                          entry.points,
                        )} points.`}
                        style={[
                          styles.podiumCard,

                          entry.rank ===
                            1 &&
                            styles.podiumCardFirst,

                          entry.isCurrentUser &&
                            styles.podiumCardCurrent,
                        ]}
                      >
                        <View
                          accessible={
                            false
                          }
                          importantForAccessibility="no-hide-descendants"
                          style={[
                            styles.podiumRankCircle,

                            entry.rank ===
                              1 &&
                              styles.podiumRankCircleFirst,
                          ]}
                        >
                          <Text
                            style={
                              styles.podiumRankText
                            }
                          >
                            {
                              entry.rank
                            }
                          </Text>
                        </View>

                        <View
                          accessible={
                            false
                          }
                          importantForAccessibility="no-hide-descendants"
                          style={
                            styles.podiumIdentity
                          }
                        >
                          <Text
                            numberOfLines={
                              1
                            }
                            style={
                              styles.podiumName
                            }
                          >
                            {
                              entry.username
                            }
                          </Text>

                          <Text
                            style={
                              styles.podiumLabel
                            }
                          >
                            {getPodiumLabel(
                              entry.rank,
                            )}
                          </Text>
                        </View>

                        <Text
                          accessible={
                            false
                          }
                          importantForAccessibility="no"
                          style={
                            styles.podiumPoints
                          }
                        >
                          {formatPoints(
                            entry.points,
                          )}
                        </Text>
                      </View>
                    ),
                  )
                ) : (
                  <View
                    style={
                      styles.emptyPodiumCard
                    }
                  >
                    <Text
                      style={
                        styles.emptyPodiumText
                      }
                    >
                      LEADERS UNAVAILABLE
                    </Text>
                  </View>
                )}
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Social actions                                               */}
              {/* ------------------------------------------------------------ */}

              <View
                style={[
                  styles.sectionHeaderRow,
                  styles.sectionSpacing,
                ]}
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="people-outline"
                  size={17}
                  color={
                    COLOURS.bronze400
                  }
                />

                <Text
                  accessibilityRole="header"
                  style={
                    styles.sectionTitle
                  }
                >
                  EXPLORER NETWORK
                </Text>
              </View>

              <View
                style={
                  styles.socialActions
                }
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add friend"
                  accessibilityHint="Opens the Social screen where you can search for and add Explorers."
                  accessibilityState={{
                    disabled:
                      !onNavigate,
                  }}
                  disabled={
                    !onNavigate
                  }
                  onPress={
                    navigateToSocial
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.socialButton,

                    !onNavigate &&
                      styles.disabledButton,

                    pressed &&
                      onNavigate &&
                      styles.darkButtonPressed,
                  ]}
                >
                  <Ionicons
                    accessible={
                      false
                    }
                    importantForAccessibility="no"
                    name="person-add-outline"
                    size={18}
                    color={
                      COLOURS.parchment100
                    }
                  />

                  <Text
                    style={
                      styles.socialButtonText
                    }
                  >
                    ADD FRIEND
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dispatch Telegram"
                  accessibilityHint="Opens the Social screen where you can send a Telegram to another Explorer."
                  accessibilityState={{
                    disabled:
                      !onNavigate,
                  }}
                  disabled={
                    !onNavigate
                  }
                  onPress={
                    navigateToSocial
                  }
                  style={({
                    pressed,
                  }) => [
                    styles.socialButton,
                    styles.telegramButton,

                    !onNavigate &&
                      styles.disabledButton,

                    pressed &&
                      onNavigate &&
                      styles.primaryButtonPressed,
                  ]}
                >
                  <Ionicons
                    accessible={
                      false
                    }
                    importantForAccessibility="no"
                    name="paper-plane-outline"
                    size={18}
                    color={
                      COLOURS.parchment100
                    }
                  />

                  <Text
                    style={
                      styles.socialButtonText
                    }
                  >
                    DISPATCH TELEGRAM
                  </Text>
                </Pressable>
              </View>

              {/* ------------------------------------------------------------ */}
              {/* Return to map                                                */}
              {/* ------------------------------------------------------------ */}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Return to field map"
                accessibilityHint="Returns to the Treasi Dashboard."
                onPress={
                  handleReturnToMap
                }
                style={({
                  pressed,
                }) => [
                  styles.returnButton,

                  pressed &&
                    styles.lightButtonPressed,
                ]}
              >
                <Ionicons
                  accessible={
                    false
                  }
                  importantForAccessibility="no"
                  name="map-outline"
                  size={17}
                  color={
                    COLOURS.bronze400
                  }
                />

                <Text
                  style={
                    styles.returnButtonText
                  }
                >
                  RETURN TO FIELD MAP
                </Text>
              </Pressable>

              {syncErrorText &&
              !manifestError ? (
                <View
                  accessible
                  accessibilityRole="alert"
                  style={
                    styles.commandWarning
                  }
                >
                  <Text
                    style={
                      styles.commandWarningText
                    }
                  >
                    {
                      syncErrorText
                    }
                  </Text>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry Explorer data synchronisation"
                    onPress={
                      handleRetry
                    }
                    style={({
                      pressed,
                    }) => [
                      styles.commandRetryButton,

                      pressed &&
                        styles.darkButtonPressed,
                    ]}
                  >
                    <Text
                      style={
                        styles.commandRetryText
                      }
                    >
                      RETRY
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </ScrollView>

            {/* -------------------------------------------------------------- */}
            {/* Navigation                                                     */}
            {/* -------------------------------------------------------------- */}

            <FieldNavBar
              currentTab={
                currentTab
              }
              onNavigate={
                onNavigate
              }
            />
          </View>
        </View>
      </View>
    );
  };

export default LeaderboardScreen;

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles =
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor:
        COLOURS.forest800,
    },

    layout: {
      flex: 1,
      minHeight: 0,
      gap: 12,
    },

    panelPortrait: {
      width: '100%',
    },

    /* ---------------------------------------------------------------------- */
    /* 60% manifest panel                                                    */
    /* ---------------------------------------------------------------------- */

    manifestPanel: {
      minWidth: 0,
      minHeight: 0,
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 7,
      padding: 14,
    },

    manifestPanelLandscape: {
      flex: 0.6,
    },

    manifestHeader: {
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor:
        COLOURS.bronze600,
    },

    manifestTitleRow: {
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 8,
    },

    manifestTitle: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 18,
      lineHeight: 24,
      fontWeight:
        '800',
      letterSpacing: 1.8,
      textAlign:
        'center',
    },

    manifestSubtitle: {
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '700',
      letterSpacing: 1,
      textAlign:
        'center',
      marginTop: 4,
    },

    /* ---------------------------------------------------------------------- */
    /* Sync warning                                                          */
    /* ---------------------------------------------------------------------- */

    syncWarning: {
      minHeight: 52,
      marginTop: 10,
      paddingHorizontal: 10,
      paddingVertical: 7,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 8,
      backgroundColor:
        COLOURS.rust700,
      borderRadius: 5,
      borderWidth: 1,
      borderColor:
        COLOURS.danger300,
    },

    syncWarningText: {
      flex: 1,
      minWidth: 0,
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '700',
    },

    smallRetryButton: {
      minWidth: 70,
      minHeight: 48,
      alignItems:
        'center',
      justifyContent:
        'center',
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor:
        COLOURS.parchment100,
      borderRadius: 4,
    },

    smallRetryText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight:
        '800',
      letterSpacing: 0.6,
    },

    /* ---------------------------------------------------------------------- */
    /* Table                                                                 */
    /* ---------------------------------------------------------------------- */

    tableHeader: {
      minHeight: 38,
      flexDirection:
        'row',
      alignItems:
        'center',
      paddingHorizontal: 7,
      borderBottomWidth: 1.5,
      borderBottomColor:
        COLOURS.ink900,
    },

    columnHeader: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '800',
      letterSpacing: 0.7,
    },

    rankColumn: {
      width: 62,
      flexShrink: 0,
    },

    nameColumn: {
      flex: 1,
      minWidth: 0,
    },

    pointsColumn: {
      width: 100,
      flexShrink: 0,
      textAlign:
        'right',
    },

    leaderboardScroll: {
      flex: 1,
      minHeight: 0,
    },

    ledgerList: {
      paddingTop: 5,
      paddingBottom: 8,
    },

    rowContainer: {
      minHeight: 50,
      flexDirection:
        'row',
      alignItems:
        'center',
      paddingHorizontal: 7,
      paddingVertical: 5,
      marginBottom: 3,
      borderRadius: 5,
      borderWidth: 1,
      borderColor:
        'transparent',
    },

    currentUserRow: {
      backgroundColor:
        '#D8C39B',
      borderColor:
        COLOURS.rust700,
    },

    rankBadge: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems:
        'center',
      justifyContent:
        'center',
      backgroundColor:
        COLOURS.parchment100,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze600,
    },

    rankBadgeFirst: {
      borderWidth: 2,
      borderColor:
        COLOURS.rust700,
    },

    rankBadgeSecond: {
      borderColor:
        COLOURS.bronze700,
    },

    rankBadgeThird: {
      borderColor:
        COLOURS.ink700,
    },

    currentUserRankBadge: {
      backgroundColor:
        COLOURS.rust700,
      borderColor:
        COLOURS.rust800,
    },

    rankText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10.5,
      lineHeight: 15,
      fontWeight:
        '800',
    },

    currentUserRankText: {
      color:
        COLOURS.parchment100,
    },

    explorerName: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11.5,
      lineHeight: 16,
      fontWeight:
        '800',
      letterSpacing: 0.35,
    },

    explorerRankTitle: {
      marginTop: 2,
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_FONT,
      fontSize: 8.5,
      lineHeight: 12,
      fontWeight:
        '700',
      letterSpacing: 0.35,
    },

    pointsValue: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 12,
      lineHeight: 17,
      fontWeight:
        '800',
    },

    currentUserText: {
      color:
        COLOURS.rust800,
    },

    /* ---------------------------------------------------------------------- */
    /* Manifest states                                                       */
    /* ---------------------------------------------------------------------- */

    loadingBox: {
      flex: 1,
      minHeight: 180,
      justifyContent:
        'center',
      alignItems:
        'center',
      gap: 10,
      paddingHorizontal: 20,
    },

    loadingText: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
      letterSpacing: 0.75,
      textAlign:
        'center',
    },

    emptyText: {
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
      letterSpacing: 0.7,
      textAlign:
        'center',
    },

    retryButton: {
      minHeight: 48,
      minWidth: 160,
      justifyContent:
        'center',
      alignItems:
        'center',
      paddingHorizontal: 16,
      paddingVertical: 9,
      marginTop: 5,
      backgroundColor:
        COLOURS.rust700,
      borderRadius: 5,
      borderWidth: 1,
      borderColor:
        COLOURS.rust800,
    },

    retryButtonText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
      letterSpacing: 0.7,
    },

    /* ---------------------------------------------------------------------- */
    /* Manifest footer                                                       */
    /* ---------------------------------------------------------------------- */

    manifestFooter: {
      minHeight: 30,
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      alignItems:
        'center',
      gap: 10,
      paddingTop: 7,
      borderTopWidth: 1,
      borderTopColor:
        COLOURS.bronze600,
    },

    manifestFooterText: {
      flex: 1,
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight:
        '700',
      letterSpacing: 0.4,
    },

    manifestFooterCount: {
      color:
        COLOURS.rust700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight:
        '800',
    },

    /* ---------------------------------------------------------------------- */
    /* 40% command panel                                                     */
    /* ---------------------------------------------------------------------- */

    commandPanel: {
      minWidth: 0,
      minHeight: 0,
      padding: 12,
      backgroundColor:
        COLOURS.forest800,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze500,
      borderRadius: 7,
    },

    commandPanelLandscape: {
      flex: 0.4,
    },

    commandScroll: {
      flex: 1,
      minHeight: 0,
      marginBottom: 8,
    },

    commandScrollContent: {
      paddingBottom: 4,
    },

    sectionHeaderRow: {
      minHeight: 27,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 6,
      marginBottom: 7,
    },

    sectionSpacing: {
      marginTop: 14,
    },

    sectionTitle: {
      flexShrink: 1,
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10.5,
      lineHeight: 16,
      fontWeight:
        '800',
      letterSpacing: 0.75,
    },

    /* ---------------------------------------------------------------------- */
    /* Current record                                                        */
    /* ---------------------------------------------------------------------- */

    profileLoadingCard: {
      minHeight: 120,
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 8,
      padding: 12,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze500,
      borderRadius: 5,
    },

    profileLoadingText: {
      color:
        COLOURS.parchment200,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '700',
      letterSpacing: 0.5,
    },

    currentRecordCard: {
      padding: 11,
      backgroundColor:
        COLOURS.parchment200,
      borderWidth: 2,
      borderColor:
        COLOURS.bronze600,
      borderRadius: 5,
    },

    currentRecordTopRow: {
      flexDirection:
        'row',
      alignItems:
        'flex-start',
      justifyContent:
        'space-between',
      gap: 10,
    },

    currentRecordIdentity: {
      flex: 1,
      minWidth: 0,
    },

    currentUsername: {
      color:
        COLOURS.ink900,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 13,
      lineHeight: 18,
      fontWeight:
        '800',
      letterSpacing: 0.45,
    },

    currentRankTitle: {
      marginTop: 2,
      color:
        COLOURS.bronze700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '700',
      letterSpacing: 0.4,
    },

    currentPositionBadge: {
      maxWidth: 125,
      minHeight: 48,
      paddingHorizontal: 8,
      paddingVertical: 6,
      justifyContent:
        'center',
      alignItems:
        'center',
      backgroundColor:
        COLOURS.forest800,
      borderRadius: 4,
    },

    currentPositionLabel: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 7.5,
      lineHeight: 11,
      fontWeight:
        '700',
      letterSpacing: 0.45,
    },

    currentPositionValue: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight:
        '800',
      textAlign:
        'center',
    },

    currentPointsRow: {
      flexDirection:
        'row',
      alignItems:
        'baseline',
      justifyContent:
        'center',
      marginTop: 8,
    },

    currentPointsValue: {
      color:
        COLOURS.rust700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 28,
      lineHeight: 33,
      fontWeight:
        '900',
    },

    currentPointsLabel: {
      color:
        COLOURS.rust700,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11,
      lineHeight: 16,
      fontWeight:
        '800',
      marginLeft: 5,
    },

    profileErrorText: {
      marginTop: 7,
      color:
        COLOURS.rust800,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '700',
      textAlign:
        'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Podium                                                                */
    /* ---------------------------------------------------------------------- */

    podiumList: {
      gap: 6,
    },

    podiumCard: {
      minHeight: 52,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.forest700,
      borderRadius: 5,
    },

    podiumCardFirst: {
      borderColor:
        COLOURS.bronze400,
    },

    podiumCardCurrent: {
      borderColor:
        COLOURS.rust600,
    },

    podiumRankCircle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems:
        'center',
      justifyContent:
        'center',
      flexShrink: 0,
      backgroundColor:
        COLOURS.forest800,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze500,
    },

    podiumRankCircleFirst: {
      borderWidth: 2,
      borderColor:
        COLOURS.bronze400,
    },

    podiumRankText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11,
      lineHeight: 16,
      fontWeight:
        '800',
    },

    podiumIdentity: {
      flex: 1,
      minWidth: 0,
    },

    podiumName: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 10,
      lineHeight: 15,
      fontWeight:
        '800',
    },

    podiumLabel: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_FONT,
      fontSize: 8,
      lineHeight: 12,
      fontWeight:
        '700',
    },

    podiumPoints: {
      color:
        COLOURS.success300,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 11,
      lineHeight: 16,
      fontWeight:
        '800',
    },

    emptyPodiumCard: {
      minHeight: 52,
      alignItems:
        'center',
      justifyContent:
        'center',
      padding: 8,
      borderWidth: 1,
      borderStyle:
        'dashed',
      borderColor:
        COLOURS.bronze500,
      borderRadius: 5,
    },

    emptyPodiumText: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 14,
      fontWeight:
        '700',
      letterSpacing: 0.5,
    },

    /* ---------------------------------------------------------------------- */
    /* Social actions                                                        */
    /* ---------------------------------------------------------------------- */

    socialActions: {
      flexDirection:
        'row',
      gap: 7,
    },

    socialButton: {
      flex: 1,
      minHeight: 50,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 8,
      backgroundColor:
        COLOURS.forest950,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze400,
      borderRadius: 5,
    },

    telegramButton: {
      backgroundColor:
        COLOURS.rust700,
      borderColor:
        COLOURS.rust800,
    },

    socialButtonText: {
      flexShrink: 1,
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight:
        '800',
      letterSpacing: 0.45,
      textAlign:
        'center',
    },

    disabledButton: {
      opacity: 0.45,
    },

    /* ---------------------------------------------------------------------- */
    /* Return button                                                         */
    /* ---------------------------------------------------------------------- */

    returnButton: {
      minHeight: 48,
      marginTop: 10,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'center',
      gap: 7,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor:
        COLOURS.forest900,
      borderWidth: 1,
      borderColor:
        COLOURS.bronze500,
      borderRadius: 5,
    },

    returnButtonText: {
      color:
        COLOURS.bronze400,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9.5,
      lineHeight: 14,
      fontWeight:
        '800',
      letterSpacing: 0.55,
      textAlign:
        'center',
    },

    /* ---------------------------------------------------------------------- */
    /* Command error                                                         */
    /* ---------------------------------------------------------------------- */

    commandWarning: {
      marginTop: 10,
      padding: 9,
      backgroundColor:
        COLOURS.rust700,
      borderWidth: 1,
      borderColor:
        COLOURS.danger300,
      borderRadius: 5,
    },

    commandWarningText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 8.5,
      lineHeight: 13,
      fontWeight:
        '700',
      textAlign:
        'center',
      marginBottom: 7,
    },

    commandRetryButton: {
      minHeight: 48,
      alignItems:
        'center',
      justifyContent:
        'center',
      borderWidth: 1,
      borderColor:
        COLOURS.parchment100,
      borderRadius: 4,
    },

    commandRetryText: {
      color:
        COLOURS.parchment100,
      fontFamily:
        MONO_BOLD_FONT,
      fontSize: 9,
      lineHeight: 13,
      fontWeight:
        '800',
    },

    /* ---------------------------------------------------------------------- */
    /* Interaction states                                                    */
    /* ---------------------------------------------------------------------- */

    darkButtonPressed: {
      opacity: 0.78,
      transform: [
        {
          scale: 0.985,
        },
      ],
    },

    primaryButtonPressed: {
      backgroundColor:
        COLOURS.rust600,
      transform: [
        {
          scale: 0.985,
        },
      ],
    },

    lightButtonPressed: {
      backgroundColor:
        COLOURS.forest700,
    },
  });