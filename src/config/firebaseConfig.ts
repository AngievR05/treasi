import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Replace these placeholder values with your official Firebase Project Console web app keys!
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "treasi-xxxx.firebaseapp.com",
  projectId: "treasi-xxxx",
  storageBucket: "treasi-xxxx.appspot.com",
  messagingSenderId: "XXXXXXXXXXXX",
  appId: "1:XXXXXX:web:XXXXXX"
};

// Prevent multi-app instance crashes on fast-refresh cycles
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Rigorously enforce persistent authentication tracking using local storage state
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true, // Prevents hanging connections on restricted academic WiFi networks
});

const storage = getStorage(app);

export { app, auth, db, storage };