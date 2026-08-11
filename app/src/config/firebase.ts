import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { 
  initializeAuth, 
  getAuth, 
  Auth,
  getReactNativePersistence 
} from "firebase/auth";
import { 
  getFirestore, 
  Firestore 
} from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Production Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDFctFnRon4DATHpGXQ3Bt3FsqMGJshrMU",
  authDomain: "treasi-5bcff.firebaseapp.com",
  projectId: "treasi-5bcff",
  storageBucket: "treasi-5bcff.firebasestorage.app",
  messagingSenderId: "581084266265",
  appId: "1:581084266265:web:ae62acd33b73ec1c754f88",
  measurementId: "G-LF7P0NWTNX"
};

// 1. Singleton App Safeguard
const app: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// 2. Defensive Auth Setup with Native Persistence
let auth: Auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (error) {
  // Fallback instance to prevent Fast Refresh duplication crashes
  auth = getAuth(app);
}

// 3. Failsafe Firestore Singleton
const db: Firestore = getFirestore(app);

// 4. Storage Reference
const storage: FirebaseStorage = getStorage(app);

export { app, auth, db, storage };