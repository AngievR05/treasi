import { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
// FIX: Change 'firebaseAuth' to 'auth' to match your firebase.ts exports
import { auth } from '../config/firebase'; 

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // Listens to persistent native token changes automatically using the verified auth engine
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsLoading(false);
    });

    return unsubscribe; // Clean up subscription on unmount
  }, []);

  return { user, isLoading };
}