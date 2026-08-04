import { Timestamp, GeoPoint } from 'firebase/firestore';

export interface UserDocument {
  uid: string;
  username: string;
  email: string;
  totalPoints: number;
  hasCompletedOnboarding: boolean;
  telemetryEnabled: boolean; // default: false
  hapticFeedbackEnabled: boolean; // default: false
  motionSensitivityEnabled: boolean; // default: false
  batteryOptimizerEnabled: boolean; // default: false
  nightModeEnabled: boolean; // default: false
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