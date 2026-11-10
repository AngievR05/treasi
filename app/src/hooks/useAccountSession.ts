import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { onSnapshot as subscribe } from 'firebase/firestore';
import { auth } from '../config/firebase';

export function useAuthenticatedUser() {
  const [user, setUser] = useState(auth.currentUser);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return user;
}

// Screens remount per account; callbacks from disposed listeners and operations
// must also be ignored if Firebase delivers them after that remount.
export function useAccountSession(uid: string) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const isCurrent = useCallback(() => mounted.current && !!uid && auth.currentUser?.uid === uid, [uid]);
  const onSnapshot = useCallback(((reference: any, next: (value: any) => void, error: (reason: unknown) => void) => {
    let active = true;
    const unsubscribe = subscribe(reference, (value: any) => {
      if (active && isCurrent()) next(value);
    }, reason => { if (active && isCurrent()) error(reason); });
    return () => { active = false; unsubscribe(); };
  }) as typeof subscribe, [isCurrent]);
  return { isCurrent, onSnapshot };
}
