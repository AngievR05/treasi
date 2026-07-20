import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as firebaseAuth from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDFctFnRon4DATHpGXQ3Bt3FsqMGJshrMU",
  authDomain: "treasi-5bcff.firebaseapp.com",
  projectId: "treasi-5bcff",
  storageBucket: "treasi-5bcff.firebasestorage.app",
  messagingSenderId: "581084266265",
  appId: "1:581084266265:web:ae62acd33b73ec1c754f88",
  measurementId: "G-LF7P0NWTNX"
};

// Prevent duplicate app initialization crashes during Metro fast-refresh cycles
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Type-safe fallback initialization utilizing module namespace injection
const createAuthInstance = () => {
  if (getApps().length > 0) {
    try {
      return firebaseAuth.getAuth(app);
    } catch {
      // Instance not configured yet, falling through to initialization
    }
  }

  const authTarget = firebaseAuth as any;
  if (authTarget.getReactNativePersistence) {
    return firebaseAuth.initializeAuth(app, {
      persistence: authTarget.getReactNativePersistence(AsyncStorage),
    });
  }
  
  return firebaseAuth.getAuth(app);
};

const auth = createAuthInstance();
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
const storage = getStorage(app);

export { app, auth, db, storage };