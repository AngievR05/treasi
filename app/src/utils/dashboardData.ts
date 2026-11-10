import type { ActivityFeedDocument, TreasureDocument, UserDocument } from '../types/firestore';

const text = (value: unknown, fallback = '') => typeof value === 'string' ? value.trim() || fallback : fallback;

export function readDashboardTreasure(id: string, data: Record<string, unknown>): TreasureDocument | null {
  const location = data.location as { latitude?: unknown; longitude?: unknown } | null;
  if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number' ||
      !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 ||
      !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) return null;
  return {
    ...data,
    // The document path, rather than a potentially stale embedded ID, identifies writes and Hunt routes.
    treasureId: id,
    title: text(data.title, 'TREASURE CACHE'),
    creatorId: text(data.creatorId),
    creatorName: text(data.creatorName, 'UNKNOWN EXPLORER'),
    hint: text(data.hint),
    payloadText: text(data.payloadText),
    imageUrl: text(data.imageUrl),
  } as TreasureDocument;
}

export function readDashboardProfile(data: Record<string, unknown>): UserDocument {
  return { ...data, username: text(data.username),
    totalPoints: typeof data.totalPoints === 'number' && Number.isFinite(data.totalPoints)
      ? Math.max(0, Math.floor(data.totalPoints)) : 0 } as UserDocument;
}

export function readDashboardActivity(id: string, data: Record<string, unknown>): ActivityFeedDocument {
  return { ...data, activityId: id, userId: text(data.userId), username: text(data.username),
    message: text(data.message, 'FIELD SIGNAL RECEIVED') } as ActivityFeedDocument;
}
