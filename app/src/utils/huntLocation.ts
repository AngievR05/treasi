import * as Location from 'expo-location';
import { Platform } from 'react-native';

const WEB_HUNT_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0 };

export async function watchHuntPosition(
  options: Location.LocationOptions,
  onPosition: Location.LocationCallback,
  onError: Location.LocationErrorCallback,
): Promise<Location.LocationSubscription> {
  if (Platform.OS !== 'web') return Location.watchPositionAsync(options, onPosition, onError);

  // Expo forwards native options to the browser watcher. Set the browser's
  // actual accuracy option and keep its watch ID for delivery and cleanup.
  const geolocation = navigator.geolocation;
  const watchId = geolocation.watchPosition(onPosition, error => onError(error.message), WEB_HUNT_OPTIONS);
  return { remove: () => geolocation.clearWatch(watchId) };
}

export function getHuntPosition(
  options: Location.LocationOptions,
  timeout: number,
): Promise<Location.LocationObject> {
  if (Platform.OS !== 'web') return Location.getCurrentPositionAsync(options);

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { ...WEB_HUNT_OPTIONS, timeout });
  });
}
