import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';

export const MAX_LOCATION_AGE_MS = 2 * 60 * 1000;

export function isFreshLocation(location: Location.LocationObject, now = Date.now()): boolean {
  const { latitude, longitude } = location.coords;
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    Number.isFinite(longitude) && Math.abs(longitude) <= 180 &&
    Number.isFinite(location.timestamp) && location.timestamp <= now + 10_000 &&
    now - location.timestamp <= MAX_LOCATION_AGE_MS;
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Location request timed out')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

interface LocationState {
  userLocation: Location.LocationObject | null;
  locationFixSource: 'none' | 'cached' | 'live';
  isInitialisingLocation: boolean;
  locationError: string | null;
  locationPermissionStatus: Location.PermissionStatus | null;
  canAskLocationAgain: boolean;
  locationServicesEnabled: boolean | null;
}

export function useDashboardLocation() {
  const [state, setState] = useState<LocationState>({
    userLocation: null,
    locationFixSource: 'none',
    isInitialisingLocation: true,
    locationError: null,
    locationPermissionStatus: null,
    canAskLocationAgain: true,
    locationServicesEnabled: null,
  });
  const mounted = useRef(false);
  const sequence = useRef(0);
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const fixTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = useCallback(() => {
    sequence.current += 1;
    clearTimeout(fixTimeout.current);
    fixTimeout.current = undefined;
    try {
      watcher.current?.remove();
    } catch {
      // Native subscriptions can already be removed during teardown.
    } finally {
      watcher.current = null;
    }
  }, []);

  const startLocationService = useCallback(async (requestPermission: boolean) => {
    stop();
    const request = sequence.current;
    const isCurrent = () => mounted.current && request === sequence.current;
    if (!isCurrent()) return;

    setState(current => ({
      ...current,
      isInitialisingLocation: true,
      locationError: null,
      locationFixSource: current.userLocation ? 'cached' : 'none',
      locationServicesEnabled: null,
    }));

    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && !window.isSecureContext) {
        throw new Error('LOCATION REQUIRES HTTPS OR LOCALHOST IN YOUR BROWSER.');
      }
      let permission = await withTimeout(Location.getForegroundPermissionsAsync(), 8_000);
      if (!isCurrent()) return;
      if (!permission.granted && requestPermission && permission.canAskAgain) {
        // iOS becomes inactive while the permission sheet is open. It is not backgrounded.
        permission = await Location.requestForegroundPermissionsAsync();
        if (!isCurrent()) return;
      }
      setState(current => ({
        ...current,
        locationPermissionStatus: permission.status,
        canAskLocationAgain: permission.canAskAgain,
      }));
      if (!permission.granted) {
        setState(current => ({
          ...current, userLocation: null, locationFixSource: 'none', isInitialisingLocation: false,
          locationError: 'LOCATION ACCESS IS NOT ENABLED. ENABLE LOCATION TO USE NEARBY CACHES AND LOCATION STAMPING.',
        }));
        return;
      }
      const enabled = await withTimeout(Location.hasServicesEnabledAsync(), 8_000);
      if (!isCurrent()) return;
      setState(current => ({ ...current, locationServicesEnabled: enabled }));
      if (!enabled) {
        setState(current => ({
          ...current, userLocation: null, locationFixSource: 'none', isInitialisingLocation: false,
          locationError: 'DEVICE LOCATION IS OFF. ENABLE LOCATION SERVICES IN SETTINGS > PRIVACY & SECURITY > LOCATION SERVICES.',
        }));
        return;
      }

      let hasLiveFix = false;
      const applyLiveFix = (position: Location.LocationObject) => {
        if (!isCurrent() || !isFreshLocation(position)) return;
        hasLiveFix = true;
        clearTimeout(fixTimeout.current);
        setState(current => {
          // A delayed one-shot result must not overwrite a newer watcher fix.
          if (current.locationFixSource === 'live' && current.userLocation &&
              current.userLocation.timestamp > position.timestamp) return current;
          return { ...current, userLocation: position, locationFixSource: 'live',
            isInitialisingLocation: false, locationError: null };
        });
      };

      fixTimeout.current = setTimeout(() => {
        if (isCurrent() && !hasLiveFix) setState(current => ({
          ...current, isInitialisingLocation: false,
          locationError: 'NO CURRENT GPS FIX. MOVE TO AN OPEN AREA OR RETRY LOCATION.',
        }));
      }, 15_000);

      // These requests run independently: a slow cached or one-shot lookup cannot block tracking.
      void withTimeout(Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 500 }), 2_000)
        .then(position => {
          if (!isCurrent() || hasLiveFix || !position || !isFreshLocation(position)) return;
          setState(current => ({ ...current, userLocation: position, locationFixSource: 'cached' }));
        }).catch(() => {});
      void withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 15_000)
        .then(applyLiveFix).catch(() => {});

      let registrationExpired = false;
      const registration = Location.watchPositionAsync({
        accuracy: Location.Accuracy.Balanced, timeInterval: 5_000, distanceInterval: 15,
      }, applyLiveFix, () => {
        if (!isCurrent()) return;
        setState(current => ({ ...current, isInitialisingLocation: false,
          locationFixSource: current.userLocation ? 'cached' : 'none',
          locationError: 'LIVE LOCATION UPDATES WERE INTERRUPTED. RETRY LOCATION.' }));
      }).then(subscription => {
        if (!isCurrent() || registrationExpired) subscription.remove();
        return subscription;
      });
      try {
        const subscription = await withTimeout(registration, 10_000);
        if (isCurrent()) watcher.current = subscription;
      } catch (error) {
        registrationExpired = true;
        throw error;
      }
    } catch (error) {
      if (!isCurrent()) return;
      stop();
      setState(current => ({ ...current, isInitialisingLocation: false,
        locationFixSource: current.userLocation ? 'cached' : 'none',
        locationError: error instanceof Error && error.message.startsWith('LOCATION REQUIRES')
          ? error.message : 'LOCATION COULD NOT BE STARTED. CHECK SETTINGS AND RETRY LOCATION.' }));
    }
  }, [stop]);

  useEffect(() => {
    mounted.current = true;
    let resumeRequired = AppState.currentState === 'background';
    if (!resumeRequired) void startLocationService(false);
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'background') {
        resumeRequired = true;
        stop();
        setState(current => ({ ...current, isInitialisingLocation: false,
          locationFixSource: current.userLocation ? 'cached' : 'none' }));
      } else if (nextState === 'active' && resumeRequired) {
        resumeRequired = false;
        void startLocationService(false);
      }
    });
    const freshnessTimer = setInterval(() => {
      setState(current => {
        if (current.locationFixSource !== 'live' || !current.userLocation || isFreshLocation(current.userLocation)) return current;
        return { ...current, locationFixSource: 'cached',
          locationError: 'LOCATION IS OUT OF DATE. RETRY LOCATION BEFORE STAMPING A CACHE.' };
      });
    }, 15_000);
    return () => {
      mounted.current = false;
      subscription.remove();
      clearInterval(freshnessTimer);
      stop();
    };
  }, [startLocationService, stop]);

  return { ...state, startLocationService };
}
