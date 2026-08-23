import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';

export const app: FirebaseApp;

export const auth: Auth;

export const db: Firestore;

export const storage: FirebaseStorage;