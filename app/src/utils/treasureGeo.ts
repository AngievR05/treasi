import { geohashForLocation, geohashQueryBounds } from 'geofire-common';
import { getDistanceInMetres } from './huntNavigation';

export function nearbyTreasureBounds(latitude: number, longitude: number, radiusMetres: number): [string, string][] {
  const pole = latitude >= 0 ? 90 : -90;
  if (radiusMetres >= getDistanceInMetres(latitude, longitude, pole, longitude)) {
    // A search circle crossing a pole includes every longitude. GeoFire's corner
    // bounds can miss that cap; cover its complete polar geohash row instead.
    const precision = radiusMetres < 500_000 ? 2 : 1;
    const hashes = new Set(Array.from({ length: 32 }, (_, index) =>
      geohashForLocation([pole, -174.375 + index * 11.25], precision)));
    return [...hashes].map(hash => [hash, `${hash}~`]);
  }
  return geohashQueryBounds([latitude, longitude], radiusMetres);
}
