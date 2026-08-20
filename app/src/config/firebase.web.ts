import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
} from 'firebase/app';

import {
  browserLocalPersistence,
  getAuth,
  initializeAuth,
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
    persistence: browserLocalPersistence,
  });
} catch (error) {
  /*
   * Auth can already exist during Fast Refresh.
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