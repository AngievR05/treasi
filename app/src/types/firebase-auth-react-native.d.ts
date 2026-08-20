import 'firebase/auth';

declare module 'firebase/auth' {
  interface ReactNativeAsyncStorage {
    setItem(
      key: string,
      value: string,
    ): Promise<void>;

    getItem(
      key: string,
    ): Promise<string | null>;

    removeItem(
      key: string,
    ): Promise<void>;
  }

  export function getReactNativePersistence(
    storage: ReactNativeAsyncStorage,
  ): Persistence;
}

export {};