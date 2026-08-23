import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
} from 'firebase/app';

import {
  getAuth,
  initializeAuth,
  getReactNativePersistence,
  type Auth,
} from 'firebase/auth';

import {
  getFirestore,
  type Firestore,
} from 'firebase/firestore';

import {
  getStorage,
  type FirebaseStorage,
} from 'firebase/storage';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { firebaseConfig } from './firebase.options';

/* -------------------------------------------------------------------------- */
/* Firebase App                                                               */
/* -------------------------------------------------------------------------- */

const app: FirebaseApp =
  getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig);

/* -------------------------------------------------------------------------- */
/* Firebase Authentication                                                    */
/* -------------------------------------------------------------------------- */

let auth: Auth;

try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (error) {
  /*
   * initializeAuth throws if Auth was already initialised.
   * This happens during Fast Refresh / development reloads.
   */
  auth = getAuth(app);
}

/* -------------------------------------------------------------------------- */
/* Firebase Services                                                          */
/* -------------------------------------------------------------------------- */

const db: Firestore =
  getFirestore(app);

const storage: FirebaseStorage =
  getStorage(app);

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

export {
  app,
  auth,
  db,
  storage,
};