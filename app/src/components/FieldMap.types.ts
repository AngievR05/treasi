export interface FieldMapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface FieldMapTreasure {
  id: string;
  title: string;
  creatorName?: string;

  latitude: number;
  longitude: number;
}

export interface FieldMapUserLocation {
  latitude: number;
  longitude: number;
}

export interface FieldMapHandle {
  setView: (
    region: FieldMapRegion,
    animated?: boolean,
  ) => void;
}

export interface FieldMapProps {
  initialRegion: FieldMapRegion;

  userLocation: FieldMapUserLocation | null;

  treasures: FieldMapTreasure[];

  onTreasurePress: (
    treasureId: string,
  ) => void;

  onReady?: () => void;
}