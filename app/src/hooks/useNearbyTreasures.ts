import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, endAt, onSnapshot, orderBy, query, startAt, where } from 'firebase/firestore';
import { nearbyTreasureBounds } from '../utils/treasureGeo';
import { db } from '../config/firebase';
import { readDashboardTreasure } from '../utils/dashboardData';
import { getDistanceInMetres } from '../utils/huntNavigation';
import type { TreasureDocument } from '../types/firestore';

interface Center { latitude: number; longitude: number }
const REQUERY_DISTANCE_METRES = 100;
const validCenter = (center: Center | null): center is Center => !!center && Number.isFinite(center.latitude) && Math.abs(center.latitude) <= 90 && Number.isFinite(center.longitude) && Math.abs(center.longitude) <= 180;

export function useNearbyTreasures(uid: string | null | undefined, center: Center | null, radiusKm: number, retryKey = 0) {
  const anchor = useRef<{ uid: typeof uid; center: Center | null }>({ uid, center: null });
  if (anchor.current.uid !== uid || !validCenter(center)) anchor.current = { uid, center: validCenter(center) ? center : null };
  else if (!anchor.current.center || getDistanceInMetres(anchor.current.center.latitude, anchor.current.center.longitude, center.latitude, center.longitude) >= REQUERY_DISTANCE_METRES) anchor.current = { uid, center };
  const queryCenter = anchor.current.center;
  const [state, setState] = useState<{ uid: typeof uid; items: TreasureDocument[]; loading: boolean; error: string | null }>({ uid, items: [], loading: false, error: null });
  useEffect(() => {
    let active = true;
    setState({ uid, items: [], loading: !!uid && !!queryCenter, error: null });
    if (!uid || !queryCenter) return;
    // Padding retains coverage while the device moves inside the requery threshold.
    const bounds = nearbyTreasureBounds(queryCenter.latitude, queryCenter.longitude, radiusKm * 1000 + REQUERY_DISTANCE_METRES);
    const buckets = bounds.map(() => new Map<string, TreasureDocument>());
    const waiting = new Set(bounds.map((_, index) => index));
    const failures = new Set<number>();
    const publish = () => {
      if (!active) return;
      const combined = new Map<string, TreasureDocument>();
      buckets.forEach(bucket => bucket.forEach((value, id) => combined.set(id, value)));
      setState({ uid, items: [...combined.values()], loading: waiting.size > 0, error: failures.size ? 'NEARBY CACHE SYNC INCOMPLETE · CHECK CONNECTION AND GEOGRAPHIC INDEX' : null });
    };
    const unsubscribes = bounds.map(([lower, upper], index) => onSnapshot(query(collection(db, 'treasures'),
      where('isArchived', '==', false), orderBy('geohash'), startAt(lower), endAt(upper)), snapshot => {
      if (!active) return;
      const bucket = new Map<string, TreasureDocument>();
      snapshot.forEach(document => {
        const item = readDashboardTreasure(document.id, document.data());
        if (item && item.isArchived !== true) bucket.set(document.id, item);
      });
      buckets[index] = bucket; waiting.delete(index); failures.delete(index); publish();
    }, () => { if (active) { waiting.delete(index); failures.add(index); buckets[index].clear(); publish(); } }));
    return () => { active = false; unsubscribes.forEach(unsubscribe => unsubscribe()); };
  }, [uid, queryCenter?.latitude, queryCenter?.longitude, radiusKm, retryKey]);
  const items = useMemo(() => state.uid === uid && validCenter(center) ? state.items.filter(item =>
    getDistanceInMetres(center.latitude, center.longitude, item.location.latitude, item.location.longitude) <= radiusKm * 1000) : [],
  [state, uid, center?.latitude, center?.longitude, radiusKm]);
  return { items, loading: state.uid === uid && state.loading, error: state.uid === uid ? state.error : null, needsLocation: !validCenter(center) };
}
