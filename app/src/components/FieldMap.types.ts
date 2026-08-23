/* -------------------------------------------------------------------------- */
/* Field map shared types                                                     */
/* -------------------------------------------------------------------------- */

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
  /**
   * Moves the map viewport to a new region.
   */
  setView: (
    region: FieldMapRegion,
    animated?: boolean,
  ) => void;
}

export interface FieldMapProps {
  /**
   * Initial map position used when the map first mounts.
   */
  initialRegion: FieldMapRegion;

  /**
   * Current real user coordinates.
   */
  userLocation: FieldMapUserLocation | null;

  /**
   * Real treasure records prepared by the parent screen.
   */
  treasures: FieldMapTreasure[];

  /**
   * Called when a treasure marker is selected.
   */
  onTreasurePress: (
    treasureId: string,
  ) => void;

  /**
   * Called after the platform map is ready for commands.
   */
  onReady?: () => void;
}