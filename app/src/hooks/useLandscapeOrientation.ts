import { useEffect } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';

export const useLandscapeOrientation = () => {
  useEffect(() => {
    async function lockLandscape() {
      try {
        // Lock app to landscape orientations exclusively
        await ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.LANDSCAPE
        );
      } catch (error) {
        console.warn('Could not lock orientation to landscape:', error);
      }
    }

    lockLandscape();

    // Optional cleanup: Unlock orientation if needed on unmount
    return () => {
      ScreenOrientation.unlockAsync();
    };
  }, []);
};