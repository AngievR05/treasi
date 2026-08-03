import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export type NavigationTab = 'MAP' | 'HUNT' | 'LEADERBOARD' | 'INVENTORY' | 'PROFILE';

interface FieldNavBarProps {
  currentTab: NavigationTab;
  onNavigate: (screen: string) => void;
}

interface NavItem {
  key: NavigationTab;
  label: string;
  symbol: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'MAP', label: 'MAP', symbol: '⦿' },
  { key: 'HUNT', label: 'HUNT', symbol: '🧭' },
  { key: 'LEADERBOARD', label: 'RANKS', symbol: '🏆' },
  { key: 'INVENTORY', label: 'BAG', symbol: '🎒' },
  { key: 'PROFILE', label: 'PROFILE', symbol: '👤' },
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
            activeOpacity={0.7}
            onPress={() => onNavigate(item.key)}
          >
            <Text style={[styles.navSymbol, isActive && styles.navTextActive]}>
              {item.symbol}
            </Text>
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
  navSymbol: {
    color: '#B08D57',
    fontSize: 14,
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