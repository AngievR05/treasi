import { Geodesic } from 'geographiclib-geodesic';
import { model } from 'geomagnetism';

export const normaliseDegrees = (angle: number) => ((angle % 360) + 360) % 360;
export const shortestAngleDelta = (from: number, to: number) => normaliseDegrees(to - from + 180) - 180;
export const getDistanceInMetres = (lat1: number, lon1: number, lat2: number, lon2: number) =>
  Geodesic.WGS84.Inverse(lat1, lon1, lat2, lon2).s12!;
export const getDistanceInKilometres = (lat1: number, lon1: number, lat2: number, lon2: number) =>
  getDistanceInMetres(lat1, lon1, lat2, lon2) / 1000;
export function getBearingInDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number | null {
  const result = Geodesic.WGS84.Inverse(lat1, lon1, lat2, lon2);
  // There is no unique direction at the target or at an antipode.
  if (result.s12! < 0.01 || Math.abs(result.a12 - 180) < 1e-10) return null;
  return normaliseDegrees(result.azi1!);
}

let cachedDeclination: { day: string; latitude: number; longitude: number; value: number | null } | null = null;
export function getMagneticDeclination(latitude: number, longitude: number, date = new Date()): number | null {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(date.getTime())) return null;
  const day = date.toISOString().slice(0, 10);
  if (cachedDeclination?.day === day && Math.abs(latitude - cachedDeclination.latitude) < 0.01 && Math.abs(longitude - cachedDeclination.longitude) < 0.01) return cachedDeclination.value;
  let value: number | null = null;
  try {
    const field = model(date, { allowOutOfBoundsModel: false }).point([latitude, longitude]);
    // WMM warns that compasses are unreliable in low horizontal-field regions.
    if (field.h >= 6000 && Number.isFinite(field.decl)) value = field.decl;
  } catch { /* Expired model or invalid date: do not invent a correction. */ }
  cachedDeclination = { day, latitude, longitude, value };
  return value;
}

export function readHuntHeading(heading: { trueHeading: number; magHeading: number; accuracy: number }, orientationOffset: number, declination: number | null) {
  const valid = (value: number) => Number.isFinite(value) && value >= 0 && value <= 360;
  const calibration = Number.isInteger(heading.accuracy) && heading.accuracy >= 0 && heading.accuracy <= 3 ? heading.accuracy : 0;
  if (calibration === 0) return null;
  if (valid(heading.trueHeading)) return { degrees: normaliseDegrees(heading.trueHeading + orientationOffset), reference: 'true' as const, calibration };
  if (!valid(heading.magHeading)) return null;
  if (declination !== null && Number.isFinite(declination)) return { degrees: normaliseDegrees(heading.magHeading + declination + orientationOffset), reference: 'corrected' as const, calibration };
  return { degrees: normaliseDegrees(heading.magHeading + orientationOffset), reference: 'magnetic' as const, calibration };
}
