import { Timestamp, GeoPoint } from 'firebase/firestore';

export interface UserDocument {
  uid: string;
  username: string;
  email: string;
  totalPoints: number;
  hasCompletedOnboarding: boolean; // Default: false
  telemetryEnabled: boolean; // Default: false
  hapticFeedbackEnabled: boolean; // Default: false
  motionSensitivityEnabled: boolean; // Default: false
  batteryOptimizerEnabled: boolean; // Default: false
  nightModeEnabled: boolean; // Default: false
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

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

export interface DiscoveryDocument {
  discoveryId: string;
  treasureId: string;
  hunterId: string;
  unlockedAt: Timestamp;
}

export interface ChatMessageDocument {
  messageId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: Timestamp;
}

/**
 * Helper to generate initial Firestore payload for new users.
 * Guarantees all toggles and onboarding flags start strictly disabled (false).
 */
export const createInitialUserData = (
  uid: string,
  username: string,
  email: string
): Omit<UserDocument, 'createdAt' | 'updatedAt'> & {
  createdAt: ReturnType<typeof Timestamp.now>;
  updatedAt: ReturnType<typeof Timestamp.now>;
} => ({
  uid,
  username,
  email,
  totalPoints: 0,
  hasCompletedOnboarding: false,
  telemetryEnabled: false,
  hapticFeedbackEnabled: false,
  motionSensitivityEnabled: false,
  batteryOptimizerEnabled: false,
  nightModeEnabled: false,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
});