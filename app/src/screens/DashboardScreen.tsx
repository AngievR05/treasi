import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  onNavigate: (screen: string) => void;
}

export const DashboardScreen: React.FC<Props> = ({ onNavigate }) => {
  return (
    <View style={styles.splitWrapper}>
      <View style={styles.leftViewport}>
        <Text style={styles.sectionHeader}>[ LIVE FIELD MAP ]</Text>
        <View style={styles.mapPlaceholder}>
          <Text style={styles.mapText}>Geospatial Render Canvas (60%)</Text>
        </View>
      </View>
      <View style={styles.rightViewport}>
        <Text style={styles.panelTitle}>COMMAND CONSOLE</Text>
        <Text style={styles.statLabel}>FIELD STATS: 2,340 PTS</Text>
        
        <TouchableOpacity style={styles.ctaButton} onPress={() => onNavigate('HUNT')}>
          <Text style={styles.ctaText}>START HUNT</Text>
        </TouchableOpacity>
        
        <View style={styles.navStack}>
          <TouchableOpacity onPress={() => onNavigate('LEADERBOARD')}><Text style={styles.navLink}>› Leaderboard</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => onNavigate('INVENTORY')}><Text style={styles.navLink}>› Field Bag</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => onNavigate('PROFILE')}><Text style={styles.navLink}>› Settings</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  splitWrapper: { flex: 1, flexDirection: 'row' },
  leftViewport: { flex: 0.60, backgroundColor: '#E8DCC0', padding: 16 },
  rightViewport: { flex: 0.40, backgroundColor: '#2C3B2E', padding: 16, borderLeftWidth: 3, borderColor: '#B08D57', justifyContent: 'space-between' },
  sectionHeader: { color: '#2A2420', fontWeight: 'bold', fontSize: 12, marginBottom: 8 },
  mapPlaceholder: { flex: 1, backgroundColor: '#D9CBAC', borderRadius: 4, borderWidth: 1, borderColor: '#B08D57', justifyContent: 'center', alignItems: 'center' },
  mapText: { color: '#8C8275', fontStyle: 'italic', fontSize: 12 },
  panelTitle: { color: '#E8DCC0', fontWeight: 'bold', fontSize: 16, letterSpacing: 2 },
  statLabel: { color: '#B08D57', fontSize: 12, marginVertical: 8 },
  ctaButton: { backgroundColor: '#A64B2A', padding: 12, borderRadius: 4, alignItems: 'center' },
  ctaText: { color: '#E8DCC0', fontWeight: 'bold', letterSpacing: 2 },
  navStack: { gap: 6, marginTop: 12 },
  navLink: { color: '#E8DCC0', fontSize: 12 },
});