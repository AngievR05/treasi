import { NativeStackNavigationProp } from '@react-native-stack/navigation';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Hunt: undefined;
  Leaderboard: undefined;
  Inventory: undefined;
  ProfileSettings: undefined;
};

export type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Auth: AuthStackParamList;
  MainApp: MainTabParamList;
};