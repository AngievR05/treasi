import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

export type NavigationTab = 'MAP' | 'HUNT' | 'LEADERBOARD' | 'INVENTORY' | 'PROFILE';

interface FieldNavBarProps {
  currentTab: NavigationTab;
  onNavigate: (screen: NavigationTab) => void;
}

interface NavItem {
  key: NavigationTab;
  label: string;
  renderIcon: (color: string) => React.ReactNode;
}

// Custom Vintage Vector SVG Icons (No Emojis)
const MapIcon: React.FC<{ color: string }> = ({ color }) => (
  <Svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="12" cy="12" r="10" />
    <Circle cx="12" cy="12" r="6" />
    <Circle cx="12" cy="12" r="2" fill={color} />
    <Path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
  </Svg>
);

const CompassIcon: React.FC<{ color: string }> = ({ color }) => (
  <Svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="12" cy="12" r="10" />
    <Path d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z" />
  </Svg>
);

const RankIcon: React.FC<{ color: string }> = ({ color }) => (
  <Svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
    <Path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
    <Path d="M4 22h16" />
    <Path d="M10 14.66V17c0 .55-.45 1-1 1H7" />
    <Path d="M14 14.66V17c0 .55.45 1 1 1h2" />
    <Path d="M18 2H6v7a6 6 0 0012 0V2z" />
  </Svg>
);

const BagIcon: React.FC<{ color: string }> = ({ color }) => (
  <Svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Rect x="4" y="8" width="16" height="12" rx="2" />
    <Path d="M9 8V5a3 3 0 016 0v3" />
    <Path d="M9 12h6" />
    <Path d="M12 12v3" />
  </Svg>
);

const ProfileIcon: React.FC<{ color: string }> = ({ color }) => (
  <Svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <Circle cx="12" cy="7" r="4" />
  </Svg>
);

const NAV_ITEMS: NavItem[] = [
  { key: 'MAP', label: 'MAP', renderIcon: (color) => <MapIcon color={color} /> },
  { key: 'HUNT', label: 'HUNT', renderIcon: (color) => <CompassIcon color={color} /> },
  { key: 'LEADERBOARD', label: 'RANKS', renderIcon: (color) => <RankIcon color={color} /> },
  { key: 'INVENTORY', label: 'BAG', renderIcon: (color) => <BagIcon color={color} /> },
  { key: 'PROFILE', label: 'PROFILE', renderIcon: (color) => <ProfileIcon color={color} /> },
];

export const FieldNavBar: React.FC<FieldNavBarProps> = ({ currentTab, onNavigate }) => {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  // Dynamic layout adjustment based on landscape viewport width
  const isCompact = windowWidth < 680;

  return (
    <View 
      style={[
        styles.navBarWrapper, 
        { 
          paddingLeft: Math.max(insets.left, 8), 
          paddingRight: Math.max(insets.right, 8),
          paddingTop: Math.max(insets.top / 2, 4)
        }
      ]}
    >
      <View style={styles.navBarContainer}>
        {NAV_ITEMS.map((item) => {
          const isActive = currentTab === item.key;
          const iconColor = isActive ? '#F3ECD8' : '#B08D57';

          return (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.navButton, 
                isActive && styles.navButtonActive,
                isCompact && styles.navButtonCompact
              ]}
              activeOpacity={0.65}
              onPress={() => onNavigate(item.key)}
            >
              <View style={styles.iconContainer}>
                {item.renderIcon(iconColor)}
              </View>
              <Text style={[styles.navLabel, isActive && styles.navTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  navBarWrapper: {
    width: '100%',
    backgroundColor: '#1E281F',
    borderTopWidth: 1,
    borderTopColor: '#B08D57',
  },
  navBarContainer: {
    flexDirection: 'row',
    backgroundColor: '#1E281F',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 4,
    paddingHorizontal: 4,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  navButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderRadius: 4,
    marginHorizontal: 2,
  },
  navButtonCompact: {
    paddingVertical: 4,
  },
  navButtonActive: {
    backgroundColor: '#A64B2A',
  },
  iconContainer: {
    marginBottom: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLabel: {
    color: '#E8DCC0',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  navTextActive: {
    color: '#F3ECD8',
  },
});