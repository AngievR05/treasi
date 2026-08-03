import { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../config/firebase'; // Ensure your firebase.ts exports 'auth'

export interface AuthState {
  user: User | null;
  loading: boolean;
}

export const useAuth = (): AuthState => {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
  });

  useEffect(() => {
    // Listen for persistent auth state changes natively cached by Firebase
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setState({
        user: user,
        loading: false,
      });
    });

    // Clean up subscription on unmount
    return unsubscribe;
  }, []);

  return state;
};