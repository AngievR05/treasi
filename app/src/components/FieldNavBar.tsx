import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type NavigationTab = 'MAP' | 'HUNT' | 'LEADERBOARD' | 'INVENTORY' | 'PROFILE';

interface FieldNavBarProps {
  currentTab: NavigationTab;
  onNavigate?: (screen: string) => void;
}

interface NavItem {
  key: NavigationTab;
  label: string;
  iconName: keyof typeof Ionicons.glyphMap;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'MAP', label: 'MAP', iconName: 'map' },
  { key: 'HUNT', label: 'HUNT', iconName: 'compass' },
  { key: 'LEADERBOARD', label: 'RANKS', iconName: 'trophy' },
  { key: 'INVENTORY', label: 'BAG', iconName: 'briefcase' },
  { key: 'PROFILE', label: 'PROFILE', iconName: 'person' },
];

export const FieldNavBar: React.FC<FieldNavBarProps> = ({ currentTab, onNavigate }) => {
  return (
    <View style={styles.navBarContainer}>
      {NAV_ITEMS.map((item) => {
        const isActive = currentTab === item.key;
        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.navButton, isActive && styles.navButtonActive]}
            activeOpacity={0.75}
            onPress={() => onNavigate?.(item.key)}
          >
            <Ionicons
              name={item.iconName}
              size={16}
              color={isActive ? '#F3ECD8' : '#B08D57'}
              style={styles.navIcon}
            />
            <Text style={[styles.navLabel, isActive && styles.navTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  navBarContainer: {
    flexDirection: 'row',
    backgroundColor: '#1E281F',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#B08D57',
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    borderRadius: 4,
  },
  navButtonActive: {
    backgroundColor: '#A64B2A',
  },
  navIcon: {
    marginBottom: 2,
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