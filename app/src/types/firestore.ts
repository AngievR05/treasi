import type {
  GeoPoint,
  Timestamp,
} from 'firebase/firestore';

/* -------------------------------------------------------------------------- */
/* Shared Types                                                               */
/* -------------------------------------------------------------------------- */

export type FriendshipStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'blocked';

export type ActivityFeedType =
  | 'TREASURE_HIDDEN'
  | 'TREASURE_FOUND'
  | 'TREASURE_ARCHIVED'
  | 'TELEGRAM_DISPATCH'
  | 'FRIEND_REQUEST'
  | 'FRIEND_ACCEPTED'
  | 'PROFILE_UPDATED';

/* -------------------------------------------------------------------------- */
/* Collection 1: users                                                       */
/* -------------------------------------------------------------------------- */
/**
 * Stores user profile state, persistent telemetry settings,
 * onboarding controls and accumulated excavation points.
 */
export interface UserDocument {
  uid: string;

  username: string;

  email: string;

  totalPoints: number;

  hasCompletedOnboarding: boolean;

  /* ---------------------------------------------------------------------- */
  /* System / calibration preferences                                       */
  /* ---------------------------------------------------------------------- */

  telemetryEnabled: boolean;

  hapticFeedbackEnabled: boolean;

  motionSensitivityEnabled: boolean;

  batteryOptimizerEnabled: boolean;

  nightModeEnabled: boolean;

  /* ---------------------------------------------------------------------- */
  /* Authentication / onboarding                                            */
  /* ---------------------------------------------------------------------- */

  skipOnboardingAuthFlow: boolean;

  /* ---------------------------------------------------------------------- */
  /* Optional location telemetry                                            */
  /* ---------------------------------------------------------------------- */

  location?: GeoPoint | null;

  /* ---------------------------------------------------------------------- */
  /* Timestamps                                                             */
  /* ---------------------------------------------------------------------- */

  createdAt: Timestamp;

  updatedAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Collection 2: treasures                                                   */
/* -------------------------------------------------------------------------- */
/**
 * Physical digital caches planted in physical space.
 */
export interface TreasureDocument {
  treasureId: string;

  creatorId: string;

  creatorName: string;

  title: string;

  hint: string;

  payloadText: string;

  imageUrl?: string;

  location: GeoPoint;

  isArchived: boolean;

  createdAt: Timestamp;

  updatedAt?: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Collection 3: discoveries                                                 */
/* -------------------------------------------------------------------------- */
/**
 * Tracks excavated treasures and prevents duplicate scoring.
 */
export interface DiscoveryDocument {
  discoveryId: string;

  treasureId: string;

  hunterId: string;

  unlockedAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Collection 4: messages                                                    */
/* -------------------------------------------------------------------------- */
/**
 * Field communication messages.
 *
 * The current Treasi implementation supports global Telegram
 * dispatches. recipientId remains optional so private messaging
 * can be added later without changing the base schema.
 */
export interface MessageDocument {
  messageId?: string;

  senderId: string;

  senderName: string;

  text: string;

  createdAt: Timestamp;

  type?: 'GLOBAL_DISPATCH' | 'PRIVATE';

  recipientId?: string;
}

/* -------------------------------------------------------------------------- */
/* Collection 5: friendships                                                 */
/* -------------------------------------------------------------------------- */
/**
 * Asynchronous peer-link tracking and friend requests.
 */
export interface FriendshipDocument {
  friendshipId: string;

  requesterId: string;

  receiverId: string;

  status: FriendshipStatus;

  createdAt: Timestamp;

  updatedAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Collection 6: userAchievements                                            */
/* -------------------------------------------------------------------------- */
/**
 * Unlocked gamification badges and field commendations.
 */
export interface UserAchievementDocument {
  achievementId: string;

  userId: string;

  badgeKey: string;

  title: string;

  description: string;

  unlockedAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Collection 7: activity_feed                                               */
/* -------------------------------------------------------------------------- */
/**
 * Real-time event log displayed in the Dashboard Field Signals panel.
 */
export interface ActivityFeedDocument {
  activityId?: string;

  userId: string;

  username: string;

  type: ActivityFeedType;

  message: string;

  targetId: string;

  createdAt: Timestamp;
}