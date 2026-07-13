import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Replace these placeholders with your actual Firebase Web App credentials from your console
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "treasi-app.firebaseapp.com",
  projectId: "treasi-app",
  storageBucket: "treasi-app.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:abcdef"
};

// Safeguard against hot-reloading instantiating multiple Firebase app instances
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Authentication persistent session instance (so users stay logged in when rotating the app)
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

// Firestore database configuration instance with auto-long-polling backup handles for patchy mobile grids
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});

// Storage engine instance to hold treasure images/media capture cards
const storage = getStorage(app);

export { app, auth, db, storage };