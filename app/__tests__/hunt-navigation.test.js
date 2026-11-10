import { Geodesic } from 'geographiclib-geodesic';
import { getBearingInDegrees, getDistanceInMetres, getMagneticDeclination, normaliseDegrees, shortestAngleDelta, readHuntHeading } from '../src/utils/huntNavigation';

test('WGS84 inverse matches the GeographicLib reference geodesic', () => {
  expect(getDistanceInMetres(35.60777, -139.44815, -11.17491, -69.95921)).toBeCloseTo(8935244.5604818305, 5);
  expect(getBearingInDegrees(35.60777, -139.44815, -11.17491, -69.95921)).toBeCloseTo(111.098748429560326, 9);
});
test.each([0, 45, 90, 135, 180, 225, 270, 315])('resolves a five-metre target at bearing %s from a South African position', bearing => {
  const target = Geodesic.WGS84.Direct(-25.89, 28.18, bearing, 5);
  expect(getDistanceInMetres(-25.89, 28.18, target.lat2, target.lon2)).toBeCloseTo(5, 6);
  expect(getBearingInDegrees(-25.89, 28.18, target.lat2, target.lon2)).toBeCloseTo(bearing, 6);
});
test('uses the short geodesic across the international date line', () => {
  expect(getDistanceInMetres(0, 179.999, 0, -179.999)).toBeCloseTo(222.6389816, 5);
  expect(getBearingInDegrees(0, 179.999, 0, -179.999)).toBeCloseTo(90, 8);
});
test('coincident and antipodal points never invent a target direction', () => {
  expect(getDistanceInMetres(-25.89, 28.18, -25.89, 28.18)).toBe(0);
  expect(getBearingInDegrees(-25.89, 28.18, -25.89, 28.18)).toBeNull();
  expect(getBearingInDegrees(0, 0, 0, 180)).toBeNull();
  expect(getDistanceInMetres(0, 0, 0, 180)).toBeCloseTo(20003931.4586254, 5);
});
test('headings cross north using the shortest rotation in both directions', () => {
  expect(shortestAngleDelta(359, 1)).toBe(2); expect(shortestAngleDelta(1, 359)).toBe(-2);
  expect(shortestAngleDelta(10, -10)).toBe(-20); expect(normaliseDegrees(-90)).toBe(270);
});
test.each([-90, 90, 180])('normalizes true headings for an interface offset of %s degrees', offset => {
  const result = readHuntHeading({ trueHeading: 90, magHeading: 70, accuracy: 3 }, offset, -20);
  expect(result.degrees).toBe(normaliseDegrees(90 + offset)); expect(result.reference).toBe('true');
});
test('adds east-positive declination before applying the interface rotation to magnetic north', () => {
  expect(readHuntHeading({ trueHeading: -1, magHeading: 100, accuracy: 3 }, -90, -20)).toEqual({ degrees: 350, reference: 'corrected', calibration: 3 });
});
test.each([0, -1, NaN, 4, 1.5])('rejects an unusable compass calibration level %s', accuracy => {
  expect(readHuntHeading({ trueHeading: 90, magHeading: 80, accuracy }, 0, null)).toBeNull();
});
test('does not confuse magnetic north with true north when no correction is available', () => {
  expect(readHuntHeading({ trueHeading: -1, magHeading: 100, accuracy: 3 }, 0, null)).toEqual({ degrees: 100, reference: 'magnetic', calibration: 3 });
});
test('rejects invalid headings and recovers a valid magnetic heading when true heading is malformed', () => {
  expect(readHuntHeading({ trueHeading: 999, magHeading: 80, accuracy: 3 }, 0, -20)?.degrees).toBe(60);
  expect(readHuntHeading({ trueHeading: NaN, magHeading: -1, accuracy: 3 }, 0, -20)).toBeNull();
});
test('uses a valid current geomagnetic model in Pretoria without pretending it remains valid indefinitely', () => {
  const declination = getMagneticDeclination(-25.89, 28.18, new Date('2026-11-10T12:00:00Z'));
  expect(declination).toBeLessThan(-10); expect(declination).toBeGreaterThan(-30);
  expect(getMagneticDeclination(-25.89, 28.18, new Date('2040-01-01'))).toBeNull();
  expect(getMagneticDeclination(NaN, 0)).toBeNull();
});
