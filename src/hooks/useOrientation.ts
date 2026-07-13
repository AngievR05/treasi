import { useWindowDimensions } from 'react-native';

export interface OrientationState {
  isLandscape: boolean;
  width: number;
  height: number;
}

export const useOrientation = (): OrientationState => {
  const { width, height } = useWindowDimensions();
  
  // High-accuracy orientation calculation based on viewport geometry
  const isLandscape = width > height;

  return {
    isLandscape,
    width,
    height,
  };
};