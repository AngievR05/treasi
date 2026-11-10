import type { LocationObject } from 'expo-location';

export const HUNT_LOCATION_MAX_AGE_MS = 12_000;

export function isFreshHuntFix(location: LocationObject, now = Date.now()): boolean {
  return Number.isFinite(location.timestamp) && location.timestamp <= now + 1_000 &&
    now - location.timestamp <= HUNT_LOCATION_MAX_AGE_MS;
}

export async function withHuntTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('HUNT_REQUEST_TIMEOUT')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
