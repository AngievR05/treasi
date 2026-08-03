import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Persistence, ReactNativeAsyncStorage } from "firebase/auth";

// 1. Corrected TypeScript Module Augmentation
declare module "firebase/auth" {
  export function getReactNativePersistence(
    storage: ReactNativeAsyncStorage
  ): Persistence;
}

// Now safely extract the augmented persistence function
import { getReactNativePersistence } from "firebase/auth";

// Your verified credentials pulled from the Firebase Project Console
const firebaseConfig = {
  apiKey: "AIzaSyDFctFnRon4DATHpGXQ3Bt3FsqMGJshrMU",
  authDomain: "treasi-5bcff.firebaseapp.com",
  projectId: "treasi-5bcff",
  storageBucket: "treasi-5bcff.firebasestorage.app",
  messagingSenderId: "581084266265",
  appId: "1:581084266265:web:ae62acd33b73ec1c754f88",
  measurementId: "G-LF7P0NWTNX"
};

// Protect the runtime against double-initialization cycles during hot-reloads
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Fulfill the primary 'Stay Connected' persistence mandate across app reboots
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

// Configure the Firestore Database Engine with long-polling hooks for stable local testing
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});

// Reference connection hook for handling physical scavenger hunt media assets
const storage = getStorage(app);

export { app, auth, db, storage };