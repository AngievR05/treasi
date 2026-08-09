import { Timestamp, GeoPoint } from 'firebase/firestore';

/**
 * Collection 1: users
 * Stores user profile state, persistent telemetry settings, and onboarding controls.
 */
export interface UserDocument {
  uid: string;
  username: string;
  email: string;
  totalPoints: number;
  hasCompletedOnboarding: boolean;
  
  // System & Calibration Toggles (Default: false / OFF)
  telemetryEnabled: boolean;
  hapticFeedbackEnabled: boolean;
  motionSensitivityEnabled: boolean;
  batteryOptimizerEnabled: boolean;
  nightModeEnabled: boolean;
  
  // Persistent bypass toggle (Default: false / OFF)
  skipOnboardingAuthFlow: boolean;
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Collection 2: treasures
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
}

/**
 * Collection 3: discoveries
 * Intersection collection tracking excavated treasures to prevent double scoring.
 */
export interface DiscoveryDocument {
  discoveryId: string;
  treasureId: string;
  hunterId: string;
  unlockedAt: Timestamp;
}

/**
 * Collection 4: messages
 * Real-time field chat messages between explorer groups.
 */
export interface MessageDocument {
  messageId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: Timestamp;
}

/**
 * Collection 5: friendships
 * Asynchronous peer link tracking and pending requests.
 */
export interface FriendshipDocument {
  friendshipId: string;
  requesterId: string;
  receiverId: string;
  status: 'pending' | 'accepted' | 'declined' | 'blocked';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Collection 6: userAchievements
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

/**
 * Collection 7: activity_feed (Field Signals)
 * Real-time event log displayed on the Right Control Console of the Dashboard.
 */
export interface ActivityFeedDocument {
  activityId: string;
  userId: string;
  username: string;
  type: 'TREASURE_HIDDEN' | 'TREASURE_FOUND' | 'FRIEND_ACCEPTED';
  message: string;
  targetId: string;
  createdAt: Timestamp;
}